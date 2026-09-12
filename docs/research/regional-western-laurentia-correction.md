# Western Laurentia 410 Ma material correction

Status: source-qualified correction and native-replacement inputs generated on
2026-09-12. The Cao v2.4 source remains immutable.

## Result

The 410 Ma western discontinuity mixes old basement with much younger crust
grouped into modern coastline motion partitions. Two exact Cao targets now have
additive old-material masks. A third target, source order 450, has a complete
age-qualified native replacement input rather than an older lifetime extension.

| Exact target | Native area | Qualified support at 411 Ma | Fraction | Disposition |
|---|---:|---:|---:|---|
| plate 154, order 503 | 663,614 km² | 436,858 km² | 65.83% | Continue old basement and older modeled lithosphere; exclude mapped younger arcs/wedges. |
| plate 1731, order 490 | 453,229 km² | 22,464 km² | 4.96% | Continue independently old basement only; 392,173 km² of mapped U.S. overlap is younger. |
| plate 176, order 450 | 159,302 km² reference | 14,446 km² at 410 Ma | 9.07% | Replace the native polygon with domain-age tiles; do not extend the complete polygon. |

The plate-154 mask combines old USGS basement domains, the independently
authored Laurentia aCOB where it is not contradicted by younger mapped
basement, and the accepted Middle Proterozoic outcrop witness. Surface exposure
remains unknown.

The plate-1731 result reverses the earlier assumption that the complete
455,000 km² `Purcell Mountains North America Craton` chart should survive the
seam. USGS DS898 maps only 22,582 km² of its reference footprint as pre-410 Ma
basement. Its mapped post-410 cohort is 392,173 km², dominated by Franciscan,
Siletzia, Foothills-Wallowa, Shoofly-Olds Ferry, and Calaveras-Baker domains.
Those younger domains remove 81,880 km² from the conservative aCOB candidate.
The final mask uses the complete exact target intersection with independently
old DS898 basement and yields 22,464 km² at 411 Ma. Spatial coincidence
with an old modeled boundary is not ancestry evidence for young material.

## Source-order-450 replacement

The exact target is
`cao-coast:GPlates-9e1d4153-557b-4b65-b6fb-5ec2bfbb2c42:450:0`, plate 176,
named `East Klamath`. It is not an Eastern Klamath terrane footprint. The USGS
Redding 1:250,000 map yields 2,533.7 km² of explicitly identified Eastern
Klamath units and 117.2 km² of Ordovician Trinity ultramafic/gabbro. Both have
zero intersection with the Cao target. The name is a motion-partition label.

DS898 covers effectively the complete target with eight basement domains:

| Domain | Intersection | DS898 crust age | 410 Ma treatment |
|---|---:|---|---|
| Franciscan | 52,491 km² | 165–50 Ma | absent |
| Foothills-Wallowa | 47,120 km² | 280–165 Ma; possible Klamath basement to 300 Ma | absent |
| Great Valley | 32,672 km² | 175–165 Ma | absent |
| Mojave | 13,747 km² | 1,840 Ma | uncertain plate-176 pose |
| Calaveras-Baker | 6,469 km² | 315–215 Ma | absent |
| Shoofly-Olds Ferry | 5,833 km² | 365–187 Ma | absent |
| Salinia | 699 km² | 1,700 Ma | uncertain affinity and pose |
| Siletzia | 272 km² | 60–50 Ma | absent |

The replacement tiles are absent before each domain's possible oldest crust
age, formation-uncertain through its reported interval, and supported after the
younger edge. Domain ages do not mean every point in a polygon formed at once.
DS898's note that Klamath arc basement may be as old as 300 Ma broadens
Foothills-Wallowa beyond its nominal 280–165 Ma field. The Franciscan note
about accretion as young as 15 Ma constrains assembly and is not substituted
for crust formation.

At 410 and 400 Ma only Mojave and Salinia remain, totaling 14,446 km². Shoofly
begins as formation-uncertain at 365 Ma. Visible reference area is 73,867 km²
at 250 Ma, 159,029 km² at 100 Ma, and 159,301 km² at 50 Ma. At 0 Ma the tiles
plus a source-only residual reproduce the exact native target topologically.
Mojave and Salinia are explicit uncertain Cao-pose inferences: DS898 provides
material identity and age, not plate motion, and calls Salinia only a possible
Mojave fragment displaced by 30–0 Ma strike slip.

