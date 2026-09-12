import type { MaterialAddress, MaterialPose, SupportState } from "./types";
import type { MaterialChartEvidence, MaterialChartRole } from "./packageV2";
import type { QuaternionWxyz } from "./arithmetic";
import type { NativeBoundarySegmentV2, PreparedNativeLayer, TopologyOwnershipRingV2 } from "./nativeLayersV2";

/** q-younger wxyz, q-older wxyz, motion fraction, activation younger/older. */
export const PREPARED_MOTION_PALETTE_STRIDE = 11;

export interface PreparedCaoMotionPalette {
  readonly stride: typeof PREPARED_MOTION_PALETTE_STRIDE;
  readonly entryCount: number;
  /** Identity-bearing storage remains lease-owned; callers receive a copy. */
  createValuesCopy(): Float32Array;
}

export interface PreparedCaoStaticGeometryCopy {
  readonly referenceDirections: Float32Array;
  readonly indices: Uint32Array;
  readonly seamIds: Uint32Array;
  readonly preparedEntryIndices: Uint16Array | Uint32Array;
  readonly materialChartIndices: Uint16Array | Uint32Array;
}

export interface PreparedCaoDisplayControlsCopy {
  readonly displayHeightStart: PreparedScalarChannel;
  readonly displayHeightEnd: PreparedScalarChannel;
  readonly baseColor: PreparedColorChannel;
}

export type PreparedScalarChannel =
  | { readonly kind: "uniform"; readonly value: number }
  | { readonly kind: "per-vertex"; readonly values: Float32Array };

export type PreparedColorChannel =
  | { readonly kind: "uniform"; readonly value: readonly [number, number, number] }
  | { readonly kind: "per-vertex"; readonly values: Float32Array };

export interface PreparedCaoSpatialBatch {
  readonly batchId: string;
  /** Stable across requested ages and suitable as a GPU-pool key. */
  readonly staticGeometryIdentity: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly staticGeometryBytes: number;
  readonly nativePrecedence: boolean;
  /** Contiguous source-index ranges used to build one reference-space BVH per material chart. */
  readonly chartTriangleRanges: readonly Readonly<{
    chartIndex: number;
    firstTriangle: number;
    triangleCount: number;
  }>[];
  createStaticGeometryCopy(): PreparedCaoStaticGeometryCopy;
  createDisplayControlsCopy(): PreparedCaoDisplayControlsCopy;
}

export interface PreparedCaoLineBatch {
  readonly batchId: string;
  readonly staticGeometryIdentity: string;
  readonly vertexCount: number;
  readonly segmentCount: number;
  readonly staticGeometryBytes: number;
  createStaticGeometryCopy(): Readonly<{
    referenceDirections: Float32Array;
    lineIndices: Uint32Array;
    preparedEntryIndices: Uint16Array | Uint32Array;
    materialChartIndices: Uint16Array | Uint32Array;
  }>;
}

export interface PreparedCaoChartIdentity {
  readonly chartId: string;
  readonly chartRevision: string;
  readonly materialId: string;
  readonly fragmentOrCohortId: string;
  readonly role: MaterialChartRole;
  readonly support: SupportState;
  readonly evidence: MaterialChartEvidence;
  /** Stored-coordinate basis to requested-frame pose, shared by GPU rendering and inverse picking. */
  readonly poseQuaternion: QuaternionWxyz;
  readonly inversePoseQuaternion: QuaternionWxyz;
}

export interface PreparedCaoRevision {
  readonly identity: string;
  readonly requestId: number;
  readonly packageId: string;
  readonly packageRevision: string;
  readonly materialCorrectionIdentity: string | null;
  readonly materialCorrections: Readonly<{
    qualifiedActiveCharts: number;
    uncertainActiveCharts: number;
    formationUncertainActiveCharts: number;
    modelInferredPoseActiveCharts: number;
    overriddenNativeCharts: number;
    activeSourceIds: readonly string[];
    correctionIds: readonly string[];
  }>;
  readonly requestedAgeMa: number;
  readonly frameIdentity: string;
  readonly display: Readonly<{
    youngerAgeMa: number;
    olderAgeMa: number;
    fraction: number;
  }>;
  readonly motionPalette: PreparedCaoMotionPalette;
  readonly batches: readonly PreparedCaoSpatialBatch[];
  readonly lineBatches: readonly PreparedCaoLineBatch[];
  readonly nativeBoundary: PreparedNativeLayer<Readonly<{
    segments: readonly NativeBoundarySegmentV2[];
    pointCount: number;
    sourceBytes: number;
    createDirectionsCopy(): Float32Array;
  }>>;
  readonly topologyOwnership: PreparedNativeLayer<Readonly<{
    rings: readonly TopologyOwnershipRingV2[];
    pointCount: number;
    sourceBytes: number;
    createDirectionsCopy(): Float32Array;
  }>>;
  readonly charts: readonly PreparedCaoChartIdentity[];
  readonly anchorIds: readonly string[];
  /** Source bytes directly referenced by this active revision; runtime cache residency is reported separately. */
  readonly activeSourceBytes: number;
  /** Bind an arbitrary point in a qualified rigid chart without nearest-particle snapping. */
  addressForChartDirection(chartIndex: number, directionAtReference: readonly [number, number, number]): MaterialAddress;
  /** Sparse focus/POI/picking query; GPU vertices continue to use the prepared palette. */
  resolveAddress(address: MaterialAddress): MaterialPose;
  resolveAnchor(anchorId: string): Readonly<{
    pose: MaterialPose;
    role: "poi-anchor" | "focus-anchor";
    coordinateUncertaintyKm: number;
    sourceIds: readonly string[];
    limitations: readonly string[];
  }> | null;
  release(): void;
}
