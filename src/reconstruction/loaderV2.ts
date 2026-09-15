import { loadVerifiedBytes, type StaticAssetFetchOptions, type StaticAssetFetcher } from "./assetLoader";
import { expandInternedPackageDocument } from "./packageIntern";
import { decodeMotionPalette, selectPaletteMotionSubsegment, type MotionPaletteCatalog,
  type PreparedPaletteEntry } from "./palette";
import { evaluateLifecycleSupport } from "./motion";
import { decodeRequestedAgeMotionTile, selectRequestedAgeMotionTile,
  validateRequestedAgeMotionTileIndex, type RequestedAgeMotionTileIndex } from "./motionTiles";
import {
  selectPalaeoInterval,
  validatePalaeoCoastlineClassCatalog,
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

export interface LoadedRequestedAgeMotionPalette {
  readonly index: RequestedAgeMotionTileIndex;
  readonly descriptor: ReturnType<typeof selectRequestedAgeMotionTile>;
  readonly entries: ReadonlyMap<string, PreparedPaletteEntry>;
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
      throw new Error("requested-age motion tile does not cover a selected Cao chart binding");
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
      loadVerifiedCaoRequestedAgeMotionPalette(manifest, loaded, requestedAgeMa, fetcher, signal),
    ]);
    return withPaletteEntries(foundation, paletteEntries.entries);
  });
}

export async function loadVerifiedCaoRequestedAgeMotionTileIndex(
  manifest: ReconstructionPackageManifestV2,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<RequestedAgeMotionTileIndex> {
  const indexAsset = manifest.motionPalette.requestedAgeTiles;
  if (!indexAsset) throw new Error("Cao package has no requested-age motion tile index");
  const index = await verifiedJson<RequestedAgeMotionTileIndex>(indexAsset, fetcher, signal);
  validateRequestedAgeMotionTileIndex(index, manifest);
  return deepFreeze(index);
}

export async function loadVerifiedCaoRequestedAgeMotionPalette(
  manifest: ReconstructionPackageManifestV2,
  metadata: Pick<LoadedCaoFoundationMetadata, "core" | "paletteCatalog">,
  requestedAgeMa: number,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
  loadedIndex?: RequestedAgeMotionTileIndex,
): Promise<LoadedRequestedAgeMotionPalette> {
  const indexAsset = manifest.motionPalette.requestedAgeTiles;
  if (!indexAsset) throw new Error("Cao package has no requested-age motion tile index");
  const index = loadedIndex ?? await loadVerifiedCaoRequestedAgeMotionTileIndex(manifest, fetcher, signal);
  const descriptor = selectRequestedAgeMotionTile(index, requestedAgeMa);
  const buffer = await loadVerifiedBytes(descriptor.asset, fetcher, signal);
  const entries = decodeRequestedAgeMotionTile(descriptor, metadata.paletteCatalog, buffer);
  validateRequestedAgePaletteCoverage(metadata.core, entries, requestedAgeMa);
  return Object.freeze({ index, descriptor, entries });
}

/** Loads and validates the canonical all-age palette for a resident requested-age foundation. */
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

/**
 * Resident payload bytes the palaeo interval store may hold. Two intervals of
 * every compiled class sit far inside this; the bound exists so a scrub that
 * walks the timeline cannot accumulate decoded intervals without an owner.
 */
export const PALAEO_INTERVAL_STORE_MAX_BYTES = 4 * 1024 * 1024;

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
    const catalog = await verifiedJson<PalaeoCoastlineClassCatalog>(entry.catalog, fetcher, signal);
    validatePalaeoCoastlineClassCatalog(catalog, entry.surfaceClass);
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
  return catalogs.length === 0 ? null : selectPalaeoInterval(catalogs[0]!.catalog, ageMa);
}

export async function loadVerifiedPalaeoIntervalClass(
  entry: LoadedPalaeoClassCatalog,
  intervalId: string,
  fetcher: StaticAssetFetcher,
  runner: PalaeoTriangulationRunner,
  maxEdgeDegrees: number,
  limits: { readonly maxVertices: number; readonly maxTriangles: number },
  signal?: AbortSignal,
): Promise<LoadedPalaeoIntervalClass> {
  const record = entry.catalog.intervals.find((interval) => interval.intervalId === intervalId);
  if (!record) throw new Error("palaeo-coastline interval absent from its class catalog");
  const asset = palaeoPayloadAsset(entry.asset.url, record.simplified);
  const bytes = await loadVerifiedBytes(asset, fetcher, signal);
  if (signal?.aborted) throw new DOMException("palaeo-coastline interval load aborted", "AbortError");
  const prepared = await runner.run(bytes, { maxEdgeDegrees, ...limits }, signal);
  if (signal?.aborted) throw new DOMException("palaeo-coastline interval load aborted", "AbortError");
  validatePalaeoRingPayloadAgainstCatalog(prepared.metadata, entry.catalog, record);
  return Object.freeze({ surfaceClass: entry.surfaceClass, catalog: entry.catalog, record,
    metadata: prepared.metadata, geometry: prepared.geometry, sourceBytes: record.simplified.bytes });
}

