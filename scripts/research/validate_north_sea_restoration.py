#!/usr/bin/env python3
"""Validate the North Sea rigid UK-block restoration from a clean checkout.

Pure-Python (no pyGPlates): checks the tracked contract's internal geometry,
then the applied public package: restoration palette entries, the rebinding of
every pinned UK-side chart, the closure witnesses evaluated from the packaged
palette samples, and the pyGPlates oracle record written by
``apply_north_sea_restoration.py --validate-applied --report`` against the
current core identity. ``--self-test`` proves each check can fail.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import struct
from pathlib import Path
import cao_package_intern as package_intern


ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "data/corrections/north-sea-restoration/restoration-contract.json"
REPORT = ROOT / "docs/research/north-sea-restoration-validation.json"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
CORRECTION_ID = "earthhistory-north-sea-restoration-v1"
HEADER_BYTES = 32
RECORD_BYTES = 20
EARTH_RADIUS_KM = 6371.0088
ORACLE_LIMIT_RAD = 2e-4
LIMITATION_PREFIX = "North Sea regional restoration (earthhistory-north-sea-restoration-v1)"


class ValidationError(ValueError):
    pass


def fail(label: str, message: str) -> None:
    raise ValidationError(f"{label}: {message}")


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def unit(q):
    n = math.sqrt(sum(c * c for c in q))
    return tuple(c / n for c in q)


def slerp(a, b, t):
    dot = sum(x * y for x, y in zip(a, b))
    if dot < 0:
        b = tuple(-c for c in b)
        dot = -dot
    if dot > 0.9995:
        return unit(tuple(x + t * (y - x) for x, y in zip(a, b)))
    theta = math.acos(dot)
    sa, sb = math.sin((1 - t) * theta) / math.sin(theta), math.sin(t * theta) / math.sin(theta)
    return tuple(sa * x + sb * y for x, y in zip(a, b))


def decode_palette(package: Path):
    palette = json.loads((package / "motion-palette.json").read_text())
    data = (package / "motion-palette.bin").read_bytes()
    magic, version, record_bytes, entry_count, record_count = struct.unpack_from("<4sHHII", data, 0)
    if magic != b"EHMP" or version != 2 or record_bytes != RECORD_BYTES or entry_count != len(palette["entries"]):
        fail("motion-palette.bin", "header does not match the catalog")
    records = [struct.unpack_from("<Iffff", data, HEADER_BYTES + RECORD_BYTES * i) for i in range(record_count)]
    return palette, records


def quaternion_at(entry, records, age_ma):
    rows = records[entry["sampleOffset"]:entry["sampleOffset"] + entry["sampleCount"]]
    target = round(age_ma * 1_000_000)
    for row in rows:
        if row[0] == target:
            return unit(row[1:])
    for younger, older in zip(rows, rows[1:]):
        if younger[0] < target < older[0]:
            return slerp(unit(younger[1:]), unit(older[1:]), (target - younger[0]) / (older[0] - younger[0]))
    fail(entry["entryId"], f"no sample brackets {age_ma} Ma")


def restoration_quaternion(contract: dict, age: float):
    rows = contract["angleSchedule"]
    angle = rows[-1]["angleDegrees"]
    if age <= rows[0]["ageMa"]:
        angle = rows[0]["angleDegrees"]
    else:
        for younger, older in zip(rows, rows[1:]):
            if younger["ageMa"] <= age <= older["ageMa"]:
                span = older["ageMa"] - younger["ageMa"]
                fraction = 0.0 if span == 0 else (age - younger["ageMa"]) / span
                angle = younger["angleDegrees"] + fraction * (older["angleDegrees"] - younger["angleDegrees"])
                break
    return axis_angle_quaternion(lon_lat_direction(*contract["pole"]["lonLat"]), angle)


def validate_contract(contract: dict) -> None:
    if contract.get("schemaVersion") != 1 or contract.get("correctionId") != CORRECTION_ID:
        fail("contract", "identity changed")
    window = contract["windowMa"]
    rows = contract["angleSchedule"]
    if (rows[0]["ageMa"] != 0 or rows[0]["angleDegrees"] != 0
            or any(older["ageMa"] <= younger["ageMa"] for younger, older in zip(rows, rows[1:]))
            or rows[-1]["ageMa"] != window["oldest"]
            or any(row["angleDegrees"] != 0 for row in rows if row["ageMa"] <= window["youngest"])):
        fail("angleSchedule", "must start at zero, increase in age, stay zero through the window start and end at the window oldest age")
    if window["oldest"] > 430 or window["youngest"] < 130:
        fail("windowMa", "must stay inside the 130-430 Ma rigid-Baltica interval")
    pairs = contract["witnesses"]["pairs"]
    for row in rows:
        q = restoration_quaternion(contract, row["ageMa"])
        for name, pair in pairs.items():
            moving = lon_lat_direction(*pair["movingLonLat"])
            fixed = lon_lat_direction(*pair["fixedLonLat"])
            closure = angular_km(moving, fixed) - angular_km(rotate(q, moving), fixed)
            if abs(closure - row["witnessClosureKm"][name]) > 0.01:
                fail(f"angleSchedule[{row['ageMa']}]", f"does not reproduce witness {name}")
        if abs(row["witnessClosureKm"]["Shetland-Bergen"] - row["shetlandBergenClosureKm"]) > 0.01:
            fail(f"angleSchedule[{row['ageMa']}]", "disagrees with its closure authority")
    final = rows[-1]["shetlandBergenClosureKm"]
    if not 55 <= final <= 90:
        fail("angleSchedule", f"total Shetland-Bergen closure {final} km left the published 55-90 km range")
    allowed = set(contract["blockPlateIds"]) | {contract["tornquistPlateId"]}
    if not contract["charts"] or {row["plateId"] for row in contract["charts"]} - allowed:
        fail("charts", "empty or outside the block and Tornquist plates")
    if any(row["kind"] not in ("moving", "fixed") for row in contract["charts"]):
        fail("charts", "unknown chart kind")
    if ({entry["plateId"] for entry in contract["paletteEntries"]} != set(contract["blockPlateIds"])
            or any(entry["youngestAgeMa"] != window["youngest"] or entry["oldestAgeMa"] <= window["youngest"]
                   for entry in contract["paletteEntries"])):
        fail("paletteEntries", "one entry per block plate starting at the window is required")
    for entry in contract["paletteEntries"]:
        charts = [row for row in contract["charts"] if row["plateId"] == entry["plateId"] and row["kind"] == "moving"]
        if not charts or max(row["lifecycleOldestMa"] for row in charts) != entry["oldestAgeMa"]:
            fail(entry["entryId"], "entry must end at the oldest pinned moving chart lifecycle on its plate")


def native_partition(palette: dict, plate: int, youngest: float, oldest: float):
    """Gap-free native (``plate-*``) entries of `plate` covering [youngest, oldest].

    The partition ``apply_north_sea_restoration.native_partition`` binds and the one the
    country-outline emitter tiles a chart's lifetime with, so a chart's pre-restoration
    bindings can be re-derived here without pyGPlates.
    """
    entries = sorted((e for e in palette["entries"] if e["plateId"] == plate and e["entryId"].startswith("plate-")),
                     key=lambda e: (e["youngestAgeMa"], e["oldestAgeMa"]))
    rows, cursor = [], youngest
    while cursor < oldest:
        match = [e for e in entries if e["youngestAgeMa"] <= cursor < e["oldestAgeMa"]]
        if len(match) != 1:
            fail("nativePartition", f"expected one native entry on plate {plate} at {cursor} Ma")
        nxt = min(match[0]["oldestAgeMa"], oldest)
        rows.append([match[0]["entryId"], cursor, nxt])
        cursor = nxt
    return rows


def expected_bindings(contract: dict, palette: dict, row: dict, oldest: float):
    """The motion bindings a pinned chart must carry once the restoration is applied.

    Below the window start the chart keeps the pre-restoration bindings the contract
    recorded; from the window start a ``moving`` chart takes its plate's restoration
    entry and a ``fixed`` one the reference plate's native (``plate-*``) partition --
    the rule ``apply_north_sea_restoration.py`` applies to the native charts and
    ``emit_cao_country_reference.py`` restates for the re-emitted outline charts. One
    owner here, so the validator, the re-index and the two emitters cannot drift.
    """
    window = contract["windowMa"]
    expected = [[entry, lo, hi] for entry, lo, hi in row["bindings"] if hi <= window["youngest"]]
    expected += [[entry, lo, window["youngest"]] for entry, lo, hi in row["bindings"]
                 if lo < window["youngest"] < hi]
    if row["kind"] == "moving":
        entry_id = next((e["entryId"] for e in contract["paletteEntries"] if e["plateId"] == row["plateId"]), None)
        if entry_id is None:
            fail(row["chartId"], f"no restoration entry for plate {row['plateId']}")
        expected.append([entry_id, window["youngest"], oldest])
    else:
        expected += native_partition(palette, contract["fixedBinding"]["plateId"], window["youngest"], oldest)
    expected.sort(key=lambda b: b[1])
    return expected


def validate_package(contract: dict, package: Path) -> dict:
    core = package_intern.read_package_json(package / "core.json")
    manifest = json.loads((package / "manifest.json").read_text())
    if manifest["core"]["sha256"] != sha(package / "core.json"):
        fail("manifest.core", "core identity mismatch")
    palette, records = decode_palette(package)
    entry_by_id = {entry["entryId"]: entry for entry in palette["entries"]}
    window = contract["windowMa"]
    for spec in contract["paletteEntries"]:
        entry = entry_by_id.get(spec["entryId"])
        if (entry is None or entry["plateId"] != spec["plateId"] or entry["youngestAgeMa"] != spec["youngestAgeMa"]
                or entry["oldestAgeMa"] != spec["oldestAgeMa"] or entry["sampleCount"] < 100
                or CORRECTION_ID not in entry["sourceIds"]
                or entry["sourceIntervalSetId"] != spec["sourceIntervalSetId"]):
            fail(spec["entryId"], "restoration palette entry missing or changed")
        if not any(s["id"] == spec["sourceIntervalSetId"] for s in palette["sourceIntervalSets"]):
            fail(spec["entryId"], "restoration clock missing")
    chart_by_id = {chart["chartId"]: (index, chart) for index, chart in enumerate(core["charts"])}
    for row in contract["charts"]:
        match = chart_by_id.get(row["chartId"])
        if match is None or match[0] != row["chartIndex"]:
            fail(row["chartId"], "pinned chart identity changed")
        chart = match[1]
        oldest = chart["lifecycle"]["validTimeMa"]["oldest"]
        if oldest != row["lifecycleOldestMa"]:
            fail(row["chartId"], "lifecycle changed")
        expected = expected_bindings(contract, palette, row, oldest)
        actual = [[b["entryId"], b["validTimeMa"]["youngest"], b["validTimeMa"]["oldest"]] for b in chart["motionBindings"]]
        if actual != expected:
            fail(row["chartId"], f"bindings {actual} != {expected}")
        if chart["role"] != "country-reference" and not any(
                text.startswith(LIMITATION_PREFIX) for text in chart["evidence"]["limitations"]):
            fail(row["chartId"], "restoration limitation missing from evidence")
        if row["kind"] == "fixed" and any(b["entryId"].startswith("restoration-north-sea-") for b in chart["motionBindings"]):
            fail(row["chartId"], "a Baltica-fixed chart binds a restoration entry")
    # No other chart may bind a restoration entry.
    pinned = {row["chartId"] for row in contract["charts"]}
    for chart in core["charts"]:
        if chart["chartId"] in pinned:
            continue
        if any(b["entryId"].startswith("restoration-north-sea-") for b in chart["motionBindings"]):
            fail(chart["chartId"], "unpinned chart binds a restoration entry")
    # Closure witnesses from the packaged samples.
    reference = next(e for e in palette["entries"] if e["plateId"] == contract["referencePlateId"]
                     and e["entryId"].startswith("plate-") and e["youngestAgeMa"] <= 0 and e["oldestAgeMa"] >= window["oldest"])
    if not reference["entryId"].startswith("plate-"):
        fail("reference plate", "Baltica must keep its native palette entry")
    witnesses = []
    for row in contract["angleSchedule"]:
        age = row["ageMa"]
        if not window["youngest"] <= age <= window["oldest"]:
            continue
        q_ref = quaternion_at(reference, records, age)
        for name, pair in contract["witnesses"]["pairs"].items():
            block = entry_by_id[next(e["entryId"] for e in contract["paletteEntries"]
                                     if e["plateId"] == pair["movingPlateId"])]
            if not block["youngestAgeMa"] <= age <= block["oldestAgeMa"]:
                continue
            q_block = quaternion_at(block, records, age)
            moving = lon_lat_direction(*pair["movingLonLat"])
            fixed = lon_lat_direction(*pair["fixedLonLat"])
            closure = angular_km(moving, fixed) - angular_km(rotate(q_block, moving), rotate(q_ref, fixed))
            if abs(closure - row["witnessClosureKm"][name]) > contract["witnesses"]["toleranceKm"]:
                fail(f"witness {name} at {age} Ma", f"closure {closure:.2f} km, expected {row['witnessClosureKm'][name]} km")
            witnesses.append((age, name, round(closure, 3)))
    # The pyGPlates oracle record must describe this core.
    report = json.loads(REPORT.read_text())
    if (report.get("correctionId") != CORRECTION_ID or report.get("appliedCoreSha256") != manifest["core"]["sha256"]
            or report.get("maximumMotionResidualRad", math.inf) > ORACLE_LIMIT_RAD):
        fail("oracle record", "docs/research/north-sea-restoration-validation.json does not describe this core within tolerance")
    return {"charts": len(contract["charts"]), "witnesses": len(witnesses),
            "maximumMotionResidualRad": report["maximumMotionResidualRad"]}


def self_test(package: Path) -> dict:
    contract = json.loads(CONTRACT.read_text())
    validate_contract(contract)
    rejected = 0
    for label, mutate in (
        ("pole moved", lambda c: c["pole"]["lonLat"].__setitem__(0, c["pole"]["lonLat"][0] + 1.0)),
        ("angle tampered", lambda c: c["angleSchedule"][-1].__setitem__("angleDegrees", c["angleSchedule"][-1]["angleDegrees"] * 0.9)),
        ("quiescent window moved", lambda c: c["angleSchedule"][1].__setitem__("angleDegrees", 0.5)),
        ("window past the Caledonian seam", lambda c: (c["windowMa"].__setitem__("oldest", 431), c["angleSchedule"][-1].__setitem__("ageMa", 431))),
        ("closure outside the published range", lambda c: [r.__setitem__("shetlandBergenClosureKm", r["shetlandBergenClosureKm"] * 2) for r in c["angleSchedule"]]),
    ):
        document = copy.deepcopy(contract)
        mutate(document)
        try:
            validate_contract(document)
        except ValidationError:
            rejected += 1
        else:
            raise ValidationError(f"self-test: contract mutation {label!r} was accepted")
    result = {"contractMutationsRejected": rejected}
    if (package / "motion-palette.json").is_file():
        validate_package(contract, package)
        document = copy.deepcopy(contract)
        document["charts"][0]["bindings"][0][2] = 129.0
        try:
            validate_package(document, package)
        except ValidationError:
            pass
        document = copy.deepcopy(contract)
        fixed = next(row for row in document["charts"] if row["kind"] == "fixed")
        fixed["kind"] = "moving"
        try:
            validate_package(document, package)
        except ValidationError:
            result["packageMutationRejected"] = True
        else:
            raise ValidationError("self-test: a changed chart binding was accepted")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=PUBLIC)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--contract-only", action="store_true")
    args = parser.parse_args()
    contract = json.loads(CONTRACT.read_text())
    if args.self_test:
        result = self_test(args.package)
    else:
        validate_contract(contract)
        result = {"contract": "ok"} if args.contract_only else validate_package(contract, args.package)
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
