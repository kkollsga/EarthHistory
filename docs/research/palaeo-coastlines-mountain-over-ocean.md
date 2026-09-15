# Mountain (`m`) polygons over ocean: a global audit of the Cao 2017 relief class

Audited 2026-09-15 against repository HEAD `49ccb43551c9abb3b0b9e27b09dc6c7af279d978`
(branch `codex/palaeo-coastlines`). Read-only measurement; no shipped artefact changed.

## Question

The Paratethys memo (`docs/research/palaeo-coastlines-paratethys.md`) found a Cao et al.
(2017) mountain polygon drawn over the abyssal Western Black Sea at (34 E, 43 N) in the
`49-37` interval. This audit asks whether that is one bad polygon or a class-wide defect,
and whether a compiler rule keyed on Cao et al. (2024) v2.4 continental crust can remove it.

## Inputs and frame

| Input | Digest |
|---|---|
| `public/.../palaeo-coastlines/m/*.ehpr`, 24 intervals + `lgm`, and `lm`/`sm` peers | 79 files, `scratch/head/SHA256SUMS.txt`; `m/palaeo-m-49-37.ehpr` `422a7c43…50371b7`, `m/palaeo-m-catalog.json` `9fbda74f…f044ed7b7` |
| `palaeo-m-provenance.json` (offline store, 4,787 chart records) | `becf3580180b4fd75508328ebc21d79c060a2fd5fc7e8f8475e8bd29b36cbb30` |
| `1.8Ga_model_GSF/shapes_continents.gpmlz` | `6e30de73967f81a403f46370295dec5c0d7ed3ffd80c73d47df926461d949616` (877 polygons) |
| `1000_0_rotfile.rot` | `e13c16ef5b2f8f116f598635e42a126b016b2c615358b499bcc3433f4a3c735c` |
| `1800_1000_rotfile.rot` | `db2a57a8b7c7a08891c19840b6334ffb9c279b6a991a2c2eed099edb23445785` |
| `ne_50m_admin_0_countries` (pinned, via `palaeo_coastlines_lgm_derive.load_present_day_land`) | pin verified by the loader |

Two frames were measured, because neither alone is honest:

- **Present-day frame** (cheap; both sides are present-day geometry — the `m` pieces are
  stored present-day and reconstructed at runtime, and `shapes_continents` stores
  present-day outlines with a plate id). Exact polygon difference, spherical areas.
- **Render frame** (what the user sees): each piece is posed at the interval mid-age by
  its own binding, each crust polygon by its own plate id. Implemented by rotating
  sample points forward with the binding rotation and back with each candidate crust
  plate's inverse rotation, so no polygon needs an antimeridian split. 26 samples/piece,
  so a per-piece fraction is granular to ~4 %; interval totals are unaffected.

`bothOff = min(present-day off-crust fraction, render-frame off-crust fraction)`. A piece
counts as off-crust only where **both** frames agree, because each frame has a large,
identifiable false-positive population (below).

Every `m` piece in every interval was measured (11,710 pieces, 438.94 Mkm²; the `lgm`
interval carries no `m` geometry).

## Per-interval result

`pd off` = present-day off-crust share of `m` area. `rc off` = render-frame off-crust
share. `both off` = the conjunction. `drop` = the proposed rule (Section "Rule").

