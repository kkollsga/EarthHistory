# Requested-age progressive loading validation

## Scope and acceptance rule

EarthHistory now loads the motion records needed by the requested URL age
before the complete all-age motion palette. Today is only the default when the
URL does not name an age. The first publication still uses the complete Cao
core, geometry, chart order, correction catalog, checkpoint controls, country
references and anchor catalog, so the transport split does not change the
scientific reconstruction or its picking identities.

The predeclared performance stop required a reproducible cold
navigation-to-visible improvement of at least 20% or 250 ms at 20 Mbit/s with
50 ms latency. Candidate frame cadence must remain at least 90% of the frozen
control and its p50 frame interval must remain at most 33.33 ms. Scientific
equivalence, the 50 MiB static artifact limit, fresh-manifest behavior, and
byte/SHA-256 verification remain hard requirements.

## Publication and background contract

The initial motion evaluator uses one verified 25 Ma `EHMT` window selected by
the raw requested age. Windows are half-open at their older edge except the
final 1775–1800 Ma window. The renderer publishes only after every active
chart binding has the required source records and interpolation brackets. Both
initial publication and continuous retarget report ready only after a rendered
frame.

After the requested frame is visible, the runtime downloads and verifies the
unchanged full motion palette. It verifies the tile's ordered source-record
identity and compares the current tile and full-palette motion frames before
switching evaluators. Geometry is not republished, and the camera, material
address and focus remain unchanged. It then warms each checkpoint asset group
sequentially into the verified HTTP cache without retaining decoded groups in
the two-checkpoint runtime cache. The compact status distinguishes a ready
current age from remaining timeline loading, a completed timeline, and a
paused background failure with explicit Retry.

Revised 2026-09-14 (see `scrub-scheduling-performance-2026-09-14.json`): a
newer foreground age aborts a pending tile only when that tile does not cover
the new age, and never cancels background timeline loading, which is
age-independent. If a new age needs another tile, the previously rendered Cao
surface stays visible and the map key reports both the loading and the shown
age; native exact-age overlays still follow the displayed frame, and the
material address remains tagged for reacquisition. Stale responses cannot
publish, change status, or reserve memory. A background failure leaves the
correct current surface usable and does not retry until requested.
Out-of-domain editorial ages request no motion tile and never flash the 0 Ma
reconstruction. The original 2026-09-13 contract withheld the old surface
during the wait; on phones that produced visible land flashing on every scrub
sample and was withdrawn.

## Artifact identity and bounds

The requested-age index is 28,068 bytes with SHA-256
`8eaaab15d8513dd3569e68be34b9794c6c2103a7f146d7eac8bf7ccdc69ac3a3`.
Its 72 tiles total 5,710,232 bytes, 280,974 copied source records and 11,056
entry descriptors. The authoritative complete palette remains byte-identical.
The promoted Cao package manifest is SHA-256
`031878a8d3737fc28b9e8112f6531d7533d7cf195d6e0d684f081332cbf7eeec`;
the outer data manifest is SHA-256
`a43301d7c6f1350c5b027bae82508d65177fc262075652826dbe4a4396278fc2`.

The measured candidate build contains 1,266 files and 51,594,886 bytes, below
50 MiB. Its `dist/index.html` is SHA-256
`2f7ddc8f3eafd3d39826a179a7c0b8bd6f769893cdcc0604aa6dfd2d6b562749`;
`dist/assets/index-C45NZc1k.js` is SHA-256
`491ed383f25cc6e8c3b1ad6f4c080a9bb099f698dff692f6b015da599b4d8b42`.
After measurement, the paused Retry control received a CSS-only contrast and
44 px touch-target correction. The final build contains 51,595,344 bytes;
`dist/index.html` is SHA-256
`4800775d13fabe81a64aa7379848c106396cb1745279e5dae78f2f38f2c8d6b0`,
`dist/assets/index-BxnH8jGA.css` is
`d0ee399dcc78eeaf9bcce5930b16b4de9be846177e8f7e4ff97153feebddc330`,
and the renamed `dist/assets/index-C_9dVZuK.js` remains byte-identical to the
measured JavaScript SHA-256 above.
The immutable prechange control is
`/tmp/earthhistory-requested-age/baseline`, whose index SHA-256 is
`10e6d3cf73e18487fd41bdb4dd253287687e5977fbae0877712d8a94510567bc`.

## Validation evidence

The source-bound tile validator passed 2,103 critical ages, 6,955,591 selected
chart/segment comparisons and 142,109 adjacent-window comparisons. An
independent decoder checked 999,510 selected subsegments and 523,940 reachable
source-knot probes. This includes exact-present singleton entries, both open
plate-626 source seams, every tile edge and source-knot micro-neighbors. Four
deliberate data mutations were rejected.

