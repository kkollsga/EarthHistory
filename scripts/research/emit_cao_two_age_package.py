#!/usr/bin/env python3
"""Emit a bounded native-Cao two-age package for real consumer integration."""

from __future__ import annotations
import hashlib, importlib.util, json, math, struct
from pathlib import Path
import pygplates

ROOT = Path(__file__).resolve().parents[2]
MODEL = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
)
OUT = (
    ROOT.parent
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1/two-age-package"
)
STAGE = OUT.parent
AGES = [0.0, 450.0]
LIMIT = math.radians(1)
PACKAGE = "cao-v2.4-two-age-integration-v1"
REVISION = "cao-foundation-v1"
PALETTE = "cao-v2.4-shared-motion-v1"
ROTATION_FILES = ("1000_0_rotfile.rot", "1800_1000_rotfile.rot")
TOPO = [
    "250-0_plate_boundaries.gpml",
    "410-250_plate_boundaries.gpml",
    "1000-410_plate_boundaries.gpml",
    "TopologyBuildingBlocks.gpml",
]
ROT_SHAS = (
    "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c",
    "db2a57a8b7c7a08891c19840b6334ffb9c279b6a991a2c2eed099edb23445785",
)
ROT_SHA = "80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def asset(path):
    return {"url": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def unit(a):
    n = math.sqrt(dot(a, a))
    return tuple(x / n for x in a)


def angle(a, b):
    return math.acos(max(-1, min(1, dot(a, b))))


def midpoint(a, b):
    return struct.unpack(
        "<fff", struct.pack("<fff", *unit(tuple(x + y for x, y in zip(a, b))))
    )


def inverse(q):
    return (q[0], -q[1], -q[2], -q[3])


def compose(a, b):
    aw, ax, ay, az = a
    bw, bx, by, bz = b
    return (
        aw * bw - ax * bx - ay * by - az * bz,
        aw * bx + ax * bw + ay * bz - az * by,
        aw * by - ax * bz + ay * bw + az * bx,
        aw * bz + ax * by - ay * bx + az * bw,
    )


def load_coordinate():
    path = ROOT / "scripts/research/coordinate_preflight.py"
    spec = importlib.util.spec_from_file_location("coordinate_preflight", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def frame():
    aggregate = hashlib.sha256(
        "".join(sha(MODEL / name) for name in TOPO).encode()
    ).hexdigest()
    return {
        "modelId": "cao-et-al-2024",
        "modelVersion": "2.4",
        "absoluteFrameId": "palaeomagnetic",
        "anchorPlateId": 0,
        "axisConvention": "gplates-x0e-y90e-znorth",
        "rotationSha256": ROT_SHA,
        "topologySha256": aggregate,
    }


def adaptive(cp, rotation, plate, clock):
    nodes = {
        age: cp.float32_quaternion(cp.exact_quaternion(rotation, age, plate))
        for age in clock
    }

    def train(left, right, depth):
        middle = (left + right) / 2
        exact = cp.exact_quaternion(rotation, middle, plate)
        if exact is None:
            raise ValueError(f"missing strict midpoint {plate} {middle}")
        if (
            cp.angular_rotation_error(exact, cp.slerp(nodes[left], nodes[right], 0.5))
            <= cp.INTERPOLATION_TARGET_RAD
        ):
            return
        if depth >= 16:
            raise ValueError(f"unbounded interpolation {plate} {left} {right}")
        nodes[middle] = cp.float32_quaternion(exact)
        train(left, middle, depth + 1)
        train(middle, right, depth + 1)

    for left, right in zip(clock, clock[1:]):
        train(left, right, 0)
    return nodes


def active(patch, age):
    o = patch["lifecycle"]["oldestAgeMa"]
    y = patch["lifecycle"]["youngestAgeMa"]
    return (o is None or age <= o) and (y is None or age >= y)


def refine(directions, triangles, chart_index, seam_ids):
    cache = {}
    stack = list(triangles)
    out = []
    while stack:
        a, b, c = stack.pop()
        edges = [
            (angle(directions[a], directions[b]), a, b, c),
            (angle(directions[b], directions[c]), b, c, a),
            (angle(directions[c], directions[a]), c, a, b),
        ]
        length, left, right, opposite = max(edges)
        if length <= LIMIT:
            out.append((a, b, c))
            continue
        key = tuple(sorted((left, right)))
        middle = cache.get(key)
        if middle is None:
            middle = len(directions)
            directions.append(midpoint(directions[left], directions[right]))
            seam_ids.append(1_000_000_000 + middle)
            chart_index.append(chart_index[left])
            cache[key] = middle
        stack.extend(((left, middle, opposite), (middle, right, opposite)))
    return out


def write_geometry(path, directions, seams, charts, triangles):
    size = 32 + 20 * len(directions) + 12 * len(triangles)
    data = bytearray(size)
    data[:4] = b"EHGB"
    struct.pack_into(
        "<HHIIIIII", data, 4, 2, 32, len(directions), len(triangles), 0, 0, 0, 0
    )
    offset = 32
    for value in directions:
        struct.pack_into("<fff", data, offset, *value)
        offset += 12
    for values in (seams, charts):
        for value in values:
            struct.pack_into("<I", data, offset, value)
            offset += 4
    for triangle in triangles:
        struct.pack_into("<III", data, offset, *triangle)
        offset += 12
    assert offset == size and size < 8 * 1024 * 1024
    path.write_bytes(data)


def main():
    policy = json.loads((STAGE / "policy.json").read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    assert tuple(sha(MODEL / name) for name in ROTATION_FILES) == ROT_SHAS
    meta = json.loads((STAGE / "coast-patches.json").read_text())
    raw = (STAGE / "coast-reference-directions.f32").read_bytes()
    values = struct.unpack(f"<{len(raw) // 4}f", raw)
    source = [values[i : i + 3] for i in range(0, len(values), 3)]
    iraw = (STAGE / "coast-indices.u32").read_bytes()
    indices = struct.unpack(f"<{len(iraw) // 4}I", iraw)
    rotation = pygplates.RotationModel([str(MODEL / name) for name in ROTATION_FILES], default_anchor_plate_id=0)
    cp = load_coordinate()
    clock = sorted({age for name in ROTATION_FILES
                    for age in cp.all_source_rotation_times(MODEL / name, 0, 450)})
    eligible = []
    palette_nodes = {}
    for patch in meta["patches"]:
        if patch["status"] != "supported" or not all(active(patch, a) for a in AGES):
            continue
        plate = patch["plateId"]
        if plate is None:
            continue
        if plate not in palette_nodes:
            try:
                if any(cp.exact_quaternion(rotation, a, plate) is None for a in clock):
                    raise ValueError("strict support gap")
                palette_nodes[plate] = adaptive(cp, rotation, plate, clock)
            except ValueError:
                palette_nodes[plate] = None
        if palette_nodes[plate] is None:
            continue
        eligible.append(patch)
    selected = sorted(
        eligible, key=lambda p: (-p["sourceAreaSteradians"], p["patchId"])
    )[:12]
    selected.sort(key=lambda p: p["patchId"])
    charts = []
    directions = []
    seams = []
    vertex_charts = []
    triangles = []
    for chart_index, patch in enumerate(selected):
        mapping = {}

        def local(global_index):
            if global_index not in mapping:
                mapping[global_index] = len(directions)
                directions.append(source[global_index])
                seams.append(global_index)
                vertex_charts.append(chart_index)
            return mapping[global_index]

        source_triangles = [
            tuple(local(indices[i + j]) for j in range(3))
            for i in range(
                patch["indexOffset"], patch["indexOffset"] + patch["indexCount"], 3
            )
        ]
        triangles += refine(directions, source_triangles, vertex_charts, seams)
        charts.append(
            {
                "kind": "rigid",
                "role": "model-geography",
                "chartId": patch["chartId"],
                "chartRevision": REVISION,
                "materialId": patch["materialId"],
                "fragmentOrCohortId": patch["fragmentOrCohortId"],
                "lifecycle": {"validTimeMa": {"youngest": 0, "oldest": 450}},
                "geometryReferenceAgeMa": 0,
                "motionBinding": {
                    "paletteId": PALETTE,
                    "entryId": f"plate-{patch['plateId']}-ref-0",
                },
                "sourceFeatureIds": patch["sourceFeatureIds"],
                "sourceFeatureTypes": patch["sourceFeatureTypes"],
                "evidence": {
                    "status": "model-output",
                    "sourceIds": [
                        "doi:10.5281/zenodo.13628813",
                        *patch["sourceFeatureIds"],
                    ],
                    "limitations": [
                        "two-age integration subset",
                        "Cao coastline-class model geometry is not observed exposed land",
                        "physical height unknown; 400 m is render-only shell separation",
                    ],
                },
                "surfaceEvidence": {
                    "kind": "unknown",
                    "reason": "native Cao coastline-class geometry; exposed-land and height evidence unavailable",
                },
            }
        )
    geometry = OUT / "batch-0.ehgb"
    write_geometry(geometry, directions, seams, vertex_charts, triangles)
    entries = []
    records = []
    for plate in sorted({patch["plateId"] for patch in selected}):
        nodes = palette_nodes[plate]
        qref = cp.exact_quaternion(rotation, 0, plate)
        relative = {
            age: cp.float32_quaternion(compose(q, inverse(qref)))
            for age, q in nodes.items()
        }
        offset = len(records)
        records += sorted(relative.items())
        entries.append(
            {
                "entryId": f"plate-{plate}-ref-0",
                "plateId": plate,
                "storedCoordinateBasis": {
                    "kind": "supported-reference",
                    "geometryReferenceAgeMa": 0,
                },
                "youngestAgeMa": 0,
                "oldestAgeMa": 450,
                "sampleOffset": offset,
                "sampleCount": len(relative),
                "sourceIds": ["doi:10.5281/zenodo.13628813"],
                "sourceIntervals": [
                    {"youngestAgeMa": 0, "oldestAgeMa": 450, "kind": "smooth-motion"},
                    *[
                        {
                            "youngestAgeMa": age,
                            "oldestAgeMa": age,
                            "kind": "source-knot",
                        }
                        for age in clock
                    ],
                ],
            }
        )
    palette_binary = bytearray(32 + 20 * len(records))
    palette_binary[:4] = b"EHMP"
    struct.pack_into(
        "<HHIIIIII", palette_binary, 4, 2, 20, len(entries), len(records), 32, 0, 0, 0
    )
    for i, (age, q) in enumerate(records):
        struct.pack_into("<Iffff", palette_binary, 32 + 20 * i, round(age * 1e6), *q)
    palette_path = OUT / "motion-palette.bin"
    palette_path.write_bytes(palette_binary)
    palette = {
        "schemaVersion": 2,
        "id": PALETTE,
        "packageId": PACKAGE,
        "revision": REVISION,
        "frame": frame(),
        "binary": {
            "bytes": len(palette_binary),
            "sha256": sha(palette_path),
            "timeEncoding": "uint32-micro-ma",
            "quaternionEncoding": "float32-wxyz",
        },
        "entries": entries,
    }
    palette_json = OUT / "motion-palette.json"
    palette_json.write_text(json.dumps(palette, separators=(",", ":")) + "\n")
    core = {
        "schemaVersion": 2,
        "packageId": PACKAGE,
        "revision": REVISION,
        "frame": frame(),
        "charts": charts,
        "spatialBatches": [
            {
                "batchId": "batch-0",
                "vertexCount": len(directions),
                "triangleCount": len(triangles),
                "geometryAsset": asset(geometry),
                "encoding": "ehgb-v2-f32xyz-u32",
            }
        ],
    }
    core_path = OUT / "core.json"
    core_path.write_text(json.dumps(core, separators=(",", ":")) + "\n")
    checkpoints = []
    for age in AGES:
        checkpoint = {
            "schemaVersion": 2,
            "packageId": PACKAGE,
            "revision": REVISION,
            "frame": frame(),
            "ageMa": age,
            "batchControls": [
                {
                    "batchId": "batch-0",
                    "vertexCount": len(directions),
                    "state": {
                        "kind": "uniform",
                        "displayHeightMetres": 0,
                        "baseColorRgb": [104 / 255, 128 / 255, 82 / 255],
                    },
                }
            ],
        }
        path = OUT / f"checkpoint-{age:g}ma.json"
        path.write_text(json.dumps(checkpoint, separators=(",", ":")) + "\n")
        checkpoints.append({"ageMa": age, **asset(path)})
    manifest = {
        "schemaVersion": 2,
        "packageId": PACKAGE,
        "revision": REVISION,
        "frame": frame(),
        "ageDomainMa": {"youngest": 0, "oldest": 450},
        "core": asset(core_path),
        "motionPalette": {
            "id": PALETTE,
            "catalog": asset(palette_json),
            "binary": asset(palette_path),
        },
        "checkpoints": checkpoints,
        "scope": "twelve largest strict-motion native Cao patches active at both 0 and 450 Ma; integration evidence, not global coverage",
    }
    manifest_path = OUT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    stage = sum(p.stat().st_size for p in STAGE.rglob("*") if p.is_file())
    assert stage < policy["stageMaximumBytes"]
    print(
        json.dumps(
            {
                "charts": len(charts),
                "plates": len(entries),
                "vertices": len(directions),
                "triangles": len(triangles),
                "paletteRecords": len(records),
                "packageBytes": sum(p.stat().st_size for p in OUT.iterdir()),
                "stageBytes": stage,
            }
        )
    )


if __name__ == "__main__":
    main()
