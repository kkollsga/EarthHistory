#!/usr/bin/env python3
"""Bounded Cao 5->0 Ma material-point continuity preflight."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODEL = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
OUTPUT = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/ocean"
FILES = ("250-0_plate_boundaries.gpml", "410-250_plate_boundaries.gpml", "1000-410_plate_boundaries.gpml", "TopologyBuildingBlocks.gpml")
ROTATION = "1000_0_rotfile.rot"
SOURCE_AGE = 5.0
AGES = tuple(float(age) for age in range(5, -1, -1))
OFFSET_KM = 25.0
EARTH_KM = 6371.0088
MAX_BYTES = 4 * 1024 * 1024
PROGRAM_MAX_BYTES = 32 * 1024 * 1024
SOURCE_MAX_BYTES = 4 * 1024 * 1024 * 1024
PINNED = {
    "250-0_plate_boundaries.gpml": "4a9f97f6368860e5917f4e6fbf78d6d7c3caf77e1736e854250d067540bb60d4",
    "410-250_plate_boundaries.gpml": "6516dbac4d7928e7ad71244b0bbabc65eb25e6e89dc79d4becb9a82a25a6fc91",
    "1000-410_plate_boundaries.gpml": "488e4b6330e2586fc363a1ad8dada659ac1409742846186fc275a213db306fb1",
    "TopologyBuildingBlocks.gpml": "7603af2502a8d261256f293be71487d28fe5a6b5a8fadd4bdc7845dc67b72297",
    "1000_0_rotfile.rot": "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c",
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def tree_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def unit(values):
    length = math.sqrt(sum(value * value for value in values))
    return tuple(value / length for value in values)


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def midpoint_and_sides(pygplates, points):
    # Deterministic midpoint of the longest vertex-to-vertex edge, away from nodes.
    edges = []
    for index, (left, right) in enumerate(zip(points, points[1:])):
        angle = math.acos(max(-1.0, min(1.0, dot(left.to_xyz(), right.to_xyz()))))
        edges.append((angle, -index, left, right))
    angle, _, left, right = max(edges)
    if angle <= 2 * OFFSET_KM / EARTH_KM:
        return None
    a, b = left.to_xyz(), right.to_xyz()
    centre = unit(tuple(x + y for x, y in zip(a, b)))
    projection = dot(b, centre)
    tangent = unit(tuple(value - projection * c for value, c in zip(b, centre)))
    normal = unit(cross(centre, tangent))
    offset = OFFSET_KM / EARTH_KM
    sides = []
    for sign in (-1, 1):
        xyz = tuple(math.cos(offset) * c + sign * math.sin(offset) * n for c, n in zip(centre, normal))
        sides.append(pygplates.PointOnSphere(xyz))
    return pygplates.PointOnSphere(centre), sides


def identity(topology):
    feature = topology.get_feature()
    return {"featureId": str(feature.get_feature_id()), "plateId": feature.get_reconstruction_plate_id(None)}


def owners(point, resolved):
    return sorted((identity(item) for item in resolved
                   if hasattr(item, "get_resolved_boundary") and item.get_resolved_boundary().is_point_in_polygon(point)),
                  key=lambda value: (value["featureId"], value["plateId"] or -1))


def validate_seed_ids(actual):
    expected = [f"ridge-{ridge}-side-{side}" for ridge in range(2) for side in range(2)]
    if actual != expected:
        raise ValueError("material seed identity/order mismatch")


def resolve(pygplates, features, rotations, age):
    resolved, sections = [], []
    pygplates.resolve_topologies(features, rotations, resolved, age, sections, anchor_plate_id=0)
    return resolved, sections


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, default=MODEL)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    args = parser.parse_args()
    policy_path = args.output_dir / "trial-policy.json"
    if not policy_path.is_file():
        raise SystemExit("frozen trial-policy.json must exist before execution")
    policy = json.loads(policy_path.read_text())
    expected = {"schemaVersion": 1, "sourceAgeMa": SOURCE_AGE, "traceAgesMa": list(AGES),
                "maximumRidgeSegments": 2, "seedsPerSegment": 2, "offsetKm": OFFSET_KM,
                "snapshotCacheSize": 3, "maximumOutputBytes": MAX_BYTES}
    if policy != expected:
        raise SystemExit("trial policy does not match runner constants")

    study_root = ROOT.parent / "EarthHistory-data/palaeomap-study"
    program_root = args.output_dir.parent
    if tree_bytes(study_root) > SOURCE_MAX_BYTES:
        raise SystemExit("source study exceeds 4 GiB bound")
    if tree_bytes(program_root) > PROGRAM_MAX_BYTES:
        raise SystemExit("reconstruction-machinery-v1 exceeds 32 MiB bound")
    for name, expected_hash in PINNED.items():
        if sha(args.model_dir / name) != expected_hash:
            raise SystemExit(f"source hash mismatch: {name}")

    import pygplates
    features = []
    for name in FILES:
        features.extend(pygplates.FeatureCollection(str(args.model_dir / name)))
    rotations = pygplates.RotationModel(str(args.model_dir / ROTATION), default_anchor_plate_id=0)
    resolved5, sections = resolve(pygplates, features, rotations, SOURCE_AGE)
    candidates = []
    for section in sections:
        if section.get_feature().get_feature_type() != pygplates.FeatureType.gpml_mid_ocean_ridge:
            continue
        for sub_index, shared in enumerate(section.get_shared_sub_segments()):
            points = shared.get_resolved_geometry_points()
            sample = midpoint_and_sides(pygplates, points)
            sharing = sorted((identity(item) for item in shared.get_sharing_resolved_topologies()), key=lambda x: (x["featureId"], x["plateId"] or -1))
            if sample is None or len(sharing) != 2:
                continue
            centre, sides = sample
            side_owners = [owners(point, resolved5) for point in sides]
            if any(len(value) != 1 for value in side_owners) or side_owners[0] == side_owners[1]:
                continue
            geometry_length = sum(math.acos(max(-1, min(1, dot(a.to_xyz(), b.to_xyz())))) for a, b in zip(points, points[1:]))
            candidates.append((geometry_length, str(section.get_feature().get_feature_id()), sub_index,
                               centre, sides, sharing, side_owners))
    candidates.sort(key=lambda value: (-value[0], value[1], value[2]))
    selected = candidates[:2]
    seeds = [point for candidate in selected for point in candidate[4]]
    model = pygplates.TopologicalModel(features, rotations, anchor_plate_id=0, topological_snapshot_cache_size=3)
    span = (model.reconstruct_geometry(seeds, SOURCE_AGE, oldest_time=SOURCE_AGE, youngest_time=0,
                                       time_increment=1) if len(seeds) == 4 else None)
    records = []
    points_by_age = ({age: (span.get_geometry_points(age, return_inactive_points=True) or [None] * len(seeds)) for age in AGES}
                     if span is not None else {})
    reverse_points_by_age = ({age: (span.get_geometry_points(age, return_inactive_points=True) or [None] * len(seeds)) for age in reversed(AGES)}
                             if span is not None else {})
    resolved_by_age = {age: resolve(pygplates, features, rotations, age)[0] for age in AGES}
    query_order_equal = True
    for seed_index, seed in enumerate(seeds):
        states = []
        for age in AGES:
            point = points_by_age[age][seed_index]
            reverse_point = reverse_points_by_age[age][seed_index]
            query_order_equal &= ((point is None and reverse_point is None) or
                                  (point is not None and reverse_point is not None and
                                   pygplates.GeometryOnSphere.distance(point, reverse_point) <= 1e-12))
            resolved = resolved_by_age[age]
            point_owners = owners(point, resolved) if point is not None else []
            circuit = (rotations.get_rotation(age, point_owners[0]["plateId"], anchor_plate_id=0,
                                               use_identity_for_missing_plate_ids=False)
                       if len(point_owners) == 1 else None)
            state_status = ("supported" if point is not None and len(point_owners) == 1 and circuit is not None
                            else "inactive" if point is None else "ambiguous-or-missing-circuit")
            states.append({"ageMa": age, "active": point is not None, "status": state_status,
                           "latLon": list(point.to_lat_lon()) if point is not None else None,
                           "owners": point_owners})
        records.append({"seedId": f"ridge-{seed_index // 2}-side-{seed_index % 2}",
                        "initialLatLon": list(seed.to_lat_lon()), "states": states})

    ids = [record["seedId"] for record in records]
    if len(selected) == 2:
        validate_seed_ids(ids)
    mutation_drop_rejected = mutation_swap_rejected = False
    if len(selected) == 2:
        try:
            validate_seed_ids(ids[:-1])
        except ValueError:
            mutation_drop_rejected = True
        swapped = list(ids)
        swapped[0], swapped[1] = swapped[1], swapped[0]
        try:
            validate_seed_ids(swapped)
        except ValueError:
            mutation_swap_rejected = True
    status = "resolved" if len(selected) == 2 and len(records) == 4 else "unsupported-insufficient-source-ridges"
    result = {
        "schemaVersion": 1, "status": status, "policySha256": sha(policy_path),
        "researchDate": "2026-09-10",
        "model": {"id": "cao-et-al-2024", "version": "2.4", "referenceFrame": "palaeomagnetic",
                  "anchorPlateId": 0, "source": "https://doi.org/10.5281/zenodo.13628813",
                  "license": "CC-BY-4.0", "retrievalDate": "2026-09-09T13:26:07Z", "pyGPlatesVersion": pygplates.__version__},
        "sourceMembers": [{"path": name, "sha256": sha(args.model_dir / name)} for name in (*FILES, ROTATION)],
        "selection": [{"ridgeFeatureId": item[1], "sharedSubSegmentIndex": item[2],
                       "lengthRadians": item[0], "sourceSharingTopologies": item[5],
                       "seedOwnersAt5Ma": item[6]} for item in selected],
        "particles": records,
        "counts": {"eligibleRidgeSegments": len(candidates), "selectedRidgeSegments": len(selected),
                   "particles": len(records), "activeStates": sum(s["active"] for r in records for s in r["states"]),
                   "inactiveStates": sum(not s["active"] for r in records for s in r["states"]),
                   "supportedStates": sum(s["status"] == "supported" for r in records for s in r["states"]),
                   "ambiguousOrMissingCircuitStates": sum(s["status"] == "ambiguous-or-missing-circuit" for r in records for s in r["states"])},
        "checks": {"queryOrderDeterministic": query_order_equal,
                   "allStatesUniquelyOwned": all(len(state["owners"]) == 1 for record in records for state in record["states"] if state["active"]),
                   "plateOwnershipStable": all(len({state["owners"][0]["plateId"] for state in record["states"] if state["active"] and len(state["owners"]) == 1}) == 1 for record in records)},
        "mutation": {"dropSeedIdRejected": mutation_drop_rejected, "swapSeedOrderRejected": mutation_swap_rejected},
        "epistemicStatus": "model-seeded bounded material-point trace; offset seeds are generated controls, not exact ridge births",
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    encoded = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
    existing_other = sum(path.stat().st_size for path in args.output_dir.iterdir() if path.is_file() and path.name != "summary.json")
    if existing_other + len(encoded) > MAX_BYTES or tree_bytes(program_root) - ((args.output_dir / "summary.json").stat().st_size if (args.output_dir / "summary.json").exists() else 0) + len(encoded) > PROGRAM_MAX_BYTES:
        raise SystemExit("owned output exceeds 4 MiB")
    (args.output_dir / "summary.json").write_bytes(encoded)
    print(json.dumps({"status": status, **result["counts"], "bytes": len(encoded)}, sort_keys=True))


if __name__ == "__main__":
    main()
