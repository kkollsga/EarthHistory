# North Sea basin edits to the Cao 2017 palaeo-coastlines

Research and compile date: 2026-09-15. Contract:
`data/corrections/palaeo-coastlines/basins/north-sea.json`. Companion to
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say) and
[palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md) (what the source
is). Two targeted literature records feed the Jurassic and Palaeogene
operations:
[palaeo-coastlines-north-sea-middle-jurassic.md](palaeo-coastlines-north-sea-middle-jurassic.md)
and
[palaeo-coastlines-north-sea-eocene-shetland.md](palaeo-coastlines-north-sea-eocene-shetland.md).
This record says what was measured, what was changed, and what was left
alone.

Every statement below is tagged. **Measured** means a number this session
computed from the pinned Cao et al. (2017) archive or from the compiled
payloads. **Sourced** means a claim of a named publication. **Inferred** means
EarthHistory's own reading, choice of outline, or mapping onto the Cao
intervals.

## Rights, and what "edit" means here

**Sourced/rights.** Every publication named here is citation-only. No figure,
map plate, polygon, coordinate list or table from any of them is traced,
digitised, copied or redistributed. The two NSTA/OGA regional map packages are
read as *facies descriptions* — which environments are marine and which are not
— and their stated map extents are used as metadata; their geometry is not
reproduced, and their File Geodatabases are not build inputs. Both are Open
Government Licence v3.0. The only redistributed palaeogeographic geometry in
this program remains Cao et al. (2017), CC BY 3.0.

**Inferred.** Every edited outline is EarthHistory's own coarse construction,
five to seven vertices, sized from the descriptions and the stated latitudes in
the cited text. Each operation declares a spatial uncertainty of 40–60 km, which
is the uncertainty of the *constraint*, not the spacing of the vertices. Cao's
own coastline tolerance is about 30 km at best and 500 km at its PBDB search
radius, so these outlines are coarse on purpose.

## What Cao 2017 draws in the North Sea, measured

**Measured**, this session, from the pinned archive: the `lm` and `sm` unions
clipped to the contract window (−5°E…9°E, 53°N…62.5°N, spherical area
871,547 km²), per canonical interval. `land %` and `sea %` are percentages of
the window and overlap, because a `lm` and an `sm` record may cover the same
ground. Nine of the twenty-four intervals are listed; the rest are in the probe
output referenced at the end.

| Interval (Ma) | land % | shallow % | East Shetland Platform | Viking Graben | Moray Firth | Central Graben | southern North Sea |
|---|---:|---:|---|---|---|---|---|
| 402–380 | 91.2 | 35.6 | land | land | land | land + sea | land |
| 380–359 | 87.3 | 9.4 | land | land | land | land | land |
| 269–248 | 41.7 | 53.4 | sea | sea | sea | sea | sea |
| 248–224 | 95.4 | 3.0 | land | land | land | land | land |
| 224–203 | 95.1 | 0.0 | land | land | land | land | land |
| 179–166 | 58.6 | 26.1 | sea | sea | land | land | land |
| 166–146 | 41.6 | 96.6 | sea | sea | sea | sea | sea |
| 58–49 | 41.8 | 87.1 | sea | sea | land + sea | sea | sea |
| 49–37 | 33.3 | 63.7 | sea | sea | sea | sea | sea |

**Inferred.** Three patterns in that table are wrong at basin scale against the
published record, and they are what this phase edits: a shallow sea over the
Middle Devonian Orcadian Basin, a flooded Moray Firth in the Zechstein, and a
flooded East Shetland/Shetland Platform in the Middle Jurassic and the
Palaeogene. A fourth operation is not a correction at
all, and the table above cannot show it because the table only counts the two
shipped classes: at 179–166 Ma the Scottish landmass north of the Moray Firth is
Cao's **mountain** class, which EarthHistory compiles and validates but does not
publish, so with `lm` and `sm` alone it reaches the browser as unmapped crust.
That operation restates Cao's own classification in a class we ship.

