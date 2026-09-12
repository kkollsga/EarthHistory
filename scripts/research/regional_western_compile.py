#!/usr/bin/env python3
"""Compile the source-qualified western Laurentia material candidate."""

from __future__ import annotations

import hashlib
import io
import json
import math
import zipfile
from collections import Counter
from pathlib import Path

try:
    import pygplates
    import shapefile
    from pyproj import Transformer
    from shapely.geometry import MultiPolygon, Polygon, mapping, shape
    from shapely.ops import transform, unary_union
    from shapely.validation import make_valid
except ImportError as error:  # pragma: no cover
    raise SystemExit(
        "regional_western_compile.py requires pygplates, pyshp, pyproj, and shapely"
    ) from error

from cao_material_corrections import load_stage, target_catalog


ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = ROOT.parent / "EarthHistory-data/palaeomap-study/regional-corrections/western-laurentia"
COMPLETION_ROOT = ROOT.parent / "EarthHistory-data/palaeomap-study/regional-corrections/western-completion"
MODEL_ROOT = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
OUTPUT_ROOT = ROOT / "data/corrections/western-laurentia"
VALIDATION_PATH = ROOT / "docs/research/regional-western-laurentia-validation.json"
SOURCE_ARCHIVE = SOURCE_ROOT / "48States_shape.ZIP"
TARGET_PATCH = "cao-coast:GPlates-79e80d97-d4aa-4269-8507-d50c8193a298:503:0"
PURCELL_PATCH = "cao-coast:GPlates-6ee78b87-bf48-4f5c-8da4-eab35d483a0a:490:0"
TARGET_FEATURE_ORDER = 503
PURCELL_FEATURE_ORDER = 490
TARGET_PLATE = 154
PURCELL_PLATE = 1731
SOURCE_CODE = "Y"
REFERENCE_AGE_MA = 0.0
INSET_METRES = 1000.0
SIMPLIFY_METRES = 2000.0
GUARD_METRES = 100.0
CONTAINMENT_TOLERANCE_M2 = 1.0
EARTH_KM = 6371.0088
SOURCE_SHA = "51d27b0068cf08f173a97c6557668e8665445638aedaf929d69e825bf8cd9555"
SOURCE_BYTES = 8160886
SOURCE_COLLECTION_SHA = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"
ACOB_COLLECTION = "COBfile_1800_0.gpml"
ACOB_COLLECTION_SHA = "cfcea20c5244613e53ad4b9cdf6411d79ff535c25af335b4fa6eb9251377d4bd"
ACOB_FEATURE_ORDER = 1284
ACOB_FEATURE_ID = "GPlates-a11dc09a-42de-4b11-a6ce-d30baae64ce4"
ACOB_PLATE = 101
ACOB_NAME = "Laurentia aCOB"
ACOB_VALID_TIME = (1070.0, 410.1)
DS898_PATH = COMPLETION_ROOT / "ds898-basement-domains.geojson"
DS898_SHA = "007b035b494f84e6a34465971c6b876d65952f77d9be0fdb88bb617756333052"
DS898_BYTES = 725_411
DS898_OLD_DOMAIN_IDS = {12, 13, 14, 15, 16, 17, 18, 19}
QUALIFICATION_AGE_MA = 411.0
ROTATION_SHA = "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f"
TOPOLOGY_SHA = "411bd3e5e5a2004ea42792a5c1be11942a46b52e3657efdb06507c147fbfdf1a"


class BuildError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def verify_source_code(code: str) -> None:
    if code != "Y":
        raise BuildError("only USGS code Y Middle Proterozoic sedimentary rocks is qualified")


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


def source_polygon(geometry):
    rings = [[(p.to_lat_lon()[1], p.to_lat_lon()[0]) for p in geometry.get_exterior_ring_points()]]
    rings.extend(
        [(p.to_lat_lon()[1], p.to_lat_lon()[0]) for p in geometry.get_interior_ring_points(i)]
        for i in range(geometry.get_number_of_interior_rings())
    )
    return polygonal(Polygon(rings[0], rings[1:]))


def pose_geometry(geometry, rotation):
    def pose(xs, ys, zs=None):
        scalar = isinstance(xs, (int, float))
        x_rows, y_rows = ([xs], [ys]) if scalar else (xs, ys)
        result = []
        for longitude, latitude in zip(x_rows, y_rows):
            moved = rotation * pygplates.PointOnSphere(latitude, longitude)
            lat, lon = moved.to_lat_lon()
            result.append((lon, lat))
        if scalar:
            return result[0]
        return tuple(row[0] for row in result), tuple(row[1] for row in result)

    return polygonal(transform(pose, geometry))


def rounded_mapping(geometry):
    def visit(value):
        if isinstance(value, (tuple, list)):
            return [visit(row) for row in value]
        return round(value, 6) if isinstance(value, float) else value

    return visit(mapping(geometry))


