# South America, Neogene: the Paranense Sea and the Pebas system

Item 12e. Read-only re-measurement of the shipped `lm`/`sm`/`m` payloads at
commit `49ccb43` against the modern literature on the Miocene Paranense
(Paranaense) Sea of the Chaco–Paraná basin and the Pebas mega-wetland of western
Amazonia. This memo changes nothing. It settles one question left open by
[palaeo-coastlines-inland-sea-checks.md](palaeo-coastlines-inland-sea-checks.md)
§6 and §15.2: **the Paranense over-extension `FAIL` at 11–2 and the missing
Laguna Paiva `FAIL` at 29–20 both rested on a single unpublished thesis. Do
modern reviews support either, and is the 29–20 `add-shallow` now buildable?**

Short answer: **both `FAIL`s are withdrawn and no op is proposed.** Two modern
chronologies that the earlier memo could not reach — Hernández et al. 2005's own
abstract (15–13 and 10–5? Ma) and del Río et al. 2018's Sr-isotope dating
(11.9–6.0 Ma, Paraná Formation **7.50–6.00 Ma**) — put this sea's life squarely
inside 11–2, so that bin is no over-extension but the sea's main bin; and neither
records anything at **25–21 Ma**, so the Laguna Paiva addition at 29–20 is not
merely unsupported, it is **refuted**, and the model's land there is the cited
reading. Ruskin et al. 2011 and del Río's north-western limit additionally
convert two UNCONSTRAINED rows into cited PASSes. Amazonia moves the other way:
the Pebas verdict survives but is **no longer settled**, and this memo corrects
its own earlier claim that no modern source proposes a Pebas–Paranense
connection — three do, the newest from 2026.

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Git HEAD | `49ccb43551c9abb3b0b9e27b09dc6c7af279d978` |
| Payloads | extracted with `git show HEAD:…` into a scratch tree, never from the working copy (which carried unrelated edits to `src/render/GlobeScene.ts` and `tests/browser/explorer.spec.ts` only) |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` |
| Method | `palaeo_coastlines_compile.decode_ehpr` + `piece_geometry` imported read-only; pieces unioned per class per interval exactly as `palaeo_coastlines_correction.class_union` does; a present-day `(lon, lat)` gets the set of classes whose union `contains()` it. Lifecycle is not filtered, as in the validator. |
| Classes, intervals | `lm`, `sm` **and `m`** — the mountain class ships at this HEAD (commit `65626b9`), so the "withheld mountain class" caveat no longer applies here (§5) — over `37-29` (control), `29-20`, `20-11`, `11-2` |

### sha256 of every payload read

```
bd32467cf40ad15308b7041e9bb9d9de93b79ec31c5da51ecc339f20f94e5b95  lm/palaeo-lm-37-29.ehpr
1adce26ea8ec7fe09397c2ac7b2ffae7609d62c1ed5e629156d9d4a177238e62  lm/palaeo-lm-29-20.ehpr
3a22d3af9f951cdf6ae42b0e796820f39735cc447a215c0ff5269f284afbc352  lm/palaeo-lm-20-11.ehpr
19e453237230fd8439512aa68718ab1cbb795aa9c310ee886bf8b79567e618c2  lm/palaeo-lm-11-2.ehpr
4002ab226c3deb70f32f3256e2acaf2d70f685a9e7c4d3cb1fe176c343cbc719  lm/palaeo-lm-catalog.json
bc4d0e52d3516202522e10d2668391c2c9bdcd7e060c3ed0fb8630a6cee3b98e  sm/palaeo-sm-37-29.ehpr
dbf9f2b601cef54f15c5234488abe37d0a51bdaf0d90cec0d9ced10276997b5e  sm/palaeo-sm-29-20.ehpr
5d8dab9df0a1d50fdcfe29df2c3e4b9fd4cc1a0a7e3d23c6bbd35276d9c84b56  sm/palaeo-sm-20-11.ehpr
f5e4420f2c500009d97fa53c2d9375e749157b30342cf851c6803a834a9f82d6  sm/palaeo-sm-11-2.ehpr
7232eea4537805e1078dac92c1c3a2228a44c8a1704056899d29f2de1bdebdd5  sm/palaeo-sm-catalog.json
07fb0fffd771f3a3d47a76fb8983e8dd6ec3b565bdc35f4a275a2c8f747d7647  m/palaeo-m-37-29.ehpr
c0836079015a411191f50add964fa6d2b796c451f4126f604af2d722879a161a  m/palaeo-m-29-20.ehpr
0d727437342903ad4c3ba9a3140dcea7a859f1a133cd8de10ad2a9a1d84edbd1  m/palaeo-m-20-11.ehpr
964f43e6e0eeb308213a2ab253810c24798cdd5ac5866c88c7fd52ef034362a2  m/palaeo-m-11-2.ehpr
9fbda74f87faf25cad841e91ab5cde68296b709b83a2758b30c2535f044ed7b7  m/palaeo-m-catalog.json
```

All numbers below are **Measured** unless marked otherwise. Literature is tagged
**Verified metadata** (DOI resolved, record read back from Crossref), **Verbatim**
(exact sentence from a retrieved page), or **Inference**; nothing is tagged
Verbatim from a source this session could not open.

## 1. Measured: the eleven requested points, `37-29` being the pre-Neogene control

| Point | Where | 37–29 | 29–20 | 20–11 | 11–2 |
|---|---|---|---|---|---|
| (−58, −33) | Entre Ríos | `lm` | `lm` | **`sm`** | **`sm`** |
| (−60, −30) | Chaco–Paraná centre | `lm` | `lm` | **`sm`** | **`sm`** |
| (−62, −36) | Pampas | `lm` | `lm` | `lm` | `lm` |
| (−57, −31) | Corrientes | `lm` | `lm` | **`sm`** | **`lm`** |
| (−60, −25) | northern Chaco | `lm` | `lm` | `lm` | `lm` |
| (−64, −30) | Chaco–Paraná west | `lm` | `lm` | `lm` | `lm` |
| (−72, −4) | Pebas | `lm` | `lm` | `lm` | `lm` |
| (−70, −2) | Pebas north | `lm` | `lm` | `lm` | `lm` |
| (−75, −6) | Marañón | `lm` | `lm` | `lm` | `lm` |
| (−67, −10) | Beni | `lm` | `lm` | `lm` | `lm` |
| (−66, −4) | Solimões | `lm` | `lm` | `lm` | `lm` |

Controls: the Laguna Paiva type area (−60.7, −31.3) tracks (−60, −30) exactly;
Sierras Pampeanas (−65, −30) and the Bolivian Yecua domain (−63.5, −19) are `lm` in
all four; the Salado mouth (−57.5, −34.5) is `sm` from 29–20 on. **No probe point
is `m`**, but the Andean control (−70, −32) is `m` in all four and the Altiplano
(−68, −18) from 29–20 on — the mountain payload is present and working here.

## 2. Measured: the Paranense embayment as a body

1° grid, box −66…−52 E, −38…−26 N (195 cells), `sm` minus `lm`:

| Interval | land only | sea only | neither | sea % |
|---|---:|---:|---:|---:|
| 37–29 | 172 | 20 | 1 | 10.3 |
| 29–20 | 163 | 29 | 3 | 14.9 |
| 20–11 | 108 | **84** | 3 | **43.1** |
| 11–2 | 88 | 83 | 24 | 42.6 |

The 29–20 sea cells are **entirely the Atlantic margin south of −33 N**. Western
limit of `sm` by parallel: at 29–20, −63.25 at −35 N, −53.50 at −34, −52.50 at
−33 and **none at all from −32 to −26**; at 20–11 it runs −58.50 → −63.25 from
−35 to −29 N and stays near −61 up to −26 N; at 11–2 it runs −61.50 → −62.75 from
−35 to −31 N, slackens to −61.00 at −27 N and **stops before −26 N**.

Connectivity — is the Atlantic at (−56, −36) the same `sm` body as the point?
**No** to the Chaco (−60, −29), Entre Ríos (−58, −33) and Corrientes (−57, −31)
at both 37–29 and **29–20**; **yes** to all three at 20–11; at 11–2 yes to the
Chaco and Entre Ríos but **no** to Corrientes, which has emerged.

Area inside the window the inland-sea memo proposed for the edit (−64…−56 E,
−34…−26 N; 685,022 km²):

| Interval | `sm` km² | `lm` km² | `sm` fraction | `sm` bounds |
|---|---:|---:|---:|---|
| 29–20 | **0** | 685,022 | **0.0 %** | — |
| 20–11 | 402,649 | 282,279 | 58.8 % | −63.44…−56.64 E, −34.00…−26.00 N, one part |
| 11–2 | 357,645 | 317,581 | 52.2 % | −62.84…−56.00 E, −34.00…−26.66 N |

At 29–20 the nearest `sm` is **1.298°** from Entre Ríos and **3.938°** from Laguna
Paiva (planar degrees; ~140 km and ~420 km). **The retreat the earlier memo said
was absent is present:** from 20–11 to 11–2 the embayment loses 45,004 km²
(−11.2 %), its northern limit withdraws 0.66° and Corrientes flips `sm` → `lm`.

## 3. Measured: western Amazonia

1° grid, box −78…−64 E, −10…2 N (195 cells):

| Interval | land only | sea only | both | neither | sea % |
|---|---:|---:|---:|---:|---:|
| 37–29 | 159 | **27** | 0 | 9 | **13.9** |
| 29–20 | 178 | 0 | 0 | 17 | 0.00 |
| 20–11 | 172 | 1 | 1 | 21 | 0.51 |
| 11–2 | 183 | 2 | 0 | 10 | 1.03 |

Northern Chaco box (−66…−56 E, −28…−20 N, 99 cells) sea %: 0.0 at 37–29, **0.0
at 29–20**, 9.1 at 20–11, 4.0 at 11–2 — the sea never reaches −25 N in any bin.

Two incidental measurements (see SA13): a **pre-Neogene marine belt at 37–29** —
27 `sm` cells in a continuous N–S strip at −78…−73 E, −9…2 N along the Andean
foreland (Marañón/Putumayo/Oriente trend), gone entirely at 29–20; and the
**Amazon mouth (−50, −1)**, `sm` at 37–29, 29–20 and 20–11 but **`lm` at 11–2**.

## 4. Literature: what could and could not be verified

Every DOI below was resolved against `api.crossref.org/works/<doi>` **in this
session** and the returned title, authors, container, volume and pages read back.
Quoted sentences are the publisher-deposited abstract unless marked otherwise.

| Work | DOI | Status and what it says |
|---|---|---|
| **del Río, C.J.; Martínez, S.; McArthur, J.M.; Thirlwall, M.F.; Pérez, L.M. 2018**, *Dating late Miocene marine incursions across Argentina and Uruguay with Sr-isotope stratigraphy*, J. South Am. Earth Sci. **85**, 312–324 | [10.1016/j.jsames.2018.05.016](https://doi.org/10.1016/j.jsames.2018.05.016) | **Verified metadata + abstract read in full.** The decisive source. **Verbatim:** *"five age-groups that encompass the 'Paranense' flooding in the latest Serravalian-Messinian interval"*; Puerto Madryn transgressive **11.9–10.4 Ma**, regressive **10.2–9.82** and **9.40–9.05 Ma**; *"Ages of **8.85–7.95 Ma** for the 'Entrerriense Beds'"*; *"the **Parana** and Camacho formations span the age-range **7.50–6.00 Ma**"*; and on extent, *"**The flooding area was smaller than previously thought, with its northwestern-most boundary in the surroundings of the Santa Fe Province** and its southernmost boundary in southern Santa Cruz Province"*, along *"1200 km of the southwestern Atlantic coast"*. |
| **Hernández, R.M.; Jordan, T.E.; Dalenz Farjat, A.; Echavarría, L.; Idleman, B.D.; Reynolds, J.H. 2005**, *Age, distribution, tectonics, and eustatic controls of the Paranense and Caribbean marine transgressions in southern Bolivia and Argentina*, J. South Am. Earth Sci. **19**(4), 495–512 | [10.1016/j.jsames.2005.06.007](https://doi.org/10.1016/j.jsames.2005.06.007) | **Verified metadata; abstract now retrieved** via the Elsevier deposit in OpenAIRE, after ScienceDirect, Crossref, Semantic Scholar and Unpaywall all failed. **Verbatim:** *"Marine transgression onto the South American continent took place at least twice in the Miocene along distinct paleogeographic corridors. **The first event occurred between 15 and 13 Ma and the second between 10 and 5? Ma.**"* (the *"?"* is the authors'), plus a *"7.72 ± 0.31 Ma"* Ar/Ar date at Río Parapetí and *"**no continental connection**"* between the Argentine and Caribbean transgressions. Full text still closed. |
| **Ruskin, B.G.; Dávila, F.M.; Hoke, G.D.; Jordan, T.E.; Astini, R.A.; Alonso, R. 2011**, *…Did the Paranaense seaway flood western and central Argentina?*, Palaeogeogr. Palaeoclimatol. Palaeoecol. **308**, 293–303 | [10.1016/j.palaeo.2011.05.033](https://doi.org/10.1016/j.palaeo.2011.05.033) | **Verified metadata + abstract.** The western limit, stated as an instruction. **Verbatim:** *"the Parana seaway **did not inundate** this portion of west and central Argentina"*; a *"**lacustrine** origin"* is inferred for the Saguión (Córdoba), Anta (Salta), Del Buey / Del Abra (La Rioja) and Chinches (San Juan) formations; *"we … **discourage mapping of the seaway as extending into the central Sierras Pampeanas or Andean foreland**"*; the seaway is *"preserved in the **Chaco-Pampean Plain subsurface**"*. |
| **Martínez, S. & del Río, C.J. 2002**, *Late Miocene molluscs from the southwestern Atlantic Ocean*, PPP **188**, 167–187 | [10.1016/S0031-0182(02)00551-5](https://doi.org/10.1016/S0031-0182(02)00551-5) | **Verified metadata + abstract.** The only explicit latitudes found: Valdesian southern limit **42°S**, Valdesian/Paranaian boundary **~37–39°S**, and the Paranaian *"extends northwards along the Uruguayan and southern Brazilian littoral, but its **northern boundary still remains unknown**"*. These are coastal molluscan bioprovinces, not a shoreline. |
| **Aumond, G.N. et al. 2021**, *Paleoenvironmental conditions of the late Miocene "Entrerriense" epicontinental sea: … the Camacho Formation*, J. South Am. Earth Sci. **110**, 103421 | [10.1016/j.jsames.2021.103421](https://doi.org/10.1016/j.jsames.2021.103421) | **Verified metadata + abstract.** A *"shallowing-upward trend"* with *"**increased influence of freshwater input** in the upper half"*, tied to cooling **7.2–6.9 Ma** and sea-level fall **7.2–6.5 Ma**. The best marine → brackish evidence for the sea's end. |
| **Marengo, H.G. 2015**, *Neogene Micropaleontology and Stratigraphy of Argentina: The Chaco-Paranense Basin and the Península de Valdés*, SpringerBriefs, XIV + 218 pp | [10.1007/978-3-319-12814-6](https://doi.org/10.1007/978-3-319-12814-6) | **Verified metadata**, ISBN 978-3-319-12813-9. The 2006 UBA thesis, published. Ch. 2 abstract (**Verbatim**) names *"the transgressions of **Laguna Paiva (TLP)** and **Entrerriense-Paranense (TEP)** in the Chacoparanense and Salado basin"* — **but gives no age in Ma**. The TLP's 25–21 Ma window is not verifiable from anything retrievable. |
| **Tineo, D.E.; Pérez, L.M.; Brandoni, D.; Martínez, S.; Bona, P.; Brea, M. 2024**, *Reconstructing the South American Miocene puzzle: An integrated analysis of the Paraná Formation*, J. South Am. Earth Sci. **147**, 105118 | [10.1016/j.jsames.2024.105118](https://doi.org/10.1016/j.jsames.2024.105118) | **Verified metadata; abstract NOT retrieved** by any open route (not OA; no Crossref/OpenAIRE/S2/EuropePMC deposit). Almost certainly the current canonical review. **The largest remaining gap in this item.** |
| **Kern, A.K.; Gross, M.; Galeazzi, C.P. et al. 2020**, *Re-investigating Miocene age control and paleoenvironmental reconstructions in western Amazonia*, PPP **545**, 109652 | [10.1016/j.palaeo.2020.109652](https://doi.org/10.1016/j.palaeo.2020.109652) | **Verified metadata + abstract. Found — and it does *not* say what it was sought for.** Solimões Fm top max. depositional age **11.42 ± 0.66 Ma**; environments are *"**lakes and/or abandoned channels with temporary slightly saline conditions**"*. **It proposes no Pebas–Paranense connection.** |
| **Gross, M. & Piller, W.E. 2020**, *Saline Waters in Miocene Western Amazonia – An Alternative View*, Front. Earth Sci. **8**, 116 | [10.3389/feart.2020.00116](https://doi.org/10.3389/feart.2020.00116) | **Verified metadata + abstract** (open access). **Verbatim:** isotope ratios *"refer to a **pure freshwater environment** and are incompatible with the interference of isotopically heavier, marine waters"*; saline groundwater discharge *"**mimics short-lived marine incursions**"*. |
| **Aceñolaza, F.G. & Sprechmann, P. 2002**, *The Miocene marine transgression in the meridional Atlantic of South America*, N. Jb. Geol. Paläont. Abh. **225**(1), 75–84 | [10.1127/njgpa/225/2002/75](https://doi.org/10.1127/njgpa/225/2002/75) | **Verified metadata. This corrects the inland-sea memo**, which recorded that no Aceñolaza "Mar Paranense" paper *"surfaced in Crossref or OpenAlex"*. **Abstract not reliably retrieved** — the publisher page yielded a mixture of quotation and paraphrase. **Quote nothing from it** until the print is checked. |

**Amazonia.** The Pebas literature is genuinely split, and the split is live.

| Work | DOI | Status and what it says |
|---|---|---|
| **Hoorn, C.; Boschman, L.M.; Kukla, T.; Sciumbata, M.; Val, P. 2022**, *The Miocene wetland of western Amazonia and its role in Neotropical biogeography*, Bot. J. Linn. Soc. **199**(1), 25–35 | [10.1093/botlinnean/boab098](https://doi.org/10.1093/botlinnean/boab098) | **Verified metadata + abstract.** The mainstream modern review. **Verbatim:** *"In the Miocene (23–5 Ma), a large wetland known as the **Pebas System** characterized western Amazonia. During the Middle Miocene Climatic Optimum (c. 17–15 Ma), this system reached its **maximum extent** and was **episodically connected to the Caribbean Sea** … Towards the late Miocene (**c. 10 Ma**) the wetland transitioned into a **fluvial-dominated** system."* Connectivity is Caribbean only; **the Paranense is not mentioned**. |
| **Parra, F.J.; Navarrete, R.E.; di Pasquo, M.; Roddaz, M.; Sarmiento, G.; Baby, P.; Calderon, Y. 2026**, *Neogene Marine Incursions in Western Amazonia … Marañón Basin, Peru*, Fossil Studies **4**(1), 4 | [10.3390/fossils4010004](https://doi.org/10.3390/fossils4010004) | **Verified metadata + abstract; full text NOT read** (MDPI refused). **The principal dissent, and it is seven months old.** **Verbatim:** *"five distinct Neogene marine incursion events (ME-1 to ME-5), **challenging existing models that depict them as short-lived episodes**"* — ME-1 **23.03–17.7 Ma** *"identified across all studied wells"*, ME-2 17.0–16.1, ME-3 16.5–15.7, ME-4 **14.6–11.62**, ME-5 **11.6–10 Ma**; *"ME-5 likely originated **from the south through the Paraná Portal**"*; *"marine incursions … **were not brief episodes but represented prolonged periods of marine influence**"*. Its study area **is** the (−75, −6) probe point. |
| **Gross, M. & Piller, W.E. 2020**, *Saline Waters in Miocene Western Amazonia – An Alternative View*, Front. Earth Sci. **8**, 116 | [10.3389/feart.2020.00116](https://doi.org/10.3389/feart.2020.00116) | **Verified metadata + abstract** (open access). The principal sceptical position. **Verbatim:** isotopes *"refer to a **pure freshwater environment** and are incompatible with the interference of isotopically heavier, marine waters"*; saline groundwater *"**mimics short-lived marine incursions**"*. |
| **Boonstra, M.; Ramos, M.I.F.; Lammertsma, E.I.; Antoine, P.-O.; Hoorn, C. 2015**, *Marine connections of Amazonia…*, PPP **417**, 176–194 | [10.1016/j.palaeo.2014.10.032](https://doi.org/10.1016/j.palaeo.2014.10.032) | **Verified metadata + abstract.** **Verbatim:** *"aberrant forms of *Ammonia* indicating lower limits of **0–10 psu**"*; *"marginal marine conditions reached **at least 2000 km inland from the Caribbean portal**"*. The most quotable extent figure — and the water is **marginal marine**, not marine. |
| **Räsänen, M.E.; Linna, A.M.; Santos, J.C.R.; Negri, F.R. 1995**, *Late Miocene Tidal Deposits in the Amazonian Foreland Basin*, Science **269**, 386–390 | [10.1126/science.269.5222.386](https://doi.org/10.1126/science.269.5222.386) | **Verified metadata + abstract.** Origin of the southern-seaway idea: *"an embayment or **interior seaway** … **may once have connected the Caribbean with the South Atlantic**"*. Drew three published rebuttals in *Science* 273 (1996). |
| **Hovikoski, J.; Räsänen, M.; Gingras, M. et al. 2007**, *…Miocene Quendeque Formation (Bolivia) and tidally-influenced strata in southwestern Amazonia*, PPP **243**(1), 23–41 | [10.1016/j.palaeo.2006.07.013](https://doi.org/10.1016/j.palaeo.2006.07.013) | **Verified metadata + abstract.** The strongest explicit southern-connection case: northernmost Paranan occurrence **18°S**, southernmost Amazonian **13°S**, Quendeque at **15°S**; *"**episodically open hydrodynamic connection**"*, from *"**thin** Miocene tidally/marine influenced levels"* — a dispersal corridor, not a standing sea. |
| **Roddaz, M.; Brusset, S.; Baby, P.; Hérail, G. 2006**, *…forebulge–backbulge depozones of the Beni–Mamore foreland Basin*, J. South Am. Earth Sci. **20**(4), 351–368 | [10.1016/j.jsames.2005.11.004](https://doi.org/10.1016/j.jsames.2005.11.004) | **Verified metadata + abstract.** *"tidal flat deposits"* and a *"subtidal/shoreface"* setting imply *"a connection, **either with the South Atlantic Ocean or the Caribbean Sea or both**"* — the authors deliberately leave the source open. |
| **Espinosa, B.S.; D'Apolito, C.; da Silva-Caminha, S.A.F. 2021**, *Marine influence in western Amazonia during the late Miocene*, Glob. Planet. Change **205**, 103600 | [10.1016/j.gloplacha.2021.103600](https://doi.org/10.1016/j.gloplacha.2021.103600) | **Verified metadata + abstract.** A *"general consensus on short events during the early (23 to 16) and middle (16 to 11.6 Ma) Miocene"*, plus a new **~11–10 Ma** marine-indicator assemblage in the Solimões Fm. |
| **Alvim, A.M.V. et al. 2021**, *Fossil isotopic constraints … on Miocene shallow-marine incursions in Amazonia*, PPP **573**, 110422 | [10.1016/j.palaeo.2021.110422](https://doi.org/10.1016/j.palaeo.2021.110422) | **Verified metadata + abstract.** Early Miocene Pebas *"characterized by **freshwater** conditions"*; **oligohaline** only in the Peruvian part in the Middle–early Late Miocene. |
| **Hoorn, C. et al. 2017**, *The Amazon at sea: Onset and stages of the Amazon River…*, Glob. Planet. Change **153**, 51–65 | [10.1016/j.gloplacha.2017.02.005](https://doi.org/10.1016/j.gloplacha.2017.02.005) | **Verified metadata + abstract.** This is what "Hoorn 2017" is — not an Earth-Sci. Rev. paper and not a comment on Jaramillo. **Verbatim:** *"an **onset of the transcontinental Amazon River between 9.4 and 9 Ma**"*. Anchors SA13. |
| **Wesselingh, F.P. & Salo, J.A. 2006**, *A Miocene perspective on the evolution of the Amazonian biota*, Scripta Geologica **133**, 439–458 | none | **Exists; no DOI** — *Scripta Geologica* is absent from Crossref entirely. Citation confirmed from the reference lists of Hoorn et al. 2010 and Jaramillo et al. 2017. **Text not retrieved**, so nothing is quoted from it. |

**Three bibliographic cautions.** `del Río et al. 2018 "Paleobiogeography of the
Miocene Paranense Sea"` **does not exist** — the real 2018 paper is the Sr-isotope
study above. `Pérez, L.M. 2013` is a UNLP thesis plus two papers in APA
*Publicación Especial* **14**, all **without DOIs** — never cite one. And
Jaramillo et al. 2017 is *"Miocene flooding events **of** western Amazonia"*.

