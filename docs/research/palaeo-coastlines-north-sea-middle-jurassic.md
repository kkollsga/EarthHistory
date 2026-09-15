# Middle Jurassic land and sea around northern Britain

Research record for the `codex/palaeo-coastlines` program. Companion to
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say for the North Sea as a whole),
[palaeo-coastlines-north-sea-edits.md](palaeo-coastlines-north-sea-edits.md)
(what the `north-sea` contract already does) and
[palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md) (what the source
is). Compiled 2026-09-15; all web sources accessed 2026-09-15.

Scope: the Aalenian–Bathonian and the Callovian (~174.7–161.5 Ma) around the
Scottish Highlands and the Orcadian area, the Moray Firth margins, the Inner
Hebrides, the Shetland and East Shetland platforms, the Central North Sea dome,
and the Brent delta. These stages straddle two Cao et al. (2017) map intervals:
**12 (179–166 Ma, "middle Aalenian–middle Bathonian")** and **13 (166–146 Ma,
"late Bathonian–middle Tithonian")**.

This is a literature and measurement record, not an implementation claim. No
polygon in this repository is justified by this memo until a
`data/corrections/palaeo-coastlines/basins/<basin>.json` contract cites the
specific reference and passes the validator.

## Conventions

House style of the companion memos:

- **Verbatim** — quoted from text actually retrieved this session (open PDF,
  publisher HTML, an open-access government or agency report, or a
  publisher-deposited abstract read through Crossref).
- **Snippet** — a statement reported by a search-engine or fetch-tool summary of
  a page that could not be opened or verified word for word. Unverified.
- **Inference** — EarthHistory's own reading, arithmetic, choice of outline, or
  mapping onto the ICS scale. Always marked.
- **Measured** — a number computed this session from the pinned Cao et al.
  (2017) archive.
- Stage boundaries are ICS International Chronostratigraphic Chart v2024/12:
  Aalenian 174.7–170.9, Bajocian 170.9–168.2, Bathonian 168.2–165.3, Callovian
  165.3–161.5 Ma.

**Rights.** Every publication named here is **citation-only**. No map, figure,
plate, polygon, coordinate list or table from any of them is traced, digitised,
copied or redistributed by EarthHistory. The published work constrains an edit
the way a measurement constrains a model; the emitted geometry is our own,
derived from the Cao et al. (2017) rings. The BGS United Kingdom Offshore
Regional Reports [9][10] and the JNCC Geological Conservation Review volume [11]
are read as environment descriptions and were retrieved as public web text; the
GCR material carries the Open Government Licence 3.0, the BGS reports are NERC
copyright 1993. Neither is a build input.

**A timescale trap specific to this memo (Inference).** The numeric sequence
ages in Fjellanger et al. [4] — SB 177, FS 171, MFS 163.5, SB 161.5, SB 158.5 Ma
— are read off the Haq et al. (1987) cycle chart, which the paper says
explicitly for the 166 Ma boundary ("The sequence boundary is attributed an age
of 166 Ma by comparison to the cycle chart of Haq et al. (1987)", Verbatim).
They are **not** ICS ages and are several Myr younger than ICS v2024/12 for the
same stages: Fjellanger's "latest Bathonian" 158.5 Ma is ICS ~165.3 Ma. Map
these events onto the Cao intervals through their **stage names**, never through
their numbers, or events will land in the wrong bin.

---

## 0. What Cao 2017 actually draws here

**Measured**, this session, from the pinned archive
(`geography/earthbyte-paleogeography-gplates2.3.zip`,
`Paleogeography/Global_Cao_etal/`), by unioning every record of each class whose
`(TOAGE, FROMAGE]` lifecycle overlaps the interval and testing point
containment. All records in the window carry the canonical bins exactly
(`179.0/166.01` and `166.0/146.01`) on `PLATEID1` 315; there are no off-schedule
records here.

| Point (present-day °E, °N) | 179–166 Ma | 166–146 Ma |
|---|---|---|
| Orcadian / Caithness (−3.0, 58.8) | **mountain** | shallow marine |
| Orkney (−3.0, 59.1) | **mountain** | shallow marine |
| N Scottish Highlands (−4.5, 58.2) | **mountain** | shallow marine |
| C Scottish Highlands (−4.5, 57.0) | landmass | landmass + shallow marine |
| Skye / Inner Hebrides (−6.2, 57.4) | shallow marine | shallow marine |
| Sea of the Hebrides (−6.8, 57.0) | shallow marine | shallow marine |
| Shetland Isles (−1.3, 60.3) | shallow marine | landmass + shallow marine |
| East Shetland Platform (0.5, 61.0) | shallow marine | shallow marine |
| Inner Moray Firth (−3.5, 57.9) | landmass | shallow marine |
| Outer Moray Firth (−0.5, 57.9) | landmass | shallow marine |
| Central North Sea dome (1.5, 57.2) | landmass | shallow marine |
| North Viking Graben (2.0, 61.0) | shallow marine | shallow marine |
| Brent field (1.7, 61.1) | shallow marine | shallow marine |
| Unst Basin (~0.8, 60.9) | shallow marine | shallow marine |

**Measured.** The ice class `i` has no record in this window at either interval.
The mountain class `m` has 18 records overlapping 179–166 in the window and
**zero** overlapping 166–146.

**Two consequences, our Inference.**

1. At **179–166 Ma the north Scottish Highlands, Caithness and Orkney carry
   `m` and neither `lm` nor `sm`.** Cao's own lookup makes mountain terrestrial —
   "Terrestrial fossil paleoenvironments correspond to paleogeographic features
   of landmasses, mountains or ice sheets" [1, Table 2, Verbatim in the
   companion memo] — so the *source* says this ground was land. But the compiler
   ships `lm,sm` only (`shippedClasses`), so in the browser this ground has no
   class at all and reads as ocean. **This is an EarthHistory publication gap,
   not a Cao error.** Any claim that "Cao drowns the Scottish Highlands at
   179–166" would be false.
2. At **166–146 Ma Cao's mountain class disappears from the window entirely**
   and the whole of northern Scotland, Orkney, the Moray Firth, Skye and the Sea
   of the Hebrides become `sm`. Here Cao *is* at odds with the literature
   (§1.1), and the disagreement is a real one, not an artefact of what we ship.

---

## 1. Area by area

### 1.1 Scottish Highlands and the Orcadian area (~−3.0, 58.8)

