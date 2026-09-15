# Cao et al. (2017) palaeogeography as a palaeo-coastline source

Source, conversion and rights record, 2026-09-15. Phase R1 of the
`palaeo-coastlines-polygons` programme. It answers one question: can the Cao
et al. (2017) landmass, shallow-marine and mountain polygons be drawn on the
Cao et al. (2024) v2.4 globe EarthHistory already renders, and at what cost to
the evidence?

Companion record: [`palaeo-coastlines-cao2017-audit.json`](palaeo-coastlines-cao2017-audit.json),
written by `scripts/research/palaeo_coastlines_audit.py` (68 s, deterministic,
`--self-test` proves the checkers can fail). Every number below is in that
record. Nothing here has entered a build: `public/data/manifest.json` remains
the authority for what actually ships.

Every statement is tagged **[sourced]** (the cited source says it),
**[measured]** (this audit measured it from the pinned inputs) or
**[inferred]** (our reading of the measurement).

## Environment and pinned inputs

**[measured]** pyGPlates 1.0.0, Shapely 2.0.7, pyshp 3.1.6, NumPy 2.0.2,
Python 3.9.6 in the store venv `verification/pygplates-venv`. No GDAL, fiona or
pyproj. The Cao 2017 archive is read from the zip stream with `zipfile` +
`pyshp`; it is never extracted into the offline store.

| Input | Bytes | sha256 (first 12) |
| --- | ---: | --- |
| `geography/earthbyte-paleogeography-gplates2.3.zip` | 74,691,405 | `9cbbd835bff2` |
| ↳ `Paleogeography/Global_Cao_etal/lm_402_2.shp` | 4,337,916 | `e59c76b2473f` |
| ↳ `…/lm_402_2.dbf` | 5,474,185 | `fdbf49e9616f` |
| ↳ `…/sm_402_2.shp` | 6,094,908 | `0d0051e17a38` |
| ↳ `…/sm_402_2.dbf` | 9,176,153 | `59ad1f43fece` |
| ↳ `…/m_402_2.shp` | 2,466,252 | `96de4cc4c969` |
| ↳ `…/i_402_2.shp` | 122,092 | `4a122b60ad7d` |
| ↳ `…/lm_402_2.prj` (all four identical) | 145 | `a02a27b1d198` |
| ↳ `…/_README.txt` | 2,242 | `a10ab7d3c323` |
| `plates/…/cao2024-v2.4/1.8Ga_model_GSF/static_polygons.gpmlz` | 2,248,936 | `9b30d231157f` |
| ↳ `shapes_continents.gpmlz` | 1,243,843 | `6e30de73967f` |
| ↳ `shapes_coasts.gpmlz` | 1,860,295 | `c660bc074aa8` |
| ↳ `1000_0_rotfile.rot` | 625,128 | `e13c16ef5b2f` |
| ↳ `1800_1000_rotfile.rot` | 36,539 | `db2a57a8b7c7` |
| `public/data/reconstruction/cao-v2.4/motion-palette.json` | 802,764 | `70cf3f2c7291` |

**[sourced]** The `.prj` of all four class shapefiles is
`GEOGCS["GCS_WGS_1984", …]`, and `_README.txt` says "the shapefiles are all at
present-day coordinates"; the package carries no rotation file. The README also
states the drawing order ice → mountain → landmass → shallow marine, "to avoid
artefacts introduced from overlapping paleogeographies".

## The conversion: present-day class re-attached to present-day crust

**[inferred]** Cao 2017 geometry is present-day WGS84 and Cao 2024 static
polygons are present-day WGS84, so the two are directly comparable *before any
reconstruction*. The conversion is therefore not a frame transform: each Cao
2017 ring is cookie-cut by the present-day Cao 2024 static partitions, and each
resulting piece rides the plate that owns its partition. Method id
`present-day-class-reattached-to-cao2024-partition-v1`.

**[measured]** Cookie-cut with a Shapely STRtree, a 25 km² piece floor, exact
great-circle areas from `pygplates.PolygonOnSphere.get_area()`, and both
rotation files loaded. Summed over the 24 canonical intervals:

