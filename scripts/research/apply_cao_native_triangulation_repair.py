#!/usr/bin/env python3
"""Append the 15 recovered native Cao coast charts to a staged package."""

from __future__ import annotations

import argparse
import bisect
import copy
import hashlib
import json
import math
import os
import struct
import sys
from pathlib import Path
import cao_package_intern as package_intern


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = (ROOT / "public/data/reconstruction/cao-v2.4").resolve()
CONTRACT = ROOT / "data/corrections/australia-native-triangulation/source-contract.json"
MODEL = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
ROTATION_FILES = ("1000_0_rotfile.rot", "1800_1000_rotfile.rot")
HEADER_BYTES = 32
MOTION_RECORD_BYTES = 20
MAX_EDGE_RADIANS = math.radians(1)
MOTION_LIMIT_RAD = 1e-5
MOTION_TRAIN_RAD = 5e-6
PLATE_80104 = 80104
RECOVERY_MOTION_INTERVALS = {
    626: ((0.0, 79.1), (79.100001, 119.999999), (120.0, 130.0), (130.0, 505.0)),
    801: ((0.0, 1800.0),),
    8011: ((0.0, 1800.0),),
    8023: ((0.0, 1800.0),),
    80101: ((0.0, 1800.0),),
    80102: ((0.0, 1800.0),),
    80103: ((0.0, 1800.0),),
    80104: ((0.0, 130.0), (130.0, 505.0), (505.0, 1080.0),
            (1080.0, 1400.0), (1400.0, 1630.0), (1630.0, 1650.0)),
}
SOURCE_DISCONTINUITY_GAPS = {
    626: ((79.1, 79.100001), (119.999999, 120.0)),
}
SCOPE_CLAUSE = (
    " Fifteen source-native Cao coastline-class charts omitted by the former mixed-precision "
    "triangulation validator are restored with their authored lifecycles and unknown exposure."
)


class BuildError(ValueError):
    pass


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def asset(path: Path, url: str | None = None) -> dict:
    return {"url": url or path.name, "bytes": path.stat().st_size, "sha256": sha(path)}


def write_atomic(path: Path, payload: bytes) -> None:
    temporary = path.with_name(path.name + ".native-triangulation-stage")
    temporary.write_bytes(payload)
    os.replace(temporary, path)


def dot(left, right):
    return sum(a * b for a, b in zip(left, right))


def unit(vector):
    length = math.sqrt(dot(vector, vector))
    return tuple(value / length for value in vector)


def angle(left, right):
    return math.acos(max(-1.0, min(1.0, dot(unit(left), unit(right)))))


def midpoint(left, right):
    return struct.unpack("<fff", struct.pack("<fff", *unit(tuple(a + b for a, b in zip(left, right)))))


def age_id(age: float) -> str:
    return f"{age:.6f}".rstrip("0").rstrip(".")


def decode_ehgb(data: bytes) -> dict:
    if len(data) < HEADER_BYTES or data[:4] != b"EHGB":
        raise BuildError("invalid EHGB geometry")
    version, header, vertices, triangles, *reserved = struct.unpack_from("<HHIIIIII", data, 4)
    if (version, header) != (2, HEADER_BYTES) or any(reserved):
        raise BuildError("unsupported EHGB geometry header")
    if len(data) != HEADER_BYTES + 20 * vertices + 12 * triangles:
        raise BuildError("EHGB byte count changed")
    directions = [struct.unpack_from("<fff", data, HEADER_BYTES + 12 * index) for index in range(vertices)]
    offset = HEADER_BYTES + 12 * vertices
    seams = list(struct.unpack_from(f"<{vertices}I", data, offset)); offset += 4 * vertices
    charts = list(struct.unpack_from(f"<{vertices}I", data, offset)); offset += 4 * vertices
    indices = list(struct.unpack_from(f"<{3 * triangles}I", data, offset))
    return {"directions": directions, "seams": seams, "charts": charts, "indices": indices}


