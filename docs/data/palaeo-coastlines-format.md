# EHPR v1 — palaeo-coastline ring payload

The palaeo-coastline layer streams polygon rings, not triangles. `EHPR` is the
wire format for one surface class of one published map interval; the runtime
decodes it in a worker, triangulates each piece and refines it to a maximum
1° edge. This page specifies the bytes, the catalog that indexes them and the
country-outline tone tables that ship with them.

The payloads are produced offline by
`scripts/research/palaeo_coastlines_compile.py` and checked by
`scripts/research/palaeo_coastlines_correction.py`. Their source is Cao et al.
(2017) landmass, shallow-marine and mountain polygons, cut by present-day
Cao et al. (2024) v2.4 static partitions; the scientific record is
[Cao 2017 palaeogeography as a palaeo-coastline source](../research/palaeo-coastlines-cao2017.md)
and its audit JSON.

## Files

| File | Holds |
|---|---|
| `<class>/palaeo-<class>-<intervalId>.ehpr` | one class, one interval: pieces, rings, vertices |
| `<class>/palaeo-<class>-catalog.json` | the class catalog: charts, bindings, evidence, per-interval file list and reservations |
| `outline-tones.ehpt` | 24 country-outline tone tables, two bits per segment |
| `outline-tones.json` | tone-table catalog and the per-interval file index across classes |

`<class>` is `lm` (landmass), `sm` (shallow marine) or `m` (mountain).
`<intervalId>` is the published map interval, `402-380` … `11-2`.

## EHPR v1 layout

All integers and floats are little-endian. The file is four consecutive
sections with no padding between them.

### Header — 32 bytes

| Offset | Type | Field |
|---|---|---|
| 0 | 4 bytes | magic `EHPR` |
| 4 | u16 | version, `1` |
| 6 | u16 | header bytes, `32` |
| 8 | u32 | piece count |
| 12 | u32 | ring count |
| 16 | u32 | vertex count |
| 20 | u16 | class code: 1 `lm`, 2 `sm`, 3 `m` |
| 22 | u16 | interval index, 0 = oldest (`402-380`) … 23 = youngest (`11-2`) |
| 24 | f32 | interval oldest age, Ma (`FROMAGE`) |
| 28 | f32 | interval youngest age, Ma (`TOAGE`) |

### Piece table — 20 bytes per piece, starting at offset 32

| Offset | Type | Field |
|---|---|---|
| 0 | u32 | chart index into `catalog.charts` (the Cao 2017 source record) |
| 4 | u16 | binding index into `catalog.bindings` (plate and palette entries) |
| 6 | u16 | evidence index into `catalog.evidence` |
| 8 | f32 | lifecycle youngest age, Ma — **exclusive** |
| 12 | f32 | lifecycle oldest age, Ma — inclusive |
| 16 | u16 | flags (below) |
| 18 | u16 | ring count |

The lifecycle is the source record's own `(TOAGE, FROMAGE]`, not the interval's.
An off-schedule record appears in every canonical interval it overlaps and keeps
its own lifecycle, so the runtime must test the piece, not the file, before
drawing it at a requested age.

Ring records are consumed in order: piece *n* owns the next `ringCount` entries
after the pieces before it.

### Flags

| Bit | Meaning |
|---|---|
| 1 | frame conflict: more than 250 km from the piece's own `PLATEID1` position at the interval mid-age |
| 2 | bound by the source `PLATEID1` override rather than by the owner partition |
| 4 | bound to a North Sea restoration palette entry |
| 8 | the source record is off the published 24-interval schedule |
| 16 | inside a protected basin window; never simplified |
| 32 | retained unsimplified because simplification would have lost or distorted a component |

Bits 1, 2, 4 and 8 each add a limitation line, given verbatim in
`catalog.flagLimitations`, to whatever the piece's evidence record already says.

### Ring table — 8 bytes per ring

| Offset | Type | Field |
|---|---|---|
| 0 | u32 | first vertex index |
| 4 | u32 | vertex count in bits 0–30; bit 31 set marks an interior ring (hole) |

A ring's vertices are not repeated to close it: the last vertex connects back to
the first. A hole belongs to the most recent exterior ring in the same piece.

### Vertices — 4 bytes each

Two `int16` values per vertex, longitude then latitude, in present-day WGS84
reference coordinates at `geometryReferenceAgeMa` 0:

```
lon = value / 32767 * 180      lat = value / 32767 * 90
```

The grid step is 0.005493° of longitude and 0.002747° of latitude, so the
worst-case quantisation error is ±0.002747° in longitude (±306 m at the
equator, less towards the poles) and ±0.001373° in latitude (±153 m
everywhere). That is an order of magnitude below the 0.02° baseline
simplification tolerance, so node reduction, not quantisation, sets the
geometric error of a piece of any size. The exception is measured and recorded:
a piece near the 25 km² cookie-cut floor is only a few grid cells across, and
quantisation alone can move its area by tens of percent. The
`areaErrorBySize` table in `dev-docs/bench/results/palaeo-coastlines-qc.json`
says how small a piece has to be before that dominates.

Values are clamped to ±32767, so the antimeridian and the poles are
representable; rings never cross the antimeridian, because every ring is cut by
the static partitions after the two wide partition polygons are split there.

### Seams between neighbouring pieces

