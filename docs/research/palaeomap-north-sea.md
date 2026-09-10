# North Sea regional geological controls for palaeomaps

The NSTA Central North Sea/Moray Firth and Northern North Sea/East Shetland Platform packages are useful regional evidence for depositional environments and structural elements. They are not global plate models or time-restored elevation grids. Their strongest initial role in EarthHistory is an aerial regional evidence layer, alongside the global reconstruction and with its own spatial and age limitations.

## Acquired sources and rights

Both user-specified ArcGIS archives were downloaded on 9 September 2026, verified by SHA-256 and checked against every ZIP member CRC. The complete member inventories, publisher metadata, URLs, retrieval times and hashes are in [the acquisition inventory](palaeomap-north-sea-inventory.json). Files reside in the separate bounded scientific acquisition store, not in `public/data`.

| Package | Verified archive | Size | Interpretation of version/date |
| --- | --- | ---: | --- |
| Central North Sea and Moray Firth | `CNS_and_MF_ArcGIS.zip` | 262,063,445 bytes | Archive directory identifies `CNS_and_MF_ArcGIS_v1_1`; narrative describes the 2017/18 activity plan |
| Northern North Sea and East Shetland Platform | `NNS_ESP.zip` | 268,605,162 bytes | Narrative describes the 2018/19 activity plan; first Central/Moray delivery was July 2017 |

