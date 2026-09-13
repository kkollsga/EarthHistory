#!/usr/bin/env python3
"""Stage native Cao continental-outline patches; public promotion is a separate gate."""

from __future__ import annotations

import hashlib
import json
import math
import struct
import subprocess
from pathlib import Path

import pygplates

from cao_material_corrections import staged_geometry_hash

ROOT = Path(__file__).resolve().parents[2]
MODEL = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
)
OUT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
)

# These two source rings share the same four-vertex bow-tie in opposite
# directions. Reversing the two interior vertices is the smallest 2-opt repair:
# it preserves every pinned source vertex while replacing the crossing edges
# with the shorter, non-crossing pairing. The window hashes make this fail
# closed if a future Cao source revision changes either ring.
SOURCE_RING_REPAIRS = {
    "cao-coast:GPlates-18cbb9ae-1b1d-4015-abac-9a142493cf17:563:0": {
        "ringIndex": 0,
        "firstEdgeStart": 2601,
        "secondEdgeStart": 2603,
        "windowSha256": "3cd21f35edcfa1a9ae0dd326477180f39ac9c6040e0d13fd347f1b7ec9dc64ea",
    },
    "cao-coast:GPlates-18cbb9ae-1b1d-4015-abac-9a142493cf17:564:0": {
        "ringIndex": 0,
        "firstEdgeStart": 1573,
        "secondEdgeStart": 1575,
        "windowSha256": "7ce21d92659181f4a0a378038d9c0f6279b5e145e6558da9f82384d9f77d1af2",
    },
}
ROTATION_FILES = ("1000_0_rotfile.rot", "1800_1000_rotfile.rot")
ROTATION_SHAS = (
    "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c",
    "db2a57a8b7c7a08891c19840b6334ffb9c279b6a991a2c2eed099edb23445785",
)
ROTATION_SHA = "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f"
LAYERS = {
    "continents": {
        "source": "shapes_continents.gpmlz",
        "sourceSha": "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616",
        "prefix": "cao-continent",
        "surfaceReason": "Cao continental-outline model geometry is not a dated exposed-land or height observation",
        "classification": "staged Cao source-native continental-outline patches; not exposed-land or topography",
    },
    "coasts": {
        "source": "shapes_coasts.gpmlz",
        "sourceSha": "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f",
        "prefix": "cao-coast",
        "surfaceReason": "Cao model-derived coastline-class geometry is not a dated exposed-land or height observation",
        "classification": "staged Cao source-native coastline-class patches; not exposed-land or topography",
    },
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def finite(value):
    return value if math.isfinite(value) else None


def float32(value):
    return struct.unpack("<f", struct.pack("<f", value))[0]


def quantized_direction(values):
    """Return the coordinates that are actually serialized and triangulated."""
    return tuple(float32(value) for value in values)


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


def signed_triangle_area(a, b, c):
    a, b, c = unit(a), unit(b), unit(c)
    determinant = (
        a[0] * (b[1] * c[2] - b[2] * c[1])
        - a[1] * (b[0] * c[2] - b[2] * c[0])
        + a[2] * (b[0] * c[1] - b[1] * c[0])
    )
    denominator = 1 + dot(a, b) + dot(b, c) + dot(c, a)
    return 2 * math.atan2(determinant, denominator)


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def project_ring(ring, centre):
    trial = (0, 0, 1) if abs(centre[2]) < 0.8 else (1, 0, 0)
    east = unit(
        (
            trial[1] * centre[2] - trial[2] * centre[1],
            trial[2] * centre[0] - trial[0] * centre[2],
            trial[0] * centre[1] - trial[1] * centre[0],
        )
    )
    north = (
        centre[1] * east[2] - centre[2] * east[1],
        centre[2] * east[0] - centre[0] * east[2],
        centre[0] * east[1] - centre[1] * east[0],
    )
    projected = []
    for point in ring:
        denominator = dot(point, centre)
        if not denominator > 1e-8:
            raise ValueError("source-ring repair left the local gnomonic domain")
        projected.append(
            (dot(point, east) / denominator, dot(point, north) / denominator)
        )
    return projected


def stable_polygon_area(rings, centre):
    """Measure a dense spherical boundary without large-angle cancellation."""

    def ring_area(ring):
        return abs(
            sum(
                signed_triangle_area(
                    centre, point, ring[(index + 1) % len(ring)]
                )
                for index, point in enumerate(ring)
            )
        )

    area = ring_area(rings[0]) - sum(ring_area(ring) for ring in rings[1:])
    if not area > 0:
        raise ValueError("spherical polygon holes consume its exterior")
    return area


def proper_self_intersections(points):
    """Find non-adjacent, proper segment crossings with a bounded sweep."""
    count = len(points)
    segments = []
    for index, a in enumerate(points):
        b = points[(index + 1) % count]
        segments.append(
            (
                min(a[0], b[0]),
                max(a[0], b[0]),
                min(a[1], b[1]),
                max(a[1], b[1]),
                index,
                a,
                b,
            )
        )
    active = []
    crossings = []
    for segment in sorted(segments):
        min_x, max_x, min_y, max_y, index, a, b = segment
        active = [other for other in active if other[1] >= min_x]
        for other in active:
            _, _, other_min_y, other_max_y, other_index, c, d = other
            if other_max_y < min_y or max_y < other_min_y:
                continue
            if (index - other_index) % count in (1, count - 1):
                continue
            orient_a = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (
                c[0] - a[0]
            )
            orient_b = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (
                d[0] - a[0]
            )
            orient_c = (d[0] - c[0]) * (a[1] - c[1]) - (d[1] - c[1]) * (
                a[0] - c[0]
            )
            orient_d = (d[0] - c[0]) * (b[1] - c[1]) - (d[1] - c[1]) * (
                b[0] - c[0]
            )
            if orient_a * orient_b < 0 and orient_c * orient_d < 0:
                crossings.append(tuple(sorted((index, other_index))))
        active.append(segment)
    return sorted(set(crossings))


def repair_source_ring(patch_id, ring_index, ring, centre):
    repair = SOURCE_RING_REPAIRS.get(patch_id)
    if repair is None or repair["ringIndex"] != ring_index:
        return ring, None
    first = repair["firstEdgeStart"]
    second = repair["secondEdgeStart"]
    window = b"".join(
        struct.pack("<fff", *point) for point in ring[first : second + 2]
    )
    if hashlib.sha256(window).hexdigest() != repair["windowSha256"]:
        raise ValueError(f"pinned source-ring repair window changed for {patch_id}")
    before = proper_self_intersections(project_ring(ring, centre))
    if (first, second) not in before:
        raise ValueError(f"pinned source-ring crossing absent for {patch_id}")
    repaired = (
        ring[: first + 1]
        + list(reversed(ring[first + 1 : second + 1]))
        + ring[second + 1 :]
    )
    after = proper_self_intersections(project_ring(repaired, centre))
    if after:
        raise ValueError(f"source-ring repair remains self-intersecting for {patch_id}: {after[:3]}")
    return repaired, {
        "kind": "vertex-preserving-2-opt-untangling",
        "ringIndex": ring_index,
        "firstEdgeStart": first,
        "secondEdgeStart": second,
        "sourceVertexWindowSha256": repair["windowSha256"],
    }


def main(layer: str = "continents", out: Path | None = None):
    if layer not in LAYERS:
        raise SystemExit(f"unknown layer {layer!r}; expected one of {sorted(LAYERS)}")
    cfg = LAYERS[layer]
    SOURCE = cfg["source"]
    SOURCE_SHA = cfg["sourceSha"]
    stage_out = Path(out) if out else OUT
    stage_out.mkdir(parents=True, exist_ok=True)
    policy_bytes = (OUT / "policy.json").read_bytes()
    policy = json.loads(policy_bytes)
    if stage_out != OUT:
        (stage_out / "policy.json").write_bytes(policy_bytes)
    if (
        sha(MODEL / SOURCE) != SOURCE_SHA
        or tuple(sha(MODEL / name) for name in ROTATION_FILES) != ROTATION_SHAS
    ):
        raise SystemExit("pinned source changed")
    directions = []
    patches = []
    geometries = {}
    source_rings = {}
    for feature_order, feature in enumerate(
        pygplates.FeatureCollection(str(MODEL / SOURCE))
    ):
        for geometry_order, geometry in enumerate(feature.get_all_geometries()):
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            source_id = str(feature.get_feature_id())
            patch_id = f"{cfg['prefix']}:{source_id}:{feature_order}:{geometry_order}"
            centre = unit(geometry.get_interior_centroid().to_xyz())
            rings = [list(geometry.get_exterior_ring_points())] + [
                list(geometry.get_interior_ring_points(i))
                for i in range(geometry.get_number_of_interior_rings())
            ]
            native_rings = [
                [tuple(point.to_xyz()) for point in ring] for ring in rings
            ]
            ring_records = []
            repair_records = []
            for ring_index, ring in enumerate(rings):
                emitted_ring = [quantized_direction(point.to_xyz()) for point in ring]
                emitted_ring, repair = repair_source_ring(
                    patch_id, ring_index, emitted_ring, centre
                )
                offset = len(directions)
                directions.extend(emitted_ring)
                ring_records.append({"offset": offset, "count": len(emitted_ring)})
                if repair:
                    repair_records.append(repair)
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
                    "reason": cfg["surfaceReason"],
                },
                "heightDatum": {
                    "kind": "neutral-display-synthesis",
                    "radiusMetres": 6371008.8,
                    "seaLevelMetres": 0,
                    "heightMetres": 0,
                },
            }
            if repair_records:
                patch["triangulationRepairs"] = repair_records
            patches.append(patch)
            geometries[patch_id] = geometry
            source_rings[patch_id] = native_rings
    raw = bytearray(len(directions) * 12)
    for index, direction in enumerate(directions):
        struct.pack_into("<fff", raw, index * 12, *direction)
    metadata = {
        "schemaVersion": 1,
        "classification": "staged source rings awaiting validated constrained triangulation",
        "source": {"path": SOURCE, "sha256": SOURCE_SHA, "layer": layer},
        "patches": patches,
    }
    meta_bytes = (json.dumps(metadata, separators=(",", ":")) + "\n").encode()
    for payload in (raw, meta_bytes):
        if len(payload) > 8 * 1024 * 1024:
            raise SystemExit("single-file cap projected")
    (stage_out / "coast-reference-directions.f32").write_bytes(raw)
    (stage_out / "coast-rings.json").write_bytes(meta_bytes)
    subprocess.run(
        [
            "node",
            str(ROOT / "scripts/research/triangulate_cao_rings.mjs"),
            str(stage_out / "coast-rings.json"),
            str(stage_out / "coast-reference-directions.f32"),
            str(stage_out / "coast-indices.u32"),
        ],
        check=True,
    )
    triangulated = json.loads((stage_out / "coast-indices.u32.json").read_text())
    index_bytes = (stage_out / "coast-indices.u32").read_bytes()
    indices = struct.unpack(f"<{len(index_bytes) // 4}I", index_bytes)
    accepted = 0
    rejected = {}
    max_area_error = 0.0
    max_source_area_deviation = 0.0
    max_centroid_error = 0.0
    native_source_centroid_misses = 0
    for patch in triangulated["patches"]:
        if patch["status"] != "candidate":
            rejected[patch["status"]] = rejected.get(patch["status"], 0) + 1
            continue
        geometry = geometries[patch["patchId"]]
        emitted_rings = []
        for ring in patch["rings"]:
            emitted_rings.append(
                [
                    pygplates.PointOnSphere(unit(directions[index]))
                    for index in range(ring["offset"], ring["offset"] + ring["count"])
                ]
            )
        emitted_geometry = pygplates.PolygonOnSphere(emitted_rings[0], emitted_rings[1:])
        stable_source_area = stable_polygon_area(
            source_rings[patch["patchId"]], unit(patch["interiorDirection"])
        )
        emitted_area = stable_polygon_area(
            [
                directions[ring["offset"] : ring["offset"] + ring["count"]]
                for ring in patch["rings"]
            ],
            unit(patch["interiorDirection"]),
        )
        source_area_deviation = abs(emitted_area - stable_source_area)
        patch["stableSourceAreaSteradians"] = stable_source_area
        patch["emittedAreaSteradians"] = emitted_area
        patch["sourceAreaDeviationSteradians"] = source_area_deviation
        max_source_area_deviation = max(max_source_area_deviation, source_area_deviation)
        source_tolerance = max(1e-8, geometry.get_area() * 1e-5)
        area = 0.0
        failure = (
            "unsupported-source-area-deviation"
            if source_area_deviation > source_tolerance
            else None
        )
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
            inside_emitted = emitted_geometry.is_point_in_polygon(centroid)
            inside_native = geometry.is_point_in_polygon(centroid)
            max_centroid_error = max(
                max_centroid_error, 0.0 if inside_emitted else 1.0
            )
            native_source_centroid_misses += not inside_native
            if not inside_emitted:
                failure = "unsupported-centroid-outside"
                break
            if not tri_area > 1e-12:
                failure = "unsupported-degenerate-triangle"
                break
            area += tri_area
        error = abs(area - emitted_area)
        patch["areaResidualSteradians"] = error
        max_area_error = max(max_area_error, error)
        if failure or error > max(1e-8, geometry.get_area() * 1e-5):
            patch["status"] = failure or "unsupported-area-residual"
            rejected[patch["status"]] = rejected.get(patch["status"], 0) + 1
        else:
            patch["status"] = "supported"
            accepted += 1
    final_meta = {
        "schemaVersion": 1,
        "classification": cfg["classification"],
        "source": {"path": SOURCE, "sha256": SOURCE_SHA, "layer": layer},
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
                "sha256": sha(stage_out / "coast-reference-directions.f32"),
                "encoding": "float32 xyz unit",
            },
            "indices": {
                "path": "coast-indices.u32",
                "bytes": len(index_bytes),
                "sha256": sha(stage_out / "coast-indices.u32"),
                "encoding": "uint32 triangles",
            },
        },
        "validation": {
            "supportedPatchCount": accepted,
            "rejectedPatchCounts": rejected,
            "maximumAreaResidualSteradians": max_area_error,
            "maximumSourceAreaDeviationSteradians": max_source_area_deviation,
            "allSupportedTriangleCentroidsInside": max_centroid_error == 0,
            "nativeSourceCentroidMissCount": native_source_centroid_misses,
        },
        "patches": triangulated["patches"],
    }
    for patch in final_meta["patches"]:
        patch["geometrySha256"] = staged_geometry_hash(patch, raw)
    final_bytes = (json.dumps(final_meta, separators=(",", ":")) + "\n").encode()
    if len(final_bytes) > 8 * 1024 * 1024:
        raise SystemExit("metadata single-file cap")
    (stage_out / "coast-patches.json").write_bytes(final_bytes)
    measured = [
        stage_out / name
        for name in (
            "coast-patches.json",
            "coast-rings.json",
            "coast-indices.u32",
            "coast-indices.u32.json",
            "coast-reference-directions.f32",
            "policy.json",
        )
        if (stage_out / name).is_file()
    ]
    stage = sum(p.stat().st_size for p in measured)
    if stage > policy["stageMaximumBytes"]:
        raise SystemExit(f"stage cap: {stage} > {policy['stageMaximumBytes']}")
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
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--layer", choices=sorted(LAYERS), default="continents")
    parser.add_argument("--out", type=Path)
    main(**vars(parser.parse_args()))
