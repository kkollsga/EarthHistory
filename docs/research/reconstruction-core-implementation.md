# Reconstruction core implementation

Implementation status, 2026-09-10: Phase 1 pure TypeScript core and one bounded compiler-generated reference fixture are implemented on `codex/unified-reconstruction`. The module is not imported by the active application, so it is a tested replacement seam rather than a second production engine. No global scientific package, renderer migration, or old-path removal is claimed.

The subsequent model-independent runtime layer is also implemented. `package.ts` defines a model/frame-qualified manifest, stable material charts, and age checkpoints. `loader.ts` verifies byte length and SHA-256 before parsing, rejects mixed package/frame/revision data, deduplicates concurrent loads, cancels loads with no remaining consumer, and retains at most two checkpoints with an explicit byte ledger. `engine.ts` turns monotonically numbered immutable requests into immutable prepared revisions and prevents canceled or out-of-order work from publishing. Each prepared revision owns one checkpoint pair/fraction and exposes scalar and batched synchronous address resolution.

`resolver.ts` evaluates rigid chart-local directions and compiler-sampled deforming triangle addresses with barycentric coordinates. It enforces chart/material/cohort/revision identity, bounded triangle ownership, unit inputs, checkpoint presence, and lifecycle support. This is a runtime evaluator for compiled charts; it does not discover ownership, solve topology, or infer deformation in the browser.

## Implemented core

`src/reconstruction/arithmetic.ts` is the single arithmetic definition for numeric CPU and renderer-node adapters. It exposes typed WXYZ quaternions and GPlates XYZ directions, sign-safe/near-parallel SLERP, quaternion composition/inversion, the total-pose quotient for nonzero chart reference ages, direction rotation, radial height scaling, and the one GPlates-to-Three axis map `(x,y,z) -> (x,z,-y)`. Its generic `ScalarOps<T, Condition>` lets the GPU adapter supply node arithmetic without copying the formula. The eager near-parallel branch uses a safe nonzero spherical angle so an unselected shader branch cannot normalize zero.

`src/reconstruction/types.ts` defines model-qualified frames, continuous chart-local material addresses, lifecycle and support states, motion samples/interval identity, material poses, and a surface-evidence status separate from material movement. The synthetic rigid fixture accepts an arbitrary unit direction in its one declared chart without snapping to an exported seed. It does not prove that the direction geographically belongs to that plate; chart ownership and address resolution remain unimplemented.

`src/reconstruction/motion.ts` decodes the compact table, verifies header/version/record size/plate identity/age encoding/reference age/order/quaternion norm/source intervals, and binds the decoded interval to its payload digest, chart revision, catalog, frame, plate, and reference age. `decodeVerifiedMotionTable` verifies the SHA-256 payload before decoding. Preparation rejects source seams because this rigid prototype has no valid cross-seam evaluator. Evaluation rejects cross-catalog/frame intervals, invalid/non-unit addresses, malformed lifecycle declarations, outside-domain ages, and missing motion. Confirmed birth/loss times return inactive unborn/consumed states; bounded events return conditional states rather than a frozen coordinate. Queries are immutable pure evaluations of catalog, interval, address, lifecycle, and requested age.

The current fixture exercises confirmed rigid motion. The type contract represents compiled deformation, ambiguity, source seams, bounded events, and ocean/continental lifetimes, but the fixture does not implement or validate global ownership, barycentric deforming charts, ocean cohorts, topology transitions, geographic surface classes, or terrain history. `SurfaceEvidenceState.unknown` remains independent of a supported material pose.

## Compact format and reference age

The binary begins with a 32-byte `EHRC` header followed by fixed 20-byte records. Each record stores unsigned integer micro-Ma time and four float32 quaternion components in WXYZ order. The header records schema, record size/count, plate ID, youngest/oldest age, and reference age. Catalog metadata supplies model/version/frame/anchor/axis, source digests, chart/material IDs, source/event intervals, citation, rights, and payload digest.

