#!/usr/bin/env python3
"""Stage native Cao coastline patches; public promotion is a separate gate."""

from __future__ import annotations

import hashlib
import json
import math
import struct
import subprocess
from pathlib import Path

import pygplates

ROOT = Path(__file__).resolve().parents[2]
MODEL = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
)
OUT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
)
SOURCE = "shapes_coasts.gpmlz"
SOURCE_SHA = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"
ROTATION_SHA = "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def finite(value):
    return value if math.isfinite(value) else None


def unit(values):
    length = math.sqrt(sum(value * value for value in values))
    return tuple(value / length for value in values)


def angular(a, b):
    return math.acos(max(-1, min(1, sum(x * y for x, y in zip(a, b)))))


def triangle_area(a, b, c):
    determinant = abs(
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    )
    denominator = 1 + dot(a, b) + dot(b, c) + dot(c, a)
    return 2 * math.atan2(determinant, denominator)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def main():
    policy = json.loads((OUT / "policy.json").read_text())
    if (
        sha(MODEL / SOURCE) != SOURCE_SHA
        or sha(MODEL / "1000_0_rotfile.rot") != ROTATION_SHA
    ):
        raise SystemExit("pinned source changed")
    directions = []
    patches = []
    geometries = {}
    for feature_order, feature in enumerate(
        pygplates.FeatureCollection(str(MODEL / SOURCE))
    ):
        for geometry_order, geometry in enumerate(feature.get_all_geometries()):
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            rings = [list(geometry.get_exterior_ring_points())] + [
                list(geometry.get_interior_ring_points(i))
                for i in range(geometry.get_number_of_interior_rings())
            ]
            ring_records = []
            for ring in rings:
                offset = len(directions)
                directions.extend(point.to_xyz() for point in ring)
                ring_records.append({"offset": offset, "count": len(ring)})
            source_id = str(feature.get_feature_id())
            patch_id = f"cao-coast:{source_id}:{feature_order}:{geometry_order}"
            oldest, youngest = feature.get_valid_time()
            patch = {
                "patchId": patch_id,
                "chartId": patch_id,
                "chartRevision": "cao-v2.4-foundation-v1",
                "materialId": patch_id,
                "fragmentOrCohortId": patch_id,
                "role": "model-geography",
                "sourceFeatureIds": [source_id],
                "sourceFeatureTypes": [str(feature.get_feature_type()).split(":")[-1]],
                "sourceName": feature.get_name(),
                "sourceAreaSteradians": geometry.get_area(),
                "plateId": feature.get_reconstruction_plate_id(None),
                "geometryReferenceAgeMa": feature.get_geometry_import_time(),
                "lifecycle": {
                    "oldestAgeMa": finite(oldest),
                    "youngestAgeMa": finite(youngest),
                },
                "rings": ring_records,
                "interiorDirection": list(geometry.get_interior_centroid().to_xyz()),
                "surfaceEvidence": {
                    "kind": "unknown",
                    "reason": "Cao model-derived coastline-class geometry is not a dated exposed-land or height observation",
                },
                "heightDatum": {
                    "kind": "neutral-display-synthesis",
                    "radiusMetres": 6371008.8,
                    "seaLevelMetres": 0,
                    "heightMetres": 0,
                },
            }
            patches.append(patch)
            geometries[patch_id] = geometry
    raw = bytearray(len(directions) * 12)
    for index, direction in enumerate(directions):
        struct.pack_into("<fff", raw, index * 12, *direction)
    metadata = {
        "schemaVersion": 1,
        "classification": "staged source rings awaiting validated constrained triangulation",
        "source": {"path": SOURCE, "sha256": SOURCE_SHA},
        "patches": patches,
    }
    meta_bytes = (json.dumps(metadata, separators=(",", ":")) + "\n").encode()
    for payload in (raw, meta_bytes):
        if len(payload) > 8 * 1024 * 1024:
            raise SystemExit("single-file cap projected")
    (OUT / "coast-reference-directions.f32").write_bytes(raw)
    (OUT / "coast-rings.json").write_bytes(meta_bytes)
    subprocess.run(
        [
            "node",
            str(ROOT / "scripts/research/triangulate_cao_rings.mjs"),
            str(OUT / "coast-rings.json"),
            str(OUT / "coast-reference-directions.f32"),
            str(OUT / "coast-indices.u32"),
        ],
        check=True,
    )
    triangulated = json.loads((OUT / "coast-indices.u32.json").read_text())
    index_bytes = (OUT / "coast-indices.u32").read_bytes()
    indices = struct.unpack(f"<{len(index_bytes) // 4}I", index_bytes)
    accepted = 0
    rejected = {}
    max_area_error = 0.0
    max_centroid_error = 0.0
    for patch in triangulated["patches"]:
        if patch["status"] != "candidate":
            rejected[patch["status"]] = rejected.get(patch["status"], 0) + 1
            continue
        geometry = geometries[patch["patchId"]]
        area = 0.0
        failure = None
        for cursor in range(
            patch["indexOffset"], patch["indexOffset"] + patch["indexCount"], 3
        ):
            xyz = [directions[indices[cursor + i]] for i in range(3)]
            tri_area = triangle_area(*xyz)
            centre = tuple(sum(point[axis] for point in xyz) for axis in range(3))
            if math.sqrt(dot(centre, centre)) < 1e-12:
                failure = "unsupported-degenerate-triangle"
                break
            centroid = pygplates.PointOnSphere(unit(centre))
            inside = geometry.is_point_in_polygon(centroid)
            max_centroid_error = max(max_centroid_error, 0.0 if inside else 1.0)
            if not inside:
                failure = "unsupported-centroid-outside"
                break
            if not tri_area > 1e-14:
                failure = "unsupported-degenerate-triangle"
                break
            area += tri_area
        error = abs(area - geometry.get_area())
        max_area_error = max(max_area_error, error)
        if failure or error > max(1e-8, geometry.get_area() * 1e-5):
            patch["status"] = failure or "unsupported-area-residual"
            rejected[patch["status"]] = rejected.get(patch["status"], 0) + 1
        else:
            patch["status"] = "supported"
            accepted += 1
    final_meta = {
        "schemaVersion": 1,
        "classification": "staged Cao source-native coastline-class patches; not exposed-land or topography",
        "frame": {
            "modelId": "cao-et-al-2024",
            "modelVersion": "2.4",
            "absoluteFrameId": "palaeomagnetic",
            "anchorPlateId": 0,
            "axisConvention": "gplates-x0e-y90e-znorth",
            "rotationSha256": ROTATION_SHA,
            "topologySha256": "pending-full-checkpoint-package",
        },
        "geometry": {
            "directions": {
                "path": "coast-reference-directions.f32",
                "bytes": len(raw),
                "sha256": sha(OUT / "coast-reference-directions.f32"),
                "encoding": "float32 xyz unit",
            },
            "indices": {
                "path": "coast-indices.u32",
                "bytes": len(index_bytes),
                "sha256": sha(OUT / "coast-indices.u32"),
                "encoding": "uint32 triangles",
            },
        },
        "validation": {
            "supportedPatchCount": accepted,
            "rejectedPatchCounts": rejected,
            "maximumAreaResidualSteradians": max_area_error,
            "allSupportedTriangleCentroidsInside": max_centroid_error == 0,
        },
        "patches": triangulated["patches"],
    }
    final_bytes = (json.dumps(final_meta, separators=(",", ":")) + "\n").encode()
    if len(final_bytes) > 8 * 1024 * 1024:
        raise SystemExit("metadata single-file cap")
    (OUT / "coast-patches.json").write_bytes(final_bytes)
    stage = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    if stage > policy["stageMaximumBytes"]:
        raise SystemExit("stage cap")
    print(
        json.dumps(
            {
                "patches": len(patches),
                "supported": accepted,
                "rejected": rejected,
                "vertices": len(directions),
                "indices": len(indices),
                "stageBytes": stage,
                "maxAreaResidual": max_area_error,
            }
        )
    )


if __name__ == "__main__":
    main()
