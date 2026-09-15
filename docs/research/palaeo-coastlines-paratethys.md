# Paratethys, Oligocene–Pliocene: expectation vs. the shipped Cao v2.4 payloads

Item 12e-Paratethys. Scope: nine present-day sites across the Central and
Eastern Paratethys and the North Alpine foreland, over the four Cao intervals
`37-29`, `29-20`, `20-11`, `11-2`. Everything below is a read of the promoted
payloads; nothing in `public/` or `data/corrections/` was changed.

## Probe provenance

| Item | Value |
|---|---|
| Commit probed | `49ccb43551c9abb3b0b9e27b09dc6c7af279d978` (branch `codex/palaeo-coastlines`) |
| Payload path | `public/data/reconstruction/cao-v2.4/palaeo-coastlines/{lm,sm,m}/` at that commit |
| Method | `decode_ehpr` + `piece_geometry` from `scripts/research/palaeo_coastlines_compile.py`, imported read-only under the pygplates venv; `Polygon.covers(Point)` on present-day WGS84 coordinates (EHPR vertices are present-day; binding rotates at render time) |
| Nearest-km column | great-circle-approximated planar distance (×111 km/°) from the point to the nearest piece of that class |

sha256 (first 16 hex) of every payload read:

| File | sha256[0:16] | File | sha256[0:16] |
|---|---|---|---|
| `lm/palaeo-lm-37-29.ehpr` | `bd32467cf40ad153` | `sm/palaeo-sm-37-29.ehpr` | `bc4d0e52d3516202` |
| `lm/palaeo-lm-29-20.ehpr` | `1adce26ea8ec7fe0` | `sm/palaeo-sm-29-20.ehpr` | `dbf9f2b601cef54f` |
| `lm/palaeo-lm-20-11.ehpr` | `3a22d3af9f951cdf` | `sm/palaeo-sm-20-11.ehpr` | `5d8dab9df0a1d50f` |
| `lm/palaeo-lm-11-2.ehpr` | `19e453237230fd84` | `sm/palaeo-sm-11-2.ehpr` | `f5e4420f2c500009` |
| `lm/palaeo-lm-49-37.ehpr` | `a1b5d909d87445f7` | `sm/palaeo-sm-49-37.ehpr` | `fe23598070ecbdfd` |
| `m/palaeo-m-37-29.ehpr` | `07fb0fffd771f3a3` | `lm/palaeo-lm-catalog.json` | `4002ab226c3deb70` |
| `m/palaeo-m-29-20.ehpr` | `c0836079015a4111` | `sm/palaeo-sm-catalog.json` | `7232eea4537805e1` |
| `m/palaeo-m-20-11.ehpr` | `0d727437342903ad` | `m/palaeo-m-catalog.json` | `9fbda74f87faf25c` |
| `m/palaeo-m-11-2.ehpr` | `964f43e6e0eeb308` | `m/palaeo-m-49-37.ehpr` | `422a7c4388060085` |

Probe script and extracted payloads: session scratch
`scratchpad/paratethys/{probe.py,probe2.py,payload/}` (scratch tier; not durable).

## What the Cao bins can and cannot carry here

| Bin | Paratethys stages it merges | Consequence |
|---|---|---|
| `37-29` | Priabonian, Rupelian (Kiscellian, Solenovian, lower Maikop) | Late Eocene marine and the Oligocene anoxic Maikop collapse into one maximum-flooding bin; the Turgai closure (~34 Ma) is invisible inside it |
| `29-20` | Chattian–Aquitanian (Egerian, Caucasian, Sakaraulian) | The Egerian regression and the earliest Eggenburgian transgression (~20.4 Ma) sit on the same bin edge |
| `20-11` | Eggenburgian → Sarmatian s.str. (incl. Badenian 15.97–12.65, Sarmatian 12.65–11.6) | The Badenian Salinity Crisis, the Badenian–Sarmatian Extinction Event and the Sarmatian brackish phase are one `sm` bin |
| `11-2` | Pannonian, Meotian, Pontian, Dacian, Romanian, Messinian | The entire brackish/lacustrine endgame of the Paratethys is one bin |

Hard vocabulary limits, to be stated and never "fixed" by invention:

1. **There is no brackish or lake class.** `lm`, `sm`, `m` only. Lake Pannon
   (~11.6–4.5 Ma), the Dacian Basin lakes, the isolated Caspian after ~11.6 Ma
   and the Pontian Black Sea are all endorheic or near-endorheic brackish water
   bodies. Where the payload renders them `sm` that is **the closest available
   bin, not a sourced marine claim**. This is the single largest epistemic gap
   in item 12e and belongs in the map key, not in an edit.
