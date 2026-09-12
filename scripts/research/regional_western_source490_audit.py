#!/usr/bin/env python3
"""Build an age-qualified native replacement for Cao source order 490."""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform, unary_union
from shapely.validation import make_valid

import regional_western_compile as western
from regional_western_source450_audit import material_status_intervals


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "docs/research/regional-western-source490-validation.json"
TILES_OUTPUT = ROOT / "data/corrections/western-laurentia/western-source490-domain-tiles-v1.geojson"
TARGET_ID = western.PURCELL_PATCH
TARGET_ORDER = western.PURCELL_FEATURE_ORDER
TARGET_PLATE_ID = western.PURCELL_PLATE
CORDILLERA_PATH = western.COMPLETION_ROOT / "source490-northern-cordillera-terranes.geojson"
CORDILLERA_BYTES = 260_694
CORDILLERA_SHA = "8e003e86ecc3b14ce3420afc5cf9bdd6a7f3a9362e6791ad7ffc7117cea45329"

YOUNG_INTERVALS = {
    20: (385.0, 175.0),
    21: (320.0, 250.0),
    34: (380.0, 350.0),
    35: (365.0, 187.0),
    36: (315.0, 215.0),
    37: (280.0, 165.0),
    39: (165.0, 50.0),
    40: (60.0, 50.0),
    41: (50.0, 0.0),
}
POSSIBLE_OLDEST = {37: 300.0}
CORDILLERA_INTERVALS = {
    10: (1000.0, 174.0),  # Chilliwack, Neoproterozoic-Early Jurassic
    11: (201.0, 56.0), 13: (247.0, 100.0), 14: (359.0, 145.0),
    15: (299.0, 100.0), 16: (163.0, 100.0), 18: (359.0, 145.0),
    20: (359.0, 145.0), 21: (299.0, 100.0), 23: (299.0, 100.0),
    25: (299.0, 100.0), 36: (419.0, 174.0), 37: (359.0, 174.0),
    38: (383.0, 174.0), 41: (201.0, 56.0), 94: (383.0, 201.0),
}
PRESERVE_NATIVE_CORDILLERA_IDS = {11, 13, 15, 23, 25, 41}
MIN_TRIANGULATABLE_RESIDUAL_M2 = 100.0
UNTRIANGULATABLE_RESIDUAL_PARTS = {12, 15, 17, 18, 19, 22}


class AuditError(ValueError):
    pass


def polygonal(geometry):
    geometry = make_valid(geometry)
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    polygons = []
    for child in getattr(geometry, "geoms", []):
        if isinstance(child, Polygon):
            polygons.append(child)
        elif isinstance(child, MultiPolygon):
            polygons.extend(child.geoms)
    return unary_union(polygons) if polygons else MultiPolygon([])


def rounded_mapping(geometry):
    def visit(value):
        if isinstance(value, (tuple, list)):
            return [visit(item) for item in value]
        return round(value, 6) if isinstance(value, float) else value

    return visit(mapping(geometry))


