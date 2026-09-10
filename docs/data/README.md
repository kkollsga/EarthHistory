# EarthHistory runtime data

The application serves a compact, static control bundle from `public/data/`.
It makes no runtime calls to scientific services. `src/data/index.ts` is the
public TypeScript API; `public/data/manifest.json` records input and output
checksums, byte sizes, source ages, and transformations.

## What the snapshots mean

`getSnapshot(requestedAgeMa)` selects the nearest supported authored surface
or named early-Earth scenario. It does not interpolate longitude/latitude
geometry. For Phanerozoic chapters, `ageMa` and `geographicSourceAgeMa` are the
actual PALEOMAP grid age, while `requestedAgeMa`, the chapter label, and the
unique snapshot ID preserve the selected story time. This distinction matters
at the K–Pg boundary (66.04 Ma story, 65 Ma grid), the Antarctic glaciation
onset (33.6 Ma story, 35 Ma grid), and the Last Glacial Maximum (0.021 Ma
story, 0 Ma grid).

The checked-in catalog includes all 109 frames present in the pinned PaleoDEM
CSV archive, one every 5 Ma from 0 through 540 Ma. The reconstruction picker
exposes these native source ages independently of the authored chapter picker.
Elevation, reconstructed-country, and temporal-tracking promises each use a
three-entry LRU; evicting a pending entry aborts its fetch, and a late rejection
can remove only the exact promise that installed it.

