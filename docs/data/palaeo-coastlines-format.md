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

| File | Ships | Holds |
|---|---|---|
| `<class>/palaeo-<class>-<intervalId>.ehpr` | yes | one class, one interval: pieces, rings, vertices |
| `<class>/palaeo-<class>-catalog.json` | yes | the class catalog: the tables a piece's indices resolve into |
| `outline-tones.ehpt` | yes | 24 country-outline tone tables, two bits per segment |
| `outline-tones.json` | yes | tone-table catalog and the per-interval file index across classes |
| `provenance/palaeo-<class>-provenance.json` | **no** | source-record provenance and every compile measurement |

`<class>` is `lm` (landmass), `sm` (shallow marine) or `m` (mountain).
`<intervalId>` is the published map interval, `402-380` … `11-2`.

The provenance sidecar stays in the owned offline store
(`EarthHistory-data/palaeomap-study/palaeo-coastlines/`) and never enters a
build. The catalog names it by path, byte count and sha256, so the chain from a
shipped piece back to its Cao 2017 DBF row is pinned even though the browser
never downloads it. `palaeo_coastlines_correction.py` re-verifies that digest;
a sidecar edited without a catalog update is a rejected build, not a drift.

## EHPR v1 layout

All integers and floats are little-endian. The file is four consecutive
sections with no padding between them.

The piece and ring records were compacted on 2026-09-15, before anything
shipped: the piece record went from 20 bytes to 12 and the ring record from 8
bytes to 2. The quantisation, the coordinate reference and the meaning of every
field are unchanged.

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

### Piece table — 12 bytes per piece, starting at offset 32

| Offset | Type | Field |
|---|---|---|
| 0 | u16 | chart index: the ordinal of the Cao 2017 source record this piece was cut from |
| 2 | u16 | binding index into `catalog.bindings` (binding plate, owner partition, kind) |
| 4 | u16 | evidence index into `catalog.evidence` |
| 6 | u16 | lifecycle index into `catalog.lifecycles` |
| 8 | u16 | flags (below) |
| 10 | u16 | ring count |

Every field is a u16 index, and the compiler refuses to write a class whose
`chartCount`, `bindings`, `evidence` or `lifecycles` table has reached 65,536
entries. The validator re-asserts both halves: the table lengths fit the field,
and no emitted index points past its table.

The chart index is the one field the shipped catalog does not carry a table for.
It is the source-record ordinal: `chartIndex` *n* is row *n* of the provenance
sidecar's `charts` table, and `catalog.chartCount` is the only thing that bounds
it. Every piece cut from one Cao 2017 record carries the same value, so the
runtime groups pieces by source record with it (`materialId` is
`palaeo:<class>:<chartIndex>`) without ever reading a feature id, a `PLATEID1`
or a publication date. Those live in the sidecar.

The lifecycle is the source record's own `(TOAGE, FROMAGE]`, not the interval's;
`catalog.lifecycles` holds the distinct `{youngestExclusiveMa, oldestMa}` pairs
(64 for `lm`, 25 for `sm`, 38 for `m`), because the 24 published intervals and the
44 off-schedule pairs are shared by tens of thousands of pieces. An off-schedule
record appears in every canonical interval it overlaps and keeps its own
lifecycle, so the runtime must test the piece, not the file, before drawing it at
a requested age.

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

### Ring table — 2 bytes per ring

| Offset | Type | Field |
|---|---|---|
| 0 | u16 | vertex count in bits 0–14; bit 15 set marks an interior ring (hole) |

The first vertex index is implicit: rings are consumed in order and each one
starts where the previous ring ended, so the decoder carries a running cursor and
the header's vertex count is the sum of every ring's count. The writer refuses a
ring of 32,768 vertices or more; the widest ring measured across all three
classes and both payload tiers is 3,972 vertices, in an `original` payload.

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
everywhere). That is an order of magnitude below the baseline simplification
tolerance (0.02° for `lm` and `m`, 0.05° for `sm`), so node reduction, not
quantisation, sets the geometric error of a piece of any size. The exception is measured and recorded:
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
same source record can overlap in a hairline sliver. Measured across all 24
intervals (`dev-docs/bench/results/palaeo-coastlines-validation.json`), the widest
such sliver in an `original` payload is 0.26 km (`lm` and `sm`) and 0.20 km (`m`);
in a `simplified` payload it is 3.12 km (`lm`), 8.24 km (`sm`, which is reduced at
0.05°) and 1.82 km (`m`). A renderer that draws both neighbours opaquely will not
see it; one that blends them may show a seam of that width.

