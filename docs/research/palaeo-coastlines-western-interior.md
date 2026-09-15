# Western Interior Seaway: stage-level shoreline checks

Item 12e-WIS. The inland-sea memo
([palaeo-coastlines-inland-sea-checks.md](palaeo-coastlines-inland-sea-checks.md),
§A.1) established that the seaway **exists** in the shipped map at 117–94, 94–81
and 81–58 with Gulf↔Arctic continuity in the two bins that contain the
Cenomanian–Turonian peak. This memo refines that from "the sea is there" to
"its **shores** are where the literature puts them", transect by transect, and
adds the Sevier belt and the mountain class, which was withheld when that memo
was written and ships now. It changes no tracked data.

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Git HEAD | `49ccb43551c9abb3b0b9e27b09dc6c7af279d978` |
| Payloads read | the **committed blobs** at HEAD (`git show HEAD:public/data/reconstruction/cao-v2.4/palaeo-coastlines/…`), never the working tree — 78 files, classes `lm`, `sm` **and `m`** |
| Integrity | **Measured.** All 75 `.ehpr` payloads extracted from HEAD equal the `sha256` their own class catalog pins. In-scope digests are in the appendix. |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` — Python 3.9.6, Shapely 2.0.7, NumPy 2.0.2 |
| Method | the validator's own, imported read-only: `palaeo_coastlines_compile.decode_ehpr` + `piece_geometry`, unioned per class per interval, `shapely.contains()` on a present-day `(lon, lat)`. Rendered sea = `sm` minus `lm`, because land draws later and higher. |
| Drift check | **Measured.** Every point in this memo returns the same class set from the `192cc22` blobs (the inland-sea memo's commit) as from HEAD. The restored-margins, shortening-gate and mountain-class commits moved nothing in the Western Interior. |

All numbers are **Measured** unless marked otherwise. Literature is tagged
**Verbatim** (an exact sentence from a document read in this session),
**Snippet**, or **Inference** (our reading).

## The stage framework this memo tests against

**Verbatim**, Cobban, Walaszczyk, Obradovich & McKinney 2006, USGS Open-File
Report 2006-1250, [doi:10.3133/ofr20061250](https://doi.org/10.3133/ofr20061250)
(DOI verified at Crossref; PDF read in full from
<https://pubs.usgs.gov/of/2006/1250/pdf/OF06-1250_508.pdf>): stage boundaries
**Cenomanian 99.6 ± 0.9**, **Turonian 93.5 ± 0.3**, **Coniacian 89.3 ± 1.0**,
**Santonian 85.8 ± 0.7**, **Campanian 83.5 ± 0.7**, **Maastrichtian 70.6 ± 0.6**,
K/Pg 65.5 ± 0.30 Ma; ammonite-zone ages *Dunveganoceras pondi* 94.71 ± 0.49,
*Euomphaloceras septemseriatum* (the old *Sciponoceras gracile* zone)
93.68 ± 0.50, *Neocardioceras juddii* 93.32 ± 0.38, *Prionocyclus hyatti*
92.46 ± 0.58, *Scaphites hippocrepis* II 81.86 ± 0.36, *Baculites obtusus*
80.58 ± 0.55, *B. scotti* 75.56 ± 0.11, *B. compressus* 73.52 ± 0.39,
*B. reesidei* 72.94 ± 0.45, *B. grandis* 70.00 ± 0.45.

**Verbatim**, Roberts & Kirschbaum 1995, USGS Professional Paper 1561,
[doi:10.3133/pp1561](https://doi.org/10.3133/pp1561) (DOI verified at Crossref;
PDF read in full from <https://pubs.usgs.gov/pp/1561/report.pdf>), gives six
palaeogeographic time slices with their own ages, each map drawn as the
*"maximum landward extent of seaway"* with a second line for the
*"maximum seaward extent of shoreline progradation"*.

| PP 1561 time slice | zones | age (PP 1561) | Cao bin it lands in |
|---|---|---|---|
| Cenomanian | *N. cornutus* – *N. juddii* | 98.5–93.5 Ma | **117–94** to 94.0, then the first 0.5 Myr of 94–81 |
| Turonian | *P. flexuosum* – *P. quadratus* | 93.5–88.5 Ma | **94–81** |
| Coniacian–Santonian | *F. peruana* – *D. bassleri* | 88.5–83.5 Ma | **94–81** |
| Campanian I | *S. leei* III – *B. asperiformis* | 83.5–79 Ma | **94–81** (83.5–81) + **81–58** (81–79) |
| Campanian II | *B.* sp. (smooth) – *B. cuneatus* | 79–72 Ma | **81–58** |
| Maastrichtian | *B. reesidei* – *Triceratops* | 72–65.5 Ma | **81–58** |

**Inference**, and it is the expectation every row below is judged against.
A Cao bin is a maximum-transgression bin, so it should render the **union** of
the stages it contains, i.e. the wettest one:

| Cao bin | union of stages | the maximum inside it |
|---|---|---|
| 117–94 | Aptian–Albian + Cenomanian to ~94.0 Ma | early-Cenomanian Gulf–Boreal junction; **not** the Greenhorn peak |
| 94–81 | latest Cenomanian + Turonian + Coniacian + Santonian + earliest Campanian | **Greenhorn highstand**, *"In early Turonian time, the Western Interior seaway had reached its maximum transgressive phase"* (**Verbatim**, PP 1561) |
| 81–58 | Campanian I tail + Campanian II + Maastrichtian + Danian–Selandian | **Bearpaw transgression**, *"closed with the last major sea level rise in the history of the Western Interior seaway"* (**Verbatim**, PP 1561, of Campanian II) |

So the seaway must be **widest at 94–81** on every transect.

## Measured: the two shorelines, 0.05° scan of `sm` minus `lm`

Longest run only; a second, smaller run at 135–117 on the 40 N and 45 N lines is
the proto-Pacific margin, not the seaway.

| Transect | bin | west shore | east shore | width |
|---|---|---:|---:|---:|
| 40 N | 117–94 | −112.70 E | −96.05 E | 16.65° = 1 420 km |
| 40 N | **94–81** | **−111.70 E** | **−94.95 E** | **16.75° = 1 428 km** |
| 40 N | 81–58 | −107.65 E | −95.05 E | 12.60° = 1 074 km |
| 45 N | 117–94 | −112.80 E | −92.80 E | 20.00° = **1 574 km** |
| 45 N | **94–81** | **−110.80 E** | **−93.30 E** | 17.50° = 1 378 km |
| 45 N | 81–58 | −109.70 E | −91.75 E | 17.95° = 1 413 km |
| 49 N | 117–94 | −114.40 E | −93.90 E | 20.50° = 1 497 km |
| 49 N | **94–81** | **−114.10 E** | **−93.90 E** | 20.20° = 1 475 km |
| 49 N | 81–58 | −110.50 E | −91.50 E | 19.00° = 1 388 km |

Widths are present-day great-circle spans at that latitude; the palaeo width was
larger, because Laramide and Basin-and-Range strain has since moved the western
endpoint east relative to the craton. The comparison is therefore a lower bound.

## Verdict per probe

| # | Probe | Bin | Measured | Expectation and source | Verdict |
|---|---|---|---|---|---|
| 1 | west shore 40 N | 94–81 | sea from −111.70 E | *"In central and northern Utah, shoreline positions remained confined to a narrow belt along the orogenic front"* (**Verbatim**, PP 1561, Coniacian–Santonian, repeating the Turonian). The Sevier frontal thrusts in central Utah lie near −111.5 E. | **PASS** (0.2°) |
| 2 | west shore 40 N | 117–94 | −112.70 E | Cenomanian coastal plain *"400 km wide in the Four Corners area"*; the Coalville, Utah depocentre (−111.4 E, 41.0 N) holds 1 070 m of Cenomanian (**Verbatim**, PP 1561). | **PASS**, weak — no source gives a longitude |
| 3 | west shore 40 N | 81–58 | −107.65 E; land −112…−108 | *"The overall paleogeographic position of the western shoreline … at the lowstand (maximum regression) is farther to the east than in previous intervals"*, the Utah embayment *"had migrated to the eastern part of the State"* (**Verbatim**, PP 1561, Campanian I); PP 1561 Table A maps a *"Lewis Shale embayment"* at *B. grandis*. | **PASS** |
| 4 | west shore 45 N | 94–81 | −110.80 E; `lm` at −111 | *"In Montana, Alberta, and British Columbia, shoreline positions were very stable, hugging the eastern edge of the mountain front and never advancing or retreating more than 100 km"* (**Verbatim**, PP 1561). | **PASS** |
| 5 | west shore 45 N | 117–94 | −112.80 E | *"A smaller depocenter existed in southwestern Montana where sediment thickness is about 900 m"* (**Verbatim**, PP 1561) — marine Cenomanian at that longitude. | **PASS** |
| 6 | west shore 49 N | all three | −114.40 / −114.10 / −110.50 | *"the western shoreline along the Canadian part of the foreland basin moved back and forth for great distances—at least 250 km, and perhaps as much as 600 km in central Alberta"* (**Verbatim**, PP 1561). Tolerance is 2–5°; the readings sit inside it. | **PASS**, low resolving power |
| 7 | east shore 40 N | 94–81 | −94.95 E | *"approximately 1,620 km wide from central Utah to Minnesota … (Kauffman, 1984)"* (**Verbatim**, PP 1561). Measured 1 428 km, 12 % narrow — but the quoted endpoints span ~39–45 N, not one parallel. | **PARTIAL** — no quotable longitude at 40 N |
| 8 | east shore 45 N | 94–81 | −93.30 E | The same Minnesota endpoint, on the parallel it actually belongs to. | **PASS** |
| 9 | east shore 45 N | 117–94 / 81–58 | −92.80 / −91.75 E | *"Shoreline positions on the eastern side of the seaway are queried because of lack of data"* (**Verbatim**, PP 1561, of the Coniacian–Santonian, Campanian I and Campanian II maps). | **UNCONSTRAINED** — no edit is defensible here |
| 10 | bin-width ordering | all | 94–81 is **196 km narrower** than 117–94 at 45 N and **35 km narrower** than 81–58 there; at 49 N it is 22 km narrower than 117–94 (inside the ~30 km class floor) | the union semantics above: the bin holding the early-Turonian maximum must be the widest | **FAIL of the semantics** — a Cao-bin property, not ours to edit (see Limitations) |
| 11 | Sevier foredeep (−111, 40) | 117–94 / 94–81 / 81–58 | `sm` / `sm` / `lm` | foredeep east of the thrust front, marine at the Greenhorn maximum and emergent once the Campanian shoreline has passed east of it | **PASS**, and the pair is the cleanest transgression→regression witness on the map |
| 12 | Sevier belt (−110, 44) | 94–81 / 81–58 | `sm` / `sm` | Marine at the Turonian highstand — the Frontier Formation of western Wyoming is marine. For 81–58, PP 1561 puts the Campanian western shoreline well east of −110 at the lowstand but the *bin's* maximum is the Bearpaw. | **PASS** / **PARTIAL** (the 81–58 `sm` is only defensible as a Bearpaw-maximum reading) |
| 13 | Gulf Coast (−95, 32) | 117–94, 94–81, 81–58, 58–49 | `sm` throughout | *"By the end of the Maastrichtian, the seaway had retreated from the Western Interior, leaving the 'Triceratops' biochron shoreline … near that of the present-day Gulf Coast in southernmost Texas"* (**Verbatim**, PP 1561) — the marine limit at 32 N stays north-west of −95 E all through the Cretaceous. | **PASS** |
| 14 | Hudson connection (−90, 55) | every bin 135–117 … 49–37 | `lm` throughout | PP 1561 routes the northern arm through Manitoba and Alberta (*"Marine deposits in Manitoba during the Cenomanian are the Ashville Formation and the lower part of the Keld Member of the Favel Formation"*, **Verbatim**) and the Gulf–Boreal junction through *"southern Colorado and northern New Mexico"*. Nothing in PP 1561 opens a Hudson Bay strait. | **PASS as a negative control** |
| 15 | Boreal corridor (−115, 60) | 117–94 / 94–81 / 81–58 | `sm` / `sm` / `lm` | the corridor is open through the C–T peak and closed in the Campanian–Palaeocene bin, matching the Bearpaw regression | **PASS** |
| 16 | Gulf↔Arctic continuity | 117–94 / 94–81 / 81–58 | connected / connected / **broken** | *"…latest Cenomanian–Turonian (95–94 Ma) as a full connection with a northerly boreal water mass was established during peak transgression"* (**Verbatim**, Clim. Past 13, 855–875, [doi:10.5194/cp-13-855-2017](https://doi.org/10.5194/cp-13-855-2017)); Bearpaw regression closes it | **PASS**, re-confirmed at HEAD |
| 17 | San Juan Basin (−108, 36.5) | 94–81 / 81–58 | `sm` / **`lm`**; at 36.5 N the 81–58 sea starts only at −104.75 E, ~280 km east of the basin | *"the sea was in a transgressive phase at the beginning of the Campanian II, reached its maximum at about the time of Baculites scotti, and then began a final retreat from this region"* (**Verbatim**, PP 1561, of the San Juan Basin); *B. scotti* = 75.56 ± 0.11 Ma (Cobban 2006) is **inside** the 81–58 bin | **FAIL** — the only basin-scale mismatch found; see the proposed op |
| 18 | Maastrichtian retreat (Fox Hills) | 81–58 | 1 074–1 413 km of open sea at 40–49 N | *"In general, the Maastrichtian marks the major retreat of the epicontinental sea from the Western Interior (Bearpaw regression, R9 of Kauffman (1984))"* (**Verbatim**, PP 1561) | **NOT RENDERABLE** — bin limitation, not a defect |

## The mountain class over the Sevier belt

`m` ships now, so the Sevier highland is testable for the first time.

**Measured**, area of class `m` inside the Sevier window (−119…−108 E, 36…43 N):

| bin | `m` area | `m` at 40 N |
|---|---:|---|
| 135–117 | 28.82 deg² | −119 … −114 |
| 117–94 | 32.09 deg² | −119 … −114.5 |
| **94–81** | **44.75 deg²** | −119 … −112.5 |
| **81–58** | **18.28 deg²** | **−119 … −117 only** |
| 58–49 | 45.63 deg² | −119 … −112, plus −108.5 (Laramide) |

**Sourced.** *"From late Turonian until well into the Maastrichtian, shoreline
positions fluctuated asynchronously … Sevier-style deformation prevailed,
contributing sediment from the west to the evolving foreland basin"*, and
*"Active thrusting and erosion in the orogenic belt resulted in the deposition
of clastic wedges adjacent to the highlands … the Star Point Sandstone/Blackhawk
Formation of central Utah"* (**Verbatim**, PP 1561, of Campanian I). **Snippet**,
Blakey & Ranney 2018, *Ancient Landscapes of Western North America*, Springer,
[doi:10.1007/978-3-319-59636-5](https://doi.org/10.1007/978-3-319-59636-5) — DOI
verified at Crossref, **book not read**, cited as a reference-only visual
reference, nothing attributed to it.

**Inference, and it is a mismatch.** The Campanian is the Sevier belt's
structural climax by PP 1561's own account, yet `m` in southern Utah at 38–40 N
collapses to a two-cell strip at 81–58 while `lm` covers the rest. The belt is
still drawn as a highland at 46–50 N in the same bin, so this is a southern-half
hole, not a whole-belt drop. **No op is proposed:** the basin-edit contract has
`add-land | remove-land | add-shallow | remove-shallow | replace-ring` and no
mountain operation at all, so `m` cannot be edited from a basin file. This is
recorded as a limitation and as a witness on the one reading that is right
(−114, 40 at 94–81 is `m`).

## Proposed operations

**One**, and it is specified but not yet buildable — the shoreline geometry
still has to be digitised from PP 1561 figure 19 before the ring can be written.

| Field | Value |
|---|---|
| id | `wis-81-58-san-juan-lewis-sea` |
| file | `data/corrections/palaeo-coastlines/basins/western-interior.json` (new basin) |
| ops | `remove-land` + `add-shallow` (an `add-shallow` alone would render as land, because `lm` draws at 1 300 m over `sm` at 700 m) |
| intervals | `["81-58"]` only |
| bbox, in words | the San Juan Basin of north-western New Mexico and south-western Colorado — bounded west by the Defiance–Chuska uplift, east by the Nacimiento uplift, south by the Zuni uplift and north by the San Juan Mountains front; approximately −108.9 … −106.6 E and 35.9 … 37.4 N in present-day WGS84 |
| uncertaintyKm | 60 |
| rationale | at the 81–58 bin's own maximum (*B. scotti*, 75.56 ± 0.11 Ma) the basin was marine — the Lewis Shale, with the Pictured Cliffs Sandstone shoreface and the Fruitland Formation recording the later progradation. The shipped map renders the *post*-regression state for the southern seaway while rendering the transgressive state at 40–49 N, so the bin is internally inconsistent, by ~280 km of shoreline at 36.5 N. |
| references | `roberts-kirschbaum-pp1561-1995`, [doi:10.3133/pp1561](https://doi.org/10.3133/pp1561), 1995, constrains the Campanian II shoreline, **claim**; `cobban-ofr-2006-1250`, [doi:10.3133/ofr20061250](https://doi.org/10.3133/ofr20061250), 2006, constrains the numeric age of *B. scotti*, **claim**; the "bin's maximum must be rendered" step is **inference** |
| editorial | `EarthHistory modification after Roberts & Kirschbaum 1995 and Cobban et al. 2006` |
| blocker before building | PP 1561 figure 19's *"maximum landward extent of seaway"* line was read as text, not digitised. Either digitise it, or retrieve Miall, Catuneanu, Vakarelov & Post 2008, *Chapter 9 The Western Interior Basin*, [doi:10.1016/S1874-5997(08)00009-9](https://doi.org/10.1016/S1874-5997(08)00009-9) (DOI verified at Crossref, Elsevier, **paywalled and not read**). Both reference ids must also be added to `src/data/sources.ts`. |

**No other op is proposed.** Rows 1–6, 8 and 11–16 pass; row 7's shortfall is a
comparison with a place-name width, not a measured disagreement; rows 9 and 18
have no defensible target — PP 1561 itself queries the eastern Campanian
shoreline, and the Maastrichtian retreat is a bin-resolution limit, not a
geometry error. Inventing either would violate the science boundary.

## Proposed witnesses

`WITNESS_CLASSES` rows, `name: ((lon, lat), {interval: [classes]})`. Every class
set is **Measured** at HEAD. `western-interior-seaway` already exists at
(−100, 45) with `94-81: ["sm"]`; the first row extends it rather than duplicating.

| Witness | Point | Interval → class set | What it holds |
|---|---|---|---|
| `western-interior-seaway` (extend) | (−100.0, 45.0) | `117-94: ["sm"]`, `81-58: ["sm"]`, `58-49: ["lm"]` | the axis is sea in all three Cretaceous bins and dry by the Eocene bin |
| `wis-sevier-foredeep-utah` | (−111.0, 40.0) | `94-81: ["sm"]`, `81-58: ["lm"]` | Greenhorn highstand at the Sevier front, and the Campanian regression past it |
| `wis-sevier-highland-utah` | (−114.0, 40.0) | `94-81: ["m"]` | the one Sevier reading the mountain class gets right |
| `wis-east-shore-40n` | (−97.0, 40.0) | `117-94: ["sm"]`, `94-81: ["sm"]`, `58-49: ["lm"]` | the eastern shore sits east of −97 E through the Cretaceous |
| `wis-east-craton-40n` | (−93.0, 40.0) | `117-94: ["lm"]`, `94-81: ["lm"]`, `81-58: ["lm"]` | control: the craton east of the seaway never floods |
| `wis-east-shore-45n` | (−95.0, 45.0) | `94-81: ["sm"]`, `58-49: ["lm"]` | the Minnesota endpoint of Kauffman's maximum width |
| `wis-boreal-corridor` | (−115.0, 60.0) | `117-94: ["sm"]`, `94-81: ["sm"]`, `81-58: ["lm"]` | the Arctic link opens for the peak and closes at the Bearpaw regression |
| `wis-hudson-bay-land` | (−90.0, 55.0) | `117-94: ["lm"]`, `94-81: ["lm"]`, `81-58: ["lm"]` | negative control: the Boreal link is **not** through Hudson Bay |
| `wis-gulf-coast-texas` | (−95.0, 32.0) | `94-81: ["sm"]`, `81-58: ["sm"]`, `58-49: ["sm"]` | the Gulf end stays marine after the Western Interior drains |
| `wis-san-juan-basin` | (−108.0, 36.5) | `94-81: ["sm"]`, `81-58: ["lm"]` | pins the mismatch of row 17 so the proposed op has a before-state; it needs a `WITNESS_BASIN_EDITS` row if that op is ever built |

All ten sit inside `WITNESS_INTERVALS`, which already lists `117-94`, `94-81`,
`81-58` and `58-49`.

## Limitations to state, never "fix" by invention

- **The 45 N width inversion (row 10).** Cao's bins are single maps per interval,
  not computed unions of their stages, so the map drawn for 117–94 can be wetter
  at one latitude than the map drawn for 94–81 even though the Greenhorn maximum
  lies in the later bin. The map key's maximum-transgression promise is a
  statement about *intent*, not an arithmetic guarantee. This is the same defect
  shape the inland-sea memo found at the Mississippi Embayment (§A.3).
- **The Maastrichtian is unrenderable.** 81–58 is a 23 Myr bin holding the late
  Campanian seaway, the Bearpaw retreat, the Fox Hills and Lance shoreline and
  the whole Palaeocene. The seaway's *death* — PP 1561's defining Maastrichtian
  event — cannot be shown at this resolution.
- **The eastern Campanian shoreline is unsourced.** PP 1561 queries it on three
  of its six maps. Anything drawn there would be our invention.
- **The mountain class cannot be edited.** No basin op targets `m`.
- **Slattery et al. 2015 was not retrieved and nothing is attributed to it.**
  The DataCite deposit `10.13140/RG.2.1.4439.8801` names the right five authors
  (Slattery, Cobban, McKinney, Harries, Sandness) but registers the work as a
  **2013** conference paper, publisher **"Unpublished"**, and its ResearchGate
  landing page returns HTTP 403. It is not the DOI of the 2015 Wyoming
  Geological Association Guidebook paper, and that paper has no Crossref DOI.
  This confirms the warning in
  [palaeo-coastlines-literature.md](palaeo-coastlines-literature.md).
- **(−94, 30) is a `neither` cell** at 94–81 and 81–58 — a source hole in the
  northern Gulf, not a barrier. A continuity test that uses it as the Gulf
  endpoint reports a false break; the test above instead asks whether the sea
  body containing (−100, 40) reaches both the Arctic and 25 N, which it does at
  117–94 and 94–81.

## Reproduction

```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
git show HEAD:public/data/reconstruction/cao-v2.4/palaeo-coastlines/<class>/<file> > <scratch>
$PY <probe>   # imports palaeo_coastlines_compile read-only, decodes lm/sm/m,
              # unions per class per interval, shapely contains()
