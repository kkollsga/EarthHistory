#!/usr/bin/env python3
"""Validate the bounded Cao native-mesh repair that restores Australia."""

from __future__ import annotations

import argparse
import copy
import json
import math
import struct
import sys
from pathlib import Path

import pygplates

sys.path.insert(0, str(Path(__file__).resolve().parent))
import compile_cao_foundation as compiler  # noqa: E402


AUSTRALIA_PATCH_SUFFIXES = {
    "558:0",
    "559:0",
    "560:0",
    "561:0",
    "562:0",
    "563:0",
    "564:0",
    "565:0",
    "565:7",
    "567:0",
    "569:0",
    "1988:0",
    "1989:0",
}
REPAIRED_SUFFIXES = {"563:0", "564:0"}
EXPECTED_REJECTED_SUFFIXES = {"1944:0", "1945:0"}
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASELINE_CORE = ROOT / "public/data/reconstruction/cao-v2.4/core.json"


def load_stage(stage):
    metadata = json.loads((stage / "coast-patches.json").read_text())
    raw = (stage / "coast-reference-directions.f32").read_bytes()
    values = struct.unpack(f"<{len(raw) // 4}f", raw)
    directions = [values[index : index + 3] for index in range(0, len(values), 3)]
    index_bytes = (stage / "coast-indices.u32").read_bytes()
    indices = struct.unpack(f"<{len(index_bytes) // 4}I", index_bytes)
    return metadata, directions, indices


def suffix(patch):
    return ":".join(patch["patchId"].split(":")[-2:])


def emitted_rings(patch, directions):
    return [
        directions[ring["offset"] : ring["offset"] + ring["count"]]
        for ring in patch["rings"]
    ]


def validate(metadata, directions, indices, baseline_core=None):
    patches = metadata["patches"]
    by_id = {patch["chartId"]: patch for patch in patches}
    if baseline_core is not None:
        baseline = json.loads(Path(baseline_core).read_text())
        baseline_coasts = {
            chart["chartId"]
            for chart in baseline["charts"]
            if chart["chartId"].startswith("cao-coast:")
            and chart["chartRevision"] == "cao-foundation-v1"
        }
        if len(baseline_coasts) < 2921 or any(
            by_id.get(chart_id, {}).get("status") != "supported"
            for chart_id in baseline_coasts
        ):
            raise ValueError("a previously emitted native coast chart regressed")
    australia = [patch for patch in patches if suffix(patch) in AUSTRALIA_PATCH_SUFFIXES]
    if {suffix(patch) for patch in australia} != AUSTRALIA_PATCH_SUFFIXES:
        raise ValueError("Australian source-chart inventory changed")
    if any(patch["status"] != "supported" for patch in australia):
        raise ValueError("an Australian native chart remains unsupported")
    rejected = {suffix(patch) for patch in patches if patch["status"] != "supported"}
    if rejected != EXPECTED_REJECTED_SUFFIXES:
        raise ValueError(f"unexpected rejected Cao charts: {sorted(rejected)}")

    repairs = {
        suffix(patch): patch.get("triangulationRepairs", []) for patch in australia
    }
    if {key for key, value in repairs.items() if value} != REPAIRED_SUFFIXES:
        raise ValueError("paired Arunta/Musgrave repair inventory changed")

    for patch in australia:
        centre = compiler.unit(patch["interiorDirection"])
        rings = emitted_rings(patch, directions)
        for ring in rings:
            projected = compiler.project_ring(ring, centre)
            if compiler.proper_self_intersections(projected):
                raise ValueError(f"emitted ring self-intersects: {patch['patchId']}")
        polygon = pygplates.PolygonOnSphere(
            [pygplates.PointOnSphere(compiler.unit(point)) for point in rings[0]],
            [
                [pygplates.PointOnSphere(compiler.unit(point)) for point in ring]
                for ring in rings[1:]
            ],
        )
        area = 0.0
        for cursor in range(
            patch["indexOffset"], patch["indexOffset"] + patch["indexCount"], 3
        ):
            triangle = [directions[indices[cursor + offset]] for offset in range(3)]
            triangle_area = compiler.triangle_area(*triangle)
            if not triangle_area > 1e-12:
                raise ValueError(f"degenerate emitted triangle: {patch['patchId']}")
            centroid = compiler.unit(
                tuple(sum(point[axis] for point in triangle) for axis in range(3))
            )
            if not polygon.is_point_in_polygon(pygplates.PointOnSphere(centroid)):
                raise ValueError(f"triangle centroid outside: {patch['patchId']}")
            area += triangle_area
        emitted_area = compiler.stable_polygon_area(rings, centre)
        tolerance = max(1e-8, patch["sourceAreaSteradians"] * 1e-5)
        if abs(area - emitted_area) > tolerance:
            raise ValueError(f"emitted mesh area residual: {patch['patchId']}")
        if not math.isclose(
            patch["areaResidualSteradians"], abs(area - emitted_area), abs_tol=1e-15
        ):
            raise ValueError(f"recorded area residual changed: {patch['patchId']}")
        if patch["sourceAreaDeviationSteradians"] > tolerance:
            raise ValueError(f"native source area deviation: {patch['patchId']}")

    duplicate = {suffix(patch): patch for patch in australia}
    south, curnamona = duplicate["1988:0"], duplicate["1989:0"]
    if (
        south["geometrySha256"] != curnamona["geometrySha256"]
        or south["plateId"] == curnamona["plateId"]
        or south["chartId"] == curnamona["chartId"]
    ):
        raise ValueError("native overlapping South Australia/Curnamona semantics changed")


