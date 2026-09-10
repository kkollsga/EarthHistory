# Plate-reconstruction foundation for the palaeomap

Research status: accepted-source recommendation with implemented static controls, 2026-09-09. This record compares static, offline plate-model inputs for EarthHistory and records the bounded conversion now used by the application. It does not authorize publishing the research downloads. The machine-readable acquisition ledger is [`palaeomap-plate-foundation-inventory.json`](./palaeomap-plate-foundation-inventory.json).

## Recommendation

Adopt **Cao et al. 2024, model release 2.4** as the target long-range surface and palaeoclimate plate foundation. EarthHistory's offline conversion gates now cover the displayed 0–540 Ma range with target-native static continents, ocean topologies, boundary geometry, rotations, and model-derived lifecycle controls. The source-qualified PALEOMAP-to-Cao continental crosswalk remains partial and masks unsupported material. Cao 2.4 is a single palaeomagnetic-reference-frame model from 0 to 1800 Ma and includes rotations, static polygons, coastlines, continental polygons, plate-boundary topologies, ridges, transforms, and polarity-bearing subduction zones. Pin the dataset DOI `10.5281/zenodo.13628813`, rather than a mutable GPlates Web Service default.

Use **Müller et al. 2025, model release 1.3** as a separately identified mantle-frame alternative for mantle, plume, net-rotation, and trench-motion questions. The release says its relative plate motions are identical to Cao et al. 2024, apart from small adjustments to subduction topologies, so this is the most defensible two-frame model family. It must not silently supply palaeolatitudes to insolation or climate calculations.

Retain the existing PALEOMAP relief and country tracking in their native PALEOMAP frame as one coherent view. The exact PALEOMAP v3 plate bundle used by `scripts/prepare-data-countries.py` contains rotations and partition polygons but no mid-ocean ridges, transforms, subduction zones, or resolved topologies. Therefore a “native PALEOMAP real-boundary overlay” is not available from that bundle. Do not drape Cao or Müller boundary coordinates over PALEOMAP terrain at the same nominal age.

The implemented route to one improved map is a model-coherent Cao view: reconstruct Cao static child-continent material, transfer PALEOMAP height only through a validated material crosswalk, and synthesize the ocean from Cao-native topology and lifecycle controls. Unsupported continental correspondence remains visibly unavailable rather than being copied by screen coordinate. Ancient ocean pixels are never cross-model warped because destroyed oceanic crust has no surviving material correspondence and each model constructs synthetic ocean plates differently.

## Why the catalog alone is insufficient

