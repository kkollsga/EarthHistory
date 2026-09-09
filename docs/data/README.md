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

The 0–540 Ma elevation controls derive from
[Scotese & Wright (2018) PALEOMAP PaleoDEM v2](https://doi.org/10.5281/zenodo.5460860),
CC BY 4.0. The runtime files sample the deposited 1 degree CSV
grids at 2 degree spacing. They contain 180 longitude grid points from -180 to
+178 and 91 latitude points from +90 to -90. Several older source CSVs end at
-89; their runtime south-pole row repeats the nearest sampled -88 row. Values
are metres relative to each authored paleo sea level and remain model output.

The deposited 0 Ma CSV contains two records for the same physical meridian.
Its -180 degree record is an artificial zero at every integer latitude from
60 through 89 degrees south, while the +180 degree duplicate is populated and
continues the neighboring relief. During 0 Ma ingestion only, EarthHistory
uses the +180 value for that exact verified -180 duplicate-zero run before
2 degree sampling. This changes 15 even-latitude runtime cells from -60 through
-88; the source-authored -90 row remains unchanged. It does not alter the pinned
source archive, other 0 Ma cells, or any other PaleoDEM age. The adapter
condition and affected derived-cell count are recorded in the static manifest
so an upstream source change fails preparation instead of silently broadening
the correction.

Every longitude in a ±90 degree raster row denotes the same mathematical
point, but the deposited 0 Ma north-pole values are inconsistent. The display
therefore replaces each exact-pole row with its finite-row median, then
interpolates to the unchanged ±88 degree source row. This is a robust display
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

The nonzero-age country layer derives from the PALEOMAP Political Boundaries
v3 feature archive and its matching PALEOMAP Global Plate Model v3, both in
Zenodo record 7994000 under CC BY 4.0. The source features already carry their
PALEOMAP reconstruction plate IDs. The preparation script reconstructs them
with pyGPlates 1.0, anchor plate 0, then simplifies each display line with a
0.18 degree tolerance. These lines are a present-day political reference
projected through the plate model. They are approximate locator aids, never
historical borders or evidence that a country or people existed at that age.
The runtime omits features that the source model cannot reconstruct.

At 0 Ma, Natural Earth 1:110m public-domain land and Admin 0 lines provide the
present-day reference overlay. The rendered elevation/coast control still
comes from the 0 Ma PALEOMAP grid, so the whole snapshot is labeled model
output rather than treating the Natural Earth overlay as certification of all
surface fields.

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
event states while retaining their geometry limitations.

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

Five modern landscape views can lazily request independent 256 by 256 ETOPO
2022 relief patches: the Mid-Atlantic Ridge, Himalayas, Central Andes, East
African Rift and Greenland. Each asset records outer WGS84 bounds, first/last
pixel-center bounds, longitude/latitude step, north-to-south row order, metres,
the EGM2008 vertical datum and the `ETOPO_2022_v1_60s_surface` product. Source
pixels are bilinearly resampled by NOAA's ImageServer, then rounded to whole
metres and stored as little-endian int16 data. Greenland therefore uses visible
ice-surface relief rather than the separate bedrock product. These patches are
generation inputs and cannot also serve as independent accuracy tests.

## Reproduction and bounds

Run `python3 scripts/prepare-data.py` to download and regenerate Natural Earth
and PaleoDEM assets using the Python standard library. Run
`python3 scripts/prepare-data-countries.py` with pyGPlates 1.0 available to
regenerate the country reference assets. `scripts/prepare-data-modern.py`
reproduces the compact climate asset with bounded ZIP range reads, and
`scripts/prepare-data-relief.py` requests only the five named ETOPO subsets.
The scripts pin archive or response hashes in the manifest. The owned scratch
cache is `dev-docs/temp/earthhistory-data/`, has a hard 50 MiB limit, and is
regenerated/cleaned by the data-preparation owner. The checked-in runtime bundle
is about 5.1 MiB.

The static source manifest is the byte-level authority. Scientific citations,
licenses, time coverage, geographic basis, and reference-frame notes are also
available at runtime through the exported `sources` catalog. POI coordinates
are present evidence locations unless `locationNote` says otherwise; they are
not silently treated as reconstructed paleo coordinates.