| | `lm` | `sm` | `m` |
| --- | ---: | ---: | ---: |
| source records | 7,155 | 13,395 | 4,789 |
| ring instances cut (records × intervals active) | 7,162 | 13,395 | 4,781 |
| source area (Mkm², all intervals) | 2,844.3 | 2,277.7 | 443.0 |
| cut area (Mkm²) | 2,857.3 | 2,292.7 | 446.6 |
| raw area ratio | 100.455 % | 100.659 % | 100.826 % |
| ground claimed twice by overlapping partitions (Mkm²) | 13.04 | 15.06 | 3.67 |
| **area ratio net of that double count** | **99.9967 %** | **99.9977 %** | **99.9976 %** |
| dropped below the 25 km² floor | 15,008 km² (0.00053 %) | 22,914 km² (0.00101 %) | 8,790 km² (0.00198 %) |
| dropped pieces | 3,602 | 11,613 | 2,007 |
| rings producing more than one kept piece | 3,120 (43.56 %) | 3,178 (23.73 %) | 2,366 (49.49 %) |
| emitted pieces | 27,591 | 35,949 | 12,861 |
| cut vertices | 1,684,950 | 1,773,025 | 371,694 |
| co-moving < 25 km at interval mid-age | **88.66 %** | 65.94 % | 77.59 % |
| co-moving 25–250 km | 5.45 % | 7.73 % | 7.71 % |
| frame conflict > 250 km | 5.90 % | 26.33 % | 14.70 % |
| unposable (no palette entry for the owner plate) | 0.66 % | 8.11 % | 1.74 % |

**[measured]** The raw excess is fully explained: the 2,421 present-day Cao 2024
static partitions overlap each other in 441 polygon pairs totalling
1,510,276 km² (0.295 % of their summed area; their non-overlapping coverage is
99.999 % of the sphere). Where two partitions claim the same ground, both claim
the same cut piece.

**[inferred]** Consequence for the compiler (D2): a cut piece must be given
**exactly one** owner — deterministic partition order, first claim wins — or the
palaeo layer will draw duplicated, differently-posed ground along 441 partition
seams. With that rule, area preservation is 99.997–99.998 % for all three
classes, comfortably inside the plan's [99.9, 100.5] % stop rule.

**[measured]** Cutting is the normal case, not an exception: 43.6 % of `lm` ring
instances and 23.7 % of `sm` ring instances produce more than one piece. A
compiler that bound whole rings to their `PLATEID1` would be wrong for most of
the landmass area.

### Great-circle densification is a precondition, not a refinement

**[measured]** The whole cut is a planar lon/lat Boolean, but the model's edges
are great circles. Three static partitions span ≥ 180° of longitude — Lomonosov
Ridge (plate 114, two polygons, spans 182.2° and 180.0°) and East Antarctica
(plate 8021, span 360°, encircling the pole). Near the pole a single recorded
edge can cross 70° of longitude while covering under 3° of arc, and its planar
chord then encloses ground the spherical edge does not.

**[measured]** The audit samples every edge at 1° of arc *and* 1° of longitude
before the Boolean, unwraps the ring, chooses the pole connector, closes an
encircling ring along lat = ±90 and splits at the antimeridian. Each split is
then verified against the spherical polygon two ways: area ratio and 4,800
point-in-polygon samples. All three wide partitions verify at **100.000 % area
and 0 sample mismatches**. Without densification East Antarctica verified at
100.000 % area but **202 mismatched samples** — an area check alone would have
passed a wrong partition boundary.

**[measured]** No Cao 2017 source ring crosses the antimeridian away from a pole
vertex (asserted by the script, 14 `lm`, 8 `sm`, 4 `m`, 7 `i` rings jump 180 →
−180 and every such jump is pole-to-pole), so source rings need no splitting —
only densification.

## The "64 undated records" claim was wrong

**[measured]** **All 25,592 records in all four classes carry numeric
`FROMAGE` and `TOAGE` in the DBF: 0 undated in `lm`, `sm`, `m` and `i`.**

