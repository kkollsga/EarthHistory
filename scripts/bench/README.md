# Benchmark and data-validation harnesses

Hand-authored measurement programs for the application and its scientific
assets. They are run from the repository root and resolve their own repository
root from `__file__` / `import.meta.url`; none of them is part of `make gate`.

## Harness location

These harnesses moved here from `dev-docs/bench/scripts/` on 2026-09-15, when
`dev-docs/` became fully gitignored: a tracked program is source and belongs
with the source. Research records and benchmark results written before that
date cite the previous path; those historical citations are left as written.

Their outputs still land in the gitignored working tree — small comparable
metrics in `dev-docs/bench/results/`, heavy captures in `dev-docs/bench/out/`,
scratch in `dev-docs/temp/` — under the `DEV_DOCS_MAX_MB` bound that
`make check-dev-docs` enforces.

## Contents

| Harness | Needs | Measures |
|---|---|---|
| `browser-render-benchmark.mjs` | Playwright + a served `dist/` | Production render timing, memory, and capture set. |
| `capture-historical-periods.mjs` | Playwright + a served `dist/` | Five bounded historical-period JPEG captures. |
| `capture-modern-landscapes.mjs` | Playwright + a served `dist/` | Modern-landscape visual checkpoint. |
| `capture-visual-checkpoints.mjs` | Playwright + a served `dist/` | Named visual checkpoint PNGs. |
| `regional-material-release.mjs` | Playwright + a built `dist/` | Regional material-correction release comparison. |
| `scrub-scheduling-benchmark.mjs` | Playwright + a gzip server for one `dist/` | Mobile scrub scheduling cadence and request timing. |
| `palaeo_reclaim_catalogs.py` | `public/data` only | Recoverable bytes in the Cao v2.4 boundary catalogs. |
| `palaeo_reclaim_core_intern.py` | `public/data` only | Recoverable bytes in `core.json` by interning. |
| `palaeo_reclaim_dist_inventory.py` | `public/data` only | Per-class byte inventory of the shipped reconstruction. |
| `palaeo_reclaim_motion_cover.py` | `public/data` only | Motion-tile versus motion-palette coverage. |
