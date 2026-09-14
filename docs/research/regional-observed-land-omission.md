# Global exact-present observed-land omission correction

Research, source-contract and package status: verified public integration,
2026-09-14. This is not a plate-model edit. It supersedes the single-region
south-west Arabian correction compiled earlier the same day; that region is now
one of thirteen features in one global workflow.

## Reproduced failure

Users reported that at present day "deep sea is plotted on what is actually
land" in Yemen and southern Saudi Arabia, and later named Angola, Niger and
Nigeria. At 0 Ma the compiled Cao v2.4 foundation leaves parts of observed
modern land with no chart in either the land or the shelf batch, so the opaque
ocean sphere is visible through the surface and reads as deep sea.

## Global present-day audit

Two independent measurements were run against the public package at 0 Ma.

**Raster audit.** A 0.25° sample grid over Natural Earth 1:50m land — 342,683
land samples — was tested against every supported chart's posed triangles in
`batch-land`, `batch-shelf` and the three correction batches. Before the repair
3,692 samples (1.08 %) had no land-class chart; 3,331 of those were still
covered by the continental-outline underlay and only 361 were bare ocean.

**Boolean audit.** Natural Earth 1:50m admin-0 land minus the union of the Cao
coast polygons that are active *and emitted as charts* at 0 Ma, minus the
existing exact-present corrections, split into connected components. 191
components of at least 500 km² remain, 1,082,232 km² in total. Both audits are
reproducible from `scripts/research/regional_observed_land_omission_compile.py`
and the scratch probes recorded with it.

Four mechanisms explain the whole inventory:

| Mechanism | Appearance | Example |
| --- | --- | --- |
| A Cao static partition with no counterpart in `shapes_coasts` or `shapes_continents` | bare ocean sphere | "Covered Tathlith" plate 503 (Yemen / Asir), the oceanic "Africa" plate 701 partition under the Niger delta |
| Cao's generalized coast boundary lies inland of the modern coastline, but the continental outline still covers it | model shelf class | most coastal fringes |
| A Cao coast polygon carries an interior ring where a large lake sits | model shelf class | Lake Erie inside Granite-Rhyolite, Lake Ladoga inside Baltica |
| Cross-source scale mismatch inside a partition that does have a coast counterpart | model shelf class | Lake Victoria, the Aral Sea, Lake Chad, Lake Baikal |

Only the first mechanism produces the reported "deep sea on land"; the other
three produce the model's own blue continental-outline underlay, which is
existing disclosed behaviour and is not restated as evidence here.

### The three reported countries

* **Nigeria — confirmed, mechanism 1.** 38,633 km² of Nigerian land (4.24 %)
  lies outside every emitted Cao coast chart, and 33,667 km² of it is bare
  ocean: the whole Niger delta, bounded 5.03–8.59 °E and 4.28–5.81 °N. Its
  owning present static partition is the oceanic "Africa" polygon on plate 701
  (source order 439), which has no coast or continent counterpart.
* **Angola — not a land-coverage gap.** Only 1,867 km² of Angola (0.15 %) is
  uncovered, in 22 components whose largest is 372 km², and every one of them is
  covered by the continental-outline underlay; none is bare ocean. What is
  visible at regional zoom is the packaged country-reference locator, which is
  built from Natural Earth **1:110m**: along the Angolan coast its vertices lie
  up to **31.7 km** from the 1:50m coastline, so the pink locator line is drawn
  out over the shelf. That is the already-disclosed locator generalization, not
  sea over land.
* **Niger — not a land-coverage gap.** Niger has one uncovered component,
  788 km², shelf-covered, on the Lake Chad shore. The large blue patch visible
  there is the Lake Chad basin as Cao's coastline models it; modern Lake Chad is
  far smaller, but the basin is mechanism 4 and is left to the model.

## Bounded source correction

The compiler keeps a component only when it is at least 1,000 km², is covered
by the continental-outline underlay over less than half its area, lies inside
exactly one present static partition, and that partition's plate already carries
a qualified 0 Ma palette binding. Polar and antimeridian components are rejected
because a planar WGS84 Boolean is not valid there. Every rejection records its
reason in the tracked manifest.

Thirteen features survive, 180,488 km², 18 components and 609 vertices:

