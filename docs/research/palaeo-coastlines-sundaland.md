# Sundaland and the South China Sea margin, Cenozoic: expectation vs. the shipped Cao v2.4 payloads

Item 12e-Sundaland. Scope: ten present-day sites across the Sunda Shelf, its
marginal basins and the Makassar Strait, over the six Cenozoic Cao intervals
`58-49`, `49-37`, `37-29`, `29-20`, `20-11`, `11-2`, plus the shipped `lgm`
lowstand state. Everything below is a read of the promoted payloads; nothing in
`public/`, `data/corrections/` or `src/` was changed.

## Probe provenance

| Item | Value |
|---|---|
| Commit probed | `49ccb43551c9abb3b0b9e27b09dc6c7af279d978` (branch `codex/palaeo-coastlines`) |
| Payload path | `public/data/reconstruction/cao-v2.4/palaeo-coastlines/{lm,sm,m}/` at that commit, read via `git show HEAD:…` |
| Method | `decode_ehpr` + `piece_geometry` from `scripts/research/palaeo_coastlines_compile.py`, imported read-only under the pygplates venv; `Polygon.covers(Point)` on present-day WGS84 coordinates (EHPR vertices are present-day; binding rotates at render time) |
| Nearest-km column | planar distance ×111.195 km/° from the point to the nearest piece of that class |
| Scratch | `scratchpad/sundaland/{probe.py,grid.py,grid2.py,probe.json,payload/}` (scratch tier; not durable) |

sha256 (first 16 hex) of every payload read:

| File | sha256[0:16] | File | sha256[0:16] |
|---|---|---|---|
| `lm/palaeo-lm-58-49.ehpr` | `d59f538a2258d1af` | `sm/palaeo-sm-58-49.ehpr` | `41ac31de101dccdf` |
| `lm/palaeo-lm-49-37.ehpr` | `a1b5d909d87445f7` | `sm/palaeo-sm-49-37.ehpr` | `fe23598070ecbdfd` |
| `lm/palaeo-lm-37-29.ehpr` | `bd32467cf40ad153` | `sm/palaeo-sm-37-29.ehpr` | `bc4d0e52d3516202` |
| `lm/palaeo-lm-29-20.ehpr` | `1adce26ea8ec7fe0` | `sm/palaeo-sm-29-20.ehpr` | `dbf9f2b601cef54f` |
| `lm/palaeo-lm-20-11.ehpr` | `3a22d3af9f951cdf` | `sm/palaeo-sm-20-11.ehpr` | `5d8dab9df0a1d50f` |
| `lm/palaeo-lm-11-2.ehpr` | `19e453237230fd84` | `sm/palaeo-sm-11-2.ehpr` | `f5e4420f2c500009` |
| `lm/palaeo-lm-lgm.ehpr` | `b946c1a4c5cd9d69` | `lm/palaeo-lm-catalog.json` | `4002ab226c3deb70` |
| `m/palaeo-m-58-49.ehpr` | `c842b67c18cf7751` | `m/palaeo-m-49-37.ehpr` | `422a7c4388060085` |
| `m/palaeo-m-37-29.ehpr` | `07fb0fffd771f3a3` | `m/palaeo-m-29-20.ehpr` | `c0836079015a4111` |
| `m/palaeo-m-20-11.ehpr` | `0d727437342903ad` | `m/palaeo-m-11-2.ehpr` | `964f43e6e0eeb308` |
| `sm/palaeo-sm-catalog.json` | `7232eea4537805e1` | `m/palaeo-m-catalog.json` | `9fbda74f87faf25c` |

## What the Cao bins can and cannot carry here

