#!/usr/bin/env python3
"""Compile and qualify conservative pre-540 Ma Svalbard material witnesses."""

from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pygplates


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT.parent / "EarthHistory-data/palaeomap-study/regional-corrections/svalbard"
CAO = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
STAGED = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
OUT = ROOT / "data/corrections/svalbard"
DOCS = ROOT / "docs/research"
SOURCE_GEOJSON = "geological-units-1-750k.geojson"
CAO_COAST_SHA = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"
CAO_COB = "COBfile_1800_0.gpml"
WEST_COB_ID = "GPlates-9711c046-0949-4fda-a338-6ea2d48e27dc"
EAST_COB_ID = "GPlates-9653c415-6d07-4bf4-8884-da5a535b03b6"
ELIGIBLE_AGES = {"Palaeoproterozoic", "Mesoproterozoic", "Tonian", "Cryogenian"}
TARGET_NAMES = {309: "West Svalbard", 311: "East Svalbard"}
AGES = (410.0, 410.001, 411.0, 420.0, 430.0, 430.001, 440.0, 500.0, 540.0)
DOMAIN = b"earthhistory-cao-staged-geometry-f32le-xyz-rings-v1\0"
EARTH_KM = 6371.0088
BARENTS_40_TARGET_AREA_STERADIANS = 0.011685385798656078
SHAPELY_SITE = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/svalbard-shapely"
sys.path.insert(0, str(SHAPELY_SITE))
from shapely.geometry import MultiPolygon, Polygon
from shapely.ops import unary_union
from shapely.validation import explain_validity


def canonical_json(value: object, *, pretty: bool = False) -> bytes:
    if pretty:
        return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def polygon_parts(geometry: dict[str, object]) -> list[list[list[list[float]]]]:
    geometry_type = geometry["type"]
    coordinates = geometry["coordinates"]
    if geometry_type == "Polygon":
        return [coordinates]
    if geometry_type == "MultiPolygon":
        return coordinates
    raise AssertionError(("unsupported source geometry", geometry_type))


def on_sphere(coordinates: list[list[list[float]]]) -> pygplates.PolygonOnSphere:
    rings = [[(point[1], point[0]) for point in ring] for ring in coordinates]
    return pygplates.PolygonOnSphere(rings[0], rings[1:])


def laea_xy(lon: float, lat: float, centre_lon: float = 15.0, centre_lat: float = 78.0):
    longitude = math.radians(lon)
    latitude = math.radians(lat)
    longitude0 = math.radians(centre_lon)
    latitude0 = math.radians(centre_lat)
    denominator = 1 + math.sin(latitude0) * math.sin(latitude) + math.cos(latitude0) * math.cos(latitude) * math.cos(longitude - longitude0)
    assert denominator > 0
    scale = math.sqrt(2 / denominator) * EARTH_KM * 1000
    return (
        scale * math.cos(latitude) * math.sin(longitude - longitude0),
        scale * (math.cos(latitude0) * math.sin(latitude) - math.sin(latitude0) * math.cos(latitude) * math.cos(longitude - longitude0)),
    )


def projected_polygon(coordinates, centre_lon: float = 15.0, centre_lat: float = 78.0):
    rings = [[laea_xy(point[0], point[1], centre_lon, centre_lat) for point in ring] for ring in coordinates]
    polygon = Polygon(rings[0], rings[1:])
    assert polygon.is_valid and not polygon.is_empty
    return polygon


def inverse_laea(x: float, y: float, centre_lon: float = 15.0, centre_lat: float = 78.0):
    longitude0 = math.radians(centre_lon)
    latitude0 = math.radians(centre_lat)
    rho = math.hypot(x, y)
    if rho == 0:
        return [centre_lon, centre_lat]
    angular_distance = 2 * math.asin(min(1, rho / (2 * EARTH_KM * 1000)))
    sin_distance = math.sin(angular_distance)
    cos_distance = math.cos(angular_distance)
    latitude = math.asin(
        cos_distance * math.sin(latitude0)
        + y * sin_distance * math.cos(latitude0) / rho
    )
    longitude = longitude0 + math.atan2(
        x * sin_distance,
        rho * math.cos(latitude0) * cos_distance
        - y * math.sin(latitude0) * sin_distance,
    )
    longitude_degrees = ((math.degrees(longitude) + 180) % 360) - 180
    return [longitude_degrees, math.degrees(latitude)]


def polygon_coordinates(polygon: Polygon):
    def ring_coordinates(ring):
        return [inverse_laea(x, y) for x, y in ring.coords]

    return [ring_coordinates(polygon.exterior), *[ring_coordinates(ring) for ring in polygon.interiors]]


def geometry_polygons(geometry):
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    raise AssertionError(("unexpected dissolved geometry", geometry.geom_type))


def geometry_counts(coordinates):
    return {
        "polygonComponents": len(coordinates),
        "holes": sum(max(0, len(polygon) - 1) for polygon in coordinates),
        "vertices": sum(len(ring) for polygon in coordinates for ring in polygon),
    }


