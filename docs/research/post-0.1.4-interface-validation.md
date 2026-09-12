# Post-0.1.4 interface validation

Status: accepted interface, scientific-asset, browser, visual, and paired
production validation completed on 2026-09-13.

## Scope

This follow-up addresses the interface and map findings reported after 0.1.4:

- the permanent surface-information bar consumed too much of the map,
  especially on a phone;
- the locked-position marker was difficult to see and selecting a lock changed
  the user's zoom;
- the timeline range was difficult to acquire and begin dragging on an iPhone;
- evidence batches made parts of a continent look like different terrain;
- modern Iceland and several ancient shelf areas were absent or hidden.

The surface bar is now a compact, expandable **Map key**. Its collapsed summary
keeps the live, preparing, editorial, or withheld state visible. The expanded
panel uses one display color for all land and material overlays and keeps model
continental shelf context blue. Evidence distinctions remain textual: observed
modern land, source-qualified material, and model-inferred or uncertain
material do not imply different terrain colors. Ancient shelf depth remains
unknown; only the exact-modern Iceland shelf carries the generalized 0–200 m
source class. Elevation is not represented.

The focus marker is a steady 18 px dual-contrast ring and center dot. It has no
pulse or broad halo. The dark outer stroke and pale inner stroke remain legible
against both pale land and dark water while preserving globe occlusion, motion,
withholding, picking, and recovery. Selecting a surface lock changes the aim and
follow target while retaining the current camera distance. Intentional chapter
and place presets keep their own initial framing.

The Cao shelf is displayed on a renderer-only 400 m shell, while native land
and all correction-land batches use 800 m. These values do not represent source
elevation. The measured shells clear coarse chord sag and retain at least about
94.65 m radial separation between the highest shelf vertex and the lowest
native-land triangle interior. Country and boundary lines and focus markers
remain on their existing higher shells.

## Touch acquisition and gesture behavior

Gesture acquisition was the working hypothesis because the control had a small
hit area and no explicit touch-action policy. A Playwright WebKit context used a
390 × 844 CSS pixel viewport, touch input, and an iPhone Safari user-agent
string. This browser emulation established the small target and prompt event
dispatch on the development Mac; it cannot establish the cause or latency on a
physical iPhone.

| Measure | Published 0.1.4 control | Candidate |
| --- | ---: | ---: |
| Computed range hit-area height | 18 px | 48 px |
| Computed `touch-action` | `auto` | `none` |
| Pointer down to `touchstart` | 1 ms | 5 ms |
| Pointer down to native `input` | 1 ms | not emitted; custom pointer path owns the gesture |

The control run delivered a native input event promptly. The final candidate
tap used the custom pointer path: it retained slider value 732.628398791541,
the accessible label **394.7 Ma**, and URL hash `#age=394.7` after pointer up.
These results do not establish that the candidate reduces event-dispatch
latency. The larger hit area makes the control easier to acquire,
`touch-action: none` prevents page-gesture competition during a horizontal
drag, and the local draft keeps the thumb responsive while reconstruction work
is scheduled. Automation-call wall times are excluded because they include
driver and page-settle overhead.

The range maps pointer positions across the actual 19 px native-thumb center
travel rather than the full input rectangle. It preserves the pointer's grab
offset while inside the thumb, rejects a non-primary or second touch, updates
the thumb and age label immediately, and forwards every accepted position to
the existing age-change path. Native range writes during the custom touch
path are reset to the live draft so a browser's full-track interpretation
cannot move the thumb. Pointer up publishes the final value; cancellation or
lost capture publishes the last accepted value before releasing the draft.
Keyboard, chapter, and other external age changes use the controlled value when
no touch is active.

The final production WebKit endpoint check retained both native thumb centers:
the young endpoint remained slider value 0 / **Today** with URL age 0, and the
old endpoint remained slider value 1000 / **538.8 Ma** with URL age 538.8. The
trace is retained at
`/tmp/earthhistory-post014-fixes/ui/touch-production-final.json` in the bounded
post-0.1.4 scratch set.

## Validation

The final `make gate-full` run passed the full source and application union:

- correction, Iceland, Barents, six-chart shelf-lifecycle, motion, package,
  shell-clearance, doctrine, and artifact validators passed;
- TypeScript passed;
- 30 unit/data files passed 123 tests;
- the production build contained 1,187 verified artifacts and measured
  41.63 MiB against the 50 MiB limit;
- all 22 browser cases passed in 6.8 minutes.

