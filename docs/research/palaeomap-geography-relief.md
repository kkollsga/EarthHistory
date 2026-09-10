# Palaeogeography, relief and climate-control source study

**Study date:** 2026-09-09
**Scope:** numeric relief and bathymetry, categorical land/shelf/highland/ice, plate-model compatibility, source-native ages, climate controls and reuse rights.
**Acquisition ledger:** [`palaeomap-geography-relief.inventory.json`](palaeomap-geography-relief.inventory.json)

## Decision

Use the **PALEOMAP v24221 0.1° NetCDF deposit** as the best immediately usable authored relief candidate in its **own PALEOMAP reconstruction family**. It has 113 actual grids from 0–750 Ma, explicit metres, a CC BY 4.0 record and an associated PALEOMAP plate model. It can support land, shallow shelf, deep basin and broad relief rendering. Its 0.1° cell spacing describes raster sampling, not observational accuracy: the surface was assembled from lithofacies, palaeoenvironment, tectonic history, palaeogeographic interpretation and modern analogues, with many intermediate scenes interpolated between manually edited maps.[^sw-report] Every rendered scene should therefore say **interpreted/modelled relief**.

Use **Cao et al. 2017** as a separate categorical cross-check for landmass, shallow marine, mountains and ice at 24 irregular reconstruction ages and validity intervals. It does not contain quantitative elevation or a deep-ocean class. Reconstruct its present-day-coordinate features with the Matthews et al. 2016 model supplied for that work; do not drape its polygons over PALEOMAP or a Cao/Müller 2024 globe by matching age alone.[^cao-paper]

Use **Pohl et al. 2022** as the compact climate scaffold: 28 climate-model experiments every 20 Ma from 0–540 Ma, with monthly temperature, precipitation, evaporation, runoff, precipitation-minus-evaporation and Köppen classes.[^pohl-data] It should control climate zones where its model is applicable. Palaeolatitude bands and Hadley-cell styling may provide a restrained visual guide between experiments, but they are a synthesis, not a recovered historical climate field.

Use a versioned full-plate model with explicit boundary/topology feature collections for spreading ridges and subduction zones. The acquired PALEOMAP v19o_r1d companion archive contains rotations, plate polygons, coast/country/ocean geometry, poles and hierarchy tables, but no resolved ridge/subduction feature collection. Relief shading is not a defensible substitute for boundary linework. The wider model comparison and long-term backbone candidates are documented in [Tectonics and palaeogeography](tectonics-and-paleogeography.md).

## What the requested sources actually contain

### Cao et al. 2017

Cao and colleagues converted Golonka's categorical Mollweide palaeogeographies back to present-day WGS84 coordinates, partitioned them into the Matthews et al. 2016 plate model, repaired gaps and overlaps manually, and revised maximum-transgression coastlines with 57,854 marine fossil collections downloaded from the Paleobiology Database on 2016-09-07.[^cao-paper] The reported improvement from roughly 75% to nearly 100% is consistency with the fossil collections used during revision. It is not independent validation of elevations or water depth.

The canonical GPlates 2.3 package contains four polygon collections in present-day coordinates:

| Layer | Records | Points | Distinct plate IDs | Missing time/ICS fields | Meaning |
|---|---:|---:|---:|---:|---|
| Ice | 253 | 6,739 | 16 | 2 | Categorical ice occurrence; only 10 of the 24 representative ages occur |
| Mountains | 4,789 | 137,373 | 72 | 18 | Broad mountain/highland category, not height |
| Landmass | 7,155 | 246,070 | 73 | 64 | Land category |
| Shallow marine | 13,395 | 334,043 | 75 | 3 | Shelf/epicontinental sea category, not depth |

The missing fields are real ingestion exceptions and must fail or be handled explicitly. Deep ocean is the residual background rather than a supplied feature class. The paper supplement also contains 24 LZW-compressed 6001 × 3001 RGB GeoTIFF maps; those pixels are a categorical illustration with grey modern reference outlines, not an elevation grid.

The linked GitHub repository is pinned at commit `e92592aae168a1653fe93716eb3c928ccc23fe54`, but GitHub reports no repository license. The paper itself is CC BY 3.0. The article supplement is associated with that article but contains no separate license file, so third-party material should be checked before derived raster redistribution. For categorical features, the official EarthByte GPlates 2.3 package is the clearer source: its collection page states CC BY 3.0 for EarthByte data.[^earthbyte-gplates] Public GitHub access and NOAA catalog display are not grants of reuse rights.