| Bin | SE Asian stages it merges | Consequence |
|---|---|---|
| `58-49` | Paleocene – earliest Eocene | Pre-rift Sundaland; the Middle Eocene rift onset (~45 Ma) is *outside* this bin |
| `49-37` | Ypresian – Priabonian | Middle Eocene rifting, the Makassar Strait opening and the Middle Eocene transgression all fall inside one bin with the pre-rift Early Eocene |
| `37-29` | Priabonian – Rupelian | The Sarawak Orogeny (~37 Ma) sits on the old edge; the Oligocene carbonate platforms fill the bin |
| `29-20` | Chattian – Aquitanian | South China Sea spreading (32–15.5 Ma) is mid-bin; Malay/Natuna syn-rift lacustrine fill is still non-marine |
| `20-11` | Burdigalian – Tortonian | The Middle Miocene marine incursion into the Malay, Penyu, W Natuna and Nam Con Son basins is a late-bin event; Central Luconia carbonates and Mahakam/Baram delta progradation (~15 Ma) start mid-bin |
| `11-2` | Tortonian – Gelasian | Sundaland inversion and uplift, delta progradation, and the first Plio-Pleistocene lowstands all in one bin |

Hard vocabulary limits, to be stated and never "fixed" by invention:

1. **There is no lake class.** The Eocene–Oligocene syn-rift fill of the Malay,
   Penyu, West Natuna, Cuu Long and Nam Con Son basins is thick *lacustrine*
   section, not marine and not dry land. It renders as `lm` because `lm` is the
   only non-marine class. That is the closest available bin, not a claim of
   subaerial exposure. This is the largest epistemic gap in this item.
2. **`sm` is an environment class, not a water depth** (already stated for the
   Frigg fans in `src/data/sources.ts`). Cao has no deep-marine class: deep
   water renders as the *absence* of any class. So `sm` over the >2,000 m
   Makassar Strait is a limitation; `lm` over it is a positive emergence claim
   and therefore checkable.
3. **~30 km class floor.** A point-probe miss of a few km on the Sarawak or
   Nam Con Son shelf is the floor, not a defect.
4. **Cao 2017 = minimum land / maximum flooding per bin.** A site flooded for
   any part of a bin should carry `sm`. This is the only test that makes a
   missing-`sm` verdict a defect rather than a phase difference.
5. **The `lgm` payload carries the exposed shelf only** (ETOPO −120 m minus the
   Natural Earth 50 m land). Points on modern land return no class there by
   design; that is not a gap.

## Expectation per site per interval

`land` = emergent or non-marine (incl. lake, unrenderable); `sm` = marine water
body Cao could render; `deep` = water too deep for the shallow-marine class, so
the correct shipped state is *no class*.

| Site (lon, lat) | 58–49 | 49–37 | 37–29 | 29–20 | 20–11 | 11–2 |
|---|---|---|---|---|---|---|
| Sunda core (105, 2) | land | land | land | land | land | land |
| Malay Basin (104, 6) | land | land (lake) | land (lake) | land (lake) | land → sm late-bin | sm |
| W Natuna (108, 4) | land | land (lake) | land (lake) | land (lake) | land → sm late-bin | sm |
| Nam Con Son (109, 8) | land | land | land | land (lake) | sm (from ~20 Ma) | sm |
| Sarawak / Baram (113, 4.5) | deep (Rajang trough) | deep | sm (Cycle I–II shelf) | sm | sm (Luconia carbonates) | sm |
| Kutei (117.5, −0.5) | land (pre-rift) | sm (transgression ~45 Ma) | sm | sm | sm | land (Mahakam delta plain) |
| Makassar Strait (118.5, −2) | land / shallow (pre-rift) | deep (rifting, opening) | deep | deep | deep | deep |
| Java Sea (110, −5) | land (Karimunjawa–Bawean arch) | land | land | land | sm | land |
| Borneo interior (114, 1) | deep (Rajang trough) | deep | land (Sarawak Orogeny ~37 Ma) | land | land + mountain | land + mountain |
| Mekong delta (106, 10) | land | land | land | land (lake) | sm | sm |

## Verdict table (shipped class set at the probe point)

