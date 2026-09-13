# EarthHistory research

First research pass: 2026-09-07. These memos identify scientific evidence,
usable datasets, limitations, candidate methods and later validation targets.
The shipped data authority is `public/data/manifest.json`; a research memo is
not evidence that a candidate dataset entered the application.

The Cao foundation adoption record describes the current implementation.
Earlier PALEOMAP, crosswalk, relief and prototype reports preserve the evidence
from those experiments and previous releases; their implementation and test
claims do not describe the replacement engine.

The user wants a beautiful, realistically lit orbital Earth with regional zoom, using NASA WorldWind as a visual reference. The timeline spans formation/Hadean to today. Regional interests include basin development and infill, burial and petroleum-system maturation, volcanic margins, and rifts. Modern-country reference outlines and cited points of interest accompany the scientific layers.

Latest scope clarification: aerial basin views are sufficient; detailed subsurface/thermal tools are deferred. Runtime performance and independence from live data APIs are required. Ship compact scientific controls and perform most procedural visual synthesis in the frontend, balancing scientific fidelity and performance. Offline work curates and normalizes controls rather than requiring full-resolution pre-rendered world assets. Earlier detailed basin studies remain background research.

| Memo | What it resolves |
| --- | --- |
| [Cao requested-age motion tiles](cao-requested-age-motion-tiles.md) | Transport-only 25 Ma windows that preserve exact palette records and requested-age support while the full palette loads in the background |
| [Requested-age progressive loading validation](requested-age-progressive-loading-validation.md) | Publication, cancellation, Retry, memory, visual, gate and production loading evidence for showing the URL-requested age first |
| [Requested-age motion-tile performance](cao-requested-age-motion-tiles-performance.json) | Three-run cold/warm measurements at 0, 74, 411 and 1800 Ma, background handoff timing, cadence, picks, raw failed premises and corrected scoped witnesses |
| [Cao Caribbean / Panama / Cuba](cao-caribbean-panama-cuba.md) | 0 Ma diagnosis: Cuba layers correct; oversized Cao Jamacia shelf and missing Panama 229/230 coasts explain the isthmus look |
| [Panama observed-modern land correction](regional-panama-observed-land.md) | Natural Earth 1:50m exact-present missing-land geometry, Cao static ownership, native precedence, country-reference limitation and validation contract |
| [Canadian Arctic shelf audit at 74 Ma](regional-canadian-arctic-shelf-74ma.md) | Five active Cao coast/continental-outline identities, packaged shelf coverage, quantitative area witness, camera and no-data-change verdict |
| [Australian native Cao triangulation repair](regional-australia-native-triangulation.md) | Emitted-float32 validation, stable spherical-area oracle and paired source-connectivity repair for 13 omitted native Australian charts |
| [Cao foundation adoption](reconstruction-cao-foundation-adoption.md) | Current native Cao scope, source semantics, actual-app integration evidence and remaining acceptance work |
| [Regional material model lineage](regional-material-model-lineage.md) | Documented 410 Ma reconstruction junction, coastline versus continental coverage, and additional native COB candidates |
| [Regional material correction review](regional-material-corrections-review.md) | Independent review of the five regional material inputs, guarded native replacements, lifecycle and identity checks, mutation evidence, and current validation status |
| [Regional material correction performance](regional-material-corrections-performance.json) | Prewritten stop rules, failed software diagnostic, rejected concurrency experiment, and final matched WebGPU/WebGL2 hardware evidence |
| [Regional Svalbard material correction](regional-svalbard-correction.md) | NPI CC BY 4.0 source acquisition, age-qualified onshore material mask, Cao 309/311 pose uncertainty, compact geometry, overlap and coverage limits |
| [Regional Barents material correction](regional-barents-correction.md) | GSC Arctic-map Timan, Novaya Zemlya and Franz Josef Land substrate inference, regional age evidence, Cao pose, native-overlap sweep, and explicit residual classes |
| [Regional Barents shelf lifecycle correction](regional-barents-shelf-correction.md) | Exact-identity Cao closed-continental-boundary lifecycle repair for three Svalbard/Barents shelf charts through 600 Ma, preserving unknown depth and exposure semantics |
| [Regional Iceland surface and material correction](regional-iceland-correction.md) | Reproduced Cao source omission, exact-modern observed land, bounded volcanic-material ages, two-plate model pose, partial coverage and direct motion validation |
| [Regional Iceland shallow-marine correction](regional-iceland-shallow-shelf.md) | Natural Earth nominal 0–200 m modern water, irregular-shelf evidence, exact-present lifecycle, depth/cartographic uncertainty and no invented historical growth |
| [Cao continental-outline shelf coverage audit](continental-shelf-coverage-audit.md) | Global source coverage, conservative shell-clearance evidence, full exact-identity lifecycle ledger, bounded 422 Ma repairs and rejected universal coastal buffering |
| [Regional Iceland independent review](regional-iceland-independent-review.json) | Final composed-package motion oracle, uncertain non-modern evidence, native Cao geometry, coast-chart, and prior-target invariants |
| [Post-0.1.4 interface validation](post-0.1.4-interface-validation.md) | Compact map key, lock-marker visibility, touch acquisition, browser checks and matched production performance |
| [Post-0.1.4 interface performance](post-0.1.4-interface-performance.json) | Five paired published/candidate production runs with fixed views, resolved lock, continuous scrub, cadence, geometry, framing, artifact and machine evidence |
| [Post-0.1.5 rendering and geography validation](post-0.1.5-rendering-validation.md) | Australia and Panama coverage, viewer-facing lighting, exact-present country references, browser/visual acceptance and matched 0.1.5 production performance |
| [Post-0.1.5 rendering performance](post-0.1.5-rendering-performance.json) | Compact five-pair released/candidate production record with individual fixed and scrub rows, controls, stop rules and artifact identities |
| [Reconstruction refresh/loading validation](refresh-loading-validation.md) | End-to-visible cold/warm loading attribution, verified content-addressed cache behavior, schematic guide cadence and final gate evidence |
| [Regional Canada Franklinian correction](regional-canada-franklinian-correction.md) | Source-bounded Franklinian and Laurentian substrate material across the Canadian Arctic, with explicit 410–540 Ma confidence phases |
| [Regional Pearya correction](regional-pearya-correction.md) | Separate disputed Pearya and Laurentian-affinity fragments, shared exact targets, pose scenarios, and unresolved residuals |
| [Regional Western Laurentia correction](regional-western-laurentia-correction.md) | Older-material masks plus source-domain replacements for exact western native charts, including formation ranges and retained unknown-age source semantics |
| [Palaeomap accuracy study](palaeomap-accuracy-study.md) | Integrated source assessment, native time slices, plate/frame compatibility, 3D relief, climate, memory budgets and phased migration |
| [Continuous-coordinate validation](palaeomap-continuous-validation.json) | Implemented shared coordinates and natural materials, final full-gate results, repeated production measurements, preserved rejected probes and scientific/readiness limitations |
| [Caledonian geological test](palaeomap-caledonian-test.md) | Material-following native elevation and equal-view captures: broad orogenic relief is present; collapse and direct modern-remnant attribution remain unresolved |
| [Cross-model conversion probe](palaeomap-crosswalk-validation.json) | Rejected instantaneous-topology-container lineage method, classified support gaps and numerical round trips; the corrected static-continent method is assessed separately |
| [Static-continent crosswalk validation](palaeomap-static-crosswalk-validation.json) | Corrected child-fragment conversion coverage, exact round trips, coast-mask disagreement and conservative default-view stop result |
| [Plate foundation audit](palaeomap-plate-foundation.md) | Pinned GPlates model data, actual boundary feature types, polarity, reconstruction frames and acquisition evidence |
| [Palaeogeography and relief](palaeomap-geography-relief.md) | Cao categories, quantitative PALEOMAP DEMs, actual source ages, NOAA limitations and palaeoclimate controls |
| [Previous palaeomap runtime audit](palaeomap-runtime-audit.md) | Previous engine's source loss, renderer/camera behavior, cache ownership and implementation checks |
| [North Sea regional controls](palaeomap-north-sea.md) | Acquired NSTA facies/structural packages, OGL evidence, CRS and regional-restoration limits |
| [Tectonics and paleogeography](tectonics-and-paleogeography.md) | Plate models through 1.8 Ga, elevation reconstructions, reference-frame compatibility, country fragments, and regional structural datasets |
| [Climate, biomes and points of interest](biomes-climate-and-points-of-interest.md) | Climate and environmental inputs, evolutionary constraints on vegetation, drainage limitations, and candidate cited event records |
| [Basins, rifts and petroleum systems](basins-rifts-and-petroleum-systems.md) | Stratigraphy and thermal-history evidence, Norwegian data access, volcanic-margin studies, and proposed basin interactions |
| [Open-source reuse](open-source-reuse.md) | Integrated repository shortlist and reusable components, with links to source-level rendering, landscape and plate/basin inspections |
| [Modern landscape validation](modern-landscape-validation.md) | Repeatable modern landform and climate views, compact source controls, and evidence boundaries for visual/performance review |

## Findings that affect the build discussion

- Plate models, elevation reconstructions, and climate experiments must share compatible geography and reference frames. A collection of individually useful datasets is not automatically a coherent ancient Earth.
- Whole-Earth coverage is possible as an experience, with different evidence levels. Hadean/Archean geography requires explicit scenarios; detailed global rivers, forests, basin histories, and country locations are not known throughout the full timeline.
- Modern-country geometry is a reference overlay attached to reconstructable fragments. Missing ancestry or crust that had not formed must remain unavailable rather than being extrapolated.
- Global products supply context. Basin infill and maturity need regional stratigraphy, burial/thermal histories, and calibrated observations, with separate source/reservoir/seal and charge histories.
- GIS and model-source access is promising. Some regional supplements and third-party well/seismic assets still require rights clarification before redistribution.
- POIs are editorial candidates: publication, age, location role, model linkage, and rights need record-level verification before shipping.

The approved application now includes a Three.js renderer and offline data
preparation. Several candidate datasets and the detailed petroleum-system
simulator remain unimplemented research options; only the runtime manifest and
source catalog identify assets that actually ship.