```

Probes and raw output went to the session scratch directory `…/scratchpad/wis/`
(`probe.py`–`probe4.py`, `probe1.txt`–`probe3.txt`, `payloads/`, `old/` for the
`192cc22` comparison, `sha256.txt`, plus `pp1561.pdf`, `pp1561_pg.txt`,
`pp1561_pg2.txt`, `cobban2006.pdf`, `cobban2006.txt`). That tier expires; every
number this memo relies on is quoted above.

## Appendix — sha256 of the in-scope payloads at HEAD `49ccb43`

Each equals the digest its own class catalog pins.

| File | Bytes | sha256 |
|---|---:|---|
| `lm/palaeo-lm-117-94.ehpr` | 152958 | `57919731064197fb341520529b1576fc6e7972481737c91e549c8a1e1c268d9d` |
| `lm/palaeo-lm-94-81.ehpr` | 136966 | `07297fd166496095e4c625a45f724ac8d160d13e2e21b80945b11a08fc1756f9` |
| `lm/palaeo-lm-81-58.ehpr` | 139526 | `e51bf4a5ddf57d7cbbb5467e852d47acda5ce60ece5b6e2423b51a918b8a4ba3` |
| `lm/palaeo-lm-catalog.json` | 53026 | `4002ab226c3deb70f32f3256e2acaf2d70f685a9e7c4d3cb1fe176c343cbc719` |
| `sm/palaeo-sm-117-94.ehpr` | 142630 | `8531a4458ae73416b36aaa5f13fbc7e7b621eb01858264d3a7ac717c18f5b1a9` |
| `sm/palaeo-sm-94-81.ehpr` | 160118 | `1473f7d684b56087c99f651737e74303d222e79f6554aba19cdeda4e1b933e0a` |
| `sm/palaeo-sm-81-58.ehpr` | 175420 | `d58158c268b909842470f115a18762c85f0afe61d05379310f318a4ab923189a` |
| `sm/palaeo-sm-catalog.json` | 52530 | `7232eea4537805e1078dac92c1c3a2228a44c8a1704056899d29f2de1bdebdd5` |
| `m/palaeo-m-117-94.ehpr` | 66988 | `9531b98e3e802549f0f993fc5f45affd6b2e8ed5b29f3210337bbee35958278e` |
| `m/palaeo-m-94-81.ehpr` | 59434 | `bee8f88c75e8e245a8fb24b1117d79c51a054523e69e7c6be8c11709a375f1ee` |
| `m/palaeo-m-81-58.ehpr` | 74684 | `42f25f447c80ec93be1692302852613f03d1f074eb0eae4613f635dacc347d7d` |
| `m/palaeo-m-catalog.json` | 29907 | `9fbda74f87faf25cad841e91ab5cde68296b709b83a2758b30c2535f044ed7b7` |
