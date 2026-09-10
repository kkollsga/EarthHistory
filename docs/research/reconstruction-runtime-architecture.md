# Reconstruction runtime architecture

**Status:** research recommendation, 2026-09-10. It approves no geography,
material history, migration, release, or performance claim.

## Recommendation

Compile reconstruction work offline into persistent material meshes, marked
motion/event subsegments, and display checkpoints. At runtime, load a model core
plus at most two display chunks, select the enclosing motion subsegment, and
evaluate one shared GPU vertex/material kernel. A renderer facade accepts one
immutable request and emits immutable, monotonically versioned publications;
terrain, displayed-triangle sampler, countries, POIs, and overlays commit under
one publication ID. This tracked record defines that boundary.

A geographic cube vertex cannot keep one material ID as continents move without
runtime inverse ownership. Interpolated endpoint address rasters instead smear
moving coasts and fail at topology events. A material mesh stores a parcel once
and poses it forward, removing browser rotation trees and per-vertex crosswalks.
Replace cube LOD only after the prototype proves coverage, events, seams,
picking, and performance; until then it is the control.

## Compartment boundary and dependency direction

Proposed files name responsibilities; they do not authorize implementation.

```text
tools/reconstruction-compiler/
  compile.py              pyGPlates -> core/knot/interval chunks
  topology.py             lineage, interval connectivity, gaps
  validate.py             source, quantization, coverage, endpoints

schemas/reconstruction-v1.json
                          language-neutral packed binary field/layout contract

src/reconstruction/       ENGINE; no React, Three.js or DOM
  format.ts               decoder, evidence codes, hashes
  interval.ts             display/motion bracket and gap resolution
  checkpointStore.ts      verified core + two-chunk LRU
  prepare.worker.ts       one decode/preparation worker
  engine.ts               cancellation and PreparedRevision
  kernel.ts/kernelCpu.ts  one algorithm plus sparse scalar adapter

src/render/reconstruction/ RENDERER; imports engine contracts and Three.js
  RendererFacade.ts       request, camera commands, subscription, disposal
  TransitionSurface.ts    material-mesh LOD, draws and seams
  terrainNodes.ts         TSL adapter for the shared kernel
  publication.ts          atomic preview/settled revision swap
  picking.ts              bounded candidates plus sparse evaluation
  resources.ts            ownership, retirement and byte ledger
```

Dependency direction is `App -> RendererFacade -> Engine contracts`; the
renderer consumes immutable engine buffers, but the engine never imports it.
The Python compiler uses the existing pinned pyGPlates environment. Python and
TypeScript consume the language-neutral schema; neither imports the other's
implementation. Compiler code, GPlates bindings, catalogs, and provenance are
never browser imports. `kernel.ts` is parameterized by a small arithmetic and
sampling interface; CPU scalar and TSL adapters call that one formula.

Ownership is explicit: compiler owns rotations, partitioning, identities,
history integration, quantization, and evidence; engine owns age resolution,
loading, validation, cancellation, and two chunks; renderer owns LOD, GPU
resources, picking and publication; `App` owns editorial/UI/camera intent only.

## Compiled representation

The core stores material vertices/patches, rigid block IDs, reference directions,
lineage, boundary polarity, ocean lifecycle, evidence codes, and LOD bounds. A
display knot stores the same schema at every age: source height, inferred
history, global climate drivers, material controls, and validity. An interval
stores connectivity and sparse approved deformation positions. Its separate
motion table preserves source circuit/event knots and adds deterministic,
oracle-qualified samples only where the declared coordinate error requires them.

Rigid material uses the enclosing motion subsegment's precompiled quaternions;
deforming material uses source-qualified subsegment coordinates. The browser
does not build a reconstruction tree. It interpolates motion inside that segment
and display controls inside the two display chunks. Ocean/topology elements are
enabled only inside their lifespan. Unsupported correspondence is a typed hole
or discontinuity, never a nearest unrelated fallback.

This separation is required by the executed
[`reconstruction-coordinate-preflight.md`](reconstruction-coordinate-preflight.md):
bare 5 Myr endpoint interpolation, and even one 2.5 Myr calibration, failed three
moving controls; the largest calibrated error was about 14.6 km. Display chunks
remain bounded to two, while compact motion/event records use their qualified
cadence and do not become additional full scene states.