| Statement | Timing | Status | Ref |
|---|---|---|---|
| "During the Jurassic Period, much of Scotland remained land; only the Inner Hebridean area and Moray Firth Basin were occupied by shallow seas to the margins of which the onshore outcrops are now restricted." | whole Jurassic | **Verbatim** | [11] |
| "Deposition in the Mid Jurassic Epoch was also affected by rejuvenation of the Scottish land area and associated reactivation of major faults, which was probably contemporaneous with volcanic activity, major doming and subsequent graben collapse in the North Sea" | Middle Jurassic | **Verbatim** | [11] |
| Post-rift infill of the northern North Sea is "the periodic out-building of some 9 major clastic wedges or megasequences, from the Norwegian and Scottish hinterlands" | mid-Triassic to late Jurassic | **Verbatim** (abstract) | [25] |
| Kimmeridgian Allt an Cuile Sandstone: "These sandstones … were derived from a delta area on the upthrown side of the fault which developed at a river mouth draining the Scottish landmass." | Kimmeridgian (~154.8–149.2) | **Verbatim** | [12] |
| The West Fair Isle Basin "extends from the east of Orkney to south-west of Shetland, and is bounded to the west by the Orkney–Shetland Platform" | structural, any age | **Verbatim** | [9] |

**Spatial uncertainty.** No source retrieved draws a Middle Jurassic Scottish
coastline. The only hard geographic anchors are (a) the onshore Jurassic outcrop
strip from Golspie to north of Helmsdale, about −4.05°E to −3.65°E, 57.96°N to
58.12°N, which is a *basin margin*, and (b) the Inner Hebridean outcrops on
Skye, Raasay, Eigg and Muck. Everything between them is unconstrained.
**Inference:** the defensible uncertainty on any emergent-Scotland outline here
is **±50–70 km**, not better; Cao's own coastline tolerance is ~30 km at best.

**What is not evidenced (Inference).** The point (−3.0, 58.8) sits in the
Pentland Firth between Caithness and Orkney. No retrieved source asserts its
Middle Jurassic status directly. It is inside the region [11] calls "much of
Scotland" and on the Orkney–Shetland Platform of [9], and both statements are
regional, not point constraints. Note also that "Orcadian Basin" is a
**Devonian** name — see the companion literature memo's Devonian rows — so
there is no Jurassic Orcadian basin, and the name must not migrate into a
Jurassic op.

### 1.2 Moray Firth basin margins

| Statement | Timing | Status | Ref |
|---|---|---|---|
| The onshore succession "is virtually complete apart from a gap in the Lower–Middle Jurassic where Toarcian and Bajocian strata are not represented … in view of the known offshore stratigraphy it is likely to be due to unconformity caused by uplift of the North Sea Dome and associated Jurassic volcanic activity. (Underhill and Partington, 1993; Underhill, 1998)" | Toarcian–Bajocian, ~184.2–168.2 | **Verbatim** | [12] |
| "The Bathonian Doll Member of the succeeding Brora Coal Formation … is of fluvial origin with channel sandstones and alluvial plain mudstones (Hurst, 1981). Siderite and abundant kaolinite are present as well as a sparse fauna of freshwater ostracods" | Bathonian | **Verbatim** | [12] |
| "The Inverbrora Member of the Brora Coal Formation is considered to be of lagoonal origin"; "marine influence is extensive with high abundance/low diversity dinocyst assemblages" | Bathonian–earliest Callovian | **Verbatim** | [12] |
| "The lagoonal area … probably extended parallel to the Helmsdale Fault system and was periodically invaded by the sea from the NE in the region of the Wick Fault, with the ocean connection through the Viking Graben. An alternative explanation is that the sea entered the Moray Firth through the Great Glen from the west coast." | Bathonian | **Verbatim** (and the source itself gives the alternative) | [12] |
| "The lagoonal area was cut off from the sea at this time and swamp conditions, probably similar to a floating bog, spread over the lagoon area"; "marine microflora is absent" | Brora Coal, latest Bathonian | **Verbatim** | [12] |
| "the Brora Roof Bed, a bioturbated shallow marine transgressive sandstone … This bed marks the main Callovian marine transgression in the area (Sykes, 1975a)." | Callovian | **Verbatim** | [12] |
| "the Inner Moray Firth (IMF) and Outer Moray Firth (OMF) were separated by a topographic high centred around the Ross Granite area (UKCS blocks 13/28 and 13/29) from the Bajocian until the latest mid-Oxfordian" | Bajocian–mid-Oxfordian | **Verbatim** (abstract) | [13] |
| "the first marine influx into the Buchan Trough area of the OMF was Callovian in age (significantly earlier than previous models) and probably marked connection with the South Viking and/or North Central Grabens" | Callovian | **Verbatim** (abstract) | [13] |
| "within the rift itself any relief associated with a Mid-Jurassic doming episode, which created 'the Mid-Cimmerian Unconformity', had effectively diminished by this time [latest mid-Oxfordian]" | Bajocian → mid-Oxfordian | **Verbatim** (abstract) | [13] |

**Reading (Inference).** Through Cao interval 12 the Moray Firth arm is
**emergent to non-marine**: the Toarcian–Bajocian is missing under the dome
unconformity, the Bathonian is fluvial then brackish-lagoonal, and the two
sub-basins are separated by an intrabasinal high. Cao's `lm` at (−3.5, 57.9) and
(−0.5, 57.9) for 179–166 therefore has the right sign. Through interval 13 the
arm **floods**: the Callovian transgression at Brora and in the Buchan Trough,
then continuous marine deposition. Cao's `sm` at 166–146 also has the right
sign. **No Moray Firth edit is indicated at either interval.** A brackish lagoon
is neither `lm` nor `sm`, exactly as with the Orcadian Lake and the Pebas
system; it is a limitation to record, not an edit.

### 1.3 Hebrides and Inner Hebrides basins

