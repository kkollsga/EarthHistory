# North Sea basin edits to the Cao 2017 palaeo-coastlines

Research and compile date: 2026-09-15. Contract:
`data/corrections/palaeo-coastlines/basins/north-sea.json`. Companion to
[palaeo-coastlines-literature.md](palaeo-coastlines-literature.md) (what the
publications say) and
[palaeo-coastlines-cao2017.md](palaeo-coastlines-cao2017.md) (what the source
is). Five targeted records feed the Jurassic, Cretaceous and Palaeogene operations:
[palaeo-coastlines-north-sea-middle-jurassic.md](palaeo-coastlines-north-sea-middle-jurassic.md),
[palaeo-coastlines-north-sea-eocene-shetland.md](palaeo-coastlines-north-sea-eocene-shetland.md),
[palaeo-coastlines-north-sea-formation-checks.md](palaeo-coastlines-north-sea-formation-checks.md),
[palaeo-coastlines-norwegian-shelf-checks.md](palaeo-coastlines-norwegian-shelf-checks.md)
and
[palaeo-coastlines-north-sea-structural-elements.md](palaeo-coastlines-north-sea-structural-elements.md).
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

## The twenty-nine operations

Areas are **measured** by the compiler during the run, inside the contract
window and restricted to the operation's own interval. "dissolved" is the change
in ground the class actually covers; the summed figure in the compile record
double-counts records of one class that overlap, so the dissolved figure is the
one quoted here.

