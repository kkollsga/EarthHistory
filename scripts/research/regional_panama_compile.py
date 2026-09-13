#!/usr/bin/env python3
"""Compile an exact-present, source-bounded Panama land correction.

Natural Earth supplies generalized modern land. Cao v2.4 supplies the native
coast omission witness and present-day static plate partitions. Nothing from
this compiler is valid away from 0 Ma, and it never derives water depth.
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
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import transform, unary_union
from shapely.validation import make_valid


ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study"
MODEL = POOL / "plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
NE_ARCHIVE = POOL / "verification/regional-iceland-correction-v1/source-inputs/ne_50m_admin_0_countries.zip"
COASTS = MODEL / "shapes_coasts.gpmlz"
CONTINENTS = MODEL / "shapes_continents.gpmlz"
STATIC = MODEL / "static_polygons.gpmlz"
ROTATIONS = MODEL / "1000_0_rotfile.rot"
CORE = ROOT / "public/data/reconstruction/cao-v2.4/core.json"
OUT = ROOT / "data/corrections/panama"
REPORT = ROOT / "docs/research/regional-panama-validation.json"

CORRECTION_ID = "earthhistory-regional-panama-observed-land-v1"
GEOMETRY_NAME = "panama-observed-land-v1.geojson"
EARTH_RADIUS_KM = 6371.0
PINNED = {
    "ne_50m_admin_0_countries.zip": (799734, "5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139"),
    "shapes_coasts.gpmlz": (1860295, "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"),
    "shapes_continents.gpmlz": (1243843, "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"),
    "static_polygons.gpmlz": (2248936, "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f"),
    "1000_0_rotfile.rot": (625128, "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"),
}
PARTITIONS = (
    (289, "GPlates-2d916a07-b2ba-4953-a1e8-49bedd5fac8e", 229, "Eastern Panama, Central America"),
    (532, "GPlates-6e16f4f2-4864-457a-91d9-a49a937fbc3c", 911, "Nazca"),
    (533, "GPlates-e16723c1-9afc-4d4f-abc8-61f2ca910101", 911, "Nazca"),
    (798, "GPlates-21e07ac6-0662-48ac-bf9d-f2a7fc64fc76", 230, "Central Panama, Central America"),
    (2032, "GPlates-37c480a5-4c44-4641-8411-7614f5185976", 231, "Western Panama, Central America"),
    (2033, "GPlates-a30199da-5274-4c42-819c-802fa8ae72d4", 201, "Eastern Panama, Central America"),
)
EXPECTED_NATIVE_CHARTS = (
    "cao-coast:GPlates-37c480a5-4c44-4641-8411-7614f5185976:481:0",
    "cao-coast:GPlates-a30199da-5274-4c42-819c-802fa8ae72d4:553:1",
)


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


def polygonal(geometry, *, allow_empty: bool = False):
    parts = [part for part in polygon_parts(geometry) if part.area > 1e-14]
    if not parts:
        if allow_empty:
            return Polygon()
        raise BuildError("polygon processing removed all source geometry")
    merged = unary_union(parts)
    return make_valid(merged)


def pygplates_polygon(geometry) -> Polygon:
    def ring(points):
        return [(longitude, latitude) for latitude, longitude in (point.to_lat_lon() for point in points)]
    exterior = ring(geometry.get_exterior_ring_points())
    holes = [ring(geometry.get_interior_ring_points(index))
             for index in range(geometry.get_number_of_interior_rings())]
    return make_valid(Polygon(exterior, holes))


def all_polygons(feature):
    for geometry in feature.get_all_geometries():
        if isinstance(geometry, pygplates.PolygonOnSphere):
            yield pygplates_polygon(geometry)


def active_at_zero(feature) -> bool:
    oldest, youngest = feature.get_valid_time()
    return youngest <= 0 <= oldest


def load_panama() -> object:
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
        matches = [shape(row.shape.__geo_interface__) for row in reader.iterShapeRecords()
                   if dict(zip(fields, row.record)).get("ADM0_A3") == "PAN"]
    if len(matches) != 1:
        raise BuildError(f"Natural Earth Panama match count changed: {len(matches)}")
    return polygonal(matches[0])


def load_native(path: Path, panama, emitted_chart_ids: set[str] | None = None) -> object:
    verify(path)
    rows = []
    for feature_order, feature in enumerate(pygplates.FeatureCollection(str(path))):
        if not active_at_zero(feature):
            continue
        for geometry_order, geometry in enumerate(all_polygons(feature)):
            prefix = "cao-coast" if path == COASTS else "cao-continent"
            chart_id = f"{prefix}:{feature.get_feature_id()}:{feature_order}:{geometry_order}"
            if emitted_chart_ids is not None and chart_id not in emitted_chart_ids:
                continue
            if geometry.bounds[2] >= -84 and geometry.bounds[0] <= -76 and geometry.bounds[3] >= 6.5 and geometry.bounds[1] <= 10.5:
                rows.append(geometry.intersection(panama))
    return polygonal(unary_union(rows))


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


def load_partitions() -> list[dict]:
    verify(STATIC)
    features = list(pygplates.FeatureCollection(str(STATIC)))
    result = []
    for source_order, feature_id, plate_id, name in PARTITIONS:
        feature = features[source_order]
        if (str(feature.get_feature_id()) != feature_id
                or feature.get_reconstruction_plate_id(None) != plate_id
                or feature.get_name() != name):
            raise BuildError(f"static partition identity changed at source order {source_order}")
        geometries = list(all_polygons(feature))
        if len(geometries) != 1:
            raise BuildError(f"static partition {feature_id}: expected one polygon")
        oldest, youngest = feature.get_valid_time()
        if youngest > 0 or oldest < 0:
            raise BuildError(f"static partition {feature_id}: not valid at 0 Ma")
        result.append({
            "sourceOrder": source_order,
            "featureId": feature_id,
            "name": name,
            "plateId": plate_id,
            "validTimeMa": [oldest, 0],
            "geometrySha256": source_geometry_digest(feature),
            "geometry": geometries[0],
        })
    return result


def rounded(value):
    if isinstance(value, (tuple, list)):
        return [rounded(item) for item in value]
    return round(float(value), 6)


def geometry_json(geometry) -> dict:
    value = mapping(polygonal(geometry))
    return {"type": value["type"], "coordinates": rounded(value["coordinates"])}


def count_geometry(geometry) -> tuple[int, int]:
    parts = polygon_parts(geometry)
    if not parts:
        return 0, 0
    vertices = sum(len(part.exterior.coords) - 1
                   + sum(len(ring.coords) - 1 for ring in part.interiors) for part in parts)
    return len(parts), vertices


def area_km2(geometry) -> float:
    lon0 = math.radians(-80.1)
    lat0 = math.radians(8.6)
    def project(x, y, z=None):
        lon = math.radians(x)
        lat = math.radians(y)
        denominator = 1 + math.sin(lat0) * math.sin(lat) + math.cos(lat0) * math.cos(lat) * math.cos(lon - lon0)
        scale = math.sqrt(2 / denominator)
        east = EARTH_RADIUS_KM * scale * math.cos(lat) * math.sin(lon - lon0)
        north = EARTH_RADIUS_KM * scale * (math.cos(lat0) * math.sin(lat) - math.sin(lat0) * math.cos(lat) * math.cos(lon - lon0))
        return east, north
    return transform(project, geometry).area


def build() -> tuple[dict, dict, dict]:
    for path in (NE_ARCHIVE, COASTS, CONTINENTS, STATIC, ROTATIONS):
        verify(path)
    panama = load_panama()
    rotation_model = pygplates.RotationModel(str(ROTATIONS), default_anchor_plate_id=0)
    for plate in {row[2] for row in PARTITIONS}:
        _, _, angle = rotation_model.get_rotation(0, plate, anchor_plate_id=0).get_lat_lon_euler_pole_and_angle_degrees()
        if abs(angle) > 1e-12:
            raise BuildError(f"plate {plate}: 0 Ma rotation is not identity")
    core = json.loads(CORE.read_text())
    emitted_chart_ids = {row.get("chartId") for row in core.get("charts", [])}
    if any(chart_id not in emitted_chart_ids for chart_id in EXPECTED_NATIVE_CHARTS):
        raise BuildError("one or more emitted native Panama coast witnesses disappeared")
    native_land = load_native(COASTS, panama, emitted_chart_ids)
    native_shelf = load_native(CONTINENTS, panama, emitted_chart_ids)
    missing = polygonal(panama.difference(native_land))
    partitions = load_partitions()
    features = []
    partition_rows = []
    pieces = []
    for row in partitions:
        full = polygonal(panama.intersection(row["geometry"]), allow_empty=True)
        # Repeat the native subtraction after the static intersection. GEOS can
        # otherwise retain sub-pixel slivers when it repairs the spherical-source
        # rings in planar WGS84 coordinates.
        piece = polygonal(missing.intersection(row["geometry"]).difference(native_land), allow_empty=True)
        full_components, full_vertices = count_geometry(full)
        components, vertices = count_geometry(piece)
        partition_rows.append({
            key: row[key] for key in ("sourceOrder", "featureId", "name", "plateId", "validTimeMa", "geometrySha256")
        } | {
            "fullAreaSquareKilometres": round(area_km2(full), 6),
            "fullComponentCount": full_components,
            "fullVertexCount": full_vertices,
            "missingAreaSquareKilometres": round(area_km2(piece), 6),
            "missingComponentCount": components,
            "missingVertexCount": vertices,
        })
        if piece.is_empty or area_km2(piece) < 0.001:
            continue
        identifier = f"panama-observed-land-{row['plateId']}-{row['sourceOrder']}"
        features.append({
            "type": "Feature",
            "id": identifier,
            "properties": {
                "correctionFeatureId": identifier,
                "plateId": row["plateId"],
                "geometryReferenceAgeMa": 0,
                "coordinateFrame": "WGS84-reference-coordinates",
                "surfaceClass": "land",
                "sourceClass": "natural-earth-observed-modern-land",
                "sourceFeatureId": row["featureId"],
                "sourceOrder": row["sourceOrder"],
                "validTimeMa": {"youngest": 0, "oldest": 0},
            },
            "geometry": geometry_json(piece),
        })
        pieces.append(piece)
    correction = polygonal(unary_union(pieces))
    pair_overlap = 0.0
    for index, left in enumerate(pieces):
        for right in pieces[index + 1:]:
            pair_overlap += area_km2(left.intersection(right))
    partition_gap = area_km2(missing.difference(correction))
    native_overlap = area_km2(correction.intersection(native_land))
    if partition_gap > 0.05 or pair_overlap > 0.000001 or native_overlap > 0.000001:
        raise BuildError(f"partition failed: gap={partition_gap}, pairOverlap={pair_overlap}, nativeOverlap={native_overlap}")

    geometry = {"type": "FeatureCollection", "features": features}
    geometry_bytes = canonical(geometry)
    geometry_sha = hashlib.sha256(geometry_bytes).hexdigest()
    feature_contracts = []
    for feature in features:
        props = feature["properties"]
        plate = props["plateId"]
        feature_contracts.append({
            "correctionFeatureId": feature["id"],
            "coordinateFrame": "WGS84-reference-coordinates",
            "geometryReferenceAgeMa": 0,
            "epistemicStatus": "observed-generalized",
            "materialRole": "observed-modern-land",
            "phaseLifecycles": {"observed": {"validTimeMa": {"youngest": 0, "oldest": 0}}},
            "pose": {
                "method": "cao-static-polygon-identity-at-present",
                "plateId": plate,
                "sourceFeatureId": props["sourceFeatureId"],
                "sourceOrder": props["sourceOrder"],
                "motionBinding": "reuse-present-binding" if plate == 231 else "add-exact-0-Ma-identity-binding",
                "warning": "The static partition supplies ownership only at exact 0 Ma; this modern land is never backdated.",
            },
            "sourceIds": ["natural-earth-countries-50m", "cao-v2.4-static-partitions", "cao-v2.4-native-coasts"],
            "surfaceEvidence": {"kind": "observed", "surfaceClass": "land", "sourceIds": ["natural-earth-countries-50m"]},
            "uncertainty": {
                "spatial": "Natural Earth 1:50m generalized admin-0 land boundary clipped to the uncovered part of Cao's present coast polygons",
                "temporal": "exact modern reference only",
                "depth": "no shallow-water or bathymetric claim",
            },
            "geometryAsset": {"path": GEOMETRY_NAME, "bytes": len(geometry_bytes), "sha256": geometry_sha, "featureId": feature["id"]},
        })
    contract = {
        "schemaVersion": 1,
        "version": "1",
        "correctionId": CORRECTION_ID,
        "attribution": "Made with Natural Earth; Cao et al. (2024).",
        "sourceAssets": [
            {
                "sourceId": "natural-earth-countries-50m", "title": "Natural Earth 1:50m Admin 0 Countries",
                "url": "https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/",
                "publicationOrVersionDate": "5.1.1", "retrievedAt": "2026-09-12", "license": "Public domain",
                "geographicBasis": "WGS84 generalized present-day country land polygon; ADM0_A3=PAN",
                "temporalRangeMa": [0, 0], "evidenceRole": "generalized observed present-day Panama land boundary",
                "path": NE_ARCHIVE.name, "bytes": PINNED[NE_ARCHIVE.name][0], "sha256": PINNED[NE_ARCHIVE.name][1],
            },
            {
                "sourceId": "cao-v2.4-native-coasts", "title": "Cao et al. 2024 v2.4 shapes_coasts",
                "url": "https://doi.org/10.5281/zenodo.13628813", "publicationOrVersionDate": "2.4",
                "retrievedAt": "2026-09-09", "license": "CC BY 4.0", "geographicBasis": "Cao v2.4 palaeomagnetic frame, anchor plate 0, geometry reference age 0 Ma",
                "temporalRangeMa": [1800, 0], "evidenceRole": "native present-land coverage subtracted so native polygons retain precedence",
                "path": COASTS.name, "bytes": PINNED[COASTS.name][0], "sha256": PINNED[COASTS.name][1],
            },
            {
                "sourceId": "cao-v2.4-static-partitions", "title": "Cao et al. 2024 v2.4 static polygons and rotations",
                "url": "https://doi.org/10.5281/zenodo.13628813", "publicationOrVersionDate": "2.4",
                "retrievedAt": "2026-09-09", "license": "CC BY 4.0", "geographicBasis": "Cao v2.4 palaeomagnetic frame, anchor plate 0, geometry reference age 0 Ma",
                "temporalRangeMa": [1800, 0], "evidenceRole": "exact-present plate ownership and identity pose; no land or depth evidence",
                "members": [
                    {"path": STATIC.name, "bytes": PINNED[STATIC.name][0], "sha256": PINNED[STATIC.name][1]},
                    {"path": ROTATIONS.name, "bytes": PINNED[ROTATIONS.name][0], "sha256": PINNED[ROTATIONS.name][1]},
                ],
            },
        ],
        "geometryProcessing": {
            "operation": "Natural Earth 50m Panama minus the emitted Cao shapes_coasts chart footprint active at 0 Ma, intersected with six pinned Cao static polygons",
            "emittedNativeChartIds": list(EXPECTED_NATIVE_CHARTS),
            "nativeOverlapPrecedence": "emit only the source-classified missing land; retain native coast charts and evidence wherever Cao already supplies land",
            "shorelineMismatchHandling": "no buffer or inferred bridge; retain source-scale Boolean fragments and require no measurable native overlap",
            "countryReferenceImplication": "the land applicator does not alter country:pan; a separately integrated exact-0 reference repair may complete its modern locator while historical reference charts remain unchanged",
            "waterSemantics": "no shelf, shallow-water, palaeoshoreline, or bathymetric claim",
            "roundingDecimalDegrees": 6,
            "platePartitions": partition_rows,
        },
        "features": feature_contracts,
        "rejectionConditions": [
            "a chart is active at any age greater than 0 Ma",
            "the source is relabeled shallow marine or used as bathymetry",
            "the correction overlaps native present land beyond numerical tolerance",
            "a static partition identity, plate, valid time, ordered geometry, or pinned source digest changes",
            "country:pan is silently treated as repaired",
            "any public generated package is written without an explicit staged compositor",
        ],
    }
    report = {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "ageWitnesses": {"activeMa": [0], "inactiveMa": [0.000001, 1, 5, 74]},
        "sourceGeometry": {
            "projection": "spherical local Lambert azimuthal equal-area centered at 8.6N, 80.1W",
            "naturalEarthAreaSquareKilometres": round(area_km2(panama), 3),
            "naturalEarthBounds": [round(value, 6) for value in panama.bounds],
            "naturalEarthComponentCount": count_geometry(panama)[0],
            "naturalEarthVertexCount": count_geometry(panama)[1],
            "nativeLandAreaWithinPanamaSquareKilometres": round(area_km2(native_land), 3),
            "nativeLandCoverageFraction": round(area_km2(native_land) / area_km2(panama), 8),
            "nativeShelfAreaWithinPanamaSquareKilometres": round(area_km2(native_shelf), 3),
            "missingLandAreaSquareKilometres": round(area_km2(missing), 3),
            "correctionAreaSquareKilometres": round(area_km2(correction), 3),
            "correctionComponentCount": count_geometry(correction)[0],
            "correctionVertexCount": count_geometry(correction)[1],
            "partitionGapSquareKilometres": round(partition_gap, 6),
            "partitionPairOverlapSquareKilometres": round(pair_overlap, 9),
            "nativeOverlapSquareKilometres": round(native_overlap, 9),
            "fullOverlayComparison": {
                "areaSquareKilometres": round(area_km2(panama), 3),
                "nativeDuplicateAreaSquareKilometres": round(area_km2(native_land), 3),
                "decision": "rejected because it duplicates native land and obscures native source precedence",
            },
        },
        "partitions": partition_rows,
        "geometry": {"path": GEOMETRY_NAME, "bytes": len(geometry_bytes), "sha256": geometry_sha},
    }
    return geometry, contract, report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=OUT)
    parser.add_argument("--report", type=Path, default=REPORT)
    args = parser.parse_args()
    geometry, contract, report = build()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    geometry_path = args.output_dir / GEOMETRY_NAME
    contract_path = args.output_dir / "source-contract.json"
    geometry_path.write_bytes(canonical(geometry))
    contract_path.write_bytes(canonical(contract))
    report["contract"] = {"path": contract_path.name, "bytes": contract_path.stat().st_size, "sha256": sha(contract_path)}
    args.report.write_bytes(canonical(report))
    print(json.dumps({"geometry": str(geometry_path), "contract": str(contract_path), "report": str(args.report),
                      "features": len(geometry["features"]), "geometryBytes": geometry_path.stat().st_size}))


if __name__ == "__main__":
    main()