2. **Cao 2017 = minimum land / maximum flooding per bin.** A site flooded for
   any part of a bin should carry `sm`; this is the only test that makes a
   missing-`sm` verdict a defect rather than a phase difference.
3. **~30 km class floor.** The Vienna Basin is 20–40 km wide; a point-probe
   miss of a few km inside it is the floor, not a defect.
4. **Stacking occlusion.** `m` (1,600 m) renders above `lm` (1,300 m) above
   `sm` (700 m). Where a Cao mountain polygon covers a basin point, adding
   shallow marine beneath it changes nothing on screen, and no op in the basin
   edit contract removes mountain.

## Expectation per site per interval

`sm` = marine or brackish water body Cao could render; `lm` = emergent.
"lake" marks a state the class vocabulary cannot express.

| Site (lon, lat) | 37–29 | 29–20 | 20–11 | 11–2 |
|---|---|---|---|---|
| Pannonian Basin (19, 47) | sm — Priabonian Buda transgression, Kiscellian marine | sm — Egerian, Eggenburgian marine | sm — Karpatian–Badenian full marine, Sarmatian brackish | lake — Lake Pannon from ~11.6 Ma |
| Vienna Basin (16.8, 48.2) | sm — Alpine-Carpathian flysch trough marine (basin not yet open) | sm — Egerian Waschberg marine | sm — pull-apart opens ~17 Ma, Badenian marine gulf 16.3–12.7 Ma | lake — Lake Pannon arm, then emergent |
| Dacian / Carpathian foreland (26, 44.5) | sm — Menilite/Kliwa foredeep | sm — Oligocene–Aquitanian foredeep (weakest of the four; Moesian platform edge) | sm — Badenian and Sarmatian | lake/brackish — Meotian–Pontian–Dacian |
| Black Sea (34, 43) | sm — lower Maikop anoxic marine | sm — upper Maikop | sm — through the BSEE | sm (brackish) — Pontian, Messinian lowstand, Kimmerian |
| Caspian (51, 42) | sm — Maikop | sm — Maikop | sm — Tarkhanian→Sarmatian | lake — isolated from ~11.6 Ma (Lazarev et al. 2025) |
| North Caucasus foreland (44, 45) | sm — Maikop type area | sm — Maikop | sm — Chokrakian–Sarmatian | sm (brackish) — Terek-Kuma, Akchagylian |
| Aral / Turan (60, 44) | sm — late Eocene sea, Turgai closes ~34 Ma inside the bin | sm — Oligocene northern Aral marine | ambiguous — largely emergent with Karaganian/Konkian incursions | lm — continental after the Sarmatian regression |
| Transylvania (24.5, 46.5) | sm — Priabonian–Rupelian (Cluj, Brebi) | ambiguous — Egerian regressive in the basin centre; Eggenburgian only at the bin edge | sm — Badenian (Dej Tuff, salt) and Sarmatian | lm — Lake Pannon eastern arm ~11.6–9 Ma then uplift |
| Alpine foreland Molasse (11, 48) | sm — Untere Meeresmolasse, Rupelian ~34–30 Ma, basin-wide | lm — Chattian Untere Süßwassermolasse | sm — Obere Meeresmolasse, Burdigalian ~20–17 Ma | lm — Obere Süßwassermolasse, then erosion |

## Verdict table (shipped class set at the probe point)

| Site | 37–29 | 29–20 | 20–11 | 11–2 |
|---|---|---|---|---|
| Pannonian Basin (19, 47) | `[sm,m]` **PASS** | `[sm,m]` **PASS** | `[sm]` **PASS** | `[sm]` **PARTIAL** (lake) |
| Vienna Basin (16.8, 48.2) | `[lm,sm,m]` **PASS** | `[sm]` **PASS** | `[m]`, sm 2 km **PARTIAL** (class floor) | `[sm]` **PARTIAL** (lake) |
| Dacian foreland (26, 44.5) | `[lm,sm]` **PASS** | `[lm]`, sm 108 km **PARTIAL** (unresolved) | `[sm]` **PASS** | `[sm]` **PARTIAL** (brackish) |
| Black Sea (34, 43) | `[sm]` **PASS** | `[sm]` **PASS** | `[sm]` **PASS** | `[sm]` **PASS** (brackish note) |
| Caspian (51, 42) | `[sm]` **PASS** | `[sm]` **PASS** | `[sm]` **PASS** | `[sm]` **PARTIAL** (lake) |
| N Caucasus foreland (44, 45) | `[sm]` **PASS** | `[sm]` **PASS** | `[sm]` **PASS** | `[sm]` **PASS** (brackish note) |
| Aral / Turan (60, 44) | `[sm]` **PASS** | `[sm]` **PASS** | `[lm]`, sm 114 km **PARTIAL** (unresolved) | `[lm]` **PASS** |
| Transylvania (24.5, 46.5) | `[sm]` **PASS** | `[lm]`, sm 50 km **PARTIAL** | `[sm]` **PASS** | `[lm]` **PASS** (lake note) |
| Alpine Molasse (11, 48) | `[lm,m]`, sm 52 km **FAIL** | `[lm]` **PASS** | `[sm]` **PASS** | `[]`, lm 3 km **PARTIAL** (class floor) |