| # | Interval(s) | Operation | Class change | Δ area (km²) | Uncertainty | References |
|---|---|---|---|---:|---:|---|
| 1 | 402–380 | `…-402-380-orcadian-remove-shallow` | shallow removed | −68,404 | 60 km | Andrews & Hartley 2015; Marshall et al. 1996; NSTA CNS/MF |
| 2 | 269–248 | `…-269-248-moray-firth-remove-shallow` | shallow removed | −16,487 | 40 km | NSTA CNS/MF; Tucker 1991; Peryt et al. 2010 |
| 3 | 269–248 | `…-269-248-moray-firth-add-land` | land added | +16,487 | 40 km | NSTA CNS/MF; Glennie 1972; Tucker 1991 |
| 4 | 179–166 | `…-179-166-east-shetland-platform-remove-shallow` | shallow removed | −31,128 | 50 km | Fjellanger et al. 1996; Husmo et al. 2003; Johnson et al. 1993; NSTA NNS/ESP |
| 5 | 179–166 | `…-179-166-east-shetland-platform-add-land` | land added | +35,296 | 50 km | Fjellanger et al. 1996; Husmo et al. 2003; Johnson et al. 1993; NSTA NNS/ESP |
| 6 | 179–166 | `…-179-166-brent-delta-plain-remove-shallow` | shallow removed | −16,407 | 60 km | Fjellanger et al. 1996; Helland-Hansen et al. 1992; Husmo et al. 2003 |
| 7 | 179–166 | `…-179-166-brent-delta-plain-add-land` | land added | +16,701 | 60 km | Fjellanger et al. 1996; Helland-Hansen et al. 1992; Underhill & Partington 1993; Morton 1992; Richards 1992 |
| 8 | 179–166 | `…-179-166-scottish-landmass-add-land` | land added | +17,061 | 60 km | Cox & Sumbler 2002; Johnson et al. 1993; Underhill & Partington 1993; NSTA CNS/MF |
| 9 | 166–146 | `…-166-146-scottish-landmass-remove-shallow` | shallow removed | −18,101 | 60 km | Cox & Sumbler 2002; Davies et al. 1996; Trewin 2009; Steel 1993 |
| 10 | 166–146 | `…-166-146-scottish-landmass-add-land` | land added | +16,250 | 60 km | Cox & Sumbler 2002; Davies et al. 1996; Trewin 2009; Steel 1993 |
| 11 | 166–146 | `…-166-146-viking-graben-remove-land` | land removed | −2,227 | 50 km | Sodir HEATHER FM; Underhill & Partington 1993; Norlex wallchart |
| 12 | 166–146, 146–135 | `…-166-135-egersund-basin-remove-land` | land removed | −6,095 | 50 km | Sodir TAU FM; Sodir DRAUPNE FM; Norlex wallchart |
| 13 | 146–135 | `…-146-135-egersund-basin-add-shallow` | shallow added | +5,330 | 50 km | Sodir TAU FM; Sodir DRAUPNE FM; Norlex wallchart |
| 14 | 166–146, 146–135, 135–117 | `…-166-117-norwegian-danish-basin-remove-land` | land removed | −18,549 | 60 km | Norlex wallchart; Sodir FARSUND FM; Rawson & Riley 1982 |
| 15 | 146–135, 135–117 | `…-146-117-norwegian-danish-basin-add-shallow` | shallow added | +7,835 | 60 km | Norlex wallchart; Sodir FARSUND FM; Rawson & Riley 1982 |
| 16 | 135–117 | `…-135-117-southern-north-sea-remove-land` | land removed | −5,818 | 60 km | Rawson & Riley 1982; Norlex wallchart |
| 17 | 58–49 | `…-58-49-shetland-platform-remove-shallow` | shallow removed | −32,229 | 75 km | Anell et al. 2012; Ahmadi et al. 2003; Jones et al. 2001; Mudge 2015; Kjennerud & Gillmore 2003; Platt & Cartwright 1998; NSTA NNS/ESP |
| 18 | 58–49 | `…-58-49-shetland-platform-add-land` | land added | +14,652 | 75 km | as 17, without the NSTA sheet |
| 19 | 49–37 | `…-49-37-shetland-platform-remove-shallow` | shallow removed | −25,987 | 75 km | Anell et al. 2012; Jones et al. 2003; Mudge 2015; Kjennerud & Gillmore 2003; Platt & Cartwright 1998; Condon et al. 1992; Sodir GRID FM; Sodir FRIGG FM; Luzinski et al. 2022; NSTA NNS/ESP |
| 20 | 49–37 | `…-49-37-shetland-platform-add-land` | land added | +29,292 | 75 km | as 19, without the NSTA sheet |
| 21 | 135–117, 117–94, 94–81 | `…-135-81-jaeren-high-remove-shallow` | shallow removed | −3,671 | 60 km | Gatliff et al. 1994; Sodir CROMER KNOLL GP; Janssen et al. 2022; Sodir structural elements |
| 22 | 135–117, 117–94, 94–81 | `…-135-81-jaeren-high-add-land` | land added | +3,497 | 60 km | as 21 |
| 23 | 166–146, 146–135, 135–117, 117–94 | `…-166-94-central-graben-depocentre-remove-land` | land removed | −3,581 | 60 km | Sodir FARSUND FM; Møller & Rasmussen 2003; Rawson & Riley 1982; Sodir structural elements |
| 24 | 166–146, 146–135, 135–117 | `…-166-117-mid-north-sea-high-remove-shallow` | shallow removed | −35,010 | 75 km | Monaghan et al. 2015; Callomon 2003; Johannessen 2003; Møller & Rasmussen 2003; Cameron et al. 1992; BGS/DECC geological basins |
| 25 | 166–146, 146–135, 135–117 | `…-166-117-mid-north-sea-high-add-land` | land added | +26,397 | 75 km | as 24 |
| 26 | 203–179 | `…-203-179-fladen-ground-spur-remove-shallow` | shallow removed | −4,934 | 60 km | Quirie et al. 2020; Johnson et al. 1993; BGS/DECC geological basins |
| 27 | 203–179 | `…-203-179-fladen-ground-spur-add-land` | land added | +4,934 | 60 km | as 26 |
| 28 | 166–146 | `…-166-146-fladen-ground-spur-remove-shallow` | shallow removed | −4,934 | 60 km | as 26 |
| 29 | 166–146 | `…-166-146-fladen-ground-spur-add-land` | land added | +4,934 | 60 km | as 26 |

