# Changelog

All notable changes to EarthHistory will be recorded here.

## [Unreleased]

### Added

- A toggleable **Palaeo-coastlines (Cao 2017)** layer that replaces the Cao 2024
  coast proxy with mapped palaeogeography for the 24 published map intervals
  from `402-380` to `11-2` Ma. Two classes ship: 26,497 landmass pieces
  (3,339,386 bytes) and 31,869 shallow-marine pieces (3,469,844 bytes), cut from
  7,154 and 13,395 Cao et al. (2017) source records, plus two columnar class
  catalogs (26,796 and 42,849 bytes) and 24 country-outline tone tables
  (102,048 bytes for both files) — 6,980,923 bytes over 52 files, inside the
  7 MiB budget `check-app-artifacts` now enforces. `dist` is 52,057,351 bytes
  (49.65 MiB) against the unchanged 50 MiB ceiling.
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
  mountain class stays compiled and validated offline: it is not funded by the
  byte budget and does not ship.
- Eleven cited local modifications to the Cao 2017 polygons in the North Sea,
  the first basin the plan's edit contract covers. In five of the twenty-four
  map intervals the source misstates the land-sea pattern at basin scale, and
  113,728 km2 of landmass is added and 191,943 km2 of shallow marine removed to
  fix it: the Middle Devonian Orcadian Basin stops being an epicontinental sea
  and goes back to being a lake in a continent (402-380 Ma); the Moray Firth
  emerges in the Zechstein while the Central North Sea evaporite basin stays
  flooded (269-248); the East Shetland Platform and the Brent/Vestland delta
  plain emerge in the Middle Jurassic, the delta plain bounded north by the
  published ca. 60 degrees 30 minutes N limit (179-166); and the Shetland
  Platform emerges in the Palaeocene and Eocene, where Cao's own authors record
  fewer than twenty marine fossil collections constraining the whole globe
  (58-49, 49-37). Each operation carries its rationale, a 40-60 km spatial
  uncertainty, its references with DOI or URL, and an editorial line
  "EarthHistory modification after <refs>"; the edited charts carry those
  references in their evidence records, so the map key names them whenever an
  edited chart is on screen. Every geometry is EarthHistory's own coarse
  five-to-seven-vertex construction sized from the published descriptions, and
  the literature is citation-only: no figure, map plate or coordinate list is
  traced, digitised or redistributed, the two NSTA/OGA regional packages
  (Open Government Licence v3.0) are read as facies descriptions only, and the
  only redistributed palaeogeographic geometry remains Cao et al. (2017). Six
  interval groups are deliberately left untouched and the contract says why,
  including the Late Cretaceous platform flooding and the Forties provenance the
  literature memo flags as unsettled, the Late Jurassic rift seaways Cao already
  gets right, and the northern limit of the Zechstein Sea nothing retrieved
  places. The record is
  `docs/research/palaeo-coastlines-north-sea-edits.md`. The published set grows
  by 5,901 bytes to 6,986,824 over the same 52 files, the renderer reservation
  is unchanged, and the nineteen unedited intervals are byte-identical. In the
  same change the country-outline tone tables stop describing geometry the build
  withholds: they had been inked from the unshipped mountain class as well as
  the landmass class, drawing 261 outline segments at 402-380 Ma dark over land
  the browser never receives, and both the tables and their interval index are
  now built from the shipped class list alone, which the promote script refuses
  to publish against a mismatch.

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