## Class catalog

`palaeo-<class>-catalog.json` is the document the browser downloads. It carries
exactly what a piece's u16 indices resolve into and nothing else: measured,
**lm 26,796 B, sm 42,849 B, m 24,309 B** (2026-09-15), against 3.72, 6.07 and
2.22 MiB for the first shape of it. Two things did that. Source-record
provenance moved to the offline sidecar, and the motion binding stopped being a
per-piece-window palette chain and became a plate-level row the runtime resolves
at the requested age.

Every table is **columnar**: an object of parallel arrays plus a `count`, not an
array of objects. Repeating a key name once per row, not the values, was what
the first shape spent its megabytes on (7,079 `lm` binding rows of the same six
keys came to 1.7 MiB). A decoder reads row *i* of a table by taking element *i*
of each of its arrays, and must reject a table whose columns disagree with
`count`. The marker is `"encoding": "palaeo-class-catalog-columnar-v1"`; the
document carries none of `packageIntern.ts`'s own markers, so
`expandInternedPackageDocument` passes it through untouched and the columnar
tables are expanded by the palaeo decoder.

### Top level

| Field | Meaning |
|---|---|
| `schemaVersion` | `2` |
| `encoding` | `palaeo-class-catalog-columnar-v1` |
| `catalogId`, `class`, `className`, `appearance` | class identity |
| `format` | `{magic: "EHPR", version: 1, specification}` |
| `paletteId` | the motion palette the binding rows resolve against |
| `lifecycleRule` | `(TOAGE, FROMAGE]`, stated in the document |
| `payloadNameTemplate` | `palaeo-<class>-<intervalId>.ehpr`; a payload url is derived, not listed |
| `maximumEdgeDegrees` | the refinement bound the reservations were sized at, `1` |
| `chartCount` | rows in the sidecar's `charts` table; the bound on a piece's `chartIndex` |
| `provenance` | `{path, bytes, sha256, records, store}` — the offline sidecar |
| `flagLimitations` | verbatim limitation line for flag bits 1, 2, 4 and 8 |
| `entrySelection` | the constants of the binding rule below |
| `bindingKinds` | `["partition", "override", "restoration", "recovery"]` |
| `bindings` | columnar, one row per distinct motion binding |
| `gapSets` | the distinct declared source-seam sets a binding row points at |
| `evidence` | an object array, one row per distinct reference set: the unedited class row plus one per basin-edit reference set |
| `lifecycles` | columnar `{youngestExclusiveMa, oldestMa}` |
| `intervals` | columnar, one row per shipped interval |

`intervals` columns: `intervalId`, `intervalIndex`, `fromAgeMa`, `toAgeMa`,
`midAgeMa`, `bytes`, `sha256`, `pieces`, `rings`, `vertices`, `collapsedRings`,
`baseTriangles`, `estimatedTrianglesAtOneDegree`. The rows run oldest to
youngest and abut within the source's own 10 kyr step: `402-380` ends at
380.01 Ma and `380-359` begins at 380, so a row's `toAgeMa` is the next row's
`fromAgeMa` or exactly 0.01 Ma above it. A wider hole would leave a band of ages
with no map and is rejected. The payload file name is `payloadNameTemplate` with
`<intervalId>` substituted; `bytes` and `sha256` are the digest the loader
verifies. `vertices`, `baseTriangles` and `estimatedTrianglesAtOneDegree` are
the renderer's reservation, `maximumEdgeDegrees` its edge bound. The
unsimplified `original` payload's own record stays in the sidecar: it never
ships.

`evidence[]` rows: `status`, `surfaceClass`, `appearance`, `method`,
`sourceIds`, `limitations`, and `editorial` exactly when a cited basin edit
contributed. The unedited row carries `status: classified-map-polygon`; an
edited row carries `status: derived-from-published-source`, the edit's reference
ids appended to the three published ones, and an `editorial` line
"EarthHistory modification after &lt;refs&gt;". Rows are interned, so two
operations that cite the same references share one row and two that do not get
two. Measured 2026-09-15 with the North Sea contract's eleven operations: lm 6
rows, sm 7 rows.

