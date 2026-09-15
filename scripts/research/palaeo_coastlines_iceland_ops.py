#!/usr/bin/env python3
"""Derive the `iceland` basin edit contract geometry from the pinned NI bedrock map.

Cao et al. (2017) draw no land over Iceland at any map interval: the island is
shallow marine at `20-11` and `11-2` and absent before that. Iceland's own
Tertiary lava pile is subaerial and older than 3.3 Ma over 35,600 km2 of mapped
outcrop, so the `sm` class is wrong there for both intervals.
`docs/research/palaeo-coastlines-iceland-ne-atlantic.md` designs the contract;
this script is the only place its geometry is constructed, so the ops in
`data/corrections/palaeo-coastlines/basins/iceland.json` can be re-derived rather
than trusted.

The source is the **same pinned snapshot the regional Iceland material correction
reads**, not a new acquisition: `bedrock-old.geojson` from the Icelandic
Institute of Natural History (Natturufraedistofnun Islands) 1:600,000 bedrock
map, CC BY 4.0, already acquired and hashed under
`regional-iceland-correction-v1/source-inputs`. Reading the same bytes is what
keeps the palaeo land and the `gold` material outcrop from drifting apart on
screen.

Four steps, in the memo's order:

1. Select `flokkur = "gold"` ("Basic and intermediate extrusive rocks with
   ingercalated sediments. Upper Tertiary, older than 3.3 m.y."), dissolve, and
   drop components below the compiler's own 25 km2 piece floor.
2. `11-2`: the whole dissolve. `20-11`: the dissolve clipped to the three lobe
   selectors the published radiometric ages support - the NW peninsula
   (>15 Ma), Trollaskagi in the north (~12 Ma) and the Eastfjords (13-14 Ma).
   The selectors are rectangles applied *to the outcrop*, so every drawn
   coastline is still the mapped outcrop boundary, never a drawn rectangle.
3. Simplify at 0.02 degrees, topology-preserving, and round to four decimals.
   The memo proposed the material correction's 0.005 degrees; 0.02 is used
   instead because the contract window is added to `simplification.json`'s
   protected list, so the compiler performs no further node reduction inside it
   and the contract's own tolerance is the shipped tolerance. 0.02 degrees is
   2.2 km, two orders of magnitude inside the 60 and 100 km spatial uncertainty
   the operations declare, and it is the compiler's own `lm` baseline.
4. Write the four operations into the tracked contract: an `add-land` and its
   paired `remove-shallow` per interval. The pair matters - land is drawn above
   shallow sea anyway, so without the removal the evidence record would still
   say "Cao maps shallow marine here" under ground the layer now calls land.

`--check` re-derives and compares against the tracked contract; `--write`
rewrites it; `--self-test` proves the gates can fail. All three need the pinned
pyGPlates environment (Shapely and pyGPlates), so `make check-palaeo-compile`
runs them where it exists and reports "not run" by name where it does not.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from copy import deepcopy
from pathlib import Path

import pygplates
import shapely
from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT.parent / "EarthHistory-data/palaeomap-study"
SOURCE = POOL / "verification/regional-iceland-correction-v1/source-inputs/bedrock-old.geojson"
CONTRACT = ROOT / "data/corrections/palaeo-coastlines/basins/iceland.json"
CORRECTION_GEOMETRY = ROOT / "data/corrections/iceland/iceland-surface-material-v1.geojson"

EARTH_RADIUS_KM = 6371.0088

#: The pinned snapshot. A different file is a different map, and the areas below
#: stop meaning what the memo measured.
SOURCE_SHA256 = "e73f879651bde321ee28e95d29945406c8c1360295f4b513da47ee0bb5b60413"
SOURCE_BYTES = 2_157_049
SOURCE_FEATURES = 1074
SOURCE_GOLD_FEATURES = 885

#: Douglas-Peucker tolerance and coordinate rounding for the emitted rings.
SIMPLIFY_DEGREES = 0.02
COORDINATE_DECIMALS = 4
#: The compiler's own piece floor; a component below it would be cut away later.
MINIMUM_COMPONENT_KM2 = 25.0

#: Measured areas, and the band they must stay inside. A drift past 1 % is a
#: source change, not a rounding difference (memo section 5.3 step 2).
GOLD_AREA_KM2 = 35_643.4
LOBE_AREA_KM2 = 22_386.8
AREA_TOLERANCE_PERCENT = 1.0

#: Harpardarson et al. (2008) publish about 36,000 km2 of Tertiary rocks; the
#: dissolve has to land on that independently of our own pin.
PUBLISHED_TERTIARY_AREA_KM2 = 36_000.0
PUBLISHED_AREA_TOLERANCE_PERCENT = 5.0

#: The three lobes the published radiometric ages place at or above ~12-16 Ma.
#: These are selectors on the outcrop, never an outline of the island.
LOBES = (
    {"lobeId": "vestfirdir-nw", "bbox": (-24.6, 65.35, -21.4, 66.60),
     "oldestPublishedAgeMa": 16.0,
     "note": "NW peninsula; >15 Ma at the exposed top (Hardarson et al. 2008), "
             "about 16 Ma at the deepest exposed level (Saemundsson 1979)"},
    {"lobeId": "trollaskagi-n", "bbox": (-19.4, 65.35, -17.3, 66.25),
     "oldestPublishedAgeMa": 12.0,
     "note": "N Iceland; about 12 Ma, the weakest of the three - inside the "
             "20-11 bin but only just, and the contract says so"},
    {"lobeId": "eastfjords-e", "bbox": (-15.7, 64.15, -13.4, 65.65),
     "oldestPublishedAgeMa": 14.0,
     "note": "Eastfjords; 13-14 Ma, 'just over 13 m.y.' at the oldest locality"},
)

#: The contract window. It stops at -12 E, west of the Faroe Platform, so that
#: nothing here can touch the Faroes (memo section 5.5).
WINDOW_BBOX = (-27.0, 62.0, -12.0, 68.0)

#: The Cao 2024 static partitions over Iceland, and the latitudes the memo pins
#: the 102/301 seam at. The compiled pieces are checked against both by
#: `palaeo_coastlines_correction.py`; the numbers live here so the derivation and
#: the gate cannot disagree about them.
ICELAND_PARTITION_PLATE_IDS = (102, 301)
SEAM_LATITUDES_DEG = (63.6, 64.4, 65.2, 66.4)
SEAM_LONGITUDES_DEG = (-23.34, -21.49, -19.46, -18.21)
#: Cao's own coastline tolerance. The palaeo layer splits Iceland on the 102/301
#: static-partition seam while the material correction splits it on the exact
#: shared 101/301 ridge subsegments; plates 101 and 102 are measured co-moving to
#: 0.0 km over 0-29 Ma, so the risk is the seam line, not the rotations. If the
#: two seams separate by more than this the palaeo land and the `gold` outcrop
#: will visibly part at 11 Ma, where their relative displacement is 210 km.
SEAM_TOLERANCE_KM = 30.0


class IcelandOpsError(ValueError):
    """A pinned premise of the Iceland contract derivation did not hold."""


def spherical_area_km2(geometry) -> float:
    """Area on the sphere, holes subtracted."""
    total = 0.0
    for polygon in getattr(geometry, "geoms", [geometry]):
        if polygon.is_empty or polygon.geom_type != "Polygon":
            continue
        rings = [(polygon.exterior, 1.0)] + [(hole, -1.0) for hole in polygon.interiors]
        for ring, sign in rings:
            points = [pygplates.PointOnSphere(lat, lon) for lon, lat in ring.coords[:-1]]
            if len(points) < 3:
                continue
            total += sign * pygplates.PolygonOnSphere(points).get_area() * EARTH_RADIUS_KM ** 2
    return total


def round_geometry(geometry, decimals: int = COORDINATE_DECIMALS):
    """Round every coordinate, then re-dissolve: rounding can make rings touch.

    `shapely.set_precision` is not used: on this outcrop it raises
    `unable to assign free hole to a shell`, because the map carries holes whose
    shells collapse under a 1e-4 grid. Rounding each ring and re-validating keeps
    every component and lets `unary_union` resolve whatever the rounding touched.
    """
    def rounded(ring):
        return [(round(lon, decimals), round(lat, decimals)) for lon, lat in ring.coords]

    parts = []
    for polygon in getattr(geometry, "geoms", [geometry]):
        if polygon.is_empty or polygon.geom_type != "Polygon":
            continue
        shell = rounded(polygon.exterior)
        if len(set(shell)) < 3:
            continue
        holes = [rounded(hole) for hole in polygon.interiors if len(set(rounded(hole))) >= 3]
        parts.append(make_valid(shapely.geometry.Polygon(shell, holes)))
    if not parts:
        raise IcelandOpsError("rounding to 4 decimals emptied every component")
    return polygonal(unary_union(parts))


def polygonal(geometry):
    """Keep only the polygonal parts of a possibly mixed `make_valid` result."""
    parts = [part for part in getattr(geometry, "geoms", [geometry])
             if part.geom_type == "Polygon" and not part.is_empty]
    if not parts:
        raise IcelandOpsError("the geometry has no polygonal part left")
    return unary_union(parts)


def drop_small_components(geometry, floor_km2: float = MINIMUM_COMPONENT_KM2):
    kept = [polygon for polygon in getattr(geometry, "geoms", [geometry])
            if polygon.geom_type == "Polygon" and spherical_area_km2(polygon) >= floor_km2]
    if not kept:
        raise IcelandOpsError("every component of the dissolve is below the 25 km2 floor")
    return unary_union(kept)


def load_source(path: Path = SOURCE, sha256: str = SOURCE_SHA256) -> list[dict]:
    if not path.is_file():
        raise IcelandOpsError(f"the pinned NI bedrock snapshot is missing: {path}")
    payload = path.read_bytes()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != sha256:
        raise IcelandOpsError(f"{path.name} sha256 is {digest}, not the pinned {sha256}")
    if len(payload) != SOURCE_BYTES:
        raise IcelandOpsError(f"{path.name} is {len(payload)} bytes, not the pinned {SOURCE_BYTES}")
    features = json.loads(payload)["features"]
    if len(features) != SOURCE_FEATURES:
        raise IcelandOpsError(f"{path.name} carries {len(features)} features, not {SOURCE_FEATURES}")
    return features


def dissolve_gold(features: list[dict]):
    """The `gold` class dissolved: Upper Tertiary extrusives older than 3.3 Ma."""
    parts = [make_valid(shape(feature["geometry"])) for feature in features
             if feature["properties"].get("flokkur") == "gold"]
    if len(parts) != SOURCE_GOLD_FEATURES:
        raise IcelandOpsError(f"the snapshot holds {len(parts)} 'gold' features, "
                              f"not the pinned {SOURCE_GOLD_FEATURES}")
    return drop_small_components(unary_union(parts))


def clip_to_lobes(dissolved, lobes=LOBES):
    """The `20-11` geometry: the dissolve cut by the three published-age lobes."""
    pieces = []
    measured = {}
    for lobe in lobes:
        clipped = dissolved.intersection(box(*lobe["bbox"]))
        if clipped.is_empty:
            raise IcelandOpsError(f"lobe {lobe['lobeId']} selects no outcrop")
        measured[lobe["lobeId"]] = round(spherical_area_km2(clipped), 1)
        pieces.append(clipped)
    return drop_small_components(unary_union(pieces)), measured


def check_area(label: str, measured: float, pinned: float,
               tolerance_percent: float = AREA_TOLERANCE_PERCENT) -> None:
    if abs(measured - pinned) > pinned * tolerance_percent / 100.0:
        raise IcelandOpsError(f"{label}: {measured:,.1f} km2 is outside {tolerance_percent} % "
                              f"of the pinned {pinned:,.1f} km2")


def derive(source_path: Path = SOURCE, sha256: str = SOURCE_SHA256,
           lobes=LOBES, simplify_degrees: float = SIMPLIFY_DEGREES) -> dict:
    """Both operation geometries plus the measurements the contract records."""
    features = load_source(source_path, sha256)
    dissolved = dissolve_gold(features)
    check_area("the dissolved 'gold' outcrop", spherical_area_km2(dissolved), GOLD_AREA_KM2)
    check_area("the dissolved 'gold' outcrop against Hardarson et al. (2008)",
               spherical_area_km2(dissolved), PUBLISHED_TERTIARY_AREA_KM2,
               PUBLISHED_AREA_TOLERANCE_PERCENT)
    lobed, lobe_areas = clip_to_lobes(dissolved, lobes)
    check_area("the three-lobe selection", spherical_area_km2(lobed), LOBE_AREA_KM2)

    out = {}
    for key, geometry, pinned in (("11-2", dissolved, GOLD_AREA_KM2),
                                  ("20-11", lobed, LOBE_AREA_KM2)):
        simplified = round_geometry(geometry.simplify(simplify_degrees, preserve_topology=True))
        simplified = drop_small_components(simplified)
        area = spherical_area_km2(simplified)
        # The whole point of a tolerance this fine is that it may not move the
        # footprint; a 1 % gate on the simplified geometry catches a tolerance
        # typo that would.
        check_area(f"the simplified {key} geometry", area, pinned)
        if not box(*WINDOW_BBOX).contains(simplified):
            raise IcelandOpsError(f"the {key} geometry leaves the contract window {WINDOW_BBOX}")
        polygons = list(getattr(simplified, "geoms", [simplified]))
        out[key] = {
            "geometry": mapping(simplified),
            "areaSquareKilometres": round(area, 1),
            "parts": len(polygons),
            "vertices": sum(len(polygon.exterior.coords) - 1
                            + sum(len(hole.coords) - 1 for hole in polygon.interiors)
                            for polygon in polygons),
            "boundsDeg": [round(value, 4) for value in simplified.bounds],
        }
    out["lobeAreasSquareKilometres"] = lobe_areas
    out["sourceSha256"] = sha256
    return out


# --------------------------------------------------------------------------
# the tracked contract
# --------------------------------------------------------------------------

OP_ORDER = (
    ("iceland-11-2-tertiary-plateau-add-land", "11-2"),
    ("iceland-11-2-tertiary-plateau-remove-shallow", "11-2"),
    ("iceland-20-11-oldest-flanks-add-land", "20-11"),
    ("iceland-20-11-oldest-flanks-remove-shallow", "20-11"),
)


def apply_to_contract(contract: dict, derived: dict) -> dict:
    contract = deepcopy(contract)
    by_id = {op["opId"]: op for op in contract["ops"]}
    for op_id, interval in OP_ORDER:
        if op_id not in by_id:
            raise IcelandOpsError(f"the contract has no operation {op_id}")
        by_id[op_id]["geometry"] = derived[interval]["geometry"]
    provenance = contract["notes"]["derivation"]
    provenance["sourceSha256"] = derived["sourceSha256"]
    provenance["measured"] = {
        "goldDissolveSquareKilometres": derived["11-2"]["areaSquareKilometres"],
        "threeLobeSquareKilometres": derived["20-11"]["areaSquareKilometres"],
        "lobeSquareKilometres": derived["lobeAreasSquareKilometres"],
        "parts": {interval: derived[interval]["parts"] for _, interval in OP_ORDER},
        "vertices": {interval: derived[interval]["vertices"] for _, interval in OP_ORDER},
        "boundsDeg": {interval: derived[interval]["boundsDeg"] for _, interval in OP_ORDER},
    }
    return contract


def check_contract(contract_path: Path = CONTRACT, derived: dict | None = None) -> dict:
    derived = derive() if derived is None else derived
    contract = json.loads(contract_path.read_text())
    # Compared through JSON, not as Python objects: `shapely.mapping` returns
    # coordinate tuples and the tracked file holds lists, which are never equal.
    expected = json.loads(json.dumps(apply_to_contract(contract, derived)))
    if expected != contract:
        raise IcelandOpsError(
            f"{contract_path.relative_to(ROOT)} does not match a re-derivation from the pinned "
            "NI snapshot; run this script with --write and review the diff")
    return {"contract": str(contract_path.relative_to(ROOT)),
            "ops": len(contract["ops"]),
            "goldDissolveSquareKilometres": derived["11-2"]["areaSquareKilometres"],
            "threeLobeSquareKilometres": derived["20-11"]["areaSquareKilometres"]}


def write_contract(contract_path: Path = CONTRACT) -> dict:
    derived = derive()
    contract = apply_to_contract(json.loads(contract_path.read_text()), derived)
    contract_path.write_text(json.dumps(contract, indent=1, ensure_ascii=False) + "\n")
    return {"written": str(contract_path.relative_to(ROOT)),
            "goldDissolveSquareKilometres": derived["11-2"]["areaSquareKilometres"],
            "threeLobeSquareKilometres": derived["20-11"]["areaSquareKilometres"],
            "parts": {interval: derived[interval]["parts"] for _, interval in OP_ORDER}}


# --------------------------------------------------------------------------
# self-test
# --------------------------------------------------------------------------

def expect_failure(label: str, call) -> str:
    try:
        call()
    except IcelandOpsError as error:
        return f"{label}: rejected ({error})"
    raise IcelandOpsError(f"{label}: the mutation was accepted")


def self_test() -> dict:
    rejections = []
    rejections.append(expect_failure(
        "a corrupted source digest",
        lambda: derive(sha256="0" * 64)))
    rejections.append(expect_failure(
        "a missing source snapshot",
        lambda: derive(source_path=SOURCE.with_name("bedrock-old-absent.geojson"))))
    widened = tuple({**lobe, "bbox": (-24.6, 63.0, -13.0, 67.0)} if lobe["lobeId"] == "vestfirdir-nw"
                    else lobe for lobe in LOBES)
    rejections.append(expect_failure(
        "a lobe selector widened until 20-11 draws the whole island",
        lambda: derive(lobes=widened)))
    emptied = tuple({**lobe, "bbox": (-26.0, 62.1, -25.9, 62.2)} if lobe["lobeId"] == "trollaskagi-n"
                    else lobe for lobe in LOBES)
    rejections.append(expect_failure(
        "a lobe selector moved off the outcrop",
        lambda: derive(lobes=emptied)))
    rejections.append(expect_failure(
        "a simplification tolerance coarse enough to move the footprint",
        lambda: derive(simplify_degrees=1.0)))

    derived = derive()
    rejections.append(expect_failure(
        "a hand-edited operation geometry in the tracked contract",
        lambda: _check_hand_edited(derived)))
    rejections.append(expect_failure(
        "an operation the contract no longer declares",
        lambda: _check_missing_op(derived)))
    return {"status": "pass", "rejections": rejections,
            "restored": check_contract(derived=derived)}


def _check_hand_edited(derived: dict) -> None:
    """The contract check notices a ring replaced by hand."""
    mutated = json.loads(CONTRACT.read_text())
    mutated["ops"][0]["geometry"] = json.loads(json.dumps(mapping(box(-20.0, 64.0, -19.0, 65.0))))
    if json.loads(json.dumps(apply_to_contract(mutated, derived))) != mutated:
        raise IcelandOpsError("a hand-edited ring does not re-derive from the pinned snapshot")


def _check_missing_op(derived: dict) -> None:
    """A dropped paired removal is a contract the derivation cannot fill."""
    mutated = json.loads(CONTRACT.read_text())
    mutated["ops"] = [op for op in mutated["ops"]
                      if op["opId"] != "iceland-11-2-tertiary-plateau-remove-shallow"]
    apply_to_contract(mutated, derived)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true",
                        help="rewrite the tracked contract's geometry from the pinned snapshot")
    parser.add_argument("--check", action="store_true",
                        help="the tracked contract re-derives from the pinned snapshot")
    parser.add_argument("--self-test", action="store_true")
    arguments = parser.parse_args()
    try:
        if arguments.self_test:
            result = self_test()
        elif arguments.write:
            result = write_contract()
        elif arguments.check:
            result = check_contract()
        else:
            result = derive()
            result.pop("11-2", None)
            result.pop("20-11", None)
    except IcelandOpsError as error:
        print(f"palaeo-coastlines-iceland-ops: FAIL: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
