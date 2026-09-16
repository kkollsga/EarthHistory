# The Last Glacial Maximum lowstand state

Record for Phase 9 of `dev-docs/plans/palaeo-coastlines-polygons.md`. The
palaeo-coastline layer carries one interval that is not Cao et al. (2017) at
all: a Last Glacial Maximum lowstand state at 26.5–19.5 ka, drawn from the
ETOPO 2022 relief model at a published eustatic datum, over three footprints
and nowhere else.

Everything below is measured by
`scripts/research/palaeo_coastlines_lgm_acquire.py` (acquisition),
`scripts/research/palaeo_coastlines_lgm_derive.py` (contouring) and
`scripts/research/validate_palaeo_coastlines_runtime.py` (the shipped gate).
The tracked contract is `data/corrections/palaeo-coastlines/lgm/`.

## 1. What the layer claims, and what it does not

**Claim.** At the Last Glacial Maximum global mean sea level was roughly 120 m
below present, and shelf shallower than that was therefore above water. Inside
the southern and central North Sea, the Sunda shelf and Beringia, this is what
that implies for present-day bathymetry.

**What ships is the exposed shelf only.** Present-day land is subtracted from
the contour, so the layer draws the ground the lowstand *added* to the coastline
and never re-draws ground that is dry today. That is a correction made
2026-09-15: before it the payload carried the whole `>= -120 m` mask inside each
crop rectangle, the palaeo-land shell re-tinted Germany, France, Norway and
Britain at its own tone, and the rectangle edge showed on screen as a hard
tonal seam running straight across northern Europe (measured in the round-3
review captures: pale `(216,216,190)` inside the box against present-day
`(203,208,172)` outside it, a one-pixel butt-joint along a dead-flat 240 px
line). Present-day land is the pinned Natural Earth 1:50m admin-0 land the
observed-land omission correction already uses, eroded by **1.5 km** before the
subtraction so the shelf still laps over the modern coastline and no hairline of
bare sphere opens along it.

**Not claimed.** Seven limitations ship with the layer, appear in the map key and
are asserted by the validator; dropping any of the first four, or the
exposed-shelf line, turns the gate red.

| Limitation | Why |
|---|---|
| eustatic only, one flat −120 m datum | Lambeck et al. 2014 give a global mean, not a local sea surface |
| no glacio-isostatic adjustment | relative sea level around Britain and Ireland varies by more than 100 m spatially under GIA [5]; a flat contour is wrong in detail exactly where Doggerland is |
| ice sheets are not drawn | ground under the Fennoscandian, British–Irish and Laurentide ice sheets is shown as exposed land, which it was not |
| ETOPO 2022 is modern bathymetry | post-LGM sediment is not removed; the present-day sea bed is not the lowstand land surface. Coles 1998 says this directly: present-day North Sea relief "does not provide a sound guide" to the former landscape |
| regional | three footprints; every other coastline at this age is the present-day one |
| exposed shelf only | present-day land is subtracted, so the state adds coastline to today's composition and never re-draws ground that is dry now |
| no rivers, lakes or estuaries | the Doggerland landscape mapped by seismic survey (Gaffney et al. 2009) is not reproducible from a contour |

Its epistemic status is **synthesis** at every age in its window: measured
present-day bathymetry cut at a published number. It is never an observation of
a palaeo-shoreline.

## 2. The datum and the window

| Quantity | Value | Source |
|---|---|---|
| eustatic datum | **−120 m** | Lambeck et al. 2014 [2]: "a slow fall to −134 m from 29 to 21 ka BP", with a companion model peak fall of ~130 m. −120 m is the conservative round contour EarthHistory draws; the choice is ours, the numbers are the paper's |
| window | **26.5–19.5 ka**, half-open `(0.0195, 0.0265]` Ma | Clark et al. 2009 [3]: "nearly all ice sheets were at their LGM positions from 26.5 ka to 19 to 20 ka". The 19.5 ka bound is the midpoint of the paper's own "19 to 20" |
| frame | present-day WGS84 | the same frame as the Cao 2017 source polygons |
| vertical datum | EGM2008 | the ETOPO 2022 surface band |