## The twelve operations

Areas are **measured** by the compiler during the run, inside the contract
window and restricted to the operation's own interval. "dissolved" is the change
in ground the class actually covers; the summed figure in the compile record
double-counts records of one class that overlap, so the dissolved figure is the
one quoted here.

| # | Interval | Operation | Class change | Δ area (km²) | Uncertainty | References |
|---|---|---|---|---:|---:|---|
| 1 | 402–380 | `…-orcadian-remove-shallow` | shallow removed | −68,404 | 60 km | Andrews & Hartley 2015; Marshall et al. 1996; NSTA CNS/MF |
| 2 | 269–248 | `…-moray-firth-remove-shallow` | shallow removed | −16,487 | 40 km | NSTA CNS/MF; Tucker 1991; Peryt et al. 2010 |
| 3 | 269–248 | `…-moray-firth-add-land` | land added | +16,487 | 40 km | NSTA CNS/MF; Glennie 1972; Tucker 1991 |
| 4 | 179–166 | `…-east-shetland-platform-remove-shallow` | shallow removed | −32,429 | 50 km | Fjellanger et al. 1996; Husmo et al. 2003; NSTA NNS/ESP |
| 5 | 179–166 | `…-east-shetland-platform-add-land` | land added | +36,596 | 50 km | Fjellanger et al. 1996; Husmo et al. 2003; NSTA NNS/ESP |
| 6 | 179–166 | `…-brent-delta-plain-remove-shallow` | shallow removed | −16,407 | 60 km | Fjellanger et al. 1996; Helland-Hansen et al. 1992; Husmo et al. 2003 |
| 7 | 179–166 | `…-brent-delta-plain-add-land` | land added | +16,701 | 60 km | Fjellanger et al. 1996; Helland-Hansen et al. 1992; Underhill & Partington 1993 |
| 8 | 179–166 | `…-scottish-landmass-add-land` | land added | +17,061 | 60 km | Cox & Sumbler 2002; Johnson et al. 1993; Underhill & Partington 1993; NSTA CNS/MF |
| 9 | 58–49 | `…-shetland-platform-remove-shallow` | shallow removed | −32,229 | 60 km | Anell et al. 2012; Ahmadi et al. 2003; Jones et al. 2001; NSTA NNS/ESP |
| 10 | 58–49 | `…-shetland-platform-add-land` | land added | +14,652 | 60 km | Anell et al. 2012; Ahmadi et al. 2003; Jones et al. 2001 |
| 11 | 49–37 | `…-shetland-platform-remove-shallow` | shallow removed | −25,987 | 60 km | Anell et al. 2012; Jones et al. 2003; NSTA NNS/ESP |
| 12 | 49–37 | `…-shetland-platform-add-land` | land added | +29,292 | 60 km | Anell et al. 2012; Jones et al. 2003 |

Totals, **measured**: 130,789 km² of landmass added and 191,943 km² of shallow
marine removed, across five of the twenty-four intervals. A land addition is
smaller than its own polygon wherever Cao already carried land there — operation
10 adds 14,652 km² inside a 32,229 km² outline because roughly half of the
Shetland Platform was already land at 58–49 Ma, and operation 8 adds
17,061 km² inside a 20,045 km² outline for the same reason.

### 402–380 Ma — the Orcadian Basin is a lake in a continent, not a sea

**Measured.** Cao draws land across 91.2 % of the window and a shallow-marine
polygon over 35.6 % of it, including the Moray Firth and the western Central
North Sea; at (1.5°E, 58°N) the source carries both classes.

