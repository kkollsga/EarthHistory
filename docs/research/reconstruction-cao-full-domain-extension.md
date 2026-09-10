# Cao full-domain extension (0–1800 Ma)

**Date:** 2026-09-10  
**Status:** pipeline parameterized; live public package still declares `ageDomainMa` 0–540 Ma until a rebuilt candidate is promoted under the Pages budget.

## Intent

Compile every Cao 2024 v2.4 source timestep the application can host: motion over the full authored rotation clock (0–1800 Ma), display checkpoints covering that domain, and native boundary/ownership layers including `1800-1000_plate_boundaries.gpml`. Continuous Precambrian scrub must use real plate motion once the package is promoted.

## Budget

- Pages / policy public foundation cap: **50 MB** (`DIST_MAX_MB`, `policy.json`).
- Current live cao-v2.4 tree: **~37 MB** (109 checkpoints at 5 Ma, 0–540).
- Naïve 5 Ma through 1800 (361 checkpoints) projects **~61 MB** before palette growth — over budget.
- Chosen display schedule (`cao_domain.py` / `caoDisplayCheckpointAgesMa`): **5 Ma to 540 Ma, then 10 Ma to 1800 Ma** → **235 checkpoints**, rough projection **~49 MB** excluding palette growth. Motion still samples every qualified source rotation knot (565 knots in 0–1800).

## Pipeline changes (landed)

- Shared domain helpers: `src/reconstruction/caoDomain.ts`, `scripts/research/cao_domain.py`.
- Emitters read `CAO_SOURCE_OLDEST_MA = 1800` and the budget-aware display schedule.
- Native-layer / foundation topology lists include `1800-1000_plate_boundaries.gpml`.
- Runtime validators accept ages to 1.8 Ga (`motion.ts`, palette already allowed 1800, `packageV2` domain max 1800).

## Remaining rebuild work

1. Re-run foundation emit against EarthHistory-data sources with the new domain (motion qualify 0–1800, lifecycles unclipped to 1800).
2. Emit native boundary/ownership for all 235 display ages.
3. Refresh country/anchor bindings against the extended palette.
4. Measure transitive public bytes; if over 50 MB, lean encoding or widen the coarse step beyond 540 Ma before promotion.
5. Promote into `public/data/reconstruction/cao-v2.4/`, update `ageDomainMa`, CHANGELOG known limitations, and App editorial gating (already package-domain driven once manifest loads).

## Note on Fennoscandia

Open motion-binding gaps such as 118–120 Ma are bridged at runtime from neighbouring compiled endpoints (`resolveChartMotionSegment`). Future package rebuilds also cap adaptive refinement instead of dropping those leaves.
