# Reconstruction implementation study

Research date: 2026-09-10. Astra coordinates Sol research and implementation through bounded phases. This report defines the implementation direction and separates executed evidence from remaining acceptance work. The user has approved replacement and removal of the old engine after the new path passes its acceptance checks. A standalone rigid core and GPU prototype are implemented and tested; the active application, GUI and public assets have not yet been migrated or removed.

**Current implementation scope:** the user has subsequently selected Cao 2024 as the foundation to implement first, with additional geography and detail considered later. The PALEOMAP-to-Cao conversion findings below remain research results, but complete converted shorelines are no longer a prerequisite for adopting the native Cao foundation. Native feature classes and unknown surface/crust/seafloor-age fields must remain explicit. Initial compilation covers0–540Ma; the format should permit extension through the source model's longer domain. App migration and legacy removal are now proceeding under that narrower scope; they are not yet complete.

## Recommendation

Build one offline reconstruction compiler, one small browser reconstruction engine and one GPU renderer. Compile plate ownership, model correspondence, motion schedules, material lineage and tectonic history offline. The browser selects marked intervals, evaluates compact motion and scalar controls, prepares requested-age climate, and generates visual detail. It does not reconstruct plate topology or search between competing plate models for each terrain vertex.

The numerical work supports this direction: compact rotation tables can match the selected reference controls when their timing includes changes in influencing parent plates. Five-million-year display ticks are not a sufficient motion clock. The geographic source package is still incomplete, so this result does not authorize treating the whole 0–540 Ma reconstruction as scientifically solved.

## Executed results

| Question | Evidence | Consequence |
|---|---|---|
| Can two display endpoints describe motion accurately? | Endpoint interpolation failed the fixed angular tolerance in three of five selected rigid controls. An arbitrary midpoint still left a worst rotation-error equivalent of about 14.6 km on Earth's surface. | Separate visible timeline ticks from motion/event subsegments. |
| Can a compact table improve this without browser reconstruction? | Adaptive tables passed four controls. The modern failure was traced to an omitted 3 Ma ancestor rotation knot. A correction using all 23 source ROT times in 0–5 Ma passed 66 independent holdouts with 34 stored samples; maximum error was about 6.37e-6 radians against a 1e-5 target. | Preserve the complete influencing source schedule before approximation. The selected modern table costs 816 unpacked bytes before indexing/provenance; this is not a global size projection. |
| Are storage precision and query order adequate? | Float32 stored quaternion controls passed the declared storage-error check. Reverse/shuffled lookups were deterministic. Missing-circuit, source-identity and corrupted-motion guards were exercised with deliberate failures. | Use compact, verified immutable controls; unsupported motion must never become identity fallback. |
| Can ridge-adjacent material retain identity? | Four generated offset points beside two source-typed ridge segments remained active, uniquely owned and circuit-supported in all 24 states from 5–0 Ma. Reverse queries agreed. Resolved topology feature IDs changed while plate ownership remained stable. | Own material identity separately from source topology IDs and retain source lineage. This does not establish exact ridge birth, consumption or global ocean coverage. |
| Is complete published surface geography ready? | Existing Cao crust/coast geometry is not a dated exposure atlas; Cao 2017 has a different frame and incomplete temporal coverage; the existing PALEOMAP conversion is partial. Inspection of the complete 76-page Merdith-based preprint found methods and equations, but no attached grids, flooding polygons, code or retrieval link for those artifacts. PALEOMAP has native surface grids, but sampled ancient plate/ocean polygons leave extensive ownership gaps. | No acquired package yet supplies both complete geography and the required global material history in one model frame. Do not repeat the rejected crosswalk or synthesize missing shores. |

Detailed methods, frozen policies, sources and limitations:

- [Rigid-coordinate trial](reconstruction-coordinate-preflight.md) and [machine result](reconstruction-coordinate-preflight.json).
- [Ocean-point trial](reconstruction-ocean-preflight.md) and [machine result](reconstruction-ocean-preflight.json).
- [Published-geography feasibility](reconstruction-geography-feasibility.md).

The distance equivalents above are bounds derived from rotation angular error, not measured tag or city displacement. Matching pyGPlates verifies numerical agreement with its selected model, not geological truth. The trial covers five deliberately selected rigid controls and four ocean points, not every plate or period.