Connectivity is interval-owned. Splits, merges, births, losses, circuit changes,
and unsupported transitions create marked events rather than incompatible
blends. Exact age uses a degenerate display bracket through the same kernel and
publisher, plus the exact motion event. Adjacent intervals must reproduce their
shared knot within declared tolerance or mark it discontinuous. Fractional
output is deterministic from display bracket, motion subsegment, and fractions,
independent of navigation direction.

Lifecycle is geometry, not only an enable bit. Ridge birth uses an interval
strip whose sibling front vertices coincide at birth and separate as ocean
opens; subduction clips and retires triangles at the consumption front.
Event-front/seam IDs may differ from persistent parcel IDs. Coverage is separate
from evidence validity: unsupported cells use the same pipeline with an explicit
unknown/synthetic code, never a fake valid parcel, hole, overlap, or second
background terrain engine.

Climate is geographic; terrain history and texture phase are material-bound.
At every requested age, one mandatory coarse pass computes climate from that
age's posed geography and height, interpolated global/wind controls, Hadley
positions, sea distance, lapse, and rain shadow. Atmosphere is never advected
with crust. The shared climate kernel may run as WebGPU compute or in the one
worker fallback, but must produce the same packed field and run once per
revision—never as a per-fragment coast search or ray march. A geometry-uniform
update alone is not a completed requested-age publication.

## GPU algorithm and backend contract

EarthHistory already renders through Three.js `WebGPURenderer`, detecting WebGPU
or WebGL2 (`src/render/GlobeScene.ts:660-692`). Reconstruction, vertex generation,
and most material preparation remain CPU work. Proposed offload is:

1. read display endpoints plus the selected motion/event subsegment;
2. evaluate rigid quaternion or deforming subsegment pose;
3. interpolate physical height and displace along the posed radial direction;
4. derive seam-consistent geometric normals from the published mesh plus bounded
   material normal detail;
5. evaluate height/history/climate-conditioned material using persistent
   material coordinates; and
6. apply lifecycle/validity gates and the publication's view uniforms.

