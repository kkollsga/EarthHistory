#!/usr/bin/env python3
"""Prepare the compact modern Köppen–Geiger control by bounded ZIP range reads."""

from __future__ import annotations

import binascii
import hashlib
import json
import re
import struct
import urllib.request
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "public" / "data" / "manifest.json"
OUTPUT = ROOT / "public" / "data" / "koppen-1991-2020-0p5.json"
API_URL = "https://api.figshare.com/v2/articles/21937571"
ARCHIVE_URL = "https://ndownloader.figshare.com/files/42602809"
ARCHIVE_NAME = "koppen_geiger_tif.zip"
ARCHIVE_BYTES = 92_221_371
ARCHIVE_MD5 = "544e895588b90ecc5903c27f50f4b761"
TIFF_ENTRY = "1991_2020/koppen_geiger_0p5.tif"
LEGEND_ENTRY = "legend.txt"


def byte_range(start: int, end: int) -> bytes:
    request = urllib.request.Request(ARCHIVE_URL, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(request) as response:
        payload = response.read()
    expected = end - start + 1
    if len(payload) != expected:
        raise RuntimeError(f"range {start}-{end} returned {len(payload)} bytes, expected {expected}")
    return payload


def verify_figshare_metadata() -> None:
    with urllib.request.urlopen(API_URL) as response:
        article = json.load(response)
    files = {record["name"]: record for record in article["files"]}
    archive = files.get(ARCHIVE_NAME)
    if archive is None:
        raise RuntimeError(f"Figshare article no longer contains {ARCHIVE_NAME}")
    if archive["size"] != ARCHIVE_BYTES or archive["computed_md5"] != ARCHIVE_MD5:
        raise RuntimeError("Figshare archive size or MD5 changed; review upstream before updating pins")
    if article["license"]["name"] != "CC0":
        raise RuntimeError(f"unexpected Figshare dataset license: {article['license']['name']}")


def central_directory() -> dict[str, dict[str, int]]:
    tail_size = min(65_536, ARCHIVE_BYTES)
    tail = byte_range(ARCHIVE_BYTES - tail_size, ARCHIVE_BYTES - 1)
    marker = tail.rfind(b"PK\x05\x06")
    if marker < 0:
        raise RuntimeError("ZIP end-of-central-directory record is missing")
    _, disk, central_disk, disk_entries, entries, size, offset, _ = struct.unpack_from(
        "<4s4H2LH", tail, marker
    )
    if disk or central_disk or disk_entries != entries:
        raise RuntimeError("multi-disk ZIP archives are not supported")
    central = byte_range(offset, offset + size - 1)
    records: dict[str, dict[str, int]] = {}
    position = 0
    for _ in range(entries):
        values = struct.unpack_from("<4s6H3L5H2L", central, position)
        if values[0] != b"PK\x01\x02":
            raise RuntimeError("invalid ZIP central-directory entry")
        filename_length, extra_length, comment_length = values[10:13]
        name = central[position + 46 : position + 46 + filename_length].decode("utf8")
        records[name] = {
            "method": values[4],
            "crc32": values[7],
            "compressed": values[8],
            "uncompressed": values[9],
            "offset": values[-1],
        }
        position += 46 + filename_length + extra_length + comment_length
    return records


def extract_entry(name: str, records: dict[str, dict[str, int]]) -> bytes:
    record = records[name]
    header = byte_range(record["offset"], record["offset"] + 29)
    values = struct.unpack("<4s5H3L2H", header)
    if values[0] != b"PK\x03\x04":
        raise RuntimeError(f"invalid ZIP local header for {name}")
    start = record["offset"] + 30 + values[-2] + values[-1]
    compressed = byte_range(start, start + record["compressed"] - 1)
    if record["method"] == 0:
        payload = compressed
    elif record["method"] == 8:
        payload = zlib.decompress(compressed, -15)
    else:
        raise RuntimeError(f"unsupported ZIP compression method {record['method']} for {name}")
    if len(payload) != record["uncompressed"]:
        raise RuntimeError(f"uncompressed size mismatch for {name}")
    if binascii.crc32(payload) & 0xFFFFFFFF != record["crc32"]:
        raise RuntimeError(f"CRC mismatch for {name}")
    return payload


def lzw_decode(payload: bytes) -> bytes:
    bit = 0
    width = 9
    table: list[bytes | None] = [bytes([value]) for value in range(256)] + [None, None]
    next_code = 258
    previous: bytes | None = None
    output = bytearray()

    def read_code() -> int:
        nonlocal bit
        code = 0
        for _ in range(width):
            code = (code << 1) | ((payload[bit // 8] >> (7 - bit % 8)) & 1)
            bit += 1
        return code

    while bit + width <= len(payload) * 8:
        code = read_code()
        if code == 256:
            table = [bytes([value]) for value in range(256)] + [None, None]
            next_code = 258
            width = 9
            previous = None
            continue
        if code == 257:
            break
        if code < len(table) and table[code] is not None:
            entry = table[code]
        elif code == next_code and previous is not None:
            entry = previous + previous[:1]
        else:
            raise RuntimeError(f"invalid TIFF LZW code {code}")
        output.extend(entry)
        if previous is not None and next_code < 4096:
            table.append(previous + entry[:1])
            next_code += 1
            if next_code == (1 << width) - 1 and width < 12:
                width += 1
        previous = entry
    return bytes(output)


def tiff_tags(payload: bytes) -> dict[int, tuple[int | float, ...]]:
    if payload[:4] != b"II*\x00":
        raise RuntimeError("expected a little-endian TIFF")
    type_sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 12: 8}
    formats = {1: "B", 3: "H", 4: "I", 12: "d"}
    directory = struct.unpack_from("<I", payload, 4)[0]
    count = struct.unpack_from("<H", payload, directory)[0]
    tags: dict[int, tuple[int | float, ...]] = {}
    for index in range(count):
        position = directory + 2 + index * 12
        tag, field_type, values = struct.unpack_from("<HHI", payload, position)
        size = type_sizes[field_type] * values
        inline = payload[position + 8 : position + 12]
        data = inline[:size] if size <= 4 else payload[
            struct.unpack("<I", inline)[0] : struct.unpack("<I", inline)[0] + size
        ]
        if field_type in formats:
            tags[tag] = struct.unpack("<" + str(values) + formats[field_type], data)
    return tags


def decode_class_grid(payload: bytes) -> tuple[int, int, bytearray]:
    tags = tiff_tags(payload)
    width, height = int(tags[256][0]), int(tags[257][0])
    tile_width, tile_height = int(tags[322][0]), int(tags[323][0])
    if tags[258] != (8,) or tags[259] != (5,) or tags[317] != (1,):
        raise RuntimeError("unexpected TIFF sample, compression, or predictor")
    if tags[33550] != (0.5, 0.5, 0.0) or tags[33922][3:] != (-180.0, 90.0, 0.0):
        raise RuntimeError("unexpected GeoTIFF grid transform")
    tiles_across = (width + tile_width - 1) // tile_width
    grid = bytearray(width * height)
    if len(tags[324]) != len(tags[325]):
        raise RuntimeError("TIFF tile offset/count lists differ")
    for index, (offset, size) in enumerate(zip(tags[324], tags[325])):
        tile = lzw_decode(payload[int(offset) : int(offset) + int(size)])
        if len(tile) != tile_width * tile_height:
            raise RuntimeError(f"unexpected decoded TIFF tile size {len(tile)}")
        tile_x, tile_y = index % tiles_across, index // tiles_across
        for row in range(min(tile_height, height - tile_y * tile_height)):
            count = min(tile_width, width - tile_x * tile_width)
            source = row * tile_width
            target = (tile_y * tile_height + row) * width + tile_x * tile_width
            grid[target : target + count] = tile[source : source + count]
    if min(grid) != 0 or max(grid) != 30:
        raise RuntimeError("unexpected Köppen–Geiger class range")
    return width, height, grid


def class_group(value: int) -> str:
    if value == 0:
        return "ocean"
    if value == 1:
        return "tropical-rainforest"
    if value in (2, 3):
        return "tropical-seasonal"
    if value in (4, 5):
        return "desert"
    if value in (6, 7):
        return "steppe"
    if value <= 18:
        return "temperate"
    if value in (19, 20, 23, 24, 27, 28):
        return "cold-forest"
    if value <= 28:
        return "temperate"
    if value == 29:
        return "tundra"
    return "frost"


def parse_legend(text: str) -> list[dict]:
    records = []
    pattern = re.compile(r"^\s*(\d+):\s+(\w+)\s+(.+?)\s+\[(\d+)\s+(\d+)\s+(\d+)\]\s*$")
    for line in text.splitlines():
        match = pattern.match(line)
        if not match:
            continue
        value = int(match.group(1))
        records.append({
            "value": value,
            "code": match.group(2),
            "description": match.group(3).strip(),
            "group": class_group(value),
            "rgb": [int(match.group(4)), int(match.group(5)), int(match.group(6))],
        })
    if len(records) != 30:
        raise RuntimeError(f"expected 30 legend records, found {len(records)}")
    return records


def run_length_encode(values: bytearray) -> list[list[int]]:
    runs: list[list[int]] = []
    previous = values[0]
    count = 0
    for value in values:
        if value == previous and count < 65_535:
            count += 1
        else:
            runs.append([previous, count])
            previous, count = value, 1
    runs.append([previous, count])
    return runs


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    verify_figshare_metadata()
    records = central_directory()
    tiff = extract_entry(TIFF_ENTRY, records)
    legend_text = extract_entry(LEGEND_ENTRY, records).decode("utf8")
    width, height, classes = decode_class_grid(tiff)
    document = {
        "schemaVersion": 1,
        "period": "1991–2020",
        "width": width,
        "height": height,
        "cellSizeDegrees": 0.5,
        "longitudeOrigin": -179.75,
        "latitudeOrigin": 89.75,
        "noDataValue": 0,
        "encoding": "row-major-rle-value-count",
        "runs": run_length_encode(classes),
        "legend": parse_legend(legend_text),
        "sourceIds": ["beck-koppen-geiger-2023"],
    }
    OUTPUT.write_text(json.dumps(document, separators=(",", ":")) + "\n")
    manifest = json.loads(MANIFEST.read_text())
    manifest["inputs"]["beck-koppen-geiger-2023"] = {
        "record": "https://doi.org/10.6084/m9.figshare.21937571",
        "api": API_URL,
        "url": ARCHIVE_URL,
        "license": "CC0",
        "archiveBytes": ARCHIVE_BYTES,
        "archiveMd5": ARCHIVE_MD5,
        "archiveEntry": TIFF_ENTRY,
        "entryBytes": len(tiff),
        "entryCrc32": f"{records[TIFF_ENTRY]['crc32']:08x}",
        "processing": "Bounded ZIP HTTP range extraction; source-authored 0.5 degree GeoTIFF classes; lossless row-major run-length encoding",
        "outputs": [{
            "period": "1991–2020",
            "path": str(OUTPUT.relative_to(ROOT)),
            "sha256": sha256(OUTPUT),
            "bytes": OUTPUT.stat().st_size,
        }],
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