Source-typed boundaries are preferred evidence, not a prerequisite for every inferred tectonic effect. The user's relative-motion method can classify convergence, divergence and slip where two polygons have unique ownership, defensible adjacency and strict rotation circuits. The remaining PALEOMAP problem is geometric and temporal coverage: at 450 and 540 Ma, approximately 70% of 2,485 coarse test points were outside the reconstructed plate polygons. These counts falsify complete coverage at those sampled ages; they are not exact area estimates. A reduced PALEOMAP-native package could use its published surface grids and label unsupported tectonics/seafloor ages, but it would not meet the approved goal of complete global material-coordinate history. The geography report preserves the distinction and reproducible evidence.

## Compartmentalization

| Compartment | Owns | Excludes |
|---|---|---|
| Offline compiler | Source/rights ledger, GPlates reference operations, partitioning, material charts, ridge birth/loss, motion/event schedule, geological history, quantization, validation and export | Browser code, scene objects and UI state |
| Browser reconstruction engine | Binary format, verified loading, bounded checkpoint store, interval selection, cancellation and immutable prepared revisions | React, scene ownership, competing source-model resolvers and per-vertex plate reconstruction |
| Shared mathematical kernel | One definition of terrain/material sampling and coordinate operations, with GPU and sparse CPU adapters | Independently maintained CPU and shader terrain formulas |
| GPU renderer | Material-patch LOD, shader adapters, resource ownership, conservative picking bounds, overlays and atomic publication | Scientific source selection, topology solving and private age-specific engines |
| GUI | Existing layout, timeline, panels, selection, camera intent, accessibility and scientific disclosures | Plate-model loading and separate temporal country/terrain schedulers |

The [runtime architecture](reconstruction-runtime-architecture.md) specifies proposed files, dependency direction, backend behavior and deletion evidence. Python remains the compiler environment. A language-neutral schema connects it to TypeScript; GPlates and acquisition catalogs stay out of the browser dependency graph.

The leading rendering candidate is a mesh of persistent material patches posed forward on the GPU. A globe-fixed cube cannot retain a material ID at each vertex while continents move without an inverse lookup. Material patches avoid that work. The implemented prototype proves the bounded rigid vertex calculation; global topology, coverage and LOD still need acceptance before replacing the current cube. No whole-app speedup has been established.

Use one shader algorithm across WebGPU and WebGL2. Three.js already supports those backends through its [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html); the proposed change moves additional vertex/material work onto that path. Keep shader structure stable across ages: update controls and uniforms rather than generating a new program per period. The CPU adapter evaluates only the few vertices needed for picking/reference queries, using the same formula and conservative bounds, rather than building a duplicate full surface.

## Runtime work that remains

- Select the display bracket and the applicable motion/event subsegments; fetch only the common core and bounded adjacent state.
- Perform compact interpolation and pose evaluation. If fully flattened motion tables become too large, test a precompiled parent-order rotation palette with bounded O(P) work per age change. No runtime discovery of a plate hierarchy or per-vertex partitioning is needed for that alternative.
- Compute a coarse geographic climate field once per requested-age revision from posed geography/height and shared climate/wind controls. Texture fabric follows material; atmosphere does not.
- Generate visible detail and lighting on the GPU, with projected-size LOD. Keep tagged focus at the same camera distance while its material address moves.

“Minimal runtime coordinates” therefore means avoiding reconstruction/search, not claiming interpolation requires zero arithmetic. Climate preparation and resource publication are still real work and must be included in readiness measurements.

## Data and performance constraints

The current static data inventory contains 47,711,924 raw bytes. Its 108 per-period country polygon files account for 15,579,022 bytes. The replacement archive must remove redundant runtime representations rather than coexist with them. Preserve original acquisitions, citations and published releases.

The complete app retains its 50 MiB artifact ceiling. Modern and ancient states have the same field capacity, precision, detail ceiling and rendering method. Keep one decoded model owner and at most two decoded display checkpoints, with bounded motion/event records. Account separately for CPU arrays, worker transfers/copies, cached fields, GPU buffers/textures and old/new publication overlap. A two-checkpoint count alone does not establish low memory.

