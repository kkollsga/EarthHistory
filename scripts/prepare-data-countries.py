#!/usr/bin/env python3
"""Reconstruct the CC BY 4.0 PALEOMAP political-reference overlay.

Requires pyGPlates >= 1.0. The source archive already assigns PALEOMAP v3
plate IDs to its political boundary features; this script applies the matching
v3 rotation file and never assigns one guessed plate to Natural Earth countries.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import pathlib
import urllib.request
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_CACHE = ROOT / "dev-docs" / "temp" / "earthhistory-data"
OUTPUT = ROOT / "public" / "data"
MAX_CACHE_BYTES = 50 * 1024 * 1024
AGES = (20, 35, 55, 65, 95, 130, 185, 220, 250, 300, 320, 360, 400, 430, 470, 520, 540)
POI_EVIDENCE_POINTS = {
    "chengjiang-biota": (24.7, 102.9),
    "cairo-fossil-forest": (42.3, -74.0),
    "siberian-traps": (68.0, 93.0),
    "karoo-ferrar": (-31.0, 25.0),
    "oae2": (43.5, 12.5),
    "chicxulub": (21.3, -89.5),
    "andes-volcanic-margin": (-23.5, -69.3),
    "east-african-rift": (-3.0, 36.0),
}
FILES = {
    "political": (
        "https://zenodo.org/records/7994000/files/paleomap_political_boundaries_v3.zip?download=1",
        "44bdd3625796e77effc0bb5d0dab05a9bda2c86e5fe0ea4b401a66220d426962",
    ),
    "model": (
        "https://zenodo.org/records/7994000/files/paleomap_global_plate_model_v3.zip?download=1",
        "a58409f42bdb5f247e0dd543e8c3287f5d291d5928d0df730af8b2fa1ae7be65",
    ),
}


def fetch(name: str, url: str, checksum: str, cache_dir: pathlib.Path) -> pathlib.Path:
    target = cache_dir / f"paleomap-{name}-v3.zip"
    if not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "EarthHistory-data-prep/1"})
        with urllib.request.urlopen(request, timeout=60) as response:
            target.write_bytes(response.read())
    actual = hashlib.sha256(target.read_bytes()).hexdigest()
    if actual != checksum:
        raise SystemExit(f"unexpected {name} checksum: {actual}")
    return target


def extract_member(archive: pathlib.Path, suffix: str, destination: pathlib.Path) -> pathlib.Path:
    with zipfile.ZipFile(archive) as source:
        member = next(name for name in source.namelist() if name.endswith(suffix))
        destination.write_bytes(source.read(member))
    return destination


def point_line_distance(point: list[float], start: list[float], end: list[float]) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    t = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(point[0] - (start[0] + t * dx), point[1] - (start[1] + t * dy))


def simplify(points: list[list[float]], tolerance: float = 0.18) -> list[list[float]]:
    if len(points) <= 3:
        return points
    unwrapped = [points[0][:]]
    for longitude, latitude in points[1:]:
        previous = unwrapped[-1][0]
        while longitude - previous > 180:
            longitude -= 360
        while longitude - previous < -180:
            longitude += 360
        unwrapped.append([longitude, latitude])

    def recurse(segment: list[list[float]]) -> list[list[float]]:
        if len(segment) <= 2:
            return [segment[0], segment[-1]]
        distances = [point_line_distance(point, segment[0], segment[-1]) for point in segment[1:-1]]
        furthest = max(range(len(distances)), key=distances.__getitem__) + 1
        if distances[furthest - 1] <= tolerance:
            return [segment[0], segment[-1]]
        return recurse(segment[: furthest + 1])[:-1] + recurse(segment[furthest:])

    reduced = recurse(unwrapped)
    return [[round(((lon + 180) % 360) - 180, 3), round(lat, 3)] for lon, lat in reduced]


def attribute(feature, key: str) -> str | None:
    try:
        value = feature.get_shapefile_attribute(key)
        return str(value) if value not in (None, "") else None
    except Exception:
        return None


def geometry_points(geometry) -> list:
    for method in ("get_exterior_ring_points", "get_points"):
        if hasattr(geometry, method):
            return list(getattr(geometry, method)())
    return []


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-dir", type=pathlib.Path, default=DEFAULT_CACHE)
    parser.add_argument("--age", type=int, action="append")
    args = parser.parse_args()
    try:
        import pygplates
    except ImportError as error:
        raise SystemExit("pyGPlates >= 1.0 is required for country reconstruction") from error

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    source_dir = args.cache_dir / "paleomap-country-source"
    source_dir.mkdir(exist_ok=True)
    archives = {name: fetch(name, *details, args.cache_dir) for name, details in FILES.items()}
    gpml = extract_member(archives["political"], ".gpml", source_dir / "political-boundaries-v3.gpml")
    rotations = extract_member(archives["model"], ".rot", source_dir / "plate-model-v3.rot")
    partition_gpml = extract_member(archives["model"], ".gpml", source_dir / "plate-polygons-v3.gpml")
    cache_bytes = sum(path.stat().st_size for path in args.cache_dir.rglob("*") if path.is_file())
    if cache_bytes > MAX_CACHE_BYTES:
        raise SystemExit(f"cache is {cache_bytes} bytes, above the {MAX_CACHE_BYTES} byte bound")

    features = pygplates.FeatureCollection(str(gpml))
    partition_features = pygplates.FeatureCollection(str(partition_gpml))
    rotation_model = pygplates.RotationModel(str(rotations))
    partitioner = pygplates.PlatePartitioner(partition_features, rotation_model, 0.0)
    poi_plate_ids = {}
    for poi_id, (latitude, longitude) in POI_EVIDENCE_POINTS.items():
        point = pygplates.PointOnSphere((latitude, longitude))
        located = partitioner.partition_point(point)
        if located is not None:
            poi_plate_ids[poi_id] = int(located.get_feature().get_reconstruction_plate_id())
            continue
        for feature in partition_features:
            if any(
                hasattr(geometry, "is_point_in_polygon") and geometry.is_point_in_polygon(point)
                for geometry in feature.get_all_geometries()
            ):
                poi_plate_ids[poi_id] = int(feature.get_reconstruction_plate_id())
                break
    outputs = []
    for age in tuple(args.age) if args.age else AGES:
        reconstructed = []
        pygplates.reconstruct(features, rotation_model, reconstructed, float(age), anchor_plate_id=0)
        grouped: dict[str, dict] = {}
        for item in reconstructed:
            feature = item.get_feature()
            name = attribute(feature, "NAME") or attribute(feature, "ABBREVNAME") or "Unnamed reference"
            country_id = (attribute(feature, "ISO3") or attribute(feature, "WB_CNTRY") or name).lower().replace(" ", "-")
            record = grouped.setdefault(
                country_id,
                {"id": country_id, "name": name, "lines": [], "sourceIds": ["paleomap-political-boundaries-v3", "paleomap-global-plate-model-v3"], "evidence": "model-output"},
            )
            points = geometry_points(item.get_reconstructed_geometry())
            line = simplify([[point.to_lat_lon()[1], point.to_lat_lon()[0]] for point in points])
            if len(line) >= 2:
                record["lines"].append(line)
        poi_coordinates = {}
        for poi_id, plate_id in poi_plate_ids.items():
            latitude, longitude = POI_EVIDENCE_POINTS[poi_id]
            rotation = rotation_model.get_rotation(float(age), plate_id, anchor_plate_id=0)
            paleo_point = rotation * pygplates.PointOnSphere((latitude, longitude))
            paleo_latitude, paleo_longitude = paleo_point.to_lat_lon()
            poi_coordinates[poi_id] = [round(paleo_longitude, 3), round(paleo_latitude, 3)]
        payload = {"ageMa": age, "countries": list(grouped.values()), "poiCoordinates": poi_coordinates, "referenceFrame": "PALEOMAP global plate model v3, anchor plate 0"}
        destination = OUTPUT / f"countries-{age}ma.json"
        destination.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
        outputs.append({"ageMa": age, "path": f"public/data/{destination.name}", "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(), "bytes": destination.stat().st_size})

    manifest_path = OUTPUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["inputs"]["paleomap-country-reference-v3"] = {
        "record": "https://doi.org/10.5281/zenodo.7994000",
        "license": "CC BY 4.0",
        "politicalArchiveSha256": FILES["political"][1],
        "rotationArchiveSha256": FILES["model"][1],
        "processing": "pyGPlates reconstruction with matching v3 feature plate IDs, v3 rotations, anchor plate 0; POI evidence sites are partitioned at 0 Ma then reconstructed; line simplification tolerance 0.18 degrees",
        "outputs": outputs,
    }
    manifest["scratchCacheBytes"] = cache_bytes
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
