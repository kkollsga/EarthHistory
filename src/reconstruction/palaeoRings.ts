/**
 * EHPR v1 — the palaeo-coastline ring payload and its class catalog.
 *
 * The wire format is specified in `docs/data/palaeo-coastlines-format.md` and
 * produced by `scripts/research/palaeo_coastlines_compile.py`. This decoder is
 * the runtime half of that contract: it validates the bytes before any of them
 * reach triangulation, and it reads a piece's own `(TOAGE, FROMAGE]` lifecycle
 * rather than the file's interval, because an off-schedule source record ships
 * in every canonical interval it overlaps and keeps its own dates.
 */

import type { SpatialBatchSurfaceAppearanceV2 } from "./packageV2";

const MAGIC = "EHPR";
const VERSION = 1;
const HEADER_BYTES = 32;
const PIECE_BYTES = 12;
const RING_BYTES = 2;
const HOLE_BIT = 0x8000;
const RING_COUNT_MASK = 0x7fff;
const SHA256 = /^[a-f0-9]{64}$/;

/** int16 grid: `lon = value / 32767 * 180`, `lat = value / 32767 * 90`. */
export const PALAEO_RING_LONGITUDE_SCALE = 32_767 / 180;
export const PALAEO_RING_LATITUDE_SCALE = 32_767 / 90;

/**
 * Every interval the palaeo-coastline mode can publish: the 24 Cao 2017 map
 * intervals `402-380` (index 0) … `11-2` (index 23), plus the detached
 * `lgm` lowstand state at index 24. A detached interval does not abut its
 * neighbour and its catalog has to declare it by id (`detachedIntervalIds`), so
 * a compiler that silently dropped a Cao interval still fails the schedule
 * check.
 */
export const PALAEO_INTERVAL_COUNT = 25;
export const PALAEO_CAO_2017_INTERVAL_COUNT = 24;

/** The oldest age any Cao 2017 record or interval can carry. */
const PALAEO_MAX_AGE_MA = 1_800;

export type PalaeoSurfaceClass = "lm" | "sm" | "m";

export const PALAEO_SURFACE_CLASS_CODES: Readonly<Record<PalaeoSurfaceClass, number>> =
  Object.freeze({ lm: 1, sm: 2, m: 3 });

export const PALAEO_SURFACE_CLASS_NAMES: Readonly<Record<PalaeoSurfaceClass, string>> =
  Object.freeze({ lm: "landmass", sm: "shallow-marine", m: "mountain" });

export const PALAEO_SURFACE_CLASS_APPEARANCES:
Readonly<Record<PalaeoSurfaceClass, SpatialBatchSurfaceAppearanceV2>> =
  Object.freeze({ lm: "palaeo-land", sm: "palaeo-shallow-marine", m: "palaeo-mountain" });

/** Surface evidence class each palaeo surface class maps to; a mountain is still land. */
export const PALAEO_SURFACE_EVIDENCE_CLASSES:
Readonly<Record<PalaeoSurfaceClass, "land" | "shallow-marine">> =
  Object.freeze({ lm: "land", sm: "shallow-marine", m: "land" });

/**
 * Piece flags. Bits 1, 2, 4 and 8 each add the catalog's verbatim limitation
 * line to whatever the piece's evidence record already says; 16 and 32 record
 * why a piece was not simplified and carry no limitation of their own.
 */
export const PALAEO_RING_FLAGS = Object.freeze({
  frameConflict: 1,
  plateIdOverride: 2,
  restorationBound: 4,
  offSchedule: 8,
  protectedWindow: 16,
  retainedUnsimplified: 32,
} as const);

/** Only bits 1, 2, 4 and 8 carry a limitation line the map key must show. */
export const PALAEO_RING_LIMITATION_FLAGS: readonly (1 | 2 | 4 | 8)[] = Object.freeze([1, 2, 4, 8]);

const KNOWN_FLAG_MASK = Object.values(PALAEO_RING_FLAGS).reduce((mask, bit) => mask | bit, 0);

export interface PalaeoRingRecord {
  /** Implicit in the payload: rings consume the vertex table in file order. */
  readonly firstVertex: number;
  readonly vertexCount: number;
  /** An interior ring belongs to the most recent exterior ring in the same piece. */
  readonly hole: boolean;
}

export interface PalaeoPieceRecord {
  readonly chartIndex: number;
  readonly bindingIndex: number;
  readonly evidenceIndex: number;
  /** Index into `catalog.lifecycles`; the piece's own `(TOAGE, FROMAGE]`. */
  readonly lifecycleIndex: number;
  readonly flags: number;
  readonly rings: readonly PalaeoRingRecord[];
  /** Index of this piece's first ring in the file's ring table. */
  readonly firstRing: number;
}

/** Header and piece tables only; survives transferring the payload buffer to a worker. */
export interface PalaeoRingPayloadMetadata {
  readonly surfaceClass: PalaeoSurfaceClass;
  readonly classCode: number;
  readonly intervalIndex: number;
  readonly intervalOldestAgeMa: number;
  readonly intervalYoungestAgeMa: number;
  readonly pieces: readonly PalaeoPieceRecord[];
  readonly ringCount: number;
  readonly vertexCount: number;
  readonly byteLength: number;
}

export interface DecodedPalaeoRingPayload extends PalaeoRingPayloadMetadata {
  /** Two int16 per vertex, longitude then latitude, in the payload's own buffer. */
  readonly vertices: Int16Array;
}