**Sourced.** The Middle Devonian Orcadian Basin is a cyclic lacustrine and
alluvial succession on the Old Red Sandstone continent, with facies "upper and
lower shoreface, deep lake, shallow lake, playa, turbidite and fluvial" and
bed-scale correlation over about 160 km (Andrews & Hartley 2015). The NSTA/OGA
Central North Sea and Moray Firth Devonian depositional-facies sheet maps
alluvial fan sandstones, alluvial plain with braided rivers, lacustrine mud- and
sandstones (which it names as the Orcadian Lake), sabkha, shelf carbonates and
uplands, and states the map is "of a speculative nature especially in the
eastern part of the area". Marine incursions entered the Orcadian "from the east
along the Tornquist Zone at the margin of the Fenno-Scandian High" and are dated
late Givetian to Frasnian (Marshall et al. 1996).

**Inferred.** Those incursion ages fall in the *next* Cao interval, 380–359, not
in 402–380, so a shallow sea over the Orcadian at 402–380 has no support. The
edit removes the shallow-marine class from a rectangle covering the NSTA map's
own stated area (−4.9°E…3°E, 56.3°N…59.5°N) and leaves the Cao landmass
untouched. The rectangle is the map's coverage plus a margin; it is not an
outline of the basin, and saying so is the point.

**What is still not drawn.** The Orcadian Lake itself. A lake is not the
shallow-marine class and the compiler has no lacustrine class, so the honest
result is land plus this limitation, not a blue inland sea. East of 3°E the
shallow-marine polygon is left exactly as Cao drew it.

### 269–248 Ma — the Moray Firth in the Zechstein

**Measured.** Cao floods 53.4 % of the window, including the whole Moray Firth;
at (−2°E, 57.9°N) the only class is shallow marine.

**Sourced, verbatim.** The NSTA/OGA Zechstein depositional-facies sheet for the
Central North Sea and Moray Firth: "There is a clear split in the area in terms
of depositional facies; the Central North Sea is characterised by an evaporitic
basin subject to periodic marine flooding (Northern Permian Basin) whilst more
continental and proximal sedimentation took place in the Moray Firth." Tucker
(1991) describes the Zechstein as a periodically isolated carbonate–evaporite
basin whose behaviour ranges from incomplete drawdown to complete desiccation,
with carbonates "mainly deposited on shallow-water platforms around the basin".

**Inferred.** The Moray Firth is drawn as land, an ENE-trending seven-vertex
outline (−4°E…0°E, 57.25°N…58.6°N), and the Central North Sea evaporite basin
east of it is left exactly as Cao drew it, because that is what the same
sentence supports. Uncertainty 40 km.

**What is still not drawn.** "Land" here means emergent-to-proximal continental
ground, not dry ground: the same NSTA series maps the Rotliegend as low-lying
desert, sediment plain with dune fields and playas, and lacustrine mudstones,
none of which the compiler can express. And one Cao bin has to hold both the
Rotliegend desert — a basin "up to 2,000 km long and 500 km wide" (Glennie 1972)
— and the Zechstein Sea that drowned it. A maximum-transgression bin keeps the
marine end member; the desert phase is unrepresentable here.

### 179–166 Ma — the East Shetland Platform, the Brent delta and the
Scottish landmass

**Measured.** Cao carries land over the Central North Sea and the Central Graben
at this interval, which matches the published Mid-Jurassic dome, but draws the
East Shetland Platform and Shetland as shallow marine from 60°N to 62.5°N.

**Sourced.** The Brent delta prograded in the Late Aalenian to Early Bajocian;
"The Early Bathonian delta retreat took place in retrogressive pulses … forming
an estuary in the Southern Viking Graben and gradually drowning the deltaic
system in the Northern Viking Graben"; a second, Vestland deltaic progradation
ran "from the Central Viking Graben to ca. 60°30′N" (Fjellanger et al. 1996;
Helland-Hansen et al. 1992). The NSTA/OGA Northern North Sea and East Shetland
Platform Aalenian–Bathonian sheet carries "Shallow marine shelf and delta top
sands" beside "Non-marine deposition and erosion"; the Central North Sea
Bathonian sheet carries only "Coastal and alluvial plain heterolithics" and
"Uplands". Regional doming from a plume head "> 1250 km diameter" made the
Central North Sea emergent and was followed by "progressive pre-rift,
Aalenian–early Bathonian marine onlap" as it deflated (Underhill & Partington
1993).