| Statement | Timing | Status | Ref |
|---|---|---|---|
| Bearreraig Sandstone Formation "(Late Toarcian-Bajocian), on the islands of Skye and Raasay … forms part of the marine infill of one of the Hebridean rift basins"; "up to 250 m thick in south Skye"; "sedimentation occurred largely at the mouth of a tidal-dominated delta which evolved into a macrotidal estuary during each transgressive phase" | late Toarcian–Bajocian | **Verbatim** (abstract) | [14] |
| "during the early stage of deposition of the Bearreraig Formation, tidal-dominated sedimentation occurred separately in the north Skye/Raasay and in the south Skye sub-basins. During a late stage of deposition, the sub-basins merged" | Toarcian–Bajocian | **Verbatim** (abstract) | [14] |
| "The Garantiana Clay Member, which underlies the non-marine and non-ammonitiferous Great Estuarine Group, belongs to the lower part of the Upper Bajocian Garantiana Zone. The next stratum above yielding ammonites is the Lower Callovian Belemnite Sand–Carn Mor Sandstone Member of the Staffin Bay Formation. The intervening beds of the Great Estuarine Group are therefore considered, on indirect evidence, to be Bathonian in age." | late Bajocian–Bathonian | **Verbatim** | [11] |
| The Great Estuarine Group is "the thickest and most varied development of its paralic facies" in the British Jurassic | Bathonian | **Verbatim** | [11] |
| The Great Estuarine Group represents "alternating freshwater and marine-influenced delta and lagoonal systems in a paralic sequence"; Prince Charles's Point was "an ephemeral, low salinity, closed lagoonal system within a vast river delta alternating between subaerial and submerged states"; the region was "a series of low-lying small landmasses and shallow seas" | late Bajocian–Bathonian, ~170–166 Ma on the paper's own scale | **Snippet** (fetch-tool summary of the open-access paper; PDF not read line by line) | [20] |
| Great Estuarine Group deposits characterise "lagoons, lagoonal deltas and mudflats, which varied from freshwater through brackish to marine"; the Kilmaluag Formation indicates "deposition in low-salinity environments"; the Skudiburgh Formation is of "alluvial origin; floodplain, channel and overbank deposits" during a "late Bathonian regression" | Bathonian | **Snippet** (fetch-tool summary) | [22] |
| "The facies and faunas of the Callovian succession at Staffin Bay indicate a progressive environmental change from restricted to open marine conditions. The Upper Ostrea Member was probably deposited in a coastal lagoon that was then transgressed …" | Callovian | **Verbatim** | [11] |
| "Farther south, Lower Jurassic marine shales occur in The Minch, but Middle and Upper Jurassic sediments have been proved only in shallow boreholes on the Hebrides Shelf." | Middle–Upper Jurassic | **Verbatim** | [10] |

**Reading (Inference).** The Inner Hebrides sequence through the two Cao
intervals is: **marine / tide-dominated deltaic** (Bearreraig, late
Toarcian–late Bajocian) → **paralic, brackish-lagoonal with subaerial phases**
(Great Estuarine Group, Bathonian, ending in an alluvial late-Bathonian
regression) → **marine again** (Staffin Bay, Callovian onward). Cao's `sm` at
Skye and the Sea of the Hebrides is the right sign at both intervals as a
maximum-transgression envelope, and the Bathonian brackish-lagoon phase is
precisely the state Cao has no class for.

**Hard constraint on any edit (Measured).** The `north-sea` contract window is
`[-5.0, 53.0, 9.0, 62.5]`. Skye (−6.2, 57.4) and the Sea of the Hebrides
(−6.8, 57.0) are **outside it**. No Hebridean geometry can be emitted by this
contract without widening the window, and widening a window to reach ground the
contract was not scoped for is a contract change, not an op.

### 1.4 Shetland Platform

| Statement | Timing | Status | Ref |
|---|---|---|---|
| "The East and North Shetland platforms and Fladen Ground Spur are composed of Old Red Sandstone and Caledonian basement, overlain in the east by an eastward-thickening Tertiary sequence. Permian, Triassic and Jurassic strata are generally absent across the East Shetland Platform" | structural summary | **Verbatim** | [9] |
| "Jurassic strata are absent over most of the East Shetland Platform, but are preserved within the downfaulted Unst Basin." | Jurassic | **Verbatim** | [9] |
| In the Unst Basin, "the Brent Group (140 m), Humber Group (685 m) and Cromer Knoll Group (300 m) are well represented"; the basin holds "up to about 800 m of Jurassic sediment" | Middle–Late Jurassic | **Snippet** (search summary of [19]; the paper was not opened) | [19] |
| "Middle Jurassic deposits are found in the Unst Basin (Fig. 1) (Johns & Andrews, 1985), indicating a wider deltaic front than is seen today." | Aalenian–Bathonian | **Verbatim** (open PDF) | [4] |
| The Shetland Platform "through subsidence/uplift and relative sea-level change periodically fluctuated in size and relief, with some remaining partly emergent throughout the Jurassic period" | Jurassic | **Snippet** (search-engine paraphrase of [28]; the chapter is paywalled and was **not** opened — do not attribute this wording to Husmo et al.) | [28] |
| The Middle Jurassic west of Shetland "generally consists of a thin, sandstone-dominated succession, with local highs acting as the source areas" | Middle Jurassic | **Verbatim** | [10] |

**Reading (Inference).** The Shetland high and the platform around it were
**emergent for most of the Middle Jurassic and acted as a source area**, but
"emergent platform" is not "emergent everywhere": the Unst Basin, a downfaulted
basin north-east of Shetland between the North Shetland Platform and the East
Shetland Basin, preserves a Brent Group succession. An op that paints the whole
platform as land through interval 12 over-claims by the width of that basin.
The Unst Basin's position used in §3 below (~0.7–1.5°E, 60.7–61.3°N) is
**Inference** read off the named structural relationships in [9]; no figure was
opened and no coordinate was taken from any publication.

### 1.5 East Shetland Platform

| Statement | Timing | Status | Ref |
|---|---|---|---|
| "Brent and Vestland group sediments are recorded in the East Shetland Basin, the North Viking Graben and over parts of the Horda Platform (i.e. from 59°N to 61°30'N). Their original distribution on the East Shetland Platform is not clear, although the depositional thinning from the basin centre towards the East Shetland Platform may indicate **temporary** emergent conditions in the western part of the basin." | Aalenian–Bathonian | **Verbatim** (open PDF; emphasis ours) | [4] |
| "In the Bruce Embayment a fluvial system sourced from the East Shetland Platform caused a braided delta plain to prograde from west to east, being fluvially dominated in its proximal part and tidally influenced in more distal areas" | Bathonian (their SB 161.5 Ma highstand) | **Verbatim** | [4] |
| "a tectonic phase, where sediments were eroded on the Shetland Platform and deposited in great thickness on the down-faulted margins"; "relative to the uplifted and eroded Shetland Platform"; "a (regional?) uplift which caused severe erosion of the Shetland Platform" | Middle–late Bathonian | **Verbatim** | [4] |
| "The Broom Formation sediments were probably derived by erosion of the East Shetland Platform area (Morton, 1985; Richards, 1990b)" | Aalenian | **Verbatim** | [9] |
| "Permian, Triassic and Jurassic strata are generally absent across the East Shetland Platform" | Jurassic | **Verbatim** | [9] |

