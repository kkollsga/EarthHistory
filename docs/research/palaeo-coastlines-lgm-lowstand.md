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

**Not claimed.** Six limitations ship with the layer, appear in the map key and
are asserted by the validator; dropping any of the first four turns the gate
red.

| Limitation | Why |
|---|---|
| eustatic only, one flat −120 m datum | Lambeck et al. 2014 give a global mean, not a local sea surface |
| no glacio-isostatic adjustment | relative sea level around Britain and Ireland varies by more than 100 m spatially under GIA [5]; a flat contour is wrong in detail exactly where Doggerland is |
| ice sheets are not drawn | ground under the Fennoscandian, British–Irish and Laurentide ice sheets is shown as exposed land, which it was not |
| ETOPO 2022 is modern bathymetry | post-LGM sediment is not removed; the present-day sea bed is not the lowstand land surface. Coles 1998 says this directly: present-day North Sea relief "does not provide a sound guide" to the former landscape |
| regional | three footprints; every other coastline at this age is the present-day one |
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
4. drop parts below 25 km² (the pipeline's floor everywhere else), simplify at
   0.02° with topology preserved, drop again, round to 4 decimals;
5. write `lgm-lowstand-v1.geojson` (107,752 bytes) and its manifest.

The compiler then treats the result exactly like a Cao source record: cookie-cut
by the present-day Cao 2024 static partitions with one owner per piece, bound to
the owner plate through `palaeo-binding-entry-v1`, and given the contract's own
`(19.5 ka, 26.5 ka]` lifecycle. It is marked pre-simplified, so the compiler's
own node reduction leaves the rings alone rather than moving a coastline the
derivation already measured.

## 5. Measured areas

| Footprint | LGM land | of which present-day land | exposed shelf |
|---|---|---|---|
| North Sea box (−6…12 E, 49…62 N) | 1,398,252 km² | 739,277 km² | **658,203 km²** |
| Sunda box (95…120 E, −10…12 N) | 4,085,717 km² | 1,829,335 km² | **2,256,842 km²** |
| Beringia box (160 E…−150 E, 55…72 N) | 3,641,314 km² | 2,002,844 km² | **1,638,056 km²** |
| total | 9,125,283 km² | 4,571,457 km² | 4,553,101 km² |

The footprint boxes are far larger than the landscapes the literature names, so
one named sub-window per footprint is measured beside them:

| Sub-window | Bounds | LGM land | exposed shelf |
|---|---|---|---|
| southern North Sea plain ("Doggerland") | −2…9 E, 51…57 N | 477,876 km² | **310,950 km²** |
| Sunda shelf core | 99…118 E, −6…8 N | 2,832,082 km² | 1,541,980 km² |
| eastern Bering land bridge | −180…−160 E, 60…70 N | 1,002,946 km² | 646,261 km² |

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

The published payload measures 9,125,322 km² against the contract's 9,125,283
km² — 0.0004 % apart after cookie-cutting, the 25 km² floor and int16
quantisation. 111 km² was dropped as 19 sub-floor slivers.

## 6. What ships

| Item | Value |
|---|---|
| landmass payload | `lm/palaeo-lm-lgm.ehpr`, 40,746 bytes, 272 pieces, 389 rings, 9,168 vertices |
| shallow-marine payload | `sm/palaeo-sm-lgm.ehpr`, **32 bytes** — a header and nothing else |
| interval index | 24, the 25th and last row of both class catalogs, declared in `detachedIntervalIds` |
| triangles at 1° | 16,343 estimated; far below every other interval |
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
| London | −0.1 E, 51.5 N | land | present-day land, unchanged by a lowstand |
| Norwegian Trench | 4 E, 58.5 N | not land | −254 m, far below the datum |
| Makassar Strait | 118.5 E, −2 N | not land | never closed by a lowstand (Hall 2009 [7]) |
| Aleutian Basin | −175 E, 57 N | not land | deep ocean south of the shelf break |
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
  `--self-test` proves 15 mutations red, including: the datum changed to
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
layer ships. No figure, map plate or coordinate list from [2]–[8] is traced,
digitised or redistributed.
