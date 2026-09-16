# Changelog

All notable changes to EarthHistory will be recorded here.

## [Unreleased]

## [0.1.19] - 2026-09-16

### Added

- **The palaeogeography layer is exportable as a citable dataset.**
  `make dataset` writes `earth-history-palaeogeography-2026.1.tar.gz` and its
  `.sha256` sidecar from the promoted public tree and the tracked contracts. The
  archive holds the 75 EHPR payloads, the three class catalogs, the
  country-outline tone tables, the restored-margin correction with the batch and
  catalog rows it ships as, every basin edit contract, the override table, the
  simplification budget and the LGM contract, plus a dataset `manifest.json`
  (the 75 batch records copied from the package manifest, the class catalog
  index, the reservation, the schedule and a digest per member), a `README.md`
  specifying the EHPR v1 rings, the batch record, the class semantics
  ("maximum transgression per interval, class not depth"), the detached LGM
  state and its non-Cao ETOPO origin, the hard dependency on the Cao 2024 v2.4
  rotation model and the present-day WGS84 frame, and how a consumer poses a
  piece, a `CITATION.cff`, a `PROVENANCE.json` naming every input with its
  version, digest and retrieval date alongside the EarthHistory modifications by
  type with counts, and a `LICENSE.md` placing the compilation under CC BY 4.0
  with each source's own terms reproduced verbatim from
  `THIRD_PARTY_NOTICES.md`. The exporter recompiles nothing and re-hashes every
  payload against the digest the package manifest already publishes, so a
  shipped payload that disagrees with its published digest, a batch-record count
  that is not 3 classes x 25 map states, a scientific reference that resolves in
  neither `src/data/sources.ts` nor its own complete citation, licence text that
  has drifted from the notices, and a redistributed input whose licence a CC BY
  4.0 compilation cannot carry are each a refused export rather than a published
  archive. `make check-dataset` proves the first three gates fail on a
  deliberate mutation and runs in the `gate-fast` loop at 0.2 s;
  `--verify <archive>` re-hashes every member of a written archive, and
  `make clean-dataset` owns the bounded output tier.

### Changed

- **Realistic coastlines ship in the Cao 2024 package structure.** The package
  manifest now publishes the Cao 2017 palaeogeography as **75 spatial batch
  records** (3 classes x 25 intervals) under `palaeoCoastlines.realisticBatches`,
  in the same record shape the native `core.json` spatial batches use: an id, the
  declared appearance, the map interval, a verified geometry asset, an encoding
  and the interned chart-record columns. The one declared difference from a
  native batch is `encoding: "ehpr-v1-i16lonlat-rings"` - rings triangulated in
  the browser worker - because pre-triangulated per-interval geometry measured
  45-96 MiB against a 50 MiB bundle. Both halves are now checked by the same
  record validator, extended with the EHPR byte layout and the interval fields, so
  a wrong digest, an unknown encoding, or a chart count that no longer implies the
  payload's byte count is rejected before a fetch. `loadVerifiedPalaeoInterval`
  resolves an interval through the batch records and refuses a record that
  disagrees with the class catalog it re-shapes. The `.ehpr` payloads are
  byte-identical - this re-shapes the published structure, it recompiles no
  geometry - and the class catalogs still ship and still own the interned tables.
  The manifest grows from 41,538 to 76,685 bytes; the palaeo layer stays at
  8.191 MiB against its 8.5 MiB budget.
- **One polyline helper owns the country outline.** The modern-country
  reference overlay's whole line path — decoding the EHGL line batch into the
  screen-space quad geometry (four corners and two triangles per segment, 200
  bytes each), the two-tone `mix(darkInk, lightInk, toneMix)` ink with its EHPT
  tone-table upload and change comparison, the vertex and fragment horizon
  terms, the shell and the one-CSS-pixel core — moves out of
  `caoFoundation.ts` into `src/render/reconstruction/polyline.ts`, behind
  `createPolylineBatch` (and the two halves `createPolylineQuadGeometry` /
  `createPolylineMaterial` the renderer calls at its own two lifetimes). Shell,
  ink and width are inputs rather than country constants, and the pose is
  injected, so the helper carries no reconstruction state. No rendered output
  changes: the country overlay keeps its 1 800 m shell, its inks and its
  1 CSS px width, and `caoFoundation.ts` re-exports the existing
  `CAO_FOUNDATION_COUNTRY_LINE_*` names as aliases of the helper's. The
  plate-boundary lines (`boundary-*.ehnb`, 2 200 m) are **not** migrated; the
  helper is meant to take them next.

## [0.1.18] - 2026-09-16

### Changed

- **Modern-country outlines from Natural Earth 1:50m.** The reference overlay
  is rebuilt from the 1:50m Admin 0 archive (version 5.1.1, the same pinned
  archive the Iceland, Panama and observed-land corrections already use),
  Douglas-Peucker pre-simplified at **0.02 degrees** before the one-degree
  subdivision that binds it. 1:110m was dropped because its 289 rings omit the
  island and fjord detail the overlay is read for. The batch grows from 12,045
  to **51,048 segments** (47,468 bound outline segments plus a 3,580-segment
  exact-present complement, of which the shared-endpoint bridge rebinds 2,523
  and 1,057 stay on the exact-present identity), and `country-reference.ehgl`
  from 481,832 to **2,041,920 bytes**. Thirteen United States segments on plate
  1731 are dropped rather than carried onto the western-Laurentia replacement
  domain at reconstructed ages; they remain in the 0 Ma locator complement.
  Renderer reservation rises from 520,000/660,000 to **680,000/740,000**
  vertices/triangles: probed on the loaded package, the surface holds 404,888
  vertices and 574,075 triangles and the country quads add 204,192 and 102,096,
  preflighting at 609,080 and 676,171. Projected `dist` is **45.17 MiB** of the
  50 MiB ceiling, up 1.62 MiB. The outline motion precedence now binds
  `native-recovery-*` entries exactly like `restoration-*` — a chart on a
  recovered plate follows its recovery entry, never the plate's baseline motion,
  and the declared sub-microsecond rotation seams inside the recovery windows
  stay `motionSupportGaps` instead of becoming baseline tiles. The finer source
  resolves 15 country charts on the recovered plates where 1:110m resolved 10,
  so the native-triangulation contract's rebound-consumer count moves 314 → 319.
  The country charts are re-appended at the core tail, so the emitter carries
  `batch-land.ehgb` and `batch-shelf.ehgb` vertex chart indices through the
  rebuild (33,841 and 2,348 rewritten) and re-records both batch identities, and
  the material-correction catalog is re-emitted against the rebuilt core.


## [0.1.17] - 2026-09-16

### Changed

- One surface-source preparation path for native and realistic classes (no
  visual change).
- One surface-visibility resolver for native and realistic classes (no visual
  change).

## [0.1.16] - 2026-09-16

### Fixed

- **The LGM exposed shelf now complements the coast the app actually draws.**
  At 21 ka, closest zoom over the North Sea, teal needle-shaped shards stood
  over Doggerland and the coasts around it. They were the native `shelf` class
  of the 0 Ma composition showing through holes in the exposed-shelf polygon,
  and they sat exactly on modern estuaries, firths, fjords and belt seas — the
  Solway, Clyde, Tay, Humber, Morecambe Bay, the Tyne, the Ems and Dollart, the
  Schlei, Kiel Fjord, Vejle, the Limfjord, the Great Belt and the North Frisian
  Wadden. The derivation subtracted Natural Earth 1:50m land from the −120 m
  ETOPO mask, and Natural Earth generalises those inlets as land where the
  drawn Cao coast has water, so the mask had a hole wherever the land fill had
  none. The subtraction now uses the present-day land the application draws —
  the emitted Cao v2.4 `shapes_coasts` charts at 0 Ma plus the observed-land
  omission correction — so the shelf is that land's exact complement above the
  datum. The 1.5 km erosion and the −120 m depth test are unchanged, so the
  shelf still laps over the drawn coast and the Norwegian Channel, Devil's
  Hole, the Silver Pit and the deep fjords stay water. Across the thirteen
  named inlets the shelf holes inside drawn water fall from **34 (751.7 km²)**
  to **3 (5.4 km²)**; the shipped exposed shelf moves North Sea +1.544 %, Sunda
  −0.180 %, Beringia +0.606 %. Two new witnesses pin it: the inner Humber
  (−0.709, 53.653) is land at the lowstand and Devil's Hole (0.7, 56.6) is not.
  `palaeo_coastlines_compile.py --intervals lgm` no longer divides by zero on a
  class the LGM interval does not populate.
- **The runtime validator reads every exterior ring of a piece.** An EHPR piece
  carries a sequence of polygons — each ring without the hole bit opens a new
  exterior — but `point_in_payload` read only the first one, so a witness inside
  any later polygon of a multi-polygon piece silently answered "not land". The
  wider LGM shelf packs the whole southern North Sea into one such piece and
  exposed it. The helper now walks the rings the way the compiler's own
  `piece_geometry` does; all 16 self-test mutations, including both shifted
  payloads, still come back red.

## [0.1.15] - 2026-09-16

### Changed

- **One motion payload instead of two.** The requested-age motion-tile
  first-paint tier is retired: the 72 published `.ehmt` windows and their
  index (**5,743,096 bytes**, 73 files) are deleted, together with their
  emitter, promoter, validator, tracked source contract, manifest section and
  outer-manifest rows. `motion-palette.bin` + `motion-palette.json` are now the
  only motion path — fetched and decoded once at startup and shared by the
  native and palaeo request chains — so no age needs a window of its own and
  no tile URL is requested. Nothing scientific changed: a tile only ever
  carried exact byte copies of palette records, and the full palette was
  already the authority every frame was verified against. The complete build
  drops from **49.05 MiB to 43.55 MiB** of the 50 MiB ceiling (1,341 → 1,268
  published data files), which is what funds the 1:50m country outlines. While
  the palette is in flight the surface panel now reads *Loading motion
  palette…* instead of naming an age that cannot yet be posed; background
  timeline loading keeps warming checkpoints age-independently, and it still
  defers its main-thread decoding until a live scrub has rested.

### Fixed

