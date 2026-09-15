import { packageFrameIdentity } from "./identity";
import {
  CaoCheckpointStore,
  loadVerifiedCaoFoundationMetadata,
  loadVerifiedCaoFullMotionPalette,
  loadVerifiedCaoRequestedAgeMotionPalette,
  loadVerifiedCaoRequestedAgeMotionTileIndex,
  loadVerifiedCaoStaticFoundation,
  warmVerifiedCaoCheckpointAssets,
  type LoadedCaoFoundation,
  type LoadedRequestedAgeMotionPalette,
} from "./loaderV2";
import type { StaticAssetFetcher } from "./assetLoader";
import { immutableReconstructionPackageManifestV2, type ReconstructionPackageManifestV2 } from "./packageV2";
import { PREPARED_MOTION_PALETTE_STRIDE, type PreparedCaoRevision } from "./facadeV2";
import { evaluateCaoMotionFrame, resolveCaoDisplayBracket, type CaoMotionFrame } from "./motionFrameV2";
import type { MaterialAddress } from "./types";
import { selectRequestedAgeMotionTile, verifyRequestedAgeMotionTileSourceIdentity,
  type RequestedAgeMotionTileIndex } from "./motionTiles";
import type { PreparedPaletteEntry } from "./palette";

/** Background decoding and warming wait until the foreground age has rested this long. */
export const CAO_FOREGROUND_SETTLE_MS = 250;

export interface CaoTimelineLoadingState {
  readonly status: "idle" | "loading" | "ready" | "paused";
  readonly foregroundStatus: "idle" | "loading" | "ready";
  readonly requestedAgeMa: number | null;
  readonly motionTier: "requested-age" | "full";
  readonly error: string | null;
}

type MotionSelection = {
  readonly foundation: LoadedCaoFoundation;
  readonly sourceBytes: number;
  readonly tier: "requested-age" | "full";
};

function sameMotionFrame(left: CaoMotionFrame, right: CaoMotionFrame): boolean {
  if (left.requestedAgeMa !== right.requestedAgeMa || left.entryCount !== right.entryCount
      || left.materialCorrectionIdentity !== right.materialCorrectionIdentity
      || left.paletteValues.length !== right.paletteValues.length || left.charts.length !== right.charts.length) {
    return false;
  }
  const leftBytes = new Uint8Array(left.paletteValues.buffer, left.paletteValues.byteOffset, left.paletteValues.byteLength);
  const rightBytes = new Uint8Array(right.paletteValues.buffer, right.paletteValues.byteOffset, right.paletteValues.byteLength);
  if (leftBytes.some((value, index) => value !== rightBytes[index])) return false;
  return left.charts.every((chart, index) => {
    const other = right.charts[index];
    return other?.chartId === chart.chartId && other.chartRevision === chart.chartRevision
      && JSON.stringify(other.support) === JSON.stringify(chart.support);
  });
}

export class CaoReconstructionRuntime {
  private serial = 0;
  private active: AbortController | null = null;
  private readonly lifetime = new AbortController();
  private readonly metadata;
  private readonly staticFoundation;
  private readonly tileIndex: Promise<RequestedAgeMotionTileIndex> | null;
  private resolvedTileIndex: RequestedAgeMotionTileIndex | null = null;
  /** Newest tile that produced a foreground frame; the all-age palette is verified against it. */
  private lastLoadedTile: { readonly loaded: LoadedRequestedAgeMotionPalette; readonly requestedAgeMa: number } | null = null;
  private foundationStaticSourceBytes = 0;
  private foregroundAgeMa: number | null = null;
  private foregroundChangedAt = 0;
  private tileSerial = 0;
  private tilePending: { readonly tileId: string; readonly assetBytes: number; readonly controller: AbortController;
    readonly promise: Promise<LoadedRequestedAgeMotionPalette> } | null = null;
  private readonly tileCache = new Map<string, LoadedRequestedAgeMotionPalette>();
  private fullPaletteEntries: ReadonlyMap<string, PreparedPaletteEntry> | null = null;
  private foregroundFullPalette: Promise<ReadonlyMap<string, PreparedPaletteEntry>> | null = null;
  private background: AbortController | null = null;
  private readonly warmedCheckpointAges = new Set<number>();
  private readonly checkpointDemandAges = new Set<number>();
  private timelineComplete = false;
  private backgroundReservedSourceBytes = 0;
  private timelineState: CaoTimelineLoadingState = Object.freeze({
    status: "idle", foregroundStatus: "idle", requestedAgeMa: null, motionTier: "requested-age", error: null,
  });
  private readonly timelineListeners = new Set<(state: CaoTimelineLoadingState) => void>();
  private checkpointStore: CaoCheckpointStore | null = null;
  private readonly leases = new Map<string, () => void>();

