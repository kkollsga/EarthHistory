import { validateMaterialLifecycle } from "./motion";
import { packageFrameIdentity, type PackageAsset } from "./identity";
import type { MotionPaletteCatalog } from "./palette";
import type { FrameKey, MaterialLifecycle, SurfaceEvidenceState } from "./types";

export interface ReconstructionAgeDomain {
  readonly youngest: number;
  readonly oldest: number;
}

export interface MotionPaletteAsset {
  readonly id: string;
  readonly catalog: PackageAsset;
  readonly binary: PackageAsset;
}

export interface ReconstructionPackageManifestV2 {
  readonly schemaVersion: 2;
  readonly packageId: string;
  readonly revision: string;
  readonly frame: FrameKey;
  readonly ageDomainMa: ReconstructionAgeDomain;
  readonly core: PackageAsset;
  readonly motionPalette: MotionPaletteAsset;
  readonly checkpoints: readonly (PackageAsset & { readonly ageMa: number; readonly transitiveBytes: number })[];
}

export type MaterialChartRole = "model-geography" | "country-reference" | "poi-anchor" | "focus-anchor";

export interface MaterialChartEvidence {
  readonly status: "model-output" | "derived-overlay" | "unknown";
  readonly sourceIds: readonly string[];
  readonly limitations: readonly string[];
}

export interface RigidMaterialChartV2 {
  readonly kind: "rigid";
  readonly role: MaterialChartRole;
  readonly chartId: string;
  readonly chartRevision: string;
  readonly materialId: string;
  readonly fragmentOrCohortId: string;
  readonly lifecycle: MaterialLifecycle;
  readonly geometryReferenceAgeMa: number;
  /** Singular form is retained only for the bounded two-age integration package. */
  readonly motionBinding?: { readonly paletteId: string; readonly entryId: string };
  readonly motionBindings?: readonly { readonly paletteId: string; readonly entryId: string;
    readonly validTimeMa: { readonly youngest: number; readonly oldest: number } }[];
  readonly sourceFeatureIds: readonly string[];
  readonly sourceFeatureTypes: readonly string[];
  readonly evidence: MaterialChartEvidence;
  readonly surfaceEvidence: SurfaceEvidenceState;
}

export interface ReconstructionSpatialBatchV2 {
  readonly batchId: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly geometryAsset: PackageAsset;
  readonly encoding: "ehgb-v2-f32xyz-u32";
}

/** Static fragmented modern-reference linework. Vertices use the same chart/palette authority as land. */
export interface ReconstructionLineBatchV2 {
  readonly batchId: string;
  readonly vertexCount: number;
  readonly segmentCount: number;
  readonly geometryAsset: PackageAsset;
  readonly encoding: "ehgl-v2-f32xyz-u32";
}

export interface ReconstructionCoreV2 {
  readonly schemaVersion: 2;
  readonly packageId: string;
  readonly revision: string;
  readonly frame: FrameKey;
  readonly charts: readonly RigidMaterialChartV2[];
  readonly spatialBatches: readonly ReconstructionSpatialBatchV2[];
  readonly lineBatches?: readonly ReconstructionLineBatchV2[];
  readonly anchorCatalog?: PackageAsset;
}

export interface ReconstructionAnchorV2 {
  readonly anchorId: string;
  readonly role: "poi-anchor" | "focus-anchor";
  readonly chartId: string;
  readonly chartRevision: string;
  readonly directionAtReference: readonly [number, number, number];
  readonly validTimeMa: { readonly youngest: number; readonly oldest: number };
  readonly coordinateUncertaintyKm: number;
  readonly sourceIds: readonly string[];
  readonly limitations: readonly string[];
}

export interface ReconstructionAnchorCatalogV2 {
  readonly schemaVersion: 2;
  readonly packageId: string;
  readonly revision: string;
  readonly frame: FrameKey;
  readonly anchors: readonly ReconstructionAnchorV2[];
}

export interface SpatialBatchCheckpointControlV2 {
  readonly batchId: string;
  readonly vertexCount: number;
  readonly state:
    | { readonly kind: "uniform"; readonly displayHeightMetres: number;
        readonly baseColorRgb: readonly [number, number, number] }
    | { readonly kind: "asset"; readonly asset: PackageAsset;
        readonly encoding: "ehgc-v2-f32height-u8rgb" };
}

export interface ReconstructionCheckpointV2 {
  readonly schemaVersion: 2;
  readonly packageId: string;
  readonly revision: string;
  readonly frame: FrameKey;
  readonly ageMa: number;
  readonly batchControls: readonly SpatialBatchCheckpointControlV2[];
  readonly nativeBoundaryLayer?: NativeLayerAssets;
  readonly topologyOwnershipLayer?: NativeLayerAssets;
}

export interface NativeLayerAssets {
  readonly sourceAgeMa: number;
  readonly catalog: PackageAsset;
  readonly binary: PackageAsset;
}

