# North Sea structural elements as an emergence-history test

Probe date: 2026-09-15. Read-only measurement of the **public** payloads under
`public/data/reconstruction/cao-v2.4/palaeo-coastlines/`, against the named
structural elements of the North Sea rift and their published emergence
history. Third companion to
[palaeo-coastlines-north-sea-formation-checks.md](palaeo-coastlines-north-sea-formation-checks.md)
(the UK-sector formations),
[palaeo-coastlines-norwegian-shelf-checks.md](palaeo-coastlines-norwegian-shelf-checks.md)
(the Norwegian-sector formations),
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say) and
[palaeo-coastlines-north-sea-edits.md](palaeo-coastlines-north-sea-edits.md)
(what was changed).

The two earlier memos asked *where was a named formation deposited*. This one
asks the complementary question: **at the crest of a named structural element,
and in the adjacent basin, does the shipped map say land, shallow sea, both, or
neither — and does that match what the element's emergence history requires?**
It changes nothing. Where it finds a mismatch it says whether the fix is a
permanent validator witness, a cited basin edit, or a limitation that must not
be edited because the element is smaller than the source model can resolve.

Every statement is tagged. **Measured** is a number computed this session from
the shipped payloads or from licensed geometry. **Verbatim** is an exact
quotation of a source read this session. **Snippet** is a retrieved summary
that was *not* verified against the source's own page. **Inference** is
EarthHistory's own reading.

## Provenance of the measurement

| Item | Value |
|---|---|
| Repository | `/Volumes/EksternalHome/Koding/HTML/EarthHistory`, branch `codex/palaeo-coastlines` |
| Git HEAD at probe time | `192cc224cf59f198587afd000626f0725c96c5a9` ("feat: Scottish Middle Jurassic landmass, Eocene platform decision and mobile key fix") |
| Working tree at probe time | An implementation agent was concurrently editing `scripts/research/palaeo_coastlines_compile.py`, `…_correction.py`, `promote_palaeo_coastlines.py`, **`data/corrections/palaeo-coastlines/basins/north-sea.json`** and parts of `public/`, so these numbers describe HEAD `192cc22` and **not** whatever that work compiles next. **No file under `public/data/reconstruction/cao-v2.4/palaeo-coastlines/` was modified**: `git status --porcelain -- public/` listed `manifest.json`, `core.json`, `corrections/material-v1/catalog.json`, `reconstruction/cao-v2.4/manifest.json` and `motion-tiles/index.json` only. Every payload read here is therefore the committed `192cc22` payload. |
| Snapshot | The 54-file palaeo-coastline directory was copied to session scratch **before** measuring. At snapshot time `git status --porcelain -- public/` listed **no** palaeo-coastline file, so the snapshot equals the committed `192cc22` blobs; three were additionally verified against `git show` (see the appendix). |
| Payloads changed under us | **Yes, and it is recorded rather than hidden.** By the end of the session the implementation agent had recompiled, and **all 52 files differ from this snapshot in the live working tree**. Every number in this memo is therefore a statement about HEAD `192cc22`, and re-running the probe against the working tree will not reproduce it. The digests in the appendix are what makes that checkable. |
| Interpreter | `../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python` |
| Payloads read | 52 (`lm` and `sm`, 24 canonical intervals plus `lgm`, plus 2 class catalogs) |
| Integrity | **Measured.** The per-file `sha256` table is the appendix. |

**Method, Measured.** Identical to the two companion memos and byte-for-byte
the validator's own classification, imported read-only rather than
re-implemented: `palaeo_coastlines_compile.decode_ehpr` decodes each EHPR v1
payload, `piece_geometry` rebuilds each piece's rings, the pieces are unioned
per class per interval (this is `class_union` in
`scripts/research/palaeo_coastlines_correction.py`), and a present-day
`(lon, lat)` gets the class set `{name : union.contains(point)}`. The union is
over every piece in the interval file and does not filter by a piece's own
`(TOAGE, FROMAGE]` lifecycle, exactly as the validator does it. A point covered
by no shipped class is reported as `neither`. Only `lm` and `sm` ship; the
mountain class `m` is compiled offline and withheld, so Cao ground carrying only
`m` reads here as `neither` — see the formation-checks memo's §6.

**What each answer means on screen** is unchanged: `lm` paints olive land; `sm`
paints teal shallow sea; `lm` **and** `sm` together **render as land**, because
land is drawn later and higher and hides the shallow sea underneath; `neither`
lets the native blue shelf show through, captioned "Cao 2024 continental crust,
depth unmapped".

## What this memo found, in five lines

1. **Measured: 26 of the 43 Norwegian-sector elements, and 10 of the 19
   UK-sector elements, have an inscribed diameter below Cao's own ~30 km
   coastline tolerance.** Most of the North Sea's named highs cannot be drawn in
   this model at all.
2. **Measured: across the twelve intervals from `166-146` to `11-2`, 27 of the 43
   elements carry the shallow-marine class and nothing else at every one of
   them.** High and graben are the same colour at every age; there is no
   archipelago and no post-Jurassic structural relief on this map.
3. Five operations are proposed: **A** the Jæren High as an island at
   `135-117`…`94-81`, **C** a removal of land over the Danish Central Graben
   depocentre at `166-146`…`117-94`, **D** the Mid North Sea High at
   `166-146`…`135-117` (best-sourced), **E** the Fladen Ground Spur at `203-179`
   and `166-146`, and **B** the East Shetland Platform in the Late Jurassic
   (weakest, may be dropped).
4. Sixteen witnesses are proposed, **nine of them negative** — they record states
   this memo decided not to change, so a later change must be deliberate.
5. Two corrections fall out: the Utsira High paper is **Riber, Dypvik & Sørlie
   2015**, not "Riber, Morgan & Aagaard"; and there is **no "Balder High"** in any
   dataset or publication reached here.

---

## 1. Where the elements are, and under what licence

### 1.1 The source of the coordinates

**Rights, and this is the first thing to settle.** The user supplied a North Sea
structural-elements map. **Nothing was read off it, traced from it, digitised
from it, or measured on it.** It is cited as the origin of the *list of names*
and nothing else. Every coordinate below comes from an independent, licensed,
machine-readable dataset.

**Measured.** The positions are the Norwegian Offshore Directorate's own
**Structural elements** layer, retrieved 2026-09-15:

| Item | Value |
|---|---|
| Dataset | "Structural elements" — "The main structural elements of the Norwegian shelf and adjacent areas. The data is compiled by the NPD and is based on the officially approved structural elements." (*Verbatim*, layer metadata `idAbs`) |
| Service | `https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/MapServer/704` (the `/arcgis/` path 404s; the real host was recovered from the FactMaps Experience Builder app config at `https://factmaps.sodir.no/map/cdn/16/config.json`) |
| Query | `…/704/query?where=1=1&outFields=*&returnGeometry=true&outSR=4326&f=geojson` |
| Records | **263 features, 242 distinct `NAME` values.** `returnCountOnly` = 263 and `exceededTransferLimit` was absent against `maxRecordCount` 1000, so the download is complete. |
| Payload | 1,468,760 bytes, sha256 `8e271cb65d10db3e6e5f3a503e192f88448bf6f5aebc355246094cf4a489062e` |
| Service version | `documentInfo` Version 3.5.0, Subject "Source for public fact map. APRX updated: 24.09.2024"; layer metadata `CreaDate` 20240704 |
| Official download page | `https://www.sodir.no/en/facts/geology/structure-elements/` (ESRI Shape) |
| Geonorge record | UUID `f1680c76-e328-48ec-afdc-78d822cd589b`, `DateMetadataUpdated` 2024-01-19 |
| Attribution | `idCredit` "Norwegian Offshore Directorate"; service `copyrightText` "Norwegian Offshore Directorate" |

**Licence, Verbatim from the Geonorge record.** `AccessConstraints`
"Åpne data"; `UseConstraints` "Lisens"; `OtherConstraints` "Ingen begrensninger
oppgitt."; `OtherConstraintsLinkText` "Norsk lisens for offentlige data (NLOD)";
`OtherConstraintsLink` **`http://data.norge.no/nlod/no/1.0`**; `UseLimitations`
"Legal.The contents on the website of the Norwegian Petroleum Directorate may be
copied and used free of charge as long as all material subject to copyright
contains a reference to the source."

**Correction to the brief.** The brief said NLOD **2.0**. The metadata record for
this dataset links NLOD **1.0**, and so do the parent FactMaps records. `sodir.no`
itself is behind Cloudflare and returned 403 to every automated fetch this
session, so an upgrade could not be confirmed or ruled out. **Cite NLOD 1.0
until someone reads the Sodir page.** Either way the layer is open data with an
attribution obligation, and nothing in this memo redistributes it: no polygon
enters a build, and the numbers below are derived points, boxes and areas.

**Datum, and a caveat.** The Geonorge record declares EPSG:**4230** (ED50) as the
dataset's reference system; the REST service reprojects to EPSG:4326 on request
(Sodir's transform is `ED_1950_To_WGS_1984_18`). An ED50→WGS84 shift in this
area is of order 100–200 m — four orders of magnitude below Cao's ~30 km
coastline tolerance, so it is recorded and then ignored.

### 1.2 Names: what the dataset has, and what it does not

**Measured.** Of the elements the user's map names, the Sodir layer carries most
of them, some under different spellings, and **six not at all**:

| User's name | Sodir `NAME` | Note |
|---|---|---|
| Fladen Ground Spur | **"Falden Ground Spur"** | Sodir misspells it. Filed under `LEVEL2CODE` `ØSHP` (East Shetland Platform). |
| Josephine High | **"Josefine Ridge"** | `LEVEL2CODE` `SENT` (Central Graben). |
| Øygarden Fault Zone | **"Øygarden Fault Complex"** | |
| Norwegian–Danish Basin | **"Danish Norwegian Basin"** | |
| North / Central / South Viking Graben | **no such polygons** | One `VIKI` parent with 31 children and no north/south division. Any N/S cut in Norwegian acreage would be EarthHistory's own, so none is made; the NSTA layers of §1.4 do carry a North/South split on the **UK** side. |
| West / East Central Graben | "Western Graben" exists; no "Eastern" | The `SENT` parent is spelled `Central  Graben` (double space) and has no level-2 polygon of its own. |
| Horda Platform | **no polygon of its own** | `HORD` is a `LEVEL2NAME` whose children are Utsira High, Stord Basin, Bjørgvin Arch and others. The family dissolve reaches west to 1.83°E, far wider than "Horda Platform" in most papers; **Bjørgvin Arch** is the platform crest *sensu stricto*. |
| Inner / Outer Moray Firth Basin | one "Moray Firth Basin" polygon | Filed under `WITC` (Witch Ground Graben). No inner/outer split — but the NSTA layers of §1.4 do carry an "Inner Moray Firth Basin" subarea. |
| Mid North Sea High | **absent** | Wholly outside Norwegian acreage; supplied by the NSTA layers in §1.4. |
| Forth Approaches Basin | **absent** | supplied by the NSTA layers in §1.4. |
| Midland Valley | **absent** | not in the NSTA layers either; onshore Scotland. |
| Siri Canyon | **absent** | Danish Palaeogene feature. |
| Balder area | **absent as a structural element** | There is a Balder *field* outline (Sodir field layer 502, `fldNpdidField` 43562, discovery well 25/11-1). Structurally it sits on the **Heimdal Terrace**, on the eastern flank of the South Viking Graben, and that element is probed here instead. |
| Vestland Arch | **absent** | An older literature term; the approved Sodir names for that ground are Bjørgvin Arch and the Horda Platform parent. |

**Inference, and it limits three rows of the test.** Sodir maps "adjacent areas"
as a courtesy, not as an authority on foreign acreage, so the polygons for
features whose type area lies outside the Norwegian shelf are **partial**: the
Tail End Graben comes back as a 424 km² Norwegian-side sliver of a major Danish
graben, the Ringkøbing-Fyn High as its Danish-sector part (4.45–8.87°E), and the
Moray Firth Basin as a 3,801 km² fragment of the UK basin system. Those three
rows test the ground Sodir actually maps, not the whole named feature, and are
flagged wherever they appear below.

### 1.3 Crest points, extents and the size that decides everything

**Measured.** Per element: the **pole of inaccessibility** of its largest part
(`shapely.ops.polylabel`, tolerance 0.002°) as the crest point; the bounding box
of all its parts; spherical area on R = 6371.0088 km; and the **inscribed
diameter** — twice the distance from the crest point to the nearest boundary,
measured after scaling to local kilometres. The inscribed diameter is the number
that matters: it is the diameter of the largest circle that fits inside the
element, and Cao et al. (2017) state that their revised coastlines "remain about
**30 km** distance from the fossil points used" (*Verbatim*, quoted in the
literature memo §1.3). An element narrower than that cannot be drawn as a
separate island without asserting precision the source model does not carry.

**Independent validation of the positions, Measured.** Published Sodir
exploration-wellbore coordinates fall inside the polygons they should:
16/1-8 Edvard Grieg (2.2351 E, 58.8357 N), 16/2-6 Johan Sverdrup (2.6152 E,
58.8237 N) and 25/6-1 (2.8006 E, 59.5256 N) all land inside **Utsira High**;
the Auk Field position (2.07 E, 56.4 N) lands inside **Auk Ridge**. No
coordinate in this memo comes from any figure.

**Measured.** The element table. `bbox` is `[minlon, minlat, maxlon, maxlat]`.