def vertex_count(geometry) -> int:
    polygons = [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)
    return sum(
        len(row.exterior.coords) + sum(len(ring.coords) for ring in row.interiors)
        for row in polygons
    )


def load_target_geometries():
    target = None
    purcell = None
    for order, feature in enumerate(
        pygplates.FeatureCollection(str(MODEL_ROOT / "shapes_coasts.gpmlz"))
    ):
        if order not in (TARGET_FEATURE_ORDER, PURCELL_FEATURE_ORDER):
            continue
        rows = [geometry for geometry in feature.get_all_geometries()
                if isinstance(geometry, pygplates.PolygonOnSphere)]
        if not rows:
            raise BuildError(f"Cao western target {order} has no polygon geometry")
        if order == TARGET_FEATURE_ORDER:
            if feature.get_reconstruction_plate_id(None) != TARGET_PLATE:
                raise BuildError("plate-154 target identity changed")
            if len(rows) != 1:
                raise BuildError("plate-154 exact target geometry count changed")
            target = source_polygon(rows[0])
        else:
            if feature.get_reconstruction_plate_id(None) != PURCELL_PLATE:
                raise BuildError("plate-1731 target identity changed")
            # The feature also contains a 0.58 km2 geometry. The correction
            # identity is explicitly geometry order 0, not UUID-wide.
            purcell = source_polygon(rows[0])
    if target is None or purcell is None:
        raise BuildError("expected Cao western target geometries are missing")
    return target, purcell


def load_laurentia_acob():
    path = MODEL_ROOT / ACOB_COLLECTION
    if path.stat().st_size != 14_423_254 or sha256(path.read_bytes()) != ACOB_COLLECTION_SHA:
        raise BuildError("pinned Cao aCOB collection is missing or changed")
    features = list(pygplates.FeatureCollection(str(path)))
    if ACOB_FEATURE_ORDER >= len(features):
        raise BuildError("pinned Laurentia aCOB feature order is missing")
    feature = features[ACOB_FEATURE_ORDER]
    geometries = [geometry for geometry in feature.get_all_geometries()
                  if isinstance(geometry, pygplates.PolygonOnSphere)]
    identity = (
        str(feature.get_feature_id()), feature.get_reconstruction_plate_id(None),
        feature.get_valid_time(), feature.get_name(""), len(geometries),
    )
    expected = (ACOB_FEATURE_ID, ACOB_PLATE, ACOB_VALID_TIME, ACOB_NAME, 1)
    if identity != expected:
        raise BuildError(f"pinned Laurentia aCOB identity changed: {identity!r}")
    return source_polygon(geometries[0])


def load_ds898_domains():
    if DS898_PATH.stat().st_size != DS898_BYTES or sha256(DS898_PATH.read_bytes()) != DS898_SHA:
        raise BuildError("pinned USGS DS898 basement domains are missing or changed")
    data = json.loads(DS898_PATH.read_text())
    if len(data.get("features", [])) != 82:
        raise BuildError("USGS DS898 feature count changed")
    return [
        (feature["properties"], polygonal(shape(feature["geometry"])))
        for feature in data["features"]
    ]


def qualified_basement_masks(target, domains):
    """Build inset old-domain support and a conservative younger-domain veto."""
    centre = target.representative_point()
    projected_crs = (
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} "
        "+datum=WGS84 +units=m +no_defs"
    )
    forward = Transformer.from_crs("EPSG:4326", projected_crs, always_xy=True)
    reverse = Transformer.from_crs(projected_crs, "EPSG:4326", always_xy=True)
    target_p = polygonal(transform(forward.transform, target))
    old_p = []
    young_p = []
    selected = []
    excluded = []
    for properties, geometry in domains:
        clipped = polygonal(transform(forward.transform, geometry).intersection(target_p))
        if clipped.is_empty or clipped.area <= 1:
            continue
        row = {
            "fid": properties["fid"], "domain": properties["domain"],
            "crustType": properties["crust_type"], "crustAge": properties["crust_age"],
            "intersectionKm2": clipped.area / 1_000_000,
        }
        if properties["fid"] in DS898_OLD_DOMAIN_IDS:
            old_p.append(clipped)
            selected.append(row)
        else:
            young_p.append(clipped)
            excluded.append(row)
    raw_old = polygonal(unary_union(old_p)) if old_p else MultiPolygon([])
    raw_young = polygonal(unary_union(young_p)) if young_p else MultiPolygon([])
    old_candidate_p = polygonal(
        target_p.buffer(-(INSET_METRES + SIMPLIFY_METRES + GUARD_METRES))
        .intersection(raw_old.buffer(-(INSET_METRES + SIMPLIFY_METRES + GUARD_METRES)))
        .simplify(SIMPLIFY_METRES, preserve_topology=True)
    )
    # Expand the veto slightly so coordinate rounding cannot leave thin slivers
    # of independently mapped post-410 crust in an older aCOB candidate.
    younger_veto_p = polygonal(raw_young.buffer(INSET_METRES))
    old_candidate = polygonal(transform(reverse.transform, old_candidate_p))
    raw_old_reference = polygonal(transform(reverse.transform, raw_old))
    younger_veto = polygonal(transform(reverse.transform, younger_veto_p))
    return old_candidate, raw_old_reference, younger_veto, {
        "selectedOldDomains": selected,
        "excludedYoungerDomains": excluded,
        "rawOldIntersectionKm2": raw_old.area / 1_000_000,
        "oldCandidateKm2": old_candidate_p.area / 1_000_000,
        "rawYoungerIntersectionKm2": raw_young.area / 1_000_000,
    }


