# Reconstruction GPU prototype proof

Measured 2026-09-10 on macOS arm64, Apple M4, Node 22.16.0, and headless Chrome 152.0.7977.83. This is a production-built laboratory proof of the shared reconstruction kernel and one synthetic representative patch. It is not a full-app benchmark or evidence of global topology closure.

The runner serves a production Vite artifact. Async float readback witnesses vertex-stage pose and radial displacement. Stored WGSL/GLSL shows the reconstruction operations in the vertex shader. Both WebGPU and forced WebGL2 passed 66 independent Cao oracle ages with maximum angular error `6.215e-6 rad` under the `1e-5 rad` tolerance, nonzero height, stable `2 -> 2` program counts across uniform-only age changes, and clean validation/error checks.

The representative 33x33 patch contains 1,089 vertices and 1,552 triangles. Its fixed indices apply two mixed-LOD stitch fans to the rendered mesh, build a 38,912-byte conservative BVH, and return exact sparse triangle 1,009 from a ray at about three Earth radii. Adaptive selector output is a separate timing diagnostic and does not assemble this mesh. Each backend drew 132 colored pixels; the inactive lifecycle case drew zero. The reserved 101,388 tracked patch-buffer bytes were reused, then retired to zero through a real WebGPU queue fence or WebGL2 sync fence. Material, pipeline, target, and backend-private allocation were not measured.

Prewritten stops were BVH median <=100 ms, LOD median <=16 ms, sparse-pick median <=16 ms, and render submission-call p95 <=20 ms. With 10 warmups, 100 CPU repetitions, and 60 render calls, both normal cases passed: BVH about 1.4 ms, LOD rounded to 0 ms, sparse pick 0.1 ms, and `renderAsync` call p95 0.1 ms. The last metric is CPU call/submission time, not GPU execution time. Async readback and retirement fences prove completion without supplying GPU timestamps.

Two deliberate GPU failures are required. Negating the posed X coordinate raises angular error to about 1.804 rad and fails numerical acceptance. Leaving an inactive cohort active produces 132 colored pixels and fails lifecycle acceptance. A corrupted binary must also fail digest verification before decoding.

Run:

```sh
node scripts/research/reconstruction-gpu-runner.mjs
```

Final exit: 0. Evidence is under `../EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/gpu-prototype/`. After the restored run and R1 logs, the child uses 1,205,446 bytes of its 8 MiB cap; its parent uses 24,225,224 bytes of 32 MiB. [Compact measured results](./reconstruction-gpu-prototype.json) summarize the external record.

This proof covers the shared rigid vertex kernel, one fixed local seam/stitch workload, sparse picking parity, and fenced resource reuse. Adaptive selector-to-mesh assembly, the source vertical datum, global partition closure, real Cao mesh scale, full-app performance, and App/GUI migration remain adoption gates.
