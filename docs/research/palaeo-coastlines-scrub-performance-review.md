# Palaeo-coastline scrub performance review

**Scope.** Why an interval crossing still interrupts a scrub at v0.1.13
(`44455f9`), measured on a real GPU, and what each candidate fix would buy.
This is a review with measurements, not an implementation: no product file is
changed by it.

**Requirement under test.** "When scrubbing, all polygons should render
smoothly together with the country outlines and update on the fly; the user
should see the coastline develop as they scrub."

**Evidence.**
`dev-docs/bench/results/scrub-profile.json` (this run);
`dev-docs/bench/results/palaeo-coastlines-performance.json` (steady state,
2026-09-15); commit body of `631ce6b` (the prefetch repair, SwiftShader).

## Method (R11)

| | |
|---|---|
| Build | `npm run build`, `dist/` served by `tests/browser/server.mjs` at the Pages subpath |
| Browser | real Chrome (`channel: "chrome"`), `--disable-frame-rate-limit --disable-gpu-vsync`, GPU on |
| Viewport | 1440x900 CSS px, `deviceScaleFactor` 2 |
| Gesture | continuous 120 -> 50 Ma over 10 s, driven on the page's own `requestAnimationFrame` |
| Boundaries crossed | 117, 94, 81, 58 Ma (four), inside `135-117 -> 117-94 -> 94-81 -> 81-58 -> 58-49` |
| Settle | 6 s after the first interval is drawn, so the armed neighbour prefetch is warm |
| Arms | `layers=borders,guides` (off) and `+palaeoCoastlines` (on), alternated, 2 repetitions each |
| Machine | Mac mini, Apple M4, 10 cores, 16 GB |
| CPU stages | the project's own TypeScript loaded through Vite's SSR loader over the shipped `dist/` payloads; median of 3 per stage |

**Load caveat, stated before the numbers.** The one-minute load average was
**11.5 - 14.0** for every repetition; two other agents share this machine. The
absolute frame times below are inflated and are **not** a device budget. The
off/on difference, the per-crossing structure and the CPU stage ratios were
taken under the same load in alternated arms and are the load-robust part of
the record. The 2026-09-15 steady-state run on a quiet machine is the
calibration anchor: layer off p50 1.4 - 2.0 ms, layer on p50 1.6 - 2.2 ms.

## 1. What the scrub actually does

| arm | frames / 10 s | median gap | p95 | p99 | max | max / median | gaps > 2x median |
|---|---|---|---|---|---|---|---|
| off, rep 1 | 380 | 26.1 ms | 30.3 | 33.2 | 40.9 | 1.57 | 0 |
| off, rep 2 | 385 | 25.5 ms | 30.5 | 33.4 | 44.5 | 1.75 | 0 |
| **on, rep 1** | 303 | 31.3 ms | 46.7 | 58.8 | **123.0** | **3.93** | 4 |
| **on, rep 2** | 283 | 33.2 ms | 52.5 | 87.5 | **112.5** | **3.39** | 6 |

Three facts follow.

1. **The layer costs about 6 ms of every scrub frame** (31.3 - 26.1 and
   33.2 - 25.5). That is the per-frame palaeo retarget, and it matches the
   5.9 ms/frame `evaluatePalaeoMotionNow` in `631ce6b`'s profile. It is a
   steady tax, not a stall.
2. **Charts do update every frame.** Median drawn-age lag 0.22 Ma, exactly one
   drive step; longest run of frames with an unchanged drawn age: **0**. The
   scene's own motion probe recorded a posed palaeo chart on every frame but
   two out of 303 (and two out of 283).
3. **The stall is now a swap, not a load.** The worst frame in a whole
   four-boundary scrub is **112 - 123 ms**, not the 1,351 ms the SwiftShader
   harness recorded for `631ce6b`. That earlier maximum was the headless
   software rasteriser plus a cold interval; on a real GPU with a warm prefetch
   the crossing costs one long frame.

## 2. Per-crossing breakdown

`caoPalaeoIntervalId` per frame, with the outgoing triangle count held across
the swap. "held" frames are the ones where the outgoing geometry is still drawn
and posed at its own range edge (the `631ce6b` design) while the incoming
interval publishes.