def reconcile_material_mask(target, acob_candidate, old_candidate, younger_veto):
    centre = target.representative_point()
    projected_crs = (
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} "
        "+datum=WGS84 +units=m +no_defs"
    )
    forward = Transformer.from_crs("EPSG:4326", projected_crs, always_xy=True)
    reverse = Transformer.from_crs(projected_crs, "EPSG:4326", always_xy=True)
    target_p = polygonal(transform(forward.transform, target))
    acob_p = polygonal(transform(forward.transform, acob_candidate))
    old_p = polygonal(transform(forward.transform, old_candidate))
    veto_p = polygonal(transform(forward.transform, younger_veto))
    revised_p = polygonal(acob_p.difference(veto_p).union(old_p).intersection(target_p))
    if revised_p.difference(target_p).area > CONTAINMENT_TOLERANCE_M2:
        raise BuildError("reconciled western mask escaped its exact target")
    return polygonal(transform(reverse.transform, revised_p)), {
        "acobBeforeBasementReconciliationKm2": acob_p.area / 1_000_000,
        "acobRemovedByYoungerBasementVetoKm2": acob_p.intersection(veto_p).area / 1_000_000,
        "oldBasementAddedOutsideVetoedAcobKm2": old_p.difference(acob_p.difference(veto_p)).area / 1_000_000,
        "reconciledCandidateKm2": revised_p.area / 1_000_000,
    }


def read_source():
    if SOURCE_ARCHIVE.stat().st_size != SOURCE_BYTES or sha256(SOURCE_ARCHIVE.read_bytes()) != SOURCE_SHA:
        raise BuildError("USGS fallback archive changed")
    with zipfile.ZipFile(SOURCE_ARCHIVE) as archive:
        return shapefile.Reader(
            shp=io.BytesIO(archive.read("geolgyp075.shp")),
            shx=io.BytesIO(archive.read("geolgyp075.shx")),
            dbf=io.BytesIO(archive.read("geolgyp075.dbf")),
        )


def active_at(feature, age):
    oldest, youngest = feature.get_valid_time()
    return youngest <= age <= oldest


def strict_rotation(rotations, age, plate_id):
    rotation = rotations.get_rotation(
        age, plate_id, use_identity_for_missing_plate_ids=False
    )
    if rotation is None:
        raise BuildError(f"missing strict Cao rotation for plate {plate_id} at {age} Ma")
    return rotation


def coverage_at_age(age, candidate, target, target_plate, rotations):
    rotation = strict_rotation(rotations, age, target_plate)
    candidate_age = pose_geometry(candidate, rotation)
    target_age = pose_geometry(target, rotation)
    centre = target_age.representative_point()
    projection = Transformer.from_crs(
        "EPSG:4326",
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} +datum=WGS84 +units=m +no_defs",
        always_xy=True,
    )
    candidate_p = polygonal(transform(projection.transform, candidate_age))
    target_p = polygonal(transform(projection.transform, target_age))
    clips = []
    for feature in pygplates.FeatureCollection(str(MODEL_ROOT / "shapes_coasts.gpmlz")):
        if not active_at(feature, age):
            continue
        feature_rotation = strict_rotation(
            rotations, age, feature.get_reconstruction_plate_id(0)
        )
        for source_geometry_row in feature.get_all_geometries():
            if not isinstance(source_geometry_row, pygplates.PolygonOnSphere):
                continue
            native = pose_geometry(source_polygon(source_geometry_row), feature_rotation)
            if not native.intersects(target_age):
                continue
            clip = polygonal(transform(projection.transform, native).intersection(target_p))
            if not clip.is_empty:
                clips.append(clip)
    native = polygonal(unary_union(clips)) if clips else MultiPolygon([])
    candidate_clip = polygonal(candidate_p.intersection(target_p))
    before = native.area
    after = polygonal(unary_union([native, candidate_clip])).area
    denominator = target_p.area
    return {
        "ageMa": age,
        "targetAreaKm2": denominator / 1_000_000,
        "nativeBeforeKm2": before / 1_000_000,
        "nativeBeforeFraction": before / denominator,
        "candidateWithinTargetKm2": candidate_clip.area / 1_000_000,
        "candidateNativeOverlapKm2": candidate_clip.intersection(native).area / 1_000_000,
        "novelAddedKm2": max(0.0, after - before) / 1_000_000,
        "combinedAfterFraction": after / denominator,
    }


