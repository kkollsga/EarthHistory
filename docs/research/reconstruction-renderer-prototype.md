# Reconstruction renderer prototype

**Status:** independently reviewed laboratory implementation; it is not yet the application renderer.
**Date:** 2026-09-10
**Scope:** forward material-patch pose and height, bounded patch LOD and stitching, conservative BVH picking, immutable prepared-frame binding, and fenced GPU resource ownership.

## Shared reconstruction kernel

`src/render/reconstruction/patchKernel.ts` is the renderer formula for a material vertex. It instantiates the generic operations in `src/reconstruction/arithmetic.ts` for quaternion slerp, rotation, radial height scale, and the sole GPlates `(x,y,z)` to renderer `(x,z,-y)` axis conversion. Numeric sparse picking and the TSL adapter therefore use one formula rather than separate CPU and GPU scientific generators.

The kernel keeps motion and display interpolation separate. `motionStart`, `motionEnd`, and `motionFraction` are the compiler-selected motion subsegment; they are not the surrounding 5 Myr display checkpoints. Heights and `displayFraction` belong to the display interval. Rigid vertices retain material-chart directions. Deforming endpoints must be compiler-qualified, finite, unit length, and non-antipodal. Patch arrays, indices, colors, activation, quaternions, fractions, and exaggeration are checked at the CPU-to-GPU boundary.

`terrainNodes.ts` creates one TSL graph whose age controls update as uniforms. One GPU material represents one lifecycle cohort. Its patch-wide activation uniforms collapse inactive triangles in the vertex stage, so inactive material writes neither color nor depth on WebGPU or WebGL2. Mixed lifecycle cohorts must be separate patches. The synthetic birth and consumption fixture remains a local representation test; it does not prove global topology closure.

## Prepared-frame and geometry boundary

`frameBinding.ts` accepts only a verified `PreparedRevision`. It verifies package, frame, chart, material, cohort, checkpoint, and exact motion-binding identities, rejects lifecycle-unavailable charts, and keeps display interpolation separate from motion interpolation. The renderer does not select checkpoints or solve topology.

Callers must provide positive safe-integer `maxPatches` and `maxRetainedPatchBytes`. The binder totals source array byte lengths before cloning and rejects count, byte, or arithmetic overflow before allocation. Identity-bearing typed arrays remain private; `createPatchCopy()` returns a caller-owned copy so a published frame cannot mutate under the same revision. Releasing the frame releases the prepared lease idempotently.

The exporter target is offline-triangulated material patches, not raw polygon rings. Each patch is one lifecycle cohort and carries package/frame/chart/material/cohort identities, GPlates +Z-north unit directions, triangle indices, geometric seam IDs distinct from material IDs, display-height endpoints, and qualified interval bounds. A validated local spherical chart may cross longitude ±180 or contain a pole because runtime coordinates are XYZ; splitting is required only when one projection cannot represent the source polygon, and introduced cut vertices must share seam identity. Holes, winding, area, and containment are verified offline. Shared boundaries require identical directions and height endpoints plus explicit seam parameter intervals across sibling patches and LOD children. Exact checkpoint topology is authoritative; fractional correspondence uses persistent material/seam identity, never array position.

The current height arrays are finite metres only. A real source package still must declare its sea-level/radius vertical datum and a scientifically qualified height envelope. This prototype does not establish that terrain contract.

## LOD, seams, bounds, and picking

`patchLod.ts` incrementally accepts the highest-error split whose entire balance closure fits the declared level, leaf, and triangle limits. It never coarsens accepted detail after selection. Roots over any limit are rejected. Seam coverage requires exactly one interval on each side, so holes and duplicate same-side overlaps fail. `buildPatchStitchFanIndices()` emits actual coarse-to-fine fan triangles over every fine boundary segment.

`bounds.ts` uses compiler-qualified endpoint and adaptive interior samples. Its physical-metre AABB includes a chord bound for residual angular motion, both 1x and 30x radial extrema for positive and negative heights, and declared procedural displacement. `spatialIndex.ts` explicitly converts those bounds to unit-Earth renderer coordinates, preflights its worst-case typed allocation, and builds a deterministic typed-array BVH. Final `byteLength` counts BVH typed storage; caller-owned source bounds and transient build rows are separately scoped. The root bound is installed on the GPU-displaced Three geometry for conservative frustum culling.

