# EarthHistory

EarthHistory is an interactive orbital atlas of Earth from planetary formation
to the present. It combines a Three.js globe with a 37-chapter geological
timeline, regional zoom, cited field notes, and reconstructed present-day country
references. Native Cao 2024 plate coordinates now form the
shared geographic foundation; calibrated terrain and climate detail follow
separately. See the [adoption record](docs/research/reconstruction-cao-foundation-adoption.md)
for implementation and validation status.

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

- Drag to orbit and use a wheel or pinch gesture for an aerial regional view.
- Scrub or play the timeline, step between chapters, or use the chapter picker.
- Jump among 109 Cao reconstruction checkpoints at 5 Ma intervals from 0–540 Ma.
- Between checkpoints, follow supported material using its qualified motion
  clock. Motion gaps remain explicit.
- Use Layers for modern-country references, native tectonic references and
  schematic globe guides. Exact tectonic geometry is available at marked ages;
  unmatched boundary geometry is not interpolated.
- Relief controls do not create source elevations. The initial Cao foundation
  uses neutral height placeholders while calibrated relief remains deferred.
- Open field notes for dated places and events. Location actions require a
  defensible display point in the active reconstruction.
- Share view records the current exploration state in the URL.

## Scientific data

The foundation uses [Cao et al. (2024), model v2.4](https://doi.org/10.5281/zenodo.13628813).
Its coordinate core identifies the model, reference frame, anchor, material
chart, reference age and validity. Geometry and motion are stored once;
timesteps refer to changing controls. Present-day and ancient states use this
same representation and GPU rendering path.

Native coast-class polygons remain model geometry. They are not an independently
validated atlas of exposed land or shallow seas. Native boundaries preserve
source types, polarity and adjacency. Resolved plate polygons provide
instantaneous ownership, which does not establish persistent ocean material,
seafloor age or crust formation history. Missing information stays explicit.

Additional published geography, calibrated mountains and bathymetry, and
historical climate/biome fields are deferred. The initial land shell's small
rendering offset is not physical elevation. Smooth motion is interpolation
within the model, rather than additional geological evidence.

Earlier chapters use explicit editorial inputs for formation, crust, ocean
and ice scenarios through the same renderer. Native reconstructed geography
is unavailable outside the initially compiled 0–540 Ma domain.

Natural Earth country lines are modern reference data bound offline to Cao
coordinates. Unsupported fragments are omitted. They are never historical
political borders. POI evidence locations retain their publication uncertainty
separately from the reconstruction model's positional support.

See [the data guide](docs/data/README.md) for coordinate conventions,
provenance, licensing and uncertainty. The exact inventory, byte sizes and
SHA-256 digests live in [public/data/manifest.json](public/data/manifest.json).
Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Reproduce the data

Runtime controls are prepared offline with pyGPlates 1.0 and pinned source
inputs. The [compiler report](docs/research/reconstruction-cao-foundation-compiler.md)
documents inventory, triangulation, motion qualification, country/POI binding
and exact checkpoint export. The scientific source store is
`../EarthHistory-data/palaeomap-study/`, bounded to 4 GiB; candidate foundation
exports have a 64 MiB sub-bound. Research archives do not enter the app build.
Preparation verifies source hashes before producing the public manifest.
Do not regenerate checksums merely to hide a validation failure.

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

Performance evidence for the native foundation belongs in the
[adoption record](docs/research/reconstruction-cao-foundation-adoption.md).
Earlier measurements describe the previous implementation and cannot establish
the new renderer's readiness. Validate the actual production build on both
backends and retain separate source-byte, CPU-memory and GPU-allocation ledgers.

## Current limitations

- The initial compiled native domain is 0–540 Ma; older chapters are editorial.
- Cao model geometry does not supply calibrated elevations, exposed-land/shallow-
  sea masks, global seafloor ages or historical biome maps in this foundation.
- Country references and POIs have incomplete positional support. Unsupported
  fragments and anchors remain unavailable rather than receiving invented motion.
- Exact native boundary and ownership states do not imply qualified continuous
  topology between checkpoints.
- The visual target remains a natural globe with regional detail. The initial
  foundation's neutral surfaces do not yet reproduce the satellite-map examples.
- Close terrain flight, detailed basin sections and subsurface geological or
  petroleum-system models remain outside the current scope.

The project does not yet declare a license for its own source code. Dataset and
dependency licenses apply only to their respective material.
