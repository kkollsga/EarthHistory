import { packageFrameIdentity, type PackageAsset } from "./identity";
import type { MotionPaletteCatalog, PreparedPaletteEntry } from "./palette";
import type { ReconstructionPackageManifestV2 } from "./packageV2";
import type { FrameKey } from "./types";

const HEADER_BYTES = 32;
const DESCRIPTOR_BYTES = 8;
const RECORD_BYTES = 20;
const SHA256 = /^[a-f0-9]{64}$/;

export interface RequestedAgeMotionTileDescriptor {
  readonly tileId: string;
  readonly validTimeMa: { readonly youngest: number; readonly oldest: number; readonly oldestExclusive: boolean };
  readonly asset: PackageAsset;
  readonly entryCount: number;
  readonly recordCount: number;
  readonly sourceRecordIndicesSha256: string;
}

export interface RequestedAgeMotionTileIndex {
  readonly schemaVersion: 1;
  readonly id: "cao-requested-age-motion-tiles-v1";
  readonly packageId: string;
  readonly revision: string;
  readonly frame: FrameKey;
  readonly ageDomainMa: { readonly youngest: number; readonly oldest: number };
  readonly windowSizeMicroMa: 25_000_000;
  readonly windowSelection: "youngest-inclusive-oldest-exclusive-final-oldest-inclusive";
  readonly sourceIdentity: {
    readonly coreSha256: string;
    readonly materialCorrectionCatalogSha256: string | null;
    readonly motionPaletteId: string;
    readonly motionPaletteCatalogSha256: string;
    readonly motionPaletteBinarySha256: string;
    readonly motionPaletteBinaryBytes: number;
  };
  readonly tiles: readonly RequestedAgeMotionTileDescriptor[];
}

function validAsset(asset: PackageAsset): boolean {
  return Boolean(asset.url) && Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && SHA256.test(asset.sha256);
}

function microMa(ageMa: number): number {
  return Math.round(ageMa * 1e6);
}

function exactMicroMa(ageMa: number): number | null {
  const scaled = ageMa * 1e6;
  const rounded = Math.round(scaled);
  return Number.isFinite(ageMa) && Math.abs(scaled - rounded) <= 1e-6 ? rounded : null;
}

export function validateRequestedAgeMotionTileIndex(
  index: RequestedAgeMotionTileIndex,
  manifest: ReconstructionPackageManifestV2,
): void {
  const source = index.sourceIdentity;
  if (index.schemaVersion !== 1 || index.id !== "cao-requested-age-motion-tiles-v1"
      || index.packageId !== manifest.packageId || index.revision !== manifest.revision
      || packageFrameIdentity(index.frame) !== packageFrameIdentity(manifest.frame)
      || index.ageDomainMa.youngest !== manifest.ageDomainMa.youngest
      || index.ageDomainMa.oldest !== manifest.ageDomainMa.oldest
      || index.windowSizeMicroMa !== 25_000_000
      || index.windowSelection !== "youngest-inclusive-oldest-exclusive-final-oldest-inclusive"
      || source.coreSha256 !== manifest.core.sha256
      || source.materialCorrectionCatalogSha256 !== (manifest.materialCorrections?.catalog.sha256 ?? null)
      || source.motionPaletteId !== manifest.motionPalette.id
      || source.motionPaletteCatalogSha256 !== manifest.motionPalette.catalog.sha256
      || source.motionPaletteBinarySha256 !== manifest.motionPalette.binary.sha256
      || source.motionPaletteBinaryBytes !== manifest.motionPalette.binary.bytes
      || index.tiles.length === 0) {
    throw new Error("requested-age motion tile index does not match the Cao package");
  }
  let cursor = exactMicroMa(index.ageDomainMa.youngest);
  const oldest = exactMicroMa(index.ageDomainMa.oldest);
  if (cursor === null || oldest === null) throw new Error("motion tile domain is not encoded at exact micro-Ma ages");
  const ids = new Set<string>();
  for (const [tileIndex, tile] of index.tiles.entries()) {
    const youngest = exactMicroMa(tile.validTimeMa.youngest);
    const tileOldest = exactMicroMa(tile.validTimeMa.oldest);
    const final = tileIndex === index.tiles.length - 1;
    if (!tile.tileId || ids.has(tile.tileId) || youngest === null || tileOldest === null
        || youngest !== cursor || tileOldest <= youngest
        || tileOldest - youngest > index.windowSizeMicroMa
        || (!final && tileOldest - youngest !== index.windowSizeMicroMa)
        || tile.validTimeMa.oldestExclusive !== !final
        || !validAsset(tile.asset) || !Number.isSafeInteger(tile.entryCount) || tile.entryCount < 1
        || !Number.isSafeInteger(tile.recordCount) || tile.recordCount < tile.entryCount
        || tile.asset.bytes !== HEADER_BYTES + tile.entryCount * DESCRIPTOR_BYTES
          + tile.recordCount * RECORD_BYTES
        || !SHA256.test(tile.sourceRecordIndicesSha256)) {
      throw new Error("invalid requested-age motion tile descriptor");
    }
    ids.add(tile.tileId);
    cursor = tileOldest;
  }
  if (cursor !== oldest) throw new Error("requested-age motion tiles do not cover the Cao age domain");
}

