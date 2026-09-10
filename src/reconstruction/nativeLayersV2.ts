import { packageFrameIdentity, type PackageAsset } from "./identity";
import type { FrameKey } from "./types";

export type NativeBoundaryKind = "ridge" | "subduction" | "transform" | "other";
export interface NativeBoundarySegmentV2 {
  readonly segmentId: string;
  readonly sourceFeatureId: string;
  readonly sourcePart: number;
  readonly sourceFeatureType: string;
  readonly validTimeMa: { readonly youngest: number; readonly oldest: number };
  readonly kind: NativeBoundaryKind;
  readonly polarity: "left" | "right" | "unknown";
  readonly rightTopologyId: string | null;
  readonly leftTopologyId: string | null;
  readonly rightPlateId: number | null;
  readonly leftPlateId: number | null;
  readonly ownershipStatus: "resolved" | "ambiguous" | "unknown";
  readonly pointOffset: number;
  readonly pointCount: number;
}
export interface NativeBoundaryCatalogV2 {
  readonly schemaVersion: 2;
  readonly packageId: string;
  readonly revision: string;
  readonly frame: FrameKey;
  readonly sourceAgeMa: number;
  readonly pointEncoding: "ehnb-v2-f32xyz";
  readonly pointRecordBytes: 12;
  readonly binary: PackageAsset;
  /** Optional future diagnostic asset; absent from the foundation package. */
  readonly kinematicsEncoding?: "ehnk-v2-f32-tangent-normal-velocity";
  readonly segments: readonly NativeBoundarySegmentV2[];
}

export interface TopologyOwnershipRingV2 {
  readonly ringId: string;
  readonly polygonId: string;
  readonly ringRole: "exterior" | "hole";
  readonly topologyId: string;
  readonly plateId: number | null;
  readonly status: "instantaneous-owner" | "ambiguous" | "unknown";
  readonly candidatePlateIds: readonly number[];
  readonly pointOffset: number;
  readonly pointCount: number;
}
export interface TopologyOwnershipCatalogV2 {
  readonly schemaVersion: 2;
  readonly packageId: string;
  readonly revision: string;
  readonly frame: FrameKey;
  readonly sourceAgeMa: number;
  readonly pointEncoding: "ehto-v2-f32xyz";
  readonly pointRecordBytes: 12;
  readonly binary: PackageAsset;
  readonly rings: readonly TopologyOwnershipRingV2[];
}

/** Exact-knot layers are withheld at fractional ages until correspondence is qualified. */
export type PreparedNativeLayer<T> =
  | { readonly kind: "exact-source"; readonly sourceAgeMa: number; readonly value: T }
  | { readonly kind: "unavailable"; readonly requestedAgeMa: number;
      readonly reason: "fractional-topology-unqualified" | "source-absent" };

export type InstantaneousOwnershipResult =
  | { readonly kind: "instantaneous-owner"; readonly plateId: number; readonly topologyId: string;
      readonly sourceAgeMa: number }
  | { readonly kind: "ambiguous"; readonly candidatePlateIds: readonly number[]; readonly sourceAgeMa: number }
  | { readonly kind: "unknown"; readonly sourceAgeMa: number };

export interface DecodedNativePointAsset {
  readonly backingBuffer: ArrayBuffer;
  readonly directions: Float32Array;
  readonly pointCount: number;
  readonly byteLength: number;
}

const HEADER_BYTES = 32;
const SHA256 = /^[a-f0-9]{64}$/;

function assetValid(asset: PackageAsset): boolean {
  return Boolean(asset.url) && Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && SHA256.test(asset.sha256);
}

function decodePoints(buffer: ArrayBuffer, magic: "EHNB" | "EHTO", sourceAgeMa: number): DecodedNativePointAsset {
  if (!Number.isFinite(sourceAgeMa) || sourceAgeMa < 0 || sourceAgeMa > 1_800) {
    throw new Error("invalid Cao native source age");
  }
  const view = new DataView(buffer);
  if (buffer.byteLength < HEADER_BYTES || String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== magic
      || view.getUint16(4, true) !== 2 || view.getUint16(6, true) !== HEADER_BYTES
      || view.getUint32(12, true) !== 12
      || view.getUint32(16, true) !== Math.round(sourceAgeMa * 1_000_000)
      || view.getUint32(20, true) !== 0 || view.getUint32(24, true) !== 0 || view.getUint32(28, true) !== 0) {
    throw new Error(`invalid ${magic} native layer header`);
  }
  const pointCount = view.getUint32(8, true);
  if (pointCount < 2 || buffer.byteLength !== HEADER_BYTES + pointCount * 12) {
    throw new Error(`${magic} native layer length mismatch`);
  }
  const directions = new Float32Array(buffer, HEADER_BYTES, pointCount * 3);
  for (let point = 0; point < pointCount; point += 1) {
    const offset = point * 3;
    const length = Math.hypot(directions[offset]!, directions[offset + 1]!, directions[offset + 2]!);
    if (!Number.isFinite(length) || Math.abs(length - 1) > 2e-6) throw new Error(`invalid ${magic} unit direction`);
  }
  return Object.freeze({ backingBuffer: buffer, directions, pointCount, byteLength: buffer.byteLength });
}