**Reading (Inference).** The East Shetland Platform as an **emergent,
eroding source area through interval 12 is well supported**, and the
strongest support is [9], which the current contract does not cite. But
[4]'s own wording is weaker than "emergent": "not clear", "may indicate
**temporary** emergent conditions". The honest statement is "emergent for
much of the interval and eroding, with its original depositional limit
unknown" — with the Unst Basin as a named exception.

### 1.6 Central North Sea dome (Underhill & Partington 1993)

All **Verbatim** from the publisher-deposited abstract of [3]:

- "the main event's correlative conformity falls in the Aalenian near the break
  between the *opalinum* and *murchisonae* ammonite biochronozones"
- "systematic truncation of stratigraphy occurred throughout the North Sea
  domain (the oldest stratigraphies subcrop in areas adjacent to the triple
  junction) with subsequent progressive onlap towards the same area"
- "regional (Toarcian–Aalenian) domal uplift, resulting from the impingement of
  a broad-based (**> 1250 km diameter**), transient plume head or 'blob' at the
  base of the lithosphere"
- "Progressive pre-rift, Aalenian–early Bathonian marine onlap records
  differential subsidence in response to the initial deflation of the dome
  **while central regions may have continued to rise**"
- "Subsequent subsidence post-dated Bathonian–Callovian volcanism but still
  pre-dated the timing of most significant (Kimmeridgian–Volgian) rifting"

Corroborating, **Verbatim** from other sources:

- "The Mid-Cimmerian doming in the triple junction between the Viking Graben,
  Central Graben and Moray Firth Graben in Late Toarcian times resulted in a
  dramatic sea-level fall in the North Sea area (Ziegler 1982; Underhill &
  Partington 1993), associated with uplift and erosion of the eastern and
  western basin margins of the Viking Graben." [4]
- "The first rift-related sequence (J20) records deposition during pre-rift
  thermal uplift over much of NW Europe. During J20 a low-angle, weakly erosive,
  pre-rift unconformity (the 'Mid-Cimmerian' unconformity) developed over much of
  the North Sea Basin. The domal uplift was centred on the Central Graben
  volcanic province in the Central North Sea." [26]
- The Moray Firth onshore Toarcian–Bajocian gap "is likely to be due to
  unconformity caused by uplift of the North Sea Dome" [12]

**Spatial uncertainty.** The only number is the **>1250 km swell diameter**,
which is a plume-head dimension, not an emergent-land outline. The emergent area
is smaller than the swell and is nowhere given a boundary. **Inference:** any
outline of "dome land" carries uncertainty of order **100 km**, and the
contract's existing 60 km declaration for the delta-plain ops is, if anything,
optimistic for the dome-derived part of the rationale.

**Measured.** Cao already draws the Central North Sea, the Inner Moray Firth and
the Outer Moray Firth as `lm` at 179–166, so **no dome edit is needed**, which
is what the existing edits memo says. That still holds.

### 1.7 Brent delta: provenance and northward extent

**Extent. Verbatim** from [4] (open PDF):

- "Following the regional flooding event at 170 Ma the Brent deltaic system
  prograded rapidly northwards from approximately **60°N to 61°30'N** during the
  Early Bajocian, forming a highstand systems tract"
- "The aggrading interval of sequence 3 extends slightly seaward of sequence 2,
  and represents the **maximum progradation of the Brent delta as far as
  61°30'N**"
- "The Early Bathonian delta retreat took place in retrogressive pulses …
  forming an estuary in the Southern Viking Graben and gradually drowning the
  deltaic system in the Northern Viking Graben"
- "A new regressive-transgressive phase has been recognized above the flooding
  surface **south of approximately 60°30'N** … 'the Vestland deltaic system'";
  abstract: the Vestland progradation "took place from the Central Viking Graben
  to ca. 60°30'N"
- "the term 'Brent Group' has been restricted to areas north of about 60°N"
- "During the Aalenian a fluvial system crossed the Horda Platform bringing
  coarse-grained, immature sediments from the emerged basin flanks to the
  shallow sea in the Northern Viking Graben"
- "Middle Jurassic deposits are found in the Unst Basin …, indicating a wider
  deltaic front than is seen today"

**Verbatim** from [5] (abstract): "Fan deltaic sediments built out towards the
west and northwest and backfilled the previously emergent areas during the
subsequent relative sea-level rise"; "The progradation of the Brent Delta
(Rannoch, Etive and lower Ness Formations) took place in Late Aalenian to Early
Bajocian."

**Verbatim** from [6] (abstract): five sequences, **J22 (Aalenian), J24 (Early
Bajocian), J26 (Early–Late Bajocian), J32 (latest Bajocian–Late Bathonian), J34
(latest Bathonian–Middle Callovian)**, in two tectono-stratigraphic units,
"pre-rift thermal uplift (J20) and the onset of rifting (J30)".

**Provenance — and this is where the sources fight.**

- [7], **Verbatim** (abstract): "Geochemical studies of detrital garnet
  assemblages have shown a great complexity in provenance that **argues against a
  dominant sediment supply northward from an uplifted central North Sea dome**.
  Much of the sediment was fed laterally, particularly in the Broom and Oseberg
  Formations. The Rannoch, Etive and Tarbert sequences are dominated by similar
  suites to those in the Oseberg Formation, implying that most of the shoreface
  and barrier sands were **transported longshore from the east**. Ness mineralogy
  is extremely complex. It has a broadly southerly source (possibilities
  including the **southern Shetland Platform and Horda Platform**). Close to the
  western margin of the basin there are strong **northern Shetland Platform**
  influences. The lateral and stratigraphic variation in Ness assemblages argues
  for deposition by several small-scale river systems rather than one single
  major river."
- [8], **Verbatim** (abstract): "There are two main published models to explain
  the regional evolution of the Brent Group, and this is possibly the most active
  of the controversies in Brent Group geology. The first model considers the
  system as a northwards prograding delta with a southerly source and a
  concentric arrangement of facies belts across the basin. The second model
  envisages a dominantly transverse sediment supply to the basin, with subsequent
  localized northwards progradation within the basin."
- [9], **Verbatim**: "A number of authors (Morton and Humphreys, 1983; Leeder,
  1983; Morton, 1985; Hamilton et al., 1987) have disputed a southerly origin for
  the bulk of the regressive sediments on the basis of their mineralogy,
  preferring a source on the adjacent platforms."
