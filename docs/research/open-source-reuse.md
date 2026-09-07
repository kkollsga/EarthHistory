# Open-source reuse for EarthHistory

Research snapshot: 2026-09-07. Recommendations for discussion, not adopted dependencies or a verified combined system.

**Latest user clarification:** no live API dependency, good runtime performance, aerial basin views, minimal input data and most processing in the frontend. The narrowed recommendation is a static Three.js app using compact scientific control packs and frontend GPU procedural synthesis. WebGPU/TSL is the preferred prototype direction, with an explicitly tested reduced WebGL 2 path. Offline tools curate/normalize controls; precomputed full-resolution world textures and heavy scientific solvers are not baseline requirements. Regional subsurface and maturity solvers below are background/future candidates. All remote example providers/default assets must be replaced with locally hosted permitted assets before app use.

## Outcome

There is substantial reusable code for this project. Build on existing rendering, terrain paging, plate reconstruction and surface-process engines. EarthHistory should concentrate on the connections between them: compatible time-dependent datasets, appearance derived from climate and geology, regional basin narratives, and traceable sources.

Three GPT-5.6 Sol agents surveyed six candidates in each area. They used Open Source MCP knowledge graphs, structural queries and targeted source reads for seven repositories: Takram three-geospatial, NASA-AMMOS 3DTilesRendererJS, goSPL, Badlands, World Orogen, GPlately and PyBasin. Other candidates received lighter repository/documentation/license reviews. Exact inspected commits, source links, maintenance snapshots and licensing details are in the three companion reports.

## Reuse map

