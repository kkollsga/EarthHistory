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
* area preservation net of partition overlap inside [99.9, 100.5] %, measured
  against source areas that carry the tracked basin edits, re-applied here from
  the archive and the contract rather than read back from the catalog;
* simplification area error at most 0.05 %, per class and per interval;
* at most 5 lost pieces per interval and none above 500 km2;
* co-moving landmass area at least 85 %;
* every ``PLATEID1`` override and every basin edit operation carries a
  justification, a citation, a positive spatial uncertainty and an editorial
  line, names only intervals the contract declares, and stays inside the
  contract's window bbox;
* exactly one canonical interval active at every 5 Ma checkpoint 5-400 Ma;
* the offline provenance sidecar still matches the sha256 the shipped catalog
  pins on it, and carries one source record per ``chartCount``;
* every u16 catalog index a piece carries fits its field and resolves;
* every shipped binding row resolves gap-free under ``palaeo-binding-entry-v1``
  over every piece lifecycle that uses it, agreeing entry for entry with the
  compiler's chain builder, with holes only where the row declares a source seam;
* exactly one owner per piece: two pieces of the same source record never
  overlap;
* every piece on the North Sea partitions 303 and 315 is bound to the
  restoration palette entry inside the restoration window;
* the narrow-feature witnesses (Viking Graben, Central Graben, Moray Firth,
  Zechstein margin) change width by at most 2 km;
* the seaway witnesses and the negative controls reproduce the audit's own
  class table, except where a tracked basin edit declares the change;
* every cited basin edit reached the shipped payload at its own witness point,
  and an unedited control in the same window and interval is untouched.

``--self-test`` proves each of those can fail: a corrupted hash, a dropped
reference, a basin edit whose geometry is translated outside the contract's
window, a basin edit on an interval the contract does not declare, an edited or
truncated provenance sidecar, a piece rebound to the
wrong lifecycle, a widened catalog lifecycle, a catalog too short for the indices
its pieces carry, an override rebound to its partition, a binding rebound to a
plate the palette does not cover, a mislabelled binding kind, an invented source
seam, a North Sea window resolved without the restoration entries, an
over-simplified payload, a removed piece, a payload shifted off its basin edit
and a basin-edit witness whose operation was deleted from the contract are each
rejected, and the clean
inputs pass again afterwards.

Run with the pinned pyGPlates environment.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
import sys
import time
import zipfile
from copy import deepcopy
from pathlib import Path

import pygplates
import shapely
import shapely.affinity
import shapely.geometry
from shapely.geometry import LineString
from shapely.ops import unary_union
from shapely.strtree import STRtree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import palaeo_coastlines_audit as audit  # noqa: E402
import palaeo_coastlines_compile as compiler  # noqa: E402
import validate_palaeo_coastlines_runtime as runtime_check  # noqa: E402


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
# A plate id the Cao v2.4 motion palette carries no entry for; the self-test rebinds
# a shipped binding row to it to prove the gap-free resolution gate can fail.
UNCOVERED_PLATE_ID = 999999

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
    # Mid-Norway and the Barents: the hatched Nordland Ridge and Loppa High
    # columns of the Norwegian lithostratigraphic wallchart are missing section,
    # not emergence, so no basin contract draws either. These three rows are the
    # drift detectors that keep that open question honest: the Neogene Nordland
    # Ridge must not start rendering as land without a source that states
    # exposure, and the map's own Miocene emergent Loppa High - unevidenced
    # either way - must not move silently.
    "nordland-ridge-crest": ((10.902, 66.925), {"11-2": ["sm"]}),
    "loppa-high-crest": ((20.546, 72.057), {"248-224": ["sm"], "20-11": ["lm"]}),

    # ---------------------------------------------------------------- inland seas
    # docs/research/palaeo-coastlines-inland-sea-checks.md section 15.1, in its own
    # order. Every row is a CLASS SET measured from the shipped payloads, not an
    # `sm` membership test: three of the memo's findings - the Tunguska overlap,
    # the Pebas land reading and the Turgai correction - are invisible to a
    # membership test and only a set can hold them. The memo's 23rd row,
    # `wis-axis-peak` at (-100, 45) in 94-81, is the existing
    # `western-interior-seaway` row above and is kept rather than duplicated.
    "wis-west-shore": ((-110.0, 40.0), {"94-81": ["sm"]}),
    "wis-east-shore": ((-94.0, 40.0), {"94-81": ["lm"]}),
    "wis-boreal-corridor": ((-117.0, 60.0), {"94-81": ["sm"]}),
    "wis-boreal-closed": ((-117.0, 60.0), {"81-58": ["lm"]}),
    "wis-absent": ((-100.0, 45.0), {"58-49": ["lm"]}),
    "sundance-wyoming": ((-108.0, 44.0), {"166-146": ["sm"]}),
    "sundance-morrison": ((-108.0, 44.0), {"146-135": ["lm"]}),
    "mississippi-embayment": ((-90.0, 34.0), {"81-58": ["sm"]}),
    "illinois-basin-kaskaskia": ((-90.0, 40.0), {"380-359": ["sm"]}),
    # The two most important rows in the table. Western Amazonia must not become
    # shallow marine: that would assert the contested marine reading of the Pebas
    # system over the published lacustrine one, and the layer has no lake class.
    "pebas-land": ((-72.0, -4.0), {"20-11": ["lm"]}),
    "pebas-land-acre": ((-70.0, -2.0), {"11-2": ["lm"]}),
    "paranense-entre-rios": ((-58.0, -33.0), {"20-11": ["sm"]}),
    # Today's negative control and a known mismatch at once: the Laguna Paiva
    # transgression is absent from the map at 29-20 and the only source for it is
    # one unpublished thesis, so the state is recorded rather than edited.
    "paranense-pre-tep": ((-58.0, -33.0), {"29-20": ["lm"]}),
    "sergipe-albian": ((-37.0, -10.0), {"117-94": ["sm"]}),
    "araripe-albian": ((-40.0, -7.0), {"117-94": ["sm"]}),
    "amazonas-devonian": ((-60.0, -4.0), {"402-380": ["sm"]}),
    "west-siberian-eocene": ((75.0, 60.0), {"49-37": ["sm"]}),
    "west-siberian-closed": ((75.0, 60.0), {"37-29": ["lm"]}),
    # The correction the inland-sea memo exists for. The `turgai-strait` row above
    # samples only intervals in which the strait is dry, and that was read as
    # proving it is never open; it is an open, connected marine corridor at 81-58,
    # 58-49 and 49-37 and closes at 37-29.
    "turgai-open": ((65.0, 52.0), {"58-49": ["sm"]}),
    "turgai-open-second": ((63.0, 50.0), {"49-37": ["sm"]}),
    "turgai-closed": ((65.0, 52.0), {"37-29": ["lm"]}),
    "tunguska-devonian": ((100.0, 62.0), {"402-380": ["lm", "sm"]}),

    # ------------------------------------------------- North Sea structural elements
    # docs/research/palaeo-coastlines-north-sea-structural-elements.md section 5.1.
    # Nine of the sixteen are NEGATIVE witnesses: they record a state that memo
    # decided not to change, so a later change has to be deliberate. Three rows
    # move with an operation and carry a WITNESS_BASIN_EDITS entry below.
    "ringkobing-fyn-permian-barrier": ((4.874, 56.243), {"285-269": ["lm"]}),
    "ringkobing-fyn-early-jurassic-submarine": ((4.874, 56.243), {"203-179": ["sm"]}),
    "ringkobing-fyn-late-jurassic-emergent": ((4.874, 56.243), {"166-146": ["lm", "sm"]}),
    # The memo measured this row as ["lm"] against the shipped lm+sm pair, before
    # the mountain class shipped; the same ground also carries `m`, and the row
    # states what the source holds rather than what two of its three classes held.
    "mid-north-sea-high-permian-barrier": ((1.0, 55.0), {"285-269": ["lm", "m"]}),
    "mid-north-sea-high-aptian-albian": ((1.0, 55.0), {"117-94": ["sm"]}),
    "utsira-high-zechstein": ((2.533, 58.807), {"269-248": ["sm"]}),
    "jaeren-high-chalk-sea": ((2.415, 57.612), {"94-81": ["sm"]}),
    # The stop on the Jaeren High operation: Ryazanian macrofossils in well 7/7-2
    # ON the high mean it must not be extended back into 146-135.
    "jaeren-high-ryazanian-marine": ((2.415, 57.612), {"146-135": ["sm"]}),
    # The same Campanian submergence at an element 18.0 km across, below Cao's own
    # ~30 km coastline tolerance: the row exists to record that the mismatch is
    # known and deliberately unedited.
    "forties-montrose-high-chalk-sea": ((1.311, 57.471), {"94-81": ["sm"]}),
    "central-graben-axis-chalk": ((1.611, 57.079), {"94-81": ["sm"]}),
    "tail-end-graben-late-jurassic": ((4.492, 56.091), {"166-146": ["lm", "sm"]}),
    "east-shetland-platform-crest-mid-jurassic": ((0.200, 59.625), {"179-166": ["sm"]}),
    "east-shetland-platform-chalk": ((0.200, 59.625), {"94-81": ["sm"]}),
    "fladen-ground-spur-late-jurassic": ((0.854, 58.918), {"166-146": ["sm"]}),
    # The Late Jurassic footwall archipelago is deliberately not drawn - 26 of 43
    # elements are below the class floor - and these two make that a decision
    # rather than an accident.
    "tampen-spur-synrift": ((2.492, 61.542), {"166-146": ["sm"]}),
    "sogn-graben-synrift": ((3.487, 61.769), {"166-146": ["sm"]}),
}
# Every interval the audit table, the narrow-feature transects and the tone
# index are checked at. A witness that does not name an interval is simply not
# checked there, so this tuple can grow without re-measuring every row. It has
# grown three times: the four original intervals span the schedule, the second
# North Sea round added the eight its cited edits touch plus the Neogene pair the
# mid-Norway and Barents witnesses need, and the inland-sea and structural-element
# memos added the eight that carry their rows. The Palaeogene entries are the
# reason the "Turgai is land in every interval" premise survived as long as it
# did: the strait is dry in all four of the original intervals.
WITNESS_INTERVALS = ("402-380", "380-359", "285-269", "269-248", "248-224",
                     "203-179", "179-166", "166-146", "146-135", "135-117", "117-94",
                     "94-81", "81-58", "58-49", "49-37", "37-29", "29-20", "20-11", "11-2")

# A cited basin edit is allowed to move a witness, but only where the contract
# says so. Each row names the witness the edit moves, the operation that moves
# it, and the class set the compiled payload must carry afterwards; the class set
# *before* the edit is not typed here, it is re-measured from the pinned archive.
# A witness that moves without a row, or a row whose operation is gone, fails.
WITNESS_BASIN_EDITS = {
    ("north-sea-centre", "402-380"): {
        "opId": "north-sea-402-380-orcadian-remove-shallow",
        "classes": ["lm"],
        "reason": "the Middle Devonian Orcadian Basin is lacustrine and alluvial land, not an "
                  "epicontinental sea; the shallow-marine class is removed and the landmass kept",
    },
    ("jaeren-high-chalk-sea", "94-81"): {
        "opId": "north-sea-135-81-jaeren-high-add-land",
        "classes": ["lm"],
        "reason": "the Hidra Formation onlaps the flanks of the Jaeren High and chalk reached it "
                  "only in the early Campanian, so the high is an island through this bin rather "
                  "than the shallow sea Cao paints over the whole Central Graben",
    },
    ("tail-end-graben-late-jurassic", "166-146"): {
        "opId": "north-sea-166-94-central-graben-depocentre-remove-land",
        "classes": ["sm"],
        "reason": "Cao overlaps its own landmass polygon on its own shallow-marine polygon over "
                  "the Danish Central Graben depocentre and the landmass wins the draw order, so "
                  "the Farsund Formation kitchen rendered as dry ground; the land is removed and "
                  "the shallow-marine class Cao already carries is what remains",
    },
    ("fladen-ground-spur-late-jurassic", "166-146"): {
        "opId": "north-sea-166-146-fladen-ground-spur-add-land",
        "classes": ["lm"],
        "reason": "the Fladen Ground Spur 'likely formed a positive structure throughout the "
                  "Jurassic'; on the NSTA/BGS-DECC outline it is 43.9 km across, above Cao's own "
                  "coastline tolerance, so it can be drawn as the low-relief land it was",
    },
}

