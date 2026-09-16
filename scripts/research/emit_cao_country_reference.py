#!/usr/bin/env python3
"""Partition Natural Earth reference lines onto native Cao static fragments.

Motion-binding precedence for a country-outline segment
-------------------------------------------------------
A segment is bound to the Cao static fragment that owns it, and that fragment's
plate may carry several motion-palette entries whose validity windows overlap.
``validateCorePackageV2`` requires exactly one *live* binding at every age of a
chart's lifecycle, so the emitter tiles the lifetime: one owning entry per age,
merged into a gap-free, non-overlapping run of bindings.
``select_outline_entry`` implements the choice; the precedence is a scientific
contract, not a build detail, and is mirrored in ``docs/data/README.md``:

  1. A ``restoration-*`` or ``native-recovery-*`` entry owns every age it is live
     at. Restoration keeps the North Sea outlines on the restored
     Baltica/Avalonia motion (the 0.1.10 user contract) -- but only for the
     modern countries the restoration contract's ``chartSelection.countryCodes``
     names (GBR, IRL, IMN). The restored block is Cao 303 and 315 *west of the
     Central Graben and Channel cut*, so a Polish or German fragment of the same
     Avalonian plate lies east of the cut and stays on the plate's native
     (Baltica-fixed) motion, exactly as the contract's excluded straddling shelf
     polygon does. ``north_sea_restoration_fit.py`` applies the same country-code
     rule when it pins charts; recovery keeps every
     chart on a recovered plate (626, 8011) on the native triangulation that
     replaced its source geometry, because a recovery plate never falls back to
     native motion -- the same rule the palaeo charts already follow. A plate
     carrying recovery entries is tiled from those entries alone, through
     ``recovery_tiles``, so the declared sub-microsecond rotation seams inside
     the recovery windows stay seams (``motionSupportGaps``) instead of becoming
     baseline tiles. The two tiers are not authored on any shared plate; were one
     ever added, restoration wins and the plate returns to the tiers below, and
     the self-test asserts it.
  2. A chart on the North Sea contract's Tornquist Block plate (330) follows the
     reference plate's (Baltica 302) native motion from the restoration window
     start, keeping its own plate's native motion below it. This is the
     ``fixedBinding`` tier of
     ``data/corrections/north-sea-restoration/restoration-contract.json`` (the
     0.1.10 user contract): a 330 chart would otherwise ride the 0.59 degree
     Tornquist stage that drifts one copy of Denmark 40 km south-west from
     170 Ma back while its duplicates on 315, 302 and 30204 stay.
     ``apply_north_sea_restoration.py`` binds the native 330 charts exactly this
     way; the outline charts are re-emitted here after that correction has run,
     so the tier is restated rather than inherited.
  3. Otherwise the baseline ``plate-*`` entry live at that age. Baseline entries
     overlap on nine plates; the narrowest validity window wins (it is the more
     specific authored motion), then the lowest palette index, so the choice is
     deterministic and independent of dict ordering.
  4. The remaining regional native entries (``barents-shelf-*``, ``cao-shelf-*``,
     ``panama-observed-land-*``) own an age only where no baseline ``plate-*``
     entry is live at it.
  5. ``correction-plate-*`` entries never own an outline segment. They carry
     regional *material* corrections layered onto a plate, not the plate's rigid
     motion, and a line overlay has no material to correct.
     ``country-present-reference-*`` is likewise excluded: it is the exact-present
     identity entry owned by ``apply_cao_modern_country_reference.py``.
  6. A segment whose plate has no live entry at some age of its lifetime has no
     single authored motion there; it is emitted as ``unsupported`` and reaches
     ``apply_cao_country_segment_bridge.py`` like every other unsupported
     segment.

Segments over a replaced basement domain
----------------------------------------
A ``domain-fragment-replacement`` correction suppresses a native Cao static
fragment and replaces it with mapped basement-domain tiles. A country segment
that inherits the suppressed fragment's motion must resolve to one of those
tiles: ``drop_over_replaced_domain`` measures the worst nearest-tile distance
along the segment and drops the segment from the batch when it exceeds
``MAXIMUM_DOMAIN_MATCH_KM``. Such a segment lies over ground the replacement
declares unmapped, so it is not drawn at any age rather than carried on a
domain it does not touch, and it is never remapped onto a farther tile. The
dropped segments are counted per country chart in ``country-reference.json``
and in the emitted material-correction catalog. The tolerance is shared with
``emit_cao_material_corrections.py`` through ``cao_domain``, so the batch can
never own a segment that emitter would refuse to bind.

Run ``--self-test`` to exercise each rule against a deliberate mutation.
"""

from __future__ import annotations
import hashlib, io, json, math, struct, zipfile
from pathlib import Path
from cao_domain import (CAO_SOURCE_OLDEST_MA, CAO_SOURCE_YOUNGEST_MA,
                        MAXIMUM_DOMAIN_MATCH_KM, segment_domain_match)
import pygplates
import shapefile
import cao_package_intern as package_intern
import apply_cao_native_triangulation_repair as native_recovery

ROOT = Path(__file__).resolve().parents[2]
STAGE = ROOT.parent / "EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1"
# Natural Earth admin-0 at 1:50m, the same pinned archive `regional_observed_land_omission_correction.py`
# verifies (`NATURAL_EARTH_SHA256`, source id `natural-earth-countries-50m`). 1:110m was dropped because
# its 289 rings omit the island and fjord detail the overlay is read for.
SOURCE = (ROOT.parent / "EarthHistory-data/palaeomap-study/verification/regional-iceland-correction-v1"
          / "source-inputs/ne_50m_admin_0_countries.zip")
