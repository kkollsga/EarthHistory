# Iceland and the NE Atlantic in the palaeo-coastline layer

Research and probe date: 2026-09-15. Read-only measurement of the **public**
payloads under `public/data/reconstruction/cao-v2.4/palaeo-coastlines/` and of
the shipped Iceland regional correction, against the published record for
Iceland's crustal age structure and subaerial history. Companion to
[palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md) (what the source
is), [palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what
the publications say), [regional-iceland-correction.md](regional-iceland-correction.md)
and [regional-iceland-shallow-shelf.md](regional-iceland-shallow-shelf.md)
(what the app already ships for Iceland), and
[palaeo-coastlines-north-sea-formation-checks.md](palaeo-coastlines-north-sea-formation-checks.md)
(the probe method this memo reuses).

It answers one question the user asked from a NE Atlantic tectonic map:
**can Iceland be made to follow its own growth pattern in the palaeo-coastline
layer, and what would the contract have to say?** It changes nothing. Nothing
here has entered a build.

Every statement is tagged **Measured** (this probe measured it from the pinned
bytes), **Verbatim** (the cited source says it in these words), **Snippet** (a
retrieved summary, not verified against the publication's own page) or
**Inference** (EarthHistory's reading).

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Git HEAD | `192cc224cf59f198587afd000626f0725c96c5a9` |
| Working tree at probe time | modified: `data/corrections/palaeo-coastlines/basins/north-sea.json`, `data/corrections/requested-age-motion-tiles/source-contract.json`, `docs/data/README.md`, three `docs/research/*.json`, five files under `public/data/`, three `scripts/research/*.py`, four `src/**` files, `src/styles.css`. **A parallel implementation agent was editing `public/`.** Every payload digest quoted below was recomputed here and is recorded with the reading it supports. No file under `public/data/reconstruction/cao-v2.4/palaeo-coastlines/` was modified, so all 50 palaeo payloads read here are the committed HEAD payloads; `corrections/material-v1/catalog.json` **was** modified and its lifecycle table was read from the working tree, not from HEAD. |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` (pyGPlates 1.0.0, Shapely 2.0.7) |
| Classification method | the validator's own, imported read-only: `palaeo_coastlines_compile.decode_ehpr` + `piece_geometry`, point-in-polygon with `contains` (strict on a boundary) |
| Integrity | **Measured.** All 50 payloads (`lm` and `sm`, 24 canonical intervals plus `lgm`) were re-hashed; every `sha256` equals the digest its own class catalog pins. 25 `lm` ok / 0 bad, 25 `sm` ok / 0 bad. |

Payload digests for the three intervals this memo is about:

| Class | Interval | Bytes | sha256 |
|---|---|---:|---|
| `lm` | `20-11` | 172,812 | `174c1b598689bad99e60d50c5e4019139d3709410833052c30f719d974919217` |
| `lm` | `11-2` | 185,978 | `9bbeb82f19ad82d06f4fd72dea1fc644ae7647bb83f0abf87c92a4dcdc33f6ac` |
| `lm` | `lgm` | 40,746 | `e928401e12eaf52e6ad6952fa9b0140b0171bd3e927d76b3880030a0f2e06c2e` |
| `sm` | `20-11` | 174,932 | `c00ada47eac3d744057f59f031b43dbc9c0ce091cd350d630c7425b11605555e` |
| `sm` | `11-2` | 173,072 | `388db45068d2336505f1e10ad14de996b5a50b3227b4af368cfc51eec129b820` |
| `sm` | `lgm` | 32 | `8547cf88b309c0a2120a0f5e0093f6eadc8a43cda013eb967657fefade4c038f` (header only, zero pieces) |

Also read: `public/data/reconstruction/cao-v2.4/corrections/material-v1/catalog.json`
(212 charts, 10 correction ids), `data/corrections/iceland/iceland-surface-material-v1.geojson`,
`data/corrections/palaeo-coastlines/lgm/lgm-lowstand-v1.manifest.json`, the Cao
v2.4 `static_polygons.gpmlz` / `shapes_continents.gpmlz` / both rotation files,
and the offline NÍ source snapshot at
`../EarthHistory-data/palaeomap-study/verification/regional-iceland-correction-v1/source-inputs`.

---

## 1. What the app shows for Iceland today

### 1.1 The palaeo-coastline layer: Iceland is never land

**Measured**, point probe, `contains`, all 18 witnesses:

| Point | `lm` 20–11 | `sm` 20–11 | `lm` 11–2 | `sm` 11–2 | `lm` lgm | `sm` lgm |
|---|---|---|---|---|---|---|
| Iceland W, Faxaflói (−22, 64.5) | — | **sm** | — | **sm** | — | — |
| Iceland central (−18, 65) | — | **sm** | — | **sm** | — | — |
| Iceland E, Eastfjords (−15, 65) | — | — | — | **sm** | — | — |
| Iceland SE, Vatnajökull margin (−14.5, 64.3) | — | — | — | — | — | — |
| Iceland NW, Húnaflói (−21, 66) | — | **sm** | — | **sm** | — | — |
| Iceland NW tip, Vestfirðir (−23.5, 66.2) | — | **sm** | — | **sm** | — | — |
| Iceland S coast (−19, 63.6) | — | — | — | **sm** | — | — |
| Iceland E coast, Borgarfj. eystri (−13.8, 65.5) | — | — | — | — | — | — |
| Greenland–Iceland Ridge (−27, 66.5) | — | **sm** | — | **sm** | — | — |
| Iceland–Faroe Ridge mid (−10, 63.2) | — | **sm** | — | — | — | — |
| GIFR SE (−12, 63.5) | — | — | — | — | — | — |
| Faroe Islands (−7, 62) | — | **sm** | — | **sm** | — | — |
| Jan Mayen (−8.5, 71) | — | — | — | — | — | — |
| Jan Mayen microcontinent S (−9.5, 69.5) | — | — | — | — | — | — |
| Jan Mayen microcontinent N (−7.5, 71.5) | — | — | — | — | — | — |
| Faroe–Shetland Basin (−4, 61) | — | **sm** | — | **sm** | — | — |
| E Greenland coast (−24, 70) | **lm** | — | **lm** | — | — | — |
| Reykjanes Ridge crest (−25, 62.5) | — | — | — | — | — | — |

**Measured**, area over a window `[−27, 62, −10, 68]` (Iceland plus both
flanking ridges), union of all intersecting pieces:

| Interval | `lm` pieces / deg² | `sm` pieces / deg² |
|---|---|---|
| 29–20 | 0 / 0.0000 | 10 / 24.3569 |
| 20–11 | 0 / 0.0000 | 12 / 39.1433 |
| 11–2 | 0 / 0.0000 | 13 / 58.2000 |
| `lgm` | 0 / 0.0000 | 0 / 0.0000 |

**The finding.** Cao et al. (2017) draw **zero landmass anywhere over Iceland,
the Greenland–Iceland Ridge or the Iceland–Faroe Ridge at 29–20, 20–11 and
11–2 Ma.** Iceland is shallow marine throughout, and the shallow-marine area
*grows* 24.4 → 39.1 → 58.2 deg², so the model does carry a growing Icelandic
platform — it simply never lifts it above sea level. A 0.5° grid over
`[−27 … −6]` × `[62 … 72]` shows the same thing at every cell; the only `lm`
in the window is Greenland, in the NW corner.

**Measured**, the same grid one and two intervals earlier, which is the
surprise:

- At **37–29 Ma** Cao draws a large **landmass over the Iceland–Faroe Ridge and
  the Faroes**, roughly −20 … −6 °E and 60 … 65.5 °N, continuous from the
  eastern Icelandic shelf to the Faroe Platform. The witness at (−12, 63.5)
  and the Faroes witness at (−7, 62) both read `lm`.
- At **29–20 Ma** that land is gone; the Faroes read `lm`+`sm` (`B`), and the
  Greenland–Iceland Ridge side turns shallow marine.

**Inference.** The model's own GIFR land bridge exists at 37–29 and closes
before 20 Ma. That is the *opposite* sense from the palaeobotanical record
(§2.4), which puts a North Atlantic corridor in the Miocene. Whatever is done
for 20–11 and 11–2 has to be read against that neighbouring interval, not in
isolation.

### 1.2 The native app: a partial Iceland already exists, and not only at 0 Ma

The brief for this work described the Iceland regional correction as "0 Ma
only". **Measured from `corrections/material-v1/catalog.json`, that is true of
one chart out of fourteen.** Resolving the interned lifecycle dictionary:

| Chart (× plate 101 and plate 301) | Lifecycle `validTimeMa` | Active at |
|---|---|---|
| `iceland-modern-*:observed` | oldest 0, youngest 0 | exactly 0 Ma |
| `iceland-gold-*:model-pose` | oldest 3.3, youngest 0, youngest exclusive | (0, 3.3] Ma |
| `iceland-gold-*:formation` | oldest 16.3, youngest 3.3, youngest exclusive | (3.3, 16.3] Ma |
| `iceland-gnew-*:model-pose` | oldest 0.8, youngest 0, youngest exclusive | (0, 0.8] Ma |
| `iceland-gnew-*:formation` | oldest 3.3, youngest 0.8, youngest exclusive | (0.8, 3.3] Ma |
| `iceland-hraun-*:formation`, `iceland-mob-*:formation` | oldest 0.8, youngest 0, both bounds exclusive | (0, 0.8) Ma |

Every non-modern chart carries `surfaceEvidence` kind `unknown`, reason
**Verbatim** from the catalog: *"mapped present outcrop age constrains material
existence but not palaeoshoreline, exposure, or height"*, and evidence
`poseStatus: model-inference`.

**Measured** class footprints from the tracked correction GeoJSON (exact
great-circle areas, `pygplates.PolygonOnSphere.get_area()`):

| Class | Source age meaning | Area (km²) | Bounds (°E, °N) |
|---|---|---:|---|
| `modern` (Natural Earth 1:50m) | present-day land | 101,155.4 | −24.476 … −13.556, 63.407 … 66.526 |
| `gold` | older than 3.3 Ma | 35,803.4 | −24.534 … −13.500, 63.963 … 66.467 |
| `gnew` | 0.8–3.3 Ma | 14,627.6 | −23.493 … −14.533, 63.545 … 66.568 |
| `hraun` | younger than 0.8 Ma | 11,813.8 | −23.953 … −15.291, 63.402 … 66.540 |
| `mob` | younger than 0.8 Ma | 9,858.7 | −23.871 … −15.362, 63.317 … 66.491 |
| `gold` ∪ `gnew` | older than 0.8 Ma | 50,394.0 | — |
| all four bedrock classes | — | 103,232.1 | −24.534 … −13.500, 63.317 … 66.568 |

**Independent corroboration.** Harðarson, Fitton & Hjartarson (2008) state
**Verbatim**: *"The Tertiary and Plio-Pleistocene rocks cover approximately half
of the total area of Iceland (103,000 km2), or 36,000 km2 and 15,000 km2
respectively."* The measured `gold` and `gnew` areas — 35,803 and 14,628 km² —
reproduce the published 36,000 and 15,000 km² to better than 3%. The NÍ
extraction is faithful to the published map.

### 1.3 What that means on screen, and the LGM case

**Measured** from `src/render/reconstruction/caoFoundation.ts`, the surface
shell table:

| Class | renderOrder | visible in native mode | visible in palaeo mode | writes depth |
|---|---:|---|---|---|
| `shelf` | 1 | yes | yes | yes |
| `palaeo-shallow-marine` | 1.2 | no | yes | no |
| `corrections` | 1.5 | **yes** | **yes** | no |
| `palaeo-land` | 1.7 | no | yes | yes |
| `palaeo-mountain` | 1.8 | no | yes | yes |
| `land` (native Cao 2024) | 2 | yes | **no** | yes |

**Inference, and it is load-bearing for the design.** The `corrections` shell
stays visible with the palaeo layer on, above `palaeo-shallow-marine` and below
`palaeo-land`. So the app **already draws a partial Iceland inside both target
intervals**: at any age in (2.01, 11] the `gold:formation` outcrop
(35,803 km²) is painted in the correction colour over Cao's teal shallow sea,
and at any age in (11, 16.3] the same chart is still active. Above 16.3 Ma the
correction has no chart at all, so 16.3–20 Ma of the `20-11` bin is bare ocean.

**Measured**, Cao 2024 continental crust (`shapes_continents.gpmlz`): **no
continental-crust polygon contains any Iceland, GIFR, Greenland–Iceland-Ridge
or Jan Mayen witness.** Only the Faroes witness does, on plate 301. So the
"neither" complement over Iceland renders as open ocean, not as the blue
`shelf` class — there is no depth-unmapped shelf tone to fall back on.

**The LGM.** `lgm` is a declared detached interval
(`detachedIntervalIds: ["lgm"]`) and its contract is explicitly regional:
**Verbatim** from `lgm-lowstand-v1.manifest.json`, *"This is a regional state,
not a global palaeogeography. Outside the three footprints the LGM interval
draws no palaeo land and the present-day composition stays on screen."* Its
three footprints are the North Sea (−6 … 12 °E, 49 … 62 °N), Sundaland and
Beringia. **Iceland is outside all three**, and `sm/lgm` is a 32-byte
header-only payload with zero pieces. `GlobeScene.applyNativeSurfaceMode`
keeps the native stack in the LGM band, so at 19.5–26.5 ka Iceland shows the
native composition: no Cao 2024 land, the `modern:observed` chart **off** (its
lifecycle is exactly 0 Ma), and `gold:model-pose`, `gnew:model-pose`,
`hraun` and `mob` **all active** — i.e. the full 103,232 km² bedrock footprint,
with no lowstand extension of any kind and no ice.

---

## 2. What the literature supports

### 2.1 Iceland's crustal age structure

Sæmundsson (1979), *Outline of the geology of Iceland*, Jökull 29, 7–28.
**Verbatim**:

> Superpositioning and the present configuration of axial rift zones predict
> that the oldest exposed rocks in Iceland should occur in the farthest
> northwest, north and east. Radiometric dating of the lowest exposed levels in
> the east indicate that the oldest rocks in that area are just over 13 m.y. As
> yet ages from the northwest and north are fragmentary, but cluster around
> 16 m.y. for a deep stratigraphical level in the northwest. Ages from northern
> Iceland indicate that the oldest part of the lava pile there may be around
> 12 m.y.

and, on the shape of the outcrop, **Verbatim**:

> The unequal disposition of the Tertiary series which is nowhere exposed south
> of lat 64° but occupies the greater part of Iceland north of lat 65° (Fig. 1)
> is probably the result of such displacements.

and **Verbatim**: *"The predominantly volcanic pile of Iceland which ranges in
age back to about 16. m.y."*; *"The Tertiary sequences are made up of subaerial
tholeiitic lavas"*; *"Tertiary: rocks older than 3.1 m.y."*

Harðarson, Fitton & Hjartarson (2008), *Tertiary volcanism in Iceland*, Jökull
58, 161–178. **Verbatim**:

> The oldest subaerial rocks are found at the NW and E extremes of the island.
> In the NW peninsula they date back to more than 15 Ma (Moorbath et al., 1968;
> McDougall et al., 1984; Hardarson et al., 1997; Pringle et al., 1997) and to
> about 14 Ma in E Iceland (e.g. McDougall et al., 1976; Watkins and Walker,
> 1977). The oldest rocks in N Iceland have been dated at about 12 Ma
> (Sæmundsson et al., 1980; Jancin et al., 1985).

> The oldest rocks, around 14–16 Ma, are found at the tip of peninsulas in E and
> NW Iceland, separated by 480 km. If this age is multiplied by the spreading
> rate the outcome is 15 Ma x 18.3 mm/yr = 275 km. This predicted width is about
> 40% less than the actual width of the country.

> The bulk of the Tertiary areas is made up of subaerial tholeiitic flood
> basalts separated by minor clastic interbeds, usually of volcanic origin.

> Iceland, and its insular shelf, cover about 350,000 km2 and rises more than
> 3000 m above the surrounding deep-ocean floor. About 103,000km2 of the area
> is above sea level, the rest surrounding the island as a 50–200 km wide
> insular shelf sloping gently to depths of around 400 m before dropping
> steeply to the deep-ocean floor.

Their Table 1, rift-zone initiation times (**Verbatim** values, references as
printed): Northwest Iceland rift zone **24 Ma** (Hardarson et al. 1997);
Snæfellsnes–Húnaflói **15 Ma** (Hardarson et al. 1997); Western–Northern
**6–7 Ma** (Sæmundsson 1980); Eastern **2–3 Ma** (Sæmundsson 1980);
Skagafjörður **1.6–1.7 Ma** (Hjartarson 2003). Also **Verbatim**: the NW
Iceland rift *"became extinct by 15 Ma"* and *"about 8 million years separate
these two rift extinction events"*; the SH rift *"had died out by 7–5 Ma"*; the
Eastern Volcanic Zone is propagating *"into crust that at depth may be 20
million years old"*.

**Inference.** Three facts follow that a map can use. (a) Age increases
outward from the neovolcanic zones toward the NW, N and E coasts, and the
oldest exposed crust is ~15–16 Ma (NW), ~13–14 Ma (E), ~12 Ma (N). (b) The
pile is **subaerial**, so crust that existed and was Tertiary-Icelandic was, at
formation, land. (c) The exposed outcrop is a *minimum*: Sæmundsson notes the
dated ages come from *"the uppermost 1000 m of the pile below which another 2—5
km of lavas at least must be expected"*, and the EVZ is propagating into 20 Myr
crust at depth. Today's neovolcanic zones sit on older crust that was already
land.

### 2.2 When Iceland as we know it appeared

Harðarson et al. 2008, **Verbatim**:

> An ancestral Iceland may have formed a land mass over the mantle plume off
> the east coast of Greenland. The Greenland-Iceland-Faeroes Ridge represents a
> hot-spot trail which may have been partly above sea level because of the
> thermal anomaly caused by the plume. This is supported by palaeobotanical
> evidence which suggests that proto-Iceland was connected to the continents
> via a continuous land bridge, or a chain of islands, from the early Cenozoic
> and into the middle Miocene (Grimsson et al., 2007). However, Iceland, as we
> know it today, was probably formed during Anomaly 6 when the present day
> tectonic framework and the plume-ridge interaction were initiated resulting
> in excessive volcanism creating a large island.

and **Verbatim**: *"During Anomaly 6 (24–19 Ma ago), the Mid-Atlantic Ridge axis
moved on top of the mantle plume and then gradually west of it"*; the plume
*"reached the Mid-Atlantic Ridge at ~25 Ma"*.

Ellis & Stoker (2014), *The Faroe–Shetland Basin: a regional perspective from
the Paleocene to the present day*, GSL SP 397, 11–31, **Verbatim** from the
abstract:

> we propose a dual rift model whereby North Atlantic break-up was only partial
> until the Oligo-Miocene, with true final break-up only being achieved when the
> Reykjanes and Kolbeinsey ridges became linked. As final break-up coincides
> with the appearance of Iceland, this model negates the need for a plume to
> develop the North Atlantic

Blischke et al. (2022), G-Cubed 23, **Verbatim** from the abstract:

> The proto-Kolbeinsey Ridge formed at ∼22–21 Ma and connected to the Reykjanes
> Ridge via the Northwest Iceland Rift Zone, near the center of the hotspot.
> Eastward rift transfers, toward the proto-Iceland hotspot, commenced at
> ∼15 Ma, marking the initiation of segmented rift zones comparable to
> present-day Iceland.

**Inference.** Four independent lines put the birth of the present Icelandic
tectonic framework in a ~25–19 Ma window, and the modern segmented-rift Iceland
from ~15 Ma. The `20-11` bin therefore straddles the transition: at its old end
(20 Ma) an Iceland of today's kind barely exists; at its young end (11 Ma) the
NW, N and E flanks of the modern island were already subaerial lava plateau.

### 2.3 Jan Mayen and the continental sliver

Torsvik et al. (2015), *Continental crust beneath southeast Iceland*, PNAS 112,
**Verbatim** from the abstract:

> we propose that continental crust beneath southeast Iceland is part of
> ∼350-km-long and 70-km-wide extension of the Jan Mayen Microcontinent (JMM).
> The extended JMM was marginal to East Greenland but detached in the Early
> Eocene (between 52 and 47 Mya); by the Oligocene (27 Mya), all parts of the
> JMM permanently became part of the Eurasian plate following a westward ridge
> jump in the direction of the Iceland plume.

and, from the body (**Verbatim**, retrieved from the article page):
*"The classic JMM is ∼500 km long (200 km at its widest and shown with four
continental basement ridges), and crustal thicknesses are about 18–20 km"*;
*"The Aegir Ridge became extinct from the south … to the northern part of the
Norwegian Sea (at 27 Ma)"*; and, on the Iceland–Faroe Ridge, *"The resulting
crust—most likely of oceanic origin—is now covered by younger lavas (the
Iceland-Faroe Ridge), which obscure its original characteristics."*

Gaina, Gernigon & Ball (2009), JGS 166, 601–616, **Verbatim** from the abstract:
*"Among the consequences of numerous plate boundary relocations is the formation
of a highly extended or even fragmented Jan Mayen microcontinent"*; the major
reorganization is *"Oligocene"*, and the model *"implies a series of failed
ridges offshore the Faeroe Islands, a northern propagation of the Aegir Ridge NE
of the Jan Mayen microcontinent"*. Gernigon et al. (2019), *Earth-Science
Reviews* 206, **Verbatim**: the rift reorganization resulted in *"the final
dislocation of the Jan Mayen Microplate Complex from Greenland, in the Late
Oligocene/Early Miocene."*

**Note on the brief's numbers.** The task described "Aegir ridge extinction
~26 Ma, Kolbeinsey ridge ~24 Ma". The values actually retrieved are Aegir
extinction **29 Ma in the south to 27 Ma in the north** (Torsvik et al. 2015)
and proto-Kolbeinsey at **~22–21 Ma** (Blischke et al. 2022), with Gernigon et
al. 2019 placing final JMMC dislocation in the Late Oligocene/Early Miocene.
The design below uses the retrieved values, not the brief's.

**Inference.** Nothing retrieved says the Jan Mayen microcontinent was
**subaerial** in the Miocene. Torsvik's JMM is a submerged, thinned continental
ribbon; Blischke's subaerial volcanism is Eocene (~55–53 Ma) on the
microcontinent's eastern margin, and the IPR III–IV phase (~35–23 Ma) is
described with *"uplift, regional tilting, and erosion"* — an erosional
unconformity, not a mapped land extent. No 20–11 or 11–2 Ma Jan Mayen land
polygon is defensible.

### 2.4 The Greenland–Iceland–Faroe Ridge as a land bridge

Denk, Grímsson & Zetter (2010), *Episodic migration of oaks to Iceland:
Evidence for a North Atlantic "land bridge" in the latest Miocene*, American
Journal of Botany 97, 276–287, **Verbatim** from the abstract:

> Traditionally, the NALB has been assumed to have functioned as a corridor for
> plant migration only during the early Cenozoic, but recent findings of plant
> fossils and inferences from molecular studies are challenging this view. Here,
> we report dispersed pollen of Quercus from Late Miocene sediments in Iceland
> … Older (15 to 10 Ma) sediments do not contain pollen of Quercus suggesting it
> arrived after that time. Pollen from the 9-8 Ma Hrútagil locality is
> indistinguishable from morphotypes common among white and red oaks. In
> contrast, pollen from the 5.5 Ma Selárgil locality has a tectum that is at
> present confined to North American white and red oaks, indicating a second
> episode of migration to Iceland. These findings suggest that transatlantic
> migration of temperate plant taxa may not have been limited by vast areas of
> sea or by cold climates during the Miocene.

Denk, Grímsson, Zetter & Símonarson (2011), *Late Cainozoic Floras of Iceland:
15 Million Years of Vegetation and Climate History in the Northern North
Atlantic*, Topics in Geobiology 35, Springer — the title itself is the
15 Ma statement; chapter 12 is *The Biogeographic History of Iceland – The
North Atlantic Land Bridge Revisited* (pp. 647–668) and chapter 13 is *Climate
Evolution in the Northern North Atlantic – 15 Ma to Present* (**Snippet**:
chapter titles and pagination from Crossref; the chapters themselves were not
opened). Sæmundsson (1979) **Verbatim**: *"The palaeobotanical record is more or
less continuous for the last 16 m.y."*

**Inference, and the correction to the brief's premise.** The brief asked
whether the GIFR land bridge lasted "to ~15 Ma". The retrieved evidence says
the opposite about the *end* of the corridor: Icelandic sediments go back to
~15 Ma and are *barren* of Quercus until 9–8 Ma, and the migration events are
**Late Miocene (9–8 Ma) and Early Pliocene (5.5 Ma)**. The ~15 Ma figure is the
base of the Icelandic fossil record, not the end of the corridor. Two separate
claims must therefore not be merged: *Iceland has a continuous subaerial
palaeobotanical record from ~15–16 Ma* (Sæmundsson 1979; Denk et al. 2011), and
*a transatlantic dispersal route existed at 9–8 and 5.5 Ma* (Denk et al. 2010).
Neither gives a plan-view GIFR land extent at any age, and Denk et al. 2010
explicitly leave open that the route was stepping-stone rather than continuous.

### 2.5 The plume and the V-shaped ridges

Parnell-Turner et al. (2014), *A continuous 55-million-year record of transient
mantle plume activity beneath Iceland*, Nature Geoscience 7, 914–919. Fragments
quoted back from the Birmingham repository record (**Verbatim** where in quotes,
otherwise **Snippet**): *"V-shaped ridges have formed over the past 55 million
years—providing the longest record of plume periodicity of its kind"*;
*"minor, but systematic, asymmetric formation of crust, due to migration of the
mid-ocean ridge with respect to the underlying plume"*. **Snippet**: 55–35 Ma
ridges every ~3 Myr with 5–10 °C fluctuations; from 35 Ma a ~8 Myr periodicity
with 25–30 °C variations.

**Inference.** The V-shaped ridges are a real, dated, plume-pulse record and
they are the natural subject of a seafloor-age/ridge-growth layer (§6), but
they are *oceanic* features. They carry no subaerial land claim and they are
not renderable in the `lm`/`sm` class pair. They belong to the follow-up
programme, not to this basin contract.

### 2.6 The Faroes

Ólavsdóttir, Eidesgaard & Stoker (2016), GSL SP 447, 339–356, **Verbatim** from
the abstract: *"The Cenozoic succession is dominated by the syn-break-up Faroe
Islands Basalt Group, which crops out on the Faroe Islands (where it is up to
6.6 km thick) and shelf areas"*; *"almost every sub-basin in the Faroe–Shetland
Basin has been affected by structural inversion, particularly during the
Miocene"*; *"The structure of the Iceland–Faroe Ridge … remains ambiguous. The
generally thick crust, together with the absence of well-defined
seawards-dipping reflectors, may indicate that much of it is underlain by
continental material."*

**Inference.** Miocene inversion of the Faroe–Shetland sub-basins and the Faroe
Platform is an uplift signal in the right bin, but it is a structural statement
with no shoreline. The Iceland–Faroe Ridge's own crustal nature is stated to be
unresolved. Neither supports a drawn Faroese land polygon at 20–11 or 11–2 Ma.

---

## 3. What Iceland's land extent defensibly was

| Interval | Defensible statement | Class the map can carry |
|---|---|---|
| **20–11 Ma** (ages 11.01 … 20) | An Icelandic volcanic edifice existed and the present tectonic framework was established at ~25–19 Ma; **no exposed crust anywhere in Iceland is older than ~16 Ma**, so the land that existed at 20 Ma left no mapped record and its extent is unknown. By the young end of the bin, the NW peninsula (>15 Ma), the E peninsula tips (13–14 Ma) and, marginally, N Iceland (~12 Ma) were subaerial lava plateau. | a **minimum** land footprint over the NW, N and E flanks only, valid for the young half of the bin; **nothing** for 16.3–20 Ma |
| **11–2 Ma** (ages 2.01 … 11) | The subaerial Tertiary pile of the NW, N, W and E flanks — everything the NÍ map classes older than 3.3 Ma — existed and was land somewhere in this bin, with old crust also underlying today's neovolcanic zones. The palaeobotanical record is continuous and includes 9–8 Ma and 5.5 Ma transatlantic dispersal. | **land** over at least the `gold` outcrop, 35,803 km²; an upper bound approaching the whole modern island |
| **`lgm`** (19.5–26.5 ka) | Iceland was land, and was under the Icelandic Ice Sheet, whose extent reached beyond the present coast onto the shelf. The shipped LGM contract is a −120 m eustatic lowstand over three named footprints and Iceland is not one of them. | **no change**: an Icelandic LGM state would need its own ice-sheet source and a separate footprint; a −120 m contour alone would draw shelf as land without the ice that actually covered it |

**Uncertainties that must travel with any of this.**

1. **Outcrop is a lower bound on land, not the land.** Erosion, burial under
   younger lavas, glacial excavation and subsidence all remove area. The 2–5 km
   of unexposed pile beneath the dated top kilometre, and the EVZ propagating
   into 20 Myr crust, both say the true 11 Ma island was wider than its
   outcrop. A reasonable bracket for 11–2 Ma is `gold` (35,803 km², minimum) to
   the modern outline (101,155 km², maximum); the contract should draw the
   minimum and say so.
2. **Excess spreading.** Harðarson et al.'s own arithmetic — 480 km of 14–16 Ma
   separation against 275 km predicted from the spreading rate, *"about 40%
   less than the actual width of the country"* — means no kinematic
   back-calculation of the island's width from the spreading rate is reliable.
   Hjartarson's 25 dated central volcanoes drifted on average 70% farther than
   predicted.
3. **Migrating rifts.** Five rift zones initiated at 24, 15, 6–7, 2–3 and
   1.6–1.7 Ma, and the ~130 km 6–7 Ma jump alone moved the locus of accretion.
   An island that grew by symmetric accretion about one axis is not the
   published history.
4. **Class floor.** The compiler's ~30 km class floor and the 25 km² piece
   floor are coarser than the fjord-scale detail of the outcrop map. Anything
   drawn here is a plateau-scale silhouette.
5. **A map interval records the maximum land mapped anywhere in the bin.**
   The 20–11 bin is 9 Myr long and spans the appearance of the modern rift
   framework; one geometry cannot be right at both ends.

---

## 4. Two constraints that any contract has to be designed around

### 4.1 The NÍ layer's age resolution stops at 3.3 Ma

**Measured** from the pinned SLD of `NATT:ISL_IINH_500k_BA` (the layer id keeps
the older 1:500,000 name; the pinned metadata identifies the lineage as
*NI_J600v Jarðfræðikort af Íslandi 2. útgáfa – Berggrunnur – 1:600.000*,
compiled by Haukur Jóhannesson, earlier editions by Haukur Jóhannesson and
Kristján Sæmundsson, screen-digitised 1997 from the printed 1st edition of 1989,
revised 1998, 2009 and 2014; bbox −24.745 … −13.189 °E, 63.210 … 66.571 °N;
CC BY 4.0). The single classifying attribute is `flokkur`, and its complete
legend is:

| `flokkur` | Legend title (**Verbatim** from the SLD) |
|---|---|
| `gold` | Basic and intermediate extrusive rocks with ingercalated sediments. Upper Tertiary, older than 3.3 m.y. |
| `gnew` | Basic and intermediate extrusive rocks with ingercalated sediments. Upper Pliocene and lower Pleistocene, 0.8-3.3 m.y. |
| `hraun` | Basic and intermediate interglacial and supraglacial lavas with intercalated sediments. Upper Pleistocene, younger than 0.8 m.y. |
| `mob` | Basic and intermediate hyaloclastite, pillow lava and associated sediments. Upper Pleistocene, younger than 0.8 m.y. |
| `bold` / `bnew` | Basic and intermediate lavas. Postglacial, prehistoric older than / historic younger than 1100 years |
| `sold` / `snew` | Acid lavas. Postglacial, prehistoric / historic |
| `sgos` | Acid extrusives. Tertiary and Pleistocene, older than 11.000 years |
| `binn` | Basic and intermediate intrusions, gabbro, dolerite and diorite |
| `sinn` | Acid intrusions, rhyolite, granophyre and granite |
| `sn` | Holocene sediments |

**Measured**, the acquired GeoJSON: `bedrock-old.geojson` carries 1,074 features
with only `id` and `flokkur` (885 `gold`, 189 `gnew`); `bedrock-young.geojson`
carries 1,267 features (478 `hraun`, 789 `mob`). **There is no numeric age
field anywhere in the acquired dataset.**

**The blocker, stated plainly.** The brief's design — *"units older than the
interval's youngest age = land, using the NÍ dataset's age attributes"* — is
executable **only at 3.3 Ma and 0.8 Ma**. `gold` is a single undifferentiated
"older than 3.3 m.y." class that lumps 16 Ma NW crust with 4 Ma crust beside
the rift zones. It cannot be cut at 11 Ma, at 2.01 Ma, or at any other value.
For **11–2 Ma** the 3.3 Ma cut is 1.3 Myr older than the bin's young bound, so
`gold` is a slight *under*-claim and is usable directly. For **20–11 Ma** the
attribute answers nothing at all, and the geometry has to come from the
*published age localities* (§2.1) applied as geographic bounds on `gold` —
which is an EarthHistory inference about where the >11 Ma crust is, not a
source claim.

### 4.2 The Cao 2024 pose closes Iceland at ~12 Ma and then inverts it

**Measured** from `static_polygons.gpmlz`: the present-day Cao 2024 partitions
over Iceland are plate **102 "Greenland"** in the west and plate **301
"Eurasia"** in the east — *not* the plate 101 / 301 pair the existing regional
correction uses. The seam crosses the island from (−23.34, 63.6) through
(−21.49, 64.4), (−19.46, 65.2) to (−18.21, 66.4).

**Measured**, plates 101 and 102 are **exactly co-moving** in this model over
0–29 Ma: a witness at (−22.0, 65.5) reconstructs to the same point under both,
0.0 km separation at 2, 5, 11, 16.3, 20 and 29 Ma. So the two-plate pose is
*kinematically* the same as the correction's; only the seam line differs, and
that difference must be checked rather than assumed harmless.

**Measured**, the relative displacement of the eastern half with respect to the
western half at that witness, and the consequence for a rigid two-plate island:

| Age (Ma) | 102↔301 separation (km) | bearing | modern outline: overlap / union (km²) | `gold` only: overlap / union (km²) |
|---:|---:|---:|---:|---:|
| 0 | 0.0 | — | 0 / 101,155 | 0 / 35,803 |
| 2 | 38.3 | 285° | 8,159 / 92,995 | 2,779 / 33,025 |
| 5 | 95.6 | 286° | 16,719 / 84,424 | 1,507 / 34,296 |
| 8 | 153.0 | 288° | 20,901 / 80,252 | 1,498 / 34,305 |
| 11 | 210.5 | 288° | 25,963 / 75,183 | 5,638 / 30,162 |
| **12** | — | — | **26,988 / 74,164** (maximum closure) | 5,906 / 29,897 |
| 14 | 271.7 | 288° | 20,642 / 80,513 | 4,200 / 31,604 |
| 16.3 | 318.6 | 288° | 12,988 / 88,167 | 3,032 / 32,771 |
| 20 | 394.0 | 287° | 6,403 / 94,752 | 4,389 / 31,414 |

**Inference, and this is the second design constraint.** The rigid two-plate
pose closes the modern Iceland outline monotonically to a maximum at about
**12 Ma** (74,164 km², 73% of the present area), and then **re-opens** it: past
~13 Ma the eastern half has been carried WNW *through* the western half and out
the far side, so at 16.3 and 20 Ma the reconstructed island is *wider* than
today and the two halves are in the wrong order. The existing correction's
16.3 Ma cap and its blanket `poseStatus: model-inference` are exactly the right
response to this, and it is why every non-modern Iceland chart is labelled
model inference rather than reconstruction.

Two consequences:

- A 20–11 Ma operation that draws a large, contiguous present-day footprint
  will render as an inverted, over-wide island. Only a footprint whose two
  halves stay on their own outer flanks — such as `gold` restricted to the NW,
  N and E lobes — survives the pose, and even that carries a real inversion
  artefact at the old end of the bin.
- The growth the user asked for **must come from the age cut, not the pose.**
  `gold` posed rigidly is 30,000–36,000 km² at every age from 0 to 20 Ma; it
  does not shrink. The 11–2 versus 20–11 difference has to be built from
  different source geometry per interval.

---

## 5. The proposed `iceland` basin contract

A new `data/corrections/palaeo-coastlines/basins/iceland.json`, same schema as
`north-sea.json` (`schemaVersion` 1; `opSchema.kinds` limited to `add-land`,
`remove-land`, `add-shallow`, `remove-shallow`, `replace-ring`; every operation
carrying `opId`, `kind`, `intervalIds`, `geometry`, `rationale`,
`spatialUncertaintyKilometres`, `editorial` prefixed
`"EarthHistory modification after "`, and at least one `references[]`
`sourceId`). **Not implemented. The operations below are written in words; no
coordinate list here is a final geometry.**

```
basinId  : "iceland"
title    : "Iceland and the Greenland–Iceland–Faroe Ridge"
status   : "proposed"
window   : bbox [-27.0, 62.0, -12.0, 68.0]
           reason: "Iceland, its insular shelf, the Greenland–Iceland Ridge and
                    the western Iceland–Faroe Ridge; the same window
                    simplification.json must protect from node reduction"
intervals: ["20-11", "11-2"]
classes  : ["lm", "sm"]
```

The window deliberately stops at −12 °E, west of the Faroe Platform, so that
nothing in this contract can touch the Faroes (§5.5).

### 5.1 `iceland-11-2-tertiary-plateau-add-land` (+ paired `remove-shallow`)

- **kind** `add-land`, with a paired `remove-shallow` over the same ring, since
  Cao classes the whole island `sm` at 11–2 and land is drawn above shallow sea
  anyway — the removal is what keeps the evidence record honest rather than
  relying on draw order.
- **intervalIds** `["11-2"]`.
- **geometry** the union of the NÍ `gold` class (`flokkur = "gold"`, "Upper
  Tertiary, older than 3.3 m.y."), dissolved, small parts dropped at the
  compiler's 25 km² floor, simplified at 0.005° topology-preserving (the same
  tolerance the existing correction uses), coordinates rounded to 4 decimals.
  Measured present-day extent 35,803.4 km², bounds −24.534 … −13.500 °E,
  63.963 … 66.467 °N, 885 source parts of which two dominate: a western lobe of
  24,840.8 km² (−24.534 … −17.467) and an eastern lobe of 8,485.5 km²
  (−15.527 … −13.521).
- **spatialUncertaintyKilometres** `60`. Justified by the 3.3 Ma / 2.01 Ma bin
  mismatch, the ±500 m map uncertainty the NÍ metadata reports, the 0.005°
  simplification, and the fact that the outcrop is a minimum footprint.
- **rationale** must say four things: that Cao draws no land over Iceland at
  11–2 Ma while the island's own Tertiary pile is *"subaerial tholeiitic flood
  basalts"* older than 3.3 Ma; that the geometry is the present outcrop of that
  pile and therefore a **minimum**, not a reconstructed coastline; that the
  neovolcanic zones are excluded although old crust underlies them, so the drawn
  island is a lower bound with a hole down its middle; and that the 3.3 Ma class
  boundary is the finest the source offers, 1.3 Myr older than the bin's 2.01 Ma
  young bound.
- **claimOrInference**: the subaerial character and the >3.3 Ma age of the
  mapped units are claims of the sources; that this makes Cao's shallow-marine
  class wrong for 11–2 Ma over that footprint, and the choice to draw the
  outcrop as land, are EarthHistory inferences.
- **references** `saemundsson-1979-iceland-outline`,
  `hardarson-2008-tertiary-volcanism`, `ni-j600v-bedrock-2014`,
  `denk-2010-oak-migration`.

### 5.2 `iceland-20-11-oldest-flanks-add-land` (+ paired `remove-shallow`)

- **kind** `add-land`, `intervalIds` `["20-11"]`.
- **geometry** the same `gold` union **restricted to the three lobes the
  published radiometric ages place at or above ~12–16 Ma**, as a MultiPolygon of
  three parts. Candidate bounds and the measured `gold` area inside each:

  | Lobe | Published oldest age | Bound (°E, °N) | measured `gold` inside (km²) |
  |---|---|---|---:|
  | NW peninsula, Vestfirðir | >15 Ma (Harðarson); ~16 Ma deep level (Sæmundsson) | −24.6 … −21.4, 65.35 … 66.60 | 8,569.4 |
  | N Iceland, Tröllaskagi | ~12 Ma | −19.4 … −17.3, 65.35 … 66.25 | 6,169.3 |
  | E Iceland, Eastfjords | 13–14 Ma; "just over 13 m.y." | −15.7 … −13.4, 64.15 … 65.65 | 7,715.7 |
  | **union** | | | **22,454.4** (62.7% of `gold`, 22.2% of the modern outline) |

  The bounding rectangles are *selectors on the outcrop*, not an outline of the
  island: the emitted rings are the `gold` geometry clipped by them, so the
  drawn coastline is still the mapped outcrop boundary. The N lobe is the weak
  one — ~12 Ma is inside the bin but only just — and the contract should say so
  rather than silently include it.
- **spatialUncertaintyKilometres** `100`. The selectors are EarthHistory's
  reading of point age localities, the bin is 9 Myr long, and the pose inverts
  at its old end.
- **rationale** must record: that no exposed Icelandic crust is older than
  ~16 Ma, so the 16.3–20 Ma half of this bin has **no** mapped land and the
  operation is a young-end statement only; that the geometry is the subset of
  the Tertiary outcrop the published ages place before 11 Ma; and that the
  rigid two-plate pose re-widens and inverts the island past ~13 Ma (§4.2), so
  the drawn shape at the old end of the bin is a model artefact that the
  evidence record must name.
- **claimOrInference**: the ages at the NW, N and E localities are claims of the
  sources; the mapping of those point ages onto areal selectors, and the
  decision to draw a young-end minimum for a 9 Myr bin, are EarthHistory
  inferences.
- **references** as §5.1, plus `blischke-2022-jmmc-ipr`, `ellis-stoker-2014-fsb`.

### 5.3 The data-processing steps, in order

1. Read `NATT:ISL_IINH_500k_BA` from the existing pinned offline snapshot at
   `../EarthHistory-data/palaeomap-study/verification/regional-iceland-correction-v1/source-inputs/bedrock-old.geojson`
   (1,074 features, `flokkur` ∈ {`gold`, `gnew`}). The bytes are already
   acquired, hashed and CC BY 4.0; **no new acquisition is needed**, and the
   palaeo compiler must read the same snapshot the material correction reads so
   the two cannot drift.
2. Select `flokkur = "gold"`. Dissolve to a single MultiPolygon. Assert the
   dissolved area against the 35,803.4 km² measured here and against
   Harðarson et al.'s published 36,000 km² Tertiary area; a drift of more than
   a few per cent is a source change, not a rounding difference.
3. For `20-11`, clip to the three lobe selectors of §5.2 and assert the
   22,454.4 km² total. For `11-2`, keep the whole dissolved `gold`.
4. Densify every edge at 1° of arc *and* 1° of longitude before any Boolean, as
   the Cao 2017 audit requires; Iceland is far from the pole and far from the
   antimeridian, so no unwrapping or pole connector is needed, but the
   densification precondition is not conditional.
5. Simplify at 0.005° topology-preserving; record vertex count, area error and
   Hausdorff distance the way the shelf compiler does.
6. Emit as two (or four, with the paired removals) operations in
   `iceland.json`. The compiler then does what it already does: cookie-cut each
   ring by the present-day Cao 2024 static partitions, one owner per piece under
   the deterministic first-claim rule, and bind each piece to its owner plate's
   motion palette entry.
7. **New check the compiler does not have.** Assert that every emitted Iceland
   piece lands on plate 102 or 301, and record the seam. Then assert that the
   102/301 seam the palaeo compiler produces is within a stated tolerance of the
   101/301 ridge-subsegment split the material correction uses. The two seams
   are different constructions of the same ridge; if they differ, the palaeo
   land and the `gold` correction outcrop will separate visibly at 11 Ma, where
   the relative displacement is already 210 km.
8. Add the window `[-27, 62, -12, 68]` to `simplification.json`'s protected
   list so node reduction cannot eat the island.
9. Witness ages for acceptance: 2.01, 3, 5, 8, 11 (inside `11-2`); 11.01, 12,
   15, 16.3, 18, 20 (inside `20-11`); and 1.9 and 20.1 as negative witnesses.
   Mutation checks that must fail: drawing `gold` land at 29–20; using
   `gold ∪ gnew` at `20-11`; dropping the `remove-shallow` pair; relabelling
   any Iceland pose as cited reconstruction rather than model inference;
   extending the window east of −12 °E.

### 5.4 The Jan Mayen microcontinent: no operation

**No operation is proposed.** Torsvik et al. (2015) describe a thinned,
submerged continental ribbon that became part of Eurasia by 27 Ma; Gaina et al.
(2009) describe it as *"highly extended or even fragmented"*; Gernigon et al.
(2019) place final dislocation in the Late Oligocene/Early Miocene. The only
subaerial volcanism anyone places on it is Eocene (~55–53 Ma, Blischke et al.
2022), and the ~35–23 Ma uplift and erosion is an unconformity, not a mapped
land extent. Cao draws neither `lm` nor `sm` over any Jan Mayen witness at
either interval, and there is no Cao 2024 continental crust there either, so
the model already says "unmapped" — which is the honest answer. This belongs in
`notes.leftAlone` with those four references, not in `ops`.

### 5.5 The Faroes and the Iceland–Faroe Ridge: no operation, and why the window stops short

**No operation is proposed**, and the contract window deliberately excludes the
Faroe Platform. Three reasons, each measured or sourced:

1. **Measured.** Cao already draws the Faroes as `lm` at 37–29 and as `lm`+`sm`
   at 29–20, then `sm` at 20–11 and 11–2. The model's own GIFR land bridge is
   Eocene–Oligocene, and the intervals this contract touches are the ones where
   Cao has already closed it.
2. **Sourced.** Ólavsdóttir et al. (2016) state the Iceland–Faroe Ridge's
   structure *"remains ambiguous"*. Miocene inversion of the Faroe–Shetland
   sub-basins is an uplift signal without a shoreline.
3. **Sourced.** Denk et al. (2010) place the transatlantic dispersal events at
   9–8 and 5.5 Ma and explicitly leave stepping-stone versus continuous open.
   A continuous drawn land bridge would assert the stronger of two readings the
   source does not choose between, across a 1,000 km span, on pollen evidence.

The Faroes sit inside the North Sea contract's neighbourhood but outside its
window too, so nothing currently edits them. That stays true.

### 5.6 Interaction with the existing Iceland corrections

Three interactions, all of which the contract has to name:

1. **The correction stays visible and draws on top of the shallow sea.** With
   the palaeo layer on, `corrections` (renderOrder 1.5) sits above
   `palaeo-shallow-marine` (1.2) and below `palaeo-land` (1.7). At 11–2 the new
   `palaeo-land` ring would be drawn from the same `gold` geometry that
   `gold:formation` already paints one layer down, in a different colour and
   with a different evidence meaning: *material exists* versus *this was land*.
   Two shells asserting different things from one source geometry, in the same
   place, is a presentation problem the map key has to solve explicitly, or one
   of the two has to be suppressed inside the palaeo mode.
2. **The 16.3 Ma cap is a coverage bound, not a birth age**, and the `20-11`
   bin runs to 20 Ma. From 16.3 to 20 Ma the correction has no chart and the
   proposed operation has no defensible geometry either. Both should be silent
   there, and the reason should be recorded once rather than inferred twice.
3. **The pose.** The correction splits on the exact shared 101/301 MOR
   subsegments; the palaeo compiler will split on the 102/301 static-partition
   seam. Plates 101 and 102 are measured co-moving to 0.0 km over 0–29 Ma, so
   the risk is the seam line, not the rotations — see the new check in §5.3
   step 7.

### 5.7 What is deliberately left alone

- **The `lgm` interval.** Iceland is outside the LGM contract's three
  footprints, and a −120 m eustatic contour around Iceland would draw the
  insular shelf as dry ground at the very age when the Icelandic Ice Sheet
  covered the island and extended onto that shelf. Adding Iceland to the LGM
  state needs a cited ice-sheet extent first; a lowstand alone would be worse
  than the present silence. Recorded as a limitation.
- **The shallow-marine class around Iceland at 20–11 and 11–2.** Cao's growing
  Icelandic platform (24.4 → 39.1 → 58.2 deg² in the probe window) is the right
  sign for a growing edifice, and nothing retrieved here dates a Miocene
  Icelandic shelf edge. Only the land inside it is edited.
- **The 37–29 Ma GIFR landmass.** It is outside this contract's intervals, it
  is the model's own reading of the hotspot trail, and Harðarson et al. state
  the GIFR *"may have been partly above sea level"* — a conditional. Changing it
  needs its own research round.
- **The V-shaped ridges and the seafloor age structure.** Not renderable in the
  `lm`/`sm` pair at all; see the follow-up plan at
  `dev-docs/plans/seafloor-age-and-ridge-growth-layer.md`.

---

## 6. Follow-up

The user's request was framed from magnetic anomalies 5–25 on the Reykjanes,
Kolbeinsey, Aegir, Mohns, Knipovich and Nansen ridges. **The runtime draws no
ocean crust at all**, so the anomaly pattern that motivates the request cannot
be shown by any basin contract. That is a separate layer, scoped in
`dev-docs/plans/seafloor-age-and-ridge-growth-layer.md`.

---

## References

| sourceId | Citation | DOI / URL |
|---|---|---|
| `saemundsson-1979-iceland-outline` | Sæmundsson, K. 1979. Outline of the geology of Iceland. *Jökull* 29, 7–28. | no DOI; https://timarit.is/gegnir/000552268 |
| `hardarson-2008-tertiary-volcanism` | Harðarson, B. S., Fitton, J. G. and Hjartarson, Á. 2008. Tertiary volcanism in Iceland. *Jökull* 58, 161–178. | no DOI; https://jokull.jorfi.is/articles/jokull2008.58/jokull2008.58.161.pdf |
| `ni-j600v-bedrock-2014` | Náttúrufræðistofnun Íslands, *NI_J600v Jarðfræðikort af Íslandi, 2. útgáfa – Berggrunnur – 1:600.000*, compiled by Haukur Jóhannesson (earlier editions Haukur Jóhannesson and Kristján Sæmundsson), 1st edn 1989, revised 1998, 2009, 2014. WFS layer `NATT:ISL_IINH_500k_BA`. CC BY 4.0. | https://www.natt.is/en/resources/geospatial-data/geological-maps |
| `torsvik-2015-continental-crust-iceland` | Torsvik, T. H., Amundsen, H. E. F., Trønnes, R. G., Doubrovine, P. V., Gaina, C., Kusznir, N. J., Steinberger, B., Corfu, F., Ashwal, L. D. *et al.* 2015. Continental crust beneath southeast Iceland. *PNAS* 112(15). | https://doi.org/10.1073/pnas.1423099112 |
| `gaina-2009-jan-mayen` | Gaina, C., Gernigon, L. and Ball, P. 2009. Palaeocene–Recent plate boundaries in the NE Atlantic and the formation of the Jan Mayen microcontinent. *Journal of the Geological Society* 166(4), 601–616. | https://doi.org/10.1144/0016-76492008-112 |
| `gernigon-2019-ngs-opening` | Gernigon, L. *et al.* 2019. Crustal fragmentation, magmatism, and the diachronous opening of the Norwegian-Greenland Sea. *Earth-Science Reviews*. | https://doi.org/10.1016/j.earscirev.2019.04.011 |
| `blischke-2022-jmmc-ipr` | Blischke, A., Brandsdóttir, B., Stoker, M. S., Gaina, C., Erlendsson, Ö., Tegner, C., Halldórsson, S. A., Helgadóttir, H. M. and Gautason, B. 2022. Seismic Volcanostratigraphy: The Key to Resolving the Jan Mayen Microcontinent and Iceland Plateau Rift Evolution. *G-Cubed* 23(4). | https://doi.org/10.1029/2021GC009948 |
| `parnell-turner-2014-vshaped-ridges` | Parnell-Turner, R., White, N., Henstock, T., Murton, B., Maclennan, J. and Jones, S. M. 2014. A continuous 55-million-year record of transient mantle plume activity beneath Iceland. *Nature Geoscience* 7(12), 914–919. | https://doi.org/10.1038/ngeo2281 |
| `steinberger-2019-iceland-plume` | Steinberger, B., Bredow, E., Lebedev, S., Schaeffer, A. and Torsvik, T. H. 2019. Widespread volcanism in the Greenland–North Atlantic region explained by the Iceland plume. *Nature Geoscience* 12(1), 61–68. | https://doi.org/10.1038/s41561-018-0251-0 |
| `denk-2010-oak-migration` | Denk, T., Grímsson, F. and Zetter, R. 2010. Episodic migration of oaks to Iceland: Evidence for a North Atlantic "land bridge" in the latest Miocene. *American Journal of Botany* 97(2), 276–287. | https://doi.org/10.3732/ajb.0900195 |
| `denk-2011-late-cainozoic-floras` | Denk, T., Grímsson, F., Zetter, R. and Símonarson, L. A. 2011. *Late Cainozoic Floras of Iceland: 15 Million Years of Vegetation and Climate History in the Northern North Atlantic*. Topics in Geobiology 35, Springer. | https://doi.org/10.1007/978-94-007-0372-8 |
| `grimsson-2007-middle-miocene-floras` | Grímsson, F., Denk, T. and Símonarson, L. A. 2007. Middle Miocene floras of Iceland — the early colonization of an island? *Review of Palaeobotany and Palynology* 144(3–4), 181–219. | https://doi.org/10.1016/j.revpalbo.2006.07.003 |
| `ellis-stoker-2014-fsb` | Ellis, D. and Stoker, M. S. 2014. The Faroe–Shetland Basin: a regional perspective from the Paleocene to the present day and its relationship to the opening of the North Atlantic Ocean. *GSL Special Publications* 397(1), 11–31. | https://doi.org/10.1144/SP397.1 |
| `olavsdottir-2016-faroese-margin` | Ólavsdóttir, J., Eidesgaard, Ó. R. and Stoker, M. S. 2016. The stratigraphy and structure of the Faroese continental margin. *GSL Special Publications* 447(1), 339–356. | https://doi.org/10.1144/SP447.4 |
| `moorbath-1968-oldest-rocks` | Moorbath, S., Sigurdsson, H. and Goodwin, R. 1968. K-Ar ages of the oldest exposed rocks in Iceland. *EPSL* 4, 197–205. | https://doi.org/10.1016/0012-821X(68)90035-6 |
| `cao-2017-palaeogeography` | Cao, W., Zahirovic, S., Flament, N., Williams, S., Golonka, J. and Müller, R. D. 2017. Improving global paleogeography since the late Paleozoic using paleobiology. | see [palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md) |

**Sources that were not opened.** Steinberger et al. (2019) — bibliographic
identity confirmed through Crossref; the publisher and both located repository
records returned HTTP 403, so nothing from it is quoted here and it is listed
only as the plume-history reference the design does not lean on. Grímsson et
al. (2007) — bibliographic identity confirmed through Crossref; the publisher
returned HTTP 403, so it is quoted here only as Harðarson et al. (2008) report
it. Denk et al. (2011) — title, chapter titles and pagination from Crossref;
the chapters themselves were not opened. Jóhannesson & Sæmundsson's printed
map sheets were not opened; the digital NI_J600v lineage and its legend were
read from the pinned WFS/SLD/metadata snapshot.