Totals, **measured**: **+149,231 km² net landmass** (185,501 added by nine
`add-land` operations, 36,269 removed by four `remove-land` operations) and
**−244,125 km² net shallow marine** (257,291 removed, 13,166 added), across
eleven of the twenty-four intervals. A land addition is smaller than its own
polygon wherever Cao already carried land there — operation 18 adds 14,652 km²
inside a 32,229 km² outline because roughly half of the Shetland Platform was
already land at 58–49 Ma, and operation 25 adds 26,397 km² of ground inside a
34,738 km² outline for the same reason.

### What the second round (2026-09-15) changed

Eight operations were added and four revised, all from the two formation-check
memos:

- **A cited 166–146 Ma Scottish landmass** (9, 10). Unlike the 179–166 Ma
  operation beside it, this one is a real disagreement with the source rather
  than a restatement of a class the build used to withhold: **measured**, Cao
  carries *no* mountain record over northern Scotland at 166–146 Ma and classes
  the Highlands north of the Great Glen, Caithness, Orkney and the Moray Firth
  as shallow marine. **Sourced**, much of Scotland remained land through the
  Jurassic, a Kimmeridgian river drained the Scottish landmass, and the
  post-rift wedges were shed from the Norwegian and Scottish hinterlands. The
  outline keeps the Golspie–Brora–Helmsdale outcrop and the whole Inner Moray
  Firth outside the land and stops at 59.4°N; the previous record that 166–146
  was "deliberately left alone" is superseded.
- **Three cited land removals over deep-water depocentres** (11, 12, 14, 16).
  In each, **measured**, Cao overlaps one of its own landmass polygons on its
  own shallow-marine polygon and the landmass wins the draw order, so the
  Viking Graben at Heather time, the Egersund Basin at Tau and Draupne time,
  the eastern Norwegian–Danish Basin and the southern North Sea at the late
  Ryazanian transgression all render as dry ground over their own source-rock
  kitchens. The lithostratigraphy is explicit that all four are marine.
- **Two `add-shallow` companions** (13, 15). At 166–146 Ma the removal uncovers
  Cao's own mapped sea and nothing is added. At 146–135 and 135–117 Ma there is
  no shallow-marine polygon underneath, so a bare removal would leave the
  Åsgard–Tuxen–Sola–Rødby column rendered as crust of unmapped depth, which is
  a worse statement than the land it replaces.
- **The Brent rationale rewritten** (6, 7). 60°30′N is the **Vestland** limit,
  not the Brent maximum; the Brent delta *front* reached about 61°30′N and the
  operation deliberately does not draw land that far north, because a delta
  front is not the limit of subaerial delta plain. The Central North Sea dome is
  now cited for the *emergence* of the ground south of the delta and explicitly
  not for its *supply*: heavy-mineral provenance argues against a dome source
  and the volume's own literature review records it as an open two-model
  controversy, so both sides are named.
- **The East Shetland Platform outline trimmed** (4, 5). Its north-east corner
  ran along 0.8°E from 60.9°N to 62.4°N, over ground where the Unst Basin
  preserves a Brent Group succession. The eastern edge is pulled back to 0.55°E
  between 60.9°N and 61.3°N, which costs the addition 1,300 km², and the BGS
  northern North Sea regional report — "Permian, Triassic and Jurassic strata
  are generally absent across the East Shetland Platform" — is now cited.
- **The Palaeogene citations strengthened and the eastern edge widened**
  (17–20). The `jones-2003-eocene` + `anell-2012` pairing was thin for a Middle
  Eocene claim; the Grid and Frigg lithostratigraphy, the Hermod provenance
  record, the Middle Eocene platform succession, the Palaeogene palaeobathymetry
  and the platform's structural history now carry it. The stated spatial
  uncertainty rises from 60 km to **75 km**, which is the distance from the
  drawn 0.2°E edge to the western limit of the Bressay block cluster: no
  retrieved source places a Palaeogene shoreline anywhere between 0°E and 1.2°E,
  and the schema carries one figure per operation, so it states the worst edge
  and the rationale says which edge that is.

### What the third round (2026-09-15) added: the structural elements

