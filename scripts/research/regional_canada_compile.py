#!/usr/bin/env python3
"""Compile the source-qualified Northern Canada material correction candidate."""

from __future__ import annotations

import hashlib
import json
import math
import struct
from collections import defaultdict
from pathlib import Path

try:
    import pygplates
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import MultiPolygon, Polygon, mapping, shape
    from shapely.ops import transform, unary_union
    from shapely.validation import make_valid
except ImportError as error:  # pragma: no cover - environment diagnostic
    raise SystemExit(
        "regional_canada_compile.py requires pygplates, pyshp, pyproj, and shapely"
    ) from error


ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = ROOT.parent / "EarthHistory-data/palaeomap-study/regional-corrections/canada"
COMPLETION_SOURCE_ROOT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/regional-corrections/canada-completion"
)
MODEL_ROOT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
)
STAGED_ROOT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
)
OUTPUT_ROOT = ROOT / "data/corrections/canada"
VALIDATION_PATH = ROOT / "docs/research/regional-canada-franklinian-validation.json"
SHAPEFILE = SOURCE_ROOT / "source-members/Data/SHP/Bedrock/Mapunits.shp"
SOURCE_COLLECTION_SHA = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"
ROTATION_SHA = "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f"
TOPOLOGY_SHA = "411bd3e5e5a2004ea42792a5c1be11942a46b52e3657efdb06507c147fbfdf1a"
COB_SHA = "cfcea20c5244613e53ad4b9cdf6411d79ff535c25af335b4fa6eb9251377d4bd"
LAURENTIA_ACOB_ID = "GPlates-a11dc09a-42de-4b11-a6ce-d30baae64ce4"
LAURENTIA_ACOB_SOURCE_ORDER = 1284
LAURENTIA_ACOB_YOUNGEST_MA = 410.1
GEOMETRY_HASH_DOMAIN = b"earthhistory-cao-staged-geometry-f32le-xyz-rings-v1\0"
SOURCE_AGGREGATE_DOMAIN = b"earthhistory-cgm80-selected-members-v1\0"
COMPLETION_SOURCE_AGGREGATE_DOMAIN = b"earthhistory-arctic-map-2159a-canada-members-v1\0"
EARTH_KM = 6371.0088
REFERENCE_AGE_MA = 410.0
QUALIFIED_OLDEST_MA = 430.0
PRODUCT_OLDEST_MA = 540.0
INSET_METRES = 0.0
SIMPLIFY_METRES = 5000.0
MIN_COMPONENT_AREA_SQUARE_METRES = 25_000_000.0
CONTAINMENT_TOLERANCE_SQUARE_METRES = 1.0
MAX_SIMPLIFICATION_AREA_CHANGE_FRACTION = 0.10
MAX_SIMPLIFIED_OUTSIDE_SOURCE_FRACTION = 0.06

TARGETS = {
    "GPlates-0bde4fc7-5415-42c0-b8dc-3e10a0ffbdda": (120, "Canadian Arctic Islands North"),
    "GPlates-aabe8357-8489-4f8e-8936-e7e6f6fcc84c": (141, "Canadian Arctic Islands South"),
    "GPlates-26838120-dc5d-42da-9bdf-ca3e5e9c3692": (122, "South-Central Ellesmere Island"),
    "GPlates-e0621848-530c-45e9-988a-3e063fbae938": (123, "North-Central Ellesmere Island"),
}
PEARYA_ID = "GPlates-07112260-c9aa-4713-b989-5c25cd1c6045"

DIRECT_SETTINGS = {
    "ARCTIC PLATFORM",
    "FRANKLIN LARGE IGNEOUS PROVINCE",
    "Franklinian rift",
    "Franklinian shelf, ARCTIC PLATFORM",
}
COVER_SETTINGS = {
    "Arctic Plaform cover",
    "Banks-Eglinton basin",
    "Bache uplift cover",
    "BOOTHIA UPLIFT",
    "Boothia uplift cover",
    "Ellesmerian foredeep",
    "Ellesmerian foreland",
    "Ellesmerian foreland, ELLESMERIAN OROGEN",
    "EUREKAN OROGEN, Eurekan foreland",
    "Eurekan foreland",
    "Eurekan orogen cover",
    "High Arctic large igneous province",
    "Nansen shelf, SVERDRUP BASIN",
    "PRINCESS MARGARET ARCH",
    "SVERDRUP BASIN, BANKS-EGLINTON BASIN, HIGH ARCTIC LARGE IGNEOUS PROVINCE",
    "Sverdrup rift, SVERDRUP BASIN",
    "Sverdrup deep water basin",
    "Sverdrup shelf",
    "Sverdrup shelf, SVERDRUP BASIN",
    "Sverdrup shelf, SVERDRUP BASIN, BANKS-EGLINTON BASIN",
}


class BuildError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def verify_selection_policy(direct: set[str], cover: set[str]) -> None:
    if not direct or not cover or direct & cover:
        raise BuildError("selection tiers must be nonempty and disjoint")
    for value in direct | cover:
        upper = value.upper()
        if (
            "PEARYA" in upper
            or ("DEEP WATER" in upper and value != "Sverdrup deep water basin")
            or "GLACIER" in upper
        ):
            raise BuildError(f"forbidden material setting in selection policy: {value}")


def polygonal(geometry):
    geometry = make_valid(geometry)
    if isinstance(geometry, Polygon):
        return geometry
    if isinstance(geometry, MultiPolygon):
        return geometry
    polygons = []
    for child in getattr(geometry, "geoms", []):
        if isinstance(child, Polygon):
            polygons.append(child)
        elif isinstance(child, MultiPolygon):
            polygons.extend(child.geoms)
    if not polygons:
        return MultiPolygon([])
    return unary_union(polygons)


def drop_tiny_components(geometry, minimum_area: float):
    rows = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    return polygonal(unary_union([row for row in rows if row.area >= minimum_area]))


def target_hash(patch: dict, directions: bytes) -> str:
    digest = hashlib.sha256(GEOMETRY_HASH_DOMAIN)
    for ring in patch["rings"]:
        count = ring["count"]
        start = ring["offset"] * 12
        payload = directions[start : start + count * 12]
        if count < 3 or len(payload) != count * 12:
            raise BuildError(f"invalid staged ring for {patch['patchId']}")
        digest.update(struct.pack("<I", count))
        digest.update(payload)
    return digest.hexdigest()


def pygplates_polygon_to_lon_lat(geometry) -> Polygon:
    rings = []
    source_rings = [geometry.get_exterior_ring_points()] + [
        geometry.get_interior_ring_points(index)
        for index in range(geometry.get_number_of_interior_rings())
    ]
    for ring in source_rings:
        rings.append([(point.to_lat_lon()[1], point.to_lat_lon()[0]) for point in ring])
    return polygonal(Polygon(rings[0], rings[1:]))