def self_test(metadata, directions, indices, baseline_core):
    mutated = copy.deepcopy(metadata)
    next(
        patch for patch in mutated["patches"] if suffix(patch) == "558:0"
    )["status"] = "unsupported-area-residual"
    try:
        validate(mutated, directions, indices, baseline_core)
    except ValueError:
        pass
    else:
        raise AssertionError("unsupported-Australia mutation escaped")

    mutated = copy.deepcopy(metadata)
    next(
        patch for patch in mutated["patches"] if suffix(patch) == "563:0"
    ).pop("triangulationRepairs")
    try:
        validate(mutated, directions, indices, baseline_core)
    except ValueError:
        pass
    else:
        raise AssertionError("missing paired-repair mutation escaped")

    crossed_directions = list(directions)
    arunta = next(
        patch for patch in metadata["patches"] if suffix(patch) == "563:0"
    )
    repair = arunta["triangulationRepairs"][0]
    offset = arunta["rings"][repair["ringIndex"]]["offset"]
    left = offset + repair["firstEdgeStart"] + 1
    right = offset + repair["secondEdgeStart"]
    crossed_directions[left], crossed_directions[right] = (
        crossed_directions[right],
        crossed_directions[left],
    )
    try:
        validate(metadata, crossed_directions, indices, baseline_core)
    except ValueError:
        pass
    else:
        raise AssertionError("old self-crossing connectivity mutation escaped")

    mutated_indices = list(indices)
    patch = next(patch for patch in metadata["patches"] if suffix(patch) == "560:0")
    mutated_indices[patch["indexOffset"] + 1] = mutated_indices[patch["indexOffset"]]
    try:
        validate(metadata, directions, mutated_indices, baseline_core)
    except ValueError:
        pass
    else:
        raise AssertionError("degenerate emitted-triangle mutation escaped")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", type=Path, required=True)
    parser.add_argument("--baseline-core", type=Path, default=DEFAULT_BASELINE_CORE)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    metadata, directions, indices = load_stage(args.stage)
    validate(metadata, directions, indices, args.baseline_core)
    if args.self_test:
        self_test(metadata, directions, indices, args.baseline_core)
    print(
        json.dumps(
            {
                "australianCharts": len(AUSTRALIA_PATCH_SUFFIXES),
                "pairedConnectivityRepairs": len(REPAIRED_SUFFIXES),
                "remainingRejectedCharts": len(EXPECTED_REJECTED_SUFFIXES),
                "selfTest": args.self_test,
            }
        )
    )


if __name__ == "__main__":
    main()
