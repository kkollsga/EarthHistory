#!/usr/bin/env python3
"""Validate Cao requested-age motion tiles against the unchanged full palette."""

from __future__ import annotations

import argparse
import bisect
import copy
import hashlib
import json
import math
import random
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import emit_cao_requested_age_motion_tiles as tiles  # noqa: E402


class ValidationError(tiles.TileError):
    pass


def fail(message: str) -> None:
    raise ValidationError(message)


def parse_tile(payload: bytes, descriptor: dict, source: dict) -> dict[int, dict]:
    if len(payload) != descriptor["asset"]["bytes"]:
        fail("requested-age tile byte count differs from its index")
    if hashlib.sha256(payload).hexdigest() != descriptor["asset"]["sha256"]:
        fail("requested-age tile digest differs from its index")
    if len(payload) < tiles.HEADER_BYTES or payload[:4] != b"EHMT":
        fail("invalid requested-age tile magic")
    version, record_bytes, entry_count, record_count, descriptor_offset, record_offset, r0, r1 = \
        struct.unpack_from("<HHIIIIII", payload, 4)
    if ((version, record_bytes, descriptor_offset) != (1, tiles.RECORD_BYTES, tiles.HEADER_BYTES)
            or entry_count != descriptor["entryCount"]
            or record_count != descriptor["recordCount"]
            or record_offset != tiles.HEADER_BYTES + entry_count * tiles.DESCRIPTOR_BYTES
            or len(payload) != record_offset + record_count * tiles.RECORD_BYTES
            or any((r0, r1))):
        fail("invalid requested-age tile header")
    result = {}
    source_indices = []
    previous_entry = -1
    cursor = 0
    for descriptor_index in range(entry_count):
        entry_index, sample_count = struct.unpack_from(
            "<II", payload, tiles.HEADER_BYTES + descriptor_index * tiles.DESCRIPTOR_BYTES)
        if (entry_index <= previous_entry or entry_index >= len(source["catalog"]["entries"])
                or sample_count < 1 or cursor + sample_count > record_count):
            fail("invalid requested-age tile entry descriptor")
        entry = source["catalog"]["entries"][entry_index]
        records = []
        previous_age = -1
        source_start = entry["sampleOffset"]
        source_count = entry["sampleCount"]
        source_ages = [struct.unpack_from(
            "<I", source["binary"], tiles.HEADER_BYTES + (source_start + i) * tiles.RECORD_BYTES)[0]
            for i in range(source_count)]
        for local in range(sample_count):
            offset = record_offset + (cursor + local) * tiles.RECORD_BYTES
            record = payload[offset:offset + tiles.RECORD_BYTES]
            age, w, x, y, z = struct.unpack("<Iffff", record)
            norm = math.sqrt(w * w + x * x + y * y + z * z)
            if age <= previous_age or not math.isfinite(norm) or abs(norm - 1) > 2e-6:
                fail("invalid requested-age tile record")
            position = bisect.bisect_left(source_ages, age)
            if position >= len(source_ages) or source_ages[position] != age:
                fail("requested-age tile record age is absent from source entry")
            source_index = source_start + position
            source_offset = tiles.HEADER_BYTES + source_index * tiles.RECORD_BYTES
            if record != source["binary"][source_offset:source_offset + tiles.RECORD_BYTES]:
                fail("requested-age tile record is not byte-identical to its source")
            records.append((age, record, source_index))
            source_indices.append(source_index)
            previous_age = age
        result[entry_index] = {"entry": entry, "records": records}
        cursor += sample_count
        previous_entry = entry_index
    if cursor != record_count:
        fail("requested-age tile contains unbound records")
    index_payload = b"".join(struct.pack("<I", value) for value in source_indices)
    if hashlib.sha256(index_payload).hexdigest() != descriptor["sourceRecordIndicesSha256"]:
        fail("requested-age source-record index digest mismatch")
    return result


def selected_binding(chart: dict, target: int) -> dict | None:
    matching = []
    for binding in tiles.binding_rows(chart):
        valid = binding["validTimeMa"]
        if tiles.micro_ma(valid["youngest"]) <= target <= tiles.micro_ma(valid["oldest"]):
            matching.append(binding)
    return min(matching, key=lambda row: row["entryId"]) if matching else None