- [21], **Snippet** (fetch-tool summary of the open-access paper; PDF not read
  line by line): "sediment was routed consistently to the 'Brent Delta' from
  three main source areas at the margins of the proto-Viking Graben: the Shetland
  Platform, Norwegian Landmass, and Mid-North Sea High".

**Reading (Inference).** The Brent delta's **existence, timing and northward
extent** are not contested. Its **dominant source** is. The dome's *emergence*
is well supported [3][12][26]; the dome as the *dominant sediment source* is
explicitly rejected by [7] and listed as a live two-model controversy by [8] and
[9]. A contract that cites the dome as the reason a delta plain is land is
citing an uncontested fact (emergence); a contract that says the delta was fed
from the dome would be taking a side.

**Two latitude figures that are easy to confuse (Inference).**
**61°30'N is the Brent delta's maximum progradation**; **60°30'N is the northern
limit of the later Vestland system.** They are different systems at different
times inside the same Cao bin. And 61°30'N is a *delta front* — a shoreline —
not the northern edge of subaerial delta plain, which lay some distance south of
it. Neither figure is a palaeolatitude: [20] places a northern-Skye locality at
"~42.8°N" in the Bathonian (**Snippet**), so present-day 61°30'N was nowhere near
61°N then. The contract's ops are authored in present-day coordinates and
reconstructed by the compiler, which is correct — but the memo text must never
let a published present-day latitude read as a palaeolatitude.

---

## 2. Where the sources disagree

| Question | Position A | Position B | What a contract must do |
|---|---|---|---|
| Dominant Brent provenance | northward from the uplifted Central North Sea dome, concentric facies belts [8, model 1] | transverse supply from the Shetland and Horda platforms; garnet data "argue against" the dome [7][8, model 2][9] | Cite the dome only for **emergence**, never for supply; if supply is mentioned, name both models |
| Brent Group age span | "bulk … probably of Aalenian to earliest Bajocian age, although deposition of the upper part may have extended into the Bathonian" [9] | "late Toarcian to early Bathonian (Ryseth, 1989), or entirely post-Aalenian (Helland-Hansen et al., 1989)" [9, reporting others]; J22–J34 Aalenian–Middle Callovian [6] | The whole disputed range sits inside intervals 12–13; no edit turns on it. Record it as a limitation |
| Was the East Shetland Platform emergent? | "Permian, Triassic and Jurassic strata are generally absent" [9] | "original distribution … is not clear"; only "**temporary** emergent conditions"; Unst Basin Brent Group preserved [4][19] | Draw land, declare the Unst Basin exception, use [9] as the primary support |
| How the Moray Firth flooded | dome deflation drove it [3] | "it was not the sole causal control on rift-arm stratigraphy … both short- and long-term regional sea-level changes superimposed upon a complex evolving rift topography" [13] | No edit depends on the mechanism; do not attribute the flooding to the dome alone |
| Where the Bathonian Moray Firth lagoon connected to the sea | "from the NE in the region of the Wick Fault, with the ocean connection through the Viking Graben" | "the sea entered the Moray Firth through the Great Glen from the west coast" | Both are in the same source [12]; do not draw either seaway |

---

## 3. Consequence for the basin edit contract

Binding on `data/corrections/palaeo-coastlines/basins/north-sea.json`, and
consistent with the CLAUDE.md science boundary and §4 of the companion
literature memo.

### 3.1 Which of the current 179–166 ops are supported

| Op | Verdict | Change recommended |
|---|---|---|
| `north-sea-179-166-east-shetland-platform-remove-shallow` | **Supported** | Add [9] to `references[]` — "Permian, Triassic and Jurassic strata are generally absent across the East Shetland Platform" is the strongest retrieved support and the contract does not yet cite it |
| `north-sea-179-166-east-shetland-platform-add-land` | **Supported, with one over-reach** | Same reference addition. The polygon's north-east corner runs along 0.8°E from 60.9°N to 62.4°N, which reaches the ground where the **Unst Basin** preserves a Brent Group succession [4][19]. Either pull the eastern edge west of ~0.6°E between 60.7°N and 61.3°N, or record the Unst Basin explicitly in `rationale` as known preserved Middle Jurassic inside the outline. Do not leave it silent |
| `north-sea-179-166-brent-delta-plain-remove-shallow` | **Partially supported** | The 60.5°N northern cap is the **Vestland** limit, not the Brent maximum. The rationale currently says the op renders the delta "at its maximum extent, bounded north by that published latitude" — that conflates two systems. Rewrite to say it renders the **Vestland (later) state**, and record 61°30'N as the Brent delta front that the geometry deliberately does not reach |
| `north-sea-179-166-brent-delta-plain-add-land` | **Partially supported** | Same rewrite. Also: its `references[]` names `underhill-partington-1993-dome` for the emergent Central North Sea, which is fine, but `claimOrInference` must not imply the dome sourced the delta — [7] explicitly argues against that. Add a sentence naming the two-model controversy [7][8] |

**Not recommended:** extending the delta-plain polygon north to 61°30'N. That
latitude is a delta *front*; the subaerial plain lay south of it by an unstated
distance, and drawing land to the front would assert emergence the sources do
not give.

**Also confirmed (Measured):** Cao already draws the Central North Sea dome, the
Inner Moray Firth and the Outer Moray Firth as `lm` at 179–166, so the existing
memo's "the Central North Sea dome needed no edit" is correct and stays.

### 3.2 Is an `add-land` op for the Scottish / Orcadian landmass defensible?

**At 179–166 (interval 12): defensible, but its justification is
presentational, not corrective — and there is a cheaper fix.**

**Measured:** Cao carries the **mountain** class over (−3.0, 58.8), (−3.0, 59.1)
and (−4.5, 58.2) at 179–166 and no `lm`/`sm` there. Cao's own lookup makes
mountain terrestrial. The ground reads as ocean in the browser only because the
compiler ships `lm,sm`. So:

- The **first-choice fix is to ship the mountain class** (or to derive land from
  it) rather than to author a cited land polygon over ground the source already
  calls terrestrial. That is a compiler/packaging change with a measurable
  payload cost, not a basin edit, and it fixes every mountain-shadowed region at
  once rather than only this one.
- If an `add-land` op is used instead, its `rationale` must say plainly that it
  **restates Cao's own mountain classification in a shipped class**, with the
  literature as an independent check, and `claimOrInference` must not describe it
  as a correction to Cao. Presenting it as a literature correction would be
  false, and the map key would then carry a false disagreement.

**At 166–146 (interval 13): yes, and here it is a genuine, well-supported
literature correction.**