function surfaceClassForCode(code: number): PalaeoSurfaceClass | null {
  for (const [name, value] of Object.entries(PALAEO_SURFACE_CLASS_CODES)) {
    if (value === code) return name as PalaeoSurfaceClass;
  }
  return null;
}

function validAge(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= PALAEO_MAX_AGE_MA;
}

/**
 * Decodes and validates one EHPR v1 payload. Digest verification stays with
 * `assetLoader.loadVerifiedBytes`; everything structural is checked here.
 */
export function decodePalaeoRingPayload(buffer: ArrayBuffer): DecodedPalaeoRingPayload {
  if (buffer.byteLength < HEADER_BYTES) throw new Error("EHPR payload is shorter than its header");
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== MAGIC) {
    throw new Error("not an EHPR palaeo-coastline payload");
  }
  if (view.getUint16(4, true) !== VERSION || view.getUint16(6, true) !== HEADER_BYTES) {
    throw new Error("unsupported EHPR palaeo-coastline version");
  }
  const pieceCount = view.getUint32(8, true);
  const ringCount = view.getUint32(12, true);
  const vertexCount = view.getUint32(16, true);
  const ringOffset = HEADER_BYTES + PIECE_BYTES * pieceCount;
  const vertexOffset = ringOffset + RING_BYTES * ringCount;
  if (vertexOffset + 4 * vertexCount !== buffer.byteLength) {
    throw new Error("EHPR payload length disagrees with its header");
  }
  const classCode = view.getUint16(20, true);
  const surfaceClass = surfaceClassForCode(classCode);
  if (!surfaceClass) throw new Error("unknown EHPR palaeo surface class code");
  const intervalIndex = view.getUint16(22, true);
  if (intervalIndex >= PALAEO_INTERVAL_COUNT) throw new Error("EHPR interval index outside the published schedule");
  const intervalOldestAgeMa = view.getFloat32(24, true);
  const intervalYoungestAgeMa = view.getFloat32(28, true);
  if (!validAge(intervalOldestAgeMa) || !validAge(intervalYoungestAgeMa)
      || intervalOldestAgeMa <= intervalYoungestAgeMa) {
    throw new Error("EHPR interval age bounds are not an ordered non-empty range");
  }
  const pieces: PalaeoPieceRecord[] = [];
  let consumedRings = 0;
  let consumedVertices = 0;
  for (let piece = 0; piece < pieceCount; piece += 1) {
    const offset = HEADER_BYTES + PIECE_BYTES * piece;
    const chartIndex = view.getUint16(offset, true);
    const bindingIndex = view.getUint16(offset + 2, true);
    const evidenceIndex = view.getUint16(offset + 4, true);
    const lifecycleIndex = view.getUint16(offset + 6, true);
    const flags = view.getUint16(offset + 8, true);
    const pieceRingCount = view.getUint16(offset + 10, true);
    if ((flags & ~KNOWN_FLAG_MASK) !== 0) throw new Error("EHPR piece carries an unknown flag bit");
    if (pieceRingCount < 1) throw new Error("EHPR piece has no rings");
    if (consumedRings + pieceRingCount > ringCount) throw new Error("EHPR piece ring table overruns the file");
    const rings: PalaeoRingRecord[] = [];
    for (let ring = 0; ring < pieceRingCount; ring += 1) {
      const packed = view.getUint16(ringOffset + RING_BYTES * (consumedRings + ring), true);
      const ringVertexCount = packed & RING_COUNT_MASK;
      const hole = (packed & HOLE_BIT) !== 0;
      if (ringVertexCount < 3) throw new Error("EHPR ring has fewer than three vertices");
      // The first vertex of a ring is implicit: rings consume the vertex table
      // in file order, so an overrun here is the payload claiming vertices the
      // file does not carry.
      if (consumedVertices + ringVertexCount > vertexCount) {
        throw new Error("EHPR ring runs past the vertex table");
      }
      if (hole && ring === 0) throw new Error("EHPR piece starts with an interior ring");
      rings.push(Object.freeze({ firstVertex: consumedVertices, vertexCount: ringVertexCount, hole }));
      consumedVertices += ringVertexCount;
    }
    pieces.push(Object.freeze({ chartIndex, bindingIndex, evidenceIndex, lifecycleIndex,
      flags, firstRing: consumedRings, rings: Object.freeze(rings) }));
    consumedRings += pieceRingCount;
  }
  if (consumedRings !== ringCount) throw new Error("EHPR ring table has records no piece owns");
  if (consumedVertices !== vertexCount) throw new Error("EHPR vertex table has vertices no ring owns");
  return Object.freeze({
    surfaceClass, classCode, intervalIndex, intervalOldestAgeMa, intervalYoungestAgeMa,
    pieces: Object.freeze(pieces), ringCount, vertexCount,
    vertices: new Int16Array(buffer, vertexOffset, vertexCount * 2),
    byteLength: buffer.byteLength,
  });
}

/** Header and pieces without the vertex view, so the record survives a buffer transfer. */
export function palaeoRingPayloadMetadata(payload: DecodedPalaeoRingPayload): PalaeoRingPayloadMetadata {
  const { vertices: _vertices, ...metadata } = payload;
  return Object.freeze(metadata);
}

/**
 * `(TOAGE, FROMAGE]`: the youngest bound is exclusive and the oldest inclusive,
 * evaluated against the piece's own lifecycle record, never against the
 * interval the payload file covers.
 */
