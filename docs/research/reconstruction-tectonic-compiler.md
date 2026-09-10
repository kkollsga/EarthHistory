# Bounded Cao tectonic-control compiler

**Research date:** 2026-09-10
**Status:** seven-age offline diagnostic complete; not a production package or global 0–540 Ma claim.

[`compile_tectonic_controls.py`](../../scripts/research/compile_tectonic_controls.py) resolves the pinned Cao et al. 2024 v2.4 model at exact 0, 5, 400, 420, 450, 470 and 540 Ma slots with pyGPlates 1.0.0. It reads the three applicable boundary-era files plus `TopologyBuildingBlocks.gpml`, `1000_0_rotfile.rot`, and `shapes_continents.gpmlz`. Every source member is hashed; rotations use anchor plate 0 with identity fallback disabled. The source model is [Cao et al. 2024](https://doi.org/10.1016/j.gsf.2024.101922), pinned to [Zenodo release 2.4](https://doi.org/10.5281/zenodo.13628813), CC BY 4.0, retrieved 2026-09-09.

The premeasurement policy is retained externally at `reconstruction-machinery-v1/tectonic-compiler/policy.json`. The child is capped at 2 MiB and the full research program at 32 MiB. The validated seven-age result is 1,799,546 bytes, so no truncation was required. It contains all 961 resolved segment occurrences and full source polylines, plus a deterministic 179-record comparison sample. The child measures about 1.73 MiB and the program about 24.1 MiB.

## Contract and semantics

Each record keeps `segmentLineageId` as the stable source feature ID and an `exactSlotSegmentId` combining exact age, source ID and resolved part. It records source type, source validity, plate ID, directed geometry, subduction polarity, both locally resolved topology owners, native sharing-topology sides, raw membership in the mixed `shapes_continents.gpmlz` collection, and strict-circuit status. That collection includes closed continental boundaries, unclassified features, island arcs, terrane boundaries, cratons and other feature types. Membership is therefore neither a land mask nor a resolved continental-crust classification; its complement is not oceanic crust. A resolved part number is exact-slot identity and is not asserted to persist across a split, merge or source-era seam. No interpolation between these seven ages is emitted.

At the longest internal edge, the compiler samples points 25 km on both sides. The ordered sides are right (`-normal`) then left (`+normal`) relative to the resolved directed line; source polarity names the overriding side, so `Right` maps to side 0 and `Left` to side 1. The independent native reference is `get_sharing_resolved_topology_on_left_flags()`. A record receives motion only when polygon containment and that native side oracle agree exactly. Unique topology owners then supply strict one-million-year stage rotations. `pygplates.calculate_velocities` produces native geocentric velocities in cm/yr; their left-minus-right difference is projected onto the directed tangent and left normal. The orthogonal decomposition residual is only a numerical consistency check, not the direction oracle.

`sourceType` is the published model classification. `effect` is EarthHistory inference:

- a source mid-ocean ridge is retained as a published ridge, with local motion labelled divergent or non-divergent;
- a source subduction zone is retained as published subduction, with local motion labelled convergent or non-convergent and source polarity retained;
- a source transform is separated into shear-dominant or oblique motion;
- untyped convergence/divergence remains explicitly untyped, and continental divergence is never promoted to a ridge.

Thus a source ridge that is locally non-divergent and a source subduction segment that is locally non-convergent remain recorded discrepancies. Relative motion supplies forcing direction and rate, not exact terrain height.

## Results

Across the seven exact slots the source resolves 380 subduction, 250 ridge, 249 transform, 33 inferred-palaeoboundary, 20 fault, eight fracture-zone, seven terrane-boundary, seven unclassified, five orogenic-belt and two continental-rift occurrences. Of 961 occurrences, 873 have unique side ownership, native side agreement and strict circuits. Six retain unavailable point ownership, three retain unavailable strict rotation, and 79 are unavailable because point containment does not match the source sharing-topology side oracle. This newly exposed class includes missing, overlapping and different adjacent topology identities and cannot be assigned motion safely.

The supported diagnostics comprise 276 locally convergent source-subduction, 170 locally divergent source-ridge and 138 shear-dominant source-transform occurrences. Sixty-nine source-subduction occurrences are locally non-convergent, 53 source-ridge occurrences locally non-divergent and 95 transforms oblique. Four representative records of each ridge/subduction disagreement are preserved with coordinates, ordered owners, source polarity and velocities. Because they passed the independent native side oracle, these are not explained by the compiler's former sign ambiguity; they can reflect local geometry, the one-million-year window or model kinematics and cannot overturn the published feature type. Thirty untyped divergent occurrences remain `not-ridge`; 37 untyped convergent occurrences remain untyped.

One artifact validator checks exact record identity, age domain, frame, every source digest, native side order, status, source fields and motion values. The accepted artifact and five deliberately mutated copies pass through that same validator. Reversing a stored normal component, flipping polarity, moving an age result outside 0–540 Ma, replacing the rotation digest, and replacing the `shapes_continents` digest each produce a recorded `ValueError`. This is the R1 witness; boolean comparisons outside the acceptance path are not used. The result is at external `reconstruction-machinery-v1/tectonic-compiler/tectonic-controls.json`.

## Package boundary and remaining work

The eventual offline package can compile accepted records into material charts keyed by source feature, exact topology slot and validated lineage. Provenance must retain model/version/frame/anchor, source-member hashes, source classification, inferred-effect method/version, geometry, side owners, polarity, velocity window and support state. Runtime motion arithmetic receives only selected chart controls and compact evidence/status; unavailable records never become fixed geometry.

The next minimum ocean experiment should select one exact source ridge segment at a source-valid age, create paired chart-front vertices on its two owned sides, and advect each side with its own strict topology/plate history. It must retain twin IDs, source segment association and exact-slot/seam identity, then report birth as exact only when the source topology API establishes creation at that event. Otherwise birth is bounded, source-unresolved or older-censored. Consumption requires a source-associated subduction event; survival of an offset point is insufficient. `TopologicalModel.reconstruct_geometry` and GPlately seafloor-age workflows are suitable numerical references, but their default deactivation is model inference rather than measured crust age.

Still required for a complete 0–540 Ma compiler are all 109 exact topology checkpoints, validated one-to-one segment lineage between adjacent slots, explicit split/merge and 250/410 Ma seam records, persistent continental/deforming charts, canonical ridge-birth/subduction-loss cohorts, quantization/oracle tests, and final package-size projection. Published land/shallow geography remains an independent input and does not block these numeric tectonic products.