The CKAN pages' absent license field is incomplete metadata. Each archive's enclosed Word narrative explicitly grants the Open Government Licence, and the publisher's ArcGIS `licenseInfo` identifies OGL 3.0. Preserve NSTA/OGA and Lloyd's Register attribution, the license link, source dates and identification of changes. Do not imply endorsement or extend this grant to unreleased third-party input surveys. The catalog suffix `version5` and 2026 harvesting dates are not evidence of a fifth scientific map revision. [Central publisher record](https://www.arcgis.com/sharing/rest/content/items/ee72f31e42484d299402f97025dd77d8?f=pjson), [Northern publisher record](https://www.arcgis.com/sharing/rest/content/items/e9675a913daa4b4ba1b1269fa017bd8f?f=pjson), [OGL 3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

The publisher also supplies a 5,445,896-byte Northern/Shetland change-only archive, which was acquired and CRC/hash-verified. Its enclosed readme identifies changes to Zechstein facies and structural elements plus several reservoir classes, and says the full delivery already includes them. However, the readme leaves its effective date as a placeholder. Do not blindly apply this patch twice: compare actual feature classes during import and record which content is selected. [Change-only publisher record](https://www.arcgis.com/sharing/rest/content/items/279004aa9bd645259c0034d6ea1541b9?f=pjson).

## Actual archive contents

Central/Moray contains 99 PDFs, 20 TIFFs and 13 named file geodatabases; Northern/Shetland contains 33 PDFs, 19 TIFFs and 11 named geodatabases. Both contain depositional-facies, structural-element, fault, source-rock, reservoir, subcrop/supercrop and well collections, with layered explanatory maps and stratigraphic charts. Northern map titles distinguish Eocene and Paleocene formations, Jurassic subdivisions, Triassic, Permian, Carboniferous and Devonian intervals. Central/Moray includes Oligocene and similarly subdivided older intervals. These are geological interval interpretations, not a regularly sampled numeric palaeogeographic time series. [Central archive](https://datanstauthority.blob.core.windows.net/external/DataReleases/GeologicalMaps/CNS_and_MF_ArcGIS.zip), [Northern archive](https://datanstauthority.blob.core.windows.net/external/DataReleases/GeologicalMaps/NNS_ESP.zip).

The downloaded ZIPs total about 506 MiB. Full extraction would consume approximately 2.66 GiB in addition to the compressed sources: 1,502,221,971 bytes for Central/Moray and 1,355,595,993 bytes for Northern/Shetland. Preserve compressed packages and inspect selected geodatabases or map explanations. A bulk extraction is unnecessary for the first regional layer and exceeds this study's 0.8 GiB North Sea allocation.

Sampled raster and XML metadata identify ED50 / UTM zone 31N, with EPSG:23031 explicitly present in Northern metadata. This is a present-day projected coordinate system, not longitude/latitude in the globe's reconstruction frame. Some layer XML contains copied placeholder titles or a different raster's name. Therefore an importer must read each actual dataset's CRS and fields rather than infer them from a layer filename or one metadata sidecar. These observations come from the acquired archives; they are not claims that every feature class has been decoded or all coordinate transforms validated.

## Recommended application method

Start with a bounded North Sea demonstrator covering depositional-facies polygons and a few well-explained structural elements. Decode the underlying geodatabase with an offline GIS library and compare it with the corresponding layered map. Preserve original formation/stage labels and cited age definitions, rather than assigning an arbitrary midpoint and treating that as a measured instant. Read legends before mapping a named facies to terrestrial, coastal, shelf or deeper marine classes; those classes may constrain an environment without supplying water depth in metres.

Transform the verified source CRS to geographic coordinates using a documented datum operation appropriate to the region. Then attach features to reconstructable crustal fragments in the selected global model, recording model ID, plate ID, age validity and coordinate transform. A rigid plate transform can provide regional context; it cannot undo North Sea extension or restore a present-day subsurface footprint. A deforming reconstruction or published restoration is needed before claiming local palaeocoastline accuracy. Until then, label the layer as mapped depositional/structural interpretation placed in reconstructed regional context, with unsuitable features hidden at unsupported ages.

Do not add the supplied horizon-depth grids to globe surface displacement. A buried Jurassic horizon's present depth reflects subsequent burial, compaction, tectonics and erosion as well as its original depositional setting. It does not equal Jurassic water depth. Isochores represent thickness, and time grids may represent seismic travel time. None can be substituted for palaeoelevation simply by rescaling the numbers or changing their sign. Restoration/backstripping would be a separate scientific program and remains beyond the current aerial scope.

Keep the global and regional evidence separately selectable where they disagree. A coarse global shelf interpretation should not silently overwrite a sourced local facies polygon, nor should a local facies polygon become an exact global elevation constraint. The disagreement itself identifies a useful scientific inspection case.

## Proposed validation before runtime integration

1. Decode one Central/Moray and one Northern/Shetland facies layer; record feature count, fields, CRS, geometry validity, units, source map and license attribution. Compare a known point and polygon extent with the corresponding published map.
2. Test projected-coordinate conversion, longitude wrapping and plate assignment independently. Preserve unmappable fragments with an explicit unavailable status rather than placing them at default coordinates.
3. Validate interval overlap against the selected global timestep. A layer can be relevant to several available surface slices without creating new independent observations at each slice.
4. Demonstrate that missing CRS, use of a horizon-depth grid as elevation, unsupported plate ancestry and unknown facies codes fail validation. Restore deliberate mutations after observing each rejection.
5. Export only bounded, simplified regional controls as static assets. Fetch them on regional demand, cancel stale age/focus requests, and evict them under the shared runtime budget.

This establishes a testable path to a better North Sea globe view without introducing subsurface sections, burial histories or petroleum-system simulation.

## Sources

- North Sea Transition Authority / Lloyd's Register. Central North Sea and Moray Firth Regional Geological Maps, archive v1_1, project 2017/18. [Government catalog](https://ckan.publishing.service.gov.uk/dataset/nsta-central-north-sea-and-moray-firth-regional-geological-maps-arcgis-version5). Enclosed narrative: `Documents/OGA Regional Geological Maps_CNS_MF Information.docx`. Retrieved 9 September 2026; OGL 3.0.
- North Sea Transition Authority / Lloyd's Register. Northern North Sea and East Shetland Platform Regional Geological Maps, project 2018/19. [Government catalog](https://ckan.publishing.service.gov.uk/dataset/nsta-northern-north-sea-and-east-shetland-platform-regional-geological-maps-arcgis-version5). Enclosed narrative: `Narrative OGA Regional Geological Maps_NNS_ESP.docx`. Retrieved 9 September 2026; OGL 3.0.
- NSTA. [Subsurface data](https://www.nstauthority.co.uk/regulatory-information/exploration-and-production/exploration/subsurface-data/). Official directory of regional packages and their purpose; accessed 9 September 2026.
- The National Archives. [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). License explicitly linked by both publisher records and archive narratives.