**[inferred]** The earlier "Landmass … 64 missing time/ICS fields" line in
[Palaeogeography and relief](palaeomap-geography-relief.md) came from reading
GPlates *feature* validity rather than the DBF attributes. **[measured]** 7,090
of the 7,155 `lm` records (and 13,392 `sm`, 4,771 `m`, 251 `i`) carry
`GPGIM_TYPE = gpml:TopologicalClosedPlateBoundary`, which is a shapefile-export
artefact of the Cao workflow, not a topology: those records are ordinary
polygons with ordinary `FROMAGE`/`TOAGE`. A loader that asks pyGPlates for
`get_valid_time()` inherits the artefact's validity instead of the map interval.

**[inferred]** Importer contract: read `FROMAGE`, `TOAGE` and `PLATEID1` from
the DBF. Never use the GPlates feature type or feature valid time for this
package. This memo amends the "Missing time/ICS fields" column of
[Palaeogeography and relief](palaeomap-geography-relief.md): the correct value
is 0 for every class.

**[measured]** Two lifecycle defects a half-open interval cannot express do
exist, and they are not "undated": `lm` record 7125 has `FROMAGE = TOAGE = 296`,
`m` record 4786 has `FROMAGE = TOAGE = 322`, and `m` record 4771 is **reversed**
(`FROMAGE 55`, `TOAGE 58`). These three are never active under `(TOAGE, FROMAGE]`
and must be dropped with a counted reason, not silently.

## The published schedule and the off-schedule policy

**[measured]** The 24 canonical intervals are the `(FROMAGE, TOAGE)` pairs
shared by `lm`, `sm` and `m`, and they are contiguous: 402–380.01, 380–359.01,
359–338.01, 338–323.01, 323–296.01, 296–285.01, 285–269.01, 269–248.01,
248–224.01, 224–203.01, 203–179.01, 179–166.01, 166–146.01, 146–135.01,
135–117.01, 117–94.01, 94–81.01, 81–58.01, 58–49.01, 49–37.01, 37–29.01,
29–20.01, 20–11.01, 11–2.01 Ma. The `i` class occupies only 11 of them.

**[measured]** Under `(TOAGE, FROMAGE]` — youngest bound exclusive, oldest
inclusive — **exactly one** canonical interval is active at each of the 80
checkpoints from 5 to 400 Ma in 5 Ma steps, and **none** is active at 0 Ma or at
any of the 29 checkpoints from 405 to 540 Ma. This is the runtime boundary rule.

**[measured]** Off-schedule records: **61 `lm` + 8 `sm`** (plus 18 `m`, 1 `i`)
carry a pair that is not canonical, across **44 distinct lm+sm pairs** (55 across
all four classes). Their area is far from negligible: 28.70 Mkm² of `lm`,
0.41 Mkm² of `sm`, 3.06 Mkm² of `m`. The largest single off-schedule record is
an `lm` polygon with lifecycle 166 → 117.1 Ma covering 5.84 Mkm²; the next are
37 → 3 Ma (5.69 Mkm²) and 37 → 29.02 Ma (4.55 Mkm²).

**[measured]** The set of valid records is **not constant inside a canonical
interval**: across the 80 checkpoints the `lm` valid-record set takes **40**
distinct values while `sm` takes exactly **24** (one per interval). Off-schedule
`lm` records appear and disappear mid-interval.

**[inferred]** Off-schedule policy, confirmed: an off-schedule record ships
inside **every canonical interval payload it overlaps**, carrying **its own**
`(TOAGE, FROMAGE]` lifecycle with `youngestExclusive`. Selecting records by the
interval mid-age instead would silently drop **8 `lm` and 8 `m` records** whose
lifecycle lies entirely between two mid-ages (for example `lm` 105 → 94.01 Ma on
plate 804, `lm` 269 → 259 Ma on plate 309, `lm` 285 → 280 Ma on plate 401). This
audit itself uses mid-age selection for its own cut measurements, so those 16
records are outside every number in the table above; the compiler must not.

## The rotation-file trap

**[measured]** With both `1000_0_rotfile.rot` and `1800_1000_rotfile.rot`
loaded, the named sub-blocks are exactly co-moving with their parents: a probe
point at 60 N, 100 W reconstructed under 10105 vs 101, 80101 vs 801 and 30202 vs
302 separates by **0.000 km** at both 90 and 250 Ma.

