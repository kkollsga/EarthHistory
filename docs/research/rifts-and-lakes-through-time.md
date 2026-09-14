# Rifts and lakes through time

Research, acquisition, validation and package record, 2026-09-14. Two user
reports drove this work: the North Sea, a failed rift, never opened (England and
Norway kept a constant distance at every age), and the East African Rift never
looked active because its lakes were always there. A third instruction followed:
model the East African Rift so that Africa widens slightly through it.

Companion records: [literature tables](rifts-and-lakes-literature.md) (North
Sea extension, East African Rift kinematics, lake onsets, Natural Earth lakes;
85 sources), [Müller 2019 comparison](rifts-and-lakes-muller2019-comparison.json),
[lake-void audit](rifts-and-lakes-lake-void-audit.json),
[lake-void validation](regional-lake-void-infill-validation.json),
[North Sea fit](north-sea-restoration-fit.json) and
[North Sea validation](north-sea-restoration-validation.json).

## Reproduced defects

Both were measured on the compiled public package with a runtime probe that
picks the chart under a present-day point, follows that chart's pose to each
requested age, and classifies the surface there.

| Witness | Before | Cause |
| --- | --- | --- |
| London-Bergen, Aberdeen-Stavanger | 1044 km and 505 km at every age 0-400 Ma | Cao v2.4 keeps plates 315 (England-Brabant), 303 (Northern Scotland), 331 and 330 identity to Baltica/Europe from 0 to 430-440 Ma; no plate pair spans the Viking or Central Graben |
| Kampala-Nairobi | 500 km at 0 Ma, 414 km from 20 Ma back | Cao v2.4 rotates Somalia (709) 1.01 degrees relative to Nubia (701) between 19.7 and 0 Ma (Iaffaldano et al. 2014 poles); the western branch (712, 713 and 701 fragments) is fixed to Nubia |
| Victoria, Tanganyika, Malawi, Albert, Turkana, Chad, Superior, Baikal | shelf class at 0, 20, 300 and 450 Ma | the Cao coast layer (`shapes_coasts.gpmlz`) excludes the large lakes from every coast polygon while the continental outline covers them; the compiler carried the voids with the owning plate's full lifecycle |

## Acquisitions and environment

| Item | Where | Identity | Rights |
| --- | --- | --- | --- |
| Müller et al. 2019 plate model v3.0 | acquisition store `plates/downloads/muller2019-v3.0-record11601026.zip`; 36 selected members extracted | 85,689,718 bytes, SHA-256 `fa773088ab1d05b3450fd3d7294f23932dca5658ee2b8f94c979e1faebea107e`, retrieved 2026-09-14T18:23Z | Zenodo record and `License.txt` say CC BY 4.0; the bundled README says CC BY-SA 4.0. Treated as a validation comparison only; no Müller geometry or rotation is redistributed |
| Natural Earth 1:10m lakes | store `geography/natural-earth-lakes/ne_10m_lakes.geojson` | 5,043,554 bytes, SHA-256 `2d036f53…8f2d9`, retrieved 2026-09-14 | Public domain |
| Natural Earth 1:50m lakes | store `geography/natural-earth-lakes/ne_50m_lakes.geojson` | 876,018 bytes, SHA-256 `d350b759…78a52` | Public domain; audit only |
| pyGPlates environment | store `verification/pygplates-venv` | pyGPlates 1.0.0, Python 3.9.6, plus shapely 2.0.7 and pyshp 3.1.6 added 2026-09-14 (214 to 228 MiB) | tooling |

pyGPlates 1.0.0 note: `resolve_topologies(..., resolve_topology_types=network)`
segfaults in this build; resolving all types and filtering the result works.

## Müller 2019 deforming networks

Frame-aware overlap test at 1 Myr steps over 0-250 Ma:

- North Sea: `North_Atlantic_Phase1_Deformation_Mesh` (200.0-120.1 Ma, plate
  301) contains Shetland, Aberdeen, London and Dogger Bank from 200 to 141 Ma.
  No Permian-Triassic and no Cenozoic North Sea network exists. Norwegian
  points are never inside a network.
- East Africa: `EAR_Mesh` (12-0 Ma, plate 709) and `AFRICA_ARABIA_MESH_2`
  (30-0 Ma) exist, but no inland sample point (Kampala, Nairobi, Dodoma, Addis
  Ababa, Kinshasa, Lusaka) lies inside them; Somalia-Nubia is the same rigid
  Iaffaldano rotation as in Cao 2024.