const SHA256 = /^[a-f0-9]{64}$/;
function assetValid(asset: PackageAsset): boolean {
  return Boolean(asset.url) && Number.isSafeInteger(asset.bytes) && asset.bytes > 0 && SHA256.test(asset.sha256);
}
function ageValid(ageMa: number, domain: ReconstructionAgeDomain): boolean {
  return Number.isFinite(ageMa) && ageMa >= domain.youngest && ageMa <= domain.oldest;
}
function unit(direction: readonly number[]): boolean {
  return direction.length === 3 && direction.every(Number.isFinite) && Math.abs(Math.hypot(...direction) - 1) <= 2e-6;
}

export function validateReconstructionPackageManifestV2(manifest: ReconstructionPackageManifestV2): void {
  const domain = manifest.ageDomainMa;
  if (manifest.schemaVersion !== 2 || !manifest.packageId || !manifest.revision
      || !Number.isFinite(domain.youngest) || !Number.isFinite(domain.oldest)
      || domain.youngest < 0 || domain.oldest > 1_800 || domain.youngest > domain.oldest
      || !manifest.motionPalette.id || !assetValid(manifest.core)
      || !assetValid(manifest.motionPalette.catalog) || !assetValid(manifest.motionPalette.binary)
      || manifest.checkpoints.length < 2 || !manifest.frame.modelId || !manifest.frame.modelVersion
      || !manifest.frame.absoluteFrameId || !Number.isInteger(manifest.frame.anchorPlateId)
      || !SHA256.test(manifest.frame.rotationSha256) || !SHA256.test(manifest.frame.topologySha256)) {
    throw new Error("invalid Cao reconstruction package manifest v2");
  }
  let previous = -Infinity;
  for (const checkpoint of manifest.checkpoints) {
    if (!ageValid(checkpoint.ageMa, domain) || checkpoint.ageMa <= previous || !assetValid(checkpoint)
        || !Number.isSafeInteger(checkpoint.transitiveBytes) || checkpoint.transitiveBytes < checkpoint.bytes
        || checkpoint.transitiveBytes > 32 * 1024 * 1024) {
      throw new Error("invalid Cao reconstruction checkpoint asset");
    }
    previous = checkpoint.ageMa;
  }
}

export function immutableReconstructionPackageManifestV2(
  manifest: ReconstructionPackageManifestV2,
): ReconstructionPackageManifestV2 {
  validateReconstructionPackageManifestV2(manifest);
  const copy = structuredClone(manifest);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}

export function validateReconstructionCoreV2(
  core: ReconstructionCoreV2,
  manifest: ReconstructionPackageManifestV2,
  palette: MotionPaletteCatalog,
): void {
  if (core.schemaVersion !== 2 || core.packageId !== manifest.packageId || core.revision !== manifest.revision
      || packageFrameIdentity(core.frame) !== packageFrameIdentity(manifest.frame) || core.charts.length === 0
      || core.spatialBatches.length === 0
      || (core.anchorCatalog !== undefined && !assetValid(core.anchorCatalog))
      || palette.id !== manifest.motionPalette.id || palette.packageId !== manifest.packageId
      || palette.revision !== manifest.revision
      || packageFrameIdentity(palette.frame) !== packageFrameIdentity(manifest.frame)) {
    throw new Error("mixed Cao reconstruction core, palette, or package identity");
  }
  const entries = new Map(palette.entries.map((entry) => [entry.entryId, entry]));
  const chartIds = new Set<string>();
  for (const chart of core.charts) {
    const bindings = chart.motionBindings ?? (chart.motionBinding ? [{ ...chart.motionBinding,
      validTimeMa: chart.lifecycle.validTimeMa }] : []);
    const boundEntries = bindings.map((binding) => entries.get(binding.entryId));
    if (!chart.chartId || chartIds.has(chart.chartId) || !chart.chartRevision || !chart.materialId
        || !chart.fragmentOrCohortId || !chart.sourceFeatureIds.length || !chart.sourceFeatureTypes.length
        || !chart.evidence.sourceIds.length || !validateMaterialLifecycle(chart.lifecycle)
        || bindings.length === 0 || (chart.motionBinding !== undefined && chart.motionBindings !== undefined)
        || bindings.some((binding, index) => binding.paletteId !== palette.id || !boundEntries[index]
          || binding.validTimeMa.youngest < boundEntries[index]!.youngestAgeMa
          || binding.validTimeMa.oldest > boundEntries[index]!.oldestAgeMa
          || binding.validTimeMa.youngest > binding.validTimeMa.oldest
          || chart.geometryReferenceAgeMa !== boundEntries[index]!.storedCoordinateBasis.geometryReferenceAgeMa)
        || bindings.some((binding, index) => bindings.slice(index + 1).some((other) =>
          Math.max(binding.validTimeMa.youngest, other.validTimeMa.youngest)
            < Math.min(binding.validTimeMa.oldest, other.validTimeMa.oldest)))) {
      throw new Error("invalid Cao rigid material chart binding");
    }
    chartIds.add(chart.chartId);
  }
  const batchIds = new Set<string>();
  for (const batch of core.spatialBatches) {
    const expectedBytes = 32 + batch.vertexCount * 20 + batch.triangleCount * 12;
    if (!batch.batchId || batchIds.has(batch.batchId) || !Number.isSafeInteger(batch.vertexCount)
        || batch.vertexCount < 3 || !Number.isSafeInteger(batch.triangleCount) || batch.triangleCount < 1
        || batch.encoding !== "ehgb-v2-f32xyz-u32" || !assetValid(batch.geometryAsset)
        || expectedBytes !== batch.geometryAsset.bytes || batch.geometryAsset.bytes > 8 * 1024 * 1024) {
      throw new Error("invalid Cao reconstruction spatial batch");
    }
    batchIds.add(batch.batchId);
  }
  for (const batch of core.lineBatches ?? []) {
    const expectedBytes = 32 + batch.vertexCount * 16 + batch.segmentCount * 8;
    if (!batch.batchId || batchIds.has(batch.batchId) || !Number.isSafeInteger(batch.vertexCount)
        || batch.vertexCount < 2 || !Number.isSafeInteger(batch.segmentCount) || batch.segmentCount < 1
        || batch.encoding !== "ehgl-v2-f32xyz-u32" || !assetValid(batch.geometryAsset)
        || expectedBytes !== batch.geometryAsset.bytes || batch.geometryAsset.bytes > 8 * 1024 * 1024) {
      throw new Error("invalid Cao reconstruction line batch");
    }
    batchIds.add(batch.batchId);
  }
}

