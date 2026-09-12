# Regional material corrections: integrated release review

Reviewed 2026-09-12T18:55:09Z as the integrated EarthHistory v0.1.4 release
candidate against Cao v2.4 correction catalog SHA-256 `a173bdaa3336564ffcd820f78090bbf11a74c2fce1dcda0986ebb176a1459023`.
The review covers the seven regional operations, the two exact native-chart
replacements, their direct consumers, and the final static package. It does not
turn a material footprint into a palaeoshoreline, exposure map, or precise
terrane reconstruction.

## Full-domain baseline rebase

The correction catalog remains qualified only over 0–540 Ma while the native
layered Cao package now spans 0–1800 Ma. All 90 tracked coastline targets retain
their source feature, plate, lifecycle, and staged-geometry hashes. The native
land binary retains its 149,492 vertices and 213,117 triangles byte for byte;
the shelf batch is a separate native continental-outline layer. The full
topology aggregate is
`3a3021b8d60bbcff64ce4018198a5693ddc018de7a5a8b3c30c33a48d51c044c`;
the target catalog records its five-file union and constituent SHA-256 values.

The upstream core mislabeled all 2,921 coastline charts as continental-outline
evidence. The corrected core SHA-256 is
`cf5e863f16bd80169aff097d39016a8de7a2e579277038d37e4dc35f5cdb2223`.
An exact structural diff changes only each coastline chart's evidence
limitation and surface-evidence reason; geometry assets, chart identity,
lifecycles, bindings, batches, and checkpoints are unchanged.

The full-domain palette also exposed a sparse-interpolation defect at
fractional ages, including 402.5 Ma. Twenty-four affected native entries retain
their IDs, intervals, and every old sample value while gaining 22,708 exact
source-derived intermediate samples (454,160 bytes). Nine dedicated correction
entries add 404 samples over 410–540 Ma, with no nearest-entry holding. The
resulting palette catalog and binary SHA-256 values are
`aeb8daefa5b7c95afbfb755ebb8e9f33873454dafbec62943c99512d1c0f7217` and
`e4eb223ef765b62ea19fc65ff50f532a127f837699f626ec6c910c52cfac94ed`.
Against the unchanged pinned rotation aggregate
`80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f`,
0.025 Ma probes across every refined span peak at 0.000003366 rad and all
tracked-target and correction checks—including 402.5, 409, 410, 410.001,
430, 430.001, 505±0.000001, and 540 Ma—peak at 0.000009339 rad, below the
existing 0.00001 rad limit. The machine-readable
`cao-correction-baseline-rebase-proof.json` and
`cao-correction-motion-oracle.json` preserve the exact deltas and samples.

## Regional result and remaining evidence gaps

| Region | Final supported footprint | Comparison footprint | Support indicator | Explicit residual |
| --- | ---: | ---: | ---: | ---: |
| Northern Canada, 44 Cao targets | 203,260.83 km² spherical union | 238,833.48 km² spherical target union | 85.106% | 35,572.65 km² |
| Pearya, three Cao targets | 29,284.16 km² | 42,371.98 km² | 69.112% | 13,087.82 km² |
| Svalbard, eleven target parts | 51,667.25 km² | 58,351.57 km² summed target-part scale | 88.545% | 6,684.32 km² |
| Barents, three regional cohorts | 360,863.40 km² | 474,306.92 km² forty-target summed scale | 76.082% | 113,443.52 km² |
| Combined Barents and Svalbard masks | 412,530.65 km² | 474,306.92 km² forty-target summed scale | 86.975% | 61,776.27 km² |

The Svalbard and Barents ratios compare an equal-area delivered union with
summed spherical target-part areas. They are scale indicators rather than exact
set fractions. The Canada diagnostic independently computes spherical unions;
its per-cohort area ratio is 85.782% because overlapping target cohorts are
counted separately. The tracked regional validation files retain both measures.

Canada combines mapped ancient units with younger-cover substrate inference
from Geological Map of the Arctic Map 2159A. It is clipped to the exact Cao
target union, excludes Pearya, remains inactive at exact 410 Ma, is
source-qualified over `(410, 430]`, and is uncertain through 540 Ma. The
Laurentia aCOB ends at 410.1 Ma, so its 0.1 Ma contribution is recorded as a
seam-bridge inference rather than continuous active source geometry.

Pearya remains two separate features. The plate-124 pericratonic scenario
covers 28.826% of the target and changes from qualified to uncertain after
416 Ma. A non-overlapping mapped Laurentian-affinity fragment on plate 101
covers another 40.286% and changes after 430 Ma. Their combined 69.112% is not
a single Pearya-affinity claim. Mapped unrelated domains remove 3,565.29 km²
from the interpolation. The Cao `Pearya South` closed continental boundary on
plate 121, UUID `GPlates-00a1a140-c24e-4489-b515-59cc7e389e63`, has zero
intersection with the three plate-124 targets and is rejected for this repair.