### PALEOMAP relief

The 2018 v2 deposit contains 109 numeric grids in each inspected 1° CSV, 1° NetCDF and 0.1° NetCDF archive, despite the report/catalog description of 117 PaleoDEMs.[^sw-data] The 1° NetCDF filenames use `385.2` and `390.5`; the embedded time table assigns the model ages 385 and 390 Ma. The CSV archive and 0.1° archive use 385 and 390. Consumers should use an explicit manifest age, never parse these two filename decimals as extra source ages.

The 0.1° grids are 3601 × 1801, global longitude −180° to 180° and latitude 90° to −90°, with 6,485,401 unmasked `float32` metre values per scene. The archive-wide inspected range is −11,000 to 10,500 m. The 1° NetCDF grids are 361 × 181 and reverse the latitude order. These differences require schema normalization before any downsampling or tiling.

The later v24221 deposit contains 113 0.1° numeric grids: the same 109 five-million-year ages through 540 Ma plus 600, 630, 690 and 750 Ma.[^phanero-supplement] It is not a byte-equivalent repackaging. The comparison matched all 109 shared ages by age and grid index after checking equal 3601 × 1801 shapes, identical coordinate direction/extents and coordinate differences no larger than 0.0000184° longitude and 0.00000916° latitude (float encoding differences, about two metres at the equator). Across those aligned grids, every elevation array differs from v2; per-slice RMSE ranges from 10.52 to 535.10 m, and the 230 Ma scene has the largest RMSE. The absolute maximum of 21,500 m occurs at the 0 Ma north-pole/west-endpoint cell and is a pole/seam correction signal rather than meaningful relief; excluding outer rows and columns, that scene's maximum change is 40 m. At 100 Ma, 2,822,329 cells differ, RMSE is 373.87 m and an interior land/ocean reclassification produces a 19,200 m maximum. This makes v24221 a material model update that needs visual and numerical acceptance rather than a silent replacement.

The new archive also has variable-name and metadata exceptions: 75 and 100 Ma name the data variable `elevation`, 630 Ma names it `630v23238bd`, coordinate/global attributes vary, and none of the 109 shared numeric variables carries a `units` attribute. The collection documentation establishes metres; the loader must record that external contract rather than pretend the file declares it. Select the single two-dimensional numeric variable by validated coordinates, then enforce expected shape, finite values, documented units and range. Do not encode a filename-derived variable-name assumption.

The report describes an authored reconstruction workflow: interpreted palaeogeographic maps and greyscale modern analogues were digitally edited, oceanic depth-age relations were used where possible, tectonic and sedimentological information constrained broad relief, and intermediate maps were interpolated.[^sw-report] It also calls the collection a first draft, documents residual errors/young features on old maps, and applies fixed −4,800 m deep Paleozoic oceans in part of the workflow to conserve ocean volume. These are valuable visual hypotheses, not measured palaeoelevations. Mountain peaks, trench depths and coastlines must not acquire cell-scale confidence from a dense raster.

### NOAA Science On a Sphere catalog

The NOAA page, added 2019-02-27, describes and displays 91 PALEOMAP image maps from present to 750 Ma and credits Christopher Scotese.[^noaa] It does not publish a numeric elevation archive or state a reuse license for the third-party artwork. NOAA hosting does not make the imagery, movie or underlying PALEOMAP work a US-government public-domain product. Use the page as descriptive provenance only; source numeric relief from the explicit CC BY 4.0 Zenodo records.

## Complete source-native time inventories

Keep independent age lists for each source. A plate rotation evaluable at an arbitrary time does not create a new relief reconstruction, categorical map or climate experiment. Interpolated display states must retain the bracketing source ages and be labelled interpolation/synthesis.

**PALEOMAP v2 numeric relief — 109 ages (Ma):** 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170, 175, 180, 185, 190, 195, 200, 205, 210, 215, 220, 225, 230, 235, 240, 245, 250, 255, 260, 265, 270, 275, 280, 285, 290, 295, 300, 305, 310, 315, 320, 325, 330, 335, 340, 345, 350, 355, 360, 365, 370, 375, 380, 385, 390, 395, 400, 405, 410, 415, 420, 425, 430, 435, 440, 445, 450, 455, 460, 465, 470, 475, 480, 485, 490, 495, 500, 505, 510, 515, 520, 525, 530, 535, 540.

