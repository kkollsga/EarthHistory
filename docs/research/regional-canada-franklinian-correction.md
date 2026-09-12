# Northern Canada Franklinian material correction

Status: source-qualified candidate regenerated on 2026-09-12. The Cao v2.4
sources remain immutable. This correction represents continental-material
support with unknown surface exposure. It is not a coastline, land mask,
topographic reconstruction, or claim that modern ice and water were present.

## Result

Forty-four Cao coastline charts on plates 120, 141, 122, and 123 end at 410
Ma. Their exact 410 Ma union is 237,773.18 km² in the common local equal-area
measurement. Native coverage changes from 100% at exactly 410 Ma to zero just
older than 410 Ma. The candidate restores 202,358.96 km², or **85.106%**, of
that union. The former guarded-outcrop candidate restored 41.13%.

The increased coverage has two source-bounded parts. A mapped-unit component
uses Canadian Geoscience Map 80 Franklinian/Arctic Platform units and named
younger cover settings. A continental-extent component intersects each exact
target with the pinned Cao `Laurentia aCOB` model feature. Both are explicitly
differenced from the plate-124 Pearya targets and the independently mapped
Pearya tectonic domain. Nothing outside an affected Cao target is added.

| Cao plate | Target charts | Target area | Candidate area | Support | Coordinates |
|---:|---:|---:|---:|---:|---:|
| 120 | 18 | 100,397.03 km² | 91,445.30 km² | 91.08% | 1,556 |
| 122 | 3 | 40,483.92 km² | 33,836.09 km² | 83.58% | 383 |
| 123 | 7 | 62,389.81 km² | 42,577.10 km² | 68.24% | 1,458 |
| 141 | 16 | 45,795.91 km² | 45,795.88 km² | 100.00% | 292 |

Cross-cohort overlap explains why the cohort-area sum differs from the union.
The delivered four-feature geometry has 3,689 coordinates. The spherical-area
diagnostic is 85.106%, agreeing with the equal-area result.

The largest remaining unsupported areas are source-limited. Per-cohort Map
2159A classifications identify about 27,024 km² beneath modern ice, about
7,099 km² in the Ellesmere–North Greenland fold belt, about 2,695 km² in the
eastern Sverdrup/Eurekan domain, and smaller shelf or unmapped fragments.
These are per-cohort totals and can overlap. The candidate leaves them absent
rather than treating an old continental-boundary envelope as proof of every
interior material assignment.

## Source basis and rights

