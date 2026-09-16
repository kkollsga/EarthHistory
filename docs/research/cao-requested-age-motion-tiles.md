# Cao requested-age motion tiles

> **Retired in 0.1.15.** The tier was removed end to end — the 72 `.ehmt`
> windows, their index, the emitter/promoter/validator and the tracked source
> contract are gone, and `motion-palette.bin` + `motion-palette.json` are the
> only motion path the runtime loads. The 5,743,096 published bytes were
> reclaimed to fund the 1:50m country outlines. Nothing scientific changed: the
> tier only ever transported exact copies of palette records. This record is
> kept as the design and measurement history of that tier, and everything below
> describes the retired design in the present tense.

## Decision and scientific scope

EarthHistory may show the URL-requested Cao age before downloading the complete
all-age motion palette. The optional requested-age tier changes transport only:
it copies records from the verified Cao v2.4 motion palette byte-for-byte and
does not add rotations, interpolation, geometry, material classifications, or
scientific support. The unchanged full palette remains authoritative and is
loaded after the first correct frame.

The package retains its complete core, five spatial batches, country lines,
anchors, checkpoint controls, material-correction catalog, chart IDs, and
picking IDs. This keeps the requested frame identical to the full package and
allows the runtime to replace the tile evaluator without republishing geometry.

## Format and partition

The domain from 0 through 1800 Ma is divided into 72 canonical 25 Ma windows.
Windows are youngest-inclusive and oldest-exclusive, except the final window,
which includes 1800 Ma. An exact multiple of 25 Ma selects the older window.

Each `EHMT` v1 tile contains a 32-byte header, ordered eight-byte descriptors
that identify the original palette entry index and local sample count, and
ordinary 20-byte Cao age/quaternion records. For each chart binding whose
lifecycle and binding overlap a window, the tile contains all source records in
that window plus the immediate younger and older records where they exist.
Touching bindings at closed endpoints are both retained. Each tile descriptor
also hashes the ordered original record indices as little-endian `uint32`
values.

The emitted tier contains 5,710,232 bytes across 72 tiles, 280,974 copied
records, and 11,056 entry descriptors. Its 28,068-byte index has SHA-256
`8eaaab15d8513dd3569e68be34b9794c6c2103a7f146d7eac8bf7ccdc69ac3a3`.
The total optional package addition is 5,738,300 bytes, below the reviewed
6.61 MB allowance.

## Source and identity

The source is the already verified EarthHistory compilation of the Cao et al.
2024 global plate model v2.4, DOI
[10.5281/zenodo.13628813](https://doi.org/10.5281/zenodo.13628813), CC BY
4.0, retrieved 2026-09-09. The frame is the Cao v2.4 palaeomagnetic frame,
anchor plate 0, with the rotation, topology, core, correction catalog, motion
catalog, and full motion binary hashes pinned in
`data/corrections/requested-age-motion-tiles/source-contract.json`.

The eight unreferenced legacy palette entries are absent from the optional
tiles. They remain available in the complete background palette and therefore
do not change package authority or archival coverage.

## Validation

Generate an isolated stage:

```sh
python3 scripts/research/emit_cao_requested_age_motion_tiles.py \
  --package public/data/reconstruction/cao-v2.4 \
  --out /tmp/earthhistory-requested-age/data/stage/motion-tiles \
  --manifest-out /tmp/earthhistory-requested-age/data/stage/manifest.json
```

Validate deterministic bytes and the staged manifest:

```sh
python3 scripts/research/validate_cao_requested_age_motion_tiles.py \
  --package public/data/reconstruction/cao-v2.4 \
  --tiles /tmp/earthhistory-requested-age/data/stage/motion-tiles \
  --manifest /tmp/earthhistory-requested-age/data/stage/manifest.json \
  --self-test
```

The source-bound validation covers 2,103 critical ages and 6,955,591 selected
chart/segment comparisons, including every tile boundary and authored source
knot at one-micro-Ma neighbors, 0, 74, 411, 422, and 1800 Ma. It compares
142,109 preparations from both tiles touching a boundary. It also checks the
four exact-present singleton entries and the two declared open plate-626 source
seams `(79.1, 79.100001)` and `(119.999999, 120)` Ma. Deliberate quaternion,
source-record-index, missing-bracket, and interval-boundary mutations must fail.