**Inferred.** Three edits. The platform west of the graben shoulder
(−2.6°E…0.8°E, 60.3°N…62.4°N) is drawn as land, because a source area that
supplies clastics is subaerial. The delta plain is drawn as land in a corridor
from the Central North Sea north to the published 60°30′N limit (1°E…3.4°E,
58°N…60.5°N). The graben axis north of that limit stays marine, which is where
the delta drowned.

The third is not a correction to Cao at all — it restates Cao's own
classification in a class we publish. Round 2 of the visual review reported the
present-day point (−3°E, 58.8°N) rendering as crust-blue “depth unmapped” at
170 Ma while the Moray Firth 90 km to the south was land. **Measured**, from the
pinned archive at 179–166 Ma: that ground carries Cao's **mountain** class and
neither `lm` nor `sm`. Of the 20,045 km² the outline covers, 17,742 km² is
mountain, 2,121 km² is ground Cao already maps as landmass, 883 km² falls inside
the East Shetland Platform operation above, and 209 km² (1.0 %) carries no Cao
class at all. Cao et al. (2017) treat mountain as terrestrial, so **the source
already says this ground was land**; it reaches the browser as water only
because the published class set is `lm` + `sm` (user decision, 2026-09-15). Any
claim that Cao drowns Scotland at 179–166 Ma would be false, and the contract
says so in as many words. The neighbouring intervals are a different question:
at 203–179 and 166–146 Cao draws shallow marine across this ground and has no
mountain record here at all, which
[palaeo-coastlines-north-sea-middle-jurassic.md](palaeo-coastlines-north-sea-middle-jurassic.md)
identifies as a genuine, well-supported literature disagreement at 166–146 and
which this contract does not touch.

**Sourced**, as an independent check on the sign only: “During the Jurassic
Period, much of Scotland remained land; only the Inner Hebridean area and Moray
Firth Basin were occupied by shallow seas to the margins of which the onshore
outcrops are now restricted” (Cox & Sumbler 2002); the West Fair Isle Basin
“extends from the east of Orkney to south-west of Shetland, and is bounded to
the west by the Orkney–Shetland Platform” (Johnson et al. 1993); regional doming
from a transient plume head “> 1250 km diameter” truncated stratigraphy
“throughout the North Sea domain” (Underhill & Partington 1993); and the NSTA/OGA
Central North Sea and Moray Firth Middle Jurassic Bathonian depositional-facies
sheet carries only “Coastal and alluvial plain heterolithics” and “Uplands” in
the Moray Firth's western hinterland.

**Inferred.** The outline (−4.96°E…−1.35°E, 58.0°N…60.42°N, seven vertices) is a
coarse envelope of Cao's own Middle Jurassic mountain records over northern
Scotland, the Pentland Firth and Orkney; the choice to publish that ground as
landmass rather than leave it unclassified is EarthHistory's. It moves neither
of Cao's boundaries: **measured**, 0 km² of it falls on the 179–166 Ma
shallow-marine class, so no `remove-shallow` companion is needed, and the
compiler records a dissolved gain of 17,061 km². South of about 59.4°N the four
sources above corroborate the class independently; north of it, between Orkney
and the Shetland Platform, 7,190 of 7,400 km² is Cao mountain and the
restatement is the whole warrant, because no retrieved source places a Middle
Jurassic shoreline there. The Middle Jurassic memo's recommended
literature-only extent stops at about 59.4°N for exactly that reason; this
operation goes further north on Cao's classification, not on the literature, and
the contract's `claimOrInference` says which is which. Uncertainty 60 km.

**A name that must not migrate.** The Orcadian Basin is **Devonian**. The
Jurassic name for this ground is the Scottish landmass / Orkney–Shetland
Platform, which is why the operation is `…-scottish-landmass-add-land` and not an
“Orcadian” one.

