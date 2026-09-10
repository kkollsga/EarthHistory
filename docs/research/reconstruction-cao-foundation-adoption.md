# Cao foundation adoption

Status: corrected foundation implementation and local acceptance complete, 2026-09-10.
The initial candidate omitted native land patches in North America and Amazonia;
its deployment was canceled before publication. The corrected candidate loads
both authored Cao rotation files, including younger-age parent ties in the file
named `1800_1000_rotfile.rot`.
Release candidate: 0.1.3. Remote publication is verified separately by the release
workflow; this record is not evidence of a deployment.

## Scope and evidence

The user selected native Cao 2024 v2.4 as the first foundation, deferring
additional geography datasets and calibrated terrain detail. Initial compiled
coverage is 0–540 Ma at 109 display checkpoints. The coordinate format declares
its age domain separately and permits the model's longer range; the initial
application package does not claim reconstructed coverage beyond 540 Ma.

The model comes from [Cao et al. (2024)](https://doi.org/10.1016/j.gsf.2024.101922)
and the [v2.4 data record](https://doi.org/10.5281/zenodo.13628813), under
CC BY 4.0. The archive was retrieved on 2026-09-09. Source hashes, geometry
classes, reference frame, preparation methods and detailed limitations are
recorded in the [compiler report](reconstruction-cao-foundation-compiler.md).

Native coast-class polygons are model geometry, rather than an independently
validated atlas of exposed land, shallow seas or crust type. The initial
physical elevation field is unknown and uses zero as its rendering placeholder.
A 400 m rendering offset separates planar land triangles from the ocean shell;
it is not source elevation and is not multiplied by vertical exaggeration.
This foundation does not provide calibrated mountain heights, bathymetry,
global seafloor ages or historical biome reconstructions.

Native boundary types, polarity and adjacent plate identities retain their
source meanings. Exact resolved topology gives instantaneous ownership; it
does not establish persistent ocean material, crust birth or seafloor age.
Boundary and ownership geometry is withheld at fractional ages unless a
correspondence has been qualified. Continental motion uses its independent
source-knot and adaptive motion clock, rather than interpolating only the
five-million-year display checkpoints. Local unsupported intervals do not
invalidate a feature's otherwise supported lifetime.

Country outlines are modern Natural Earth reference geometry bound offline
to Cao plate coordinates. They do not represent ancient political borders.
Ambiguous or unsupported fragments remain unavailable. Countries and model
geometry share the motion authority; country geometry is stored once.

## Accepted implementation

The full package is the application's sole source producer. Its 552 assets total
28,848,507 bytes and pass production validators, packed decoders and checksum
checks, including deliberate corruption cases. It has 2,921 model-geography
charts, 149,492 vertices and 213,117 triangles. Native boundary/ownership layers
exist at all 109 checkpoints. Countries contribute 10,018 supported segments;
2,027 segments (16.83%) are omitted after requiring endpoint and midpoint
ownership agreement and native fragment validity. All eight coordinate POIs now have native bindings, including Cairo fossil
forest. All 3,949 chart identities are unique. The complete rotation collection
restores all 149 triangulatable source patches previously omitted for missing
circuits, including the US Yavapai/Mazatzal and Amazon Rio Negro Juruena regions.
Seventeen source parts still fail the existing triangulation qualification; none
caused these large inland holes.

One shared motion palette and static land/country buffers replace per-period
geometry copies. A preparation owner supplies both GPU rendering and sparse
material/anchor queries. Static triangle ranges are computed once; chart-space
picking transforms a ray with the corresponding prepared inverse pose. Two
resident checkpoints and two unsettled loads are enforced, including canceled
fetchers that ignore abort. Active source bytes and total runtime reservations
are distinct ledgers. Released prepared states cannot resolve addresses.

GlobeView uses direct typed handoffs rather than a canvas MutationObserver.
Present and ancient maps use the same Three node renderer on WebGPU and forced
WebGL2. The old PALEOMAP/Cao conversion, modern-only inputs, terrain/regional/cube
workers and caches are removed. The removal deleted 345 superseded data assets
(47,620,861 bytes), plus their unused producers. Older chapters retain editorial
globe uniforms and published event context, without positional POI fallback.

## Verification

The corrected candidate passes `make gate`: 84 tests in 20 files, TypeScript,
adapter checks, production build and all 552 asset hashes. Five directly affected
browser cases pass: local loading, WebGL2 fallback, exact/fractional checkpoints,
POI zoom and material-tag disappearance/reacquisition. The earlier complete
12-case browser union remains applicable to the unchanged application code;
11 passed together and the corrected land-click test passed separately.

The new complete-rotation regression checks source-chart presence, triangle
coverage, plate bindings and material-coordinate poses against strict native
pyGPlates witnesses. Temporarily omitting Yavapai from its coverage input makes
the test command fail; restoring it passes. Independent actual-renderer rays
hit the previously missing US and Amazon regions at 0 Ma and their native poses
at 100 and 450 Ma. Corrected headed WebGPU captures show continuous land at the
reported locations, with no console errors, warnings or failed requests.
See the [complete-rotation witnesses](reconstruction-cao-complete-rotation-witnesses.json)
and [independent land-coverage verification](reconstruction-cao-land-coverage-validation.json).

Browser coverage includes exact/fractional source state, failed-checkpoint
withholding and recovery, out-of-domain states, native POI zoom, a material tag
through disappearance/reacquisition, layers, keyboard/modal access, mobile layout
and all chapter citations. An unsupported Jack Hills evidence locality has no
ancient locate action. Tagged focus retains camera distance when support returns.

WebGPU was independently inspected in headed Chrome on Apple Metal 3, using a
non-fallback adapter. Native geometry is visibly present at 0 and 450 Ma;
720 Ma shows the declared editorial icy globe. No console errors or warnings
were recorded. The full native surface uses one land, one country and one
boundary draw when all are enabled. Both backends use the same integer palette
bindings and mathematical kernel.

The first joined slice exposed binary-header/copy-ledger and backend-material
integration errors. Subsequent checks caught missing integer GPU bindings,
duplicate exported country charts, incomplete transitive-load accounting,
released-state access, failed-renderer lease retention and stale map/POI fallbacks.
These were fixed before the first acceptance pass. The subsequent user visual
review caught the incomplete rotation collection; it is now corrected and covered
by the explicit land/motion witnesses above. A spherical containment test also caught
antipodal complement selection. The corrected authored-side calculation passes
synthetic pole/date-line/hole controls and [24 exact native pyGPlates ownership
comparisons](reconstruction-topology-ownership-validation.json) at 0 and 450 Ma.
These spot checks do not establish exhaustive global topology correctness.

## Production measurements

The [measurement record](reconstruction-cao-foundation-performance.json) contains
three fresh-context runs per age, the stop rule, build hashes, Chrome version and
machine-state metadata. The historical and corrected series use the local production preview, forced
WebGL2 and a 1440 × 900 viewport. WebGPU functional observations made during other
tests are excluded from this performance comparison. The table below uses the
corrected two-file candidate, identified by nested manifest SHA
`305c237a7828b935fa7ee4f8f0e6504ae3990372950cc8e180719865bc90e1e9`;
the earlier incomplete candidate remains in the record only as a historical control.

| Measure | Previous 0 Ma | Cao 0 Ma | Previous 450 Ma | Cao 450 Ma |
| --- | ---: | ---: | ---: | ---: |
| Median readiness, ms | 797 | 408 | 1,115 | 402 |
| Frame p95, ms | 16.7–16.8 | 16.7–16.8 | 16.7–16.8 | 16.8 |
| Observed JS heap, MB | 60.24–60.44 | 49.95–50.87 | 56.23–68.80 | 46.39–46.55 |
| Renderer geometries | 113 | 16 | 113 | 16 |
| Renderer textures | 118 | 12 | 16 | 11 |
| Initial decoded data, MB | 1.53 | 18.51 | 1.08 | 18.36 |
| Initial transferred data, MB | 0.63 | 7.73 | 0.41 | 7.67 |

The complete site is 28.88 MiB versus 47.20 MiB previously. The foundation retains
11,075,544 bytes in its combined static CPU/GPU buffer ledger. Active source
assets are approximately 18.50 MB at 0 Ma and 18.34 MB at 450 Ma; publication
resources are 486,227 and 361,566 bytes respectively. Retired publication bytes
settle to zero. The old workers and caches are absent.

These local results show lower observed heap and readiness latency, while initial
network demand increases because the shared whole-domain geometry and motion
are loaded once. They are not a WAN-speed guarantee. JS heap excludes driver
memory and workers, serialized source ledgers are not heap measurements, and
frame cadence near display refresh is not a GPU execution-time measurement.

## Deferred detail

Calibrated relief and biome fields, published exposure/shallow-sea masks, persistent
ocean cohorts and seafloor ages, continuous boundary correspondence, adaptive
spatial LOD and native ages older than 540 Ma remain future work. Neutral surfaces are intentional; omitted geometry caused by incomplete source
ingestion is a defect, not a scientific coverage limitation. This foundation
does not yet reproduce the earlier satellite-style visual target.
