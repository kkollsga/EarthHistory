# Resident intervals — M2 acceptance measurement

Measured 2026-09-17 04:31–05:25 local on one machine in one session.
NEW = `codex/resident-intervals` at 9933bfc; OLD = the v0.1.20 tag (81546c9)
built in a detached worktree from the same checkout and driven by the **same**
harness file, so the two arms differ only in application code. Stop rule: the
table written before measuring in `dev-docs/plans/resident-intervals.md`.
Record: `resident-intervals-acceptance.json` beside this file.

## Machine state (R11)

Mac mini, Apple M4, 10 cores (4P/6E), 16 GB. macOS darwin 25.6.0 arm64.
Swap was **17.93 GB used of 19.46 GB** for the whole session — the machine was
already paging. One-minute load average: 1.4 at start, 8.4–9.6 immediately
after the browser suites, 2.1–5.1 across the bench arms. Both arms ran
back-to-back under that same state, so the comparison holds even where the
absolute numbers are inflated against the dated 2026-09-15 anchors.

## Transactions and residency — NEW vs OLD (p50 of 3)

| stop rule | measure | OLD v0.1.20 | NEW | threshold | verdict |
|---|---|---|---|---|---|
| 1 | crossing 94→80 Ma, warm | 179.3 ms | **185.9 ms** | ≤ 20 ms desktop / ≤ 60 ms low | **MISS** (185.9 vs 20) |
| — | crossing 94→80 Ma, cold | 156.7 ms | 157.9 ms | ≤ 1500 ms (harness) | pass |
| 2 | fast scrub 117→58 Ma, longest frame | 133.3 ms | **83.2 ms** | ≤ 33 ms | **MISS** (83.2 vs 33) |
| 2 | frames ≥ 100 ms (3 reps) | 3 of 3 reps | **0** | — | improved |
| 2 | frames > 33 ms (per rep) | 41 / 40 / 41 | 46 / 46 / 45 | — | no change |
| 3 | foundation-ready, 0 Ma | 5388 ms | 5362 ms | ≤ +10 % | **pass** (−0.5 %) |
| 3 | foundation-ready, 90 Ma | 7922 ms | 7963 ms | ≤ +10 % | **pass** (+0.5 %) |
| 3 | first contentful paint, 0 / 90 Ma | 88 / 88 ms | 88 / 88 ms | ≤ +10 % | **pass** |
| 4 | toggle-on at 90 Ma | 524.1 ms | 532.4 ms | ≤ 600 ms | **pass** |
| 5 | JS heap growth after warm-up | 41.6 MB | **95.2 MB** | ≤ 60 MB | **MISS** (95.2 vs 60) |
| 6 | GPU bytes at 90 Ma after warm-up | 11.4 MB | 54.4 MB | ≤ 55 MB desktop | **pass** (0.6 MB margin) |
| 7 | palaeo bytes fetched with layer off | 0 | 0 | 0 | **pass** |
| 7 | browser errors | **3** | **0** | 0 | **pass** (OLD fails) |

Fast scrub, three repetitions: OLD 133.3 / 116.7 / 133.3 ms; NEW 83.2 / 66.7 /
83.3 ms. In every OLD repetition the globe was **unmounted** at the end of the
scrub with `Error: palaeo-coastline age is outside the resident interval`; in
every NEW repetition the globe stayed mounted with no error. Both arms crossed
the same three intervals (117-94, 94-81, 81-58) with 2 publishes.

## Steady state — NEW (rows 7, 8)

`rAF` interval, 5 s after a 2.5 s settle, 3 alternated repetitions per arm.

| profile | age | OFF p50/p95 | ON p50/p95 | ON/OFF | triangles |
|---|---|---|---|---|---|
| default | 0 Ma | 1.9 / 2.6 | 1.9 / 2.6 | 1.00 | 0 |
| default | 90 Ma | 1.9 / 2.5 | 1.9 / 2.5 | 1.00 | 432 362 |
| default | 250 Ma | 2.5 / 3.9 | 2.3 / 3.8 | 0.92 | 330 736 |
| default | 21 ka | 2.3 / 3.2 | 2.4 / 3.2 | 1.04 | 18 041 |
| low | 0 Ma | 1.6 / 2.2 | 1.5 / 2.2 | 0.94 | 0 |
| low | 90 Ma | 1.4 / 2.0 | 1.4 / 2.1 | 1.00 | 432 362 |
| low | 250 Ma | 2.0 / 3.2 | 1.7 / 2.9 | 0.85 | 330 736 |
| low | 21 ka | 1.9 / 2.6 | 1.9 / 2.6 | 1.00 | 18 041 |

Row 8 (ON/OFF ≤ 1.1): **pass**, worst 1.04. The dated 2026-09-15 record reached
1.14–1.15 at 90 and 250 Ma, so the ratio improved, but that is a dated
comparison: the OLD arm was run `--transactions-only` to fit the session
budget, so there is **no same-session OLD steady state**. The harness's own
`offRegression` check fails (OFF p50 1.9 ms default, 1.4–2.0 ms low, against
1.7 / 1.1 ms anchors from 2026-09-14); that is the paging machine state above,
measured identically in both arms, not a layer cost.

## What improved, what still misses

Improved: the v0.1.20 **crash on a fast scrub is gone** (3 unmounted globes →
0), the longest scrub frame fell **133.3 → 83.2 ms (−37.6 %)** and every
≥ 100 ms frame disappeared, first paint and foundation-ready are unchanged,
and the layer still costs nothing when off.

Still missing, with both numbers: a warm interval crossing is **185.9 ms
against 20 ms** and is not better than OLD (179.3 ms) — residency did not turn
a crossing into a visibility switch; the fast-scrub longest frame is
**83.2 ms against 33 ms**; and heap growth after warm-up is **95.2 MB against
60 MB**, up from 41.6 MB on OLD. Rows 1 and 2 are release blockers by the
plan's own terms, and row 5 returns the memory decision to the user. Row 6
passes with 0.6 MB of margin, so any further resident interval crosses it.

The residual cost is where the attribution memo already put it
(`dev-docs/bench/results/resident-intervals-attribution-2026-09-17.md`): the
per-crossing prepared-object rebuild and the React commit tail, plus the
46 frames > 33 ms the native path carries in both arms.

## Next

Do not release on this evidence. Next, as the plan already names: memoise the
age-independent half of the prepared interval and take the React commit off
the publish frame (rows 1–2), and land the CPU-light release of warmed hidden
members with the byte count switched to retained typed bytes (row 5). Re-run
this measurement, with a same-session OLD steady-state arm, before the
release decision returns to the user.
