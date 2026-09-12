#!/usr/bin/env python3
"""Validate the emitted six-chart Cao 422 Ma shelf repair without the external Cao source pool."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PACKAGE = ROOT / "public/data/reconstruction/cao-v2.4"
CONTRACT = ROOT / "data/corrections/cao-shelf-422/lifecycle-contract.json"
SOURCE_ID = "cao-v2.4:COBfile_1800_0.gpml"
ENTRY_PREFIX = "cao-shelf-422-plate"
HEADER_BYTES = 32
RECORD_BYTES = 20


class ValidationError(ValueError):
    pass


def extension_youngest(row: dict, contract: dict) -> int:
    if row["plateId"] == 305:
        return 505
    return contract["motionExtensionMa"]["newEntryYoungestMaByPlate"][str(row["plateId"])]


def extension_entry_id(row: dict, contract: dict) -> str:
    if row["plateId"] == 305:
        return f"plate-{row['plateId']}-505-753"
    youngest = extension_youngest(row, contract)
    return f"{ENTRY_PREFIX}-{row['plateId']}-{youngest}-600"


def interval_id(youngest: int) -> str:
    return f"cao-shelf-422-clock-{youngest}-600-v1"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_asset(base: Path, descriptor: dict) -> bytes:
    path = base / descriptor["url"]
    if not path.is_file():
        raise ValidationError(f"missing package asset {descriptor['url']}")
    data = path.read_bytes()
    if len(data) != descriptor["bytes"] or sha(data) != descriptor["sha256"]:
        raise ValidationError(f"package asset identity changed: {descriptor['url']}")
    return data


def active(chart: dict, age_ma: float) -> bool:
    lifecycle = chart["lifecycle"]
    bounds = lifecycle["validTimeMa"]
    return (bounds["youngest"] <= age_ma <= bounds["oldest"]
            and not (lifecycle.get("youngestExclusive") is True and age_ma == bounds["youngest"])
            and not (lifecycle.get("oldestExclusive") is True and age_ma == bounds["oldest"]))


def validate_state(manifest: dict, core: dict, palette: dict, binary: bytes,
                   correction_catalog: dict, shelf_binary: bytes, contract: dict) -> dict:
    if (manifest.get("packageId") != core.get("packageId")
            or manifest.get("revision") != core.get("revision")
            or correction_catalog.get("baseline", {}).get("coreSha256")
            != manifest.get("core", {}).get("sha256")):
        raise ValidationError("Cao 422 Ma shelf consumers are not bound to the emitted core")
    if binary[:4] != b"EHMP" or len(binary) < HEADER_BYTES:
        raise ValidationError("invalid motion palette binary")
    version, record_bytes, entry_count, sample_count, header_bytes, *reserved = struct.unpack_from(
        "<HHIIIIII", binary, 4
    )
    if ((version, record_bytes, entry_count, sample_count, header_bytes)
            != (2, RECORD_BYTES, len(palette["entries"]),
                (len(binary) - HEADER_BYTES) // RECORD_BYTES, HEADER_BYTES)
            or any(reserved)):
        raise ValidationError("motion palette header/catalog mismatch")
    if shelf_binary[:4] != b"EHGB" or len(shelf_binary) < HEADER_BYTES:
        raise ValidationError("invalid native shelf binary")
    shelf_vertices = struct.unpack_from("<I", shelf_binary, 8)[0]
    chart_offset = HEADER_BYTES + 16 * shelf_vertices
    shelf_chart_indices = set(struct.unpack_from(
        f"<{shelf_vertices}I", shelf_binary, chart_offset
    ))

    chart_by_id = {chart["chartId"]: (index, chart)
                   for index, chart in enumerate(core["charts"])}
    if len(chart_by_id) != len(core["charts"]):
        raise ValidationError("duplicate chart identity")
    expected_ids = {row["chartId"] for row in contract["charts"]}
    for row in contract["charts"]:
        match = chart_by_id.get(row["chartId"])
        if match is None or match[0] != row["compiledChartIndex"] or match[0] not in shelf_chart_indices:
            raise ValidationError(f"{row['chartId']}: native shelf identity changed")
        chart = match[1]
        if (SOURCE_ID not in chart.get("evidence", {}).get("sourceIds", [])
                or chart.get("sourceFeatureIds") != [row["sourceFeatureId"]]
                or chart.get("sourceFeatureTypes") != [row["sourceFeatureType"]]
                or chart.get("surfaceEvidence", {}).get("kind") != "unknown"
                or "water depth and exposure remain unknown"
                not in chart.get("evidence", {}).get("limitations", ["", ""])[1]):
            raise ValidationError(f"{row['chartId']}: repaired shelf semantics changed")
        witnesses = {age: active(chart, age) for age in (0, 409, 410, 410.000001, 419.999999, 420, 420.000001, 422, 600, 600.000001)}
        if witnesses != {0: True, 409: True, 410: True, 410.000001: True, 419.999999: True, 420: True, 420.000001: True, 422: True, 600: True, 600.000001: False}:
            raise ValidationError(f"{row['chartId']}: repaired lifecycle endpoints changed")
        bindings = [(binding["entryId"], binding["validTimeMa"])
                    for binding in chart["motionBindings"]]
        if bindings != [
            (f"plate-{row['plateId']}-0-130", {"youngest": 0.0, "oldest": 130.0}),
            (f"plate-{row['plateId']}-130-505", {
                "youngest": 130.0,
                "oldest": row["compiledOldestMa"]
                if extension_youngest(row, contract) < 505 else 505,
            }),
            (extension_entry_id(row, contract), {
                "youngest": extension_youngest(row, contract), "oldest": 600,
            }),
        ]:
            raise ValidationError(f"{row['chartId']}: repaired motion partition changed")

    entries = {entry["entryId"]: entry for entry in palette["entries"]
               if entry["entryId"].startswith(f"{ENTRY_PREFIX}-")}
    expected_entries = {
        f"{ENTRY_PREFIX}-{plate}-{youngest}-600"
        for plate, youngest in (
            (int(plate), age)
            for plate, age in contract["motionExtensionMa"]["newEntryYoungestMaByPlate"].items()
        )
    }
    if set(entries) != expected_entries:
        raise ValidationError("C2")
    for entry_id, entry in entries.items():
        youngest = contract["motionExtensionMa"]["newEntryYoungestMaByPlate"][str(entry["plateId"])]
        if (entry.get("youngestAgeMa") != youngest or entry.get("oldestAgeMa") != 600
                or entry.get("sourceIntervalSetId") != interval_id(youngest)
                or entry.get("sampleCount", 0) < 2):
            raise ValidationError(f"{entry_id}: motion metadata changed")
        offset, count = entry["sampleOffset"], entry["sampleCount"]
        rows = [struct.unpack_from("<Iffff", binary, HEADER_BYTES + RECORD_BYTES * index)
                for index in range(offset, offset + count)]
        if (rows[0][0] != youngest * 1_000_000 or rows[-1][0] != 600_000_000
                or any(left[0] >= right[0] for left, right in zip(rows, rows[1:]))
                or any(not all(math.isfinite(value) for value in row[1:]) for row in rows)):
            raise ValidationError(f"{entry_id}: motion samples do not span 505 through 600 Ma")
    expected_intervals = {interval_id(age) for age in
                          contract["motionExtensionMa"]["newEntryYoungestMaByPlate"].values()}
    intervals = [row for row in palette["sourceIntervalSets"]
                 if row["id"] in expected_intervals]
    if {row["id"] for row in intervals} != expected_intervals:
        raise ValidationError("Cao 422 Ma source interval set changed")
    return {"charts": len(expected_ids), "activeAt422Ma": 6,
            "oldestInclusiveAgeMa": 600, "motionEntries": len(entries)}


def load(package: Path = PACKAGE) -> tuple[dict, dict, dict, bytes, dict, bytes, dict]:
    manifest = json.loads((package / "manifest.json").read_text())
    core = json.loads(read_asset(package, manifest["core"]))
    palette = json.loads(read_asset(package, manifest["motionPalette"]["catalog"]))
    binary = read_asset(package, manifest["motionPalette"]["binary"])
    correction_catalog = json.loads(read_asset(package, manifest["materialCorrections"]["catalog"]))
    shelf = next(batch for batch in core["spatialBatches"] if batch["batchId"] == "batch-shelf")
    shelf_binary = read_asset(package, shelf["geometryAsset"])
    return manifest, core, palette, binary, correction_catalog, shelf_binary, json.loads(CONTRACT.read_text())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--package", type=Path, default=PACKAGE)
    args = parser.parse_args()
    state = load(args.package)
    if args.self_test:
        mutated = list(state)
        mutated[1] = copy.deepcopy(state[1])
        mutated[1]["charts"][state[-1]["charts"][0]["compiledChartIndex"]]["lifecycle"][
            "validTimeMa"
        ]["oldest"] = 410
        try:
            validate_state(*mutated)
        except ValidationError:
            print("validate-cao-shelf-lifecycle-422: lifecycle mutation rejected")
            return
        raise ValidationError("lifecycle mutation was accepted")
    print(json.dumps(validate_state(*state), sort_keys=True))


if __name__ == "__main__":
    main()
