# Palaeomap runtime audit

Status: current implementation audit, 2026-09-09. This record distinguishes the
18-frame application baseline at commit `78fab84d38fa667d3d19b04803539175478bc385`
from the 109-frame source-native implementation in the working tree. The broader
source choice and migration study is in
[`palaeomap-accuracy-study.md`](palaeomap-accuracy-study.md).

## Finding

The largest confirmed temporal loss in the shipped pipeline was local selection,
not a gap in the pinned PaleoDEM CSV archive. `scripts/prepare-data.py` used an
18-age tuple even though the verified v2 archive contains 109 numeric grids at
every 5 Ma from 0 through 540 Ma. `src/data/snapshots.ts` repeated the same
18-age list and chose its nearest member. A 387 Ma request therefore used the
400 Ma grid; a 255 Ma chapter used 250 Ma. No geometry interpolation occurred.

The working tree now asserts the actual archive inventory before generation and
serves all 109 native frames. `src/data/paleodem.ts` owns the frontend 0–540 Ma,
5 Ma catalog and native bracket rule; `scripts/prepare-data.py` rejects an
archive whose numeric members differ. The manifest records the compact catalog
contract and every derived asset hash. `src/App.tsx` exposes source-frame
navigation separately from the 37 authored narrative chapters.

The current continuous path keeps both native endpoint controls resident for
an open 5 Ma interval. `src/data/temporal.ts` is the shared coordinate front
door: its public point references require complete model/version, reference
frame, anchor, axis convention, plate ID, source age and source coordinates before the PALEOMAP rotation hierarchy can
move them. `src/data/temporalReferences.ts` applies that same resolver to stable
country parts, checks feature lifetime, and omits unsupported parts. Terrain,
country geometry, POI focus and tagged-area focus resolve from the same requested
age and publish requested and displayed ages separately; native knots recover
their exact source endpoint. The renderer keeps
unsupported surface cells on the nearest native frame and labels the result as
partial motion coverage. A missing or corrupt motion asset now visibly falls
back to the named nearest native source frame without claiming interpolation.

More frames remove avoidable 5–20 Ma snapping error. They do not improve the
PaleoDEM model's spatial resolution, reference frame, input evidence, or age
uncertainty. The UI and snapshot caveat must continue to call each surface model
output and must not describe a five-million-year sequence as observed motion.

## Source geometry actually used

The pinned input is Scotese and Wright (2018) PALEOMAP PaleoDEM v2, Zenodo
record 5460860, archive `PaleoDEMS_long_lat_elev_csv_v2.zip`, SHA-256
`db43e6261411ff468c9030ca240778a73f224bf34bf8186c735477e41454c873`,
20,302,272 compressed bytes, CC BY 4.0. Direct archive inspection found 109 CSV
members at 0, 5, …, 540 Ma with no gaps. The archive expands to approximately
111.9 MB of CSV. The single 145 Ma file has the literal header
`longitude,latitude,elevation`; the other files use comment headers. The
preparer now accepts both exact source forms.

Each source CSV is a one-degree longitude/latitude/elevation grid. Direct
validation found two layouts: 59 ages use 361 × 181 cells including a duplicate
+180° endpoint and both poles; 50 ages from 150 through 395 Ma use 360 × 180
cells, omit the duplicate endpoint, and stop at −89°. `scripts/prepare-data.py`
accepts only those exact layouts, omits +180° where present, and repeats the
nearest −89° source row at the missing south pole. It writes a 360 × 181 binary
grid with a validated 16-byte identity/schema header followed by little-endian
signed int16 metres. The narrow 0 Ma −180°
duplicate-zero correction and exact affected cells are described in the data
guide and manifest. Elevations remain integer metres relative to each modelled
palaeo sea level; preserving the deposited 1° sampling removes a local
downsampling loss but is not a 1° accuracy claim.

The nonzero-age country overlay is derived by
`scripts/prepare-data-countries.py` from PALEOMAP Political Boundaries v3 and
the matching PALEOMAP Global Plate Model v3 in Zenodo record 7994000. It uses
the source plate IDs, pyGPlates 1.0.0, anchor plate 0, and 0.18° display-line
simplification. These are reconstructed modern-country locators, not ancient
political borders or a substitute for coast geometry. The tracking layer keeps
437 source features and 999 stable parts in an int16 longitude/latitude binary
encoding with scale `180/32767` degrees. Unsupported parts disappear instead
of being placed speculatively.

