#!/usr/bin/env python3
"""Audit the Cao source-order-450 footprint against mapped western basement."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from pathlib import Path

try:
    import pygplates
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import MultiPolygon, Polygon, shape
    from shapely.ops import transform, unary_union
    from shapely.validation import make_valid
except ImportError as error:  # pragma: no cover
    raise SystemExit(
        "regional_western_source450_audit.py requires pygplates, pyshp, pyproj, and shapely"
    ) from error


ROOT = Path(__file__).resolve().parents[2]
MODEL_ROOT = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
SOURCE_ROOT = ROOT.parent / "EarthHistory-data/palaeomap-study/regional-corrections/western-completion"
OUTPUT = ROOT / "docs/research/regional-western-source450-validation.json"
TILES_OUTPUT = ROOT / "data/corrections/western-laurentia/western-source450-domain-tiles-v1.geojson"

TARGET_ORDER = 450
TARGET_FEATURE_ID = "GPlates-9e1d4153-557b-4b65-b6fb-5ec2bfbb2c42"
TARGET_PLATE_ID = 176
TARGET_VALID_TIME = (410.0, float("-inf"))
TARGET_PATCH_ID = f"cao-coast:{TARGET_FEATURE_ID}:{TARGET_ORDER}:0"

DS898_PATH = SOURCE_ROOT / "ds898-basement-domains.geojson"
DS898_BYTES = 725_411
DS898_SHA = "007b035b494f84e6a34465971c6b876d65952f77d9be0fdb88bb617756333052"
DS898_EXPECTED = {
    7: ("Mojave", "Lateral-extensional orogen", "1840 Ma"),
    33: ("Salinia", "Lateral-extensional orogen", "1700 Ma"),
    35: ("Shoofly-Olds Ferry", "Oceanic arc", "365-187 Ma"),
    36: ("Calaveras-Baker", "Accretionary wedge", "315-215 Ma"),
    37: ("Foothills-Wallowa", "Oceanic arc", "280-165 Ma"),
    38: ("Great Valley", "Oceanic basin", "175-165 Ma"),
    39: ("Franciscan", "Accretionary wedge", "165-50 Ma"),
    40: ("Siletzia", "Oceanic basin", "60-50 Ma"),
}
PRE_410_IDS = {7, 33}
FORMATION_INTERVALS = {
    7: (1840.0, 1840.0),
    33: (1700.0, 1700.0),
    35: (365.0, 187.0),
    36: (315.0, 215.0),
    37: (280.0, 165.0),
    38: (175.0, 165.0),
    39: (165.0, 50.0),
    40: (60.0, 50.0),
}
POSSIBLE_OLDEST = {37: 300.0}

EKT_PATH = SOURCE_ROOT / "of12-1228-arcpkg.zip"
EKT_BYTES = 5_360_801
EKT_SHA = "fce631d09010046fadfc302b64a06068e0c6b70082de0d7a5a942dce6585517e"
EKT_SHAPE_ROOT = "of12-1228-arcpkg/of12-1228-geo-shape/of12_1228_py"
EKT_CODES = {
    "Jp", "mi", "Ja", "Trm", "Trh", "Trp", "Pbh", "Ppr", "aqd", "md",
    "Pd", "Pn", "Pm", "Mb", "Mbd", "Dk", "Dmm", "Dbr", "Dcg", "tum", "tgb",
}
TRINITY_CODES = {"tum", "tgb"}


class AuditError(ValueError):
    pass


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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
    from shapely.geometry import mapping

    def visit(value):
        if isinstance(value, (tuple, list)):
            return [visit(item) for item in value]
        return round(value, 6) if isinstance(value, float) else value

    return visit(mapping(geometry))


def material_status_intervals(oldest, youngest, possible_oldest, lifecycle_oldest=410.0):
    rows = []
    if possible_oldest < lifecycle_oldest:
        rows.append({
            "status": "absent-before-formation", "youngestExclusive": possible_oldest,
            "oldest": lifecycle_oldest,
        })
    uncertain_oldest = min(possible_oldest, lifecycle_oldest)
    if youngest < uncertain_oldest:
        rows.append({
            "status": "formation-uncertain", "youngest": youngest,
            "oldest": uncertain_oldest,
        })
    supported_oldest = min(youngest, lifecycle_oldest)
    supported = {"status": "material-supported", "youngest": 0.0}
    supported["oldest" if supported_oldest == lifecycle_oldest and youngest >= lifecycle_oldest
              else "oldestExclusive"] = supported_oldest
    rows.append(supported)
    return rows


def spherical_polygon(geometry):
    rings = [[(point.to_lat_lon()[1], point.to_lat_lon()[0])
              for point in geometry.get_exterior_ring_points()]]
    rings.extend(
        [(point.to_lat_lon()[1], point.to_lat_lon()[0])
         for point in geometry.get_interior_ring_points(index)]
        for index in range(geometry.get_number_of_interior_rings())
    )
    return polygonal(Polygon(rings[0], rings[1:]))


def load_target():
    features = list(pygplates.FeatureCollection(str(MODEL_ROOT / "shapes_coasts.gpmlz")))
    feature = features[TARGET_ORDER]
    polygons = [geometry for geometry in feature.get_all_geometries()
                if isinstance(geometry, pygplates.PolygonOnSphere)]
    identity = (
        str(feature.get_feature_id()), feature.get_reconstruction_plate_id(None),
        feature.get_valid_time(), feature.get_name(""), len(polygons),
    )
    expected = (TARGET_FEATURE_ID, TARGET_PLATE_ID, TARGET_VALID_TIME, "East Klamath", 1)
    if identity != expected:
        raise AuditError(f"Cao source-order-450 identity changed: {identity!r}")
    return spherical_polygon(polygons[0])


def projection_for(geometry):
    centre = geometry.representative_point()
    return Transformer.from_crs(
        "EPSG:4326",
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} "
        "+datum=WGS84 +units=m +no_defs",
        always_xy=True,
    )


def ds898_audit(target, project):
    if DS898_PATH.stat().st_size != DS898_BYTES or sha256(DS898_PATH) != DS898_SHA:
        raise AuditError("pinned USGS DS898 GeoJSON is missing or changed")
    data = json.loads(DS898_PATH.read_text())
    if len(data.get("features", [])) != 82:
        raise AuditError("USGS DS898 service feature count changed")
    target_p = polygonal(transform(project.transform, target))
    rows = []
    clips = []
    tile_features = []
    for feature in data["features"]:
        geometry = polygonal(shape(feature["geometry"]))
        clipped = polygonal(geometry.intersection(target))
        if clipped.is_empty:
            continue
        clipped_p = polygonal(transform(project.transform, clipped))
        if clipped_p.area <= 1:
            continue
        properties = feature["properties"]
        fid = properties["fid"]
        expected = DS898_EXPECTED.get(fid)
        identity = (properties["domain"], properties["crust_type"], properties["crust_age"])
        if expected != identity:
            raise AuditError(f"unexpected DS898 source450 domain {fid}: {identity!r}")
        rows.append({
            "fid": fid,
            "domain": properties["domain"],
            "crustType": properties["crust_type"],
            "crustFormationAge": properties["crust_age"],
            "accretionType": properties["accr_type"].strip() or None,
            "accretionAge": properties["accr_age"].strip() or None,
            "notes": properties["notes"].strip() or None,
            "intersectionKm2": clipped_p.area / 1_000_000,
            "predates410Ma": fid in PRE_410_IDS,
        })
        clips.append(clipped_p)
        oldest, youngest = FORMATION_INTERVALS[fid]
        lifecycle_oldest = 540.0 if fid in PRE_410_IDS else 410.0
        tile_features.append({
            "type": "Feature",
            "id": f"source450-ds898-domain-{fid}",
            "properties": {
                "sourceFeatureOrder": TARGET_ORDER,
                "sourceFeatureId": TARGET_FEATURE_ID,
                "targetPatchId": TARGET_PATCH_ID,
                "sourcePlateId": TARGET_PLATE_ID,
                "ds898Fid": fid,
                "domain": properties["domain"],
                "crustType": properties["crust_type"],
                "formationIntervalMa": {"oldest": oldest, "youngest": youngest},
                "possibleOldestCrustMa": POSSIBLE_OLDEST.get(fid, oldest),
                "materialOriginRangeMa": [POSSIBLE_OLDEST.get(fid, oldest), youngest],
                "visibilityPolicy": {
                    "absentWhenOlderThanMa": POSSIBLE_OLDEST.get(fid, oldest),
                    "formationUncertainFromMa": POSSIBLE_OLDEST.get(fid, oldest),
                    "formationUncertainToMa": youngest,
                    "supportedWhenYoungerThanOrEqualMa": youngest,
                },
                "ageUncertainty": "DS898 ages characterize a domain; they do not date simultaneous formation of every point in this clipped polygon",
                "materialStatusIntervalsMa": material_status_intervals(
                    oldest, youngest, POSSIBLE_OLDEST.get(fid, oldest), lifecycle_oldest
                ),
                "geometryLifecycleMa": {"youngest": 0.0, "oldest": lifecycle_oldest},
                "surfaceEvidence": "unknown",
                "pose": {
                    "plateId": TARGET_PLATE_ID,
                    "status": "model-inference",
                    "warning": "DS898 constrains material identity and age, not plate motion; carrying this present-coordinate clip with Cao plate 176 is an explicit uncertain inference",
                },
            },
            "geometry": rounded_mapping(clipped),
        })
    if set(row["fid"] for row in rows) != set(DS898_EXPECTED):
        raise AuditError("source450 no longer intersects the expected eight DS898 domains")
    union_p = polygonal(unary_union(clips))
    mapped_reference = polygonal(unary_union([
        shape(feature["geometry"]) for feature in tile_features
    ]))
    residual = polygonal(target.difference(mapped_reference))
    if not residual.is_empty:
        tile_features.append({
            "type": "Feature",
            "id": "source450-unclassified-native-remainder",
            "properties": {
                "sourceFeatureOrder": TARGET_ORDER,
                "sourceFeatureId": TARGET_FEATURE_ID,
                "targetPatchId": TARGET_PATCH_ID,
                "sourcePlateId": TARGET_PLATE_ID,
                "domain": "outside-USGS-DS898-coverage",
                "crustType": "unclassified",
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

    snapshots = []
    for age in (540.0, 410.001, 410.0, 400.0, 365.0, 250.0, 100.0, 50.0, 25.0, 5.0, 1.0, 0.001, 0.0):
        active = []
        active_domains = []
        formation_uncertain = []
        for feature in tile_features:
            properties = feature["properties"]
            if "ds898Fid" not in properties:
                continue
            oldest = properties["possibleOldestCrustMa"]
            youngest = properties["formationIntervalMa"]["youngest"]
            if age <= oldest:
                active.append(shape(feature["geometry"]))
                active_domains.append(properties["domain"])
                if age > youngest:
                    formation_uncertain.append(properties["domain"])
        if not residual.is_empty and age <= 410.0:
            active.append(residual)
            active_domains.append("outside-USGS-DS898-coverage")
        visible = polygonal(unary_union(active))
        visible_p = polygonal(transform(project.transform, visible))
        snapshots.append({
            "ageMa": age,
            "visibleKm2": visible_p.area / 1_000_000,
            "visibleFraction": visible_p.area / target_p.area,
            "activeDomains": active_domains,
            "formationUncertainDomains": formation_uncertain,
        })
    older_area = sum(row["intersectionKm2"] for row in rows if row["predates410Ma"])
    younger_area = sum(row["intersectionKm2"] for row in rows if not row["predates410Ma"])
    audit = {
        "source": {
            "title": "Basement domain map of the conterminous United States and Alaska",
            "citation": "Lund, K., Box, S.E., Holm-Denoma, C.S., San Juan, C.A., Blakely, R.J., Saltus, R.W., Anderson, E.D., and DeWitt, E.H. (2015), USGS Data Series 898",
            "doi": "https://doi.org/10.3133/ds898",
            "service": "https://energy.usgs.gov/arcgis/rest/services/Hosted/ds898/FeatureServer/0",
            "retrievedAt": "2026-09-12",
            "scale": "1:5,000,000",
            "featureCount": len(data["features"]),
            "bytes": DS898_BYTES,
            "sha256": DS898_SHA,
            "evidenceRole": "interpreted basement composition, origin, architecture, and crust-formation age; not a plate-motion model",
        },
        "domains": sorted(rows, key=lambda row: row["intersectionKm2"], reverse=True),
        "targetAreaKm2": target_p.area / 1_000_000,
        "mappedUnionKm2": union_p.area / 1_000_000,
        "mappedFraction": union_p.area / target_p.area,
        "predates410Km2": older_area,
        "predates410Fraction": older_area / (target_p.area / 1_000_000),
        "postdates410Km2": younger_area,
        "postdates410Fraction": younger_area / (target_p.area / 1_000_000),
        "agePolicy": {
            "meaning": "domain-scale crust-age intervals bound material visibility but do not assert that each whole polygon formed instantaneously",
            "foothillsWallowa": "the 280-165 Ma CRUST_AGE field is broadened to a possible 300 Ma oldest edge because DS898 notes basement to the Klamath arc as old as 300 Ma",
            "franciscan": "the note that accreted rocks can be as young as 15 Ma constrains assembly and is not substituted for the 165-50 Ma crust-formation field",
            "salinia": "the source calls Salinia a possible Mojave fragment and records 30-0 Ma strike-slip accretion; its affinity and plate-176 pose remain uncertain",
        },
        "ageSnapshots": snapshots,
        "presentUnionOutsideTargetKm2": polygonal(
            transform(project.transform, mapped_reference.union(residual).difference(target))
        ).area / 1_000_000,
        "presentTargetOutsideUnionKm2": polygonal(
            transform(project.transform, target.difference(mapped_reference.union(residual)))
        ).area / 1_000_000,
    }
    return audit, {"type": "FeatureCollection", "features": tile_features}


def redding_terrane_audit(target, project):
    if EKT_PATH.stat().st_size != EKT_BYTES or sha256(EKT_PATH) != EKT_SHA:
        raise AuditError("pinned USGS Redding archive is missing or changed")
    with zipfile.ZipFile(EKT_PATH) as archive:
        reader = shapefile.Reader(
            shp=io.BytesIO(archive.read(EKT_SHAPE_ROOT + ".shp")),
            shx=io.BytesIO(archive.read(EKT_SHAPE_ROOT + ".shx")),
            dbf=io.BytesIO(archive.read(EKT_SHAPE_ROOT + ".dbf")),
        )
        fields = [field[0] for field in reader.fields[1:]]
        transformer = Transformer.from_crs(
            "+proj=tmerc +lat_0=0 +lon_0=-123 +k=1 +x_0=0 +y_0=0 +datum=NAD27 +units=m +no_defs",
            "EPSG:4326", always_xy=True,
        )
        selections = {"mappedEasternKlamath": [], "trinityOrdovician": []}
        counts = {key: 0 for key in selections}
        for row in reader.iterShapeRecords():
            properties = dict(zip(fields, row.record))
            code = properties["PTYPE"].strip()
            geometry = polygonal(transform(transformer.transform, shape(row.shape.__geo_interface__)))
            if code in EKT_CODES:
                selections["mappedEasternKlamath"].append(geometry)
                counts["mappedEasternKlamath"] += 1
            if code in TRINITY_CODES:
                selections["trinityOrdovician"].append(geometry)
                counts["trinityOrdovician"] += 1
    result = {}
    for key, geometries in selections.items():
        union = polygonal(unary_union(geometries))
        union_p = polygonal(transform(project.transform, union))
        overlap_p = polygonal(transform(project.transform, union.intersection(target)))
        result[key] = {
            "sourcePolygonCount": counts[key],
            "componentCount": len(union.geoms) if isinstance(union, MultiPolygon) else 1,
            "areaKm2": union_p.area / 1_000_000,
            "boundsLonLat": list(union.bounds),
            "source450OverlapKm2": overlap_p.area / 1_000_000,
        }
    return {
        "source": {
            "title": "Digital geologic map of the Redding 1 x 2 degree quadrangle, California",
            "citation": "Irwin, W.P., and Wentworth, C.M. (2012), USGS Open-File Report 2012-1228",
            "url": "https://pubs.usgs.gov/publication/ofr20121228",
            "retrievedAt": "2026-09-12",
            "scale": "1:250,000",
            "sourceCrs": "NAD27 custom Transverse Mercator, central meridian -123, scale factor 1",
            "bytes": EKT_BYTES,
            "sha256": EKT_SHA,
        },
        **result,
    }


def audit():
    target = load_target()
    project = projection_for(target)
    ds898, tiles = ds898_audit(target, project)
    redding = redding_terrane_audit(target, project)
    result = {
        "schemaVersion": 1,
        "status": "source-qualified-native-mask-required",
        "target": {
            "patchId": TARGET_PATCH_ID,
            "sourceFeatureOrder": TARGET_ORDER,
            "sourceFeatureName": "East Klamath",
            "plateId": TARGET_PLATE_ID,
            "originalValidTimeMa": {"oldest": 410, "youngest": None},
            "referenceBoundsLonLat": list(target.bounds),
        },
        "basementAudit": ds898,
        "terraneFootprintAudit": redding,
        "diagnosis": {
            "material": "At the 410 Ma endpoint, 90.9% of the target overlaps basement whose mapped crust-formation interval postdates 410 Ma. The only older basement intersections are Mojave and Salinia, not Eastern Klamath.",
            "geometry": "The official mapped Eastern Klamath units and Ordovician Trinity nucleus have zero overlap with the exact Cao target. The target name is therefore a motion-partition label, not a terrane-footprint claim.",
            "pose": "DS898 and the Redding map do not supply plate rotations. Salinia is a displaced Mojave fragment and cannot be moved back on plate 176 from its modern footprint without an explicit kinematic conversion.",
        },
        "disposition": {
            "olderContinuation": "none from source450",
            "nativeEndpoint": "mask the younger DS898 domain portions near 410 Ma rather than displaying the full modern California mosaic at its oldest instant",
            "preserveYoungerMaterial": "unmask domain portions only within their reported formation-age ranges; do not delete the target across its complete 410-0 Ma lifetime",
            "implementationOwner": "shared correction runtime; this audit intentionally emits no additive plate-176 geometry",
        },
        "rejectionConditions": [
            "the off-target Redding terrane geometry is attached to source450 merely because both use the East Klamath name",
            "Mojave or displaced Salinia basement is reconstructed with plate 176 without a documented kinematic conversion",
            "the full source450 target is continued older than 410 Ma",
            "the full source450 target is removed at younger ages where its younger basement domains exist",
        ],
    }
    return result, tiles


def main():
    result, tiles = audit()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    TILES_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    TILES_OUTPUT.write_text(json.dumps(tiles, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    print(json.dumps({
        "targetAreaKm2": result["basementAudit"]["targetAreaKm2"],
        "predates410Fraction": result["basementAudit"]["predates410Fraction"],
        "mappedEasternKlamathOverlapKm2": result["terraneFootprintAudit"]["mappedEasternKlamath"]["source450OverlapKm2"],
    }, sort_keys=True))


if __name__ == "__main__":
    main()
