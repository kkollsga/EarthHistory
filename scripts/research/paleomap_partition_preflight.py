#!/usr/bin/env python3
"""Coarse ownership/circuit preflight for PALEOMAP v19o_r1d."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT.parent / "EarthHistory-data/palaeomap-study/geography/paleomap-global-plate-model-v19o-r1d.zip"
OUTPUT = ROOT / "docs/research/reconstruction-paleomap-partition-preflight.json"
AGES = (0.0, 450.0, 540.0)
MEMBERS = {
    "plate": "Scotese_Plate_Polygons__forPgeog_v19o_v240506.gpml",
    "ocean": "Scotese_OceansOnly.gpmlz",
    "rotation": "Scotese_Plate_Model_forPgeog_v19o_r1d_v240506a.rot",
}
PINNED_ARCHIVE_SHA256 = "aee07c0d0159864f7a058cbf1591263ae4ee1413ccd2ec96a76cbb60ab7c6079"
PINNED_MEMBER_SHA256 = {
    "plate": "0a07008e2bdc23d8cfd37623a74e0eb31d336fa2c5d311a8d493b05bc4746e74",
    "ocean": "781e3d06c2e36ba889228ec067ee69eb30e1b16227c23d8b22a753589cdb8562",
    "rotation": "61f5ff155925126530569f4af6b0d5fca2ef52f771fce720928c1c996863c768",
}
MAX_EXTRACTED_BYTES = 10 * 1024 * 1024


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, default=ARCHIVE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    import pygplates

    if sha(args.archive.read_bytes()) != PINNED_ARCHIVE_SHA256:
        raise SystemExit("input archive does not match pinned PALEOMAP v19o_r1d")

    with zipfile.ZipFile(args.archive) as archive:
        names = archive.namelist()
        payload = {}
        source_names = {}
        for label, suffix in MEMBERS.items():
            matches = [name for name in names if name.endswith(suffix)]
            if len(matches) != 1:
                raise SystemExit(f"expected one {suffix}, found {len(matches)}")
            source_names[label] = matches[0]
            payload[label] = archive.read(matches[0])
    if sum(map(len, payload.values())) > MAX_EXTRACTED_BYTES:
        raise SystemExit("temporary extracted members exceed 10 MiB")
    for label, expected in PINNED_MEMBER_SHA256.items():
        if sha(payload[label]) != expected:
            raise SystemExit(f"source member hash mismatch: {label}")

    with tempfile.TemporaryDirectory() as temporary:
        directory = Path(temporary)
        paths = {}
        for label, data in payload.items():
            paths[label] = directory / Path(source_names[label]).name
            paths[label].write_bytes(data)
        rotations = pygplates.RotationModel(str(paths["rotation"]), default_anchor_plate_id=0)
        feature_sets = {label: list(pygplates.FeatureCollection(str(paths[label]))) for label in ("plate", "ocean")}
        points = [pygplates.PointOnSphere(latitude, longitude)
                  for latitude in range(-87, 88, 5) for longitude in range(-177, 178, 5)]
        results = []
        for age in AGES:
            age_sets = {}
            for label, features in feature_sets.items():
                reconstructed = []
                pygplates.reconstruct(features, rotations, reconstructed, age, anchor_plate_id=0)
                polygons = []
                plate_ids = set()
                for item in reconstructed:
                    geometry = item.get_reconstructed_geometry()
                    if isinstance(geometry, pygplates.PolygonOnSphere):
                        polygons.append(geometry)
                        plate_ids.add(item.get_feature().get_reconstruction_plate_id(None))
                counts = {"uncovered": 0, "unique": 0, "multiple": 0}
                maximum = 0
                for point in points:
                    hits = sum(polygon.is_point_in_polygon(point) for polygon in polygons)
                    counts["uncovered" if hits == 0 else "unique" if hits == 1 else "multiple"] += 1
                    maximum = max(maximum, hits)
                missing = sorted(plate_id for plate_id in plate_ids if
                                 rotations.get_rotation(age, plate_id, anchor_plate_id=0,
                                                        use_identity_for_missing_plate_ids=False) is None)
                age_sets[label] = {"activeReconstructedFeatures": len(reconstructed),
                                   "polygonGeometries": len(polygons), "ownershipPointCounts": counts,
                                   "maximumOverlapCount": maximum, "activePlateIdCount": len(plate_ids),
                                   "strictCircuitMissingPlateIds": missing}
            combined = []
            for label, features in feature_sets.items():
                reconstructed = []
                pygplates.reconstruct(features, rotations, reconstructed, age, anchor_plate_id=0)
                combined.extend(item.get_reconstructed_geometry() for item in reconstructed
                                if isinstance(item.get_reconstructed_geometry(), pygplates.PolygonOnSphere))
            counts = {"uncovered": 0, "unique": 0, "multiple": 0}
            maximum = 0
            for point in points:
                hits = sum(polygon.is_point_in_polygon(point) for polygon in combined)
                counts["uncovered" if hits == 0 else "unique" if hits == 1 else "multiple"] += 1
                maximum = max(maximum, hits)
            results.append({"ageMa": age, "sets": age_sets,
                            "combinedOwnershipPointCounts": counts, "combinedMaximumOverlapCount": maximum})

    result = {"schemaVersion": 1, "researchDate": "2026-09-10",
              "source": {"record": "https://doi.org/10.5281/zenodo.10659112",
                         "version": "v19o_r1d/v24221", "license": "CC-BY-4.0",
                         "retrievalDate": "2026-09-09",
                         "archiveSha256": sha(args.archive.read_bytes()),
                         "members": {label: {"path": source_names[label], "sha256": sha(data)}
                                     for label, data in payload.items()}},
              "frame": "PALEOMAP native reconstruction frame; anchor plate 0",
              "runtime": {"pyGPlatesVersion": pygplates.__version__,
                          "temporaryExtractionMaximumBytes": MAX_EXTRACTED_BYTES,
                          "temporaryExtractionOwner": "system TemporaryDirectory; deleted on runner exit"},
              "sample": {"agesMa": list(AGES), "latitudeDegrees": "-87..87 step 5",
                         "longitudeDegrees": "-177..177 step 5", "pointCount": len(points),
                         "warning": "regular latitude-longitude point counts are a coarse coverage falsification, not spherical area fractions"},
              "results": results,
              "interpretation": "Neither set nor their union is a complete uniquely owned whole-Earth partition at all sampled ages; strict-circuit omissions are reported separately from geometric gaps."}
    encoded = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
    if len(encoded) > 32 * 1024:
        raise SystemExit("result exceeds 32 KiB")
    args.output.write_bytes(encoded)
    print(f"wrote {args.output} ({len(encoded)} bytes)")


if __name__ == "__main__":
    main()