The snapshot assembler in `src/data/snapshots.ts` loads immutable paired
PaleoDEM controls, reconstructed country references, and tracking coordinates
for the requested 5 Ma bracket. Numeric authored climate-potential controls are
evaluated at the requested age. At 0 Ma it uses Natural Earth only for present-day land
and border reference and optionally loads Beck et al. (2023) 1991–2020
Köppen–Geiger classes. Runtime fetches resolve under the static `data/` base;
there is no live scientific API.

## What becomes three-dimensional

`src/render/surface.ts` expands the 360 × 181 source control into either
a 512 × 256 coarse or 768 × 384 regional procedural surface. It bilinearly
samples the model elevation, creates color, roughness, land mask, clouds and a
Float32 metre-height field, and also encodes the height into an RGBA8 relief
texture. In surface mode negative elevations render at the datum; in seafloor
mode signed values are retained with a −9,000 m bias over an 18,000 m range.
Historical regional detail is synthesis: small deterministic relief noise adds
legibility; only requested age 0 may load measured ETOPO or EMODnet refinement
tiles. Authored tectonic story corridors no longer change the surface.

The adaptive cube path samples `SurfaceFields.reliefMetres` directly in
`src/render/cubeTileFields.ts:430-447` and stores Float32 vertex heights. Its
mesh displacement therefore does not inherit the RGBA8 quantization. The
legacy sphere uses the RGBA8 relief texture as its GPU displacement and bump
map (`src/render/GlobeScene.ts:1303-1384`), which provides about 35.3 m steps in
surface mode and 70.6 m steps in seafloor mode before vertical exaggeration.

Overlay draping changes precision during startup. The fallback sampler in
`src/render/displayedHeight.ts` decodes the RGBA8 texture, so a briefly visible
fallback country/guide overlay shares the same 8-bit displacement. After cube
publication, `src/render/GlobeScene.ts` samples the actual visible Float32 mesh
triangles by ray/plane intersection. The sampler is revisioned when native or
continuous geometry, LOD stitching, surface mode, or vertical exaggeration
changes, and the corresponding country and guide geometry is rebuilt against
that published surface. This prevents a radial source-height sample from
placing an overlay through a displayed triangle. The 8-bit limit is confined
to the fallback; it is not evidence that the source input or final cube geometry
is eight-bit.

In the PALEOMAP view, visible mountains and rugged terrain come from the
PaleoDEM rather than sourced boundary geometry. The baseline applied height and
color corridors around the small authored `tectonicsAt` catalog. That override
was removed during this study:
the working surface now derives relief and ruggedness from PaleoDEM. Those
present-coordinate editorial corridors are available only at 0 Ma as a
separately labelled, opt-in reference overlay; historical requests suppress
them rather than freezing or assigning a boundary to one rigid plate. Dated
ridge and subduction geometry in the optional Cao view now uses compatible
topology with adjacency, polarity and lifecycle; unsupported segment
correspondence or orientation remains absent rather than being inferred.

## Climate latitude meaning

Ancient climate is not a circulation or palaeoclimate model. Environment
values are era/event constants in `src/data/snapshots.ts`.
`potentialIce` applies a fixed 0.52 °C per degree cooling poleward of 20° and a
0.0065 °C/m lapse rate. Vegetation potential
is cosine of model-frame latitude multiplied by an altitude and biological-era
capacity. The renderer adds a deterministic
ragged ice edge. Only the present-day snapshot uses the source-authored Beck
climate class grid. For requests strictly between 81 and 285.01 Ma, the absence
interval between dated ice polygons in Cao et al. (2017) suppresses
permanent-ice coloring as a qualitative constraint. It is not proof that Earth
was ice-free, and no Cao polygon is transferred geometrically into either
rendered plate frame; sparse high-altitude snow remains an authored
climate-potential inference. The source ID and this limitation are published
with affected snapshots only.

The latitude is geographic latitude in the selected PALEOMAP reconstruction
frame, so it is a useful first-order solar/climate coordinate within that model.
The Hadley boundaries and latitude guides are schematic viewing references;
they are not period-specific Hadley-cell evidence. A future climate layer must
name its model, age, grid, reference frame, variables and uncertainty, and must
not be silently mixed with a different plate model.

## Static size and runtime bounds

