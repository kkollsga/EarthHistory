#!/usr/bin/env python3
"""Compile a bounded exact-modern Iceland shallow-marine source correction.

Natural Earth's L_0 and K_200 bathymetry polygons define the source geometry.
The K_200 layer is a deeper-water polygon, so the local shallow-water geometry
is L_0 minus K_200. Natural Earth describes this contour as coast-buffered and
manually generalized; it is a nominal cartographic 0--200 m class, not a set of
measured depths or a palaeoshoreline.

Run with the pinned pyGPlates environment and Shapely on PYTHONPATH.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import struct
import zipfile
from pathlib import Path

import pygplates
from shapely.geometry import GeometryCollection, LineString, MultiPolygon, Polygon, box, mapping
from shapely.ops import split, unary_union
from shapely.validation import make_valid


ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study"
SOURCE = POOL / "verification/regional-iceland-shallow-shelf-v1/source-inputs"
MODEL = POOL / "plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
OUT = ROOT / "data/corrections/iceland-shallow-shelf"
REPORT = ROOT / "docs/research/regional-iceland-shallow-shelf-validation.json"

L0_NAME = "ne_10m_bathymetry_L_0"
K200_NAME = "ne_10m_bathymetry_K_200"
GEOMETRY_NAME = "iceland-shallow-marine-v1.geojson"
CONTRACT_NAME = "source-contract.json"
CORRECTION_ID = "earthhistory-regional-iceland-shallow-marine-v1"
SOURCE_ID = "natural-earth-bathymetry-10m-l0-k200-v4.1.0"
VERSION = "4.1.0"
SIMPLIFY_DEGREES = 0.005
EARTH_RADIUS_KM = 6371.0
PLATE_IDS = (101, 301)
RIDGE_IDS = (
    "GPlates-0830a0e7-382a-4fe4-989c-02e27dab7c91",
    "GPlates-9a090a65-e45a-4bb0-9876-a106dfc0664a",
)
ICELAND_ENVELOPE = (-27.0, 63.0, -11.5, 67.5)
FRAME = {
    "absoluteFrameId": "palaeomagnetic",
    "anchorPlateId": 0,
    "axisConvention": "gplates-x0e-y90e-znorth",
    "rotationSha256": "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f",
    "topologySha256": "3a3021b8d60bbcff64ce4018198a5693ddc018de7a5a8b3c30c33a48d51c044c",
}
SOURCE_PINS = {
    f"{L0_NAME}.zip": (3_000_229, "3a950927bde293cd7a59e2618a9ee99cff1ad8422a886e9e8b47538a1de6f36b"),
    f"{K200_NAME}.zip": (1_197_185, "68fe55b9ac57bd8255696d83259f5856594a60c582dd395de9c1772179337887"),
}
MODEL_PINS = {
    "250-0_plate_boundaries.gpml": "4a9f97f6368860e5917f4e6fbf78d6d7c3caf77e1736e854250d067540bb60d4",
    "TopologyBuildingBlocks.gpml": "7603af2502a8d261256f293be71487d28fe5a6b5a8fadd4bdc7845dc67b72297",
    "1000_0_rotfile.rot": "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c",
}


class BuildError(ValueError):
    pass


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest(path: Path) -> str:
    return digest_bytes(path.read_bytes())


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


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
        raise BuildError("polygon processing removed the complete Iceland shallow-water source")
    return unary_union(parts)


def signed_ring_area(ring) -> float:
    return sum(left[0] * right[1] - right[0] * left[1]
               for left, right in zip(ring, [*ring[1:], ring[0]])) / 2


def read_shapefile_polygons(payload: bytes):
    """Read polygon records without making pyshp a clean-checkout dependency."""
    if len(payload) < 100 or struct.unpack(">i", payload[:4])[0] != 9994:
        raise BuildError("Natural Earth shapefile header changed")
    declared_bytes = struct.unpack(">i", payload[24:28])[0] * 2
    if declared_bytes != len(payload) or struct.unpack("<i", payload[32:36])[0] != 5:
        raise BuildError("Natural Earth shapefile length or polygon type changed")
    offset = 100
    output = []
    while offset < len(payload):
        if offset + 8 > len(payload):
            raise BuildError("truncated Natural Earth shapefile record header")
        _, content_words = struct.unpack(">2i", payload[offset:offset + 8])
        offset += 8
        content = payload[offset:offset + content_words * 2]
        offset += content_words * 2
        if len(content) < 44 or struct.unpack("<i", content[:4])[0] != 5:
            raise BuildError("unexpected Natural Earth shapefile record type")
        part_count, point_count = struct.unpack("<2i", content[36:44])
        part_end = 44 + part_count * 4
        point_end = part_end + point_count * 16
        if part_count < 1 or point_count < 4 or point_end != len(content):
            raise BuildError("malformed Natural Earth polygon record")
        starts = list(struct.unpack(f"<{part_count}i", content[44:part_end]))
        points = [tuple(value) for value in struct.iter_unpack("<2d", content[part_end:point_end])]
        rings = []
        for index, start in enumerate(starts):
            end = starts[index + 1] if index + 1 < len(starts) else len(points)
            ring = points[start:end]
            if len(ring) < 4 or ring[0] != ring[-1]:
                raise BuildError("Natural Earth polygon ring is not closed")
            rings.append(ring[:-1])
        outers = [Polygon(ring) for ring in rings if signed_ring_area(ring) < 0]
        holes = [Polygon(ring) for ring in rings if signed_ring_area(ring) > 0]
        if not outers or len(outers) + len(holes) != len(rings):
            raise BuildError("Natural Earth ring orientation changed")
        made = []
        assigned_holes = set()
        for outer_index, outer in enumerate(outers):
            members = []
            for hole_index, hole in enumerate(holes):
                if outer.covers(hole.representative_point()):
                    members.append(list(hole.exterior.coords))
                    assigned_holes.add(hole_index)
            made.append(Polygon(outer.exterior.coords, members))
        if len(assigned_holes) != len(holes):
            raise BuildError("Natural Earth polygon hole lost its exterior")
        output.extend(polygons_only(unary_union(made)))
    if offset != len(payload):
        raise BuildError("Natural Earth shapefile record framing changed")
    return output


def dbf_depths(payload: bytes) -> set[int]:
    if len(payload) < 33:
        raise BuildError("Natural Earth DBF is truncated")
    records = struct.unpack("<I", payload[4:8])[0]
    header_bytes, record_bytes = struct.unpack("<HH", payload[8:12])
    fields = []
    offset = 32
    cursor = 1
    while offset < header_bytes and payload[offset] != 0x0D:
        descriptor = payload[offset:offset + 32]
        name = descriptor[:11].split(b"\0", 1)[0].decode("ascii")
        width = descriptor[16]
        fields.append((name, cursor, width))
        cursor += width
        offset += 32
    depth = next((item for item in fields if item[0].lower() == "depth"), None)
    if depth is None or cursor != record_bytes:
        raise BuildError("Natural Earth DBF fields changed")
    values = set()
    for index in range(records):
        row = payload[header_bytes + index * record_bytes:header_bytes + (index + 1) * record_bytes]
        if len(row) != record_bytes or row[0:1] not in {b" ", b"*"}:
            raise BuildError("Natural Earth DBF record framing changed")
        if row[0:1] == b"*":
            continue
        _, start, width = depth
        values.add(int(row[start:start + width].decode("ascii").strip()))
    return values


def load_layer(path: Path, stem: str, expected_depth: int):
    expected_bytes, expected_sha = SOURCE_PINS[path.name]
    if not path.is_file() or path.stat().st_size != expected_bytes or digest(path) != expected_sha:
        raise BuildError(f"{path.name}: pinned Natural Earth archive identity changed")
    with zipfile.ZipFile(path) as archive:
        members = set(archive.namelist())
        required = {f"{stem}.VERSION.txt", f"{stem}.shp", f"{stem}.dbf", f"{stem}.prj"}
        if not required.issubset(members):
            raise BuildError(f"{path.name}: required members changed")
        version = archive.read(f"{stem}.VERSION.txt").decode("ascii").strip()
        projection = archive.read(f"{stem}.prj").decode("ascii")
        depths = dbf_depths(archive.read(f"{stem}.dbf"))
        polygons = read_shapefile_polygons(archive.read(f"{stem}.shp"))
    if version != VERSION or depths != {expected_depth} or "WGS_1984" not in projection:
        raise BuildError(f"{path.name}: version, depth class, or WGS84 frame changed")
    return polygons


def source_geometry(source_dir: Path):
    local = box(*ICELAND_ENVELOPE)
    l0 = unary_union([polygon.intersection(local) for polygon in load_layer(
        source_dir / f"{L0_NAME}.zip", L0_NAME, 0
    ) if polygon.intersects(local)])
    k200 = unary_union([polygon.intersection(local) for polygon in load_layer(
        source_dir / f"{K200_NAME}.zip", K200_NAME, 200
    ) if polygon.intersects(local)])
    candidates = sorted(polygons_only(make_valid(l0.difference(k200))), key=lambda part: part.area, reverse=True)
    if len(candidates) < 1:
        raise BuildError("Natural Earth L_0 minus K_200 has no Iceland candidate")
    geometry = candidates[0]
    # These bounds identify the single Iceland component and reject neighboring
    # islands or a source-topology change without inventing a buffer.
    expected_bounds = (-26.753285, 63.150824, -11.869252, 67.261115)
    if any(abs(actual - expected) > 0.000002 for actual, expected in zip(geometry.bounds, expected_bounds)):
        raise BuildError(f"Iceland K_200 component bounds changed: {geometry.bounds}")
    if not isinstance(geometry, Polygon) or len(geometry.interiors) != 7:
        raise BuildError("Iceland K_200 component topology changed")
    return geometry


def verify_model(path: Path) -> None:
    if not path.is_file() or digest(path) != MODEL_PINS[path.name]:
        raise BuildError(f"{path.name}: pinned Cao model identity changed")


def resolved_partition():
    paths = (MODEL / "250-0_plate_boundaries.gpml", MODEL / "TopologyBuildingBlocks.gpml")
    rotation_path = MODEL / "1000_0_rotfile.rot"
    for path in (*paths, rotation_path):
        verify_model(path)
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
    ridge, owners = {}, {}
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
    return LineString([*ridge[RIDGE_IDS[0]], *ridge[RIDGE_IDS[1]][1:]]), topologies, owners


def plate_for(point, topologies) -> int:
    matches = [plate for plate, polygon in topologies.items()
               if polygon.is_point_in_polygon(pygplates.PointOnSphere(point.y, point.x))]
    if len(matches) != 1:
        raise BuildError(f"partition witness {point.x:.6f},{point.y:.6f} has owners {matches}")
    return matches[0]


def split_by_plate(geometry, ridge, topologies):
    assigned = {plate: [] for plate in PLATE_IDS}
    for piece in polygons_only(split(geometry, ridge)):
        assigned[plate_for(piece.representative_point(), topologies)].append(piece)
    result = {plate: normalized_polygonal(unary_union(parts)) for plate, parts in assigned.items() if parts}
    if set(result) != set(PLATE_IDS):
        raise BuildError("Iceland shelf source did not produce both Cao plate pieces")
    recombined = unary_union(list(result.values()))
    if geometry.symmetric_difference(recombined).area > 1e-8 or result[101].intersection(result[301]).area > 1e-10:
        raise BuildError("Cao plate split changed Iceland shelf geometry")
    return result


def rounded(value):
    if isinstance(value, (tuple, list)):
        return [rounded(item) for item in value]
    return round(float(value), 6)


def geometry_json(geometry) -> dict:
    value = mapping(geometry)
    return {"type": value["type"], "coordinates": rounded(value["coordinates"])}


def polygon_vertex_count(geometry) -> int:
    return sum(len(polygon.exterior.coords) - 1
               + sum(len(ring.coords) - 1 for ring in polygon.interiors)
               for polygon in polygons_only(geometry))


def spherical_area_km2(geometry) -> float:
    total = 0.0
    for polygon in polygons_only(geometry):
        rings = [polygon.exterior, *polygon.interiors]
        areas = []
        for ring in rings:
            points = [(latitude, longitude) for longitude, latitude in list(ring.coords)[:-1]]
            areas.append(pygplates.PolygonOnSphere(points).get_area() * EARTH_RADIUS_KM ** 2)
        total += areas[0] - sum(areas[1:])
    return total


def feature_id(plate: int) -> str:
    return f"iceland-shallow-marine-plate-{plate}"


def build(source_dir: Path, out_dir: Path, report_path: Path) -> None:
    raw = source_geometry(source_dir)
    simplified = normalized_polygonal(raw.simplify(SIMPLIFY_DEGREES, preserve_topology=True))
    raw_area = spherical_area_km2(raw)
    simplified_area = spherical_area_km2(simplified)
    relative_area_error = abs(simplified_area - raw_area) / raw_area
    hausdorff = raw.hausdorff_distance(simplified)
    if relative_area_error > 0.0002 or hausdorff > SIMPLIFY_DEGREES + 1e-12:
        raise BuildError("Iceland shelf simplification exceeded its error contract")
    ridge, topologies, owners = resolved_partition()
    pieces = split_by_plate(simplified, ridge, topologies)

    out_dir.mkdir(parents=True, exist_ok=True)
    geometry_path = out_dir / GEOMETRY_NAME
    features = [{
        "type": "Feature",
        "id": feature_id(plate),
        "properties": {
            "correctionFeatureId": feature_id(plate),
            "plateId": plate,
            "sourceId": SOURCE_ID,
            "surfaceClass": "shallow-marine",
            "validTimeMa": {"youngest": 0, "oldest": 0},
        },
        "geometry": geometry_json(pieces[plate]),
    } for plate in PLATE_IDS]
    geometry_path.write_bytes(canonical({
        "type": "FeatureCollection",
        "name": "Iceland generalized nominal 0-200 m shallow-marine context",
        "features": features,
    }))
    geometry_asset = {
        "path": GEOMETRY_NAME,
        "bytes": geometry_path.stat().st_size,
        "sha256": digest(geometry_path),
    }
    feature_contracts = []
    for plate in PLATE_IDS:
        feature_contracts.append({
            "correctionFeatureId": feature_id(plate),
            "coordinateFrame": "WGS84-reference-coordinates",
            "geometryAsset": {**geometry_asset, "featureId": feature_id(plate)},
            "geometryReferenceAgeMa": 0,
            "epistemicStatus": "cartographic-generalization",
            "materialRole": "generalized-modern-shallow-marine-context",
            "phaseLifecycles": {"classified-shallow-marine": {
                "validTimeMa": {"youngest": 0, "oldest": 0},
            }},
            "pose": {
                "method": "cao-rigid-plate-motion",
                "plateId": plate,
                "sourceOrHypothesis": "Cao v2.4 present resolved topology partition at exact 0 Ma",
                "warning": "The plate split carries source identity only; this exact-modern chart is never backdated.",
            },
            "sourceIds": [SOURCE_ID],
            "surfaceEvidence": {
                "kind": "classified",
                "surfaceClass": "shallow-marine",
                "sourceIds": [SOURCE_ID],
            },
            "uncertainty": {
                "spatial": "Natural Earth 1:10m cartographic generalization; K_200 is coast-buffered and island, seamount and steep-slope isobaths are manually generalized",
                "temporal": "exact modern reference only",
                "depth": "nominal 0-200 m class; not a measured depth at every point and not the full morphological shelf to about 400 m",
                "exposure": "classified modern shallow marine; no palaeoshoreline or historical exposure inference",
            },
        })
    contract = {
        "schemaVersion": 1,
        "version": "1",
        "correctionId": CORRECTION_ID,
        "attribution": "Made with Natural Earth.",
        "sourceAssets": [{
            "sourceId": SOURCE_ID,
            "title": "Natural Earth 1:10m Bathymetry L_0 and K_200",
            "url": "https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-bathymetry/",
            "publicationOrVersionDate": "embedded archive version 4.1.0; product page individual-download labels remain 4.0.0",
            "retrievedAt": "2026-09-12",
            "license": "Public domain",
            "attribution": "Made with Natural Earth",
            "geographicBasis": "WGS84 nested cartographic bathymetry polygons derived from SRTM Plus",
            "temporalRangeMa": [0, 0],
            "evidenceRole": "L_0 minus K_200 defines generalized nominal modern 0-200 m shallow-marine context",
            "members": [{"path": name, "bytes": values[0], "sha256": values[1]}
                        for name, values in SOURCE_PINS.items()],
        }],
        "references": [{
            "sourceId": "hardarson-et-al-2008",
            "citation": "Hardarson, Fitton & Hjartarson (2008), Tertiary volcanism in Iceland",
            "url": "https://jokull.jorfi.is/articles/jokull2008.58/jokull2008.58.161.pdf",
            "publicationOrVersionDate": "2008",
            "retrievedAt": "2026-09-12",
            "license": "citation only; no article content redistributed",
            "geographicBasis": "Iceland and its insular shelf",
            "temporalRangeMa": [16.3, 0],
            "evidenceRole": "modern 50-200 km insular-shelf and about-400 m morphological boundary; exposed-rock chronology and ridge jumps reject simple monotonic outline growth",
        }, {
            "sourceId": "hafro-southern-shelf-slopes-2026",
            "citation": "Marine and Freshwater Research Institute (2026), Southern Shelf Slopes technical report",
            "url": "https://www.hafogvatn.is/static/extras/images/area_shl_2026_techreport_en.html",
            "publicationOrVersionDate": "2026-06-10",
            "retrievedAt": "2026-09-12",
            "license": "citation only; no report content redistributed",
            "geographicBasis": "southern Iceland shelf and shelf break",
            "temporalRangeMa": [0, 0],
            "evidenceRole": "irregular modern shelf with 110-200 m banks and troughs to 370 m; rejects a uniform shoreline buffer",
        }],
        "geometryProcessing": {
            "operation": "largest Iceland component of Natural Earth L_0 ocean minus K_200 deeper-water union; topology-preserving simplification; exact Cao 0 Ma ridge split",
            "depthSemantics": "generalized nominal 0-200 m shallow-marine context",
            "coastlineMismatchHandling": "use Natural Earth L_0 from the same embedded release as K_200; render the independently sourced Natural Earth 1:50m Iceland land above the shelf; do not buffer or snap either source",
            "deeperPocketPolicy": "preserve every K_200 component and hole so enclosed nominal >200 m water remains outside the shallow class",
            "simplificationToleranceDegrees": SIMPLIFY_DEGREES,
            "platePartition": {
                "method": "pygplates.resolve_topologies at 0 Ma, split at exact shared ridge subsegments",
                "plateIds": list(PLATE_IDS),
                "ridgeFeatureIds": list(RIDGE_IDS),
                "ridgeSharingPlateIds": owners,
            },
        },
        "features": feature_contracts,
        "rejectionConditions": [
            "source archive bytes, embedded version, WGS84 declaration or depth attribute changes",
            "L_0-minus-K_200 Iceland topology, area or bounds changes beyond the recorded source/simplification contract",
            "an enclosed K_200 deeper-water pocket is painted shallow marine",
            "the generalized shallow-marine chart is active at any age greater than 0 Ma",
            "a chart claims measured point depth, the full about-400 m morphological shelf, palaeoshoreline or historical exposure",
            "a geometry piece is not assigned to Cao plate 101 or 301",
            "the independently sourced modern land is clipped, buffered or reinterpreted by this shelf correction",
        ],
    }
    contract_path = out_dir / CONTRACT_NAME
    contract_path.write_bytes(canonical(contract))
    report = {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "sourceGeometry": {
            "bounds": [round(value, 6) for value in raw.bounds],
            "componentCount": 1,
            "holeCount": len(raw.interiors),
            "rawVertexCount": polygon_vertex_count(raw),
            "rawAreaSquareKilometres": round(raw_area, 3),
            "simplifiedVertexCount": polygon_vertex_count(simplified),
            "simplifiedAreaSquareKilometres": round(simplified_area, 3),
            "relativeAreaError": round(relative_area_error, 9),
            "hausdorffDistanceDegrees": round(hausdorff, 9),
            "plateVertexCounts": {str(plate): polygon_vertex_count(pieces[plate]) for plate in PLATE_IDS},
            "plateAreasSquareKilometres": {str(plate): round(spherical_area_km2(pieces[plate]), 3)
                                            for plate in PLATE_IDS},
        },
        "ageWitnesses": {"activeMa": [0], "inactiveMa": [0.000001, 0.001, 1, 16.3]},
        "geometry": geometry_asset,
        "contract": {"path": CONTRACT_NAME, "bytes": contract_path.stat().st_size,
                     "sha256": digest(contract_path)},
        "sourceArchives": {name: {"bytes": values[0], "sha256": values[1], "embeddedVersion": VERSION}
                           for name, values in SOURCE_PINS.items()},
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(canonical(report))
    print(json.dumps({"geometry": geometry_asset, "report": str(report_path),
                      "vertices": report["sourceGeometry"]["plateVertexCounts"],
                      "areasKm2": report["sourceGeometry"]["plateAreasSquareKilometres"]}))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=SOURCE)
    parser.add_argument("--out-dir", type=Path, default=OUT)
    parser.add_argument("--report", type=Path, default=REPORT)
    args = parser.parse_args()
    build(args.source_dir.resolve(), args.out_dir.resolve(), args.report.resolve())


if __name__ == "__main__":
    main()
