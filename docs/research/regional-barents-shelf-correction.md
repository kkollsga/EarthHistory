# Regional Barents shelf lifecycle correction

**Accepted operation:** `earthhistory-regional-barents-shelf-lifecycle-v1`
extends three existing Cao continental-outline shelf charts from 410 through
600 Ma. The operation changes lifecycle and motion bindings only. It adds no
geometry and does not classify water depth, land exposure, or a palaeoshoreline.
The blue rendering remains the application's visual convention for Cao model
continental-outline shelf context with unknown surface state.

## Reproduced failure and cause

At 409 Ma, the native `shapes_continents.gpmlz` layer covers the reconstructed
central Barents, West Svalbard, and East Svalbard witnesses. All three disappear
at ages older than the inclusive 410 Ma endpoint because their compiled
shelf-chart lifecycles end there. At 422 Ma,
the transformed central Barents witness at present-reference 31.163244°E,
76.985297°N lies at 61.634423°W, 4.616749°N and has no active native shelf
chart. The regional source-qualified material correction is still present, but it represents
continental material with unknown exposure; recoloring it would falsely turn
material continuity into a shallow-sea claim.

The omission comes from a source-collection lifecycle mismatch. The pinned Cao
`shapes_continents.gpmlz` assigns the three features an oldest age of 410 Ma.
The separately authored `COBfile_1800_0.gpml` contains the same feature IDs,
plate IDs, names, types, and ordered polygon coordinates, with an oldest age of
600 Ma. Their float64 XYZ geometry hashes match exactly across both source
files. The already shipped shelf geometry is therefore reused without spatial
inference.

| Feature | Plate | Vertices | Exact geometry SHA-256 |
| --- | ---: | ---: | --- |
| East Svalbard, Northern Europe (`GPlates-12d36765-58ee-488d-9383-4a58fd55080c`) | 311 | 35 | `f43a2326e16e6f164373951b3f2f3fb7191f5d5b0726f6770963075461f86d17` |
| East Svalbard (`GPlates-9653c415-6d07-4bf4-8884-da5a535b03b6`) | 311 | 23 | `e69027e2af295fe34b219c010e63b78c3f840524e10713002ee6263426dd5e17` |
| West Svalbard (`GPlates-9711c046-0949-4fda-a338-6ea2d48e27dc`) | 309 | 51 | `dc51ad9cdc975a6c8aa898941c3b3381d3ae1263e0dcbd1eebcae1afce808b75` |

Novaya Zemlya and Franz Josef Land remain excluded. Their corresponding
features end at 410 Ma in both Cao source collections, so this evidence does
not authorize a shelf lifecycle extension for either region.

## Source, frame, rights, and validity

Cao et al. (2024) model v2.4 is archived at
[doi:10.5281/zenodo.13628813](https://doi.org/10.5281/zenodo.13628813) under
CC BY 4.0 and was retrieved on 2026-09-09. The lifecycle authority is
`COBfile_1800_0.gpml`, 14,423,254 bytes, SHA-256
`cfcea20c5244613e53ad4b9cdf6411d79ff535c25af335b4fa6eb9251377d4bd`.
The compiled geometry source is `shapes_continents.gpmlz`, 1,243,843 bytes,
SHA-256
`6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616`.
Both use the Cao v2.4 palaeomagnetic frame, anchor plate 0. The pinned rotation
aggregate is
`80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f`.

The corrected interval is inclusive at 600 Ma and inactive at ages older than
600 Ma. Plate 309 and 311 motion is compiled from the same Cao rotations. The
existing 0–505 Ma palette entries are retained; only bounded 505–600 Ma entries
are added. Quarter-million-year oracle probes across the full repaired
410–600 Ma lifecycle must remain within 0.00001 rad of strict pyGPlates
reconstruction. The isolated candidate peaks at 0.000000089407 rad at 468 Ma.

## Reproduction and validation

[`apply_regional_barents_shelf.py`](../../scripts/research/apply_regional_barents_shelf.py)
validates source bytes, feature identity, exact geometry equivalence, original
410/600 Ma lifecycle mismatch, shelf-batch membership, frame identity, and
motion accuracy before changing a candidate package. It permits changes only
to the three named chart records, two appended motion entries, their palette
interval, the material-correction catalog's `baseline.coreSha256` binding,
package asset identities, and the package scope text. The other material
catalog fields, all 90 tracked correction targets, shelf and land geometry
assets, and every native coastline chart stay unchanged.

[`apply_regional_barents_shelf_test.py`](../../scripts/research/apply_regional_barents_shelf_test.py)
reproduces all three 422 Ma omissions on the released baseline, exercises the
repair in a temporary package, checks 0, 409, 422, 600, and 600.000001 Ma,
and rejects source-geometry and chart-identity mutations. The correction input
is [lifecycle-contract.json](../../data/corrections/barents-shelf/lifecycle-contract.json).

[`validate_regional_barents_shelf.py`](../../scripts/research/validate_regional_barents_shelf.py)
is the clean-checkout gate. It validates the three emitted chart identities,
shelf membership, unknown-surface semantics, lifecycle endpoints, core/catalog
binding, and the two bounded motion entries without requiring the raw Cao source
pool. Its mutation self-test proves that restoring any repaired chart's oldest
age to 410 Ma is rejected.
