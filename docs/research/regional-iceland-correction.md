# Regional Iceland surface and material correction

Research and retrieval date: 2026-09-12. Runtime correction:
`earthhistory-regional-iceland-surface-v1`.

## Confirmed defect

The missing island is a source omission, not a rendering or triangulation
failure. At 0 Ma, a fixed central-Iceland witness (64.9° N, 18.9° W) is inside
zero polygons in both pinned Cao v2.4 source collections. Its nearest geometry
is 530.364 km away in `shapes_coasts.gpmlz` and 329.928 km away in
`shapes_continents.gpmlz`. The compiler recomputes this witness against the
hash-pinned source files; the generated Cao land batch likewise has no Iceland
chart.

## Geometry and evidence

The exact-modern correction uses the Natural Earth 1:50m Admin 0 Iceland
polygon, version 5.1.1 (public domain). Its 453 source vertices replace the
20-vertex 1:110m outline after the coarser polygon failed regional visual
review. It is `observed-exposed-land` only at exactly 0 Ma, uses the shared
land display color, and disappears at every age greater than zero.

Non-modern geometry comes from the Natural Science Institute of Iceland's
official bedrock-age WFS layer `NATT:ISL_IINH_500k_BA`, licensed CC BY 4.0.
The layer identifier retains the earlier 1:500,000 name; the pinned official
metadata identifies the current lineage as the second-edition 1:600,000 map,
revised in 1998, 2009 and 2014, with about ±500 m map uncertainty. The source
is a present-day outcrop map. Its polygons constrain material age; they do not
establish an ancient coastline, exposed surface or elevation.

EarthHistory selects four map classes:

| Class | Source age meaning | Runtime interpretation |
| --- | --- | --- |
| `gold` | older than 3.3 Ma | model-pose material from >0–3.3 Ma; possible-formation range from >3.3–16.3 Ma |
| `gnew` | 0.8–3.3 Ma | model-pose material from >0–0.8 Ma; possible-formation range from >0.8–3.3 Ma |
| `hraun` | younger than 0.8 Ma | possible-formation range strictly between 0 and 0.8 Ma |
| `mob` | younger than 0.8 Ma | possible-formation range strictly between 0 and 0.8 Ma |

The 16.3 Ma endpoint is a source-coverage bound from the oldest published
exposed-lava age, 16.0 ± 0.3 Ma (Moorbath, Sigurdsson & Goodwin, 1968). It is
not the birth age of Iceland. Harðarson, Fitton & Hjartarson (2008) provides
the exposed volcanic chronology and ridge-jump context. Blischke et al. (2022),
*Seismic Volcanostratigraphy: The Key to Resolving the Jan Mayen Microcontinent
and Iceland Plateau Rift Evolution*, documents migrating rift zones and
eastward rift transfers. These sources do not justify moving the modern island
as one rigid polygon.

The selected bedrock units cover 63.3922495% of the original 1:110m generalized
Natural Earth land polygon. The compiler retains that boundary solely as the
frozen denominator for the accepted historical-coverage metric; changing the
exact-modern display outline does not reclip or reinterpret the older source
geometry. On that basis, the remaining 39,337.094 km² is unclassified by this
bounded correction. It is not confirmed sea and does not show that underlying
crust or material was absent. Historical views therefore show a partial
material footprint, with unknown exposure, rather than a complete reconstructed
island.

## Cao pose and frame

At 0 Ma the compiler resolves the pinned Cao v2.4 topology in the model's
palaeomagnetic frame anchored to plate 0. It splits every Iceland source class
at the two exact shared Mid-Ocean-Ridge subsegments between plate 101 (North
America) and plate 301 (Eurasia). Each half then follows its corresponding Cao
motion palette. This two-rigid-plate split is a model approximation of a
deforming ridge island, so every non-modern Iceland chart carries
`poseStatus: model-inference`; no pale pose is labelled as cited reconstruction
geometry. All land and material batches use one display color. Their observed,
source-qualified, model-inferred and formation-range meanings remain separate
in chart metadata and the map key instead of being encoded by fill color.

The direct pyGPlates compiler oracle checks plates 101 and 301 at 13 edge and
interior ages from 0 through 16.3 Ma; its largest palette-to-strict-rotation
residual is 3.476e-7 radians. Independent review samples each plate every 0.01
Ma (1,631 ages per plate): plate 101 peaks at 3.292e-7 radians at 0.38 Ma and
plate 301 at 1.465e-6 radians at 13.5 Ma. Both remain below the 1e-5-radian
acceptance limit. The compiler-oracle result is bound to the final core,
palette and correction-catalog hashes in
[`regional-iceland-motion-validation.json`](regional-iceland-motion-validation.json).
The dense independent result and unchanged-native checks are recorded in
[`regional-iceland-independent-review.json`](regional-iceland-independent-review.json).

## Reproduction and acceptance

The offline source snapshot is bounded outside the repository at
`../EarthHistory-data/palaeomap-study/verification/regional-iceland-correction-v1/source-inputs`.
[`regional_iceland_compile.py`](../../scripts/research/regional_iceland_compile.py)
pins all WFS/WMS responses, style and metadata members and deterministically
emits the tracked GeoJSON, source manifest and validation report. The runtime
validator is safe in a clean checkout; external source-byte validation is an
explicit `--sources` mode.

Accepted age witnesses are 0, 0.001, 0.021, 0.8, 1, 3, 3.3, 5, 10, 15 and
16.3 Ma. At 16.300001 and 20 Ma the correction has no active chart because its
source coverage has ended. Mutation checks reject modern backdating, pale
observed-surface claims, a false 20 Ma endpoint, plate reassignment, inferred
pose relabelling and divergence from the uniform land display color.

Primary records: [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/),
[Iceland institute open-data terms](https://www.natt.is/en/resources/open-data),
[official geological-map page](https://www.natt.is/en/resources/geospatial-data/geological-maps),
[Moorbath et al. 1968](https://doi.org/10.1016/0012-821X(68)90035-6),
[Harðarson et al. 2008](https://jokull.jorfi.is/articles/jokull2008.58/jokull2008.58.161.pdf),
and [Blischke et al. 2022](https://doi.org/10.1029/2021GC009948).