  readonly manifest: ReconstructionPackageManifestV2;

  constructor(manifest: ReconstructionPackageManifestV2, private readonly fetcher: StaticAssetFetcher) {
    this.manifest = immutableReconstructionPackageManifestV2(manifest);
    this.metadata = loadVerifiedCaoFoundationMetadata(this.manifest, fetcher, this.lifetime.signal);
    this.staticFoundation = this.metadata.then((metadata) =>
      loadVerifiedCaoStaticFoundation(this.manifest, metadata, fetcher, this.lifetime.signal));
    this.tileIndex = this.manifest.motionPalette.requestedAgeTiles
      ? loadVerifiedCaoRequestedAgeMotionTileIndex(this.manifest, fetcher, this.lifetime.signal) : null;
    void this.staticFoundation.then((foundation) => {
      this.foundationStaticSourceBytes = this.manifest.core.bytes + this.manifest.motionPalette.catalog.bytes
        + [...foundation.spatialBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + [...foundation.lineBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + (foundation.core.anchorCatalog?.bytes ?? 0)
        + (this.manifest.materialCorrections?.catalog.bytes ?? 0);
    }).catch(() => {});
    void this.staticFoundation.catch(() => {});
    void this.tileIndex?.then((index) => { this.resolvedTileIndex = index; }).catch(() => {});
  }

  request(requestedAgeMa: number): { readonly signal: AbortSignal; readonly prepared: Promise<PreparedCaoRevision> } {
    if (this.lifetime.signal.aborted) throw new Error("Cao reconstruction runtime disposed");
    if (!Number.isFinite(requestedAgeMa) || requestedAgeMa < this.manifest.ageDomainMa.youngest
        || requestedAgeMa > this.manifest.ageDomainMa.oldest) throw new Error("age outside Cao package domain");
    if (this.leases.size >= 2) throw new Error("release a Cao prepared revision before requesting another");
    this.prioritizeAge(requestedAgeMa);
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    return { signal: controller.signal, prepared: this.prepare(++this.serial, requestedAgeMa, controller.signal) };
  }

  /**
   * Continuous motion evaluation against the resident foundation palette.
   * Does not allocate a prepared lease or touch checkpoint assets — scrubbing
   * uses this to interpolate plate poses between discrete prepares.
   */
  async evaluateMotion(requestedAgeMa: number): Promise<CaoMotionFrame> {
    if (this.lifetime.signal.aborted) throw new Error("Cao reconstruction runtime disposed");
    resolveCaoDisplayBracket(this.manifest, requestedAgeMa);
    this.prioritizeAge(requestedAgeMa);
    const { foundation } = await this.foundationForAge(requestedAgeMa);
    if (this.lifetime.signal.aborted) throw new Error("Cao reconstruction runtime disposed");
    if (this.foregroundAgeMa !== requestedAgeMa) {
      throw new DOMException("stale Cao motion evaluation", "AbortError");
    }
    return evaluateCaoMotionFrame(this.manifest, foundation, requestedAgeMa);
  }

  /** Warm adjacent checkpoint assets for upcoming exact-knot overlays. */
  async prefetchCheckpoints(ageMaList: readonly number[], signal?: AbortSignal): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    const foundation = await this.staticFoundation;
    if (this.lifetime.signal.aborted || signal?.aborted) return;
    const store = this.checkpointStore ??= new CaoCheckpointStore(this.manifest, foundation.core, this.fetcher);
    const unique = [...new Set(ageMaList.filter((age) => this.manifest.checkpoints
      .some((checkpoint) => checkpoint.ageMa === age)))].slice(0, 2);
    await Promise.all(unique.map(async (age) => {
      this.checkpointDemandAges.add(age);
      try {
        const loaded = await store.load(age, signal);
        this.warmedCheckpointAges.add(loaded.checkpoint.ageMa);
      } catch {
        // Prefetch remains opportunistic; a foreground prepare reports its own failure.
      } finally {
        this.checkpointDemandAges.delete(age);
      }
    }));
  }

  dispose(): void {
    this.active?.abort();
    this.tilePending?.controller.abort();
    this.background?.abort();
    this.lifetime.abort();
    this.checkpointStore?.dispose();
    for (const release of [...this.leases.values()]) release();
    this.timelineListeners.clear();
  }

  cancelActive(): void {
    this.active?.abort();
    this.active = null;
  }

  /** Supersedes pending foreground/background I/O before the App pumps the next frame. */
  prioritizeRequestedAge(requestedAgeMa: number): void {
    if (!Number.isFinite(requestedAgeMa)) return;
    this.prioritizeAge(requestedAgeMa);
  }

  get ledger() {
    const checkpoint = this.checkpointStore?.ledger ?? { residentCount: 0, pendingCount: 0,
      residentSourceBytes: 0, pendingReservedSourceBytes: 0, maximumResidentCount: 2, maximumPendingCount: 2 };
    const motionBytes = this.fullPaletteEntries ? this.manifest.motionPalette.binary.bytes
      : [...this.tileCache.values()].reduce((sum, tile) => sum + tile.descriptor.asset.bytes, 0)
        + (this.manifest.motionPalette.requestedAgeTiles?.bytes ?? 0);
    const foundationResidentSourceBytes = this.foundationStaticSourceBytes + motionBytes;
    const foregroundReservedSourceBytes = this.tilePending
      && !this.tileCache.has(this.tilePending.tileId) ? this.tilePending.assetBytes : 0;
    return Object.freeze({ foundationResidentSourceBytes,
      foregroundReservedSourceBytes,
      backgroundReservedSourceBytes: this.backgroundReservedSourceBytes,
      checkpoint, preparedLeaseCount: this.leases.size,
      totalRuntimeSourceBytes: foundationResidentSourceBytes + foregroundReservedSourceBytes
        + checkpoint.residentSourceBytes
        + checkpoint.pendingReservedSourceBytes + this.backgroundReservedSourceBytes });
  }

  subscribeTimelineLoading(listener: (state: CaoTimelineLoadingState) => void): () => void {
    this.timelineListeners.add(listener);
    listener(this.timelineState);
    return () => this.timelineListeners.delete(listener);
  }

  /**
   * Starts background timeline loading only after the latest requested age
   * reached the canvas. The work is age-independent: later foreground age
   * changes neither cancel nor restart it, and foreground tile fetches take
   * network priority over it.
   */
  markRendered(requestedAgeMa: number): void {
    if (!this.tileIndex || this.timelineComplete || requestedAgeMa !== this.foregroundAgeMa
        || this.background || this.lifetime.signal.aborted || this.timelineState.status === "paused") return;
    const controller = new AbortController();
    this.background = controller;
    this.backgroundReservedSourceBytes = this.fullPaletteEntries ? 0 : this.manifest.motionPalette.binary.bytes;
    this.setTimelineState({ ...this.timelineState, status: "loading", requestedAgeMa,
      foregroundStatus: "ready", motionTier: this.fullPaletteEntries ? "full" : "requested-age", error: null });
    const ownsBackground = () => this.background === controller && !controller.signal.aborted
      && !this.lifetime.signal.aborted;
    // A pending foreground tile owns the network until it lands.
    const foregroundIdle = async () => {
      while (this.tilePending && ownsBackground()) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    };
    // Main-thread decoding waits until scrubbing has rested, so it cannot
    // stall the frames a live gesture is producing.
    const foregroundSettled = async () => {
      await foregroundIdle();
      while (ownsBackground() && Date.now() - this.foregroundChangedAt < CAO_FOREGROUND_SETTLE_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
        await foregroundIdle();
      }
    };
    const yieldToForeground = async () => {
      await foregroundSettled();
      if (!ownsBackground()) throw new DOMException("stale Cao timeline loading", "AbortError");
    };
    const backgroundFetch = Object.freeze({ priority: "low" as const,
      yieldToForeground: foregroundIdle, beforeDecode: foregroundSettled });
    void Promise.all([this.metadata, this.staticFoundation]).then(async ([metadata, foundation]) => {
      if (!ownsBackground()) throw new DOMException("stale Cao timeline loading", "AbortError");
      if (!this.fullPaletteEntries) {
        const fullEntries = await loadVerifiedCaoFullMotionPalette(
          this.manifest, metadata, this.fetcher, controller.signal, backgroundFetch,
        );
        if (!ownsBackground()) throw new DOMException("stale Cao all-age palette", "AbortError");
        const witness = this.lastLoadedTile;
        if (!witness) throw new Error("no resident motion tile can verify the all-age Cao palette");
        await verifyRequestedAgeMotionTileSourceIdentity(witness.loaded.descriptor, witness.loaded.entries, fullEntries);
        if (!ownsBackground()) throw new DOMException("stale Cao all-age palette", "AbortError");
        const tileFrame = evaluateCaoMotionFrame(this.manifest,
          Object.freeze({ ...foundation, paletteEntries: witness.loaded.entries }), witness.requestedAgeMa);
        const fullFrame = evaluateCaoMotionFrame(this.manifest,
          Object.freeze({ ...foundation, paletteEntries: fullEntries }), witness.requestedAgeMa);
        if (!sameMotionFrame(tileFrame, fullFrame)) {
          throw new Error("requested-age motion tile disagrees with the all-age Cao palette");
        }
        this.fullPaletteEntries = fullEntries;
        this.backgroundReservedSourceBytes = 0;
        this.tileCache.clear();
        this.lastLoadedTile = null;
        this.setTimelineState({ ...this.timelineState, status: "loading",
          requestedAgeMa: this.foregroundAgeMa, motionTier: "full", error: null });
      }
      while (this.warmedCheckpointAges.size < this.manifest.checkpoints.length) {
        await yieldToForeground();
        const checkpoint = this.manifest.checkpoints.find((candidate) =>
          !this.warmedCheckpointAges.has(candidate.ageMa) && !this.checkpointDemandAges.has(candidate.ageMa));
        if (!checkpoint) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          if (!ownsBackground()) throw new DOMException("stale Cao timeline warming", "AbortError");
          continue;
        }
        this.backgroundReservedSourceBytes = checkpoint.transitiveBytes;
        await warmVerifiedCaoCheckpointAssets(
          this.manifest, foundation.core, checkpoint.ageMa, this.fetcher, controller.signal, backgroundFetch,
        );
        if (!ownsBackground()) throw new DOMException("stale Cao timeline warming", "AbortError");
        this.warmedCheckpointAges.add(checkpoint.ageMa);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      if (!ownsBackground()) throw new DOMException("stale Cao timeline warming", "AbortError");
      this.backgroundReservedSourceBytes = 0;
      this.timelineComplete = true;
      this.setTimelineState({ ...this.timelineState, status: "ready",
        requestedAgeMa: this.foregroundAgeMa, motionTier: "full", error: null });
    }).catch((error: unknown) => {
      if (this.background !== controller || this.lifetime.signal.aborted) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        this.setTimelineState({ ...this.timelineState, status: "idle",
          requestedAgeMa: this.foregroundAgeMa, error: null });
        return;
      }
      this.setTimelineState({ ...this.timelineState, status: "paused",
        requestedAgeMa: this.foregroundAgeMa,
        error: error instanceof Error ? error.message : "Timeline loading paused" });
    }).finally(() => {
      if (this.background === controller) {
        this.background = null;
        this.backgroundReservedSourceBytes = 0;
      }
    });
  }

