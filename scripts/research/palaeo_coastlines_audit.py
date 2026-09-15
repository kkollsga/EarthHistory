#!/usr/bin/env python3
"""Audit the Cao et al. (2017) palaeogeography package as a palaeo-coastline source.

The Cao 2017 GPlates 2.3 package stores landmass (``lm``), shallow marine
(``sm``), mountain (``m``) and ice (``i``) polygons in present-day WGS84 with a
``PLATEID1`` and a published map interval in the ``FROMAGE``/``TOAGE`` DBF
fields. EarthHistory renders the Cao et al. (2024) v2.4 model, so a palaeo
surface class can only be posed by re-attaching it to present-day Cao 2024
crust: every source ring is cookie-cut by the present-day static partitions and
each piece rides the plate that owns its partition.

This script measures every premise that decision rests on and writes
``docs/research/palaeo-coastlines-cao2017-audit.json``. It changes nothing: it
never extracts the source archive, never writes into the offline store, and
never touches ``public/`` or ``src/``.

Measured here:

* pinned sha256 of every input (archive, archive members, plate model,
  motion palette);
* the published map schedule read from the DBF fields directly, undated record
  counts, the 24 canonical intervals and every off-schedule ``(FROMAGE, TOAGE)``
  pair with record counts and spherical areas;
* the half-open ``(TOAGE, FROMAGE]`` lifecycle rule at 5 Ma checkpoints;
* the rotation-file trap: sub-blocks are only co-moving with their parent when
  both ``1000_0`` and ``1800_1000`` rotation files are loaded;
* the cookie-cut against present-day Cao 2024 static partitions, with explicit
  dateline/pole splitting for the wide partitions, per-class area preservation,
  dropped area, straddling fraction, pieces and vertices per interval;
* per plate: the frame conflict between the source ``PLATEID1`` and the owner
  partition plate at the interval mid-age, and the proposed override list;
* unposable pieces (owner plate with no motion-palette entry covering the
  interval);
* the per-interval area audit of Cao 2024 continental crust against ``lm``/``sm``;
* class membership at the plan's witness points;
* a node-reduction preview (Douglas-Peucker 0.02/0.05/0.1 degrees) with area
  error, lost pieces and the int16 ring payload size;
* the plan's stop rules.

``--self-test`` proves the checkers can fail: a corrupted pinned sha256, a
shifted canonical ``TOAGE`` and a single-rotation-file model must each be
rejected, and the clean checks must pass again afterwards.

Run with the pinned pyGPlates + Shapely environment (see docs/research).
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import sys
import time
import zipfile
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path

import numpy as np
import pygplates
import shapefile
import shapely
from shapely.geometry import MultiPolygon, Polygon, box
from shapely.ops import unary_union
from shapely.strtree import STRtree
from shapely.validation import make_valid


ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study"
ARCHIVE = POOL / "geography/earthbyte-paleogeography-gplates2.3.zip"
ARCHIVE_DIR = "Paleogeography/Global_Cao_etal/"
MODEL = POOL / "plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
STATIC = MODEL / "static_polygons.gpmlz"
COASTS = MODEL / "shapes_coasts.gpmlz"
CONTINENTS = MODEL / "shapes_continents.gpmlz"
ROTATION_YOUNG = MODEL / "1000_0_rotfile.rot"
ROTATION_OLD = MODEL / "1800_1000_rotfile.rot"
PALETTE = ROOT / "public/data/reconstruction/cao-v2.4/motion-palette.json"
REPORT = ROOT / "docs/research/palaeo-coastlines-cao2017-audit.json"

AUDIT_ID = "palaeo-coastlines-cao2017-audit-v1"
AUDITED_AT = "2026-09-15"
EARTH_RADIUS_KM = 6371.0088
EARTH_AREA_KM2 = 4.0 * math.pi * EARTH_RADIUS_KM**2

CLASSES = ("lm", "sm", "m", "i")
CUT_CLASSES = ("lm", "sm", "m")
MIN_PIECE_KM2 = 25.0
CO_MOVING_NEAR_KM = 25.0
CO_MOVING_FAR_KM = 250.0
POLE_EPSILON_DEGREES = 1e-3
DENSIFY_DEGREES = 1.0
SIMPLIFY_TOLERANCES = (0.02, 0.05, 0.1)
LOST_PIECE_KM2 = 500.0

# Stop rules copied from dev-docs/plans/palaeo-coastlines-polygons.md (D5 / Phase R).
AREA_PRESERVATION_BOUNDS = (99.9, 100.5)
CO_MOVING_LM_MINIMUM_PERCENT = 85.0

# Sub-blocks whose rotation sequence lives only in 1800_1000_rotfile.rot. With
# that file missing pyGPlates silently returns identity for the sub-block while
# the parent moves, so the pieces detach by thousands of kilometres.
ROTATION_TRAP_PAIRS = ((10105, 101), (80101, 801), (30202, 302))
ROTATION_TRAP_AGES = (90.0, 250.0)
ROTATION_TRAP_PROBE = (60.0, -100.0)  # lat, lon
ROTATION_TRAP_MINIMUM_KM = 100.0

# Present-day reference points. WIS, West Siberian, Zechstein, Viking Graben,
# North Sea centre and Tethyan Himalaya are the plan's own witnesses; Canadian
# Shield, Amazonia, Paris Basin, Doggerland, Turgai and Hudson Bay are the
# plan's negative controls and named basins, placed on their type areas here.
WITNESS_POINTS = {
    "western-interior-seaway": (-100.0, 45.0),
    "west-siberian-sea": (75.0, 60.0),
    "canadian-shield": (-95.0, 55.0),
    "amazonia": (-60.0, -5.0),
    "north-sea-centre": (2.5, 57.0),
    "viking-graben": (2.0, 60.5),
    "tethyan-himalaya": (85.0, 29.0),
    "paris-basin": (2.5, 48.5),
    "zechstein": (4.0, 54.0),
    "doggerland": (2.5, 54.5),
    "turgai-strait": (65.0, 52.0),
    "hudson-bay": (-85.0, 58.0),
}
WITNESS_INTERVALS = ("94-81", "269-248", "248-224", "402-380")

PINNED = {
    "earthbyte-paleogeography-gplates2.3.zip": (
        74691405, "9cbbd835bff27367c5f542912bb58571b0fb10f81173e0a16ceb3e53d264781b"),
    "lm_402_2.shp": (4337916, "e59c76b2473f26686ba7f98f09e868c2b0e2b037764d16039862d0502822a490"),
    "lm_402_2.dbf": (5474185, "fdbf49e9616ffc6e1998389863d5ca6cb7547bdcba639d366c56d7ca2f2a2088"),
    "lm_402_2.shx": (57340, "a6f0acd843a6c02da49b7a95b21e0aec50b2cf785ea79dfbf4db88698bf3a350"),
    "sm_402_2.shp": (6094908, "0d0051e17a380116b78f57b5f0460101150488867b2cde1480487987e65a8a01"),
    "sm_402_2.dbf": (9176153, "59ad1f43fece15a2fc01128c8ea44bed41a0bdc845d0da5a172ad6eef1e1db25"),
    "sm_402_2.shx": (107260, "eb90b36ed896a050246bf689ac85c0ddf24f15524df95ae693711130519e6585"),
    "m_402_2.shp": (2466252, "96de4cc4c969526b2425f3b472f62cc35df7cade09371407a7076c5304e130e4"),
    "m_402_2.dbf": (3664195, "5074e60cc751a5c21f4cf46d402e1abfbdc98981c598e53b2de05d67a0531019"),
    "m_402_2.shx": (38412, "96c59730ce527cfd38d6e536cb7068fddb4ee68e9aa6683268dfa60e8e4e4427"),
    "i_402_2.shp": (122092, "4a122b60ad7d09d8c571e3244d4239dd1e07c41f2ba021a63561bb0e9737cda0"),
    "i_402_2.dbf": (173883, "77de2e1a9119ab02226bf6ed1741f265651fa83533378128e32dc4b34086dee7"),
    "i_402_2.shx": (2124, "87c14e9dc06553b7dda7e292b14de7fb492b6495b69be221f4f7db9ab76afe7c"),
    "lm_402_2.prj": (145, "a02a27b1d1982c8516d83398e85a3c8b1aef1713c13ef4d84d7bde17430c07c4"),
    "_README.txt": (2242, "a10ab7d3c323d54265e017c69c700e5000bffbd9cc4b7b58ce6741479a28e47c"),
    "static_polygons.gpmlz": (2248936, "9b30d231157f99f9a7942d073efcb85649b0a6e10e49332637df2386f1b1350f"),
    "shapes_coasts.gpmlz": (1860295, "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f"),
    "shapes_continents.gpmlz": (1243843, "6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616"),
    "1000_0_rotfile.rot": (625128, "e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c"),
    "1800_1000_rotfile.rot": (36539, "db2a57a8b7c7a08891c19840b6334ffb9c279b6a991a2c2eed099edb23445785"),
    "motion-palette.json": (802764, "70cf3f2c72912de66453c84616a2a75372e9af1084fff594967587e5d9d27cdd"),
}
ARCHIVE_MEMBERS = tuple(name for name in PINNED
                        if name.endswith((".shp", ".dbf", ".shx", ".prj", ".txt")))


class AuditError(ValueError):
    """A measured premise of the palaeo-coastline plan did not hold."""


# --------------------------------------------------------------------------
# input identity
# --------------------------------------------------------------------------

def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def verify_inputs(pinned: dict[str, tuple[int, str]]) -> dict:
    """Confirm every input matches its pinned size and sha256.

    The archive members are read from the zip stream; the package is never
    extracted into the offline store.
    """
    recorded: dict[str, dict] = {}
    files = {
        "earthbyte-paleogeography-gplates2.3.zip": ARCHIVE,
        "static_polygons.gpmlz": STATIC,
        "shapes_coasts.gpmlz": COASTS,
        "shapes_continents.gpmlz": CONTINENTS,
        "1000_0_rotfile.rot": ROTATION_YOUNG,
        "1800_1000_rotfile.rot": ROTATION_OLD,
        "motion-palette.json": PALETTE,
    }
    for name, path in files.items():
        if not path.is_file():
            raise AuditError(f"missing pinned input: {path}")
        payload = path.read_bytes()
        digest = sha256_bytes(payload)
        size, expected = pinned[name]
        if len(payload) != size or digest != expected:
            raise AuditError(f"pinned input changed: {name} ({len(payload)} bytes, sha256 {digest})")
        recorded[name] = {"path": str(path.relative_to(ROOT.parent)), "bytes": size, "sha256": digest}
    with zipfile.ZipFile(ARCHIVE) as archive:
        for name in ARCHIVE_MEMBERS:
            payload = archive.read(ARCHIVE_DIR + name)
            digest = sha256_bytes(payload)
            size, expected = pinned[name]
            if len(payload) != size or digest != expected:
                raise AuditError(f"pinned archive member changed: {name} "
                                 f"({len(payload)} bytes, sha256 {digest})")
            recorded[name] = {"path": ARCHIVE_DIR + name, "bytes": size, "sha256": digest}
    return recorded


# --------------------------------------------------------------------------
# spherical geometry
# --------------------------------------------------------------------------

def polygon_parts(geometry) -> list[Polygon]:
    if geometry is None or geometry.is_empty:
        return []
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    if hasattr(geometry, "geoms"):
        parts: list[Polygon] = []
        for part in geometry.geoms:
            parts.extend(polygon_parts(part))
        return parts
    return []


def polygonal(geometry):
    parts = [part for part in polygon_parts(make_valid(geometry))
             if not part.is_empty and part.area > 0]
    if not parts:
        return Polygon()
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def ring_area_km2(coords) -> float:
    """Exact spherical area of one ring with great-circle edges (pyGPlates)."""
    positions = list(coords)
    if len(positions) >= 2 and positions[0] == positions[-1]:
        positions = positions[:-1]
    if len(positions) < 3:
        return 0.0
    points = [pygplates.PointOnSphere(lat, lon) for lon, lat in positions]
    try:
        return pygplates.PolygonOnSphere(points).get_area() * EARTH_RADIUS_KM**2
    except Exception:  # degenerate ring (repeated or antipodal points)
        return 0.0


def area_km2(geometry) -> float:
    total = 0.0
    for part in polygon_parts(geometry):
        total += ring_area_km2(part.exterior.coords)
        for interior in part.interiors:
            total -= ring_area_km2(interior.coords)
    return abs(total)


def great_circle_km(a: pygplates.PointOnSphere, b: pygplates.PointOnSphere) -> float:
    return pygplates.GeometryOnSphere.distance(a, b) * EARTH_RADIUS_KM


# --------------------------------------------------------------------------
# dateline and pole splitting
# --------------------------------------------------------------------------

def _is_pole(lat: float) -> bool:
    return abs(abs(lat) - 90.0) < POLE_EPSILON_DEGREES


def _dedupe(ring: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for position in ring:
        if not out or out[-1] != position:
            out.append(position)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def _unit(lon: float, lat: float) -> np.ndarray:
    phi = math.radians(lat)
    lam = math.radians(lon)
    return np.array([math.cos(phi) * math.cos(lam), math.cos(phi) * math.sin(lam), math.sin(phi)])


def densify(ring: list[tuple[float, float]],
            max_degrees: float = DENSIFY_DEGREES) -> list[tuple[float, float]]:
    """Insert great-circle samples so the planar chords follow the model edges.

    The whole cookie-cut is a planar lon/lat Boolean, but the model's polygon
    edges are great circles. Near the poles a single recorded edge can span tens
    of degrees of longitude while covering only a degree of arc, and its planar
    chord then encloses ground the spherical edge does not. Sampling every edge
    at one degree of arc *and* one degree of longitude removes that class of
    error; the redundant collinear samples are removed again by the
    Douglas-Peucker pass. Edges that end on a pole vertex are left alone: the
    whole edge is the pole and has no interior to sample.
    """
    if len(ring) < 2:
        return list(ring)
    out: list[tuple[float, float]] = []
    for (lon_a, lat_a), (lon_b, lat_b) in zip(ring, ring[1:]):
        out.append((lon_a, lat_a))
        if _is_pole(lat_a) or _is_pole(lat_b):
            continue
        first = _unit(lon_a, lat_a)
        second = _unit(lon_b, lat_b)
        arc = math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(first, second))))))
        steps = int(math.ceil(max(arc, abs(lon_b - lon_a)) / max_degrees))
        if steps <= 1 or arc <= 0.0:
            continue
        angle = math.radians(arc)
        sine = math.sin(angle)
        for step in range(1, steps):
            ratio = step / steps
            if sine < 1e-12:
                break
            point = (math.sin((1.0 - ratio) * angle) * first
                     + math.sin(ratio * angle) * second) / sine
            latitude = math.degrees(math.asin(max(-1.0, min(1.0, float(point[2])))))
            longitude = math.degrees(math.atan2(float(point[1]), float(point[0])))
            longitude += 360.0 * round((out[-1][0] - longitude) / 360.0)
            out.append((longitude, latitude))
    out.append(ring[-1])
    return out


def _unwrap_ring(ring: list[tuple[float, float]], directions: tuple[int, ...]):
    """Unwrap one ring into continuous longitudes and report its winding.

    A ring that passes through a pole has an ambiguous planar image: the edge
    along ``lat = +/-90`` that connects the incoming and outgoing meridians may
    run either way round, and the two choices enclose different ground.
    ``directions`` selects one choice per pole run; the caller verifies the
    result against the spherical polygon, so a wrong choice cannot pass.
    """
    ring = _dedupe(ring)
    if len(ring) < 3:
        return [], 0.0, 0
    if any(_is_pole(lat) for _, lat in ring):
        start = next((index for index, (_, lat) in enumerate(ring) if not _is_pole(lat)), None)
        if start is None:
            raise AuditError("ring consists only of pole vertices")
        ring = ring[start:] + ring[:start]
    count = len(ring)
    out: list[tuple[float, float]] = []
    previous: float | None = None
    runs = 0
    index = 0
    while index < count:
        lon, lat = ring[index]
        if not _is_pole(lat):
            value = lon if previous is None else lon + 360.0 * round((previous - lon) / 360.0)
            out.append((value, lat))
            previous = value
            index += 1
            continue
        end = index
        while end < count and _is_pole(ring[end][1]):
            end += 1
        pole_lat = 90.0 if ring[index][1] > 0 else -90.0
        following = ring[end % count][0]
        base = following + 360.0 * round((previous - following) / 360.0)
        direction = directions[runs] if runs < len(directions) else 1
        target = base
        if direction > 0 and base < previous:
            target += 360.0
        elif direction < 0 and base > previous:
            target -= 360.0
        out.append((previous, pole_lat))
        out.append((target, pole_lat))
        previous = target
        runs += 1
        index = end
        if end >= count:
            return out, previous - out[0][0], runs
    closing = ring[0][0] + 360.0 * round((previous - ring[0][0]) / 360.0)
    return out, closing - out[0][0], runs


def _tile_split(polygon: Polygon) -> list[Polygon]:
    minimum, _, maximum, _ = polygon.bounds
    first = math.floor((minimum + 180.0) / 360.0)
    last = math.floor((maximum + 180.0) / 360.0)
    pieces: list[Polygon] = []
    for tile in range(first, last + 1):
        window = box(-180.0 + 360.0 * tile, -90.0, 180.0 + 360.0 * tile, 90.0)
        clipped = polygonal(polygon.intersection(window))
        for part in polygon_parts(clipped):
            pieces.append(shapely.transform(part, lambda xy, t=tile: xy - np.array([360.0 * t, 0.0])))
    return pieces


def _candidate_planar(exterior, interiors, directions):
    unwrapped, winding, runs = _unwrap_ring(exterior, directions)
    if len(unwrapped) < 3:
        return None, runs
    if abs(abs(winding) - 360.0) < 1.0:
        # The ring encircles a pole: close it along lat = +/-90 one turn later.
        pole_lat = 90.0 if sum(lat for _, lat in unwrapped) > 0 else -90.0
        first_lon, first_lat = unwrapped[0]
        unwrapped = unwrapped + [(first_lon + winding, first_lat),
                                 (first_lon + winding, pole_lat), (first_lon, pole_lat)]
    elif abs(winding) > 1.0:
        return None, runs
    unwrapped = densify(unwrapped + [unwrapped[0]])[:-1]
    holes = []
    for interior in interiors:
        inner, inner_winding, _ = _unwrap_ring(interior, ())
        if len(inner) >= 3 and abs(inner_winding) <= 1.0:
            holes.append(densify(inner + [inner[0]])[:-1])
    try:
        candidate = make_valid(Polygon(unwrapped, holes))
    except Exception:
        return None, runs
    pieces = _tile_split(polygonal(candidate))
    if not pieces:
        return None, runs
    return polygonal(unary_union(pieces)) if len(pieces) > 1 else pieces[0], runs


def _sample_mismatches(planar, spherical: pygplates.PolygonOnSphere) -> int:
    """Count sample points classified differently by the planar and spherical forms.

    Samples inside the polar caps (|lat| > 89) and within half a degree of the
    planar boundary are excluded: there the lon/lat plane is degenerate or the
    great-circle edge and its planar chord legitimately differ. The area check
    guards those bands instead.
    """
    _, minimum_lat, _, maximum_lat = planar.bounds
    lons = np.linspace(-179.5, 179.5, 120)
    lats = np.linspace(max(-88.9, minimum_lat - 1.0), min(88.9, maximum_lat + 1.0), 40)
    grid_lon, grid_lat = np.meshgrid(lons, lats)
    flat_lon = grid_lon.ravel()
    flat_lat = grid_lat.ravel()
    inside_planar = shapely.contains_xy(planar, flat_lon, flat_lat)
    boundary = planar.boundary
    mismatches = 0
    for index in range(flat_lon.size):
        longitude = float(flat_lon[index])
        latitude = float(flat_lat[index])
        point = pygplates.PointOnSphere(latitude, longitude)
        if bool(inside_planar[index]) == bool(spherical.is_point_in_polygon(point)):
            continue
        if boundary.distance(shapely.Point(longitude, latitude)) < 0.5:
            continue  # sample sits on the split boundary; not a classification error
        mismatches += 1
    return mismatches


def planar_geometry(spherical: pygplates.PolygonOnSphere) -> tuple[object, dict | None]:
    """Planar lon/lat image of a spherical polygon, split at the antimeridian.

    Rings with a longitude span below 180 degrees are already planar-safe and
    are used unchanged. A wider ring is split explicitly; the chosen split is
    verified against the spherical polygon by area and by point-in-polygon
    sampling, so a wrong pole connector cannot pass silently.
    """
    exterior = [(point.to_lat_lon()[1], point.to_lat_lon()[0])
                for point in spherical.get_exterior_ring_points()]
    interiors = [[(point.to_lat_lon()[1], point.to_lat_lon()[0])
                  for point in spherical.get_interior_ring_points(index)]
                 for index in range(spherical.get_number_of_interior_rings())]
    if len(exterior) < 3:
        return Polygon(), None
    lons = [lon for lon, _ in exterior]
    reference = spherical.get_area() * EARTH_RADIUS_KM**2
    if max(lons) - min(lons) < 180.0:
        return polygonal(Polygon(densify(exterior + [exterior[0]]),
                                 [densify(ring + [ring[0]]) for ring in interiors])), None

    attempts = []
    naive = polygonal(Polygon(densify(exterior + [exterior[0]]),
                              [densify(ring + [ring[0]]) for ring in interiors]))
    attempts.append(("as-recorded", naive, 0))
    for directions in ((1, 1), (-1, -1), (1, -1), (-1, 1)):
        candidate, runs = _candidate_planar(exterior, interiors, directions)
        if candidate is None or candidate.is_empty:
            continue
        label = "unwrapped" if runs == 0 else f"unwrapped-pole-connector-{'/'.join(str(d) for d in directions[:runs])}"
        attempts.append((label, candidate, runs))
        if runs == 0:
            break
    best = None
    for label, candidate, _ in attempts:
        measured = area_km2(candidate)
        if reference <= 0 or abs(measured - reference) / reference > 0.02:
            continue
        mismatches = _sample_mismatches(candidate, spherical)
        score = (mismatches, abs(measured - reference))
        if best is None or score < best[0]:
            best = (score, label, candidate, measured)
    if best is None:
        raise AuditError("no verified planar split for a wide partition polygon "
                         f"(reference area {reference:.0f} km2)")
    _, label, candidate, measured = best
    record = {
        "longitudeSpanDegrees": round(max(lons) - min(lons), 3),
        "method": label,
        "sphericalAreaSquareKilometres": round(reference, 3),
        "planarSplitAreaSquareKilometres": round(measured, 3),
        "areaRatioPercent": round(100.0 * measured / reference, 4),
        "pointSampleMismatches": best[0][0],
        "pointSamples": 4800,
        "pieces": len(polygon_parts(candidate)),
    }
    return candidate, record


# --------------------------------------------------------------------------
# source loading
# --------------------------------------------------------------------------

def read_class(archive: zipfile.ZipFile, name: str) -> list[dict]:
    reader = shapefile.Reader(
        shp=io.BytesIO(archive.read(f"{ARCHIVE_DIR}{name}_402_2.shp")),
        dbf=io.BytesIO(archive.read(f"{ARCHIVE_DIR}{name}_402_2.dbf")),
        shx=io.BytesIO(archive.read(f"{ARCHIVE_DIR}{name}_402_2.shx")),
    )
    rows: list[dict] = []
    for index, record in enumerate(reader.iterShapeRecords()):
        shape = record.shape
        points = shape.points
        offsets = list(shape.parts) + [len(points)]
        rings = [points[start:stop] for start, stop in zip(offsets, offsets[1:])]
        rings = [ring for ring in rings if len(ring) >= 4]
        if not rings:
            continue
        rows.append({
            "index": index,
            "class": name,
            "fromAge": record.record["FROMAGE"],
            "toAge": record.record["TOAGE"],
            "timeMa": record.record["TIME"],
            "plateId1": record.record["PLATEID1"],
            "gpgimType": record.record["GPGIM_TYPE"],
            "featureId": record.record["FEATURE_ID"],
            "rings": rings,
        })
    return rows


def source_polygon(row: dict):
    rings = row["rings"]
    exterior = rings[0]
    holes = rings[1:] if len(rings) > 1 else None
    # Every ring that crosses the antimeridian does so through a pole vertex
    # (the shapefile closes Antarctica/Gondwana along lat -90), which is a
    # degenerate planar edge; assert that rather than assume it.
    for ring in rings:
        for (lon_a, lat_a), (lon_b, lat_b) in zip(ring, ring[1:]):
            if abs(lon_b - lon_a) > 180.0 and not (_is_pole(lat_a) and _is_pole(lat_b)):
                raise AuditError(f"{row['class']} record {row['index']} crosses the antimeridian "
                                 "away from a pole; the planar image is not safe")
    return polygonal(Polygon(densify(list(exterior)),
                             [densify(list(hole)) for hole in (holes or [])]))


# --------------------------------------------------------------------------
# schedule
# --------------------------------------------------------------------------

def canonical_schedule(rows_by_class: dict[str, list[dict]]) -> list[dict]:
    """The 24 published map intervals: the pairs shared by every dated class."""
    counters = {name: Counter((row["fromAge"], row["toAge"]) for row in rows
                              if row["fromAge"] is not None and row["toAge"] is not None)
                for name, rows in rows_by_class.items()}
    shared = set(counters["sm"]) & set(counters["lm"]) & set(counters["m"])
    intervals = []
    for from_age, to_age in sorted(shared, reverse=True):
        intervals.append({
            "intervalId": f"{int(round(from_age))}-{int(round(to_age))}",
            "fromAgeMa": from_age,
            "toAgeMa": to_age,
            "midAgeMa": round((from_age + to_age) / 2.0, 4),
        })
    # A canonical schedule is contiguous and non-overlapping under (TOAGE, FROMAGE].
    for older, younger in zip(intervals, intervals[1:]):
        if abs(older["toAgeMa"] - 0.01 - younger["fromAgeMa"]) > 1e-9:
            raise AuditError(f"map schedule is not contiguous at {older['intervalId']} / "
                             f"{younger['intervalId']}")
    return intervals


def schedule_report(rows_by_class: dict[str, list[dict]], intervals: list[dict],
                    area_by_record: dict[tuple[str, int], float]) -> dict:
    canonical = {(row["fromAgeMa"], row["toAgeMa"]) for row in intervals}
    per_class = {}
    off_schedule_pairs: dict[tuple[float, float], dict] = {}
    for name, rows in rows_by_class.items():
        undated = [row["index"] for row in rows if row["fromAge"] is None or row["toAge"] is None]
        on_count = 0
        off_count = 0
        off_area = 0.0
        for row in rows:
            if row["fromAge"] is None or row["toAge"] is None:
                continue
            pair = (row["fromAge"], row["toAge"])
            area = area_by_record.get((name, row["index"]), 0.0)
            if pair in canonical:
                on_count += 1
                continue
            off_count += 1
            off_area += area
            entry = off_schedule_pairs.setdefault(pair, {
                "fromAgeMa": pair[0], "toAgeMa": pair[1],
                "records": {}, "areaSquareKilometres": {},
            })
            entry["records"][name] = entry["records"].get(name, 0) + 1
            entry["areaSquareKilometres"][name] = round(
                entry["areaSquareKilometres"].get(name, 0.0) + area, 3)
        per_class[name] = {
            "records": len(rows),
            # Two defect classes a half-open (TOAGE, FROMAGE] lifecycle cannot
            # express: a reversed pair and a zero-length pair are never active.
            "reversedLifecycleRecords": [
                {"recordIndex": row["index"], "fromAgeMa": row["fromAge"], "toAgeMa": row["toAge"],
                 "plateId1": row["plateId1"]}
                for row in rows if row["fromAge"] is not None and row["toAge"] is not None
                and row["toAge"] > row["fromAge"]],
            "zeroLengthLifecycleRecords": [
                {"recordIndex": row["index"], "fromAgeMa": row["fromAge"], "toAgeMa": row["toAge"],
                 "plateId1": row["plateId1"]}
                for row in rows if row["fromAge"] is not None and row["toAge"] is not None
                and row["toAge"] == row["fromAge"]],
            "undatedRecords": len(undated),
            "undatedRecordIndices": undated[:20],
            "onScheduleRecords": on_count,
            "offScheduleRecords": off_count,
            "offScheduleAreaSquareKilometres": round(off_area, 3),
            "distinctPairs": len({(row["fromAge"], row["toAge"]) for row in rows
                                  if row["fromAge"] is not None}),
            "topologicalExportArtefactRecords": sum(
                1 for row in rows if row["gpgimType"] == "gpml:TopologicalClosedPlateBoundary"),
        }
    ordered = sorted(off_schedule_pairs.values(),
                     key=lambda entry: -sum(entry["areaSquareKilometres"].values()))
    return {
        "canonicalIntervals": intervals,
        "canonicalIntervalCount": len(intervals),
        "perClass": per_class,
        "offSchedulePairs": ordered,
        "offSchedulePairCount": len(ordered),
        "offSchedulePairCountLandmassShallowMarine": len(
            [entry for entry in ordered if {"lm", "sm"} & set(entry["records"])]),
        "offScheduleLandmassShallowMarineRecords":
            per_class["lm"]["offScheduleRecords"] + per_class["sm"]["offScheduleRecords"],
        "lifecycleRule": "(TOAGE, FROMAGE]: youngest bound exclusive, oldest bound inclusive",
    }


def checkpoint_report(rows_by_class: dict[str, list[dict]], intervals: list[dict]) -> dict:
    """Exactly one canonical interval active at every 5 Ma checkpoint 5-400 Ma."""
    inside = [float(age) for age in range(5, 405, 5)]
    outside = [0.0] + [float(age) for age in range(405, 545, 5)]
    failures = []
    active_sets = set()
    for age in inside:
        active = [row["intervalId"] for row in intervals
                  if row["toAgeMa"] < age <= row["fromAgeMa"]]
        if len(active) != 1:
            failures.append({"ageMa": age, "activeIntervals": active})
        for name in ("lm", "sm"):
            valid = frozenset(row["index"] for row in rows_by_class[name]
                              if row["toAge"] is not None and row["toAge"] < age <= row["fromAge"])
            active_sets.add((name, valid))
    for age in outside:
        active = [row["intervalId"] for row in intervals
                  if row["toAgeMa"] < age <= row["fromAgeMa"]]
        if active:
            failures.append({"ageMa": age, "activeIntervals": active})
    if failures:
        raise AuditError(f"half-open interval rule failed at {failures[:4]}")
    return {
        "insideCheckpoints": len(inside),
        "outsideCheckpoints": len(outside),
        "outsideCheckpointAges": outside,
        "exactlyOneActiveInside": True,
        "noneActiveOutside": True,
        "distinctValidRecordSets": {
            "lm": len({payload for name, payload in active_sets if name == "lm"}),
            "sm": len({payload for name, payload in active_sets if name == "sm"}),
        },
    }


# --------------------------------------------------------------------------
# rotation model
# --------------------------------------------------------------------------

def check_rotation_model(paths: list[Path]) -> dict:
    """Assert the named sub-blocks co-move with their parents.

    Both rotation files must be loaded. With only ``1000_0_rotfile.rot`` the
    sub-block sequences are absent and pyGPlates returns identity, which is a
    silent detachment rather than an error.
    """
    model = pygplates.RotationModel([str(path) for path in paths], default_anchor_plate_id=0)
    probe = pygplates.PointOnSphere(*ROTATION_TRAP_PROBE)
    rows = []
    for child, parent in ROTATION_TRAP_PAIRS:
        for age in ROTATION_TRAP_AGES:
            moved_child = model.get_rotation(age, child) * probe
            moved_parent = model.get_rotation(age, parent) * probe
            separation = great_circle_km(moved_child, moved_parent)
            rows.append({"childPlateId": child, "parentPlateId": parent,
                         "ageMa": age, "separationKilometres": round(separation, 3)})
    worst = max(row["separationKilometres"] for row in rows)
    if worst > 1.0:
        raise AuditError(f"sub-block is not co-moving with its parent: worst {worst:.1f} km "
                         "(is 1800_1000_rotfile.rot loaded?)")
    return {"pairs": rows, "worstSeparationKilometres": round(worst, 6)}


def rotation_trap_report() -> dict:
    both = check_rotation_model([ROTATION_YOUNG, ROTATION_OLD])
    single = pygplates.RotationModel([str(ROTATION_YOUNG)], default_anchor_plate_id=0)
    probe = pygplates.PointOnSphere(*ROTATION_TRAP_PROBE)
    rows = []
    for child, parent in ROTATION_TRAP_PAIRS:
        for age in ROTATION_TRAP_AGES:
            separation = great_circle_km(single.get_rotation(age, child) * probe,
                                         single.get_rotation(age, parent) * probe)
            rows.append({"childPlateId": child, "parentPlateId": parent,
                         "ageMa": age, "separationKilometres": round(separation, 3)})
    worst_single = max(row["separationKilometres"] for row in rows)
    if worst_single < ROTATION_TRAP_MINIMUM_KM:
        raise AuditError("the single-rotation-file trap did not reproduce; the audit would "
                         "not catch a missing 1800_1000_rotfile.rot")
    return {
        "trapId": "single-rotation-file-identity",
        "bothFilesLoaded": both,
        "onlyYoungRotationFileLoaded": {
            "pairs": rows, "worstSeparationKilometres": round(worst_single, 3)},
        "consequence": ("loading only 1000_0_rotfile.rot leaves the sub-block sequences "
                        "undefined; pyGPlates returns identity and the cookie-cut piece stays "
                        "at its present-day position while its parent plate moves"),
    }


def identity_only_plates(plate_ids: set[int]) -> list[int]:
    single = pygplates.RotationModel([str(ROTATION_YOUNG)], default_anchor_plate_id=0)
    both = pygplates.RotationModel([str(ROTATION_YOUNG), str(ROTATION_OLD)],
                                   default_anchor_plate_id=0)
    probe = pygplates.PointOnSphere(*ROTATION_TRAP_PROBE)
    trapped = []
    for plate in sorted(plate_ids):
        for age in (90.0, 250.0, 400.0):
            single_point = single.get_rotation(age, plate) * probe
            both_point = both.get_rotation(age, plate) * probe
            if great_circle_km(single_point, probe) < 1.0 and great_circle_km(both_point, probe) > 1.0:
                trapped.append(plate)
                break
    return trapped


# --------------------------------------------------------------------------
# partitions and palette
# --------------------------------------------------------------------------

def load_partitions() -> tuple[list[dict], list[dict]]:
    partitions: list[dict] = []
    splits: list[dict] = []
    for order, feature in enumerate(pygplates.FeatureCollection(str(STATIC))):
        begin, end = feature.get_valid_time()
        if not (begin >= 0 >= end):
            continue
        plate = feature.get_reconstruction_plate_id(None)
        if plate is None:
            continue
        for geometry_index, geometry in enumerate(feature.get_geometries()):
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            planar, split = planar_geometry(geometry)
            if planar.is_empty:
                continue
            if split is not None:
                splits.append({"plateId": plate, "name": feature.get_name(None), **split})
            partitions.append({
                "plateId": plate, "sourceOrder": order, "geometryIndex": geometry_index,
                "name": feature.get_name(None), "geometry": planar,
                "areaSquareKilometres": area_km2(planar),
            })
    return partitions, splits


def load_palette() -> dict:
    palette = json.loads(PALETTE.read_text())
    by_plate: dict[int, list[dict]] = defaultdict(list)
    for entry in palette["entries"]:
        by_plate[entry["plateId"]].append(entry)
    for entries in by_plate.values():
        entries.sort(key=lambda entry: (entry["youngestAgeMa"], entry["oldestAgeMa"]))
    return by_plate


def palette_covers(by_plate: dict[int, list[dict]], plate: int,
                   youngest: float, oldest: float, allow_restoration: bool = False) -> bool:
    """Gap-free palette coverage of [youngest, oldest] for one plate.

    ``restoration-`` entries are opt-in in the live emitter
    (``entries_covering`` in ``scripts/research/emit_cao_material_corrections.py``),
    so they are excluded here unless asked for; a palaeo chart on partitions
    303/315 would otherwise silently get native motion.
    """
    candidates = [entry for entry in by_plate.get(plate, [])
                  if allow_restoration or not entry["entryId"].startswith("restoration-")]
    if not candidates:
        return False
    cursor = youngest
    guard = 0
    while cursor < oldest:
        guard += 1
        if guard > 64:
            return False
        matches = [entry for entry in candidates
                   if entry["youngestAgeMa"] <= cursor < entry["oldestAgeMa"]]
        if not matches:
            return False
        cursor = max(entry["oldestAgeMa"] for entry in matches)
    return True


# --------------------------------------------------------------------------
# cookie cut
# --------------------------------------------------------------------------

def active_rows(rows: list[dict], interval: dict) -> list[dict]:
    age = interval["midAgeMa"]
    return [row for row in rows
            if row["toAge"] is not None and row["fromAge"] is not None
            and row["toAge"] < age <= row["fromAge"]]


def cookie_cut(rows: list[dict], geometries: dict[int, object], partitions: list[dict],
               tree: STRtree, intervals: list[dict], rotations: pygplates.RotationModel,
               by_plate: dict[int, list[dict]]) -> dict:
    """Cut every source ring by the present-day partitions and measure the result."""
    rotation_cache: dict[tuple[float, int], object] = {}

    def rotation(age: float, plate: int):
        key = (age, plate)
        if key not in rotation_cache:
            rotation_cache[key] = rotations.get_rotation(age, plate)
        return rotation_cache[key]

    source_area = 0.0
    cut_area = 0.0
    dropped_area = 0.0
    dropped_pieces = 0
    straddling_rings = 0
    straddling_area = 0.0
    overlap_double_count = 0.0
    total_rings = 0
    per_interval: list[dict] = []
    plate_rows: dict[tuple[int, int], dict] = defaultdict(
        lambda: {"area": 0.0, "near": 0.0, "mid": 0.0, "far": 0.0, "pieces": 0})
    unposable_area = 0.0
    unposable_pieces = 0
    unposable_plates: dict[int, float] = defaultdict(float)
    owner_areas: dict[int, float] = defaultdict(float)
    co_moving = {"near": 0.0, "mid": 0.0, "far": 0.0}
    kept_pieces: dict[str, list] = {}

    for interval in intervals:
        selected = active_rows(rows, interval)
        interval_source = 0.0
        interval_cut = 0.0
        interval_pieces = 0
        interval_vertices = 0
        interval_geometry: list = []
        for row in selected:
            geometry = geometries[row["index"]]
            if geometry.is_empty:
                continue
            total_rings += 1
            row_area = area_km2(geometry)
            source_area += row_area
            interval_source += row_area
            kept = []
            for index in tree.query(geometry):
                partition = partitions[index]
                piece = polygonal(geometry.intersection(partition["geometry"]))
                if piece.is_empty:
                    continue
                piece_area = area_km2(piece)
                if piece_area < MIN_PIECE_KM2:
                    dropped_area += piece_area
                    dropped_pieces += 1
                    continue
                kept.append((partition, piece, piece_area))
            if len(kept) > 1:
                straddling_rings += 1
                straddling_area += row_area
                # Static partitions overlap each other slightly, so two owners can
                # claim the same ground. Measure that double count per ring: the
                # pieces of one ring union back to the ring itself.
                merged = polygonal(unary_union([piece for _, piece, _ in kept]))
                overlap_double_count += max(0.0, sum(item[2] for item in kept) - area_km2(merged))
            for partition, piece, piece_area in kept:
                cut_area += piece_area
                interval_cut += piece_area
                interval_pieces += 1
                interval_vertices += int(shapely.get_coordinates(piece).shape[0])
                interval_geometry.append(piece)
                owner = partition["plateId"]
                owner_areas[owner] += piece_area
                source_plate = row["plateId1"]
                point = piece.representative_point()
                probe = pygplates.PointOnSphere(point.y, point.x)
                separation = great_circle_km(rotation(interval["midAgeMa"], owner) * probe,
                                             rotation(interval["midAgeMa"], source_plate) * probe)
                bucket = ("near" if separation < CO_MOVING_NEAR_KM
                          else "mid" if separation <= CO_MOVING_FAR_KM else "far")
                co_moving[bucket] += piece_area
                stats = plate_rows[(source_plate, owner)]
                stats["area"] += piece_area
                stats[bucket] += piece_area
                stats["pieces"] += 1
                if not palette_covers(by_plate, owner, interval["toAgeMa"], interval["fromAgeMa"]):
                    unposable_area += piece_area
                    unposable_pieces += 1
                    unposable_plates[owner] += piece_area
        kept_pieces[interval["intervalId"]] = interval_geometry
        per_interval.append({
            "intervalId": interval["intervalId"],
            "sourceRecords": len(selected),
            "sourceAreaSquareKilometres": round(interval_source, 3),
            "cutAreaSquareKilometres": round(interval_cut, 3),
            "pieces": interval_pieces,
            "cutVertices": interval_vertices,
        })
    return {
        "sourceAreaSquareKilometres": round(source_area, 3),
        "cutAreaSquareKilometres": round(cut_area, 3),
        "areaRatioPercent": round(100.0 * cut_area / source_area, 4) if source_area else 0.0,
        "partitionOverlapDoubleCountSquareKilometres": round(overlap_double_count, 3),
        "areaRatioNetOfPartitionOverlapPercent":
            round(100.0 * (cut_area - overlap_double_count) / source_area, 4) if source_area else 0.0,
        "droppedBelowFloorSquareKilometres": round(dropped_area, 3),
        "droppedBelowFloorPercent": round(100.0 * dropped_area / source_area, 6) if source_area else 0.0,
        "droppedPieces": dropped_pieces,
        "minimumPieceSquareKilometres": MIN_PIECE_KM2,
        "ringInstances": total_rings,
        "sourceRecordsMissedByMidAgeSelection": [
            {"recordIndex": row["index"], "fromAgeMa": row["fromAge"], "toAgeMa": row["toAge"],
             "plateId1": row["plateId1"]}
            for row in rows
            if row["toAge"] is not None
            and not any(row["toAge"] < interval["midAgeMa"] <= row["fromAge"]
                        for interval in intervals)],
        "straddlingRingInstances": straddling_rings,
        "straddlingRingFractionPercent": round(100.0 * straddling_rings / total_rings, 3) if total_rings else 0.0,
        "straddlingAreaFractionPercent": round(100.0 * straddling_area / source_area, 3) if source_area else 0.0,
        "perInterval": per_interval,
        "totalPieces": sum(row["pieces"] for row in per_interval),
        "totalCutVertices": sum(row["cutVertices"] for row in per_interval),
        "coMoving": co_moving,
        "plateRows": plate_rows,
        "ownerPlateAreas": dict(owner_areas),
        "unposable": {
            "areaSquareKilometres": round(unposable_area, 3),
            "areaPercent": round(100.0 * unposable_area / cut_area, 4) if cut_area else 0.0,
            "pieces": unposable_pieces,
            "plates": [{"ownerPlateId": plate, "areaSquareKilometres": round(value, 3)}
                       for plate, value in sorted(unposable_plates.items(),
                                                  key=lambda item: -item[1])[:25]],
        },
        "_pieces": kept_pieces,
    }


def conflict_report(result: dict) -> dict:
    cut_area = result["cutAreaSquareKilometres"]
    by_source: dict[int, dict] = defaultdict(
        lambda: {"area": 0.0, "near": 0.0, "mid": 0.0, "far": 0.0, "pieces": 0,
                 "owners": defaultdict(float)})
    for (source_plate, owner), stats in result["plateRows"].items():
        row = by_source[source_plate]
        row["area"] += stats["area"]
        row["near"] += stats["near"]
        row["mid"] += stats["mid"]
        row["far"] += stats["far"]
        row["pieces"] += stats["pieces"]
        if stats["far"] > 0:
            row["owners"][owner] += stats["far"]
    plates = []
    for source_plate, row in sorted(by_source.items(), key=lambda item: -item[1]["area"]):
        area = row["area"]
        plates.append({
            "sourcePlateId1": source_plate,
            "cutAreaSquareKilometres": round(area, 3),
            "cutAreaPercentOfClass": round(100.0 * area / cut_area, 4) if cut_area else 0.0,
            "pieces": row["pieces"],
            "coMovingUnder25KmPercent": round(100.0 * row["near"] / area, 2) if area else 0.0,
            "coMoving25To250KmPercent": round(100.0 * row["mid"] / area, 2) if area else 0.0,
            "conflictOver250KmPercent": round(100.0 * row["far"] / area, 2) if area else 0.0,
            "conflictAreaSquareKilometres": round(row["far"], 3),
            "topDisagreeingOwnerPlates": [
                {"ownerPlateId": owner, "conflictAreaSquareKilometres": round(value, 3)}
                for owner, value in sorted(row["owners"].items(), key=lambda item: -item[1])[:4]],
        })
    return {"plates": plates}


def proposed_overrides(conflict: dict, cut_area: float) -> list[dict]:
    """Plates where the source PLATEID1 binding should win over the partition.

    A piece whose partition owner carries it more than 250 km from where its own
    PLATEID1 would place it is in a different reconstruction frame, not a small
    disagreement. Where that is most of a plate's area and the area is large
    enough to see, the source binding is the defensible one.
    """
    overrides = []
    for row in conflict["plates"]:
        if row["conflictOver250KmPercent"] < 40.0:
            continue
        if row["conflictAreaSquareKilometres"] < 200_000.0:
            continue
        overrides.append({
            "sourcePlateId1": row["sourcePlateId1"],
            "conflictOver250KmPercent": row["conflictOver250KmPercent"],
            "conflictAreaSquareKilometres": row["conflictAreaSquareKilometres"],
            "cutAreaSquareKilometres": row["cutAreaSquareKilometres"],
            "cutAreaPercentOfClass": row["cutAreaPercentOfClass"],
            "topDisagreeingOwnerPlates": row["topDisagreeingOwnerPlates"],
            "justification": (
                f"{row['conflictOver250KmPercent']:.1f}% of this plate's cut area is carried "
                f"more than 250 km from its PLATEID1 position by the partition owner "
                f"({row['conflictAreaSquareKilometres']:.0f} km2); the partition binding places "
                "the class in a different reconstruction frame"),
        })
    return sorted(overrides, key=lambda row: -row["conflictAreaSquareKilometres"])


# --------------------------------------------------------------------------
# area audit, witnesses, node reduction
# --------------------------------------------------------------------------

def load_cao2024_continents() -> list[dict]:
    rows = []
    for feature in pygplates.FeatureCollection(str(CONTINENTS)):
        begin, end = feature.get_valid_time()
        for geometry in feature.get_geometries():
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            planar, _ = planar_geometry(geometry)
            if planar.is_empty:
                continue
            rows.append({"beginMa": begin, "endMa": end, "geometry": planar})
    return rows


def area_audit(continents: list[dict], rows_by_class: dict[str, list[dict]],
               geometries: dict[str, dict[int, object]], intervals: list[dict]) -> list[dict]:
    report = []
    for interval in intervals:
        age = interval["midAgeMa"]
        crust = polygonal(unary_union([row["geometry"] for row in continents
                                       if row["endMa"] <= age <= row["beginMa"]]))
        land = polygonal(unary_union([geometries["lm"][row["index"]]
                                      for row in active_rows(rows_by_class["lm"], interval)]))
        shallow = polygonal(unary_union([geometries["sm"][row["index"]]
                                         for row in active_rows(rows_by_class["sm"], interval)]))
        crust_area = area_km2(crust)
        residual = polygonal(crust.difference(land))
        residual_area = area_km2(residual)
        residual_shallow = area_km2(polygonal(residual.intersection(shallow)))
        residual_other = residual_area - residual_shallow
        shallow_area = area_km2(shallow)
        shallow_outside = area_km2(polygonal(shallow.difference(crust)))
        report.append({
            "intervalId": interval["intervalId"],
            "cao2024ContinentalCrustSquareKilometres": round(crust_area, 3),
            "landmassSquareKilometres": round(area_km2(land), 3),
            "shallowMarineSquareKilometres": round(shallow_area, 3),
            "crustNotCoveredByLandmassSquareKilometres": round(residual_area, 3),
            "crustNotCoveredByLandmassAndShallowMarineSquareKilometres": round(residual_shallow, 3),
            "crustNotCoveredByLandmassNorShallowMarineSquareKilometres": round(residual_other, 3),
            "shallowMarineShareOfResidualPercent":
                round(100.0 * residual_shallow / residual_area, 3) if residual_area else 0.0,
            "unmappedShareOfResidualPercent":
                round(100.0 * residual_other / residual_area, 3) if residual_area else 0.0,
            "shallowMarineOutsideCrustSquareKilometres": round(shallow_outside, 3),
            "shallowMarineOutsideCrustPercent":
                round(100.0 * shallow_outside / shallow_area, 3) if shallow_area else 0.0,
        })
    return report


def witness_report(rows_by_class: dict[str, list[dict]], geometries: dict[str, dict[int, object]],
                   partitions: list[dict], tree: STRtree, intervals: list[dict]) -> dict:
    by_id = {interval["intervalId"]: interval for interval in intervals}
    report: dict[str, dict] = {}
    for name, (lon, lat) in WITNESS_POINTS.items():
        point = shapely.Point(lon, lat)
        owners = [partitions[index] for index in tree.query(point)
                  if partitions[index]["geometry"].contains(point)]
        rows = {}
        for interval_id in WITNESS_INTERVALS:
            interval = by_id[interval_id]
            hits = {}
            for class_name in CLASSES:
                matches = [row for row in active_rows(rows_by_class[class_name], interval)
                           if geometries[class_name][row["index"]].contains(point)]
                if matches:
                    hits[class_name] = sorted({row["plateId1"] for row in matches})
            rows[interval_id] = {
                "classes": sorted(hits),
                "plateId1ByClass": hits,
                "drawnAs": ("palaeo-mountain" if "m" in hits else
                            "palaeo-land" if "lm" in hits else
                            "palaeo-shallow-marine" if "sm" in hits else "no-class"),
            }
        report[name] = {
            "presentDayLonLat": [lon, lat],
            "ownerPartitionPlateIds": sorted({row["plateId"] for row in owners}),
            "intervals": rows,
        }
    return report


def node_reduction(result: dict, intervals: list[dict]) -> dict:
    """Douglas-Peucker preview at the plan's candidate tolerances."""
    per_tolerance = []
    for tolerance in SIMPLIFY_TOLERANCES:
        per_interval = []
        total_vertices = 0
        total_area = 0.0
        total_source_area = 0.0
        total_lost = 0
        total_lost_area = 0.0
        payload_bytes = 0
        for interval in intervals:
            pieces = result["_pieces"][interval["intervalId"]]
            vertices = 0
            kept_area = 0.0
            source_area = 0.0
            lost = 0
            lost_area = 0.0
            worst_lost = 0.0
            interval_bytes = 0
            for piece in pieces:
                original_area = area_km2(piece)
                source_area += original_area
                simplified = polygonal(piece.simplify(tolerance, preserve_topology=True))
                if simplified.is_empty:
                    lost += 1
                    lost_area += original_area
                    worst_lost = max(worst_lost, original_area)
                    continue
                simplified_area = area_km2(simplified)
                if simplified_area < MIN_PIECE_KM2:
                    lost += 1
                    lost_area += original_area
                    worst_lost = max(worst_lost, original_area)
                    continue
                kept_area += simplified_area
                parts = polygon_parts(simplified)
                for part in parts:
                    rings = 1 + len(part.interiors)
                    count = int(shapely.get_coordinates(part).shape[0])
                    vertices += count
                    # int16 lon/lat per vertex, 8-byte piece header
                    # (u16 partition binding, u16 evidence index, u16 ring count,
                    # u16 reserved) and a 4-byte u32 vertex count per ring.
                    interval_bytes += 8 + 4 * rings + 4 * count
            per_interval.append({
                "intervalId": interval["intervalId"],
                "cutVertices": next(row["cutVertices"] for row in result["perInterval"]
                                    if row["intervalId"] == interval["intervalId"]),
                "simplifiedVertices": vertices,
                "lostPieces": lost,
                "lostAreaSquareKilometres": round(lost_area, 3),
                "largestLostPieceSquareKilometres": round(worst_lost, 3),
                "areaErrorPercent": round(100.0 * (kept_area - source_area) / source_area, 5)
                                    if source_area else 0.0,
                "ringPayloadBytes": interval_bytes,
            })
            total_vertices += vertices
            total_area += kept_area
            total_source_area += source_area
            total_lost += lost
            total_lost_area += lost_area
            payload_bytes += interval_bytes
        per_tolerance.append({
            "toleranceDegrees": tolerance,
            "preserveTopology": True,
            "simplifiedVertices": total_vertices,
            "cutVertices": result["totalCutVertices"],
            "vertexReductionPercent": round(
                100.0 * (result["totalCutVertices"] - total_vertices) / result["totalCutVertices"], 3)
                if result["totalCutVertices"] else 0.0,
            "areaErrorPercent": round(100.0 * (total_area - total_source_area) / total_source_area, 5)
                                if total_source_area else 0.0,
            "lostPieces": total_lost,
            "lostAreaSquareKilometres": round(total_lost_area, 3),
            "maxLostPiecesInOneInterval": max(row["lostPieces"] for row in per_interval),
            "largestLostPieceSquareKilometres":
                round(max(row["largestLostPieceSquareKilometres"] for row in per_interval), 3),
            "lostPieceGateSquareKilometres": LOST_PIECE_KM2,
            "lostPieceGatePass":
                max(row["largestLostPieceSquareKilometres"] for row in per_interval) <= LOST_PIECE_KM2,
            "ringPayloadBytes": payload_bytes,
            "ringPayloadMebibytes": round(payload_bytes / 1048576.0, 4),
            "worstIntervalByVertices": max(per_interval, key=lambda row: row["simplifiedVertices"]),
            "perInterval": per_interval,
        })
    return {
        "quantisation": {
            "longitude": "int16, round(lon * 32767 / 180), 0.0055 degree step",
            "latitude": "int16, round(lat * 32767 / 90), 0.0027 degree step",
            "pieceHeaderBytes": 8, "ringHeaderBytes": 4, "vertexBytes": 4,
        },
        "tolerances": per_tolerance,
    }