Every piece has exactly one owner: the cookie-cut subtracts each partition from
what is left before the next one claims it, and the measured cut-to-source area
ratio is 100.0000 % for all three classes (the audit measured 100.455 % for `lm`
when overlapping partitions were allowed to claim the same ground twice). What
survives on the wire is the shared boundary drawn twice — once for each
neighbour. The `original` payload rounds both copies onto the int16 grid and the
`simplified` payload approximates each of them separately, so two pieces of the
same source record can overlap in a hairline sliver. Measured across all three
classes and all 24 intervals, the widest such sliver is 0.20 km in the
`original` payloads and 1.82 km in the `simplified` ones. A renderer that draws
both neighbours opaquely will not see it; one that blends them may show a seam
of that width.

## Class catalog

`palaeo-<class>-catalog.json` is columnar: the payloads carry indices, the
catalog carries the data they point at.

- `charts[]` — one entry per compiled Cao 2017 record: source record index,
  `PLATEID1`, `FROMAGE`/`TOAGE`, feature id, whether the record is off the
  published schedule, and the basin operation that created it if it is an edit.
- `bindings[]` — one entry per distinct motion binding: the binding plate, the
  owner partition plate, whether the binding came from the partition or from the
  `PLATEID1` override, and the gap-free list of palette entries with their
  validity windows.
- `evidence[]` — interned evidence records: status, surface class, appearance,
  method, `sourceIds`, `limitations`, and the `editorial` line when a basin edit
  contributed.
- `intervals[]` — per interval: source record count, areas, the simplification
  area error, lost pieces, and for both payload sets the file name, byte count,
  sha256, piece/ring/vertex counts. `reservation` carries the renderer's numbers:
  vertices, base triangles and the estimated triangle count after 1° refinement.
- `areaAudit`, `poseAudit`, `simplification`, `basinEdits`, `inputs`,
  `partitions`, `rotationCheck` — the measurements the validator re-derives.

The triangle estimate reproduces the emitter's own longest-edge bisection
(`scripts/research/project_cao_triangle_refinement.py`) from the three edge
lengths of each base triangle; `palaeo_coastlines_compile.py --verify-refinement`
measures the agreement, and the 24 sampled triangles matched exactly. The base
triangulation is a Delaunay triangulation of the ring vertices with the
triangles outside the piece removed: it is an estimate of the runtime's
ear-clipping output, not a reproduction of it, and it is used only to size a
reservation.

## Outline tone tables — `outline-tones.ehpt`

Little-endian. A 32-byte header:

| Offset | Type | Field |
|---|---|---|
| 0 | 4 bytes | magic `EHPT` |
| 4 | u16 | version, `1` |
| 6 | u16 | header bytes, `32` |
| 8 | u32 | table count (24 canonical intervals) |
| 12 | u32 | segment count (12,045 country-reference segments) |
| 16 | u32 | bytes per table, `ceil(segmentCount / 4)` = 3,012 |
| 20 | 12 bytes | reserved, zero |

Then `tableCount × bytesPerTable` bytes. Tables run oldest to youngest, the same
order as `intervals[]` in `outline-tones.json`. Segment *i* lives in byte
`i >> 2` at bit offset `(i & 3) * 2`, least-significant pair first:

| Value | Tone |
|---|---|
| 0 | dark ink: the segment midpoint is inside a landmass or mountain piece of the same plate |
| 1 | light over shallow ground: mapped shallow marine of the same plate, or Cao 2024 continental crust of that plate whose depth the model does not state |
| 2 | light over deep or unmapped ground |
| 3 | inactive: the country-reference chart is not active at the interval mid-age |

### Interval index

`outline-tones.json` also carries `intervals[]`, the per-interval file index,
in the same oldest-to-youngest order as the tone tables. Each entry gives
`intervalId`, `tableIndex`, `oldestAgeMa`, `youngestAgeMa`, `midAgeMa`,
`youngestExclusive`, the interval's total `vertices` and `estimatedTriangles`,
and one `classes[<class>]` entry per compiled class with `path` (relative to
the payload directory), `bytes`, `sha256`, `pieces`, `vertices` and
`estimatedTriangles`. The tone payload's own `bytes` and `sha256` are recorded
in `geometryAsset`.

The midpoint of each segment is decoded from `country-reference.ehgl`; the plate
comes from the segment's own country-reference chart. The match is by plate id,
not by static-fragment identity, and the tone is evaluated at the interval
mid-age, so it does not follow an off-schedule record's own lifecycle inside the
interval. A tone is a legibility aid over the palaeo classes and is never
evidence that the modern country existed at that age.

## What the format does not claim

- A map interval records the minimum land and maximum flooding mapped anywhere
  in that bin. It is not a shoreline at one moment, and the interval boundary is
  a change of map, not a dated event.
- `sm` is an environment class, not a water depth. Crust that carries neither
  `lm` nor `sm` keeps the model's own "depth unmapped" meaning; it is never
  drawn as deep marine.
- Every piece is posed by re-attaching a present-day polygon to a present-day
  Cao 2024 partition. It is not the authors' own reconstruction, which used the
  Matthews et al. (2016) rotations; that citation is still required by the
  source package README.
- A piece with the frame-conflict flag is drawn where its partition owner puts
  it while its own `PLATEID1` disagrees by more than 250 km. The flag is the
  disclosure, not a repair.