Tally: 24 PASS, 11 PARTIAL, 1 FAIL.

### Supporting transect (why the Molasse verdict is basin-wide, not a point miss)

| Point | 37–29 | 29–20 | 20–11 | 11–2 |
|---|---|---|---|---|
| 9.0 E, 47.8 N (Swabian) | `[lm,m]`, sm 92 km | `[lm]`, sm 68 km | `[lm]`, sm 46 km | `[lm]` |
| 11.0 E, 48.0 N (Munich) | `[lm,m]`, sm 52 km | `[lm]`, sm 58 km | `[sm]` | `[]`, lm 3 km |
| 11.0 E, 48.5 N | `[lm]`, sm 107 km, **m 9 km** | `[lm]`, sm 108 km | `[lm]`, sm 3 km | `[lm]` |
| 11.0 E, 49.0 N | `[lm]`, sm 162 km | `[lm]`, sm 161 km | `[lm]`, sm 51 km | `[lm]` |
| 13.0 E, 48.3 N (Lower Bavaria) | `[lm,m]`, sm 58 km | `[lm]`, sm 45 km | `[lm,sm]` | `[lm]` |

No `sm` exists anywhere in the North Alpine Foreland Basin in the `37-29`
payload: the nearest shallow marine is 52–162 km away along the whole
9–13 °E transect. The Rupelian Untere Meeresmolasse is simply absent from
Cao's late Eocene–Oligocene bin. By contrast the `20-11` Obere Meeresmolasse
*is* present and its northern limit (sm 3 km from 48.5 N, 51 km from 49.0 N at
11 °E) is consistent with the mapped Burdigalian onlap — no op needed there.

The `37-29` mountain polygon reaches to about 48.4 °N at 11 °E (m 9 km from
48.5 N, m 0 km at 48.0 N). A shallow-marine op south of that line would be
occluded by the mountain shell and is therefore out of scope.

### Other probed controls

| Point | Interval | Shipped | Reading |
|---|---|---|---|
| Getic Depression (24.5, 44.9) | 29–20 | `[lm]`, sm 135 km | same open question as (26, 44.5) |
| Focșani (27, 45.6) | 29–20 | `[sm]` | the Oligocene–Aquitanian foredeep *is* flooded 100 km to the NE |
| Lake Pannon centre (18.5, 46) | 11–2 | `[sm]` | confirms the lake-as-`sm` limitation is basin-wide, not a point artifact |
| Vienna Basin N (16.9, 48.6) | 20–11 | `[sm]` | confirms the (16.8, 48.2) miss is the class floor, not a hole |

## Findings and proposed work

### OP-1 — proposed. North Alpine Foreland Basin, Lower Marine Molasse, `37-29`

The only verdict that is a genuine, well-documented mismatch rather than a bin
or vocabulary limit.

| Field | Value |
|---|---|
| File | `data/corrections/palaeo-coastlines/basins/north-alpine-foreland.json` (new) |
| Intervals | `37-29` only (single, contiguous) |
| Op A | `remove-land` |
| Op B | `add-shallow`, identical footprint (required companion: no `sm` lies beneath the land being removed) |
| Footprint, in words | The North Alpine Foreland Basin belt from about 9.0 °E to 13.2 °E, bounded south by the northern edge of the Cao `37-29` mountain polygon (about 48.2 °N at 11 °E, stepping south westward) and north by the erosional/onlap limit of the Untere Meeresmolasse, about 48.8 °N in Bavaria and 48.6 °N in Swabia |
| `uncertaintyKm` | 30 |
| `rationale` | The Untere Meeresmolasse records a fully marine Rupelian seaway (~34–30 Ma) across the whole North Alpine Foreland Basin, the western arm of the Paratethys gateway system. Cao 2017 renders the basin as continuous land through `37-29`, which contradicts a minimum-land / maximum-flooding reading of that bin. |
| `editorial` | `"EarthHistory modification after Kuhlemann & Kempf 2002 and Rögl 1999"` |

