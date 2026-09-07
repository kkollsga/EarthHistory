# Climate, biomes, surface water, atmosphere, and researched points of interest

Status: first-pass research memo for architecture discussion, 2026-09-07. This is a source and interpretation plan, not an approved build specification.

## Recommendation

Use a tiered reconstruction rather than implying that one continuous, equally certain model exists from 4.54 Ga to today.

1. **Earth formation to the first Phanerozoic environmental-model slice (about 540 Ma):** treat biome, hydrology, ice, cloud, and camera-ready atmosphere/ocean appearance as explicit scenarios. This does not imply that paleogeographic or tectonic models are absent: dedicated plate-reconstruction work can supply modeled geography for parts of deep time, including published models extending into the Proterozoic. Keep that tectonic provenance separate from the much weaker environmental-state evidence. Render broad environmental states constrained by geochemistry and isolated surviving rocks; offer alternatives where interpretations differ.
2. **PALEOMAP/model coverage at 540 Ma–21 ka:** use PALEOMAP PaleoDEM as the land/sea and relief scaffold and climate-model snapshots as the environmental scaffold. Pohl et al. (28 snapshots) is the smallest coherent prototype dataset because it already contains monthly temperature, precipitation, evaporation, runoff, topography, and Köppen–Geiger classes. The denser HadCM3L/PhanDA priors (109 time slices, multiple CO2/model configurations) are a candidate for greater temporal density; validate their variables, grids, proxy agreement, and visual fitness against Pohl before promoting them to the production backbone. The dataset's 540 Ma start is a historical/model coverage limit, not the current formal base-Cambrian age; timeline labels must come from a separately versioned ICS timescale.
3. **21 ka–present:** use CHELSA-TraCE21k for centennial climate, evolving orography, snow-cover days and ice-sheet surface altitude; use pollen/plant-macrofossil evidence to validate vegetation. Blend into observed modern land cover, hydrography, glaciers, and bathymetry near the present.

Textures should be generated offline from versioned source rasters and served as tiled color/material/height products. A high-resolution texture can look plausible at regional zoom, but the UI must not let cosmetic upsampling imply scientific resolution. At 1 degree, a source cell is roughly 111 km north–south; named deep-time rivers and fine biome boundaries are usually inventions unless backed by regional evidence.

## Core datasets and fitness

