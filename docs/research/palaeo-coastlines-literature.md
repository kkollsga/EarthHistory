# Palaeo-coastline literature: Cao 2017, the North Sea, and a basin queue

Research record for the `codex/palaeo-coastlines` program (Phase R2 of
`dev-docs/plans/palaeo-coastlines-polygons.md`). Companion to the Cao 2017
conversion audit (Phase R1). Compiled 2026-09-15; all web sources accessed
2026-09-15.

This memo constrains the basin-edit contract (plan D3) and the prioritised
basin queue (plan Phases 8 and 9). It is a literature record, not an
implementation claim: no polygon in this repository is justified by this memo
until a `data/corrections/palaeo-coastlines/basins/<basin>.json` contract cites
the specific reference and passes the validator.

## Conventions

Same house style as
[rifts-and-lakes-literature.md](rifts-and-lakes-literature.md):

- **Verbatim** — quoted from text actually retrieved (open PDF, publisher HTML,
  or a publisher-deposited abstract in Crossref/OpenAlex/Semantic Scholar).
- **Snippet** — a statement reported by a search-engine summary of a page that
  could not be opened. Unverified until the PDF is read.
- **Inference** — our reading, arithmetic, or mapping onto the ICS scale.
  Always marked.
- Ages in Ma. Stage boundaries are **ICS International Chronostratigraphic
  Chart v2024/12** [12] unless a source's own timescale is quoted, in which
  case the source's number is given and the difference flagged.
- "Cao interval" means one of the 24 contiguous Golonka (2000) time-slice bins
  that the Cao 2017 shapefiles carry as `FROMAGE`/`TOAGE`.

**Rights.** Every entry in sections 2 and 3 is **citation-only**. No map,
figure, polygon, coordinate list, or table from any of these publications is
traced, digitised, copied, or redistributed by EarthHistory. The published
work constrains an edit the way a measurement constrains a model; the emitted
geometry is our own, derived from the Cao 2017 polygons. The only
redistributed palaeogeographic geometry in this program is Cao et al. 2017
itself (CC BY 3.0, [1]) on Cao et al. 2024 v2.4 partitions (CC BY 4.0, [11]).
Blakey / Deep Time Maps is commercially licensed and is reference-only: it may
be cited, never posted, traced, or derived from.

Publisher hosts that returned HTTP 403 to this worker: sciencedirect.com,
onlinelibrary.wiley.com, academic.oup.com, lyellcollection.org,
pubs.geoscienceworld.org, cambridge.org/core. Crossref, OpenAlex, DataCite,
Semantic Scholar, Unpaywall and Europe PMC were used to recover metadata and
publisher-deposited abstracts.

---

## 1. Cao et al. 2017: what the classes actually mean

### 1.1 Identity, lineage, licence