## Source-order-490 replacement

The plate-1731 native chart is also replaced through its 0–410 Ma lifetime.
Its old DS898 baseline has one owner on either side of the seam: the replacement
owns 0–410 Ma and the additive correction owns `(410, 540]` Ma. The same exact
old-basement intersection is used, so it is not rendered twice. DS898's younger
U.S. domains enter only within their source-age bounds.

The official Northern Cordillera terrane service closes almost all of DS898's
Canadian coverage gap. Sixteen target clips cover all but about 6.9 km². Its
`AGE_RANGE` field describes terrane stratigraphy and plutonism, not basement
birth. It gates material only for juvenile arc, oceanic, or accretionary
domains. Coast plutonic complex, Methow, and Harrison clips retain the original
0–410 Ma native semantics because younger plutons or basin fill do not prove
that their substrate was absent. The final unclassified 6.9 km² does the same.

At 410 Ma the replacement union is 48,642 km², 10.67% of the reference target;
it falls to 27,432 km² at 410.001 Ma because 21,210 km² keeps only its authored
native lifetime. The remaining older support includes the 22,582 km² DS898 old
basement, the Neoproterozoic–Early Jurassic Chilliwack arc clip, and a Devonian
Wrangellia clip. At 540 Ma, 23,455 km² remains with Chilliwack explicitly in a
domain-scale formation-uncertain state. At 1, 0.001, and 0 Ma the replacement
has the same coverage within the recorded 0.001 km² tolerance; the six omitted
sub-100 m² triangulation slivers total 0.000144 km², so no material near-present
disappearance is introduced. All Canadian ages use conservative period bounds
and all poses remain plate-1731 model inference.

## Continental-extent source and reconciliation

The Cao release contains an older input omitted from the coastline-only audit:
`COBfile_1800_0.gpml`, feature order 1284,
`GPlates-a11dc09a-42de-4b11-a6ce-d30baae64ce4`, `Laurentia aCOB`, plate 101,
valid 1070–410.1 Ma. At 411 Ma its raw overlap is 470,969 km² with plate 154
and 106,933 km² with plate 1731.

Merdith et al. distinguish inferred continental lithosphere from observed
coastline and show the 411–410 Ma model junction. The aCOB therefore qualifies
modeled older material extent, not shoreline, relief, or exposure. The
intersection is evaluated at 411 Ma in Cao's palaeomagnetic frame, inset by 1
km, simplified at 2 km with a 100 m guard, and normalized into each target's
reference coordinates. The source begins at 410.1 Ma. Display on `(410,
410.1)` is explicitly a 0.1 Ma junction interpolation; the raw source lifetime
stays unchanged.

USGS DS898 then acts as a material veto and independent old-basement source.
Any aCOB area mapped as post-410 crust is removed. Independently old basement
clips are admitted at conservative aCOB edges. Unmapped aCOB extent may remain
on plate 154 as older modeled lithosphere with identity uncertainty. After
reconciliation the plate-154 reference candidate is 440,020 km² before the
old-rock exposure union; the 411 Ma carried result is 436,858 km². Plate 1731
rejects the 102,408 km² aCOB candidate in favor of the exact independently old
DS898 basement intersection, yielding 22,464 km² at 411 Ma.

Each output uses its target's Cao rigid circuit. This preserves a continuous
model pose but does not supply local Cordilleran deformation. Material support,
pose confidence, and surface evidence remain separate: the first is
source-qualified, the second is model inference, and the third is unknown.

## Sources, rights, and storage