export function palaeoLifecycleActiveAtAge(
  lifecycle: PalaeoCoastlineLifecycleRecord,
  ageMa: number,
): boolean {
  return Number.isFinite(ageMa) && ageMa > lifecycle.youngestExclusiveMa && ageMa <= lifecycle.oldestMa;
}

/** The limitation-bearing flag bits a piece carries, in ascending bit order. */
export function palaeoPieceLimitationFlags(piece: PalaeoPieceRecord): readonly (1 | 2 | 4 | 8)[] {
  return PALAEO_RING_LIMITATION_FLAGS.filter((bit) => (piece.flags & bit) !== 0);
}

export function palaeoVertexLongitude(quantised: number): number {
  return quantised / PALAEO_RING_LONGITUDE_SCALE;
}

export function palaeoVertexLatitude(quantised: number): number {
  return quantised / PALAEO_RING_LATITUDE_SCALE;
}

/** Present-day WGS84 lon/lat to the unit direction the renderer stores. */
export function palaeoLonLatDirection(longitudeDegrees: number, latitudeDegrees: number):
readonly [number, number, number] {
  const longitude = longitudeDegrees * Math.PI / 180;
  const latitude = latitudeDegrees * Math.PI / 180;
  const radius = Math.cos(latitude);
  return [radius * Math.cos(longitude), radius * Math.sin(longitude), Math.sin(latitude)];
}

/** Decodes one payload vertex straight to its reference-frame unit direction. */
export function palaeoVertexDirection(vertices: Int16Array, vertexIndex: number):
readonly [number, number, number] {
  return palaeoLonLatDirection(palaeoVertexLongitude(vertices[vertexIndex * 2]!),
    palaeoVertexLatitude(vertices[vertexIndex * 2 + 1]!));
}

// ---------------------------------------------------------------------------
// class catalog — schemaVersion 2, columnar
// ---------------------------------------------------------------------------

/**
 * Every table in a shipped class catalog is an object of parallel arrays plus a
 * `count`, not an array of objects: repeating six key names once per binding row
 * was what the first shape of this document spent its megabytes on. The runtime
 * expands them once, at catalog load, into the row objects the rest of the
 * module works with.
 */
const CATALOG_SCHEMA_VERSION = 2;
const CATALOG_ENCODING = "palaeo-class-catalog-columnar-v1";
const BINDING_ENTRY_RULE = "palaeo-binding-entry-v1";
const RESTORATION_PREFIX = "restoration-";
const RECOVERY_PREFIX = "native-recovery-plate-";
const CORRECTION_PREFIX = "correction-plate-";

/**
 * The 10 kyr step the Cao 2017 schedule leaves between a map's youngest bound
 * and the next map's oldest bound (`402-380` ends at 380.01 Ma and `380-359`
 * begins at 380). Two maps may abut exactly or be separated by that one step;
 * anything wider is a band of ages with no map at all.
 */
const PALAEO_SCHEDULE_STEP_MA = 0.01;

export interface PalaeoColumnarTable {
  readonly count: number;
  readonly [column: string]: unknown;
}

/** One interned `(TOAGE, FROMAGE]` window; pieces reference it by index. */
export interface PalaeoCoastlineLifecycleRecord {
  /** The source record's own `TOAGE`; a piece is not drawn at this exact age. */
  readonly youngestExclusiveMa: number;
  /** The source record's own `FROMAGE`; inclusive. */
  readonly oldestMa: number;
}

/**
 * A declared discontinuity in the source rotation between a plate's recovery
 * entries. Both ends are exclusive: the seam is the open window the rule
 * resolves to nothing at, and it is disclosed rather than filled with the
 * native motion `apply_cao_native_triangulation_repair` rejected.
 */
export interface PalaeoCoastlineMotionGap {
  readonly youngestMa: number;
  readonly oldestMa: number;
  readonly reason: "source-seam";
}

export type PalaeoCoastlineBindingKind = "partition" | "override" | "restoration" | "recovery";

export interface PalaeoCoastlineBindingRecord {
  /** The plate the piece rides: the owner partition's, or a tracked `PLATEID1` override. */
  readonly bindingPlateId: number;
  /** The Cao 2024 static partition that owns the ground; the piece's fragment identity. */
  readonly partitionPlateId: number;
  /**
   * Which branch of the selection rule the binding plate falls in. It is a
   * declaration the runtime may cross-check, never an input: the selection is a
   * function of the palette alone.
   */
  readonly kind: PalaeoCoastlineBindingKind;
  readonly gapSetIndex: number;
  readonly motionSupportGaps: readonly PalaeoCoastlineMotionGap[];
}

/** The constants of `palaeo-binding-entry-v1`, shipped so the rule is auditable. */
export interface PalaeoCoastlineEntrySelection {
  readonly rule: typeof BINDING_ENTRY_RULE;
  readonly coverage: string;
  readonly tieBreak: string;
  readonly preference: readonly string[];
  readonly correctionPreferenceAgeMa: number;
  readonly restorationEntryIds: readonly string[];
  readonly recoveryPlateIds: readonly number[];
  readonly recoveryFallback: "unposable";
}

export interface PalaeoCoastlineEvidenceRecord {
  readonly status: "classified-map-polygon" | "derived-from-published-source";
  readonly surfaceClass: string;
  readonly appearance: SpatialBatchSurfaceAppearanceV2;
  readonly method: string;
  readonly sourceIds: readonly string[];
  readonly limitations: readonly string[];
  /** Present exactly when a cited basin edit contributed to the piece. */
  readonly editorial?: string;
}

