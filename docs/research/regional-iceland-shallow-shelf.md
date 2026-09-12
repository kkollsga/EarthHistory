# Regional Iceland shallow-marine correction

Research and retrieval date: 2026-09-12. Proposed runtime correction:
`earthhistory-regional-iceland-shallow-marine-v1`.

## What the source supports

Iceland has an insular shelf, but “shelf” and “shallow sea” are different depth
classes. Harðarson, Fitton & Hjartarson (2008) describe Iceland and its insular
shelf as about 350,000 km² in total, of which about 103,000 km² is above sea
level. The shelf is 50–200 km wide and slopes gently to about 400 m before the
slope drops to the deep ocean. That is a morphological shelf
boundary, not a 200 m shallow-water contour.

The Marine and Freshwater Research Institute's 2026 Southern Shelf Slopes
technical report describes an irregular southern shelf about 400 km long. Its
mean depth is about 200 m; roughly 60% is formed by banks at 110–200 m,
separated by seven glacial troughs reaching 370 m. The report also says the
present shelf break probably began to form near the start of the Holocene and
relates the canyon system to glacial and sediment-transport history. This
evidence rejects a uniform buffer around the modern coast and prevents the
present bathymetric shape from being backdated as a palaeoshelf.

## Bounded modern geometry

The correction uses Natural Earth 1:10m Bathymetry `L_0` and `K_200`, public
domain WGS84 nested polygons derived from SRTM Plus. The direct archives each
contain an embedded `VERSION.txt` value of 4.1.0. The Natural Earth page still
labels the individual 0 m and 200 m downloads as 4.0.0, so the compiler pins the
retrieved archive bytes and embedded version:

| Archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `ne_10m_bathymetry_L_0.zip` | 3,000,229 | `3a950927bde293cd7a59e2618a9ee99cff1ad8422a886e9e8b47538a1de6f36b` |
| `ne_10m_bathymetry_K_200.zip` | 1,197,185 | `68fe55b9ac57bd8255696d83259f5856594a60c582dd395de9c1772179337887` |

Natural Earth represents deeper water as nested polygons. The source operation
is the Iceland component of `L_0` ocean minus the union of `K_200` deeper-water
polygons. It produces one connected source polygon with seven holes, 4,388
vertices, bounds 26.753285° W to 11.869252° W and 63.150824° N to 67.261115° N,
and spherical area 113,421.318 km². The holes retain islands and enclosed
nominally deeper water. They are not filled merely to make the shelf look
continuous.

Natural Earth states that its 200 m layer is slightly buffered around
coastlines and that isobaths around islands, seamounts and steep slopes were
manually generalized for legibility. EarthHistory therefore classifies this
shape as **generalized nominal 0–200 m shallow-marine context**. It is not an
exact measured-depth mask and does not represent the broader shelf down to
about 400 m. The independently sourced Natural Earth 1:50m modern Iceland land
renders above it. The compiler uses the same-release `L_0` coast boundary for
the water operation and neither snaps nor buffers the 1:50m land or bathymetry
to hide shoreline mismatch.

The source polygon's sampled outer-edge distance from the main-island coast has
a median of about 63 km and a maximum of about 171 km. Natural Earth land plus
this 0–200 m context is about 215,000 km², smaller than the published
approximately 350,000 km² land-plus-shelf area to 400 m. Both checks are
consistent with the source meanings; neither calibrates Natural Earth's
generalized contour as a measured Icelandic bathymetric product.

The compiler applies a 0.005° topology-preserving simplification. The result has
2,291 vertices, 113,432.738 km² area, relative area error 0.000100686 and
Hausdorff distance 0.004997703°. The exact Cao v2.4 present-day North
America–Eurasia ridge partition adds split-edge vertices, producing plate
pieces with 1,065 vertices and 53,476.039 km² on plate 101 and 1,248 vertices
and 59,956.680 km² on plate 301.

## Time and growth interpretation

