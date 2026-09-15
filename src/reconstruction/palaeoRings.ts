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
const RING_BYTES = 4;
const HOLE_BIT = 0x8000_0000;
const RING_COUNT_MASK = 0x7fff_ffff;
const SHA256 = /^[a-f0-9]{64}$/;

/** int16 grid: `lon = value / 32767 * 180`, `lat = value / 32767 * 90`. */
export const PALAEO_RING_LONGITUDE_SCALE = 32_767 / 180;
export const PALAEO_RING_LATITUDE_SCALE = 32_767 / 90;

/** The 24 published Cao 2017 map intervals, `402-380` (index 0) … `11-2` (index 23). */
export const PALAEO_INTERVAL_COUNT = 24;

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
      const packed = view.getUint32(ringOffset + RING_BYTES * (consumedRings + ring), true);
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
// class catalog
// ---------------------------------------------------------------------------

/** One interned `(TOAGE, FROMAGE]` window; pieces reference it by index. */
export interface PalaeoCoastlineLifecycleRecord {
  /** The source record's own `TOAGE`; a piece is not drawn at this exact age. */
  readonly youngestExclusiveMa: number;
  /** The source record's own `FROMAGE`; inclusive. */
  readonly oldestMa: number;
}

export interface PalaeoCoastlineChartRecord {
  readonly sourceRecordIndex: number;
  readonly plateId1: number | null;
  readonly fromAgeMa: number;
  readonly toAgeMa: number;
  readonly featureId: string | null;
  readonly offSchedule: boolean;
  readonly basinOpId?: string | null;
}

export interface PalaeoCoastlineBindingEntry {
  readonly entryId: string;
  readonly validTimeMa: { readonly youngest: number; readonly oldest: number };
}

export interface PalaeoCoastlineBindingRecord {
  readonly paletteId: string;
  readonly bindingPlateId: number;
  readonly partitionPlateId: number;
  readonly bindingSource: "owner-partition" | "source-plateid1-override";
  /** Gap-free, oldest-to-youngest coverage of the binding plate's motion. */
  readonly entries: readonly PalaeoCoastlineBindingEntry[];
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
  readonly collapsedRings?: number;
}

export interface PalaeoCoastlineIntervalRecord {
  readonly intervalId: string;
  readonly intervalIndex: number;
  readonly fromAgeMa: number;
  readonly toAgeMa: number;
  readonly midAgeMa: number;
  readonly simplified: PalaeoCoastlinePayloadRecord;
  /** The unsimplified set stays in the offline store and never ships. */
  readonly original?: PalaeoCoastlinePayloadRecord;
  readonly reservation: {
    readonly vertices: number;
    readonly baseTriangles: number;
    readonly estimatedTrianglesAtOneDegree: number;
    readonly maximumEdgeDegrees: number;
  };
}

export interface PalaeoCoastlineClassCatalog {
  readonly schemaVersion: 1;
  readonly catalogId: string;
  readonly class: PalaeoSurfaceClass;
  readonly className: string;
  readonly appearance: SpatialBatchSurfaceAppearanceV2;
  readonly format: { readonly magic: string; readonly version: number };
  /** Verbatim limitation line for flag bits 1, 2, 4 and 8. */
  readonly flagLimitations: Readonly<Record<string, string>>;
  readonly charts: readonly PalaeoCoastlineChartRecord[];
  readonly bindings: readonly PalaeoCoastlineBindingRecord[];
  readonly evidence: readonly PalaeoCoastlineEvidenceRecord[];
  readonly lifecycles: readonly PalaeoCoastlineLifecycleRecord[];
  readonly intervals: readonly PalaeoCoastlineIntervalRecord[];
}

function payloadRecordValid(record: PalaeoCoastlinePayloadRecord): boolean {
  return typeof record?.url === "string" && record.url.length > 0
    && !record.url.includes("/") && !record.url.includes("\\") && !record.url.startsWith(".")
    && Number.isSafeInteger(record.bytes) && record.bytes > 0 && SHA256.test(record.sha256)
    && Number.isSafeInteger(record.pieces) && record.pieces >= 0
    && Number.isSafeInteger(record.rings) && record.rings >= record.pieces
    && Number.isSafeInteger(record.vertices) && record.vertices >= 3 * record.rings;
}

/**
 * Validates one `palaeo-<class>-catalog.json`. The payloads carry indices; this
 * is the table they point at, so a catalog that fails here would let a piece
 * draw with someone else's evidence, binding or source record.
 */