# Points that prove each cited North Sea edit reached the shipped payloads. The
# expected class set is the edit's intent; the Cao source class set at the same
# point is re-measured from the archive and reported beside it, so the record
# shows what changed rather than asserting it.
BASIN_EDIT_WITNESSES = (
    {"witnessId": "orcadian-central-north-sea", "position": (1.5, 58.0), "intervalId": "402-380",
     "opIds": ["north-sea-402-380-orcadian-remove-shallow"], "classes": ["lm"]},
    {"witnessId": "orcadian-east-of-the-edit", "position": (5.5, 57.0), "intervalId": "402-380",
     "opIds": [], "classes": ["lm", "sm"]},
    {"witnessId": "zechstein-moray-firth", "position": (-2.0, 57.9), "intervalId": "269-248",
     "opIds": ["north-sea-269-248-moray-firth-remove-shallow",
               "north-sea-269-248-moray-firth-add-land"], "classes": ["lm"]},
    {"witnessId": "zechstein-central-north-sea", "position": (3.0, 56.5), "intervalId": "269-248",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "east-shetland-platform", "position": (0.0, 61.0), "intervalId": "179-166",
     "opIds": ["north-sea-179-166-east-shetland-platform-remove-shallow",
               "north-sea-179-166-east-shetland-platform-add-land"], "classes": ["lm"]},
    {"witnessId": "brent-delta-plain", "position": (2.5, 59.5), "intervalId": "179-166",
     "opIds": ["north-sea-179-166-brent-delta-plain-remove-shallow",
               "north-sea-179-166-brent-delta-plain-add-land"], "classes": ["lm"]},
    {"witnessId": "northern-viking-graben", "position": (2.0, 61.5), "intervalId": "179-166",
     "opIds": [], "classes": ["sm"]},
    # Cao 2017 carries the Middle Jurassic Scottish landmass in its mountain class,
    # which is compiled but never shipped, so before the edit the browser drew
    # unmapped crust between emergent Scotland and the mapped sea. The edit puts
    # the same ground in the shipped landmass class; `m` stays in the expected set
    # because the row must state what the source actually holds.
    {"witnessId": "scottish-landmass-mid-jurassic", "position": (-3.0, 58.8), "intervalId": "179-166",
     "opIds": ["north-sea-179-166-scottish-landmass-add-land"], "classes": ["lm", "m"]},
    {"witnessId": "shetland-platform-palaeocene", "position": (-1.5, 60.5), "intervalId": "58-49",
     "opIds": ["north-sea-58-49-shetland-platform-remove-shallow",
               "north-sea-58-49-shetland-platform-add-land"], "classes": ["lm"]},
    {"witnessId": "shetland-platform-eocene", "position": (-1.5, 60.5), "intervalId": "49-37",
     "opIds": ["north-sea-49-37-shetland-platform-remove-shallow",
               "north-sea-49-37-shetland-platform-add-land"], "classes": ["lm"]},
    {"witnessId": "central-graben-eocene", "position": (3.0, 56.5), "intervalId": "49-37",
     "opIds": [], "classes": ["sm"]},
    # The Eocene operation deliberately stops at 0.2 E: the retrieved sources put
    # the East Shetland Platform proper under a shelf sea in the Lutetian-Bartonian
    # and the emergent ground west of it (contract notes.leftAlone). This control
    # fails if the land is ever extended east without a citation.
    {"witnessId": "east-shetland-platform-eocene", "position": (0.5, 61.0), "intervalId": "49-37",
     "opIds": [], "classes": ["sm"]},

    # ---------------------------------------------------------------- 2026-09-15
    # The formation checks (docs/research/palaeo-coastlines-north-sea-formation-
    # checks.md) and the Norwegian shelf checks (…-norwegian-shelf-checks.md)
    # measured the shipped payload against named lithostratigraphic units. These
    # rows are what those two memos found, so a future compile cannot lose them.
    # Rows with an opId are the three places Cao overlaps its own landmass on its
    # own shallow-marine polygon and the cited removals now fix; rows with none
    # are controls the edits must leave exactly as Cao drew them.

    # Devonian and Permian: the Old Red Sandstone continent, and the Zechstein flip.
    {"witnessId": "orcadian-old-red-sandstone", "position": (2.0, 57.0), "intervalId": "380-359",
     "opIds": [], "classes": ["lm"]},
    {"witnessId": "southern-north-sea-tornquist-incursion", "position": (4.0, 54.0),
     "intervalId": "380-359", "opIds": [], "classes": ["sm"]},
    {"witnessId": "rotliegend-auk-pre-desert", "position": (2.07, 56.4), "intervalId": "285-269",
     "opIds": [], "classes": ["lm"]},
    {"witnessId": "zechstein-auk-field", "position": (2.07, 56.4), "intervalId": "269-248",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "zechstein-viking-graben-north-limit", "position": (2.5, 60.5),
     "intervalId": "269-248", "opIds": [], "classes": ["lm"]},

    # Triassic and Early Jurassic controls.
    {"witnessId": "skagerrak-triassic-dryland", "position": (7.0, 56.8), "intervalId": "248-224",
     "opIds": [], "classes": ["lm"]},
    {"witnessId": "dunlin-viking-graben", "position": (2.5, 60.5), "intervalId": "203-179",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "dunlin-east-shetland-basin", "position": (1.5, 61.0), "intervalId": "203-179",
     "opIds": [], "classes": ["sm"]},

    # Middle Jurassic: the delta-plain pair fixes the shoreline to a 0.5 degree
    # band at 60.5/61.0 N, which is the whole point of the Vestland limit.
    {"witnessId": "brent-delta-plain-north-limit", "position": (2.0, 60.5), "intervalId": "179-166",
     "opIds": ["north-sea-179-166-brent-delta-plain-remove-shallow",
               "north-sea-179-166-brent-delta-plain-add-land"], "classes": ["lm"]},
    {"witnessId": "brent-delta-drowned-axis", "position": (2.0, 61.0), "intervalId": "179-166",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "mid-jurassic-dome-central-graben-no", "position": (3.2, 56.5),
     "intervalId": "179-166", "opIds": [], "classes": ["lm"]},

    # Late Jurassic and Early Cretaceous: the three cited land removals, their
    # controls, and the Utsira High, which is emergent at 166-146 and drowned by
    # 146-135 and must not creep either way.
    {"witnessId": "heather-viking-graben", "position": (2.5, 60.5), "intervalId": "166-146",
     "opIds": ["north-sea-166-146-viking-graben-remove-land"], "classes": ["sm"]},
    {"witnessId": "tau-egersund-basin-late", "position": (5.5, 57.8), "intervalId": "166-146",
     "opIds": ["north-sea-166-135-egersund-basin-remove-land"], "classes": ["sm"]},
    {"witnessId": "tau-egersund-basin", "position": (5.5, 57.8), "intervalId": "146-135",
     "opIds": ["north-sea-166-135-egersund-basin-remove-land"], "classes": ["sm"]},
    {"witnessId": "draupne-viking-graben", "position": (2.5, 60.5), "intervalId": "146-135",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "norwegian-danish-basin-ryazanian", "position": (8.0, 56.5),
     "intervalId": "146-135",
     "opIds": ["north-sea-166-117-norwegian-danish-basin-remove-land"], "classes": ["sm"]},
    {"witnessId": "norwegian-danish-basin-cromer-knoll", "position": (8.0, 56.5),
     "intervalId": "135-117",
     "opIds": ["north-sea-166-117-norwegian-danish-basin-remove-land"], "classes": ["sm"]},
    {"witnessId": "southern-north-sea-valhall", "position": (4.0, 54.0), "intervalId": "135-117",
     "opIds": ["north-sea-135-117-southern-north-sea-remove-land"], "classes": ["sm"]},
    {"witnessId": "utsira-high-late-jurassic-island", "position": (2.235, 58.836),
     "intervalId": "166-146", "opIds": [], "classes": ["lm", "sm"]},
    {"witnessId": "utsira-high-north-tip-drowned", "position": (2.801, 59.526),
     "intervalId": "166-146", "opIds": [], "classes": ["sm"]},
    {"witnessId": "utsira-high-drowned", "position": (2.235, 58.836), "intervalId": "146-135",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "norwegian-danish-basin-west-control", "position": (6.0, 57.2),
     "intervalId": "146-135", "opIds": [], "classes": ["sm"]},

    # Chalk sea, and the two Cenozoic basin-axis points: an environment class,
    # never a depth. Frigg and Utsira are both shallow marine and must stay both
    # non-land and classified - a `neither` result there would be a payload loss.
    {"witnessId": "ekofisk-chalk-sea", "position": (3.22, 56.55), "intervalId": "94-81",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "frigg-fan-axis", "position": (2.0, 59.5), "intervalId": "58-49",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "utsira-shelf", "position": (2.0, 59.5), "intervalId": "20-11",
     "opIds": [], "classes": ["sm"]},

    # ------------------------------- North Sea structural elements, 2026-09-15
    # docs/research/palaeo-coastlines-north-sea-structural-elements.md section 5.2.
    # Four of its five proposed operations are built; the fifth (the East Shetland
    # Platform in the Late Jurassic) is in the contract's notes.leftAlone because
    # it rests on absence of section and has no licensed outline of its own.
    {"witnessId": "jaeren-high-island", "position": (2.4, 57.6), "intervalId": "94-81",
     "opIds": ["north-sea-135-81-jaeren-high-remove-shallow",
               "north-sea-135-81-jaeren-high-add-land"], "classes": ["lm"]},
    # The graben beside it must stay marine whatever happens to the high.
    {"witnessId": "jaeren-high-graben-control", "position": (1.6, 57.0), "intervalId": "94-81",
     "opIds": [], "classes": ["sm"]},
    {"witnessId": "central-graben-depocentre-farsund", "position": (4.4, 56.3),
     "intervalId": "166-146",
     "opIds": ["north-sea-166-94-central-graben-depocentre-remove-land"], "classes": ["sm"]},
    {"witnessId": "mid-north-sea-high-jurassic", "position": (1.0, 55.5), "intervalId": "166-146",
     "opIds": ["north-sea-166-117-mid-north-sea-high-remove-shallow",
               "north-sea-166-117-mid-north-sea-high-add-land"], "classes": ["lm"]},
    # The corridor along the Central Graben where it transects the high is left
    # marine on purpose; the operation stops at 3.2 E and this control holds it.
    {"witnessId": "mid-north-sea-high-graben-corridor", "position": (3.6, 55.5),
     "intervalId": "166-146", "opIds": [], "classes": ["sm"]},
    {"witnessId": "fladen-ground-spur-early-jurassic", "position": (0.9, 58.75),
     "intervalId": "203-179",
     "opIds": ["north-sea-203-179-fladen-ground-spur-remove-shallow",
               "north-sea-203-179-fladen-ground-spur-add-land"], "classes": ["lm"]},
    {"witnessId": "fladen-ground-spur-jurassic", "position": (0.9, 58.75), "intervalId": "166-146",
     "opIds": ["north-sea-166-146-fladen-ground-spur-remove-shallow",
               "north-sea-166-146-fladen-ground-spur-add-land"], "classes": ["lm"]},
    {"witnessId": "fladen-ground-spur-west-control", "position": (-0.2, 58.75),
     "intervalId": "166-146", "opIds": [], "classes": ["sm"]},

    # ------------------------------------------------------- Iceland, 2026-09-15
    # docs/research/palaeo-coastlines-iceland-ne-atlantic.md section 5. Cao draws
    # no land over Iceland at either interval; the contract draws the mapped
    # Tertiary outcrop at 11-2 and its three oldest flanks at 20-11. The mountain
    # class stays in the expected sets because Cao maps the island as mountain and
    # the rows have to state what the source holds.
    {"witnessId": "iceland-vestfirdir-plateau", "position": (-22.9, 65.75), "intervalId": "11-2",
     "opIds": ["iceland-11-2-tertiary-plateau-add-land",
               "iceland-11-2-tertiary-plateau-remove-shallow"], "classes": ["lm", "m"]},
    {"witnessId": "iceland-vestfirdir-oldest-flank", "position": (-22.9, 65.75),
     "intervalId": "20-11",
     "opIds": ["iceland-20-11-oldest-flanks-add-land",
               "iceland-20-11-oldest-flanks-remove-shallow"], "classes": ["lm", "m"]},
    # The Eastfjords at 20-11 are the clearest case in the contract: before the
    # edit the point carried no shipped class at all, so the globe drew unmapped
    # crust over 13-14 Ma subaerial lavas.
    {"witnessId": "iceland-eastfjords-oldest-flank", "position": (-14.6, 65.0),
     "intervalId": "20-11",
     "opIds": ["iceland-20-11-oldest-flanks-add-land",
               "iceland-20-11-oldest-flanks-remove-shallow"], "classes": ["lm"]},
    {"witnessId": "iceland-trollaskagi-oldest-flank", "position": (-18.4, 65.7),
     "intervalId": "20-11",
     "opIds": ["iceland-20-11-oldest-flanks-add-land",
               "iceland-20-11-oldest-flanks-remove-shallow"], "classes": ["lm"]},
    {"witnessId": "iceland-snaefellsnes-plateau", "position": (-22.3, 64.85),
     "intervalId": "11-2",
     "opIds": ["iceland-11-2-tertiary-plateau-add-land",
               "iceland-11-2-tertiary-plateau-remove-shallow"], "classes": ["lm", "m"]},
    # Outside the three lobes: the 20-11 operation must not grow to the whole
    # outcrop, because no published age places this ground before 11 Ma.
    {"witnessId": "iceland-snaefellsnes-20-11-control", "position": (-22.3, 64.85),
     "intervalId": "20-11", "opIds": [], "classes": ["sm", "m"]},
    # And no Iceland land at all in the interval before the contract starts.
    {"witnessId": "iceland-absent-before-20-ma", "position": (-19.6, 63.6), "intervalId": "29-20",
     "opIds": [], "classes": []},
)


