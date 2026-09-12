#!/usr/bin/env python3
"""Compile source-qualified Timan, Novaya Zemlya, and Franz Josef material masks."""

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
sys.path.insert(0, str(ROOT / "scripts/research"))
import regional_svalbard_compile as shared

from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform, unary_union
from shapely.validation import make_valid


SOURCE = ROOT.parent / "EarthHistory-data/palaeomap-study/regional-corrections/barents"
CAO = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
STAGED = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
OUT = ROOT / "data/corrections/barents"
DOC = ROOT / "docs/research/regional-barents-correction.md"
VALIDATION = ROOT / "docs/research/regional-barents-validation.json"
SOURCE_FILE = "northern-europe-russia-bedrock.geojson"
SOURCE_COLLECTION_SHA = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"
COB_FILE = "COBfile_1800_0.gpml"
COB_SHA = ""
DOMAIN = b"earthhistory-cao-staged-geometry-f32le-xyz-rings-v1\0"
EARTH_KM = 6371.0088
CENTRE = (40.0, 75.0)
AGES = tuple(sorted({410.001, 411.0, 430.001, *[float(age) for age in range(415, 541, 5)]}))
TARGETS = {
    "timan": ("GPlates-de41c02b-9cf9-4281-9ccf-ef5594719d45", 302, "Timan Region"),
    "novaya": ("GPlates-c1ebb2d0-409d-4f8b-b848-0e45787a9778", 373, "Novaya-Semya"),
    "fjl": ("GPlates-2f364506-cb89-45ae-8e0a-0c73dd52af82", 311, "Barentsia (Franz Josef Land)"),
}
EXPECTED_TARGET_COUNTS = {"timan": 4, "novaya": 3, "fjl": 22}


class BuildError(ValueError):
    pass


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def polygonal(value):
    value = make_valid(value)
    if isinstance(value, (Polygon, MultiPolygon)):
        return value
    rows = []
    for child in getattr(value, "geoms", []):
        if isinstance(child, Polygon):
            rows.append(child)
        elif isinstance(child, MultiPolygon):
            rows.extend(child.geoms)
    return unary_union(rows) if rows else MultiPolygon([])


def project_xy(lon: float, lat: float, centre: tuple[float, float] = CENTRE):
    return shared.laea_xy(lon, lat, centre[0], centre[1])


def inverse_xy(x: float, y: float, centre: tuple[float, float] = CENTRE):
    return shared.inverse_laea(x, y, centre[0], centre[1])


def transform_coordinates(geometry, function):
    return transform(
        lambda xs, ys, zs=None: tuple(zip(*(function(x, y) for x, y in zip(xs, ys))))
        if hasattr(xs, "__len__") else function(xs, ys),
        geometry,
    )


def pygplates_to_projected(geometry: pygplates.PolygonOnSphere, centre=CENTRE):
    return shared.projected_polygon(shared.pygplates_coordinates(geometry), centre[0], centre[1])


def shapely_polygons(geometry):
    geometry = polygonal(geometry)
    if geometry.is_empty:
        return []
    return [geometry] if isinstance(geometry, Polygon) else list(geometry.geoms)


def projected_to_pygplates(geometry, centre=CENTRE):
    output = []
    for polygon in shapely_polygons(geometry):
        exterior = [tuple(reversed(inverse_xy(x, y, centre))) for x, y in polygon.exterior.coords]
        holes = [
            [tuple(reversed(inverse_xy(x, y, centre))) for x, y in ring.coords]
            for ring in polygon.interiors
        ]
        output.append(pygplates.PolygonOnSphere(exterior, holes))
    return output


def projected_to_geojson(geometry):
    polygons = []
    for polygon in shapely_polygons(geometry):
        rings = [
            [[round(value, 6) for value in inverse_xy(x, y)] for x, y in polygon.exterior.coords]
        ]
        rings.extend(
            [[[round(value, 6) for value in inverse_xy(x, y)] for x, y in ring.coords]
             for ring in polygon.interiors]
        )
        polygons.append(rings)
    return polygons


def target_hash(patch: dict, directions: bytes) -> str:
    digest = hashlib.sha256(DOMAIN)
    for ring in patch["rings"]:
        count = ring["count"]
        start = ring["offset"] * 12
        payload = directions[start:start + count * 12]
        if len(payload) != count * 12:
            raise BuildError("invalid staged target range")
        digest.update(struct.pack("<I", count))
        digest.update(payload)
    return digest.hexdigest()