At the baseline commit, `public/data/` contained 6,241,756 logical bytes. Its
18 PaleoDEM grids occupied 1,553,858 bytes, 17 historical country files
2,481,535 bytes, and the 18 tracking ages plus catalog 717,122 bytes.

After native-age generation and before continuous-motion assets, the measured
three time-varying classes were:

| Class | Files | Logical bytes | Mean | Minimum | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| PaleoDEM binary | 109 | 14,206,624 | 130,336 | 130,336 | 130,336 |
| Country JSON | 108 | 15,579,022 | 144,250 | 131,320 | 163,962 |
| Tracking binary | 109 | 3,641,708 | 33,410 | 30,488 | 42,204 |

The tracking catalog is another 101,130 bytes. At that checkpoint,
`public/data/` measured 35,077,901 logical bytes across 337 files. The production build measured
44,283,940 logical bytes across 350 files; `check-app-artifacts` reported
42.23 MiB against the unchanged 50 MiB ceiling. Filesystem allocation measured
49,316 KiB and is not the artifact gate's byte definition. This leaves limited
space for another uncompressed global time stack.

The continuous PALEOMAP motion catalog adds 678,894 bytes. The optional
target-native Cao view loads one shared, frame-checked runtime bundle containing
ocean topology/rotations, static continental child fragments, signed ocean
lifecycle controls and the PALEOMAP-height crosswalk. App and renderer share the
same decoded models and bounded caches. The bundle does not authorize copying
PALEOMAP ocean coordinates into Cao; supported continental heights use the
documented conversion and unsupported cells use a neutral mask. Final generated
bytes remain subject to the unchanged 50 MiB artifact gate. The latest targeted
production candidate measured 49,097,301 logical bytes. Its Cao assets measured 11,596,619
bytes in total: ocean motion 2,462,978-byte JSON plus 3,146,951-byte binary,
continental motion 320,201-byte JSON plus 299,600-byte binary, and ocean
lifecycle 10,605-byte JSON plus 5,356,284-byte binary. This is a direct file-size
measurement; the coordinator's final artifact-gate result remains the acceptance
record.

`src/data/snapshots.ts:50-59` now limits retained elevation, country and tracking
promises to three ages per class. `src/data/promiseLru.ts` aborts an evicted
in-flight fetch and deletes a failed entry only if it is still the same entry,
preventing an old rejection from deleting a newer same-key request. This is an
entry bound, not a measured heap ceiling: decoded values, the browser HTTP
cache, the active snapshot and renderer copies remain separate.

Renderer residency is explicitly bounded by `src/render/GlobeScene.ts:845-853`:
four surface fields/20 MiB, three regional patches/8 MiB, and 160 cube tiles/
48 MiB. Those maxima total 76 MiB before active textures, geometry copies,
transitions, overlays and worker contexts. Reference overlay generation has a
separate 16 MiB ceiling; decoded modern refinement tiles have a 4 MiB cache.
These are analytical upper bounds from code, not measured JavaScript or GPU
heap residency.

Surface and regional requests cancel or reject superseded work. Cube generation
uses 1, 2 or 4 workers according to hardware concurrency, sends at most 24
refinement tile requests per batch, terminates workers on context cancellation,
and checks request/context serials before display (`src/render/GlobeScene.ts:
156-548`, `1274-1300`, `1478-1518`, `1870-1929`). This provides stale-result
protection; production memory and GPU behavior still require measurement.

The production before/after comparison is promoted in
[`palaeomap-render-validation.json`](palaeomap-render-validation.json). At the
95 Ma no-overlay control, median surface generation increased from 73.0 to
116.3 ms (+43.3 ms, +59.3%); cube generation changed from 39.2 to 40.4 ms and
candidate frame p95 stayed at 16.7–16.8 ms. At present day, median surface
generation increased from 137.4 to 150.7 ms, cube generation fell from 43.0 to
40.0 ms, and p95 stayed 16.8 ms. The repeatable CPU cost remains below the
predeclared 500 ms generation stop rule and steady p95 remains below 20 ms.
The comparison did not measure JavaScript heap or GPU allocation, so it supports
no memory-residency claim. Navigation-to-ready remained approximately 628–764
ms, preserving the existing readiness miss; it is outside this surface-generation
comparison and is not evidence of an improvement.

