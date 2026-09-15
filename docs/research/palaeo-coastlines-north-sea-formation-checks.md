# North Sea formation checks against the shipped palaeo-coastline payloads

Probe date: 2026-09-15. Read-only measurement of the **public** payloads under
`public/data/reconstruction/cao-v2.4/palaeo-coastlines/`, against the
petroleum-geological formations whose age and setting the North Sea is usually
described by. Companion to
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say), [palaeo-coastlines-north-sea-edits.md](palaeo-coastlines-north-sea-edits.md)
(what was changed) and [palaeo-coastlines-format.md](../data/palaeo-coastlines-format.md)
(what the bytes mean).

This memo answers one question: **at the present-day position of a named
formation, in the Cao interval that formation's age falls in, does the shipped
map say land, shallow sea, or neither?** It changes nothing. Where it finds a
mismatch it says whether the fix is a permanent validator witness or a cited
basin edit.

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Git HEAD | `28c2adbc4acc5f23ad2c6c1f88e21702539e0d74` |
| Working tree at probe time | modified: `data/corrections/palaeo-coastlines/basins/north-sea.json`, `scripts/research/palaeo_coastlines_correction.py`, `src/styles.css`. **No file under `public/` was modified**, so every payload read here is the committed HEAD payload. |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` |
| Payloads read | 50 (`lm` and `sm`, 24 canonical intervals plus `lgm`), 2 class catalogs |
| Integrity | **Measured.** All 50 payload `sha256` values re-computed here equal the digests their own class catalog pins. The per-file table is the appendix. |

**Method, Measured.** The classification is the validator's own, imported
read-only rather than re-implemented: `palaeo_coastlines_compile.decode_ehpr`
decodes each EHPR v1 payload, `piece_geometry` rebuilds each piece's rings, the
pieces are unioned per class per interval (this is `class_union` in
`scripts/research/palaeo_coastlines_correction.py`), and a present-day
`(lon, lat)` gets the class set `{name : union.contains(point)}`. As in the
validator, the union is over every piece in the interval file and does not
filter by a piece's own `(TOAGE, FROMAGE]` lifecycle, so an off-schedule record
inside the bin counts. A point covered by no shipped class is reported here as
`neither`. Only `lm` and `sm` ship; the mountain class `m` is compiled offline
and withheld, which matters below.

**What each answer means on screen, Measured** from
`src/render/reconstruction/caoFoundation.ts` and `src/App.tsx`:

| Class set | Painted | Map key line |
|---|---|---|
| `lm` | olive `rgb(154,168,107)`, shell 1 300 m, renderOrder 1.7, writes depth | "Palaeo land — Cao et al. 2017 landmass polygons for the active map interval" |
| `sm` | teal `rgb(20,96,107)`, shell 700 m, renderOrder 1.2, no depth write | "Palaeo shallow sea — Cao et al. 2017 shallow-marine polygons; an environment class, not a water depth" |
| `lm` **and** `sm` | **olive.** Land is drawn later and higher, so an overlap renders as land and the shallow sea underneath is invisible | the land line |
| `neither` | whatever the native shelf shell shows through: blue `shelf` at 400 m where Cao 2024 maps continental crust, otherwise ocean. Inside the map domain the native land fill is hidden, so nothing else can fill it | "Blue shelf — Cao 2024 continental crust, depth unmapped" |

**Inference.** `neither` is therefore the model's *deep-or-unmapped complement*:
the statement "this crust exists and this model does not say how deep it was",
not "this was deep ocean". It is also where the withheld mountain class lands —
see §6.

---

## 1. Devonian and Permian: is the North Sea dry?

### 1.1 Devonian, intervals 402–380 and 380–359

**Measured.**

| Interval | (2, 57) Central NS | (4, 54) Southern NS | (2, 60.5) Viking Graben | (−2, 58) Moray Firth | (2.07, 56.4) Auk position |
|---|---|---|---|---|---|
| 402–380 | `lm` | `lm` | `lm` | `lm` | `lm` |
| 380–359 | `lm` | **`sm`** | `lm` | `lm` | `lm` |

**Sourced.** The Middle Old Red Sandstone of the Orcadian Basin is a cyclic
lacustrine and alluvial succession on a continent, with facies "upper and lower
shoreface, deep lake, shallow lake, playa, turbidite and fluvial"
(Andrews & Hartley 2015 [22], *Verbatim*, quoted in the literature memo).
Marine incursions are dated late Givetian–Frasnian and entered "from the east
along the Tornquist Zone at the margin of the Fenno-Scandian High"
(Marshall et al. 1996 [23], *Verbatim*, quoted in the literature memo).

**Inference.** The Old Red Sandstone continental setting is what the payload
shows at both intervals over the Orcadian and the whole central and northern
North Sea. The single `sm` reading at (4°E, 54°N) is in interval 380–359, which
is the bin the incursion ages fall in, and it sits on the south-eastern,
Tornquist-facing margin — the direction the incursions came from. That is the
case the edits memo deliberately left alone rather than inventing a plan-view
extent for. The dry-North-Sea expectation holds.

**Not drawn.** The Orcadian Lake itself. There is no lacustrine class; land plus
a limitation is the honest result, and a blue inland sea would be wrong.

### 1.2 Permian: the Rotliegend desert, the Auk Formation, and the Zechstein

**Measured.**

| Interval | (2.07, 56.4) Auk | (2, 57) Central NS | (4, 54) Southern NS | (2.5, 56.5) Central Graben | (2, 60.5) Viking Graben |
|---|---|---|---|---|---|
| 296–285 | `lm` | `lm` | `lm` | `lm` | `lm` |
| 285–269 | `lm` | `lm` | `lm` | `lm` | `lm` |
| 269–248 | `sm` | `sm` | `sm` | `sm` | `sm` |

The literal expectation — land in 296–285 and 285–269, flooded in 269–248 —
holds at every probed point. **But the dating that motivated it does not.**

**Sourced.** The Auk Formation is the aeolian post-rift member of the
**Rotliegend Group** in the UK Central North Sea: "A series of well logs and
cores penetrating the predominantly aeolian Auk Formation, Permian Rotliegend
Group, Central North Sea, UK"; "accumulation on a dry substrate via the
migration and climb of large linear bedforms"; "Large linear bedforms were
separated by dry interdune areas" (Besly, Romain & Mountney 2018,
https://doi.org/10.1016/j.marpetgeo.2017.12.021, *Verbatim* from the abstract).
The Rotliegend Group of this basin is subdivided into the syn-rift volcanic
Karl Formation and the younger post-rift, aeolian-and-fluvial Auk Formation, and
Auk accumulation is placed in the **Capitanian to Wuchiapingian** (*Snippet*,
retrieved summary of the same paper and of the Rotliegend stratigraphy
literature, not verified against the paper's own page — the abstract itself
states no stage). Glennie (1972,
https://doi.org/10.1306/819A40AE-16C5-11D7-8645000102C1865D) describes the
Rotliegend desert basin "up to 2,000 km long and 500 km wide" in the Variscan
foreland with "up to 200 m of dune sands in the southern North Sea area"
(*Verbatim*, quoted in the literature memo). The Rotliegend–Zechstein boundary,
the Z transgression, is placed at about **258 Ma**, inside the Wuchiapingian,
with 257.3 Ma also published (*Snippet*). Tucker (1991,
https://doi.org/10.1144/gsjgs.148.6.1019) describes the Zechstein as a
periodically isolated carbonate–evaporite basin (*Verbatim*, literature memo).

**Inference, and this is the finding.** Capitanian–Wuchiapingian is
**≈ 265–254 Ma**, not Early Permian. The Upper Rotliegend desert and the Auk
Formation therefore fall **entirely inside Cao interval 269–248** — the same bin
that has to hold the Zechstein Sea that drowned it. Intervals 296–285 and
285–269 are Cisuralian to early Guadalupian: Variscan erosion and Lower
Rotliegend volcanics, before the Upper Rotliegend desert existed. So the model
is land where the Auk desert was not yet, and sea where the Auk desert was. The
`lm` readings at 296–285 and 285–269 are right for their own ages and are not
evidence that the aeolian Rotliegend is rendered; the aeolian Rotliegend is
**not renderable at all** in this schedule, exactly as the literature memo's
§2.1 row for intervals 7–8 already warned. A 21 Myr maximum-transgression bin
keeps the marine end member.

---

## 2. Brent Group time, interval 179–166: where is the coastline?

**Measured**, transect at 0.25° spacing along 2.0°E, interval 179–166:

| Latitude | 57.00–60.50 N | 60.75–63.00 N |
|---|---|---|
| Class | `lm` (every step) | `sm` (every step) |

The modelled shoreline on this meridian lies **between 60.50 N and 60.75 N**.

The three-meridian transect the check asked for:

| Lat (N) | 1.5 E | 2.0 E | 2.5 E |
|---|---|---|---|
| 58.0 | `lm` | `lm` | `lm` |
| 59.0 | `lm` | `lm` | `lm` |
| 60.0 | `lm` | `lm` | `lm` |
| 60.5 | `sm` | `lm` | `lm` |
| 61.0 | `sm` | `sm` | `sm` |
| 61.5 | `sm` | `sm` | `sm` |
| 62.0 | `sm` | `sm` | `sm` |

Context, same meridian 2.0 E: interval 203–179 is `sm` at every latitude 58–62,
and interval 166–146 is `sm` at every latitude 58–62. The land corridor exists
only in 179–166.

**Sourced.** The Brent Group is "shallow marine, marginal marine and non-marine
deposits of Middle Jurassic age (Aalenian - Bathonian)", "mainly Bajocian to
Early Bathonian but including Late Toarcian to the east", divided into the
Broom, Rannoch, Etive, Ness and Tarbert formations, and representing "a major
deltaic system" (Norwegian Offshore Directorate lithostratigraphy, BRENT GP,
https://factpages.sodir.no/en/strat/pageview/litho/groups/16, *Verbatim*;
the chart's own reference is Vollset & Doré (eds) 1984, *A revised Triassic and
Jurassic lithostratigraphic nomenclature for the Norwegian North Sea*,
NPD-Bulletin No. 3, 53 pp., no DOI, with Graue et al. 1987 cited for the Oseberg
Formation). The Brent nomenclature itself originates in Deegan & Scull (eds)
1977, *A standard lithostratigraphic nomenclature for the central and northern
North Sea*, Institute of Geological Sciences Report 77/25 / NPD-Bulletin No. 1,
35 pp., no DOI (*Snippet*: bibliographic identity confirmed via the BGS
publications catalogue, https://webapps.bgs.ac.uk/data/publications/pubs.cfc?method=viewRecord&publnId=19864540).
"The progradation of the Brent Delta (Rannoch, Etive and lower Ness Formations)
took place in Late Aalenian to Early Bajocian" (Helland-Hansen et al. 1992,
https://doi.org/10.1144/GSL.SP.1992.061.01.07, *Verbatim*, literature memo).
"The Early Bathonian delta retreat took place in retrogressive pulses … forming
an estuary in the Southern Viking Graben and gradually drowning the deltaic
system in the Northern Viking Graben"; and "a second, pronounced deltaic
progradation (the 'Vestland deltaic system') took place from the Central Viking
Graben to **ca. 60°30′N**" (Fjellanger, Olsen & Rubino 1996, *Norsk Geologisk
Tidsskrift* 76, 75–106, https://njg.geologi.no/images/NJG_articles/NGT_76_2_075-106.pdf,
no DOI, *Verbatim*, literature memo).

**Inference.** 60°30′N is 60.50 N. The shipped map's land–sea transition on
2.0°E falls in the 60.50–60.75 N step, i.e. **within one 0.25° probe step,
about 28 km, of the cited northern limit**, and inside the 60 km spatial
uncertainty the brent-delta-plain operation declares. The 1.5°E column reads
`sm` at 60.50 because that latitude is the *northern edge* of the delta-plain
edit rectangle (1°E–3.4°E, 58°N–60.5°N) and `contains` is strict on a boundary;
it is a boundary artefact of the probe, not a different shoreline.

**The limitation that is doing real work.** One interval holds an advance, a
retreat and a second advance. The payload renders the maximum land extent only.
"A map interval records the minimum land and maximum flooding mapped anywhere in
that bin" is not decoration here — the Bathonian drowning of the Northern Viking
Graben is simply absent, and so is the retreat that separates the two
progradations.

---

## 3. Late Jurassic flooding, intervals 166–146 and 146–135

**Measured.**

| Point | 166–146 | 146–135 | Expected |
|---|---|---|---|
| Viking Graben (2.5, 60.5) | **`lm`+`sm` → renders land** | `sm` | `sm` |
| East Shetland Basin (1.5, 61) | `sm` | `sm` | `sm` |
| Central Graben (2, 56.5) | `sm` | `sm` | `sm` |
| Moray Firth (−2, 58) | `sm` | `sm` | `sm` |
| Egersund Basin (5.5, 57.8) | **`lm`+`sm` → renders land** | **`lm`** | `sm` |

**Sourced.** The Heather Formation (Viking Group) is "Bathonian to
Kimmeridgian", and "The silty claystones of the Heather Formation were deposited
in an **open marine environment**, brought about by the marine transgression
which initially deposited the youngest formation of the Brent Group"
(Norwegian Offshore Directorate, HEATHER FM,
https://factpages.sodir.no/en/strat/pageview/litho/formations/60, *Verbatim*;
reference Vollset & Doré 1984, NPD-Bulletin 3). The Draupne Formation (Viking
Group) — the Norwegian name substituted for intervals formerly called Kimmeridge
Clay — "ranges from Oxfordian to Ryazanian in age" and "was deposited in a
**marine environment with restricted bottom circulation and often with anaerobic
conditions**" (NOD, DRAUPNE FM,
https://factpages.sodir.no/en/strat/pageview/litho/formations/28, *Verbatim*;
reference Vollset & Doré 1984). In the Egersund Basin the coeval organic-rich
unit is the Tau Formation (Boknfjord Group), "Kimmeridgian to Early Volgian",
which "was deposited in an **anaerobic marine environment with high organic
productivity and restricted bottom water circulation**" and is "confined to the
central part of the type area of the Boknfjord Group" (NOD, TAU FM,
https://factpages.sodir.no/en/strat/pageview/litho/formations/164, *Verbatim*;
reference Vollset & Doré 1984, NPD-Bulletin 3). Kimmeridge Clay integrated stratigraphy: Morgans-Bell et al. 2001,
https://doi.org/10.1017/S0016756801005738; TOC variation and its dilution
component: Tyson 2004, https://doi.org/10.1144/0016-764903-078 (*Snippet*, both
via the literature memo's own citation rows).

**Inference.** Three of five points pass at both intervals. The two failures are
different in kind:

- **Viking Graben at 166–146 renders as land** because a landmass piece and a
  shallow-marine piece both cover (2.5°E, 60.5°N) and land is drawn on top. This
  is the Heather Formation's own depocentre at Callovian–Oxfordian time,
  described by the type lithostratigraphy as open marine. The edits memo records
  "Cao already draws the Viking Graben … as shallow marine at both" and left the
  interval alone; that statement is true of the `sm` class but **not of what the
  renderer shows**, because the overlapping `lm` piece hides it. This is exactly
  the case a class-set witness catches and an `sm`-only witness does not.
- **Egersund Basin is land at 146–135 and land-over-sea at 166–146**, through the
  whole Heather/Draupne–Tau interval. This one is a plain geometry mismatch, not
  a draw-order artefact.

---

## 4. Eocene Frigg and Miocene Utsira: is the basin axis land?

**Measured**, at every one of the four intervals and all three points:

| Point | 58–49 | 49–37 | 20–11 | 11–2 |
|---|---|---|---|---|
| Frigg / Viking Graben (2, 59.5) | `sm` | `sm` | `sm` | `sm` |
| Viking Graben north (2.5, 60.5) | `sm` | `sm` | `sm` | `sm` |
| East Shetland Basin (1.8, 61) | `sm` | `sm` | `sm` | `sm` |

**No point on the northern North Sea axis is land, and none is `neither`, at any
of the four intervals.** For contrast, `neither` does occur nearby and is
therefore a live state rather than an unreachable one: the Møre/Norwegian Sea
point (3°E, 64.5°N) is `neither` at all four, and the Rockall Trough
(−13°E, 56°N) and the Porcupine area (−14°E, 52°N) become `neither` at 11–2.

**Sourced.** The Frigg Formation (Hordaland Group) is "Early Eocene" and "was
deposited as submarine fans, by gravity flows. The mode of deposition led to the
formation varying in thickness over short distances. **The source was the East
Shetland Platform to the west**" (NOD, FRIGG FM,
https://factpages.sodir.no/en/strat/pageview/litho/formations/45, *Verbatim*;
reference Isaksen & Tonstad (eds) 1989, NPD-Bulletin No. 5). The field-scale
description is Heritier, Lossel & Wathne 1979, "Frigg Field — large
submarine-fan trap in Lower Eocene rocks of the North Sea Viking Graben",
https://doi.org/10.1306/2F918856-16CE-11D7-8645000102C1865D; the UK-sector
Palaeogene lithostratigraphy is Knox & Holloway 1992 (British Geological Survey,
no DOI, *bibliographic identity only*) and the biostratigraphic revision is
Mudge & Bujak 1994, https://doi.org/10.1016/0264-8172(94)90093-0 (*Snippet*,
both carried as citation-only rows in the literature memo). The Utsira Formation
(Nordland Group) is "Middle to Late Miocene" and "probably represents
**shallow marine shelf sandstones**" (NOD, UTSIRA FM,
https://factpages.sodir.no/en/strat/PageView/Litho/Formations/183, *Verbatim*).
Its reference list is Eidvin & Rundberg 2001, *Norsk Geologisk Tidsskrift* 81,
119–160; Rundberg & Eidvin 2005, NPF Special Publication 12, 207–239; Eidvin &
Rundberg 2007, *Norwegian Journal of Geology* 87, 391–450 — none carrying a DOI
(*Verbatim* reference list from the same page). Those authors place the Utsira
Formation in the **latest Middle Miocene to earliest Early Pliocene, about
12–4.5 Ma** (*Snippet*, retrieved summary, not read in the papers themselves).

**Inference, and what the two answers would have meant.** The check's
alternatives were `sm` and `neither`, and the answer is `sm` everywhere. That is
the right sign for Utsira, whose own lithostratigraphic description is shallow
marine shelf sand, so 20–11 and 11–2 are not only not-land but apt. It is the
right *sign* but the wrong *depth* for Frigg: a submarine fan emplaced by
gravity flows and sourced from a platform to the west is a deep-water system,
and the model paints its site with the shallow-marine environment class. The
format is explicit that `sm` "is an environment class, not a water depth", so
this is a labelling limit of the source, not a defect in the build; the honest
reading on screen is "not land, depth not stated". Had the axis come back
`neither` it would have meant the opposite: no Cao 2017 polygon of either class
covers that ground, the blue shelf shows through, and the map key's "Cao 2024
continental crust, depth unmapped" is the only claim made. Neither state can be
read as "deep marine": the model never says deep.

The Eidvin & Rundberg 12–4.5 Ma range straddles the 11 Ma interval boundary.
Both bins that it touches are `sm`, so the Utsira answer does not depend on
which side of the boundary the formation is assigned to.

---

## 5. The whole North Sea history the mode currently shows

**Measured.** Class at (2°E, 57°N), Central North Sea, and (4°E, 54°N),
Southern North Sea, at every shipped interval.

| # | Interval (Ma) | (2, 57) Central NS | (4, 54) Southern NS | Formations / events in the bin |
|---:|---|---|---|---|
| 1 | 402–380 | `lm` | `lm` | Middle Old Red Sandstone, Orcadian Basin |
| 2 | 380–359 | `lm` | `sm` | Upper ORS; late Givetian–Frasnian marine incursions from the east |
| 3 | 359–338 | `sm` | `sm` | Dinantian carbonate platforms |
| 4 | 338–323 | `sm` | `sm` | Namurian / Yoredale deltas |
| 5 | 323–296 | `lm` | `sm` | Westphalian coal-forming plain |
| 6 | 296–285 | `lm` | `lm` | Variscan erosion; Lower Rotliegend volcanics |
| 7 | 285–269 | `lm` | `lm` | pre-Upper-Rotliegend continental |
| 8 | 269–248 | `sm` | `sm` | **Upper Rotliegend / Auk Fm desert AND the Zechstein Sea in one bin** |
| 9 | 248–224 | `lm` | `lm` | Triassic endorheic dryland (Smith Bank, Skagerrak) |
| 10 | 224–203 | `lm` | `lm` | Triassic dryland |
| 11 | 203–179 | `sm` | `sm` | Early Jurassic flooding before the mid-Jurassic dome |
| 12 | 179–166 | `lm` | `lm` | **Brent Group; mid-Jurassic dome; Vestland delta to 60°30′N** |
| 13 | 166–146 | `sm` | `sm` | **Heather Fm; onset of Draupne / Kimmeridge Clay** |
| 14 | 146–135 | `sm` | `sm` | **Draupne / Kimmeridge Clay; late Ryazanian transgression** |
| 15 | 135–117 | `sm` | `lm`+`sm` → land | Valhall / Cromer Knoll; footwall-island archipelago |
| 16 | 117–94 | `sm` | `sm` | Lower Cretaceous marine |
| 17 | 94–81 | `sm` | `sm` | Chalk sea |
| 18 | 81–58 | `sm` | `sm` | Chalk sea merged with the Palaeocene |
| 19 | 58–49 | `sm` | `sm` | **Forties/Sele/Balder; Frigg Fm at the top** |
| 20 | 49–37 | `sm` | `sm` | Eocene deep basin |
| 21 | 37–29 | `sm` | `sm` | Priabonian–Rupelian |
| 22 | 29–20 | `sm` | `sm` | Oligocene–early Miocene eastern-margin deltas |
| 23 | 20–11 | `sm` | `sm` | **Utsira Fm (lower part)** |
| 24 | 11–2 | `sm` | `sm` | **Utsira Fm (upper part); Eridanos delta** |
| — | `lgm` | `lm` | `lm` | detached −120 m lowstand state; Doggerland emergent |

**Inference.** Eight of the twenty-four intervals are land at the Central North
Sea and the rest are shallow sea; the Southern North Sea differs at five of
them. The shape of the curve is defensible — Devonian–Carboniferous continent,
Permo-Triassic desert, mid-Jurassic dome, then continuous marine from the Late
Jurassic rift onwards — and the flips at 269–248, 203–179 and 179–166 land in
the right bins. Two rows are worth carrying forward besides the ones the checks
targeted: row 8 is the one bin that must hold both a desert and the sea that
drowned it (§1.2), and **row 15 renders the Southern North Sea as land at
135–117** through an `lm`/`sm` overlap, at the interval Rawson & Riley's late
Ryazanian transgression (https://doi.org/10.1306/03B5AC87-16D1-11D7-8645000102C1865D)
and the isochronous base of the Valhall Formation belong to. That is the same
overlap-hides-the-sea pattern as the Viking Graben at 166–146, in a second place.

---

## 6. A separate finding: the withheld mountain class renders as unmapped crust

**Measured.** At the Horda Platform (4.5°E, 60.5°N), interval 179–166, the
shipped classes give `neither` — a hole between land at the Utsira High to the
west and land in the Skagerrak to the east. It is not a dropped piece and not a
hole in the source: querying the pinned Cao 2017 archive at the interval mid-age
of 172.5 Ma finds **no** `lm` and **no** `sm` record covering that point, and
**one `m` (mountain) record** — source record 3755, `PLATEID1` 302, lifecycle
(166.01, 179.0]. The same mountain record covers the Auk position (2.07°E,
56.4°N) at that interval, where `lm` also covers it so nothing is visible.

**Inference.** Wherever Cao 2017 maps mountain and neither land nor shallow sea,
the shipped build paints the model's deep-or-unmapped complement — the blue
shelf, captioned "Cao 2024 continental crust, depth unmapped". A mountain is
displayed as submerged unmapped crust. Withholding `m` from the package is a
deliberate, recorded budget decision and the outline tone tables were already
corrected to stop inking dark over it, but the surface consequence has not been
measured: this memo found one instance from ten probe points at one interval, so
the exposed area is unknown and could be large over the Caledonides, the
Variscides and the Urals. This is not a North Sea question and does not belong
in a North Sea basin contract.

---

## 7. Expectation vs modelled

| # | Check | Expectation | Modelled | Verdict |
|---|---|---|---|---|
| 1a | Devonian 402–380 | North Sea dry (Old Red Sandstone continent) | `lm` at all five probed points | **PASS** |
| 1b | Devonian 380–359 | North Sea dry | `lm` at Central NS, Viking Graben, Moray Firth, Auk; `sm` at (4, 54) | **PASS** — the one marine point is on the Tornquist-facing SE margin, the direction and the interval of the dated incursions; deliberately unedited |
| 1c | Permian 296–285, 285–269 | land (continental aeolian/fluvial/playa) | `lm` at all five points, both intervals | **PARTIAL** — the class is right, the premise is not: Capitanian–Wuchiapingian Auk/Upper Rotliegend does not fall in these bins, which are Cisuralian–early Guadalupian |
| 1d | Permian 269–248 | flooded by the Zechstein | `sm` at all five points | **PASS** on the Zechstein; **FAIL as a whole bin** — the Auk Fm desert shares this interval and is rendered as sea. Unrepresentable, not fixable by an edit |
| 2 | Brent 179–166, shoreline latitude | delta plain north to ca. 60°30′N | land continuous to 60.50 N on 2.0°E, sea from 60.75 N; land at 60.5 N on 2.5°E; same pattern on 1.5°E one step south (edit-polygon boundary) | **PASS** — within one 0.25° step (~28 km) of 60°30′N, inside the operation's declared 60 km uncertainty |
| 2b | Brent 179–166, advance and retreat | delta prograded then retreated inside the bin | one maximum-extent geometry; 203–179 and 166–146 are `sm` throughout the transect | **PARTIAL by design** — the schedule cannot carry a sub-interval cycle; the limitation is stated in the map key |
| 3a | Late Jurassic, East Shetland Basin (1.5, 61) | `sm` | `sm` at 166–146 and 146–135 | **PASS** |
| 3b | Late Jurassic, Central Graben (2, 56.5) | `sm` | `sm` at both | **PASS** |
| 3c | Late Jurassic, Moray Firth (−2, 58) | `sm` | `sm` at both | **PASS** |
| 3d | Late Jurassic, Viking Graben (2.5, 60.5) | `sm` | `lm`+`sm` at 166–146 → **renders land**; `sm` at 146–135 | **FAIL at 166–146** (Heather Fm open-marine depocentre drawn as land), PASS at 146–135 |
| 3e | Late Jurassic, Egersund Basin (5.5, 57.8) | `sm` | `lm`+`sm` at 166–146 → renders land; `lm` at 146–135 | **FAIL at both** |
| 4a | Frigg 58–49 and 49–37, axis not land | not land | `sm` at all three points, both intervals; never `neither` | **PASS** as "not land"; **PARTIAL as depth** — a deep-water fan site carries the shallow-marine environment class, which the format states is not a depth |
| 4b | Utsira 20–11 and 11–2, axis not land | not land | `sm` at all three points, both intervals | **PASS**, and apt: the type description of the Utsira Fm is shallow marine shelf sandstone |
| 5 | 24-interval series at (2, 57) and (4, 54) | tabulate | §5 | **Reported.** One unflagged anomaly: (4, 54) renders land at 135–117 through an `lm`/`sm` overlap |
| 6 | (not asked) mountain class | — | Cao `m` ground with no `lm`/`sm` renders as "depth unmapped" blue shelf | **FAIL, out of North Sea scope** — needs its own measurement |

---

## 8. Consequence

### 8.1 Points that should become permanent validator witnesses

These are stable statements about the shipped payload that a future compile must
not silently break. Each would go in `BASIN_EDIT_WITNESSES` (for a point an
operation owns) or `WITNESS_CLASSES` (for a point the source owns), in
`scripts/research/palaeo_coastlines_correction.py`. **Expected class sets are
what this memo measured**, so adding them as written locks in today's behaviour;
the two marked *after the fix* must be added only once the corresponding edit
lands, or they will lock in the defect.

| Witness id | Position | Interval | Expected classes | Why it must not drift |
|---|---|---|---|---|
| `orcadian-old-red-sandstone` | (2.0, 57.0) | `380-359` | `["lm"]` | the Old Red Sandstone continent survives into the second Devonian bin; the 402–380 edit must not be read as covering it |
| `southern-north-sea-tornquist-incursion` | (4.0, 54.0) | `380-359` | `["sm"]` | the *negative control* for the same edit: the SE marine margin is deliberately unedited and must stay |
| `rotliegend-auk-pre-desert` | (2.07, 56.4) | `285-269` | `["lm"]` | pins the last land bin before the Zechstein flip |
| `zechstein-auk-field` | (2.07, 56.4) | `269-248` | `["sm"]` | pins the flip itself at the Auk Field position; a compile that loses it loses the Zechstein |
| `brent-delta-plain-north-limit` | (2.0, 60.5) | `179-166` | `["lm"]` | the southern side of the 60°30′N limit — the delta-plain edit's own northern reach |
| `brent-delta-drowned-axis` | (2.0, 61.0) | `179-166` | `["sm"]` | the northern side of the same limit; the pair together is what fixes the shoreline latitude to a 0.5° band |
| `heather-viking-graben` | (2.5, 60.5) | `166-146` | `["sm"]` **after the fix** (today `["lm","sm"]`) | the Heather Fm depocentre must be marine, and the witness must be a *class set*, not an `sm` membership test, or the overlap hides the failure |
| `draupne-viking-graben` | (2.5, 60.5) | `146-135` | `["sm"]` | Draupne/Kimmeridge Clay time in the Viking Graben; already correct, worth locking |
| `tau-egersund-basin` | (5.5, 57.8) | `146-135` | `["sm"]` **after the fix** (today `["lm"]`) | the Egersund Basin source-rock kitchen |
| `frigg-fan-axis` | (2.0, 59.5) | `58-49` | `["sm"]` | the Frigg fan site must never become land, and must never become `neither` either |
| `utsira-shelf` | (2.0, 59.5) | `20-11` | `["sm"]` | the Utsira shelf sand |

**Inference on the witness *form*.** Nine of these eleven are ordinary. The two
Late Jurassic rows are the reason this section exists: the existing witness
machinery already compares a **sorted class set** and would have caught
`["lm","sm"]` against `["sm"]`, but no witness is placed at 166–146 at all, so
the overlap went unmeasured. Extending `WITNESS_INTERVALS` beyond its present
four (`402-380`, `269-248`, `248-224`, `94-81`) to include `179-166`, `166-146`
and `58-49` would cover the three intervals the cited North Sea edits actually
touch and that this memo found failures in.

### 8.2 Mismatches that need a cited basin edit

| Mismatch | Interval(s) | What the edit would have to do | Sources available today |
|---|---|---|---|
| **Viking Graben renders as land at Heather Fm time** | `166-146` | remove the `lm` piece(s) covering the graben axis near (2.5, 60.5); the `sm` piece is already there, so this is a removal, not an addition | NOD HEATHER FM "open marine environment", Bathonian–Kimmeridgian; Vollset & Doré 1984; Underhill & Partington 1993 (https://doi.org/10.1144/0040337) for the deflating dome |
| **Egersund Basin is land through the Late Jurassic** | `166-146`, `146-135` | remove `lm` over the Egersund Basin; add nothing | NOD DRAUPNE FM "marine environment with restricted bottom circulation and often with anaerobic conditions", Oxfordian–Ryazanian; NOD TAU FM (Boknfjord Gp), "Kimmeridgian to Early Volgian", "anaerobic marine environment with high organic productivity and restricted bottom water circulation" |
| **Southern North Sea renders as land at 135–117** | `135-117` | remove `lm` over (4, 54); `sm` is already there | Rawson & Riley 1982 (https://doi.org/10.1306/03B5AC87-16D1-11D7-8645000102C1865D): the base of the Valhall Formation is "isochronous, and conformable", marking the late Ryazanian transgression |

**Inference on what must *not* be edited.** Three of the failures in §7 are not
edit candidates:

- **1d, the Auk desert inside the Zechstein bin.** The two states are 10 Myr
  apart inside a 21 Myr maximum-transgression bin. An edit could only pick one,
  and the marine end member is the one the bin's own semantics select. The
  correct response is the limitation line, not geometry.
- **2b, the Brent advance–retreat–advance cycle.** Same reason, and the memo
  that introduced the edit already says so.
- **4a, Frigg drawn as shallow marine.** `sm` is an environment class, not a
  depth. Introducing a deep-marine class is a format change, not a basin edit,
  and it would need a depth source per polygon that Cao 2017 does not carry.

**Inference on §6.** The withheld mountain class rendering as "depth unmapped"
blue shelf needs its own global measurement — how much `m`-only ground exists per
interval, and where — before anyone decides between shipping `m`, painting an
`m`-only fallback tone, or documenting it. It is not a North Sea item and should
not be attached to `north-sea.json`.

---

## Reproduction

```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
$PY <probe>   # imports palaeo_coastlines_compile read-only; decodes
              # public/data/reconstruction/cao-v2.4/palaeo-coastlines/{lm,sm}/*.ehpr,
              # unions each class per interval and tests shapely contains()