def load_targets():
    source_path = CAO / "shapes_coasts.gpmlz"
    if sha256(source_path.read_bytes()) != SOURCE_COLLECTION_SHA:
        raise BuildError("pinned coastline source changed")
    stage = json.loads((STAGED / "coast-patches.json").read_text())
    directions = (STAGED / "coast-reference-directions.f32").read_bytes()
    patches = {row["patchId"]: row for row in stage["patches"]}
    cohorts = defaultdict(list)
    rows = defaultdict(list)
    for feature_order, feature in enumerate(pygplates.FeatureCollection(str(source_path))):
        for key, (feature_id, plate_id, expected_name) in TARGETS.items():
            if str(feature.get_feature_id()) != feature_id:
                continue
            if feature.get_name() != expected_name or feature.get_reconstruction_plate_id(None) != plate_id:
                raise BuildError(f"target identity changed for {key}")
            oldest, _ = feature.get_valid_time()
            if oldest != 410:
                raise BuildError(f"target endpoint changed for {key}")
            for geometry_order, geometry in enumerate(feature.get_all_geometries()):
                if not isinstance(geometry, pygplates.PolygonOnSphere):
                    continue
                cohorts[key].append(pygplates_to_projected(geometry))
                patch_id = f"cao-coast:{feature_id}:{feature_order}:{geometry_order}"
                patch = patches.get(patch_id)
                if patch is None:
                    raise BuildError(f"missing staged target {patch_id}")
                rows[key].append({
                    "patchId": patch_id,
                    "sourceFeatureId": feature_id,
                    "sourceFeatureOrder": feature_order,
                    "geometryOrder": geometry_order,
                    "plateId": plate_id,
                    "geometrySha256": target_hash(patch, directions),
                    "originalValidTimeMa": {
                        "youngest": patch["lifecycle"]["youngestAgeMa"],
                        "oldest": patch["lifecycle"]["oldestAgeMa"],
                    },
                    "expectedMatches": 1,
                })
    if {key: len(value) for key, value in rows.items()} != EXPECTED_TARGET_COUNTS:
        raise BuildError("target inventory changed")
    return {key: polygonal(unary_union(value)) for key, value in cohorts.items()}, rows


def classify(feature: dict, key: str, policy: dict) -> tuple[bool, str]:
    properties = feature["properties"]
    domain = (properties.get("DOMAIN_R_2") or "").strip()
    is_ice = (properties.get("AGE_DESCRI") or "").strip().lower() == "ice"
    if key == "timan":
        selection = policy["sourceSelection"]
        if domain in set(selection["timanIncludedDomains"]):
            return True, "coherent-timanide-or-pechora-platform-domain"
        if domain in set(selection["timanWesternContinentalMarginDomains"]):
            return True, "western-ural-baltican-passive-margin-substrate"
        if domain in set(selection["timanDirectOldDomains"]):
            youngest_age = properties.get("MIN_AGE_Ab")
            accepted = (
                isinstance(youngest_age, (int, float))
                and youngest_age >= selection["timanDirectOldMinimumYoungestAgeMa"]
            )
            return (
                accepted,
                "direct-proterozoic-western-ural-material"
                if accepted
                else "excluded-ural-folded-unit-younger-than-direct-old-threshold",
            )
        return False, "excluded-non-timanian-affinity"
    if key == "novaya":
        allowed = set(policy["sourceSelection"]["novayaIncludedDomains"])
        accepted = domain in allowed or is_ice
        return accepted, ("ice-mask-over-coherent-novaya-block" if is_ice else "pai-khoi-novaya-tectonic-domain" if domain in allowed else "excluded-other-domain")
    allowed = set(policy["sourceSelection"]["franzJosefIncludedDomains"])
    accepted = domain in allowed or is_ice
    return accepted, ("ice-mask-over-barents-platform" if is_ice else "barents-continental-shelf-domain" if domain in allowed else "excluded-other-domain")