| crossing | at | lead time of its prefetch | held frames | swap frame | outcome |
|---|---|---|---|---|---|
| 117 Ma, `135-117 -> 117-94` | t = 0.49 s | already resident at scrub start | 0 | 53.0 / 52.2 ms | clean |
| 94 Ma, `117-94 -> 94-81` | t = 3.77 s | 3.27 s | 0 | 49.5 / 51.0 ms | clean |
| **81 Ma, `94-81 -> 81-58`** | t = 5.63 s | 1.87 s | 2 | **123.0 / 112.5 ms** | visible hitch |
| 58 Ma, `81-58 -> 58-49` | t = 8.93 s | 3.29 s | 2 | 51.8 + 52.8 + 38.4 ms | mild hitch |

Network is not the cost. Every payload fetch from the local server:

| stage | per interval (3 class payloads) | source |
|---|---|---|
| fetch (localhost, parallel) | 4.5 - 44 ms per file, three in flight | resource timing, this run |
| sha256 verify | **0.57 - 1.24 ms total** | CPU stage run |
| EHPR decode | 0.36 - 0.99 ms total | CPU stage run |
| **worker triangulate (earcut + 1 deg refinement)** | **374 - 845 ms total** | CPU stage run |
| geometry copy + `BufferGeometry` + upload + first draw | ~110 - 160 ms, spread over 2 - 3 frames | swap frames above |

The `0.7 - 2.0 s per class` in `631ce6b`'s profile was fetch *plus* sha256 on a
saturated headless harness. Measured apart, **sha256 is a rounding error** and
the fetch is tens of milliseconds.

## 3. Where the CPU time goes

Per crossed interval, all three classes (`lm` + `sm` + `m`), medians of 3:

| interval | payload | pieces | base T | earcut T | refined T | earcut only | refine only | total | CPU geom | GPU geom |
|---|---|---|---|---|---|---|---|---|---|---|
| 135-117 | 332 KiB | 3,010 | 67,416 | 67,155 | 395,538 | 16.2 ms | 358.1 ms | 374.3 ms | 8.22 MiB | 9.15 MiB |
| 117-94 | 354 KiB | 3,197 | 71,956 | 71,691 | 407,257 | 16.0 ms | 453.5 ms | 469.5 ms | 8.49 MiB | 9.45 MiB |
| 94-81 | 348 KiB | 3,139 | 70,823 | 70,551 | 427,315 | 9.5 ms | 435.3 ms | 444.8 ms | 8.86 MiB | 9.86 MiB |
| 81-58 | 381 KiB | 3,463 | 77,287 | 76,930 | 446,265 | 12.7 ms | 832.0 ms | 844.7 ms | 9.28 MiB | 10.33 MiB |
| 58-49 | 403 KiB | 3,449 | 83,154 | 82,688 | 472,999 | 18.2 ms | 533.6 ms | 551.8 ms | 9.84 MiB | 10.95 MiB |

**The 1 degree conforming refinement is 95 - 99 % of the triangulation cost and
multiplies the triangle count by 5.80x.** It also runs in **one** worker
(`createPalaeoTriangulationRunner` builds a single `Worker` and multiplexes
requests by id), so the three classes started "in parallel" by
`loadVerifiedPalaeoInterval` still execute one after another inside it.

Catalog totals, all 25 intervals, all three classes: **7.77 MiB** of payload,
**1,557,697** base triangles, **9.03 M** projected refined triangles.

## 4. Costed options

Each prediction is arithmetic over the measured rates in section 3
(`triangulateMsPerBaseTriangle`, `gpuBytesPerRefinedTriangle` and
`cpuBytesPerRefinedTriangle` are recorded in the result JSON).

### A. Prepare all 25 intervals in the background after enablement

| | at current refinement | with refinement removed (C) |
|---|---|---|
| fetch | 7.77 MiB | same |
| worker time, one worker | **11.3 s** | **0.31 s** |
| CPU retained (prepared geometry) | **188 MiB** | **32 MiB** |
| effect on crossings | every crossing becomes a swap only | same |

