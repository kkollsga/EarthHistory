#!/usr/bin/env python3
"""Derive the LGM lowstand land polygons from the pinned ETOPO 2022 crops.

Land at the Last Glacial Maximum is taken here as *present-day ETOPO 2022
surface elevation at or above the eustatic lowstand datum*, -120 m, inside
three footprints and nowhere else. That is a deliberately weak claim and the
manifest states its limitations verbatim; see
``docs/research/palaeo-coastlines-lgm-lowstand.md``.

Method:

1. read the crops pinned by ``palaeo_coastlines_lgm_acquire.py`` and verify
   every raster against the sha256 in its manifest;
2. build the boolean mask ``surface >= -120`` on the source 1 arc-minute grid, and
   **subtract the present-day land the application draws** from it. The layer
   ships the *exposed shelf* only: the ground the lowstand added to the
   coastline, never the ground that is dry today. Drawn land is the emitted
   Cao v2.4 ``shapes_coasts`` charts at 0 Ma plus the observed-land omission
   correction - the same two polygon sets the 0 Ma composition fills as land -
   eroded by ``MODERN_LAND_OVERLAP_KM`` so the shelf still laps 1.5 km over the
   drawn coast and no sliver of sphere opens along it. The mask complements the
   drawn coast, so an estuary the drawn coast leaves as water is shelf here;
3. polygonise the mask on **cell boundaries** — maximal axis-aligned rectangles
   of set cells, unioned. No contour interpolation is invented between two
   source cells, so every vertex of the raw polygon lies on a real grid line;
4. drop parts below 25 km2 (the pipeline's floor everywhere else), simplify at
   0.02 degrees with topology preserved, drop again, and round to 4 decimals
   (~11 m, two orders below the 1.85 km source cell);
5. write the tracked contract
   ``data/corrections/palaeo-coastlines/lgm/lgm-lowstand-v1.geojson`` and its
   manifest, with the datum, the LGM window, the limitations and the references.

Run under the pinned pyGPlates environment: the spherical areas come from
pyGPlates, exactly as the rest of the palaeo pipeline measures area.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pygplates
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import transform, unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cao_package_intern as package_intern  # noqa: E402
import palaeo_coastlines_audit as audit  # noqa: E402
import palaeo_coastlines_lgm_acquire as acquire  # noqa: E402
import palaeo_coastlines_rings as rings  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
STORE = acquire.STORE
CONTRACT = ROOT / "data/corrections/palaeo-coastlines/lgm"
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"

# Present-day land as the *application draws it* at 0 Ma, pinned. Two parts, and
# both are needed: the emitted Cao v2.4 `shapes_coasts` charts are the foundation
# land fill, and the observed-land omission correction is the tracked repair that
# adds the observed modern land those charts miss. Anything outside their union
# is water on screen at 0 Ma.
#
# Natural Earth 1:50m stood here until 2026-09-16 and was wrong for this job: it
# generalises estuaries, firths, fjords and belt seas as land, so subtracting it
# punched a hole in the exposed shelf exactly where the drawn coast has water,
# and at 21 ka the sphere's shelf tint needled through along the Solway, Clyde,
# Tay, Humber, Morecambe, Tyne, Ems/Dollart, Schlei, Kiel Fjord, Vejle,
# Limfjord, Great Belt and the North Frisian Wadden. The mask must complement
# the land that is drawn, not the land some other cartographer drew.
CAO_COASTS = audit.COASTS
CAO_COASTS_PINNED = audit.PINNED["shapes_coasts.gpmlz"]
CAO_CHART_PREFIX = "cao-coast"
OBSERVED_LAND_GEOJSON = ROOT / "data/corrections/observed-land-omission/observed-land-omission-v1.geojson"
# Sanity floors on the two inputs: a silent drop to a handful of polygons would
# turn most of the world into "exposed shelf" without any other symptom.
MINIMUM_CAO_COAST_CHARTS = 200
MINIMUM_OBSERVED_LAND_PARTS = 1

LOWSTAND_DATUM_M = -120.0
LGM_OLDEST_MA = 0.0265
LGM_YOUNGEST_EXCLUSIVE_MA = 0.0195
MIN_PIECE_KM2 = audit.MIN_PIECE_KM2
SIMPLIFY_DEGREES = 0.02
COORDINATE_DECIMALS = 4
# How far the exposed shelf is allowed to lap over present-day land. Present-day
# land is eroded by this much before it is subtracted, so the shipped shelf and
# the native land polygons overlap instead of leaving a hairline of bare sphere
# along the modern coastline. Same-class overdraw is invisible; a gap is not.
MODERN_LAND_OVERLAP_KM = 1.5
EARTH_RADIUS_KM = 6371.0088
KM_PER_DEGREE = EARTH_RADIUS_KM * math.pi / 180.0
# Narrowest exposed shelf this layer will draw. Subtracting a generalised
# coastline from a 1 arc-minute raster mask leaves needles far thinner than the
# 1.85 km source cell along an indented coast - the Norwegian fjords and the
# Skagerrak worst of all. They are an artefact of two
# incompatible resolutions meeting, never a claim about the lowstand shore, and
# once int16 quantisation (0.0055 deg lon, 0.0027 deg lat) moves their walls
# past one another the ring self-intersects and the renderer's ear-clip fills it
# with hairline triangles. A morphological opening at half this width removes
# them before either step can see them. Set well above the quantisation error so
# no surviving wedge is narrow enough for quantisation to turn inside out.
MINIMUM_SHELF_WIDTH_KM = 1.5
# Vertices sharper than this are spikes, not shore. Applied after simplification
# so it judges the shipped ring, not the staircase it came from. Shared with the
# interval compiler, which runs the same filter over every Cao interval.
MINIMUM_INTERIOR_ANGLE_DEGREES = rings.MINIMUM_INTERIOR_ANGLE_DEGREES

# One entry per named footprint; a footprint may be covered by several crops
# (Beringia spans the antimeridian and is therefore two).
FOOTPRINTS = {
    "north-sea": {
        "title": "Southern and central North Sea (Doggerland)",
        "bounds": [-6.0, 49.0, 12.0, 62.0],
        "crops": ["north-sea"],
    },
    "sundaland": {
        "title": "Sunda shelf",
        "bounds": [95.0, -10.0, 120.0, 12.0],
        "crops": ["sundaland"],
    },
    "beringia": {
        "title": "Beringia and the Bering land bridge",
        "bounds": [160.0, 55.0, -150.0, 72.0],
        "crops": ["beringia-west", "beringia-east"],
        "crossesAntimeridian": True,
    },
}

WITNESSES = (
    ("dogger-bank", 2.5, 54.7, "north-sea", True,
     "Dogger Bank: subaerial at the lowstand, a shallow bank today"),
    ("london", -0.1, 51.5, "north-sea", False,
     "London: dry land today, so it is not exposed shelf and this layer ships nothing "
     "there; the native present-day land keeps drawing it"),
    ("north-german-plain", 10.0, 53.0, "north-sea", False,
     "Schleswig-Holstein: dry land today, inside the crop rectangle, and the reason the "
     "footprint edge used to show as a tonal seam across Germany"),
    ("borneo-interior", 114.0, 0.5, "sundaland", False,
     "central Borneo: dry land today, not shelf the lowstand exposed"),
    ("alaska-interior", -155.0, 65.0, "beringia", False,
     "interior Alaska: dry land today, not part of the land bridge this layer adds"),
    ("sunda-shelf", 108.0, 2.0, "sundaland", True,
     "central Sunda shelf between Sumatra, Borneo and the Malay peninsula"),
    ("bering-land-bridge", -170.0, 65.0, "beringia", True,
     "Bering land bridge, north of St Lawrence Island"),
    ("norwegian-trench", 4.0, 58.5, "north-sea", False,
     "Norwegian Trench at -254 m: far below the lowstand datum, still sea"),
    ("makassar-strait", 118.5, -2.0, "sundaland", False,
     "Makassar Strait: never closed by a lowstand (Hall 2009)"),
    ("humber-estuary", -0.709, 53.653, "north-sea", True,
     "inner Humber: the drawn 0 Ma coast has open water here and ETOPO has the bed "
     "above the datum, so it is exposed shelf. Natural Earth 1:50m generalises the "
     "estuary as land, and subtracting that used to leave a hole the sphere's shelf "
     "tint needled through. The estuary mouth itself (-0.3, 53.6) is +12 m of dry "
     "modern ground, so no exposed-shelf layer can ship anything there"),
    ("devils-hole", 0.7, 56.6, "north-sea", False,
     "Devil's Hole: trenches more than 200 m deep inside the exposed shelf, water at "
     "the lowstand and still water here"),
    ("aleutian-basin", -175.0, 57.0, "beringia", False,
     "deep Aleutian Basin south of the shelf break: open ocean at the lowstand"),
)

# The footprint boxes are far larger than the landscapes the literature names,
# so one named sub-window per footprint is measured as well and reported beside
# the published figures. These are measurement windows, not claims of extent.
NAMED_SUB_WINDOWS = {
    "north-sea": ("doggerland-southern-north-sea", (-2.0, 51.0, 9.0, 57.0),
                  "the southern North Sea plain between England, the Netherlands,"
                  " north-west Germany and Denmark"),
    "sundaland": ("sunda-shelf-core", (99.0, -6.0, 118.0, 8.0),
                  "the Sunda shelf between Sumatra, the Malay peninsula, Borneo and Java"),
    "beringia": ("bering-land-bridge", (-180.0, 60.0, -160.0, 70.0),
                 "the eastern half of the Bering land bridge, Chukchi to Norton Sound"),
}

REFERENCES = [
    {
        "sourceId": "noaa-etopo-2022",
        "citation": ("NOAA National Centers for Environmental Information 2022. "
                     "ETOPO 2022 15 Arc-Second Global Relief Model. NOAA NCEI."),
        "url": "https://doi.org/10.25921/fd45-gt74",
        "year": 2022,
        "constrains": ("the present-day surface elevation and bathymetry the -120 m "
                       "contour is taken from"),
        "claimOrInference": ("the elevations are the source's own measurement and model; "
                             "reading them as a palaeo-shoreline is EarthHistory's inference"),
    },
    {
        "sourceId": "natural-earth-countries-50m",
        "citation": ("Natural Earth 2022. 1:50m Cultural Vectors, Admin 0 - Countries, "
                     "version 5.1.1. Public domain."),
        "url": ("https://www.naturalearthdata.com/downloads/50m-cultural-vectors/"
                "50m-admin-0-countries-2/"),
        "year": 2022,
        "constrains": ("present-day land, indirectly: the observed-land omission correction "
                       "is derived from this archive, and that correction is part of the drawn "
                       "0 Ma land subtracted from the -120 m mask. Natural Earth is no longer "
                       "subtracted directly - it generalises estuaries, firths, fjords and belt "
                       "seas as land where the drawn coast has water"),
        "claimOrInference": ("the land polygons are the source's own generalised present-day "
                             "coastline; which of them reach this layer, through the "
                             "observed-land omission correction, is EarthHistory's method"),
    },
    {
        "sourceId": "cao-v2.4-native-coasts",
        "citation": ("Cao, X., Zahirovic, S., Li, S., Young, A., Muller, R. D. and others 2024. "
                     "A deep-time plate motion model with continuously evolving topological "
                     "plate boundaries, v2.4, shapes_coasts.gpmlz."),
        "url": "https://doi.org/10.5281/zenodo.13628813",
        "year": 2024,
        "constrains": ("the present-day land the application actually draws: the emitted "
                       "shapes_coasts charts at 0 Ma are the foundation land fill, and they "
                       "are subtracted from the -120 m mask so this layer ships the exposed "
                       "shelf only and complements the drawn coast exactly"),
        "claimOrInference": ("the coastline polygons are the model's own geography; reading "
                             "their 0 Ma pose as the present-day shoreline this layer must "
                             "complement is EarthHistory's method"),
    },
    {
        "sourceId": "lambeck-2014-sea-level",
        "citation": ("Lambeck, K., Rouby, H., Purcell, A., Sun, Y. and Sambridge, M. 2014. "
                     "Sea level and global ice volumes from the Last Glacial Maximum to the "
                     "Holocene. PNAS 111, 15296-15303."),
        "url": "https://doi.org/10.1073/pnas.1411762111",
        "year": 2014,
        "constrains": ("the eustatic datum: a slow fall to -134 m from 29 to 21 ka, with a "
                       "companion model peak eustatic fall of ~130 m; -120 m is the "
                       "conservative round figure this layer draws"),
        "claimOrInference": ("the eustatic values are claims of the source; the choice of "
                             "-120 m and its application as a flat contour is EarthHistory's"),
    },
    {
        "sourceId": "clark-lgm-2009",
        "citation": ("Clark, P. U., Dyke, A. S., Shakun, J. D., Carlson, A. E., Clark, J., "
                     "Wohlfarth, B., Mitrovica, J. X., Hostetler, S. W. and McCabe, A. M. 2009. "
                     "The Last Glacial Maximum. Science 325, 710-714."),
        "url": "https://doi.org/10.1126/science.1172873",
        "year": 2009,
        "constrains": ("the time window: 'Nearly all ice sheets were at their LGM positions "
                       "from 26.5 ka to 19 to 20 ka'"),
        "claimOrInference": "claim of the source",
    },
    {
        "sourceId": "coles-1998-doggerland",
        "citation": ("Coles, B. J. 1998. Doggerland: a speculative survey. Proceedings of the "
                     "Prehistoric Society 64, 45-81."),
        "url": "https://doi.org/10.1017/S0079497X00002176",
        "year": 1998,
        "constrains": ("that the exposed southern North Sea plain was a real, inhabited "
                       "landscape, and that present-day North Sea relief 'does not provide a "
                       "sound guide' to its former relief"),
        "claimOrInference": ("claim of the source; it is also the source's own warning "
                             "against the method this layer uses"),
    },
    {
        "sourceId": "gaffney-2009-doggerland",
        "citation": ("Gaffney, V., Fitch, S. and Smith, D. 2009. Europe's Lost World: the "
                     "Rediscovery of Doggerland. CBA Research Report 160, Council for British "
                     "Archaeology, York."),
        "year": 2009,
        "constrains": ("the seismic mapping of the Doggerland landscape - rivers, lakes and "
                       "coast - that this eustatic contour cannot reproduce"),
        "claimOrInference": "claim of the source",
    },
    {
        "sourceId": "sturt-2013-inundation",
        "citation": ("Sturt, F., Garrow, D. and Bradley, S. 2013. New models of North West "
                     "European Holocene palaeogeography and inundation. Journal of "
                     "Archaeological Science 40, 3963-3976."),
        "url": "https://doi.org/10.1016/j.jas.2013.05.023",
        "year": 2013,
        "constrains": ("the GIA-modelled comparison figure: 127,422 km2 submerged in the "
                       "North Sea zone, 'an area twice that of all the other three regions "
                       "added together'"),
        "claimOrInference": ("model output of the source; quoted here only as the "
                             "order-of-magnitude anchor for our own measured area"),
    },
    {
        "sourceId": "bradley-2023-palaeo-sea-level",
        "citation": ("Bradley, S. L., Ely, J. C., Clark, C. D., Edwards, R. J. and Shennan, I. "
                     "2023. Reconstruction of the palaeo-sea level of Britain and Ireland "
                     "arising from empirical constraints of ice extent. Journal of Quaternary "
                     "Science 38, 791-805."),
        "url": "https://doi.org/10.1002/jqs.3523",
        "year": 2023,
        "constrains": ("why a flat eustatic contour is wrong in detail here: relative "
                       "sea-level around Britain and Ireland varies by more than 100 m "
                       "spatially under glacial isostatic adjustment"),
        "claimOrInference": ("the spatial variability is the source's claim; that it "
                             "invalidates a flat contour in detail is EarthHistory's inference"),
    },
    {
        "sourceId": "hall-2009-sundaland",
        "citation": ("Hall, R. 2009. Southeast Asia's changing palaeogeography. Blumea 54, "
                     "148-161."),
        "url": "https://doi.org/10.3767/000651909X475941",
        "year": 2009,
        "constrains": ("that a bathymetry-plus-eustasy reconstruction of the Sunda shelf is "
                       "'valid only for the Pleistocene', and that the Makassar Straits "
                       "'were never narrower than about 75 km'"),
        "claimOrInference": "claim of the source",
    },
]

LIMITATIONS = [
    "eustatic only: a single flat -120 m datum, applied globally inside three footprints",
    "no glacio-isostatic adjustment; relative sea level around an ice margin differed from"
    " the eustatic value by more than 100 m and varied over tens of kilometres",
    "ice sheets are not drawn: ground under the Fennoscandian, British-Irish and Laurentide"
    " ice sheets is shown as exposed land, which it was not",
    "ETOPO 2022 is modern bathymetry: sediment deposited, eroded and reworked since the LGM"
    " is not removed, and the present-day sea bed is not the lowstand land surface",
    "regional: only the southern/central North Sea, the Sunda shelf and Beringia are drawn;"
    " every other coastline at this age falls back to the present-day composition",
    "exposed shelf only: the present-day land the application draws is subtracted (the emitted"
    " Cao v2.4 shapes_coasts charts at 0 Ma plus the observed-land omission correction, eroded"
    " 1.5 km so the two overlap), so this state adds coastline to today's composition and never"
    " re-draws the ground that is dry now",
    "the exposed shelf is the complement of the drawn 0 Ma coast, not of an independent modern"
    " shoreline: where that coast generalises an estuary, a firth or a fjord, the lowstand shelf"
    " is drawn across it whenever ETOPO puts the sea bed above the datum",
    "rivers, lakes, estuaries and the Doggerland landscape mapped by seismic survey are not"
    " represented at all",
]


def load_manifest(store: Path) -> dict:
    return json.loads((store / "crop-manifest.json").read_text())


def read_crop(store: Path, record: dict) -> np.ndarray:
    raster = (store / record["raster"]["path"]).read_bytes()
    digest = hashlib.sha256(raster).hexdigest()
    if digest != record["raster"]["sha256"]:
        raise SystemExit(f"{record['id']}: pinned sha256 {record['raster']['sha256']} but the"
                         f" stored raster hashes {digest}")
    values = acquire.decode_tiff(raster, tuple(record["bounds"]),
                                 record["width"], record["height"])
    return np.asarray(values, dtype=np.float64).reshape(record["height"], record["width"])


def polygonal(geometry):
    """Only the polygonal parts of a geometry, made valid."""
    if geometry.is_empty:
        return Polygon()
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    parts = audit.polygon_parts(geometry)
    if not parts:
        return Polygon()
    return parts[0] if len(parts) == 1 else MultiPolygon(parts)


def unwrapped_copies(rings):
    """One planar polygon per antimeridian frame for a spherical ring set.

    A pyGPlates ring reports longitudes in [-180, 180], so a polygon that
    crosses the antimeridian - Chukotka, Wrangel, the Aleutians - reads in the
    plane as a ring that sweeps the whole globe backwards. Each ring is walked
    once and unwrapped (every step kept under 180 degrees), which puts the
    polygon in a single contiguous longitude band; the band is then emitted in
    every +-360 translate that can touch [-181, 181], so a planar clip against
    a crop window finds it whichever side of the seam the window sits on.
    """
    unwrapped = []
    for ring in rings:
        walked = []
        offset = 0.0
        previous = None
        for longitude, latitude in ring:
            if previous is not None:
                step = longitude + offset - previous
                if step > 180.0:
                    offset -= 360.0
                elif step < -180.0:
                    offset += 360.0
            previous = longitude + offset
            walked.append((previous, latitude))
        unwrapped.append(walked)
    west = min(point[0] for point in unwrapped[0])
    east = max(point[0] for point in unwrapped[0])
    copies = []
    for shift in (-720.0, -360.0, 0.0, 360.0, 720.0):
        if east + shift < -181.0 or west + shift > 181.0:
            continue
        moved = [[(longitude + shift, latitude) for longitude, latitude in ring]
                 for ring in unwrapped]
        candidate = polygonal(Polygon(moved[0], moved[1:]))
        if not candidate.is_empty:
            copies.append(candidate)
    return copies


def load_drawn_present_day_land():
    """Present-day land exactly as the application composes it at 0 Ma.

    The emitted Cao v2.4 ``shapes_coasts`` charts are the foundation land fill;
    the tracked observed-land omission correction adds the observed modern land
    those charts miss. Their union is what a viewer sees as land at 0 Ma, so its
    complement is what the viewer sees as water - and that, above the lowstand
    datum, is exactly the exposed shelf this layer ships.

    Only charts the shipped package actually emits are read, by chart id, so a
    coast polygon the package drops cannot be counted as drawn land here.
    """
    payload = CAO_COASTS.read_bytes()
    size, digest = CAO_COASTS_PINNED
    measured = hashlib.sha256(payload).hexdigest()
    if len(payload) != size or measured != digest:
        raise SystemExit(f"{CAO_COASTS.name}: pinned {size} B / {digest} but the stored file "
                         f"is {len(payload)} B / {measured}")
    emitted = {row.get("chartId")
               for row in package_intern.read_package_json(PUBLIC / "core.json").get("charts", [])}
    parts = []
    charts = 0
    for order, feature in enumerate(pygplates.FeatureCollection(str(CAO_COASTS))):
        oldest, youngest = feature.get_valid_time()
        if not youngest <= 0 <= oldest:
            continue
        geometry_order = 0
        for geometry in feature.get_all_geometries():
            if not isinstance(geometry, pygplates.PolygonOnSphere):
                continue
            chart_id = f"{CAO_CHART_PREFIX}:{feature.get_feature_id()}:{order}:{geometry_order}"
            geometry_order += 1
            if chart_id not in emitted:
                continue
            charts += 1
            rings = [[(point.to_lat_lon()[1], point.to_lat_lon()[0])
                      for point in geometry.get_exterior_ring_points()]]
            rings.extend([(point.to_lat_lon()[1], point.to_lat_lon()[0])
                          for point in geometry.get_interior_ring_points(index)]
                         for index in range(geometry.get_number_of_interior_rings()))
            parts.extend(unwrapped_copies(rings))
    if charts < MINIMUM_CAO_COAST_CHARTS:
        raise SystemExit(f"emitted Cao coast charts collapsed to {charts}; the package or the "
                         "chart-id convention changed")

    observed = json.loads(OBSERVED_LAND_GEOJSON.read_text())
    observed_parts = []
    for feature in observed["features"]:
        geometry = polygonal(shape(feature["geometry"]))
        if not geometry.is_empty:
            observed_parts.append(geometry)
    if len(observed_parts) < MINIMUM_OBSERVED_LAND_PARTS:
        raise SystemExit("the observed-land omission correction carries no polygons")
    parts.extend(observed_parts)
    return polygonal(unary_union(parts)), charts, len(observed_parts)


def eroded_land_for_crop(land, bounds, overlap_km: float):
    """Drawn present-day land near one crop, eroded by ``overlap_km``.

    The erosion runs in a local equirectangular frame (longitude scaled by
    cos(centre latitude)) so the inward offset is the same distance in both
    directions rather than three times larger east-west at 63 N. Land is taken
    from one degree beyond the crop so the crop's own rectangle edge never
    behaves like a coastline: a footprint boundary that cuts through Germany
    must subtract all of Germany there, not erode a strip of it into "shelf".
    """
    west, south, east, north = bounds
    window = box(max(west - 1.0, -180.0), max(south - 1.0, -90.0),
                 min(east + 1.0, 180.0), min(north + 1.0, 90.0))
    local = polygonal(land.intersection(window))
    inside = polygonal(land.intersection(box(west, south, east, north)))
    inside_km2 = audit.area_km2(inside) if not inside.is_empty else 0.0
    if local.is_empty:
        return local, inside_km2
    centre_latitude = math.radians((south + north) / 2.0)
    scale = max(math.cos(centre_latitude), 1e-6)
    degrees = overlap_km / (math.radians(1.0) * EARTH_RADIUS_KM)
    flattened = transform(lambda x, y, z=None: (x * scale, y), local)
    shrunk = flattened.buffer(-degrees, join_style=2)
    if shrunk.is_empty:
        return Polygon(), inside_km2
    restored = transform(lambda x, y, z=None: (x / scale, y), shrunk)
    return polygonal(restored), inside_km2


def mask_rectangles(mask: np.ndarray, bounds, width: int, height: int) -> list:
    """Maximal axis-aligned rectangles of set cells, in lon/lat degrees.

    Rows are north to south. A run of set cells is extended downwards while the
    row below carries exactly the same run, so a flat shelf becomes a handful of
    rectangles rather than one per cell.
    """
    west, south, east, north = bounds
    step_x = (east - west) / width
    step_y = (north - south) / height
    # open[(start, end)] = first row of an unfinished rectangle with that span.
    open_runs: dict[tuple[int, int], int] = {}
    rectangles = []

    def runs_of(row: int) -> set:
        if row >= height:
            return set()
        line = mask[row]
        # Transitions on a padded copy give run starts and ends without a loop.
        padded = np.concatenate(([False], line, [False]))
        edges = np.flatnonzero(padded[1:] != padded[:-1])
        return set(zip(edges[0::2].tolist(), edges[1::2].tolist()))

    previous: set = set()
    for row in range(height + 1):
        current = runs_of(row)
        for span in previous - current:
            start_row = open_runs.pop(span)
            rectangles.append(box(west + span[0] * step_x, north - row * step_y,
                                  west + span[1] * step_x, north - start_row * step_y))
        for span in current - previous:
            open_runs[span] = row
        previous = current
    if open_runs:
        raise RuntimeError("rectangle decomposition left an open run")
    return rectangles


def metric_open(geometry, minimum_width_km: float):
    """Morphological opening at ``minimum_width_km``, measured in kilometres.

    Longitude is scaled by cos(latitude) first so one unit means the same
    distance along both axes; without that a buffer in raw degrees would erode
    roughly twice as hard north-south as east-west at these latitudes. Erode by
    half the width, then dilate by the same amount: anything narrower than the
    width disappears, everything wider keeps its position.
    """
    if geometry.is_empty:
        return geometry
    west, south, east, north = geometry.bounds
    cosine = max(math.cos(math.radians((south + north) / 2.0)), 0.1)
    radius = (minimum_width_km / 2.0) / KM_PER_DEGREE

    def squeeze(x, y, z=None):
        return (x * cosine, y)

    def stretch(x, y, z=None):
        return (x / cosine, y)

    scaled = transform(squeeze, geometry)
    opened = scaled.buffer(-radius, quad_segs=2).buffer(radius, quad_segs=2)
    if opened.is_empty:
        return opened
    return polygonal(transform(stretch, opened))


def despiked(parts, minimum_degrees: float) -> tuple[list, int]:
    """Run the shared spike filter over every exterior and hole of every part.

    The spike filter only. This layer's interior rings have already met the
    25 km2 floor in :func:`cleaned_parts`, and what ships is one hash-pinned
    contract, so the hole-width floor the interval compiler adds is not applied
    retroactively here.
    """
    cleaned, report = rings.polish_parts(parts, minimum_degrees)
    return cleaned, report["spikeVertices"]


def cleaned_parts(geometry, tolerance: float) -> tuple[list, dict]:
    """Drop sub-floor parts, simplify, drop again; report what each pass removed."""
    report = {"partsIn": 0, "droppedBeforeSimplify": 0, "droppedBeforeSimplifyKm2": 0.0,
              "droppedAfterSimplify": 0, "droppedAfterSimplifyKm2": 0.0,
              "holesDropped": 0, "holesDroppedKm2": 0.0}
    kept = []
    for part in audit.polygon_parts(geometry):
        report["partsIn"] += 1
        area = audit.ring_area_km2(part.exterior.coords)
        if area < MIN_PIECE_KM2:
            report["droppedBeforeSimplify"] += 1
            report["droppedBeforeSimplifyKm2"] += area
            continue
        holes = []
        for interior in part.interiors:
            hole_area = audit.ring_area_km2(interior.coords)
            if hole_area < MIN_PIECE_KM2:
                report["holesDropped"] += 1
                report["holesDroppedKm2"] += hole_area
                continue
            holes.append(interior)
        kept.append(Polygon(part.exterior, holes))
    simplified = []
    for part in kept:
        reduced = part.simplify(tolerance, preserve_topology=True)
        for piece in audit.polygon_parts(reduced):
            area = audit.ring_area_km2(piece.exterior.coords)
            if area < MIN_PIECE_KM2:
                report["droppedAfterSimplify"] += 1
                report["droppedAfterSimplifyKm2"] += area
                continue
            simplified.append(piece)
    return simplified, report


def rounded(geometry, decimals: int):
    def fix(ring):
        points = [(round(lon, decimals), round(lat, decimals)) for lon, lat in ring]
        out = [points[0]]
        for point in points[1:]:
            if point != out[-1]:
                out.append(point)
        if out[0] != out[-1]:
            out.append(out[0])
        return out

    parts = []
    for part in audit.polygon_parts(geometry):
        exterior = fix(part.exterior.coords)
        if len(exterior) < 4:
            continue
        holes = [fix(interior.coords) for interior in part.interiors]
        holes = [hole for hole in holes if len(hole) >= 4]
        candidate = Polygon(exterior, holes)
        if not candidate.is_valid:
            candidate = candidate.buffer(0)
        parts.extend(audit.polygon_parts(candidate))
    return disjoint(parts)


def disjoint(parts: list) -> list:
    """The same parts, guaranteed to assemble into a valid multipolygon.

    Every part is simplified and rounded on its own, so two neighbours along an
    indented coast can cross each other by a fraction of the tolerance even
    though each ring is sound. A multipolygon whose parts overlap is invalid,
    and every Boolean the compiler runs on it afterwards is undefined, so the
    crossings are unioned away here rather than shipped.
    """
    if len(parts) < 2 or MultiPolygon(parts).is_valid:
        return parts
    return audit.polygon_parts(unary_union(parts))


def point_in(parts, lon: float, lat: float) -> bool:
    from shapely.geometry import Point
    point = Point(lon, lat)
    return any(part.contains(point) or part.touches(point) for part in parts)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", type=Path, default=STORE)
    parser.add_argument("--out", type=Path, default=CONTRACT)
    arguments = parser.parse_args()
    manifest = load_manifest(arguments.store)
    crops = {record["id"]: record for record in manifest["outputs"]}
    present_day_land, coast_charts, observed_parts = load_drawn_present_day_land()

    features = []
    footprint_reports = {}
    parts_by_footprint: dict[str, list] = {}
    crop_reports = []
    for footprint_id, footprint in FOOTPRINTS.items():
        pieces = []
        lgm_km2 = 0.0
        present_km2 = 0.0
        sub_window: dict[str, dict] = {}
        for crop_id in footprint["crops"]:
            record = crops[crop_id]
            grid = read_crop(arguments.store, record)
            mask = grid >= LOWSTAND_DATUM_M
            rectangles = mask_rectangles(mask, tuple(record["bounds"]),
                                         record["width"], record["height"])
            merged = unary_union(rectangles)
            # The layer ships the exposed shelf only. Present-day land is
            # subtracted, eroded by MODERN_LAND_OVERLAP_KM so the two overlap.
            eroded, present_in_crop = eroded_land_for_crop(
                present_day_land, tuple(record["bounds"]), MODERN_LAND_OVERLAP_KM)
            subtracted = polygonal(merged.difference(eroded)) if not eroded.is_empty else merged
            # The generalised coastline cut into a 1 arc-minute mask leaves
            # needles thinner than one source cell. Open them away here, before
            # simplification can stretch them and quantisation can fold them.
            exposed = metric_open(subtracted, MINIMUM_SHELF_WIDTH_KM)
            crop_parts, report = cleaned_parts(exposed, SIMPLIFY_DEGREES)
            crop_parts, spikes_removed = despiked(crop_parts,
                                                  MINIMUM_INTERIOR_ANGLE_DEGREES)
            report["spikeVerticesRemoved"] = spikes_removed
            report["needleSquareKilometresRemoved"] = round(
                audit.area_km2(subtracted) - audit.area_km2(exposed), 3)
            pieces.extend(crop_parts)
            raw_km2 = audit.area_km2(merged)
            exposed_km2 = audit.area_km2(exposed)
            lgm_km2 += raw_km2
            present_km2 += present_in_crop
            window_id, window_bounds, window_note = NAMED_SUB_WINDOWS[footprint_id]
            clip = box(*window_bounds)
            sub_lgm = audit.area_km2(merged.intersection(clip))
            sub_exposed = audit.area_km2(exposed.intersection(clip))
            sub_window[window_id] = {
                "bounds": list(window_bounds), "note": window_note,
                "lgmLandSquareKilometres": round(
                    sub_window.get(window_id, {}).get("lgmLandSquareKilometres", 0.0)
                    + sub_lgm, 1),
                "exposedShelfSquareKilometres": round(
                    sub_window.get(window_id, {}).get("exposedShelfSquareKilometres", 0.0)
                    + sub_exposed, 1),
            }
            crop_reports.append({
                "crop": crop_id, "footprint": footprint_id,
                "rectangles": len(rectangles),
                "lgmLandSquareKilometres": round(raw_km2, 1),
                "presentDayLandSquareKilometres": round(present_in_crop, 1),
                "exposedShelfSquareKilometres": round(exposed_km2, 1),
                **{key: (round(value, 3) if isinstance(value, float) else value)
                   for key, value in report.items()},
            })
        pieces = disjoint(pieces)
        parts = rounded(MultiPolygon(pieces) if len(pieces) != 1 else pieces[0],
                        COORDINATE_DECIMALS)
        parts_by_footprint[footprint_id] = parts
        area = sum(audit.area_km2(part) for part in parts)
        vertices = sum(len(part.exterior.coords) + sum(len(h.coords) for h in part.interiors)
                       for part in parts)
        footprint_reports[footprint_id] = {
            "pieces": len(parts), "vertices": vertices,
            # `exposedShelfSquareKilometres` is what ships: the area of the
            # rings in the GeoJSON beside this report. The other two are the
            # unsubtracted lowstand mask and the present-day land taken out of
            # it, kept so the subtraction can be audited.
            "exposedShelfSquareKilometres": round(area, 1),
            "lgmLandSquareKilometres": round(lgm_km2, 1),
            "presentDayLandSquareKilometres": round(present_km2, 1),
            "namedSubWindow": sub_window,
        }
        features.append({
            "type": "Feature",
            "properties": {
                "footprintId": footprint_id,
                "title": footprint["title"],
                "bounds": footprint["bounds"],
                "crossesAntimeridian": bool(footprint.get("crossesAntimeridian")),
                "crops": footprint["crops"],
                "exposedShelfSquareKilometres": round(area, 1),
                "lgmLandSquareKilometres": round(lgm_km2, 1),
            },
            "geometry": mapping(MultiPolygon(parts) if len(parts) != 1 else parts[0]),
        })

    witnesses = []
    for witness_id, lon, lat, footprint_id, expected, note in WITNESSES:
        actual = point_in(parts_by_footprint[footprint_id], lon, lat)
        witnesses.append({"id": witness_id, "lon": lon, "lat": lat,
                          "footprint": footprint_id, "expectLand": expected,
                          "land": actual, "pass": actual == expected, "note": note})
    failures = [witness for witness in witnesses if not witness["pass"]]

    collection = {
        "type": "FeatureCollection",
        "name": "lgm-lowstand-v1",
        "features": features,
    }
    out: Path = arguments.out
    out.mkdir(parents=True, exist_ok=True)
    geojson_bytes = (json.dumps(collection, separators=(",", ":"),
                                sort_keys=False) + "\n").encode()
    (out / "lgm-lowstand-v1.geojson").write_bytes(geojson_bytes)

    contract = {
        "schemaVersion": 1,
        "contractId": "lgm-lowstand-v1",
        "title": "Last Glacial Maximum lowstand state (eustatic, regional)",
        "compiledUtc": datetime.now(timezone.utc).isoformat(),
        "intervalId": "lgm",
        "oldestMa": LGM_OLDEST_MA,
        "youngestExclusiveMa": LGM_YOUNGEST_EXCLUSIVE_MA,
        "window": {
            "citation": "Clark et al. 2009: ice sheets at LGM positions 26.5 ka to 19-20 ka",
            "sourceId": "clark-lgm-2009",
        },
        "datum": {
            "metres": LOWSTAND_DATUM_M,
            "verticalDatum": "EGM2008 (ETOPO 2022 surface band)",
            "citation": ("Lambeck et al. 2014: eustatic sea level fell slowly to -134 m "
                         "between 29 and 21 ka, with a companion model peak fall of ~130 m; "
                         "-120 m is the conservative round contour drawn here"),
            "sourceId": "lambeck-2014-sea-level",
        },
        "frame": "present-day WGS84, like the Cao et al. (2017) source polygons",
        "method": {
            "id": "etopo-2022-eustatic-lowstand-contour-v1",
            "description": ("boolean mask of ETOPO 2022 60 arc-second surface >= -120 m on the "
                            "source grid, polygonised on cell boundaries as maximal rectangles, "
                            "unioned, the present-day land the application draws at 0 Ma "
                            "(emitted Cao v2.4 shapes_coasts charts plus the observed-land "
                            f"omission correction) eroded by {MODERN_LAND_OVERLAP_KM:g} km and "
                            "subtracted so only the exposed shelf remains, opened at "
                            f"{MINIMUM_SHELF_WIDTH_KM:g} km so no "
                            "needle thinner than one source cell survives the subtraction, "
                            f"parts below {MIN_PIECE_KM2:g} km2 dropped, "
                            f"simplified at {SIMPLIFY_DEGREES} degrees with topology preserved, "
                            f"vertices sharper than {MINIMUM_INTERIOR_ANGLE_DEGREES:g} degrees "
                            "removed, "
                            f"coordinates rounded to {COORDINATE_DECIMALS} decimals"),
            "presentDayLandSubtracted": {
                "definition": ("the present-day land the application draws at 0 Ma, so the "
                               "exposed shelf is its exact complement above the datum"),
                "overlapKilometres": MODERN_LAND_OVERLAP_KM,
                "inputs": [
                    {
                        "sourceId": "cao-v2.4-native-coasts",
                        "dataset": CAO_COASTS.name,
                        "version": "2.4",
                        "bytes": CAO_COASTS_PINNED[0],
                        "sha256": CAO_COASTS_PINNED[1],
                        "selection": ("polygons valid at 0 Ma whose chart id is emitted by the "
                                      "shipped Cao package core.json"),
                        "charts": coast_charts,
                    },
                    {
                        "correctionId": "earthhistory-observed-land-omission-v1",
                        "path": str(OBSERVED_LAND_GEOJSON.relative_to(ROOT)),
                        "sha256": hashlib.sha256(OBSERVED_LAND_GEOJSON.read_bytes()).hexdigest(),
                        "features": observed_parts,
                        "selection": ("the tracked 0 Ma repair that adds observed modern land "
                                      "the Cao charts miss; it is drawn as land, so it is not "
                                      "exposed shelf"),
                    },
                ],
                "reason": ("the layer ships the ground the lowstand added to the coastline, "
                           "never the ground that is dry today. The mask must complement the "
                           "land that is *drawn*: Natural Earth 1:50m, used until 2026-09-16, "
                           "generalises estuaries, firths, fjords and belt seas as land where "
                           "the drawn coast has water, and subtracting it punched holes in the "
                           "shelf that the sphere's shelf tint needled through at 21 ka. Drawn "
                           "land is eroded before the subtraction so the shelf laps over the "
                           "drawn coast and no hairline of bare sphere opens along it"),
            },
            "minimumPieceSquareKilometres": MIN_PIECE_KM2,
            "minimumShelfWidthKilometres": MINIMUM_SHELF_WIDTH_KM,
            "minimumInteriorAngleDegrees": MINIMUM_INTERIOR_ANGLE_DEGREES,
            "simplifyDegrees": SIMPLIFY_DEGREES,
            "coordinateDecimals": COORDINATE_DECIMALS,
        },
        "evidence": {
            "status": "derived-from-published-source",
            # Built from the reference list, never typed out: the shipped
            # editorial line and the shipped source ids cannot drift apart.
            "editorial": "EarthHistory modification after " + ", ".join(
                reference["sourceId"] for reference in REFERENCES),
            "sourceIds": [reference["sourceId"] for reference in REFERENCES],
        },
        "limitations": LIMITATIONS,
        "regional": {
            "statement": ("This is a regional state, not a global palaeogeography. Outside the "
                          "three footprints the LGM interval draws no palaeo land and the "
                          "present-day composition stays on screen."),
            "footprints": {key: {"title": value["title"], "bounds": value["bounds"]}
                           for key, value in FOOTPRINTS.items()},
        },
        "source": {
            "record": manifest["source"]["record"],
            "product": manifest["source"]["product"],
            "service": manifest["source"]["service"],
            "license": manifest["source"]["license"],
            "attribution": manifest["source"]["attribution"],
            "store": str(arguments.store),
            "crops": [{"id": record["id"], "bounds": record["bounds"],
                       "width": record["width"], "height": record["height"],
                       "longitudeStepDegrees": record["longitudeStepDegrees"],
                       "latitudeStepDegrees": record["latitudeStepDegrees"],
                       "sha256": record["raster"]["sha256"],
                       "bytes": record["raster"]["bytes"],
                       "sourceUrl": record["sourceUrl"],
                       "retrievedUtc": record["retrievedUtc"]}
                      for record in manifest["outputs"]],
        },
        "measurements": {"footprints": footprint_reports, "crops": crop_reports},
        "literatureComparison": {
            "northSeaFootprintExposedShelfSquareKilometres":
                footprint_reports["north-sea"]["exposedShelfSquareKilometres"],
            "doggerlandSubWindowExposedShelfSquareKilometres":
                footprint_reports["north-sea"]["namedSubWindow"]
                ["doggerland-southern-north-sea"]["exposedShelfSquareKilometres"],
            "sturt2013SubmergedNorthSeaZoneSquareKilometres": 127422,
            "note": ("Sturt et al. 2013 model 127,422 km2 of the North Sea zone submerged "
                     "across the Holocene, a different quantity over a different window and "
                     "under glacial isostatic adjustment; it is quoted as an "
                     "order-of-magnitude anchor, not as agreement."),
            "sourceId": "sturt-2013-inundation",
        },
        "witnesses": witnesses,
        "references": REFERENCES,
        "payload": {
            "path": "lgm-lowstand-v1.geojson",
            "bytes": len(geojson_bytes),
            "sha256": hashlib.sha256(geojson_bytes).hexdigest(),
        },
    }
    (out / "lgm-lowstand-v1.manifest.json").write_text(
        json.dumps(contract, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"geojsonBytes": len(geojson_bytes),
                      "footprints": footprint_reports,
                      "witnessFailures": failures}, indent=2))
    if failures:
        raise SystemExit("LGM lowstand witness failed")


if __name__ == "__main__":
    main()