| Element (Sodir `NAME`) | crest lon, lat | bbox | area km² | inscribed ⌀ km |
|---|---|---|---:|---:|
| East Shetland Platform | 0.200, 59.625 | −1.19, 58.41, 1.71, 61.77 | 37,983 | 123.8 |
| Falden (Fladen) Ground Spur | 0.798, 58.476 | −0.08, 58.27, 1.23, 58.59 | 1,250 | **22.0** |
| Unst Basin | −0.011, 61.040 | −0.16, 60.90, 0.70, 61.29 | 1,076 | **15.1** |
| East Shetland Basin | 1.134, 60.796 | 0.61, 60.01, 2.10, 61.73 | 8,478 | 37.2 |
| Tampen Spur | 2.492, 61.542 | 1.63, 60.67, 3.77, 62.41 | 5,286 | **28.7** |
| Sogn Graben | 3.487, 61.769 | 3.17, 61.24, 3.67, 61.96 | 1,214 | **17.6** |
| Viking Graben (`VIKI` family) | 1.932, 60.739 | 0.61, 58.18, 3.77, 62.41 | 35,187 | 84.1 |
| Horda Platform (`HORD` family) | 3.540, 59.929 | 1.83, 58.38, 4.48, 61.24 | 24,252 | 91.2 |
| Bjørgvin Arch | 2.822, 60.168 | 2.52, 59.65, 4.41, 61.24 | 3,571 | **19.6** |
| Øygarden Fault Complex | 4.512, 60.488 | 3.67, 58.86, 4.73, 62.27 | 3,676 | **17.4** |
| Stord Basin | 3.612, 59.770 | 2.74, 59.07, 4.48, 60.75 | 12,808 | 69.9 |
| Utsira High | 2.533, 58.807 | 1.83, 58.38, 3.15, 59.73 | 4,619 | 36.7 |
| Gudrun Terrace | 2.091, 58.998 | 1.69, 58.55, 2.27, 59.20 | 1,252 | **18.1** |
| Sleipner Terrace | 1.926, 58.384 | 1.82, 58.24, 2.17, 58.50 | 306 | **9.8** |
| Heimdal Terrace (Balder field) | 2.410, 59.586 | 2.14, 59.14, 2.73, 59.87 | 1,071 | **19.5** |
| Ling Depression | 3.776, 58.745 | 1.59, 58.02, 4.42, 59.02 | 4,197 | **24.8** |
| Jæren High | 2.415, 57.612 | 1.88, 57.21, 2.87, 58.03 | 3,815 | 47.2 |
| Sørvestlandet High | 3.184, 57.229 | 2.75, 56.46, 4.79, 57.83 | 4,505 | 37.9 |
| Egersund Basin | 4.421, 57.743 | 3.29, 57.39, 5.09, 58.21 | 5,204 | 49.0 |
| Danish Norwegian Basin | 9.267, 56.464 | 2.08, 55.74, 11.42, 58.33 | 34,229 | 93.5 |
| Stavanger Platform | 5.050, 58.277 | 3.90, 57.63, 6.23, 60.44 | 13,393 | 70.2 |
| Sørlandet Platform | 8.831, 58.593 | 7.79, 57.97, 9.80, 59.13 | 5,199 | 37.7 |
| Sele High | 3.454, 58.362 | 2.93, 57.99, 3.72, 58.57 | 1,301 | **20.4** |
| Central Graben (`SENT` family) | 1.611, 57.079 | 0.61, 56.00, 4.78, 57.77 | 23,102 | 76.0 |
| Western Graben | 1.172, 57.105 | 0.61, 56.78, 1.47, 57.66 | 2,422 | **29.9** |
| Forties-Montrose High | 1.311, 57.471 | 0.74, 57.05, 1.71, 57.76 | 1,479 | **18.0** |
| Josefine Ridge (Josephine High) | 2.229, 56.776 | 2.05, 56.62, 2.42, 56.96 | 364 | **13.1** |
| Cod Terrace | 2.571, 57.146 | 2.17, 56.70, 3.23, 57.29 | 1,155 | **17.7** |
| Feda Graben | 2.966, 56.545 | 1.69, 56.01, 4.16, 57.23 | 4,284 | **26.5** |
| Gertrud Graben | 4.223, 56.098 | 3.66, 56.00, 4.45, 56.34 | 712 | **13.9** |
| Mandal High | 4.014, 56.419 | 3.71, 56.25, 4.24, 56.59 | 219 | **8.2** |
| Lindesnes Ridge | 3.386, 56.241 | 3.16, 56.05, 3.68, 56.50 | 261 | **5.9** |
| Auk Ridge | 2.013, 56.387 | 1.45, 56.14, 2.65, 56.50 | 965 | **15.1** |
| Argyll Horst | 2.787, 56.119 | 2.49, 56.01, 3.04, 56.26 | 562 | **16.4** |
| Søgne Basin | 4.273, 56.456 | 3.64, 56.21, 4.49, 56.81 | 1,683 | **23.4** |
| Tail End Graben (NO sliver) | 4.492, 56.091 | 4.17, 56.00, 4.77, 56.23 | 424 | **11.7** |
| Horn Graben | 6.834, 56.840 | 6.10, 55.95, 7.71, 57.51 | 10,839 | 79.5 |
| Ringkøbing-Fyn High (DK part) | 4.874, 56.243 | 4.45, 55.88, 8.87, 56.51 | 10,699 | 40.6 |
| Moray Firth Basin (fragment) | −0.469, 57.662 | −0.80, 57.45, 1.38, 57.96 | 3,801 | 38.1 |
| Halibut Horst | −0.733, 58.204 | −0.85, 58.07, 0.62, 58.32 | 1,463 | **12.9** |
| Andrew Ridge | 1.725, 58.058 | 1.27, 57.95, 1.81, 58.23 | 383 | **9.2** |
| Fisher Bank Basin | 1.504, 57.904 | 1.02, 57.70, 1.82, 58.12 | 1,197 | **24.6** |
| West Central Shelf | 0.146, 56.785 | −0.77, 55.96, 2.68, 57.66 | 21,828 | 102.6 |

**Bold inscribed diameters are below Cao's own ~30 km coastline tolerance.**
**Measured: 26 of the 43 elements are.** That single column decides most of §4:
whatever the literature says about them, twenty-six of these features cannot be
given their own coastline in this model without inventing precision.

**Inference, and it is the central geometric fact of this memo.** The North Sea
rift is built out of features 10–30 km across. Cao et al. (2017) is a global
model whose coastlines are positioned to ~30 km at best and searched at 500 km.
The element inventory and the model's resolution are an order of magnitude
apart. Only about a dozen elements — East Shetland Platform, West Central Shelf,
the Horda Platform family, the Danish Norwegian Basin, the Viking and Central
Graben families, Horn Graben, Stavanger Platform, Stord Basin, Jæren High,
Ringkøbing-Fyn High, Egersund Basin, Moray Firth Basin, Sørvestlandet High,
Sørlandet Platform, East Shetland Basin and Utsira High — are large enough for a
cited operation to be honest.

### 1.4 The UK sector: a second licensed dataset

**Measured.** The Sodir layer stops at the Norwegian view of its neighbours
(§1.2). The UK-sector elements come from the **North Sea Transition Authority**
open-data portal, retrieved 2026-09-15:

| Item | Value |
|---|---|
| Layers | "UKCS major geological areas (WGS84)" (15 features, field `BASINAME`) and "UKCS geological subareas (WGS84)" (73 features, field `SUBBSNNAME`) |
| Services | `https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/Major_geological_areas_(WGS84)/FeatureServer/0` and `…/Geological_subareas_(WGS84)/FeatureServer/0` |
| Owner | ArcGIS Online item owner `NSTA_GIS`; portal `https://opendata-nstauthority.hub.arcgis.com/` |
| Item description, *Verbatim* | "Generic geological boundaries on the UKCS." / "Generic geological subarea boundaries on the UKCS." |
| Licence | **Neither layer's own ArcGIS item metadata carries a `licenseInfo` string** (both empty; confirmed by reading the item JSON). Worse, NSTA's default User Agreement grants only the right to "exploit the Information **non-commercially**". The grant this memo relies on comes from elsewhere — see below. |
| Retrieved | 2026-09-15, `outSR=4326&f=geojson` |

**Rights, and the resolution is a real one rather than an assumption.** The
identical polygons are redistributed by the **British Geological Survey** in its
21CXRM Palaeozoic package as `DECC_OFF_Geological_Basins_Major.shp` and
`DECC_OFF_Geological_Basins_Sub.shp`, whose own `Read_Me_TERMS_OF_USE.txt` reads
*Verbatim*:

> "TERMS_OF_USE: Available under the Open Government Licence subject to the
> following acknowledgement accompanying the reproduced BGS materials 'Contains
> British Geological Survey materials ©NERC 2017'"
> "TERMS_OF_USE_URL: http://nationalarchives.gov.uk/doc/open-government-licence/version/3/"

**Measured, this session, by reading the shapefiles directly** (`pyshp`, no
reprojection): the DECC and NSTA extents are the same polygons. `MID NORTH SEA
HIGH AREA` −2.400, 54.667, 3.400, 57.167 against NSTA −2.40, 54.67, 3.40, 57.17;
`EAST SHETLAND PLATFORM AREA`, `FORTH APPROACHES BASIN`, `FLADEN GROUND SPUR` and
`JAEREN HIGH` likewise agree to the printed precision. (The DECC `.prj` declares
ED50 while the stored coordinates are numerically the NSTA WGS84 ones, so the
`.prj` label is nominal; either way the identity holds.)

**So the rights position is:** the geometry is **OGL v3.0**, and any use must
carry "Contains British Geological Survey materials ©NERC 2017". **Cite the BGS
redistribution, not the NSTA portal**, whose default agreement is non-commercial
and whose layer items carry no licence string at all. Nothing is redistributed
here either way — only derived points, boxes and areas appear. An empty
`licenseInfo` is not a grant, and this memo does not treat it as one.

**Inference, and it matters for reading the table.** The NSTA layers are
described by their own publisher as *generic geological boundaries*, i.e. a
partition of the UKCS, not a structural-element outline. The "Mid North Sea High
Area" polygon accordingly reaches onshore north-east England at −2.4 °E and north
to 57.17 °N, well beyond the high *sensu stricto*. It is used here as a licensed
**extent** and its offshore part is probed separately in §3.4.

**Measured**, the UK-sector elements, same method as §1.3:

| Element (NSTA name) | crest lon, lat | bbox | area km² | inscribed ⌀ km |
|---|---|---|---:|---:|
| Mid North Sea High Area | −0.702, 55.984 | −2.40, 54.67, 3.40, 57.17 | 39,392 | 96.3 |
| Moray Firth Basin | −0.844, 58.342 | −4.08, 57.50, 1.80, 59.33 | 35,768 | 124.0 |
| East Shetland Platform Area | 0.253, 60.044 | −2.20, 58.17, 1.60, 61.00 | 29,327 | 87.4 |
| Forth Approaches Basin | −1.580, 56.985 | −2.81, 55.96, 0.00, 57.83 | 14,762 | 64.9 |
| Inner Moray Firth Basin | −2.460, 58.086 | −4.08, 57.59, −1.40, 58.67 | 11,121 | 77.9 |
| Forth Approaches Sub Basin | −1.719, 56.727 | −2.81, 55.96, 0.00, 57.67 | 11,896 | 63.6 |
| East Shetland Basin | 1.320, 61.189 | 0.60, 60.50, 1.96, 61.83 | 6,873 | 51.7 |
| Witch Ground Graben | 1.499, 57.818 | −1.20, 57.50, 1.80, 58.67 | 6,088 | 35.4 |
| **Fladen Ground Spur** | **22.0** Sodir / **43.9** NSTA | `402-380`…`224-203`, `179-166` (`L`), `94-81`…`11-2` | `203-179` and `166-146` (`s`, against Quirie et al. 2020 "The Fladen Ground Spur likely formed a **positive structure throughout the Jurassic**" and "a low-relief topographic spur with flora dominated by gymnosperm (e.g. conifer forests)") | **the two licensed outlines disagree by a factor of four in area** (1,250 km² Sodir, 5,336 km² NSTA). On Sodir's it is below the floor; **on NSTA's it is above it at 43.9 km**, and §5.2 acts on the NSTA outline while saying which one it used. |
| South Viking Graben | 1.630, 59.603 | 1.20, 58.00, 2.04, 59.83 | 4,762 | **25.9** |
| Unst Basin | 0.188, 61.055 | −1.00, 60.33, 0.60, 61.50 | 4,489 | **25.8** |
| Peterhead Ridge | −1.742, 57.309 | −2.17, 57.00, 0.00, 57.83 | 2,866 | **17.0** |
| Grampian Spur | −1.574, 57.668 | −2.00, 57.50, −0.80, 58.00 | 2,008 | **20.7** |
| Halibut Horst | −1.350, 58.250 | −1.60, 58.17, 0.00, 58.33 | 1,735 | **18.4** |
| North Viking Graben | 1.877, 60.009 | 1.60, 59.83, 2.08, 61.17 | 1,565 | **19.8** |
| Jaeren High (UK part only) | 1.941, 57.641 | 1.80, 57.17, 2.34, 58.00 | 1,136 | **16.8** |
| Montrose High | 1.491, 57.391 | 1.20, 57.17, 1.60, 57.67 | 888 | **13.0** |
| Buchan/Glenn Horst | 0.250, 57.917 | 0.00, 57.83, 0.80, 58.00 | 876 | **18.4** |
| Forties High | 1.000, 57.750 | 0.80, 57.67, 1.20, 57.83 | 440 | **18.4** |

**Measured, and it changes one verdict.** The **Fladen Ground Spur** is 43.9 km
across on the NSTA outline against 22.0 km on Sodir's — the Sodir "Falden Ground
Spur" polygon is less than a quarter of the NSTA one (1,250 against 5,336 km²).
**On the NSTA outline the Fladen Ground Spur is above Cao's class floor**, and
§5.2 acts on that. A third, independent rendering breaks the tie: the EGDI /
NAGTEC layer, itself derived from an NPD shapefile, gives 0.44–1.51 °E,
58.13–59.27 °N — which matches NSTA and not Sodir. **Two of three sources agree on
the larger outline; this memo uses NSTA's and says so.** Two further notes: NSTA's "Jaeren High" is the UK-sector part
only (16.8 km) and Sodir's whole-feature polygon (47.2 km) is the one used for
the verdict; and NSTA does carry a **North Viking Graben / South Viking Graben**
split, but at 19.8 and 25.9 km inscribed, and only on the UK side.

---

## 2. What the literature requires of each element

**Rights.** Every publication in this section is **citation-only**. No figure,
map plate, polygon, coordinate list or table is traced, digitised, copied or
redistributed. Short quotations are given with attribution.

The backbone of this section is the **British Geological Survey United Kingdom
Offshore Regional Report** series, whose full text is openly readable at
`webapps.bgs.ac.uk/Memoirs/` and whose whole purpose is to describe these
elements by name, interval by interval. NERC copyright; citation-only.

