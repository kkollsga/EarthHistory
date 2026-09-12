#!/usr/bin/env python3
"""Compile the source-bounded Pearya pericratonic scenario candidate."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from pathlib import Path

import pygplates
from pyproj import Transformer
from shapely.geometry import MultiPolygon
from shapely.ops import transform, unary_union

import regional_canada_compile as canada


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_ROOT = ROOT / "data/corrections/pearya"
VALIDATION_PATH = ROOT / "docs/research/regional-pearya-validation.json"
PEARYA_DOMAIN = "Pearya, north Ellesmere Island"
FEATURE_ID = "pearya-pericratonic-scenario-plate-124"
LAURENTIAN_FEATURE_ID = "pearya-target-laurentian-affinity-plate-101"
CORRECTION_ID = "earthhistory-regional-pearya-pericratonic-scenario-v1"
GEOMETRY_FILE = "pearya-material-v1.geojson"
SIMPLIFY_METRES = 1_000.0
UNRELATED_DOMAIN_GUARD_METRES = 2_000.0
MIN_COMPONENT_AREA_SQUARE_METRES = 25_000_000.0
QUALIFIED_OLDEST_MA = 416.0
PRODUCT_OLDEST_MA = 540.0
LAURENTIAN_DOMAINS = {
    "Ellesmere-North Greenland fold belt",
    "eastern Sverdrup Basin, Eurekan Orogen",
    "Ellesmerian Orogen (Canada and Greenland)",
}


def is_ice(properties: dict) -> bool:
    return properties.get("DOMAIN_R_1") == "ice" or properties.get("DOMAIN_R_2") == "ice"


def verify_domain_policy(pearya_domain: str) -> None:
    if pearya_domain != PEARYA_DOMAIN:
        raise canada.BuildError("Pearya domain selection policy changed")


def _group_source_records(rows: list[tuple[dict, object]]) -> list[dict]:
    counts: Counter[tuple] = Counter()
    for properties, _geometry in rows:
        counts[
            (
                properties.get("MAP_LABEL") or "none assigned",
                properties.get("AGE_DESCRI") or "none assigned",
                properties.get("MIN_AGE") or "none assigned",
                properties.get("MAX_AGE") or "none assigned",
            )
        ] += 1
    return [
        {
            "unitId": map_label,
            "agePeriod": age_description,
            "minimumAge": minimum_age,
            "maximumAge": maximum_age,
            "count": count,
            "reason": "mapped within the named Pearya tectonic domain",
        }
        for (map_label, age_description, minimum_age, maximum_age), count in sorted(counts.items())
    ]


def _coordinate_count(geometry) -> int:
    polygons = [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)
    return sum(
        len(polygon.exterior.coords)
        + sum(len(interior.coords) for interior in polygon.interiors)
        for polygon in polygons
    )


def compile_candidate() -> tuple[dict, dict, dict]:
    verify_domain_policy(PEARYA_DOMAIN)
    (
        completion_manifest,
        completion_policy,
        completion_bytes,
        completion_hash,
        completion_owned_bytes,
        source_rows,
    ) = canada.load_completion_source()
    projected_crs = canada.SHAPEFILE.with_suffix(".prj").read_text()
    _targets, _target_rows, pearya_target_projected, pearya_target_rows = canada.load_targets(
        projected_crs
    )
    forward = Transformer.from_crs("EPSG:4326", projected_crs, always_xy=True)
    reverse = Transformer.from_crs(projected_crs, "EPSG:4326", always_xy=True)
    projected_rows = [
        (properties, canada.polygonal(transform(forward.transform, geometry)))
        for properties, geometry in source_rows
    ]
    pearya_rows = [
        row for row in projected_rows if row[0].get("DOMAIN_R_2") == PEARYA_DOMAIN
    ]
    if len(pearya_rows) != 160:
        raise canada.BuildError(f"expected 160 mapped Pearya records, found {len(pearya_rows)}")
    source_union = canada.polygonal(unary_union([geometry for _properties, geometry in pearya_rows]))
    source_hull = source_union.convex_hull
    hull_target = canada.polygonal(source_hull.intersection(pearya_target_projected))
    unrelated_rows = [
        (properties, geometry)
        for properties, geometry in projected_rows
        if properties.get("DOMAIN_R_2") != PEARYA_DOMAIN and not is_ice(properties)
    ]
    unrelated_union = canada.polygonal(
        unary_union(
            [
                geometry
                for _properties, geometry in unrelated_rows
                if geometry.intersects(hull_target)
            ]
        )
    )
    # Map 2159A is a 1:5 million compilation. A small outward guard around a
    # topology-preserving approximation of every unrelated mapped domain keeps
    # those domains out without retaining thousands of publication vertices.
    unrelated_exclusion = canada.polygonal(
        unrelated_union.simplify(SIMPLIFY_METRES, preserve_topology=True).buffer(
            UNRELATED_DOMAIN_GUARD_METRES, quad_segs=1
        )
    )
    raw_candidate = canada.polygonal(hull_target.difference(unrelated_exclusion))
    candidate = canada.polygonal(
        raw_candidate.simplify(SIMPLIFY_METRES, preserve_topology=True)
        .intersection(hull_target)
    )
    candidate = canada.drop_tiny_components(candidate, MIN_COMPONENT_AREA_SQUARE_METRES)
    if candidate.is_empty:
        raise canada.BuildError("Pearya candidate is empty")
    target_escape = candidate.difference(pearya_target_projected).area
    hull_escape = candidate.difference(source_hull).area
    unrelated_overlap = candidate.intersection(unrelated_union).area
    if max(target_escape, hull_escape, unrelated_overlap) > 1.0:
        raise canada.BuildError(
            "Pearya candidate escaped the exact target, source hull, or mapped-domain exclusion"
        )
    if source_union.intersection(candidate).area / source_union.intersection(pearya_target_projected).area < 0.90:
        raise canada.BuildError("Pearya candidate discarded too much mapped Pearya source")

    laurentian_rows = [
        (properties, geometry)
        for properties, geometry in projected_rows
        if properties.get("DOMAIN_R_2") in LAURENTIAN_DOMAINS
        and geometry.intersects(pearya_target_projected)
    ]
    laurentian_source = canada.polygonal(
        unary_union(
            [geometry.intersection(pearya_target_projected) for _properties, geometry in laurentian_rows]
        )
    )
    laurentian_candidate = canada.drop_tiny_components(
        canada.polygonal(
            laurentian_source.simplify(SIMPLIFY_METRES, preserve_topology=True)
            .intersection(pearya_target_projected)
            .difference(candidate.buffer(UNRELATED_DOMAIN_GUARD_METRES, quad_segs=1))
        ),
        MIN_COMPONENT_AREA_SQUARE_METRES,
    )
    if laurentian_candidate.is_empty:
        raise canada.BuildError("Pearya-target Laurentian fragment is empty")
    laurentian_outside_source = laurentian_candidate.difference(laurentian_source).area
    laurentian_outside_source_fraction = (
        laurentian_outside_source / laurentian_candidate.area
    )
    laurentian_area_change_fraction = (
        abs(laurentian_candidate.area - laurentian_source.area) / laurentian_source.area
    )
    if (
        laurentian_candidate.difference(pearya_target_projected).area > 1
        or laurentian_candidate.intersection(candidate).area > 1
        or laurentian_outside_source_fraction > 0.06
        or laurentian_area_change_fraction > 0.10
    ):
        raise canada.BuildError("Pearya-target Laurentian fragment escaped its source contract")

    target_present = canada.polygonal(transform(reverse.transform, pearya_target_projected))
    candidate_present = canada.polygonal(transform(reverse.transform, candidate))
    source_present = canada.polygonal(transform(reverse.transform, source_union))
    hull_present = canada.polygonal(transform(reverse.transform, hull_target))
    unrelated_present = canada.polygonal(transform(reverse.transform, unrelated_union))
    laurentian_present = canada.polygonal(
        transform(reverse.transform, laurentian_candidate)
    )
    rotations = pygplates.RotationModel(
        [
            str(canada.MODEL_ROOT / "1000_0_rotfile.rot"),
            str(canada.MODEL_ROOT / "1800_1000_rotfile.rot"),
        ],
        default_anchor_plate_id=0,
    )
    rotation_410 = rotations.get_rotation(canada.REFERENCE_AGE_MA, 124)
    target_reference = canada.pose_geometry(target_present, rotation_410)
    candidate_reference = canada.pose_geometry(candidate_present, rotation_410)
    laurentian_reference = canada.pose_geometry(laurentian_present, rotation_410)
    witness_present_shape = source_present.representative_point()
    witness_present = pygplates.PointOnSphere(witness_present_shape.y, witness_present_shape.x)
    witness_410 = rotation_410 * witness_present
    witness_410_lat, witness_410_lon = witness_410.to_lat_lon()
    comparisons = []
    max_pose_residual = 0.0
    for age in (411.0, 416.0, 430.0, 540.0):
        carried = rotations.get_rotation(age, 124) * rotation_410.get_inverse() * witness_410
        counterfactual = rotations.get_rotation(age, 124) * witness_present
        expected_lat, expected_lon = counterfactual.to_lat_lon()
        residual_degrees, residual_km = canada.degrees_and_km(carried, counterfactual)
        max_pose_residual = max(max_pose_residual, residual_km)
        comparisons.append(
            {
                "ageMa": age,
                "counterfactualCaoPlateId": 124,
                "expectedLonLat": [expected_lon, expected_lat],
                "angularResidualDegrees": residual_degrees,
                "residualKm": residual_km,
            }
        )

    laurentian_witness_shape = laurentian_present.representative_point()
    laurentian_witness_present = pygplates.PointOnSphere(
        laurentian_witness_shape.y, laurentian_witness_shape.x
    )
    laurentian_witness_410 = rotation_410 * laurentian_witness_present
    laurentian_witness_lat, laurentian_witness_lon = laurentian_witness_410.to_lat_lon()
    laurentian_comparisons = []
    max_laurentian_pose_residual = 0.0
    plate_101_at_410 = rotations.get_rotation(canada.REFERENCE_AGE_MA, 101)
    for age in (411.0, 430.0, 540.0):
        carried = (
            rotations.get_rotation(age, 101)
            * plate_101_at_410.get_inverse()
            * laurentian_witness_410
        )
        counterfactual = rotations.get_rotation(age, 124) * laurentian_witness_present
        expected_lat, expected_lon = counterfactual.to_lat_lon()
        residual_degrees, residual_km = canada.degrees_and_km(carried, counterfactual)
        max_laurentian_pose_residual = max(max_laurentian_pose_residual, residual_km)
        laurentian_comparisons.append(
            {
                "ageMa": age,
                "counterfactualCaoPlateId": 124,
                "expectedLonLat": [expected_lon, expected_lat],
                "angularResidualDegrees": residual_degrees,
                "residualKm": residual_km,
            }
        )

    metrics = canada.reference_union_metrics([candidate_reference], [target_reference])
    laurentian_metrics = canada.reference_union_metrics(
        [laurentian_reference], [target_reference]
    )
    combined_metrics = canada.reference_union_metrics(
        [candidate_reference, laurentian_reference], [target_reference]
    )
    retained_source_metrics = canada.reference_union_metrics(
        [canada.pose_geometry(source_present.intersection(candidate_present), rotation_410)],
        [target_reference],
    )
    original_source_metrics = canada.reference_union_metrics(
        [canada.pose_geometry(source_present.intersection(target_present), rotation_410)],
        [target_reference],
    )
    hull_metrics = canada.reference_union_metrics(
        [canada.pose_geometry(hull_present, rotation_410)], [target_reference]
    )
    unrelated_in_hull = canada.polygonal(unrelated_present.intersection(hull_present))
    unrelated_metrics = canada.reference_union_metrics(
        [canada.pose_geometry(unrelated_in_hull, rotation_410)], [target_reference]
    )
    inferred_gap_km2 = max(
        0.0,
        metrics["candidateUnionKm2"] - retained_source_metrics["candidateUnionKm2"],
    )
    hull_gap_km2 = max(
        0.0,
        hull_metrics["candidateUnionKm2"] - original_source_metrics["candidateUnionKm2"],
    )
    guarded_exclusion_km2 = max(
        0.0, hull_metrics["candidateUnionKm2"] - metrics["candidateUnionKm2"]
    )
    area_centre = target_present.representative_point()
    area_crs = (
        f"+proj=laea +lat_0={area_centre.y:.12f} +lon_0={area_centre.x:.12f} "
        "+datum=WGS84 +units=m +no_defs"
    )
    area_projector = Transformer.from_crs("EPSG:4326", area_crs, always_xy=True)
    classified_candidate = canada.classify_arctic_map_area(
        canada.polygonal(transform(area_projector.transform, candidate_present)),
        [
            (properties, canada.polygonal(transform(area_projector.transform, geometry)))
            for properties, geometry in source_rows
        ],
    )
    domain_areas = {
        row["domainLevel2"]: row["areaKm2"] for row in classified_candidate["classified"]
    }
    mapped_non_pearya_area = sum(
        area
        for domain, area in domain_areas.items()
        if domain not in {PEARYA_DOMAIN, "ice"}
    )
    if mapped_non_pearya_area > 0.01:
        raise canada.BuildError(
            f"Pearya candidate retained {mapped_non_pearya_area} km2 of unrelated mapped domains"
        )

    laurentian_groups = defaultdict(lambda: {"count": 0, "geometries": []})
    for properties, geometry in laurentian_rows:
        overlap = canada.polygonal(geometry.intersection(pearya_target_projected))
        if overlap.is_empty:
            continue
        key = (
            properties.get("DOMAIN_R_2") or "none assigned",
            properties.get("AGE_DESCRI") or "none assigned",
        )
        laurentian_groups[key]["count"] += 1
        laurentian_groups[key]["geometries"].append(overlap)
    laurentian_units = [
        {
            "unitId": domain,
            "agePeriod": age,
            "count": values["count"],
            "clippedAreaKm2": canada.polygonal(
                unary_union(values["geometries"])
            ).area
            / 1_000_000,
            "reason": (
                "mapped younger successor-basin or fold-belt cover over the northern Laurentian/Franklinian substrate"
                if "Sverdrup" in domain
                else "mapped Laurentian/Franklinian fold-belt material, including direct pre-410 units and younger deformed cover"
            ),
        }
        for (domain, age), values in sorted(laurentian_groups.items())
    ]

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": FEATURE_ID,
                "properties": {
                    "correctionFeatureId": FEATURE_ID,
                    "sourcePlateIdAt410Ma": 124,
                    "motionPlateIdOlderThan410Ma": 124,
                    "materialRole": "continental-material-support",
                    "surfaceEvidence": "unknown",
                    "scenario": "pericratonic-Cao-attached",
                },
                "geometry": canada.rounded_mapping(candidate_reference),
            },
            {
                "type": "Feature",
                "id": LAURENTIAN_FEATURE_ID,
                "properties": {
                    "correctionFeatureId": LAURENTIAN_FEATURE_ID,
                    "sourcePlateIdAt410Ma": 124,
                    "motionPlateIdOlderThan410Ma": 101,
                    "materialRole": "continental-material-support",
                    "surfaceEvidence": "unknown",
                    "scenario": "northern-Laurentian-affinity",
                },
                "geometry": canada.rounded_mapping(laurentian_reference),
            },
        ],
    }
    geojson_bytes = canada.canonical_json(geojson)
    geometry_hash = canada.sha256(geojson_bytes)
    feature = {
        "correctionFeatureId": FEATURE_ID,
        "targets": pearya_target_rows,
        "geometryAsset": {
            "path": GEOMETRY_FILE,
            "sha256": geometry_hash,
            "featureId": FEATURE_ID,
        },
        "geometryReferenceAgeMa": 410,
        "coordinateFrame": "cao-v2.4-reconstructed-palaeomagnetic",
        "sourceBasis": {
            "kind": "reconstructed-target-union",
            "normalization": "qPose(0)*inverse(qPose(referenceAge))*dReference",
            "targetPlateIds": [124],
            "derivation": (
                "convex envelope of the official mapped Pearya domain, clipped to the exact Cao Pearya target, "
                "with every mapped non-Pearya and non-ice domain removed; the remaining ice and unmapped "
                "interior is a bounded terrane-domain interpolation"
            ),
        },
        "pose": {
            "plateId": 124,
            "method": "regional-model-hypothesis",
            "sourceOrHypothesis": (
                "pericratonic Pearya scenario attached to the Cao plate-124 circuit; this is one disputed "
                "tectonic hypothesis and does not establish a consensus pre-accretion position"
            ),
            "alignmentWitnesses": [
                {
                    "witnessId": "mapped-pearya-domain-interior",
                    "presentLonLat": [witness_present_shape.x, witness_present_shape.y],
                    "referenceLonLat": [witness_410_lon, witness_410_lat],
                    "olderPoseComparisons": comparisons,
                }
            ],
        },
        "materialRole": "continental-material-support",
        "supportIntervalMa": {
            "youngest": 410,
            "youngestExclusive": True,
            "oldest": QUALIFIED_OLDEST_MA,
        },
        "olderEdgePolicy": "uncertain-beyond-qualified-support",
        "olderUncertaintyTransitionMa": {
            "youngest": QUALIFIED_OLDEST_MA,
            "oldest": PRODUCT_OLDEST_MA,
            "representation": "same material-support mask remains visible as an explicitly uncertain pericratonic pose scenario",
        },
        "sourceUnitSelection": {
            "included": _group_source_records(pearya_rows),
            "excluded": [
                {
                    "unitId": "all mapped non-Pearya, non-ice domains within the Pearya-domain convex envelope",
                    "count": len(unrelated_rows),
                    "reason": "removed to prevent the terrane interpolation from absorbing Ellesmerian, Franklinian, or ocean-margin domains",
                }
            ],
            "sourceRecordCount": len(pearya_rows),
            "originalMappedSourceWithinTargetKm2": original_source_metrics["candidateUnionKm2"],
            "retainedMappedSourceKm2": retained_source_metrics["candidateUnionKm2"],
            "retainedMappedSourceFraction": (
                retained_source_metrics["candidateUnionKm2"]
                / original_source_metrics["candidateUnionKm2"]
            ),
            "sourceHullWithinTargetKm2": hull_metrics["candidateUnionKm2"],
            "sourceHullGapWithinTargetKm2": hull_gap_km2,
            "mappedUnrelatedExcludedKm2": unrelated_metrics["candidateUnionKm2"],
            "guardedHullExclusionKm2": guarded_exclusion_km2,
            "candidateAreaKm2": metrics["candidateUnionKm2"],
            "inferredIceOrUnmappedGapKm2": inferred_gap_km2,
            "targetAreaKm2": metrics["targetUnionKm2"],
            "targetAreaSupportFractionAt411": metrics["candidateUnionSupportFraction"],
            "simplificationToleranceMetres": SIMPLIFY_METRES,
            "mappedUnrelatedExclusionGuardMetres": UNRELATED_DOMAIN_GUARD_METRES,
            "minimumComponentAreaKm2": MIN_COMPONENT_AREA_SQUARE_METRES / 1_000_000,
            "finalOutsideSourceHullKm2": 0,
            "finalOutsideTargetKm2": 0,
            "mappedNonPearyaOverlapKm2": mapped_non_pearya_area,
        },
        "sourceIds": ["gsc-map-2159a-arctic-onshore-geology", "cao-2024-v2.4"],
        "epistemicStatus": "model-inference",
        "surfaceEvidence": {
            "kind": "unknown",
            "reason": "Map 2159A constrains a present-day tectonic domain; the interpolated mask represents possible continental material, not exposed land, shoreline, or relief",
        },
        "uncertainty": {
            "spatial": "mapped Pearya outcrops are source constrained; connections beneath ice or unmapped gaps are a clipped domain interpolation with mapped unrelated domains removed",
            "temporal": "material is retained through the Silurian docking interval, while the pre-416 Ma position is a visibly uncertain pericratonic scenario because Pearya's accretion history remains disputed",
            "exposure": "unknown at every age",
        },
        "rejectionConditions": [
            "the source selection includes a mapped non-Pearya domain",
            "the interpolated geometry escapes the exact Pearya target or the mapped Pearya-domain convex envelope",
            "the scenario is presented as a consensus pre-accretion position",
            "the mask is presented as exposed land, shoreline, or palaeotopography",
            "the correction is active at the inclusive 410 Ma native endpoint",
        ],
    }
    laurentian_feature = {
        "correctionFeatureId": LAURENTIAN_FEATURE_ID,
        "targets": pearya_target_rows,
        "geometryAsset": {
            "path": GEOMETRY_FILE,
            "sha256": geometry_hash,
            "featureId": LAURENTIAN_FEATURE_ID,
        },
        "geometryReferenceAgeMa": 410,
        "coordinateFrame": "cao-v2.4-reconstructed-palaeomagnetic",
        "sourceBasis": {
            "kind": "reconstructed-target-union",
            "normalization": "qPose(0)*inverse(qPose(referenceAge))*dReference",
            "targetPlateIds": [124],
            "derivation": (
                "Map 2159A Ellesmere-North Greenland fold-belt, eastern Sverdrup/Eurekan, and "
                "Ellesmerian domains clipped to the exact plate-124 target; simplified at 1 km, "
                "differenced from the guarded Pearya-affinity scenario, and carried older with Laurentia"
            ),
        },
        "pose": {
            "plateId": 101,
            "method": "regional-model-hypothesis",
            "sourceOrHypothesis": (
                "northern Laurentian/Franklinian material aligned to the native plate-124 target at 410 Ma, "
                "then carried with Cao North America plate 101; affinity is distinct from the Pearya scenario"
            ),
            "alignmentWitnesses": [
                {
                    "witnessId": "mapped-laurentian-domain-interior",
                    "presentLonLat": [laurentian_witness_shape.x, laurentian_witness_shape.y],
                    "referenceLonLat": [laurentian_witness_lon, laurentian_witness_lat],
                    "olderPoseComparisons": laurentian_comparisons,
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
            "oldest": PRODUCT_OLDEST_MA,
            "representation": "same Laurentian-affinity material remains visible with explicit lower spatial confidence",
        },
        "sourceUnitSelection": {
            "included": laurentian_units,
            "excluded": [
                {
                    "unitId": "Pearya, ice, unmapped, and other Map 2159A domains",
                    "count": len(source_rows) - len(laurentian_rows),
                    "reason": "outside the exact independently qualified northern Laurentian domain set",
                }
            ],
            "sourceDomains": sorted(LAURENTIAN_DOMAINS),
            "rawMappedDomainAreaKm2": laurentian_source.area / 1_000_000,
            "candidateAreaKm2": laurentian_metrics["candidateUnionKm2"],
            "targetAreaSupportFractionAt411": laurentian_metrics[
                "candidateUnionSupportFraction"
            ],
            "simplificationToleranceMetres": SIMPLIFY_METRES,
            "pearyaScenarioSeparationGuardMetres": UNRELATED_DOMAIN_GUARD_METRES,
            "minimumComponentAreaKm2": MIN_COMPONENT_AREA_SQUARE_METRES / 1_000_000,
            "simplificationAreaChangeFraction": laurentian_area_change_fraction,
            "simplifiedOutsideMappedSourceFraction": laurentian_outside_source_fraction,
            "finalOverlapWithPearyaScenarioKm2": 0,
            "finalOutsideTargetKm2": 0,
        },
        "sourceIds": ["gsc-map-2159a-arctic-onshore-geology", "cao-2024-v2.4"],
        "epistemicStatus": "model-inference",
        "surfaceEvidence": {
            "kind": "unknown",
            "reason": "mapped fold-belt and successor-basin domains support older Laurentian material, not exposed land, shoreline, or relief",
        },
        "uncertainty": {
            "spatial": "source-bounded mapped domains are clipped to the Cao target and separated from the Pearya-affinity scenario; deformation within the fold belts is not reconstructed",
            "temporal": "material affinity is qualified through 430 Ma and retained as a visibly uncertain continuation through 540 Ma",
            "exposure": "unknown at every age",
        },
        "rejectionConditions": [
            "the source selection includes Pearya, ice, unmapped area, or an unqualified tectonic domain",
            "the simplified fragment exceeds 10% area change or 6% outside-source area",
            "the fragment overlaps the guarded Pearya-affinity scenario or escapes the exact plate-124 target",
            "the fragment is assigned Pearya affinity or presented as exposed land, shoreline, or palaeotopography",
            "the plate-101 carry no longer matches the frozen Cao plate-124 circuit at the recorded witnesses",
        ],
    }
    manifest = {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "version": "2.0.0-candidate",
        "baseline": {
            "modelId": "cao-et-al-2024",
            "modelVersion": "2.4",
            "sourceCollection": "shapes_coasts.gpmlz",
            "sourceSha256": canada.SOURCE_COLLECTION_SHA,
            "coordinateFrame": {
                "absoluteFrameId": "palaeomagnetic",
                "anchorPlateId": 0,
                "axisConvention": "gplates-x0e-y90e-znorth",
                "rotationSha256": canada.ROTATION_SHA,
                "topologySha256": canada.TOPOLOGY_SHA,
            },
        },
        "sourceAssets": [
            {
                "sourceId": "gsc-map-2159a-arctic-onshore-geology",
                "url": completion_manifest["source"]["openDataRecord"],
                "citation": "Harrison et al. (2011), Geological map of the Arctic, Geological Survey of Canada Map 2159A, doi:10.4095/287868",
                "publicationOrVersionDate": "2011-02-01",
                "retrievedAt": "2026-09-12",
                "bytes": completion_bytes,
                "sha256": completion_hash,
                "hashEncoding": canada.COMPLETION_SOURCE_AGGREGATE_DOMAIN[:-1].decode(),
                "license": "Open Government Licence – Canada 2.0",
                "attribution": completion_manifest["license"]["attribution"],
                "evidenceRole": "geological-unit-extent",
            },
            {
                "sourceId": "cao-2024-v2.4",
                "url": "https://doi.org/10.5281/zenodo.13628813",
                "citation": "Cao et al. (2024), Earth's tectonic and plate boundary evolution over 1.8 billion years, model v2.4",
                "publicationOrVersionDate": "2024-09-02",
                "retrievedAt": "2026-09-09",
                "bytes": (canada.MODEL_ROOT / "shapes_coasts.gpmlz").stat().st_size,
                "sha256": canada.SOURCE_COLLECTION_SHA,
                "license": "CC BY 4.0",
                "attribution": "Cao et al. (2024), model v2.4, doi:10.5281/zenodo.13628813",
                "evidenceRole": "material-affinity",
            },
        ],
        "features": [feature, laurentian_feature],
        "attribution": "Contains information licensed under the Open Government Licence – Canada; source Natural Resources Canada, Geological Survey of Canada. Cao et al. (2024) model v2.4 is CC BY 4.0.",
        "licenseNote": "Map 2159A-derived geometry requires OGL Canada attribution; the Cao model requires CC BY 4.0 attribution.",
    }
    validation = {
        "schemaVersion": 1,
        "candidate": CORRECTION_ID,
        "status": "source-qualified-scenario",
        "source": {
            "retainedMemberBytes": completion_bytes,
            "ownedSourceDirectoryBytes": completion_owned_bytes,
            "sourceAcquisitionMaximumBytes": completion_policy["sourceAcquisitionMaximumBytes"],
            "aggregateSha256": completion_hash,
            "sourceRecordCount": len(source_rows),
            "pearyaDomainRecordCount": len(pearya_rows),
        },
        "geometry": {
            "originalMappedSourceWithinTargetKm2": original_source_metrics["candidateUnionKm2"],
            "retainedMappedSourceKm2": retained_source_metrics["candidateUnionKm2"],
            "retainedMappedSourceFraction": (
                retained_source_metrics["candidateUnionKm2"]
                / original_source_metrics["candidateUnionKm2"]
            ),
            "sourceHullWithinTargetKm2": hull_metrics["candidateUnionKm2"],
            "sourceHullGapWithinTargetKm2": hull_gap_km2,
            "mappedUnrelatedExcludedKm2": unrelated_metrics["candidateUnionKm2"],
            "guardedHullExclusionKm2": guarded_exclusion_km2,
            "candidateAreaKm2": metrics["candidateUnionKm2"],
            "inferredIceOrUnmappedGapKm2": inferred_gap_km2,
            "targetAreaKm2": metrics["targetUnionKm2"],
            "targetAreaSupportFractionAt411": metrics["candidateUnionSupportFraction"],
            "mappedDomainClassification": classified_candidate,
            "mappedNonPearyaOverlapKm2": mapped_non_pearya_area,
            "finalOutsideSourceHullKm2": 0,
            "finalOutsideTargetKm2": 0,
            "coordinateCount": _coordinate_count(candidate_reference),
        },
        "laurentianFragment": {
            "sourceDomains": sorted(LAURENTIAN_DOMAINS),
            "rawMappedDomainAreaKm2": laurentian_source.area / 1_000_000,
            "candidateAreaKm2": laurentian_metrics["candidateUnionKm2"],
            "targetAreaSupportFractionAt411": laurentian_metrics[
                "candidateUnionSupportFraction"
            ],
            "simplificationAreaChangeFraction": laurentian_area_change_fraction,
            "simplifiedOutsideMappedSourceFraction": laurentian_outside_source_fraction,
            "overlapWithPearyaScenarioKm2": 0,
            "outsideTargetKm2": 0,
            "coordinateCount": _coordinate_count(laurentian_reference),
            "maximumComputationalPlate101Vs124ResidualKm": max_laurentian_pose_residual,
            "qualifiedUntilMa": 430,
            "uncertainUntilMa": PRODUCT_OLDEST_MA,
        },
        "combined": {
            "candidateAreaKm2": combined_metrics["candidateUnionKm2"],
            "targetAreaKm2": combined_metrics["targetUnionKm2"],
            "targetAreaSupportFractionAt411": combined_metrics[
                "candidateUnionSupportFraction"
            ],
            "coordinateCount": _coordinate_count(candidate_reference)
            + _coordinate_count(laurentian_reference),
        },
        "pose": {
            "scenario": "pericratonic-Cao-plate-124",
            "qualifiedUntilMa": QUALIFIED_OLDEST_MA,
            "uncertainUntilMa": PRODUCT_OLDEST_MA,
            "maximumComputationalPlate124ResidualKm": max_pose_residual,
            "consensusPlacement": False,
        },
        "endpointChecks": [
            {"ageMa": 410.0, "nativeTargetActive": True, "correctionActive": False},
            {"ageMa": 410.001, "nativeTargetActive": False, "correctionActive": True},
            {"ageMa": 416.0, "nativeTargetActive": False, "correctionActive": True, "poseStyle": "qualified"},
            {"ageMa": 416.001, "nativeTargetActive": False, "correctionActive": True, "poseStyle": "uncertain"},
            {"ageMa": 540.0, "nativeTargetActive": False, "correctionActive": True, "poseStyle": "uncertain"},
        ],
        "limits": [
            "the convex-envelope interior is accepted only after all mapped unrelated domains are removed",
            "the inferred gap beneath ice or absent mapping is material-domain interpolation rather than observed outcrop",
            "plate-124 pose agreement is computational and does not resolve competing Pearya palaeogeographic models",
        ],
    }
    return geojson, manifest, validation


def main() -> None:
    geojson, manifest, validation = compile_candidate()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    VALIDATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    (OUTPUT_ROOT / GEOMETRY_FILE).write_bytes(
        canada.canonical_json(geojson)
    )
    (OUTPUT_ROOT / "manifest.json").write_bytes(canada.canonical_json(manifest))
    VALIDATION_PATH.write_bytes(canada.canonical_json(validation))
    print(
        json.dumps(
            {
                "features": 2,
                "targets": 3,
                "candidateAreaKm2": validation["combined"]["candidateAreaKm2"],
                "supportFractionAt411": validation["combined"]["targetAreaSupportFractionAt411"],
                "coordinates": validation["combined"]["coordinateCount"],
                "output": str(OUTPUT_ROOT.relative_to(ROOT)),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