| Item | Value | Status |
|---|---|---|
| Paper | Cao, Zahirovic, Flament, Williams, Golonka & Müller 2017, *Biogeosciences* 14, 5425–5439, [10.5194/bg-14-5425-2017](https://doi.org/10.5194/bg-14-5425-2017) | Verbatim (full PDF read) |
| Licence | "© Author(s) 2017. This work is distributed under the Creative Commons Attribution 3.0 License." | Verbatim (PDF masthead) |
| Shipped package | EarthByte GPlates 2.3 `Paleogeography/Global_Cao_etal/`: `i` ice, `m` mountain, `lm` landmass, `sm` shallow marine, each "a collection of features for all time intervals from 402 to 2 Ma" | Verbatim (package `_README.txt`, dated 21 May 2018) |
| Measured record counts | `lm` 7,155 DBF records; fields include `PLATEID1`, `FROMAGE`, `TOAGE`, **`START_ICS`, `END_ICS`**, `TYPE`, `RECON_METH` | Verbatim (DBF header read locally) |
| Base maps | "a set of global paleogeographic maps (Golonka et al., 2006) covering the entire Phanerozoic time period as the base paleogeographic model" [2] | Verbatim |
| Base map rotations | Golonka 2007a [4]; "relative plate motions of Golonka (2006, 2007a) are based on the reconstruction of Scotese (1997, 2004)" | Verbatim |
| Target rotations | Matthews et al. 2016 [6], itself Müller et al. 2016 [7] (230–0 Ma) + Domeier & Torsvik 2014 [8] (410–250 Ma) | Verbatim |
| Palaeobiology input | "a total of 57 854 fossil collections with temporal and paleoenvironmental assignments from 402 to 2 Ma were downloaded from the [PBDB] on 7 September 2016" | Verbatim |
| Predecessor method | Wright et al. 2013 [9]; Cretaceous–Cenozoic shoreline benchmark Heine et al. 2015 [10] | Verbatim |

### 1.2 What "landmass" and "shallow marine" mean

| Statement | Source text | Status |
|---|---|---|
| The five classes | "These paleogeographic reconstructions illustrate the changing configuration of ice sheets, mountains, landmasses, shallow marine environments (inclusive of shallow seas and continental slopes) and deep oceans over the last ~400 Myr." | Verbatim |
| **Shallow marine includes slope** | Same sentence: "(inclusive of shallow seas and continental slopes)". So `sm` is **not** a depth class and **not** "shelf"; it bundles epicontinental sea with continental slope. | Verbatim |
| Coastline semantics | "Coastlines on these paleogeographic maps represent estimated maximum marine transgression surfaces (Kiessling et al., 2003)." [5] | Verbatim |
| Repeated in the abstract | "revise the locations of inferred paleo-coastlines that represent the estimated maximum transgression surfaces" | Verbatim |
| Land side of the lookup | "Terrestrial fossil paleoenvironments correspond to paleogeographic features of landmasses, mountains or ice sheets and marine fossil paleoenvironments to shallow marine environments or deep oceans." (Table 2) | Verbatim |
| Class layering is prescribed | "to avoid artefacts introduced from overlapping paleogeographies, the display order must use the following sequence: ice sheets, mountains, landmasses and finally shallow marine environments (top to bottom layering)." | Verbatim (package README) |
| Global areas | ice 1.0 %, mountain 3.4 %, shallow marine 14.3 %, landmass 21.3 %, deep ocean 60.1 % of Earth's surface, averaged over 402–2 Ma; ice exists only during 380–285, 81–58 and 37–2 Ma | Verbatim |

**Consequence for the map key (our inference).** `lm` is the *minimum land* and
`sm` the *maximum flooding* recorded anywhere inside a 9–27 Myr bin, not a
shoreline at an instant; and because `sm` explicitly includes continental
slope, a blue `sm` polygon is an environment class, never a water depth. The
plan's D1 wording ("maximum transgression over the map interval; environment
class, not depth") is supported verbatim by the two statements above. The
prescribed layering order is the same precedence the plan's D1 table adopts.

### 1.3 The revision method and its own spatial tolerances

Cao's modification rules (Section 3, Verbatim) give the only numeric spatial
tolerances in the source:

1. PBDB marine collections "are presumed to be well dated, constrained
   geographically, not reworked and representative of their broader
   paleoenvironments."
2. "Only marine fossil collections within **500 km** of the nearest
   paleo-coastlines are taken into account."
3. Coastlines "are modified until they are consistent with the marine fossil
   collection environments and at the same time remain about **30 km**
   distance from the fossil points used."
5. "The modified area … resulting from shifting the coastline is filled using
   the shallow marine environment."

Consistency rose "from an average of 75 % to nearly full consistency (100 %)";
"52 fossil collections over all time intervals cannot be resolved as they are
over 500 km distant from the nearest coastline."

**Our inference:** the intrinsic positional tolerance of a Cao 2017
palaeo-coastline is of order **10¹–10² km**, and where the revision moved a
coastline the vacated ground was filled with `sm` by construction, not by
evidence of shallow sea. A basin edit finer than ~30 km is therefore below the
source's own resolution and must carry its own cited justification.

### 1.4 The 24 intervals, and the timescale trap

Table 1 of [1], Verbatim. `FROMAGE`/`TOAGE` are the **Golonka (2000)** columns
[3]; `START_ICS`/`END_ICS` are the paper's **ICS2016** equivalents. Neither
equals ICS v2024/12.

| # | Golonka slice | Epoch/age label | FROMAGE–TOAGE | recon. age | ICS2016 start–end |
|---|---|---|---|---|---|
| 1 | Kaskaskia I | late Pragian–Eifelian | 402–380 | 396 | 408.7–387.7 |
| 2 | Kaskaskia II | Givetian–early Famennian | 380–359 | 368 | 387.7–365.6 |
| 3 | Kaskaskia III | late Famennian–early Visean | 359–338 | 348 | 365.6–341.4 |
| 4 | Kaskaskia IV | middle Visean–Serpukhovian | 338–323 | 328 | 341.4–323.2 |
| 5 | early Absaroka I | Bashkirian–Kasimovian | 323–296 | 302 | 323.2–303.7 |
| 6 | early Absaroka II | Gzhelian–Asselian | 296–285 | 287 | 303.7–295.0 |
| 7 | early Absaroka III | Sakmarian–Kungurian | 285–269 | 277 | 295.0–272.3 |
| 8 | early Absaroka IV | Roadian–Changhsingian | 269–248 | 255 | 272.3–252.17 |
| 9 | late Absaroka I | Induan–early Carnian | 248–224 | 232 | 252.17–232 |
| 10 | late Absaroka II | late Carnian–middle Hettangian | 224–203 | 218 | 232–200.0 |
| 11 | late Absaroka III | late Hettangian–early Aalenian | 203–179 | 195 | 200.0–172.8 |
| 12 | early Zuni I | middle Aalenian–middle Bathonian | 179–166 | 169 | 172.8–166.8 |
| 13 | early Zuni II | late Bathonian–middle Tithonian | 166–146 | 152 | 166.8–147.4 |
| 14 | early Zuni III | late Tithonian–early Valanginian | 146–135 | 140 | 147.4–136.4 |
| 15 | late Zuni I | late Valanginian–early Aptian | 135–117 | 126 | 136.4–119.0 |
| 16 | late Zuni II | late Aptian–middle Cenomanian | 117–94 | 105 | 119.0–96.1 |
| 17 | late Zuni III | late Cenomanian–early Campanian | 94–81 | 90 | 96.1–79.8 |
| 18 | late Zuni IV | middle Campanian–Selandian | 81–58 | 76 | 79.8–59.2 |
| 19 | early Tejas I | Thanetian–Ypresian | 58–49 | 53 | 59.2–47.8 |
| 20 | early Tejas II | Lutetian–Bartonian | 49–37 | 45 | 47.8–37.8 |
| 21 | early Tejas III | Priabonian–Rupelian | 37–29 | 33 | 37.8–28.1 |
| 22 | late Tejas I | Chattian–Aquitanian | 29–20 | 22 | 28.1–20.44 |
| 23 | late Tejas II | Burdigalian–Serravallian | 20–11 | 14 | 20.44–11.63 |
| 24 | late Tejas III | Tortonian–Gelasian | 11–2 | 6 | 11.63–1.80 |

**Timescale offsets that matter (our inference, from [12]).** Interval 1's
label "late Pragian–Eifelian" is 402–380 Ma on Golonka (2000) but
**~411–387.95 Ma** on ICS v2024/12 (Pragian base 413.02, Emsian base 410.62,
Eifelian top 387.95): the numeric bin is younger than its own stage label by up
to ~9 Myr. Other material shifts between ICS2016 (Cao's `START_ICS`) and ICS
v2024/12: Valanginian base 139.8 → **137.05**; Aptian base 125.0 → **121.4**;
Santonian base 86.3 → **85.7**; Rhaetian base 208.5 → **~205.7**; Anisian base
247.2 → **246.7**; Serpukhovian base 330.9 → **330.3**; Emsian base 407.6 →
**410.62**; base Devonian 419.2 → **419.62**.
**Rule for the compiler:** the lifecycle must be driven by the DBF
`FROMAGE`/`TOAGE` numbers, and the UI must print the interval as a numeric
range, never as a stage name, or the label will contradict the geometry.

### 1.5 Limitations stated by the authors

All Verbatim, from Sections 4.1, 5.3 and 5.4:

| Limitation | Text |
|---|---|
| Manual, non-reproducible steps | "Transferring paleogeographic geometries to a different reconstruction inevitably results in gaps and/or overlaps, which can only be addressed using presently laborious methods." / "revising the coastlines and paleogeographic geometries based on the PBDB test is also currently achieved manually" |
| Gap-fill dominates the signal | "filling gaps results in a larger terrestrial areal change than revising paleogeographic geometries based on PBDB test. Therefore, variation of the underlying plate reconstruction is the main factor that contributes to the terrestrial areal change" |
| Temporal resolution unknown | "due to the inaccessibility of the original data that were used to build the paleogeographic maps, we are not in a position to estimate the temporal resolution of the original coastlines and paleogeographic maps." |
| Binning changes the evidence | "there are over 2000 marine fossil collections between 387.7 and 365.6 Ma in ICS2016 but fewer than 300 collections between 380 and 359 Ma using the Golonka (2000) timescale." |
| Evidence is thin in places | "there are more than 4000 in total within 269–248 Ma but only 20 during 37–29 Ma." |
| Coverage heterogeneity | "the spatial coverage of data is still highly heterogeneous, with relatively few data points across large areas of the globe for some time periods." |
| Deceptive fossils | the ~17 Ma beaked whale 740 km inland (Wichura et al. 2015) was removed by hand; "Such instances of deceptive fossil data are a potential limitation within our workflow" |
| Independent cross-checks disagree | flooded-area curves agree with other compilations "except for the periods 338–269 Ma and 248–203 Ma, during which the flooded continental areas for this study and Golonka et al. (2006) are smaller" |

**Our inference, decisive for this program.** Only **20** marine fossil
collections constrain the whole globe in interval 21 (37–29 Ma), against >4000
in interval 8 (269–248 Ma). The PBDB revision is therefore essentially inactive
for most of the Palaeogene: there, `lm`/`sm` is Golonka et al. 2006 as drawn,
transferred into a different rotation model and gap-filled by hand. Palaeogene
North Sea geometry is the **weakest** part of the source and the strongest case
for a cited local edit.

---

## 2. The North Sea, interval by interval

Columns: the ICS v2024/12 age of the event; the Cao interval(s) the
basin-edit contract would touch; the published pattern; spatial uncertainty
where a source states one; and whether the statement is the source's claim or
our inference. Every reference here is citation-only — none is traced.

| Event / interval | ICS v2024/12 age (Ma) | Cao interval(s) | Published land–sea pattern | Stated spatial uncertainty | Status | Refs |
|---|---|---|---|---|---|---|
| Orcadian Basin, Middle Old Red Sandstone | Eifelian–Givetian, 393.47–382.31 | 1 (402–380), 2 (380–359) | Cyclic **lacustrine** succession on the Old Red Sandstone continent; "Seven facies … upper and lower shoreface, deep lake, shallow lake, playa, turbidite and fluvial" — land with a large internal lake, not sea | Achanarras fish bed correlates "bed-scale … over **160 km** across the basin" | Source claim [22] | [21][22] |
| Devonian marine incursions into the Orcadian | late Givetian–Frasnian, ~385–375 | 2 (380–359) | "a wide flat sabkha plain extended eastwards from the onshore Orcadian Basin … subjected to episodic marine incursions"; "**the sea entered the Orcadian Basin from the east along the Tornquist Zone at the margin of the Fenno-Scandian High**" | not stated | Source claim [23] | [23][20] |
| Carboniferous, Dinantian–Namurian | Tournaisian–Serpukhovian, 358.86–323.4 | 3 (359–338), 4 (338–323) | "a change from the dominantly continental redbed deposition of the Devonian Period to more diversified marine, fluvial, deltaic and continental sedimentation"; south of the Craven line **carbonate platforms with reef-fringed margins**, north of it **alluvial plains and shallow-water deltas** (Yoredale cyclothems) | Craven Fault line is the stated facies boundary; no km error given | Source claim [24][25] | [24][25] |
| Carboniferous, Westphalian coal swamps | Bashkirian–Moscovian, 323.4–307.0 | 5 (323–296) | "a dominant … **north to south-flowing sediment distribution system**"; secondary source on the **Anglo-Brabant Massif**; channel sandbody percentage minimum in Westphalian B. Variscan foreland, low-relief coal-forming plain | not stated | Source claim [26]; Variscan-foreland framing is our inference | [26][27] |
| Rotliegend desert basin | Guadalupian–Lopingian, ~266–252 (Upper Rotliegend) | 7 (285–269), 8 (269–248) | "a sedimentary basin up to **2,000 km long and 500 km wide** … in the foreland of the Variscan mountains"; **central shale/halite (salt-lake) facies** passing south to anhydritic clay then wadi and aeolian sandstone; "Paleowind directions were essentially from east to west"; "up to **200 m** of dune sands in the southern North Sea area" | basin dimensions 2,000 × 500 km stated | Source claim [29] | [29][30] |
| Zechstein Sea | Wuchiapingian–Changhsingian, 259.51–251.902 | 8 (269–248) | Periodically isolated **carbonate–evaporite basin**; two behaviours distinguished — "incomplete drawdown" vs "complete drawdown and wholesale basin desiccation"; "evaporites pass up into carbonate sediments which are mainly deposited on **shallow-water platforms around the basin** during transgressive and highstand systems tracts" | not stated; the margin is a platform belt, not a line | Source claim [31]; that the marine/desiccated state alternates *within* Cao interval 8 is our inference | [31][32] |
| Triassic dryland | Induan–Rhaetian, 251.902–201.4 | 9 (248–224), 10 (224–203) | "**Fluvial drainage was dominantly endorheic in character, and terminated in playa, aeolian dune, sabkha or marsh settings**", fed from Greenland, Fennoscandia, the Scottish Highlands and the Variscan remnants; Fennoscandian run-off could "episodically drive major exorheic drainage systems into the Tethys Sea" | not stated | Source claim [33][34] | [33][34] |
| Brent delta progradation | late Aalenian–early Bajocian, ~172–169 | 12 (179–166) | "The progradation of the Brent Delta (Rannoch, Etive and lower Ness Formations) took place in **Late Aalenian to Early Bajocian**"; earlier Oseberg fan-delta "built out towards the west and northwest and backfilled the previously emergent areas" | no progradation distance in the retrieved abstract | Source claim [36] | [36][37][38] |
| Brent delta retreat and drowning | early Bajocian–early Bathonian, ~170–167 | 12 (179–166) | "**The Early Bathonian delta retreat took place in retrogressive pulses** … forming an estuary in the Southern Viking Graben and gradually drowning the deltaic system in the Northern Viking Graben" | — | Source claim [37] | [37][36] |
| Vestland delta, second progradation | Bathonian, ~168–166 | 12 (179–166), 13 (166–146) | "a second, pronounced deltaic progradation (the 'Vestland deltaic system') took place from the Central Viking Graben to **ca. 60°30′N**" | northern limit given as a latitude | Source claim [37] | [37] |
| Mid-Jurassic Central North Sea dome | Toarcian–Aalenian; source says "177 Ma" on its own scale, ≈ 174–172 on ICS v2024/12 | 11 (203–179), 12 (179–166) | Regional domal uplift from "the impingement of a broad-based (**> 1250 km diameter**), transient plume head"; "systematic truncation of stratigraphy occurred throughout the North Sea domain"; then "progressive pre-rift, Aalenian–early Bathonian marine onlap" as the dome deflated | **dome diameter > 1250 km** | Source claim [35]; the ICS-2024 re-dating of "177 Ma" is our inference | [35] |
| Late Jurassic rift seaways, Kimmeridge Clay | Kimmeridgian–Tithonian, 154.8–143.1 | 13 (166–146), 14 (146–135) | Widespread Kimmeridge Clay Fm and equivalents deposited across the rift; TOC rises "from 1–2 % at the top and base to a peak of **8–9 %** in the middle"; a mid-*eudoxus* δ¹³C shift is shared with Tethyan carbonate successions, "suggesting that it is a regional event" | not stated | Source claim [39][40][41]; note [40] attributes TOC variation partly to **dilution**, so do not cite it as an anoxia-only argument | [39][40][41] |
| Late Ryazanian transgression / "Late Cimmerian Unconformity" | late Berriasian, ~139–137 | 14 (146–135), 15 (135–117) | "over most of the North Sea the **base of the Valhall Formation is isochronous, and conformable** with underlying sediments … it represents a widespread facies change marking the **late Ryazanian transgression**"; the unconformity is a basin-margin/high phenomenon | not stated | Source claim [42] | [42] |
| Early Cretaceous archipelago | Berriasian–Albian, 143.1–100.5 | 15 (135–117), 16 (117–94) | 3-D backstripping predicts that "**At the Base Cretaceous (140 Ma) … numerous isolated footwall islands** … were present", and that at top Lower Cretaceous (98.9 Ma) "very localized fault-block topography … remained **emergent** within the basin" | model output at named ages | Source claim (model output) [43] | [43][44] |
| Late Cretaceous Chalk sea | Cenomanian–Maastrichtian, 100.5–66.0 | 17 (94–81), 18 (81–58) | "The NW European Chalk Group was deposited in a **deep epicontinental sea**"; Boreal Chalk Sea SST record from Danish cores; Late Cretaceous history "strongly influenced by both sea-level fluctuations and inversion tectonics" | not stated | Source claim [46][47][48] | [45][46][47][48] |
| Palaeocene deep basin with western/northern clastic supply | Danian–Thanetian, 66.0–56.0 | 18 (81–58), 19 (58–49) | "**The Shetland Platform supplied sediment continuously**, although at varying rates, until the latest Cenozoic"; mid-Palaeocene "water depths in the Norwegian–Danish basin were **about 250 m**", so top-Chalk valleys "formed in relatively deep water **rather than due to subaerial exposure**" | 250 m water depth stated (a depth, not a plan-view error) | Source claim [52][53] | [49][50][52][53] |
| Iceland-plume transient uplift (Forties/Sele/Balder interval) | Thanetian–early Ypresian, ~59–55 | 18 (81–58), 19 (58–49) | "Transient uplift of **300–600 m** occurred at the Paleocene–Eocene boundary, followed by subsidence of 500–800 m"; a backstripping study incorporates "**350 m** of uplift … at the Base Tertiary (65 Ma) and **300 m** at the Top Balder Formation (54 Ma), followed by rapid collapse" | uplift magnitudes stated | Source claim [51][43] | [51][50][43] |
| Eocene | Ypresian–Priabonian, 56.0–33.9 | 19 (58–49), 20 (49–37), 21 (37–29) | Deep-marine central basin with submarine-fan systems (Frigg); "Thick Eocene deposits in the Central Graben are sourced mainly from a **western and a likely southern source**, indicating that prominent influx from the south did not only occur from the mid-Miocene onwards" | not stated | Source claim [52][55]; the "deltaic/coastal margins" phrasing is our inference from [52][57] | [52][54][55] |
| Oligocene–Miocene eastern-margin deltas | Rupelian–Messinian, 33.9–5.333 | 21 (37–29), 22 (29–20), 23 (20–11), 24 (11–2) | "the eastern and central North Sea Basin was **progressively filled by large deltas, which built out from the eastern basin margin** … fed by ancient rivers from southern Norway (late Paleocene–Oligocene and Pliocene), southern Norway and Sweden (early Miocene), the Baltic region (middle Miocene–early Pleistocene)"; "Three major deltaic units … **prograded from the north and north-east**" during the Early–early Middle Miocene, then "marine depositional conditions dominated" in the Middle–Late Miocene | published palaeogeographic map series at named slices | Source claim [56][57] | [56][57][58][59] |
| Eridanos delta, latest Cenozoic | Tortonian–Pleistocene, 11.63–~1 | 24 (11–2), then outside Cao range | "**Water depth in the depocentre is seen to decrease systematically over time**", interrupted by deepening 6.5–4.5 Ma; "the straight wave-dominated delta front gradually developed into a lobate fluvial-dominated delta front" | not stated | Source claim [58][59] | [58][59] |
| LGM lowstand | 26.5–19.0 ka (LGM); esl minimum **−134 m**, 29–21 ka | **none** — younger than Cao's 2 Ma floor; falls in the plan's fallback window | "Nearly all ice sheets were at their LGM positions from **26.5 ka to 19 to 20 ka**"; "a slow fall to **−134 m** from 29 to 21 ka BP"; the same paper's companion model gives "a peak eustatic sea-level fall of **~130 m**" | eustatic values, not a North Sea contour | Source claims [60][61] | [60][61] |
| Doggerland inundation | ~11–7 ka, submergence continuing to ~4 ka | none (fallback) | "the present-day relief of the North Sea bed **does not provide a sound guide** to the relief of the former landscape, nor to the chronology and character of its submergence"; GIA-based models give "**127,422 km²**" submerged in the North Sea zone, "an area twice that of all the other three regions added together"; "nearly twenty percent of total land area lost over different five hundred year periods" | 500-year model interval; area figure is model output | Source claims [62][64] | [62][63][64] |
| GIA: why a flat −120 m contour is wrong here | 20 ka–present | none (fallback) | Britain/Ireland RSL database spans "**~+40 to −55 m**" and shows "radically different patterns of RSL"; "regions at the ice sheet periphery record **up to 120 m** of predominantly continuous RSL rise"; GIA palaeotopography maps show "how now submerged regions were previously subaerially exposed" | ±: spatial variability is the point | **Our inference** that a uniform −120 m contour misstates the North Sea; the sources state the variability, not the critique | [67][66][65][62] |

### 2.1 Where Cao 2017 is likely too coarse for the North Sea

Our inference throughout, from §1.3 and §1.5 plus the table above:

| Cao interval | Why it is too coarse here |
|---|---|
| 1–2 (402–359) | The Orcadian is a **lake inside land** with episodic marine incursion from the east [22][23]; a land/shallow-marine binary at 500 km tolerance cannot express it. The plan's witness has the North Sea centre as `lm` at 402–380 — consistent with "land", but the lake is invisible. |
| 3–5 (359–296) | Carbonate platform south / deltaic north across a single sharp facies line [24][25], plus a north-to-south fluvial axis [26]: two different environments in one bin. |
| 7–8 (285–248) | One bin (269–248) has to hold both the **Rotliegend desert with a central salt lake** [29] and the **Zechstein Sea** [31][32] — a full continental-to-marine flip. The plan's witness has the Zechstein point as `sm` at 269–248, i.e. the marine end-member wins, and the desert phase is unrepresentable. |
| 9–10 (248–203) | Triassic drainage is explicitly **endorheic** [34]; "land" is right but "no standing water" is wrong, and Cao has no playa/sabkha class. |
| 11–12 (203–166) | The Brent delta advances and retreats **inside** interval 12 (179–166) [36][37], and the >1250 km Mid-Jurassic dome [35] straddles the 11/12 boundary. Maximum-transgression semantics record only the drowned end state. |
| 13–14 (166–135) | Late Jurassic rift seaways are **narrow, fault-bounded and anoxic** [39][41]; graben-scale geometry is finer than Cao's ~30 km floor. |
| 15–16 (135–94) | Backstripping predicts **isolated emergent footwall islands** through the Early Cretaceous [43]; these are far below Cao's resolution and are exactly what the "England still looks as far from Norway as today" complaint is about. |
| 18–21 (81–29) | The evidence floor: **20 PBDB marine collections globally** in 37–29 Ma and few in 81–58 [1]. Palaeogene North Sea geometry is effectively un-tested Golonka geometry; the transient plume uplift of 300–600 m [51] and the 250 m mid-Palaeocene water depth [53] are not expressible at all. |
| 22–24 (29–2) | The basin fills from the **east** by prograding deltas [56][57][58]; a maximum-transgression bin records the flooded state and hides the progradation that the whole Neogene story is about. |
| below 2 Ma | Cao stops at 2 Ma. Doggerland and the LGM lowstand are outside the source entirely and belong to the plan's Phase 9, with GIA, not a eustatic contour, as the control [65][66][67]. |

---

## 3. Prioritised basin queue

Order reflects (a) how visibly wrong the current globe is, (b) how well the
literature constrains an edit, (c) how much of the "Cao is land everywhere"
problem it fixes. The plan's measured witnesses are quoted where relevant:
**Turgai Strait and Hudson Seaway are land in every Cao interval**; WIS and
West Siberian are `sm` at 94–81; Tethyan Himalaya is mountain at 94–81.

| Rank | Basin | Age window (as stated by the sources) | What Cao 2017 probably gets wrong | Key publications |
|---|---|---|---|---|
| 1 | **Western Interior Seaway** | Albian–Danian, ~113–64; maximum extent at the Cenomanian–Turonian boundary ~94; "extended for **4,800 km** … and was approximately **1,620 km** wide" [68] | The plan's witness confirms `sm` at (−100, 45) in 94–81, so the seaway *exists* — but its two-shore geometry through the Campanian retreat sits inside interval 18 (81–58), a 23 Myr bin that also holds the final withdrawal. The Danian Cannonball remnant is outside any usable bin. | [68][69][70][71]; Blakey / Deep Time Maps reference-only [72] |
| 2 | **West Siberian Sea and Turgai Strait** | Seaway open through the Eocene; "a closed seaway in the Paleocene (66–56 Ma), an open but shallow seaway in the Eocene (56–33.9 Ma), and a closed seaway afterwards" [77]; marine sedimentation in SW Siberia ends "in the Late Priabonian (~**34.8 Ma**)" [75] | **Highest-value fix.** The plan measured **Turgai as land in every Cao interval**, so the single most-cited Palaeogene epicontinental seaway in Eurasia is absent from the globe. Aggravated by the 20-collection PBDB floor in 37–29 Ma [1]. Note two incompatible frameworks — Akhmetiev's dated marine record [73][75] vs Straume's dynamic-topography model [77]; an edit must pick one and say which. | [73][74][75][76][77]; Vinogradov atlas [78] (no DOI, mapping unverified) |
| 3 | **Paratethys** | Paratethys as a distinct realm from the Eocene–Oligocene boundary; Solenovian restriction **32–30 Ma** [79] vs **c. 31 Ma** [82]; Maikop anoxia 33.8–14.85 Ma [82]; late Miocene megalake desiccations **9.75–7.65 Ma** [81] | Cao intervals 21–24 (37–29, 29–20, 20–11, 11–2) each average over several complete Paratethyan reconnection/isolation cycles; a maximum-transgression bin will show the sea at its largest and never show the megalake regressions that define the system. Same PBDB evidence floor. | [79][80][81][82][83] |
| 4 | **Pebas / Amazonia and the Paraná corridor** | "Pebas system" 23–10 Ma, "Acre system" 10–7 Ma [84]; marine incursions dated only at Llanos **18.1–17.2** and **16.1–12.4 Ma** [87]; Paranense transgressions **15–13** and **10–5? Ma** [88] | Cao's `sm` class would render a **marine** western Amazonia. The literature disagreement is about duration and salinity, not existence: Wesselingh reads a long-lived predominantly **freshwater** lake–swamp complex "with only very limited marine influence, up to oligohaline at its maximum" [86], Jaramillo puts a hard numerical ceiling on marine occupancy [87]. An edit here must add a **lake/wetland** epistemic label, not a shallow sea, or it will assert the contested reading. | [84][85][86][87][88] |
| 5 | **Sundaland** | LGM shelf emergent, drawn at the **120 m** contour "approximately 20,000 years ago" [91]; lowstand **−116 m at 21 ka**, +5 m at 4.2 ka [92]; sea level "at or below 40 m below present-day levels for more than half" of each interval studied [93] | Entirely outside Cao's 2 Ma floor, so it belongs with Doggerland in Phase 9, not in the palaeo-coastline mode. Hall's own caution binds us: bathymetry-plus-eustasy is "valid only for the Pleistocene", and the Makassar Straits "were never narrower than about 75 km" — never a land bridge. | [89][90][91][92][93] |
| 6 | **Barents shelf** | Late Devonian–mid-Permian carbonate platform; Early–Middle Triassic transgression with NW-prograding coastline; Bathonian/Callovian regional transgression; Tithonian "maximum transgression on an extensive shelf"; Paleogene–Neogene uplift of 1–3 km [95][94] | The Triassic shelf is a **prograding coastline sweeping NW across the basin** [97] — precisely the signal a maximum-transgression bin erases. Cao intervals 9–10 (248–203) hold the whole Triassic progradation. Published atlas map slices exist at named stages [94], but the atlas is copyrighted and non-redistributable: citation-only. | [94][95][96][97][98] |
| 7 | **Greater India / Tethyan Himalaya** | Initial contact **59 ± 1** [102] / ~58 [101] / ~52 [100] / soft collision **44 ± 2** [99]; marine seaways gone **50–45 Ma** [102] or mid–late Eocene [99]; Greater India Basin **2,675 ± 700 km** opened 120–70 Ma [100], restated 2600–3400 km [101] — contradicted by a "~1000 km indenter" [99] | The plan already measured Tethyan Himalaya (85, 29) as **mountain** (plate 616) at 94–81 and `sm` on 501/606 earlier — so Cao renders orogen where the literature has a submerged passive margin for much of the Cretaceous. Worse, the **width of Greater India itself is contested by a factor of ~3**, and the plan's audit found 606/616 among the worst frame-conflict plates (Lhasa 70.9 %, Qiangtang 50.8 %). Any edit here is model output layered on model output and must say so. | [99][100][101][102][103] |
| 8 | **Adria / Greater Adria** | Mediterranean oceans open "since the Triassic", destroyed by subduction "since the Jurassic"; reconstruction in 12 snapshots **240–0 Ma** [107]; Adriatic Carbonate Platform Toarcian to end-Cretaceous [108] | Adria exists as a Cao 2024 continent feature (plate 307, Apulia 3307) and renders, but carries **no exposure class**: it is shelf-blue at every age although the literature has a carbonate **platform** — shallow-water, periodically emergent — for ~130 Myr. The cheapest win is an exposure/platform class on existing geometry, not new polygons. | [104][105][106][107][108] |
| 9 | **Hudson Bay / Arctic seaways** | Hudson Platform succession "Early (?) – Middle-Late Ordovician to Late Devonian", max preserved ~2500 m [113]; Cretaceous "**southern shoreline of the Albian Hudson Arm**" [115]; Turonian connection proposed but speculative [116] | The plan measured **Hudson as land in every Cao interval**. Two separate epicontinental seas are missing: the Ordovician–Devonian Hudson Platform sea (outside Cao's 402 Ma floor for its early part, inside intervals 1–3 for the rest) and the **Albian Hudson Arm** linking the WIS to the Labrador Sea (interval 16, 117–94). Only the Albian arm is well supported; Cenomanian–Turonian is speculative and must be labelled so. Correction to note: the thick evaporites are **Upper Silurian**, not Devonian. | [109][110][111][112][113][115][116] |
| 10 | **Tethys margins: Arabian plate and N/C Africa** | 19 palaeofacies maps, Late Permian–Holocene [118]; Cenomanian–Turonian (98.9–89 Ma) maximum coastal onlap, terminating unconformity at **92 Ma** [118]; Trans-Saharan seaway first confirmed **Turonian**, flooding south from the Cenomanian, re-established Campanian–Maastrichtian [123] | Low priority *because Cao is probably close here*: interval 17 (94–81) already floods the Arabian platform. The high-value target is the **Trans-Saharan seaway** across West Africa, a narrow two-pulse connection inside intervals 17 and 18 that a maximum-transgression bin would merge into one continuous sea. | [118][119][120][121][122][123][124] |

---

## 4. What a basin edit may and may not do

Binding on every `data/corrections/palaeo-coastlines/basins/<basin>.json`
contract (plan D3), and consistent with the CLAUDE.md science boundary.

**May:**

- Move, add, or remove a `lm` or `sm` ring **inside a declared window bbox and
  a declared interval**, where a named publication constrains the land–sea
  pattern there and then. The op records `rationale`, `spatialUncertaintyKm`,
  and `references[]` with DOI/URL, citation, year, what it constrains, and
  whether the constraint is the source's claim or our inference.
- Split a Cao interval's meaning by emitting **different geometry for different
  intervals**, so the Brent delta can advance in one and retreat in the next,
  rather than showing only the drowned end state.
- Record an edit whose only effect is an **epistemic label** — for example
  marking Adria's existing crust as a carbonate platform rather than
  depth-unknown shelf.
- Carry an edit whose sources **disagree**, provided the contract names the
  alternative and the map key shows the disagreement (Greater India's width;
  Pebas salinity; Turgai closure age).

**May not:**

- **Trace, digitise, or copy** any figure, map, plate, or coordinate from any
  publication in section 2 or 3. All of them are citation-only; the emitted
  geometry is derived from the Cao 2017 rings. Blakey / Deep Time Maps,
  the NGU Barents atlas and the Svalbard Geoscience Atlas additionally carry
  licences that forbid derivatives or redistribution.
- Ship an op **without at least one reference inside its window and interval**.
  The validator fails the build; this is a tested gate, not a convention.
- Assert precision finer than the evidence. Cao's own coastline tolerance is
  ~30 km at best and ~500 km at the search radius (§1.3); an edit finer than
  that needs its own cited basis, and `spatialUncertaintyKm` must reflect the
  publication, not the vertex spacing.
- Turn a **model output** into an observation. Backstructured palaeobathymetry
  [43], dynamic-topography seaway models [77], and plate-model-dependent
  microcontinent geometry [100][101] are model results; the chart's
  `evidence.status` stays `derived-from-published-source` with the editorial
  line "EarthHistory modification after &lt;refs&gt;", and the badge shows
  synthesis, never observation.
- Invent a class Cao does not have. A playa, sabkha, salt lake, or freshwater
  wetland is **not** `sm`. Where the literature says "endorheic" [34],
  "salt lake" [29], or "predominantly freshwater" [86], the honest edit is land
  plus a labelled limitation, not a shallow sea.
- Backdate a modern outline. Doggerland and Sunda come from ETOPO 2022 [125]
  clipped at a stated lowstand, with the label "no glacio-isostatic adjustment;
  ice sheets not drawn" — and GIA is the reason that label exists [65][66][67].
- Smooth across an interval boundary to hide a step. The steps are the
  evidence; the plan forbids cross-fade for this reason.

---

## References

All accessed 2026-09-15. **[unverified]** marks an item whose metadata could
not be confirmed at a publisher, catalogue, or DOI registry in this session.

**Cao 2017, its lineage, and the timescale**

1. Cao W., Zahirovic S., Flament N., Williams S., Golonka J., Müller R.D. 2017. Improving global paleogeography since the late Paleozoic using paleobiology. Biogeosciences 14, 5425–5439. https://doi.org/10.5194/bg-14-5425-2017 (CC BY 3.0)
2. Golonka J., Krobicki M., Pajak J., Giang N.V., Zuchiewicz W. 2006. Global Plate Tectonics and Paleogeography of Southeast Asia. AGH University of Science and Technology, Kraków. No DOI. **[unverified — cited only through [1]]**
3. Golonka J. 2000. Cambrian–Neogene Plate Tectonic Maps. Wydawnictwa Uniwersytetu Jagiellońskiego, Kraków, 125 pp. No DOI. **[unverified — cited only through [1]]**
4. Golonka J. 2007. Late Triassic and Early Jurassic palaeogeography of the world. Palaeogeography, Palaeoclimatology, Palaeoecology 244, 297–307. https://doi.org/10.1016/j.palaeo.2006.06.041
5. Kiessling W., Flügel E., Golonka J. 2003. Patterns of Phanerozoic carbonate platform sedimentation. Lethaia 36, 195–226. https://doi.org/10.1080/00241160310004648
6. Matthews K.J., Maloney K.T., Zahirovic S., Williams S.E., Seton M., Müller R.D. 2016. Global plate boundary evolution and kinematics since the late Paleozoic. Global and Planetary Change 146, 226–250. https://doi.org/10.1016/j.gloplacha.2016.10.002
7. Müller R.D. et al. 2016. Ocean basin evolution and global-scale plate reorganization events since Pangea breakup. Annual Review of Earth and Planetary Sciences 44, 107–138. https://doi.org/10.1146/annurev-earth-060115-012211
8. Domeier M., Torsvik T.H. 2014. Plate tectonics in the late Paleozoic. Geoscience Frontiers 5, 303–350. https://doi.org/10.1016/j.gsf.2014.01.002
9. Wright N., Zahirovic S., Müller R.D., Seton M. 2013. Towards community-driven paleogeographic reconstructions. Biogeosciences 10, 1529–1541. https://doi.org/10.5194/bg-10-1529-2013
10. Heine C., Yeo L.G., Müller R.D. 2015. Evaluating global paleoshoreline models for the Cretaceous and Cenozoic. Australian Journal of Earth Sciences 62, 275–287. https://doi.org/10.1080/08120099.2015.1018321
11. Cao X. et al. 2024. Earth's tectonic and plate boundary evolution over 1.8 billion years. Geoscience Frontiers 15, 101922. https://doi.org/10.1016/j.gsf.2024.101922 — dataset v2.4 https://doi.org/10.5281/zenodo.13628813 (CC BY 4.0)
12. Cohen K.M., Finney S.C., Gibbard P.L., Fan J.-X. (eds). International Chronostratigraphic Chart v2024/12. International Commission on Stratigraphy. https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf
13. Scotese C.R., Wright N.M. 2018. PALEOMAP Paleodigital Elevation Models (PaleoDEMs) for the Phanerozoic. https://doi.org/10.5281/zenodo.5460860 (cross-check only; not the geography authority)

**North Sea: regional syntheses and atlases**

14. Ziegler P.A. (ed.) 1990. Geological Atlas of Western and Central Europe, 2nd (revised) edn. Shell Internationale Petroleum Mij. / Geological Society, London, 239 pp. + 56 maps. ISBN 90-6644-125-9. No DOI. Verified bibliographically via a DOI-registered review (Larminie 1992, https://doi.org/10.2307/3060311). **Caution: the widely scanned Internet Archive copy is the 1982 1st edition, 130 pp., ISBN 0-444-42084-3.**
15. Cope J.C.W., Ingham J.K., Rawson P.F. (eds) 1992. Atlas of Palaeogeography and Lithofacies. Geological Society, London, Memoirs 13, xi + 155 pp. https://doi.org/10.1144/GSL.MEM.1992.013 (Crossref record is an issue-level stub with an empty title and a mis-pointed resource URL; year/volume/publisher confirmed)
16. Evans D., Graham C., Armour A., Bathurst P. (eds) 2003. The Millennium Atlas: Petroleum Geology of the Central and Northern North Sea. Geological Society of London, 389 pp. ISBN 1-86239-119-X. No DOI. Confirmed via the DOI-registered review https://doi.org/10.1017/S0016756803218124
17. Coward M.P., Dewey J.F., Hempton M., Holroyd J. 2003. Tectonic evolution. In: [16], 17–33. No chapter DOI. **[page range from independent citing reference lists; publisher TOC not opened]**
18. Glennie K.W. (ed.) 1998. Petroleum Geology of the North Sea: Basic Concepts and Recent Advances, 4th edn. Blackwell Science, Oxford, xvi + 636 pp. https://doi.org/10.1002/9781444313413 — **there is no 2009 edition; 2009 is only the Wiley Online Library posting year.**
19. Torsvik T.H., Cocks L.R.M. 2017. Earth History and Palaeogeography. Cambridge University Press, x + 317 pp. https://doi.org/10.1017/9781316225523 (CUP online 2016-10-31; print 2017)

**North Sea: Devonian and Carboniferous**

20. Marshall J.E.A., Hewett A.J. 2003. Devonian. In: [16], 65–81. No DOI. **[pages from citing lists only]**
21. Trewin N.H., Thirlwall M.F. 2002. Old Red Sandstone. In: Trewin N.H. (ed.) The Geology of Scotland, 4th edn. Geological Society, London, 213–249. ISBN 1-86239-126-2. **[unverified — GeoScienceWorld 403]**
22. Andrews S.D., Hartley A.J. 2015. The response of lake margin sedimentary systems to climatically driven lake level fluctuations: Middle Devonian, Orcadian Basin, Scotland. Sedimentology 62, 1693–1716. https://doi.org/10.1111/sed.12200 — **note: Sedimentology, not Marine and Petroleum Geology.**
23. Marshall J.E.A., Rogers D.A., Whiteley M.J. 1996. Devonian marine incursions into the Orcadian Basin, Scotland. Journal of the Geological Society 153, 451–466. https://doi.org/10.1144/gsjgs.153.3.0451
24. Bruce D.R.S., Stemmerik L. 2003. Carboniferous. In: [16], 83–89. No DOI. Verified via the GEUS publication record https://pub.geus.dk/en/publications/carboniferous/
25. Collinson J.D. 2005. Dinantian and Namurian depositional systems in the southern North Sea. In: Collinson J.D. et al. (eds) Carboniferous Hydrocarbon Geology, Yorkshire Geological Society Occasional Publications 7, 35–56. No DOI; full text reproduced on BGS Earthwise.
26. Collinson J.D., Jones C.M., Blackbourn G.A., Besly B.M., Archard G.M., McMahon A.H. 1993. Carboniferous depositional systems of the Southern North Sea. Petroleum Geology Conference Series 4, 677–687. https://doi.org/10.1144/0040677
27. Kombrink H. et al. 2010. Carboniferous. In: Doornenbal J.C., Stevenson A.G. (eds) Petroleum Geological Atlas of the Southern Permian Basin Area. EAGE, Houten, 81–99. No chapter DOI. **[author list confirmed via Kombrink's 2008 thesis; pages from citing lists]**

**North Sea: Permian**

28. Doornenbal J.C., Stevenson A.G. (eds) 2010. Petroleum Geological Atlas of the Southern Permian Basin Area. EAGE Publications, Houten, 342 pp. ISBN 978-90-73781-61-0. No DOI. Verified via the NERC Open Research Archive record.
29. Glennie K.W. 1972. Permian Rotliegendes of Northwest Europe interpreted in light of modern desert sedimentation studies. AAPG Bulletin 56, 1048–1071. https://doi.org/10.1306/819A40AE-16C5-11D7-8645000102C1865D
30. Gast R. et al. 2010. Rotliegend. In: [28], 101–121. No chapter DOI. **[unverified at chapter level]**
31. Tucker M.E. 1991. Sequence stratigraphy of carbonate-evaporite basins: models and application to the Upper Permian (Zechstein) of northeast England and adjoining North Sea. Journal of the Geological Society 148, 1019–1036. https://doi.org/10.1144/gsjgs.148.6.1019
32. Peryt T.M., Geluk M.C., Mathiesen A., Paul J., Smith K. 2010. Zechstein. In: [28], 123–147. No chapter DOI. **[chapter authorship/pages from ResearchGate and citing lists; book verified]**

**North Sea: Triassic and Jurassic**

33. Goldsmith P.J., Hudson G., Van Veen P. 2003. Triassic. In: [16], 105–127. No DOI. **[page range disputed: 105–127 vs 105–128]**
34. McKie T., Williams B. 2009. Triassic palaeogeography and fluvial dispersal across the northwest European Basins. Geological Journal 44, 711–741. https://doi.org/10.1002/gj.1201 — **note: Geological Journal, not Marine and Petroleum Geology 26.**
35. Underhill J.R., Partington M.A. 1993. Jurassic thermal doming and deflation in the North Sea: implications of the sequence stratigraphic evidence. Petroleum Geology Conference Series 4, 337–345. https://doi.org/10.1144/0040337
36. Helland-Hansen W., Ashton M., Lømo L., Steel R. 1992. Advance and retreat of the Brent delta: recent contributions to the depositional model. In: Morton A.C., Haszeldine R.S., Giles M.R., Brown S. (eds) Geology of the Brent Group, Geological Society, London, Special Publications 61, 109–127. https://doi.org/10.1144/GSL.SP.1992.061.01.07
37. Fjellanger E., Olsen T.R., Rubino J.L. 1996. Sequence stratigraphy and palaeogeography of the Middle Jurassic Brent and Vestland deltaic systems, Northern North Sea. Norsk Geologisk Tidsskrift 76, 75–106. https://njg.geologi.no/images/NJG_articles/NGT_76_2_075-106.pdf — **note the authors: Fjellanger, Olsen & Rubino.**
38. Husmo T., Hamar G.P., Høiland O., Johannessen E.P., Rømuld A., Spencer A.M., Titterton R. 2003. Lower and Middle Jurassic. In: [16], 129–155. No DOI. **[pages 129–155 vs 129–156 and year 2003 vs 2002 both circulate; not adjudicated]**
39. Fraser S.I., Robinson A.M., Johnson H.D., Underhill J.R., Kadolsky D.G.A., Connell R., Johannessen P., Ravnås R. 2003. Upper Jurassic. In: [16], 157–189. No DOI. Verified via https://pub.geus.dk/en/publications/upper-jurassic/
40. Tyson R.V. 2004. Variation in marine total organic carbon through the type Kimmeridge Clay Formation (Late Jurassic), Dorset, UK. Journal of the Geological Society 161, 667–673. https://doi.org/10.1144/0016-764903-078
41. Morgans-Bell H.S., Coe A.L., Hesselbo S.P., Jenkyns H.C., Weedon G.P., Marshall J.E.A., Tyson R.V., Williams C.J. 2001. Integrated stratigraphy of the Kimmeridge Clay Formation (Upper Jurassic), south Dorset, UK. Geological Magazine 138, 511–539. https://doi.org/10.1017/S0016756801005738

**North Sea: Cretaceous**

42. Rawson P.F., Riley L.A. 1982. Latest Jurassic–Early Cretaceous events and the "Late Cimmerian Unconformity" in North Sea area. AAPG Bulletin 66, 2628–2648. https://doi.org/10.1306/03B5AC87-16D1-11D7-8645000102C1865D
43. Roberts A.M., Kusznir N.J., Yielding G., Beeley H. 2019. Mapping the bathymetric evolution of the Northern North Sea: from Jurassic synrift archipelago through Cretaceous–Tertiary post-rift subsidence. Petroleum Geoscience 25, 306–321. https://doi.org/10.1144/petgeo2018-066 (CC BY 3.0)
44. Copestake P., Sims A.P., Crittenden S., Hamar G.P., Ineson J.R., Rose P.T., Tringham M.E. 2003. Lower Cretaceous. In: [16], 191–211. No DOI. **[last author initial appears as both M.E. and M.F.]**
45. Surlyk F., Dons T., Clausen C.K., Higham J. 2003. Upper Cretaceous. In: [16], 213–233. No DOI.
46. Esmerode E.V., Lykke-Andersen H., Surlyk F. 2008. Interaction between bottom currents and slope failure in the Late Cretaceous of the southern Danish Central Graben. Journal of the Geological Society 165, 55–72. https://doi.org/10.1144/0016-76492006-138
47. Thibault N., Harlou R., Schovsbo N.H., Stemmerik L., Surlyk F. 2016. Late Cretaceous sea-surface temperature record of the Boreal Chalk Sea. Climate of the Past 12, 429–438. https://doi.org/10.5194/cp-12-429-2016
48. Mortimore R.N. 2018. Late Cretaceous tectono-sedimentary events in NW Europe. Proceedings of the Geologists' Association 129, 392–420. https://doi.org/10.1016/j.pgeola.2017.12.004
49. Hancock J.M. 1975. The petrology of the Chalk. Proceedings of the Geologists' Association 86, 499–535. https://doi.org/10.1016/S0016-7878(75)80061-7 **[metadata only; no abstract deposited anywhere — do not quote]**

**North Sea: Palaeogene and Neogene**

50. Ahmadi Z.M., Sawyers M., Kenyon-Roberts S., Stanworth C.W., Kugler K.A., Kristensen J., Fugelli E.M.G. 2003. Paleocene. In: [16], 235–259. No DOI.
51. Jones S.M., White N., Lovell B. 2001. Cenozoic and Cretaceous transient uplift in the Porcupine Basin and its relationship to a mantle plume. Geological Society, London, Special Publications 188, 345–360. https://doi.org/10.1144/GSL.SP.2001.188.01.20 — see also Jones S.M., White N., Clarke B.J., Rowley E., Gallagher K. 2002, GSL SP 196, 13–25, https://doi.org/10.1144/GSL.SP.2002.196.01.02
52. Anell I., Thybo H., Rasmussen E.S. 2012. A synthesis of Cenozoic sedimentation in the North Sea. Basin Research 24, 154–179. https://doi.org/10.1111/j.1365-2117.2011.00517.x — **distinct from Anell, Thybo & Artemieva 2009, Tectonophysics 474, 78–105, https://doi.org/10.1016/j.tecto.2009.04.006**
53. Gemmer L., Huuse M., Clausen O.R., Nielsen S.B. 2002. Mid-Palaeocene palaeogeography of the eastern North Sea basin. Basin Research 14, 329–346. https://doi.org/10.1046/j.1365-2117.2002.00182.x
54. Jones E., Jones R., Ebdon C., Ewen D., Milner P., Plunkett J., Hudson G., Slater G. 2003. Eocene. In: [16], 261–277. No DOI.
55. Heritier F.E., Lossel P., Wathne E. 1979. Frigg Field — large submarine-fan trap in Lower Eocene rocks of the North Sea Viking Graben. AAPG Bulletin 63, 1999–2020. https://doi.org/10.1306/2F918856-16CE-11D7-8645000102C1865D
56. Huuse M. 2002. Late Cenozoic palaeogeography of the eastern North Sea Basin: climatic vs tectonic forcing of basin margin uplift and deltaic progradation. Bulletin of the Geological Society of Denmark 49, 145–170. https://doi.org/10.37570/bgsd-2003-49-12
57. Rasmussen E.S., Dybkjær K., Piasecki S. 2010. Lithostratigraphy of the Upper Oligocene–Miocene succession of Denmark. GEUS Bulletin 22, 1–92. https://doi.org/10.34194/geusb.v22.4733 (CC BY 4.0)
58. Overeem I., Weltje G.J., Bishop-Kay C., Kroonenberg S.B. 2001. The Late Cenozoic Eridanos delta system in the Southern North Sea Basin. Basin Research 13, 293–312. https://doi.org/10.1046/j.1365-2117.2001.00151.x
59. Gibbard P.L., Lewin J. 2016. Filling the North Sea Basin: Cenozoic sediment sources and river styles. Geologica Belgica 19, 201–217. https://doi.org/10.20341/gb.2015.017
— also Knox R.W.O'B., Holloway S. 1992. Paleogene of the Central and Northern North Sea. In: Knox & Cordey (eds) Lithostratigraphic Nomenclature of the UK North Sea. British Geological Survey, 133 pp. No DOI. **[bibliographic identity only]**; Mudge D.C., Bujak J.P. 1994, Marine and Petroleum Geology 11, 166–181, https://doi.org/10.1016/0264-8172(94)90093-0 **[metadata only]**

**Doggerland, LGM and glacial isostatic adjustment**

60. Clark P.U., Dyke A.S., Shakun J.D., Carlson A.E., Clark J., Wohlfarth B., Mitrovica J.X., Hostetler S.W., McCabe A.M. 2009. The Last Glacial Maximum. Science 325, 710–714. https://doi.org/10.1126/science.1172873
61. Lambeck K., Rouby H., Purcell A., Sun Y., Sambridge M. 2014. Sea level and global ice volumes from the Last Glacial Maximum to the Holocene. PNAS 111, 15296–15303. https://doi.org/10.1073/pnas.1411762111
62. Coles B.J. 1998. Doggerland: a speculative survey. Proceedings of the Prehistoric Society 64, 45–81. https://doi.org/10.1017/S0079497X00002176
63. Gaffney V., Fitch S., Smith D. 2009. Europe's Lost World: the Rediscovery of Doggerland. CBA Research Report 160, Council for British Archaeology, York, xxi + 202 pp. ISBN 978-1-902771-77-9. No DOI, no open-access copy found. **[two conflicting ISBNs circulate in published reviews: 978-1-902771-77-9 and 978-1-902771-75-5]**
64. Sturt F., Garrow D., Bradley S. 2013. New models of North West European Holocene palaeogeography and inundation. Journal of Archaeological Science 40, 3963–3976. https://doi.org/10.1016/j.jas.2013.05.023 (CC BY)
65. Bradley S.L., Milne G.A., Shennan I., Edwards R. 2011. An improved glacial isostatic adjustment model for the British Isles. Journal of Quaternary Science 26, 541–552. https://doi.org/10.1002/jqs.1481
66. Bradley S.L., Ely J.C., Clark C.D., Edwards R.J., Shennan I. 2023. Reconstruction of the palaeo-sea level of Britain and Ireland arising from empirical constraints of ice extent. Journal of Quaternary Science 38, 791–805. https://doi.org/10.1002/jqs.3523 (CC BY)
67. Shennan I., Bradley S.L., Edwards R. 2018. Relative sea-level changes and crustal movements in Britain and Ireland since the Last Glacial Maximum. Quaternary Science Reviews 188, 143–159. https://doi.org/10.1016/j.quascirev.2018.03.031
— also Hijma M.P., Cohen K.M. 2010, Geology 38, 275–278, https://doi.org/10.1130/g30439.1 (**not** 10.1130/G30651.1, which does not resolve); Hijma M.P., Cohen K.M. 2019, Quaternary Science Reviews 214, 68–86, https://doi.org/10.1016/j.quascirev.2019.05.001 with corrigendum https://doi.org/10.1016/j.quascirev.2019.105941

**Western Interior Seaway**

68. Roberts L.N.R., Kirschbaum M.A. 1995. Paleogeography of the Late Cretaceous of the Western Interior of Middle North America — Coal Distribution and Sediment Accumulation. USGS Professional Paper 1561, 115 pp. https://doi.org/10.3133/pp1561
69. Slattery J.S., Cobban W.A., McKinney K.C., Harries P.J., Sandness A.L. 2015. Early Cretaceous to Paleocene paleogeography of the Western Interior Seaway: the interaction of eustasy and tectonism. Wyoming Geological Association Guidebook, 68th Annual Field Conference, 22–60. No Crossref DOI. **[metadata only; full text not retrieved. The DataCite/ResearchGate deposit 10.13140/RG.2.1.4439.8801 carries a wrong year and publisher — do not cite it as the DOI.]**
70. Kauffman E.G. 1977. Geological and biological overview: Western Interior Cretaceous basin. The Mountain Geologist 14 (3–4), 75–99. No DOI. **[metadata verified via the RMAG cumulative index; text not retrieved]**
71. Kauffman E.G., Caldwell W.G.E. 1993. The Western Interior Basin in space and time. In: Caldwell & Kauffman (eds) Evolution of the Western Interior Basin, Geological Association of Canada Special Paper 39, 1–30. ISBN 0-919216-52-8. No DOI. **[metadata only]**
72. Blakey R.C. Deep Time Maps™ palaeogeographic map series, Colorado Plateau Geosystems Inc. https://deeptimemaps.com/ — **commercial licence, reference-only: no posting, no tracing, no derivatives; required credit "© YYYY Colorado Plateau Geosystems Inc." The public licence pages currently 404.**

**West Siberian Sea and Turgai Strait**

73. Akhmetiev M.A., Beniamovski V.N. 2009. Paleogene floral assemblages around epicontinental seas and straits in Northern Central Eurasia. Geologica Acta 7 (1–2), 297–309. https://doi.org/10.1344/105.000000278
74. Akhmet'ev M.A. et al. 2010. Comparative analysis of marine Paleogene sections and biota from West Siberia and the Arctic Region. Stratigraphy and Geological Correlation 18, 635–659. https://doi.org/10.1134/S0869593810060043
75. Iakovleva A.I., Heilmann-Clausen C. 2010. Eocene dinoflagellate cyst biostratigraphy of borehole 011-BP, Omsk Region, southwestern Siberia. Palynology 34, 195–232. https://doi.org/10.1080/01916121003629974
76. Radionova E.P., Khokhlova I.E., Beniamovskii V.N., Shcherbinina E.A., Iakovleva A.I., Sadchikova T.A. 2001. Paleocene/Eocene transition in the northeastern Peri-Tethys area; Sokolovskii key section of the Turgay Passage. Bulletin de la Société Géologique de France 172, 245–256. https://doi.org/10.2113/172.2.245
77. Straume E.O., Steinberger B., Becker T.W., Faccenna C. 2024. Impact of mantle convection and dynamic topography on the Cenozoic paleogeography of Central Eurasia and the West Siberian Seaway. Earth and Planetary Science Letters 630, 118615. https://doi.org/10.1016/j.epsl.2024.118615 (CC BY)
78. Vinogradov A.P. (ed.) 1967–1969. Atlas of the Lithological-Paleogeographical Maps of the USSR, 1:7,500,000, 4 vols. GUGK/VSEGEI, Moscow. No DOI. **[editor, bilingual title and publisher verified; the volume→year→page mapping is unverified]** — also Akhmetiev M.A. et al. 2012, Austrian Journal of Earth Sciences 105 (1), 50–67, no DOI **[metadata only; note the journal is AJES, not Stratigraphy and Geological Correlation]**

**Paratethys**

79. Rögl F. 1998. Palaeogeographic considerations for Mediterranean and Paratethys seaways (Oligocene to Miocene). Annalen des Naturhistorischen Museums in Wien 99 A, 279–310. No DOI. http://verlag.nhm-wien.ac.at/pdfs/99A_279310_Roegl.pdf — **the title usually attached to "Rögl 1999" belongs to this 1998 paper.**
80. Rögl F. 1999. Mediterranean and Paratethys. Facts and hypotheses of an Oligocene to Miocene paleogeography (short overview). Geologica Carpathica 50, 339–349. No DOI; live publisher URLs now 404, use the Internet Archive copy. See also Rögl F. 1999, in Hominoid Evolution and Climatic Change in Europe, CUP, 8–22, https://doi.org/10.1017/CBO9780511542329.002
81. Palcu D.V., Patina I.S., Şandric I., Lazarev S., Vasiliev I., Stoica M., Krijgsman W. 2021. Late Miocene megalake regressions in Eurasia. Scientific Reports 11, 11471. https://doi.org/10.1038/s41598-021-91001-z
82. Palcu D.V., Krijgsman W. 2023. The dire straits of Paratethys: gateways to the anoxic giant of Eurasia. Geological Society, London, Special Publications 523, 111–139. https://doi.org/10.1144/SP523-2021-73
83. Popov S.V., Rögl F., Rozanov A.Y., Steininger F.F., Shcherba I.G., Kovac M. (eds) 2004. Lithological-Paleogeographic Maps of Paratethys: 10 Maps Late Eocene to Pliocene. Courier Forschungsinstitut Senckenberg 250, 46 pp. + 10 maps. ISBN 978-3-510-61370-0. No DOI. **["250" is the series volume, not a page count.]** — also Krijgsman W. et al. 2019, Earth-Science Reviews 188, 1–40, https://doi.org/10.1016/j.earscirev.2018.10.013 (CC BY)

**Pebas / Amazonia**

84. Hoorn C. et al. 2010. Amazonia through time: Andean uplift, climate change, landscape evolution, and biodiversity. Science 330, 927–931. https://doi.org/10.1126/science.1194585
85. Hoorn C. 1993. Marine incursions and the influence of Andean tectonics on the Miocene depositional history of northwestern Amazonia. Palaeogeography, Palaeoclimatology, Palaeoecology 105, 267–309. https://doi.org/10.1016/0031-0182(93)90087-Y
86. Wesselingh F.P., Räsänen M.E., Irion G., Vonhof H.B., Kaandorp R., Renema W., Romero Pittman L., Gingras M. 2002. Lake Pebas: a palaeoecological reconstruction of a Miocene, long-lived lake complex in western Amazonia. Cainozoic Research 1 (1–2), 35–81. No DOI. **[the publisher landing page's "35–68" is wrong; 35–81 is correct]** — see also Wesselingh F.P. et al. 2006, Scripta Geologica 133, 363–393 (six authors, including Gingras)
87. Jaramillo C. et al. 2017. Miocene flooding events of western Amazonia. Science Advances 3, e1601693. https://doi.org/10.1126/sciadv.1601693
88. Hernández R.M., Jordan T.E., Dalenz Farjat A., Echavarría L., Idleman B.D., Reynolds J.H. 2005. Age, distribution, tectonics, and eustatic controls of the Paranense and Caribbean marine transgressions in southern Bolivia and Argentina. Journal of South American Earth Sciences 19, 495–512. https://doi.org/10.1016/j.jsames.2005.06.007

**Sundaland**

89. Hall R. 2002. Cenozoic geological and plate tectonic evolution of SE Asia and the SW Pacific. Journal of Asian Earth Sciences 20, 353–431. https://doi.org/10.1016/S1367-9120(01)00069-4
90. Hall R. 2012. Late Jurassic–Cenozoic reconstructions of the Indonesian region and the Indian Ocean. Tectonophysics 570–571, 1–41. https://doi.org/10.1016/j.tecto.2012.04.021
91. Hall R. 2013. The palaeogeography of Sundaland and Wallacea since the Late Jurassic. Journal of Limnology 72 (s2), e1, 1–17. https://doi.org/10.4081/jlimnol.2013.s2.e1
92. Sathiamurthy E., Voris H.K. 2006. Maps of Holocene sea level transgression and submerged lakes on the Sunda Shelf. The Natural History Journal of Chulalongkorn University, Supplement 2, 1–43. Successor-journal DOI https://doi.org/10.58837/tnh.6.2.102930
93. Voris H.K. 2000. Maps of Pleistocene sea levels in Southeast Asia: shorelines, river systems and time durations. Journal of Biogeography 27, 1153–1167. https://doi.org/10.1046/j.1365-2699.2000.00489.x

**Barents shelf**

94. Smelror M., Petrov O.V., Larssen G.B., Werner S. (eds) 2009. Atlas: Geological History of the Barents Sea. Geological Survey of Norway, Trondheim, 135 pp. ISBN 978-82-7385-137-6. No DOI. **Map series spans Early Devonian to Eocene only; the nb.no digitisation is viewable but copyrighted, not redistributable.**
95. Worsley D. 2008. The post-Caledonian development of Svalbard and the western Barents Sea. Polar Research 27, 298–317. https://doi.org/10.1111/j.1751-8369.2008.00085.x
96. Henriksen E. et al. 2011. Tectonostratigraphy of the greater Barents Sea. Geological Society, London, Memoirs 35, 163–195. https://doi.org/10.1144/M35.10 — and Uplift and erosion of the greater Barents Sea, Memoirs 35, 271–281, https://doi.org/10.1144/M35.17
97. Glørstad-Clark E., Faleide J.I., Lundschien B.A., Nystuen J.P. 2010. Triassic seismic sequence stratigraphy and paleogeography of the western Barents Sea area. Marine and Petroleum Geology 27, 1448–1475. https://doi.org/10.1016/j.marpetgeo.2010.02.008 **[metadata only; abstract elided by the publisher]**
98. Dallmann W.K. (ed.) 2015. Geoscience Atlas of Svalbard. Norsk Polarinstitutt Rapportserie 148, 292 pp. ISBN 978-82-7666-312-9. https://hdl.handle.net/11250/2580810 — **CC BY-NC-ND 4.0: no derivatives.**

**Greater India / Tethyan Himalaya**

99. Gibbons A.D., Zahirovic S., Müller R.D., Whittaker J.M., Yatheesh V. 2015. A tectonic model reconciling evidence for the collisions between India, Eurasia and intra-oceanic arcs of the central-eastern Tethys. Gondwana Research 28, 451–492. https://doi.org/10.1016/j.gr.2015.01.001
100. van Hinsbergen D.J.J., Lippert P.C., Dupont-Nivet G., McQuarrie N., Doubrovine P.V., Spakman W., Torsvik T.H. 2012. Greater India Basin hypothesis and a two-stage Cenozoic collision between India and Asia. PNAS 109, 7659–7664. https://doi.org/10.1073/pnas.1117262109
101. van Hinsbergen D.J.J., Lippert P.C., Li S., Huang W., Advokaat E.L., Spakman W. 2019. Reconstructing Greater India: paleogeographic, kinematic, and geodynamic perspectives. Tectonophysics 760, 69–94. https://doi.org/10.1016/j.tecto.2018.04.006
102. Hu X., Garzanti E., Wang J., Huang W., An W., Webb A. 2016. The timing of India-Asia collision onset — facts, theories, controversies. Earth-Science Reviews 160, 264–299. https://doi.org/10.1016/j.earscirev.2016.07.014
103. DeCelles P.G., Kapp P., Gehrels G.E., Ding L. 2014. Paleocene–Eocene foreland basin evolution in the Himalaya of southern Tibet and Nepal. Tectonics 33, 824–849. https://doi.org/10.1002/2014TC003522 **[metadata only]**

**Adria**

104. Schmid S.M., Fügenschuh B., Kissling E., Schuster R. 2004. Tectonic map and overall architecture of the Alpine orogen. Eclogae Geologicae Helvetiae 97, 93–117. https://doi.org/10.1007/s00015-004-1113-x
105. Schmid S.M., Bernoulli D., Fügenschuh B., Matenco L., Schefer S., Schuster R., Tischler M., Ustaszewski K. 2008. The Alpine-Carpathian-Dinaridic orogenic system. Swiss Journal of Geosciences 101, 139–183. https://doi.org/10.1007/s00015-008-1247-3 — **van Hinsbergen is not an author of this paper.**
106. Schmid S.M. et al. 2020. Tectonic units of the Alpine collision zone between Eastern Alps and western Turkey. Gondwana Research 78, 308–374. https://doi.org/10.1016/j.gr.2019.07.005
107. van Hinsbergen D.J.J., Torsvik T.H., Schmid S.M., Maţenco L.C., Maffione M., Vissers R.L.M., Gürer D., Spakman W. 2020. Orogenic architecture of the Mediterranean region and kinematic reconstruction of its tectonic evolution since the Triassic. Gondwana Research 81, 79–229. https://doi.org/10.1016/j.gr.2019.07.009 (CC BY)
108. Vlahović I., Tišljar J., Velić I., Matičec D. 2005. Evolution of the Adriatic Carbonate Platform. Palaeogeography, Palaeoclimatology, Palaeoecology 220, 333–360. https://doi.org/10.1016/j.palaeo.2005.01.011 — **the frequently circulated DOI 10.1016/j.palaeo.2005.03.011 is a different paper.**

**Hudson Bay and Arctic seaways**

109. Lavoie D. et al. 2013. Geological framework, basin evolution, hydrocarbon system data and conceptual hydrocarbon plays for the Hudson Bay and Foxe basins, Canadian Arctic. Geological Survey of Canada Open File 7363, 210 pp. https://doi.org/10.4095/293119 (Open Government Licence – Canada)
110. Pinet N., Lavoie D., Dietrich J., Hu K., Keating P. 2013. Architecture and subsidence history of the intracratonic Hudson Bay Basin. Earth-Science Reviews 125, 1–23. https://doi.org/10.1016/j.earscirev.2013.05.010 — **Pinet is first author; there is no Lavoie-first ESR paper on this basin.**
111. Pinet N., Lavoie D., Keating P. 2013. Did the Hudson Strait in Arctic Canada record the opening of the Labrador Sea? Marine and Petroleum Geology 48, 354–365. https://doi.org/10.1016/j.marpetgeo.2013.08.002
112. Lavoie D., Pinet N., Dietrich J., Chen Z. 2015. The Paleozoic Hudson Bay Basin in northern Canada. AAPG Bulletin 99, 859–888. https://doi.org/10.1306/12161414060
113. Armstrong D.K., Nicolas M.P.B., Hahn K.E., Lavoie D. 2018. Stratigraphic synthesis of the Hudson Platform in Manitoba, Ontario and Nunavut: Ordovician–Silurian. Geological Survey of Canada Open File 8378, 48 pp. https://doi.org/10.4095/308418
114. Sanford B.V., Grant A.C. 1998. Paleozoic and Mesozoic geology of the Hudson and southeast Arctic platforms. Geological Survey of Canada Open File 3595, sheets 1 and 2. https://doi.org/10.4095/210108 **[a map product — do not cite a page count]**
115. White T.S., Witzke B.J., Ludvigson G.A. 2000. Evidence for an Albian Hudson arm connection between the Cretaceous Western Interior Seaway of North America and the Labrador Sea. GSA Bulletin 112, 1342–1355. https://doi.org/10.1130/0016-7606(2000)112&lt;1342:EFAAHA&gt;2.0.CO;2
116. Williams G.D., Stelck C.R. 1975. Speculations on the Cretaceous palaeogeography of North America. Geological Association of Canada Special Paper 13, 1–20. No DOI. **[unverified at source; known through the verbatim quotation in [115]]**
117. Embry A., Beauchamp B. 2019. Sverdrup Basin. In: Miall A.D. (ed.) The Sedimentary Basins of the United States and Canada, 2nd edn. Elsevier, 559–592. https://doi.org/10.1016/B978-0-444-63895-3.00014-0 — see also Embry et al. 2023, Geological Society, London, Memoirs 57, 979–989, https://doi.org/10.1144/M57-2017-11

**Tethys margins: Arabia and North/Central Africa**

118. Ziegler M.A. 2001. Late Permian to Holocene paleofacies evolution of the Arabian Plate and its hydrocarbon occurrences. GeoArabia 6, 445–504. https://doi.org/10.2113/geoarabia0603445
119. Sharland P.R., Archer R., Casey D.M., Davies R.B., Hall S.H., Heward A.P., Horbury A.D., Simmons M.D. 2001. Arabian Plate Sequence Stratigraphy. GeoArabia Special Publication 2, 371 pp. https://doi.org/10.2113/9781733475716 **[the print ISBN could not be confirmed; do not cite one]**
120. Sharland P.R., Casey D.M., Davies R.B., Simmons M.D., Sutcliffe O.E. 2004. Arabian Plate Sequence Stratigraphy — revisions to SP2. GeoArabia 9, 199–214. https://doi.org/10.2113/geoarabia0901199
121. Guiraud R., Bosworth W., Thierry J., Delplanque A. 2005. Phanerozoic geological evolution of Northern and Central Africa: an overview. Journal of African Earth Sciences 43, 83–143. https://doi.org/10.1016/j.jafrearsci.2005.07.017 — **the frequently circulated DOI 10.1016/j.jafrearsci.2005.07.007 is Catuneanu et al. on the Karoo basins.**
122. Haq B.U., Al-Qahtani A.M. 2005. Phanerozoic cycles of sea-level change on the Arabian Platform. GeoArabia 10, 127–160. https://doi.org/10.2113/geoarabia1002127
123. Adamu L.M., Obaje N.G., Adeoye J.A., Oladimeji R.G., Yusuf I. 2024. Trans-Saharan seaway connection between the South Atlantic and the Tethys Sea during the Coniacian–Turonian. Geosystems and Geoenvironment 3, 100243. https://doi.org/10.1016/j.geogeo.2023.100243
124. Lüning S., Craig J., Loydell D.K., Štorch P., Fitches B. 2000. Lower Silurian "hot shales" in North Africa and Arabia. Earth-Science Reviews 49, 121–200. https://doi.org/10.1016/S0012-8252(99)00060-4 — also Konert G. et al. 2001, GeoArabia 6, 407–442, https://doi.org/10.2113/geoarabia0603407

**Elevation model for the lowstand phase**

125. NOAA National Centers for Environmental Information 2022. ETOPO 2022 15 Arc-Second Global Relief Model. https://doi.org/10.25921/fd45-gt74 — "Not to be used for navigation." US Government work; the CC0/public-domain statement was read from a rendered ISO metadata view and **should be confirmed against the raw metadata record before it becomes an acceptance criterion.**

---

## Explicit gaps

Items this pass could **not** verify at source, or verified only partially.
Each is flagged in place above.

- **Millennium Atlas chapter text.** None of [17], [20], [33], [38], [44],
  [45], [50], [54] could be opened; page ranges rest on independent citing
  reference lists. Two live discrepancies: Husmo et al. 129–155 vs 129–156 and
  2003 vs 2002; Goldsmith et al. 105–127 vs 105–128.
- **Southern Permian Basin Atlas chapters** [27], [30], [32]: the book [28] is
  verified, the chapters are not.
- **Ziegler 1990** [14]: existence and edition verified through a
  DOI-registered review; no palaeogeographic text was retrieved, and the
  commonly scanned copy is the 1982 first edition.
- **Trewin & Thirlwall 2002** [21]: GeoScienceWorld 403, not verified.
- **Late Cretaceous flooding extent of the NW European platform**, and whether
  the Fennoscandian Shield or Scottish/Irish landmasses stayed emergent: **no
  quotable source found.** The retrievable substitutes are [46]
  ("deep epicontinental sea") and [43] (emergent footwall islands, northern
  North Sea only). An edit to interval 17 or 18 needs a better source first.
- **Forties/Sele/Balder provenance from a Scotland–Shetland uplift**: no
  primary quotable sentence retrieved; [52] ("the Shetland Platform supplied
  sediment continuously") is the closest verified support.
- **Hancock 1975** [49], **Mudge & Bujak 1994**, **Glørstad-Clark et al. 2010**
  [97], **DeCelles et al. 2014** [103], **Guiraud et al. 2005** [121],
  **Lüning et al. 2000** [124], **Vlahović et al. 2005** [108],
  **Pinet et al. 2013 (ESR)** [110], **Sant et al. 2017**: metadata verified,
  abstracts elided or paywalled — do not attribute wording to them.
- **Slattery et al. 2015** [69], **Kauffman 1977** [70], **Kauffman & Caldwell
  1993** [71]: metadata only; no numeric WIS age in section 3 is attributable
  verbatim to them. The 4,800 × 1,620 km figure is from [68], which was read
  in full.
- **Vinogradov atlas** [78]: editor and publisher verified; the
  volume-to-year-to-page mapping is not.
- **Gaffney et al. 2009** [63]: no open-access copy found; two conflicting
  ISBNs circulate in published reviews.
- **ETOPO 2022 licence statement** [125]: confirm against raw ISO metadata
  before relying on it.
