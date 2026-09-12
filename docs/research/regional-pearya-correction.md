# Pearya-target material correction

Status: source-qualified candidate generated on 2026-09-12. It contains two
separate, nonoverlapping material fragments for the three plate-124 Cao charts
that end at 410 Ma: a disputed Pearya-affinity pose scenario and a mapped
northern Laurentian-affinity fragment. Their source affinity, older motion, and
confidence transitions remain separate.

## Result and boundary controls

The exact 410 Ma Pearya target is 42,371.98 km². The official Map 2159A Pearya
domain contains 160 source polygons and covers 6,568.13 km² of that target.
Their convex envelope covers 18,403.24 km² and contains an 11,835.11 km² gap.
A convex envelope alone would incorrectly absorb mapped Ellesmerian and other
domains, so it is not accepted as evidence by itself.

The compiler removes every mapped non-Pearya, non-ice Map 2159A domain inside
the envelope. Those exact mapped domains occupy 3,565.29 km². It applies a 2 km
outward exclusion guard around their 1 km topology-preserving approximation,
clips to the exact target and source envelope, and drops components below 25
km². The guard and component policy remove 6,189.04 km² of the envelope in
total. The final candidate is 12,214.20 km², or **28.826%** of the target, and
has 250 coordinates.

The result retains 5,944.87 km², or 90.51%, of the mapped Pearya source. Its
remaining 6,269.33 km² is an explicit interpolation only through modern ice or
unmapped gaps inside the controlled terrane envelope. A present-day local
equal-area diagnostic classifies 6,025.53 km² of the delivered geometry as
Pearya and 4,580.75 km² as ice; 1,769.03 km² is unmapped in the query. Exact
tests find zero mapped
non-Pearya overlap and zero area outside the target or source envelope.

Map 2159A also shows that much of the remaining Cao target is not mapped as
Pearya. A second fragment admits exactly three independently Laurentian domain
classes: `Ellesmere-North Greenland fold belt`, `eastern Sverdrup Basin,
Eurekan Orogen`, and `Ellesmerian Orogen (Canada and Greenland)`. They include
direct pre-410 material and mapped younger successor-basin or deformed cover
over Franklinian/Laurentian substrate. They are not assigned Pearya affinity.

Those source intersections cover 18,280.35 km². A 1 km source-scale
approximation, 25 km² component floor, exact target clip, and 2 km separation
from the Pearya scenario deliver 17,069.95 km², or 40.286% of the target, in
1,077 coordinates. Area change is 4.204%, area outside the raw mapped source
is 2.336%, and measured overlap with the Pearya fragment is zero. Together the
two fragments restore 29,284.16 km², or **69.112%**, of the exact target in
1,327 coordinates.

## Sources and interpretation

The geometry source is Harrison et al. (2011), *Geological map of the Arctic*,
Geological Survey of Canada Map 2159A, scale 1:5,000,000,
[doi:10.4095/287868](https://doi.org/10.4095/287868). The bounded official
ArcGIS source query, metadata, deterministic aggregate hash, OGL Canada terms,
byte limits, and attribution are shared with the Northern Canada correction.
The pose uses the pinned [Cao et al. v2.4 model](https://doi.org/10.5281/zenodo.13628813),
plate 124, in its palaeomagnetic frame.

Regional literature does not justify calling that pose uniquely known.
[Hadlari et al. (2014)](https://doi.org/10.1130/B30843.1) presents a
pericratonic model. [Powell and Schneider (2022)](https://doi.org/10.1029/2021TC007065)
evaluate Pearya's Paleozoic translation and deformation. McClelland et al.
(2022), [doi:10.1093/petrology/egac068](https://doi.org/10.1093/petrology/egac068),
describe the accretion history as enigmatic and distinguish Pearya from the
Franklinian margin across Silurian deposits and uncertain rocks. Trettin's
[GSC Bulletin 425](https://emrlibrary.gov.yk.ca/gsc/bulletins/425/bu_425.pdf)
revised docking to the latest Silurian, earlier than the latest Llandovery
overlap. Together these sources support a scenario with a visible uncertainty
transition; they do not establish a precise pre-docking position.

The similarly named Cao `Pearya South` closed-boundary feature
`GPlates-00a1a140-c24e-4489-b515-59cc7e389e63` is excluded. It is valid from
1,000 Ma to the present, uses plate 121, occupies a different southern block,
and has zero overlap with the exact plate-124 target at 410 Ma. Combining it
silently would conflate different model entities and does not resolve the
plate-124 residual.

## Time and pose contract

At exactly 410 Ma the native plate-124 charts remain active and the correction
is inactive. The correction becomes active at 410.001 Ma. Its material support
continues through 540 Ma. The Cao-attached pose is shown as qualified only for
`(410, 416]` Ma, spanning the cited Silurian docking interval, and switches to
an explicit uncertain representation just older than 416 Ma through 540 Ma.

The Pearya-affinity candidate is reconstructed to 410 Ma with plate 124 and
carried older on that circuit. Coordinate witnesses agree with an independently
evaluated plate-124 transform at 411, 416, 430, and 540 Ma to numerical
precision. The Laurentian fragment is aligned with the native plate-124 target
at 410 Ma and carried older with plate 101. Because the Cao relation is frozen
over this interval, its witness agrees with the independently evaluated
plate-124 counterfactual at 411, 430, and 540 Ma to numerical precision. It is
qualified through 430 Ma and switches to an uncertain continuation through 540
Ma. These checks validate computation, not a unique geological pose. Surface
exposure, shoreline, and relief remain unknown at every age.

## Artifacts and verification

- `data/corrections/pearya/manifest.json` records the three exact targets,
  source units, bounded interpolation, pose scenario, time phases, rights, and
  rejection conditions.
- `data/corrections/pearya/pearya-material-v1.geojson` contains the two compact,
  nonoverlapping 410 Ma frame material geometries.
- `docs/research/regional-pearya-validation.json` records exact source, hull,
  gap, exclusion, retained-source, coordinate, endpoint, and pose metrics.
- `scripts/research/regional_pearya_compile.py` reproduces the candidate and
  `scripts/research/regional_pearya_compile_test.py` checks those contracts and
  proves a domain-policy mutation fails.

The source-level Canada/Pearya suite passed seven tests on 2026-09-12. Shared
runtime and browser validation is reported by the common material-correction
integration.