def load_targets(projected_crs: str):
    if sha256((MODEL_ROOT / "shapes_coasts.gpmlz").read_bytes()) != SOURCE_COLLECTION_SHA:
        raise BuildError("pinned Cao coastline source changed")
    staged = json.loads((STAGED_ROOT / "coast-patches.json").read_text())
    directions = (STAGED_ROOT / "coast-reference-directions.f32").read_bytes()
    if sha256(directions) != staged["geometry"]["directions"]["sha256"]:
        raise BuildError("staged direction catalog mismatch")
    patches = {row["patchId"]: row for row in staged["patches"]}
    forward = Transformer.from_crs("EPSG:4326", projected_crs, always_xy=True)
    cohort_geometries = defaultdict(list)
    target_rows = defaultdict(list)
    pearya = []
    pearya_rows = []
    for feature_order, feature in enumerate(
        pygplates.FeatureCollection(str(MODEL_ROOT / "shapes_coasts.gpmlz"))
    ):
        feature_id = str(feature.get_feature_id())
        if feature_id not in TARGETS and feature_id != PEARYA_ID:
            continue
        oldest, _ = feature.get_valid_time()
        if oldest != REFERENCE_AGE_MA:
            continue
        for geometry_order, geometry in enumerate(feature.get_all_geometries()):
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            projected = polygonal(
                transform(forward.transform, pygplates_polygon_to_lon_lat(geometry))
            )
            if feature_id == PEARYA_ID:
                pearya.append(projected)
                if feature.get_name() != "North Ellesmere Island (Pearya)" or feature.get_reconstruction_plate_id(None) != 124:
                    raise BuildError(f"Cao Pearya target identity changed for {feature_id}")
                patch_id = f"cao-coast:{feature_id}:{feature_order}:{geometry_order}"
                patch = patches.get(patch_id)
                if patch is None:
                    raise BuildError(f"staged Cao Pearya target missing: {patch_id}")
                pearya_rows.append(
                    {
                        "patchId": patch_id,
                        "sourceFeatureId": feature_id,
                        "sourceFeatureOrder": feature_order,
                        "geometryOrder": geometry_order,
                        "plateId": 124,
                        "geometrySha256": target_hash(patch, directions),
                        "originalValidTimeMa": {"youngest": None, "oldest": 410},
                        "expectedMatches": 1,
                    }
                )
                continue
            plate_id, expected_name = TARGETS[feature_id]
            if feature.get_name() != expected_name or feature.get_reconstruction_plate_id(None) != plate_id:
                raise BuildError(f"Cao target identity changed for {feature_id}")
            patch_id = f"cao-coast:{feature_id}:{feature_order}:{geometry_order}"
            patch = patches.get(patch_id)
            if patch is None:
                raise BuildError(f"staged Cao target missing: {patch_id}")
            cohort_geometries[plate_id].append(projected)
            target_rows[plate_id].append(
                {
                    "patchId": patch_id,
                    "sourceFeatureId": feature_id,
                    "sourceFeatureOrder": feature_order,
                    "geometryOrder": geometry_order,
                    "plateId": plate_id,
                    "geometrySha256": target_hash(patch, directions),
                    "originalValidTimeMa": {"youngest": None, "oldest": 410},
                    "expectedMatches": 1,
                }
            )
    expected = {120: 18, 141: 16, 122: 3, 123: 7}
    observed = {plate: len(rows) for plate, rows in target_rows.items()}
    if observed != expected or len(pearya) != 3 or len(pearya_rows) != 3:
        raise BuildError(f"unexpected Cao target inventory: {observed}, Pearya={len(pearya)}")
    return (
        {plate: polygonal(unary_union(rows)) for plate, rows in cohort_geometries.items()},
        target_rows,
        polygonal(unary_union(pearya)),
        pearya_rows,
    )


def load_laurentia_acob(rotations):
    """Return the older Cao Laurentia continental-boundary model in the 410 Ma frame."""
    path = MODEL_ROOT / "COBfile_1800_0.gpml"
    if sha256(path.read_bytes()) != COB_SHA:
        raise BuildError("pinned Cao continental-boundary source changed")
    matches = []
    for source_order, feature in enumerate(pygplates.FeatureCollection(str(path))):
        if str(feature.get_feature_id()) == LAURENTIA_ACOB_ID:
            matches.append((source_order, feature))
    if len(matches) != 1:
        raise BuildError("expected exactly one pinned Laurentia aCOB source feature")
    source_order, feature = matches[0]
    if (
        source_order != LAURENTIA_ACOB_SOURCE_ORDER
        or feature.get_name() != "Laurentia aCOB"
        or feature.get_reconstruction_plate_id(None) != 101
        or feature.get_valid_time() != (1070.0, LAURENTIA_ACOB_YOUNGEST_MA)
    ):
        raise BuildError("pinned Laurentia aCOB identity or lifetime changed")
    geometries = [
        geometry
        for geometry in feature.get_all_geometries()
        if isinstance(geometry, pygplates.PolygonOnSphere)
    ]
    if len(geometries) != 1:
        raise BuildError("pinned Laurentia aCOB must contain exactly one polygon")
    at_youngest = pose_geometry(
        pygplates_polygon_to_lon_lat(geometries[0]),
        rotations.get_rotation(LAURENTIA_ACOB_YOUNGEST_MA, 101),
    )
    carry_to_410 = (
        rotations.get_rotation(REFERENCE_AGE_MA, 101)
        * rotations.get_rotation(LAURENTIA_ACOB_YOUNGEST_MA, 101).get_inverse()
    )
    return polygonal(pose_geometry(at_youngest, carry_to_410))


def classify_setting(setting: str, age_period: str = "") -> tuple[str | None, str]:
    if setting in DIRECT_SETTINGS:
        upper_age = age_period.upper()
        if any(
            interval in upper_age
            for interval in (
                "ARCHEAN",
                "PALEOPROTEROZOIC",
                "MESOPROTEROZOIC",
                "NEOPROTEROZOIC",
                "EDIACARAN",
                "CAMBRIAN",
                "ORDOVICIAN",
            )
        ):
            return "direct-ancient-unit", (
                "mapped unit predates or spans 430 Ma in a Franklinian or Arctic Platform setting"
            )
        return "younger-cover-substrate-inference", (
            "mapped younger unit in a Franklinian or Arctic Platform setting; only the older substrate is inferred"
        )
    if setting in COVER_SETTINGS:
        return "younger-cover-substrate-inference", (
            "mapped younger basin/orogen cover whose named setting is supported as overlying "
            "the older northern Laurentian substrate"
        )
    upper = setting.upper()
    if "PEARYA" in upper:
        return None, "excluded-disputed-pearya-affinity"
    if setting == "Glacier ice":
        return None, "excluded-no-bedrock-unit-under-ice"
    if any(token in upper for token in ("DEEP WATER", "CAPE PHILLIPS", "HARE FIORD", "CANROBERT")):
        return None, "excluded-deep-water-or-ambiguous-margin-setting"
    if not setting:
        return None, "excluded-blank-tectonic-setting"
    return None, "excluded-unrelated-or-unqualified-setting"