export function selectRequestedAgeMotionTile(
  index: RequestedAgeMotionTileIndex,
  requestedAgeMa: number,
): RequestedAgeMotionTileDescriptor {
  if (!Number.isFinite(requestedAgeMa)) throw new Error("invalid requested age for motion tile");
  const matches = index.tiles.filter((tile) => {
    const youngest = tile.validTimeMa.youngest;
    const oldest = tile.validTimeMa.oldest;
    return requestedAgeMa >= youngest
      && (tile.validTimeMa.oldestExclusive ? requestedAgeMa < oldest : requestedAgeMa <= oldest);
  });
  if (matches.length !== 1) throw new Error("requested age has no unique motion tile");
  return matches[0]!;
}

/** Decode one verified EHMT window into ordinary palette-entry views for the selected age. */
export function decodeRequestedAgeMotionTile(
  descriptor: RequestedAgeMotionTileDescriptor,
  catalog: MotionPaletteCatalog,
  tileBuffer: ArrayBuffer,
): ReadonlyMap<string, PreparedPaletteEntry> {
  if (tileBuffer.byteLength !== descriptor.asset.bytes || tileBuffer.byteLength < HEADER_BYTES) {
    throw new Error("requested-age motion tile byte length mismatch");
  }
  const view = new DataView(tileBuffer);
  if (String.fromCharCode(...new Uint8Array(tileBuffer, 0, 4)) !== "EHMT"
      || view.getUint16(4, true) !== 1 || view.getUint16(6, true) !== RECORD_BYTES
      || view.getUint32(8, true) !== descriptor.entryCount
      || view.getUint32(12, true) !== descriptor.recordCount
      || view.getUint32(16, true) !== HEADER_BYTES
      || view.getUint32(20, true) !== HEADER_BYTES + descriptor.entryCount * DESCRIPTOR_BYTES
      || view.getUint32(24, true) !== 0 || view.getUint32(28, true) !== 0) {
    throw new Error("invalid requested-age motion tile header");
  }

  const recordOffset = view.getUint32(20, true);
  const records = new ArrayBuffer(HEADER_BYTES + descriptor.recordCount * RECORD_BYTES);
  new Uint8Array(records, HEADER_BYTES).set(new Uint8Array(tileBuffer, recordOffset));
  const decoded = new Map<string, PreparedPaletteEntry>();
  let previousEntryIndex = -1;
  let sampleOffset = 0;
  for (let descriptorIndex = 0; descriptorIndex < descriptor.entryCount; descriptorIndex += 1) {
    const offset = HEADER_BYTES + descriptorIndex * DESCRIPTOR_BYTES;
    const entryIndex = view.getUint32(offset, true);
    const sampleCount = view.getUint32(offset + 4, true);
    const source = catalog.entries[entryIndex];
    if (!source || entryIndex <= previousEntryIndex || sampleCount < 1
        || sampleCount > source.sampleCount || sampleOffset + sampleCount > descriptor.recordCount) {
      throw new Error("invalid requested-age motion tile entry descriptor");
    }
    let previousAge = -1;
    for (let localIndex = 0; localIndex < sampleCount; localIndex += 1) {
      const record = new DataView(records, HEADER_BYTES + (sampleOffset + localIndex) * RECORD_BYTES, RECORD_BYTES);
      const ageMicroMa = record.getUint32(0, true);
      const norm = Math.hypot(record.getFloat32(4, true), record.getFloat32(8, true),
        record.getFloat32(12, true), record.getFloat32(16, true));
      if (ageMicroMa <= previousAge || ageMicroMa < microMa(source.youngestAgeMa)
          || ageMicroMa > microMa(source.oldestAgeMa) || !Number.isFinite(norm) || Math.abs(norm - 1) > 2e-6) {
        throw new Error("invalid requested-age motion tile sample");
      }
      previousAge = ageMicroMa;
    }
    const youngest = new DataView(records, HEADER_BYTES + sampleOffset * RECORD_BYTES, 4).getUint32(0, true) / 1e6;
    const oldest = previousAge / 1e6;
    decoded.set(source.entryId, Object.freeze({
      paletteId: catalog.id,
      entryId: source.entryId,
      payloadSha256: descriptor.asset.sha256,
      frameIdentity: packageFrameIdentity(catalog.frame),
      plateId: source.plateId,
      storedCoordinateBasis: Object.freeze({ ...source.storedCoordinateBasis }),
      youngestAgeMa: youngest,
      oldestAgeMa: oldest,
      backingBuffer: records,
      sampleOffset,
      sampleCount,
    }));
    previousEntryIndex = entryIndex;
    sampleOffset += sampleCount;
  }
  if (sampleOffset !== descriptor.recordCount) throw new Error("requested-age motion tile contains unbound records");
  return decoded;
}

