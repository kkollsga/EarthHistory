# Palaeocene–Eocene Shetland: was the East Shetland Platform land?

Targeted literature record for the `codex/palaeo-coastlines` program. It asks
one question the two existing Palaeogene operations in
`data/corrections/palaeo-coastlines/basins/north-sea.json` answer only by
assumption: during the Thanetian–Priabonian (~59–34 Ma; Cao et al. (2017) map
intervals **58–49** and **49–37**), which parts of the Shetland region were
emergent land, which were submerged shallow shelf, and which alternated?

Compiled 2026-09-15; all web sources accessed 2026-09-15. Companion to
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say, basin-wide), [palaeo-coastlines-north-sea-edits.md](palaeo-coastlines-north-sea-edits.md)
(what the contract does), and [palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md)
(what the source is). It is a literature record, not an implementation claim:
nothing here changes a polygon until a contract operation cites it and the
validator passes.

## Conventions and rights

Same house style as [palaeo-coastlines-literature.md](palaeo-coastlines-literature.md):

- **Verbatim** — quoted from text actually retrieved this session (open PDF,
  publisher-deposited abstract in Crossref/OpenAlex/Semantic Scholar, or an
  official public database page).
- **Snippet** — reported by a search-engine summary of a page that could not be
  opened here. Unverified until the full text is read.
- **Inference** — EarthHistory's own reading, arithmetic, or mapping onto the
  ICS scale or the Cao interval grid. Always marked.
- Ages in Ma on **ICS International Chronostratigraphic Chart v2024/12** [30]
  unless a source's own number is quoted.

**Rights.** Every entry below is **citation-only**. No map, figure, plate,
polygon, coordinate list, seismic horizon or table from any of these
publications is traced, digitised, copied or redistributed by EarthHistory.
Three of the decisive papers ([2], [3], [21]) are CC BY or CC BY-NC and were
read in full; that licence permits quotation with attribution, which is what
happens here, and it still does not license tracing their maps. The only
redistributed palaeogeographic geometry in this program remains Cao et al.
(2017), CC BY 3.0.

Publisher hosts that returned HTTP 403 to this worker: sciencedirect.com,
onlinelibrary.wiley.com, agupubs.onlinelibrary.wiley.com, lyellcollection.org,
pubs.geoscienceworld.org, mdpi.com (PDF endpoint), insu.hal.science. Crossref,
Unpaywall, Semantic Scholar, the Imperial College Spiral repository, the
Norwegian Offshore Directorate Factpages and the UK government asset store were
used instead. Every reference in section 6 records what was actually retrieved.

---

## 1. The geography this memo is about

Five areas, named as the question names them, with the present-day coordinates
this program uses as witnesses. **Inference** throughout — these are our
working definitions, not a source's.

| Area | Working extent (present-day) | Witness point |
|---|---|---|
| Scottish Highlands | mainland Scotland north of the Highland Boundary Fault | (−4.5, 57.3) |
| Moray Firth | inner (west of ~−1°E) and outer (−1°E…1°E), 57.3–58.6°N | (−1.5, 57.9) |
| Shetland Islands / Shetland Platform proper | the islands and their immediate shelf, ~−2.5°E…−0.5°E, 59.8–61.5°N | (−1.3, 60.3) |
| Orkney–Shetland Platform | the whole basement high from Orkney to north of Shetland, including its Atlantic-facing side | (−2.5, 59.5) |
| **East Shetland Platform (ESP) proper** | east of Shetland, west of the East Shetland Basin and Viking Graben, ~0°E…2°E, 59.5–61.5°N | **(0.5, 61)** — the point the contract currently leaves shallow |

**The ESP is the contested one.** The current contract draws land only west of
0.2°E in both Palaeogene intervals, so (0.5, 61) renders as shallow marine at
58–49 and 49–37.

### 1.1 A checkable coordinate anchor for the key evidence

The decisive subaerial-landscape evidence ([2][3][5]) is reported by UK block,
not by latitude and longitude. **Inference**, with the arithmetic shown so it
can be checked:

- UKCS quadrants are 1° of latitude by 1° of longitude, each divided into 30
  blocks of 10′ latitude by 12′ longitude, numbered 1–30 west-to-east then
  north-to-south (**Snippet** [34]).
- The Bentley field is block **9/3b** at **59°56′N, 1°34′E** (**Snippet** [33]).
  Block 9/3 under that grid is 59°50′–60°00′N, 1°24′–1°36′E, which contains that
  point exactly. Quadrant 9 is therefore 59°–60°N, 1°–2°E.
- The Bressay field spans blocks **3/27b, 3/28a, 3/28b, 9/2a, 9/3a**
  (**Snippet** [33]), so quadrant 3 is 60°–61°N, 1°–2°E and blocks 3/27–3/28 are
  its southernmost row: **59°50′–60°10′N, ~1°12′–1°36′E**.
- North Bressay is "c. 30 km north of the Bressay buried landscape"
  (**Verbatim** [3]), so ≈ **60.1°–60.4°N, ~1.2°–1.7°E**.

So the buried subaerial landscapes sit at roughly **1.2–1.7°E, 59.8–60.4°N** —
**east of the contract's current 0.2°E edge**, and about 70–130 km south of the
(0.5, 61) witness. That offset is the single most important number in this memo
and section 5 does not let it be forgotten.

---

## 2. Area by area

Columns: the state; the timing at stage level; the spatial uncertainty where a
source allows one; the status tag; the references.

### 2.1 East Shetland Platform proper — **alternating**, land then drowned