class CorrectionError(ValueError):
    """A compiled payload or its contract failed a gate that must hold before shipping."""


class Store:
    """The compiled store, with an in-memory override layer for the self-test."""

    def __init__(self, root: Path, overrides: dict[str, bytes] | None = None):
        self.root = root
        self.overrides = dict(overrides or {})
        self._catalogs: dict[str, dict] = {}
        self._provenance: dict[str, dict] = {}

    def read(self, relative: str) -> bytes:
        if relative in self.overrides:
            return self.overrides[relative]
        path = self.root / relative
        if not path.is_file():
            raise CorrectionError(f"missing compiled asset: {relative}")
        return path.read_bytes()

    def catalog(self, class_name: str) -> dict:
        # Every payload decode needs the class lifecycle table, so each catalog is
        # parsed once per store.
        if class_name not in self._catalogs:
            self._catalogs[class_name] = json.loads(
                self.read(f"staging/{class_name}/palaeo-{class_name}-catalog.json"))
        return self._catalogs[class_name]

    def provenance_bytes(self, class_name: str) -> bytes:
        return self.read(f"provenance/palaeo-{class_name}-provenance.json")

    def provenance(self, class_name: str) -> dict:
        """The offline sidecar: source-record provenance and every compile measurement."""
        if class_name not in self._provenance:
            self._provenance[class_name] = json.loads(self.provenance_bytes(class_name))
        return self._provenance[class_name]

    def payload(self, tier: str, class_name: str, interval_id: str) -> dict:
        return compiler.decode_ehpr(
            self.read(f"{tier}/{class_name}/palaeo-{class_name}-{interval_id}.ehpr"),
            self.catalog(class_name))

    def with_override(self, relative: str, payload: bytes) -> "Store":
        return Store(self.root, {**self.overrides, relative: payload})


class ClassView:
    """One class's shipped catalog and its offline sidecar, as row tables.

    The shipped catalog is columnar and carries no source-record provenance, so a
    check that needs a chart's ``PLATEID1`` or an interval's measured areas reads
    the sidecar. Keeping the two behind one view is what lets every check state
    which side of the split it is trusting.
    """

    def __init__(self, class_name: str, catalog: dict, provenance: dict):
        self.class_name = class_name
        self.catalog = catalog
        self.provenance = provenance
        self.intervals = compiler.catalog_intervals(catalog)
        self.bindings = compiler.catalog_bindings(catalog)
        self.lifecycles = compiler.catalog_lifecycles(catalog)
        self.evidence = catalog["evidence"]
        self.charts = compiler.expand_chart_provenance(provenance["charts"])
        self.measurements = {row["intervalId"]: row for row in provenance["intervals"]}

    @classmethod
    def load(cls, store: Store, class_name: str) -> "ClassView":
        return cls(class_name, store.catalog(class_name), store.provenance(class_name))

    def mutated(self, catalog: dict | None = None, provenance: dict | None = None) -> "ClassView":
        """A view over edited documents; the self-test's mutations go through here."""
        return ClassView(self.class_name, catalog if catalog is not None else self.catalog,
                         provenance if provenance is not None else self.provenance)

    def measurement(self, interval_id: str) -> dict:
        row = self.measurements.get(interval_id)
        if row is None:
            raise CorrectionError(
                f"{self.class_name} {interval_id}: the provenance sidecar has no measurement row")
        return row

    def payload_relative(self, interval_id: str, tier: str = "simplified") -> str:
        directory = "staging" if tier == "simplified" else "original"
        return f"{directory}/{self.class_name}/{compiler.payload_url(self.class_name, interval_id)}"


# --------------------------------------------------------------------------
# shared loads
# --------------------------------------------------------------------------

def load_source_records() -> dict[str, list[dict]]:
    manifest = compiler.load_json(CONFIG / "sources.json")
    archive_path = ROOT.parent / "EarthHistory-data/palaeomap-study" / next(
        source["archive"]["path"] for source in manifest["sources"] if "archive" in source)
    with zipfile.ZipFile(archive_path) as archive:
        return {name: audit.read_class(archive, name) for name in ("lm", "sm", "m")}


def source_areas(rows_by_class: dict[str, list[dict]], basins: list[dict] | None = None,
                 intervals: list[dict] | None = None) -> dict[str, dict[int, float]]:
    """Spherical area of every dated source record, re-derived from the archive.

    The area-preservation gate measures what the cookie-cut costs, so the cited
    basin edits belong on the source side of the ratio rather than showing up as
    lost or invented ground. They are applied here through the compiler's own
    ``apply_basin_ops``, driven by the pinned archive and the tracked contract
    JSON, so a contract that moved more ground than it declares still fails: the
    numbers are never read back from the catalog under test.
    """
    table: dict[str, dict[int, float]] = {}
    for name, rows in rows_by_class.items():
        kept, _ = compiler.quarantine(rows)
        geometries = {row["index"]: compiler.record_polygon(row, densify=True) for row in kept}
        if basins:
            # Same inputs and same order as the compiler, so a record the edit
            # adds lands on the same source record index the catalog names.
            kept, geometries, _ = compiler.apply_basin_ops(name, kept, geometries, basins,
                                                           intervals or [])
        table[name] = {row["index"]: audit.area_km2(geometries[row["index"]]) for row in kept}
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
            if not str(op.get("editorial", "")).startswith(compiler.EDITORIAL_PREFIX):
                raise CorrectionError(
                    f"basin {basin['basinId']} op {op['opId']}: the editorial line must start with "
                    f"{compiler.EDITORIAL_PREFIX!r}")
            uncertainty = op.get("spatialUncertaintyKilometres")
            if not isinstance(uncertainty, (int, float)) or uncertainty <= 0:
                raise CorrectionError(
                    f"basin {basin['basinId']} op {op['opId']}: no positive spatial uncertainty")
    for class_name, block in overrides["classes"].items():
        for row in block["plates"]:
            if not row.get("sourceIds") or not row.get("justification"):
                raise CorrectionError(
                    f"{class_name} override {row['plateId1']}: an override needs a cited justification")
    return {"overrideClasses": sorted(overrides["classes"]),
            "basins": [basin["basinId"] for basin in basins],
            "basinOps": sum(len(basin["ops"]) for basin in basins),
            "basinOpsByInterval": {
                basin["basinId"]: {
                    interval_id: sum(1 for op in basin["ops"] if interval_id in op["intervalIds"])
                    for interval_id in basin.get("intervals", [])}
                for basin in basins},
            "basinReferences": {basin["basinId"]: len(basin["references"]) for basin in basins}}


def check_provenance(store: Store, view: ClassView) -> dict:
    """The catalog pins the offline sidecar it moved its source records into.

    Nothing the browser downloads names a Cao 2017 record any more, so the chain
    from a shipped piece back to its DBF row runs through this digest. A sidecar
    that no longer matches is a broken provenance chain, not a cosmetic drift.
    """
    declared = view.catalog.get("provenance")
    if not isinstance(declared, dict):
        raise CorrectionError(f"{view.class_name}: the catalog names no provenance sidecar")
    payload = store.read(declared["path"].replace("\\", "/"))
    digest = compiler.sha256_bytes(payload)
    if len(payload) != declared["bytes"] or digest != declared["sha256"]:
        raise CorrectionError(
            f"{view.class_name}: the provenance sidecar is {len(payload)} bytes with sha256 "
            f"{digest}; the catalog pins {declared['bytes']} bytes and {declared['sha256']}")
    if declared["records"] != view.catalog["chartCount"] or len(view.charts) != declared["records"]:
        raise CorrectionError(
            f"{view.class_name}: the sidecar carries {len(view.charts)} source records; the catalog "
            f"declares {view.catalog['chartCount']}")
    if view.provenance.get("catalogId") != view.catalog["catalogId"]:
        raise CorrectionError(f"{view.class_name}: the sidecar names a different catalog")
    if sorted(view.measurements) != sorted(row["intervalId"] for row in view.intervals):
        raise CorrectionError(f"{view.class_name}: the sidecar and the catalog list different intervals")
    return {"path": declared["path"], "bytes": declared["bytes"], "sha256": declared["sha256"],
            "records": declared["records"]}


def check_payload_identity(store: Store, view: ClassView) -> dict:
    rows = []
    for interval in view.intervals:
        measured = view.measurement(interval["intervalId"])
        for tier, descriptor in (("simplified", interval), ("original", measured["original"])):
            payload = store.read(view.payload_relative(interval["intervalId"], tier))
            digest = compiler.sha256_bytes(payload)
            if len(payload) != descriptor["bytes"] or digest != descriptor["sha256"]:
                raise CorrectionError(
                    f"{view.class_name} {interval['intervalId']} {tier}: payload identity changed "
                    f"({len(payload)} bytes, sha256 {digest})")
        rows.append(interval["intervalId"])
    return {"verifiedPayloads": 2 * len(rows)}


def check_schedule(view: ClassView) -> dict:
    """Exactly one canonical interval active at every 5 Ma checkpoint 5-400 Ma."""
    intervals = [(row["intervalId"], row["fromAgeMa"], row["toAgeMa"])
                 for row in view.intervals]
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


CATALOG_INDEX_FIELDS = (("chartIndex", "charts"), ("bindingIndex", "bindings"),
                        ("evidenceIndex", "evidence"), ("lifecycleIndex", "lifecycles"))


