/**
 * Country-outline tone tables and Cao 2017 map-interval selection.
 *
 * While the palaeo-coastline mode is on the modern-country outlines stop being
 * a coastline reference and become position markers: dark where they cross
 * reconstructed land, light grey where they cross a mapped shallow sea or open
 * water. That is a legibility device, not evidence — the compiler resolves one
 * tone per outline segment per map interval offline, and this module decodes
 * the result and picks the interval a requested age belongs to.
 */

import { palaeoIntervalCoversAge } from "./palaeoRings";
import type { EvidenceStatus } from "../data";

/** `EHPT` — EarthHistory palaeo tone tables. */
export const PALAEO_OUTLINE_TONE_MAGIC = "EHPT";
export const PALAEO_OUTLINE_TONE_VERSION = 1;
export const PALAEO_OUTLINE_TONE_HEADER_BYTES = 32;
/** Two bits per segment, so one byte carries four segments. */
export const PALAEO_OUTLINE_TONE_SEGMENTS_PER_BYTE = 4;

/**
 * The four tone classes a segment can carry. Only the first three are drawn;
 * `inactive` marks a segment whose chart is not posed in this interval, whose
 * quad has already collapsed to the globe centre, and it renders dark so a
 * decoding fault cannot paint a light stroke somewhere the mode never mapped.
 */
export const PALAEO_OUTLINE_TONE_LAND = 0;
export const PALAEO_OUTLINE_TONE_SHALLOW = 1;
export const PALAEO_OUTLINE_TONE_DEEP = 2;
export const PALAEO_OUTLINE_TONE_INACTIVE = 3;

export type PalaeoOutlineToneClass = 0 | 1 | 2 | 3;

/** Light ink covers both water classes; land and inactive take the dark ink. */
export function palaeoOutlineToneIsLight(toneClass: PalaeoOutlineToneClass): boolean {
  return toneClass === PALAEO_OUTLINE_TONE_SHALLOW || toneClass === PALAEO_OUTLINE_TONE_DEEP;
}

export interface PalaeoOutlineToneTables {
  readonly version: number;
  /** One table per canonical interval, ordered oldest to youngest. */
  readonly tableCount: number;
  /** Outline segments each table describes; must match the country line batch. */
  readonly segmentCount: number;
  readonly bytesPerTable: number;
  /** `tableCount * bytesPerTable` packed bytes, four segments to a byte. */
  readonly packed: Uint8Array;
}

export function palaeoOutlineToneBytesPerTable(segmentCount: number): number {
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 0) {
    throw new Error("invalid palaeo outline tone segment count");
  }
  return Math.ceil(segmentCount / PALAEO_OUTLINE_TONE_SEGMENTS_PER_BYTE);
}

/**
 * Decode an EHPT v1 payload.
 *
 * `expectedSegmentCount` is the country line batch's own segment count. A table
 * compiled against a different outline package would address the wrong
 * segments silently — every index would still be in range — so the count is a
 * required argument rather than an optional cross-check.
 */