| interval | pieces | m area Mkm² | pd off % | rc off % | both off % | drop n | drop Mkm² | drop % |
|---|---|---|---|---|---|---|---|---|
| 402-380 | 132 | 6.01 | 11.76 | 12.67 | 9.56 | 6 | 0.057 | 0.96 |
| 380-359 | 137 | 6.36 | 18.17 | 14.84 | 11.80 | 3 | 0.011 | 0.18 |
| 359-338 | 188 | 9.32 | 13.58 | 15.54 | 11.18 | 11 | 0.397 | 4.26 |
| 338-323 | 206 | 10.91 | 15.90 | 15.36 | 11.31 | 13 | 0.481 | 4.41 |
| 323-296 | 264 | 13.99 | 21.96 | 13.91 | 12.49 | 14 | 0.623 | 4.46 |
| 296-285 | 285 | 17.41 | 17.42 | 11.68 | 10.31 | 3 | 0.006 | 0.03 |
| 285-269 | 165 | 10.48 | 11.27 | 2.71 | 2.36 | 0 | 0.000 | 0.00 |
| 269-248 | 296 | 18.74 | 11.00 | 11.63 | 5.93 | 4 | 0.070 | 0.38 |
| 248-224 | 160 | 5.82 | 7.62 | 8.39 | 3.56 | 0 | 0.000 | 0.00 |
| 224-203 | 157 | 5.17 | 4.77 | 2.49 | 0.00 | 0 | 0.000 | 0.00 |
| 203-179 | 163 | 6.90 | 2.15 | 7.25 | 1.36 | 1 | 0.009 | 0.13 |
| 179-166 | 455 | 10.89 | 8.07 | 14.07 | 4.44 | 14 | 0.256 | 2.35 |
| 166-146 | 510 | 19.16 | 2.37 | 5.38 | 1.55 | 1 | 0.029 | 0.15 |
| 146-135 | 437 | 18.47 | 1.25 | 5.06 | 0.95 | 4 | 0.060 | 0.32 |
| 135-117 | 543 | 18.97 | 3.12 | 7.39 | 2.74 | 24 | 0.344 | 1.82 |
| 117-94 | 703 | 22.50 | 4.06 | 9.76 | 3.31 | 28 | 0.379 | 1.68 |
| 94-81 | 612 | 24.14 | 3.06 | 6.70 | 2.41 | 11 | 0.048 | 0.20 |
| 81-58 | 792 | 31.14 | 3.37 | 6.90 | 3.03 | 13 | 0.195 | 0.63 |
| 58-49 | 737 | 27.85 | 4.14 | 9.25 | 3.86 | 18 | 0.164 | 0.59 |
| 49-37 | 759 | 26.71 | 1.56 | 6.78 | 1.33 | 6 | 0.026 | 0.10 |
| 37-29 | 963 | 30.02 | 2.52 | 8.35 | 1.84 | 32 | 0.401 | 1.34 |
| 29-20 | 912 | 27.66 | 1.63 | 3.86 | 1.21 | 25 | 0.223 | 0.81 |
| 20-11 | 1090 | 37.88 | 1.03 | 2.09 | 0.80 | 12 | 0.097 | 0.26 |
| 11-2 | 1044 | 32.47 | 1.19 | 4.13 | 1.06 | 5 | 0.022 | 0.07 |
| `lgm` | 0 | 0 | – | – | – | 0 | 0 | – |
| **all** | **11,710** | **438.94** | **5.34** | **7.60** | **3.54** | **248** | **3.900** | **0.89** |

Palaeozoic intervals carry the defect an order of magnitude more heavily than Neogene ones
(`323-296`: 12.5 % both-frame off-crust; `20-11`: 0.80 %), which is what the cookie-cut
method predicts: the older the interval, the further the present-day partition geometry is
from the source author's own reconstruction.

## Top offending pieces (global, by off-crust area, rule set at X = 0.7)

Source record ids are `sourceRecordIndex` into `palaeo-m-provenance.json`.