def derive_delivered_geometry(parts, own_cohort, cross_cohort, policy):
    limits = policy["deliveredGeometry"]
    raw_union = unary_union([projected_polygon(part["coordinates"]) for part in parts])
    raw_polygons = geometry_polygons(raw_union)
    raw_component_count = len(raw_polygons)
    raw_hole_count = sum(len(polygon.interiors) for polygon in raw_polygons)
    own_union = unary_union(
        [projected_polygon(pygplates_coordinates(polygon)) for polygon in own_cohort]
    )
    cross_union = unary_union(
        [projected_polygon(pygplates_coordinates(polygon)) for polygon in cross_cohort]
    )
    attempts = []
    simplified = None
    selected_tolerance = None
    for tolerance in limits["simplificationToleranceCandidatesMetres"]:
        candidate = raw_union if tolerance == 0 else raw_union.simplify(tolerance, preserve_topology=True)
        valid = candidate.is_valid and not candidate.is_empty and candidate.geom_type in ("Polygon", "MultiPolygon")
        if valid:
            polygons = geometry_polygons(candidate)
            component_count = len(polygons)
            hole_count = sum(len(polygon.interiors) for polygon in polygons)
            area_error = abs(candidate.area - raw_union.area) / raw_union.area
            own_fraction = candidate.intersection(own_union).area / candidate.area
            cross_fraction = candidate.intersection(cross_union).area / candidate.area
        else:
            component_count = hole_count = None
            area_error = own_fraction = cross_fraction = None
        accepted = bool(
            valid
            and component_count == raw_component_count
            and hole_count == raw_hole_count
            and area_error <= limits["maximumAbsoluteAreaErrorFraction"]
            and own_fraction >= limits["minimumOwnCohortAreaFraction"]
            and cross_fraction <= limits["maximumCrossCohortAreaFraction"]
        )
        attempts.append(
            {
                "toleranceMetres": tolerance,
                "valid": valid,
                "validity": "valid" if candidate.is_valid else explain_validity(candidate),
                "componentCount": component_count,
                "holeCount": hole_count,
                "absoluteAreaErrorFraction": area_error,
                "ownCohortAreaFraction": own_fraction,
                "crossCohortAreaFraction": cross_fraction,
                "accepted": accepted,
            }
        )
        if accepted:
            simplified = candidate
            selected_tolerance = tolerance
            break
    assert simplified is not None and selected_tolerance is not None
    simplified_polygons = geometry_polygons(simplified)
    simplified_component_count = len(simplified_polygons)
    simplified_hole_count = sum(len(polygon.interiors) for polygon in simplified_polygons)
    area_error = abs(simplified.area - raw_union.area) / raw_union.area
    own_fraction = simplified.intersection(own_union).area / simplified.area
    cross_fraction = simplified.intersection(cross_union).area / simplified.area
    coordinates = [polygon_coordinates(polygon) for polygon in simplified_polygons]
    counts = geometry_counts(coordinates)
    return coordinates, {
        "sourcePartCount": len(parts),
        "rawDissolvedAreaSquareKilometres": raw_union.area / 1_000_000,
        "deliveredAreaSquareKilometres": simplified.area / 1_000_000,
        "absoluteAreaErrorSquareKilometres": abs(simplified.area - raw_union.area) / 1_000_000,
        "absoluteAreaErrorFraction": area_error,
        "rawDissolvedComponentCount": raw_component_count,
        "deliveredComponentCount": simplified_component_count,
        "rawDissolvedHoleCount": raw_hole_count,
        "deliveredHoleCount": simplified_hole_count,
        "rawSourceVertexCount": sum(
            len(ring) for part in parts for ring in part["coordinates"]
        ),
        "deliveredVertexCount": counts["vertices"],
        "vertexReduction": sum(len(ring) for part in parts for ring in part["coordinates"]) - counts["vertices"],
        "ownCohortAreaFraction": own_fraction,
        "crossCohortAreaFraction": cross_fraction,
        "simplificationToleranceMetres": selected_tolerance,
        "simplificationAttempts": attempts,
        "smallIslandPolicy": limits["smallIslandPolicy"],
        "holePolicy": limits["holePolicy"],
    }


def derive_cob_geometry(own_cohort, policy, plate_id):
    label, cob_id, rule_key = {
        309: ("West Svalbard", WEST_COB_ID, "westCohortExpansion"),
        311: ("East Svalbard", EAST_COB_ID, "eastCohortExpansion"),
    }[plate_id]
    rule = policy[rule_key]
    target_union = unary_union(
        [projected_polygon(pygplates_coordinates(polygon)) for polygon in own_cohort]
    )
    matches = [
        feature
        for feature in pygplates.FeatureCollection(str(CAO / CAO_COB))
        if str(feature.get_feature_id()) == cob_id
        and feature.get_name() == label
        and feature.get_reconstruction_plate_id(None) == plate_id
        and feature.get_valid_time()[0] == 600
    ]
    assert len(matches) == 1, f"{label} closed continental-boundary identity changed"
    cob_geometries = [
        projected_polygon(pygplates_coordinates(geometry))
        for geometry in matches[0].get_all_geometries()
        if isinstance(geometry, pygplates.PolygonOnSphere)
    ]
    assert cob_geometries
    cob_union = unary_union(cob_geometries)
    inside_area = target_union.intersection(cob_union).area
    containment = inside_area / target_union.area
    assert containment >= rule["minimumCobContainmentFraction"]
    raw = target_union.intersection(cob_union)
    delivered = raw.buffer(-rule["insetMetres"]).simplify(
        rule["simplifyMetres"], preserve_topology=True
    )
    assert not delivered.is_empty and delivered.is_valid
    outside_target = delivered.difference(target_union).area
    outside_cob = delivered.difference(cob_union).area
    loss = 1 - delivered.area / raw.area
    assert outside_target <= rule["maximumOutsideTargetSquareMetres"]
    assert outside_cob <= rule["maximumOutsideCobSquareMetres"]
    assert loss <= rule["maximumAbsoluteAreaLossFraction"]
    coordinates = [polygon_coordinates(polygon) for polygon in geometry_polygons(delivered)]
    counts = geometry_counts(coordinates)
    return coordinates, {
        "derivation": rule["operation"],
        "targetUnionAreaSquareKilometres": target_union.area / 1_000_000,
        "cobIntersectionAreaSquareKilometres": inside_area / 1_000_000,
        "targetInsideCobFraction": containment,
        "deliveredAreaSquareKilometres": delivered.area / 1_000_000,
        "areaLossFraction": loss,
        "outsideTargetSquareMetres": outside_target,
        "outsideCobSquareMetres": outside_cob,
        "rawDissolvedComponentCount": len(geometry_polygons(raw)),
        "deliveredComponentCount": counts["polygonComponents"],
        "rawDissolvedHoleCount": sum(len(polygon.interiors) for polygon in geometry_polygons(raw)),
        "deliveredHoleCount": counts["holes"],
        "rawSourceVertexCount": sum(
            sum(len(ring) for ring in pygplates_coordinates(polygon))
            for polygon in own_cohort
        ),
        "deliveredVertexCount": counts["vertices"],
        "vertexReduction": sum(
            sum(len(ring) for ring in pygplates_coordinates(polygon))
            for polygon in own_cohort
        ) - counts["vertices"],
        "simplificationToleranceMetres": rule["simplifyMetres"],
        "cobSourceFeatureId": cob_id,
        "cobSourceValidTimeMa": {"youngest": None, "oldest": 600},
    }


def pygplates_coordinates(polygon: pygplates.PolygonOnSphere):
    def ring(points):
        result = [[point.to_lat_lon()[1], point.to_lat_lon()[0]] for point in points]
        if result[0] != result[-1]:
            result.append(result[0])
        return result
    return [
        ring(polygon.get_exterior_ring_points()),
        *[
            ring(polygon.get_interior_ring_points(index))
            for index in range(polygon.get_number_of_interior_rings())
        ],
    ]


def active(feature: pygplates.Feature, age: float) -> bool:
    oldest, youngest = feature.get_valid_time()
    return youngest <= age <= oldest


def strict_rotation(model: pygplates.RotationModel, age: float, plate_id: int):
    try:
        return model.get_rotation(age, plate_id, use_identity_for_missing_plate_ids=False)
    except pygplates.RotationModel.RotationNotFoundError:
        return None


def target_geometry_hash(patch: dict[str, object], directions: bytes) -> str:
    digest = hashlib.sha256()
    digest.update(DOMAIN)
    for ring in patch["rings"]:
        offset = ring["offset"] * 12
        count = ring["count"]
        chunk = directions[offset : offset + count * 12]
        assert len(chunk) == count * 12
        digest.update(struct.pack("<I", count))
        digest.update(chunk)
    return digest.hexdigest()


