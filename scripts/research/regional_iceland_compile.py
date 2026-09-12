#!/usr/bin/env python3
"""Compile the bounded Iceland surface/material correction inputs.

The compiler deliberately keeps three claims separate:

* Natural Earth supplies an observed, generalized present-day land polygon.
* The Icelandic Institute of Natural History WFS supplies present-day outcrop
  polygons whose mapped age bins constrain when that material existed.
* Cao v2.4 supplies only the motion frame and the present North America–Eurasia
  partition. It is not used as evidence that an Iceland surface existed.

Run with the pinned pyGPlates environment and Shapely plus pyshp available on
PYTHONPATH.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import tempfile
import zipfile
from pathlib import Path

import pygplates
import shapefile
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Polygon, mapping, shape
from shapely.ops import split, unary_union
from shapely.validation import make_valid


ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study"
SOURCE = POOL / "verification/regional-iceland-correction-v1/source-inputs"
FOUNDATION = POOL / "verification/reconstruction-cao-foundation-v1/source-inputs"
MODEL = POOL / "plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
OUT = ROOT / "data/corrections/iceland"
REPORT = ROOT / "docs/research/regional-iceland-validation.json"

NATURAL_EARTH_110M = FOUNDATION / "natural-earth-countries.geojson"
NATURAL_EARTH_50M = SOURCE / "ne_50m_admin_0_countries.zip"
BEDROCK_OLD = SOURCE / "bedrock-old.geojson"
BEDROCK_YOUNG = SOURCE / "bedrock-young.geojson"
WFS_CAPABILITIES = SOURCE / "wfs-capabilities.xml"
WMS_CAPABILITIES = SOURCE / "wms-capabilities.xml"
BEDROCK_STYLE = SOURCE / "bedrock-style.sld"
BEDROCK_METADATA = SOURCE / "bedrock-metadata.xml"
CAO_COASTS = MODEL / "shapes_coasts.gpmlz"
CAO_CONTINENTS = MODEL / "shapes_continents.gpmlz"

GEOMETRY_NAME = "iceland-surface-material-v1.geojson"
MANIFEST_NAME = "surface-manifest.json"
CORRECTION_ID = "earthhistory-regional-iceland-surface-v1"
RIDGE_IDS = (
    "GPlates-0830a0e7-382a-4fe4-989c-02e27dab7c91",
    "GPlates-9a090a65-e45a-4bb0-9876-a106dfc0664a",
)
PLATE_IDS = (101, 301)
SIMPLIFY_DEGREES = 0.005
EARTH_RADIUS_KM = 6371.0
FRAME = {
    "absoluteFrameId": "palaeomagnetic",
    "anchorPlateId": 0,
    "axisConvention": "gplates-x0e-y90e-znorth",
    "rotationSha256": "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f",
    "topologySha256": "3a3021b8d60bbcff64ce4018198a5693ddc018de7a5a8b3c30c33a48d51c044c",
}
PINNED = {
    "natural-earth-countries.geojson": (838726, "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f"),
    "ne_50m_admin_0_countries.zip": (799734, "5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139"),
    "bedrock-old.geojson": (2157049, "e73f879651bde321ee28e95d29945406c8c1360295f4b513da47ee0bb5b60413"),
    "bedrock-young.geojson": (2848297, "25ca7680d9db60ee9a036826d99fe40dd1d0239be0bf30cdf802c6269f803f66"),
    "wfs-capabilities.xml": (363194, "90470105e6342692609dcdb887cda62c21d70eb16aa0337be3859e509c690492"),
    "wms-capabilities.xml": (1141363, "b426bda18bef7c85f610531c8d5cb36ca82aff384aed2c50bd1b96a2a65d7ca2"),
    "bedrock-style.sld": (18663, "dfcabc4b02ad1149aa837339f28e23dba2866074e6e3488285c388fe3e090cff"),
    "bedrock-metadata.xml": (20218, "f49e29e1d5aee5ca362e6b999a8776f220313792d178ee00bed8901d505537a4"),
    "250-0_plate_boundaries.gpml": (None, "4a9f97f6368860e5917f4e6fbf78d6d7c3caf77e1736e854250d067540bb60d4"),
    "TopologyBuildingBlocks.gpml": (None, "7603af2502a8d261256f293be71487d28fe5a6b5a8fadd4bdc7845dc67b72297"),
    "1000_0_rotfile.rot": (None, "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"),
    "shapes_coasts.gpmlz": (None, "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"),
    "shapes_continents.gpmlz": (None, "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"),
}


class BuildError(ValueError):
    pass


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def verify(path: Path, key: str) -> None:
    size, expected = PINNED[key]
    if not path.is_file() or (size is not None and path.stat().st_size != size) or digest(path) != expected:
        raise BuildError(f"{key}: pinned source identity changed")


def polygons_only(geometry):
    geometry = make_valid(geometry)
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    if isinstance(geometry, GeometryCollection):
        return [part for item in geometry.geoms for part in polygons_only(item)]
    return []


def normalized_polygonal(geometry):
    parts = [part for part in polygons_only(geometry) if part.area > 1e-10]
    if not parts:
        raise BuildError("polygon processing removed the complete source")
    return unary_union(parts)


def polygon_vertex_count(geometry) -> int:
    return sum(len(polygon.exterior.coords) + sum(len(ring.coords) for ring in polygon.interiors)
               for polygon in polygons_only(geometry))


def load_iceland_110m() -> Polygon:
    verify(NATURAL_EARTH_110M, NATURAL_EARTH_110M.name)
    document = json.loads(NATURAL_EARTH_110M.read_text())
    matches = [feature for feature in document["features"]
               if feature.get("properties", {}).get("ADMIN") == "Iceland"]
    if len(matches) != 1:
        raise BuildError(f"Natural Earth 110m Iceland match count changed: {len(matches)}")
    return normalized_polygonal(shape(matches[0]["geometry"]))


def load_iceland_50m() -> Polygon:
    verify(NATURAL_EARTH_50M, NATURAL_EARTH_50M.name)
    stem = "ne_50m_admin_0_countries"
    with zipfile.ZipFile(NATURAL_EARTH_50M) as archive:
        version = archive.read(f"{stem}.VERSION.txt").decode().strip()
        if version != "5.1.1":
            raise BuildError(f"Natural Earth 50m version changed: {version!r}")
        reader = shapefile.Reader(
            shp=io.BytesIO(archive.read(f"{stem}.shp")),
            shx=io.BytesIO(archive.read(f"{stem}.shx")),
            dbf=io.BytesIO(archive.read(f"{stem}.dbf")),
            encoding="utf-8",
        )
        fields = [field[0] for field in reader.fields[1:]]
        matches = [record.shape.__geo_interface__ for record in reader.iterShapeRecords()
                   if dict(zip(fields, record.record)).get("ADMIN") == "Iceland"]
    if len(matches) != 1:
        raise BuildError(f"Natural Earth 50m Iceland match count changed: {len(matches)}")
    return normalized_polygonal(shape(matches[0]))


def load_units() -> dict[str, object]:
    output: dict[str, list] = {name: [] for name in ("gold", "gnew", "hraun", "mob")}
    for path in (BEDROCK_OLD, BEDROCK_YOUNG):
        verify(path, path.name)
        document = json.loads(path.read_text())
        if document.get("crs", {}).get("properties", {}).get("name") != "urn:ogc:def:crs:CRS::84":
            raise BuildError(f"{path.name}: expected explicit CRS84")
        for feature in document.get("features", []):
            unit = feature.get("properties", {}).get("flokkur")
            if unit not in output:
                raise BuildError(f"{path.name}: unexpected unit {unit!r}")
            output[unit].extend(polygons_only(shape(feature["geometry"])))
    if any(not parts for parts in output.values()):
        raise BuildError("one or more selected IINH unit classes are empty")
    return {unit: normalized_polygonal(normalized_polygonal(unary_union(parts)).simplify(
        SIMPLIFY_DEGREES, preserve_topology=True
    )) for unit, parts in output.items()}


def baseline_omission_witness() -> dict:
    """Reproduce the raw Cao-source omission at a fixed central-Iceland point."""
    witness_lat_lon = (64.9, -18.9)
    witness = pygplates.PointOnSphere(*witness_lat_lon)
    rows = []
    for path in (CAO_COASTS, CAO_CONTINENTS):
        verify(path, path.name)
        covering = 0
        minimum_radians = math.inf
        for feature in pygplates.FeatureCollection(str(path)):
            geometry = feature.get_geometry()
            if geometry is None:
                continue
            if hasattr(geometry, "is_point_in_polygon") and geometry.is_point_in_polygon(witness):
                covering += 1
            distance = pygplates.GeometryOnSphere.distance(witness, geometry)
            if distance is not None:
                minimum_radians = min(minimum_radians, distance)
        if covering != 0 or not math.isfinite(minimum_radians) or minimum_radians * EARTH_RADIUS_KM < 300:
            raise BuildError(f"{path.name}: central-Iceland omission witness changed")
        rows.append({
            "sourceCollection": path.name,
            "sha256": PINNED[path.name][1],
            "coveringPolygonCount": covering,
            "nearestGeometryDistanceKilometres": round(minimum_radians * EARTH_RADIUS_KM, 3),
        })
    return {"witnessLatLon": list(witness_lat_lon), "ageMa": 0, "sources": rows}


def resolved_partition():
    paths = (MODEL / "250-0_plate_boundaries.gpml", MODEL / "TopologyBuildingBlocks.gpml")
    rotation_path = MODEL / "1000_0_rotfile.rot"
    for path in (*paths, rotation_path):
        verify(path, path.name)
    features = [feature for path in paths for feature in pygplates.FeatureCollection(str(path))]
    rotation = pygplates.RotationModel(str(rotation_path), default_anchor_plate_id=0)
    resolved, sections = [], []
    pygplates.resolve_topologies(features, rotation, resolved, 0, sections, anchor_plate_id=0)
    topologies = {}
    for item in resolved:
        plate = item.get_feature().get_reconstruction_plate_id(None)
        if plate in PLATE_IDS:
            if plate in topologies:
                raise BuildError(f"plate {plate}: multiple resolved topology polygons")
            topologies[plate] = item.get_resolved_geometry()
    if set(topologies) != set(PLATE_IDS):
        raise BuildError("missing present-day Cao North America/Eurasia topology")
    ridge = {}
    owners = {}
    for section in sections:
        feature_id = str(section.get_feature().get_feature_id())
        if feature_id not in RIDGE_IDS:
            continue
        for segment in section.get_shared_sub_segments():
            sharing = tuple(item.get_feature().get_reconstruction_plate_id(None)
                            for item in segment.get_sharing_resolved_topologies())
            if set(sharing) != set(PLATE_IDS):
                continue
            if feature_id in ridge:
                raise BuildError(f"{feature_id}: multiple NA/Eurasia shared subsegments")
            ridge[feature_id] = [(longitude, latitude) for latitude, longitude in
                                 (point.to_lat_lon() for point in segment.get_resolved_geometry().get_points())]
            owners[feature_id] = list(sharing)
    if tuple(ridge) != RIDGE_IDS or ridge[RIDGE_IDS[0]][-1] != ridge[RIDGE_IDS[1]][0]:
        raise BuildError("present-day Iceland ridge lineage or continuity changed")
    line = LineString([*ridge[RIDGE_IDS[0]], *ridge[RIDGE_IDS[1]][1:]])
    return line, topologies, owners


def plate_for(point, topologies) -> int:
    matches = [plate for plate, polygon in topologies.items()
               if polygon.is_point_in_polygon(pygplates.PointOnSphere(point.y, point.x))]
    if len(matches) != 1:
        raise BuildError(f"partition witness {point.x:.6f},{point.y:.6f} has owners {matches}")
    return matches[0]


def split_by_plate(geometry, ridge, topologies) -> dict[int, object]:
    geometry = normalized_polygonal(geometry)
    pieces = split(geometry, ridge)
    assigned: dict[int, list] = {plate: [] for plate in PLATE_IDS}
    for piece in polygons_only(pieces):
        assigned[plate_for(piece.representative_point(), topologies)].append(piece)
    result = {plate: normalized_polygonal(unary_union(parts)) for plate, parts in assigned.items() if parts}
    if set(result) != set(PLATE_IDS):
        raise BuildError("source geometry did not produce both Cao plate pieces")
    recombined = normalized_polygonal(unary_union(list(result.values())))
    difference = make_valid(geometry).symmetric_difference(make_valid(recombined)).area
    overlap = result[101].intersection(result[301]).area
    if difference > 1e-8 or overlap > 1e-10:
        raise BuildError(f"plate split changed source geometry: difference={difference}, overlap={overlap}")
    return result


def rounded(value):
    if isinstance(value, (tuple, list)):
        return [rounded(item) for item in value]
    return round(float(value), 6)


def geometry_json(geometry) -> dict:
    value = mapping(geometry)
    return {"type": value["type"], "coordinates": rounded(value["coordinates"])}


def spherical_area_km2(geometry) -> float:
    total = 0.0
    for polygon in polygons_only(geometry):
        rings = [polygon.exterior, *polygon.interiors]
        areas = []
        for ring in rings:
            points = [(lat, lon) for lon, lat in list(ring.coords)[:-1]]
            areas.append(pygplates.PolygonOnSphere(points).get_area() * EARTH_RADIUS_KM ** 2)
        total += areas[0] - sum(areas[1:])
    return total


def feature_id(kind: str, plate: int) -> str:
    return f"iceland-{kind}-plate-{plate}"


def lifecycle(kind: str) -> dict:
    if kind == "modern":
        return {"observed": {"validTimeMa": {"youngest": 0, "oldest": 0}}}
    if kind == "gold":
        return {
            "model-pose": {"validTimeMa": {"youngest": 0, "oldest": 3.3}, "youngestExclusive": True},
            "formation": {"validTimeMa": {"youngest": 3.3, "oldest": 16.3},
                          "youngestExclusive": True},
        }
    if kind == "gnew":
        return {
            "model-pose": {"validTimeMa": {"youngest": 0, "oldest": 0.8}, "youngestExclusive": True},
            "formation": {"validTimeMa": {"youngest": 0.8, "oldest": 3.3},
                          "youngestExclusive": True},
        }
    if kind in {"hraun", "mob"}:
        return {"formation": {"validTimeMa": {"youngest": 0, "oldest": 0.8},
                              "youngestExclusive": True, "oldestExclusive": True}}
    raise BuildError(f"unknown lifecycle kind {kind}")


def source_rows() -> list[dict]:
    old_url = ("https://ogc.gis.is/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&"
               "typeNames=NATT%3AISL_IINH_500k_BA&outputFormat=application%2Fjson&srsName=CRS%3A84&"
               "CQL_FILTER=flokkur+IN+%28%27gold%27%2C%27gnew%27%29")
    young_url = ("https://ogc.gis.is/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&"
                 "typeNames=NATT%3AISL_IINH_500k_BA&outputFormat=application%2Fjson&srsName=CRS%3A84&"
                 "CQL_FILTER=flokkur+IN+%28%27hraun%27%2C%27mob%27%29")
    return [
        {
            "sourceId": "natural-earth-countries-50m",
            "title": "Natural Earth 1:50m Admin 0 Countries",
            "url": "https://naturalearth.s3.amazonaws.com/50m_cultural/ne_50m_admin_0_countries.zip",
            "publicationOrVersionDate": "5.1.1",
            "retrievedAt": "2026-09-12",
            "license": "Public domain",
            "attribution": "Made with Natural Earth",
            "geographicBasis": "generalized present-day WGS84 land polygon",
            "temporalRangeMa": [0, 0],
            "path": NATURAL_EARTH_50M.name,
            "bytes": PINNED[NATURAL_EARTH_50M.name][0],
            "sha256": PINNED[NATURAL_EARTH_50M.name][1],
        },
        {
            "sourceId": "iinh-iceland-bedrock-age-500k",
            "title": "ISL IINH 1:500k Bedrock Age",
            "url": old_url,
            "companionQueryUrl": young_url,
            "publicationOrVersionDate": "second edition 2014; metadata records revisions in 1998, 2009, and 2014",
            "retrievedAt": "2026-09-12",
            "license": "CC BY 4.0",
            "attribution": "ISL IINH 1:500k Bedrock Age by the Natural Science Institute of Iceland, CC BY 4.0",
            "geographicBasis": "present-day mapped outcrop classes in OGC CRS84; not a palaeoshoreline",
            "temporalRangeMa": [16.3, 0],
            "members": [
                {"path": "bedrock-old.geojson", "bytes": PINNED["bedrock-old.geojson"][0],
                 "sha256": PINNED["bedrock-old.geojson"][1]},
                {"path": "bedrock-young.geojson", "bytes": PINNED["bedrock-young.geojson"][0],
                 "sha256": PINNED["bedrock-young.geojson"][1]},
                {"path": "wfs-capabilities.xml", "bytes": PINNED["wfs-capabilities.xml"][0],
                 "sha256": PINNED["wfs-capabilities.xml"][1]},
                {"path": "wms-capabilities.xml", "bytes": PINNED["wms-capabilities.xml"][0],
                 "sha256": PINNED["wms-capabilities.xml"][1]},
                {"path": "bedrock-style.sld", "bytes": PINNED["bedrock-style.sld"][0],
                 "sha256": PINNED["bedrock-style.sld"][1]},
                {"path": "bedrock-metadata.xml", "bytes": PINNED["bedrock-metadata.xml"][0],
                 "sha256": PINNED["bedrock-metadata.xml"][1]},
            ],
        },
    ]


def build(output: Path, report_path: Path) -> dict:
    for path in (WFS_CAPABILITIES, WMS_CAPABILITIES, BEDROCK_STYLE, BEDROCK_METADATA):
        verify(path, path.name)
    island = load_iceland_50m()
    coverage_reference_island = load_iceland_110m()
    units = load_units()
    ridge, topologies, ridge_owners = resolved_partition()
    omission_witness = baseline_omission_witness()
    sources = {"modern": island, **units}
    split_sources = {kind: split_by_plate(geometry, ridge, topologies)
                     for kind, geometry in sources.items()}
    rows = []
    metrics = {}
    for kind in ("modern", "gold", "gnew", "hraun", "mob"):
        metrics[kind] = {
            "areaSquareKilometres": round(spherical_area_km2(sources[kind]), 3),
            "plateAreasSquareKilometres": {},
        }
        for plate in PLATE_IDS:
            geometry = split_sources[kind][plate]
            identifier = feature_id(kind, plate)
            metrics[kind]["plateAreasSquareKilometres"][str(plate)] = round(spherical_area_km2(geometry), 3)
            rows.append({
                "type": "Feature", "id": identifier,
                "properties": {
                    "correctionFeatureId": identifier,
                    "sourceClass": kind,
                    "plateId": plate,
                    "geometryReferenceAgeMa": 0,
                    "coordinateFrame": "WGS84-reference-coordinates",
                },
                "geometry": geometry_json(geometry),
            })
    geometry_document = {"type": "FeatureCollection", "features": rows}
    output.mkdir(parents=True, exist_ok=True)
    geometry_path = output / GEOMETRY_NAME
    geometry_path.write_bytes(canonical(geometry_document))
    geometry_asset = {"path": GEOMETRY_NAME, "bytes": geometry_path.stat().st_size,
                      "sha256": digest(geometry_path)}
    selected_area = spherical_area_km2(unary_union(list(units.values())))
    island_area = spherical_area_km2(island)
    coverage_reference_area = spherical_area_km2(coverage_reference_island)
    selected_union = unary_union(list(units.values()))
    report = {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "sourceGeometry": {
            "naturalEarthIcelandAreaSquareKilometres": round(island_area, 3),
            "naturalEarthIcelandVertexCount": polygon_vertex_count(island),
            "naturalEarthIcelandBoundaryHausdorffDistanceFrom110mDegrees": round(
                island.boundary.hausdorff_distance(coverage_reference_island.boundary), 9),
            "selectedBedrockUnionAreaSquareKilometres": round(selected_area, 3),
            "selectedBedrockCoverageOfModernGeneralizedLandFraction": round(
                spherical_area_km2(selected_union.intersection(coverage_reference_island)) /
                coverage_reference_area, 9),
            "uncoveredModernGeneralizedLandSquareKilometres": round(
                spherical_area_km2(coverage_reference_island.difference(selected_union)), 3),
            "historicalCoverageMetricBasis": (
                "Natural Earth 1:110m generalized Iceland polygon retained for comparability; "
                "the modern observed render uses the independent 1:50m polygon"),
            "uncoveredSemantics": "unclassified by this bounded correction; not confirmed sea or absent substrate",
            "classes": metrics,
        },
        "partition": {
            "method": "pygplates.resolve_topologies at 0 Ma, split at exact shared ridge subsegments",
            "ridgeFeatureIds": list(RIDGE_IDS),
            "ridgeSharingPlateIds": ridge_owners,
            "plateIds": list(PLATE_IDS),
        },
        "baselineOmissionWitness": omission_witness,
        "positiveAgeWitnessesMa": [0, 0.001, 0.021, 0.8, 1, 3.3, 5, 10, 15],
        "negativeAgeWitnessesMa": [16.300001, 20],
        "geometry": geometry_asset,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(canonical(report))

    features = []
    for kind in ("modern", "gold", "gnew", "hraun", "mob"):
        for plate in PLATE_IDS:
            observed = kind == "modern"
            features.append({
                "correctionFeatureId": feature_id(kind, plate),
                "geometryAsset": {**geometry_asset, "featureId": feature_id(kind, plate)},
                "geometryReferenceAgeMa": 0,
                "coordinateFrame": "WGS84-reference-coordinates",
                "pose": {
                    "method": "cao-rigid-plate-motion",
                    "plateId": plate,
                    "sourceOrHypothesis": "Cao v2.4 present resolved topology partition and strict plate motion",
                    "warning": "The split is a two-rigid-plate approximation of an actively deforming ridge island.",
                },
                "materialRole": "observed-exposed-land" if observed else "volcanic-island-material-support",
                "phaseLifecycles": lifecycle(kind),
                "sourceUnitSelection": {"included": [kind], "excluded": []},
                "sourceIds": (["natural-earth-countries-50m"] if observed else
                              ["iinh-iceland-bedrock-age-500k", "moorbath-et-al-1968",
                               "hardarson-et-al-2008", "blischke-et-al-2022"]),
                "epistemicStatus": "observed" if observed else "model-inference",
                "surfaceEvidence": ({"kind": "observed", "surfaceClass": "land",
                    "sourceIds": ["natural-earth-countries-50m"], "reason":
                    "Natural Earth 1:50m generalized present-day land polygon; active only at 0 Ma"} if observed else
                    {"kind": "unknown", "reason":
                     "mapped present outcrop age constrains material existence but not palaeoshoreline, exposure, or height"}),
                "uncertainty": {
                    "spatial": ("Natural Earth 1:50m generalization" if observed else
                                "IINH second-edition 1:600k source scale, simplified by 0.005 degrees; source metadata reports about ±500 m"),
                    "temporal": ("exact modern reference only" if observed else
                                 "mapped age class applies per outcrop; gray phase is possible formation range, not simultaneous formation"),
                    "exposure": ("observed modern land classification" if observed else
                                 "unknown at every non-modern age"),
                },
            })
    manifest = {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "version": "1",
        "attribution": ("Made with Natural Earth. ISL IINH 1:500k Bedrock Age by the Natural Science "
                        "Institute of Iceland is licensed under CC BY 4.0."),
        "baseline": {
            "modelId": "cao-et-al-2024", "modelVersion": "2.4", "coordinateFrame": FRAME,
            "coastSourceSha256": "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f",
            "continentSourceSha256": "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616",
            "omission": "neither native source contains a polygon covering central Iceland at 0 Ma",
            "omissionWitness": omission_witness,
        },
        "sourceAssets": source_rows(),
        "references": [
            {"sourceId": "moorbath-et-al-1968", "citation":
             "Moorbath, Sigurdsson & Goodwin (1968), K-Ar ages of oldest exposed rocks in Iceland",
             "url": "https://doi.org/10.1016/0012-821X(68)90035-6", "license": "citation only",
             "publicationOrVersionDate": "1968", "retrievedAt": "2026-09-12",
             "temporalRangeMa": [16.3, 12.3],
             "geographicBasis": "dated exposed lava in northwest and eastern Iceland",
             "evidenceRole": "16.0 ± 0.3 Ma oldest exposed-lava bound; not island birth"},
            {"sourceId": "hardarson-et-al-2008", "citation":
             "Harðarson, Fitton & Hjartarson (2008), Tertiary volcanism in Iceland",
             "url": "https://jokull.jorfi.is/articles/jokull2008.58/jokull2008.58.161.pdf",
             "license": "citation only; no article content redistributed",
             "publicationOrVersionDate": "2008", "retrievedAt": "2026-09-12",
             "temporalRangeMa": [16.3, 0],
             "geographicBasis": "exposed Tertiary and younger volcanic successions across Iceland",
             "evidenceRole": "review of exposed-rock ages and major ridge jumps"},
            {"sourceId": "blischke-et-al-2022", "citation":
             "Blischke et al. (2022), Seismic Volcanostratigraphy: The Key to Resolving the Jan Mayen "
             "Microcontinent and Iceland Plateau Rift Evolution",
             "url": "https://doi.org/10.1029/2021GC009948", "license": "citation only",
             "publicationOrVersionDate": "2022-03-16", "retrievedAt": "2026-09-12",
             "temporalRangeMa": [63, 15],
             "geographicBasis": "Jan Mayen microcontinent and Iceland Plateau rift system",
             "evidenceRole": "multi-rift kinematic history; cautions against whole-island rigid motion"},
        ],
        "geometryProcessing": {
            "unitPolicy": {
                "gold": "all mapped material is older than 3.3 Ma; possible formation range ends at 16.3 Ma source-coverage bound",
                "gnew": "all mapped material is 0.8–3.3 Ma",
                "hraun": "mapped material is younger than 0.8 Ma; gray possible formation only",
                "mob": "mapped material is younger than 0.8 Ma; gray possible formation only",
            },
            "simplificationToleranceDegrees": SIMPLIFY_DEGREES,
            "platePartition": report["partition"],
            "coverageGap": report["sourceGeometry"]["uncoveredSemantics"],
        },
        "features": features,
        "rejectionConditions": [
            "source bytes or hashes change",
            "modern generalized coast is active outside exact 0 Ma",
            "non-modern chart claims observed exposure or height",
            "formation-range endpoint is described as island birth",
            "a geometry piece is not assigned to Cao plate 101 or 301",
            "selected source coverage gap is interpreted as sea or absent substrate",
        ],
    }
    manifest_path = output / MANIFEST_NAME
    manifest_path.write_bytes(canonical(manifest))
    return {"geometry": geometry_asset, "features": len(rows), "report": report,
            "manifestSha256": digest(manifest_path)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUT)
    parser.add_argument("--report", type=Path, default=REPORT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        with tempfile.TemporaryDirectory(prefix="earthhistory-iceland-check-") as directory:
            temporary = Path(directory)
            result = build(temporary, temporary / REPORT.name)
            for name, expected in ((GEOMETRY_NAME, args.output / GEOMETRY_NAME),
                                   (MANIFEST_NAME, args.output / MANIFEST_NAME),
                                   (REPORT.name, args.report)):
                if not expected.is_file() or (temporary / name).read_bytes() != expected.read_bytes():
                    raise BuildError(f"{name}: tracked output differs from reproducible compiler")
    else:
        result = build(args.output, args.report)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