**What is still not drawn.** Relief. “Land” here is the flat landmass class; the
mountain tint the third Cao class would carry is not published, and neither is
the rest of the mountain class — 125,464 km² of it inside this contract window
alone carries neither shipped class at this interval. Six polygons cannot close
a global class gap; see “One open limitation this round exposed” below.

**The honest limitation.** One Cao interval holds an advance, a retreat and a
second advance. These edits render the *maximum* extent, which is the only state
a single geometry can carry, and the map key's "a map interval records the
minimum land and maximum flooding mapped anywhere in that bin" line is doing
real work here. The Central North Sea dome needed no edit: Cao already draws it
as land.

### 58–49 and 49–37 Ma — the emergent Shetland Platform

**Measured.** Cao draws the Shetland Platform as shallow marine at both
intervals; at (−1.5°E, 60.5°N) the source carries land and shallow marine at
58–49 and shallow marine alone at 49–37.

**Sourced.** "The Shetland Platform supplied sediment continuously, although at
varying rates, until the latest Cenozoic" (Anell et al. 2012). The NSTA/OGA
Northern North Sea Forties and Sele sheets carry a "Non-marine deposition" class
against shelf, slope and basinal mudstones. "Transient uplift of 300–600 m
occurred at the Paleocene–Eocene boundary, followed by subsidence of 500–800 m"
(Jones et al. 2001). Cao's own authors record that fewer than 20 marine fossil
collections constrain the whole globe in 37–29 Ma against more than 4,000 in
269–248, so Palaeogene geometry is their least-tested.

**Inferred.** The platform (−3°E…0.2°E, 59.8°N…61.8°N) is drawn as land in both
intervals. The outline stops well short of the Faroe–Shetland Basin to the
north-west, which was a deep marine trough. It does not change between 58–49 and
49–37 because nothing retrieved constrains how it changed: the interval boundary
there is a change of evidence, not a change of coastline, and the contract says
so rather than implying a stable shore. Uncertainty 60 km in both. The targeted
Palaeogene record
[palaeo-coastlines-north-sea-eocene-shetland.md](palaeo-coastlines-north-sea-eocene-shetland.md)
reaches the same outline independently and recommends two refinements this round
did not make: attach the Middle Eocene shelf and provenance sources to the 49–37
operation in place of the thin `jones-2003` + `anell-2012` pairing, and raise the
uncertainty **on the eastern edge alone** from 60 km to 75 km, because no
retrieved source places a Palaeogene shoreline anywhere between 0°E and 1.2°E.

**The eastern limit is a decision, not an oversight.** Round 2 of the visual
review asked whether the East Shetland Platform *proper* — east of the outline,
around (0.5°E, 61°N) — should also be land in the Lutetian–Bartonian, since it
renders shallow marine beside an emergent Shetland Platform. It should not, on
the retrieved record. The emergence statement these operations rest on names the
**Shetland Platform** as a sediment source, not the platform east of it. The
NSTA/OGA Northern North Sea and East Shetland Platform **Eocene – Alba** sheet —
the Middle Eocene sheet, i.e. this Cao interval — describes that ground as “shelf
sandstones of the Middle Mousa Formation and deep-water sandstones belonging to
the Caran Sandstone Member”, and its facies legend runs shelf sands, shelf
mudstones, slope mudstones, basin and slope sands and basinal mudstones beside a
single “Non-marine deposition” class; the Millennium Atlas Eocene chapter has a
deep-marine central basin with submarine-fan systems fed from a western source
(Jones et al. 2003). A shelf is submerged. So the sources put the East Shetland
Platform under water in this interval and the emergent ground west of it, where
the operation already draws it, and the outline is not extended east. The
decision is carried as a gate, not only as prose: the validator now holds an
unedited control at (0.5°E, 61°N) in 49–37 that must stay shallow marine, so a
later eastward extension without a citation fails instead of passing quietly.

## What was deliberately left alone