def catalog_table_sizes(view: ClassView) -> dict[str, int]:
    """How many rows each u16 piece field may reach.

    ``charts`` is the one the shipped catalog no longer carries: a piece's
    ``chartIndex`` is the source-record ordinal and ``chartCount`` is the only
    thing that bounds it, so the bound is declared and the sidecar is what has to
    have that many rows (``check_provenance``).
    """
    return {"charts": view.catalog["chartCount"], "bindings": view.catalog["bindings"]["count"],
            "evidence": len(view.evidence), "lifecycles": view.catalog["lifecycles"]["count"]}


def check_catalog_indices(store: Store, view: ClassView) -> dict:
    """Every piece field is a u16 index the class catalog can actually resolve.

    The piece record spends 12 bytes on six u16 fields, so a catalog table that
    grew past 65,535 rows would silently alias. Both halves are asserted here:
    the table lengths fit the field, and no emitted index points past its table.
    """
    sizes = catalog_table_sizes(view)
    for field, name in CATALOG_INDEX_FIELDS:
        if sizes[name] >= compiler.CATALOG_INDEX_CEILING:
            raise CorrectionError(
                f"{view.class_name}: {sizes[name]} {name} records do not fit the u16 {field} field")
    worst = {field: -1 for field, _ in CATALOG_INDEX_FIELDS}
    pieces = 0
    for interval in view.intervals:
        for tier in ("simplified", "original"):
            decoded = compiler.decode_ehpr(
                store.read(view.payload_relative(interval["intervalId"], tier)))
            for piece in decoded["pieces"]:
                for field, name in CATALOG_INDEX_FIELDS:
                    value = piece[field]
                    if value >= sizes[name]:
                        raise CorrectionError(
                            f"{view.class_name} {interval['intervalId']} {tier}: {field} {value} "
                            f"is outside the {sizes[name]} {name} records of the catalog")
                    worst[field] = max(worst[field], value)
                pieces += 1
    return {"checkedPieces": pieces, "catalogSizes": sizes, "largestIndexUsed": worst}


def check_lifecycles(store: Store, view: ClassView, rows_by_index: dict[int, dict]) -> dict:
    """Every piece carries its own source record's (TOAGE, FROMAGE] lifecycle."""
    class_name = view.class_name
    checked = 0
    for interval in view.intervals:
        decoded = store.payload("staging", class_name, interval["intervalId"])
        for piece in decoded["pieces"]:
            chart = view.charts[piece["chartIndex"]]
            record = rows_by_index.get(chart["sourceRecordIndex"])
            if record is None:
                # A synthetic record: a cited basin edit's `add-*` operation, or
                # a tracked contract such as the LGM lowstand state. Both carry
                # their own lifecycle and neither exists in the Cao archive.
                if chart.get("basinOpId") or chart.get("contractId"):
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


def check_areas(store: Store, view: ClassView, areas: dict[int, float]) -> dict:
    """Area preservation and simplification error, re-derived from the payloads."""
    class_name = view.class_name
    total_source = 0.0
    total_cut = 0.0
    total_emitted = 0.0
    total_simplified = 0.0
    worst_interval_error = 0.0
    per_interval = []
    for interval in view.intervals:
        measured = view.measurement(interval["intervalId"])
        original = store.payload("original", class_name, interval["intervalId"])
        simplified = store.payload("staging", class_name, interval["intervalId"])
        source = 0.0
        for chart in view.charts:
            youngest, oldest = chart["toAgeMa"], chart["fromAgeMa"]
            if youngest < interval["fromAgeMa"] and interval["toAgeMa"] < oldest:
                source += areas.get(chart["sourceRecordIndex"], 0.0)
        emitted = sum(audit.area_km2(compiler.piece_geometry(original, piece))
                      for piece in original["pieces"])
        declared = measured["emittedAreaSquareKilometres"]
        if declared > 0 and abs(emitted - declared) / declared * 100.0 > 0.05:
            raise CorrectionError(
                f"{class_name} {interval['intervalId']}: the emitted area re-derived from the payload "
                f"({emitted:.1f} km2) disagrees with the catalog ({declared:.1f} km2) by more than 0.05 %")
        # The cookie-cut is only lossless once the pieces the compiler declares it
        # dropped are added back: ground with no palette coverage for its plate, and
        # slivers below the 25 km2 floor. Both are declared per interval and both are
        # cross-checked above through the emitted term, so inflating one to hide
        # missing geometry fails this check.
        cut = (emitted + measured["unposableAreaSquareKilometres"]
               + measured["droppedBelowFloorSquareKilometres"])
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
        if measured["lostPieces"] > LOST_PIECES_PER_INTERVAL:
            raise CorrectionError(
                f"{class_name} {interval['intervalId']}: {measured['lostPieces']} lost pieces "
                f"exceed {LOST_PIECES_PER_INTERVAL}")
        if measured["largestLostPieceSquareKilometres"] > LARGEST_LOST_PIECE_KM2:
            raise CorrectionError(
                f"{class_name} {interval['intervalId']}: a lost piece of "
                f"{measured['largestLostPieceSquareKilometres']} km2 exceeds "
                f"{LARGEST_LOST_PIECE_KM2} km2")
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
                100.0 * sum(view.measurement(row["intervalId"])["unposableAreaSquareKilometres"]
                            for row in view.intervals)
                / total_source, 4) if total_source else 0.0,
            "simplificationAreaErrorPercent": round(class_error, 6),
            "worstIntervalSimplificationAreaErrorPercent": round(worst_interval_error, 6),
            "perInterval": per_interval}


def recovery_motion() -> tuple[set[int], dict[int, set[tuple[float, float]]]]:
    """Recovery plates and the source seams between their recovery entries.

    ``apply_cao_native_triangulation_repair`` rejects any chart on these plates that
    keeps a ``plate-`` binding ("same-plate charts retain inaccurate native motion"),
    so a palaeo piece must not keep one either. Its ``validate_binding_coverage``
    tolerates exactly one kind of hole in the coverage, the plate's declared
    ``SOURCE_DISCONTINUITY_GAPS``; those are re-derived here from the palette's own
    recovery entries so a binding cannot declare a seam the palette does not have.
    """
    if not hasattr(recovery_motion, "_cache"):
        catalog = compiler.load_palette()[0]
        by_plate: dict[int, list[dict]] = {}
        for entry in catalog["entries"]:
            if entry["entryId"].startswith(compiler.RECOVERY_PREFIX):
                by_plate.setdefault(entry["plateId"], []).append(entry)
        seams = {}
        for plate, entries in by_plate.items():
            rows = sorted(entries, key=lambda entry: entry["youngestAgeMa"])
            seams[plate] = {(float(left["oldestAgeMa"]), float(right["youngestAgeMa"]))
                            for left, right in zip(rows, rows[1:])
                            if float(right["youngestAgeMa"]) > float(left["oldestAgeMa"])}
        recovery_motion._cache = (set(by_plate), seams)
    return recovery_motion._cache


def piece_binding_windows(store: Store, view: ClassView) -> dict[tuple[int, int], tuple[float, float]]:
    """Every (binding, lifecycle) pair a shipped piece carries, and the window it needs.

    A piece is posed at any age inside its own ``(TOAGE, FROMAGE]`` lifecycle that
    also falls inside the interval its payload covers, so that intersection is
    exactly the span its binding has to resolve over.
    """
    windows: dict[tuple[int, int], tuple[float, float]] = {}
    for interval in view.intervals:
        decoded = store.payload("staging", view.class_name, interval["intervalId"])
        for piece in decoded["pieces"]:
            key = (piece["bindingIndex"], piece["lifecycleIndex"])
            youngest = max(float(piece["lifecycleYoungestMa"]), float(interval["toAgeMa"]))
            oldest = min(float(piece["lifecycleOldestMa"]), float(interval["fromAgeMa"]))
            found = windows.get(key)
            windows[key] = ((min(found[0], youngest), max(found[1], oldest)) if found
                            else (youngest, oldest))
    return windows


def check_bindings(store: Store, view: ClassView, overrides: dict,
                   by_plate: dict[int, list[dict]] | None = None) -> dict:
    """Collapsed binding rows, and gap-free resolution over every lifecycle that uses one.

    The shipped row is only (plate, partition, kind, seams); the gap-free chain of
    palette entries is resolved at the requested age by
    ``compiler.select_palette_entry``, the rule
    ``docs/data/palaeo-coastlines-format.md`` states normatively and the runtime
    implements. That makes the chain a derived quantity, so this check re-derives
    it here: for every (binding, lifecycle) pair a shipped piece actually carries,
    the rule must cover the whole window the piece is drawn over, except across the
    source seams the row declares, and it must agree entry for entry with the
    compiler's own chain builder.
    """
    class_name = view.class_name
    override_plates = set(overrides["classes"][class_name]["overridePlateIds"])
    recovery_plates, recovery_seams = recovery_motion()
    # `by_plate` is injectable so the self-test can prove the restoration and
    # coverage gates against a palette that is missing the entries they depend on.
    if by_plate is None:
        _, by_plate = compiler.load_palette()
    restoration_plates = {plate for plate, entries in by_plate.items()
                          if any(entry["entryId"].startswith(compiler.RESTORATION_PREFIX)
                                 for entry in entries)}
    seen_override_plates: set[int] = set()
    kinds = {name: 0 for name in compiler.BINDING_KINDS}
    for index, binding in enumerate(view.bindings):
        plate = binding["bindingPlateId"]
        partition = binding["partitionPlateId"]
        kind = binding["kind"]
        if kind not in kinds:
            raise CorrectionError(f"binding {index}: unknown kind {kind!r}")
        kinds[kind] += 1
        declared = {(gap["youngestMa"], gap["oldestMa"])
                    for gap in binding["motionSupportGaps"]}
        allowed = recovery_seams.get(plate, set())
        if declared != allowed:
            raise CorrectionError(
                f"binding {index}: declares source seams {sorted(declared)} but plate {plate} has "
                f"{sorted(allowed)} in the palette")
        expected_kind = ("restoration" if plate in restoration_plates
                         else "recovery" if plate in recovery_plates
                         else "override" if plate in override_plates and plate != partition
                         else None)
        if kind == "override":
            seen_override_plates.add(plate)
            if plate not in override_plates:
                raise CorrectionError(
                    f"binding {index}: plate {plate} is bound by PLATEID1 but is not in the "
                    "tracked override table")
        elif plate != partition:
            raise CorrectionError(
                f"binding {index}: a piece is bound to plate {plate} while its partition owner is "
                f"{partition} without an override")
        if expected_kind is not None and kind != expected_kind:
            raise CorrectionError(
                f"binding {index}: plate {plate} resolves as a {expected_kind} binding but the row "
                f"says {kind}")
        if kind == "restoration" and partition not in NORTH_SEA_PLATES:
            raise CorrectionError(
                f"binding {index}: a restoration binding on partition {partition}, which is not a "
                "North Sea partition")

    windows = piece_binding_windows(store, view)
    restoration_windows = 0
    seam_windows = 0
    for (binding_index, lifecycle_index), (youngest, oldest) in sorted(windows.items()):
        if binding_index >= len(view.bindings):
            raise CorrectionError(f"a piece names binding {binding_index}, which the catalog lacks")
        binding = view.bindings[binding_index]
        plate = binding["bindingPlateId"]
        segments, holes = compiler.resolve_binding_coverage(by_plate, plate, youngest, oldest)
        declared = {(gap["youngestMa"], gap["oldestMa"]) for gap in binding["motionSupportGaps"]}
        for hole in holes:
            if hole not in declared:
                raise CorrectionError(
                    f"binding {binding_index} (plate {plate}) does not resolve gap-free over "
                    f"lifecycle {lifecycle_index}: no palette entry covers "
                    f"{hole[0]}-{hole[1]} Ma inside [{youngest}, {oldest}] Ma, and the row declares "
                    "no source seam there")
        if not segments:
            raise CorrectionError(
                f"binding {binding_index} (plate {plate}) resolves to no palette entry at all over "
                f"[{youngest}, {oldest}] Ma")
        if holes:
            seam_windows += 1
        chain = compiler.binding_entries(by_plate, plate, youngest, oldest)
        if chain is None:
            raise CorrectionError(
                f"binding {binding_index} (plate {plate}): the chain builder finds no coverage over "
                f"[{youngest}, {oldest}] Ma that the pointwise rule resolved")
        if [entry_id for entry_id, _, _ in chain[0]] != [entry_id for entry_id, _, _ in segments]:
            raise CorrectionError(
                f"binding {binding_index} (plate {plate}): the pointwise entry rule and the chain "
                f"builder disagree over [{youngest}, {oldest}] Ma "
                f"({[entry_id for entry_id, _, _ in segments][:3]} vs "
                f"{[entry_id for entry_id, _, _ in chain[0]][:3]})")
        if any(entry_id.startswith(compiler.RESTORATION_PREFIX) for entry_id, _, _ in segments):
            restoration_windows += 1
            if binding["partitionPlateId"] not in NORTH_SEA_PLATES:
                raise CorrectionError(
                    f"binding {binding_index}: restoration motion on partition "
                    f"{binding['partitionPlateId']}")
        if binding["partitionPlateId"] in NORTH_SEA_PLATES and binding["kind"] != "override":
            # A North Sea piece above the restoration window must take the restored
            # motion; native motion there detaches it from the restored shelf.
            above = [(entry_id, low, high) for entry_id, low, high in segments
                     if high > RESTORATION_WINDOW_YOUNGEST_MA]
            native = [entry_id for entry_id, _, _ in above
                      if not entry_id.startswith(compiler.RESTORATION_PREFIX)]
            if native:
                raise CorrectionError(
                    f"binding {binding_index}: a piece on North Sea partition "
                    f"{binding['partitionPlateId']} takes native motion {native[:2]} above "
                    f"{RESTORATION_WINDOW_YOUNGEST_MA} Ma instead of the restoration entry")
        if plate in recovery_plates:
            stale = [entry_id for entry_id, _, _ in segments
                     if entry_id.startswith(f"plate-{plate}-")]
            if stale:
                raise CorrectionError(
                    f"binding {binding_index}: plate {plate} carries recovered native motion but "
                    f"this window resolves to inaccurate native entries {stale[:3]}")
    return {"bindings": len(view.bindings), "bindingKinds": kinds,
            "resolvedWindows": len(windows),
            "overrideBoundPlates": sorted(seen_override_plates),
            "restorationWindows": restoration_windows,
            "sourceSeamWindows": seam_windows,
            "recoveryPlateIds": sorted(recovery_plates)}