**PALEOMAP v24221 numeric relief — 113 ages (Ma):** the complete v2 list above plus 600, 630, 690 and 750. There is no numeric evidence in this archive for 545–595, 605–625, 635–685 or 695–745 Ma.

**Cao et al. 2017 categorical palaeogeography — 24 representative ages (Ma):** 6, 14, 22, 33, 45, 53, 76, 90, 105, 126, 140, 152, 169, 195, 218, 232, 255, 277, 287, 302, 328, 348, 368, 396.

Their source intervals (younger–older Ma) are: 2–11, 11–20, 20–29, 29–37, 37–49, 49–58, 58–81, 81–94, 94–117, 117–135, 135–146, 146–166, 166–179, 179–203, 203–224, 224–248, 248–269, 269–285, 285–296, 296–323, 323–338, 338–359, 359–380 and 380–402. Use `FROMAGE`/`TOAGE` and ICS attributes as validity, not nearest-age snapping.

**Pohl et al. 2022 climate experiments — 28 ages (Ma):** 0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 340, 360, 380, 400, 420, 440, 460, 480, 500, 520, 540.

The PALEOMAP relief and Pohl climate lists happen to share some ages and input lineage. That is not permission to combine their arrays without recording each source's grid, experiment, frame and preprocessing.

## Climate and latitude controls

The inspected Pohl archive has 28 files on a 128 × 128 grid with 12 monthly values for climate variables. Longitude cell centres are 1.40625°–358.59375° at 2.8125° spacing; latitude centres are approximately −89.296875°–89.296875° at 1.40625° spacing. Variables include land-only `topo` in metres, Köppen codes 1–13, precipitation, topsoil/surface temperature, evaporation, runoff and precipitation-minus-evaporation. Ocean fill values are near `9.969e36` and are not consistently surfaced through library mask metadata; ingestion must mask `abs(value) >= 1e30`.

Across all inspected experiments, valid land topography spans 20–8,477.64 m. Monthly surface temperature spans −62.799–44.401 °C and precipitation 0.000194–29.1387 mm/day. The `topo` array is land-only and much coarser than PALEOMAP; it is a climate boundary condition/alignment check, not ocean bathymetry or a replacement globe surface. FOAM 1.5 uses a slab mixed-layer ocean, so the product can support broad continental climate and seasonality but not detailed palaeo-ocean currents.[^pohl-paper]

Express climate mainly through continuous natural surface coloration derived from compatible temperature, moisture, seasonality and elevation controls. A visible pole indicator and thin optional latitude/atmospheric-circulation guides can make palaeolatitude legible, but broad translucent sector polygons would read as hard climate boundaries and should remain hidden in the normal view. Any guide should be labelled **latitude guide** or **procedural climate guide**. Real temperature and aridity depend on palaeolatitude, palaeogeography, elevation, CO₂, solar luminosity, circulation and seasonality; fixed modern latitude bands are not a climate reconstruction. Where Pohl fields exist, derive broad climate presentation from monthly fields/Köppen classes at the native experiment age. Between ages, state the bracketing experiments and display interpolation status.

## Compatible uses and forbidden shortcuts

| Need | Defensible source/use | Shortcut to reject |
|---|---|---|
| Globe relief, land/sea, shelf and basin depth | v24221 PaleoDEM in native PALEOMAP geometry, with interpreted/modelled status | Treating 0.1° as cell-scale geological accuracy |
| Categorical land, shallow sea, mountain and ice check | Cao 2017 features reconstructed with their supplied Matthews-family rotations and validity intervals | Combining same-age Cao polygons with PALEOMAP elevations without coordinate conversion |
| Ridges, transforms and subduction | Versioned plate-model topology/boundary features with type and polarity | Tracing relief colours or plate polygon edges as active boundaries |
| Broad climate and biomes | Pohl monthly fields and Köppen codes at its 28 native experiment ages | Painting fixed latitude bands as historical climate evidence |
| Intermediate animation | Explicit interpolation/synthesis carrying source IDs, bracketing ages and uncertainty | Inventing extra evidence slices or reporting a continuous observation |
| Country reference overlay | Modern-country reference reconstructed only with compatible plate IDs/rotations; fade unsupported fragments | Pixel-derived outlines or implying historical states existed in deep time |

