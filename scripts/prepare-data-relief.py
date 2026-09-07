#!/usr/bin/env python3
"""Prepare five bounded ETOPO 2022 regional relief patches."""

from __future__ import annotations

import base64
import hashlib
import json
import math
import struct
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "public" / "data" / "manifest.json"
SERVICE = "https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all/ImageServer/exportImage"
PRODUCT = "ETOPO_2022_v1_60s_surface"
PATCHES = (
    ("mid-atlantic-ridge", (-60.0, 10.0, -30.0, 40.0), "seafloor"),
    ("himalayas", (72.0, 22.0, 100.0, 38.0), "surface"),
    ("andes", (-78.0, -32.0, -62.0, -15.0), "surface"),
    ("east-african-rift", (28.0, -15.0, 44.0, 14.0), "surface"),
    ("greenland", (-60.0, 58.0, -20.0, 84.0), "surface"),
)
WIDTH = 256
HEIGHT = 256


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
            next_code, width, previous = 258, 9, None
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
        raise RuntimeError("ETOPO export is not the expected little-endian TIFF")
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8}
    formats = {1: "B", 3: "H", 4: "I", 11: "f", 12: "d"}
    directory = struct.unpack_from("<I", payload, 4)[0]
    count = struct.unpack_from("<H", payload, directory)[0]
    tags: dict[int, tuple[int | float, ...]] = {}
    for index in range(count):
        position = directory + 2 + index * 12
        tag, field_type, values = struct.unpack_from("<HHI", payload, position)
        size = sizes[field_type] * values
        inline = payload[position + 8 : position + 12]
        data = inline[:size] if size <= 4 else payload[
            struct.unpack("<I", inline)[0] : struct.unpack("<I", inline)[0] + size
        ]
        if field_type in formats:
            tags[tag] = struct.unpack("<" + str(values) + formats[field_type], data)
    return tags


def decode_tiff(payload: bytes, bounds: tuple[float, float, float, float]) -> list[float]:
    tags = tiff_tags(payload)
    width, height = int(tags[256][0]), int(tags[257][0])
    tile_width, tile_height = int(tags[322][0]), int(tags[323][0])
    west, south, east, north = bounds
    expected_scale = ((east - west) / width, (north - south) / height, 0.0)
    if (width, height) != (WIDTH, HEIGHT) or tags[258] != (32,) or tags[259] != (5,):
        raise RuntimeError("unexpected ETOPO export dimensions, sample width, or compression")
    if tags[317] != (1,) or tags[339] != (3,):
        raise RuntimeError("unexpected ETOPO predictor or sample format")
    if any(abs(float(actual) - expected) > 1e-10 for actual, expected in zip(tags[33550], expected_scale)):
        raise RuntimeError("ETOPO export pixel scale does not match request")
    expected_tiepoint = (0.0, 0.0, 0.0, west, north, 0.0)
    if any(abs(float(actual) - expected) > 1e-10 for actual, expected in zip(tags[33922], expected_tiepoint)):
        raise RuntimeError("ETOPO export tiepoint does not match request")
    if len(tags[324]) != len(tags[325]):
        raise RuntimeError("ETOPO tile offset/count lists differ")
    tiles_across = (width + tile_width - 1) // tile_width
    values = [0.0] * (width * height)
    for index, (offset, size) in enumerate(zip(tags[324], tags[325])):
        tile = lzw_decode(payload[int(offset) : int(offset) + int(size)])
        if len(tile) != tile_width * tile_height * 4:
            raise RuntimeError("unexpected decoded ETOPO tile size")
        tile_x, tile_y = index % tiles_across, index // tiles_across
        for row in range(min(tile_height, height - tile_y * tile_height)):
            count = min(tile_width, width - tile_x * tile_width)
            decoded = struct.unpack_from("<" + str(count) + "f", tile, row * tile_width * 4)
            target = (tile_y * tile_height + row) * width + tile_x * tile_width
            values[target : target + count] = decoded
    if not all(math.isfinite(value) and -12_000 <= value <= 10_000 for value in values):
        raise RuntimeError("ETOPO export contains non-finite or implausible elevations")
    return values


def export_url(bounds: tuple[float, float, float, float]) -> str:
    params = {
        "bbox": ",".join(f"{value:g}" for value in bounds),
        "bboxSR": "4326",
        "imageSR": "4326",
        "size": f"{WIDTH},{HEIGHT}",
        "adjustAspectRatio": "false",
        "format": "tiff",
        "pixelType": "F32",
        "interpolation": "RSP_BilinearInterpolation",
        "compression": "LZ77",
        "renderingRule": json.dumps({"rasterFunction": "None"}, separators=(",", ":")),
        "mosaicRule": json.dumps({"where": f"Name='{PRODUCT}'"}, separators=(",", ":")),
        "f": "image",
    }
    return SERVICE + "?" + urllib.parse.urlencode(params)


def fetch_patch(identifier: str, bounds: tuple[float, float, float, float], mode: str) -> dict:
    url = export_url(bounds)
    with urllib.request.urlopen(url) as response:
        tiff = response.read()
    elevations = decode_tiff(tiff, bounds)
    quantized = [round(value) for value in elevations]
    if any(value < -32768 or value > 32767 for value in quantized):
        raise RuntimeError(f"{identifier} does not fit metre-scale int16 encoding")
    packed = struct.pack("<" + "h" * len(quantized), *quantized)
    west, south, east, north = bounds
    longitude_step = (east - west) / WIDTH
    latitude_step = (north - south) / HEIGHT
    document = {
        "schemaVersion": 1,
        "id": identifier,
        "validRequestedAgeMa": [0, 0],
        "bounds": list(bounds),
        "cellCenterBounds": [
            west + longitude_step / 2,
            south + latitude_step / 2,
            east - longitude_step / 2,
            north - latitude_step / 2,
        ],
        "width": WIDTH,
        "height": HEIGHT,
        "longitudeStep": longitude_step,
        "latitudeStep": latitude_step,
        "registration": "pixel-center",
        "rowOrder": "north-to-south",
        "units": "m",
        "verticalDatum": "EGM2008",
        "surfaceMode": mode,
        "sourceProduct": PRODUCT,
        "sourceIds": ["noaa-etopo-2022"],
        "encoding": "int16-le-base64",
        "scaleMetres": 1,
        "elevation": base64.b64encode(packed).decode("ascii"),
    }
    output = ROOT / "public" / "data" / f"etopo-{identifier}.json"
    output.write_text(json.dumps(document, separators=(",", ":")) + "\n")
    return {
        "id": identifier,
        "bbox": list(bounds),
        "sourceUrl": url,
        "sourceTiffSha256": hashlib.sha256(tiff).hexdigest(),
        "sourceTiffBytes": len(tiff),
        "path": str(output.relative_to(ROOT)),
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "bytes": output.stat().st_size,
    }


def main() -> None:
    outputs = [fetch_patch(identifier, bounds, mode) for identifier, bounds, mode in PATCHES]
    manifest = json.loads(MANIFEST.read_text())
    manifest["inputs"]["noaa-etopo-2022-regional"] = {
        "record": "https://doi.org/10.25921/fd45-gt74",
        "service": SERVICE,
        "license": "NOAA public-domain data; attribution requested",
        "sourceProduct": PRODUCT,
        "processing": "ArcGIS ImageServer 256x256 F32 export, WGS84, bilinear source resampling, rounded to metre-scale int16 and base64 encoded; outer bounds and pixel centers retained",
        "outputs": outputs,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(outputs)} ETOPO regional patches ({sum(item['bytes'] for item in outputs)} bytes)")


if __name__ == "__main__":
    main()