**[measured]** With only `1000_0_rotfile.rot` loaded, the same pairs separate by
2,884 km / 6,655 km (10105 vs 101), 3,095 km / 3,892 km (80101 vs 801) and
1,534 km / 5,562 km (30202 vs 302) at 90 / 250 Ma. pyGPlates raises nothing: the
sub-block sequence is simply absent and the rotation is identity.

**[measured]** **17** plate IDs that actually own present-day static partitions
are affected: 4010, 10101, 10102, 10103, 10104, 10105, 10106, 20101, 30202,
30203, 30204, 50101, 50102, 80101, 80102, 80103, 80104.

**[inferred]** Named trap `single-rotation-file-identity`. Any script in this
programme that builds a `RotationModel` must load both files, and the check
above is the gate. `scripts/research/regional_lake_void_compile.py` loads only
`1000_0_rotfile.rot`; that is safe there only because it pins a 0 Ma identity
assertion, and it must not be copied as a pattern.

## Frame conflict and the proposed override list

**[measured]** For each cut piece, the great-circle distance at the interval
mid-age between where the owner partition's plate puts it and where its own
`PLATEID1` would put it. Area-weighted, by source `PLATEID1` (72 plates for
`lm`, 74 for `sm`; the ten largest by cut area):

| `PLATEID1` | `lm` cut area (Mkm²) | < 25 km | 25–250 km | > 250 km | top disagreeing owners |
| ---: | ---: | ---: | ---: | ---: | --- |
| 101 Laurentia | 338.3 | 95.8 % | 3.2 % | 1.0 % | 102, 141, 121, 233 |
| 201 South America | 328.1 | 93.9 % | 0.3 % | 5.9 % | 101, 108, 226, 228 |
| 701 Nubia | 250.5 | 96.1 % | 3.9 % | 0.1 % | 702 |
| 802 East Antarctica | 214.0 | 98.4 % | 1.1 % | 0.5 % | 804, 514, 814, 904 |
| 801 Australia | 212.7 | 98.9 % | 0.3 % | 0.8 % | 833, 851, 852, 566 |
| 401 Siberia | 205.7 | 85.8 % | 7.1 % | 7.1 % | 43400, 43300, 4100, 42200 |
| 714 | 174.9 | 99.0 % | 1.0 % | 0.0 % | 306, 3223, 304, 708 |
| 715 | 141.4 | 97.7 % | 2.3 % | 0.0 % | 3222, 3223, 322 |
| 302 Baltica/Europe | 124.4 | 98.8 % | 1.2 % | 0.0 % | 525, 337, 340, 522 |
| 501 India | 93.7 | 89.6 % | 1.0 % | 9.4 % | 606, 607, 603, 61601 |

**[measured]** Proposed override list — plates where the source `PLATEID1`
binding should win over the partition owner, selected by > 40 % of the plate's
cut area in conflict *and* > 200,000 km² of conflicting ground:

| plate | `lm` conflict | `lm` conflict area | also in | reading |
| ---: | ---: | ---: | --- | --- |
| 606 Lhasa | 70.9 % | 22.35 Mkm² | `sm` 80.1 % / 37.76 Mkm², `m` | owners 501, 616, 580, 457 carry it into the Tethys with India |
| 141 Canadian Arctic | 49.4 % | 5.36 Mkm² | `sm` 84.3 %, `m` 67.9 % | owners 120, 101, 102, 124 |
| 616 Qiangtang | 50.8 % | 4.54 Mkm² | `sm` 73.4 %, `m` 90.3 % | owners 606, 501, 5011, 457 |
| 233 | 43.8 % | 3.28 Mkm² | `m` 71.1 % | owners 109, 101, 274, 108 |
| 3307 Apulia | 84.9 % | 2.05 Mkm² | `sm` 64.2 % | owners 307, 306, 322, 305 |
| 212 | 52.8 % | 1.08 Mkm² | `sm` 63.1 % | owners 909, 222, 901, 216 |
| 631 | 42.5 % | 0.71 Mkm² | — | owners 601, 636, 626, 625 |
| 678 | 71.0 % | 0.46 Mkm² | `sm` 70.1 %, `m` 47.2 % | owners 901, 630, 628, 646 |
| 117 | 90.1 % | 0.36 Mkm² | — | owners in the Arctic |
| 525 | 53.3 % | 0.29 Mkm² | `sm` 88.8 % | — |

