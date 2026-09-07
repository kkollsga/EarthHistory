# Tectonics and paleogeography for an Earth-through-time globe

Status: research memo for stack discussion, not an approved architecture

Research date: 2026-09-07

Scope: global plate geometry, paleogeography/elevation, uncertainty, modern-country reference outlines, and the tectonic inputs required by regional basin stories

## Recommendation

Use a versioned GPlates model as the geometry backbone and preprocess it offline. The strongest single global candidate is the **Muller2025 mantle-frame derivative of Cao et al. (2024)**: it provides rotations, continuously closing plate boundaries, continent/coast geometry, static polygons, and synthetic seafloor-age/spreading grids from 1,800 Ma to present. It is CC BY 4.0 and available through GPlately's Plate Model Manager. Its pre-1,000 Ma geometry remains a working hypothesis, not a map of observed ancient seafloor.

For 0–250 Ma, also ingest **Müller et al. (2019)** as a higher-value specialist model because it includes deforming networks, continental stretching, active/total stretching-factor products, sediment thickness, rifts, and collisional zones. Use **Zahirovic et al. (2022)** (0–410 Ma) and **Merdith et al. (2021)/Müller et al. (2022)** (0–1,000 Ma) as comparison models and as a way to expose model disagreement. Do not silently splice geometries or rasters between their paleomagnetic and mantle reference frames.

Use the **Scotese & Wright (2018) PALEOMAP paleoDEMs** as an authored Phanerozoic elevation interpretation, with a visible model/source label. Their 0.1° download is a denser sampling of an interpreted surface, not 0.1° observational knowledge. Either render those grids in their native PALEOMAP geometry or explicitly remap them through common crustal fragments. Directly draping a PALEOMAP grid over a Cao/Müller reconstruction would combine incompatible coordinates.

At ages older than 1.8 Ga, switch from “reconstruction” to an **evidence-led scenario view**: abstract magma-ocean/early-crust surfaces, preserved-craton or zircon localities, and optional named hypotheses. There is no continuous global plate solution for the Hadean or Archean. The onset and style of plate tectonics are actively disputed, with published interpretations ranging across much of Earth history.

## What the evidence can support

| Interval | Defensible global display | Suggested confidence treatment | Main limitation |
|---|---|---|---|
| 0–200/250 Ma | Reconstructed continents, evolving plate boundaries, surviving and inferred oceanic plates; model-derived seafloor age; regional deformation where supplied | “Constrained reconstruction,” with model/version always available | Destroyed oceanic plates and some convergent margins are inferred; global geometry still cannot resolve individual basin faults |
| 250–410 Ma | Continuously closing plates and continental blocks; increasingly synthetic ocean basins | “Model reconstruction”; compare at least two models | Little or no surviving ocean-floor record; plate boundaries are geological interpretations |
| 410–1,000 Ma | Merdith/Müller/Cao full-plate models, cratons, inferred boundaries and oceans | “Published working hypothesis”; display alternate model or uncertainty toggle | Paleomagnetism constrains latitude/orientation but not longitude; most oceanic plates are synthetic |
| 1,000–1,800 Ma | Cao 2024/Muller2025 full-plate hypothesis for Nuna–Rodinia evolution | “Low-confidence working hypothesis”; simplify relief and country overlay | Built by joining/refining continental-drift models and adding synthetic oceans/boundaries; sparse and uneven constraints |
| 1,800–4,540 Ma | Time-bounded conceptual scenes and geolocated surviving evidence only | “Scenario/artistic synthesis”; never show coordinate precision | No continuous global reconstruction; early tectonic regime itself is disputed and the rock archive is fragmentary |

This is not a simple monotonic error bar. A reconstruction can have reasonable relative fit between two cratons but uncertain absolute longitude; a continent may be better constrained than its surrounding vanished ocean; a local terrane may have multiple admissible attachment histories. Store uncertainty by **feature and claim**, including `model`, `reference_frame`, `valid_time`, `constraint_type`, `spatial_uncertainty`, `age_uncertainty`, and `interpretive_status`.

## Dataset evidence table

