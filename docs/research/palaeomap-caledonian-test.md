# Caledonian relief and collapse check

**Status:** accepted bounded source audit, 2026-09-09
**Question:** Does the current PALEOMAP surface capture Caledonian mountain building, Devonian collapse, and later topographic traces in Norway, Scotland, and East Greenland?

## Result

The current source **partly captures the history**. Its native 1° PaleoDEM slices contain a coherent high-relief belt across material-following western Norway, northwest Scotland, and East Greenland by 420 Ma. Equal-view production captures show broad high terrain, but no diagnostic collapse or remnant-belt morphology. The test does **not** establish that the surface captures Devonian extensional collapse as a process. Relief stays high through the dated collapse windows, but that is not itself a contradiction: extension, exhumation, basin formation, and retained relief can coexist, and the cited literature supplies no quantitative palaeoelevation curve against which to judge the DEM.

There is no named Caledonian event, detachment, or orogenic-age control in the runtime data. The surface is therefore an authored palaeotopographic interpretation, not an event-resolved tectonic model. Modern trace relief appears coarsely, especially in East Greenland, but present height must not be described as a direct remnant of Caledonian altitude. Subsequent erosion, burial/exhumation, rifting, Cenozoic vertical motion, and glacial incision all contribute.

## Geological windows used

- Collision and mountain building were diachronous. An official NGU synthesis gives a broad 450–400 Ma spread for reliable Caledonian metamorphic ages and explicitly warns that a single 425 Ma collision age is an oversimplification. GEUS describes the 1,300 km East Greenland thrust system as the product of mid- to late-Silurian Scandian collision. These sources support inspection at 440, 430, 425, 420, 410, and 400 Ma rather than a one-frame peak test.
- Collapse is a structural and exhumational history rather than a prescribed elevation curve. Thermochronology in north-central Norway dates late-orogenic extension at about 409–388 Ma and 371–355 Ma. East Greenland records extension and exhumation from about 419–401 Ma, Middle Devonian faulting near 385 Ma, and renewed activity around 357 Ma. The classic regional interpretation links Devonian Old Red Sandstone basins in northwest Scotland, Norway, and East Greenland to extension of overthickened Caledonian crust.
- Present Scandinavian relief is not a clean survival metric. Published interpretations differ over the relative roles of long-lived exhumation and younger vertical motion. A recent synthesis argues for Miocene and Pliocene uplift and subsequent incision, while other work stresses protracted post-Caledonian exhumation and erosion. The defensible statement is that modern relief overlies Caledonian rocks but does not preserve their original elevation unchanged.

## Native-data test

The probe uses the same-family PALEOMAP v3/v2d3 motion catalog and 109 native PaleoDEM ages. It does not sample fixed modern coordinates at ancient ages.

1. Six present-day points along western Norway, five in northwest Scotland, and five in East Greenland were independently assigned to PALEOMAP 0 Ma static fragments.
2. Each point was reconstructed to every native 5 Ma age with its assigned finite-rotation circuit and fragment validity.
3. The reconstructed longitude/latitude was bilinearly sampled in that age's 360 × 181 signed-elevation grid. No temporal interpolation or Cao/PALEOMAP frame mixing was used.
4. Corridor medians and ranges report the source grid in physical metres. They test whether a regional relief signal exists; they do not identify its geological cause.

The material assignments are stable within each corridor: western Norway is plate 301, East Greenland plate 102, and northwest Scotland is principally plate 303 with one plate-313 margin point. All 16 samples remain evaluable over the inspected ages.

| Native age | Western Norway median | NW Scotland median | East Greenland median | Reading |
|---:|---:|---:|---:|---|
| 440 Ma | −687 m | 300 m | −1,078 m | Orogen-scale high relief is not yet coherent across all corridors. |
| 430 Ma | −822 m | 831 m | 287 m | Scotland and Greenland rise before the Norway corridor in this coarse interpretation. |
| 425 Ma | −528 m | 1,127 m | 570 m | Diachronous transition; Norway remains below datum. |
| 420 Ma | 2,510 m | 2,376 m | 1,394 m | First sampled slice with strong positive relief in all three corridors. |
| 410 Ma | 2,066 m | 1,765 m | 1,805 m | High relief persists as dated extension begins in some sectors. |
| 400 Ma | 2,434 m | 2,201 m | 1,166 m | High relief remains during the broad collapse/exhumation interval. |
| 390 Ma | 2,267 m | 2,137 m | 1,824 m | No coherent belt-wide lowering signal. |
| 380 Ma | 2,155 m | 2,115 m | 2,434 m | East Greenland rises while the other corridor medians remain high. |
| 355 Ma | 2,464 m | 1,914 m | 2,117 m | Relief remains high at the end of the later Norwegian extensional pulse. |
| 300 Ma | 520 m | 838 m | 1,972 m | Later regional divergence is resolved. |
| 0 Ma | 85 m | 80 m | 1,280 m | Coarse coastal-corridor traces; not original Caledonian altitude. |