export function decodePalaeoOutlineToneTables(
  source: ArrayBuffer | ArrayBufferView,
  expectedSegmentCount: number,
): PalaeoOutlineToneTables {
  if (!Number.isSafeInteger(expectedSegmentCount) || expectedSegmentCount < 0) {
    throw new Error("invalid palaeo outline tone segment count");
  }
  const bytes = source instanceof ArrayBuffer
    ? new Uint8Array(source)
    : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (bytes.byteLength < PALAEO_OUTLINE_TONE_HEADER_BYTES) {
    throw new Error("palaeo outline tone payload is shorter than its header");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== PALAEO_OUTLINE_TONE_MAGIC) {
    throw new Error("palaeo outline tone payload is not EHPT");
  }
  const version = view.getUint16(4, true);
  if (version !== PALAEO_OUTLINE_TONE_VERSION) {
    throw new Error(`unsupported palaeo outline tone version ${version}`);
  }
  const headerBytes = view.getUint16(6, true);
  if (headerBytes !== PALAEO_OUTLINE_TONE_HEADER_BYTES) {
    throw new Error("palaeo outline tone header length is not 32 bytes");
  }
  const tableCount = view.getUint32(8, true);
  const segmentCount = view.getUint32(12, true);
  const bytesPerTable = view.getUint32(16, true);
  // A reserved field a v1 writer left nonzero means the payload was written by
  // a format this decoder does not understand, whatever its version field says.
  for (let offset = 20; offset < PALAEO_OUTLINE_TONE_HEADER_BYTES; offset += 1) {
    if (bytes[offset] !== 0) throw new Error("palaeo outline tone reserved header bytes are set");
  }
  if (tableCount < 1) throw new Error("palaeo outline tone payload carries no table");
  if (segmentCount !== expectedSegmentCount) {
    throw new Error(`palaeo outline tone segment count ${segmentCount} does not match the`
      + ` country line batch (${expectedSegmentCount})`);
  }
  if (bytesPerTable !== palaeoOutlineToneBytesPerTable(segmentCount)) {
    throw new Error("palaeo outline tone table stride does not match its segment count");
  }
  const expectedBytes = PALAEO_OUTLINE_TONE_HEADER_BYTES + tableCount * bytesPerTable;
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`palaeo outline tone payload is ${bytes.byteLength} bytes,`
      + ` expected ${expectedBytes}`);
  }
  return Object.freeze({
    version,
    tableCount,
    segmentCount,
    bytesPerTable,
    packed: bytes.slice(PALAEO_OUTLINE_TONE_HEADER_BYTES),
  });
}

/** Encode tone classes for one or more tables; the decoder's inverse. */
export function encodePalaeoOutlineToneTables(
  tables: readonly (readonly PalaeoOutlineToneClass[])[],
  segmentCount: number,
): Uint8Array {
  const bytesPerTable = palaeoOutlineToneBytesPerTable(segmentCount);
  if (tables.length < 1) throw new Error("palaeo outline tone payload carries no table");
  const bytes = new Uint8Array(PALAEO_OUTLINE_TONE_HEADER_BYTES + tables.length * bytesPerTable);
  bytes.set([0x45, 0x48, 0x50, 0x54], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(4, PALAEO_OUTLINE_TONE_VERSION, true);
  view.setUint16(6, PALAEO_OUTLINE_TONE_HEADER_BYTES, true);
  view.setUint32(8, tables.length, true);
  view.setUint32(12, segmentCount, true);
  view.setUint32(16, bytesPerTable, true);
  for (let table = 0; table < tables.length; table += 1) {
    const classes = tables[table]!;
    if (classes.length !== segmentCount) {
      throw new Error("palaeo outline tone table length does not match its segment count");
    }
    const base = PALAEO_OUTLINE_TONE_HEADER_BYTES + table * bytesPerTable;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const toneClass = classes[segment]!;
      if (toneClass < 0 || toneClass > 3) throw new Error("invalid palaeo outline tone class");
      bytes[base + (segment >> 2)]! |= toneClass << ((segment & 3) * 2);
    }
  }
  return bytes;
}

export function palaeoOutlineToneClass(
  tables: PalaeoOutlineToneTables,
  tableIndex: number,
  segmentIndex: number,
): PalaeoOutlineToneClass {
  if (!Number.isSafeInteger(tableIndex) || tableIndex < 0 || tableIndex >= tables.tableCount) {
    throw new Error("palaeo outline tone table index is out of range");
  }
  if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0
      || segmentIndex >= tables.segmentCount) {
    throw new Error("palaeo outline tone segment index is out of range");
  }
  const byte = tables.packed[tableIndex * tables.bytesPerTable + (segmentIndex >> 2)]!;
  return ((byte >> ((segmentIndex & 3) * 2)) & 3) as PalaeoOutlineToneClass;
}

/**
 * Texture width the renderer samples a tone table through. A row of 128 keeps
 * the whole 12 045-segment outline inside 95 rows, well under every backend's
 * 2D limit, and 128 is a multiple of four so an R8 upload needs no row padding.
 */
export const PALAEO_OUTLINE_TONE_TEXTURE_WIDTH = 128;

export function palaeoOutlineToneTextureRows(segmentCount: number): number {
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 0) {
    throw new Error("invalid palaeo outline tone segment count");
  }
  return Math.max(1, Math.ceil(segmentCount / PALAEO_OUTLINE_TONE_TEXTURE_WIDTH));
}