export interface PalaeoCoastlinePayloadRecord {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly pieces: number;
  readonly rings: number;
  readonly vertices: number;
  readonly collapsedRings: number;
}

export interface PalaeoCoastlineIntervalRecord {
  readonly intervalId: string;
  readonly intervalIndex: number;
  readonly fromAgeMa: number;
  readonly toAgeMa: number;
  readonly midAgeMa: number;
  /** The one shipped tier; the unsimplified `original` set stays offline. */
  readonly payload: PalaeoCoastlinePayloadRecord;
  readonly reservation: {
    readonly vertices: number;
    readonly baseTriangles: number;
    readonly estimatedTrianglesAtOneDegree: number;
    readonly maximumEdgeDegrees: number;
  };
}

export interface PalaeoCoastlineClassCatalog {
  readonly schemaVersion: typeof CATALOG_SCHEMA_VERSION;
  readonly encoding: typeof CATALOG_ENCODING;
  readonly catalogId: string;
  readonly class: PalaeoSurfaceClass;
  readonly className: string;
  readonly appearance: SpatialBatchSurfaceAppearanceV2;
  readonly format: { readonly magic: string; readonly version: number };
  readonly paletteId: string;
  /** `palaeo-<class>-<intervalId>.ehpr`; a payload url is derived, never listed. */
  readonly payloadNameTemplate: string;
  /**
   * Interval ids that deliberately do not abut their predecessor. Empty for a
   * catalog that only carries the contiguous Cao 2017 schedule.
   */
  readonly detachedIntervalIds: readonly string[];
  readonly maximumEdgeDegrees: number;
  /**
   * Rows in the offline sidecar's `charts` table: the only bound on a piece's
   * `chartIndex`. The shipped catalog carries no chart table — a piece's source
   * record identity lives in the sidecar — so the runtime groups pieces by
   * source record with the index alone.
   */
  readonly chartCount: number;
  /** Verbatim limitation line for flag bits 1, 2, 4 and 8. */
  readonly flagLimitations: Readonly<Record<string, string>>;
  readonly entrySelection: PalaeoCoastlineEntrySelection;
  readonly bindingKinds: readonly PalaeoCoastlineBindingKind[];
  readonly bindings: readonly PalaeoCoastlineBindingRecord[];
  readonly evidence: readonly PalaeoCoastlineEvidenceRecord[];
  readonly lifecycles: readonly PalaeoCoastlineLifecycleRecord[];
  readonly intervals: readonly PalaeoCoastlineIntervalRecord[];
}

const BINDING_KINDS: readonly PalaeoCoastlineBindingKind[] =
  Object.freeze(["partition", "override", "restoration", "recovery"]);

function expandColumns(table: unknown, columns: readonly string[], label: string): unknown[][] {
  const record = table as PalaeoColumnarTable | undefined;
  const count = record?.count;
  if (!Number.isSafeInteger(count) || (count as number) < 0) {
    throw new Error(`palaeo-coastline ${label} table has no row count`);
  }
  return columns.map((column) => {
    const values = record![column];
    // A column shorter than `count` would silently read `undefined` into a row
    // the payload indices already point at.
    if (!Array.isArray(values) || values.length !== count) {
      throw new Error(`palaeo-coastline ${label} column ${column} disagrees with its row count`);
    }
    return values as unknown[];
  });
}

function expandRows<T>(
  table: unknown,
  columns: readonly string[],
  label: string,
  build: (read: (column: string) => unknown) => T,
): T[] {
  const values = expandColumns(table, columns, label);
  const count = (table as PalaeoColumnarTable).count;
  const rows: T[] = [];
  for (let index = 0; index < count; index += 1) {
    rows.push(build((column) => values[columns.indexOf(column)]![index]));
  }
  return rows;
}

function payloadName(template: string, intervalId: string): string {
  return template.replace("<intervalId>", intervalId);
}

/**
 * Expands one shipped `palaeo-<class>-catalog.json` into the row tables the
 * runtime indexes, then validates it.
 *
 * `expandInternedPackageDocument` passes the document through untouched — it
 * carries none of `packageIntern.ts`'s markers — so this is the only place the
 * columnar shape is understood.
 */
