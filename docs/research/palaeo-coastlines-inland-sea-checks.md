# Inland-sea checks: North America, South America and Siberia

Probe date: 2026-09-15. Read-only measurement of the **public** payloads under
`public/data/reconstruction/cao-v2.4/palaeo-coastlines/`, against the
epicontinental seas those three continents are usually described by. Companion
to [palaeo-coastlines-north-sea-formation-checks.md](palaeo-coastlines-north-sea-formation-checks.md)
(same method, North Sea formations),
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say, and the prioritised basin queue this memo tests rows 1, 2 and
4 of), [palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md) (why a Cao
interval is a minimum-land / maximum-transgression bin) and
[palaeo-coastlines-format.md](../data/palaeo-coastlines-format.md) (what the
bytes mean).

One question, three continents: **at the present-day position of a named
inland sea, in the Cao intervals its age falls in, does the shipped map say
land, shallow sea, both, or neither?** This memo changes nothing. Where it
finds a mismatch it says whether the fix is a permanent validator witness, a
cited basin edit, or a Cao-bin limitation to document.

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Git HEAD | `192cc224cf59f198587afd000626f0725c96c5a9` |
| Working tree at probe time | clean at the first read; a concurrent change later touched `public/data/manifest.json`, `…/cao-v2.4/core.json`, `…/corrections/material-v1/catalog.json`, `…/cao-v2.4/manifest.json` and `…/motion-tiles/index.json`. **No file under `…/cao-v2.4/palaeo-coastlines/` was modified at any point**, re-checked after the last probe. |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` — Python 3.9.6, Shapely 2.0.7, NumPy 2.0.2, pyGPlates present |
| Payloads read | 52 — `lm` and `sm`, the 24 canonical intervals plus `lgm`, and the two class catalogs |
| Integrity | **Measured.** All 50 payload `sha256` values re-computed here equal the digests their own class catalog pins, **and** all 52 files equal their blob at commit `192cc22`. The per-file table is the appendix. |
| Offline inputs (for the `neither` diagnosis only) | the pinned `earthbyte-paleogeography-gplates2.3.zip` (Cao 2017 `lm`/`sm`/`m` records) and `shapes_continents.gpmlz` (Cao 2024 crust), read through `palaeo_coastlines_audit` |

**Method, Measured.** The classification is the validator's own, imported
read-only rather than re-implemented: `palaeo_coastlines_compile.decode_ehpr`
decodes each EHPR v1 payload, `piece_geometry` rebuilds each piece's rings, the
pieces are unioned per class per interval (this is `class_union` in
`scripts/research/palaeo_coastlines_correction.py`), and a present-day
`(lon, lat)` gets the class set `{name : union.contains(point)}`. As in the
validator the union is over every piece in the interval file and does not filter
by a piece's own `(TOAGE, FROMAGE]` lifecycle, so an off-schedule record inside
the bin counts. A point covered by no shipped class is reported as `neither`.
Only `lm` and `sm` ship; the mountain class `m` is compiled offline and
withheld, which matters repeatedly below.

**What each answer means on screen** — unchanged from the formation-checks
memo, quoted here because three of its four rows do real work in this one:

| Class set | Painted | Map key line |
|---|---|---|
| `lm` | olive, shell 1 300 m, renderOrder 1.7, writes depth | "Palaeo land — Cao et al. 2017 landmass polygons for the active map interval" |
| `sm` | teal, shell 700 m, renderOrder 1.2, no depth write | "Palaeo shallow sea — … an environment class, not a water depth" |
| `lm` **and** `sm` | **olive.** Land is drawn later and higher, so an overlap renders as land and the shallow sea underneath is invisible | the land line |
| `neither` | whatever the native shell shows through: blue `shelf` where Cao 2024 maps continental crust, otherwise ocean | "Blue shelf — Cao 2024 continental crust, depth unmapped" |

**Inference.** `neither` is the model's *deep-or-unmapped complement*. This memo
separates it into three causes, each diagnosed against the pinned archive and
reported per case: **(a) mountain-only** — Cao 2017 maps `m` there and the
withheld class leaves the ground looking like unmapped crust (the
formation-checks memo's §6, found here in all three provinces); **(b) source
hole** — no Cao 2017 record of any class covers the point; **(c) off-crust** —
Cao 2024 maps no continental polygon at that age either, so nothing at all is
painted and the reading is ocean, not blue shelf. A fourth cause,
**(d) unposable drop**, is separated out in §12.2.

All numbers below are **Measured** unless a paragraph is marked otherwise.
Literature statements are tagged **Verbatim** (an exact sentence from a page
retrieved in this session), **Snippet** (a retrieved summary or abstract, not
the paper's own text) or **Inference** (our reading).

---

# A. United States

## 1. The Western Interior Seaway, intervals 117–94, 94–81 and 81–58

**Measured**, transect at 40 N, 1° steps (the full 0.5° scan is in the scratch
record):

| Interval | −110 … −97 E | −96 E | −95 E |
|---|---|---|---|
| 117–94 | `sm` at every step | `lm` | `lm` |
| 94–81 | `sm` at every step | `sm` | `sm` |
| 81–58 | `lm` at −110…−108, `sm` from −107 to −96 | `sm` | `lm` |

**Measured**, the seaway's own width and reach, from the 0.05° scan of
`sm` minus `lm` (what actually renders as sea):

| Interval | sea at 40 N | width | north limit on −100 E |
|---|---|---|---|
| 135–117 | −112.05 … −98.15 E | 13.90° = 1 185 km | 45.00 N |
| 117–94 | −112.70 … −96.05 E | 16.65° = 1 420 km | 53.75 N |
| **94–81** | **−111.70 … −94.95 E** | **16.75° = 1 428 km** | 52.00 N |
| 81–58 | −107.65 … −95.05 E | 12.60° = 1 074 km | 55.25 N |
| 58–49 | none | — | — |

**Measured**, meridional transect at −100 E:

| Interval | 35 N | 40 N | 45 N | 50 N | 55 N |
|---|---|---|---|---|---|
| 117–94 | `lm` | `sm` | `sm` | `sm` | `lm` |
| 94–81 | `sm` | `sm` | `sm` | `sm` | `lm` |
| 81–58 | `sm` | `sm` | `sm` | `sm` | `sm` |

**Measured**, connectivity — is the rendered sea *one body* from the proto-Gulf
to the Arctic? Taking `sm` minus `lm` inside −145…−80 E, 25…78 N and asking
whether (−94, 30) and (−128, 70) fall in the same polygon:

| 135–117 | 117–94 | 94–81 | 81–58 | 58–49 |
|---|---|---|---|---|
| **no** | **yes** | **yes** | **no** | no (no sea at the Arctic end) |

At 81–58 both endpoints are in sea, but in different bodies: a land belt runs
unbroken across −123…−95 E between 56 N and 62 N, with the surviving seaway
east of −100 E up to 55 N and a separate Arctic sea at 63–66 N.

**Sourced.** Roberts & Kirschbaum 1995, USGS Professional Paper 1561,
[doi:10.3133/pp1561](https://doi.org/10.3133/pp1561), read in full from
<https://pubs.usgs.gov/pp/1561/report.pdf>: *"A vast seaway occupied the
Western Interior of North America during the Late Cretaceous, connecting the
Circum-Boreal sea with the proto-Gulf of Mexico"*, and *"At its maximum extent,
the seaway extended for 4,800 km from the North Slope of Alaska to northern
Mexico and was approximately 1,620 km wide from central Utah to Minnesota …
(Kauffman, 1984)"* (**Verbatim**; the report's two print columns interleave in
the extracted text and both sentences were reassembled from split lines — the
words are the report's, the line breaks are not). *"In early Turonian time, the
Western Interior seaway had reached its maximum transgressive phase"*
(**Verbatim**). On the Boreal link: *"The sea transgressed from the north and
the south, finally joining in southern Colorado and northern New Mexico near
the time of the Neogastroplites cornutus zone"* — early Cenomanian — and
*"Marine deposits in Manitoba during the Cenomanian are the Ashville Formation
and the lower part of the Keld Member of the Favel Formation"* (**Verbatim**).
On the retreat: *"In general, the Maastrichtian marks the major retreat of the
epicontinental sea from the Western Interior (Bearpaw regression, R9 of
Kauffman (1984))"* and *"By the end of the Maastrichtian, the seaway had
retreated from the Western Interior, leaving the 'Triceratops' biochron
shoreline … near that of the present-day Gulf Coast in southernmost Texas"*
(**Verbatim**). A numeric peak age comes from a different paper, read in full:
*"…latest Cenomanian–Turonian (95–94 Ma) as a full connection with a northerly
boreal water mass was established during peak transgression"* and *"During peak
transgression (∼ 94.7 Ma …)"* — *Water-mass evolution in the Cretaceous Western
Interior Seaway of North America and equatorial Atlantic*, Climate of the Past
13, 855–875, [doi:10.5194/cp-13-855-2017](https://doi.org/10.5194/cp-13-855-2017)
(**Verbatim**).

**Not retrieved, and therefore not used:** Slattery et al. 2015 (WGA Guidebook
68th, 22–60) has no Crossref DOI and no reachable full text; the DataCite
deposit `10.13140/RG.2.1.4439.8801` returns publication year **2013** and
publisher **"Unpublished"**, confirming the literature memo's warning — it is
not that paper's DOI. Kauffman & Caldwell 1993 is a chapter in Caldwell &
Kauffman (eds), *Evolution of the Western Interior Basin*, GAC Special Paper 39,
ISBN 0-919216-52-8, 680 pp. (verified via OpenLibrary OL1197110M, LCCN
94189699 — **note the editor order is Caldwell & Kauffman**); the text was not
read and nothing is attributed to it. Blakey & Ranney is reference-only.

**Inference, and it is a pass.** Four independent things line up. The seaway
exists as a two-shored body at 40 N in three consecutive intervals; it is
**widest at 94–81** (1 428 km, against the cited 1 620 km from central Utah to
Minnesota — 12 % narrow, and the comparison is between a *present-day*
longitude span and a *palaeogeographic* width across ground that Laramide
shortening has since compressed, so the residual is not a defect); it is
**continuous from the proto-Gulf to the Arctic in exactly the two intervals
that contain the Cenomanian–Turonian peak**, 117–94 and 94–81; and it
**narrows and breaks its northern connection at 81–58**, which is the bin the
Bearpaw regression falls in. The one soft spot is that PP1561's width line is
given as place names spanning ~39–45 N, not as longitudes at 40 N: **no source
retrieved gives a quotable shoreline longitude at 40 N**, so the 1 428 vs
1 620 km comparison is our inference from the named endpoints, not a measured
agreement with a published number.

**The limitation.** 81–58 is a 23 Myr bin holding the late Campanian seaway,
the Maastrichtian Bearpaw retreat and the Palaeocene. Its maximum-transgression
semantics keep the largest extent in the bin, so the withdrawal that PP1561
describes as *the* defining event of the Maastrichtian is not renderable — and
the Danian Cannonball remnant falls outside any usable bin. This is the
literature memo's basin-queue row 1 confirmed: the seaway is present, its
*history* is not.

## 2. The Sundance / Curtis Sea, intervals 179–166 and 166–146

**Measured.**

| Point | 203–179 | 179–166 | 166–146 | 146–135 |
|---|---|---|---|---|
| (−108, 44) Wyoming | `sm` | `sm` | `sm` | `lm` |
| (−106, 46) Montana | `sm` | `sm` | `sm` | `lm` |

**Measured**, the seaway as a body: at 166–146 the whole scanned box
(−115…−100 E, 38…50 N) is `sm` except a three-cell land strip at 38 N; at
179–166 the sea occupies the west and north and the land margin runs
diagonally from (−114, 38) to (−102, 44); at **146–135 the entire box is `lm`,
with no marine cell anywhere**.

**Sourced.** *"The study interval spans the Middle to Upper Jurassic (Bajocian
to Oxfordian; ~170–155 Ma) marine and continental deposits from siliciclastic,
carbonate, and evaporite systems in the Sundance Seaway of Wyoming and adjacent
states"* and *"The axis of the basin extended from southern Utah northward into
northern British Columbia, a length of nearly 2000 km"* — Danise & Holland
2017, *Palaeontology*,
[doi:10.1111/pala.12278](https://doi.org/10.1111/pala.12278), full text read via
Europe PMC PMC5518760 (**Verbatim**). Imlay 1980, USGS Professional Paper 1062,
[doi:10.3133/pp1062](https://doi.org/10.3133/pp1062), read from
<https://pubs.usgs.gov/pp/1062/report.pdf>: *"Between these two episodes, the
area was invaded five times by marine waters that entered from the west through
Idaho, Washington, or Alberta. Three of the invasions were followed by complete
withdrawals of the sea from the region and two by partial withdrawals"*;
*"From late Bathonian to early Callovian, however, it advanced across Wyoming
into South Dakota"*; and, on the end, the Windy Hill Sandstone Member marine
sediments *"were deposited unconformably on the Redwater Shale Member of the
Sundance Formation and conformably below the continental Morrison Formation"*
(**Verbatim**). Danise & Holland add that the Windy Hill *"grades upward through
progressive loss of tidal influence into overlying coastal plain deposits of the
Upper Jurassic Morrison Formation (lower Oxfordian to lower Tithonian …)"*
(**Verbatim**). Kvale et al. 2001, PALAIOS 16, 233–254,
[doi:10.1669/0883-1351(2001)016<0233:MJBABD>2.0.CO;2](https://doi.org/10.1669/0883-1351(2001)016%3C0233:MJBABD%3E2.0.CO;2)
— DOI verified, article paywalled, **not read**; the JSTOR deposit
`10.2307/3515602` is the same article. Brenner & Peterson 1994 (pp. 217–232 in
Caputo, Peterson & Franczyk (eds), *Mesozoic Systems of the Rocky Mountain
Region, USA*, SEPM Rocky Mountain Section) has **no DOI** and was not retrieved;
its bibliographic identity is confirmed from Danise & Holland's reference list.

**Inference.** Both requested points are marine in both requested intervals,
and the sea is gone at 146–135. That matches the cited 170–155 Ma window and
the Windy Hill → Morrison transition precisely: 166–146 is the last Cao bin
that can hold a marine Oxfordian, and the next bin is continental everywhere.
**PASS at both points and both intervals, with a clean negative control at
146–135.**

**The limitation, and it is the same shape as Brent.** Imlay records *five*
marine invasions with *three complete withdrawals* inside the window the two
bins cover. The shipped map has two states for the whole of that. A user
scrubbing 179 → 146 Ma sees a sea that arrives once and leaves once.

## 3. The Cretaceous Gulf Coast and the Mississippi Embayment, (−90, 34)

**Measured**, and the scan that puts the reading in context (−90 E, 0.5° steps
in latitude; the northern shore is where `sm` gives way to `lm`):

| Interval | (−90, 34) | modelled northern marine limit on −90 E |
|---|---|---|
| 117–94 | `lm` | 32.5 N (33.0–33.5 N are `lm`+`sm`, rendering land) |
| 94–81 | `lm` | 33.0 N |
| 81–58 | `sm` | **37.0 N** |
| 58–49 | `sm` | 36.0 N |

**Sourced.** Cushing, Boswell & Hosman 1964, USGS Professional Paper 448-B,
[doi:10.3133/pp448b](https://doi.org/10.3133/pp448b), read from
<https://pubs.usgs.gov/pp/0448b/report.pdf>: *"The entire Mississippi embayment
was inundated by the Late Cretaceous sea to a point at least 20 miles north of
Cairo, Ill."* — Cairo is 37.0 N — and *"During the Late Cretaceous Epoch, the
sea reached its maximum northern limit for the Mesozoic Era"* (**Verbatim**).
On the Tuscaloosa: *"The thickness of the massive sand ranges from zero at its
northern limit, slightly south of the 34th parallel, to a possible maximum of
500 feet"* (**Verbatim**). PP 448-B is a 1964 water-resources report and gives
**no stage-level or numeric timing** for the flooding.

The timing evidence is a stratigraphic compilation, not a quotable sentence:
Macrostrat column 802 ("Supplemental Middle Mississippi embayment", 34.685 N,
−90.146 E), sourced to Dockery 2008, *Stratigraphic Units of Mississippi*,
Mississippi DEQ, returns **Coker Fm 93.9–90.8 Ma and Gordo Fm 90.8–85.7 Ma as
non-marine** (fluvial and deltaic, the Tuscaloosa Group), with the first marine
units **McShan and Eutaw at ~85.7–84.1 Ma (Santonian)** and a continuously
marine section from there through the Maastrichtian (**Snippet** — a database
compilation under CC BY 4.0, not a paper's own words). Cox & Van Arsdale 2002,
[doi:10.1016/S0264-3707(02)00019-4](https://doi.org/10.1016/S0264-3707(02)00019-4),
and 1997,
[doi:10.1016/S0013-7952(97)00003-3](https://doi.org/10.1016/S0013-7952(97)00003-3),
resolve correctly but are paywalled and were **not read**; nothing is attributed
to them.

**Inference.** The modelled shore on −90 E is at 33 N at 94–81 and jumps to
37.0 N at 81–58, which is within 0.3° of PP 448-B's cited maximum limit "at
least 20 miles north of Cairo". The 81–58 reading is right and well placed. The
94–81 reading of **land at 34 N is right for most of its own bin** — Coker and
Gordo are non-marine from 93.9 to 85.7 Ma, which is 8 of the bin's 13 Myr — and
wrong for the Santonian tail, 85.7–81 Ma, when McShan and Eutaw are offshore
marine at that point. **PARTIAL**: the class is defensible, but it is the
*minimum-transgression* answer in a bin whose stated semantics are maximum
transgression, so the bin is not behaving the way the map key says it does here.
And the compilation this rests on is a database reading, not a cited sentence;
an edit would need better.

## 4. Palaeozoic epeiric seas on the craton, intervals 402–380 … 296–285

**Measured.**

| Point | 402–380 | 380–359 | 359–338 | 338–323 | 323–296 | 296–285 | 285–269 |
|---|---|---|---|---|---|---|---|
| (−90, 40) Illinois Basin | `sm` | `sm` | `sm` | `sm` | `sm` | `lm` | **`neither`** |
| (−100, 38) central Kansas | `lm`+`sm` | `sm` | `sm` | `sm` | `sm` | `sm` | **`neither`** |
| (−85, 37) Cincinnati Arch | `lm`+`sm` | `sm` | `sm` | `sm` | `sm` | `lm` | **`neither`** |

The three `neither` readings at 285–269 are the source hole of §12.3, not a
statement about the Sakmarian–Kungurian craton.

**Sourced — and a DOI correction.** The DOI normally quoted for Sloss 1963,
`10.1130/0016-7606(1963)74[93:SSOTCI]2.0.CO;2`, **does not resolve**: doi.org
and Crossref both return 404. The acronym is wrong. The DOI that resolves is
**`10.1130/0016-7606(1963)74[93:SITCIO]2.0.CO;2`**, and Crossref returns
*"Sequences in the Cratonic Interior of North America"*, Sloss, 1963,
*Geological Society of America Bulletin* 74, 93, redirecting to the publisher's
**74(2), 93–114** (**Verbatim** metadata from the Crossref record). The paper
itself is paywalled and was **not read**, so **the Kaskaskia and Absaroka age
spans are not sourced in this memo** and no numeric span is attributed to
Sloss. The closest retrievable statement is from *Phanerozoic flooding of North
America and the Great Unconformity*, PNAS 2023,
[doi:10.1073/pnas.2309084120](https://doi.org/10.1073/pnas.2309084120), read in
full via Europe PMC PMC10500175: *"Five flooding events, each < 50 My in
duration, are well resolved and correspond to the Sauk, Tippecanoe, Kaskaskia I,
Zuni I, and Zuni II sequences"* and *"The Absaroka I and II sequences, which do
not constitute strong flooding peaks, mainly record the Late Paleozoic flooding
of southwestern Laurentia associated with foreland basin formation"*
(**Verbatim**).

Point evidence is again a compilation (Macrostrat, columns from Childs 1985,
COSUNA, AAPG Bulletin 69, 173–180) (**Snippet**): at (−90, 40) the Devonian–
Mississippian section is **28 units, every one marine** (Clear Creek, Grand
Tower, New Albany/Grassy Creek, Chouteau, Burlington, Keokuk, Warsaw, Salem,
St Louis, Ste Genevieve), then Pennsylvanian Caseyville–Carbondale–Bond, marine
*and* non-marine, ending at 304.3 Ma with no Permian preserved. At (−85, 37)
the Devonian–Mississippian is 13 units, all marine, including the Chattanooga /
New Albany Shale 382–359 Ma, and the record stops at 319.7 Ma with the
non-marine Corbin Sandstone. At (−100, 38) **there is no Devonian or
Mississippian record at all** — the column jumps from the Arbuckle Group
(488–472 Ma) to the Desmoinesian (312 Ma) — and then runs marine-labelled from
312 to ~282 Ma (Wolfcampian Admire–Council Grove–Chase), marine Leonardian to
~276 Ma, and non-marine from ~276 Ma (lacustrine Salt Plain, eolian Cedar Hills).

**Inference.** The Kaskaskia part is a **PASS**: the shipped map says shallow
sea at (−90, 40) and (−85, 37) in all four Devonian–Mississippian bins, and both
columns are entirely marine through that window. At (−100, 38) the model's `sm`
is **unconstrained rather than wrong** — nothing of that age is preserved on the
Central Kansas Uplift, so the map is making a claim the local record cannot
test. The Absaroka part is weaker in a way the map cannot fix: Macrostrat's
environment tags are coarse formation-level "inferred marine", so the
Pennsylvanian cyclothems' marine/non-marine alternation is invisible in the
evidence *and* in the model; reading `sm` at 323–296 as "continuously marine"
would be wrong in both. The Early Permian rows are right where they can be
checked — `sm` at Kansas in 296–285 matches a marine Wolfcampian, `lm` at
Illinois and Kentucky matches no preserved Permian — but "no strata preserved"
is not the same as "emergent", and 285–269 cannot be judged at all.

---

# B. South America

## 5. The Pebas mega-wetland, intervals 20–11 and 11–2

**Measured.**

| Point | 29–20 | 20–11 | 11–2 |
|---|---|---|---|
| (−72, −4) | `lm` | `lm` | `lm` |
| (−70, −2) | `lm` | `lm` | `lm` |
| (−75, −6) | `lm` | `lm` | `lm` |

**Measured**, and this is the stronger result: on a 1° grid over western
Amazonia (−78…−64 E, −10…2 N, 195 cells) there is **no shallow-marine cell at
all** at 29–20, and essentially none at 20–11 or 11–2 — the sea fraction of
that box, taking `sm` minus `lm`, is **0.00 %, 0.02 % and 0.01 %** in the three
intervals. The only non-land readings are at the box's northern edge on the
Caribbean coast. Four further points confirm it: the Llanos (−72, 4), the
Marañón (−75, −4), Acre (−70, −9) and Iquitos (−73, −3.7) are `lm` at 29–20,
20–11 and 11–2 alike; (−71, 3) is `lm`+`sm` at 20–11, which renders land. For
contrast, the Amazon mouth (−50, −1) is `sm` at 29–20 and 20–11.

**Sourced.** Hoorn et al. 2010, *Science* 330, 927–931,
[doi:10.1126/science.1194585](https://doi.org/10.1126/science.1194585), read
from the local PDF: Fig. 1 labels panel C **"Pebas system" / "23 to 10 Ma"** and
panel D **"Acre system" / "10 to 7 Ma"**, and its legend classes are
*Mountains/hills, Lowland, **Lake/wetland**, Coastal seas, Oceanic, Rivers* —
the Pebas and Acre areas are drawn in the **Lake/wetland** class, not in
Coastal seas (**Verbatim**, figure labels and legend). Text: *"a large wetland
of shallow lakes and swamps developed in Western Amazonia"*, and *"the Western
Amazonian wetland changed from a lacustrine to a fluvial or fluvio-tidal
system … which resembled the present-day Pantanal"* (**Verbatim**).

Wesselingh et al. 2002, *Lake Pebas: a palaeoecological reconstruction of a
Miocene, long-lived lake complex in western Amazonia*, *Cainozoic Research*
1(1–2), 35–81 — **no DOI**; identity verified from the PDF's own running head,
which also settles the page range the publisher landing page gets wrong.
**Verbatim** from the abstract: *"Isotope data from the shells indicate
freshwater settings during deposition of the Pebas Formation, with the
exception of a few incursion levels that were deposited under
oligohaline-mesohaline conditions. Faunal and isotope geochemical data point to
a large, long-lived freshwater lake system at sea level with swamps and deltas,
open to marine settings in the north (Llanos Basin)."* Wesselingh et al. 2006,
*Scripta Geologica* 133, 363–393 (**no DOI**, identity verified from the paper's
own citation line), **Verbatim**: *"The mollusc and isotope data show no
indications of elevated salinities"*, and, stating the disagreement, *"Wesselingh
et al. (2002) argued for a long-lived system of predominantly freshwater lakes
and swamps with only very limited marine influence, up to oligohaline at its
maximum."*

Jaramillo et al. 2017, *Science Advances* 3, e1601693,
[doi:10.1126/sciadv.1601693](https://doi.org/10.1126/sciadv.1601693), read in
full (**Verbatim**): *"We observed two distinct marine intervals in the Llanos
Basin, an early Miocene that lasted ~0.9 My (million years) (18.1 to 17.2 Ma)
and a middle Miocene that lasted ~3.7 My (16.1 to 12.4 Ma). These two marine
intervals are also seen in Amazonas/Solimões Basin (northwestern Amazonia) but
were much shorter in duration, ~0.2 My (18.0 to 17.8 Ma) and ~0.4 My (14.1 to
13.7 Ma), respectively. Our results indicate that shallow marine waters covered
the region at least twice during the Miocene, but the events were short-lived,
rather than a continuous full-marine occupancy of Amazonian landscape over
millions of years."* Their Amazonas/Solimões core 105-AM is at **4.25 S,
69.93 W** — within ~230 km of two of the three probe points — and the two marine
beds there are *"9.3 and 4.5 m"* thick (**Verbatim**). For the third point they
are explicit that no constraint exists: correlation to the *"Ucayali, and Madre
de Dios basins … remains uncertain and is beyond the scope of the present
analysis"* (**Verbatim**).

**Inference, and the verdict is PASS — for the reason the literature memo
feared it would not be.** Basin-queue row 4 warns that *"Cao's `sm` class would
render a **marine** western Amazonia"* and that an edit "must add a lake/wetland
epistemic label, not a shallow sea, or it will assert the contested reading".
The shipped payload does the opposite: it renders western Amazonia as **land**,
everywhere, in every Neogene interval. Against Wesselingh's predominantly
freshwater reading and Jaramillo's 0.2–0.4 Myr ceiling on marine occupancy at
these coordinates, **land is the defensible class and `sm` would have been the
contested one**. The globe is not asserting a Miocene sea over Amazonia, and no
edit toward one is warranted.

**What is missing is a class, not a polygon.** The Pebas mega-wetland — the
single largest palaeoenvironmental feature of Neogene South America, drawn in
Hoorn's own figure as *Lake/wetland* — is invisible, because EarthHistory has
land and shallow sea and nothing between. This is the same gap as the Orcadian
Lake in the formation-checks memo, at continental scale. Painting it `sm` would
be wrong; leaving it `lm` is right and silent. It belongs in the map key as a
stated limitation, not in `data/corrections`.

## 6. The Paranense sea, intervals 20–11 and 11–2

**Measured.**

| Point | 81–58 | 29–20 | 20–11 | 11–2 |
|---|---|---|---|---|
| (−58, −33) Entre Ríos | `sm` | `lm` | **`sm`** | **`sm`** |
| (−60, −30) Chaco–Paraná | `sm` | `lm` | **`sm`** | **`sm`** |
| (−62, −36) Pampas | `sm` | `lm` | `lm` | `lm` |

**Measured**, the sea as a body (1° grid, −66…−52 E, −38…−26 N): at **29–20
there is no embayment** — everything from −26 to −33 N is land, and marine
cells appear only south of −34 N along the Atlantic. At **20–11** a
north-pointing embayment occupies −62…−57 E from −26 to −35 N, and at **11–2** a
similar but slightly narrower one. The connectivity test — is the Atlantic at
(−56, −36) the same body as the Chaco at (−60, −29)? — returns **not connected
at 29–20, connected at 20–11 and connected at 11–2**.

**Sourced, and the working figures need correcting.** Hernández et al. 2005,
*J. South American Earth Sciences* 19, 495–512,
[doi:10.1016/j.jsames.2005.06.007](https://doi.org/10.1016/j.jsames.2005.06.007),
resolves and its identity is confirmed, but **the full text and even the
abstract could not be retrieved** (publisher 403; Crossref, OpenAlex and
Semantic Scholar all carry no abstract — Semantic Scholar states it was elided
by the publisher; Unpaywall reports closed access with no repository copy).
**The literature memo's "Paranense transgressions 15–13 and 10–5? Ma" is
therefore unverified**, and the paper's study area is southern Bolivia and NW
Argentina — the Yecua Formation domain — not Entre Ríos or the Pampas, so its
numbers should not be transferred to these points in any case.

The retrievable primary constraint is Marengo 2006, *Micropaleontología y
estratigrafía del mioceno marino de la Argentina: las transgresiones de Laguna
Paiva y del "Entrerriense-Paranense"*, PhD thesis, Universidad de Buenos Aires
— **no DOI**; identity verified from the UBA Biblioteca Digital record
(handle `20.500.12110/tesis_n4023_Marengo`) and the PDF title page; ~200
boreholes across the Chacoparanense and Salado basins. **Verbatim** from its
English abstract: *"The upper marine level corresponds to the Paraná Formation
or 'Entrerriense', and is referred here as 'Entrerriense-Paranense'
Transgression (TEP), from the middle-late? Miocene. Both transgressions flooded
the whole Pampa and Chaco Plains and reached some sectors in the Sierras
Pampeanas, Cuyo and Northwest regions in Argentina."* And, dated: *"Approximately
at 25 My (end of Chattian) started a big transgression that flooded the whole
basin … At the end of the Aquitanian (c. 21 My) the regression could take place
… At the end of Langhian (c. 15 My) a new huge transgression called TEP, was
produced. … The levels with maximum microfossil diversities (c. 13-12 My) …
probably corresponds to the maximum flooding of the basin. There were not found
adequate stratigraphic elements to determine the end of the TEP, but is possible
to estimate that it could happened at the end of the Serravalian or in the early
Tortonian (c. 10 My)."* On water type inland: *"to the continental interior the
microfaunas become poorer, reaching the NW and NE of Argentina with scarce
species typical of brackish environments"* (**Verbatim**). On the water's
source, which bears on how the connection should be drawn: *"microfossil
geographic distribution of TLP and TEP indicates that both transgressions flooded
from Salado Basin to the north … data exposed here demonstrate that this
migration was not possible trough the continental interior, and probably it was
done by the eastern continental platform of South America"* (**Verbatim**).

**Aceñolaza on the "Mar Paranense" could not be found.** No such paper surfaced
in Crossref or OpenAlex author/title queries; the only retrievable related item
is Anzótegui & Aceñolaza 2008, *Neues Jahrbuch für Geologie und Paläontologie —
Abhandlungen* 248, 159–,
[doi:10.1127/0077-7749/2008/0248-0159](https://doi.org/10.1127/0077-7749/2008/0248-0159),
paywalled with no abstract; its title assigns the Paraná Formation a
"Middle-Upper Miocene" age, which is consistent with Marengo and is all that is
attributable to it.

**Inference.** Three separate verdicts.

- **20–11 is a PASS, and a good one.** Marengo's TEP runs ~15 to ~10 Ma with
  maximum flooding at 13–12 Ma; that sits squarely inside 20–11, and the shipped
  map produces a connected marine embayment reaching Entre Ríos and the
  Chaco–Paraná exactly there, with a clean land control at 29–20 immediately
  before it. The transgression is in the right bin with the right shape.
- **11–2 is a FAIL by over-extension.** Marengo has the sea withdrawing at
  ~10 Ma, within the first million years of that 9 Myr bin; the shipped map
  paints it marine throughout. This is the maximum-transgression rule producing
  a sea that persists eight million years past its cited end. It is not a
  geometry error — an edit that removed it would also remove the sourced
  10–11 Ma remnant — it is a bin limitation, and the honest response is the
  limitation line.
- **(−62, −36) is unconstrained, not wrong.** Marengo's "whole Pampa Plain"
  is a regional generalisation; his stated borehole grid is northern Buenos
  Aires province plus the Salado and Colorado basins, and this point lies
  between and west of those depocentres. The map says land; the source neither
  confirms nor contradicts it there.
- **29–20 misses a transgression the sources do have.** Marengo's TLP flooded
  the whole basin from ~25 Ma to ~21 Ma, which is inside 29–20, and the shipped
  map is land at all three points in that bin. That is the opposite failure from
  11–2 and it cannot be blamed on binning: the bin's own
  maximum-transgression semantics should have kept the TLP. **FAIL at 29–20**,
  and the only mismatch in this province that would justify a cited basin edit.

## 7. Cretaceous NE Brazil: Sergipe–Alagoas and the Araripe interior, 135–117 and 117–94

**Measured.**

| Point | 146–135 | 135–117 | 117–94 | 94–81 |
|---|---|---|---|---|
| (−37, −10) Sergipe–Alagoas | `lm` | `lm` | **`sm`** | `lm` |
| (−40, −7) Araripe | `lm` | `lm` | **`sm`** | `lm` |

**Measured**, the region (1° grid, −46…−33 E, −14…−2 N): at 146–135 and
135–117 every cell inside the continent is `lm`; at **117–94** shallow sea
covers the whole northern strip from −46 to −34 E at −2 and −4 N and reaches
inland to about −38 E at −10 N and −39 E at −12 N; at 94–81 the sea has
retreated to a coastal band 2–4° wide, leaving both probe points on land.

**Sourced.** For **Sergipe–Alagoas**, no open review of the basin was
retrievable (Luft-Souza et al. 2022,
[doi:10.1016/j.earscirev.2022.104034](https://doi.org/10.1016/j.earscirev.2022.104034),
is paywalled with no abstract anywhere), so the constraint is stage-level and
comes from open Brazilian journals. Figueiredo et al. 2025, *Anuário do
Instituto de Geociências* 48,
[doi:10.11137/1982-3908_2025_48_68263](https://doi.org/10.11137/1982-3908_2025_48_68263)
(**Verbatim**): the margin's megasequences are *"continental, in the pre-rift
and rift phases; evaporitic, in the proto-oceanic phase; carbonate, in the
shallow shelf phase; transgressive marine and, finally, regressive marine"*; and
*"The Riachuelo Formation stands out for its clear marine sedimentation,
resulting from the sea-level rise at the beginning of the Albian … The
sedimentary deposits of the Riachuelo Formation extended from the Neoaptian to
the Neoalbian. At the beginning of the Cenomanian, there was a huge marine
transgression on the east coast that culminated in the drowning of the carbonate
platform."* Antonietto et al. 2015,
[doi:10.4072/rbp.2015.3.02](https://doi.org/10.4072/rbp.2015.3.02) (**Snippet**,
publisher abstract): the Riachuelo ostracods are *"upper Aptian-Albian"* with
faunal interchange with Tethyan provinces *"beginning in the latest Aptian"*.
**No source retrieved gives numeric (Ma) ages for the Sergipe–Alagoas evaporite
→ open-marine transition** — only stage names.

For the **Araripe**, Melo et al. 2020, *Scientific Reports* 10, 15779,
[doi:10.1038/s41598-020-72789-8](https://doi.org/10.1038/s41598-020-72789-8),
read in full (**Verbatim**): *"Marine fossils exemplified by dinoflagellates,
foraminifera, fishes, echinoids and mollusks are also found in the Romualdo
Formation … and record the establishment of a marine ingression, on the aborted
intraplate Araripe rift."*; *"In northeast Brazil, the Aptian transgression was
sufficiently extensive that evaporites were deposited even in the interior
basins."*; *"the local Alagoas Stage (Ostracoda Zone RT-011) can now be
constrained to the Aptian"*; and, on the environment, *"a position more distal
to intermediate in the context of the epicontinental shallow sea"*. Fauth et al.
2023, *Scientific Reports* 13, 6728,
[doi:10.1038/s41598-023-32967-w](https://doi.org/10.1038/s41598-023-32967-w)
(**Verbatim**, abstract): *"three short-lived marine incursions were identified,
designated Araripe Marine Incursions (AMI) 1–3 … indicates early Aptian/early
late Aptian age for these deposits … these incursions represent the earliest
marine-derived flooding events in the inland basins of northeastern Brazil."*
Assine's own text was **not retrieved** (Assine et al. 2014, *Bol. Geoci.
Petrobras* 22, 3–28, no DOI); nor was Arai's; nothing is attributed to either.

For the **Parnaíba interior** — which the 117–94 sea also covers — Ramos,
Rossetti & Paz 2006, [doi:10.4072/rbp.2006.3.09](https://doi.org/10.4072/rbp.2006.3.09)
(**Verbatim**): the Codó Formation carries *"a Neoaptian lacustrine fauna"* in
*"a cyclic depositional lacustrine environment … mainly as hipersaline, with
shallow-water and very low oxygen levels"*. Corrêa-Martins 2019,
[doi:10.1590/0001-3765201920180730](https://doi.org/10.1590/0001-3765201920180730)
(**Verbatim**): *"the Itapecuru Formation is predominantly non-marine in
Parnaíba Basin, with floodplain facies, as valley-flat and alluvial plain,
gradually changing to deltaic facies in São Luís Basin"*, with marine conditions
only *"in the north of the basin, in the region of Alcântara"*; the neostratotype
is Lower–Middle Albian and fluvial.

**Inference.** The Cao boundary at 117 Ma falls inside the Aptian (121.4–113 Ma),
which is what decides both readings.

- **117–94 is a PASS at both points.** It holds the latest Aptian, the whole
  Albian and the Cenomanian; the Riachuelo carbonate platform is open marine
  from the base of the Albian and drowned at the Cenomanian, and the Romualdo
  ingression is Aptian and epicontinental. A shallow sea at (−37, −10) and
  (−40, −7) in that bin is the right claim in the right bin.
- **135–117 is PARTIAL.** It is right for the Valanginian–Barremian and for the
  continental and evaporitic phases, and wrong for the early Aptian: Fauth's
  AMI 1–3 are *"early Aptian/early late Aptian"* and therefore fall mostly on
  the older side of the 117 Ma boundary, and the map has land there. The events
  are short-lived — three incursions, not a standing sea — so this is not a
  candidate for an edit.
- **94–81 renders land at both points, and that is right**: the Riachuelo
  platform is drowned, the depocentre has moved offshore, and the modelled
  retreat to a 2–4° coastal band matches.
- **One caution the map cannot express.** The 117–94 sea reaches inland across
  the Parnaíba Basin, where the coeval Itapecuru is fluvial and the underlying
  Codó is a *hypersaline lake*, not a sea. As in §5, the missing class is
  lacustrine, and the honest response is a limitation, not a polygon.

## 8. Devonian seas of the Amazonas/Solimões and Paraná basins, 402–380 and 380–359

**Measured.**

| Point | 402–380 | 380–359 | 359–338 |
|---|---|---|---|
| (−60, −4) Amazonas/Solimões | `sm` | `sm` | `lm` |
| (−52, −25) Paraná | `sm` | `sm` | `lm` |

**Sourced.** Carvalho & Ponciano 2015,
[doi:10.46357/bcnaturais.v10i1.492](https://doi.org/10.46357/bcnaturais.v10i1.492)
(**Verbatim**, abstract): the Amazonas Basin Devonian benthic fauna *"occur in
the Maecuru (latest Emsian – early Eifelian) and Ererê (latest Eifelian – early
Givetian) formations, representing the families Homalonotidae, Dalmanitidae, and
Calmoniidae"*, with an *"unusual mixture of supposedly Malvinokaffric and
Appalachian taxa"*. For the Upper Devonian Barreirinha Formation, Góes et al.
2026, [doi:10.21680/2447-3359.2026v12n1id32868](https://doi.org/10.21680/2447-3359.2026v12n1id32868)
(**Verbatim**): *"o paleoambiente deposicional era uma plataforma distal com
variação óxico-anóxica"* and *"predominância de componentes marinhos sob
terrestres, indicando deposição em ambiente marinho"*. For the Paraná Basin,
Comniskey & Ghilardi 2018, *Palaeontologia Electronica* 21.1.7A,
[doi:10.26879/712](https://doi.org/10.26879/712) (**Verbatim**): *"The Paraná
supersequence (Devonian) is … represented by successive transgressive-regressive
cycles that are linked to sea-level oscillations"*; the Ponta Grossa Formation
is *"characterized by marine deposits of shoreface to offshore environments, in
a dominantly transgressive trend"* and *"ranges from the early Pragian to the
late Emsian"*; the São Domingos Formation records *"marine deposits of the inner
and outer shelf"*, Emsian to Frasnian; and *"A regional gap is recorded during
the latest early Emsian and the earliest late Emsian, as a result of the Andean
Pre-Cordillera epirogenesis."*

Melo 1988's true citation is **Melo, J.H.G. 1988, *The Malvinokaffric Realm in
the Devonian of Brazil*, in McMillan, Embry & Glass (eds), *Devonian of the
World*, Canadian Society of Petroleum Geologists Memoir 14(1), 669–703** — **no
DOI**; verified twice, from the reference list of Grahn & Melo 2006 (of which
Melo is a co-author) and from the OpenAlex record with matching pages. The text
was not retrieved. **Grahn's chitinozoan zonation papers have verified DOIs but
no retrievable abstract or text** ([doi:10.1016/j.revmic.2004.03.001](https://doi.org/10.1016/j.revmic.2004.03.001),
[doi:10.2113/0260135](https://doi.org/10.2113/0260135),
[doi:10.1016/S0034-6667(01)00109-9](https://doi.org/10.1016/S0034-6667(01)00109-9)),
so **no sentence in this memo is attributed to Grahn**; his zonations reach the
memo only through Comniskey & Ghilardi's quotation of them.

**Inference — PASS at both points and both intervals.** 402–380 is
Pragian–Givetian and 380–359 is Givetian–Famennian; both basins are marine
across that whole window on independent evidence — benthic trilobites and a
distal anoxic shelf in the Amazonas, shoreface-to-offshore and inner/outer-shelf
deposits in the Paraná. The `lm` at 359–338 is also right in sign, since no
source retrieved supports a Famennian–Visean epeiric sea at either point. The
Emsian regional gap that Comniskey & Ghilardi record inside the Paraná
succession is, as usual, below the resolution of a 22 Myr bin.

---

# C. Siberia

## 9. The West Siberian Sea, intervals 94–81, 81–58, 58–49 and 49–37

**Measured.** All four requested points, all four requested intervals:

| Point | 94–81 | 81–58 | 58–49 | 49–37 | 37–29 (control) |
|---|---|---|---|---|---|
| (70, 62) | `sm` | `sm` | `sm` | `sm` | **`lm`** |
| (75, 60) | `sm` | `sm` | `sm` | `sm` | **`lm`** |
| (80, 58) | `sm` | `sm` | `sm` | `sm` | **`lm`** |
| (65, 58) | `sm` | `sm` | `sm` | `sm` | **`lm`** |

**Measured**, the sea as a body (1° scan, 55…85 E): at 58–49 and 49–37 an
unbroken shallow-marine field runs from ~54 N to ~70 N across 61–82 E; at
37–29 every cell between 48 N and 64 N is `lm`, and the only marine ground left
in the box is north of 66 N. The sea first appears at (75, 60) and (80, 58) in
**166–146** and is continuously `sm` from there to 49–37, except that (75, 60)
and (80, 58) read `lm`+`sm` at 179–166 and (80, 58) reads `lm` at 135–117.

**Sourced.** Akhmetiev, Zaporozhets, Benyamovskiy, Aleksandrova, Iakovleva &
Oreshkina 2012, *The Paleogene history of the Western Siberian seaway — a
connection of the Peri-Tethys to the Arctic ocean*, *Austrian Journal of Earth
Sciences* 105/1, 50–67 — **no DOI** (AJES volumes 95–110 were never deposited
with Crossref); identity verified from the publisher's own issue page and from
the PDF header at
<https://ajes.at/images/AJES/archive/Band%20105_1/akhmetiev_et_al_ajes_v105_1.pdf>,
and the literature memo's warning is confirmed — **the journal is AJES, not
*Stratigraphy and Geological Correlation***. Note also that OpenAlex carries a
*different, wrong* title for this record; the publisher's title is the one above.
**Verbatim** from it: *"The existence of a meridional seaway system between the
Arctic and the Tethys oceans in western Asia started in the Late Cretaceous
(Naidin, 2007). It was interrupted at the Cretaceous/Paleogene boundary and
resumed from the Middle Danian to the Lutetian."* On the Eocene maximum:
*"The area of the West Siberian Plate covered by sea reached its maximum, above
60%"*, and *"The largest eustatic transgressions occurred in the Ypresian,
especially the Early Ypresian. They also occurred in the Middle Lutetian, in
the Late Bartonian and at the end of the Priabonian."* On the end: *"The Tavda
Formation formed at the final stage of the marine sedimentation during the
Bartonian and Priabonian"*, and *"The sea retreated from the West Siberian Plate
and Turgai trough at the Eocene/Oligocene boundary as a result of a global
regression."*

Akhmetiev & Beniamovski 2009, *Geologica Acta* 7(1–2), 297–309,
[doi:10.1344/105.000000278](https://doi.org/10.1344/105.000000278), fetched in
full (**Verbatim**): *"In the Late Cretaceous connections between Paleoarctic
and Tethyan water masses and biotas were provided mostly by two N-S trending
epicontinental seaways: (1) the Western Interior Basin of North America … and
(2) the West Siberian–Turgai Basin in northern Central Eurasia"*; the extent,
*"…extended for 3,500 km from the Aral Sea in the south to the recent Franz
Josef Land and the Severnaya Zemlya in the north"*; and the end, *"The West
Siberian Sea and Turgai Strait were drained in the Late Eocene-Oligocene
transition"*.

The ~34.8 Ma end date is **Snippet**, not Verbatim: Iakovleva &
Heilmann-Clausen 2010, *Palynology* 34(2), 195–232,
[doi:10.1080/01916121003629974](https://doi.org/10.1080/01916121003629974), is
closed access (Unpaywall `oa_status: closed`, no repository copy; the publisher
returns 403), and the sentence *"marine sedimentation was interrupted in
southwestern Siberia during the Late Priabonian (∼34.8 Ma)"* comes from the
publisher-supplied abstract, not from the paper's own pages.

The **Vinogradov Atlas** was verified for editor, title and publisher only —
1967/1968, Moscow, GUGK and the Ministry of Geology / Academy of Sciences of
the USSR (OpenLibrary records, plus the reference list of USGS OFR 85-367).
**VSEGEI appears in no record that was verified**, and no sheet of the atlas was
seen; nothing here rests on it.

**Inference, and it is a pass.** Four points, four intervals, sixteen `sm`
readings, with a clean `lm` control at 37–29 in every one. The sea appears in
166–146, is marine through every Late Cretaceous and Palaeogene bin, and closes
in 37–29 — which is the bin that contains both the ~34.8 Ma end of marine
sedimentation and the Eocene/Oligocene drainage that two independent Akhmetiev
papers give. That is the right answer in the right bin, arrived at from the
source rather than from an edit. **PASS at all sixteen point×interval cells.**

**The limitation.** Akhmetiev's K/Pg statement — *"It was interrupted at the
Cretaceous/Paleogene boundary"*, with *"most of Eurasia and adjacent areas …
above the sea level"* — falls inside the 81–58 bin, which the map paints
uniformly marine. A 23 Myr maximum-transgression bin cannot show a regression
in its middle. Do not read the shipped 81–58 payload as a claim that the seaway
was continuously open from 81 to 58 Ma; the literature says it was not.

**Sourced, and it matters for how the map is described.** Straume, Steinberger,
Becker & Faccenna 2024, EPSL 630, 118615,
[doi:10.1016/j.epsl.2024.118615](https://doi.org/10.1016/j.epsl.2024.118615),
**Verbatim**: *"For the WSS in the Cenozoic, our reconstructions show a closed
seaway in the Paleocene (66–56 Ma), an open but shallow seaway in the Eocene
(56–33.9 Ma), and a closed seaway afterwards."* **Inference.** The shipped map
is marine at 81–58 and 58–49 and therefore follows **Akhmetiev's dated marine
record, not Straume's dynamic-topography model**, which has the Palaeocene
closed. The literature memo's requirement that "an edit must pick one and say
which" is already satisfied by the source — but the *record* has to say so,
because the two frameworks genuinely disagree about the Palaeocene, and
Straume's own paper flags the weakness: *"The timing of Arctic-Peri-Tethys
connections may be hard to constrain using our dynamic topography computations
given the temporal resolution and increasing uncertainties back in time."*

## 10. The Turgai Strait — the plan's premise is wrong

The plan's audit and the literature memo's basin-queue row 2 both say **Turgai
is land in every Cao interval**, making it "the single most-cited Palaeogene
epicontinental seaway in Eurasia … absent from the globe" and the
"highest-value fix". That premise came from
[palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md)'s witness table,
which samples **four** intervals — 402–380, 269–248, 248–224 and 94–81 — and
finds land at (65, 52) in all four. It is generalised, and the generalisation
does not hold.

**Measured.** (65, 52) and (63, 50) across all 24 intervals; the six that
matter:

| Point | 94–81 | **81–58** | **58–49** | **49–37** | 37–29 | 29–20 |
|---|---|---|---|---|---|---|
| (65, 52) | `lm` | **`sm`** | **`sm`** | **`sm`** | `lm` | `lm`+`sm` → land |
| (63, 50) | `sm` | **`sm`** | **`sm`** | **`sm`** | `lm` | `lm`+`sm` → land |

**Measured**, and this is the stronger statement: the strait is not just two wet
points, it is an **open marine corridor**. Taking `sm` minus `lm` inside
45…100 E, 40…78 N and asking whether the West Siberian Sea at (72, 64) and the
Peri-Tethys at (58, 45) fall in the same polygon:

| 94–81 | 81–58 | 58–49 | 49–37 | **37–29** | 29–20 |
|---|---|---|---|---|---|
| connected | connected | **connected** | **connected** | **not connected** | not connected |

The 1° scan shows the corridor explicitly at 58–49: shallow sea at 62–66 E on
52 N and 60–65 E on 50 N, joining the broad Peri-Tethys field at 46–48 N to the
West Siberian field from 54 N northward. At 37–29 every cell from 48 N to 64 N
across 55–85 E is land.

**Sourced.** Akhmetiev & Beniamovski 2009 (same DOI as above), **Verbatim**:
*"In the Early-Middle Eocene through Bartonian the West Siberian sea-strait
became separated from the Polar Basin … The West Siberian sea-strait became a
semiclosed basin, which was connected to the Turanian Sea only through the
Turgai Strait."*; *"In the Eocene-Oligocene boundary time, the sea left both the
West Siberian Plate and the Turgai Trough. In the Early Oligocene (the
Ashzheairyk time), the sea penetrated from the Northern Ustyurt Plateau through
the Turgai Trough into the West Siberian depression."*; and *"The only remaining
portion of the N-S trending seaway (i.e., the Turgai Strait and basin in the
Southern Western Siberia …) represented a large warm-water Tethyan gulf
penetrating far to the north."* Akhmetiev et al. 2012, **Verbatim**: *"The
salinity recovery was interrupted again by a new global regression at the
Eocene/Oligocene boundary, when not only the West Siberian Sea but also the
Turgai Strait became land."* For a dated marine section inside the strait,
Radionova et al. 2001, *Bull. Soc. Géol. France* 172(2), 245–256,
[doi:10.2113/172.2.245](https://doi.org/10.2113/172.2.245) — **Snippet**, from
the publisher abstract: the uppermost Palaeocene–lowermost Eocene of the
Sokolovskii section in the Turgay Passage records *"two transgressive-regressive
cycles … interrupted by short hiatuses"*.

**"Iakovleva 2011" could not be verified to exist.** No 2011 Iakovleva paper on
the Turgai Strait or Eocene West Siberian dinocysts appears in Crossref or in
the author's complete OpenAlex 2008–2013 work list. The real Turgai dinocyst
paper is Iakovleva, Brinkhuis & Cavagnetto 2001, *Palaeogeography,
Palaeoclimatology, Palaeoecology* 172(3–4), 243–268,
[doi:10.1016/S0031-0182(01)00300-5](https://doi.org/10.1016/S0031-0182(01)00300-5)
(identity verified; no abstract deposited, text not read). **Nothing in this
memo is attributed to "Iakovleva 2011" and it should be struck from the queue
row.**

**Inference, and the verdict is PASS.** The strait is open in the shipped map
in exactly the three bins that cover the Danian-to-Priabonian marine record —
81–58, 58–49, 49–37 — and closes in 37–29, the bin holding the Eocene/Oligocene
drainage. The two probe points, the corridor scan and the connectivity test all
agree. **The correct reading of the four-interval witness table is that
402–380, 269–248, 248–224 and 94–81 happen to be four intervals in which the
Turgai is dry** — and at 402–380 it is not even dry, it is *empty*, for the
palette reason in §12.2. Basin-queue row 2 needs rewriting: there is no missing
seaway and no "highest-value fix" here.

**What is genuinely missing** is finer than a bin can carry. Akhmetiev's
sequence has the *Arctic* end of the system severing in the Early–Middle Eocene
while the *Turgai* stays open as a Tethyan gulf, then both closing at the E/O
boundary, then an Early Oligocene re-flooding from the south. The shipped map
has one state per bin and shows none of that. Also note the model's `lm`+`sm`
overlap at 29–20 renders the strait as land in the bin the Early Oligocene
Ashzheairyk re-flooding falls in — a third instance of the overlap-hides-the-sea
pattern, though the source's own `sm` there is the thing being hidden and no
edit is warranted without reading more than an abstract.

## 11. The Palaeozoic Siberian platform, intervals 402–380 and 380–359

**Measured.**

| Point | 402–380 | 380–359 | 359–338 |
|---|---|---|---|
| (100, 62) Tunguska | **`lm`+`sm` → renders land** | **`lm`+`sm` → renders land** | `sm` |
| (105, 60) Tunguska | **`lm`+`sm` → renders land** | **`lm`+`sm` → renders land** | `sm` |

**Measured**, the region (1° scan, 92…115 E, 56…70 N): at 402–380 every cell
from 56 N to 62 N is `lm`+`sm`, with `sm` alone appearing only north of 63 N;
at 380–359 the same; at **359–338 almost the whole box is `sm`**, with
`lm`+`sm` only in the far east. Across the whole Siberia+Turgai box the
overlap share is **39.0 %** at 402–380, **39.3 %** at 380–359 and **48.1 %** at
338–323 — the largest `lm`/`sm` overlap in any province or interval this memo
measured, and `lm`-alone is **0.0 %** at 402–380.

**Sourced, and this changes the expectation.** The Devonian of the central
Siberian Platform is **not an open epeiric sea**. Clarke 1985, *Petroleum
geology of East Siberia*, USGS Open-File Report 85-367,
[doi:10.3133/ofr85367](https://doi.org/10.3133/ofr85367), read from
<https://pubs.usgs.gov/of/1985/0367/report.pdf> (**Verbatim**): *"An
epicontinental sea continued to occupy the northwest part of the Siberian
platform during Early Devonian time (fig. 27). Most of the platform was emergent
and a source of detritus (Kontorovich and others, 1981, p. 215)."*; *"During the
Middle and Late Devonian, most of the platform continued to be emergent
(fig. 28)."*; and *"Evaporites are common, though discontinuous, in the Devonian
section (Fradkin and Menner, 1973, p. 70). In the central part of the Tunguska
basin, ten such horizons are present."* USGS Professional Paper 1824-U,
*Tunguska Basin Province*, [doi:10.3133/pp1824u](https://doi.org/10.3133/pp1824u)
(**Verbatim**): *"During the Devonian, the craton passed over a mantle plume
(hot spot), causing rifting and magmatism along the present-day eastern and
northern margins of the craton. Carbonate and evaporite rocks were deposited in
the rifts…"*, and *"Younger Paleozoic rocks are absent across most of the
Siberian craton because of nondeposition and erosion (Ulmishek, 2001a). The
southern and interior parts of the craton remain elevated."* The truly marine
Devonian is displaced to the Noril'sk region in the north-west and to the Vilyui
and Kyutyungda rift grabens in the east (PP 1824-V,
[doi:10.3133/pp1824v](https://doi.org/10.3133/pp1824v), **Verbatim**: *"In the
Vilyui Basin, the rift grabens contain Devonian and lower Carboniferous
evaporites, carbonates, and clastic rocks (Sokolov, 1989)."*). By contrast the
**Silurian** platform was marine — Clarke: *"The Silurian seaways in general are
a repeat of the Late Ordovician but somewhat more extensive"*, with Wenlock
limestone and dolomite in the central Tunguska and Podkamennaya Tunguska
basins — but the Silurian is outside Cao's 402 Ma floor.

**Inference, and it is the most awkward result in this memo.** What the browser
draws at (100, 62) and (105, 60) in the two Devonian bins — **land** — is what
the literature supports. But it is land for the wrong reason: the payload
carries an `sm` piece there that asserts a shallow sea the sources contradict,
and the only thing keeping it off the screen is draw order. **PASS on what
renders; the underlying claim is wrong.** And the bin where the overlap thins
out is where it shows: at **359–338 the map paints open shallow sea across the
whole central Tunguska**, an interval running from the late Famennian into the
Visean, for which Clarke has a seaway only *"in the Yenisey-Khatanga regional low
across the northern part of the platform"*. **That reading is a FAIL** —
and the 338–323 and 323–296 bins then step into the continental, coal-bearing
Tunguska Series (*"Coal beds 1 m thick or more are present in practically every
stratigraphic subdivision of this section"*, Clarke, **Verbatim**), which the
map does show as land at (100, 62) from 285–269 onward but as `lm`+`sm` at
338–323.

---

## 12. Three findings that cross all three provinces

These came out of the `neither` diagnosis and are not specific to any one
basin; §§1–11 refer back to all three.

### 12.1 The withheld mountain class is a global exposure, not a North Sea curiosity

The formation-checks memo found **one** instance, at the Horda Platform, of
Cao 2017 mountain ground rendering as blue "crust, depth unmapped", and said the
exposed area was unknown. This memo measures it in three continental boxes, on a
0.5° grid (7,881 / 9,393 / 7,991 cells), classifying each cell by the shipped
payload and then splitting the `neither` cells against the pinned archive.

| Province box | Interval | `lm` | `sm` | `lm`+`sm` | `neither` | of `neither`: `m`-only | source hole | off-crust |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| USA −125…−70 E, 25…60 N | 94–81 | 36.6 % | 35.8 % | 0.7 % | 27.0 % | **52.0 %** | 12.6 % | 35.3 % |
| USA | 58–49 | 60.9 % | 11.0 % | 0.1 % | 27.9 % | **55.9 %** | 10.8 % | 33.3 % |
| USA | 20–11 | 63.5 % | 9.8 % | 0.2 % | 26.5 % | **55.2 %** | 9.8 % | 35.0 % |
| South America −80…−34 E, −40…10 N | 20–11 | 39.3 % | 17.7 % | 0.2 % | 42.7 % | 30.0 % | 2.3 % | 67.7 % |
| South America | 49–37 | 50.0 % | 13.1 % | 0.3 % | 36.6 % | 20.6 % | 1.7 % | 77.7 % |
| Siberia+Turgai 55…120 E, 45…75 N | 49–37 | 59.9 % | 29.4 % | 0.3 % | 10.4 % | **97.8 %** | 2.2 % | 0.0 % |
| Siberia+Turgai | 94–81 | 63.2 % | 29.3 % | 0.1 % | 7.3 % | **95.1 %** | 4.9 % | 0.0 % |
| Siberia+Turgai | 269–248 | 53.9 % | 19.5 % | 1.5 % | 25.1 % | **94.8 %** | 0.2 % | 5.0 % |

Over all 24 intervals the `m`-only share of `neither` runs **0–56 %** in the USA
box, **0–30 %** in South America and **0–99.6 %** in Siberia; in Siberia it is
above 86 % in every interval from 323–296 Ma onward. In absolute terms the
worst rows are Siberia 269–248 (25.1 % × 94.8 % ≈ **24 % of the whole box**
drawn as submerged unmapped crust where Cao maps mountain — the Urals and the
Central Asian orogens) and the USA at 58–49 (27.9 % × 55.9 % ≈ **16 %** — the
Cordillera).

**Inference.** This settles the formation-checks memo's open question: the
exposure is large, global, and concentrated on exactly the orogens a user would
look for. Five further single-point instances were diagnosed individually and
each is a mountain record with no `lm`/`sm` cover: Turgai (65, 52) at 179–166
(`m` record 3793, plate 402); the West Siberian hole (60, 58) at 58–49 (`m`
2074, plate 302); the western WIS margin (−110, 40) at 20–11 (`m` 639, plate
101); interior NE Brazil (−40, −7) at 20–11 (`m` 454, plate 201); the eastern
West Siberian margin (80, 58) at 269–248 (`m` 4152, plate 401). Deciding
between shipping `m`, painting an `m`-only fallback tone, or documenting it is
still out of scope here — but it is no longer a question that can be deferred as
a curiosity.

### 12.2 Kazakhstania and West Siberia have no motion palette before 350 Ma, so their three oldest intervals are empty

The Turgai and southern West Siberian points read `neither` in **402–380,
380–359 and 359–338** even though the pinned archive does carry records there —
at (65, 52), 391 Ma, one `lm` record (6989, `PLATEID1` 402) and three `sm`
records (13149 plate 302, 13249 and 13252 plate 402).

The cause is recorded by the compiler's own validator and is not a defect: the
binding plates **465 and 468** each have exactly three motion-palette entries,
`plate-…-0-130`, `plate-…-130-210` and `plate-…-210-350`, so their oldest
coverage is **350 Ma**. `dev-docs/bench/results/palaeo-coastlines-validation.json`
carries the matching `explainedAbsences` row for the `turgai-strait` witness at
`402-380`: `paletteOldestAgeMa: 350.0`, window `[380.01, 402.0]`, reason
*"unposable: the binding plate has no gap-free motion palette coverage over the
interval, so the compiler dropped the piece rather than pose it"*.

The consequence is systematic: every Cao 2017 chart whose owner partition is
465 or 468 is dropped in the three intervals whose oldest bound exceeds 350 Ma.
The affected ground is also **not Cao 2024 continental crust at 391 Ma**, so on
screen it is ocean, not blue "depth unmapped" shelf — cause (c) and cause (d)
coincide there.

At (70, 62) the same three intervals read `neither` for a different and much
smaller reason: the nearest shipped `sm` edge is **0.46°** away (≈ 30 km,
nearest point 70.43 E, 61.83 N at both 402–380 and 359–338). That is inside the
source's own coastline tolerance and is a boundary case, not a missing sea. At
(65, 52) the nearest shipped edge in 402–380 is **2.10°** away (≈ 145 km,
nearest point 62.95 E, 52.45 N) — that one is the palette drop.

### 12.3 Interval 285–269 has almost no Cao 2017 coverage over North America

On the same 0.5° grid, restricted to cells that Cao 2024 maps as continental
crust (6,814 of 7,881 cells in the USA box), the share with **no Cao 2017
record of any class — `lm`, `sm` or `m`** is:

| Interval | mid-age | cells on crust with no class at all |
|---|---:|---:|
| 296–285 | 290.5 Ma | 860 (12.6 %) |
| **285–269** | **277.0 Ma** | **3,506 (51.5 %)** |
| 269–248 | 258.5 Ma | 582 (8.5 %) |

More than half the North American craton is unmapped in that one interval, and
the whole box reads `lm` 20.3 %, `sm` 22.0 %, `neither` 57.0 % — of which 78.1 %
is a genuine source hole. **Inference.** Every probe point on the craton
(−100, 45), (−90, 40), (−85, 37), (−90, 34) returns `neither` at 285–269 for
this reason, and no verdict about the Sakmarian–Kungurian craton can be drawn
from the shipped map. It is a source-coverage limitation to document, not
something an edit should paper over.

---

## 13. The whole series: nine inland seas through all 24 intervals

**Measured.** One representative point per province feature, every canonical
interval. `—` is `neither`; `lm+sm` renders as land.

| Interval (Ma) | WIS axis (−100, 45) | Mississippi Embayment (−90, 34) | Illinois Basin (−90, 40) | Pebas (−72, −4) | Paranense (−58, −33) | Sergipe–Alagoas (−37, −10) | West Siberian Sea (75, 60) | Turgai Strait (65, 52) | Tunguska (100, 62) |
|---|---|---|---|---|---|---|---|---|---|
| 402–380 | `lm+sm` | `sm` | `sm` | `sm` | `lm` | `lm` | `sm` | — | `lm+sm` |
| 380–359 | `sm` | `sm` | `sm` | `sm` | `lm` | `lm` | `sm` | — | `lm+sm` |
| 359–338 | `lm` | `sm` | `sm` | `lm+sm` | `lm` | `lm` | `sm` | — | `sm` |
| 338–323 | `sm` | `sm` | `sm` | `lm` | `lm` | `lm` | `lm+sm` | `sm` | `lm+sm` |
| 323–296 | `sm` | `sm` | `sm` | `lm` | `lm` | `lm` | `lm` | `lm` | `sm` |
| 296–285 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `sm` | `sm` |
| 285–269 | — | — | — | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` |
| 269–248 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` |
| 248–224 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` |
| 224–203 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` |
| 203–179 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` |
| 179–166 | `sm` | — | `lm` | `lm` | `lm` | `lm` | `lm+sm` | — | `lm` |
| 166–146 | `sm` | `lm` | `lm` | `lm` | `lm` | `lm` | `sm` | `lm` | `lm` |
| 146–135 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `sm` | `lm` | `lm` |
| 135–117 | `sm` | `lm` | `lm` | `lm` | `lm` | `lm` | `sm` | `lm` | `lm` |
| 117–94 | `sm` | `lm` | `lm` | `lm` | `lm` | `sm` | `sm` | `lm` | `lm` |
| 94–81 | `sm` | `lm` | `lm` | `lm` | `lm` | `lm` | `sm` | `lm` | `lm` |
| 81–58 | `sm` | `sm` | `lm` | `lm` | `sm` | `lm` | `sm` | `sm` | `lm` |
| 58–49 | `lm` | `sm` | `lm` | `lm` | `lm` | `lm` | `sm` | `sm` | `lm` |
| 49–37 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `sm` | `sm` | `lm` |
| 37–29 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` |
| 29–20 | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm` | `lm+sm` | `lm` |
| 20–11 | `lm` | `lm` | `lm` | `lm` | `sm` | `lm` | `lm` | `lm` | `lm` |
| 11–2 | `lm` | `lm` | `lm` | `lm` | `sm` | `sm` | `lm` | `lm` | `lm` |