Coordinate conversion between plate families is a scientific operation, not a projection change. A defensible conversion would identify common crustal fragments, map plate IDs, reconstruct to a shared present-day geometry or explicitly rotate fragment vertices between frames, quantify residual position/area differences at benchmark ages, and preserve unmapped/ambiguous regions. Until that exists, keep model families as separate scenes or comparison layers.

## Recommended ingestion contract

Each produced scene should carry:

- dataset record and file hash, version, source-native age and requested display age;
- model family, rotation/version, reference frame, anchor plate, coordinate convention and plate-ID namespace;
- value meaning and units, source grid shape/order, mask rule and resampling method;
- evidence class (`categorical reconstruction`, `authored/modelled relief`, `climate-model output`, `interpolation` or `artistic gap-fill`);
- temporal validity or bracketing ages, plus explicit spatial/age uncertainty where published;
- license ID, attribution text and source URL.

Preserve sharp class boundaries for Cao categories unless the UI explicitly renders uncertainty. For relief, downsample with an antialiasing method that preserves land/sea and shelf thresholds deliberately; a simple nearest-neighbour decimation can erase narrow islands and ridges, while unconstrained averaging can move coastlines. Retain native min/max, land fraction, shelf-area and checksum diagnostics per output tile. Country outlines should remain vector geometry through preprocessing and rendering, with latitude/pole guides generated analytically, so neither acquires raster pixelation from the relief texture.

## Implemented checkpoint

The application keeps the two reconstruction families explicit. The default PALEOMAP view now serves all 109 native v2 ages from 0 through 540 Ma as compact 1° signed-metre grids. It does not silently substitute the materially different v24221 relief. Within a source-age bracket, a model-qualified v2d3 material resolver moves only fragments with defensible ownership; unmapped ancient material retains one declared native endpoint rather than receiving fabricated motion. Broad albedo variation and source-ruggedness-conditioned lighting normals are deterministic visual synthesis anchored to stable material coordinates. Physical vertex positions remain the signed PaleoDEM heights. Surface and seafloor roughness are explicit rendering conventions, not measured palaeoroughness fields.

A separately labelled Cao 2.4 view uses target-native static continents, ocean topologies, typed plate boundaries, subduction polarity and model-derived ocean lifecycle controls. PALEOMAP continental height enters that view only through a frame-qualified fragment crosswalk. Unsupported continental material stays visibly unavailable, and PALEOMAP ocean pixels never become Cao ocean bathymetry. Resolved ocean cells may use a topology-slot-matched ridge-attributed lifecycle interval with the Stein and Stein GDH1 relation; this is explicitly synthesis, not measured ancient seafloor age or depth. Exact native ages use resolved source boundaries. Fractional boundary geometry uses only validated same-feature links; splits, merges, reversals and the 250–255 and 410–415 Ma source crossovers remain unsupported.

Country references, points of interest, terrain, boundaries and displayed height sampling now publish at one displayed age. The renderer retains the previous complete surface while a new age stages, and it distinguishes requested, staged and displayed ages. The optional Cao surface is deliberately coarser than the default PALEOMAP view so its source conversion remains within the production CPU bound. Its data gaps and coarse coast geometry are visible limitations, not evidence of a globally complete conversion.

The detailed model, crosswalk, lifecycle, boundary-link and oracle evidence is in [Palaeomap plate foundation](palaeomap-plate-foundation.md). Production timing, memory, rejected predecessors and the measured input-publication cadence are in [Palaeomap render validation](palaeomap-render-validation.json).

A material-following source check of the western Norway Caledonian corridor found a native PaleoDEM centre height of 2,542 m at 420 Ma, 2,249 m at 390 Ma, 2,517 m at 355 Ma and 290 m at 0 Ma.[^sw-data] Equal-camera captures therefore show the authored orogenic high and much lower modern elevation at the same present anchor, but the intermediate grids do **not** independently resolve or validate a monotonic Devonian extensional-collapse history. The modern height cannot be attributed directly to Caledonian relief because later uplift, exhumation and glacial incision contribute. Persistent high Devonian relief is not itself a geological contradiction: extension and exhumation need not produce monotonic lowering at one sampled corridor. The exact reconstructed centres, equal-view captures and hashes are recorded in [Palaeomap render validation](palaeomap-render-validation.json); the three-corridor scientific audit is in [Caledonian relief and collapse check](palaeomap-caledonian-test.md).

