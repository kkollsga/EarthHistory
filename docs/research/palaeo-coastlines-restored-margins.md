# Restored pre-collision margins for the Alps and the Caledonides — implementation record

Implemented 2026-09-15 against the design memo
[palaeo-coastlines-restored-margins-design.md](palaeo-coastlines-restored-margins-design.md),
which this record supersedes as the statement of what ships. The design's
projected acceptance run is reproduced here from the tracked contract, and every
number below was re-derived by the scripts named beside it.

**It is crust, not land.** No strip asserts a shoreline, a water depth, a relief
or a subaerial exposure at any age. Every strip carries
`surfaceEvidence: { kind: "unknown" }`, and the batch that owns the charts
declares the **shelf** appearance so the renderer draws them as crust of
unmapped depth rather than with the land fill every other material-correction
batch carries.

## A. What ships

| Path | Bytes | Content |
|---|---:|---|
| `data/corrections/restored-margins/restored-margins-alps-v1.geojson` | 26,105 | 10 Adriatic and European strips |
| `data/corrections/restored-margins/restored-margins-caledonides-v1.geojson` | 12,292 | 5 Baltoscandian and Laurentian strips |
| `data/corrections/restored-margins/restored-margins-manifest.json` | 86,212 | the contract: 22 sources, 15 features, lifecycles, uncertainty, editorial, consumption model |

Correction id `earthhistory-restored-collision-margins-v1`, phase
`restored-collision-margin`, source feature type
`EarthHistoryRestoredCollisionMargin`, chart id
`correction:earthhistory-restored-collision-margins-v1:<featureId>:restored-collision-margin`.

Owners: `scripts/research/restored_margins_compile.py` derives the geometry from
the pinned Cao 2024 v2.4 model under the pinned pyGPlates environment;
`scripts/research/restored_margins_manifest.py` holds the literature record and
assembles the manifest; `scripts/research/restored_margins_correction.py` is the
gate; `scripts/research/emit_cao_material_corrections.py` emits the charts.

## B. Strips, areas and the retirement schedule

**Measured** by the compile step. 15 strips, **852,308 km²** of restored
continental crust, all at `geometryReferenceAgeMa = 0` in present-day WGS84
reference coordinates, all riding Cao rigid plate motion, all
`epistemicStatus: model-inference` with `poseStatus: model-inference`.

| Strip | Plate | Offset band (km) | Width (km) | Area (km²) | Alive (Ma) |
|---|---:|---|---:|---:|---|
| `alps-adria-distal-margin-oct-plate-307` | 307 | +126 … +186 | 60 | 5,601.2 | 165 → 35 |
| `alps-adria-distal-margin-oct-plate-308` | 308 | +126 … +186 | 60 | 27,364.8 | 165 → 35 |
| `alps-adria-necking-zone-plate-307` | 307 | +71 … +126 | 55 | 5,185.0 | 180 → 19 |
| `alps-adria-necking-zone-plate-308` | 308 | +71 … +126 | 55 | 25,342.0 | 180 → 19 |
| `alps-adria-proximal-retrowedge-plate-307` | 307 | edge … +71 | 71 | 13,822.6 | 200 → 5 |
| `alps-adria-proximal-retrowedge-plate-308` | 308 | edge … +71 | 71 | 51,217.4 | 200 → 5 |
| `alps-europe-distal-margin-oct-plate-305` | 305 | −234 … −150 | 84 | 47,301.0 | 165 → 40 |
| `alps-europe-outer-necking-zone-plate-305` | 305 | −150 … −105 | 45 | 25,077.2 | 180 → 32 |
| `alps-europe-inner-necking-zone-plate-305` | 305 | −105 … −60 | 45 | 24,891.4 | 180 → 25 |
| `alps-europe-proximal-subducted-margin-plate-305` | 305 | −60 … 0 | 60 | 32,897.4 | 200 → 10 |
| `caledonides-baltica-distal-margin-cot-plate-302` | 302 | 250 … 401 W | 151 | 169,559.4 | 600 → 430 |
| `caledonides-baltica-outer-shelf-plate-302` | 302 | 130 … 250 W | 120 | 133,880.0 | 600 → 420 |
| `caledonides-baltica-middle-allochthon-root-plate-302` | 302 | 0 … 130 W | 130 | 144,611.5 | 600 → 405 |
| `caledonides-laurentia-distal-margin-cot-plate-102` | 102 | 100 … 202 E | 102 | 73,372.6 | 600 → 425 |
| `caledonides-laurentia-proximal-margin-plate-102` | 102 | 0 … 100 E | 100 | 72,184.4 | 600 → 410 |