**[inferred]** 606, 616, 141 and 3307 are the defensible overrides for `lm`: on
each, most of the plate's own mapped area is carried more than 250 km from its
`PLATEID1` position, which is a *different reconstruction frame*, not a small
disagreement. Each override needs a cited justification in the compiler's
override table; the numbers above are the measurement, not the citation.

**[measured]** `sm` is a different problem: 26.3 % of its area is in conflict,
and the list of plates over the 40 % threshold runs to **27 entries** including
501 India (42.6 %, 41.06 Mkm²), 430 (46.0 %), 103 (41.4 %), 601 (45.0 %) and 603
(52.8 %). **[inferred]** An override list that long is not a list of exceptions;
it says the shallow-marine class needs its own conflict policy (the plan's
Phase 7 "emit only co-moving ≤ 250 km, count the rest"), not a per-plate table.

## Unposable pieces

**[measured]** A piece is unposable when the shipped `motion-palette.json` has
no gap-free entry chain covering the canonical interval for its owner plate
(restoration entries excluded, matching `entries_covering()` in
`scripts/research/emit_cao_material_corrections.py`).

| class | unposable area | share of cut area | pieces |
| --- | ---: | ---: | ---: |
| `lm` | 18.98 Mkm² | 0.664 % | 934 |
| `sm` | 186.04 Mkm² | 8.114 % | 5,057 |
| `m` | 7.78 Mkm² | 1.743 % | 634 |

**[measured]** Largest unposable owner plates for `lm`: 901 (1.67 Mkm²), 630
(1.11), 909 (1.05), 834 (1.00), 42200 (0.86), 42100 (0.74), 468 (0.72), 16141
(0.63). For `sm`: 901 (24.65), 911 (19.18), 814 (13.88), 42100 (9.44), 16141
(7.91).

**[inferred]** These pieces are dropped and counted, never posed with a
substitute plate. For `lm` the loss is 0.66 % of area and acceptable; for `sm`
it is 8.1 %, which must appear in the map key as a stated coverage limit if the
class ships.

## North Sea restoration binding

**[measured]** Partitions 303 and 315 own large palaeo ground: `lm` 11.42 Mkm²
and 9.42 Mkm², `sm` 8.04 Mkm² and 16.13 Mkm² summed over the intervals. Both
plates have a complete **native** palette chain (`plate-303-0-130`,
`plate-303-130-505`, `plate-303-505-1080`; `plate-315-0-130`,
`plate-315-130-505`) *and* a restoration entry
(`restoration-north-sea-plate-303-130-600`,
`restoration-north-sea-plate-315-130-420`).

**[inferred]** Because the native chain is complete, `entries_covering()` will
resolve happily without ever touching the restoration entries. A palaeo chart
cut onto 303 or 315 will therefore take native Cao motion and detach from the
restored North Sea shelf — the plan's pre-mortem 3. The binding must be
explicit in the compiler, and the 5 km coupling probe at 270 Ma is the gate.

## Per-interval area audit: shelf-through is not "sea"

**[measured]** In present-day coordinates, per canonical interval: the union of
Cao 2024 continent polygons valid at the interval mid-age, minus the union of
Cao 2017 `lm`, split by whether Cao 2017 `sm` covers it.

| interval | Cao 2024 crust | crust not `lm` | of that, `sm` | of that, no class | `sm` outside crust |
| --- | ---: | ---: | ---: | ---: | ---: |
| 402–380 | 174.4 Mkm² | 80.2 Mkm² | 75.4 % | 24.6 % | 21.7 % |
| 269–248 | 180.7 | 75.9 | 62.1 % | 37.9 % | 21.5 % |
| 248–224 | 188.0 | 59.1 | 59.0 % | 41.0 % | 27.4 % |
| 94–81 | 196.0 | 95.7 | 67.6 % | 32.4 % | 17.9 % |
| 11–2 | 210.4 | 90.5 | 49.9 % | 50.1 % | 24.7 % |
| **range over all 24** | 174.4–210.4 | — | **45.5–75.4 %** | **24.6–54.5 %** | **17.9–27.5 %** |