function rangesCoverExactly(records: readonly { readonly pointOffset: number; readonly pointCount: number }[], total: number): boolean {
  const ordered = [...records].sort((left, right) => left.pointOffset - right.pointOffset);
  let cursor = 0;
  for (const record of ordered) {
    if (!Number.isSafeInteger(record.pointOffset) || !Number.isSafeInteger(record.pointCount)
        || record.pointOffset !== cursor || record.pointCount < 2) return false;
    cursor += record.pointCount;
  }
  return cursor === total;
}

export function validateAndDecodeNativeBoundaryLayer(
  catalog: NativeBoundaryCatalogV2,
  buffer: ArrayBuffer,
  expected: { readonly packageId: string; readonly revision: string; readonly frame: FrameKey;
    readonly sourceAgeMa: number; readonly binary: PackageAsset },
): DecodedNativePointAsset {
  const decoded = decodePoints(buffer, "EHNB", expected.sourceAgeMa);
  const ids = new Set(catalog.segments.map((segment) => segment.segmentId));
  if (catalog.schemaVersion !== 2 || catalog.packageId !== expected.packageId || catalog.revision !== expected.revision
      || packageFrameIdentity(catalog.frame) !== packageFrameIdentity(expected.frame)
      || catalog.sourceAgeMa !== expected.sourceAgeMa || catalog.pointEncoding !== "ehnb-v2-f32xyz"
      || catalog.pointRecordBytes !== 12 || !assetValid(catalog.binary)
      || catalog.binary.bytes !== expected.binary.bytes || catalog.binary.sha256 !== expected.binary.sha256
      || catalog.binary.url !== expected.binary.url || catalog.binary.bytes !== buffer.byteLength
      || ids.size !== catalog.segments.length || !rangesCoverExactly(catalog.segments, decoded.pointCount)
      || catalog.segments.some((segment) => !segment.segmentId || !segment.sourceFeatureId
        || !Number.isSafeInteger(segment.sourcePart) || segment.sourcePart < 0 || !segment.sourceFeatureType
        || !Number.isFinite(segment.validTimeMa.youngest) || !Number.isFinite(segment.validTimeMa.oldest)
        || segment.validTimeMa.youngest > segment.validTimeMa.oldest
        || catalog.sourceAgeMa < segment.validTimeMa.youngest || catalog.sourceAgeMa > segment.validTimeMa.oldest
        || !(["ridge", "subduction", "transform", "other"] as const).includes(segment.kind)
        || !(["left", "right", "unknown"] as const).includes(segment.polarity)
        || !(["resolved", "ambiguous", "unknown"] as const).includes(segment.ownershipStatus)
        || (segment.rightPlateId !== null && !Number.isInteger(segment.rightPlateId))
        || (segment.leftPlateId !== null && !Number.isInteger(segment.leftPlateId)))) {
    throw new Error("invalid Cao native boundary catalog");
  }
  return decoded;
}

export function validateAndDecodeTopologyOwnershipLayer(
  catalog: TopologyOwnershipCatalogV2,
  buffer: ArrayBuffer,
  expected: { readonly packageId: string; readonly revision: string; readonly frame: FrameKey;
    readonly sourceAgeMa: number; readonly binary: PackageAsset },
): DecodedNativePointAsset {
  const decoded = decodePoints(buffer, "EHTO", expected.sourceAgeMa);
  const ids = new Set(catalog.rings.map((ring) => ring.ringId));
  const polygons = new Map<string, TopologyOwnershipRingV2[]>();
  for (const ring of catalog.rings) {
    const rings = polygons.get(ring.polygonId) ?? [];
    rings.push(ring);
    polygons.set(ring.polygonId, rings);
  }
  if (catalog.schemaVersion !== 2 || catalog.packageId !== expected.packageId || catalog.revision !== expected.revision
      || packageFrameIdentity(catalog.frame) !== packageFrameIdentity(expected.frame)
      || catalog.sourceAgeMa !== expected.sourceAgeMa || catalog.pointEncoding !== "ehto-v2-f32xyz"
      || catalog.pointRecordBytes !== 12 || !assetValid(catalog.binary)
      || catalog.binary.bytes !== expected.binary.bytes || catalog.binary.sha256 !== expected.binary.sha256
      || catalog.binary.url !== expected.binary.url || catalog.binary.bytes !== buffer.byteLength
      || ids.size !== catalog.rings.length || !rangesCoverExactly(catalog.rings, decoded.pointCount)
      || [...polygons.values()].some((rings) => {
        const exterior = rings.filter((ring) => ring.ringRole === "exterior");
        const first = rings[0]!;
        return exterior.length !== 1 || rings.some((ring) => ring.topologyId !== first.topologyId
          || ring.plateId !== first.plateId || ring.status !== first.status
          || ring.candidatePlateIds.join("\u001f") !== first.candidatePlateIds.join("\u001f"));
      })
      || catalog.rings.some((ring) => !ring.ringId || !ring.polygonId || !ring.topologyId
        || !(["exterior", "hole"] as const).includes(ring.ringRole)
        || !(["instantaneous-owner", "ambiguous", "unknown"] as const).includes(ring.status)
        || ring.pointCount < 3
        || (ring.plateId !== null && !Number.isInteger(ring.plateId))
        || ring.candidatePlateIds.some((plateId) => !Number.isInteger(plateId))
        || new Set(Array.from({ length: ring.pointCount }, (_, point) => {
          const offset = (ring.pointOffset + point) * 3;
          return `${decoded.directions[offset]},${decoded.directions[offset + 1]},${decoded.directions[offset + 2]}`;
        })).size < 3)) {
    throw new Error("invalid Cao topology ownership catalog");
  }
  return decoded;
}