| Ref | Report | Bibliographic reference (*Verbatim* from the report's own front matter) |
|---|---|---|
| **[N]** | northern North Sea | Johnson, H, Richards, P C, Long, D, and Graham, C C. 1993. *United Kingdom offshore regional report: the geology of the northern North Sea.* (London: HMSO for the British Geological Survey.) ISBN 0 11 884497 0; NERC copyright 1993. Read at `https://webapps.bgs.ac.uk/Memoirs/docs/B01842.html` |
| **[C]** | central North Sea | Gatliff, R W, Richards, P C, Smith, K, Graham, C C, McCormac, M, Smith, N J P, Long, D, Cameron, T D J, Evans, D, Stevenson, A G, Bulat, J, and Ritchie, J D. 1994. *United Kingdom offshore regional report: the geology of the central North Sea.* (London: HMSO for the British Geological Survey.) ISBN 0 11 884504 7; NERC copyright 1994. Read at `https://webapps.bgs.ac.uk/Memoirs/docs/B01846.html` |
| **[S]** | southern North Sea | Cameron, T D J, Crosby, A, Balson, P S, Jeffery, D H, Lott, G K, Bulat, J, and Harrison, D J. 1992. *United Kingdom offshore regional report: the geology of the southern North Sea.* (London: HMSO for the British Geological Survey.) ISBN 0 11 884492 X; NERC copyright 1992. Read at `https://webapps.bgs.ac.uk/Memoirs/docs/B01848.html` |
| **[M]** | Moray Firth | Andrews, I J, Long, D, Richards, P C, Thomson, A R, Brown, S, Chesher, J A, and McCormac, M. 1990. *United Kingdom offshore regional report: the geology of the Moray Firth.* (London: HMSO for the British Geological Survey.) ISBN 0 11 884379 6; NERC copyright 1990. Read at `https://webapps.bgs.ac.uk/Memoirs/docs/B01844.html` |

All four were text-extracted and read this session; every quotation below marked
*Verbatim* is from that text.

### 2.1 Permian — the high that separated two basins, and then drowned

This is the question the brief asked first, and the answer is unambiguous, and
it has **two halves that fall in different Cao intervals**.

**Verbatim [S]:** "This Southern Permian Basin (Glennie, 1986b) was separated
from the contemporary, but smaller, Northern Permian Basin by the **newly
emergent Mid North Sea High**." And: "The Permian basin of the southern North Sea
was bounded to the south by the London–Brabant Massif, and to the west and north
by the **newly emergent Pennine High and Mid North Sea High** respectively."

**Verbatim [C]:** "Two major basins were developed in the North Sea during
Permian times; they were **separated by the east–west-trending Mid North
Sea–Ringkøbing-Fyn High**." And: "The Mid North Sea–Ringkøbing-Fyn High was
probably in existence throughout Permian times, and **may have completely
separated the two basins during Early Permian times**." And: "To the south, it
[the Northern Permian Basin] was separated from the Southern Permian Basin by
the Mid North Sea High." And: "Rotliegend sediments may be **absent from most of
the Mid North Sea High**, and probably onlap both its southern and northern
flanks."

Then the Zechstein reverses it.

**Verbatim [S]:** "The Mid North Sea High was **inundated by the first of the
Zechstein transgressions, and remained partially or wholly submerged** as an
area of reduced subsidence throughout the remainder of the Permian."

**Verbatim [C]:** "However, **much of it was covered by a shallow, carbonate sea
during the Late Permian**, for up to 800 m of Zechstein sediments are recorded
over the high." And, the one qualification: "Taylor (1990) noted the presence of
anhydrites equivalent to the Werraanhydrit directly above Devonian and
Carboniferous strata, respectively, in wells 38/29-1 and 38/16-1. This suggests
that **at least part of the Mid North Sea High was emergent until the later
stages of the Z I cycle**." And: "There was probably a connection between the
Northern and Southern Permian basins across most of the Mid North Sea–Ringkøbing-Fyn
High throughout Late Permian times."

**Inference, and this is the interval trap.** The emergent barrier is an **Early
Permian (Rotliegend)** state and the drowned high is a **Late Permian
(Zechstein)** state. On the Cao schedule the Rotliegend desert itself is
Capitanian–Wuchiapingian and therefore falls *inside* bin `269-248` together
with the Zechstein that drowned it (the formation-checks memo §1.2 established
this and it is not re-litigated here). So the barrier statement constrains bins
`296-285` and `285-269` — which are Cisuralian–early Guadalupian, before the
Upper Rotliegend desert existed — and the drowning statement constrains
`269-248`. A maximum-transgression bin keeps the marine end member, so
`269-248` must be shallow sea over the high, and the emergent barrier is
**not renderable at its own age at all**.

**A stratigraphic disagreement that must be stated, not smoothed.** All four BGS
reports call the Rotliegend "Lower Permian" and place the desert in "Early
Permian times"; the modern dating the formation-checks memo relies on puts the
**Upper** Rotliegend and its Auk Formation in the Capitanian–Wuchiapingian,
≈ 265–254 Ma, which is Guadalupian–Lopingian, not Cisuralian. The two are not
reconcilable by wording. If the BGS reading is taken at face value, the emergent
barrier belongs in `285-269` and the shipped `lm` there is exactly right; if the
modern reading is taken, the barrier belongs in `269-248` and is unrenderable.
**The shipped map is defensible under the BGS reading and unrepresentable under
the modern one**, and this memo proposes no operation either way.

### 2.2 Triassic — the highs as low relief and as source areas

**Verbatim [S]:** "This basin persisted through Triassic times, with the
London–Brabant Massif, Pennine High and Mid North Sea High continuing to define
its southern, western and northern margins. **The Mid North Sea High had become a
relatively low topographic feature, much reduced in size, and it is partly
mantled by thin Triassic deposits.**" And: "there are only thin and patchy
developments of Lower Permian piedmont breccias preserved on the southern flank
of the Mid North Sea High. **This high was not a major source of clastic sediment
to the basin during either Permian or Triassic times.**"

**Verbatim [C]:** "exceptionally thick deposits are found to the east, in the
Egersund and North Danish basins, **adjacent to the uplifted Fennoscandian Shield
which contributed the sediment**."

**Inference.** The Triassic source area for this basin is the Fennoscandian
Shield east of it, not the intrabasinal highs, and the Mid North Sea High is
explicitly *low* and partly covered. So "Triassic dryland everywhere" is the
right answer for the whole window and no intrabasinal high needs to be
distinguished — which is what the edits memo already concluded for bins
`248-224` and `224-203`.

### 2.3 Early Jurassic and the Middle Jurassic dome

The Middle Jurassic case is already settled by two existing records
([the Middle Jurassic memo](palaeo-coastlines-north-sea-middle-jurassic.md) and
the edits memo) and is not reopened. Two element-specific statements matter here.

**Verbatim [N]:** "The East and North Shetland platforms and Fladen Ground Spur
are composed of Old Red Sandstone and Caledonian basement, overlain in the east
by an eastward-thickening Tertiary sequence. **Permian, Triassic and Jurassic
strata are generally absent across the East Shetland Platform**, but are locally
preserved along the margin adjacent to the Viking Graben." And: "**Jurassic strata
are absent over most of the East Shetland Platform**, but are preserved within the
downfaulted **Unst Basin**."

**Verbatim [N]:** "According to Ziegler (1982), **uplift and eastward tilting of
the Shetland Platform during the Late Jurassic** was associated with doming of
the south-west Norway–Faeroe rift zone, and the resulting erosion caused elastic
[*sic*, for clastic] sediments to be shed into the rapidly subsiding North Sea
rift."

**Inference, and it is a live finding.** The Sodir East Shetland Platform runs
from 58.41°N to 61.77°N. The contract's existing `east-shetland-platform-add-land`
operation covers only −2.6…0.8 °E, 60.2…62.4 °N. **Measured**, the platform's own
crest point (0.200 °E, 59.625 °N) lies 0.6° *south* of that rectangle, and it is
shallow marine at `179-166`. Whatever one concludes about the Late Jurassic, the
Middle Jurassic operation covers the northern third of the element Sodir maps.

### 2.4 Late Jurassic rift — the archipelago

**Verbatim**, Roberts, Kusznir, Yielding & Beeley 2019, "Mapping the bathymetric
evolution of the Northern North Sea: from Jurassic synrift archipelago through
Cretaceous–Tertiary post-rift subsidence", *Petroleum Geoscience* 25, 306–321,
https://doi.org/10.1144/petgeo2018-066, CC BY 3.0 (abstract read this session
through the publisher's Crossref deposit; the article page itself returns 403 to
automated fetches):

> "At the top of the Lower Cretaceous (98.9 Ma), very localized fault-block
> topography, inherited from the Jurassic rift, is predicted to have remained
> emergent within the basin. At the Base Cretaceous (140 Ma), the fault-block
> topography is much more prominent and **numerous isolated footwall islands** are
> shown to have been present. At the Late Jurassic synrift stage (155 Ma), these
> islands are linked to form **emergent island chains along the footwalls of all of
> the major faults**. This is the Jurassic archipelago, the islands of which were
> the products of synrift footwall uplift."

**Verbatim [N]**, the same picture from the regional report, and with the
*opposite* emphasis: "At the end of the Late Jurassic to earliest Cretaceous
rifting episode, **most of the Viking Graben was probably submerged**, and Badley
et al. (1988) postulated that **only the crests of major fault blocks, such as the
Brent structure, may have been emergent**." And: "Yielding et al. (1992) have
suggested that **the islands created by up-tilting of the fault-block crests were
short lived**, and some may have been eroded by as much as 350 m."

**Verbatim [C]**, for the Central Graben highs: "A major unconformity at
base-Cretaceous level also **cuts out Jurassic strata from a large part of the
Jæren High, the Forties-Montrose High, and parts of the West Central Shelf**."

**Verbatim**, Riber, Dypvik & Sørlie 2015, *Norwegian Journal of Geology* 95,
57–89, https://doi.org/10.17850/njg95-1-04, open access, for the Utsira High:
"Coarse-grained clastics of Callovian and Volgian age in grabens in the southern
Utsira High indicate the **subaerial exposure of the high through latest Jurassic
time** (Sørlie et al., 2014)."; "The Avaldsnes h[igh] was transgressed in the Late
Jurassic, whereas the **Haugaland high remained dry land until the Early
Cretaceous** and represents the final stage of the exposure of the high."

**Inference, and this is the hinge of the whole memo.** The Late Jurassic
archipelago is real, cited, and *explicitly below the resolution of any global
palaeogeographic model*: Roberts et al. are drawing footwall crests a few
kilometres to a few tens of kilometres wide, the regional report calls them
short-lived and mostly submerged, and §1.3 measures 26 of the 43 elements below
Cao's own 30 km tolerance. The edits memo already declined to draw them, in as
many words, and nothing found here overturns that. What *does* survive the
resolution test is a small number of large highs — Utsira High (36.7 km), Jæren
High (47.2 km), Sørvestlandet High (37.9 km), Ringkøbing-Fyn High (40.6 km),
East Shetland Platform (123.8 km) — and those are where §4 proposes work.

### 2.5 Early Cretaceous — progressive drowning, with dates

**Verbatim [C]:** "**The Mid North Sea High became submerged early in Cretaceous
times, and no longer formed a positive intrabasinal feature.**"

**Verbatim [S]**, with a stage: "The transgressions during the Aptian and the
middle to late Albian more than doubled the area of the contemporary North Sea
(Hancock, 1986). **The Mid North Sea High, the Market Weighton Block and the
London–Brabant Massif were submerged for the first time**, resulting in the thin,
transgressive deposits of the Carstone and the Red Chalk Formation resting
unconformably on pre-Cretaceous sediments."

**Verbatim**, Riber et al. 2015 for the Utsira High: "**The deposition of an Early
Cretaceous shallow-marine facies across the Utsira High marks the definitive end
of subaerial exposure** … Since then the Utsira High has gradually subsided to its
present depth."

**Verbatim [C]**, for the Danish-sector highs: lowermost Cretaceous sandstones
"in the Danish sector on the western flanks of the Ringkøbing-Fyn High, the Vyl
Formation … have been interpreted as **submarine-fan sands related to erosion of
local emergent highs**."

**Inference.** Aptian–Albian is 121.4–100.5 Ma on ICS v2024/12, which straddles
Cao's `135-117` / `117-94` boundary and sits mostly inside `117-94`. The Utsira
High's end of exposure is Early Cretaceous, i.e. `146-135` or `135-117`. So the
drowning of the North Sea highs is **not one event**: Utsira goes first (Early
Cretaceous), the Mid North Sea High next (Aptian–Albian), and the Central Graben
flank highs last — see §2.6.

### 2.6 Late Cretaceous — the last islands, and their dates

This is the strongest set of constraints in the whole memo, because the central
North Sea report gives *stage-level* submergence dates for named elements.

**Verbatim [C]:** "Seismic interpretation indicates that the formation [Hidra Fm,
Cenomanian] onlaps the flanks of the Forties-Montrose and Jæren highs; **these
intrabasinal upland areas were not submerged until much later in the
Cretaceous**."

**Verbatim [C]:** "**Chalk sedimentation extended over the Jæren High, probably
during the early Campanian.** The Hod Formation there is up to 100 m thick; **the
highs that form the western margin to the Central Graben were not submerged until
later in Cretaceous times**."

**Verbatim [C]:** "The Tor Formation is late Campanian to Maastrichtian in age,
and was deposited when a further rise in sea level **submerged the Forties-Montrose
High, and most of the western flank of the Central Graben, for the first time**."

**Verbatim [C]:** "because contemporary highs, such as the **Forties-Montrose and
Jæren highs and those along the western margin of the Central Graben, were not
submerged until late in the Cretaceous**, they accumulated much thinner sequences."

**Verbatim [N]**, the same for the north-west margin: "only the uppermost Upper
Cretaceous strata (**Campanian to Danian**) **encroached significantly on to the East
Shetland Platform and Fladen Ground Spur**."

**Verbatim [C]**, the end state: "During Late Cretaceous and earliest Paleocene
times, the North Sea and much of mainland Britain were submerged by an inundation
of warm, oxygenated waters. **Only the highlands of Scotland, Norway, and an area
east of the Viking Graben remained as land** while relative sea level rose by as
much as 600 m to its highstand during latest Maastrichtian times (Hancock and
Kauffman, 1979)."

**Inference, and this is the largest disagreement this memo finds.** On ICS
v2024/12 the early Campanian begins at 83.6 Ma and the late Campanian at about
77 Ma. So:

- the **Jæren High** was emergent through essentially the whole of Cao bin
  `94-81` and was flooded at or just after its young end;
- the **Forties-Montrose High** and the **highs on the western flank of the
  Central Graben** were emergent through the whole of `94-81` and were flooded
  inside `81-58`;
- the **East Shetland Platform** and the **Fladen Ground Spur** received no
  significant Cretaceous section until the Campanian, i.e. they too were
  emergent or starved through `135-117`, `117-94` and most of `94-81`.

And the shipped map draws every one of them as shallow sea at every one of those
intervals (§3).

### 2.7 Palaeogene and Neogene

Already settled by [the Eocene Shetland memo](palaeo-coastlines-north-sea-eocene-shetland.md)
and carried by two contract operations. One element-level statement is added
here, because it dates the emergence the contract rests on.

**Verbatim [N]:** "**The uplift and emergence in early Tertiary times of an area
extending from the Scottish Highlands to Shetland** is generally attributed to
opening of the North Atlantic. This uplift resulted in substantial erosion, and
large volumes of denudation products were shed eastwards and south-eastwards
towards partly fault-controlled basins in the Viking [Graben]."

**Verbatim [C]:** "The uplift of the Hebrides–Shetland axis established a wholly
new geography. An easterly to south-easterly flowing drainage system became
established on the **Orkney–Shetland Platform** and Scottish Highlands, resulting
in the reworking of the sedimentary cover of the **newly emergent terrains**."

No element east of the Shetland Platform is claimed emergent in the Palaeogene by
anything retrieved, and the contract's unedited control at (0.5 °E, 61 °N) in
`49-37` is the gate that keeps it that way.

### 2.8 Element-by-element statements from the wider literature

All of the following were read this session in the source's own PDF or page and
are ***Verbatim*** unless tagged otherwise. Metadata for every DOI was confirmed
at Crossref.

**Ringkøbing-Fyn High — a full emergence curve, and it is not the one the brief
assumed.** Michelsen, Nielsen, Johannessen, Andsbjerg & Surlyk 2003, "Jurassic
lithostratigraphy and stratigraphic development onshore and offshore Denmark",
*GEUS Bulletin* 1, https://doi.org/10.34194/geusb.v1.4651 (CC BY): "The
Ringkøbing–Fyn High acted as a **submarine** intra-basinal high during the Early
Jurassic. Middle Jurassic uplift of the central North Sea affected the
Ringkøbing–Fyn High, which was **emergent throughout Middle and Late Jurassic
times**." Nielsen 2003, "Late Triassic – Jurassic development of the Danish Basin
and the Fennoscandian Border Zone", *GEUS Bulletin* 1,
https://doi.org/10.34194/geusb.v1.4681 (CC BY), adds the Triassic and the end of
emergence: "South of the Ringkøbing–Fyn High, in the North German Basin, the
Vinding Formation is similarly developed indicating that **the high was submerged
at this time**"; "At this time [the early Rhaetian regression], the
Ringkøbing–Fyn High **was exposed to erosion** and fine-grained sand was shed to
the basin from the high"; and "during the Late Jurassic … the Ringkøbing–Fyn High
functioned as a **low-relief paralic hinterland that still supplied small amounts
of sand to the basin until the Ryazanian**."

**Mid North Sea High in the Jurassic.** Callomon 2003, *GEUS Bulletin* 1,
https://doi.org/10.34194/geusb.v1.4648 (CC BY), on the Middle Jurassic dome:
"domal uplift and the partition of marine basins through **emergent physical
barriers**, as exemplified by the Central North Sea Dome"; "Progress further
southwards into the North Sea was then blocked by the **emergent Central North Sea
Dome**." Johannessen 2003, *GEUS Bulletin* 1,
https://doi.org/10.34194/geusb.v1.4678 (CC BY): "The Inge and Mads Highs formed a
**continuation of the Mid North Sea High during Bajocian–Kimmeridgian times, and
constituted a large positive area** that possibly was an important sediment source
area." Møller & Rasmussen 2003, "Middle Jurassic – Early Cretaceous rifting of
the Danish Central Graben", *GEUS Bulletin* 1,
https://doi.org/10.34194/geusb.v1.4654 (CC BY), for the Volgian–Ryazanian: "the
Danish Central Graben was **fully submerged** and marine conditions prevailed,
**with the exception of marginal areas of the Ringkøbing–Fyn High and the Mid
North Sea High**."