**[inferred]** Two conclusions stand, and one plan number moves.

1. `sm` must ship as its own class. Between a quarter and a half of the crust
   Cao 2017 does not call land is also not called shallow marine — 2.4 to
   5.2 × 10⁷ km² per interval. Painting the residual as sea would invent a
   claim the source does not make; it keeps today's "crust extent, depth
   unmapped" meaning.
2. `sm` is not contained by Cao 2024 crust either: 17.9–27.5 % of shallow-marine
   area per interval lies outside it. `sm` cannot be derived by classifying the
   crust layer; it is an independent polygon set.

## Witness classes

**[measured]** Class membership at present-day reference points, with the
`PLATEID1` of the containing record and the owner partition plate.

| witness (lon, lat) | owner | 402–380 | 269–248 | 248–224 | 94–81 |
| --- | ---: | --- | --- | --- | --- |
| WIS (−100, 45) | 101 | land 101 | land 101 | land 101 | **shallow 101** |
| West Siberian (75, 60) | 401 | shallow 302/401/402 | land 401 | land 401 | **shallow 401** |
| Zechstein (4, 54) | 315 | land 315 | **shallow 315** | land 315 | shallow 315 |
| North Sea centre (2.5, 57) | 330 | land 302 | shallow 302/309 | land 302 | shallow 302 |
| Viking Graben (2, 60.5) | 301 | land **315** | shallow **309** | land **315** | shallow **302** |
| Tethyan Himalaya (85, 29) | 501 | shallow 501/606 | shallow 501 | shallow 501/606 | **mountain 616** |
| Paris Basin (2.5, 48.5) | 305 | shallow 305 | mountain 305 | land 305 | shallow 305 |
| Doggerland (2.5, 54.5) | 315 | land 315 | shallow 315 | land 315 | shallow 315 |
| Canadian Shield (−95, 55) | 101 | land 101 | land 101 | land 101 | land 101 |
| Amazonia (−60, −5) | 201 | **shallow 201** | land 201 | land 201 | land 201 |
| Turgai (65, 52) | 465 | land 402 | land 402 | land 402 | land 402 |
| Hudson Bay (−85, 58) | 101 | **shallow 101** | land 101 | land 101 | land 101 |

**[measured]** The Viking Graben row is the argument for cookie-cutting on its
own: the same present-day point carries `PLATEID1` 315, 309, 315 and 302 in four
different intervals, while its present-day static partition is 301 throughout.
Binding whole rings by `PLATEID1` would make the graben jump between frames as
the age changes.

## Node reduction and payload

**[measured]** Douglas–Peucker with `preserve_topology`, applied to the cut
pieces, area measured with the same spherical oracle. Ring payload models int16
lon (0.0055°) and lat (0.0027°), an 8-byte piece header and a 4-byte ring
header.

| class | tolerance | vertices | area error | lost pieces (worst interval / largest) | payload |
| --- | ---: | ---: | ---: | --- | ---: |
| `lm` | cut | 1,684,950 | — | — | — |
| `lm` | 0.02° | 682,580 | −0.0051 % | 130 (12 / 302 km²) | 2.97 MiB |
| `lm` | 0.05° | 528,479 | −0.0300 % | 186 (20 / 961 km²) | 2.38 MiB |
| `lm` | 0.1° | 397,566 | −0.1021 % | 249 | 1.88 MiB |
| `sm` | 0.02° | 750,904 | −0.0083 % | 193 (43 / 457 km²) | 3.35 MiB |
| `sm` | 0.05° | 585,379 | −0.0443 % | 277 (47 / 485 km²) | 2.72 MiB |
| `sm` | 0.1° | 450,199 | −0.1825 % | 324 | 2.20 MiB |
| `m` | 0.02° | 225,939 | −0.0129 % | 44 (7 / 88 km²) | 1.03 MiB |
| `m` | 0.05° | 181,006 | −0.0874 % | 80 (14 / 603 km²) | 0.86 MiB |
| `m` | 0.1° | 136,828 | −0.3966 % | 114 | 0.69 MiB |