Operations 21–29 come from
[palaeo-coastlines-north-sea-structural-elements.md](palaeo-coastlines-north-sea-structural-elements.md),
which asked a different question from the two formation memos: **at the crest of
a named structural element, and in the basin beside it, does the shipped map say
land, shallow sea, both, or neither — and does that match the element's published
emergence history?** Two measurements decided what could be built at all.

- **Measured: 26 of the 43 Norwegian-sector elements and 10 of the 19 UK-sector
  ones have an inscribed diameter below Cao's own ~30 km coastline tolerance.**
  Most of the North Sea's named highs cannot be drawn in this model.
- **Measured: across the twelve intervals from 166–146 to 11–2 Ma, 27 of the 43
  elements carry the shallow-marine class and nothing else at every one of
  them.** High and graben are the same colour at every age; there is no
  archipelago and no post-Jurassic structural relief on this map.

Five operations were proposed and **four were built**. The **Jæren High**
(21–22) is drawn as an island through the Early and Late Cretaceous on the BGS
central North Sea report's "these intrabasinal upland areas were not submerged
until much later in the Cretaceous" and "Chalk sedimentation extended over the Jæren High, probably
during the early Campanian"; it stops short of 146–135 because Janssen et al.
(2022) record Ryazanian macrofossils in well 7/7-2 *on* the high. The **eastern
Central Graben depocentre** (23) is a removal only — the Tail End Graben, Søgne
Basin and Gertrud Graben rendered as dry ground through Farsund Formation time
because Cao overlaps its own landmass on its own shallow-marine polygon there,
the same defect the second round fixed three times over. The **Mid North Sea
High** (24–25) is the best-sourced of the five, with four independent
publications putting it above water from the Middle Jurassic until the
Aptian–Albian; its outline is the one published as text and convertible without
reading a figure — BGS CR/15/124's Quadrants 35–39, 1.00 °W to 4.00 °E, 55.00 to
56.00 °N — with a southward feather to 54.7 °N, the English coastal strip west of
1 °W excluded, and the operation stopping at 3.2 °E so the marine corridor along
the Central Graben stays as Cao drew it. It declares 75 km rather than 60 km
because the NSTA, EGDI/NAGTEC and BGS renderings of the high genuinely disagree.
The **Fladen Ground Spur** (26–29) is two pairs rather than one, because the
sources constrain 203–179 and 166–146 and the map already draws the spur as land
at 179–166 between them; it uses the NSTA/BGS-DECC outline, on which the element
is 43.9 km across, and not the Sodir "Falden Ground Spur" polygon, which is a
quarter of the area and below the class floor. An independent third rendering,
EGDI/NAGTEC's, matches NSTA and not Sodir.

**The fifth operation was declined.** The East Shetland Platform in the Late
Jurassic rests on *absence of section* plus a statement of uplift and erosion —
exactly the pair the Norwegian-shelf memo refused to convert into land for the
Nordland Ridge — and it is the only one of the five with no licensed
machine-readable outline of its own. It is in the contract's `notes.leftAlone`
with its two witnesses instead.

**Rights, and this round settled one.** The UK-sector extents come from the NSTA
open-data layers, whose own item metadata carries **no licence string at all**
and whose default user agreement grants non-commercial use only. The identical
polygons are redistributed by the BGS in its 21CXRM Palaeozoic package under the
**Open Government Licence v3.0**, with the required acknowledgement "Contains
British Geological Survey materials ©NERC 2017" — measured this session by
reading both shapefiles directly, the DECC and NSTA extents are the same
polygons. The contract cites the BGS redistribution, not the NSTA portal. The
Norwegian extents are the Sodir structural-elements layer, NLOD **1.0** per its
Geonorge metadata record (the brief said 2.0; sodir.no returned 403 to every
automated fetch, so 1.0 is cited until someone reads the page). Nothing from
either is redistributed: only derived points, boxes and areas appear, and every
emitted ring is EarthHistory's own coarse construction.

## What was deliberately left alone