A final three-run default-scene check used the gate-built entry script
`index-DCQyXb6w.js` (SHA-256
`f318c9a32cb0d714275d3731d1963bc0877cb79103b9b487033ef1cdca0dc91e`)
through headless Chromium 153 on the same Apple M4. All three WebGL2 runs
published ready surface, cube, cube-refinement and overlay states. Generation
was 140.6–153.4 ms; retained renderer-cache diagnostics were 10,330,632–
19,742,184 bytes, cube-worker retained bytes were 12,089,344, and stale jobs
were zero. The default guides measured one batch, 1,611,004 bytes and 10,845
vertices; countries measured one batch, 1,782,344 bytes and 44,732 vertices.
The probe's custom RAF collector returned no intervals, so it makes no new
frame-time claim. The valid repeated production p95 evidence remains the
16.7–16.8 ms comparison above. Exact final-probe metadata and the empty-sample
limitation are recorded in the external verification ledger named by
`palaeomap-render-validation.json`.

## Tagged-camera defect

The production reproduction selected a tracked location, zoomed to camera
distance 1.38, moved to a period where its part was absent, and then moved to a
period where it reappeared. The camera returned to 1.82. `GlobeScene.focus`
gave omitted distances a default of 1.82, while temporal coordinate updates
intentionally omitted a new distance. `src/render/GlobeScene.ts:1151-1167` now
uses the current camera radius when the distance is omitted. New POI, area and
URL focuses pass an explicit 1.82; reconstructed coordinate changes and
reacquisition omit it. Browser coverage includes a directly relocated Andean
POI and a tracking part that disappears and reappears.

The continuous-time browser case additionally issued nine timeline inputs 35
ms apart while crossing the 20–25 to 25–30 Ma source interval. Against entry
script `index-DBs_ncMc.js` (SHA-256
`fed7ca71c964b280437e11b75939798c39edefd2e6bf5da8882fc0b4b20eb1e7`),
the requested terrain age and actually displayed country age converged on the
same final value, more than 100 supported country parts remained visible, the
East African Rift POI focus moved, and its zoom radius was retained. This is a
functional production integration check, not a frame-time or GPU-performance
result. A separate fault-injection pass aborted the motion catalog request and
verified a visible 25 Ma native-source fallback with model-output evidence.

The optional Cao integration's strengthened coherence check used production
entry `index-Ddf1DRb1.js` (SHA-256
`c077d2c2e467b34b4f351fddaafecdfe8d9ec5eed6e719febbd8f98e81fea54f`).
The test moved rapidly through a fractional source interval and required every
animation-frame-visible publication of the
published terrain, dated boundary field, reconstructed country references and
POI coordinates to report the same displayed age. It continued through an exact
native-source knot and required at least one real terrain mesh to remain visible
on every sampled frame. It also retained the tagged camera radius and observed
both the tagged longitude and installed POI position change. It passed in 44.0
seconds. The same age-coherence gate deliberately failed against
the preceding non-atomic production artifact with six mixed-age frame samples,
then passed unchanged after the transaction fix. A separate test aborted the
Cao motion request and verified visible fallback to the PALEOMAP view; the
existing PALEOMAP continuous-age case also passed. The composite Cao view
publishes `synthesis` even at exact source knots: an exact knot makes the source
age and target coordinates exact within the selected models, not the inferred
continental height conversion, lifecycle-derived bathymetry or procedural
relief. The optional Cao view remains partial because sampled continental
conversion coverage did not meet the predeclared 90% replacement stop rule;
PALEOMAP therefore remains the default.

The later satellite-material and published-surface corrections were checked
against production entry `index-orLLDpOG.js` (SHA-256
`28df92a0b109556d1a1bb86e286e5fe16d5ba0b8b03174ec61841d5df998e358`).
The unchanged strengthened Cao test again crossed a native source knot while
sampling every animation frame and passed in 48.2 seconds. Terrain remained
visible, terrain/boundary/country/POI displayed ages stayed equal, the installed
POI position signature moved, and the tagged camera radius was preserved. The
material texture uses one model-stable chart for each resolved continental or
ocean material, unwraps longitude before both settled and sparse-preview UV
interpolation, and stores texture rows north-to-south consistently with the
renderer flip. The shared 512 × 256 normal/roughness texture is allocated once
per scene and disposed once with the scene; per-mesh source textures remain
bounded by visible cube groups and are disposed with their mesh. This is a
functional coordinate and lifecycle check, not a GPU-memory measurement or a
claim of smooth full-range performance.

