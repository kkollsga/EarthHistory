# Cao continental-outline shelf coverage audit

Research date: 2026-09-12. This audit answers whether the current foundation
contains coastal underlay around the continents and separates source omissions
from rendering clearance. The native blue layer is Cao model continental-outline
geometry with unknown depth and exposure. It must not be described as measured
shallow sea or palaeoshoreline.

## Coverage result

A one-degree equal-area-weighted global sample of reconstructed Cao v2.4 source
polygons found about 65.75 million km² of `shapes_continents` outside the
polygon union of `shapes_coasts` at 0 Ma. Every broad modern
continental region had a nonzero outline-only area: North America 11.91,
South America 5.43, Africa 4.73, Eurasia 23.66, Australia 9.55, and Antarctica
5.97 million km². Coast geometry outside a continental outline was only about
0.067 million km² at this coarse resolution. At 422 Ma the same test found
about 23.41 million km² of outline-only geometry and 0.19 million km² of
coast-only geometry.

These figures establish broad source coverage, not bathymetric area. The source
collection mixes closed continental boundaries, arcs, terranes, cratons and
other model feature types. The renderer uses it as a blue geographic underlay,
but Cao does not assign a water-depth or exposure class to these polygons.

## Rendering clearance

The pre-fix 80 m shelf shell is not outside the conservative unit-sphere
envelope throughout its planar triangles. In the native 6,092,356-byte EHGB,
200,112 of 251,187 triangles across 852 charts have a closest interior radius
at or below one; the minimum displayed radius is 0.9999646828. A shell of
305.017 m is the mathematical minimum for this mesh against a smooth unit
sphere. The opaque globe uses a radius-one `THREE.IcosahedronGeometry`, with
detail 24 in high-quality mode and 16 otherwise, whose planar faces also lie
below that envelope. The counts are therefore not a measurement of visible
pixels or proof that every flagged triangle is occluded. They are a conservative
clearance failure. The accepted renderer repair uses 400 m for the shelf and
800 m for land, which clears the envelope while retaining land precedence.

## Exact source-lifecycle comparison

The audit matched source feature ID, ordered float64 XYZ geometry, name, plate
ID and feature type between `shapes_continents.gpmlz` and
`COBfile_1800_0.gpml`. Of 877 compiled polygons, 615 have an exact geometry and
semantic match. Ninety-one of those differ only in lifecycle: the COB lifetime
strictly contains the compiled lifetime for 29, while the compiled lifetime
strictly contains the COB lifetime for 62. This asymmetry rules out replacing
all compiled lifetimes with the COB collection.

At 422 Ma, nine exact COB-superset polygons were absent from the compiled
lifetime. The three Svalbard/Barents charts are repaired separately. The six
remaining approved repairs are Moldanumbia and Armorica on plate 305, Perunica
on 374, Saxothuringia on 375, Strandja/Moesia on 319 and Avalonia/Acadia on 108.
Their combined source-reference spherical area is about 838,223 km². All use
the identical source geometry and COB oldest endpoint of 600 Ma; Strandja's
compiled endpoint is 410 Ma and the other five end at 420 Ma. Geometry, unknown
surface semantics and source frame remain unchanged.

The six-chart repair reuses the passing native plate-305 motion and appends
bounded entries for plates 108, 319, 374 and 375. A pyGPlates oracle checks
every quarter-million-year point over each newly exposed interval and both
sides of every shared palette knot. Its maximum angular residual is
0.000009339260428 rad at 418.75 Ma on plate 319, below the 0.00001 rad limit.
The final core SHA-256 is
`14c33ff9dc79feea337811f1e21c771765adb46857984d3ae2adc2545531bda8`
and the final motion-palette JSON SHA-256 is
`bacde9c52c9fd755fb208d4cabef38537bb2f6e6eff7a01b4a30c9d371460e21`.

The [compact JSON companion](continental-shelf-coverage-audit.json) lists all
29 COB-superset and 62 reverse candidates.
Only the nine charts absent at 422 Ma are accepted repairs. The Guerrero/Mexico
candidate is absent at 409–410 Ma but coincides with a reverse West Burma
lifecycle mismatch and has not received regional semantic review. It remains
unchanged with the other 19 COB-superset candidates pending age-specific and
regional review. The 62
reverse cases are also unchanged.

## Visual coastal tint alternative

A coast-following tint could supply visual coastal context where a source has
no outline. It would be display synthesis rather than a depth class and would
need to follow only active coast geometry, carry that label, and avoid entering
the scientific material catalog. It would also blur the distinction between
Natural Earth's sourced nominal 0–200 m Iceland class and Cao's unknown-depth
continental outline. Because the current Cao source already provides extensive
underlay around every major modern continent, the source-lifecycle and shell
clearance repairs are the smaller defensible changes. No global coastal buffer
or tint is introduced by this audit.

## Reproduction and sources

Run [`audit_cao_shelf_coverage.py`](../../scripts/research/audit_cao_shelf_coverage.py)
with pyGPlates against the pinned Cao source pool. The exact inputs are Cao et
al. (2024) v2.4 under CC BY 4.0, retrieved 2026-09-09. Geometry is evaluated in
the model's palaeomagnetic absolute frame, anchor plate 0, with standard GPlates
X-at-0°E, Y-at-90°E and Z-north axes:
`shapes_continents.gpmlz` (1,243,843 bytes,
`6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616`),
`shapes_coasts.gpmlz`
(`c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f`),
and `COBfile_1800_0.gpml` (14,423,254 bytes,
`cfcea20c5244613e53ad4b9cdf6411d79ff535c25af335b4fa6eb9251377d4bd`).
The stable source record is the
[Cao v2.4 Zenodo deposit](https://doi.org/10.5281/zenodo.13628813).