| Interval(s) | Subject | Why no edit |
|---|---|---|
| 380–359 | Devonian marine incursions | **Measured:** Cao already draws the Orcadian as land and puts its only shallow-marine polygon inside the window on the south-eastern, Tornquist-facing margin — the direction the incursions came from. **Sourced:** the incursions are episodic and sub-interval. No retrieved source gives a plan-view extent; an edit would be invention. |
| 248–224, 224–203 | Triassic dryland | **Measured:** Cao is already 95.4 % and 95.1 % land here. **Sourced:** drainage was "dominantly endorheic … terminated in playa, aeolian dune, sabkha or marsh settings" (McKie & Williams 2009); both NSTA packages map only alluvial-plain, fluvial and upland classes. Cao is right. The one shallow-marine polygon at 248–224 sits on the south-eastern margin outside both NSTA map areas and is not constrained by anything retrieved here. What Cao cannot express is the standing water — playa, sabkha and salt lake are not `sm`, and there is no lacustrine class. That is a limitation, not an edit. |
| 166–146, 146–135 | Late Jurassic rift *seaways* and the Kimmeridge Clay — but see operations 9–15, which are not seaway geometry | **Measured:** Cao already draws the Viking Graben, Central Graben, Moray Firth and Danish–Norwegian basin as shallow marine at both, and already carries emergent ground over Scotland, Norway and the Horda Platform at 146–135. **Inferred:** what the literature adds beyond that is either an environment Cao has no class for (anoxia; the mid-*eudoxus* δ¹³C event) or geometry finer than the evidence — Roberts et al. (2019) predict "numerous isolated footwall islands" at the Base Cretaceous, but that is backstripped **model output at one age**, and drawing islands from it would assert a precision neither the model nor Cao's ~30 km floor supports. What the second round did edit here is different in kind: three places where Cao overlaps its own land on its own sea, and one place where the source and the literature disagree in sign. |
| Neogene, mid-Norway and the SW Barents | The Nordland Ridge and the Loppa High | **Measured:** the Norlex standard lithostratigraphic wallchart carries both as vertical columns filled edge-to-edge with its hatched **hiatus** ornament, from the Triassic to the Late Pliocene. **Inferred, and this is the whole decision:** a hiatus ornament states that section is *missing* — non-deposition or later erosion — not that the ground stood above sea level. Reading it as emergence would convert a stratigraphic absence into a palaeogeographic claim the chart does not license, and any operation built on it would have to say in `claimOrInference` that the emergence was EarthHistory's own inference from missing section. No `mid-norway` or `barents-loppa` contract is created. Both are carried as drift witnesses instead: `nordland-ridge-crest` (10.902°E, 66.925°N) must stay `sm` at 11–2 Ma and `loppa-high-crest` (20.546°E, 72.057°N) must stay `lm` at 20–11 Ma and `sm` at 248–224 Ma, so neither can move without a source. The Early Cretaceous Loppa High `add-land` the uplift literature would support is **held** for the same reason: the retrieved text establishes uplift and margin inversion, not subaerial exposure of the crest, and the coeval Kolmule Formation is described as open marine across the region. |
| 94–81, 81–58 | Late Cretaceous Chalk sea and platform flooding | The literature memo flags this as insufficiently constrained and it is untouched. Cao renders the window as dominantly shallow marine, which has the right sign for a deep epicontinental Chalk sea. How far the Chalk flooded the Shetland Platform and the other basin-margin highs, and when, is not settled by anything retrieved. 81–58 additionally merges the whole Chalk sea with the Palaeocene, so no single geometry can be right for both halves. |
| 58–49 | Forties fan provenance | The memo flags provenance as unresolved and no edit rests on it. The Shetland Platform operations rest on the continuous-supply statement and the non-marine facies class instead, and the basin east of the platform is untouched. |
| 49–37 | The East Shetland Platform proper, east of 0.2°E — see also [the Palaeogene Shetland memo](palaeo-coastlines-north-sea-eocene-shetland.md) | **Sourced:** the NSTA/OGA Eocene – Alba sheet — the Middle Eocene, i.e. this interval — describes that ground as “shelf sandstones of the Middle Mousa Formation and deep-water sandstones belonging to the Caran Sandstone Member”, and the Millennium Atlas Eocene chapter has a deep-marine central basin fed from a western source. The one emergence statement (Anell et al. 2012) names the Shetland Platform, which the operation already draws as land. **Inferred:** a shelf is submerged, so the platform stays shallow marine and the land is not extended east. Carried as an unedited control at (0.5°E, 61°N) so a later extension fails a gate. |
| 269–248 | Northern limit of the Zechstein Sea | **Measured:** Cao floods parts of the East Shetland Platform and the northern Viking Graben. **Sourced:** the NSTA northern North Sea Permian sheet carries both an evaporite-basin class and a non-marine class there and marks the Zechstein "thin or absent" over parts of the platform. **Inferred:** nothing retrieved places the northern shoreline, and the Zechstein Sea's connection to the Boreal ocean may have run through exactly this area. No edit. |