Focused runtime checks passed 18/18. They cover raw half-open selection,
noncanonical bounds, active lifecycle and bracketing completeness, foreground
supersession, pending byte reservation, source identity, checkpoint consumers,
and stale background ownership. Delaying the actual 172,916-byte 0 Ma
source-index digest and deleting its post-verification owner check failed as
intended; the restored check passed. Making both touching tile edges inclusive
also failed and was restored. Independent runtime review reran 12/12 Cao tests
and found no publication, lifetime, ledger, picking or outside-domain blocker.

The focused browser result is composed from the two passing cases in a 2/3 run
plus a corrected 1/1 run. They verify fresh manifest loading with immutable
payload reuse, requested
411 Ma publication before the full-palette request, a successful Retry through
the full-palette identity switch, and 0→411 withholding while a newer tile is
held. The reverse-age fixture first compared a slider-derived floating value as
an exact string, then briefly used a helper that waited for the deliberately
held frame. Neither failure indicated a product defect and neither was counted
as a pass. The final direct input dispatch retained the pending tile, compared
its age numerically, and passed.

## Production performance

The compact machine-readable record is
[`cao-requested-age-motion-tiles-performance.json`](cao-requested-age-motion-tiles-performance.json),
SHA-256
`0f7b686f5f69b1f3427f2d654c835918e361d739c9f3f392bcb74080902f320f`.
It compares the frozen prechange and measured candidate production builds in
Chrome 152.0.7977.83 on an Apple M4 under 20 Mbit/s download, 10 Mbit/s upload
and 50 ms latency. Each age has three cold and three warm observations with the
page visible and focused.

| Requested age | Control median | Candidate median | Improvement |
| ---: | ---: | ---: | ---: |
| 0 Ma | 5,749.1 ms | 4,665.0 ms | 1,084.1 ms / 18.86% |
| 74 Ma | 5,766.3 ms | 4,673.1 ms | 1,093.2 ms / 18.96% |
| 411 Ma | 5,739.2 ms | 4,589.2 ms | 1,150.0 ms / 20.04% |
| 1800 Ma | 5,647.6 ms | 4,512.0 ms | 1,135.6 ms / 20.11% |

Every age clears the 250 ms acceptance threshold. Warm refresh remains about
0.56–0.62 seconds; the candidate adds 39.8–47.6 ms because it verifies an index
and one tile while retaining immutable-cache behavior. The full palette starts
2.4–3.1 ms after the first ready frame. Its 3,018,235-byte transfer takes about
1.27 seconds, and the verified evaluator handoff completes about 1.37–1.39
seconds after first ready.

Frame cadence during bounded background loading is 59.88 Hz for both builds at
all four ages, with a 16.7 ms candidate p50. After the full timeline completes,
both record 120 frames at 59.88 Hz; the candidate-to-control cadence ratio is
1.0000. Baseline and candidate static counts, rendered counts and material
picks match at 0, 74, 411 and 1800 Ma. A direct 2000 Ma request publishes the
unsupported editorial state and starts no tile or full-palette request.

The raw primary record is retained verbatim with `reportedPass: false`. Its two
false predicates came from sampling empty ocean in the original 411/1800
regional framing and from treating metadata/static fetches as forbidden for an
out-of-domain request. Scoped full-globe picks and motion-payload fetch-start
evidence correct those premises without rewriting the raw run. The final
decision is pass.

## Final browser and visual result

`make gate-full` completed doctrine synchronization, typecheck, 32 unit/data
files with 144 tests, the production build, and verification of 1,260 data
files at 49.20 MiB. Its browser phase passed 27/28. The only failure expected a
superseded 450 Ma checkpoint request to record an error; immediate foreground
prioritization now cancels it cleanly. The corrected test requires no stale
error, a ready 445 Ma foreground, the same geometry identity and no unavailable
surface message, and passed 1/1 against the unchanged JavaScript and data. The
composed final browser result is 28/28; the full command itself exited 2 and is
not reported as a complete pass.

The paired production captures in the performance record show matching
baseline/candidate geography at 0, 74, 411 and 1800 Ma. On mobile, the first
ready 74 Ma frame reports requested age 74, displayed age 74, foreground ready,
requested-age motion and timeline loading. A forced full-palette failure keeps
that same frame ready and exposes the paused state with Retry. The final Retry
button measures 60.66 by 44 CSS px and uses the existing ink/copper theme.
Those captures are preserved at
`/tmp/earthhistory-requested-age/loading/mobile-74-first-ready-timeline-loading.png`
and
`/tmp/earthhistory-requested-age/loading/mobile-74-timeline-paused-retry-final.png`.
