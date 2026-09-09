# Changelog

All notable changes to EarthHistory will be recorded here.

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