## How the edits are carried and shown

**Measured**, from the compiled catalogs:

- Charts: one synthetic `lm` source record per `add-land` operation and one
  synthetic `sm` record per `add-shallow` operation — six and two after this
  round. `lm` holds 7,327 chart records and `sm` 13,397. A removal edits an
  existing source record rather than adding one, so the three `remove-land`
  operations add no chart.
- Evidence rows, interned one per distinct reference set: `lm` 13, `sm` 10,
  `m` 1 (the mountain class carries no basin edit and keeps only the Cao base
  row). The base row keeps `status: classified-map-polygon`; every edited row
  carries `status: derived-from-published-source`, the edit's reference
  `sourceIds` appended to `cao-2017-paleogeography`,
  `matthews-2016-plate-boundaries` and `cao-v2.4-static-partitions`, and an
  `editorial` line "EarthHistory modification after &lt;refs&gt;". A row can merge
  two operations' references where a single Cao record was edited by both. The
  map key and the Sources panel read these rows, so a reference is on screen
  whenever an edited chart is.
- Payload bytes, this round: `lm` 3,415,378 → 3,418,479, `sm` 3,519,149 →
  3,467,192 and the newly shipped `m` 1,195,501, with the outline-tone tables at
  107,501. The `sm` fall is not this contract's doing: it is the override
  footprint rule landing in the same compile (see below). The published set is
  **8,188,673 bytes over 80 files** against a budget raised the same day from
  7 to 8.5 MiB (8,912,896 bytes), leaving 724,223 bytes of headroom; the
  renderer reservation rose with the third class to 334,021 vertices and
  513,878 triangles.
- Added land binds to the Cao 2024 static partition that owns the ground, so
  inside this window it rides the EarthHistory North Sea rigid UK-block
  restoration exactly as the native charts do. The validator's restoration check
  covers the added pieces along with the rest.

## What else landed in the same compile

Two changes outside this contract share the compile and are recorded here so the
byte and count movements above are attributable:

- **The mountain class `m` ships.** The open limitation this memo recorded last
  round is closed by shipping the class rather than by basin polygons; see the
  section below.
- **PLATEID1 overrides are bounded by a declared footprint.** Each entry of
  `data/corrections/palaeo-coastlines/overrides.json` now carries the bounding
  box of that plate's present-day Cao 2024 static partitions, buffered by a
  stated 500 km, and a cut piece is rebound by `PLATEID1` only if the whole
  piece fits inside it. **Measured:** without it the Apulia (3307) override was
  rebinding shallow-marine pieces spanning 3.7–31.6 °E and 36.0–55.8 °N onto a
  plate whose entire present-day crust is 15.2–19.3 °E, 39.6–41.9 °N. The rule
  turned 3,545 of 9,934 eligible `sm` pieces, 413 of 1,287 `lm` and 440 of 985
  `m` back to partition binding — for Apulia alone, 192 of 387 `sm` and 53 of
  95 `lm` — which is what moves the `sm` payload and the co-moving figures. A piece that then has no gap-free palette coverage on its
  partition owner is not drawn: `sm` unposable pieces rise from 3,875 to 4,479.
  That is the honest outcome — the alternative was to keep posing Tethyan sea
  floor on the Apulian rotation.

## Gates

All run 2026-09-15 in the pinned pyGPlates environment.

