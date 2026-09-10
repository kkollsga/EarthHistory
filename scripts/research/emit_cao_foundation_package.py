#!/usr/bin/env python3
"""Emit the bounded native-Cao 0-540 Ma foundation package."""

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
    / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1/full-package"
)
STAGE = OUT.parent
AGES = [float(age) for age in range(0, 541, 5)]
LIMIT = math.radians(1)
PACKAGE = "cao-v2.4-foundation-v1"
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


def clipped_lifecycle(patch):
    youngest = patch["lifecycle"]["youngestAgeMa"]
    oldest = patch["lifecycle"]["oldestAgeMa"]
    return max(0.0, 0.0 if youngest is None else youngest), min(
        540.0, 540.0 if oldest is None else oldest
    )


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
    global_clock = sorted({age for name in ROTATION_FILES
                           for age in cp.all_source_rotation_times(MODEL / name, 0, 540)})
    clock_by_plate = {}

    def plate_clock(plate, youngest, oldest):
        key = (plate, youngest, oldest)
        if key not in clock_by_plate:
            ages = sorted({youngest, oldest, *(age for age in global_clock if youngest <= age <= oldest)})
            clock_by_plate[key] = (ages, [])
        return clock_by_plate[key]
    eligible = []
    palette_nodes = {}
    for patch in meta["patches"]:
        if patch["status"] != "supported":
            continue
        plate = patch["plateId"]
        if plate is None:
            continue
        youngest, oldest = clipped_lifecycle(patch)
        if youngest > oldest:
            continue
        eligible.append((patch, youngest, oldest))

    # Recursively isolate unsupported circuits and source discontinuities. A
    # failure removes only its local source-clock leaf, never the whole plate.
    def qualify(plate, ages):
        if len(ages) < 2:
            return []
        key = (plate, ages[0], ages[-1])
        try:
            if any(cp.exact_quaternion(rotation, age, plate) is None for age in ages):
                raise ValueError("missing strict circuit")
            palette_nodes[key] = adaptive(cp, rotation, plate, ages)
            return [key]
        except ValueError:
            if len(ages) == 2:
                return []
            middle = len(ages) // 2
            return qualify(plate, ages[: middle + 1]) + qualify(plate, ages[middle:])

    plate_components = {}
    for plate in sorted({patch["plateId"] for patch, _, _ in eligible}):
        plate_components[plate] = qualify(plate, global_clock)

    def bindings_for(patch, youngest, oldest):
        bindings = []
        for plate, left, right in plate_components[patch["plateId"]]:
            lo, hi = max(youngest, left), min(oldest, right)
            if lo <= hi:
                bindings.append({"paletteId": PALETTE, "entryId": f"plate-{plate}-{left:.6g}-{right:.6g}",
                                 "validTimeMa": {"youngest": lo, "oldest": hi}})
        return bindings

    selected = sorted((row for row in eligible if bindings_for(*row)), key=lambda row: row[0]["patchId"])
    charts = []
    directions = []
    seams = []
    vertex_charts = []
    triangles = []
    for chart_index, (patch, youngest, oldest) in enumerate(selected):
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
                "lifecycle": {"validTimeMa": {"youngest": youngest, "oldest": oldest}},
                "geometryReferenceAgeMa": 0,
                "motionBindings": bindings_for(patch, youngest, oldest),
                "sourceFeatureIds": patch["sourceFeatureIds"],
                "sourceFeatureTypes": patch["sourceFeatureTypes"],
                "evidence": {
                    "status": "model-output",
                    "sourceIds": [
                        "doi:10.5281/zenodo.13628813",
                        *patch["sourceFeatureIds"],
                    ],
                    "limitations": [
                        "native Cao foundation; surface exposure remains unknown",
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
    interval_sets = []
    interval_ids = {}
    used_entry_ids = {binding["entryId"] for chart in charts for binding in chart["motionBindings"]}
    for plate, youngest, oldest in sorted(key for values in plate_components.values() for key in values
                                          if f"plate-{key[0]}-{key[1]:.6g}-{key[2]:.6g}" in used_entry_ids):
        nodes = palette_nodes[(plate, youngest, oldest)]
        qref = cp.exact_quaternion(rotation, 0, plate)
        basis_kind = "supported-reference" if qref is not None else "virtual-coordinate-origin"
        relative = {age: (cp.float32_quaternion(compose(q, inverse(qref))) if qref is not None else q)
                    for age, q in nodes.items()}
        offset = len(records)
        records += sorted(relative.items())
        source_knots = tuple(plate_clock(plate, youngest, oldest)[0])
        interval_key = (youngest, oldest, source_knots)
        if interval_key not in interval_ids:
            interval_id = f"clock-{len(interval_sets)}"
            interval_ids[interval_key] = interval_id
            interval_sets.append({"id": interval_id, "intervals": [
                {"youngestAgeMa": youngest, "oldestAgeMa": oldest, "kind": "smooth-motion"},
                *[{"youngestAgeMa": age, "oldestAgeMa": age, "kind": "source-knot"}
                  for age in source_knots],
            ]})
        entries.append(
            {
                "entryId": f"plate-{plate}-{youngest:.6g}-{oldest:.6g}",
                "plateId": plate,
                "storedCoordinateBasis": {
                    "kind": basis_kind,
                    "geometryReferenceAgeMa": 0,
                },
                "youngestAgeMa": youngest,
                "oldestAgeMa": oldest,
                "sampleOffset": offset,
                "sampleCount": len(relative),
                "sourceIds": ["doi:10.5281/zenodo.13628813"],
                "sourceIntervalSetId": interval_ids[interval_key],
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
        "sourceIntervalSets": interval_sets,
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
        "ageDomainMa": {"youngest": 0, "oldest": 540},
        "core": asset(core_path),
        "motionPalette": {
            "id": PALETTE,
            "catalog": asset(palette_json),
            "binary": asset(palette_path),
        },
        "checkpoints": checkpoints,
        "scope": "native Cao coastline-class model geometry over strict 0-540 Ma motion support; surface exposure, relief, and seafloor age remain unknown",
    }
    manifest_path = OUT / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
    selected_ids = {patch["patchId"] for patch, _, _ in selected}
    omissions = []
    for patch in meta["patches"]:
        if patch["status"] != "supported":
            reason = patch["status"]
        elif patch["patchId"] not in selected_ids:
            youngest, oldest = clipped_lifecycle(patch)
            probes = [age for age in AGES if youngest <= age <= oldest]
            missing = [age for age in probes if patch["plateId"] is None
                       or cp.exact_quaternion(rotation, age, patch["plateId"]) is None]
            reason = "missing-strict-rotation-circuit" if missing else "motion-interpolation-qualification-failed"
        else:
            continue
        omissions.append({"patchId": patch["patchId"], "sourceFeatureIds": patch["sourceFeatureIds"],
                          "plateId": patch["plateId"], "sourceAreaSteradians": patch["sourceAreaSteradians"],
                          "reason": reason, **({"representativeMissingAgesMa": missing[:8]}
                                               if patch["status"] == "supported" and missing else {})})
    def chart_active(chart, age):
        life = chart["lifecycle"]["validTimeMa"]
        return life["youngest"] <= age <= life["oldest"] and any(
            binding["validTimeMa"]["youngest"] <= age <= binding["validTimeMa"]["oldest"]
            for binding in chart["motionBindings"])
    active_counts = {str(int(age)): sum(chart_active(chart, age) for chart in charts) for age in AGES}
    coverage = {"schemaVersion": 1, "sourceTriangulatedParts": sum(p["status"] == "supported" for p in meta["patches"]),
                "exportedCharts": len(charts), "omittedParts": omissions, "activeChartCounts": active_counts,
                "maximumActiveCharts": max(active_counts.values()),
                "limitations": ["coastline-class geometry is not exposed-land evidence",
                                "strict motion is complete for every triangulated source part in the 0-540 Ma domain", "17 source rings remain line-only"]}
    (OUT / "compiler-coverage.json").write_text(json.dumps(coverage, separators=(",", ":")) + "\n")
    stage = sum(p.stat().st_size for p in STAGE.rglob("*") if p.is_file())
    assert stage < policy["stageMaximumBytes"]
    print(
        json.dumps(
            {
                "charts": len(charts),
                "paletteEntries": len(entries),
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