SOURCE_ID = "natural-earth-countries-50m"
SOURCE_SHA = "5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139"
SOURCE_LAYER = "ne_50m_admin_0_countries"
# Digest of the deterministic shapefile -> GeoJSON conversion below, before simplification. Pinned so a
# pyshp or archive change that silently reshapes the rings fails here instead of in the shipped artifact.
SOURCE_GEOJSON_SHA = "7d8ccd5ebabcc26de52b0342be0280987c863d27ec6b3b4a940f064521594a51"
# Douglas-Peucker pre-simplification, degrees of lon/lat. 1:50m ships 97,995 subdivided segments raw,
# which costs 18.7 MiB of resident GPU quad geometry; 0.02 deg is the finest measured tolerance holding
# GPU quads under 10 MiB (9.74 MiB at 51,048 segments) and projected dist under 48.5 MiB (45.40 MiB).
SIMPLIFY_TOLERANCE_DEG = 0.02
DEFAULT_OUT = STAGE / "full-package"
OUT = DEFAULT_OUT
MODEL = ROOT.parent / "EarthHistory-data/palaeomap-study/plates/extracted/cao2024-v2.4/1.8Ga_model_GSF"
MAX_EDGE = math.radians(1)


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def asset(path): return {"url": path.name, "bytes": path.stat().st_size, "sha256": sha(path)}
def unit(v):
    n = math.sqrt(sum(x*x for x in v)); return tuple(x/n for x in v)
def dot(a,b): return sum(x*y for x,y in zip(a,b))
def angle(a,b): return math.acos(max(-1,min(1,dot(a,b))))
def xyz(lon,lat):
    a,b=math.radians(lat),math.radians(lon);return math.cos(a)*math.cos(b),math.cos(a)*math.sin(b),math.sin(a)
def slerp(a,b,t):
    theta=angle(a,b)
    if theta < 1e-12:return a
    return unit(tuple(math.sin((1-t)*theta)/math.sin(theta)*x+math.sin(t*theta)/math.sin(theta)*y for x,y in zip(a,b)))


def f32(vector):
    """The direction the batch actually stores, so the drop decision is the one
    ``emit_cao_material_corrections.py`` re-measures on the emitted asset."""
    return struct.unpack("<fff", struct.pack("<fff", *vector))


def replacement_domain_features():
    """Basement-domain tiles keyed by the Cao source feature they replace."""
    domains = {}
    for path in sorted((ROOT / "data/corrections").glob("*/native-overrides.json")):
        document = json.loads(path.read_text())
        for override in document.get("nativeChartOverrides", []):
            if override.get("operation") != "domain-fragment-replacement":
                continue
            geojson = json.loads((path.parent / override["replacementAsset"]["path"]).read_text())
            domains.setdefault(override["nativeTarget"]["sourceFeatureId"], []).extend(geojson["features"])
    return domains


def drop_over_replaced_domain(left, right, features):
    """``(nearest_km, domain_ids, drop)`` for a segment over a replaced fragment."""
    nearest_km, domain_ids = segment_domain_match(f32(left), f32(right), features)
    return nearest_km, domain_ids, nearest_km > MAXIMUM_DOMAIN_MATCH_KM


# Entry-id prefixes that decide outline precedence. See the module docstring.
RESTORATION_PREFIX = "restoration-"
RECOVERY_PREFIX = "native-recovery-"
BASELINE_PREFIX = "plate-"
EXCLUDED_PREFIXES = ("correction-plate-", "country-present-reference-")


def recovery_tiles(plate, validity, entries):
    """Tile a chart on a recovered plate from its recovery entries alone, or ``None``.

    A recovery plate's source geometry was replaced by the native triangulation, so
    every chart on it follows the recovery entries and never falls back to the
    plate's baseline motion. The recovery windows are authored with declared
    sub-microsecond rotation discontinuities (``SOURCE_DISCONTINUITY_GAPS``), which
    are not motion the chart is missing: they are seams in the source model, carried
    on the chart as ``motionSupportGaps`` by ``recovery_support_gaps`` below.
    ``apply_cao_native_triangulation_repair`` owns both the intervals and the
    clipping, so they are taken from it rather than restated here. Returns ``None``
    where the recovery entries do not reach the whole lifetime -- the chart is then
    unsupported (rule 6) rather than bound to a motion the recovery replaced.
    """
    youngest, oldest = validity
    rows = native_recovery.native_bindings({"id": None, "entries": entries}, plate, youngest, oldest)
    try:
        native_recovery.validate_binding_coverage(rows, plate, youngest, oldest)
    except native_recovery.BuildError:
        return None
    by_id = {entry["entryId"]: entry for entry in entries}
    return [(by_id[row["entryId"]], row["validTimeMa"]["youngest"], row["validTimeMa"]["oldest"],
             "recovery") for row in rows]


def recovery_support_gaps(plate, validity):
    """The declared source-seam gaps a recovery-bound chart carries, newest first."""
    return native_recovery.motion_support_gaps(plate, validity[0], validity[1])


NORTH_SEA_CONTRACT = ROOT / "data/corrections/north-sea-restoration/restoration-contract.json"
# `fixed_binding` off: no plate id is None, so the Tornquist rule can never match. Used for
# the sub-window tail of a 330 chart and by the self-test.
NO_FIXED_BINDING = (None, None, None)
_north_sea_fixed_binding = None
_north_sea_country_codes = None


def north_sea_restoration_country_codes():
    """The modern countries whose outlines ride the restored UK block."""
    global _north_sea_country_codes
    if _north_sea_country_codes is None:
        contract = json.loads(NORTH_SEA_CONTRACT.read_text())
        _north_sea_country_codes = frozenset(contract["chartSelection"]["countryCodes"])
    return _north_sea_country_codes