  retryTimelineLoading(): void {
    if (this.timelineState.status !== "paused" || this.foregroundAgeMa === null) return;
    this.setTimelineState({ ...this.timelineState, status: "idle", error: null });
    this.markRendered(this.foregroundAgeMa);
  }

  private setTimelineState(state: CaoTimelineLoadingState): void {
    const current = this.timelineState;
    if (current.status === state.status && current.foregroundStatus === state.foregroundStatus
        && current.requestedAgeMa === state.requestedAgeMa && current.motionTier === state.motionTier
        && current.error === state.error) return;
    this.timelineState = Object.freeze(state);
    for (const listener of this.timelineListeners) listener(this.timelineState);
  }

  private tileCovering(requestedAgeMa: number): string | null {
    if (!this.resolvedTileIndex) return null;
    try {
      return selectRequestedAgeMotionTile(this.resolvedTileIndex, requestedAgeMa).tileId;
    } catch {
      return null;
    }
  }

  /** True when the age can be evaluated without any further fetch. */
  private motionResident(requestedAgeMa: number): boolean {
    if (this.fullPaletteEntries) return true;
    const tileId = this.tileCovering(requestedAgeMa);
    return tileId !== null && this.tileCache.has(tileId);
  }

  private prioritizeAge(requestedAgeMa: number): void {
    if (requestedAgeMa === this.foregroundAgeMa) return;
    this.foregroundAgeMa = requestedAgeMa;
    this.foregroundChangedAt = Date.now();
    this.active?.abort();
    this.active = null;
    // A pending tile that also covers the new age keeps downloading. Restarting
    // it on every scrub sample meant the tile only landed once the gesture
    // stopped. Only a tile for a different window is stale.
    if (this.tilePending && this.tilePending.tileId !== this.tileCovering(requestedAgeMa)) {
      this.tileSerial += 1;
      this.tilePending.controller.abort();
      this.tilePending = null;
    }
    // Background timeline loading is age-independent and continues untouched.
    this.setTimelineState({ ...this.timelineState, requestedAgeMa,
      foregroundStatus: this.motionResident(requestedAgeMa) ? "ready" : "loading",
      motionTier: this.fullPaletteEntries ? "full" : "requested-age" });
  }

