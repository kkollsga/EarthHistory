#!/usr/bin/env python3
"""Inventory pinned Cao v2.4 sources before foundation array generation."""

from __future__ import annotations

import collections
import hashlib
import json
import math
from pathlib import Path

import pygplates


ROOT = Path(__file__).resolve().parents[2]
MODEL = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
)
OUT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
)
MEMBERS = {
    "250-0_plate_boundaries.gpml": "4a9f97f6368860e5917f4e6fbf78d6d7c3caf77e1736e854250d067540bb60d4",
    "410-250_plate_boundaries.gpml": "6516dbac4d7928e7ad71244b0bbabc65eb25e6e89dc79d4becb9a82a25a6fc91",
    "1000-410_plate_boundaries.gpml": "488e4b6330e2586fc363a1ad8dada659ac1409742846186fc275a213db306fb1",
    "TopologyBuildingBlocks.gpml": "7603af2502a8d261256f293be71487d28fe5a6b5a8fadd4bdc7845dc67b72297",
    "1000_0_rotfile.rot": "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c",
    "shapes_continents.gpmlz": "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616",
    "shapes_coasts.gpmlz": "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f",
    "static_polygons.gpmlz": "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f",
}
GEOMETRY_MEMBERS = [name for name in MEMBERS if name != "1000_0_rotfile.rot"]
DISPLAY_AGES = list(range(0, 541, 5))


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounded_time(value: float):
    return value if math.isfinite(value) else None


def point_count(geometry) -> int:
    return len(geometry.get_points())