def north_sea_fixed_binding():
    """The 0.1.10 contract's ``fixedBinding`` tier: which plate follows which, from when.

    Returns ``(tornquistPlateId, referencePlateId, windowYoungestMa)``. Read from the
    tracked contract rather than restated, so a change to the window or the reference
    plate reaches the outline charts and the native charts together.
    """
    global _north_sea_fixed_binding
    if _north_sea_fixed_binding is None:
        contract = json.loads(NORTH_SEA_CONTRACT.read_text())
        _north_sea_fixed_binding = (contract["tornquistPlateId"], contract["fixedBinding"]["plateId"],
                                    contract["windowMa"]["youngest"])
    return _north_sea_fixed_binding


def reference_native_tiles(reference, youngest, oldest, entries):
    """Gap-free native (``plate-*``) tiles of `reference` covering [youngest, oldest].

    The same partition ``apply_north_sea_restoration.native_partition`` binds onto a
    Baltica-fixed chart, so an outline chart and the native chart over it carry the
    identical entry ids and knots. ``None`` where the reference plate has no single
    native entry at some age: the chart is then unsupported (rule 6) rather than bound
    to a motion the contract does not name.
    """
    live = sorted((entry for entry in entries
                   if entry["plateId"] == reference and entry["entryId"].startswith(BASELINE_PREFIX)),
                  key=lambda entry: (entry["youngestAgeMa"], entry["oldestAgeMa"]))
    tiles, cursor = [], youngest
    while cursor < oldest:
        match = [entry for entry in live if entry["youngestAgeMa"] <= cursor < entry["oldestAgeMa"]]
        if len(match) != 1: return None
        nxt = min(match[0]["oldestAgeMa"], oldest)
        tiles.append((match[0], cursor, nxt, "north-sea-fixed"))
        cursor = nxt
    return tiles or None


def select_outline_entry(plate, validity, entries, fixed_binding=None, allow_restoration=True):
    """Tile a country-outline chart's lifetime with one motion-palette entry per age.

    ``entries`` is every palette entry, in palette order; ``validity`` is the chart's
    ``(youngest, oldest)`` lifetime in Ma. The runtime validator demands exactly one
    live binding at every age the chart is alive, so this returns a gap-free,
    non-overlapping partition ``[(entry, youngest, oldest, rule), ...]`` covering the
    whole lifetime, choosing per age by the precedence in the module docstring.
    Returns ``None`` when some age of the lifetime has no entry at all, in which case
    the caller emits the segment as unsupported (rule 6). ``rule`` names the tier that
    made each choice, so the summary can count charts and bindings per rule.
    ``fixed_binding`` overrides the North Sea contract's ``(tornquist, reference,
    windowYoungestMa)`` tuple; ``NO_FIXED_BINDING`` turns that tier off.
    ``allow_restoration`` is false for a country outside the restoration contract's
    country codes: its fragments never take a restoration entry (rule 1).
    """
    youngest, oldest = validity
    tornquist, reference, window_start = fixed_binding if fixed_binding is not None else north_sea_fixed_binding()
    if plate == tornquist and oldest > window_start:
        # Rule 2: the Tornquist Block follows Baltica from the window start. Below it the
        # chart keeps its own plate's motion, chosen by the tiers below with this rule off.
        head = []
        if youngest < window_start:
            head = select_outline_entry(plate, (youngest, window_start), entries, fixed_binding=NO_FIXED_BINDING)
            if head is None: return None
        tail = reference_native_tiles(reference, max(youngest, window_start), oldest, entries)
        return None if tail is None else head + tail
    excluded = EXCLUDED_PREFIXES if allow_restoration else EXCLUDED_PREFIXES + (RESTORATION_PREFIX,)
    live = [(index, entry) for index, entry in enumerate(entries)
            if entry["plateId"] == plate and not entry["entryId"].startswith(excluded)]
    if (any(entry["entryId"].startswith(RECOVERY_PREFIX) for _, entry in live)
            and not any(entry["entryId"].startswith(RESTORATION_PREFIX) for _, entry in live)):
        return recovery_tiles(plate, validity, entries)

    def owner(age, instant=False):
        """The one entry that owns this plate's outline motion at `age`, or None.

        A zero-length palette entry (the Panama observed-land entries are authored at
        exactly 0 Ma) can only own a zero-length lifetime: binding an interval to it
        would reach past the entry's own window. So it is a candidate only for an
        instantaneous chart, never for a tile of a live interval.
        """
        matches = [row for row in live
                   if row[1]["youngestAgeMa"] <= age < row[1]["oldestAgeMa"]
                   or (instant and row[1]["youngestAgeMa"] == row[1]["oldestAgeMa"] == age)]
        for rule, test in (("restoration", lambda e: e["entryId"].startswith(RESTORATION_PREFIX)),
                           ("baseline", lambda e: e["entryId"].startswith(BASELINE_PREFIX)),
                           ("native", lambda e: True)):
            tier = [row for row in matches if test(row[1])]
            # Narrowest authored window first, then palette order. Both keys are total
            # and data-independent, so the pick never depends on dict ordering.
            if tier: return min(tier, key=lambda row: (row[1]["oldestAgeMa"] - row[1]["youngestAgeMa"],
                                                       row[0]))[1], rule
        return None

    if youngest == oldest:
        chosen = owner(youngest, instant=True)
        return None if chosen is None else [(chosen[0], youngest, oldest, chosen[1])]
    # The owner can only change where some entry's window starts or ends, so the
    # candidate boundaries are exactly those ages clipped to the lifetime.
    boundaries = sorted({youngest, oldest} | {value for _, entry in live
                                              for value in (entry["youngestAgeMa"], entry["oldestAgeMa"])
                                              if youngest < value < oldest})
    tiles = []
    for start, end in zip(boundaries, boundaries[1:]):
        chosen = owner(start)
        if chosen is None: return None
        entry, rule = chosen
        if tiles and tiles[-1][0] is entry: tiles[-1] = (entry, tiles[-1][1], end, rule)
        else: tiles.append((entry, start, end, rule))
    return tiles or None


