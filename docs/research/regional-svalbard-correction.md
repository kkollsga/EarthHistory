# Regional Svalbard material correction

**Accepted candidate:** `earthhistory-regional-svalbard-material-v1` uses the immutable West and East Svalbard targets clipped by their respective separately authored, valid-to-600 Ma Cao closed continental boundaries. Norwegian Polar Institute old-rock exposures and regional Caledonide syntheses independently support older material affinity for both cohorts. Both represent continental material while the native coast polygons are inactive older than 410 Ma. Neither represents exposure, a palaeoshoreline, relief, or ice state; surface state is `unknown`.

## Sources and rights

The Norwegian Polar Institute (NPI) source is **Geology, Svalbard — Geological units 1:750,000**, ArcGIS layer 10. The reproducible query retrieved all 4,237 records in `OBJECTID` order on 2026-09-12 in OGC CRS84. The 12,206,233-byte GeoJSON has SHA-256 `c6f518f26fd2d78139f64210434fa6ae85a9a135940ba5c81b3a1c73deb20abc`. NPI licenses the product under [CC BY 4.0](https://geodata.npolar.no/bruksvilkar/) and requires attribution `© Norwegian Polar Institute`. The service gives no scientific map version or edit date; ArcGIS `currentVersion: 10.81` is only the server version.

Cao et al. (2024) model v2.4, [doi:10.5281/zenodo.13628813](https://doi.org/10.5281/zenodo.13628813), supplies the target polygons, rotations, and closed continental-boundary collection under CC BY 4.0. The pinned `COBfile_1800_0.gpml` is 14,423,254 bytes with SHA-256 `cfcea20c5244613e53ad4b9cdf6411d79ff535c25af335b4fa6eb9251377d4bd`. The West boundary `GPlates-9711c046-0949-4fda-a338-6ea2d48e27dc` is assigned to plate 309; the East boundary `GPlates-9653c415-6d07-4bf4-8884-da5a535b03b6` is assigned to plate 311. Both are valid from 600 Ma through the present. Another Cao feature named `East Svalbard, Northern Europe` has a different alternative footprint and zero overlap with the exact East target; it is not substituted or unioned into this correction. These boundaries support modelled continental-material extent; they do not establish ancient emergence.

The external NPI acquisition owns at most 128 MiB in the existing 4 GiB `palaeomap-study` source store. Its manifest pins source, service, licence, and query responses by byte count and SHA-256, caps each HTTP body and the staging peak, reuses only matching files, and refuses replacement in place.

Regional interpretation relies on Michalski, Lewandowski and Manby (2012), [doi:10.1017/S0016756811000835](https://doi.org/10.1017/S0016756811000835), Gee et al. (2008), [doi:10.18814/epiiugs/2008/v31i1/007](https://doi.org/10.18814/epiiugs/2008/v31i1/007), and Labrousse et al. (2008), [doi:10.1029/2007TC002249](https://doi.org/10.1029/2007TC002249). They support Caledonian and older basement affinities while preserving disagreement over terrane correlation and Barentsia alternatives.

## Two qualification paths

For **West Svalbard**, the compiler unions the five immutable Cao plate-309 targets and intersects them with the independently authored West Svalbard closed continental boundary. The target is effectively completely contained in that boundary: measured containment is greater than 99.9999%. A 1.5 km inset and 500 m topology-preserving simplification leave 21,416.17 km² in five components with 160 vertices. The result loses 12.881% of the target area, stays wholly inside both target and boundary to one square metre, and remains below the 25% loss ceiling. NPI Precambrian exposures and regional synthesis support older material, while modern younger cover and ice contribute footprint only.

For **East Svalbard**, the exact plate-311 target is 99.9716% contained by the exact `East Svalbard` closed boundary. The target/boundary intersection is 33,759.35 km². The same 1.5 km inset and 500 m topology-preserving simplification deliver 30,251.07 km² in seven components with 165 vertices, a 10.392% loss. The output has zero measured area outside the target or boundary. The 380 retained NPI Palaeoproterozoic, Mesoproterozoic, Tonian, and Cryogenian parts remain independent old-rock affinity witnesses; younger units and ice locate inferred substrate only.

At 440, 500, and 540 Ma, 92.42% of the original East old-rock witness lies within an active older Greenland continent/static polygon. That is evidence of a Greenland-affinity continuum and a rendering overlap, not a scientific reason to erase the independently supported East Svalbard material. The shared native-precedence rendering contract resolves the overlap without treating the older Greenland alternative as the boundary of the East correction.

The combined delivery is 51,667.25 km²: 88.545% of the summed 58,351.57 km² area of the 11 Svalbard targets and 10.893% of the summed 474,306.92 km² area of the 40 Barents targets. The Svalbard residual scale indicator is 6,684.32 km². The original age-selected NPI source parts total 2,153.09 km²; that value records provenance support rather than the full delivered mask. These comparisons mix equal-area union numerators with summed spherical target-part denominators and are not exact set coverage.

The thresholds were not preregistered. The original outcrop compiler recorded gates during exploratory measurement, including its fallback ladder after a failed simplification. A rough West target/COB containment screen also preceded the expansion rule. Both rule sets were frozen before the reproducible final compiler and mutation tests were rerun. `qualification-policy.json` records this sequence explicitly.

## Pose and overlap interpretation

Material support is `(410, 540]` Ma. Pose confidence is split between source-qualified model use on `(410, 430]` and an uncertain continuation on `(430, 540]`; the material does not disappear at the confidence boundary. Reference geometry remains in modern WGS84 coordinates and uses only the authored Cao rotations for plates 309 and 311 in the model's palaeomagnetic frame, anchor plate 0.

At exactly 410 Ma, Cao's native West/East coast, continent, and static features still cover the correction and the activation guard suppresses it. At ages just older than 410 Ma the coast records are inactive. Both boundary features remain separate source witnesses through 540 Ma. When another active native feature represents the same material, the correction remains an underlay and native visual and picking precedence prevents double representation.

Independent runtime witnesses at 411, 430.001, and 540 Ma satisfy the existing `INTERPOLATION_TARGET_RAD = 1e-5` foundation criterion. The maximum float32-palette residual is `5.78543e-6` radians, about 36.9 m on the stated sphere.

## Reproduction and checks

`scripts/research/regional_svalbard_acquire.py` reproduces or verifies the bounded NPI snapshot. `scripts/research/regional_svalbard_compile.py` reproduces both target/boundary intersections, area gates, compact geometry, target and source hashes, pose checks, and overlap evidence. The acquisition suite has five capacity, response-bound, and immutability tests. The compiler suite has ten tests, including deliberate mutations of the East boundary identity, source age, geometry lineage, plate assignment, lifecycle, pose confidence, processing metrics, and out-of-cohort geometry. The common Cao source-oracle validator checks the tracked inputs and public correction catalog.

Machine-readable evidence is in [regional-svalbard-validation.json](regional-svalbard-validation.json). The tracked inputs are [manifest.json](../../data/corrections/svalbard/manifest.json), [qualification-policy.json](../../data/corrections/svalbard/qualification-policy.json), and [svalbard-pre-540-material.geojson](../../data/corrections/svalbard/svalbard-pre-540-material.geojson).