**Inference.** Read down the columns and the shapes are recognisable: the WIS
opens at 135–117, peaks 117–94 and 94–81, and is gone by 58–49; the West
Siberian Sea runs unbroken from 166–146 to 49–37 and shuts in 37–29; the Turgai
opens in the three Palaeogene bins and shuts in the same 37–29; the Paranense
appears only in the two youngest bins; and Amazonia is land in every one of the
24. The 285–269 row is blank across every North American column for the
source-coverage reason in §12.3, and the Tunguska column's `lm+sm` in the two
Devonian bins is §11.

---

## 14. Expectation vs modelled

| # | Check | Expectation (source) | Modelled | Verdict |
|---|---|---|---|---|
| A1 | WIS 40 N transect, 117–94 / 94–81 / 81–58 | two-shored seaway; widest at the Cenomanian–Turonian peak; ~1 620 km wide central Utah → Minnesota [PP1561] | `sm` −110…−97 at 117–94, `sm` −110…−95 at 94–81, `sm` −107…−96 at 81–58; widths 1 420 / **1 428** / 1 074 km | **PASS** — right shape, right peak bin, 12 % narrow against a palaeogeographic width measured here in present-day longitudes |
| A2 | WIS −100 E at 35/40/45/50/55 N | marine across the mid-continent at peak | `sm` at 35–50 N in 94–81 and 81–58, `lm` at 55 N in 117–94 and 94–81 | **PASS** — the Boreal link does not run on this meridian |
| A3 | WIS Gulf ↔ Arctic continuity | joined in the Cenomanian, full boreal connection at peak transgression ~94.7 Ma [PP1561; cp-13-855-2017] | one connected body at **117–94 and 94–81**; broken at 135–117, 81–58, 58–49 | **PASS**, and a strong one: the connection exists in exactly the two peak bins |
| A4 | WIS Campanian–Maastrichtian retreat | Bearpaw regression; gone by end-Maastrichtian [PP1561] | narrows to 1 074 km at 81–58, northern link broken by a 56–62 N land belt, no sea at 58–49 | **PARTIAL by design** — the direction is right; a 23 Myr bin cannot show the withdrawal, and the Danian Cannonball is outside any bin |
| A5 | Sundance (−108, 44) and (−106, 46), 179–166 / 166–146 | Bajocian–Oxfordian, ~170–155 Ma, Wyoming and Montana flooded [pala.12278; PP1062] | `sm` at both points in both intervals; whole region `lm` at 146–135 | **PASS**, with a clean negative control |
| A6 | Sundance advance–retreat cycles | five invasions, three complete withdrawals [PP1062] | one marine state per bin | **PARTIAL by design** — same limitation as Brent |
| A7 | Mississippi Embayment (−90, 34), 94–81 | Tuscaloosa non-marine 93.9–85.7 Ma; McShan/Eutaw marine from ~85.7 Ma [PP448-B; Macrostrat/Dockery 2008] | `lm`; modelled shore at 33.0 N | **PARTIAL** — right for 8 of the bin's 13 Myr, wrong for the Santonian tail, and it is the *minimum*-transgression answer in a maximum-transgression bin |
| A8 | Mississippi Embayment (−90, 34), 81–58 | flooded *"to a point at least 20 miles north of Cairo, Ill."* = 37.0 N [PP448-B] | `sm`; modelled shore at **37.0 N** | **PASS** — within 0.3° of the cited limit |
| A9 | Craton (−90, 40) and (−85, 37), 402–380 … 338–323 | Devonian–Mississippian entirely marine at both columns [Macrostrat/Childs 1985] | `sm` at every interval (with `lm`+`sm` at (−85, 37) in 402–380) | **PASS** |
| A10 | Craton (−100, 38), Devonian–Mississippian | **no strata of that age preserved** on the Central Kansas Uplift | `lm`+`sm` then `sm` | **UNCONSTRAINED** — the map makes a claim the local record cannot test |
| A11 | Craton, Pennsylvanian 323–296 | cyclothems alternating marine and non-marine | one `sm` state; the evidence itself is formation-level "inferred marine" | **PARTIAL by design**, in the model *and* in the evidence |
| A12 | Craton, Early Permian 296–285 | Kansas marine Wolfcampian; Illinois and Kentucky no Permian preserved | `sm` at (−100, 38); `lm` at (−90, 40) and (−85, 37) | **PASS**, with the caveat that "not preserved" ≠ "emergent" |
| A13 | Craton, 285–269 | — | **`neither` at all three points** | **NOT TESTABLE** — 51.5 % of the North American crust in that bin has no Cao record of any class (§12.3) |
| B1 | Pebas (−72, −4), (−70, −2), (−75, −6), 20–11 and 11–2 | freshwater lake/wetland with *"only very limited marine influence, up to oligohaline"*; marine events of 0.2 and 0.4 Myr at 4.25 S, 69.93 W [Wesselingh 2002/2006; sciadv.1601693; science.1194585] | `lm` at all three points, both intervals; 0.01–0.02 % of the western-Amazonia box is sea | **PASS** — and it is the *opposite* of what basin-queue row 4 predicted; `sm` here would have asserted the contested reading |
| B2 | Pebas as a feature | a continental-scale **lake/wetland** [science.1194585, Fig. 1 legend] | no lacustrine class exists | **LIMITATION, not a defect** — the same gap as the Orcadian Lake, at continental scale |
| B3 | Paranense (−58, −33) and (−60, −30), 20–11 | TEP ~15 → ~10 Ma, maximum flooding 13–12 Ma, *"flooded the whole Pampa and Chaco Plains"* [Marengo 2006] | `sm` at both; connected Atlantic → Chaco embayment; land control at 29–20 | **PASS** |
| B4 | Paranense, 11–2 | sea withdrawn by ~10 Ma [Marengo 2006] | `sm` at both points throughout | **FAIL by over-extension** — a bin limitation, not a geometry error |
| B5 | Paranense (−62, −36) | Marengo's grid is N Buenos Aires + Salado + Colorado; this point is between and west of them | `lm` at 20–11 and 11–2 | **UNCONSTRAINED** |
| B6 | Paranense, 29–20 | TLP flooded the whole basin ~25 → ~21 Ma [Marengo 2006] | `lm` at all three points; no embayment anywhere | **FAIL** — the one South American mismatch that would justify a cited edit |
| B7 | Sergipe–Alagoas (−37, −10) and Araripe (−40, −7), 117–94 | Riachuelo open marine from the base of the Albian, drowned at the Cenomanian; Romualdo ingression Aptian, *"epicontinental shallow sea"* [1982-3908_2025_48_68263; s41598-020-72789-8] | `sm` at both | **PASS** |
| B8 | Same points, 135–117 | AMI 1–3 *"early Aptian/early late Aptian"*, short-lived [s41598-023-32967-w] | `lm` at both | **PARTIAL** — right for the continental and evaporitic phases, misses three short incursions that no bin could hold |
| B9 | 117–94 sea over the Parnaíba interior | Codó = hypersaline **lake**; Itapecuru fluvial, marine only at Alcântara in the north [rbp.2006.3.09; 0001-3765201920180730] | `sm` inland to −46 E at −2…−4 N | **PARTIAL** — missing class again, not missing geometry |
| B10 | Amazonas/Solimões (−60, −4) and Paraná (−52, −25), 402–380 and 380–359 | marine Pragian–Frasnian: Maecuru/Ererê trilobites, Barreirinha distal anoxic shelf, Ponta Grossa shoreface-to-offshore, São Domingos inner/outer shelf [bcnaturais.v10i1.492; 2026v12n1id32868; 26879/712] | `sm` at both points, both intervals; `lm` at 359–338 | **PASS**, with a clean control |
| C1 | West Siberian Sea (70, 62), (75, 60), (80, 58), (65, 58) at 94–81, 81–58, 58–49, 49–37 | seaway from the Late Cretaceous, resumed *"from the Middle Danian to the Lutetian"*, sea over >60 % of the plate in the Early Palaeogene [AJES 105/1; 10.1344/105.000000278] | `sm` at all **sixteen** point×interval cells | **PASS** |
| C2 | West Siberian Sea closure | marine sedimentation ends ~34.8 Ma; plate and Turgai drained at the E/O boundary [10.1080/01916121003629974 (Snippet); AJES 105/1] | `lm` at all four points at 37–29 | **PASS** — right event, right bin |
| C3 | West Siberian Sea, K/Pg | *"interrupted at the Cretaceous/Paleogene boundary"*, most of Eurasia above sea level [AJES 105/1] | 81–58 uniformly `sm` | **PARTIAL by design** — a 23 Myr maximum-transgression bin cannot show a regression in its middle |
| C4 | **Turgai (65, 52) and (63, 50) at 58–49 and 49–37** | strait open; *"connected to the Turanian Sea only through the Turgai Strait"*; closed at the E/O boundary [10.1344/105.000000278; AJES 105/1] | **`sm` at both points in both intervals**, plus 81–58; a *connected* marine corridor West Siberia ↔ Peri-Tethys at 81–58, 58–49 and 49–37; `lm` and disconnected at 37–29 | **PASS** — and it **refutes the plan's premise** that Turgai is land in every Cao interval |
| C5 | Turgai at 402–380 | — | `neither`; source has one `lm` and three `sm` records | **NOT A SOURCE HOLE** — plates 465/468 have no motion palette before 350 Ma, so the pieces were dropped and counted (§12.2) |
| C6 | Turgai at 29–20 | Early Oligocene re-flooding from the Northern Ustyurt through the Turgai [10.1344/105.000000278] | `lm`+`sm` → **renders land** | **FAIL**, third instance of overlap-hides-the-sea; no edit without more than an abstract |
| C7 | Siberian platform (100, 62) and (105, 60), 402–380 and 380–359 | **not an epeiric sea**: *"Most of the platform was emergent"*, *"During the Middle and Late Devonian, most of the platform continued to be emergent"*, evaporites and rift-confined marine [ofr85367; pp1824u; pp1824v] | `lm`+`sm` → renders land | **PASS on what renders**; the `sm` piece underneath asserts a sea the sources contradict, and only draw order hides it |
| C8 | Siberian platform, 359–338 | seaway only *"in the Yenisey-Khatanga regional low across the northern part of the platform"* [ofr85367] | `sm` across the whole central Tunguska | **FAIL** |
| C9 | (not asked) withheld mountain class | — | 0–56 % of `neither` in the USA box, 0–30 % in South America, **0–99.6 % in Siberia** | **FAIL, global scope** — §12.1 settles the formation-checks memo's open question |