Relative displacement (km closer than today) with the network, points on the
UK side relative to Baltica (302):

| Pair | 200 Ma | 170 Ma | 141 Ma and younger |
| --- | ---: | ---: | ---: |
| Shetland-Bergen | 53.5 | 27.3 | 0 |
| Aberdeen-Stavanger | 35.1 | 17.4 | 0 |
| London-Bergen | 5.0 | 2.6 | 0 |

Per-point displacement at 200 Ma: Shetland 66.2 km (+1.035 deg lon, -0.301 deg
lat), Aberdeen 38.7 km, Dogger Bank 32.4 km, London 22.9 km. Kampala-Nairobi is
86.1 km closer at every age of 20 Ma and older in both the deforming and the
rigid run.

## Literature synthesis used as authority

Northern North Sea, 61 N transect (East Shetland Basin, Viking Graben, Horda
Platform), from Odinsen et al. 2000, Roberts et al. 1993 and 1995, Cowie et al.
2005 and Faerseth 1996 (our arithmetic on their stretching factors and widths;
see the literature record for the verbatim figures):

| Phase | Extension | Timing |
| --- | ---: | --- |
| Permian-Triassic | 35-55 km, central 45 | latest Permian to Triassic, about 250-230 Ma |
| Late Jurassic-Early Cretaceous | 20-35 km, central 27 | about 170-130 Ma |
| Total Mesozoic | 55-90 km, central 72 | on a 200-250 km wide basin |
| Devonian post-Caledonian | about 30 km (mode I, onshore southern Norway) | 403-380 Ma; not restored |

The Müller network total (53.5 km at Shetland-Bergen, Jurassic mesh only) lies
inside the lower part of the published range.

East African Rift: Somalia-Nubia 0.065 deg/Myr about 34.4 N 142.2 W (Saria et
al. 2014); 42.5 ± 3.8 km rift-normal extension across the northern Main
Ethiopian Rift since 10.6 Ma (DeMets and Merkouriev 2016); Turkana 35-40 km
(Hendrie et al. 1994); western-branch basins 2-10 km each (Ebinger 1989);
Victoria-Nubia 0.076 deg/Myr about 12.1 N 32.5 E (Saria et al. 2014), which
integrates to about 26 km at Tanganyika over 10 Myr against 10-15 km from the
geological estimates. Onsets: Turkana and the western branch about 25 Ma,
Tanganyika central basin 9-12 Ma, Malawi 8.6 Ma, Albert 8 Ma (17 Ma
deposition), Turkana lakes 4.1 Ma, Victoria 0.4 Ma.

## Lake-void infill (bug fix)

Audit: of the Natural Earth 1:10m lakes of at least 100 km², 50 have at least
half their area outside every Cao coast polygon and inside the continental
outline (42 at 1:50m). Kivu, Edward, Rukwa, Kyoga, Tana, Bangweulu and
Eyasi are already land in Cao and are untouched.

Correction `earthhistory-lake-void-infill-v1`
(`data/corrections/lake-voids/`, compiler
`scripts/research/regional_lake_void_compile.py`, contract
`regional_lake_void_correction.py`): for each of 48 lakes the Cao void itself
(continental outline minus coast, restricted to the lake's connected
component) is cookie-cut by the present Cao static partitions into 101 pieces
so each piece moves with its own plate exactly as the native charts around it.
Each piece is a land-appearance chart in the `material-correction-qualified`
batch with lifecycle `(onset, nativeOldest]`, where `nativeOldest` is the
oldest age of the native coast charts touching the piece (up to 1800 Ma) and
`onset` is the cited basin onset from `lake-onsets.json` (29 curated rows, 17
sources) or exactly 0 Ma for lakes without a citation (reservoirs, lagoons,
post-glacial lakes without a retrieved primary number). Total emitted area
715,323 km². At 0 Ma nothing changes; at every age older than its onset a lake
reads as land.