#: Slack, in degrees, between the bounding box the compiler tested (the
#: unsimplified cut piece) and the one this check re-derives (the simplified,
#: int16-quantised ring). Node reduction only ever shrinks a box, so an accepted
#: override stays inside to within the 0.003 degree quantisation step and 0.05
#: is an order of magnitude of headroom. The converse is deliberately not
#: asserted: node reduction can drop a whole small component of a multi-part
#: piece (measured 2026-09-15, sm record 6902 at 94-81 Ma is cut to a piece
#: reaching 8.537 E unsimplified and 9.256 E as shipped), so a declined piece
#: can look enclosed once simplified.
OVERRIDE_FOOTPRINT_TOLERANCE_DEGREES = 0.05


def check_charts_use_overrides(store: Store, view: ClassView, overrides: dict) -> dict:
    """A piece is rebound by its PLATEID1 exactly where that plate's footprint allows it.

    A piece bound as ``override`` must carry its source PLATEID1 as the binding
    plate *and* lie entirely inside that override entry's declared footprint:
    without the second half a PLATEID1 value alone moved ground an ocean away
    onto a small plate (measured 2026-09-15, the Apulia 3307 override reached
    3.7-31.6 E and 36.0-55.8 N from a plate whose present-day crust spans
    15.2-19.3 E). A piece whose PLATEID1 is in the table but which is not bound
    as an override is counted and reported rather than asserted about: the
    shipped ring cannot prove where the *unsimplified* cut piece reached, and the
    compiler's own per-plate accepted/declined tallies are in the provenance
    sidecar. The test is the piece's bounding box, not a seat: a representative
    point is not stable under node reduction for a multi-part piece.
    """
    class_name = view.class_name
    entries = {row["plateId1"]: row for row in overrides["classes"][class_name]["plates"]}
    slack = OVERRIDE_FOOTPRINT_TOLERANCE_DEGREES
    checked = 0
    declined = 0
    for interval in view.intervals:
        decoded = store.payload("staging", class_name, interval["intervalId"])
        for piece in decoded["pieces"]:
            chart = view.charts[piece["chartIndex"]]
            binding = view.bindings[piece["bindingIndex"]]
            plate = chart["plateId1"]
            entry = entries.get(plate)
            actual = binding["kind"] == "override"
            if bool(piece["flags"] & compiler.FLAG_PLATEID1_OVERRIDE) != actual:
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: the override flag disagrees with the binding")
            if actual and entry is None:
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: piece is bound as an override but its "
                    f"source plate {plate} is not in the override table")
            if entry is None:
                continue
            if actual and binding["bindingPlateId"] != plate:
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: override piece is bound to plate "
                    f"{binding['bindingPlateId']}, not to its PLATEID1 {plate}")
            west, south, east, north = entry["footprint"]["bufferedBbox"]
            left, bottom, right, top = compiler.piece_geometry(decoded, piece).bounds
            inside = (west - slack <= left and right <= east + slack
                      and south - slack <= bottom and top <= north + slack)
            if actual and not inside:
                box = [round(value, 3) for value in (left, bottom, right, top)]
                raise CorrectionError(
                    f"{class_name} {interval['intervalId']}: override piece for plate {plate} "
                    f"spans {box}, outside its declared footprint {[west, south, east, north]}")
            checked += 1
            if not actual:
                declined += 1
    return {"checkedPieces": checked, "declinedByFootprint": declined,
            "overridePlates": sorted(entries),
            "footprintToleranceDegrees": slack}


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