---

## 15. Consequence

### 15.1 Permanent witnesses to add

Stable statements about the shipped payload that a future compile must not
silently break. These would go in `WITNESS_CLASSES` (points the source owns) in
`scripts/research/palaeo_coastlines_correction.py`, and every one of them is a
**class set**, not an `sm` membership test — §11 and §14/C6 are two more cases
that an `sm`-only test would miss. **Expected sets are what this memo measured**,
so adding them locks in today's behaviour; the three marked *after the fix* must
wait for the corresponding edit.

| Witness id | Position | Interval | Expected classes | Why it must not drift |
|---|---|---|---|---|
| `wis-axis-peak` | (−100, 45) | `94-81` | `["sm"]` | already in `WITNESS_CLASSES`; keep |
| `wis-west-shore` | (−110, 40) | `94-81` | `["sm"]` | the western shore at peak transgression; pairs with the next row to fix the width |
| `wis-east-shore` | (−94, 40) | `94-81` | `["lm"]` | the eastern shore 0.9° outside the modelled sea; the pair fixes the 1 428 km width to a 1° band |
| `wis-boreal-corridor` | (−117, 60) | `94-81` | `["sm"]` | the Mackenzie-corridor cell that makes Gulf ↔ Arctic one body; this is what a re-cut would silently break |
| `wis-boreal-closed` | (−117, 60) | `81-58` | `["lm"]` | the negative control for the same corridor after the Campanian break |
| `wis-absent` | (−100, 45) | `58-49` | `["lm"]` | the seaway is gone; guards against a bin shifting |
| `sundance-wyoming` | (−108, 44) | `166-146` | `["sm"]` | the Sundance/Curtis sea at its cited maximum |
| `sundance-morrison` | (−108, 44) | `146-135` | `["lm"]` | the Windy Hill → Morrison withdrawal; the negative control |
| `mississippi-embayment` | (−90, 34) | `81-58` | `["sm"]` | the modelled shore at 37.0 N is within 0.3° of PP 448-B's cited limit |
| `illinois-basin-kaskaskia` | (−90, 40) | `380-359` | `["sm"]` | the Kaskaskia epeiric sea over a column that is marine at every horizon |
| `pebas-land` | (−72, −4) | `20-11` | `["lm"]` | **the most important row in this table.** Western Amazonia must not become `sm`: that would assert the contested marine reading over Wesselingh and Jaramillo |
| `pebas-land-acre` | (−70, −2) | `11-2` | `["lm"]` | same, second point, second bin |
| `paranense-entre-rios` | (−58, −33) | `20-11` | `["sm"]` | the TEP transgression in its own bin |
| `paranense-pre-tep` | (−58, −33) | `29-20` | `["lm"]` **today**; `["sm"]` *after the fix* if the TLP edit lands | today's negative control **is also the B6 failure** — see 15.2 before adding this row |
| `sergipe-albian` | (−37, −10) | `117-94` | `["sm"]` | the Riachuelo open-marine platform |
| `araripe-albian` | (−40, −7) | `117-94` | `["sm"]` | the Romualdo ingression bin |
| `amazonas-devonian` | (−60, −4) | `402-380` | `["sm"]` | the Amazonas Devonian sea; the existing `amazonia` witness is 1° south at (−60, −5) and also measures `["sm"]` here, so this row extends rather than duplicates it |
| `west-siberian-eocene` | (75, 60) | `49-37` | `["sm"]` | the sea at its last marine bin |
| `west-siberian-closed` | (75, 60) | `37-29` | `["lm"]` | the E/O drainage; the negative control |
| **`turgai-open`** | **(65, 52)** | **`58-49`** | **`["sm"]`** | **the correction this memo exists for.** The existing `turgai-strait` witness samples only intervals in which the strait is dry and has been read as proving it is never open |
| `turgai-open-second` | (63, 50) | `49-37` | `["sm"]` | second point, second Palaeogene bin |
| `turgai-closed` | (65, 52) | `37-29` | `["lm"]` | the closure |
| `tunguska-devonian` | (100, 62) | `402-380` | `["lm","sm"]` | the overlap itself. Recording it as a class set is what makes §11 visible: if a future compile drops the `lm` piece, the Tunguska turns into a Devonian sea overnight |