| Site | 58–49 | 49–37 | 37–29 | 29–20 | 20–11 | 11–2 |
|---|---|---|---|---|---|---|
| Sunda core (105, 2) | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** |
| Malay Basin (104, 6) | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm,sm]` **PASS** | `[sm]` **PASS** |
| W Natuna (108, 4) | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]`, sm 37 km **PARTIAL** | `[sm]` **PASS** |
| Nam Con Son (109, 8) | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[]`, lm 13 km **PARTIAL** | `[]`, sm 0.9 km **PARTIAL** | `[sm]` **PASS** |
| Sarawak / Baram (113, 4.5) | `[]` **PASS** | `[]` **PASS** | `[sm]` **PASS** | `[sm]` **PASS** | `[]`, sm 26 km **PARTIAL** | `[lm]`, sm 2.6 km **PARTIAL** |
| Kutei (117.5, −0.5) | `[sm]` **PARTIAL** | `[sm]` **PASS** | `[sm]` **PASS** | `[sm]` **PASS** | `[sm]` **PASS** | `[lm]` **PASS** |
| Makassar Strait (118.5, −2) | `[sm]` **PARTIAL** | `[lm]` **FAIL** | `[sm]` **PASS** (depth limit) | `[sm]` **PASS** (depth limit) | `[sm]` **PASS** (depth limit) | `[sm]` **PASS** (depth limit) |
| Java Sea (110, −5) | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[sm]` **PASS** | `[lm]` **PASS** |
| Borneo interior (114, 1) | `[]`, sm 0.1 km **PASS** | `[sm]` **PASS** | `[lm,sm]` **PASS** | `[lm]` **PASS** | `[lm,m]` **PASS** | `[lm,m]` **PASS** |
| Mekong delta (106, 10) | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[lm]` **PASS** | `[sm]` **PASS** | `[lm]`, sm 24 km **PARTIAL** |

Tally: **51 PASS, 8 PARTIAL, 1 FAIL** over 60 verdicts. The shipped payload
reproduces the Sundaland story remarkably well: an emergent low-relief core
through the whole Cenozoic, non-marine marginal basins until the Middle
Miocene, the Rajang deep-marine trough closing at the Sarawak Orogeny, and
central Borneo rising into `lm`+`m` in the Neogene.

## Supporting grids (why the Makassar verdict is basin-scale, not a point miss)

`49-37`, 0.5° grid, `LM` = land present at the cell. Columns 117.0 → 119.5 °E:

| lat | 117.0 | 117.5 | 118.0 | 118.5 | 119.0 | 119.5 |
|---|---|---|---|---|---|---|
| −1.0 | sm | sm | sm | **LM** | **LM** | sm |
| −1.5 | sm | sm | **LM** | **LM** | **LM** | sm |
| −2.0 | sm | sm | **LM** | **LM** | **LM** | sm |
| −2.5 | sm | **LM** | **LM** | **LM** | sm | sm |
| −3.0 | sm | sm | **LM** | **LM** | sm | sm |
| −3.5 | sm | sm | **LM** | **LM** | sm | sm |
| −4.0 | **LM** | **LM** | **LM** | **LM** | sm | — |
| −4.5 | **LM** | **LM** | **LM** | sm | sm | — |

A continuous emergent block roughly 150 km wide and 400 km long sits on the
axis of the South Makassar Basin, where present bathymetry exceeds 2,000 m and
where the Middle–Late Eocene section is a rapidly subsiding, deepening rift
fill. No probed point inside that block carries `sm`, so this is a land claim,
not a class-floor artifact. At every younger interval the same ground is `sm`
(a depth limitation, not a defect), so the mismatch is confined to `49-37`.

`11-2`, Sarawak shelf, columns 112.5 → 115.5 °E (M = mountain also present):

| lat | 112.5 | 113.0 | 113.5 | 114.0 | 114.5 | 115.0 | 115.5 |
|---|---|---|---|---|---|---|---|
| 5.0 | sm | sm | sm | sm | sm | **LM** | LM M |
| 4.5 | sm | **LM** | **LM** | **LM** | **LM** | **LM** | LM M |
| 4.0 | **LM** | **LM** | **LM** | **LM** | **LM** | LM M | LM M |
| 3.5 | **LM** | **LM** | **LM** | LM M | LM M | LM M | LM M |

Cao's `11-2` land reaches about 145 km offshore of the modern Sarawak coast
across the Central Luconia province, where Cycle IV–VIII carbonate buildups and
the prograding Baram delta record continuous marine deposition. Under a
minimum-land reading of the bin this should be `sm`. Recorded as OP-2, at lower
confidence than OP-1 (see caveat).

## Other probed controls

| Point | Interval | Shipped | Reading |
|---|---|---|---|
| Penyu Basin (103.5, 4.5) | `20-11` / `11-2` | `[lm]` / `[sm]` | same late-bin marine incursion as the Malay Basin; consistent |
| Cuu Long (107.5, 9.5) | `29-20` / `20-11` | `[lm]` / `[sm]` | syn-rift lacustrine then Miocene marine; textbook match |
| N Makassar (118.5, 0) | `49-37` | `[sm]` | the `49-37` land block does **not** reach the North Makassar Basin |
| S Makassar (118, −4) | `49-37` | `[lm]` | inside the block; confirms its southern reach |
| Paternoster (116.5, −4) | `49-37` | `[lm]` | shallow carbonate platform; land here is defensible, so OP-1 stops west of 117.3 °E |
| Baram / Brunei (114.5, 5) | `20-11` / `11-2` | `[sm]` / `[sm]` | the Baram delta front is correctly marine; the `11-2` land block lies west of it |
| Sarawak shelf outboard (114.5, 6) | `20-11` | `[sm]` | outer shelf marine; the `20-11` miss at (113, 4.5) is a deep-gap edge, ~26 km |
| Central Borneo (114, 0) | `20-11` / `11-2` | `[lm]` / `[lm]` | Central Range emergent; consistent |
| Gulf of Thailand (101.5, 9) | `20-11` / `11-2` | `[lm]` / `[sm]` | northern Malay Basin flooding arrives from the north; consistent |

## LGM consistency check (`lgm`, 0.021 Ma, `lm` only)

| Point | Shipped | Expected (Sathiamurthy & Voris 2006, −120 m) | Verdict |
|---|---|---|---|
| Sunda core (105, 2) | `[lm]` | exposed shelf | **PASS** |
| Makassar Strait (118.5, −2) | `[]`, lm 69 km | marine — the strait never closes | **PASS** |
| N Makassar (118.5, 0) | `[]`, lm 72 km | marine | **PASS** |
| S Makassar (118, −4) | `[]`, lm 51 km | marine | **PASS** |
| Malay (104, 6), W Natuna (108, 4), Java Sea (110, −5), Karimata (108.5, −1.5), Penyu, Cuu Long, Gulf of Thailand, Mekong offshore, Sarawak (113, 4.5), Baram (114.5, 5) | `[lm]` | exposed shelf, one Sunda landmass | **PASS** |
| Kutei (117.5, −0.5), Mekong delta (106, 10), Nam Con Son (109, 8) | `[]`, lm 1.4 / 7.4 / 8.2 km | on or beside modern land | **PASS** (exposed-shelf-only payload) |
| Borneo interior (114, 1), Sumatra backbone (101, −1), Schwaner (111, −1.5) | `[]` | modern land, not exposed shelf | **PASS** (by design) |

The shipped LGM state is internally consistent with the Neogene intervals and
with `hall-2009-sundaland`'s constraint that the Makassar Straits "were never
narrower than about 75 km": the 69–72 km nearest-land figures sit just inside
that number and nothing closes the strait.

## Findings and proposed work

### OP-1 — proposed. South Makassar Basin, Middle–Late Eocene, `49-37`

The one FAIL. A basin-scale emergent block over a rift basin that was opening
and deepening through exactly this bin, and the one place in this item where
Cao makes a positive land claim the literature contradicts outright. It also
sits on Wallace's Line, so the error is biogeographically load-bearing.

| Field | Value |
|---|---|
| File | `data/corrections/palaeo-coastlines/basins/makassar-strait.json` (new) |
| Intervals | `49-37` only (single, contiguous) |
| Op A | `remove-land` |
| Op B | `add-shallow`, identical footprint (required companion: no `sm` lies beneath the land being removed — nearest `sm` is 69.8 km) |
| Footprint, in words | The axis of the South Makassar Basin from about 117.3 °E to 119.3 °E and from about 1.0 °S to 4.6 °S, bounded west by the eastern edge of the Paternoster carbonate platform (which stays land), east by the West Sulawesi margin at about 119.3 °E, and north by the already-`sm` North Makassar Basin at about 1.0 °S |
| `uncertaintyKm` | 40 |
| `rationale` | The Makassar Strait opened by Middle Eocene extension of Sundaland's SE margin and was a deepening marine basin, not land, through the Middle and Late Eocene; it has never closed and never narrowed below about 75 km. Cao 2017 renders its southern axis as continuous land through `49-37`, which contradicts a minimum-land reading of that bin. |
| `editorial` | `"EarthHistory modification after Hall 2012, Hall et al. 2009 and Hall 2013"` |
| Residual limitation | `add-shallow` is the contract-mandated companion, but the true state is deep marine. The layer has no deep class, so the op trades a false land claim for a declared depth limitation. State it; do not widen the op. |

### OP-2 — proposed, lower confidence. Central Luconia, `11-2`

| Field | Value |
|---|---|
| File | `data/corrections/palaeo-coastlines/basins/sarawak-luconia.json` (new) |
| Intervals | `11-2` only |
| Op A / B | `remove-land` + `add-shallow` companion |
| Footprint, in words | The Central Luconia carbonate province offshore Sarawak, about 112.4 °E to 115.0 °E and about 3.8 °N to 5.0 °N, bounded south by the Cao `11-2` mountain polygon over the Rajang fold belt (which is not touched and would occlude any edit south of about 3.6 °N) and north by the existing `sm` shelf |
| `uncertaintyKm` | 50 |
| `rationale` | Cycle IV–VIII carbonate buildups of Central Luconia and the prograding Baram delta record continuous marine deposition on the Sarawak shelf through the Late Miocene and Pliocene. Cao 2017 carries land about 145 km offshore of the modern coast through `11-2`. |
| `editorial` | `"EarthHistory modification after Hall et al. 2008 and Morley 2012"` |
| Caveat | `11-2` reaches 2.01 Ma and the first Plio-Pleistocene lowstands did expose parts of this shelf. The op rests on the minimum-land / maximum-flooding reading of the bin. If the coordinator does not accept that reading here, this is a limitation, not a defect, and OP-2 should be dropped. OP-1 does not depend on it. |

### References for OP-1 and OP-2 (all DOIs resolved against Crossref, 2026-09-15)

| id | DOI | Citation | Constrains | Kind |
|---|---|---|---|---|
| `hall-2012-indonesia-reconstructions` | `10.1016/j.tecto.2012.04.021` | Hall, R. (2012) Late Jurassic–Cenozoic reconstructions of the Indonesian region and the Indian Ocean. *Tectonophysics* 570–571, 1–41. | Makassar Strait opening age and Cenozoic Sundaland geometry | claim |
| `hall-2009-north-makassar` | `10.1144/1354-079309-829` | Hall, R., Cloke, I.R., Nur'aini, S., Puspita, S.D., Calvert, S.J. & Elders, C.F. (2009) The North Makassar Straits: what lies beneath? *Petroleum Geoscience* 15, 147–158. | thinned-crust, deep-marine Eocene section of the Makassar Straits | claim |
| `hall-2013-sundaland-palaeogeography` | `10.4081/jlimnol.2013.s2.e1` | Hall, R. (2013) The palaeogeography of Sundaland and Wallacea since the Late Jurassic. *Journal of Limnology* 72(s2), 1–17. | Cenozoic Sundaland land/sea distribution and the Wallacea barrier | claim |
| `hall-2008-borneo` | `10.1016/j.tecto.2007.11.058` | Hall, R., van Hattum, M.W.A. & Spakman, W. (2008) Impact of India–Asia collision on SE Asia: The record in Borneo. *Tectonophysics* 451, 366–389. | Sarawak Orogeny timing, Borneo uplift, Sarawak shelf deposition | claim |
| `morley-2012-se-asia-tectonics` | `10.1016/j.earscirev.2012.08.002` | Morley, C.K. (2012) Late Cretaceous–Early Palaeogene tectonic development of SE Asia. *Earth-Science Reviews* 115, 37–75. | rift-basin onset and non-marine syn-rift fill of the Sunda basins | claim |
| `hall-morley-2004-sundaland-basins` | `10.1029/149GM04` | Hall, R. & Morley, C.K. (2004) Sundaland basins. In *Continent-Ocean Interactions within East Asian Marginal Seas*, AGU Geophys. Monogr. 149, 55–85. | Malay, Penyu, W Natuna, Cuu Long, Nam Con Son and Kutei basin histories | claim |
| `zahirovic-2016-eastern-tethys` | `10.1016/j.earscirev.2016.09.005` | Zahirovic, S., Matthews, K.J., Flament, N., Müller, R.D., Hill, K.C., Seton, M. & Gurnis, M. (2016) Tectonic evolution and deep mantle structure of the eastern Tethys since the latest Jurassic. *Earth-Science Reviews* 162, 293–337. | independent SE Asian plate-kinematic frame; consistency check only | inference |
| `hall-2002-se-asia` | `10.1016/S1367-9120(01)00069-4` | Hall, R. (2002) Cenozoic geological and plate tectonic evolution of SE Asia and the SW Pacific. *J. Asian Earth Sci.* 20, 353–431. | the reconstruction series the above refine | claim |
| `hall-2009-sundaland` | `10.3767/000651909X475941` | Hall, R. (2009) Southeast Asia's changing palaeogeography. *Blumea* 54, 148–161. | Makassar Straits never narrower than ~75 km; already in `src/data/sources.ts` | claim |

Blocker to clear before either op is written: **eight of these nine ids do not
exist in `src/data/sources.ts`** — only `hall-2009-sundaland` is present (a
grep for `Hall|Morley|Sunda|Makassar|Borneo|Zahirovic|Luconia|Natuna|Kutei`
over its 175 entries returns that one entry plus unrelated hits). The basin
edit contract requires every reference id to live there first, so both ops need
a coordinator-approved `sources.ts` addition ahead of the basin files.
Sathiamurthy & Voris (2006), *Nat. Hist. J. Chulalongkorn Univ.* Suppl. 2,
1–43, has no DOI and is used here only to state the LGM expectation; it is not
needed by either op.

### Open, not proposed as ops

| # | Finding | Why no op |
|---|---|---|
| F-1 | The Eocene–Oligocene syn-rift fill of the Malay, Penyu, W Natuna, Cuu Long and Nam Con Son basins is lacustrine, and ships as `lm` | There is no lake class. This is the single largest epistemic gap in item 12e and belongs in the map key, not in an edit. |
| F-2 | The Makassar Strait ships as `sm` at `37-29`, `29-20`, `20-11` and `11-2` over >2,000 m of water | `sm` is an environment class, not a depth; Cao has no deep-marine class. Declared limitation, not a defect. Removing the `sm` would leave bare crust, which is worse. |
| F-3 | Nam Con Son (109, 8) returns neither class at `29-20` (lm 13 km) and `20-11` (sm 0.9 km) | Sub-class-floor gaps at one coordinate; both neighbouring classes are within the ~30 km floor. Move the witness point, do not edit the data. |
| F-4 | Sarawak (113, 4.5) returns neither class at `20-11`, sm 26 km | The Cao deep-gap edge oversteps the Luconia shelf by roughly 30–50 km. Placing that edge better needs digitised Cycle isopachs; proposing a footprint now would be false precision. |
| F-5 | Kutei (117.5, −0.5) and Makassar (118.5, −2) already carry `sm` at `58-49`, one bin before the ~45 Ma rift onset | A phase-in-bin effect at the old edge of a maximum-flooding bin, not a defect. Cao's own map interval starts at 58 Ma. |
| F-6 | W Natuna (108, 4) is `lm` at `20-11` with `sm` 37 km away | The West Natuna marine incursion is a late-bin (Middle–Late Miocene) event and the miss is barely outside the class floor. Reads as phase-in-bin. |
| F-7 | Mekong delta (106, 10) is `lm` at `11-2` with `sm` 24 km | Shoreline placement inside the class floor; the modern delta is Holocene, so the Late Miocene shoreline there is genuinely uncertain at this scale. |
| F-8 | Cao mountain polygons cover parts of the Sarawak fold belt and central Borneo at `20-11` and `11-2`, rendering above any `sm` beneath | The edit contract has no mountain op. Limitation for the key; it also bounds OP-2's southern edge. |

## Proposed witnesses

Format `(name, (lon, lat), interval, expected class set)`. Rows 1–14 assert the
shipped state and pass at `49ccb43` today; rows 15–16 flip only when OP-1 and
OP-2 land.

| # | name | point | interval | classes |
|---|---|---|---|---|
| 1 | Sundaland emergent core Eocene | (105.0, 2.0) | `49-37` | `["lm"]` |
| 2 | Sundaland emergent core late Miocene | (105.0, 2.0) | `11-2` | `["lm"]` |
| 3 | Sundaland emergent core LGM | (105.0, 2.0) | `lgm` | `["lm"]` |
| 4 | Malay Basin syn-rift non-marine | (104.0, 6.0) | `29-20` | `["lm"]` |
| 5 | Malay Basin Pliocene marine | (104.0, 6.0) | `11-2` | `["sm"]` |
| 6 | Nam Con Son Pliocene marine | (109.0, 8.0) | `11-2` | `["sm"]` |
| 7 | Rajang trough deep marine | (114.0, 1.0) | `58-49` | `[]` |
| 8 | Borneo interior post-Sarawak-Orogeny land | (114.0, 1.0) | `29-20` | `["lm"]` |
| 9 | Borneo Central Range | (114.0, 1.0) | `11-2` | `["lm","m"]` |
| 10 | Sarawak shelf Oligocene | (113.0, 4.5) | `29-20` | `["sm"]` |
| 11 | Kutei marine Eocene transgression | (117.5, −0.5) | `49-37` | `["sm"]` |
| 12 | Mahakam delta plain | (117.5, −0.5) | `11-2` | `["lm"]` |
| 13 | Makassar Strait open Neogene | (118.5, −2.0) | `20-11` | `["sm"]` |
| 14 | Makassar Strait marine at LGM | (118.5, −2.0) | `lgm` | `[]` |
| 15 | South Makassar Basin Eocene *(with OP-1)* | (118.5, −2.0) | `49-37` | `["sm"]` |
| 16 | Central Luconia marine *(with OP-2)* | (113.5, 4.5) | `11-2` | `["sm"]` |

`BASIN_EDIT_WITNESSES` pairs:

- OP-1: edited row 15 against unedited control **(116.5, −4.0) `49-37` → `["lm"]`**
  (Paternoster platform, inside the basin window's western margin but outside
  the op footprint), so a footprint that leaks west turns the control red; and
  against row 13, the same point one bin younger, so a footprint that leaks
  into `37-29` is caught by the interval check.
- OP-2: edited row 16 against unedited control **(114.5, 5.0) `11-2` → `["sm"]`**
  (Baram delta front, already `sm`, must stay `sm`) and **(114.0, 3.0) `11-2` →
  `["lm","m"]`** (Rajang fold belt, must keep its land and mountain).

Rows 4 and 8 carry a mandatory epistemic note where they surface: row 4 is
lacustrine syn-rift section rendered in the only non-marine class available,
not a claim of dry emergent land. Row 14 asserts that the Makassar Strait stays
marine at the LGM, which is the Wallace's Line contract for this layer.

## Sources consulted (all DOIs resolved against Crossref, 2026-09-15)

Hall 2002 (`10.1016/S1367-9120(01)00069-4`); Hall & Morley 2004
(`10.1029/149GM04`); Hall 2009 Blumea (`10.3767/000651909X475941`); Hall et al.
2009 Petroleum Geoscience (`10.1144/1354-079309-829`); Hall, van Hattum &
Spakman 2008 (`10.1016/j.tecto.2007.11.058`); Hall 2012
(`10.1016/j.tecto.2012.04.021`); Hall 2013 (`10.4081/jlimnol.2013.s2.e1`);
Morley 2012 (`10.1016/j.earscirev.2012.08.002`); Zahirovic et al. 2016
(`10.1016/j.earscirev.2016.09.005`); Sathiamurthy & Voris 2006, *Nat. Hist. J.
Chulalongkorn Univ.* Suppl. 2, 1–43 (no DOI; used for the LGM expectation
only). No figure, map or polygon from any of these is reproduced or traced.
