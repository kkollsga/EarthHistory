#!/usr/bin/env python3
"""Compare the original and simplified palaeo-coastline payloads piece by piece.

``palaeo_coastlines_compile.py`` writes two EHPR v1 payload sets: ``original``
(cookie-cut, every node) in the offline store and ``simplified`` (node-reduced)
in the staging directory. This harness decodes both, measures what the node
reduction cost, and writes

* a summary record to ``dev-docs/bench/results/palaeo-coastlines-qc.json``
  (small: per class and per interval, never per piece);
* the full per-piece table and the side-by-side SVG overlays to the offline
  store's ``qc/`` directory, which is bounded and has a named cleanup owner.

Measured per piece: node counts before and after, spherical area error, the
Hausdorff distance between the two outlines, and whether the piece was
protected, retained unsimplified or lost. Measured per transect: the length of
the narrow-feature witnesses (Viking Graben, Central Graben, Moray Firth,
Zechstein margin) that falls inside the class, before and after.

Run with the pinned pyGPlates environment.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import shapely
from shapely.geometry import LineString
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import palaeo_coastlines_audit as audit  # noqa: E402
import palaeo_coastlines_compile as compile_module  # noqa: E402


ROOT = compile_module.ROOT
CONFIG = compile_module.CONFIG
STORE = compile_module.STORE
RESULTS = ROOT / "dev-docs/bench/results/palaeo-coastlines-qc.json"
DEGREE_KM = 2.0 * math.pi * audit.EARTH_RADIUS_KM / 360.0

OVERLAY_WINDOWS = [
    {"windowId": "north-sea", "bbox": [-6.0, 52.0, 12.0, 63.0],
     "intervalIds": ["269-248", "166-146"],
     "reason": "the protected basin window and its narrow-feature witnesses"},
    {"windowId": "western-interior-seaway", "bbox": [-118.0, 28.0, -82.0, 62.0],
     "intervalIds": ["94-81"],
     "reason": "the plan's shallow-marine witness at its maximum transgression"},
    {"windowId": "tethys", "bbox": [55.0, 5.0, 115.0, 48.0],
     "intervalIds": ["94-81", "166-146"],
     "reason": "the Tibetan override plates and the Tethyan Himalaya witness"},
]
OVERLAY_COLOURS = {"lm": "#3c7a3c", "sm": "#2f6f9f", "m": "#8a5a2b"}


class QcError(ValueError):
    pass


def great_circle_length_km(line) -> float:
    total = 0.0
    for first, second in zip(list(line.coords), list(line.coords)[1:]):
        total += audit.great_circle_km(audit_point(first), audit_point(second))
    return total


def audit_point(position):
    import pygplates
    return pygplates.PointOnSphere(position[1], position[0])


def outline_deviation_degrees(source, kept) -> float:
    """How far the outline actually moved, in degrees.

    ``shapely.hausdorff_distance`` is the *discrete* Hausdorff distance: it
    compares vertex sets, so deleting a redundant vertex from a long straight
    edge reports the length of that edge even though the two outlines coincide.
    Measured with that metric a 202 km2 island and a removed collinear vertex both
    read as 1.8 degrees. What matters here is the largest distance from any
    original vertex to the simplified outline, which for Douglas-Peucker is the
    deviation the tolerance allows; the reverse direction is measured too because
    a retained component makes neither vertex set a subset of the other.
    """
    if kept.is_empty or source.is_empty:
        return float("nan")
    worst = 0.0
    for first, second in ((source, kept), (kept, source)):
        coordinates = shapely.get_coordinates(first)
        if coordinates.size == 0:
            continue
        distances = shapely.distance(shapely.points(coordinates), second.boundary)
        worst = max(worst, float(distances.max()))
    return worst


def load_pair(store: Path, class_name: str, interval_id: str) -> tuple[dict, dict]:
    name = f"palaeo-{class_name}-{interval_id}.ehpr"
    original = compile_module.decode_ehpr((store / "original" / class_name / name).read_bytes())
    simplified = compile_module.decode_ehpr((store / "staging" / class_name / name).read_bytes())
    return original, simplified


def piece_key(piece: dict) -> tuple:
    return (piece["chartIndex"], piece["bindingIndex"], piece["evidenceIndex"],
            piece["lifecycleIndex"])


def pair_pieces(original: dict, simplified: dict) -> tuple[list[tuple[dict, dict]], list[dict]]:
    """Pair pieces by position; a piece the simplified payload dropped is reported.

    Both payloads are written from the same ordered piece list, so the simplified
    table is a subsequence of the original one. Where the keys disagree the
    original piece was lost at quantisation and the pointer advances.
    """
    pairs: list[tuple[dict, dict]] = []
    lost: list[dict] = []
    cursor = 0
    for piece in simplified["pieces"]:
        while cursor < len(original["pieces"]) and piece_key(original["pieces"][cursor]) != piece_key(piece):
            lost.append(original["pieces"][cursor])
            cursor += 1
        if cursor >= len(original["pieces"]):
            raise QcError("the simplified piece table is not a subsequence of the original one")
        pairs.append((original["pieces"][cursor], piece))
        cursor += 1
    lost.extend(original["pieces"][cursor:])
    return pairs, lost


def measure_interval(store: Path, class_name: str, interval: dict,
                     transects: list[dict]) -> tuple[dict, list[dict]]:
    original, simplified = load_pair(store, class_name, interval["intervalId"])
    pairs, lost = pair_pieces(original, simplified)
    rows: list[dict] = []
    source_area = 0.0
    kept_area = 0.0
    original_vertices = 0
    simplified_vertices = 0
    worst_hausdorff = 0.0
    original_geometries = []
    simplified_geometries = []
    for source_piece, kept_piece in pairs:
        source = compile_module.piece_geometry(original, source_piece)
        kept = compile_module.piece_geometry(simplified, kept_piece)
        original_geometries.append(source)
        simplified_geometries.append(kept)
        source_value = audit.area_km2(source)
        kept_value = audit.area_km2(kept)
        source_nodes = int(shapely.get_coordinates(source).shape[0])
        kept_nodes = int(shapely.get_coordinates(kept).shape[0])
        hausdorff = outline_deviation_degrees(source, kept)
        source_area += source_value
        kept_area += kept_value
        original_vertices += source_nodes
        simplified_vertices += kept_nodes
        if hausdorff == hausdorff:
            worst_hausdorff = max(worst_hausdorff, hausdorff)
        rows.append({
            "intervalId": interval["intervalId"], "class": class_name,
            "chartIndex": kept_piece["chartIndex"], "flags": kept_piece["flags"],
            "originalNodes": source_nodes, "simplifiedNodes": kept_nodes,
            "originalAreaSquareKilometres": round(source_value, 4),
            "simplifiedAreaSquareKilometres": round(kept_value, 4),
            "areaErrorPercent": round(100.0 * (kept_value - source_value) / source_value, 6)
                                if source_value else 0.0,
            "hausdorffDegrees": round(hausdorff, 6),
            "hausdorffKilometresUpperBound": round(hausdorff * DEGREE_KM, 4),
        })
    witness_rows = []
    for transect in transects:
        line = LineString(transect["transect"])
        window = shapely.box(*line.bounds).buffer(1.0)
        near_original = [geometry for geometry in original_geometries if geometry.intersects(window)]
        near_simplified = [geometry for geometry in simplified_geometries if geometry.intersects(window)]
        before = inside_length_km(line, near_original)
        after = inside_length_km(line, near_simplified)
        witness_rows.append({
            "witnessId": transect["witnessId"], "class": class_name,
            "intervalId": interval["intervalId"],
            "originalInsideKilometres": round(before, 4),
            "simplifiedInsideKilometres": round(after, 4),
            "changeKilometres": round(abs(after - before), 4),
        })
    summary = {
        "intervalId": interval["intervalId"],
        "pieces": len(pairs),
        "lostPieces": len(lost),
        "largestLostPieceNodes": max((int(sum(count for _, count, _ in piece["rings"]))
                                      for piece in lost), default=0),
        "originalVertices": original_vertices,
        "simplifiedVertices": simplified_vertices,
        "vertexReductionPercent": round(
            100.0 * (original_vertices - simplified_vertices) / original_vertices, 3)
            if original_vertices else 0.0,
        "originalAreaSquareKilometres": round(source_area, 3),
        "simplifiedAreaSquareKilometres": round(kept_area, 3),
        "areaErrorPercent": round(100.0 * (kept_area - source_area) / source_area, 6)
                            if source_area else 0.0,
        "worstHausdorffDegrees": round(worst_hausdorff, 6),
        "worstHausdorffKilometresUpperBound": round(worst_hausdorff * DEGREE_KM, 4),
        "worstPieceAreaErrorPercent": round(
            max((abs(row["areaErrorPercent"]) for row in rows), default=0.0), 6),
        "narrowFeatureWitnesses": witness_rows,
    }
    return summary, rows


SIZE_BANDS = ((25.0, 100.0), (100.0, 1000.0), (1000.0, 10000.0), (10000.0, 1e6), (1e6, float("inf")))


def size_band_rows(rows: list[dict]) -> list[dict]:
    """Where the per-piece area error lives by piece size.

    A piece near the 25 km2 cookie-cut floor is only a few int16 grid cells wide,
    so quantisation alone can move its area by tens of percent while the class
    total stays at a thousandth of a percent. This table is the measurement of
    that, not an excuse for it: it says how small a piece has to be before the
    payload's own precision, rather than the node reduction, sets its error.
    """
    bands = []
    for low, high in SIZE_BANDS:
        selected = [row for row in rows
                    if low <= row["originalAreaSquareKilometres"] < high]
        if not selected:
            continue
        errors = sorted(abs(row["areaErrorPercent"]) for row in selected)
        bands.append({
            "minimumSquareKilometres": low,
            "maximumSquareKilometres": None if high == float("inf") else high,
            "pieces": len(selected),
            "medianAbsoluteAreaErrorPercent": round(errors[len(errors) // 2], 6),
            "percentile95AbsoluteAreaErrorPercent": round(errors[int(len(errors) * 0.95)], 6),
            "worstAbsoluteAreaErrorPercent": round(errors[-1], 6),
            "areaSquareKilometres": round(sum(row["originalAreaSquareKilometres"]
                                              for row in selected), 3),
        })
    return bands


def protection_control(store: Path, class_name: str, interval_id: str, transects: list[dict],
                       config: dict) -> list[dict]:
    """What the protected North Sea window buys, measured rather than assumed.

    The narrow-feature gate would be vacuous on its own: every piece inside the
    window is emitted unsimplified, so the measured width change is exactly zero.
    This control simplifies the same original pieces at the configured baseline
    tolerance and measures the width change that protection avoided, so the gate's
    threshold is calibrated against a real number.
    """
    name = f"palaeo-{class_name}-{interval_id}.ehpr"
    path = store / "original" / class_name / name
    if not path.is_file():
        return []
    original = compile_module.decode_ehpr(path.read_bytes())
    tolerance = config["areaClasses"][0]["toleranceDegrees"]
    rows = []
    for transect in transects:
        line = LineString(transect["transect"])
        window = shapely.box(*line.bounds).buffer(1.0)
        near = []
        for piece in original["pieces"]:
            geometry = compile_module.piece_geometry(original, piece)
            if geometry.intersects(window):
                near.append(geometry)
        if not near:
            continue
        reduced = [compile_module.polygonal(geometry.simplify(tolerance, preserve_topology=True))
                   for geometry in near]
        before = inside_length_km(line, near)
        after = inside_length_km(line, reduced)
        rows.append({"witnessId": transect["witnessId"], "class": class_name,
                     "intervalId": interval_id, "toleranceDegrees": tolerance,
                     "protectedInsideKilometres": round(before, 4),
                     "unprotectedInsideKilometres": round(after, 4),
                     "changeKilometres": round(abs(after - before), 4)})
    return rows


def inside_length_km(line: LineString, geometries: list) -> float:
    if not geometries:
        return 0.0
    merged = compile_module.polygonal(unary_union(geometries))
    if merged.is_empty:
        return 0.0
    inside = line.intersection(merged)
    if inside.is_empty:
        return 0.0
    parts = [inside] if isinstance(inside, LineString) else list(getattr(inside, "geoms", []))
    total = 0.0
    for part in parts:
        if isinstance(part, LineString) and len(part.coords) >= 2:
            total += great_circle_length_km(part)
    return total


def write_overlay(path: Path, window: dict, class_name: str, interval_id: str,
                  original: list, simplified: list) -> None:
    minimum_lon, minimum_lat, maximum_lon, maximum_lat = window["bbox"]
    width = 900.0
    height = width * (maximum_lat - minimum_lat) / (maximum_lon - minimum_lon)

    def path_data(geometries) -> str:
        commands = []
        for geometry in geometries:
            for part in compile_module.polygon_parts(geometry):
                for ring in [part.exterior, *part.interiors]:
                    points = []
                    for lon, lat in ring.coords:
                        x = (lon - minimum_lon) / (maximum_lon - minimum_lon) * width
                        y = height - (lat - minimum_lat) / (maximum_lat - minimum_lat) * height
                        points.append(f"{x:.2f},{y:.2f}")
                    if len(points) >= 3:
                        commands.append("M" + "L".join(points) + "Z")
        return "".join(commands)

    colour = OVERLAY_COLOURS[class_name]
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" '
        f'width="{width:.0f}" height="{height:.0f}">',
        '<rect width="100%" height="100%" fill="#f7f7f5"/>',
        f'<path d="{path_data(original)}" fill="{colour}" fill-opacity="0.25" '
        f'stroke="{colour}" stroke-width="0.6" fill-rule="evenodd"/>',
        f'<path d="{path_data(simplified)}" fill="none" stroke="#c0392b" stroke-width="0.9" '
        f'fill-rule="evenodd"/>',
        f'<text x="8" y="18" font-family="system-ui,sans-serif" font-size="13" fill="#222">'
        f'{window["windowId"]} · {class_name} · {interval_id} Ma · filled = original, '
        f'red line = simplified</text>',
        "</svg>",
    ]
    path.write_text("\n".join(svg))


def build_overlays(store: Path, classes: list[str], out: Path) -> list[dict]:
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for window in OVERLAY_WINDOWS:
        box = shapely.box(*window["bbox"])
        for interval_id in window["intervalIds"]:
            for class_name in classes:
                name = f"palaeo-{class_name}-{interval_id}.ehpr"
                source_path = store / "original" / class_name / name
                if not source_path.is_file():
                    continue
                original = compile_module.decode_ehpr(source_path.read_bytes())
                simplified = compile_module.decode_ehpr(
                    (store / "staging" / class_name / name).read_bytes())
                original_geometries = []
                simplified_geometries = []
                for piece in original["pieces"]:
                    geometry = compile_module.piece_geometry(original, piece)
                    if geometry.intersects(box):
                        original_geometries.append(compile_module.polygonal(geometry.intersection(box)))
                for piece in simplified["pieces"]:
                    geometry = compile_module.piece_geometry(simplified, piece)
                    if geometry.intersects(box):
                        simplified_geometries.append(compile_module.polygonal(geometry.intersection(box)))
                if not original_geometries:
                    continue
                path = out / f"palaeo-{class_name}-{window['windowId']}-{interval_id}.svg"
                write_overlay(path, window, class_name, interval_id,
                              original_geometries, simplified_geometries)
                written.append({"windowId": window["windowId"], "class": class_name,
                                "intervalId": interval_id, "path": path.name,
                                "bytes": path.stat().st_size,
                                "originalPieces": len(original_geometries),
                                "simplifiedPieces": len(simplified_geometries)})
    return written


def run(store: Path, classes: list[str], overlays: bool) -> dict:
    started = time.time()
    simplification = compile_module.load_json(CONFIG / "simplification.json")
    transects = simplification["narrowFeatureWitnesses"]
    tolerance = simplification["narrowFeatureToleranceKilometres"]
    gates = simplification["gates"]
    out = store / "qc"
    out.mkdir(parents=True, exist_ok=True)
    per_class = {}
    all_witnesses: list[dict] = []
    for class_name in classes:
        catalog = json.loads((store / "staging" / class_name
                              / f"palaeo-{class_name}-catalog.json").read_text())
        rows = []
        summaries = []
        for interval in catalog["intervals"]:
            summary, piece_rows = measure_interval(store, class_name, interval, transects)
            summaries.append(summary)
            rows.extend(piece_rows)
            all_witnesses.extend(summary["narrowFeatureWitnesses"])
        bands = size_band_rows(rows)
        detail = out / f"palaeo-{class_name}-piece-metrics.json"
        detail.write_text(json.dumps({"class": class_name, "pieces": rows},
                                     separators=(",", ":")) + "\n")
        per_class[class_name] = {
            "intervals": [{key: value for key, value in summary.items()
                           if key != "narrowFeatureWitnesses"} for summary in summaries],
            "areaErrorBySize": bands,
            "pieceMetrics": {"path": str(detail.relative_to(store)),
                             "bytes": detail.stat().st_size, "rows": len(rows)},
            "totals": {
                "pieces": sum(summary["pieces"] for summary in summaries),
                "lostPieces": sum(summary["lostPieces"] for summary in summaries),
                "maximumLostPiecesInOneInterval": max(summary["lostPieces"] for summary in summaries),
                "originalVertices": sum(summary["originalVertices"] for summary in summaries),
                "simplifiedVertices": sum(summary["simplifiedVertices"] for summary in summaries),
                "vertexReductionPercent": round(
                    100.0 * (sum(summary["originalVertices"] for summary in summaries)
                             - sum(summary["simplifiedVertices"] for summary in summaries))
                    / sum(summary["originalVertices"] for summary in summaries), 3),
                "areaErrorPercent": round(
                    100.0 * (sum(summary["simplifiedAreaSquareKilometres"] for summary in summaries)
                             - sum(summary["originalAreaSquareKilometres"] for summary in summaries))
                    / sum(summary["originalAreaSquareKilometres"] for summary in summaries), 6),
                "worstIntervalAreaErrorPercent": round(
                    max(abs(summary["areaErrorPercent"]) for summary in summaries), 6),
                "worstPieceAreaErrorPercent": round(
                    max(summary["worstPieceAreaErrorPercent"] for summary in summaries), 6),
                "worstHausdorffDegrees": round(
                    max(summary["worstHausdorffDegrees"] for summary in summaries), 6),
                "worstHausdorffKilometresUpperBound": round(
                    max(summary["worstHausdorffKilometresUpperBound"] for summary in summaries), 4),
            },
        }
    witness_worst: dict[str, dict] = {}
    for row in all_witnesses:
        current = witness_worst.get(row["witnessId"])
        if current is None or row["changeKilometres"] > current["changeKilometres"]:
            witness_worst[row["witnessId"]] = row
    catalog_lost = {}
    for class_name in classes:
        catalog = json.loads((store / "staging" / class_name
                              / f"palaeo-{class_name}-catalog.json").read_text())
        catalog_lost[class_name] = {
            "maximumLostPiecesInOneInterval": max(row["lostPieces"] for row in catalog["intervals"]),
            "largestLostPieceSquareKilometres": round(
                max(row["largestLostPieceSquareKilometres"] for row in catalog["intervals"]), 3),
            "totalLostPieces": sum(row["lostPieces"] for row in catalog["intervals"]),
            "retainedUnsimplifiedPieces": catalog["simplification"]["retainedUnsimplifiedPieces"],
            "protectedPieces": catalog["simplification"]["protectedPieces"],
        }
    control_rows = []
    for class_name in classes:
        for interval_id in ("269-248", "166-146"):
            control_rows.extend(protection_control(store, class_name, interval_id, transects,
                                                   simplification))
    overlay_rows = build_overlays(store, classes, out) if overlays else []
    gate_rows = {
        "simplificationAreaErrorPercent": {
            "gate": gates["simplificationAreaErrorPercent"],
            "measuredWorstInterval": max(per_class[name]["totals"]["worstIntervalAreaErrorPercent"]
                                         for name in classes),
            "pass": all(per_class[name]["totals"]["worstIntervalAreaErrorPercent"]
                        <= gates["simplificationAreaErrorPercent"] for name in classes),
        },
        "lostPiecesPerInterval": {
            "gate": gates["lostPiecesPerInterval"],
            "measured": max(catalog_lost[name]["maximumLostPiecesInOneInterval"] for name in classes),
            "measuredAgainstOriginalPayload": max(
                per_class[name]["totals"]["maximumLostPiecesInOneInterval"] for name in classes),
            "pass": all(catalog_lost[name]["maximumLostPiecesInOneInterval"]
                        <= gates["lostPiecesPerInterval"] for name in classes),
        },
        "largestLostPieceSquareKilometres": {
            "gate": gates["largestLostPieceSquareKilometres"],
            "measured": max(catalog_lost[name]["largestLostPieceSquareKilometres"] for name in classes),
            "pass": all(catalog_lost[name]["largestLostPieceSquareKilometres"]
                        <= gates["largestLostPieceSquareKilometres"] for name in classes),
        },
        "narrowFeatureChangeKilometres": {
            "gate": tolerance,
            "measured": round(max((row["changeKilometres"] for row in witness_worst.values()),
                                  default=0.0), 4),
            "pass": all(row["changeKilometres"] <= tolerance for row in witness_worst.values()),
        },
    }
    record = {
        "recordId": "palaeo-coastlines-qc-v1",
        "measuredAt": "2026-09-15",
        "generatedBy": "scripts/research/palaeo_coastlines_qc.py",
        "store": str(store),
        "classes": per_class,
        "narrowFeatureWitnesses": {
            "toleranceKilometres": tolerance,
            "definition": ("length of each transect that falls inside the class, measured on great "
                           "circles, before and after node reduction"),
            "worstByWitness": witness_worst,
        },
        "lostPieces": catalog_lost,
        "protectionControl": {
            "definition": ("the same original pieces simplified at the baseline tolerance without the "
                           "protected window, so the narrow-feature gate is calibrated against a real "
                           "number instead of the zero that protection guarantees"),
            "rows": control_rows,
            "worstChangeKilometres": round(max((row["changeKilometres"] for row in control_rows),
                                               default=0.0), 4),
        },
        "overlays": overlay_rows,
        "gates": gate_rows,
        "status": "pass" if all(row["pass"] for row in gate_rows.values()) else "fail",
        "hausdorffNote": ("the Hausdorff distance is measured in the lon/lat plane; the kilometre "
                          "column multiplies it by 111.195 km per degree, which is an upper bound "
                          "everywhere except across a meridian near the equator"),
        "elapsedSeconds": round(time.time() - started, 2),
    }
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", type=Path, default=STORE)
    parser.add_argument("--classes", default="lm,sm,m")
    parser.add_argument("--no-overlays", action="store_true")
    parser.add_argument("--out", type=Path, default=RESULTS)
    args = parser.parse_args()
    classes = [name.strip() for name in args.classes.split(",") if name.strip()]
    record = run(args.store, classes, not args.no_overlays)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(record, indent=1, sort_keys=True) + "\n")
    print(json.dumps({"status": record["status"], "gates": record["gates"],
                      "out": str(args.out), "bytes": args.out.stat().st_size,
                      "elapsedSeconds": record["elapsedSeconds"]}, indent=1))
    if record["status"] != "pass":
        sys.exit(1)


if __name__ == "__main__":
    main()
