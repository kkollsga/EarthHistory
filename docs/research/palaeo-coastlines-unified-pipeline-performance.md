# Unified palaeo pipeline — runtime performance (P6)

Measured 2026-09-16T20:15Z on `codex/unify-p4p5` at `8dedd5d` with
`scripts/bench/palaeo-coastlines-performance.mjs`, judged against the stop rule
`dev-docs/bench/results/palaeo-coastlines-performance-stop-rule.md` written
before the first run (R13). Records sit beside this memo (`…-performance.json`,
`…-d1.json`); the baseline column is the pre-P5 run of 2026-09-15T21:38Z, same
script, method, machine. Nothing was tuned, re-run or regenerated.
## Headline: steady state regressed 19–78 %, and so did the control

Threshold 1 **fails on both profiles** — default OFF p50 1.9 ms against the
1.7 ms anchor (+0.2 ms), low quality 1.6 ms against 1.1 ms (+0.5 ms), allowance
0.1 ms. Every steady-state cell is >10 % above its baseline; per the stop rule
this blocks the phase and returns to the coordinator un-tuned.

The counter-evidence is stated, not used to dismiss the miss: **the OFF arm
regressed by the same amount as ON at every age on both profiles**, and OFF is
the control, with the layer absent and no P5 code path entered. Swap in use was
4.0 GiB then and is **14.0 GiB now** (total 5 → 15 GiB), so machine state is the
leading hypothesis for the absolute shift — but no same-day A/B of the two
commits was run, so that attribution is unestablished (R11/R13). The ON/OFF
ratio cancels machine load, and improved at every age where it was above 1.
## Steady state, p50 / p95 ms (before → after), median of 3 alternated reps

| profile / age | OFF p50 | OFF p95 | ON p50 | ON p95 | ON/OFF |
|---|---|---|---|---|---|
| default / 0 Ma | 1.5 → 1.9 | 2.0 → 2.6 | 1.5 → 1.9 | 2.1 → 2.6 | 1.00 → 1.00 |
| default / 90 Ma | 1.4 → 1.9 | 1.9 → 2.5 | 1.6 → 1.9 | 2.1 → 2.5 | 1.14 → **1.00** |
| default / 250 Ma | 2.0 → 2.5 | 3.1 → 3.9 | 2.2 → 2.3 | 3.5 → 3.8 | 1.10 → **0.92** |
| default / 21 ka | 1.9 → 2.3 | 2.5 → 3.2 | 1.9 → 2.4 | 2.5 → 3.2 | 1.00 → 1.04 |
| lowQuality / 0 Ma | 0.9 → 1.5 | 1.3 → 2.2 | 0.9 → 1.6 | 1.3 → 2.2 | 1.00 → 1.07 |
| lowQuality / 90 Ma | 0.9 → 1.4 | 1.3 → 2.0 | 1.0 → 1.4 | 1.4 → 2.0 | 1.11 → **1.00** |
| lowQuality / 250 Ma | 1.3 → 2.0 | 2.2 → 3.2 | 1.5 → 1.7 | 2.6 → 3.0 | 1.15 → **0.85** |
| lowQuality / 21 ka | 1.2 → 1.9 | 1.8 → 2.7 | 1.2 → 1.9 | 1.8 → 2.7 | 1.00 → 1.00 |

## Transactions (median of 3) and thresholds

| # | measure | before | after | verdict |
|---|---|---|---|---|
| 1 | OFF p50 vs anchor | 1.5 / 0.9 | 1.9 / 1.6 | **fail** (+0.2, +0.5 ms) |
| 2 | ON/OFF ratio | — | ≤ 1.07 | pass, zero misses |
| 3 | crossing 94→80 Ma warm | timed out at 60 s | **191 ms** | pass (≤ 250 ms) |
| 3 | crossing 94→80 Ma cold | timed out at 60 s | **157 ms** | pass (≤ 1.5 s) |
| 4 | toggle on at 90 Ma | 819.5 ms (a miss) | **524.7 ms** | pass (≤ 600 ms) |
| 5 | palaeo bytes when off | 0 | **0** | pass |
| 6 | browser errors | 0 | **0** (also 0 in D1) | pass |

