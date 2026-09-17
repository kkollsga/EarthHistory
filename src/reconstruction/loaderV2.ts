import { loadVerifiedBytes, type StaticAssetFetchOptions, type StaticAssetFetcher } from "./assetLoader";
import { expandInternedPackageDocument } from "./packageIntern";
import { decodeMotionPalette, selectPaletteMotionSubsegment, type MotionPaletteCatalog,
  type PreparedPaletteEntry } from "./palette";
import { evaluateLifecycleSupport } from "./motion";
import {
  decodePalaeoCoastlineClassCatalog,
  selectPalaeoCatalogInterval,
  validatePalaeoRingPayloadAgainstCatalog,
  type PalaeoCoastlineClassCatalog,
  type PalaeoCoastlineIntervalRecord,
  type PalaeoCoastlinePayloadRecord,
  type PalaeoRingPayloadMetadata,
  type PalaeoSurfaceClass,
} from "./palaeoRings";
import type { PalaeoTriangulationRunner, PreparedPalaeoIntervalGeometry } from "./palaeoTriangulate";
import type { PackageAsset } from "./identity";
import {
  validateReconstructionCheckpointV2,
  validateReconstructionAnchorCatalogV2,
  validateReconstructionCoreV2,
  validateReconstructionPackageManifestV2,
  validateMaterialCorrectionCatalogV1,
  type MaterialCorrectionCatalogV1,
  type ReconstructionCheckpointV2,
  type ReconstructionCoreV2,
  type ReconstructionAnchorCatalogV2,
  type PalaeoCoastlineAssets,
  type RealisticSurfaceBatchV2,
  type ReconstructionPackageManifestV2,
} from "./packageV2";
import { decodeCaoBatchState, decodeCaoLineBatch, decodeCaoSpatialBatch, type DecodedCaoBatchState,
  type DecodedCaoLineBatch, type DecodedCaoSpatialBatch } from "./spatialV2";
import { validateAndDecodeNativeBoundaryLayer, validateAndDecodeTopologyOwnershipLayer,
  type DecodedNativePointAsset, type NativeBoundaryCatalogV2, type TopologyOwnershipCatalogV2 } from "./nativeLayersV2";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

async function verifiedJson<T>(
  asset: { readonly url: string; readonly bytes: number; readonly sha256: string },
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
  options?: StaticAssetFetchOptions,
): Promise<T> {
  const bytes = await loadVerifiedBytes(asset, fetcher, signal, options);
  // Interned package documents are expanded here, before any validator or
  // consumer sees them, so every check downstream reads the same chart, segment
  // and ring shape the package shipped before interning.
  return expandInternedPackageDocument(JSON.parse(new TextDecoder().decode(bytes))) as T;
}

export interface LoadedCaoFoundationMetadata {
  readonly core: ReconstructionCoreV2;
  readonly paletteCatalog: MotionPaletteCatalog;
  readonly nativeChartCount: number;
  readonly correctionCatalog: MaterialCorrectionCatalogV1 | null;
}

export interface LoadedCaoStaticFoundation extends LoadedCaoFoundationMetadata {
  readonly spatialBatches: ReadonlyMap<string, DecodedCaoSpatialBatch>;
  readonly lineBatches: ReadonlyMap<string, DecodedCaoLineBatch>;
  readonly anchorCatalog: ReconstructionAnchorCatalogV2 | null;
}

export interface LoadedCaoFoundation extends LoadedCaoStaticFoundation {
  readonly paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>;
}

function validateTouchingBindingPoses(
  core: ReconstructionCoreV2,
  paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>,
): void {
  for (const chart of core.charts) {
    const bindings = chart.motionBindings ?? [];
    for (let left = 0; left < bindings.length; left += 1) for (let right = left + 1; right < bindings.length; right += 1) {
      const first = bindings[left]!;
      const second = bindings[right]!;
      const touchingAge = Math.max(first.validTimeMa.youngest, second.validTimeMa.youngest);
      if (touchingAge !== Math.min(first.validTimeMa.oldest, second.validTimeMa.oldest)) continue;
      const firstEntry = paletteEntries.get(first.entryId);
      const secondEntry = paletteEntries.get(second.entryId);
      const firstSegment = firstEntry ? selectPaletteMotionSubsegment(firstEntry, touchingAge) : null;
      const secondSegment = secondEntry ? selectPaletteMotionSubsegment(secondEntry, touchingAge) : null;
      const endpoint = (segment: NonNullable<typeof firstSegment>) => segment.fraction === 0
        ? segment.younger.quaternion : segment.older.quaternion;
      const firstQuaternion = firstSegment ? endpoint(firstSegment) : null;
      const secondQuaternion = secondSegment ? endpoint(secondSegment) : null;
      const dot = firstQuaternion && secondQuaternion
        ? firstQuaternion.reduce((sum, value, axis) => sum + value * secondQuaternion[axis]!, 0) : 0;
      const normProduct = firstQuaternion && secondQuaternion
        ? Math.hypot(...firstQuaternion) * Math.hypot(...secondQuaternion) : 0;
      const angularResidual = firstQuaternion && secondQuaternion
        ? 2 * Math.acos(Math.max(-1, Math.min(1, Math.abs(dot) / normProduct))) : Number.POSITIVE_INFINITY;
      if (angularResidual > 1e-5) {
        throw new Error("touching Cao motion bindings disagree at their shared source knot");
      }
    }
  }
}

export function validateRequestedAgePaletteCoverage(
  core: ReconstructionCoreV2,
  paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>,
  requestedAgeMa: number,
): void {
  for (const chart of core.charts) {
    if (evaluateLifecycleSupport(chart.lifecycle, requestedAgeMa) !== null) continue;
    const bindings = chart.motionBindings ?? (chart.motionBinding ? [{ ...chart.motionBinding,
      validTimeMa: chart.lifecycle.validTimeMa }] : []);
    const selected = bindings.filter((binding) => requestedAgeMa >= binding.validTimeMa.youngest
      && requestedAgeMa <= binding.validTimeMa.oldest)
      .sort((left, right) => left.entryId.localeCompare(right.entryId))[0];
    if (!selected) continue;
    const entry = paletteEntries.get(selected.entryId);
    if (!entry || !selectPaletteMotionSubsegment(entry, requestedAgeMa)) {
      throw new Error("motion palette does not cover a selected Cao chart binding");
    }
  }
}

