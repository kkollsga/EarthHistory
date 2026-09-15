# The light-teal band across India at 90 Ma

Probe date: 2026-09-15. Read-only diagnosis of one thing a reviewer saw on
screen: at 90 Ma, with the palaeo-coastline layer on and the camera centred on
India, a light-teal shallow-sea band runs diagonally across the pale landmass —
"water over land". Companion to
[palaeo-coastlines-north-sea-formation-checks.md](palaeo-coastlines-north-sea-formation-checks.md)
(whose probe method this reuses),
[palaeo-coastlines-collision-shortening.md](palaeo-coastlines-collision-shortening.md)
(India's plate bindings) and
[palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md).

**Answer in one line.** The band is the `sm` (palaeo shallow-marine) class and
the stacking is correct — 99.3 % of the band's source ground carries no `lm` and
no `m` polygon at all, so nothing is being drawn over land. It *reads* as an
interior strait because the ground drawn immediately north-east of it is Cao
2017 mountain and landmass polygons whose own `PLATEID1` is an **Asian** terrane
(616 Qiangtang, 601 Tarim) which the compiler bound to **plate 501 (Greater
India)** by the partition rule, drawing them 5 407–6 908 km from where their own
`PLATEID1` would place them at 90 Ma. Remove those six pieces and the band
disappears: India becomes one landmass with an open shelf to the Neotethys.

---

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Git HEAD | `82ea71eaaaa1f339c732344057368d92a3b475ee` |
| Payloads read | the HEAD blobs, extracted with `git show 82ea71e:public/data/reconstruction/cao-v2.4/palaeo-coastlines/...` (the working-tree copies were identical at probe time) |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` (pyGPlates, shapely 2.0.7) |
| Rotations | **both** files: `1000_0_rotfile.rot` + `1800_1000_rotfile.rot`, anchor 0. `audit.check_rotation_model` worst sub-block separation **0.0 km** |
| Capture diagnosed | `visual-r3/tuned/t01-90ma-tethyan-himalaya-on.png`, `#age=90&layers=borders,guides,palaeoCoastlines&at=68.61,-32.34`, viewport 1440×900, canvas 1066×652 at page offset (374, 75) |
| Capture diagnostics | `caoPalaeoCoastlineMode=on`, `caoPalaeoFallbackReason=""`, `caoPalaeoIntervalId=94-81`, `caoPalaeoTriangles=425294`, `caoPalaeoCharts=3265`, `caoFoundationStatus=ready`, `caoFoundationRequestedAgeMa=90`, `cameraDistance=1.8200`, `consoleErrors=[]` |

**Integrity, Measured.** Every payload digest re-computed here equals the digest
its own class catalog pins:

| File | Bytes | sha256 | Catalog pin |
|---|---:|---|---|
| `lm/palaeo-lm-94-81.ehpr` | 137 308 | `b4522a13814ee21747c25da38bb1d5eb630730d71987f524648c3c58787aa1b9` | match |
| `sm/palaeo-sm-94-81.ehpr` | 166 652 | `e391089b966fb6ca15116da23f4aa0dde13c059c1c5721db23facd70a6cc52d4` | match |
| `m/palaeo-m-94-81.ehpr` | 60 508 | `ff7d147f18e3d5c3267264a240f07754ef7613dd15f8c71ea6604ef0fef4c3a7` | match |
| `lm/palaeo-lm-catalog.json` | — | `e48b6fc39ae392083c67865d5f4037b221acbeec17a994e8e692c50df8f6215e` | — |
| `sm/palaeo-sm-catalog.json` | — | `dd2dd72562033ac7827d7e6cff4d975d54057f02dd7c6c63502128e8b7f438e7` | — |
| `m/palaeo-m-catalog.json` | — | `e17fda18306ff48e1b0a2c565276134491a466c6a71eaab1cf9779e27f68dd11` | — |

The offline provenance sidecars in the owned store also match the digests the
HEAD catalogs pin (`palaeo-lm-provenance.json`
`7973b0a6…`, `palaeo-sm-provenance.json` `cc6e8670…`,
`palaeo-m-provenance.json` `571be08d…`), so the source-record table read below
is the exact one these payloads were compiled from.

**Method, Measured.** As in the formation checks, the classification is the
validator's own: `palaeo_coastlines_compile.decode_ehpr` decodes each payload,
`piece_geometry` rebuilds each piece's rings, `catalog_bindings` resolves the
binding row and `expand_chart_provenance` resolves the chart index into the
source record. Two things were added for this memo:

1. **Reconstruction.** Every piece of the 94–81 interval (1 141 `lm`, 1 486
   `sm`, 639 `m`) was rotated to 90 Ma by its own binding plate. No piece in
   this interval is unposable.
2. **Re-projection of the capture.** The capture camera was reproduced exactly —
   `lonLatToVector3` (x = cos φ cos λ, y = sin φ, z = −cos φ sin λ),
   `globeGroup.rotation.z = −13.5°`, `PerspectiveCamera(36, …)`, distance
   1.8200, `lookAt(0,0,0)`, up (0,1,0) — so that every capture pixel maps to a
   90 Ma longitude/latitude. The synthetic classification rendered through that
   camera reproduces the capture's coastlines pixel for pixel
   (`scratchpad/india-band/compare.png`), which is what licenses reading piece
   identities off the screenshot.

---

## 1. Pixel evidence: the band is the `sm` class

**Measured.** Samples down the centreline of the band in
`t01-90ma-tethyan-himalaya-on.png` (page coordinates; the class column is the
synthetic re-projection at the same pixel):

| page x | page y | RGB | hex | class |
|---:|---:|---|---|---|
| 692 | 268 | (108, 179, 173) | `#6cb3ad` | palaeo-shallow-marine |
| 740 | 312 | (109, 181, 175) | `#6db5af` | palaeo-shallow-marine |
| 798 | 356 | (110, 182, 176) | `#6eb6b0` | palaeo-shallow-marine |
| 874 | 400 | (110, 182, 176) | `#6eb6b0` | palaeo-shallow-marine |
| 997 | 444 | (109, 182, 176) | `#6db6b0` | palaeo-shallow-marine |
| 1 027 | 466 | (109, 182, 175) | `#6db6af` | palaeo-shallow-marine |

Means over the whole feature and its neighbours, same capture:

| Feature | Pixels | Mean RGB | Mean hex |
|---|---:|---|---|
| The band | 8 449 | (109.4, 181.2, 175.2) | `#6db5af` |
| `palaeo-land` beside it | 8 057 | (162.8, 190.5, 174.2) | — |
| `palaeo-mountain` beside it | 6 543 | (202.4, 203.0, 184.9) | — |
| open Tethys (deep/unmapped) | 33 000 | (3.4, 47.6, 64.1) | — |

The capture's own tone census predicts `palaeo-shallow-marine` at full light as
`#65b5ba`. The band is that class; there is no ambiguity about what is painted.

---

## 2. Which pieces the band is, and what they are in Cao 2017

**Measured.** Three connected components of exposed `sm` fall inside the
landmass on screen. Their present-day footprints were obtained by inverse-
rotating each band pixel by the binding plate of the `sm` piece under it.

| Component | Screen | Pixels | Present-day footprint | What it is |
|---|---|---:|---|---|
| **#7** | the diagonal band through the frame centre — the one the reviewer saw | 8 449 | **70.5–92.9 E, 25.9–33.6 N** | the Himalayan belt: the northern (Tethyan) margin of India |
| #46 | narrow channels in the lower left | 13 449 | 67–78 E / 17–23.9 N; 70–74 E / 10–23 N; 76–82 E / 16–22 N; 47–49 E / −21…−13 (Madagascar) | the Narmada–Tapti corridor, the western continental margin, and the India–Madagascar strait |
| #52 | small patch, lower centre-right | 1 872 | 87.1–91.5 E, 20.9–24.7 N | the Bengal embayment |

**Measured**, the `sm` pieces that make up component #7 and the flanking land:

| Class | Piece | `PLATEID1` | Binding | Partition | Kind | Flags | Source record | Present-day bbox |
|---|---:|---:|---:|---:|---|---:|---:|---|
| `sm` | 518 | 501 | 501 | 501 | override | 2 | 6483 | 70.76, 26.84 → 96.90, 35.52 |
| `sm` | 496 | 501 | 501 | 501 | override | 2 | 6483 | 71.03, 26.70 → 96.19, 34.74 |
| `sm` | 525 | 501 | 501 | 5011 | override | 2 | 6483 | 66.00, 12.96 → 78.26, 34.45 |
| `sm` | 522 | 501 | 501 | 5011 | override | 2 | 6483 | 77.91, 20.56 → 96.39, 29.91 |
| `sm` | 513 | 501 | 501 | 50101 | override | 2 | 6483 | 69.52, 23.22 → 78.18, 31.72 |
| `lm` | 277 | 501 | 501 | 501 | partition | 0 | 2790 | 78.57, 26.84 → 90.67, 29.88 |
| `lm` | 278 | 501 | 5011 | 5011 | partition | 0 | 2790 | 77.91, 22.16 → 92.35, 29.91 |
| `lm` | 280 | 501 | 5011 | 5011 | partition | 32 | 2790 | 69.18, 21.85 → 78.26, 31.68 |
| `m` | **256** | **616** | **501** | 501 | partition | **1** | 2682 | 70.76, 27.22 → 97.02, 35.43 |
| `m` | **245** | **616** | **501** | 501 | partition | **1** | 2682 | 71.03, 26.97 → 96.19, 34.74 |
| `m` | **258** | **616** | **5011** | 5011 | partition | **1** | 2682 | 70.06, 30.75 → 76.91, 34.45 |
| `m` | **431** | **601** | **501** | 501 | partition | **1** | 2716 | 73.82, 33.55 → 77.77, 35.52 |

Flag 1 is the catalog's `frame-conflict: more than 250 km from the PLATEID1
position at the interval mid-age`; flag 2 is `bound by the source PLATEID1
override rather than by the owner partition`; flag 32 is `retained
unsimplified`. Two small satellite patches of the same band (263 px and 173 px)
are carried by `sm` 498 and 522, whose partition owner is **606 (Lhasa)** and
which the `sm` override rebinds to 501 — the mechanic
[palaeo-coastlines-collision-shortening.md](palaeo-coastlines-collision-shortening.md) §D
describes; they are a rounding detail beside the main feature.

**The `sm` side is one source record.** All the band's shallow-marine pieces
come from a single Cao 2017 record, `FEATURE_ID`
`GPlates-b945b907-2baf-4ac6-94cc-defa683ebbcf`, `PLATEID1 = 501`,
`FROMAGE = 94.0`, `TOAGE = 81.01`, appearing as source-record indices 6483
(56 pieces, 6 611 329 km²), 6493 (12 pieces, 1 845 958 km²) and 6511 (8 pieces,
731 563 km²). In Cao 2017 this is **India's own shallow-marine envelope for the
94–81 slice** — the shelf of the Indian plate including the Greater India
extension. It is not a Narmada polygon, not a Cauvery polygon and not a piece
from another plate's override footprint: it is the India shelf, riding India.
(The same `FEATURE_ID` carries the `lm` record 2790, so in Cao 2017 the
identifier names the palaeogeographic unit, not one class polygon.)

**The `m` side is Qiangtang.** The mountain pieces flanking the band on its
north-east side come from `FEATURE_ID`
`GPlates-d57c79c7-4113-4d4a-b31f-97553d5dc8d4`, `PLATEID1 = 616` (Qiangtang),
source record 2682, plus `PLATEID1 = 601` (Tarim/Central Asia), record 2716.

---

## 3. The present-day check: source gap, not a stacking failure

**Method, Measured.** Every seventh band pixel was inverse-rotated to its
present-day source position and tested for `lm` and `m` containment in the same
interval payloads.

| Component | Sampled | `lm` or `m` present | **Neither** |
|---|---:|---:|---:|
| #7 | 1 207 | 9 (0.7 %) | **1 198 (99.3 %)** |
| #46 | 1 922 | 8 (0.4 %) | 1 914 (99.6 %) |
| #52 | 268 | 3 (1.1 %) | 265 (98.9 %) |

**So there is no `lm`/`sm` overlap to mis-stack.** At the band's own source
ground Cao 2017 has a shallow-marine polygon and no landmass and no mountain
polygon. The runtime stacking in `src/render/reconstruction/caoFoundation.ts`
is behaving as documented — `palaeo-shallow-marine` shell 700 m, renderOrder
1.2, `writesDepth: false`; `palaeo-land` shell 1 300 m, renderOrder 1.7,
`writesDepth: true`; `palaeo-mountain` shell 1 600 m, renderOrder 1.8,
`writesDepth: true` — so an overlap would render as land, and no overlap exists
here anyway. **This is not a rendering bug.**

**Nor is it a binding divergence inside India.** Measured at 90 Ma, the India
sub-plates the pieces are bound to co-move with 501 **exactly**: 5011, 50101,
50102 and 5014 all carry the probe point (78 E, 25 N) to (59.83, −32.64), 0.0 km
from plate 501. So `lm` riding 5011 and `sm` riding 501 land in the same place;
the gap between them is geometry, not pose.

Fine present-day map of the Himalayan strip (`M` mountain, `L` land, `#` both,
`s` shallow only, `.` neither) confirms the corridor is a real hole between the
Cao 2017 landmass outline and the Cao 2017 mountain outline:

| Box | `sm`-only area | Largest part |
|---|---:|---|
| 70–93 E, 25.5–34 N (Himalayan strip) | **327 985 km²** | 264 030 km², bbox 70.00, 25.83 → 92.93, 34.00 |
| 72–79 E, 20–23.5 N (Narmada corridor) | 97 358 km² | 97 357 km², bbox 72.00, 20.00 → 78.79, 23.27 |
| 68–75 E, 8–24 N (western margin) | 398 321 km² | 398 225 km², bbox 68.00, 8.78 → 75.00, 24.00 |

---

## 4. Why it looks like an inland strait: Asian mountains riding India

**Measured.** Of the mountain-class area bound to an India plate
(501/5011/50101/50102/5014) in the 94–81 interval, **46.3 % — 450 722 km² of
973 674 km² — is Cao 2017 mountain ground whose own `PLATEID1` is an Asian
terrane**: four pieces on 616 (Qiangtang) and one on 601 (Tarim). Every one of
them carries the frame-conflict flag. For `lm` the same figure is 0.4 %
(one piece, 11 993 km²).

**Measured**, how far those pieces are drawn from where their own `PLATEID1`
would place them, at 90 Ma:

| Piece | `PLATEID1` | Bound to | Representative point | As bound (90 Ma) | As `PLATEID1` (90 Ma) | Separation |
|---|---:|---:|---|---|---|---:|
| `m` 256 | 616 | 501 | (78.57, 31.24) | (64.25, −27.68) | (86.44, 30.03) | **6 837 km** |
| `m` 245 | 616 | 501 | (76.12, 32.19) | (62.86, −25.76) | (83.87, 30.61) | 6 654 km |
| `m` 258 | 616 | 5011 | (73.71, 32.69) | (61.33, −24.19) | (81.44, 30.76) | 6 474 km |
| `m` 431 | 601 | 501 | (75.02, 34.58) | (63.49, −23.26) | (82.32, 32.81) | 6 547 km |
| `lm` 536 | 616 | 501 | (76.80, 34.09) | (64.53, −24.47) | (84.14, 32.58) | 6 676 km |