# --------------------------------------------------------------------------
# audit
# --------------------------------------------------------------------------

def run_audit(pinned: dict[str, tuple[int, str]] | None = None,
              rotation_paths: list[Path] | None = None,
              schedule_shift: tuple[str, float] | None = None) -> dict:
    started = time.time()
    pinned = pinned or PINNED
    rotation_paths = rotation_paths or [ROTATION_YOUNG, ROTATION_OLD]
    inputs = verify_inputs(pinned)

    with zipfile.ZipFile(ARCHIVE) as archive:
        rows_by_class = {name: read_class(archive, name) for name in CLASSES}

    geometries: dict[str, dict[int, object]] = {}
    area_by_record: dict[tuple[str, int], float] = {}
    for name, rows in rows_by_class.items():
        table = {}
        for row in rows:
            geometry = source_polygon(row)
            table[row["index"]] = geometry
            area_by_record[(name, row["index"])] = area_km2(geometry)
        geometries[name] = table

    intervals = canonical_schedule(rows_by_class)
    if schedule_shift is not None:
        target, delta = schedule_shift
        for interval in intervals:
            if interval["intervalId"] == target:
                interval["toAgeMa"] += delta
    schedule = schedule_report(rows_by_class, intervals, area_by_record)
    checkpoints = checkpoint_report(rows_by_class, intervals)
    rotations = pygplates.RotationModel([str(path) for path in rotation_paths],
                                        default_anchor_plate_id=0)
    rotation_check = check_rotation_model(rotation_paths)
    trap = rotation_trap_report()

    partitions, splits = load_partitions()
    tree = STRtree([row["geometry"] for row in partitions])
    partition_plates = {row["plateId"] for row in partitions}
    trap["staticPartitionPlatesNeedingTheOldRotationFile"] = identity_only_plates(partition_plates)
    partition_total = sum(row["areaSquareKilometres"] for row in partitions)
    partition_overlap = 0.0
    overlapping_pairs = 0
    for index, row in enumerate(partitions):
        for other in tree.query(row["geometry"]):
            if other <= index:
                continue
            shared = polygonal(row["geometry"].intersection(partitions[other]["geometry"]))
            if shared.is_empty:
                continue
            value = area_km2(shared)
            if value <= 0.0:
                continue
            partition_overlap += value
            overlapping_pairs += 1
    by_plate = load_palette()

    per_class = {}
    cuts = {}
    for name in CUT_CLASSES:
        result = cookie_cut(rows_by_class[name], geometries[name], partitions, tree,
                            intervals, rotations, by_plate)
        cuts[name] = result
        conflict = conflict_report(result)
        cut_area = result["cutAreaSquareKilometres"]
        per_class[name] = {
            "cookieCut": {key: value for key, value in result.items()
                          if not key.startswith("_") and key not in ("plateRows", "coMoving")},
            "coMovingAreaPercent": {
                "under25Km": round(100.0 * result["coMoving"]["near"] / cut_area, 3) if cut_area else 0.0,
                "from25To250Km": round(100.0 * result["coMoving"]["mid"] / cut_area, 3) if cut_area else 0.0,
                "over250Km": round(100.0 * result["coMoving"]["far"] / cut_area, 3) if cut_area else 0.0,
            },
            "ownerPlateCutAreaTop": [
                {"ownerPlateId": plate, "cutAreaSquareKilometres": round(value, 3)}
                for plate, value in sorted(result["ownerPlateAreas"].items(),
                                           key=lambda item: -item[1])[:25]],
            "perPlate": conflict["plates"][:40],
            "perPlateRecorded": len(conflict["plates"]),
            "proposedPlateId1Overrides": proposed_overrides(conflict, cut_area),
        }

    restoration = {
        "trap": ("entries_covering() in scripts/research/emit_cao_material_corrections.py "
                 "skips restoration- palette entries, so a palaeo chart cut onto partitions "
                 "303 or 315 would take native Cao motion and detach from the restored North "
                 "Sea shelf unless it is bound to the restoration entry explicitly"),
        "plates": [],
    }
    for plate in (303, 315):
        entries = [{"entryId": entry["entryId"], "youngestAgeMa": entry["youngestAgeMa"],
                    "oldestAgeMa": entry["oldestAgeMa"]} for entry in by_plate.get(plate, [])]
        restoration["plates"].append({
            "ownerPlateId": plate,
            "paletteEntries": entries,
            "restorationEntryIds": [entry["entryId"] for entry in entries
                                    if entry["entryId"].startswith("restoration-")],
            "cutAreaSquareKilometresByClass": {
                name: round(cuts[name]["ownerPlateAreas"].get(plate, 0.0), 3)
                for name in CUT_CLASSES},
            "nativeOnlyCoverageComplete": all(
                palette_covers(by_plate, plate, interval["toAgeMa"], interval["fromAgeMa"])
                for interval in intervals),
        })

    continents = load_cao2024_continents()
    audit_rows = area_audit(continents, rows_by_class, geometries, intervals)
    witnesses = witness_report(rows_by_class, geometries, partitions, tree, intervals)
    reduction = {name: node_reduction(cuts[name], intervals) for name in CUT_CLASSES}

    lm_co_moving = per_class["lm"]["coMovingAreaPercent"]["under25Km"]
    raw = {name: per_class[name]["cookieCut"]["areaRatioPercent"] for name in CUT_CLASSES}
    net = {name: per_class[name]["cookieCut"]["areaRatioNetOfPartitionOverlapPercent"]
           for name in CUT_CLASSES}
    low, high = AREA_PRESERVATION_BOUNDS
    stop_rules = {
        "areaPreservationPercent": {
            "measuredRawPercent": raw,
            "measuredNetOfPartitionOverlapPercent": net,
            "boundsPercent": list(AREA_PRESERVATION_BOUNDS),
            "classesOutsideBoundsRaw": sorted(name for name, value in raw.items()
                                              if not low <= value <= high),
            "classesOutsideBoundsNet": sorted(name for name, value in net.items()
                                              if not low <= value <= high),
            "attribution": ("the raw excess is ground claimed twice where two present-day static "
                            "partitions overlap; the compiler must give each cut piece exactly one "
                            "owner, and the net figure is what that yields"),
            "pass": all(low <= value <= high for value in net.values()),
        },
        "coMovingLandmassPercent": {
            "measured": lm_co_moving,
            "minimumPercent": CO_MOVING_LM_MINIMUM_PERCENT,
            "thresholdKilometres": CO_MOVING_NEAR_KM,
            "pass": lm_co_moving >= CO_MOVING_LM_MINIMUM_PERCENT,
        },
        "exactlyOneCanonicalIntervalPerCheckpoint": {
            "measured": checkpoints["exactlyOneActiveInside"] and checkpoints["noneActiveOutside"],
            "pass": checkpoints["exactlyOneActiveInside"] and checkpoints["noneActiveOutside"],
        },
        "bothRotationFilesLoaded": {
            "measuredWorstSeparationKilometres": rotation_check["worstSeparationKilometres"],
            "pass": rotation_check["worstSeparationKilometres"] <= 1.0,
        },
    }
    failing = sorted(name for name, row in stop_rules.items() if not row["pass"])

    return {
        "auditId": AUDIT_ID,
        "auditedAt": AUDITED_AT,
        "generatedBy": "scripts/research/palaeo_coastlines_audit.py",
        "plan": "dev-docs/plans/palaeo-coastlines-polygons.md",
        "runtime": {
            "pygplates": pygplates.__version__,
            "shapely": shapely.__version__,
            "numpy": np.__version__,
            "pyshp": shapefile.__version__,
            "python": sys.version.split()[0],
            "elapsedSeconds": round(time.time() - started, 2),
        },
        "inputs": inputs,
        "coordinateFrame": {
            "source": "Cao et al. (2017) polygons are present-day WGS84 (.prj GCS_WGS_1984); "
                      "no rotation file ships with the package",
            "target": "Cao et al. (2024) v2.4 present-day static partitions, anchor plate 0, "
                      "palaeomagnetic absolute frame",
            "method": "present-day-class-reattached-to-cao2024-partition-v1",
        },
        "schedule": schedule,
        "checkpoints": checkpoints,
        "rotationTrap": trap,
        "partitions": {
            "polygons": len(partitions),
            "distinctPlateIds": len(partition_plates),
            "totalAreaSquareKilometres": round(partition_total, 3),
            "pairwiseSelfOverlapSquareKilometres": round(partition_overlap, 3),
            "pairwiseSelfOverlapPercentOfTotal": round(100.0 * partition_overlap / partition_total, 4),
            "overlappingPolygonPairs": overlapping_pairs,
            "coveragePercentOfEarth": round(100.0 * (partition_total - partition_overlap) / EARTH_AREA_KM2, 3),
            "earthAreaSquareKilometres": round(EARTH_AREA_KM2, 3),
            "datelineSplits": splits,
        },
        "classes": per_class,
        "areaAudit": {
            "method": "present-day coordinates; Cao 2024 continent polygons active at the "
                      "interval mid-age against the Cao 2017 lm/sm records active under "
                      "(TOAGE, FROMAGE]",
            "perInterval": audit_rows,
            "shallowMarineShareOfResidualPercentRange": [
                round(min(row["shallowMarineShareOfResidualPercent"] for row in audit_rows), 3),
                round(max(row["shallowMarineShareOfResidualPercent"] for row in audit_rows), 3)],
            "unmappedShareOfResidualPercentRange": [
                round(min(row["unmappedShareOfResidualPercent"] for row in audit_rows), 3),
                round(max(row["unmappedShareOfResidualPercent"] for row in audit_rows), 3)],
            "shallowMarineOutsideCrustPercentRange": [
                round(min(row["shallowMarineOutsideCrustPercent"] for row in audit_rows), 3),
                round(max(row["shallowMarineOutsideCrustPercent"] for row in audit_rows), 3)],
        },
        "northSeaRestorationBinding": restoration,
        "witnesses": witnesses,
        "nodeReduction": reduction,
        "stopRules": stop_rules,
        "status": "pass" if not failing else "stop",
        "failingStopRules": failing,
    }