def source_masks(targets, policy):
    source = json.loads((SOURCE / SOURCE_FILE).read_text())
    selected = defaultdict(list)
    lineage = defaultdict(list)
    inventories = defaultdict(lambda: {"included": Counter(), "excluded": Counter()})
    for feature in source["features"]:
        geometry = polygonal(transform_coordinates(shape(feature["geometry"]), project_xy))
        if geometry.is_empty:
            continue
        for key, target in targets.items():
            overlap = polygonal(geometry.intersection(target))
            if overlap.is_empty or overlap.area <= 1:
                continue
            accepted, reason = classify(feature, key, policy)
            properties = feature["properties"]
            identity = f"{properties.get('DOMAIN_R_2')}|{properties.get('AGE_DESCRI')}|{reason}"
            inventories[key]["included" if accepted else "excluded"][identity] += overlap.area
            if not accepted:
                continue
            selected[key].append(overlap)
            lineage[key].append({
                "objectId": properties["OBJECTID_1"],
                "domain": properties.get("DOMAIN_R_2"),
                "domainType": properties.get("DOMAIN_R_3"),
                "ageDescription": properties.get("AGE_DESCRI"),
                "maximumAgeMa": properties.get("MAX_AGE_Ab"),
                "minimumAgeMa": properties.get("MIN_AGE_Ab"),
                "selectionReason": reason,
                "clippedAreaSquareKilometres": overlap.area / 1_000_000,
            })
    masks = {key: polygonal(unary_union(value)) for key, value in selected.items()}
    if set(masks) != set(TARGETS) or any(value.is_empty for value in masks.values()):
        raise BuildError("source selection left an empty cohort")
    return source, masks, lineage, inventories


def active_native_rows(features, rotations, age):
    usable = [feature for feature in features if shared.active(feature, age)
              and shared.strict_rotation(rotations, age, feature.get_reconstruction_plate_id(None)) is not None]
    reconstructed = []
    pygplates.reconstruct(usable, rotations, reconstructed, age)
    return [
        (row.get_feature(), row.get_reconstructed_geometry())
        for row in reconstructed
        if isinstance(row.get_reconstructed_geometry(), pygplates.PolygonOnSphere)
    ]


def backproject_overlap(mask, plate_id, native_rows, rotations, age, guard_metres):
    rotation = shared.strict_rotation(rotations, age, plate_id)
    candidates = [rotation * polygon for polygon in projected_to_pygplates(mask)]
    overlapping = []
    sources = Counter()
    for feature, native in native_rows:
        if any(pygplates.GeometryOnSphere.distance(candidate, native, 1e-12,
                geometry1_is_solid=True, geometry2_is_solid=True) is not None for candidate in candidates):
            overlapping.append(native)
            sources[(str(feature.get_feature_id()), feature.get_name() or None,
                     feature.get_reconstruction_plate_id(None))] += 1
    if not overlapping:
        return MultiPolygon([]), []
    centre_lat, centre_lon = candidates[0].get_interior_centroid().to_lat_lon()
    centre = (centre_lon, centre_lat)
    candidate_age = unary_union([pygplates_to_projected(row, centre) for row in candidates])
    native_age = unary_union([pygplates_to_projected(row, centre) for row in overlapping])
    intersection = polygonal(candidate_age.intersection(native_age))
    if intersection.is_empty:
        return MultiPolygon([]), []
    guarded = polygonal(intersection.buffer(guard_metres))
    backprojected = []
    inverse = rotation.get_inverse()
    for age_polygon in projected_to_pygplates(guarded, centre):
        backprojected.append(pygplates_to_projected(inverse * age_polygon))
    return polygonal(unary_union(backprojected)), [
        {"featureId": key[0], "name": key[1], "plateId": key[2], "polygonCount": count}
        for key, count in sources.items()
    ]


def geometry_counts(polygons):
    return {
        "components": len(polygons),
        "holes": sum(max(0, len(polygon) - 1) for polygon in polygons),
        "vertices": sum(len(ring) - 1 for polygon in polygons for ring in polygon),
    }


def pose_witness(rotations, plate_id, geometry):
    witness = projected_to_pygplates(geometry)[0].get_interior_centroid()
    rows = []
    for age in AGES:
        rotation = shared.strict_rotation(rotations, age, plate_id)
        if rotation is None:
            raise BuildError(f"plate {plate_id} lacks strict pose at {age}")
        lat, lon = (rotation * witness).to_lat_lon()
        rows.append({"ageMa": age, "longitudeLatitude": [lon, lat]})
    lat, lon = witness.to_lat_lon()
    return {"referenceLongitudeLatitude": [lon, lat], "positions": rows}


