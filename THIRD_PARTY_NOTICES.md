# Third-party notices

EarthHistory does not yet declare a license for its own source code. The terms
below apply only to the identified third-party software and datasets.

## Runtime data

- **Earth's tectonic and plate boundary evolution over 1.8 billion years,
  Cao et al. (2024), model v2.4** —
  [Zenodo record 13628813](https://doi.org/10.5281/zenodo.13628813), licensed
  under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  EarthHistory derives triangulated model geography, sampled rotations, exact
  resolved topology and typed directed boundaries from the palaeomagnetic
  reconstruction anchored to plate 0. Geometry refinement, compact encoding,
  motion interpolation and reference binding are EarthHistory processing.
  Unsupported geometry and motion remain explicit. Native model polygons are
  not promoted to observed shorelines or calibrated elevations. The data
  license is separate from GPlates/pyGPlates software licenses.
- **Natural Earth 1:110m Admin 0 countries** —
  [Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), public
  domain. EarthHistory subdivides and binds present-day reference lines to Cao
  plate coordinates offline, retaining ambiguity and validity limitations.
  These reference lines do not represent historical political borders.
- **Geological Survey of Canada Arctic geology** — Harrison et al. (2011),
  [Geological Map of the Arctic, Map 2159A](https://doi.org/10.4095/287868),
  and Harrison, Lynds, Ford and Rainbird (2016),
  [Canadian Geoscience Map 80](https://doi.org/10.4095/297416), licensed under
  the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
  EarthHistory redistributes clipped and classified derivative geometry for
  northern Canada, Pearya and the Barents region, with source-unit rules,
  uncertainty and changes documented in the regional manifests. Contains
  information licensed under the Open Government Licence – Canada; source:
  Natural Resources Canada, Geological Survey of Canada. This derivative is
  not affiliated with or endorsed by Natural Resources Canada.
- **Norwegian Polar Institute, Geology, Svalbard — Geological units
  1:750,000** —
  [official service metadata](https://geodata.npolar.no/arcgis/rest/services/Temadata/G_Geologi_Svalbard_S250_S750/MapServer/10?f=pjson),
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  EarthHistory redistributes a clipped old-material derivative; its model pose,
  exposure and palaeoshoreline limits remain explicit. © Norwegian Polar
  Institute.
- **U.S. Geological Survey regional geology** — Lund et al. (2015),
  [Data Series 898](https://doi.org/10.3133/ds898); Irwin and Wentworth (2012),
  [Open-File Report 2012-1228](https://pubs.usgs.gov/publication/ofr20121228);
  and Reed and Bush (2005),
  [Generalized Geologic Map of the Conterminous United States](https://pubs.usgs.gov/atlas/geologic/).
  USGS-authored U.S. Government data are generally public domain under
  17 USC 105. EarthHistory clips and classifies these sources into western
  Laurentia material-domain derivatives while preserving source-scale,
  interpretation and warranty caveats.
- **Northern Cordillera terrane compilation** — Colpron, Nelson and
  collaborators, revised through 2015 by the British Columbia and Yukon
  geological surveys,
  [official open-data record](https://open.canada.ca/data/en/dataset/16d06638-87a8-40a4-8550-910370d2fd76),
  licensed under the Open Government Licence – Canada. EarthHistory
  redistributes clipped domain fragments for the western North America
  correction; unit ages constrain material scenarios and do not establish
  ancient pose, assembly time, surface exposure or elevation.

## Historical data and research

The notices below document data and methods used in earlier implementations
or research. They do not identify additional data authorities in the native
Cao foundation. The current asset manifest determines what is redistributed;
earlier published versions retain their own asset sets and attribution.

- **PALEOMAP Paleodigital Elevation Models of the Phanerozoic, v2** — Scotese
  and Wright (2018), [Zenodo record 5460860](https://doi.org/10.5281/zenodo.5460860),
  licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
  EarthHistory redistributes all 109 native 1° CSV grids as compact signed-metre
  derivatives and identifies them as interpreted model output. The documented
  duplicate-meridian repair and south-pole row closures are preparation changes.
- **PALEOMAP Political Boundaries v3 and Global Plate Model v3** — Kocsis and
  Scotese (2023), [Zenodo record 7994000](https://doi.org/10.5281/zenodo.7994000),
  licensed under CC BY 4.0. EarthHistory reconstructs and simplifies these
  present-day political-reference features with pyGPlates; they do not represent
  historical borders. A compact rotation and continental-partition derivative
  also supports material-registered movement between elevation source ages.
- **Improving global paleogeography since the late Paleozoic using paleobiology** —
  Cao et al. (2017), [Biogeosciences 14 (2017)](https://doi.org/10.5194/bg-14-5425-2017),
  official EarthByte GPlates 2.3 Paleogeography package, licensed under
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). EarthHistory derives
  a qualitative chronology constraint from the absence of mapped permanent-ice
  polygons between 81 and 285.01 Ma. Polygon geometry is not transferred across
  reconstruction frames; this absence is not proof of an ice-free Earth.
- **GDH1 ocean lithosphere age–depth model** — Stein and Stein (1992),
  [Nature 359, 123–129](https://doi.org/10.1038/359123a0). Citation and numerical
  model only; no paper text, figures or third-party implementation is bundled.
  Its application to ancient oceans is an explicitly identified inference.
- **Köppen–Geiger climate classification v2, 1991–2020** — Beck et al.
  (2023), [Scientific Data 10, 724](https://doi.org/10.1038/s41597-023-02549-6)
  and [Figshare dataset](https://doi.org/10.6084/m9.figshare.21937571), released
  under CC0. EarthHistory losslessly run-length encodes the authored 0.5° class
  grid and retains its legend. It represents climatic vegetation potential,
  not observed land cover.
- **ETOPO 2022 Global Relief Model** — NOAA National Centers for Environmental
  Information, [DOI 10.25921/fd45-gt74](https://doi.org/10.25921/fd45-gt74),
  public-domain U.S. government data with attribution requested. EarthHistory
  distributes seven 256² bilinear service subsets of the v1 60 arc-second
  surface product, rounded to whole metres in the EGM2008 vertical datum.
- **EMODnet Digital Bathymetry (DTM 2024)** — EMODnet Bathymetry Consortium,
  [DOI 10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1](https://doi.org/10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1),
  licensed under CC BY 4.0. EarthHistory distributes one bounded 256² central
  North Sea derivative of the official mean-elevation WCS, rounded to whole
  metres relative to Lowest Astronomical Tide. It is for visualization, not
  navigation; the visual transition to the global EGM2008 surface is labelled
  synthesis rather than a numerical datum conversion.

The source catalog in `src/data/sources.ts` contains full scientific citations,
versions, temporal ranges, geographic bases and retrieval dates. Papers marked
“citation only” contribute claims or chronology; their text and figures are not
redistributed.

## Application dependencies

The installed dependency versions are recorded exactly in `package-lock.json`.

| Package | Declared version | License | Project |
| --- | ---: | --- | --- |
| React / React DOM | 19.2.8 | MIT | https://react.dev/ |
| Three.js | 0.185.1 | MIT | https://threejs.org/ |
| Lucide React | 1.42.0 | ISC | https://lucide.dev/ |
| Vite | 8.2.2 | MIT | https://vite.dev/ |
| Vitest | 5.0.0 | MIT | https://vitest.dev/ |
| TypeScript | 7.0.2 | Apache-2.0 | https://www.typescriptlang.org/ |
| Playwright Test | 1.63.0 | Apache-2.0 | https://playwright.dev/ |

Transitive dependency notices and their license files remain available in the
installed package tree. Production deployments bundle only the code selected by
the Vite build and the static scientific controls listed in the data manifest.