Choosing −120 m rather than −134 m is a deliberate under-claim: it draws less
exposed shelf, and the difference is well inside the GIA variability the layer
cannot model anyway.

## 3. Acquisition

NOAA NCEI ETOPO 2022 v1, 60 arc-second **surface** band, exported through the
public ArcGIS ImageServer (`gis.ngdc.noaa.gov/.../DEM_mosaics/DEM_all`), the
same path the existing `etopo-reference-crops` acquisition uses. US Government
work, public domain, attribution requested (`10.25921/fd45-gt74`). Retrieved
2026-09-15. No raster is in the repository: the crops live in
`EarthHistory-data/palaeomap-study/geography/etopo-lgm-crops/` with a manifest,
and only the derived rings ship.

Each crop is requested on the product's own 1 arc-minute grid — width is
`60 × degrees of longitude`, height `60 × degrees of latitude` — so the export
resamples nothing and the contour is honest to one source cell (~1.85 km in
latitude, ~0.8–1.1 km in longitude at these latitudes).

| Crop | Bounds (W, S, E, N) | Grid | Bytes | sha256 (first 16) |
|---|---|---|---|---|
| `north-sea` | −6, 49, 12, 62 | 1080 × 780 | 3,280,847 | `34053ab92fcd485a` |
| `sundaland` | 95, −10, 120, 12 | 1500 × 1320 | 6,745,767 | `75ac3196f54ad015` |
| `beringia-west` | 160, 55, 180, 72 | 1200 × 1020 | 4,248,056 | `7e3a547e708275ca` |
| `beringia-east` | −180, 55, −150, 72 | 1800 × 1020 | 5,627,501 | `01d115f2f132e646` |

Beringia is two crops because the −120 m land bridge genuinely crosses the
antimeridian. They abut exactly on it, on the same cell grid, and the rest of
the pipeline splits dateline geometry anyway.

The four digests are pinned a second time in
`validate_palaeo_coastlines_runtime.py`, so re-downloading from a changed
service has to be a deliberate edit rather than a silent change to what the
globe draws.

## 4. Derivation

1. read the crops and verify every raster against the sha256 in its manifest;
2. boolean mask `surface >= −120` on the source grid;
3. polygonise on **cell boundaries**: maximal axis-aligned rectangles of set
   cells, unioned. No contour position is interpolated between two source
   cells, so every vertex of the raw polygon lies on a real grid line and the
   geometry cannot claim precision the 1 arc-minute grid does not have;
4. subtract **the present-day land the application draws** — the emitted Cao
   v2.4 `shapes_coasts` charts valid at 0 Ma (sha256 `c660bc07…`, selected by
   the chart ids the shipped package emits) plus the tracked observed-land
   omission correction — clipped to one degree beyond the crop so the crop's own
   rectangle edge never behaves like a coastline, and eroded by 1.5 km in a
   local equirectangular frame so the shelf and the drawn land overlap rather
   than meet. Natural Earth 1:50m stood here until 2026-09-16; see §4.2;
5. **open the result at 1.5 km** — erode by 750 m and dilate by 750 m again, in
   a cos(latitude)-scaled frame so one unit means the same distance along both
   axes. Step 4 cuts a generalised 1:50m coastline into a mask whose cells are
   1.85 km across; where the modern coast is indented the two resolutions
   disagree and leave needles far thinner than a single source cell. The opening
   deletes anything narrower than 1.5 km and leaves everything wider where it
   is. See §5.1;
