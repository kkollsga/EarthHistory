#!/usr/bin/env python3
"""Project bounded geodesic subdivision sizes without writing refined arrays."""

from __future__ import annotations

import json
import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
)
RADIUS_METRES = 6_371_008.8
THRESHOLDS_DEGREES = (0.5, 1.0, 2.0)


def unit(values):
    length = math.sqrt(sum(value * value for value in values))
    return tuple(value / length for value in values)


def edge_angle(a, b):
    return math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b)))))


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def subtract(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def triangle_minimum_radius(a, b, c):
    ab, ac = subtract(b, a), subtract(c, a)
    normal = cross(ab, ac)
    normal2 = dot(normal, normal)
    if normal2 <= 1e-24:
        return min(
            math.cos(edge_angle(a, b) / 2),
            math.cos(edge_angle(b, c) / 2),
            math.cos(edge_angle(c, a) / 2),
        )
    scale = dot(normal, a) / normal2
    foot = tuple(scale * x for x in normal)
    v2 = subtract(foot, a)
    d00, d01, d11, d20, d21 = (
        dot(ab, ab),
        dot(ab, ac),
        dot(ac, ac),
        dot(v2, ab),
        dot(v2, ac),
    )
    den = d00 * d11 - d01 * d01
    v = (d11 * d20 - d01 * d21) / den
    w = (d00 * d21 - d01 * d20) / den
    u = 1 - v - w
    if min(u, v, w) >= -1e-12:
        return math.sqrt(dot(foot, foot))
    return min(
        math.cos(edge_angle(a, b) / 2),
        math.cos(edge_angle(b, c) / 2),
        math.cos(edge_angle(c, a) / 2),
    )


def projected_counts(source_directions, source_triangles, threshold):
    directions = list(source_directions)
    cache = {}
    stack = list(source_triangles)
    output = 0
    maximum_depth = 0
    minimum_radius = 1.0
    while stack:
        a, b, c, depth = stack.pop()
        edges = [
            (edge_angle(directions[a], directions[b]), a, b, c),
            (edge_angle(directions[b], directions[c]), b, c, a),
            (edge_angle(directions[c], directions[a]), c, a, b),
        ]
        angle, left, right, opposite = max(edges)
        if angle <= threshold:
            output += 1
            maximum_depth = max(maximum_depth, depth)
            minimum_radius = min(
                minimum_radius,
                triangle_minimum_radius(directions[a], directions[b], directions[c]),
            )
            continue
        key = tuple(sorted((left, right)))
        midpoint = cache.get(key)
        if midpoint is None:
            midpoint = len(directions)
            exact = unit(
                tuple(x + y for x, y in zip(directions[left], directions[right]))
            )
            directions.append(struct.unpack("<fff", struct.pack("<fff", *exact)))
            cache[key] = midpoint
        stack.append((left, midpoint, opposite, depth + 1))
        stack.append((midpoint, right, opposite, depth + 1))
    maximum_norm_error = max(
        abs(math.sqrt(dot(point, point)) - 1) for point in directions
    )
    return (
        len(directions),
        output,
        maximum_depth,
        RADIUS_METRES * (1 - minimum_radius),
        RADIUS_METRES * maximum_norm_error,
    )


def main():
    metadata = json.loads((OUT / "coast-patches.json").read_text())
    raw = (OUT / "coast-reference-directions.f32").read_bytes()
    values = struct.unpack(f"<{len(raw) // 4}f", raw)
    directions = [values[i : i + 3] for i in range(0, len(values), 3)]
    raw_indices = (OUT / "coast-indices.u32").read_bytes()
    indices = struct.unpack(f"<{len(raw_indices) // 4}I", raw_indices)
    accepted = []
    for patch in metadata["patches"]:
        if patch["status"] != "supported":
            continue
        accepted.extend(
            (indices[i], indices[i + 1], indices[i + 2], 0)
            for i in range(
                patch["indexOffset"], patch["indexOffset"] + patch["indexCount"], 3
            )
        )
    maximum_source_edge = max(
        max(
            edge_angle(directions[a], directions[b]),
            edge_angle(directions[b], directions[c]),
            edge_angle(directions[c], directions[a]),
        )
        for a, b, c, _ in accepted
    )
    projections = []
    for degrees in THRESHOLDS_DEGREES:
        radians = math.radians(degrees)
        vertex_count, triangle_count, depth, facet_sink, float32_margin = (
            projected_counts(directions, accepted, radians)
        )
        projections.append(
            {
                "maximumAngularEdgeDegrees": degrees,
                "projectedVertexCount": vertex_count,
                "projectedTriangleCount": triangle_count,
                "maximumSubdivisionDepth": depth,
                "directionBytesFloat32Xyz": vertex_count * 12,
                "indexBytesUint32": triangle_count * 12,
                "maximumChordSagittaMetres": RADIUS_METRES
                * (1 - math.cos(radians / 2)),
                "maximumPlanarFacetSinkMetres": facet_sink,
                "float32DirectionNormMarginMetres": float32_margin,
                "requiredVisualShellSeparationMetres": facet_sink + float32_margin,
            }
        )
    result = {
        "schemaVersion": 1,
        "classification": "read-only size projection; no refined geometry emitted",
        "acceptedSourcePatchCount": sum(
            x["status"] == "supported" for x in metadata["patches"]
        ),
        "sourceVertexCount": len(directions),
        "sourceTriangleCount": len(accepted),
        "maximumSourceTriangleEdgeDegrees": math.degrees(maximum_source_edge),
        "projections": projections,
    }
    encoded = (json.dumps(result, indent=2) + "\n").encode()
    assert len(encoded) < 32 * 1024
    (OUT / "triangle-refinement-projection.json").write_bytes(encoded)
    print(encoded.decode())


if __name__ == "__main__":
    main()