| Gate | Result |
|---|---|
| `palaeo_coastlines_compile.py --classes lm,sm,m` | pass, 120 s. Area preservation 100.0000 % (`lm`), 100.0000 % (`sm`), 100.0002 % (`m`) |
| `palaeo_coastlines_correction.py --classes lm,sm,m` | **pass**, 101 s. 20 operations, 41 contract references, 51 source witnesses, 37 basin-edit rows (14 edited, 23 unedited controls) |
| `palaeo_coastlines_correction.py --self-test` | **pass**, **27** mutations rejected (was 24) |
| `palaeo_coastlines_qc.py --classes lm,sm,m` | **pass**. Worst simplification area error 0.0098 %, worst lost piece 27.8 km², 2 lost pieces in the worst interval against a gate of 5, narrow-feature change 0.0 km |
| `promote_palaeo_coastlines.py` | **pass**, 80 files, 8,188,673 bytes |
| `validate_palaeo_coastlines_runtime.py` (+ `--self-test`) | **pass**, 15 mutations rejected |
| `make check-corrections` | **pass** |
| `make gate` | **pass** |

Three mutations are new this round, each proven red and then restored: the
cited `north-sea-166-146-viking-graben-remove-land` operation deleted from the
contract, an override footprint moved off the pieces it rebound, and an override
entry with no declared footprint at all.

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

## The open limitation this round closed

Last round's record ended here with a global class gap this contract could not
fix. It is now fixed, and not by basin polygons. **Measured** over the pinned
archive, for every canonical interval, the Cao 2017 mountain class that carries
neither `lm` nor `sm`, and the part of it inside the Cao 2024 continental crust
the globe used to draw as blue "depth unmapped":

| Interval | mountain-only (km²) | of which inside Cao 2024 crust (km²) |
|---|---:|---:|
| 179–166 | 4,704,094 | 3,903,221 |
| 49–37 | 16,050,826 | 15,832,772 |
| 20–11 | 23,869,977 | 23,595,938 |

Mountain-only ground is present in all twenty-four intervals, from 2.1 Mkm² at
285–269 Ma to 23.9 Mkm² at 20–11 Ma, and wherever it fell inside the crust
extent the browser painted emergent orogen as water of unknown depth. Six cited
North Sea polygons could never have fixed a global class gap. The class now
ships (user decision, 2026-09-15): `m` is published as `palaeo-mountain`, a
light brown `#c8a97e` that the dark outline ink clears at 6.86:1 and that
separates from the `palaeo-land` olive by hue (CIE76 ΔE 21.1) rather than by
lightness. Precedence is unchanged — mountain over land over corrections over
shallow marine over shelf — and the map key's "Palaeo mountain" row, already
gated on the published class list, returns with it.

This also changes how the **179–166 Ma Scottish landmass** operation reads. It
was authored while `m` was withheld, and its rationale said plainly that it
restates Cao's own mountain classification in a shipped class rather than
correcting the source. With `m` shipped that ground would be drawn anyway; the
operation is kept because it is cited, because it states land rather than relief
where the literature states land, and because removing it would move a witness
that the contract and the validator both pin. The 166–146 Ma operation beside it
is the one that is a genuine correction.

## One open item this round did not close

**Sourced** from [the Norwegian shelf checks](palaeo-coastlines-norwegian-shelf-checks.md):
a sub-3 km hairline gap in the shallow-marine union at 11–2 Ma near
(3.20 °E, 56.51 °N), between two pieces cut from one Cao source record. It is
**inferred** to be a cookie-cut seam rather than a source gap: the two pieces
share a present-day Cao 2024 partition boundary, and node reduction runs per
piece, so the shared edge is simplified twice with no constraint that the two
results agree. Closing it is not the cheap union of two touching pieces it
looks like — the pieces ride *different plates* by construction, so they are
only coincident at the present day and must stay separate geometries; the fix
would be a shared-edge constraint inside node reduction, which is a compiler
change with its own area and narrow-feature measurements. It is recorded, not
attempted, and it is below the ~30 km coastline tolerance of the source.

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