Svalbard now includes source-bounded East and West masks while keeping their
plate identities separate. The 76.082% Barents subtotal excludes Svalbard;
together they reach 86.975% of the same forty-target scale. Barents includes
9,315.88 km² Franz Josef Land,
69,178.75 km² Novaya Zemlya, and 282,368.77 km² Timan/western Urals. The Timan
extension is limited to mapped western Ural continental passive-margin and
Precambrian units; eastern Ural oceanic domains and West Siberia remain
separate. Native precedence resolves valid overlap without treating the masks
as additional continents.

## Western native replacements

The separately additive plate-154 correction now supplies 436,858.23 km² at
411 Ma, or 65.830% of its 663,613.79 km² target. Its 226,755.57 km² same-plate
remainder stays explicit because the available aCOB/basement evidence does not
qualify it. The smaller plate-1731 additive old-material feature supplies
22,464.06 km² at 411 Ma while the source-490 replacement below handles the
modern target's time-qualified material domains.

The source-450 chart is a modern California basement mosaic despite its `East
Klamath` label. USGS DS898 maps 90.931% of its target to post-410 crust and only
9.068% to old Mojave/Salinia material; the independently mapped Eastern
Klamath/Ordovician Trinity footprint has zero target overlap. At 410 Ma the
replacement therefore shows 14,445.82 km², or 9.068%, while at 0, 0.001, and
1 Ma its domain fragments restore more than 99.999% of the modern target.
Mojave and Salinia use the Cao plate-176 pose only as an explicit model
inference.

The source-490 replacement similarly gates mapped juvenile and oceanic domains
by source age. It shows 48,642.34 km², or 10.666%, at 410 Ma and restores more
than 99.998% at 0 Ma. Coast plutonic complex, Methow, Harrison, and the mapped
remainder preserve the native 0–410 lifecycle with unknown substrate age;
their plutonic, cover, or stratigraphic ages are not treated as basement birth.
At 410.001 Ma only 27,431.94 km² remains supported. The 21,210.40 km² difference
from exact 410 is an explicit older-age evidence residual: those unknown-age
native fragments are withheld rather than silently promoted to pre-410 crust.
Six float32-untriangulatable overlay slivers smaller than 100 m² are omitted;
their 0.000144287 km² symmetric difference is below the declared 0.001 km²
present-union tolerance.

That 0.001 km² gate applies to omission from the admitted source mask before
rendering. It is distinct from the planar-triangle approximation of spherical
boundaries. An independent projection of the final rendered triangles against
the admitted replacement features measured 0.064689 km² missing and 0.109695
km² extra for source 450, and 0.270050 km² missing and 0.912022 km² extra for
source 490. These sub-kilometre rendering differences are reported separately;
they do not admit another source domain or change a domain lifecycle.

Both original native charts are suppressed only over `[0, 410]`. At 410.001 Ma
they resume their original inactive/unborn state while separately qualified old
features continue according to their own lifecycles. Exact target geometry,
plate, chart identity, and replacement asset hashes are bound in the catalog;
mutations of source-450 plate 176 to plate 1731, either target geometry hash,
country-consumer ownership, or an anchor on an overridden chart fail the
tracked validators or loader.

## Modern-country segment contract

Natural Earth 1:110m country lines are subdivided to at most one degree and
bound by endpoint and midpoint to Cao static polygons. They are not digitized
from the land triangles. Exact triangle containment therefore removed 19 of 20
affected modern segments. The final contract samples each affected segment at
no more than 0.1° and binds it offline to the nearest source domains within a
12 km cohort-specific corridor. The limit is a map/generalization tolerance,
not geological positional accuracy. Runtime indices are stable through age
scrubbing; a segment is active only when every preselected nearest domain is
active and all candidates use the native target motion.

An independent WGS84-geodesic audit measured distances in a local WGS84
azimuthal-equidistant projection for each segment. Small differences from the
emitter values below reflect ellipsoidal versus spherical distance methods and
remain under 0.03 km.