export function decodePalaeoCoastlineClassCatalog(
  document: unknown,
  surfaceClass?: PalaeoSurfaceClass,
): PalaeoCoastlineClassCatalog {
  const raw = document as Record<string, unknown>;
  if (raw?.schemaVersion !== CATALOG_SCHEMA_VERSION || raw.encoding !== CATALOG_ENCODING) {
    throw new Error("unsupported palaeo-coastline class catalog encoding");
  }
  const kinds = Array.isArray(raw.bindingKinds) ? raw.bindingKinds as PalaeoCoastlineBindingKind[] : [];
  if (kinds.length !== BINDING_KINDS.length
      || kinds.some((kind, index) => kind !== BINDING_KINDS[index])) {
    throw new Error("palaeo-coastline catalog declares unknown binding kinds");
  }
  const gapSets = raw.gapSets;
  if (!Array.isArray(gapSets) || gapSets.length === 0
      || !Array.isArray(gapSets[0]) || gapSets[0].length !== 0) {
    // `gapSets[0]` is always the empty set, so a binding that declares no seam
    // costs one integer rather than an array.
    throw new Error("palaeo-coastline catalog gap sets are missing their empty set");
  }
  const bindings = expandRows(raw.bindings,
    ["bindingPlateId", "partitionPlateId", "kind", "gapSet"], "binding", (read) => {
      const gapSetIndex = read("gapSet") as number;
      const kindIndex = read("kind") as number;
      if (!Number.isSafeInteger(gapSetIndex) || gapSetIndex < 0 || gapSetIndex >= gapSets.length
          || !Number.isSafeInteger(kindIndex) || kindIndex < 0 || kindIndex >= kinds.length) {
        throw new Error("palaeo-coastline binding row points outside its own tables");
      }
      const gaps = (gapSets[gapSetIndex] as PalaeoCoastlineMotionGap[]).map((gap) => {
        if (!validAge(gap?.youngestMa) || !validAge(gap.oldestMa) || gap.oldestMa <= gap.youngestMa
            || gap.reason !== "source-seam") {
          throw new Error("palaeo-coastline binding declares an invalid source seam");
        }
        return Object.freeze({ youngestMa: gap.youngestMa, oldestMa: gap.oldestMa,
          reason: "source-seam" as const });
      });
      return Object.freeze({
        bindingPlateId: read("bindingPlateId") as number,
        partitionPlateId: read("partitionPlateId") as number,
        kind: kinds[kindIndex]!,
        gapSetIndex,
        motionSupportGaps: Object.freeze(gaps),
      });
    });
  const lifecycles = expandRows(raw.lifecycles, ["youngestExclusiveMa", "oldestMa"],
    "lifecycle", (read) => Object.freeze({
      youngestExclusiveMa: read("youngestExclusiveMa") as number,
      oldestMa: read("oldestMa") as number,
    }));
  const template = raw.payloadNameTemplate;
  if (typeof template !== "string" || !template.includes("<intervalId>")) {
    throw new Error("palaeo-coastline catalog has no payload name template");
  }
  const maximumEdgeDegrees = raw.maximumEdgeDegrees as number;
  const intervals = expandRows(raw.intervals,
    ["intervalId", "intervalIndex", "fromAgeMa", "toAgeMa", "midAgeMa", "bytes", "sha256",
      "pieces", "rings", "vertices", "collapsedRings", "baseTriangles",
      "estimatedTrianglesAtOneDegree"], "interval", (read) => {
      const intervalId = read("intervalId") as string;
      const vertices = read("vertices") as number;
      return Object.freeze({
        intervalId,
        intervalIndex: read("intervalIndex") as number,
        fromAgeMa: read("fromAgeMa") as number,
        toAgeMa: read("toAgeMa") as number,
        midAgeMa: read("midAgeMa") as number,
        payload: Object.freeze({
          url: payloadName(template, intervalId),
          bytes: read("bytes") as number,
          sha256: read("sha256") as string,
          pieces: read("pieces") as number,
          rings: read("rings") as number,
          vertices,
          collapsedRings: read("collapsedRings") as number,
        }),
        reservation: Object.freeze({
          vertices,
          baseTriangles: read("baseTriangles") as number,
          estimatedTrianglesAtOneDegree: read("estimatedTrianglesAtOneDegree") as number,
          maximumEdgeDegrees,
        }),
      });
    });
  const catalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    encoding: CATALOG_ENCODING,
    catalogId: raw.catalogId as string,
    class: raw.class as PalaeoSurfaceClass,
    className: raw.className as string,
    appearance: raw.appearance as SpatialBatchSurfaceAppearanceV2,
    format: raw.format as PalaeoCoastlineClassCatalog["format"],
    paletteId: raw.paletteId as string,
    payloadNameTemplate: template,
    detachedIntervalIds: Object.freeze(Array.isArray(raw.detachedIntervalIds)
      ? [...raw.detachedIntervalIds as string[]] : []),
    maximumEdgeDegrees,
    chartCount: raw.chartCount as number,
    flagLimitations: raw.flagLimitations as Record<string, string>,
    entrySelection: raw.entrySelection as PalaeoCoastlineEntrySelection,
    bindingKinds: Object.freeze(kinds),
    bindings: Object.freeze(bindings),
    evidence: raw.evidence as PalaeoCoastlineEvidenceRecord[],
    lifecycles: Object.freeze(lifecycles),
    intervals: Object.freeze(intervals),
  } as PalaeoCoastlineClassCatalog;
  validatePalaeoCoastlineClassCatalog(catalog, surfaceClass);
  return catalog;
}

function payloadRecordValid(record: PalaeoCoastlinePayloadRecord): boolean {
  return typeof record?.url === "string" && record.url.length > 0
    && !record.url.includes("/") && !record.url.includes("\\") && !record.url.startsWith(".")
    && Number.isSafeInteger(record.bytes) && record.bytes > 0 && SHA256.test(record.sha256)
    && Number.isSafeInteger(record.pieces) && record.pieces >= 0
    && Number.isSafeInteger(record.rings) && record.rings >= record.pieces
    && Number.isSafeInteger(record.vertices) && record.vertices >= 3 * record.rings
    && Number.isSafeInteger(record.collapsedRings) && record.collapsedRings >= 0;
}

/**
 * Validates one expanded class catalog. The payloads carry indices; this is the
 * table they point at, so a catalog that fails here would let a piece draw with
 * someone else's evidence, binding or lifecycle.
 */
