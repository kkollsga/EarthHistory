# Restored pre-collision margins for the Alps and the Caledonides — design

Design date: 2026-09-15. This memo designs, but does not ship, cited
**model-inference crust charts** that give the Alps and the Scandinavian
Caledonides the pre-collision continental margin their orogens consumed. It
answers the two `FAIL` rows in
[palaeo-coastlines-collision-shortening.md](palaeo-coastlines-collision-shortening.md)
— Adria 0 km against a ≥ 140 km minimum, Baltica 122 km of modern Atlantic shelf
against ≥ 140 / 250 / 400 km — by authoring the missing crust the way Cao et al.
(2024) already author **Greater India based on Gibbons et al. (2015) Gondwana
Research**: a first-class polygon on the lower plate, with a lifecycle that
retires it when the collision consumes it.

**Status: implemented 2026-09-15.** This memo is kept as the design record; what
actually ships, and every number re-derived from the tracked contract, is in
[palaeo-coastlines-restored-margins.md](palaeo-coastlines-restored-margins.md).
Where the two disagree, the implementation record wins — it names the two places
the implementation departed from this design (the charts ship in their own
`material-correction-restored-margin` batch rather than joining
`material-correction-uncertain`, because a surface appearance is declared per
batch; and the seam schedule's inter-stage overflow is declared and gated rather
than assumed away). The projected acceptance run in
[§ F](#f-projected-acceptance) was reproduced by the shipped gate, transect for
transect.

**It is crust, not land.** No strip in this design asserts a shoreline, a water
depth, a relief or a subaerial exposure at any age. Every strip carries
`surfaceEvidence: { kind: "unknown" }`, and [§ D.4](#d4-the-palaeo-coastline-layer-cannot-lend-these-strips-a-class)
records the measurement showing why no Cao 2017 palaeo class can be inherited.

---

## A. What is authored, in one table

| Collision | Margin | Plate | Restored width | Strips | Area | Consumed between |
|---|---|---:|---:|---:|---:|---|
| Alps | Adriatic (lower-plate retro-wedge and rifted margin) | 307 / 308 | **186 km** | 3 × 2 | 124,185 km² | 35 → 5 Ma |
| Alps | European / Briançonnais | 305 | **234 km** | 4 | 130,167 km² | 40 → 10 Ma |
| Caledonides | Baltoscandian | 302 | **401 km** | 3 | 448,051 km² | 430 → 405 Ma |
| Caledonides | Laurentian (East Greenland) | 102 | **202 km** | 2 | 145,557 km² | 425 → 410 Ma |

15 features, 847,960 km² of restored continental crust, all in present-day WGS84
reference coordinates at `geometryReferenceAgeMa = 0`, all riding Cao rigid plate
motion, all `epistemicStatus: model-inference` with `poseStatus: model-inference`.

The **Greater India precedent** this follows, restated so the parallel is exact:
Cao 2024 carries 4.20 Mkm² of Indian crust on plate 501 that no present map shows,
names it after the paper it comes from, and ends its lifecycle at 10 Ma. That is
the entire pattern. Nothing here is more speculative than that feature; the
difference is only that Cao authored theirs and we author ours, so ours must
carry its own sources, its own spread and its own retirement arithmetic.

---

## B. Provenance and method

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` (pyGPlates 1.0.0) |
| Plate model | `cao2024-v2.4/1.8Ga_model_GSF`: `shapes_continents.gpmlz`, `shapes_coasts.gpmlz`, `static_polygons.gpmlz`, **both** rotation files (`1000_0` and `1800_1000`) |
| Model integrity | **Measured.** Every source collection's `sha256` re-computed and compared with the digest the tracked corrections already pin. |
| Packages read | `public/data/reconstruction/cao-v2.4/palaeo-coastlines/{lm,sm}` — all 28 payloads read match their pinned digests |
| Tracked correction read | `data/corrections/north-sea-restoration/restoration-contract.json` (pole, angle schedule) |

**Method, Measured.** Three quantities were derived here and none copied:

1. **Datum profiles** — the Cao continental and coastline limits the strips are
   offset from, by point-in-polygon sampling on the sphere at 0.01–0.02°.
2. **Seam width** — how much empty space the model leaves between the two
   converging crust sets on a named transect at a named age. For the Alps this is
   the pin-pair closure minus the present-day pin separation; for the Caledonides
   it is the crust-to-crust minimum great-circle gap of the reconstructed sets.
3. **Projected extent** — the shortening validator's own transect measure, run
   with the drafted polygons joined to the lower-plate crust group.

**Inference.** A strip width is a published number; a strip *retirement age* is
not. It is a schedule fitted to the model's own closure so that surviving crust
never exceeds the room the model leaves for it, snapped to published stage
boundaries. Both halves are declared separately in the manifest, and the
retirement age is labelled `Inference` everywhere it appears.

---

## C. The Alps: Adria–Europe

### C.1 Width, from the literature

| Source | Constrains | Number | Tag |
|---|---|---|---|
| Le Breton et al. 2021 ([10.5194/se-12-885-2021](https://doi.org/10.5194/se-12-885-2021)) | the final width of each rifted domain | necking zone "**45–65 km**"; distal margin (crust < 10 km, hyper-extended and OCT) "**40–80 km**"; oceanic domain "**maximum 250 km**"; total Piemont–Liguria Basin "**480 km**" | Verbatim |
| Le Breton et al. 2021 | the preserved Adriatic proximal margin | "an **initial length of ca. 300 km** … This amount should be regarded as an **absolute minimum**, as this section represents only the preserved proximal part of the Adriatic margin" | Verbatim |
| Le Breton et al. 2021 | the pure-shear budget across both conjugates | "**380 km** for the proximal margins (> 10 km thick), **120 km** for the hyper-extended or OCT zone (< 10 km thick), and **240 km** of oceanic crust" | Verbatim |
| Le Breton et al. 2021 | convergence | "**680 km since 84 Ma**" (420 km 84–35, 260 km 35–0); "at least **63 %**" of the consumed material was extended continental lithosphere or OCT | Verbatim |
| Schmid et al. 1996 ([10.1029/96TC00433](https://doi.org/10.1029/96TC00433)), reproduced verbatim in Schmid et al. 2004 TRANSMED | N–S convergence stages, NFP20-East | 200 km (65–50 Ma), 150 km (50–40), "**45 km** … a minimum estimate only" (40–32), "a total of **58 km**" (32–19), "a total of **61 km**" (19–0) | Verbatim of the citing paper |
| Schmid et al. 1996, same route | Adria's own retro-wedge | "a total of **56 km** post-Adamello phase shortening in the Southern Alps"; **15 km** of Insubric backthrusting | Verbatim of the citing paper |
| Handy et al. 2010 ([10.1016/j.earscirev.2010.06.002](https://doi.org/10.1016/j.earscirev.2010.06.002)) | post-Eocene shortening; subducted margin width | "**160 km** … post-Eocene N–S crustal shortening"; "**63 km** … north of the Insubric Line"; "we assumed the width of the subducted part of the continental margins to have been about **100 km**" | Verbatim |
| Rosenberg et al. 2015 ([10.1002/2014TC003736](https://doi.org/10.1002/2014TC003736)) | the low end of the spread | 30–95 km north of the Periadriatic Line, Central Alps; 75–110 km, Eastern Alps | **Snippet** — search-result summary only, not verified |
| Kissling & Schlunegger 2018 ([10.1002/2017TC004762](https://doi.org/10.1002/2017TC004762)) | the competing interpretation | "a **rollback orogeny model** … the construction of surface topography is accomplished **without the requirement of a hard collision** between two continents" | Verbatim abstract; carries no kilometre figure |

**Derived widths, Inference.** Le Breton's 45–65 and 40–80 km are per conjugate
margin: 2 × (85–145) + 250 = 420–540, against their stated 480 km total, which is
the internal check that they are per-margin.

* **Adriatic, 186 km** = 60 (distal, the 40–80 midpoint) + 55 (necking, the 45–65
  midpoint) + 71 (56 km Southern Alpine post-Adamello + 15 km Insubric).
  Inside the published band 140–300 km and inside the tracked memo's best
  estimate 150–220 km.
* **European, 234 km** = 2 × 40 (distal floors: the Briançonnais ribbon has a
  distal margin facing Piemont–Liguria **and** one facing the Valais) + 2 × 45
  (necking floors, same two sides) + 60 (below Handy's 63 km north of the
  Insubric Line, and well below their 100 km subducted-margin assumption). The
  tracked memo's European figure is ≥ 230 km; this reproduces it from named
  components. The extra 4 km on the outer strip is **not** a scientific claim: it
  exists only so the 0.02° transect sampling cannot read below the 230 km floor.

Piemont–Liguria and Valais **oceanic** lithosphere is deliberately not authored.
It was never continental and never land, and it is what the residual seam in
[§ C.3](#c3-the-consumption-schedule-and-its-arithmetic) represents.

### C.2 Geometry and carrying plates

The datum is the model's own outlines, sampled at 0.25° from 7.75 E to 15.00 E
(**Measured**, 0 Ma frame):

| Meridian | Adria-group north limit | Europe-group south limit |
|---|---:|---:|
| 8 E | 45.56 N (plate 307) | 46.30 N |
| 10 E | 47.30 N (plate **308**) | 47.32 N |
| 12 E | 47.68 N (plate 308) | 47.70 N |
| 14 E | 47.06 N (plate 308) | 47.92 N |

Two facts fall out of that table and both change the design.

* **The crust facing the Alps is plate 308, not 307.** `Eastern Dinaride
  Platform` (308) carries the Adriatic outline from 9.00 E eastwards; `Adria`
  (307) carries it from 7.75 to 8.75 E. They are *not* the same pose: measured
  apart at 0 km at 20 Ma, **33 km at 35 Ma, 93 km at 84 Ma and 114 km at 130 Ma**.
  The Adriatic strips are therefore authored as two families split at 8.875 E,
  each bound to the plate that carries its own datum crust.
* **Cao leaves a hole in the present-day Alps.** At 8 E, 45.56–46.30 N (82 km)
  and at 14 E, 47.06–47.92 N (95 km) no continental polygon of either plate
  exists at 0 Ma. The innermost Adriatic strip is authored to reach back to the
  native Adriatic edge, so it fills that hole as a side effect. That hole is a
  separate pre-existing finding and is logged in [§ I](#i-open-risks).

Strip bands, offsets measured **north of the European southern limit** (the
Alpine suture datum named in the tracked memo's Adria row):

| Strip | Offset from datum | Width | Plate | Retires |
|---|---|---:|---:|---:|
| `alps-adria-distal-margin-oct` | +126 … +186 km | 60 km | 307, 308 | 35 Ma |
| `alps-adria-necking-zone` | +71 … +126 km | 55 km | 307, 308 | 19 Ma |
| `alps-adria-proximal-retrowedge` | native edge … +71 km | 71 km | 307, 308 | 5 Ma |
| `alps-europe-distal-margin-oct` | −234 … −150 km | 84 km | 305 | 40 Ma |
| `alps-europe-outer-necking-zone` | −150 … −105 km | 45 km | 305 | 32 Ma |
| `alps-europe-inner-necking-zone` | −105 … −60 km | 45 km | 305 | 25 Ma |
| `alps-europe-proximal-subducted-margin` | −60 … 0 km | 60 km | 305 | 10 Ma |

Births are bounded to Le Breton's rift stages: proximal strips are born 200–180 Ma
("rifting of the proximal continental margin"), necking strips 180–165 Ma, distal
and OCT strips 165–154 Ma. The chart's `oldest` is the older end of that interval
and `birth: { status: "bounded", intervalMa }` carries the uncertainty.

### C.3 The consumption schedule and its arithmetic

**Measured**, the model's own seam on the 10 E transect — the great-circle
closure of a Po-plain pin on 307 against a Molasse-basin pin on 305, minus their
present-day 366.9 km separation:

| Age (Ma) | 84 | 70 | 65 | 60 | 55 | 50 | 45 | 40 | 35 | 32 | 30 | 25 | 20 | 19 | 15 | 10 | 5 | 0 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Seam (km) | 738 | 583 | 537 | 518 | 501 | 473 | 429 | 372 | 302 | 264 | 245 | 196 | 147 | 140 | 113 | 78 | 39 | 0 |

**Rule (Inference):** a strip retires at the youngest published stage boundary at
which the *surviving* strips still fit inside the seam. Applied:

| Age (Ma) | Surviving Adriatic | Surviving European | Total | Seam | Residual = oceanic domain |
|---:|---:|---:|---:|---:|---:|
| 45 | 186 | 234 | **420** | 429 | 9 |
| 40 | 186 | 150 | **336** | 372 | 36 |
| 35 | 126 | 150 | **276** | 302 | 26 |
| 32 | 126 | 105 | **231** | 264 | 33 |
| 25 | 126 | 60 | **186** | 196 | 10 |
| 19 | 71 | 60 | **131** | 140 | 9 |
| 10 | 71 | 0 | **71** | 78 | 7 |
| 5 | 0 | 0 | **0** | 39 | 39 |

**The arithmetic that proves nothing is double-counted.** The strips occupy
disjoint offset bands from one datum line, so no square kilometre is authored
twice. Against the model's own 738 km of closure at 10 E since 84 Ma:

* 420 km is authored continental crust (Adria 186 + Europe 234);
* 318 km is the residual, which is the Piemont–Liguria and Valais **oceanic**
  domain — against Le Breton's "maximum 250 km" for Piemont–Liguria plus the
  Valais, and inflated by the 58 km by which the model's 738 km exceeds their
  published 680 km;
* first crust-on-crust contact falls at ≈ **44 Ma**, where the seam crosses 420 km.

Against the two published sub-windows:

* **84 → 35 Ma.** Strips retired: 84 (European distal) + 60 (Adriatic distal) =
  **144 km**, out of Le Breton's 420 km of convergence. The other 276 km is the
  ocean closing, exactly as the ≤ 250 km Piemont–Liguria plus Valais requires.
* **35 → 0 Ma.** Strips retired: **276 km**, against Le Breton's published
  **260 km**. Within 6 %. This is the load-bearing check: the crust the design
  consumes in the collision window is the crust the literature says was consumed.

The 39 km residual at 5 Ma is model closure with no authored crust behind it. It
is the same order as Schmid's 61 km for the whole 19–0 Ma stage and is logged as
a risk rather than papered over.

---

## D. The Caledonides: Baltica–Laurentia

### D.1 Width, from the literature

| Source | Constrains | Number | Tag |
|---|---|---|---|
| Gayer et al. 1987 ([10.1017/S026359330001110X](https://doi.org/10.1017/S026359330001110X)) | **the pre-collision margin** | "the Caledonian Baltoscandian margin prior to Iapetus suturing extended **at least 400 km W of the Norwegian coast**. On a Bullard reconstruction this **overlaps with Laurentian rocks in Greenland**. The excess continental crust is accounted for by shortening of the Baltoscandian margin during collision" | Verbatim abstract |
| Gayer et al. 1987 | margin width; total shortening | "the passive Iapetus continental margin which was **at least 423 km wide**"; "**Total shortening is 78·7 %** with a translation of the most internal thrust sheet of **626 km**"; "obducted continental crust **at least 600 km** across the Baltic margin" | Verbatim abstract |
| Gee 1978 ([10.1016/0040-1951(78)90040-9](https://doi.org/10.1016/0040-1951(78)90040-9)), quoted verbatim by Lorenz et al. 2015 and Gee et al. 2013 | Middle Allochthon transport | "derived from **west of the Norwegian coast** and the upper units transported **at least 400 km eastwards**" | Verbatim of the citing papers |
| Lorenz et al. 2011 ([10.2204/iodp.sd.11.09.2011](https://doi.org/10.2204/iodp.sd.11.09.2011)) | the Greenland side; what the allochthons are | Greenland thrust sheets "all derived from the Laurentian continental margin and transported **at least two hundred kilometers westwards** onto the platform"; Scandinavian allochthons "derived from **Baltica's outer shelf, dyke-intruded continent–ocean transition zone (COT)**, Iapetus oceanic domains and (uppermost) from the Laurentian margin" | Verbatim |
| Fossen 2010 ([10.1144/SP335.31](https://doi.org/10.1144/SP335.31)) | Greenland displacement; orogen size; collapse | "displacements of **200–400 km** … for the highest allochthonous units (Higgins & Leslie 2000)"; "more than **1800 km long and 500 km wide**"; extension is "**Devonian (403–380 Ma)**" | Verbatim |
| Gee et al. 2013 ([10.1130/L220.1](https://doi.org/10.1130/L220.1)) | when the margin formed | "this **Neoproterozoic to Cambrian** rifted, extended, dike-intruded outer-margin assemblage"; the "far-transported (greater than 400 km) Seve Nappe Complex" | Verbatim abstract |
| Gee et al. 2008 ([10.18814/epiiugs/2008/v31i1/007](https://doi.org/10.18814/epiiugs/2008/v31i1/007)) | the present shelf | the wide shelves west of Norway "are **inferred to be underlain by the Caledonide hinterland**" | Verbatim; carries no km figure |
| Lorenz et al. 2015 ([10.5194/sd-19-1-2015](https://doi.org/10.5194/sd-19-1-2015)) | orogen class | "a collisional orogen of **Alpine–Himalayan dimensions**"; Baltica "played a **similar role to that of India**" | Verbatim |
| Fossen et al. 2014 ([10.1130/G35842.1](https://doi.org/10.1130/G35842.1)); Hacker 2007 ([10.1130/2006.2419(09)](https://doi.org/10.1130/2006.2419\(09\))) | how deep the margin went | "the leading edge of Baltica locally reached depths on the order of **125 km**"; coesite/diamond eclogite exhumed "from **130 km** depth" | Verbatim |
| Slagstad & Kirkland 2018 ([10.1111/ter.12324](https://doi.org/10.1111/ter.12324)); Corfu et al. 2014 ([10.1144/SP390.25](https://doi.org/10.1144/SP390.25)) | which allochthons are Laurentian | "orogen-wide emplacement … at 438–434 Ma, in what immediately thereafter became the **upper plate (Laurentia)**"; "some derived from Baltica, but others of probably exotic origin, in part from the Laurentian margin" | Verbatim abstracts; no km figure |
| Roberts 2003 ([10.1016/S0040-1951(03)00026-X](https://doi.org/10.1016/S0040-1951(03)00026-X)); Torsvik & Cocks 2017 ([10.1017/9781316225523](https://doi.org/10.1017/9781316225523)); Hacker et al. 2010 ([10.1016/j.tecto.2009.08.012](https://doi.org/10.1016/j.tecto.2009.08.012)); Andersen 1998 ([10.1016/S0040-1951(97)00277-1](https://doi.org/10.1016/S0040-1951(97)00277-1)) | — | **no number was obtained.** Bibliographic records confirmed through Crossref; no abstract registered or no full text retrieved. They are cited for framework only and nothing is inferred from them. | Bibliographic only |

**Derived widths, Inference.**

* **Baltoscandian, 401 km.** Gayer et al. 1987's "at least 400 km W of the
  Norwegian coast" is the only directly published margin-extent figure and is
  stated for the margin, not for a single transect; their independent "at least
  423 km wide" passive margin corroborates it. The 1 km above 400 is **not** a
  scientific claim: it exists only so the 0.02° transect sampling cannot read
  below the published floor. Sub-division uses the restored Middle Allochthon
  root, which restoring Gee 1978's ≥ 400 km of ESE transport puts ≈ **141 km**
  west of the coast at 63.4 N and ≈ **287 km** at 66 N (Inference, approximate
  outcrop longitudes; the full chain is in the tracked shortening memo).
* **Laurentian, 202 km.** Lorenz et al. 2011's "at least two hundred kilometers
  westwards", corroborated by Fossen 2010's 200–400 km for the highest Greenland
  allochthons. The 2 km above 200 is the same sampling allowance.
* **Sum 603 km** across the bivergent orogen, against the tracked memo's derived
  **≥ 600 km** of continental shortening. That equality is deliberate: the design
  authors the derived minimum and no more.

### D.2 Geometry and carrying plates

Datum for Baltica is the model's **own plate-302 coastline polygons** — the same
datum the tracked shortening memo measures against, so the published "west of the
Norwegian coast" is compared like with like. Datum for Laurentia is the plate-102
continental outline.

| Parallel | Coast west limit | Greenland crust east limit |
|---|---:|---:|
| 62 N | 5.38 E | — |
| 64 N | 9.98 E | — |
| 66 N | 12.56 E | — |
| 68 N | 15.40 E | — |
| 70 N | 18.94 E | −22.20 E |
| 72 N | — | −20.50 E |
| 74 N | — | −18.46 E |
| 76 N | — | −5.84 E |

| Strip | Offset from datum | Width | Plate | Latitudes | Retires |
|---|---|---:|---:|---|---:|
| `caledonides-baltica-distal-margin-cot` | 250 … 401 km W | 151 km | 302 | 62–71 N full, tapered 60.5–62 and 71–71.5 | 430 Ma |
| `caledonides-baltica-outer-shelf` | 130 … 250 km W | 120 km | 302 | same | 420 Ma |
| `caledonides-baltica-middle-allochthon-root` | 0 … 130 km W | 130 km | 302 | same | 405 Ma |
| `caledonides-laurentia-distal-margin-cot` | 100 … 202 km E | 102 km | 102 | 70–76 N full, tapered 69.5–70 and 76–76.5 | 425 Ma |
| `caledonides-laurentia-proximal-margin` | 0 … 100 km E | 100 km | 102 | same | 410 Ma |

Births are bounded to 600–540 Ma, from Gee et al. 2013's "Neoproterozoic to
Cambrian rifted, extended, dike-intruded outer-margin assemblage". The chart
`oldest` is 600 Ma — the same oldest the Cao `Northern Highlands` and Greater
India features carry.

**Why the latitude limits.** North of 71 N the plate-302 coast polygon no longer
crosses the parallel, so the datum is undefined and the band is closed out. South
of 62 N the belt runs into the North Sea and the Scottish block, treated next.
Greenland is limited to 70–76 N because at 76–80 N the plate-102 outline already
reaches −6 to −4 E (a broad eastern shelf toward Svalbard), and offsetting a
further 200 km east of that would place restored Laurentian crust inside the
Svalbard domain. The East Greenland Caledonides continue to ~81 N; the design
truncates them and says so.

### D.3 Interaction with the 410 Ma junction and the North Sea restoration

**The 410 Ma authoring junction** ([regional-material-model-lineage.md](regional-material-model-lineage.md))
is inside the Scandian window: `Eurasia` (302, 410 → 0 Ma) and `Timan Region`
(302, 410 → 0 Ma) begin at 410 Ma, so the model's Baltica crust set jumps from
7.08 to 8.42 Mkm² there. Three consequences, all handled:

1. The strips ride plate 302's rotation, which is continuous across 410 Ma, so
   nothing in their pose crosses the junction.
2. Their own areas are constant, so the **extent** measure — taken in the 0 Ma
   frame on rigid blocks — is unaffected. Any *area-through-time* series over
   Baltica still crosses a coverage step at 410 Ma, and that step is a coverage
   artefact, not tectonics.
3. `caledonides-baltica-middle-allochthon-root` retires at 405 Ma, i.e. on the
   young side of the junction, and `caledonides-laurentia-proximal-margin` at
   410 Ma, exactly on it. Both are declared with `youngestExclusive: true` so the
   correction phase meets the native endpoint without double drawing.

**The North Sea rigid restoration** moves plates 315 and 303 toward Baltica about
a pole at 3.9 W, 44.95 N, reaching its maximum −2.477° (72 km of Shetland–Bergen
closure) by 270 Ma and holding it constant to 430 Ma. Its chart-selection box is
lon [−15, 3], lat [49, 63], west of a 2 E cut — the restored Baltoscandian margin
crosses that box at 61.5–62 N, so the clash had to be measured, not assumed.

**Measured**, minimum great-circle gap between the drafted Baltoscandian margin
(riding 302) and the UK block, at every Scandian age 430–405 Ma:

| Against | Native Cao pose | **North-Sea-restored pose** |
|---|---:|---:|
| Plate 303 (`Northern Highlands`, Scotland) | 71.5 km | **56.4 km** |
| Plate 315 | 418.7 km | 419.1 km |

**No overlap at any age.** For context on the same measurement: native Baltica
crust sits 41.6 km from native 303 (the tracked "docks at 430 Ma with a fixed
41.4 km gap"), and **0.0 km** from the *restored* 303 — the North Sea restoration
closes that docking gap entirely at Caledonian ages. That is a property of the
tracked restoration, not of this design, but it is the reason the southern taper
starts at 60.5 N and reaches full width only at 62 N.

### D.4 The palaeo-coastline layer cannot lend these strips a class

**Measured**, by decoding every shipped `lm` and `sm` payload (all 28 match their
pinned digests) and testing containment of witness points inside the drafted
Alpine strips:

| Strip footprint (present-day) | Cao 2017 class found | **Bound to plate** |
|---|---|---:|
| Adriatic strips, 47.6–48.8 N at 10 E | `sm` at 203–81 Ma, `lm` at 58–2 Ma | **305** (Europe) |
| Adriatic strips at 13 E | `lm`/`sm` | **374** |
| European strips, 45.5–47.0 N at 10 E | `sm`, later `lm` | **307 / 308 / 3307 / 306** (Adria) |

The classes over the Adriatic strips ride the *European* plate and the classes
over the European strips ride the *Adriatic* plate. Inheriting a class by
present-day containment would therefore attach it to the conjugate plate, and it
would slide off the restored crust at every older age. The Greater India feature
avoids this only because Cao 2017 gives it an explicit `PLATEID1 = 501` override;
**no equivalent Cao 2017 override exists for the Alpine or Caledonide margins**,
and inventing one would be artistic gap-fill, not inference from a source.

The Caledonide strips do not raise the question at all: they live 600 → 405 Ma,
entirely older than the palaeo-coastline layer's oldest interval, `402–380`.

**Decision.** Every restored-margin strip carries
`surfaceEvidence: { kind: "unknown", reason: … }` and no palaeo class. It renders
as material-correction crust with `displayHeightMetres: 0`, under
`native-visual-and-picking-precedence` so native charts always draw over it.

---

## E. The contract

### E.1 `data/corrections/restored-margins/`

```
data/corrections/restored-margins/
  restored-margins-manifest.json        contract, sources, lifecycles, uncertainty
  restored-margins-alps-v1.geojson      10 features, 25.7 KB
  restored-margins-caledonides-v1.geojson  5 features, 12.1 KB
```

The **lake-void correction** is the contract template, not the
`cao_material_corrections` target contract: the material-correction contract
requires every feature to *continue an existing native Cao polygon* whose oldest
endpoint it meets, and restored-margin crust continues nothing — it is new crust
the model never had. Like the lake voids, the restored margins therefore validate
through their own module and are handed to `emit_cao_material_corrections.py` as
extra rows.

Per-feature manifest fields, following the shape the lake-void and
western-Laurentia manifests already use:

| Field | Content |
|---|---|
| `correctionFeatureId`, `collision`, `margin` | identity |
| `materialRole` | `restored-collision-margin` |
| `epistemicStatus` | `model-inference` |
| `coordinateFrame` / `geometryReferenceAgeMa` | `WGS84-reference-coordinates` / `0` |
| `geometryAsset` | path, featureId, `sha256`, `bytes` |
| `pose` | `plateId`, `method: cao-rigid-plate-motion`, `status: model-inference`, the binding rule, and the warning that the strip is rigid while real margin crust thinned and rotated |
| `phaseLifecycles["restored-collision-margin"]` | `validTimeMa`, `youngestExclusive: true`, `birth: { status: "bounded", intervalMa }`, `loss: { status: "bounded", intervalMa }` — the `MaterialLifecycle` shape in `src/reconstruction/types.ts` |
| `restoredExtent` | `widthKm`, `datumOffsetKm`, the datum in words, the domain the strip represents, and the **width derivation** naming its published components |
| `consumption` | `consumedByMa`, the schedule rule, the stage-boundary source |
| `surfaceEvidence` | `{ kind: "unknown", reason }` — the `SurfaceEvidenceState` shape |
| `uncertainty` | `spatial`, `temporal`, `exposure` |
| `sourceIds`, `editorial`, `rejectionConditions` | provenance, the map-key line, and the conditions that invalidate the feature |

`sourceAssets` carries 22 records — every source in [§ C.1](#c1-width-from-the-literature)
and [§ D.1](#d1-width-from-the-literature) with `sourceId`, `title`, `citation`,
DOI URL, `publicationOrVersionDate`, `license`, `attribution`, `retrievedAt`,
`evidenceRole`, the `constrains` sentence and a Verbatim/Snippet/Bibliographic-only
tag. Four are tagged **Bibliographic only — no number extracted** (Roberts 2003,
Torsvik & Cocks 2017, Hacker et al. 2010, Andersen 1998) and nothing is inferred
from them. Every source is cited, never redistributed; only the two Copernicus
papers (Le Breton 2021, Lorenz 2015) are CC BY.

### E.2 The compile step

`scripts/research/restored_margins_compile.py`, run under the pinned pyGPlates
environment:

1. Verify the five pinned model files by `sha256`, refuse to run otherwise.
2. Derive the datum profiles (Adria/Europe limits per meridian; plate-302 coast
   and plate-102 crust limits per parallel) by point-in-polygon sampling.
3. Emit each strip as an offset band with its declared inner and outer distances
   and its latitude/longitude taper.
4. **Cookie-cut by the Cao 2024 partitions of the datum line, not of the restored
   ground.** This is a deliberate departure: the static partition *beneath* a
   restored margin is oceanic, and binding to it would detach the margin from the
   continent it restores. Each strip sample is attributed to the partition of the
   datum point it is offset from, and strips are split where that partition's
   plate changes — which is what produces the 307/308 split at 8.875 E.
5. Write the two GeoJSON collections, then the manifest with fresh digests.

### E.3 The emit step

`emit_cao_material_corrections.py` gains the restored-margin manifest as a row
source next to the lake-void manifest, and three small edits:

* `feature_phase_intervals` accepts the new phase name `restored-collision-margin`
  in the `phaseLifecycles` ordering;
* `chart()` maps that phase to the label `restored-collision-margin`, the
  `sourceFeatureType` `EarthHistoryRestoredCollisionMargin`, and a `correction`
  block carrying `materialStatus: "restored-consumed-margin"`,
  `poseStatus: "model-inference"`, `consumedByMa` and `restoredWidthKm`;
* the phase joins the existing **`material-correction-uncertain`** batch, so no
  new spatial batch, palette or display control is introduced.

Chart id: `correction:earthhistory-restored-collision-margin-v1:<featureId>:restored-collision-margin`.

### E.4 The validator

`scripts/research/restored_margins_correction.py` — the contract gate, modelled
on `regional_lake_void_correction.py`: pinned digests, pinned feature-id set,
pinned widths and lifecycles, every `sourceId` resolvable, every feature
`model-inference` with `unknown` surface evidence, and the two structural
invariants this design turns on —

* **no strip may outlive the room the model leaves it**: surviving width ≤ the
  pinned seam at every schedule age;
* **no restored Baltoscandian strip may overlap the North-Sea-restored 303 block**
  at any Scandian age.

`--self-test` proves each check red by mutation and restores it (R1). The
mutations the shortening validator itself needs are listed in [§ F](#f-projected-acceptance).

### E.5 The runtime probe

`src/reconstruction/restoredMargins.test.ts` reads the bytes a browser downloads:
the 15 charts exist in the correction catalog with the pinned lifecycles, each is
in the `material-correction-uncertain` batch, each carries
`poseStatus: "model-inference"` and `surfaceEvidence.kind === "unknown"`, each
motion binding names the declared plate, and **no restored-margin chart is active
at 0 Ma**. A package refresh that drops a strip, re-dates one, lets one survive to
the present or gives one a surface class turns it red.

---

## F. Projected acceptance

**Executed**, 2026-09-15, against the pinned model with the drafted GeoJSON
joined to the lower-plate crust groups, using the shortening validator's own
transect method. Datum groups stay native-only, exactly as `india_present_crust`
excludes the Greater India features.

| Transect | Quantity | Before | **With restored margins** | Minimum | Verdict |
|---|---|---:|---:|---:|---|
| **Alps 10 E** | Adriatic crust north of the native European margin | 0 km | **184.6 km** | 140 km | **PASS** |
| Alps 8 E | same | 0 km | 184.6 km | — | — |
| Alps 12 E | same | 0 km | 184.6 km | — | — |
| Alps 14 E | same | 0 km | 184.6 km | — | — |
| Alps 10 E | Adriatic crust beyond its **own** present outline | 0 km | 186.8 km | — | — |
| Alps 8 E / 14 E | same | 0 km | 266.9 / 280.2 km | — | — |
| Alps, all four | European crust beyond its own present outline | 0 km | **233.5 km** | 230 km | clears |
| **Caledonides 62 N** | Baltican crust west of the plate-302 coastline | 122.2 km | **400.9 km** | 140 km | **PASS** |
| Caledonides 64 N | same | 188.2 km | 400.7 km | — | — |
| Caledonides 66 N | same | 142.0 km | 400.7 km | 250 km | clears |
| Caledonides 68 N | same | 135.8 km | 400.7 km | — | — |
| Caledonides 70 N | same | 28.9 km | 400.8 km | 400 km | clears |
| Caledonides 58 N / 60 N | same (outside the authored belt) | 287.6 / 190.1 km | unchanged | — | — |
| Greenland 70–76 N | Laurentian crust east of its own outline | 0 km | 201.4–201.8 km | 200 km | clears |
| India 85 E | unchanged control | 1341.0 km | 1341.0 km | 1000 km | PASS |

The run also re-derived, unchanged, the seven pinned feature identities and areas,
the nineteen reconstructed overlaps, the eleven minimum gaps and the twenty
pin-pair convergences — the restored margins are added to the transect groups
only, never to the reconstructed-overlap groups, so the model's own statements
about consumed crust are not inflated by our charts.

**The shortening validator's own edits.** `ADRIA_EXTENT_KM`,
`ADRIA_LIMITS_DEGREES`, `CALEDONIDE_EXTENT_KM`, `CALEDONIDE_LIMITS_DEGREES` and
`PINNED_VERDICTS` all move, and two group definitions split into native and
restored halves. Because the pinned verdicts change, the self-test must change
with them, and **this is the part that must not be skipped**: the existing
mutation "an Alpine verdict flipped to pass" is no longer a mutation, it is the
truth. The projected run replaces it and adds four, for **14 mutations proven red
with the clean run still green**:

* an Alpine verdict left at `fail` after the restored Adriatic margin is included;
* a Caledonide verdict left at `fail` after the restored Baltoscandian margin is
  included;
* a pinned Alpine extent that forgets the restored margin (0 km);
* the restored **Adriatic** margin removed from the correction set — the 8 E
  transect falls back to 0 km and the pin no longer matches;
* the restored **Baltoscandian** margin removed — 62 N falls back to 122.2 km.

The last two are the ones that matter: they prove the gate is measuring our
charts and not just re-reading our constants.

---

## G. Map key text

For the restored margins, in the same register as the Greater India line the
tracked memo settled on — name the model, say *crust* not *land*, carry the
spread, and name the age the model consumes it:

> **Restored Adriatic margin — model inference after Le Breton et al. (2021) and
> Schmid et al. (1996).** About 186 km of Adriatic continental crust north of
> Adria's present edge, thinned in Jurassic rifting and consumed in the Alpine
> collision. Published spread 140–300 km; removed from the model between 35 and
> 5 Ma. Its extent is model output, not observed geography, and it is crust, not
> land: no shoreline or water depth is claimed.

> **Restored European margin — model inference after Le Breton et al. (2021) and
> Handy et al. (2010).** About 234 km of European and Briançonnais crust south of
> Europe's present edge. Published spread 150–290 km; removed from the model
> between 40 and 10 Ma.

> **Restored Baltoscandian margin — model inference after Gayer et al. (1987) and
> Gee (1978).** About 401 km of Baltican continental crust west of the present
> Norwegian coast, the passive Iapetus margin that the Scandian collision shortened
> and partly subducted. Published spread 140–423 km; removed from the model
> between 430 and 405 Ma. Where it overlaps Greenland it is showing consumed
> crust, which is what Gayer et al. (1987) predicted when they restored it.

> **Restored Laurentian margin — model inference after Lorenz et al. (2011) and
> Fossen (2010).** About 202 km of East Greenland continental crust east of
> Greenland's present edge. Published spread 200–400 km; removed from the model
> between 425 and 410 Ma.

The tracked memo's § E paragraph — "The Alps and the Caledonides are drawn from
present-day crust outlines … the plate model carries no restored pre-collision
Adriatic or Baltican margin" — becomes false the day these charts ship and must
be replaced in the same change, not left to drift (R17).

A general line for the class, to sit beside the Greater India line:

> Restored pre-collision margins are crust that the reconstruction consumed.
> They are model inference from published shortening budgets, not mapped
> geography; each carries its sources, its published spread and the age the model
> removes it. Where one overlaps another plate, that overlap is the model saying
> this crust had to be thickened or subducted.

---

## H. The CLAUDE.md pre-collision sentence check

`CLAUDE.md` has no sentence about pre-collision crust, and this design needs none
added. Checked clause by clause, it already governs the work:

* *"Every rendered state carries epistemic status: observed/proxy constrained,
  model output, interpolation, synthesis, or artistic gap-fill."* — every strip is
  `model-inference` with `poseStatus: model-inference`. Satisfied by construction.
* *"Palaeogeographic geometry names its plate model/version, reference frame,
  plate IDs, valid age range, reconstruction method, and transforms."* — the
  manifest baseline names Cao 2024 v2.4, the palaeomagnetic frame, anchor plate 0,
  the five source digests; each feature names its plate id, valid range and
  `cao-rigid-plate-motion`. Satisfied.
* *"Every scientific claim … records a stable source identifier or URL, citation,
  publication/version date, temporal range, geographic basis, license, and
  retrieval date. Prefer primary papers … distinguish a source's claim from our
  inference."* — 22 `sourceAssets` with DOIs and a Verbatim/Snippet/Bibliographic
  tag; widths are the source's claim, retirement ages are our inference and are
  labelled as such. Satisfied, with the standing caveat that Gee 1978, Schmid 1996
  and Gayer 1987 are read through citing papers, which the tracked memo already
  records as a limitation.
* *"Data licenses and attribution are acceptance criteria."* — every source
  records its license and attribution; nothing is redistributed. Satisfied.
* *"Biomes, ice, deserts, forests, rivers and basins must expose the evidence and
  method behind them."* — the strips are none of those and assert none of them.
* *"A smooth animation must not imply continuous evidence between sparse
  reconstruction slices."* — the retirement schedule is the one place this design
  could over-claim. It is mitigated by `birth`/`loss` bounded intervals and by the
  map-key wording "removed from the model between X and Y Ma", which says the
  model removes it rather than that the crust was observed to vanish then.

The one clause worth a **deliberate reading** is *"Unsupported fragments fade or
disappear instead of being placed with false precision"*, written for the
modern-country overlay. Applied here it argues for the same thing the lifecycles
already do: a strip disappears rather than being drawn stacked on the plate that
consumed it. The design follows it.

---

## I. Open risks

1. **The model's Mesozoic Alpine Tethys is about twice as wide as the
   literature's.** Measured seam on 10 E: 893 km at 100 Ma, 1,052 km at 130 Ma,
   1,020 km at 165 Ma, against Le Breton's 480 km total Piemont–Liguria Basin.
   The restored margins fix the *crust budget*; they do not fix this. Between
   165 and 84 Ma the strips sit with 500–600 km of open water beyond them.
2. **First crust contact at 10 E lands at ≈ 44 Ma**, against Handy et al. 2010's
   ~35 Ma onset of continental collision. The design accepts the model's date
   rather than authoring wider strips to force a later contact.
3. **39 km of model closure after 5 Ma has no authored crust behind it.** Same
   order as Schmid's 61 km for the whole 19–0 Ma stage, but unbacked.
4. **The model's Baltica–Greenland closure completes at 432 Ma and then
   re-opens** (gap 1,156 km at 440, 538 at 436, 206 at 434, 0 from 432; then the
   two drift apart again). The literature's Scandian window is 430–400 Ma. The
   schedule follows the literature, so between 432 and 405 Ma the surviving
   Baltican strips **overlap Greenland**. That is Gayer et al. 1987's explicit
   prediction and is resolved visually by native precedence — but it is a
   deliberate choice and a reviewer may prefer the model's own 437–432 Ma window
   instead, which would make the restored margin nearly invisible during the
   collision it explains.
5. **Kissling & Schlunegger 2018 argue the Alps need no hard continental
   collision at all.** Under their rollback model the restored Adriatic margin is
   not required. It is recorded in the sources because it lowers, not raises, the
   crust a model must consume, and a design that only cited papers agreeing with
   it would be selecting evidence.
6. **The Cao 307/308 split is inherited.** `Adria` and `Eastern Dinaride
   Platform` separate by up to **51.6 km** at 130–180 Ma in the native model, so
   the two Adriatic strip families open the same seam at their 8.875 E junction
   at their birth ages. This is a pre-existing property of Cao's own tiling, not
   a new defect, but it will be visible.
7. **Cao leaves a present-day hole in the Alps** — 82 km at 8 E and 95 km at
   14 E with no continental polygon of either plate. The innermost Adriatic strip
   fills it as a side effect of its datum. That hole deserves its own finding and
   its own decision rather than being closed silently by this correction.
8. **Area coverage is partial.** 448,051 km² of Baltoscandian plus 145,557 km²
   of Laurentian margin is 593,608 km² over a ~1,020 km authored belt (62–71 N).
   The tracked memo's ≥ 1.08 Mkm² figure assumes ≥ 600 km over Fossen's full
   1,800 km belt; extending south of 62 N and north of 76 N in Greenland is left
   out because the datums there are contaminated by the North Sea block and the
   Svalbard shelf.
9. **Retirement ages are a fitted schedule, not observations.** Every one of them
   is Inference. A reviewer who prefers different stage boundaries would get
   different ages without changing a single published width.
10. **Three load-bearing papers were read through citing papers** (Gee 1978,
    Schmid et al. 1996, Gayer et al. 1987 — the last through its Cambridge Core
    abstract). Four more yield no number at all (Roberts 2003, Torsvik & Cocks
    2017, Hacker et al. 2010, Andersen 1998). Checking the primaries before these
    widths become a shipped project datum remains open, exactly as the tracked
    shortening memo records.
11. **Whether to ship the Alps and the Caledonides together.** They are
    independent; the Caledonide half is the better-evidenced of the two (one
    directly published margin-extent figure) and the Alpine half is the one with a
    published counter-model. Splitting the change would let the weaker half be
    reviewed on its own.
