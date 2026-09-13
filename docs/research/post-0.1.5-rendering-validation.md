# Post-0.1.5 rendering and geography validation

Status: accepted renderer, scientific-package, browser, visual, and paired
production validation completed on 2026-09-13.

## Scope and result

This follow-up addresses four findings reported against 0.1.5: the globe could
become broadly dark after orbiting toward Australia; valid Australian and
Oceania land contained large blue voids; the modern Panama land connection was
missing; and the modern-country reference overlay was incomplete or difficult
to read. The reported Canadian Arctic area at 74 Ma already had five active Cao
continental-outline shelf charts. Correcting the renderer made that existing
teal shelf context visible without adding unsupported geometry.

The reconstructed-surface material supplied its radial direction as a local
mesh vector even though Three.js consumes a custom NodeMaterial normal in view
space. The renderer now transforms that direction into view space before
lighting. The inspection light follows the normalized camera direction, so the
visible hemisphere retains camera-relative inspection lighting through an
orbit. This is a display light, not a reconstruction of historical sunlight.

The native Cao compiler now validates the coordinates it actually serializes,
uses stable spherical-area comparisons, and applies one hash-pinned paired
connectivity repair to the Arunta and Musgrave bow-tie rings. It recovers all
13 previously rejected Australian source geometries without extending their
source lifecycles. The source validation and numerical limits are recorded in
[Australian native Cao triangulation repair](regional-australia-native-triangulation.md).

At exactly 0 Ma, five source-partitioned observed-land charts complete the
Panama isthmus without duplicating retained native land. They are absent at
every age greater than zero. The exact-present modern-country overlay adds the
2,031 Natural Earth source subdivisions that were absent from the serialized
package, grouped into 149 country charts. It retains 571 reverse-oriented
shared-border pairs because the source records the boundary once for each
country identity. Historical country charts and their support limits are
unchanged. Line geometry remains subdivided to at most one degree and its shell
already clears land by about 637 m; a lighter slate stroke improves readability
without bridging unsupported historical fragments.

Four plate-626 consumers declare two strict-interior source seams,
`(79.1, 79.100001)` Ma and `(119.999999, 120)` Ma. The charts are withheld only
inside those one-micro-Ma gaps and resolve from their authored motion bindings
at both endpoints. The runtime neither interpolates across the discontinuities
nor retains a stale pose.

## Package and application validation

The final `make gate-full` invocation passed:

- all clean-checkout scientific and package validators, including the
  Australia, Panama, exact-present country, singleton-palette, and declared-gap
  mutation checks;
- TypeScript and 31 unit/data files containing 129 tests;
- the production build and all 1,187 artifact declarations at 43.70 MiB,
  below the 50 MiB limit;
- all 24 browser cases in 8.3 minutes, including automatic WebGPU and forced
  WebGL2 orbit-light witnesses.

The first final-gate attempt found a test-only 400,000-vertex fixture limit
after the validated package grew to 419,760 aggregate vertices. The production
renderer already used the required 450,000-vertex reservation. Updating only
the stale fixture made the focused 21-case renderer/runtime set and the full
restored gate pass. The failed and restored logs remain in the bounded scratch
set as `final-gate-full.log` and `final-gate-full-restored.log`.

The rendered lighting regression performs the same two pointer-orbit gestures
and samples broad mainland and ocean witnesses. It passed in automatic WebGPU
and forced WebGL2. Restoring the old untransformed normal made the WebGPU land
witness fall to luminance 57.21 against the deliberately broad minimum 105,
which proves that the browser case detects the original receiver-space defect.

The final display inventory is 395,670 spatial vertices and 563,986 triangles,
plus 24,090 country-reference vertices and 12,045 line segments: 419,760
vertices and 576,031 primitives in total. Picking at 135°E, 30°S selected native
Cao chart 4830, triangle 226876, while the lock remained centered at camera
distance 1.82 Earth radii.

## Visual review

Nine production WebGPU captures were reviewed with ready status, no page or
console errors, camera/light dot product 1, and the same final inventory:

| Capture | Age and camera | What it checks |
| --- | --- | --- |
| `australia-0-regional-lock.png` | 0 Ma, 135°E 30°S, distance 1.82 | Solid native Australia, picking and centered lock |
| `australia-0-regional-no-borders.png` | Same regional camera | Land coverage isolated from country lines |
| `australia-0-global-pointer-orbit.png` | 0 Ma, actual pointer orbit, distance 3.6808 | Viewer-facing light after free orbit |
| `australia-74-regional.png` | 74 Ma, regional distance 1.8201 | Historical Australian rendering |
| `australia-411-global-pointer-orbit.png` | 411 Ma, actual pointer orbit, distance 3.6808 | Deep-time light and receiver normals |
| `arctic-74-regional.png` | 74 Ma, 60°W 82°N, distance 1.8201 | Existing Canadian Arctic shelf visibility |
| `panama-0-regional.png` | 0 Ma, 80.5°W 8.7°N, distance 1.82 | Exact-present observed Panama connection |
| `hokkaido-0-regional.png` | 0 Ma, 142°E 43°N, distance 1.82 | Recovered regional source geometry control |
| `antarctica-0-polar.png` | 0 Ma, 0° 85°S, distance 1.8201 | Polar regional control and line readability |