## Recommended compact contract

Keep one static manifest entry per model family with `modelId`, model/version,
reference frame, anchor plate, axis convention, native and derived grid registration, age
catalog, value units/datum, epistemic class, spatial/age uncertainty where
published, asset path, bytes and SHA-256. A continuous snapshot names both
native endpoints and exposes requested age separately. Material and boundary
records carry source-qualified model identity; boundaries keep adjacency,
orientation, polarity and lifetime separate from crust material identity. A future binary elevation
encoding can use signed int16 metres plus explicit scale/bias and pole/meridian
registration; decode one requested age into Float32 for procedural rendering.
Do not ship full-resolution RGBA textures for all ages.

Keep authored chapters and source frames separate. Generate material, normals,
small-scale texture and LOD tiles in frontend workers from the compact numeric
control. Gate refinement by projected error with hysteresis, cap entries and
bytes, cancel the previous age/context, and publish requested/displayed IDs so
tests can reject stale display. Climate or plate layers enter the bundle only
with a documented frame conversion or an exact compatible model family. No
runtime scientific API is required.

The target-native Cao ocean topology cannot be placed over the PALEOMAP surface
by copying longitude/latitude. Its continental mask is a coarse topology class,
not an exposed-land coastline, and overlapping or absent ownership remains an
explicit unsupported state. A Cao view must convert terrain, country references
and focus through one source-qualified crosswalk at exact native ages as well as
between them; an exact source knot is not permission to bypass the selected
view's coordinate model. Incomplete ridge, rift and subduction adjacency is
retained as an explicit per-segment status and is excluded from oriented relief
synthesis rather than rejecting the full source catalog.

### Rejected topology-container crosswalk probe

The first bounded global conversion probe deliberately required the Cao
instantaneous topology plate ID at a requested age to equal the topology plate
ID reached at present. That rule is scientifically too strict for continental
material: a composite Gondwana topology can carry child continental material
with its own rotation circuit. The run is therefore preserved as rejected
method evidence in `palaeomap-crosswalk-validation.json`, not as evidence that
a static-continent crosswalk is impossible.

The probe sampled the exact Cao rings on a 2° global grid at 0, 100, 250, 400
and 540 Ma, kept coarse continent-mask margins separate, and sampled tracked
country edges. It exposed the failure mechanism concretely: at 250 Ma, 5,083
of 6,307 target cells classified as continental were rejected by the invalid
same-topology-plate rule. The surviving numerical round trips were precise to
at most 1.21e-6 degrees globally and 1.48e-6 degrees on country samples, and no
ocean point entered the continental relief path. The implemented adapter instead
uses Cao's static continental partition feature and child plate identity;
instantaneous ocean topology remains responsible for ocean birth, death and
boundary adjacency. A 2° continent bit cannot become an exposed coastline.

The corrected probe uses 869 static continental fragments and their child
rotation circuits. It preserves India plate 501 inside its 250 Ma composite
Gondwana topology 701 and reduces the false topology-lineage rejection by
thousands of cells. All resolved global and country round trips remain within
1.48e-6 degrees and no ocean enters the conversion. The predeclared 90% stable
interior stop still fires at 100, 250 and 400 Ma: supported fractions are
88.47%, 81.17% and 81.17%. Most remaining gaps are explicit missing PALEOMAP
source endpoint material, not Cao topology ambiguity. The optional app view uses
this crosswalk only for supported continental material and masks unsupported
land with neutral low relief. The measured coverage does not support replacing
the default PALEOMAP view or claiming a globally accurate Cao terrain surface.
The bounded failure audit found no missing rotation and no same-plate
first-match switch: source gaps split between PALEOMAP feature lifetime
(586/901/604/207 at 100/250/400/540 Ma) and a different-plate first match
(341/228/438/153), which remains unsupported because overlap alone does not
establish material lineage.
The coarse Cao mask also produces 440–628 false-positive 2° continent cells per
tested age against the exact static partition, confirming that it cannot draw
coasts. Full results and input hashes are in
`palaeomap-static-crosswalk-validation.json`.

### Current continuous coordinate boundary