The [GPlates Web Service model catalog](https://gwsdoc.gplates.org/models/) is a useful index, but its default model can change and it does not itself establish every archive's redistribution terms or the semantics retained by a converted line file. This study pinned model archives, read their included descriptions, inspected GPML feature types and validity intervals, and kept software and data licensing separate.

The main candidates are:

| Model | Exact release | Range | Absolute frame | Main use | Decision |
|---|---:|---:|---|---|---|
| Cao et al. 2024 | 2.4, Zenodo 13628813 | 0–1800 Ma | palaeomagnetic | Long-range surface, palaeolatitude, topology | Recommended target |
| Müller et al. 2025 | 1.3, Zenodo 17142287 | 0–1800 Ma | mantle | Mantle/plume and absolute-motion alternative; matched derived grids | Recommended alternate |
| Merdith et al. 2021 | 1.2.4, Zenodo 13635864 | 0–1000 Ma | palaeomagnetic | Published lineage and comparison | Comparison only |
| Müller et al. 2022 | 1.2.4, Zenodo 13636799 | 0–1000 Ma | mantle | Reference-frame method and comparison | Comparison only |
| Zahirovic et al. 2022 | catalog release, not acquired here | 0–410 Ma | model-specific mantle/plate compilation | Younger-Earth specialist comparison | Comparison only |
| Müller et al. 2019 | v3 catalog entry, not acquired here | 0–250 Ma | mantle | Phanerozoic specialist comparison | Comparison only |
| PALEOMAP global model | v3 app-pinned bundle; current v19o also checked | 0–1100 Ma | PALEOMAP model frame | Existing authored relief and country tracking | Retain only in native view |

The [Cao et al. model paper](https://doi.org/10.1016/j.gsf.2024.101922) describes the reconstruction as a full-plate working hypothesis that combines and refines the Merdith et al. model and older continental-drift models. The [Müller et al. 2022 paper](https://doi.org/10.5194/se-13-1127-2022) explains the complementary palaeomagnetic and mantle frames. These are reconstructions with increasing deep-time uncertainty, rather than observations at every rendered age.

## Actual contents and topology semantics

The Cao 2.4 archive separates four boundary eras: 1800–1000, 1000–410, 410–250, and 250–0 Ma. Direct XML inspection of those canonical GPML collections found:

| Feature type | Count |
|---|---:|
| Mid-ocean ridge | 1,256 |
| Subduction zone | 953 |
| Transform | 925 |
| Topological closed plate boundary | 4,079 |
| Orogenic belt | 12 |

Of the 953 canonical subduction-zone features, 952 carry `Left` or `Right` polarity and one lacks a polarity value. The full archive contains a small number of additional copies in topology-building-block files, so raw recursive tag counts are higher; the table avoids treating those as new canonical features.

Validity probes at 0, 250, 410, 500, 1000, 1500, and 1800 Ma found active ridges, subduction zones, transforms, and closed-boundary features in the applicable era collections. Counts at exact era boundaries can overlap adjacent collections and are not resolved segment lengths. A production converter must resolve the topology with the pinned rotation files and define a half-open transition convention; tag counting is only an acquisition check.

The [GPlates Geological Information Model](https://www.gplates.org/docs/gpgim/) defines subduction polarity relative to the direction of the stored line: `Left` or `Right` identifies the overriding-plate side, with the subducting side opposite. Any offline GeoJSON or binary export must preserve both the line direction and polarity property. Reversing coordinates without swapping polarity produces a scientifically wrong trench symbol. GPML remains the archival source even if the browser consumes a compact derived representation.

The archive also includes coastlines, continental polygons, static polygons, continent-ocean boundaries, and rotation files. These related layers and their plate identifiers form one reconstruction system. A coastline from one model and a boundary from another are not interchangeable merely because both are expressed as longitude and latitude.

The app-pinned PALEOMAP v3 archive (`10.5281/zenodo.7994000`, file digest recorded in the inventory) contains only `PALEOMAP_PlateModel.rot` and `PALEOMAP_PlatePolygons.gpml`. Its GPML has 469 unclassified features and two continental-boundary features, with no ridge, subduction, transform, or topological-plate-boundary features. The GWS catalog likewise exposes PALEOMAP coastlines and static polygons, but no topology layer. The newer PALEOMAP v19o archive has the same broad two-file shape and does not close this gap.

The same-family link to the current terrain is explicit rather than inferred from the archive name. The PaleoDEM v2 source report says its `Plate Tectonic Model Age` uses **PALEOMAP Global Plate Model v2d3** and directs GPlates basemaps to use that age. The app-pinned rotation file identifies itself as `PALEOMAP Plate Model m15g60_v2d3` and says it is for `ContOCeanPolyv10u_v2d3`. This supports rigid motion of the source polygons over PaleoDEM v2. It does not prove that every raster cell has a polygon correspondence.

An offline pyGPlates 1.0.0 probe resolves Cao 2.4's closed boundaries at all 109 EarthHistory source ages from 0 through 540 Ma. The union covers at least 99.9614% of the 2,592 five-degree global cell-centre probes. However, the polygons are not a unique global partition: their summed spherical area ranges from 0.999675 to 1.018305 Earth surfaces, and as much as 2.1991% of probe points lie in more than one resolved polygon. Concrete overlaps include duplicate Hikurangi polygons at 100 Ma, South America and Caribbean polygons at 126–135 Ma, and South China and Gondwana at 475 Ma. Those cells require a source-justified priority or an ambiguity mask.

The Cao boundary geometry is compact after resolution. Across the 109 five-million-year ages, resolved shared boundary sections contain 95,169 points before browser quantisation: 33,697 ridge points and 34,525 subduction points, with at most 2,758 total points at one age. The closed polygons have at most 5,204 exterior vertices at one age. The target-native topology and boundary assets therefore fit the static budget with compact encoding. Lineage and ambiguity remain scientific limits; the implementation preserves unsupported links and ambiguous ownership instead of choosing by proximity.

Direct fractional-age topology resolution also exposes a source convention that a converter must handle explicitly. Many Cao topology snapshots use validity intervals such as 251.0–250.1 Ma, leaving a 0.1 Myr gap before the next integer slot. For example, direct resolution at 250.001 and 410.001 Ma returns no closed polygons, while adjacent authored slots resolve globally. EarthHistory resolves the named five-million-year topology slots, binds lifecycle values to their exact topology-slot identities, and uses only validated boundary links between slots; unsupported crossovers remain discrete. It never presents direct arbitrary-age `resolve_topologies` output as complete. The full closure probe is retained at `palaeomap-study/verification/cao2024-topology-closure-5ma.json` (SHA-256 `e0bdff358b29c47678ab59b0ddd0751af81f655b2b7ed8aa451cd00c1a856dd3`).

## Time availability: evaluable ages versus native slices

Rotation files contain finite Euler rotations at sampled ages. GPlates can interpolate those rotations and resolve valid topology features at arbitrary ages within a connected plate circuit. That supports more UI ages, but it does not create new geological observations between control ages. Topology membership and feature validity can change at declared time boundaries; a renderer must not interpolate across a birth, death, split, or merge as though the geometry were continuously observed.

The Cao archive supplies topology and rotation inputs rather than one baked map per UI age. EarthHistory's offline pipeline evaluates the 109 five-million-year display ages from 0 through 540 Ma and records for each output:

- model DOI and release;
- absolute frame and anchor plate;
- rotation and topology filenames;
- evaluation age and feature validity interval;
- plate IDs and reconstruction method;
- whether geometry is source data, resolved model output, interpolation, or visual synthesis.

The Müller 2025 associated server directory lists **1,801 seafloor-age grids and 1,801 spreading-rate grids at integer ages from 0 through 1800 Ma, with no filename gaps**. These are genuinely discrete native raster files. Five control ages were acquired and inspected: 0, 250, 410, 1000, and 1800 Ma. Each grid is 3601 × 1801 on a global longitude/latitude grid with a NaN mask. The NetCDF `z` variables do not declare units. The 1800 Ma spreading-rate sample is uniformly 100 over all non-NaN cells, which may be a default or sentinel. Until the producer documents units, generation method, license, and that constant field, these WebDAV files remain quarantined research evidence and must not enter a published asset.

The Merdith 1.2.4 README adds a specific resolution limit: its Pacific absolute motion from 250 to 83 Ma was sampled at 5 Myr and should not be used for shorter-timescale absolute-motion or hotspot questions. Increasing browser timesteps cannot overcome that input resolution.

## Material coordinates and continuous-time contract

The persistent identity of a terrain sample must be a material or fragment identifier, rather than the longitude/latitude of one rendered age. Store one documented reference position and reference age for that identifier, together with model DOI/version, frame, anchor plate, reconstruction plate or topology lineage, valid interval, and parent/child lineage across a split. The displayed longitude and latitude are then age-dependent results. In a rigid interval they are obtained by applying the model's stage rotation from the reference age to the requested age. GPlates composes relative rotations through the anchored plate hierarchy; its finite-rotation interpolation uses spherical linear interpolation (SLERP). Therefore the converter must evaluate the pinned rotation model, rather than linearly interpolating longitude/latitude or independently blending already-composed snapshot quaternions across a plate-circuit change. See the official [pyGPlates rotation primer](https://www.gplates.org/docs/pygplates/pygplates_primer.html) and [`FiniteRotation.interpolate`](https://www.gplates.org/docs/pygplates/generated/pygplates.FiniteRotation.html).

This is consistent with GPlates' source model rather than a new coordinate convention. The GPlates architecture paper explains that regular vector geometries are stored in present-day coordinates and reconstructed by their properties and plate IDs; a feature digitised at a past age is reverse reconstructed so that it returns to that authored position at its digitisation age. The same paper describes topological reconstruction as an incremental point process in which a point is assigned to the resolved rigid plate or deforming network containing it at each step. Plates may split or merge, deforming networks may appear or disappear, and the point may transfer between them. The deforming-network paper describes these tracked samples as Lagrangian points whose finite strain and crustal state evolve with the material ([Müller et al. 2018](https://doi.org/10.1029/2018GC007584); [Gurnis et al. 2018](https://doi.org/10.1016/j.cageo.2018.04.007)).

For each material sample, keep vertical state separate from horizontal reconstruction. The minimum durable record contract is:

- `materialId` and, where needed, `fragmentId` plus parent/child lineage;
- reference position and `referenceAgeMa`;
- model release, frame, anchor plate, plate/topology lineage, and material valid interval;
- height knots containing age, bed elevation, vertical datum or sea-level convention, source, uncertainty, and epistemic status;
- lifecycle events such as creation, split, merge, deformation entry/exit, ridge birth, and subduction loss.

If two elevation knots describe the same active material sample in a common vertical datum, a documented linear first hypothesis is defensible: a sample at -2,000 m at one knot and 0 m at the next is -1,000 m halfway between them. Its reconstructed horizontal position moves at the same time, so a mountain can travel with its plate while its height grows or erodes. This interpolation is synthesis between evidence ages, not an additional observation. A higher-order curve must prevent overshoot and state its scientific basis.

Do not apply that rule directly to two raster pixels. Regular latitude/longitude grids are Eulerian snapshots: the same pixel index at adjacent ages generally does not identify the same rock. Neighboring source surfaces must first be sampled or remeshed onto verified common material identifiers. Nor should elevations relative to two different contemporaneous sea levels be blended as if they shared a physical zero. Where supported, store bed elevation in a common datum and sea-surface height separately, then derive flooding. Where a source supplies only elevation relative to its own interpreted sea level, preserve that convention and label the blend as relative-elevation interpolation.

Rigid rotation is insufficient inside a deforming topology. The official [pyGPlates topological-reconstruction documentation](https://www.gplates.org/docs/pygplates/pygplates_primer.html#topologically-reconstruct-geometries) states that points are advanced incrementally through resolved plates and networks; network points follow the triangulated deformation field. Snapshot spacing affects accuracy, and a request between stored topology slots is reconstructed incrementally from the nearer slot on the initial-time side. Point activity is discrete: oceanic points can deactivate at subduction when moving forward in time or at ridge creation when moving backward. EarthHistory must export the resulting age-dependent point position, active state, and topology/lineage evidence; it must not interpolate polygon vertex arrays across a birth, death, split, merge, or network transition.

Every rendered sample should expose one of three time statuses:

1. **Native source knot** — an actual source raster/geometry/control age.
2. **Kinematically evaluated** — a position produced at the requested age by the pinned rotation/topology model, including its topology step.
3. **Vertically interpolated synthesis** — a height or material property between named bracketing source knots, with the interpolation rule and both source ages recorded.

Acceptance requires exact endpoint recovery, stable identity through ordinary rigid motion, dateline and pole continuity, topology-step convergence tests, explicit point activation/deactivation, and a moving-mountain case whose horizontal motion and vertical growth are independently checked. Any interval lacking common material registration, compatible datum semantics, or valid topology lineage stays discrete or crossfades as a visual transition; it does not qualify as continuous geological reconstruction.

EarthHistory now has a bounded same-family rigid-motion control asset at `public/data/paleomap-motion-v1.json`. It retains 503 polygon fragments, 26,374 quantised reference-coordinate pairs, 317 moving/fixed rotation sequences, fragment validity, eight evidence-site plate IDs, model/frame/anchor metadata, and explicit unknown handling. It is 678,894 bytes with SHA-256 `a4dee1ba1d9fe290c5aba98cb882d16e4663841957f0fe2b5ec1deee19e55075`. A deterministic 5° pyGPlates probe measures assigned material coverage of 100% at 0 Ma, 44.87% at 5 Ma, 44.37% at 100 Ma, 33.45% at 250 Ma, 35.61% at 400 Ma, and 30.94% at 540 Ma. Unsupported cells remain unknown.

The TypeScript evaluator composes the age-specific plate hierarchy in standard GPlates axes (`+X` at 0°E, `+Y` at 90°E, `+Z` north), with an explicit application coordinate adapter. Its fractional-age rotation cache is capped at four ages, decoded rings are reused per catalog, and requested-age bounding caps reject most polygon candidates before inverse rotation. A pyGPlates oracle contains 406 rotation probes at source knots, fractional ages, both sides of circuit boundaries, and exact circuit endpoints, plus 432 spatial ownership probes. It exposed a real endpoint rule: plate 109 switches circuit at exactly 245 Ma, while plate 101 retains its younger circuit at exactly 306 Ma. The generator therefore records pyGPlates-derived endpoint inclusion per source sequence rather than guessing a global precedence rule. The oracle fixture is 82,254 bytes, SHA-256 `491bc5325fa912db81aab0069fe0ac6c5b059722e91459ca601f158a4d41f3aa`.

A local Apple M4/Node 22.16 algorithm probe measured a 22.174 ms median for 6,500 inverse material queries over the 100–105 Ma interval after warm-up. This passes the stated 100 ms interaction-response stop bound but exceeds the application's 20 ms steady-frame budget. It is not production renderer evidence. It served as a pre-integration stop signal; production readiness is assessed separately with the staged browser renderer.

## Implemented Cao target-native controls

The study produced a separate Cao 2.4 target-native foundation rather than copying Cao coordinates onto the PALEOMAP surface. Its compact motion asset covers the 109 five-million-year display ages from 0 through 540 Ma and retains exact resolved topology rings, strict finite rotations, directional boundary segments, ridge adjacency, trench overriding/subducting IDs, and polarity. A 2° ownership grid accelerates candidate lookup; packed spherical rings remain the ownership authority. Sparse conservative boundary-cell records mark every cell centre within 2.25° of a resolved-ring edge sampled at no more than 0.5° spacing. Pole-adjacent cells and source-ambiguous cells retain full exact scans.

Continental material uses `shapes_continents.gpmlz` source fragments, not instantaneous topology IDs. The derived static partition contains 869 polygon parts and 74,896 coordinate pairs, with stable per-geometry keys for the 33 source feature IDs that have multiple parts. It stores source-reference geometry at 0 Ma in standard GPlates axes and applies each child plate's strict finite rotation. The overlap priority matches `SortPartitioningPlates.by_partition_type_then_plate_area`; missing rotation circuits remain unsupported rather than silently becoming identity. A 401-point independent oracle reproduces pyGPlates ownership. One decisive control reconstructs India as child fragment/plate 501 at 250 Ma inside the instantaneous Gondwana topology container 701. Therefore equality between a continental child plate ID and its enclosing topology ID is not a valid lineage test.

Boundary motion has 7,027 accepted links across 106 of 108 adjacent display-age brackets: 1,646 mid-ocean-ridge, 2,689 subduction, and 1,949 transform links, plus smaller typed classes. A link requires a unique source feature, identical directed adjacency and polarity fields, validity across the bracket, bounded length change, consistent direction, and a bounded normalized-arclength curve displacement. A reversed-short-segment regression rejects a pair when reversed arclength correspondence is better. Exact ages use the packed resolved source geometry. Between them the renderer may resample both curves by spherical arclength and geodesically interpolate, labeled as interpolation. Splits, merges, duplicate matches, reversals, excessive shape changes, and the 250–255 and 410–415 Ma source-file crossovers are unsupported and must fade or remain discrete.

Ocean material lifecycle was evaluated with pyGPlates 1.0.0 `TopologicalModel.reconstruct_geometry` and its default point-deactivation rule on the Cao topology and rotation files. The 2° control contains 1,110,007 uniquely owned ocean samples at the 109 display ages and traces them within the source model's 0–1000 Ma range. It retains 768,984 backward-deactivation bounds attributed within 300 km of a source `MidOceanRidge` and 546,549 forward-loss bounds similarly attributed to a source `SubductionZone`. It marks 312,701 birth and 360,691 loss deactivations as unattributed and therefore unavailable; 28,322 births are censored at 1000 Ma and 202,767 losses at the present model limit. Each cell carries its source exact topology slot, and the sampler rejects a nearest-cell value unless that slot matches exact ownership. Maximum nearest-cell registration uncertainty is 158 km and time bounds are five-million-year intervals.

These lifecycle values are boundary-attributed model intervals, not observed seafloor ages. The default pyGPlates deactivation rule detects a sufficiently large velocity transition near a topology boundary; proximity to a typed ridge or trench is an additional EarthHistory inference. It does not prove a measured crystallization or destruction age. A young Mid-Atlantic control deactivates backward within the 0–5 Ma bracket beside the source ridge, while a 540 Ma control remains traceable to a ridge-attributed 580–585 Ma interval. Unattributed and wrong-topology samples stay unavailable. The quarantined Müller WebDAV raster values remain raw unitless samples and were not used as accepted ages.

The Cao continental runtime keeps four reconstructed-partition poses: the 0 Ma material reference, the requested age, and both native source endpoints. Three entries caused repeated candidate-cap reconstruction during fractional display because this query set contains four distinct ages. At 102.5 Ma the additional cached pose contains 753 cap centres, 18,072 bytes of numeric direction payload plus approximately 6,024 bytes of fragment references before engine-specific object overhead. A material-bound crosswalk helper also reuses the renderer's authoritative Cao fragment lookup and its paired target-lineage preparation. In an isolated Apple M4/Node 22.16 development-runner probe over 6,534 cube-root directions, the helper path fell from 211.7–215.7 ms to 120.1–120.6 ms at 102.5 Ma while returning the same 3,728 mapped endpoint results. This is algorithm evidence, not production render acceptance; the final staged browser measurement remains authoritative for frame readiness.

The same resolver now builds a lazy conservative 10° geographic candidate index for each cached pose. Bounding caps may add false-positive candidates, while exact spherical ring containment and the source partition order remain authoritative. Each of the 648 cells can hold `Uint16` fragment indices up to a 192 KiB numeric limit per age; an over-limit or explicitly disabled cell falls back to the complete exact scan. The four-age LRU therefore caps the numeric candidate payload at 768 KiB. Full-scan equivalence was checked at 0, 100, 102.5, 250, 400, and 540 Ma over all 648 cell centres plus dateline, pole, and pyGPlates oracle probes. A deliberate omission of India child plate 501 from its candidate cell made the equivalence check fail and was restored. In an isolated Apple M4/Node 22.16 helper probe over 6,534 directions, warmed indexed lookup measured 24.268–24.762 ms at 100 Ma and 21.692–24.472 ms at 102.5 Ma, compared with 46.340 and 43.823 ms for the full scan; index construction took 34.701 and 30.016 ms. These are development helper measurements, not production renderer or frame-readiness evidence.

Modern-country references retain their source linework and never bridge unsupported crosswalk gaps. The orbital view omits disconnected runs shorter than 60 km and the regional view uses 20 km; the 60 km filter retained 99.47–99.60% of source line length at the measured 100, 105, 250, and 540 Ma controls. Ribbons use subdued, terrain-lit material and sample the exact published triangle surface. Adaptive draping limits source-height error to at most half the displayed clearance after vertical exaggeration. A regression with a 100 m triangular ridge at 30× proves the midpoint is inserted before the line can pass through the rendered relief; existing recursion, vertex, and byte bounds still apply.

The broad Cretaceous white cap was not a PALEOMAP ice observation. It came from renormalising a weak authored ice-potential field into nearly opaque paint. The official Cao et al. (2017) categorical palaeogeography package has no dated permanent-ice polygon after its 81 Ma feature ends and before its 285.01 Ma feature begins. EarthHistory uses that interval only as a qualitative constraint against permanent-ice paint. It is not proof of an ice-free Earth, and no polygon from the package's Matthews-family reconstruction is transferred into the PALEOMAP or Cao 2024 frame. Sparse high-altitude snow remains an authored climate-potential inference. The weak stored potential is no longer divided by scenario intensity.

## Reference frames and palaeoclimate

The Müller 2022 frame study states that a mantle frame reconstructs plates relative to the convecting mantle and assumes the spin axis is stationary. It is intentionally agnostic about true polar wander (TPW). A palaeomagnetic frame contains the combined effect of plate motion and TPW and supplies the palaeolatitudes needed for palaeoclimate, although palaeomagnetism does not constrain absolute longitude because the magnetic field is rotationally symmetric about the spin axis.

Consequences for EarthHistory:

- Drive solar latitude, insolation bands, and palaeoclimate from Cao 2.4's palaeomagnetic frame.
- Label longitude uncertainty and any imposed longitudinal convention, especially in deep time.
- Expose Müller 2025 as a mantle-frame scenario for mantle-relative questions; do not interpret its latitude directly as climate latitude.
- Do not blend coordinates between frames inside one rendered state. If a comparison is shown, identify both scenarios explicitly.

This is why the mantle-frame release is not a drop-in upgrade for a climate globe even though it can improve mantle-relative kinematics.

## One-map conversion contract

A defensible cross-model migration operates on reconstructable material, not on screen pixels. For continental crust it needs source polygons, destination model static polygons, an explicit plate-ID mapping, both rotation circuits, feature valid times, and rules for splits, merges, holes, and antimeridian crossings. Control ages should test coast and craton registration before any authored height field is resampled.

The process cannot reconstruct destroyed ocean cells from the old painted map. For those cells, generate a new ocean surface within the selected model using its ocean topology and source-native lifecycle controls, or a separately licensed and documented model-matched seafloor-age grid. Preserve continental shelves and continental relief separately. Areas that cannot be mapped with adequate confidence should fade or receive a labeled synthesis rather than a false exact position.

The acceptance evidence for the current partial Cao view is:

1. stable source-feature, geometry-part, child-plate, and lifecycle identities for every retained material patch;
2. forward/back reconstruction checks across the displayed 0–540 Ma range and the source model's older lifecycle trace where valid;
3. topology-aware ocean and continent masks at every shipped age;
4. boundary/coast registration checks in the same frame;
5. explicit handling of unmapped material and destroyed oceans;
6. source and uncertainty metadata embedded with every derived asset.

Those checks now support a separately labeled Cao 2.4 view with partial source-qualified continental relief and target-native modeled oceans. They do not support a complete cross-model raster warp. The static-continent probe passed round-trip and ocean-exclusion rules, but its stable-interior crosswalk fraction fell below the prewritten 90% global threshold at 100, 250, and 400 Ma. Consequently the global-complete conversion gate remains stopped: supported material renders, unsupported material is masked, and the native PALEOMAP view remains available.

## Ocean relief recipe: implemented bounded synthesis

The [Stein and Stein 1992 GDH1 study](https://ntrs.nasa.gov/citations/19920074373) provides a global thermal age-depth relation for normal oceanic lithosphere. A possible first-order offline baseline, with age `t` in Ma and depth `d` in metres below sea level, is:

```text
t < 20:   d = 2600 + 365 sqrt(t)
t >= 20:  d = 5651 - 2473 exp(-0.0278 t)
```

EarthHistory now evaluates this formula only where the Cao model resolves oceanic crust and the topology-slot-bound lifecycle control supplies a ridge-attributed birth interval. The midpoint of that five-million-year model interval supplies a synthesized thermal age; it is not an observed seafloor age. Unknown, censored, unattributed, wrong-topology, and ambiguous samples do not enter GDH1. The relation estimates thermal basement depth. It does not by itself represent sediment loading, anomalous oceanic plateaus and large igneous provinces, seamounts, dynamic topography, sea-level change, trenches, or continental shelves. The [EarthByte palaeo-bathymetry method summary](https://www.earthbyte.org/Resources/agegrid2008.html) likewise treats plate-cooling depth as a baseline and adds major plateaus and sediment corrections.

The implemented bounded sequence therefore:

1. classify source-native ocean versus continental and shelf cells;
2. accepts only a Cao-native ridge-attributed lifecycle interval with matched topology identity;
3. applies the thermal relation only to resolved oceanic basement and labels it synthesis;
4. adds only bounded source-positioned ridge and subducting-side trench cues, labeled as display heuristics;
5. keep authored or separately inferred continental and shelf elevation outside the ocean-age formula;
6. tag every correction and gap-fill with its evidence class.

The sampled Müller 2025-family age grids remain outside this implementation because the files do not declare `z` units and their separate redistribution grant was not located. The spreading grids additionally contain the unexplained 1800 Ma constant field. EarthHistory does not publish or interpret those values as seafloor age.

## Trenches, arcs, and orogens

Subduction polarity supports directional trench symbology and identifies the overriding side on which an arc may occur. It does not establish trench depth, arc offset, arc height, mountain-belt width, crustal thickness, or erosion history. A plate boundary line is not a topographic amplitude field.

Cao 2.4's canonical boundary collections contain only 12 `OrogenicBelt` features, all in the 410–0 Ma files. That sparse feature class cannot drive global mountains or older orogens. Orogen relief needs separately cited palaeoelevation, crustal-thickness, tectonic-stage, and denudation constraints. Where those are absent, EarthHistory may show a subdued tectonic-setting cue labeled as inference, but it should not raise mountains mechanically along every convergent line.

## Licensing and redistribution

Licences apply to distinct things:

- The [GPlates source repository](https://github.com/GPlates/GPlates) identifies the desktop software as GNU GPL version 2; its current `COPYING` text is GPL-2.0-only. The inspected v2.5 tag resolves to source commit `f31ac9455c4198d2110e172f7510da512646718a`.
- The four acquired Zenodo model archives declare **Creative Commons Attribution 4.0** on their records. Required attribution and source/version metadata must accompany any redistributed original or derived data.
- The Cao journal article is published under CC BY-NC-ND 4.0, separately from the CC BY 4.0 model-data archive. Do not infer the article licence from the data record or vice versa.
- The PALEOMAP v3 Zenodo record declares CC BY 4.0.
- The sampled `repo.gplates.org` WebDAV grid directories did not present file-level licence or unit metadata in the acquired index or NetCDF attributes. A related model record is not sufficient evidence of a redistribution grant for a separately hosted file. Those samples are quarantined outside the application and marked `licenseStatus: unresolved` in the inventory.

Using GPL software offline to generate an export does not make the input scientific data GPL. Redistribution of GPlates itself or modified GPlates source must satisfy GPL-2.0-only, while the data and derived scientific assets retain their own source licence and attribution obligations.

## Static integration recommendation

No live runtime API is needed. Run a pinned, offline GPlates/pyGPlates conversion job against the selected source archive, resolve only the product ages, retain the GPML source and conversion manifest, and ship compact static geometry. The browser format must carry boundary type, subduction polarity, plate IDs, valid ages, source release, frame, and epistemic status.

The static integration now follows these boundaries:

- **PALEOMAP view:** terrain and country overlays stay internally coherent; do not advertise real PALEOMAP ridges because the input lacks them.
- **Cao science view:** implemented Cao 2.4 boundaries, static continents, rotations, topology, and lifecycle controls remain one palaeomagnetic-frame model.
- **Partial unified terrain:** PALEOMAP height enters the Cao view only through the source-qualified continental material crosswalk; unsupported material stays unavailable and target-native Cao ocean synthesis never uses PALEOMAP ocean pixels.
- **Mantle scenario:** preprocess Müller 2025 1.3 separately and label it as a mantle frame.

## Known gaps and stop conditions

- No verified PALEOMAP-native ridge/subduction topology was found in the app-pinned v3 bundle, current v19o bundle, or GWS PALEOMAP layer listing.
- The Müller 2025 WebDAV grid licence, `z` units, processing provenance, and 1800 Ma spreading-rate constant remain unresolved.
- Pinned pyGPlates resolution shows nearly global Cao closure at the shipped 5 Ma ages, but also source polygon overlaps up to 2.1991%, small sampled gaps, and 0.1 Ma validity gaps at arbitrary fractional ages. It is not yet a unique continuous material partition.
- Cao's deep-time oceans are modeled and increasingly uncertain. A dense output age series must remain labeled as evaluated model output/interpolation.
- Longitude in the palaeomagnetic frame requires a convention and remains weakly constrained in deep time.
- No global, Cao/Müller-target-model-matched, licensed palaeoelevation/orogen-height dataset was accepted in this study. The separately framed PALEOMAP palaeoDEMs remain an accepted candidate only for their native PALEOMAP view.
- Any additional model conversion must retain plate-ID correspondence, material validity, control-age registration evidence, and an explicit unsupported result.

## Primary and official sources

- GPlates Web Service, [available reconstruction models](https://gwsdoc.gplates.org/models/), accessed 2026-09-09.
- GPlates, [software and source](https://www.gplates.org/download.html), and [GPlates GitHub repository](https://github.com/GPlates/GPlates), accessed 2026-09-09.
- GPlates, [Geological Information Model documentation](https://www.gplates.org/docs/gpgim/), accessed 2026-09-09.
- pyGPlates, [plate-reconstruction hierarchy and topological reconstruction primer](https://www.gplates.org/docs/pygplates/pygplates_primer.html), and [`FiniteRotation` interpolation reference](https://www.gplates.org/docs/pygplates/generated/pygplates.FiniteRotation.html), accessed 2026-09-09.
- Müller et al. (2018), [GPlates: Building a Virtual Earth Through Deep Time](https://doi.org/10.1029/2018GC007584), *Geochemistry, Geophysics, Geosystems*.
- Gurnis et al. (2018), [Global tectonic reconstructions with continuously deforming and evolving rigid plates](https://doi.org/10.1016/j.cageo.2018.04.007), *Computers & Geosciences*.
- Cao et al. (2024), [Earth’s tectonic and plate boundary evolution over 1.8 billion years](https://doi.org/10.1016/j.gsf.2024.101922), *Geoscience Frontiers*.
- Cao et al., [model release 2.4](https://doi.org/10.5281/zenodo.13628813), Zenodo.
- Müller et al. (2022), [A tectonic-rules-based mantle reference frame since 1 billion years ago](https://doi.org/10.5194/se-13-1127-2022), *Solid Earth*.
- Müller et al., [model release 1.2.4](https://doi.org/10.5281/zenodo.13636799), Zenodo.
- Merdith et al. (2021), [Extending full-plate tectonic models into deep time](https://doi.org/10.1016/j.earscirev.2020.103477), *Earth-Science Reviews*.
- Merdith et al., [model release 1.2.4](https://doi.org/10.5281/zenodo.13635864), Zenodo.
- Müller et al., [mantle-frame model release 1.3](https://doi.org/10.5281/zenodo.17142287), Zenodo.
- PALEOMAP Project, [global plate model v3 record](https://doi.org/10.5281/zenodo.7994000), Zenodo.
- Stein and Stein (1992), [A model for the global variation in oceanic depth and heat flow with lithospheric age](https://doi.org/10.1038/359123a0), *Nature*.
- Cao et al. (2017), [Improving global paleogeography since the late Paleozoic using paleobiology](https://doi.org/10.5194/bg-14-5425-2017), *Biogeosciences*; only the dated categorical ice chronology is used as a qualitative constraint.

## Acquisition storage and cleanup

The reusable research store is `/Volumes/EksternalHome/Koding/HTML/EarthHistory-data/palaeomap-study/plates/`. It occupies 1,231,428 KiB by `du -sk` on 2026-09-09, below its 1.4 GiB allocation within the study's shared 4 GiB raw-store limit. The project research lead owns cleanup after acceptance. Verified archives and the small inspection manifests are reusable; `extracted/` is regenerable from the verified archives and is the first cleanup target. Nothing in the application or tracked documentation depends on that external directory being present.
