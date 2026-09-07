#!/usr/bin/env python3
"""Prepare bounded, static EarthHistory geography assets.

The script uses only the Python standard library. Downloads are cached below
dev-docs/temp/earthhistory-data (50 MB maximum); generated runtime files are
written below public/data and are safe to serve without network access.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import pathlib
import re
import urllib.request
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / "dev-docs" / "temp" / "earthhistory-data"
OUTPUT = ROOT / "public" / "data"
MAX_CACHE_BYTES = 50 * 1024 * 1024

INPUTS = {
    "natural-earth-countries": (
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
        "master/geojson/ne_110m_admin_0_countries.geojson"
    ),
    "natural-earth-land": (
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/"
        "master/geojson/ne_110m_land.geojson"
    ),
}

PALEODEM_URL = (
    "https://zenodo.org/records/5460860/files/"
    "PaleoDEMS_long_lat_elev_csv_v2.zip?download=1"
)
PALEODEM_SHA256 = "db43e6261411ff468c9030ca240778a73f224bf34bf8186c735477e41454c873"
PALEODEM_AGES = (0, 20, 35, 55, 65, 95, 130, 185, 220, 250, 300, 320, 360, 400, 430, 470, 520, 540)


def fetch(name: str, url: str, cache_dir: pathlib.Path, suffix: str = ".geojson") -> pathlib.Path:
    target = cache_dir / f"{name}{suffix}"
    if not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "EarthHistory-data-prep/1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
        target.write_bytes(payload)
    return target


def prepare_paleodem(cache_dir: pathlib.Path, requested_ages: tuple[int, ...]) -> dict:
    archive = fetch("PaleoDEMS_long_lat_elev_csv_v2", PALEODEM_URL, cache_dir, ".zip")
    archive_sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    if archive_sha != PALEODEM_SHA256:
        raise SystemExit(f"unexpected PaleoDEM checksum: {archive_sha}")

    outputs = []
    with zipfile.ZipFile(archive) as source_zip:
        members = {
            int(match.group(1)): name
            for name in source_zip.namelist()
            if (match := re.search(r"_(\d{3})Ma\.csv$", name))
        }
        for age in requested_ages:
            name = members[age]
            grid: list[int] = []
            with source_zip.open(name) as raw_source:
                source = io.TextIOWrapper(raw_source, encoding="ascii", newline=None)
                for raw_line in source:
                    if raw_line.startswith("#"):
                        continue
                    lon_text, lat_text, elevation_text = raw_line.strip().split(",")
                    lon = int(float(lon_text))
                    lat = int(float(lat_text))
                    if lon == 180 or lon % 2 or (90 - lat) % 2:
                        continue
                    grid.append(max(-12000, min(12000, round(float(elevation_text)))))
            width = 180
            height = len(grid) // width
            if len(grid) != width * height:
                raise SystemExit(f"{name}: cell count {len(grid)} is not divisible by width {width}")
            if height == 90:
                # Some older archive CSVs stop at -89 degrees. Close the sampled
                # pole with the nearest available (-88 degree) row so every
                # runtime grid has one stable 90..-90 convention.
                grid.extend(grid[-width:])
                height = 91
            payload = {
                "ageMa": age,
                "width": width,
                "height": height,
                "origin": [-180, 90],
                "spacingDegrees": [2, -2],
                "units": "metres relative to interpreted paleo sea level",
                "sourceIds": ["scotese-wright-paleodem-v2"],
                "elevation": grid,
            }
            destination = OUTPUT / f"paleodem-{age}ma.json"
            destination.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
            outputs.append(
                {
                    "ageMa": age,
                    "path": f"public/data/{destination.name}",
                    "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                    "bytes": destination.stat().st_size,
                }
            )
    return {
        "url": PALEODEM_URL,
        "sha256": archive_sha,
        "bytes": archive.stat().st_size,
        "nativeGrid": "1 degree longitude/latitude/elevation CSV",
        "derivedGrid": "180x91 grid points at lon -180..178 and lat 90..-90, 2 degree spacing; nearest source samples, with -90 nearest-row closure where older CSVs end at -89; int16-range metres serialized as JSON integers",
        "outputs": outputs,
    }


def rings(geometry: dict) -> list[list[list[float]]]:
    coordinates = geometry["coordinates"]
    if geometry["type"] == "Polygon":
        return coordinates
    if geometry["type"] == "MultiPolygon":
        return [ring for polygon in coordinates for ring in polygon]
    return []


def round_ring(ring: list[list[float]]) -> list[list[float]]:
    return [[round(point[0], 4), round(point[1], 4)] for point in ring]


def prepare_modern(cache_dir: pathlib.Path) -> dict:
    paths = {name: fetch(name, url, cache_dir) for name, url in INPUTS.items()}
    land_geojson = json.loads(paths["natural-earth-land"].read_text())
    country_geojson = json.loads(paths["natural-earth-countries"].read_text())

    land = []
    for index, feature in enumerate(land_geojson["features"]):
        for ring_index, ring in enumerate(rings(feature["geometry"])):
            if ring_index == 0 or len(ring) >= 8:
                land.append({"id": f"ne-land-{index}-{ring_index}", "coordinates": [round_ring(ring)]})

    countries = []
    for index, feature in enumerate(country_geojson["features"]):
        properties = feature["properties"]
        country_id = properties.get("ADM0_A3") or properties.get("SOV_A3") or str(index)
        name = properties.get("NAME") or properties.get("ADMIN") or country_id
        countries.append(
            {
                "id": country_id.lower(),
                "name": name,
                "lines": [round_ring(ring) for ring in rings(feature["geometry"])],
                "sourceIds": ["natural-earth-countries-110m"],
                "evidence": "observed",
            }
        )

    output = {
        "ageMa": 0,
        "land": land,
        "countries": countries,
        "sourceIds": ["natural-earth-land-110m", "natural-earth-countries-110m"],
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT / "geography-0ma.json"
    destination.write_text(json.dumps(output, separators=(",", ":")) + "\n")

    checksums = {
        name: {
            "url": INPUTS[name],
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size,
        }
        for name, path in paths.items()
    }
    checksums["geography-0ma"] = {
        "path": "public/data/geography-0ma.json",
        "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
        "bytes": destination.stat().st_size,
    }
    return checksums


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=pathlib.Path, default=DEFAULT_CACHE)
    parser.add_argument("--modern-only", action="store_true")
    parser.add_argument("--paleodem-age", type=int, action="append")
    args = parser.parse_args()
    args.cache_dir.mkdir(parents=True, exist_ok=True)

    existing_manifest = OUTPUT / "manifest.json"
    previous = json.loads(existing_manifest.read_text()) if existing_manifest.exists() else {"inputs": {}}
    manifest = {
        "schemaVersion": 1,
        "generatedBy": "scripts/prepare-data.py",
        "retrievedAt": "2026-09-07",
        "inputs": {**previous.get("inputs", {}), **prepare_modern(args.cache_dir)},
    }
    if not args.modern_only or args.paleodem_age:
        ages = tuple(args.paleodem_age) if args.paleodem_age else PALEODEM_AGES
        manifest["inputs"]["scotese-wright-paleodem-v2"] = prepare_paleodem(args.cache_dir, ages)
    cache_bytes = sum(path.stat().st_size for path in args.cache_dir.iterdir() if path.is_file())
    if cache_bytes > MAX_CACHE_BYTES:
        raise SystemExit(f"cache is {cache_bytes} bytes, above the {MAX_CACHE_BYTES} byte bound")
    manifest["scratchCacheBytes"] = cache_bytes
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
