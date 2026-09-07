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
at a project path such as `/EarthHistory/`.

## Publish GitHub Pages

The public repository is
[kkollsga/EarthHistory](https://github.com/kkollsga/EarthHistory). GitHub Pages
serves the root of its `gh-pages` branch. The validation workflow runs
`make gate-full` for `main` and pull requests and retains the checked `dist/`
output for seven days; it does not deploy automatically.

After the source commit is on `main`, the source worktree is clean, and the
remote `gh-pages` branch exists, publish the validated build with:

```sh
./scripts/publish-pages-branch.sh
```

The script uses the existing `origin` authentication, creates a temporary
worktree from the remote Pages branch, adds `.nojekyll`, commits the exact
validated `dist/`, and performs a normal non-force push. Configure the repository
Pages source to `gh-pages` and `/ (root)` once in GitHub settings. No additional
application secret or runtime API credential is needed.
After that one-time setting, the expected address is
`https://kkollsga.github.io/EarthHistory/`.

## Explore the globe

- Drag to orbit and use a wheel or pinch gesture to zoom from a global view to
  an aerial regional view.
- Scrub or play the timeline, step between chapters, or use the chapter picker.
- Open **Layers** to toggle the modern-country reference, tectonics, inferred
  drainage and clouds. Clouds start off so the surface remains readable.
- Adjust **Terrain relief** from 1× to 30×. This changes display displacement;
  it does not alter the source elevation values. The default is 8×.
- Open field notes to inspect dated places and events. A globe-location action
  appears only when the active reconstruction has a defensible display point.
- Use **Share view** to copy the selected chapter, layers, quality and relief to
  the URL.

## Scientific data

Eighteen PALEOMAP PaleoDEM v2 source grids cover 0–540 Ma. The atlas selects the
nearest authored grid and never implies interpolated coastlines between them.
The chapter time remains separate from `geographicSourceAgeMa`; for example,
the 66.04 Ma K–Pg story uses the 65 Ma grid and the 21 ka Last Glacial Maximum
uses the 0 Ma grid.

Earlier chapters are explicitly illustrative scenes. They express sourced
stages such as accretion, a Moon-forming impact scenario, magma-ocean cooling,
growing oceans, early life and global glaciation without claiming resolved
Hadean, Archean or Proterozoic geography. Their procedural crust and climate
fields are artistic or inferred controls, and the interface shows that status.

Modern Natural Earth outlines are observed reference data. Deep-time country
lines are present-day political references reconstructed with the PALEOMAP v3
plate model where that model supports them; they are never presented as
historical borders. Ancient rivers, detailed ice margins and biome boundaries
remain inferred potential rather than mapped observations.

See [the data guide](docs/data/README.md) for coordinate conventions,
provenance, license terms, preparation commands and uncertainty. The exact
runtime inventory, byte sizes and SHA-256 digests live in
[`public/data/manifest.json`](public/data/manifest.json). Third-party software
and data notices are collected in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Reproduce the data

The checked-in runtime controls total about 5.1 MiB. Their preparation happens
offline; downloaded archives stay in the bounded, gitignored
`dev-docs/temp/earthhistory-data/` workspace.

```sh
python3 scripts/prepare-data.py
python3 scripts/prepare-data-countries.py
python3 scripts/prepare-data-modern.py
python3 scripts/prepare-data-relief.py
```

The second command needs pyGPlates 1.0. Preparation pins source archive
checksums and rewrites the manifest. Do not regenerate checksums simply to make
a validation failure disappear; verify any upstream change first.

## Validate changes

```sh
make gate             # doctrine, adapters, types, unit/data tests, build, hashes and budgets
make gate-full        # gate plus the Chromium Pages-subpath browser suite
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

- PaleoDEM is interpreted model output at a coarse 2° runtime sampling. It is
  suited to global and broad regional stories, not site-scale terrain.
- Early-Earth geography is unresolved and deliberately non-geographic.
- Present-day climate potential uses a 0.5° 1991–2020 Köppen–Geiger control;
  it is a climate classification rather than mapped vegetation. Ancient
  vegetation and ice retain broad era, latitude and elevation limits and are
  not surveys, palaeoclimate simulations or observed ice outlines.
- Five modern regional views can lazily load 256² ETOPO surface-relief patches.
  They remain broad aerial controls rather than summit, valley or seafloor
  survey detail.
- Country references become less complete with age as unsupported fragments
  disappear from the plate reconstruction.
- The globe is an aerial experience. Close terrain flight, detailed basin
  sections and subsurface geological or petroleum-system models are outside
  this release.

The project does not yet declare a license for its own source code. Dataset and
dependency licenses apply only to their respective material.
