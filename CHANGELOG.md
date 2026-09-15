# Changelog

All notable changes to EarthHistory will be recorded here.

## [Unreleased]

### Added

- A toggleable **Palaeo-coastlines (Cao 2017)** layer that replaces the Cao 2024
  coast proxy with mapped palaeogeography for the 24 published map intervals
  from `402-380` to `11-2` Ma, plus the Last Glacial Maximum lowstand state. All
  three Cao surface classes ship: 26,769 landmass pieces (3,418,479 bytes),
  31,271 shallow-marine pieces (3,467,192 bytes) and 12,151 mountain pieces
  (1,195,501 bytes), cut from 7,155, 13,395 and 4,789 Cao et al. (2017) source
  records and the cited basin and lowstand contracts, plus three columnar class
  catalogs and 25 country-outline tone tables (107,501 bytes for both files) —
  8,188,673 bytes over 80 files, inside the 8.5 MiB budget `check-app-artifacts`
  now enforces. `dist` is 51,455,724 bytes (49.07 MiB) against the unchanged
  50 MiB ceiling.
- The mechanism: the browser downloads polygon rings, not triangles. A published
  interval is one EHPR v1 payload per class — int16 lon/lat vertices, a 12-byte
  piece record and a 2-byte ring record — which a worker decodes, ear-clips with
  its holes and refines to a maximum 1° edge before the second surface renderer
  instance draws it. Pre-triangulated streaming of the landmass class alone
  would have been 45–96 MiB. Each piece is posed by the plate its catalog
  binding names, resolved against the shared motion palette by the normative
  `palaeo-binding-entry-v1` rule (North Sea restoration first, eight recovery
  plates that never fall back, `correction-plate-` entries at and above 410 Ma,
  the native chain below it), and is drawn on its own `(TOAGE, FROMAGE]`
  lifecycle rather than on the interval of the file it ships in. The format is
  specified in `docs/data/palaeo-coastlines-format.md`.
- What the layer does not claim: an interval records the minimum land and
  maximum flooding mapped anywhere in that bin, not a shoreline at one moment,
  and the map steps at an interval boundary rather than morphing through it.
  Shallow marine is an environment class, not a water depth. Cao 2024
  continental crust carrying neither class keeps its own "depth unmapped"
  meaning and is never drawn as deep marine. Country outlines become light
  position markers over a Cao 2017 sea; the tone is a legibility aid, never
  evidence that the modern country existed. Outside 2.01–402 Ma, including the
  present day, the mode falls back to today's composition with a map-key notice.
- What did not change: the layer is off by default, a link written before it
  existed still opens with it off, and nothing palaeo is fetched while it is
  off. With the layer off the drawn globe, the native Cao 2024 composition, the
  country outline's single dark ink, every correction, anchor, boundary and
  ownership asset and every existing citation are exactly what they were. The
  Cao 2017 ice class `i` is still not compiled.
- The **mountain class** `palaeo-mountain`, shipped as light-brown polygons
  above palaeo land. Withholding it was a measured defect, not a preference:
  Cao classes ground as mountain in all twenty-four intervals — from 2.1 million
  km2 at 285-269 Ma to 23.9 million km2 at 20-11 Ma — and where that ground
  carried neither of the two published classes the globe painted emergent orogen
  in the blue the map key defines as "Cao 2024 continental crust, depth
  unmapped", asserting an absence of evidence the source does not have over
  areas the size of continents. At 170 Ma the Pentland Firth between Caithness
  and Orkney rendered as water 90 km from land that was drawn. The colour is
  `#c8a97e`: the dark outline and label ink clears it at 6.86:1, and it
  separates from the `palaeo-land` olive by hue rather than by lightness
  (CIE76 dE 21.1; 56.7 against the shallow-marine teal). Precedence is
  unchanged — mountain over land over corrections over shallow marine over
  shelf — and the map key's "Palaeo mountain" row returns with the class. The
  class carries Cao's own evidence row and adds no new literature claim; its
  limitation line says it is a mapped relief class, neither an elevation nor a
  modern topographic surface.
- The mountain class is funded by a lossless reclaim, not by dropping a tier.
  The shipped package already interned repeated chart fields; the interned field
  list grew from four to twelve and the references moved into one dense column
  per field, because twelve repeated key names per chart cost more than the
  references they introduce. `core.json` falls from 3,216,469 to 1,426,795 bytes
  and the material-correction catalog from 284,232 to 220,600 — 1,853,306 bytes,
  against the 1,172,814 the class needed. Every chart is deep-equal after
  expansion and the whole document is canonically equal; six deliberate
  mutations are proven red in both halves of the codec. `PALAEO_MAX_BYTES` rose
  from 7 to 8.5 MiB, inside what was reclaimed, and `dist` keeps 973,076 bytes
  of margin under the 50 MiB ceiling. Two further reclaims were measured and
  deliberately left untaken — mountain node reduction at 0.05 degrees (41,654
  bytes, 3.5 % of the class, for a real loss of boundary detail) and interning
  `motion-palette.json` (588,257 bytes, but fifteen offline scripts read that
  catalog directly) — because the requirement was already met.
- **`PLATEID1` overrides are bounded by a declared footprint.** Every override
  entry now carries the bounding box of that plate's own present-day Cao 2024
  static partitions, buffered by a stated 500 km — twice the 250 km
  frame-conflict threshold — and a cut piece is rebound by its `PLATEID1` only
  if the whole piece fits inside it. Without the bound a plate id alone carried
  ground an ocean away: the Apulia (3307) override was rebinding shallow-marine
  pieces spanning 3.7-31.6 E and 36.0-55.8 N onto a plate whose entire
  present-day crust is 15.2-19.3 E, 39.6-41.9 N. The rule turns 3,545 of 9,934
  eligible shallow-marine pieces, 413 of 1,287 landmass and 440 of 985 mountain
  pieces back to partition binding, where the frame-conflict flag discloses the
  disagreement instead of hiding it; a piece whose partition owner then has no
  gap-free motion coverage is not drawn rather than posed on an invented
  rotation. The validator rejects an override piece outside its footprint, and
  an override entry with no footprint at all.