Existing targets remain: response ≤100 ms, preview ≤250 ms, complete generation ≤500 ms, steady p95 ≤20 ms or ≤33 ms for the reduced path. Full coherent readiness is a separate measurement. No application benchmark was run in this study and no speedup is claimed. A production prototype must compare both backends against the existing release controls, including repeated transitions and memory plateau.

The numerical trials reused Python 3.9.6 and pyGPlates 1.0.0 and acquired Cao v2.4 inputs. Their owned output area is capped at 32 MiB within the existing 4 GiB source store; the coordinate and ocean subareas have 8 MiB and 4 MiB caps. Required numerical results have been promoted beside this report. No bulk source acquisition or full-series export occurred.

## What must pass before removal

1. Establish complete published land/shallow-sea geometry in one accepted model frame. Cao is a candidate, not mandatory if another coherent source/model package satisfies the full requirements. Unknown geographic classes remain visibly unknown and fail complete-geography acceptance; closing the mesh must not invent a shoreline.
2. Extend the source schedule proof to complete influencing circuits and supported topology events, then prove persistent ocean birth strips and consumption. The current offset-point trial cannot stand in for either event.
3. Compile a small modern/Ordovician corpus and test GPU material patches: closed coverage, sibling ridge fronts, subduction retirement, exact knots, fractional motion, mixed LOD seams and sparse CPU/GPU picking agreement. Picking bounds include intermediate motion, physical heights, up to 30× exaggeration and bounded procedural displacement.
4. Measure whole-artifact bytes, total CPU/GPU residency and complete readiness before adopting the representation. Stop if compactness or performance fails; do not retain a shadow engine as a hidden fallback.
5. Move the accepted path behind one facade, migrate every consumer, and remove duplicate schedulers, workers, source conversions, per-period reference geometry and modern-only surface enhancements only after source/bundle/network checks show replacements own those consumers.

Preserve the current layout, design, GUI and navigation. Older authored scenarios retain their content and must use the same publication/rendering contract before shared legacy producers are deleted. The existing app remains usable while these prerequisites are resolved; research results and prospective deletion lists are not evidence that replacement is already safe.

## Implemented software checkpoint

The [core implementation](reconstruction-core-implementation.md) provides verified compact rigid controls, nonzero-reference-age motion, lifecycle/identity guards, and immutable decoded samples. The [renderer prototype](reconstruction-renderer-prototype.md) shares its pose/height arithmetic with sparse CPU queries and adds conservative bounds, synthetic event-front fixtures and resource publication ownership. Independent Sol review closed concrete defects in both modules.

The [production GPU proof](reconstruction-gpu-prototype.md) passed all 66 held-out fixture ages on WebGPU and forced WebGL2. Maximum angular error was approximately6.215e-6 radians against the frozen1e-5 limit; nonzero radial displacement also passed. Actual vertex-computed varyings were read asynchronously, with emitted shader evidence excluding fragment recomputation. Program count stayed2→2 during age updates. Vertex-axis and payload-hash mutations were rejected. This is one rigid fixture, not global scientific or performance acceptance.

The earlier joined `make gate` exited0:360 tests in42files, TypeScript, production build,345 scientific asset hashes,47.20MiB application artifact and16.21MiB build cache. At that checkpoint the application retained its existing producers pending an accepted replacement package. It did not establish application migration, browser or performance acceptance.

The subsequent machinery checkpoint passed405tests in49files and the same build/artifact bounds. The [bounded runtime](reconstruction-runtime-implementation.md) now includes verified loading, cancellation, prepared revision ownership and continuous sparse addresses. The [climate-potential module](reconstruction-climate-implementation.md) implements bounded geographic synthesis with explicit input evidence. The renderer adds fixed mixed-resolution mesh stitching/picking and fenced resource ownership; adaptive LOD selection driving assembled geometry remains unproven. These are implemented components, not a completed app migration. The [native Cao compiler](reconstruction-cao-foundation-compiler.md) is preparing the newly authorized foundation package.

Source follow-up inspected the complete preprint, author/EarthByte public repositories and targeted repository/Zenodo searches. No matching accessible supplement was found. Native PALEOMAP can support published surface geography and locally inferred tectonic effects, but cannot supply the required global material/ocean history. The user subsequently chose native Cao implementation first. Compatible published geography or a validated correspondence remains a dependency of that later detail layer, rather than of the present foundation migration.