def unit_rows(counter: Counter, accepted: bool):
    rows = []
    for identity, area in sorted(counter.items()):
        domain, age, reason = identity.split("|", 2)
        rows.append({
            "unitId": f"{domain}|{age}",
            "areaSquareKilometres": area / 1_000_000,
            "reason": reason,
        })
    return rows


def validate_outputs(manifest, geojson, validation, policy) -> None:
    expected_ids = {
        f"barents-{key}-pre-540-material-plate-{TARGETS[key][1]}"
        for key in TARGETS
    }
    geo_by_id = {feature["id"]: feature for feature in geojson["features"]}
    manifest_by_id = {feature["correctionFeatureId"]: feature for feature in manifest["features"]}
    if set(geo_by_id) != expected_ids or set(manifest_by_id) != expected_ids:
        raise BuildError("candidate feature identity set changed")
    geo_bytes = canonical(geojson)
    total = 0.0
    for key, (_, plate_id, _) in TARGETS.items():
        feature_id = f"barents-{key}-pre-540-material-plate-{plate_id}"
        feature = manifest_by_id[feature_id]
        geo_feature = geo_by_id[feature_id]
        if feature["geometryAsset"]["sha256"] != sha256(geo_bytes):
            raise BuildError("geometry asset hash changed")
        if feature["supportIntervalMa"] != {"youngest": 410, "oldest": 540, "youngestExclusive": True}:
            raise BuildError("material lifecycle changed")
        if feature["poseConfidenceIntervalsMa"] != [
            {"youngest": 410, "oldest": 430, "youngestExclusive": True, "status": "qualified"},
            {"youngest": 430, "oldest": 540, "youngestExclusive": True, "status": "uncertain-continuation"},
        ]:
            raise BuildError("pose confidence partition changed")
        if feature["surfaceEvidence"]["kind"] != "unknown" or feature["epistemicStatus"] != "model-inference":
            raise BuildError("surface semantics changed")
        if geo_feature["properties"]["plateId"] != plate_id or not geo_feature["geometry"]["coordinates"]:
            raise BuildError("geometry plate or content changed")
        metric = validation["cohorts"][key]
        if feature["geometryProcessing"] != metric:
            raise BuildError("manifest and validation metrics differ")
        if set(metric["postDedupNativeCoastOverlap"]) != {str(age) for age in AGES}:
            raise BuildError("5 Ma native overlap sweep changed")
        if key != "novaya" and any(
                row["candidateAreaFraction"] > policy["geometry"]["maximumNativeCoastOverlapFractionAtSampleAges"]
                for row in metric["postDedupNativeCoastOverlap"].values()):
            raise BuildError("candidate overlaps active native coast material")
        if key == "novaya":
            allowed = set(policy["geometry"]["nativeOverlapPolicy"]["allowedNovayaNativeFeatureIds"])
            observed = {source["featureId"] for row in metric["postDedupNativeCoastOverlap"].values()
                        for source in row["intersectingSources"]}
            if not observed or not observed <= allowed:
                raise BuildError("Novaya native overlap is outside the renderer-precedence exception")
        total += metric["deliveredAreaSquareKilometres"]
    if not math.isclose(total, validation["totalDeliveredAreaSquareKilometres"], rel_tol=0, abs_tol=1e-9):
        raise BuildError("total delivered area changed")
    if validation["cohorts"]["novaya"]["supportedMaterialOmittedForCrossPhaseDeduplicationSquareKilometres"] != 0:
        raise BuildError("Novaya still omits source-qualified material for cross-phase de-duplication")