def _self_test():
    """Prove each precedence rule by mutating the palette it selects from."""
    def entry(entry_id, plate, youngest, oldest):
        return {"entryId": entry_id, "plateId": plate, "youngestAgeMa": youngest, "oldestAgeMa": oldest}
    def picked(plate, window, entries, fixed_binding=NO_FIXED_BINDING):
        tiles = select_outline_entry(plate, window, entries, fixed_binding=fixed_binding)
        return None if tiles is None else [(tile[0]["entryId"], tile[1], tile[2], tile[3]) for tile in tiles]
    baseline = entry("plate-303-0-1800", 303, 0.0, 1800.0)
    narrow = entry("plate-303-0-600", 303, 0.0, 600.0)
    restoration = entry("restoration-north-sea-plate-303-130-600", 303, 130.0, 600.0)
    correction = entry("correction-plate-303-410-540", 303, 410.0, 540.0)
    recovery = entry("native-recovery-plate-303-0-600", 303, 0.0, 600.0)
    native = entry("cao-shelf-plate-303-0-600", 303, 0.0, 600.0)
    present = entry("country-present-reference-plate-303-identity", 303, 0.0, 0.0)
    window = (200.0, 400.0)

    # Rule 1: restoration owns the ages it covers; drop it and rule 2 takes the whole window.
    assert picked(303, window, [baseline, restoration]) == [
        (restoration["entryId"], 200.0, 400.0, "restoration")]
    assert picked(303, window, [baseline]) == [(baseline["entryId"], 200.0, 400.0, "baseline")]
    # ... and only those ages: outside its window the baseline owns the rest of the lifetime.
    assert picked(303, (0.0, 200.0), [baseline, restoration]) == [
        (baseline["entryId"], 0.0, 130.0, "baseline"), (restoration["entryId"], 130.0, 200.0, "restoration")]
    # ... and a recovery entry owns its plate's charts the same way: a chart on a
    # recovered plate follows the recovery entry even where a baseline `plate-*`
    # entry covers the same age, because a recovery plate never falls back to native
    # motion. This is the Australia native-triangulation source contract.
    assert picked(303, window, [baseline, recovery]) == [
        (recovery["entryId"], 200.0, 400.0, "recovery")]
    assert picked(303, window, [baseline, narrow, recovery]) == [
        (recovery["entryId"], 200.0, 400.0, "recovery")]
    # The two tiers are not authored on any shared plate; were one ever added,
    # restoration wins rather than the choice depending on palette order.
    assert picked(303, window, [recovery, restoration]) == [
        (restoration["entryId"], 200.0, 400.0, "restoration")]
    assert picked(303, window, [restoration, recovery]) == [
        (restoration["entryId"], 200.0, 400.0, "restoration")]
    # ... and the real plate-626 recovery windows, whose two declared rotation seams
    # are sub-microsecond gaps inside the recovery cover. A chart living across them
    # stays on recovery motion and carries the seams as support gaps: the baseline
    # `plate-626-*` entry never takes the seam tiles, which is exactly what
    # `apply_cao_native_triangulation_repair` refuses in the shipped package.
    plate626 = [entry("plate-626-0-130", 626, 0.0, 130.0)] + [
        entry(f"native-recovery-plate-626-{low:.6g}-{high:.6g}", 626, low, high)
        for low, high in native_recovery.RECOVERY_MOTION_INTERVALS[626]]
    assert picked(626, (0.0, 150.0), plate626) == [
        ("native-recovery-plate-626-0-79.1", 0.0, 79.1, "recovery"),
        ("native-recovery-plate-626-79.1-120", 79.100001, 119.999999, "recovery"),
        ("native-recovery-plate-626-120-130", 120.0, 130.0, "recovery"),
        ("native-recovery-plate-626-130-505", 130.0, 150.0, "recovery")]
    assert [row["validTimeMa"] for row in recovery_support_gaps(626, (0.0, 150.0))] == [
        {"youngest": 79.1, "oldest": 79.100001}, {"youngest": 119.999999, "oldest": 120.0}]
    # Past the recovery cover there is no fallback: the chart is unsupported rather
    # than bound to the baseline motion the recovery replaced.
    assert picked(626, (0.0, 600.0), plate626) is None
    assert recovery_support_gaps(303, (0.0, 150.0)) == []

    # ... and only for the contract's countries: a fragment of another country on the
    # same block plate lies east of the Central Graben cut and keeps the plate's native
    # motion, which is what `allow_restoration=False` selects.
    assert [(t[0]["entryId"], t[3]) for t in select_outline_entry(
        303, window, [baseline, restoration], fixed_binding=NO_FIXED_BINDING,
        allow_restoration=False)] == [(baseline["entryId"], "baseline")]
    assert "gbr" in north_sea_restoration_country_codes() and "pol" not in north_sea_restoration_country_codes()

    # Rule 2: a Tornquist Block (330) chart follows the reference plate's native motion
    # from the window start and its own plate's below it -- the contract's `fixedBinding`
    # tier, the same partition `apply_north_sea_restoration.py` binds onto the native 330
    # charts. Without it the chart rides the dropped 0.59 degree Tornquist stage.
    tornquist = (330, 302, 130.0)
    plate330 = [entry("plate-330-0-130", 330, 0.0, 130.0), entry("plate-330-130-505", 330, 130.0, 505.0),
                entry("plate-330-505-560", 330, 505.0, 560.0), entry("plate-330-560-600", 330, 560.0, 600.0),
                entry("plate-302-0-1800", 302, 0.0, 1800.0)]
    assert picked(330, (0.0, 600.0), plate330, tornquist) == [
        ("plate-330-0-130", 0.0, 130.0, "baseline"), ("plate-302-0-1800", 130.0, 600.0, "north-sea-fixed")]
    # ... exactly what the real contract says, read from the tracked file.
    assert north_sea_fixed_binding() == tornquist
    assert picked(330, (0.0, 600.0), plate330, None) == picked(330, (0.0, 600.0), plate330, tornquist)
    # Deliberate mutation: with the tier off the chart takes its own plate's four native
    # tiles, which is the regression this rule exists to refuse.
    assert picked(330, (0.0, 600.0), plate330) == [
        ("plate-330-0-130", 0.0, 130.0, "baseline"), ("plate-330-130-505", 130.0, 505.0, "baseline"),
        ("plate-330-505-560", 505.0, 560.0, "baseline"), ("plate-330-560-600", 560.0, 600.0, "baseline")]
    # A chart younger than the window start never reaches the reference plate ...
    assert picked(330, (0.0, 100.0), plate330, tornquist) == [("plate-330-0-130", 0.0, 100.0, "baseline")]
    # ... and one entirely inside the window is on the reference plate alone.
    assert picked(330, (200.0, 400.0), plate330, tornquist) == [
        ("plate-302-0-1800", 200.0, 400.0, "north-sea-fixed")]
    # The tier owns only its plate: a chart on the reference plate itself is unaffected.
    assert picked(302, (0.0, 600.0), plate330, tornquist) == [("plate-302-0-1800", 0.0, 600.0, "baseline")]
    # Where the reference plate has no native entry the 330 chart is unsupported (rule 6)
    # rather than silently falling back to the Tornquist motion the contract drops.
    assert picked(330, (0.0, 600.0), plate330[:-1], tornquist) is None

    # Rule 3: among overlapping baselines the narrowest window wins, then palette order.
    assert picked(303, window, [baseline, narrow]) == [(narrow["entryId"], 200.0, 400.0, "baseline")]
    assert picked(303, window, [narrow, baseline]) == [(narrow["entryId"], 200.0, 400.0, "baseline")]
    tie = entry("plate-303-0-600-b", 303, 0.0, 600.0)
    assert picked(303, window, [narrow, tie]) == [(narrow["entryId"], 200.0, 400.0, "baseline")]
    assert picked(303, window, [tie, narrow]) == [(tie["entryId"], 200.0, 400.0, "baseline")]
    # ... and where the narrow one ends the wider one continues, with no gap and no overlap.
    assert picked(303, (400.0, 800.0), [baseline, narrow]) == [
        (narrow["entryId"], 400.0, 600.0, "baseline"), (baseline["entryId"], 600.0, 800.0, "baseline")]

    # Rule 4: a remaining regional native entry owns the segment only with no
    # baseline present (a recovery entry, tier 1 above, does not wait for that).
    assert picked(303, window, [native]) == [(native["entryId"], 200.0, 400.0, "native")]
    assert picked(303, window, [native, baseline]) == [(baseline["entryId"], 200.0, 400.0, "baseline")]

    # Rule 5: corrections and the exact-present identity never own an outline.
    assert picked(303, window, [correction]) is None
    assert picked(303, (0.0, 0.0), [present]) is None
    assert picked(303, window, [correction, baseline]) == [(baseline["entryId"], 200.0, 400.0, "baseline")]

    # ... and a zero-length entry owns only a zero-length lifetime, never an interval.
    instant = entry("panama-observed-land-plate-303-0", 303, 0.0, 0.0)
    assert picked(303, (0.0, 0.0), [instant]) == [(instant["entryId"], 0.0, 0.0, "native")]
    assert picked(303, (0.0, 5.0), [instant]) is None

    # Rule 6: an age with no live entry makes the whole segment unsupported.
    assert picked(303, window, []) is None
    assert picked(303, window, [entry("plate-303-0-300", 303, 0.0, 300.0)]) is None
    assert picked(999, window, [baseline]) is None

    # Replaced-domain drop: the tolerance is a hard edge, and a segment past it is
    # dropped rather than remapped onto the tile it failed to reach.
    domain = {"id": "domain-a", "geometry": {"type": "Polygon", "coordinates": [
        [[-1.0, 0.0], [1.0, 0.0], [1.0, 0.02], [-1.0, 0.02], [-1.0, 0.0]]]}}
    far = {"id": "domain-b", "geometry": {"type": "Polygon", "coordinates": [
        [[-1.0, 5.0], [1.0, 5.0], [1.0, 5.02], [-1.0, 5.02], [-1.0, 5.0]]]}}
    def probe(kilometres):
        latitude = -kilometres / 111.195
        return drop_over_replaced_domain(xyz(-0.01, latitude), xyz(0.01, latitude), [domain, far])
    inside_km, inside_ids, inside_drop = probe(11.999)
    assert not inside_drop and inside_ids == ["domain-a"] and inside_km <= MAXIMUM_DOMAIN_MATCH_KM, inside_km
    outside_km, outside_ids, outside_drop = probe(12.001)
    # Dropped, and the nearest tile is still domain-a: the rule never reaches past
    # the tolerance for a substitute domain.
    assert outside_drop and outside_ids == ["domain-a"] and outside_km > MAXIMUM_DOMAIN_MATCH_KM, outside_km
    # Deliberate mutation: widening the tolerance to the measured distance would
    # keep the segment, which is what the fixed 12 km contract refuses.
    assert outside_km < 12.01, outside_km
    print(json.dumps({"selfTest": "ok", "rules": 6,
                      "domainDropKm": {"kept": round(inside_km, 6), "dropped": round(outside_km, 6)}}))


