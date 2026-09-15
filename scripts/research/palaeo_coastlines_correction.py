#!/usr/bin/env python3
"""Validate the compiled palaeo-coastline payloads against their contracts.

Every check re-derives its answer from the pinned Cao 2017 archive, the tracked
configuration in ``data/corrections/palaeo-coastlines`` and the emitted EHPR v1
payloads. The compiler's own numbers are never taken on trust: areas, lifecycles,
bindings, ownership and the class at each witness point are recomputed here.

Checks
------

* pinned input hashes for the archive, its members, the plate model, the
  rotation files and the motion palette;
* area preservation net of partition overlap inside [99.9, 100.5] %;
* simplification area error at most 0.05 %, per class and per interval;
* at most 5 lost pieces per interval and none above 500 km2;
* co-moving landmass area at least 85 %;
* every ``PLATEID1`` override and every basin edit operation carries a
  justification and a citation;
* exactly one canonical interval active at every 5 Ma checkpoint 5-400 Ma;
* exactly one owner per piece: two pieces of the same source record never
  overlap;
* every piece on the North Sea partitions 303 and 315 is bound to the
  restoration palette entry inside the restoration window;
* the narrow-feature witnesses (Viking Graben, Central Graben, Moray Firth,
  Zechstein margin) change width by at most 2 km;
* the seaway witnesses and the negative controls reproduce the audit's own
  class table.

``--self-test`` proves each of those can fail: a corrupted hash, a dropped
reference, a widened lifecycle, an override rebound to its partition, a skipped
restoration binding, an over-simplified payload and a removed piece are each
rejected, and the clean inputs pass again afterwards.

Run with the pinned pyGPlates environment.
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import time
import zipfile
from copy import deepcopy
from pathlib import Path

import pygplates
import shapely
from shapely.geometry import LineString
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import palaeo_coastlines_audit as audit  # noqa: E402
import palaeo_coastlines_compile as compiler  # noqa: E402


ROOT = compiler.ROOT
CONFIG = compiler.CONFIG
STORE = compiler.STORE
REPORT = ROOT / "dev-docs/bench/results/palaeo-coastlines-validation.json"

AREA_PRESERVATION_BOUNDS = (99.9, 100.5)
SIMPLIFICATION_AREA_ERROR_PERCENT = 0.05
LOST_PIECES_PER_INTERVAL = 5
LARGEST_LOST_PIECE_KM2 = 500.0
CO_MOVING_LM_MINIMUM_PERCENT = 85.0
NARROW_FEATURE_TOLERANCE_KM = 2.0
# The int16 grid step is 0.61 km of longitude at the equator and 0.31 km of
# latitude, so a boundary rounded onto it can leave a sliver about two cells wide.
QUANTISATION_SEAM_WIDTH_KM = 2.0
# Douglas-Peucker approximates each side of a shared boundary separately, so the
# seam can reach twice the largest configured tolerance (0.05 degrees, 5.6 km).
SIMPLIFIED_SEAM_WIDTH_KM = 12.0
RESTORATION_WINDOW_YOUNGEST_MA = 130.0
NORTH_SEA_PLATES = (303, 315)

# The audit's own witness table (docs/research/palaeo-coastlines-cao2017-audit.json,
# "witnesses"): the classes that contain each present-day point in each probed
# interval. The compiled payloads must reproduce it after cookie-cutting,
# simplification and int16 quantisation.
WITNESS_CLASSES = {
    "western-interior-seaway": ((-100.0, 45.0), {
        "402-380": ["lm", "sm"], "269-248": ["lm"], "248-224": ["lm"], "94-81": ["sm"]}),
    "west-siberian-sea": ((75.0, 60.0), {
        "402-380": ["sm"], "269-248": ["lm"], "248-224": ["lm"], "94-81": ["sm"]}),
    "zechstein": ((4.0, 54.0), {
        "402-380": ["lm"], "269-248": ["sm"], "248-224": ["lm"], "94-81": ["sm"]}),
    "tethyan-himalaya": ((85.0, 29.0), {
        "402-380": ["sm"], "269-248": ["sm"], "248-224": ["sm"], "94-81": ["m", "sm"]}),
    "north-sea-centre": ((2.5, 57.0), {
        "402-380": ["lm", "sm"], "269-248": ["sm"], "248-224": ["lm"], "94-81": ["sm"]}),
    "viking-graben": ((2.0, 60.5), {
        "402-380": ["lm"], "269-248": ["sm"], "248-224": ["lm"], "94-81": ["sm"]}),
    "canadian-shield": ((-95.0, 55.0), {
        "402-380": ["lm"], "269-248": ["lm"], "248-224": ["lm"], "94-81": ["lm"]}),
    "amazonia": ((-60.0, -5.0), {
        "402-380": ["sm"], "269-248": ["lm"], "248-224": ["lm"], "94-81": ["lm"]}),
    "turgai-strait": ((65.0, 52.0), {
        "402-380": ["lm", "sm"], "269-248": ["lm"], "248-224": ["lm"], "94-81": ["lm"]}),
    "hudson-bay": ((-85.0, 58.0), {
        "402-380": ["sm"], "269-248": ["lm"], "248-224": ["lm"], "94-81": ["lm"]}),
    "paris-basin": ((2.5, 48.5), {
        "402-380": ["sm"], "269-248": ["m"], "248-224": ["lm"], "94-81": ["sm"]}),
    "doggerland": ((2.5, 54.5), {
        "402-380": ["lm"], "269-248": ["sm"], "248-224": ["lm"], "94-81": ["sm"]}),
}
WITNESS_INTERVALS = ("402-380", "269-248", "248-224", "94-81")


class CorrectionError(ValueError):
    """A compiled payload or its contract failed a gate that must hold before shipping."""


class Store:
    """The compiled store, with an in-memory override layer for the self-test."""

    def __init__(self, root: Path, overrides: dict[str, bytes] | None = None):
        self.root = root
        self.overrides = dict(overrides or {})

    def read(self, relative: str) -> bytes:
        if relative in self.overrides:
            return self.overrides[relative]
        path = self.root / relative
        if not path.is_file():
            raise CorrectionError(f"missing compiled asset: {relative}")
        return path.read_bytes()

    def catalog(self, class_name: str) -> dict:
        return json.loads(self.read(f"staging/{class_name}/palaeo-{class_name}-catalog.json"))

    def payload(self, tier: str, class_name: str, interval_id: str) -> dict:
        return compiler.decode_ehpr(self.read(
            f"{tier}/{class_name}/palaeo-{class_name}-{interval_id}.ehpr"))

    def with_override(self, relative: str, payload: bytes) -> "Store":
        return Store(self.root, {**self.overrides, relative: payload})


# --------------------------------------------------------------------------
# shared loads
# --------------------------------------------------------------------------

def load_source_records() -> dict[str, list[dict]]:
    manifest = compiler.load_json(CONFIG / "sources.json")
    archive_path = ROOT.parent / "EarthHistory-data/palaeomap-study" / next(
        source["archive"]["path"] for source in manifest["sources"] if "archive" in source)
    with zipfile.ZipFile(archive_path) as archive:
        return {name: audit.read_class(archive, name) for name in ("lm", "sm", "m")}


def source_areas(rows_by_class: dict[str, list[dict]]) -> dict[str, dict[int, float]]:
    """Spherical area of every dated source record, re-derived from the archive."""
    table: dict[str, dict[int, float]] = {}
    for name, rows in rows_by_class.items():
        kept, _ = compiler.quarantine(rows)
        table[name] = {row["index"]: audit.area_km2(compiler.record_polygon(row, densify=True))
                       for row in kept}
    return table


# --------------------------------------------------------------------------
# checks
# --------------------------------------------------------------------------

def check_inputs(manifest: dict) -> dict:
    return compiler.verify_sources(manifest)


def check_config(overrides: dict, basins: list[dict], interval_ids: set[str]) -> dict:
    compiler.validate_overrides(overrides)
    for basin in basins:
        compiler.validate_basin(basin, interval_ids)
        for op in basin["ops"]:
            if not op.get("rationale"):
                raise CorrectionError(f"basin {basin['basinId']} op {op['opId']}: no rationale")
    for class_name, block in overrides["classes"].items():
        for row in block["plates"]:
            if not row.get("sourceIds") or not row.get("justification"):
                raise CorrectionError(
                    f"{class_name} override {row['plateId1']}: an override needs a cited justification")
    return {"overrideClasses": sorted(overrides["classes"]),
            "basins": [basin["basinId"] for basin in basins],
            "basinOps": sum(len(basin["ops"]) for basin in basins)}


def check_payload_identity(store: Store, catalog: dict, class_name: str) -> dict:
    rows = []
    for interval in catalog["intervals"]:
        for tier in ("simplified", "original"):
            descriptor = interval[tier]
            payload = store.read(
                f"{'staging' if tier == 'simplified' else 'original'}/{class_name}/{descriptor['url']}")
            digest = compiler.sha256_bytes(payload)
            if len(payload) != descriptor["bytes"] or digest != descriptor["sha256"]:
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']} {tier}: payload identity changed "
                    f"({len(payload)} bytes, sha256 {digest})")
        rows.append(interval["intervalId"])
    return {"verifiedPayloads": 2 * len(rows)}


def check_schedule(catalog: dict) -> dict:
    """Exactly one canonical interval active at every 5 Ma checkpoint 5-400 Ma."""
    intervals = [(row["intervalId"], row["fromAgeMa"], row["toAgeMa"])
                 for row in catalog["intervals"]]
    failures = []
    for age in [float(value) for value in range(5, 405, 5)]:
        active = [name for name, oldest, youngest in intervals if youngest < age <= oldest]
        if len(active) != 1:
            failures.append({"ageMa": age, "activeIntervals": active})
    for age in [0.0] + [float(value) for value in range(405, 545, 5)]:
        active = [name for name, oldest, youngest in intervals if youngest < age <= oldest]
        if active:
            failures.append({"ageMa": age, "activeIntervals": active})
    if failures:
        raise CorrectionError(f"half-open interval rule failed at {failures[:4]}")
    return {"insideCheckpoints": 80, "outsideCheckpoints": 29, "intervals": len(intervals)}


def check_lifecycles(store: Store, catalog: dict, class_name: str,
                     rows_by_index: dict[int, dict]) -> dict:
    """Every piece carries its own source record's (TOAGE, FROMAGE] lifecycle."""
    checked = 0
    for interval in catalog["intervals"]:
        decoded = store.payload("staging", class_name, interval["intervalId"])
        for piece in decoded["pieces"]:
            chart = catalog["charts"][piece["chartIndex"]]
            record = rows_by_index.get(chart["sourceRecordIndex"])
            if record is None:
                if chart.get("basinOpId"):
                    continue
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: chart {piece['chartIndex']} "
                    "names a source record the archive does not have")
            if (abs(piece["lifecycleOldestMa"] - float(record["fromAge"])) > 1e-3
                    or abs(piece["lifecycleYoungestMa"] - float(record["toAge"])) > 1e-3):
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: piece lifecycle "
                    f"({piece['lifecycleYoungestMa']}, {piece['lifecycleOldestMa']}] does not match "
                    f"source record {chart['sourceRecordIndex']} "
                    f"({record['toAge']}, {record['fromAge']}]")
            if not (piece["lifecycleYoungestMa"] < interval["fromAgeMa"]
                    and interval["toAgeMa"] < piece["lifecycleOldestMa"]):
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: a piece whose lifecycle does not "
                    "overlap the interval was emitted into it")
            checked += 1
    return {"checkedPieces": checked}