def source_targets() -> tuple[dict[int, list[pygplates.PolygonOnSphere]], list[dict[str, object]]]:
    raw = (CAO / "shapes_coasts.gpmlz").read_bytes()
    assert sha256(raw) == CAO_COAST_SHA
    staged = json.loads((STAGED / "coast-patches.json").read_text())
    directions = (STAGED / "coast-reference-directions.f32").read_bytes()
    patches = {patch["chartId"]: patch for patch in staged["patches"]}
    cohorts = {plate_id: [] for plate_id in TARGET_NAMES}
    targets = []
    for feature_order, feature in enumerate(pygplates.FeatureCollection(str(CAO / "shapes_coasts.gpmlz"))):
        plate_id = feature.get_reconstruction_plate_id(None)
        if plate_id not in TARGET_NAMES or feature.get_name() != TARGET_NAMES[plate_id]:
            continue
        if feature.get_valid_time()[0] != 410:
            continue
        for geometry_order, geometry in enumerate(feature.get_all_geometries()):
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            cohorts[plate_id].append(geometry)
            feature_id = str(feature.get_feature_id())
            chart_id = f"cao-coast:{feature_id}:{feature_order}:{geometry_order}"
            patch = patches[chart_id]
            targets.append(
                {
                    "chartId": chart_id,
                    "featureId": feature_id,
                    "featureOrder": feature_order,
                    "geometryOrder": geometry_order,
                    "plateId": plate_id,
                    "geometryHash": target_geometry_hash(patch, directions),
                    "originalInterval": {"youngestAgeMa": 0, "oldestAgeMa": 410},
                    "expectedMatches": 1,
                }
            )
    assert {plate_id: len(rows) for plate_id, rows in cohorts.items()} == {309: 5, 311: 6}
    assert len(targets) == 11
    return cohorts, targets


def verify_source() -> tuple[dict[str, object], dict[str, object]]:
    manifest = json.loads((SOURCE / "source-manifest.json").read_text())
    for name, expected in manifest["files"].items():
        data = (SOURCE / name).read_bytes()
        assert len(data) == expected["bytes"] and sha256(data) == expected["sha256"]
    source = json.loads((SOURCE / SOURCE_GEOJSON).read_text())
    assert len(source["features"]) == manifest["source"]["featureCount"] == 4237
    assert manifest["rights"]["license"].endswith("(CC BY 4.0)")
    assert manifest["rights"]["requiredAttribution"] == "© Norwegian Polar Institute"
    return manifest, source


def choose_parts(source: dict[str, object], cohorts: dict[int, list[pygplates.PolygonOnSphere]]):
    selected = {309: [], 311: []}
    unit_rows = {309: defaultdict(lambda: {"objectIds": [], "polygonCount": 0, "areaSteradians": 0.0}),
                 311: defaultdict(lambda: {"objectIds": [], "polygonCount": 0, "areaSteradians": 0.0})}
    exclusions = defaultdict(int)
    eligibility_feature_counts = defaultdict(int)
    for feature in source["features"]:
        properties = feature["properties"]
        age = (properties.get("AGE_PERIOD") or "").strip()
        if age not in ELIGIBLE_AGES:
            exclusions[f"age-not-certainly-pre-540:{age or 'blank'}"] += 1
            continue
        eligibility_feature_counts[age] += 1
        for part_order, coordinates in enumerate(polygon_parts(feature["geometry"])):
            polygon = on_sphere(coordinates)
            centroid = polygon.get_interior_centroid()
            centroid_hits = [
                plate_id
                for plate_id, geometries in cohorts.items()
                if any(geometry.is_point_in_polygon(centroid) for geometry in geometries)
            ]
            if len(centroid_hits) != 1:
                exclusions["eligible-part-centroid-outside-or-ambiguous-cao-cohort"] += 1
                continue
            plate_id = centroid_hits[0]
            other_plate = 620 - plate_id
            exterior = coordinates[0][:-1] if coordinates[0][0] == coordinates[0][-1] else coordinates[0]
            points = [pygplates.PointOnSphere(point[1], point[0]) for point in exterior]
            own_count = sum(
                any(geometry.is_point_in_polygon(point) for geometry in cohorts[plate_id]) for point in points
            )
            other_count = sum(
                any(geometry.is_point_in_polygon(point) for geometry in cohorts[other_plate]) for point in points
            )
            if other_count or own_count / len(points) < 0.5:
                exclusions["eligible-part-insufficient-or-cross-cohort-membership"] += 1
                continue
            selected[plate_id].append(
                {
                    "coordinates": coordinates,
                    "sourceObjectId": properties["OBJECTID"],
                    "sourcePartOrder": part_order,
                    "sourceUnitName": properties["NAME"],
                    "sourceGeoCode": properties["GEO_CODE"],
                    "sourceAgePeriod": age,
                    "sourceMainLithology": properties.get("MAIN_LITHO"),
                    "sourceDatingMethod": properties.get("DATING_MET"),
                    "sourceReference": properties.get("REFERENCE"),
                    "polygon": polygon,
                }
            )
            unit_key = (
                properties["GEO_CODE"],
                properties["NAME"],
                age,
                properties.get("MAIN_LITHO"),
                properties.get("DATING_MET"),
                properties.get("REFERENCE"),
            )
            row = unit_rows[plate_id][unit_key]
            row["objectIds"].append(properties["OBJECTID"])
            row["polygonCount"] += 1
            row["areaSteradians"] += polygon.get_area()
    assert len(selected[309]) > 0 and len(selected[311]) > 0
    units = {}
    for plate_id, grouped in unit_rows.items():
        units[plate_id] = []
        for key, values in sorted(grouped.items()):
            code, name, age, lithology, dating, reference = key
            units[plate_id].append(
                {
                    "geoCode": code,
                    "name": name,
                    "agePeriod": age,
                    "mainLithology": lithology,
                    "datingMethod": dating,
                    "sourceReference": reference,
                    "sourceObjectIds": sorted(set(values["objectIds"])),
                    "polygonCount": values["polygonCount"],
                    "areaSteradians": values["areaSteradians"],
                    "reason": "mapped unit age ends before 540 Ma and its polygon passes conservative Cao cohort membership",
                }
            )
    return selected, units, dict(sorted(exclusions.items())), dict(sorted(eligibility_feature_counts.items()))


def selected_unit_rows(selected):
    units = {}
    for plate_id, parts in selected.items():
        grouped = defaultdict(lambda: {"objectIds": [], "polygonCount": 0, "areaSteradians": 0.0})
        for part in parts:
            key = (
                part["sourceGeoCode"],
                part["sourceUnitName"],
                part["sourceAgePeriod"],
                part["sourceMainLithology"],
                part["sourceDatingMethod"],
                part["sourceReference"],
            )
            row = grouped[key]
            row["objectIds"].append(part["sourceObjectId"])
            row["polygonCount"] += 1
            row["areaSteradians"] += part["polygon"].get_area()
        units[plate_id] = []
        for key, values in sorted(grouped.items()):
            code, name, age, lithology, dating, reference = key
            units[plate_id].append(
                {
                    "geoCode": code,
                    "name": name,
                    "agePeriod": age,
                    "mainLithology": lithology,
                    "datingMethod": dating,
                    "sourceReference": reference,
                    "sourceObjectIds": sorted(set(values["objectIds"])),
                    "polygonCount": values["polygonCount"],
                    "areaSteradians": values["areaSteradians"],
                    "reason": "mapped unit age ends before 540 Ma and its polygon passes conservative Cao cohort membership and equal-area containment",
                }
            )
    return units