**[measured]** `lm` + `sm` + `m` at 0.02° is **7.36 MiB** of ring payload before
the catalog and tone tables. Worst intervals by piece count: `lm` 37–29 Ma
(1,547 pieces, 86,389 cut vertices, 38,259 after 0.02°), `sm` 29–20 Ma (1,973),
`m` 20–11 Ma (1,135).

**[inferred]** The plan's "≤ 5 lost pieces per interval and none > 500 km²" gate
is **not met at 0.02°** by piece count — `lm` loses up to 12 in one interval and
`sm` up to 43 — although no single lost piece exceeds 500 km² at 0.02°. At 0.05°
`lm` loses a 961 km² piece and `m` a 603 km², breaking the area half of the gate.
Phase 2 must either relax the count half of the gate with a stated reason, or
exempt pieces already near the 25 km² floor (most losses are pieces that
simplify below the floor, not real features).

## Stop rules (Phase R)

| rule | measured | verdict |
| --- | --- | --- |
| area preservation ∈ [99.9, 100.5] % | net of partition overlap: `lm` 99.9967, `sm` 99.9977, `m` 99.9976; raw `lm` 100.455, `sm` 100.659, `m` 100.826 | **pass** on the net figure, with the one-owner rule mandatory; raw `sm` and `m` exceed the bound |
| co-moving `lm` ≥ 85 % | 88.66 % within 25 km (94.10 % within 250 km) | **pass** |
| exactly one canonical interval per checkpoint | 80/80 inside, 0/29 outside | **pass** |
| both rotation files loaded | worst sub-block separation 0.000 km | **pass** |
| rights problem | none found (below) | **pass** |

`status: "pass"`, `failingStopRules: []`. The programme may continue to Phase 1.

## Licence record

