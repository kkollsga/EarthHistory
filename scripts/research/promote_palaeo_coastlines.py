#!/usr/bin/env python3
"""Promote the compiled Cao 2017 palaeo-coastline set into the public package.

What ships is exactly the landmass and shallow-marine payloads, their two class
catalogs and the country-outline tone tables. The mountain class stays compiled
and validated in the offline store (user decision 2026-09-15: the requested-age
motion-tiles first-paint tier keeps its 5.48 MiB), and the provenance sidecars
and the unsimplified ``original`` payloads never enter a build at all.

Two manifests are written. The package manifest gains the ``palaeoCoastlines``
section `validatePalaeoCoastlineAssets` reads; the outer data inventory gains one
declared output per promoted file, with bytes and sha256 measured here and
re-measured by ``emit_cao_material_corrections.refresh_outer_manifest`` on every
correction run, so no digest in either document is ever hand-written.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))

import emit_cao_material_corrections as emitter  # noqa: E402

PUBLIC_PKG = ROOT / "public/data/reconstruction/cao-v2.4"
PALAEO_DIR = PUBLIC_PKG / "palaeo-coastlines"
DEFAULT_STAGING = ROOT.parent / "EarthHistory-data/palaeomap-study/palaeo-coastlines/staging"

SECTION_ID = "palaeo-coastlines-cao2017-v1"
SHIPPED_CLASSES = ("lm", "sm", "m")

# The outer envelope of every published interval: the Cao 2017 schedule
# (402-380 ... 11-2 Ma) plus the detached LGM lowstand state at 26.5-19.5 ka.
# It is an envelope, not a domain: the 2 Myr between 2.01 Ma and 26.5 ka carries
# no map at all. The class catalogs' own interval table is the authority on
# which ages are covered - `selectPalaeoIntervalForAge` answers null in the gap
# and the request fails there by name - and the runtime falls back to today's
# composition wherever it does.
AGE_DOMAIN_MA = {"youngest": 0.0195, "oldest": 402.0}

# D1/Phase 4 defaults, identical to CAO_FOUNDATION_DEFAULT_BASE_COLORS in
# src/render/reconstruction/caoFoundation.ts. Linear base colour per class:
# palaeo-land is the muted olive of a Cao 2017 landmass polygon and
# palaeo-shallow-marine the saturated teal that keeps a 5.4:1 luminance contrast
# under the light #d0d4d5 outline ink. The mountain value is a saturated mid
# brown because it is an albedo, not a swatch: the renderer's inspection light
# and ACES curve wash it to a light brown on screen, measured by the browser
# tone census at 234,198,139 in full light.
# The renderer's own defaults (`CAO_FOUNDATION_DEFAULT_BASE_COLORS`); the
# manifest ships them so the package, not the bundle, is the authority.
BASE_COLOR_RGB = {
    "lm": [0x9A / 255, 0xA8 / 255, 0x6B / 255],
    "sm": [0x14 / 255, 0x60 / 255, 0x6B / 255],
    "m": [0xFD / 255, 0x73 / 255, 0x28 / 255],
}

# Measured 2026-09-15 across all 24 promoted intervals by
# `palaeoCoastlineAssets.test.ts`: the runtime's conforming red-green refinement
# splits edges the compiler's per-triangle longest-edge model leaves alone, so it
# produces 1.87x the catalog's `estimatedTrianglesAtOneDegree` at the worst
# interval (29-20 Ma: 427,088 against 228,549) and 1.63x at the median. The
# reservation therefore scales the worst interval's estimate by 2.0 rather than
# trusting it, and the same test asserts the declared numbers still cover every
# promoted interval - a recompile that changed the geometry would turn it red
# rather than letting the loader reject an interval at runtime.
RUNTIME_REFINEMENT_FACTOR = 2.0
# Measured worst ratio of refined vertices to refined triangles is 0.614
# (262,202 / 427,088); 0.65 is that with the same headroom.
RUNTIME_VERTICES_PER_TRIANGLE = 0.65
# The interval store holds at most two resident intervals and two unsettled
# loads, so four worst-case intervals bound its resident payload bytes.
RESIDENT_INTERVAL_MULTIPLE = 4


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def asset(path: Path) -> dict:
    return {"url": str(path.relative_to(PUBLIC_PKG)), "bytes": path.stat().st_size,
            "sha256": sha256(path)}


def staged_catalog(staging: Path, class_name: str) -> dict:
    return json.loads((staging / class_name / f"palaeo-{class_name}-catalog.json").read_text())


def interval_rows(catalog: dict) -> list[dict]:
    """Expand the columnar interval table into rows, oldest first."""
    table = catalog["intervals"]
    columns = [key for key in table if key != "count"]
    return [{column: table[column][index] for column in columns}
            for index in range(table["count"])]


def reservation(catalogs: dict[str, dict]) -> dict:
    schedules = {name: interval_rows(catalog) for name, catalog in catalogs.items()}
    ids = [row["intervalId"] for row in next(iter(schedules.values()))]
    for name, rows in schedules.items():
        if [row["intervalId"] for row in rows] != ids:
            raise SystemExit(f"class {name} publishes a different interval schedule")
    def worst(field: str) -> int:
        return max(sum(rows[index][field] for rows in schedules.values())
                   for index in range(len(ids)))
    triangles = math.ceil(worst("estimatedTrianglesAtOneDegree") * RUNTIME_REFINEMENT_FACTOR)
    return {
        "maxResidentSourceBytes": worst("bytes") * RESIDENT_INTERVAL_MULTIPLE,
        "maxIntervalVertices": math.ceil(triangles * RUNTIME_VERTICES_PER_TRIANGLE),
        "maxIntervalTriangles": triangles,
        "maxEdgeDegrees": 1,
    }


def copy_shipped(staging: Path) -> list[Path]:
    """Replace the published palaeo directory with exactly what ships."""
    # The compiler decides which classes colour a tone table and appear in its
    # interval index; this script decides which class payloads ship. The two
    # lists are the same list, so a drift is a build error rather than a tone
    # table that darkens outlines over geometry the browser never receives.
    # Checked before the published directory is removed, so a mismatch leaves
    # the existing package intact.
    staged_shipped = json.loads(
        (staging / "outline-tones.json").read_text()).get("shippedClasses")
    if staged_shipped != list(SHIPPED_CLASSES):
        raise SystemExit(
            f"the staged tone tables were compiled for classes {staged_shipped}; this script "
            f"publishes {list(SHIPPED_CLASSES)}. Recompile with "
            f"--shipped-classes {','.join(SHIPPED_CLASSES)}.")
    if PALAEO_DIR.exists():
        shutil.rmtree(PALAEO_DIR)
    copied: list[Path] = []
    for class_name in SHIPPED_CLASSES:
        source = staging / class_name
        if not source.is_dir():
            raise SystemExit(f"missing staged class directory: {source}")
        target = PALAEO_DIR / class_name
        target.mkdir(parents=True)
        for path in sorted(source.iterdir()):
            # Only the catalog and the per-interval payloads; a provenance
            # sidecar or an `original` payload in the staging tree is not a
            # build input and must not be copied by accident.
            if not path.is_file() or path.suffix not in {".ehpr", ".json"}:
                continue
            destination = target / path.name
            shutil.copy2(path, destination)
            copied.append(destination)
    for name in ("outline-tones.ehpt", "outline-tones.json"):
        source = staging / name
        if not source.is_file():
            raise SystemExit(f"missing staged tone table: {source}")
        destination = PALAEO_DIR / name
        shutil.copy2(source, destination)
        copied.append(destination)
    return copied


def write_package_section(catalogs: dict[str, dict]) -> dict:
    manifest_path = PUBLIC_PKG / "manifest.json"
    package = json.loads(manifest_path.read_text())
    section = {
        "id": SECTION_ID,
        "ageDomainMa": dict(AGE_DOMAIN_MA),
        "classes": [{
            "surfaceClass": class_name,
            "catalog": asset(PALAEO_DIR / class_name / f"palaeo-{class_name}-catalog.json"),
            "baseColorRgb": BASE_COLOR_RGB[class_name],
        } for class_name in SHIPPED_CLASSES],
        "outlineTones": {
            "catalog": asset(PALAEO_DIR / "outline-tones.json"),
            "binary": asset(PALAEO_DIR / "outline-tones.ehpt"),
        },
        "reservation": reservation(catalogs),
    }
    package["palaeoCoastlines"] = section
    manifest_path.write_bytes(emitter.canonical_json(package))
    return section


def main(staging: Path) -> None:
    catalogs = {name: staged_catalog(staging, name) for name in SHIPPED_CLASSES}
    copied = copy_shipped(staging)
    section = write_package_section(catalogs)
    # One code path owns every digest in the outer inventory, and it re-measures
    # the promoted files rather than copying the numbers written above.
    emitter.refresh_outer_manifest()
    print(json.dumps({
        "files": len(copied),
        "bytes": sum(path.stat().st_size for path in copied),
        "classes": [entry["surfaceClass"] for entry in section["classes"]],
        "intervals": catalogs["lm"]["intervals"]["count"],
        "reservation": section["reservation"],
    }, indent=1))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--staging", type=Path, default=DEFAULT_STAGING,
                        help="compiled staging directory to promote")
    main(parser.parse_args().staging)