def rings(geometry):
    if geometry["type"] == "Polygon": yield from geometry["coordinates"]
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]: yield from polygon


def convert():
    """Shapefile -> GeoJSON, in archive record order, with only the identifier fields the emitter reads."""
    with zipfile.ZipFile(SOURCE) as archive:
        parts = {ext: io.BytesIO(archive.read(f"{SOURCE_LAYER}{ext}")) for ext in (".shp", ".dbf", ".shx")}
    reader = shapefile.Reader(shp=parts[".shp"], dbf=parts[".dbf"], shx=parts[".shx"])
    features = []
    for record in reader.iterShapeRecords():
        geometry = record.shape.__geo_interface__
        fields = record.record.as_dict()
        features.append({"type": "Feature",
                         "properties": {key: fields.get(key) for key in ("ADM0_A3", "ISO_A3", "NE_ID", "NAME")},
                         "geometry": {"type": geometry["type"],
                                      "coordinates": json.loads(json.dumps(geometry["coordinates"]))}})
    return {"type": "FeatureCollection", "features": features}


def douglas_peucker(points, tolerance):
    """Iterative Douglas-Peucker on planar lon/lat; the ring closure is restored by the caller."""
    if len(points) < 3: return points
    keep = [False]*len(points); keep[0] = keep[-1] = True; stack = [(0, len(points)-1)]
    while stack:
        first, last = stack.pop()
        if last <= first+1: continue
        x1, y1 = points[first]; x2, y2 = points[last]
        dx, dy = x2-x1, y2-y1; denominator = dx*dx+dy*dy
        best = -1.0; split = -1
        for index in range(first+1, last):
            x0, y0 = points[index]
            distance = (math.hypot(x0-x1, y0-y1) if denominator == 0
                        else abs(dy*x0-dx*y0+x2*y1-y2*x1)/math.sqrt(denominator))
            if distance > best: best = distance; split = index
        if best > tolerance:
            keep[split] = True; stack.append((first, split)); stack.append((split, last))
    return [point for point, kept in zip(points, keep) if kept]


