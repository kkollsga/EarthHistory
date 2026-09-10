#!/usr/bin/env python3
"""Generate independent pyGPlates probes for the compact Cao ocean controls."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_MODEL_DIR = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
DEFAULT_METADATA = ROOT / "public/data/cao-ocean-motion-v1.json"
DEFAULT_BINARY = ROOT / "public/data/cao-ocean-motion-v1.bin"
DEFAULT_OUTPUT = ROOT / "src/data/fixtures/cao-ocean-probes-v1.json"
BOUNDARY_FILES = ["250-0_plate_boundaries.gpml", "410-250_plate_boundaries.gpml", "1000-410_plate_boundaries.gpml", "TopologyBuildingBlocks.gpml"]


def digest(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def quaternion(rotation) -> list[float]:
    pole, angle = rotation.get_euler_pole_and_angle()
    x, y, z = pole.to_xyz()
    sine = math.sin(angle / 2)
    values = [math.cos(angle / 2), x * sine, y * sine, z * sine]
    if values[0] < 0:
        values = [-value for value in values]
    return [round(value, 12) for value in values]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=pathlib.Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--metadata", type=pathlib.Path, default=DEFAULT_METADATA)
    parser.add_argument("--binary", type=pathlib.Path, default=DEFAULT_BINARY)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    try:
        import pygplates
    except ImportError as error:
        raise SystemExit("pyGPlates >= 1.0 is required") from error

    metadata = json.loads(args.metadata.read_text())
    rotation_model = pygplates.RotationModel(str(args.model_dir / "1000_0_rotfile.rot"), default_anchor_plate_id=0)
    topology_features = []
    for name in BOUNDARY_FILES:
        topology_features.extend(pygplates.FeatureCollection(str(args.model_dir / name)))
    continent_features = list(pygplates.FeatureCollection(str(args.model_dir / "shapes_continents.gpmlz")))

    active_plate_ages: dict[int, list[float]] = {}
    for record in metadata["ages"]:
        for slot in record["topologySlots"]:
            active_plate_ages.setdefault(slot["plateId"], []).append(record["ageMa"])
    rotation_probes = []
    for plate_id, active_ages in sorted(active_plate_ages.items()):
        exact = active_ages[len(active_ages) // 2]
        for age, kind in ((exact, "native-age"), (min(539.5, exact + 2.5), "fractional-age")):
            rotation = rotation_model.get_rotation(age, plate_id, anchor_plate_id=0, use_identity_for_missing_plate_ids=False)
            if rotation is not None:
                rotation_probes.append({"plateId": plate_id, "ageMa": age, "kind": kind, "quaternionWxyz": quaternion(rotation)})

    spatial_probes = []
    for age in (0, 100, 250, 540):
        resolved = []
        pygplates.resolve_topologies(topology_features, rotation_model, resolved, age, anchor_plate_id=0)
        boundaries = sorted(
            [item for item in resolved if isinstance(item, pygplates.ResolvedTopologicalBoundary)],
            key=lambda item: str(item.get_feature().get_feature_id()),
        )
        reconstructed_continents = []
        pygplates.reconstruct(continent_features, rotation_model, reconstructed_continents, age, anchor_plate_id=0)
        continent_partitioner = pygplates.PlatePartitioner(reconstructed_continents, rotation_model)
        coordinates = [(latitude, longitude) for latitude in range(-75, 76, 30) for longitude in range(-165, 166, 30)]
        coordinates += [(89, -179), (89, 0), (89, 179), (-89, -179), (-89, 0), (-89, 179), (0, -179), (0, 179)]
        for latitude, longitude in coordinates:
            point = pygplates.PointOnSphere(latitude, longitude)
            hits = [
                {"sourceFeatureId": str(item.get_feature().get_feature_id()), "plateId": item.get_feature().get_reconstruction_plate_id(None)}
                for item in boundaries if item.get_resolved_boundary().is_point_in_polygon(point)
            ]
            minimum_boundary_distance = min(
                pygplates.GeometryOnSphere.distance(point, item.get_resolved_boundary()) for item in boundaries
            )
            spatial_probes.append({
                "ageMa": age,
                "longitude": longitude,
                "latitude": latitude,
                "hits": hits,
                "minimumBoundaryDistanceRadians": round(minimum_boundary_distance, 12),
                "continental": continent_partitioner.partition_point(point) is not None,
            })

    result = {
        "schemaVersion": 1,
        "oracle": "pyGPlates 1.0.0 RotationModel, resolve_topologies, and reconstructed shapes_continents",
        "metadataSha256": digest(args.metadata),
        "binarySha256": digest(args.binary),
        "rotationProbes": rotation_probes,
        "spatialProbes": spatial_probes,
    }
    encoded = (json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n").encode()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    print(f"wrote {args.output} ({len(encoded)} bytes, sha256 {hashlib.sha256(encoded).hexdigest()})")
    print(f"rotation probes {len(rotation_probes)}, spatial probes {len(spatial_probes)}")


if __name__ == "__main__":
    main()
