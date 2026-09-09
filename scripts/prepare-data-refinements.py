#!/usr/bin/env python3
"""Prepare bounded, cited surface-refinement tiles served by the static app."""

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
EMODNET_WCS = "https://ows.emodnet-bathymetry.eu/wcs"
WIDTH = 256
HEIGHT = 256
NORTH_SEA_BOUNDS = (1.0, 55.0, 4.0, 58.0)


def tiff_tags(payload: bytes) -> tuple[str, dict[int, tuple[int | float, ...]]]:
    marker = payload[:2]
    if marker == b"II":
        endian = "<"
    elif marker == b"MM":
        endian = ">"
    else:
        raise RuntimeError("refinement response is not a TIFF")
    if struct.unpack_from(endian + "H", payload, 2)[0] != 42:
        raise RuntimeError("unsupported TIFF signature")
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8}
    formats = {1: "B", 3: "H", 4: "I", 11: "f", 12: "d"}
    directory = struct.unpack_from(endian + "I", payload, 4)[0]
    count = struct.unpack_from(endian + "H", payload, directory)[0]
    tags: dict[int, tuple[int | float, ...]] = {}
    for index in range(count):
        position = directory + 2 + index * 12
        tag, field_type, values = struct.unpack_from(endian + "HHI", payload, position)
        if field_type not in sizes or field_type not in formats:
            continue
        size = sizes[field_type] * values
        inline = payload[position + 8 : position + 12]
        if size <= 4:
            data = inline[:size]
        else:
            offset = struct.unpack(endian + "I", inline)[0]
            data = payload[offset : offset + size]
        tags[tag] = struct.unpack(endian + str(values) + formats[field_type], data)
    return endian, tags


def decode_float_tile(payload: bytes) -> list[float]:
    endian, tags = tiff_tags(payload)
    width, height = int(tags[256][0]), int(tags[257][0])
    if (width, height) != (WIDTH, HEIGHT) or tags[258] != (32,) or tags[259] != (1,):
        raise RuntimeError("unexpected EMODnet dimensions, sample width, or compression")
    if tags[339] != (3,) or tags[322] != (WIDTH,) or tags[323] != (HEIGHT,):
        raise RuntimeError("unexpected EMODnet sample format or tile layout")
    offset, byte_count = int(tags[324][0]), int(tags[325][0])
    if byte_count != WIDTH * HEIGHT * 4:
        raise RuntimeError("unexpected EMODnet tile byte count")
    values = list(struct.unpack_from(endian + str(WIDTH * HEIGHT) + "f", payload, offset))
    if not all(math.isfinite(value) and -12_000 <= value <= 10_000 for value in values):
        raise RuntimeError("EMODnet response contains non-finite or implausible elevations")
    return values


def north_sea_url() -> str:
    params = {
        "service": "wcs",
        "version": "1.0.0",
        "request": "getcoverage",
        "coverage": "emodnet:mean",
        "crs": "EPSG:4326",
        "BBOX": ",".join(f"{value:g}" for value in NORTH_SEA_BOUNDS),
        "format": "image/tiff",
        "interpolation": "bilinear",
        "width": str(WIDTH),
        "height": str(HEIGHT),
    }
    return EMODNET_WCS + "?" + urllib.parse.urlencode(params)


def refinement_document(
    tile_id: str,
    width: int,
    height: int,
    elevation: list[int],
) -> dict[str, object]:
    west, south, east, north = NORTH_SEA_BOUNDS
    longitude_step = (east - west) / width
    latitude_step = (north - south) / height
    packed = struct.pack("<" + "h" * len(elevation), *elevation)
    return {
        "schemaVersion": 1,
        "id": tile_id,
        "validRequestedAgeMa": [0, 0],
        "bounds": list(NORTH_SEA_BOUNDS),
        "cellCenterBounds": [
            west + longitude_step / 2,
            south + latitude_step / 2,
            east - longitude_step / 2,
            north - latitude_step / 2,
        ],
        "width": width,
        "height": height,
        "longitudeStep": longitude_step,
        "latitudeStep": latitude_step,
        "registration": "pixel-center",
        "rowOrder": "north-to-south",
        "units": "m",
        "verticalDatum": "LAT",
        "surfaceMode": "seafloor",
        "sourceProduct": "EMODnet_DTM_2024_mean",
        "sourceIds": ["emodnet-bathymetry-2024"],
        "encoding": "int16-le-base64",
        "scaleMetres": 1,
        "elevation": base64.b64encode(packed).decode("ascii"),
    }


def downsample_four(values: list[int]) -> list[int]:
    output: list[int] = []
    for y in range(0, HEIGHT, 4):
        for x in range(0, WIDTH, 4):
            block = [
                values[(y + dy) * WIDTH + x + dx]
                for dy in range(4)
                for dx in range(4)
            ]
            output.append(round(sum(block) / len(block)))
    return output


def prepare_north_sea() -> list[dict[str, object]]:
    url = north_sea_url()
    with urllib.request.urlopen(url) as response:
        source = response.read()
    elevation = [round(value) for value in decode_float_tile(source)]
    tiles = [
        ("north-sea-basin-coarse", 0, 64, 64, downsample_four(elevation)),
        ("north-sea-basin", 1, WIDTH, HEIGHT, elevation),
    ]
    outputs: list[dict[str, object]] = []
    for tile_id, level, width, height, values in tiles:
        document = refinement_document(tile_id, width, height, values)
        output = ROOT / "public" / "data" / f"emodnet-{tile_id}.json"
        output.write_text(json.dumps(document, separators=(",", ":")) + "\n")
        outputs.append({
            "id": tile_id,
            "bbox": list(NORTH_SEA_BOUNDS),
            "level": level,
            "sourceUrl": url,
            "sourceTiffSha256": hashlib.sha256(source).hexdigest(),
            "sourceTiffBytes": len(source),
            "path": str(output.relative_to(ROOT)),
            "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            "bytes": output.stat().st_size,
            "minimumMetresLat": min(values),
            "maximumMetresLat": max(values),
        })
    return outputs


def main() -> None:
    outputs = prepare_north_sea()
    manifest = json.loads(MANIFEST.read_text())
    manifest["inputs"]["emodnet-bathymetry-2024-refinements"] = {
        "record": "https://doi.org/10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1",
        "service": EMODNET_WCS,
        "license": "CC BY 4.0",
        "sourceProduct": "EMODnet DTM 2024 mean depth/elevation",
        "processing": "WCS 256x256 EPSG:4326 F32 subset, bilinear service resampling, rounded to metre-scale int16 and base64 encoded; a 64x64 parent is block-mean downsampled for projected-error LOD and parent fallback; vertical datum LAT; rendered feather is explicitly synthesis",
        "outputs": outputs,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")
    for output in outputs:
        print(f"wrote {output['path']} ({output['bytes']} bytes)")


if __name__ == "__main__":
    main()
