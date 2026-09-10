#!/usr/bin/env python3
"""Create compact pyGPlates oracle probes for the static PALEOMAP motion asset."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import tempfile
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE = ROOT / "dev-docs/temp/earthhistory-data/paleomap_global_plate_model_v3.zip"
DEFAULT_CATALOG = ROOT / "public/data/paleomap-motion-v1.json"
DEFAULT_OUTPUT = ROOT / "src/data/fixtures/paleomap-motion-probes-v1.json"
EXPECTED_ARCHIVE_SHA256 = "a58409f42bdb5f247e0dd543e8c3287f5d291d5928d0df730af8b2fa1ae7be65"


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_quaternion(rotation) -> list[float]:
    pole, angle = rotation.get_euler_pole_and_angle()
    x, y, z = pole.to_xyz()
    sine = math.sin(angle / 2)
    values = [math.cos(angle / 2), x * sine, y * sine, z * sine]
    if values[0] < 0:
        values = [-value for value in values]
    return [round(value, 12) for value in values]


def active(fragment: dict, age: float) -> bool:
    validity = fragment["validTimeMa"]
    return (validity["oldest"] is None or age <= validity["oldest"]) and (
        validity["youngest"] is None or age >= validity["youngest"]
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-archive", type=pathlib.Path, default=DEFAULT_ARCHIVE)
    parser.add_argument("--catalog", type=pathlib.Path, default=DEFAULT_CATALOG)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    try:
        import pygplates
    except ImportError as error:
        raise SystemExit("pyGPlates >= 1.0 is required") from error

    if sha256(args.model_archive) != EXPECTED_ARCHIVE_SHA256:
        raise SystemExit("unexpected PALEOMAP archive checksum")
    catalog_bytes = args.catalog.read_bytes()
    catalog = json.loads(catalog_bytes)
    fragments_by_plate: dict[int, list[dict]] = {}
    for fragment in catalog["fragments"]:
        fragments_by_plate.setdefault(fragment["plateId"], []).append(fragment)

    with tempfile.TemporaryDirectory(prefix="earthhistory-paleomap-oracle-") as temporary:
        extraction = pathlib.Path(temporary)
        with zipfile.ZipFile(args.model_archive) as source:
            source.extractall(extraction)
        rotation_path = extraction / "PALEOMAP_PlateModel.rot"
        polygon_path = extraction / "PALEOMAP_PlatePolygons.gpml"
        rotation_model = pygplates.RotationModel(str(rotation_path), default_anchor_plate_id=0)

        rotation_probes = []
        for plate_id in sorted(fragments_by_plate):
            exact_and_fractional = None
            for exact_age in range(0, 541, 5):
                fractional_age = exact_age + 2.5 if exact_age < 540 else exact_age - 2.5
                if not any(active(fragment, exact_age) and active(fragment, fractional_age)
                           for fragment in fragments_by_plate[plate_id]):
                    continue
                exact_rotation = rotation_model.get_rotation(
                    exact_age, plate_id, anchor_plate_id=0, use_identity_for_missing_plate_ids=False
                )
                fractional_rotation = rotation_model.get_rotation(
                    fractional_age, plate_id, anchor_plate_id=0, use_identity_for_missing_plate_ids=False
                )
                if exact_rotation is not None and fractional_rotation is not None:
                    exact_and_fractional = [(exact_age, "source-knot"), (fractional_age, "fractional")]
                    break
            if exact_and_fractional is None:
                continue
            for age, kind in exact_and_fractional:
                rotation = rotation_model.get_rotation(
                    age, plate_id, anchor_plate_id=0, use_identity_for_missing_plate_ids=False
                )
                rotation_probes.append({
                    "plateId": plate_id,
                    "ageMa": age,
                    "kind": kind,
                    "quaternionWxyz": canonical_quaternion(rotation),
                })

        # Sequence endpoints are the ages where hierarchy edges can appear or disappear.
        boundary_pairs = {
            (sequence["movingPlateId"], float(age))
            for sequence in catalog["rotationSequences"]
            for age in (sequence["sampleRangeMa"]["youngest"], sequence["sampleRangeMa"]["oldest"])
            if 0 <= age <= 540
        }
        existing = {(probe["plateId"], probe["ageMa"]) for probe in rotation_probes}
        for plate_id, boundary_age in sorted(boundary_pairs):
            for offset, kind in ((-0.001, "circuit-younger-side"), (0, "circuit-boundary"), (0.001, "circuit-older-side")):
                age = round(boundary_age + offset, 6)
                if age < 0 or age > 540 or (plate_id, age) in existing:
                    continue
                rotation = rotation_model.get_rotation(
                    age, plate_id, anchor_plate_id=0, use_identity_for_missing_plate_ids=False
                )
                if rotation is not None:
                    rotation_probes.append({
                        "plateId": plate_id,
                        "ageMa": age,
                        "kind": kind,
                        "quaternionWxyz": canonical_quaternion(rotation),
                    })
                    existing.add((plate_id, age))

        missing_rotation_probes = []
        for plate_id, fragments in sorted(fragments_by_plate.items()):
            for age in range(0, 541, 5):
                if not any(active(fragment, age) for fragment in fragments):
                    continue
                rotation = rotation_model.get_rotation(
                    age, plate_id, anchor_plate_id=0, use_identity_for_missing_plate_ids=False
                )
                if rotation is None:
                    missing_rotation_probes.append({"plateId": plate_id, "ageMa": age})
                    break

        spatial_probes = []
        for age in (0, 5, 100, 250, 400, 540):
            partitioner = pygplates.PlatePartitioner(str(polygon_path), rotation_model, reconstruction_time=age)
            for latitude in range(-75, 76, 30):
                for longitude in range(-165, 166, 30):
                    partition = partitioner.partition_point((latitude, longitude))
                    if partition is None:
                        spatial_probes.append({"ageMa": age, "longitude": longitude, "latitude": latitude})
                    else:
                        feature = partition.get_feature()
                        spatial_probes.append({
                            "ageMa": age,
                            "longitude": longitude,
                            "latitude": latitude,
                            "plateId": feature.get_reconstruction_plate_id(),
                            "sourceFeatureId": str(feature.get_feature_id()),
                        })

    payload = {
        "schemaVersion": 1,
        "oracle": "pyGPlates 1.0.0 RotationModel and PlatePartitioner",
        "modelArchiveSha256": EXPECTED_ARCHIVE_SHA256,
        "catalogSha256": hashlib.sha256(catalog_bytes).hexdigest(),
        "rotationProbes": sorted(rotation_probes, key=lambda item: (item["plateId"], item["ageMa"], item["kind"])),
        "missingRotationProbes": missing_rotation_probes,
        "spatialProbes": spatial_probes,
    }
    encoded = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    print(f"wrote {args.output} ({len(encoded)} bytes, sha256 {hashlib.sha256(encoded).hexdigest()})")
    print(
        f"rotation probes {len(rotation_probes)}, missing rotation probes {len(missing_rotation_probes)}, "
        f"spatial probes {len(spatial_probes)}"
    )


if __name__ == "__main__":
    main()
