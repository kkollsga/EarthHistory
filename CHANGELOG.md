# Changelog

All notable changes to EarthHistory will be recorded here.

## [0.1.3] - 2026-09-10

### Changed

- Ship the live cao-v2.4 package over the full compiled Cao source domain
  (`ageDomainMa` 0–1800 Ma): 235 display checkpoints (5 Ma to 540 Ma, then
  10 Ma), layered coastline-class land over continental-outline shelf, native
  boundaries/ownership including `1800-1000_plate_boundaries.gpml`, and a
  shared motion palette sampled on every qualified source knot. Public
  transitive size stays under the 50 MB Pages budget without PaleoDEM bins.
- Scrubbing continuously interpolates Cao plate motion from the resident shared
  palette between display knots, retargeting the published foundation in place
  instead of waiting for discrete prepare snaps. Adjacent checkpoints are
  prefetched only as a bounded aid on top of that interpolation.
- Timeline ranges are Phanerozoic (ICS 538.8–0 Ma) and Precambrian (authored
  deep-time / live Cao oldest through today at 0 Ma), so Precambrian mode can
  still scrub forward through the Phanerozoic; the Recent Earth range is removed.
- Age-domain gating and continuous play follow the live package `ageDomainMa`
  (cao-v2.4 declares 0–1800 Ma) rather than hard-coded ceilings.
- Adopt Cao 2024 v2.4 as the sole reconstruction foundation, with 235 native
  checkpoints from 0–1800 Ma and a shared, source-qualified motion clock.
- Store geometry once and use one GPU rendering path for present-day and
  ancient continents, country references and native tectonic boundaries.
- Replace the previous PALEOMAP conversion, modern-only relief inputs, terrain
  workers and caches with the native Cao package and bounded checkpoint loading.
- Preserve the orbital interface, chapter navigation, field notes, globe guides
  and WebGL2 fallback. Older chapters use explicitly editorial globe states.

### Fixed

- Recover empty globe after Cao package promotes that keep the same filenames:
  load verified assets with content-addressed `?h=<sha256>` URLs and `cache: no-store`
  so a stale browser/CDN body cannot fail checksum verification against a newer
  manifest (full-domain 0–1800 ship reused `cao-foundation-v1` paths).
- Keep Fennoscandia (and other Eurasian plates) visible while scrubbing through
  the open 118–120 Ma Cao motion-binding gap: bridge adjacent compiled palette
  endpoints instead of treating the compiler adaptive dropout as missing motion.
  Future package rebuilds cap adaptive refinement instead of dropping those leaves.
- Keep continents visible when scrubbing to today (0 Ma): retain the last
  prepared foundation until the next exact-knot prepare is ready, do not clear
  React state on prepare/request failure, and do not tear down the published
  surface on a transient render error.
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
- Draw reference-guide labels as curved surface ribbons fixed in geographic
  space and replace upright pole sprites with flat polar sector ticks on the
  globe (globus-style guides).
- Keep continents visible while scrubbing or playing through Cao ages: retain
  the last published foundation until the next prepare lands, coalesce rapid
  age ticks, and continuously retarget motion so plates interpolate between
  prepares. Outside the live package domain, keep the last foundation rather
  than blanking when entering editorial Precambrian chapters from an in-domain age.
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
- Display checkpoints coarsen to 10 Ma beyond 540 Ma so the Pages budget
  remains reachable; continuous motion still follows the qualified source-knot
  clock through 1800 Ma. Editorial chapter globe states may still apply where
  authored narrative exceeds the compiled evidence for a scene.

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