def qualified_acob_mask(target, target_plate, acob, rotations):
    """Intersect an exact target with the older authored Laurentia aCOB.

    The intersection is performed at 411 Ma because the aCOB is authored in
    the Cao frame for 410.1-1070 Ma. It is then normalized back to the target
    plate's reference coordinates so the runtime can use the target's rigid
    motion without mixing reference frames.
    """
    target_rotation = strict_rotation(rotations, QUALIFICATION_AGE_MA, target_plate)
    acob_rotation = strict_rotation(rotations, QUALIFICATION_AGE_MA, ACOB_PLATE)
    target_age = pose_geometry(target, target_rotation)
    acob_age = pose_geometry(acob, acob_rotation)
    centre = target_age.representative_point()
    projected_crs = (
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} "
        "+datum=WGS84 +units=m +no_defs"
    )
    forward = Transformer.from_crs("EPSG:4326", projected_crs, always_xy=True)
    reverse = Transformer.from_crs(projected_crs, "EPSG:4326", always_xy=True)
    target_p = polygonal(transform(forward.transform, target_age))
    acob_p = polygonal(transform(forward.transform, acob_age))
    raw_p = polygonal(target_p.intersection(acob_p))
    qualified_p = polygonal(
        target_p.buffer(-INSET_METRES).intersection(acob_p.buffer(-INSET_METRES))
    )
    candidate_p = polygonal(
        target_p.buffer(-(INSET_METRES + SIMPLIFY_METRES + GUARD_METRES))
        .intersection(acob_p.buffer(-(INSET_METRES + SIMPLIFY_METRES + GUARD_METRES)))
        .simplify(SIMPLIFY_METRES, preserve_topology=True)
    )
    if candidate_p.is_empty:
        raise BuildError(f"aCOB qualification produced no plate-{target_plate} material")
    outside_raw = candidate_p.difference(raw_p).area
    outside_qualified = candidate_p.difference(qualified_p).area
    if max(outside_raw, outside_qualified) > CONTAINMENT_TOLERANCE_M2:
        raise BuildError(f"plate-{target_plate} aCOB candidate escaped its qualified inset")
    candidate_age = polygonal(transform(reverse.transform, candidate_p))
    candidate_reference = pose_geometry(candidate_age, target_rotation.get_inverse())
    return candidate_reference, {
        "rawIntersectionKm2": raw_p.area / 1_000_000,
        "candidateAreaKm2": candidate_p.area / 1_000_000,
        "targetAreaKm2": target_p.area / 1_000_000,
        "rawTargetFraction": raw_p.area / target_p.area,
        "candidateTargetFraction": candidate_p.area / target_p.area,
        "outsideRawKm2": outside_raw / 1_000_000,
        "outsideQualifiedInsetKm2": outside_qualified / 1_000_000,
    }