6. drop parts below 25 km² (the pipeline's floor everywhere else), simplify at
   0.02° with topology preserved, drop again, remove vertices whose interior
   angle is under 3°, round to 4 decimals;
7. write `lgm-lowstand-v1.geojson` (179,361 bytes) and its manifest.

The erosion removes present-day islands narrower than about 3 km entirely, so a
handful of small modern islands remain inside the shipped rings. That is a
deliberate over-claim of a few tens of km² against the alternative of a visible
gap at every modern coastline.

The compiler then treats the result exactly like a Cao source record: cookie-cut
by the present-day Cao 2024 static partitions with one owner per piece, bound to
the owner plate through `palaeo-binding-entry-v1`, and given the contract's own
`(19.5 ka, 26.5 ka]` lifecycle. It is marked pre-simplified, so the compiler's
own node reduction leaves the rings alone rather than moving a coastline the
derivation already measured.

## 4.1 Why the outline is opened before it is written

Steps 5 and 6 were added on 2026-09-16 after the 0.1.14 capture at 21 ka showed
dozens of needle-shaped shards poking into the land along the Norwegian coast,
the Skagerrak and the Dogger Bank margin at closest zoom.

The needles were not a renderer defect and not the cell-boundary polygonisation.
Measured on the shipped v1 contract, the rings carried **no** edges under 200 m
and only 10 vertices under 5°, and a morphological opening at half a source cell
moved the area by 0.05 % — the mask side was already clean. The artefact was
born in step 4 and only became visible two steps later:

- subtracting the generalised Natural Earth coastline from the 1 arc-minute mask
  left wedges a few hundred metres wide along indented coasts;
- the compiler quantises ring vertices to the int16 grid, 0.0055° of longitude
  by 0.0027° of latitude — up to ~170 m of movement per vertex at 60 °N. That is
  the same order as the wedges, so quantisation pushed the two walls of a wedge
  past one another and the ring self-intersected;
- the renderer's ear-clip triangulation of a self-intersecting ring fills it with
  hairline triangles and leaves wedges of it unfilled, which is what read on
  screen as teal needles inside the land.

Counted on the payload the browser actually loads, `palaeo-lm-lgm.ehpr`:

| | vertices sharper than 5° | self-intersecting rings |
|---|---|---|
| before (0.1.14) | 15 | 8 |
| after | 2 | 4 |

The residual two and four are the compiler's own seam-growth step, which
deliberately grows every piece of a multi-piece record back across its
cookie-cut seams; they are not created by this derivation. Measured on the
tracked contract before quantisation, self-intersections after a simulated
int16 pass fall from 4 to 0 and sharp vertices from 15 to 1.

The opening costs area, and the budget for it was 1 %: North Sea −0.341 %,
Sunda −0.184 %, Beringia −0.233 %. Inside the named sub-windows the cost is
smaller still (Doggerland −0.006 %, Sunda shelf core −0.024 %, Bering land
bridge −0.017 %), because the needles lived on the outer margins rather than in
the landscapes the literature names. The payload shrank from 172,225 to 169,481
bytes. The witnesses are unchanged: Dogger Bank, the central Sunda shelf and the
Bering land bridge are land; London, the north German plain, interior Borneo,
interior Alaska, the Norwegian Trench, the Makassar Strait and the Aleutian
Basin are not.

1.5 km is chosen as just under one source cell (1.85 km at these latitudes): wide
enough to be several times the quantisation error, so nothing that survives can
be folded inside out later, and narrow enough that no feature the 1 arc-minute
grid can actually resolve is removed.

Since 2026-09-16 the spike filter is no longer this layer's alone. The same 3°
rule, and a 1.5 km floor on the *mean width* of an interior ring, run over every
Cao interval inside `palaeo_coastlines_compile.py`; both scripts import them from
`scripts/research/palaeo_coastlines_rings.py`. The mechanism this section
measured is not specific to a subtracted coastline: the shipped 0.1.14 set
carried 920 interior rings narrower than 1.5 km, 359 of them in
`palaeo-lm-11-2.ehpr` and 209 in `palaeo-lm-20-11.ehpr`, many of them zero-area
three-vertex rings around Iceland. `docs/data/palaeo-coastlines-format.md` states
the compiler-wide contract. Nothing about the LGM contract itself changed: it
ships the same hash-pinned rings, and the width floor is not applied
retroactively to them.

## 4.2 Why the subtraction follows the drawn coast, not Natural Earth

Until 2026-09-16 step 4 subtracted Natural Earth 1:50m admin-0 land. The 0.1.15
capture at 21 ka, closest zoom over the North Sea, showed teal needle-shaped
shards over Doggerland and the surrounding coasts. They were not an outline
defect: the LGM rings were clean, and the shards were the native `shelf` class
of the 0 Ma composition showing through holes in the exposed shelf.

**Cause.** The application fills present-day land from the emitted Cao v2.4
`shapes_coasts` charts plus the observed-land omission correction. Natural Earth
1:50m is a different cartographer at a different generalisation, and it draws
estuaries, firths, fjords and belt seas as land where the drawn coast has open
water: the Solway, Clyde, Tay, Humber, Morecambe Bay, the Tyne, the Ems and the
Dollart, the Schlei, Kiel Fjord, Vejle Fjord, the Limfjord, the Great Belt and
the North Frisian Wadden. Subtracting it punched a hole in the exposed shelf at
exactly the places the drawn coast leaves as water, and nothing filled them.
The shards were present with the palaeo layer off and at 0 Ma too; the LGM
interval only made them conspicuous, because there the surrounding sea became
land and the holes stood out against it.

**Change.** The mask now complements the land the application actually draws:
the Cao coast charts at 0 Ma plus the observed-land omission correction. The
1.5 km erosion is unchanged, so the shelf still laps over the drawn coast; the
depth test is unchanged, so anything below −120 m in ETOPO — the Norwegian
Channel, the Devil's Hole trenches, the Silver Pit, the deep fjords — stays
water.

**Before and after.** Over the thirteen named estuaries above, counting
connected components of "above the datum, drawn as water, and not covered by the
shipped shelf" at 1 km² and larger:

| | shelf holes inside the drawn water | their area |
|---|---|---|
| before (Natural Earth subtraction) | 34 | 751.7 km² |
| after (drawn-coast subtraction) | 3 | 5.4 km² |

The shipped shelf gained 1,701.6 km² inside those thirteen windows and
23,124.6 km² across the whole North Sea footprint, and lost 12,407.1 km² where
the Cao coast reaches further seaward than Natural Earth does. Net, the North
Sea footprint moved +1.544 %, Sunda −0.180 % and Beringia +0.606 %.

The two interior holes at the Devil's Hole trenches (~37 km², more than 200 m
deep) are correct water and are still holes.