At current refinement A is not a background task, it is a background *hour* of
a phone's battery: 11.3 s of one worker and 188 MiB of retained typed arrays,
against a 16 GB desktop and an unknown phone. **A is affordable only after C**,
or with a resident window of 4 - 6 intervals rather than all 25.

### B. Keep all intervals resident on the GPU

| | bytes |
|---|---|
| all 25 intervals at current refinement | **209 MiB** |
| all 25 intervals without refinement | **36 MiB** |
| native foundation static geometry, already resident | 29.2 MiB |
| per-interval renderer reservation, unchanged | 500 k vertices / 760 k triangles |

209 MiB of vertex and index buffers on top of the native 29 MiB is a real
device risk on integrated and mobile GPUs and is **a budget the user must
decide**, not a tuning choice. At 36 MiB it stops being a question.

### C. Remove the 1 degree refinement; draw palaeo classes with `depthTest` off

| | now | after |
|---|---|---|
| triangles, the five crossed intervals | 2,149,374 | 369,015 (**5.82x fewer**) |
| triangulate per interval | 374 - 845 ms | 9.5 - 18.2 ms |
| GPU bytes per interval | 9.15 - 10.95 MiB | ~1.6 - 2.0 MiB |

The 1 degree bound exists for one reason, stated in `caoFoundation.ts`: chord
sag `6 371 000 * (1 - cos(0.5 deg)) = 242.59 m`, which is what makes the shell
table's clearances (400 -> 700 -> 800 -> 1 300 -> 1 600 m) provably
non-interleaving *against depth-writing classes*. Drawing every palaeo class
with `depthTest` off, in strict `renderOrder`, and discarding fragments past
the analytic horizon — the mechanism the country lines already use, with
`CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES = 2` — removes the reason for
the clearances and therefore for the refinement.

Interactions, each of which needs its own check:

- **Shells become decorative.** `palaeo-land` and `palaeo-mountain` currently
  write depth; with `depthTest` off they must not, and the mountain-over-land
  order becomes a pure `renderOrder` fact.
- **The stacking assertion in `caoFoundation.test.ts` encodes the sag
  arithmetic** and must be restated as a draw-order contract, not deleted.
- **Horizon discard must be per fragment on `normalize(worldPosition)`.** A
  chord between two front-hemisphere points never leaves the cap they span, so
  a fully-visible triangle is never wrongly culled and a straddling one is
  culled exactly at the limb. The 2 degree margin was tuned to a 1 degree max
  chord and must be re-derived for unbounded earcut diagonals.
- **Pick and coverage.** Composite picking selects by chart, and a flat plate
  projects to the same screen area as the refined polygon, so the picked chart
  is unchanged; the picked *position* on a sagging plate is not the sphere
  point, so any coverage or guide-label geometry that reads it must be checked.
- **Not a science change.** The coastline outline is the compiler's own
  1 degree densified ring; only triangle interiors stop being subdivided.

### D. Earcut cost without refinement, per interval

Measured, not modelled: **9.5 - 18.2 ms** for all three classes of an interval,
against 374 - 845 ms today. One interval's whole preparation would fit inside
one 30 ms scrub frame's worth of worker time.

### E. Cheaper per-frame retarget

Measured cost: **~6 ms of every scrub frame** for ~3.2 k charts. The reason is
in `evaluateCaoPalaeoIntervalFrame`, which per frame:

- allocates and `Object.freeze`s **one chart object per piece** (3,010 - 3,463
  of them) with two fresh quaternions each (`slerpQuaternion`,
  `inverseQuaternion`);
- allocates a fresh `Float32Array(pieces * 11)` palette buffer;
- builds two `Set`s of source ids and limitations and then
  `[...activeSourceIds].sort()` — work whose result only changes when a piece's
  activation changes, which is a handful of frames per interval;
- and `palaeoChartPickState` then allocates a second `Float32Array(charts * 8)`
  plus a `Uint8Array`.

None of that depends on the age except the pose and the activation bit. The
identity table is already cached per resident interval (`631ce6b`); the *frame*
is not. A reusable frame — poses written into a preallocated buffer, chart
objects rebuilt only when the activation bitmask changes — is the same removal
applied one level up. The palette texture is already per instance and is a
separate, smaller item.