  private foregroundReady(requestedAgeMa: number, serial: number, tier: "requested-age" | "full"): void {
    if (serial !== this.tileSerial || this.foregroundAgeMa !== requestedAgeMa) return;
    this.setTimelineState({ ...this.timelineState, foregroundStatus: "ready", requestedAgeMa,
      motionTier: tier });
  }

  private async motionForAge(requestedAgeMa: number): Promise<{
    readonly entries: ReadonlyMap<string, PreparedPaletteEntry>;
    readonly sourceBytes: number;
    readonly tier: "requested-age" | "full";
  }> {
    const serial = this.tileSerial;
    if (this.fullPaletteEntries) {
      this.foregroundReady(requestedAgeMa, serial, "full");
      return { entries: this.fullPaletteEntries,
        sourceBytes: this.manifest.motionPalette.binary.bytes, tier: "full" };
    }
    const metadata = await this.metadata;
    if (serial !== this.tileSerial || this.foregroundAgeMa !== requestedAgeMa) {
      throw new DOMException("stale requested-age motion tile", "AbortError");
    }
    if (!this.tileIndex) {
      const promise = this.foregroundFullPalette ??= loadVerifiedCaoFullMotionPalette(
        this.manifest, metadata, this.fetcher, this.lifetime.signal,
      );
      const entries = await promise;
      if (serial !== this.tileSerial || this.foregroundAgeMa !== requestedAgeMa) {
        throw new DOMException("stale Cao motion evaluation", "AbortError");
      }
      this.fullPaletteEntries = entries;
      this.foregroundReady(requestedAgeMa, serial, "full");
      return { entries, sourceBytes: this.manifest.motionPalette.binary.bytes, tier: "full" };
    }
    const index = await this.tileIndex;
    if (serial !== this.tileSerial || this.foregroundAgeMa !== requestedAgeMa) {
      throw new DOMException("stale requested-age motion tile", "AbortError");
    }
    const descriptor = selectRequestedAgeMotionTile(index, requestedAgeMa);
    const cached = this.tileCache.get(descriptor.tileId);
    if (cached) {
      this.lastLoadedTile = { loaded: cached, requestedAgeMa };
      this.foregroundReady(requestedAgeMa, serial, "requested-age");
      return { entries: cached.entries,
        sourceBytes: (this.manifest.motionPalette.requestedAgeTiles?.bytes ?? 0) + descriptor.asset.bytes,
        tier: "requested-age" };
    }
    if (this.tilePending?.tileId !== descriptor.tileId) {
      this.tilePending?.controller.abort();
      const controller = new AbortController();
      const pending = {} as NonNullable<typeof this.tilePending>;
      Object.assign(pending, { tileId: descriptor.tileId, assetBytes: descriptor.asset.bytes, controller,
        promise: loadVerifiedCaoRequestedAgeMotionPalette(
          this.manifest, metadata, requestedAgeMa, this.fetcher, controller.signal, index,
        ).finally(() => { if (this.tilePending === pending) this.tilePending = null; }) });
      this.tilePending = pending;
    }
    const loaded = await this.tilePending.promise;
    if (this.lifetime.signal.aborted) throw new DOMException("stale requested-age motion tile", "AbortError");
    if (this.fullPaletteEntries) {
      // The all-age palette landed while this tile was in flight; it was
      // verified against a resident tile, so the tile is now redundant.
      if (serial !== this.tileSerial || this.foregroundAgeMa !== requestedAgeMa) {
        throw new DOMException("stale requested-age motion tile", "AbortError");
      }
      this.foregroundReady(requestedAgeMa, serial, "full");
      return { entries: this.fullPaletteEntries,
        sourceBytes: this.manifest.motionPalette.binary.bytes, tier: "full" };
    }
    // A verified tile stays resident even when the age that asked for it has
    // moved on; the next evaluation in this window must not refetch it.
    this.tileCache.set(loaded.descriptor.tileId, loaded);
    while (this.tileCache.size > 2) this.tileCache.delete(this.tileCache.keys().next().value!);
    if (serial !== this.tileSerial || this.foregroundAgeMa !== requestedAgeMa) {
      throw new DOMException("stale requested-age motion tile", "AbortError");
    }
    this.lastLoadedTile = { loaded, requestedAgeMa };
    this.foregroundReady(requestedAgeMa, serial, "requested-age");
    return { entries: loaded.entries,
      sourceBytes: (this.manifest.motionPalette.requestedAgeTiles?.bytes ?? 0) + loaded.descriptor.asset.bytes,
      tier: "requested-age" };
  }