- **The LGM exposed-shelf outline is cleaned at derivation.** After the
  present-day land subtraction the mask gets a 1.5 km morphological opening and
  a 3° spike filter, so the wedges the 1:50m coastline left against the
  1-arc-minute ETOPO mask can no longer fold inside out under int16
  quantisation: self-intersecting rings in the shipped LGM payload fall from 8
  to 4 (the rest come from the compiler's seam growth), spike vertices from 15
  to 2, exposed-shelf areas move by −0.34 % (North Sea), −0.18 % (Sunda) and
  −0.23 % (Beringia), the Doggerland sub-window by −0.006 %, and every LGM
  witness still reads as before. The teal needle shards visible at closest zoom
  over Doggerland are **not** removed by this change; their source is still
  under diagnosis.
- **The CI browser smoke runs one test at a time.** The two-worker default
  that 0.1.14 introduced starved both `@ci` tests on the two-core GitHub runner
  past their 20 s first-paint budget (main run 35093699520 failed where the
  identical pull-request run had passed). `make test-e2e-ci` now pins
  `EARTHHISTORY_TEST_WORKERS=1`; the local default stays two.

## [0.1.14] - 2026-09-16

### Added

- **The logo names the running build.** Hovering the "EARTH HISTORY" logo in
  the upper left shows an `EarthHistory v<version>` tooltip, its accessible
  name carries the same version, and the button exposes `data-app-version`, so
  a screenshot or a bug report identifies the exact build without opening the
  artifact manifest. The version is inlined from `package.json` by Vite's
  `define`, and a unit test fails if the constant drifts from the manifest or
  is left as an unreplaced token.

### Changed

- **The palaeo shallow seas are slightly darker.** The
  `palaeo-shallow-marine` base colour loses 12 % of its linear light at the same
  hue: `#14606b` to `#12545e` (187.9 against 187.6 degrees, saturation 0.81
  either way). Base colours are *linear albedo*, so the on-screen effect was
  solved through the 0.1.12 band model - per-band light factors 1.0355 / 0.7970
  / 0.5260, then ACES at exposure 1.02 and the sRGB transfer, the model that
  predicted the 0.1.13 mountain tone to within 12/255 - which puts the rendered
  tone at **93,174,180** in full light, **70,156,163** at mid lighting and
  **39,125,132** near the terminator, against 104,183,188 / 80,165,172 /
  46,135,142 before. Nothing the colour has to clear moves the wrong way: the
  light `#d0d4d5` outline/label ink gains contrast over it (5.7:1 against 4.8:1
  on the albedo the unit test measures, 1.7:1 against 1.6:1 on the rendered
  tone), the sea stays the brightest water on the globe at 54 / 54 / 44 of luma
  over the 0.58-dimmed shelf, it stays above the 95-luma floor that separates
  shallow sea from shelf in the painted-class census (107.2 in its tightest
  band, against 116.6), and the palaeo-land separation *widens* from 44.3 to
  53.7 luma. The map key's shallow-sea swatch now follows the rendered tone, as
  the mountain swatch already did, instead of showing the albedo. Predictions,
  not measurements: the browser census owns the rendered contract.

- **The correction validators run in parallel and skip what nothing changed.**
  `make check-corrections` ran thirty-eight validator lines strictly one after
  the other: **164.8 s**, of which the palaeo compile oracle was 75.9 s, the
  Panama land unit tests 41.1 s and the requested-age motion-tile self-test
  18.8 s. `scripts/run_corrections.py` now runs the six mutating `apply_*`
  validators first and one at a time, then the other thirty-two in a bounded
  pool of six: **80.8 s** cold, all thirty-eight passing. It also records, per
  validator, every project file that validator opened, renamed or listed on its
  last green run — through a `sys.addaudithook` recorder, so the input set is
  observed rather than declared by hand — and reports a validator whose command,
  script, imported modules, inputs and outputs still hash to the recorded digest
  as `cached pass (digest …)`. On an unchanged tree that is **0.3–0.7 s**.
  Nothing a validator asserts changed: the commands and their arguments are the
  Makefile's own, their output is printed in the same order, and mutating a
  tracked input re-runs exactly the validators that read it and still fails
  them — proved by editing
  `data/corrections/north-sea-restoration/restoration-contract.json`, which
  re-ran and failed `validate_north_sea_restoration` and its self-test while the
  other thirty-six stayed cached. The cache lives in gitignored
  `.cache/corrections/`, holds one small entry per declared validator and prunes
  entries for validators that no longer exist; `make check-corrections-all` or
  `CORRECTIONS_CACHE=--no-cache` ignores it, and
  `python3 scripts/run_corrections.py --self-test` — now part of
  `make self-test-gates` — proves the cache cannot report a pass for a mutated
  input.
- **The browser suite runs two tests at a time.** The tests share nothing but a
  read-only static server: no `beforeAll`, no shared context, no browser
  storage, no file writes. `playwright.config.ts` therefore moves from
  `workers: 1, fullyParallel: false` to `fullyParallel: true` with two workers
  (`EARTHHISTORY_TEST_WORKERS` overrides), and no test needed a change for
  parallel safety. The default is two rather than four because Chromium renders
  this scene through swiftshader and one browser already occupies most of a
  ten-core machine. Measured baseline on that machine: **1818.0 s** for 48 tests
  at one worker. The two-worker comparison run reached its 48th test in
  **1071.6 s** but was terminated before it could write its report, so the
  after figure is an in-flight reading, not a completed measurement, and the
  suite's own pass/fail tally under two workers is still unmeasured. The
  twenty-one palaeo-coastline tests carry a `@palaeo` tag and
  `npm run test:e2e:palaeo` runs that subset.
- **`make gate-fast` is the iteration gate.** Typecheck, unit/data tests, the
  correction validators whose inputs changed, build and the artifact bounds:
  **≈16 s** warm, against **180.2 s** for `make gate` before this change. The
  Makefile header now says which gate is for what — `gate-fast` while
  iterating, `gate` per commit (it adds `check-dev-docs`, `check-agents` and the
  build-cache bound), `gate-full` as the batch or release confidence reset and
  the only one that needs Chromium. No gate asserts less than it did:
  `gate-fast` only leaves out the local working-state and adapter-mirror checks.

### Fixed

- **Exactly five levels while realistic coastlines are on.** With the layer on
  the globe draws deep sea (the sphere), shallow sea, land, mountain and the
  country outlines, and nothing else: the native shelf, the native land fill and
  the land-class regional corrections are hidden inside the Cao 2017 band, and
  the restored pre-collision margins draw with the shallow-sea appearance. A
  unit test pins the visibility set per band and a browser check counts the
  painted classes at 90 Ma.
- **Land seams and holes in the cookie cut are closed.** Cut pieces of one
  record are merged with the slivers the partition cut left beside them, but
  only into adjoining parts of the same record; a merge that unioned the whole
  multipolygon had produced a frame-conflict offender and is gone. Cut edges
  follow great circles, so a piece boundary no longer opens a chord-wide gap at
  closest zoom.
- **Mountains sit on a land underlay with no hairline at the class edge.** The
  mountain geometry is drawn a second time as land at the land shell without a
  depth write, so the mountain tone stays above it and the browser census still
  reads the darker reddish brown in every lighting band; mountain ground also
  takes the dark outline tone.
- **The frame-conflict drop judges a piece's body, not its farthest corner.**
  The 1,000 km rule had read the maximum over 24 outline samples, which turned
  it into a threshold on piece *size*: the Sarawak shelf at 29-20 Ma (82,150
  km² bound to partition 61403, one corner at 1,015 km) was dropped along with
  17 other pieces of that interval, 921,505 km² in all. The drop now takes the
  median separation of the drawn ring; genuinely displaced ground (Qiangtang,
  Tarim, the Alpine fragments at 166-146 Ma, all above 6,000 km) still drops.
  The correction validator's oracle samples piece outlines exactly as the
  compiler does and asserts the same body measure; the `sarawak-shelf-
  oligocene` witness is green again. Payloads grew by 321 KiB across the three
  classes (7.96 MiB against the 8.5 MiB cap).
- **The LGM state no longer warms a Cao map it can never scrub into.** At
  21 ka the prefetch treated the table neighbour (the 11-2 Ma map) as an age
  neighbour, fetching and triangulating three payloads separated from the
  lowstand by two million years of fallback and occupying a residency slot
  beside the one interval that must stay resident. Detached intervals now warm
  nothing and are warmed by nothing; a browser check proves no `11-2` payload
  is fetched beside the LGM state.
- **Scrubbing across map intervals reuses the frame.** The palaeo pose reuses
  the native frame's scratch buffers, the worker transfers its index buffers
  instead of copying them, and both neighbouring intervals are prefetched as
  soon as one becomes current. The real-GPU profile and the costed remaining
  options are in `docs/research/palaeo-coastlines-scrub-performance-review.md`.

## [0.1.13] - 2026-09-16

### Changed

- **No double fill while realistic coastlines are on.** In the Cao 2017 band
  every native land fill (the Cao 2024 coast proxy and the land-appearance
  regional correction batches) is hidden, so only the palaeo classes fill and
  the modern-country outlines stay position markers; pick and coverage follow
  the same visibility table, and the "Land" swatch leaves the key in that band
  (fallback ages and the Last Glacial Maximum band keep native land and its
  corrections). Six unit tests turn red when a correction batch is re-enabled
  in palaeo mode.
- **The realistic coastlines are what the globe opens with.** The Cao et al.
  (2017) mapped land, shallow seas and mountains, and the Last Glacial Maximum
  lowstand state, are on by default instead of waiting behind a switch; the
  layer is also renamed from *Palaeo-coastlines (Cao 2017)* to **Realistic
  coastlines**, in the panel and in the map key, which keeps the Cao et al.
  (2017) citation beside the name. Only a link with no `layers=` takes the new defaults: a link
  that carries an explicit `layers=` list still keeps exactly the layers it
  names, so every shared link written before the layer existed still opens
  without it, and the hash writer keeps emitting the full visible list.
  Measured cold-load cost of the default on the production build, transferred
  bytes including response headers: **+45.1 KiB at 0 Ma** (13,195.4 → 13,240.7
  KiB; the class catalogs and the outline tone tables, four requests, with the
  map itself in fallback because no Cao 2017 map covers the present day) and
  **+564.5 KiB at 90 Ma** (13,110.8 → 13,675.3 KiB; the same plus the `94-81`
  interval charts, ten requests).
- **The Layers panel is controls only.** The two disabled placeholder rows
  (*Seafloor unavailable*, *Drainage unavailable*) are gone; what the Cao
  foundation does not publish is one line under the relief slider instead of
  two switches that cannot be pressed. The remaining toggles are ordered by
  what a visitor reaches for — realistic coastlines, modern-country reference,
  reference guides, tectonic references, clouds — and each carries one line of
  detail. The long Cao 2017 statement (24 intervals, the fallback, the outline
  markers, the LGM datum) is no longer duplicated in the row: it stays in the
  map key, next to the swatches it describes. The relief slider, the
  `aria-pressed` switches, the 44 px targets and the keyboard behaviour are
  unchanged.
- **Palaeo mountains are a darker reddish brown.** 0.1.12 made the class visible
  but landed it on a light tan — 235,198,139 at hue 33–37 degrees — which reads
  as desert, not mountain. The base colour moves from `#fd7328` to `#71220e`,
  aimed at sienna. Base colours are *linear albedo*, so the aim was solved
  through the band model 0.1.12 measured: per-band light factors 1.0355 / 0.7970
  / 0.5260 fitted to that colour's three measured tones, then ACES at exposure
  1.02 and the sRGB transfer, which predicted 196,114,68 / 177,95,55 /
  143,69,37. The browser tone census then **measured** the shipped build:
  **201,126,79** in full light, **184,117,72** at mid lighting and
  **142,78,53** near the terminator — hue 23.1 / 24.1 / 16.9 degrees, and
  **60.5 / 53.9 / 52.2** of luma-matched separation from `palaeo-land` against a
  30 floor. The model was right to within 12/255 at every channel except mid
  green, which it under-predicted by 22; the census now holds the measured tones
  per channel with a tolerance of 20 and a hue window of 10–30 degrees, and the
  predictions are retired.
- A darker class cannot hold the old ink contrast everywhere. Sienna itself
  (160,82,45) reaches only 2.72:1 against the dark outline ink and leaves the
  terminator band at 57/255 of luma; the shipped tone is the smallest lightening
  of it that keeps the terminator band readable, measured at 91/255. Even there
  it reaches only **2.39:1** against that ink, where the tan held 5.75:1, so the
  census floor near the terminator is 2, while full light and mid lighting keep
  the ≥ 3:1 contract at a measured 4.79:1 and 4.13:1. `palaeo-land` and
  `palaeo-shallow-marine` are unchanged, and the map key's mountain swatch
  follows the measured full-light tone.

### Fixed

- **Scrubbing across a Cao 2017 map-interval boundary no longer stalls the
  gesture.** Three causes, measured on a headless SwiftShader harness over a
  6 s scrub from 100 to 80 Ma before they were addressed: the neighbouring
  interval's warm-up was armed on a settle timer that a continuous scrub
  cleared on every sample, so it never fired and the crossing paid the whole
  fetch, decode and triangulation with the gesture waiting on it; the three
  class payloads were fetched and triangulated one after another inside an
  `await` loop; and the incoming interval could not be posed onto the outgoing
  geometry, which froze the layer from the boundary until the swap landed. The
  neighbour is now warmed as soon as an interval becomes current (once per
  interval and direction, bounded by the store's own two-interval residency),
  the three class payloads load together, and the outgoing interval stays
  drawn and posed at its own range edge until the incoming one is published.
  Same harness and gesture, layer on: median frame gap 232.5 → 235.1 ms,
  maximum **1518.3 → 1351.7 ms**, and the first crossing costs a 1.445 Ma age
  step instead of 5 Ma while holding the outgoing pose for four frames. The
  residual maximum is the second crossing, whose warm-up has only ~1.5 s of
  lead: prefetch lead time, not GPU upload.
- **Palaeo charts are re-posed in the same frame as the native surface.** The
  pose went through a promise, a React state hop and a second commit where the
  native surface and its country outlines are retargeted in one synchronous
  call; `evaluatePalaeoMotionNow` answers the same pose from resident data with
  no `await`, and the interval pump stands down where that path already posed
  the age. Measured over the same scrub with a new per-frame probe, before and
  after are the same — at this harness's ~235 ms cadence the promise and the
  commit both fit inside one frame — so this removes the hop and a redundant
  second evaluation per sample rather than a lag it measured.
## [0.1.12] - 2026-09-16

### Changed

- **Palaeo mountains are a readable light brown on screen, not only in their
  base colour.** `palaeo-mountain` shipped as `#c8a97e`, a colour that was
  already light before the renderer touched it. Base colours are *linear
  albedo*: the scene multiplies them by an inspection light of intensity 3.2 and
  a hemisphere fill and then runs ACES at exposure 1.02, whose shoulder
  desaturates everything it lifts toward white. Measured on the production
  build, the class rendered at **223,213,192 against palaeo-land's 213,212,184**
  — 6.5/255 of luma-matched separation for a base colour 21 CIE76 away, which is
  not a class a viewer can name. The base colour is now `#fd7328`,
  pre-compensated for that wash, and the class renders at **235,198,139** in
  full light, **225,182,119** at mid lighting and **194,151,99** near the
  terminator: **37.5 / 37.5 / 36.8** of separation against a 30 floor, hue
  32.8–36.9° at all three bands, and 5.75–9.44:1 against the dark outline ink.
  `palaeo-land` and `palaeo-shallow-marine` are unchanged, and the map key's
  mountain swatch now follows the rendered tone rather than the albedo.
- New gate: a browser **tone census** measures this rather than asserting it.
  It takes ground truth from the scene's own composite pick under each canvas
  pixel — a new test-only `window.__earthHistoryPixelSurfaceProbe` that also
  reports the incident-light cosine the fragment stage used — buckets the pixels
  into full-light, mid and terminator-near bands, and reports the per-channel
  median tone per class per band over five camera aims that carry one mountain
  belt through all three. Proven red against the old colour (5.8, then 6.5 with
  the final aims, against the 30 floor) before the colour moved.

### Added

- **`at=` deep links are posed through time.** `at=<lon>,<lat>` is a present-day
  coordinate, but the camera read it as a direction in the rendered frame: a
  link written at 90 Ma framed whatever ground the plate model had rotated under
  that direction, and nothing on screen said so. The coordinate is now carried
  through the motion frame, so the camera aims at the reconstructed position of
  the ground the link names while the hash keeps naming the ground. A browser
  check aims `#age=90&at=-100,45` at the Western Interior Seaway, requires the
  settled camera longitude to differ from -100 by more than 3 degrees, and reads
  the centre pick back as a present-day direction within 5 degrees of the
  coordinate the link asked for.
- **`focus=north-sea-rift` has an anchor of its own** in the Cao anchor catalog:
  a `poi-anchor` chart cut to the validity of the Cao fragment that carries it,
  270-130 Ma, with the point's 200 km coordinate uncertainty and the two source
  ids it cites. A browser check proves the link moves the camera more than 2
  degrees off its resting pose at 255 Ma.
- **Three more inland seas**, each two ops with the contract's mandated
  `add-shallow` companion beneath its land removal: the **San Juan Basin** arm
  of the Western Interior Seaway at 81-58 Ma (the marine Lewis Shale under the
  Pictured Cliffs Sandstone), the **North Alpine Foreland Basin** at 37-29 Ma
  (the fully marine Untere Meeresmolasse of the Rupelian) and the **South
  Makassar Basin** at 49-37 Ma (Middle Eocene extension of the south-eastern
  Sundaland margin). Every candidate witness the six review memos produced is
  pinned in `data/corrections/palaeo-coastlines/witnesses-pending.json`
  (76 rows) rather than left in prose, and the defensible ones are ingested:
  the source witness table goes from 89 to 104 rows over twenty probed intervals
  and the basin-edit table from 52 to 59.
- **The map key states what the class set cannot say**
  (`src/data/palaeoKeyText.ts`): an interval is the maximum flooding of a
  10-27 Myr bin rather than a shoreline at one moment, shallow marine is an
  environment and not a water depth, there is no lake or brackish class, and a
  feature below the source's ~30 km class floor is absent from the map rather
  than dry.

- **Restored pre-collision margins for the Alps and the Scandinavian
  Caledonides.** The Cao 2024 model builds both orogens out of present-day crust
  tiles: the Alpine convergence closed a 316 km empty seam without shortening a
  square kilometre of crust, and the 122 km of Baltican crust west of the
  Norwegian coast at 62 N is modern Atlantic shelf, not a restored Iapetan
  margin. `data/corrections/restored-margins/` now authors the missing crust the
  way Cao themselves carry Greater India: 15 cited model-inference strips,
  852,308 km² in present-day WGS84 reference coordinates, on the plate that
  carries each strip's own datum crust (307/308 for Adria, split where the Cao
  partition changes between 8.75 and 9.00 E; 305 for Europe; 302 for Baltica;
  102 for East Greenland), each with a lifecycle that retires it as the model
  closes the room for it — 40 → 5 Ma in the Alps, 430 → 405 Ma in the
  Caledonides, every `youngest` bound exclusive so the 410 Ma authoring junction
  is met without double drawing. `scripts/research/validate_precollision_extent.py`
  re-run with them included turns the two failing collision verdicts into
  passes: Adria 0 → **184.6 km** against a ≥ 140 km minimum, Baltica 122.2 →
  **400.9 km** at 62 N and 400.7 km at 66 N against ≥ 140 / 250 km, with the
  European conjugate at 233.5 km, East Greenland at 201.4–201.8 km and India
  unchanged at 1,341.0 km.
- **It is crust, not land.** Every strip carries unknown surface evidence and no
  palaeo class — the Cao 2017 classes over these coordinates ride the conjugate
  plate and would slide off the restored crust. They are the first correction
  batch to declare a `surfaceAppearance`, `shelf`, which the renderer draws as
  the new `correction-shelf` surface class on the 700 m shell below
  palaeo-shallow-marine and above the native shelf, never with the land fill the
  other correction batches carry and never counted as land by a "is this land"
  question. The stacking contract is unchanged in kind: the class writes no
  depth, and the depth-writing shelf below it is cleared by 457.41 m against the
  242.59 m chord sag.
- Gates: `scripts/research/restored_margins_correction.py` (9 tracked mutations
  proven red, 11 with `--model`, plus a runtime mutation), the North Sea
  clearance re-derived at every Scandian age (minimum **56.2 km** against the
  restored plate-303 block, over a 50 km floor), 14 mutations in the shortening
  validator's self-test including the two that remove a restored margin and
  watch the transect fall back, and `src/reconstruction/restoredMargins.test.ts`
  reading the shipped bytes (posed at 45 and 420 Ma, absent at 0, 1 and 5 Ma).
  Record: `docs/research/palaeo-coastlines-restored-margins.md`.
- A toggleable **Palaeo-coastlines (Cao 2017)** layer that replaces the Cao 2024
  coast proxy with mapped palaeogeography for the 24 published map intervals
  from `402-380` to `11-2` Ma, plus the Last Glacial Maximum lowstand state. All
  three Cao surface classes ship: 26,095 landmass pieces (3,398,702 bytes),
  28,500 shallow-marine pieces (3,221,980 bytes) and 11,710 mountain pieces
  (1,153,074 bytes), cut from 7,363, 13,400 and 4,787 Cao et al. (2017) source
  records and the cited basin and lowstand contracts, plus three columnar class
  catalogs and 25 country-outline tone tables (107,502 bytes for both files) —
  8,022,435 bytes over 80 files, inside the 8.5 MiB budget `check-app-artifacts`
  now enforces. `dist` is 51,431,072 bytes (49.05 MiB) against the unchanged
  50 MiB ceiling.
- The mechanism: the browser downloads polygon rings, not triangles. A published
  interval is one EHPR v1 payload per class — int16 lon/lat vertices, a 12-byte
  piece record and a 2-byte ring record — which a worker decodes, ear-clips with
  its holes and refines to a maximum 1° edge before the second surface renderer
  instance draws it. Pre-triangulated streaming of the landmass class alone
  would have been 45–96 MiB. Each piece is posed by the plate its catalog
  binding names, resolved against the shared motion palette by the normative
  `palaeo-binding-entry-v1` rule (North Sea restoration first, eight recovery
  plates that never fall back, `correction-plate-` entries at and above 410 Ma,
  the native chain below it), and is drawn on its own `(TOAGE, FROMAGE]`
  lifecycle rather than on the interval of the file it ships in. The format is
  specified in `docs/data/palaeo-coastlines-format.md`.
- What the layer does not claim: an interval records the minimum land and
  maximum flooding mapped anywhere in that bin, not a shoreline at one moment,
  and the map steps at an interval boundary rather than morphing through it.
  Shallow marine is an environment class, not a water depth. Cao 2024
  continental crust carrying neither class keeps its own "depth unmapped"
  meaning and is never drawn as deep marine. Country outlines become light
  position markers over a Cao 2017 sea; the tone is a legibility aid, never
  evidence that the modern country existed. Outside 2.01–402 Ma, including the
  present day, the mode falls back to today's composition with a map-key notice.
- What did not change: the layer is off by default, a link written before it
  existed still opens with it off, and nothing palaeo is fetched while it is
  off. With the layer off the drawn globe, the native Cao 2024 composition, the
  country outline's single dark ink, every correction, anchor, boundary and
  ownership asset and every existing citation are exactly what they were. The
  Cao 2017 ice class `i` is still not compiled.
- The **mountain class** `palaeo-mountain`, shipped as light-brown polygons
  above palaeo land. Withholding it was a measured defect, not a preference:
  Cao classes ground as mountain in all twenty-four intervals — from 2.1 million
  km2 at 285-269 Ma to 23.9 million km2 at 20-11 Ma — and where that ground
  carried neither of the two published classes the globe painted emergent orogen
  in the blue the map key defines as "Cao 2024 continental crust, depth
  unmapped", asserting an absence of evidence the source does not have over
  areas the size of continents. At 170 Ma the Pentland Firth between Caithness
  and Orkney rendered as water 90 km from land that was drawn. The class first
  shipped with the base colour `#c8a97e`, which the tone census recorded above
  measured as unreadable once the renderer had lit it; it ships as `#fd7328`,
  and that Changed entry records the measurement and the final rendered tone.
  Precedence is unchanged — mountain over land over corrections over shallow
  marine over shelf — and the map key's "Palaeo mountain" row returns with the
  class. The class carries Cao's own evidence row and adds no new literature
  claim; its limitation line says it is a mapped relief class, neither an
  elevation nor a modern topographic surface.
- The mountain class is funded by a lossless reclaim, not by dropping a tier.
  The shipped package already interned repeated chart fields; the interned field
  list grew from four to twelve and the references moved into one dense column
  per field, because twelve repeated key names per chart cost more than the
  references they introduce. `core.json` falls from 3,216,469 to 1,426,795 bytes
  and the material-correction catalog from 284,232 to 220,600 — 1,853,306 bytes,
  against the 1,172,814 the class needed. Every chart is deep-equal after
  expansion and the whole document is canonically equal; six deliberate
  mutations are proven red in both halves of the codec. `PALAEO_MAX_BYTES` rose
  from 7 to 8.5 MiB, inside what was reclaimed, and `dist` keeps 997,728 bytes
  of margin under the 50 MiB ceiling. Two further reclaims were measured and
  deliberately left untaken — mountain node reduction at 0.05 degrees (41,654
  bytes, 3.5 % of the class, for a real loss of boundary detail) and interning
  `motion-palette.json` (588,257 bytes, but fifteen offline scripts read that
  catalog directly) — because the requirement was already met.
- **`PLATEID1` overrides are bounded by a declared footprint.** Every override
  entry now carries the bounding box of that plate's own present-day Cao 2024
  static partitions, buffered by a stated 500 km — twice the 250 km
  frame-conflict threshold — and a cut piece is rebound by its `PLATEID1` only
  if the whole piece fits inside it. Without the bound a plate id alone carried
  ground an ocean away: the Apulia (3307) override was rebinding shallow-marine
  pieces spanning 3.7-31.6 E and 36.0-55.8 N onto a plate whose entire
  present-day crust is 15.2-19.3 E, 39.6-41.9 N. The rule turns 3,545 of 9,934
  eligible shallow-marine pieces, 413 of 1,287 landmass and 440 of 985 mountain
  pieces back to partition binding, where the frame-conflict flag discloses the
  disagreement instead of hiding it; a piece whose partition owner then has no
  gap-free motion coverage is not drawn rather than posed on an invented
  rotation. The validator rejects an override piece outside its footprint, and
  an override entry with no footprint at all.
- Twenty-nine cited local modifications to the Cao 2017 polygons in the North
  Sea, the first basin the plan's edit contract covers. In eleven of the
  twenty-four map intervals the source misstates the land-sea pattern at basin
  scale, and 149,231 km2 of landmass is added net and 244,125 km2 of shallow
  marine removed net to fix it: the Middle Devonian Orcadian Basin stops being an epicontinental sea
  and goes back to being a lake in a continent (402-380 Ma); the Moray Firth
  emerges in the Zechstein while the Central North Sea evaporite basin stays
  flooded (269-248); the East Shetland Platform and the Brent/Vestland delta
  plain emerge in the Middle Jurassic, the delta plain bounded north by the
  published ca. 60 degrees 30 minutes N limit, and northern Scotland, the
  Pentland Firth and Orkney stop rendering as water of unknown depth between
  them (179-166); the Scottish landmass stays emergent through the Late Jurassic
  where Cao drowns it and the literature does not (166-146); the Viking Graben
  at Heather time, the Egersund Basin at Tau and Draupne time, the eastern
  Norwegian-Danish Basin and the southern North Sea at the late Ryazanian
  transgression stop rendering as dry ground over their own source-rock kitchens
  (166-146, 146-135, 135-117); and the Shetland
  Platform emerges in the Palaeocene and Eocene, where Cao's own authors record
  fewer than twenty marine fossil collections constraining the whole globe
  (58-49, 49-37). Those four Late Jurassic and Early Cretaceous removals are a
  different kind of edit from the rest: in each, Cao overlaps one of its own
  landmass polygons on its own shallow-marine polygon and the landmass wins the
  draw order, so what is removed is an artefact of a maximum-transgression bin
  rather than a disagreement with the source. Two `add-shallow` companions cover
  the intervals where no shallow-marine polygon lies underneath, so a removal
  never leaves mapped sea rendered as crust of unmapped depth. Each operation
  carries its rationale, a 40-75 km spatial uncertainty, its references with DOI or URL, and an editorial line
  "EarthHistory modification after <refs>"; the edited charts carry those
  references in their evidence records, so the map key names them whenever an
  edited chart is on screen. Every geometry is EarthHistory's own coarse
  five-to-seven-vertex construction sized from the published descriptions, and
  the literature is citation-only: no figure, map plate or coordinate list is
  traced, digitised or redistributed, the two NSTA/OGA regional packages
  (Open Government Licence v3.0) are read as facies descriptions only, and the
  only redistributed palaeogeographic geometry remains Cao et al. (2017). Nine
  interval groups are deliberately left untouched and the contract says why,
  including the Late Cretaceous platform flooding and the Forties provenance the
  literature memo flags as unsettled, the Late Jurassic rift seaways Cao already
  gets right, and the northern limit of the Zechstein Sea nothing retrieved
  places. The record is
  `docs/research/palaeo-coastlines-north-sea-edits.md`, with five measured
  companions: the formation checks, the Middle Jurassic and Eocene Shetland
  literature records, the Norwegian shelf checks against the Norlex
  lithostratigraphic wallchart and the Sodir formation charts, and the
  structural-element checks. Two further
  refinements come from those: the Brent rationale now says that 60 degrees
  30 minutes N bounds the *Vestland* system and not the Brent maximum (a delta
  *front* at about 61 degrees 30 minutes N that the operation deliberately does
  not reach), and cites the Central North Sea dome for the emergence of the
  ground south of the delta but explicitly not for its sediment supply, naming
  both sides of the open provenance controversy; and the East Shetland Platform
  outline is pulled back to 0.55 E between 60.9 and 61.3 N so it stops short of
  the Unst Basin, which preserves a Brent Group succession. The Palaeogene
  operations gain the Grid and Frigg lithostratigraphy, the Hermod provenance
  record, the Middle Eocene platform succession, the Palaeogene palaeobathymetry
  and the platform's structural history, and their stated spatial uncertainty
  rises to 75 km because no retrieved source places a Palaeogene shoreline
  anywhere between 0 and 1.2 E. No Nordland Ridge or Loppa High operation
  follows from the wallchart: a hatched hiatus column states that section is
  missing, not that the ground stood above sea level, and both are carried as
  drift witnesses instead. The country-outline tone tables and their interval
  index are built from the shipped class list alone — which the promote script
  refuses to publish against a mismatch — so a segment is inked dark over the
  mountain class now that the class ships, and was not while it did not.
- Nine of those twenty-nine operations are the **North Sea structural
  elements**, and the two measurements behind them are the reason there are only
  nine. Measured: 26 of the 43 Norwegian-sector elements and 10 of the 19
  UK-sector ones have an inscribed diameter below Cao's own ~30 km coastline
  tolerance, so most of the North Sea's named highs cannot be drawn in this
  model at all; and across the twelve intervals from 166-146 to 11-2 Ma, 27 of
  the 43 carry the shallow-marine class and nothing else at every one of them -
  high and graben the same colour at every age, with no archipelago and no
  post-Jurassic structural relief anywhere on the map. What changed: the Jaeren
  High becomes an island through 135-117, 117-94 and 94-81 Ma and stops short of
  146-135 because Ryazanian macrofossils were recovered from a well on the high
  itself; the Tail End Graben, Sogne Basin and Gertrud Graben stop rendering as
  dry ground through Farsund Formation time (166-146 to 117-94); the Mid North
  Sea High is emergent from the Middle Jurassic until the Aptian-Albian
  submergence four publications date (166-146 to 135-117); and the Fladen Ground
  Spur is land at 203-179 and 166-146, the two intervals its sources constrain.
  The Mid North Sea High operation is anchored on the one extent published as
  text and convertible without reading a figure - Quadrants 35-39 - leaves the
  marine corridor along the Central Graben as Cao drew it, and declares 75 km
  rather than 60 km because the NSTA, EGDI/NAGTEC and BGS renderings of the high
  genuinely disagree by up to two degrees. A fifth proposed operation, the East
  Shetland Platform in the Late Jurassic, was declined and recorded with its
  reason: it rests on absence of section plus a statement of uplift, the same
  pair the Norwegian-shelf memo refused for the Nordland Ridge.
- A **licence resolution** the UK-sector extents needed. The NSTA open-data
  layers carry no `licenseInfo` string at all and NSTA's default user agreement
  grants non-commercial use only; the identical polygons - measured this session
  by reading both shapefiles directly - are redistributed by the British
  Geological Survey in its 21CXRM Palaeozoic package under the Open Government
  Licence v3.0 with the acknowledgement "Contains British Geological Survey
  materials (c)NERC 2017". The contract cites the BGS redistribution. The
  Norwegian extents are the Sodir structural-elements layer under NLOD 1.0, not
  the 2.0 the brief assumed. Nothing from either is redistributed: only derived
  points, boxes and areas appear, and every emitted ring stays EarthHistory's
  own coarse construction.
- An **`iceland` basin contract**, the second the layer carries, and the first
  drawn from a national geological map rather than from prose. Cao 2017 draws no
  land over Iceland at any map interval: the island and its shelf are shallow
  marine at 20-11 and 11-2 Ma and absent before that, so the North Atlantic has
  had no Iceland on this globe at any Neogene age. Four operations fix it. At
  11-2 Ma the layer draws the dissolved `gold` class of the Natturufraedistofnun
  Islands 1:600,000 bedrock map - "Basic and intermediate extrusive rocks with
  ingercalated sediments. Upper Tertiary, older than 3.3 m.y." - 35,468 km2 of
  present outcrop, against the about 36,000 km2 of Tertiary rocks Hardarson et
  al. (2008) publish independently. At 20-11 Ma it draws the same outcrop
  clipped to the three lobes the published radiometric ages place at or above
  12-16 Ma: the NW peninsula, Trollaskagi and the Eastfjords, 22,212 km2. Each
  add-land carries a paired remove-shallow over the identical ring, so the
  evidence record stops asserting Cao's shallow-marine class under ground the
  layer now calls land. The geometry is derived by
  `scripts/research/palaeo_coastlines_iceland_ops.py` from the same pinned,
  hashed CC BY 4.0 snapshot the regional Iceland material correction reads - so
  the palaeo land and the `gold` outcrop cannot drift apart - and the script's
  `--check` proves the tracked contract re-derives, with seven proven-red
  mutations.
- What the Iceland contract does not claim, and it is a long list because the
  evidence is thin. The outcrop is a **minimum** footprint, not a reconstructed
  coastline: erosion, burial, glacial excavation and subsidence all remove area,
  so a defensible bracket runs from this 35,468 km2 to the 101,155 km2 modern
  outline and the contract deliberately draws the minimum, with a hole down its
  middle where the neovolcanic zones are excluded. No exposed Icelandic crust is
  older than about 16 Ma, so the 16.3-20 Ma half of the 20-11 bin carries no
  mapped land at all and that operation is a young-end statement only. The
  3.3 Ma class boundary is the finest the source offers, 1.3 Myr older than the
  bin's young bound. And the rigid two-plate pose closes the island to a maximum
  at about 12 Ma and then re-opens it - past about 13 Ma the eastern half has
  been carried through the western half and out the far side - which is why
  every non-modern Iceland pose is model inference and never cited
  reconstruction. The Jan Mayen microcontinent, the Faroes and the
  Iceland-Faroe Ridge land bridge, an Icelandic LGM state and the shallow-marine
  platform around the island are all recorded as deliberately left alone, with
  their references and reasons.
- A **seam gate** for Iceland that records a disagreement instead of asserting
  agreement. The palaeo compiler cuts the island on the Cao 2024 static-partition
  seam - plate 102 in the west, 301 in the east - while the material correction
  cuts it on the exact shared 101/301 ridge subsegments; plates 101 and 102 are
  measured co-moving to 0.0 km over 0-29 Ma, so the risk is the seam line, not
  the rotations. Measured: on the four latitudes where both constructions cut
  through outcrop, 65.4 to 66.0 N, the two seams are 19.7 to 60.6 km apart, and
  between 64.6 and 65.2 N the partition seam falls inside the neovolcanic gap
  where there is no Tertiary outcrop to cut at all. The contract pins each
  separation and allows 5 km of drift, so the gate catches a change in either
  construction; it does not pretend the two agree.
- Thirty-nine new **validator witnesses**, and the premise one of them corrects.
  Twenty-three come from a measurement of nine inland seas across North America,
  South America and Siberia through all 24 intervals, and the most important
  says that the **Turgai Strait is an open, connected marine corridor at 81-58,
  58-49 and 49-37 Ma** and closes at 37-29. The plan had recorded it as land in
  every interval and called restoring it the highest-value fix available; that
  came from probing only the four intervals in which the strait is dry, and
  `WITNESS_INTERVALS` now spans twenty intervals rather than twelve so the
  same blind spot cannot recur. Two more of those rows keep western Amazonia
  drawn as land through the Neogene rather than as shallow marine, which would
  assert the contested marine reading of the Pebas system over the published
  lacustrine one. Sixteen come from the structural-element checks, nine of them
  negative witnesses that record a state deliberately not changed - the Late
  Jurassic footwall archipelago, the Forties-Montrose High, the Tampen Spur -
  so that a later change has to be deliberate. Every row is a class SET rather
  than a membership test, because three of the findings are invisible to a
  membership test. `palaeo_coastlines_correction.py --self-test` now proves 35
  mutations red, up from 27.
- A **pre-collision extent gate**, `scripts/research/validate_precollision_extent.py`,
  and the unit test `src/reconstruction/precollisionExtent.test.ts` beside it.
  The product requirement is one sentence - enough continental land has to be
  compacted to explain the height of the mountains - and a rigid plate model can
  fail it silently. Measured against the published shortening budgets of three
  collisions: India-Asia **passes**, because Cao 2024 ships a `Greater India
  based on Gibbons et al. (2015) Gondwana Research` feature reaching 1,341 km
  north of the model's own Indian outline at 85 E, against a 1,000 km minimum,
  with a lifecycle that ends at 10 Ma - the model's own statement that the crust
  was consumed. Adria-Europe **fails** by 140 km: the Alpine convergence is
  inside the published range, 301 km since 35 Ma, but it closes a 316 km empty
  seam without shortening a single square kilometre of crust. Baltica-Laurentia
  **fails** by 18 km at 62 N and 108 km at 66 N, and the 122 km the model does
  carry is modern Atlantic shelf rather than a restored Caledonian margin. The
  two failures are pinned as failures, so the gate fails when a measurement
  drifts or a verdict stops following the numbers beside it, not because the
  model is short; restoring those two margins is designed in
  `docs/research/palaeo-coastlines-restored-margins-design.md` and not shipped
  here. `--record-only` runs in any checkout; the pyGPlates re-derivation of
  sixteen transects, nineteen overlaps and twenty convergences runs where the
  pinned environment exists and reports "not run" by name where it does not.
  Ten mutations are proven red.
- One map-key line for the crust that passes: "Greater India crust - model
  inference after Gibbons et al. (2015); published spread ~600-3,000 km; removed
  from the model at 10 Ma", shown only while that chart is actually posed. Three
  rules behind the wording - name the model rather than the map, say crust
  rather than land because the layer draws this ground as shallow sea, and carry
  the spread, which is a factor of five and unresolved. Thirty-nine references
  join `src/data/sources.ts` with it: the twenty behind the three shortening
  budgets, eleven behind the structural-element operations, and eight behind the
  Iceland contract.
- One optional **Last Glacial Maximum lowstand state** inside the same layer, at
  26.5-19.5 ka: the first interval the layer carries that is not Cao et al.
  (2017) geometry at all. It is the NOAA ETOPO 2022 60 arc-second surface at or
  above the -120 m eustatic datum, over three footprints and nowhere else - the
  southern and central North Sea (Doggerland), the Sunda shelf, and Beringia
  either side of the antimeridian. The datum is Lambeck et al. (2014), who
  record a slow eustatic fall to -134 m between 29 and 21 ka with a companion
  model peak of ~130 m; -120 m is the conservative round contour, a deliberate
  under-claim. The window is Clark et al. (2009), "nearly all ice sheets were at
  their LGM positions from 26.5 ka to 19 to 20 ka", read as the same half-open
  `(TOAGE, FROMAGE]` lifecycle as every other interval, so the timeline's
  existing 0.021 Ma chapter lands inside it and 19.4 ka and 26.6 ka do not.
  Measured exposed shelf: 658,203 km2 in the North Sea box, of which 310,950
  km2 in the southern North Sea plain between England, the Netherlands, Germany
  and Denmark; 2,256,842 km2 on the Sunda shelf; 1,638,056 km2 in Beringia.
  Sturt et al. (2013) model 127,422 km2 submerged in the North Sea zone across
  the Holocene - a different quantity over a different window and under
  glacio-isostatic adjustment, quoted as an order-of-magnitude anchor and not as
  agreement.
- What the LGM state does not claim, stated in the map key and enforced by the
  gate: it is eustatic only, one flat contour with **no glacio-isostatic
  adjustment**, although relative sea level around Britain and Ireland varies by
  more than 100 m spatially under GIA; **ice sheets are not drawn**, so ground
  under the Fennoscandian, British-Irish and Laurentide ice sheets is shown as
  exposed land, which it was not; ETOPO 2022 is **modern bathymetry** with
  post-glacial sediment still in place, which is precisely what Coles (1998)
  warns against ("the present-day relief of the North Sea bed does not provide a
  sound guide"); the rivers, lakes and estuaries Gaffney et al. (2009) mapped by
  seismic survey are absent; and it is **regional**, so every other coastline at
  this age is the present-day one. Its evidence badge is synthesis at every age
  in the window.
- Because it is regional, it is drawn *over* today's land rather than instead of
  it. The palaeo domain is now two bands: in 2.01-402 Ma the Cao 2017 polygons
  replace native land as before, and in the LGM band native land stays visible
  with the exposed shelf drawn on the shell 500 m above it. Hiding today's land
  for a three-footprint state would have blanked every coastline on Earth. The
  composite pick, the coverage query and the guide-label ink follow the palaeo
  instance independently of whether native land is hidden, and the band is
  carried through the existing one-frame hysteresis so the frame that still
  draws Cao charts still hides native land. Country-outline tone follows the
  same logic: the LGM tone table is the ordinary dark ink, because there is no
  palaeo composition under the outlines to read.
- Format and gates for it. The class catalogs gained
  `detachedIntervalIds: ["lgm"]`, so the schedule check still rejects an
  interval dropped by accident while accepting the intended 2 Myr gap; the
  shallow-marine payload for the interval is a header-only 32-byte file, because
  a eustatic contour says where land was and nothing about where a shallow sea
  was, and the validator fails if it is not empty. The interval cost 48,151
  bytes when it landed, and every other interval stayed byte-identical. `validate_palaeo_coastlines_runtime.py`
  now pins the four ETOPO crop digests, the contour datum, the window, the
  footprint bounds, the measured areas, the required limitations and references,
  and eight witnesses - Dogger Bank, the Sunda shelf and the Bering land bridge
  are land at 21 ka, London is unchanged, and the Norwegian Trench, the Makassar
  Strait, the Aleutian Basin and the South Atlantic are not - with 15 proven-red
  mutations including a datum changed to -130 m, a corrupted crop digest and a
  payload shifted half a degree east that turns the Norwegian Trench into land
  while staying inside the area tolerance. No raster enters the repository: the
  crops stay in the owned offline store and only the derived rings ship. The
  record is `docs/research/palaeo-coastlines-lgm-lowstand.md`.

### Changed

- Ship the Cao v2.4 package JSON in a lossless interned form and reclaim
  7,379,140 bytes (7.04 MiB) of the static build without changing anything the
  application renders or any evidence it can surface. The shipped documents
  repeated a handful of distinct values across thousands of records, so
  repetition is now stored once and the identifiers that were already implied by
  neighbouring fields are derived instead of shipped: `core.json` 6,314,414 to
  3,216,469 bytes (4,995 charts sharing 13 `evidence.limitations` arrays, 7
  `surfaceEvidence` objects, 183 `lifecycle` objects and 938 `motionBindings`
  arrays, with 3,799 identical `chartId`/`fragmentOrCohortId`/`materialId`
  triples collapsed); the 235 `boundary-*.json` catalogs 10,064,808 to 6,365,752
  bytes (19,805 derived `segmentId`s plus per-file GPlates UUID and enum
  tables); the 235 `ownership-*.json` catalogs 1,356,950 to 887,669 bytes (3,838
  derived `polygonId`/`ringId` pairs); and `corrections/material-v1/catalog.json`
  397,090 to 284,232 bytes. `dist` falls from 52,349,889 bytes (49.92 MiB) to
  44,973,799 bytes (42.89 MiB) against the unchanged 50 MiB ceiling, a net
  7,376,090 bytes after the 3,050-byte decoder in the bundle. The wire format is
  described in `docs/data/README.md`.
- Nothing scientific changed: every chart, source identifier, citation,
  limitation string, lifecycle bound, motion binding, epistemic status, boundary
  segment, ownership ring and digest keeps its exact value, and each rewritten
  file was proved to expand to a canonically identical document before it was
  written. No geometry, motion palette, checkpoint state, correction, anchor or
  country asset was touched, and `make check-corrections` reports the same
  numbers as before apart from the recorded byte counts and digests. The runtime
  expands each document inside the verified-JSON load, before every existing
  validator, so no consumer downstream of the loader changed.
- Re-derive the seven `core.json` digest declarations and the catalog, checkpoint
  and tile ledgers that follow them through their owning scripts rather than by
  hand: the package and root data manifests, the 235 checkpoint native-layer
  pins and their `transitiveBytes`, the correction catalog's `baseline.coreSha256`,
  the requested-age tile index (re-emitted and re-promoted through its own
  emitter, validator and promoter, with all 72 tile payloads proved byte
  identical), the tracked tile source contract, and the two pyGPlates oracle
  records whose package identity is rebased only after every measured field is
  shown to be unchanged. `scripts/research/cao_package_intern.py --self-test`
  round-trips all 472 shipped catalogs and rejects five deliberate corruptions,
  `scripts/research/apply_cao_package_interning.py` re-verifies the applied form
  and its ledgers, and both join `make check-corrections`;
  `src/reconstruction/packageIntern.test.ts` proves the runtime decoder rejects
  an out-of-range dictionary reference, a colliding derived `segmentId` and a
  ring shipped outside its polygon group.

### Fixed

- Ship the Last Glacial Maximum state as **exposed shelf only**. The payload
  carried the whole `>= -120 m` mask inside each crop rectangle, so the
  palaeo-land shell re-tinted Germany, France, Norway and Britain — ground that
  was already dry — and the rectangle edge showed on screen as a hard tonal seam
  running straight across northern Europe: pale `(216,216,190)` inside the box
  against present-day `(203,208,172)` outside it, along a dead-flat 240 px line.
  The derivation now subtracts present-day land (the pinned Natural Earth 1:50m
  admin-0 land the observed-land omission correction already uses, eroded 1.5 km
  so the shelf still laps over the modern coast and no hairline opens along it),
  and the layer draws only what the lowstand added: 695,747 km2 in the North Sea
  box, 2,347,446 on the Sunda shelf and 1,696,055 in Beringia. London and the
  north German plain are new witnesses — present-day land, and nothing the LGM
  payload draws — beside Dogger Bank, which is still exposed shelf.
- Close the cookie-cut seams between pieces of one source record. Each record is
  cut by the present-day static partitions and every piece is node-reduced on its
  own, which left the two copies of a shared edge displaced and a hairline
  through which the darker crust, or the bare sphere, showed at closest zoom (one
  is visible as a 106 px dark line inside an otherwise uniform palaeo-land field
  in the 170 Ma review capture). Every piece of a multi-piece record is now grown
  back across its seams — at least 1.5 km, or 1.25 times its own reduction
  tolerance where that is larger — and clipped to the record it came from, so
  neighbours overlap instead of gapping while the record's own outline never
  moves. A record that still leaves a hole inside that outline is emitted
  unsimplified. The overlap is the same ground counted twice, so it is declared
  per interval and every area ratio subtracts it.
- Stop drawing ground thousands of kilometres from where its own source record
  puts it. Four Qiangtang (616) and Tarim (601) mountain pieces and one landmass
  piece were bound to India by the partition rule and drawn 6,474-6,837 km away —
  46 % of the mountain area over India at 94-81 Ma — because the override
  footprint test required a whole piece to fit and neither 601 nor 606 had a
  mountain entry at all. Every override plate now applies to every class on one
  footprint per plate; a piece is rebound by `PLATEID1` when its centroid and at
  least half its area lie inside that footprint; and any piece the binding would
  carry more than 1,000 km from its `PLATEID1` position is dropped and counted
  rather than drawn. The 250 km frame-conflict flag still marks what remains.
- Draw a map in the 10 kyr seam between two adjacent published intervals. The
  schedule is contiguous in intent - `29-20` is followed by `20-11` - but the
  exclusive young bound is written 0.01 Ma above the next interval's inclusive
  oldest age, so the ages in `(20, 20.01]` were covered by neither rule at all of
  the 23 interval boundaries. The age domain still said the layer was inside the
  Cao band, no interval was ever selected, nothing was published, and the mode
  latched at "loading" with the globe drawn as if the layer were off for the rest
  of the session, because only an age change wakes the pump. Scrubbing to exactly
  20 Ma reproduced it every time: the timeline's own round-trip lands a hair
  above 20. An age in a seam now takes the older interval whose padding created
  it, and the real 1.98 Myr gap below the Cao band - where there is genuinely no
  map - is excluded by the seam's declared width.
- Recover the palaeo-coastline layer from a refused publication instead of
  latching it at "loading". Every trip out of the published age domain cleared
  the palaeo publication, and each clear handed the bounded GPU retirement owner
  a resource it declined; the publisher kept the declined bytes in its ledger
  forever, so after about a dozen interval changes in one page the next
  publication no longer fitted its 512 KiB budget. The scene then drew nothing
  while the pump, believing its own bookkeeping, never asked again. A declined
  retirement is now disposed and leaves the ledger (a device-loss failure still
  does not), the scene reports a refused publication to the owner of the
  interval, and the pump drops the interval it is not showing and asks again,
  bounded, before it reports an error.
- Keep the opened map key clear of the floating chapter card at 390x844.
- Draw the Middle Jurassic Scottish landmass as land instead of as water of
  unknown depth. At 170 Ma the present-day point (-3, 58.8) rendered in the
  crust blue that means "no class is mapped here" while the Moray Firth 90 km
  south was land. Cao et al. (2017) do map it: that ground is their mountain
  class, which they treat as terrestrial and which the byte budget does not
  fund, so it never reaches the browser. 17,742 km2 of the 20,045 km2 the new
  operation outlines is mountain, 2,121 km2 is ground Cao already calls
  landmass, and only 209 km2 carries no Cao class at all. The operation
  restates that classification in a class we publish rather than correcting the
  source - it adds 17,061 km2 of landmass over northern Scotland, the Pentland
  Firth and Orkney and moves neither of Cao's boundaries, because none of the
  outline falls on the interval's shallow-marine class - with four published
  sources cited as an independent check on the sign (Cox & Sumbler 2002 on the
  emergent Jurassic Scottish land area, Johnson et al. 1993 on the
  Orkney-Shetland Platform, Underhill & Partington 1993 on the Mid-Jurassic
  dome, and the NSTA/OGA Central North Sea and Moray Firth Bathonian facies
  sheet, whose only classes over that hinterland are "Coastal and alluvial
  plain heterolithics" and "Uplands"). The class gap it exposes is global, not
  local, and is recorded with its measurements rather than fixed here: 3.9
  million km2 at 179-166 Ma, 15.8 at 49-37 and 23.6 at 20-11 Ma of Cao mountain
  ground lie inside the continental crust extent carrying neither shipped
  class. The Eocene East Shetland Platform east of 0.2 E was reviewed in the
  same pass and deliberately left as shallow marine: the NSTA Eocene Alba sheet
  describes it as shelf and deep-water sandstone, the Middle Eocene
  fluvio-deltaic unit is confined to the platform's southern part, and the one
  emergence statement names the Shetland Platform west of it. The validator now
  holds an unedited control at (0.5, 61) that fails if the land is ever
  extended east without a citation.
- Stop the collapsed chapter card covering the open map key on a phone. At
  390x844 the key panel opens full width to just under the header, and the
  chapter card sat on top of it, hiding the key's own heading and its first
  colour swatches. The open key now outranks the chapter card and still passes
  under the timeline and the header, which it never reaches. Closed, the key
  pill keeps its old place in the stack, and nothing about the panel's size,
  contents or behaviour changes.

- Keep today's land on the globe where the Cao 2017 maps stop. With the
  palaeo-coastline layer switched on at an age outside 2.01-402 Ma the mode
  correctly fell back to today's composition, but the native land fill was
  hidden anyway: visibility keyed off the layer flag rather than the effective
  mode, and with the palaeo instance drawing nothing the shelf shone through
  where a coastline belongs. At 0 Ma Africa rendered as shallow sea - land
  pixels fell from 243,499 to 375 over the globe canvas and 70 per cent of it
  differed from the layer-off control by a mean 56.9 of 255 per channel - while
  the map key said it was showing the Cao 2024 coast proxy. Native land, the
  composite pick and coverage and the guide-label ink now all follow one
  effective mode that hides land only while Cao 2017 charts are actually drawn
  over it, carrying the same one-frame hysteresis as the fallback transition, so
  a link, a scrub across either boundary and a toggle at the present day each
  leave exactly today's globe. The reported palaeo asset bytes follow the same
  rule as the reported interval, charts and triangles: what is on screen, so the
  resident outline tone tables no longer count at a fallback age. Two browser
  checks compare the whole globe canvas at 0 and 500 Ma against their layer-off
  controls per channel. In the same change the map key stops offering a
  "Palaeo mountain" swatch for the class the budget does not fund, and its panel
  takes the height the stage leaves it instead of a fixed 440 pixels that cut
  the outline legend and the evidence list off below the fold.

## [0.1.11] - 2026-09-14

### Fixed

- Remove the duplicate Denmark and keep it on the Norwegian side of the North
  Sea rift. Cao v2.4 draws the Danish coastline on four plates (330, 315, 302
  and 30204) and gives the Tornquist Block (330) a 0.59 degree stage that
  drifted one copy about 40 km south-west from 170 Ma back, so two Denmarks
  appeared and the Kattegat opened going back in time; this was already the
  case in v0.1.9. The North Sea restoration contract now binds every Tornquist
  Block chart (26 coast and shelf charts, the DNK, POL and SWE outline
  fragments) to Baltica's native motion from 130 Ma back, so all copies stay
  coincident and Denmark, the Netherlands, Norway and Sweden share one
  motion. The moving block is unchanged: Britain and Ireland close the Viking
  and Central Graben toward Norway and Denmark (Shetland-Bergen 72 km by
  270 Ma). A single rigid rotation cannot also close the Skagerrak, and no
  sourced closure exists for it, so Denmark does not move; the runtime probe
  test now checks that every Danish copy stays within 0.5 km of the others and
  that Aarhus and Gothenburg keep their distance to Bergen at every age.

## [0.1.10] - 2026-09-14

### Fixed

- Stop drawing present-day lakes as shallow sea in deep time. The Cao v2.4
  coast layer leaves 48 large modern lakes (Victoria, Tanganyika, Malawi,
  Turkana, Albert, the Laurentian Great Lakes, Baikal, Ladoga and others) as
  voids inside the continental-outline underlay with the owning plate's full
  lifecycle, so Lake Victoria read as marine shelf at 450 Ma. A new lake-void
  infill correction (101 charts, 715,323 km², `data/corrections/lake-voids/`)
  fills each void with the land appearance strictly older than the lake's
  cited basin onset (29 curated onsets, for example Tanganyika 10.5 Ma,
  Malawi 8.6 Ma, Victoria 0.4 Ma, Baikal 30 Ma) or, for lakes without a
  citation, at every age older than exactly 0 Ma. The present-day appearance is
  unchanged; no native geometry, motion or lake outline is backdated. The
  correction contract, its seven-mutation self-test and a runtime probe test
  join `make gate`; the composed package grows to 403,322 vertices, still under
  the 520,000 renderer reservation, and the requested-age motion tiles were
  rebound to the new catalog identity.
- Open the North Sea rift going back in time. Cao v2.4 keeps Britain rigid to
  Baltica from 0 to 430 Ma, so England and Norway never changed distance. A
  tracked regional restoration (`data/corrections/north-sea-restoration/`)
  rotates the UK-side charts (Scotland, Shetland, Ireland, England, Wales and
  the GBR/IRL outlines; 28 charts on plates 303 and 315) relative to Baltica
  about a pole fitted to the Müller et al. 2019 North Atlantic deforming
  network, scaled so the Shetland-Bergen transect closes by the published
  Mesozoic extension: 0 km below 130 Ma, 27 km by 170 Ma (Late Jurassic
  phase), 72 km by 270 Ma (Permian-Triassic phase), then constant to each
  chart's oldest age. Aberdeen-Stavanger closes 47 km; Baltica, Norway,
  the Netherlands and France do not move. Straddling shelf polygons stay on
  Baltica. Two palette entries (836 samples) and 28 rebindings are the only
  package change; a pyGPlates oracle (2.8e-5 rad maximum residual), a
  pure-Python validator with five contract mutations and a runtime probe test
  guard it, and the requested-age motion tiles were rebound.
- Describe the East African Rift honestly: the point of interest now states
  that the globe carries the Cao v2.4 Somalia-Nubia opening (about 86 km at
  Nairobi since 20 Ma) on the eastern branch and that the western branch's
  10-30 km per basin is below regional-zoom resolution and is not modelled.

## [0.1.9] - 2026-09-14

### Fixed

- Keep the modern-country reference outlines thin. 0.1.8 made them continuous
  by unioning nine overlapping one-pixel copies at sub-pixel offsets, which
  read as a 2.0 CSS px stroke. Each segment is now expanded into a
  screen-space quad and shaded from the analytic distance to its own centre
  line, so the core is 1.0 CSS px at any pixel ratio with the antialiasing ramp
  outside it and no beading on diagonals. One draw replaces nine, the darker
  contrast underlay is gone, and the uncapped median frame interval falls from
  1.7 ms to 1.4 ms at pixel ratio 2 and from 1.1 ms to 0.9 ms on the
  low-quality profile. Analytic horizon occlusion, the far-side collapse and
  the display-height guard are unchanged, and no reconstruction geometry
  changed.
- Modern-country outlines no longer read as dashed lines at reconstructed ages.
  The 0 Ma Natural Earth complement bound every subdivision the Cao static-polygon
  partitioner rejected to an exact-present locator chart with a [0, 0] Ma
  lifecycle, so 2,031 of 12,045 segments vanished above 0 Ma. A tracked
  source-fragment bridge rebinds 1,709 of them to the Cao static fragment the
  partitioner verified at a shared endpoint of an accepted neighbouring segment;
  the 322 with no accepted neighbour stay unavailable above 0 Ma. Segment
  geometry, order, country identity and the 0 Ma overlay are unchanged, and
  central-Africa segments inactive at 71.65 Ma fall from 219 to 13 of 1,236.

## [0.1.8] - 2026-09-14

### Fixed

- Draw the modern-country reference outlines as continuous lines. Both
  backends rasterize a one-device-pixel line, whose multisample coverage split
  across pixel rows along every diagonal and read as beads. Each outline style
  is now drawn at several sub-pixel screen offsets that union into a solid
  stroke in the same colours. Because a shifted copy has no matching depth,
  the outlines no longer depth test; they are occluded analytically at the
  globe horizon, exact at every zoom, with far-side vertices collapsed in the
  vertex stage and the pose graph kept there through a varying. Uncapped
  measurement puts the median frame interval at 1.7 ms against 2.5 ms at device
  pixel ratio 2 and 1.1 ms against 1.9 ms on the low-quality profile. A
  publication guard rejects a package display height that could lift the
  surface through the outline shell. No reconstruction geometry changed.
- Place the graticule guide labels on the lines they name with a 1-2 CSS px
  clear margin, stop mirroring the meridian labels (their tangent frame was
  left-handed against the outward normal), advance parallel labels by true arc
  instead of degrees of longitude, and size each label sheet to its own string
  so long labels are no longer condensed.
- Ink each guide label from the reconstructed surface under it: dark grey
  #4a4f54 where a land chart covers the segment, light grey #d0d4d5 over shelf
  and open ocean. Measured on the rendered surface the light ink reaches
  5.7-6.1:1 on deep ocean and 2.8-3.0:1 on shelf, and the dark ink 2.9:1 on
  land. Each label is four segments classified from the live Cao surface with
  hysteresis, so the choice follows plate motion as the timeline scrubs.
  Coverage comes from a new read-only `coversDirection` accessor on the Cao
  foundation renderer.
- Draw land instead of deep ocean where the Cao v2.4 model leaves observed
  modern land with no chart at present day. A global audit of the compiled
  package against Natural Earth 1:50m land found 180,488 km² with neither a
  land nor a shelf chart, all caused by Cao static partitions that have no
  counterpart polygon in `shapes_coasts` or `shapes_continents`: the Yemen and
  south-west Saudi highlands, the Niger delta with the Cameroon and Equatorial
  Guinea coast, the Senegal and Mauritanian coast, Kerguelen, the Canaries, the
  Galapagos, Socotra, Corsica and Sardinia, Reunion, the Darien coast,
  Mauritius, the Louisiade islands and Zanzibar. One tracked exact-present
  correction fills all thirteen from Natural Earth 1:50m land minus the native
  Cao coast footprint, with zero overlap against native land, shelf or the
  Iceland and Panama corrections, no new motion entry, and a lifecycle valid
  only at 0 Ma. Public data grows by 42,963 bytes. 87 further components
  (931,079 km²) remain deliberately uncorrected with recorded reasons, mostly
  on plates without a present-day palette entry. Angola and Niger are not
  coverage gaps: the visible Angolan offset is the 1:110m country locator up to
  31.7 km seaward of the 1:50m coast, and Niger's patch is the Lake Chad shore.

## [0.1.7] - 2026-09-14

### Fixed

- Keep the last rendered Cao surface on the globe while a scrubbed age is still
  loading, with the map key reporting the loading and shown ages. The released
  build hid the whole land group on every age sample until its motion frame
  arrived, which flashed landmasses on and off on phones.
- Darken the modern-country reference outlines so they read on pale land and
  shelf water at phone sizes.

### Changed

- Continuous scrubbing keeps a motion tile download that already covers the
  new age, retains a tile that lands after its requesting age moved on, and
  no longer cancels the background all-age palette or checkpoint warming on
  each age change. Background requests carry a low priority hint, hold body
  reads while a foreground tile is in flight, and decode only after the
  foreground age has rested for 250 ms; checkpoint prefetch waits for the
  scrub to settle. On the measured mobile-throttled 0-70 Ma burst this cut
  motion requests from 38 starts with 35 aborts to 4 with none and settle
  after the last input from 242 ms to 24 ms, with no blank frames.

## [0.1.6] - 2026-09-13

### Added

- Complete the schematic globe graticule with four cardinal meridians and
  compact one-degree ticks at the minor-longitude crossings.
- Show the URL-requested Cao age from a verified 25 Ma motion window, then
  verify the full timeline motion and checkpoint assets in the background with
  cancellable age priority, accurate loading status, and retry after failure.

### Fixed

- Reuse byte- and SHA-256-verified content-addressed reconstruction payloads
  across page refreshes while continuing to revalidate the package manifest.
- Keep reconstructed land and shelf normals in the renderer's expected view
  space, and keep inspection lighting aligned with the camera so orbiting cannot
  turn the visible globe into an unlit side.
- Restore source-backed native land around Australia and Oceania where valid
  Cao polygons were lost to triangulation, with refined motion bindings across
  the affected source intervals.
- Add exact-present observed land across the Panama isthmus while retaining its
  source-bounded single-age lifecycle.
- Complete the exact-present modern-country reference overlay from the pinned
  Natural Earth source, improve line contrast, and keep unsupported historical
  fragments absent rather than assigning speculative motion.
- Represent two discontinuous plate-626 source seams as explicit unsupported
  intervals so affected charts disappear inside the gaps and reacquire their
  authored poses at both endpoints.

## [0.1.5] - 2026-09-13

### Changed

- Replace the permanent surface footer with a compact, expandable map key that
  keeps live status visible, uses one land color, and lists evidence categories
  separately.

### Fixed

- Restore Iceland at 0 Ma from a regional-scale 1:50m observed land outline
  and show only bounded model-pose volcanic material at older supported ages,
  split across the Cao North America–Eurasia ridge without treating 16.3 Ma as
  island birth.
- Add a public-domain Natural Earth 1:10m generalized 0–200 m shallow-marine
  context around modern Iceland, active only at exactly 0 Ma, and keep shelf
  and land meshes clear and ordered with measured display-only shell bounds.
- Restore three Barents and Svalbard shelf polygons at 422 Ma using their
  matching Cao source lifetimes through 600 Ma; water depth remains unknown.
- Restore six European and Avalonian shelf lifecycles across the 410–420 Ma
  source cutoffs, using matching Cao boundary geometry and motion validated
  through 600 Ma.
- Make the timeline easier to acquire and drag on touch screens with a larger
  hit area, immediate thumb feedback, stable endpoint mapping and safe gesture
  cancellation.
- Make a locked position visible against light land and dark water with a
  small, steady dual-contrast ring and center dot, place it at the selected
  globe position, and preserve the user's current zoom when the lock is selected.

## [0.1.4] - 2026-09-12

### Added

- Add source-qualified regional material corrections for northern Canada,
  Pearya, Svalbard, Barents and western Laurentia, with static provenance,
  licensing, uncertainty, validation and performance records.
- Add a deterministic correction-package gate covering acquisition and
  compilation contracts, source checksums, emitted geometry and manifests.

### Changed

- Ship the live cao-v2.4 package over the full compiled Cao source domain
  (`ageDomainMa` 0–1800 Ma): 235 display checkpoints (5 Ma to 540 Ma, then
  10 Ma), layered coastline-class land over continental-outline shelf, native
  boundaries/ownership including `1800-1000_plate_boundaries.gpml`, and a
  shared motion palette sampled on every qualified source knot plus bounded,
  source-derived interior samples. Public transitive size stays under the
  50 MB Pages budget without PaleoDEM bins.
- Scrubbing continuously interpolates Cao plate motion from the resident shared
  palette between display knots, retargeting the published foundation in place
  instead of waiting for discrete prepare snaps. Adjacent checkpoints are
  prefetched only as a bounded aid on top of that interpolation.
- Timeline ranges are Phanerozoic (ICS 538.8–0 Ma) and Precambrian (authored
  deep-time / live Cao oldest through today at 0 Ma), so Precambrian mode can
  still scrub forward through the Phanerozoic; the Recent Earth range is removed.
- Age-domain gating and continuous play follow the live package `ageDomainMa`
  (cao-v2.4 declares 0–1800 Ma) rather than hard-coded ceilings.
- Replace two materially misleading western North America native charts with
  guarded, source-domain fragments whose lifecycles preserve independently
  supported old material and withhold younger or unknown-age domains.
- Remap affected modern-country reference segments to replacement domains and
  expose correction evidence, status and limitations in the interface.

### Fixed

- Recover empty globe after Cao package promotes that keep the same filenames:
  load verified assets with content-addressed `?h=<sha256>` URLs and `cache: no-store`
  so a stale browser/CDN body cannot fail checksum verification against a newer
  manifest (full-domain 0–1800 ship reused `cao-foundation-v1` paths).
- Keep Fennoscandia (and other Eurasian plates) visible through 118–120 Ma:
  cap adaptive refinement so the compiled palette retains explicit continuous
  bindings, and reject any package binding gap instead of inventing a
  nearest-endpoint pose.
- Refine native and correction motion intervals with pinned source-derived
  samples where endpoint interpolation exceeded the angular pose contract;
  oracle checks stay below `1e-5` radians across the affected native entry
  spans and correction bindings through 540 Ma.
- Keep continents visible when scrubbing to today (0 Ma): retain the last
  prepared foundation until the next exact-knot prepare is ready, withhold an
  actively failed exact checkpoint, and ignore that failure after a later age
  has successfully retargeted the surface.
- Precambrian timeline range again spans deep time through today (0 Ma): the
  scrubber is no longer clamped to ages older than ICS 538.8 Ma, and switching
  into Precambrian mode keeps the current age instead of jumping to the Cambrian
  base.
- Stop flooding `history.replaceState` on every continuous age tick while
  scrubbing or playing; coalesce explorer hash sync (~4 Hz) so Chromium does
  not throttle navigation IPC and hang the tab, while globe motion still
  interpolates every frame.
- Complete the material location-lock follow path: camera tracks the tagged
  Cao material through continuous scrub and chapter changes, with a subtle
  on-globe marker and an Unlock control while focus is active.
- Retarget source-linked globe markers on every continuous motion frame so
  anchors remain aligned with the moving foundation between display knots.
- Draw reference-guide labels as curved surface ribbons fixed in geographic
  space and replace upright pole sprites with flat polar sector ticks on the
  globe (globus-style guides).
- Keep corrected material, picking and dependent country references aligned
  through native precedence, source-age transitions and reconstructed motion.
- Subdivide long spherical correction triangles so their rendered edges follow
  the globe instead of visibly sagging through it.

### Known limitations

- Cao Caribbean / Panama at 0 Ma: Cuba land, shelf and `country:cub` are
  correctly placed; the oversized Cao `Jamacia` continental outline and missing
  Central/Eastern Panama (plates 230/229) coast/continent rings make the isthmus
  look broken or “crossed”. See `docs/research/cao-caribbean-panama-cuba.md`.
- This foundation deliberately uses neutral surfaces. Calibrated mountains,
  bathymetry, shallow-sea masks, global seafloor ages and historical biome
  detail are deferred; previous modern-only detail is no longer rendered.
- Native coast-class polygons are model geography, not independently validated
  exposed-land outlines. Unsupported country fragments and POIs are omitted.
- Correction footprints describe supported material domains, not exposed land,
  palaeoshorelines, elevation or exact terrane reconstructions. Northern
  Canada, Pearya, Svalbard and Barents retain explicit uncovered target areas;
  western replacements withhold material where source age or affinity remains
  unresolved.
- Display checkpoints coarsen to 10 Ma beyond 540 Ma so the Pages budget
  remains reachable; continuous motion still follows the qualified source-knot
  clock through 1800 Ma. Editorial chapter globe states may still apply where
  authored narrative exceeds the compiled evidence for a scene.

## [0.1.3] - 2026-09-10

### Changed

- Adopt Cao 2024 v2.4 as the sole reconstruction foundation, with 109 native
  checkpoints from 0–540 Ma and a shared, source-qualified motion clock.
- Store geometry once and use one GPU rendering path for present-day and
  ancient continents, country references and native tectonic boundaries.
- Replace the previous PALEOMAP conversion, modern-only relief inputs, terrain
  workers and caches with the native Cao package and bounded checkpoint loading.
- Preserve the orbital interface, chapter navigation, field notes, globe guides
  and WebGL2 fallback. Older chapters use explicitly editorial globe states.

### Fixed

- Load both authored Cao rotation files, including younger-age parent ties in
  the older-named file, to retain native US and Amazon geometry and its motion.
- Keep tagged material and supported POIs on the same coordinate authority as
  the globe, preserving camera distance through motion and support gaps.
- Bind integer motion-palette attributes correctly on WebGL2.
- Release superseded or unrenderable prepared states and withhold stale maps
  after failed age changes.
- Validate every nested scientific asset and its size and checksum.

### Known limitations

- This foundation deliberately uses neutral surfaces. Calibrated mountains,
  bathymetry, shallow-sea masks, global seafloor ages and historical biome
  detail are deferred; previous modern-only detail is no longer rendered.
- Native coast-class polygons are model geography, not independently validated
  exposed-land outlines. Unsupported country fragments and POIs are omitted.
- Continental motion interpolates on its qualified source clock. Native
  boundary and ownership geometry is available only at exact checkpoints.
- The initial package covers 0–540 Ma; the model's older domain is not yet
  compiled into the application.

## [0.1.2] - 2026-09-10

### Added

- Shared land/ocean period coordinates, material-registered elevation interpolation,
  and a selectable Cao 2024 v2.4 view with partial continental conversion,
  source-native ocean boundaries and explicitly inferred seafloor relief.
- All 109 PALEOMAP frames from 0–540 Ma, with native source-age navigation,
  compact signed-elevation assets and bounded abortable caches.
- Modern Alps and Japan ETOPO views, bringing the regional set to seven,
  and explicit shared surface-water/seafloor use of compatible controls.
- An all-age exposed-seafloor view and a cited palaeomap source/acquisition study.

### Changed

- Terrain color and mountain rock/shading strength follow physical height,
  local relief and climate potential; synthesized detail stays in shading.
- Source-local relief, blue bathymetric shading, closer aerial inspection,
  restrained country outlines and smaller surface-oriented labels and markers.
- Neighbor-aware tile allocation uses the existing detail and memory limits.

### Fixed

- Include the canonical third-party notices in the Pages bundle and validate
  that the packaged copy matches.
- Check country-outline budgets separately for every source age, retaining full
  coverage without an aggregate test timeout.
- Removed the rectangular shading wall at the Mid-Atlantic regional relief boundary.
- Keep old surface textures alive until visible terrain releases them, preventing
  WebGPU invalid texture submissions during historical regional transitions.
- Tagged locations retain zoom while following reconstructed coordinates.
- Fractional-age refinement no longer repeatedly reinserts stale mesh fields
  into the terrain cache and prevents the next surface from publishing.
- Exact present-day publication restores immutable native geometry and materials
  directly, avoiding redundant temporal calculations while preserving relief changes.
- Automatic focus prepares final camera refinement once; manual input cancels
  the automatic move and resumes normal navigation.

### Known limitations

- Close terrain remains coarse and generalized relative to satellite-map references.
  The Caledonian collapse history and detailed ancient valleys are not resolved.
- Historical all-stage preparation remains slightly above the conservative
  500 ms comparison, although the original material preparation and steady-frame
  targets pass on the measured machine.

## [0.1.1] - 2026-09-09

### Added

- Sparse, age-aware regional surface refinements with a two-level EMODnet DTM
  2024 bathymetry example for the central North Sea.
- Subtle terrain-anchored poles, Hadley boundaries, east/west references and
  dominant-wind guides, available from the layers menu.
- Temporal area anchors that retain exact reconstructed feature identity
  through movement, disappearance and reappearance between periods.

### Changed

- Restyled modern-country locator outlines as subdued, batched ribbons inlaid
  into the displayed terrain and anchored through relief exaggeration.
- Made Natural Earth geometry authoritative for present-day land masking while
  retaining signed PaleoDEM controls for historical snapshots.
- Filtered Field Notes to the currently selected period and refined globe-click
  focus toggling.
- Reduced refresh work with bounded cloud resolution, shared geometry buffers,
  deferred overlay rebuilding and debounced camera refinement requests.

### Fixed

- Removed the local material override that exposed the North Sea refinement as
  a dark rectangular footprint.
- Eliminated the polar inspection-light jump and strengthened pole-safe surface
  sampling.
- Corrected land/sea material classification around coastlines and prevented
  country references from floating above exaggerated relief.

## [0.1.0] - 2026-09-09

### Added

- Interactive WebGL/WebGPU-capable orbital globe with regional zoom, adaptive
  detail, bounded worker-generated surfaces and accessible controls.
- Thirty-seven chapters from 4.567 Ga to the present, including explicit
  early-Earth illustrative stages and distinct story and geography-source ages.
- Eighteen compact PALEOMAP PaleoDEM surface controls, reconstructed modern
  country references, tectonic stories and twenty sourced points of interest.
- Modern 1991–2020 Köppen–Geiger climate controls and five lazy ETOPO regional
  relief patches for repeatable landscape views.
- Offline data preparation with pinned downloads, provenance, licensing,
  checksums and published artifact bounds.
- Unit, data-contract and Pages-subpath browser tests, plus a GitHub Pages
  validation and deployment workflow.

### Changed

- Replaced the pole-prone globe sampling with an adaptive cube surface and
  pole-safe fallback/cloud geometry while preserving source geography.
- Draped country, tectonic and river overlays against the displayed relief so
  they remain surface-anchored through 1×–30× exaggeration.
- Consolidated secondary controls into an accessible menu, simplified the
  timeline scale control, added a reference to every period, and made the
  mobile period card compact by default.
- Added explicit POI, place and area focus state with predictable
  activate/clear globe clicks and shareable URLs.
- GitHub Pages now deploys the validated production artifact automatically
  after every successful push to `main`.

### Known limitations

- Early-Earth geography and detailed ancient climate, ice and drainage are
  inferred or illustrative rather than spatial observations.
- Some measured initial and regional scene transitions exceed the current
  500 ms readiness target.
- The project does not yet grant a license for its own source code; bundled
  dependencies and scientific data retain the terms in
  `THIRD_PARTY_NOTICES.md`.