| Interval(s) | Subject | Why no edit |
|---|---|---|
| 380–359 | Devonian marine incursions | **Measured:** Cao already draws the Orcadian as land and puts its only shallow-marine polygon inside the window on the south-eastern, Tornquist-facing margin — the direction the incursions came from. **Sourced:** the incursions are episodic and sub-interval. No retrieved source gives a plan-view extent; an edit would be invention. |
| 248–224, 224–203 | Triassic dryland | **Measured:** Cao is already 95.4 % and 95.1 % land here. **Sourced:** drainage was "dominantly endorheic … terminated in playa, aeolian dune, sabkha or marsh settings" (McKie & Williams 2009); both NSTA packages map only alluvial-plain, fluvial and upland classes. Cao is right. The one shallow-marine polygon at 248–224 sits on the south-eastern margin outside both NSTA map areas and is not constrained by anything retrieved here. What Cao cannot express is the standing water — playa, sabkha and salt lake are not `sm`, and there is no lacustrine class. That is a limitation, not an edit. |
| 166–146, 146–135 | Late Jurassic rift seaways, Kimmeridge Clay | **Measured:** Cao already draws the Viking Graben, Central Graben, Moray Firth and Danish–Norwegian basin as shallow marine at both, and already carries emergent ground over Scotland, Norway and the Horda Platform at 146–135. **Inferred:** what the literature adds is either an environment Cao has no class for (anoxia; the mid-*eudoxus* δ¹³C event) or geometry finer than the evidence — Roberts et al. (2019) predict "numerous isolated footwall islands" at the Base Cretaceous, but that is backstripped **model output at one age**, and drawing islands from it would assert a precision neither the model nor Cao's ~30 km floor supports. |
| 94–81, 81–58 | Late Cretaceous Chalk sea and platform flooding | The literature memo flags this as insufficiently constrained and it is untouched. Cao renders the window as dominantly shallow marine, which has the right sign for a deep epicontinental Chalk sea. How far the Chalk flooded the Shetland Platform and the other basin-margin highs, and when, is not settled by anything retrieved. 81–58 additionally merges the whole Chalk sea with the Palaeocene, so no single geometry can be right for both halves. |
| 58–49 | Forties fan provenance | The memo flags provenance as unresolved and no edit rests on it. The Shetland Platform operations rest on the continuous-supply statement and the non-marine facies class instead, and the basin east of the platform is untouched. |
| 49–37 | The East Shetland Platform proper, east of 0.2°E — see also [the Palaeogene Shetland memo](palaeo-coastlines-north-sea-eocene-shetland.md) | **Sourced:** the NSTA/OGA Eocene – Alba sheet — the Middle Eocene, i.e. this interval — describes that ground as “shelf sandstones of the Middle Mousa Formation and deep-water sandstones belonging to the Caran Sandstone Member”, and the Millennium Atlas Eocene chapter has a deep-marine central basin fed from a western source. The one emergence statement (Anell et al. 2012) names the Shetland Platform, which the operation already draws as land. **Inferred:** a shelf is submerged, so the platform stays shallow marine and the land is not extended east. Carried as an unedited control at (0.5°E, 61°N) so a later extension fails a gate. |
| 269–248 | Northern limit of the Zechstein Sea | **Measured:** Cao floods parts of the East Shetland Platform and the northern Viking Graben. **Sourced:** the NSTA northern North Sea Permian sheet carries both an evaporite-basin class and a non-marine class there and marks the Zechstein "thin or absent" over parts of the platform. **Inferred:** nothing retrieved places the northern shoreline, and the Zechstein Sea's connection to the Boreal ocean may have run through exactly this area. No edit. |

## How the edits are carried and shown

**Measured**, from the compiled catalogs:

- Charts: one synthetic `lm` source record per `add-land` operation, six of them
  after this round (`north-sea-269-248-moray-firth-add-land`,
  `…-179-166-east-shetland-platform-add-land`, `…-179-166-brent-delta-plain-add-land`,
  `…-179-166-scottish-landmass-add-land`, `…-58-49-shetland-platform-add-land`,
  `…-49-37-shetland-platform-add-land`). `sm` stays at 13,395 records: a removal
  edits an existing record rather than adding one.
- Evidence rows, interned one per distinct reference set: `lm` 8 (the Cao base
  row, six basin edits and the LGM lowstand row), `sm` 7. The base row keeps `status: classified-map-polygon`; every edited row
  carries `status: derived-from-published-source`, the edit's reference
  `sourceIds` appended to `cao-2017-paleogeography`,
  `matthews-2016-plate-boundaries` and `cao-v2.4-static-partitions`, and an
  `editorial` line "EarthHistory modification after &lt;refs&gt;". One `sm` row
  merges two operations' references because a single Cao record was edited by
  both the East Shetland Platform and the Brent delta operations. The map key
  and the Sources panel read these rows, so a reference is on screen whenever an
  edited chart is.
- Payload bytes, this round: `lm` 3,414,276 → 3,415,378 (+1,102) from the one
  added operation; `sm` unchanged at 3,519,149, because the Orcadian upland edit
  touches no shallow-marine record. Only the 179–166 Ma payload changed; the
  other twenty-four are byte-identical, which is the scoping rule holding in
  practice. The published set is 7,036,077 bytes over 54 files against the
  7,340,032 byte budget (303,955 bytes of headroom), and the renderer
  reservation is unchanged: 297,114 vertices and 457,098 triangles, with the
  worst interval untouched.
- Added land binds to the Cao 2024 static partition that owns the ground, so
  inside this window it rides the EarthHistory North Sea rigid UK-block
  restoration exactly as the native charts do. The validator's restoration check
  covers the added pieces along with the rest.

## Gates

All run 2026-09-15 in the pinned pyGPlates environment.

| Gate | Result |
|---|---|
| `palaeo_coastlines_compile.py --classes lm,sm,m` | pass, 120 s. Area preservation 100.0000 % (`lm`), 100.0000 % (`sm`), 100.0002 % (`m`) |
| `palaeo_coastlines_correction.py --classes lm,sm,m --report` | **pass**, 71 s. 12 operations, 22 contract references, 7 basin-edit witnesses changed and 5 unedited controls unchanged |
| `palaeo_coastlines_correction.py --self-test` | **pass**, 24 mutations rejected |
| `palaeo_coastlines_qc.py --classes lm,sm,m` | **pass**. Worst simplification area error 0.0098 %, worst lost piece 27.8 km², narrow-feature change 0.0 km |
| `promote_palaeo_coastlines.py` | **pass**, 54 files, 7,036,077 bytes |
| `validate_palaeo_coastlines_runtime.py` (+ `--self-test`) | **pass**, 15 mutations rejected |
| `make check-corrections` | **pass** |
| `make gate` | **pass** |

Four gates are new or newly scoped in this phase, each proven red by a
deliberate mutation and then restored:

1. an operation whose geometry is translated outside the contract's window bbox;
2. an operation naming an interval the contract's `intervals[]` does not declare;
3. a payload shifted off its own basin edit (the class the edit put there is no
   longer at the witness point);
4. a basin-edit witness whose operation has been deleted from the contract.

The two witnesses added in this round were proven red the same way before they
were trusted (R1):

- the Eocene control at (0.5°E, 61°N) was proven by extending both 49–37
  Shetland Platform operations east to 1.2°E, recompiling and re-validating:
  *basin-edit witness east-shetland-platform-eocene at 49-37: compiled classes
  ['lm'], the contract expects ['sm'] (operations none: this is an unedited
  control)*. The contract was restored and recompiled.
- the Mid-Jurassic witness at (−3°E, 58.8°N) was proven by deleting
  `north-sea-179-166-scottish-landmass-add-land` from the contract, recompiling
  and re-validating: *basin-edit witness scottish-landmass-mid-jurassic:
  operations ['north-sea-179-166-scottish-landmass-add-land'] are not in any
  tracked basin contract*. The contract was restored and recompiled.