def main() -> None:
    policy = json.loads((OUT / "qualification-policy.json").read_text())
    source_manifest = json.loads((SOURCE / "source-manifest.json").read_text())
    source_bytes = (SOURCE / SOURCE_FILE).read_bytes()
    if sha256(source_bytes) != source_manifest["files"][SOURCE_FILE]["sha256"]:
        raise BuildError("pinned Arctic map source changed")
    targets, target_rows = load_targets()
    source, raw_masks, lineage, inventories = source_masks(targets, policy)
    rotations = pygplates.RotationModel(
        [str(CAO / "1000_0_rotfile.rot"), str(CAO / "1800_1000_rotfile.rot")],
        default_anchor_plate_id=0,
    )
    native_features = list(pygplates.FeatureCollection(str(CAO / "shapes_coasts.gpmlz")))
    native_at_age = {age: active_native_rows(native_features, rotations, age) for age in AGES}
    delivered = {}
    metrics = {}
    for key, raw in raw_masks.items():
        plate_id = TARGETS[key][1]
        geometry_policy = policy["geometry"]
        guarded = polygonal(raw.buffer(-geometry_policy["insetMetres"]).simplify(
            geometry_policy["simplifyMetres"], preserve_topology=True
        ))
        if guarded.is_empty:
            raise BuildError(f"guard removed {key}")
        removed = MultiPolygon([])
        overlap_sources = {}
        for age in AGES:
            backprojected, sources = backproject_overlap(
                guarded, plate_id, native_at_age[age], rotations, age,
                geometry_policy["nativeOverlapGuardMetres"],
            )
            if not backprojected.is_empty:
                removed = polygonal(unary_union([removed, backprojected]))
                overlap_sources[str(age)] = sources
        final = guarded if key == "novaya" else polygonal(guarded.difference(removed))
        if final.is_empty:
            raise BuildError(f"native de-duplication removed {key}")
        outside_source = final.difference(raw).area
        outside_target = final.difference(targets[key]).area
        if outside_source > geometry_policy["maximumOutsideQualifiedSourceSquareMetres"] or outside_target > geometry_policy["maximumOutsideTargetSquareMetres"]:
            raise BuildError(f"{key} left qualified source/target")
        coordinates = projected_to_geojson(final)
        counts = geometry_counts(coordinates)
        if counts["vertices"] > geometry_policy["maximumOutputVertices"]:
            raise BuildError(f"{key} exceeds vertex bound")
        post_overlap = {}
        for age in AGES:
            rotation = shared.strict_rotation(rotations, age, plate_id)
            measurement = shared.actual_native_overlap(
                [rotation * polygon for polygon in projected_to_pygplates(final)], native_at_age[age]
            )
            post_overlap[str(age)] = measurement
            if key != "novaya" and measurement["candidateAreaFraction"] > geometry_policy["maximumNativeCoastOverlapFractionAtSampleAges"]:
                raise BuildError(f"{key} retains native overlap at {age}: {measurement['candidateAreaFraction']}")
        delivered[key] = final
        metrics[key] = {
            "sourceTargetIntersectionAreaSquareKilometres": raw.area / 1_000_000,
            "guardedBeforeNativeDedupAreaSquareKilometres": guarded.area / 1_000_000,
            "nativeDeduplicationAreaSquareKilometres": (
                0.0 if key == "novaya" else guarded.intersection(removed).area / 1_000_000
            ),
            "nativeOverlapPreservedForRendererPrecedenceSquareKilometres": (
                guarded.intersection(removed).area / 1_000_000 if key == "novaya" else 0.0
            ),
            "supportedMaterialOmittedForCrossPhaseDeduplicationSquareKilometres": 0.0,
            "crossPhaseOmissionReason": (
                "none; the guarded mask is preserved and the shared renderer gives visible native Kara material visual and picking precedence where the models overlap"
                if key == "novaya" else
                "none; the removed native material is already represented at every sampled corrected age"
            ),
            "deliveredAreaSquareKilometres": final.area / 1_000_000,
            "targetAreaSquareKilometres": targets[key].area / 1_000_000,
            "deliveredTargetAreaFraction": final.area / targets[key].area,
            "outsideQualifiedSourceSquareMetres": outside_source,
            "outsideTargetSquareMetres": outside_target,
            "geometryCounts": counts,
            "deduplicatedNativeSourcesByAge": overlap_sources,
            "postDedupNativeCoastOverlap": post_overlap,
            "poseWitness": pose_witness(rotations, plate_id, final),
        }

    geo_features = []
    correction_features = []
    for key in ("timan", "novaya", "fjl"):
        plate_id = TARGETS[key][1]
        feature_id = f"barents-{key}-pre-540-material-plate-{plate_id}"
        geo_features.append({
            "type": "Feature",
            "id": feature_id,
            "properties": {
                "correctionFeatureId": feature_id,
                "plateId": plate_id,
                "materialRole": "continental-material-support",
                "epistemicStatus": "model-inference",
                "surfaceEvidence": "unknown",
                "sourceObjectIds": sorted({row["objectId"] for row in lineage[key]}),
            },
            "geometry": {"type": "MultiPolygon", "coordinates": projected_to_geojson(delivered[key])},
        })
    geojson = {
        "type": "FeatureCollection",
        "name": "EarthHistory Barents source-qualified continental material witnesses",
        "features": geo_features,
    }
    geojson_bytes = canonical(geojson)
    asset_sha = sha256(geojson_bytes)
    for key in ("timan", "novaya", "fjl"):
        plate_id = TARGETS[key][1]
        feature_id = f"barents-{key}-pre-540-material-plate-{plate_id}"
        if key == "timan":
            spatial = "GSC Map 2159A Timanide/Pechora/Russian-platform domains, the western Ural Baltican passive-margin domain, and directly mapped pre-542 Ma Ural folded units clipped inside the Cao Timan target; eastern Ural, Pai-Khoi, and West Siberian domains remain excluded"
        elif key == "novaya":
            spatial = "GSC Map 2159A Pai-Khoi/Novaya domain plus its onshore ice mask, clipped inside the Cao Novaya target; later Kara overlap is preserved under explicit native visual and picking precedence"
        else:
            spatial = "GSC Map 2159A Barents continental-shelf domain plus the Franz Josef Land onshore ice mask, clipped inside the Cao FJL targets"
        affinity_source = {
            "timan": "timan-preordovician-2007",
            "novaya": "novaya-structure-2022",
            "fjl": "fjl-caledonian-2019",
        }[key]
        correction_features.append({
            "correctionFeatureId": feature_id,
            "targets": target_rows[key],
            "geometryAsset": {"path": "barents-pre-540-material.geojson", "sha256": asset_sha, "featureId": feature_id},
            "plateId": plate_id,
            "geometryReferenceAgeMa": 0,
            "coordinateFrame": "WGS84-reference-coordinates",
            "materialRole": "continental-material-support",
            "geometryProcessing": metrics[key],
            "supportIntervalMa": {"youngest": 410, "oldest": 540, "youngestExclusive": True},
            "activationRule": ("native-visual-and-picking-precedence" if key == "novaya"
                               else "target-inactive-only"),
            "poseConfidenceIntervalsMa": [
                {"youngest": 410, "oldest": 430, "youngestExclusive": True, "status": "qualified"},
                {"youngest": 430, "oldest": 540, "youngestExclusive": True, "status": "uncertain-continuation"},
            ],
            "uncertaintyDisplay": {"olderThanMa": 430, "style": "uncertain"},
            "sourceUnitSelection": {
                "included": unit_rows(inventories[key]["included"], True),
                "excluded": unit_rows(inventories[key]["excluded"], False),
                "materialMeaning": "mapped younger cover or ice constrains the modern footprint only; cited regional geology supplies the inferred older continental substrate",
            },
            "epistemicStatus": "model-inference",
            "surfaceEvidence": {"kind": "unknown", "reason": "bedrock-domain continuity does not establish a 410–540 Ma shoreline, emergence, or height"},
            "olderEdgePolicy": "qualified-through-product-oldest-age",
            "pose": {"plateId": plate_id, "method": "cao-rigid-plate-motion", "sourceOrHypothesis": "strict Cao v2.4 regional rigid motion; material affinity sources do not independently determine exact palaeolongitude"},
            "uncertainty": {
                "spatial": spatial,
                "temporal": "material continuity is source-supported; exact pose is best constrained near 410–430 Ma and is shown as uncertain farther back",
                "affinity": "late deformation and accretion can make the modern tectonic-domain footprint broader than the 410 Ma coherent block; excluded domains and native overlaps remain outside the correction",
                "exposure": "unknown at every reconstructed age; this is neither a palaeoshoreline nor exposed-land evidence",
            },
            "sourceIds": (
                [
                    "gsc-arctic-map-2159a",
                    "cao-2024-v2.4-cob",
                    affinity_source,
                    "eurasian-arctic-fold-belts-2016",
                    "urals-west-siberia-2013",
                ]
                if key == "timan"
                else ["gsc-arctic-map-2159a", "cao-2024-v2.4-cob", affinity_source]
            ),
            "rejectionConditions": [
                "source record falls outside the named accepted tectonic domain or its explicitly inferred onshore ice mask",
                "derived geometry leaves the GSC source/ice footprint or immutable Cao target",
                "candidate overlaps active native Cao coast material outside the named Novaya/Kara renderer-precedence exception",
                "candidate is represented as exposed land, shoreline, or palaeotopographic height",
                "strict Cao motion is missing through 540 Ma or the older uncertainty phase becomes a hard absence edge",
            ],
        })
    cob_bytes = (CAO / COB_FILE).read_bytes()
    manifest = {
        "schemaVersion": 1,
        "correctionId": "earthhistory-regional-barents-material-v1",
        "version": 1,
        "baseline": {
            "modelId": "cao-et-al-2024", "modelVersion": "2.4",
            "sourceCollection": "shapes_coasts.gpmlz", "sourceSha256": SOURCE_COLLECTION_SHA,
            "coordinateFrame": {
                "absoluteFrameId": "palaeomagnetic", "anchorPlateId": 0,
                "axisConvention": "gplates-x0e-y90e-znorth",
                "rotationSha256": "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f",
                "topologySha256": "411bd3e5e5a2004ea42792a5c1be11942a46b52e3657efdb06507c147fbfdf1a",
            },
        },
        "sourceAssets": [
            {
                "sourceId": "gsc-arctic-map-2159a", "title": "Geological map of the Arctic, 1:5 000 000",
                "citation": "Harrison et al. (2011), Geological Survey of Canada Map 2159A, doi:10.4095/287868",
                "url": source_manifest["source"]["layerUrl"], "retrievedAt": source_manifest["retrievalDate"],
                "publicationOrVersionDate": "2011-02-01", "evidenceRole": "geological-unit-extent",
                "bytes": len(source_bytes), "sha256": sha256(source_bytes),
                "license": source_manifest["rights"]["license"], "attribution": source_manifest["rights"]["requiredAttribution"],
            },
            {
                "sourceId": "cao-2024-v2.4-cob", "title": "Cao et al. v2.4 closed continental-boundary collection",
                "citation": "Cao et al. (2024), Earth's tectonic and plate boundary evolution over 1.8 billion years, model v2.4, doi:10.5281/zenodo.13628813",
                "url": "https://doi.org/10.5281/zenodo.13628813", "retrievedAt": "2026-09-09",
                "publicationOrVersionDate": "2024-09-03", "evidenceRole": "continental-or-crustal-extent",
                "bytes": len(cob_bytes), "sha256": sha256(cob_bytes), "license": "Creative Commons Attribution 4.0 International (CC BY 4.0)",
                "attribution": "Cao et al. (2024) model v2.4 contributors",
            },
            {
                "sourceId": "timan-preordovician-2007",
                "title": "Pre-Ordovician tectonic evolution and volcano-plutonic associations of the Timanides and northern Pre-Uralides",
                "citation": "Kuznetsov et al. (2007), Gondwana Research 12, 305–323, doi:10.1016/j.gr.2006.10.021",
                "url": "https://doi.org/10.1016/j.gr.2006.10.021", "retrievedAt": "2026-09-12",
                "publicationOrVersionDate": "2007", "evidenceRole": "material-affinity",
                "bytes": source_manifest["files"]["timan-preordovician-crossref.json"]["bytes"],
                "sha256": source_manifest["files"]["timan-preordovician-crossref.json"]["sha256"],
                "license": "Crossref metadata snapshot is CC0; cited article rights retained by its publisher",
                "attribution": "Kuznetsov et al. (2007); citation metadata supplied by Crossref",
            },
            {
                "sourceId": "eurasian-arctic-fold-belts-2016",
                "title": "Fold belts and sedimentary basins of the Eurasian Arctic",
                "citation": "Drachev (2016), arktos 2:21, doi:10.1007/s41063-015-0014-8",
                "url": "https://doi.org/10.1007/s41063-015-0014-8", "retrievedAt": "2026-09-12",
                "publicationOrVersionDate": "2016", "evidenceRole": "material-affinity",
                "bytes": source_manifest["files"]["eurasian-arctic-fold-belts-crossref.json"]["bytes"],
                "sha256": source_manifest["files"]["eurasian-arctic-fold-belts-crossref.json"]["sha256"],
                "license": "Crossref metadata snapshot is CC0; cited article rights retained by its publisher",
                "attribution": "Drachev (2016); citation metadata supplied by Crossref",
            },
            {
                "sourceId": "urals-west-siberia-2013",
                "title": "Tectonics of the Urals and adjacent part of the West-Siberian platform basement",
                "citation": "Ivanov et al. (2013), Journal of Asian Earth Sciences 72, 12–24, doi:10.1016/j.jseaes.2013.02.029",
                "url": "https://doi.org/10.1016/j.jseaes.2013.02.029", "retrievedAt": "2026-09-12",
                "publicationOrVersionDate": "2013", "evidenceRole": "material-affinity",
                "bytes": source_manifest["files"]["urals-west-siberia-crossref.json"]["bytes"],
                "sha256": source_manifest["files"]["urals-west-siberia-crossref.json"]["sha256"],
                "license": "Crossref metadata snapshot is CC0; cited article rights retained by its publisher",
                "attribution": "Ivanov et al. (2013); citation metadata supplied by Crossref",
            },
            {
                "sourceId": "novaya-structure-2022",
                "title": "Geological Structure of the Novaya Zemlya Archipelago and Peculiarities of the Tectonics of the Eurasian Arctic",
                "citation": "Korago et al. (2022), Geotectonics 56, doi:10.1134/S0016852122020030",
                "url": "https://doi.org/10.1134/S0016852122020030", "retrievedAt": "2026-09-12",
                "publicationOrVersionDate": "2022", "evidenceRole": "material-affinity",
                "bytes": source_manifest["files"]["novaya-structure-crossref.json"]["bytes"],
                "sha256": source_manifest["files"]["novaya-structure-crossref.json"]["sha256"],
                "license": "Crossref metadata snapshot is CC0; cited article rights retained by its publisher",
                "attribution": "Korago et al. (2022); citation metadata supplied by Crossref",
            },
            {
                "sourceId": "fjl-caledonian-2019",
                "title": "Caledonian metamorphism of metasediments from Franz Josef Land",
                "citation": "Knudsen et al. (2019), GFF 141, 295–307, doi:10.1080/11035897.2019.1622151",
                "url": "https://doi.org/10.1080/11035897.2019.1622151", "retrievedAt": "2026-09-12",
                "publicationOrVersionDate": "2019", "evidenceRole": "material-affinity",
                "bytes": source_manifest["files"]["fjl-caledonian-crossref.json"]["bytes"],
                "sha256": source_manifest["files"]["fjl-caledonian-crossref.json"]["sha256"],
                "license": "Crossref metadata snapshot is CC0; cited article rights retained by its publisher",
                "attribution": "Knudsen et al. (2019); citation metadata supplied by Crossref",
            },
        ],
        "features": correction_features,
        "attribution": "Contains information licensed under the Open Government Licence – Canada; source Natural Resources Canada, Geological Survey of Canada. Cao et al. (2024) model v2.4 is CC BY 4.0.",
    }
    validation = {
        "schemaVersion": 1,
        "candidateId": manifest["correctionId"],
        "sourceFeatureCount": len(source["features"]),
        "policy": policy,
        "cohorts": metrics,
        "lineage": lineage,
        "totalDeliveredAreaSquareKilometres": sum(row["deliveredAreaSquareKilometres"] for row in metrics.values()),
        "barentsFortyTargetScaleAreaSquareKilometres": 474306.92,
        "deliveredFractionOfBarentsFortyTargetScale": sum(row["deliveredAreaSquareKilometres"] for row in metrics.values()) / 474306.92,
    }
    validate_outputs(manifest, geojson, validation, policy)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "barents-pre-540-material.geojson").write_bytes(geojson_bytes)
    (OUT / "manifest.json").write_bytes(canonical(manifest))
    VALIDATION.write_bytes(canonical(validation))
    print(json.dumps({"areasKm2": {key: metrics[key]["deliveredAreaSquareKilometres"] for key in metrics}, "totalKm2": validation["totalDeliveredAreaSquareKilometres"], "sha256": asset_sha}))


if __name__ == "__main__":
    main()