**Retrieval limits.** This session's WebSearch budget was exhausted at the start
and OpenAlex ran out mid-run, so discovery ran on the Crossref REST API,
OpenAIRE, Semantic Scholar, EuropePMC, Unpaywall and direct fetches; Elsevier,
Taylor & Francis, MDPI, Schweizerbart, OUP and Springer chapter pages all
refused, so most abstracts above are publisher-deposited text obtained through
Crossref or a mirror, not read on the publisher's own site. **No DOI checked
failed to resolve.**

## 5. Corrections to earlier records

1. **The mountain class is no longer withheld.** §12.1 of the inland-sea memo put
   *"30 % of the `neither` complement in South America"* down to the withheld `m`
   class; at this HEAD `m` ships. Measured: of the 24 `neither` cells in the Chaco
   box at 11–2, **21 are `m`-covered** (Sierras Pampeanas / Andean front,
   −66…−64 E, −36…−26 N); only three are open Atlantic. Exposure closed here.
2. **Hernández et al. 2005 has now been read.** Its scope is *"southern Bolivia
   **and Argentina**"*, not the NW-Argentina-only reading recorded; and the
   literature memo's unverified *"15–13 and 10–5? Ma"* figures turn out to be
   **exactly right** — they are this paper's own numbers.
3. **Aceñolaza & Sprechmann 2002 is in Crossref**, contrary to the memo's record.
4. **"Hoorn 2017" is *The Amazon at sea*** (Glob. Planet. Change 153), not an
   Earth-Science Reviews paper and not a comment on Jaramillo.

