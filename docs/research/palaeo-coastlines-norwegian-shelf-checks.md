# Norwegian shelf checks against the shipped palaeo-coastline payloads

Probe date: 2026-09-15. Read-only measurement of the **public** payloads under
`public/data/reconstruction/cao-v2.4/palaeo-coastlines/` against the Standard
Lithostratigraphic Wallchart for Offshore Norway and the Norwegian Offshore
Directorate's own lithostratigraphy. Companion to
[palaeo-coastlines-north-sea-formation-checks.md](palaeo-coastlines-north-sea-formation-checks.md)
(the same method applied to the UK-sector formations),
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say), [palaeo-coastlines-north-sea-edits.md](palaeo-coastlines-north-sea-edits.md)
(what was changed) and [regional-barents-correction.md](regional-barents-correction.md)
(the separate, pre-540 Ma Barents *material* correction, which this memo does
not touch).

This memo answers one question for the **Norwegian** sector: at the present-day
position of a named formation or structural element, in each Cao interval, does
the shipped map say land, shallow sea, both, or neither? It changes nothing.
Where it finds a mismatch it says whether the fix is a permanent validator
witness, a cited basin edit, or neither.

Every statement is tagged. **Measured** is a number computed this session from
the shipped payloads. **Verbatim** is an exact quotation of a source.
**Snippet** is a retrieved summary that was *not* verified against the source's
own page. **Inference** is EarthHistory's own reading.

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Git HEAD at probe time | `28c2adbc4acc5f23ad2c6c1f88e21702539e0d74` |
| Git HEAD when this memo was written | `192cc224cf59f198587afd000626f0725c96c5a9` ("feat: Scottish Middle Jurassic landmass, Eocene platform decision and mobile key fix") |
| Working tree at probe time | Six files under `public/` were modified relative to the then-HEAD by concurrent work (`lm/palaeo-lm-179-166.ehpr`, `lm/palaeo-lm-49-37.ehpr`, `lm/palaeo-lm-58-49.ehpr`, `lm/palaeo-lm-lgm.ehpr`, and the two class catalogs). That work has since been committed as `192cc22`. **Measured after the fact:** all **50 payload files this memo decoded are byte-identical to `192cc22`**; the two catalog JSONs differ from `192cc22` in serialisation only — every top-level value compares equal and every payload `sha256` they pin is the one read here. The results below are therefore statements about the committed `192cc22` payload, not about an uncommitted intermediate. |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` |
| Payloads read | 52 (`lm` and `sm`, 24 canonical intervals plus `lgm`, plus 2 class catalogs) |
| Integrity | **Measured.** All 50 payload `sha256` values re-computed here equal the digests their own class catalog pins, and equal the digests the committed `192cc22` catalogs pin. The per-file table is the appendix. |

**Method, Measured.** The classification is the validator's own, imported
read-only rather than re-implemented, and is byte-for-byte the method of the
companion North Sea memo: `palaeo_coastlines_compile.decode_ehpr` decodes each
EHPR v1 payload, `piece_geometry` rebuilds each piece's rings, the pieces are
unioned per class per interval (this is `class_union` in
`scripts/research/palaeo_coastlines_correction.py`), and a present-day
`(lon, lat)` gets the class set `{name : union.contains(point)}`. As in the
validator, the union is over every piece in the interval file and does not
filter by a piece's own `(TOAGE, FROMAGE]` lifecycle. A point covered by no
shipped class is reported as `neither`. Only `lm` and `sm` ship; the mountain
class `m` is compiled offline and withheld, so Cao ground that carries only `m`
reads here as `neither` — see the companion memo's §6.

**What each answer means on screen** is unchanged from the companion memo:
`lm` paints olive land; `sm` paints teal shallow sea; `lm` **and** `sm`
together **render as land**, because land is drawn later and higher and hides
the shallow sea underneath; `neither` lets the native blue shelf show through,
captioned "Cao 2024 continental crust, depth unmapped".

**Positions, Measured, and one correction to the brief.** Structural-element
positions here are anchored on Norwegian Offshore Directorate **wellbore
coordinates** (open data, `factpages.sodir.no`, exploration-wellbore table,
`wlbNsDecDeg`/`wlbEwDecDeg`), not on any digitised structural-element outline:

| Element | Anchor wellbores | Position used |
|---|---|---|
| Utsira High | 16/1-8 Edvard Grieg (58.8357 N, 2.2351 E); 16/2-6 Johan Sverdrup (58.8237 N, 2.6152 E); 25/6-1 (59.5256 N, 2.8006 E, northern tip) | crest points plus a 0.1° box 1.8–2.9 E, 58.4–59.3 N |
| Nordland Ridge | 6607/5-1 (66.6360 N, 7.5393 E); 6610/3-1 (66.9249 N, 10.9017 E); 6609/7-1 drilled to basement on the ridge (Færseth 2022) | box 7–12 E, 65–67.5 N |
| Loppa High | 7220/11-1 Alta (72.0575 N, 20.5460 E); 7120/1-3 Gohta (71.9029 N, 20.2697 E) | box 19–23 E, 71–73 N |

**Inference, and this matters for the brief.** The brief placed the Loppa High
at "~22–24 E, 72–73.5 N". The drilled Loppa High discoveries sit at
**20.3–20.5 E, 71.9–72.1 N**, one to three degrees of longitude west. A point
at (23 E, 72.7 N) is on the Bjarmeland Platform side, and it does *not* give
the same answer as the real high in the Palaeogene (`lm` at `37-29` there,
`sm` at the crest). Every Loppa result below uses the drilled positions.

---

## The source: the Standard Lithostratigraphic Wallchart, Offshore Norway

**Measured.** Retrieved from
`https://timescalefoundation.org/resources/NW_Europe_Lex/stratchart_files/StandardLithostratigraphicWallchartOffshoreNorway.pdf`
on 2026-09-15; 4,268,035 bytes, sha256
`334f4aa9e48bd115527a5aa6d2f27c8961f6a3c457f24798ea400bcbd4145549`; one page,
3585 × 2019 pt; embedded title `Lithostratigraphic_Wallchart_Offshore_Norway_GTS2012_22June2012`.

**Verbatim**, from the chart's own text layer: title "Standard Lithostratigraphy
of Offshore Norway"; "This chart was produced with the assistance of Noreco,
Lundin, Conoco Phillips and other members of the Diskos Consortium"; "For
details see: 'The Geologic Time Scale 2012' by F.M. Gradstein, J.G. Ogg,
M. Schmitz and G. Ogg (2012, published by Elsevier), and the Geologic TimeScale
Foundation website: https://engineering.purdue.edu/Stratigraphy"; "All figures
are interactive on www.nhm2.uio.no/norlex."; and, at the foot, **"This chart and
its design are copyrighted by the Norlex Project; GTS 2012 ages by Gabi Ogg."**

**Rights.** The chart is **citation-only** here. Its ages and its verbal
statements are read; no part of its artwork, no column, and no boundary is
traced, digitised, or redistributed, and it is not a build input. The only
redistributed palaeogeographic geometry in this program remains Cao et al.
(2017), CC BY 3.0.

**Measured.** The chart's columns are: Norwegian–Danish Basin (NO/DK), Central
Graben South and North, Southern Viking Graben, Northern Viking Graben /
Tampen, Southern Norwegian Sea, Northern Norwegian Sea, South-Western Barents
Sea, Svalbard, plus a chronostratigraphy axis and a legend whose ornament list
includes "Hiatus" and "Unconformity".

**Measured, and this is the key to check 7.** The chart does **not** carry
"Utsira High" as a column. It *does* carry two vertical columns filled
edge-to-edge with the hatched hiatus ornament, labelled in rotated type
**"Nordland Ridge"** (inside the Norwegian Sea panel, between a SW column of
Åre/Tilje/Ror/Ile/Garn/Heather/Draupne/Lyr and a NE column) and **"Loppa High"**
(inside the SW Barents panel, between a Stø/Fuglen/Knurr/Kolje/Kolmule column
and a Hekkingen/Klippfisk column). Both hatched columns run from the Triassic up
to the very top of the chart, terminating only beneath the **Naust Formation**
(Norwegian Sea) and beneath the **Nordland Group** (Barents), i.e. at the Late
Pliocene. The Loppa column pinches out downwards where Havert/Klappmyss/Kobbe/
Snadd cover across, at about the Anisian–Ladinian.

