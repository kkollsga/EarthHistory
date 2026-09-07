# Modern landscape validation

Updated 2026-09-07. These are acceptance targets for the procedural renderer,
not a claim that the present implementation reproduces every feature.

The modern Earth provides a test with reference geography. Separate three
questions: whether the compact inputs preserve large features, whether
procedural refinement produces a convincing aerial appearance, and whether
the result remains responsive in a browser. Attractive invented ridges do
not establish measured topographic accuracy.

## Repeatable views

| Region | What the view tests | Evidence boundary |
| --- | --- | --- |
| Mid-Atlantic Ridge | Submerged axial relief and flanking seafloor | Use an explicit seafloor inspection mode. The ordinary ocean surface remains at sea level. Fine abyssal features need bathymetric evidence. |
| Himalayas | Mountain belt, high plateau, foothills and elevation transitions | A coarse elevation grid supports broad placement, not individual summits or valleys. |
| Andes | Long mountain belt and volcanic-margin setting | Avoid adding a second mountain belt on top of an elevation model that already includes it. Authored volcanic details remain synthesis. |
| East African Rift | Depressed rift floors and elevated shoulders | A generic trench is not evidence of the actual interconnected rift geometry. |
| Greenland | Ice-sheet surface, coastal relief and ice margins | Aerial topography requires the ice-surface elevation product; subglacial bedrock is a separate view. |
| Sahara and Sahel | Desert to semi-arid grassland transition | Distinguish desert, steppe and savanna; not every dry region is a sand sea. |
| Amazon | Humid tropical forest appearance | Climatic forest potential does not reproduce deforestation, agriculture or individual species. |
| Central Asian steppe | Dry grassland and continental transitions | Preserve distinctions from both desert and closed forest. |
| Siberian boreal region | Cold forest, tundra and snow distinctions | Modern cold forests must not become permanent white ice from latitude alone. |
| Patagonia | Wetter western slopes and drier eastern plains | Reproducing a climate-map contrast does not establish a working atmospheric or rain-shadow solver. |

## Compact scientific controls

Beck et al. (2023) publish historical Köppen–Geiger climate classifications,
including 1991–2020, at several resolutions from 0.01° to 1°. The Figshare
dataset record identifies the archive as CC0. EarthHistory now ships the
author-provided 0.5° 1991–2020 classification as a losslessly run-length encoded
720×360 grid with the complete legend. It constrains modern climatic vegetation
potential while the browser synthesizes color and material variation. It is a
climate class rather than a direct inventory of forests, and the loader omits it
from the LGM and every older chapter.

NOAA ETOPO 2022 supplies modern global relief with separate ice-surface and
bedrock products. Five lazy 256×256 patches now cover the named landform views
through the NOAA ImageServer's `ETOPO_2022_v1_60s_surface` mosaic. Each stores
outer and pixel-center bounds, WGS84 coordinates, EGM2008 metres, row order,
source resampling method and source/output hashes. Values are bilinearly sampled
then rounded to metre-scale int16. The patches are generation inputs and are not
also treated as independent withheld accuracy tests.

## Rendering and measurement

Capture the same camera, viewport and lighting with clouds off. Compare 1×
physical relief with a documented exaggerated setting. Keep climate and
scientific elevations unchanged when the display scale changes. Report the
source resolution separately from the generated texture or mesh resolution.

Inspect the resulting images for recognisable landforms, plausible material
transitions, coast alignment, permanent ice and visible relief. Test broad
view and regional refinement independently. Record production artifact hashes,
backend, device, frame-time distributions, camera response, generation time
and bounded cache use. Reduce regional detail if it breaks the interaction
budget; do not declare success merely because a displacement uniform changes.

## Primary references

- Beck et al. (2023), [High-resolution (1 km) Köppen–Geiger maps for 1901–2099](https://www.nature.com/articles/s41597-023-02549-6), DOI 10.1038/s41597-023-02549-6. Modern and historical climate classification methods; not deep-time reconstructions. Accessed 2026-09-07.
- NOAA NCEI, [ETOPO Global Relief Model](https://www.ncei.noaa.gov/products/etopo-global-relief-model), ETOPO 2022, DOI 10.25921/fd45-gt74. Modern topography and bathymetry; distinguish ice-surface and bedrock variants. Accessed 2026-09-07.
- NOAA Ocean Exploration, [Mid-Ocean Ridge](https://oceanexplorer.noaa.gov/ocean-fact/mid-ocean-ridge/). Divergent-boundary setting; a regional story source, not a terrain grid. Accessed 2026-09-07.
- NASA Earth Observatory, [Snow in the Shadow of the Andes](https://science.nasa.gov/earth/earth-observatory/snow-in-the-shadow-of-the-andes/), 2026. Patagonian windward precipitation and eastern rain-shadow context. Accessed 2026-09-07.
- NASA Earth Observatory, [Vegetation and Rainfall in the Sahel](https://science.nasa.gov/earth/earth-observatory/vegetation-and-rainfall-in-the-sahel-7277/), 2007. Regional desert–grassland–humid-forest context. Accessed 2026-09-07.
- NASA Earth Observatory, [The Migrating Boreal Forest](https://earthobservatory.nasa.gov/Features/BorealMigration/). Pollen and other evidence of changing forest distribution; present forest positions cannot be projected unchanged through time. Accessed 2026-09-07.

These narrative references do not grant blanket redistribution rights to
their embedded images. No reference imagery is bundled by this document.