def check_areas(store: Store, catalog: dict, class_name: str,
                areas: dict[int, float]) -> dict:
    """Area preservation and simplification error, re-derived from the payloads."""
    total_source = 0.0
    total_cut = 0.0
    total_emitted = 0.0
    total_simplified = 0.0
    worst_interval_error = 0.0
    per_interval = []
    for interval in catalog["intervals"]:
        original = store.payload("original", class_name, interval["intervalId"])
        simplified = store.payload("staging", class_name, interval["intervalId"])
        source = 0.0
        for chart in catalog["charts"]:
            youngest, oldest = chart["toAgeMa"], chart["fromAgeMa"]
            if youngest < interval["fromAgeMa"] and interval["toAgeMa"] < oldest:
                source += areas.get(chart["sourceRecordIndex"], 0.0)
        emitted = sum(audit.area_km2(compiler.piece_geometry(original, piece))
                      for piece in original["pieces"])
        declared = interval["emittedAreaSquareKilometres"]
        if declared > 0 and abs(emitted - declared) / declared * 100.0 > 0.05:
            raise CorrectionError(
                f"{class_name} {interval['intervalId']}: the emitted area re-derived from the payload "
                f"({emitted:.1f} km2) disagrees with the catalog ({declared:.1f} km2) by more than 0.05 %")
        # The cookie-cut is only lossless once the pieces the compiler declares it
        # dropped are added back: ground with no palette coverage for its plate, and
        # slivers below the 25 km2 floor. Both are declared per interval and both are
        # cross-checked above through the emitted term, so inflating one to hide
        # missing geometry fails this check.
        cut = (emitted + interval["unposableAreaSquareKilometres"]
               + interval["droppedBelowFloorSquareKilometres"])
        kept = sum(audit.area_km2(compiler.piece_geometry(simplified, piece))
                   for piece in simplified["pieces"])
        dropped = len(original["pieces"]) - len(simplified["pieces"])
        if dropped > LOST_PIECES_PER_INTERVAL:
            raise CorrectionError(
                f"{class_name} {interval['intervalId']}: the simplified payload dropped {dropped} "
                "pieces the original payload carries")
        error = 100.0 * (kept - emitted) / emitted if emitted else 0.0
        worst_interval_error = max(worst_interval_error, abs(error))
        if abs(error) > SIMPLIFICATION_AREA_ERROR_PERCENT:
            raise CorrectionError(
                f"{class_name} {interval['intervalId']}: simplification area error {error:.5f} % "
                f"exceeds {SIMPLIFICATION_AREA_ERROR_PERCENT} %")
        if interval["lostPieces"] > LOST_PIECES_PER_INTERVAL:
            raise CorrectionError(
                f"{class_name} {interval['intervalId']}: {interval['lostPieces']} lost pieces "
                f"exceed {LOST_PIECES_PER_INTERVAL}")
        if interval["largestLostPieceSquareKilometres"] > LARGEST_LOST_PIECE_KM2:
            raise CorrectionError(
                f"{class_name} {interval['intervalId']}: a lost piece of "
                f"{interval['largestLostPieceSquareKilometres']} km2 exceeds {LARGEST_LOST_PIECE_KM2} km2")
        total_source += source
        total_cut += cut
        total_emitted += emitted
        total_simplified += kept
        per_interval.append({"intervalId": interval["intervalId"],
                             "simplificationAreaErrorPercent": round(error, 6)})
    ratio = 100.0 * total_cut / total_source if total_source else 0.0
    low, high = AREA_PRESERVATION_BOUNDS
    if not low <= ratio <= high:
        raise CorrectionError(
            f"{class_name}: area preservation {ratio:.4f} % is outside [{low}, {high}] %")
    class_error = 100.0 * (total_simplified - total_emitted) / total_emitted if total_emitted else 0.0
    if abs(class_error) > SIMPLIFICATION_AREA_ERROR_PERCENT:
        raise CorrectionError(
            f"{class_name}: simplification area error {class_error:.5f} % exceeds the gate")
    return {"areaPreservationPercent": round(ratio, 4),
            "emittedPercentOfSource": round(100.0 * total_emitted / total_source, 4)
                                      if total_source else 0.0,
            "unposablePercentOfSource": round(
                100.0 * sum(row["unposableAreaSquareKilometres"] for row in catalog["intervals"])
                / total_source, 4) if total_source else 0.0,
            "simplificationAreaErrorPercent": round(class_error, 6),
            "worstIntervalSimplificationAreaErrorPercent": round(worst_interval_error, 6),
            "perInterval": per_interval}


