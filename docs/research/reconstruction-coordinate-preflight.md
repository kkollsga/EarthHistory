# Reconstruction coordinate preflight

Research result, 2026-09-10. This bounded numerical trial tests one part of the approved reconstruction-machinery program: whether model-qualified precompiled quaternion intervals can replace browser rotation-tree queries for selected rigid continental material. It does not validate geography, deformation, terrain, ocean lifecycles, or application performance.

## Frozen trial

The baseline and adaptive-extension policies were written before their respective executions at `../EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/coordinate/trial-policy.json`. The owned output cap is 8 MiB inside the existing 32 MiB program area and 4 GiB source-study bound. The policy and final regenerable result total less than 20 KiB.

Reference environment: Python 3.9.6, pyGPlates 1.0.0, Cao et al. 2024 v2.4 palaeomagnetic reconstruction, anchor plate 0. The pinned dataset is [Zenodo 10.5281/zenodo.13628813](https://doi.org/10.5281/zenodo.13628813), CC BY 4.0, retrieved 2026-09-09 in the existing acquisition ledger; this trial ran 2026-09-10. The exact runtime version string and rotation and continental-file digests are recorded in the summary and enforced by the runner. A caller-supplied model directory with different digests is rejected rather than silently described as Cao v2.4. The reusable runner is `scripts/research/coordinate_preflight.py`.

Controls were five 5-Myr intervals beginning at 0, 420, 450, 470, and 250 Ma. Each used the valid non-anchor continental feature with greatest endpoint rotation and tie break. This stresses interpolation but does not represent all continents. Fractions 0.125, 0.25, 0.5, 0.75, and 0.875 were queried; 0.25 and 0.75 were midpoint holdouts.

Three representations were compared:

1. spherical interpolation between the two exact 5-Myr endpoint total rotations;
2. piecewise spherical interpolation with an added exact 2.5-Myr pyGPlates calibration rotation;
3. direct pyGPlates total rotation at the requested age.

The 2.5-Myr value is a trial calibration sample. It is not claimed to be an authored source rotation knot or a preserved circuit event. Rotation error uses the stable sign-invariant quaternion metric `4 atan2(||q1-q2||, ||q1+q2||)`. The declared targets were `1e-10` radians for deterministic repeat agreement, `5e-7` radians for float32 storage contribution, and `1e-5` radians for interpolation. Numerical tolerances are separate from geological uncertainty.

## Results

| Interval Ma | Plate | Endpoint-only max rad | Added-midpoint max rad | Float32 storage max rad |
|---:|---:|---:|---:|---:|
| 0–5 | 69702 | 0.009140923 | 0.002286165 | 1.244e-8 |
| 420–425 | 601 | 0.007669492 | 0.001914997 | 2.805e-8 |
| 450–455 | 330 | 6.21e-16 | 5.98e-16 | 5.556e-8 |
| 470–475 | 330 | 4.48e-16 | 3.38e-16 | 5.953e-8 |
| 250–255 | 176 | 0.000652585 | 0.000162816 | 2.624e-8 |

All selected circuits resolved. Forward and reverse query orders produced identical compact results under the numerical tolerance. Float32 storage of the three stored quaternions stayed below its predeclared tolerance. Missing plate ID 999999 demonstrated the API trap: the default call returned an identity rotation, while `use_identity_for_missing_plate_ids=False` returned `None`. The research contract must always use the strict form and classify the latter as unsupported.

The deliberate numerical mutation replaced one compact endpoint quaternion with identity. The same interpolation check failed with a maximum error of 0.380958 radians, demonstrating that the numerical guard catches corrupted stored motion. A separate mutated rotation digest was also rejected by the model-identity check; both mutations were restored by construction.

Endpoint-only interpolation failed the angular target in three moving controls. Adding one exact midpoint reduced those errors by roughly fourfold but still failed at 0–5, 420–425, and 250–255 Ma. On an Earth-radius scale the largest midpoint-calibrated angular difference is roughly 14.6 km, far beyond the declared approximately 64 m numerical target. The two older plate-330 controls were effectively exact, showing that storage density should follow the actual circuit behavior rather than applying one conclusion to every interval.

The Python microtimings are retained in JSON but show no app speedup; native pyGPlates and pure-Python interpolation are not comparable runtime paths.

## Decision

The broad hypothesis remains feasible, but the tested baseline encoding is rejected: two display endpoints are insufficient, and one arbitrary midpoint is not an adequate substitute for preserved motion structure. The compiler must identify source rotation/circuit changes and event times, then emit bracket-local motion segments at their real cadence. If source knots alone do not meet the frozen angular target after composing a hierarchy, it may add deterministic oracle-qualified approximation samples; those samples must be labeled generated numerical controls rather than source events.

## Source-aware adaptive extension

A second policy retained endpoint times and source ROT times belonging to the selected moving plate inside each bracket, then recursively added exact pyGPlates midpoint training rotations until the unchanged `1e-5`-radian target, depth 10, or 256 stored samples. Stored rotations were quantized to float32 before lookup. Every accepted leaf was checked at local fractions 0.37 and 0.73, which were never training samples. Reverse and deterministically shuffled lookup orders and the identity-endpoint mutation exercised the compact evaluator.

| Interval Ma | Stored samples | Leaves | Max training rad | Max independent holdout rad | Result |
|---:|---:|---:|---:|---:|---|
| 0–5 | 38 | 37 | 1.1012e-5 | 1.2223e-5 | Rejected at depth cap |
| 420–425 | 33 | 32 | 7.4832e-6 | 6.9783e-6 | Passed |
| 450–455 | 2 | 1 | 4.1819e-8 | 4.3628e-8 | Passed |
| 470–475 | 2 | 1 | 2.5926e-8 | 2.8304e-8 | Passed |
| 250–255 | 17 | 16 | 2.5596e-6 | 2.3910e-6 | Passed numerically |

All random-order compact lookups were deterministic. Replacing an adaptive table endpoint with identity produced 0.553405 radians maximum error and failed the same numerical guard. The 0–5 case stopped at the declared depth cap with 38 samples because one locally curved leaf still exceeded the target; the sample cap was not reached. The run was not retried with a larger depth or relaxed tolerance.

This demonstrates a minimal precompiled lookup plus quaternion interpolation for four selected controls, and a bounded failure for the fifth. It does not yet provide a complete motion clock. The source-time scan covers records of the selected moving plate only; fixed-plate ancestors in the composed rotation circuit can have their own knots and changes. Adaptive oracle samples captured their combined effect where independent tests passed, but they do not identify or preserve those ancestor events. The next compiler step must traverse or otherwise export the full influencing circuit schedule. The 0–5 cap failure shows that blind adaptive midpoint sampling alone is not the final machinery.

### Bounded diagnosis of the 0–5 failure

The failed depth-10 leaf spans 2.998046875–3.0029296875 Ma, with its midpoint at 3.00048828125 Ma. The reconstruction tree at that midpoint places selected plate 69702 beneath plate 69701, followed by 697 and a longer chain to anchor 0. The pinned ROT file has an authored 3.0 Ma rotation knot for ancestor plate 69701 relative to plate 697 (line 5647), inside the failed leaf; the selected-plate-only time scan did not include it. The same chain was present at the independent 3.001611328125 Ma diagnostic point. This identifies the bounded failure as a missed influencing ancestor source knot, rather than unexplained smooth curvature.

The compact interpolator's near-collinear shortcut was not material to the result. At the failed midpoint, its error was `1.101183589460195e-5` radians; forcing the full trigonometric SLERP gave `1.1011835894639923e-5`, while the two interpolants differed by about `7.85e-17` radians. At the independent diagnostic point their difference was about `1.49e-12` radians. The compiler must therefore walk the active parent circuit and union influencing ancestor ROT times into each bracket before adaptive approximation. Rotation knots identify numerical schedule changes; they still do not by themselves prove topology or geological events.

### Corrected 0–5 compiler clock

A correction-only run supplied all 23 authored ROT times between 0 and 5 Ma, including the missed 3.0 Ma ancestor knot, then used the unchanged adaptive rules. It did not rerun the other controls. The corrected table resolved with 34 nodes and 33 leaves: maximum training error `6.8354e-6` radians and maximum of 66 independent holdouts `6.3735e-6`, both below `1e-5`. Random-order lookup was exact under the deterministic metric, and the identity-endpoint mutation failed at `0.553405` radians. At 24 unpacked bytes per node, this selected table is 816 bytes before indices and provenance.

This proves the conservative full-source clock fixes the observed case within the original caps. It is intentionally overinclusive: times from every ROT record are included, rather than only the active ancestor circuit. These times are not topology or geological events. A later compiler should derive the minimal influencing parent-circuit clock and must retain the same independent numerical check.

The trial represents an unpacked table node as a float64 age plus four float32 quaternion components, 24 bytes per node before indexing, alignment, provenance, or compression. These five selected cases are too small and deliberately biased to support a global size projection. If flattened composed tables grow too large, a bounded alternative is an offline-compiled parent-order palette program: interpolate relative rotations and compose one quaternion per active plate and requested age, while still avoiding per-vertex inverse reconstruction and partitioning. That trades small O(P) runtime math for less storage and requires its own later numerical and resource proof.

The browser-side rigid evaluator can remain small: verify package/frame/digests, choose the precompiled segment for the requested age, perform quaternion interpolation, apply it to the material-local direction, and return explicit inactive/unsupported states. It need not load a rotation tree or repartition continental material at runtime. The compact package still holds at most two display checkpoints; bracket-local motion/event records are bounded separately and do not become additional full scene states.

The 250–255 rotation circuit resolved, but that does not close the independently known topology-segment correspondence seam. Rotation validity cannot be promoted to topology or ocean-material continuity. The next bounded material trial must export actual circuit/event knots and validate addressed points and topology lineage; it must not rerun this endpoint/midpoint comparison unchanged or relax the failed target.

## Evidence status and limitations

This trial executed rigid total-rotation queries only. No ownership partition, deforming network, persistent ocean cohort, ridge lifecycle, boundary interpolation, shoreline conversion, height prediction, application build, or browser measurement was performed. The selected features passed source validity for their tested intervals, but this does not prove global material coverage. Agreement with pyGPlates validates numerical reproduction of the pinned model, not the geological truth of the reconstruction.

Machine-readable result: `reconstruction-coordinate-preflight.json`, promoted beside this report, and the identical regenerable trial result at `../EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/coordinate/summary.json`. Rotation angular error multiplied by Earth radius is only a surface-distance equivalent or upper bound; no tag, centroid, or reconstructed feature displacement was measured. Reproduction uses the pinned environment:

```sh
../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python scripts/research/coordinate_preflight.py
```