def check_one_owner(store: Store, view: ClassView, tier: str = "original",
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
    class_name = view.class_name
    worst = 0.0
    worst_width = 0.0
    compared = 0
    for interval in view.intervals:
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


def check_co_moving(view: ClassView) -> dict:
    measured = view.provenance["poseAudit"]["coMovingAreaPercent"]["under25Km"]
    if view.class_name == "lm" and measured < CO_MOVING_LM_MINIMUM_PERCENT:
        raise CorrectionError(
            f"lm co-moving area {measured} % is below {CO_MOVING_LM_MINIMUM_PERCENT} %")
    return {"coMovingUnder25KmPercent": measured}


def check_frame_conflict_oracle(store: Store, view: ClassView,
                                rotations, interval_ids: tuple[str, ...]) -> dict:
    """Recompute the frame-conflict flag from the rotation model on sampled intervals."""
    class_name = view.class_name
    by_id = {row["intervalId"]: row for row in view.intervals}
    checked = 0
    for interval_id in interval_ids:
        interval = by_id.get(interval_id)
        if interval is None:
            continue
        decoded = store.payload("staging", class_name, interval_id)
        age = interval["midAgeMa"]
        for piece in decoded["pieces"]:
            chart = view.charts[piece["chartIndex"]]
            binding = view.bindings[piece["bindingIndex"]]
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


def check_witnesses(store: Store, classes: list[str], explain=None,
                    witnesses: dict | None = None) -> dict:
    """The compiled payloads reproduce the audit's class table at every witness.

    A class the audit measured may legitimately be absent where the compiler
    declared the ground unposable: the plate that owns it has no gap-free motion
    palette coverage over the interval, so the piece was dropped rather than
    posed with an invented rotation. ``explain`` re-derives that reason from the
    source records, the static partitions and the palette; an absence it cannot
    explain is a defect.
    """
    witnesses = WITNESS_CLASSES if witnesses is None else witnesses
    rows = []
    explained = []
    for interval_id in WITNESS_INTERVALS:
        unions = {name: class_union(store, name, interval_id) for name in classes}
        for witness, (position, expected_by_interval) in witnesses.items():
            source_expected = expected_by_interval.get(interval_id)
            if source_expected is None:
                continue
            edit = WITNESS_BASIN_EDITS.get((witness, interval_id))
            expected = [name for name in (edit["classes"] if edit else source_expected)
                        if name in classes]
            point = shapely.Point(*position)
            found = sorted(name for name, geometry in unions.items()
                           if not geometry.is_empty and geometry.contains(point))
            if found == sorted(expected):
                row = {"witnessId": witness, "intervalId": interval_id, "classes": found}
                if edit:
                    row["basinEdit"] = {"opId": edit["opId"],
                                        "caoSourceClasses": sorted(source_expected),
                                        "reason": edit["reason"]}
                rows.append(row)
                continue
            missing = sorted(set(expected) - set(found))
            unexpected = sorted(set(found) - set(expected))
            reason = (explain(witness, position, interval_id, missing)
                      if explain is not None and missing and not unexpected else None)
            if reason is None:
                measured = (f"the audit measured {sorted(source_expected)} and basin edit "
                            f"{edit['opId']} expects {sorted(edit['classes'])}" if edit
                            else f"the audit measured {sorted(expected)}")
                raise CorrectionError(
                    f"witness {witness} at {interval_id}: compiled classes {found}, {measured}")
            explained.append({"witnessId": witness, "intervalId": interval_id,
                              "missingClasses": missing, **reason})
            rows.append({"witnessId": witness, "intervalId": interval_id, "classes": found,
                         "explainedAbsence": reason["reason"]})
    return {"checkedWitnesses": len(rows), "explainedAbsences": explained, "rows": rows}


def check_basin_edit_witnesses(store: Store, classes: list[str], basins: list[dict],
                               rows_by_class: dict[str, list[dict]],
                               intervals: list[dict]) -> dict:
    """Every cited basin edit reached the shipped payloads, and nothing else moved.

    Two kinds of row. A row naming operations asserts that the edited point now
    carries the class set the edit intends; a row naming none is a control inside
    the same basin window and interval that the edit must leave exactly as Cao
    drew it. The Cao source class set is re-measured from the pinned archive for
    both, so the record reports what changed rather than asserting it, and the
    operations a row names are checked against the tracked contract: a row whose
    operation has been deleted fails instead of quietly passing.
    """
    known_ops = {op["opId"] for basin in basins for op in basin["ops"]}
    by_id = {interval["intervalId"]: interval for interval in intervals}
    points = [shapely.Point(*witness["position"]) for witness in BASIN_EDIT_WITNESSES]
    # One densified source polygon per record that covers any witness point, built
    # once: `record_polygon` is the expensive call and there are thousands of rows.
    source_hits: dict[tuple[str, int], list[int]] = {}
    for name in classes:
        for row in rows_by_class[name]:
            if row["toAge"] is None or row["fromAge"] is None or row["toAge"] >= row["fromAge"]:
                continue
            geometry = compiler.record_polygon(row, densify=False)
            inside = [index for index, point in enumerate(points) if geometry.contains(point)]
            if inside:
                source_hits[(name, row["index"])] = inside
    unions: dict[tuple[str, str], object] = {}
    rows = []
    for index, witness in enumerate(BASIN_EDIT_WITNESSES):
        missing_ops = sorted(set(witness["opIds"]) - known_ops)
        if missing_ops:
            raise CorrectionError(
                f"basin-edit witness {witness['witnessId']}: operations {missing_ops} are not in "
                "any tracked basin contract")
        interval = by_id[witness["intervalId"]]
        point = points[index]
        expected = sorted(name for name in witness["classes"] if name in classes)
        found = []
        for name in classes:
            key = (name, witness["intervalId"])
            if key not in unions:
                unions[key] = class_union(store, name, witness["intervalId"])
            union = unions[key]
            if not union.is_empty and union.contains(point):
                found.append(name)
        found.sort()
        if found != expected:
            raise CorrectionError(
                f"basin-edit witness {witness['witnessId']} at {witness['intervalId']}: compiled "
                f"classes {found}, the contract expects {expected} "
                f"(operations {witness['opIds'] or 'none: this is an unedited control'})")
        source = sorted(
            name for name in classes
            if any(index in source_hits.get((name, row["index"]), ())
                   for row in rows_by_class[name]
                   if row["toAge"] is not None and row["fromAge"] is not None
                   and row["toAge"] < interval["fromAgeMa"]
                   and interval["toAgeMa"] < row["fromAge"]))
        rows.append({"witnessId": witness["witnessId"], "intervalId": witness["intervalId"],
                     "position": list(witness["position"]), "opIds": list(witness["opIds"]),
                     "caoSourceClasses": source, "compiledClasses": found,
                     "changed": source != found})
    return {"checkedWitnesses": len(rows), "editedWitnesses": sum(1 for row in rows if row["opIds"]),
            "controls": sum(1 for row in rows if not row["opIds"]), "rows": rows}


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


ICELAND_BASIN_ID = "iceland"
ICELAND_CORRECTION_GEOMETRY = ROOT / "data/corrections/iceland/iceland-surface-material-v1.geojson"
ICELAND_CORRECTION_CLASS = "gold"


def _parallel_segments(geometry, line):
    pieces = geometry.intersection(line)
    if pieces.is_empty:
        return []
    return [part for part in getattr(pieces, "geoms", [pieces])
            if part.geom_type == "LineString"]


def _seam_longitude(west_geometry, east_geometry, latitude: float,
                    window: tuple, abutment_degrees: float) -> float | None:
    """Where the two plate halves are cut apart on one parallel, or None.

    A seam crossing is a pair of ground segments - one on each plate - that ABUT
    on the parallel. Taking the eastern limit of all western ground and the
    western limit of all eastern ground instead would measure the gap between two
    separate lobes wherever the parallel misses the cut, and Iceland has exactly
    that: the Tertiary outcrop is absent along the neovolcanic zones, which is
    also roughly where the partition seam runs. ``abutment_degrees`` is the widest
    gap still read as one cut, and it has to allow for the int16 quantisation and
    the per-piece simplification of the two cut edges.
    """
    line = LineString([(window[0], latitude), (window[2], latitude)])
    best = None
    for west in _parallel_segments(west_geometry, line):
        for east in _parallel_segments(east_geometry, line):
            gap = east.bounds[0] - west.bounds[2]
            if -1e-9 <= gap <= abutment_degrees and (best is None or gap < best[1]):
                best = ((west.bounds[2] + east.bounds[0]) / 2.0, gap)
    return None if best is None else best[0]


def check_iceland_seam(store: Store, classes: list[str], basins: list[dict]) -> dict:
    """The Iceland contract's own two checks, from its notes.seamCheck.

    The palaeo compiler cuts Iceland on the Cao 2024 static-partition seam - plate
    102 (Greenland) west, 301 (Eurasia) east - while the regional Iceland material
    correction cuts it on the exact shared 101/301 mid-ocean-ridge subsegments.
    Plates 101 and 102 are measured co-moving to 0.0 km over 0-29 Ma, so the risk
    is the seam LINE and not the rotations: the two halves separate by 210 km by
    11 Ma, and ground assigned to the wrong half moves with the wrong plate.

    Two assertions, both read from the tracked contract rather than from constants
    here: every compiled piece that lies wholly inside the contract window binds
    to one of the declared partition plates, and each latitude's measured
    separation matches the value the contract pins. The contract does NOT claim
    the two seams agree - they are 19.7 to 60.6 km apart - so this gate detects
    drift in either construction rather than asserting an agreement.
    """
    basin = next((row for row in basins if row["basinId"] == ICELAND_BASIN_ID), None)
    if basin is None:
        return {"status": "not declared", "reason": "no iceland basin contract is tracked"}
    spec = basin["notes"]["seamCheck"]
    allowed = set(spec["partitionPlateIds"])
    window = tuple(basin["window"]["bbox"])
    window_box = shapely.box(*window)
    tolerance_km = float(spec["toleranceKilometres"])
    drift_km = float(spec["driftToleranceKilometres"])
    abutment = float(spec["abutmentToleranceDeg"])
    pinned = spec["measuredSeparationKilometres"]

    by_plate: dict[int, list] = {}
    checked_pieces = 0
    for class_name in classes:
        partitions = store.catalog(class_name)["bindings"]["partitionPlateId"]
        for interval_id in basin["intervals"]:
            decoded = store.payload("staging", class_name, interval_id)
            for piece in decoded["pieces"]:
                geometry = compiler.piece_geometry(decoded, piece)
                if geometry.is_empty or not window_box.contains(geometry):
                    continue
                plate = int(partitions[piece["bindingIndex"]])
                if plate not in allowed:
                    raise CorrectionError(
                        f"iceland: a {class_name} piece in {interval_id} binds to partition "
                        f"{plate}; the contract declares {sorted(allowed)}")
                checked_pieces += 1
                if class_name == "lm":
                    by_plate.setdefault(plate, []).append(geometry)
    if checked_pieces == 0:
        raise CorrectionError("iceland: the contract is tracked but no compiled piece lies "
                              "inside its window")
    west_id, east_id = sorted(allowed)
    if west_id not in by_plate or east_id not in by_plate:
        raise CorrectionError(
            f"iceland: the compiled landmass carries ground on only one of plates {west_id} "
            f"and {east_id}, so the seam cannot be measured")
    palaeo_west = unary_union(by_plate[west_id])
    palaeo_east = unary_union(by_plate[east_id])

    collection = json.loads(ICELAND_CORRECTION_GEOMETRY.read_text())
    correction: dict[int, list] = {}
    for feature in collection["features"]:
        if feature["properties"].get("sourceClass") != ICELAND_CORRECTION_CLASS:
            continue
        correction.setdefault(int(feature["properties"]["plateId"]), []).append(
            compiler.polygonal(shapely.geometry.shape(feature["geometry"])))
    if len(correction) != 2:
        raise CorrectionError("iceland: the material correction no longer splits the gold "
                              "outcrop across exactly two plates")
    correction_west_id, correction_east_id = sorted(correction)
    correction_west = unary_union(correction[correction_west_id])
    correction_east = unary_union(correction[correction_east_id])

    sweep = spec["latitudeSweepDeg"]
    latitudes = []
    latitude = float(sweep["from"])
    while latitude <= float(sweep["to"]) + 1e-9:
        latitudes.append(round(latitude, 2))
        latitude += float(sweep["stepDeg"])
    rows = []
    worst = 0.0
    for latitude in latitudes:
        palaeo = _seam_longitude(palaeo_west, palaeo_east, latitude, window, abutment)
        reference = _seam_longitude(correction_west, correction_east, latitude, window, abutment)
        key = f"{latitude:.1f}"
        if palaeo is None or reference is None:
            if key in pinned:
                raise CorrectionError(
                    f"iceland seam at {key} N: the contract pins {pinned[key]} km but one of the "
                    "two constructions no longer cuts outcrop on this parallel")
            continue
        kilometres = abs(palaeo - reference) * (
            2.0 * math.pi * audit.EARTH_RADIUS_KM / 360.0) * math.cos(math.radians(latitude))
        worst = max(worst, kilometres)
        if kilometres > tolerance_km:
            raise CorrectionError(
                f"iceland seam at {key} N: the palaeo {west_id}/{east_id} cut is at "
                f"{palaeo:.3f} E and the material correction's {correction_west_id}/"
                f"{correction_east_id} cut at {reference:.3f} E, {kilometres:.1f} km apart, "
                f"above the contract's {tolerance_km} km tolerance")
        if key not in pinned:
            raise CorrectionError(
                f"iceland seam at {key} N: both constructions now cut outcrop here "
                f"({kilometres:.1f} km apart) and the contract pins no value for it")
        if abs(kilometres - float(pinned[key])) > drift_km:
            raise CorrectionError(
                f"iceland seam at {key} N: {kilometres:.1f} km, and the contract pins "
                f"{pinned[key]} km")
        rows.append({"latitudeDeg": latitude, "palaeoSeamDeg": round(palaeo, 4),
                     "correctionSeamDeg": round(reference, 4),
                     "separationKilometres": round(kilometres, 2)})
    if len(rows) < int(spec["minimumComparedLatitudes"]):
        raise CorrectionError(
            f"iceland: only {len(rows)} latitudes cut outcrop on both constructions; the "
            f"contract requires {spec['minimumComparedLatitudes']}")
    if len(rows) != len(pinned):
        raise CorrectionError(
            f"iceland: {len(rows)} latitudes compared against {len(pinned)} pinned values")
    return {"checkedPieces": checked_pieces, "toleranceKilometres": tolerance_km,
            "worstSeparationKilometres": round(worst, 2), "rows": rows}


def check_basin_acceptance_ages(basins: list[dict], intervals: list[dict]) -> dict:
    """Every acceptance age a contract declares selects the interval it names.

    A contract can name the ages its operations are meant to be visible at; this
    resolves each one through the same half-open ``(toAge, fromAge]`` rule the
    runtime uses. ``None`` means the age falls outside the whole published band,
    where the layer falls back to today's composition.
    """
    rows = []
    for basin in basins:
        declared = basin.get("notes", {}).get("acceptanceAges")
        if not declared:
            continue
        for age, expected in declared["ages"]:
            selected = [row["intervalId"] for row in intervals
                        if row["toAgeMa"] < age <= row["fromAgeMa"]]
            if len(selected) > 1:
                raise CorrectionError(
                    f"basin {basin['basinId']}: age {age} Ma selects {selected}")
            found = selected[0] if selected else None
            if found != expected:
                raise CorrectionError(
                    f"basin {basin['basinId']}: age {age} Ma selects {found!r}, and the contract "
                    f"declares {expected!r}")
            rows.append({"basinId": basin["basinId"], "ageMa": age, "intervalId": found})
    return {"checkedAges": len(rows), "rows": rows}


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
    views = {name: ClassView.load(store, name) for name in classes}
    interval_ids = {row["intervalId"] for row in views[classes[0]].intervals}
    basins = compiler.load_basins(interval_ids)
    rows_by_class = load_source_records()
    areas = source_areas(rows_by_class, basins, views[classes[0]].intervals)
    rotations = pygplates.RotationModel([str(audit.ROTATION_YOUNG), str(audit.ROTATION_OLD)],
                                        default_anchor_plate_id=0)
    audit.check_rotation_model([audit.ROTATION_YOUNG, audit.ROTATION_OLD])

    result: dict = {"inputs": check_inputs(manifest),
                    "config": check_config(overrides, basins, interval_ids),
                    "classes": {}}
    for class_name in classes:
        view = views[class_name]
        rows_by_index = {row["index"]: row for row in rows_by_class[class_name]}
        block = {
            "provenance": check_provenance(store, view),
            "catalogBytes": len(store.read(
                f"staging/{class_name}/palaeo-{class_name}-catalog.json")),
            "payloads": check_payload_identity(store, view),
            "schedule": check_schedule(view),
            "catalogIndices": check_catalog_indices(store, view),
            "lifecycles": check_lifecycles(store, view, rows_by_index),
            "areas": check_areas(store, view, areas[class_name]),
            "bindings": check_bindings(store, view, overrides),
            "overrides": check_charts_use_overrides(store, view, overrides),
            "coMoving": check_co_moving(view),
        }
        if full:
            block["oneOwner"] = check_one_owner(store, view, "original",
                                                QUANTISATION_SEAM_WIDTH_KM)
            block["simplifiedSeams"] = check_one_owner(store, view, "staging",
                                                       SIMPLIFIED_SEAM_WIDTH_KM)
            block["frameConflictOracle"] = check_frame_conflict_oracle(
                store, view, rotations, WITNESS_INTERVALS)
        block["areas"].pop("perInterval", None)
        result["classes"][class_name] = block
    explain = build_explainer(rows_by_class, overrides, views[classes[0]].intervals)
    result["witnesses"] = check_witnesses(store, classes, explain)
    result["basinEditWitnesses"] = check_basin_edit_witnesses(
        store, classes, basins, rows_by_class, views[classes[0]].intervals)
    result["icelandSeam"] = check_iceland_seam(store, classes, basins)
    result["acceptanceAges"] = check_basin_acceptance_ages(basins, views[classes[0]].intervals)
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


PIECE_FIELD_OFFSETS = {"chartIndex": 0, "bindingIndex": 2, "evidenceIndex": 4,
                       "lifecycleIndex": 6, "flags": 8, "ringCount": 10}


def rewrite_piece_field(payload: bytes, index: int, field: str, value: int) -> bytes:
    """Set one u16 field of one piece record, leaving the payload otherwise intact."""
    data = bytearray(payload)
    offset = compiler.HEADER_BYTES + compiler.PIECE_BYTES * index
    struct.pack_into("<H", data, offset + PIECE_FIELD_OFFSETS[field], int(value))
    return bytes(data)


def self_test(store: Store, class_name: str = "lm") -> dict:
    """Prove each gate can fail, then prove the clean inputs pass again."""
    manifest = compiler.load_json(CONFIG / "sources.json")
    overrides = compiler.load_json(CONFIG / "overrides.json")
    simplification = compiler.load_json(CONFIG / "simplification.json")
    view = ClassView.load(store, class_name)
    catalog = view.catalog
    interval_ids = {row["intervalId"] for row in view.intervals}
    basins = compiler.load_basins(interval_ids)
    rows_by_class = load_source_records()
    rows_by_index = {row["index"]: row for row in rows_by_class[class_name]}
    areas = source_areas({class_name: rows_by_class[class_name]}, basins, view.intervals)[class_name]
    catalog_relative = f"staging/{class_name}/palaeo-{class_name}-catalog.json"
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
        "rationale": "self-test", "spatialUncertaintyKilometres": 25.0,
        "editorial": compiler.EDITORIAL_PREFIX + "nothing at all",
        "references": []})
    results.append(expect_failure("basin edit operation with no reference",
                                  lambda: check_config(overrides, dropped, interval_ids)))
    # An operation is scoped twice: by the contract's window bbox and by the
    # intervals the contract declares. Both scopes are proven here, because a
    # breach of either would edit ground or an age no citation in the contract
    # reaches. The template is a real operation from the contract, so the
    # mutation differs from a shipped edit in exactly the scope under test.
    template = deepcopy(basins[0]["ops"][0]) if basins[0]["ops"] else {
        "opId": "self-test-op", "kind": "add-shallow",
        "intervalIds": [basins[0]["intervals"][0]] if basins[0].get("intervals") else ["269-248"],
        "geometry": {"type": "Polygon",
                     "coordinates": [[[2.0, 55.0], [3.0, 55.0], [3.0, 56.0], [2.0, 56.0], [2.0, 55.0]]]},
        "rationale": "self-test", "spatialUncertaintyKilometres": 25.0,
        "editorial": compiler.EDITORIAL_PREFIX + "the contract references",
        "references": [basins[0]["references"][0]["sourceId"]]}
    outside_window = deepcopy(basins)
    escaped = deepcopy(template)
    escaped["opId"] = "self-test-outside-window"
    minimum_lon, minimum_lat, maximum_lon, maximum_lat = basins[0]["window"]["bbox"]
    shift = (maximum_lon - minimum_lon) + 5.0
    escaped["geometry"] = shapely.geometry.mapping(
        shapely.affinity.translate(shapely.geometry.shape(template["geometry"]), xoff=shift))
    outside_window[0]["ops"].append(escaped)
    results.append(expect_failure(
        f"basin edit operation whose geometry is {shift} degrees outside the basin window",
        lambda: check_config(overrides, outside_window, interval_ids)))
    undeclared = deepcopy(basins)
    stray = deepcopy(template)
    stray["opId"] = "self-test-undeclared-interval"
    stray["intervalIds"] = [next(interval_id for interval_id in sorted(interval_ids)
                                 if interval_id not in basins[0].get("intervals", []))]
    undeclared[0]["ops"].append(stray)
    results.append(expect_failure(
        f"basin edit operation on {stray['intervalIds'][0]}, an interval the contract does not declare",
        lambda: check_config(overrides, undeclared, interval_ids)))
    uncited = deepcopy(overrides)
    uncited["classes"][class_name]["plates"][0]["sourceIds"] = []
    results.append(expect_failure("PLATEID1 override with no citation",
                                  lambda: check_config(uncited, basins, interval_ids)))
    check_config(overrides, basins, interval_ids)

    # 2b. a provenance sidecar whose bytes no longer match the digest the catalog pins
    check_provenance(store, view)
    tampered_bytes = bytearray(store.provenance_bytes(class_name))
    tampered_bytes.extend(b" \n")
    tampered_store = store.with_override(
        f"provenance/palaeo-{class_name}-provenance.json", bytes(tampered_bytes))
    results.append(expect_failure(
        "provenance sidecar edited without a catalog update",
        lambda: check_provenance(tampered_store, ClassView(
            class_name, catalog, json.loads(bytes(tampered_bytes))))))
    shortened = deepcopy(view.provenance)
    shortened["charts"]["count"] -= 1
    for field in compiler.CHART_PROVENANCE_FIELDS:
        shortened["charts"][field] = shortened["charts"][field][:-1]
    results.append(expect_failure(
        "provenance sidecar missing a source record the catalog counts",
        lambda: check_provenance(
            store.with_override(f"provenance/palaeo-{class_name}-provenance.json",
                                json.dumps(shortened).encode()),
            ClassView(class_name, catalog, shortened))))
    check_provenance(store, view)

    # 3. a piece rebound to the wrong lifecycle, and a widened catalog lifecycle
    interval = view.intervals[16]
    relative = view.payload_relative(interval["intervalId"])
    original_bytes = store.read(relative)
    check_lifecycles(store, view, rows_by_index)
    first = compiler.decode_ehpr(original_bytes)["pieces"][0]["lifecycleIndex"]
    wrong = next(index for index, row in enumerate(view.lifecycles)
                 if row["oldestMa"] != view.lifecycles[first]["oldestMa"])
    widened = rewrite_piece_field(original_bytes, 0, "lifecycleIndex", wrong)
    widened_store = store.with_override(relative, widened)
    results.append(expect_failure(
        f"piece lifecycle index rebound from {first} to {wrong}",
        lambda: check_lifecycles(widened_store, view, rows_by_index)))
    stretched = deepcopy(catalog)
    stretched["lifecycles"]["oldestMa"][first] = 1200.0
    stretched_view = view.mutated(catalog=stretched)
    stretched_store = store.with_override(catalog_relative, json.dumps(stretched).encode())
    results.append(expect_failure(
        "catalog lifecycle widened to 1200 Ma",
        lambda: check_lifecycles(stretched_store, stretched_view, rows_by_index)))
    check_lifecycles(store, view, rows_by_index)

    # 3b. a catalog index a piece cannot reach
    check_catalog_indices(store, view)
    truncated = deepcopy(catalog)
    truncated["lifecycles"] = {"count": 1,
                               "youngestExclusiveMa": truncated["lifecycles"]["youngestExclusiveMa"][:1],
                               "oldestMa": truncated["lifecycles"]["oldestMa"][:1]}
    results.append(expect_failure(
        "class catalog missing the lifecycles its pieces name",
        lambda: check_catalog_indices(store, view.mutated(catalog=truncated))))
    shrunk = deepcopy(catalog)
    shrunk["chartCount"] = 1
    results.append(expect_failure(
        "catalog chartCount below the source-record ordinals its pieces carry",
        lambda: check_catalog_indices(store, view.mutated(catalog=shrunk))))
    check_catalog_indices(store, view)

    # 4. an override plate rebound to its partition
    check_bindings(store, view, overrides)
    check_charts_use_overrides(store, view, overrides)
    rebound = deepcopy(catalog)
    kinds = rebound["bindingKinds"]
    target = next(index for index, kind in enumerate(rebound["bindings"]["kind"])
                  if kinds[kind] == "override"
                  and rebound["bindings"]["bindingPlateId"][index] == 606)
    rebound["bindings"]["kind"][target] = kinds.index("partition")
    rebound["bindings"]["bindingPlateId"][target] = rebound["bindings"]["partitionPlateId"][target]
    results.append(expect_failure(
        "Lhasa 606 rebound to its partition owner",
        lambda: check_charts_use_overrides(store, view.mutated(catalog=rebound), overrides)))
    check_charts_use_overrides(store, view, overrides)

    # 4b. an override footprint that no longer contains the pieces it rebound.
    # This is the gate that stops a PLATEID1 value from carrying ground an ocean
    # away onto a small plate, so it is proved by moving the footprint, not the
    # piece: every accepted override for 606 is then outside its own declaration.
    moved_footprint = deepcopy(overrides)
    entry = next(row for row in moved_footprint["classes"][class_name]["plates"]
                 if row["plateId1"] == 606)
    west, south, east, north = entry["footprint"]["bufferedBbox"]
    entry["footprint"]["bufferedBbox"] = [west - 180.0, south, east - 180.0, north]
    results.append(expect_failure(
        "the Lhasa 606 override footprint moved off the pieces it rebound",
        lambda: check_charts_use_overrides(store, view, moved_footprint)))
    dropped_footprint = deepcopy(overrides)
    for row in dropped_footprint["classes"][class_name]["plates"]:
        row.pop("footprint", None)
    results.append(expect_failure(
        "an override entry with no declared footprint",
        lambda: check_config(dropped_footprint, basins, interval_ids)))
    check_charts_use_overrides(store, view, overrides)

    # 5. a North Sea piece that skips the restoration binding
    _, by_plate = compiler.load_palette()
    without_restoration = {plate: [entry for entry in entries
                                   if not entry["entryId"].startswith(compiler.RESTORATION_PREFIX)]
                           for plate, entries in by_plate.items()}
    results.append(expect_failure(
        "North Sea partitions resolved without their restoration palette entries",
        lambda: check_bindings(store, view, overrides, without_restoration)))
    mislabelled = deepcopy(catalog)
    target = next(index for index, partition in enumerate(mislabelled["bindings"]["partitionPlateId"])
                  if partition in NORTH_SEA_PLATES
                  and kinds[mislabelled["bindings"]["kind"][index]] == "restoration")
    mislabelled["bindings"]["kind"][target] = kinds.index("partition")
    results.append(expect_failure(
        "North Sea restoration binding shipped as a plain partition binding",
        lambda: check_bindings(store, view.mutated(catalog=mislabelled), overrides)))

    # 5b. a binding row that does not resolve gap-free over a lifecycle that uses it
    starved = deepcopy(catalog)
    starved["bindings"]["bindingPlateId"][0] = UNCOVERED_PLATE_ID
    starved["bindings"]["partitionPlateId"][0] = UNCOVERED_PLATE_ID
    starved["bindings"]["kind"][0] = kinds.index("partition")
    results.append(expect_failure(
        f"binding rebound to plate {UNCOVERED_PLATE_ID}, which the palette does not cover",
        lambda: check_bindings(store, view.mutated(catalog=starved), overrides)))

    # 5c. a recovery plate that keeps its inaccurate native motion, and an invented seam
    recovery_plates, _ = recovery_motion()
    reverted = deepcopy(catalog)
    target = next(index for index, plate in enumerate(reverted["bindings"]["bindingPlateId"])
                  if plate in recovery_plates)
    recovery_plate = reverted["bindings"]["bindingPlateId"][target]
    reverted["bindings"]["kind"][target] = kinds.index("partition")
    results.append(expect_failure(
        f"plate {recovery_plate} shipped as a plain partition binding instead of a recovery one",
        lambda: check_bindings(store, view.mutated(catalog=reverted), overrides)))
    invented = deepcopy(catalog)
    invented["gapSets"].append([{"youngestMa": 40.0, "oldestMa": 41.0, "reason": "source-seam"}])
    invented["bindings"]["gapSet"][target] = len(invented["gapSets"]) - 1
    results.append(expect_failure(
        "binding declaring a source seam the palette does not have",
        lambda: check_bindings(store, view.mutated(catalog=invented), overrides)))
    check_bindings(store, view, overrides)

    # 6. an over-simplified payload
    scoped = view.mutated(
        catalog={**catalog, "intervals": compiler.pack_columns([interval], compiler.INTERVAL_FIELDS)},
        provenance={**view.provenance, "intervals": [view.measurement(interval["intervalId"])]})
    check_areas(store, scoped, areas)
    coarse = over_simplify(store, class_name, interval)
    coarse_store = store.with_override(relative, coarse)
    results.append(expect_failure(
        "interval re-simplified at 0.5 degrees",
        lambda: check_areas(coarse_store, scoped, areas)))
    check_areas(store, scoped, areas)

    # 7. pieces removed from a shipped payload
    thinned = drop_pieces(store, original_bytes, 12)
    thinned_store = store.with_override(relative, thinned)
    results.append(expect_failure(
        "twelve pieces removed from a shipped payload",
        lambda: check_areas(thinned_store, scoped, areas)))

    # 8. a witness moved off its seaway
    explain = build_explainer(rows_by_class, overrides, view.intervals)
    check_witnesses(store, [class_name], explain)
    moved = shift_payload(store.read(f"staging/{class_name}/palaeo-{class_name}-94-81.ehpr"), 3.0)
    moved_store = store.with_override(f"staging/{class_name}/palaeo-{class_name}-94-81.ehpr", moved)
    results.append(expect_failure("payload shifted 3 degrees east",
                                  lambda: check_witnesses(moved_store, [class_name], explain)))
    check_witnesses(store, [class_name], explain)

    # 8b. a cited basin edit that did not reach the payload
    measured = check_basin_edit_witnesses(store, [class_name], basins, rows_by_class,
                                          view.intervals)
    # The witness this mutation needs is one where the class is present *only*
    # because the edit put it there; at a witness that also sits inside a
    # continent-sized Cao polygon a small shift would still land inside it and
    # the mutation would prove nothing.
    edited = next(row for row in measured["rows"]
                  if row["opIds"] and class_name in row["compiledClasses"]
                  and class_name not in row["caoSourceClasses"])
    edited_interval = edited["intervalId"]
    edited_relative = view.payload_relative(edited_interval)
    unedited = shift_payload(store.read(edited_relative), 3.0)
    unedited_store = store.with_override(edited_relative, unedited)
    results.append(expect_failure(
        f"{class_name} {edited_interval} payload shifted off its basin edit",
        lambda: check_basin_edit_witnesses(unedited_store, [class_name], basins,
                                           rows_by_class, view.intervals)))
    # The operation may live in any tracked contract, so it is removed by id from
    # every one of them rather than from `basins[0]`: that index stopped being the
    # North Sea when the Iceland contract was added and sorted before it.
    dropped_op = deepcopy(basins)
    for basin in dropped_op:
        basin["ops"] = [op for op in basin["ops"] if op["opId"] != edited["opIds"][0]]
    if sum(len(basin["ops"]) for basin in dropped_op) == \
            sum(len(basin["ops"]) for basin in basins):
        raise CorrectionError(
            f"self-test: {edited['opIds'][0]} is not in any tracked contract")
    results.append(expect_failure(
        "a basin edit witness whose operation was deleted from the contract",
        lambda: check_basin_edit_witnesses(store, [class_name], dropped_op,
                                           rows_by_class, view.intervals)))
    # The three Late Jurassic and Early Cretaceous removals are the only edits
    # that take land away rather than add it, so they are the ones a future
    # contract edit could quietly drop without any add-land witness noticing.
    # Naming one by id proves the witness rows that own them can fail.
    REMOVAL_OP = "north-sea-166-146-viking-graben-remove-land"
    dropped_removal = deepcopy(basins)
    for basin in dropped_removal:
        basin["ops"] = [op for op in basin["ops"] if op["opId"] != REMOVAL_OP]
    if sum(len(basin["ops"]) for basin in dropped_removal) == \
            sum(len(basin["ops"]) for basin in basins):
        raise CorrectionError(f"self-test: {REMOVAL_OP} is not in any tracked contract")
    results.append(expect_failure(
        f"the cited {REMOVAL_OP} operation deleted from the contract",
        lambda: check_basin_edit_witnesses(store, [class_name], dropped_removal,
                                           rows_by_class, view.intervals)))
    check_basin_edit_witnesses(store, [class_name], basins, rows_by_class, view.intervals)

    # 9. a payload whose digest no longer matches its catalog
    check_payload_identity(store, scoped)
    results.append(expect_failure(
        "payload bytes changed without a catalog update",
        lambda: check_payload_identity(widened_store, scoped)))
    check_payload_identity(store, scoped)

    # 10. the tone tables truncated
    check_tone_tables(store, [class_name])
    truncated_tones = store.read("staging/outline-tones.ehpt")[:-3012]
    results.append(expect_failure(
        "one outline tone table removed",
        lambda: check_tone_tables(store.with_override("staging/outline-tones.ehpt", truncated_tones),
                                  [class_name])))
    check_tone_tables(store, [class_name])

    # 11. the Iceland contract's own two checks. The seam gate does NOT assert
    # that the palaeo 102/301 cut and the material correction's 101/301 cut agree
    # - they are 19.7 to 60.6 km apart - so what has to be proven failable is the
    # drift detector and the partition-plate assertion, not an agreement.
    iceland = next((basin for basin in basins if basin["basinId"] == ICELAND_BASIN_ID), None)
    if iceland is None:
        raise CorrectionError("self-test: no iceland basin contract is tracked")
    check_iceland_seam(store, [class_name], basins)
    moved_seam = deepcopy(basins)
    for basin in moved_seam:
        if basin["basinId"] == ICELAND_BASIN_ID:
            pinned = basin["notes"]["seamCheck"]["measuredSeparationKilometres"]
            first = sorted(pinned)[0]
            pinned[first] = float(pinned[first]) + 25.0
    results.append(expect_failure(
        "an Iceland seam separation that no longer matches the pinned measurement",
        lambda: check_iceland_seam(store, [class_name], moved_seam)))
    narrowed_plates = deepcopy(basins)
    for basin in narrowed_plates:
        if basin["basinId"] == ICELAND_BASIN_ID:
            basin["notes"]["seamCheck"]["partitionPlateIds"] = [102, 999999]
    results.append(expect_failure(
        "an Iceland piece binding to a partition the contract does not declare",
        lambda: check_iceland_seam(store, [class_name], narrowed_plates)))
    tightened = deepcopy(basins)
    for basin in tightened:
        if basin["basinId"] == ICELAND_BASIN_ID:
            basin["notes"]["seamCheck"]["toleranceKilometres"] = 10.0
    results.append(expect_failure(
        "an Iceland seam tolerance tightened below the measured separation",
        lambda: check_iceland_seam(store, [class_name], tightened)))
    check_iceland_seam(store, [class_name], basins)

    # 12. an acceptance age that no longer selects the interval it names. 2.01 and
    # 11.01 Ma are the exclusive young bounds of `11-2` and `20-11`; a contract
    # that claimed either was covered would promise land at an age the layer draws
    # none at.
    check_basin_acceptance_ages(basins, view.intervals)
    mis_aged = deepcopy(basins)
    for basin in mis_aged:
        if basin["basinId"] == ICELAND_BASIN_ID:
            basin["notes"]["acceptanceAges"]["ages"] = [[2.01, "11-2"], [12.0, "20-11"]]
    results.append(expect_failure(
        "an acceptance age claiming the exclusive young bound is covered",
        lambda: check_basin_acceptance_ages(mis_aged, view.intervals)))
    check_basin_acceptance_ages(basins, view.intervals)

    # 13. the whole Iceland contract deleted. Its basin-edit witnesses name its
    # operations, so removing the contract has to turn them red rather than let
    # the four Iceland rows quietly stop being checked.
    without_iceland = [deepcopy(basin) for basin in basins
                       if basin["basinId"] != ICELAND_BASIN_ID]
    results.append(expect_failure(
        "the whole Iceland basin contract deleted while its witnesses remain",
        lambda: check_basin_edit_witnesses(store, [class_name], without_iceland,
                                           rows_by_class, view.intervals)))
    check_basin_edit_witnesses(store, [class_name], basins, rows_by_class, view.intervals)

    # 14. a structural-element witness moved off what the memo measured. The
    # Turgai row is the one the inland-sea memo exists for: the strait is an open
    # marine corridor at 58-49 Ma, and the premise it replaced said it was land in
    # every interval.
    turgai = deepcopy(WITNESS_CLASSES)
    turgai["turgai-open"] = (WITNESS_CLASSES["turgai-open"][0], {"58-49": ["lm"]})
    results.append(expect_failure(
        "the Turgai Strait witness returned to the premise it corrected",
        lambda: check_witnesses(store, [class_name], explain, turgai)))
    check_witnesses(store, [class_name], explain, WITNESS_CLASSES)

    return {"mutationsRejected": len(results), "mutations": results,
            "restoredChecks": {"inputs": "pass", "config": "pass", "provenance": "pass",
                               "lifecycles": "pass", "bindings": "pass", "areas": "pass",
                               "witnesses": "pass", "payloadIdentity": "pass",
                               "outlineTones": "pass"},
            "simplificationConfigSha256": compiler.sha256_path(CONFIG / "simplification.json"),
            "simplificationBaselineToleranceDegrees":
                simplification["areaClasses"][0]["toleranceDegrees"],
            "simplificationClassBaselineToleranceDegrees": {
                name: ladder[0]["toleranceDegrees"]
                for name, ladder in simplification.get("classAreaClasses", {}).items()}}


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
                       "lifecycleIndex": piece["lifecycleIndex"], "geometry": geometry})
    payload, _ = compiler.encode_ehpr(class_name, {"fromAgeMa": decoded["fromAgeMa"],
                                                   "toAgeMa": decoded["toAgeMa"]},
                                      decoded["intervalIndex"], pieces,
                                      compiler.LifecycleTable.from_catalog(
                                          store.catalog(class_name)))
    return payload


