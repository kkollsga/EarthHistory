# Palaeo-coastline checks: Loppa High crest exposure, and the Tunguska at 359–338

Two questions held open by earlier memos, each of which was blocked on a single
missing sentence in the literature rather than on a measurement.

- [palaeo-coastlines-norwegian-shelf-checks.md](palaeo-coastlines-norwegian-shelf-checks.md)
  §7.2 and §9.2 hold a `barents-loppa` `add-land` op at `135-117` "pending a
  source that states subaerial exposure of the crest rather than inversion of
  its margins".
- [palaeo-coastlines-inland-sea-checks.md](palaeo-coastlines-inland-sea-checks.md)
  §14/C8 and §15.2 hold a large `remove-shallow` over the central Tunguska at
  `359-338` because the only support was a 1985 USGS open-file report whose
  figures were not seen.

**Both remain held. No operation is proposed by this memo.** Nine witnesses are
proposed instead, and two limitations are recorded.

## Measurement provenance

**Measured**, working tree HEAD `49ccb43551c9abb3b0b9e27b09dc6c7af279d978`
(branch `codex/palaeo-coastlines`). Payloads were extracted with
`git archive HEAD public/data/reconstruction/cao-v2.4/palaeo-coastlines`, so
nothing in the working tree can have influenced a number here. The probe imports
`scripts/research/palaeo_coastlines_compile.py` read-only under the pygplates
venv, decodes with `decode_ehpr`/`piece_geometry`, unions each class per
interval and runs `shapely.contains()`. Class sets, never `sm` membership tests.

| Payload | sha256 (HEAD) |
|---|---|
| `lm/palaeo-lm-135-117.ehpr` | `14102f4d135048e28aa701e98a2e98abacf85cbc6cbb913beb51db8f13378a91` |
| `sm/palaeo-sm-135-117.ehpr` | `ddaaf49071e46e7b1559ba14ea075984e2b703e138e0a93d3a408602499a479e` |
| `m/palaeo-m-135-117.ehpr` | `bfc01e024093e156517086f976a29679127053ddf5ac025ecbad8c7f3d6f3dd5` |
| `lm/palaeo-lm-166-146.ehpr` | `2429117691bced7b6ba6670d8b6495cb5b505ec4b1e3f2cf940026f2ad5188f3` |
| `sm/palaeo-sm-166-146.ehpr` | `4466ec18912b2506b37d4fb1b4d86f179237006962f852d80f3a877c6dd867c0` |
| `lm/palaeo-lm-359-338.ehpr` | `87feef8bf4d24cea22b54f91deb605edb5429a918cdc43622333948d16c4097b` |
| `sm/palaeo-sm-359-338.ehpr` | `b275314ddd7646b90bba775278f9fd2c36078b97fb719b0a3707016993261142` |
| `m/palaeo-m-359-338.ehpr` | `b269c4d269e9074200c7ec7460923fdfef6d6206a859910796b28b95f5c07f3e` |

The full 78-file digest list and the probe scripts are in the run scratch tier
(`scratchpad/barents/head-sha256.txt`, `probe.py`, `scan.py`, `probe.json`).
Everything a durable claim needs is reproduced in this memo.

---

# A. Loppa High: is crest exposure citable?

## A.1 The Triassic branch is closed by the bin, not by the literature