The fixture uses plate 69702 over 0–5 Ma and a nonzero chart reference age of 5 Ma. Stored quaternions are already relative poses: `q_total(age) * inverse(q_total(5 Ma))`. Runtime interpolation applies them directly to `directionAtReference`; it must not quotient them a second time. The independent oracle uses pyGPlates `get_rotation(age, plate, from_time=5)` applied directly to `PointOnSphere`, rather than the compiler's local quaternion helper.

The compiler conservatively includes all 23 authored ROT times between 0 and 5 Ma, then adds oracle-qualified samples under the previously frozen `1e-5`-radian rule. This captures the 3 Ma parent-circuit knot that falsified the earlier selected-plate clock. The result has 34 samples, a 712-byte binary, 66 independent directions, and 15,016 total fixture bytes, below the 128 KiB fixture cap. This all-source clock is intentionally overinclusive and is not a minimal ancestor clock or a topology/geological event catalog.

## Source and provenance

Fixture source: Cao et al. 2024 model release 2.4, palaeomagnetic frame, anchor plate 0, [Zenodo DOI 10.5281/zenodo.13628813](https://doi.org/10.5281/zenodo.13628813), CC BY 4.0. Existing acquisition retrieval: 2026-09-09T13:26:07Z; compilation: 2026-09-10. The compiler pins and rejects changes to the rotation, continental, and 250–0 boundary source hashes. GPlates/pyGPlates software licensing is separate from dataset rights.

Fixture files:

- `cao-motion-0-5-v1.bin`: compiled float32/micro-Ma table;
- `cao-motion-0-5-v1.json`: source-qualified catalog and interval metadata;
- `cao-motion-0-5-v1.oracle.json`: independent held-out pyGPlates directions and tolerance.

## Checks executed

Compile command:

```sh
../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python scripts/research/compile_motion_controls.py
```

Result: 34 nodes, 66 held-out oracle directions, 15,016 fixture bytes, binary SHA-256 `dbd63b76fa6eb8f8cf331a028e944377cde394b16e2e6b74069ef565f638cd46`.

Targeted test command:

```sh
npm test -- --run src/reconstruction/motion.test.ts src/reconstruction/runtime.test.ts
```

Result for `motion.test.ts` and `runtime.test.ts`: 2 files and 13 tests passed. Tests cover payload hash, deeply immutable decoded samples, format and source-interval identity guards, float32 decoding, the 3 Ma clock knot, shared GPU subsegment selection, nonzero 5 Ma reference recovery, all 66 independent expected directions, reverse-order determinism, arbitrary continuous directions, confirmed/bounded/inconsistent lifecycle states, chart/frame rejection, non-unit input, corrupted length/header/quaternion, numerical motion mutation, quaternion sign equivalence, total-pose quotient, axis mapping, radial height, package corruption/mixed frames, endpoint/fractional and barycentric continuity, load deduplication, two-checkpoint eviction/ledger, canceled loads, and stale request rejection.

`npm run typecheck` and the joined `make gate` passed after both modules stabilized. The gate verified 360 tests in 42 files, the production application build and all 345 static scientific assets. Independent Sol review closed the bounded core findings. These checks do not establish global material ownership or app migration readiness.

## Remaining gates

- Derive the minimal influencing ancestor circuit clock and event schedule for the full model; the conservative clock proves correctness for one case but not global size.
- Compile and validate material ownership, topology lineage, ocean birth/loss cohorts, source seams, and sampled deforming charts. Identity fallback is never valid ownership.
- Attach accepted exposed-land/shallow-sea evidence and terrain histories without conflating supported motion with known surface class.
- Prove the shared GPU adapter against this exact kernel and oracle, then integrate only after the source and resource gates pass.
- Expand from the bounded fixture to equal-capacity 0 Ma and Ordovician controls before any active-app migration or legacy removal.
