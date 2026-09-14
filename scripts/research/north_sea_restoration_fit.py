#!/usr/bin/env python3
"""Fit and pin the North Sea rigid UK-block restoration contract.

Cao et al. 2024 v2.4 keeps England-Brabant (315) and Northern Scotland (303)
rigid relative to Baltica (302) from 0 to 430 Ma, so the North Sea rift never
opens. This script derives a documented regional restoration: one Euler pole
for the UK block relative to Baltica, fitted to the displacement pattern of the
Müller et al. 2019 North Atlantic Phase 1 deforming network (a validation
comparison only; its geometry never enters the package), with the cumulative
closure of the Shetland-Bergen transect taken from the published extension
estimates synthesised in docs/research (Odinsen et al. 2000, Roberts et al.
1993/1995, Cowie et al. 2005, Faerseth 1996).

It writes ``data/corrections/north-sea-restoration/restoration-contract.json``
(pole, angle schedule, witness closures, pinned chart list) and the fit report
``docs/research/north-sea-restoration-fit.json``. It never touches the public
package; ``apply_north_sea_restoration.py`` consumes the contract.
"""

from __future__ import annotations

import array
import hashlib
import json
import math
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public/data/reconstruction/cao-v2.4"
OUT = ROOT / "data/corrections/north-sea-restoration"
CONTRACT = OUT / "restoration-contract.json"
REPORT = ROOT / "docs/research/north-sea-restoration-fit.json"
EARTH_RADIUS_KM = 6371.0088

CORRECTION_ID = "earthhistory-north-sea-restoration-v1"
WINDOW = (130.0, 430.0)
BLOCK_PLATES = (303, 315)
REFERENCE_PLATE = 302

# Müller et al. 2019 v3.0 North Atlantic Phase 1 mesh (200.0-120.1 Ma, plate
# 301): displacement of present-day UK points relative to Baltica (302) at
# 200 Ma, measured with pyGPlates 1.0.0 on 2026-09-14 (deformation accrued
# linearly from 141 to 200 Ma). Used only to fit the pole geometry.
MULLER_2019_DISPLACEMENT_AT_200MA = {
    "Shetland": {"lonLat": [-1.2, 60.4], "deltaLonLat": [1.0349, -0.3007], "km": 66.17},
    "Aberdeen": {"lonLat": [-2.1, 57.1], "deltaLonLat": [0.6389, 0.0220], "km": 38.66},
    "London": {"lonLat": [-0.1, 51.5], "deltaLonLat": [0.3294, -0.0124], "km": 22.85},
    "Dogger Bank": {"lonLat": [2.5, 54.7], "deltaLonLat": [0.4915, -0.0624], "km": 32.36},
}
MULLER_SHETLAND_BERGEN_CLOSURE_KM = 53.5

# Cumulative closure of the Shetland-Bergen transect relative to the present
# (km), i.e. total Mesozoic extension E(0) minus E(t) from the literature
# synthesis (central values; range 55-90 km total). Constant before the
# latest-Permian rift onset back to the 430 Ma Caledonian seam.
CLOSURE_SCHEDULE_KM = [
    (0.0, 0.0), (130.0, 0.0), (140.0, 4.0), (160.0, 23.0), (170.0, 27.0), (200.0, 27.0),
    (230.0, 34.0), (250.0, 60.0), (270.0, 72.0), (300.0, 72.0), (430.0, 72.0),
]
WITNESS_PAIRS = {
    "Shetland-Bergen": ([-1.2, 60.4], [5.3, 60.4]),
    "Aberdeen-Stavanger": ([-2.1, 57.1], [5.73, 58.97]),
    "London-Bergen": ([-0.1, 51.5], [5.3, 60.4]),
    "London-Amsterdam": ([-0.1, 51.5], [4.9, 52.37]),
}
# Only the UK side moves; Norwegian, Dutch and French witnesses stay on Baltica.
FIXED_WITNESSES = {"Bergen": [5.3, 60.4], "Stavanger": [5.73, 58.97], "Amsterdam": [4.9, 52.37]}

# Chart selection: every 303 chart in the British Isles box, the 315 charts west
# of the Dogger/Channel cut, and the modern-country outlines of GBR, IRL, IMN.
BOX = {"minLon": -15.0, "maxLon": 3.0, "minLat": 49.0, "maxLat": 63.0}
CUT_LON = 2.0
CUT_LAT = 50.3
COUNTRY_CODES = ("gbr", "irl", "imn")