`248-224` spans Induan to Carnian and the shipped intervals keep the **maximum**
transgression in the bin. Worsley 2008 puts the Loppa High's marine onset in the
Anisian/Ladinian, inside that bin, and the Snadd Formation's "major transgressive
pulse which submerged all structural highs and platform areas in the region"
(Sodir, *Verbatim*, cited in the shelf-checks memo) is the positive statement for
its marine half. **No Triassic source can produce an op here**, however
emphatically it states exposure, because the bin would still select `sm`. The
Lower Permian palaeokarst of the Gipsdalen Group on the high (Ahlborn, Stemmerik
& Kalstø 2014, *Marine and Petroleum Geology* 56, 16–33,
[doi:10.1016/j.marpetgeo.2014.02.015](https://doi.org/10.1016/j.marpetgeo.2014.02.015);
abstract not retrievable, title only) is genuine exposure evidence, but the
Gipsdalen Group is Lower Permian and so falls in `296-285`/`285-269`, outside
every interval this brief probes and under the same maximum-transgression bin
semantics. Future runs should not re-open the Triassic branch.

So the whole question reduces to `135-117` (Valanginian–Aptian), which contains
the early Barremian c. 131 Ma initiation date.

## A.2 Measured at HEAD, `248-224` … `94-81`

Drilled positions from the shelf-checks memo's Sodir wellbore anchors. Class
sets; `lm+sm` renders as land, a set containing `m` renders as mountain.

| Interval | Alta 7220/11-1 (20.546, 72.057) | Gohta 7120/1-3 (20.270, 71.903) | crest (21.0, 72.0) | Bjarmeland (30, 73) | Hammerfest (22, 71.5) | Svalbard (16, 78) |
|---|---|---|---|---|---|---|
| 248–224 | `sm` | `sm` | `sm` | `sm` | `sm` | `sm` |
| 224–203 | `sm` | `sm` | `sm` | `sm` | **`lm`** | `sm` |
| 203–179 | `sm` | `sm` | `sm` | `sm` | `sm` | `sm` |
| 179–166 | `sm` | `sm` | `sm` | `sm` | `sm` | `sm` |
| 166–146 | `sm` | `sm` | **`lm`+`sm` → land** | `sm` | **`lm`+`sm` → land** | `sm` |
| 146–135 | `sm` | `sm` | `sm` | `sm` | `sm` | `sm` |
| **135–117** | **`sm`** | **`sm`** | **`sm`** | `sm` | `sm` | **`neither`** |
| 117–94 | `sm` | `sm` | `sm` | `sm` | **`lm`** | `sm` |
| 94–81 | `sm` | `sm` | `sm` | `sm` | **`lm`** | **`lm`** |

**Measured**, box 19–23 E, 71–73 N on a 0.5° grid (n = 45):

| Interval | classes |
|---|---|
| 248–224 | `sm` 45 |
| 224–203 | `sm` 30, `lm` 12, `neither` 3 |
| 203–179 | `sm` 35, `lm` 9, `neither` 1 |
| 179–166 | `sm` 45 |
| 166–146 | `sm` 30, `lm`+`sm` 13, `neither` 2 |
| 146–135 | `sm` 45 |
| **135–117** | **`sm` 35, `neither` 10** |
| 117–94 | `sm` 28, `lm` 17 |
| 94–81 | `sm` 32, `lm` 13 |

This reproduces the shelf-checks memo's §7.2 table exactly at the three Loppa
points, from an independently extracted HEAD payload. Three results are new:

- **The crest (21.0, 72.0) is `lm`+`sm` at `166-146`** while both drilled points
  are `sm`. The map already draws a latest-Jurassic emergent crest. Nothing in
  the shelf-checks memo's witness set pins this.
- **The Hammerfest Basin point (22, 71.5) renders land at `224-203`, `166-146`,
  `117-94` and `94-81`** — more often than the high it flanks. Any future
  `add-land` over the Loppa crest must not be argued from its neighbour.
- **Svalbard (16, 78) is `neither` at `135-117`**, the only `neither` among the
  54 point×interval cells measured here. That is the withheld-`m`/source-hole/
  off-crust field again, in a fourth location.

## A.3 Sources retrieved

| Source | What it states | Enough for the op? |
|---|---|---|
| Marín, Escalona, Grundvåg, Nøhr-Hansen & Kairanov 2018, *Mar. Pet. Geol.* 94, 212–229, [doi:10.1016/j.marpetgeo.2018.04.009](https://doi.org/10.1016/j.marpetgeo.2018.04.009) | *Verbatim* (abstract): "we investigate the Loppa High, an ancient tilted **rift shoulder**"; "during the Boreal Berriasian/Volgian to early Barremian … Diachronous shallow to eventually deep-marine fans and **incised valleys** were developed along the southern and western **flanks** of the Loppa High"; "late Barremian–Aptian … A second generation of **incised valleys** and their related shallow-marine fans were formed in the western flank"; "during late Aptian–early Albian the Loppa High and the Hammerfest Basin were **tilted eastwards**" | **Closest yet, still not sufficient.** Incised valleys are subaerially cut, so the statement implies an emergent source area — but it is an abstract, it places the valleys on the *flanks*, and it gives no crest state and no palaeo-shoreline to bound a window with. Reading "incised valleys on the flanks" as "the crest was land" is EarthHistory's inference, which is the step §7.2 refused |
| Indrevær, Gac, Gabrielsen & Faleide 2018, *J. Geol. Soc.* 175, 497–508, [doi:10.1144/jgs2017-063](https://doi.org/10.1144/jgs2017-063) | *Verbatim* (abstract): "heat and fluid influx provided by early Cretaceous rifting could trigger density reduction and **surface uplift**"; the present geometry is reproduced "by combining the modelled effect of **rift flank uplift** and phase changes in the mafic body" | No. Surface uplift, modelled; no sea-level datum, no exposure |
| Indrevær, Gabrielsen & Faleide 2017, *J. Geol. Soc.* 174, 242–254, [doi:10.1144/jgs2016-066](https://doi.org/10.1144/jgs2016-066) (open access, [hdl:10852/59424](http://hdl.handle.net/10852/59424)) | the held source: early Barremian (c. 131 Ma) initiation of uplift, inversion "in or near pre-existing extensional boundary faults along the **margins** of the Loppa High" | No — this is the margin-inversion statement §7.2 already rejected. The repository copy now resolves to an NVA landing page that served no PDF in this run |
| Brunstad & Rønnevik 2023, "Loppa High Composite Tectono-Sedimentary Element, Barents Sea", *Geol. Soc. London, Memoirs* 57, 378–397, [doi:10.1144/m57-2020-3](https://doi.org/10.1144/m57-2020-3) | *Verbatim* (abstract): "Today the Loppa High is one of the most studied areas of the Barents Shelf … This chapter summarizes the tectonosedimentary and subregional development, and the petroleum geology of the Loppa High" | Unknown — **the single most likely carrier of the missing sentence.** Not open access; the Lyell Collection returned HTTP 403 in this run |

## A.4 Verdict A

**HELD. No `barents-loppa` contract, no operation.** The 2017 hold stands, and
it now stands on a sharper line than before: the literature says *uplift*
(Indrevær 2017, 2018) and *subaerial drainage on the flanks* (Marín 2018), and
none of the four sources says the crest stood above sea level.

**What would unlock it**, precisely: one sentence, from Brunstad & Rønnevik 2023
or from the Marín et al. 2018 full text, stating that the Loppa High was
subaerially exposed / emergent / an island, or that a sub-Cretaceous
unconformity truncates its crest, with an age inside 135–117 Ma. With that, the
op §9.2 already drafted — `add-land` over 19.5–22.5 E, 71.4–72.6 N at `135-117`,
`uncertaintyKm` 60 — becomes writable. Without it, the coeval Kolmule Formation's
"open marine environments" across the region stands unopposed.

**A second constraint the drafted op must respect.** Marín et al. place the
high's eastward tilt and burial in the **late Aptian–early Albian**, i.e. at the
young end of `135-117` and inside `117-94`. The shipped map already renders land
at 17 of 45 box samples at `117-94` (none on the crest). An `add-land` at
`135-117` therefore has to be argued as the *older* state, and must not be
extended into `117-94` on the same citation.

---

# B. The Tunguska at 359–338 (Tournaisian–Viséan)

## B.1 Measured at HEAD

| Point | 402–380 | 380–359 | **359–338** | 338–323 | 323–296 |
|---|---|---|---|---|---|
| (100, 62) | `lm`+`sm` → land | `lm`+`sm` → land | **`sm`** | `lm`+`sm` → land | `sm` |
| (105, 60) | `lm`+`sm` → land | `lm`+`sm` → land | **`sm`** | `lm`+`sm` → land | `sm` |
| (95, 65) | `sm` | `sm` | **`sm`** | `lm`+`sm` → land | `sm` |
| (110, 58) | `lm`+`sm` → land | `lm`+`sm` → land | **`lm`+`sm` → land** | `lm`+`sm` → land | `lm` |

**Measured**, box 92–115 E, 56–70 N on a 1° grid at `359-338` (n = 360), with
what each class set renders as under the stacking contract:

| Class set | cells | renders as | geographic extent of the cells |
|---|---:|---|---|
| `sm` | 280 | shallow sea | the whole box except the two blocks below |
| `lm`+`sm` | 52 | land | a contiguous SE block, lon 105–115 E, lat 56–61 N (plus 4 outliers at 92–95 E, 57–58 N) |
| `sm`+`m` | 23 | **mountain** | a WNW belt, lon 92–101 E, lat 58–62 N |
| `lm`+`sm`+`m` | 5 | **mountain** | lon 94 E and 113–115 E, lat 56–57 N |

**Inference, and it corrects the inland-sea memo.** §11 reported "at 359–338
almost the whole box is `sm`, with `lm`+`sm` only in the far east". That is true
of the *class union* but understates what the browser draws: **28 of 360 cells
carry the mountain class and render as emergent orogen** along the Yenisey
Ridge / Baikit flank, and the eastern land block is a coherent 52-cell body, not
a fringe. The contested area is 280 cells of open shallow sea, not 360.

## B.2 Sources retrieved

| Source | What it states | Enough for the op? |
|---|---|---|
| USGS Professional Paper 1824-U, *Tunguska Basin Province* ([doi:10.3133/pp1824u](https://doi.org/10.3133/pp1824u)); PDF retrieved 2026-09-15 from <https://pubs.usgs.gov/pp/1824/u/pp1824u.pdf>, 2,268,345 bytes, sha256 `e23679e49b8b3fde3228006fc9e01b63a26c424ddac203c255c23c5dba9881f2` | *Verbatim*: "Younger Paleozoic rocks are **absent** across most of the Siberian craton because of **nondeposition and erosion** (Ulmishek, 2001a). The southern and interior parts of the craton **remain elevated**." Also: "Silurian and younger Paleozoic rocks thin upward or are absent (fig. 3)"; "The margins of the craton remained passive during the late Paleozoic … thick successions of deltaic, paralic, nearshore marine, and submarine fan strata were deposited **along the margins**" | **No.** The first half is a missing-section statement; the second is an emergence statement with no age inside the Palaeozoic and no coordinates. See B.3 |
| Davydov 2021, "Tunguska coals, Siberian sills and the Permian-Triassic extinction", *Earth-Science Reviews* 212, 103438, [doi:10.1016/j.earscirev.2020.103438](https://doi.org/10.1016/j.earscirev.2020.103438) | a modern, Tunguska-specific review; *Verbatim* (abstract) concerns "the coal geology in Tunguska Basin, i.e. spatial and temporal distribution of coals, coal metamorphism", the sills and the PTB extinction | No — the modern Tunguska review exists, but its subject is the Permian coal succession, not Mississippian palaeogeography |
| Mashchuk & Frolov 2022, *Phytotaxa* 576, 227–232, [doi:10.11646/phytotaxa.576.2.9](https://doi.org/10.11646/phytotaxa.576.2.9) | *Verbatim* (abstract): a megaspore genus "found in the **Middle Carboniferous sediments (Bashkirian age)** of the Tunguska Basin, Russia" | No — modern primary evidence that the Tunguska succession is continental, but in the **Bashkirian** (~323–315 Ma), which falls in `323-296`, one to two bins younger than the contested one |
| Cocks & Torsvik 2007, "Siberia, the wandering northern terrane, and its changing geography through the Palaeozoic", *Earth-Science Reviews* 82, 29–74, [doi:10.1016/j.earscirev.2007.02.001](https://doi.org/10.1016/j.earscirev.2007.02.001) | the review this question asks for | **Not read.** Unpaywall reports `is_oa: false`; neither Crossref nor Semantic Scholar carries its abstract; no open copy was located in this run. Recorded as the named next step |

## B.3 Verdict B

**HELD. No operation; recorded as a limitation.** Three reasons, and the second
is the one that matters most to the project's rules.

1. **No modern review supporting a basin-scale mismatch was actually read.** The
   two modern Tunguska-specific publications retrieved (Davydov 2021,
   Mashchuk & Frolov 2022) address the Permian coals and the Bashkirian flora.
   Neither constrains the Tournaisian–Viséan. Cocks & Torsvik 2007 is the right
   source and is paywalled.
2. **The strongest statement retrieved is a hiatus statement, and the project's
   own rule forbids converting it.** "Younger Paleozoic rocks are absent …
   because of nondeposition and erosion" is exactly the form the shelf-checks
   memo rejected for the Nordland Ridge and the Loppa High. The rule cuts the
   same way when the proposed change is a **removal** of sea rather than an
   addition of land: a starved or eroded *submerged* platform satisfies
   "nondeposition and erosion" as well as dry land does. "The southern and
   interior parts of the craton remain elevated" is a positive emergence claim,
   but it carries no age within the Palaeozoic and its named area — southern and
   interior — is not the 95–110 E / 58–65 N sample set.
3. **Scale.** The op would remove `sm` from ~280 one-degree cells, the largest
   single geometry change contemplated anywhere in this program. Its stop rule
   should be a review actually read, never a figure reference in a 1985
   open-file report.

**Limitation to state, not to fix by invention:** at `359-338` the shipped map
paints open shallow sea across the central Siberian platform; the literature
retrieved so far places the Mississippian sea in the Yenisey-Khatanga low to the
north and leaves the interior's state undated. The class is not editable until
Cocks & Torsvik 2007 (or an equivalent modern regional review) is read.

---

# C. Witnesses

Positions, intervals and **expected class sets as measured at HEAD
`49ccb43`**. All nine lock today's payload: none of them asserts a state the
source cannot render, and none of them is an `sm` membership test.
`WITNESS_INTERVALS` in `scripts/research/palaeo_coastlines_correction.py` must
gain `135-117`, `166-146`, `117-94` and `359-338` for these to run; `94-81` and
`248-224` are already in the tuple.

| Witness id | Position (lon, lat) | Interval | Expected classes | Why it must not drift |
|---|---|---|---|---|
| `loppa-high-early-cretaceous-marine` | (20.546, 72.057) | `135-117` | `["sm"]` | the held op's own target. If a future compile turns the Alta position to land, that happened without the crest-exposure source A.4 names |
| `loppa-crest-late-jurassic-island` | (21.0, 72.0) | `166-146` | `["lm","sm"]` | the map's own latest-Jurassic emergent crest, unwitnessed until now, and the only interval in which the crest and the drilled points disagree |
| `loppa-crest-early-cretaceous-marine` | (21.0, 72.0) | `135-117` | `["sm"]` | the crest control for the same op; paired with the row above it fixes the drowning to the `166-146`/`146-135` step |
| `bjarmeland-platform-early-cretaceous` | (30.0, 73.0) | `135-117` | `["sm"]` | the eastern negative control: a Loppa op must change the high, not the platform |
| `hammerfest-basin-albian-land` | (22.0, 71.5) | `117-94` | `["lm"]` | the neighbouring basin already renders land in the bin *after* the held op's; recording it stops that being read as support for the op |
| `tunguska-mississippian-sea` | (100, 62) | `359-338` | `["sm"]` | the contested state itself. Witnessing it is what keeps the B.3 limitation visible instead of quietly changing |
| `tunguska-mississippian-sea-south` | (105, 60) | `359-338` | `["sm"]` | second point in the contested body |
| `tunguska-mississippian-north` | (95, 65) | `359-338` | `["sm"]` | the northern point, toward the Yenisey-Khatanga low where the 1985 report *does* put a seaway. Any future removal must spare it, and this row is what would catch a blanket removal |
| `tunguska-mississippian-east` | (110, 58) | `359-338` | `["lm","sm"]` | the eastern land block. Paired with (100, 62) it pins the east–west boundary of the contested sea to the 105–107 E band |

Two further measurements are recorded here without a witness, because neither is
a stable statement the project wants to lock: Svalbard (16, 78) is `neither` at
`135-117`, and the `359-338` Tunguska box carries 28 mountain-rendering cells at
92–101 E, 58–62 N. Both belong to the open global `m`-only exposure question.

---

## Reproduction

```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
git archive 49ccb43 public/data/reconstruction/cao-v2.4/palaeo-coastlines | tar -x -C <scratch>
$PY <scratch>/probe.py    # imports palaeo_coastlines_compile read-only;
                          # decode_ehpr + piece_geometry, unary_union per class,
                          # shapely contains() at the points and grids above
```

Sources were retrieved on 2026-09-15 through the Crossref, Unpaywall, Semantic
Scholar Graph and OpenAIRE APIs and from `pubs.usgs.gov`; the Lyell Collection
(Brunstad & Rønnevik 2023) and ScienceDirect (Marín et al. 2018 full text)
refused access, and both are named above as the specific unread items.