The 0–540 Ma elevation controls derive from
[Scotese & Wright (2018) PALEOMAP PaleoDEM v2](https://doi.org/10.5281/zenodo.5460860),
CC BY 4.0. The runtime files preserve the deposited 1 degree sampling in a
compact signed-int16 little-endian format. They contain 360 longitude grid
points from -180 to +179 and 181 latitude points from +90 to -90. Source CSVs
with a duplicate +180 endpoint omit it after validation. The 150–395 Ma CSVs
end at -89; their runtime south-pole row repeats that nearest source row.
Values are metres relative to each authored paleo sea level and remain model
output. Each file starts with a 16-byte `EHPD` header carrying schema version,
age and dimensions, so a same-sized file for another frame cannot be accepted.

The deposited 0 Ma CSV contains two records for the same physical meridian.
Its -180 degree record is an artificial zero at every integer latitude from
60 through 89 degrees south, while the +180 degree duplicate is populated and
continues the neighboring relief. During 0 Ma ingestion only, EarthHistory
uses the +180 value for that exact verified -180 duplicate-zero run before
endpoint collapse. This changes 30 runtime cells from -60 through -89; the
source-authored -90 row remains unchanged. It does not alter the pinned
source archive, other 0 Ma cells, or any other PaleoDEM age. The adapter
condition and affected derived-cell count are recorded in the static manifest
so an upstream source change fails preparation instead of silently broadening
the correction.

Every longitude in a ±90 degree raster row denotes the same mathematical
point, but the deposited 0 Ma north-pole values are inconsistent. The display
therefore replaces each exact-pole row with its finite-row median, then
interpolates to the unchanged ±89 degree source row. This is a robust display
normalization, not a new elevation observation and not another asset mutation.
It operates after the narrow 0 Ma ingestion adapter above and does not smooth
non-pole ridges or resolve the model's polar topographic uncertainty.

After source controls and disclosed visual inferences produce the renderer's
broad relief, the runtime retains those generated metre values in a one-channel
Float32 field for cube geometry and normal sampling. The existing RGBA relief
is preserved for the legacy GPU path. Avoiding a second 8-bit display
quantization changes representation only; it does not refine PaleoDEM, add an
observation, or alter any static source control. The 768×384 Float32 field adds
1.125 MiB, and runtime cache and worker-context accounting include its copies.

Surface and exposed-seafloor views are available at every 0–540 Ma source age.
The latter reveals the same signed PALEOMAP bed control beneath the water; it
does not add surveyed bathymetry. Terrain color, roughness and bounded
material-scale texture vary continuously with source elevation, local source
gradient and the documented climate potential. The physical surface no longer
embosses the incomplete authored tectonic story corridors. Those corridors
remain a separately labelled, opt-in reference overlay rather than source
plate-boundary geometry.

The nonzero-age country layer derives from the PALEOMAP Political Boundaries
v3 feature archive and its matching PALEOMAP Global Plate Model v3, both in
Zenodo record 7994000 under CC BY 4.0. The source features already carry their
PALEOMAP reconstruction plate IDs. The preparation script reconstructs them
with pyGPlates 1.0, anchor plate 0, then simplifies each display line with a
0.18 degree tolerance. These lines are a present-day political reference
projected through the plate model. They are approximate locator aids, never
historical borders or evidence that a country or people existed at that age.
The runtime omits features that the source model cannot reconstruct.

Schematic latitude/circulation guides are visible by default but remain
toggleable. Their small labels are depth-tested patches aligned to the globe
surface, and exact pole targets disappear behind the horizon. These are printed
reference marks, not period-specific Hadley-cell evidence or climate output.

At 0 Ma, Natural Earth 1:110m public-domain land and Admin 0 lines provide the
present-day reference overlay. The rendered elevation/coast control still
comes from the 0 Ma PALEOMAP grid, so the whole snapshot is labeled model
output rather than treating the Natural Earth overlay as certification of all
surface fields.

## Period coordinates and ocean material

The runtime's shared period-coordinate contract includes model/version,
reference frame, anchor plate, axes, material identity, reference age and
validity. The PALEOMAP motion catalog preserves the reconstruction family
named by the v2 elevation source. At intermediate ages the renderer finds
material at the displayed position, reconstructs it into both neighboring
source grids and interpolates their registered heights. Missing correspondence
remains a disclosed discrete fallback. Decorative detail changes shading,
not the published elevation recovered at an exact source age.

The optional Cao 2024 v2.4 view uses a single shared bundle of static
continental fragments, ocean topologies, rotations and lifecycle controls.
The coordinate-pose cache retains four ages: the material reference, requested
age and both source endpoints. This small fixed bound prevents repeated pose
rebuilding; the separate source-grid loaders still retain at most three ages.
Its continental height crosswalk has quantified coverage gaps, so unsupported
cells remain neutral and PALEOMAP stays the default. Country-reference lines
are split by target continental fragment. Tagged ocean material stores a
valid past reference age; it does not require surviving present-day crust.

Ocean lifecycle controls use a 2° grid at 109 displayed ages, with source
history traced in 5 Ma steps to 1000 Ma. Formation/loss intervals are
boundary-attributed model inferences; unattributed and model-censored
histories remain distinct. Sampling requires matching topology identity, and
the lifecycle asset is bound to the motion catalog's slot identities. Ridge
and subduction curves retain source type, adjacency and polarity. Interpolated
curves use validated segment correspondence and spherical arclength; source
crossovers and unmatched segments remain unsupported.

Ocean thermal depth and added boundary morphology are separate inferred
quantities, not observed bathymetry. Physical metres remain separate from
display exaggeration. The [palaeomap study](../research/palaeomap-accuracy-study.md)
and [continuous validation record](../research/palaeomap-continuous-validation.json)
document the sources, rejected conversion method, support limits and checks.

## Earlier than 540 Ma

The bundle does not claim resolved early-Earth geography. Named Hadean,
Archean, and Proterozoic snapshots return deterministic, low-resolution
artistic crust/island elevation only to keep the globe visually legible. Their
caveat states that it is non-geographic. The Moon-forming chapter combines a
published giant-impact mechanism with a 4.51 Ga lunar-zircon chronology as an
uncertain scenario; it supplies no terrestrial impact coordinate. The 4.404
Ga Jack Hills zircon supports early crust–water interaction, not a known ocean
shoreline or source location.

Vegetation capacity is zero before accepted land-plant evidence, sparse from
the Ordovician through early vascular-plant stages, forest-capable only from
the Mid-Devonian evidence interval, and angiosperm-capable later. The renderer
receives this era mask in both environment metadata and a compact potential
field. It must not replace those limits with modern forest textures.

Ice is also a disclosed potential field. It combines each scenario's broad
temperature and ice state with latitude and authored elevation. This produces
high-elevation and polar variation instead of a flat white latitude band, but
it is not an observed or simulated ice-sheet boundary. The Cryogenian control
is a global snowball scenario; the source supports glaciation timing better
than exact global ice geometry. The 35 Ma and LGM controls similarly identify
event states while retaining their geometry limitations. The official Cao et al.
(2017) categorical package supplies a limited permanent-ice absence constraint
for ages strictly between 81 and 285.01 Ma. No geometry is transferred from
its Matthews-family reconstruction; absence of mapped ice is not proof that
the Earth was ice-free. Sparse high-altitude snow remains inferred climate
potential.

## Modern climate and regional relief

The present-day snapshot alone loads the
[Beck et al. (2023) historical Köppen–Geiger classification](https://doi.org/10.1038/s41597-023-02549-6)
for 1991–2020. The source Figshare dataset is CC0.
EarthHistory extracts the authored 0.5 degree GeoTIFF from the 92.2 MB archive
with bounded HTTP range requests, then losslessly run-length encodes its 720 by
360 categorical cells and complete 30-class legend. The class grid constrains
modern climate potential; it is not mapped vegetation or a forest inventory.
It is deliberately absent from the 21 ka LGM snapshot even though that chapter
uses the 0 Ma PaleoDEM geography grid.

The Beck raster's last complete Antarctic boundary row, centered at 88.25
degrees south, is entirely `EF`; its three poleward rows are no-data. For the
modern surface display only, EarthHistory extends that complete `EF` boundary
through the terminal no-data gap. Classification and fractional membership use
the same lookup so the pole cannot become a gray or blue hole. This is an
explicit display gap-fill inferred from the source boundary, not an observed
climate value, and the original categorical bytes remain unchanged. An `EF`
cell may color an ice-covered surface over negative PaleoDEM bed elevation;
explicit seafloor mode retains the signed bed. Neither rule supplies measured
ice thickness, ice-surface elevation, or a new ice-sheet outline.

Seven modern landscape views can lazily request independent 256 by 256 ETOPO
2022 relief tiles: the Mid-Atlantic Ridge, Himalayas, Central Andes, East
African Rift, Greenland, Alps and Japan Trench. The Alps crop covers 4–17°E,
43–49°N; the Japan crop covers 125–160°E, 18–52°N. Each asset records outer
WGS84 bounds, first/last pixel-center bounds, longitude/latitude step,
north-to-south row order, metres, the EGM2008 vertical datum and the
`ETOPO_2022_v1_60s_surface` product. Source pixels are bilinearly resampled by
NOAA's ImageServer, then rounded to whole metres and stored as little-endian
int16 data. Greenland therefore uses visible ice-surface relief rather than
the separate bedrock product. The signed Japan topobathymetry is eligible in
surface and seafloor views; its negative elevations influence bathymetric
material and normals beneath surface water without displacing that water below
sea level. All seven patches are valid only at 0 Ma. They are generation inputs
and cannot also serve as independent accuracy tests.

Local surface refinements use a sparse multi-resolution set contract. Every
tile declares set and parent/child identity, valid requested age, reference
frame and datum, surface domain/mode, source priority, native resolution,
bounded transition width and projected-error split/merge thresholds. A complete
coarser parent remains the fallback; finer children are authored only where
height/normal residuals or categorical boundaries project visibly. Runtime
selection uses 1.5 pixel split and 1.0 pixel merge hysteresis, so coasts,
mountains and zone boundaries can gain resolution without expanding flat-area
payloads. Resolution never establishes scientific authority: priority, age and
frame compatibility do.

The first non-ETOPO refinement is a two-level central North Sea subset of
EMODnet DTM 2024, requested from the official mean-elevation WCS over 1–4°E and
55–58°N. A 64 by 64 block-mean parent provides the complete local fallback; a
256 by 256 child is selected only when the parent's delivered cell footprint
projects above the split threshold. The child cell step is 0.01171875 degrees;
the source product is approximately 115 m, uses EPSG:4326 horizontally and
Lowest Astronomical Tide vertically, and is a harmonized/interpolated DTM
rather than raw survey soundings. It applies only to the present-day seafloor
view. Because the global ETOPO controls use EGM2008, the wide boundary feather
is explicitly visual synthesis and must not be read as a datum conversion or
navigation surface. The regional overlay retains the global material palette,
so a refinement's rectangular storage footprint is not presented as a mapped
scientific boundary.

## Reproduction and bounds

Run `python3 scripts/prepare-data.py` to download and regenerate Natural Earth
and PaleoDEM assets using the Python standard library. Run
`python3 scripts/prepare-data-countries.py` with pyGPlates 1.0 available to
regenerate the country reference assets. `scripts/prepare-data-modern.py`
reproduces the compact climate asset with bounded ZIP range reads, and
`scripts/prepare-data-relief.py` requests only the seven named ETOPO subsets.
`scripts/prepare-data-refinements.py` requests the bounded EMODnet North Sea
subset and records its exact service URL and response hash.
The scripts pin archive or response hashes in the manifest. The owned scratch
cache is `dev-docs/temp/earthhistory-data/`, has a hard 50 MiB limit, and is
regenerated/cleaned by the data-preparation owner. The checked-in runtime bundle
is kept within the validated static-asset budget.

The static source manifest is the byte-level authority. Scientific citations,
licenses, time coverage, geographic basis, and reference-frame notes are also
available at runtime through the exported `sources` catalog. POI coordinates
are present evidence locations unless `locationNote` says otherwise; they are
not silently treated as reconstructed paleo coordinates.