### Binding rows

`bindings` columns: `bindingPlateId`, `partitionPlateId`, `kind` (an index into
`bindingKinds`), `gapSet` (an index into `gapSets`). Measured row counts:
**lm 589, sm 1,170, m 521** — against 7,079, 10,448 and 3,817 when the row also
carried the palette chain.

- `bindingPlateId` is the plate the piece rides. It is the owner partition's
  plate, except for the tracked `PLATEID1` overrides.
- `partitionPlateId` is the Cao 2024 static partition that owns the ground. The
  runtime uses it for the piece's fragment identity; it is not the motion plate
  when an override applies.
- `kind` names which branch of the selection rule the binding plate falls in.
  `restoration` and `recovery` are properties of the *plate*: they say the
  palette carries entries that displace this plate's native motion. `override`
  and `partition` say where the binding plate came from. The four are exclusive
  in the shipped palette and the compiler refuses to ship a plate that is both,
  because one enum could not then say which branch to take. `kind` is a
  declaration the runtime may cross-check, not an input to the selection: the
  selection is a function of the palette alone.
- `gapSet` points at the declared source seams of the binding plate — the
  discontinuities in the source rotation between its recovery entries. Both ends
  of a seam are exclusive. `gapSets[0]` is always empty.

Note what `kind` is **not**: piece flag bit 4 records that a piece's own window
actually resolved to a restoration entry. A piece on plate 315 whose lifecycle
lies entirely below 130 Ma has `kind` `restoration` and no bit 4, because the
restoration entries do not cover its ages.

### Entry selection — `palaeo-binding-entry-v1`

This is the contract the runtime implements. Given a binding row and a requested
age `t`, the palette entry the piece is posed with is:

1. Let `E` be the motion-palette catalog entries whose `plateId` equals
   `bindingPlateId`. If `E` is empty the piece is **unposable**.
2. An entry *covers* `t` when `youngestAgeMa <= t <= oldestAgeMa`. Coverage is
   closed at both ends. Where two entries of the same preference class meet,
   the one with the larger `youngestAgeMa` wins — that is the entry the chain
   walks into going older, and it is what keeps the oldest age of a lifecycle,
   which is inclusive, posed when nothing starts above it. Ties on that value
   break on `entryId`.
3. **Restoration first.** If any covering entry's id starts with
   `restoration-`, take the winner among those. The two such entries are
   `restoration-north-sea-plate-303-130-600` and
   `restoration-north-sea-plate-315-130-420`, so on partitions 303 and 315 the
   restored UK-block motion carries the piece from 130 Ma to 600 and 420 Ma
   respectively and the native entries carry it below 130 Ma. The palaeo
   schedule stops at 402 Ma, so both windows cover the whole of it above 130 Ma.
   This is explicit because `entries_covering()` in the material-correction
   emitter skips `restoration-` entries: without it a palaeo chart on 315 would
   take native motion and detach ~72 km from its restored shelf at 270 Ma.
4. **Recovery plates never fall back.** If *any* entry of `E` — covering or not —
   has an id starting with `native-recovery-plate-`, then only those entries may
   pose the piece. Take the winner among the covering ones; if none covers `t`,
   the piece is **unposable at `t`**. The eight such plates are 626, 801, 8011,
   8023, 80101, 80102, 80103 and 80104. `apply_cao_native_triangulation_repair`
   rejects any chart on them that keeps a `plate-` binding, so a palaeo piece
   must not keep one either.
5. **Otherwise the native chain.** Among the covering entries, prefer
   `correction-plate-` entries at `t >= 410` Ma and non-correction entries below
   it; take the winner of whichever set is non-empty.

A piece that is unposable at the requested age is not drawn: its support state
is `unsupported`/`missing-motion` and its activation is 0, the same as a chart
whose palette entry is not resident. The distinction matters for the map key —
unposable is a statement about the model, not about what has finished
downloading — but not for the frame.

**Seams.** The only ages inside a lifecycle at which a shipped binding may
resolve to nothing are the open windows its `gapSet` declares: plate 626 at
119.999999–120 Ma and 79.1–79.100001 Ma. Those are the source rotation's own
discontinuities, stepped over and recorded rather than filled with the native
motion the repair emitter rejected. One `lm` and one `sm` piece window crosses a
seam; two do in `m`.