References for OP-1, DOIs resolved against Crossref on 2026-09-15:

| id | DOI | Citation | Constrains | Kind |
|---|---|---|---|---|
| `kuhlemann-kempf-2002` | `10.1016/S0037-0738(01)00285-8` | Kuhlemann, J. & Kempf, O. (2002) Post-Eocene evolution of the North Alpine Foreland Basin and its response to Alpine tectonics. *Sedimentary Geology* 152, 45–78. | UMM/USM/OMM/OSM stratigraphy and basin extent | claim |
| `rogl-1999-palaeogeography` | `10.1017/cbo9780511542329.002` | Rögl, F. (1999) Mediterranean and Paratethys Palaeogeography during the Oligocene and Miocene. In *Hominoid Evolution and Climatic Change in Europe*, 8–22. | Oligocene Paratethys map series | claim |
| `palcu-krijgsman-2022` | `10.1144/sp523-2021-73` | Palcu, D.V. & Krijgsman, W. (2022) The dire straits of Paratethys: gateways to the anoxic giant of Eurasia. *Geol. Soc. London Spec. Publ.* 523, 111–139. | gateway configuration, western connection | inference |

Blocker to clear before OP-1 is written: **none of these ids exist in
`src/data/sources.ts`** — a grep for `Rögl|Popov|Palcu|Krijgsman|Paratethys|
Lazarev|Molasse|Pannonian|Maikop` over its 175 entries returns zero hits. The
basin edit contract requires every reference id to live there first, so OP-1
needs a coordinator-approved `sources.ts` addition ahead of the basin file.

Residual limitation OP-1 does not fix: the UMM south of ~48.2 °N at 11 °E stays
under the Cao mountain shell and cannot be shown. State it; do not widen the op
to chase it.

### Open, not proposed as ops

| # | Finding | Why no op yet |
|---|---|---|
| F-1 | Dacian foreland (26, 44.5) and Getic Depression (24.5, 44.9) are `lm` at `29-20` while Focșani 100 km NE is `sm` | The Oligocene–Aquitanian shoreline across the Moesian platform edge cannot be placed to better than ~100 km without digitising Popov et al. (2004) maps 2–3. Proposing a footprint now would be false precision. |
| F-2 | Aral/Turan (60, 44) is `lm` at `20-11` with `sm` 114 km away | Whether Karaganian/Konkian incursions reached the SE Ustyurt is exactly the question the Popov map series answers; unresolved without it. |
| F-3 | Transylvania (24.5, 46.5) `lm` at `29-20`, `sm` 50 km | Egerian regression in the basin centre is defensible; Eggenburgian flooding starts at 20.4 Ma, on the bin edge. Reads as a phase-in-bin effect, not a defect. |
| F-4 | `(11, 48)` at `11-2` returns neither `lm` nor `sm`, `lm` 3 km away | Sub-class-floor gap at one coordinate; all four transect points are `lm`. Move the witness point, do not edit the data. |
| F-5 | Out of scope, but visible: `(34, 43)` at `49-37` returns `[m]` with no `lm`/`sm` — a mountain polygon over the abyssal Western Black Sea basin | Outside item 12e's intervals; worth its own item. No mountain op exists in the edit contract. |
| F-6 | Cao mountain polygons cover the Pannonian Basin interior at `37-29` and `29-20` and the Vienna Basin at `20-11`, rendering above the correct `sm` | The edit contract has no mountain op. Limitation for the key. |

### Proposed witnesses

Format `(name, (lon, lat), interval, expected class set)`. Rows 1–13 assert the
shipped state and pass at `49ccb43` today; row 14 flips only when OP-1 lands.

