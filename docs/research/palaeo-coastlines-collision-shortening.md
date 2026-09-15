# Is enough continental crust compacted to build the mountains?

Probe date: 2026-09-15. Read-only measurement of the **Cao et al. (2024) v2.4
plate model** and of the **shipped package** under
`public/data/reconstruction/cao-v2.4/`, against the published crustal-shortening
budgets of three collisions. Companion to
[palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md) (what the source
package is), [palaeo-coastlines-literature.md](palaeo-coastlines-literature.md)
(what the palaeogeography publications say) and
[palaeo-coastlines-north-sea-formation-checks.md](palaeo-coastlines-north-sea-formation-checks.md)
(the probe method reused here). The measured record is
[palaeo-coastlines-collision-shortening.json](palaeo-coastlines-collision-shortening.json).
It changes nothing.

The user's requirement is one sentence: **sufficient continental land needs to be
compacted to explain the height of the mountains.** A rigid plate model can fail
that requirement silently. Nothing in Cao 2024 asserts how much crust an orogen
consumed; the blocks simply move, and if a block's present-day outline is all the
crust it ever had, the model builds a mountain belt out of nothing.

## Result in one table

| Collision | Literature minimum, and what it is | Model | Verdict |
|---|---:|---:|---|
| **India–Asia** (Himalaya–Tibet), 85 E | **≥ 1,000 km** of Indian continental crust north of the present Himalayan front (band 800–1,350 km) | **1,341 km** | **PASS** |
| **Adria–Europe** (Alps), 10 E | **≥ 140 km** of Adriatic crust north of its present outline (band 140–300 km) | **0 km** | **FAIL** by 140 km |
| **Baltica–Laurentia** (Scandian Caledonides), 62 N | **≥ 140 km** of Baltican crust west of the present Norwegian coast (≥ 250 km at 66 N, ≥ 400 km at 70 N) | **122 km**, and that 122 km is modern Atlantic shelf, not restored margin | **FAIL** by 18 km at 62 N, 108 km at 66 N; **by 140 / 250 km** on a strict reading |

