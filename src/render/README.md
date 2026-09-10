# Renderer contract

`GlobeView` owns the scene lifetime and transports prepared Cao revisions and
editorial context through explicit callbacks. `GlobeScene` owns the camera,
lighting, guides, markers and frame loop. Scientific source loading, motion
qualification and material addresses belong to `src/reconstruction`.

Both backends use Three's node renderer and the same TSL material graph.
WebGPU is attempted when available; WebGL2 uses `WebGPURenderer` with
`forceWebGL`. `?renderer=webgl2` selects that compatibility path. Readiness is
reported after a successful frame, not after merely constructing a material.
Integer palette attributes use integer GPU bindings on both backends.

`reconstruction/caoFoundation.ts` publishes one native land batch, one country
line batch and exact-age boundary metadata. The static vertex/index buffers
are retained across age changes. A shared motion palette supplies qualified
quaternion endpoints, fractions and lifecycle activation. Present day follows
the same path and precision as every other compiled age. Source gaps deactivate
unsupported material; they do not receive identity motion.

The physical height placeholder is zero/unknown. A separate 400 metre shell
separation prevents refined planar triangles from sinking below the ocean
sphere. It participates in picking and bounds, but is not physical relief and
is not multiplied by visual exaggeration. Calibrated relief, bathymetry and
historical biome detail are deferred. Older chapters use editorial globe
uniforms through this same scene, with native geography explicitly unavailable.

Publication owns the matching geometry, palette, sparse picking state and
native overlay state. Replacement and teardown release prepared-state leases
and retire GPU resources through the shared publication/fence owner. Failed
age changes withhold stale native geometry. Neither the old terrain workers
nor their surface, regional, crosswalk or modern-only caches remain.

Material picking uses source-space chart bounds and triangles, transforming a
ray with the same prepared inverse pose that corresponds to the displayed
palette. Static triangle ranges are computed once. Picking does not rebuild
all globe vertices on every timeline step. A material address retains model
chart/revision and reference direction; unsupported intervals preserve the tag
without displaying an invented location. Age-driven retargeting preserves
camera distance.

Native topology describes instantaneous plate ownership only. It does not
provide persistent ocean material or seafloor age. Boundary and ownership
geometry is withheld between marked checkpoints because continuous topology
correspondence has not been qualified. Country references are separate modern
locator geometry bound to the same Cao motion authority.

`window.__earthHistoryDiagnostics` and canvas attributes expose actual backend,
frame timing, camera distance, renderer object counts, active source bytes,
static CPU/GPU buffer estimates and publication bytes. Source byte counts are
serialized asset ledgers, not measured JavaScript heap or total driver memory.
The runtime separately bounds checkpoint residency and unsettled loads; the
production adoption record reports these measurements and their limitations.

The fixed foundation does not implement adaptive spatial LOD. The retained
bounded geometry and shared arithmetic utilities support later measured detail
work without introducing a second rendering engine.