def drop_pieces(store: Store, payload: bytes, count: int) -> bytes:
    decoded = compiler.decode_ehpr(payload)
    class_name = {code: name for name, code in compiler.CLASS_CODES.items()}[decoded["classCode"]]
    pieces = []
    for piece in decoded["pieces"][count:]:
        pieces.append({"chartIndex": piece["chartIndex"], "bindingIndex": piece["bindingIndex"],
                       "evidenceIndex": piece["evidenceIndex"], "flags": piece["flags"],
                       "lifecycleIndex": piece["lifecycleIndex"],
                       "geometry": compiler.piece_geometry(decoded, piece)})
    rebuilt, _ = compiler.encode_ehpr(class_name, {"fromAgeMa": decoded["fromAgeMa"],
                                                   "toAgeMa": decoded["toAgeMa"]},
                                      decoded["intervalIndex"], pieces,
                                      compiler.LifecycleTable.from_catalog(
                                          store.catalog(class_name)))
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
    parser.add_argument("--runtime", action="store_true",
                        help="check only the published bytes against both manifests; this half "
                             "needs no pyGPlates environment and runs from `make check-corrections`")
    parser.add_argument("--quick", action="store_true",
                        help="skip the one-owner and frame-conflict oracles")
    parser.add_argument("--report", action="store_true",
                        help="write the validation record to dev-docs/bench/results")
    args = parser.parse_args()
    if args.runtime:
        # The published half of the contract; `validate_palaeo_coastlines_runtime`
        # owns it so a checkout without pyGPlates can still gate what ships.
        print(json.dumps(runtime_check.validate(), indent=1))
        return
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