Continuous PALEOMAP motion and paired native elevation endpoints now ship for
0–540 Ma. Terrain, modern-country references and tagged focus use one
model/version/frame/anchor/axis-qualified resolver, publish requested and
displayed ages separately, keep material-family seeds stable, and retain only
bounded endpoint work. Unsupported PALEOMAP material stays on a disclosed
nearest native field. This is model conversion/interpolation, not a claim of
continuous observations.

The target Cao view is now an optional partial-coverage integration while
PALEOMAP remains the default. Terrain, dated boundaries, modern-country
references, points and tagged surface focus use the same Cao frame at exact and
fractional ages. Continental height comes only through the static-child
crosswalk; target-native ocean material and lifecycle never sample PALEOMAP
ocean as if it were registered. App and renderer publish distinct requested and
displayed ages. Terrain and boundary geometry publish together, and the view
does not report `ready` until enabled country and POI consumers also report that
displayed age or an explicit unsupported state. Material focus records the
actual source age/direction, validates its authoritative fragment or topology
and lifecycle on URL restore,
and retains the tag while unsupported. Source-knot equality is not frame
compatibility. Targeted production browser validation covered exact and rapidly
requested fractional states, a cross-native-knot transition, every-frame
cross-layer age coherence, continuously visible terrain, retained focus radius
and asset-load failure. It does not establish smooth-frame performance over the
full 0–540 Ma range or global terrain accuracy.

## Phase checks and stop rules

These checks were written into `dev-docs/plans/palaeomap-accuracy.md` before
runtime measurement. They separate source correctness from performance:

1. **Native catalog.** Assert the actual archive has exactly 109 members at
   0–540 Ma every 5 Ma, all derived grids are 360 × 181, and manifest ages for
   elevation/tracking match. Deliberately alter the expected catalog and prove
   preparation rejects it, then restore it. Stop ingestion on any missing age,
   dimension mismatch, checksum change, or if the built artifact exceeds the
   unchanged 50 MiB gate.
2. **Selection and focus.** Unit-test nearest source selection and browser-test
   the 109-option source control independently of chapter selection. Test a POI
   relocation and tracked-area disappearance/reacquisition after manual zoom.
   Stop if requested/displayed snapshot IDs diverge after settling, if a source
   step invents a narrative label, or if a temporal focus changes radius by
   more than 0.01 without an explicit zoom request.
3. **Cache and stale work.** Traverse more than three ages, verify LRU eviction
   and abort, then replace an evicted key and reject its old promise. Stop rapid
   playback/preloading if any source-class map retains more than three entries,
   a stale failure removes the replacement, cube cache exceeds 48 MiB, or a
   stale age reaches the displayed surface.
4. **Production measurement.** Use repeated production control/changed scenes,
   the existing historical anchor, and machine/load metadata. Existing targets
   remain first camera response ≤100 ms, regional stage ≤250 ms, steady p95
   ≤20 ms (≤33 ms reduced path), and cosmetic generation ≤500 ms. Cancel an
   optional resolution/effect after two agreeing valid runs exceed its target;
   remeasure near-threshold or noisy results. A browser pass alone is not a GPU
   performance result.

## Design pre-mortem

- **Dense time selection causes memory growth and visible stale frames.** A
  user scrubs 109 ages faster than fetch and worker completion, old surfaces
  arrive late, and mobile memory climbs. The bounded abortable source caches,
  request serials and requested/displayed diagnostics address the mechanism.
  The phase stops on a non-plateauing second traversal or any settled ID mismatch.
- **More frames are presented as more scientific accuracy.** The app looks
  smoother while still using a one-degree model grid and one reconstruction family,
  leading users to infer observed five-million-year coast motion. Separate
  source controls, model-output labels and no coordinate crossfade are required;
  claims of improved spatial certainty fail review.
- **A plate, climate or relief layer is mixed across frames.** A plausible new
  ridge line or climate belt is rendered at incompatible coordinates and shifts
  away from its coast/POI. Integration stops until model/version/reference-frame
  metadata and a documented conversion or same-family source exist.

## Scientific boundary

PaleoDEM provides modelled topography and bathymetry through 540 Ma in its own
frame. It does not establish exact coastlines, high-resolution mountains,
individual trenches/rifts, river networks, biomes or ice margins. Country
references are reconstructed modern locators. Ancient climate/vegetation/ice
and drainage remain potential or synthesis; early-Earth surfaces older than
540 Ma remain illustrative. Terrain refinement can improve visual continuity
and numeric representation, but it must not be described as new evidence. The
Himalayas capture confirms displaced 3D terrain and the revised continuous
material palette. Its present-day border geometry remains coarse Natural Earth
1:110m. The optional Cao view now supplies dated ridge, rift, orogenic and
subduction geometry where segment lifecycle and adjacency support it; incomplete
orientation stays unoriented or absent rather than being invented.