export function validateReconstructionAnchorCatalogV2(
  catalog: ReconstructionAnchorCatalogV2,
  manifest: ReconstructionPackageManifestV2,
  core: ReconstructionCoreV2,
): void {
  const charts = new Map(core.charts.map((chart) => [chart.chartId, chart]));
  const ids = new Set<string>();
  if (catalog.schemaVersion !== 2 || catalog.packageId !== manifest.packageId || catalog.revision !== manifest.revision
      || packageFrameIdentity(catalog.frame) !== packageFrameIdentity(manifest.frame)) {
    throw new Error("invalid Cao reconstruction anchor catalog");
  }
  for (const anchor of catalog.anchors) {
    const chart = charts.get(anchor.chartId);
    if (!anchor.anchorId || ids.has(anchor.anchorId) || !chart || chart.chartRevision !== anchor.chartRevision
        || !(["poi-anchor", "focus-anchor"] as const).includes(anchor.role)
        || !unit(anchor.directionAtReference) || !Number.isFinite(anchor.validTimeMa.youngest)
        || !Number.isFinite(anchor.validTimeMa.oldest) || anchor.validTimeMa.youngest > anchor.validTimeMa.oldest
        || anchor.validTimeMa.youngest < chart.lifecycle.validTimeMa.youngest
        || anchor.validTimeMa.oldest > chart.lifecycle.validTimeMa.oldest
        || !Number.isFinite(anchor.coordinateUncertaintyKm) || anchor.coordinateUncertaintyKm < 0
        || anchor.sourceIds.length === 0) {
      throw new Error("invalid Cao reconstruction anchor");
    }
    ids.add(anchor.anchorId);
  }
}

export function validateReconstructionCheckpointV2(
  checkpoint: ReconstructionCheckpointV2,
  manifest: ReconstructionPackageManifestV2,
  core: ReconstructionCoreV2,
): void {
  if (checkpoint.schemaVersion !== 2 || checkpoint.packageId !== manifest.packageId
      || checkpoint.revision !== manifest.revision
      || packageFrameIdentity(checkpoint.frame) !== packageFrameIdentity(manifest.frame)
      || !ageValid(checkpoint.ageMa, manifest.ageDomainMa)
      || [checkpoint.nativeBoundaryLayer, checkpoint.topologyOwnershipLayer].some((layer) => layer !== undefined
        && (layer.sourceAgeMa !== checkpoint.ageMa || !assetValid(layer.catalog) || !assetValid(layer.binary)))) {
    throw new Error("mixed Cao reconstruction checkpoint identity");
  }
  const controls = new Map(checkpoint.batchControls.map((control) => [control.batchId, control]));
  if (controls.size !== checkpoint.batchControls.length || controls.size !== core.spatialBatches.length) {
    throw new Error("Cao checkpoint spatial-batch coverage mismatch");
  }
  for (const batch of core.spatialBatches) {
    const control = controls.get(batch.batchId);
    const expectedBytes = 32 + batch.vertexCount * 7;
    if (!control || control.vertexCount !== batch.vertexCount
        || (control.state.kind === "uniform"
          ? (!Number.isFinite(control.state.displayHeightMetres)
            || control.state.baseColorRgb.some((value) => !Number.isFinite(value) || value < 0 || value > 1))
          : (control.state.encoding !== "ehgc-v2-f32height-u8rgb" || !assetValid(control.state.asset)
            || control.state.asset.bytes !== expectedBytes || control.state.asset.bytes > 8 * 1024 * 1024))) {
      throw new Error("invalid Cao checkpoint spatial-batch control");
    }
  }
}