def area_metrics(parts, own_union, cross_union):
    projected = [projected_polygon(part["coordinates"]) for part in parts]
    per_part = []
    for part, polygon in zip(parts, projected):
        area = polygon.area
        assert area > 0
        per_part.append(
            {
                "sourceObjectId": part["sourceObjectId"],
                "sourcePartOrder": part["sourcePartOrder"],
                "areaSquareKilometres": area / 1_000_000,
                "ownCohortAreaFraction": polygon.intersection(own_union).area / area,
                "crossCohortAreaFraction": polygon.intersection(cross_union).area / area,
            }
        )
    candidate_union = unary_union(projected)
    sum_area = sum(polygon.area for polygon in projected)
    union_area = candidate_union.area
    assert sum_area > 0 and union_area > 0
    return {
        "partCount": len(parts),
        "sumPartAreaSquareKilometres": sum_area / 1_000_000,
        "unionAreaSquareKilometres": union_area / 1_000_000,
        "selectedUnionOverlapFraction": (sum_area - union_area) / sum_area,
        "ownCohortIntersectionSquareKilometres": candidate_union.intersection(own_union).area / 1_000_000,
        "ownCohortAreaFraction": candidate_union.intersection(own_union).area / union_area,
        "crossCohortIntersectionSquareKilometres": candidate_union.intersection(cross_union).area / 1_000_000,
        "crossCohortAreaFraction": candidate_union.intersection(cross_union).area / union_area,
        "outsideOwnCohortSquareKilometres": candidate_union.difference(own_union).area / 1_000_000,
        "outsideBothCohortsSquareKilometres": candidate_union.difference(own_union.union(cross_union)).area / 1_000_000,
        "minimumPartOwnCohortAreaFraction": min(row["ownCohortAreaFraction"] for row in per_part),
        "maximumPartCrossCohortAreaFraction": max(row["crossCohortAreaFraction"] for row in per_part),
        "perPart": per_part,
    }


def reference_area_qualification(selected, cohorts, exclusions):
    policy = json.loads((OUT / "qualification-policy.json").read_text())
    initial_limits = policy["initialCandidateAcceptance"]
    final_limits = policy["predeclaredFallback"]
    record = {
        "policyPath": "qualification-policy.json",
        "policyWrittenBeforeMeasurement": policy["writtenBeforeMeasurement"],
        "projection": policy["measurement"]["projection"],
        "earthRadiusMetres": policy["measurement"]["earthRadiusMetres"],
        "cohorts": {},
    }
    qualified = {}
    for plate_id, parts in selected.items():
        valid_parts = []
        invalid_parts = []
        for part in parts:
            rings = [
                [laea_xy(point[0], point[1]) for point in ring]
                for ring in part["coordinates"]
            ]
            projected = Polygon(rings[0], rings[1:])
            if projected.is_valid and not projected.is_empty:
                valid_parts.append(part)
            else:
                invalid_parts.append(
                    {
                        "sourceObjectId": part["sourceObjectId"],
                        "sourcePartOrder": part["sourcePartOrder"],
                        "reason": "invalid in the predeclared equal-area measurement projection",
                    }
                )
        exclusions["eligible-part-invalid-in-equal-area-projection"] = (
            exclusions.get("eligible-part-invalid-in-equal-area-projection", 0)
            + len(invalid_parts)
        )
        parts = valid_parts
        assert parts, ("invalid geometry qualification removed entire cohort", plate_id)
        own_union = unary_union(
            [projected_polygon(pygplates_coordinates(polygon)) for polygon in cohorts[plate_id]]
        )
        cross_plate = 620 - plate_id
        cross_union = unary_union(
            [projected_polygon(pygplates_coordinates(polygon)) for polygon in cohorts[cross_plate]]
        )
        initial = area_metrics(parts, own_union, cross_union)
        initial_pass = (
            initial["minimumPartOwnCohortAreaFraction"] >= initial_limits["minimumEachPartOwnCohortAreaFraction"]
            and initial["maximumPartCrossCohortAreaFraction"] <= initial_limits["maximumEachPartCrossCohortAreaFraction"]
            and initial["ownCohortAreaFraction"] >= initial_limits["minimumOwnCohortAreaFraction"]
            and initial["crossCohortAreaFraction"] <= initial_limits["maximumCrossCohortAreaFraction"]
            and initial["selectedUnionOverlapFraction"] <= initial_limits["maximumSelectedUnionOverlapFraction"]
        )
        retained = parts
        removed = []
        if not initial_pass:
            retained = []
            for part, metrics in zip(parts, initial["perPart"]):
                if (
                    metrics["ownCohortAreaFraction"] >= final_limits["minimumEachRetainedPartOwnCohortAreaFraction"]
                    and metrics["crossCohortAreaFraction"] <= final_limits["maximumEachRetainedPartCrossCohortAreaFraction"]
                ):
                    retained.append(part)
                else:
                    removed.append(
                        {
                            "sourceObjectId": part["sourceObjectId"],
                            "sourcePartOrder": part["sourcePartOrder"],
                            "ownCohortAreaFraction": metrics["ownCohortAreaFraction"],
                            "crossCohortAreaFraction": metrics["crossCohortAreaFraction"],
                        }
                    )
            exclusions["eligible-part-excluded-by-predeclared-equal-area-containment"] = (
                exclusions.get("eligible-part-excluded-by-predeclared-equal-area-containment", 0)
                + len(removed)
            )
        assert retained, ("area qualification removed entire cohort", plate_id)
        final = area_metrics(retained, own_union, cross_union)
        assert final["minimumPartOwnCohortAreaFraction"] >= final_limits["minimumEachRetainedPartOwnCohortAreaFraction"]
        assert final["maximumPartCrossCohortAreaFraction"] <= final_limits["maximumEachRetainedPartCrossCohortAreaFraction"]
        assert final["ownCohortAreaFraction"] >= final_limits["minimumFinalOwnCohortAreaFraction"]
        assert final["crossCohortAreaFraction"] <= final_limits["maximumFinalCrossCohortAreaFraction"]
        assert final["selectedUnionOverlapFraction"] <= final_limits["maximumFinalSelectedUnionOverlapFraction"]
        record["cohorts"][str(plate_id)] = {
            "invalidPartsExcludedWithoutRepair": invalid_parts,
            "initialAccepted": initial_pass,
            "initial": initial,
            "fallbackOperationApplied": not initial_pass,
            "removedParts": removed,
            "final": final,
            "accepted": True,
        }
        qualified[plate_id] = retained
    return qualified, record


