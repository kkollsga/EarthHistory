#!/usr/bin/env python3
"""Compile the global exact-present observed-land omission correction.

At 0 Ma the compiled Cao v2.4 foundation leaves parts of observed modern land
with no chart in either the land or the shelf batch, so the opaque ocean sphere
shows through and reads as deep sea. Two kinds of omission produce it:

* a Cao static partition that has no counterpart polygon in ``shapes_coasts``
  or ``shapes_continents`` at all (the south-west Arabian "Covered Tathlith"
  block), and
* observed modern land that lies outside every emitted Cao coast polygon and
  outside the continental-outline underlay as well (the Niger delta, Socotra,
  the Saloum/Senegal delta, Kerguelen, the Galapagos, and other deltas and
  islands that the model's generalized coastline does not reach).

Both are the same repair: Natural Earth supplies generalized observed modern
land, a Cao static polygon supplies present ownership and the identity pose, and
the result is valid at exactly 0 Ma. Nothing here is valid away from 0 Ma, and
it never derives water depth, palaeoshoreline, or historical exposure.

Land that the Cao continental-outline underlay already covers is deliberately
left alone: it renders as the model's own shelf class rather than bare ocean,
and correcting it would restate a cartographic scale difference as evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import zipfile
from pathlib import Path

import pygplates
import shapefile
from shapely.geometry import GeometryCollection, MultiPolygon, Point, Polygon, mapping, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree
from shapely.validation import make_valid
import cao_package_intern as package_intern


ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study"
MODEL = POOL / "plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
NE_ARCHIVE = POOL / "verification/regional-iceland-correction-v1/source-inputs/ne_50m_admin_0_countries.zip"
COASTS = MODEL / "shapes_coasts.gpmlz"
CONTINENTS = MODEL / "shapes_continents.gpmlz"
STATIC = MODEL / "static_polygons.gpmlz"
ROTATIONS = MODEL / "1000_0_rotfile.rot"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
OUT = ROOT / "data/corrections/observed-land-omission"
REPORT = ROOT / "docs/research/regional-observed-land-omission-validation.json"

CORRECTION_ID = "earthhistory-observed-land-omission-v1"
GEOMETRY_NAME = "observed-land-omission-v1.geojson"
MANIFEST_NAME = "observed-land-manifest.json"
EARTH_RADIUS_KM = 6371.0

# Selection policy. A component is corrected only when it is large enough to be a
# real map defect, bare of any Cao underlay, and owned by exactly one present
# static partition whose plate already carries a qualified 0 Ma palette binding.
MIN_COMPONENT_KM2 = 1000.0
MAX_SHELF_FRACTION = 0.5
# Planar WGS84 Booleans are not valid across the pole or the antimeridian.
POLAR_LIMIT_DEGREES = 84.0
MAX_LONGITUDE_SPAN_DEGREES = 180.0

# Exact-present corrections that already cover part of the omission and keep
# their own tracked contracts; their footprints are subtracted, not restated.
PRIOR_CORRECTIONS = (
    ("data/corrections/iceland/iceland-surface-material-v1.geojson", "iceland-modern"),
    ("data/corrections/panama/panama-observed-land-v1.geojson", None),
)

PINNED = {
    "ne_50m_admin_0_countries.zip": (799734, "5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139"),
    "shapes_coasts.gpmlz": (1860295, "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"),
    "shapes_continents.gpmlz": (1243843, "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"),
    "static_polygons.gpmlz": (2248936, "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f"),
    "1000_0_rotfile.rot": (625128, "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"),
}

# The user-reported defects this correction must cover, as lon/lat witnesses.
DEFECT_WITNESSES = {
    "southwest-arabia-highlands": (45.0, 17.0),
    "southwest-arabia-sanaa-north": (44.0, 16.0),
    "southwest-arabia-asir": (44.0, 20.0),
    "southwest-arabia-taizz": (44.5, 13.0),
    "niger-delta": (6.5, 5.0),
    "niger-delta-east": (7.5, 4.8),
}
# Native Cao land just outside the omissions; the correction must not absorb it.
NATIVE_WITNESSES = {
    "arabia-interior": (47.0, 15.5),
    "arabia-hadhramaut": (50.0, 19.0),
    "arabia-riyadh": (46.0, 24.0),
    "arabia-asir-coast": (43.5, 17.0),
    "nigeria-interior": (8.0, 9.0),
    "angola-interior": (17.0, -12.0),
}


class BuildError(ValueError):
    pass


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(path: Path) -> None:
    expected_size, expected_sha = PINNED[path.name]
    if not path.is_file() or path.stat().st_size != expected_size or sha(path) != expected_sha:
        raise BuildError(f"{path.name}: pinned source identity changed")


def polygon_parts(geometry):
    geometry = make_valid(geometry)
    if geometry.is_empty:
        return []
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    if isinstance(geometry, GeometryCollection):
        return [part for child in geometry.geoms for part in polygon_parts(child)]
    return []


def polygonal(geometry, *, allow_empty: bool = True):
    parts = [part for part in polygon_parts(geometry) if part.area > 1e-14]
    if not parts:
        if allow_empty:
            return Polygon()
        raise BuildError("polygon processing removed all source geometry")
    return make_valid(unary_union(parts))


def pygplates_polygon(geometry) -> Polygon:
    def ring(points):
        return [(longitude, latitude) for latitude, longitude in (point.to_lat_lon() for point in points)]
    return make_valid(Polygon(ring(geometry.get_exterior_ring_points()),
                              [ring(geometry.get_interior_ring_points(index))
                               for index in range(geometry.get_number_of_interior_rings())]))


def active_at_zero(feature) -> bool:
    oldest, youngest = feature.get_valid_time()
    return youngest <= 0 <= oldest


def source_geometry_digest(feature) -> str:
    rows = []
    for geometry_index, geometry in enumerate(feature.get_all_geometries()):
        if not isinstance(geometry, pygplates.PolygonOnSphere):
            continue
        rings = [geometry.get_exterior_ring_points()]
        rings.extend(geometry.get_interior_ring_points(index)
                     for index in range(geometry.get_number_of_interior_rings()))
        rows.append({"geometryOrder": geometry_index, "rings": [
            [[float(component) for component in point.to_xyz()] for point in ring] for ring in rings
        ]})
    return hashlib.sha256(canonical(rows)).hexdigest()


def load_collection(path: Path, prefix: str, emitted: set[str] | None):
    verify(path)
    rows = []
    identifiers = set()
    for order, feature in enumerate(pygplates.FeatureCollection(str(path))):
        identifiers.add(str(feature.get_feature_id()))
        if not active_at_zero(feature):
            continue
        geometry_order = 0
        for geometry in feature.get_all_geometries():
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            chart_id = f"{prefix}:{feature.get_feature_id()}:{order}:{geometry_order}"
            geometry_order += 1
            if emitted is not None and chart_id not in emitted:
                continue
            oldest, youngest = feature.get_valid_time()
            rows.append({
                "sourceOrder": order,
                "featureId": str(feature.get_feature_id()),
                "name": feature.get_name(),
                "plateId": feature.get_reconstruction_plate_id(None),
                "validTimeMa": [oldest, youngest],
                "geometry": pygplates_polygon(geometry),
                "feature": feature,
                "chartId": chart_id,
            })
    return rows, identifiers


def load_countries():
    verify(NE_ARCHIVE)
    stem = "ne_50m_admin_0_countries"
    with zipfile.ZipFile(NE_ARCHIVE) as archive:
        if archive.read(f"{stem}.VERSION.txt").decode("ascii").strip() != "5.1.1":
            raise BuildError("Natural Earth embedded version changed")
        reader = shapefile.Reader(
            shp=io.BytesIO(archive.read(f"{stem}.shp")),
            shx=io.BytesIO(archive.read(f"{stem}.shx")),
            dbf=io.BytesIO(archive.read(f"{stem}.dbf")),
            encoding="utf-8",
        )
        fields = [field[0] for field in reader.fields[1:]]
        rows = []
        for record in reader.iterShapeRecords():
            values = dict(zip(fields, record.record))
            geometry = polygonal(shape(record.shape.__geo_interface__))
            if not geometry.is_empty:
                rows.append((values.get("ADM0_A3"), values.get("NAME"), geometry))
    if len(rows) < 200:
        raise BuildError("Natural Earth country inventory changed")
    return rows


def prior_correction_union():
    rows = []
    for relative, prefix in PRIOR_CORRECTIONS:
        document = json.loads((ROOT / relative).read_text())
        for feature in document["features"]:
            identifier = str(feature.get("id", ""))
            if prefix is not None and not identifier.startswith(prefix):
                continue
            rows.append(polygonal(shape(feature["geometry"])))
    return polygonal(unary_union(rows)) if rows else Polygon()


def area_km2(geometry) -> float:
    if geometry.is_empty:
        return 0.0
    centre = geometry.representative_point()
    lon0 = math.radians(centre.x)
    lat0 = math.radians(centre.y)

    def project(x, y, z=None):
        lon = math.radians(x)
        lat = math.radians(y)
        denominator = 1 + math.sin(lat0) * math.sin(lat) + math.cos(lat0) * math.cos(lat) * math.cos(lon - lon0)
        if denominator <= 1e-12:
            return 0.0, 0.0
        scale = math.sqrt(2 / denominator)
        east = EARTH_RADIUS_KM * scale * math.cos(lat) * math.sin(lon - lon0)
        north = EARTH_RADIUS_KM * scale * (math.cos(lat0) * math.sin(lat)
                                           - math.sin(lat0) * math.cos(lat) * math.cos(lon - lon0))
        return east, north
    return transform(project, geometry).area


def rounded(value):
    if isinstance(value, (tuple, list)):
        return [rounded(item) for item in value]
    return round(float(value), 6)


def dedupe_ring(ring: list) -> list:
    """Drop consecutive duplicates that six-decimal rounding can create.

    Repeated positions triangulate to zero-area ears, which the shared
    triangulator rejects. Removing them preserves the rounded boundary exactly.
    """
    kept = [ring[0]]
    for position in ring[1:]:
        if position != kept[-1]:
            kept.append(position)
    if kept[0] != kept[-1]:
        kept.append(kept[0])
    return kept


def geometry_json(geometry) -> dict | None:
    value = mapping(polygonal(geometry))
    if value["type"] == "Polygon":
        rings = [dedupe_ring(ring) for ring in rounded(value["coordinates"])]
        if any(len(ring) < 4 for ring in rings):
            return None
        return {"type": "Polygon", "coordinates": rings}
    polygons = []
    for polygon in rounded(value["coordinates"]):
        rings = [dedupe_ring(ring) for ring in polygon]
        if any(len(ring) < 4 for ring in rings):
            return None
        polygons.append(rings)
    if not polygons:
        return None
    return {"type": "MultiPolygon", "coordinates": polygons}


def count_positions(geometry_value: dict) -> tuple[int, int]:
    polygons = ([geometry_value["coordinates"]] if geometry_value["type"] == "Polygon"
                else geometry_value["coordinates"])
    return len(polygons), sum(len(ring) - 1 for polygon in polygons for ring in polygon)


def present_palette_plates() -> set[int]:
    palette = json.loads((PUBLIC / "motion-palette.json").read_text())
    return {entry["plateId"] for entry in palette["entries"]
            if entry["youngestAgeMa"] <= 0 <= entry["oldestAgeMa"]}


def build() -> tuple[dict, dict, dict]:
    for path in (NE_ARCHIVE, COASTS, CONTINENTS, STATIC, ROTATIONS):
        verify(path)
    rotation_model = pygplates.RotationModel(str(ROTATIONS), default_anchor_plate_id=0)
    core = package_intern.read_package_json(PUBLIC / "core.json")
    emitted = {row.get("chartId") for row in core.get("charts", [])}

    coasts, coast_ids = load_collection(COASTS, "cao-coast", emitted)
    continents, continent_ids = load_collection(CONTINENTS, "cao-continent", emitted)
    statics, _ = load_collection(STATIC, "static", None)
    countries = load_countries()
    prior = prior_correction_union()
    palette_plates = present_palette_plates()

    coast_geometries = [row["geometry"] for row in coasts]
    continent_geometries = [row["geometry"] for row in continents]
    static_geometries = [row["geometry"] for row in statics]
    coast_tree = STRtree(coast_geometries)
    continent_tree = STRtree(continent_geometries)
    static_tree = STRtree(static_geometries)

    candidates = []
    skipped = []
    for iso, name, land in countries:
        near = [coast_geometries[index] for index in coast_tree.query(land)]
        covered = polygonal(unary_union(near).intersection(land)) if near else Polygon()
        missing = polygonal(land.difference(covered)) if not covered.is_empty else land
        if not missing.is_empty and not prior.is_empty:
            missing = polygonal(missing.difference(prior))
        for component in polygon_parts(missing):
            area = area_km2(component)
            if area < MIN_COMPONENT_KM2:
                continue
            bounds = component.bounds
            reason = None
            if abs(bounds[1]) > POLAR_LIMIT_DEGREES or abs(bounds[3]) > POLAR_LIMIT_DEGREES:
                reason = "planar Boolean is not valid across the pole"
            elif bounds[2] - bounds[0] > MAX_LONGITUDE_SPAN_DEGREES:
                reason = "planar Boolean is not valid across the antimeridian"
            shelf_near = ([continent_geometries[index] for index in continent_tree.query(component)]
                          if reason is None else [])
            shelf = polygonal(unary_union(shelf_near).intersection(component)) if shelf_near else Polygon()
            shelf_fraction = area_km2(shelf) / area if area else 0.0
            if reason is None and shelf_fraction >= MAX_SHELF_FRACTION:
                reason = "the Cao continental-outline underlay already covers it"
            point = component.representative_point()
            owners = [statics[index] for index in static_tree.query(point)
                      if statics[index]["geometry"].contains(point)]
            if reason is None and len(owners) != 1:
                reason = f"{len(owners)} present static partitions contain the component"
            if reason is None and owners[0]["plateId"] not in palette_plates:
                reason = f"plate {owners[0]['plateId']} has no qualified 0 Ma palette binding"
            row = {
                "iso": iso, "country": name, "areaSquareKilometres": round(area, 3),
                "bounds": [round(value, 6) for value in bounds],
                "representativeLonLat": [round(point.x, 6), round(point.y, 6)],
                "shelfFraction": round(shelf_fraction, 6),
            }
            if reason is not None:
                skipped.append(row | {"reason": reason,
                                      "plateIds": sorted({owner["plateId"] for owner in owners})})
                continue
            candidates.append(row | {"geometry": component, "owner": owners[0]})

    if not candidates:
        raise BuildError("no correctable observed-land omission found")

    # One feature per owning static partition; a partition may own several
    # components (an island group), and they share its ownership and pose.
    grouped: dict[tuple[int, int], dict] = {}
    for candidate in candidates:
        owner = candidate["owner"]
        key = (owner["plateId"], owner["sourceOrder"])
        entry = grouped.setdefault(key, {"owner": owner, "components": [], "rows": []})
        entry["components"].append(candidate["geometry"])
        entry["rows"].append({key2: candidate[key2] for key2 in
                              ("iso", "country", "areaSquareKilometres", "bounds",
                               "representativeLonLat", "shelfFraction")})

    features = []
    partition_rows = []
    pieces = []
    for (plate_id, source_order) in sorted(grouped):
        entry = grouped[(plate_id, source_order)]
        owner = entry["owner"]
        _, _, angle = rotation_model.get_rotation(
            0, plate_id, anchor_plate_id=0).get_lat_lon_euler_pole_and_angle_degrees()
        if abs(angle) > 1e-12:
            raise BuildError(f"plate {plate_id}: 0 Ma rotation is not identity")
        piece = polygonal(unary_union(entry["components"]))
        emitted_geometry = geometry_json(piece)
        if emitted_geometry is None:
            raise BuildError(f"plate {plate_id}: rounded geometry collapsed")
        component_count, vertex_count = count_positions(emitted_geometry)
        identifier = f"observed-land-omission-{plate_id}-{source_order}"
        features.append({
            "type": "Feature",
            "id": identifier,
            "properties": {
                "correctionFeatureId": identifier,
                "plateId": plate_id,
                "geometryReferenceAgeMa": 0,
                "coordinateFrame": "WGS84-reference-coordinates",
                "surfaceClass": "land",
                "sourceClass": "natural-earth-observed-modern-land",
                "sourceFeatureId": owner["featureId"],
                "sourceOrder": source_order,
                "validTimeMa": {"youngest": 0, "oldest": 0},
            },
            "geometry": emitted_geometry,
        })
        partition_rows.append({
            "featureId": owner["featureId"], "name": owner["name"], "plateId": plate_id,
            "sourceOrder": source_order,
            "validTimeMa": [owner["validTimeMa"][0], 0],
            "geometrySha256": source_geometry_digest(owner["feature"]),
            "hasCoastCounterpart": owner["featureId"] in coast_ids,
            "hasContinentCounterpart": owner["featureId"] in continent_ids,
            "correctedAreaSquareKilometres": round(area_km2(piece), 3),
            "correctedComponentCount": component_count,
            "correctedVertexCount": vertex_count,
            "components": sorted(entry["rows"], key=lambda row: -row["areaSquareKilometres"]),
        })
        pieces.append(piece)

    correction = polygonal(unary_union(pieces))
    native_land = polygonal(unary_union(
        [coast_geometries[index] for index in coast_tree.query(correction)]).intersection(correction))
    native_overlap = area_km2(native_land)
    pair_overlap = 0.0
    for index, left in enumerate(pieces):
        for right in pieces[index + 1:]:
            pair_overlap += area_km2(left.intersection(right))
    prior_overlap = area_km2(correction.intersection(prior)) if not prior.is_empty else 0.0
    if native_overlap > 1e-4 or pair_overlap > 1e-6 or prior_overlap > 1e-6:
        raise BuildError(f"overlap guard failed: native={native_overlap}, pair={pair_overlap}, "
                         f"prior={prior_overlap}")

    witnesses = {}
    for label, (longitude, latitude) in DEFECT_WITNESSES.items():
        if not correction.contains(Point(longitude, latitude)):
            raise BuildError(f"reported defect witness {label} {longitude},{latitude} is not corrected")
        witnesses[label] = [longitude, latitude]
    native_checks = {}
    for label, (longitude, latitude) in NATIVE_WITNESSES.items():
        if correction.intersects(Point(longitude, latitude)):
            raise BuildError(f"native witness {label} {longitude},{latitude} was absorbed")
        native_checks[label] = [longitude, latitude]

    geometry = {"type": "FeatureCollection", "features": features}
    geometry_bytes = canonical(geometry)
    geometry_sha = hashlib.sha256(geometry_bytes).hexdigest()

    feature_records = []
    for feature, partition in zip(features, partition_rows):
        identifier = feature["id"]
        feature_records.append({
            "correctionFeatureId": identifier,
            "coordinateFrame": "WGS84-reference-coordinates",
            "geometryReferenceAgeMa": 0,
            "epistemicStatus": "observed-generalized",
            "materialRole": "observed-modern-land",
            "phaseLifecycles": {"observed": {"validTimeMa": {"youngest": 0, "oldest": 0}}},
            "pose": {
                "method": "cao-static-polygon-identity-at-present",
                "plateId": partition["plateId"],
                "sourceFeatureId": partition["featureId"],
                "sourceOrder": partition["sourceOrder"],
                "motionBinding": "reuse-present-binding",
                "warning": ("The static partition supplies ownership only at exact 0 Ma; "
                            "this modern land is never backdated."),
            },
            "sourceIds": ["natural-earth-countries-50m", "cao-v2.4-static-partitions",
                          "cao-v2.4-native-coasts"],
            "surfaceEvidence": {
                "kind": "observed", "surfaceClass": "land",
                "reason": "Natural Earth 1:50m generalized present-day land polygon; active only at 0 Ma",
                "sourceIds": ["natural-earth-countries-50m"],
            },
            "uncertainty": {
                "spatial": ("Natural Earth 1:50m generalized admin-0 land boundary clipped to the "
                            "uncovered part of Cao's present coast polygons"),
                "temporal": "exact modern reference only",
                "exposure": "observed modern land classification",
                "depth": "no shallow-water or bathymetric claim",
            },
            "geometryAsset": {"path": GEOMETRY_NAME, "bytes": len(geometry_bytes),
                              "sha256": geometry_sha, "featureId": identifier},
        })

    manifest = {
        "schemaVersion": 1,
        "version": "1",
        "correctionId": CORRECTION_ID,
        "attribution": "Made with Natural Earth; Cao et al. (2024).",
        "baseline": {
            "modelId": "cao-et-al-2024",
            "modelVersion": "2.4",
            "coastSourceSha256": PINNED[COASTS.name][1],
            "continentSourceSha256": PINNED[CONTINENTS.name][1],
            "staticSourceSha256": PINNED[STATIC.name][1],
            "rotationSourceSha256": PINNED[ROTATIONS.name][1],
            "coordinateFrame": {
                "absoluteFrameId": "palaeomagnetic",
                "anchorPlateId": 0,
                "axisConvention": "gplates-x0e-y90e-znorth",
            },
            "omission": (
                "observed modern land that no emitted Cao coast chart and no Cao "
                "continental-outline polygon covers at 0 Ma, so the opaque ocean sphere is "
                "visible through the surface"
            ),
            "omissionWitness": {
                "ageMa": 0,
                "uncoveredWitnessLonLat": witnesses,
                "nativeWitnessLonLat": native_checks,
            },
        },
        "geometryProcessing": {
            "operation": (
                "Natural Earth 1:50m admin-0 land minus the emitted Cao shapes_coasts chart "
                "footprint active at 0 Ma and minus the existing exact-present corrections, "
                "split into connected components and intersected with the pinned Cao static "
                "polygon that owns each component"
            ),
            "selectionPolicy": {
                "minimumComponentSquareKilometres": MIN_COMPONENT_KM2,
                "maximumShelfFraction": MAX_SHELF_FRACTION,
                "requiresSinglePresentStaticPartition": True,
                "requiresQualifiedPresentPaletteBinding": True,
                "polarLimitDegrees": POLAR_LIMIT_DEGREES,
                "maximumLongitudeSpanDegrees": MAX_LONGITUDE_SPAN_DEGREES,
            },
            "nativeOverlapPrecedence": (
                "retain native coast charts and evidence wherever Cao already supplies land; "
                "emit only the source-classified missing land"
            ),
            "shorelineMismatchHandling": (
                "no buffer or inferred bridge; land that the Cao continental-outline underlay "
                "already covers stays uncorrected and keeps the model's own shelf class"
            ),
            "countryReferenceImplication": (
                "the land applicator does not alter any country reference chart; the packaged "
                "locator overlay remains Natural Earth 1:110m and is a separate concern"
            ),
            "waterSemantics": "no shelf, shallow-water, palaeoshoreline, or bathymetric claim",
            "roundingDecimalDegrees": 6,
            "platePartitions": partition_rows,
            "skippedComponents": sorted(skipped, key=lambda row: -row["areaSquareKilometres"]),
        },
        "sourceAssets": [
            {
                "sourceId": "natural-earth-countries-50m", "title": "Natural Earth 1:50m Admin 0 Countries",
                "url": "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/",
                "publicationOrVersionDate": "5.1.1", "retrievedAt": "2026-09-12", "license": "Public domain",
                "geographicBasis": "WGS84 generalized present-day country land polygons, all ADM0_A3 records",
                "temporalRangeMa": [0, 0],
                "evidenceRole": "generalized observed present-day land boundary",
                "path": NE_ARCHIVE.name, "bytes": PINNED[NE_ARCHIVE.name][0], "sha256": PINNED[NE_ARCHIVE.name][1],
            },
            {
                "sourceId": "cao-v2.4-native-coasts", "title": "Cao et al. 2024 v2.4 shapes_coasts",
                "url": "https://doi.org/10.5281/zenodo.13628813", "publicationOrVersionDate": "2.4",
                "retrievedAt": "2026-09-09", "license": "CC BY 4.0",
                "geographicBasis": "Cao v2.4 palaeomagnetic frame, anchor plate 0, geometry reference age 0 Ma",
                "temporalRangeMa": [1800, 0],
                "evidenceRole": "native present-land coverage subtracted so native polygons retain precedence",
                "path": COASTS.name, "bytes": PINNED[COASTS.name][0], "sha256": PINNED[COASTS.name][1],
            },
            {
                "sourceId": "cao-v2.4-native-continents", "title": "Cao et al. 2024 v2.4 shapes_continents",
                "url": "https://doi.org/10.5281/zenodo.13628813", "publicationOrVersionDate": "2.4",
                "retrievedAt": "2026-09-09", "license": "CC BY 4.0",
                "geographicBasis": "Cao v2.4 palaeomagnetic frame, anchor plate 0, geometry reference age 0 Ma",
                "temporalRangeMa": [1800, 0],
                "evidenceRole": "continental-outline underlay; land it already covers stays uncorrected",
                "path": CONTINENTS.name, "bytes": PINNED[CONTINENTS.name][0], "sha256": PINNED[CONTINENTS.name][1],
            },
            {
                "sourceId": "cao-v2.4-static-partitions",
                "title": "Cao et al. 2024 v2.4 static polygons and rotations",
                "url": "https://doi.org/10.5281/zenodo.13628813", "publicationOrVersionDate": "2.4",
                "retrievedAt": "2026-09-09", "license": "CC BY 4.0",
                "geographicBasis": "Cao v2.4 palaeomagnetic frame, anchor plate 0, geometry reference age 0 Ma",
                "temporalRangeMa": [1800, 0],
                "evidenceRole": "exact-present plate ownership and identity pose; no land or depth evidence",
                "members": [
                    {"path": STATIC.name, "bytes": PINNED[STATIC.name][0], "sha256": PINNED[STATIC.name][1]},
                    {"path": ROTATIONS.name, "bytes": PINNED[ROTATIONS.name][0], "sha256": PINNED[ROTATIONS.name][1]},
                ],
            },
        ],
        "features": feature_records,
        "rejectionConditions": [
            "a chart is active at any age greater than 0 Ma",
            "the source is relabeled shallow marine or used as bathymetry",
            "the correction overlaps native present land beyond numerical tolerance",
            "a static partition identity, plate, valid time, ordered geometry, or pinned source digest changes",
            "a corrected component leaves its owning static partition",
            "a component without a qualified present palette binding is emitted anyway",
            "any country reference chart is silently treated as repaired",
        ],
    }

    report = {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "ageWitnesses": {"activeMa": [0], "inactiveMa": [0.000001, 1, 5, 74]},
        "selectionPolicy": manifest["geometryProcessing"]["selectionPolicy"],
        "result": {
            "features": len(features),
            "correctedAreaSquareKilometres": round(area_km2(correction), 3),
            "correctedComponentCount": sum(row["correctedComponentCount"] for row in partition_rows),
            "correctedVertexCount": sum(row["correctedVertexCount"] for row in partition_rows),
            "nativeOverlapSquareKilometres": round(native_overlap, 9),
            "partitionPairOverlapSquareKilometres": round(pair_overlap, 9),
            "priorCorrectionOverlapSquareKilometres": round(prior_overlap, 9),
            "skippedComponentCount": len(skipped),
            "skippedAreaSquareKilometres": round(sum(row["areaSquareKilometres"] for row in skipped), 3),
            "countries": sorted({row["iso"] for partition in partition_rows
                                 for row in partition["components"]}),
        },
        "defectWitnesses": witnesses,
        "nativeWitnesses": native_checks,
        "geometry": {"path": GEOMETRY_NAME, "bytes": len(geometry_bytes), "sha256": geometry_sha},
    }
    return geometry, manifest, report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=OUT)
    parser.add_argument("--report", type=Path, default=REPORT)
    args = parser.parse_args()
    geometry, manifest, report = build()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    geometry_path = args.output_dir / GEOMETRY_NAME
    manifest_path = args.output_dir / MANIFEST_NAME
    geometry_path.write_bytes(canonical(geometry))
    manifest_path.write_bytes(canonical(manifest))
    report["manifest"] = {"path": manifest_path.name, "bytes": manifest_path.stat().st_size,
                          "sha256": sha(manifest_path)}
    args.report.write_bytes(canonical(report))
    print(json.dumps({"geometry": str(geometry_path), "manifest": str(manifest_path),
                      "report": str(args.report), **report["result"]}))


if __name__ == "__main__":
    main()