Overall `verdict.pass: false`, on threshold 1 alone; `cappedRows: 0`, so the
metric still discriminates. Both crossings were *unmeasured* in the baseline
(the driver expired), so those rows are a repair, not a speed-up; the toggle is
a genuine −36 % that converts a baseline miss into a pass.
## D1: retained static bytes and re-upload cost

Retained static (GPU) bytes are **39 956 632 at `#age=90` and 39 956 632 at
`#age=0`** — identical, difference 0, layer on in both: at 90 Ma composed
(`mode=on`, interval 94-81, 432 362 palaeo triangles), at 0 Ma in fallback (0
palaeo triangles). Foundation triangles (574 075), batches (6) and pending
retirement bytes (0) are age-invariant too. Scrubbing 90 → 0 Ma to
`data-cao-foundation-status="ready"` takes **225.0 / 229.8 / 231.0 ms** over 3
repetitions; the trace shows `ready → updating → ready` in ~170 ms with
`caoFoundationStaticBytes` constant at every sample, so that is CPU-side
recomposition, not a GPU re-upload. Against the pre-P5 toggle sample retained
static bytes rose 30 595 912 → 39 956 632 (**+30.6 %**), age-independent.
## Also regressed: fetched payload per interval

90 Ma 431 850 → 686 652 bytes (+59 %); 250 Ma 312 426 → 560 854 (+80 %); 21 ka
126 044 → 373 416 (**+196 %**), while triangle counts barely moved (427 315 →
432 362; 326 809 → 330 736; 18 074 → 18 041) — substantially more bytes for the
same geometry. No threshold covers it; it is the largest unexplained delta.

## Machine state (R11)

Mac mini (Mac16,10), Apple M4, 10 cores, 16 GiB, macOS 25.6.0 arm64. Production
`dist/` served by `tests/browser/server.mjs` at the Pages subpath, Chrome via
`channel: "chrome"`. One-minute load across the 48 samples: min 1.91, max 2.96,
mean 2.80 (baseline 2.89); free memory 0.57–2.28 GiB; swap 14 013 of 15 360 MiB
in use; 15 of 48 samples waited for the load gate, against 37 of 48 in the
baseline. The machine was confirmed free of Playwright, `scripts/research`
validators and vitest for two checks 30 s apart before the run, and a contention
monitor armed for the whole run fired no event.

## Correction, 2026-09-16: the per-interval byte rise was accounting, not I/O

The `caoPalaeoAssetBytes` rise reported above (90 Ma 431,850 → 686,652; 250 Ma
312,426 → 560,854; 21 ka 126,044 → 373,416, all at unchanged triangle counts) is
not re-fetching. A request log over the built dist on port 4400, loading
`#age=90` with the layer on and scrubbing to 80 and 250 Ma through the
application's own age control, records every palaeo URL exactly once: the three
class catalogs, `outline-tones.ehpt`, and three `.ehpr` payloads for each drawn
and each prefetched neighbour interval (94-81, its neighbours 117-94 and 81-58,
then 269-248 with 285-269 and 248-224). No catalog, tone table or payload is
requested twice, which `palaeoIntervalV2.test.ts` also proves at the unit level.

The diagnostic adds the once-per-enablement outline tone payload to the drawn
interval's payload bytes, and that payload grew 75,332 → 319,082 bytes at
`be56995` when the Natural Earth 1:50m country outlines replaced the 1:110m set.
Every figure resolves to the byte: 367,570 + 319,082 = 686,652,
241,772 + 319,082 = 560,854, 54,334 + 319,082 = 373,416, and at the baseline
commit `49ccb43`, 356,518 + 75,332 = 431,850, 237,094 + 75,332 = 312,426,
50,712 + 75,332 = 126,044. The real per-interval payload change over the same
span is +3.1 % (90 Ma), +2.0 % (250 Ma) and +7.1 % (21 ka), from the despike and
recompile commits. The runtime ledger now carries the tone bytes once as
`palaeo.outlineToneSourceBytes`; splitting the renderer's dataset key into the
drawn interval's payload bytes and a separate resident-bytes key is the
remaining half of the repair.
