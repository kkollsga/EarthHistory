#!/usr/bin/env python3
"""Run the correction validators in parallel and skip the ones nothing changed.

`make check-corrections` used to run thirty-eight validator lines one after the
other. The lines are independent oracles over the same tracked inputs, so this
driver runs them in a bounded pool and remembers, per validator, the exact
project files that validator touched on its last green run. A validator whose
command, script, imported modules, declared inputs and declared outputs all
still hash to the recorded digest is reported as a cached pass and skipped;
anything else re-runs. Mutating `apply_*` validators run first, one at a time,
so a re-application can never race a reader.

This changes only *when* a validator runs, never what it asserts: the commands,
their arguments and their output are the Makefile's own.

Usage:
  python3 scripts/run_corrections.py            # parallel, cached
  python3 scripts/run_corrections.py --no-cache # parallel, every validator runs
  python3 scripts/run_corrections.py --jobs 1   # the old sequential order
  python3 scripts/run_corrections.py --self-test
"""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIRECTORY = ROOT / ".cache" / "corrections"
AUDIT_DIRECTORY = Path(__file__).resolve().parent / "corrections_audit"
# The recorded input set is bounded to the project and its pinned data sibling.
RECORD_ROOTS = (ROOT, ROOT.parent / "EarthHistory-data")
# Bumped whenever the digest recipe changes, so old entries cannot claim a pass.
DIGEST_VERSION = "1"

SERIAL = "serial"
PARALLEL = "parallel"