Both shelf charts are active only at exactly 0 Ma. Every age greater than zero,
including 0.000001 Ma, is a negative witness. The two-plate split preserves the
package's Cao frame and chart identity; the modern shelf is never reconstructed
backward.

Iceland did not evolve as a small copy of today's shoreline enlarged at a
steady rate. Harðarson et al. report exposed rocks older than 15 Ma in northwest
Iceland, about 14 Ma in eastern Iceland and about 12 Ma in northern Iceland,
together with major ridge jumps during the last 16 million years. The paper's
discussion of an ancestral island or island chain is conditional, and its
present-Iceland formation statement does not provide dated palaeoshoreline
geometry. Volcanic construction, ridge relocation, loading, subsidence,
glaciation and sea-level change all separate material age from emergence.

The existing IINH outcrop-age correction shows partial volcanic material
support at non-modern ages with unknown exposure. Its age-dependent footprints
are not a simulation of island growth. The available sources do not justify
interpreting those footprints as ancient exposed land or shallow sea. The historical IINH geometry and its frozen Natural Earth
1:110m coverage denominator are unchanged.

## Build and rejection checks

[`regional_iceland_shelf_compile.py`](../../scripts/research/regional_iceland_shelf_compile.py)
verifies source bytes, embedded versions, depth attributes, WGS84 declaration,
topology, simplification error and the exact Cao ridge partition before emitting
the two-feature GeoJSON and source contract. The source archive pool is bounded
outside the repository at
`../EarthHistory-data/palaeomap-study/verification/regional-iceland-shallow-shelf-v1/source-inputs`.

[`regional_iceland_shelf_correction.py`](../../scripts/research/regional_iceland_shelf_correction.py)
runs in a clean checkout without the external pool. Its optional `--sources`
mode checks the original archives, while `--self-test` proves that shelf
backdating, a land relabel, source drift, shoreline buffering and a false exact
depth claim are rejected. The compact source report is
[`regional-iceland-shallow-shelf-validation.json`](regional-iceland-shallow-shelf-validation.json).

The runtime integration appends two charts and their geometry to the existing
blue `batch-shelf`. Existing decoded shelf positions, heights, chart indices
and triangles remain unchanged; the binary header and array offsets change as
new geometry is appended. Existing chart science fields remain unchanged by
this operation. Their former numeric 400 m height limitation is replaced with
the accurate, numeric-free statement that renderer shell offsets are not source
elevation; separately documented exact-identity Cao lifecycle repairs remain
separate operations. Because core chart indices precede correction chart
indices, adding two core charts requires regenerating the three correction
EHGBs with chart indices increased by two. Acceptance compares their decoded
per-chart positions, heights, triangles, lifecycles and evidence rather than
requiring byte identity. The motion palette remains byte-identical, and the
five-batch, 400,000-vertex and 600,000-triangle limits remain in force.

The source mesh is triangulated with the existing conforming one-degree edge
bound. It adds 2,348 vertices and 2,387 triangles (75,604 bytes), taking the
shelf batch to 156,252 vertices and 253,574 triangles. The composed five
batches contain 361,829 vertices and 521,541 triangles.

The renderer uses a 400 m display-only shelf shell and an 800 m display-only
land shell. These values do not assert water depth or land elevation. A
whole-package float32 envelope check measures the shelf minimum triangle radius
as 1.000014908 and its maximum vertex radius as 1.000062833. The minimum land
triangle radius is 1.000077689, leaving about 94.7 m of radial ordering margin.
The same oracle deliberately fails with the former 80 m shelf shell and former
400 m land shell. This is a conservative mesh-ordering contract against a unit
sphere; it is not a claim that every triangle below that envelope was visibly
occluded by the lower-resolution rendered globe.

Primary records: [Natural Earth bathymetry](https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-bathymetry/),
[Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/),
[Harðarson et al. 2008](https://jokull.jorfi.is/articles/jokull2008.58/jokull2008.58.161.pdf),
and the [Marine and Freshwater Research Institute 2026 Southern Shelf Slopes
report](https://www.hafogvatn.is/static/extras/images/area_shl_2026_techreport_en.html).