**A flat contradiction about the Zechstein, and it has to be recorded rather than
resolved.** [S] and [C] have the Zechstein sea flooding the Mid North Sea High
(§2.1). The Norwegian Offshore Directorate's own group description says the
opposite: "Zechstein sedimentary rocks are widespread over the Norwegian-Danish
Basin, but are **absent east and north of the Utsira High and over the Mid North
Sea and Ringkøbing-Fyn highs**" (Sodir ZECHSTEIN GP,
https://factpages.sodir.no/en/strat/pageview/litho/groups/194, *Verbatim*, also
quoted in the Norwegian-shelf memo). Geluk 2000, "Late Permian (Zechstein)
carbonate-facies maps, the Netherlands", *Netherlands Journal of Geosciences* 79,
https://doi.org/10.1017/S0016774600021545, sits between them: "some local areas
of platform facies have existed … similar to the Ringkobing-Fyn and Mid North Sea
High" (*Verbatim*). **Inference:** "absent over the high" is a statement about
rock, "covered by a shallow carbonate sea" is a statement about water, and a
starved or eroded submarine swell satisfies both. The honest position is that the
Zechstein shoreline over these highs is **not settled by anything retrieved**, and
no operation may rest on either reading.

**Tampen Spur — a named island, with a named well.** Roberts et al. 2019
(§2.4), on the Base Cretaceous map: "the prediction that the crest of the
**Gullfaks** structure … **was emergent as an isolated island at this time**";
on the Top Lower Cretaceous map: "The other structural feature predicted as
emergent … is the NE part of the **Margarita Spur** … supported by the
stratigraphic sequence in Norwegian well 6201/11-1, located on the crest of the
structure, which shows Upper Cretaceous post-rift sediments unconformable upon
Triassic pre-rift, no Lower Cretaceous or Jurassic."

**Fladen Ground Spur — the one high with a *positive* emergence statement and a
flora.** Quirie, Schofield, Jolley, Archer, Hole, Hartley, Watson & Burgess 2020,
"Palaeogeographical evolution of the Rattray Volcanic Province, Central North
Sea", *Journal of the Geological Society* 177,
https://doi.org/10.1144/jgs2019-182 (*Verbatim* from the author-accepted
manuscript in an institutional repository; the published wording may differ
slightly): "we interpret that the **Fladen Ground Spur was likely a low-relief
topographic spur with flora dominated by gymnosperm (e.g. conifer forests)**
during the eruption of the RVM"; and "**The Fladen Ground Spur likely formed a
positive structure throughout the Jurassic** (Boldy & Brealey 1990)."

**Josephine High.** McArthur, Jolley, Hartley, Archer & Lawrence 2016,
"Palaeoecology of syn-rift topography: A Late Jurassic footwall island on the
Josephine Ridge, Central Graben, North Sea", *Palaeogeography,
Palaeoclimatology, Palaeoecology*,
https://doi.org/10.1016/j.palaeo.2016.06.033. **Snippet — title and metadata
confirmed at Crossref, the paper itself was not opened.** The title alone names a
Late Jurassic footwall island on this element; the memo uses it as a pointer, not
as a quotation.

**Jæren High — marine in the Ryazanian.** Janssen, Rogov & Zakharov 2022,
*Netherlands Journal of Geosciences* 101, https://doi.org/10.1017/njg.2022.5
(CC BY): "Ryazanian (Berriasian) macrofossils from three well cores in the
Central Graben … and **on the Jæren High (well 7/7-2, Norway)** … are described.
Macrofossils are mainly represented by buchiid bivalves (*Buchia volgensis*) and
ammonites." **Inference:** marine fossils on the high in the Ryazanian place at
least part of it under water inside bin `146-135`, which is a *check on* the
"emergent until the Campanian" reading and narrows the operation in §5.2 to the
younger bins.

**Crests bare through the Early Cretaceous.** Sodir CROMER KNOLL GP,
https://factpages.sodir.no/en/strat/pageview/litho/groups/23, *Verbatim*: "It is
absent from the highest parts of the **Mandal High, Jæren High, Utsira High and
Lomre Terrace** … and locally from the **Tampen Spur**." Sodir SHETLAND GP,
`.../groups/143`, *Verbatim*: "On structural highs like the **Horda Platform,
Tampen Spur, Sørvestlandet and Mandal Highs** the lower part of the group is
occasionally absent." Both are missing-section statements, so under this
program's own rule they corroborate relief without proving emergence.

**Sørvestlandet High.** Ineson, Bojesen-Koefoed, Dybkjær & Nielsen 2003,
*GEUS Bulletin* 1, https://doi.org/10.34194/geusb.v1.4679 (CC BY): "Rasmussen et
al. (1999) **postulated** that the siliciclastic source for this fan system was
the Sørvestlandet High" (*Verbatim*). That is a reported hypothesis about
provenance, not a statement of emergence — and this memo treats it as such.

**East Shetland Platform, a third and fourth reading.** Valore, Duffy, Jackson,
Fazlikhani & Bell 2023 (*EarthArXiv* preprint, https://doi.org/10.31223/x58680,
**not peer reviewed**; *Verbatim (preprint)*): "The East Shetland Platform …
**behaved as a structural high during most of the Mesozoic**"; "During this
'quiescent' tectonic setting, the present-day Shetland Platform was **potentially
completely flooded**" in the Late Cretaceous; and, for the Palaeocene, "a newly
described subaerial catchment … with characteristic mountainous hillslopes and
**>300 meters of relief**". **Inference, and it changes a verdict below:** a
preprint is weak evidence, but its Chalk statement agrees with [C]'s "the North
Sea and much of mainland Britain were submerged", so the `94-81` and `81-58`
shallow-marine readings over the platform are **defensible**, and [N]'s Campanian
sentence should not be stretched into a Chalk-age emergence claim.

**Siri Canyon, and the "Balder area".** Schiøler et al. 2007, "Lithostratigraphy
of the Palaeogene – Lower Neogene succession of the Danish North Sea",
*GEUS Bulletin* 12, https://doi.org/10.34194/geusb.v12.5249 (CC BY),
*Verbatim*: "the Siri Canyon system, **a depression in the top chalk surface**,
was fed from the Fennoscandian Shield in the north-east and north." So the Siri
Canyon is a submarine feature and shallow marine is the right sign for it
throughout. For "Balder": Sodir BALDER FM,
`https://factpages.sodir.no/en/strat/pageview/litho/formations/6`, *Verbatim* —
"The Balder Formation was deposited in a **deep marine setting**, mainly as
hemipelagic sediments." **Inference:** there is no "Balder High" in any dataset or
paper reached this session. In North Sea usage "Balder" is the Eocene Balder
Formation or the Balder field in block 25/11; the structural element under the
field is the **Heimdal Terrace**, and that is what §3 probes.