export function validatePalaeoCoastlineClassCatalog(
  catalog: PalaeoCoastlineClassCatalog,
  surfaceClass?: PalaeoSurfaceClass,
): void {
  if (catalog?.schemaVersion !== 1 || !catalog.catalogId
      || !(catalog.class in PALAEO_SURFACE_CLASS_CODES)
      || (surfaceClass !== undefined && catalog.class !== surfaceClass)
      || catalog.className !== PALAEO_SURFACE_CLASS_NAMES[catalog.class]
      || catalog.appearance !== PALAEO_SURFACE_CLASS_APPEARANCES[catalog.class]
      || catalog.format?.magic !== MAGIC || catalog.format.version !== VERSION) {
    throw new Error("invalid palaeo-coastline class catalog identity");
  }
  for (const bit of PALAEO_RING_LIMITATION_FLAGS) {
    const line = catalog.flagLimitations?.[String(bit)];
    if (typeof line !== "string" || line.length === 0) {
      throw new Error("palaeo-coastline catalog is missing a flag limitation line");
    }
  }
  if (!Array.isArray(catalog.charts) || catalog.charts.length === 0
      || !Array.isArray(catalog.bindings) || catalog.bindings.length === 0
      || !Array.isArray(catalog.evidence) || catalog.evidence.length === 0
      || !Array.isArray(catalog.lifecycles) || catalog.lifecycles.length === 0
      || !Array.isArray(catalog.intervals) || catalog.intervals.length === 0
      || catalog.intervals.length > PALAEO_INTERVAL_COUNT
      || catalog.charts.length > 0x1_0000 || catalog.bindings.length > 0x1_0000
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
  for (const chart of catalog.charts) {
    if (!Number.isSafeInteger(chart.sourceRecordIndex) || chart.sourceRecordIndex < 0
        || (chart.plateId1 !== null && !Number.isInteger(chart.plateId1))
        || !validAge(chart.fromAgeMa) || !validAge(chart.toAgeMa) || chart.fromAgeMa <= chart.toAgeMa
        || typeof chart.offSchedule !== "boolean") {
      throw new Error("invalid palaeo-coastline source chart record");
    }
  }
  for (const binding of catalog.bindings) {
    if (!binding.paletteId || !Number.isInteger(binding.bindingPlateId)
        || !Number.isInteger(binding.partitionPlateId)
        || !["owner-partition", "source-plateid1-override"].includes(binding.bindingSource)
        || !Array.isArray(binding.entries) || binding.entries.length === 0) {
      throw new Error("invalid palaeo-coastline motion binding record");
    }
    const entries = [...binding.entries].sort((left, right) =>
      left.validTimeMa.youngest - right.validTimeMa.youngest);
    for (const [index, entry] of entries.entries()) {
      const window = entry.validTimeMa;
      if (!entry.entryId || !validAge(window?.youngest) || !validAge(window.oldest)
          || window.youngest > window.oldest) {
        throw new Error("invalid palaeo-coastline motion binding entry");
      }
      const next = entries[index + 1];
      // Gap-free: the compiler emits one continuous chain per binding, because a
      // gap would drop the piece at ages the source record is still active at.
      if (next && next.validTimeMa.youngest !== window.oldest) {
        throw new Error("palaeo-coastline motion binding entries are not gap-free");
      }
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
  let previousIndex = -1;
  for (const [order, interval] of catalog.intervals.entries()) {
    const reservation = interval.reservation;
    if (!interval.intervalId || !Number.isSafeInteger(interval.intervalIndex)
        || interval.intervalIndex <= previousIndex || interval.intervalIndex >= PALAEO_INTERVAL_COUNT
        || !validAge(interval.fromAgeMa) || !validAge(interval.toAgeMa)
        || interval.fromAgeMa <= interval.toAgeMa
        || !(interval.midAgeMa > interval.toAgeMa && interval.midAgeMa < interval.fromAgeMa)
        || !payloadRecordValid(interval.simplified)
        || (interval.original !== undefined && !payloadRecordValid(interval.original))
        || reservation?.vertices !== interval.simplified.vertices
        || !Number.isSafeInteger(reservation.baseTriangles) || reservation.baseTriangles < 0
        || !Number.isSafeInteger(reservation.estimatedTrianglesAtOneDegree)
        || reservation.estimatedTrianglesAtOneDegree < reservation.baseTriangles
        || !(reservation.maximumEdgeDegrees > 0) || reservation.maximumEdgeDegrees > 1) {
      throw new Error("invalid palaeo-coastline interval record");
    }
    const previous = catalog.intervals[order - 1];
    // Intervals run oldest to youngest and abut; a published catalog that skips
    // a boundary would leave a band of ages with no map at all.
    if (previous && previous.intervalIndex + 1 === interval.intervalIndex
        && previous.toAgeMa !== interval.fromAgeMa) {
      throw new Error("palaeo-coastline intervals are not contiguous");
    }
    previousIndex = interval.intervalIndex;
  }
}

/**
 * Cross-checks a decoded payload against the catalog record that indexes it.
 * The payload's own header is self-consistent by construction; this is what
 * proves it is the interval and class the catalog promised, and that every
 * chart, binding and evidence index it carries resolves.
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
  if (payload.pieces.length !== interval.simplified.pieces
      || payload.ringCount !== interval.simplified.rings
      || payload.vertexCount !== interval.simplified.vertices) {
    throw new Error("palaeo-coastline payload counts disagree with the catalog");
  }
  for (const piece of payload.pieces) {
    if (piece.chartIndex >= catalog.charts.length || piece.bindingIndex >= catalog.bindings.length
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

/** The published interval covering an age, using the same `(TOAGE, FROMAGE]` rule as a piece. */
export function selectPalaeoInterval(
  catalog: PalaeoCoastlineClassCatalog,
  ageMa: number,
): PalaeoCoastlineIntervalRecord | null {
  if (!Number.isFinite(ageMa)) return null;
  return catalog.intervals.find((interval) =>
    ageMa > interval.toAgeMa && ageMa <= interval.fromAgeMa) ?? null;
}