Independent source comparison decoded every binary header and compared all
7,102,440 stored values across 109 ages with source coordinates. Every value
matched after only the disclosed 0 Ma meridian repair and the 50 south-pole row
closures. This proves source-grid preservation; it does not reduce model
uncertainty.

## Verification checkpoints

The earlier 109-frame deterministic checkpoint passed 24 test files and 128 tests, validated 336
artifact hashes, and accepted the 42.23 MiB production artifact. The first `make gate-full` invocation passed 19 of 20 browser cases and
returned exit 2 because one assertion
still expected the superseded legend text Seafloor view. After changing that
assertion to the intentional Exposed seafloor UI contract, the affected case
passed 1 of 1 with exit 0. Thus the browser coverage union is 20 of 20; the
literal full browser command was not rerun.

After the continuous PALEOMAP coordinate path and target-native Cao assets were
added, the coordinator's deterministic checkpoint passed 30 test files and 173
tests, validated 339 assets, and measured the application artifact at 47.93 MiB
against the unchanged 50 MiB ceiling. The later cross-model contract checks
passed 16 focused tests across the temporal, Cao backend and rejected-candidate
adapter files plus TypeScript and diff checks. The later exact-production
targeted checks are recorded above. These remain checkpoint and targeted
results. The latest renderer checkpoint separately passed TypeScript, 85 focused
tests and the artifact-size check before the production browser case above; the
coordinator still owns the final deterministic and browser union, which is not
claimed here as passed.

## Reproduction tool

Country generation used the regenerable isolated environment
`EarthHistory-data/palaeomap-study/verification/pygplates-venv` (214 MiB):
Python 3.9.6, pyGPlates 1.0.0, NumPy 2.0.2 and pip 21.2.4. It stays within the
0.3 GiB verification allocation. Final measured generation time was 6.41 s for
the 1° global data script and 23.76 s for the country/tracking script on an Apple
M4, 10 logical CPUs, 16 GiB RAM. The environment is an offline preparation
tool and is not part of the application artifact.

## Earlier program checkpoint (605392)

The coordinator completed `EARTHHISTORY_TEST_PORT=4188 make gate-full` with exit 0 on the unchanged production entry `index-CjGFyKi_.js`, SHA256 `6053926a326838fa42e2fbec98944d374218654b231bcb2312e46ec4e1638c0b`. All 204 unit/data tests in 34 files, all 24 browser cases and 343 scientific assets passed; the distribution is 49,097,762 bytes (46.82 MiB). The initial full run failed two obsolete rendering assertions; exact mesh-revision draping and illustrative versus mapped scene publication now have corrected checks, including a restored stale-sampler failure control. The [continuous validation record](palaeomap-continuous-validation.json) retains both full-command outcomes and their hashed logs.

This completes the local implementation/test phases. Cao continental conversion remains explicitly partial, close terrain remains coarse, and full-detail settling after rapid input remains approximately 1.25–1.32 seconds. These are not erased by the passing gate. No commit, push or deployment was performed.


## Reference-driven renderer closure, 2026-09-10

The final renderer is `4b9554a7b985fa45452b7bfaa4726db2a2ad96127f8cfc27b8ac071e6d692737`, with a 49,483,584-byte distribution. Its completed full-gate log records 224 unit/data tests across 35 files, 345 verified scientific assets, all 24 browser cases passing, and the final Makefile success marker. The coordinator verified that the served candidate entry remains identical. The Sol agent reached its usage limit before returning its final shell result; no extra numerical exit status is invented and the completed checks are not rerun. The exact log and hash are in the [continuous validation ledger](palaeomap-continuous-validation.json).

The first full attempt passed 23 browser cases and failed only a guide test that required the obsolete procedural source suffix. The actual default ocean view correctly used the supported Mid-Atlantic ETOPO source, with matching requested/displayed identities, ready refinement, 96 leaves and balanced neighbors. The test now checks that explicit current source; a deliberately wrong source fails and restoration passes. Earlier preflight menu-count and fractional-key test assumptions are retained as excluded evidence, not counted as successful failure controls.