| # | name | point | interval | classes |
|---|---|---|---|---|
| 1 | Black Sea Maikop | (34.0, 43.0) | `37-29` | `["sm"]` |
| 2 | Black Sea upper Maikop | (34.0, 43.0) | `29-20` | `["sm"]` |
| 3 | Middle Caspian Maikop | (51.0, 42.0) | `29-20` | `["sm"]` |
| 4 | North Caucasus foredeep Maikop | (44.0, 45.0) | `37-29` | `["sm"]` |
| 5 | Caspian isolated basin | (51.0, 42.0) | `11-2` | `["sm"]` |
| 6 | Pannonian Basin Badenian | (19.0, 47.0) | `20-11` | `["sm"]` |
| 7 | Transylvanian Basin Badenian | (24.5, 46.5) | `20-11` | `["sm"]` |
| 8 | Transylvanian Basin post-Pannonian | (24.5, 46.5) | `11-2` | `["lm"]` |
| 9 | Aral Turan continental | (60.0, 44.0) | `11-2` | `["lm"]` |
| 10 | Dacian Basin Sarmatian | (26.0, 44.5) | `20-11` | `["sm"]` |
| 11 | Molasse Obere Meeresmolasse | (11.0, 48.0) | `20-11` | `["sm"]` |
| 12 | Molasse Chattian freshwater | (11.0, 48.5) | `29-20` | `["lm"]` |
| 13 | Molasse late Miocene continental | (11.0, 48.5) | `11-2` | `["lm"]` |
| 14 | North Alpine foreland UMM *(with OP-1)* | (11.0, 48.5) | `37-29` | `["sm"]` |

`BASIN_EDIT_WITNESSES` pair for OP-1: edited row 14 against unedited control
row 12 — same point, adjacent interval outside the op's declared interval, so a
footprint that leaks into `29-20` turns row 12 red.

Rows 5 and 6–8 carry a mandatory epistemic note where they surface: row 5 is a
brackish lake-sea rendered in the only class available, not a marine shelf.

## Sources consulted (all DOIs resolved against Crossref, 2026-09-15)

| Citation | DOI |
|---|---|
| Rögl, F. (1999) Mediterranean and Paratethys Palaeogeography during the Oligocene and Miocene. *Hominoid Evolution and Climatic Change in Europe*, 8–22. | `10.1017/cbo9780511542329.002` |
| Popov, S.V. et al. (2004) Lithological-Paleogeographic maps of Paratethys. *Courier Forschungsinstitut Senckenberg* 250, 1–46. | no DOI issued; print map series, not yet consulted — see F-1, F-2 |
| Palcu, D.V., Golovina, L., Vernyhorova, Y., Popov, S., Krijgsman, W. (2017) Middle Miocene paleoenvironmental crises in Central Eurasia caused by changes in marine gateway configuration. *Global and Planetary Change* 158, 57–71. | `10.1016/j.gloplacha.2017.09.013` |
| Palcu, D.V., Patina, I.S., Șandric, I., Lazarev, S., Vasiliev, I., Stoica, M., Krijgsman, W. (2021) Late Miocene megalake regressions in Eurasia. *Scientific Reports* 11, 11471. | `10.1038/s41598-021-91001-z` |
| Palcu, D.V. & Krijgsman, W. (2022) The dire straits of Paratethys. *Geol. Soc. London Spec. Publ.* 523, 111–139. | `10.1144/sp523-2021-73` |
| Krijgsman, W., Tesakov, A., Yanina, T., Lazarev, S. et al. (2019) Quaternary time scales for the Pontocaspian domain. *Earth-Science Reviews* 188, 1–40. | `10.1016/j.earscirev.2018.10.013` |
| van Baak, C., Krijgsman, W., Magyar, I., Sztanó, O. et al. (2017) Paratethys response to the Messinian salinity crisis. *Earth-Science Reviews* 172, 193–223. | `10.1016/j.earscirev.2017.07.015` |
| Lazarev, S., Mandic, O., Stoica, M., Gol'din, P., Ćorić, S., Harzhauser, M., Krijgsman, W. (2025) Hydrological isolation of the Paratethys in the late Middle–Late Miocene: Caspian Basin, Karagiye, Kazakhstan. *Marine and Petroleum Geology* 173, 107288. | `10.1016/j.marpetgeo.2025.107288` |
| Magyar, I., Geary, D.H., Müller, P. (1999) Paleogeographic evolution of the Late Miocene Lake Pannon in Central Europe. *Palaeogeogr. Palaeoclimatol. Palaeoecol.* 147, 151–167. | `10.1016/S0031-0182(98)00155-2` |
| Kuhlemann, J. & Kempf, O. (2002) Post-Eocene evolution of the North Alpine Foreland Basin. *Sedimentary Geology* 152, 45–78. | `10.1016/S0037-0738(01)00285-8` |

The task brief named "Krijgsman et al. 2019 *Earth-Sci Rev*"; the 2019
Earth-Science Reviews paper by that group is the Pontocaspian time-scale review
above. The Messinian-response review the brief may also have meant is van Baak
et al. 2017, listed separately. Both are recorded rather than conflated.