def source_segment(source: dict, entry_index: int, target: int) -> tuple[bytes, bytes, float]:
    entry = source["catalog"]["entries"][entry_index]
    cache = source.setdefault("segmentCache", {})
    if entry_index not in cache:
        start, count = entry["sampleOffset"], entry["sampleCount"]
        records = [source["binary"][tiles.HEADER_BYTES + (start + i) * tiles.RECORD_BYTES:
                                    tiles.HEADER_BYTES + (start + i + 1) * tiles.RECORD_BYTES]
                   for i in range(count)]
        cache[entry_index] = ([struct.unpack_from("<I", record)[0] for record in records], records)
    ages, records = cache[entry_index]
    if target < ages[0] or target > ages[-1]:
        fail(f"source entry does not cover requested age: {entry['entryId']}")
    older_index = bisect.bisect_left(ages, target)
    younger_index = max(0, older_index - 1)
    fraction = 0.0 if ages[younger_index] == ages[older_index] else \
        (target - ages[younger_index]) / (ages[older_index] - ages[younger_index])
    return records[younger_index], records[older_index], fraction


def tile_segment(parsed: dict[int, dict], entry_index: int, target: int) -> tuple[bytes, bytes, float]:
    if entry_index not in parsed:
        fail("selected chart binding is absent from requested-age tile")
    records = parsed[entry_index]["records"]
    ages = [row[0] for row in records]
    if target < ages[0] or target > ages[-1]:
        fail("requested-age tile does not bracket selected chart binding")
    older_index = bisect.bisect_left(ages, target)
    younger_index = max(0, older_index - 1)
    fraction = 0.0 if ages[younger_index] == ages[older_index] else \
        (target - ages[younger_index]) / (ages[older_index] - ages[younger_index])
    return records[younger_index][1], records[older_index][1], fraction


