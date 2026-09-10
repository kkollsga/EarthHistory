# EarthHistory

EarthHistory is an interactive orbital atlas of Earth from planetary formation
to the present. It combines a Three.js globe with a 37-chapter geological
timeline, regional zoom, cited field notes, reconstructed present-day country
references, and procedural terrain, ice, vegetation, clouds and drainage.

The runtime is fully static. It does not call map, terrain, scientific or paid
data services after the page loads.

## Run locally

Use Node.js 22.12 or newer. The Pages workflow uses Node.js 24.

```sh
npm ci
npm run dev
```

Create and inspect the production site with:

```sh
npm run build
npm run preview
```

Vite emits the site to `dist/` with relative asset URLs, so the same build works
at a project path such as `/EarthHistory/`. Production builds omit source maps
to reserve the static artifact budget for scientific data. Use the development
server for source-level debugging.

## Publish GitHub Pages

The public repository is
[kkollsga/EarthHistory](https://github.com/kkollsga/EarthHistory). GitHub Pages
deploys through GitHub Actions. Pull requests run the deterministic gate plus a
focused Pages/browser smoke set without publishing; the complete
browser union remains the local release gate. Every successful push to `main`
validates the same CI set, retains the checked `dist/` output for seven days,
uploads the Pages artifact, and deploys that exact artifact. The workflow can
also be dispatched manually on `main` to republish the current commit.

Configure the repository Pages source to **GitHub Actions** once. The workflow
uses GitHub's built-in Pages token and needs no application secret or runtime
API credential. The production address is
`https://kkollsga.github.io/EarthHistory/`.

## Explore the globe

- Drag to orbit and use a wheel or pinch gesture to zoom from a global view to
  an aerial regional view.
- Scrub or play the timeline, step between chapters, or use the chapter picker.
- Jump directly among all 109 PALEOMAP source frames at 5 Ma intervals from
  0–540 Ma without replacing the separate authored chapter catalog.
- Between source ages, follow supported material through its plate rotations
  while elevation changes between registered source samples.
- Select **Cao plate coordinates** in Layers to inspect the Cao 2024 v2.4
  reconstruction, including model-derived ocean relief. Converted continental
  heights have partial coverage; unsupported areas are explicitly masked.
- Open **Layers** to toggle the modern-country reference, tectonics, inferred
  drainage and clouds. Clouds start off so the surface remains readable.
- Adjust **Terrain relief** from 1× to 30×. This changes display displacement;
  it does not alter the source elevation values. The default is 8×.
- Open field notes to inspect dated places and events. A globe-location action
  appears only when the active reconstruction has a defensible display point.
- Use **Share view** to copy the selected chapter, layers, relief and modern
  landscape to the URL.

## Scientific data

All 109 PALEOMAP PaleoDEM v2 source grids cover 0–540 Ma in 5 Ma steps. At
intermediate ages, supported material is reconstructed into both neighboring
source grids before elevation interpolation. Unsupported material uses an
explicit discrete fallback. Chapter age, source ages and interpolation status
remain separate; smooth movement is not additional geological evidence.

The period-coordinate core names the model, version, reference frame, anchor,
material identity and valid reference age. Terrain, country references and
tagged locations use this contract, including vanished ocean crust. In the
Cao view, ocean formation/loss controls and ridge/trench geometry come from
the same model. Inferred thermal depth and boundary morphology are disclosed
models, not measured ancient bathymetry. The complete PALEOMAP view remains
the default because conversion into Cao coordinates has documented gaps.

Satellite-style albedo, bump and roughness detail give the coarse scientific
controls a more natural appearance. This fine texture is procedural synthesis
attached to the moving material; it does not increase the resolution or
certainty of the reconstructed geography.

Earlier chapters are explicitly illustrative scenes. They express sourced
stages such as accretion, a Moon-forming impact scenario, magma-ocean cooling,
growing oceans, early life and global glaciation without claiming resolved
Hadean, Archean or Proterozoic geography. Their procedural crust and climate
fields are artistic or inferred controls, and the interface shows that status.

Modern Natural Earth outlines are observed reference data. Deep-time country
lines are present-day political references reconstructed with the selected
plate model where it supports them; they are never presented as
historical borders. Ancient rivers, detailed ice margins and biome boundaries
remain inferred potential rather than mapped observations.

See [the data guide](docs/data/README.md) for coordinate conventions,
provenance, license terms, preparation commands and uncertainty. The exact
runtime inventory, byte sizes and SHA-256 digests live in
[`public/data/manifest.json`](public/data/manifest.json). Third-party software
and data notices are collected in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Reproduce the data

Runtime controls are prepared offline; their exact sizes and checksums are
recorded in the manifest. Existing preparation inputs use the bounded,
gitignored `dev-docs/temp/earthhistory-data/` workspace. The larger palaeomap
study owns a separate bounded source store at
`../EarthHistory-data/palaeomap-study/`; research archives never enter the
application build.

```sh
python3 scripts/prepare-data.py
python3 scripts/prepare-data-countries.py
python3 scripts/prepare-data-modern.py
python3 scripts/prepare-data-relief.py
python3 scripts/prepare-paleomap-motion.py
python3 scripts/prepare-cao-ocean-motion.py
python3 scripts/prepare-cao-continental-motion.py
python3 scripts/prepare-cao-ocean-lifecycle.py
```

Country and plate-model preparation need pyGPlates 1.0. The Cao commands use
the pinned, extracted model in the study source store; see each command's
`--help` for explicit input paths. Preparation pins source archive
checksums and rewrites the manifest. Do not regenerate checksums simply to make
a validation failure disappear; verify any upstream change first.

## Validate changes

```sh
make gate             # doctrine, adapters, types, unit/data tests, build, hashes and budgets
make gate-full        # gate plus the Chromium Pages-subpath browser suite
make gate-full-ci     # checkout-safe deterministic gate plus tagged browser smoke tests
make self-test-gates  # proves size, checksum and cleanup gates reject bad fixtures
```

`dist/` is limited to 50 MiB, with an 8 MiB per-file ceiling. Vite and
TypeScript caches are limited to 100 MiB and can be removed with
`make prune-build-cache`; that command only touches named regenerable caches.
Playwright owns and replaces `test-results/` on each browser run; retained
failure traces and screenshots are local diagnostics and are not published.

The 2026-09-07 publication checkpoint on an Apple M4 with 16 GiB RAM and
headless Chrome using Metal held orbit and regional frame p95 at 16.7–16.8 ms.
Two camera-response measurements were 60.9 and 63.1 ms; regional request-to-ready
measurements were 246.4 and 254.2 ms against a 250 ms target. One sample remains
slightly over target. Generated-data cache use was about 7.9 MB, with no stale
jobs, browser errors or external runtime requests in this run. These are local
measurements, not a guarantee for other browsers or devices.

## Current limitations

- PaleoDEM is interpreted model output at its deposited 1° grid sampling. It is
  suited to global and broad regional stories, not site-scale terrain.
- Early-Earth geography is unresolved and deliberately non-geographic.
- Present-day climate potential uses a 0.5° 1991–2020 Köppen–Geiger control;
  it is a climate classification rather than mapped vegetation. Ancient
  vegetation and ice retain broad era, latitude and elevation limits and are
  not surveys, palaeoclimate simulations or observed ice outlines.
- Seven modern regional views can lazily load 256² ETOPO relief patches.
  They remain broad aerial controls rather than summit, valley or seafloor
  survey detail.
- The reference-driven material pass adds height-controlled rock and source-local
  relief, but the current close views still have generalized land cover and
  coastlines. They do not yet match the supplied satellite-map visual target.
- Country references become less complete with age as unsupported fragments
  disappear from the plate reconstruction.
- The globe is an aerial experience. Close terrain flight, detailed basin
  sections and subsurface geological or petroleum-system models are outside
  this release.

The project does not yet declare a license for its own source code. Dataset and
dependency licenses apply only to their respective material.