Plate-to-plate separation at 90 Ma from plate 501, carrying the same probe
point: 616 and 601 **6 908 km**, 606 (Lhasa) **5 407 km**, 506 6 908 km,
702 (Madagascar) 4 543 km.

**Why the override did not save it, Measured.** `data/corrections/palaeo-coastlines/overrides.json`
does list plate 616 in the `m` class (`overridePlateIds` `[616, 233, 506, 141,
306, 678, 647, 834]`) with buffered footprint **77.672–104.718 E,
23.299–39.857 N**. The compiler's rule
(`scripts/research/palaeo_coastlines_compile.py`, lines 1868–1869 at HEAD
`82ea71e`) requires the **whole piece bbox** to fit inside that footprint:

```
left, bottom, right, top = entry["original"].bounds
if west <= left and right <= east and south <= bottom and top <= north:
```

`m` 256 spans 70.76–97.02 E, so `left = 70.76 < 77.672` and the override is
declined. The sidecar records this directly: for the `m` class, plate 616 has
**81 applied, 123 declined** of 204 eligible pieces. The Lhasa plate 606 and
Tarim 601 are **not in the `m` override list at all**.

**Inference.** The Cao 2024 static partition that owns present-day southern
Tibet and the Himalaya is plate 501, because in that model Indian crust is
underthrust there. That is the right answer for *crust*. It is the wrong answer
for a Cao 2017 *surface palaeogeography* polygon whose own `PLATEID1` says
Qiangtang: at 90 Ma the Gangdese/Qiangtang highland was part of Asia, roughly
6 900 km from India. Binding it to 501 parks an Asian mountain belt against the
northern tip of Greater India, which closes the Neotethys on screen and turns
India's open northern shelf into an apparent interior strait. The runtime keeps
every flagged piece (`palaeoRings.ts` only surfaces flags as limitation lines;
nothing filters them), so the misplacement is drawn.