# id, lane, command. The commands are copied from the Makefile recipe they
# replace; the lane only decides scheduling.
UNITS: tuple[tuple[str, str, str], ...] = (
    ("cao_package_interning-apply", SERIAL, "python3 scripts/research/apply_cao_package_interning.py"),
    ("cao_native_triangulation_repair-apply", SERIAL, "python3 scripts/research/apply_cao_native_triangulation_repair.py"),
    ("regional_panama_land-apply", SERIAL, "python3 scripts/research/apply_regional_panama_land.py"),
    ("cao_modern_country_reference-apply", SERIAL, "python3 scripts/research/apply_cao_modern_country_reference.py"),
    ("cao_country_segment_bridge-apply", SERIAL, "python3 scripts/research/apply_cao_country_segment_bridge.py"),
    ("regional_iceland_shelf-apply", SERIAL, "python3 scripts/research/apply_regional_iceland_shelf.py --validate-applied"),
    ("cao_package_intern-self-test", PARALLEL, "python3 scripts/research/cao_package_intern.py --self-test"),
    ("cao_material_corrections-self-test", PARALLEL, "python3 scripts/research/cao_material_corrections.py --self-test"),
    ("cao_material_corrections", PARALLEL, "python3 scripts/research/cao_material_corrections.py"),
    ("regional_barents_shelf-self-test", PARALLEL, "python3 scripts/research/validate_regional_barents_shelf.py --self-test"),
    ("regional_barents_shelf", PARALLEL, "python3 scripts/research/validate_regional_barents_shelf.py"),
    ("cao_shelf_lifecycle_422-self-test", PARALLEL, "python3 scripts/research/validate_cao_shelf_lifecycle_422.py --self-test"),
    ("cao_shelf_lifecycle_422", PARALLEL, "python3 scripts/research/validate_cao_shelf_lifecycle_422.py"),
    ("regional_iceland-self-test", PARALLEL, "python3 scripts/research/regional_iceland_correction.py --self-test --runtime"),
    ("regional_iceland", PARALLEL, "python3 scripts/research/regional_iceland_correction.py --runtime"),
    ("regional_iceland_shelf-self-test", PARALLEL, "python3 scripts/research/regional_iceland_shelf_correction.py --self-test"),
    ("regional_iceland_shelf", PARALLEL, "python3 scripts/research/regional_iceland_shelf_correction.py"),
    ("regional_panama-self-test", PARALLEL, "python3 scripts/research/regional_panama_correction.py --self-test"),
    ("regional_observed_land_omission-self-test", PARALLEL, "python3 scripts/research/regional_observed_land_omission_correction.py --self-test --runtime"),
    ("regional_observed_land_omission", PARALLEL, "python3 scripts/research/regional_observed_land_omission_correction.py --runtime"),
    ("regional_lake_void-self-test", PARALLEL, "python3 scripts/research/regional_lake_void_correction.py --self-test --runtime"),
    ("regional_lake_void", PARALLEL, "python3 scripts/research/regional_lake_void_correction.py --runtime"),
    ("restored_margins-self-test", PARALLEL, "python3 scripts/research/restored_margins_correction.py --self-test --runtime"),
    ("restored_margins", PARALLEL, "python3 scripts/research/restored_margins_correction.py --runtime"),
    ("north_sea_restoration-self-test", PARALLEL, "python3 scripts/research/validate_north_sea_restoration.py --self-test"),
    ("north_sea_restoration", PARALLEL, "python3 scripts/research/validate_north_sea_restoration.py"),
    ("cao_native_triangulation_repair-unittest", PARALLEL, "python3 -m unittest scripts/research/apply_cao_native_triangulation_repair_test.py"),
    ("regional_panama_land-unittest", PARALLEL, "python3 -m unittest scripts/research/apply_regional_panama_land_test.py"),
    ("cao_country_segment_bridge-self-test", PARALLEL, "python3 scripts/research/apply_cao_country_segment_bridge.py --self-test"),
    ("regional_iceland_shelf-unittest", PARALLEL, "python3 -m unittest scripts/research/apply_regional_iceland_shelf_test.py"),
    ("cao_requested_age_motion_tiles-self-test", PARALLEL, "python3 scripts/research/validate_cao_requested_age_motion_tiles.py --self-test"),
    ("palaeo_coastlines_runtime-self-test", PARALLEL, "python3 scripts/research/validate_palaeo_coastlines_runtime.py --self-test >/dev/null"),
    ("palaeo_coastlines_runtime", PARALLEL, "python3 scripts/research/validate_palaeo_coastlines_runtime.py >/dev/null"),
    ("precollision_extent-record-only-self-test", PARALLEL, "python3 scripts/research/validate_precollision_extent.py --record-only --self-test >/dev/null"),
    ("precollision_extent-record-only", PARALLEL, "python3 scripts/research/validate_precollision_extent.py --record-only >/dev/null"),
    ("palaeo-compile", PARALLEL, "make --no-print-directory check-palaeo-compile"),
    ("restored-margins-model", PARALLEL, "make --no-print-directory check-restored-margins"),
    ("precollision-extent-model", PARALLEL, "make --no-print-directory check-precollision-extent"),
)


def digest_of(files: dict[str, str | None], directories: list[str], command: str) -> str:
    """Hash a validator's command together with the state of its recorded paths.

    A recorded path that was absent stays in the digest as "absent", so a file a
    validator asserts is missing cannot appear without re-running it. Directory
    entries hash only the listing, so a new sibling input invalidates too.
    """
    hasher = hashlib.sha256()
    hasher.update(f"v{DIGEST_VERSION}\n{command}\n".encode())
    for path in sorted(files):
        hasher.update(f"f\0{path}\0{files[path] or 'absent'}\n".encode())
    for path in sorted(directories):
        hasher.update(f"d\0{path}\0{listing_digest(path)}\n".encode())
    return hasher.hexdigest()


# Generated state is never a validator input, and hashing it would make a
# directory listing change every time a build or this cache was written.
GENERATED = {"node_modules", "dist", "test-results", "playwright-report", "__pycache__"}


def listing_digest(path: str) -> str:
    try:
        names = sorted(
            name for name in os.listdir(path)
            if not name.startswith(".") and name not in GENERATED
        )
    except OSError:
        return "absent"
    return hashlib.sha256("\0".join(names).encode()).hexdigest()