`picking.ts` normalizes finite, nonzero rays and tests at most 64 BVH candidates with the shared numeric kernel. It rejects triangles below the same lifecycle threshold as the GPU. The representative probe applies fixed mixed-LOD stitch fans to the exact mesh used by GPU drawing, BVH construction, and sparse picking. Adaptive selector output is measured separately and is not yet wired to geometry assembly.

## GPU lifetime and memory

`resourcePool.ts` requires a declared byte reservation before `create()` is called, checks actual bytes against the reservation, keys reuse, and counts active, idle, retiring, and failed-retirement resources. Retirement admission backpressure leaves an idle resource retryable. An admitted fence failure remains retained and reported.

`gpuRetirement.ts` uses `GPUQueue.onSubmittedWorkDone()` on WebGPU and `fenceSync` with nonblocking zero-timeout `clientWaitSync` polling on WebGL2. Pending count and byte limits provide backpressure. Rejected fences remain accounted until an explicit confirmed device-loss owner ends the allocation lifetime; a fixed frame delay is not treated as completion proof.

`publication.ts` stages monotonic revisions, invalidates stale tokens, keeps the old coherent frame visible until commit, and sends replaced resources to the retirement owner. Its retained ledger includes visible, staged, pending-retirement, and failed-retirement bytes.

## Verification and measured probe

The restored focused commands passed:

```text
npx vitest run src/render/reconstruction/*.test.ts
10 files passed, 40 tests passed

npm run typecheck
passed
```

R1 logs under `../EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/gpu-prototype/` prove rejection of metre/unit BVH mismatch, duplicate same-side seam coverage, exposed mutable frame arrays, missing frame allocation preflight, non-finite publication age, non-coincident event fronts, inactive picking, and invalid rays. Each mutation was restored before the positive run.

The production harness command is:

```sh
node scripts/research/reconstruction-gpu-runner.mjs
```

It exited 0 on normal WebGPU and forced WebGL2. Both backends passed 66 Cao rigid-oracle samples, nonzero height, stable `2 -> 2` programs across uniform-only age changes, and validation/error checks. The representative synthetic patch has 1,089 vertices, 1,552 triangles, two fixed mixed-LOD stitch fans applied to its indices, a 38,912-byte BVH, and an exact sparse hit on triangle 1,009. GPU readback found 132 colored pixels while the inactive cohort produced zero. Resource reacquisition returned the same object; real backend fences retired 101,388 tracked patch-buffer bytes to zero. Material, pipeline, target, and backend-private allocation are not measured.

The written policy used 10 warmups, 100 CPU repetitions, and 60 render calls. On the recorded Apple M4 run, BVH build median was 1.4 ms, LOD median rounded to 0 ms, sparse-pick median was 0.1 ms, and `renderAsync` call p95 was 0.1 ms on both backends. The last value measures CPU submission/frame-call latency, not GPU execution time; asynchronous readback and retirement fences only prove completion. These are synthetic laboratory timings, not full-app performance results.

Deliberate GPU mutations are also part of the runner: the axis mutation raises angular error to about 1.804 rad and is rejected, while the lifecycle mutation produces 132 inactive colored pixels and is rejected. Full evidence is in `result.json` in the external directory. After the restored run and R1 logs, the child is 1,205,446 bytes under 8 MiB and the parent is 24,225,224 bytes under 32 MiB.

## Adoption gates

- A source-qualified global material partition must prove hole-free and overlap-free birth, spreading, deformation, consumption, and LOD connectivity. Activation is not topology closure.
- Source geometry must declare its vertical datum, height envelope, lifecycle support, and evidence status. Unknown coverage cannot be filled as if observed.
- Adaptive motion tables must meet the coordinate policy over 0–540 Ma; display-knot interpolation is insufficient.
- A grouped global representation must measure draw count and bytes before adoption. Shared motion palette entries may update once per plate, but changing cutpoints and unmatched boundary vertices cannot be interpolated by array index.
- Adaptive LOD selection still needs to drive real geometry assembly. The present GPU probe uses a fixed mixed-LOD mesh; selector timing and selection correctness are separate CPU evidence.
- Full-app frame time, readiness, CPU/GPU memory, cancellation, device loss, camera/frustum behavior, guides, overlays, and picking remain unmeasured for this path.
- No App, GlobeScene, GlobeView, GUI, or public-data migration is included here. Existing application behavior is unchanged.

The prototype is sufficient to start a source-qualified Cao vertical slice. It is not sufficient to delete the current renderer or claim release behavior.
