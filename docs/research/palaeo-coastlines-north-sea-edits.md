# North Sea basin edits to the Cao 2017 palaeo-coastlines

Research and compile date: 2026-09-15. Contract:
`data/corrections/palaeo-coastlines/basins/north-sea.json`. Companion to
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say) and
[palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md) (what the source
is). This record says what was measured, what was changed, and what was left
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
Palaeogene.

## The eleven operations

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
| 8 | 58–49 | `…-shetland-platform-remove-shallow` | shallow removed | −32,229 | 60 km | Anell et al. 2012; Ahmadi et al. 2003; Jones et al. 2001; NSTA NNS/ESP |
| 9 | 58–49 | `…-shetland-platform-add-land` | land added | +14,652 | 60 km | Anell et al. 2012; Ahmadi et al. 2003; Jones et al. 2001 |
| 10 | 49–37 | `…-shetland-platform-remove-shallow` | shallow removed | −25,987 | 60 km | Anell et al. 2012; Jones et al. 2003; NSTA NNS/ESP |
| 11 | 49–37 | `…-shetland-platform-add-land` | land added | +29,292 | 60 km | Anell et al. 2012; Jones et al. 2003 |

Totals, **measured**: 113,728 km² of landmass added and 191,943 km² of shallow
marine removed, across five of the twenty-four intervals. A land addition is
smaller than its own polygon wherever Cao already carried land there — operation
9 adds 14,652 km² inside a 32,229 km² outline because roughly half of the
Shetland Platform was already land at 58–49 Ma.

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

### 179–166 Ma — the East Shetland Platform and the Brent delta

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

**Inferred.** Two edits. The platform west of the graben shoulder
(−2.6°E…0.8°E, 60.3°N…62.4°N) is drawn as land, because a source area that
supplies clastics is subaerial. The delta plain is drawn as land in a corridor
from the Central North Sea north to the published 60°30′N limit (1°E…3.4°E,
58°N…60.5°N). The graben axis north of that limit stays marine, which is where
the delta drowned.

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
so rather than implying a stable shore. Uncertainty 60 km in both.

## What was deliberately left alone

| Interval(s) | Subject | Why no edit |
|---|---|---|
| 380–359 | Devonian marine incursions | **Measured:** Cao already draws the Orcadian as land and puts its only shallow-marine polygon inside the window on the south-eastern, Tornquist-facing margin — the direction the incursions came from. **Sourced:** the incursions are episodic and sub-interval. No retrieved source gives a plan-view extent; an edit would be invention. |
| 248–224, 224–203 | Triassic dryland | **Measured:** Cao is already 95.4 % and 95.1 % land here. **Sourced:** drainage was "dominantly endorheic … terminated in playa, aeolian dune, sabkha or marsh settings" (McKie & Williams 2009); both NSTA packages map only alluvial-plain, fluvial and upland classes. Cao is right. The one shallow-marine polygon at 248–224 sits on the south-eastern margin outside both NSTA map areas and is not constrained by anything retrieved here. What Cao cannot express is the standing water — playa, sabkha and salt lake are not `sm`, and there is no lacustrine class. That is a limitation, not an edit. |
| 166–146, 146–135 | Late Jurassic rift seaways, Kimmeridge Clay | **Measured:** Cao already draws the Viking Graben, Central Graben, Moray Firth and Danish–Norwegian basin as shallow marine at both, and already carries emergent ground over Scotland, Norway and the Horda Platform at 146–135. **Inferred:** what the literature adds is either an environment Cao has no class for (anoxia; the mid-*eudoxus* δ¹³C event) or geometry finer than the evidence — Roberts et al. (2019) predict "numerous isolated footwall islands" at the Base Cretaceous, but that is backstripped **model output at one age**, and drawing islands from it would assert a precision neither the model nor Cao's ~30 km floor supports. |
| 94–81, 81–58 | Late Cretaceous Chalk sea and platform flooding | The literature memo flags this as insufficiently constrained and it is untouched. Cao renders the window as dominantly shallow marine, which has the right sign for a deep epicontinental Chalk sea. How far the Chalk flooded the Shetland Platform and the other basin-margin highs, and when, is not settled by anything retrieved. 81–58 additionally merges the whole Chalk sea with the Palaeocene, so no single geometry can be right for both halves. |
| 58–49 | Forties fan provenance | The memo flags provenance as unresolved and no edit rests on it. The Shetland Platform operations rest on the continuous-supply statement and the non-marine facies class instead, and the basin east of the platform is untouched. |
| 269–248 | Northern limit of the Zechstein Sea | **Measured:** Cao floods parts of the East Shetland Platform and the northern Viking Graben. **Sourced:** the NSTA northern North Sea Permian sheet carries both an evaporite-basin class and a non-marine class there and marks the Zechstein "thin or absent" over parts of the platform. **Inferred:** nothing retrieved places the northern shoreline, and the Zechstein Sea's connection to the Boreal ocean may have run through exactly this area. No edit. |