**Gap-free is a validated property, not a shipped one.** Because the chain is
derived, `palaeo_coastlines_correction.py` re-derives it: for every
`(bindingIndex, lifecycleIndex)` pair a shipped piece actually carries — 6,986
for `lm`, 10,456 for `sm`, 3,817 for `m` — it walks the rule across the
intersection of that lifecycle with the interval the piece ships in, and rejects
the build if any age in that window resolves to nothing outside a declared seam,
or if the pointwise rule and the compiler's chain builder disagree entry for
entry. The self-test proves that gate red by rebinding a row to a plate the
palette does not cover.

### Reservations

The triangle estimate reproduces the emitter's own longest-edge bisection
(`scripts/research/project_cao_triangle_refinement.py`) from the three edge
lengths of each base triangle; `palaeo_coastlines_compile.py --verify-refinement`
measures the agreement, and the 24 sampled triangles matched exactly. The base
triangulation is a Delaunay triangulation of the ring vertices with the
triangles outside the piece removed: it is an estimate of the runtime's
ear-clipping output, not a reproduction of it, and it is used only to size a
reservation.

Measured 2026-09-15 against the runtime over all 24 promoted `lm`+`sm`
intervals: the runtime produces **1.63x** the estimate at the median interval and
**2.04x** at the worst, because `palaeoTriangulate.ts` bisects conformingly —
every violating edge of a round is split at once and the split propagates into
neighbours that were already short enough — while this estimate models each
triangle alone. So the package manifest's `reservation` scales the worst
interval's estimate by 2.0 rather than trusting it (457,098 triangles against a
measured worst of 427,088), and `palaeoCoastlineAssets.test.ts` re-measures every
interval against the declared numbers. The estimate is a size class, not a
prediction of the runtime's output.

## Provenance sidecar

`provenance/palaeo-<class>-provenance.json` is the offline half of the split. It
is not a build input and not a download; it is the record that lets any claim on
screen be traced back to a Cao 2017 row, and the validator's own source of every
measurement it re-derives.

- `charts` — columnar, one row per compiled source record, in `chartIndex`
  order: `sourceRecordIndex` (the DBF row), `plateId1`, `fromAgeMa`, `toAgeMa`,
  `featureIdRef`, `offSchedule`, `basinOpId`. `basinOpId` is `null` for an
  untouched Cao record, one operation id for a record a basin edit added or
  changed, and several joined by `+` where more than one operation touched the
  same record. `featureIdRef` indexes the
  `featureIds` string table, because thousands of cut pieces share one GPlates
  feature id; this is the `<field>Ref` convention of
  `scripts/research/cao_package_intern.py`.
- `intervals[]` — the full per-interval measurement: source/cut/emitted/
  unposable/below-floor areas, the area ratio, the simplification error, lost
  and retained pieces and their reasons, and the `original` payload record
  (url, bytes, sha256, pieces, rings, vertices).
- `bindings`, `gapSets`, `evidence`, `lifecycles` — the same tables the catalog
  ships, so the sidecar stands alone.
- `areaAudit`, `poseAudit`, `simplification`, `sourceRecords`, `method`,
  `flags`, `basinEdits`, `basinContracts`, `inputs`, `partitions`,
  `rotationCheck`, `totals`, `generatedBy`, `generatedAt`, `runtime` — the
  compile record.

Measured 2026-09-15: lm 557,524 B, sm 977,914 B, m 387,560 B.

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
| 0 | dark ink: the segment midpoint is inside a piece of a shipped dark class (`lm`, and `m` if a build ever publishes it) on the same plate |
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

`classes` indexes exactly the classes the build publishes, named in
`shippedClasses` at the top level of the same document and passed to the
compiler as `--shipped-classes`. The mountain class is compiled and validated
offline and appears in neither: indexing it here would name a payload url the
package never serves, and its vertex and triangle totals would reserve for
geometry the browser never receives. The same list decides which classes colour
a tone table, so a segment is never inked dark over a class the build withholds.
`promote_palaeo_coastlines.py` refuses to publish staged tables whose
`shippedClasses` disagrees with what it copies. The index remains a compile
record, never a fetch list — the runtime derives a payload url from its own
class catalog's `payloadNameTemplate` and downloads only the classes the package
manifest declares.

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