def compile_candidate():
    verify_source_code(SOURCE_CODE)
    policy = json.loads((SOURCE_ROOT / "storage-policy.json").read_text())
    source_manifest = json.loads((SOURCE_ROOT / "source-manifest.json").read_text())
    owned_bytes = sum(path.stat().st_size for path in SOURCE_ROOT.rglob("*") if path.is_file())
    study_bytes = sum(path.stat().st_size for path in SOURCE_ROOT.parents[1].rglob("*") if path.is_file())
    if owned_bytes > policy["directoryMaximumBytes"] or study_bytes > policy["parentStudyMaximumBytes"]:
        raise BuildError("western source storage bound exceeded")
    completion_policy = json.loads((COMPLETION_ROOT / "storage-policy.json").read_text())
    completion_bytes = sum(path.stat().st_size for path in COMPLETION_ROOT.rglob("*") if path.is_file())
    if (completion_bytes > completion_policy["directoryMaximumBytes"]
            or study_bytes > completion_policy["parentStudyMaximumBytes"]):
        raise BuildError("western-completion source storage bound exceeded")

    target, purcell = load_target_geometries()
    acob = load_laurentia_acob()
    basement_domains = load_ds898_domains()
    reader = read_source()
    fields = [field[0] for field in reader.fields[1:]]
    source_to_wgs84 = Transformer.from_crs("EPSG:4269", "EPSG:4326", always_xy=True)
    selected = []
    selected_orders = []
    excluded = Counter()
    purcell_selected = []
    for order, row in enumerate(reader.iterShapeRecords()):
        properties = dict(zip(fields, row.record))
        geometry = polygonal(
            transform(source_to_wgs84.transform, shape(row.shape.__geo_interface__))
        )
        code = properties["MAPUNIT_SY"].strip()
        for cohort, collection in ((target, selected), (purcell, purcell_selected)):
            if not geometry.intersects(cohort):
                continue
            clipped = polygonal(geometry.intersection(cohort))
            if clipped.is_empty:
                continue
            if code == SOURCE_CODE:
                collection.append(clipped)
                if cohort is target:
                    selected_orders.append(order)
            elif cohort is target:
                excluded[(code, properties["GEOLOGY"].strip())] += 1
    if not selected or purcell_selected:
        raise BuildError("expected plate-154 selection and zero plate-1731 Purcell intersection")

    raw = polygonal(unary_union(selected))
    centre = raw.representative_point()
    projected_crs = (
        f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} "
        "+datum=WGS84 +units=m +no_defs"
    )
    forward = Transformer.from_crs("EPSG:4326", projected_crs, always_xy=True)
    reverse = Transformer.from_crs(projected_crs, "EPSG:4326", always_xy=True)
    raw_p = polygonal(transform(forward.transform, raw))
    inset_p = polygonal(raw_p.buffer(-INSET_METRES))
    seed_p = polygonal(raw_p.buffer(-(INSET_METRES + SIMPLIFY_METRES + GUARD_METRES)))
    candidate_p = polygonal(seed_p.simplify(SIMPLIFY_METRES, preserve_topology=True))
    outside_source = candidate_p.difference(raw_p).area
    outside_inset = candidate_p.difference(inset_p).area
    if max(outside_source, outside_inset) > CONTAINMENT_TOLERANCE_M2:
        raise BuildError("western candidate escaped its source-qualified inset")
    exposure_candidate = polygonal(transform(reverse.transform, candidate_p))
    outside_target = exposure_candidate.difference(target).area
    if outside_target > 1e-10:
        raise BuildError("western candidate escaped its Cao target")

    metadata, directions = load_stage()
    catalog = target_catalog(metadata, directions)
    rotations = pygplates.RotationModel(
        [str(MODEL_ROOT / "1000_0_rotfile.rot"), str(MODEL_ROOT / "1800_1000_rotfile.rot")],
        default_anchor_plate_id=0,
    )
    candidates = []
    for patch_id, plate_id, source_geometry, slug in (
        (TARGET_PATCH, TARGET_PLATE, target, "plate-154"),
        (PURCELL_PATCH, PURCELL_PLATE, purcell, "plate-1731"),
    ):
        candidate, metrics = qualified_acob_mask(
            source_geometry, plate_id, acob, rotations
        )
        metrics["acobCandidateAreaKm2"] = metrics["candidateAreaKm2"]
        old_basement, raw_old_basement, younger_veto, basement_metrics = qualified_basement_masks(
            source_geometry, basement_domains
        )
        if plate_id == PURCELL_PLATE:
            # DS898 independently dates these basement domains before 410 Ma.
            # Preserve their exact source intersection across the seam; do not
            # trim known-old material merely because the schematic aCOB edge
            # is inset or because DS898 stops at the Canadian border.
            candidate = polygonal(raw_old_basement.intersection(source_geometry))
            centre = source_geometry.representative_point()
            tx = Transformer.from_crs(
                "EPSG:4326",
                f"+proj=laea +lat_0={centre.y:.12f} +lon_0={centre.x:.12f} +datum=WGS84 +units=m +no_defs",
                always_xy=True,
            )
            candidate_p_ds = polygonal(transform(tx.transform, candidate))
            acob_p_ds = polygonal(transform(tx.transform, qualified_acob_mask(
                source_geometry, plate_id, acob, rotations
            )[0]))
            reconciliation = {
                "acobBeforeBasementReconciliationKm2": acob_p_ds.area / 1_000_000,
                "acobRemovedByYoungerBasementVetoKm2": acob_p_ds.intersection(
                    transform(tx.transform, younger_veto)
                ).area / 1_000_000,
                "oldBasementAddedOutsideVetoedAcobKm2": candidate_p_ds.difference(
                    acob_p_ds.difference(transform(tx.transform, younger_veto))
                ).area / 1_000_000,
                "reconciledCandidateKm2": candidate_p_ds.area / 1_000_000,
                "finalAuthority": "exact target intersection with independently pre-410 DS898 basement",
            }
        else:
            candidate, reconciliation = reconcile_material_mask(
                source_geometry, candidate, old_basement, younger_veto
            )
        metrics["basement"] = basement_metrics
        metrics["reconciliation"] = reconciliation
        if plate_id == TARGET_PLATE:
            # Preserve the already accepted old-rock exposure witness where
            # the conservative aCOB inset trims it at the shared boundary.
            candidate = polygonal(unary_union([candidate, exposure_candidate]))
        witness = candidate.representative_point()
        pose_rows = []
        for age in (410.0, 410.1, 411.0, 430.0, 540.0):
            moved = strict_rotation(rotations, age, plate_id) * pygplates.PointOnSphere(
                witness.y, witness.x
            )
            latitude, longitude = moved.to_lat_lon()
            pose_rows.append({"ageMa": age, "expectedLonLat": [longitude, latitude]})
        exact_target = catalog[patch_id]
        target_row = {key: exact_target[key] for key in (
            "patchId", "sourceFeatureId", "sourceFeatureOrder", "geometryOrder", "plateId",
            "geometrySha256", "originalValidTimeMa"
        )}
        target_row["expectedMatches"] = 1
        feature_id = f"western-laurentia-qualified-material-{slug}"
        filename = f"western-laurentia-qualified-material-{slug}-v3.geojson"
        geojson = {
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature", "id": feature_id,
                "properties": {
                    "correctionFeatureId": feature_id,
                    "sourcePlateId": plate_id,
                    "materialRole": "continental-material-support",
                    "surfaceEvidence": "unknown",
                },
                "geometry": rounded_mapping(candidate),
            }],
        }
        geojson_bytes = canonical_json(geojson)
        coverage = [coverage_at_age(age, candidate, source_geometry, plate_id, rotations)
                    for age in (410.0, 410.1, 411.0, 430.0, 540.0)]
        at_411 = next(row for row in coverage if row["ageMa"] == 411.0)
        metrics["candidateAreaKm2"] = at_411["candidateWithinTargetKm2"]
        metrics["candidateTargetFraction"] = (
            at_411["candidateWithinTargetKm2"] / at_411["targetAreaKm2"]
        )
        candidates.append({
            "patchId": patch_id, "plateId": plate_id, "sourceGeometry": source_geometry,
            "candidate": candidate, "metrics": metrics, "witness": witness,
            "poseRows": pose_rows, "targetRow": target_row, "featureId": feature_id,
            "filename": filename, "geojson": geojson, "geojsonBytes": geojson_bytes,
            "geometrySha": sha256(geojson_bytes),
            "coverage": coverage,
        })

    plate154_candidate = candidates[0]["candidate"]
    exposure_outside_acob = exposure_candidate.difference(plate154_candidate).area

    def feature_manifest(row):
        plate_id = row["plateId"]
        label = "Laurentia Parautochthon" if plate_id == TARGET_PLATE else "Purcell source chart"
        sources = ["usgs-ds898-basement-domains"]
        included = []
        if plate_id == TARGET_PLATE:
            sources.insert(0, "cao-2024-v2.4-laurentia-acob")
            included.append({
                "unitId": ACOB_FEATURE_ID,
                "agePeriod": "410.1-1070 Ma authored validity",
                "reason": f"the independently authored Laurentia aCOB overlaps the exact {label} target in the Cao frame after mapped younger crust is vetoed",
            })
        included.extend({
            "unitId": f"DS898:{item['fid']}",
            "agePeriod": item["crustAge"],
            "reason": f"USGS DS898 maps the {item['domain']} basement domain within the exact target and its crust predates 410 Ma",
        } for item in row["metrics"]["basement"]["selectedOldDomains"])
        if plate_id == TARGET_PLATE:
            sources.append("usgs-national-atlas-geology48")
            included.append({
                "unitId": "Y", "geoCode": "Y", "agePeriod": "Middle Proterozoic",
                "reason": "all previously accepted mapped old-rock exposure lies within this larger aCOB-qualified mask",
            })
        return {
            "activationRule": "target-inactive-only",
            "correctionFeatureId": row["featureId"],
            "targets": [row["targetRow"]],
            "geometryAsset": {"path": row["filename"], "sha256": row["geometrySha"],
                              "featureId": row["featureId"]},
            "geometryReferenceAgeMa": 0,
            "coordinateFrame": "WGS84-reference-coordinates",
            "pose": {
                "plateId": plate_id, "method": "cao-rigid-plate-motion",
                "sourceOrHypothesis": (
                    (f"the aCOB intersection was evaluated at {QUALIFICATION_AGE_MA:g} Ma and normalized into "
                     f"the exact plate-{plate_id} target reference coordinates; DS898 old-basement clips use "
                     "their present coordinates; carrying both with the target circuit is explicit uncertain model output")
                    if plate_id == TARGET_PLATE else
                    "exact target intersections with independently pre-410 DS898 basement use present coordinates; carrying them with Cao plate 1731 is explicit uncertain model output"
                ),
                "referenceWitness": {"presentLonLat": [row["witness"].x, row["witness"].y],
                                     "pygplatesExpectedPoses": row["poseRows"]},
            },
            "materialRole": "continental-material-support",
            "supportIntervalMa": {"youngest": 410, "youngestExclusive": True, "oldest": 540},
            "olderEdgePolicy": "qualified-through-product-oldest-age",
            "sourceUnitSelection": {
                "included": included,
                "excluded": [{
                    "count": 1,
                    "reason": "the portion of the younger native target outside the authored Laurentia aCOB is later margin material and is not continued on the same plate",
                }],
                "qualificationAgeMa": QUALIFICATION_AGE_MA,
                "rawIntersectionKm2": row["metrics"]["rawIntersectionKm2"],
                "candidateAreaKm2": row["metrics"]["candidateAreaKm2"],
                "basementReconciliation": row["metrics"]["reconciliation"],
                "insetMetres": INSET_METRES,
                "simplificationToleranceMetres": SIMPLIFY_METRES,
                "containmentGuardMetres": GUARD_METRES,
                "sourceCoordinateReferenceSystem": "Cao v2.4 spherical palaeomagnetic frame at 411 Ma",
            },
            "sourceIds": sources,
            "epistemicStatus": "model-inference",
            "surfaceEvidence": {
                "kind": "unknown",
                "reason": "basement or aCOB material extent does not establish shoreline, relief, or subaerial exposure",
            },
            "uncertainty": {
                "spatial": "modeled aCOB and rigid-block intersection reconciled against 1:5,000,000 interpreted basement domains; local deformation and the excluded younger-margin remainder are unresolved",
                "temporal": (
                    "aCOB begins at 410.1 Ma; display immediately older than 410 interpolates across the model's 0.1 Ma handoff"
                    if plate_id == TARGET_PLATE else
                    "selected DS898 basement predates 540 Ma; its domain-scale age does not date every point or constrain local deformation"
                ),
                "exposure": "unknown at every reconstructed age",
            },
            "rejectionConditions": [
                "the geometry extends outside the exact Cao target or retains an area independently mapped by DS898 as post-410 crust",
                "the excluded native-target remainder is described as absent material rather than unsupported same-plate continuation",
                "the correction is described as ancient coast, palaeotopography, or known exposure",
                "the plate-101 aCOB geometry is posed directly as if it shared the target plate's reference coordinates",
            ],
        }
    manifest = {
        "schemaVersion": 1,
        "correctionId": "earthhistory-regional-western-laurentia-material-v1",
        "version": "3.0.0-candidate",
        "baseline": {
            "modelId": "cao-et-al-2024", "modelVersion": "2.4",
            "sourceCollection": "shapes_coasts.gpmlz", "sourceSha256": SOURCE_COLLECTION_SHA,
            "coordinateFrame": {
                "absoluteFrameId": "palaeomagnetic", "anchorPlateId": 0,
                "axisConvention": "gplates-x0e-y90e-znorth",
                "rotationSha256": ROTATION_SHA, "topologySha256": TOPOLOGY_SHA,
            },
        },
        "sourceAssets": [
            {
                "sourceId": "cao-2024-v2.4-laurentia-acob",
                "url": "https://doi.org/10.5281/zenodo.13628813",
                "citation": "Cao et al. (2024), model release 2.4, COBfile_1800_0.gpml, Laurentia aCOB feature",
                "publicationOrVersionDate": "2024-09-02", "retrievedAt": "2026-09-09",
                "bytes": 14_423_254, "sha256": ACOB_COLLECTION_SHA,
                "license": "CC BY 4.0",
                "attribution": "Cao et al. (2024) model release 2.4; older continent-ocean boundary lineage from Merdith et al. (2021)",
                "evidenceRole": "continental-or-crustal-extent",
            },
            {
                "sourceId": "usgs-national-atlas-geology48",
                "url": source_manifest["acceptedFallback"]["url"],
                "citation": source_manifest["acceptedFallback"]["citation"],
                "publicationOrVersionDate": "2005-12",
                "retrievedAt": "2026-09-12", "bytes": SOURCE_BYTES, "sha256": SOURCE_SHA,
                "license": "USGS-authored United States Government data; generally public domain under 17 USC 105; source-scale and warranty caveats retained",
                "attribution": source_manifest["rights"]["attribution"],
                "evidenceRole": "geological-unit-extent",
            },
            {
                "sourceId": "usgs-ds898-basement-domains",
                "url": "https://doi.org/10.3133/ds898",
                "citation": "Lund et al. (2015), Basement domain map of the conterminous United States and Alaska, USGS Data Series 898",
                "publicationOrVersionDate": "2015", "retrievedAt": "2026-09-12",
                "bytes": DS898_BYTES, "sha256": DS898_SHA,
                "license": "USGS-authored United States Government data; generally public domain under 17 USC 105; source-scale and warranty caveats retained",
                "attribution": "U.S. Geological Survey Data Series 898, Lund et al. (2015)",
                "evidenceRole": "continental-or-crustal-extent",
            },
        ],
        "features": [feature_manifest(row) for row in candidates],
        "attribution": "Cao et al. (2024) model release 2.4; Merdith et al. (2021); U.S. Geological Survey, Lund et al. (2015); Reed and Bush (2005)",
    }
    validation = {
        "schemaVersion": 1,
        "candidate": manifest["correctionId"],
        "status": "source-qualified-candidate",
        "stopRule": "Continue only exact-target old basement or aCOB extent after vetoing independently mapped post-410 basement; stop rather than treating spatial overlap as material ancestry.",
        "source": {
            "ownedDirectoryBytes": owned_bytes,
            "directoryMaximumBytes": policy["directoryMaximumBytes"],
            "completePalaeomapStudyBytes": study_bytes,
            "completePalaeomapStudyMaximumBytes": policy["parentStudyMaximumBytes"],
            "completionDirectoryBytes": completion_bytes,
            "completionDirectoryMaximumBytes": completion_policy["directoryMaximumBytes"],
            "primaryAttempt": source_manifest["primaryAttempt"],
            "acceptedFallback": source_manifest["acceptedFallback"],
        },
        "selection": {
            "sourceCode": SOURCE_CODE, "sourceLabel": "Middle Proterozoic sedimentary rocks",
            "sourceCoordinateReferenceSystem": "EPSG:4269 (NAD83)",
            "coordinateTransform": "pyproj EPSG:4269 to EPSG:4326 with always_xy=true before target intersection",
            "plate154SourceRecordOrders": selected_orders,
            "plate154IntersectionCount": len(selected_orders),
            "plate1731IntersectionCount": 0,
            "plate1731OutcropIntersectionCount": 0,
            "plate1731Verdict": "only independently old DS898 basement remains after removing post-410 basement from the aCOB overlap; the USGS outcrop zero remains only an outcrop-class result",
            "laurentiaAcob": {"collection": ACOB_COLLECTION, "collectionSha256": ACOB_COLLECTION_SHA,
                               "featureOrder": ACOB_FEATURE_ORDER, "featureId": ACOB_FEATURE_ID,
                               "plateId": ACOB_PLATE, "validTimeMa": {"oldest": 1070, "youngest": 410.1}},
        },
        "geometries": [{
            "patchId": row["patchId"], "plateId": row["plateId"],
            **row["metrics"],
            "unsupportedSamePlateRemainderKm2": row["metrics"]["targetAreaKm2"] - row["metrics"]["candidateAreaKm2"],
            "vertexCount": vertex_count(row["candidate"]),
            "componentCount": len(row["candidate"].geoms) if isinstance(row["candidate"], MultiPolygon) else 1,
            "geojsonBytes": len(row["geojsonBytes"]), "geojsonSha256": row["geometrySha"],
            "referenceBoundsLonLat": list(row["candidate"].bounds),
            "coverage": row["coverage"],
            "poseWitness": {"presentLonLat": [row["witness"].x, row["witness"].y],
                            "pygplatesExpectedPoses": row["poseRows"]},
        } for row in candidates],
        "previousExposureWitness": {
            "candidateAreaKm2": candidate_p.area / 1_000_000,
            "outsideFinalPlate154CandidateCoordinateArea": exposure_outside_acob,
            "conclusion": "the prior USGS Middle Proterozoic outcrop witness is preserved in the final source-qualified union",
        },
        "scientificLimits": [
            "the aCOB is modeled continental lithosphere, not an observed 411 Ma shoreline or exposure map",
            "post-410 DS898 basement is excluded even where it spatially overlaps the older aCOB; such overlap is not evidence that the young material already existed",
            "the plate-1731 and plate-154 portions outside the final masks are unsupported same-plate continuations, not proven absent material",
            "the rigid normalization preserves the Cao target circuits and does not restore Cordilleran deformation",
            "East Klamath is excluded because the aCOB has no overlap through 450 Ma and the Cao chart does not match the mapped terrane footprint",
        ],
    }
    return candidates, manifest, validation


def main():
    candidates, manifest, validation = compile_candidate()
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    VALIDATION_PATH.parent.mkdir(parents=True, exist_ok=True)
    for row in candidates:
        (OUTPUT_ROOT / row["filename"]).write_bytes(row["geojsonBytes"])
    (OUTPUT_ROOT / "manifest.json").write_bytes(canonical_json(manifest))
    VALIDATION_PATH.write_bytes(canonical_json(validation))
    print(json.dumps({
        "targets": len(candidates),
        "candidateAreasKm2": {str(row["plateId"]): row["metrics"]["candidateAreaKm2"] for row in candidates},
        "vertices": {str(row["plateId"]): vertex_count(row["candidate"]) for row in candidates},
    }, sort_keys=True))


if __name__ == "__main__":
    main()