def simplify(geometry, tolerance):
    """Simplify every ring; drop rings that collapse below a triangle and features left with no ring."""
    def ring(coordinates):
        simplified = douglas_peucker([(c[0], c[1]) for c in coordinates], tolerance)
        if len(simplified) < 4: return None
        if simplified[0] != simplified[-1]: simplified.append(simplified[0])
        return [list(c) for c in simplified]
    if geometry["type"] == "Polygon":
        kept = [row for row in (ring(x) for x in geometry["coordinates"]) if row]
        return {"type": "Polygon", "coordinates": kept} if kept else None
    polygons = []
    for polygon in geometry["coordinates"]:
        kept = [row for row in (ring(x) for x in polygon) if row]
        if kept: polygons.append(kept)
    return {"type": "MultiPolygon", "coordinates": polygons} if polygons else None


def load_source():
    collection = convert()
    digest = hashlib.sha256(json.dumps(collection, separators=(",", ":")).encode()).hexdigest()
    assert digest == SOURCE_GEOJSON_SHA, f"converted source digest {digest} != pinned {SOURCE_GEOJSON_SHA}"
    features = []
    for feature in collection["features"]:
        geometry = simplify(feature["geometry"], SIMPLIFY_TOLERANCE_DEG)
        if geometry: features.append({**feature, "geometry": geometry})
    return {"type": "FeatureCollection", "features": features}


def remap_batch_chart_indices(out: Path, core: dict, retained: list[dict]) -> dict:
    """Follow the country-chart rebuild in every chart-indexed native batch.

    Dropping the released country charts and appending the re-emitted ones at the
    tail renumbers every chart that used to sit after them. `batch-land.ehgb` and
    `batch-shelf.ehgb` bake an absolute core chart index per vertex, so they are
    rewritten through the same old-index -> new-index permutation, matched by
    chart id. Country charts carry no surface geometry and so never appear in a
    batch; a batch index that does not survive the rebuild is a bug, not a drop,
    and raises here. Checkpoints address batches by id and ownership tiles by
    ring, so neither carries a chart index to follow.
    """
    moved = {index: retained.index(row) for index, row in enumerate(core["charts"])
             if row in retained}
    permutation = {}
    for old_index, row in enumerate(core["charts"]):
        new_index = moved.get(old_index)
        if new_index is not None and new_index != old_index:
            permutation[old_index] = new_index
    touched = {}
    for name in ("batch-land.ehgb", "batch-shelf.ehgb"):
        path = out / name
        if not path.is_file():
            continue
        data = bytearray(path.read_bytes())
        assert data[:4] == b"EHGB", f"{name} is not an EHGB batch"
        vertices, _triangles = struct.unpack_from("<II", data, 8)
        chart_offset = 32 + 12 * vertices + 4 * vertices
        rewritten = 0
        for vertex in range(vertices):
            position = chart_offset + 4 * vertex
            (value,) = struct.unpack_from("<I", data, position)
            if value >= len(core["charts"]):
                raise AssertionError(f"{name} vertex {vertex} indexes chart {value} outside the core")
            if value not in moved:
                raise AssertionError(f"{name} vertex {vertex} indexes retired chart {value}")
            if value in permutation:
                struct.pack_into("<I", data, position, permutation[value])
                rewritten += 1
        if rewritten:
            path.write_bytes(data)
            # The core records each batch's bytes and digest, and every downstream
            # validator re-derives them from the file. A rewritten batch whose
            # recorded identity still names the pre-remap bytes is a stale package,
            # so the identity is re-recorded here, where the bytes changed.
            batch = next(row for row in core["spatialBatches"]
                         if row["geometryAsset"]["url"] == name)
            batch["geometryAsset"] = {**batch["geometryAsset"], **asset(path)}
        touched[name] = rewritten
    return touched