def angular_degrees(a: pygplates.PointOnSphere, b: pygplates.PointOnSphere) -> float:
    return math.degrees(pygplates.GeometryOnSphere.distance(a, b))


def actual_native_overlap(candidate_polygons, native_rows):
    centre_lat, centre_lon = candidate_polygons[0].get_interior_centroid().to_lat_lon()
    candidate_union = unary_union(
        [
            projected_polygon(pygplates_coordinates(polygon), centre_lon, centre_lat)
            for polygon in candidate_polygons
        ]
    )
    overlapping_native = []
    source_counts = Counter()
    for feature, native in native_rows:
        if any(
            pygplates.GeometryOnSphere.distance(
                candidate,
                native,
                1e-12,
                geometry1_is_solid=True,
                geometry2_is_solid=True,
            )
            is not None
            for candidate in candidate_polygons
        ):
            overlapping_native.append(
                projected_polygon(pygplates_coordinates(native), centre_lon, centre_lat)
            )
            source_counts[
                (
                    str(feature.get_feature_id()),
                    feature.get_name() or None,
                    feature.get_reconstruction_plate_id(None),
                )
            ] += 1
    if overlapping_native:
        native_union = unary_union(overlapping_native)
        intersection_area = candidate_union.intersection(native_union).area
    else:
        intersection_area = 0.0
    return {
        "candidateUnionAreaSquareKilometres": candidate_union.area / 1_000_000,
        "intersectionAreaSquareKilometres": intersection_area / 1_000_000,
        "candidateAreaFraction": intersection_area / candidate_union.area,
        "intersectingNativePolygonCount": len(overlapping_native),
        "intersectingSources": [
            {
                "featureId": key[0],
                "name": key[1],
                "plateId": key[2],
                "polygonCount": count,
            }
            for key, count in source_counts.most_common()
        ],
        "method": "spherical solid-polygon intersection candidate filter, followed by union/intersection area in an age- and cohort-centred spherical Lambert azimuthal equal-area projection",
        "numericalLimit": "intersection areas use a spherical Earth and planar Shapely operations after local equal-area projection; boundaries closer than the 1e-12-radian spherical filter tolerance can be treated as touching",
    }