def unit(v):
    n = math.sqrt(sum(c * c for c in v))
    return tuple(c / n for c in v)


def lon_lat_direction(lon, lat):
    a, b = math.radians(lon), math.radians(lat)
    return (math.cos(b) * math.cos(a), math.cos(b) * math.sin(a), math.sin(b))


def direction_lon_lat(d):
    return (math.degrees(math.atan2(d[1], d[0])), math.degrees(math.asin(max(-1.0, min(1.0, d[2])))))


def axis_angle_quaternion(axis, angle_degrees):
    half = math.radians(angle_degrees) / 2
    s = math.sin(half)
    return (math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s)


def rotate(q, v):
    w, x, y, z = q
    tx = 2 * (y * v[2] - z * v[1])
    ty = 2 * (z * v[0] - x * v[2])
    tz = 2 * (x * v[1] - y * v[0])
    return (v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx))


def angular_km(a, b):
    return math.acos(max(-1.0, min(1.0, sum(x * y for x, y in zip(a, b))))) * EARTH_RADIUS_KM


def pair_closure_km(q, pair):
    moving, fixed = pair
    present = angular_km(lon_lat_direction(*moving), lon_lat_direction(*fixed))
    restored = angular_km(rotate(q, lon_lat_direction(*moving)), lon_lat_direction(*fixed))
    return present - restored


def fit_residual(pole_lon, pole_lat, angle):
    q = axis_angle_quaternion(lon_lat_direction(pole_lon, pole_lat), angle)
    total = 0.0
    for row in MULLER_2019_DISPLACEMENT_AT_200MA.values():
        lon, lat = row["lonLat"]
        target = lon_lat_direction(lon + row["deltaLonLat"][0], lat + row["deltaLonLat"][1])
        moved = rotate(q, lon_lat_direction(lon, lat))
        total += angular_km(moved, target) ** 2
    return math.sqrt(total / len(MULLER_2019_DISPLACEMENT_AT_200MA))


def best_angle(pole_lon, pole_lat):
    lo, hi = -10.0, 10.0
    for _ in range(80):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if fit_residual(pole_lon, pole_lat, m1) < fit_residual(pole_lon, pole_lat, m2):
            hi = m2
        else:
            lo = m1
    angle = (lo + hi) / 2
    return angle, fit_residual(pole_lon, pole_lat, angle)


def fit_pole():
    best = None
    for lat10 in range(200, 651, 5):
        for lon10 in range(-400, 251, 5):
            lat, lon = lat10 / 10, lon10 / 10
            angle, residual = best_angle(lon, lat)
            if best is None or residual < best[2]:
                best = (lon, lat, residual, angle)
    lon, lat, _, _ = best
    for step in (0.25, 0.1, 0.05):
        improved = True
        while improved:
            improved = False
            for dlon, dlat in ((step, 0), (-step, 0), (0, step), (0, -step)):
                angle, residual = best_angle(lon + dlon, lat + dlat)
                if residual < best[2] - 1e-9:
                    best = (lon + dlon, lat + dlat, residual, angle)
                    lon, lat = lon + dlon, lat + dlat
                    improved = True
    return best


def angle_for_closure(pole, closure_km, pair=WITNESS_PAIRS["Shetland-Bergen"]):
    if closure_km == 0:
        return 0.0
    axis = lon_lat_direction(*pole)
    # Closure grows with one rotation sense only; pick it from a one-degree probe.
    sign = 1.0 if pair_closure_km(axis_angle_quaternion(axis, 1.0), pair) > 0 else -1.0
    lo, hi = 0.0, 20.0
    for _ in range(100):
        mid = (lo + hi) / 2
        if pair_closure_km(axis_angle_quaternion(axis, sign * mid), pair) < closure_km:
            lo = mid
        else:
            hi = mid
    angle = sign * (lo + hi) / 2
    if abs(pair_closure_km(axis_angle_quaternion(axis, angle), pair) - closure_km) > 0.01:
        raise ValueError(f"closure {closure_km} km is not reachable about pole {pole}")
    return angle


def chart_centroids(core, palette_plates):
    charts = core["charts"]
    centroids = {}
    for batch in core["spatialBatches"]:
        data = (PUBLIC / batch["geometryAsset"]["url"]).read_bytes()
        count = batch["vertexCount"]
        directions = array.array("f")
        directions.frombytes(data[32:32 + 12 * count])
        owners = array.array("I")
        owners.frombytes(data[32 + 16 * count:32 + 20 * count])
        sums = {}
        for i in range(count):
            row = sums.setdefault(owners[i], [0.0, 0.0, 0.0, 0])
            row[0] += directions[3 * i]
            row[1] += directions[3 * i + 1]
            row[2] += directions[3 * i + 2]
            row[3] += 1
        for index, (x, y, z, n) in sums.items():
            lon, lat = direction_lon_lat(unit((x, y, z)))
            centroids[index] = (batch["batchId"], lon, lat, n)
    return centroids