**Inference on `WITNESS_INTERVALS`.** It currently holds four intervals —
`402-380`, `269-248`, `248-224`, `94-81` — and **none of the Palaeogene**. That
is precisely why the Turgai premise survived unchallenged: the strait is dry in
all four. The interval list needs `81-58`, `58-49`, `49-37`, `37-29`, `166-146`,
`146-135`, `117-94`, `20-11`, `11-2` and `29-20` to cover what this memo
measured. Extending it is cheap — the witness check is a `contains` test over
unions that are already decoded.

### 15.2 Mismatches that would need a cited basin edit

Only **one** of the failures in §14 is a genuine edit candidate.

| Mismatch | Interval | What the edit would have to do | Window, in words | Sources available today |
|---|---|---|---|---|
| **The Laguna Paiva transgression is absent from the Chaco–Paraná** | `29-20` | **add** `sm` over the Chaco–Paraná and northern Pampas, connected southward to the Salado Basin and the Atlantic shelf — *not* through the continental interior, which Marengo explicitly rules out as the migration route | a box covering the Argentine Mesopotamia and Chaco–Paraná plains from roughly the Paraná–Paraguay confluence south to the northern edge of the Salado Basin and east to the Uruguay River — about −64 to −56 E, −34 to −26 N, with the connection drawn to the south-east | Marengo 2006 (UBA thesis, no DOI, identity verified): TLP *"Approximately at 25 My (end of Chattian) started a big transgression that flooded the whole basin"*, regression *"At the end of the Aquitanian (c. 21 My)"*; *"both transgressions flooded from Salado Basin to the north"* and *"this migration was not possible trough the continental interior"* |

