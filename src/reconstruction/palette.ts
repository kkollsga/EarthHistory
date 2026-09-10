import type { QuaternionWxyz } from "./arithmetic";
import { packageFrameIdentity } from "./identity";
import type { FrameKey, MotionSample } from "./types";

const HEADER_BYTES = 32;
const RECORD_BYTES = 20;

export interface MotionPaletteSourceInterval {
  readonly youngestAgeMa: number;
  readonly oldestAgeMa: number;
  readonly kind: "smooth-motion" | "source-knot" | "source-seam";
}

export type StoredCoordinateBasis =
  | { readonly kind: "virtual-coordinate-origin"; readonly geometryReferenceAgeMa: number }
  | { readonly kind: "supported-reference"; readonly geometryReferenceAgeMa: number };

export interface MotionPaletteEntry {
  readonly entryId: string;
  readonly plateId: number;
  /** Audit metadata; every stored quaternion already maps this basis to its requested-age frame. */
  readonly storedCoordinateBasis: StoredCoordinateBasis;
  readonly youngestAgeMa: number;
  readonly oldestAgeMa: number;
  readonly sampleOffset: number;
  readonly sampleCount: number;
  readonly sourceIds: readonly string[];
  readonly sourceIntervals?: readonly MotionPaletteSourceInterval[];
  readonly sourceIntervalSetId?: string;
}

export interface MotionPaletteCatalog {
  readonly schemaVersion: 2;
  readonly id: string;
  readonly packageId: string;
  readonly revision: string;
  readonly frame: FrameKey;
  readonly binary: {
    readonly bytes: number;
    readonly sha256: string;
    readonly timeEncoding: "uint32-micro-ma";
    readonly quaternionEncoding: "float32-wxyz";
  };
  readonly entries: readonly MotionPaletteEntry[];
  readonly sourceIntervalSets?: readonly { readonly id: string;
    readonly intervals: readonly MotionPaletteSourceInterval[] }[];
}

export interface PreparedPaletteEntry {
  readonly paletteId: string;
  readonly entryId: string;
  readonly payloadSha256: string;
  readonly frameIdentity: string;
  readonly plateId: number;
  readonly storedCoordinateBasis: StoredCoordinateBasis;
  readonly youngestAgeMa: number;
  readonly oldestAgeMa: number;
  readonly backingBuffer: ArrayBuffer;
  readonly sampleOffset: number;
  readonly sampleCount: number;
}

export interface PaletteMotionSubsegment {
  readonly younger: MotionSample;
  readonly older: MotionSample;
  readonly fraction: number;
}

function readSample(entry: PreparedPaletteEntry, localIndex: number): MotionSample {
  const offset = HEADER_BYTES + (entry.sampleOffset + localIndex) * RECORD_BYTES;
  const view = new DataView(entry.backingBuffer);
  return {
    ageMicroMa: view.getUint32(offset, true),
    quaternion: [view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true),
      view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true)],
  };
}

export function selectPaletteMotionSubsegment(
  entry: PreparedPaletteEntry,
  requestedAgeMa: number,
): PaletteMotionSubsegment | null {
  if (!Number.isFinite(requestedAgeMa) || requestedAgeMa < entry.youngestAgeMa || requestedAgeMa > entry.oldestAgeMa) {
    return null;
  }
  const target = Math.round(requestedAgeMa * 1e6);
  let low = 0;
  let high = entry.sampleCount - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (readSample(entry, middle).ageMicroMa < target) low = middle + 1; else high = middle;
  }
  const older = readSample(entry, low);
  const younger = readSample(entry, Math.max(0, low - 1));
  return { younger, older, fraction: younger.ageMicroMa === older.ageMicroMa ? 0
    : (target - younger.ageMicroMa) / (older.ageMicroMa - younger.ageMicroMa) };
}

function validAge(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1_800;
}