**Measured:** at 166–146 the mountain class has **zero** records in the window;
Cao classes northern Scotland, Caithness, Orkney, the Moray Firth, Skye and the
Sea of the Hebrides as `sm`, with `lm` only over the central Highlands
(−4.5, 57.0) and the Shetland Isles (−1.3, 60.3). Against that, [11] states
"During the Jurassic Period, much of Scotland remained land", [12] has a
Kimmeridgian river "draining the Scottish landmass", and [25] has post-rift
clastic wedges shed "from the Norwegian and Scottish hinterlands". A 20 Myr
maximum-transgression bin that drowns the Scottish Highlands from the late
Bathonian to the middle Tithonian is at odds with all three.

### 3.3 Recommended extent, in words

A single emergent **Scottish mainland and Orkney–Shetland Platform block**, NE-
trending, five to seven vertices, all coordinates present-day and approximate:

- **West:** the contract window's own edge at **−5.0°E**. Everything west of that
  — the western Highlands, the Minch, Skye, the Sea of the Hebrides — is outside
  this contract and must not be drawn by it.
- **South-east:** a line running from about **(−4.15°E, 57.85°N)**, just west of
  the Golspie–Brora–Helmsdale Jurassic outcrop strip (≈ −4.05° to −3.65°E,
  57.96–58.12°N), north-east past Wick to about **(−3.05°E, 58.30°N)** and
  **(−2.55°E, 58.75°N)**. This keeps the whole onshore Jurassic outcrop and the
  entire Inner Moray Firth basin **outside** the land polygon, which the Brora
  succession and [13] require.
- **North:** about **59.3–59.4°N**, at the northern tip of Orkney. Do not run the
  polygon further north: the Middle–Upper Jurassic north and west of Orkney is
  known only from scattered wells and shallow boreholes [10], and the West Fair
  Isle Basin lies immediately east of Orkney [9].
- **South:** about **57.8–58.0°N** on the western edge, leaving the central
  Highlands where Cao already carries `lm`.

Approximate bounding box: **−5.0°E … −2.45°E, 57.85°N … 59.40°N**.