export function validatePalaeoCoastlineClassCatalog(
  catalog: PalaeoCoastlineClassCatalog,
  surfaceClass?: PalaeoSurfaceClass,
): void {
  if (catalog?.schemaVersion !== CATALOG_SCHEMA_VERSION || catalog.encoding !== CATALOG_ENCODING
      || !catalog.catalogId || !(catalog.class in PALAEO_SURFACE_CLASS_CODES)
      || (surfaceClass !== undefined && catalog.class !== surfaceClass)
      || catalog.className !== PALAEO_SURFACE_CLASS_NAMES[catalog.class]
      || catalog.appearance !== PALAEO_SURFACE_CLASS_APPEARANCES[catalog.class]
      || catalog.format?.magic !== MAGIC || catalog.format.version !== VERSION
      || !catalog.paletteId
      || !Number.isSafeInteger(catalog.chartCount) || catalog.chartCount <= 0
      || catalog.chartCount > 0x1_0000
      || !(catalog.maximumEdgeDegrees > 0) || catalog.maximumEdgeDegrees > 1) {
    throw new Error("invalid palaeo-coastline class catalog identity");
  }
  const selection = catalog.entrySelection;
  if (selection?.rule !== BINDING_ENTRY_RULE || selection.recoveryFallback !== "unposable"
      || !Number.isFinite(selection.correctionPreferenceAgeMa)
      || !Array.isArray(selection.restorationEntryIds)
      || !Array.isArray(selection.recoveryPlateIds)
      || selection.recoveryPlateIds.some((plateId: number) => !Number.isInteger(plateId))
      || !Array.isArray(selection.preference)
      || selection.preference[0] !== RESTORATION_PREFIX
      || selection.preference[1] !== RECOVERY_PREFIX) {
    throw new Error("palaeo-coastline catalog does not declare palaeo-binding-entry-v1");
  }
  for (const bit of PALAEO_RING_LIMITATION_FLAGS) {
    const line = catalog.flagLimitations?.[String(bit)];
    if (typeof line !== "string" || line.length === 0) {
      throw new Error("palaeo-coastline catalog is missing a flag limitation line");
    }
  }
  if (!Array.isArray(catalog.bindings) || catalog.bindings.length === 0
      || !Array.isArray(catalog.evidence) || catalog.evidence.length === 0
      || !Array.isArray(catalog.lifecycles) || catalog.lifecycles.length === 0
      || !Array.isArray(catalog.intervals) || catalog.intervals.length === 0
      || catalog.intervals.length > PALAEO_INTERVAL_COUNT
      || catalog.bindings.length > 0x1_0000
      || catalog.evidence.length > 0x1_0000 || catalog.lifecycles.length > 0x1_0000) {
    throw new Error("palaeo-coastline catalog table is empty or exceeds its index width");
  }
  for (const lifecycle of catalog.lifecycles) {
    // A reversed or zero-length `(TOAGE, FROMAGE]` can never be active; the
    // audit quarantines those source records rather than shipping a piece that
    // would be drawn at no age at all.
    if (!validAge(lifecycle?.youngestExclusiveMa) || !validAge(lifecycle.oldestMa)
        || lifecycle.oldestMa <= lifecycle.youngestExclusiveMa) {
      throw new Error("palaeo-coastline lifecycle record is reversed or empty");
    }
  }
  for (const binding of catalog.bindings) {
    if (!Number.isInteger(binding.bindingPlateId) || !Number.isInteger(binding.partitionPlateId)
        || !BINDING_KINDS.includes(binding.kind)
        || !Array.isArray(binding.motionSupportGaps)) {
      throw new Error("invalid palaeo-coastline motion binding record");
    }
  }
  for (const evidence of catalog.evidence) {
    if (!["classified-map-polygon", "derived-from-published-source"].includes(evidence.status)
        || evidence.surfaceClass !== PALAEO_SURFACE_CLASS_NAMES[catalog.class]
        || evidence.appearance !== catalog.appearance || !evidence.method
        || !Array.isArray(evidence.sourceIds) || evidence.sourceIds.length === 0
        || evidence.sourceIds.some((sourceId: string) => typeof sourceId !== "string" || sourceId.length === 0)
        || !Array.isArray(evidence.limitations) || evidence.limitations.length === 0
        || (evidence.status === "derived-from-published-source") !== (typeof evidence.editorial === "string")) {
      throw new Error("invalid palaeo-coastline evidence record");
    }
  }
  const detached = new Set(catalog.detachedIntervalIds);
  if (detached.size !== catalog.detachedIntervalIds.length
      || catalog.detachedIntervalIds.some((id) => typeof id !== "string" || id.length === 0)) {
    throw new Error("palaeo-coastline catalog declares an invalid detached interval id");
  }
  let previousIndex = -1;
  for (const [order, interval] of catalog.intervals.entries()) {
    const reservation = interval.reservation;
    if (!interval.intervalId || !Number.isSafeInteger(interval.intervalIndex)
        || interval.intervalIndex <= previousIndex || interval.intervalIndex >= PALAEO_INTERVAL_COUNT
        || !validAge(interval.fromAgeMa) || !validAge(interval.toAgeMa)
        || interval.fromAgeMa <= interval.toAgeMa
        || !(interval.midAgeMa > interval.toAgeMa && interval.midAgeMa < interval.fromAgeMa)
        || !payloadRecordValid(interval.payload)
        || !interval.payload.url.includes(interval.intervalId)
        || reservation?.vertices !== interval.payload.vertices
        || !Number.isSafeInteger(reservation.baseTriangles) || reservation.baseTriangles < 0
        || !Number.isSafeInteger(reservation.estimatedTrianglesAtOneDegree)
        || reservation.estimatedTrianglesAtOneDegree < reservation.baseTriangles
        || !(reservation.maximumEdgeDegrees > 0) || reservation.maximumEdgeDegrees > 1) {
      throw new Error("invalid palaeo-coastline interval record");
    }
    const previous = catalog.intervals[order - 1];
    // Intervals run oldest to youngest and abut within the source's own 10 kyr
    // step; a catalog that skips a boundary would leave a band of ages with no
    // map, and one that overlaps would put two maps on the same age.
    const step = previous ? previous.toAgeMa - interval.fromAgeMa : 0;
    // A declared detached interval is the one gap the contract intends; every
    // other gap is a dropped interval and still fails here.
    if (previous && previous.intervalIndex + 1 === interval.intervalIndex
        && !detached.has(interval.intervalId)
        && (step < 0 || step > PALAEO_SCHEDULE_STEP_MA + 1e-6)) {
      throw new Error("palaeo-coastline intervals are not contiguous");
    }
    previousIndex = interval.intervalIndex;
  }
  for (const intervalId of detached) {
    if (!catalog.intervals.some((interval) => interval.intervalId === intervalId)) {
      throw new Error("palaeo-coastline catalog declares a detached interval it does not publish");
    }
  }
}