/**
 * Expand one packed table into the R8 texel array the outline material samples:
 * 255 where the segment takes the light ink, 0 where it takes the dark one.
 * Texels past the last segment stay dark, so a padded row cannot light up.
 */
export function buildPalaeoOutlineToneTexels(
  tables: PalaeoOutlineToneTables,
  tableIndex: number,
): Uint8Array {
  const rows = palaeoOutlineToneTextureRows(tables.segmentCount);
  const texels = new Uint8Array(rows * PALAEO_OUTLINE_TONE_TEXTURE_WIDTH);
  for (let segment = 0; segment < tables.segmentCount; segment += 1) {
    if (palaeoOutlineToneIsLight(palaeoOutlineToneClass(tables, tableIndex, segment))) {
      texels[segment] = 255;
    }
  }
  return texels;
}

export interface PalaeoOutlineToneCounts {
  readonly darkSegments: number;
  readonly lightSegments: number;
  readonly inactiveSegments: number;
}

export function palaeoOutlineToneCounts(
  tables: PalaeoOutlineToneTables,
  tableIndex: number,
): PalaeoOutlineToneCounts {
  let darkSegments = 0;
  let lightSegments = 0;
  let inactiveSegments = 0;
  for (let segment = 0; segment < tables.segmentCount; segment += 1) {
    const toneClass = palaeoOutlineToneClass(tables, tableIndex, segment);
    if (palaeoOutlineToneIsLight(toneClass)) lightSegments += 1;
    else darkSegments += 1;
    if (toneClass === PALAEO_OUTLINE_TONE_INACTIVE) inactiveSegments += 1;
  }
  return Object.freeze({ darkSegments, lightSegments, inactiveSegments });
}

/**
 * One published Cao et al. (2017) map interval. `oldestMa` is inclusive and
 * `youngestMa` exclusive — the `(TOAGE, FROMAGE]` lifecycle rule the source
 * shapefiles carry, measured in the Phase R audit.
 */
export interface PalaeoMapInterval {
  readonly id: string;
  readonly youngestMa: number;
  readonly oldestMa: number;
}

/**
 * The 24 canonical intervals, oldest first, transcribed from
 * `docs/research/palaeo-coastlines-cao2017-audit.json` (`schedule.
 * canonicalIntervals`, `fromAgeMa`/`toAgeMa`). `outlineTones.test.ts` reads
 * that record and fails if this table drifts from it.
 *
 * The youngest bounds are the source's own X.01 values, so the 10 kyr between
 * one interval's youngest bound and the next interval's oldest bound belongs to
 * neither: selection answers null there and the mode falls back, rather than
 * inventing a map the source does not publish.
 */
export const CAO_2017_MAP_INTERVALS: readonly PalaeoMapInterval[] = Object.freeze([
  { id: "402-380", youngestMa: 380.01, oldestMa: 402 },
  { id: "380-359", youngestMa: 359.01, oldestMa: 380 },
  { id: "359-338", youngestMa: 338.01, oldestMa: 359 },
  { id: "338-323", youngestMa: 323.01, oldestMa: 338 },
  { id: "323-296", youngestMa: 296.01, oldestMa: 323 },
  { id: "296-285", youngestMa: 285.01, oldestMa: 296 },
  { id: "285-269", youngestMa: 269.01, oldestMa: 285 },
  { id: "269-248", youngestMa: 248.01, oldestMa: 269 },
  { id: "248-224", youngestMa: 224.01, oldestMa: 248 },
  { id: "224-203", youngestMa: 203.01, oldestMa: 224 },
  { id: "203-179", youngestMa: 179.01, oldestMa: 203 },
  { id: "179-166", youngestMa: 166.01, oldestMa: 179 },
  { id: "166-146", youngestMa: 146.01, oldestMa: 166 },
  { id: "146-135", youngestMa: 135.01, oldestMa: 146 },
  { id: "135-117", youngestMa: 117.01, oldestMa: 135 },
  { id: "117-94", youngestMa: 94.01, oldestMa: 117 },
  { id: "94-81", youngestMa: 81.01, oldestMa: 94 },
  { id: "81-58", youngestMa: 58.01, oldestMa: 81 },
  { id: "58-49", youngestMa: 49.01, oldestMa: 58 },
  { id: "49-37", youngestMa: 37.01, oldestMa: 49 },
  { id: "37-29", youngestMa: 29.01, oldestMa: 37 },
  { id: "29-20", youngestMa: 20.01, oldestMa: 29 },
  { id: "20-11", youngestMa: 11.01, oldestMa: 20 },
  { id: "11-2", youngestMa: 2.01, oldestMa: 11 },
].map((interval) => Object.freeze(interval)));