- `spatialUncertaintyKilometres`: **60**. Justification: no source draws a
  coastline here; the constraint is a regional statement ("much of Scotland
  remained land") plus the position of the onshore outcrops, and Cao's own
  tolerance is ~30 km at best and ~500 km at its PBDB search radius. 60 km is the
  uncertainty of the *constraint*, not the vertex spacing.
- Emit the usual **remove-shallow + add-land pair**, since at 166–146 Cao carries
  `sm` over this ground and a bare `add-land` would leave both classes stacked.
- At 179–166, if the op is authored at all, the same outline works and needs no
  `remove-shallow` companion: **Measured**, there is no `sm` record over this
  ground at that interval.
- Contract bookkeeping: `intervals[]` currently reads
  `["402-380", "269-248", "179-166", "58-49", "49-37"]`. Adding a 166–146 op
  requires adding `"166-146"` to that list; the compiler's contiguity rule binds
  each op's own `intervalIds`, not the contract's union, so a single-interval op
  is fine.

### 3.4 References to attach

For a **179–166** Scottish/Orcadian op (if authored):
`cox-sumbler-2002-gcr26-middle-jurassic-scotland` [11],
`johnson-1993-bgs-northern-north-sea` [9],
`underhill-partington-1993-dome` [3],
`trewin-2009-east-sutherland-caithness` [12].

For a **166–146** Scottish/Orcadian op:
`cox-sumbler-2002-gcr26-middle-jurassic-scotland` [11],
`davies-stephen-underhill-1996-moray-firth-flooding` [13],
`trewin-2009-east-sutherland-caithness` [12],
`steel-1993-megasequences` [25].

For the existing **East Shetland Platform** ops, add
`johnson-1993-bgs-northern-north-sea` [9] alongside the three already cited.

For the existing **Brent delta plain** ops, add `morton-1992-brent-provenance`
[7] and `richards-1992-brent-literature-review` [8] so the map key can show the
provenance controversy the rationale currently steps past.

### 3.5 What must NOT be claimed

1. **Not that Cao drowns Scotland at 179–166.** It does not; it calls that ground
   mountain. The gap is EarthHistory's shipped-class list. Any op there restates
   the source rather than correcting it, and must say so.
2. **Not a Middle Jurassic "Orcadian Basin".** The Orcadian Basin is Devonian.
   The Jurassic name for this ground is the Scottish landmass / Orkney–Shetland
   Platform.
3. **Not a Scottish coastline at any precision.** [11] gives a regional
   statement, not a line; the onshore outcrops mark basin *margins*, not shores.
   `spatialUncertaintyKilometres` must reflect that, and the rationale must say
   the outline is EarthHistory's own coarse construction.
4. **Not that the Moray Firth was land at 166–146**, nor that it was sea at
   179–166. Cao is right in sign at both; the Bathonian brackish-lagoonal state
   at Brora is a class EarthHistory does not have, which is a limitation, not an
   edit. Do not draw either of [12]'s two candidate seaway connections.
5. **Not that the Hebrides were emergent.** Skye and Raasay were marine
   (Bearreraig), then brackish-lagoonal and periodically subaerial (Great
   Estuarine Group), then marine again (Staffin Bay). They also lie outside the
   contract window; do not widen the window to reach them inside this phase.
6. **Not that the Great Estuarine Group is estuarine.** The name is historical;
   the environment is a brackish lagoon and delta complex. It is neither `lm` nor
   `sm`, exactly like the Orcadian Lake and the Pebas system.
7. **Not that the whole Shetland Platform was land.** The Unst Basin preserves a
   Brent Group succession [4][19].
8. **Not that the Brent delta was sourced from the Central North Sea dome.**
   [7] argues against it; [8] and [9] record it as an open two-model controversy.
   The dome's *emergence* may be cited; its *supply* may not, without naming both
   sides.
9. **Not that 60°30'N bounds the Brent delta.** It bounds the Vestland system.
   The Brent maximum is 61°30'N, and that is a delta front, not the limit of
   subaerial delta plain.
10. **Not present-day latitudes as palaeolatitudes.** 60°30'N and 61°30'N are
    present-day positions of wells and facies limits; the Bathonian palaeolatitude
    of northern Skye is given as ~42.8°N [20, Snippet].
11. **Not a traced outline.** Every publication here is citation-only; the
    emitted geometry is derived from the Cao 2017 rings.

---

## References

All accessed 2026-09-15. **[unverified]** marks an item whose metadata could not
be confirmed at a publisher, catalogue or DOI registry in this session, or whose
*content* was only seen through a summary. Numbering is local to this memo.

**Verified metadata and verified content (text or publisher-deposited abstract
read this session)**

3. Underhill J.R., Partington M.A. 1993. Jurassic thermal doming and deflation in the North Sea: implications of the sequence stratigraphic evidence. Geological Society, London, Petroleum Geology Conference Series 4, 337–345. https://doi.org/10.1144/0040337 — abstract read verbatim via Crossref.
4. Fjellanger E., Olsen T.R., Rubino J.L. 1996. Sequence stratigraphy and palaeogeography of the Middle Jurassic Brent and Vestland deltaic systems, Northern North Sea. Norsk Geologisk Tidsskrift 76, 75–106. https://njg.geologi.no/images/NJG_articles/NGT_76_2_075-106.pdf — **full open-access PDF retrieved and text-extracted**; all quotations above are from that text.
5. Helland-Hansen W., Ashton M., Lømo L., Steel R. 1992. Advance and retreat of the Brent delta: recent contributions to the depositional model. Geological Society, London, Special Publications 61, 109–127. https://doi.org/10.1144/GSL.SP.1992.061.01.07 — abstract read verbatim.
6. Mitchener B.C., Lawrence D.A., Partington M.A., Bowman M.B.J., Gluyas J. 1992. Brent Group: sequence stratigraphy and regional implications. Geological Society, London, Special Publications 61, 45–80. https://doi.org/10.1144/GSL.SP.1992.061.01.05 — abstract read verbatim. (An erratum exists: https://doi.org/10.1144/GSL.SP.1992.061.01.26.)
7. Morton A.C. 1992. Provenance of Brent Group sandstones: heavy mineral constraints. Geological Society, London, Special Publications 61, 227–244. https://doi.org/10.1144/GSL.SP.1992.061.01.13 — abstract read verbatim.
8. Richards P.C. 1992. An introduction to the Brent Group: a literature review. Geological Society, London, Special Publications 61, 15–26. https://doi.org/10.1144/GSL.SP.1992.061.01.03 — abstract read verbatim. **Note: Richards, not Morton et al.; Morton, Haszeldine, Giles & Brown wrote the volume introduction, https://doi.org/10.1144/GSL.SP.1992.061.01.01.**
9. Johnson H., Richards P.C., Long D., Graham C.C. 1993. United Kingdom offshore regional report: the geology of the northern North Sea. HMSO for the British Geological Survey, London. ISBN 0 11 884497 0. No DOI. Full text read at https://webapps.bgs.ac.uk/Memoirs/docs/B01842.html — NERC copyright 1993; citation-only.
10. Stoker M.S., Hitchen K., Graham C.C. 1993. United Kingdom offshore regional report: the geology of the Hebrides and West Shetland shelves, and adjacent deep-water areas. HMSO for the British Geological Survey, London. ISBN 0 11 884499 7. No DOI. Full text read at https://webapps.bgs.ac.uk/memoirs/docs/B01843.html — NERC copyright 1993; citation-only.
11. Cox B.M., Sumbler M.G. 2002. British Middle Jurassic Stratigraphy. Geological Conservation Review Series No. 26, JNCC, Peterborough. ISBN 1 86107 479 4. No DOI. Chapter 6, "The Middle Jurassic stratigraphy of Scotland", by B.M. Cox, K.N. Page and N. Morton; Staffin site report by K.N. Page. Text read at https://geoguide.scottishgeologytrust.org/p/gcr26/gcr26_ch6midjurassicstratscotland and .../gcr26_staffin — JNCC Open Government Licence 3.0.
12. Trewin N.H., Hurst A. (eds) 2009. Excursion Guide to the Geology of East Sutherland and Caithness. Dunedin Academic Press, Edinburgh. Chapter "Geological history of East Sutherland and Caithness" by N.H. Trewin. No DOI. Text read at https://geoguide.scottishgeologytrust.org/p/ags/ags_suth/ags_suth_02_geolhist — **[ISBN and page range unverified; the page is an Aberdeen Geological Society demonstration reproduction]**.
13. Davies R.J., Stephen K.J., Underhill J.R. 1996. A re-evaluation of Middle and Upper Jurassic stratigraphy and the flooding history of the Moray Firth Rift System, North Sea. Geological Society, London, Special Publications 114, 81–108. https://doi.org/10.1144/GSL.SP.1996.114.01.04 — abstract read verbatim. **Note the DOI: .01.04, not .01.05 (which is Harker & Rieuf on the Humber Group).**
14. Mellere D., Steel R.J. 1996. Tidal sedimentation in Inner Hebrides half grabens, Scotland: the Mid-Jurassic Bearreraig Sandstone Formation. Geological Society, London, Special Publications 117, 49–79. https://doi.org/10.1144/GSL.SP.1996.117.01.04 — abstract read verbatim.
25. Steel R.J. 1993. Triassic–Jurassic megasequence stratigraphy in the Northern North Sea: rift to post-rift evolution. Geological Society, London, Petroleum Geology Conference Series 4, 299–315. https://doi.org/10.1144/0040299 — abstract read verbatim.
26. Rattey R.P., Hayward A.B. 1993. Sequence stratigraphy of a failed rift system: the Middle Jurassic to Early Cretaceous basin evolution of the Central and Northern North Sea. Geological Society, London, Petroleum Geology Conference Series 4, 215–249. https://doi.org/10.1144/0040215 — abstract read verbatim.
27. Bradshaw M.J., Cope J.C.W., Cripps D.W., Donovan D.T., Howarth M.K., Rawson P.F., West I.M., Wimbledon W.A. 1992. Jurassic. In: Cope J.C.W., Ingham J.K., Rawson P.F. (eds) Atlas of Palaeogeography and Lithofacies, Geological Society, London, Memoirs 13, 107–129. https://doi.org/10.1144/GSL.MEM.1992.013.01.12 — abstract read verbatim. **Citation-only: the Atlas map plates are not traced, digitised or derived from.**

**Verified metadata, content NOT verified (do not attribute wording)**

15. Hudson J.D. 1983. Mesozoic sedimentation and sedimentary rocks in the Inner Hebrides. Proceedings of the Royal Society of Edinburgh Section B 83, 47–63. https://doi.org/10.1017/S0080455X00013321 — no abstract deposited anywhere; **[content unverified — do not quote]**. A duplicate registration exists, https://doi.org/10.1017/S0269727000013324; prefer the first.
16. Hudson J.D. 1962. The stratigraphy of the Great Estuarine Series (Middle Jurassic of the Inner Hebrides). Transactions of the Edinburgh Geological Society 19, 139–165. https://doi.org/10.1144/transed.19.2.139 — **[content unverified]**.
17. Harris J.P., Hudson J.D. 1980. Lithostratigraphy of the Great Estuarine Group (Middle Jurassic), Inner Hebrides. Scottish Journal of Geology 16, 231–250. https://doi.org/10.1144/sjg16020231 — **[content unverified]**.
18. Hudson J.D. 2002. Jurassic. In: Trewin N.H. (ed.) The Geology of Scotland, 4th edn. Geological Society, London, 323–350. https://doi.org/10.1144/gos4p.11 — **[Crossref records J.D. Hudson as sole author; the widely circulated citation is "Hudson & Trewin 2002" and the secondary source [12] cites it that way. Authorship not adjudicated; content unverified.]**
19. Johns C.R., Andrews I.J. 1985. The petroleum geology of the Unst Basin, North Sea. Marine and Petroleum Geology 2, 361–372. https://doi.org/10.1016/0264-8172(85)90031-5 — metadata verified; the thicknesses quoted above are a **Snippet** from a search summary, **[content unverified]**.
23. Pickering K.T. 1984. The Upper Jurassic 'Boulder Beds' and related deposits: a fault-controlled submarine slope, NE Scotland. Journal of the Geological Society 141, 357–374. https://doi.org/10.1144/gsjgs.141.2.0357 — **[content unverified; cited for the Kimmeridgian fault-scarp setting only]**.
24. Wignall P.B., Pickering K.T. 1993. Palaeoecology and sedimentology across a Jurassic fault scarp, NE Scotland. Journal of the Geological Society 150, 323–340. https://doi.org/10.1144/gsjgs.150.2.0323 — **[content unverified]**.
29. Morton N. 1990. Tectonic and eustatic controls of Jurassic genetic sequences in the Hebrides Basin, SW Scotland. Bulletin de la Société Géologique de France VI (6), 1001–1009. https://doi.org/10.2113/gssgfbull.VI.6.1001 — PDF-only, paywalled; **[content unverified]**. **Note the published title says "SW Scotland" although the Hebrides Basin is in NW Scotland — quote the title as published.**
30. Riding J.B., Thomas J.E. 1997. Marine palynomorphs from the Staffin Bay and Staffin Shale formations (Middle–Upper Jurassic) of the Trotternish Peninsula, NW Skye. Scottish Journal of Geology 33, 59–74. https://doi.org/10.1144/sjg33010059 — **[content unverified]**.
31. Hallam A. 2001. A review of the broad pattern of Jurassic sea-level changes and their possible causes in the light of current knowledge. Palaeogeography, Palaeoclimatology, Palaeoecology 167, 23–37. https://doi.org/10.1016/S0031-0182(00)00229-7 — metadata only, no abstract deposited; **[content unverified — do not attribute wording]**.

**Verified metadata, content seen only through a fetch-tool or search summary
(Snippet)**

20. Blakesley T., dePolo P.E., Wade T.J., Ross D.A., Brusatte S.L. 2025. A new Middle Jurassic lagoon margin assemblage of theropod and sauropod dinosaur trackways from the Isle of Skye, Scotland. PLOS ONE 20 (4), e0319862. https://doi.org/10.1371/journal.pone.0319862 (open access) — **[content is a Snippet; the PDF was not read line by line]**.
21. Okwara I.C., Hampson G.J., Whittaker A.C., Roberts G.G. 2025. Downsystem grain-size trends and mass balance of an ancient wave-influenced sediment routing system: Middle Jurassic Brent Delta, northern North Sea, offshore UK and Norway. Sedimentologika 3 (1), e31. https://doi.org/10.57035/journals/sdk.2025.e31.1336 (open access) — **[content is a Snippet; the galley PDF returned 404 and was not read]**.
22. Emeleus C.H., Bell B.R. 2005. British Regional Geology: the Palaeogene volcanic districts of Scotland, 4th edn. British Geological Survey, Keyworth. No DOI. Read through a fetch-tool summary of https://earthwise.bgs.ac.uk/index.php/Jurassic,_Palaeogene_volcanic_districts_of_Scotland — **[content is a Snippet]**.
28. Husmo T., Hamar G.P., Høiland O., Johannessen E.P., Rømuld A., Spencer A.M., Titterton R. 2003. Lower and Middle Jurassic. In: Evans D. et al. (eds) The Millennium Atlas: Petroleum Geology of the Central and Northern North Sea. Geological Society of London, 129–155. No DOI. **[Not opened. The "partly emergent throughout the Jurassic" wording in §1.4 is a search-engine paraphrase and must NOT be attributed to this chapter. Page range 129–155 vs 129–156 and year 2003 vs 2002 both circulate; not adjudicated.]**

**Counts.** **29 references** are cited in this memo, numbered [3]–[31]
(numbers [1] and [2] are reserved for the companion memo's Cao et al. 2017 and
the ICS chart and are not repeated here).

- **Bibliographic metadata verified: 28 of 29** — at Crossref, at a DOI
  registry, or at the publisher's own record. The one exception is **[12]
  Trewin & Hurst 2009**, whose text was read in full on the GeoGuide
  reproduction but whose ISBN and chapter page range were not confirmed.
- **Content verified (text or publisher-deposited abstract read this session):
  15** — [3][4][5][6][7][8][9][10][11][12][13][14][25][26][27].
- **Content unverified or Snippet-only: 14** — [15][16][17][18][19][20][21][22]
  [23][24][28][29][30][31].

No statement in §3 rests on a Snippet alone. Four corrections to citations that
circulate incorrectly are recorded in place: the Brent literature review is
Richards, not the volume editors [8]; the Moray Firth flooding paper is
SP 114.01.04, not .01.05 [13]; Hudson 1983 carries two DOI registrations [15];
and the "partly emergent" Shetland Platform wording must not be attributed to
Husmo et al. [28].

---

## Reproduction of the measured table

The §0 table was measured by a throwaway read-only probe over the pinned
archive, in the pinned pyGPlates environment:

```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
# open geography/earthbyte-paleogeography-gplates2.3.zip, read
# Paleogeography/Global_Cao_etal/{lm,sm,m,i}_402_2.{shp,dbf,shx} from the zip,
# union every record whose (TOAGE, FROMAGE] overlaps the interval and whose
# bbox intersects the window, then test point containment.
```

Nothing was written to `data/`, `public/` or `src/` by that probe, and the
pinned archive was not extracted.
