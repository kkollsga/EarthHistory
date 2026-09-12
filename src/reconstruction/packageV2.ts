import { validateMaterialLifecycle } from "./motion";
import { packageFrameIdentity, type PackageAsset } from "./identity";
import type { MotionPaletteCatalog } from "./palette";
import type { FrameKey, MaterialLifecycle, SurfaceEvidenceState } from "./types";

const CAO_COAST_SOURCE_SHA256 = "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f";

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
  readonly materialCorrections?: { readonly id: string; readonly catalog: PackageAsset };
}

export type MaterialChartRole = "model-geography" | "country-reference" | "poi-anchor" | "focus-anchor";

export interface MaterialChartEvidence {
  readonly status: "model-output" | "derived-overlay" | "unknown";
  readonly sourceIds: readonly string[];
  readonly limitations: readonly string[];
  readonly correction?: {
    readonly correctionId: string;
    readonly phase: "source-qualified-material" | "uncertain-continuation" | "formation-uncertain";
    readonly materialStatus?: "supported" | "native-source-supported-age-unknown" | "formation-uncertain";
    readonly poseStatus?: "source-qualified" | "model-inference" | "native-target-only" | "uncertain-continuation";
    readonly materialOriginRangeMa?: readonly [number, number];
  };
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
  readonly staticDisplayControl?: {
    readonly displayHeightMetres: number;
    readonly baseColorRgb: readonly [number, number, number];
  };
  readonly overlapPolicy?: "native-visual-and-picking-precedence";
}

export interface MaterialCorrectionCatalogV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly version: string;
  readonly baseline: {
    readonly packageId: string;
    readonly revision: string;
    readonly coreSha256: string;
    readonly motionPaletteId: string;
    readonly frame: FrameKey;
  };
  readonly correctionIds: readonly string[];
  readonly nativeChartOverrides?: readonly NativeChartOverrideV1[];
  readonly alignmentWitnesses: readonly {
    readonly witnessId: string;
    readonly correctionId: string;
    readonly chartId: string;
    readonly referenceAgeMa: number;
    readonly referenceLonLat: readonly [number, number];
    readonly normalizedDirectionAtZero: readonly [number, number, number];
    readonly expectedDirectionAt411Ma: readonly [number, number, number];
    readonly posePlateId: number;
    readonly targetPlateId: number;
    readonly normalizationAngularDegrees: number;
    readonly targetPoseResidualAt411Degrees: number;
    readonly paletteTargetResidualAt411Degrees: number;
    readonly oracle: "tracked-pygplates-target-plate-witness";
  }[];
  readonly charts: readonly RigidMaterialChartV2[];
  readonly spatialBatches: readonly ReconstructionSpatialBatchV2[];
}

