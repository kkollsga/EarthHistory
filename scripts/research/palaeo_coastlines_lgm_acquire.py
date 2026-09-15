#!/usr/bin/env python3
"""Acquire the three LGM lowstand ETOPO 2022 footprints into the offline store.

Phase 9 of ``dev-docs/plans/palaeo-coastlines-polygons.md`` needs present-day
bathymetry under three shelves that were subaerial at the Last Glacial Maximum:
the southern North Sea (Doggerland), the Sunda shelf, and Beringia. Nothing
else is acquired, and no raster is ever copied into the repository: the crops
and their manifest live in the owned offline store beside the other ETOPO
reference crops.

Source: NOAA NCEI ETOPO 2022 v1, 60 arc-second **surface** band, exported
through the public ArcGIS ImageServer the existing
``geography/etopo-reference-crops/prepare_candidates.py`` uses. US Government
work, public domain, attribution requested (``10.25921/fd45-gt74``).

Each crop is requested on the product's own 1 arc-minute grid — the width and
height are ``(east - west) * 60`` and ``(north - south) * 60`` exactly — so the
export resamples nothing and the -120 m contour derived from it is honest to
one source cell (~1.9 km in latitude, ~0.8-1.1 km in longitude at these
latitudes). Beringia spans the antimeridian and is therefore two crops that
abut on it; the -120 m land bridge legitimately crosses the dateline and the
downstream pipeline splits dateline geometry anyway.

Run once. The script refuses to overwrite a pinned crop; delete the store
directory deliberately to re-acquire.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import tempfile
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT.parent / "EarthHistory-data/palaeomap-study/geography/etopo-lgm-crops"
SERVICE = ("https://gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_all"
           "/ImageServer/exportImage")
RECORD = "https://doi.org/10.25921/fd45-gt74"
PRODUCT = "ETOPO_2022_v1_60s_surface"
LICENSE = "NOAA / US Government work, public domain; attribution requested"
ATTRIBUTION = ("NOAA National Centers for Environmental Information (2022). "
               "ETOPO 2022 15 Arc-Second Global Relief Model. "
               "NOAA NCEI. https://doi.org/10.25921/fd45-gt74")
# The source grid: one cell per arc-minute. Every footprint is requested at it.
CELLS_PER_DEGREE = 60
# The store class stays small; the four crops below are ~4 MiB together.
STORE_CAP_BYTES = 64 * 1024 * 1024

# (identifier, (west, south, east, north), footprint id)
FOOTPRINTS = (
    ("north-sea", (-6.0, 49.0, 12.0, 62.0), "north-sea"),
    ("sundaland", (95.0, -10.0, 120.0, 12.0), "sundaland"),
    ("beringia-west", (160.0, 55.0, 180.0, 72.0), "beringia"),
    ("beringia-east", (-180.0, 55.0, -150.0, 72.0), "beringia"),
)


# ---------------------------------------------------------------------------
# TIFF decoding
# ---------------------------------------------------------------------------
# Recovered verbatim from the retired `scripts/prepare-data-relief.py` (commit
# 3f586eb^), generalised from its fixed 256x256 export to an arbitrary grid.
# The ImageServer answers a tiled, LZW-compressed, little-endian F32 GeoTIFF and
# the venv has no GDAL/rasterio, so the reader stays in the standard library.

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


def tiff_tags(payload: bytes) -> dict[int, tuple]:
    if payload[:4] != b"II*\x00":
        raise RuntimeError("ETOPO export is not the expected little-endian TIFF")
    sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8}
    formats = {1: "B", 3: "H", 4: "I", 11: "f", 12: "d"}
    directory = struct.unpack_from("<I", payload, 4)[0]
    count = struct.unpack_from("<H", payload, directory)[0]
    tags: dict[int, tuple] = {}
    for index in range(count):
        position = directory + 2 + index * 12
        tag, field_type, values = struct.unpack_from("<HHI", payload, position)
        size = sizes[field_type] * values
        inline = payload[position + 8:position + 12]
        data = inline[:size] if size <= 4 else payload[
            struct.unpack("<I", inline)[0]:struct.unpack("<I", inline)[0] + size]
        if field_type in formats:
            tags[tag] = struct.unpack("<" + str(values) + formats[field_type], data)
    return tags


def decode_tiff(payload: bytes, bounds: tuple, width: int, height: int) -> list:
    """Row-major elevations, north to south, one per requested cell."""
    tags = tiff_tags(payload)
    actual_width, actual_height = int(tags[256][0]), int(tags[257][0])
    tile_width, tile_height = int(tags[322][0]), int(tags[323][0])
    west, south, east, north = bounds
    expected_scale = ((east - west) / width, (north - south) / height, 0.0)
    if (actual_width, actual_height) != (width, height):
        raise RuntimeError(f"ETOPO export is {actual_width}x{actual_height}, requested "
                           f"{width}x{height}")
    if tags[258] != (32,) or tags[259] != (5,):
        raise RuntimeError("unexpected ETOPO sample width or compression")
    if tags[317] != (1,) or tags[339] != (3,):
        raise RuntimeError("unexpected ETOPO predictor or sample format")
    if any(abs(float(actual) - expected) > 1e-10
           for actual, expected in zip(tags[33550], expected_scale)):
        raise RuntimeError("ETOPO export pixel scale does not match request")
    expected_tiepoint = (0.0, 0.0, 0.0, west, north, 0.0)
    if any(abs(float(actual) - expected) > 1e-9
           for actual, expected in zip(tags[33922], expected_tiepoint)):
        raise RuntimeError("ETOPO export tiepoint does not match request")
    if len(tags[324]) != len(tags[325]):
        raise RuntimeError("ETOPO tile offset/count lists differ")
    tiles_across = (width + tile_width - 1) // tile_width
    values = [0.0] * (width * height)
    for index, (offset, size) in enumerate(zip(tags[324], tags[325])):
        tile = lzw_decode(payload[int(offset):int(offset) + int(size)])
        if len(tile) != tile_width * tile_height * 4:
            raise RuntimeError("unexpected decoded ETOPO tile size")
        tile_x, tile_y = index % tiles_across, index // tiles_across
        for row in range(min(tile_height, height - tile_y * tile_height)):
            count = min(tile_width, width - tile_x * tile_width)
            decoded = struct.unpack_from("<" + str(count) + "f", tile, row * tile_width * 4)
            target = (tile_y * tile_height + row) * width + tile_x * tile_width
            values[target:target + count] = decoded
    if not all(math.isfinite(value) and -12_000 <= value <= 10_000 for value in values):
        raise RuntimeError("ETOPO export contains non-finite or implausible elevations")
    return values


def export_url(bounds: tuple, width: int, height: int) -> str:
    params = {
        "bbox": ",".join(f"{value:g}" for value in bounds),
        "bboxSR": "4326",
        "imageSR": "4326",
        "size": f"{width},{height}",
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


def grid_size(bounds: tuple) -> tuple:
    west, south, east, north = bounds
    width = (east - west) * CELLS_PER_DEGREE
    height = (north - south) * CELLS_PER_DEGREE
    if abs(width - round(width)) > 1e-9 or abs(height - round(height)) > 1e-9:
        raise RuntimeError("footprint bounds are not a whole number of source cells")
    return int(round(width)), int(round(height))


def canonical_json(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", type=Path, default=STORE)
    arguments = parser.parse_args()
    store: Path = arguments.store
    if store.exists() and any(store.iterdir()):
        raise SystemExit(f"refusing to overwrite the pinned LGM crop store at {store}")

    outputs = []
    rasters: dict[str, bytes] = {}
    for identifier, bounds, footprint in FOOTPRINTS:
        width, height = grid_size(bounds)
        url = export_url(bounds, width, height)
        request = urllib.request.Request(
            url, headers={"User-Agent": "EarthHistory-offline-research/1"})
        with urllib.request.urlopen(request, timeout=300) as response:
            tiff = response.read()
        retrieved = datetime.now(timezone.utc).isoformat()
        values = decode_tiff(tiff, bounds, width, height)
        rasters[f"{identifier}.tif"] = tiff
        west, south, east, north = bounds
        step_x, step_y = (east - west) / width, (north - south) / height
        below = sum(1 for value in values if value < -120.0)
        outputs.append({
            "id": identifier,
            "footprint": footprint,
            "bounds": list(bounds),
            "width": width,
            "height": height,
            "longitudeStepDegrees": step_x,
            "latitudeStepDegrees": step_y,
            "cellCenterBounds": [west + step_x / 2, south + step_y / 2,
                                 east - step_x / 2, north - step_y / 2],
            "registration": "pixel-center",
            "rowOrder": "north-to-south",
            "units": "m",
            "verticalDatum": "EGM2008",
            "surfaceBand": "surface",
            "sourceUrl": url,
            "retrievedUtc": retrieved,
            "raster": {"path": f"{identifier}.tif", "bytes": len(tiff),
                       "sha256": hashlib.sha256(tiff).hexdigest()},
            "rangeMetres": {"minimum": round(min(values), 3), "maximum": round(max(values), 3)},
            "cells": {"total": width * height,
                      "atOrAboveMinus120": width * height - below,
                      "belowMinus120": below},
        })
        print(f"{identifier}: {width}x{height} cells, {len(tiff)} bytes, "
              f"{width * height - below} cells at or above -120 m")

    staged = sum(len(payload) for payload in rasters.values())
    if staged > STORE_CAP_BYTES:
        raise SystemExit(f"LGM crop store would be {staged} bytes, over {STORE_CAP_BYTES}")
    manifest = {
        "schemaVersion": 1,
        "id": "etopo-2022-lgm-lowstand-crops-v1",
        "purpose": ("the three Last Glacial Maximum lowstand footprints of "
                    "dev-docs/plans/palaeo-coastlines-polygons.md Phase 9"),
        "source": {
            "record": RECORD,
            "service": SERVICE,
            "product": PRODUCT,
            "horizontalCrs": "EPSG:4326",
            "verticalDatum": "EGM2008",
            "license": LICENSE,
            "attribution": ATTRIBUTION,
        },
        "processing": ("ArcGIS ImageServer F32 GeoTIFF export at the product's own "
                       "1 arc-minute grid (width = 60 * degrees of longitude, height = "
                       "60 * degrees of latitude), WGS84, bilinear source resampling, "
                       "stored verbatim; no reprojection, no resampling to another grid."),
        "contourDatumMetres": -120.0,
        "runtimeStatus": "offline source only; never copied into the repository",
        "outputs": outputs,
        "storage": {
            "bound": f"this crop class stays below {STORE_CAP_BYTES} bytes",
            "cleanupOwner": "EarthHistory palaeomap geography acquisition owner",
        },
    }
    manifest_bytes = canonical_json(manifest)
    store.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=store.parent) as temporary:
        stage = Path(temporary)
        for name, payload in rasters.items():
            (stage / name).write_bytes(payload)
        (stage / "crop-manifest.json").write_bytes(manifest_bytes)
        for path in sorted(stage.iterdir()):
            destination = store / path.name
            if destination.exists():
                raise SystemExit(f"refusing to overwrite pinned source {destination}")
            path.replace(destination)
    print(json.dumps({"crops": len(outputs), "bytes": staged + len(manifest_bytes),
                      "store": str(store)}))


if __name__ == "__main__":
    main()