Two scope rules are now enforced in the compiler rather than trusted. An
operation's intervals must be contiguous in the canonical schedule, because an
`add-*` record carries one `(TOAGE, FROMAGE]` lifecycle and a gap in the list
would silently edit the interval between. And a source record an operation edits
must stay inside that lifecycle: geometry is held per record, not per interval,
so editing a record that is also active outside the declared intervals would
move the coastline at an age the contract never cites. **Measured:** the four
off-schedule `lm` records inside this window all sit *within* a single canonical
interval, and `sm` has none there, so no operation in this contract trips the
rule — but a future one that would is refused instead of leaking.

The area-preservation gate is also basin-edit aware now. It measures what the
cookie-cut costs, so a cited edit belongs on the source side of the ratio rather
than appearing as lost or invented ground; the validator re-applies the contract
to the pinned archive through the compiler's own code path rather than reading
the numbers back from the catalog under test.

## One open limitation this round exposed

The Scottish-landmass finding is a local instance of a global one, and the global one is
outside this contract's scope. **Measured** over the pinned archive, for every
canonical interval, the Cao 2017 mountain class that carries neither `lm` nor
`sm`, and the part of it that lies inside the Cao 2024 continental crust the
globe draws as blue "depth unmapped":

| Interval | mountain-only (km²) | of which inside Cao 2024 crust (km²) |
|---|---:|---:|
| 179–166 | 4,704,094 | 3,903,221 |
| 49–37 | 16,050,826 | 15,832,772 |
| 20–11 | 23,869,977 | 23,595,938 |

Mountain-only ground is present in all twenty-four intervals, from 2.1 Mkm² at
285–269 Ma to 23.9 Mkm² at 20–11 Ma. Wherever it falls inside the crust extent
the browser paints emergent orogen as water of unknown depth, because the
published class set is `lm` + `sm`. Six cited North Sea polygons cannot fix a
global class gap; shipping the third class is a budget and product decision
(the compiled `m` payload is 1,198,290 bytes against 303,975 bytes of remaining
headroom), so it is preserved as a backlog item rather than decided here.

## One compiler follow-up closed

`outline-tones.json` indexed the mountain class, which is compiled and validated
offline but never published. **Measured:** it also *inked outlines dark over
mountain geometry the browser never receives* — 4,916 dark segments at 402–380
Ma against 4,655 once the class list is honest, so 261 country-outline segments
were drawn as if over land that does not ship. The compiler now takes
`--shipped-classes` (default `lm,sm`), colours tone tables from that list alone,
indexes only those classes, records the list as `shippedClasses` in the
catalog, and rewrites the tone legend to name them.
`promote_palaeo_coastlines.py` refuses to publish staged tables whose
`shippedClasses` disagrees with what it copies, and refuses before it removes
the published directory, so a mismatch leaves the existing package intact.

## Reproduction

```
PY=../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python
$PY scripts/research/palaeo_coastlines_compile.py --classes lm,sm,m
$PY scripts/research/palaeo_coastlines_correction.py --classes lm,sm,m --report
$PY scripts/research/palaeo_coastlines_correction.py --self-test
$PY scripts/research/palaeo_coastlines_qc.py --classes lm,sm,m
python3 scripts/research/promote_palaeo_coastlines.py
python3 scripts/research/validate_palaeo_coastlines_runtime.py
make check-corrections
```

The validation record is
`dev-docs/bench/results/palaeo-coastlines-validation.json` and the node-reduction
record `dev-docs/bench/results/palaeo-coastlines-qc.json`; the per-operation area
table lives in the offline provenance sidecars under `basinEdits`, which never
ship. The Cao baseline table above was measured by a throwaway probe over the
pinned archive; the same numbers can be re-derived by unioning each class's
active records per interval and clipping to the contract window.