/** Decodes one verified shared palette. Digest verification remains the loader's responsibility. */
export function decodeMotionPalette(
  catalog: MotionPaletteCatalog,
  buffer: ArrayBuffer,
): ReadonlyMap<string, PreparedPaletteEntry> {
  if (catalog.schemaVersion !== 2 || !catalog.id || !catalog.packageId || !catalog.revision
      || catalog.entries.length === 0 || buffer.byteLength !== catalog.binary.bytes
      || !/^[a-f0-9]{64}$/.test(catalog.binary.sha256) || buffer.byteLength < HEADER_BYTES) {
    throw new Error("invalid shared motion palette catalog");
  }
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "EHMP"
      || view.getUint16(4, true) !== 2 || view.getUint16(6, true) !== RECORD_BYTES
      || view.getUint32(8, true) !== catalog.entries.length
      || view.getUint32(16, true) !== HEADER_BYTES
      || view.getUint32(20, true) !== 0 || view.getUint32(24, true) !== 0
      || view.getUint32(28, true) !== 0) {
    throw new Error("shared motion palette binary identity mismatch");
  }
  const recordCount = view.getUint32(12, true);
  if (HEADER_BYTES + recordCount * RECORD_BYTES !== buffer.byteLength) {
    throw new Error("shared motion palette record length mismatch");
  }
  const ids = new Set<string>();
  const intervalSets = new Map((catalog.sourceIntervalSets ?? []).map((set) => [set.id, set.intervals]));
  if (intervalSets.size !== (catalog.sourceIntervalSets?.length ?? 0)) {
    throw new Error("duplicate shared motion source interval set");
  }
  let expectedOffset = 0;
  const decoded = new Map<string, PreparedPaletteEntry>();
  for (const entry of catalog.entries) {
    if (!entry.entryId || ids.has(entry.entryId) || !Number.isInteger(entry.plateId) || entry.plateId < 0
        || !validAge(entry.youngestAgeMa) || !validAge(entry.oldestAgeMa)
        || entry.youngestAgeMa > entry.oldestAgeMa || entry.sampleOffset !== expectedOffset
        || !Number.isInteger(entry.sampleCount) || entry.sampleCount < 2
        || entry.sampleOffset + entry.sampleCount > recordCount || entry.sourceIds.length === 0
        || (!entry.sourceIntervals && !entry.sourceIntervalSetId)
        || (entry.sourceIntervals && entry.sourceIntervalSetId)
        || !validAge(entry.storedCoordinateBasis.geometryReferenceAgeMa)) {
      throw new Error("invalid shared motion palette entry");
    }
    const sourceIntervals = entry.sourceIntervals ?? intervalSets.get(entry.sourceIntervalSetId!) ?? [];
    if (sourceIntervals.length === 0) throw new Error("missing shared motion source interval set");
    ids.add(entry.entryId);
    const sampleAges: number[] = [];
    let previousAge = -1;
    for (let index = 0; index < entry.sampleCount; index += 1) {
      const offset = HEADER_BYTES + (entry.sampleOffset + index) * RECORD_BYTES;
      const ageMicroMa = view.getUint32(offset, true);
      const quaternion: QuaternionWxyz = [view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true),
        view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true)];
      const norm = Math.hypot(...quaternion);
      if (ageMicroMa <= previousAge || !Number.isFinite(norm) || Math.abs(norm - 1) > 2e-6) {
        throw new Error("invalid shared motion palette sample");
      }
      sampleAges.push(ageMicroMa);
      previousAge = ageMicroMa;
    }
    const youngestMicro = Math.round(entry.youngestAgeMa * 1e6);
    const oldestMicro = Math.round(entry.oldestAgeMa * 1e6);
    if (sampleAges[0] !== youngestMicro || sampleAges.at(-1) !== oldestMicro
        || sourceIntervals.some((interval) => !validAge(interval.youngestAgeMa)
          || !validAge(interval.oldestAgeMa) || interval.youngestAgeMa > interval.oldestAgeMa
          || interval.kind === "source-seam")
        || !sourceIntervals.some((interval) => interval.kind === "smooth-motion"
          && Math.round(interval.youngestAgeMa * 1e6) === youngestMicro
          && Math.round(interval.oldestAgeMa * 1e6) === oldestMicro)) {
      throw new Error("shared motion palette source interval mismatch");
    }
    const sampleAgeSet = new Set(sampleAges);
    if (sourceIntervals.some((interval) => interval.kind === "source-knot"
      && (interval.youngestAgeMa !== interval.oldestAgeMa
        || !sampleAgeSet.has(Math.round(interval.youngestAgeMa * 1e6))))) {
      throw new Error("shared motion palette source knot mismatch");
    }
    decoded.set(entry.entryId, Object.freeze({
      paletteId: catalog.id,
      entryId: entry.entryId,
      payloadSha256: catalog.binary.sha256,
      frameIdentity: packageFrameIdentity(catalog.frame),
      plateId: entry.plateId,
      storedCoordinateBasis: Object.freeze({ ...entry.storedCoordinateBasis }),
      youngestAgeMa: entry.youngestAgeMa,
      oldestAgeMa: entry.oldestAgeMa,
      backingBuffer: buffer,
      sampleOffset: entry.sampleOffset,
      sampleCount: entry.sampleCount,
    }));
    expectedOffset += entry.sampleCount;
  }
  if (expectedOffset !== recordCount) throw new Error("shared motion palette contains unbound records");
  return decoded;
}