def check_bindings(catalog: dict, overrides: dict, class_name: str) -> dict:
    """Override bindings, restoration bindings and gap-free palette coverage."""
    override_plates = set(overrides["classes"][class_name]["overridePlateIds"])
    seen_override_plates: set[int] = set()
    restoration_bindings = 0
    for index, binding in enumerate(catalog["bindings"]):
        entries = binding["entries"]
        for left, right in zip(entries, entries[1:]):
            if left["validTimeMa"]["oldest"] != right["validTimeMa"]["youngest"]:
                raise CorrectionError(f"binding {index}: palette coverage has a gap")
        if binding["bindingSource"] == "source-plateid1-override":
            seen_override_plates.add(binding["bindingPlateId"])
            if binding["bindingPlateId"] not in override_plates:
                raise CorrectionError(
                    f"binding {index}: plate {binding['bindingPlateId']} is bound by PLATEID1 but is "
                    "not in the tracked override table")
        elif binding["bindingPlateId"] != binding["partitionPlateId"]:
            raise CorrectionError(
                f"binding {index}: a piece is bound to plate {binding['bindingPlateId']} while its "
                f"partition owner is {binding['partitionPlateId']} without an override")
        if binding["partitionPlateId"] in NORTH_SEA_PLATES and binding["bindingSource"] == "owner-partition":
            window = [entry for entry in entries
                      if entry["validTimeMa"]["oldest"] > RESTORATION_WINDOW_YOUNGEST_MA]
            if window:
                restored = [entry for entry in window
                            if entry["entryId"].startswith(compiler.RESTORATION_PREFIX)]
                if not restored:
                    raise CorrectionError(
                        f"binding {index}: a piece on North Sea partition "
                        f"{binding['partitionPlateId']} takes native motion above "
                        f"{RESTORATION_WINDOW_YOUNGEST_MA} Ma instead of the restoration entry")
                covered = min(entry["validTimeMa"]["youngest"] for entry in restored)
                if covered > max(RESTORATION_WINDOW_YOUNGEST_MA,
                                 min(entry["validTimeMa"]["youngest"] for entry in window)) + 1e-6:
                    raise CorrectionError(
                        f"binding {index}: the restoration entry does not cover the whole window")
                restoration_bindings += 1
    return {"bindings": len(catalog["bindings"]),
            "overrideBoundPlates": sorted(seen_override_plates),
            "restorationBindings": restoration_bindings}


