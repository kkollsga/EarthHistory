# Regional material corrections: final independent review

Reviewed 2026-09-12T17:35:00Z against Cao v2.4 correction catalog SHA-256
`17c377d61694e304d99c071b9afb8db836dc4a782102e105999001602c3b08d7`.
The review covers the seven regional operations, the two exact native-chart
replacements, their direct consumers, and the final static package. It does not
turn a material footprint into a palaeoshoreline, exposure map, or precise
terrane reconstruction.

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
the gray uncertainty batch has 11,196 / 12,738. With 149,492 native land
vertices, 213,117 native triangles, and 20,036 country vertices / 10,018 line
segments, the complete static resource is 188,574 vertices and 245,164
primitives across three spatial batches plus one line batch. This is below the
measured 190,000-vertex and 246,000-primitive package limits. The latter was
recorded before final performance measurement after the first expanded build
showed that 4,722 additional triangles were required to preserve the source
boundaries at the unchanged 400 m display shell.

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

## Independent checks

The final focused TypeScript run passed five files and 24 tests covering exact
override suppression, 0/0.001/1/410/410.001 lifecycles, stable line resources,
country-domain activation, saved-address remap, mutation rejection, uncertainty
batches/counters, package validation, native picking precedence, and regional
coverage. The correction mutation self-test passed, the offline source oracle
validated all five regional manifests, and the combined regional Python run
passed all 48 tests. `npm run typecheck` passed. The deterministic `make gate`
inside the final `make gate-full` run reported 24 files / 98 tests and all 555
application artifacts; all 13 Playwright tests and the final artifact check also
passed.

The first final `make gate-full` attempt preserved three browser failures before
stopping: the present-day support assertion expected
`native-cao-foundation` and received `cao-plus-model-pose-material`; the 450 Ma
label expected only the native checkpoint plus uncertain continuations and
received the checkpoint plus four qualified, eleven continuation, two
model-pose, and one formation-range charts; and the 410 Ma boundary expected
native-only with zero corrections and received
`cao-plus-formation-range-material` with 10 qualified, zero continuation, two
formation-range, and 10 model-pose charts. These were stale expectations from
the earlier additive-only package. The browser contract now checks those exact
replacement/phase counts and preserves the native-boundary assertions. Its
focused rerun passed all 13 tests.

The final headed Apple M4 comparison passed every written stop. At 411 Ma the
native control and correction candidate measured 389.5 ms and 434.4 ms median
ready time, a 44.9 ms or 11.53% increase. Both frame-time p50 medians were
16.7 ms, both forced-WebGL2 runs passed, all nine paired captures completed
without error, and the measured package contained 188,574 aggregate vertices
and 245,164 triangle/line primitives. Independent and root visual review found
the western false holes removed, modern 0 and 0.001 Ma coverage intact, Arctic
native coverage unchanged at 409 Ma, the intended regional additions visible
at 411 Ma, and the uncertain Novaya footprint visible in gray at 430.001 Ma.
The faint 0.001 Ma western water pattern also occurs in the matched native
control and is not a correction regression. No concrete defect remains in the
final candidate.

## Historical first-round checkpoint

An earlier three-region checkpoint covered only 41.130% of Canada, 3.691% of
Svalbard, and 1.311% of a small western plate-154 target. Its headed Apple M4
run measured 396.0 ms versus 416.9 ms median cold-ready time and equal 16.7 ms
frame-time p50, while a SwiftShader run failed its relative cold-ready stop.
Those measurements describe the smaller historical package and are not
performance evidence for this expanded seven-operation candidate.