The final native path restores immutable source geometry, normals and local UVs at the current relief exaggeration before atomic publication at exactly 0 Ma. It avoids repeated temporal material calculations without relabeling mutable fractional geometry. Focus flights defer camera-dependent refinement until their destination, while manual input cancels the flight. Historical exact and fractional frames retain the period-coordinate solver. Source-only modern validity, signed seafloor versus sea-level surface water, current triangle sampling and synchronized country/POI publication remain intact.

A separate fractional cache defect was reproduced at 102.5 Ma: old mesh-owned field reinsertion competed with the target hierarchy and caused hundreds of thousands of evictions. Planning now recognizes those owned arrays without reinsertion and disposes obsolete hidden staging. The same camera completes with 96 visible leaves and two evictions, under the unchanged 160-entry/48 MiB cache limits.

Paired production measurements preserve both accounting scopes: original material/Cao preparation and steady-frame targets pass, while the expanded historical sum including roots/refinement is 513–529 ms and remains above 500 ms. Fully ready scene transitions remain about 1.2–1.6 seconds. Default 8× captures for the five supplied reference regions remain visibly coarse, faceted and generalized compared with satellite maps. The visual target and Caledonian collapse history are not claimed complete.

The user conditionally authorized release once ready. Read-only preflight confirms existing v0.1.1, workflow-based Pages, no open PR and passing workflow lint. New work is recorded under Unreleased for the next default patch v0.1.2; historical release notes remain intact. No publication is attempted while visual readiness is unresolved. Both Sol agents are unavailable at their usage limit; the coordinator requested an explicit model choice before substituting Astra, as required by CLAUDE.md.

### WebGPU surface-texture retirement correction

The first 430 and 420 Ma regional Caledonian captures on production entry
`4b9554a7…` repeatedly emitted a WebGPU validation error for a destroyed
512 × 256 sRGB texture and could leave the preceding frame visible. The failed
capture metadata are retained in the external verification store as
`silurian-{430,420}ma-caledonian*-8x-4b9554a7-20260910T051927Z.json`; neither
image is acceptance evidence. The dimensions and format identify the retired
coarse global albedo (clouds are 256 × 128). Source inspection then confirmed
that `applySurface` disposed the preceding texture set while the atomically
held temporal cube still bound that albedo.

Surface texture sets now retire after the globe and cloud materials are
rebound, remain alive while any live scene material binds one of their maps,
and are reclaimed on staged cube/group release. The reference scan runs only
at those lifecycle events, and scene teardown drains any remaining retired
sets. A focused regression holds an old albedo through a cube material and
releases it only after rebinding. Deliberately removing the `map` binding from
the guard made that test fail 1 of 2; after restoration, the two focused files
passed 6 of 6 and TypeScript passed. The external logs are
`webgpu-texture-lifetime-r1-mutation.log` and
`webgpu-texture-lifetime-restored.log`.

The combined production checkpoint entry
`7e1690fe4aab317ec8369557a7bbd6beaf0ec67da67acbdd452dce5c5daecc03`
(49,484,601 bytes) then rendered both regional views through WebGPU with zero
captured console, page or GPU errors. Each view settled at its exact requested,
displayed and source age with regional level 4, 96 visible tiles, relief 8× and
camera distance 1.8200. The accepted metadata are
`silurian-430ma-caledonian-webgpu-fixed-8x-7e1690fe-20260910T054751Z.json`
and
`silurian-420ma-caledonian-comparison-webgpu-fixed-8x-7e1690fe-20260910T054758Z.json`.
The 430 Ma and 420 Ma images visibly differ, so this checkpoint also rejects
the prior stale-frame behavior. The coordinator still owns the final union
gate and release artifact identity.


### v0.1.2 error-only release gate

The combined `7e1690fe` production candidate passed `make gate` (exit0):227 tests across36 files,345 scientific assets,47.19MiB application. The affected browser command passed all3 cases (exit0): Pages load, explicit WebGL2 fallback, and modern landscape/source-mode behavior. The exact430/420Ma WebGPU regional captures separately passed with no errors and visibly current frames. Previous full24-browser coverage is retained for unaffected behavior; the complete browser union was not repeated. Actionlint and staged whitespace checks passed. These are local candidate results, not remote publication evidence.
