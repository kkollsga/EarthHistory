#!/usr/bin/env python3
"""Generate independent pyGPlates oracles for Cao child-continent ownership."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_MODEL_DIR = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=pathlib.Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--metadata", type=pathlib.Path, default=ROOT / "public/data/cao-continental-motion-v1.json")
    parser.add_argument("--binary", type=pathlib.Path, default=ROOT / "public/data/cao-continental-motion-v1.bin")
    parser.add_argument("--output", type=pathlib.Path, default=ROOT / "src/data/fixtures/cao-continental-probes-v1.json")
    args = parser.parse_args()
    try:
        import pygplates
    except ImportError as error:
        raise SystemExit("pyGPlates >= 1.0 is required") from error

    features = list(pygplates.FeatureCollection(str(args.model_dir / "shapes_continents.gpmlz")))
    rotations = pygplates.RotationModel(str(args.model_dir / "1000_0_rotfile.rot"), default_anchor_plate_id=0)
    probes = []
    for age_ma in (0, 100, 250, 400, 540):
        active_features = [
            feature for feature in features
            if feature.get_reconstruction_plate_id(None) == 0 or rotations.get_rotation(
                age_ma,
                feature.get_reconstruction_plate_id(None),
                anchor_plate_id=0,
                use_identity_for_missing_plate_ids=False,
            ) is not None
        ]
        reconstructed = []
        pygplates.reconstruct(active_features, rotations, reconstructed, age_ma, anchor_plate_id=0)
        partitioner = pygplates.PlatePartitioner(
            reconstructed,
            rotations,
            sort_partitioning_plates=pygplates.SortPartitioningPlates.by_partition_type_then_plate_area,
        )
        polygons = [item.get_reconstructed_geometry() for item in reconstructed
                    if isinstance(item.get_reconstructed_geometry(), pygplates.PolygonOnSphere)]
        coordinates = [(latitude, longitude) for latitude in range(-75, 76, 30) for longitude in range(-165, 166, 30)]
        coordinates += [(89, -179), (89, 0), (89, 179), (-89, -179), (-89, 0), (-89, 179), (0, -179), (0, 179)]
        if age_ma == 250:
            india = rotations.get_rotation(250, 501, anchor_plate_id=0, use_identity_for_missing_plate_ids=False) * pygplates.PointOnSphere(20, 78)
            coordinates.append(india.to_lat_lon())
        for latitude, longitude in coordinates:
            point = pygplates.PointOnSphere(latitude, longitude)
            owner = partitioner.partition_point(point)
            distance = min(pygplates.GeometryOnSphere.distance(point, polygon) for polygon in polygons)
            probes.append({
                "ageMa": age_ma,
                "longitude": round(longitude, 12),
                "latitude": round(latitude, 12),
                "minimumBoundaryDistanceRadians": round(distance, 12),
                "owner": None if owner is None else {
                    "sourceFeatureId": str(owner.get_feature().get_feature_id()),
                    "plateId": owner.get_feature().get_reconstruction_plate_id(None),
                },
            })
    result = {
        "schemaVersion": 1,
        "oracle": "pyGPlates 1.0.0 reconstruct and PlatePartitioner SortPartitioningPlates.by_partition_type_then_plate_area",
        "metadataSha256": digest(args.metadata),
        "binarySha256": digest(args.binary),
        "probes": probes,
    }
    encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    print(f"wrote {args.output} ({len(encoded)} bytes, sha256 {hashlib.sha256(encoded).hexdigest()})")
    print(f"probes {len(probes)}")


if __name__ == "__main__":
    main()