The reviewed captures and their SHA-256-bound diagnostic ledger are retained
under `/tmp/earthhistory-post015-fixes/ui/final-captures/`; the ledger SHA-256
is `aa71a2bcb77b9614b886930821547a08f2937401abf7ee2abc13ee807b1d0a2b`.
Hokkaido and Antarctica are regional views at distance 1.82, not global views.

## Paired production performance

The immutable released 0.1.5 distribution at commit
`b6412c8cf6204f6d701ae8b4b937825ed69a7df4` was compared with the final
candidate on the same Apple M4 host in headed Chrome 152 / WebGPU. Its archived
Pages artifact has SHA-256
`32128bd274305bf5132549ac117a6805204f12eb76e805c75dd750b16636eacd`.
The earlier published-0.1.4 comparison remains in
[Post-0.1.4 interface validation](post-0.1.4-interface-validation.md); its
numbers are historical and are not mixed into this comparison.

The tracked comparator
`scripts/research/compare_production_performance.mjs` has SHA-256
`fb6e4c441c7ca2c34f6122a02d5c195544596e607dfec84352b700780d2d157c`.
Five alternating baseline/candidate pairs covered fixed 0 Ma and 411 Ma views
and a two-second continuous 410–412 Ma scrub. All 20 fixed rows and 10 scrub
rows were finite, visible, focused, WebGPU, error-free, and resolved to the same
plate-403 Greenland material address. Cameras matched exactly, with zero
longitude, latitude, or distance spread. Candidate geometry and inventory
remained stable through every scrub sample.

| Measure | Released 0.1.5 | Final candidate | Candidate/control |
| --- | ---: | ---: | ---: |
| 0 Ma median cold ready | 323.2 ms | 334.8 ms | +11.6 ms |
| 0 Ma settled cadence | 59.979 fps | 59.970 fps | 99.985% |
| 411 Ma median cold ready | 323.2 ms | 333.3 ms | +10.1 ms |
| 411 Ma settled cadence | 59.961 fps | 59.976 fps | 100.025% |
| Continuous 410–412 Ma cadence | 54.130 fps | 52.492 fps | 96.974% |
| Continuous scrub frame-time p50 | — | 16.7 ms | pass |

The predeclared rules reject added median cold-ready time above the greater of
250 ms or 20% of control, cadence below 90% of control, candidate p50 above
33.33 ms, invalid backend/visibility/focus/lock/framing state, incomplete five
pair sampling, or candidate geometry/inventory churn. The final run passed all
rules. A first post-0.1.5 invocation served `/EarthHistory/assets/` as HTML from
an incorrect preview root; the canvas did not initialize and the run stopped
with zero samples. The restored measurement used verified, byte-identical
subpath roots. The compact durable record, including every fixed and scrub row,
control state, artifact identity, stop rule and median, is
[post-0.1.5-rendering-performance.json](post-0.1.5-rendering-performance.json),
SHA-256 `b551d303f11846f468e5fb215144c74ba8b3177cf364ebb4a6ff3e798f5b101f`.

## Frozen identities and limits

- outer data manifest:
  `194ca507542d46b50c66c7b5b9acc9aa34bf933f53bcb54804d87c8aad76a982`;
- Cao package manifest:
  `5d879a6f4facbc1023aaba6244d5d913947486a015aa3a8e3093dfd64d7f8640`;
- core:
  `78f95eb44752304c75df0ba57e0549f41d0899ac030583c29d2d35a37f11c34b`;
- land batch:
  `423626079128d5bb671f808acc44aa1d689067ec5290a41e6a029a5d53fcd443`;
- shelf batch:
  `2f0d65b1cadd33cd0cede876fe4d70bacaea3d5659f12c0c68ac6905913b0077`;
- country-reference batch:
  `8cc0fcdf14fe775e8695a36336dd6d4872c6d2fade43b8ac7a79e9025039fd7a`;
- motion-palette JSON / binary:
  `88ce5edcd0c224685b14120a1e3d7f436966985d5fb134d6f08cbc59ec985b0a` /
  `1b54a2b8c08bad838035195deb12a23c488796ea13649344b3c2eb3e24a4d830`;
- material-correction catalog:
  `881c97d360100bec7f9f524bcdeb0627546673ce1a52d17d4424ab8acace6f41`.

The exact-present Panama land and country-reference additions make no claim
about historical borders or land exposure. Country fragments without source
motion remain absent at older ages. Cao shelf polygons are continental-outline
context; ancient water depth is unknown. The two plate-626 micro-intervals are
withheld because the pinned source rotation circuit is discontinuous there.
The Australia repair restores source model geometry and does not add observed
topography or modern coastline precision.