## Acquisition and remaining blockers

The bounded external study store occupies **1,173,639,168 bytes** of its 1.5 GiB allowance. It contains the Cao paper/repository/supplement, official EarthByte categorical package, three v2 PaleoDEM forms, the v24221 relief and plate-model archives, the PaleoDEM report and Pohl climate archive. All file hashes, upstream checksums, exact URLs and license evidence are in the adjacent tracked inventory. These are research inputs only; no runtime path may depend on the external directory.

Remaining work and stop conditions are:

1. Validate v24221 as a complete model update before it can replace v2: normalize its schema exceptions, repeat coastal and relief comparisons, and preserve a compact static budget. Its four older grids are real source ages, but they do not justify invented intermediate relief.
2. Keep the default PALEOMAP view free of active ridge/subduction claims until a PALEOMAP-frame typed boundary collection is acquired. Relief colour and polygon edges are not substitutes.
3. Treat the Cao view as a partial, separately labelled conversion. A globally complete palaeoelevation migration remains stopped because stable continental crosswalk coverage is below its acceptance threshold and no Cao-native global orogen-height field was accepted.
4. Reuse only the licensed official EarthByte categorical package and licensed Zenodo products. The unlicensed GitHub working copy and article-supplement raster pixels remain research-only.
5. Treat the 2026 EarthByte palaeotopography data-assimilation repository as research-only until its promised paper and Zenodo output are published and licensed. The repository currently has no corrected 109-grid release or stable dataset DOI.[^assimilation]

## Sources

[^cao-paper]: W. Cao et al. (2017), [“Improving global paleogeography since the late Paleozoic using paleobiology”](https://doi.org/10.5194/bg-14-5425-2017), *Biogeosciences* 14, 5425–5439; [article files and CC BY 3.0 statement](https://bg.copernicus.org/articles/14/5425/2017/).
[^earthbyte-gplates]: EarthByte, [GPlates 2.3 software and data sets](https://www.earthbyte.org/gplates-2-3-software-and-data-sets/) and [Cao palaeogeography package](https://www.earthbyte.org/webdav/ftp/earthbyte/GPlates/GPlates2.3_GeoData/Individual/Paleogeography.zip).
[^sw-data]: C. R. Scotese and N. Wright (2018), [PALEOMAP Paleodigital Elevation Models for the Phanerozoic, exact Zenodo record 5460860](https://zenodo.org/records/5460860), CC BY 4.0.
[^sw-report]: C. R. Scotese and N. Wright (2018), [PaleoDEM report PDF](https://zenodo.org/records/5460860/files/Scotese_Wright2018_PALEOMAP_PaleoDEMs.pdf?download=1).
[^phanero-supplement]: C. R. Scotese et al. (2024), [An atlas of Phanerozoic paleogeographic maps: the seas come in and the seas go out, Zenodo record 10659112, v24221](https://zenodo.org/records/10659112), supplement to [DOI 10.1144/SP544-2024-28](https://doi.org/10.1144/SP544-2024-28), CC BY 4.0 dataset record.
[^noaa]: NOAA Science On a Sphere, [PALEOMAP PaleoAtlas for GPlates, 0–750 million years ago](https://sos.noaa.gov/catalog/datasets/paleomap-paleoatlas-0-750-million-years-ago/), catalog page added 2019-02-27.
[^pohl-data]: A. Pohl et al. (2022), [Phanerozoic continental climate dataset, Zenodo record 6620748](https://zenodo.org/records/6620748), CC BY 4.0.
[^pohl-paper]: A. Pohl et al. (2022), [“A gridded dataset of a global climate simulation over the Phanerozoic”](https://doi.org/10.1016/j.dib.2022.108424), *Data in Brief* 42, 108424.
[^assimilation]: EarthByte, [paleotopo-data-assimilation repository](https://github.com/EarthByte/paleotopo-data-assimilation), inspected at commit `d199e1f` on 2026-09-09; repository documentation still identifies the methodology paper and companion data DOI as forthcoming.