**[sourced]** The paper *Improving global paleogeography since the late
Paleozoic using paleobiology*, Cao, Zahirovic, Flament, Williams, Golonka and
Müller, *Biogeosciences* 14, 5425–5439 (2017),
[doi:10.5194/bg-14-5425-2017](https://doi.org/10.5194/bg-14-5425-2017), is
published under CC BY 3.0.

**[sourced]** The geometry used here is the official **EarthByte GPlates 2.3
Paleogeography package**, whose collection page states CC BY 3.0 for EarthByte
data. The package's own `_README.txt` (sha256 `a10ab7d3c323…`) states
**citation requirements only** — the Cao et al. 2017 and Matthews et al. 2016
citations — and imposes no further restriction.

**[inferred]** CC BY 3.0 permits the derivative provided we credit the authors
and indicate that changes were made. The cookie-cut, one-owner binding,
densification and Douglas–Peucker reduction are all changes and must be named.
There is no share-alike and no non-commercial term, so the derivative may ship
under the application's own terms with attribution.

**[sourced / inferred]** Two things must stay out of any build, as recorded in
[Palaeogeography and relief](palaeomap-geography-relief.md): the linked GitHub
snapshot at commit `e92592aae168a1653fe93716eb3c928ccc23fe54`, which GitHub
reports with **no repository licence**; and the 24 LZW GeoTIFF raster maps in
`cao-2017-supplement.zip`, which carry no separate licence file and are a
categorical illustration rather than data. Both remain research-only inputs.
Public GitHub access and NOAA catalog display are not grants of reuse rights.

**[inferred]** Matthews et al. (2016) *Global plate boundary evolution and
kinematics since the late Paleozoic*,
[doi:10.1016/j.gloplacha.2016.10.002](https://doi.org/10.1016/j.gloplacha.2016.10.002),
must be cited whenever the Cao 2017 geometry is used, because the package README
requires it — even though EarthHistory poses the polygons with the Cao 2024 v2.4
model and no Matthews rotation is loaded or redistributed.

### DRAFT replacement for `THIRD_PARTY_NOTICES.md` lines 101–107

Not applied. The current paragraph says "Polygon geometry is not transferred
across reconstruction frames", which stops being true the moment a palaeo class
ships. Proposed text, to be applied in the phase that actually ships the layer:

> - **Improving global paleogeography since the late Paleozoic using paleobiology** —
>   Cao et al. (2017), [Biogeosciences 14 (2017)](https://doi.org/10.5194/bg-14-5425-2017),
>   official EarthByte GPlates 2.3 Paleogeography package, licensed under
>   [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); the package README
>   also requires citing Matthews et al. (2016),
>   [doi:10.1016/j.gloplacha.2016.10.002](https://doi.org/10.1016/j.gloplacha.2016.10.002).
>   EarthHistory derives a qualitative chronology constraint from the absence of
>   mapped permanent-ice polygons between 81 and 285.01 Ma, and, for the
>   palaeo-coastline layer, redistributes the landmass and shallow-marine
>   polygons of the 24 published map intervals as a modified derivative. The
>   modifications are EarthHistory's: the present-day polygons are cut by the
>   present-day Cao et al. (2024) v2.4 static partitions, each piece is given one
>   partition owner and rides that plate, node counts are reduced by
>   Douglas–Peucker, and the published `FROMAGE`/`TOAGE` map interval becomes a
>   half-open lifecycle. The polygons are not reconstructed with the Matthews
>   et al. (2016) rotations the authors used. A map interval records the minimum
>   land and maximum flooding recorded anywhere in that bin, not a shoreline at
>   one moment; the absence of ice polygons is not proof of an ice-free Earth.
>   The research-only GitHub snapshot (commit `e92592aa`, no repository licence)
>   and the supplement raster maps are not inputs to any build.

## What contradicts the plan

**[measured]** Six premises in `dev-docs/plans/palaeo-coastlines-polygons.md`
move. None of them changes a design decision; three change a stated number.

| plan premise | measured here |
| --- | --- |
| "lm area preserved 100.34 % (excess = measured 0.10 % partition self-overlap)" | raw 100.455 %; partition self-overlap is **0.295 %** of partition area, and the per-ring double count is 0.46 % of `lm` source area — it explains the excess exactly, but the plan's 0.10 % figure is too small |
| "0.0028 % dropped below 25 km²" | **0.00053 %** for `lm` (15,008 km², 3,602 pieces) |
| "of Cao 2024 continental crust not covered by lm, only 46–61 % is Cao 2017 shallow marine; 39–54 % is deep or unmapped" | **45.5–75.4 %** shallow marine, **24.6–54.5 %** unmapped. The conclusion is unchanged — up to half the residual is unmapped — but the range is wider and the Devonian intervals are much better covered than the plan assumed |
| "14.5 % of sm at 94–81 lies outside Cao 2024 continental crust" | **17.9 %** at 94–81; **17.9–27.5 %** over all 24 intervals |
| "Turgai Strait and Hudson Seaway are land in every interval — not promised" | Turgai (65, 52) is land in all four sampled intervals, but **Hudson Bay (−85, 58) is shallow marine at 402–380 Ma**, as is **Amazonia (−60, −5)**. The negative control holds for Turgai and the Canadian Shield only; the Devonian interval is not a valid negative control anywhere |
| "worst lm interval 37–29 Ma: 1,747 pieces" | **1,547** pieces at 37–29 Ma with the 25 km² floor and one-owner-per-partition counting |

**[measured]** Three premises are confirmed to the digit: 61 `lm` + 8 `sm`
off-schedule records over 44 distinct pairs with the largest at 166 → 117.1 Ma
and 5.84 Mkm²; 43.6 % of `lm` rings straddling a partition boundary; 17 sub-block
plate IDs silently identity without `1800_1000_rotfile.rot`.

**[inferred]** Two additions the plan does not yet carry, both Phase 2 work:
great-circle densification before the planar Boolean (without it the East
Antarctica partition boundary is wrong in a way an area check does not catch),
and a mid-age record-selection ban (it would drop 16 off-schedule records).

## Reproduction

```
../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python \
  scripts/research/palaeo_coastlines_audit.py --self-test
../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python \
  scripts/research/palaeo_coastlines_audit.py
```

**[measured]** The full pass takes 68 s and is byte-identical across runs apart
from its own `elapsedSeconds`. `--self-test` rejects four mutations — a
corrupted pinned sha256, a canonical `TOAGE` shifted 6 Ma, one class moved off
the shared schedule, and a model built from `1000_0_rotfile.rot` alone — and
re-runs each clean check afterwards.