def compile_replacement():
    _, target = western.load_target_geometries()
    candidates, manifest, validation = western.compile_candidate()
    old_row = next(row for row in candidates if row["plateId"] == TARGET_PLATE_ID)
    old_candidate = old_row["candidate"]
    target_validation = next(row for row in validation["geometries"]
                             if row["plateId"] == TARGET_PLATE_ID)

    features = [{
        "type": "Feature",
        "id": "source490-qualified-old-basement",
        "properties": {
            "sourceFeatureOrder": TARGET_ORDER,
            "patchId": TARGET_ID,
            "targetPatchId": TARGET_ID,
            "sourcePlateId": TARGET_PLATE_ID,
            "domain": "qualified-pre-410-basement",
            "visibilityPolicy": {"persistentThroughNativeInterval": True},
            "materialOriginRangeMa": [3500.0, 500.0],
            "materialOriginMeaning": "aggregate extrema of the independently old DS898 domains, not one continuous formation event",
            "materialStatusIntervalsMa": [
                {"status": "material-supported", "youngest": 0.0, "oldest": 410.0}
            ],
            "geometryLifecycleMa": {"youngest": 0.0, "oldest": 410.0},
            "olderLifecycleOwner": "western-laurentia-qualified-material-plate-1731",
            "surfaceEvidence": "unknown",
            "pose": {
                "plateId": TARGET_PLATE_ID,
                "status": "model-inference",
                "warning": "old basement is source-qualified, but plate 1731 is a Cao motion partition rather than an independently measured local circuit",
            },
        },
        "geometry": rounded_mapping(old_candidate),
    }]
    younger_geometries = []
    younger_rows = []
    for properties, geometry in western.load_ds898_domains():
        fid = properties["fid"]
        if fid not in YOUNG_INTERVALS:
            continue
        clipped = polygonal(geometry.intersection(target))
        if clipped.is_empty:
            continue
        oldest, youngest = YOUNG_INTERVALS[fid]
        possible_oldest = POSSIBLE_OLDEST.get(fid, oldest)
        feature = {
            "type": "Feature",
            "id": f"source490-ds898-domain-{fid}",
            "properties": {
                "sourceFeatureOrder": TARGET_ORDER,
                "patchId": TARGET_ID,
                "targetPatchId": TARGET_ID,
                "sourcePlateId": TARGET_PLATE_ID,
                "ds898Fid": fid,
                "domain": properties["domain"],
                "crustType": properties["crust_type"],
                "formationIntervalMa": {"oldest": oldest, "youngest": youngest},
                "possibleOldestCrustMa": possible_oldest,
                "materialOriginRangeMa": [possible_oldest, youngest],
                "visibilityPolicy": {
                    "absentWhenOlderThanMa": possible_oldest,
                    "formationUncertainFromMa": possible_oldest,
                    "formationUncertainToMa": youngest,
                    "supportedWhenYoungerThanOrEqualMa": youngest,
                },
                "ageUncertainty": "DS898 ages characterize a domain; they do not date simultaneous formation of every point in this clipped polygon",
                "materialStatusIntervalsMa": material_status_intervals(
                    oldest, youngest, possible_oldest
                ),
                "geometryLifecycleMa": {"youngest": 0.0, "oldest": 410.0},
                "surfaceEvidence": "unknown",
                "pose": {
                    "plateId": TARGET_PLATE_ID,
                    "status": "model-inference",
                    "warning": "DS898 constrains material identity and age, not plate motion; target-partition motion is explicit uncertainty",
                },
                "sourceNotes": properties["notes"].strip() or None,
            },
            "geometry": rounded_mapping(clipped),
        }
        features.append(feature)
        younger_geometries.append(shape(feature["geometry"]))
        younger_rows.append({
            "fid": fid, "domain": properties["domain"],
            "crustType": properties["crust_type"], "crustAge": properties["crust_age"],
        })

    classified = polygonal(unary_union([old_candidate, *younger_geometries]))
    ds_residual = polygonal(target.difference(classified))
    if (CORDILLERA_PATH.stat().st_size != CORDILLERA_BYTES
            or western.sha256(CORDILLERA_PATH.read_bytes()) != CORDILLERA_SHA):
        raise AuditError("pinned Northern Cordillera source490 query is missing or changed")
    cordillera = json.loads(CORDILLERA_PATH.read_text())
    cordillera_geometries = []
    cordillera_rows = []
    for source_feature in cordillera.get("features", []):
        properties = source_feature["properties"]
        object_id = properties["OBJECTID"]
        if object_id not in CORDILLERA_INTERVALS:
            continue
        clipped = polygonal(shape(source_feature["geometry"]).intersection(ds_residual))
        if clipped.is_empty:
            continue
        oldest, youngest = CORDILLERA_INTERVALS[object_id]
        preserve_native = object_id in PRESERVE_NATIVE_CORDILLERA_IDS
        lifecycle_oldest = 410.0 if preserve_native else min(540.0, oldest)
        material_intervals = (
            [{"status": "native-source-supported-material-age-unknown", "youngest": 0.0, "oldest": 410.0}]
            if preserve_native else
            material_status_intervals(oldest, youngest, oldest, lifecycle_oldest)
        )
        feature = {
            "type": "Feature", "id": f"source490-cordillera-terrane-{object_id}",
            "properties": {
                "sourceFeatureOrder": TARGET_ORDER, "patchId": TARGET_ID,
                "targetPatchId": TARGET_ID, "sourcePlateId": TARGET_PLATE_ID,
                "cordilleraObjectId": object_id, "domain": properties["T_NAME"],
                "terrane": properties["TERRANE"], "affinity": properties["AFFINITY"],
                "tectonicSetting": properties["TECT_SETTING"],
                "sourceAgeRange": properties["AGE_RANGE"],
                "formationIntervalMa": {"oldest": oldest, "youngest": youngest},
                "materialOriginRangeMa": None if preserve_native else [oldest, youngest],
                "possibleOldestCrustMa": 410.0 if preserve_native else oldest,
                "ageGatePolicy": (
                    "preserve-authored-native-lifecycle; terrane age records cover/plutonism rather than basement origin"
                    if preserve_native else
                    "gate juvenile/oceanic/accretionary terrane material by conservative oldest source age"
                ),
                "materialStatusIntervalsMa": material_intervals,
                "geometryLifecycleMa": {"youngest": 0.0, "oldest": lifecycle_oldest},
                "surfaceEvidence": "unknown",
                "ageUncertainty": (
                    "source age is terrane stratigraphy or plutonism and does not establish substrate birth; original native support is retained"
                    if preserve_native else
                    "period-name bounds are conservative numerical approximations; the terrane-wide range does not date simultaneous formation of every point"
                ),
                "pose": {
                    "plateId": TARGET_PLATE_ID, "status": "model-inference",
                    "warning": "the official terrane compilation provides affinity and footprint, not a plate-1731 kinematic reconstruction",
                },
            },
            "geometry": rounded_mapping(clipped),
        }
        if preserve_native:
            feature["properties"]["sourceRockAgeIntervalMa"] = feature["properties"].pop(
                "formationIntervalMa"
            )
            feature["properties"].pop("possibleOldestCrustMa")
        features.append(feature)
        cordillera_geometries.append(shape(feature["geometry"]))
        cordillera_rows.append({
            "objectId": object_id, "terrane": properties["TERRANE"],
            "name": properties["T_NAME"], "affinity": properties["AFFINITY"],
            "ageRange": properties["AGE_RANGE"], "sourceOldestMa": oldest,
            "effectiveLifecycleOldestMa": lifecycle_oldest,
            "disposition": "preserve-native" if preserve_native else "origin-age-gated",
        })
    raw_residual = polygonal(ds_residual.difference(unary_union(cordillera_geometries)))
    project = source450_projection(target)
    residual_parts = (
        list(raw_residual.geoms) if isinstance(raw_residual, MultiPolygon)
        else [raw_residual]
    )
    dropped_parts = [
        part for index, part in enumerate(residual_parts)
        if index in UNTRIANGULATABLE_RESIDUAL_PARTS
    ]
    if (len(dropped_parts) != len(UNTRIANGULATABLE_RESIDUAL_PARTS)
            or any(transform(project.transform, part).area >= MIN_TRIANGULATABLE_RESIDUAL_M2
                   for part in dropped_parts)):
        raise AuditError("source490 residual triangulation-failure witness changed")
    kept_parts = [
        part for index, part in enumerate(residual_parts)
        if index not in UNTRIANGULATABLE_RESIDUAL_PARTS
    ]
    residual = polygonal(unary_union(kept_parts))
    dropped_residual = polygonal(unary_union(dropped_parts))
    features.append({
        "type": "Feature",
        "id": "source490-unclassified-present-remainder",
        "properties": {
            "sourceFeatureOrder": TARGET_ORDER,
            "patchId": TARGET_ID,
            "targetPatchId": TARGET_ID,
            "sourcePlateId": TARGET_PLATE_ID,
            "domain": "outside-USGS-and-Northern-Cordillera-coverage",
            "visibilityPolicy": {"retainOriginalNativeLifecycle": True},
            "materialOriginRangeMa": None,
            "materialStatusIntervalsMa": [
                {"status": "native-source-supported-material-age-unknown", "youngest": 0.0, "oldest": 410.0}
            ],
            "geometryLifecycleMa": {"youngest": 0.0, "oldest": 410.0},
            "surfaceEvidence": "unknown",
            "pose": {"plateId": TARGET_PLATE_ID, "status": "native-target-only"},
        },
        "geometry": rounded_mapping(residual),
    })

    target_p = polygonal(transform(project.transform, target))
    snapshots = []
    for age in (540.0, 410.001, 410.0, 400.0, 365.0, 250.0, 100.0, 50.0, 25.0, 5.0, 1.0, 0.001, 0.0):
        active = [old_candidate]
        names = [
            "qualified-pre-410-basement" if age <= 410.0
            else "qualified-pre-410-basement(additive-owner)"
        ]
        uncertain = []
        for feature in features[1:-1]:
            properties = feature["properties"]
            preserve_native = properties.get("ageGatePolicy", "").startswith("preserve-")
            active_at_age = (
                age <= properties["geometryLifecycleMa"]["oldest"]
                if preserve_native else
                age <= properties["possibleOldestCrustMa"]
                and age <= properties["geometryLifecycleMa"]["oldest"]
            )
            if active_at_age:
                active.append(shape(feature["geometry"]))
                names.append(properties["domain"])
                if (not preserve_native
                        and age > properties["formationIntervalMa"]["youngest"]):
                    uncertain.append(properties["domain"])
        if age <= 410.0:
            active.append(residual)
            names.append("outside-USGS-and-Northern-Cordillera-coverage")
        visible = polygonal(unary_union(active))
        visible_p = polygonal(transform(project.transform, visible))
        snapshots.append({
            "ageMa": age, "visibleKm2": visible_p.area / 1_000_000,
            "visibleFraction": visible_p.area / target_p.area,
            "activeDomains": names, "formationUncertainDomains": uncertain,
        })

    present = polygonal(unary_union([shape(feature["geometry"]) for feature in features]))
    present_p = polygonal(transform(project.transform, present))
    missing_p = polygonal(transform(project.transform, target.difference(present)))
    outside_p = polygonal(transform(project.transform, present.difference(target)))
    symmetric_difference_km2 = (missing_p.area + outside_p.area) / 1_000_000
    audit = {
        "schemaVersion": 1,
        "status": "source-qualified-native-mask-required",
        "target": {
            "patchId": TARGET_ID, "sourceFeatureOrder": TARGET_ORDER,
            "sourceFeatureName": "Purcell Mountains North America Craton",
            "plateId": TARGET_PLATE_ID,
            "originalValidTimeMa": {"oldest": 410, "youngest": None},
        },
        "oldMaterial": {
            "geometryAsset": old_row["filename"],
            "geometrySha256": old_row["geometrySha"],
            "areaAt411Km2": target_validation["candidateAreaKm2"],
            "fractionAt411": target_validation["candidateTargetFraction"],
            "rawOldDs898IntersectionKm2": target_validation["basement"]["rawOldIntersectionKm2"],
        },
        "youngerDomains": younger_rows,
        "northernCordilleraTerranes": cordillera_rows,
        "northernCordilleraSource": {
            "title": "Northern Cordillera terrane compilation",
            "citation": "Colpron, M., Nelson, J.L., and collaborators; BC Geological Survey and Yukon Geological Survey, revised through 2015",
            "catalog": "https://open.canada.ca/data/en/dataset/16d06638-87a8-40a4-8550-910370d2fd76",
            "service": "https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon/GY_Geological/MapServer/14",
            "retrievedAt": "2026-09-12", "scale": "about 1:5,000,000",
            "positionalAccuracy": "about 1 km for British Columbia and Yukon; about 5 km for Alaska",
            "license": "Open Government Licence - Canada",
            "bytes": CORDILLERA_BYTES, "sha256": CORDILLERA_SHA,
            "evidenceRole": "terrane footprint, affinity, tectonic setting, and broad stratigraphic/plutonic age; not basement formation or plate motion",
        },
        "ageSnapshots": snapshots,
        "presentUnionOutsideTargetCoordinateArea": present.difference(target).area,
        "presentTargetOutsideUnionCoordinateArea": target.difference(present).area,
        "presentUnionSymmetricDifferenceKm2": symmetric_difference_km2,
        "residualTriangulationRepair": {
            "rawComponentCount": len(residual_parts),
            "keptComponentCount": len(kept_parts),
            "droppedComponentCount": len(dropped_parts),
            "droppedSourcePartIndexes": sorted(UNTRIANGULATABLE_RESIDUAL_PARTS),
            "minimumComponentAreaM2": MIN_TRIANGULATABLE_RESIDUAL_M2,
            "droppedAreaKm2": transform(project.transform, dropped_residual).area / 1_000_000,
            "presentUnionToleranceKm2": 0.001,
            "withinTolerance": symmetric_difference_km2 <= 0.001,
            "reason": "six sub-100 m2 overlay slivers collapsed under float32 spherical triangulation; removing them preserves the inherited native lifecycle within a 0.001 km2 union tolerance",
        },
        "policy": {
            "material": "the old baseline persists through the native interval and has one separate additive owner older than 410; DS898 and Northern Cordillera clips appear within possible formation bounds; the remaining unmapped residual keeps its authored native lifecycle",
            "originVersusAssembly": "DS898 crust-formation ages gate material. Northern Cordillera ages gate only juvenile/oceanic/arc/accretionary domains; Coast plutonic complex and Methow/Harrison basin ages describe intrusion or cover, so those clips retain native support with unknown substrate age.",
            "pose": "all clips retain Cao plate-1731 motion as an explicit uncertain partition-level inference",
            "surfaceEvidence": "unknown",
        },
        "rejectionConditions": [
            "the complete source490 polygon appears at 410 Ma",
            "post-410 basement survives where it merely overlaps the older aCOB",
            "domain-wide age intervals are presented as exact simultaneous formation",
            "the target-partition pose is presented as independent local palaeomagnetic evidence",
        ],
    }
    return audit, {"type": "FeatureCollection", "features": features}


def source450_projection(target):
    from pyproj import Transformer
    centre = target.representative_point()
    return Transformer.from_crs(
        "EPSG:4326",
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} +datum=WGS84 +units=m +no_defs",
        always_xy=True,
    )


def main():
    audit, tiles = compile_replacement()
    OUTPUT.write_text(json.dumps(audit, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    TILES_OUTPUT.write_text(json.dumps(tiles, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"ages": audit["ageSnapshots"], "features": len(tiles["features"])}, sort_keys=True))


if __name__ == "__main__":
    main()