export async function loadVerifiedCaoFoundationMetadata(
  manifest: ReconstructionPackageManifestV2,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<LoadedCaoFoundationMetadata> {
  validateReconstructionPackageManifestV2(manifest);
  const [rawCore, rawCatalog, correctionCatalog] = await Promise.all([
    verifiedJson<ReconstructionCoreV2>(manifest.core, fetcher, signal),
    verifiedJson<MotionPaletteCatalog>(manifest.motionPalette.catalog, fetcher, signal),
    manifest.materialCorrections
      ? verifiedJson<MaterialCorrectionCatalogV1>(manifest.materialCorrections.catalog, fetcher, signal)
      : Promise.resolve(null),
  ]);
  if (signal?.aborted) throw new DOMException("Cao reconstruction foundation load aborted", "AbortError");
  if (rawCatalog.binary.bytes !== manifest.motionPalette.binary.bytes
      || rawCatalog.binary.sha256 !== manifest.motionPalette.binary.sha256) {
    throw new Error("Cao motion palette manifest/catalog binary mismatch");
  }
  validateReconstructionCoreV2(rawCore, manifest, rawCatalog);
  if (correctionCatalog) validateMaterialCorrectionCatalogV1(correctionCatalog, manifest, rawCore);
  const combinedCore: ReconstructionCoreV2 = correctionCatalog ? {
    ...rawCore,
    charts: [...rawCore.charts, ...correctionCatalog.charts],
    spatialBatches: [...rawCore.spatialBatches, ...correctionCatalog.spatialBatches],
  } : rawCore;
  validateReconstructionCoreV2(combinedCore, manifest, rawCatalog);
  return Object.freeze({ core: deepFreeze(combinedCore), paletteCatalog: deepFreeze(rawCatalog),
    nativeChartCount: rawCore.charts.length,
    correctionCatalog: correctionCatalog ? deepFreeze(correctionCatalog) : null });
}

export async function loadVerifiedCaoStaticFoundation(
  manifest: ReconstructionPackageManifestV2,
  metadata: LoadedCaoFoundationMetadata,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<LoadedCaoStaticFoundation> {
  const { core: combinedCore, correctionCatalog, nativeChartCount } = metadata;
  const correctionBatchIds = new Set(correctionCatalog?.spatialBatches.map((batch) => batch.batchId) ?? []);
  const spatialBatches = new Map<string, DecodedCaoSpatialBatch>();
  for (const batch of combinedCore.spatialBatches) {
    if (signal?.aborted) throw new DOMException("Cao reconstruction foundation load aborted", "AbortError");
    const decoded = await loadVerifiedCaoSpatialBatch(combinedCore, batch.batchId, fetcher, signal);
    if (correctionBatchIds.has(batch.batchId)
        && decoded.vertexChartIndices.some((chartIndex) => chartIndex < nativeChartCount)) {
      throw new Error("material correction batch cannot bind vertices to native Cao charts");
    }
    spatialBatches.set(batch.batchId, decoded);
  }
  const lineBatches = new Map<string, DecodedCaoLineBatch>();
  for (const batch of combinedCore.lineBatches ?? []) {
    if (signal?.aborted) throw new DOMException("Cao reconstruction foundation load aborted", "AbortError");
    const bytes = await loadVerifiedBytes(batch.geometryAsset, fetcher, signal);
    lineBatches.set(batch.batchId, decodeCaoLineBatch(bytes, batch.vertexCount, batch.segmentCount,
      combinedCore.charts.length));
  }
  const anchorCatalog = combinedCore.anchorCatalog
    ? await verifiedJson<ReconstructionAnchorCatalogV2>(combinedCore.anchorCatalog, fetcher, signal)
    : null;
  if (anchorCatalog) validateReconstructionAnchorCatalogV2(anchorCatalog, manifest, combinedCore);
  for (const override of correctionCatalog?.nativeChartOverrides ?? []) {
    const expectedSegments = new Set<string>();
    const sourceChartIndices = new Set(override.dependentConsumers.sourceCountryChartIds.map((chartId) =>
      combinedCore.charts.findIndex((chart) => chart.chartId === chartId)));
    for (const [batchId, batch] of lineBatches) {
      for (let offset = 0; offset < batch.lineIndices.length; offset += 2) {
        const left = batch.lineIndices[offset]!;
        const right = batch.lineIndices[offset + 1]!;
        if (sourceChartIndices.has(batch.vertexChartIndices[left]!)) {
          if (batch.vertexChartIndices[left] !== batch.vertexChartIndices[right]) {
            throw new Error("native replacement country segment crosses source ownership");
          }
          expectedSegments.add(`${batchId}:${offset / 2}`);
        }
      }
    }
    const declaredSegments = new Set(override.dependentConsumers.countrySegmentBindings.map((binding) => {
      const batch = lineBatches.get(binding.batchId);
      const sourceIndex = combinedCore.charts.findIndex((chart) => chart.chartId === binding.sourceCountryChartId);
      const left = batch?.lineIndices[binding.segmentIndex * 2];
      const right = batch?.lineIndices[binding.segmentIndex * 2 + 1];
      if (!batch || left === undefined || right === undefined
          || batch.vertexChartIndices[left] !== sourceIndex || batch.vertexChartIndices[right] !== sourceIndex) {
        throw new Error("native replacement country segment binding changed source ownership");
      }
      return `${binding.batchId}:${binding.segmentIndex}`;
    }));
    if (expectedSegments.size !== declaredSegments.size
        || [...expectedSegments].some((key) => !declaredSegments.has(key))) {
      throw new Error("native replacement country segment binding set is incomplete");
    }
    if (override.dependentConsumers.anchors === "require-none"
        && anchorCatalog?.anchors.some((anchor) => anchor.chartId === override.nativeChart.chartId)) {
      throw new Error("native material chart override has an unmapped POI or focus anchor");
    }
  }
  return Object.freeze({
    ...metadata,
    spatialBatches,
    lineBatches,
    anchorCatalog: anchorCatalog ? deepFreeze(anchorCatalog) : null,
    correctionCatalog: correctionCatalog ? deepFreeze(correctionCatalog) : null,
  });
}

function withPaletteEntries(
  foundation: LoadedCaoStaticFoundation,
  paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>,
): LoadedCaoFoundation {
  return Object.freeze({ ...foundation, paletteEntries });
}

/** Loads the fixed package/core/palette identity once; checkpoints remain age-demand loaded. */
export function loadVerifiedCaoFoundation(
  manifest: ReconstructionPackageManifestV2,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<LoadedCaoFoundation> {
  const metadata = loadVerifiedCaoFoundationMetadata(manifest, fetcher, signal);
  return metadata.then(async (loaded) => {
    const [foundation, paletteEntries] = await Promise.all([
      loadVerifiedCaoStaticFoundation(manifest, loaded, fetcher, signal),
      loadVerifiedCaoFullMotionPalette(manifest, loaded, fetcher, signal),
    ]);
    return withPaletteEntries(foundation, paletteEntries);
  });
}

/** Loads complete static geometry with only the verified motion window needed for one age. */
export function loadVerifiedCaoFoundationForAge(
  manifest: ReconstructionPackageManifestV2,
  requestedAgeMa: number,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<LoadedCaoFoundation> {
  const metadata = loadVerifiedCaoFoundationMetadata(manifest, fetcher, signal);
  return metadata.then(async (loaded) => {
    const [foundation, paletteEntries] = await Promise.all([
      loadVerifiedCaoStaticFoundation(manifest, loaded, fetcher, signal),
      loadVerifiedCaoFullMotionPalette(manifest, loaded, fetcher, signal),
    ]);
    validateRequestedAgePaletteCoverage(loaded.core, paletteEntries, requestedAgeMa);
    return withPaletteEntries(foundation, paletteEntries);
  });
}

/** Loads and validates the canonical all-age palette: the only motion path. */
export async function loadVerifiedCaoFullMotionPalette(
  manifest: ReconstructionPackageManifestV2,
  foundation: Pick<LoadedCaoFoundationMetadata, "core" | "paletteCatalog">,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
  options?: StaticAssetFetchOptions,
): Promise<ReadonlyMap<string, PreparedPaletteEntry>> {
  const buffer = await loadVerifiedBytes(manifest.motionPalette.binary, fetcher, signal, options);
  await options?.beforeDecode?.();
  if (signal?.aborted) throw new DOMException("reconstruction request aborted", "AbortError");
  const entries = decodeMotionPalette(foundation.paletteCatalog, buffer);
  validateTouchingBindingPoses(foundation.core, entries);
  return entries;
}

export type LoadedNativeLayer =
  | { readonly kind: "boundary"; readonly catalog: NativeBoundaryCatalogV2; readonly points: DecodedNativePointAsset }
  | { readonly kind: "ownership"; readonly catalog: TopologyOwnershipCatalogV2; readonly points: DecodedNativePointAsset };

export async function loadVerifiedCaoNativeLayer(
  manifest: ReconstructionPackageManifestV2,
  checkpoint: ReconstructionCheckpointV2,
  kind: "boundary" | "ownership",
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<LoadedNativeLayer | null> {
  const assets = kind === "boundary" ? checkpoint.nativeBoundaryLayer : checkpoint.topologyOwnershipLayer;
  if (!assets) return null;
  const [catalog, buffer] = await Promise.all([
    verifiedJson<NativeBoundaryCatalogV2 | TopologyOwnershipCatalogV2>(assets.catalog, fetcher, signal),
    loadVerifiedBytes(assets.binary, fetcher, signal),
  ]);
  const expected = { packageId: manifest.packageId, revision: manifest.revision, frame: manifest.frame,
    sourceAgeMa: assets.sourceAgeMa, binary: assets.binary };
  return kind === "boundary"
    ? Object.freeze({ kind, catalog: deepFreeze(catalog as NativeBoundaryCatalogV2),
      points: validateAndDecodeNativeBoundaryLayer(catalog as NativeBoundaryCatalogV2, buffer, expected) })
    : Object.freeze({ kind, catalog: deepFreeze(catalog as TopologyOwnershipCatalogV2),
      points: validateAndDecodeTopologyOwnershipLayer(catalog as TopologyOwnershipCatalogV2, buffer, expected) });
}

export async function loadVerifiedCaoCheckpoint(
  manifest: ReconstructionPackageManifestV2,
  core: ReconstructionCoreV2,
  ageMa: number,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
  options?: StaticAssetFetchOptions,
): Promise<ReconstructionCheckpointV2> {
  const asset = manifest.checkpoints.find((candidate) => candidate.ageMa === ageMa);
  if (!asset) throw new Error("Cao checkpoint absent from package manifest");
  const checkpoint = await verifiedJson<ReconstructionCheckpointV2>(asset, fetcher, signal, options);
  await options?.beforeDecode?.();
  if (signal?.aborted) throw new DOMException("reconstruction request aborted", "AbortError");
  validateReconstructionCheckpointV2(checkpoint, manifest, core);
  if (checkpoint.ageMa !== ageMa) throw new Error("Cao checkpoint age mismatch");
  const actualTransitiveBytes = asset.bytes + [checkpoint.nativeBoundaryLayer, checkpoint.topologyOwnershipLayer]
    .reduce((sum, layer) => sum + (layer?.catalog.bytes ?? 0) + (layer?.binary.bytes ?? 0), 0);
  if (actualTransitiveBytes !== asset.transitiveBytes) throw new Error("Cao checkpoint transitive byte ledger mismatch");
  return deepFreeze(checkpoint);
}

/** Verifies one checkpoint group into the HTTP cache without retaining decoded runtime state. */
export async function warmVerifiedCaoCheckpointAssets(
  manifest: ReconstructionPackageManifestV2,
  core: ReconstructionCoreV2,
  ageMa: number,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
  options?: StaticAssetFetchOptions,
): Promise<void> {
  const checkpoint = await loadVerifiedCaoCheckpoint(manifest, core, ageMa, fetcher, signal, options);
  const assets = [checkpoint.nativeBoundaryLayer, checkpoint.topologyOwnershipLayer]
    .flatMap((layer) => layer ? [layer.catalog, layer.binary] : []);
  await Promise.all(assets.map((asset) => loadVerifiedBytes(asset, fetcher, signal, options)));
  if (signal?.aborted) throw new DOMException("Cao checkpoint warming aborted", "AbortError");
}

interface PendingCheckpoint {
  readonly promise: Promise<LoadedCaoCheckpoint>;
  readonly controller: AbortController;
  consumers: number;
}

export interface LoadedCaoCheckpoint {
  readonly checkpoint: ReconstructionCheckpointV2;
  readonly boundary: LoadedNativeLayer | null;
  readonly ownership: LoadedNativeLayer | null;
}

/** Two resident and two unsettled checkpoint loads, including canceled fetchers that ignore abort. */
export class CaoCheckpointStore {
  private readonly resident = new Map<number, { value: LoadedCaoCheckpoint; used: number }>();
  private readonly pending = new Map<number, PendingCheckpoint>();
  private readonly waiters = new Set<{ resolve(): void; reject(error: unknown): void;
    signal?: AbortSignal; onAbort(): void }>();
  private clock = 0;
  private closed = false;

  constructor(private readonly manifest: ReconstructionPackageManifestV2,
    private readonly core: ReconstructionCoreV2, private readonly fetcher: StaticAssetFetcher) {}

  get ledger() {
    return Object.freeze({ residentCount: this.resident.size, pendingCount: this.pending.size,
      residentSourceBytes: [...this.resident.keys()].reduce((sum, age) => sum + this.assetBytes(age), 0),
      pendingReservedSourceBytes: [...this.pending.keys()].reduce((sum, age) => sum + this.assetBytes(age), 0),
      maximumResidentCount: 2, maximumPendingCount: 2 });
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.resident.clear();
    for (const record of this.pending.values()) record.controller.abort();
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      waiter.reject(new DOMException("Cao checkpoint store disposed", "AbortError"));
    }
  }

  async load(ageMa: number, signal?: AbortSignal): Promise<LoadedCaoCheckpoint> {
    if (this.closed) throw new Error("Cao checkpoint store disposed");
    if (signal?.aborted) throw new DOMException("Cao checkpoint request aborted", "AbortError");
    const cached = this.resident.get(ageMa);
    if (cached) { cached.used = ++this.clock; return cached.value; }
    let record = this.pending.get(ageMa);
    if (record?.controller.signal.aborted) {
      await this.waitForCapacity(signal);
      return this.load(ageMa, signal);
    }
    if (!record) {
      if (this.pending.size >= 2) {
        await this.waitForCapacity(signal);
        return this.load(ageMa, signal);
      }
      const controller = new AbortController();
      const created = {} as PendingCheckpoint;
      Object.assign(created, { controller, consumers: 0, promise: loadVerifiedCaoCheckpoint(
        this.manifest, this.core, ageMa, this.fetcher, controller.signal,
      ).then(async (checkpoint) => {
        const [boundary, ownership] = await Promise.all([
          loadVerifiedCaoNativeLayer(this.manifest, checkpoint, "boundary", this.fetcher, controller.signal),
          loadVerifiedCaoNativeLayer(this.manifest, checkpoint, "ownership", this.fetcher, controller.signal),
        ]);
        if (controller.signal.aborted || this.closed) throw new DOMException("Cao checkpoint load retired", "AbortError");
        const value = Object.freeze({ checkpoint, boundary, ownership });
        this.resident.set(ageMa, { value, used: ++this.clock });
        while (this.resident.size > 2) {
          const victim = [...this.resident].sort((left, right) => left[1].used - right[1].used)[0]!;
          this.resident.delete(victim[0]);
        }
        return value;
      }).finally(() => {
        if (this.pending.get(ageMa) === created) this.pending.delete(ageMa);
        this.notifyWaiter();
      }) });
      record = created;
      this.pending.set(ageMa, record);
    }
    record.consumers += 1;
    return new Promise((resolve, reject) => {
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;
        signal?.removeEventListener("abort", onAbort);
        record!.consumers -= 1;
      };
      const onAbort = () => {
        finish();
        if (record!.consumers === 0) record!.controller.abort();
        reject(new DOMException("Cao checkpoint request aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      record!.promise.then((value) => { if (!complete) { finish(); resolve(value); } },
        (error) => { if (!complete) { finish(); reject(error); } });
    });
  }

  private assetBytes(ageMa: number): number {
    const checkpointAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === ageMa);
    return checkpointAsset?.transitiveBytes ?? 0;
  }

  private async waitForCapacity(signal?: AbortSignal): Promise<void> {
    if (this.waiters.size >= 2) throw new Error("Cao checkpoint capacity waiter bound exceeded");
    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: () => {
        this.waiters.delete(waiter);
        reject(new DOMException("Cao checkpoint request aborted", "AbortError"));
      } };
      this.waiters.add(waiter);
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
    });
    if (this.closed) throw new Error("Cao checkpoint store disposed");
    if (signal?.aborted) throw new DOMException("Cao checkpoint request aborted", "AbortError");
  }

  private notifyWaiter(): void {
    const waiter = this.waiters.values().next().value;
    if (!waiter) return;
    this.waiters.delete(waiter);
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    waiter.resolve();
  }
}

export async function loadVerifiedCaoSpatialBatch(
  core: ReconstructionCoreV2,
  batchId: string,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<DecodedCaoSpatialBatch> {
  const batch = core.spatialBatches.find((candidate) => candidate.batchId === batchId);
  if (!batch) throw new Error("Cao spatial batch absent from core");
  const bytes = await loadVerifiedBytes(batch.geometryAsset, fetcher, signal);
  return decodeCaoSpatialBatch(bytes, batch.vertexCount, batch.triangleCount, core.charts.length);
}

export async function loadVerifiedCaoBatchState(
  checkpoint: ReconstructionCheckpointV2,
  batchId: string,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<DecodedCaoBatchState> {
  const control = checkpoint.batchControls.find((candidate) => candidate.batchId === batchId);
  if (!control) throw new Error("Cao batch state absent from checkpoint");
  if (control.state.kind !== "asset") throw new Error("Cao batch state is uniform and has no asset");
  const bytes = await loadVerifiedBytes(control.state.asset, fetcher, signal);
  return decodeCaoBatchState(bytes, control.vertexCount);
}

// ---------------------------------------------------------------------------
// palaeo-coastline map intervals
// ---------------------------------------------------------------------------

export interface LoadedPalaeoIntervalClass {
  readonly surfaceClass: PalaeoSurfaceClass;
  readonly catalog: PalaeoCoastlineClassCatalog;
  readonly record: PalaeoCoastlineIntervalRecord;
  readonly metadata: PalaeoRingPayloadMetadata;
  readonly geometry: PreparedPalaeoIntervalGeometry;
  readonly sourceBytes: number;
}

export interface LoadedPalaeoInterval {
  readonly intervalId: string;
  readonly intervalIndex: number;
  readonly fromAgeMa: number;
  readonly toAgeMa: number;
  readonly midAgeMa: number;
  /** One entry per compiled class, in the manifest's declared class order. */
  readonly classes: readonly LoadedPalaeoIntervalClass[];
  readonly sourceBytes: number;
}

export interface LoadedPalaeoClassCatalog {
  readonly surfaceClass: PalaeoSurfaceClass;
  readonly catalog: PalaeoCoastlineClassCatalog;
  readonly asset: PackageAsset;
}

/**
 * A payload file name is resolved beside its own catalog. The catalog records
 * bare file names, and the validator refuses a name carrying a path separator,
 * so a catalog cannot redirect a fetch out of its own published directory.
 */
export function palaeoPayloadAsset(
  catalogUrl: string,
  record: PalaeoCoastlinePayloadRecord,
): PackageAsset {
  const separator = catalogUrl.lastIndexOf("/");
  const directory = separator < 0 ? "" : catalogUrl.slice(0, separator + 1);
  return Object.freeze({ url: `${directory}${record.url}`, bytes: record.bytes, sha256: record.sha256 });
}

/** Loads and validates every declared class catalog once; payloads stay age-demand loaded. */
export async function loadVerifiedPalaeoClassCatalogs(
  palaeo: PalaeoCoastlineAssets,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<readonly LoadedPalaeoClassCatalog[]> {
  const loaded = await Promise.all(palaeo.classes.map(async (entry) => {
    const document = await verifiedJson<unknown>(entry.catalog, fetcher, signal);
    const catalog = decodePalaeoCoastlineClassCatalog(document, entry.surfaceClass);
    return Object.freeze({ surfaceClass: entry.surfaceClass, catalog: deepFreeze(catalog),
      asset: entry.catalog });
  }));
  if (signal?.aborted) throw new DOMException("palaeo-coastline catalog load aborted", "AbortError");
  // Every class must publish the same interval schedule, or a requested age
  // would draw land from one interval over a sea from another.
  const schedule = loaded[0]!.catalog.intervals.map((interval) => interval.intervalId).join("|");
  for (const entry of loaded) {
    if (entry.catalog.intervals.map((interval) => interval.intervalId).join("|") !== schedule) {
      throw new Error("palaeo-coastline classes publish different interval schedules");
    }
  }
  return Object.freeze(loaded);
}

/** The published interval covering an age, using the same `(TOAGE, FROMAGE]` rule as a piece. */
export function selectPalaeoIntervalForAge(
  catalogs: readonly LoadedPalaeoClassCatalog[],
  ageMa: number,
): PalaeoCoastlineIntervalRecord | null {
  return catalogs.length === 0 ? null : selectPalaeoCatalogInterval(catalogs[0]!.catalog, ageMa);
}

/**
 * The realistic-coast batch a class publishes for one map interval, or null when
 * the package declares no batch records at all. The batch record is the package
 * structure the loader resolves an interval through; the class catalog stays the
 * authority on the interned tables its pieces index into.
 */
export function realisticSurfaceBatchRecord(
  palaeo: PalaeoCoastlineAssets,
  surfaceClass: PalaeoSurfaceClass,
  intervalId: string,
): RealisticSurfaceBatchV2 | null {
  const batches = palaeo.realisticBatches;
  if (!batches) return null;
  const batch = batches.find((record) =>
    record.surfaceClass === surfaceClass && record.interval.id === intervalId);
  if (!batch) throw new Error("palaeo-coastline interval absent from the package batch records");
  return batch;
}

export async function loadVerifiedPalaeoIntervalClass(
  entry: LoadedPalaeoClassCatalog,
  intervalId: string,
  fetcher: StaticAssetFetcher,
  runner: PalaeoTriangulationRunner,
  maxEdgeDegrees: number,
  limits: { readonly maxVertices: number; readonly maxTriangles: number },
  signal?: AbortSignal,
  batch?: RealisticSurfaceBatchV2 | null,
): Promise<LoadedPalaeoIntervalClass> {
  const record = entry.catalog.intervals.find((interval) => interval.intervalId === intervalId);
  if (!record) throw new Error("palaeo-coastline interval absent from its class catalog");
  const asset = palaeoPayloadAsset(entry.asset.url, record.payload);
  // The package batch record and the class catalog describe the same file. They
  // are emitted from one source, so a disagreement is a broken build rather than
  // a choice of which to believe, and neither is fetched.
  if (batch && (batch.geometryAsset.sha256 !== asset.sha256 || batch.geometryAsset.bytes !== asset.bytes
      || batch.geometryAsset.url !== asset.url || batch.interval.index !== record.intervalIndex
      || batch.ringCount !== record.payload.rings || batch.vertexCount !== record.payload.vertices
      || batch.charts.records !== record.payload.pieces
      || batch.charts.bindings !== entry.catalog.bindings.length
      || batch.charts.evidence !== entry.catalog.evidence.length
      || batch.charts.lifecycles !== entry.catalog.lifecycles.length)) {
    throw new Error("palaeo-coastline batch record disagrees with its class catalog");
  }
  const bytes = await loadVerifiedBytes(asset, fetcher, signal);
  if (signal?.aborted) throw new DOMException("palaeo-coastline interval load aborted", "AbortError");
  const prepared = await runner.run(bytes, { maxEdgeDegrees, ...limits }, signal);
  if (signal?.aborted) throw new DOMException("palaeo-coastline interval load aborted", "AbortError");
  validatePalaeoRingPayloadAgainstCatalog(prepared.metadata, entry.catalog, record);
  return Object.freeze({ surfaceClass: entry.surfaceClass, catalog: entry.catalog, record,
    metadata: prepared.metadata, geometry: prepared.geometry, sourceBytes: record.payload.bytes });
}

export async function loadVerifiedPalaeoInterval(
  catalogs: readonly LoadedPalaeoClassCatalog[],
  intervalId: string,
  fetcher: StaticAssetFetcher,
  runner: PalaeoTriangulationRunner,
  palaeo: PalaeoCoastlineAssets,
  signal?: AbortSignal,
): Promise<LoadedPalaeoInterval> {
  const reservation = palaeo.reservation;
  // The classes are independent payloads. Loading them one after another made
  // an interval's latency the sum of three fetches, three worker round trips
  // and three validations, and every one of those hops has to wait for a turn
  // on a main thread that is already drawing the gesture. Started together,
  // the interval costs about one hop instead of three.
  const classes: readonly LoadedPalaeoIntervalClass[] = await Promise.all(
    catalogs.map((entry) => loadVerifiedPalaeoIntervalClass(entry, intervalId, fetcher, runner,
      reservation.maxEdgeDegrees,
      { maxVertices: reservation.maxIntervalVertices, maxTriangles: reservation.maxIntervalTriangles },
      signal, realisticSurfaceBatchRecord(palaeo, entry.surfaceClass, intervalId))));
  const vertices = classes.reduce((sum, entry) => sum + entry.geometry.vertexCount, 0);
  const triangles = classes.reduce((sum, entry) => sum + entry.geometry.triangleCount, 0);
  if (vertices > reservation.maxIntervalVertices || triangles > reservation.maxIntervalTriangles) {
    throw new Error("palaeo-coastline interval exceeds its declared renderer reservation");
  }
  const record = classes[0]!.record;
  return Object.freeze({ intervalId, intervalIndex: record.intervalIndex, fromAgeMa: record.fromAgeMa,
    toAgeMa: record.toAgeMa, midAgeMa: record.midAgeMa, classes: Object.freeze(classes),
    sourceBytes: classes.reduce((sum, entry) => sum + entry.sourceBytes, 0) });
}

interface PendingPalaeoInterval {
  readonly promise: Promise<LoadedPalaeoInterval>;
  readonly controller: AbortController;
  consumers: number;
}

/**
 * Units whose bytes are never evicted while the package is open.
 *
 * The Cao 2024 land and shelf batches, the material corrections and the
 * restored pre-collision margin are the geometry every composition falls back
 * to — a fallback age, a loading interval and the LGM lowstand all draw them —
 * so evicting them buys nothing and costs a refetch on the frame that needs
 * them most. They are loaded once with the static foundation and pinned here so
 * the policy is stated where the LRU that governs everything else is stated.
 */
export const PINNED_SURFACE_UNIT_IDS: readonly string[] = Object.freeze([
  "batch-land", "batch-shelf", "corrections", "restored-margin",
]);

/**
 * The residency policy the surface pipeline runs under.
 *
 * `releaseReplacedNativeGpuBuffers` is the D1 knob. In the `realistic`
 * composition the Cao 2017 map replaces the native land and shelf outright, so
 * their GPU buffers are dead weight for as long as the band lasts and may be
 * released and re-uploaded on exit. In `lgm` the native stack and the palaeo
 * overlay draw at once, and at a fallback or still-loading age the native stack
 * is the only thing on screen, so the release is refused there — releasing it
 * would blank the globe.
 */
export interface SurfaceResidencyPolicy {
  readonly pinnedUnitIds: readonly string[];
  /**
   * How many map intervals may stay decoded.
   *
   * `"nearest"` is the neighbour cache the mode shipped with: the drawn
   * interval and both of its neighbours, bounded by
   * `maximumResidentIntervalCount` and `maximumResidentIntervalBytes`. Every
   * other crossing then pays a fetch, a decode and a triangulation on the frame
   * that needs the geometry, which is what a map crossing cost.
   *
   * `"all"` keeps every interval the engine's background scheduler prepares, so
   * a crossing is a swap of geometry already in hand. `maxPreparedBytes` is
   * what bounds it: over that ceiling the store falls back to `"nearest"`
   * rather than growing without limit.
   */
  readonly residentIntervals: "nearest" | "all";
  /** Decoded interval payload bytes `"all"` may hold before the fallback. */
  readonly maxPreparedBytes: number;
  readonly maximumResidentIntervalBytes: number;
  readonly maximumResidentIntervalCount: number;
  readonly releaseReplacedNativeGpuBuffers: boolean;
}

export const DEFAULT_SURFACE_RESIDENCY_POLICY: SurfaceResidencyPolicy = Object.freeze({
  pinnedUnitIds: PINNED_SURFACE_UNIT_IDS,
  // Both quality profiles prepare every interval. They differ in what reaches
  // the GPU, not in what is decoded, and a crossing that has to triangulate is
  // the one cost neither profile can pay inside a frame.
  residentIntervals: "all" as const,
  // The 25 compiled intervals of the shipped classes are 7.69 MiB of ring
  // payload; what they cost resident is the decoded geometry, measured at
  // ~9 MB an interval. Sixty-four MiB is the bound on that, and leaves headroom
  // for a package that gains a class without silently dropping back to the
  // neighbour cache. (The earlier "about 36 MB of payload" here was never the
  // shipped figure; the ledger it justified is checked in `loaderV2.test.ts`.)
  maxPreparedBytes: 64 * 1024 * 1024,
  // The two bounds below govern the `"nearest"` fallback. Two intervals of
  // every compiled class sit far inside six MiB; the bound
  // exists so a scrub that walks the timeline cannot accumulate decoded
  // intervals without an owner. Three residents are the current interval and
  // both of its neighbours: two was one neighbour, and a scrub that reversed
  // direction — or crossed a boundary less than the prefetch lead time after
  // the last one — found the interval it was entering cold. The manifest's
  // `maxResidentSourceBytes` is four worst-case interval payloads, so three
  // residents stay inside the bound the package declares; the byte bound is
  // still what enforces it.
  maximumResidentIntervalBytes: 6 * 1024 * 1024,
  maximumResidentIntervalCount: 3,
  releaseReplacedNativeGpuBuffers: true,
});

// ---------------------------------------------------------------------------
// one residency store over both surface units
// ---------------------------------------------------------------------------

/**
 * The streaming unit of the surface pipeline.
 *
 * The two arms stream different things — a Cao 2024 checkpoint is addressed by
 * its exact age, a Cao 2017 map interval by its published id — but everything
 * above the stores treats them the same way: request one, wait for it, hold it
 * resident while it is drawn, let it go. Naming the union once is what lets the
 * residency store and the request chain stop carrying two of everything.
 */
export type SurfaceUnitId =
  | { readonly kind: "checkpoint"; readonly ageMa: number }
  | { readonly kind: "interval"; readonly id: string };

export function checkpointUnit(ageMa: number): SurfaceUnitId {
  return Object.freeze({ kind: "checkpoint" as const, ageMa });
}

export function intervalUnit(id: string): SurfaceUnitId {
  return Object.freeze({ kind: "interval" as const, id });
}

/** A stable string for map keys and identity comparisons. */
export function surfaceUnitKey(unit: SurfaceUnitId): string {
  return unit.kind === "checkpoint" ? `checkpoint:${unit.ageMa}` : `interval:${unit.id}`;
}

export function surfaceUnitsEqual(left: SurfaceUnitId | null, right: SurfaceUnitId | null): boolean {
  if (left === null || right === null) return left === right;
  return surfaceUnitKey(left) === surfaceUnitKey(right);
}

export type LoadedSurfaceUnit =
  | { readonly kind: "checkpoint"; readonly ageMa: number; readonly value: LoadedCaoCheckpoint }
  | { readonly kind: "interval"; readonly id: string; readonly value: LoadedPalaeoInterval };

const ABSENT_CHECKPOINT_LEDGER = Object.freeze({
  residentCount: 0, pendingCount: 0, residentSourceBytes: 0, pendingReservedSourceBytes: 0,
  maximumResidentCount: 2, maximumPendingCount: 2,
});

const ABSENT_INTERVAL_LEDGER = Object.freeze({
  residentCount: 0, pendingCount: 0, residentSourceBytes: 0, pendingReservedSourceBytes: 0,
  maximumResidentCount: 2, maximumPendingCount: 2, maximumResidentSourceBytes: 0,
  maximumPreparedSourceBytes: 0,
});

/**
 * One residency owner over both surface units.
 *
 * The checkpoint half keeps its own class: it is keyed by age and shared with
 * the native request chain. The interval half is this class — three resident
 * map intervals, the current one and both prefetched neighbours, bounded by
 * bytes as well as by count, with two unsettled loads. It lives here rather
 * than in a store of its own because everything that used to sit between the
 * two — which half a `SurfaceUnitId` belongs to, whether the palaeo half exists
 * at all, the age eviction measures against — was this object already.
 *
 * Eviction drops the interval whose age range is farthest from the age the
 * runtime last asked for, not the least recently read one: a prefetched
 * neighbour is never read until the crossing that needs it, so an LRU order
 * evicted exactly the interval the prefetch had just paid for. A fetcher that
 * ignores its abort signal must not be able to pin an entry, and a scrub across
 * many intervals must not leave decoded geometry behind. The ledger shapes are
 * unchanged, including the values reported while the palaeo half is detached,
 * because the engine ledger is a tested contract.
 */
export class CaoSurfaceResidencyStore {
  private checkpoints: CaoCheckpointStore | null = null;
  private closed = false;
  /** The palaeo half's inputs, or null while the mode has never been on. */
  private palaeo: PalaeoCoastlineAssets | null = null;
  private catalogs: readonly LoadedPalaeoClassCatalog[] = [];
  private runner: PalaeoTriangulationRunner | null = null;
  private maximumResidentIntervalBytes = 0;
  /** Bytes the `"all"` policy may hold; 0 while detached or under the fallback. */
  private preparedCeilingBytes = 0;
  private readonly residentIntervals =
    new Map<string, { value: LoadedPalaeoInterval; used: number }>();
  private readonly pendingIntervals = new Map<string, PendingPalaeoInterval>();
  private readonly waiters = new Set<{ resolve(): void; reject(error: unknown): void;
    signal?: AbortSignal; onAbort(): void }>();
  private clock = 0;
  /** Age the runtime last asked for; the distance eviction measures against. */
  private currentAgeMa: number | null = null;

  constructor(
    private readonly manifest: ReconstructionPackageManifestV2,
    private readonly fetcher: StaticAssetFetcher,
    readonly policy: SurfaceResidencyPolicy = DEFAULT_SURFACE_RESIDENCY_POLICY,
  ) {}

  /** The checkpoint half, created on first demand against the resident core. */
  checkpointStore(core: ReconstructionCoreV2): CaoCheckpointStore {
    if (this.closed) throw new Error("Cao surface residency store disposed");
    return this.checkpoints ??= new CaoCheckpointStore(this.manifest, core, this.fetcher);
  }

  /**
   * Attaches the palaeo half against the loaded catalogs. Idempotent: the
   * inputs of the one attached section never change within a package, and a
   * second enablement must not throw away intervals already decoded.
   */
  attachIntervals(
    palaeo: PalaeoCoastlineAssets,
    catalogs: readonly LoadedPalaeoClassCatalog[],
    runner: PalaeoTriangulationRunner,
  ): void {
    if (this.closed) throw new Error("Cao surface residency store disposed");
    if (this.palaeo !== null) return;
    this.palaeo = palaeo;
    this.catalogs = catalogs;
    this.runner = runner;
    this.maximumResidentIntervalBytes = Math.min(this.policy.maximumResidentIntervalBytes,
      palaeo.reservation.maxResidentSourceBytes);
    // The package's `maxResidentSourceBytes` is the neighbour cache's
    // reservation — four worst-case payloads — so it cannot bound a policy that
    // holds every interval. The prepared ceiling is the policy's alone.
    this.preparedCeilingBytes = this.policy.residentIntervals === "all"
      ? this.policy.maxPreparedBytes : 0;
  }

  /** Whether a unit's bytes are pinned for the life of the package. */
  isPinned(unit: SurfaceUnitId): boolean {
    return unit.kind === "interval" && this.policy.pinnedUnitIds.includes(unit.id);
  }

  /** Whether the interval half exists; false means zero palaeo bytes are resident. */
  get intervalsAttached(): boolean {
    return this.palaeo !== null;
  }

  /** Retires the interval half. Turning the mode off must leave nothing behind. */
  detachIntervals(): void {
    this.palaeo = null;
    this.catalogs = [];
    this.runner = null;
    this.maximumResidentIntervalBytes = 0;
    this.preparedCeilingBytes = 0;
    this.residentIntervals.clear();
    for (const record of this.pendingIntervals.values()) record.controller.abort();
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      waiter.reject(new DOMException("palaeo-coastline interval store disposed", "AbortError"));
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.checkpoints?.dispose();
    this.detachIntervals();
  }

  get checkpointLedger() {
    return this.checkpoints?.ledger ?? ABSENT_CHECKPOINT_LEDGER;
  }

  get intervalLedger() {
    if (this.palaeo === null) return ABSENT_INTERVAL_LEDGER;
    return Object.freeze({
      residentCount: this.residentIntervals.size, pendingCount: this.pendingIntervals.size,
      residentSourceBytes: [...this.residentIntervals.keys()]
        .reduce((sum, id) => sum + this.intervalAssetBytes(id), 0),
      pendingReservedSourceBytes: [...this.pendingIntervals.keys()]
        .reduce((sum, id) => sum + this.intervalAssetBytes(id), 0),
      maximumResidentCount: this.policy.maximumResidentIntervalCount, maximumPendingCount: 2,
      maximumResidentSourceBytes: this.maximumResidentIntervalBytes,
      maximumPreparedSourceBytes: this.preparedCeilingBytes });
  }

  /** The age eviction measures against; a note, never a request. */
  noteCurrentAge(requestedAgeMa: number): void {
    if (Number.isFinite(requestedAgeMa)) this.currentAgeMa = requestedAgeMa;
  }

  /**
   * A unit already decoded, without starting any load. A scrub retarget inside
   * one map interval reads through here rather than through `load`, so moving
   * the age can never start a fetch the foreground request did not ask for.
   */
  isResident(unit: SurfaceUnitId): boolean {
    return unit.kind === "interval" && this.residentIntervals.has(unit.id);
  }

  resident(unit: SurfaceUnitId): LoadedSurfaceUnit | null {
    if (unit.kind !== "interval") return null;
    const cached = this.residentIntervals.get(unit.id);
    if (!cached) return null;
    cached.used = ++this.clock;
    return Object.freeze({ kind: "interval" as const, id: unit.id, value: cached.value });
  }

  /**
   * Loads a unit through whichever half owns it. The half must already be
   * attached: the checkpoint store needs the resident core and the interval
   * half needs the loaded catalogs, and a caller that has neither has nothing
   * to ask for yet.
   */
  async load(unit: SurfaceUnitId, signal?: AbortSignal): Promise<LoadedSurfaceUnit> {
    if (this.closed) throw new Error("Cao surface residency store disposed");
    if (unit.kind === "checkpoint") {
      const store = this.checkpoints;
      if (!store) throw new Error("Cao checkpoint store is not attached");
      const value = await store.load(unit.ageMa, signal);
      return Object.freeze({ kind: "checkpoint" as const, ageMa: unit.ageMa, value });
    }
    const value = await this.loadInterval(unit.id, signal);
    return Object.freeze({ kind: "interval" as const, id: unit.id, value });
  }

  private async loadInterval(intervalId: string, signal?: AbortSignal): Promise<LoadedPalaeoInterval> {
    const palaeo = this.palaeo;
    const runner = this.runner;
    if (this.closed) throw new Error("Cao surface residency store disposed");
    if (palaeo === null || runner === null) {
      throw new Error("palaeo-coastline interval store is not attached");
    }
    if (signal?.aborted) throw new DOMException("palaeo-coastline interval request aborted", "AbortError");
    const declaredBytes = this.intervalAssetBytes(intervalId);
    if (declaredBytes === 0) throw new Error("palaeo-coastline interval absent from its class catalog");
    if (declaredBytes > this.maximumResidentIntervalBytes) {
      throw new Error("palaeo-coastline interval exceeds the resident byte bound");
    }
    const cached = this.residentIntervals.get(intervalId);
    if (cached) { cached.used = ++this.clock; return cached.value; }
    let record = this.pendingIntervals.get(intervalId);
    if (record?.controller.signal.aborted) {
      await this.waitForCapacity(signal);
      return this.loadInterval(intervalId, signal);
    }
    if (!record) {
      if (this.pendingIntervals.size >= 2) {
        await this.waitForCapacity(signal);
        return this.loadInterval(intervalId, signal);
      }
      const controller = new AbortController();
      const created = {} as PendingPalaeoInterval;
      Object.assign(created, { controller, consumers: 0, promise: loadVerifiedPalaeoInterval(
        this.catalogs, intervalId, this.fetcher, runner, palaeo, controller.signal,
      ).then((value) => {
        if (controller.signal.aborted || this.closed || this.palaeo !== palaeo) {
          throw new DOMException("palaeo-coastline interval load retired", "AbortError");
        }
        this.residentIntervals.set(intervalId, { value, used: ++this.clock });
        this.evictIntervals();
        return value;
      }).finally(() => {
        if (this.pendingIntervals.get(intervalId) === created) this.pendingIntervals.delete(intervalId);
        this.notifyWaiter();
      }) });
      record = created;
      this.pendingIntervals.set(intervalId, record);
    }
    record.consumers += 1;
    return new Promise((resolve, reject) => {
      let complete = false;
      const finish = () => {
        if (complete) return;
        complete = true;
        signal?.removeEventListener("abort", onAbort);
        record!.consumers -= 1;
      };
      const onAbort = () => {
        finish();
        if (record!.consumers === 0) record!.controller.abort();
        reject(new DOMException("palaeo-coastline interval request aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      record!.promise.then((value) => { if (!complete) { finish(); resolve(value); } },
        (error) => { if (!complete) { finish(); reject(error); } });
    });
  }

  /** Ma between the noted current age and an interval's own `(toAge, fromAge]`. */
  private ageDistance(interval: LoadedPalaeoInterval): number {
    const age = this.currentAgeMa;
    if (age === null) return 0;
    if (age > interval.fromAgeMa) return age - interval.fromAgeMa;
    if (age <= interval.toAgeMa) return interval.toAgeMa - age;
    return 0;
  }

  private residentIntervalBytes(): number {
    return [...this.residentIntervals.keys()].reduce((sum, id) => sum + this.intervalAssetBytes(id), 0);
  }

  private evictIntervals(): void {
    // Under `"all"` nothing is evicted while the prepared set fits its ceiling:
    // the whole point of preparing every interval is that a crossing finds its
    // geometry decoded. Over the ceiling the neighbour cache below takes over,
    // so the policy degrades to the one the mode shipped with rather than
    // holding bytes nobody bounded.
    if (this.policy.residentIntervals === "all"
        && this.residentIntervalBytes() <= this.preparedCeilingBytes) return;
    // Farthest from the current age first; the least recently read one breaks a
    // tie, which is the whole order when no age has been noted yet. A pinned
    // unit is never a candidate: the policy names the geometry every
    // composition falls back to, and evicting it costs a refetch on the frame
    // that needs it most.
    const evictable = () => [...this.residentIntervals]
      .filter(([id]) => !this.isPinned(intervalUnit(id)))
      .sort((left, right) => this.ageDistance(right[1].value) - this.ageDistance(left[1].value)
        || left[1].used - right[1].used);
    const dropFarthest = (): boolean => {
      const victim = evictable()[0];
      if (!victim) return false;
      this.residentIntervals.delete(victim[0]);
      return true;
    };
    while (this.residentIntervals.size > this.policy.maximumResidentIntervalCount) {
      if (!dropFarthest()) break;
    }
    while (this.residentIntervals.size > 1
      && this.residentIntervalBytes() > this.maximumResidentIntervalBytes) {
      if (!dropFarthest()) break;
    }
  }

  private intervalAssetBytes(intervalId: string): number {
    return this.catalogs.reduce((sum, entry) => sum + (entry.catalog.intervals
      .find((interval) => interval.intervalId === intervalId)?.payload.bytes ?? 0), 0);
  }

  private async waitForCapacity(signal?: AbortSignal): Promise<void> {
    if (this.waiters.size >= 2) throw new Error("palaeo-coastline capacity waiter bound exceeded");
    await new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject, signal, onAbort: () => {
        this.waiters.delete(waiter);
        reject(new DOMException("palaeo-coastline interval request aborted", "AbortError"));
      } };
      this.waiters.add(waiter);
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
    });
    if (this.closed) throw new Error("Cao surface residency store disposed");
    if (signal?.aborted) throw new DOMException("palaeo-coastline interval request aborted", "AbortError");
  }

  private notifyWaiter(): void {
    const waiter = this.waiters.values().next().value;
    if (!waiter) return;
    this.waiters.delete(waiter);
    waiter.signal?.removeEventListener("abort", waiter.onAbort);
    waiter.resolve();
  }
}