def rounded_mapping(geometry):
    value = mapping(geometry)

    def visit(item):
        if isinstance(item, tuple):
            return [visit(value) for value in item]
        if isinstance(item, list):
            return [visit(value) for value in item]
        if isinstance(item, float):
            return round(item, 6)
        return item

    return visit(value)


def coordinate_count(geometry) -> int:
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    return sum(
        len(polygon.exterior.coords)
        + sum(len(interior.coords) for interior in polygon.interiors)
        for polygon in polygons
    )


def pose_geometry(geometry, rotation):
    def pose(x_values, y_values, z_values=None):
        scalar = isinstance(x_values, (int, float))
        xs = [x_values] if scalar else x_values
        ys = [y_values] if scalar else y_values
        output = []
        for longitude, latitude in zip(xs, ys):
            moved = rotation * pygplates.PointOnSphere(latitude, longitude)
            moved_latitude, moved_longitude = moved.to_lat_lon()
            output.append((moved_longitude, moved_latitude))
        if scalar:
            return output[0]
        return tuple(value[0] for value in output), tuple(value[1] for value in output)

    return polygonal(transform(pose, geometry))


def degrees_and_km(a, b) -> tuple[float, float]:
    degrees = math.degrees(pygplates.GeometryOnSphere.distance(a, b))
    return degrees, degrees * math.pi / 180 * EARTH_KM


def active_at(feature, age: float) -> bool:
    oldest, youngest = feature.get_valid_time()
    return youngest <= age <= oldest


def native_coverage_at_age(age, target_references, candidate_references, rotations):
    """Measure native and additive coverage in one local equal-area projection."""
    carry = rotations.get_rotation(age, 101) * rotations.get_rotation(REFERENCE_AGE_MA, 101).get_inverse()
    target_at_age_rows = [pose_geometry(row, carry) for row in target_references]
    candidate_at_age_rows = [pose_geometry(row, carry) for row in candidate_references]
    target_at_age = polygonal(unary_union(target_at_age_rows))
    centre = target_at_age.representative_point()
    equal_area_crs = (
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} "
        "+datum=WGS84 +units=m +no_defs"
    )
    projector = Transformer.from_crs("EPSG:4326", equal_area_crs, always_xy=True)
    projected_targets = [
        polygonal(transform(projector.transform, row)) for row in target_at_age_rows
    ]
    projected_candidates = [
        polygonal(transform(projector.transform, row)) for row in candidate_at_age_rows
    ]
    target_projected = polygonal(unary_union(projected_targets))
    candidate_projected = polygonal(unary_union(projected_candidates)).intersection(target_projected)
    bounds = target_at_age.bounds
    native_clips = []
    for feature in pygplates.FeatureCollection(str(MODEL_ROOT / "shapes_coasts.gpmlz")):
        if not active_at(feature, age):
            continue
        rotation = rotations.get_rotation(age, feature.get_reconstruction_plate_id(0))
        for source_geometry in feature.get_all_geometries():
            if not isinstance(source_geometry, pygplates.PolygonOnSphere):
                continue
            native = pose_geometry(pygplates_polygon_to_lon_lat(source_geometry), rotation)
            native_bounds = native.bounds
            if (
                native_bounds[2] < bounds[0]
                or native_bounds[0] > bounds[2]
                or native_bounds[3] < bounds[1]
                or native_bounds[1] > bounds[3]
            ):
                continue
            projected = polygonal(transform(projector.transform, native))
            clip = polygonal(projected.intersection(target_projected))
            if not clip.is_empty:
                native_clips.append(clip)
    native_covered = polygonal(unary_union(native_clips)) if native_clips else MultiPolygon([])
    candidate_covered = polygonal(candidate_projected)
    combined_covered = polygonal(unary_union([native_covered, candidate_covered]))
    denominator = target_projected.area
    before = native_covered.area
    after = combined_covered.area
    overlap = native_covered.intersection(candidate_covered).area
    return {
        "ageMa": age,
        "unionTargetAreaKm2": denominator / 1_000_000,
        "nativeCoverageBeforeKm2": before / 1_000_000,
        "nativeCoverageBeforeFraction": before / denominator,
        "candidateWithinTargetKm2": candidate_covered.area / 1_000_000,
        "candidateOverlapWithNativeKm2": overlap / 1_000_000,
        "novelCoverageAddedKm2": max(0.0, after - before) / 1_000_000,
        "combinedCoverageAfterKm2": after / 1_000_000,
        "combinedCoverageAfterFraction": after / denominator,
    }


def reference_union_metrics(candidate_geometries, target_geometries):
    """Quantify cross-cohort overlap with one 410 Ma equal-area projection."""
    target_union = polygonal(unary_union(target_geometries))
    centre = target_union.representative_point()
    equal_area_crs = (
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} "
        "+datum=WGS84 +units=m +no_defs"
    )
    projector = Transformer.from_crs("EPSG:4326", equal_area_crs, always_xy=True)
    candidates = [polygonal(transform(projector.transform, row)) for row in candidate_geometries]
    targets = [polygonal(transform(projector.transform, row)) for row in target_geometries]
    candidate_sum = sum(row.area for row in candidates)
    target_sum = sum(row.area for row in targets)
    candidate_union = polygonal(unary_union(candidates)).area
    target_union_area = polygonal(unary_union(targets)).area
    return {
        "candidateCohortSumKm2": candidate_sum / 1_000_000,
        "candidateUnionKm2": candidate_union / 1_000_000,
        "candidateCrossCohortOverlapKm2": (candidate_sum - candidate_union) / 1_000_000,
        "targetCohortSumKm2": target_sum / 1_000_000,
        "targetUnionKm2": target_union_area / 1_000_000,
        "targetCrossCohortOverlapKm2": (target_sum - target_union_area) / 1_000_000,
        "candidateUnionSupportFraction": candidate_union / target_union_area,
    }


def aggregate_source_hash(source_manifest: dict) -> tuple[int, str]:
    digest = hashlib.sha256(SOURCE_AGGREGATE_DOMAIN)
    total = 0
    for relative, record in sorted(source_manifest["acquisition"]["files"].items()):
        path = SOURCE_ROOT / "source-members" / relative
        payload = path.read_bytes()
        if len(payload) != record["bytes"] or sha256(payload) != record["sha256"]:
            raise BuildError(f"CGM 80 member changed: {relative}")
        encoded = relative.encode()
        digest.update(struct.pack("<I", len(encoded)))
        digest.update(encoded)
        digest.update(struct.pack("<Q", len(payload)))
        digest.update(payload)
        total += len(payload)
    return total, digest.hexdigest()