- Twenty cited local modifications to the Cao 2017 polygons in the North Sea,
  the first basin the plan's edit contract covers. In eight of the twenty-four
  map intervals the source misstates the land-sea pattern at basin scale, and
  113,050 km2 of landmass is added net and 195,578 km2 of shallow marine removed
  net to fix it: the Middle Devonian Orcadian Basin stops being an epicontinental sea
  and goes back to being a lake in a continent (402-380 Ma); the Moray Firth
  emerges in the Zechstein while the Central North Sea evaporite basin stays
  flooded (269-248); the East Shetland Platform and the Brent/Vestland delta
  plain emerge in the Middle Jurassic, the delta plain bounded north by the
  published ca. 60 degrees 30 minutes N limit, and northern Scotland, the
  Pentland Firth and Orkney stop rendering as water of unknown depth between
  them (179-166); the Scottish landmass stays emergent through the Late Jurassic
  where Cao drowns it and the literature does not (166-146); the Viking Graben
  at Heather time, the Egersund Basin at Tau and Draupne time, the eastern
  Norwegian-Danish Basin and the southern North Sea at the late Ryazanian
  transgression stop rendering as dry ground over their own source-rock kitchens
  (166-146, 146-135, 135-117); and the Shetland
  Platform emerges in the Palaeocene and Eocene, where Cao's own authors record
  fewer than twenty marine fossil collections constraining the whole globe
  (58-49, 49-37). Those four Late Jurassic and Early Cretaceous removals are a
  different kind of edit from the rest: in each, Cao overlaps one of its own
  landmass polygons on its own shallow-marine polygon and the landmass wins the
  draw order, so what is removed is an artefact of a maximum-transgression bin
  rather than a disagreement with the source. Two `add-shallow` companions cover
  the intervals where no shallow-marine polygon lies underneath, so a removal
  never leaves mapped sea rendered as crust of unmapped depth. Each operation
  carries its rationale, a 40-75 km spatial uncertainty, its references with DOI or URL, and an editorial line
  "EarthHistory modification after <refs>"; the edited charts carry those
  references in their evidence records, so the map key names them whenever an
  edited chart is on screen. Every geometry is EarthHistory's own coarse
  five-to-seven-vertex construction sized from the published descriptions, and
  the literature is citation-only: no figure, map plate or coordinate list is
  traced, digitised or redistributed, the two NSTA/OGA regional packages
  (Open Government Licence v3.0) are read as facies descriptions only, and the
  only redistributed palaeogeographic geometry remains Cao et al. (2017). Six
  interval groups are deliberately left untouched and the contract says why,
  including the Late Cretaceous platform flooding and the Forties provenance the
  literature memo flags as unsettled, the Late Jurassic rift seaways Cao already
  gets right, and the northern limit of the Zechstein Sea nothing retrieved
  places. The record is
  `docs/research/palaeo-coastlines-north-sea-edits.md`, with four measured
  companions: the formation checks, the Middle Jurassic and Eocene Shetland
  literature records, and the Norwegian shelf checks against the Norlex
  lithostratigraphic wallchart and the Sodir formation charts. Two further
  refinements come from those: the Brent rationale now says that 60 degrees
  30 minutes N bounds the *Vestland* system and not the Brent maximum (a delta
  *front* at about 61 degrees 30 minutes N that the operation deliberately does
  not reach), and cites the Central North Sea dome for the emergence of the
  ground south of the delta but explicitly not for its sediment supply, naming
  both sides of the open provenance controversy; and the East Shetland Platform
  outline is pulled back to 0.55 E between 60.9 and 61.3 N so it stops short of
  the Unst Basin, which preserves a Brent Group succession. The Palaeogene
  operations gain the Grid and Frigg lithostratigraphy, the Hermod provenance
  record, the Middle Eocene platform succession, the Palaeogene palaeobathymetry
  and the platform's structural history, and their stated spatial uncertainty
  rises to 75 km because no retrieved source places a Palaeogene shoreline
  anywhere between 0 and 1.2 E. No Nordland Ridge or Loppa High operation
  follows from the wallchart: a hatched hiatus column states that section is
  missing, not that the ground stood above sea level, and both are carried as
  drift witnesses instead. The country-outline tone tables and their interval
  index are built from the shipped class list alone — which the promote script
  refuses to publish against a mismatch — so a segment is inked dark over the
  mountain class now that the class ships, and was not while it did not.
- One optional **Last Glacial Maximum lowstand state** inside the same layer, at
  26.5-19.5 ka: the first interval the layer carries that is not Cao et al.
  (2017) geometry at all. It is the NOAA ETOPO 2022 60 arc-second surface at or
  above the -120 m eustatic datum, over three footprints and nowhere else - the
  southern and central North Sea (Doggerland), the Sunda shelf, and Beringia
  either side of the antimeridian. The datum is Lambeck et al. (2014), who
  record a slow eustatic fall to -134 m between 29 and 21 ka with a companion
  model peak of ~130 m; -120 m is the conservative round contour, a deliberate
  under-claim. The window is Clark et al. (2009), "nearly all ice sheets were at
  their LGM positions from 26.5 ka to 19 to 20 ka", read as the same half-open
  `(TOAGE, FROMAGE]` lifecycle as every other interval, so the timeline's
  existing 0.021 Ma chapter lands inside it and 19.4 ka and 26.6 ka do not.
  Measured exposed shelf: 658,203 km2 in the North Sea box, of which 310,950
  km2 in the southern North Sea plain between England, the Netherlands, Germany
  and Denmark; 2,256,842 km2 on the Sunda shelf; 1,638,056 km2 in Beringia.
  Sturt et al. (2013) model 127,422 km2 submerged in the North Sea zone across
  the Holocene - a different quantity over a different window and under
  glacio-isostatic adjustment, quoted as an order-of-magnitude anchor and not as
  agreement.