## 5. Measured areas

Only the last column ships. "Present-day land" is the land the application draws
at 0 Ma inside the footprint; the exposed shelf is the area of the rings
actually written, after the
1.5 km erosion, the 1.5 km opening, the 25 km² floor and the 0.02° reduction, so
it is not exactly the difference of the other two columns.

| Footprint | LGM land (unsubtracted) | present-day land | **exposed shelf (shipped)** |
|---|---|---|---|
| North Sea box (−6…12 E, 49…62 N) | 1,397,480 km² | 749,683 km² | **704,078 km²** |
| Sunda box (95…120 E, −10…12 N) | 4,086,177 km² | 1,785,334 km² | **2,338,902 km²** |
| Beringia box (160 E…−150 E, 55…72 N) | 3,640,901 km² | 1,970,324 km² | **1,702,363 km²** |
| total | 9,124,558 km² | 4,505,341 km² | **4,745,343 km²** |

The footprint boxes are far larger than the landscapes the literature names, so
one named sub-window per footprint is measured beside them:

| Sub-window | Bounds | LGM land | exposed shelf |
|---|---|---|---|
| southern North Sea plain ("Doggerland") | −2…9 E, 51…57 N | 477,876 km² | **314,048 km²** |
| Sunda shelf core | 99…118 E, −6…8 N | 2,832,082 km² | 1,589,754 km² |
| eastern Bering land bridge | −180…−160 E, 60…70 N | 1,002,946 km² | 669,976 km² |

