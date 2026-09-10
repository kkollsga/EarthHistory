# Published geography compatibility feasibility

**Research date:** 2026-09-10
**Question:** Is there published exposed-land and shallow-sea geometry covering
0–540 Ma that is already in the Cao et al. 2024 v2.4 frame, or that supplies new
source-native lineage capable of a defensible conversion?
**Disposition:** no accessible complete model-coherent published outline series
was demonstrated. The actual 76-page Merdith et al. combined preprint and
supplement were inspected. They disclose a reproducible scientific method and
equations, but the deposited PDF contains none of the claimed code, grids,
flooding polygons, or feature bindings. The native-MER21 candidate is therefore
blocked on a specific missing source artifact, not rejected scientifically.

## Source distinctions

The acquired Cao et al. 2024 v2.4 release is the best plate/crust candidate. It
contains rotations, static/continental polygons, continent-ocean boundaries,
resolved topologies and typed boundaries from 0–1800 Ma in a palaeomagnetic
frame. The pinned release is Zenodo record
[13628813](https://doi.org/10.5281/zenodo.13628813), CC BY 4.0; the model paper
is [Cao et al. 2024](https://doi.org/10.1016/j.gsf.2024.101922). These fields
describe plate and continental-lithosphere hypotheses. They do not provide a
time-slice atlas of sea-level shorelines or flooded continental interiors.

Direct inspection of the acquired `shapes_coasts.gpmlz` confirms that its name
is misleading for this purpose. It contains reference-coordinate,
reconstructable continental pieces: for example a `ClosedContinentalBoundary`
named `Ala Shan`, with source attribute `WVS`, geometry import age 0 and broad
geological validity. Rotating such features locates inherited continental
geometry; it does not independently reconstruct shoreline, epicontinental sea
or exposure at each age. The GPlates Web Service likewise lists Cao 2024 layers
as StaticPolygons, Coastlines, ContinentalPolygons, Topologies and COBs over
0–1800 Ma; that list does not change their source semantics. See the official
[GWS model catalogue](https://gwsdoc.gplates.org/models/).

The acquired Cao et al. 2017 palaeogeography is real published surface
geography: landmass and 13,395 shallow-marine polygon records, alongside
mountain and ice categories. It uses Matthews et al. 2016 reconstruction,
contains 24 irregular representative ages with published validity intervals,
and covers approximately 402–2 Ma. The paper explains that Golonka categorical
maps were restored to present coordinates, partitioned with the Matthews model
and revised using fossil occurrences ([Cao et al.
2017](https://doi.org/10.5194/bg-14-5425-2017)). The EarthByte GPlates 2.3
collection states CC BY 3.0. It is useful independent evidence but fails both
required compatibility conditions: no 402–540 Ma coverage and no Cao-2024 frame.

PALEOMAP PaleoDEM v2 is the only acquired published global surface field at all
109 exact five-million-year ages from 0–540 Ma. Zenodo
[5460860](https://doi.org/10.5281/zenodo.5460860) is CC BY 4.0. Land-water and
shallow-deep outlines can be reproducibly derived from its signed metre grids,
but must be described as **derived zero/threshold contours from authored and
modelled PaleoDEM**, not observations or separately authored vector coastlines.
It uses the PALEOMAP model family. The existing material crosswalk to Cao is
already known incomplete (about 81% stable-interior coverage at 250 and 400 Ma)
and cannot map destroyed oceans or close shoreline gaps. Repeating that
2-degree test would add no evidence.

## Merdith 2025 candidate and geometric-transfer assessment

Merdith et al. [2025](https://doi.org/10.31223/X54T9B) describes a
CC-BY-4.0, non-peer-reviewed, MER21-native 1 Ga–present terrain workflow.
Procedural relief uses persistent nodes and tectonic history; subjective,
stage-level PBDB flooding is not a complete exposed-land mask. A coherent
native package still requires the missing code, grids and polygons; shared
Merdith/Cao ancestry is not a conversion.

A cross-model transfer does **not** intrinsically require matching feature IDs.
A defensible offline geometric candidate can: (1) partition each source contour
segment into its PALEOMAP reconstructable material polygon at its authored age;
(2) inverse-reconstruct that source piece to PALEOMAP reference coordinates;
(3) intersect it on the sphere with Cao reference-coordinate static continental
fragments; (4) create deterministic derived pieces from the source/target
feature pair and intersection-geometry hash; and (5) reconstruct each accepted
piece with its Cao child-fragment chart. The output is **derived cross-model
geometric correspondence**, never published lineage or observation.

This is not a new scientific correspondence relative to the existing corrected
crosswalk. That adapter already resolves source material at the authored age,
uses its exact reference direction, tests source material at 0 Ma, assigns Cao
static child-fragment ownership there, and validates target ownership at the
requested/native bracket endpoints. Its 2-degree samples are point diagnostics,
not polygon area or shoreline-segment measurements, but they evaluate the same
reference-space overlap premise. At 400 Ma, only 3,733/4,599 stable continental
interior samples passed (81.17%); 1,042 failures lacked a valid source endpoint
(604 feature-lifetime, 438 different first owner) and 112 failed target present
lineage. A feature-validity end is not material birth or loss. The first
[`revision_stitch_preflight.py`](../../scripts/research/revision_stitch_preflight.py)
trace found a real non-polar 400 Ma target-crust failure: four older polygons
overlap its present polygon and have strict circuits, but none contains the
failed reference point or four nearby probes. That 5.5 KiB result establishes a
missing crust point only; it is not shoreline evidence.

The distinct source-driven
[`source_boundary_transfer_preflight.py`](../../scripts/research/source_boundary_transfer_preflight.py)
starts with 400 Ma PaleoDEM contours, assigns only source polygons active at 400
Ma, inverse-rotates them, then tests Cao static fragments. Its acceptance policy
was written before measurement: every segment endpoint and midpoint must share
one source and target owner with strict rotations; unmatched or ambiguous arc
length must be zero; the target ring must close; and both round trips must be
within 0.001 degrees. Zero metres is a derived boundary from the published/
modelled signed field. -200 m is a declared shelf convention, not a separately
authored shallow-sea polygon.

The deterministic largest eligible zero-metre loop (44–49 E, 63–65.5 S) is
819.27 km: 120.72 km (14.73%) transferred, 503.14 km was source-ambiguous and
195.41 km lacked target material. The -200 m loop (172.07–174.73 E,
10.73–13.85 S) is 1,008.84 km and has unique source ownership, but none has Cao
target material. Both source loops close; neither transferred ring closes.
Supported round trips were exact at recorded precision. The 8.8 KiB result and
policy are in external `revision-stitch/`. This proves the source-first method
was not measured by the old target-interior percentage, while both sampled
boundary loops still reject promotion for concrete ownership gaps.


Promotion would require every source land/shelf/deep boundary ring at every
native age to be segmented into unique accepted overlays; source and target
ownership and strict rotations must hold over the exported interval; spherical
intersection repair and inverse/forward round trips must remain within declared
angular/area error; holes and islands must retain topology; and unmatched or
ambiguous arc length must be exactly zero. A failed arc stays open/unsupported;
it is never joined by nearest geometry or arbitrary closure. Thus this method
is a valid candidate for supported pieces without pre-existing feature IDs, but
evidence does not establish a complete 0–540 Ma outline conversion.

Compiler provenance must retain source model/frame/feature/plate/reference age
and geometry hash, target model/frame/static fragment/chart revision,
method/version, validity, overlap ambiguity and angular/area error. The runtime
chart needs only material/cohort ID, chart ID/revision, lifecycle and a compact
evidence/support code; unsupported conversion does not compile as a fixed
chart. Cao topology can independently compile supported ocean cohorts and
boundary motion over 0–540 Ma. Existing exact-age topology, strict-rotation and
lifecycle results support confirmed/bounded birth/loss records, while overlaps,
slot seams and unattributed deactivations remain ambiguous or unsupported. This
lets model-independent numeric machinery proceed without claiming global
material or shoreline closure.

## Full-paper and repository inspection

The EarthArXiv `combined.pdf` (11,552,510 bytes; SHA-256
`f972c9e2e043c03b0c22f517c8210251a068f2c85e0d5fe3c8f2864cf73d19ba`)
was inspected on 2026-09-10. Its 76 pages contain equations but no embedded
files, data/code statement, repository, DOI, manifest, grids or polygons. The
promised code, unaltered grids and flooding shapefiles are therefore not
auditable from the deposit. The subjective flooding step cannot be reconstructed
from prose; its PBDB input date is still a placeholder. A bounded search of all
public `amer7632` and EarthByte repositories plus exact-title GitHub and Zenodo
queries found no matching workflow artifact. This is not proof against private, unindexed or future artifacts.

## PALEOMAP v19o_r1d fallback inspection

The already acquired [PALEOMAP v19o_r1d archive, Zenodo
10659112](https://doi.org/10.5281/zenodo.10659112) is CC BY 4.0 and covers the
needed time span in its own frame. Its `Scotese_OceansOnly.gpmlz` contains 2,011
`UnclassifiedFeature` polygons with source feature IDs, reconstruction plate
IDs and appearance ages. The plate-polygon file contains 470 features, 468 of
them likewise unclassified; inspected `L_PLATE`, `R_PLATE`, `TYPE` and
reconstruction-method attributes are empty or zero. The archive supplies a
rotation file, but no continuously closing topology collection and no typed
ridge, transform, or polarity-bearing subduction features.

Those ocean polygons are plate-partition/material geometry, not published
shallow-sea or sea-level outlines. Their appearance ages could bound a
source-model ocean polygon’s availability, but do not by themselves identify a
ridge birth or a subduction loss. Relative velocities and polygon adjacency
could support an explicitly **inferred** convergence/divergence classifier.
They cannot meet the user’s requirement for source-typed ridge/subduction
history: shared-boundary identity, subduction polarity and complete event
topology are absent. Nor do they close exposed-land/shallow geography, which
must still come from the signed PaleoDEM surface and be labelled derived
modelled contours.

The [coarse partition
preflight](reconstruction-paleomap-partition-preflight.json) reconstructs both
collections with pyGPlates 1.0.0 at 0, 450 and 540 Ma, then counts polygon hits
at 2,485 regular 5-degree latitude/longitude points. These counts falsify full
coverage but are not area fractions. Plate polygons at 0 Ma yielded 2,481
unique, four multiply owned and zero uncovered points, while nine active plate
IDs lacked strict rotation circuits. At 450 Ma they yielded 717 unique, 27
multiple and 1,741 uncovered; at 540 Ma, 714 unique, 46 multiple and 1,725
uncovered. Every active ancient plate-polygon ID had a strict circuit, so those
ancient gaps are geometric rather than a rotation-query omission.

`OceansOnly` did not supply the complement: its uncovered counts were 1,081,
2,477 and 2,475 at 0, 450 and 540 Ma. Combining both collections produced 1,404
multiply owned points at present and still left 1,739 and 1,725 uncovered at
450 and 540 Ma. Default `pygplates.reconstruct` generated these geometries; the
counts must not be called strictly reconstructed coverage. Missing strict
circuits were audited separately and would make affected states unsupported.

Source typing is not mandatory for every tectonic effect. Where two polygons
are uniquely owned, have strict rotations and a defensibly established local
adjacency, EarthHistory can choose and record an A-to-B tangent-plane normal,
decompose relative velocity into signed normal and tangential components, and
label the boundary class as inference tested against publications. The archive
cannot extend that method across its gaps or establish exact seafloor birth.

## Scalar-field registration is a separate candidate

The two EarthByte workflows do not supply a PALEOMAP-to-Cao geographic warp.
[`paleotopo-data-assimilation`](https://github.com/EarthByte/paleotopo-data-assimilation)
keeps every grid, continental mask, plate assignment and reconstructed geochemical
sample in the Scotese-Wright model. Its province CDF mapping and 150 km residual
kernel change elevation amplitude while explicitly preserving the prior spatial
pattern; they do not move shorelines between models. Its companion-data DOI is
still `TBA`, and the method paper is described as in review. It is useful for
height uncertainty and residual QC, not coordinate registration.

[`simple_paleobathymetry`](https://github.com/EarthByte/simple_paleobathymetry)
constructs ocean depth from seafloor age, thermal subsidence, sediment and one
selected plate model. Continental crust is `NaN` in its main output; optional
pyBacktrack uses model-matched static polygons. Dynamic continent contours are
created from that model's continental polygons. It likewise supplies no
cross-model field deformation or published shoreline transfer.

GPlately 2.0 exposes `Raster.rotate_reference_frames`, including examples that
name two models. Source inspection shows one global finite rotation built from
an arbitrary `non_reference_plate` (default 701), followed by nearest-neighbour
spherical regridding. This is defensible for two known absolute frames sharing a
homologous reference plate. It is not a spatially varying PALEOMAP-to-Cao warp:
it has no continental control correspondences, foldover Jacobian, seam handling
or shoreline topology test. Using plate 701 across unrelated model hierarchies
would silently assume the equivalence at issue.

A new scalar registration remains possible as **conversion
inference**, separate from Cao material history, but these workflows do not
support choosing its deformation. Before a numerical experiment it needs a
published or independently justified control set with withheld controls, a
spherical bijection on each supported domain, positive Jacobian/no foldover,
ring/hole/island preservation, bounded coast and shelf residuals, uncertainty
propagation, and explicit unsupported gaps. It must preserve source class values
and closed outlines and must not treat interpolated ocean pixels as Cao ocean
lineage. No bounded warp experiment is proposed from the inspected methods.

## Gate consequence

The gate remains closed for a complete global native land/shallow/tectonic
package. A degraded PALEOMAP-native package is honest only if PaleoDEM supplies
land/shallow/deep contours and tectonic effects occur solely at locally unique,
strict-circuit inferred adjacencies. Other tectonic history and every seafloor
age remain typed unsupported. This preserves equal runtime capacity across
ages, but does not satisfy complete global mountain-driving tectonics or
material ownership. No additional user scope choice can manufacture the
missing evidence.
Implementation may proceed only with an explicit two-authority contract:
PALEOMAP signed PaleoDEM supplies published/modelled land and shallow contours
in the PALEOMAP frame, while tectonic terrain effects remain unavailable there;
or Cao/MER21 supplies typed tectonics while surface geography remains visibly
unsupported until a model-native artifact is obtained. A future accessible
Merdith supplement could close the second route because it claims all pieces in
one native frame, but this PDF alone does not.

Do not generate shorelines from kinematics, call continental crust exposed
land, treat flooding polygons as the complement of land, infer typed boundaries
from PALEOMAP’s unclassified partition polygons, or use shared Merdith/Cao
ancestry as a coordinate conversion.
