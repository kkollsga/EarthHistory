#!/usr/bin/env python3
"""Validate the emitted Barents shelf repair without the external Cao source pool."""

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
CONTRACT = ROOT / "data/corrections/barents-shelf/lifecycle-contract.json"
SOURCE_ID = "cao-v2.4:COBfile_1800_0.gpml"
ENTRY_PREFIX = "barents-shelf-plate"
INTERVAL_ID = "barents-shelf-clock-505-600-v1"
HEADER_BYTES = 32
RECORD_BYTES = 20


class ValidationError(ValueError):
    pass


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
        raise ValidationError("Barents shelf consumers are not bound to the emitted core")
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
    peer_contract_path = ROOT / "data/corrections/cao-shelf-422/lifecycle-contract.json"
    peer_ids = ({row["chartId"] for row in json.loads(peer_contract_path.read_text())["charts"]}
                if peer_contract_path.is_file() else set())
    repaired_source_ids = {chart["chartId"] for chart in core["charts"]
                           if SOURCE_ID in chart.get("evidence", {}).get("sourceIds", [])}
    if repaired_source_ids != expected_ids | peer_ids:
        raise ValidationError("Cao lifecycle authority is attached outside the reviewed shelf charts")
    for row in contract["charts"]:
        match = chart_by_id.get(row["chartId"])
        if match is None or match[0] != row["compiledChartIndex"] or match[0] not in shelf_chart_indices:
            raise ValidationError(f"{row['chartId']}: native shelf identity changed")
        chart = match[1]
        if (chart.get("sourceFeatureIds") != [row["sourceFeatureId"]]
                or chart.get("sourceFeatureTypes") != [row["sourceFeatureType"]]
                or chart.get("surfaceEvidence", {}).get("kind") != "unknown"
                or "water depth and exposure remain unknown"
                not in chart.get("evidence", {}).get("limitations", ["", ""])[1]):
            raise ValidationError(f"{row['chartId']}: repaired shelf semantics changed")
        witnesses = {age: active(chart, age) for age in (0, 409, 422, 600, 600.000001)}
        if witnesses != {0: True, 409: True, 422: True, 600: True, 600.000001: False}:
            raise ValidationError(f"{row['chartId']}: repaired lifecycle endpoints changed")
        bindings = [(binding["entryId"], binding["validTimeMa"])
                    for binding in chart["motionBindings"]]
        if bindings != [
            (f"plate-{row['plateId']}-0-130", {"youngest": 0.0, "oldest": 130.0}),
            (f"plate-{row['plateId']}-130-505", {"youngest": 130.0, "oldest": 505}),
            (f"{ENTRY_PREFIX}-{row['plateId']}-505-600", {"youngest": 505, "oldest": 600}),
        ]:
            raise ValidationError(f"{row['chartId']}: repaired motion partition changed")

    entries = {entry["entryId"]: entry for entry in palette["entries"]
               if entry["entryId"].startswith(f"{ENTRY_PREFIX}-")}
    expected_entries = {f"{ENTRY_PREFIX}-{plate}-505-600" for plate in (309, 311)}
    if set(entries) != expected_entries:
        raise ValidationError("Barents motion entry set changed")
    for entry_id, entry in entries.items():
        if (entry.get("youngestAgeMa") != 505 or entry.get("oldestAgeMa") != 600
                or entry.get("sourceIntervalSetId") != INTERVAL_ID
                or entry.get("sampleCount", 0) < 2):
            raise ValidationError(f"{entry_id}: motion metadata changed")
        offset, count = entry["sampleOffset"], entry["sampleCount"]
        rows = [struct.unpack_from("<Iffff", binary, HEADER_BYTES + RECORD_BYTES * index)
                for index in range(offset, offset + count)]
        if (rows[0][0] != 505_000_000 or rows[-1][0] != 600_000_000
                or any(left[0] >= right[0] for left, right in zip(rows, rows[1:]))
                or any(not all(math.isfinite(value) for value in row[1:]) for row in rows)):
            raise ValidationError(f"{entry_id}: motion samples do not span 505 through 600 Ma")
    intervals = [row for row in palette["sourceIntervalSets"] if row["id"] == INTERVAL_ID]
    if len(intervals) != 1:
        raise ValidationError("Barents source interval set changed")
    return {"charts": len(expected_ids), "activeAt422Ma": 3,
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
            print("validate-regional-barents-shelf: lifecycle mutation rejected")
            return
        raise ValidationError("lifecycle mutation was accepted")
    print(json.dumps(validate_state(*state), sort_keys=True))


if __name__ == "__main__":
    main()