def hash_file(path: str) -> str | None:
    try:
        with open(path, "rb") as handle:
            hasher = hashlib.sha256()
            for block in iter(lambda: handle.read(1 << 20), b""):
                hasher.update(block)
        return hasher.hexdigest()
    except (OSError, IsADirectoryError):
        return None


def current_digest(entry: dict, command: str) -> str:
    files = {path: hash_file(path) for path in entry.get("files", [])}
    return digest_of(files, entry.get("directories", []), command)


def read_cache(unit_id: str) -> dict | None:
    path = CACHE_DIRECTORY / f"{unit_id}.json"
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def write_cache(unit_id: str, entry: dict) -> None:
    CACHE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    (CACHE_DIRECTORY / f"{unit_id}.json").write_text(json.dumps(entry, indent=2) + "\n")


def run_unit(unit_id: str, command: str, root: Path, use_cache: bool) -> dict:
    """Run one validator, recording the project files it touched."""
    cached = read_cache(unit_id) if use_cache else None
    if cached and cached.get("digest") == current_digest(cached, command):
        return {
            "id": unit_id,
            "command": command,
            "cached": True,
            "returncode": 0,
            "seconds": 0.0,
            "output": f"cached pass (digest {cached['digest'][:12]}): {command}\n",
        }

    record_directory = Path(tempfile.mkdtemp(prefix=f"earthhistory-corrections-{unit_id}-"))
    environment = dict(os.environ)
    environment["EARTHHISTORY_CORRECTIONS_RECORD_DIR"] = str(record_directory)
    environment["EARTHHISTORY_CORRECTIONS_RECORD_ROOTS"] = os.pathsep.join(
        str(candidate.resolve()) for candidate in RECORD_ROOTS if candidate.exists()
    )
    existing = environment.get("PYTHONPATH")
    environment["PYTHONPATH"] = (
        f"{AUDIT_DIRECTORY}{os.pathsep}{existing}" if existing else str(AUDIT_DIRECTORY)
    )
    started = time.perf_counter()
    try:
        completed = subprocess.run(
            ["/bin/sh", "-c", command], cwd=root, env=environment,
            capture_output=True, text=True,
        )
        elapsed = time.perf_counter() - started
        files: set[str] = set()
        directories: set[str] = set()
        for record in record_directory.glob("*.json"):
            try:
                payload = json.loads(record.read_text())
            except ValueError:
                continue
            files.update(payload.get("files", ()))
            directories.update(payload.get("directories", ()))
    finally:
        shutil.rmtree(record_directory, ignore_errors=True)

    if completed.returncode == 0:
        # The Makefile recipe and this driver are inputs of every validator.
        files.add(str(ROOT / "Makefile"))
        files.add(str(Path(__file__).resolve()))
        entry = {
            "command": command,
            "files": sorted(files),
            "directories": sorted(directories),
        }
        entry["digest"] = current_digest(entry, command)
        write_cache(unit_id, entry)
    else:
        (CACHE_DIRECTORY / f"{unit_id}.json").unlink(missing_ok=True)
    return {
        "id": unit_id,
        "command": command,
        "cached": False,
        "returncode": completed.returncode,
        "seconds": elapsed,
        "output": completed.stdout + completed.stderr,
    }


def prune_cache(units) -> None:
    """R4: the cache holds one small entry per declared validator, nothing else."""
    declared = {f"{unit[0]}.json" for unit in units}
    if not CACHE_DIRECTORY.exists():
        return
    for stale in CACHE_DIRECTORY.iterdir():
        if stale.name not in declared:
            stale.unlink(missing_ok=True)


