#!/usr/bin/env python3
"""Measure whether the requested-age motion tiles exactly cover the all-age palette.

Phase 1 of ``dev-docs/plans/palaeo-coastlines-polygons.md``; stop rule in
``dev-docs/bench/results/palaeo-coastlines-reclaim-stop-rule.md`` (H2). Read-only.

Decodes ``motion-palette.json`` + ``motion-palette.bin`` (EHMP v2) and every
``motion-tiles/tile-*.ehmt`` (EHMT v1) exactly as ``src/reconstruction/palette.ts``
and ``src/reconstruction/motionTiles.ts`` do, then answers:

  * is the union of tile records the complete set of palette records, and are
    the bytes identical (per-record and whole-set sha256)?
  * which palette entries are absent from every tile?
  * how many records are duplicated across tile windows (transport overhead)?

Usage:
    python3 dev-docs/bench/scripts/palaeo_reclaim_motion_cover.py [--json OUT]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PKG = ROOT / "public" / "data" / "reconstruction" / "cao-v2.4"
HEADER_BYTES = 32
RECORD_BYTES = 20
DESCRIPTOR_BYTES = 8


def decode_palette(catalog: dict, blob: bytes) -> dict:
    magic, version, stride, entry_count, record_count, record_offset = struct.unpack_from("<4sHHIII", blob, 0)
    assert magic == b"EHMP" and version == 2 and stride == RECORD_BYTES, "unexpected EHMP header"
    assert record_offset == HEADER_BYTES
    assert HEADER_BYTES + record_count * RECORD_BYTES == len(blob)
    assert entry_count == len(catalog["entries"])
    entries: dict[str, dict] = {}
    for entry in catalog["entries"]:
        start = HEADER_BYTES + entry["sampleOffset"] * RECORD_BYTES
        stop = start + entry["sampleCount"] * RECORD_BYTES
        records = [blob[start + i * RECORD_BYTES: start + (i + 1) * RECORD_BYTES]
                   for i in range(entry["sampleCount"])]
        entries[entry["entryId"]] = {
            "plateId": entry["plateId"],
            "sampleOffset": entry["sampleOffset"],
            "sampleCount": entry["sampleCount"],
            "records": records,
            "globalIndices": list(range(entry["sampleOffset"], entry["sampleOffset"] + entry["sampleCount"])),
        }
    return {"entries": entries, "recordCount": record_count}


def decode_tile(blob: bytes, catalog: dict) -> dict:
    magic, version, stride, entry_count, record_count, descriptor_offset, record_offset = \
        struct.unpack_from("<4sHHIIII", blob, 0)
    assert magic == b"EHMT" and version == 1 and stride == RECORD_BYTES, "unexpected EHMT header"
    assert descriptor_offset == HEADER_BYTES
    assert record_offset == HEADER_BYTES + entry_count * DESCRIPTOR_BYTES
    out: dict[str, list[bytes]] = {}
    sample_offset = 0
    for index in range(entry_count):
        entry_index, sample_count = struct.unpack_from("<II", blob, HEADER_BYTES + index * DESCRIPTOR_BYTES)
        entry_id = catalog["entries"][entry_index]["entryId"]
        records = []
        for local in range(sample_count):
            start = record_offset + (sample_offset + local) * RECORD_BYTES
            records.append(blob[start:start + RECORD_BYTES])
        out.setdefault(entry_id, []).extend(records)
        sample_offset += sample_count
    assert sample_offset == record_count
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", type=Path, default=None)
    args = parser.parse_args()

    catalog_path = PKG / "motion-palette.json"
    binary_path = PKG / "motion-palette.bin"
    index_path = PKG / "motion-tiles" / "index.json"
    catalog = json.loads(catalog_path.read_text())
    palette = decode_palette(catalog, binary_path.read_bytes())
    index = json.loads(index_path.read_text())

    tile_bytes = 0
    tile_files = 0
    union: dict[str, set[bytes]] = {}
    duplicate_records = 0
    total_tile_records = 0
    per_tile = []
    for descriptor in index["tiles"]:
        path = PKG / descriptor["asset"]["url"]
        blob = path.read_bytes()
        assert len(blob) == descriptor["asset"]["bytes"]
        assert hashlib.sha256(blob).hexdigest() == descriptor["asset"]["sha256"]
        tile_bytes += len(blob)
        tile_files += 1
        decoded = decode_tile(blob, catalog)
        count = sum(len(records) for records in decoded.values())
        total_tile_records += count
        assert count == descriptor["recordCount"]
        for entry_id, records in decoded.items():
            bucket = union.setdefault(entry_id, set())
            for record in records:
                if record in bucket:
                    duplicate_records += 1
                bucket.add(record)
        per_tile.append({"tileId": descriptor["tileId"], "bytes": len(blob),
                         "entries": descriptor["entryCount"], "records": descriptor["recordCount"]})

    missing_entries = sorted(set(palette["entries"]) - set(union))
    extra_entries = sorted(set(union) - set(palette["entries"]))
    missing_records = 0
    byte_mismatch = 0
    covered_records = 0
    per_entry_gaps: list[dict] = []
    for entry_id, entry in palette["entries"].items():
        bucket = union.get(entry_id, set())
        absent = [index_ for index_, record in enumerate(entry["records"]) if record not in bucket]
        covered_records += entry["sampleCount"] - len(absent)
        missing_records += len(absent)
        if absent:
            per_entry_gaps.append({"entryId": entry_id, "plateId": entry["plateId"],
                                   "sampleCount": entry["sampleCount"], "absentRecords": len(absent)})
        # every tiled record for this entry must be byte-identical to a source record
        source = set(entry["records"])
        byte_mismatch += len(bucket - source)

    palette_records = palette["recordCount"]
    exact_cover = (not missing_entries and not extra_entries and missing_records == 0 and byte_mismatch == 0)

    index_bytes = index_path.stat().st_size
    result = {
        "measurement": "palaeo-coastlines Phase 1 motion tiles vs all-age palette",
        "stopRule": "dev-docs/bench/results/palaeo-coastlines-reclaim-stop-rule.md",
        "paletteBinaryBytes": binary_path.stat().st_size,
        "paletteCatalogBytes": catalog_path.stat().st_size,
        "paletteTotalBytes": binary_path.stat().st_size + catalog_path.stat().st_size,
        "paletteEntryCount": len(palette["entries"]),
        "paletteRecordCount": palette_records,
        "tileIndexBytes": index_bytes,
        "tileFileBytes": tile_bytes,
        "tileTotalBytes": tile_bytes + index_bytes,
        "tileFileCount": tile_files,
        "tileRecordCopies": total_tile_records,
        "tileDistinctRecordsCoveringPalette": covered_records,
        "tileDuplicateRecordCopies": duplicate_records,
        "tileTransportOverheadBytes": (total_tile_records - covered_records) * RECORD_BYTES,
        "exactCover": exact_cover,
        "paletteEntriesAbsentFromTiles": missing_entries,
        "tileEntriesAbsentFromPalette": extra_entries,
        "paletteRecordsAbsentFromTiles": missing_records,
        "tileRecordsNotByteIdenticalToPalette": byte_mismatch,
        "entriesWithUncoveredRecords": per_entry_gaps[:20],
        "entriesWithUncoveredRecordsCount": len(per_entry_gaps),
        "perTile": per_tile,
    }
    text = json.dumps(result, indent=2) + "\n"
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(text)
    print(json.dumps({k: v for k, v in result.items() if k not in ("perTile", "entriesWithUncoveredRecords")},
                     indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