def encode_ehgb(directions, seams, charts, indices) -> bytes:
    vertices = len(directions)
    if len(seams) != vertices or len(charts) != vertices or len(indices) % 3:
        raise BuildError("inconsistent EHGB arrays")
    payload = bytearray(HEADER_BYTES + 20 * vertices + 4 * len(indices))
    payload[:4] = b"EHGB"
    struct.pack_into("<HHIIIIII", payload, 4, 2, HEADER_BYTES, vertices, len(indices) // 3, 0, 0, 0, 0)
    offset = HEADER_BYTES
    for row in directions:
        struct.pack_into("<fff", payload, offset, *row); offset += 12
    for rows in (seams, charts, indices):
        for value in rows:
            struct.pack_into("<I", payload, offset, value); offset += 4
    return bytes(payload)


def decode_palette(path: Path, catalog: dict) -> tuple[bytes, list[tuple]]:
    data = path.read_bytes()
    if len(data) < HEADER_BYTES or data[:4] != b"EHMP":
        raise BuildError("invalid motion palette")
    version, record_bytes, entries, samples, header, *reserved = struct.unpack_from("<HHIIIIII", data, 4)
    if ((version, record_bytes, entries, header) !=
            (2, MOTION_RECORD_BYTES, len(catalog["entries"]), HEADER_BYTES)
            or len(data) != HEADER_BYTES + samples * MOTION_RECORD_BYTES or any(reserved)):
        raise BuildError("motion palette header/catalog mismatch")
    records = [struct.unpack_from("<Iffff", data, HEADER_BYTES + index * MOTION_RECORD_BYTES)
               for index in range(samples)]
    return data, records


def encode_palette(catalog: dict, records: list[tuple]) -> bytes:
    payload = bytearray(HEADER_BYTES + MOTION_RECORD_BYTES * len(records))
    payload[:4] = b"EHMP"
    struct.pack_into("<HHIIIIII", payload, 4, 2, MOTION_RECORD_BYTES,
                     len(catalog["entries"]), len(records), HEADER_BYTES, 0, 0, 0)
    for index, record in enumerate(records):
        struct.pack_into("<Iffff", payload, HEADER_BYTES + index * MOTION_RECORD_BYTES, *record)
    return bytes(payload)


def refine(source: list[tuple], source_indices: list[int], chart_index: int) -> tuple[list, list]:
    directions = list(source)
    cache = {}
    stack = [tuple(source_indices[index:index + 3]) for index in range(0, len(source_indices), 3)]
    triangles = []
    while stack:
        a, b, c = stack.pop()
        edges = [(angle(directions[a], directions[b]), a, b, c),
                 (angle(directions[b], directions[c]), b, c, a),
                 (angle(directions[c], directions[a]), c, a, b)]
        length, left, right, opposite = max(edges)
        if length <= MAX_EDGE_RADIANS:
            triangles.extend((a, b, c))
            continue
        key = tuple(sorted((left, right)))
        middle = cache.get(key)
        if middle is None:
            middle = len(directions)
            directions.append(midpoint(directions[left], directions[right]))
            cache[key] = middle
        stack.extend(((left, middle, opposite), (middle, right, opposite)))
    return directions, triangles


def load_contract() -> dict:
    value = json.loads(CONTRACT.read_text())
    if value.get("schemaVersion") != 1 or value.get("correctionId") != "earthhistory-cao-native-triangulation-v1":
        raise BuildError("native triangulation contract identity changed")
    expected_plates = {str(plate): [list(interval) for interval in intervals]
                       for plate, intervals in RECOVERY_MOTION_INTERVALS.items()}
    if value.get("motion", {}).get("plates") != expected_plates:
        raise BuildError("native recovery motion interval contract changed")
    expected_gaps = [(plate, left, right) for plate, gaps in SOURCE_DISCONTINUITY_GAPS.items()
                     for left, right in gaps]
    actual_gaps = [(row.get("plateId"), row.get("youngestAgeMa"), row.get("oldestAgeMa"))
                   for row in value["motion"].get("sourceSeams", [])]
    if actual_gaps != expected_gaps:
        raise BuildError("native source-seam contract changed")
    return value


def load_stage(stage: Path, contract: dict) -> tuple[dict, list[tuple], tuple[int, ...]]:
    for name, expected in contract["stageAssets"].items():
        path = stage / name
        if not path.is_file() or asset(path) != {"url": name, **expected}:
            raise BuildError(f"frozen native stage changed: {name}")
    metadata = json.loads((stage / "coast-patches.json").read_text())
    raw = (stage / "coast-reference-directions.f32").read_bytes()
    values = struct.unpack(f"<{len(raw) // 4}f", raw)
    directions = [values[index:index + 3] for index in range(0, len(values), 3)]
    raw_indices = (stage / "coast-indices.u32").read_bytes()
    indices = struct.unpack(f"<{len(raw_indices) // 4}I", raw_indices)
    return metadata, directions, indices


def expected_targets(stage: Path, contract: dict) -> list[dict]:
    metadata, directions, indices = load_stage(stage, contract)
    by_id = {patch["chartId"]: patch for patch in metadata["patches"]}
    result = []
    for expected in contract["charts"]:
        patch = by_id.get(expected["chartId"])
        if patch is None or patch["status"] != "supported":
            raise BuildError(f"recovered source chart unavailable: {expected['chartId']}")
        mapping = {}
        local_source = []
        local_indices = []
        for cursor in range(patch["indexOffset"], patch["indexOffset"] + patch["indexCount"]):
            source_index = indices[cursor]
            if source_index not in mapping:
                mapping[source_index] = len(local_source)
                local_source.append(directions[source_index])
            local_indices.append(mapping[source_index])
        refined, triangles = refine(local_source, local_indices, 0)
        digest = hashlib.sha256(canonical({"directions": refined, "indices": triangles})).hexdigest()
        if (len(refined) != expected["refinedVertexCount"]
                or len(triangles) // 3 != expected["refinedTriangleCount"]
                or digest != expected["refinedGeometrySha256"]):
            raise BuildError(f"recovered chart refinement changed: {expected['chartId']}")
        result.append({"patch": patch, "directions": refined, "indices": triangles, "expected": expected})
    return result


def native_bindings(palette: dict, plate: int, youngest: float, oldest: float) -> list[dict]:
    rows = []
    for entry in palette["entries"]:
        if entry["plateId"] != plate or not entry["entryId"].startswith(f"native-recovery-plate-{plate}-"):
            continue
        lo, hi = max(youngest, entry["youngestAgeMa"]), min(oldest, entry["oldestAgeMa"])
        if lo <= hi:
            rows.append({"paletteId": palette["id"], "entryId": entry["entryId"],
                         "validTimeMa": {"youngest": lo, "oldest": hi}})
    return sorted(rows, key=lambda row: (row["validTimeMa"]["youngest"], row["validTimeMa"]["oldest"]))


def validate_binding_coverage(bindings: list[dict], plate: int, youngest: float, oldest: float) -> None:
    if not bindings or bindings[0]["validTimeMa"]["youngest"] != youngest or bindings[-1]["validTimeMa"]["oldest"] != oldest:
        raise BuildError(f"native motion does not cover plate {plate} over {youngest}-{oldest}")
    for left, right in zip(bindings, bindings[1:]):
        left_age = left["validTimeMa"]["oldest"]
        right_age = right["validTimeMa"]["youngest"]
        if left_age == right_age:
            continue
        if (left_age, right_age) in SOURCE_DISCONTINUITY_GAPS.get(plate, ()):
            continue
        raise BuildError(f"unexpected native motion gap for plate {plate}: {left_age}-{right_age}")


def motion_support_gaps(plate: int, youngest: float, oldest: float) -> list[dict]:
    return [
        {
            "validTimeMa": {"youngest": left, "oldest": right},
            "youngestExclusive": True,
            "oldestExclusive": True,
            "reason": "source-seam",
            "sourceIds": ["doi:10.5281/zenodo.13628813"],
        }
        for left, right in SOURCE_DISCONTINUITY_GAPS.get(plate, ())
        if youngest <= left and right <= oldest
    ]


def extract_chart_geometry(decoded: dict, chart_index: int) -> dict:
    """Return one chart's local mesh and reject cross-chart triangles."""
    vertices = [index for index, value in enumerate(decoded["charts"]) if value == chart_index]
    if not vertices:
        raise BuildError(f"chart {chart_index}: recovered native chart geometry absent")
    mapping = {global_index: local for local, global_index in enumerate(vertices)}
    local_indices = []
    for offset in range(0, len(decoded["indices"]), 3):
        triangle = decoded["indices"][offset:offset + 3]
        owners = {decoded["charts"][vertex] for vertex in triangle}
        if chart_index in owners:
            if owners != {chart_index}:
                raise BuildError(f"chart {chart_index}: mixed triangle ownership")
            local_indices.extend(mapping[vertex] for vertex in triangle)
    return {
        "directions": [decoded["directions"][value] for value in vertices],
        "indices": local_indices,
    }


def chart(patch: dict, palette: dict) -> dict:
    youngest = max(0.0, 0.0 if patch["lifecycle"]["youngestAgeMa"] is None else patch["lifecycle"]["youngestAgeMa"])
    oldest = min(1800.0, 1800.0 if patch["lifecycle"]["oldestAgeMa"] is None else patch["lifecycle"]["oldestAgeMa"])
    bindings = native_bindings(palette, patch["plateId"], youngest, oldest)
    validate_binding_coverage(bindings, patch["plateId"], youngest, oldest)
    result = {
        "kind": "rigid", "role": "model-geography", "chartId": patch["chartId"],
        "chartRevision": "cao-foundation-v2", "materialId": patch["materialId"],
        "fragmentOrCohortId": patch["fragmentOrCohortId"],
        "lifecycle": {"validTimeMa": {"youngest": youngest, "oldest": oldest}},
        "geometryReferenceAgeMa": 0, "motionBindings": bindings,
        "sourceFeatureIds": patch["sourceFeatureIds"], "sourceFeatureTypes": patch["sourceFeatureTypes"],
        "evidence": {"status": "model-output",
                     "sourceIds": ["doi:10.5281/zenodo.13628813", *patch["sourceFeatureIds"]],
                     "limitations": ["native Cao foundation; surface exposure remains unknown",
                                     "Cao coastline-class model geometry is not observed exposed land",
                                     "physical height unknown; renderer-only shell offsets are not source elevation"]},
        "surfaceEvidence": {"kind": "unknown",
                            "reason": "native Cao coastline-class geometry; exposed-land and height evidence unavailable"},
    }
    gaps = motion_support_gaps(patch["plateId"], youngest, oldest)
    if gaps:
        result["motionSupportGaps"] = gaps
    return result


def motion_modules():
    sys.path.insert(0, str(ROOT / "scripts/research"))
    import emit_cao_foundation_package as emitter
    import pygplates
    return emitter, emitter.load_coordinate(), pygplates


def validate_source_discontinuities(rotation, cp, global_clock: list[float]) -> list[dict]:
    measured = []
    for plate, intervals in RECOVERY_MOTION_INTERVALS.items():
        youngest = min(row[0] for row in intervals)
        oldest = max(row[1] for row in intervals)
        for age in global_clock:
            if not youngest < age < oldest:
                continue
            younger = cp.exact_quaternion(rotation, age - 1e-6, plate)
            exact = cp.exact_quaternion(rotation, age, plate)
            older = cp.exact_quaternion(rotation, age + 1e-6, plate)
            if None in (younger, exact, older):
                continue
            for left, right, error in (
                (age - 1e-6, age, cp.angular_rotation_error(younger, exact)),
                (age, age + 1e-6, cp.angular_rotation_error(exact, older)),
            ):
                if error > MOTION_LIMIT_RAD:
                    measured.append({
                        "plateId": plate,
                        "youngestAgeMa": round(left, 6),
                        "oldestAgeMa": round(right, 6),
                        "jumpRad": error,
                    })
    declared = [(plate, left, right) for plate, gaps in SOURCE_DISCONTINUITY_GAPS.items()
                for left, right in gaps]
    actual = [(row["plateId"], row["youngestAgeMa"], row["oldestAgeMa"]) for row in measured]
    if actual != declared:
        raise BuildError(f"native source-discontinuity inventory changed: {actual}")
    return measured


def append_recovery_motion(palette: dict, records: list[tuple]) -> dict:
    if any(entry["entryId"].startswith("native-recovery-plate-") for entry in palette["entries"]):
        raise BuildError("native recovery motion already exists")
    emitter, cp, pygplates = motion_modules()
    rotation = pygplates.RotationModel([str(MODEL / name) for name in ROTATION_FILES], default_anchor_plate_id=0)
    global_clock = sorted({age for name in ROTATION_FILES
                           for age in cp.all_source_rotation_times(MODEL / name, 0, 1800)})
    source_discontinuities = validate_source_discontinuities(rotation, cp, global_clock)
    added = []
    maximum = (0.0, None)
    for plate, intervals in RECOVERY_MOTION_INTERVALS.items():
        qref = cp.exact_quaternion(rotation, 0, plate)
        if qref is None:
            raise BuildError(f"plate {plate} lacks an exact present reference")
        inverse = emitter.inverse(qref)
        for youngest, oldest in intervals:
            source_knots = sorted({youngest, oldest, *(age for age in global_clock if youngest <= age <= oldest)})
            seeds = sorted({max(youngest, min(oldest, age + delta))
                            for age in source_knots for delta in (-1e-6, 0, 1e-6)})
            exact_seeds = {age: cp.exact_quaternion(rotation, age, plate) for age in seeds}
            if any(value is None for value in exact_seeds.values()):
                raise BuildError(f"plate {plate} strict motion gap {youngest}-{oldest}")
            nodes = {age: cp.float32_quaternion(value) for age, value in exact_seeds.items()}

            def train(left, right, depth=0):
                # EHMP time is integer micro-Ma. A source seam can change its
                # finite-rotation segment across that smallest encodable step.
                if right - left <= 1.0000001e-6:
                    return
                probes = []
                for fraction in (0.25, 0.5, 0.75):
                    age = left + (right - left) * fraction
                    exact = cp.exact_quaternion(rotation, age, plate)
                    probes.append((cp.angular_rotation_error(
                        exact, cp.slerp(nodes[left], nodes[right], fraction)
                    ), age, exact))
                if max(row[0] for row in probes) <= MOTION_TRAIN_RAD:
                    return
                if depth >= 24:
                    raise BuildError(f"plate {plate} motion refinement did not converge at {left}-{right}")
                middle = probes[1][1]
                nodes[middle] = cp.float32_quaternion(probes[1][2])
                train(left, middle, depth + 1)
                train(middle, right, depth + 1)

            for left, right in zip(seeds, seeds[1:]):
                train(left, right)
            ordered = sorted(nodes.items())
            offset = len(records)
            for age, absolute in ordered:
                relative = cp.float32_quaternion(emitter.compose(absolute, inverse))
                records.append((round(age * 1e6), *relative))
            entry_id = f"native-recovery-plate-{plate}-{age_id(youngest)}-{age_id(oldest)}"
            smooth = {"youngestAgeMa": youngest, "oldestAgeMa": oldest, "kind": "smooth-motion"}
            interval_id = f"native-recovery-clock-{plate}-{age_id(youngest)}-{age_id(oldest)}"
            interval = {"id": interval_id, "intervals": [smooth, *(
                {"youngestAgeMa": age, "oldestAgeMa": age, "kind": "source-knot"}
                for age in source_knots
            )]}
            palette["sourceIntervalSets"].append(interval)
            palette["entries"].append({
                "entryId": entry_id, "plateId": plate,
                "storedCoordinateBasis": {"kind": "supported-reference", "geometryReferenceAgeMa": 0},
                "youngestAgeMa": youngest, "oldestAgeMa": oldest, "sampleOffset": offset,
                "sampleCount": len(ordered), "sourceIds": ["doi:10.5281/zenodo.13628813"],
                "sourceIntervalSetId": interval["id"],
            })
            ages = [age for age, _ in ordered]
            relative_nodes = [records[offset + index][1:] for index in range(len(ordered))]
            probes = {quarter / 4 for quarter in range(math.ceil(youngest * 4), math.floor(oldest * 4) + 1)}
            probes.update(seeds)
            for age in probes:
                exact = cp.float32_quaternion(emitter.compose(cp.exact_quaternion(rotation, age, plate), inverse))
                index = bisect.bisect_left(ages, age)
                if index < len(ages) and ages[index] == age:
                    estimate = relative_nodes[index]
                else:
                    left, right = index - 1, index
                    estimate = cp.slerp(relative_nodes[left], relative_nodes[right],
                                        (age - ages[left]) / (ages[right] - ages[left]))
                error = cp.angular_rotation_error(exact, estimate)
                if error > maximum[0]:
                    maximum = error, age, plate, entry_id
            added.append(entry_id)
    if maximum[0] > MOTION_LIMIT_RAD:
        raise BuildError(f"native recovery motion oracle failed: {maximum}")
    return {"entryIds": added, "records": sum(row["sampleCount"] for row in palette["entries"][-len(added):]),
            "maximumAngularResidualRad": maximum[0], "worstAgeMa": maximum[1],
            "worstPlateId": maximum[2], "worstEntryId": maximum[3],
            "sourceDiscontinuities": source_discontinuities}


def rebind_existing_charts(core: dict, palette: dict) -> list[str]:
    entry_plate = {entry["entryId"]: entry["plateId"] for entry in palette["entries"]}
    affected = []
    for row in core["charts"]:
        old = [binding for binding in row.get("motionBindings", [])
               if (entry_plate.get(binding["entryId"]) in RECOVERY_MOTION_INTERVALS
                   and binding["entryId"].startswith(f"plate-{entry_plate[binding['entryId']]}-"))]
        if not old:
            continue
        plates = {entry_plate[binding["entryId"]] for binding in old}
        if len(plates) != 1 or len(old) != len(row["motionBindings"]):
            raise BuildError(f"mixed affected native motion bindings on {row['chartId']}")
        plate = plates.pop()
        youngest = min(binding["validTimeMa"]["youngest"] for binding in old)
        oldest = max(binding["validTimeMa"]["oldest"] for binding in old)
        replacement = native_bindings(palette, plate, youngest, oldest)
        validate_binding_coverage(replacement, plate, youngest, oldest)
        row["motionBindings"] = replacement
        gaps = motion_support_gaps(plate, youngest, oldest)
        if gaps:
            row["motionSupportGaps"] = gaps
        else:
            row.pop("motionSupportGaps", None)
        affected.append(row["chartId"])
    return affected


def update_checkpoints(package: Path, manifest: dict, vertex_count: int) -> None:
    for descriptor in manifest["checkpoints"]:
        path = package / descriptor["url"]
        value = json.loads(path.read_text())
        control = next(row for row in value["batchControls"] if row["batchId"] == "batch-land")
        control["vertexCount"] = vertex_count
        write_atomic(path, canonical(value))
        descriptor.update({"bytes": path.stat().st_size, "sha256": sha(path)})


def apply(package: Path, stage: Path) -> dict:
    package = package.resolve()
    if package == PUBLIC:
        raise BuildError("--apply requires an explicit staging package; public in-place writes are rejected")
    contract = load_contract()
    targets = expected_targets(stage, contract)
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    palette_path, palette_binary_path = package / "motion-palette.json", package / "motion-palette.bin"
    core, manifest, palette = (package_intern.read_package_json(core_path),
                               json.loads(manifest_path.read_text()), json.loads(palette_path.read_text()))
    target_ids = {row["chartId"] for row in contract["charts"]}
    if target_ids & {row["chartId"] for row in core["charts"]}:
        raise BuildError("native triangulation repair already applied")
    if manifest["core"] != asset(core_path) or manifest["motionPalette"]["catalog"] != asset(palette_path):
        raise BuildError("package catalog identities are stale")
    old_core = copy.deepcopy(core["charts"])
    old_entries = copy.deepcopy(palette["entries"])
    old_intervals = copy.deepcopy(palette["sourceIntervalSets"])
    old_binary, records = decode_palette(palette_binary_path, palette)
    motion = append_recovery_motion(palette, records)
    rebound_charts = rebind_existing_charts(core, palette)
    expected_rebound = contract["motion"]["reboundExistingChartCount"]
    if len(rebound_charts) != expected_rebound:
        raise BuildError(f"existing same-plate motion consumer count changed: {len(rebound_charts)}")
    land_batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-land")
    land_path = package / land_batch["geometryAsset"]["url"]
    original = decode_ehgb(land_path.read_bytes())
    directions, seams, chart_indices, indices = (list(original[key]) for key in ("directions", "seams", "charts", "indices"))
    added_charts = []
    for target in targets:
        chart_index = len(core["charts"])
        vertex_offset = len(directions)
        directions.extend(target["directions"])
        seams.extend(2_300_000_000 + index for index in range(vertex_offset, len(directions)))
        chart_indices.extend([chart_index] * len(target["directions"]))
        indices.extend(vertex_offset + value for value in target["indices"])
        row = chart(target["patch"], palette)
        core["charts"].append(row); added_charts.append(row["chartId"])
    write_atomic(land_path, encode_ehgb(directions, seams, chart_indices, indices))
    land_batch.update({"vertexCount": len(directions), "triangleCount": len(indices) // 3,
                       "geometryAsset": asset(land_path)})
    palette_binary = encode_palette(palette, records)
    write_atomic(palette_binary_path, palette_binary)
    palette["binary"] = asset(palette_binary_path)
    write_atomic(palette_path, canonical(palette))
    write_atomic(core_path, canonical(package_intern.intern_charts(core)))
    manifest["core"] = asset(core_path)
    manifest["motionPalette"]["catalog"] = asset(palette_path)
    manifest["motionPalette"]["binary"] = asset(palette_binary_path)
    if SCOPE_CLAUSE.strip() not in manifest["scope"]:
        manifest["scope"] += SCOPE_CLAUSE
    update_checkpoints(package, manifest, len(directions))
    write_atomic(manifest_path, canonical(manifest))
    result = validate_applied(package, stage=stage, original_geometry=original, original_charts=old_core,
                              old_entries=old_entries, old_intervals=old_intervals, old_binary=old_binary)
    result.update({"addedChartIds": added_charts, "reboundExistingChartIds": rebound_charts, "motion": motion})
    return result


def validate_applied(package: Path, *, stage: Path | None = None, original_geometry=None,
                     original_charts=None, old_entries=None, old_intervals=None, old_binary=None) -> dict:
    contract = load_contract()
    core_path, manifest_path = package / "core.json", package / "manifest.json"
    palette_path, palette_binary_path = package / "motion-palette.json", package / "motion-palette.bin"
    core, manifest, palette = (package_intern.read_package_json(core_path),
                               json.loads(manifest_path.read_text()), json.loads(palette_path.read_text()))
    if (manifest["core"] != asset(core_path) or manifest["motionPalette"]["catalog"] != asset(palette_path)
            or manifest["motionPalette"]["binary"] != asset(palette_binary_path)):
        raise BuildError("applied native package identities are stale")
    matches = [(index, row) for index, row in enumerate(core["charts"])
               if row["chartId"] in {value["chartId"] for value in contract["charts"]}]
    if len(matches) != len(contract["charts"]):
        raise BuildError("recovered native chart inventory changed")
    land_batch = next(row for row in core["spatialBatches"] if row["batchId"] == "batch-land")
    land_path = package / land_batch["geometryAsset"]["url"]
    if land_batch["geometryAsset"] != asset(land_path):
        raise BuildError("native land geometry identity is stale")
    decoded = decode_ehgb(land_path.read_bytes())
    if land_batch["vertexCount"] != len(decoded["directions"]) or land_batch["triangleCount"] != len(decoded["indices"]) // 3:
        raise BuildError("native land counts are stale")
    if stage is not None:
        targets = expected_targets(stage, contract)
        expected_rows = [chart(target["patch"], palette) for target in targets]
        if [row for _, row in matches] != expected_rows:
            raise BuildError("recovered native chart semantics changed")
        for (chart_index, _), target in zip(matches, targets):
            actual = extract_chart_geometry(decoded, chart_index)
            digest = hashlib.sha256(canonical(actual)).hexdigest()
            if digest != target["expected"]["refinedGeometrySha256"]:
                raise BuildError("recovered native chart geometry changed")
    else:
        expected_by_id = {row["chartId"]: row for row in contract["charts"]}
        for chart_index, actual_chart in matches:
            expected = expected_by_id[actual_chart["chartId"]]
            patch = {
                "chartId": expected["chartId"],
                "materialId": expected["chartId"],
                "fragmentOrCohortId": expected["chartId"],
                "plateId": expected["plateId"],
                "lifecycle": expected["sourceLifecycle"],
                "sourceFeatureIds": expected["sourceFeatureIds"],
                "sourceFeatureTypes": expected["sourceFeatureTypes"],
            }
            if actual_chart != chart(patch, palette):
                raise BuildError("recovered native chart semantics changed")
            actual = extract_chart_geometry(decoded, chart_index)
            digest = hashlib.sha256(canonical(actual)).hexdigest()
            if (len(actual["directions"]) != expected["refinedVertexCount"]
                    or len(actual["indices"]) // 3 != expected["refinedTriangleCount"]
                    or digest != expected["refinedGeometrySha256"]):
                raise BuildError("recovered native chart geometry changed")
    binary, _ = decode_palette(palette_binary_path, palette)
    entries = [row for row in palette["entries"] if row["entryId"].startswith("native-recovery-plate-")]
    expected_intervals = [(plate, youngest, oldest) for plate, intervals in RECOVERY_MOTION_INTERVALS.items()
                          for youngest, oldest in intervals]
    if (len(entries) != len(expected_intervals)
            or [(row["plateId"], row["youngestAgeMa"], row["oldestAgeMa"]) for row in entries] != expected_intervals):
        raise BuildError("native recovery motion inventory changed")
    intervals_by_id = {row["id"]: row for row in palette["sourceIntervalSets"]}
    expected_motion = contract["motion"].get("entries")
    if not isinstance(expected_motion, list) or len(expected_motion) != len(entries):
        raise BuildError("native recovery motion payload contract is incomplete")
    for entry, expected in zip(entries, expected_motion):
        selected = {key: entry[key] for key in (
            "entryId", "plateId", "youngestAgeMa", "oldestAgeMa", "sampleCount",
            "sourceIntervalSetId",
        )}
        if selected != {key: expected[key] for key in selected}:
            raise BuildError("native recovery motion entry contract changed")
        start = HEADER_BYTES + entry["sampleOffset"] * MOTION_RECORD_BYTES
        end = start + entry["sampleCount"] * MOTION_RECORD_BYTES
        if hashlib.sha256(binary[start:end]).hexdigest() != expected["sampleBytesSha256"]:
            raise BuildError(f"native recovery motion samples changed: {entry['entryId']}")
        interval = intervals_by_id.get(entry["sourceIntervalSetId"])
        if (interval is None or hashlib.sha256(canonical(interval)).hexdigest()
                != expected["sourceIntervalSetSha256"]):
            raise BuildError(f"native recovery source intervals changed: {entry['entryId']}")
    if original_geometry is not None:
        count, triangle_count = len(original_geometry["directions"]), len(original_geometry["indices"])
        if any(decoded[key][:count] != original_geometry[key] for key in ("directions", "seams", "charts")):
            raise BuildError("existing native land vertices changed")
        if decoded["indices"][:triangle_count] != original_geometry["indices"]:
            raise BuildError("existing native land triangles changed")
    if original_charts is not None:
        expected_core = {"charts": copy.deepcopy(original_charts)}
        rebound = rebind_existing_charts(expected_core, palette)
        if (len(rebound) != contract["motion"]["reboundExistingChartCount"]
                or core["charts"][:len(original_charts)] != expected_core["charts"]):
            raise BuildError("existing chart changes exceed the qualified motion rebinding")
    if old_entries is not None and palette["entries"][:len(old_entries)] != old_entries:
        raise BuildError("existing palette entry prefix changed")
    if old_intervals is not None and palette["sourceIntervalSets"][:len(old_intervals)] != old_intervals:
        raise BuildError("existing source interval prefix changed")
    if old_binary is not None:
        samples = struct.unpack_from("<I", old_binary, 12)[0]
        end = HEADER_BYTES + samples * MOTION_RECORD_BYTES
        if binary[HEADER_BYTES:end] != old_binary[HEADER_BYTES:end]:
            raise BuildError("existing motion sample prefix changed")
    old_prefixes = tuple(f"plate-{plate}-" for plate in RECOVERY_MOTION_INTERVALS)
    stale = [row["chartId"] for row in core["charts"]
             if any(binding["entryId"].startswith(old_prefixes) for binding in row.get("motionBindings", []))]
    if stale:
        raise BuildError(f"same-plate charts retain inaccurate native motion: {stale[:3]}")
    recovery_consumers = []
    entry_plate = {row["entryId"]: row["plateId"] for row in palette["entries"]}
    for row in core["charts"]:
        bindings = row.get("motionBindings", [])
        recovery = [binding for binding in bindings
                    if binding["entryId"].startswith("native-recovery-plate-")]
        if not recovery:
            continue
        if recovery != bindings:
            raise BuildError(f"mixed recovery motion bindings on {row['chartId']}")
        plates = {entry_plate.get(binding["entryId"]) for binding in bindings}
        if len(plates) != 1 or None in plates:
            raise BuildError(f"invalid recovery motion plate on {row['chartId']}")
        plate = plates.pop()
        lifecycle = row["lifecycle"]["validTimeMa"]
        expected_bindings = native_bindings(
            palette, plate, lifecycle["youngest"], lifecycle["oldest"]
        )
        validate_binding_coverage(bindings, plate, lifecycle["youngest"], lifecycle["oldest"])
        if bindings != expected_bindings:
            raise BuildError(f"recovery motion binding partition changed on {row['chartId']}")
        if row.get("motionSupportGaps", []) != motion_support_gaps(
                plate, lifecycle["youngest"], lifecycle["oldest"]):
            raise BuildError(f"source-seam support metadata changed on {row['chartId']}")
        recovery_consumers.append(row["chartId"])
    expected_consumers = contract["motion"]["reboundExistingChartCount"] + len(contract["charts"])
    if len(recovery_consumers) != expected_consumers:
        raise BuildError(f"native recovery consumer count changed: {len(recovery_consumers)}")
    return {"charts": len(matches), "landVertices": len(decoded["directions"]),
            "landTriangles": len(decoded["indices"]) // 3, "recoveryMotionEntries": len(entries),
            "recoveryMotionConsumers": len(recovery_consumers)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--stage", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.apply and (args.package is None or args.stage is None):
        parser.error("--apply requires explicit --package and --stage")
    package = args.package.resolve() if args.package else PUBLIC
    result = apply(package, args.stage) if args.apply else validate_applied(package, stage=args.stage)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