**Inference, and it is the single most important reading in this memo.** A
hatched hiatus column is a statement that **section is missing** — non-deposition
or later erosion. It is *not* a statement that the ground stood above sea level
throughout that time. The brief's "Nordland Ridge exposed until the Pliocene"
and "Loppa High exposed until the Late Pleistocene" are faithful readings of
these two columns, but they convert a *stratigraphic absence* into a
*palaeogeographic emergence*, and the chart does not license that step. Below,
each of the two is tested against the shipped map on its own terms, and the
distinction decides both verdicts.

---

## 1. Permian–Triassic continental deposits in the Norwegian North Sea

**Sourced.** Norwegian Offshore Directorate lithostratigraphy (all *Verbatim*,
retrieved 2026-09-15):

- **ROTLIEGEND GP**, `https://factpages.sodir.no/en/strat/pageview/litho/groups/136`
  — Age "Early Permian"; "Most of these sedimentary rocks are confined within
  the central North Sea, Inner Moray Firth basin and South Viking Graben areas
  … Although Rotliegend sandstones are present in the South Viking Graben, they
  are absent on the adjacent Utsira High and Horda Platform".
- **ZECHSTEIN GP**, `.../litho/groups/194` — Age "Late Permian"; "Zechstein
  sedimentary rocks are widespread over the Norwegian-Danish Basin, but are
  absent east and north of the Utsira High and over the Mid North Sea and
  Ringkøbing-Fyn highs."
- **SMITH BANK FM**, `.../litho/formations/149` — Age "Early to possibly Late
  Triassic"; "The formation probably represents a range of distal continental
  environments where predominantly fine grained clastics were deposited."
- **SKAGERRAK FM**, `.../litho/formations/146` — Age "Middle to Late Triassic";
  "The bulk of the Skagerrak Formation was probably deposited in a coalescing
  and prograding system of alluvial fans … some of the dark shale, carbonate and
  anhydrite beds were deposited in lakes … some beds were deposited when minor
  marine incursions occurred between floods of continental clastics."
- **GASSUM FM**, `.../litho/formations/49` — Age "Rhaetian in the type well,
  becoming younger northwards"; "fluvial to marginal marine deposits laid down
  during a transgressive phase at the Triassic/Jurassic transition"; "Throughout
  the Norwegian-Danish Basin, on the Southern Vestland Arch and along the
  north-eastern margin of the Central Graben; frequently eroded due to
  mid-Jurassic earth movements".
- The Auk Formation has **no** Sodir page: it is a UK Central North Sea unit.
  The wallchart nonetheless plots "Auk Fm" in the Norwegian Central Graben
  columns at the **Capitanian** level (*Measured* from the chart's text layer,
  adjacent to "Capitanian 265.1"). Its aeolian character and dating are carried
  by Besly, Romain & Mountney 2018,
  https://doi.org/10.1016/j.marpetgeo.2017.12.021 (*Verbatim* abstract, quoted
  in the companion memo), and Glennie 1972,
  https://doi.org/10.1306/819A40AE-16C5-11D7-8645000102C1865D.

**Measured.** Class at the three brief points, present-day coordinates:

| Interval (Ma) | Egersund / N-Danish Basin (5.5 E, 57.8 N) | Central Graben NO (3.2 E, 56.5 N) | Viking Graben (2.5 E, 60.5 N) | Viking Graben (2.0 E, 60.5 N) |
|---|---|---|---|---|
| 296–285 | `lm` | `lm` | `lm` | `lm` |
| 285–269 | `lm` | `lm` | `lm` | `lm` |
| 269–248 | `sm` | `sm` | **`lm`** | `sm` |
| 248–224 | `lm` | `lm` | `lm` | `lm` |
| 224–203 | `lm` | `lm` | `lm` | `lm` |

**Verdict: PASS.** Land in `296-285`, `285-269`, `248-224` and `224-203` at
every probed point, flooded in `269-248` at the two southern points. That is
exactly the expectation, and the two Triassic bins are independently supported
by Smith Bank ("distal continental environments") and Skagerrak (alluvial fans
and lakes).

**Inference on the one exception.** At (2.5 E, 60.5 N) the `269-248` bin is
**land, not sea** — while 0.5° west, at (2.0 E, 60.5 N), it is `sm`. That is not
a defect: the Sodir Zechstein page says the group is "absent east and north of
the Utsira High", so a shoreline through the southern Viking Graben is the
sourced expectation, and the existing validator witness `viking-graben`
(2.0 E, 60.5 N) = `["sm"]` at `269-248` sits on the marine side of it. Both are
right; the pair pins the Zechstein's northern limit to a 0.5° band, and the
contract already records the northern limit as deliberately unedited.

**Not editable, carried over from the companion memo.** The Capitanian–
Wuchiapingian Auk/Upper Rotliegend desert and the Zechstein Sea that drowned it
share the one 21 Myr bin `269-248`. A maximum-transgression bin keeps the
marine end member. This is a limitation, not an edit.

---

## 2. Early Jurassic Dunlin Group: is the northern basin marine at `203-179`?

**Sourced**, Norwegian Offshore Directorate, all *Verbatim*:

- **DUNLIN GP**, `.../litho/groups/29` — "The group ranges from Hettangian to
  Bajocian in age", divided into "the Amundsen (base), Johansen, Burton, Cook
  and Drake (top) formations"; "The group is more widespread than the underlying
  Statfjord Group and is thickest in the Viking Graben area, east of the
  Statfjord and Brent fields. It is recognizable over most of the East Shetland
  Basin and northern part of the Horda Platform."
- **AMUNDSEN FM**, `.../litho/formations/4` — "Probably Hettangian to Sinemurian
  or Early Pliensbachian"; "The formation contains exclusively marine sediments,
  representing deposition on a shallow marine shelf"; "widely distributed in the
  East Shetland Basin and Viking Graben north of 59°N".
- **BURTON FM**, `.../litho/formations/20` — "Sinemurian to Pliensbachian"; "The
  formation is believed to represent open marine basinal deposits."
- **COOK FM**, `.../litho/formations/24` — "Pliensbachian to Toarcian"; marine
  shoal sands, prograding shelf sands and redeposited shelf-edge sands.
- **DRAKE FM**, `.../litho/formations/27` — "Toarcian to Bajocian"; "generally
  considered to have been deposited in prodelta and delta front environments".

**Measured**, interval `203-179`:

| Point | Class |
|---|---|
| Viking Graben (2.5 E, 60.5 N) | `sm` |
| Viking Graben (2.0 E, 60.5 N) | `sm` |
| East Shetland Basin (1.5 E, 61.0 N) | `sm` |
| Utsira High crest (2.235 E, 58.836 N) and (2.615 E, 58.824 N) | `sm` |
| Norwegian North Sea generally (Egersund, Central Graben, N-Danish Basin) | `sm` |

**Verdict: PASS** for the Viking Graben and the East Shetland Basin. The whole
Norwegian North Sea is shallow marine in this bin, which is the Dunlin Group's
own environment at its own age.

**PARTIAL, for the Utsira High only.** The Lower Jurassic is preserved "on the
northernmost part of the Utsira High (well 25/6-1)" but not on the crest
(Riber et al. 2015, §6 below, *Verbatim*). The shipped map floods the whole high
at `203-179`. See §6 for why this is recorded rather than edited.

---

## 3. The mid-Jurassic dome at `179-166`: land in the south, Brent delta in the north

**Sourced.** Sodir **BRENT GP**, `.../litho/groups/16` — "shallow marine,
marginal marine and non-marine deposits of Middle Jurassic age (Aalenian -
Bathonian)", "a major deltaic system" (*Verbatim*, quoted in the companion
memo). Sodir **GARN FM**, `.../litho/formations/48` — "Bajocian to Bathonian";
"may represent progradations of braided delta lobes … in structurally high
positions the entire unit may be eroded"; "time equivalent to parts of the Brent
Group in the North Sea" (*Verbatim*). Sodir **GASSUM FM** — "frequently eroded
due to mid-Jurassic earth movements" (*Verbatim*). The mid-Cimmerian /
intra-Aalenian unconformity and the North Sea Dome: "Prior to the Late Jurassic
rifting, the central North Sea was uplifted above sea level due to Toarcian and
Aalenian thermal doming (North Sea Dome). Together with a global regression, the
consequence was that the seaway connecting the Boreal and Tethys seas was
blocked causing deep erosion of Early Jurassic and older sediments … Hence,
there is a marked unconformity (the mid-Cimmerian or intra-Aalenian
unconformity) separating the Lower Jurassic from the Middle and Upper Jurassic
in the region" (Riber, Morgan & Aagaard 2015, *Norwegian Journal of Geology* 95,
https://doi.org/10.17850/njg95-1-04, *Verbatim*; the sentence cites Vail et al.
1977 and Ziegler 1992).