## 6. Verdict table

| # | Check | Expectation (source) | Modelled | Verdict |
|---|---|---|---|---|
| SA1 | Paranense (−58, −33), (−60, −30) at 20–11 | first transgression **15–13 Ma** [jsames.2005.06.007]; Paranense transgressive phase opens **11.9 Ma** [jsames.2018.05.016] — both inside the bin | `sm` at both; one connected Atlantic → Chaco body; `lm` control at 29–20 | **PASS**, and now on two independent chronologies rather than one thesis |
| SA2 | Paranense (−58, −33), (−60, −30) at 11–2 | **Paraná Fm 7.50–6.00 Ma**, "Entrerriense Beds" **8.85–7.95 Ma**, whole Paranense flooding **11.9–6.0 Ma** [jsames.2018.05.016]; second transgression **10–5? Ma** [jsames.2005.06.007]; regression driven by the **7.2–6.5 Ma** sea-level fall [jsames.2021.103421] | `sm` at both; body shrinks 11.2 %, northern limit retreats 0.66°, Corrientes flips to `lm` | **PASS — the earlier `FAIL` by over-extension is WITHDRAWN, and decisively.** 11–2 is not an over-extension: it is *the* bin this sea mostly lives in. The type formation is 7.50–6.00 Ma, dead centre |
| SA3 | Paranense (−57, −31) Corrientes | NE of del Río's *"northwestern-most boundary in the surroundings of the Santa Fe Province"* [jsames.2018.05.016] | `sm` at 20–11, `lm` at 11–2 | **PASS** — emergent in the late-Miocene bin, on the correct side of the cited NW limit, and the cleanest single witness of the withdrawal |
| SA4 | Paranense (−62, −36) Pampas | bioprovince latitudes (Valdesian/Paranaian boundary ~37–39°S) are **coastal**, not a shoreline [S0031-0182(02)00551-5] | `lm` in all four intervals | **UNCONSTRAINED** — no source places a shoreline at this inland point |
| SA5 | Paranense (−64, −30) Chaco–Paraná west | *"the Parana seaway **did not inundate** this portion of west and central Argentina"*; Saguión (Córdoba) and Del Buey / Del Abra (La Rioja) are **lacustrine**; *"discourage mapping of the seaway as extending into the central Sierras Pampeanas"* [palaeo.2011.05.033] | `lm` in all four; modelled western limit −61 to −63.25 | **PASS — upgraded from UNCONSTRAINED.** A modern study asked this exact question and answered no. The model's land here is the cited reading, and its western limit sits east of the units Ruskin rejects |
| SA6 | Paranense (−60, −25) northern Chaco | NW limit *"in the surroundings of the Santa Fe Province"* [jsames.2018.05.016], i.e. south of ~−28 N; this point is ~3° north of it | `lm` in all four; sea never reaches −25 N | **PASS — upgraded from UNCONSTRAINED** |
| SA7 | **Laguna Paiva at 29–20** | Marengo's TLP ~25 → ~21 Ma — **but no retrievable source carries that age**, and the two modern chronologies place the Miocene transgressions at 15–13 and 10–5? Ma [jsames.2005.06.007] and 11.9–6.0 Ma [jsames.2018.05.016], with **nothing at 25–21 Ma** | `lm` everywhere; **0 km² `sm`** in the 685,022 km² window; Atlantic not connected to the Chaco | **PASS — the earlier `FAIL` is WITHDRAWN.** Land at 29–20 is the defensible class. See §7 |
| SA8 | Pebas (−72, −4), (−70, −2), (−75, −6) at 20–11 and 11–2 | **Majority:** brackish-to-freshwater wetland, marine intervals 0.2–0.4 Myr at core 105-AM [sciadv.1601693]; *"pure freshwater environment"* isotopes [feart.2020.00116]; *"episodically connected to the Caribbean"*, fluvial by c. 10 Ma [botlinnean/boab098]; freshwater to oligohaline [palaeo.2021.110422]. **Dissent:** *"marginal marine … at least 2000 km inland"* at 0–10 psu [palaeo.2014.10.032]; and **Parra et al. 2026**, whose study area *is* (−75, −6), report five *"protracted and recurrent"* incursions incl. ME-4 14.6–11.62 and ME-5 11.6–10 Ma [fossils4010004] | `lm` at all three, both bins; 0.51 % and 1.03 % sea in the whole box | **PASS on the majority reading, but now explicitly CONTESTED at (−75, −6).** `lm` is the conservative class, not a settled one; `sm` would take a side in a live 2026 controversy. **This replaces the earlier memo's flat PASS** |
| SA9 | Solimões (−66, −4) | marine intervals are logged at core 105-AM, **69.93 W** — ~400 km *west* of this point [sciadv.1601693]; a further ~11–10 Ma assemblage [gloplacha.2021.103600]; *"lakes … with temporary slightly saline conditions"* [palaeo.2020.109652] | `lm` in all four | **UNCONSTRAINED at this longitude** — the marine record is at the basin's western end and no source maps its eastward extent |
| SA10 | Beni (−67, −10) | Beni–Mamoré *"tidal flat"* / *"subtidal/shoreface"* deposits imply *"a connection, either with the South Atlantic … or the Caribbean … or both"* [jsames.2005.11.004]; Bolivian tidal record at **15°S**, southernmost Amazonian at **13°S** [palaeo.2006.07.013]; the Yecua is a **back-bulge inland wetland** [10.2110/jsr.2021.033] | `lm` in all four | **UNCONSTRAINED** — the point lies in the documented gap between the two records, and tidal influence is not `sm` |
| SA11 | Pebas as a feature | a continental-scale **lake/wetland** [science.1194585 Fig. 1 legend] | no lacustrine class exists | **LIMITATION, not a defect**, unchanged |
| SA12 | Pebas–Paranense marine connection | **Contested.** *For:* *"interior seaway … may once have connected the Caribbean with the South Atlantic"* [science.269.5222.386]; *"episodically open hydrodynamic connection"* via Bolivia [palaeo.2006.07.013]; ME-5 *"from the south through the Paraná Portal"* [fossils4010004]. *Against:* *"no continental connection"* on diachroneity [jsames.2005.06.007]; the Paranense is 11.9–6.0 Ma and stops at Santa Fe [jsames.2018.05.016]; Jaramillo 2017 and Hoorn 2022 consider only the Caribbean portal | model has no connection in any bin | **PASS on the majority position, CONTESTED by a minority strand still active in 2026.** Even its strongest form is a thin, intermittent tidal corridor — which no `sm` geometry could express honestly. **Corrects this memo's own earlier claim that no modern source proposes such a connection: three do** |
| SA13 | Andean foreland 37–29 and the Amazon mouth at 11–2 | transcontinental Amazon onset **9.4–9 Ma** [gloplacha.2017.02.005], inside the 11–2 bin | 27 `sm` cells at −78…−73 E, −9…2 N, gone by 29–20; mouth `sm` → **`lm`** at 11–2 | **NOT ASSESSED** — two flags for a future item; the mouth reading now has a dated anchor to test against |