def canonical_tile_index(index: dict, target: int) -> int:
    youngest = tiles.micro_ma(index["ageDomainMa"]["youngest"])
    oldest = tiles.micro_ma(index["ageDomainMa"]["oldest"])
    if target < youngest or target > oldest:
        fail("probe age outside requested-age tile domain")
    return min((target - youngest) // tiles.WINDOW_MICRO_MA, len(index["tiles"]) - 1)


def assert_probe(source: dict, index: dict, parsed_tiles: list[dict], target: int) -> int:
    parsed = parsed_tiles[canonical_tile_index(index, target)]
    selected_entries = {}
    for chart in source["charts"]:
        binding = selected_binding(chart, target)
        if binding is None:
            continue
        entry_index, _entry = source["entriesById"][binding["entryId"]]
        selected_entries[entry_index] = selected_entries.get(entry_index, 0) + 1
    for entry_index in selected_entries:
        expected = source_segment(source, entry_index, target)
        actual = tile_segment(parsed, entry_index, target)
        if expected[:2] != actual[:2] or expected[2] != actual[2]:
            entry = source["catalog"]["entries"][entry_index]
            fail(f"tile/full prepared segment differs for {entry['entryId']} at {target / 1e6:g} Ma")
    return sum(selected_entries.values())


def critical_probes(source: dict, index: dict) -> list[int]:
    youngest = tiles.micro_ma(index["ageDomainMa"]["youngest"])
    oldest = tiles.micro_ma(index["ageDomainMa"]["oldest"])
    values = {youngest, oldest, tiles.micro_ma(74), tiles.micro_ma(411), tiles.micro_ma(422)}
    boundaries = [tiles.micro_ma(row["validTimeMa"]["youngest"]) for row in index["tiles"]]
    boundaries.append(oldest)
    for value in boundaries:
        values.update(candidate for candidate in (value - 1, value, value + 1)
                      if youngest <= candidate <= oldest)
    for chart in source["charts"]:
        life = chart["lifecycle"]["validTimeMa"]
        endpoints = [tiles.micro_ma(life["youngest"]), tiles.micro_ma(life["oldest"])]
        for binding in tiles.binding_rows(chart):
            valid = binding["validTimeMa"]
            endpoints.extend((tiles.micro_ma(valid["youngest"]), tiles.micro_ma(valid["oldest"])))
        for gap in chart.get("motionSupportGaps", []):
            valid = gap["validTimeMa"]
            left, right = tiles.micro_ma(valid["youngest"]), tiles.micro_ma(valid["oldest"])
            endpoints.extend((left, left + 1, (left + right) // 2, right - 1, right))
        for value in endpoints:
            values.update(candidate for candidate in (value - 1, value, value + 1)
                          if youngest <= candidate <= oldest)
    interval_sets = {row["id"]: row["intervals"] for row in source["catalog"].get("sourceIntervalSets", [])}
    for entry in source["catalog"]["entries"]:
        intervals = entry.get("sourceIntervals") or interval_sets.get(entry.get("sourceIntervalSetId"), [])
        for row in intervals:
            if row.get("kind") != "source-knot":
                continue
            value = tiles.micro_ma(row["youngestAgeMa"])
            values.update(candidate for candidate in (value - 1, value, value + 1)
                          if youngest <= candidate <= oldest)
    generator = random.Random(240025)
    values.update(generator.randrange(youngest, oldest + 1) for _ in range(256))
    return sorted(values)


def validate(package: Path, tile_root: Path, manifest_path: Path | None = None) -> dict:
    contract = tiles.load_contract()
    source = tiles.load_source(package, contract)
    expected_tiles = tiles.expected_tiles(source)
    expected_index = tiles.expected_index(source, expected_tiles)
    index_path = tile_root / "index.json"
    if not index_path.is_file():
        fail("requested-age tile index is missing")
    actual_index_payload = index_path.read_bytes()
    if actual_index_payload != tiles.canonical(expected_index):
        fail("requested-age tile index differs from deterministic source derivation")
    index = json.loads(actual_index_payload)
    expected_files = {"index.json", *(row["name"] for row in expected_tiles)}
    actual_files = {path.name for path in tile_root.iterdir() if path.is_file()}
    if actual_files != expected_files:
        fail("requested-age tile file inventory differs from canonical windows")
    if len(expected_tiles) != len(index["tiles"]):
        fail("requested-age tile count differs from canonical windows")
    parsed_tiles = []
    for expected, descriptor in zip(expected_tiles, index["tiles"]):
        payload = (tile_root / expected["name"]).read_bytes()
        if payload != expected["payload"]:
            fail(f"requested-age tile differs from deterministic source derivation: {expected['name']}")
        parsed_tiles.append(parse_tile(payload, descriptor, source))

    # Every closed window boundary must prepare the same source segment from both neighbors.
    adjacent_comparisons = 0
    for boundary_index in range(1, len(index["tiles"])):
        target = tiles.micro_ma(index["tiles"][boundary_index]["validTimeMa"]["youngest"])
        for chart in source["charts"]:
            binding = selected_binding(chart, target)
            if binding is None:
                continue
            entry_index, _entry = source["entriesById"][binding["entryId"]]
            full = source_segment(source, entry_index, target)
            left = tile_segment(parsed_tiles[boundary_index - 1], entry_index, target)
            right = tile_segment(parsed_tiles[boundary_index], entry_index, target)
            if full != left or full != right:
                fail(f"adjacent tile boundary differs from full palette at {target / 1e6:g} Ma")
            adjacent_comparisons += 1

    probes = critical_probes(source, index)
    prepared_comparisons = sum(assert_probe(source, index, parsed_tiles, target) for target in probes)

    # The two authored plate-626 gaps are open, with supported endpoints and no hidden binding.
    expected_gaps = ((79_100_000, 79_100_001), (119_999_999, 120_000_000))
    gap_charts = [chart for chart in source["charts"] if any(
        gap.get("reason") == "source-seam" for gap in chart.get("motionSupportGaps", []))]
    if len(gap_charts) != 4:
        fail("plate-626 source-gap consumer count changed")
    for chart in gap_charts:
        actual = tuple((tiles.micro_ma(gap["validTimeMa"]["youngest"]),
                        tiles.micro_ma(gap["validTimeMa"]["oldest"]))
                       for gap in chart["motionSupportGaps"])
        if actual != expected_gaps:
            fail("plate-626 requested-age source-gap contract changed")
        for left, right in expected_gaps:
            if selected_binding(chart, left) is None or selected_binding(chart, right) is None:
                fail("plate-626 source-gap endpoint lost support")
            if selected_binding(chart, (left + right) / 2) is not None:
                fail("plate-626 open source-gap interior became interpolated")

    singleton_ids = {
        "panama-observed-land-plate-229-0",
        "panama-observed-land-plate-230-0",
        "panama-observed-land-plate-911-0",
        "country-present-reference-plate-0-identity",
    }
    present_tile = parsed_tiles[0]
    for entry_id in singleton_ids:
        entry_index, entry = source["entriesById"][entry_id]
        if entry["sampleCount"] != 1 or entry["youngestAgeMa"] != 0 or entry["oldestAgeMa"] != 0:
            fail(f"exact-present singleton contract changed: {entry_id}")
        if len(present_tile.get(entry_index, {}).get("records", [])) != 1:
            fail(f"exact-present singleton missing from requested-age tile: {entry_id}")

    if manifest_path is not None:
        actual_manifest = json.loads(manifest_path.read_text())
        expected_manifest = tiles.staged_manifest(source, index_path)
        if actual_manifest != expected_manifest:
            fail("staged package manifest does not register the exact requested-age tile index")
    return {
        "status": "pass",
        "tileCount": len(index["tiles"]),
        "tileBytes": sum(row["asset"]["bytes"] for row in index["tiles"]),
        "indexBytes": index_path.stat().st_size,
        "indexSha256": tiles.sha256(index_path),
        "recordCount": sum(row["recordCount"] for row in index["tiles"]),
        "entryDescriptorCount": sum(row["entryCount"] for row in index["tiles"]),
        "criticalProbeAgeCount": len(probes),
        "preparedSegmentComparisons": prepared_comparisons,
        "adjacentBoundaryComparisons": adjacent_comparisons,
    }


def self_test(package: Path, tile_root: Path) -> dict:
    contract = tiles.load_contract()
    source = tiles.load_source(package, contract)
    index = json.loads((tile_root / "index.json").read_text())
    descriptor = index["tiles"][0]
    payload = (tile_root / Path(descriptor["asset"]["url"]).name).read_bytes()
    mutations = 0

    corrupt = bytearray(payload)
    record_offset = struct.unpack_from("<I", corrupt, 20)[0]
    struct.pack_into("<f", corrupt, record_offset + 4, 0.0)
    try:
        parse_tile(bytes(corrupt), descriptor, source)
    except ValidationError:
        mutations += 1
    else:
        fail("quaternion corruption mutation survived")

    wrong_digest = copy.deepcopy(descriptor)
    wrong_digest["sourceRecordIndicesSha256"] = "0" * 64
    try:
        parse_tile(payload, wrong_digest, source)
    except ValidationError:
        mutations += 1
    else:
        fail("source-record provenance mutation survived")

    missing = bytearray(payload[:-tiles.RECORD_BYTES])
    struct.pack_into("<I", missing, 12, descriptor["recordCount"] - 1)
    changed = copy.deepcopy(descriptor)
    changed["recordCount"] -= 1
    changed["asset"]["bytes"] = len(missing)
    changed["asset"]["sha256"] = hashlib.sha256(missing).hexdigest()
    try:
        parse_tile(bytes(missing), changed, source)
    except ValidationError:
        mutations += 1
    else:
        fail("missing bracketing record mutation survived")

    altered_index = copy.deepcopy(index)
    altered_index["tiles"][0]["validTimeMa"]["oldestExclusive"] = False
    if tiles.canonical(altered_index) != tiles.canonical(tiles.expected_index(source, tiles.expected_tiles(source))):
        mutations += 1
    else:
        fail("tile-boundary mutation survived")
    return {"status": "pass", "rejectedMutations": mutations}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--package", type=Path, default=tiles.PUBLIC,
                        help="verified package supplying the authoritative full palette")
    parser.add_argument("--tiles", type=Path, default=tiles.PUBLIC / "motion-tiles",
                        help="staged or public requested-age motion tile directory")
    parser.add_argument("--manifest", type=Path, default=tiles.PUBLIC / "manifest.json",
                        help="optional package manifest that must register the tile index")
    parser.add_argument("--self-test", action="store_true",
                        help="prove the validator rejects four deliberate corruptions")
    args = parser.parse_args()
    report = validate(args.package, args.tiles, args.manifest)
    if args.self_test:
        report["selfTest"] = self_test(args.package, args.tiles)
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
