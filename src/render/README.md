# Renderer contract

`GlobeView` owns the Three scene and keeps per-frame work outside React state.
It attempts `WebGPURenderer` when the browser exposes WebGPU and creates a fresh,
explicit WebGL 2 renderer if initialization fails. Runtime inputs and workers
are served from the application origin.
`?renderer=webgl2` bypasses WebGPU for compatibility testing; diagnostics read
the initialized backend object rather than treating a WebGPU request as proof.

The surface worker turns each compact snapshot into bounded albedo, relief,
roughness and cloud fields. Its four-entry/20 MiB LRU refuses oversized values,
and a replacement request terminates the stale worker. Coarse and regional
textures are keyed by snapshot identity and detail tier. Detail uses separate
enter/exit distances so camera jitter cannot churn generation.

Relief stores 0–9,000 metres above sea level. `verticalExaggeration=1` maps
those metres against a 6,371,000 metre mean Earth radius; the UI may scale the
display from 1× to 30× without changing the source field or regenerating a
texture. Fine relief, early-Earth crust and D8 drainage are deterministic visual
inferences. Drainage follows only lower neighboring cells, leaves sinks closed,
is bounded to 360 coarse segments, and appears only at regional detail.
Normal `surface` mode holds oceans at sea level. Explicit `seafloor` mode uses
the snapshot's negative elevation, a signed ±9,000 metre displacement encoding,
and a bathymetric palette; the cache key includes the mode.

The current limb is a thin, day/night-weighted geometric atmosphere that uses
standard Three materials on both backends. The researched Takram atmosphere was
not adopted in this bounded proof because its published package brings React
Three Fiber and postprocessing peers plus a LUT/asset integration that would
need a separate redistribution and dual-backend audit. The local atmosphere
keeps the prototype self-contained; Takram remains the candidate for a later
measured scattering replacement.

`window.__earthHistoryDiagnostics` and matching canvas data attributes expose
backend, effective quality, p50/p95 frame time, generation latency, stale-job
count, cache bytes and renderer memory for the production browser harness.
`surfaceRequestedAt`/`surfaceReadyAt` canvas attributes isolate refinement work
from the duration of an input gesture and OrbitControls damping.
`cameraDistance` updates with camera motion so the harness can time first visual
response and verify preset framing independently.

At regional zoom, a separate 128×128 camera-centred mesh samples the completed
surface relief and adds at most ±250 metres of deterministic synthetic detail at
1×. Its coherent spherical phase does not move when the 24° patch recentres.
Source slope and nearby tectonic lines orient the ridges, while coast, mapped
ice and tile edges suppress the effect. The three-entry/8 MiB cache and worker
serial share the surface lifecycle rules. This detail sharpens the sourced
broad relief; it is not evidence for exact summits or local landforms.

The present chapter uses its bundled Beck et al. Köppen–Geiger semantic groups
to constrain climate colour potential. The renderer maps desert, steppe,
tropical, temperate, cold, tundra and frost groups through a restrained terrain
blend rather than treating climate classes as observed land cover. The frost
group also limits permanent modern ice display; modern climate is absent from
LGM and deep-time snapshots, so those scenes keep their own documented
controls.