def load_completion_source():
    source_manifest = json.loads((COMPLETION_SOURCE_ROOT / "source-manifest.json").read_text())
    policy = json.loads((COMPLETION_SOURCE_ROOT / "storage-policy.json").read_text())
    digest = hashlib.sha256(COMPLETION_SOURCE_AGGREGATE_DOMAIN)
    total = 0
    for relative, record in sorted(source_manifest["acquisition"]["files"].items()):
        path = COMPLETION_SOURCE_ROOT / "source-members" / relative
        payload = path.read_bytes()
        if len(payload) != record["bytes"] or sha256(payload) != record["sha256"]:
            raise BuildError(f"Arctic Map 2159A member changed: {relative}")
        encoded = relative.encode()
        digest.update(struct.pack("<I", len(encoded)))
        digest.update(encoded)
        digest.update(struct.pack("<Q", len(payload)))
        digest.update(payload)
        total += len(payload)
    if total != source_manifest["acquisition"]["retainedMemberBytes"]:
        raise BuildError("Arctic Map 2159A retained-byte total changed")
    if total > policy["sourceAcquisitionMaximumBytes"]:
        raise BuildError("retained Arctic Map 2159A source members exceed their written cap")
    owned_bytes = sum(
        path.stat().st_size for path in COMPLETION_SOURCE_ROOT.rglob("*") if path.is_file()
    )
    if owned_bytes > policy["directoryMaximumBytes"]:
        raise BuildError("owned Canada completion source directory exceeds its written cap")
    data = json.loads(
        (
            COMPLETION_SOURCE_ROOT
            / "source-members/arctic-map-2159a-northern-canada.geojson"
        ).read_text()
    )
    if data.get("type") != "FeatureCollection" or len(data.get("features", [])) != 2937:
        raise BuildError("bounded Arctic Map 2159A feature inventory changed")
    rows = []
    for feature in data["features"]:
        geometry = polygonal(shape(feature.get("geometry")))
        properties = feature.get("properties", {})
        if geometry.is_empty or not isinstance(properties, dict):
            raise BuildError("Arctic Map 2159A contains an empty or malformed feature")
        rows.append((properties, geometry))
    return source_manifest, policy, total, digest.hexdigest(), owned_bytes, rows


def classify_arctic_map_area(projected_geometry, source_rows):
    grouped = defaultdict(list)
    mapped = []
    target_bounds = projected_geometry.bounds
    for properties, source_projected in source_rows:
        source_bounds = source_projected.bounds
        if (
            source_bounds[2] < target_bounds[0]
            or source_bounds[0] > target_bounds[2]
            or source_bounds[3] < target_bounds[1]
            or source_bounds[1] > target_bounds[3]
        ):
            continue
        intersection = polygonal(source_projected.intersection(projected_geometry))
        if intersection.is_empty or intersection.area <= 1:
            continue
        key = (
            properties.get("DOMAIN_R_1") or "none assigned",
            properties.get("DOMAIN_R_2") or "none assigned",
            properties.get("DOMAIN_R_3") or "none assigned",
        )
        grouped[key].append(intersection)
        mapped.append(intersection)
    mapped_union = polygonal(unary_union(mapped)) if mapped else MultiPolygon([])
    rows = []
    for (domain_1, domain_2, domain_3), geometries in grouped.items():
        rows.append(
            {
                "domainLevel1": domain_1,
                "domainLevel2": domain_2,
                "domainLevel3": domain_3,
                "areaKm2": polygonal(unary_union(geometries)).area / 1_000_000,
            }
        )
    rows.sort(key=lambda row: (-row["areaKm2"], row["domainLevel2"]))
    return {
        "classified": rows,
        "mappedUnionAreaKm2": mapped_union.area / 1_000_000,
        "unmappedAreaKm2": projected_geometry.difference(mapped_union).area / 1_000_000,
    }