## How the edits are carried and shown

**Measured**, from the compiled catalogs:

- Charts: `lm` 7,154 → 7,159 source records (five synthetic `add-land` records,
  one per operation). `sm` stays at 13,395: a removal edits an existing record
  rather than adding one.
- Evidence rows, interned one per distinct reference set: `lm` 1 → 6, `sm`
  1 → 7. The base row keeps `status: classified-map-polygon`; every edited row
  carries `status: derived-from-published-source`, the edit's reference
  `sourceIds` appended to `cao-2017-paleogeography`,
  `matthews-2016-plate-boundaries` and `cao-v2.4-static-partitions`, and an
  `editorial` line "EarthHistory modification after &lt;refs&gt;". One `sm` row
  merges two operations' references because a single Cao record was edited by
  both the East Shetland Platform and the Brent delta operations. The map key
  and the Sources panel read these rows, so a reference is on screen whenever an
  edited chart is.
- Payload bytes: `lm` 3,339,386 → 3,340,128 (+742), `sm` 3,469,844 → 3,469,626
  (−218). Only the five edited intervals changed; the other nineteen are
  byte-identical, which is the scoping rule holding in practice. The published
  set is 6,986,824 bytes over 52 files against the 7,340,032 byte budget, and
  the renderer reservation is unchanged because the worst interval (29–20 Ma) is
  untouched.
- Added land binds to the Cao 2024 static partition that owns the ground, so
  inside this window it rides the EarthHistory North Sea rigid UK-block
  restoration exactly as the native charts do. The validator's restoration check
  covers the added pieces along with the rest.

## Gates

All run 2026-09-15 in the pinned pyGPlates environment.

| Gate | Result |
|---|---|
| `palaeo_coastlines_compile.py --classes lm,sm,m` | pass, 123 s. Area preservation 100.0000 % (`lm`), 100.0000 % (`sm`), 100.0002 % (`m`) |
| `palaeo_coastlines_correction.py --classes lm,sm,m --report` | **pass**, 75 s. 11 operations, 22 contract references, 6 basin-edit witnesses changed and 4 unedited controls unchanged |
| `palaeo_coastlines_correction.py --self-test` | **pass**, 24 mutations rejected (20 before this phase) |
| `palaeo_coastlines_qc.py --classes lm,sm,m` | **pass**. Worst simplification area error 0.0098 %, worst lost piece 27.8 km², narrow-feature change 0.0 km |
| `validate_palaeo_coastlines_runtime.py` (+ `--self-test`) | **pass**, 8 mutations rejected |
| `make check-corrections` | **pass** |

Four gates are new or newly scoped in this phase, each proven red by a
deliberate mutation and then restored:

1. an operation whose geometry is translated outside the contract's window bbox;
2. an operation naming an interval the contract's `intervals[]` does not declare;
3. a payload shifted off its own basin edit (the class the edit put there is no
   longer at the witness point);
4. a basin-edit witness whose operation has been deleted from the contract.

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