## 7. Is the Laguna Paiva 29–20 addition supportable now? No — it is refuted

The inland-sea memo left a standing condition: the edit *"should not be built
until **Hernández et al. 2005** or an equivalent is actually read"*. **It has now
been read**, and so has a second, better chronology. Both answer the question
against the edit.

Hernández et al. 2005 dates **15–13** and **10–5? Ma**; del Río et al. 2018's five
Sr-isotope age-groups span **11.9–6.0 Ma**; Ruskin et al. 2011 finds the middle
Miocene carbonates west of the Chaco–Pampean Plain **lacustrine**. **None of the
three records anything at 25–21 Ma**, and Marengo 2015's own ch. 2 abstract names
the TLP without dating it at all.

**Inference.** The 25–21 Ma window survives in no retrievable source: it appears
in the inland-sea memo only as a quotation from the 2006 thesis, and *"Laguna
Paiva"* returns **zero DOI-indexed literature** in Crossref. Meanwhile the modern
chronology has moved the other way — del Río et al. find the flooding *younger*
and *smaller* than previously thought. An `add-shallow` of ~403,000 km² at 29–20
would assert a sea the two best-dated modern studies of this system do not record.

**The practical objections also stand:** it would be the largest single geometry
change in the programme (0 km² of `sm` exists there today); it needs a new
`chaco-parana.json` window and new `src/data/sources.ts` entries, since of the 175
records the only South American ones are `lavenu-titicaca-1992`,
`usgs-andes-volcanism-2009` and `nasa-patagonia-rain-shadow-2026`; and Marengo's
inland reach is *"scarce species typical of brackish environments"*, not `sm`.