export async function loadVerifiedPalaeoInterval(
  catalogs: readonly LoadedPalaeoClassCatalog[],
  intervalId: string,
  fetcher: StaticAssetFetcher,
  runner: PalaeoTriangulationRunner,
  reservation: PalaeoCoastlineAssets["reservation"],
  signal?: AbortSignal,
): Promise<LoadedPalaeoInterval> {
  const classes: LoadedPalaeoIntervalClass[] = [];
  for (const entry of catalogs) {
    classes.push(await loadVerifiedPalaeoIntervalClass(entry, intervalId, fetcher, runner,
      reservation.maxEdgeDegrees,
      { maxVertices: reservation.maxIntervalVertices, maxTriangles: reservation.maxIntervalTriangles },
      signal));
  }
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
 * Two resident map intervals — the active one and one prefetched neighbour —
 * and two unsettled loads, bounded by bytes as well as by count. Copied from
 * `CaoCheckpointStore` because the failure it guards against is the same: a
 * scrub across many intervals must not leave decoded geometry behind, and a
 * fetcher that ignores its abort signal must not be able to pin one.
 */
export class CaoPalaeoIntervalStore {
  private readonly resident = new Map<string, { value: LoadedPalaeoInterval; used: number }>();
  private readonly pending = new Map<string, PendingPalaeoInterval>();
  private readonly waiters = new Set<{ resolve(): void; reject(error: unknown): void;
    signal?: AbortSignal; onAbort(): void }>();
  private readonly maximumResidentBytes: number;
  private clock = 0;
  private closed = false;

  constructor(
    private readonly palaeo: PalaeoCoastlineAssets,
    private readonly catalogs: readonly LoadedPalaeoClassCatalog[],
    private readonly fetcher: StaticAssetFetcher,
    private readonly runner: PalaeoTriangulationRunner,
  ) {
    this.maximumResidentBytes = Math.min(PALAEO_INTERVAL_STORE_MAX_BYTES,
      palaeo.reservation.maxResidentSourceBytes);
  }

  get ledger() {
    return Object.freeze({ residentCount: this.resident.size, pendingCount: this.pending.size,
      residentSourceBytes: [...this.resident.keys()].reduce((sum, id) => sum + this.assetBytes(id), 0),
      pendingReservedSourceBytes: [...this.pending.keys()].reduce((sum, id) => sum + this.assetBytes(id), 0),
      maximumResidentCount: 2, maximumPendingCount: 2,
      maximumResidentSourceBytes: this.maximumResidentBytes });
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.resident.clear();
    for (const record of this.pending.values()) record.controller.abort();
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      waiter.signal?.removeEventListener("abort", waiter.onAbort);
      waiter.reject(new DOMException("palaeo-coastline interval store disposed", "AbortError"));
    }
  }

  async load(intervalId: string, signal?: AbortSignal): Promise<LoadedPalaeoInterval> {
    if (this.closed) throw new Error("palaeo-coastline interval store disposed");
    if (signal?.aborted) throw new DOMException("palaeo-coastline interval request aborted", "AbortError");
    const declaredBytes = this.assetBytes(intervalId);
    if (declaredBytes === 0) throw new Error("palaeo-coastline interval absent from its class catalog");
    if (declaredBytes > this.maximumResidentBytes) {
      throw new Error("palaeo-coastline interval exceeds the resident byte bound");
    }
    const cached = this.resident.get(intervalId);
    if (cached) { cached.used = ++this.clock; return cached.value; }
    let record = this.pending.get(intervalId);
    if (record?.controller.signal.aborted) {
      await this.waitForCapacity(signal);
      return this.load(intervalId, signal);
    }
    if (!record) {
      if (this.pending.size >= 2) {
        await this.waitForCapacity(signal);
        return this.load(intervalId, signal);
      }
      const controller = new AbortController();
      const created = {} as PendingPalaeoInterval;
      Object.assign(created, { controller, consumers: 0, promise: loadVerifiedPalaeoInterval(
        this.catalogs, intervalId, this.fetcher, this.runner, this.palaeo.reservation, controller.signal,
      ).then((value) => {
        if (controller.signal.aborted || this.closed) {
          throw new DOMException("palaeo-coastline interval load retired", "AbortError");
        }
        this.resident.set(intervalId, { value, used: ++this.clock });
        this.evict();
        return value;
      }).finally(() => {
        if (this.pending.get(intervalId) === created) this.pending.delete(intervalId);
        this.notifyWaiter();
      }) });
      record = created;
      this.pending.set(intervalId, record);
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

  private evict(): void {
    const oldest = () => [...this.resident].sort((left, right) => left[1].used - right[1].used)[0]!;
    while (this.resident.size > 2) this.resident.delete(oldest()[0]);
    while (this.resident.size > 1
      && [...this.resident.keys()].reduce((sum, id) => sum + this.assetBytes(id), 0)
        > this.maximumResidentBytes) {
      this.resident.delete(oldest()[0]);
    }
  }

  private assetBytes(intervalId: string): number {
    return this.catalogs.reduce((sum, entry) => sum + (entry.catalog.intervals
      .find((interval) => interval.intervalId === intervalId)?.simplified.bytes ?? 0), 0);
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
    if (this.closed) throw new Error("palaeo-coastline interval store disposed");
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
