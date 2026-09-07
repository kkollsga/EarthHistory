# Basins, rifts, volcanic margins, and petroleum systems

Research and product discussion, 2026-09-07. No application or basin simulation has been built. User emphasis: basin development, infill (inferred from “infoøl”), maturation, petroleum basins, volcanic margins, and rifts; orbital globe with regional zoom.

## Product implication

Treat a basin as an evolving geological object, not a static polygon or a modern petroleum field. Give each basin linked geographic footprints, tectonic episodes, stratigraphic units, local sections/wells, thermal-history interpretations, and evidence. The global reconstruction establishes context; regional studies establish subsurface detail.

Suggested interaction: select a basin on the globe, scrub geological time, and see a synchronized regional map, cross-section, stratigraphic column, burial/temperature curves, and an events chart. Labels should explain whether a section is measured, interpreted from seismic/wells, restored, or schematic. A schematic section must not inherit the apparent precision of nearby well measurements.

## Foundational science and usable resources

| Source | Verified content | Use in app | Limits / rights |
| --- | --- | --- | --- |
| McKenzie (1978), *Some remarks on the development of sedimentary basins*, EPSL 40, 25–32 | Stretching/thinning followed by conductive cooling and subsidence | Explain syn-rift vs post-rift basin evolution | A simplifying model, not a universal restoration; paper reuse rights not established here. [Paper](https://www.zetaware.com/public/McKenzie_1978.pdf), [author bibliography](https://www.mckenziearchive.org/bibliography/) |
| Norwegian Offshore Directorate FactPages / DataService | Well information, lithostratigraphic tops, geographic data, and linked geochemical and other well reports | Modern observation anchors for selected basin histories | API metadata identifies NLOD 2.0 and EPSG:4230. Third-party reports/images/logs may have separate rights. [API metadata](https://factmaps.sodir.no/api/rest/services/DataService/Data/FeatureServer/info/iteminfo), [content terms](https://factpages.sodir.no/), [well reports](https://factpages.sodir.no/en/wellbore/TableView/With/Documents) |
| NOD table-to-service mapping | Lithostratigraphy table `strat_litho_wellbore` at layer 2101; wellbore at 5000 | Candidate structured imports, joined by documented identifiers | Mapping verified; layer 2101 metadata and a small sample query also succeeded on 2026-09-07. [Mapping](https://www.sodir.no/4adf82/globalassets/1-sodir/om-oss/informasjonstjenester/karttjenester/factpages_dataservice.pdf) |
| Gautier (2005), USGS Bulletin 2204-C | North Sea Graben petroleum-system synthesis linking extension, source deposition, reservoirs, seals, generation, and traps | A regional narrative with distinct pre-, syn-, and post-rift elements | A 2005 synthesis, not current resource estimates or a high-resolution maturity grid. [Report record](https://www.usgs.gov/publications/kimmeridgian-shales-total-petroleum-system-north-sea-graben-province) |
| IODP Expedition 396 proceedings | Mid-Norwegian margin drilling, site reports, stratigraphy, volcanism, geochemistry, and links to measurements | Research-site POIs and evidence for volcanic-margin sections | Check each chapter/figure attribution; IODP publication policies use CC BY and identify third-party exceptions. [Expedition summary](https://publications.iodp.org/proceedings/396/101/396_101.html), [policies](https://publications.iodp.org/policies.html) |
| Tegner et al. (2026), *Scientific Data* | Whole-rock and portable XRF data for magmatic rocks drilled on the mid-Norwegian margin | Geochemical evidence popups and magmatic units | Spreadsheet datasets, not a global volcanic geometry model. [Paper](https://www.nature.com/articles/s41597-026-07073-x) |
| GFZ/GEOROC expert dataset accompanying Tegner et al. | Compilation of drilled magmatic-rock compositions; repository explicitly lists CC BY 4.0 | Versioned sample-level references | Data repository confirms rights; actual workbook parsing and coordinate inspection remain to do. [Dataset](https://dataservices.gfz-potsdam.de/digis/showshort.php?id=c928cc12-c45c-11f0-914a-f12b0080820d) |
| PyBasin, Luijendijk and contributors | Burial/exhumation, compaction, thermal modelling, calibration against temperatures, reflectance and thermochronology | Candidate offline generator of selected local burial and thermal histories | LGPL-3.0 code; assess input data rights separately. Not established here as a complete hydrocarbon generation/migration simulator. [Repository](https://github.com/ElcoLuijendijk/pybasin), [paper DOI](https://doi.org/10.1029/2010JB008071) |

Direct dataset identifiers from the 2026 data paper: new whole-rock/pXRF measurements at [10.5880/digis.2025.011](https://doi.org/10.5880/digis.2025.011); combined expert dataset at [10.5880/digis.e.2025.005](https://doi.org/10.5880/digis.e.2025.005). The paper identifies Excel downloads. Availability of a publication is not proof that every underlying seismic survey is redistributable.

## Evolution to represent

Use separate tracks for extension/faulting, subsidence/accommodation, deposition/erosion, magmatism, and petroleum-system elements. They need not advance together. Store units and evidence for each quantity and choose temporal resolution per process.

For a selected stratigraphic unit, distinguish:

- Deposition age and environment, lithology, organic content/type where measured or interpreted.
- Burial depth through time, decompaction assumptions, hiatuses and removed section.
- Temperature through time, heat-flow history, thermal properties, and intrusion events.
- Measured maturity proxies versus calculated maturity and the calibration supporting it.
- Generation, expulsion, migration, trapping, and preservation as separate interpreted processes.

A depth or present-day temperature colour alone should not be labelled hydrocarbon maturity. The modelling workflow must account for time-temperature history and organic-matter characteristics. PyBasin is a candidate for the burial/thermal portion; importing published calibrated results may be preferable for the first case study. Adopt any additional kinetic model only after reviewing its original formulation, applicability, implementation rights, and benchmark behaviour.

A basin polygon must not receive a single “maturity” value unless the visualization explicitly declares the source interval, depth/location, age, model, and aggregation. Local kitchens, uplifted margins, and intrusion aureoles can differ. Maturity estimates also do not establish recoverable resources.

## Volcanic margins

Represent mapped lava sequences, seaward-dipping reflector packages, sill complexes, vents, and inferred deeper magmatic additions with distinct observation/interpretation labels. The IODP 396 proceedings provide a route to regional structural and drilling literature, including Gernigon et al. (2021), *A digital compilation of structural and magmatic elements of the mid-Norwegian continental margin*, [DOI 10.17850/njg101-3-2](https://doi.org/10.17850/njg101-3-2). The parallel tectonics review resolved and inspected its [55.6 MB GIS supplement](https://njg.geologi.no/images/phocadownload/MNCM_version1.0Sept2021.zip): Shapefiles and a QGIS project at an intended 1:1,000,000 scale. No standard license grant was found in the archive; “open-source” purpose wording does not establish redistribution rights. See the [tectonics memo](tectonics-and-paleogeography.md) for the verified inventory. It remains a candidate, not an approved dataset.

Svensen et al. (2004) proposed that sill intrusion into carbon-rich strata and hydrothermal venting contributed to early Eocene carbon release, using Norwegian Sea evidence. Show this as a published interpretation, with later evidence and alternatives rather than a single settled causal story. [Original paper](https://doi.org/10.1038/nature02566), [abstract](https://pubmed.ncbi.nlm.nih.gov/15175747/).

Berndt et al. (2023), *Shallow-water hydrothermal venting linked to the Palaeocene–Eocene Thermal Maximum*, supplies a newer evidence route. Its data-availability section explicitly excludes the industry AMN17 3D seismic volume from the freely available IODP data. Therefore a paper figure cannot be treated as permission to ship that seismic volume. [Paper](https://www.nature.com/articles/s41561-023-01246-8).

For thermal visualizations near sills, a basin-scale annual or million-year snapshot policy may miss the relevant short heating pulse. Keep event-scale model outputs distinct from the globe's broad geological time sampling. Do not portray every rift as a magma-rich margin or every magmatic margin as equivalent to the Norwegian example.

## Candidate first regional studies

| Region | What it could teach | Evidence needed before implementation |
| --- | --- | --- |
| Viking or Central Graben | Failed rifting, source deposition, burial, reservoirs/seals and petroleum-system timing | Choose sub-basin and a documented well/section; match stratigraphy, temperatures, maturity measurements, and a published thermal history |
| Vøring / Møre and conjugate Northeast Atlantic margins | Rift-to-breakup development, volcanic sequences, sill intrusion and thermal overprinting | Verify structural-map assets and regional restoration; use IODP observations; find a licensed, calibrated basin section |
| Nordkapp Basin | A later comparative study of salt tectonics and thermal history | Review the original model/data in [the 2019 study](https://www.mdpi.com/2076-3263/9/7/316) before adopting any result; detailed methods not reviewed in this pass |

Recommendation: use one North Sea petroleum-system section and one Norwegian volcanic-margin section as complementary demonstrators after user discussion. Maintain the whole-Earth/eon narrative; regional depth is an additional level of evidence, not a claim of basin-scale coverage for all Earth history.

## Proposed data contract and next validation

Separate `Basin`, `BasinEpisode`, `StratigraphicUnit`, `Observation`, `CrossSection`, and `ThermalScenario`. Each should reference its spatial/temporal domain and source records. Observations need coordinates/CRS, depth datum, measured vs vertical depth, units, method, and sample/well identifiers. Models need parameter sets, boundary conditions, calibration targets/misfits, assumptions, and versioned outputs.

Before building: verify one NOD lithostratigraphy import, inspect one released maturity/temperature report, select a published local basin model, and establish rights for one geological section. Modern coordinates must be transformed from the source CRS before assigning reconstruction plate IDs. Recorded present-day formation tops are inputs for interpretation, not directly ancient surface heights.

### Small API feasibility check

Read-only requests on 2026-09-07 confirmed [layer 2101](https://factmaps.sodir.no/api/rest/services/DataService/Data/FeatureServer/2101?f=pjson) as `strat_litho_wellbore`, type Table, maximum record count 2000. Fields include wellbore ID/name, lithostratigraphic unit and parent IDs, unit name/level, and top/bottom depth. A bounded query for well `31/2-4` returned well ID 208 and, among its rows, NORDLAND GP from 361 to 724 m and HORDALAND GP from 724 to 815 m. This demonstrates access and a join key only, not a complete import or geological validation.

The sample mixes GROUP and FORMATION rows: preserve the hierarchy and avoid treating nested units as an additive stack. Depth aliases state metres but do not fully describe the datum; validate against well documentation before using the values in cross-sections or burial models. The API's available description is a placeholder, so the endpoint alone is insufficient metadata.