The mapped-unit source is Harrison, Lynds, Ford, and Rainbird (2016),
*Geology, Simplified tectonic assemblage map of the Canadian Arctic Islands*,
Canadian Geoscience Map 80, scale 1:2,000,000,
[doi:10.4095/297416](https://doi.org/10.4095/297416). Nine required members
total 129,974,488 bytes; the owned directory is 129,978,816 bytes, below its
128 MiB cap. The full 426 MB repository bundle was not acquired.

The regional classification source is Harrison et al. (2011), *Geological map
of the Arctic*, Map 2159A, scale 1:5,000,000,
[doi:10.4095/287868](https://doi.org/10.4095/287868). The bounded official
ArcGIS layer-0 query contains 2,937 northern-Canada records and all attributes
in 26,544,226 bytes. With official service and licence metadata, the retained
members total 26,714,227 bytes and the owned directory is 26,717,391 bytes.
This source is used to classify Pearya, ice, Sverdrup, fold-belt, shelf, and
unmapped portions; it is not a palaeogeographic snapshot.

Both Canadian products are identified by their current official records as
Open Government Licence – Canada material. Required attribution is preserved
in the manifests. The CGM 80 embedded information PDF also contains an older,
more restrictive notice; the source record preserves that conflict for future
review. The complete palaeomap source store measured 3,710,809,787 bytes,
below its 4 GiB bound after this acquisition.

The older extent source is the exact `Laurentia aCOB` feature
`GPlates-a11dc09a-42de-4b11-a6ce-d30baae64ce4`, source order 1284, plate 101,
from the pinned [Cao et al. v2.4 model](https://doi.org/10.5281/zenodo.13628813).
Its source collection SHA-256 and feature identity are rejected if changed.
The model is CC BY 4.0. The feature is an authorial continental-boundary
hypothesis, not a mapped exposure boundary. The model lineage follows the
continental-lithosphere interpretation described in the
[Merdith et al. model supplement](https://zenodo.org/records/12525401), where
coastline-to-boundary crust can be inferred and later deformed.

## Unit and geometry policy

The `direct-ancient-unit` tier retains mapped Ediacaran, Cambrian, and
Ordovician units in Franklinian rift, Franklinian shelf/Arctic Platform, or
Arctic Platform settings. The `younger-cover-substrate-inference` tier retains
younger rock only where the named setting supports an older northern
Laurentian substrate. This includes Sverdrup shelf, rift, and deep-basin cover:
Map 80 describes Carboniferous–Paleogene Sverdrup strata unconformably
overlying the older Franklinian and Ellesmerian assemblages. The inference is
about substrate; it does not backdate the surface unit.

Pearya settings, glacier-only records, Hazen and other ambiguous deep-water or
trough settings, blank settings, and unrelated domains remain excluded. The
compiler preserves each included and excluded unit, source record order, age
band, area, evidence tier, and reason.

The old 3.1 km inward buffer discarded extensive narrow mapped units and
created most of the residual seam. The replacement dissolves internal unit
boundaries, applies a topology-preserving 5 km source-scale approximation,
drops components below 25 km², and clips again to the exact target and Pearya
exclusions. Per cohort, area change stays below 10% and simplified area outside
the raw mapped source stays below 6%. The aCOB addition is then clipped by the
exact target. Tests require zero reported area outside the final target or
qualified component union and zero Pearya overlap.

## Pose, endpoints, and uncertainty

Each mapped component is posed from present coordinates to 410 Ma with its
native Cao plate rotation. The aCOB component is reconstructed with plate 101
at its youngest valid age, 410.1 Ma, and carried 0.1 Ma to the 410 Ma reference
frame. Older motion uses plate 101. Independent coordinate witnesses verify
that this agrees with the frozen Cao target-plate circuits to numerical
precision at 411, 415, 420, 425, 430, 450, and 540 Ma.

The `Laurentia aCOB` source is valid at 410.1 Ma and older. It is not active at
410.001 or 410.099999 Ma. The correction therefore labels that fractional
interval as a **0.1 Ma seam-bridge inference from adjacent modeled extent**.
At exactly 410 Ma the native target is active and the correction is inactive.
At 410.001 Ma the native target is inactive and the correction is active.
Coverage changes by less than 0.00001 across the 410.1 Ma source boundary, so
no second visual discontinuity is introduced.

Material support is qualified for `(410, 430]` Ma. From 430 to 540 Ma the same
mask remains visible with explicit lower spatial confidence. Exposure remains
unknown throughout. Agreement with the model rotation circuit validates the
implemented pose; it is not independent evidence for undeformed geometry.

## Artifacts and verification

- `data/corrections/canada/manifest.json` records exact target identities,
  source lineage, source-scale geometry limits, endpoint semantics, pose
  witnesses, uncertainty, and rejection conditions.
- `data/corrections/canada/franklinian-material-v1.geojson` contains four
  compact 410 Ma frame features.
- `docs/research/regional-canada-franklinian-validation.json` records union,
  per-cohort, residual-domain, source-bound, pose, and 410.1 Ma boundary
  measurements.
- `scripts/research/regional_canada_compile.py` reproduces the assets from the
  pinned offline sources.
- `scripts/research/regional_canada_compile_test.py` checks regeneration,
  target/Pearya containment, geometry budgets, endpoint behavior, pose
  witnesses, and deliberate source-policy and aCOB-identity mutations.

The source-level suite passed seven Canada/Pearya tests on 2026-09-12. Common
catalog, runtime, browser, and production-performance results are recorded by
the shared regional-correction integration rather than claimed here.