- What the LGM state does not claim, stated in the map key and enforced by the
  gate: it is eustatic only, one flat contour with **no glacio-isostatic
  adjustment**, although relative sea level around Britain and Ireland varies by
  more than 100 m spatially under GIA; **ice sheets are not drawn**, so ground
  under the Fennoscandian, British-Irish and Laurentide ice sheets is shown as
  exposed land, which it was not; ETOPO 2022 is **modern bathymetry** with
  post-glacial sediment still in place, which is precisely what Coles (1998)
  warns against ("the present-day relief of the North Sea bed does not provide a
  sound guide"); the rivers, lakes and estuaries Gaffney et al. (2009) mapped by
  seismic survey are absent; and it is **regional**, so every other coastline at
  this age is the present-day one. Its evidence badge is synthesis at every age
  in the window.
- Because it is regional, it is drawn *over* today's land rather than instead of
  it. The palaeo domain is now two bands: in 2.01-402 Ma the Cao 2017 polygons
  replace native land as before, and in the LGM band native land stays visible
  with the exposed shelf drawn on the shell 500 m above it. Hiding today's land
  for a three-footprint state would have blanked every coastline on Earth. The
  composite pick, the coverage query and the guide-label ink follow the palaeo
  instance independently of whether native land is hidden, and the band is
  carried through the existing one-frame hysteresis so the frame that still
  draws Cao charts still hides native land. Country-outline tone follows the
  same logic: the LGM tone table is the ordinary dark ink, because there is no
  palaeo composition under the outlines to read.
- Format and gates for it. The class catalogs gained
  `detachedIntervalIds: ["lgm"]`, so the schedule check still rejects an
  interval dropped by accident while accepting the intended 2 Myr gap; the
  shallow-marine payload for the interval is a header-only 32-byte file, because
  a eustatic contour says where land was and nothing about where a shallow sea
  was, and the validator fails if it is not empty. The interval cost 48,151
  bytes when it landed, and every other interval stayed byte-identical. `validate_palaeo_coastlines_runtime.py`
  now pins the four ETOPO crop digests, the contour datum, the window, the
  footprint bounds, the measured areas, the required limitations and references,
  and eight witnesses - Dogger Bank, the Sunda shelf and the Bering land bridge
  are land at 21 ka, London is unchanged, and the Norwegian Trench, the Makassar
  Strait, the Aleutian Basin and the South Atlantic are not - with 15 proven-red
  mutations including a datum changed to -130 m, a corrupted crop digest and a
  payload shifted half a degree east that turns the Norwegian Trench into land
  while staying inside the area tolerance. No raster enters the repository: the
  crops stay in the owned offline store and only the derived rings ship. The
  record is `docs/research/palaeo-coastlines-lgm-lowstand.md`.

### Changed

- Ship the Cao v2.4 package JSON in a lossless interned form and reclaim
  7,379,140 bytes (7.04 MiB) of the static build without changing anything the
  application renders or any evidence it can surface. The shipped documents
  repeated a handful of distinct values across thousands of records, so
  repetition is now stored once and the identifiers that were already implied by
  neighbouring fields are derived instead of shipped: `core.json` 6,314,414 to
  3,216,469 bytes (4,995 charts sharing 13 `evidence.limitations` arrays, 7
  `surfaceEvidence` objects, 183 `lifecycle` objects and 938 `motionBindings`
  arrays, with 3,799 identical `chartId`/`fragmentOrCohortId`/`materialId`
  triples collapsed); the 235 `boundary-*.json` catalogs 10,064,808 to 6,365,752
  bytes (19,805 derived `segmentId`s plus per-file GPlates UUID and enum
  tables); the 235 `ownership-*.json` catalogs 1,356,950 to 887,669 bytes (3,838
  derived `polygonId`/`ringId` pairs); and `corrections/material-v1/catalog.json`
  397,090 to 284,232 bytes. `dist` falls from 52,349,889 bytes (49.92 MiB) to
  44,973,799 bytes (42.89 MiB) against the unchanged 50 MiB ceiling, a net
  7,376,090 bytes after the 3,050-byte decoder in the bundle. The wire format is
  described in `docs/data/README.md`.
- Nothing scientific changed: every chart, source identifier, citation,
  limitation string, lifecycle bound, motion binding, epistemic status, boundary
  segment, ownership ring and digest keeps its exact value, and each rewritten
  file was proved to expand to a canonically identical document before it was
  written. No geometry, motion palette, checkpoint state, correction, anchor or
  country asset was touched, and `make check-corrections` reports the same
  numbers as before apart from the recorded byte counts and digests. The runtime
  expands each document inside the verified-JSON load, before every existing
  validator, so no consumer downstream of the loader changed.
- Re-derive the seven `core.json` digest declarations and the catalog, checkpoint
  and tile ledgers that follow them through their owning scripts rather than by
  hand: the package and root data manifests, the 235 checkpoint native-layer
  pins and their `transitiveBytes`, the correction catalog's `baseline.coreSha256`,
  the requested-age tile index (re-emitted and re-promoted through its own
  emitter, validator and promoter, with all 72 tile payloads proved byte
  identical), the tracked tile source contract, and the two pyGPlates oracle
  records whose package identity is rebased only after every measured field is
  shown to be unchanged. `scripts/research/cao_package_intern.py --self-test`
  round-trips all 472 shipped catalogs and rejects five deliberate corruptions,
  `scripts/research/apply_cao_package_interning.py` re-verifies the applied form
  and its ledgers, and both join `make check-corrections`;
  `src/reconstruction/packageIntern.test.ts` proves the runtime decoder rejects
  an out-of-range dictionary reference, a colliding derived `segmentId` and a
  ring shipped outside its polygon group.

### Fixed

- Draw the Middle Jurassic Scottish landmass as land instead of as water of
  unknown depth. At 170 Ma the present-day point (-3, 58.8) rendered in the
  crust blue that means "no class is mapped here" while the Moray Firth 90 km
  south was land. Cao et al. (2017) do map it: that ground is their mountain
  class, which they treat as terrestrial and which the byte budget does not
  fund, so it never reaches the browser. 17,742 km2 of the 20,045 km2 the new
  operation outlines is mountain, 2,121 km2 is ground Cao already calls
  landmass, and only 209 km2 carries no Cao class at all. The operation
  restates that classification in a class we publish rather than correcting the
  source - it adds 17,061 km2 of landmass over northern Scotland, the Pentland
  Firth and Orkney and moves neither of Cao's boundaries, because none of the
  outline falls on the interval's shallow-marine class - with four published
  sources cited as an independent check on the sign (Cox & Sumbler 2002 on the
  emergent Jurassic Scottish land area, Johnson et al. 1993 on the
  Orkney-Shetland Platform, Underhill & Partington 1993 on the Mid-Jurassic
  dome, and the NSTA/OGA Central North Sea and Moray Firth Bathonian facies
  sheet, whose only classes over that hinterland are "Coastal and alluvial
  plain heterolithics" and "Uplands"). The class gap it exposes is global, not
  local, and is recorded with its measurements rather than fixed here: 3.9
  million km2 at 179-166 Ma, 15.8 at 49-37 and 23.6 at 20-11 Ma of Cao mountain
  ground lie inside the continental crust extent carrying neither shipped
  class. The Eocene East Shetland Platform east of 0.2 E was reviewed in the
  same pass and deliberately left as shallow marine: the NSTA Eocene Alba sheet
  describes it as shelf and deep-water sandstone, the Middle Eocene
  fluvio-deltaic unit is confined to the platform's southern part, and the one
  emergence statement names the Shetland Platform west of it. The validator now
  holds an unedited control at (0.5, 61) that fails if the land is ever
  extended east without a citation.
- Stop the collapsed chapter card covering the open map key on a phone. At
  390x844 the key panel opens full width to just under the header, and the
  chapter card sat on top of it, hiding the key's own heading and its first
  colour swatches. The open key now outranks the chapter card and still passes
  under the timeline and the header, which it never reaches. Closed, the key
  pill keeps its old place in the stack, and nothing about the panel's size,
  contents or behaviour changes.

- Keep today's land on the globe where the Cao 2017 maps stop. With the
  palaeo-coastline layer switched on at an age outside 2.01-402 Ma the mode
  correctly fell back to today's composition, but the native land fill was
  hidden anyway: visibility keyed off the layer flag rather than the effective
  mode, and with the palaeo instance drawing nothing the shelf shone through
  where a coastline belongs. At 0 Ma Africa rendered as shallow sea - land
  pixels fell from 243,499 to 375 over the globe canvas and 70 per cent of it
  differed from the layer-off control by a mean 56.9 of 255 per channel - while
  the map key said it was showing the Cao 2024 coast proxy. Native land, the
  composite pick and coverage and the guide-label ink now all follow one
  effective mode that hides land only while Cao 2017 charts are actually drawn
  over it, carrying the same one-frame hysteresis as the fallback transition, so
  a link, a scrub across either boundary and a toggle at the present day each
  leave exactly today's globe. The reported palaeo asset bytes follow the same
  rule as the reported interval, charts and triangles: what is on screen, so the
  resident outline tone tables no longer count at a fallback age. Two browser
  checks compare the whole globe canvas at 0 and 500 Ma against their layer-off
  controls per channel. In the same change the map key stops offering a
  "Palaeo mountain" swatch for the class the budget does not fund, and its panel
  takes the height the stage leaves it instead of a fixed 440 pixels that cut
  the outline legend and the evidence list off below the fold.

## [0.1.11] - 2026-09-14

### Fixed

- Remove the duplicate Denmark and keep it on the Norwegian side of the North
  Sea rift. Cao v2.4 draws the Danish coastline on four plates (330, 315, 302
  and 30204) and gives the Tornquist Block (330) a 0.59 degree stage that
  drifted one copy about 40 km south-west from 170 Ma back, so two Denmarks
  appeared and the Kattegat opened going back in time; this was already the
  case in v0.1.9. The North Sea restoration contract now binds every Tornquist
  Block chart (26 coast and shelf charts, the DNK, POL and SWE outline
  fragments) to Baltica's native motion from 130 Ma back, so all copies stay
  coincident and Denmark, the Netherlands, Norway and Sweden share one
  motion. The moving block is unchanged: Britain and Ireland close the Viking
  and Central Graben toward Norway and Denmark (Shetland-Bergen 72 km by
  270 Ma). A single rigid rotation cannot also close the Skagerrak, and no
  sourced closure exists for it, so Denmark does not move; the runtime probe
  test now checks that every Danish copy stays within 0.5 km of the others and
  that Aarhus and Gothenburg keep their distance to Bergen at every age.

## [0.1.10] - 2026-09-14

### Fixed

- Stop drawing present-day lakes as shallow sea in deep time. The Cao v2.4
  coast layer leaves 48 large modern lakes (Victoria, Tanganyika, Malawi,
  Turkana, Albert, the Laurentian Great Lakes, Baikal, Ladoga and others) as
  voids inside the continental-outline underlay with the owning plate's full
  lifecycle, so Lake Victoria read as marine shelf at 450 Ma. A new lake-void
  infill correction (101 charts, 715,323 km², `data/corrections/lake-voids/`)
  fills each void with the land appearance strictly older than the lake's
  cited basin onset (29 curated onsets, for example Tanganyika 10.5 Ma,
  Malawi 8.6 Ma, Victoria 0.4 Ma, Baikal 30 Ma) or, for lakes without a
  citation, at every age older than exactly 0 Ma. The present-day appearance is
  unchanged; no native geometry, motion or lake outline is backdated. The
  correction contract, its seven-mutation self-test and a runtime probe test
  join `make gate`; the composed package grows to 403,322 vertices, still under
  the 520,000 renderer reservation, and the requested-age motion tiles were
  rebound to the new catalog identity.
- Open the North Sea rift going back in time. Cao v2.4 keeps Britain rigid to
  Baltica from 0 to 430 Ma, so England and Norway never changed distance. A
  tracked regional restoration (`data/corrections/north-sea-restoration/`)
  rotates the UK-side charts (Scotland, Shetland, Ireland, England, Wales and
  the GBR/IRL outlines; 28 charts on plates 303 and 315) relative to Baltica
  about a pole fitted to the Müller et al. 2019 North Atlantic deforming
  network, scaled so the Shetland-Bergen transect closes by the published
  Mesozoic extension: 0 km below 130 Ma, 27 km by 170 Ma (Late Jurassic
  phase), 72 km by 270 Ma (Permian-Triassic phase), then constant to each
  chart's oldest age. Aberdeen-Stavanger closes 47 km; Baltica, Norway,
  the Netherlands and France do not move. Straddling shelf polygons stay on
  Baltica. Two palette entries (836 samples) and 28 rebindings are the only
  package change; a pyGPlates oracle (2.8e-5 rad maximum residual), a
  pure-Python validator with five contract mutations and a runtime probe test
  guard it, and the requested-age motion tiles were rebound.
- Describe the East African Rift honestly: the point of interest now states
  that the globe carries the Cao v2.4 Somalia-Nubia opening (about 86 km at
  Nairobi since 20 Ma) on the eastern branch and that the western branch's
  10-30 km per basin is below regional-zoom resolution and is not modelled.

## [0.1.9] - 2026-09-14

### Fixed

- Keep the modern-country reference outlines thin. 0.1.8 made them continuous
  by unioning nine overlapping one-pixel copies at sub-pixel offsets, which
  read as a 2.0 CSS px stroke. Each segment is now expanded into a
  screen-space quad and shaded from the analytic distance to its own centre
  line, so the core is 1.0 CSS px at any pixel ratio with the antialiasing ramp
  outside it and no beading on diagonals. One draw replaces nine, the darker
  contrast underlay is gone, and the uncapped median frame interval falls from
  1.7 ms to 1.4 ms at pixel ratio 2 and from 1.1 ms to 0.9 ms on the
  low-quality profile. Analytic horizon occlusion, the far-side collapse and
  the display-height guard are unchanged, and no reconstruction geometry
  changed.
- Modern-country outlines no longer read as dashed lines at reconstructed ages.
  The 0 Ma Natural Earth complement bound every subdivision the Cao static-polygon
  partitioner rejected to an exact-present locator chart with a [0, 0] Ma
  lifecycle, so 2,031 of 12,045 segments vanished above 0 Ma. A tracked
  source-fragment bridge rebinds 1,709 of them to the Cao static fragment the
  partitioner verified at a shared endpoint of an accepted neighbouring segment;
  the 322 with no accepted neighbour stay unavailable above 0 Ma. Segment
  geometry, order, country identity and the 0 Ma overlay are unchanged, and
  central-Africa segments inactive at 71.65 Ma fall from 219 to 13 of 1,236.

## [0.1.8] - 2026-09-14

### Fixed

- Draw the modern-country reference outlines as continuous lines. Both
  backends rasterize a one-device-pixel line, whose multisample coverage split
  across pixel rows along every diagonal and read as beads. Each outline style
  is now drawn at several sub-pixel screen offsets that union into a solid
  stroke in the same colours. Because a shifted copy has no matching depth,
  the outlines no longer depth test; they are occluded analytically at the
  globe horizon, exact at every zoom, with far-side vertices collapsed in the
  vertex stage and the pose graph kept there through a varying. Uncapped
  measurement puts the median frame interval at 1.7 ms against 2.5 ms at device
  pixel ratio 2 and 1.1 ms against 1.9 ms on the low-quality profile. A
  publication guard rejects a package display height that could lift the
  surface through the outline shell. No reconstruction geometry changed.
- Place the graticule guide labels on the lines they name with a 1-2 CSS px
  clear margin, stop mirroring the meridian labels (their tangent frame was
  left-handed against the outward normal), advance parallel labels by true arc
  instead of degrees of longitude, and size each label sheet to its own string
  so long labels are no longer condensed.
- Ink each guide label from the reconstructed surface under it: dark grey
  #4a4f54 where a land chart covers the segment, light grey #d0d4d5 over shelf
  and open ocean. Measured on the rendered surface the light ink reaches
  5.7-6.1:1 on deep ocean and 2.8-3.0:1 on shelf, and the dark ink 2.9:1 on
  land. Each label is four segments classified from the live Cao surface with
  hysteresis, so the choice follows plate motion as the timeline scrubs.
  Coverage comes from a new read-only `coversDirection` accessor on the Cao
  foundation renderer.
- Draw land instead of deep ocean where the Cao v2.4 model leaves observed
  modern land with no chart at present day. A global audit of the compiled
  package against Natural Earth 1:50m land found 180,488 km² with neither a
  land nor a shelf chart, all caused by Cao static partitions that have no
  counterpart polygon in `shapes_coasts` or `shapes_continents`: the Yemen and
  south-west Saudi highlands, the Niger delta with the Cameroon and Equatorial
  Guinea coast, the Senegal and Mauritanian coast, Kerguelen, the Canaries, the
  Galapagos, Socotra, Corsica and Sardinia, Reunion, the Darien coast,
  Mauritius, the Louisiade islands and Zanzibar. One tracked exact-present
  correction fills all thirteen from Natural Earth 1:50m land minus the native
  Cao coast footprint, with zero overlap against native land, shelf or the
  Iceland and Panama corrections, no new motion entry, and a lifecycle valid
  only at 0 Ma. Public data grows by 42,963 bytes. 87 further components
  (931,079 km²) remain deliberately uncorrected with recorded reasons, mostly
  on plates without a present-day palette entry. Angola and Niger are not
  coverage gaps: the visible Angolan offset is the 1:110m country locator up to
  31.7 km seaward of the 1:50m coast, and Niger's patch is the Lake Chad shore.

## [0.1.7] - 2026-09-14

### Fixed

- Keep the last rendered Cao surface on the globe while a scrubbed age is still
  loading, with the map key reporting the loading and shown ages. The released
  build hid the whole land group on every age sample until its motion frame
  arrived, which flashed landmasses on and off on phones.
- Darken the modern-country reference outlines so they read on pale land and
  shelf water at phone sizes.

### Changed

- Continuous scrubbing keeps a motion tile download that already covers the
  new age, retains a tile that lands after its requesting age moved on, and
  no longer cancels the background all-age palette or checkpoint warming on
  each age change. Background requests carry a low priority hint, hold body
  reads while a foreground tile is in flight, and decode only after the
  foreground age has rested for 250 ms; checkpoint prefetch waits for the
  scrub to settle. On the measured mobile-throttled 0-70 Ma burst this cut
  motion requests from 38 starts with 35 aborts to 4 with none and settle
  after the last input from 242 ms to 24 ms, with no blank frames.

## [0.1.6] - 2026-09-13

### Added

- Complete the schematic globe graticule with four cardinal meridians and
  compact one-degree ticks at the minor-longitude crossings.
- Show the URL-requested Cao age from a verified 25 Ma motion window, then
  verify the full timeline motion and checkpoint assets in the background with
  cancellable age priority, accurate loading status, and retry after failure.

### Fixed

- Reuse byte- and SHA-256-verified content-addressed reconstruction payloads
  across page refreshes while continuing to revalidate the package manifest.
- Keep reconstructed land and shelf normals in the renderer's expected view
  space, and keep inspection lighting aligned with the camera so orbiting cannot
  turn the visible globe into an unlit side.
- Restore source-backed native land around Australia and Oceania where valid
  Cao polygons were lost to triangulation, with refined motion bindings across
  the affected source intervals.
- Add exact-present observed land across the Panama isthmus while retaining its
  source-bounded single-age lifecycle.
- Complete the exact-present modern-country reference overlay from the pinned
  Natural Earth source, improve line contrast, and keep unsupported historical
  fragments absent rather than assigning speculative motion.
- Represent two discontinuous plate-626 source seams as explicit unsupported
  intervals so affected charts disappear inside the gaps and reacquire their
  authored poses at both endpoints.

## [0.1.5] - 2026-09-13

### Changed

- Replace the permanent surface footer with a compact, expandable map key that
  keeps live status visible, uses one land color, and lists evidence categories
  separately.

### Fixed

- Restore Iceland at 0 Ma from a regional-scale 1:50m observed land outline
  and show only bounded model-pose volcanic material at older supported ages,
  split across the Cao North America–Eurasia ridge without treating 16.3 Ma as
  island birth.
- Add a public-domain Natural Earth 1:10m generalized 0–200 m shallow-marine
  context around modern Iceland, active only at exactly 0 Ma, and keep shelf
  and land meshes clear and ordered with measured display-only shell bounds.
- Restore three Barents and Svalbard shelf polygons at 422 Ma using their
  matching Cao source lifetimes through 600 Ma; water depth remains unknown.
- Restore six European and Avalonian shelf lifecycles across the 410–420 Ma
  source cutoffs, using matching Cao boundary geometry and motion validated
  through 600 Ma.
- Make the timeline easier to acquire and drag on touch screens with a larger
  hit area, immediate thumb feedback, stable endpoint mapping and safe gesture
  cancellation.
- Make a locked position visible against light land and dark water with a
  small, steady dual-contrast ring and center dot, place it at the selected
  globe position, and preserve the user's current zoom when the lock is selected.

## [0.1.4] - 2026-09-12

### Added

- Add source-qualified regional material corrections for northern Canada,
  Pearya, Svalbard, Barents and western Laurentia, with static provenance,
  licensing, uncertainty, validation and performance records.
- Add a deterministic correction-package gate covering acquisition and
  compilation contracts, source checksums, emitted geometry and manifests.

### Changed

- Ship the live cao-v2.4 package over the full compiled Cao source domain
  (`ageDomainMa` 0–1800 Ma): 235 display checkpoints (5 Ma to 540 Ma, then
  10 Ma), layered coastline-class land over continental-outline shelf, native
  boundaries/ownership including `1800-1000_plate_boundaries.gpml`, and a
  shared motion palette sampled on every qualified source knot plus bounded,
  source-derived interior samples. Public transitive size stays under the
  50 MB Pages budget without PaleoDEM bins.
- Scrubbing continuously interpolates Cao plate motion from the resident shared
  palette between display knots, retargeting the published foundation in place
  instead of waiting for discrete prepare snaps. Adjacent checkpoints are
  prefetched only as a bounded aid on top of that interpolation.
- Timeline ranges are Phanerozoic (ICS 538.8–0 Ma) and Precambrian (authored
  deep-time / live Cao oldest through today at 0 Ma), so Precambrian mode can
  still scrub forward through the Phanerozoic; the Recent Earth range is removed.
- Age-domain gating and continuous play follow the live package `ageDomainMa`
  (cao-v2.4 declares 0–1800 Ma) rather than hard-coded ceilings.
- Replace two materially misleading western North America native charts with
  guarded, source-domain fragments whose lifecycles preserve independently
  supported old material and withhold younger or unknown-age domains.
- Remap affected modern-country reference segments to replacement domains and
  expose correction evidence, status and limitations in the interface.

### Fixed

- Recover empty globe after Cao package promotes that keep the same filenames:
  load verified assets with content-addressed `?h=<sha256>` URLs and `cache: no-store`
  so a stale browser/CDN body cannot fail checksum verification against a newer
  manifest (full-domain 0–1800 ship reused `cao-foundation-v1` paths).
- Keep Fennoscandia (and other Eurasian plates) visible through 118–120 Ma:
  cap adaptive refinement so the compiled palette retains explicit continuous
  bindings, and reject any package binding gap instead of inventing a
  nearest-endpoint pose.
- Refine native and correction motion intervals with pinned source-derived
  samples where endpoint interpolation exceeded the angular pose contract;
  oracle checks stay below `1e-5` radians across the affected native entry
  spans and correction bindings through 540 Ma.
- Keep continents visible when scrubbing to today (0 Ma): retain the last
  prepared foundation until the next exact-knot prepare is ready, withhold an
  actively failed exact checkpoint, and ignore that failure after a later age
  has successfully retargeted the surface.
- Precambrian timeline range again spans deep time through today (0 Ma): the
  scrubber is no longer clamped to ages older than ICS 538.8 Ma, and switching
  into Precambrian mode keeps the current age instead of jumping to the Cambrian
  base.
- Stop flooding `history.replaceState` on every continuous age tick while
  scrubbing or playing; coalesce explorer hash sync (~4 Hz) so Chromium does
  not throttle navigation IPC and hang the tab, while globe motion still
  interpolates every frame.
- Complete the material location-lock follow path: camera tracks the tagged
  Cao material through continuous scrub and chapter changes, with a subtle
  on-globe marker and an Unlock control while focus is active.
- Retarget source-linked globe markers on every continuous motion frame so
  anchors remain aligned with the moving foundation between display knots.
- Draw reference-guide labels as curved surface ribbons fixed in geographic
  space and replace upright pole sprites with flat polar sector ticks on the
  globe (globus-style guides).
- Keep corrected material, picking and dependent country references aligned
  through native precedence, source-age transitions and reconstructed motion.
- Subdivide long spherical correction triangles so their rendered edges follow
  the globe instead of visibly sagging through it.

### Known limitations

- Cao Caribbean / Panama at 0 Ma: Cuba land, shelf and `country:cub` are
  correctly placed; the oversized Cao `Jamacia` continental outline and missing
  Central/Eastern Panama (plates 230/229) coast/continent rings make the isthmus
  look broken or “crossed”. See `docs/research/cao-caribbean-panama-cuba.md`.
- This foundation deliberately uses neutral surfaces. Calibrated mountains,
  bathymetry, shallow-sea masks, global seafloor ages and historical biome
  detail are deferred; previous modern-only detail is no longer rendered.
- Native coast-class polygons are model geography, not independently validated
  exposed-land outlines. Unsupported country fragments and POIs are omitted.
- Correction footprints describe supported material domains, not exposed land,
  palaeoshorelines, elevation or exact terrane reconstructions. Northern
  Canada, Pearya, Svalbard and Barents retain explicit uncovered target areas;
  western replacements withhold material where source age or affinity remains
  unresolved.
- Display checkpoints coarsen to 10 Ma beyond 540 Ma so the Pages budget
  remains reachable; continuous motion still follows the qualified source-knot
  clock through 1800 Ma. Editorial chapter globe states may still apply where
  authored narrative exceeds the compiled evidence for a scene.

## [0.1.3] - 2026-09-10

### Changed

- Adopt Cao 2024 v2.4 as the sole reconstruction foundation, with 109 native
  checkpoints from 0–540 Ma and a shared, source-qualified motion clock.
- Store geometry once and use one GPU rendering path for present-day and
  ancient continents, country references and native tectonic boundaries.
- Replace the previous PALEOMAP conversion, modern-only relief inputs, terrain
  workers and caches with the native Cao package and bounded checkpoint loading.
- Preserve the orbital interface, chapter navigation, field notes, globe guides
  and WebGL2 fallback. Older chapters use explicitly editorial globe states.

### Fixed

- Load both authored Cao rotation files, including younger-age parent ties in
  the older-named file, to retain native US and Amazon geometry and its motion.
- Keep tagged material and supported POIs on the same coordinate authority as
  the globe, preserving camera distance through motion and support gaps.
- Bind integer motion-palette attributes correctly on WebGL2.
- Release superseded or unrenderable prepared states and withhold stale maps
  after failed age changes.
- Validate every nested scientific asset and its size and checksum.

### Known limitations

- This foundation deliberately uses neutral surfaces. Calibrated mountains,
  bathymetry, shallow-sea masks, global seafloor ages and historical biome
  detail are deferred; previous modern-only detail is no longer rendered.
- Native coast-class polygons are model geography, not independently validated
  exposed-land outlines. Unsupported country fragments and POIs are omitted.
- Continental motion interpolates on its qualified source clock. Native
  boundary and ownership geometry is available only at exact checkpoints.
- The initial package covers 0–540 Ma; the model's older domain is not yet
  compiled into the application.

## [0.1.2] - 2026-09-10

### Added

- Shared land/ocean period coordinates, material-registered elevation interpolation,
  and a selectable Cao 2024 v2.4 view with partial continental conversion,
  source-native ocean boundaries and explicitly inferred seafloor relief.
- All 109 PALEOMAP frames from 0–540 Ma, with native source-age navigation,
  compact signed-elevation assets and bounded abortable caches.
- Modern Alps and Japan ETOPO views, bringing the regional set to seven,
  and explicit shared surface-water/seafloor use of compatible controls.
- An all-age exposed-seafloor view and a cited palaeomap source/acquisition study.

### Changed

- Terrain color and mountain rock/shading strength follow physical height,
  local relief and climate potential; synthesized detail stays in shading.
- Source-local relief, blue bathymetric shading, closer aerial inspection,
  restrained country outlines and smaller surface-oriented labels and markers.
- Neighbor-aware tile allocation uses the existing detail and memory limits.

### Fixed

- Include the canonical third-party notices in the Pages bundle and validate
  that the packaged copy matches.
- Check country-outline budgets separately for every source age, retaining full
  coverage without an aggregate test timeout.
- Removed the rectangular shading wall at the Mid-Atlantic regional relief boundary.
- Keep old surface textures alive until visible terrain releases them, preventing
  WebGPU invalid texture submissions during historical regional transitions.
- Tagged locations retain zoom while following reconstructed coordinates.
- Fractional-age refinement no longer repeatedly reinserts stale mesh fields
  into the terrain cache and prevents the next surface from publishing.
- Exact present-day publication restores immutable native geometry and materials
  directly, avoiding redundant temporal calculations while preserving relief changes.
- Automatic focus prepares final camera refinement once; manual input cancels
  the automatic move and resumes normal navigation.

### Known limitations

- Close terrain remains coarse and generalized relative to satellite-map references.
  The Caledonian collapse history and detailed ancient valleys are not resolved.
- Historical all-stage preparation remains slightly above the conservative
  500 ms comparison, although the original material preparation and steady-frame
  targets pass on the measured machine.

## [0.1.1] - 2026-09-09

### Added

- Sparse, age-aware regional surface refinements with a two-level EMODnet DTM
  2024 bathymetry example for the central North Sea.
- Subtle terrain-anchored poles, Hadley boundaries, east/west references and
  dominant-wind guides, available from the layers menu.
- Temporal area anchors that retain exact reconstructed feature identity
  through movement, disappearance and reappearance between periods.

### Changed

- Restyled modern-country locator outlines as subdued, batched ribbons inlaid
  into the displayed terrain and anchored through relief exaggeration.
- Made Natural Earth geometry authoritative for present-day land masking while
  retaining signed PaleoDEM controls for historical snapshots.
- Filtered Field Notes to the currently selected period and refined globe-click
  focus toggling.
- Reduced refresh work with bounded cloud resolution, shared geometry buffers,
  deferred overlay rebuilding and debounced camera refinement requests.

### Fixed

- Removed the local material override that exposed the North Sea refinement as
  a dark rectangular footprint.
- Eliminated the polar inspection-light jump and strengthened pole-safe surface
  sampling.
- Corrected land/sea material classification around coastlines and prevented
  country references from floating above exaggerated relief.

## [0.1.0] - 2026-09-09

### Added

- Interactive WebGL/WebGPU-capable orbital globe with regional zoom, adaptive
  detail, bounded worker-generated surfaces and accessible controls.
- Thirty-seven chapters from 4.567 Ga to the present, including explicit
  early-Earth illustrative stages and distinct story and geography-source ages.
- Eighteen compact PALEOMAP PaleoDEM surface controls, reconstructed modern
  country references, tectonic stories and twenty sourced points of interest.
- Modern 1991–2020 Köppen–Geiger climate controls and five lazy ETOPO regional
  relief patches for repeatable landscape views.
- Offline data preparation with pinned downloads, provenance, licensing,
  checksums and published artifact bounds.
- Unit, data-contract and Pages-subpath browser tests, plus a GitHub Pages
  validation and deployment workflow.

### Changed

- Replaced the pole-prone globe sampling with an adaptive cube surface and
  pole-safe fallback/cloud geometry while preserving source geography.
- Draped country, tectonic and river overlays against the displayed relief so
  they remain surface-anchored through 1×–30× exaggeration.
- Consolidated secondary controls into an accessible menu, simplified the
  timeline scale control, added a reference to every period, and made the
  mobile period card compact by default.
- Added explicit POI, place and area focus state with predictable
  activate/clear globe clicks and shareable URLs.
- GitHub Pages now deploys the validated production artifact automatically
  after every successful push to `main`.

### Known limitations

- Early-Earth geography and detailed ancient climate, ice and drainage are
  inferred or illustrative rather than spatial observations.
- Some measured initial and regional scene transitions exceed the current
  500 ms readiness target.
- The project does not yet grant a license for its own source code; bundled
  dependencies and scientific data retain the terms in
  `THIRD_PARTY_NOTICES.md`.