/**
 * Cross-checks a decoded payload against the catalog record that indexes it.
 * The payload's own header is self-consistent by construction; this is what
 * proves it is the interval and class the catalog promised, and that every
 * chart, binding, evidence and lifecycle index it carries resolves.
 */
export function validatePalaeoRingPayloadAgainstCatalog(
  payload: PalaeoRingPayloadMetadata,
  catalog: PalaeoCoastlineClassCatalog,
  interval: PalaeoCoastlineIntervalRecord,
): void {
  if (payload.surfaceClass !== catalog.class || payload.intervalIndex !== interval.intervalIndex
      || Math.fround(interval.fromAgeMa) !== payload.intervalOldestAgeMa
      || Math.fround(interval.toAgeMa) !== payload.intervalYoungestAgeMa) {
    throw new Error("palaeo-coastline payload is not the interval its catalog declares");
  }
  if (payload.pieces.length !== interval.payload.pieces
      || payload.ringCount !== interval.payload.rings
      || payload.vertexCount !== interval.payload.vertices) {
    throw new Error("palaeo-coastline payload counts disagree with the catalog");
  }
  for (const piece of payload.pieces) {
    // `chartIndex` is the sidecar's source-record ordinal, so `chartCount` is
    // the only table that bounds it; the other three resolve into shipped rows.
    if (piece.chartIndex >= catalog.chartCount || piece.bindingIndex >= catalog.bindings.length
        || piece.evidenceIndex >= catalog.evidence.length
        || piece.lifecycleIndex >= catalog.lifecycles.length) {
      throw new Error("palaeo-coastline piece references a catalog record that does not exist");
    }
    const lifecycle = catalog.lifecycles[piece.lifecycleIndex]!;
    // A payload only ships pieces its own interval overlaps; a piece outside it
    // could never be drawn from this file and would hide a compiler defect.
    if (lifecycle.youngestExclusiveMa >= payload.intervalOldestAgeMa
        || payload.intervalYoungestAgeMa >= lifecycle.oldestMa) {
      throw new Error("palaeo-coastline piece lifecycle does not overlap its own interval");
    }
  }
}

// ---------------------------------------------------------------------------
// palaeo-binding-entry-v1
// ---------------------------------------------------------------------------

/** The palette fields the selection rule reads; `PreparedPaletteEntry` satisfies it. */
export interface PalaeoSelectablePaletteEntry {
  readonly entryId: string;
  readonly plateId: number;
  readonly youngestAgeMa: number;
  readonly oldestAgeMa: number;
}

/** Palette entries grouped by the plate they pose, the index the rule starts from. */
export function indexPalaeoPaletteEntriesByPlate<T extends PalaeoSelectablePaletteEntry>(
  entries: Iterable<T>,
): ReadonlyMap<number, readonly T[]> {
  const byPlate = new Map<number, T[]>();
  for (const entry of entries) {
    const bucket = byPlate.get(entry.plateId);
    if (bucket) bucket.push(entry); else byPlate.set(entry.plateId, [entry]);
  }
  return byPlate;
}

function newestEntry<T extends PalaeoSelectablePaletteEntry>(candidates: readonly T[]): T {
  return candidates.reduce((best, entry) =>
    entry.youngestAgeMa > best.youngestAgeMa
      || (entry.youngestAgeMa === best.youngestAgeMa && entry.entryId > best.entryId)
      ? entry : best);
}

/**
 * `palaeo-binding-entry-v1`, stated normatively in
 * `docs/data/palaeo-coastlines-format.md` and implemented identically by
 * `select_palette_entry` in the offline compiler. The validator walks both over
 * every `(binding, lifecycle)` pair a shipped piece carries and rejects a build
 * whose answers differ.
 *
 * `recoveryPlateIds` is read from the catalog rather than rediscovered from the
 * entries: a requested-age motion tile holds only part of the palette, and a
 * plate whose recovery entry is simply not resident must still refuse to fall
 * back to a native entry that happens to be.
 */