**A citation correction that a tracked memo needs.** The Utsira High paper is
**Riber, Dypvik & Sørlie 2015** (confirmed at Crossref for
https://doi.org/10.17850/njg95-1-04). Both
[palaeo-coastlines-norwegian-shelf-checks.md](palaeo-coastlines-norwegian-shelf-checks.md)
and an earlier draft of this memo write "Riber, Morgan & Aagaard 2015". The DOI,
title, journal, volume and pages are right; only the author list is wrong.

---

## 3. What the shipped map actually says at each element

**Measured**, two independent readings per cell:

- the **crest point** class set, at the pole of inaccessibility of §1.3; and
- the **modal class over the whole element**, on a 0.1° grid of points inside the
  polygon (0.03° for elements too small to catch six points at 0.1°), 4,931
  sample points in all across the 43 elements.

A cell shows one symbol where the two agree and the modal class holds at more
than 80 % of the element's points. Where they differ the cell is
`crest / modal`, and a trailing `?` on the modal class means the element is
internally mixed (modal share ≤ 80 %).

Symbols: **`L`** = `lm` only, olive land. **`s`** = `sm` only, teal shallow sea.
**`LS`** = both classes cover the point, and because land is drawn later and
higher this **renders as land**. **`.`** = neither shipped class, so the native
blue "Cao 2024 continental crust, depth unmapped" shelf shows through.

**Devonian to Triassic.**

| Element | 402-380 | 380-359 | 359-338 | 338-323 | 323-296 | 296-285 | 285-269 | 269-248 | 248-224 | 224-203 |
|---|---|---|---|---|---|---|---|---|---|---|
| East Shetland Platform | L | L | L | L | L | L | L | s / s? | L | L |
| Fladen Ground Spur | L | L | L | L | L | L | L | s | L | L |
| Unst Basin | L | L | L | L | L | L | L | L | L | L |
| East Shetland Basin | L | L | L | L | L | L | L | s | L | L |
| Tampen Spur | L | L | L / L? | L / L? | L | L | L | s / s? | L | L |
| Sogn Graben | L | L | L | L | L | L | L | L | L | L |
| Viking Graben (family) | L | L | . / L? | L | L | L | L | s / s? | L | L |
| Horda Platform (family) | L | L | L | L | L | L | L | L | L | L |
| Bjørgvin Arch | L | . / L? | L | L | L | L | L | L | L | L |
| Øygarden Fault Complex | L | L | L | L | L | L | L | L | L | L |
| Stord Basin | L | L | L | L | L | L | L | L | L | L |
| Utsira High | L | L | L | L | L | L | L | s | L | L |
| Gudrun Terrace | L | . / L? | L | L | L | L | L | s | L | L |
| Sleipner Terrace | L | . / L? | L | L | L | L | L | s | L | L |
| Heimdal Terrace (Balder) | L | . / .? | L | L | L | L | L | s / s? | L | L |
| Ling Depression | L | L | L | L | L | L | L | L / s? | L | L |
| Jæren High | L | L | s / s? | s | L | L | L | s | L | L |
| Sørvestlandet High | LS | L | s | s | L | L | L | s | L | L |
| Egersund Basin | LS | L | L / L? | L | L | L | L | s | L | L |
| Danish Norwegian Basin | L / LS? | L | s | L / L? | L | L | L | s / s? | L | L |
| Stavanger Platform | LS / LS? | L | L | L | L | L | L | L / L? | L | L |
| Sørlandet Platform | LS | L | L | L | L | L | L | L | L | L |
| Sele High | LS / LS? | L | L | L | L | L | L | s | L | L |
| Central Graben (family) | L / L? | L | s | s | L | L | L | s | L | L |
| Western Graben | L | . / L? | . | . / s? | L / L? | L | L | s | L | L |
| Forties-Montrose High | L | . / L? | . / .? | . / .? | . / L? | L | L | s | L | L |
| Josefine Ridge | L | L | s | s | L | L | L | s | L | L |
| Cod Terrace | L | L | s | s | L | L | L | s | L | L |
| Feda Graben | L / L? | L | s | s | L | L | L | s | L | L |
| Gertrud Graben | L / LS? | L | s | s | L | L | L | s | L | L |
| Mandal High | LS | L | s | s | L | L | L | s | L | L |
| Lindesnes Ridge | LS | . / L? | s | s | L | L | L | s | L | L |
| Auk Ridge | L / L? | L | s | s | s / s? | L | L | s | L | L |
| Argyll Horst | LS | L | s | s | s / s? | L | L | s | L | L |
| Søgne Basin | LS | L | s | s | L | L | L | s | L | L |
| Tail End Graben (NO) | L / L? | L | s | s | L | L | L | s | L | L |
| Horn Graben | LS / LS? | L | s | s / s? | L | L | L | s | L | L |
| Ringkøbing-Fyn High (DK) | L | L | s | s | L | L | L | s | L | L |
| Moray Firth Basin | L | L | s | L / s? | L | L | L | L / s? | L | L |
| Halibut Horst | L | L | L | L | L | L | L | L / L? | L | L |
| Andrew Ridge | L | . / L? | L / .? | L / .? | L / L? | L | L | s | L | L |
| Fisher Bank Basin | L | . / L? | . / .? | . / .? | . / L? | L | L | s | L | L |
| West Central Shelf | L / L? | L | s / s? | s | L / L? | L | L | s / s? | L | L |

**Early Jurassic to present, plus the lowstand state.**

| Element | 203-179 | 179-166 | 166-146 | 146-135 | 135-117 | 117-94 | 94-81 | 81-58 | 58-49 | 49-37 | 37-29 | 29-20 | 20-11 | 11-2 | lgm |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| East Shetland Platform | s | s / L? | LS / s? | s | s | s / s? | s | s | s / s? | s / s? | s | s / s? | s | s | . / .? |
| Fladen Ground Spur | s | L / .? | s | s | s | s | s | s | s | s | s | s | s | s | . |
| Unst Basin | s | L | LS / LS? | s | s | . / s? | s | s | L / s? | L / s? | s | s | s | s | . |
| East Shetland Basin | s | s | s | s | s | s | s | s | s | s | s | s | s | s | . |
| Tampen Spur | s | s | s | s | s | s | s | s | s | s | s | s | s | s | . |
| Sogn Graben | s | s | s | s | s | s | s | s | s | s | s | s | s | s | . |
| Viking Graben (family) | s | s / s? | s | s | s | s | s | s | s | s | s | s | s | s | . / .? |
| Horda Platform (family) | L / L? | s / L? | s | s | s | s | s | s | s | s | s | s | s | s | . / .? |
| Bjørgvin Arch | s / s? | L / s? | s | s | s | s | s | s | s | s | s | s | s | s | L / .? |
| Øygarden Fault Complex | L | . | LS / s? | L | L / s? | s | s | s | s | s | s | s | s / s? | s | . |
| Stord Basin | L | s / s? | s | s | s | s | s | s | s | s | s | s | s | s | . |
| Utsira High | s | L | LS / s? | s | s | s | s | s | s | s | s | s | s | s | L / L? |
| Gudrun Terrace | s | L | s / s? | s | s | s | s | s | s | s | s | s | s | s | L |
| Sleipner Terrace | s | L | LS | s | LS | s | s | s | s | s | s | s | s | s | L |
| Heimdal Terrace (Balder) | s | L | s | s | s | s | s | s | s | s | s | s | s | s | . / .? |
| Ling Depression | s | s / L? | s / s? | s | s | s | s | s | s | s | s | s | s | s | . / L? |
| Jæren High | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Sørvestlandet High | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Egersund Basin | s | s / s? | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Danish Norwegian Basin | s | L | s / s? | s | L / L? | s | s | s | s | s | s | s | s | s | L |
| Stavanger Platform | s / L? | L / L? | LS / LS? | s / s? | s | s | s | s | s | s | s | s | s / L? | s | . |
| Sørlandet Platform | L / L? | L | LS | L | L / s? | s | s / s? | s | L | L | s / s? | L / L? | L | L | L |
| Sele High | s | s / L? | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Central Graben (family) | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Western Graben | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Forties-Montrose High | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Josefine Ridge | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Cod Terrace | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Feda Graben | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Gertrud Graben | s | L | s / s? | LS / s? | s / s? | s | s | s | s | s | s | s | s | s | L |
| Mandal High | s | L | s / s? | s | s | s | s | s | s | s | s | s | s | s | L |
| Lindesnes Ridge | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Auk Ridge | s | . | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Argyll Horst | s | . | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Søgne Basin | s | L | LS / s? | s / s? | LS / LS? | s | s | s | s | s | s | s | s | s | L |
| Tail End Graben (NO) | s | L | LS | LS | LS | LS / LS? | s | s | s | s | s | s | s | s | L |
| Horn Graben | s | L | s | s | s / s? | s | s | s | s | s | s | s | s | s | L |
| Ringkøbing-Fyn High (DK) | s | L | LS | LS / s? | LS / s? | LS / s | s | s | s | s | s | s | s | s | L |
| Moray Firth Basin | s | L | s | L / s? | s | s | s | s | s | s | s | s | s | s | L |
| Halibut Horst | s | L | s | s | L / s? | s | s | s | s | s | s | s | s | s | L / .? |
| Andrew Ridge | s | L | s | s | LS / s? | s | s | s | s | s | s | s | s | s | L |
| Fisher Bank Basin | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| West Central Shelf | s | L / L? | s / s? | s | s | LS / s? | s | s | s / s? | s | s | s | s | s | L |

### 3.1 Continuity with the two companion memos

**Measured.** The same probe, at the points the earlier memos used, reproduces
their numbers exactly — the Utsira crest wells land-over-sea at `166-146` and
shallow marine from `146-135`; 25/6-1 already marine at `166-146`; the Viking
Graben land-over-sea at `166-146` on 2.5 °E but marine on 2.0 °E; the Shetland
Platform land at `58-49` and `49-37` where the contract edits it; the unedited
East Shetland Platform control at (0.5 °E, 61 °N) still shallow marine at `49-37`.
Nothing in this memo's method differs from theirs.

**Continuity points, Devonian to Triassic.**

| Point | 402-380 | 380-359 | 359-338 | 338-323 | 323-296 | 296-285 | 285-269 | 269-248 | 248-224 | 224-203 |
|---|---|---|---|---|---|---|---|---|---|---|
| 16/1-8 Edvard Grieg (2.2351, 58.8357) | L | L | L | L | L | L | L | s | L | L |
| 16/2-6 Johan Sverdrup (2.6152, 58.8237) | L | L | L | L | L | L | L | s | L | L |
| 25/6-1 north Utsira High (2.8006, 59.5256) | L | L | L | L | L | L | L | L | L | L |
| Auk Field position (2.07, 56.4) | L | L | s | s | s | L | L | s | L | L |
| Ekofisk (3.22, 56.55) | LS | L | s | s | L | L | L | s | L | L |
| Central North Sea (2.0, 57.0) | L | L | s | s | L | L | L | s | L | L |
| Southern North Sea (4.0, 54.0) | L | s | s | s | s | L | L | s | L | L |
| Viking Graben (2.0, 60.5) | L | L | . | L | L | L | L | s | L | L |
| Viking Graben (2.5, 60.5) | L | L | L | L | L | L | L | L | L | L |
| East Shetland Basin (1.5, 61.0) | L | L | L | L | L | L | L | s | L | L |
| Moray Firth (-2.0, 58.0) | L | L | L | L | L | L | L | L | L | L |
| Shetland Platform (-1.5, 60.5) | L | L | L | L | L | L | L | L | L | L |
| ESP control (0.5, 61.0) | L | L | L | L | L | L | L | L | L | L |

**Continuity points, Early Jurassic to present, plus the lowstand state.**

| Point | 203-179 | 179-166 | 166-146 | 146-135 | 135-117 | 117-94 | 94-81 | 81-58 | 58-49 | 49-37 | 37-29 | 29-20 | 20-11 | 11-2 | lgm |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 16/1-8 Edvard Grieg (2.2351, 58.8357) | s | L | LS | s | s | s | s | s | s | s | s | s | s | s | L |
| 16/2-6 Johan Sverdrup (2.6152, 58.8237) | s | L | LS | s | s | s | s | s | s | s | s | s | s | s | L |
| 25/6-1 north Utsira High (2.8006, 59.5256) | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Auk Field position (2.07, 56.4) | s | . | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Ekofisk (3.22, 56.55) | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Central North Sea (2.0, 57.0) | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Southern North Sea (4.0, 54.0) | s | L | s | s | LS | s | s | s | s | s | s | s | s | s | L |
| Viking Graben (2.0, 60.5) | s | L | s | s | s | s | s | s | s | s | s | s | s | s | L |
| Viking Graben (2.5, 60.5) | s | L | LS | s | s | s | s | s | s | s | s | s | s | s | L |
| East Shetland Basin (1.5, 61.0) | s | s | s | s | s | s | s | s | s | s | s | s | s | s | . |
| Moray Firth (-2.0, 58.0) | s | L | s | s | L | . | s | s | LS | L | L | L | s | s | L |
| Shetland Platform (-1.5, 60.5) | s | L | LS | L | L | . | L | s | L | L | L | L | s | L | L |
| ESP control (0.5, 61.0) | s | L | s | s | s | s | s | s | s | s | s | s | s | s | . |

### 3.2 The pattern, read off the matrix

**Measured, and this is the headline.** Across the twelve intervals from
`166-146` to `11-2` — 164 Myr — **27 of the 43 elements carry the shallow-marine
class and nothing else at every single one of them**, and the 27 include almost
every named high: Tampen Spur, Jæren High, Sørvestlandet High, Fladen Ground
Spur, Forties-Montrose High, Josefine Ridge, Sele High, Auk Ridge, Argyll Horst,
Mandal High, Lindesnes Ridge, Bjørgvin Arch, Cod Terrace, Gudrun Terrace,
Heimdal Terrace and the Horda Platform family, alongside the Viking Graben, the
Central Graben, the Sogn Graben, the Stord Basin, the East Shetland Basin, the
Ling Depression, the Feda and Horn grabens, the Egersund Basin and the Fisher
Bank Basin. **High and graben carry the same class at every age. There is no
archipelago on this map, and after the Middle Jurassic there is no structural
relief of any kind.**

The sixteen elements that do break `sm` somewhere in that span break it in only
five ways, none of which is a footwall island:

1. the **Ringkøbing-Fyn High** and its neighbours the **Tail End Graben**,
   **Søgne Basin** and **Gertrud Graben**, which render as *land* between
   `166-146` and `117-94` — and three of those four are grabens;
2. the **Sørlandet Platform** and the **Danish Norwegian Basin** crest, both of
   which are onshore or coastal southern Norway and Jutland, where land is
   correct;
3. the **Moray Firth Basin**, **Halibut Horst**, **Unst Basin** and **Øygarden
   Fault Complex** margin points, where the Scottish/Shetland land mass, the
   Norwegian coast, and the contract's own Palaeocene–Eocene operations put the
   land;
4. the four elements that carry *both* classes at `166-146` — East Shetland
   Platform, Utsira High, Stavanger Platform, Sleipner Terrace — which is Cao's
   own overlapping geometry, not relief the model asserts;
5. single-interval `lm`/`sm` overlaps at `135-117` and `117-94` on the Andrew
   Ridge, Sleipner Terrace, Søgne Basin and West Central Shelf.

**Measured, the one interval that does discriminate.** `179-166` is the Middle
Jurassic dome, and the map handles it well: land over the Central Graben family,
the Western Graben, the Forties-Montrose High, the Jæren High, the Sørvestlandet
High, the Utsira High, the Feda/Gertrud/Horn grabens, the Søgne Basin, the
Ringkøbing-Fyn High, the Moray Firth Basin, the Halibut Horst and the Fisher Bank
Basin, against shallow sea over the Tampen Spur, the Sogn Graben, the East
Shetland Basin and the Stord Basin. That is the dome and the Brent delta, and it
is the interval the existing contract already edits. Two anomalies sit inside it:
the **Auk Ridge** and the **Argyll Horst** come back `neither`, and the **Fladen
Ground Spur** is land at its crest but dominantly `neither` over the element.
Those are the withheld mountain class again, in a third and fourth location after
the formation-checks memo's Horda Platform instance and the Norwegian-shelf
memo's mid-Norwegian instance.

**Measured, a caution about one row.** The `danish-norwegian-basin` crest at
(9.267 °E, 56.464 °N) is the pole of inaccessibility of the level-2 *residual*
polygon, which reaches onshore Jutland. Its `L` readings at `179-166`, `135-117`
and in the Palaeozoic are land in Denmark and are **correct**; they are not
evidence about the offshore basin. The Norwegian–Danish Basin failures recorded
by the Norwegian-shelf memo are at (7.0 °E, 56.8 °N) and (8.0 °E, 56.5 °N) and
stand unchanged.

### 3.3 Crest against adjacent basin, at the intervals that matter

**Measured.** The test the brief asked for, stated as pairs. `=` means the
element and the basin beside it carry the *same* class, so the map draws no
relief between them.

| High | Adjacent basin | `166-146` | `146-135` | `135-117` | `117-94` | `94-81` | `81-58` |
|---|---|---|---|---|---|---|---|
| Tampen Spur | Viking Graben | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Tampen Spur | Sogn Graben | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Utsira High | Viking Graben | **`LS`** vs `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Utsira High | Ling Depression | `LS` vs `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Jæren High | Central Graben | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Sørvestlandet High | Central Graben | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Forties-Montrose High | Western Graben | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Forties-Montrose High | Fisher Bank Basin | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Josefine Ridge | Feda Graben | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Fladen Ground Spur | East Shetland Basin | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| East Shetland Platform | East Shetland Basin | **`LS`** vs `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` | `s` = `s` |
| Ringkøbing-Fyn High | Tail End Graben | `LS` = **`LS`** | `LS` = **`LS`** | `LS` = **`LS`** | `LS` = **`LS`** | `s` = `s` | `s` = `s` |
| Halibut Horst | Moray Firth Basin | `s` = `s` | `s` vs **`L`** | **`L`** vs `s` | `s` = `s` | `s` = `s` | `s` = `s` |

**Inference.** Two of the thirteen pairs show relief in the right direction and
only at one interval: the Utsira High and the East Shetland Platform stand above
their basins at `166-146`, and that is Cao's own geometry, not an edit. One pair
shows relief in the *wrong* direction — the Ringkøbing-Fyn High row is land at
four intervals, but so is the Tail End Graben beside it, which Sodir's own
attribute table calls a "Deep Cretaceous Basin" and which is the depocentre of the
Danish Central Graben. Every other pair is flat.

### 3.4 The Mid North Sea High and the rest of the UK sector

**Measured**, the same two readings as §3, over the NSTA polygons of §1.4.
`n` is the number of 0.1° grid points inside the element.

| Element (NSTA) | n | 296-285 | 285-269 | 269-248 | 248-224 | 224-203 | 203-179 | 179-166 | 166-146 | 146-135 | 135-117 | 117-94 | 94-81 | 81-58 |
|---|---:|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Mid North Sea High Area | 564 | `L` | `L` | `s`? | `L` | `L` | `s` | **`.`**? | `s`? | `s`? | `s`? | `s` | `s` | `s` |
| Forth Approaches Basin | 226 | `L` | `L` | `s`? | `L` | `L` | `s` | `L` | `LS` | `L` | `L`? | `s` | `s` | `s` |
| East Shetland Platform Area | 481 | `L` | `L` | `s`? | `L` | `L` | `s` | `L`? | `LS`? | `s`? | `s`? | `s`? | `s` | `s` |
| Moray Firth Basin | 559 | `L` | `L` | `L`? | `L` | `L` | `s` | `L` | `s` | `s`? | `s`? | `s`? | `s` | `s` |
| Fladen Ground Spur | 84 | `L` | `L` | `s` | `L` | `L` | `s` | `L`? | `s` | `s` | `s` | `s` | `s` | `s` |
| North Viking Graben | 23 | `L` | `L` | `s` | `L` | `L` | `s` | `L`? | `s` | `s` | `s` | `s` | `s` | `s` |
| South Viking Graben | 67 | `L` | `L` | `s` | `L` | `L` | `s` | `L` | `s` | `s` | `s` | `s` | `s` | `s` |
| Inner Moray Firth Basin | 171 | `L` | `L` | `L` | `L` | `L` | `s` | `L` | `s` | `s`? | `s`? | **`.`** | `s`? | `s` |
| Jaeren High (UK part) | 21 | `L` | `L` | `s` | `L` | `L` | `s` | `L` | `s` | `s` | `s`? | `s` | `s` | `s` |
| Montrose High | 10 | `L` | `L` | `s` | `L` | `L` | `s` | `L` | `s` | `s` | `s` | `s` | `s` | `s` |
| Forties High | 8 | `L` | `L` | `s` | `L` | `L` | `s` | `L` | `s` | `s` | `s` | `s` | `s` | `s` |
| Buchan/Glenn Horst | 9 | `L` | `L` | `s` | `L` | `L` | `s` | `L` | `s` | `s` | `s` | `s` | `s` | `s` |
| Witch Ground Graben | 91 | `L` | `L` | `s` | `L` | `L` | `s` | `L` | `s` | `s` | `s` | `s` | `s` | `s` |
| Halibut Horst | 33 | `L` | `L` | `L` | `L` | `L` | `s` | `L` | `s` | `s` | `s`? | `s` | `s` | `s` |
| Unst Basin | 81 | `L` | `L` | `L` | `L` | `L` | `s` | `L` | `LS`? | `s` | `s` | **`.`**? | `s` | `s` |
| East Shetland Basin | 108 | `L` | `L` | `s` | `L` | `L` | `s` | `s` | `s` | `s` | `s` | `s` | `s` | `s` |

**The Mid North Sea High in full, Measured** — 564 points, every interval, exact
counts, because this element carries the memo's largest proposed operation:

| Interval | Counts over the NSTA polygon |
|---|---|
| `402-380` | `lm`+`sm` 360, `lm` 204 — land everywhere |
| `380-359` | `lm` 564 |
| `359-338` | `sm` 232, `lm` 188, `neither` 127, `lm`+`sm` 17 |
| `338-323` | `sm` 518, `neither` 46 |
| `323-296` | `sm` 492, `neither` 52, `lm` 15, `lm`+`sm` 5 |
| **`296-285`** | **`lm` 555**, `neither` 9 |
| **`285-269`** | **`lm` 544**, `neither` 20 |
| **`269-248`** | `sm` 344, `lm` 209, `lm`+`sm` 11 |
| `248-224` | `lm` 564 |
| `224-203` | `lm` 564 |
| `203-179` | `sm` 564 |
| **`179-166`** | **`neither` 305**, `lm` 259 |
| **`166-146`** | `sm` 317, `lm`+`sm` 247 |
| **`146-135`** | `sm` 335, `lm` 229 |
| **`135-117`** | `sm` 349, `lm` 212, `lm`+`sm` 3 |
| `117-94` | `sm` 464, `lm` 64, `lm`+`sm` 36 |
| `94-81` | `sm` 564 |
| `81-58` | `sm` 564 |
| `58-49` | `lm`+`sm` 286, `sm` 278 |
| `49-37` … `11-2` | `sm` 369 → 557 as the series runs young; the `lm` remainder is England |
| `lgm` | `lm` 564 — the Doggerland lowstand state |

**And the outline is contested — three sources, three answers.** This is the one
element in the memo where the *position* is less certain than the *timing*:

- **NSTA / BGS-DECC**: −2.40, 54.67, 3.40, 57.17, centre (0.373, 55.763).
- **EGDI / NAGTEC**, whose own source string is "BGS reports and Ziegler (1990)":
  −1.66, 53.76, 4.41, 56.64, centre (1.350, 55.399). The two differ by up to ~1°.
- **A published quadrant extent**, and it is the most useful of the three.
  Monaghan, A.A. and the Project Team 2015, *Palaeozoic Petroleum Systems of the
  Central North Sea/Mid North Sea High*, British Geological Survey Commissioned
  Report CR/15/124, https://nora.nerc.ac.uk/id/eprint/516766/1/CR15124.pdf,
  **read this session**, states *Verbatim*: "**The Permian Mid North Sea High
  dividing the Southern and Northern Permian Basins is situated in Quadrants
  35–39** and the Rotliegend is largely absent across this area (Figure 17)."
  **Measured** from the NSTA licensed quadrant geometry, UKCS quadrants 35–39
  span **1.00 °W to 4.00 °E, 55.00 to 56.00 °N**.

**And the same report says the high is not one feature.** *Verbatim*: "On the
**Devonian–Carboniferous Mid North Sea High (Quadrants 34-36)**, data is very
sparse with an attenuated lower Carboniferous and thick upper Devonian sequences
interpreted to be present." So the Permian high (Q35–39, 1 °W–4 °E) and the
Devono-Carboniferous high (Q34–36, 2 °W–1 °E) are **offset from each other by
about two degrees of longitude**. Any operation must name which one it draws.

**Inference.** The quadrant statement is the only extent in the set that is both
published as text and convertible to numbers without reading a figure, and it
lands almost exactly on the offshore band probed below. This memo therefore
treats **UKCS quadrants 35–39 as the Permian Mid North Sea High** and the NSTA
polygon as a wider "area" that includes English coastal ground.

**A cross-check on the offshore part only, Measured.** Because the NSTA polygon
reaches onshore north-east England at −2.4 °E, a separate 6 × 4 grid was probed
over the offshore band (longitudes −1, 0, 1, 2, 3, 4 °E; latitudes 54.8, 55.0,
55.5, 56.0 °N), 24 points: `lm` 24/24 at `296-285` and at `285-269`; `sm` 21 and
`lm` 3 at `269-248`, the three land points being against the English coast;
`lm` 24/24 at `248-224` and `224-203`; `sm` 24/24 at `203-179`; `lm` 13 and
`neither` 11 at `179-166`; `sm` 19 and `lm`+`sm` 5 at `166-146`; `sm` 21 and
`lm` 3 at `146-135`; `sm` 21 at `135-117`; `sm` 24/24 at `94-81` and `81-58`;
`lm` 24/24 at `lgm`. **The offshore band and the NSTA polygon agree everywhere it
matters**; the difference between them is England.

**Verdict for the Mid North Sea High, and it splits cleanly.**

- **PASS** on the Early Permian barrier: land at 555/564 and 544/564 at `296-285`
  and `285-269`, which is what "newly emergent Mid North Sea High" requires ([S]).
- **Contested** at `269-248`: the map is dominantly shallow sea, which [S] and
  [C] support and Sodir's ZECHSTEIN GP contradicts (§2.8). No operation.
- **PASS** on the Triassic: land at 564/564 at both bins, compatible with "a
  relatively low topographic feature … partly mantled by thin Triassic deposits".
- **FAIL, compiler scope,** at `179-166`: **305 of 564 points render as unmapped
  crust**, so the Middle Jurassic dome over the Mid North Sea High is not drawn as
  land at all but as blue "depth unmapped" shelf. This is the same symptom the
  formation-checks memo diagnosed as the withheld mountain class over the Horda
  Platform, in the largest patch yet found inside this window; **it was not traced
  back to the pinned archive here**, so it is consistent with that diagnosis, not
  proof of it.
- **FAIL** at `166-146`, `146-135` and `135-117`: shallow marine over most of the
  high, against Callomon 2003's "the emergent Central North Sea Dome", Johannessen
  2003's "large positive area" through Bajocian–Kimmeridgian, Møller & Rasmussen
  2003's "with the exception of marginal areas of the Ringkøbing–Fyn High and the
  Mid North Sea High", and [S]'s "submerged for the first time" in the
  Aptian–Albian.
- **PASS** from `117-94` on: the Aptian–Albian submergence falls in `117-94`, and
  the map is shallow sea there and afterwards.

**The internal tension in [S] that must be stated.** The same report says the
high was "inundated by the first of the Zechstein transgressions" and, 200 pages
later, that it "was submerged for the first time" in the Aptian–Albian. Read
charitably the second means *for the first time since the Permian*, which is the
only reading consistent with the report's own Triassic and Jurassic chapters and
with Callomon, Johannessen and Møller & Rasmussen. This memo adopts that reading
and says so rather than quoting one sentence and hiding the other.

**Two other UK-sector readings worth recording.**

- The **Fladen Ground Spur** on the NSTA outline is `sm` at `203-179`, `166-146`
  and every interval after, and `lm` (modal, mixed) at `179-166`. Quirie et al.
  2020 have it "a positive structure throughout the Jurassic" and a forested
  low-relief spur. At 43.9 km inscribed it is **above** the class floor, so unlike
  the Sodir rendering this is an actionable mismatch — see §5.2 operation E.
- The **Inner Moray Firth Basin** and the **Unst Basin** each return a patch of
  `neither` at `117-94`, and the **Forth Approaches Basin** renders as land at
  `146-135` and `135-117`. Neither was pursued: the Forth Approaches land is the
  Scottish landmass reaching offshore, and the two `neither` patches are the same
  unmapped-crust question as the Mid North Sea High's.

---

## 4. Verdict, one row per element

**How to read it.** *Passing* lists the Cao intervals where the shipped class
matches what §2 requires. *Failing* lists the intervals where it does not, and
for which a source in §2 states the opposite. *Limitation* records the reason a
failure must **not** become an operation — almost always the inscribed diameter
from §1.3 against Cao's ~30 km tolerance, sometimes a bin coarser than the event.
Intervals in which no retrieved source constrains the element are simply absent
from both lists; silence here is "untested", never "pass".

| Element | ⌀ km | Passing | Failing | Limitation |
|---|---:|---|---|---|
| **East Shetland Platform** | 123.8 | `402-380`…`323-296`, `248-224`, `224-203`, `58-49`, `49-37`, `37-29`…`11-2` | `179-166` **south of 60.2 °N** (`s` at the element's own crest, outside the existing operation's rectangle); `166-146`…`94-81` (`s`, against [N] "only the uppermost Upper Cretaceous strata (Campanian to Danian) encroached significantly on to the East Shetland Platform"). Also `269-248` and `203-179` (`s`) if [N]'s "Permian, Triassic and Jurassic strata are generally absent across the East Shetland Platform" is read as emergence — **this memo declines that reading**: absence of section is not a land surface, the same rule the Norwegian-shelf memo applied to the Nordland Ridge. | none of size — the element is 124 km across and well above the floor. The limit is evidential, not geometric: only the Late Jurassic and the Palaeogene carry a positive statement of uplift and sediment supply. |
| **Fladen Ground Spur** | **22.0** (Sodir) | `402-380`…`224-203`, `179-166` (`L`), `94-81`…`11-2` | `203-179` and `166-146` (`s`, against Quirie et al. 2020 "The Fladen Ground Spur likely formed a **positive structure throughout the Jurassic**" and "a low-relief topographic spur with flora dominated by gymnosperm (e.g. conifer forests)") | **below the floor as Sodir maps it** — but note that Sodir's 1,250 km² "Falden Ground Spur" is much smaller than the feature [N] describes as "the southern extension of the East Shetland Platform". The size verdict is on Sodir's rendering; a UK-sector outline could change it. Record, do not edit, and say which polygon was measured. |
| **Unst Basin** | **15.1** | `203-179` (`s`, and [N] has Brent Group preserved here) | `179-166` (`L`, but [N] and the Middle Jurassic memo have a *marine* downfaulted basin inside the emergent platform); `58-49`, `49-37` (`L`, inside the Shetland Platform operation) | **below the floor.** The Middle Jurassic memo already declared the Unst Basin an over-claim the operation cannot avoid at this resolution. |
| **East Shetland Basin** | 37.2 | the whole series (`s` from `203-179` on, `L` before) | — | — |
| **Tampen Spur** | **28.7** | `402-380`…`224-203`, `203-179`, `81-58`…`11-2` | `166-146`, `146-135`, `135-117`, `117-94` (`s`, against Roberts et al. 2019: "emergent island chains along the footwalls of all of the major faults" at 155 Ma, "numerous isolated footwall islands" at 140 Ma, "the crest of the Gullfaks structure … was emergent as an isolated island", and the NE Margarita Spur still emergent at 98.9 Ma on well 6201/11-1) | **at the floor,** 28.7 km, and [N] adds that the islands "were short lived". The named islands — Gullfaks, NE Margarita Spur — are single fault blocks, an order of magnitude below the floor. Record, do not edit. |
| **Sogn Graben** | **17.6** | the whole series | — | below the floor, but it is a graben and marine is the right class throughout. |
| **Viking Graben (family)** | 84.1 | the whole series | — | the `166-146` land-over-sea failure at (2.5 °E, 60.5 °N) is already owned by the formation-checks memo and is not re-proposed here. |
| **Horda Platform (family)** | 91.2 | `402-380`…`224-203`, `166-146`…`11-2` | — | the `179-166` `neither` at the Øygarden crest is the withheld mountain class, not a geometry defect. |
| **Bjørgvin Arch** | **19.6** | the whole series | — | below the floor. |
| **Øygarden Fault Complex** | **17.4** | most of the series | `179-166` renders as unmapped crust (`neither`) | below the floor; and the `neither` is the mountain-class gap, a compiler-scope item. |
| **Stord Basin** | 69.9 | the whole series | — | — |
| **Utsira High** | 36.7 | `296-285`, `285-269` (`L`), `269-248` (`s`, and Stemmerik et al. 2023 document Zechstein carbonates *on* the high), `248-224`, `224-203` (`L`), `179-166` (`L`), `166-146` (`LS` → land, matching Riber et al. 2015 "subaerial exposure of the high through latest Jurassic time"), `146-135`…`11-2` (`s`, matching "the definitive end of subaerial exposure") | `203-179` (`s` over the whole high, where Riber et al. preserve the Lower Jurassic only "on the northernmost part … (well 25/6–1)") | the emergent crest at `203-179` is 25–40 km across. **Already recorded as a limitation by the Norwegian-shelf memo; unchanged.** |
| **Gudrun / Sleipner / Heimdal terraces** | 18.1 / 9.8 / 19.5 | `179-166` `L` with the dome; `s` thereafter | — | far below the floor. The Balder field sits on the Heimdal Terrace; there is no "Balder" structural element to test. |
| **Ling Depression** | **24.8** | the whole series | — | below the floor. |
| **Jæren High** | **47.2** | `296-285`…`224-203`, `179-166` (`L`, and [C] "A major unconformity at base-Cretaceous level also cuts out Jurassic strata from a large part of the Jæren High"), `146-135` (`s`, and Janssen et al. 2022 describe Ryazanian *Buchia* and ammonites in well 7/7-2 **on** the high), `81-58`…`11-2` | **`94-81`** (`s`, against [C] "Chalk sedimentation extended over the Jæren High, probably during the early Campanian" and "these intrabasinal upland areas were not submerged until much later in the Cretaceous"); `135-117` and `117-94` on the same statement, corroborated by Sodir CROMER KNOLL GP "absent from the highest parts of the Mandal High, Jæren High, Utsira High and Lomre Terrace" | **none for `94-81`** — 47 km inscribed, the second-largest discrete high in the test. The Ryazanian fossils cap the operation at the young end of `146-135`, so the op is `135-117` onwards, not the whole Late Jurassic. |
| **Sørvestlandet High** | 37.9 | `296-285`…`224-203`, `179-166` (`L`), `81-58`…`11-2` | `166-146`…`94-81` (`s`) | the only statement that names it is Ineson et al. 2003 reporting that "Rasmussen et al. (1999) **postulated** that the siliciclastic source for this fan system was the Sørvestlandet High" — a reported hypothesis about provenance, not a claim of emergence. **And the polygon itself is doubtful:** well 2/2-1, which the NPD CO2 Storage Atlas describes as "located on the Sørvestlandet High", falls ~3.8 km **outside** the Sodir polygon, and widening to the `SVES` family does not fix it. **Not enough for an operation, on either count.** |
| **Egersund Basin** | 49.0 | the whole series except the two already-recorded rows | `166-146`, `146-135` land-over-sea / land — **already recorded** by the formation-checks and Norwegian-shelf memos, op already proposed | — |
| **Danish Norwegian Basin** | 93.5 | the Palaeozoic and Triassic | `146-135`, `135-117` at (7.0 °E, 56.8 °N) and (8.0 °E, 56.5 °N) — **already recorded** by the Norwegian-shelf memo | the level-2 crest used here is onshore Jutland; its `L` values are correct and are not evidence. |
| **Stavanger Platform** | 70.2 | the whole series; `166-146` `LS` → land is consistent with a platform east of the rift | — | — |
| **Sørlandet Platform** | 37.7 | the whole series — onshore southern Norway | — | — |
| **Sele High** | **20.4** | the whole series | — | below the floor. |
| **Central Graben (family)** | 76.0 | the whole series | — | marine from `166-146` on, which is right for a graben. |
| **Western Graben** | **29.9** | the whole series | — | at the floor. |
| **Forties-Montrose High** | **18.0** | `296-285`…`224-203`, `179-166` (`L`), `81-58` (`s`, and [C] puts its first submergence in the late Campanian–Maastrichtian Tor Formation, inside this bin) | **`94-81`** (`s`, against [C] "was deposited when a further rise in sea level submerged the Forties-Montrose High … for the first time" — late Campanian is younger than 81 Ma, so the high was emergent through the whole bin); `166-146`…`117-94` likewise | **below the floor,** 18.0 km inscribed, and the wider search found **no source that names this element in the Middle Jurassic**. The sourced Late Cretaceous claim is the strongest in the memo and the geometry is the weakest. Record as a limitation; see §5.3. |
| **Josefine Ridge (Josephine High)** | **13.1** | `179-166` `L`; `s` elsewhere | `166-146` (`s`), against a paper whose **title** is "A Late Jurassic footwall island on the Josephine Ridge, Central Graben, North Sea" (McArthur et al. 2016, https://doi.org/10.1016/j.palaeo.2016.06.033) — *Snippet*, the paper was not opened | **far below the floor,** 13.1 km. A named, published Late Jurassic island that this model cannot draw: the clearest single illustration of the resolution gap. |
| **Cod Terrace / Feda Graben / Gertrud Graben / Mandal High / Lindesnes Ridge / Auk Ridge / Argyll Horst / Andrew Ridge / Halibut Horst / Fisher Bank Basin** | 5.9–26.5 | `179-166` and the Palaeozoic/Triassic land bins | the Late Jurassic–Cretaceous archipelago rows, collectively | **all below the floor.** Ten elements, none of which can carry its own coastline at Cao's resolution. Auk Ridge and Argyll Horst additionally render as `neither` at `179-166` (withheld mountain class). |
| **Søgne Basin** | **23.4** | `94-81`…`11-2` | `166-146`, `135-117` render as land (`LS`) over a Late Jurassic deep basin | below the floor as an addition, but the failure is a *removal* case — see the Tail End Graben row. |
| **Tail End Graben** (Norwegian tip only) | **11.7** | `94-81`…`11-2` | **`166-146`, `146-135`, `135-117`, `117-94` all render as land**, over the depocentre of the Danish Central Graben, which Sodir's own attribute table types as a "Deep Cretaceous Basin" and where the Farsund Formation is "present throughout the Central Graben" (Sodir FARSUND FM, `/formations/39`, *Verbatim*) | **the polygon is truncated in the source, not by our query.** Two of its 25 vertices sit exactly on 56.000 °N, and the EGDI/NAGTEC rendering — from the same NPD shapefile — returns an identical bbox, so the Danish body of the graben is absent from both. Japsen, Britze & Andersen 2003, "Upper Jurassic – Lower Cretaceous of the Danish Central Graben: structural framework and nomenclature", *GEUS Bulletin* 1, https://doi.org/10.34194/geusb.v1.4653 (CC BY), state it "**stretches over a length of about 90 km**"; the Sodir polygon is its northern tip. The removal in §5.2 is stated in words over the whole depocentre, **not** taken from this polygon. |
| **Horn Graben** | 79.5 | the whole series | — | — |
| **Ringkøbing-Fyn High (Danish part)** | 40.6 | `296-285`, `285-269` (`L`, the emergent Early Permian barrier); `203-179` (`s`, and Michelsen et al. 2003 "acted as a **submarine** intra-basinal high during the Early Jurassic"); `179-166` and `166-146` (`L` / `LS`→land, and Michelsen et al. 2003 "**emergent throughout Middle and Late Jurassic times**"); `146-135` (`LS`→land, and Nielsen 2003 "a low-relief paralic hinterland that still supplied small amounts of sand to the basin **until the Ryazanian**"); `94-81`…`11-2` (`s`) | **`248-224`** (`L`, against Nielsen 2003 "the Vinding Formation is similarly developed indicating that **the high was submerged at this time**"); `117-94` (`LS`→land, with no source after the Ryazanian) | `224-203` holds both an early-Rhaetian exposure and a latest-Rhaetian flooding in one bin and is **unrepresentable**, like the Auk/Zechstein case. The `269-248` Zechstein reading is **contested** (§2.8) and no operation may rest on it. The Sodir polygon stops at 8.87 °E and is the Danish part only. |
| **Moray Firth Basin (fragment)** | 38.1 | `269-248` (`L`, the contract's own Zechstein operation), the rest of the series | — | the Sodir polygon is a fragment; the Inner/Outer division the brief names does not exist in any licensed dataset reached this session. |
| **West Central Shelf** | 102.6 | the whole series | `166-146`…`94-81` under [C]'s "parts of the West Central Shelf" base-Cretaceous unconformity | the [C] statement is about *Jurassic strata cut out*, i.e. non-deposition or erosion, not about a proven land surface. **The Norwegian-shelf memo's rule applies: hiatus is not emergence.** No operation. |
| **Mid North Sea High** *(NSTA "Mid North Sea High Area")* | 96.3 | `296-285`, `285-269` (`lm` 555/564 and 544/564, the emergent barrier); `248-224`, `224-203` (`lm` 564/564); `117-94`…`81-58` (`sm`, the Aptian–Albian submergence and after) | **`166-146`, `146-135`, `135-117`** (dominantly `sm`, against Callomon 2003, Johannessen 2003, Møller & Rasmussen 2003 and [S]'s "submerged for the first time" in the Aptian–Albian); and **`179-166`, where 305 of 564 points render as unmapped crust** | size is not the obstacle — 96 km inscribed. The NSTA layer is a *generic* UKCS partition that reaches onshore England, so an operation must be clipped offshore and must leave the Central Graben corridor marine. `269-248` is contested (§2.8). The `179-166` hole is compiler scope. |
| **Siri Canyon** *(no licensed geometry and no published coordinate found)* | n/a | `58-49` and after (`s`) | — | absent from the Sodir layer, from both NSTA layers and from EGDI/NAGTEC; GEUS publishes no Danish structural-element vector layer (its one candidate service returns HTTP 500). The only recovered facts are that it is NE–SW oriented, in the Danish North Sea, "a depression in the top chalk surface" (Schiøler et al. 2007), and hosts the Siri and Nini fields. **No coordinate is given, because none could be sourced without reading a figure.** Shallow marine is the right sign for a submarine canyon; there is nothing to edit. |
| **Forth Approaches Basin** *(NSTA)* | 64.9 | the Palaeozoic and Triassic land bins; `203-179` (`s`); `117-94`…`11-2` | `146-135`, `135-117` render as **land** | the basin is the offshore continuation of the Midland Valley ([C]) and abuts the Scottish coast; the land at those two intervals is the Scottish landmass reaching offshore, not a claim about the basin. **Untested** — nothing retrieved constrains the Forth Approaches Basin in the Mesozoic. |
| **Midland Valley of Scotland** *(not in any dataset reached)* | n/a | — | — | onshore Scotland; the ground is already owned by the `179-166` Scottish-landmass operation. Untested here. |

---

## 5. Consequence

### 5.1 Witnesses to add

Positions, intervals and **expected class sets as measured here**, so adding a
row as written locks in today's behaviour. Rows marked *after the fix* must be
added only once the corresponding operation lands, or they lock in the defect.
`WITNESS_INTERVALS` in `scripts/research/palaeo_coastlines_correction.py` is
presently `("402-380", "269-248", "248-224", "94-81")`; the two companion memos
already ask for `179-166`, `166-146`, `58-49`, `146-135` and `135-117`, and this
memo adds only `117-94` to that list.

| Witness id | Position (lon, lat) | Interval | Expected classes | Why it must not drift |
|---|---|---|---|---|
| `ringkobing-fyn-permian-barrier` | (4.874, 56.243) | `285-269` | `["lm"]` | the emergent Early Permian high that separated the Northern and Southern Permian basins ([S], [C], Arfai et al. 2014); the whole Rotliegend basin geometry rests on it. `285-269` is not in the present witness tuple, so this row needs the extension the companion memos already request. |
| `ringkobing-fyn-early-jurassic-submarine` | (4.874, 56.243) | `203-179` | `["sm"]` | Michelsen et al. 2003, "acted as a submarine intra-basinal high during the Early Jurassic". A rare case where the map is right for a *cited* reason and could be broken by a well-meant "highs are land" edit. |
| `ringkobing-fyn-late-jurassic-emergent` | (4.874, 56.243) | `166-146` | `["lm","sm"]` | Michelsen et al. 2003, "emergent throughout Middle and Late Jurassic times". The class-set form is required: an `sm`-membership test would not notice the land going away. |
| `mid-north-sea-high-permian-barrier` | (1.0, 55.0) | `285-269` | `["lm"]` | the same barrier, 400 km west, on the offshore part of the NSTA Mid North Sea High Area |
| `mid-north-sea-high-aptian-albian` | (1.0, 55.0) | `117-94` | `["sm"]` | [S]'s "submerged for the first time" in the Aptian–Albian; this is the young end of a proposed operation and must not creep younger |
| `utsira-high-zechstein` | (2.533, 58.807) | `269-248` | `["sm"]` | the Sodir-polygon crest of the Utsira High, marine in the Zechstein bin, agreeing with Stemmerik et al. 2023; `269-248` is already a witness interval, so this row is free |
| `jaeren-high-chalk-sea` | (2.415, 57.612) | `94-81` | `["sm"]` today; `["lm"]` or `["lm","sm"]` **after the fix** | the clearest sourced mismatch in the memo ([C], early Campanian submergence). `94-81` is already a witness interval. Add the current value now as a drift detector and change it with the operation. |
| `jaeren-high-ryazanian-marine` | (2.415, 57.612) | `146-135` | `["sm"]` | Janssen et al. 2022's Ryazanian macrofossils in well 7/7-2 **on** the high. This row is the *stop* on the proposed operation: it must not be extended back into `146-135`. |
| `forties-montrose-high-chalk-sea` | (1.311, 57.471) | `94-81` | `["sm"]` | the same event at an element **below** the class floor: the row exists to record that the mismatch is known and deliberately unedited |
| `central-graben-axis-chalk` | (1.611, 57.079) | `94-81` | `["sm"]` | the negative control for both rows above — the graben must stay marine whatever happens to the highs |
| `tail-end-graben-late-jurassic` | (4.492, 56.091) | `166-146` | `["lm","sm"]` today; `["sm"]` **after the fix** | the Danish Central Graben depocentre currently renders as land through Farsund Formation time |
| `east-shetland-platform-crest-mid-jurassic` | (0.200, 59.625) | `179-166` | `["sm"]` today | the platform's own crest, 0.6° south of the existing operation's rectangle. The existing `east-shetland-platform` witness at (0.0, 61.0) does **not** cover it. |
| `east-shetland-platform-chalk` | (0.200, 59.625) | `94-81` | `["sm"]` | Valore et al. 2023 (preprint) and [C] both have the platform flooded in the Chalk; this row stops operation B being extended into the Late Cretaceous |
| `fladen-ground-spur-late-jurassic` | (0.854, 58.918) | `166-146` | `["sm"]` today; `["lm"]` or `["lm","sm"]` **after the fix** | the NSTA crest of the spur, where Quirie et al. 2020 have a positive structure throughout the Jurassic. The position is on the NSTA outline, **not** the Sodir one, and the row should say so. |
| `tampen-spur-synrift` | (2.492, 61.542) | `166-146` | `["sm"]` | the Jurassic archipelago is deliberately not drawn; this row makes that a decision rather than an accident |
| `sogn-graben-synrift` | (3.487, 61.769) | `166-146` | `["sm"]` | the graben beside it, so the pair records "no relief here, on purpose" |

**Inference on the form.** Nine of the sixteen are *negative* witnesses — they
record a state this memo decided **not** to change, so a later change has to be
deliberate. That is the same device the Eocene control at (0.5 °E, 61 °N) already
performs for the East Shetland Platform, and it is the only way a
"deliberately-not-drawn archipelago" can be defended against silent drift.

### 5.2 Operations proposed

All inside the existing `north-sea` contract window `[-5, 53, 9, 62.5]`; each
extent is given **in words and as a box**, never as a traced outline, and each
would be EarthHistory's own coarse construction from the cited description.
They are ordered by how well the *geometry* is constrained, which is not the
same order as how well the *timing* is.

| # | Element / interval | Kind | Extent in words | Uncertainty | References |
|---|---|---|---|---:|---|
| **A** | **Jæren High**, `135-117`, `117-94`, `94-81` | `add-land` + `remove-shallow` | the Jæren High as Sodir maps it: an isolated N–S high east of the Central Graben axis, about 1.9–2.9 °E, 57.2–58.0 °N, ~3,800 km², inscribed diameter 47 km. It must **not** extend back into `146-135`. | 60 km | [C] "Seismic interpretation indicates that the formation [Hidra Fm] onlaps the flanks of the Forties-Montrose and Jæren highs; these intrabasinal upland areas were not submerged until much later in the Cretaceous"; [C] "Chalk sedimentation extended over the Jæren High, probably during the early Campanian"; Sodir CROMER KNOLL GP "absent from the highest parts of the … Jæren High"; Janssen et al. 2022 (https://doi.org/10.1017/njg.2022.5) for the Ryazanian stop; Sodir structural elements (NLOD) for the extent |
| **C** | **Danish/Norwegian Central Graben depocentre**, `166-146`, `146-135`, `135-117`, `117-94` | `remove-land` | the Tail End Graben, Søgne Basin and Gertrud Graben as one lens along the eastern Central Graben axis, about 3.6–4.8 °E, 55.9–56.9 °N; the `sm` class is already present at every one of the four intervals, so this is a **removal only** | 60 km | Sodir FARSUND FM (`/formations/39`), "Kimmeridgian to Volgian", "mainly deposited in a low-energy marine environment", "present throughout the Central Graben but thin or absent over the Southern Vestland Arch and intra-basinal highs"; Møller & Rasmussen 2003 (https://doi.org/10.34194/geusb.v1.4654) "the Danish Central Graben was fully submerged and marine conditions prevailed"; Rawson & Riley 1982 (https://doi.org/10.1306/03B5AC87-16D1-11D7-8645000102C1865D) for the isochronous, conformable base of the Valhall Formation |
| **D** | **Mid North Sea High** (the **Permian** high, Quadrants 35–39), `166-146`, `146-135`, `135-117` | `add-land` + `remove-shallow` | the published quadrant extent: **1.00 °W to 4.00 °E, 55.00 to 56.00 °N**, measured from NSTA licensed quadrant geometry against BGS CR/15/124's "situated in Quadrants 35–39", with a southward feather to about 54.7 °N where the NSTA "Mid North Sea High Area" reaches, **excluding the English coastal strip west of about 1 °W** and **leaving a marine corridor along the Central Graben** where it transects the high | 75 km | BGS CR/15/124 (Monaghan et al. 2015, https://nora.nerc.ac.uk/id/eprint/516766/1/CR15124.pdf) for the quadrant extent; Callomon 2003 (https://doi.org/10.34194/geusb.v1.4648) "the emergent Central North Sea Dome"; Johannessen 2003 (https://doi.org/10.34194/geusb.v1.4678) "a large positive area"; Møller & Rasmussen 2003 (https://doi.org/10.34194/geusb.v1.4654) "with the exception of marginal areas of the Ringkøbing–Fyn High and the Mid North Sea High"; [S] "submerged for the first time" in the Aptian–Albian; NSTA / BGS-DECC quadrant and area geometry (OGL v3.0, "Contains British Geological Survey materials ©NERC 2017") |
| **E** | **Fladen Ground Spur**, `203-179` and `166-146` | `add-land` + `remove-shallow` | the NSTA "Fladen Ground Spur" subarea, about 0.4–1.4 °E, 58.2–59.3 °N, 5,336 km², inscribed diameter 43.9 km. **The Sodir polygon of the same name must not be used** — it is a quarter of the area and would fall below the class floor | 60 km | Quirie et al. 2020 (https://doi.org/10.1144/jgs2019-182) "The Fladen Ground Spur likely formed a positive structure throughout the Jurassic" and "a low-relief topographic spur with flora dominated by gymnosperm (e.g. conifer forests)"; [N] "The East and North Shetland platforms and Fladen Ground Spur are composed of Old Red Sandstone and Caledonian basement"; NSTA UKCS geological subareas (OGL v3.0) for the extent |
| **B** | **East Shetland Platform**, `166-146` and `146-135`, **weakest of the five** | `add-land` + `remove-shallow` | extend the existing `179-166` platform outline south and keep it west of the graben shoulder: about −1.2…0.8 °E, 58.4…61.8 °N, stopping east of the East Shetland Basin fault system and **not** extending into `135-117` or younger | 60 km | [N] "Permian, Triassic and Jurassic strata are generally absent across the East Shetland Platform"; [N] "uplift and eastward tilting of the Shetland Platform during the Late Jurassic … the resulting erosion caused [clastic] sediments to be shed into the rapidly subsiding North Sea rift" (after Ziegler 1982); Valore et al. 2023 preprint, "behaved as a structural high during most of the Mesozoic" |

**Operation D is the best-sourced in the table and the one with a caveat about
its outline.** Four independent publications, two of them CC BY, agree the Mid
North Sea High was a positive, emergent area from the Middle Jurassic until the
Aptian–Albian, and the element is 96 km across, far above the class floor. The
caveat is that its outline is genuinely contested: the NSTA layer calls itself
"generic geological boundaries" and reaches onshore north-east England, EGDI /
NAGTEC draws the high a degree further south-east, and BGS CR/15/124 splits it
into a **Permian** high in Quadrants 35–39 and a **Devono-Carboniferous** high in
Quadrants 34–36, two degrees apart. The operation is therefore anchored on the
one extent that is published as text and convertible without reading a figure —
Quadrants 35–39 — it must say which high it draws, must leave the Central Graben
corridor marine, and should declare 75 km rather than the 60 km the other
operations use.

**One thing operation D does not fix.** At `179-166` the Mid North Sea High is
already not shallow sea — 305 of its 564 points are *unmapped crust*, almost
certainly the withheld mountain class. An `add-land` at that interval would be
the same kind of restatement the contract's `scottish-landmass-add-land`
operation performs, and it is **deliberately not proposed here**, because unlike
the Scottish case the diagnosis was not traced back to the pinned archive. That
verification is the prerequisite, and it belongs to the standing global `m`-only
measurement, not to this memo.

**Operation B is the weakest and may be dropped.** The East Shetland Platform
case rests on *absence of section* plus a *statement of uplift and erosion*, which
is exactly the pair the Norwegian-shelf memo refused to convert into land for the
Nordland Ridge. The difference is Ziegler's uplift-and-eastward-tilting statement
reported verbatim in [N], a positive claim that the platform stood high and shed
sediment, and the same claim the contract already accepts for the platform at
`179-166` and for the Shetland Platform at `58-49` and `49-37`. **If a reviewer
judges that pairing insufficient, drop B and keep the two East Shetland Platform
witnesses.** Operations A and C do not have this problem: [C] and the Danish
lithostratigraphy state submergence and marine deposition directly.

### 5.3 What must be left as a limitation

| Subject | Why no operation |
|---|---|
| **The Late Jurassic footwall archipelago** (Tampen Spur, Fladen Ground Spur, Josefine Ridge, Halibut Horst, Auk Ridge, Argyll Horst, Mandal High, Lindesnes Ridge, Andrew Ridge, Cod Terrace, Sele High, the three terraces) | **Measured: 26 of 43 elements have an inscribed diameter below Cao's ~30 km coastline tolerance**, and the largest of them is 28.7 km. The named islands are smaller still — Roberts et al. 2019 name the **Gullfaks** crest and the **NE Margarita Spur**, single fault blocks; McArthur et al. 2016 name a footwall island on the **Josephine Ridge**, whose whole element is 13.1 km across. Roberts et al. is 3-D backstripping **model output at three named ages**, and [N] records the counter-reading that the islands "were short lived". The edits memo already declined to draw "numerous isolated footwall islands" and nothing here overturns it. |
| **Forties-Montrose High at `94-81`** | The sourced claim is strong and specific ([C], first submergence in the late Campanian–Maastrichtian Tor Formation) but the element is **18.0 km** across, and the wider search found **no publication naming it in the Middle or Late Jurassic** at all. Recorded, witnessed, not edited. |
| **Sørvestlandet High** | Large enough (37.9 km), but the only statement naming it is a *reported hypothesis about provenance* (Ineson et al. 2003 reporting Rasmussen et al. 1999), not a claim of emergence. An operation here would be inference dressed as a sourced claim. |
| **West Central Shelf** | The only statement is a base-Cretaceous unconformity cutting out Jurassic strata — a missing section, not a land surface. Same rule as the Nordland Ridge. |
| **Ringkøbing-Fyn High at `224-203`** | The bin holds both the early-Rhaetian exposure and the latest-Rhaetian flooding that Nielsen 2003 describes. A maximum-transgression bin can only keep one. Unrepresentable, exactly like the Auk desert inside the Zechstein bin. |
| **The Zechstein over the Mid North Sea and Ringkøbing-Fyn highs, `269-248`** | [S] and [C] say the sea flooded them; Sodir's ZECHSTEIN GP says the rocks are "absent … over the Mid North Sea and Ringkøbing-Fyn highs"; Geluk 2000 has local platform facies on their margins. **The sources disagree and this memo does not adjudicate.** Both the current `sm` and a hypothetical `lm` could be defended, so neither may be asserted. |
| **Mid North Sea High in the Early Permian** | The emergent barrier is a *Rotliegend* state. Under the BGS reading ("Early Permian") it falls in `296-285`/`285-269`, where the map already draws land — nothing to do. Under the modern reading (Upper Rotliegend = Capitanian–Wuchiapingian) it falls inside `269-248` with the Zechstein that drowned it, and is unrepresentable. Either way, no operation. |
| **Inner vs Outer Moray Firth, North vs Central vs South Viking Graben, West vs East Central Graben** | Partly resolved and partly not. The NSTA layers **do** carry Inner Moray Firth Basin, North Viking Graben and South Viking Graben on the UK side, and §1.4 measures them; the Norwegian side has no such split and none is invented. The **East Central Graben** has no licensed outline anywhere reached: the only published anchors are the block designations of the Culzean (22/25a) and Erskine (23/26) fields, which enclose 1.8–2.2 °E, 57.0–57.33 °N — three blocks, not a graben. No operation. |
| **Siri Canyon** | Schiøler et al. 2007 make it a depression in the top-chalk surface — submarine. The map's `sm` has the right sign; there is nothing to edit. |
| **"Balder area"** | No structural element of that name exists in any dataset or publication reached this session. In North Sea usage "Balder" is the Eocene Balder Formation ("deposited in a deep marine setting", Sodir) or the Balder field in block 25/11, which sits on the **Heimdal Terrace**. The brief's name should be retired or re-pointed. |
| **Auk Ridge, Argyll Horst, Øygarden Fault Complex, the Fladen Ground Spur, and 11 of 24 points on the Mid North Sea High band at `179-166`** | These render as `neither` — unmapped crust. The formation-checks memo diagnosed the same symptom over the Horda Platform as the **withheld mountain class**; these instances were not traced back to the pinned archive here, so they are consistent with that diagnosis but not proof of it. **Compiler scope**, and more evidence for the standing call for a global `m`-only exposure measurement. |

---

## Reproduction

```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
# 1. snapshot public/data/reconstruction/cao-v2.4/palaeo-coastlines, then
$PY build_unions.py   # decode_ehpr -> piece_geometry -> unary_union per class per interval
$PY elements.py       # Sodir structural elements -> bbox, spherical area
$PY crest.py          # pole of inaccessibility + wellbore containment checks
$PY size.py           # inscribed diameter in km vs Cao's ~30 km tolerance
$PY probe.py points.json probe.json   # crest-point class sets, 25 interval files
$PY probe.py mnsh.json mnsh_out.json  # the Mid North Sea High band, 6 x 4 grid
$PY modal.py          # modal class over each element polygon, 0.1 deg grid
$PY uk_elements.py    # NSTA UKCS geological areas -> crest, bbox, inscribed diameter
$PY probe.py uk_points.json uk_probe.json
$PY uk_modal.py       # modal class over each NSTA polygon
```

Scripts, raw JSON, the downloaded Sodir GeoJSON, the extracted BGS memoir text
and the per-element context dumps were written to the session scratch directory
`/private/tmp/claude-501/-Volumes-EksternalHome-Koding-HTML-EarthHistory/795e3aa9-9911-4167-b7c7-76edc2aba7b8/scratchpad/ns-elements/`.
That tier expires; every number and quotation this memo relies on is reproduced
above.

## Appendix — sha256 of every payload read

Snapshot taken at git HEAD `192cc224cf59f198587afd000626f0725c96c5a9`, before
measuring. At that moment no palaeo-coastline file appeared in
`git status --porcelain -- public/`, and
three spot checks against the committed blobs confirm it directly: `git show
HEAD:…/palaeo-lm-catalog.json` hashes to `edd8f46efe6eb70c…`,
`…/palaeo-sm-catalog.json` to `96bd411765b43773…` and
`…/palaeo-lm-179-166.ehpr` to `006d6d1d63760041…`, equal to the snapshot values
below. These are the committed HEAD payloads.

Note for anyone diffing against the two companion memos: the `.ehpr` digests here
equal the Norwegian-shelf memo's "as read" column exactly, and the **catalog**
digests differ from both earlier memos because the catalog JSONs had been
re-serialised between those memos and this one; the values below equal HEAD.
**After this memo's measurement the implementation agent recompiled and all 52
files changed again**, so a later re-run must start from `git show HEAD:…` or
from these digests, not from the working tree.

| File | Bytes | sha256 |
|---|---:|---|
| `palaeo-lm-11-2.ehpr` | 185978 | `9bbeb82f19ad82d06f4fd72dea1fc644ae7647bb83f0abf87c92a4dcdc33f6ac` |
| `palaeo-lm-117-94.ehpr` | 151330 | `edf0831d18511c2a79df7810c14e9c18b391fb61657ba26079fb05f540549101` |
| `palaeo-lm-135-117.ehpr` | 159602 | `8e560f03328c806169a49951d53cef7694c01d66c7b263fc278fce341dac591c` |
| `palaeo-lm-146-135.ehpr` | 153156 | `292de9daac3dc007fe77d5abc2c31e4142be6de8bae2ad3509d7722c2cd3dfb8` |
| `palaeo-lm-166-146.ehpr` | 158814 | `141a22021974a487630ad693b4c9eb6af922941780cc7802b9a16e4c366438f9` |
| `palaeo-lm-179-166.ehpr` | 133650 | `006d6d1d63760041bdd20e5cb63b37902590fd0d5c5bfac7f0ac4a2ef8ed00ae` |
| `palaeo-lm-20-11.ehpr` | 172812 | `174c1b598689bad99e60d50c5e4019139d3709410833052c30f719d974919217` |
| `palaeo-lm-203-179.ehpr` | 133140 | `70b15563bfacec700db374c9342261ffb58ae725db8f1d2feaa83c9b09e64292` |
| `palaeo-lm-224-203.ehpr` | 123934 | `58d22ca39ba9cb426bd87b393303ff14549f5e6f7ff63ad966f47e70d7b76ba8` |
| `palaeo-lm-248-224.ehpr` | 126206 | `671f9f8efb9a067dcc7f7299016a23f4f3b44a00680d32a0304524a97e8462f4` |
| `palaeo-lm-269-248.ehpr` | 116334 | `ba605472454cda073a87b3ba5e2f97fe6b542a0a9aec6a330f8891b5d21ca75c` |
| `palaeo-lm-285-269.ehpr` | 118968 | `44e826fc3b4039d4bbd3c097c965108c00b98a22e8d63f7a9679673b53b35361` |
| `palaeo-lm-29-20.ehpr` | 182164 | `fb23308755022f10d757d26222d732e48a960753c788c040a31298c51d980f94` |
| `palaeo-lm-296-285.ehpr` | 110900 | `80c3da115e4b92bf6ffb9478a6bed46d548849de155c6ee92cdbc3002a35eb2e` |
| `palaeo-lm-323-296.ehpr` | 85748 | `bc744fb9e5b0aa3f66331f62d23962746d43a30e3c776d573a33fd603a1f31f4` |
| `palaeo-lm-338-323.ehpr` | 111742 | `b2b2e7d48670dca7a166dc1676c09252a2cb7e6a25ed19b1db6c9930eeb11ec1` |
| `palaeo-lm-359-338.ehpr` | 107268 | `9e6b2c13e4441274362af5f6c308623273fb3d20427a0a7d38ad061e80ccead4` |
| `palaeo-lm-37-29.ehpr` | 188492 | `683326354e4c8c0cee1d34440887c234a9391830b274a4b49ecd134dab1325a9` |
| `palaeo-lm-380-359.ehpr` | 103114 | `a91182ecdb902c85f28d91f64c40622b88a738a7b401ef8d1e7042fb187924d9` |
| `palaeo-lm-402-380.ehpr` | 103886 | `1b09e045e50a542a94609562d78d21448a90178bb734a2f8a6a242f3c2a96169` |
| `palaeo-lm-49-37.ehpr` | 170324 | `abf1a35d7f8c19629f2eabd9008df6f97a588a1e6281ac1eaec99247f84c11c6` |
| `palaeo-lm-58-49.ehpr` | 163712 | `0048e6041fc233e229640f9b6a77331261d5fc17d80b23b604274046ebd0f855` |
| `palaeo-lm-81-58.ehpr` | 141600 | `f0e7fc3ed72beac5f348e018d410539a05fb0ad70bab1cbcbe1bc58328da847e` |
| `palaeo-lm-94-81.ehpr` | 137316 | `8018b1ab8c557a8341cdc082376bd79c0180f0a0f77b96d55747f391dd60608f` |
| `palaeo-lm-catalog.json` | 34442 | `edd8f46efe6eb70c551c5ca281dab3ba4b5ae1a2376e13e8bce72e4c91739956` |
| `palaeo-lm-lgm.ehpr` | 40746 | `e928401e12eaf52e6ad6952fa9b0140b0171bd3e927d76b3880030a0f2e06c2e` |
| `palaeo-sm-11-2.ehpr` | 173072 | `388db45068d2336505f1e10ad14de996b5a50b3227b4af368cfc51eec129b820` |
| `palaeo-sm-117-94.ehpr` | 146712 | `aa1204f5e849fee0448beacb29f9b6f2a169073b405ce03383f6cac73a7a27e4` |
| `palaeo-sm-135-117.ehpr` | 129988 | `d58df57ca23776a2c52ff8682ac19c956d9a9a6303ac8d54dc35e2da4c37df4c` |
| `palaeo-sm-146-135.ehpr` | 143130 | `c95a9113450f8eebc558afa75ebe1fa4a2a1061f8bba193121e91b06b960e272` |
| `palaeo-sm-166-146.ehpr` | 166616 | `5a7682847e31273e00a91bd652fcff3e4e9a7d5ab6a09ff239c7ab9b4b6d4f6c` |
| `palaeo-sm-179-166.ehpr` | 120482 | `1fcde2b72104891850d5d3811a91bdcaee4841430b8aa8e1b9223e51be5e4167` |
| `palaeo-sm-20-11.ehpr` | 174932 | `c00ada47eac3d744057f59f031b43dbc9c0ce091cd350d630c7425b11605555e` |
| `palaeo-sm-203-179.ehpr` | 132240 | `7cab00772d42f64c796f90755f3f4ae8ac865c054e46dcecc2c02f7ee1e2a0b7` |
| `palaeo-sm-224-203.ehpr` | 112784 | `54c0c21ae462d43a0ce9ad0ceaf8662fc87991df1652bad822e21eb7e2cffe43` |
| `palaeo-sm-248-224.ehpr` | 104520 | `987acea327a41931130bb7aa06df7eda63dd8c1f517b4966d02632e75f1f3f66` |
| `palaeo-sm-269-248.ehpr` | 106314 | `1b20c3a983b64eab1547db338a94cbf2aca5cf809867b232015133bc7fba7fcb` |
| `palaeo-sm-285-269.ehpr` | 80296 | `effa1e734d833a50196e7e684863a57e44be77e3a1486cc67fcd6ffa6793dff0` |
| `palaeo-sm-29-20.ehpr` | 188182 | `ac7d0c78831b238be4e61f8c8168e9d851bb635adcf5681cde590649eb20f335` |
| `palaeo-sm-296-285.ehpr` | 93430 | `21ec3e6182ca728fd10ecf2c7191fd0bb0c36146c4dcd008bdab37e91c39b10b` |
| `palaeo-sm-323-296.ehpr` | 125532 | `f38711ae9d576e87cc8d5f622058ed11f578275dc6dc465d7715b1d1b698a118` |
| `palaeo-sm-338-323.ehpr` | 136450 | `13970e23b2c6ac5380dc266f48cbfe4b176e3c93d2423fab657098ce263baece` |
| `palaeo-sm-359-338.ehpr` | 119584 | `fd476e748221dc749c22390183fac39c8829bbafb3efde04b8641be8f8c6dbd3` |
| `palaeo-sm-37-29.ehpr` | 193690 | `d46bee94dc89e200f233574664f132d86f7c5ea924d1a14d391b673ed551e374` |
| `palaeo-sm-380-359.ehpr` | 144338 | `b5c1b20c251fb645ab9d3de260e1ea9b6cff2e9fe3236ea70e8a7ef9b89e0d43` |
| `palaeo-sm-402-380.ehpr` | 152032 | `2d69a49563ccf5b30acdbf85530ba53df8b2d3107e0b0e33494a9e568e2aba78` |
| `palaeo-sm-49-37.ehpr` | 198842 | `3ba6c52857d503f61041b9cc3dad1277b300b1e01b74c7fc395f057395ccbc36` |
| `palaeo-sm-58-49.ehpr` | 178368 | `1aa116d25d1a63b9eca33e1120726e3732e34d36b9371ef4299ab240b58d737a` |
| `palaeo-sm-81-58.ehpr` | 181196 | `c0c6eb54f7da728b0f74bdcb5fab1ed27557ff793e3adefec668cb02c3a71535` |
| `palaeo-sm-94-81.ehpr` | 166896 | `cb985fe5083f4684223f5f377fb708d549707d1d3f83ba0e42a6bca216d76463` |
| `palaeo-sm-catalog.json` | 49491 | `96bd411765b43773a0b048907cd75fceefb771bfbe2b9987fd7629b872b93a21` |
| `palaeo-sm-lgm.ehpr` | 32 | `8547cf88b309c0a2120a0f5e0093f6eadc8a43cda013eb967657fefade4c038f` |

Plus the three licensed coordinate sources, none of which is a build input and
no part of which is redistributed here:

| File | Bytes | sha256 | Source, licence |
|---|---:|---|---|
| `structural_elements_raw.geojson` | 1,468,760 | `8e271cb65d10db3e6e5f3a503e192f88448bf6f5aebc355246094cf4a489062e` | Sodir FactMaps layer 704, "Structural elements"; NLOD 1.0; attribution "Norwegian Offshore Directorate" |
| `nsta_Geological_subareas.geojson` | 832,627 | `55b5962c55fd601021f129bea2443d1810ba3d4719d12d303ed9a7cef9e9433b` | NSTA "UKCS geological subareas (WGS84)"; **OGL v3.0 via the BGS 21CXRM redistribution of the same polygons — see §1.4** |
| `nsta_Major_geological.geojson` | 783,366 | `28eea14f7f4d8f052e3c6df71d31f9bd19ae5c1efb331c0d597cc6c28b819f2e` | NSTA "UKCS major geological areas (WGS84)"; same |

Two further sources were read but are not digested here because they are not
coordinate inputs to any number above:
`DECC_OFF_Geological_Basins_{Major,Sub}.shp` from the BGS 21CXRM package, read
with `pyshp` only to prove polygon identity with the NSTA layers and to recover
the OGL grant (§1.4); and BGS Commissioned Report **CR/15/124** (Monaghan et al.
2015, 14,126,614 bytes as fetched from
`https://nora.nerc.ac.uk/id/eprint/516766/1/CR15124.pdf`), read for the two
verbatim Mid North Sea High quadrant statements in §3.4. The UKCS quadrant
geometry used to convert "Quadrants 35–39" into degrees is the NSTA
`UKCS_quadrants_(WGS84)` layer, same licence chain.