- Cao et al. (2024), [model release 2.4](https://doi.org/10.5281/zenodo.13628813),
  CC BY 4.0. The aCOB collection is 14,423,254 bytes, SHA-256
  `cfcea20c5244613e53ad4b9cdf6411d79ff535c25af335b4fa6eb9251377d4bd`.
- Merdith et al. (2021), *Extending full-plate tectonic models into deep time:
  Linking the Neoproterozoic and the Phanerozoic*. The accepted author
  manuscript and supplement establish the coastline/continental-lithosphere
  distinction; the project lineage record gives full provenance.
- Lund et al. (2015), [USGS Data Series 898](https://doi.org/10.3133/ds898),
  1:5,000,000. The 725,411-byte official FeatureServer GeoJSON has SHA-256
  `007b035b494f84e6a34465971c6b876d65952f77d9be0fdb88bb617756333052`.
  It synthesizes basement, lithotectonic and terrane maps, geophysics, ages,
  isotopes, and field geology into interpreted crust domains.
- Irwin and Wentworth (2012), [USGS Open-File Report
  2012-1228](https://pubs.usgs.gov/publication/ofr20121228), 1:250,000. The
  5,360,801-byte archive has SHA-256
  `fce631d09010046fadfc302b64a06068e0c6b70082de0d7a5a942dce6585517e`.
- Colpron, Nelson, and collaborators, [Northern Cordillera terrane
  compilation](https://open.canada.ca/data/en/dataset/16d06638-87a8-40a4-8550-910370d2fd76),
  revised through 2015 by the BC and Yukon geological surveys, about
  1:5,000,000 scale. The 260,694-byte bbox query has SHA-256
  `8e003e86ecc3b14ce3420afc5cf9bdd6a7f3a9362e6791ad7ffc7117cea45329`.
  The service reports about 1 km polygon accuracy in British Columbia and
  Yukon and carries the Open Government Licence - Canada.
- Reed and Bush (2005), [Generalized Geologic Map of the Conterminous United
  States](https://pubs.usgs.gov/atlas/geologic/), version 2.0, 1:5,000,000.
  Its `Y` class is retained only as a mapped Middle Proterozoic exposure
  witness.

USGS-authored government data are generally public domain under 17 USC 105;
source scale, warranty, and credited third-party caveats remain attached. The
new source bundle lives under
`../EarthHistory-data/palaeomap-study/regional-corrections/western-completion/`,
uses about 18.9 MB of its authorized 128 MiB allocation, and has its own storage
policy and hash manifest. The complete study store remains below 4 GiB.

## Artifacts and validation

- `data/corrections/western-laurentia/manifest.json` records the two additive
  targets, sources, pose, support interval, uncertainty, and rejection rules.
- `western-laurentia-qualified-material-plate-154-v3.geojson` and
  `western-laurentia-qualified-material-plate-1731-v3.geojson` are additive
  masks for ages older than 410 Ma.
- `western-source450-domain-tiles-v1.geojson` contains eight exact
  target-domain intersections. Mojave and Salinia continue to 540 Ma; the
  younger tiles remain within the native interval.
- `western-source490-domain-tiles-v1.geojson` contains the old native baseline,
  nine younger DS898 domain clips, sixteen Northern Cordillera terrane clips,
  and a 6.9 km² inherited native residual.
- `native-overrides.json` pins both target identities, complete native
  suppression intervals, replacement assets, hashes, and ownership policy.
- `regional-western-laurentia-validation.json` records aCOB, basement-veto,
  coverage, containment, and pose measurements.
- `regional-western-source450-validation.json` records all source450 domain
  areas, age snapshots, mapped-terrane mismatch, and replacement policy.
- `regional-western-source490-validation.json` records DS898 and Canadian
  classifications, lifecycle ownership, endpoint snapshots, and the measured
  0.001 km² present-union tolerance.
- `scripts/research/regional_western_compile.py` and
  `regional_western_source450_audit.py`, `regional_western_source490_audit.py`,
  and `regional_western_native_overrides.py` reproduce the outputs from
  hash-pinned sources.

The focused suite runs ten tests covering exact source identities, the 410.1
Ma aCOB endpoint, DS898 contradiction removal, deterministic output,
source-order-450 and 490 snapshots at 540/410.001/410/400/365/250/100/50/25/5/1/0.001/0 Ma,
present union within the recorded 0.001 km² tolerance, production spherical
triangulation of every retained source-490 residual component,
mapped-terrane non-overlap, storage bounds, strict motion, and deliberate
source/target mutations.
