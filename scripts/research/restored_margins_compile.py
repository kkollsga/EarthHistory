#!/usr/bin/env python3
"""Compile the restored pre-collision margin charts (Alps, Caledonides).

Reads the pinned Cao et al. (2024) v2.4 model through the pinned pyGPlates
environment and writes the tracked contract under
``data/corrections/restored-margins/``:

  restored-margins-alps-v1.geojson         Adriatic and European restored margins
  restored-margins-caledonides-v1.geojson  Baltoscandian and Laurentian margins
  restored-margins-manifest.json           the contract, sources and lifecycles

Design record: ``docs/research/palaeo-coastlines-restored-margins-design.md``.
Implementation record: ``docs/research/palaeo-coastlines-restored-margins.md``.

Geometry is authored in present-day WGS84 reference coordinates at
``geometryReferenceAgeMa = 0``. Every sample is attributed to the Cao 2024
static partition of the **datum point** it is offset from, never to the
partition beneath the restored ground: that partition is oceanic, and binding to
it would detach the restored margin from the continent it restores. A strip is
split wherever the carrying plate of its datum changes, which is what produces
the Adriatic 307/308 split.

The contract this file writes is gated by
``scripts/research/restored_margins_correction.py``; both are wired into
``make check-corrections`` behind the pyGPlates venv guard.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import pygplates

ROOT = Path(__file__).resolve().parents[2]
MODEL = (ROOT.parent
         / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF")
REGION = ROOT / "data/corrections/restored-margins"

EARTH_RADIUS_KM = 6371.0088
KM_PER_DEGREE = 2.0 * math.pi * EARTH_RADIUS_KM / 360.0

CONTINENTS = MODEL / "shapes_continents.gpmlz"
COASTS = MODEL / "shapes_coasts.gpmlz"
STATIC = MODEL / "static_polygons.gpmlz"
ROTATION_YOUNG = MODEL / "1000_0_rotfile.rot"
ROTATION_OLD = MODEL / "1800_1000_rotfile.rot"

#: Both rotation files are loaded; only the young one is digest-pinned by the
#: other tracked corrections, so the old one is pinned here for the first time.
PINNED_SOURCE_SHA256 = {
    "shapes_continents.gpmlz":
        "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616",
    "shapes_coasts.gpmlz":
        "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f",
    "static_polygons.gpmlz":
        "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f",
    "1000_0_rotfile.rot":
        "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c",
    "1800_1000_rotfile.rot":
        "db2a57a8b7c7a08891c19840b6334ffb9c279b6a991a2c2eed099edb23445785",
}

CORRECTION_ID = "earthhistory-restored-collision-margins-v1"
PHASE = "restored-collision-margin"
SOURCE_TYPE = "EarthHistoryRestoredCollisionMargin"
ALPS_GEOMETRY = "restored-margins-alps-v1.geojson"
CALEDONIDES_GEOMETRY = "restored-margins-caledonides-v1.geojson"
MANIFEST_NAME = "restored-margins-manifest.json"

#: Plate groups whose *outlines* are the datum profiles.
EUROPE_GROUP = (302, 30202, 30203, 30204, 304, 305, 303, 315, 301, 311, 309)
ADRIA_GROUP = (307, 3307, 308)
BALTICA_GROUP = (302, 30202, 30203, 30204)
GREENLAND_PLATE = 102

#: The partition plate a datum sample may be attributed to, and the carrying
#: plate the strip that samples it is bound to. A datum partition outside this
#: table is a compile error, never silently rebound.
CARRYING_PLATE = {
    "adria": {307: 307, 3307: 307, 308: 308},
    "europe": {305: 305, 304: 305, 301: 305, 302: 305, 309: 305, 311: 305},
    "baltica": {302: 302, 30202: 302, 30203: 302, 30204: 302},
    "laurentia": {102: 102},
}

# ---------------------------------------------------------------- Alpine bands
#: Strip offsets are measured north of the European southern outline (the Alpine
#: suture datum). The innermost Adriatic strip additionally reaches back to the
#: native Adriatic edge where that edge lies south of the offset band, so the
#: present-day hole Cao leaves in the western and eastern Alps is not left open
#: under the restored crust.
ALPS_LONGITUDES = [round(7.75 + 0.25 * index, 2)
                   for index in range(int((15.0 - 7.75) / 0.25) + 1)]

#: id suffix, inner km, outer km, retires (youngest) Ma, oldest Ma, birth interval
ADRIA_STRIPS = (
    ("distal-margin-oct", 126.0, 186.0, 35.0, 165.0, [165.0, 154.0]),
    ("necking-zone", 71.0, 126.0, 19.0, 180.0, [180.0, 165.0]),
    ("proximal-retrowedge", 0.0, 71.0, 5.0, 200.0, [200.0, 180.0]),
)
EUROPE_STRIPS = (
    ("distal-margin-oct", -234.0, -150.0, 40.0, 165.0, [165.0, 154.0]),
    ("outer-necking-zone", -150.0, -105.0, 32.0, 180.0, [180.0, 165.0]),
    ("inner-necking-zone", -105.0, -60.0, 25.0, 180.0, [180.0, 165.0]),
    ("proximal-subducted-margin", -60.0, 0.0, 10.0, 200.0, [200.0, 180.0]),
)

# ------------------------------------------------------------ Caledonide bands
CALEDONIDE_LATITUDES = [round(60.5 + 0.5 * index, 1)
                        for index in range(int((71.5 - 60.5) / 0.5) + 1)]
CALEDONIDE_FULL = (62.0, 71.0)
BALTICA_STRIPS = (
    ("distal-margin-cot", 250.0, 401.0, 430.0, 600.0, [600.0, 540.0]),
    ("outer-shelf", 130.0, 250.0, 420.0, 600.0, [600.0, 540.0]),
    ("middle-allochthon-root", 0.0, 130.0, 405.0, 600.0, [600.0, 540.0]),
)
#: Greenland is limited to 70-76 N: at 76-80 N the plate-102 outline already
#: reaches -6 to -4 E and a further 200 km east would sit inside the Svalbard
#: domain. The East Greenland Caledonides continue to about 81 N; this is a
#: deliberate truncation and is recorded as such.
GREENLAND_LATITUDES = [round(69.5 + 0.5 * index, 1)
                       for index in range(int((76.5 - 69.5) / 0.5) + 1)]
GREENLAND_FULL = (70.0, 76.0)
LAURENTIA_STRIPS = (
    ("distal-margin-cot", 100.0, 202.0, 425.0, 600.0, [600.0, 540.0]),
    ("proximal-margin", 0.0, 100.0, 410.0, 600.0, [600.0, 540.0]),
)


class CompileError(ValueError):
    """A pinned compile premise did not hold."""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_sources() -> dict:
    digests = {}
    for name in ("shapes_continents.gpmlz", "shapes_coasts.gpmlz", "static_polygons.gpmlz",
                 "1000_0_rotfile.rot", "1800_1000_rotfile.rot"):
        path = MODEL / name
        if not path.is_file():
            raise CompileError(f"missing pinned model file: {path}")
        digests[name] = sha256(path)
        pinned = PINNED_SOURCE_SHA256.get(name)
        if pinned is not None and digests[name] != pinned:
            raise CompileError(f"{name}: sha256 {digests[name]} is not the pinned {pinned}")
    return digests


def rings_of(feature) -> list[list[tuple[float, float]]]:
    return [[(point.to_lat_lon()[1], point.to_lat_lon()[0]) for point in geometry.get_points()]
            for geometry in feature.get_geometries()]


def polygons_of(features) -> list:
    output = []
    for feature in features:
        for ring in rings_of(feature):
            points = [pygplates.PointOnSphere(lat, lon) for lon, lat in ring]
            if len(points) < 3:
                continue
            try:
                output.append(pygplates.PolygonOnSphere(points))
            except Exception:  # a degenerate source ring is skipped, never repaired
                continue
    return output


def contains(polygons, longitude: float, latitude: float) -> bool:
    point = pygplates.PointOnSphere(latitude, longitude)
    return any(polygon.is_point_in_polygon(point) for polygon in polygons)


def limit_on_meridian(polygons, longitude, low, high, step=0.01, northern=True):
    best = None
    for index in range(int(round((high - low) / step)) + 1):
        latitude = low + index * step
        if contains(polygons, longitude, latitude) and (
                best is None or (latitude > best if northern else latitude < best)):
            best = latitude
    return None if best is None else round(best, 2)


def limit_on_parallel(polygons, latitude, low, high, step=0.01, west=True):
    best = None
    for index in range(int(round((high - low) / step)) + 1):
        longitude = low + index * step
        if contains(polygons, longitude, latitude) and (
                best is None or (longitude < best if west else longitude > best)):
            best = longitude
    return None if best is None else round(best, 2)


def ring_area_km2(ring) -> float:
    points = [pygplates.PointOnSphere(lat, lon) for lon, lat in ring[:-1]]
    if len(points) < 3:
        return 0.0
    return abs(pygplates.PolygonOnSphere(points).get_area()) * EARTH_RADIUS_KM ** 2


class DatumPartition:
    """The Cao 2024 static partition a datum sample falls in."""

    def __init__(self) -> None:
        self._partitioner = pygplates.PlatePartitioner(
            pygplates.FeatureCollection(str(STATIC)),
            pygplates.RotationModel([str(ROTATION_YOUNG), str(ROTATION_OLD)]))

    def plate_at(self, longitude: float, latitude: float):
        found = self._partitioner.partition_point(pygplates.PointOnSphere(latitude, longitude))
        return None if found is None else found.get_feature().get_reconstruction_plate_id()


def carrying_plate(margin: str, partition_plate, longitude: float, latitude: float) -> int:
    table = CARRYING_PLATE[margin]
    if partition_plate is None or partition_plate not in table:
        raise CompileError(
            f"{margin}: the datum point {longitude:.3f} E {latitude:.3f} N falls in Cao partition "
            f"{partition_plate!r}, which is not a declared carrying plate for this margin")
    return table[partition_plate]


def runs_of(samples):
    """Split an ordered sample list wherever the carrying plate changes."""
    runs = []
    for sample in samples:
        if runs and runs[-1][0] == sample["plateId"]:
            runs[-1][1].append(sample)
        else:
            runs.append((sample["plateId"], [sample]))
    # A strip must not fall apart at a seam: each run keeps the neighbouring
    # sample on both sides so consecutive runs share an edge and leave no gap.
    stitched = []
    for index, (plate, run) in enumerate(runs):
        left = runs[index - 1][1][-1] if index > 0 else None
        right = runs[index + 1][1][0] if index + 1 < len(runs) else None
        stitched.append((plate, [row for row in (left, *run, right) if row is not None]))
    return stitched


def taper(value, low_start, low_end, high_start, high_end) -> float:
    if value <= low_start or value >= high_end:
        return 0.0
    if value < low_end:
        return (value - low_start) / (low_end - low_start)
    if value <= high_start:
        return 1.0
    return (high_end - value) / (high_end - high_start)


def alpine_features(continents, partition: DatumPartition) -> list[dict]:
    adria_polygons = polygons_of([feature for feature in continents
                                  if feature.get_reconstruction_plate_id() in ADRIA_GROUP])
    europe_polygons = polygons_of([feature for feature in continents
                                   if feature.get_reconstruction_plate_id() in EUROPE_GROUP])
    europe_south = {}
    adria_north = {}
    for longitude in ALPS_LONGITUDES:
        europe_south[longitude] = limit_on_meridian(europe_polygons, longitude, 40.0, 55.0,
                                                    northern=False)
        adria_north[longitude] = limit_on_meridian(adria_polygons, longitude, 38.0, 52.0)
        if europe_south[longitude] is None:
            raise CompileError(f"no European datum crust on {longitude} E")

    # Each sample carries the carrying plate of the partition its *datum point*
    # falls in. The Adriatic datum is the native Adriatic north limit; the
    # European datum is the European south limit.
    adria_samples = []
    europe_samples = []
    for longitude in ALPS_LONGITUDES:
        native_north = adria_north[longitude]
        if native_north is None:
            raise CompileError(f"no Adriatic datum crust on {longitude} E")
        adria_samples.append({
            "lon": longitude, "datum": europe_south[longitude], "nativeEdge": native_north,
            "plateId": carrying_plate("adria", partition.plate_at(longitude, native_north),
                                      longitude, native_north),
        })
        datum = europe_south[longitude]
        europe_samples.append({
            "lon": longitude, "datum": datum, "nativeEdge": None,
            "plateId": carrying_plate("europe", partition.plate_at(longitude, datum),
                                      longitude, datum),
        })

    features = []
    for name, inner_km, outer_km, youngest, oldest, birth in ADRIA_STRIPS:
        for plate, run in runs_of(adria_samples):
            lower, upper = [], []
            for sample in run:
                top = sample["datum"] + outer_km / KM_PER_DEGREE
                bottom = sample["datum"] + inner_km / KM_PER_DEGREE
                if inner_km == 0.0:
                    bottom = min(bottom, sample["nativeEdge"])
                lower.append((sample["lon"], round(bottom, 4)))
                upper.append((sample["lon"], round(top, 4)))
            ring = lower + list(reversed(upper))
            ring.append(ring[0])
            features.append({
                "id": f"alps-adria-{name}-plate-{plate}", "plateId": plate, "ring": ring,
                "widthKm": outer_km - inner_km, "offsetKm": [inner_km, outer_km],
                "youngest": youngest, "oldest": oldest, "birth": birth,
                "margin": "adria", "collision": "alps",
                "datumLongitudes": [run[0]["lon"], run[-1]["lon"]],
            })
    for name, inner_km, outer_km, youngest, oldest, birth in EUROPE_STRIPS:
        for plate, run in runs_of(europe_samples):
            lower, upper = [], []
            for sample in run:
                top = sample["datum"] + outer_km / KM_PER_DEGREE      # outer_km is negative
                bottom = sample["datum"] + inner_km / KM_PER_DEGREE
                lower.append((sample["lon"], round(top, 4)))
                upper.append((sample["lon"], round(bottom, 4)))
            ring = lower + list(reversed(upper))
            ring.append(ring[0])
            features.append({
                "id": f"alps-europe-{name}-plate-{plate}", "plateId": plate, "ring": ring,
                "widthKm": abs(outer_km - inner_km), "offsetKm": [inner_km, outer_km],
                "youngest": youngest, "oldest": oldest, "birth": birth,
                "margin": "europe", "collision": "alps",
                "datumLongitudes": [run[0]["lon"], run[-1]["lon"]],
            })
    return features, {"europeSouth": europe_south, "adriaNorth": adria_north}


def caledonide_features(continents, coasts, partition: DatumPartition) -> list[dict]:
    coast_polygons = polygons_of([feature for feature in coasts
                                  if feature.get_reconstruction_plate_id() in BALTICA_GROUP])
    greenland_polygons = polygons_of([feature for feature in continents
                                      if feature.get_reconstruction_plate_id() == GREENLAND_PLATE])
    coast_west = {latitude: limit_on_parallel(coast_polygons, latitude, -12.0, 32.0)
                  for latitude in CALEDONIDE_LATITUDES}
    # North of 71 N the plate-302 coast polygon no longer crosses the parallel.
    # The datum is held at the last measured value so the tapered band closes
    # cleanly rather than being extrapolated into crust nobody measured.
    last = None
    for latitude in CALEDONIDE_LATITUDES:
        if coast_west[latitude] is None:
            if last is None:
                raise CompileError(f"no Baltican coast datum at or below {latitude} N")
            coast_west[latitude] = last
        else:
            last = coast_west[latitude]
    greenland_east = {latitude: limit_on_parallel(greenland_polygons, latitude, -60.0, 15.0,
                                                  west=False)
                      for latitude in GREENLAND_LATITUDES}
    if any(value is None for value in greenland_east.values()):
        raise CompileError("no Laurentian datum crust on a Greenland parallel")

    baltica_samples = [{
        "lat": latitude, "datum": coast_west[latitude],
        "plateId": carrying_plate("baltica",
                                  partition.plate_at(coast_west[latitude], latitude),
                                  coast_west[latitude], latitude),
    } for latitude in CALEDONIDE_LATITUDES]
    laurentia_samples = [{
        "lat": latitude, "datum": greenland_east[latitude],
        "plateId": carrying_plate("laurentia",
                                  partition.plate_at(greenland_east[latitude], latitude),
                                  greenland_east[latitude], latitude),
    } for latitude in GREENLAND_LATITUDES]

    def longitude_offset(latitude, km):
        return km / (KM_PER_DEGREE * math.cos(math.radians(latitude)))

    features = []
    for name, inner_km, outer_km, youngest, oldest, birth in BALTICA_STRIPS:
        for plate, run in runs_of(baltica_samples):
            east, west = [], []
            for sample in run:
                scale = taper(sample["lat"], 60.5, CALEDONIDE_FULL[0], CALEDONIDE_FULL[1], 71.5)
                east.append((round(sample["datum"]
                                   - longitude_offset(sample["lat"], inner_km * scale), 4),
                             sample["lat"]))
                west.append((round(sample["datum"]
                                   - longitude_offset(sample["lat"], outer_km * scale), 4),
                             sample["lat"]))
            ring = east + list(reversed(west))
            ring.append(ring[0])
            features.append({
                "id": f"caledonides-baltica-{name}-plate-{plate}", "plateId": plate, "ring": ring,
                "widthKm": outer_km - inner_km, "offsetKm": [inner_km, outer_km],
                "youngest": youngest, "oldest": oldest, "birth": birth,
                "margin": "baltica", "collision": "caledonides",
                "datumLatitudes": [run[0]["lat"], run[-1]["lat"]],
            })
    for name, inner_km, outer_km, youngest, oldest, birth in LAURENTIA_STRIPS:
        for plate, run in runs_of(laurentia_samples):
            west, east = [], []
            for sample in run:
                scale = taper(sample["lat"], 69.5, GREENLAND_FULL[0], GREENLAND_FULL[1], 76.5)
                west.append((round(sample["datum"]
                                   + longitude_offset(sample["lat"], inner_km * scale), 4),
                             sample["lat"]))
                east.append((round(sample["datum"]
                                   + longitude_offset(sample["lat"], outer_km * scale), 4),
                             sample["lat"]))
            ring = west + list(reversed(east))
            ring.append(ring[0])
            features.append({
                "id": f"caledonides-laurentia-{name}-plate-{plate}", "plateId": plate,
                "ring": ring, "widthKm": outer_km - inner_km, "offsetKm": [inner_km, outer_km],
                "youngest": youngest, "oldest": oldest, "birth": birth,
                "margin": "laurentia", "collision": "caledonides",
                "datumLatitudes": [run[0]["lat"], run[-1]["lat"]],
            })
    return features, {"coastWest": coast_west, "greenlandEast": greenland_east}


def collection(rows) -> dict:
    features = []
    for row in rows:
        features.append({
            "type": "Feature",
            "id": row["id"],
            "properties": {
                "correctionFeatureId": row["id"],
                "collision": row["collision"],
                "margin": row["margin"],
                "plateId": row["plateId"],
                "restoredWidthKm": row["widthKm"],
                "datumOffsetKm": row["offsetKm"],
                "areaKm2": round(ring_area_km2(row["ring"]), 1),
                "surfaceEvidence": "unknown",
                "validTimeMa": {"youngest": row["youngest"], "oldest": row["oldest"],
                                "youngestExclusive": True},
                "birthIntervalMa": row["birth"],
            },
            "geometry": {"type": "Polygon",
                         "coordinates": [[list(point) for point in row["ring"]]]},
        })
    return {"type": "FeatureCollection", "features": features}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=REGION,
                        help="directory the contract is written to")
    arguments = parser.parse_args()
    digests = verify_sources()

    continents = list(pygplates.FeatureCollection(str(CONTINENTS)))
    coasts = list(pygplates.FeatureCollection(str(COASTS)))
    partition = DatumPartition()

    alps_rows, alpine_datum = alpine_features(continents, partition)
    caledonide_rows, caledonide_datum = caledonide_features(continents, coasts, partition)

    arguments.out.mkdir(parents=True, exist_ok=True)
    alps = collection(alps_rows)
    caledonides = collection(caledonide_rows)
    (arguments.out / ALPS_GEOMETRY).write_text(
        json.dumps(alps, indent=1, sort_keys=True) + "\n")
    (arguments.out / CALEDONIDES_GEOMETRY).write_text(
        json.dumps(caledonides, indent=1, sort_keys=True) + "\n")

    import restored_margins_manifest
    manifest = restored_margins_manifest.build(alps, caledonides, digests, arguments.out)
    (arguments.out / MANIFEST_NAME).write_text(
        json.dumps(manifest, indent=1, sort_keys=True, ensure_ascii=False) + "\n")

    summary = {
        "features": len(manifest["features"]),
        "sources": len(manifest["sourceAssets"]),
        "areaKm2": {
            margin: round(sum(feature["properties"]["areaKm2"]
                              for document in (alps, caledonides)
                              for feature in document["features"]
                              if feature["properties"]["margin"] == margin), 1)
            for margin in ("adria", "europe", "baltica", "laurentia")},
        "alpineDatum": {f"{key:g}E": {"europeSouth": alpine_datum["europeSouth"][key],
                                      "adriaNorth": alpine_datum["adriaNorth"][key]}
                        for key in (8.0, 10.0, 12.0, 14.0)},
        "caledonideDatum": {f"{key:g}N": caledonide_datum["coastWest"][key]
                            for key in (62.0, 64.0, 66.0, 68.0, 70.0)},
        "greenlandDatum": {f"{key:g}N": caledonide_datum["greenlandEast"][key]
                           for key in (70.0, 72.0, 74.0, 76.0)},
        "strips": [{"id": feature["id"], "plateId": feature["properties"]["plateId"],
                    "widthKm": feature["properties"]["restoredWidthKm"],
                    "areaKm2": feature["properties"]["areaKm2"],
                    "validMa": [feature["properties"]["validTimeMa"]["oldest"],
                                feature["properties"]["validTimeMa"]["youngest"]]}
                   for document in (alps, caledonides) for feature in document["features"]],
    }
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