def run_all(jobs: int, use_cache: bool, root: Path = ROOT, units=UNITS, quiet: bool = False) -> tuple[int, list[dict]]:
    prune_cache(units)
    results: dict[str, dict] = {}
    failed = False

    def record(result: dict) -> None:
        nonlocal failed
        results[result["id"]] = result
        if result["returncode"] != 0:
            failed = True
        if not quiet:
            state = "cached" if result["cached"] else f"{result['seconds']:6.2f}s"
            mark = "ok " if result["returncode"] == 0 else "FAIL"
            print(f"  [{mark} {state:>7}] {result['id']}", file=sys.stderr, flush=True)

    for unit_id, lane, command in units:
        if lane != SERIAL:
            continue
        record(run_unit(unit_id, command, root, use_cache))
        if failed:
            break

    parallel = [unit for unit in units if unit[1] == PARALLEL]
    if not failed and parallel:
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
            futures = {
                pool.submit(run_unit, unit_id, command, root, use_cache): unit_id
                for unit_id, _, command in parallel
            }
            for future in concurrent.futures.as_completed(futures):
                record(future.result())

    ordered = [results[unit[0]] for unit in units if unit[0] in results]
    for result in ordered:
        text = result["output"].strip()
        if text:
            print(text)
    return (1 if failed else 0), ordered


def self_test() -> int:
    """Prove the cache re-runs a validator whose input changed (R1)."""
    with tempfile.TemporaryDirectory(prefix="earthhistory-corrections-self-test-") as raw:
        sandbox = Path(raw)
        (sandbox / "input.json").write_text('{"value": 1}\n')
        (sandbox / "check.py").write_text(
            "import json, pathlib, sys\n"
            "value = json.loads((pathlib.Path(__file__).parent / 'input.json').read_text())['value']\n"
            "print('checked', value)\n"
            "sys.exit(0 if value == 1 else 1)\n"
        )
        global CACHE_DIRECTORY, RECORD_ROOTS
        previous_cache, previous_roots = CACHE_DIRECTORY, RECORD_ROOTS
        CACHE_DIRECTORY = sandbox / ".cache" / "corrections"
        RECORD_ROOTS = (sandbox,)
        try:
            units = (("sandbox-check", PARALLEL, "python3 check.py"),)
            code, first = run_all(2, True, sandbox, units, quiet=True)
            assert code == 0 and not first[0]["cached"], "first run must execute"
            code, second = run_all(2, True, sandbox, units, quiet=True)
            assert code == 0 and second[0]["cached"], "unchanged input must be a cached pass"
            (sandbox / "input.json").write_text('{"value": 2}\n')
            code, third = run_all(2, True, sandbox, units, quiet=True)
            assert not third[0]["cached"], "a mutated input must re-run the validator"
            assert code == 1, "a mutated input must still fail the validator"
            (sandbox / "input.json").write_text('{"value": 1}\n')
            code, fourth = run_all(2, True, sandbox, units, quiet=True)
            assert code == 0 and not fourth[0]["cached"], "the restored input must re-run green"
            code, fifth = run_all(2, False, sandbox, units, quiet=True)
            assert code == 0 and not fifth[0]["cached"], "--no-cache must ignore a green entry"
        finally:
            CACHE_DIRECTORY, RECORD_ROOTS = previous_cache, previous_roots
    print("run_corrections --self-test: cache invalidates on a mutated input, and --no-cache always runs")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, default=min(6, os.cpu_count() or 2),
                        help="bounded worker pool size for the independent validators")
    parser.add_argument("--no-cache", action="store_true",
                        help="run every validator even when its recorded inputs are unchanged")
    parser.add_argument("--self-test", action="store_true",
                        help="prove the digest cache re-runs a validator whose input changed")
    arguments = parser.parse_args()
    if arguments.self_test:
        return self_test()

    started = time.perf_counter()
    code, results = run_all(arguments.jobs, not arguments.no_cache)
    cached = sum(1 for result in results if result["cached"])
    elapsed = time.perf_counter() - started
    state = "check-corrections" if code == 0 else "check-corrections FAILED"
    print(
        f"{state}: {len(results)} validators, {cached} cached, "
        f"{len(results) - cached} run, {elapsed:.1f}s wall at --jobs {arguments.jobs}"
    )
    return code


if __name__ == "__main__":
    raise SystemExit(main())