**Comparison with the literature, and its limits.** Sturt et al. 2013 [6] model
**127,422 km²** submerged in the North Sea zone across the Holocene. That is a
different quantity over a different window under glacio-isostatic adjustment —
submergence from ~11 ka, not exposure at 26.5 ka — and our 310,950 km² is
larger for exactly the reasons it should be: the eustatic lowstand exposes the
whole southern North Sea including ground that was already submerged before the
Holocene window opens, and the flat contour ignores the forebulge subsidence
that drowned parts of Doggerland earlier than eustasy alone would. The two
numbers are the same order of magnitude and are not evidence of agreement. No
figure in Coles 1998 or Gaffney et al. 2009 is used as a target.

The published payload is compared against the contract's shipped exposed-shelf
total, 4,745,343 km², inside the gate's tolerance that absorbs cookie-cutting, the
25 km² floor and int16 quantisation.

## 6. What ships

| Item | Value |
|---|---|
| landmass payload | `lm/palaeo-lm-lgm.ehpr`; exposed shelf only, 237 contract pieces and 9,844 contract vertices before cookie-cutting |
| shallow-marine payload | `sm/palaeo-sm-lgm.ehpr`, **32 bytes** — a header and nothing else |
| interval index | 24, the 25th and last row of both class catalogs, declared in `detachedIntervalIds` |
| triangles at 1° | 14,662 estimated; far below every other interval |
| tone table | all-dark, the 25th table |

The shallow-marine payload is empty on purpose and the validator fails if it is
not: a eustatic contour says where land was, not where a shallow sea was.

## 7. Composition: why today's land stays visible

In the Cao 2017 band the palaeo land polygons *replace* native land — the whole
globe has a mapped palaeogeography, so leaving the Cao 2024 coast proxy under it
would be a contradiction. The LGM state is three footprints. Hiding today's land
there would blank every coastline on Earth to show a little exposed shelf in the
North Sea, the Sunda shelf and Beringia.

So the renderer splits the palaeo domain into two **bands**
(`caoPalaeoCoastlineDomainBand`):

| Band | Ages | Native land | Palaeo instance |
|---|---|---|---|
| `cao-2017` | 2.01–402 Ma | hidden | drawn, replaces it |
| `lgm` | `(19.5, 26.5]` ka | **visible** | drawn over it |
| `none` | everything else, including 0 Ma | visible | not drawn, map-key fallback notice |

The palaeo-land shell sits 1,300 m above the globe and native land at 800 m, so
the LGM shelf draws on top of the land it adds to. The composite pick and the
guide-label ink follow the same rule through a `palaeoVisible` flag that is no
longer the same thing as "native land is hidden". The band is carried through
the one-frame hysteresis, so the frame that still draws Cao 2017 charts still
hides native land.

## 8. Witnesses

Evaluated against the published payload by
`validate_palaeo_coastlines_runtime.py`, and again in TypeScript against the
triangulated mesh by `palaeoCoastlineAssets.test.ts`.

| Witness | Present-day coordinate | At 21 ka | Why |
|---|---|---|---|
| Dogger Bank | 2.5 E, 54.7 N | land | a shallow bank today, a hill then |
| Sunda shelf | 108 E, 2 N | land | the exposed shelf between Sumatra, Borneo and the peninsula |
| Bering land bridge | −170 E, 65 N | land | the land bridge itself |
| London | −0.1 E, 51.5 N | **neither** | dry land today, so the exposed-shelf payload carries nothing there; the native present-day land keeps drawing it. This is the witness for the footprint-seam correction |
| North German plain | 10 E, 53 N | **neither** | dry land today, inside the crop rectangle: the ground whose re-tinting made the rectangle edge visible |
| Borneo interior | 114 E, 0.5 N | neither | dry land today, not shelf the lowstand exposed |
| Interior Alaska | −155 E, 65 N | neither | dry land today, not part of the land bridge this layer adds |
| Norwegian Trench | 4 E, 58.5 N | not land | −254 m, far below the datum |
| Makassar Strait | 118.5 E, −2 N | not land | never closed by a lowstand (Hall 2009 [7]) |
| Aleutian Basin | −175 E, 57 N | not land | deep ocean south of the shelf break |
| Inner Humber | −0.709 E, 53.653 N | land | drawn as open water at 0 Ma and above the datum, so exposed shelf. The witness for §4.2: Natural Earth generalises the estuary as land and used to leave a hole here |
| Devil's Hole | 0.7 E, 56.6 N | not land | trenches more than 200 m deep inside the exposed shelf; correct water, and still an interior hole |
| South Atlantic | −60 E, −20 N | not land | outside every footprint; the mode falls back there |
| any point at 0 Ma | — | no interval | the present day is outside every published interval |