def main(out: Path | None = None):
    global OUT
    OUT = Path(out) if out else DEFAULT_OUT
    assert sha(SOURCE) == SOURCE_SHA
    core_path=OUT/"core.json";core=package_intern.read_package_json(core_path);palette=json.loads((OUT/"motion-palette.json").read_text())
    static=list(pygplates.FeatureCollection(str(MODEL/"static_polygons.gpmlz")))
    polygons=[]
    for feature in static:
        if not feature.is_valid_at_time(0):continue
        plate=feature.get_reconstruction_plate_id(None)
        if plate is None:continue
        oldest, youngest = feature.get_valid_time()
        validity = (max(0.0, youngest if math.isfinite(youngest) else 0.0),
                    min(CAO_SOURCE_OLDEST_MA, oldest if math.isfinite(oldest) else CAO_SOURCE_OLDEST_MA))
        for geometry in feature.get_all_geometries():
            if isinstance(geometry,pygplates.PolygonOnSphere):polygons.append((plate,str(feature.get_feature_id()),validity,geometry))
    selections={}
    restoration_codes=north_sea_restoration_country_codes()
    retained = [chart for chart in core["charts"] if chart["role"] != "country-reference"]
    batch_remap = remap_batch_chart_indices(OUT, core, retained)
    core["charts"] = retained
    core.pop("lineBatches", None)
    base_chart_index=len(core["charts"])
    vertices=[];indices=[];vertex_charts=[];chart_rows={};metadata=[];unsupported=[];dropped=[]
    replacement_domains=replacement_domain_features()
    source=load_source()
    for feature_index,feature in enumerate(source["features"]):
        props=feature["properties"]
        identifiers=[props.get("ADM0_A3"),props.get("ISO_A3"),props.get("NE_ID"),feature_index]
        country=str(next(value for value in identifiers if value not in (None,"",-99,"-99"))).lower()
        name=props.get("NAME") or country
        for part,ring in enumerate(rings(feature["geometry"])):
            for edge,(start,end) in enumerate(zip(ring,ring[1:])):
                a,b=xyz(*start),xyz(*end);count=max(1,math.ceil(angle(a,b)/MAX_EDGE))
                for subdivision in range(count):
                    left=slerp(a,b,subdivision/count);right=slerp(a,b,(subdivision+1)/count);mid=slerp(left,right,.5)
                    probes=[pygplates.PointOnSphere(left),pygplates.PointOnSphere(mid),pygplates.PointOnSphere(right)]
                    matches=[[(plate,fid,validity) for plate,fid,validity,polygon in polygons
                              if polygon.is_point_in_polygon(point)] for point in probes]
                    plate_sets=[{plate for plate,_,_ in rows} for rows in matches]
                    common_plates=set.intersection(*plate_sets) if plate_sets else set()
                    plates=sorted(common_plates)
                    common_features=(set((plate,fid,validity) for plate,fid,validity in matches[0])
                                     .intersection(*[set(rows) for rows in matches[1:]])) if matches else set()
                    candidates=sorted(row for row in common_features if row[0] in common_plates)
                    if len(plates)!=1 or not candidates:
                        unsupported.append({"countryId":country,"part":part,"edge":edge,"subdivision":subdivision,
                                            "candidatePlateIds":plates,"reason":"ambiguous-static-fragment" if len(plates)>1 else "unknown-static-fragment"})
                        continue
                    plate,fid,validity=candidates[0]
                    # Restoration is a country-scoped tier: only the contract's countries
                    # ride the restored block, so the cache key carries that decision.
                    restored=country in restoration_codes
                    if (plate,validity,restored) not in selections:
                        selections[(plate,validity,restored)]=select_outline_entry(
                            plate,validity,palette["entries"],allow_restoration=restored)
                    selection=selections[(plate,validity,restored)]
                    if selection is None:
                        # Rule 6: no palette entry covers this fragment's whole lifetime, so the
                        # segment has no single authored motion and goes to the bridge.
                        unsupported.append({"countryId":country,"part":part,"edge":edge,"subdivision":subdivision,
                                            "candidatePlateIds":plates,"reason":"no-covering-motion-entry"})
                        continue
                    domains=replacement_domains.get(fid)
                    if domains is not None:
                        nearest_km,domain_ids,drop=drop_over_replaced_domain(left,right,domains)
                        if drop:
                            # Over ground the replacement declares unmapped: not drawn at any age.
                            suffix=f"{validity[0]:.6g}-{validity[1]:.6g}"
                            dropped.append({"countryId":country,"part":part,"edge":edge,"subdivision":subdivision,
                                            "chartId":f"country:{country}:plate:{plate}:fragment:{fid}:{suffix}",
                                            "nearestDomainKm":round(nearest_km,6),
                                            "reason":"beyond-replaced-domain-tolerance"})
                            continue
                    key=(country,plate,fid,validity)
                    if key not in chart_rows:
                        chart_rows[key]={"countryId":country,"name":name,"plateId":plate,"sourceFeatureIds":[fid],
                                         "validity":validity,"tiles":selection}
                    chart_index=base_chart_index+list(chart_rows).index(key)
                    offset=len(vertices);vertices.extend((left,right));vertex_charts.extend((chart_index,chart_index));indices.extend((offset,offset+1))
                    metadata.append({"countryId":country,"sourcePart":part,"sourceEdge":edge,"chartIndex":chart_index,
                                     "segmentOffset":len(indices)//2-1,"segmentCount":1})
    data=bytearray(32+16*len(vertices)+4*len(indices));data[:4]=b"EHGL"
    struct.pack_into("<HHIIIIII",data,4,2,32,len(vertices),len(indices)//2,0,0,0,0)
    offset=32
    for v in vertices:struct.pack_into("<fff",data,offset,*v);offset+=12
    for value in vertex_charts:struct.pack_into("<I",data,offset,value);offset+=4
    for value in indices:struct.pack_into("<I",data,offset,value);offset+=4
    path=OUT/"country-reference.ehgl";path.write_bytes(data)
    catalog={"schemaVersion":2,"packageId":core["packageId"],"revision":core["revision"],
             "geometryReferenceAgeMa":0,"sourceId":SOURCE_ID,"sourceSha256":SOURCE_SHA,
             "segments":metadata,"unsupported":unsupported,"droppedDomainSegments":dropped,
             "geometryAsset":asset(path)}
    (OUT/"country-reference.json").write_text(json.dumps(catalog,separators=(",",":"))+"\n")
    charts=[]
    for (country,plate,_fid,validity),row in chart_rows.items():
        # Gap-free and non-overlapping by construction: `select_outline_entry` tiles the
        # lifetime with exactly one entry per age, which is what the runtime validator
        # demands of a chart's motion bindings.
        bindings=[{"paletteId":palette["id"],"entryId":entry["entryId"],
                   "validTimeMa":{"youngest":start,"oldest":end}} for entry,start,end,_rule in row["tiles"]]
        # A recovery-bound chart is gap-free except at the source model's own declared
        # rotation seams, which it carries as support gaps rather than as missing motion.
        gaps=recovery_support_gaps(plate,validity) if row["tiles"][0][3]=="recovery" else []
        suffix=f"{validity[0]:.6g}-{validity[1]:.6g}"
        charts.append({"kind":"rigid","role":"country-reference","chartId":f"country:{country}:plate:{plate}:fragment:{_fid}:{suffix}",
                       "chartRevision":core["revision"],"materialId":f"country:{country}","fragmentOrCohortId":f"country:{country}:cao-fragment:{_fid}:{suffix}",
                       "lifecycle":{"validTimeMa":{"youngest":validity[0],"oldest":validity[1]}},"geometryReferenceAgeMa":0,"motionBindings":bindings,
                       **({"motionSupportGaps":gaps} if gaps else {}),
                       "sourceFeatureIds":[country,*row["sourceFeatureIds"]],"sourceFeatureTypes":["NaturalEarthAdmin0Reference","CaoStaticPolygonBinding"],
                       "evidence":{"status":"derived-overlay","sourceIds":[SOURCE_ID,"doi:10.5281/zenodo.13628813"],
                                   "limitations":["modern-country locator only; not historical borders","1-degree endpoint-and-midpoint static-fragment binding approximation","segments without consistent Cao static-fragment ownership are omitted"]},
                       "surfaceEvidence":{"kind":"unknown","reason":"line overlay has no surface-height evidence"}})
    dropped_by_chart={}
    for row in dropped:dropped_by_chart[row["chartId"]]=dropped_by_chart.get(row["chartId"],0)+1
    report={"charts":charts,"lineBatch":{"batchId":"country-reference","vertexCount":len(vertices),"segmentCount":len(indices)//2,
                                           "geometryAsset":asset(path),"encoding":"ehgl-v2-f32xyz-u32"},
            "catalogAsset":asset(OUT/"country-reference.json"),"unsupportedSegmentCount":len(unsupported),
            "countrySegmentsDropped":dropped_by_chart}
    (OUT/"country-reference-extension.json").write_text(json.dumps(report,separators=(",",":"))+"\n")
    core["charts"].extend(charts)
    core["lineBatches"]=[report["lineBatch"]]
    core_path.write_text(json.dumps(core,separators=(",",":"))+"\n")
    manifest_path=OUT/"manifest.json";manifest=json.loads(manifest_path.read_text());manifest["core"]=asset(core_path)
    manifest_path.write_text(json.dumps(manifest,separators=(",",":"))+"\n")
    rule_counts={};binding_rule_counts={}
    for row in chart_rows.values():
        rules="+".join(sorted({tile[3] for tile in row["tiles"]}))
        rule_counts[rules]=rule_counts.get(rules,0)+1
        for tile in row["tiles"]:binding_rule_counts[tile[3]]=binding_rule_counts.get(tile[3],0)+1
    unsupported_reasons={}
    for row in unsupported:unsupported_reasons[row["reason"]]=unsupported_reasons.get(row["reason"],0)+1
    print(json.dumps({"charts":len(charts),"vertices":len(vertices),"segments":len(indices)//2,
                      "batchChartIndicesRemapped":batch_remap,
                      "unsupported":len(unsupported),"bytes":len(data),
                      "countrySegmentsDropped":dict(sorted(dropped_by_chart.items())),
                      "chartsByPrecedenceRule":dict(sorted(rule_counts.items())),
                      "bindingsByPrecedenceRule":dict(sorted(binding_rule_counts.items())),
                      "unsupportedByReason":dict(sorted(unsupported_reasons.items()))}))


if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--self-test", action="store_true",
                        help="prove each motion-binding precedence rule and exit")
    arguments=vars(parser.parse_args())
    if arguments.pop("self_test"):_self_test()
    else:main(**arguments)