export interface NativeChartOverrideV1 {
  readonly overrideId: string;
  readonly operation: "domain-fragment-replacement";
  readonly correctionId: string;
  readonly nativeTarget: {
    readonly patchId: string;
    readonly sourceCollection: "shapes_coasts.gpmlz";
    readonly sourceCollectionSha256: string;
    readonly sourceFeatureId: string;
    readonly sourceFeatureOrder: number;
    readonly geometryOrder: number;
    readonly geometrySha256: string;
    readonly plateId: number;
  };
  readonly nativeChart: {
    readonly chartId: string;
    readonly chartRevision: string;
    readonly materialId: string;
    readonly fragmentOrCohortId: string;
  };
  readonly suppression: MaterialLifecycle;
  readonly replacementAssetSha256: string;
  readonly replacementChartIds: readonly string[];
  readonly dependentConsumers: {
    readonly countryReferences: "spatial-segment-remap";
    readonly sourceCountryChartIds: readonly string[];
    readonly maximumSegmentSampleDegrees: number;
    readonly maximumDomainMatchKm: number;
    readonly expectedSourceSegmentCount: number;
    readonly countrySegmentBindings: readonly Readonly<{
      readonly batchId: string;
      readonly segmentIndex: number;
      readonly sourceCountryChartId: string;
      readonly domainFragmentOrCohortIds: readonly string[];
      readonly maximumMatchKm: number;
    }>[];
    readonly anchors: "require-none";
  };
  readonly sourceIds: readonly string[];
  readonly reason: string;
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
      || !SHA256.test(manifest.frame.rotationSha256) || !SHA256.test(manifest.frame.topologySha256)
      || (manifest.materialCorrections !== undefined
        && (!manifest.materialCorrections.id || !assetValid(manifest.materialCorrections.catalog)))) {
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

export function validateMaterialCorrectionCatalogV1(
  catalog: MaterialCorrectionCatalogV1,
  manifest: ReconstructionPackageManifestV2,
  nativeCore?: ReconstructionCoreV2,
): void {
  if (catalog.schemaVersion !== 1 || !catalog.id || !catalog.version || catalog.correctionIds.length === 0
      || new Set(catalog.correctionIds).size !== catalog.correctionIds.length
      || manifest.materialCorrections?.id !== catalog.id
      || catalog.baseline.packageId !== manifest.packageId || catalog.baseline.revision !== manifest.revision
      || catalog.baseline.coreSha256 !== manifest.core.sha256
      || catalog.baseline.motionPaletteId !== manifest.motionPalette.id
      || packageFrameIdentity(catalog.baseline.frame) !== packageFrameIdentity(manifest.frame)
      || catalog.charts.length === 0 || catalog.spatialBatches.length === 0) {
    throw new Error("invalid material correction catalog identity");
  }
  for (const chart of catalog.charts) {
    const correction = chart.evidence.correction;
    const phase = correction?.phase;
    const lifecycle = chart.lifecycle.validTimeMa;
    const phaseBoundsValid = phase === "formation-uncertain"
      ? lifecycle.oldest > lifecycle.youngest
        && chart.lifecycle.youngestExclusive === true
        && correction?.materialStatus === "formation-uncertain"
        && correction.materialOriginRangeMa?.length === 2
        && correction.materialOriginRangeMa[0] >= correction.materialOriginRangeMa[1]
      : phase === "source-qualified-material"
      ? (lifecycle.youngest === 410 && lifecycle.oldest > 410 && lifecycle.oldest <= 540)
        || (["supported", "native-source-supported-age-unknown"].includes(correction?.materialStatus ?? "")
          && lifecycle.youngest >= 0
          && lifecycle.oldest <= 540)
      : phase === "uncertain-continuation"
        ? lifecycle.youngest > 410 && lifecycle.oldest === 540
        : false;
    if (chart.role !== "model-geography" || chart.evidence.status !== "derived-overlay"
        || !correction || !catalog.correctionIds.includes(correction.correctionId)
        || !phaseBoundsValid
        || chart.surfaceEvidence.kind !== "unknown"
        || (phase !== "source-qualified-material" && chart.lifecycle.youngestExclusive !== true)
        || (phase === "source-qualified-material"
          && !["supported", "native-source-supported-age-unknown"].includes(correction.materialStatus ?? "")
          && chart.lifecycle.youngestExclusive !== true)
        || chart.geometryReferenceAgeMa !== 0
        || chart.sourceFeatureTypes.length !== 1
        || !["EarthHistorySourceQualifiedMaterialCorrection", "EarthHistoryDomainFragmentReplacement"]
          .includes(chart.sourceFeatureTypes[0]!)) {
      throw new Error("invalid derived material correction chart");
    }
  }
  const overrides = catalog.nativeChartOverrides ?? [];
  const overrideIds = new Set<string>();
  const overriddenCharts = new Set<string>();
  for (const override of overrides) {
    const target = override.nativeTarget;
    const chart = override.nativeChart;
    const match = nativeCore?.charts.filter((candidate) => candidate.chartId === chart.chartId) ?? [];
    const sourceOrder = Number(target.patchId.split(":").at(-2));
    const geometryOrder = Number(target.patchId.split(":").at(-1));
    const validReplacementCharts = override.replacementChartIds.length > 0
      && override.replacementChartIds.every((chartId) => catalog.charts.some((candidate) => candidate.chartId === chartId));
    const suppression = override.suppression.validTimeMa;
    const nativeBinding = match[0]?.motionBindings?.find((binding) =>
      binding.validTimeMa.youngest <= suppression.youngest
      && binding.validTimeMa.oldest >= suppression.oldest);
    const sourceCountryCharts = override.dependentConsumers?.sourceCountryChartIds.map((chartId) =>
      nativeCore?.charts.find((candidate) => candidate.chartId === chartId));
    const sourceCountryChartsValid = Boolean(sourceCountryCharts?.length)
      && new Set(override.dependentConsumers.sourceCountryChartIds).size
        === override.dependentConsumers.sourceCountryChartIds.length
      && sourceCountryCharts!.every((candidate) => candidate?.role === "country-reference"
        && candidate.sourceFeatureIds.includes(target.sourceFeatureId)
        && candidate.motionBindings?.some((binding) => binding.paletteId === nativeBinding?.paletteId
          && binding.entryId === nativeBinding.entryId
          && binding.validTimeMa.youngest <= suppression.youngest
          && binding.validTimeMa.oldest >= suppression.oldest));
    const replacementBindingsValid = override.replacementChartIds.every((chartId) => {
      const candidate = catalog.charts.find((chart_) => chart_.chartId === chartId);
      return candidate?.motionBindings?.some((binding) => binding.paletteId === nativeBinding?.paletteId
        && binding.entryId === nativeBinding.entryId
        && binding.validTimeMa.youngest <= candidate.lifecycle.validTimeMa.youngest
        && binding.validTimeMa.oldest >= candidate.lifecycle.validTimeMa.oldest);
    });
    const replacementFragments = new Set(override.replacementChartIds.map((chartId) =>
      catalog.charts.find((candidate) => candidate.chartId === chartId)?.fragmentOrCohortId));
    const segmentBindings = override.dependentConsumers?.countrySegmentBindings ?? [];
    const segmentBindingsValid = segmentBindings.length === override.dependentConsumers?.expectedSourceSegmentCount
      && new Set(segmentBindings.map((binding) => `${binding.batchId}:${binding.segmentIndex}`)).size
        === segmentBindings.length
      && segmentBindings.every((binding) => binding.batchId && Number.isSafeInteger(binding.segmentIndex)
        && binding.segmentIndex >= 0
        && override.dependentConsumers.sourceCountryChartIds.includes(binding.sourceCountryChartId)
        && binding.domainFragmentOrCohortIds.length > 0
        && binding.domainFragmentOrCohortIds.every((fragmentId) => replacementFragments.has(fragmentId))
        && Number.isFinite(binding.maximumMatchKm) && binding.maximumMatchKm >= 0
        && binding.maximumMatchKm <= override.dependentConsumers.maximumDomainMatchKm);
    if (!override.overrideId || overrideIds.has(override.overrideId)
        || override.operation !== "domain-fragment-replacement"
        || !catalog.correctionIds.includes(override.correctionId)
        || overriddenCharts.has(chart.chartId) || match.length !== 1
        || match[0]!.chartRevision !== chart.chartRevision || match[0]!.materialId !== chart.materialId
        || match[0]!.fragmentOrCohortId !== chart.fragmentOrCohortId
        || target.patchId !== chart.chartId || target.sourceCollection !== "shapes_coasts.gpmlz"
        || target.sourceCollectionSha256 !== CAO_COAST_SOURCE_SHA256
        || target.sourceFeatureId !== match[0]!.sourceFeatureIds[0]
        || target.sourceFeatureOrder !== sourceOrder || target.geometryOrder !== geometryOrder
        || !Number.isInteger(target.plateId) || !/^[a-f0-9]{64}$/.test(target.geometrySha256)
        || !/^[a-f0-9]{64}$/.test(override.replacementAssetSha256)
        || !validateMaterialLifecycle(override.suppression)
        || override.suppression.validTimeMa.youngest < match[0]!.lifecycle.validTimeMa.youngest
        || override.suppression.validTimeMa.oldest > match[0]!.lifecycle.validTimeMa.oldest
        || !validReplacementCharts
        || override.dependentConsumers?.countryReferences !== "spatial-segment-remap"
        || override.dependentConsumers?.anchors !== "require-none"
        || override.dependentConsumers?.maximumSegmentSampleDegrees !== 0.1
        || override.dependentConsumers?.maximumDomainMatchKm !== 12
        || !Number.isSafeInteger(override.dependentConsumers?.expectedSourceSegmentCount)
        || override.dependentConsumers.expectedSourceSegmentCount < 1
        || !sourceCountryChartsValid || !replacementBindingsValid || !segmentBindingsValid || !nativeBinding
        || override.sourceIds.length === 0 || !override.reason) {
      throw new Error("invalid native material chart override");
    }
    overrideIds.add(override.overrideId);
    overriddenCharts.add(chart.chartId);
  }
  for (const witness of catalog.alignmentWitnesses) {
    if (!witness.witnessId || !catalog.correctionIds.includes(witness.correctionId)
        || !catalog.charts.some((chart) => chart.chartId === witness.chartId)
        || witness.referenceAgeMa !== 410 || witness.normalizationAngularDegrees < 1
        || witness.targetPoseResidualAt411Degrees > 1e-5
        || witness.paletteTargetResidualAt411Degrees > 1e-5
        || witness.oracle !== "tracked-pygplates-target-plate-witness"
        || !unit(witness.normalizedDirectionAtZero)
        || !unit(witness.expectedDirectionAt411Ma) || witness.referenceLonLat.length !== 2
        || !witness.referenceLonLat.every(Number.isFinite)
        || !Number.isInteger(witness.posePlateId) || !Number.isInteger(witness.targetPlateId)) {
      throw new Error("invalid material correction alignment witness");
    }
  }
  for (const batch of catalog.spatialBatches) {
    const control = batch.staticDisplayControl;
    if (!control || control.displayHeightMetres !== 0
        || control.baseColorRgb.length !== 3 || control.baseColorRgb.some((value) => !Number.isFinite(value)
          || value < 0 || value > 1)
        || batch.overlapPolicy !== "native-visual-and-picking-precedence") {
      throw new Error("material correction batch lacks a valid static display control");
    }
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
  const dynamicBatches = core.spatialBatches.filter((batch) => batch.staticDisplayControl === undefined);
  if (controls.size !== checkpoint.batchControls.length || controls.size !== dynamicBatches.length) {
    throw new Error("Cao checkpoint spatial-batch coverage mismatch");
  }
  for (const batch of dynamicBatches) {
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
