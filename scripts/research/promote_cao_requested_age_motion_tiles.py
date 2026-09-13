#!/usr/bin/env python3
"""Promote a validated requested-age motion tile stage with replace-only writes."""

from __future__ import annotations

import argparse
import copy
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import emit_cao_requested_age_motion_tiles as emitter  # noqa: E402
import validate_cao_requested_age_motion_tiles as validator  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
OUTER_MANIFEST = ROOT / "public/data/manifest.json"


def replace_copy(source: Path, destination: Path) -> None:
    if source.is_symlink() or destination.is_symlink():
        raise validator.ValidationError("tile promotion refuses symlink inputs or targets")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".requested-age-promote")
    with source.open("rb") as reader, temporary.open("wb") as writer:
        shutil.copyfileobj(reader, writer, 1024 * 1024)
        writer.flush()
        os.fsync(writer.fileno())
    os.replace(temporary, destination)


def expected_outer_manifest(stage: Path, staged_manifest: Path) -> dict:
    outer = json.loads(OUTER_MANIFEST.read_text())
    foundation = outer["inputs"]["cao-reconstruction-foundation-v2"]
    tile_paths = [stage / "index.json", *sorted(stage.glob("tile-*.ehmt"))]
    new_paths = {
        f"public/data/reconstruction/cao-v2.4/motion-tiles/{path.name}": path
        for path in tile_paths
    }
    package_manifest_path = "public/data/reconstruction/cao-v2.4/manifest.json"
    outputs = []
    for row in foundation["outputs"]:
        path = row["path"]
        if path in new_paths:
            continue
        updated = copy.deepcopy(row)
        if path == package_manifest_path:
            updated.update({
                "bytes": staged_manifest.stat().st_size,
                "sha256": emitter.sha256(staged_manifest),
            })
        outputs.append(updated)
    for path, source in new_paths.items():
        outputs.append({
            "role": str(source.relative_to(stage)),
            "path": path,
            "sha256": emitter.sha256(source),
            "bytes": source.stat().st_size,
        })
    foundation["outputs"] = sorted(outputs, key=lambda row: row["path"])
    transport = (
        " Optional requested-age motion tiles copy exact records from the unchanged full "
        "palette for first-frame transport; they add no scientific geometry or motion."
    )
    if transport.strip() not in foundation["processing"]:
        foundation["processing"] += transport
    return outer


def promote(stage: Path, staged_manifest: Path, public: Path) -> dict:
    stage = stage.resolve()
    staged_manifest = staged_manifest.resolve()
    public = public.resolve()
    if public != emitter.PUBLIC or stage == public / "motion-tiles":
        raise validator.ValidationError("promotion requires an isolated stage and the canonical public package")
    report = validator.validate(public, stage, staged_manifest)
    staged_package = staged_manifest.read_bytes()
    expected_package = emitter.canonical(emitter.staged_manifest(
        emitter.load_source(public, emitter.load_contract()), stage / "index.json"))
    if staged_package != expected_package:
        raise validator.ValidationError("staged package manifest changed after validation")
    outer = expected_outer_manifest(stage, staged_manifest)
    public_tiles = public / "motion-tiles"
    expected_names = {path.name for path in stage.iterdir() if path.is_file()}
    if public_tiles.exists():
        unexpected = {path.name for path in public_tiles.iterdir() if path.is_file()} - expected_names
        if unexpected:
            raise validator.ValidationError("public tile directory contains an unrelated file")

    # Payloads become reachable only when the package manifest is replaced below.
    for source in sorted(path for path in stage.iterdir() if path.is_file()):
        replace_copy(source, public_tiles / source.name)
    emitter.write_atomic(public / "manifest.json", staged_package)
    emitter.write_atomic(OUTER_MANIFEST, json.dumps(outer, ensure_ascii=False,
                                                     indent=2).encode() + b"\n")
    public_report = validator.validate(public, public_tiles, public / "manifest.json")
    if public_report != report:
        raise validator.ValidationError("public requested-age tile validation differs from stage")
    return {
        **public_report,
        "packageManifestSha256": emitter.sha256(public / "manifest.json"),
        "outerManifestSha256": emitter.sha256(OUTER_MANIFEST),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True,
                        help="validated directory containing index.json and all EHMT files")
    parser.add_argument("--manifest", type=Path, required=True,
                        help="validated staged package manifest")
    parser.add_argument("--apply", action="store_true",
                        help="perform the public replace-only promotion")
    args = parser.parse_args()
    if not args.apply:
        print(json.dumps(validator.validate(emitter.PUBLIC, args.stage, args.manifest), sort_keys=True))
        return
    print(json.dumps(promote(args.stage, args.manifest, emitter.PUBLIC), sort_keys=True))


if __name__ == "__main__":
    main()