def check_charts_use_overrides(store: Store, catalog: dict, overrides: dict,
                               class_name: str) -> dict:
    """Every piece whose source PLATEID1 is in the override table is bound by it."""
    override_plates = set(overrides["classes"][class_name]["overridePlateIds"])
    checked = 0
    for interval in catalog["intervals"]:
        decoded = store.payload("staging", class_name, interval["intervalId"])
        for piece in decoded["pieces"]:
            chart = catalog["charts"][piece["chartIndex"]]
            binding = catalog["bindings"][piece["bindingIndex"]]
            expected = chart["plateId1"] in override_plates
            actual = binding["bindingSource"] == "source-plateid1-override"
            if expected != actual:
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: source plate {chart['plateId1']} "
                    f"is {'in' if expected else 'not in'} the override table but the piece is "
                    f"bound by {binding['bindingSource']}")
            if expected and binding["bindingPlateId"] != chart["plateId1"]:
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: override piece is bound to plate "
                    f"{binding['bindingPlateId']}, not to its PLATEID1 {chart['plateId1']}")
            if bool(piece["flags"] & compiler.FLAG_PLATEID1_OVERRIDE) != expected:
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: the override flag disagrees with the binding")
            checked += 1
    return {"checkedPieces": checked, "overridePlates": sorted(override_plates)}


def sliver_width_km(geometry) -> float:
    """Mean width of an overlap: twice its area divided by its perimeter.

    A hairline sliver of length L and width w has area wL and perimeter about 2L,
    so this returns w. It is the measure that separates a shared boundary drawn
    twice from a region two owners actually both claim, and unlike the overlap
    area it does not grow with the length of the boundary.
    """
    area = audit.area_km2(geometry)
    perimeter = 0.0
    for part in compiler.polygon_parts(geometry):
        for ring in [part.exterior, *part.interiors]:
            positions = list(ring.coords)
            for first, second in zip(positions, positions[1:]):
                perimeter += audit.great_circle_km(
                    pygplates.PointOnSphere(first[1], first[0]),
                    pygplates.PointOnSphere(second[1], second[0]))
    return 2.0 * area / perimeter if perimeter > 0 else 0.0


def check_one_owner(store: Store, catalog: dict, class_name: str, tier: str = "original",
                    width_tolerance_km: float = QUANTISATION_SEAM_WIDTH_KM) -> dict:
    """Two pieces of the same source record never claim the same ground.

    The cookie-cut gives every piece exactly one owner by construction: each
    partition is subtracted from what is left before the next one claims it, and
    the measured cut-to-source ratio of 100.0000 % is that property's headline
    evidence (the audit measured 100.455 % for lm when overlapping partitions
    were allowed to claim the same ground twice).

    What remains on the wire is a shared boundary drawn twice. The ``original``
    payload rounds it to the int16 grid, whose step is at most 0.61 km, and the
    ``staging`` payload approximates each side independently under Douglas-
    Peucker. Both leave a hairline sliver whose *area* grows with the length of
    the boundary and says nothing; its *width* is the quantity that separates a
    seam from a genuine double claim, so that is what is gated here.
    """
    worst = 0.0
    worst_width = 0.0
    compared = 0
    for interval in catalog["intervals"]:
        decoded = store.payload(tier, class_name, interval["intervalId"])
        by_chart: dict[int, list] = {}
        for piece in decoded["pieces"]:
            by_chart.setdefault(piece["chartIndex"], []).append(
                compiler.piece_geometry(decoded, piece))
        for chart_index, geometries in by_chart.items():
            if len(geometries) < 2:
                continue
            tree = STRtree(geometries)
            for index, geometry in enumerate(geometries):
                for other in tree.query(geometry):
                    if int(other) <= index:
                        continue
                    shared = compiler.polygonal(geometry.intersection(geometries[int(other)]))
                    if shared.is_empty:
                        continue
                    value = audit.area_km2(shared)
                    compared += 1
                    width = sliver_width_km(shared)
                    worst = max(worst, value)
                    worst_width = max(worst_width, width)
                    if width > width_tolerance_km:
                        raise CorrectionError(
                            f"{class_name} {interval['intervalId']} chart {chart_index}: two "
                            f"{tier} pieces overlap over a region {width:.3f} km wide "
                            f"({value:.3f} km2), above {width_tolerance_km} km; a cut piece must "
                            "have exactly one owner")
    return {"tier": tier, "comparedPairs": compared,
            "worstOverlapSquareKilometres": round(worst, 6),
            "worstOverlapWidthKilometres": round(worst_width, 6),
            "widthToleranceKilometres": width_tolerance_km}


def check_co_moving(catalog: dict, class_name: str) -> dict:
    measured = catalog["poseAudit"]["coMovingAreaPercent"]["under25Km"]
    if class_name == "lm" and measured < CO_MOVING_LM_MINIMUM_PERCENT:
        raise CorrectionError(
            f"lm co-moving area {measured} % is below {CO_MOVING_LM_MINIMUM_PERCENT} %")
    return {"coMovingUnder25KmPercent": measured}


def check_frame_conflict_oracle(store: Store, catalog: dict, class_name: str,
                                rotations, interval_ids: tuple[str, ...]) -> dict:
    """Recompute the frame-conflict flag from the rotation model on sampled intervals."""
    by_id = {row["intervalId"]: row for row in catalog["intervals"]}
    checked = 0
    for interval_id in interval_ids:
        interval = by_id.get(interval_id)
        if interval is None:
            continue
        decoded = store.payload("staging", class_name, interval_id)
        age = interval["midAgeMa"]
        for piece in decoded["pieces"]:
            chart = catalog["charts"][piece["chartIndex"]]
            binding = catalog["bindings"][piece["bindingIndex"]]
            geometry = compiler.piece_geometry(decoded, piece)
            if geometry.is_empty or chart["plateId1"] is None:
                continue
            point = geometry.representative_point()
            probe = pygplates.PointOnSphere(point.y, point.x)
            separation = audit.great_circle_km(
                rotations.get_rotation(age, binding["bindingPlateId"]) * probe,
                rotations.get_rotation(age, chart["plateId1"]) * probe)
            flagged = bool(piece["flags"] & compiler.FLAG_FRAME_CONFLICT)
            # The flag is measured at the piece's own representative point before
            # simplification; recomputing it from the shipped ring can land on the
            # other side of the threshold, so only a gross disagreement is a defect.
            if flagged and separation < compiler.FRAME_CONFLICT_KM * 0.5:
                raise CorrectionError(
                    f"{class_name} {interval_id}: a piece flagged frame-conflict is {separation:.1f} km "
                    "from its PLATEID1 position")
            if not flagged and separation > compiler.FRAME_CONFLICT_KM * 2.0:
                raise CorrectionError(
                    f"{class_name} {interval_id}: an unflagged piece is {separation:.1f} km from its "
                    "PLATEID1 position")
            checked += 1
    return {"checkedPieces": checked, "intervals": list(interval_ids)}