**Measured**, interval `179-166`:

| Point | Class |
|---|---|
| Central Graben NO (3.2 E, 56.5 N) | `lm` |
| Norwegian–Danish Basin (7.0 E, 56.8 N) | `lm` |
| Egersund Basin (5.5 E, 57.8 N) | `lm` |
| Utsira High crest (2.235 / 2.615 E, ~58.8 N) | `lm` |
| Brent delta plain (2.0 E, 60.5 N) | `lm` |
| Viking Graben (2.5 E, 60.5 N) | `lm` |
| Viking Graben (2.5 E, 61.0 N) | `sm` |
| East Shetland Basin (1.5 E, 61.0 N) | `sm` |

**Verdict: PASS.** The whole Norwegian sector south of ~60.5 N is land at
`179-166` — the dome and its unconformity — and the transition to shallow marine
lies between 60.5 N and 61.0 N, which is the Brent/Vestland delta limit the
companion memo already pinned to within one 0.25° step of the cited 60°30′N.
No new edit; the existing `brent-delta-plain` and `east-shetland-platform`
operations own this interval.

---

## 4. Late Jurassic–Early Cretaceous deep water: Tau, Heather, Farsund, Draupne

**Sourced.** Sodir, all *Verbatim*:

- **HEATHER FM**, `.../litho/formations/60` — "Bathonian to Kimmeridgian";
  "deposited in an open marine environment"; "recognized over most of the
  northern North Sea north of 58°N and east of the East Shetland Platform
  boundary faults".
- **DRAUPNE FM**, `.../litho/formations/28` — "Oxfordian to Ryazanian"; "marine
  environment with restricted bottom circulation and often with anaerobic
  conditions".
- **TAU FM**, `.../litho/formations/164` — "Kimmeridgian to Early Volgian";
  "anaerobic marine environment with high organic productivity and restricted
  bottom water circulation"; "confined to the central part of the type area of
  the Boknfjord Group".
- **FARSUND FM**, `.../litho/formations/39` — "Kimmeridgian to Volgian"; "mainly
  deposited in a low-energy marine environment"; "present throughout the Central
  Graben but thin or absent over the Southern Vestland Arch and intra-basinal
  highs".

**Measured from the wallchart**, Norwegian–Danish Basin column: an unbroken,
marine-ornamented succession Egersund → Tau → Sauda/Bjørghavn → Flekkefjord /
Frederikshavn → **Åsgard** (Valanginian–Barremian) → Tuxen → Sola → Rødby
(Albian) → Hidra (Cenomanian), with **no hiatus ornament** anywhere in the
Berriasian–Albian part of that column. The Central Graben columns carry
Mandal/Farsund and then Valhall over the same span.

**Measured** class, the three intervals the brief names:

| Point | 166–146 | 146–135 | 135–117 |
|---|---|---|---|
| Viking Graben (2.5 E, 60.5 N) | **`lm`+`sm` → renders land** | `sm` | `sm` |
| Viking Graben (2.0 E, 60.5 N) | `sm` | `sm` | `sm` |
| East Shetland Basin (1.5 E, 61.0 N) | `sm` | `sm` | `sm` |
| Central Graben NO (3.2 E, 56.5 N) | `sm` | `sm` | `sm` |
| Ekofisk (3.22 E, 56.55 N) | `sm` | `sm` | `sm` |
| Egersund Basin (5.5 E, 57.8 N) | **`lm`+`sm` → renders land** | **`lm`** | `sm` |
| Norwegian–Danish Basin (7.0 E, 56.8 N) | `sm` | `sm` | **`lm`** |
| Norwegian–Danish Basin (8.0 E, 56.5 N) | **`lm`+`sm` → renders land** | **`lm`** | **`lm`** |
| Norwegian–Danish Basin (6.0 E, 57.2 N) | `sm` | `sm` | `sm` |

**Verdict: PARTIAL.** The Central Graben, the Ekofisk area, the East Shetland
Basin and the western Viking Graben pass at all three intervals. Three failures:

- **Viking Graben at `166-146`** renders as land through the Heather Formation's
  own open-marine depocentre. Already recorded by the companion memo; this memo
  re-measures it on the working-tree payload and confirms it is unchanged.
- **Egersund Basin at `166-146` and `146-135`** renders as land through Tau and
  Draupne time. Already recorded; the wallchart's unbroken Egersund/Tau/Sauda/
  Flekkefjord column is a second, independent source for the same edit.
- **NEW: the eastern Norwegian–Danish Basin renders as land at `146-135` and
  `135-117`**, at (8.0 E, 56.5 N) and (7.0 E, 56.8 N). The wallchart puts the
  Åsgard Formation (Cromer Knoll Group, Valanginian–Barremian) across this
  column with no hiatus, and Rawson & Riley 1982,
  https://doi.org/10.1306/03B5AC87-16D1-11D7-8645000102C1865D, make the base of
  the Valhall Formation isochronous at the late Ryazanian transgression
  (*Snippet*, via the literature memo). This is the same overlap-and-land
  pattern the companion memo found at (4 E, 54 N) at `135-117`, extended
  north-east into the Skagerrak, and it is an extension of the same proposed
  operation rather than a new phenomenon.

---

## 5. Cretaceous chalk and the Cenozoic: is the Norwegian North Sea marine from `117-94` on?

**Sourced.** Sodir, all *Verbatim*:

- **HOD FM**, `.../litho/formations/66` — "Turonian to Campanian"; "Open marine
  with deposition of cyclic pelagic carbonates (periodites) and distal
  turbidites".
- **TOR FM**, `.../litho/formations/171` — "Late Campanian to Maastrichtian";
  "Open marine …"; "In the Norwegian sector it is very thin or absent on the
  Lindesnes Ridge and the Utsira High."
- **EKOFISK FM**, `.../litho/formations/33` — "Danian"; "Open marine …"; "In the
  Norwegian sector, it is missing from parts of the Sørvestlandet High and the
  Lindesnes Ridge."
- **SHETLAND GP**, `.../litho/groups/143` — "In the North Sea the group ranges in
  age from Cenomanian to Danian"; "present throughout the Norwegian North Sea,
  being absent only locally on highs".
- **FRIGG FM** (`.../formations/45`) and **UTSIRA FM** (`.../formations/183`)
  are quoted in full in the companion memo.

**Measured**, every interval from `117-94` to `11-2`, at Ekofisk (3.22 E,
56.55 N), Central Graben NO (3.2 E, 56.5 N), Egersund (5.5 E, 57.8 N),
Norwegian–Danish Basin (7.0 E, 56.8 N), Viking Graben (2.0 and 2.5 E, 60.5 N),
East Shetland Basin (1.5 E, 61.0 N) and the Utsira High crest: **`sm` at every
point in every one of the nine intervals**, with one exception.

**Verdict: PASS.** Nowhere in the Norwegian North Sea does the map draw land
between 117 Ma and 2 Ma. As the companion memo established, `sm` is an
environment class and not a depth, so this is "not land", not "shallow"; the
Chalk's real depth is not a claim the payload makes.

**The exception, Measured, and it is a payload-geometry finding, not a science
one.** At interval `11-2` a **hairline gap** runs through the shallow-marine
union near the Ekofisk area. On a 0.05° grid over 3.05–3.45 E, 56.35–56.70 N,
6 of 72 sample points are `neither`; refining at 3.20 E in 0.005° steps places
the gap between **56.500 N and 56.520 N**, i.e. about **0.02°, under 3 km wide**,
and it is absent at `20-11` and at every other interval tested. **Inference:**
this is a seam between adjacent `sm` pieces that survived quantisation and
simplification, and on screen it draws a thin line of blue "depth unmapped"
shelf across the middle of the Neogene North Sea. It carries no scientific
content and belongs to the compiler, not to a basin contract.

---

## 6. The Utsira High: when does the map stop drawing it as land?

**Sourced.** Riber, Morgan & Aagaard 2015, "Altered basement rocks on the Utsira
High and its surroundings, Norwegian North Sea", *Norwegian Journal of Geology*
95, 57–89, https://doi.org/10.17850/njg95-1-04, open access, all *Verbatim*:

- "The crystalline bedrock on the Utsira High has had an eventful past including
  its Caledonian origin and a tectonically active period from Permian to Early
  Cretaceous. During this time, the high was subaerially exposed for long
  periods followed by periods of quiescence and associated subsidence."