def select_charts():
    core = json.loads((PUBLIC / "core.json").read_text())
    palette = json.loads((PUBLIC / "motion-palette.json").read_text())
    entry_plate = {entry["entryId"]: entry["plateId"] for entry in palette["entries"]}
    centroids = chart_centroids(core, entry_plate)
    selected = []
    for index, chart in enumerate(core["charts"]):
        plates = sorted({entry_plate[b["entryId"]] for b in chart["motionBindings"]})
        if len(plates) != 1 or plates[0] not in BLOCK_PLATES:
            continue
        plate = plates[0]
        chart_id = chart["chartId"]
        if chart["role"] == "country-reference":
            code = chart_id.split(":")[1]
            if code not in COUNTRY_CODES:
                continue
            reason = f"modern-country outline {code.upper()} on plate {plate}"
        else:
            if index not in centroids:
                continue
            batch_id, lon, lat, n = centroids[index]
            if not (BOX["minLon"] <= lon <= BOX["maxLon"] and BOX["minLat"] <= lat <= BOX["maxLat"]):
                continue
            if plate == 315 and not (lon < CUT_LON and lat > CUT_LAT):
                continue
            if batch_id == "batch-shelf" and plate == 315:
                continue  # the 315 continental outline straddles the Central Graben; it stays on Baltica
            reason = f"{batch_id} chart centroid {lon:.1f}E {lat:.1f}N on plate {plate}"
        lifecycle = chart["lifecycle"]["validTimeMa"]
        selected.append({
            "chartIndex": index, "chartId": chart_id, "plateId": plate, "role": chart["role"],
            "lifecycleOldestMa": lifecycle["oldest"],
            "bindings": [(b["entryId"], b["validTimeMa"]["youngest"], b["validTimeMa"]["oldest"])
                         for b in chart["motionBindings"]],
            "reason": reason,
        })
    return core, selected