| Statement | Timing (ICS v2024/12) | Spatial uncertainty | Status | Refs |
|---|---|---|---|---|
| "The East Shetland Platform was uplifted and acted as a source area of sediment in the Palaeogene, with a palaeobathymetry of 800 m in the Viking Graben early in this period." | Palaeogene as a whole; wells "between 58°N and 62°N" | the study's own control is 12 wells spanning 4° of latitude, i.e. ~450 km | **Verbatim** (abstract) [8] | [8] |
| "The East Shetland Platform formed a regional high throughout the Mesozoic and Tertiary with only a thin Triassic to Recent succession preserved." | Mesozoic–Tertiary | none stated | **Verbatim** (abstract) [7] | [7] |
| A "c. 58–55 Ma" terrestrial landscape on the ESP "contains excellent evidence of meandering fluvial channels, some of which record avulsions, that terminate against a coastline to the east where deltaic landforms are identified"; total relief "c. 500 m"; rivers "up to c. 13 km long"; uncertainty in relief "c. ±20 m" | Thanetian–earliest Ypresian, 59.2–55 | rivers ≤13 km; the coastline is *inside* the MC3D-ESP2015M survey, whose eastern limit the paper does not state in degrees | **Verbatim** (full PDF) [3] | [3] |
| The Bressay landscape 30 km to the south: "these observations, combined with presence of coarse clastic material, interpreted beach ridges, and a large dendritic drainage network, indicate that this landscape formed subaerially"; "total cumulative uplift of ∼350 m"; "this terrestrial landscape formed in <3 Ma and was rapidly drowned" | 58–55 Ma on the authors' scale | the landscape is a 3D survey footprint, not a regional map | **Verbatim** (abstract) [2] | [2] |
| The same landscape is the trap for the Bentley and Bressay discoveries; relative sea-level fall let "a Late Palaeocene–Early Eocene coarsening-up deltaic system … initially prograde and offlap as part of a forced regressive wedge", followed by ">250 m" incision and "a dendritic incised valley network and a major, deep, low sinuosity channel" | late Thanetian–early Ypresian | incision depth >250 m stated; no plan-view extent retrieved | **Snippet** (no abstract deposited; publisher 403) [5] | [5] |
| Regional 3D mapping over ">60,000 km²" gives "palaeogeographic maps of multiple Palaeocene to Early Eocene units", "six unconformity-bounded units marked by prograding clinoforms of the Dornoch Formation, which are covered by backstepping sequences of the Beauly Member (Balder Formation)"; "a first-order control on erosion and sediment distribution promoted by the transiently and differentially uplifted topography of Shetland, … an anomalous erosive history in the Bressay High … where the Lower Dornoch Formation has been eroded and marked fluvial incision is observed" | Palaeocene–Early Eocene | 60,000 km² ≈ a 245 km square; "shorter-wavelength … variations in uplift than what is typically assumed for dynamic topography" | **Verbatim** (abstract) [4] | [4] |
| "The Dornoch Formation's lowstand topsets are interpreted as having a subaerial or transitional coastal plain origin, and coal beds or lignite traces are common throughout the Moray Group" | late Thanetian–earliest Ypresian | — | **Snippet** (search summary of the same paper's full text, which 403s here) [4] | [4] |
| **Then it drowns.** "The upper Balder mudstone oversteps the Beauly and Dornoch formations westwards on the East Shetland Platform"; "Early–Mid Eocene sea-level rise, coeval with North Atlantic opening, caused transgressive backfill of erosional relief and drape of the clastic wedge by tuffaceous marine mudstones of the Balder Formation" | earliest Ypresian, ~55.8–54 | none stated | **Snippet** (two search summaries; the underlying texts [11][12] 403) | [11][12] |
| **Middle Eocene: deltaic in the south, shelf over the rest.** A sand-prone Middle Eocene sequence in three cored boreholes on the ESP divides into "Lower Sand Unit, Main Sand Unit and Upper Claystone Unit. The Lower Sand Unit is of fluvio-deltaic origin, occurring on the southern part of the East Shetland Platform. The Main Sand Unit represents the subsequent transgression of the delta and comprises a set of highstand shelf systems tracts separated by glauconitic bands" | Lutetian–Bartonian | three boreholes; positions not retrieved | **Snippet** (no abstract deposited; publisher 403) [6] | [6] |

**Inference, decisive.** The ESP proper is not a single state across either Cao
interval. Within 58–49 it is emergent with rivers, incised valleys and a
coastline to its east for roughly 59–55 Ma, then transgressed by the Balder
Formation before the interval is half over. Within 49–37 it carries a
fluvio-deltaic system on its southern part and a glauconitic, highstand shelf
elsewhere. **Alternating**, with the emergent phase concentrated in the older
interval.

### 2.2 Shetland Islands / Shetland Platform proper — **emergent throughout**

| Statement | Timing | Spatial uncertainty | Status | Refs |
|---|---|---|---|---|
| The North Sea "was protected from Paleocene rifting on the NE Atlantic margin by the **Scotland–Shetland hinterland**"; "it was the combination of tectonic and thermal uplift of this clastic source area that contributed the large volumes of sand that accumulated in both these provinces" | Palaeocene–Early Eocene | none stated | **Verbatim** (abstract) [9] | [9] |
| "The Shetland Platform supplied sediment continuously, although at varying rates, until the latest Cenozoic" | Cenozoic | none stated | **Verbatim** (quoted in the companion memo from [26]) | [26] |
| "the transiently and differentially uplifted topography of Shetland" is the first-order control on Palaeocene erosion and sediment distribution | Palaeocene–Early Eocene | — | **Verbatim** (abstract) [4] | [4] |
| Grid Formation "sandstones were probably derived from the East Shetland Platform" | Middle–Late Eocene | — | **Verbatim** (official database) [23] | [23] |

**Inference.** A source area that is shedding sand is subaerial somewhere. The
Shetland Platform west of about 0°E is the only part of this region for which
no retrieved source reports marine cover at any point in the Palaeogene, so it
is the part that carries the "continuous supply" statement without strain. That
is the current contract's geometry, and it survives this review.

### 2.3 Orkney–Shetland Platform — **emergent, and eroding**

| Statement | Timing | Status | Refs |
|---|---|---|---|
| "Towards the end of the Paleocene and into the Eocene (57–54 Ma) the whole region was affected by the Iceland plume and continental break-up NW of the Faroe Islands… Consequently much of the area became emergent and **large volumes of sediment were removed from the Orkney-Shetland platform area**." | 57–54 Ma on the source's scale | **Verbatim** (BGS report PDF read in full) [27] | [27] |
| "During the Early Eocene rifting and volcanism waned. Under the influence of passive thermal subsidence shallow water sandstones and lignites were succeeded by finer-grained siltstones and shales of the Middle and Upper Eocene (50–35 Ma) as **fully marine conditions became re-established**." | 50–35 Ma on the source's scale | **Verbatim** [27] | [27] |

**Caution, our inference.** [27] is the DTI Strategic Environmental Assessment
area 4 report; SEA4 is the Atlantic-margin shelf and slope **west and north** of
Scotland and Shetland, not the North Sea side. Its "fully marine" statement
therefore constrains the Faroe–Shetland and Møre side, and is only supporting
context east of Shetland. Quoting it as if it mapped the ESP would be an error.

### 2.4 Moray Firth — **inner emergent and eroded, outer marine with a delta front**

| Statement | Timing | Spatial uncertainty | Status | Refs |
|---|---|---|---|---|
| "The Inner Moray Firth (IMF) experienced significant structural modification during Early Tertiary times… as well as **uplift and erosion at a mid-late Danian unconformity**"; "up to **1.5 km** of basin fill has been removed from the IMF"; apparent erosion "is at a maximum in the northwestern part of the basin… and **decreases to zero in the Outer Moray Firth**" | mid–late Danian onward, ~63–61 and after | erosion gradient given as a direction, not a line | **Verbatim** (abstract) [17] | [17] |
| "**Mid-Paleocene pulses of coarse sediment to the Moray Firth Basin coincided with major uplift.** This uplift was associated with major differential tectonics within the Highlands, with warping and faulting along the margins of the Minch and the inner Moray Firth Basins." | mid-Palaeocene, ~61–58 | — | **Verbatim** (abstract) [19] | [19] |
| The shelfal Palaeogene of the Central North Sea records "a period of Palaeogene net uplift, followed by tilting and sinking of the shelf-edge and basinal areas"; "**the area of uplift extended at least as far as the western limit of the Beauly Formation**"; "the attitude of coal or lignite beds within the shelfal areas" is the evidence | Palaeocene–earliest Eocene | the limit is named by a formation's edge, not by a coordinate | **Verbatim** (abstract) [14] | [14] |
| "the prograding Dornoch delta system in the north-west… is the most likely source for coarser grained siliciclastics… deposited into the Outer Moray Firth Basin"; pockmark structures sit "in a delta front and upper pro-deltaic slope position on the Dornoch delta in the Outer Moray Firth" | late Thanetian–earliest Ypresian | — | **Snippet** (search summary of [18], which 403s) | [18] |
| Palaeocene uplift "of the order of **375 m** in the Outer Moray Firth (central North Sea) increasing to **525 m** in the North Viking Graben", then "rapid Early Eocene subsidence… of the order of **160–310 m**" | Palaeocene then Early Eocene | model output from backstripping, not observation | **Verbatim** (abstract) [16] | [16] |

**Inference.** The Moray Firth is not one state either. The inner basin is
emergent and being stripped from the mid–late Danian; the outer basin carries
the Dornoch delta plain and its front, i.e. the shoreline crosses it. That is a
shoreline *within* the existing contract window, and it is the reason section 5
does not recommend adding a second land polygon here without a dedicated edit.

### 2.5 Scottish Highlands — **emergent land, the whole time**

| Statement | Timing | Status | Refs |
|---|---|---|---|
| "**In the Early Tertiary major uplift affected the Highlands**, with downwarping and block movements along basin margins, but levels of uplift and denudation around the Tertiary igneous centres cannot be extrapolated to other areas." | Early Tertiary | **Verbatim** (abstract) [20] | [20] |
| "post-Devonian erosion of basement has been < 1–2 km and… the main morphotectonic units of the Highlands were already established by the end of the Palaeozoic"; "After 50 Ma the Highland terrain evolved by dynamic etching" | 400 Ma to present; the etching statement is explicitly post-50 Ma | **Verbatim** (abstract) [20] | [20] |
| "the persistence of sediment source areas within the upland areas of Scotland makes it unlikely that basement highs were ever completely buried, and depths of post-Devonian erosion of basement have been correspondingly modest (< 1–2 km)" | Devonian to present | **Verbatim** (abstract) [19] | [19] |

**Inference.** No retrieved source puts sea over the Scottish Highlands at any
point in the Palaeogene. Cao already draws Scotland as land at both intervals
(**measured** in the companion memo's baseline table), so there is nothing to
edit. The Highlands enter this memo only as the western end of the source area.

---

## 3. Who sourced the sands

The companion memo records Forties/Sele/Balder provenance as an **open
question**: "no primary quotable sentence retrieved". Three of the four sand
systems can now be closed, one cannot.

| Sand system | Age | What the source says about provenance | Status | Refs |
|---|---|---|---|---|
| **Forties / Sele / Lista / Maureen** (central North Sea) | Thanetian–earliest Ypresian | The North Sea "was protected from Paleocene rifting on the NE Atlantic margin by the **Scotland–Shetland hinterland**… it was the combination of tectonic and thermal uplift of **this clastic source area** that contributed the large volumes of sand". So: the whole Scotland-plus-Shetland upland, not the ESP alone. | **Verbatim** (abstract) [9] | [9] |
| Forties Fan, timing of initiation | Thanetian–PETM | "there is no correlation between Forties Fan initiation and the PETM. **NE Atlantic margin basin flank uplift in response to synrift volcanism is indicated as the driving mechanism** behind Forties Fan inception"; "winterwet floodplain communities typify the coeval East Axial Fairway, whereas the dominance of swamp-derived communities in the West and Central Axial Fairway sediments reflects **source palaeogeography overriding the regional winterwet climate signal**" | **Verbatim** (abstract) [21] | [21] |
| Maureen Fm routing | Danian–Selandian | sandstones "were deposited in distinct western and eastern fairways controlled by the relict Mesozoic rift topography"; their extent "is similar to the overlying Sele and Lista formations and suggests that the broad controls on sediment routing were the same throughout the Lower Palaeogene" | **Verbatim** (abstract) [22] | [22] |
| **Frigg** (Lower Eocene submarine fan, Viking Graben) | Early Eocene | "The Frigg Formation was deposited as submarine fans, by gravity flows." / "**The source was the East Shetland Platform to the west.**" Distribution: "the southwestern part of quadrant 30, the northwestern part of quadrant 25, and in adjacent areas in the UK sector"; depocentre ~300 m in Norwegian block 25/1 | **Verbatim** (official lithostratigraphic database) [24] | [24] |
| **Grid** (Middle–Late Eocene, Viking Graben) | Middle–Late Eocene, locally Early Oligocene | "**Sandstones were probably derived from the East Shetland Platform**"; "recognised in the Viking Graben area **between 58°30′N and approximately 60°30′N**"; "thought to have been deposited in an **open marine environment during a regressive period**", corresponding to "an eustatic fall in sea level in the Late Eocene"; ~400 m depocentre in Norwegian block 15/3 | **Verbatim** (official lithostratigraphic database) [23] | [23] |
| **Hermod S2** (earliest Eocene, Greater Alvheim) | earliest Ypresian | "The position of the sandstones relative to the East Shetland Platform (ESP) is inferred to be the main control on provenance, with **sediment input from at least two different point sources**… consistent with the evidence for widespread **Permo-Triassic and Devonian sediments on the ESP**. However, some direct supply from metasedimentary (Moine and Dalradian) basement is implied"; stratigraphic change is "related to a sea-level rise that **reduced the extent of alluvial storage** and altered the geological framework of the hinterland" | **Verbatim** (abstract, CC BY) [10] | [10] |
| **Alba** (Middle Eocene, Block 16/26a) | Lutetian–Bartonian | "a relatively heavy oil accumulation lying in an **Eocene deep-water channel complex**"; the field memoir says **nothing** about provenance | **Verbatim** for the setting, **not established** for provenance | [28] |
| Palaeocene sands of the central North Sea | Palaeocene | the classic provenance paper exists and its metadata is verified, but **no abstract is deposited anywhere** and the publisher 403s. Do not quote it. | **metadata only** | [29] |

**Inference, and it answers the question as asked.** "Scotland–Shetland uplift"
and "Shetland Platform" are not competing answers; they are different scales of
the same source area, and the literature assigns them to different sinks. The
*central* North Sea Palaeocene fans are fed by the whole Scotland–Shetland
hinterland [9][21][22]; the *northern* Viking Graben Eocene fans (Frigg, Grid,
Hermod) are fed specifically from the East Shetland Platform to their west
[23][24][10]. Two of those three statements are official Norwegian
lithostratigraphic definitions, which is the strongest form this evidence takes
anywhere in the retrieved record.

**And it carries a constraint the contract must respect.** Hermod S2
provenance requires "alluvial storage" on the ESP in the earliest Eocene [10],
and Grid provenance requires the ESP still shedding sand in the Middle–Late
Eocene [23]. A fully drowned ESP cannot do either. A fully emergent ESP cannot
host the glauconitic highstand shelf of [6] or the Balder overstep of [11][12].
Both are true in sequence; neither is true for a whole Cao bin.

---

## 4. Shelf edges, deltas and coastal plains east of Shetland

| Statement | Timing | Spatial content | Status | Refs |
|---|---|---|---|---|
| Six unconformity-bounded Dornoch clinoform units, then backstepping Beauly/Balder; "temporal and spatial changes in the distribution of downdip depocentres and updip unconformities indicate **strong lateral variability in patterns of shelf accommodation/erosion and local sediment supply**… a complex interplay among laterally uneven relative sea-level fall, inherited topography, time-varied sediment entry point distribution and along-shore sediment transport regimes" | Palaeocene–Early Eocene | >60,000 km² of 3D data; no shelf-edge coordinate quoted | **Verbatim** (abstract) [4] | [4] |
| An early Eocene canyon–channel–lobe system "from the northern Shetland Platform to the southern Møre Basin region"; morphology "allows a subdivision of **platform, upper, middle, and lower slope, and basin floor**"; "the platform contains channel shapes and their fill stretching from the south towards the **platform edge and upper slope, where dendritic canyon heads developed**" | Early Eocene | one 3D dataset; the platform edge is mapped, not located in degrees in the abstract | **Verbatim** (abstract, CC BY-NC) [25] | [25] |
| Rivers on the ESP "terminate against a coastline to the east where deltaic landforms are identified"; "incised valleys appear to stop along a palaeo-coastline, and localized deposits at the mouths of channels are most probably deltaic in origin" | 58–55 Ma on the source's scale | the coastline lies inside the North Bressay survey, i.e. east of ~1.2–1.7°E (our arithmetic, §1.1) | **Verbatim** (full PDF) [3] | [3] |
| Frigg: "sediment was carried by big river systems which snaked eastwards over what is now known as the Shetland platform"; "on reaching the coast, the rivers built up huge deltas which later broke down partially to create big underwater fans of sand"; "about 50 million years ago, in the early Eocene" | Early Eocene | none | **Verbatim** quotation of a **popular-science** page; treat the *geology* as Snippet-grade [31] | [31] |
| "MC3D-Q152014 (dual-sensor) west-east-oriented seismic cross-section through the **lower Eocene 'Dornoch Delta'**"; Palaeogene targets are "shallow marine and turbiditic Paleogene sandstones, with key fields within the Dornoch, Lista, Sele and Vale formations" | Palaeocene–Early Eocene | none | **Snippet** (industry magazine) [32] | [32] |
| Middle Eocene ESP: fluvio-deltaic Lower Sand Unit on the **southern** ESP, then "highstand shelf systems tracts separated by glauconitic bands" | Lutetian–Bartonian | "southern part of the East Shetland Platform" is the only spatial qualifier | **Snippet** [6] | [6] |
| Grid Fm deposited "in an open marine environment during a regressive period" between **58°30′N and ~60°30′N** | Middle–Late Eocene | two latitudes, which is the sharpest spatial statement retrieved for the Eocene | **Verbatim** [23] | [23] |
| A high-resolution sequence framework for the whole Palaeocene–Eocene: "nine stratigraphic sequences… together with a further 11 subsequences", bounded by "high-gamma log markers representing maximum condensation surfaces that can be readily correlated over the whole basin", with "a series of maps showing the lithofacies distribution for individual sequences on a regional scale" | Palaeocene–Eocene | 20 sequence-scale states inside two Cao bins | **Verbatim** (abstract) [13] | [13] |

**Inference, and it is the sharpest thing in this memo.** Reference [13]
resolves the Palaeocene and Eocene of the North Sea into **twenty**
sequence-scale land–sea states. Cao gives us **two** polygons for the same
36 Myr. No geometry we emit can be right for more than a fraction of either
bin, and the contract's job is to pick the fraction the map key already
promises — not to pick the most interesting one.

---

## 5. Consequence for the basin edit contract

### 5.1 The map key decides this, not the uplift literature

`src/data/sources.ts` says, verbatim: **"A map interval records the minimum land
and maximum flooding mapped anywhere in that bin, not a shoreline at one moment,
and shallow marine is an environment class, not a water depth."**
`docs/data/palaeo-coastlines-format.md` says the same thing and adds the part
that matters most here: **"It is not a shoreline at one moment, and the interval
boundary is a change of map, not a dated event."** Cao's own text says
coastlines "represent estimated maximum marine transgression surfaces"
(**Verbatim**, [1] via the companion memo). Under that key, `lm` in a bin is the
ground that was land **for the whole bin**, and `sm` is everything the sea ever
reached.

That settles the ESP. The Bressay landscape drowned "in <3 Ma" [2] and the
Balder mudstone oversteps Beauly and Dornoch westwards across the platform
[11][12], both **inside** interval 58–49 (59.2–47.8 Ma on Cao's own ICS2016
column). Ground that was dry at 57 Ma and under water at 54 Ma is not minimum
land for 58–49. The same applies with more force to 49–37, where the retrieved
record has the ESP transgressed from the start and only its southern part
carrying a delta plain [6].

This is exactly the precedent the contract already set for the Zechstein: "A
maximum-transgression bin keeps the marine end member; the desert phase is
unrepresentable here."

### 5.2 Is the current 49–37 operation supported?

**Yes, as drawn, and for a better-cited reason than the one in the contract.**

The operation draws the Shetland Platform as land from −3.0°E to 0.2°E and
leaves the ESP proper at (0.5, 61) shallow. The retrieved record supports both
halves of that:

- Land west of ~0°E: the platform is the "Scotland–Shetland hinterland" that
  sourced the Palaeogene sands [9], it "was uplifted and acted as a source area
  of sediment in the Palaeogene" [8], it "formed a regional high throughout the
  Mesozoic and Tertiary" [7], and it was still shedding the Grid sands in the
  Middle–Late Eocene [23]. A source area is subaerial somewhere, and this is the
  only part of the region with no retrieved report of Eocene marine cover.
- Shallow at (0.5, 61): the ESP proper was transgressed by the Balder Formation
  in the earliest Eocene [11][12] and carries glauconitic highstand shelf
  systems tracts in the Middle Eocene [6], with the fluvio-deltaic unit confined
  to "the southern part" [6] — i.e. well south of 61°N.

**What changes is the citation, not the polygon.** The contract's present
`jones-2003-eocene` + `anell-2012` pairing is thin for an Eocene claim. Attach
[6][8][23][10] and the rationale stops resting on "the outline does not change
because nothing constrains how it changed".

### 5.3 Should the ESP be land in 58–49?

**No — not under the minimum-land key, and the memo should say why loudly.**

The temptation is real: subaerial river landscapes with a coastline to their
east are documented at ~1.2–1.7°E, 59.8–60.4°N [2][3][5], which is 100–150 km
east of the contract's current edge. If EarthHistory rendered the *emergent* end
member for 58–49, extending the land polygon east to about 1.7°E between 59.8°N
and 60.5°N would be well cited.

It does not render the emergent end member. It renders minimum land. The same
papers that document the landscape document its drowning inside the same bin
[2][3]. Extending the polygon would assert, at map scale, that the ESP was dry
for 58–49 Ma — which contradicts [11][12][6] and contradicts our own key.

**Recommended extent, in words.** Keep both Palaeogene operations at their
present outline: the Shetland Platform from about 3°W to about the zero
meridian, between about 59.8°N and 61.8°N, stopping well short of the
Faroe–Shetland Basin to the north-west. Do not extend either operation east of
about 0.5°E. The eastern edge is the *least* constrained part of the outline:
no retrieved source places a Palaeogene shoreline in degrees anywhere between
0°E and 1.2°E, so **the stated spatial uncertainty on that edge should rise from
60 km to 75 km**, which is the distance from the contract's 0.2°E edge to the
western limit of the Bressay block cluster and an honest statement that the
line could be anywhere in between. The 40–60 km figure used elsewhere in the
contract is for edges that a published latitude or facies boundary constrains;
this one has neither.

### 5.4 References to attach

To **both** Palaeogene operations (they share the outline and the source-area
argument):

| sourceId | Citation | What it constrains | Verified |
|---|---|---|---|
| `mudge-2015-lower-tertiary-sandstones` | [9] | the Scotland–Shetland hinterland as the Palaeogene clastic source area | DOI, CC BY 3.0, abstract read |
| `kjennerud-gillmore-2003-palaeobathymetry` | [8] | the ESP uplifted and acting as a Palaeogene source area; 800 m Viking Graben palaeobathymetry; 12 wells, 58°–62°N | DOI, abstract read |
| `platt-cartwright-1998-esp-structure` | [7] | the ESP as a regional high through the Mesozoic and Tertiary with only a thin succession preserved | DOI, abstract read |

To the **58–49** operation additionally:

| sourceId | Citation | What it constrains | Verified |
|---|---|---|---|
| `stucky-de-quay-2017-bressay-landscape` | [2] | a 58–55 Ma subaerial landscape on the ESP, ~350 m cumulative uplift, formed in <3 Myr and rapidly drowned | DOI, CC BY, abstract read |
| `stucky-de-quay-roberts-2023-north-bressay` | [3] | rivers draining east to a palaeo-coastline with deltas, ~500 m relief, c. 58–55 Ma, ~30 km north of Bressay | DOI, CC BY, **full PDF read** |
| `valore-2024-esp-palaeogeography` | [4] | six Dornoch clinoform units then backstepping Beauly/Balder; uplifted Shetland topography as first-order control; >60,000 km² of 3D data | DOI, CC BY-NC, abstract read |
| `underhill-2001-esp-palaeogeomorphic-traps` | [5] | Late Palaeocene–Early Eocene forced-regressive delta, >250 m incision, dendritic incised-valley network on the ESP | DOI/metadata verified; **content is Snippet only** — cite for the pattern, never quote |

To the **49–37** operation additionally:

| sourceId | Citation | What it constrains | Verified |
|---|---|---|---|
| `condon-1992-esp-eocene` | [6] | Middle Eocene ESP: fluvio-deltaic on the southern platform, then transgression to glauconitic highstand shelf | DOI/metadata verified; **content is Snippet only** |
| `sodir-grid-formation` | [23] | Grid Fm Middle–Late Eocene, derived from the ESP, open marine, 58°30′N–~60°30′N | official public database page, read verbatim |
| `sodir-frigg-formation` | [24] | Frigg Fm Early Eocene submarine fans, "the source was the East Shetland Platform to the west" | official public database page, read verbatim |
| `luzinski-2022-hermod-provenance` | [10] | earliest Eocene ESP catchments with alluvial storage; recycled Permo-Triassic and Devonian cover; sea-level rise reducing alluvial storage | DOI, CC BY 4.0, abstract read |

Optional supporting rows, if the contract wants the Moray Firth and Highlands
context on the same evidence chart: [17][19][20][14][16].

### 5.5 What must NOT be claimed

1. **Not** that the East Shetland Platform proper was dry land for the whole of
   58–49 Ma, or for any part of 49–37 Ma. The literature has it emergent for a
   few Myr and drowned for the rest [2][3][11][12][6].
2. **Not** that the coastline ran along 0.2°E, or along any meridian. That edge
   is a rendering choice inside a 75 km band with no published line in it.
3. **Not** that the Cao interval boundary at 49 Ma is a change of coastline. It
   is a change of evidence. The real transition — the Balder transgression — is
   at ~55 Ma, deep inside interval 58–49, and no geometry in this program can
   place it.
4. **Not** that the buried Bressay, North Bressay or Judd landscapes are drawn,
   reconstructed, traced or approximated by any polygon EarthHistory emits.
   They constrain a state; they are not our geometry, and their seismic maps are
   not redistributable.
5. **Not** that "the ESP sourced the sands" is the same statement as "the ESP
   was above water". [10] is explicit that the ESP catchments were recycling a
   Permo-Triassic and Devonian cover with alluvial storage — a low-relief
   coastal plain that a rising sea reduced. Rendering that as landmass is our
   coarsening, and the contract's `claimOrInference` line must keep saying so.
6. **Not** that uplift magnitudes are observations. The 375/525 m Palaeocene
   uplift and 160–310 m Eocene subsidence of [16], the ~350 m of [2] and the
   300–600 m of `jones-2001-transient-uplift` are **model output** from
   backstripping or river-profile inversion. The chart's `evidence.status` stays
   `derived-from-published-source` and the badge stays synthesis.
7. **Not** that the Orkney–Shetland Platform statements in [27] describe the
   North Sea side. SEA4 is the Atlantic margin west and north of Shetland.
8. **Not** that the Scottish Highlands need an edit. Cao already draws them as
   land at both intervals, and [19][20] agree.
9. **Not** that the Moray Firth shoreline is settled. The inner basin is
   emergent and stripped from the mid–late Danian [17] while the outer basin
   carries the Dornoch delta front [18]; that boundary sits inside the contract
   window, is not located in degrees by anything retrieved, and would need its
   own operation and its own measurement. It is out of scope here.

### 5.6 Open items this memo could not close

- **The NSTA/OGA Eocene sheet for the Northern North Sea and East Shetland
  Platform was not read in this session.** The contract cites the package's
  Forties and Sele sheets for 58–49 and the package generally for 49–37; the
  package is held offline outside the repository. Its Eocene facies classes over
  the ESP are the single cheapest remaining check on §5.2 and should be read
  before the next Palaeogene edit.
- **Underhill 2001 [5] and Condon et al. 1992 [6] were never opened.** Both are
  load-bearing for the argument and both are Snippet-grade here. Neither
  deposits an abstract and both publishers 403 this worker. The same is true of
  the Mudge & Bujak and Mudge & Copestake stratigraphy papers [15], which are
  the obvious route to a dated Eocene facies map of the ESP and were
  metadata-only in this session.
- **Anell et al. 2012 [26]** remains quoted at one sentence, inherited from the
  companion memo. The full text was not retrievable.
- **Alba provenance [28]** is not established by anything retrieved. Do not
  assume an ESP source for it by analogy with Frigg and Grid.
- The eastern limit of the MC3D-ESP2015M survey — and therefore how far east
  the 58–55 Ma coastline can be bracketed — is not stated in degrees in [3].

---

## 6. References

All accessed 2026-09-15. **[unverified]** marks an item whose metadata could not
be confirmed at a publisher, catalogue or DOI registry in this session. "No
abstract deposited" means Crossref, Unpaywall and Semantic Scholar all returned
none and the publisher returned HTTP 403; those entries are **Snippet-grade**
and are never quoted as the source's own words.

**The source and its key**

1. Cao W., Zahirovic S., Flament N., Williams S., Golonka J., Müller R.D. 2017. Improving global paleogeography since the late Paleozoic using paleobiology. Biogeosciences 14, 5425–5439. https://doi.org/10.5194/bg-14-5425-2017 (CC BY 3.0). Metadata and licence confirmed in this repository's earlier audit.

**The East Shetland Platform in the Palaeocene and Eocene**

2. Stucky de Quay G., Roberts G.G., Watson J.S., Jackson C.A.-L. 2017. Incipient mantle plume evolution: constraints from ancient landscapes buried beneath the North Sea. Geochemistry, Geophysics, Geosystems 18, 973–993. https://doi.org/10.1002/2016GC006769 (CC BY 4.0). Abstract read verbatim.
3. Stucky de Quay G., Roberts G.G. 2023. Geodynamic generation of a Paleocene–Eocene landscape buried beneath North Bressay, North Sea. Journal of the Geological Society 180(1), jgs2022-063. https://doi.org/10.1144/jgs2022-063 (CC BY 4.0). **Full text read** from the Imperial College Spiral deposit, http://hdl.handle.net/10044/1/99308 . Crossref lists the issue year as 2023 and the article's own received/accepted dates as 2022; Unpaywall indexes it as 2022. Cite 2023.
4. Valore L.A., Sømme T.O., Patruno S., Robin C., Guillocheau F., Eide C.H. 2024. Palaeogeography and 3D variability of a dynamically uplifted shelf: observations from seismic stratigraphy of the Palaeocene East Shetland Platform. Basin Research 36(5), e12895. https://doi.org/10.1111/bre.12895 (CC BY-NC 4.0). Abstract read verbatim via Crossref; the full text 403s at Wiley and the HAL deposit is behind a bot challenge.
5. Underhill J.R. 2001. Controls on the genesis and prospectivity of Paleogene palaeogeomorphic traps, East Shetland Platform, UK North Sea. Marine and Petroleum Geology 18(2), 259–281. https://doi.org/10.1016/S0264-8172(00)00067-2 — **no abstract deposited; publisher 403.** A conference abstract of the same work exists at https://doi.org/10.1306/61EED2D8-173E-11D7-8645000102C1865D (AAPG Bulletin 85, 2001) and is also empty. **Snippet-grade.**
6. Condon P.J., Jolley D.W., Morton A.C. 1992. Eocene succession on the East Shetland Platform, North Sea. Marine and Petroleum Geology 9(6), 633–647. https://doi.org/10.1016/0264-8172(92)90036-E — **no abstract deposited; publisher 403. Snippet-grade.**
7. Platt N.H., Cartwright J.A. 1998. Structure of the East Shetland Platform, northern North Sea. Petroleum Geoscience 4(4), 353–362. https://doi.org/10.1144/petgeo.4.4.353 . Abstract read verbatim.
8. Kjennerud T., Gillmore G.K. 2003. Integrated Palaeogene palaeobathymetry of the northern North Sea. Petroleum Geoscience 9(2), 125–132. https://doi.org/10.1144/1354-079302-510 . Abstract read verbatim.

**Provenance and sand distribution**

9. Mudge D.C. 2015. Regional controls on Lower Tertiary sandstone distribution in the North Sea and NE Atlantic margin basins. Geological Society, London, Special Publications 403, 17–42. https://doi.org/10.1144/SP403.5 (CC BY 3.0). Abstract read verbatim. Crossref dates the online version 2014 and the volume 2015; cite 2015.
10. Luzinski W.M., Morton A.C., Hurst A., Tøllefsen I.I., Cater J. 2022. Provenance variability in coeval slope channel systems: Hermod S2 Member sandstone (Eocene), South Viking Graben (North Sea). Geosciences 12(12), 450. https://doi.org/10.3390/geosciences12120450 (CC BY 4.0). Abstract read verbatim; the MDPI PDF endpoint 403s.

**The Balder transgression**

11. Statements about the upper Balder mudstone overstepping the Beauly and Dornoch formations westwards on the East Shetland Platform were recovered only as search-engine summaries of pages this worker could not open. **Snippet; no citable primary sentence.** The underlying literature is [4], [13] and Knox R.W.O'B. & Holloway S. 1992, *Lithostratigraphic nomenclature of the UK North Sea: 1, Palaeogene (Central and Northern North Sea)*, British Geological Survey, Nottingham — **[unverified]**: the BGS volume itself has no DOI and was not opened; the DOI https://doi.org/10.1016/0264-8172(94)90030-2 belongs to Milton N. 1994's *review* of it in Marine and Petroleum Geology 11, 761, not to the volume.
12. Same status as [11]; the Early–Mid Eocene transgressive backfill statement is a search summary of a page that 403s. **Snippet.**

**Sequence stratigraphy and tectonics of the Palaeogene North Sea**

13. Mudge D.C., Bujak J.P. 1996. An integrated stratigraphy for the Paleocene and Eocene of the North Sea. Geological Society, London, Special Publications 101, 91–113. https://doi.org/10.1144/GSL.SP.1996.101.01.06 . Abstract read verbatim.
14. Milton N.J., Bertram G.T., Vann I.R. 1990. Early Palaeogene tectonics and sedimentation in the Central North Sea. Geological Society, London, Special Publications 55, 339–351. https://doi.org/10.1144/GSL.SP.1990.055.01.16 . Abstract read verbatim. It credits the ten-unit seismic scheme to Stewart (1987), which was **not retrieved**; do not cite Stewart 1987 from this memo.
15. Mudge D.C., Bujak J.P. 1994. Eocene stratigraphy of the North Sea basin. Marine and Petroleum Geology 11(2), 166–181. https://doi.org/10.1016/0264-8172(94)90093-0 — **metadata only, no abstract deposited.** See also Mudge D.C., Copestake P. 1992, *Revised Lower Palaeogene lithostratigraphy for the Outer Moray Firth*, Marine and Petroleum Geology 9(1), 53–69, https://doi.org/10.1016/0264-8172(92)90004-X and *Lower Palaeogene stratigraphy of the northern North Sea*, 9(3), 287–301, https://doi.org/10.1016/0264-8172(92)90077-R — **both metadata only.**
16. Nadin P.A., Kusznir N.J. 1995. Palaeocene uplift and Eocene subsidence in the northern North Sea Basin from 2D forward and reverse stratigraphic modelling. Journal of the Geological Society 152(5), 833–848. https://doi.org/10.1144/gsjgs.152.5.0833 . Abstract read verbatim. **Model output.**
17. Thomson K., Hillis R.R. 1995. Tertiary structuration and erosion of the Inner Moray Firth. Geological Society, London, Special Publications 90, 249–269. https://doi.org/10.1144/GSL.SP.1995.090.01.16 . Abstract read verbatim.
18. Cole D., Stewart S.A., Cartwright J.A. 2000. Giant irregular pockmark craters in the Palaeogene of the Outer Moray Firth Basin, UK North Sea. Marine and Petroleum Geology 17(5), 563–577. https://doi.org/10.1016/S0264-8172(00)00013-1 — **metadata verified; content Snippet only.**
19. Hall A.M., Bishop P. 2002. Scotland's denudational history: an integrated view of erosion and sedimentation at an uplifted passive margin. Geological Society, London, Special Publications 196, 271–290. https://doi.org/10.1144/GSL.SP.2002.196.01.15 . Abstract read verbatim.
20. Hall A.M. 1991. Pre-Quaternary landscape evolution in the Scottish Highlands. Transactions of the Royal Society of Edinburgh: Earth Sciences 82(1), 1–26. https://doi.org/10.1017/S0263593300007495 . Abstract read verbatim.
21. Jolley D., Vieira M., Jin S., Kemp D.B. 2023. Palynofloras, palaeoenvironmental change and the inception of the Paleocene Eocene Thermal Maximum; the record of the Forties Fan, Sele Formation, North Sea Basin. Journal of the Geological Society 180(1), jgs2021-131. https://doi.org/10.1144/jgs2021-131 . Abstract read verbatim. Supplementary data https://doi.org/10.6084/m9.figshare.c.6080873 .
22. Kilhams B., Hartley A., Huuse M., Davis C. 2015. Characterizing the Paleocene turbidites of the North Sea: Maureen Formation, UK Central Graben. Geological Society, London, Special Publications 403, 43–62. https://doi.org/10.1144/SP403.1 . Abstract read verbatim.

**Official lithostratigraphic and survey sources**

23. Norwegian Offshore Directorate (Sodir). Lithostratigraphic chart, **Grid Formation** (Hordaland Group). https://factpages.sodir.no/en/strat/PageView/Litho/Formations/53 . Read verbatim. The chart series is the 2014 NPD lithostratigraphic charts, https://www.sodir.no/en/facts/geology/lithostratigraphy/ .
24. Norwegian Offshore Directorate (Sodir). Lithostratigraphic chart, **Frigg Formation**. https://factpages.sodir.no/en/strat/pageview/litho/formations/45 . Read verbatim. Named after Deegan & Scull (1977), which was not retrieved.
25. Kjøll H.J., Midtkandal I., Manton B., Planke S. 2025. Seismic geomorphology of an early Eocene canyon–channel–lobe system north of Shetland. Basin Research 37(3), e70031. https://doi.org/10.1111/bre.70031 (CC BY-NC 4.0). Abstract read verbatim.
26. Anell I., Thybo H., Rasmussen E.S. 2012. A synthesis of Cenozoic sedimentation in the North Sea. Basin Research 24, 154–179. https://doi.org/10.1111/j.1365-2117.2011.00517.x . Metadata verified; **no abstract deposited and the full text 403s.** The one sentence used here is inherited from [palaeo-coastlines-literature.md](palaeo-coastlines-literature.md).
27. Musson R.M.W., Cooper R.M., Jones S.M. 2003. *DTI Strategic Environmental Assessment Area 4 (SEA4): subseabed geology.* British Geological Survey Commercial Report CR/03/080, © Crown 2003. https://assets.publishing.service.gov.uk/media/5a7ae373ed915d71db8b3332/SEA4_TR_Subseabed_BGS.pdf — **full PDF read.** Covers the UK continental shelf and slope of SEA area 4, i.e. the Atlantic margin west and north of Scotland and Shetland.
28. Moore I., Archer J., Peavot D. 2020. The Alba Field, Block 16/26a, UK North Sea. Geological Society, London, Memoirs 52, 637–650. https://doi.org/10.1144/M52-2018-46 . Abstract read verbatim; it contains no provenance statement.
29. Morton A.C. 1979. The provenance and distribution of the Palaeocene sands of the central North Sea. Journal of Petroleum Geology 2. https://doi.org/10.1306/BF9AB5A8-0EB6-11D7-8643000102C1865D — **metadata only; volume pagination not recovered and no abstract deposited. Do not quote.**
30. Cohen K.M., Finney S.C., Gibbard P.L., Fan J.-X. (eds). International Chronostratigraphic Chart v2024/12. International Commission on Stratigraphy. https://stratigraphy.org/ICSchart/ChronostratChart2024-12.pdf

**Non-scholarly sources, used only where marked**

31. Norwegian Petroleum Museum. *Geology* (Frigg industrial-heritage site). https://frigg.industriminne.no/en/2019/11/12/geology/ . Read verbatim; it is a museum outreach page, not a peer-reviewed source. Its geological content is **Snippet-grade** and is used only as corroboration of [24].
32. Reid W., Patruno S. (PGS) 2016. *The East Shetland Platform — a clearer image: unlocking the platform potential.* GEO ExPro, 2 December 2016. https://geoexpro.com/the-east-shetland-platform-a-clearer-image-unlocking-the-platform-potential/ . Industry magazine; **Snippet-grade.**
33. Field block identifiers and the Bentley coordinate (59°56′N, 1°34′E, block 9/3b) come from tertiary web sources (Wikipedia, trade-press field profiles) and are **[unverified against an official register]**. They are used in §1.1 only as an input to arithmetic whose result is checked against the published UKCS block grid; the arithmetic is self-consistent, which is the whole of its authority.
34. The UKCS grid rule — quadrants of 1° × 1°, thirty blocks of 10′ × 12′ — is likewise **Snippet-grade** here; it is confirmed internally by [33] falling inside block 9/3 as computed.

---

## 7. Reproduction

Everything above was recovered with public metadata APIs and two open PDFs. No
credentialed access was used.

```
# metadata and publisher-deposited abstracts
https://api.crossref.org/works/<doi>
https://api.unpaywall.org/v2/<doi>?email=<address>
https://api.semanticscholar.org/graph/v1/paper/DOI:<doi>?fields=title,abstract,openAccessPdf

# the two full texts read
http://hdl.handle.net/10044/1/99308            # -> Imperial Spiral, ref [3]
https://assets.publishing.service.gov.uk/media/5a7ae373ed915d71db8b3332/SEA4_TR_Subseabed_BGS.pdf   # ref [27]
```

Working copies and the extracted text are in this session's scratch tier and
are not durable; nothing in this memo depends on them, because every quotation
names its retrieval route above.