| Source | Coverage and useful variables | Native scale / format | Rights verified on 2026-09-07 | Fitness and limitation |
|---|---|---|---|---|
| [Scotese & Wright PALEOMAP PaleoDEM](https://www.earthbyte.org/paleodem-resource-scotese-and-wright-2018/) ([Zenodo DOI](https://doi.org/10.5281/zenodo.5460860)) | 117 estimated paleotopography/bathymetry surfaces, 540 Ma–present, about 5 Myr spacing | 1 degree CSV/NetCDF; 0.1 degree NetCDF also deposited | [CC BY 4.0](https://www.earthbyte.org/webdav/ftp/Data_Collections/Scotese_Wright_2018_PaleoDEM/License.txt) | Best common relief/shoreline scaffold. Elevation is reconstructed and especially uncertain inland; 0.1 degree sampling is not 0.1 degree knowledge. |
| [Pohl et al. 2022 Phanerozoic continental climate](https://doi.org/10.1016/j.dib.2022.108424) ([data](https://doi.org/10.5281/zenodo.6620748)) | 28 evenly spaced slices, 540–0 Ma; monthly surface/topsoil temperature, precipitation, evaporation, P-E, runoff, topography, and 13 Köppen–Geiger classes | FOAM atmosphere 1.4 x 2.8 degrees with slab ocean; NetCDF and CSV | Dataset record: CC BY 4.0. Article is CC BY-NC-ND, so cite the data DOI for transformed data products. | Excellent prototype and cross-check because hydrology and climate class are included. Sparse in time and only a slab mixed-layer ocean; do not use it to claim detailed currents or a unique river course. |
| [Valdes, Scotese & Lunt 2021](https://doi.org/10.5194/cp-17-1483-2021); [BRIDGE index](https://www.paleo.bristol.ac.uk/ummodel/scripts/papers/Valdes_et_al_2021.html); [PhanDA HadCM3L priors](https://doi.org/10.5281/zenodo.8237750) | 109 stage-level time slices, 541–0 Ma. Zenodo contains eight suites and 4,360 twenty-year priors with 2 m air temperature, SST, surface salinity, and precipitation | Boundary-condition paleogeography was prepared on an approximately 1 degree grid; HadCM3L atmosphere output is 2.5 x 3.75 degrees and ocean output is nominally 1.25 x 1.25 degrees. NetCDF: 17,440 files, roughly 20 GB; inspect each variable's coordinates before processing. | Zenodo model priors: CC BY 4.0 | Candidate for a denser Phanerozoic backbone, subject to validation. Different CO2 curves/configurations are valuable alternatives, not nuisance duplicates. Climate is simulated, paleogeography is reconstructed, and pre-Cenozoic proxy validation is sparse. |
| [PhanDA / Judd et al. 2024](https://doi.org/10.1126/science.adk3705); [reproduction repository](https://github.com/EJJudd/PhanDA) | Data assimilation over 485 Myr; GMST/CO2 ensemble and 85 assimilated slices with gridded surface-temperature posterior percentiles | CSV and MATLAB outputs; NetCDF priors | Priors are CC BY 4.0. No explicit license was visible in the PhanDA GitHub repository during this review; verify permission for packaged posterior products before redistribution. | Use percentiles to calibrate global and latitudinal temperature and expose uncertainty. It does not reconstruct vegetation or exact geography. |
| [DeepMIP-Eocene-p1](https://doi.org/10.1038/s41597-024-03773-4); [CEDA record](https://catalogue.ceda.ac.uk/uuid/95aa41439d564756950f89921b6ef215/) | 35 simulations from nine coupled models: 26 EECO experiments at 1–9 x preindustrial CO2 and nine preindustrial controls; 57 atmosphere/ocean variables | Native model grids, plus common-grid script; CF 1.8 NetCDF; 168 GB; HTTP/Wget/FTP/OPeNDAP | CEDA says public access but “Permitted Use: Undefined” and applies CMIP6 terms. Inspect per-model/file license attributes before commercial redistribution. DeepMIP also asks that model providers be offered co-authorship for research papers using downloaded output. | Preferred event-specific ensemble near 50 Ma. Use ensemble spread and both reference frames. It is an EECO ensemble, not a general Cenozoic series or direct observation. |
| [PaleoClim](https://doi.org/10.1038/sdata.2018.254) | Selected terrestrial snapshots: MIS M2 at about 3.3 Ma, mid-Pliocene warm period 3.264–3.025 Ma, and MIS19 about 787 ka; monthly temperature/precipitation and 19 bioclim variables | Downscaled to 2.5 arc-minutes (~5 km); GeoTIFF; native HadCM3 atmosphere is 2.5 x 3.75 degrees | CC BY (paper and data statement) | Useful regional-detail layer at its named snapshots. The fine grid is change-factor downscaling, not direct 5 km paleo-observation; the paper explicitly notes uncertain Pliocene ice-sheet locations and reused boundary conditions. |
| [CHELSA-TraCE21k](https://doi.org/10.5194/cp-19-439-2023); [current centennial products](https://www.chelsa-climate.org/datasets/chelsa-trace21k-centennial-bioclim) | 21 ka–0, every 100 years; monthly temperature/precipitation; current bioclim product also gives evolving orography, ice surface altitude, and snow-cover days | 30 arc-second (~1 km) Cloud Optimized GeoTIFF | Original EnviDat release states CC BY 2.0; current CHELSA centennial/bioclim pages state CC0 1.0. Record exact product/version and its license. | Best bridge from LGM to present. It downscales one TraCE-21k/CCSM3 trajectory and inherits ICE-6G_C assumptions. |
| [BIOME 6000](https://doi.org/10.1046/j.1365-2699.2000.00425.x); [NOAA archive](https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=noaa-recon-6246) | Site-based pollen and macrofossil biome reconstructions for LGM, mid-Holocene, and modern comparison | Point/site tables in native archive formats | NOAA requires dataset plus original-publication citation; the landing-page rights field is not explicit enough for bundled redistribution. Treat as attribution-required and verify file-level terms. | Validation evidence for modeled vegetation, not a seamless raster. Sampling is geographically uneven and taxonomic assignments are reconstructed. |
| [Neotoma Paleoecology Database](https://www.neotomadb.org/data/data-use-and-embargo-policy) | Pliocene–present community-curated pollen, plant macrofossil, diatom, fauna, and geochemistry records; public REST API and snapshots | Point samples / JSON API / database dump | CC BY 4.0; must cite Neotoma, each constituent database, original investigators/publications, and dataset DOIs | Best detailed late Cenozoic ground truth. Never turn point density directly into vegetation density because collection effort is uneven. |
| [Paleobiology Database API](https://doi.org/10.1017/PAB.2015.39) | Fossil occurrences throughout the Phanerozoic, with ages and modern coordinates; API can supply plant and ecosystem evidence | Point records; JSON/CSV from API | Public records CC BY 4.0; publications should request a PBDB publication number and retain primary references | Good evidence pins and taxon-era masks. Modern fossil locality and reconstructed life locality are separate fields. Sampling and preservation bias are severe. |
| [BIOME4](https://github.com/jedokaplan/BIOME4); [Kaplan et al. 2003](https://doi.org/10.1029/2002JD002559) | Potential natural vegetation from monthly temperature, cloud/sunshine, precipitation, soils, CO2; 12 plant functional types | Arbitrary lon/lat grid; Fortran; NetCDF in/out | Source repository: GPL-2.0 | Useful scientific classifier and sensitivity reference. It was calibrated for modern plant functional types and cannot be applied unchanged before those clades/ecologies evolved. Generated biome data need an explicit evolutionary mask. |
| [ESA WorldCover 2021](https://esa-worldcover.org/en/data-access) | 11 observed modern land-cover classes | 10 m raster / web services | CC BY 4.0 with specified attribution | Modern end-state and color/material calibration. Reported global overall accuracy is 76.7%; it is land cover, not potential natural biome. |
| [MERIT Hydro](https://global-hydrodynamics.github.io/MERIT_Hydro/) / [paper](https://doi.org/10.1029/2019WR024873) | Modern flow direction, accumulation, river width and vector network | 3 arc-second (~90 m), except Antarctica; raster/vector products | ODbL; commercial use allowed, derived databases must remain available under ODbL | Strong modern hydrography, but share-alike may complicate a closed asset bundle. HydroATLAS is CC BY 4.0 and easier where its 15 arc-second reach network is sufficient. |
| [GEBCO 2025](https://www.gebco.net/data-products-gridded-bathymetry-data/gebco2025-grid) | Modern land/sea elevation and source-type identifier grid | 15 arc-second; NetCDF globally, GeoTIFF/ASCII tiles | Public domain; attribution required by the terms | Modern relief/bathymetry endpoint. Cell spacing can exceed the resolution of underlying measurements; TID should inform confidence. |
| [Randolph Glacier Inventory 7](https://nsidc.org/data/nsidc-0770/versions/7) | Global glacier outlines outside ice sheets around target year 2000, plus attributes, hypsometry, centerlines | Variable observational resolution; Shapefile, CSV, JSON | CC BY 4.0 | Modern glacier endpoint only. It is explicitly unsuitable for glacier-by-glacier change rates. |
| [Natural Earth](https://www.naturalearthdata.com/about/) | Present-day country/coastline reference geometry | 1:10m, 1:50m, 1:110m; vector/raster | Public domain | Suitable for the requested country reference overlay. Back-rotated countries are an anachronistic locator aid, never historical borders; label them “present-day outline reconstructed with its plate.” |

WorldClim is not a good default for a commercial/public app: its [license allows academic and other non-commercial use but forbids redistribution or commercial use without permission](https://worldclim.org/about.html). ESA WorldCover, CHELSA, GEBCO, Natural Earth, and an appropriately licensed climate reanalysis are safer modern inputs.

## How to derive the visual surface without overstating it

### 1. Preserve alternatives before making a texture

At each source time slice, retain `model_id`, CO2 scenario, paleogeographic reference frame, ensemble member, and source-grid cell. Produce at least a central texture plus uncertainty/alternative textures. Interpolate values through time only for animation; snap evidence, coastline topology changes, and categorical biome transitions to documented events or source frames. A temporal cross-fade means “visual interpolation between reconstructions,” not a claim about the intervening Earth.

### 2. Climate and substrate layers

Start with monthly temperature, precipitation, evaporation/runoff, land/sea mask, and elevation. Compute aridity, seasonality, growing-degree, frost, and snow-persistence measures. Separate substrate from vegetation: volcanic terrain, sand/evaporite, carbonate, weathered soil, bare rock, and water should remain visible where vegetation is absent or sparse. Climate-sensitive lithologies such as coal, evaporite, eolian deposits, bauxite/laterite, and tillite are independent proxy checks; the [PALEOMAP Phanerozoic supplement](https://zenodo.org/records/10659112) contains lithologic indicators and paleo-Köppen products, but its record-level license must be checked before asset reuse.

### 3. Evolution-aware vegetation mask

Run a simple Köppen-derived visual classifier first, then BIOME4 or another process-based vegetation model only for eras where its plant functional types make biological sense. Apply an era capability mask before color and roughness are assigned:

| Approximate interval | Allowed land-surface interpretation | Evidence and caution |
|---|---|---|
| 4.54 Ga–about 475 Ma | Bare mineral surfaces; optional localized microbial crust scenario after early-life evidence | No forests, grass, moss-like global carpet, or climate-defined modern biome textures. Early microbial ecosystems do not establish planet-wide terrestrial cover. |
| about 475–425 Ma | Sparse cryptogamic/bryophyte-grade ground cover where climate permits | Mid-Ordovician spores are the earliest generally accepted land-plant evidence; late-Ordovician Oman fragments directly associate spores with plants ([Wellman et al. 2003](https://doi.org/10.1038/nature01884)). Coverage and stature are poorly known. |
| about 425–390 Ma | Low vascular vegetation added; no closed modern forest texture by default | Earliest unequivocal megafossils are late Silurian; use sparse, low-roughness vegetation. |
| about 390–130 Ma | Forest-capable non-angiosperm plant functional types, with clade-specific regional evidence | The Cairo palaeosol preserves extensive Mid-Devonian tree root systems ([Stein et al. 2020](https://doi.org/10.1016/j.cub.2019.11.067)). This proves forest ecosystems existed, not that every humid cell was forested. |
| about 130–66 Ma | Add angiosperm-rich forest/woodland gradually; grasses possible locally late in the interval | Late-Cretaceous Indian coprolites contain diverse crown-grass phytoliths ([Prasad et al. 2005](https://doi.org/10.1126/science.1118806)), but this is not evidence for modern global grasslands. |
| after about 8–5 Ma | Broad C4-dominated grassland texture allowed where climate and regional proxies agree | Stable isotopes show a major late-Miocene/early-Pliocene expansion, with regional timing differences ([Cerling et al. 1997](https://doi.org/10.1038/38229)). Do not apply one global switch date. |

Treat “forest,” “desert,” and “tundra” as visual classes with provenance. Before land plants, an arid climate creates bare dry ground, not a Sahara-like dune field everywhere. After land plants, vegetation density should respond to water balance, temperature, seasonality, CO2, soils, disturbance assumptions, and the era mask. Use fossil/pollen sites as validation and localized constraints, not as paint buckets.

### 4. Ice and snow

For 21 ka–present, use CHELSA-TraCE21k/ICE-6G_C fields and modern glacier inventories. For deeper time, prefer ice-sheet fields supplied by the chosen climate experiment. Where absent, generate a clearly labeled potential-ice mask from persistent subfreezing summer temperature, accumulation, and topography, then compare it with mapped tillites/dropstones and sea-level constraints. A Köppen `EF` class or cold annual mean alone does not establish kilometer-thick grounded ice. Snowball Earth frames need scenario alternatives (hard snowball, waterbelt/slushball, and deglaciating state); even syn-glacial strata can record intermittent open water.

### 5. Rivers, lakes, and wetlands

For each reconstructed DEM, hydrologically condition only small pits, preserve author-defined endorheic basins, route flow with D8/D-infinity, and weight accumulated flow by monthly runoff or `max(P-E, 0)`. Width and permanence can be stylized from discharge rank and seasonality. Coastal deltas and wetlands should use low slope, accumulation, and sea-level proximity.

Deep-time output should be called **modeled drainage potential**. PaleoDEM cells and uncertain inland elevations cannot support exact channels. Render only high-order synthetic trunks from orbit; at regional zoom show a soft corridor or braided alternatives. Name a palaeoriver only when a regional study constrains it. Modern river geometry can transition to MERIT Hydro/HydroATLAS. Never back-rotate modern rivers: drainage reorganizes with uplift, capture, subsidence, glaciation, and changing coastlines.

### 6. Atmosphere, clouds, and ocean appearance

Use a physically based atmosphere shader, with solar luminosity by age, surface pressure/composition scenarios, ozone after oxygenation, aerosols/haze, cloud optical depth, and water absorption/scattering. Atmospheric and ocean **appearance is almost entirely model-derived** in deep time; rocks constrain gases and redox state far more readily than a camera-ready RGB color.

- Hadean Jack Hills zircons support low-temperature interaction with liquid water by 4.404 +/- 0.008 Ga, but do not locate oceans or define their color ([Wilde et al. 2001](https://doi.org/10.1038/35051550)).
- A methane-rich Archean organic haze can produce a “pale orange dot” spectrum, but it is a modeled conditional state, not a permanent observed Archean skin ([Arney et al. 2016](https://doi.org/10.1089/ast.2015.1422)). Offer clear/no-haze alternatives.
- Phanerozoic CO2 compilations provide forcing envelopes, not local atmospheric color ([Foster, Royer & Lunt 2017](https://doi.org/10.1038/ncomms14845)); oxygen histories such as GEOCARBSULF are model reconstructions ([Berner 2006](https://doi.org/10.1016/j.gca.2005.11.032)).
- Ocean base color should remain water-optics blue modulated by depth, suspended sediment, dissolved matter, productivity, sea ice, and sky. Uniform green, purple, red, or black ancient oceans need an explicit scenario and regional geochemical support. Anoxia is a subsurface redox condition and should be a scientific overlay; it does not by itself make the sea surface black.
- Clouds can be statistically generated from model humidity, vertical motion, precipitation, and sea-surface temperature where available. Otherwise they are procedural ambience. Preserve monthly seasonality; do not burn one arbitrary cloud pattern into the scientific texture.

## What is observed, reconstructed, and invented

Use these labels in the UI and data model:

- **Observed/direct:** modern satellite mapping or a measured geological/fossil sample at its present outcrop/core coordinates.
- **Proxy-derived:** climate, gas, redox, vegetation, or ice inference from a measured proxy. Include calibration and age uncertainty.
- **Data-assimilated:** proxy observations combined statistically with a model ensemble, such as PhanDA.
- **Mechanistic simulation:** GCM, vegetation model, ice model, or flow routing under stated boundary conditions.
- **Geometric reconstruction:** plate-rotated feature or reconstructed paleogeography.
- **Procedural/artistic:** sub-grid terrain detail, exact deep-time rivers, texture noise, cloud shape, color grading, and interpolation between snapshots.

Every visible feature can have more than one label. For example, a fossil occurrence is directly observed at a modern quarry, its age is proxy/radiometric, and its paleo-position is geometrically reconstructed.

## Candidate points of interest

Coordinates in an implementation should have two separate objects: `evidence_location_present` and `event_location_paleo`. The latter must cite a rotation model and anchor plate or be explicitly null. Approximate ages below are discovery-friendly display ages; retain the referenced analytical intervals in the source record.

| # | Event / display age | Popup substance | Location provenance and localizability | Primary reference / confidence |
|---:|---|---|---|---|
| 1 | Moon-forming impact during late-stage accretion; display age not yet verified | Giant-impact simulations can reproduce key Earth–Moon system properties. Canup & Asphaug (2001) supports the mechanism and geometry explored, but does not establish a display age. Do not publish a numerical age until an independent chronometric review is added. | Global/nonlocalizable; do not pin an impact site on Earth. An orbit-space marker is appropriate. | [Canup & Asphaug 2001](https://doi.org/10.1038/35089010). Mechanistic model; low location confidence; age source missing. |
| 2 | Liquid hydrosphere recorded at 4.404 +/- 0.008 Ga | A Jack Hills detrital zircon carries oxygen-isotope evidence for low-temperature interaction between crustal material and liquid water. | Evidence: Jack Hills, Western Australia. The grain is detrital, so the original crystallization/interaction site is not the present outcrop and is not localizable. | [Wilde et al. 2001](https://doi.org/10.1038/35051550). Direct mineral plus proxy interpretation; high sample confidence, low event-location confidence. |
| 3 | Dresser Formation microbial ecosystems, about 3.48 Ga | Stromatolites and microbially induced sedimentary structures occur in a volcanic-caldera, tidal-to-shallow-water setting; biogenicity has been tested but very-early-life claims still deserve careful wording. | Evidence: Pilbara Craton, Western Australia. Ancient environment is locally reconstructable within the surviving terrane; global extent is unknown. | [Noffke et al. 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC3870916/). Direct structures plus biological interpretation; medium-high. |
| 4 | Great Oxidation Event, roughly 2.43–2.33 Ga | The disappearance of mass-independent sulfur-isotope signals marks a major atmospheric oxygen transition. It was an interval, not a single flash, and oxygen remained far below modern levels. | Global process. Pins should mark sampled successions as evidence sites, not the origin of oxygenation. | [Farquhar, Bao & Thiemens 2000](https://doi.org/10.1126/science.289.5480.756). Multi-site proxy; medium-high global event, no unique location. |
| 5 | Marinoan glaciation and termination, about 639–635 Ma | High-precision ash-bed ages bracket glaciogenic deposition in Namibia; open-water indicators and competing snowball states justify alternate ice scenarios. | Evidence: Ghaub Formation, Namibia, plus correlated global sections. Ice extent is global-model-derived, not traced from the Namibia pin. | [Prave et al. 2016](https://nora.nerc.ac.uk/id/eprint/513906). Direct stratigraphy/geochronology; high local timing, medium global extent. |
| 6 | Mistaken Point communities, about 565 +/- 3 Ma | Deep-water bedding surfaces preserve dense Ediacaran communities and ecological organization before the Cambrian radiation. | Evidence and depositional locality: Mistaken Point, Newfoundland. Reconstruct the Avalonian terrane for paleo-position; present reserve coordinates are the surviving-evidence location. | [Mitchell et al. 2015](https://doi.org/10.1038/nature14646). Direct fossils; high site confidence. |
| 7 | Chengjiang biota, maximum depositional age 518.03 +/- 0.71 Ma | Exceptionally preserved early Cambrian animals occupied a mixed river- and wave-influenced delta; the date is a maximum depositional age from the youngest zircon. | Evidence: Maotianshan Shale, Yunnan, China. Paleo-position is plate-model-dependent but broadly localizable to South China. | [Yang et al. 2018](https://doi.org/10.1144/jgs2017-103); [deltaic setting](https://pmc.ncbi.nlm.nih.gov/articles/PMC8943010/). High local evidence, medium exact event age. |
| 8 | Early land-plant fragments, Ordovician, roughly 470–450 Ma | Spore-bearing fragments from Oman connect cryptospores to bona fide land plants; they support low cryptogamic cover, not forests. | Evidence: Oman cores/outcrops specified by the study. A marker should use the actual sample metadata; the plant lineage's place of origin is not established. | [Wellman, Osterloff & Mohiuddin 2003](https://doi.org/10.1038/nature01884). Direct fossils; high occurrence, low broader distribution confidence. |
| 9 | Cairo fossil forest, Mid-Devonian, roughly 386 Ma | Extensive Archaeopteris-grade root systems show a complex early forest growing on a periodically drier palaeosol. | Evidence: quarry near Cairo, New York. The forest grew at the sampled site, so it is localizable after reconstructing Laurentia; exact public coordinates may be generalized for site protection. | [Stein et al. 2020](https://doi.org/10.1016/j.cub.2019.11.067). Direct palaeosol/root systems; high. |
| 10 | Siberian Traps and end-Permian crisis, about 252 Ma | The extinction interval coincides with a change from flood-lava eruption to widespread sill intrusion, a plausible trigger for rapid environmental damage. | Event rocks: Siberian Traps, reconstructable on Siberia. Extinction effects are global; causal emissions and affected regions need separate layers. | [Burgess, Muirhead & Bowring 2017](https://doi.org/10.1038/s41467-017-00083-9). High timing, medium causal/detail confidence. |
| 11 | Karoo–Ferrar volcanism and Toarcian Oceanic Anoxic Event, about 183 Ma | Large igneous province activity overlapped greenhouse-gas release, warming, acidification, expanded marine anoxia, and organic-rich sediment deposition. | Volcanism: reconstructable remnants across southern Africa and Antarctica. Anoxia/source-rock evidence: individual marine sections and basins. Do not color every ocean or label every basin petroleum-prone. | [Burgess et al. 2015 geochronology](https://doi.org/10.1016/j.palaeo.2014.09.027); [global anoxia proxy](https://doi.org/10.1073/pnas.2406032121). High event timing, regional expression variable. |
| 12 | Oceanic Anoxic Event 2, about 94 Ma | Widespread low-oxygen conditions and unusually high organic-carbon burial affected many Cretaceous basins during greenhouse climate and major volcanism. “Oceanic anoxic event” does not mean every water mass was anoxic. | Evidence pins: Bonarelli level in Italy and other cored/outcrop sections. Volcanic candidates include several LIPs; trigger attribution remains debated. Render evidence basins and ensemble redox extent separately. | [Kuroda et al. 2007](https://doi.org/10.1016/j.epsl.2007.01.027); recent work still finds no consensus on the volcanic source ([Davis et al. 2024](https://pmc.ncbi.nlm.nih.gov/articles/PMC11180104/)). High event reality, medium cause and spatial-extent confidence. |
| 13 | Chicxulub impact, 66.043 +/- 0.011/0.043 Ma | High-precision dating places the impact and Cretaceous–Paleogene boundary/extinction within about 32 kyr. | Event: Chicxulub crater, Yucatan; directly localizable. Tektite/boundary sites are surviving evidence locations elsewhere and should be separate pins. | [Renne et al. 2013](https://doi.org/10.1126/science.1230492). Very high temporal and spatial confidence. |
| 14 | Paleocene–Eocene Thermal Maximum, boundary age 56.01 +/- 0.05 Ma | Rapid carbon release drove strong warming and ocean acidification; cause and carbon-source mixture remain active research questions. | Global event with many evidence cores/outcrops. No single “PETM location”; show individually referenced sites and only a separately sourced PETM-specific reconstruction. DeepMIP-Eocene-p1 represents the later EECO near 50 Ma and cannot substitute for a PETM map. | [Westerhold et al. 2019](https://doi.org/10.1126/science.aax0612); [Zachos et al. 2005](https://doi.org/10.1126/science.1109004). High event/timing confidence, medium source attribution. |
| 15 | Stepwise onset of major Antarctic glaciation, about 33.7–33.5 Ma | Deep-sea records show rapid ice growth and global cooling around the Eocene–Oligocene transition, with major changes to ocean carbonate chemistry. | Ice growth: Antarctic continent, spatial pattern model-dependent. Evidence: ODP Site 1218 and other marine sites; evidence site is not the location of all ice growth. | [Coxall et al. 2005](https://doi.org/10.1038/nature03135). High global transition confidence, medium ice geometry. |

Useful reserve POIs for a later editorial pass include the Huronian glacial successions (multiple glaciations within about 2.45–2.22 Ga, not one continuous snowball), the Central Atlantic Magmatic Province/end-Triassic crisis, the Messinian Salinity Crisis (5.97–5.33 Ma), and the LGM. They should enter the app only after their event records carry primary-site coordinates and explicit age models.

## Provenance and uncertainty contract

Keep a machine-readable manifest rather than citations only in prose. The block below is an illustrative target schema: its metadata were transcribed during this review, the checksum is a placeholder, and it is not evidence that any file/version has been downloaded or validated locally.

```yaml
source_id: pohl-phanero-climate-v4
title: Phanerozoic continental climate and Koppen-Geiger climate classes
version: 4
doi: 10.5281/zenodo.6620748
retrieved_at: 2026-09-07
coverage: {start_ma: 540, end_ma: 0, step_ma: 20}
native_grid: {crs: EPSG:4326, lon_deg: 2.8, lat_deg: 1.4}
variables: [topography, temperature_monthly, precipitation_monthly, evaporation_monthly, runoff_monthly, koppen]
license: {id: CC-BY-4.0, verified_from: zenodo_record}
files:
  - {name: All_NC_files.zip, sha256: "..."}
transform_pipeline: climate-v1.2.0
```

Every rendered time tile and POI should point back to source IDs and add:

- `evidence_class`: `direct | proxy | assimilated | simulation | geometric | procedural` (array allowed)
- `age`: central value, older/younger bounds, units, scale/version, and dating method
- `location`: present evidence geometry, paleo event geometry or null, rotation-model ID, anchor plate, and spatial uncertainty radius
- `scenario_id`: paleogeography, CO2 curve, climate member/ensemble statistic, vegetation ruleset, ice scenario, and atmosphere/haze scenario
- `confidence`: separate `time`, `location`, `state`, and `causal_interpretation` scores; never one opaque score
- `derivation`: input variables, equations/model, interpolation/downscaling method, thresholds, resampling kernel, and output checksum
- `display_disclosure`: one sentence suitable for the UI, such as “Modeled drainage potential from reconstructed topography and runoff; exact river paths are unknown.”
- `citations`: primary paper/data DOI plus dataset-specific attribution text

Suggested confidence display: A = directly constrained at this site/time; B = multiple proxies or ensemble agreement; C = model-dependent regional inference; D = procedural/artistic. Store continuous uncertainty internally, but the four-level badge is legible in a popup. Let users switch at least paleogeography, climate/CO2, ice, and Archean haze alternatives; do not average mutually exclusive geographic reconstructions into a deceptively smooth coastline.

## Remaining gaps after this first pass

- Deep-time tectonic reconstructions need to be joined to this environmental plan without treating modeled continental geometry as evidence for equally detailed climate, biomes, or rivers.
- There is no reviewed global biome, ice-sheet, soil, or drainage product spanning the Precambrian. Any such layer remains a scenario until specific datasets and proxy checks are documented.
- Exact deep-time river courses are generally unsupported. Regional palaeodrainage studies are still needed for every showcase zoom.
- The PhanDA posterior repository, DeepMIP files, BIOME 6000 archive, and the PALEOMAP climate/lithology supplement still need file-level redistribution/license review.
- A PETM-specific spatial ensemble has not been selected. The EECO DeepMIP ensemble is later and must not be relabeled as PETM.
- POI analytical age bounds must be normalized against a selected, versioned ICS timescale. The Moon-forming event still lacks a dating source in this memo.
- POIs need repository/sample coordinates, access or site-protection rules, anchor plates, rotation model IDs, and uncertainty radii before import.
- Vegetation rules need review by palaeobotanical interval specialists, especially Precambrian terrestrial microbial cover, the spread of early forests, and regional C3/C4 grassland timing.

## Practical next research steps

1. Download one Pohl slice (for example 120 Ma), one PALEOMAP DEM at the same age, and the 0 Ma products. Confirm coordinate orientation, masks, units, and whether Pohl topography is already the same PALEOMAP generation before resampling.
2. Produce a provenance-preserving experiment: raw climate class, evolution-masked land cover, runoff-ranked drainage, potential ice, and the confidence overlay. Review at orbit scale and regional zoom. This will reveal whether the 20 Myr/1–3 degree scaffold is visually adequate.
3. Compare the same age against the corresponding HadCM3L suites. Use differences in precipitation, temperature, and coastline as the first uncertainty visualization. Test PhanDA posterior temperature at one of its assimilated slices.
4. Ask the DeepMIP/CEDA data managers to clarify commercial/redistribution terms and the provider-credit policy for an interactive public app before packaging any Eocene fields.
5. Decide the product's licensing target early. MERIT Hydro's ODbL share-alike, WorldClim's non-commercial restriction, and record-specific scientific terms can shape the asset pipeline.
6. Build the POI editorial schema and enter the 15 candidates with present evidence geometry first. Reconstruct paleo geometry only after the chosen plate model and plate IDs are fixed. Keep precise protected fossil-locality coordinates private or generalized where repositories require it.
7. Commission focused regional reviews for showcase zooms and basin stories. Global GCM/DEM products cannot justify fine river networks, facies, source-rock distribution, or exact vegetation mosaics; those need regional stratigraphy, palaeodrainage, fossil floras, and basin-model sources.

## Concise bibliography

- Arney, G. et al. (2016), *The Pale Orange Dot*, Astrobiology 16, 873–899. [doi:10.1089/ast.2015.1422](https://doi.org/10.1089/ast.2015.1422).
- Brown, J. L. et al. (2018), *PaleoClim*, Scientific Data 5, 180254. [doi:10.1038/sdata.2018.254](https://doi.org/10.1038/sdata.2018.254).
- Judd, E. J. et al. (2024), *A 485-million-year history of Earth's surface temperature*, Science 385. [doi:10.1126/science.adk3705](https://doi.org/10.1126/science.adk3705).
- Kaplan, J. O. et al. (2003), *Climate change and Arctic ecosystems: 2*, JGR Atmospheres 108. [doi:10.1029/2002JD002559](https://doi.org/10.1029/2002JD002559).
- Karger, D. N. et al. (2023), *CHELSA-TraCE21k*, Climate of the Past 19, 439–456. [doi:10.5194/cp-19-439-2023](https://doi.org/10.5194/cp-19-439-2023).
- Pohl, A. et al. (2022), *Dataset of Phanerozoic continental climate and Köppen–Geiger climate classes*, Data in Brief 43, 108424. [doi:10.1016/j.dib.2022.108424](https://doi.org/10.1016/j.dib.2022.108424).
- Prentice, I. C., Jolly, D. & BIOME 6000 participants (2000), *Mid-Holocene and glacial-maximum vegetation geography*, Journal of Biogeography 27, 507–519. [doi:10.1046/j.1365-2699.2000.00425.x](https://doi.org/10.1046/j.1365-2699.2000.00425.x).
- Scotese, C. R. & Wright, N. (2018), *PALEOMAP Paleodigital Elevation Models for the Phanerozoic*. [doi:10.5281/zenodo.5460860](https://doi.org/10.5281/zenodo.5460860).
- Steinig, S. et al. (2024), *DeepMIP-Eocene-p1*, Scientific Data 11, 970. [doi:10.1038/s41597-024-03773-4](https://doi.org/10.1038/s41597-024-03773-4).
- Valdes, P. J., Scotese, C. R. & Lunt, D. J. (2021), *Deep ocean temperatures through time*, Climate of the Past 17, 1483–1506. [doi:10.5194/cp-17-1483-2021](https://doi.org/10.5194/cp-17-1483-2021).
- Williams, J. W. et al. (2018), *The Neotoma Paleoecology Database*, Quaternary Research 89, 156–177. [doi:10.1017/qua.2017.105](https://doi.org/10.1017/qua.2017.105).