- "It is likely that basement rocks, now covered by Permian sediments, were
  exposed at the time and acted as source area for the Rotliegendes
  conglomerates which can be found in half-grabens on the high."
- "The Early Jurassic transgression from the north resulted in the deposition of
  marine shales and sandstones (Dunlin Group), which are preserved to the west
  in the Viking Graben, to the east on the Horda Platform and on the northernmost
  part of the Utsira High (well 25/6–1)".
- "From Late Triassic time, the basement was subaerially exposed and weathering
  took place."
- "Coarse-grained clastics of Callovian and Volgian age in grabens in the
  southern Utsira High indicate the subaerial exposure of the high through
  latest Jurassic time (Sørlie et al., 2014)."
- "The Avaldsnes h[igh] was transgressed in the Late Jurassic, whereas the
  Haugaland high remained dry land until the Early Cretaceous and represents the
  final stage of the exposure of the high."
- **"The deposition of an Early Cretaceous shallow-marine facies across the
  Utsira High marks the definitive end of subaerial exposure … Since then the
  Utsira High has gradually subsided to its present depth."**

A later, conflicting datum: Stemmerik et al. 2023, "Stratigraphic framework for
Zechstein carbonates on the Utsira High, Norwegian North Sea", *Journal of
Petroleum Geology*, https://doi.org/10.1111/jpg.12838, documents Zechstein
carbonates *on* the Utsira High at Avaldsnes and Lille Prinsen (*Snippet*: title
and subject confirmed, the paper's own text was not retrieved). That contradicts
the older Sodir statement that the Zechstein is "absent east and north of the
Utsira High" and supports the map's `sm` at `269-248`.

**Measured**, full series at the two crest wells and the 0.1° box
(1.8–2.9 E, 58.4–59.3 N, n = 120):

| Interval (Ma) | Edvard Grieg (2.235, 58.836) | Johan Sverdrup (2.615, 58.824) | 25/6-1 north (2.801, 59.526) | Box modal class |
|---|---|---|---|---|
| 402–380 | `lm` | `lm` | `lm` | `lm` 120/120 |
| 380–359 | `lm` | `lm` | `lm` | `lm` 100/120 |
| 359–338 | `lm` | `lm` | `lm` | `lm` 113/120 |
| 338–323 | `lm` | `lm` | `lm` | `lm` 111/120 |
| 323–296 | `lm` | `lm` | `lm` | `lm` 114/120 |
| 296–285 | `lm` | `lm` | `lm` | `lm` 120/120 |
| 285–269 | `lm` | `lm` | `lm` | `lm` 120/120 |
| 269–248 | `sm` | `sm` | **`lm`** | `sm` 109/120 |
| 248–224 | `lm` | `lm` | `lm` | `lm` 120/120 |
| 224–203 | `lm` | `lm` | `lm` | `lm` 120/120 |
| 203–179 | `sm` | `sm` | `sm` | `sm` 120/120 |
| 179–166 | `lm` | `lm` | `lm` | `lm` 120/120 |
| 166–146 | **`lm`+`sm` → land** | **`lm`+`sm` → land** | `sm` | `sm` 73, `lm`+`sm` 47 |
| 146–135 | `sm` | `sm` | `sm` | `sm` 120/120 |
| 135–117 | `sm` | `sm` | `sm` | `sm` 114/120 |
| 117–94 … 11–2 | `sm` throughout | `sm` throughout | `sm` throughout | `sm` 120/120 each |
| `lgm` | `lm` | `lm` | `lm` | `lm` 98/120 |

**Verdict: PASS on the high's history, FAIL on the brief's date.** The brief
expected the Utsira High to stay emergent "until ~94–81". The published
constraint is **Early Cretaceous**, not Late Cretaceous, and the shipped map
agrees with the published constraint: land at `179-166`, land-over-sea (so
land on screen) at `166-146` at both crest wells, shallow marine from `146-135`
onward. The transition falls in the `146-135` bin, i.e. the Berriasian–
Barremian, which is "Early Cretaceous". Three details corroborate the geometry
rather than contradicting it: the crest is land at `166-146` while the northern
tip at 25/6-1 is already `sm`, matching "the Avaldsnes high was transgressed in
the Late Jurassic, whereas the Haugaland high remained dry land until the Early
Cretaceous"; the high is land through the Late Triassic bins, matching "From
Late Triassic time, the basement was subaerially exposed"; and it is land in
the Permian bins the Rotliegend conglomerates were shed into.

**PARTIAL at `203-179`.** The map floods the whole high in the Early Jurassic,
where the source has the Dunlin Group preserved only "on the northernmost part
of the Utsira High (well 25/6-1)". **Not proposed as an edit**: the emergent
crest is roughly 25–40 km across, which is at or below Cao's own ~30 km
coastline tolerance and the class floor the contract already invokes when it
declines to draw "numerous isolated footwall islands". Drawing a 30 km island
here would assert a precision the source model does not carry. Recorded as a
limitation.

---

## 7. Nordland Ridge and Loppa High: hiatus is not emergence

Both lie **outside** the North Sea contract window (`bbox [-5, 53, 9, 62.5]`):
the Nordland Ridge box is 7–12 E, 65–67.5 N and the Loppa box 19–23 E,
71–73 N. Neither can be reached by `north-sea.json`, so any operation would need
its own basin contract.

### 7.1 Nordland Ridge

**Sourced.** Sodir, *Verbatim*:

- **NORDLAND GP**, `.../litho/groups/113` — "The Nordland Group is present
  throughout the Mid-Norwegian shelf, **but the lower part is not present on the
  crest of the Nordland Ridge**."
- **SHETLAND GP**, `.../litho/groups/143` — "The Shetland Group's
  representatives occur throughout the Mid-Norwegian shelf and are **only absent
  over parts of the Nordland Ridge**."
- **MOLO FM**, `.../litho/formations/209` — "Late Miocene – Early Pliocene"; "The
  formation extends from the coast off Møre at approximately 63°30′N, along the
  inner Mid Norwegian shelf **up to the Nordland Ridge and Lofoten area at
  approximately 67°40′N**"; "deposited in a coastal shallow marine to prograding
  deltaic environment".
- **NAUST FM**, `.../litho/formations/109` — "Late Pliocene"; "deposited in a
  marine environment. A transition to glaciomarine environments occurs in the
  upper part".

Færseth 2022, "The deep Møre and Vøring basins of the Norwegian Sea as basement
highs prior to Late Jurassic rifting", *Norwegian Journal of Geology* 101,
https://doi.org/10.17850/njg101-3-3, open access, *Verbatim*: "In well 6609/7-1
drilled up-flank on the Nordland Ridge …, 36 m of Upper Permian dolomitic
limestone rest directly on basement." And, of the adjacent Lofoten/inner-shelf
basement high: "Basement rocks were subaerially exposed until initiation of
Jurassic rifting, and the eroded and peneplaned basement shows deep pre-Jurassic
weathering".

**Measured**, full series at two Nordland Ridge wellbore positions and the
7–12 E, 65–67.5 N box (n = 66):

| Interval (Ma) | 6607/5-1 (7.539, 66.636) | 6610/3-1 (10.902, 66.925) | (10.0, 66.5) | Box modal class |
|---|---|---|---|---|
| 402–380 | `neither` | `lm` | `lm` | `lm` 54/66 |
| 380–359 | `neither` | `neither` | `neither` | `neither` 48/66 |
| 359–338 | `lm` | `lm` | `lm` | `lm` 62/66 |
| 338–323 | `lm` | `lm` | `lm` | `lm` 66/66 |
| 323–296 | `lm` | `lm` | `lm` | `lm` 62/66 |
| 296–285 | `neither` | `lm` | `lm` | `lm` 55/66 |
| 285–269 | `lm` | `sm` | `sm` | `lm` 47/66 |
| 269–248 | `sm` | `sm` | `sm` | `sm` 58/66 |
| 248–224 | `neither` | `sm` | `sm` | `sm` 35/66 |
| 224–203 | `lm` | `lm` | `lm` | `lm` 59/66 |
| 203–179 | `neither` | `sm` | `sm` | `sm` 34/66 |
| 179–166 | `neither` | `sm` | `sm` | **`neither` 46/66** |
| 166–146 | `neither` | `sm` | `sm` | `sm` 46/66 |
| 146–135 | `neither` | `sm` | `sm` | `sm` 28, `neither` 25 |
| 135–117 | `sm` | `sm` | `sm` | `sm` 47/66 |
| 117–94 | `sm` | **`lm`** | `sm` | `lm` 38/66 |
| 94–81 | `sm` | `sm` | `sm` | `sm` 48/66 |
| 81–58 | `sm` | `sm` | `sm` | `sm` 63/66 |
| 58–49 | `sm` | `sm` | `sm` | `sm` 54/66 |
| 49–37 | `sm` | `sm` | `sm` | `sm` 63/66 |
| 37–29 | `sm` | `sm` | `sm` | `sm` 57/66 |
| 29–20 | `sm` | `sm` | `sm` | `sm` 63/66 |
| 20–11 | `sm` | `sm` | `sm` | `sm` 63/66 |
| 11–2 | `sm` | `sm` | `sm` | `sm` 61/66 |
| `lgm` | `neither` | `neither` | `neither` | `neither` 66/66 |

**Verdict: FAIL against the brief's expectation, but the expectation is not
established.** The shipped map never draws the Nordland Ridge as land after
224–203 Ma except one point at `117-94`, so "land through 11–2" is not what the
payload says. The evidence the brief rests on, however, is the wallchart's
hatched **hiatus** column and Sodir's "the lower part is not present on the
crest" — both are statements that **section is missing**, which an eroded or
starved *submerged* high satisfies just as well as an island. Nothing retrieved
here says the Nordland Ridge crest stood above sea level in the Palaeogene or
Neogene. What *is* sourced is emergence in the **Palaeozoic** (Upper Permian
carbonate directly on basement in 6609/7-1; peneplaned, deeply weathered
basement on the neighbouring high "until initiation of Jurassic rifting") — and
the map already draws land there, at `402-380` through `296-285` and again at
`224-203`.

**No operation is proposed.** A `mid-norway` basin contract that turned the
chart's hiatus column into olive land would convert non-deposition into
emergence without a source. The Molo Formation's "coastal shallow marine to
prograding deltaic" character reaching the Nordland Ridge at ~67°40′N in the
Late Miocene–Early Pliocene is the nearest thing to a shoreline constraint in
the retrieved set, and it places a *coast* near the ridge, not the ridge above
water. This is left as a named open question with a witness (§8).

**One incidental finding.** The `179-166` bin over this box is dominantly
`neither` (46 of 66 samples). That is the withheld mountain class again — the
same pattern the companion memo's §6 diagnosed over the Scottish/Orcadian
upland, in a second place, and it is further evidence that the `m`-only exposure
needs its own global measurement.

### 7.2 Loppa High

**Sourced.**

- Worsley 2008, "The post-Caledonian development of Svalbard and the western
  Barents Sea", *Polar Research* 27, 298–317,
  https://doi.org/10.1111/j.1751-8369.2008.00085.x, open access, *Verbatim*:
  "**The Loppa High only became the site of marine sedimentation in the
  Anisian/Ladinian.**" Also: "Sandstones were now largely confined to the
  margins of the temporarily emergent highs and platforms around the
  Jurassic/Cretaceous transition"; "The uplift and erosion of northern shelf
  areas continued throughout the late Cretaceous"; "uplift of 1–2 km may have
  affected the northern platform areas" in the Palaeogene.
- Indrevær, Gabrielsen & Faleide 2017, "Early Cretaceous synrift uplift and
  tectonic inversion in the Loppa High area, southwestern Barents Sea, Norwegian
  shelf", *Journal of the Geological Society* 174, 242–254,
  https://doi.org/10.1144/jgs2016-066, *Verbatim* abstract: "The structures are
  of early Barremian to mid-Albian age (c. 131–105 Ma) and are focused in or
  near pre-existing extensional boundary faults along the margins of the Loppa
  High … **The model constrains the initiation of uplift of the Loppa High to
  the early Barremian**".
- Sodir, *Verbatim*: **SNADD FM**, `.../litho/formations/150` — "The Ladinian
  sequence represents relatively distal marine environments in all wells,
  following a major transgressive pulse **which submerged all structural highs
  and platform areas in the region**." **NYGRUNNEN GP**, `.../litho/groups/122`
  — late Cenomanian–Maastrichtian; "Open marine, deep shelf environments in the
  west passed into shallower starved shelf regimes (**uplifted at times**) in
  the east." **TORSK FM**, `.../litho/formations/172` — "Late Paleocene to
  Oligocene"; "Open to deep marine shelf". **NORDLAND GP**, `.../litho/groups/113`
  — "**Late Pliocene to Pleistocene/Holocene in the Hammerfest Basin**".

**Inference on the Barents Cenozoic.** Torsk ends in the Oligocene and the
Nordland Group begins in the Late Pliocene, so the Barents section itself
carries a long Neogene gap — which is the chart's hatched column and the reason
the brief read "exposed until the Late Pleistocene". Again the gap is a missing
section, not a proven land surface; Worsley's 1–2 km of Palaeogene–Neogene
uplift and the repeated glacial erosion are the mechanism, and that mechanism is
compatible with emergence but does not date it.

**Measured**, full series at the drilled Loppa positions, at the crest point,
and over the 19–23 E, 71–73 N box (n = 45), with the brief's mis-placed point
(23 E, 72.7 N) shown for contrast:

| Interval (Ma) | Alta 7220/11-1 (20.546, 72.057) | Gohta 7120/1-3 (20.270, 71.903) | crest (21.0, 72.0) | Box modal class | (23.0, 72.7) brief point |
|---|---|---|---|---|---|
| 402–380 | `lm` | `lm` | `lm` | `lm` 45/45 | `lm` |
| 380–359 | `sm` | `sm` | `sm` | `sm` 26/45 | `sm` |
| 359–338 | `lm` | `lm` | `lm` | `lm` 39/45 | `sm` |
| 338–323 | `lm` | `lm` | `lm` | `lm` 38/45 | `lm` |
| 323–296 | `sm` | `sm` | `sm` | `sm` 42/45 | `sm` |
| 296–285 | `sm` | `sm` | `sm` | `sm` 45/45 | `sm` |
| 285–269 | `sm` | `sm` | `sm` | `sm` 42/45 | `sm` |
| 269–248 | `sm` | `sm` | `sm` | `sm` 40/45 | `sm` |
| 248–224 | `sm` | `sm` | `sm` | `sm` 45/45 | `sm` |
| 224–203 | `sm` | `sm` | `sm` | `sm` 30/45 | `sm` |
| 203–179 | `sm` | `sm` | `sm` | `sm` 36/45 | `sm` |
| 179–166 | `sm` | `sm` | `sm` | `sm` 45/45 | `sm` |
| 166–146 | `sm` | `sm` | **`lm`+`sm` → land** | `sm` 30, `lm`+`sm` 13 | `lm`+`sm` |
| 146–135 | `sm` | `sm` | `sm` | `sm` 45/45 | `sm` |
| 135–117 | `sm` | `sm` | `sm` | `sm` 35, `neither` 10 | `sm` |
| 117–94 | `sm` | `sm` | `sm` | `sm` 28, `lm` 17 | `sm` |
| 94–81 | `sm` | `sm` | `sm` | `sm` 32, `lm` 13 | `sm` |
| 81–58 | `sm` | `sm` | `sm` | `sm` 37/45 | `sm` |
| 58–49 | `sm` | `sm` | `sm` | `sm` 44/45 | `sm` |
| 49–37 | `sm` | `sm` | `sm` | `sm` 45/45 | `sm` |
| 37–29 | `sm` | `sm` | `sm` | `sm` 41/45 | **`lm`** |
| 29–20 | **`lm`+`sm` → land** | **`lm`+`sm` → land** | **`lm`+`sm` → land** | `lm`+`sm` 40/45 | `lm`+`sm` |
| 20–11 | **`lm`** | **`lm`** | **`lm`** | `lm` 45/45 | `lm` |
| 11–2 | `sm` | `sm` | `sm` | `sm` 36/45 | `sm` |
| `lgm` | `neither` | `neither` | `neither` | `neither` 45/45 | `neither` |

**Verdict: PARTIAL, and the expectation is wrong in both directions.** The
brief expected land in every interval the high exists in, plus the `lgm` state.
The map instead gives shallow sea for almost the whole Palaeozoic and Mesozoic
and emergent land only at `29-20` and `20-11`. Point by point:

- The Triassic bins are **right for the wrong-sounding reason**. Worsley's
  Anisian/Ladinian marine onset means the Loppa High was non-marine in the
  Induan–Olenekian part of `248-224` and marine in its Anisian–Carnian part; a
  maximum-transgression bin selects the marine end member. The same "bin coarser
  than the feature" limitation that governs the Auk/Zechstein case governs this
  one, and the Snadd Formation's "major transgressive pulse which submerged all
  structural highs" is the positive statement for the bin's marine half. **Not
  editable.**
- The Early Cretaceous **misses the sourced uplift**. Indrevær et al. place the
  initiation of Loppa High uplift in the early Barremian (c. 131 Ma) with
  inversion to mid-Albian (c. 105 Ma). The map is `sm` at `135-117` at every
  drilled point and only reaches `lm` at 17 of 45 box samples at `117-94`, none
  of them on the crest. **Candidate op**, and the honest form of it is narrow:
  the sources establish *uplift and erosion*, and the Kolmule Formation's "open
  marine environments" (Sodir, Aptian–mid-Cenomanian, *Verbatim*) runs across
  the region at the same time, so an `add-land` over the whole high would
  overstate it. Recorded below as an op **not** proposed for this pass, pending
  a source that states subaerial exposure of the crest rather than inversion of
  its margins.
- The Oligocene–Miocene land at `29-20` and `20-11` is the map's own claim and
  **has no cited support in this memo's source set**: Torsk Fm deposition runs
  to the Oligocene and the Barents Neogene is a gap, so the map's emergent
  Loppa/Bjarmeland area is at best consistent with the gap and is not
  contradicted — but neither is it evidenced. Left alone, witnessed.
- **`lgm` is `neither` across the whole Barents box.** That is by design: the
  detached lowstand state is a bounded Doggerland/Sundaland/Beringia overlay and
  carries no Barents geometry. The brief's "land in the lgm state" is therefore
  not merely absent but out of that state's declared scope, and at the Last
  Glacial Maximum the Loppa High was beneath the Barents Ice Sheet, which is a
  third thing the class vocabulary cannot say. **Not editable without extending
  the lowstand state's declared domain.**

---

## 8. Expectation vs modelled

| # | Check | Expectation | Modelled | Verdict |
|---|---|---|---|---|
| 1 | Permian–Triassic continental, Egersund / Central Graben NO / Viking Graben | land at `296-285`, `285-269`, `248-224`, `224-203`; Zechstein sea at `269-248` | `lm` at all four land bins at all three points; `sm` at `269-248` at the two southern points; `lm` at (2.5 E, 60.5 N) | **PASS** — the Viking Graben land at `269-248` is the sourced northern limit of the Zechstein, not a defect |
| 2 | Dunlin Group marine at `203-179`, Viking Graben and East Shetland Basin | marine | `sm` at every Norwegian North Sea point | **PASS** |
| 2b | Dunlin, Utsira High crest | Lower Jurassic absent on the crest | `sm` over the whole high | **PARTIAL** — below the ~30 km class floor; limitation, not an edit |
| 3 | Mid-Jurassic dome, `179-166` | land/erosion in the south, Brent delta in the north | `lm` everywhere south of 60.5 N; `sm` from 61.0 N | **PASS** |
| 4a | Late Jurassic–Early Cretaceous, Central Graben / Ekofisk / East Shetland Basin | marine at `166-146`, `146-135`, `135-117` | `sm` at all three intervals | **PASS** |
| 4b | Viking Graben (2.5 E, 60.5 N) at `166-146` | marine (Heather Fm depocentre) | `lm`+`sm` → renders land | **FAIL** — already recorded by the companion memo, re-confirmed on the working-tree payload |
| 4c | Egersund Basin at `166-146` and `146-135` | marine (Tau, Draupne) | `lm`+`sm` → land; `lm` | **FAIL** — already recorded; the wallchart's unbroken Egersund/Tau/Sauda/Flekkefjord column is a second source |
| 4d | Norwegian–Danish Basin at `146-135` and `135-117` | marine (Åsgard Fm, Cromer Knoll) | `lm` at (8.0 E, 56.5 N) at both; `lm` at (7.0 E, 56.8 N) at `135-117` | **FAIL, new** — same pattern as (4 E, 54 N), extended NE into the Skagerrak |
| 5 | Chalk and Cenozoic, `117-94` … `11-2`, Norwegian North Sea | marine throughout | `sm` at every point in all nine intervals | **PASS** |
| 5b | (not asked) `11-2` near Ekofisk | — | a < 3 km hairline gap in the `sm` union at 56.500–56.520 N on 3.20 E | **FAIL, compiler scope** — a geometry seam, not a basin item |
| 6 | Utsira High emergent until ~`94-81` | land to the Late Cretaceous | land at `179-166` and `166-146` (crest), marine from `146-135` | **PASS on the map, FAIL on the brief's date** — the published end of exposure is Early Cretaceous, and the map agrees |
| 7a | Nordland Ridge land through `11-2` | land | `sm` from `203-179` onward except one `lm` point at `117-94`; `neither` at `lgm` | **FAIL against the brief; the brief's premise is unsupported** — the chart's hatch and Sodir's "not present on the crest" are missing-section statements |
| 7b | Loppa High land in every interval and at `lgm` | land | `sm` for nearly all of the Palaeozoic–Mesozoic; land only at `29-20` and `20-11`; `neither` at `lgm` | **PARTIAL** — Triassic bin coarser than the feature; Early Cretaceous uplift unrepresented; `lgm` outside the lowstand state's declared domain |

---

## 9. Consequence

### 9.1 Witnesses to add

Positions, intervals and **expected class sets as measured here**. Rows marked
*after the fix* must be added only once the corresponding edit lands, or they
lock in the defect. `WITNESS_INTERVALS` in
`scripts/research/palaeo_coastlines_correction.py` is presently
`("402-380", "269-248", "248-224", "94-81")`; rows below that name other
intervals need that tuple extended, as the companion memo also recommends.

| Witness id | Position (lon, lat) | Interval | Expected classes | Why it must not drift |
|---|---|---|---|---|
| `zechstein-viking-graben-north-limit` | (2.5, 60.5) | `269-248` | `["lm"]` | the land side of the Zechstein's northern limit; pairs with the existing `viking-graben` witness at (2.0, 60.5) = `["sm"]` to fix that limit to a 0.5° band |
| `skagerrak-triassic-dryland` | (7.0, 56.8) | `248-224` | `["lm"]` | the Norwegian–Danish Basin Triassic continental bin (Smith Bank / Skagerrak facies) |
| `dunlin-viking-graben` | (2.5, 60.5) | `203-179` | `["sm"]` | the Early Jurassic marine Viking Graben; the negative control for any future mid-Jurassic land extension |
| `dunlin-east-shetland-basin` | (1.5, 61.0) | `203-179` | `["sm"]` | the same for the East Shetland Basin |
| `mid-jurassic-dome-central-graben-no` | (3.2, 56.5) | `179-166` | `["lm"]` | the Norwegian-sector dome/unconformity that the Gassum erosion statement records |
| `utsira-high-late-jurassic-island` | (2.235, 58.836) | `166-146` | `["lm","sm"]` | the Edvard Grieg position must stay emergent through latest Jurassic time; the class set form is required, an `lm`-membership test would not detect its loss |
| `utsira-high-drowned` | (2.235, 58.836) | `146-135` | `["sm"]` | the "definitive end of subaerial exposure" must not creep younger |
| `utsira-high-north-tip-drowned` | (2.801, 59.526) | `166-146` | `["sm"]` | 25/6-1: the northern tip is already marine while the crest is land; the pair encodes Avaldsnes-vs-Haugaland |
| `norwegian-danish-basin-cromer-knoll` | (8.0, 56.5) | `135-117` | `["sm"]` **after the fix** (today `["lm"]`) | the Åsgard/Cromer Knoll marine basin |
| `norwegian-danish-basin-ryazanian` | (8.0, 56.5) | `146-135` | `["sm"]` **after the fix** (today `["lm"]`) | the late Ryazanian transgression at the basin's eastern end |
| `ekofisk-chalk-sea` | (3.22, 56.55) | `94-81` | `["sm"]` | the chalk sea at the Ekofisk position; `94-81` is already a witness interval, so this row costs nothing |
| `nordland-ridge-crest` | (10.902, 66.925) | `11-2` | `["sm"]` | pins the open question: the map does **not** draw the ridge as land in the Neogene, and it must not start doing so without a source that states emergence rather than missing section |
| `loppa-high-crest-neogene` | (20.546, 72.057) | `20-11` | `["lm"]` | the map's own Miocene emergent Loppa High; unevidenced either way, so it must not drift silently |
| `loppa-high-triassic-flooded` | (20.546, 72.057) | `248-224` | `["sm"]` | the Anisian/Ladinian marine onset that the maximum-transgression bin selects; `248-224` is already a witness interval |

### 9.2 Operations, by basin contract

**`north-sea.json`** (window `[-5, 53, 9, 62.5]`, so all three reachable):

| Op | Interval(s) | Kind and extent | Uncertainty | References |
|---|---|---|---|---|
| Viking Graben Heather depocentre | `166-146` | `remove-land` over the graben axis around (2.5 E, 60.5 N); the `sm` piece is already present, so nothing is added. Extent in words: an elongate N–S strip along the graben axis between about 2.1 E and 3.0 E, 60.0 N to 61.0 N | 50 km | Sodir HEATHER FM (`/formations/60`), Bathonian–Kimmeridgian, "open marine environment"; Vollset & Doré 1984, NPD-Bulletin 3; Underhill & Partington 1993, https://doi.org/10.1144/0040337 — **already proposed by the companion memo; this memo only re-confirms it** |
| Egersund Basin source-rock kitchen | `166-146`, `146-135` | `remove-land` over the Egersund Basin around (5.5 E, 57.8 N); extent in words: the Egersund Basin and the Boknfjord Group type area, roughly 4.8 E–6.3 E, 57.3 N–58.3 N | 50 km | Sodir TAU FM (`/formations/164`) and DRAUPNE FM (`/formations/28`); wallchart Norwegian–Danish Basin column (Egersund → Tau → Sauda/Bjørghavn → Flekkefjord, unbroken) — **already proposed; second source added here** |
| **Norwegian–Danish Basin, Late Jurassic to Cromer Knoll, NEW** | `166-146`, `146-135`, `135-117` | `remove-land` over the eastern Norwegian–Danish Basin and western Skagerrak; extent in words: a WNW–ESE lens from about 6.3 E to 9.0 E (the contract window's eastern edge), 55.8 N to 57.3 N, covering the (7.0, 56.8) and (8.0, 56.5) failures and stopping short of the Norwegian coast. The `sm` class is already present at all three intervals at (6.0 E, 57.2 N), and at (8.0 E, 56.5 N) at `166-146`, so this is a removal only. `166-146` is included because (8.0 E, 56.5 N) renders land there too, at Egersund/Tau time, which the same unbroken wallchart column contradicts | 60 km | wallchart Norwegian–Danish Basin column: Åsgard (Valanginian–Barremian), Tuxen, Sola, Rødby, no hiatus ornament; Sodir FARSUND FM (`/formations/39`); Rawson & Riley 1982, https://doi.org/10.1306/03B5AC87-16D1-11D7-8645000102C1865D |

**`mid-norway` (a contract that does not exist): none proposed.** The Nordland
Ridge evidence retrieved here is stratigraphic absence, not emergence. Creating
the contract now would mean writing an operation whose `claimOrInference` field
had to say "the source states the section is missing; that it was dry land is
EarthHistory's own inference" — which is precisely the kind of inference the
project's rules forbid dressing as a sourced claim. Open question recorded, with
the `nordland-ridge-crest` witness to detect drift.

**`barents-loppa` (a contract that does not exist): none proposed in this
pass.** The one genuinely sourced mismatch is the Early Cretaceous: Indrevær et
al. date the initiation of Loppa High uplift to the early Barremian
(c. 131 Ma), inside `135-117`, and the map is `sm` there. The op that would
follow — `add-land` over the Loppa High crest at `135-117`, extent roughly
19.5 E–22.5 E, 71.4 N–72.6 N, uncertainty 60 km — is **held**, because the
retrieved text establishes uplift and inversion of the high's margins, not
subaerial exposure of its crest, and the coeval Kolmule Formation is described
as open marine across the region. It should be reconsidered only with a source
that states exposure or a sub-Cretaceous unconformity truncating the crest.
Note also that this contract, if created, must be reconciled with
[regional-barents-correction.md](regional-barents-correction.md): that
correction is a **pre-540 Ma material mask** whose surface state is `unknown`
throughout and whose support window is `(410, 540]` Ma. It makes no surface
claim in any Cao palaeo-coastline interval and therefore does not conflict with
a Loppa operation — but the two must not be confused, and any `barents-loppa`
contract has to say so in its own `description`.

**Compiler scope, not a basin contract:** the sub-3 km hairline gap in the
`sm` union at `11-2` near (3.20 E, 56.51 N), and the `179-166` `neither` field
over the mid-Norwegian shelf, which is the withheld mountain class in a second
location and reinforces the companion memo's call for a global `m`-only
exposure measurement.

---

## Reproduction

```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
$PY <probe>   # imports palaeo_coastlines_compile read-only; decodes
              # public/data/reconstruction/cao-v2.4/palaeo-coastlines/{lm,sm}/*.ehpr,
              # unions each class per interval and tests shapely contains()
```

The probe scripts, their raw JSON, the retrieved wallchart and the scraped Sodir
field text were written to the session scratch directory
`/private/tmp/claude-501/-Volumes-EksternalHome-Koding-HTML-EarthHistory/795e3aa9-9911-4167-b7c7-76edc2aba7b8/scratchpad/no-shelf/`
(`probe.py`/`probe.json` for the point series, `probe2.py` for the three
structural-element boxes, `probe3.py` for the clarifying points, `probe4.py`/
`probe5.py` for the `11-2` hairline gap, `sodir.json`/`sodir2.json` for the
scraped lithostratigraphy, `wallchart.pdf`/`wallchart.txt` and the rendered
crops for the chart). That tier expires; every number and quotation this memo
relies on is reproduced above.

## Appendix — sha256 of every payload read

All 50 payload digests equal the values the shipping class catalogs pin on them,
both as read and as committed. The two catalog JSONs were re-serialised between
the probe and the commit; their content and their payload pins are unchanged.

| File | Bytes | sha256 as read | vs HEAD |
|---|---:|---|---|
| `palaeo-lm-11-2.ehpr` | 185978 | `9bbeb82f19ad82d06f4fd72dea1fc644ae7647bb83f0abf87c92a4dcdc33f6ac` | identical to HEAD `192cc22` |
| `palaeo-lm-117-94.ehpr` | 151330 | `edf0831d18511c2a79df7810c14e9c18b391fb61657ba26079fb05f540549101` | identical to HEAD `192cc22` |
| `palaeo-lm-135-117.ehpr` | 159602 | `8e560f03328c806169a49951d53cef7694c01d66c7b263fc278fce341dac591c` | identical to HEAD `192cc22` |
| `palaeo-lm-146-135.ehpr` | 153156 | `292de9daac3dc007fe77d5abc2c31e4142be6de8bae2ad3509d7722c2cd3dfb8` | identical to HEAD `192cc22` |
| `palaeo-lm-166-146.ehpr` | 158814 | `141a22021974a487630ad693b4c9eb6af922941780cc7802b9a16e4c366438f9` | identical to HEAD `192cc22` |
| `palaeo-lm-179-166.ehpr` | 133650 | `006d6d1d63760041bdd20e5cb63b37902590fd0d5c5bfac7f0ac4a2ef8ed00ae` | identical to HEAD `192cc22` |
| `palaeo-lm-20-11.ehpr` | 172812 | `174c1b598689bad99e60d50c5e4019139d3709410833052c30f719d974919217` | identical to HEAD `192cc22` |
| `palaeo-lm-203-179.ehpr` | 133140 | `70b15563bfacec700db374c9342261ffb58ae725db8f1d2feaa83c9b09e64292` | identical to HEAD `192cc22` |
| `palaeo-lm-224-203.ehpr` | 123934 | `58d22ca39ba9cb426bd87b393303ff14549f5e6f7ff63ad966f47e70d7b76ba8` | identical to HEAD `192cc22` |
| `palaeo-lm-248-224.ehpr` | 126206 | `671f9f8efb9a067dcc7f7299016a23f4f3b44a00680d32a0304524a97e8462f4` | identical to HEAD `192cc22` |
| `palaeo-lm-269-248.ehpr` | 116334 | `ba605472454cda073a87b3ba5e2f97fe6b542a0a9aec6a330f8891b5d21ca75c` | identical to HEAD `192cc22` |
| `palaeo-lm-285-269.ehpr` | 118968 | `44e826fc3b4039d4bbd3c097c965108c00b98a22e8d63f7a9679673b53b35361` | identical to HEAD `192cc22` |
| `palaeo-lm-29-20.ehpr` | 182164 | `fb23308755022f10d757d26222d732e48a960753c788c040a31298c51d980f94` | identical to HEAD `192cc22` |
| `palaeo-lm-296-285.ehpr` | 110900 | `80c3da115e4b92bf6ffb9478a6bed46d548849de155c6ee92cdbc3002a35eb2e` | identical to HEAD `192cc22` |
| `palaeo-lm-323-296.ehpr` | 85748 | `bc744fb9e5b0aa3f66331f62d23962746d43a30e3c776d573a33fd603a1f31f4` | identical to HEAD `192cc22` |
| `palaeo-lm-338-323.ehpr` | 111742 | `b2b2e7d48670dca7a166dc1676c09252a2cb7e6a25ed19b1db6c9930eeb11ec1` | identical to HEAD `192cc22` |
| `palaeo-lm-359-338.ehpr` | 107268 | `9e6b2c13e4441274362af5f6c308623273fb3d20427a0a7d38ad061e80ccead4` | identical to HEAD `192cc22` |
| `palaeo-lm-37-29.ehpr` | 188492 | `683326354e4c8c0cee1d34440887c234a9391830b274a4b49ecd134dab1325a9` | identical to HEAD `192cc22` |
| `palaeo-lm-380-359.ehpr` | 103114 | `a91182ecdb902c85f28d91f64c40622b88a738a7b401ef8d1e7042fb187924d9` | identical to HEAD `192cc22` |
| `palaeo-lm-402-380.ehpr` | 103886 | `1b09e045e50a542a94609562d78d21448a90178bb734a2f8a6a242f3c2a96169` | identical to HEAD `192cc22` |
| `palaeo-lm-49-37.ehpr` | 170324 | `abf1a35d7f8c19629f2eabd9008df6f97a588a1e6281ac1eaec99247f84c11c6` | identical to HEAD `192cc22` |
| `palaeo-lm-58-49.ehpr` | 163712 | `0048e6041fc233e229640f9b6a77331261d5fc17d80b23b604274046ebd0f855` | identical to HEAD `192cc22` |
| `palaeo-lm-81-58.ehpr` | 141600 | `f0e7fc3ed72beac5f348e018d410539a05fb0ad70bab1cbcbe1bc58328da847e` | identical to HEAD `192cc22` |
| `palaeo-lm-94-81.ehpr` | 137316 | `8018b1ab8c557a8341cdc082376bd79c0180f0a0f77b96d55747f391dd60608f` | identical to HEAD `192cc22` |
| `palaeo-lm-catalog.json` | 34422 | `64ab931f8d42e7bbaf44996ee5a2113d9789e8b419e8fb1aee7f4d3b6f8d8296` | serialisation differs from HEAD `192cc22`; content identical |
| `palaeo-lm-lgm.ehpr` | 40746 | `e928401e12eaf52e6ad6952fa9b0140b0171bd3e927d76b3880030a0f2e06c2e` | identical to HEAD `192cc22` |
| `palaeo-sm-11-2.ehpr` | 173072 | `388db45068d2336505f1e10ad14de996b5a50b3227b4af368cfc51eec129b820` | identical to HEAD `192cc22` |
| `palaeo-sm-117-94.ehpr` | 146712 | `aa1204f5e849fee0448beacb29f9b6f2a169073b405ce03383f6cac73a7a27e4` | identical to HEAD `192cc22` |
| `palaeo-sm-135-117.ehpr` | 129988 | `d58df57ca23776a2c52ff8682ac19c956d9a9a6303ac8d54dc35e2da4c37df4c` | identical to HEAD `192cc22` |
| `palaeo-sm-146-135.ehpr` | 143130 | `c95a9113450f8eebc558afa75ebe1fa4a2a1061f8bba193121e91b06b960e272` | identical to HEAD `192cc22` |
| `palaeo-sm-166-146.ehpr` | 166616 | `5a7682847e31273e00a91bd652fcff3e4e9a7d5ab6a09ff239c7ab9b4b6d4f6c` | identical to HEAD `192cc22` |
| `palaeo-sm-179-166.ehpr` | 120482 | `1fcde2b72104891850d5d3811a91bdcaee4841430b8aa8e1b9223e51be5e4167` | identical to HEAD `192cc22` |
| `palaeo-sm-20-11.ehpr` | 174932 | `c00ada47eac3d744057f59f031b43dbc9c0ce091cd350d630c7425b11605555e` | identical to HEAD `192cc22` |
| `palaeo-sm-203-179.ehpr` | 132240 | `7cab00772d42f64c796f90755f3f4ae8ac865c054e46dcecc2c02f7ee1e2a0b7` | identical to HEAD `192cc22` |
| `palaeo-sm-224-203.ehpr` | 112784 | `54c0c21ae462d43a0ce9ad0ceaf8662fc87991df1652bad822e21eb7e2cffe43` | identical to HEAD `192cc22` |
| `palaeo-sm-248-224.ehpr` | 104520 | `987acea327a41931130bb7aa06df7eda63dd8c1f517b4966d02632e75f1f3f66` | identical to HEAD `192cc22` |
| `palaeo-sm-269-248.ehpr` | 106314 | `1b20c3a983b64eab1547db338a94cbf2aca5cf809867b232015133bc7fba7fcb` | identical to HEAD `192cc22` |
| `palaeo-sm-285-269.ehpr` | 80296 | `effa1e734d833a50196e7e684863a57e44be77e3a1486cc67fcd6ffa6793dff0` | identical to HEAD `192cc22` |
| `palaeo-sm-29-20.ehpr` | 188182 | `ac7d0c78831b238be4e61f8c8168e9d851bb635adcf5681cde590649eb20f335` | identical to HEAD `192cc22` |
| `palaeo-sm-296-285.ehpr` | 93430 | `21ec3e6182ca728fd10ecf2c7191fd0bb0c36146c4dcd008bdab37e91c39b10b` | identical to HEAD `192cc22` |
| `palaeo-sm-323-296.ehpr` | 125532 | `f38711ae9d576e87cc8d5f622058ed11f578275dc6dc465d7715b1d1b698a118` | identical to HEAD `192cc22` |
| `palaeo-sm-338-323.ehpr` | 136450 | `13970e23b2c6ac5380dc266f48cbfe4b176e3c93d2423fab657098ce263baece` | identical to HEAD `192cc22` |
| `palaeo-sm-359-338.ehpr` | 119584 | `fd476e748221dc749c22390183fac39c8829bbafb3efde04b8641be8f8c6dbd3` | identical to HEAD `192cc22` |
| `palaeo-sm-37-29.ehpr` | 193690 | `d46bee94dc89e200f233574664f132d86f7c5ea924d1a14d391b673ed551e374` | identical to HEAD `192cc22` |
| `palaeo-sm-380-359.ehpr` | 144338 | `b5c1b20c251fb645ab9d3de260e1ea9b6cff2e9fe3236ea70e8a7ef9b89e0d43` | identical to HEAD `192cc22` |
| `palaeo-sm-402-380.ehpr` | 152032 | `2d69a49563ccf5b30acdbf85530ba53df8b2d3107e0b0e33494a9e568e2aba78` | identical to HEAD `192cc22` |
| `palaeo-sm-49-37.ehpr` | 198842 | `3ba6c52857d503f61041b9cc3dad1277b300b1e01b74c7fc395f057395ccbc36` | identical to HEAD `192cc22` |
| `palaeo-sm-58-49.ehpr` | 178368 | `1aa116d25d1a63b9eca33e1120726e3732e34d36b9371ef4299ab240b58d737a` | identical to HEAD `192cc22` |
| `palaeo-sm-81-58.ehpr` | 181196 | `c0c6eb54f7da728b0f74bdcb5fab1ed27557ff793e3adefec668cb02c3a71535` | identical to HEAD `192cc22` |
| `palaeo-sm-94-81.ehpr` | 166896 | `cb985fe5083f4684223f5f377fb708d549707d1d3f83ba0e42a6bca216d76463` | identical to HEAD `192cc22` |
| `palaeo-sm-catalog.json` | 49491 | `6bf8f80c7ff66fea66b07674ea3aa87b7d07e99129c41bf93db8cd6ddc421035` | serialisation differs from HEAD `192cc22`; content identical |
| `palaeo-sm-lgm.ehpr` | 32 | `8547cf88b309c0a2120a0f5e0093f6eadc8a43cda013eb967657fefade4c038f` | identical to HEAD `192cc22` |