| Source | EHGL segments | Emitted maximum distances (km) | Independent AEQD maximum distances (km) | Nearest source domains |
| --- | --- | --- | --- | --- |
| 450 | 1011–1015 | 3.461754, 1.793548, 4.435383, 7.874609, 10.274057 | 3.488926, 1.806521, 4.463265, 7.892744, 10.298783 | Franciscan for every sample |
| 490 | 106, 372, 823 | 4.223140, 1.600471, 1.600471 | 4.235466, 1.608649, 1.608649 | Wrangellia; Bridge River/CPC/Shuksan/Wrangellia crossings |
| 490 | 1016–1022 | 1.498124, 1.398417, 1.002536, 1.825623, 4.225220, 3.214266, 0 | 1.509889, 1.399933, 1.003831, 1.827717, 4.225731, 3.224183, 0 | Franciscan, Siletzia, Cascadia crossings |
| 490 | 1024–1028 | 3.167452, 2.736144, 0.755002, 9.956769, 10.665209 | 3.162161, 2.737902, 0.752988, 9.966335, 10.664461 | Siletzia, Franciscan, Wrangellia crossings |

The nearest identities are selected before age filtering. This matters at
410 Ma: all five source-450 segments are nearest Franciscan, which is unborn,
so they are withheld. They cannot jump to old, active Salinia elsewhere within
the 12 km corridor. At 0, 0.001, and 1 Ma all 20 segments are supported. Tests
also show identical country-segment indices and static resource identity over
the `0 → 410 → 0` scrub.

Saved material addresses use a separate consumer path. Interior witnesses in
both exact native targets resolve at 0 Ma to one supported replacement chart,
retain the reference direction, and use a pose identical to the suppressed
native partition. No shipped anchor refers to either overridden chart.

## Rendering, picking, and package bounds

All source-qualified replacement fragments whose pose is `model-inference` or
`native-target-only` render in the gray uncertainty batch. The
`modelInferredPoseActiveCharts` counter includes only active
`source-qualified-material` charts, so simultaneous formation-range charts do
not inflate it. The application legend calls gray footprints
source-supported material with uncertain partition pose and unknown exposure.
Older continuations and formation-range scenarios retain their separate gray
wording.

Correction geometry renders beneath native geometry at the same 400 m shell,
with native visual and picking precedence in overlaps. Picking compares the
hit distance with the first opaque-globe intersection. Its near-limb regression
uses a ray for which both sphere intersections have positive camera dot
products and confirms that an occluded native triangle cannot defeat a visible
front correction merely because both are on the broad camera-facing
hemisphere.

The catalog contains seven operations, 84 charts, two overrides, and six pose
alignment witnesses. Its qualified batch has 7,850 vertices / 9,291 triangles;
the gray uncertainty batch has 11,196 / 12,738. The layered native package has
153,904 shelf vertices / 251,187 triangles and 149,492 land vertices / 213,117
triangles. With corrections it contains 322,442 spatial vertices and 486,333
triangles. The upstream country-reference core contributes 20,028 vertices /
10,014 segments, for 342,470 aggregate vertices and 496,347 triangle/line
primitives. The earlier correction checkpoint contained 20,036 / 10,018; the
8-vertex / 4-segment difference is already present in `origin/main` and is not
loss from correction remapping.

The first expanded build left 559 of 17,307 correction triangles below the
opaque globe because ear-clipping diagonals reached 10.9304°. The emitter now
conformingly bisects all correction-mesh edges to at most one degree, checks
the exact closest point of every triangle after float32 encoding, and rejects
any displayed radius at or below the ocean sphere. The emitted maximum edges
are 0.996656° (qualified) and 0.999583° (gray); minimum displayed radii are
1.000023950 and 1.000023129, respectively. An independent audit found zero of
22,029 correction triangles submerged and a minimum clearance of 147.356 m.
An inward-vertex mutation proves that the regression rejects a submerged
triangle, and each refinement round preflights the existing 8 MiB binary bound.
The independent native control has zero of 213,117 triangles submerged, a
0.999991° maximum edge, and 94.978 m minimum clearance, establishing the same
one-degree tessellation as an existing production precedent.

The western visual failure was reproduced at source-490 Franciscan chart 4000,
whose old mesh reached a 3.27355° edge and 2,199.61 m maximum penetration.
Triangles at the visible central and lower void witnesses near
`(-120.3826, 48.0323)`, `(-121.3951, 46.3192)`, and
`(-121.5883, 46.0241)` lay 242.9 m, 1,353.1 m, and 1,037.8 m below the ocean.
The final paired 0, 0.001, and 411 Ma captures show continuous correction
surfaces at all three positions. Their matched native panels establish that
the rejected voids came from correction-triangle occlusion rather than source
or native geometry gaps.

## Integrated release acceptance