| Capability | Strong candidate | What to reuse | Material limit |
| --- | --- | --- | --- |
| Atmospheric lighting | [Takram three-geospatial](https://github.com/takram-design-engineering/three-geospatial) | Atmospheric scattering, solar illumination, aerial perspective and ellipsoid integration | Existing volumetric clouds have documented global/space-view and WebGPU limitations. Atmosphere LUTs and parameters must form a consistent scenario. |
| Terrain streaming and regional zoom | [NASA 3DTilesRendererJS](https://github.com/NASA-AMMOS/3DTilesRendererJS) | Screen-space-error traversal, prioritized request queues, LRU caching, quantized-mesh terrain and imagery/geometry overlays | Geological time and source provenance need an application adapter. The exact material/plugin set needs backend compatibility testing. |
| Complete alternative globe engine | [CesiumJS](https://github.com/CesiumGS/cesium) | Integrated terrain, imagery, atmosphere, water effects, camera and geospatial scene | A separate engine choice rather than a Three.js component. Ancient data and appearance remain custom inputs. Optional hosted content has separate terms. |
| Browser terrain synthesis | [World Orogen](https://github.com/raguilar011095/planet_heightmap_generation) | Spherical mesh/adjacency construction, deterministic generation, transferable typed arrays and retained worker state | CPU JavaScript worker stages may become expensive at high detail; direct reuse is GPL-3.0 and its plausible-world rules are not reconstructed science. |
| Global surface evolution | [goSPL](https://github.com/Geodels/gospl) | Spherical landscape evolution with tectonic/climate forcing; erosion, drainage, sediment and stratigraphic outputs | Heavy offline MPI/PETSc/scientific stack. Requires constrained inputs and calibration; source inspection does not validate a reconstructed world. GPL-3.0. |
| Regional basin and sediment evolution | [Badlands](https://github.com/badlands-model/badlands) | Regional catchment-to-marine routing, multi-rock deposition, stratigraphy and selected coastal processes | Planar regional model. Conflicting GPL/LGPL notices require clarification before dependency adoption. |
| Modular process alternatives | [Landlab](https://github.com/landlab/landlab) | Reusable flow, erosion and sediment components; includes spherical-grid work | MIT-licensed toolkit, not a turnkey plate-driven paleoworld pipeline. Individual component/grid combinations need testing. |
| Plate and map preprocessing | [GPlately](https://github.com/GPlates/gplately) and pyGPlates | Model access, spherical reconstruction, raster/geometry processing and topology-based point histories | Rigid raster rotation is not material deformation. Selected datasets, reference frames, units and valid ages must be tracked separately. |
| Burial and thermal histories | [PyBasin](https://github.com/ElcoLuijendijk/pybasin) | Local burial/exhumation, temperature and maturity calculations and calibration workflows | Script-oriented research code requiring a wrapper. Not a complete petroleum-generation, expulsion and migration simulator. |

See [rendering inspection](repos-globe-rendering.md), [landscape inspection](repos-landscape-generation.md), and [plate/basin inspection](repos-paleo-basin-pipeline.md) for evidence, code entry points and additional alternatives. The comparison tables distinguish actual root licenses from README claims and code rights from data/imagery rights.

## Recommended division of work

The offline side should curate and normalize compact scientific controls with GPlately/pyGPlates: coarse geography/elevation, climate or biome/ice fields, plate motion, validity and source metadata. The frontend should generate detailed terrain/material appearance from these controls using stable seeds and cached visible-region work. Evaluate goSPL only as an optional scientific comparison or source-preparation tool when it adds value; do not require a global billion-year simulation merely to display a researched snapshot.

Ship versioned compact controls and small geographic/event records. Generate/cache detailed terrain, normals and materials in the browser as the camera and age require. Preserve scientific numerical fields and source manifests independently of generated display assets. A wrapper can maintain provenance through input/output hashes and model configuration even when an upstream tool does not natively carry arbitrary source IDs.

World Orogen demonstrates a useful CPU boundary: a module Web Worker receives compact fields, retains mesh/elevation state between operations, and returns transferable typed arrays to Three.js. Reuse that architecture as a reference for bounded CPU stages while keeping the generator replaceable by WebGPU/TSL stages where measurement supports them. Direct client-code reuse would put the GPL-3.0 terms in scope. Its rule that routes every land cell to the ocean must not erase sourced closed basins, lakes, or drainage outlets.

For the browser, compare two coherent options:

1. **Three.js + Takram atmosphere + NASA terrain streaming.** This gives control over planetary appearance while reusing major rendering machinery. Start with the backend supported by the actual package/plugin combination; do not assume every Three.js extension inherits WebGPU support or fallback compatibility.
2. **CesiumJS with our own ancient terrain and imagery.** Its integrated globe and water rendering may reduce custom work. It deserves a direct comparison for this orbital use case, not only as a future close-terrain fallback.

Do not combine the full Cesium and Three scene engines by default. Select the option that satisfies the visual and data requirements with the smaller maintained integration surface.

EarthHistory-specific code remains necessary for:

- Geological time, source validity, scenario selection and coherent transitions across plate/topology changes.
- Climate/era-aware material synthesis: vegetation, bare substrate, snow/ice, water and sediment appearance.
- Coordinate, unit and reference-frame conversion between scientific models and browser assets.
- Modern-country reference fragments, cited POIs, confidence disclosures and missing-data handling.
- Aerial basin selection and cited surface-evolution stories. Subsurface sections and local burial/thermal histories are deferred under the clarified scope.
- Any unmet orbital cloud/ocean requirements, after testing existing effects rather than beginning with a new rendering implementation.

These are our domain responsibilities; implementing replacement erosion, atmospheric-scattering, tile-scheduling or plate-rotation engines is not justified by the current evidence.

## Evidence and limits

No candidate dependencies were installed, built or benchmarked in this task. The seven deep reviews establish source-level capabilities and extension seams. A brief browser inspection rendered Takram's basic lit-object/atmosphere scene and NASA's Dingo Gap terrain demo. The Manhattan integration asked for a Google Maps API key, which was not supplied. Dingo Gap showed visible gaps in its initial view. These observations establish that selected demos run, not orbital visual acceptance, integration compatibility or measured performance.

The next useful proof is a bounded scene with the same input data in both browser options: a lit globe at orbital and regional scales, ocean glint, a global cloud layer, one terrain/material time transition, a country outline, and a cited basin marker. Record data provenance and compare appearance, interaction, request cancellation, texture memory and frame time on agreed devices. Treat missing effects as measured integration work; abandon an option only if meeting a requirement needs an unreasonable maintained fork or misses an agreed budget.

Separately evaluate a small constrained rift-to-shelf evolution case before adopting a scientific solver. Test sediment balance, drainage, deformation, repeatability within a declared numerical tolerance, preserved stratigraphy and export effort. Cloud-free appearance tests and scientific model tests answer different questions and should not be conflated.