def validation(selected, delivered_coordinates, rotation_model, targets):
    source_collections = {}
    for collection in ("shapes_coasts.gpmlz", "shapes_continents.gpmlz", "static_polygons.gpmlz"):
        source_collections[collection] = list(pygplates.FeatureCollection(str(CAO / collection)))
    overlap = {}
    for age in AGES:
        collections_at_age = {}
        for collection, features in source_collections.items():
            reconstructed = []
            usable = [
                feature
                for feature in features
                if active(feature, age)
                and strict_rotation(rotation_model, age, feature.get_reconstruction_plate_id(None)) is not None
            ]
            pygplates.reconstruct(usable, rotation_model, reconstructed, age)
            collections_at_age[collection] = [
                (row.get_feature(), row.get_reconstructed_geometry())
                for row in reconstructed
                if isinstance(row.get_reconstructed_geometry(), pygplates.PolygonOnSphere)
            ]
        overlap[str(age)] = {}
        for plate_id, parts in selected.items():
            rotation = strict_rotation(rotation_model, age, plate_id)
            assert rotation is not None
            candidate_polygons = [
                rotation * on_sphere(coordinates)
                for coordinates in delivered_coordinates[plate_id]
            ]
            by_collection = {}
            exact_by_collection = {}
            for collection, native_rows in collections_at_age.items():
                centroid_hits = 0
                vertex_hits = 0
                centroid_sources = Counter()
                for candidate in candidate_polygons:
                    centroid = candidate.get_interior_centroid()
                    hits = [(feature, native) for feature, native in native_rows if native.is_point_in_polygon(centroid)]
                    if hits:
                        centroid_hits += 1
                        for feature, _ in hits:
                            centroid_sources[
                                (
                                    str(feature.get_feature_id()),
                                    feature.get_name() or None,
                                    feature.get_reconstruction_plate_id(None),
                                )
                            ] += 1
                    samples = list(candidate.get_exterior_ring_points())[:: max(1, len(candidate.get_exterior_ring_points()) // 12)]
                    if any(any(native.is_point_in_polygon(point) for _, native in native_rows) for point in samples):
                        vertex_hits += 1
                by_collection[collection] = {
                    "candidateParts": len(candidate_polygons),
                    "partsWithCentroidInNativePolygon": centroid_hits,
                    "partsWithSampleVertexInNativePolygon": vertex_hits,
                    "centroidHitSources": [
                        {
                            "featureId": key[0],
                            "name": key[1],
                            "plateId": key[2],
                            "candidateCentroidCount": count,
                        }
                        for key, count in centroid_sources.most_common()
                    ],
                }
                exact_by_collection[collection] = actual_native_overlap(
                    candidate_polygons, native_rows
                )
            overlap[str(age)][str(plate_id)] = {
                "screen": by_collection,
                "areaQualification": exact_by_collection,
            }

    continuity = {}
    for plate_id, parts in selected.items():
        witness = parts[0]["polygon"].get_interior_centroid()
        positions = {}
        for age in AGES:
            point = strict_rotation(rotation_model, age, plate_id) * witness
            lat, lon = point.to_lat_lon()
            positions[str(age)] = [lon, lat]
        jumps = {}
        for boundary in (410.0, 430.0):
            younger = strict_rotation(rotation_model, boundary, plate_id) * witness
            older = strict_rotation(rotation_model, boundary + 0.001, plate_id) * witness
            jumps[f"{boundary}-to-{boundary + 0.001}"] = angular_degrees(younger, older)
        continuity[str(plate_id)] = {
            "modernWitnessLongitudeLatitude": list(reversed(witness.to_lat_lon())),
            "positionsLongitudeLatitude": positions,
            "boundaryStepAngularDegrees": jumps,
        }

    reference_witnesses = []
    for plate_id, parts in selected.items():
        part = parts[0]
        witness = part["polygon"].get_interior_centroid()
        lat, lon = witness.to_lat_lon()
        reference_witnesses.append(
            {
                "kind": "positive-selected-source-part",
                "plateId": plate_id,
                "longitudeLatitude": [lon, lat],
                "sourceObjectId": part["sourceObjectId"],
                "sourceGeoCode": part["sourceGeoCode"],
                "sourceUnitName": part["sourceUnitName"],
                "sourceAgePeriod": part["sourceAgePeriod"],
            }
        )
    for name, lon, lat in (("Bjørnøya", 19.0182, 74.4467), ("submerged Barents shelf", 30.0, 75.0)):
        point = pygplates.PointOnSphere(lat, lon)
        hits = [
            plate_id
            for plate_id, parts in selected.items()
            if any(part["polygon"].is_point_in_polygon(point) for part in parts)
        ]
        reference_witnesses.append(
            {
                "kind": "negative-reference-witness",
                "name": name,
                "longitudeLatitude": [lon, lat],
                "containingCandidatePlateIds": hits,
            }
        )
    target_counts = defaultdict(int)
    for target in targets:
        target_counts[target["plateId"]] += 1
    return {
        "agesMa": list(AGES),
        "reconstructedNativeOverlapScreen": overlap,
        "poseContinuity": continuity,
        "targetCounts": dict(target_counts),
        "referenceWitnesses": reference_witnesses,
        "overlapMethod": "centroid/vertex results are screens only; acceptance and interpretation use the accompanying union/intersection area measurements",
    }


def source_unit_selection(units, exclusions, eligibility_counts, plate_id):
    return {
        "included": units[plate_id],
        "includedAgeClasses": sorted(ELIGIBLE_AGES),
        "eligibilityRule": "NPI AGE_PERIOD must be an exact, non-questioned class wholly older than the 540 Ma product boundary, followed by conservative spatial membership in the matching Cao Svalbard cohort",
        "eligibleSourceFeatureCountsByAge": eligibility_counts,
        "excluded": [
            {
                "reason": reason,
                "count": count,
            }
            for reason, count in exclusions.items()
        ],
        "materialMeaning": "mapped exposure of pre-540 rock is a witness for old continental material; its modern polygon is neither a 410–540 Ma outcrop nor a palaeoshoreline",
    }


def overlap_policy(validation_record, plate_id):
    age_rows = {}
    for age in AGES:
        measurements = validation_record["reconstructedNativeOverlapScreen"][str(age)][str(plate_id)]["areaQualification"]
        age_rows[str(age)] = {
            collection: {
                "intersectionAreaSquareKilometres": row["intersectionAreaSquareKilometres"],
                "candidateAreaFraction": row["candidateAreaFraction"],
                "intersectingSources": row["intersectingSources"],
            }
            for collection, row in measurements.items()
        }
    return {
        "measuredAgesMa": list(AGES),
        "measurements": age_rows,
        "interpretation": "The correction is a geological-material witness. Overlap with Greenland in Cao continent/static collections indicates containment in an older continental footprint, not an additional independent continent; absence from the coast collection is not evidence of absent older material.",
        "renderRule": "For the baseline coast collection, render the correction only while its targets are inactive. If a continent/static material footprint is rendered instead, suppress this correction where covered or union/deduplicate it before drawing.",
        "stopCondition": "Do not co-render this mask additively over an active native continent/static material footprint.",
    }


def validate_candidate(manifest, geojson, geojson_bytes, source, expected_targets) -> None:
    assert manifest["baseline"]["sourceSha256"] == CAO_COAST_SHA
    assert manifest["baseline"]["coordinateFrame"]["anchorPlateId"] == 0
    by_object_id = {feature["properties"]["OBJECTID"]: feature for feature in source["features"]}
    geo_features = {feature["id"]: feature for feature in geojson["features"]}
    assert len(geo_features) == 2
    expected_by_patch = {target["chartId"]: target for target in expected_targets}
    cohorts, _ = source_targets()
    policy = json.loads((OUT / "qualification-policy.json").read_text())
    seen_targets = set()
    seen_members = set()
    for feature in manifest["features"]:
        feature_id = feature["correctionFeatureId"]
        plate_id = feature["plateId"]
        assert plate_id in (309, 311)
        assert feature["coordinateFrame"] == "WGS84-reference-coordinates"
        assert feature["geometryReferenceAgeMa"] == 0
        assert feature["pose"]["plateId"] == plate_id
        assert feature["pose"]["method"] == "cao-rigid-plate-motion"
        assert feature["materialRole"] == "continental-material-support"
        assert feature["activationRule"] == "target-inactive-only"
        assert feature["poseConfidenceIntervalsMa"] == [
            {"youngest": 410, "oldest": 430, "youngestExclusive": True, "status": "qualified"},
            {"youngest": 430, "oldest": 540, "youngestExclusive": True, "status": "uncertain-continuation"},
        ]
        assert feature["uncertaintyDisplay"] == {"olderThanMa": 430, "style": "uncertain"}
        assert feature["supportIntervalMa"] == {
            "youngest": 410,
            "oldest": 540,
            "youngestExclusive": True,
        }
        assert feature["olderEdgePolicy"] == "qualified-through-product-oldest-age"
        assert feature["epistemicStatus"] == "model-inference"
        assert feature["surfaceEvidence"]["kind"] == "unknown"
        assert feature["uncertainty"]["exposure"]
        asset = feature["geometryAsset"]
        assert asset["sha256"] == sha256(geojson_bytes)
        assert asset["featureId"] == feature_id
        geo_feature = geo_features[feature_id]
        assert geo_feature["properties"]["plateId"] == plate_id
        coordinates = geo_feature["geometry"]["coordinates"]
        members = geo_feature["properties"]["sourceMembers"]
        assert len(members) == geo_feature["properties"]["sourcePolygonCount"]
        source_parts_for_derivation = []
        for member in members:
            member_key = (member["objectId"], member["partOrder"])
            assert member_key not in seen_members
            seen_members.add(member_key)
            source_feature = by_object_id[member["objectId"]]
            assert (source_feature["properties"].get("AGE_PERIOD") or "").strip() in ELIGIBLE_AGES
            source_parts = polygon_parts(source_feature["geometry"])
            assert 0 <= member["partOrder"] < len(source_parts)
            source_coordinates = source_parts[member["partOrder"]]
            source_parts_for_derivation.append(
                {
                    "coordinates": source_coordinates,
                    "sourceObjectId": member["objectId"],
                    "sourcePartOrder": member["partOrder"],
                }
            )
        expected_coordinates, expected_metrics = derive_cob_geometry(
            cohorts[plate_id], policy, plate_id
        )
        assert coordinates == expected_coordinates
        assert geo_feature["properties"]["derivedComponentCount"] == len(coordinates)
        assert feature["geometryProcessing"] == expected_metrics
        for target in feature["targets"]:
            assert target["patchId"] not in seen_targets
            seen_targets.add(target["patchId"])
            expected = expected_by_patch[target["patchId"]]
            assert target == {
                "patchId": expected["chartId"],
                "sourceFeatureId": expected["featureId"],
                "sourceFeatureOrder": expected["featureOrder"],
                "geometryOrder": expected["geometryOrder"],
                "plateId": expected["plateId"],
                "geometrySha256": expected["geometryHash"],
                "originalValidTimeMa": {"youngest": None, "oldest": 410},
                "expectedMatches": 1,
            }
    assert seen_targets == set(expected_by_patch)
    assert sum(
        geometry_counts(feature["geometry"]["coordinates"])["vertices"]
        for feature in geojson["features"]
    ) <= policy["deliveredGeometry"]["maximumTotalOutputVertices"]
    for lon, lat in ((30.0, 75.0),):
        point = pygplates.PointOnSphere(lat, lon)
        assert not any(
            on_sphere(part).is_point_in_polygon(point)
            for feature in geojson["features"]
            for part in feature["geometry"]["coordinates"]
        )


def main() -> None:
    source_manifest, source = verify_source()
    cohorts, targets = source_targets()
    selected, _units, exclusions, eligibility_counts = choose_parts(source, cohorts)
    selected, area_qualification = reference_area_qualification(selected, cohorts, exclusions)
    units = selected_unit_rows(selected)
    policy = json.loads((OUT / "qualification-policy.json").read_text())
    delivered_coordinates = {}
    geometry_processing = {}
    for plate_id in (309, 311):
        delivered_coordinates[plate_id], geometry_processing[plate_id] = derive_cob_geometry(
            cohorts[plate_id], policy, plate_id
        )
    assert sum(
        geometry_counts(coordinates)["vertices"]
        for coordinates in delivered_coordinates.values()
    ) <= policy["deliveredGeometry"]["maximumTotalOutputVertices"]
    features = []
    for plate_id in (309, 311):
        feature_id = f"svalbard-pre-540-material-plate-{plate_id}"
        features.append(
            {
                "type": "Feature",
                "id": feature_id,
                "properties": {
                    "correctionFeatureId": feature_id,
                    "plateId": plate_id,
                    "sourcePolygonCount": len(selected[plate_id]),
                    "derivedComponentCount": len(delivered_coordinates[plate_id]),
                    "sourceMembers": [
                        {
                            "objectId": part["sourceObjectId"],
                            "partOrder": part["sourcePartOrder"],
                        }
                        for part in selected[plate_id]
                    ],
                    "materialRole": "continental-material-support",
                    "epistemicStatus": "model-inference",
                    "surfaceEvidence": "unknown",
                },
                "geometry": {
                    "type": "MultiPolygon",
                    "coordinates": delivered_coordinates[plate_id],
                },
            }
        )
    geojson = {
        "type": "FeatureCollection",
        "name": "EarthHistory conservative Svalbard pre-540 material witnesses",
        "features": features,
    }
    geojson_bytes = canonical_json(geojson)
    asset_sha = sha256(geojson_bytes)
    rotation_model = pygplates.RotationModel(
        [str(CAO / "1000_0_rotfile.rot"), str(CAO / "1800_1000_rotfile.rot")],
        default_anchor_plate_id=0,
    )
    validation_record = validation(selected, delivered_coordinates, rotation_model, targets)
    target_by_plate = defaultdict(list)
    for target in targets:
        target_by_plate[target["plateId"]].append(
            {
                "patchId": target["chartId"],
                "sourceFeatureId": target["featureId"],
                "sourceFeatureOrder": target["featureOrder"],
                "geometryOrder": target["geometryOrder"],
                "plateId": target["plateId"],
                "geometrySha256": target["geometryHash"],
                "originalValidTimeMa": {"youngest": None, "oldest": 410},
                "expectedMatches": target["expectedMatches"],
            }
        )
    correction_features = []
    for plate_id in (309, 311):
        feature_id = f"svalbard-pre-540-material-plate-{plate_id}"
        correction_features.append(
            {
                "correctionFeatureId": feature_id,
                "targets": target_by_plate[plate_id],
                "geometryAsset": {
                    "path": "svalbard-pre-540-material.geojson",
                    "sha256": asset_sha,
                    "featureId": feature_id,
                },
                "plateId": plate_id,
                "geometryReferenceAgeMa": 0,
                "coordinateFrame": "WGS84-reference-coordinates",
                "materialRole": "continental-material-support",
                "geometryProcessing": geometry_processing[plate_id],
                "supportIntervalMa": {"youngest": 410, "oldest": 540, "youngestExclusive": True},
                "activationRule": "target-inactive-only",
                "poseConfidenceIntervalsMa": [
                    {
                        "youngest": 410,
                        "oldest": 430,
                        "youngestExclusive": True,
                        "status": "qualified",
                    },
                    {
                        "youngest": 430,
                        "oldest": 540,
                        "youngestExclusive": True,
                        "status": "uncertain-continuation",
                    },
                ],
                "uncertaintyDisplay": {"olderThanMa": 430, "style": "uncertain"},
                "sourceUnitSelection": {
                    **source_unit_selection(units, exclusions, eligibility_counts, plate_id),
                    "footprintInference": f"the complete guarded {TARGET_NAMES[plate_id]} target footprint is inside its separately authored valid-to-600 Ma closed continental boundary; mapped younger cover and ice locate inferred substrate but are not backdated as surface rock",
                    "evidenceTier": "older-continental-boundary-plus-regional-affinity-substrate-inference",
                },
                "epistemicStatus": "model-inference",
                "surfaceEvidence": {
                    "kind": "unknown",
                    "reason": f"mapped old rocks and the valid-to-600 Ma {TARGET_NAMES[plate_id]} closed continental boundary support older substrate beneath younger cover and ice; no dated palaeoshoreline or height evidence",
                },
                "olderEdgePolicy": "qualified-through-product-oldest-age",
                "pose": {
                    "plateId": plate_id,
                    "method": "cao-rigid-plate-motion",
                    "sourceOrHypothesis": "model-output; geological sources support material affinity, not exact pose",
                },
                "overlapPolicy": overlap_policy(validation_record, plate_id),
                "uncertainty": {
                    "spatial": f"low confidence; guarded {TARGET_NAMES[plate_id]} target footprint inside its separately authored valid-to-600 Ma continental boundary, supported by NPI old-unit witnesses and regional affinity",
                    "temporal": "selected mapped rock units predate 540 Ma; regional affinity is best constrained near 410–430 Ma, while rigid pose farther back to 540 Ma is lower-confidence Cao model output",
                    "terrane": "West/East cohort assignment follows Cao source geometry; internal Svalbard terrane correlations remain debated",
                    "exposure": "unknown at all reconstructed ages; the polygons must not be interpreted as emergent land or a palaeoshoreline",
                },
                "sourceIds": [
                    "npi-svalbard-geology-1-750k",
                    "cao-2024-v2.4",
                    "cao-2024-v2.4-cob",
                ],
                "rejectionConditions": [
                    f"{TARGET_NAMES[plate_id]} target union is not at least 99.9% contained by its exact valid-to-600 Ma closed continental boundary",
                    f"guarded {TARGET_NAMES[plate_id]} geometry leaves either its immutable Cao target or closed continental boundary",
                    "candidate is rendered or described as exposed land, ancient shoreline, or positive palaeotopography",
                    "strict Cao motion is missing or a 410/430 parent-switch step exceeds the recorded tolerance",
                    "candidate creates a new hard material-absence boundary inside the 0–540 Ma product domain",
                ],
            }
        )
    manifest = {
        "schemaVersion": 1,
        "correctionId": "earthhistory-regional-svalbard-material-v1",
        "version": 3,
        "baseline": {
            "modelId": "cao-et-al-2024",
            "modelVersion": "2.4",
            "sourceCollection": "shapes_coasts.gpmlz",
            "sourceSha256": CAO_COAST_SHA,
            "coordinateFrame": {
                "absoluteFrameId": "palaeomagnetic",
                "anchorPlateId": 0,
                "axisConvention": "gplates-x0e-y90e-znorth",
                "rotationSha256": "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f",
                "topologySha256": "411bd3e5e5a2004ea42792a5c1be11942a46b52e3657efdb06507c147fbfdf1a",
            },
        },
        "sourceAssets": [
            {
                "sourceId": "npi-svalbard-geology-1-750k",
                "title": source_manifest["source"]["title"],
                "citation": "Norwegian Polar Institute, Geology Svalbard, Geological units at 1:750,000, ArcGIS layer 10",
                "url": source_manifest["source"]["layerUrl"],
                "query": source_manifest["source"]["queryPolicy"],
                "retrievedAt": source_manifest["retrievalDate"],
                "publicationOrVersionDate": "scientific map version/edit date not reported; hash-pinned retrieval 2026-09-12",
                "evidenceRole": "geological-unit-extent",
                "bytes": source_manifest["files"][SOURCE_GEOJSON]["bytes"],
                "sha256": source_manifest["files"][SOURCE_GEOJSON]["sha256"],
                "license": source_manifest["rights"]["license"],
                "licenseUrl": source_manifest["rights"]["licenseUrl"],
                "attribution": source_manifest["rights"]["requiredAttribution"],
                "scientificVersion": source_manifest["source"]["scientificMapVersionOrEditDate"],
                "versionLimitation": source_manifest["source"]["versionLimitation"],
            },
            {
                "sourceId": "cao-2024-v2.4-cob",
                "title": "Cao et al. v2.4 closed continental-boundary collection",
                "citation": "Cao et al. (2024), Earth's tectonic and plate boundary evolution over 1.8 billion years, model v2.4, doi:10.5281/zenodo.13628813",
                "url": "https://doi.org/10.5281/zenodo.13628813",
                "retrievedAt": "2026-09-09",
                "publicationOrVersionDate": "2024-09-03",
                "evidenceRole": "continental-or-crustal-extent",
                "bytes": (CAO / CAO_COB).stat().st_size,
                "sha256": sha256((CAO / CAO_COB).read_bytes()),
                "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
                "attribution": "Cao et al. (2024) model v2.4 contributors"
            }
        ],
        "features": correction_features,
        "attribution": "Contains information from © Norwegian Polar Institute, licensed CC BY 4.0.",
    }
    validate_candidate(manifest, geojson, geojson_bytes, source, targets)
    selected_area_by_plate_and_age = {}
    for plate_id, parts in selected.items():
        grouped = defaultdict(float)
        for part in parts:
            grouped[part["sourceAgePeriod"]] += part["polygon"].get_area() * EARTH_KM**2
        selected_area_by_plate_and_age[str(plate_id)] = dict(sorted(grouped.items()))
    selected_spherical_area = sum(
        part["polygon"].get_area() * EARTH_KM**2
        for parts in selected.values()
        for part in parts
    )
    delivered_area = sum(value["deliveredAreaSquareKilometres"] for value in geometry_processing.values())
    svalbard_target_area = sum(
        polygon.get_area() * EARTH_KM**2
        for polygons in cohorts.values()
        for polygon in polygons
    )
    barents_target_area = BARENTS_40_TARGET_AREA_STERADIANS * EARTH_KM**2
    validation_record.update(
        {
            "schemaVersion": 1,
            "correctionId": manifest["correctionId"],
            "sourceFeatureCount": len(source["features"]),
            "selectedPartCounts": {str(key): len(value) for key, value in selected.items()},
            "selectedAreaSquareKilometres": {
                str(key): sum(part["polygon"].get_area() for part in value) * EARTH_KM**2
                for key, value in selected.items()
            },
            "selectedSphericalAreaSquareKilometresByPlateAndNpiAgeClass": selected_area_by_plate_and_age,
            "coverage": {
                "deliveredMaskAreaSquareKilometres": delivered_area,
                "selectedSourcePartSphericalAreaSquareKilometres": selected_spherical_area,
                "elevenSvalbardTargetSummedAreaSquareKilometres": svalbard_target_area,
                "fractionOfElevenSvalbardTargetSummedArea": delivered_area / svalbard_target_area,
                "residualElevenSvalbardTargetSummedAreaSquareKilometres": svalbard_target_area - delivered_area,
                "fortyBarentsTargetSummedAreaSquareKilometres": barents_target_area,
                "fractionOfFortyBarentsTargetSummedArea": delivered_area / barents_target_area,
                "residualFortyBarentsTargetSummedAreaSquareKilometres": barents_target_area - delivered_area,
                "comparisonLimit": "Denominators sum Cao spherical target-part areas; the delivered numerator is an equal-area simplified union. These are scale indicators, not exact set coverage or a claim that unfilled target area lacks continental crust.",
            },
            "sourceEligibilityFeatureCountsByAge": eligibility_counts,
            "exclusionCounts": exclusions,
            "referenceSpaceAreaQualification": area_qualification,
            "geometryAssetSha256": asset_sha,
            "geometryProcessing": {
                "operation": "intersect each exact Cao Svalbard target with its matching valid-to-600 Ma closed continental boundary, inset 1500 m, and simplify 500 m with topology preservation",
                "projection": policy["measurement"]["projection"],
                "toleranceSelectionRule": "fixed per-cohort target/boundary expansion rules; preliminary NPI simplification ladder remains only as affinity-witness qualification history",
                "byPlate": {str(key): value for key, value in geometry_processing.items()},
                "totalRawSourceVertices": sum(value["rawSourceVertexCount"] for value in geometry_processing.values()),
                "totalDeliveredVertices": sum(value["deliveredVertexCount"] for value in geometry_processing.values()),
                "totalVertexReduction": sum(value["vertexReduction"] for value in geometry_processing.values()),
                "memberOrderAndLineagePreserved": True,
            },
            "classification": "qualification evidence for model-inferred continental material; not exposed land, palaeoshoreline, or topography",
        }
    )
    manifest_bytes = canonical_json(manifest, pretty=True)
    validation_bytes = canonical_json(validation_record, pretty=True)
    assert len(geojson_bytes) < 16 * 1024 * 1024
    assert len(manifest_bytes) < 2 * 1024 * 1024
    assert len(validation_bytes) < 4 * 1024 * 1024
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "svalbard-pre-540-material.geojson").write_bytes(geojson_bytes)
    (OUT / "manifest.json").write_bytes(manifest_bytes)
    (DOCS / "regional-svalbard-validation.json").write_bytes(validation_bytes)
    print(
        json.dumps(
            {
                "manifest": str(OUT / "manifest.json"),
                "geometry": str(OUT / "svalbard-pre-540-material.geojson"),
                "validation": str(DOCS / "regional-svalbard-validation.json"),
                "selectedParts": validation_record["selectedPartCounts"],
                "selectedAreaSquareKilometres": validation_record["selectedAreaSquareKilometres"],
            }
        )
    )


if __name__ == "__main__":
    main()