# --------------------------------------------------------------------------
# self test
# --------------------------------------------------------------------------

def _expect_failure(label: str, call) -> str:
    try:
        call()
    except AuditError as error:
        return f"{label}: rejected ({error})"
    raise AuditError(f"self-test: mutation {label!r} was accepted")


def self_test() -> dict:
    """Prove each checker can fail, then prove the clean inputs still pass."""
    results = []

    verify_inputs(PINNED)
    corrupted = deepcopy(PINNED)
    corrupted["lm_402_2.dbf"] = (corrupted["lm_402_2.dbf"][0], "0" * 64)
    results.append(_expect_failure("corrupted pinned sha256 for lm_402_2.dbf",
                                   lambda: verify_inputs(corrupted)))
    verify_inputs(PINNED)  # restored

    with zipfile.ZipFile(ARCHIVE) as archive:
        rows_by_class = {name: read_class(archive, name) for name in CLASSES}
    intervals = canonical_schedule(rows_by_class)
    checkpoint_report(rows_by_class, intervals)
    shifted = deepcopy(intervals)
    for interval in shifted:
        if interval["intervalId"] == "94-81":
            interval["toAgeMa"] -= 6.0  # 94 -> 75.01 overlaps the next interval
    results.append(_expect_failure("canonical TOAGE shifted by 6 Ma on interval 94-81",
                                   lambda: checkpoint_report(rows_by_class, shifted)))
    checkpoint_report(rows_by_class, canonical_schedule(rows_by_class))  # restored

    truncated = deepcopy(rows_by_class)
    for row in truncated["sm"]:
        if (row["fromAge"], row["toAge"]) == (94.0, 81.01):
            row["toAge"] = 70.01
    results.append(_expect_failure("one class TOAGE moved off the shared schedule",
                                   lambda: canonical_schedule(truncated)))
    canonical_schedule(rows_by_class)  # restored

    check_rotation_model([ROTATION_YOUNG, ROTATION_OLD])
    results.append(_expect_failure("only 1000_0_rotfile.rot loaded",
                                   lambda: check_rotation_model([ROTATION_YOUNG])))
    restored = check_rotation_model([ROTATION_YOUNG, ROTATION_OLD])

    return {
        "mutationsRejected": len(results),
        "mutations": results,
        "restoredChecks": {
            "inputs": "pass",
            "schedule": "pass",
            "checkpoints": "pass",
            "rotationWorstSeparationKilometres": restored["worstSeparationKilometres"],
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true",
                        help="prove the checkers reject mutated inputs, then restore")
    parser.add_argument("--out", type=Path, default=REPORT,
                        help="audit record to write (default: the tracked research record)")
    parser.add_argument("--no-write", action="store_true", help="measure without writing the record")
    args = parser.parse_args()
    if getattr(args, "self_test"):
        print(json.dumps(self_test(), indent=2))
        return
    report = run_audit()
    if not args.no_write:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=1, sort_keys=True) + "\n")
    summary = {
        "status": report["status"],
        "failingStopRules": report["failingStopRules"],
        "stopRules": report["stopRules"],
        "elapsedSeconds": report["runtime"]["elapsedSeconds"],
        "out": str(args.out) if not args.no_write else None,
    }
    print(json.dumps(summary, indent=2))
    if report["status"] != "pass":
        sys.exit(1)


if __name__ == "__main__":
    main()