def main() -> None:
    pole_lon, pole_lat, residual_km, angle_200 = fit_pole()
    pole = (pole_lon, pole_lat)
    axis = lon_lat_direction(*pole)
    schedule = []
    for age, closure in CLOSURE_SCHEDULE_KM:
        angle = angle_for_closure(pole, closure)
        q = axis_angle_quaternion(axis, angle)
        schedule.append({
            "ageMa": age, "shetlandBergenClosureKm": closure, "angleDegrees": round(angle, 9),
            "witnessClosureKm": {name: round(pair_closure_km(q, pair), 3) for name, pair in WITNESS_PAIRS.items()},
        })
    muller_angle_q = axis_angle_quaternion(axis, angle_200)
    core, selected = select_charts()
    manifest = json.loads((PUBLIC / "manifest.json").read_text())
    contract = {
        "schemaVersion": 1,
        "correctionId": CORRECTION_ID,
        "version": "1",
        "kind": "rigid-block-regional-restoration",
        "description": ("Rigid restoration of the UK block (Cao plates 303 and 315 west of the Central Graben "
                        "and Channel cut) relative to Baltica (302) so the North Sea rift closes by the published "
                        "Permian-Triassic and Late Jurassic extension going back in time. A regional model hypothesis "
                        "layered on the rigid Cao v2.4 foundation; not a deforming reconstruction."),
        "model": {"modelId": "cao-et-al-2024", "modelVersion": "2.4", "frame": manifest["frame"]},
        "sourcePackage": {"packageId": manifest["packageId"], "revision": manifest["revision"],
                          "coreSha256": manifest["core"]["sha256"]},
        "referencePlateId": REFERENCE_PLATE,
        "blockPlateIds": list(BLOCK_PLATES),
        "windowMa": {"youngest": WINDOW[0], "oldest": WINDOW[1],
                     "reason": "post-rift quiescence below 130 Ma; the closure schedule ends at the Cao 430 Ma Caledonian seam and is held constant to each chart's oldest lifecycle so no chart jumps at a shared knot"},
        "pole": {"lonLat": [round(pole_lon, 4), round(pole_lat, 4)],
                 "fit": {"method": "grid then hill-climb over pole position with a ternary angle search minimising the RMS "
                                   "great-circle misfit to four Müller 2019 displacement vectors at 200 Ma",
                         "rmsMisfitKm": round(residual_km, 3), "angleAt200MaForMullerPatternDegrees": round(angle_200, 6),
                         "mullerShetlandBergenClosureKm": MULLER_SHETLAND_BERGEN_CLOSURE_KM,
                         "fittedShetlandBergenClosureKm": round(pair_closure_km(muller_angle_q, WITNESS_PAIRS["Shetland-Bergen"]), 3),
                         "mullerDisplacements": MULLER_2019_DISPLACEMENT_AT_200MA}},
        "angleSchedule": schedule,
        "angleInterpolation": "linear in angle between schedule knots; constant outside the window",
        "closureAuthority": ("Shetland-Bergen (61N transect) cumulative Mesozoic extension 72 km central "
                             "(55-90 km) from Odinsen et al. 2000, Roberts et al. 1993 and 1995, Cowie et al. 2005 and "
                             "Faerseth 1996, phased as latest Permian-Triassic (about 250-230 Ma) and Late Jurassic "
                             "(about 170-130 Ma); Devonian post-Caledonian extension is excluded"),
        "sourceIds": ["odinsen-north-sea-2000", "roberts-north-sea-1993", "roberts-north-sea-1995",
                      "cowie-north-sea-2005", "faerseth-north-sea-1996", "muller-deforming-model-2019",
                      "doi:10.5281/zenodo.13628813"],
        "witnesses": {"pairs": {name: {"movingLonLat": pair[0], "fixedLonLat": pair[1]} for name, pair in WITNESS_PAIRS.items()},
                      "fixed": FIXED_WITNESSES, "toleranceKm": 2.0},
        "chartSelection": {"box": BOX, "cutLongitude": CUT_LON, "cutLatitude": CUT_LAT, "countryCodes": list(COUNTRY_CODES),
                           "excluded": "the 315 continental-outline chart, which straddles the Central Graben, and the 301/302/330 shelf polygons stay on Baltica"},
        "charts": selected,
        # One entry per block plate from the window start to the oldest pinned
        # chart lifecycle on that plate: the closure is held constant beyond the
        # 430 Ma seam so the block never jumps at a shared knot.
        "paletteEntries": [{"entryId": f"restoration-north-sea-plate-{plate}-{WINDOW[0]:g}-"
                                       f"{max(row['lifecycleOldestMa'] for row in selected if row['plateId'] == plate):g}",
                            "plateId": plate, "youngestAgeMa": WINDOW[0],
                            "oldestAgeMa": max(row["lifecycleOldestMa"] for row in selected if row["plateId"] == plate),
                            "sourceIntervalSetId": f"north-sea-restoration-clock-{WINDOW[0]:g}-"
                                                   f"{max(row['lifecycleOldestMa'] for row in selected if row['plateId'] == plate):g}"}
                           for plate in BLOCK_PLATES],
        "limitations": [
            "a rigid block cannot reproduce graben-scale stretching; the closure is a transect total, not a strain field",
            "the pole geometry follows the Müller 2019 Jurassic network pattern; the Permian-Triassic phase reuses it",
            "Devonian post-Caledonian extension (about 30 km) is not restored",
            "straddling shelf polygons remain on Baltica, so restored land overlaps model shelf rather than closing it",
            "Müller et al. 2019 licensing is ambiguous (CC BY 4.0 record, CC BY-SA 4.0 README); no Müller geometry or rotation is redistributed",
        ],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    CONTRACT.write_text(json.dumps(contract, indent=1) + "\n")
    report = {
        "generatedOn": "2026-09-14", "correctionId": CORRECTION_ID,
        "pole": contract["pole"], "angleSchedule": schedule,
        "selectedCharts": len(selected),
        "selectedByPlateAndRole": {f"{row['plateId']}:{row['role']}": sum(1 for r in selected if r["plateId"] == row["plateId"] and r["role"] == row["role"]) for row in selected},
    }
    REPORT.write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({"pole": contract["pole"]["lonLat"], "rmsMisfitKm": round(residual_km, 2),
                      "angleAt200MaMuller": round(angle_200, 4), "charts": len(selected),
                      "byPlateRole": report["selectedByPlateAndRole"],
                      "schedule": [(row["ageMa"], row["angleDegrees"], row["witnessClosureKm"]) for row in schedule]}, indent=1))


if __name__ == "__main__":
    main()