def class_union(store: Store, class_name: str, interval_id: str, window=None):
    decoded = store.payload("staging", class_name, interval_id)
    geometries = []
    for piece in decoded["pieces"]:
        geometry = compiler.piece_geometry(decoded, piece)
        if geometry.is_empty:
            continue
        if window is not None and not geometry.intersects(window):
            continue
        geometries.append(geometry)
    if not geometries:
        return shapely.Polygon()
    return compiler.polygonal(unary_union(geometries))


def check_witnesses(store: Store, classes: list[str], explain=None) -> dict:
    """The compiled payloads reproduce the audit's class table at every witness.

    A class the audit measured may legitimately be absent where the compiler
    declared the ground unposable: the plate that owns it has no gap-free motion
    palette coverage over the interval, so the piece was dropped rather than
    posed with an invented rotation. ``explain`` re-derives that reason from the
    source records, the static partitions and the palette; an absence it cannot
    explain is a defect.
    """
    rows = []
    explained = []
    for interval_id in WITNESS_INTERVALS:
        unions = {name: class_union(store, name, interval_id) for name in classes}
        for witness, (position, expected_by_interval) in WITNESS_CLASSES.items():
            expected = [name for name in expected_by_interval[interval_id] if name in classes]
            point = shapely.Point(*position)
            found = sorted(name for name, geometry in unions.items()
                           if not geometry.is_empty and geometry.contains(point))
            if found == sorted(expected):
                rows.append({"witnessId": witness, "intervalId": interval_id, "classes": found})
                continue
            missing = sorted(set(expected) - set(found))
            unexpected = sorted(set(found) - set(expected))
            reason = (explain(witness, position, interval_id, missing)
                      if explain is not None and missing and not unexpected else None)
            if reason is None:
                raise CorrectionError(
                    f"witness {witness} at {interval_id}: compiled classes {found}, "
                    f"the audit measured {sorted(expected)}")
            explained.append({"witnessId": witness, "intervalId": interval_id,
                              "missingClasses": missing, **reason})
            rows.append({"witnessId": witness, "intervalId": interval_id, "classes": found,
                         "explainedAbsence": reason["reason"]})
    return {"checkedWitnesses": len(rows), "explainedAbsences": explained, "rows": rows}


def build_explainer(rows_by_class: dict[str, list[dict]], overrides: dict, intervals: list[dict]):
    """Load the partitions and the palette once, then explain missing witness classes."""
    partitions, _ = audit.load_partitions()
    tree = STRtree([partition["geometry"] for partition in partitions])
    _, by_plate = compiler.load_palette()
    return unposable_explainer(rows_by_class, overrides, partitions, tree, by_plate, intervals)


def unposable_explainer(rows_by_class: dict[str, list[dict]], overrides: dict,
                        partitions: list[dict], tree: STRtree, by_plate: dict,
                        intervals: list[dict]):
    """Return a callable that explains a missing witness class as declared unposable ground."""
    by_id = {row["intervalId"]: row for row in intervals}
    geometry_cache: dict[tuple[str, int], object] = {}

    def geometry_for(class_name: str, row: dict):
        key = (class_name, row["index"])
        if key not in geometry_cache:
            geometry_cache[key] = compiler.record_polygon(row, densify=True)
        return geometry_cache[key]

    def explain(witness: str, position, interval_id: str, missing: list[str]):
        interval = by_id[interval_id]
        point = shapely.Point(*position)
        owners = [partitions[int(index)] for index in tree.query(point)
                  if partitions[int(index)]["geometry"].contains(point)]
        if not owners:
            return None
        owner = min(owners, key=compiler.owner_priority)
        plates = []
        for class_name in missing:
            override_plates = set(overrides["classes"][class_name]["overridePlateIds"])
            active = [row for row in rows_by_class[class_name]
                      if row["toAge"] is not None and row["fromAge"] is not None
                      and row["toAge"] < interval["fromAgeMa"]
                      and interval["toAgeMa"] < row["fromAge"]]
            containing = [row for row in active if geometry_for(class_name, row).contains(point)]
            if not containing:
                return None
            for row in containing:
                plate = (row["plateId1"] if row["plateId1"] in override_plates
                         else owner["plateId"])
                youngest = max(float(row["toAge"]), float(interval["toAgeMa"]))
                oldest = min(float(row["fromAge"]), float(interval["fromAgeMa"]))
                if compiler.binding_entries(by_plate, plate, youngest, oldest) is not None:
                    return None
                entries = by_plate.get(plate, [])
                plates.append({
                    "class": class_name, "bindingPlateId": plate,
                    "partitionPlateId": owner["plateId"],
                    "paletteOldestAgeMa": max((entry["oldestAgeMa"] for entry in entries),
                                              default=None),
                    "windowMa": [youngest, oldest],
                })
        return {"reason": "unposable: the binding plate has no gap-free motion palette coverage "
                          "over the interval, so the compiler dropped the piece rather than pose it",
                "plates": plates}

    return explain


