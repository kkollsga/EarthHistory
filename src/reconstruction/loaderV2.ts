import { loadVerifiedBytes, type StaticAssetFetcher } from "./assetLoader";
import { decodeMotionPalette, selectPaletteMotionSubsegment, type MotionPaletteCatalog,
  type PreparedPaletteEntry } from "./palette";
import {
  validateReconstructionCheckpointV2,
  validateReconstructionAnchorCatalogV2,
  validateReconstructionCoreV2,
  validateReconstructionPackageManifestV2,
  type ReconstructionCheckpointV2,
  type ReconstructionCoreV2,
  type ReconstructionAnchorCatalogV2,
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
): Promise<T> {
  const bytes = await loadVerifiedBytes(asset, fetcher, signal);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

export interface LoadedCaoFoundation {
  readonly core: ReconstructionCoreV2;
  readonly paletteCatalog: MotionPaletteCatalog;
  readonly paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>;
  readonly spatialBatches: ReadonlyMap<string, DecodedCaoSpatialBatch>;
  readonly lineBatches: ReadonlyMap<string, DecodedCaoLineBatch>;
  readonly anchorCatalog: ReconstructionAnchorCatalogV2 | null;
}

/** Loads the fixed package/core/palette identity once; checkpoints remain age-demand loaded. */
export async function loadVerifiedCaoFoundation(
  manifest: ReconstructionPackageManifestV2,
  fetcher: StaticAssetFetcher,
  signal?: AbortSignal,
): Promise<LoadedCaoFoundation> {
  validateReconstructionPackageManifestV2(manifest);
  const [rawCore, rawCatalog, binary] = await Promise.all([
    verifiedJson<ReconstructionCoreV2>(manifest.core, fetcher, signal),
    verifiedJson<MotionPaletteCatalog>(manifest.motionPalette.catalog, fetcher, signal),
    loadVerifiedBytes(manifest.motionPalette.binary, fetcher, signal),
  ]);
  if (signal?.aborted) throw new DOMException("Cao reconstruction foundation load aborted", "AbortError");
  if (rawCatalog.binary.bytes !== manifest.motionPalette.binary.bytes
      || rawCatalog.binary.sha256 !== manifest.motionPalette.binary.sha256) {
    throw new Error("Cao motion palette manifest/catalog binary mismatch");
  }
  validateReconstructionCoreV2(rawCore, manifest, rawCatalog);
  const paletteEntries = decodeMotionPalette(rawCatalog, binary);
  for (const chart of rawCore.charts) {
    const bindings = chart.motionBindings ?? [];
    for (let left = 0; left < bindings.length; left += 1) for (let right = left + 1; right < bindings.length; right += 1) {
      const first = bindings[left]!;
      const second = bindings[right]!;
      const touchingAge = Math.max(first.validTimeMa.youngest, second.validTimeMa.youngest);
      if (touchingAge !== Math.min(first.validTimeMa.oldest, second.validTimeMa.oldest)) continue;
      const firstSegment = selectPaletteMotionSubsegment(paletteEntries.get(first.entryId)!, touchingAge);
      const secondSegment = selectPaletteMotionSubsegment(paletteEntries.get(second.entryId)!, touchingAge);
      const endpoint = (segment: NonNullable<typeof firstSegment>) => segment.fraction === 0
        ? segment.younger.quaternion : segment.older.quaternion;
      if (!firstSegment || !secondSegment || endpoint(firstSegment).some((value, axis) =>
        value !== endpoint(secondSegment)[axis])) {
        throw new Error("touching Cao motion bindings disagree at their shared source knot");
      }
    }
  }
  const spatialBatches = new Map<string, DecodedCaoSpatialBatch>();
  for (const batch of rawCore.spatialBatches) {
    if (signal?.aborted) throw new DOMException("Cao reconstruction foundation load aborted", "AbortError");
    spatialBatches.set(batch.batchId, await loadVerifiedCaoSpatialBatch(rawCore, batch.batchId, fetcher, signal));
  }
  const lineBatches = new Map<string, DecodedCaoLineBatch>();
  for (const batch of rawCore.lineBatches ?? []) {
    if (signal?.aborted) throw new DOMException("Cao reconstruction foundation load aborted", "AbortError");
    const bytes = await loadVerifiedBytes(batch.geometryAsset, fetcher, signal);
    lineBatches.set(batch.batchId, decodeCaoLineBatch(bytes, batch.vertexCount, batch.segmentCount,
      rawCore.charts.length));
  }
  const anchorCatalog = rawCore.anchorCatalog
    ? await verifiedJson<ReconstructionAnchorCatalogV2>(rawCore.anchorCatalog, fetcher, signal)
    : null;
  if (anchorCatalog) validateReconstructionAnchorCatalogV2(anchorCatalog, manifest, rawCore);
  return Object.freeze({
    core: deepFreeze(rawCore),
    paletteCatalog: deepFreeze(rawCatalog),
    paletteEntries,
    spatialBatches,
    lineBatches,
    anchorCatalog: anchorCatalog ? deepFreeze(anchorCatalog) : null,
  });
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
): Promise<ReconstructionCheckpointV2> {
  const asset = manifest.checkpoints.find((candidate) => candidate.ageMa === ageMa);
  if (!asset) throw new Error("Cao checkpoint absent from package manifest");
  const checkpoint = await verifiedJson<ReconstructionCheckpointV2>(asset, fetcher, signal);
  validateReconstructionCheckpointV2(checkpoint, manifest, core);
  if (checkpoint.ageMa !== ageMa) throw new Error("Cao checkpoint age mismatch");
  const actualTransitiveBytes = asset.bytes + [checkpoint.nativeBoundaryLayer, checkpoint.topologyOwnershipLayer]
    .reduce((sum, layer) => sum + (layer?.catalog.bytes ?? 0) + (layer?.binary.bytes ?? 0), 0);
  if (actualTransitiveBytes !== asset.transitiveBytes) throw new Error("Cao checkpoint transitive byte ledger mismatch");
  return deepFreeze(checkpoint);
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