/** Proves every tiled record is the exact declared subset of the verified all-age EHMP. */
export async function verifyRequestedAgeMotionTileSourceIdentity(
  descriptor: RequestedAgeMotionTileDescriptor,
  tileEntries: ReadonlyMap<string, PreparedPaletteEntry>,
  fullEntries: ReadonlyMap<string, PreparedPaletteEntry>,
): Promise<void> {
  const sourceIndices: number[] = [];
  for (const tileEntry of tileEntries.values()) {
    const fullEntry = fullEntries.get(tileEntry.entryId);
    if (!fullEntry) throw new Error("requested-age motion tile entry is absent from the all-age palette");
    const tileView = new DataView(tileEntry.backingBuffer);
    const fullView = new DataView(fullEntry.backingBuffer);
    let fullLocal = 0;
    for (let tileLocal = 0; tileLocal < tileEntry.sampleCount; tileLocal += 1) {
      const tileOffset = HEADER_BYTES + (tileEntry.sampleOffset + tileLocal) * RECORD_BYTES;
      const tileAge = tileView.getUint32(tileOffset, true);
      while (fullLocal < fullEntry.sampleCount) {
        const fullOffset = HEADER_BYTES + (fullEntry.sampleOffset + fullLocal) * RECORD_BYTES;
        if (fullView.getUint32(fullOffset, true) >= tileAge) break;
        fullLocal += 1;
      }
      if (fullLocal >= fullEntry.sampleCount) {
        throw new Error("requested-age motion tile sample is absent from the all-age palette");
      }
      const fullOffset = HEADER_BYTES + (fullEntry.sampleOffset + fullLocal) * RECORD_BYTES;
      for (let byte = 0; byte < RECORD_BYTES; byte += 1) {
        if (tileView.getUint8(tileOffset + byte) !== fullView.getUint8(fullOffset + byte)) {
          throw new Error("requested-age motion tile sample differs from the all-age palette");
        }
      }
      sourceIndices.push(fullEntry.sampleOffset + fullLocal);
      fullLocal += 1;
    }
  }
  if (sourceIndices.length !== descriptor.recordCount) {
    throw new Error("requested-age motion tile source-record count mismatch");
  }
  const bytes = new Uint8Array(sourceIndices.length * 4);
  const view = new DataView(bytes.buffer);
  sourceIndices.forEach((value, index) => view.setUint32(index * 4, value, true));
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  if (digest !== descriptor.sourceRecordIndicesSha256) {
    throw new Error("requested-age motion tile source-record identity mismatch");
  }
}
