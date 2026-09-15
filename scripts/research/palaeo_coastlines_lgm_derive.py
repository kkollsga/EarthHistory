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
2. build the boolean mask ``surface >= -120`` on the source 1 arc-minute grid;
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
from shapely.geometry import MultiPolygon, Polygon, box, mapping
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).resolve().parent))
import palaeo_coastlines_audit as audit  # noqa: E402
import palaeo_coastlines_lgm_acquire as acquire  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
STORE = acquire.STORE
CONTRACT = ROOT / "data/corrections/palaeo-coastlines/lgm"

LOWSTAND_DATUM_M = -120.0
LGM_OLDEST_MA = 0.0265
LGM_YOUNGEST_EXCLUSIVE_MA = 0.0195
MIN_PIECE_KM2 = audit.MIN_PIECE_KM2
SIMPLIFY_DEGREES = 0.02
COORDINATE_DECIMALS = 4

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
    ("london", -0.1, 51.5, "north-sea", True,
     "London: present-day land, unchanged by a sea-level lowstand"),
    ("sunda-shelf", 108.0, 2.0, "sundaland", True,
     "central Sunda shelf between Sumatra, Borneo and the Malay peninsula"),
    ("bering-land-bridge", -170.0, 65.0, "beringia", True,
     "Bering land bridge, north of St Lawrence Island"),
    ("norwegian-trench", 4.0, 58.5, "north-sea", False,
     "Norwegian Trench at -254 m: far below the lowstand datum, still sea"),
    ("makassar-strait", 118.5, -2.0, "sundaland", False,
     "Makassar Strait: never closed by a lowstand (Hall 2009)"),
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
    return parts


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

    features = []
    footprint_reports = {}
    parts_by_footprint: dict[str, list] = {}
    crop_reports = []
    for footprint_id, footprint in FOOTPRINTS.items():
        pieces = []
        exposed_km2 = 0.0
        modern_land_km2 = 0.0
        sub_window: dict[str, dict] = {}
        for crop_id in footprint["crops"]:
            record = crops[crop_id]
            grid = read_crop(arguments.store, record)
            mask = grid >= LOWSTAND_DATUM_M
            modern = grid >= 0.0
            rectangles = mask_rectangles(mask, tuple(record["bounds"]),
                                         record["width"], record["height"])
            merged = unary_union(rectangles)
            crop_parts, report = cleaned_parts(merged, SIMPLIFY_DEGREES)
            pieces.extend(crop_parts)
            raw_km2 = audit.area_km2(merged)
            modern_raw = unary_union(mask_rectangles(modern, tuple(record["bounds"]),
                                                     record["width"], record["height"]))
            modern_km2 = audit.area_km2(modern_raw)
            exposed_km2 += raw_km2 - modern_km2
            modern_land_km2 += modern_km2
            window_id, window_bounds, window_note = NAMED_SUB_WINDOWS[footprint_id]
            clip = box(*window_bounds)
            sub_land = audit.area_km2(merged.intersection(clip))
            sub_modern = audit.area_km2(modern_raw.intersection(clip))
            sub_window[window_id] = {
                "bounds": list(window_bounds), "note": window_note,
                "landSquareKilometres": round(
                    sub_window.get(window_id, {}).get("landSquareKilometres", 0.0)
                    + sub_land, 1),
                "exposedShelfSquareKilometres": round(
                    sub_window.get(window_id, {}).get("exposedShelfSquareKilometres", 0.0)
                    + sub_land - sub_modern, 1),
            }
            crop_reports.append({
                "crop": crop_id, "footprint": footprint_id,
                "rectangles": len(rectangles),
                "rawLandSquareKilometres": round(raw_km2, 1),
                "modernLandSquareKilometres": round(modern_km2, 1),
                "exposedShelfSquareKilometres": round(raw_km2 - modern_km2, 1),
                **{key: (round(value, 3) if isinstance(value, float) else value)
                   for key, value in report.items()},
            })
        parts = rounded(MultiPolygon(pieces) if len(pieces) != 1 else pieces[0],
                        COORDINATE_DECIMALS)
        parts_by_footprint[footprint_id] = parts
        area = sum(audit.area_km2(part) for part in parts)
        vertices = sum(len(part.exterior.coords) + sum(len(h.coords) for h in part.interiors)
                       for part in parts)
        footprint_reports[footprint_id] = {
            "pieces": len(parts), "vertices": vertices,
            "landSquareKilometres": round(area, 1),
            "modernLandSquareKilometres": round(modern_land_km2, 1),
            "exposedShelfSquareKilometres": round(exposed_km2, 1),
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
                "landSquareKilometres": round(area, 1),
                "exposedShelfSquareKilometres": round(exposed_km2, 1),
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
                            f"unioned, parts below {MIN_PIECE_KM2:g} km2 dropped, simplified at "
                            f"{SIMPLIFY_DEGREES} degrees with topology preserved, coordinates "
                            f"rounded to {COORDINATE_DECIMALS} decimals"),
            "minimumPieceSquareKilometres": MIN_PIECE_KM2,
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
