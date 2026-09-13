# Australian native Cao triangulation repair

**Research date:** 2026-09-13
**Status:** verified in the composed public package

## Source and meaning

The source is Cao et al. (2024) model v2.4, [Zenodo
13628813](https://doi.org/10.5281/zenodo.13628813), CC BY 4.0, retrieved
2026-09-09. The pinned `shapes_coasts.gpmlz` member has SHA-256
`c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f`.
These are model-derived coastline-class polygons in the Cao palaeomagnetic
frame, not observations of exposed land or topography. Each chart retains its
native plate ID, geometry-reference age and authored lifecycle; the repair
does not extend a lifecycle. Plate 626 has authored finite-rotation circuit
changes on the older side of 79.1 Ma and the younger side of 120 Ma; the
package marks
the open one-micro-Ma intervals from 79.1 to 79.100001 Ma and from
119.999999 to 120 Ma as unsupported rather than interpolating across either
discontinuity. The asymmetry follows the exact source circuit: the 79.1 Ma
jump lies on its older side, while the 120 Ma jump lies on its younger side.

## Reproduced failure

The released compiler triangulated serialized float32 directions in
JavaScript, then validated the resulting indices against the unquantized
Python source coordinates. It initially classified 12 parts as degenerate.
Consistent emitted-float32 validation restores nine directly and lets other
candidates reach the separate area and connectivity checks below; it does not
classify every raw source ring as valid. For Lachlan, Thomson and Arunta the
emitted minima are respectively `1.0359e-12`, `1.0170e-12` and
`1.0190e-12` steradians. Validation now uses the actual float32 directions and
keeps the stricter `1e-12` floor.

Five dense Australian rings then exposed a separate numerical issue.
Three.js Earcut's gnomonic planar union stays inside each source polygon and
differs by only `1.4e-12` to `8.5e-12` projected area, but
`pygplates.PolygonOnSphere.get_area()` differs from a stable edge fan by enough
to consume 1.33 to 2.50 times the existing tolerance. The compiler now sums
signed spherical triangles from a common interior direction for both the
native double boundary and emitted float32 boundary. It retains the raw
pyGPlates area as source provenance and retains the original tolerance
`max(1e-8, sourceArea * 1e-5)`.

An independent L'Huilier spherical-excess implementation agrees for the five
former residuals plus a normal accepted chart, a polar chart and a chart with
a hole. Native-to-emitted deviation consumes at most 5.38% of the unchanged
tolerance, and emitted triangles agree with that independent area at at most
1.22% of tolerance. Moving one native vertex by `0.01` rad changes the area by
`7.251e-7` steradians against a `5.048e-8` tolerance and is rejected.

## Bounded source-connectivity repair

Arunta `563:0` and Musgrave `564:0` contain the same four-vertex bow-tie in
opposite directions along their shared boundary. Their pinned float32 windows
have SHA-256 `3cd21f35edcfa1a9ae0dd326477180f39ac9c6040e0d13fd347f1b7ec9dc64ea`
and `7ce21d92659181f4a0a378038d9c0f6279b5e145e6558da9f82384d9f77d1af2`.
The compiler reverses the two middle vertices at ring-edge pairs `2601/2603`
and `1573/1575`. Applying the repair to both charts preserves their exact
reverse shared boundary; applying it to one would create a seam.

This derived connectivity repair preserves every source vertex, component and
hole. The two replacement edges are shorter than the crossed edges, the
sampled local boundary displacement is at most 0.510 km, and projected
symmetric difference against the source's even-odd make-valid interpretation
is at most 0.651 km². Native spherical-area deviation is at most 0.702 km² and
remains within the unchanged source-area guard. The emitted Arunta and
Musgrave meshes contain 2,660 and 3,268 triangles, have no outside triangle
centroids, and retain minimum triangle area above `1e-12` steradians.

## Isolated result and gates

The reproducible coast stage contains 2,936 supported parts, 102,211 source
vertices and 95,875 source triangles. All 13 formerly rejected Australian
source geometries are supported. The only remaining coast-stage rejections are
two unrelated European three-point parts for which Earcut emits no triangle.
The overlapping `1988:0` South Australia and `1989:0` Curnamona charts remain
separate native model identities and do not count as additional union area.
An independent recomposition found no missing area within the union of native
Australian source polygons. That union covers 99.6021% of the Natural Earth
1:50m Australia footprint; the remaining 30,653.891 km² is a disclosed
cross-source scale/boundary mismatch rather than a triangulation omission.

[`compile_cao_foundation_test.py`](../../scripts/research/compile_cao_foundation_test.py)
proves the float32/double precision discriminator and the hash-pinned 2-opt
guard. [`validate_cao_australia_triangulation.py`](../../scripts/research/validate_cao_australia_triangulation.py)
checks the 13-chart inventory, emitted topology, triangle floor, centroid
containment, stable area, duplicate-source semantics and the final rejection
inventory. Its deliberate unsupported-chart, missing-repair, old-crossing and
degenerate-index mutations all fail.

The final isolated stage is reproducible with:

```sh
PYTHONPATH=../EarthHistory-data/palaeomap-study/verification/svalbard-shapely \
  ../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python \
  scripts/research/compile_cao_foundation.py --layer coasts --out <stage>
PYTHONPATH=../EarthHistory-data/palaeomap-study/verification/svalbard-shapely \
  ../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python \
  scripts/research/validate_cao_australia_triangulation.py \
  --stage <stage> --self-test
```

Its final `coast-patches.json` is 4,047,592 bytes with SHA-256
`1d1a5ac13a3d6f5928643d0ce5378fc33d825e27005937f6291e2cc6496c123a`.
The direction payload is 1,226,604 bytes with SHA-256
`97d84e766e778f3c671f1265da07574fb41c846da4e4f8e51257de6c5bf1b536`;
the index payload is 1,150,500 bytes with SHA-256
`c3e116e08284d97d3ebae843b282a60fa9181fdd411992cf12a052474de54276`.
The maximum mesh-area residual is `6.7773e-10` steradians and the maximum
native-to-emitted stable-area deviation is `1.5737e-8` steradians. All emitted
triangle centroids are inside their emitted rings. Three raw-source
containment classifications disagree at float32 boundary precision, including
the repaired invalid-source Musgrave ring; that diagnostic remains recorded
and does not replace the emitted-geometry or native-area gates.

## Motion qualification and source seams

The recovered charts use plates 626, 801, 8011, 8023, 80101, 80102, 80103
and 80104. Reusing the released coarse clocks would misplace some same-plate
charts by as much as `0.00214751` rad (about 13.7 km on a 6,371 km sphere).
The repair therefore appends accurate clocks for those eight plates and
rebinds every existing core consumer on the seven already represented plates:
3 charts on 626, 158 on 801, 111 on 8011, 5 on 8023, 5 on 80101, 30 on
80102 and 2 on 80103, or 314 pre-existing charts. A repository-wide entry-ID
inventory found no affected anchor, point-of-interest or material-correction
consumer. Old palette entries and sample bytes remain as an exact prefix but
are no longer referenced by those charts.

The direct oracle checks every quarter Ma, every authored source knot and the
one-micro-Ma limits on both sides of every knot. Across all supported spans its
maximum angular residual is `4.951800442414981e-6` rad at 1609.75 Ma on plate
801, below the `1e-5` rad contract. The only source-circuit jumps above that
limit among all eight plates are plate 626 at 79.1 Ma (`5.740596343509808e-5`
rad on the older side) and 120 Ma (`4.496190200199604e-5` rad on the younger
side). Four plate-626 consumers therefore carry explicit open
`motionSupportGaps`; both endpoints remain supported, while ages strictly
inside either one-micro-Ma gap are unavailable.

The tracked source contract pins all 16 appended motion entries by plate,
interval, record count, sample-byte digest and interval-set digest. The public
validator re-derives every recovered chart's local geometry, rejects mixed
triangle ownership, checks the 329 total recovery-clock consumers, and
requires the exact two source-seam declarations without consulting scratch
source files. The optional source-bound run additionally regenerates the 15
meshes from the frozen compiler stage.

## Package integration review

The final composed staging package appends the 15 recovered charts while
preserving the prior land geometry and all prior core-chart metadata except the
314 authorized motion-binding changes and four charts' declared support gaps.
The prior motion-entry, motion-sample and source-interval prefixes remain
unchanged. The native addition alone changes the land batch by
33,550 vertices and 42,173 triangles, to 183,042 vertices and 255,290
triangles. A later exact-modern Panama addition accounts for the composed
stage's higher 183,333/255,562 counts; it is not part of this repair.

The appender adds 16 accurate motion entries with 21,642 records. It rebinds
314 existing charts on the seven affected plate IDs already present in the
released package, so restored and existing charts on the same plate do not
use visibly different motion approximations. Together with the 15 restored
charts, 329 charts consume the recovery entries. An independent direct check
at 62,112 quarter-Ma and source-knot±0.000001-Ma probes found a maximum angular
residual of `4.951801e-6` rad at 1609.75 Ma on plate 801, below the `1e-5`
contract.

Four plate-626 charts carry two declared open motion-support gaps. Ages
79.1 and 79.100001 Ma remain supported on their respective source branches,
while their strict interior is unsupported; the second pair is 119.999999 and
120 Ma. The corresponding source-branch jumps are `5.7405963e-5` and
`4.4961902e-5` rad. This preserves exact endpoint evidence and avoids a false
micro-interval interpolation across the authored Cao crossovers. Package-only
and source-bound validation pass on the composed staging package and the
byte-identical public package. The final public core is 6,110,352 bytes,
SHA-256 `78f95eb44752304c75df0ba57e0549f41d0899ac030583c29d2d35a37f11c34b`;
the land geometry is 6,733,436 bytes, SHA-256
`423626079128d5bb671f808acc44aa1d689067ec5290a41e6a029a5d53fcd443`.
All 1,183 Cao outputs declared by the outer data manifest match their public
byte counts and SHA-256 identities.
