#!/usr/bin/env python3
"""Audit Cao continental-outline coverage, lifecycle identity, and render clearance.

This research command needs pyGPlates and the pinned external Cao v2.4 source
pool.  ``--spatial`` additionally needs Shapely 2 and NumPy.  It is diagnostic:
it never edits the source package or public assets.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import struct
from pathlib import Path

import pygplates
import cao_package_intern as package_intern


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
)
EARTH_RADIUS_KM = 6371.0088
EARTH_RADIUS_METRES = 6_371_000
SHELF_SHELL_METRES = 80
AGES = (0, 409, 410, 410.000001, 411, 420, 422)
SOURCE_FILES = (
    "shapes_continents.gpmlz",
    "shapes_coasts.gpmlz",
    "COBfile_1800_0.gpml",
)


def polygons(feature: pygplates.Feature) -> list[pygplates.PolygonOnSphere]:
    return [
        geometry
        for geometry in feature.get_all_geometries()
        if isinstance(geometry, pygplates.PolygonOnSphere)
    ]


def geometry_digest(geometry: pygplates.PolygonOnSphere) -> str:
    payload = bytearray()
    for point in geometry.get_points():
        payload.extend(struct.pack("<ddd", *point.to_xyz()))
    return hashlib.sha256(payload).hexdigest()


def finite_valid_time(valid_time: tuple[float, float]) -> list[float]:
    oldest, youngest = valid_time
    return [
        min(1800.0, oldest if math.isfinite(oldest) else 1800.0),
        max(0.0, youngest if math.isfinite(youngest) else 0.0),
    ]


def file_identity(path: Path) -> dict[str, object]:
    payload = path.read_bytes()
    return {"bytes": len(payload), "sha256": hashlib.sha256(payload).hexdigest()}


def source_rows(path: Path) -> dict[str, list[dict[str, object]]]:
    result: dict[str, list[dict[str, object]]] = collections.defaultdict(list)
    for source_order, feature in enumerate(pygplates.FeatureCollection(str(path))):
        for geometry_order, geometry in enumerate(polygons(feature)):
            result[str(feature.get_feature_id())].append(
                {
                    "sourceOrder": source_order,
                    "geometryOrder": geometry_order,
                    "name": feature.get_name() or None,
                    "plateId": feature.get_reconstruction_plate_id(None),
                    "featureType": str(feature.get_feature_type()).split(":")[-1],
                    "validTimeMa": finite_valid_time(feature.get_valid_time()),
                    "vertices": len(geometry.get_points()),
                    "geometrySha256": geometry_digest(geometry),
                    "sphericalAreaKm2": round(geometry.get_area() * EARTH_RADIUS_KM**2, 1),
                }
            )
    return result


def contains(outer: list[float], inner: list[float]) -> bool:
    return outer[1] <= inner[1] and outer[0] >= inner[0]


def active(valid_time: list[float], age_ma: float) -> bool:
    return valid_time[1] <= age_ma <= valid_time[0]


def lifecycle_audit(model: Path) -> dict[str, object]:
    compiled = source_rows(model / "shapes_continents.gpmlz")
    authority = source_rows(model / "COBfile_1800_0.gpml")
    exact: list[dict[str, object]] = []
    for feature_id, compiled_rows in compiled.items():
        authority_rows = authority.get(feature_id, [])
        used: set[int] = set()
        for compiled_row in compiled_rows:
            matches = [
                (index, row)
                for index, row in enumerate(authority_rows)
                if index not in used
                and row["geometrySha256"] == compiled_row["geometrySha256"]
            ]
            if len(matches) != 1:
                continue
            index, authority_row = matches[0]
            used.add(index)
            if any(
                compiled_row[key] != authority_row[key]
                for key in ("name", "plateId", "featureType")
            ):
                continue
            exact.append(
                {
                    "featureId": feature_id,
                    "name": compiled_row["name"],
                    "plateId": compiled_row["plateId"],
                    "featureType": compiled_row["featureType"],
                    "sphericalAreaKm2": compiled_row["sphericalAreaKm2"],
                    "compiledValidTimeMa": compiled_row["validTimeMa"],
                    "cobValidTimeMa": authority_row["validTimeMa"],
                    "geometrySha256": compiled_row["geometrySha256"],
                }
            )
    mismatches = [
        row
        for row in exact
        if row["compiledValidTimeMa"] != row["cobValidTimeMa"]
    ]
    cob_superset = [
        row
        for row in mismatches
        if contains(row["cobValidTimeMa"], row["compiledValidTimeMa"])
    ]
    compiled_superset = [
        row
        for row in mismatches
        if contains(row["compiledValidTimeMa"], row["cobValidTimeMa"])
    ]
    age_mismatches = {}
    for age in AGES:
        rows = [
            row
            for row in mismatches
            if active(row["compiledValidTimeMa"], age)
            != active(row["cobValidTimeMa"], age)
        ]
        age_mismatches[str(age)] = {
            "count": len(rows),
            "compiledInactiveCobActive": sum(
                not active(row["compiledValidTimeMa"], age)
                and active(row["cobValidTimeMa"], age)
                for row in rows
            ),
            "compiledActiveCobInactive": sum(
                active(row["compiledValidTimeMa"], age)
                and not active(row["cobValidTimeMa"], age)
                for row in rows
            ),
            "featureIds": [row["featureId"] for row in rows],
        }
    return {
        "sourceInventory": {
            "compiledFeatureIds": len(compiled),
            "compiledPolygons": sum(map(len, compiled.values())),
            "cobFeatureIds": len(authority),
            "cobPolygons": sum(map(len, authority.values())),
            "exactGeometryAndSemanticMatches": len(exact),
            "changedMissingOrSemanticMismatch": sum(map(len, compiled.values())) - len(exact),
        },
        "lifecycleMismatchCount": len(mismatches),
        "cobSupersetCount": len(cob_superset),
        "compiledSupersetCount": len(compiled_superset),
        "ageMismatches": age_mismatches,
        "cobSupersetCandidates": cob_superset,
        "compiledSupersetCandidates": compiled_superset,
    }


def triangle_minimum_radius(a: tuple[float, ...], b: tuple[float, ...], c: tuple[float, ...]) -> float:
    # Closest point on a triangle to the origin, from Real-Time Collision Detection.
    ab = tuple(b[i] - a[i] for i in range(3))
    ac = tuple(c[i] - a[i] for i in range(3))
    ap = tuple(-a[i] for i in range(3))
    dot = lambda u, v: sum(u[i] * v[i] for i in range(3))
    d1, d2 = dot(ab, ap), dot(ac, ap)
    if d1 <= 0 and d2 <= 0:
        return math.sqrt(dot(a, a))
    bp = tuple(-b[i] for i in range(3))
    d3, d4 = dot(ab, bp), dot(ac, bp)
    if d3 >= 0 and d4 <= d3:
        return math.sqrt(dot(b, b))
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        v = d1 / (d1 - d3)
        point = tuple(a[i] + v * ab[i] for i in range(3))
        return math.sqrt(dot(point, point))
    cp = tuple(-c[i] for i in range(3))
    d5, d6 = dot(ab, cp), dot(ac, cp)
    if d6 >= 0 and d5 <= d6:
        return math.sqrt(dot(c, c))
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        w = d2 / (d2 - d6)
        point = tuple(a[i] + w * ac[i] for i in range(3))
        return math.sqrt(dot(point, point))
    va = d3 * d6 - d5 * d4
    if va <= 0 and d4 - d3 >= 0 and d5 - d6 >= 0:
        w = (d4 - d3) / ((d4 - d3) + (d5 - d6))
        point = tuple(b[i] + w * (c[i] - b[i]) for i in range(3))
        return math.sqrt(dot(point, point))
    denominator = 1 / (va + vb + vc)
    v, w = vb * denominator, vc * denominator
    point = tuple(a[i] + ab[i] * v + ac[i] * w for i in range(3))
    return math.sqrt(dot(point, point))


def clearance_audit(package: Path) -> dict[str, object]:
    core = package_intern.read_package_json(package / "core.json")
    batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-shelf")
    raw = (package / batch["geometryAsset"]["url"]).read_bytes()
    vertex_count, triangle_count = struct.unpack_from("<II", raw, 8)
    offset = 32
    directions = [
        struct.unpack_from("<fff", raw, offset + index * 12)
        for index in range(vertex_count)
    ]
    offset += vertex_count * 12 + vertex_count * 4
    chart_indices = struct.unpack_from(f"<{vertex_count}I", raw, offset)
    offset += vertex_count * 4
    indices = struct.unpack_from(f"<{triangle_count * 3}I", raw, offset)
    shell_radius = 1 + SHELF_SHELL_METRES / EARTH_RADIUS_METRES
    bad_by_chart: collections.Counter[int] = collections.Counter()
    minimum = math.inf
    native_triangles = 0
    for triangle in range(triangle_count):
        vertex_indices = indices[triangle * 3 : triangle * 3 + 3]
        chart_index = chart_indices[vertex_indices[0]]
        if not core["charts"][chart_index]["chartId"].startswith("cao-continent:"):
            continue
        native_triangles += 1
        radius = triangle_minimum_radius(
            *(directions[index] for index in vertex_indices)
        ) * shell_radius
        minimum = min(minimum, radius)
        if radius <= 1:
            bad_by_chart[chart_index] += 1
    required_shell = (1 / (minimum / shell_radius) - 1) * EARTH_RADIUS_METRES
    ages = {}
    for age in AGES:
        active_charts = {
            index
            for index in bad_by_chart
            if active(
                [
                    core["charts"][index]["lifecycle"]["validTimeMa"]["oldest"],
                    core["charts"][index]["lifecycle"]["validTimeMa"]["youngest"],
                ],
                age,
            )
        }
        ages[str(age)] = {
            "chartsBelowUnitSphereEnvelope": len(active_charts),
            "trianglesBelowUnitSphereEnvelope": sum(
                bad_by_chart[index] for index in active_charts
            ),
        }
    return {
        "asset": batch["geometryAsset"],
        "nativeTriangles": native_triangles,
        "evaluatedPreFixShellMetres": SHELF_SHELL_METRES,
        "minimumDisplayedRadius": minimum,
        "minimumClearanceShellMetres": required_shell,
        "chartsBelowUnitSphereEnvelope": len(bad_by_chart),
        "trianglesBelowUnitSphereEnvelope": sum(bad_by_chart.values()),
        "ages": ages,
    }


def spatial_audit(model: Path) -> dict[str, object]:
    import numpy as np
    import shapely
    from shapely.geometry import Polygon

    rotations = pygplates.RotationModel(
        [str(model / "1000_0_rotfile.rot"), str(model / "1800_1000_rotfile.rot")],
        default_anchor_plate_id=0,
    )
    longitudes = np.tile(np.arange(-179.5, 180, 1.0), 180)
    latitudes = np.repeat(np.arange(-89.5, 90, 1.0), 360)
    weights = np.cos(np.deg2rad(latitudes))
    cell_area = 4 * math.pi * EARTH_RADIUS_KM**2 / weights.sum()

    def reconstructed(path: Path, age_ma: float) -> list[pygplates.PolygonOnSphere]:
        rows = []
        pygplates.reconstruct(
            pygplates.FeatureCollection(str(path)), rotations, rows, age_ma, anchor_plate_id=0
        )
        return [
            row.get_reconstructed_geometry()
            for row in rows
            if isinstance(row.get_reconstructed_geometry(), pygplates.PolygonOnSphere)
        ]

    def coverage(source: list[pygplates.PolygonOnSphere]):
        mask = np.zeros(longitudes.shape, dtype=bool)
        for geometry in source:
            coordinates = np.array(
                [(longitude, latitude) for latitude, longitude in
                 (point.to_lat_lon() for point in geometry.get_points())],
                dtype=float,
            )
            coordinates[:, 0] = np.rad2deg(np.unwrap(np.deg2rad(coordinates[:, 0])))
            polygon = Polygon(coordinates)
            if polygon.is_empty:
                continue
            minimum_x, minimum_y, maximum_x, maximum_y = polygon.bounds
            for shift in (-360, 0, 360):
                selected = (
                    (longitudes >= minimum_x + shift)
                    & (longitudes <= maximum_x + shift)
                    & (latitudes >= minimum_y)
                    & (latitudes <= maximum_y)
                    & ~mask
                )
                if np.any(selected):
                    mask[selected] = shapely.contains_xy(
                        polygon, longitudes[selected] - shift, latitudes[selected]
                    )
        return mask

    def area(mask) -> int:
        return round(float(np.sum(weights[mask]) * cell_area))

    regions = {
        "North America": lambda lon, lat: (lon >= -170) & (lon <= -50) & (lat >= 5) & (lat <= 83),
        "South America": lambda lon, lat: (lon >= -90) & (lon <= -30) & (lat >= -60) & (lat <= 15),
        "Africa": lambda lon, lat: (lon >= -20) & (lon <= 55) & (lat >= -40) & (lat <= 38),
        "Eurasia": lambda lon, lat: (lon >= -15) & (lat >= 0) & (lat <= 82),
        "Australia": lambda lon, lat: (lon >= 110) & (lon <= 180) & (lat >= -48) & (lat <= -10),
        "Antarctica": lambda lon, lat: lat <= -60,
    }
    result = {}
    for age_ma in (0, 422):
        shelf = coverage(reconstructed(model / "shapes_continents.gpmlz", age_ma))
        coast = coverage(reconstructed(model / "shapes_coasts.gpmlz", age_ma))
        row = {
            "shelfUnion": area(shelf),
            "coastUnion": area(coast),
            "overlap": area(shelf & coast),
            "shelfOnly": area(shelf & ~coast),
            "coastOnly": area(coast & ~shelf),
        }
        if age_ma == 0:
            row["shelfOnlyByBroadRegion"] = {
                name: area(test(longitudes, latitudes) & shelf & ~coast)
                for name, test in regions.items()
            }
        result[str(age_ma)] = row
    return {
        "method": (
            "one-degree lon/lat cell centers weighted by cosine latitude; "
            "reconstructed pyGPlates polygon union; approximate diagnostic, "
            "not bathymetric area"
        ),
        "squareKilometres": result,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument(
        "--package", type=Path, default=ROOT / "public/data/reconstruction/cao-v2.4"
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--spatial", action="store_true")
    args = parser.parse_args()
    report = {
        "schemaVersion": 1,
        "model": "Cao et al. 2024 v2.4",
        "sourceContext": {
            "record": "https://doi.org/10.5281/zenodo.13628813",
            "license": "CC BY 4.0",
            "retrievedAt": "2026-09-09",
            "frame": {
                "absoluteFrameId": "palaeomagnetic",
                "anchorPlateId": 0,
                "axisConvention": "gplates-x0e-y90e-znorth",
            },
        },
        "sources": {name: file_identity(args.model / name) for name in SOURCE_FILES},
        "lifecycle": lifecycle_audit(args.model),
        "clearance": clearance_audit(args.package),
    }
    if args.spatial:
        report["spatialSampling"] = spatial_audit(args.model)
    payload = json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n"
    if args.output:
        args.output.write_text(payload)
    else:
        print(payload, end="")


if __name__ == "__main__":
    main()