Per margin: Adria 128,533.0 km², Europe 130,167.0 km², Baltica 448,050.9 km²,
Laurentia 145,557.0 km².

Every `youngest` bound is **exclusive**, so a strip is already gone at its own
retirement age. That is what lets `caledonides-laurentia-proximal-margin` end
exactly on the 410 Ma authoring junction where `Eurasia` and `Timan Region`
begin, without the correction and the native charts drawing the same ground.

Widths are the sources' claims; retirement ages are our inference, fitted to the
model's own closure and snapped to published stage boundaries. The manifest
declares the two separately.

## C. Datum-partition binding, and the 307/308 split

Each strip sample is attributed to the Cao 2024 **static partition of its datum
point**, never to the partition beneath the restored ground: that partition is
oceanic, and binding to it would detach the restored margin from the continent
it restores. The sample is then bound to the carrying plate that partition
names, and a strip is split wherever that carrying plate changes.

**Measured**, that rule splits the Adriatic family between 8.75 and 9.00 E:
`Adria` (307) carries the datum west of it and `Eastern Dinaride Platform` (308)
east of it. The design predicted the split at 8.875 E from a 0.25° scan and the
compile found it in the same interval. Consecutive runs share their boundary
sample, so the two families meet rather than leaving a gap at 0 Ma; because they
ride different plates they open a seam at older ages (design risk 6, inherited
from Cao's own tiling, up to 51.6 km at 130–180 Ma).

Datum profiles, **measured** at 0.01°:

| Meridian | Europe south limit | Adria north limit |
|---|---:|---:|
| 8 E | 46.30 N | 45.57 N |
| 10 E | 47.32 N | 47.31 N |
| 12 E | 47.70 N | 47.69 N |
| 14 E | 47.92 N | 47.07 N |

| Parallel | plate-302 coast west limit | plate-102 crust east limit |
|---|---:|---:|
| 62 N | 5.38 E | — |
| 64 N | 9.97 E | — |
| 66 N | 12.55 E | — |
| 68 N | 15.40 E | — |
| 70 N | 18.93 E | −22.20 E |
| 72 N | — | −20.50 E |
| 74 N | — | −18.46 E |
| 76 N | — | −5.84 E |

Greenland is authored only between 70 and 76 N, tapered to zero over
69.5–70 and 76–76.5 N. North of 76 N the plate-102 outline already reaches −6 to
−4 E, and offsetting 200 km further east would place restored Laurentian crust
inside the Svalbard domain. The East Greenland Caledonides continue to ~81 N;
this truncation is deliberate and the gate holds the band.

## D. Interaction guards

**No overlap with the North Sea rigid restoration.** `--model` re-derives the
minimum great-circle gap between the restored Baltoscandian margin (riding 302)
and the UK block at 430, 425, 420, 415, 410 and 405 Ma, in both the native and
the restored pose of plates 303 and 315. **Measured** minima over that window:

| Against | Native Cao pose | North-Sea-restored pose |
|---|---:|---:|
| Plate 303 (`Northern Highlands`) | 71.3 km | **56.2 km** |
| Plate 315 | 418.7 km | 419.1 km |

All four clear the pinned 50 km minimum. The restored 303 row is the binding
one: the tracked restoration closes the Shetland–Bergen docking gap entirely at
Caledonian ages, which is why the southern taper starts at 60.5 N and reaches
full width only at 62 N.

**Crust, not land, in the stacking.** The strips are the first correction batch
to declare a `surfaceAppearance`, and it is `shelf`. The renderer gives a
shelf-appearance correction batch its own surface class, `correction-shelf`, on
the 700 m shell at render order 1.1 — above the native shelf, **below**
palaeo-shallow-marine, and below the 800 m `corrections` class. It is not put on
the native shelf's own 400 m shell, where it would be a second depth-writing
surface coplanar with the shelf and interleave with it. The stacking assertion
in `caoFoundation.test.ts` still holds: the class writes no depth, so the two
pairs it cannot separate geometrically (`correction-shelf` under
`palaeo-shallow-marine` and under `corrections`) take the same policy exemption
`palaeo-shallow-marine > corrections` already takes, and the one depth-writing
class below it — the shelf at 400 m — is cleared by 700 − 242.59 = 457.41 m.
`correction-shelf` is deliberately **not** in
`CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES`: a "is this land" question answers no
over restored margin crust.

## E. Acceptance: the shortening verdicts

`scripts/research/validate_precollision_extent.py`, re-run with the restored
margins joined to the lower-plate crust group of each transect (datum groups
stay native-only, exactly as `india_present_crust` excludes Greater India):

| Transect | Quantity | Native | With restored margins | Minimum | Verdict |
|---|---|---:|---:|---:|---|
| **Alps 10 E** | Adriatic crust north of the native European margin | 0 km | **184.6 km** | 140 km | **PASS** |
| Alps 8 / 12 / 14 E | same | 0 km | 184.6 km | — | — |
| Alps, all four | European crust beyond its own present outline | 0 km | **233.5 km** | 230 km | clears |
| **Caledonides 62 N** | Baltican crust west of the plate-302 coastline | 122.2 km | **400.9 km** | 140 km | **PASS** |
| Caledonides 64 / 66 / 68 N | same | 188.2 / 142.0 / 135.8 km | 400.7 km | 250 km at 66 N | clears |
| Caledonides 58 / 60 N | same, outside the authored belt | 287.6 / 190.1 km | unchanged | — | — |
| Greenland 70 / 72 / 74 / 76 N | Laurentian crust east of its own outline | 0 km | 201.6 / 201.4 / 201.7 / 201.8 km | 200 km | clears |
| India 85 E | unchanged control | 1,341.0 km | 1,341.0 km | 1,000 km | PASS |

The run also re-derived, unchanged, the seven pinned feature identities and
areas, the nineteen reconstructed overlaps, the eleven minimum gaps and the
twenty pin-pair convergences: the restored margins join the transect groups
only, never the reconstructed-overlap groups, so the model's own statements
about consumed crust are not inflated by our charts.

`docs/research/palaeo-coastlines-collision-shortening.json` now records both
halves of each verdict — `modelExtentKm` with the restored margin and
`nativeModelExtentKm` without it — so a record that dropped the margin and kept
the verdict cannot stay green.

## F. Gates

| Gate | What it proves | Mutations proven red |
|---|---|---:|
| `restored_margins_correction.py --self-test` | the tracked contract: identities, plates, widths, lifecycles, bands, sources, the seam schedule, the declared crust appearance | 9 |
| `restored_margins_correction.py --self-test --model` | and the North Sea clearance | 11 |
| `restored_margins_correction.py --runtime` | the generated catalog, the motion partition and the batch each chart lands in | 1 runtime mutation |
| `validate_precollision_extent.py --record-only --self-test` | the verdicts follow their numbers and each pinned extent still has its margin behind it | 14 |
| `src/reconstruction/restoredMargins.test.ts` | the bytes a browser downloads: posed at 45 and 420 Ma, absent at 0, 1 and 5 Ma, crust not land, map-key wording | 3 tests, each proven red by a deliberate mutation and restored |

All of them run from `make check-corrections`; the two that need pyGPlates run
behind the same venv guard `check-palaeo-compile` uses, and say "not run" by
name where the environment is absent. `make gate` is green: 292 unit tests,
1,341 data files verified, `dist` 51,400,693 B (49.02 / 50 MiB). The published
cost of this change is the 60,380-byte `restored-margin.ehgb` batch (1,566
vertices, 2,419 triangles) and a correction catalog that grows from 220,600 to
243,939 bytes.

## G. What the map key says

> Restored pre-collision margins · model inference after Le Breton et al.
> (2021), Schmid et al. (1996), Handy et al. (2010), Gayer et al. (1987), Gee
> (1978), Lorenz et al. (2011) and Fossen (2010); published spread 140–423 km
> per margin; consumed by collision between 430 and 405 Ma (Caledonides) and 40
> and 5 Ma (Alps). Crust of unmapped depth, not mapped geography: no shoreline
> or water depth is claimed.

Gated on the charts being posed, not on the age, beside the Greater India line
it is modelled on. Per-strip editorial lines in the manifest carry the same
register one margin at a time.

## H. Findings this pass, including the design risks that materialised

1. **The schedule overflows its seam between two published stage boundaries.**
   At every retirement age the surviving strips fit inside the model's measured
   Adria–Europe seam on 10 E. Between boundaries they do not: **39.1 km** of
   excess at 20 Ma and **18.2 km** at 15 Ma. This is the cost of snapping
   retirement to cited stages rather than fitting them to the closure curve, and
   it is declared in the contract (`consumptionModel.alps.maxInterStageOverflowKm`)
   and gated at 40 km rather than hidden. Moving a retirement age off a
   published boundary would replace a cited stage with a fitted one.
2. **Design risk 6 materialised as predicted** — the 307/308 families open a
   seam at their junction at older ages. Inherited from Cao's own tiling.
3. **Design risk 7 materialised as predicted** — the innermost Adriatic strip
   fills the present-day hole Cao leaves in the western and eastern Alps (82 km
   at 8 E, 95 km at 14 E) as a side effect of its datum. That hole still
   deserves its own finding and decision.
4. **Design risks 1, 2, 3, 4, 5, 9, 10 stand unchanged**: the model's Mesozoic
   Alpine Tethys is about twice the literature's width, first crust contact at
   10 E lands at ≈ 44 Ma against a ~35 Ma published onset, 39 km of post-5 Ma
   closure has no authored crust behind it, the surviving Baltican strips
   overlap Greenland between 432 and 405 Ma (which is Gayer et al. 1987's
   explicit prediction, resolved visually by native precedence), Kissling &
   Schlunegger 2018's rollback model would not require the Adriatic margin at
   all, the retirement ages are a fitted schedule, and three load-bearing papers
   are still read through citing papers.
5. **Design risk 8 (partial area coverage) is unchanged and now measured**:
   593,608 km² of Caledonide margin over a ~1,020 km belt, against the tracked
   memo's ≥ 1.08 Mkm² over Fossen's full 1,800 km orogen.
6. **Design risk 11 was decided against splitting**: the Alps and the
   Caledonides ship together, because the acceptance gate, the contract, the
   batch and the map-key line are one mechanism and splitting them would have
   shipped half a mechanism twice.
7. **A pre-existing defect was found and fixed in passing.**
   `scripts/research/verify_iceland_motion.py` read the correction catalog with
   plain `json.loads` after that catalog started shipping interned, so it found
   zero Iceland charts and could not re-derive its own tracked oracle record. It
   now reads through `cao_package_intern`.

## I. Scope note

The design memo's § E.3 proposed putting these charts in the existing
`material-correction-uncertain` batch. They ship in their own batch,
`material-correction-restored-margin`, because a surface appearance is declared
per batch and the uncertain batch's appearance is land. Everything else about
the emission follows the design.