### F. Lazy or skipped sha256

**Cancelled by the measurement.** sha256 over a whole interval's three payloads
costs **0.57 - 1.24 ms**. Moving or skipping it buys nothing and gives up the
integrity check that `contentAddressedAssetUrl`'s `?h=` cache mode depends on.
Do not do this.

## 5. Recommendation

Target, to be written into the phase before it is measured: **no frame gap
above 2x the median during a 120 -> 50 Ma scrub across four boundaries**
(today: 3.4 - 3.9x), **zero held frames at a crossing** (today: 2 at two of the
four crossings), and **charts posed on every frame** (today: all but two).

Ordered by measured effect per unit of risk. Each item is bounded at <= 45 min
of development plus its test.

| # | item | expected effect | risk |
|---|---|---|---|
| 1 | **E** — reuse the palaeo frame: preallocated pose buffer, chart objects and source-id sets rebuilt only when the activation bitmask changes | ~6 ms/frame -> under 1.5 ms; on-arm median gap 31 - 33 ms -> ~27 ms, p95 47 - 53 ms -> ~33 ms | low; pure allocation removal behind an unchanged return shape |
| 2 | **Swap cost** — build `seamIds`, `preparedEntryIndices` and `materialChartIndices` in the worker and transfer them, instead of allocating ~10 MiB per crossing in `createStaticGeometryCopy`; `materialChartIndices` is today a byte-identical `.slice()` of `preparedEntryIndices` and can be one buffer | the 112 - 123 ms swap frame -> upload + first draw only; the two held frames should disappear | low-medium; touches `preparedBatch` and the renderer's copy contract |
| 3 | **Prefetch both neighbours, and widen residency to 3** | removes the 1.87 s lead that made the 81 Ma crossing the worst one; a reversal mid-scrub stops being cold | low; `CaoPalaeoIntervalStore` already bounds by bytes as well as count |
| 4 | **C** — drop the 1 degree refinement, `depthTest` off + strict `renderOrder` + analytic horizon discard | triangulate 374 - 845 ms -> 9.5 - 18.2 ms; GPU per interval 9 - 11 MiB -> ~1.8 MiB | **high**; own test pass: stacking assertion, horizon margin, pick position, goldens |
| 5 | **A** — background-prepare all 25 intervals after enablement, swap by visibility | crossings become free; only after 4, where it costs 0.31 s of worker and 32 MiB | medium; needs a residency and cancellation owner (R4) |
| 6 | **B** — keep all intervals resident on the GPU | only after 4 (36 MiB); at 209 MiB it is a device-budget decision, not an optimisation | user decision |
| — | **F** — lazy sha256 | **cancelled**: 0.57 - 1.24 ms per interval | — |

Items 1 - 3 are the ones that answer the user's sentence directly and carry no
scientific contract change: they should land as one batch, re-measured with
this same harness, before item 4 is planned. If items 1 - 3 bring the worst
frame under 2x the median, item 4 stops being about scrubbing at all and
becomes a memory-budget question that only matters if the user wants A or B.

**Decisions for the user.**

1. Is 209 MiB of GPU geometry (option B as it stands) acceptable, or is B
   conditional on C?
2. Is a flat-interior polygon acceptable in exchange for 5.8x fewer triangles?
   The coastline outline does not change; the interior stops being subdivided,
   and occlusion moves from depth to draw order.
3. Should the layer keep a bounded resident window (4 - 6 intervals, ~45 MiB
   CPU at current refinement) instead of all 25, if C is declined?

## Reproduction

```
cd <worktree> && npm run build
node <scratch>/scrub-profile.mjs  <out>/scrub-profile-raw.json   # real-Chrome scrub
node <scratch>/cpu-breakdown.mjs  <out>/cpu-breakdown.json       # CPU stage breakdown
node <scratch>/distill.mjs dev-docs/bench/results/scrub-profile.json
```

The three scripts live in this session's scratchpad under `perf/`; they are
measurement tools, not product code, and add no probe hook to `src/`.