**Inference on that one edit.** It is defensible but thin: the whole constraint
rests on a single unpublished doctoral thesis with no DOI, whose borehole grid
is stated regionally rather than point by point, and whose own author could not
fix the end of the *younger* transgression. `spatialUncertaintyKm` would have to
be large — the thesis reports a basin-scale flooding, not a shoreline — and the
op's `evidence.status` would be `derived-from-published-source`. **It should not
be built until Hernández et al. 2005 or an equivalent is actually read**, because
the literature memo's own "10–5 Ma" figure for this system turned out to be
unverifiable and the same may be true of the 25–21 Ma window.

**Not edit candidates, and why.**

- **C6, the Turgai at 29–20.** The Early Oligocene re-flooding is real in
  Akhmetiev & Beniamovski's own words, and the model already carries an `sm`
  piece there — it is hidden by an `lm` overlap. Removing the `lm` would be a
  one-line op, but the only constraint retrieved is a single sentence about the
  "Ashzheairyk time" with no extent; there is nothing to bound a window with.
  Record it, do not build it.
- **C8, the Tunguska at 359–338.** The sources say the Famennian–Visean sea was
  confined to the Yenisey-Khatanga low in the north, so the edit would be a large
  *removal* of `sm` across the central platform — the biggest geometry change in
  this memo, justified by one 1985 USGS open-file report's figure references
  ("fig. 27", "fig. 28") that were not themselves seen. **Do not trace figures.**
  This needs a modern review of the Siberian Platform Palaeozoic first.