Because the Norway and Scotland corridors deliberately follow the exposed belt near the Atlantic margin, their 0 Ma medians include coastal and offshore 1° cells. Three independently partitioned inland sentinels check the source for surviving interior relief without replacing those corridor statistics:

| Sentinel | 420 Ma | 390 Ma | 355 Ma | 300 Ma | 100 Ma | 0 Ma |
|---|---:|---:|---:|---:|---:|---:|
| Jotunheimen (8.2° E, 61.6° N at present) | 1,984 m | 1,952 m | 2,214 m | 787 m | 1,025 m | 1,237 m |
| Hardangervidda (7.5° E, 60.2° N at present) | 1,569 m | 2,330 m | 2,168 m | 931 m | 793 m | 1,212 m |
| Cairngorms (3.7° W, 57.1° N at present) | 2,312 m | 2,429 m | 1,862 m | 754 m | 975 m | 558 m |

NGU identifies the Jotun Nappe Complex with the southern Norwegian Caledonides and Hardangervidda–Ryfylke as a formal nappe complex; BGS places the Cairngorm granite suite within late Caledonian Grampian magmatism. Their present-day values confirm that the source does contain interior trace terrain despite the low coast-corridor medians. They do not show that the modern elevations survived from 420 Ma: the same points pass through later authored relief states, and the post-Caledonian topographic history remains independently constrained.

The decisive positive result is the spatially coherent 420 Ma relief signal. The decisive limitation is epistemic: the same raster time series has no structural control that can distinguish collapse, exhumation, basin subsidence, or retained mountains. Persistent high median elevation cannot validate or falsify the geological collapse model. The 355 Ma sample is just younger than the Devonian–Carboniferous boundary; it is retained because the cited 371–355 Ma pulse spans that boundary. A UI chapter that labels this frame Devonian is a separate narrative-age issue, not evidence about the orogen.

For equal-view visual checks, use reconstructed material coordinates rather than the modern locations. The western-Norway center is at (−10.165579°, −12.328127°) at 420 Ma, (0.416955°, −14.559167°) at 390 Ma, (0.123303°, −3.167006°) at 355 Ma, and (6.5°, 62.5°) at 0 Ma. Hold camera distance, field of view, and relief exaggeration constant across frames.

## Product consequence

The app may describe the 420 Ma surface as **PALEOMAP-authored orogenic relief consistent in timing and extent with the Caledonian belt**. It should describe 390 and 355 Ma as source-native palaeotopography during independently documented extensional windows, without claiming that the raster proves collapse. A future positive collapse test needs source-qualified detachment/basin controls or an explicitly modeled crustal-thickness/topography history; NSTA Devonian faults, facies, and Caledonian basement are subsurface geological context rather than elevation observations.

## Evidence and reproducibility

- Compact tracked result: [`palaeomap-caledonian-validation.json`](./palaeomap-caledonian-validation.json).
- Full 109-age material samples: `/Volumes/EksternalHome/Koding/HTML/EarthHistory-data/palaeomap-study/verification/caledonian-material-height-probe.json` (997,187 bytes; SHA-256 `586f8303c0b1096d39aaeeeb6162d21892ce5d38c70e16290ee67ba2c9b54c1a`).
- Reproducible probe: `/Volumes/EksternalHome/Koding/HTML/EarthHistory-data/palaeomap-study/verification/caledonian-material-height-probe.mjs` (6,168 bytes; SHA-256 `5c2640927b042dc80047c803d98405053dee92af61325cbc33c58b491ef13662`).
- Equal-view production metadata: `/Volumes/EksternalHome/Koding/HTML/EarthHistory-data/palaeomap-study/verification/caledonian-source-sequence.json` (24,603 bytes; SHA-256 `c20e6da4fe63cdc27a3851f89359a25ad5380196e7ed1d4cfaa0140554534cb2`). The four PNGs total 2,212,298 bytes and were captured from production entry SHA-256 `2b444482ef51a391b6a3a37c0e5dd2311d04fbeff5c555b2f1b7edc310bb585c` with relief 18, camera distance 1.8200, and the restored projected high-quality PALEOMAP LOD policy. Ages, reconstructed centers, and sampled source heights match the numeric test. The earlier `261a38cf…` lower-LOD files were overwritten and are superseded; their former PNG hashes are not current-file evidence. `caledonian-final-420ma.png` is a byte-identical alias of the current 420 Ma image (549,543 bytes; SHA-256 `d3f8bd8b26dd5fbce055a9f340b8ba8b7e6de6557aaefba8106e6f827bb899a1`).
- Inland-sentinel data: `/Volumes/EksternalHome/Koding/HTML/EarthHistory-data/palaeomap-study/verification/caledonian-inland-sentinels.json` (6,085 bytes; SHA-256 `2b3287ef1a5c300f677bc67362c9564aab730f6f48e8315ac004488fdd2e0156`); generator `.mjs` (3,295 bytes; SHA-256 `b3e46233305b4ce9743833840cb07370e623bb36854ff740982fd8655e79bad4`).
- Storage bound: the numeric probe, generator, metadata, and four PNGs remain below 4 MiB. Cleanup owner is the EarthHistory palaeomap-study verification owner.