def main() -> None:
    policy = json.loads((OUT / "policy.json").read_text())
    if (
        not policy["writtenBeforeGeneration"]
        or policy["firstStage"] != "catalog-count-and-size-projection-only"
    ):
        raise SystemExit("invalid prewrite policy")
    source_store = ROOT.parent / "EarthHistory-data/palaeomap-study"
    source_store_bytes = sum(
        path.stat().st_size for path in source_store.rglob("*") if path.is_file()
    )
    if source_store_bytes >= policy["sourceStoreMaximumBytes"]:
        raise SystemExit("source store cap already exceeded")

    source_members = []
    collections_result = []
    distinct_plate_ids = set()
    source_point_total = 0
    active_feature_slots = 0
    for name, expected_digest in MEMBERS.items():
        path = MODEL / name
        actual_digest = digest(path)
        if actual_digest != expected_digest:
            raise SystemExit(f"pinned source changed: {name}")
        source_members.append(
            {"path": name, "bytes": path.stat().st_size, "sha256": actual_digest}
        )
        if name not in GEOMETRY_MEMBERS:
            continue
        features = list(pygplates.FeatureCollection(str(path)))
        types = collections.Counter()
        geometry_types = collections.Counter()
        geometry_points = 0
        plate_ids = set()
        valid_slots = 0
        validity_endpoints = set()
        for feature in features:
            types[str(feature.get_feature_type()).split(":")[-1]] += 1
            plate_id = feature.get_reconstruction_plate_id(None)
            if plate_id is not None:
                plate_ids.add(plate_id)
                distinct_plate_ids.add(plate_id)
            oldest, youngest = feature.get_valid_time()
            if math.isfinite(oldest) and 0 <= oldest <= 540:
                validity_endpoints.add(oldest)
            if math.isfinite(youngest) and 0 <= youngest <= 540:
                validity_endpoints.add(youngest)
            valid_slots += sum(youngest <= age <= oldest for age in DISPLAY_AGES)
            for geometry in feature.get_all_geometries():
                geometry_types[type(geometry).__name__] += 1
                geometry_points += point_count(geometry)
        source_point_total += geometry_points
        active_feature_slots += valid_slots
        collections_result.append(
            {
                "path": name,
                "featureCount": len(features),
                "featureTypes": dict(sorted(types.items())),
                "geometryTypes": dict(sorted(geometry_types.items())),
                "sourceGeometryPointCount": geometry_points,
                "plateIdCount": len(plate_ids),
                "activeFeatureDisplaySlots": valid_slots,
                "validityEndpointsInDomainCount": len(validity_endpoints),
            }
        )

    rotation_lines = []
    rotation_times = set()
    moving_plate_ids = set()
    with (MODEL / "1000_0_rotfile.rot").open(errors="replace") as source:
        for line in source:
            values = line.split("!")[0].split()
            if len(values) < 6:
                continue
            try:
                moving_plate_id = int(values[0])
                age = float(values[1])
                int(values[5])
            except ValueError:
                continue
            rotation_lines.append(line.rstrip())
            moving_plate_ids.add(moving_plate_id)
            if 0 <= age <= 540:
                rotation_times.add(age)

    # A source geometry can use virtual-present storage even when that feature
    # is not materially valid at 0 Ma. Validate this independently with a
    # pinned ancient static feature and native reconstruction.
    witness_id = "GPlates-9f445a60-4cda-4bb8-9559-026132c268de"
    witness = next(
        feature
        for feature in pygplates.FeatureCollection(str(MODEL / "static_polygons.gpmlz"))
        if str(feature.get_feature_id()) == witness_id
    )
    witness_age = 450.0
    witness_plate = witness.get_reconstruction_plate_id(None)
    stored_point = witness.get_all_geometries()[0].get_points()[0]
    rotations = pygplates.RotationModel(
        str(MODEL / "1000_0_rotfile.rot"), default_anchor_plate_id=0
    )
    total_rotation = rotations.get_rotation(
        witness_age,
        witness_plate,
        anchor_plate_id=0,
        use_identity_for_missing_plate_ids=False,
    )
    posed_point = total_rotation * stored_point
    reconstructed = []
    pygplates.reconstruct(
        [witness], rotations, reconstructed, witness_age, anchor_plate_id=0
    )
    native_point = reconstructed[0].get_reconstructed_geometry().get_points()[0]
    residual = pygplates.GeometryOnSphere.distance(posed_point, native_point)
    if witness.get_geometry_import_time() != 0 or not residual < 1e-12:
        raise SystemExit("ancient virtual-reference witness failed")

    # Projection deliberately separates canonical material geometry from the
    # much larger and rejected option of duplicating every source vertex at
    # each five-million-year display age.
    canonical_geometry_bytes = source_point_total * 6  # quantized xyz int16
    duplicated_display_geometry_bytes = (
        active_feature_slots * 16
    )  # conservative feature-slot overhead only
    existing_native_assets = []
    for name in (
        "cao-continental-motion-v1.bin",
        "cao-ocean-motion-v1.bin",
        "cao-ocean-lifecycle-v1.bin",
    ):
        path = ROOT / "public/data" / name
        if path.exists():
            existing_native_assets.append(
                {"path": name, "bytes": path.stat().st_size, "sha256": digest(path)}
            )
    public_data_bytes = sum(
        path.stat().st_size
        for path in (ROOT / "public/data").rglob("*")
        if path.is_file()
    )
    result = {
        "schemaVersion": 1,
        "classification": "source inventory and size projection; contains no generated runtime arrays",
        "model": {
            "id": "cao-et-al-2024",
            "version": "2.4",
            "frame": "palaeomagnetic",
            "anchorPlateId": 0,
            "doi": "10.5281/zenodo.13628813",
            "license": "CC-BY-4.0",
            "retrievalDate": "2026-09-09T13:26:07Z",
            "researchDate": "2026-09-10",
            "pygplatesVersion": pygplates.__version__,
        },
        "displayAgesMa": DISPLAY_AGES,
        "sourceMembers": source_members,
        "collections": collections_result,
        "rotationInventory": {
            "recordCount": len(rotation_lines),
            "movingPlateIdCount": len(moving_plate_ids),
            "sourceKnotCountIn0To540": len(rotation_times),
            "sourceKnotAgesMa": sorted(rotation_times),
        },
        "ancientVirtualReferenceWitness": {
            "sourceFeatureId": witness_id,
            "plateId": witness_plate,
            "featureValidTimeMa": [
                bounded_time(value) for value in witness.get_valid_time()
            ],
            "geometryImportTimeMa": witness.get_geometry_import_time(),
            "testAgeMa": witness_age,
            "nativeTotalRotationIdentityFallback": False,
            "angularResidualRad": residual,
            "meaning": "material is inactive at the 0 Ma geometry reference; strict total rotation still poses stored geometry at 450 Ma",
        },
        "totals": {
            "sourceGeometryPointCount": source_point_total,
            "distinctGeometryPlateIdCount": len(distinct_plate_ids),
            "activeFeatureDisplaySlots": active_feature_slots,
        },
        "projection": {
            "canonicalQuantizedDirectionBytes": canonical_geometry_bytes,
            "activeFeatureSlotMetadataFloorBytes": duplicated_display_geometry_bytes,
            "currentPublicDataBytes": public_data_bytes,
            "replaceableLegacyCaoNativeAssetBytes": sum(
                item["bytes"] for item in existing_native_assets
            ),
            "maximumSingleFileBytes": 8 * 1024 * 1024,
            "maximumCompleteDistBytes": 50 * 1024 * 1024,
            "note": "Canonical rigid geometry is stored once and posed through a shared plate/reference-age motion palette. Boundary/topology checkpoint geometry and triangle/index overhead remain to be measured after renderer schema freeze.",
        },
        "existingNativeAssetsForComparisonOnly": existing_native_assets,
        "surfaceSemantics": {
            "shapes_continents.gpmlz": "mixed named source geometry; not a dated exposed-land mask or definitive crust classifier",
            "shapes_coasts.gpmlz": "source features named Coastline plus other native types; model-derived geometry, not independently observed palaeoshorelines",
            "static_polygons.gpmlz": "static plate/fragment geometry for reconstruction ownership; not exposed land",
        },
    }
    encoded = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
    if len(encoded) > 512 * 1024:
        raise SystemExit("inventory output cap exceeded")
    output = OUT / "source-inventory.json"
    prior = output.stat().st_size if output.exists() else 0
    stage_bytes = (
        sum(path.stat().st_size for path in OUT.rglob("*") if path.is_file())
        - prior
        + len(encoded)
    )
    if stage_bytes > policy["stageMaximumBytes"]:
        raise SystemExit("stage cap exceeded")
    output.write_bytes(encoded)
    print(
        json.dumps(
            {
                "bytes": len(encoded),
                "stageBytes": stage_bytes,
                "sourcePoints": source_point_total,
            }
        )
    )


if __name__ == "__main__":
    main()