- **C7, the Tunguska Devonian.** Renders correctly by accident. An edit that
  removed the phantom `sm` would change nothing on screen and would risk
  removing the `lm` that is doing the work.
- **A7, the Mississippi Embayment at 94–81.** The evidence is a Macrostrat
  compilation, not a cited sentence, and the bin genuinely holds both states.
- **B4, the Paranense at 11–2**, **A4, the WIS Maastrichtian retreat**,
  **A6, the Sundance cycles**, **C3, the K/Pg interruption**, **B8, the Araripe
  incursions.** All five are the same thing: an event shorter than its bin, in a
  bin whose stated semantics keep the maximum. No geometry can express them.
  They belong in the map key's limitation line.
- **B2 and B9, the missing lacustrine class.** Pebas and the Codó lake are not
  `sm` and not a basin edit. The literature memo's own rule applies: *"A playa,
  sabkha, salt lake, or freshwater wetland is **not** `sm`."*

### 15.3 Records that need correcting

Three statements in tracked or planned records are wrong and were relied on.

1. **`palaeo-coastlines-literature.md`, basin-queue row 2.** "The plan measured
   **Turgai as land in every Cao interval**, so the single most-cited Palaeogene
   epicontinental seaway in Eurasia is absent from the globe" and "**Highest-value
   fix**". Measured here: the strait is an open, connected marine corridor in
   81–58, 58–49 and 49–37 and closes in 37–29. There is no missing seaway. The
   same row should strike **"Iakovleva 2011"**, which could not be verified to
   exist in Crossref or in the author's complete OpenAlex 2008–2013 record; the
   real Turgai dinocyst paper is Iakovleva, Brinkhuis & Cavagnetto 2001,
   [doi:10.1016/S0031-0182(01)00300-5](https://doi.org/10.1016/S0031-0182(01)00300-5).
2. **`palaeo-coastlines-literature.md`, basin-queue row 4.** "Cao's `sm` class
   would render a **marine** western Amazonia." It does not; it renders land, at
   every point and every Neogene interval, and that is the defensible class. The
   row's *conclusion* — that a lake/wetland label is what is needed — survives
   and is strengthened.
3. **Sloss 1963's DOI.** `10.1130/0016-7606(1963)74[93:SSOTCI]2.0.CO;2` returns
   404 from both doi.org and Crossref. The DOI that resolves is
   `10.1130/0016-7606(1963)74[93:SITCIO]2.0.CO;2`. Anywhere the first form is
   recorded, it should be replaced. Related: the Kaskaskia and Absaroka age
   spans are **not** sourced anywhere in this programme — the paper is paywalled
   and was not read — so no numeric span should be attributed to Sloss until it
   is. Two further bibliographic corrections: Kauffman & Caldwell 1993 is a
   chapter in a volume **edited by Caldwell & Kauffman**; and the Vinogradov
   atlas's publisher records name GUGK and the Ministry of Geology / Academy of
   Sciences, with **VSEGEI appearing in no verified record**.

### 15.4 The one thing that is not a basin question

§12.1 measured what the formation-checks memo could only flag: the withheld
mountain class covers **up to 56 % of the `neither` complement in North America,
30 % in South America and 99.6 % in Siberia**, which at 269–248 is about a
quarter of the whole Siberian box painted as submerged unmapped crust where Cao
maps the Urals and the Central Asian orogens. That is now a measured, global,
three-continent exposure, not a single Horda Platform anecdote. It needs its own
decision — ship `m`, paint an `m`-only fallback tone, or document it — and it
does not belong on any basin contract.

---

## Reproduction

```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
$PY <probe>   # imports palaeo_coastlines_compile read-only; decodes
              # public/data/reconstruction/cao-v2.4/palaeo-coastlines/{lm,sm}/*.ehpr,
              # unions each class per interval and tests shapely contains()
```

The probe scripts and their raw output were written to the session scratch
directory
`…/scratchpad/inland-seas/` — `probe.py`/`probe.json` (every named point × all
25 intervals, plus the digest listing), `probe2.py`/`probe2.txt` (the province
scans), `probe3.py`–`probe6.py` (the `neither` diagnosis, crust cover and
nearest-edge distances), `probe7.py`/`probe7-full.txt` (the 24-interval
province grid of §12.1), `probe8.py` (the Boreal-connection and craton scans),
`probe9.py` (connectivity), `probe10.py` (Llanos and the 81–58 barrier),
`probe11.py` (§12.3). That tier expires; every number this memo relies on is
quoted above.

## Appendix — sha256 of every payload read

All 50 payload digests equal the values the shipping class catalogs pin on
them, and all 52 files equal their blob at commit `192cc22`. Re-verified after
the last probe.

| File | Bytes | sha256 |
|---|---:|---|
| `palaeo-lm-11-2.ehpr` | 185978 | `9bbeb82f19ad82d06f4fd72dea1fc644ae7647bb83f0abf87c92a4dcdc33f6ac` |
| `palaeo-lm-117-94.ehpr` | 151330 | `edf0831d18511c2a79df7810c14e9c18b391fb61657ba26079fb05f540549101` |
| `palaeo-lm-135-117.ehpr` | 159602 | `8e560f03328c806169a49951d53cef7694c01d66c7b263fc278fce341dac591c` |
| `palaeo-lm-146-135.ehpr` | 153156 | `292de9daac3dc007fe77d5abc2c31e4142be6de8bae2ad3509d7722c2cd3dfb8` |
| `palaeo-lm-166-146.ehpr` | 158814 | `141a22021974a487630ad693b4c9eb6af922941780cc7802b9a16e4c366438f9` |
| `palaeo-lm-179-166.ehpr` | 133650 | `006d6d1d63760041bdd20e5cb63b37902590fd0d5c5bfac7f0ac4a2ef8ed00ae` |
| `palaeo-lm-20-11.ehpr` | 172812 | `174c1b598689bad99e60d50c5e4019139d3709410833052c30f719d974919217` |
| `palaeo-lm-203-179.ehpr` | 133140 | `70b15563bfacec700db374c9342261ffb58ae725db8f1d2feaa83c9b09e64292` |
| `palaeo-lm-224-203.ehpr` | 123934 | `58d22ca39ba9cb426bd87b393303ff14549f5e6f7ff63ad966f47e70d7b76ba8` |
| `palaeo-lm-248-224.ehpr` | 126206 | `671f9f8efb9a067dcc7f7299016a23f4f3b44a00680d32a0304524a97e8462f4` |
| `palaeo-lm-269-248.ehpr` | 116334 | `ba605472454cda073a87b3ba5e2f97fe6b542a0a9aec6a330f8891b5d21ca75c` |
| `palaeo-lm-285-269.ehpr` | 118968 | `44e826fc3b4039d4bbd3c097c965108c00b98a22e8d63f7a9679673b53b35361` |
| `palaeo-lm-29-20.ehpr` | 182164 | `fb23308755022f10d757d26222d732e48a960753c788c040a31298c51d980f94` |
| `palaeo-lm-296-285.ehpr` | 110900 | `80c3da115e4b92bf6ffb9478a6bed46d548849de155c6ee92cdbc3002a35eb2e` |
| `palaeo-lm-323-296.ehpr` | 85748 | `bc744fb9e5b0aa3f66331f62d23962746d43a30e3c776d573a33fd603a1f31f4` |
| `palaeo-lm-338-323.ehpr` | 111742 | `b2b2e7d48670dca7a166dc1676c09252a2cb7e6a25ed19b1db6c9930eeb11ec1` |
| `palaeo-lm-359-338.ehpr` | 107268 | `9e6b2c13e4441274362af5f6c308623273fb3d20427a0a7d38ad061e80ccead4` |
| `palaeo-lm-37-29.ehpr` | 188492 | `683326354e4c8c0cee1d34440887c234a9391830b274a4b49ecd134dab1325a9` |
| `palaeo-lm-380-359.ehpr` | 103114 | `a91182ecdb902c85f28d91f64c40622b88a738a7b401ef8d1e7042fb187924d9` |
| `palaeo-lm-402-380.ehpr` | 103886 | `1b09e045e50a542a94609562d78d21448a90178bb734a2f8a6a242f3c2a96169` |
| `palaeo-lm-49-37.ehpr` | 170324 | `abf1a35d7f8c19629f2eabd9008df6f97a588a1e6281ac1eaec99247f84c11c6` |
| `palaeo-lm-58-49.ehpr` | 163712 | `0048e6041fc233e229640f9b6a77331261d5fc17d80b23b604274046ebd0f855` |
| `palaeo-lm-81-58.ehpr` | 141600 | `f0e7fc3ed72beac5f348e018d410539a05fb0ad70bab1cbcbe1bc58328da847e` |
| `palaeo-lm-94-81.ehpr` | 137316 | `8018b1ab8c557a8341cdc082376bd79c0180f0a0f77b96d55747f391dd60608f` |
| `palaeo-lm-catalog.json` | 34442 | `edd8f46efe6eb70c551c5ca281dab3ba4b5ae1a2376e13e8bce72e4c91739956` |
| `palaeo-lm-lgm.ehpr` | 40746 | `e928401e12eaf52e6ad6952fa9b0140b0171bd3e927d76b3880030a0f2e06c2e` |
| `palaeo-sm-11-2.ehpr` | 173072 | `388db45068d2336505f1e10ad14de996b5a50b3227b4af368cfc51eec129b820` |
| `palaeo-sm-117-94.ehpr` | 146712 | `aa1204f5e849fee0448beacb29f9b6f2a169073b405ce03383f6cac73a7a27e4` |
| `palaeo-sm-135-117.ehpr` | 129988 | `d58df57ca23776a2c52ff8682ac19c956d9a9a6303ac8d54dc35e2da4c37df4c` |
| `palaeo-sm-146-135.ehpr` | 143130 | `c95a9113450f8eebc558afa75ebe1fa4a2a1061f8bba193121e91b06b960e272` |
| `palaeo-sm-166-146.ehpr` | 166616 | `5a7682847e31273e00a91bd652fcff3e4e9a7d5ab6a09ff239c7ab9b4b6d4f6c` |
| `palaeo-sm-179-166.ehpr` | 120482 | `1fcde2b72104891850d5d3811a91bdcaee4841430b8aa8e1b9223e51be5e4167` |
| `palaeo-sm-20-11.ehpr` | 174932 | `c00ada47eac3d744057f59f031b43dbc9c0ce091cd350d630c7425b11605555e` |
| `palaeo-sm-203-179.ehpr` | 132240 | `7cab00772d42f64c796f90755f3f4ae8ac865c054e46dcecc2c02f7ee1e2a0b7` |
| `palaeo-sm-224-203.ehpr` | 112784 | `54c0c21ae462d43a0ce9ad0ceaf8662fc87991df1652bad822e21eb7e2cffe43` |
| `palaeo-sm-248-224.ehpr` | 104520 | `987acea327a41931130bb7aa06df7eda63dd8c1f517b4966d02632e75f1f3f66` |
| `palaeo-sm-269-248.ehpr` | 106314 | `1b20c3a983b64eab1547db338a94cbf2aca5cf809867b232015133bc7fba7fcb` |
| `palaeo-sm-285-269.ehpr` | 80296 | `effa1e734d833a50196e7e684863a57e44be77e3a1486cc67fcd6ffa6793dff0` |
| `palaeo-sm-29-20.ehpr` | 188182 | `ac7d0c78831b238be4e61f8c8168e9d851bb635adcf5681cde590649eb20f335` |
| `palaeo-sm-296-285.ehpr` | 93430 | `21ec3e6182ca728fd10ecf2c7191fd0bb0c36146c4dcd008bdab37e91c39b10b` |
| `palaeo-sm-323-296.ehpr` | 125532 | `f38711ae9d576e87cc8d5f622058ed11f578275dc6dc465d7715b1d1b698a118` |
| `palaeo-sm-338-323.ehpr` | 136450 | `13970e23b2c6ac5380dc266f48cbfe4b176e3c93d2423fab657098ce263baece` |
| `palaeo-sm-359-338.ehpr` | 119584 | `fd476e748221dc749c22390183fac39c8829bbafb3efde04b8641be8f8c6dbd3` |
| `palaeo-sm-37-29.ehpr` | 193690 | `d46bee94dc89e200f233574664f132d86f7c5ea924d1a14d391b673ed551e374` |
| `palaeo-sm-380-359.ehpr` | 144338 | `b5c1b20c251fb645ab9d3de260e1ea9b6cff2e9fe3236ea70e8a7ef9b89e0d43` |
| `palaeo-sm-402-380.ehpr` | 152032 | `2d69a49563ccf5b30acdbf85530ba53df8b2d3107e0b0e33494a9e568e2aba78` |
| `palaeo-sm-49-37.ehpr` | 198842 | `3ba6c52857d503f61041b9cc3dad1277b300b1e01b74c7fc395f057395ccbc36` |
| `palaeo-sm-58-49.ehpr` | 178368 | `1aa116d25d1a63b9eca33e1120726e3732e34d36b9371ef4299ab240b58d737a` |
| `palaeo-sm-81-58.ehpr` | 181196 | `c0c6eb54f7da728b0f74bdcb5fab1ed27557ff793e3adefec668cb02c3a71535` |
| `palaeo-sm-94-81.ehpr` | 166896 | `cb985fe5083f4684223f5f377fb708d549707d1d3f83ba0e42a6bca216d76463` |
| `palaeo-sm-catalog.json` | 49491 | `96bd411765b43773a0b048907cd75fceefb771bfbe2b9987fd7629b872b93a21` |
| `palaeo-sm-lgm.ehpr` | 32 | `8547cf88b309c0a2120a0f5e0093f6eadc8a43cda013eb967657fefade4c038f` |
