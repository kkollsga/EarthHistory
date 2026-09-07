# Cube-sphere reuse review

## Decision

Do not add `@hello-worlds/planets` as a dependency or copy its current planet
implementation. Reuse four design ideas in an EarthHistory-owned,
test-driven implementation: six transformed cube faces, normalized cube-plane
samples, an extra sample ring for local normals, and worker-built typed-array
meshes. Add explicit cross-face addressing, adjacent-LOD balancing, request
generations, cancellation and a byte-bounded cache rather than inheriting the
package's runtime contracts.

This is a source-informed clean implementation decision. Direct code reuse is
also held because the repository declares MIT in package manifests but the
inspected tree contains no `LICENSE` file with the license text and attribution
terms required by this project's intake rules.

## Source and review method

- Repository: [`kenjinp/hello-worlds`](https://github.com/kenjinp/hello-worlds)
- Inspected package: `@hello-worlds/planets` 0.0.25
- Inspected HEAD: `d3b010ad6db7b365e48a65c629db40dbf5b2729d`
- Retrieved and graph-built through the Open Source MCP on 2026-09-07. The MCP
  exposed the exact HEAD but not its authored timestamp; the retrieval date is
  therefore recorded separately rather than presented as a commit date.
- The structural review followed `repo_management` → `graph_overview` → Cypher
  definition/call queries → bounded source reads. No GitHub CLI, raw web fetch
  or local clone inspection was used.

The repository describes the libraries as work in progress with unstable APIs.
The package targets Three.js 0.158.0 in development and declares a `^0.143.0`
peer range. EarthHistory uses Three.js r185 and its WebGPU-capable renderer, so
the package's material, BVH and renderer assumptions are not a demonstrated
drop-in match.

## What the implementation does

`CubicQuadTree` creates six face transforms for ±X, ±Y and ±Z. Each face owns
an independent planar quadtree. On every planet update, the implementation
constructs a new six-face tree, recursively subdivides nodes according to
camera distance from each normalized face-cell centre, diffs the resulting
leaf keys against the active chunk map, and queues new leaf meshes in a worker
pool. See [`CubicQuadTree.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/quadtree/CubicQuadTree.ts#L12),
[`Quadtree.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/quadtree/Quadtree.ts#L23),
and [`Planet.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/planet/Planet.ts#L102).

The mesh builder samples a planar face grid plus one extra vertex ring, adds
the tile offset, normalizes every position onto the sphere, and samples height
and colour generators in world space. It builds indexed triangles, accumulates
face normals across the expanded grid, then turns the outer ring into skirts
by copying the adjacent ring and pulling it inward. This is a useful compact
pattern for deterministic source sampling and chunk-local normals. See
[`generateInitialHeights.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/planet/chunk-helpers/generateInitialHeights.ts#L25),
[`generateNormals.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/planet/chunk-helpers/generateNormals.ts#L10),
and [`fixEdgeSkirts.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/planet/chunk-helpers/fixEdgeSkirts.ts#L6).

Workers return position, colour, normal, coordinate and index buffers and build
a `three-mesh-bvh` tree per chunk. The main thread installs these attributes on
a `BufferGeometry`. The public planet accepts a shared Three.js `Material` and
chunks additionally expose vertex colour, UV and local-UV conventions. See
[`Planet.chunk.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/planet/Planet.chunk.ts#L10),
[`Planet.worker.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/planet/Planet.worker.ts#L9),
and [`Chunk.ts`](https://github.com/kenjinp/hello-worlds/blob/d3b010ad6db7b365e48a65c629db40dbf5b2729d/packages/planets/src/chunk/Chunk.ts#L118).

## Gaps that matter for EarthHistory

- The six quadtrees do not share neighbor state. The inspected source contains
  no cross-face edge mapping, adjacent-level restriction or crack-free
  transition indices. Skirts conceal geometric gaps; they do not establish
  matching surface positions, normals or materials across a face or LOD edge.
- The skirt depth scales with chunk width up to one fifth of the planet radius.
  This can create visible walls at grazing angles and does not meet the user's
  no-seam requirement by itself.
- Worker messages carry a builder ID but no per-request generation. Camera LOD
  updates stop entirely while the worker pool is busy, and queued requests have
  no cancellation path. EarthHistory requires stale-safe rapid orbit, zoom and
  time changes.
- Each completed chunk allocates SharedArrayBuffers and a BVH. SharedArrayBuffer
  requires cross-origin isolation in deployed browsers, which the current
  GitHub Pages target does not establish. The implementation also copies from
  ordinary arrays into new shared typed arrays, with an inline TODO noting the
  extra memory cost.
- The current `buildPlanetChunk` result does not include `localUvs`,
  `minHeight` or `maxHeight`, while `Chunk.rebuildMeshFromData` consumes those
  fields. The main-thread callback accepts `any`, so TypeScript does not catch
  this interface mismatch. The inspected package has no package-local test or
  spec files to demonstrate this path.
- The nominal chunk pool is not repopulated when chunks retire; retired chunks
  are disposed. Geometry disposal omits `localUvs`, optional splat attributes
  and explicit BVH cleanup. This is insufficient evidence of a bounded,
  churn-safe memory lifecycle.
- Shared shader-material uniforms for width, radius and resolution are mutated
  from each chunk constructor. EarthHistory's r185 MeshPhysical/WebGPU material
  path needs per-tile attributes or per-object bindings with explicit tests.

## Reusable implementation guidance

Keep cube-face topology and the world-space source sampler separate. Give every
tile a canonical `(face, level, x, y)` key and map neighbors explicitly across
all 12 cube edges. Balance visible neighbors to a maximum one-level difference,
then use matched edge vertices or deterministic transition indices; skirts may
remain a small last-resort horizon guard, not the primary seam mechanism.

Sample the same source function at canonical shared-edge directions, including
the poles and antimeridian. Generate normals from an overlap ring, but make
edge normals derive from the same cross-tile samples. Keep albedo, roughness
and biome inputs in the same canonical direction space so geometric continuity
cannot expose an oval colour patch.

Use EarthHistory's existing stale-request serials and bounded LRU accounting.
Workers should return transferable `ArrayBuffer`s, include a generation and
tile key, and allow queued work to be dropped before computation. Avoid a BVH
unless a measured picking or collision consumer justifies its build and memory
cost. Record visible/resident tiles by face and LOD, maximum neighbor delta,
queue/stale counts, cache bytes and evictions for browser verification.

The secondary PlanetTechJS candidate was not inspected because the first
repository already supplied the useful cube projection and worker patterns,
while its seam, lifecycle and compatibility gaps were sufficient to reject
direct reuse. A second repository switch would not change this bounded decision.