The browser corpus includes exact correction boundaries, continuous retarget,
failed-checkpoint withholding and recovery, stale-request rejection, exact
modern evidence, touch lifecycle and endpoints, compact mobile containment,
material-lock reacquisition, and scrubbing back to today. Global and regional
lock cases preserve camera distance through selection, age changes, later user
zoom, and unlock.

A projected-marker diagnostic now reports the focus marker's CSS-pixel offset
from the view center. The real lock case waits for finite published values and
requires magnitude at most 1 px. A deliberate return to the old world-space
marker assignment failed at 51.21 px; removing the diagnostic failed closed at
infinity. The restored case passed. A separate non-identity quaternion unit
proves the world-to-globe-local round trip; directly returning the world vector
failed that test. Mutation logs are retained under
`/tmp/earthhistory-post014-fixes/ui/marker-*-mutation*.log`.

### Superseded validation history

Earlier results remain diagnostic history and are not the acceptance result:

1. One pre-refinement gate reached artifact validation and rejected stale outer
   manifest identities. The atomic post-compose index refresh corrected the
   defect; no checksum was bypassed and no browser test ran in that attempt.
2. A later 21-case browser run was intentionally stopped after 4 cases when
   review requested the finer same-source Iceland coastline. It had no observed
   failure before interruption.
3. A pre-shelf browser run completed 19/21. Its two failures were test-only: one
   boundary case exhausted its timeout after redundant reloads, and one
   same-document hash change did not remount the initial age. Using the existing
   continuous input path retained the exact 410.0000001 and 430.0000001 Ma
   probes and passed both focused cases. This result was superseded by the final
   123+22 gate above.

## Frozen package identity

The final package and source-derived display inventory are:

- outer data index: `4c361de2b337c1a0dd315614cc8450f3260d918ac3b45da0a9a448077ed47bb2`;
- Cao package manifest: `0dd831e5ecc04a719a782e3e21937275c8293ab539d15738bdd8a0e1cc1df3e5`;
- Cao core: `14c33ff9dc79feea337811f1e21c771765adb46857984d3ae2adc2545531bda8`;
- shelf batch: `2f0d65b1cadd33cd0cede876fe4d70bacaea3d5659f12c0c68ac6905913b0077`;
- motion-palette JSON: `bacde9c52c9fd755fb208d4cabef38537bb2f6e6eff7a01b4a30c9d371460e21`;
- motion-palette binary: `17195d05d09864c6385feeaa0d73a965aca2fea0627271d5602954bc9ae6b2f7`;
- material catalog: `9fb715d2f5eee35fc3008ea409cf3e85aad0f4794e67d152171d895d62c0768a`;
- 361,829 spatial vertices and 521,541 triangles, plus 20,028 modern-country
  reference vertices / 10,014 segments.

At exactly 0 Ma, two observed Iceland land charts and two classified
shallow-marine Iceland charts are active. Both counts are zero at every age
greater than zero. Newly supported ancient shelf intervals use their accepted
Cao source lifecycles through 600 Ma; their new motion spans remain below the
existing `1e-5` radian source-oracle limit. The separate material-correction
masks remain bounded to their declared lifecycles, no older than 540 Ma.

## Visual checks

The 390 × 844 layout replaces the former multi-line footer with a 44 px
collapsed Map key at the map edge. Expanding it opens a bounded panel above the
control and leaves the timeline unobscured. The same control remains compact on
desktop. A failed Cao checkpoint remains visible as **Surface withheld** in the
collapsed summary; detailed evidence remains available after expansion.

Matched-camera captures were reviewed for the refined 1:50m Iceland outline at
0 Ma on desktop and mobile, the partial inferred Iceland material at 0.001 Ma,
the repaired Barents continental-outline shelf at 422 Ma, and mixed native and
correction land at 411 Ma. They confirmed a recognizable modern Iceland coast,
source-classified modern shelf context, recovered ancient blue shelf context,
and one land display color across evidence batches under normal lighting. The
Barents shelf remains model outline context with unknown ancient water depth,
not a palaeoshoreline claim. The capture set and its diagnostics are retained
at:

- `/tmp/earthhistory-post014-fixes/ui/candidate-iceland-0.png`;
- `/tmp/earthhistory-post014-fixes/ui/candidate-iceland-0-mobile.png`;
- `/tmp/earthhistory-post014-fixes/ui/candidate-iceland-0-map-key.png`;
- `/tmp/earthhistory-post014-fixes/ui/candidate-iceland-0.001.png`;
- `/tmp/earthhistory-post014-fixes/ui/candidate-barents-422.png`;
- `/tmp/earthhistory-post014-fixes/ui/candidate-uniform-land-411.png`;
- `/tmp/earthhistory-post014-fixes/ui/science-capture-diagnostics.json`.