Validation: the contract self-test rejects seven mutations (present-active
infill, lifecycle beyond 1800 Ma, uncited onset, plate changed against
geometry, feature removed, native source changed, Lake Victoria geometry moved
off its witness); the runtime validator accepts the new source type only with
`materialStatus: supported`, `poseStatus: model-inference`, a matching
`lakeOnsetMa` and an exclusive youngest bound, and rejects any other family
above 540 Ma; `src/reconstruction/lakeVoids.test.ts` probes eight lakes at
0 Ma, half their onset, exactly the onset (water) and just older, 74 Ma and
300 Ma (land). The composed package grew to 403,322 vertices and 571,656
triangles, under the 520,000 / 660,000 production reservation; the pinned
composed-geometry budget in `apply_regional_iceland_shelf.py` moved from
400,000 to 440,000 vertices with that explanation.

## North Sea restoration (regional model hypothesis)

Contract `earthhistory-north-sea-restoration-v1`
(`data/corrections/north-sea-restoration/restoration-contract.json`, written
by `north_sea_restoration_fit.py`, applied by
`apply_north_sea_restoration.py`, gated by
`validate_north_sea_restoration.py`): one Euler pole for the UK block relative
to Baltica at 3.9 W 44.95 N, fitted to the four Müller 2019 displacement
vectors at 200 Ma (RMS great-circle misfit 15.0 km; the network is not a rigid
rotation), and an angle schedule solved so that Shetland-Bergen closes by the
literature curve: 0 km to 130 Ma, 4 km at 140, 23 km at 160, 27 km at 170-200,
34 km at 230, 60 km at 250, 72 km at 270 Ma and constant to each chart's
oldest lifecycle (600 Ma for plate 303, 420 Ma for plate 315). Resulting
witness closures at full restoration: Aberdeen-Stavanger 46.6 km,
London-Amsterdam 24.5 km, London-Bergen -4.8 km (London sits near the pole
latitude and moves east-south-east).

Package change: two palette entries (`restoration-north-sea-plate-303-130-600`,
`restoration-north-sea-plate-315-130-420`, 836 samples at 1 Myr plus every
native knot and schedule knot) whose samples are the native Cao rotation
composed with the restoration rotation; 28 charts rebound (19 Scottish coast
charts, 5 English, Welsh and Irish coast charts, 2 Scottish shelf charts, and
the GBR and IRL outline charts on plates 303 and 315) from the window start to
their oldest lifecycle. Straddling shelf polygons (315, 330, 301, 302
continental outlines) stay on Baltica, so restored land overlaps model shelf
rather than closing it; the 303 charts keep the closure offset on the
Laurentian side of the 430 Ma seam, a documented limitation that avoids a
jump at a shared knot. Correction charts on the block plates keep native
motion (the emitter ignores restoration entries).

Validation: the pyGPlates oracle re-derives every quarter-Myr and knot pose
(maximum residual 2.8e-5 rad); the pure-Python gate validator checks contract
geometry, bindings, packaged closure witnesses within 2 km and the oracle
record against the core identity, and rejects five contract mutations and one
package mutation; `src/reconstruction/northSeaRestoration.test.ts` reproduces
the schedule closures through the runtime and holds Bergen-Amsterdam and
Bergen-Stavanger fixed.

## East African Rift decision

The eastern branch already widens Africa in Cao v2.4 by the Iaffaldano
Somalia-Nubia rotation (about 86 km at Nairobi since 20 Ma), identical in
Müller 2019. The western branch is not modelled as motion: geological totals
of 10-30 km per basin sit below regional-zoom resolution and disagree by a
factor of two with the integrated geodetic rate, so the planned Victoria-block
restoration was cancelled by its stop rule. The East African Rift point of
interest now states both facts, and the lake infill makes the rift visibly
young.

## Browser evidence

Production preview captures at 0, 150, 200 and 300 Ma over the reconstructed
North Sea and at 0, 5, 15 and 30 Ma over East Africa show the rift lakes
present today and absent at 30 Ma, and Britain against Norway at 200 and
300 Ma, with no page or console errors (retained under
`dev-docs/bench/out/rifts-and-lakes-2026-09-14/`, not a durable citation).

## Limitations and follow-ups

- The restoration is a transect total applied as one rigid rotation; it is not
  a strain field and does not restore the Devonian extension.
- Present-day lakes keep the model's shelf appearance; a distinct lake colour
  and popup are cosmetic follow-ups.
- The North Sea point of interest has no native anchor yet, so it lists but
  does not mark the globe at 130-270 Ma.
- `dist` sits at 49.93 MiB of the 50 MiB artifact ceiling after both changes.