**Recommendation: close it.** The model's land at 29–20 is the cited reading.
Reopen only if Tineo et al. 2024 or Marengo 2015 ch. 2 turns up a dated
Oligocene–earliest Miocene transgression.

## 8. Proposed cited ops

**None.** No modern review supports a basin-scale mismatch that meets the
basin-edit contract; every verdict in §6 is now PASS, UNCONSTRAINED, a stated
limitation, or not assessed.

**The Paranense near-miss, recorded so it is not lost.** At 20–11 the modelled
`sm` reaches **−26.0 N** at −60 E, ~2° (~220 km) north of del Río's cited NW limit
*"in the surroundings of the Santa Fe Province"* (≈ −28 N); at 11–2 it reaches
−27.25 N, ~0.75° (~83 km) north. A `remove-shallow` of that tip plus an `add-land`
companion (those cells carry no `lm` beneath, so a bare removal would render blue
shelf) is the only cited geometry candidate in the province. **Declined:**
*"surroundings"* is not a bounded limit and cannot constrain a window more tightly
than the over-extension it would justify, and del Río's limit derives from **late**
Miocene formations (11.9–6.0 Ma), so it does not govern the 20–11 bin — most of
which is Hernández's separate **15–13 Ma** event, whose extent nobody retrievable
has mapped. Re-test once Tineo et al. 2024 is read.