Note that a naive control fails here and is worth recording: the Viking Graben
at 2 E, 60.5 N is −104 m in ETOPO 2022 and is therefore **land** at this datum.
The northern North Sea is shallower than 120 m over most of its area.

## 9. Gates

- `validate_palaeo_coastlines_runtime.py` — runs everywhere, no offline store
  needed. Pins the crop digests, the datum, the window, the footprint bounds,
  the measured areas, the required limitations and references, the empty
  shallow-marine payload, the detached declaration and every witness. Its
  `--self-test` proves 16 mutations red, including: the datum changed to
  −130 m, a corrupted crop digest, a footprint area that no longer matches, the
  glacio-isostatic limitation dropped, the eustatic reference dropped, a payload
  shifted half a degree east (which turns the Norwegian Trench into land while
  staying inside the area tolerance), and a payload shifted twenty degrees east.
- `palaeo_coastlines_correction.py --self-test` — the compile oracle, under the
  pinned pyGPlates environment.
- `outlineTones.test.ts`, `palaeoComposite.test.ts`,
  `palaeoCoastlineAssets.test.ts`, `palaeoRings.test.ts` — interval selection at
  21, 19.4, 26.6 and 0 ka, the band rule, the native-land rule and the payload.

## 10. References

1. NOAA National Centers for Environmental Information 2022. ETOPO 2022 15 Arc-Second Global Relief Model. NOAA NCEI. https://doi.org/10.25921/fd45-gt74 — public domain, attribution requested. Not to be used for navigation.
2. Lambeck K., Rouby H., Purcell A., Sun Y., Sambridge M. 2014. Sea level and global ice volumes from the Last Glacial Maximum to the Holocene. PNAS 111, 15296–15303. https://doi.org/10.1073/pnas.1411762111
3. Clark P.U., Dyke A.S., Shakun J.D., Carlson A.E., Clark J., Wohlfarth B., Mitrovica J.X., Hostetler S.W., McCabe A.M. 2009. The Last Glacial Maximum. Science 325, 710–714. https://doi.org/10.1126/science.1172873
4. Coles B.J. 1998. Doggerland: a speculative survey. Proceedings of the Prehistoric Society 64, 45–81. https://doi.org/10.1017/S0079497X00002176
5. Bradley S.L., Ely J.C., Clark C.D., Edwards R.J., Shennan I. 2023. Reconstruction of the palaeo-sea level of Britain and Ireland arising from empirical constraints of ice extent. Journal of Quaternary Science 38, 791–805. https://doi.org/10.1002/jqs.3523
6. Sturt F., Garrow D., Bradley S. 2013. New models of North West European Holocene palaeogeography and inundation. Journal of Archaeological Science 40, 3963–3976. https://doi.org/10.1016/j.jas.2013.05.023
7. Hall R. 2009. Southeast Asia's changing palaeogeography. Blumea 54, 148–161. https://doi.org/10.3767/000651909X475941
8. Gaffney V., Fitch S., Smith D. 2009. Europe's Lost World: the Rediscovery of Doggerland. CBA Research Report 160, Council for British Archaeology, York. No DOI; two ISBNs circulate in published reviews.

All eight are citation-only except [1], whose derivative rings are what the
layer ships, and the present-day land subtracted from them: the Cao et al. 2024
v2.4 `shapes_coasts` collection (CC BY 4.0) and the observed-land omission
correction derived from Natural Earth 1:50m admin-0 land (public domain, "made
with Natural Earth"). No figure, map plate or coordinate
list from [2]–[8] is traced, digitised or redistributed.