The final real lock capture selected the current plate-302 Timan uncertain
material at 430.0000001 Ma. Camera distance was 1.8200 before and after
selection, the lock settled in 1.857 seconds, and the 18 px ring-and-dot marker
reported exactly 0 px projected offset from canvas center (907.2, 402 CSS px).
The lock was resolved and no page or console error occurred. Evidence is at
`/tmp/earthhistory-post014-fixes/ui/candidate-material-lock-settled.png` and
`.json`. The older `candidate-gray-material-locked` image is retained only as
contrast and failure-analysis history: its helper wheeled before the focus
orientation settled and could not prove XY centering. The first fully settled
pre-fix view placed the marker about 156 px below center, which reproduced the
world/local coordinate defect fixed by the final build.

## Production performance

The immutable published 0.1.4 distribution was compared with the final
candidate on the same Apple M4 host in headed Chrome 152 / WebGPU. The tracked
comparator is `scripts/research/compare_production_performance.mjs`, SHA-256
`fb6e4c441c7ca2c34f6122a02d5c195544596e607dfec84352b700780d2d157c`.
The full emitted record is
[`post-0.1.4-interface-performance.json`](post-0.1.4-interface-performance.json),
SHA-256 `3007156b7b2ef6c0d468d7815d2df952c36b698c81298d24395bb49a6e6c9989`.

Five alternating control/candidate pairs covered fixed 0 Ma and 411 Ma views,
plus a two-second continuous 410–412 Ma scrub in every pair. Every one of the
20 fixed rows and 10 scrub rows was finite, visible, focused, WebGPU, ready or
validly updating, and bound to the same resolved material address. The shared
North Atlantic control used the 0–1800 Ma Cao chart
`cao-continent:GPlates-d82088ea-8bb9-4ecf-9a55-f26f46c0865a:104:0`, cell 0,
with reference direction
`[0.339243001653689, -0.3566020894507446, 0.8704878721891295]` and initial
Cao-frame view `[-42, 72]`. Baseline and candidate cameras matched exactly.

| Measure | Published 0.1.4 | Final candidate | Candidate/control |
| --- | ---: | ---: | ---: |
| 0 Ma median cold ready | 306.0 ms | 321.7 ms | +15.7 ms |
| 0 Ma settled cadence | 59.985 fps | 59.973 fps | 99.980% |
| 411 Ma median cold ready | 297.2 ms | 301.4 ms | +4.2 ms |
| 411 Ma settled cadence | 59.979 fps | 59.967 fps | 99.980% |
| Continuous 410–412 Ma cadence | 53.863 fps | 53.076 fps | 98.539% |
| Continuous scrub frame-time p50 | — | 16.7 ms | pass |

The candidate kept one geometry identity and one inventory throughout every
continuous scrub sample: 5 batches, 361,829 vertices, 521,541 triangles, 20,028
country vertices, and 10,014 country segments. The control remained at its own
stable 4-batch, 322,442-vertex, 486,333-triangle inventory. No page or console
error was recorded.

The predeclared stop rules rejected added median cold-ready time above the
greater of 250 ms or 20% of control, candidate cadence below 90% of control,
candidate p50 above 33.33 ms, invalid sample/backend/visibility/lock/framing
state, and candidate geometry or inventory churn during scrub. The final run
passed every rule.

Three prior attempts are preserved in the emitted record:

- an Iceland control was stopped before measurement because published 0.1.4
  has no material at that modern anchor: 0 samples;
- the first regional discovery selected a chart whose lifecycle ends at 410 Ma
  and was stopped before measurement: 0 samples;
- the first complete 20+10-row run passed ready, cadence, row validity, and
  geometry checks but failed the unchanged 0.05° scrub-framing limit at 0.052°.
  Its median ready deltas were +21.2 ms and -12.2 ms, fixed cadence ratios were
  99.990% and 99.985%, scrub cadence was 98.738% of control, and candidate scrub
  p50 was 16.7 ms. The record is retained at
  `/tmp/earthhistory-post014-fixes/ui/production-performance-failed-unsettled-camera.json`,
  SHA-256 `f7415226fb066395de0e63b430bea8b159af90f67af5ae4b382ee4f77ed536ec`.
  Its final snapshot preceded completion of the focus-camera transition. The
  corrected protocol waits, outside the measured two-second window and with a
  finite five-second timeout, for the already verified 412 Ma target within
  0.005° before recording final framing. The 0.05° acceptance threshold and all
  measured windows remained unchanged.

The historical Apple M4 reference of 586 ms cold-ready and 16.7 ms frame-time
p50 remains context only; the paired final run above is the acceptance evidence.