The India answer is a genuine pass and it comes from one feature: Cao 2024 ships
`Greater India based on Gibbons et al. (2015) Gondwana Research` on plate 501,
4.20 Mkm² of crust reaching 40.17 N, with a lifecycle that **ends at 10 Ma** —
the model's own statement that this crust is consumed. Nothing equivalent exists
for the Alps or the Caledonides.

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` (pyGPlates 1.0.0, Shapely 2.0.7) |
| Plate model | `cao2024-v2.4/1.8Ga_model_GSF`: `shapes_continents.gpmlz`, `shapes_coasts.gpmlz`, **both** rotation files (`1000_0` and `1800_1000`; loading only the younger one silently returns identity for 17 sub-block ids) |
| Package | `public/data/reconstruction/cao-v2.4/core.json` (read through `cao_package_intern.read_package_json`), the two palaeo class catalogs and 12 EHPR payloads |
| Integrity | **Measured.** Every payload `sha256` re-computed here equals the digest its own class catalog pins. |

**Method, Measured.** Three quantities, each re-derivable by
`scripts/research/validate_precollision_extent.py`:

1. **Extent** — in the model's own present-day (0 Ma) frame, how far the lower
   plate's continental crust reaches beyond that plate's present continental
   outline along a named transect, by point-in-polygon sampling on the sphere at
   0.02°. This is the quantity the literature minima are stated in. The blocks
   are rigid, so the length is the same at every age the feature is alive.
2. **Overlap** — the area two reconstructed crust sets share at a given age, on
   a Lambert azimuthal equal-area projection centred on the pair, with every
   great-circle edge densified at 0.5° before the planar Boolean. Rigid blocks
   that overlap are the model saying *this much crust must be thickened or
   subducted*.
3. **Convergence** — the great-circle closure between one pin on each plate.

**Inference.** Extent and overlap answer different halves of the requirement.
Extent asks *was the crust ever there*; overlap asks *did the model ever push
it together*. A model can pass one and fail the other, and the Alps do exactly
that: its Adria–Europe convergence is in the published range while its consumed
crust is zero.

---

## A. India–Asia: the Himalaya

### A.1 What the literature requires

Three quantities are routinely conflated and must not be. **C** = total
India–Asia convergence; **A** = intra-Asian shortening north of the
Indus–Yarlung suture; **G** = Greater India extent, the Indian-plate crust
consumed since collision. *G = C − A.* **3,600 km is C at the eastern syntaxis,
not G.**

| Source | Constrains | Number | Tag |
|---|---|---|---|
| van Hinsbergen et al. 2019 ([10.1016/j.tecto.2018.04.006](https://doi.org/10.1016/j.tecto.2018.04.006)) | Himalayan balanced-section shortening | "minimum shortening estimates of **600–1100 km**" | Verbatim |
| van Hinsbergen et al. 2019 | restored Himalayan width | Lesser Himalaya "up to some **800 km**", Tethyan + Greater Himalaya "some **300–400 km**"; present width "~200 km" | Verbatim |
| van Hinsbergen et al. 2019 | Greater India | "**2600 km in the west and 3400 km in the east**" after removing "~1000–1200 km of post-collisional intra-Asian shortening" | Verbatim |
| van Hinsbergen et al. 2012 ([10.1073/pnas.1117262109](https://doi.org/10.1073/pnas.1117262109)) | convergence; a small continental Greater India | "**3,600 ± 35 km**" at the eastern syntaxis since 52 Ma; Greater India "**not larger than approximately 900 km**" in the Early Cretaceous | Verbatim |
| Hu et al. 2016 ([10.1016/j.earscirev.2016.07.014](https://doi.org/10.1016/j.earscirev.2016.07.014)) | collision onset; partition | "**59 ± 1 Ma**"; "within Asia (**600–750 km**) and within the Himalaya (**~900 km**)" | Verbatim |
| DeCelles et al. 2002 ([10.1029/2001TC001322](https://doi.org/10.1029/2001TC001322)) | fold-thrust-belt shortening | "total minimum shortening in the fold-thrust belt is **up to ~670 km**" | Verbatim |
| Long et al. 2011 ([10.1130/B30203.1](https://doi.org/10.1130/B30203.1)) | Bhutan | "**344–405 km** of minimum crustal shortening (70 %–75 %)" | Verbatim |
| Ingalls et al. 2016 ([10.1038/ngeo2806](https://doi.org/10.1038/ngeo2806)) | missing crust | "about **50 %** of the pre-collisional continental crustal mass cannot be accounted for" | Verbatim |
| Gibbons et al. 2015 ([10.1016/j.gr.2015.01.001](https://doi.org/10.1016/j.gr.2015.01.001)) | the geometry Cao's own feature is named after | "reaching **~600 km and 1000 km in western and central regions**" | Verbatim |

**Derived minimum, Inference.** Datum: the Main Frontal Thrust at the
Sub-Himalayan front, ~27.5 N at 85 E. Restored width = present width +
shortening ⇒ floor 200 + 600 = **800 km**, centrally 200 + 900 = **1,100 km**,
top 250 + 1,100 = **1,350 km**; van Hinsbergen et al. 2019 publish the restored
widths directly as 1,100–1,200 km, which confirms the arithmetic. **Minimum
≈ 1,000 km, band 800–1,350 km.** This is crust that is mapped, restorable and
therefore had to exist; every school of thought — small Greater India, Greater
India Basin, and fully continental — agrees on it. The **maximum defensible**
value, ~3,000 km at 85 E, assumes Greater India was entirely continental
(Ingalls et al. 2016; Hu et al. 2016) and is a contested model, not a minimum.

### A.2 What the model carries

**Measured**, present-day frame, northward reach of Cao's Greater India
features beyond the model's own Indian continental outline:

| Meridian | Greater India north limit | Indian crust north limit | Extent |
|---|---:|---:|---:|
| 72 E | 40.04 N | 34.36 N | 632 km |
| 75 E | 40.16 N | 32.74 N | 825 km |
| 80 E | 39.90 N | 29.16 N | 1,194 km |
| **85 E** | **39.36 N** | **27.30 N** | **1,341 km** |
| 88 E | 38.66 N | 26.72 N | 1,328 km |
| 92 E | 37.10 N | 26.92 N | 1,132 km |

The datum lines up with the literature's without being made to: the Cao Indian
continental outline ends at **27.30 N** on 85 E and the Main Frontal Thrust is at
~27.5 N. (The Cao *static partition* for the India plate reaches 29.44 N there —
the suture, about 240 km further north. Measured against that datum the extent is
1,103 km, still above the 800 km floor.)

Three features supply it: `Greater India based on Gibbons et al. (2015) Gondwana
Research` (501, 600 → **10 Ma**, 4,202,231 km²), `Tethyan Himalayan microcontinent
of Greater India` (501, 600 → 0 Ma, 482,291 km²) and `Lesser Himalayan pass
margin Greater Indian Basin` (501, 600 → 0 Ma, 103,003 km²). Their union is
**4,303,681 km²**, of which 457,874 km² laps onto the present Indian outline —
about **3.85 Mkm² of extra crust**, which is 95 % of India's own 4.04 Mkm².

**Measured**, the model's own consumption statement — reconstructed overlap with
Lhasa + Qiangtang:

| Age (Ma) | 100 | 80 | 60 | 50 | 45 | 40 | 30 | 20 | 10 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Overlap (km²) | 0 | 0 | 0 | 0 | 0 | 50,107 | 335,704 | 478,371 | 854,113 |
| Minimum gap (km) | 4,710 | 3,736 | 1,596 | 356 | 19 | — | — | — | — |

First crust contact falls **between 50 and 45 Ma**; overlap begins at 40 Ma and
reaches 854,113 km² at 10 Ma, the last age Greater India exists. At 20 Ma the
overlapping patch is one contiguous body about 2,000 km along strike and ~240 km
wide. Convergence at 85 E, Indian margin to southern Lhasa: 3,147 km at 60 Ma →
1,889 km at 50 Ma → 334 km today, i.e. **2,813 km of closure since 60 Ma**.

**Verdict: PASS.** 1,341 km ≥ 1,000 km. Two caveats belong on the record:
the model's collision onset (~45 Ma) is *younger* than both published onsets
(59 ± 1 Ma, Hu et al. 2016; ≥ 52 Ma, van Hinsbergen et al. 2012); and against the
fully-continental Greater India (~3,000 km at 85 E) the model is short by
~1,659 km. A pass against the minimum is not a pass against the maximum, and the
maximum is what Ingalls et al. 2016's mass balance argues for.

---

## B. Adria–Europe: the Alps

### B.1 What the literature requires

| Source | Constrains | Number | Tag |
|---|---|---|---|
| Schmid et al. 1996 ([10.1029/96TC00433](https://doi.org/10.1029/96TC00433)), table reproduced verbatim in Schmid et al. 2004 TRANSMED | N–S convergence, NFP20-East | 200 km (65–50 Ma), 150 km (50–40), "**45 km represent a minimum estimate only**" (40–32), "a total of **58 km**" (32–19), "a total of **61 km**" (19–0); "**more than 514 km**" since 65 Ma | Verbatim |
| Schmid et al. 2004 TRANSMED | independent check from the subducted slab | "a shortening of about **120 km** since the onset of continental collision" (Central Alps); "**some 210 km**" (Eastern Alps) | Verbatim |
| Handy et al. 2010 ([10.1016/j.earscirev.2010.06.002](https://doi.org/10.1016/j.earscirev.2010.06.002)) | post-Eocene shortening; margin width | "**160 km** … post-Eocene N–S crustal shortening"; "**63 km** … north of the Insubric Line"; "we assumed the width of the subducted part of the continental margins to have been about **100 km**" | Verbatim |
| Le Breton et al. 2021 ([10.5194/se-12-885-2021](https://doi.org/10.5194/se-12-885-2021)) | Adria–Europe budget; Adriatic margin | "**680 km since 84 Ma** (**420 km** 84–35, **260 km** 35–0)"; necking "**45–65 km**", distal margin "**40–80 km**"; oceanic Piemont-Liguria "**a maximum of 250 km**"; "at least **63 %** … was extended continental lithosphere and OCT zones" | Verbatim |
| Le Breton et al. 2021 | restored Adriatic proximal margin | "an **initial length of ca. 300 km** … This amount should be regarded as an absolute minimum" | Verbatim |

**Derived minima, Inference.** Post-32 Ma N–S convergence = 58 + 61 = 119 km;
post-40 Ma = 45 + 58 + 61 = 164 km, which is the "160 km" Handy et al. quote —
an internal check that the sum is the number the community cites. **Minimum N–S
Alpine shortening since ~35 Ma ≈ 120 km** (best 120–165 km). Adria's own share:
56 km of Southern Alpine shortening (verbatim "a total of 56 km post-Adamello
phase shortening in the Southern Alps") plus 85–145 km of consumed necking and
distal margin ⇒ **minimum Adriatic crust beyond its present outline ≥ 140 km**,
best 150–220 km. The European margin contributes a further ≥ 230 km. Piemont-
Liguria and Valais **oceanic** lithosphere does not count: it was never land.

### B.2 What the model carries

**Measured**, present-day frame:

| Meridian | Adria north limit | Europe south limit | Adriatic crust beyond it |
|---|---:|---:|---:|
| 8 E | 45.56 N | 46.30 N | 0 km (82 km short of contact) |
| **10 E** | **47.30 N** | **47.32 N** | **0 km** (2.2 km short of contact) |
| 12 E | 47.68 N | 47.70 N | 0 km (2.2 km) |
| 14 E | 47.06 N | 47.92 N | 0 km (96 km) |

`Adria` (307, 319 → 0 Ma, 343,797 km²), `Apulia` (3307, 500 → 0 Ma,
53,637 km²) and `Eastern Dinaride Platform` (308, 319 → 0 Ma, 222,022 km²) tile
the present crust exactly. Their union with the European set overlaps by
**0 km² in the present frame and at every reconstructed age from 140 Ma to
0 Ma.** No Adriatic crust is ever consumed.

**Measured**, the convergence the model does perform. Adria–Europe minimum gap:
576 km at 100 Ma, 338 at 60, **166 at 35**, 83 at 20, 26 at 10, 0 at 0. Pin-pair
on 10 E (Po plain, 307 → Molasse basin, 305): 1,105 km at 84 Ma → 668 at 35 →
367 today, i.e. **738 km of closure since 84 Ma and 301 km since 35 Ma**.

**Inference, and this is the finding.** The model's *kinematics* are inside the
published range — 301 km since 35 Ma against Le Breton's 260 km along 335°, and
738 km since 84 Ma against 680 km. Its *crust budget* is empty. All of that
convergence closes an **empty seam**: on 10 E the gap between the Adriatic and
European crust tiles is about **316 km wide at 35 Ma**, and it shuts without a
single square kilometre of crust being shortened. On the globe the Oligocene
Alps are a hole, not a mountain belt.

**Verdict: FAIL by 140 km** (0 km against a 140 km minimum), and by ≥ 230 km more
on the European side. The literature is not asking for a subtlety here: Le
Breton et al. 2021 put at least 63 % of all material consumed in the Alpine
orogeny at extended continental lithosphere and ocean–continent transition.

---

## C. Baltica–Laurentia: the Scandinavian Caledonides

### C.1 What the literature requires

| Source | Constrains | Number | Tag |
|---|---|---|---|
| Gee 1978 ([10.1016/0040-1951(78)90040-9](https://doi.org/10.1016/0040-1951(78)90040-9)), quoted verbatim by Lorenz et al. 2015 and Gee et al. 2013 | Middle Allochthon transport, Jämtland ~63.4 N | "derived from **west of the Norwegian coast** and the upper units transported **at least 400 km eastwards**" | Verbatim of the citing papers |
| Gayer et al. 1987 ([10.1017/S026359330001110X](https://doi.org/10.1017/S026359330001110X)) | balanced section, Finnmark ~70 N | "**Total shortening is 78·7 %** with a translation of the most internal thrust sheet of **626 km**" | Verbatim |
| Gayer et al. 1987 | **the pre-collision margin** | "the Caledonian Baltoscandian margin prior to Iapetus suturing extended **at least 400 km W of the Norwegian coast**. On a Bullard reconstruction this **overlaps with Laurentian rocks in Greenland**. The excess continental crust is accounted for by shortening of the Baltoscandian margin during collision." | Verbatim |
| Lorenz et al. 2015 ([10.5194/sd-19-1-2015](https://doi.org/10.5194/sd-19-1-2015)) | orogen class | "collisional orogen of **Alpine–Himalayan dimensions**"; Baltica "played a **similar role to that of India**" | Verbatim |
| Lorenz et al. 2011 ([10.2204/iodp.sd.11.09.2011](https://doi.org/10.2204/iodp.sd.11.09.2011)) | thickening; Greenland side | "**doubling (even trebling) of continental thicknesses**"; Greenland thrust sheets "at least **two hundred kilometers westwards**" | Verbatim |
| Fossen 2010 ([10.1144/SP335.31](https://doi.org/10.1144/SP335.31)) | orogen dimensions; collapse | "more than **1800 km long and 500 km wide**"; Nordfjord-Sogn Detachment Zone offset "well in excess of **50 km**"; extension is "**Devonian (403–380 Ma)**" | Verbatim |
| Fossen et al. 2014 ([10.1130/G35842.1](https://doi.org/10.1130/G35842.1)) | continental subduction depth | "the **leading edge of Baltica locally reached depths on the order of 125 km**" | Verbatim |
| Hacker 2007 ([10.1130/2006.2419(09)](https://doi.org/10.1130/2006.2419\(09\))) | UHP | coesite and diamond eclogite "**~2.0 GPa … to ~3.5 GPa**", exhumed "from **130 km depth**" | Verbatim |
| Gee et al. 2008 ([10.18814/epiiugs/2008/v31i1/007](https://doi.org/10.18814/epiiugs/2008/v31i1/007)) | the present shelf | the wide continental shelves west of Norway "are **inferred to be underlain by the Caledonide hinterland**" | Verbatim; carries no km figure |

**Derived minima, Inference.** In a foreland-propagating piggyback system the
most internal restorable sheet's displacement sums the slip beneath it, so
minimum shortening at 62–66 N is **≥ 400 km**; the Seve is not the highest sheet
and the internal zone is explicitly "not restorable" (Hossack & Cooper 1986), so
that can only rise. Restoring 400 km of ESE transport from the Seve outcrop belt
puts the root of the Middle Allochthon about **140 km west of the present coast
at 62–63 N** and **250–290 km at 66 N**; Gayer et al. 1987's **≥ 400 km at 70 N**
is the only directly published figure. Adding the Laurentian retro-wedge
(≥ 200 km) gives **≥ 600 km of continental shortening across the whole
bivergent orogen**. Iapetus **oceanic** lithosphere does not count, and no
retrieved source gives a defensible Iapetus width immediately before the
Scandian collision — do not put a number on it.

Two overprints make a naive present-outline comparison worse, not better, and
**both push the same way**: Devonian extensional collapse (403–380 Ma) moved the
hinterland *west*, so the present 500 km-wide belt is wider than it was at peak
collision; and Mesozoic–Cenozoic Atlantic rifting stretched the crust between
the coast and the shelf edge and carried Greenland away entirely.

### C.2 What the model carries

**Measured**, present-day frame, Baltican continental crust west of the model's
own plate-302 coastline polygons:

| Parallel | Crust west limit | Coast west limit | Crust beyond the coast |
|---|---:|---:|---:|
| 58 N | 2.20 E | 7.08 E | 288 km |
| 60 N | 1.98 E | 5.40 E | 190 km |
| **62 N** | **3.04 E** | **5.38 E** | **122 km** |
| 64 N | 6.12 E | 9.98 E | 188 km |
| **66 N** | **9.42 E** | **12.56 E** | **142 km** |
| 68 N | 12.14 E | 15.40 E | 136 km |

**Inference.** That crust is the modern continental shelf — Atlantic-rifted,
Mesozoic-stretched Baltica — not a restored Caledonian margin. Crediting it
against the Caledonide budget is generous; on a strict reading the model carries
**0 km** of restored pre-collision Baltican margin, exactly as for Adria.

**Measured**, reconstructed Baltica against Laurentia + Greenland:

| Age (Ma) | 450 | 440 | 430 | 420 | 410 | 400 | 390 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Overlap (km²) | 0 | 0 | **122,405** | 108,489 | 107,098 | 89,233 | 72,007 |
| Minimum gap (km) | 2,029 | 1,137 | 0 | 0 | 0 | 0 | 0 |

The overlap is **entirely with Greenland** (102) — the Baltica–Greenland pair
gives the same areas to within 3 km². It is one contiguous patch about 690 km
long and ~180 km wide at 430 Ma, and it **shrinks** from 430 to 390 Ma, which is
the model letting the two plates drift apart again rather than compacting
further. `Northern Highlands` (303, Scotland) never overlaps Baltica: it docks at
430 Ma and holds a fixed 41.4 km gap from then on.

**This overlap is the right thing in the wrong amount.** It is exactly the
geometry Gayer et al. 1987 predicted — a restored Baltoscandian margin that
"overlaps with Laurentian rocks in Greenland" — and it is the only place in the
three collisions where Cao 2024 volunteers consumed crust without a dedicated
pre-collision feature. But 122,405 km² over a >1,800 km belt is ~68 km of average
shortening; ≥ 600 km over that belt would be **≥ 1.08 million km²** (*Inference*).
The model supplies about **11 %**.

**Verdict: FAIL**, by 18 km at 62 N and 108 km at 66 N against the transect
minima, or by the full 140 / 250 km on the strict reading.

**Context worth carrying.** Two authoring facts sit inside this window. The
Cao/Merdith **410 Ma junction** ([regional-material-model-lineage.md](regional-material-model-lineage.md))
shows up directly in the measurement: the Baltica crust set jumps from
7.08 to 8.42 Mkm² at 410 Ma as `Eurasia` (302, 410 → 0 Ma) and `Timan Region`
(302, 410 → 0 Ma) begin, so any Caledonide area series crosses a coverage step,
not a tectonic one. And the tracked **North Sea rigid restoration** moves the
UK-side charts on plates 315/303 toward Norway between 130 and 430 Ma; it is a
Mesozoic rift restoration and supplies nothing to the Scandian budget, but it is
the reason plate 303 sits 41.4 km off Baltica rather than on it.

---

## D. What the palaeo-coastline layer says about this crust

**Method, Measured**, reusing the formation-check probe: decode each shipped
EHPR payload, rebuild every piece, test a present-day `(lon, lat)` for
containment, and read the piece's own catalog binding row. All 12 payloads read
match their pinned digests.

**Measured**, the northern limit of shipped ground *bound to plate 501*:

| Interval | `lm` (palaeo land) on 501 | `sm` (palaeo shallow sea) on 501 |
|---|---:|---:|
| 117–94 Ma | 29.86 N | 38.58 N |
| 94–81 Ma | 30.02 N | 39.54 N |
| 81–58 Ma | 29.60 N | 40.15 N |
| 58–49 Ma | 34.50 N | 39.89 N |

**This is the layer behaving well.** The Cao 2024 Greater India crust reaches
39.36 N at 85 E; palaeo *land* riding India stops at ~30 N, and everything north
of that up to the crust edge is palaeo *shallow sea*. So on screen at 100, 80 and
60 Ma, Greater India renders as a large shallow shelf north of a Tethyan
Himalayan coastline — which is what the Tethyan Himalaya's shelf-and-slope
stratigraphy says it was, and what van Hinsbergen et al. 2012's Greater India
Basin argues for more strongly still. The layer does **not** invent a
continent-sized landmass in the Tethys.

Two mechanics behind that, both Measured and both worth knowing:

* The `sm` class binds Greater India ground by **PLATEID1 override**, not by
  partition: catalog rows bind plate 501 over partitions 606 (Lhasa), 616
  (Qiangtang), 580 (Tarim), 4561 (Qaidam), 457, 301 and others. Without that
  override the shallow sea would ride Tibet and detach from the crust under it.
* The `lm` class has only a partition binding for 501, so land at present-day
  Tibetan coordinates rides **Tarim 580 / Qiangtang 616 / Lhasa 606**. That is
  correct for Tibet, which was a separate block, but it means the Greater India
  extension carries no land class of its own — it is shallow sea or nothing.

Adria and Apulia: `sm` bound to 307 reaches 45.6–46.7 N (Adria's own crust limit
is 46.68 N), and no `lm` rides 307 before the 81–58 interval. Plate 3307 carries
a very wide **override** footprint — at 94–81 Ma, ground bound to Apulia spans
3.7–31.6 E and 36.0–55.8 N. That is a Cao 2017 `PLATEID1 = 3307` artefact riding
the whole Tethys, already on the audit's override list, and it is worth a look on
its own account. Baltica 302 and Greenland 102 carry ordinary partition bindings
throughout.

---

## E. What the map key should say

For the Greater India crust, the honest line is short and names its source:

> **Greater India — model inference after Gibbons et al. (2015).** The Cao et al.
> (2024) plate model carries about 1,300 km of Indian continental crust north of
> India's present edge, consumed in the Himalaya and beneath Tibet and removed
> from the model at 10 Ma. Its extent is model output, not observed geography,
> and published estimates range from about 600 km to about 3,000 km.

Three rules behind that wording:

1. **Name the model, not the map.** "Greater India based on Gibbons et al.
   (2015)" is the feature's own name in Cao 2024 and `gibbons-2015-greater-india`
   is the source id to add to `src/data/sources.ts`. Evidence status is
   **model-output**, never observed.
2. **Say crust, not land.** The layer draws this ground as shallow sea, and the
   Tethyan Himalaya was a shelf. A key line that says "land" would contradict the
   pixels.
3. **Carry the spread.** 600 km (Ali & Aitchison 2005; Gibbons et al. 2015) to
   3,000 km (van Hinsbergen et al. 2019 under a fully continental Greater India)
   is a factor of five, and it is unresolved. The collision age must travel with
   the number: 1 Myr of collision age moves the convergence budget by 150–180 km
   (van Hinsbergen et al. 2019, *Verbatim*).

For the Alps and the Caledonides the key must say the opposite, because the model
has nothing to show:

> **The Alps and the Caledonides are drawn from present-day crust outlines.** The
> plate model carries no restored pre-collision Adriatic or Baltican margin, so
> the convergence closes a gap rather than compacting crust. Published minimum
> shortening is at least 140 km of Adriatic margin (Le Breton et al. 2021;
> Schmid et al. 1996) and at least 400 km across the Scandinavian Caledonides
> (Gee 1978; Gayer et al. 1987).

---

## F. Limitations, and what would change the answer

* **Schmid et al. 1996 and Gee 1978 were not read directly.** Their numbers are
  verbatim from Schmid et al. 2004 TRANSMED (whose table caption reads "after
  Schmid et al. 1996" and which independently reproduces the 63 km and 400 km
  figures Handy et al. quote) and from Lorenz et al. 2015 / Gee et al. 2013. Both
  should be checked against the primary before they become a cited project datum.
* **Rosenberg & Kissling 2013 and Rosenberg et al. 2015 are Snippet-only.**
  Rosenberg et al.'s lower Central-Alpine figure (30–95 km) excludes the Southern
  Alps, so it does not lower the orogen-wide ≥ 120 km used here, but it is not
  verified.
* **Ali & Aitchison 2005 is Snippet-only** and is quoted here only as the low end
  of the Greater India spread, corroborated in magnitude by Gibbons et al. 2015.
* **Hossack & Cooper 1986 is GSL SP 19, not SP 9**, and its published summary
  contains no kilometre figure. The "several hundred km" often attributed to it
  is not in it; the numeric balanced-section result belongs to Gayer et al. 1987.
* **No defensible Iapetus width** exists in the retrieved literature for the
  Baltica–Laurentia gap immediately before the Scandian collision. Do not
  fabricate one; use the plate model's own geometry if a width is needed.
* **The transect minima for the Caledonides at 62 and 66 N are Inference** from a
  Verbatim ≥ 400 km of transport plus approximate outcrop longitudes. Only the
  70 N figure (Gayer et al. 1987) is directly published. Anyone reproducing them
  should substitute precise outcrop and thrust-front coordinates.
* **Fixing the Alps or the Caledonides is a data change, not a rendering
  change.** It would need new pre-collision crust features with their own
  lifecycles, authored the way Cao 2024 authored Greater India, with their own
  source records — which is a scope decision for the user, not this memo.

## Gates

**Both gates below are drafts and are not in the repository.** A concurrent agent
held `scripts/research/` and `src/` at the time of writing, so they were left in
the session scratchpad at
`.../scratchpad/collision/draft/validate_precollision_extent.py` and
`.../scratchpad/collision/draft/precollisionExtent.test.ts` rather than copied in.
The validator's full run, its `--record-only` run and its ten-mutation
`--self-test` were all executed against the pinned model from there and pass; the
vitest has **not** been executed, because running it requires the file to sit in
`src/reconstruction/`.

`validate_precollision_extent.py` re-derives every number above
from the pinned model: the seven feature identities, plate ids, valid times and
areas (±1 %), the sixteen transect extents, the nineteen reconstructed overlaps
and eleven minimum gaps, and the twenty pin-pair convergences. `--record-only`
runs in any checkout and checks the literature minima, their references and the
pinned verdicts alone. `--self-test` proves ten mutations red: a renamed feature,
a Greater India lifecycle that no longer ends at 10 Ma, an Adria area moved 2 %,
a minimum raised above the model, a minimum stripped of its references, a
reference tagged neither claim nor inference, a minimum below its own band, a
pinned extent that no longer matches the measurement, an Alpine verdict flipped
to pass, and a Caledonide minimum lowered until the modern Atlantic shelf passes
for a restored margin.

`precollisionExtent.test.ts` (intended for `src/reconstruction/`) reads the bytes a browser
downloads: the nine crust charts and their lifecycles in `core.json`, the
uniqueness of Greater India's 10 Ma retirement, the recorded extents against
their verdicts, and the palaeo class catalogs' bindings for plates 501, 307, 302
and 102. A package refresh that drops Greater India, re-dates it, or lets `lm`
ride plate 501 north of 31 N turns it red.