Installed Three.js is **0.185.1**. `WebGPURenderer` falls back to WebGL2 and TSL
targets WGSL/GLSL ([renderer guide](https://threejs.org/manual/en/webgpurenderer),
[TSL](https://threejs.org/docs/TSL.html)). Installed source provides compute and
storage nodes, but those are not a safe shared backend contract
([storage attributes](https://threejs.org/docs/pages/StorageBufferAttribute.html),
[Renderer API](https://threejs.org/docs/pages/Renderer.html)).

The required algorithm is one TSL vertex/material graph on both backends, using
regular attributes/data textures as baseline. WebGPU compute/storage is only a
tested transport optimization, never another formula. Fallback may lower LOD or
optional detail, not science. The official guide excludes `ShaderMaterial`,
`RawShaderMaterial`, and `onBeforeCompile` from this renderer migration.

## CPU oracle, picking, and seams

GPU displacement forbids synchronous readback as a picking or overlay design.
Readback APIs are asynchronous and still transfer GPU data to CPU; using them on
pointer movement would serialize the frame. Instead, the publication retains a
compact CPU copy of endpoint physical controls and visible transition indices.
A bounds hierarchy selects a few candidate triangles. `kernelCpu.ts` evaluates
only their vertices at the publication's interval/fraction, then ray-tests the
same indexed triangles the GPU draws. Countries, POIs, guides, and surface picks
use this oracle and the same publication ID.

Each BVH bound encloses the whole motion subsegment: intermediate rotation-arc
extrema, deforming envelopes, source height, relief up to 30×, and maximum
procedural displacement. Endpoint-only bounds are invalid. A mutation fixture
must move an exaggerated mountain outside both endpoint AABBs at an intermediate
age and fail when the swept bound is removed.

This is bounded evaluation, not a second generator: CPU creates no tiles,
normals, textures, or full vertex arrays, and both adapters call `kernel.ts`.
Compare CPU and GPU positions at rigid, deforming, polar, dateline, coastline,
and topology-event samples.

Each multiresolution patch owns canonical edge vertices. Adjacent patches share
material IDs and endpoint controls; a finer edge constrains its coincident
samples to the coarser edge. Skirts may hide a rasterization crack but cannot be
the scientific continuity mechanism. Completion requires no holes or overlaps,
neighbor LOD difference at most one, equal edge positions/normals, and a pick
sampler built from the exact visible triangles.

## Scrubbing and publication

Within a display interval, geometry scrubbing swaps display and motion-subsegment
fractions while buffers, connectivity, textures, and draws remain resident.
Every requested age still runs the mandatory coarse geographic climate pass;
uniform-only geometry is not the whole publication. Crossing a display knot
prefetches one chunk; crossing a motion event selects another compact record.
Neither action runs GPlates or repartitions.

Preview and settled LOD are distinct immutable publications. Only the latest
request can commit, and terrain, actual displayed-triangle sampler, countries,
POIs, and overlays carry the same publication ID. No synchronous GPU readback,
full-scene replacement per slider event, independently scheduled scientific
overlay, or CPU/GPU shadow generator is permitted.

## Artifact and memory accounting

The current `public/data` inventory is 47,711,924 raw bytes; its largest runtime
groups include the 5,356,284-byte lifecycle binary, 3,146,951-byte ocean-motion
binary, and 2,462,978-byte ocean metadata. The new archive must replace duplicated
PALEOMAP/Cao/runtime-conversion assets rather than coexist with them. The whole
raw static artifact remains at most 50 MiB. At runtime, network and decode scope
is the model core plus at most two adjacent chunks, not all 109 knots.

Report exact uncompressed bytes for artifact classes; CPU core, two chunks,
oracle/index/cache and one decode/stage transient; and GPU attributes, indices,
transforms, textures/backend allocations plus old-visible/one-staged transient.

The current 48 MiB/160-entry field cache and 96-leaf selection are starting
component bounds, not total-memory measurements. ArrayBuffer lengths and owned
GPU resource sizes must feed one ledger; `renderer.info` alone is insufficient.
One worker owns decoding. Transfers have one owner; GitHub Pages does not imply
`SharedArrayBuffer`. Release non-oracle CPU copies after upload and count every
unavoidable CPU/GPU copy.

Existing performance goals remain separate measurements: response at most
100 ms, preview at most 250 ms, complete generation at most 500 ms, and frame
p95 at most 20 ms (33 ms reduced path), with first and full readiness reported
separately. No offload saving is claimed until a production WebGPU/WebGL2
prototype measures it.

## Future migration and deletion map — not authorized here

1. Research-prototype modern/Ordovician and difficult 420/430 Ma intervals
   outside the product. Prove GPlates agreement, exact-knot equality, fraction
   determinism, holes/seams, source geography/material acceptance, CPU/GPU pick
   parity, both backends, byte ledgers, and written performance stops.
2. Put the approved path behind `RendererFacade`; keep the current scene as a
   control, never as a hidden fallback within the publication.
3. Migrate all 0–540 Ma consumers to `PreparedRevision`, then remove
   `surface.worker.ts` terrain generation, PALEOMAP `temporalCube` publication,
   `caoSurface` publication, `publishExactModernCubeUpdate`, legacy regional
   worker/mesh code, runtime crosswalks, and producer-specific App setters/state.
4. Convert >540 Ma authored scenarios into the same `PreparedRevision` and
   renderer contract with explicit `authored-scenario` evidence. They need no
   plate reconstruction, but must not retain `surface.ts` as a second renderer.
   Delete the old surface producer only after these consumers migrate.
5. Prove deletion through imports, worker chunks, asset manifests, runtime
   network records, publication identity tests, and absence of canvas-diagnostic
   state feedback. Preserve original research sources and published artifacts.

## Prototype decision gate

Adopt the forward material mesh only if one small compiled corpus demonstrates:
complete globe coverage without duplicate surfaces; persistent material phase;
source-qualified shorelines and boundary polarity; typed lifecycle gaps;
identical exact knots from either adjacent interval; seam-consistent mixed LOD;
CPU oracle/GPU position agreement; common WebGPU/WebGL2 scientific output; core
plus two-chunk residency; raw artifact fit; and the existing performance stops.

If material-mesh topology cannot meet coverage, seam, or picking constraints
inside the bounds, stop the migration. The fallback investigation is a compact
offline interval inverse-address representation with the same tests, not a
return to runtime per-vertex GPlates/PALEOMAP/Cao conversion. Neither renderer
architecture can be accepted before the unresolved geography and material
research gates pass.