/** The oldest bound of every canonical interval: the timeline's snap marks. */
export const CAO_2017_MAP_INTERVAL_MARKS_MA: readonly number[] =
  Object.freeze(CAO_2017_MAP_INTERVALS.map((interval) => interval.oldestMa));

/**
 * Index of the interval covering `ageMa`, or -1 where none does.
 *
 * Half-open by the source's lifecycle rule: active while
 * `youngestMa < ageMa <= oldestMa`. So 380 Ma belongs to `380-359`, not to
 * `402-380` whose youngest bound is 380.01, and the domain's own youngest
 * bound of 2.01 Ma belongs to no interval at all.
 *
 * The rule itself is `palaeoIntervalCoversAge` in `palaeoRings.ts`, which is
 * also what `selectPalaeoCatalogInterval` applies to a shipped class catalog:
 * one predicate, so a catalog compiled on the canonical schedule and this table
 * always answer with the same interval.
 */
export function selectPalaeoInterval(
  intervals: readonly PalaeoMapInterval[],
  ageMa: number,
): number {
  return intervals.findIndex((interval) =>
    palaeoIntervalCoversAge(ageMa, interval.oldestMa, interval.youngestMa));
}

/** The published interval name, e.g. `94–81 Ma`. */
export function palaeoIntervalLabel(interval: PalaeoMapInterval): string {
  return `${interval.id.replace("-", "–")} Ma`;
}

export interface PalaeoIntervalSelection {
  /** The interval on screen; -1 while none is. */
  readonly index: number;
  /** The answer waiting for a second frame's agreement. */
  readonly pendingIndex: number;
  readonly pendingFrames: number;
}

export const PALAEO_INTERVAL_INITIAL_SELECTION: PalaeoIntervalSelection =
  Object.freeze({ index: -1, pendingIndex: -1, pendingFrames: 0 });

/**
 * One-frame hysteresis on the interval index, matching the domain-boundary
 * hysteresis in `palaeoComposite.ts`.
 *
 * A scrub resting on an interval bound alternates between two answers frame by
 * frame, and each change swaps a whole geometry and re-uploads a tone table.
 * Requiring the new index to hold for a second consecutive frame costs one
 * frame of latency at a real crossing and removes the churn at a bound the user
 * is hovering on. The counter resets whenever the requested index agrees with
 * what is on screen, so the delay never accumulates.
 */
export function nextPalaeoIntervalSelection(
  previous: PalaeoIntervalSelection,
  requestedIndex: number,
): PalaeoIntervalSelection {
  if (requestedIndex === previous.index) {
    return previous.pendingFrames === 0 ? previous
      : Object.freeze({ index: previous.index, pendingIndex: previous.index, pendingFrames: 0 });
  }
  if (previous.pendingIndex === requestedIndex && previous.pendingFrames >= 1) {
    return Object.freeze({ index: requestedIndex, pendingIndex: requestedIndex, pendingFrames: 0 });
  }
  return Object.freeze({
    index: previous.index, pendingIndex: requestedIndex, pendingFrames: 1,
  });
}

/**
 * Epistemic status of a palaeo-coastline view.
 *
 * An edited chart is a synthesis whatever the age: the ring is the published
 * polygon modified after cited local literature. Otherwise the view is the
 * published map itself at the interval's own map age, and a held map under an
 * interpolated Cao 2024 pose anywhere inside the interval. The interval's
 * youngest bound is exclusive, so only the oldest bound is ever exact.
 */
export function palaeoIntervalEvidenceStatus(
  interval: PalaeoMapInterval | null,
  ageMa: number,
  editedChartsActive: boolean,
): EvidenceStatus {
  if (interval === null) return "unknown";
  if (editedChartsActive) return "synthesis";
  return ageMa === interval.oldestMa ? "model-output" : "interpolation";
}