  private async foundationForAge(requestedAgeMa: number): Promise<MotionSelection> {
    const [foundation, motion] = await Promise.all([this.staticFoundation, this.motionForAge(requestedAgeMa)]);
    return Object.freeze({ foundation: Object.freeze({ ...foundation, paletteEntries: motion.entries }),
      sourceBytes: motion.sourceBytes, tier: motion.tier });
  }

  private async prepare(requestId: number, requestedAgeMa: number, signal: AbortSignal): Promise<PreparedCaoRevision> {
    const display = resolveCaoDisplayBracket(this.manifest, requestedAgeMa);
    const olderAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === display.olderAgeMa)!;
    const youngerAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === display.youngerAgeMa)!;
    const { foundation: motionFoundation, sourceBytes: motionSourceBytes } =
      await this.foundationForAge(requestedAgeMa);
    if (signal.aborted || requestId !== this.serial) throw new DOMException("stale Cao revision", "AbortError");
    const store = this.checkpointStore ??= new CaoCheckpointStore(this.manifest, motionFoundation.core, this.fetcher);
    this.checkpointDemandAges.add(youngerAsset.ageMa);
    this.checkpointDemandAges.add(olderAsset.ageMa);
    const youngerTask = store.load(youngerAsset.ageMa, signal);
    const olderTask = olderAsset.ageMa === youngerAsset.ageMa ? youngerTask
      : store.load(olderAsset.ageMa, signal);
    let youngerLoaded: Awaited<typeof youngerTask>;
    let olderLoaded: Awaited<typeof olderTask>;
    try {
      [youngerLoaded, olderLoaded] = await Promise.all([youngerTask, olderTask]);
      this.warmedCheckpointAges.add(youngerLoaded.checkpoint.ageMa);
      this.warmedCheckpointAges.add(olderLoaded.checkpoint.ageMa);
    } finally {
      this.checkpointDemandAges.delete(youngerAsset.ageMa);
      this.checkpointDemandAges.delete(olderAsset.ageMa);
    }
    const younger = youngerLoaded.checkpoint;
    const older = olderLoaded.checkpoint;
    if (signal.aborted || requestId !== this.serial) throw new DOMException("stale Cao revision", "AbortError");
    const motion = evaluateCaoMotionFrame(this.manifest, motionFoundation, requestedAgeMa);
    const { paletteEntries: _motionEntries, ...foundation } = motionFoundation;
    const boundaryLayer = display.exactCheckpoint ? youngerLoaded.boundary : null;
    const ownershipLayer = display.exactCheckpoint ? youngerLoaded.ownership : null;
    const countrySegmentDescriptors = (foundation.correctionCatalog?.nativeChartOverrides ?? []).flatMap((override) =>
      override.dependentConsumers.countrySegmentBindings.map((binding) => ({ override, binding })));
    const combinedRevision = motion.materialCorrectionIdentity
      ? `${this.manifest.revision}+${motion.materialCorrectionIdentity}` : this.manifest.revision;
    const identity = `${this.manifest.packageId}@${combinedRevision}:${requestId}`;
    let payload: typeof foundation | null = foundation;
    let motionValues: Float32Array | null = motion.paletteValues;
    let boundaryPoints = boundaryLayer?.points ?? null;
    let ownershipPoints = ownershipLayer?.points ?? null;
    const requirePayload = () => { if (!payload) throw new Error("Cao prepared revision released"); return payload; };
    const batches = foundation.core.spatialBatches.map((descriptor) => {
      const geometry = foundation.spatialBatches.get(descriptor.batchId)!;
      const youngerControl = younger.batchControls.find((control) => control.batchId === descriptor.batchId);
      const olderControl = older.batchControls.find((control) => control.batchId === descriptor.batchId);
      const youngerState = youngerControl?.state ?? (descriptor.staticDisplayControl
        ? { kind: "uniform" as const, ...descriptor.staticDisplayControl } : undefined);
      const olderState = olderControl?.state ?? (descriptor.staticDisplayControl
        ? { kind: "uniform" as const, ...descriptor.staticDisplayControl } : undefined);
      if (!youngerState || !olderState) throw new Error("Cao batch lacks display controls");
      const displayControl = (control: typeof youngerState) => control.kind === "uniform"
        ? Object.freeze({ kind: "uniform" as const, value: control.displayHeightMetres })
        : (() => { throw new Error("per-vertex Cao checkpoint state preparation is not implemented"); })();
      const color = youngerState.kind === "uniform" && olderState.kind === "uniform"
        ? Object.freeze({ kind: "uniform" as const, value: youngerState.baseColorRgb })
        : (() => { throw new Error("per-vertex Cao checkpoint color preparation is not implemented"); })();
      return Object.freeze({ batchId: descriptor.batchId,
        staticGeometryIdentity: `${identity.split(":")[0]}:${descriptor.batchId}:${descriptor.geometryAsset.sha256}`,
        vertexCount: descriptor.vertexCount, triangleCount: descriptor.triangleCount,
        nativePrecedence: descriptor.overlapPolicy === "native-visual-and-picking-precedence",
        surfaceAppearance: descriptor.surfaceAppearance,
        // Renderer copy excludes the EHGB header. Two narrowed chart-index
        // arrays together equal the source u32 chart-index storage.
        staticGeometryBytes: geometry.byteLength - 32
          + (foundation.core.charts.length <= 65_535 ? 0 : descriptor.vertexCount * 4),
        chartTriangleRanges: geometry.chartTriangleRanges,
        createStaticGeometryCopy: () => { const current = requirePayload().spatialBatches.get(descriptor.batchId)!;
          const narrow = foundation.core.charts.length <= 65_535;
          return { referenceDirections: new Float32Array(current.referenceDirections), indices: new Uint32Array(current.indices),
            seamIds: new Uint32Array(current.seamIds), preparedEntryIndices: narrow
              ? new Uint16Array(current.vertexChartIndices) : new Uint32Array(current.vertexChartIndices),
            materialChartIndices: narrow ? new Uint16Array(current.vertexChartIndices) : new Uint32Array(current.vertexChartIndices) }; },
        createDisplayControlsCopy: () => { requirePayload(); return { displayHeightStart: displayControl(youngerState),
          displayHeightEnd: displayControl(olderState), baseColor: color }; },
      });
    });
    const lineBatches = (foundation.core.lineBatches ?? []).map((descriptor) => {
      const geometry = foundation.lineBatches.get(descriptor.batchId)!;
      const narrow = motion.charts.length <= 65_535;
      const remapped = new Uint32Array(geometry.vertexChartIndices);
      for (const [segmentChartOffset, segment] of countrySegmentDescriptors.entries()) {
        if (segment.binding.batchId !== descriptor.batchId) continue;
        const left = geometry.lineIndices[segment.binding.segmentIndex * 2]!;
        const right = geometry.lineIndices[segment.binding.segmentIndex * 2 + 1]!;
        const chartIndex = foundation.core.charts.length + segmentChartOffset;
        remapped[left] = chartIndex;
        remapped[right] = chartIndex;
      }
      return Object.freeze({ batchId: descriptor.batchId,
        staticGeometryIdentity: `${identity.split(":")[0]}:${descriptor.batchId}:${descriptor.geometryAsset.sha256}`
          + (countrySegmentDescriptors.length ? ":source-domain-segments-v1" : ""),
        vertexCount: descriptor.vertexCount, segmentCount: descriptor.segmentCount,
        staticGeometryBytes: geometry.byteLength - 32 + (narrow ? 0 : descriptor.vertexCount * 4),
        createStaticGeometryCopy: () => { const current = requirePayload().lineBatches.get(descriptor.batchId)!;
          return Object.freeze({ referenceDirections: new Float32Array(current.referenceDirections),
            lineIndices: new Uint32Array(current.lineIndices), preparedEntryIndices: narrow
              ? new Uint16Array(remapped) : new Uint32Array(remapped),
            materialChartIndices: narrow ? new Uint16Array(remapped) : new Uint32Array(remapped) }); },
      });
    });
    const release = () => {
      payload = null;
      motionValues = null;
      boundaryPoints = null;
      ownershipPoints = null;
      this.leases.delete(identity);
    };
    const nativeBoundary = boundaryLayer?.kind === "boundary" ? Object.freeze({ kind: "exact-source" as const,
      sourceAgeMa: younger.ageMa, value: Object.freeze({ segments: boundaryLayer.catalog.segments,
        pointCount: boundaryLayer.points.pointCount, sourceBytes: boundaryLayer.points.byteLength,
        createDirectionsCopy: () => { requirePayload(); if (!boundaryPoints) throw new Error("Cao prepared revision released");
          return new Float32Array(boundaryPoints.directions); } }) })
      : Object.freeze({ kind: "unavailable" as const, requestedAgeMa,
        reason: display.exactCheckpoint ? "source-absent" as const : "fractional-topology-unqualified" as const });
    const topologyOwnership = ownershipLayer?.kind === "ownership" ? Object.freeze({ kind: "exact-source" as const,
      sourceAgeMa: younger.ageMa, value: Object.freeze({ rings: ownershipLayer.catalog.rings,
        pointCount: ownershipLayer.points.pointCount, sourceBytes: ownershipLayer.points.byteLength,
        createDirectionsCopy: () => { requirePayload(); if (!ownershipPoints) throw new Error("Cao prepared revision released");
          return new Float32Array(ownershipPoints.directions); } }) })
      : Object.freeze({ kind: "unavailable" as const, requestedAgeMa,
        reason: display.exactCheckpoint ? "source-absent" as const : "fractional-topology-unqualified" as const });
    this.leases.set(identity, release);
    return Object.freeze({ identity, requestId, packageId: this.manifest.packageId,
      packageRevision: combinedRevision,
      materialCorrectionIdentity: motion.materialCorrectionIdentity,
      materialCorrections: motion.materialCorrections,
      requestedAgeMa, frameIdentity: packageFrameIdentity(this.manifest.frame),
      display: Object.freeze({ youngerAgeMa: display.youngerAgeMa, olderAgeMa: display.olderAgeMa,
        fraction: display.fraction }),
      motionPalette: Object.freeze({ stride: PREPARED_MOTION_PALETTE_STRIDE,
        entryCount: motion.entryCount, createValuesCopy: () => { requirePayload();
          if (!motionValues) throw new Error("Cao prepared revision released"); return new Float32Array(motionValues); } }),
      batches: Object.freeze(batches), lineBatches: Object.freeze(lineBatches), nativeBoundary,
      topologyOwnership, charts: motion.charts, anchorIds: motion.anchorIds,
      activeSourceBytes: this.manifest.core.bytes + this.manifest.motionPalette.catalog.bytes
        + motionSourceBytes + (this.manifest.materialCorrections?.catalog.bytes ?? 0)
        + [...foundation.spatialBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + [...foundation.lineBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + (foundation.core.anchorCatalog?.bytes ?? 0)
        + youngerAsset.transitiveBytes
        + (olderAsset.ageMa === youngerAsset.ageMa ? 0 : olderAsset.transitiveBytes),
      addressForChartDirection: (chartIndex: number, directionAtReference: readonly [number, number, number]) => {
        requirePayload();
        return motion.addressForChartDirection(chartIndex, directionAtReference);
      },
      resolveAddress: (address: MaterialAddress) => { requirePayload(); return motion.resolveAddress(address); },
      resolveAnchor: (anchorId: string) => { requirePayload(); return motion.resolveAnchor(anchorId); },
      release });
  }
}
