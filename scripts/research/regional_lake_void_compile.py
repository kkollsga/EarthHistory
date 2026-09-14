#!/usr/bin/env python3
"""Compile the lake-void infill correction from the Cao v2.4 layers and Natural Earth lakes.

The Cao v2.4 coastline layer excludes the large modern lakes from every coast
polygon, while the continental-outline underlay still covers them, so the
compiled package draws each lake as a shallow-sea hole in the land at every age
of the owning plate's lifecycle. A present-day lake outline is not evidence of
water in deep time.

This compiler identifies those voids with Natural Earth 1:10m lakes, emits the
Cao void geometry itself (continental outline minus coast, restricted to the
lake's connected component) as a land-appearance correction chart, and gives
each chart a lifecycle from the lake's cited onset age to the oldest age of the
native coast charts around it. A lake without a curated onset defaults to
present-only: the void reads as water only at exactly 0 Ma and the infill is
active at every older age. It never adds a lake, water depth or shoreline
claim; the present-day appearance is unchanged.

Run with the pinned pyGPlates + Shapely environment (see docs/research).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import pygplates
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.validation import make_valid


ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study"
MODEL = POOL / "plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
LAKES = POOL / "geography/natural-earth-lakes/ne_10m_lakes.geojson"
COASTS = MODEL / "shapes_coasts.gpmlz"
CONTINENTS = MODEL / "shapes_continents.gpmlz"
STATIC = MODEL / "static_polygons.gpmlz"
ROTATIONS = MODEL / "1000_0_rotfile.rot"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
OUT = ROOT / "data/corrections/lake-voids"
ONSETS = OUT / "lake-onsets.json"
REPORT = ROOT / "docs/research/regional-lake-void-infill-validation.json"

CORRECTION_ID = "earthhistory-lake-void-infill-v1"
GEOMETRY_NAME = "lake-voids-v1.geojson"
MANIFEST_NAME = "lake-voids-manifest.json"
EARTH_RADIUS_KM = 6371.0088
PACKAGE_OLDEST_MA = 1800.0

# Selection policy: a lake is a void when at least half of it lies outside every
# Cao coast polygon; a void component is emitted only when the lake occupies it,
# so the infill never spills into open shelf or over native land.
MIN_LAKE_KM2 = 100.0
MIN_VOID_FRACTION = 0.5
MIN_COMPONENT_LAKE_FRACTION = 0.6
MIN_EMITTED_PART_KM2 = 25.0
CLIP_BUFFER_DEGREES = 0.02
POLAR_LIMIT_DEGREES = 84.0
MAX_LONGITUDE_SPAN_DEGREES = 180.0

PINNED = {
    "ne_10m_lakes.geojson": (5043554, "2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9"),
    "shapes_coasts.gpmlz": (1860295, "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"),
    "shapes_continents.gpmlz": (1243843, "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"),
    "static_polygons.gpmlz": (2248936, "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f"),
    "1000_0_rotfile.rot": (625128, "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"),
}
NATURAL_EARTH_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson"
NATURAL_EARTH_RETRIEVED = "2026-09-14"


class BuildError(ValueError):
    pass


def canonical(value: object) -> bytes:
    return (json.dumps(value, indent=1, sort_keys=True, ensure_ascii=False) + "\n").encode()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(path: Path) -> None:
    size, digest = PINNED[path.name]
    if not path.is_file() or path.stat().st_size != size or sha(path) != digest:
        raise BuildError(f"pinned input changed or missing: {path}")


def polygon_parts(geometry):
    if geometry.is_empty:
        return []
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    if hasattr(geometry, "geoms"):
        parts = []
        for part in geometry.geoms:
            parts.extend(polygon_parts(part))
        return parts
    return []


def polygonal(geometry):
    parts = [part for part in polygon_parts(make_valid(geometry)) if not part.is_empty and part.area > 0]
    if not parts:
        return Polygon()
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def ring_area_km2(coords) -> float:
    points = [pygplates.PointOnSphere(lat, lon) for lon, lat in list(coords)[:-1]]
    if len(points) < 3:
        return 0.0
    return pygplates.PolygonOnSphere(points).get_area() * EARTH_RADIUS_KM ** 2


def area_km2(geometry) -> float:
    total = 0.0
    for part in polygon_parts(geometry):
        total += ring_area_km2(part.exterior.coords)
        for interior in part.interiors:
            total -= ring_area_km2(interior.coords)
    return abs(total)


def load_collection(path: Path, prefix: str):
    rows = []
    for order, feature in enumerate(pygplates.FeatureCollection(str(path))):
        begin, end = feature.get_valid_time()
        if not (begin >= 0 >= end):
            continue
        plate = feature.get_reconstruction_plate_id(None)
        feature_id = feature.get_feature_id().get_string()
        for geometry_index, geometry in enumerate(feature.get_geometries()):
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            exterior = [(point.to_lat_lon()[1], point.to_lat_lon()[0])
                        for point in geometry.get_exterior_ring_points()]
            interiors = [[(point.to_lat_lon()[1], point.to_lat_lon()[0])
                          for point in geometry.get_interior_ring_points(index)]
                         for index in range(geometry.get_number_of_interior_rings())]
            if len(exterior) < 3:
                continue
            longitudes = [position[0] for position in exterior]
            if max(longitudes) - min(longitudes) > MAX_LONGITUDE_SPAN_DEGREES:
                continue
            rows.append({
                "featureId": feature_id, "plateId": plate, "sourceOrder": order,
                "geometryIndex": geometry_index, "name": feature.get_name(None),
                "validTimeMa": [begin, end], "chartId": f"{prefix}:{feature_id}:{order}:{geometry_index}",
                "geometry": make_valid(Polygon(exterior, interiors)),
            })
    return rows


def slug(name: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return text or "unnamed"


def rounded_geometry(geometry):
    def ring(coords):
        out = []
        for lon, lat in coords:
            position = [round(lon, 6), round(lat, 6)]
            if not out or out[-1] != position:
                out.append(position)
        if out[0] != out[-1]:
            out.append(list(out[0]))
        return out if len(out) >= 4 else None
    parts = []
    for part in polygon_parts(geometry):
        if area_km2(part) < MIN_EMITTED_PART_KM2:
            continue
        exterior = ring(part.exterior.coords)
        if exterior is None:
            continue
        holes = [hole for hole in (ring(interior.coords) for interior in part.interiors) if hole]
        parts.append([exterior, *holes])
    if not parts:
        return None
    if len(parts) == 1:
        return {"type": "Polygon", "coordinates": parts[0]}
    return {"type": "MultiPolygon", "coordinates": parts}


def build() -> tuple[dict, dict, dict]:
    for path in (LAKES, COASTS, CONTINENTS, STATIC, ROTATIONS):
        verify(path)
    rotation_model = pygplates.RotationModel(str(ROTATIONS), default_anchor_plate_id=0)
    core = json.loads((PUBLIC / "core.json").read_text())
    charts = {chart["chartId"]: chart for chart in core["charts"]}
    palette = json.loads((PUBLIC / "motion-palette.json").read_text())
    palette_plates = {entry["plateId"] for entry in palette["entries"]
                      if entry["youngestAgeMa"] <= 0 <= entry["oldestAgeMa"]}
    onsets = json.loads(ONSETS.read_text()) if ONSETS.is_file() else {"lakes": []}
    onset_by_name = {row["lake"]: row for row in onsets.get("lakes", [])}

    coasts = load_collection(COASTS, "cao-coast")
    continents = load_collection(CONTINENTS, "cao-continent")
    statics = load_collection(STATIC, "static")
    missing = [row["chartId"] for row in coasts if row["chartId"] not in charts]
    if len(missing) > 20:
        raise BuildError(f"{len(missing)} native coast chart ids are not in the public core; id scheme changed")
    coast_tree = STRtree([row["geometry"] for row in coasts])
    continent_tree = STRtree([row["geometry"] for row in continents])
    static_tree = STRtree([row["geometry"] for row in statics])

    lakes = json.loads(LAKES.read_text())
    features = []
    skipped = []
    used_names: dict[str, int] = {}
    for index, source in enumerate(lakes["features"]):
        properties = source.get("properties", {})
        name = properties.get("name") or properties.get("name_alt") or f"unnamed-{index}"
        lake = polygonal(shape(source["geometry"]))
        if lake.is_empty:
            continue
        lake_area = area_km2(lake)
        if lake_area < MIN_LAKE_KM2:
            continue
        bounds = lake.bounds
        reason = None
        if abs(bounds[1]) > POLAR_LIMIT_DEGREES or abs(bounds[3]) > POLAR_LIMIT_DEGREES:
            reason = "planar Boolean is not valid across the pole"
        elif bounds[2] - bounds[0] > MAX_LONGITUDE_SPAN_DEGREES:
            reason = "planar Boolean is not valid across the antimeridian"
        near_coasts = [coasts[i] for i in coast_tree.query(lake)] if reason is None else []
        covered = polygonal(unary_union([row["geometry"] for row in near_coasts]).intersection(lake)) \
            if near_coasts else Polygon()
        void = polygonal(lake.difference(covered)) if not covered.is_empty else lake
        void_area = area_km2(void)
        if reason is None and void_area / lake_area < MIN_VOID_FRACTION:
            continue  # Cao already treats the lake as land; nothing to fill.
        near_continents = [continents[i] for i in continent_tree.query(lake)] if reason is None else []
        if reason is None and not near_continents:
            reason = "no Cao continental-outline polygon covers the lake"
        component_geometry = Polygon()
        if reason is None:
            underlay = unary_union([row["geometry"] for row in near_continents])
            coast_union = unary_union([row["geometry"] for row in near_coasts]) if near_coasts else Polygon()
            window = lake.buffer(2.0)
            local_void = polygonal(underlay.intersection(window).difference(coast_union))
            kept = []
            for component in polygon_parts(local_void):
                overlap = polygonal(component.intersection(lake))
                if overlap.is_empty:
                    continue
                if area_km2(overlap) / max(area_km2(component), 1e-9) >= MIN_COMPONENT_LAKE_FRACTION:
                    kept.append(component)
                else:
                    kept.append(polygonal(component.intersection(lake.buffer(CLIP_BUFFER_DEGREES))))
            component_geometry = polygonal(unary_union(kept)) if kept else Polygon()
            if component_geometry.is_empty:
                reason = "the void has no component inside the continental-outline underlay"
        if reason is not None:
            skipped.append({"lake": name, "naturalEarthIndex": index,
                            "lakeAreaSquareKilometres": round(lake_area, 3),
                            "voidAreaSquareKilometres": round(void_area, 3), "reason": reason})
            continue
        # Cookie-cut the void by the present Cao static partitions so each piece
        # moves with its own plate exactly as the native charts around it do.
        grouped: dict[tuple[int, int], list] = {}
        for static_index in static_tree.query(component_geometry):
            partition = statics[static_index]
            piece = polygonal(component_geometry.intersection(partition["geometry"]))
            if piece.is_empty:
                continue
            # A static feature with several geometries is one partition identity.
            grouped.setdefault((partition["plateId"], partition["sourceOrder"]), [partition, []])[1].append(piece)
        pieces = []
        for key in sorted(grouped):
            partition, parts = grouped[key]
            piece = polygonal(unary_union(parts))
            if piece.is_empty or area_km2(piece) < MIN_EMITTED_PART_KM2:
                continue
            pieces.append((partition, piece))
        if not pieces:
            skipped.append({"lake": name, "naturalEarthIndex": index,
                            "lakeAreaSquareKilometres": round(lake_area, 3),
                            "voidAreaSquareKilometres": round(void_area, 3),
                            "reason": "no present static partition owns an emitted-size piece of the void"})
            continue
        base = slug(name)
        used_names[base] = used_names.get(base, 0) + 1
        lake_identifier = f"lake-void-{base}" + (f"-{used_names[base]}" if used_names[base] > 1 else "")
        onset = onset_by_name.get(name)
        for partition, piece in pieces:
            plate = partition["plateId"]
            piece_row = {"lake": name, "naturalEarthIndex": index, "plateId": plate,
                         "pieceAreaSquareKilometres": round(area_km2(piece), 3)}
            if plate not in palette_plates:
                skipped.append(piece_row | {"reason": f"plate {plate} has no qualified 0 Ma palette binding"})
                continue
            _, _, angle = rotation_model.get_rotation(0, plate, anchor_plate_id=0) \
                .get_lat_lon_euler_pole_and_angle_degrees()
            if abs(angle) > 1e-12:
                raise BuildError(f"plate {plate}: 0 Ma rotation is not identity")
            touching = sorted({row["chartId"] for row in near_coasts
                               if row["chartId"] in charts and row["geometry"].distance(piece) < 0.05})
            same_plate = [c for c in touching if plate in {e["plateId"] for e in palette["entries"]
                          if e["entryId"] in {b["entryId"] for b in charts[c]["motionBindings"]}}]
            if not touching:
                skipped.append(piece_row | {"reason": "no emitted native coast chart touches the piece"})
                continue
            geometry = rounded_geometry(piece)
            if geometry is None:
                skipped.append(piece_row | {"reason": "rounded piece collapsed below the emitted part bound"})
                continue
            lifecycle_charts = same_plate or touching
            native_oldest = min(charts[c]["lifecycle"]["validTimeMa"]["oldest"] for c in lifecycle_charts)
            oldest = float(min(native_oldest, partition["validTimeMa"][0], PACKAGE_OLDEST_MA))
            youngest = float(onset["onsetMa"]) if onset else 0.0
            if youngest >= oldest:
                skipped.append(piece_row | {"reason": f"onset {youngest} Ma is not younger than native oldest {oldest} Ma"})
                continue
            identifier = f"{lake_identifier}-plate-{plate}-{partition['sourceOrder']}"
            emitted_area = area_km2(shape(geometry))
            features.append({
                "type": "Feature", "id": identifier,
                "properties": {
                    "correctionFeatureId": identifier, "lake": name, "naturalEarthIndex": index,
                    "plateId": plate, "staticSourceOrder": partition["sourceOrder"],
                    "staticFeatureId": partition["featureId"], "touchingNativeCoastChartIds": touching,
                    "lifecycleNativeCoastChartIds": lifecycle_charts,
                    "geometryReferenceAgeMa": 0, "coordinateFrame": "WGS84-reference-coordinates",
                    "surfaceClass": "land", "sourceClass": "cao-void-inside-continental-outline",
                    "lakeAreaSquareKilometres": round(lake_area, 3),
                    "voidAreaSquareKilometres": round(void_area, 3),
                    "emittedAreaSquareKilometres": round(emitted_area, 3),
                    "validTimeMa": {"youngest": youngest, "oldest": oldest, "youngestExclusive": True},
                    "onset": ({"ageMa": youngest, "uncertaintyMa": onset.get("uncertaintyMa"),
                               "evidence": onset.get("evidence"), "sourceIds": onset.get("sourceIds", [])}
                              if onset else {"ageMa": 0, "evidence": "present-only default",
                                             "sourceIds": ["natural-earth-lakes-10m"]}),
                },
                "geometry": geometry,
            })
    if not features:
        raise BuildError("no lake void found")
    features.sort(key=lambda row: row["id"])
    geojson = {"type": "FeatureCollection", "name": CORRECTION_ID, "features": features}
    return geojson, {"skipped": skipped}, onsets


def manifest_for(geojson: dict, report: dict, onsets: dict, geometry_path: Path) -> dict:
    features = []
    for row in geojson["features"]:
        properties = row["properties"]
        lifecycle = properties["validTimeMa"]
        onset_sources = properties["onset"]["sourceIds"]
        features.append({
            "correctionFeatureId": row["id"],
            "lake": properties["lake"],
            "coordinateFrame": "WGS84-reference-coordinates",
            "geometryReferenceAgeMa": 0,
            "epistemicStatus": "model-inference",
            "materialRole": "lake-void-infill",
            "phaseLifecycles": {"qualified": {"validTimeMa": {"youngest": lifecycle["youngest"],
                                                             "oldest": lifecycle["oldest"]},
                                              "youngestExclusive": True}},
            "onset": properties["onset"],
            "pose": {"plateId": properties["plateId"], "method": "cao-rigid-plate-motion",
                     "sourceOrHypothesis": "owning Cao static partition; the infill shares the plate motion of the native coast charts around the void",
                     "sourceFeatureId": properties["staticFeatureId"],
                     "sourceOrder": properties["staticSourceOrder"],
                     "touchingNativeCoastChartIds": properties["touchingNativeCoastChartIds"],
                     "warning": "the lake outline is a present-day observation; its onset age is a cited or default lifecycle, never a reconstructed shoreline"},
            "geometryAsset": {"path": geometry_path.name, "featureId": row["id"],
                              "bytes": geometry_path.stat().st_size, "sha256": sha(geometry_path)},
            "surfaceEvidence": {"kind": "unknown",
                                "reason": "land inferred from the surrounding Cao coast charts before the lake existed; exposure and height unknown"},
            "uncertainty": {"spatial": "Cao void outline at generalized model resolution; no shoreline claim",
                            "temporal": ("cited lake onset with recorded uncertainty" if onset_sources != ["natural-earth-lakes-10m"]
                                         else "present-only default: the lake is shown only at exactly 0 Ma"),
                            "exposure": "model inference; not observed exposed land"},
            "sourceIds": ["natural-earth-lakes-10m", "cao-v2.4-native-coasts", "cao-v2.4-native-continents",
                          "cao-v2.4-static-partitions", *onset_sources],
            "rejectionConditions": [
                "the infill is active at 0 Ma",
                "the infill is active younger than its cited onset",
                "the infill overlaps a native coast polygon beyond numerical tolerance",
                "the owning static partition, plate, or touching coast chart identity changes",
                "the infill is drawn with a water, shelf, or bathymetric meaning",
            ],
        })
    return {
        "schemaVersion": 1, "version": "1", "correctionId": CORRECTION_ID,
        "attribution": "Made with Natural Earth; Cao et al. (2024).",
        "baseline": {
            "modelId": "cao-et-al-2024", "modelVersion": "2.4",
            "coastSourceSha256": PINNED["shapes_coasts.gpmlz"][1],
            "continentSourceSha256": PINNED["shapes_continents.gpmlz"][1],
            "staticSourceSha256": PINNED["static_polygons.gpmlz"][1],
            "rotationSourceSha256": PINNED["1000_0_rotfile.rot"][1],
            "coordinateFrame": {"absoluteFrameId": "palaeomagnetic", "anchorPlateId": 0,
                                "axisConvention": "gplates-x0e-y90e-znorth"},
            "defect": "large modern lakes lie outside every Cao coast polygon but inside the continental-outline underlay, so they render as shallow-sea holes at every age of the owning plate",
        },
        "sourceAssets": [
            {"sourceId": "natural-earth-lakes-10m", "title": "Natural Earth 1:10m Lakes", "url": NATURAL_EARTH_URL,
             "citation": "Natural Earth. Free vector and raster map data at naturalearthdata.com (nvkelso/natural-earth-vector GitHub mirror).",
             "publicationOrVersionDate": "5.1.2", "license": "Public domain", "attribution": "Made with Natural Earth.",
             "retrievedAt": NATURAL_EARTH_RETRIEVED, "evidenceRole": "present-day lake extent",
             "geographicBasis": "WGS84 generalized present-day lake polygons", "temporalRangeMa": [0, 0],
             "bytes": PINNED["ne_10m_lakes.geojson"][0], "sha256": PINNED["ne_10m_lakes.geojson"][1]},
            {"sourceId": "cao-v2.4-native-coasts", "title": "Cao et al. (2024) v2.4 shapes_coasts.gpmlz",
             "url": "https://doi.org/10.5281/zenodo.13628813", "citation": "Cao, X. et al. (2024) Geoscience Frontiers, model v2.4",
             "publicationOrVersionDate": "2.4", "license": "CC BY 4.0", "attribution": "Cao et al. (2024)",
             "retrievedAt": "2026-09-09", "evidenceRole": "model coastline-class land proxy",
             "geographicBasis": "Cao palaeomagnetic frame, anchor plate 0, geometry at 0 Ma",
             "bytes": PINNED["shapes_coasts.gpmlz"][0], "sha256": PINNED["shapes_coasts.gpmlz"][1]},
            {"sourceId": "cao-v2.4-native-continents", "title": "Cao et al. (2024) v2.4 shapes_continents.gpmlz",
             "url": "https://doi.org/10.5281/zenodo.13628813", "citation": "Cao, X. et al. (2024) Geoscience Frontiers, model v2.4",
             "publicationOrVersionDate": "2.4", "license": "CC BY 4.0", "attribution": "Cao et al. (2024)",
             "retrievedAt": "2026-09-09", "evidenceRole": "model continental-outline underlay",
             "geographicBasis": "Cao palaeomagnetic frame, anchor plate 0, geometry at 0 Ma",
             "bytes": PINNED["shapes_continents.gpmlz"][0], "sha256": PINNED["shapes_continents.gpmlz"][1]},
            {"sourceId": "cao-v2.4-static-partitions", "title": "Cao et al. (2024) v2.4 static polygons and rotations",
             "url": "https://doi.org/10.5281/zenodo.13628813", "citation": "Cao, X. et al. (2024) Geoscience Frontiers, model v2.4",
             "publicationOrVersionDate": "2.4", "license": "CC BY 4.0", "attribution": "Cao et al. (2024)",
             "retrievedAt": "2026-09-09", "evidenceRole": "present plate ownership and rigid motion",
             "geographicBasis": "Cao palaeomagnetic frame, anchor plate 0",
             "members": [{"path": "static_polygons.gpmlz", "bytes": PINNED["static_polygons.gpmlz"][0],
                          "sha256": PINNED["static_polygons.gpmlz"][1]},
                         {"path": "1000_0_rotfile.rot", "bytes": PINNED["1000_0_rotfile.rot"][0],
                          "sha256": PINNED["1000_0_rotfile.rot"][1]}]},
        ],
        "onsetPolicy": {
            "default": "present-only: a lake without a curated onset shows as water only at exactly 0 Ma",
            "curatedOnsets": onsets.get("lakes", []),
            "curatedSourceIds": sorted({s for row in onsets.get("lakes", []) for s in row.get("sourceIds", [])}),
        },
        "geometryProcessing": {
            "operation": "Cao continental-outline underlay minus the Cao coast polygons active at 0 Ma, restricted to the connected void components that a Natural Earth 1:10m lake occupies",
            "selectionPolicy": {"minimumLakeSquareKilometres": MIN_LAKE_KM2, "minimumVoidFraction": MIN_VOID_FRACTION,
                                "minimumComponentLakeFraction": MIN_COMPONENT_LAKE_FRACTION,
                                "minimumEmittedPartSquareKilometres": MIN_EMITTED_PART_KM2,
                                "clipBufferDegrees": CLIP_BUFFER_DEGREES},
            "nativeOverlapPrecedence": "retain native coast charts and evidence; the infill only fills the void between them",
            "waterSemantics": "no lake, shelf, shallow-water, palaeoshoreline, or bathymetric claim; the present-day void keeps the model's own shelf class",
            "countryReferenceImplication": "the infill does not alter any country reference chart",
            "roundingDecimalDegrees": 6,
            "skippedLakes": report["skipped"],
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()
    geojson, report, onsets = build()
    args.out.mkdir(parents=True, exist_ok=True)
    geometry_path = args.out / GEOMETRY_NAME
    geometry_path.write_bytes(canonical(geojson))
    manifest = manifest_for(geojson, report, onsets, geometry_path)
    (args.out / MANIFEST_NAME).write_bytes(canonical(manifest))
    summary = {
        "features": len(geojson["features"]), "skipped": len(report["skipped"]),
        "emittedAreaSquareKilometres": round(sum(row["properties"]["emittedAreaSquareKilometres"]
                                                 for row in geojson["features"]), 3),
        "lakes": [(row["properties"]["lake"], row["properties"]["plateId"], row["properties"]["validTimeMa"])
                  for row in geojson["features"]],
        "skippedReasons": sorted({row["reason"] for row in report["skipped"]}),
    }
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