export function selectPalaeoBindingEntry<T extends PalaeoSelectablePaletteEntry>(
  entriesForPlate: readonly T[],
  selection: PalaeoCoastlineEntrySelection,
  bindingPlateId: number,
  ageMa: number,
): T | null {
  if (entriesForPlate.length === 0 || !Number.isFinite(ageMa)) return null;
  const covering = entriesForPlate.filter((entry) =>
    entry.youngestAgeMa <= ageMa && ageMa <= entry.oldestAgeMa);
  const restoration = covering.filter((entry) => entry.entryId.startsWith(RESTORATION_PREFIX));
  if (restoration.length > 0) return newestEntry(restoration);
  if (selection.recoveryPlateIds.includes(bindingPlateId)) {
    const recovery = covering.filter((entry) => entry.entryId.startsWith(RECOVERY_PREFIX));
    return recovery.length > 0 ? newestEntry(recovery) : null;
  }
  if (covering.length === 0) return null;
  const corrections = covering.filter((entry) => entry.entryId.startsWith(CORRECTION_PREFIX));
  const natives = covering.filter((entry) => !entry.entryId.startsWith(CORRECTION_PREFIX));
  const matches = ageMa >= selection.correctionPreferenceAgeMa && corrections.length > 0
    ? corrections : natives.length > 0 ? natives : covering;
  return newestEntry(matches);
}

/**
 * Whether an age falls in one of the binding's declared source seams. Both ends
 * are exclusive, so a piece is still posed exactly at a seam bound.
 */
export function palaeoBindingSeamCoversAge(
  binding: PalaeoCoastlineBindingRecord,
  ageMa: number,
): boolean {
  return binding.motionSupportGaps.some((gap) => ageMa > gap.youngestMa && ageMa < gap.oldestMa);
}

/**
 * The source's own `(TOAGE, FROMAGE]` lifecycle rule, and the single authority
 * for it: a piece, a shipped interval payload and the transcribed
 * `CAO_2017_MAP_INTERVALS` table are all half-open the same way, so the catalog
 * a build ships and the table the UI labels intervals from cannot disagree
 * about which map covers an age.
 */
export function palaeoIntervalCoversAge(
  ageMa: number,
  oldestMa: number,
  youngestExclusiveMa: number,
): boolean {
  return Number.isFinite(ageMa) && ageMa > youngestExclusiveMa && ageMa <= oldestMa;
}

/**
 * The 0.01 Ma an interval's exclusive young bound sits above its neighbour's
 * inclusive old bound.
 *
 * The published schedule is contiguous in intent - `29-20` is followed by
 * `20-11` - but the exclusive bound is written as `20.01` while the next
 * interval's oldest age is `20`, so the ages in `(20, 20.01]` are covered by
 * neither. Measured 2026-09-15 at exactly 20 Ma, where the slider's own
 * round-trip lands a hair above 20: the age domain said the layer was inside the
 * Cao band, no interval was selected, nothing was ever published, and the mode
 * latched at `loading` with the globe drawn as if the layer were off - for the
 * rest of the session, because only an age change wakes the pump. The seam is
 * one part in two thousand of the interval it belongs to, so an age inside it
 * takes the older interval whose padding created it rather than no map at all.
 */
export const PALAEO_INTERVAL_BOUND_PADDING_MA = 0.01;

/**
 * True where `ageMa` falls in the seam between two *adjacent* published
 * intervals: above the younger one's inclusive oldest age and at or below the
 * older one's exclusive youngest age, with no more than the padding between
 * them.
 *
 * The width test is what keeps this from swallowing a real gap. The detached
 * LGM state sits 1.98 Myr below the Cao band's youngest bound, and that gap is
 * a statement - there is no map there - not an arithmetic seam.
 */
export function palaeoIntervalSeamCoversAge(
  ageMa: number,
  olderYoungestExclusiveMa: number,
  youngerOldestMa: number,
): boolean {
  return Number.isFinite(ageMa)
    && olderYoungestExclusiveMa > youngerOldestMa
    // The bounds are decimal literals, so the subtraction lands a few ulps either
    // side of the padding; 1e-6 Ma is a thousand years, far below anything the
    // schedule distinguishes.
    && olderYoungestExclusiveMa - youngerOldestMa <= PALAEO_INTERVAL_BOUND_PADDING_MA + 1e-6
    && ageMa > youngerOldestMa
    && ageMa <= olderYoungestExclusiveMa;
}

/** The published interval covering an age, using the same `(TOAGE, FROMAGE]` rule as a piece. */
export function selectPalaeoCatalogInterval(
  catalog: PalaeoCoastlineClassCatalog,
  ageMa: number,
): PalaeoCoastlineIntervalRecord | null {
  const covering = catalog.intervals.find((interval) =>
    palaeoIntervalCoversAge(ageMa, interval.fromAgeMa, interval.toAgeMa));
  if (covering) return covering;
  // No interval covers an age in the 0.01 Ma seam between two adjacent ones, and
  // a seam must not leave the layer with no map to draw.
  for (let index = 0; index + 1 < catalog.intervals.length; index += 1) {
    const older = catalog.intervals[index]!;
    if (palaeoIntervalSeamCoversAge(ageMa, older.toAgeMa,
      catalog.intervals[index + 1]!.fromAgeMa)) return older;
  }
  return null;
}