| interval | src | PLATEID1 | binding | kind | area km² | pd/rc off | bbox (present-day) | sits over |
|---|---|---|---|---|---|---|---|---|
| 37-29 | 1515 | 212 | 212 (part 909) | override | 186,915 | 0.99 / 0.92 | −96.6,10.1 → −89.1,15.2 | Gulf of Tehuantepec, Middle America Trench |
| 338-323 | 4537 | 101 | 101 | partition | 165,811 | 0.97 / 1.00 | −73.7,37.2 → −52.3,44.7 | NW Atlantic abyssal plain off Newfoundland |
| 179-166 | 3739 | 603 | 603 | override | 118,587 | 0.99 / 0.75 | 93.8,6.4 → 96.5,15.2 | Andaman Sea / Alcock–Sewell spreading centre |
| 323-296 | 4427 | 302 | 551 | partition | 105,400 | 0.97 / 1.00 | 28.9,41.5 → 45.8,44.7 | **Western + Eastern Black Sea basins** |
| 117-94 | 2995 | 103 | 16140 | partition | 100,679 | 0.99 / 1.00 | −171.3,57.3 → −163.4,60.9 | Bering Sea shelf edge, St. Matthew |
| 81-58 | 2337 | 802 | 802 | partition | 98,576 | 0.97 / 1.00 | 0.4,−70.1 → 30.5,−68.7 | Lazarev / Riiser-Larsen Sea, Antarctica |
| 323-296 | 4432 | 141 | 101 | partition | 87,698 | 1.00 / 1.00 | −125.7,80.5 → −65.1,85.7 | Amerasia Basin, Arctic Ocean |
| 338-323 | 4539 | 714 | 714 | partition | 84,293 | 0.99 / 0.83 | −18.8,21.8 → −15.6,27.4 | Saharan Atlantic continental slope |
| 117-94 | 2870 | 806 | 835 | partition | 81,140 | 0.99 / 1.00 | 171.8,−34.4 → 175.9,−29.9 | South Fiji Basin / Norfolk Ridge flank |
| 323-296 | 4435 | 309 | 301 | partition | 80,327 | 1.00 / 1.00 | 15.9,81.2 → 90.9,84.8 | Nansen–Gakkel / Eurasia Basin, Arctic Ocean |

## Causes

Measured attribution over the 656 pieces whose present-day off-crust-and-off-`lm`/`sm`
fraction exceeds 0.2, cross-checked in the render frame, plus a modern-land screen
(Natural Earth 1:50m) over the 844 pieces with `bothOff > 0.2`:

- **(a) Cao 2017 source artefact — relief drawn over water that was already open.**
  361 pieces (9.70 Mkm²) are off crust in *both* frames. The record's own outline covers
  ground that is oceanic today and was not continental at the interval age. This is the
  dominant cause by area and the one the compiler can act on.