**The Amazonian near-miss is refused outright.** Parra et al. 2026 would imply
`sm` over the Marañón where the model has none — ME-1 (23.03–17.7 Ma) straddles
29–20, where the box measures **0.00 % sea**. But its own abstract says it is
*"challenging existing models"*, its full text could not be read, and painting
`sm` there would assert the contested marine Amazonia against Jaramillo 2017,
Gross & Piller 2020 and Hoorn 2022. Record it; do not build it.

## 9. Witnesses to add

`WITNESS_CLASSES` rows in `scripts/research/palaeo_coastlines_correction.py`. All
twelve sets were re-measured point-by-point at `49ccb43` against `lm`, `sm` **and**
`m` (`probe4.py`, 12/12 exact, 0 mismatches); all four intervals are already in
`WITNESS_INTERVALS`. Existing `pebas-*` and `paranense-*` rows are not duplicated.

| Witness id | Position | Interval | Expected | Why it must not drift |
|---|---|---|---|---|
| `paranense-corrientes-tep` | (−57, −31) | `20-11` | `["sm"]` | the northern arm at its maximum |
| `paranense-corrientes-retreat` | (−57, −31) | `11-2` | `["lm"]` | **the most valuable new row.** The only point recording the late-Miocene withdrawal, on the correct side of del Río's Santa Fe limit; a recompile flipping it to `sm` would push the sea past a cited boundary |
| `paranense-chaco-parana` | (−60, −30) | `20-11` | `["sm"]` | second point for SA1 |
| `paranense-chaco-parana-pre` | (−60, −30) | `29-20` | `["lm"]` | the pre-transgression control at the Laguna Paiva type latitude. **No longer "the `FAIL` itself"** — §7 makes this the *cited* reading, so the row now guards a conclusion rather than a defect |
| `paranense-chaco-north-dry` | (−60, −25) | `20-11` | `["lm"]` | ~3° north of del Río's cited NW limit; guards against extending the sea into the northern Chaco |
| `paranense-chaco-west-dry` | (−64, −30) | `20-11` | `["lm"]` | the western limit Ruskin et al. 2011 explicitly *"discourage mapping"* past; pairs with `paranense-chaco-parana` to fix the embayment's width |
| `paranense-pampas-dry` | (−62, −36) | `11-2` | `["lm"]` | SA4; unconstrained by literature but a stable statement about the payload |
| `pebas-maranon-land` | (−75, −6) | `20-11` | `["lm"]` | third Pebas point; `sm` here would assert the contested marine Amazonia |
| `pebas-solimoes-land` | (−66, −4) | `11-2` | `["lm"]` | the Solimões basin, within ~230 km of Jaramillo's core 105-AM and inside Kern et al. 2020's lacustrine reading |
| `pebas-beni-land` | (−67, −10) | `20-11` | `["lm"]` | the Beni; SA10 is unconstrained, so this records the payload, not a claim |
| `andean-foreland-eocene-sea` | (−75, −4) | `37-29` | `["sm"]` | §3's unexplained pre-Neogene marine belt. Recorded so it is visible if it moves, **not** as an endorsement |
| `andean-foreland-oligocene-dry` | (−75, −4) | `29-20` | `["lm"]` | its disappearance; the negative control for the row above |

`BASIN_EDIT_WITNESSES` gains nothing — no op is proposed.

## Reproduction
```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
git show HEAD:public/data/reconstruction/cao-v2.4/palaeo-coastlines/<class>/<f> > scratch/
$PY probe.py   # points x intervals, province grids, connectivity, meridian reach
$PY probe2.py  # mountain-class membership, `neither` diagnosis, embayment bodies
$PY probe3.py  # window areas in km2, nearest-sm distances
$PY probe4.py  # exact class set for each proposed witness row (12/12)
```
Probes and raw output went to the session scratch directory
`…/scratchpad/paranense/`; that tier expires, and every number this memo relies
on is quoted above.