def compile_candidate() -> tuple[dict, dict, dict]:
    verify_selection_policy(DIRECT_SETTINGS, COVER_SETTINGS)
    source_manifest = json.loads((SOURCE_ROOT / "source-manifest.json").read_text())
    policy = json.loads((SOURCE_ROOT / "storage-policy.json").read_text())
    (
        completion_source_manifest,
        completion_policy,
        completion_source_bytes,
        completion_source_hash,
        completion_owned_bytes,
        arctic_map_rows,
    ) = load_completion_source()
    source_bytes, source_hash = aggregate_source_hash(source_manifest)
    if source_bytes > policy["sourceAcquisitionMaximumBytes"]:
        raise BuildError("retained CGM 80 source members exceed their written cap")
    owned_source_directory_bytes = sum(
        path.stat().st_size for path in SOURCE_ROOT.rglob("*") if path.is_file()
    )
    if owned_source_directory_bytes > policy["directoryMaximumBytes"]:
        raise BuildError("owned Canada source directory exceeds its written cap")
    study_bytes = sum(
        path.stat().st_size
        for path in SOURCE_ROOT.parents[1].rglob("*")
        if path.is_file()
    )
    if study_bytes > policy["parentStudyMaximumBytes"]:
        raise BuildError("complete palaeomap study store exceeds its 4 GiB bound")

    reader = shapefile.Reader(str(SHAPEFILE), encoding="cp1252")
    fields = [field[0] for field in reader.fields[1:]]
    projected_crs = SHAPEFILE.with_suffix(".prj").read_text()
    target_geometries, targets, pearya, _pearya_targets = load_targets(projected_crs)
    reverse = Transformer.from_crs(projected_crs, "EPSG:4326", always_xy=True)
    forward = Transformer.from_crs("EPSG:4326", projected_crs, always_xy=True)
    arctic_map_projected_rows = [
        (properties, polygonal(transform(forward.transform, geometry)))
        for properties, geometry in arctic_map_rows
    ]
    pearya_domain_projected = polygonal(
        unary_union([
            geometry
            for properties, geometry in arctic_map_projected_rows
            if properties.get("DOMAIN_R_2") == "Pearya, north Ellesmere Island"
        ])
    )
    rotations = pygplates.RotationModel(
        [str(MODEL_ROOT / "1000_0_rotfile.rot"), str(MODEL_ROOT / "1800_1000_rotfile.rot")],
        default_anchor_plate_id=0,
    )
    laurentia_acob_reference = load_laurentia_acob(rotations)

    selected = defaultdict(list)
    units = defaultdict(lambda: defaultdict(lambda: {"records": set(), "area": 0.0}))
    excluded = defaultdict(lambda: defaultdict(int))
    for source_order, row in enumerate(reader.iterShapeRecords()):
        properties = dict(zip(fields, row.record))
        setting = (properties["TECTONIC_S"] or "").strip()
        age_period = (properties["ASSEMBLA_3"] or "").strip()
        tier, reason = classify_setting(setting, age_period)
        source_geometry = polygonal(shape(row.shape.__geo_interface__))
        for plate_id, target in target_geometries.items():
            if (
                source_geometry.bounds[2] < target.bounds[0]
                or source_geometry.bounds[0] > target.bounds[2]
                or source_geometry.bounds[3] < target.bounds[1]
                or source_geometry.bounds[1] > target.bounds[3]
            ):
                continue
            intersection = polygonal(source_geometry.intersection(target))
            if intersection.is_empty or intersection.area <= 1:
                continue
            if tier is None:
                excluded[plate_id][(setting or "blank", reason)] += 1
                continue
            selected[plate_id].append(intersection)
            unit_id = "|".join(
                [properties["ASSEMBLA_1"], properties["ASSEMBLA_2"], setting]
            )
            key = (
                unit_id,
                properties["ASSEMBLA_1"],
                properties["ASSEMBLA_2"],
                properties["ASSEMBLA_3"],
                setting,
                tier,
                reason,
            )
            units[plate_id][key]["records"].add(source_order)
            units[plate_id][key]["area"] += intersection.area

    geojson_features = []
    manifest_features = []
    validation_cohorts = []
    all_candidate_reference = []
    all_target_reference = []
    plate_101_at_410 = rotations.get_rotation(REFERENCE_AGE_MA, 101)
    for plate_id in sorted(target_geometries):
        target = target_geometries[plate_id]
        raw = polygonal(unary_union(selected[plate_id]))
        inset = raw
        candidate = polygonal(
            polygonal(raw.simplify(SIMPLIFY_METRES, preserve_topology=True))
            .intersection(target)
            .difference(unary_union([pearya.buffer(1.0), pearya_domain_projected]))
        )
        candidate = drop_tiny_components(candidate, MIN_COMPONENT_AREA_SQUARE_METRES)
        if candidate.is_empty:
            raise BuildError(f"candidate cohort {plate_id} is empty")
        outside_source = candidate.difference(raw).area
        outside_target = candidate.difference(target).area
        outside_inset = candidate.difference(inset).area
        area_change_fraction = abs(candidate.area - raw.area) / raw.area
        outside_source_fraction = outside_source / candidate.area
        if (
            outside_target > CONTAINMENT_TOLERANCE_SQUARE_METRES
            or area_change_fraction > MAX_SIMPLIFICATION_AREA_CHANGE_FRACTION
            or outside_source_fraction > MAX_SIMPLIFIED_OUTSIDE_SOURCE_FRACTION
        ):
            raise BuildError(
                f"candidate cohort {plate_id} exceeded its target or 5 km source-boundary approximation"
            )
        pearya_overlap = candidate.intersection(pearya).area
        if pearya_overlap > 1:
            raise BuildError(f"candidate cohort {plate_id} overlaps Pearya by {pearya_overlap} m2")
        modern_lon_lat = polygonal(transform(reverse.transform, candidate))
        native_rotation = rotations.get_rotation(REFERENCE_AGE_MA, plate_id)
        outcrop_reference_geometry = pose_geometry(modern_lon_lat, native_rotation)
        target_modern_lon_lat = polygonal(transform(reverse.transform, target))
        target_reference_geometry = pose_geometry(target_modern_lon_lat, native_rotation)
        pearya_reference_geometry = pose_geometry(
            polygonal(transform(reverse.transform, pearya)),
            rotations.get_rotation(REFERENCE_AGE_MA, 124),
        )
        pearya_domain_reference_geometry = pose_geometry(
            polygonal(
                transform(
                    reverse.transform,
                    target.intersection(pearya_domain_projected),
                )
            ),
            native_rotation,
        )
        acob_support = polygonal(
            target_reference_geometry.intersection(laurentia_acob_reference).difference(
                pearya_domain_reference_geometry
            )
        )
        reference_geometry = polygonal(
            unary_union([outcrop_reference_geometry, acob_support])
            .difference(
                unary_union(
                    [pearya_reference_geometry, pearya_domain_reference_geometry]
                )
            )
            .intersection(target_reference_geometry)
        )
        feature_id = f"canada-franklinian-material-plate-{plate_id}"
        all_candidate_reference.append(reference_geometry)
        all_target_reference.append(target_reference_geometry)
        geojson_features.append(
            {
                "type": "Feature",
                "id": feature_id,
                "properties": {
                    "correctionFeatureId": feature_id,
                    "sourcePlateIdAt410Ma": plate_id,
                    "motionPlateIdOlderThan410Ma": 101,
                    "materialRole": "continental-material-support",
                    "surfaceEvidence": "unknown",
                    "continentalExtentSource": "cao-v2.4-laurentia-acob",
                },
                "geometry": rounded_mapping(reference_geometry),
            }
        )

        modern_witness = modern_lon_lat.representative_point()
        witness_present = pygplates.PointOnSphere(modern_witness.y, modern_witness.x)
        witness_410 = native_rotation * witness_present
        witness_410_lat, witness_410_lon = witness_410.to_lat_lon()
        displacement_degrees, displacement_km = degrees_and_km(witness_present, witness_410)
        comparisons = []
        max_residual = 0.0
        for age in (411.0, 415.0, 420.0, 425.0, 430.0, 450.0, 540.0):
            candidate_point = (
                rotations.get_rotation(age, 101)
                * plate_101_at_410.get_inverse()
                * witness_410
            )
            source_counterfactual = rotations.get_rotation(age, plate_id) * witness_present
            expected_latitude, expected_longitude = source_counterfactual.to_lat_lon()
            degrees, kilometres = degrees_and_km(candidate_point, source_counterfactual)
            max_residual = max(max_residual, kilometres)
            comparisons.append(
                {
                    "ageMa": age,
                    "counterfactualCaoPlateId": plate_id,
                    "expectedLonLat": [expected_longitude, expected_latitude],
                    "angularResidualDegrees": degrees,
                    "residualKm": kilometres,
                }
            )
        included_units = []
        for key, values in sorted(units[plate_id].items()):
            unit_id, code, name, age_band, setting, tier, reason = key
            included_units.append(
                {
                    "unitId": unit_id,
                    "code": code,
                    "name": name,
                    "agePeriod": age_band,
                    "tectonicSetting": setting,
                    "evidenceTier": tier,
                    "sourceRecordOrders": sorted(values["records"]),
                    "clippedAreaKm2": values["area"] / 1_000_000,
                    "reason": reason,
                }
            )
        excluded_units = [
            {"unitId": setting, "count": count, "reason": reason}
            for (setting, reason), count in sorted(excluded[plate_id].items())
        ]
        raw_area = raw.area
        candidate_area = candidate.area
        target_area = target.area
        tier_areas = defaultdict(float)
        for key, values in units[plate_id].items():
            tier_areas[key[5]] += values["area"]
        candidate_area_steradians = sum(
            polygon.get_area() for polygon in _pygplates_polygons(reference_geometry)
        )
        target_area_steradians = sum(
            polygon.get_area() for polygon in _pygplates_polygons(target_reference_geometry)
        )
        outcrop_area_steradians = sum(
            polygon.get_area() for polygon in _pygplates_polygons(outcrop_reference_geometry)
        )
        acob_area_steradians = sum(
            polygon.get_area() for polygon in _pygplates_polygons(acob_support)
        )
        acob_novel_geometry = polygonal(acob_support.difference(outcrop_reference_geometry))
        acob_novel_area_steradians = sum(
            polygon.get_area() for polygon in _pygplates_polygons(acob_novel_geometry)
        )
        cohort_union = reference_union_metrics(
            [reference_geometry], [target_reference_geometry]
        )
        qualified_reference_source = polygonal(
            unary_union([outcrop_reference_geometry, acob_support])
        )
        final_outside_qualified_reference = reference_geometry.difference(
            qualified_reference_source
        ).area
        final_outside_target_reference = reference_geometry.difference(
            target_reference_geometry
        ).area
        final_pearya_overlap_reference = reference_geometry.intersection(
            unary_union([pearya_reference_geometry, pearya_domain_reference_geometry])
        ).area
        if max(
            final_outside_qualified_reference,
            final_outside_target_reference,
            final_pearya_overlap_reference,
        ) > 1e-10:
            raise BuildError(
                f"expanded candidate cohort {plate_id} escaped its aCOB/target or Pearya guard: "
                f"source={final_outside_qualified_reference}, target={final_outside_target_reference}, "
                f"Pearya={final_pearya_overlap_reference}"
            )
        manifest_features.append(
            {
                "correctionFeatureId": feature_id,
                "targets": targets[plate_id],
                "geometryAsset": {
                    "path": "franklinian-material-v1.geojson",
                    "sha256": "PENDING",
                    "featureId": feature_id,
                },
                "geometryReferenceAgeMa": 410,
                "coordinateFrame": "cao-v2.4-reconstructed-palaeomagnetic",
                "sourceBasis": {
                    "kind": "reconstructed-target-union",
                    "normalization": "qPose(0)*inverse(qPose(referenceAge))*dReference",
                    "targetPlateIds": [plate_id],
                    "derivation": (
                        "union of (1) the 5 km source-boundary approximation of the CGM 80 unit witness mask after "
                        "dropping components smaller than 25 km² and "
                        "(2) the exact immutable Cao target "
                        "at 410 Ma intersected with the pinned Laurentia aCOB continental-extent model active from "
                        "410.1 Ma; explicitly differenced from Pearya and carried older with plate 101"
                    ),
                    "continentalExtentFeature": {
                        "sourceCollection": "COBfile_1800_0.gpml",
                        "sourceFeatureId": LAURENTIA_ACOB_ID,
                        "sourceFeatureOrder": LAURENTIA_ACOB_SOURCE_ORDER,
                        "sourcePlateId": 101,
                        "sourceValidTimeMa": {
                            "youngest": LAURENTIA_ACOB_YOUNGEST_MA,
                            "oldest": 1070,
                        },
                        "referenceAgeBridgeMa": 0.1,
                    },
                },
                "pose": {
                    "plateId": 101,
                    "method": "regional-model-hypothesis",
                    "sourceOrHypothesis": (
                        "native target-plate alignment at 410 Ma followed by North America plate 101 relative motion; "
                        "the Cao target circuits are frozen relative to 101 through 540 Ma"
                    ),
                    "alignmentWitnesses": [
                        {
                            "witnessId": f"plate-{plate_id}-interior",
                            "presentLonLat": [modern_witness.x, modern_witness.y],
                            "referenceLonLat": [witness_410_lon, witness_410_lat],
                            "presentTo410AngularDegrees": displacement_degrees,
                            "presentTo410DistanceKm": displacement_km,
                            "olderPoseComparisons": comparisons,
                        }
                    ],
                },
                "materialRole": "continental-material-support",
                "supportIntervalMa": {
                    "youngest": 410,
                    "youngestExclusive": True,
                    "oldest": 430,
                },
                "olderEdgePolicy": "uncertain-beyond-qualified-support",
                "olderUncertaintyTransitionMa": {
                    "youngest": 430,
                    "oldest": 540,
                    "representation": "same material-support mask remains visible with explicit lower spatial confidence",
                },
                "sourceUnitSelection": {
                    "included": included_units,
                    "excluded": excluded_units,
                    "insetMetres": INSET_METRES,
                    "simplificationToleranceMetres": SIMPLIFY_METRES,
                    "minimumComponentAreaKm2": MIN_COMPONENT_AREA_SQUARE_METRES / 1_000_000,
                    "rawClippedAreaKm2": raw_area / 1_000_000,
                    "mappedUnitCandidateAreaKm2": candidate_area / 1_000_000,
                    "mappedUnitAreaSteradians": outcrop_area_steradians,
                    "continentalBoundarySupportAreaSteradians": acob_area_steradians,
                    "continentalBoundaryNovelAreaSteradians": acob_novel_area_steradians,
                    "candidateAreaSteradians": candidate_area_steradians,
                    "simplificationAreaChangeFraction": area_change_fraction,
                    "simplifiedOutsideMappedSourceKm2": outside_source / 1_000_000,
                    "simplifiedOutsideMappedSourceFraction": outside_source_fraction,
                    "containmentToleranceSquareMetres": CONTAINMENT_TOLERANCE_SQUARE_METRES,
                    "finalOutsideQualifiedSourceKm2": 0,
                    "finalOutsideTargetKm2": 0,
                    "finalOutsideInsetKm2": outside_inset / 1_000_000,
                    "targetAreaKm2": cohort_union["targetUnionKm2"],
                    "targetAreaSupportFractionAt411": candidate_area_steradians / target_area_steradians,
                },
                "sourceIds": [
                    "cgm80-selected-mapunits",
                    "cao-2024-v2.4",
                    "cao-2024-v2.4-laurentia-acob",
                ],
                "epistemicStatus": "model-inference",
                "surfaceEvidence": {
                    "kind": "unknown",
                    "reason": (
                        "CGM 80 maps present-day bedrock/outcrop and named cover settings; the derived mask "
                        "supports continental material affinity, not Paleozoic exposure, shoreline, or height"
                    ),
                },
                "uncertainty": {
                    "spatial": "CGM witness uses a symmetric 5 km source-boundary approximation, drops components below 25 km², and has quantified area/escape limits; the additional area is bounded by the coarse Cao Laurentia aCOB and exact affected target union; deformation and the 0.1 Myr model handoff remain unquantified",
                    "temporal": "material continuity qualified for 410-430 Ma; continuity to 540 Ma remains a visible uncertain state, not absence",
                    "exposure": "unknown at every age",
                },
                "rejectionConditions": [
                    "a selected source setting is Pearya, glacier-only, deep-water, blank, or unrelated",
                    "the simplified mapped-unit mask exceeds 10% area change, 6% outside-source area, the exact target, or the Cao Pearya exclusion",
                    "the continental-boundary addition escapes either the pinned Laurentia aCOB or its exact affected Cao target",
                    "the candidate is presented as exposed land, ancient shoreline, or palaeotopographic height",
                    "the 410 Ma alignment is not native-target coincident or the plate-101 carry differs from the frozen Cao target circuit through 540 Ma",
                    "the correction becomes absent at 430 Ma instead of entering the explicit uncertain older state",
                ],
            }
        )
        validation_cohorts.append(
            {
                "plateId": plate_id,
                "targetChartCount": len(targets[plate_id]),
                "targetAreaKm2": cohort_union["targetUnionKm2"],
                "rawSelectedClippedAreaKm2": raw_area / 1_000_000,
                "mappedUnitCandidateAreaKm2": candidate_area / 1_000_000,
                "mappedUnitSimplificationAreaChangeFraction": area_change_fraction,
                "mappedUnitSimplifiedOutsideSourceKm2": outside_source / 1_000_000,
                "mappedUnitSimplifiedOutsideSourceFraction": outside_source_fraction,
                "continentalBoundarySupportAreaSteradians": acob_area_steradians,
                "continentalBoundaryNovelAreaSteradians": acob_novel_area_steradians,
                "candidateAreaKm2": cohort_union["candidateUnionKm2"],
                "targetAreaSupportFractionAt411": cohort_union["candidateUnionSupportFraction"],
                "candidateAreaSteradians": candidate_area_steradians,
                "targetAreaSteradians": target_area_steradians,
                "sphericalTargetAreaSupportFractionAt411": candidate_area_steradians / target_area_steradians,
                "projectedVsSphericalSupportFractionResidual": (
                    cohort_union["candidateUnionSupportFraction"]
                    - candidate_area_steradians / target_area_steradians
                ),
                "selectedClippedAreaByEvidenceTierKm2": {
                    tier: area / 1_000_000 for tier, area in sorted(tier_areas.items())
                },
                "selectedUnionVsTierSumOverlapResidualKm2": (
                    sum(tier_areas.values()) - raw_area
                )
                / 1_000_000,
                "candidatePolygonCount": len(reference_geometry.geoms) if isinstance(reference_geometry, MultiPolygon) else 1,
                "candidateCoordinateCount": coordinate_count(reference_geometry),
                "maximumPoseResidualKm411To540": max_residual,
                "pearyaOverlapKm2": 0,
                "finalOutsideQualifiedSourceKm2": 0,
                "finalOutsideTargetKm2": 0,
                "finalOutsideInsetKm2": outside_inset / 1_000_000,
                "continentalBoundaryAddedDomains": classify_arctic_map_area(
                    polygonal(
                        transform(
                            forward.transform,
                            pose_geometry(acob_novel_geometry, native_rotation.get_inverse()),
                        )
                    ),
                    arctic_map_projected_rows,
                ),
                "residualDomains": classify_arctic_map_area(
                    polygonal(
                        transform(
                            forward.transform,
                            pose_geometry(
                                target_reference_geometry.difference(reference_geometry),
                                native_rotation.get_inverse(),
                            ),
                        )
                    ),
                    arctic_map_projected_rows,
                ),
            }
        )

    geojson = {"type": "FeatureCollection", "features": geojson_features}
    geojson_bytes = canonical_json(geojson)
    geojson_sha = sha256(geojson_bytes)
    for feature in manifest_features:
        feature["geometryAsset"]["sha256"] = geojson_sha
    manifest = {
        "schemaVersion": 1,
        "correctionId": "earthhistory-regional-canada-franklinian-material-v1",
        "version": "1.0.0-candidate",
        "baseline": {
            "modelId": "cao-et-al-2024",
            "modelVersion": "2.4",
            "sourceCollection": "shapes_coasts.gpmlz",
            "sourceSha256": SOURCE_COLLECTION_SHA,
            "coordinateFrame": {
                "absoluteFrameId": "palaeomagnetic",
                "anchorPlateId": 0,
                "axisConvention": "gplates-x0e-y90e-znorth",
                "rotationSha256": ROTATION_SHA,
                "topologySha256": TOPOLOGY_SHA,
            },
        },
        "sourceAssets": [
            {
                "sourceId": "cgm80-selected-mapunits",
                "url": source_manifest["source"]["bitstreamUrl"],
                "citation": (
                    "Harrison, J.C., Lynds, T., Ford, A., and Rainbird, R.H. (2016), "
                    "Geological Survey of Canada, Canadian Geoscience Map 80 (preliminary), doi:10.4095/297416"
                ),
                "publicationOrVersionDate": "2016-04-05",
                "retrievedAt": "2026-09-12",
                "bytes": source_bytes,
                "sha256": source_hash,
                "hashEncoding": SOURCE_AGGREGATE_DOMAIN[:-1].decode(),
                "license": "Open Government Licence – Canada 2.0, as declared by current official OSTR dc.rights.license metadata",
                "attribution": source_manifest["license"]["attribution"],
                "evidenceRole": "geological-unit-extent",
            },
            {
                "sourceId": "cao-2024-v2.4",
                "url": "https://doi.org/10.5281/zenodo.13628813",
                "citation": "Cao et al. (2024), Earth's tectonic and plate boundary evolution over 1.8 billion years, model v2.4",
                "publicationOrVersionDate": "2024-09-02",
                "retrievedAt": "2026-09-09",
                "bytes": (MODEL_ROOT / "shapes_coasts.gpmlz").stat().st_size,
                "sha256": SOURCE_COLLECTION_SHA,
                "license": "CC BY 4.0",
                "attribution": "Cao et al. (2024), model v2.4, doi:10.5281/zenodo.13628813",
                "evidenceRole": "material-affinity",
            },
            {
                "sourceId": "cao-2024-v2.4-laurentia-acob",
                "url": "https://doi.org/10.5281/zenodo.13628813",
                "citation": "Cao et al. (2024), model v2.4, Laurentia aCOB continental-boundary feature",
                "publicationOrVersionDate": "2024-09-02",
                "retrievedAt": "2026-09-09",
                "bytes": (MODEL_ROOT / "COBfile_1800_0.gpml").stat().st_size,
                "sha256": COB_SHA,
                "license": "CC BY 4.0",
                "attribution": "Cao et al. (2024), model v2.4, doi:10.5281/zenodo.13628813",
                "evidenceRole": "continental-or-crustal-extent",
            },
            {
                "sourceId": "gsc-map-2159a-arctic-onshore-geology",
                "url": completion_source_manifest["source"]["openDataRecord"],
                "citation": "Harrison et al. (2011), Geological map of the Arctic, Geological Survey of Canada Map 2159A, doi:10.4095/287868",
                "publicationOrVersionDate": "2011-02-01",
                "retrievedAt": "2026-09-12",
                "bytes": completion_source_bytes,
                "sha256": completion_source_hash,
                "hashEncoding": COMPLETION_SOURCE_AGGREGATE_DOMAIN[:-1].decode(),
                "license": "Open Government Licence – Canada 2.0",
                "attribution": completion_source_manifest["license"]["attribution"],
                "evidenceRole": "material-affinity",
            },
        ],
        "features": manifest_features,
        "attribution": source_manifest["license"]["attribution"],
        "licenseNote": source_manifest["license"]["legacyNoticeConflict"],
    }
    total_target = sum(row["targetAreaKm2"] for row in validation_cohorts)
    total_candidate = sum(row["candidateAreaKm2"] for row in validation_cohorts)
    target_reference = polygonal(unary_union(all_target_reference))
    candidate_reference = polygonal(unary_union(all_candidate_reference))
    equal_area_union = reference_union_metrics(
        all_candidate_reference, all_target_reference
    )
    earth_area_scale = EARTH_KM**2
    candidate_sum_steradians = sum(
        row["candidateAreaSteradians"] for row in validation_cohorts
    )
    target_sum_steradians = sum(row["targetAreaSteradians"] for row in validation_cohorts)
    candidate_union_steradians = sum(
        polygon.get_area() for polygon in _pygplates_polygons(candidate_reference)
    )
    target_union_steradians = sum(
        polygon.get_area() for polygon in _pygplates_polygons(target_reference)
    )
    native_coverage_ages = (
        410.0,
        410.001,
        410.099999,
        410.1,
        410.100001,
        411.0,
        430.0,
        540.0,
    )
    native_coverage = [
        native_coverage_at_age(age, all_target_reference, all_candidate_reference, rotations)
        for age in native_coverage_ages
    ]
    validation = {
        "schemaVersion": 1,
        "candidate": manifest["correctionId"],
        "status": "source-qualified-candidate",
        "source": {
            "retainedMemberBytes": source_bytes,
            "ownedSourceDirectoryBytes": owned_source_directory_bytes,
            "sourceAcquisitionMaximumBytes": policy["sourceAcquisitionMaximumBytes"],
            "aggregateSha256": source_hash,
            "aggregateHashEncoding": SOURCE_AGGREGATE_DOMAIN[:-1].decode(),
            "directoryMaximumBytes": policy["directoryMaximumBytes"],
            "completePalaeomapStudyBytes": study_bytes,
            "completePalaeomapStudyMaximumBytes": policy["parentStudyMaximumBytes"],
            "fullRepositoryBundleAcquired": False,
            "completionSourceRetainedMemberBytes": completion_source_bytes,
            "completionSourceOwnedDirectoryBytes": completion_owned_bytes,
            "completionSourceAcquisitionMaximumBytes": completion_policy[
                "sourceAcquisitionMaximumBytes"
            ],
            "completionSourceAggregateSha256": completion_source_hash,
        },
        "method": {
            "referenceAgeMa": REFERENCE_AGE_MA,
            "insetMetres": INSET_METRES,
            "simplificationToleranceMetres": SIMPLIFY_METRES,
            "qualificationIntervalMa": [410, 430],
            "olderUncertainIntervalMa": [430, 540],
            "continentalBoundarySourceYoungestMa": LAURENTIA_ACOB_YOUNGEST_MA,
            "continentalBoundaryReferenceAgeBridgeMa": 0.1,
        },
        "cohorts": validation_cohorts,
        "summary": {
            "targetChartCount": sum(row["targetChartCount"] for row in validation_cohorts),
            "candidateCoordinateCount": sum(
                row["candidateCoordinateCount"] for row in validation_cohorts
            ),
            "targetAreaKm2": total_target,
            "candidateAreaKm2": total_candidate,
            "targetAreaSupportFractionAt411": total_candidate / total_target,
            "candidateReferenceAreaSteradians": candidate_union_steradians,
            "targetReferenceAreaSteradians": target_union_steradians,
            "candidateSphericalPolygonUnionAreaKm2": candidate_union_steradians * earth_area_scale,
            "targetSphericalPolygonUnionAreaKm2": target_union_steradians * earth_area_scale,
            "sphericalPolygonUnionSupportFractionDiagnostic": (
                candidate_union_steradians / target_union_steradians
            ),
            "candidateSphericalCrossCohortOverlapKm2": (
                candidate_sum_steradians - candidate_union_steradians
            )
            * earth_area_scale,
            "targetSphericalCrossCohortOverlapKm2": (
                target_sum_steradians - target_union_steradians
            )
            * earth_area_scale,
            "referenceEqualAreaUnion": equal_area_union,
            "pearyaOverlapKm2": sum(row["pearyaOverlapKm2"] for row in validation_cohorts),
        },
        "nativeCoverage": native_coverage,
        "endpointChecks": [
            {
                "ageMa": 410.0,
                "nativeTargetsActive": True,
                "correctionActive": False,
                "continentalBoundarySourceActive": False,
            },
            {
                "ageMa": 410.001,
                "nativeTargetsActive": False,
                "correctionActive": True,
                "continentalBoundarySourceActive": False,
                "basis": "0.1 Ma seam-bridge inference from the adjacent modeled extent",
            },
            {
                "ageMa": 410.099999,
                "nativeTargetsActive": False,
                "correctionActive": True,
                "continentalBoundarySourceActive": False,
                "basis": "0.1 Ma seam-bridge inference from the adjacent modeled extent",
            },
            {
                "ageMa": 410.1,
                "nativeTargetsActive": False,
                "correctionActive": True,
                "continentalBoundarySourceActive": True,
            },
            {
                "ageMa": 410.100001,
                "nativeTargetsActive": False,
                "correctionActive": True,
                "continentalBoundarySourceActive": True,
            },
        ],
        "limits": [
            "per-cohort area fractions use CGM 80 Lambert projected areas at the present-day clipping stage",
            "regional before/after coverage uses one local Lambert azimuthal equal-area denominator at each tested age",
            "younger cover units witness an inferred older Laurentian substrate, not the age or exposure of the mapped surface rock",
            "the mapped-unit boundary is simplified at source scale and the complete candidate is target clipped; it is not a reconstruction of an ancient coastline or complete crustal extent",
            "the Laurentia aCOB feature begins at 410.1 Ma; its contribution from just older than 410 through 410.1 Ma is explicitly a 0.1 Ma seam-bridge inference",
            "Cao motion agreement is computational because the source microplate relations are frozen; it is not independent paleogeographic evidence",
        ],
    }
    return geojson, manifest, validation


def _pygplates_polygons(geometry):
    rows = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    for polygon in rows:
        rings = [list(polygon.exterior.coords)] + [list(ring.coords) for ring in polygon.interiors]
        yield pygplates.PolygonOnSphere(
            [(latitude, longitude) for longitude, latitude in rings[0][:-1]],
            [[(latitude, longitude) for longitude, latitude in ring[:-1]] for ring in rings[1:]],
        )


def main() -> None:
    geojson, manifest, validation = compile_candidate()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    VALIDATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    (OUTPUT_ROOT / "franklinian-material-v1.geojson").write_bytes(canonical_json(geojson))
    (OUTPUT_ROOT / "manifest.json").write_bytes(canonical_json(manifest))
    VALIDATION_PATH.write_bytes(canonical_json(validation))
    print(
        json.dumps(
            {
                "features": len(manifest["features"]),
                "targets": validation["summary"]["targetChartCount"],
                "candidateAreaKm2": validation["summary"]["candidateAreaKm2"],
                "supportFractionAt411": validation["nativeCoverage"][1]["combinedCoverageAfterFraction"],
                "output": str(OUTPUT_ROOT.relative_to(ROOT)),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
