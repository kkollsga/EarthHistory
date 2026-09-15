#!/usr/bin/env python3
"""Validate and apply the North Sea rigid UK-block restoration to a Cao package.

The contract (``data/corrections/north-sea-restoration/restoration-contract.json``,
written by ``north_sea_restoration_fit.py``) names one Euler pole, an angle
schedule and the UK-side charts. ``--apply`` on a staging package appends one
restoration palette entry per block plate whose samples are the native Cao
rotation composed with the restoration rotation, rebinds the listed charts to
those entries inside the window, and leaves every other chart, palette byte and
geometry asset untouched. ``--validate-applied`` re-derives the oracle from the
Cao rotation files and the contract and checks the closure witnesses.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import struct
import sys
import tempfile
from pathlib import Path

import pygplates

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_cao_shelf_lifecycle_422 as shelf422  # noqa: E402
import emit_cao_foundation_package as foundation  # noqa: E402
import cao_package_intern as package_intern


ROOT = Path(__file__).resolve().parents[2]
MODEL = foundation.MODEL
CONTRACT = ROOT / "data/corrections/north-sea-restoration/restoration-contract.json"
DEFAULT_PACKAGE = ROOT / "public/data/reconstruction/cao-v2.4"
REPORT = ROOT / "docs/research/north-sea-restoration-validation.json"
CORRECTION_ID = "earthhistory-north-sea-restoration-v1"
HEADER_BYTES = 32
RECORD_BYTES = 20
SAMPLE_STEP_MA = 1.0
ORACLE_STEP_MA = 0.25
ORACLE_LIMIT_RAD = 2e-4
FIXED_LIMITATION = ("North Sea regional restoration (earthhistory-north-sea-restoration-v1): this Tornquist "
                    "Block chart follows Baltica's native motion from 130 Ma back; the model's 0.59 degree "
                    "Tornquist stage, which drifted one copy of Denmark 40 km south-west from 170 Ma, is dropped")
LIMITATION = ("North Sea regional restoration (earthhistory-north-sea-restoration-v1): between 130 and "
              "430 Ma this chart follows a rigid UK-block rotation relative to Baltica that closes the "
              "Shetland-Bergen transect by the published Mesozoic extension; a regional model hypothesis, "
              "not a deforming reconstruction")
SCOPE_CLAUSE = ("The North Sea rift is restored between 130 and 430 Ma by a rigid UK-block rotation "
                "relative to Baltica (regional model hypothesis; straddling shelf polygons stay on Baltica).")
CP = foundation.load_coordinate()
EARTH_RADIUS_KM = 6371.0088


class BuildError(ValueError):
    pass


def lon_lat_direction(lon, lat):
    a, b = math.radians(lon), math.radians(lat)
    return (math.cos(b) * math.cos(a), math.cos(b) * math.sin(a), math.sin(b))


def axis_angle_quaternion(axis, angle_degrees):
    half = math.radians(angle_degrees) / 2
    s = math.sin(half)
    return (math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s)


def rotate(q, v):
    w, x, y, z = q
    tx = 2 * (y * v[2] - z * v[1])
    ty = 2 * (z * v[0] - x * v[2])
    tz = 2 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx))


def angular_km(a, b):
    return math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))) * EARTH_RADIUS_KM


def schedule_angle(contract: dict, age: float) -> float:
    rows = contract["angleSchedule"]
    if age <= rows[0]["ageMa"]:
        return rows[0]["angleDegrees"]
    for younger, older in zip(rows, rows[1:]):
        if younger["ageMa"] <= age <= older["ageMa"]:
            span = older["ageMa"] - younger["ageMa"]
            fraction = 0.0 if span == 0 else (age - younger["ageMa"]) / span
            return younger["angleDegrees"] + fraction * (older["angleDegrees"] - younger["angleDegrees"])
    return rows[-1]["angleDegrees"]


def restoration_quaternion(contract: dict, age: float):
    axis = lon_lat_direction(*contract["pole"]["lonLat"])
    return axis_angle_quaternion(axis, schedule_angle(contract, age))


def exact_composed(contract: dict, rotation, plate: int, age: float):
    """Native Cao rotation of `plate` (the entry's motion plate) composed with the restoration."""
    native = CP.exact_quaternion(rotation, age, plate)
    if native is None:
        raise BuildError(f"plate {plate}: no strict Cao rotation at {age} Ma")
    reference = CP.exact_quaternion(rotation, 0, plate)
    relative_native = foundation.compose(native, foundation.inverse(reference))
    return foundation.compose(relative_native, restoration_quaternion(contract, age))


def load_contract() -> dict:
    contract = json.loads(CONTRACT.read_text())
    if contract.get("schemaVersion") != 1 or contract.get("correctionId") != CORRECTION_ID:
        raise BuildError("contract identity changed")
    window = contract["windowMa"]
    rows = contract["angleSchedule"]
    if (rows[0]["ageMa"] != 0 or rows[0]["angleDegrees"] != 0
            or any(older["ageMa"] <= younger["ageMa"] for younger, older in zip(rows, rows[1:]))
            or rows[-1]["ageMa"] != window["oldest"]
            or any(row["angleDegrees"] != 0 for row in rows if row["ageMa"] <= window["youngest"])):
        raise BuildError("angle schedule must start at zero, increase in age, stay zero through the window start and end at the window oldest age")
    pairs = contract["witnesses"]["pairs"]
    tolerance = contract["witnesses"]["toleranceKm"]
    for row in rows:
        q = restoration_quaternion(contract, row["ageMa"])
        for name, pair in pairs.items():
            moving = lon_lat_direction(*pair["movingLonLat"])
            fixed = lon_lat_direction(*pair["fixedLonLat"])
            closure = angular_km(moving, fixed) - angular_km(rotate(q, moving), fixed)
            if abs(closure - row["witnessClosureKm"][name]) > 0.01:
                raise BuildError(f"schedule row {row['ageMa']} Ma does not reproduce witness {name}")
        if abs(row["witnessClosureKm"]["Shetland-Bergen"] - row["shetlandBergenClosureKm"]) > 0.01:
            raise BuildError(f"schedule row {row['ageMa']} Ma disagrees with its closure authority")
    if not contract["charts"]:
        raise BuildError("contract names no charts")
    for entry in contract["paletteEntries"]:
        # An entry runs from the window start to the oldest pinned chart on its
        # plate; 315 charts end at 420 Ma, inside the schedule, and stay closed.
        if (entry["plateId"] not in contract["blockPlateIds"] or entry["youngestAgeMa"] != window["youngest"]
                or entry["oldestAgeMa"] <= window["youngest"]):
            raise BuildError("palette entry must start at the window on a block plate")
    return contract


def load_package(package: Path):
    core_path = package / "core.json"
    palette_path = package / "motion-palette.json"
    binary_path = package / "motion-palette.bin"
    manifest_path = package / "manifest.json"
    core = package_intern.read_package_json(core_path)
    palette = json.loads(palette_path.read_text())
    manifest = json.loads(manifest_path.read_text())
    for descriptor, path in ((manifest["core"], core_path), (manifest["motionPalette"]["catalog"], palette_path),
                             (manifest["motionPalette"]["binary"], binary_path)):
        if (descriptor["url"] != path.name or descriptor["bytes"] != path.stat().st_size
                or descriptor["sha256"] != shelf422.sha(path)):
            raise BuildError(f"{path.name}: package asset identity mismatch")
    binary, records = shelf422.decode_palette(binary_path, palette)
    return core, palette, manifest, binary, records


def check_source_knots(contract: dict, rotation_path: Path) -> None:
    window = contract["windowMa"]
    knots = set(CP.all_source_rotation_times(rotation_path, window["youngest"], window["oldest"]))
    if window["youngest"] not in knots or window["oldest"] not in knots:
        raise BuildError("restoration window must start and end on native rotation knots")


def check(package: Path) -> dict:
    contract = load_contract()
    core, palette, manifest, _binary, _records = load_package(package)
    check_source_knots(contract, MODEL / foundation.ROTATION_FILES[0])
    chart_by_id = {chart["chartId"]: (index, chart) for index, chart in enumerate(core["charts"])}
    entry_plate = {entry["entryId"]: entry["plateId"] for entry in palette["entries"]}
    applied = any(entry["entryId"].startswith("restoration-north-sea-") for entry in palette["entries"])
    for row in contract["charts"]:
        match = chart_by_id.get(row["chartId"])
        if match is None or match[0] != row["chartIndex"]:
            raise BuildError(f"{row['chartId']}: pinned chart identity changed")
        chart = match[1]
        plates = {entry_plate[b["entryId"]] for b in chart["motionBindings"]
                  if not b["entryId"].startswith("restoration-north-sea-")}
        if plates != {row["plateId"]}:
            raise BuildError(f"{row['chartId']}: chart plate changed")
        if chart["lifecycle"]["validTimeMa"]["oldest"] != row["lifecycleOldestMa"]:
            raise BuildError(f"{row['chartId']}: lifecycle changed")
        if not applied:
            bindings = [[b["entryId"], b["validTimeMa"]["youngest"], b["validTimeMa"]["oldest"]]
                        for b in chart["motionBindings"]]
            if bindings != row["bindings"]:
                raise BuildError(f"{row['chartId']}: native motion bindings changed")
    return {"contract": CORRECTION_ID, "charts": len(contract["charts"]), "applied": applied,
            "pole": contract["pole"]["lonLat"], "windowMa": contract["windowMa"]}


def entry_ages(contract: dict, spec: dict) -> list[float]:
    youngest, oldest = spec["youngestAgeMa"], spec["oldestAgeMa"]
    knots = CP.all_source_rotation_times(MODEL / foundation.ROTATION_FILES[0], youngest, oldest)
    ages = set(knots) | {row["ageMa"] for row in contract["angleSchedule"] if youngest <= row["ageMa"] <= oldest}
    age = youngest
    while age <= oldest:
        ages.add(round(age, 6))
        age += SAMPLE_STEP_MA
    return sorted(ages)


def build_entries(contract: dict, rotation, palette: dict, records: list):
    appended = []
    for spec in contract["paletteEntries"]:
        plate = spec["plateId"]
        ages = entry_ages(contract, spec)
        rows = [(round(age * 1_000_000), *CP.float32_quaternion(
                    exact_composed(contract, rotation, spec["motionPlateId"], age))) for age in ages]
        offset = len(records)
        records.extend(rows)
        entry = {
            "entryId": spec["entryId"], "plateId": plate,
            "storedCoordinateBasis": {"kind": "supported-reference", "geometryReferenceAgeMa": 0},
            "youngestAgeMa": spec["youngestAgeMa"], "oldestAgeMa": spec["oldestAgeMa"],
            "sampleOffset": offset, "sampleCount": len(rows),
            "sourceIds": ["doi:10.5281/zenodo.13628813", CORRECTION_ID],
            "sourceIntervalSetId": spec["sourceIntervalSetId"],
        }
        palette["entries"].append(entry)
        appended.append(entry)
        palette["sourceIntervalSets"].append({
            "id": spec["sourceIntervalSetId"],
            "intervals": [{"youngestAgeMa": spec["youngestAgeMa"], "oldestAgeMa": spec["oldestAgeMa"], "kind": "smooth-motion"},
                          *({"youngestAgeMa": a, "oldestAgeMa": a, "kind": "source-knot"} for a in ages)],
        })
    return appended


def native_partition(palette: dict, plate: int, youngest: float, oldest: float):
    """Gap-free native (plate-*) entries of `plate` covering [youngest, oldest]."""
    entries = sorted((e for e in palette["entries"] if e["plateId"] == plate and e["entryId"].startswith("plate-")),
                     key=lambda e: (e["youngestAgeMa"], e["oldestAgeMa"]))
    rows = []
    cursor = youngest
    while cursor < oldest:
        match = [e for e in entries if e["youngestAgeMa"] <= cursor < e["oldestAgeMa"]]
        if len(match) != 1:
            raise BuildError(f"plate {plate}: expected one native entry at {cursor} Ma, found {len(match)}")
        nxt = min(match[0]["oldestAgeMa"], oldest)
        rows.append((match[0]["entryId"], cursor, nxt))
        cursor = nxt
    return rows


def expected_bindings(contract: dict, palette: dict, row: dict, oldest: float):
    window = contract["windowMa"]
    kept = [[e, lo, hi] for e, lo, hi in row["bindings"] if hi <= window["youngest"]]
    kept += [[e, lo, window["youngest"]] for e, lo, hi in row["bindings"] if lo < window["youngest"] < hi]
    if row["kind"] == "moving":
        entry_id = next(e["entryId"] for e in contract["paletteEntries"] if e["plateId"] == row["plateId"])
        kept.append([entry_id, window["youngest"], oldest])
    else:
        kept += [[e, lo, hi] for e, lo, hi in native_partition(palette, contract["fixedBinding"]["plateId"],
                                                              window["youngest"], oldest)]
    kept.sort(key=lambda b: b[1])
    return kept


def rebind(contract: dict, palette: dict, row: dict, chart: dict) -> None:
    oldest = chart["lifecycle"]["validTimeMa"]["oldest"]
    chart["motionBindings"] = [{"paletteId": palette["id"], "entryId": e,
                                "validTimeMa": {"youngest": lo, "oldest": hi}}
                               for e, lo, hi in expected_bindings(contract, palette, row, oldest)]
    if row["kind"] == "fixed":
        if chart["role"] != "country-reference" and FIXED_LIMITATION not in chart["evidence"]["limitations"]:
            chart["evidence"]["limitations"].append(FIXED_LIMITATION)
        return
    # Country locator charts keep the evidence text the segment-bridge contract
    # pins; the restoration provenance lives on the land charts and the contract.
    if chart["role"] == "country-reference":
        return
    if LIMITATION not in chart["evidence"]["limitations"]:
        chart["evidence"]["limitations"].append(LIMITATION)
    for source_id in contract["sourceIds"]:
        if source_id not in chart["evidence"]["sourceIds"]:
            chart["evidence"]["sourceIds"].append(source_id)


def apply(package: Path) -> dict:
    contract = load_contract()
    core, palette, manifest, binary, records = load_package(package)
    check(package)
    if any(entry["entryId"].startswith("restoration-north-sea-") for entry in palette["entries"]):
        raise BuildError("North Sea restoration entries already exist")
    before_core = copy.deepcopy(core)
    before_entries = copy.deepcopy(palette["entries"])
    before_sets = copy.deepcopy(palette["sourceIntervalSets"])
    rotation = pygplates.RotationModel([str(MODEL / name) for name in foundation.ROTATION_FILES],
                                       default_anchor_plate_id=0)
    base_count = len(records)
    appended = build_entries(contract, rotation, palette, records)
    rows_by_id = {row["chartId"]: row for row in contract["charts"]}
    for chart in core["charts"]:
        row = rows_by_id.get(chart["chartId"])
        if row is not None:
            rebind(contract, palette, row, chart)
    changed = [index for index, (before, after) in enumerate(zip(before_core["charts"], core["charts"])) if before != after]
    if changed != sorted(row["chartIndex"] for row in contract["charts"]) or core["spatialBatches"] != before_core["spatialBatches"]:
        raise BuildError("restoration changed charts or geometry outside the pinned list")
    out_binary = bytearray(HEADER_BYTES + RECORD_BYTES * len(records))
    out_binary[:4] = b"EHMP"
    struct.pack_into("<HHIIIIII", out_binary, 4, 2, RECORD_BYTES, len(palette["entries"]), len(records), HEADER_BYTES, 0, 0, 0)
    for index, record in enumerate(records):
        struct.pack_into("<Iffff", out_binary, HEADER_BYTES + RECORD_BYTES * index, *record)
    if (palette["entries"][:len(before_entries)] != before_entries
            or palette["sourceIntervalSets"][:len(before_sets)] != before_sets
            or out_binary[HEADER_BYTES:len(binary)] != binary[HEADER_BYTES:]):
        raise BuildError("existing palette entries, interval sets, or sample bytes changed")
    (package / "motion-palette.bin").write_bytes(out_binary)
    palette["binary"]["bytes"] = len(out_binary)
    palette["binary"]["sha256"] = shelf422.sha256(bytes(out_binary))
    (package / "motion-palette.json").write_bytes(shelf422.canonical(palette))
    (package / "core.json").write_bytes(shelf422.canonical(core))
    manifest["core"] = shelf422.asset(package / "core.json")
    manifest["motionPalette"]["catalog"] = shelf422.asset(package / "motion-palette.json")
    manifest["motionPalette"]["binary"] = shelf422.asset(package / "motion-palette.bin")
    if SCOPE_CLAUSE not in manifest["scope"]:
        manifest["scope"] = f"{manifest['scope']} {SCOPE_CLAUSE}"
    (package / "manifest.json").write_bytes(shelf422.canonical(manifest))
    return {"changedChartIndices": changed, "appendedMotionEntries": [e["entryId"] for e in appended],
            "appendedMotionSamples": len(records) - base_count,
            "core": manifest["core"], "motionPaletteCatalog": manifest["motionPalette"]["catalog"],
            "motionPaletteBinary": manifest["motionPalette"]["binary"]}


def validate_applied(package: Path) -> dict:
    contract = load_contract()
    core, palette, _manifest, _binary, records = load_package(package)
    entry_by_id = {entry["entryId"]: entry for entry in palette["entries"]}
    chart_by_id = {chart["chartId"]: chart for chart in core["charts"]}
    window = contract["windowMa"]
    rotation = pygplates.RotationModel([str(MODEL / name) for name in foundation.ROTATION_FILES],
                                       default_anchor_plate_id=0)
    # Bindings: window replaced by the restoration entry, native parts clipped.
    for row in contract["charts"]:
        chart = chart_by_id.get(row["chartId"])
        if chart is None:
            raise BuildError(f"{row['chartId']}: chart missing")
        oldest = chart["lifecycle"]["validTimeMa"]["oldest"]
        expected = expected_bindings(contract, palette, row, oldest)
        actual = [[b["entryId"], b["validTimeMa"]["youngest"], b["validTimeMa"]["oldest"]] for b in chart["motionBindings"]]
        if actual != expected:
            raise BuildError(f"{row['chartId']}: restored bindings {actual} != {expected}")
        wanted = LIMITATION if row["kind"] == "moving" else FIXED_LIMITATION
        if chart["role"] != "country-reference" and wanted not in chart["evidence"]["limitations"]:
            raise BuildError(f"{row['chartId']}: restoration limitation missing")
    # Oracle: every quarter-Myr and every knot neighbour reproduces the composed rotation.
    oracle_max = (0.0, None, None)
    for spec in contract["paletteEntries"]:
        entry = entry_by_id.get(spec["entryId"])
        if entry is None or entry["plateId"] != spec["plateId"]:
            raise BuildError(f"{spec['entryId']}: palette entry missing")
        lo, hi = spec["youngestAgeMa"], spec["oldestAgeMa"]
        ages = {lo + ORACLE_STEP_MA * k for k in range(int((hi - lo) / ORACLE_STEP_MA) + 1)}
        for sample in records[entry["sampleOffset"]:entry["sampleOffset"] + entry["sampleCount"]]:
            knot = sample[0] / 1_000_000
            ages.update(a for a in (knot - 0.000001, knot, knot + 0.000001) if lo <= a <= hi)
        for age in sorted(ages):
            error = shelf422.angular(exact_composed(contract, rotation, spec["motionPlateId"], age),
                                     shelf422.quaternion_at(entry, records, age))
            if error > oracle_max[0]:
                oracle_max = (error, age, spec["plateId"])
    if oracle_max[0] > ORACLE_LIMIT_RAD:
        raise BuildError(f"restoration motion residual {oracle_max} exceeds {ORACLE_LIMIT_RAD} rad")
    # Closure witnesses against the reference plate's native entry.
    reference = next(e for e in palette["entries"] if e["plateId"] == contract["referencePlateId"]
                     and e["entryId"].startswith("plate-") and e["youngestAgeMa"] <= 0 and e["oldestAgeMa"] >= window["oldest"])
    witness_rows = []
    for row in contract["angleSchedule"]:
        age = row["ageMa"]
        if not window["youngest"] <= age <= window["oldest"]:
            continue
        q_ref = shelf422.quaternion_at(reference, records, age)
        for name, pair in contract["witnesses"]["pairs"].items():
            block_entry = entry_by_id[next(e["entryId"] for e in contract["paletteEntries"]
                                           if e["plateId"] == pair["movingPlateId"])]
            if not block_entry["youngestAgeMa"] <= age <= block_entry["oldestAgeMa"]:
                continue
            q_block = shelf422.quaternion_at(block_entry, records, age)
            moving = lon_lat_direction(*pair["movingLonLat"])
            fixed = lon_lat_direction(*pair["fixedLonLat"])
            closure = angular_km(moving, fixed) - angular_km(rotate(q_block, moving), rotate(q_ref, fixed))
            expected = row["witnessClosureKm"][name]
            witness_rows.append({"ageMa": age, "pair": name, "closureKm": round(closure, 3), "expectedKm": expected})
            if abs(closure - expected) > contract["witnesses"]["toleranceKm"]:
                raise BuildError(f"witness {name} at {age} Ma: closure {closure:.2f} km, expected {expected} km")
    return {"maximumMotionResidualRad": oracle_max[0], "maximumResidualAgeMa": oracle_max[1],
            "maximumResidualPlateId": oracle_max[2], "witnesses": witness_rows,
            "appliedCoreSha256": shelf422.sha(package / "core.json")}


def self_test(package: Path) -> dict:
    contract = load_contract()
    rejected = 0

    def expect_contract_failure(label, mutate):
        nonlocal rejected
        document = copy.deepcopy(contract)
        mutate(document)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(document, handle)
            path = Path(handle.name)
        global CONTRACT
        original = CONTRACT
        CONTRACT = path
        try:
            load_contract()
        except BuildError:
            rejected += 1
        else:
            raise BuildError(f"self-test: contract mutation {label!r} was accepted")
        finally:
            CONTRACT = original
            path.unlink()

    def move_pole(document):
        document["pole"]["lonLat"][0] += 1.0

    def tamper_angle(document):
        document["angleSchedule"][-1]["angleDegrees"] *= 0.9

    def open_window_start(document):
        document["angleSchedule"][1]["angleDegrees"] = 0.5

    expect_contract_failure("pole moved", move_pole)
    expect_contract_failure("angle tampered", tamper_angle)
    expect_contract_failure("motion inside the quiescent window", open_window_start)

    applied = any(entry["entryId"].startswith("restoration-north-sea-")
                  for entry in json.loads((package / "motion-palette.json").read_text())["entries"])
    result = {"contractMutationsRejected": rejected, "applied": applied}
    if applied:
        with tempfile.TemporaryDirectory(prefix="earthhistory-north-sea-") as scratch:
            stage = Path(scratch) / "package"
            stage.mkdir()
            for name in ("core.json", "motion-palette.json", "motion-palette.bin", "manifest.json"):
                (stage / name).write_bytes((package / name).read_bytes())
            data = bytearray((stage / "motion-palette.bin").read_bytes())
            palette = json.loads((stage / "motion-palette.json").read_text())
            entry = next(e for e in palette["entries"] if e["entryId"].startswith("restoration-north-sea-plate-303"))
            offset = HEADER_BYTES + RECORD_BYTES * (entry["sampleOffset"] + entry["sampleCount"] // 2) + 8
            value = struct.unpack_from("<f", data, offset)[0]
            struct.pack_into("<f", data, offset, value + 0.01)
            (stage / "motion-palette.bin").write_bytes(bytes(data))
            manifest = json.loads((stage / "manifest.json").read_text())
            manifest["motionPalette"]["binary"] = shelf422.asset(stage / "motion-palette.bin")
            (stage / "manifest.json").write_bytes(shelf422.canonical(manifest))
            try:
                validate_applied(stage)
            except BuildError:
                result["appliedMutationRejected"] = True
            else:
                raise BuildError("self-test: a tampered restoration sample was accepted")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--validate-applied", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--report", action="store_true")
    args = parser.parse_args()
    if args.apply and (args.package is None or args.package.resolve() == DEFAULT_PACKAGE.resolve()):
        parser.error("--apply requires an explicit non-public staging --package directory")
    package = args.package or DEFAULT_PACKAGE
    if args.self_test:
        result = self_test(package)
    elif args.apply:
        result = apply(package)
        result |= validate_applied(package)
    elif args.validate_applied:
        result = validate_applied(package)
    else:
        result = check(package)
    if args.report:
        REPORT.write_text(json.dumps({"correctionId": CORRECTION_ID, "validatedAt": "2026-09-14", **result},
                                     indent=2, sort_keys=True) + "\n")
    print(json.dumps(result, indent=2, sort_keys=True, default=str))


if __name__ == "__main__":
    main()
