# Cao full-domain extension (0–1800 Ma)

**Date:** 2026-09-10  
**Status:** live public package promoted for `ageDomainMa` 0–1800 Ma (235 checkpoints; layered shelf/land) under the Pages budget on 2026-09-10.

## Intent

Compile every Cao 2024 v2.4 source timestep the application can host: motion over the full authored rotation clock (0–1800 Ma), display checkpoints covering that domain, and native boundary/ownership layers including `1800-1000_plate_boundaries.gpml`. Continuous Precambrian scrub must use real plate motion once the package is promoted.

## Budget

- Pages / policy public foundation cap: **50 MB** (`DIST_MAX_MB`, `policy.json`).
- Shipped live cao-v2.4 tree: **~40 MB** / dist **~39.1 MiB** (235 checkpoints; layered shelf/land; no PaleoDEM bins).
- Naïve 5 Ma through 1800 (361 checkpoints) projected **~61 MB** before palette growth — over budget.
- Chosen display schedule (`cao_domain.py` / `caoDisplayCheckpointAgesMa`): **5 Ma to 540 Ma, then 10 Ma to 1800 Ma** → **235 checkpoints**. Motion still samples every qualified source rotation knot (565 knots in 0–1800). No coarse-step widening was required for this promotion.

## Pipeline changes (landed)

- Shared domain helpers: `src/reconstruction/caoDomain.ts`, `scripts/research/cao_domain.py`.
- Emitters read `CAO_SOURCE_OLDEST_MA = 1800` and the budget-aware display schedule.
- Native-layer / foundation topology lists include `1800-1000_plate_boundaries.gpml`.
- Runtime validators accept ages to 1.8 Ga (`motion.ts`, palette already allowed 1800, `packageV2` domain max 1800).

## Remaining rebuild work

Promoted. Keep future rebuilds on the budget-aware display schedule; widen the
coarse step beyond 540 Ma only if transitive public bytes again approach 50 MB.


## Note on Fennoscandia

Open motion-binding gaps such as 118–120 Ma are bridged at runtime from neighbouring compiled endpoints (`resolveChartMotionSegment`). Future package rebuilds also cap adaptive refinement instead of dropping those leaves.