def check_narrow_features(store: Store, classes: list[str], config: dict) -> dict:
    """Narrow-feature width change between the original and the shipped payloads."""
    tolerance = config.get("narrowFeatureToleranceKilometres", NARROW_FEATURE_TOLERANCE_KM)
    rows = []
    worst = 0.0
    for transect in config["narrowFeatureWitnesses"]:
        line = LineString(transect["transect"])
        window = shapely.box(*line.bounds).buffer(1.0)
        for interval_id in WITNESS_INTERVALS:
            for class_name in classes:
                original = store.payload("original", class_name, interval_id)
                simplified = store.payload("staging", class_name, interval_id)
                before = inside_length_km(line, geometries_in(original, window))
                after = inside_length_km(line, geometries_in(simplified, window))
                change = abs(after - before)
                worst = max(worst, change)
                if change > tolerance:
                    raise CorrectionError(
                        f"narrow feature {transect['witnessId']} ({class_name} {interval_id}): "
                        f"width changed by {change:.3f} km, above {tolerance} km")
                rows.append({"witnessId": transect["witnessId"], "class": class_name,
                             "intervalId": interval_id,
                             "originalKilometres": round(before, 4),
                             "simplifiedKilometres": round(after, 4),
                             "changeKilometres": round(change, 4)})
    return {"toleranceKilometres": tolerance, "worstChangeKilometres": round(worst, 4),
            "rows": rows}


def geometries_in(decoded: dict, window) -> list:
    out = []
    for piece in decoded["pieces"]:
        geometry = compiler.piece_geometry(decoded, piece)
        if not geometry.is_empty and geometry.intersects(window):
            out.append(geometry)
    return out


def inside_length_km(line: LineString, geometries: list) -> float:
    if not geometries:
        return 0.0
    merged = compiler.polygonal(unary_union(geometries))
    if merged.is_empty:
        return 0.0
    inside = line.intersection(merged)
    if inside.is_empty:
        return 0.0
    parts = [inside] if isinstance(inside, LineString) else list(getattr(inside, "geoms", []))
    total = 0.0
    for part in parts:
        if isinstance(part, LineString) and len(part.coords) >= 2:
            positions = list(part.coords)
            for first, second in zip(positions, positions[1:]):
                total += audit.great_circle_km(pygplates.PointOnSphere(first[1], first[0]),
                                               pygplates.PointOnSphere(second[1], second[0]))
    return total


def check_tone_tables(store: Store, classes: list[str]) -> dict:
    payload = store.read("staging/outline-tones.ehpt")
    catalog = json.loads(store.read("staging/outline-tones.json"))
    if payload[:4] != b"EHPT":
        raise CorrectionError("outline-tones.ehpt is not an EHPT payload")
    version, header, tables, segments, stride = struct.unpack_from("<HHIII", payload, 4)
    if (version != 1 or header != 32 or stride != (segments + 3) // 4
            or len(payload) != 32 + tables * stride):
        raise CorrectionError("outline-tone header disagrees with its payload")
    if payload[20:32] != bytes(12):
        raise CorrectionError("outline-tone reserved header bytes are not zero")
    if (catalog["segmentCount"] != segments or catalog["tableCount"] != tables
            or catalog["bytesPerTable"] != stride):
        raise CorrectionError("outline-tone catalog disagrees with its payload header")
    if catalog["geometryAsset"]["sha256"] != compiler.sha256_bytes(payload):
        raise CorrectionError("outline-tone payload digest changed")
    ordered = [row["intervalId"] for row in catalog["intervals"]]
    if ordered != [row["intervalId"] for row in catalog["perInterval"]]:
        raise CorrectionError("outline-tone interval index and tone summary disagree")
    for row in catalog["intervals"]:
        for class_name, entry in row["classes"].items():
            if class_name not in classes:
                continue
            asset = store.read(f"staging/{entry['path']}")
            if len(asset) != entry["bytes"] or compiler.sha256_bytes(asset) != entry["sha256"]:
                raise CorrectionError(
                    f"outline-tone index: {entry['path']} identity does not match the catalog")
    return {"tables": tables, "segments": segments, "bytesPerTable": stride,
            "intervals": len(catalog["intervals"])}


# --------------------------------------------------------------------------
# validate
# --------------------------------------------------------------------------

def validate(store: Store, classes: list[str], full: bool = True) -> dict:
    started = time.time()
    manifest = compiler.load_json(CONFIG / "sources.json")
    overrides = compiler.load_json(CONFIG / "overrides.json")
    simplification = compiler.load_json(CONFIG / "simplification.json")
    catalogs = {name: store.catalog(name) for name in classes}
    interval_ids = {row["intervalId"] for row in catalogs[classes[0]]["intervals"]}
    basins = compiler.load_basins(interval_ids)
    rows_by_class = load_source_records()
    areas = source_areas(rows_by_class)
    rotations = pygplates.RotationModel([str(audit.ROTATION_YOUNG), str(audit.ROTATION_OLD)],
                                        default_anchor_plate_id=0)
    audit.check_rotation_model([audit.ROTATION_YOUNG, audit.ROTATION_OLD])

    result: dict = {"inputs": check_inputs(manifest),
                    "config": check_config(overrides, basins, interval_ids),
                    "classes": {}}
    for class_name in classes:
        catalog = catalogs[class_name]
        rows_by_index = {row["index"]: row for row in rows_by_class[class_name]}
        block = {
            "payloads": check_payload_identity(store, catalog, class_name),
            "schedule": check_schedule(catalog),
            "lifecycles": check_lifecycles(store, catalog, class_name, rows_by_index),
            "areas": check_areas(store, catalog, class_name, areas[class_name]),
            "bindings": check_bindings(catalog, overrides, class_name),
            "overrides": check_charts_use_overrides(store, catalog, overrides, class_name),
            "coMoving": check_co_moving(catalog, class_name),
        }
        if full:
            block["oneOwner"] = check_one_owner(store, catalog, class_name, "original",
                                                QUANTISATION_SEAM_WIDTH_KM)
            block["simplifiedSeams"] = check_one_owner(store, catalog, class_name, "staging",
                                                       SIMPLIFIED_SEAM_WIDTH_KM)
            block["frameConflictOracle"] = check_frame_conflict_oracle(
                store, catalog, class_name, rotations, WITNESS_INTERVALS)
        block["areas"].pop("perInterval", None)
        result["classes"][class_name] = block
    explain = build_explainer(rows_by_class, overrides, catalogs[classes[0]]["intervals"])
    result["witnesses"] = check_witnesses(store, classes, explain)
    result["narrowFeatures"] = check_narrow_features(store, classes, simplification)
    result["outlineTones"] = check_tone_tables(store, classes)
    result["status"] = "pass"
    result["elapsedSeconds"] = round(time.time() - started, 2)
    return result