```

The probe scripts, their raw JSON and the digest listing were written to the
session scratch directory
`/private/tmp/claude-501/-Volumes-EksternalHome-Koding-HTML-EarthHistory/795e3aa9-9911-4167-b7c7-76edc2aba7b8/scratchpad/fm-checks/`
(`probe.py`/`probe.json` for checks 1–4 and the time series, `probe2.py` for the
`neither` controls, `probe3.py` for the 0.25° Brent transect and the Horda
Platform series, `probe4.py`/`probe5.py` for the mountain-class diagnosis).
That tier expires; every number this memo relies on is quoted above.

## Appendix — sha256 of every payload read

All 50 digests equal the values the shipping class catalogs pin on them,
re-verified this session.

| File | Bytes | sha256 |
|---|---:|---|
| `palaeo-lm-11-2.ehpr` | 185978 | `9bbeb82f19ad82d06f4fd72dea1fc644ae7647bb83f0abf87c92a4dcdc33f6ac` |
| `palaeo-lm-117-94.ehpr` | 151330 | `edf0831d18511c2a79df7810c14e9c18b391fb61657ba26079fb05f540549101` |
| `palaeo-lm-135-117.ehpr` | 159602 | `8e560f03328c806169a49951d53cef7694c01d66c7b263fc278fce341dac591c` |
| `palaeo-lm-146-135.ehpr` | 153156 | `292de9daac3dc007fe77d5abc2c31e4142be6de8bae2ad3509d7722c2cd3dfb8` |
| `palaeo-lm-166-146.ehpr` | 158814 | `141a22021974a487630ad693b4c9eb6af922941780cc7802b9a16e4c366438f9` |
| `palaeo-lm-179-166.ehpr` | 133588 | `e692f49aac87ca3454f2d1a6a7f735f89d16c1a621dacb96926d4eb7ef43d776` |
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
| `palaeo-lm-49-37.ehpr` | 170324 | `083c5f7f555678a8d58da3b594c5cde7b992990bc9398a1a3a7881762a643231` |
| `palaeo-lm-58-49.ehpr` | 163712 | `4111b22d51f48527e4075552fc5926bfa4ca54de92f0870aa1703f761868b491` |
| `palaeo-lm-81-58.ehpr` | 141600 | `f0e7fc3ed72beac5f348e018d410539a05fb0ad70bab1cbcbe1bc58328da847e` |
| `palaeo-lm-94-81.ehpr` | 137316 | `8018b1ab8c557a8341cdc082376bd79c0180f0a0f77b96d55747f391dd60608f` |
| `palaeo-lm-catalog.json` | 33402 | `25ec4880a0441775a2d27b798713e97a007a6e5a0d63b8ddb08bd39fb7841e41` |
| `palaeo-lm-lgm.ehpr` | 40746 | `d55434da5ff5320b95f45e651ce6174d904d7a8c564e95f1015678b610e501fe` |
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
| `palaeo-sm-catalog.json` | 49491 | `b508690406da04b9981615edaba16adf9e4b80cc8ef9f6630c9d0d76bd89fdf6` |
| `palaeo-sm-lgm.ehpr` | 32 | `8547cf88b309c0a2120a0f5e0093f6eadc8a43cda013eb967657fefade4c038f` |
