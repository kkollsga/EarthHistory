# Reconstruction runtime implementation

Implemented 2026-09-10 as a pure TypeScript replacement boundary. The active application does not import it yet. The runtime consumes only offline-compiled, model-qualified packages and performs no topology partitioning or plate-tree solving in the browser.

## Public contract

`ReconstructionPackageManifest` binds package/revision, `FrameKey`, one verified core asset, verified compact motion assets, and ordered display checkpoints. Rigid charts bind a `MotionCatalog` and motion asset explicitly, including chart revision, material/cohort identity, reference age, payload digest, source intervals, and model frame. Triangle charts contain compiler-defined connectivity; checkpoints contain their sampled directions and display controls.

`ReconstructionRuntime.request(ageMa)` returns an immutable `RequestedRevision`, its cancellation signal, and a `PreparedRevision` promise. A prepared revision carries one canonical frame identity, the two display-checkpoint ages and their display fraction, scalar `resolve`, sparse `resolveMany`, `chartIdentity`, and `motionBinding(chartId)`. Rigid bindings expose the exact younger/older quaternion and fraction selected from the qualified motion table. Display-checkpoint fraction is never used as rigid motion fraction. Deforming bindings expose compiler-sampled endpoint controls and display fraction. Lifecycle-invalid bindings return a typed unavailable state, keeping CPU and GPU activation under one authority. The renderer therefore does not select checkpoints, inspect topology, or duplicate interval search.

Every prepared revision must be released. At most two unreleased revisions may overlap for visible/staged publication; a third request fails until one is released. Release clears the private core/checkpoint/motion payload and makes every later query fail, so a retained exterior revision cannot keep unledgered scientific arrays alive. `dispose()` invokes every lease release, aborts active and persistent acquisition, clears resident/pending checkpoint ownership, and nulls core/motion promises. Motion assets load sequentially under the persistent package task rather than through an unbounded chart-wide `Promise.all`.

## Verification and bounds

All static assets are checked for declared byte length and SHA-256 before decode. Package ID, revision, complete frame identity, chart identity, motion identity, age, control kinds, unit directions/quaternions, finite values, lifecycle bounds, and triangle ownership are validated. The manifest is cloned and deeply frozen at runtime construction. Core, checkpoints, decoded motion samples, and prepared revisions are immutable.

`TwoCheckpointStore` deduplicates same-age loads, permits at most two concurrent checkpoint reservations, retains at most two resident checkpoints, and aborts a fetch/digest path when its last consumer cancels. A canceled request remains reserved until the underlying fetch/digest settles even when a fetcher ignores abort; newer work waits through at most two removable, cancel-aware capacity waiters. Disposal is terminal, rejects waiters, and keeps aborted pending work in the ledger until settlement. Its ledger calls sizes `SourceBytes`: these are encoded static-asset byte measures, not claims about JavaScript heap size. The runtime ledger separately reports core source bytes, motion source bytes, resident checkpoint source bytes, pending reservations, and prepared-revision pins. Its conservative upper bound deliberately adds overlap, even when two categories reference the same decoded object.

## Evidence

```sh
npm test -- --run src/reconstruction/motion.test.ts src/reconstruction/runtime.test.ts
npm run typecheck
git diff --check
```

Result: 20 tests in 2 files passed; typecheck and diff check passed. Tests cover corrupt and mixed-frame assets, immutable manifests/samples/revisions, invalid lifecycles and controls, CPU/GPU lifecycle parity, unique chart/motion identity, deduplicated loads, two-resident and two-pending bounds, last-consumer cancellation during acquisition/digest, abort-ignoring fetch settlement, terminal disposal with pending waiters, stale out-of-order requests, disposal and two-revision publication overlap/release, rigid and barycentric addresses, endpoint/fractional continuity, unsupported ownership, and rejection of unqualified antipodal deformation intervals.

The primary rigid motion regression uses the actual Cao 0–5 Ma fixture: 34 stored motion samples, the 3 Ma ancestor-circuit knot, nonzero 5 Ma reference age, and all 66 independent pyGPlates oracle directions. Every prepared rigid query stays below the fixed `1e-5 rad` tolerance. Synthetic display endpoints are used only for triangle/barycentric software tests and are not evidence for plate motion.

## Unsupported work

The schema does not provide a global chart catalog, topology lineage, ocean cohort inventory, deforming mesh source, geography ownership, tectonic terrain history, or 0–540 Ma package. Triangle checkpoint interpolation is valid only for compiler-qualified, non-antipodal intervals; compiling those intervals and their event seams remains source work. JavaScript heap, worker-copy, GPU, and publication-retirement bytes require platform measurements beyond the source-byte ledger. Packed field formats and measured decoded-memory ceilings remain prerequisites before global adoption. Application migration, representative performance, and removal of the old engine remain later phases.