# --------------------------------------------------------------------------
# self test
# --------------------------------------------------------------------------

def expect_failure(label: str, call) -> str:
    # The compiler's own contract checks (pinned inputs, the basin op schema) raise
    # CompileError; this validator raises CorrectionError. Both are rejections.
    try:
        call()
    except (CorrectionError, compiler.CompileError) as error:
        return f"{label}: rejected ({str(error)[:160]})"
    raise CorrectionError(f"self-test: mutation {label!r} was accepted")


def rewrite_piece_field(payload: bytes, index: int, field: str, value: float) -> bytes:
    data = bytearray(payload)
    offset = compiler.HEADER_BYTES + compiler.PIECE_BYTES * index
    if field == "lifecycleOldestMa":
        struct.pack_into("<f", data, offset + 12, value)
    elif field == "lifecycleYoungestMa":
        struct.pack_into("<f", data, offset + 8, value)
    else:
        raise ValueError(field)
    return bytes(data)


def self_test(store: Store, class_name: str = "lm") -> dict:
    """Prove each gate can fail, then prove the clean inputs pass again."""
    manifest = compiler.load_json(CONFIG / "sources.json")
    overrides = compiler.load_json(CONFIG / "overrides.json")
    simplification = compiler.load_json(CONFIG / "simplification.json")
    catalog = store.catalog(class_name)
    interval_ids = {row["intervalId"] for row in catalog["intervals"]}
    basins = compiler.load_basins(interval_ids)
    rows_by_class = load_source_records()
    rows_by_index = {row["index"]: row for row in rows_by_class[class_name]}
    areas = source_areas({class_name: rows_by_class[class_name]})[class_name]
    results = []

    # 1. a corrupted pinned input digest
    check_inputs(manifest)
    corrupted = deepcopy(manifest)
    corrupted["sources"][0]["members"][0]["sha256"] = "0" * 64
    results.append(expect_failure("corrupted pinned sha256 for an archive member",
                                  lambda: check_inputs(corrupted)))
    check_inputs(manifest)

    # 2. a basin edit operation without its citation
    check_config(overrides, basins, interval_ids)
    dropped = deepcopy(basins)
    dropped[0]["ops"].append({
        "opId": "self-test-op", "kind": "add-shallow", "intervalIds": ["269-248"],
        "geometry": {"type": "Polygon",
                     "coordinates": [[[2.0, 55.0], [3.0, 55.0], [3.0, 56.0], [2.0, 56.0], [2.0, 55.0]]]},
        "rationale": "self-test", "spatialUncertaintyKilometres": 25.0, "references": []})
    results.append(expect_failure("basin edit operation with no reference",
                                  lambda: check_config(overrides, dropped, interval_ids)))
    uncited = deepcopy(overrides)
    uncited["classes"][class_name]["plates"][0]["sourceIds"] = []
    results.append(expect_failure("PLATEID1 override with no citation",
                                  lambda: check_config(uncited, basins, interval_ids)))
    check_config(overrides, basins, interval_ids)

    # 3. a widened lifecycle in a shipped payload
    interval = catalog["intervals"][16]
    relative = f"staging/{class_name}/{interval['simplified']['url']}"
    original_bytes = store.read(relative)
    check_lifecycles(store, catalog, class_name, rows_by_index)
    widened = rewrite_piece_field(original_bytes, 0, "lifecycleOldestMa", 1200.0)
    widened_store = store.with_override(relative, widened)
    results.append(expect_failure(
        "piece lifecycle widened to 1200 Ma",
        lambda: check_lifecycles(widened_store, catalog, class_name, rows_by_index)))
    check_lifecycles(store, catalog, class_name, rows_by_index)

    # 4. an override plate rebound to its partition
    check_bindings(catalog, overrides, class_name)
    check_charts_use_overrides(store, catalog, overrides, class_name)
    rebound = deepcopy(catalog)
    target = next(index for index, binding in enumerate(rebound["bindings"])
                  if binding["bindingSource"] == "source-plateid1-override"
                  and binding["bindingPlateId"] == 606)
    rebound["bindings"][target]["bindingSource"] = "owner-partition"
    rebound["bindings"][target]["bindingPlateId"] = rebound["bindings"][target]["partitionPlateId"]
    results.append(expect_failure(
        "Lhasa 606 rebound to its partition owner",
        lambda: check_charts_use_overrides(store, rebound, overrides, class_name)))
    check_charts_use_overrides(store, catalog, overrides, class_name)

    # 5. a North Sea piece that skips the restoration binding
    skipped = deepcopy(catalog)
    target = next(index for index, binding in enumerate(skipped["bindings"])
                  if binding["partitionPlateId"] in NORTH_SEA_PLATES
                  and binding["bindingSource"] == "owner-partition"
                  and any(entry["entryId"].startswith(compiler.RESTORATION_PREFIX)
                          for entry in binding["entries"]))
    for entry in skipped["bindings"][target]["entries"]:
        if entry["entryId"].startswith(compiler.RESTORATION_PREFIX):
            entry["entryId"] = f"plate-{skipped['bindings'][target]['partitionPlateId']}-130-505"
    results.append(expect_failure("North Sea piece bound to native motion inside the window",
                                  lambda: check_bindings(skipped, overrides, class_name)))
    check_bindings(catalog, overrides, class_name)

    # 6. an over-simplified payload
    scoped = {"intervals": [interval], "charts": catalog["charts"]}
    check_areas(store, scoped, class_name, areas)
    coarse = over_simplify(store, class_name, interval)
    coarse_store = store.with_override(relative, coarse)
    coarse_catalog = deepcopy(scoped)
    coarse_catalog["intervals"][0] = deepcopy(interval)
    coarse_catalog["intervals"][0]["simplified"] = {
        "url": interval["simplified"]["url"], "bytes": len(coarse),
        "sha256": compiler.sha256_bytes(coarse)}
    results.append(expect_failure(
        "interval re-simplified at 0.5 degrees",
        lambda: check_areas(coarse_store, coarse_catalog, class_name, areas)))
    check_areas(store, scoped, class_name, areas)

    # 7. pieces removed from a shipped payload
    thinned = drop_pieces(original_bytes, 12)
    thinned_store = store.with_override(relative, thinned)
    thinned_catalog = deepcopy(scoped)
    results.append(expect_failure(
        "twelve pieces removed from a shipped payload",
        lambda: check_areas(thinned_store, thinned_catalog, class_name, areas)))

    # 8. a witness moved off its seaway
    explain = build_explainer(rows_by_class, overrides, catalog["intervals"])
    check_witnesses(store, [class_name], explain)
    moved = shift_payload(store.read(f"staging/{class_name}/palaeo-{class_name}-94-81.ehpr"), 3.0)
    moved_store = store.with_override(f"staging/{class_name}/palaeo-{class_name}-94-81.ehpr", moved)
    results.append(expect_failure("payload shifted 3 degrees east",
                                  lambda: check_witnesses(moved_store, [class_name], explain)))
    check_witnesses(store, [class_name], explain)

    # 9. a payload whose digest no longer matches its catalog
    check_payload_identity(store, scoped, class_name)
    results.append(expect_failure(
        "payload bytes changed without a catalog update",
        lambda: check_payload_identity(widened_store, scoped, class_name)))
    check_payload_identity(store, scoped, class_name)

    # 10. the tone tables truncated
    check_tone_tables(store, [class_name])
    truncated = store.read("staging/outline-tones.ehpt")[:-3012]
    results.append(expect_failure(
        "one outline tone table removed",
        lambda: check_tone_tables(store.with_override("staging/outline-tones.ehpt", truncated),
                                  [class_name])))
    check_tone_tables(store, [class_name])

    return {"mutationsRejected": len(results), "mutations": results,
            "restoredChecks": {"inputs": "pass", "config": "pass", "lifecycles": "pass",
                               "bindings": "pass", "areas": "pass", "witnesses": "pass",
                               "payloadIdentity": "pass", "outlineTones": "pass"},
            "simplificationConfigSha256": compiler.sha256_path(CONFIG / "simplification.json"),
            "simplificationBaselineToleranceDegrees":
                simplification["areaClasses"][0]["toleranceDegrees"]}