“Verified” below means the linked repository/metadata and, where noted, archive contents were inspected on 2026-09-07.

| Source | Coverage and contents | Files / practical access | License | Assessment |
|---|---|---|---|---|
| [Cao et al. 2024 data, current v2.4](https://doi.org/10.5281/zenodo.11536686) and [paper](https://doi.org/10.1016/j.gsf.2024.101922) | 1,800–0 Ma relative-motion model in a paleomagnetic frame; continents, coast geometry, continent–ocean boundaries, static polygons, paleomagnetic points, and boundary/topology files split at 1,000, 410 and 250 Ma | [Direct 20.7 MB ZIP](https://zenodo.org/records/13628813/files/1.8Ga_model_GSF.zip?download=1); verified archive contains `.rot`, `.gpml`, `.gpmlz`, `.gproj` and point data | CC BY 4.0 for dataset; paper CC BY-NC-ND 4.0 | Best published relative-motion backbone to 1.8 Ga. Authors explicitly call it a working hypothesis. Current changelog includes topology fixes, so pin the exact record/version/checksum. |
| [Muller2025 mantle reference frame](https://doi.org/10.5281/zenodo.15233548) | 1,800–0 Ma derivative of Cao 2024; identical relative motions, optimized absolute frame, corrected topologies, contoured/expanded continental outlines; age and spreading-rate grids | [334.8 MB ZIP at current record](https://zenodo.org/records/17142287/files/Cao_etal_2024_1.8_Ga_mantle_ref_frame.zip?download=1); [grid directory](https://repo.gplates.org/webdav/PlateModel_Age_SR_Grids/Muller_etal_2025/) | CC BY 4.0 | Preferred globe backbone when an absolute mantle frame is needed. It is a derivative dataset using the Müller 2022 optimization method; the frame is model output, not direct observation. |
| [Merdith et al. 2021 data](https://doi.org/10.5281/zenodo.10346399) and [paper](https://doi.org/10.1016/j.earscirev.2020.103477) | 1,000–0 Ma; first continuous full-plate model across Neoproterozoic–Phanerozoic, paleomagnetic frame; rotations, static polygons, coastlines, cratons, boundary topologies | [Direct current ZIP](https://zenodo.org/records/13635864/files/Merdith_etal_2021_ESR_v1.2.4.zip?download=1), `.rot`, `.gpml`, `.gpmlz`, `.gproj` | CC BY 4.0 | Strong alternative/lineage model. Paleolongitude is underconstrained. Use for model comparison, not as an independent truth layer on top of Cao. |
| [Müller et al. 2022 model/data](https://doi.org/10.5281/zenodo.10297173) and [paper](https://doi.org/10.5194/se-13-1127-2022) | 1,000–0 Ma; Merdith relative motions reoriented with tectonic rules into a mantle frame; continents, cratons, topologies, paleomagnetic data and age grids | `Muller_etal_2022_SE_v1.2.4.zip`; Plate Model Manager name `muller2022` | CC BY 4.0 | Useful to quantify reference-frame sensitivity. The optimized frame progressively diverges from the paleomagnetic frame back in time. |
| [Müller et al. 2019 data](https://doi.org/10.5281/zenodo.10525286) and [paper](https://doi.org/10.1029/2018TC005462) | 250–0 Ma; global deforming plate model, rifts/orogens, topological deformation; LIPs, volcanic provinces, seafloor fabric and hotspots available through the collection; active and total stretching factors | [Direct plate-model ZIP](https://zenodo.org/records/11601026/files/Muller_etal_2019_Tectonics_PlateMotionModel_v3.0.zip?download=1); GPlates `.rot/.gpmlz`; additional grid ZIPs and a plate-ID workbook in the record | CC BY 4.0 | Most useful global tectonic input for rift/basin stories. Its deformation meshes provide regional kinematics, but are too coarse to replace interpreted fault, horizon or well data. |
| [Zahirovic et al. 2022 data](https://doi.org/10.5281/zenodo.4729045) and [paper](https://doi.org/10.1002/gdj3.146) | 410–0 Ma; rotations, coast/continent/static polygons, active and inactive deforming networks, plate boundaries; mantle and paleomagnetic frames; seafloor-age/spreading and sediment-thickness products | [Direct geometry ZIP](https://zenodo.org/records/13899315/files/PlateMotionModel_and_GeometryFiles.zip?download=1); separate grid ZIPs; Plate Model Manager default `zahirovic2022` | CC BY 4.0 | Good maintained default and comparison model, especially for subduction and carbonate-platform analysis. Do not rely on the PMM default name without pinning a version because the default may change. |
| [Scotese & Wright 2018 paleoDEMs, v2](https://doi.org/10.5281/zenodo.5460860) and [report](https://zenodo.org/records/5460860/files/Scotese_Wright2018_PALEOMAP_PaleoDEMs.pdf?download=1) | 540–0 Ma interpreted global paleotopography/bathymetry in metres; metadata describes 117 estimates at approximately 5 Myr spacing; downloads at 1° and 0.1° | NetCDF and longitude/latitude/elevation CSV. [1° ZIP](https://zenodo.org/records/5460860/files/Scotese_Wright_2018_Maps_1-88_1degX1deg_PaleoDEMS_nc.zip?download=1); [0.1° NetCDF ZIP](https://zenodo.org/records/5460860/files/Scotese_Wright_2018_Maps_1-88_6minX6min_PaleoDEMS_nc.zip?download=1) | CC BY 4.0 | Best ready-made Phanerozoic visual surface. Treat all elevations as interpretation. Archive inspection found 109 `.nc` grids in the 1° ZIP despite the record text saying 117 paleoDEMs; inventory and pin the selected slices during ingestion. |
| [Cao et al. 2017 paleogeography](https://doi.org/10.5194/bg-14-5425-2017) / [direct GPlates GeoData ZIP](https://www.earthbyte.org/webdav/ftp/earthbyte/GPlates/GPlates2.3_GeoData/Individual/Paleogeography.zip) | 402–2 Ma global categorical polygons for ice sheets, mountains, landmass and shallow marine settings; features stored in present-day coordinates for reconstruction with the Matthews model | Four ESRI shapefile collections plus `.gproj`; archive README identifies `i`, `m`, `lm`, `sm` layers and ICS time fields | EarthByte GPlates 2.3 page states CC BY 3.0 for EarthByte data; confirm any incorporated third-party terms | Valuable categorical cross-check and source for broad ice/highland/shallow-sea masks. It is not a biome or river dataset. It was built for the Matthews frame. |
| [GPlates / pyGPlates](https://www.gplates.org/) and [GPlately Plate Model Manager](https://gplates.github.io/plate-model-manager/latest/) | Reconstruction engine and offline data access. GPML preserves full feature semantics; GPlates can export resolved topologies as GeoJSON/Shapefile/GMT and reconstructed numerical rasters | `.rot`, `.gpml/.gpmlz`, NetCDF; preprocessing via pyGPlates/GPlately; web service accepts GPML/Shapefile but should not be a runtime dependency | Software GPL; each model/data record has its own license | Use offline in a reproducible build pipeline. Preserve original GPML plus normalized runtime derivatives; do not reduce the source of truth to GeoJSON. |
| [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) or [GEBCO 2025](https://www.gebco.net/data_and_products/gridded_bathymetry_data/) | Present-day land/ocean relief at 15 arc-seconds; ice-surface and bedrock/under-ice choices | NetCDF and GeoTIFF; both offer subsets/tiles; GEBCO also has a source-type grid | ETOPO: US government/public data terms should be confirmed per component; GEBCO grid is public domain with required acknowledgement | Use for the 0 Ma endpoint and regional zoom. Nominal cell size does not equal source-data accuracy, especially offshore. |
| [Natural Earth Admin 0 Countries](https://www.naturalearthdata.com/downloads/) | Present-day country polygons at 1:10m, 1:50m and 1:110m scales | [Direct 1:50m Shapefile ZIP](https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip); SHP, GeoPackage/SQLite bundles also available | Public domain / free for any project | Good visual source for a modern-country reference layer. Select and document a boundary point of view for disputed territories. |
| [Gernigon et al. 2021 Mid-Norwegian margin](https://doi.org/10.17850/njg101-3-2) | Regional 1:1,000,000 compilation: basin elements, major faults, structural domains, volcanic elements/limits, sills, vents, magnetic chrons, wells and other interpreted features | [Direct 55.6 MB ZIP](https://njg.geologi.no/images/phocadownload/MNCM_version1.0Sept2021.zip); many Shapefiles plus ready-to-use QGIS 3.18 project, SVG symbols and styles | Paper calls it “open-source” for exploration and academic purposes, but archive inspection found no standard license grant | Excellent regional case-study candidate for rift/volcanic-margin zoom. Redistribution/commercial derivative rights remain unresolved; obtain written clarification before shipping files or derivatives. |

## Reconstruction and preprocessing contract

Keep each imported model isolated as a bundle with:

- exact dataset DOI/record/version, retrieval date, checksums and license;
- rotation files, anchor plate ID and reference-frame name;
- static polygons, topological plate boundaries/networks and their feature IDs;
- feature `validTime`, reconstruction plate ID, conjugate plate ID where applicable, and source attributes;
- raster coordinate system, nodata convention, time slice, vertical datum/sea-level assumption, and native resolution;
- an ingestion manifest mapping every derived tile/mesh back to source features.

Run pyGPlates/GPlately offline to export deterministic snapshots and motion metadata. For an orbital globe, derive spherical vector tiles or indexed spherical meshes for continent masks, plate boundaries and overlays, plus multiresolution terrain/texture tiles. Keep plate IDs and source feature IDs in runtime attributes so popups and regional overlays can trace back to the exact model object.

GPML is the archival format because it represents topology, feature validity, plate IDs, deformation networks and other geological semantics that Shapefile/GeoJSON cannot fully preserve. GeoJSON is suitable as a derived web format. The GPlates web reconstruction service can aid prototyping, but production should not depend on a remote service whose supported models or availability can change.

### What can be interpolated

- **Finite rotations:** interpolate the published rotation sequence on the sphere using the model's rotation machinery; do not linearly interpolate longitude/latitude vertices. GPlates represents rotations in a plate hierarchy and resolves arbitrary requested times.
- **Rigid plate-attached points and lines:** interpolate their rotations within the feature's valid interval. Honor plate appearance/disappearance and topology events.
- **Deforming regions:** only deform through supplied topological networks/meshes. Müller 2019 and some younger models support this; a single plate ID otherwise preserves shape and cannot create realistic rift stretching.
- **Continuous scalar fields:** interpolate only after the two samples refer to the same material coordinates or after advecting them into a common plate-local frame. Record the interpolation as such.

### What must not be naively interpolated

- Geographic raster cells from two paleoDEM ages: a latitude/longitude crossfade smears continents, mountains and shorelines across unrelated ocean/land.
- Categorical masks such as land, ice, mountain and shallow sea: interpolate boundaries or use a deliberate transition, not fractional class IDs.
- Ocean floor across ridge birth, ridge jump or subduction: topology changes require appearance/disappearance masks and age-grid logic.
- Plate-boundary linework across a reorganization: recompute the resolved topology at the requested time.
- River networks, shorelines, basin outlines and country fragments across a split/collision unless they are attached to material points or a deforming network.

Smooth playback can use rotation interpolation and short visual fades, while the UI states the bracketing evidence ages. A visually smooth globe must not imply that every intermediate relief, shoreline or biome was independently reconstructed.

## Modern-country reference outlines through deep time

The defensible product is a **present-day country reference overlay**, not historical countries. The label and legend should say that explicitly at every nonzero age.

1. Start with Natural Earth Admin 0 polygons at a scale appropriate to zoom. Preserve the selected point of view for disputed borders in metadata.
2. Densify geodesic edges before reconstruction so curves remain stable on the sphere.
3. At 0 Ma, intersect each country polygon with the chosen model's static polygons and, where available, active deforming networks. One country becomes several `country_fragment` records, each carrying ISO identity, source geometry ID, plate/terrane ID, validity and confidence.
4. Reconstruct fragments with the same rotation model and anchor frame as the visible continents. In deforming networks, reconstruct densely sampled points using the topology model rather than applying a rigid Euler rotation.
5. Clip/fade each fragment by crustal validity. A modern coastline is not an ancient shoreline; display the outline as a dashed or luminous reference trace above the paleoland surface, never as a land mask.

A single plate assignment based on maximum overlap gives bad results for countries spanning sutures, rifts or plate boundaries (for example Iceland, Turkey, Indonesia and Russia). GPlates' documented “cookie cut” workflow exists for this reason. It can assign plate IDs and split features with static or resolved topological polygons. Preserve polygon topology in the custom preprocessing pipeline because the desktop workflow has format-specific limitations when partitioning polygons.

### Age behavior

- **Young interval:** fragments can be useful familiar locators, but modern borders still have no historical political meaning.
- **Pre-breakup continents:** reconstructed fragments show which pieces of present-day territory lie on each crustal block. A border may split and separate. That apparent separation is the point of the overlay.
- **Deep Proterozoic:** fade fragments as terrane ancestry becomes ambiguous. Allow the user to select alternative models. The mere presence of a reconstructed modern continental polygon does not prove its current crustal outline or internal border material existed intact.
- **Archean/Hadean:** hide country geometry by default. If the product requirement insists on “at all times,” show a separate present-day locator inset or an explicitly non-geological ghost outline fixed in screen space. Do not pin Norway, Brazil, or another country to a speculative early-Earth continent.
- **Oceanic islands:** apply island-emergence/volcanic-province ages. Hawaii and most hotspot islands should disappear before formation; Iceland requires North Atlantic ridge/plume history and regional data. A present-day carrier-plate rotation would falsely imply that the island always existed.

## Basin, rift and volcanic-margin compatibility

The global model supplies context, not a petroleum-scale structural interpretation. For regional zoom, keep basin data in its native present-day CRS with its own vertical/stratigraphic reference, assign it to global plate/deforming-network IDs only for motion, and store explicit tie points between the regional interpretation and the global reconstruction.

Useful global inputs are:

- Müller 2019 deforming networks, accumulated strain/strain rate, crustal stretching/thinning and tectonic-subsidence outputs for rift and collision stories since about 240–250 Ma;
- time-evolving seafloor age and spreading rate for breakup timing, thermal subsidence and passive-margin context;
- continent–ocean boundaries and passive-margin linework, noting that the EarthByte COB set represents passive margins and omits active margins;
- Johansson 2018 volcanic provinces / Whittaker 2015 LIPs and hotspot tracks as regional context, not a substitute for sill, vent and lava-facies mapping;
- pyBacktrack for decompaction/backstripping of wells and modeled paleowater depth on oceanic or continental crust.

The Gernigon Mid-Norwegian margin bundle is a strong pilot because it contains interpreted basin/fault and volcanic-margin layers in one styled QGIS project. Its 1:1,000,000 optimum scale is appropriate for regional storytelling, not field- or prospect-scale decisions. Before product use, resolve its nonstandard license wording and document which layers derive from third-party agencies or proprietary surveys.

Global stretching meshes cannot portray detailed fault-block rotation, sequence boundaries, source-rock burial, heat flow, sill emplacement, charge or maturity. Those require the regional stratigraphic/well/thermal workflow documented separately in `docs/research/basins-rifts-and-petroleum-systems.md`.

## Open decisions before implementation

1. **Primary frame:** select Cao 2024 paleomagnetic or Muller2025 mantle frame as the canonical 0–1,800 Ma geometry. Climate-sensitive paleolatitudes and mantle-fixed plume stories may favor different products; the UI may need a model toggle.
2. **Phanerozoic relief strategy:** choose between native PALEOMAP paleoDEM scenes or building a new internally consistent relief synthesis on the selected Cao/Müller geometry. Do not silently warp one into the other.
3. **Country policy:** settle boundary point of view, maximum deep-time age, opacity/confidence rules, and behavior for disputed territories and island states.
4. **Uncertainty UI:** decide whether alternate models render side by side, as ghosted envelopes, or through a confidence layer. A single global “confidence percent” is scientifically misleading.
5. **Regional pilot:** the Mid-Norwegian margin is unusually aligned with the requested rift/volcanic-margin/petroleum story, but data-rights clarification is a release gate.
6. **Temporal sampling:** select source-driven keyframes. Five-million-year terrain snapshots are reasonable for broad Phanerozoic change but too coarse for short tectonic/magmatic events; the playback clock can be continuous while evidence changes at irregular event ages.

## Key sources and documentation

- Cao, X. et al. (2024), [Earth's tectonic and plate boundary evolution over 1.8 billion years](https://doi.org/10.1016/j.gsf.2024.101922), *Geoscience Frontiers* 15, 101922.
- Merdith, A. S. et al. (2021), [Extending full-plate tectonic models into deep time](https://doi.org/10.1016/j.earscirev.2020.103477), *Earth-Science Reviews* 214, 103477.
- Müller, R. D. et al. (2022), [A tectonic-rules-based mantle reference frame since 1 billion years ago](https://doi.org/10.5194/se-13-1127-2022), *Solid Earth* 13, 1127–1159.
- Müller, R. D. et al. (2019), [A global plate model including lithospheric deformation along major rifts and orogens since the Triassic](https://doi.org/10.1029/2018TC005462), *Tectonics* 38, 1884–1907.
- Zahirovic, S. et al. (2022), [Subduction kinematics and carbonate platform interactions](https://doi.org/10.1002/gdj3.146), *Geoscience Data Journal* 9, 371–383.
- Matthews, K. J. et al. (2016), [Global plate boundary evolution and kinematics since the late Paleozoic](https://doi.org/10.1016/j.gloplacha.2016.10.002), *Global and Planetary Change* 146, 226–250.
- Seton, M. et al. (2023), [Deconstructing plate tectonic reconstructions](https://doi.org/10.1038/s43017-022-00384-8), *Nature Reviews Earth & Environment* 4, 185–204.
- Torsvik, T. H. et al. (2008), [Global plate motion frames: toward a unified model](https://doi.org/10.1029/2007RG000227), *Reviews of Geophysics* 46. This source documents the key limitation that paleomagnetism constrains latitude and angular orientation but not longitude.
- Cao, W. et al. (2017), [Improving global paleogeography since the late Paleozoic using paleobiology](https://doi.org/10.5194/bg-14-5425-2017), *Biogeosciences* 14, 5425–5439.
- Scotese, C. R. & Wright, N. M. (2018), [PALEOMAP Paleodigital Elevation Models for the Phanerozoic](https://doi.org/10.5281/zenodo.5460860), dataset and report.
- Müller, R. D. et al. (2018), [PyBacktrack 1.0](https://doi.org/10.1029/2017GC007313), *Geochemistry, Geophysics, Geosystems* 19, 1898–1909.
- Gernigon, L. et al. (2021), [A digital compilation of structural and magmatic elements of the Mid-Norwegian continental margin](https://doi.org/10.17850/njg101-3-2), *Norwegian Journal of Geology* 101.
- [GPlates GPML rationale](https://www.gplates.org/gpml/), [reconstruction manual](https://www.gplates.org/docs/user-manual/reconstructions/), [raster import/reconstruction](https://www.gplates.org/docs/user-manual/import/), [crustal deformation](https://www.gplates.org/docs/user-manual/crustaldeformation/), and [pyGPlates reconstruction API](https://www.gplates.org/docs/pygplates/generated/pygplates.reconstruct).
- Brown, M., Johnson, T. & Gardiner, N. J. (2020), [Plate tectonics and the Archean Earth](https://doi.org/10.1146/annurev-earth-081619-052705), *Annual Review of Earth and Planetary Sciences* 48, 291–320; and Palin, R. M. et al. (2020), [Secular change and the onset of plate tectonics on Earth](https://doi.org/10.1016/j.earscirev.2020.103172), *Earth-Science Reviews* 207, 103172. These reviews show why a single Hadean/Archean plate map cannot be presented as settled knowledge.