The first integrated `make gate-full` attempt reached the browser phase and
passed 15 of 17 cases. It remains a failed run: one case exposed a real race in
which a delayed exact-checkpoint failure could withhold a newer successful
motion frame, while the other still treated 720 Ma as unsupported after the Cao
package domain expanded to 1800 Ma. The repaired runtime records the requested
age with each prepare failure, ignores stale failures after a newer retarget,
withholds stale exact overlays, anchors and picking during an active failure,
and refreshes source-linked markers on every continuous motion frame. The
domain test now uses 2200 Ma.

The focused recovery and continuous-motion set passed 5/5, and the synchronized
delayed-failure regression passed 1/1. Removing the latest-age guard reproduced
the stuck `waiting` state, proving the regression can fail; the guard was then
restored. The final deterministic `make gate` passed 30 files / 118 tests, the
production build, all 1,186 artifacts, and the 40.37 MiB distribution. Workflow
lint with `actionlint .github/workflows/pages.yml` also passed. The release gate
history therefore retains the 15/17 full-gate failure and uses the focused
recovery plus final deterministic gate as the post-fix evidence; it does not
claim a second blanket full-gate pass.

The frozen production artifact was then compared on Apple M4 Metal with the
exact upstream native-data manifest, core, and motion-palette bytes pinned at
commit `6af9bd9ca7836adb58eb658d37b2f7743b9de68c`. Both sides used the same final
frontend renderer, so this controls the integrated data addition rather than
claiming comparison with previously deployed JavaScript. At 411 Ma, native
control and candidate median ready times were 562.7 ms and 586.0 ms: a 23.3 ms
or 4.14% increase, within the prospective `max(250 ms, 20%)` stop. Stationary,
409.01–410.99 Ma seam-scrub, 0.001–1 Ma modern-scrub, and forced-WebGL2 seam
p50 values were all 16.7 ms. Every requested scrub age was evaluated in the
same document with at most `2.85e-13` Ma error and one unchanged static geometry
identity.

The candidate measured 322,442 spatial vertices / 486,333 triangles and 20,028
country vertices / 10,014 unique segments: 342,470 aggregate vertices, 496,347
unique primitives, and 506,361 drawn triangle/line primitives when the country
underlay and stroke are counted separately. It used four spatial plus one
country storage batches and six base draw passes. Candidate active source bytes
at 411 Ma exceeded the pinned native control by 1,265,469 bytes. The native
0/410/411 anchors, candidate 540/1000/1800 domain probes, correction inactivity
beyond 540 Ma, automatic WebGPU path, and two forced-WebGL2 runs all passed.

All nine same-age, same-camera pairs completed without console errors. The
release coordinator accepted each visual: the modern 0/0.001 Ma western
replacement remains continuous without false holes; the 0.001 Ma pale-ocean
pattern also occurs in the native control; the uncertain Novaya continuation is
visible at 430.001 Ma; Arctic native coverage is preserved at 409 Ma; and the
411 Ma additions and western replacements are intended. Image hashes, compact
diagnostics, stop results, machine metadata, and the tracked bounded harness
are retained in `regional-material-corrections-performance.json`. No concrete
defect remains in the integrated release candidate.

## Pre-rebase complete-regional checkpoint

Before the full-domain native rebase, the focused TypeScript run passed five
files and 24 tests covering exact override suppression, 0/0.001/1/410/410.001
lifecycles, stable line resources, country-domain activation, saved-address
remap, mutation rejection, uncertainty batches/counters, package validation,
native picking precedence, and regional coverage. The correction mutation
self-test passed, the offline source oracle validated all five regional
manifests, and the combined regional Python run passed all 48 tests. That
checkpoint's `make gate-full` reported 24 files / 98 tests, all 555 application
artifacts, 13/13 Playwright cases, and a passing final artifact check.

The checkpoint's first full-gate attempt preserved three browser failures:
stale expectations for present-day model-pose support, 450 Ma regional
phase-counts, and the exact 410 Ma replacement boundary. Its corrected focused
rerun passed 13/13. The headed Apple M4 comparison then measured 389.5 ms versus
434.4 ms median ready time, equal 16.7 ms frame-time p50, two passing forced
WebGL2 runs, nine accepted image pairs, 188,574 aggregate vertices, and 245,164
triangle/line primitives. Those numbers and image hashes remain historical
evidence for the pre-rebase package; they are not the final v0.1.4 acceptance.

## Historical first-round checkpoint

An earlier three-region checkpoint covered only 41.130% of Canada, 3.691% of
Svalbard, and 1.311% of a small western plate-154 target. Its headed Apple M4
run measured 396.0 ms versus 416.9 ms median cold-ready time and equal 16.7 ms
frame-time p50, while a SwiftShader run failed its relative cold-ready stop.
Those measurements describe the smaller historical package and are not
performance evidence for this expanded seven-operation candidate.
