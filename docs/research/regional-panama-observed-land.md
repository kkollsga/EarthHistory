# Panama exact-present observed-land correction

Research, source-contract and package status: verified public integration,
2026-09-13.

## Reproduced failure

At 0 Ma, Natural Earth 1:50m supplies a generalized Panama land polygon of
about 74,245 km². Cao v2.4 `shapes_coasts` covers only about 10,303 km², or
13.88% of that polygon. Western Panama (plate 231) is present. Central Panama
(230) and the young Eastern Panama partition (229) are absent from the Cao
coast collection, while the plate-201 Eastern Panama source contributes only a
small edge in the comparison window. This is a source-layer omission rather
than a rotation or renderer error: every relevant 0 Ma rotation is identity.

The earlier [Caribbean diagnosis](cao-caribbean-panama-cuba.md) correctly
identified the missing native coast rings, but its conclusion predated the
accepted Natural Earth exact-present observed-land correction policy.

## Bounded source correction

The compiler selects `ADM0_A3=PAN` from Natural Earth 1:50m Admin 0 Countries,
subtracts the union of Cao coast polygons active and emitted at 0 Ma, and
intersects the uncovered land with six pinned Cao static polygons. Five pieces
remain above 0.001 km²:

| Source order | Cao identity | Plate | Missing-land components / vertices |
| --- | --- | ---: | ---: |
| 289 | Eastern Panama, `GPlates-2d916a07-…` | 229 | 3 / 109 |
| 532 | Nazca, `GPlates-6e16f4f2-…` | 911 | 1 / 13 |
| 533 | Nazca, `GPlates-e16723c1-…` | 911 | 2 / 12 |
| 798 | Central Panama, `GPlates-21e07ac6-…` | 230 | 4 / 91 |
| 2032 | Western Panama, `GPlates-37c480a5-…` | 231 | 9 / 47 |

The plate-201 residual is below 0.001 km² and is not emitted. The union is
about 63,942 km², with a 0.0327 km² source-partition seam, no measured pair
overlap, and no measured overlap with retained native land. A full Panama
overlay was rejected because it would duplicate about 10,303 km² of native
land and weaken native evidence and picking precedence.

The geometry is generalized observed modern land. It is valid at exact 0 Ma
only and makes no shallow-water, shelf, bathymetric, palaeoshoreline, or
historical-exposure claim. Cao static polygons supply present ownership only.
Plates 229, 230, and 911 require exact-[0,0] identity motion bindings; plate 231
reuses its existing present binding. The correction must disappear for every
age greater than zero.

The land applicator itself does not alter `country:pan`. Its 40 unsupported
subdivisions remain a separate reconstruction limitation. The independently
integrated exact-0 country-reference completion may add the missing modern
locator segments, while historical country-reference charts remain unchanged.

## Sources and reproducibility

- Natural Earth, *Admin 0 – Countries*, 1:50m, version 5.1.1, public domain,
  WGS84, retrieved 2026-09-12. The pinned archive is 799,734 bytes with SHA-256
  `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139`.
  “Made with Natural Earth.”
- Cao et al. (2024), model v2.4, Zenodo
  `doi:10.5281/zenodo.13628813`, CC BY 4.0, retrieved 2026-09-09. The geometry
  basis is the Cao palaeomagnetic absolute frame, anchor plate 0, at geometry
  reference age 0 Ma. Exact file identities and ordered static-polygon geometry
  digests live in the source contract.

Run the external-source compiler with the pinned pyGPlates/Shapely environment.
Pyshp is a compiler-only dependency pinned to 2.3.1 and installed into the
owned scratch directory; it is not a runtime or clean-checkout dependency:

```sh
python3 -m pip install --no-deps --target /tmp/earthhistory-panama-pyshp pyshp==2.3.1
PYTHONPATH=/tmp/earthhistory-panama-pyshp:../EarthHistory-data/palaeomap-study/verification/svalbard-shapely \
  ../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python \
  scripts/research/regional_panama_compile.py
python3 scripts/research/regional_panama_correction.py --self-test
```

The compiler writes only the isolated tracked input and validation record. It
does not mutate `public/data`. The clean-checkout validator rejects source,
plate, lifecycle, surface-class and country-consumer mutations. The exact
coverage and asset identities are in
[`regional-panama-validation.json`](regional-panama-validation.json).

Visual witnesses for the integrated package: 0 Ma at 80.5°W, 8.5°N,
distance about 1.45 for the isthmus; 0.000001 Ma at the same camera must show no
correction. Picking must prefer native Western Panama where it already exists
and report the new observed-generalized class only in the formerly missing
central/eastern area.

## Package integration

The final package appends five contiguous charts at core indices 4841–4845,
291 refined land vertices and 272 triangles. Plates 229, 230 and 911 each use
one singleton identity sample whose source interval set contains an exact
`smooth-motion` interval and exact `source-knot`, both `[0,0]`; plate 231 keeps
its qualified existing binding. Every Panama chart is inactive at
0.000001 Ma. The separate country-reference extension supplies the missing
modern locator geometry without changing any historical country chart.

The applicator preserves all prior land geometry, core-chart, palette-entry,
source-interval and motion-record prefixes. Its public validator retriangulates
the tracked source geometry, compares the exact float32 mesh and per-chart
ownership, and rejects lifecycle, source-feature, singleton-interval and
cross-chart vertex mutations. The integrated public core is 6,110,352 bytes,
SHA-256 `78f95eb44752304c75df0ba57e0549f41d0899ac030583c29d2d35a37f11c34b`;
the land batch is 6,733,436 bytes, SHA-256
`423626079128d5bb671f808acc44aa1d689067ec5290a41e6a029a5d53fcd443`.
Independent review confirmed native precedence, exact-present picking and
stage-to-public byte identity.