**Measured — the controlled experiment.** Re-rendering the same camera with
only these six pieces removed (`lm` 536; `m` 245, 252, 256, 258, 431 — every
`m`/`lm` piece whose `PLATEID1` is in {616, 606, 601} and whose binding plate is
an India plate) removes both the north-eastern cream mountain strip **and**
band component #7, and India's northern margin becomes a continuous shelf to the
open Tethys. Component #46 (the Narmada corridor and the western margin)
survives that edit, as it should. Evidence:
`scratchpad/india-band/whatif2_compare.png`, alongside `compare.png`
(capture vs re-projection) and `annotated.png` (band components outlined on the
capture).

---

## 5. Literature: Late Cretaceous marine incursions in peninsular India

**Sourced.** Nagendra & Reddy (2017), *Major geologic events of the Cauvery
Basin, India and their correlation with global signatures – A review*, Journal
of Palaeogeography, [10.1016/j.jop.2016.09.002](https://doi.org/10.1016/j.jop.2016.09.002),
CC BY-NC-ND, retrieved 2026-09-15. *Verbatim* from the abstract: "The Cauvery
Basin came into existence due to Gondwana break up during Late Jurassic–Early
Cretaceous by taphrogenic rift process. The first marine transgression close to
Aptian/Albian boundary at the **western margin of the basin** terminates the
syn-rift tectonic phase, which is also precise in adjoining Krishna-Godavari
(KG) Basin." And: "A major basinal uplift during late Turonian caused by Marion
hot mantle plume … This uplift also led to relative sea level (RSL) fall of
about 100 m in Cauvery and KG Basins … This volcanic episode also resulted in
Madagascar detachment from India."

**Sourced.** Shitole, Patel, Darngawn & Joseph (2021), *Amended
lithostratigraphy of the Cretaceous Bagh Group, Western Lower Narmada Valley,
India: A comparison with pervasive Tethyan basins*, Geological Journal,
[10.1002/gj.4224](https://doi.org/10.1002/gj.4224), retrieved 2026-09-15.
*Verbatim* from the abstract: "The evolution of the Narmada, Saurashtra, and
Kachchh basins in the **western margin of the Indian Craton** is associated with
the Middle Jurassic segmentation of Gondwana." "The lithological and
palaeontological evidences indicate that the Bagh Group succession of the WLNV
developed in a **fluvio-marine environment** during the Berriasian? (Neocomian)
to Coniacian age." "It also shows a similar sedimentation pattern compared with
the adjoining **Saurashtra Basin** during the Cenomanian–Coniacian. However, it
differs from the Kachchh, Mahajanga, and Carnarvon basins…" "The deposition of
the Bagh Group in WLNV terminated with the **separation of the Indian Plate from
Madagascar** and the outpouring of flood basalts during the Coniacian."

**Sourced.** Prasad, Verma, Sahni, Lourembam & Rajkumari (2017), *Elasmobranch
fauna from the upper most part of the Cretaceous Bagh Group, Narmada valley,
India*, Island Arc, [10.1111/iar.12200](https://doi.org/10.1111/iar.12200),
retrieved 2026-09-15. *Verbatim*: "new shark teeth recovered from the upper part
of the **marine Cretaceous Bagh Group, in the lower Narmada valley, Western
India**"; the Cauvery comparison is "the lower Upper Cretaceous (**Cenomanian**)
**Karai Formation** of the Cauvery basin, South India."

**Sourced.** Chaudhary & Nagori (2019), *Ostracods from the Bagh Formation
(Upper Cretaceous) of the Narmada Basin, India: Their age and
paleobiogeographical significance*, Micropaleontology,
[10.47894/mpal.65.6.03](https://doi.org/10.47894/mpal.65.6.03), retrieved
2026-09-15. *Verbatim*: "Forty-seven ostracod species from the Upper Cretaceous
Bagh Formation of **Madhya Pradesh and Gujarat**, India are described."

**Inference, ours, not a claim of these authors.** The Cenomanian–Campanian
marine record of peninsular India is two **separate marginal embayments on
opposite margins of the craton**: the Bagh Group reaching east up the lower
Narmada from the Gujarat/Saurashtra side and ending with India–Madagascar
separation, and the Cauvery–Krishna-Godavari pericratonic rift basins on the
east coast whose first transgression is Aptian/Albian at their *own* western
margin. No source read here places a continuous marine connection across the
craton, and the two systems have different drivers and different first-flooding
ages. **A transcontinental Indian seaway at 94–81 Ma is not supported.**

**Measured — and the shipped map agrees.** The Cao 2017 Narmada corridor
(component #46) is closed to the east: at 22.0 N the `sm`-only corridor runs
from about 74 E to 77 E and everything from 78.5 E eastward is land plus
mountain; at 21.5 N it closes by 77.5 E. The payload therefore already draws a
westward-opening embayment, not a seaway. Its eastern limit (~78–79 E) reaches
roughly 300 km east of the Bagh outcrop belt in Dhar/Jhabua (~74–75 E); that is
a candidate for a future cited tightening, not a defect this memo can prove.

---

## 6. Recommendation

**(a) No basin edit for the band.** The band is not a Cao 2017 claim of shallow
marine across peninsular India. Component #7 is India's own Tethyan (northern)
shelf, which
[palaeo-coastlines-collision-shortening.md](palaeo-coastlines-collision-shortening.md) §D
already records as the layer behaving well: "palaeo *land* riding India stops at
~30 N, and everything north of that up to the crust edge is palaeo *shallow
sea*." Deleting it would delete the Tethyan Himalayan shelf. Component #46 is a
cited Narmada embayment plus the western continental margin. Nothing here asks
for an `india` basin edit.

**(b) The fix is the binding, in the compiler.** The defect is that Cao 2017
mountain (and one landmass) polygons whose `PLATEID1` is an Asian terrane ride
plate 501. Two candidate fixes, in preference order:

1. **Do not let the Greater India partition claim surface classes attributed to
   the Tibetan terranes.** Where the partition owner is 501 (or an India
   sub-plate) and the piece's `PLATEID1` is in {606 Lhasa, 616 Qiangtang, 601
   Tarim, 580, 4561 Qaidam}, bind by `PLATEID1`. This is the same judgement the
   `sm` table already makes in the opposite direction (`sm` binds 501 *over*
   partitions 606/616/580/4561), stated as a cited exception rather than as a
   bbox test. Expected effect, Measured by the controlled experiment: six pieces
   (450 722 km² of `m`, 11 993 km² of `lm`) leave India's northern tip and
   reconstruct with Asia; band component #7 stops being an interior band; the
   90 Ma frame shows India as one landmass with an open Tethyan shelf.
2. **If the footprint mechanism is kept**, note that widening 616's `m`
   footprint will not work honestly: `m` 256 spans 70.76–97.02 E and 616's own
   Cao 2024 crust starts at 83.53 E, so admitting it needs a ~1 200 km buffer,
   far past the rule's stated "one conflict distance beyond the plate's own
   present-day crust". The whole-piece-bbox test is what declines it, and the
   comment at the test explains why a seat test was rejected. Fix 1 is the
   honest one. A weaker fallback is the policy the `sm` note already contemplates
   — emit `lm`/`m` pieces only where they co-move, and count the rest — which
   would also remove these six.

Either way: `overrides.json` should gain 606 and 601 to the `m` class (they are
absent today) with the measurement and citation the file's own rule requires,
and the `m` 616 entry should record that 123 of 204 eligible pieces are
currently declined.

**(c) No rendering change.** `CAO_FOUNDATION_SURFACE_SHELLS` is correct and the
observed overlap rate is zero; changing shells or render order would hide
nothing that is wrong and would break the documented separation.

**Witnesses to add with the fix** (each falsifiable, each red before it):

1. **No Asian-terrane surface class rides India.** For every canonical interval,
   no `m` or `lm` piece with `PLATEID1` ∈ {606, 616, 601, 580, 4561} has a
   binding plate in {501, 5011, 50101, 50102, 5014}. Red today: 5 `m` pieces and
   1 `lm` piece at 94–81 alone.
2. **The Neotethys stays open at 90 Ma.** At 90 Ma, no `m` or `lm` piece bound to
   an India plate reaches north of India's own palaeo-land limit on 501
   (~30 N in present-day terms; the collision memo's table). Red today.
3. **The Narmada corridor stays an embayment.** In every interval from 117–94 to
   81–58, the `sm`-only corridor across peninsular India does not connect the
   western margin to the eastern margin: at 22 N there is land or mountain
   between 78.5 E and 84 E. Green today; the witness pins it.
4. **Frame-conflict budget for `m`.** The fraction of India-bound `m` area
   carrying a frame-conflict flag stays at 0 %. Measured today: 46.3 %.

---

## Appendix: scratch evidence

Under
`/private/tmp/claude-501/-Volumes-EksternalHome-Koding-HTML-EarthHistory/795e3aa9-9911-4167-b7c7-76edc2aba7b8/scratchpad/india-band/`
(scratch tier; promote anything a durable record needs before it expires):

| File | What it is |
|---|---|
| `compare.png` | the capture crop above the synthetic re-projection — the proof the camera model is right |
| `annotated.png` | band components #7 (red), #46 (yellow), #52 (magenta) outlined on the capture |
| `whatif2_compare.png` | before/after with the six Asian-terrane pieces removed |
| `recon90.json` | every 94–81 piece reconstructed to 90 Ma with its binding, flags and source record |
| `probeline.py`, `gaptest.py`, `stripe.py`, `totals.py`, `fc.py` | the probes this memo quotes |