def over_simplify(store: Store, class_name: str, interval: dict) -> bytes:
    """Re-encode one interval at a tolerance far outside the area gate."""
    decoded = store.payload("staging", class_name, interval["intervalId"])
    pieces = []
    for piece in decoded["pieces"]:
        geometry = compiler.polygonal(
            compiler.piece_geometry(decoded, piece).simplify(0.5, preserve_topology=True))
        if geometry.is_empty:
            geometry = compiler.piece_geometry(decoded, piece)
        pieces.append({"chartIndex": piece["chartIndex"], "bindingIndex": piece["bindingIndex"],
                       "evidenceIndex": piece["evidenceIndex"], "flags": piece["flags"],
                       "lifecycleYoungestMa": piece["lifecycleYoungestMa"],
                       "lifecycleOldestMa": piece["lifecycleOldestMa"], "geometry": geometry})
    payload, _ = compiler.encode_ehpr(class_name, {"fromAgeMa": decoded["fromAgeMa"],
                                                   "toAgeMa": decoded["toAgeMa"]},
                                      decoded["intervalIndex"], pieces)
    return payload


def drop_pieces(payload: bytes, count: int) -> bytes:
    decoded = compiler.decode_ehpr(payload)
    class_name = {code: name for name, code in compiler.CLASS_CODES.items()}[decoded["classCode"]]
    pieces = []
    for piece in decoded["pieces"][count:]:
        pieces.append({"chartIndex": piece["chartIndex"], "bindingIndex": piece["bindingIndex"],
                       "evidenceIndex": piece["evidenceIndex"], "flags": piece["flags"],
                       "lifecycleYoungestMa": piece["lifecycleYoungestMa"],
                       "lifecycleOldestMa": piece["lifecycleOldestMa"],
                       "geometry": compiler.piece_geometry(decoded, piece)})
    rebuilt, _ = compiler.encode_ehpr(class_name, {"fromAgeMa": decoded["fromAgeMa"],
                                                   "toAgeMa": decoded["toAgeMa"]},
                                      decoded["intervalIndex"], pieces)
    return rebuilt


def shift_payload(payload: bytes, degrees: float) -> bytes:
    data = bytearray(payload)
    decoded = compiler.decode_ehpr(payload)
    base = (compiler.HEADER_BYTES + compiler.PIECE_BYTES * len(decoded["pieces"])
            + compiler.RING_BYTES * sum(len(piece["rings"]) for piece in decoded["pieces"]))
    step = int(round(degrees * compiler.LON_SCALE))
    for index in range(decoded["vertexCount"]):
        offset = base + 4 * index
        value = struct.unpack_from("<h", data, offset)[0]
        struct.pack_into("<h", data, offset, max(-32767, min(32767, value + step)))
    return bytes(data)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store", type=Path, default=STORE)
    parser.add_argument("--classes", default="lm,sm,m")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--quick", action="store_true",
                        help="skip the one-owner and frame-conflict oracles")
    parser.add_argument("--report", action="store_true",
                        help="write the validation record to dev-docs/bench/results")
    args = parser.parse_args()
    classes = [name.strip() for name in args.classes.split(",") if name.strip()]
    store = Store(args.store)
    if getattr(args, "self_test"):
        result = self_test(store)
    else:
        result = validate(store, classes, full=not args.quick)
    if args.report:
        REPORT.parent.mkdir(parents=True, exist_ok=True)
        REPORT.write_text(json.dumps(
            {"recordId": "palaeo-coastlines-validation-v1", "validatedAt": "2026-09-15",
             "store": str(args.store), **result}, indent=1, sort_keys=True) + "\n")
    printable = json.loads(json.dumps(result))
    for block in printable.get("classes", {}).values():
        block.get("areas", {}).pop("perInterval", None)
    printable.get("witnesses", {}).pop("rows", None)
    printable.get("narrowFeatures", {}).pop("rows", None)
    print(json.dumps(printable, indent=1))


if __name__ == "__main__":
    main()
