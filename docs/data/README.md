# EarthHistory runtime data

The native Cao foundation uses static assets under
`public/data/reconstruction/cao-v2.4/`. The application does not query scientific
services at runtime. `public/data/manifest.json` records the complete public
asset set and its hashes; the nested Cao manifest identifies the reconstruction
package, reference frame, geometry, motion palette and checkpoint assets.
[Adoption status and validation](../research/reconstruction-cao-foundation-adoption.md)
distinguish completed checks from remaining integration work.

## Source and coordinate authority

The foundation uses [Cao et al. (2024)](https://doi.org/10.1016/j.gsf.2024.101922),
[data release v2.4](https://doi.org/10.5281/zenodo.13628813), under CC BY 4.0.
Its package identifies the model/version, palaeomagnetic reference frame,
anchor plate 0, rotation and topology hashes, and GPlates Cartesian axes:
X at 0°E, Y at 90°E and Z at the north pole. The shared mathematical kernel
converts these to the renderer axes. Display tilt and camera orientation do
not change the scientific coordinate frame.

Initial compilation covers 0–540 Ma, with 109 display checkpoints every 5 Ma.
The package declares this domain independently of the format, which supports
the source model's longer range. That extensibility does not mean older
reconstructions have already been compiled into the application.

Material charts retain reference coordinates, source feature identity,
lifetime and qualified motion bindings. Geometry is stored once. A shared
plate-motion palette stores compact rotations, including source knots and
adaptive samples independently of the visible timeline ticks. A chart may
reference separate supported motion intervals without duplicating its mesh.
An unsupported interval remains a gap; it does not become identity motion or
invalidate all other ages of the feature.

Exact checkpoints use their exact controls. Fractional ages select the
qualified motion subinterval and interpolate its rotations with the shared
CPU/GPU arithmetic. Scalar interpolation, when a qualified field exists, is a
separate display-control operation. A smooth position is model interpolation,
not evidence of continuously observed geography.

## What is represented

Native Cao coast-class polygons supply the initial geographic mesh. They are
model geometry and retain their original feature classes and limitations.
They are not promoted to an independently validated atlas of exposed land,
continental crust or shallow seas. The compiler reports unsupported geometry
and motion rather than repairing them with invented outlines.

Physical height is currently unknown and represented by a uniform zero
placeholder. A 400 m rendering offset keeps the triangulated land shell above
the ocean shell. It is a visual separation, not source elevation, and is applied
after physical height exaggeration. Mountains, surveyed bathymetry, shallow-sea
extent and calibrated historical climate are further detail work. Surface and
seafloor controls cannot supply depths absent from the package.

Native tectonic boundary assets preserve source feature types, directed
geometry, polarity and ordered adjacent plate/topology identities, with
ambiguous ownership explicit. Resolved topology polygons supply instantaneous
plate ownership. A plate ID at one age does not establish persistent ocean
material, crust formation time, consumption history or seafloor age.

Every marked checkpoint has exact native boundary and ownership assets.
Fractional boundary/ownership geometry remains unavailable until its
correspondence is qualified. The renderer does not morph unrelated line or
polygon vertex indices, nor relabel a neighboring source age as the requested
age. Continuous continental motion remains available independently.

Modern-country reference lines come from the public-domain Natural Earth
1:110m Admin 0 dataset. Their offline Cao bindings share the same motion
palette as geographic charts. The overlay is a modern locator aid, never a
map of ancient political borders. Binding approximations, native validity and
unsupported fragments are recorded by the compiler. Country geometry is not
repeated in each checkpoint.

POI coordinates in the editorial catalog are present evidence localities
unless their location notes specify otherwise. Native anchor bindings must
retain their source uncertainty and valid interval. Global or nonlocalizable
events remain unlocated. The POI's publication evidence and the reconstruction
model's positional support are separate claims.

Latitude/circulation guides and pole marks are globe reference graphics.
They are not period-specific Hadley-cell observations. The independent climate
module has synthetic software checks; calibrated historical climate and biome
fields have not been promoted as part of this foundation.

## Storage and resource ownership

| Asset | Contents |
| --- | --- |
| Cao manifest and core | Package/frame identity, chart lifetimes, motion bindings, batch references and source evidence |
| EHMP motion palette | Packed source-time rotations, with shared source interval metadata |
| EHGB spatial batches | Reference directions, chart/seam indices and triangle indices |
| EHGL reference lines | Modern-country geometry and chart indices stored once |
| Checkpoint JSON | Exact display controls and references to native state assets |
| EHNB boundary assets | Exact source-age directed boundary points and metadata |
| EHTO ownership assets | Exact source-age topology rings, polygon/hole identity and plate metadata |

Loaders verify declared identity, length, digest and packed headers before
acceptance. Frame-incompatible assets cannot be combined. Invalid support must
remain unavailable rather than reviving an older reconstruction engine.

The runtime loading contract permits two resident and two unsettled checkpoint
payloads, including their native assets. Canceled work continues to count until
it settles. Static geometry and motion data have one owning foundation lifetime;
GPU publications and their retirement have separate bounded ownership. Source
byte counts, decoded CPU memory and GPU allocations are different measurements.
The application retains the existing 50 MiB complete-build and 8 MiB per-file
limits.

## Older authored chapters

Outside the compiled native domain, authored formation, crust, ocean and ice
scenarios use explicit editorial inputs through the same renderer. Their
geography remains unsupported. These chapter narratives, atmosphere settings
and nonlocalizable events are not a second plate reconstruction model.

## Reproduction and historical records

The offline compiler uses pinned source inputs and pyGPlates 1.0. Source
inventory, triangulation, motion qualification, country/anchor binding,
checkpoint generation and public promotion are documented in the
[compiler report](../research/reconstruction-cao-foundation-compiler.md).
Owned source acquisitions remain outside the runtime package. Candidate exports
have a 64 MiB bound within the existing 4 GiB scientific source store; the
compiler and reconstruction program own their cleanup after promotion.

Earlier PALEOMAP, cross-model conversion, modern climate and regional relief
methods remain documented in the
[palaeomap study](../research/palaeomap-accuracy-study.md) and its linked
validation records. Those are historical experiments and implementation
records, rather than additional authorities for the native Cao renderer.