| Owning Cao static partition | Plate | Source order | Area km² | Components | Vertices | Where |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Covered Tathlith | 503 | 0 | 88,631 | 1 | 53 | SAU, YEM |
| Africa | 701 | 439 | 40,812 | 4 | 207 | NGA, CMR, CMR, GNQ |
| Northwest Africa | 714 | 236 | 19,334 | 1 | 44 | SEN, MRT |
| Antarctica | 802 | 1409 | 6,609 | 1 | 98 | ATF (Kerguelen) |
| Northwest Africa | 714 | 230 | 5,107 | 3 | 46 | ESP (Canaries) |
| Farallon | 911 | 1246 | 4,607 | 1 | 31 | ECU (Galápagos) |
| Africa | 709 | 545 | 3,518 | 1 | 18 | YEM (Socotra) |
| Corsica/Sardinia | 306 | 150 | 3,265 | 1 | 17 | FRA |
| Seychelles | 704 | 1026 | 2,549 | 1 | 14 | FRA (Réunion) |
| Eastern Panama, Central America | 229 | 289 | 1,944 | 1 | 30 | COL |
| Seychelles | 704 | 1022 | 1,879 | 1 | 18 | MUS |
| Solomon Sea | 836 | 572 | 1,250 | 1 | 20 | PNG |
| Africa | 701 | 1035 | 1,017 | 1 | 13 | TZA (Zanzibar) |

Every emitted partition is mechanism 1: none has a coast or continent
counterpart, and the contract records that as a checked invariant. Measured
overlap with native present land, between pieces, and with the existing Iceland
and Panama corrections is 0.0 km² in all three cases.

87 components totalling 931,079 km² are deliberately rejected and recorded:

| Reason | Components | km² |
| --- | ---: | ---: |
| the Cao continental-outline underlay already covers it | 68 | 779,263 |
| the owning plate has no qualified 0 Ma palette binding | 15 | 87,204 |
| planar Boolean is not valid across the pole | 2 | 60,669 |
| no present static partition contains the component | 2 | 3,944 |

The second row is the only one that is a deferred repair rather than a decision.
It covers New Britain (plate 830, 36,006 km²), Hispaniola (plate 224,
13,216 km²), Hawai'i and the Californian and Baja coasts (plate 901,
about 24,000 km²), the South Island west coast (plate 983), South Georgia
(plate 8201) and Samoa (plate 982). Correcting them needs exact-[0,0] identity
palette entries appended for those plates — the mechanism the Panama correction
already used for plates 229, 230 and 911 — which changes the shared motion
palette and its dependent contracts, and is tracked separately.

The geometry is generalized observed modern land. It is valid at exact 0 Ma
only and makes no shallow-water, shelf, bathymetric, palaeoshoreline, or
historical-exposure claim. Cao static polygons supply present ownership and the
identity pose only; the geometry is never backdated. Every plate's 0 Ma rotation
is identity to within 1 × 10⁻¹² degrees and every feature reuses an existing
present palette binding, so the correction appends no motion entry, sample or
source interval. It alters no country reference chart.

## Sources and reproducibility

- Natural Earth, *Admin 0 – Countries*, 1:50m, version 5.1.1, public domain,
  WGS84, retrieved 2026-09-12. The pinned archive is 799,734 bytes with SHA-256
  `5fed433373581fa648920435f937d95f2d3c0200e067409c6478dcdf1b853139`.
  "Made with Natural Earth."
- Cao et al. (2024), model v2.4, Zenodo `doi:10.5281/zenodo.13628813`,
  CC BY 4.0, retrieved 2026-09-09, in the Cao palaeomagnetic absolute frame,
  anchor plate 0, at geometry reference age 0 Ma. Pinned members:
  `shapes_coasts.gpmlz` `c660bc07…`, `shapes_continents.gpmlz` `6e30de73…`,
  `static_polygons.gpmlz` `9b30d231…`, `1000_0_rotfile.rot` `e13c16ef…`.
  The contract additionally pins each owning partition's ordered source-geometry
  digest.

Run the external-source compiler with the pinned pyGPlates/Shapely environment.
Pyshp is a compiler-only dependency pinned to 2.3.1 and installed into an owned
scratch directory; it is not a runtime or clean-checkout dependency:

```sh
python3 -m pip install --no-deps --target <scratch>/pyshp pyshp==2.3.1
PYTHONPATH=<scratch>/pyshp:../EarthHistory-data/palaeomap-study/verification/svalbard-shapely \
  ../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python \
  scripts/research/regional_observed_land_omission_compile.py
python3 scripts/research/regional_observed_land_omission_correction.py --self-test --runtime
```

The compiler writes only the tracked correction input
(`data/corrections/observed-land-omission/`) and the validation record. It does
not mutate `public/data`; the public catalog is regenerated by
`scripts/research/emit_cao_material_corrections.py`.

## Package integration

The correction enters the existing regional material-correction channel as
thirteen charts in the `material-correction-observed` batch, whose members
render with the land appearance at the 800 m land display shell and yield visual
and picking precedence to native charts. It adds no core chart, no `batch-land`
vertex and no motion-palette record.

| Asset | Before | After |
| --- | ---: | ---: |
| `material-correction-observed` vertices / triangles | 502 / 536 | 1,217 / 1,307 |
| Correction catalog charts | 98 | 111 |
| Correction identities | 8 | 9 |
| Package totals (vertices / triangles) | 395,670 / 563,986 | 396,385 / 564,757 |

The public data payload grows by 42,963 bytes in total (catalog +18,372,
`observed.ehgb` +23,552, outer manifest +1,039); `dist` measures
49.26 MiB against the 50 MiB bound.

Regenerating the catalog also rewrites `qualified.ehgb` and `uncertain.ehgb`,
because their per-vertex chart indices all shift when the observed batch gains
charts ahead of them. Against what the **unmodified** emitter produces on this
machine that index shift is the only change; those two files also differ from
their previously committed bytes in 14 of 162,942 triangle indices, which is
pre-existing environment drift in the shared `triangulate_cao_rings.mjs` Earcut
path and was reproduced with the HEAD emitter on HEAD inputs (three 0.185.1,
Node v22.16.0).

Two tracked records pin the correction-catalog identity and were re-derived
rather than hand-edited: the Iceland motion oracle
(`regional-iceland-motion-validation.json`, regenerated by
`verify_iceland_motion.py` against the strict pyGPlates rotations, angular
residual unchanged) and the requested-age motion tile contract. The tiles
themselves stay byte-identical — 72 tiles, 5,710,232 payload bytes, 280,974
records, 11,056 entry descriptors — because every correction reuses an existing
palette entry; only the tile index's recorded source identity moved.

Two charts bind palette entries named for the Panama correction
(`panama-observed-land-plate-229-0` and the plate-911 entry). Those are plain
exact-[0,0] identity entries on the shared palette, and the validator checks the
entry's recorded plate rather than its name.

## Gates and mutation evidence

`regional_observed_land_omission_correction.py` runs from a clean checkout
against tracked inputs; `--runtime` also checks the generated public catalog, the
palette plate behind every binding, and the batch that owns each chart.
`--self-test --runtime` proves 22 deliberate mutations are rejected: backdating a
lifecycle past 0 Ma, relabelling the surface shallow marine, drifting any pinned
source or ordered-geometry digest, remapping a plate, widening the area
threshold, dropping the shelf-fraction or palette-binding rule, erasing the
omission witnesses, removing a rejection reason, dropping a feature, claiming a
bare partition has a coast counterpart, unbounding the corrected area, claiming
the country reference is repaired, drifting the tracked geometry, replacing the
tracked geometry with one that no longer covers a reported defect witness,
replacing it with one that swallows native Cao land, relabelling the GeoJSON
surface class, and three generated-catalog mutations.

The gate also fails on the pre-fix package: run with `--runtime --package`
pointed at a staging copy carrying the previous catalog and observed batch, it
reports that the chart set changed; the integrated package passes.

After integration the 0.25° raster audit finds the ocean-visible gap reduced
from 252,071 km² in 118 clusters to 158,687 km² in 105 clusters, with every
remaining cluster on a plate that has no qualified 0 Ma palette binding.

The exact coverage, rejection, witness and asset identities are in
[`regional-observed-land-omission-validation.json`](regional-observed-land-omission-validation.json).