## Primary and official sources

All links were retrieved 2026-09-09.

- Geological Survey of Norway, *Phanerozoic palaeogeography and geodynamics*, NGU Report 98.001. The report discusses the 450–400 Ma metamorphic-age spread and Emsian collapse: <https://static.ngu.no/upload/Publikasjoner/Rapporter/1998/98_001.pdf>.
- Steltenpohl, M. G., Carter, B. T., Andresen, A., and Zeltner, D. L. (2009), “40Ar/39Ar Thermochronology of Late- and Postorogenic Extension in the Caledonides of North-Central Norway,” *Journal of Geology* 117, 399–414. <https://doi.org/10.1086/599217>.
- Leslie, A. G. and Higgins, A. K. (2008), “Foreland-propagating Caledonian thrust systems in East Greenland,” GEUS publication record. <https://pub.geus.dk/en/publications/foreland-propagating-caledonian-thrust-systems-in-east-greenland/>.
- Hartz, E. H. and Andresen, A. (2001), “Syncontractional extension and exhumation of deep crustal rocks in the East Greenland Caledonides,” *Tectonics* 20, 58–77. <https://doi.org/10.1029/2000TC900020>.
- White, A. P. and Hodges, K. V. (2002), “Multistage extensional evolution of the central East Greenland Caledonides,” *Tectonics* 21, 1048. <https://doi.org/10.1029/2001TC001308>.
- Larsen, P.-H. and Bengaard, H.-J. (1991), “Devonian basin initiation in East Greenland: a result of sinistral wrench faulting and Caledonian extensional collapse,” *Journal of the Geological Society* 148, 355–368. <https://doi.org/10.1144/gsjgs.148.2.0355>.
- McClay, K. R., Norton, M. G., Coney, P., and Davis, G. H. (1986), “Collapse of the Caledonian orogen and the Old Red Sandstone,” *Nature* 323, 147–149. <https://doi.org/10.1038/323147a0>.
- Searle, M. P. (2022), “Tectonic evolution of the Caledonian orogeny in Scotland: a review based on the timing of magmatism, metamorphism and deformation,” *Geological Magazine* 159. <https://doi.org/10.1017/S0016756821000947>.
- Japsen, P. et al. (2022), “The Norwegian mountains: the result of multiple episodes of uplift and subsidence,” *Geology Today* 38. <https://doi.org/10.1111/gto.12377>.
- Nielsen, S. B. et al. (2009), “The evolution of western Scandinavian topography: A review of Neogene uplift versus the ICE (isostasy–climate–erosion) hypothesis,” *Journal of Geodynamics* 47. <https://doi.org/10.1016/j.jog.2008.09.001>.
- Geological Survey of Norway, “Structure of the Jotun Nappe Complex, Southern Norwegian Caledonides.” <https://www.ngu.no/publikasjon/structure-jotun-nappe-complex-southern-norwegian-caledonides-ambiquity-gravity>.
- Geological Survey of Norway, “Hardangervidda–Ryfylke Nappe Complex,” official geologic-unit record. <https://aps.ngu.no/pls/utf8/geoenhet_SokiDb.Vis_enhet?p_id=145748&p_spraak=N>.
- British Geological Survey, “Post-tectonic granitoid intrusions, Caledonian magmatism, Grampian Highlands.” <https://earthwise.bgs.ac.uk/index.php/Post-tectonic_granitoid_intrusions%2C_Caledonian_magmatism%2C_Grampian_Highlands>.

The PALEOMAP model/archive provenance, redistribution terms, and exact v2d3 compatibility evidence are recorded in [`palaeomap-plate-foundation.md`](./palaeomap-plate-foundation.md) and [`palaeomap-plate-foundation-inventory.json`](./palaeomap-plate-foundation-inventory.json).
