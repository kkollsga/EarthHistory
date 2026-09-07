# EarthHistory research

First research pass: 2026-09-07. These memos identify scientific evidence,
usable datasets, limitations, candidate methods and later validation targets.
The shipped data authority is `public/data/manifest.json`; a research memo is
not evidence that a candidate dataset entered the application.

The user wants a beautiful, realistically lit orbital Earth with regional zoom, using NASA WorldWind as a visual reference. The timeline spans formation/Hadean to today. Regional interests include basin development and infill, burial and petroleum-system maturation, volcanic margins, and rifts. Modern-country reference outlines and cited points of interest accompany the scientific layers.

Latest scope clarification: aerial basin views are sufficient; detailed subsurface/thermal tools are deferred. Runtime performance and independence from live data APIs are required. Ship compact scientific controls and perform most procedural visual synthesis in the frontend, balancing scientific fidelity and performance. Offline work curates and normalizes controls rather than requiring full-resolution pre-rendered world assets. Earlier detailed basin studies remain background research.

| Memo | What it resolves |
| --- | --- |
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