- **(b) Binding placement.** 131 of the 248 rule-set pieces (2.14 Mkm², 55 % of the rule
  set's area) carry a binding plate different from their own `PLATEID1`, and 94 are
  `override` bindings. The Arctic rows above are the type case: source record 4435 has
  `PLATEID1` 309 (Barents/Svalbard) but its Arctic-Ocean fragment cookie-cuts onto
  Eurasia 301 and is then carried out over ground that was open ocean. Conversely 3
  pieces sit on crust present-day and leave it only in the render frame — binding
  placement alone is a small direct contributor, but it compounds (a).
- **(c) Crust-outline difference between Cao 2017 and Cao 2024.** The largest
  false-positive source, and it cuts both ways:
  - *Envelope, not crustal type.* `shapes_continents` polygons are block envelopes that
    swallow young marginal basins. Plate 551 has one polygon (236,973 km², valid
    250 Ma → present) covering the **entire Black Sea including the abyssal Western
    Black Sea**; plate 322 covers the Ionian Sea; plate 659 covers the West Philippine
    Basin. Any test built on `shapes_continents` is blind inside those envelopes.
  - *Coverage gaps.* 100 of the 348 pieces that pass a pure crust-plus-`lm`/`sm` test
    (4.86 Mkm², 55 % of that set's area) are **modern dry land**: NW Mexico
    (src 4691, 96 % land), the Turan platform and Kopet Dagh (src 4342/4427, 58–100 %),
    interior Alaska and the Bering shelf (src 2186/2731, 63–68 %), Honshu (src 2424,
    65 %), Sikhote-Alin (src 4323, 98 %). Cao 2024 simply has no continental polygon
    there at that age. Dropping these would delete real orogens.
  - *Validity gaps.* Plate 551's polygon begins at 250 Ma, so at `323-296` the Black Sea
    block is absent from the crust set entirely and the same ground scores 0.97 off-crust
    while at `49-37` it scores 0.00.
- **(d) Frame artefact of a present-day-only test.** 171 pieces (4.88 Mkm²) are off crust
  in the present-day frame but land on crust once reconstructed — Appalachian and
  Ouachita relief overhanging the present-day US Atlantic margin and Gulf of Mexico,
  which at 290 Ma sat against its African/Yucatán conjugate. These are correct and must
  not be dropped. This is why the rule uses the conjunction of both frames.

## Rule

Distribution of `bothOff` (both-frame off-crust fraction): 10,614 pieces at ~0, a thin
tail (119 pieces 0.001–0.05, 62 at 0.05–0.10, 71 at 0.10–0.20, 33 at 0.20–0.30, 40 at
0.30–0.50, 53 at 0.50–0.70), then a heavy mode of 718 pieces above 0.70 holding
14.76 Mkm². Per-bin area is ≤ 1.0 Mkm² below 0.70 and 1.87 / 5.95 / 6.94 Mkm² in the
0.70–0.90 / 0.90–0.99 / 0.99–1.0 bins. **The elbow is X = 0.70.** The choice is not
delicate: X from 0.5 to 0.9 moves the removal only from 1.03 % to 0.66 % of `m` area.

Proposed compiler rule, to run per piece after binding and before encoding:

> Drop an `m` piece when **all three** hold:
> 1. `bothOff > 0.70` — more than 70 % of its area lies outside Cao 2024
>    `shapes_continents` valid at the interval mid-age, in the present-day frame **and**
>    in the render frame (piece by its binding, crust by its own plate);
> 2. more than 70 % of its area lies outside the `lm` and `sm` pieces of the same
>    interval and record set (present-day frame);
> 3. at most 20 % of its area is modern dry land (pinned Natural Earth 1:50m).
>
> Record every drop with its source record id, binding, area and the three fractions, the
> way `FRAME_CONFLICT_DROP_KM` drops are already counted. Reclassify rather than drop is
> *not* recommended: there is no defensible class for "orogen over oceanic crust", and
> demoting to `lm` would assert emergent land the source does not support.

Cost of the rule: **248 pieces, 3.90 Mkm², 0.89 % of total `m` area**; per interval in the
table above. Worst intervals `323-296` (4.46 %), `338-323` (4.41 %), `359-338` (4.26 %);
nine intervals lose nothing. Without clause 3 it would be 348 pieces and 8.76 Mkm² — and
would delete Honshu, NW Mexico and the Turan platform.

## The witness, and what the rule does not do

**The rule does not remove the Paratethys witness.** At `49-37` the Cao 2024 plate-551
envelope covers the whole Black Sea, so source record 1775 (PLATEID1 522, override
binding, four pieces totalling 330,218 km², bboxes spanning 28.4–45.1 E, 40.1–44.8 N)
measures **0.00 off-crust in both frames**. The six pieces the rule does remove at `49-37`
are Zanzibar-channel slivers (src 1755/1842) and South China Sea fragments off Luzon
(src 1876), 26,418 km² in total. The same ground is caught at `323-296` only because the
551 polygon is not yet valid there.

What this proves: `shapes_continents` is a continental **block envelope**, not a map of
crustal type, and cannot adjudicate relief drawn over a back-arc or marginal basin that
opened inside the block. A rule keyed on it is a floor, not a solution. Closing the
Black Sea case needs a second, independent screen — the model's own `COBfile_1800_0.gpml`
continent-ocean boundaries, or a dated basin-opening contract in
`data/corrections/palaeo-coastlines/basins/` with the Paratethys literature behind it.
That screen is out of this audit's scope and unmeasured here; it should not be claimed as
available until it is measured.

## Reproduction

`scratch/m-ocean/probe.py` (present-day differences, 10 s), `probe2.py`/`probe3.py`
(render-frame point samples, 27–38 s), `probe4.py` (crust containment at named points),
`probe5.py` (modern-land screen), all under
`../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python`, importing
`scripts/research/palaeo_coastlines_compile.py` read-only. Per-piece evidence:
`m-off-crust-pieces.csv`, 11,710 rows, one per piece, with both fractions, binding,
bbox and the reconstructed crust plates each piece lands on.
