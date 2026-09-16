import { packageFrameIdentity } from "./identity";
import {
  CaoSurfaceResidencyStore,
  checkpointUnit,
  intervalUnit,
  loadVerifiedCaoFoundationMetadata,
  loadVerifiedCaoFullMotionPalette,
  loadVerifiedCaoStaticFoundation,
  loadVerifiedPalaeoClassCatalogs,
  selectPalaeoIntervalForAge,
  warmVerifiedCaoCheckpointAssets,
  type LoadedCaoFoundation,
  type SurfaceUnitId,
  type LoadedPalaeoClassCatalog,
  type LoadedPalaeoInterval,
} from "./loaderV2";
import { createPalaeoTriangulationRunner, type PalaeoTriangulationRunner } from "./palaeoTriangulate";
import { createPreparedCaoPalaeoInterval, evaluateCaoPalaeoIntervalFrame,
  type CaoPalaeoIntervalFrame, type PreparedCaoPalaeoInterval } from "./palaeoIntervalV2";
import { loadVerifiedBytes } from "./assetLoader";
import type { PalaeoSurfaceClass } from "./palaeoRings";
import type { StaticAssetFetcher } from "./assetLoader";
import { immutableReconstructionPackageManifestV2, type PalaeoCoastlineSurfaceClassId,
  type ReconstructionPackageManifestV2 } from "./packageV2";
import { PREPARED_MOTION_PALETTE_STRIDE, type PreparedCaoRevision } from "./facadeV2";
import { prepareSurfaceBatch } from "./surfaceSource";
import { evaluateCaoMotionFrame, resolveCaoDisplayBracket, type CaoMotionFrame } from "./motionFrameV2";
import type { MaterialAddress } from "./types";
import type { PreparedPaletteEntry } from "./palette";

/**
 * How far inside its own half-open `(TOAGE, FROMAGE]` range an outgoing
 * interval is posed once the age has left it. Ten times finer than the 0.01 Ma
 * seam padding the compiled intervals carry, so the clamp always lands inside
 * the range and never inside the neighbour's.
 */
const PALAEO_INTERVAL_EDGE_MA = 0.001;

/** Background warming waits until the foreground age has rested this long. */
export const CAO_FOREGROUND_SETTLE_MS = 250;

export interface CaoTimelineLoadingState {
  readonly status: "idle" | "loading" | "ready" | "paused";
  readonly foregroundStatus: "idle" | "loading" | "ready";
  readonly requestedAgeMa: number | null;
  readonly error: string | null;
}

type MotionSelection = {
  readonly foundation: LoadedCaoFoundation;
  readonly sourceBytes: number;
};

export class CaoReconstructionRuntime {
  private serial = 0;
  private active: AbortController | null = null;
  private readonly lifetime = new AbortController();
  private readonly metadata;
  private readonly staticFoundation;
  private foundationStaticSourceBytes = 0;
  private foregroundAgeMa: number | null = null;
  private foregroundChangedAt = 0;
  private fullPaletteEntries: ReadonlyMap<string, PreparedPaletteEntry> | null = null;
  /**
   * The one in-flight fetch-and-decode of the whole motion palette, shared by
   * the native and palaeo request chains. Cleared on failure so a retried
   * request refetches rather than replaying the rejection forever.
   */
  private motionPalettePending: Promise<ReadonlyMap<string, PreparedPaletteEntry>> | null = null;
  private background: AbortController | null = null;
  private readonly warmedCheckpointAges = new Set<number>();
  private readonly checkpointDemandAges = new Set<number>();
  private timelineComplete = false;
  private backgroundReservedSourceBytes = 0;
  private timelineState: CaoTimelineLoadingState = Object.freeze({
    status: "idle", foregroundStatus: "idle", requestedAgeMa: null, error: null,
  });
  private readonly timelineListeners = new Set<(state: CaoTimelineLoadingState) => void>();
  /**
   * One residency owner over both streaming units. Which bounded cache a
   * `SurfaceUnitId` belongs to, and whether the palaeo half exists at all, is
   * its question rather than this class's.
   */
  private readonly surfaces: CaoSurfaceResidencyStore;
  private readonly leases = new Map<string, () => void>();
  /**
   * Palaeo-coastline mode runs its own request chain: its own serial, abort
   * controller, lease counter and interval store, so turning the mode on or
   * scrubbing across a map interval never disturbs a native prepare in flight.
   */
  private palaeoEnabled = false;
  private palaeoSerial = 0;
  private palaeoActive: AbortController | null = null;
  private palaeoCatalogController: AbortController | null = null;
  private palaeoCatalogs: Promise<readonly LoadedPalaeoClassCatalog[]> | null = null;
  private resolvedPalaeoCatalogs: readonly LoadedPalaeoClassCatalog[] | null = null;
  private palaeoPendingIntervalId: string | null = null;
  private palaeoRunner: PalaeoTriangulationRunner | null = null;
  private palaeoOutlineTones: Promise<Uint8Array> | null = null;
  private readonly palaeoLeases = new Map<string, () => void>();

  readonly manifest: ReconstructionPackageManifestV2;

  constructor(manifest: ReconstructionPackageManifestV2, private readonly fetcher: StaticAssetFetcher) {
    this.manifest = immutableReconstructionPackageManifestV2(manifest);
    this.surfaces = new CaoSurfaceResidencyStore(this.manifest, fetcher);
    this.metadata = loadVerifiedCaoFoundationMetadata(this.manifest, fetcher, this.lifetime.signal);
    this.staticFoundation = this.metadata.then((metadata) =>
      loadVerifiedCaoStaticFoundation(this.manifest, metadata, fetcher, this.lifetime.signal));
    // The whole palette is the only motion path: start it with the foundation
    // so the first frame waits on one decode rather than a per-age window.
    void this.motionPalette().catch(() => {});
    void this.staticFoundation.then((foundation) => {
      this.foundationStaticSourceBytes = this.manifest.core.bytes + this.manifest.motionPalette.catalog.bytes
        + [...foundation.spatialBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + [...foundation.lineBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + (foundation.core.anchorCatalog?.bytes ?? 0)
        + (this.manifest.materialCorrections?.catalog.bytes ?? 0);
    }).catch(() => {});
    void this.staticFoundation.catch(() => {});
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
    this.surfaces.checkpointStore(foundation.core);
    const unique = [...new Set(ageMaList.filter((age) => this.manifest.checkpoints
      .some((checkpoint) => checkpoint.ageMa === age)))].slice(0, 2);
    await Promise.all(unique.map(async (age) => {
      this.checkpointDemandAges.add(age);
      try {
        const loaded = await this.surfaces.load(checkpointUnit(age), signal);
        if (loaded.kind === "checkpoint") this.warmedCheckpointAges.add(loaded.value.checkpoint.ageMa);
      } catch {
        // Prefetch remains opportunistic; a foreground prepare reports its own failure.
      } finally {
        this.checkpointDemandAges.delete(age);
      }
    }));
  }

  dispose(): void {
    this.active?.abort();
    this.background?.abort();
    this.lifetime.abort();
    this.palaeoActive?.abort();
    this.palaeoCatalogController?.abort();
    this.surfaces.dispose();
    this.palaeoRunner?.dispose();
    this.palaeoRunner = null;
    this.palaeoCatalogs = null;
    this.resolvedPalaeoCatalogs = null;
    for (const release of [...this.leases.values()]) release();
    for (const release of [...this.palaeoLeases.values()]) release();
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
    const checkpoint = this.surfaces.checkpointLedger;
    const motionBytes = this.fullPaletteEntries ? this.manifest.motionPalette.binary.bytes : 0;
    const foundationResidentSourceBytes = this.foundationStaticSourceBytes + motionBytes;
    const foregroundReservedSourceBytes = this.fullPaletteEntries || !this.motionPalettePending
      ? 0 : this.manifest.motionPalette.binary.bytes;
    const palaeoStore = this.surfaces.intervalLedger;
    const palaeoCatalogBytes = this.resolvedPalaeoCatalogs
      ? this.resolvedPalaeoCatalogs.reduce((sum, entry) => sum + entry.asset.bytes, 0) : 0;
    const palaeo = Object.freeze({ enabled: this.palaeoEnabled, catalogSourceBytes: palaeoCatalogBytes,
      intervalStore: palaeoStore, preparedLeaseCount: this.palaeoLeases.size,
      totalSourceBytes: palaeoCatalogBytes + palaeoStore.residentSourceBytes
        + palaeoStore.pendingReservedSourceBytes });
    return Object.freeze({ foundationResidentSourceBytes,
      foregroundReservedSourceBytes,
      backgroundReservedSourceBytes: this.backgroundReservedSourceBytes,
      checkpoint, preparedLeaseCount: this.leases.size, palaeo,
      totalRuntimeSourceBytes: foundationResidentSourceBytes + foregroundReservedSourceBytes
        + checkpoint.residentSourceBytes
        + checkpoint.pendingReservedSourceBytes + this.backgroundReservedSourceBytes
        + palaeo.totalSourceBytes });
  }

  subscribeTimelineLoading(listener: (state: CaoTimelineLoadingState) => void): () => void {
    this.timelineListeners.add(listener);
    listener(this.timelineState);
    return () => this.timelineListeners.delete(listener);
  }

  /**
   * Starts background checkpoint warming only after the latest requested age
   * reached the canvas. The work is age-independent: later foreground age
   * changes neither cancel nor restart it, and it yields the main thread back
   * to a live gesture before every decode.
   */
  markRendered(requestedAgeMa: number): void {
    if (this.timelineComplete || requestedAgeMa !== this.foregroundAgeMa
        || this.background || this.lifetime.signal.aborted || this.timelineState.status === "paused") return;
    const controller = new AbortController();
    this.background = controller;
    this.setTimelineState({ ...this.timelineState, status: "loading", requestedAgeMa,
      foregroundStatus: "ready", error: null });
    const ownsBackground = () => this.background === controller && !controller.signal.aborted
      && !this.lifetime.signal.aborted;
    // Main-thread decoding waits until scrubbing has rested, so it cannot
    // stall the frames a live gesture is producing.
    const foregroundSettled = async () => {
      while (ownsBackground() && Date.now() - this.foregroundChangedAt < CAO_FOREGROUND_SETTLE_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
      }
    };
    const yieldToForeground = async () => {
      await foregroundSettled();
      if (!ownsBackground()) throw new DOMException("stale Cao timeline loading", "AbortError");
    };
    const backgroundFetch = Object.freeze({ priority: "low" as const, beforeDecode: foregroundSettled });
    void this.staticFoundation.then(async (foundation) => {
      if (!ownsBackground()) throw new DOMException("stale Cao timeline loading", "AbortError");
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
        requestedAgeMa: this.foregroundAgeMa, error: null });
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
        && current.requestedAgeMa === state.requestedAgeMa && current.error === state.error) return;
    this.timelineState = Object.freeze(state);
    for (const listener of this.timelineListeners) listener(this.timelineState);
  }

  private prioritizeAge(requestedAgeMa: number): void {
    if (requestedAgeMa === this.foregroundAgeMa) return;
    this.foregroundAgeMa = requestedAgeMa;
    this.foregroundChangedAt = Date.now();
    this.active?.abort();
    this.active = null;
    // The motion palette covers every age, so changing the age starts no motion
    // I/O and cancels none: only the resident palette decides readiness.
    // Background timeline warming is age-independent and continues untouched.
    this.setTimelineState({ ...this.timelineState, requestedAgeMa,
      foregroundStatus: this.fullPaletteEntries ? "ready" : "loading" });
  }

  private foregroundReady(requestedAgeMa: number): void {
    if (this.foregroundAgeMa !== requestedAgeMa) return;
    this.setTimelineState({ ...this.timelineState, foregroundStatus: "ready", requestedAgeMa });
  }

  /**
   * The whole motion palette, fetched and decoded exactly once and shared by
   * both request chains. A failure clears the pending promise so the next
   * request refetches instead of replaying the rejection for the session.
   */
  private motionPalette(): Promise<ReadonlyMap<string, PreparedPaletteEntry>> {
    return this.motionPalettePending ??= this.metadata
      .then((metadata) => loadVerifiedCaoFullMotionPalette(
        this.manifest, metadata, this.fetcher, this.lifetime.signal))
      .then((entries) => {
        this.fullPaletteEntries = entries;
        return entries;
      })
      .catch((error: unknown) => {
        this.motionPalettePending = null;
        throw error;
      });
  }

  private async motionForAge(requestedAgeMa: number): Promise<{
    readonly entries: ReadonlyMap<string, PreparedPaletteEntry>;
    readonly sourceBytes: number;
  }> {
    if (this.fullPaletteEntries) {
      this.foregroundReady(requestedAgeMa);
      return { entries: this.fullPaletteEntries, sourceBytes: this.manifest.motionPalette.binary.bytes };
    }
    const entries = await this.motionPalette();
    if (this.foregroundAgeMa !== requestedAgeMa || this.lifetime.signal.aborted) {
      throw new DOMException("stale Cao motion evaluation", "AbortError");
    }
    this.foregroundReady(requestedAgeMa);
    return { entries, sourceBytes: this.manifest.motionPalette.binary.bytes };
  }

  private async foundationForAge(requestedAgeMa: number): Promise<MotionSelection> {
    const [foundation, motion] = await Promise.all([this.staticFoundation, this.motionForAge(requestedAgeMa)]);
    return Object.freeze({ foundation: Object.freeze({ ...foundation, paletteEntries: motion.entries }),
      sourceBytes: motion.sourceBytes });
  }


  // -------------------------------------------------------------------------
  // palaeo-coastline map intervals
  // -------------------------------------------------------------------------

  /**
   * Turns the Cao 2017 palaeogeography mode on or off. Enabling loads and
   * validates the declared class catalogs; disabling retires every palaeo
   * resource this runtime owns — leases, store, worker — because nothing in the
   * mode is drawn while it is off and zero palaeo bytes may stay resident.
   */
  setPalaeoCoastlinesEnabled(enabled: boolean): void {
    if (this.lifetime.signal.aborted) throw new Error("Cao reconstruction runtime disposed");
    const palaeo = this.manifest.palaeoCoastlines;
    if (enabled && !palaeo) throw new Error("Cao package has no palaeo-coastline section");
    if (enabled === this.palaeoEnabled) return;
    this.palaeoEnabled = enabled;
    // Every in-flight palaeo prepare is stale the moment the mode changes.
    this.palaeoSerial += 1;
    this.palaeoActive?.abort();
    this.palaeoActive = null;
    this.palaeoPendingIntervalId = null;
    if (enabled) {
      const controller = new AbortController();
      this.palaeoCatalogController = controller;
      this.palaeoRunner ??= createPalaeoTriangulationRunner();
      this.palaeoCatalogs = loadVerifiedPalaeoClassCatalogs(palaeo!, this.fetcher, controller.signal);
      void this.palaeoCatalogs.catch(() => {});
      return;
    }
    for (const release of [...this.palaeoLeases.values()]) release();
    this.palaeoCatalogController?.abort();
    this.palaeoCatalogController = null;
    this.palaeoCatalogs = null;
    this.resolvedPalaeoCatalogs = null;
    this.surfaces.detachIntervals();
    this.palaeoRunner?.dispose();
    this.palaeoRunner = null;
    this.palaeoOutlineTones = null;
  }

  get palaeoCoastlinesEnabled(): boolean {
    return this.palaeoEnabled;
  }

  /** Whether this package ships the Cao 2017 charts at all; false disables the control. */
  get palaeoCoastlineAssetsAvailable(): boolean {
    return this.manifest.palaeoCoastlines !== undefined;
  }

  /**
   * The Cao 2017 classes this package actually publishes.
   *
   * The compiler validates all four classes offline but the budget funds only
   * some of them, so the shipped set is a package fact rather than a constant.
   * The map key reads it: a swatch for a class no interval carries would
   * promise evidence the globe never draws.
   */
  get palaeoCoastlineSurfaceClasses(): readonly PalaeoCoastlineSurfaceClassId[] {
    return Object.freeze((this.manifest.palaeoCoastlines?.classes ?? [])
      .map((entry) => entry.surfaceClass));
  }

  /** Outstanding palaeo interval leases. A toggle must always bring this back to 0. */
  get palaeoLeaseCount(): number {
    return this.palaeoLeases.size;
  }

  /**
   * The EHPT outline tone tables, fetched and digest-verified once per
   * enablement. The bytes are the whole 24-table set — about 72 KiB for the
   * shipped outline — so the interval change that follows a scrub is a decode
   * and an upload, never a second fetch; turning the mode off drops them with
   * everything else the mode owns.
   */
  async loadPalaeoOutlineToneTables(signal?: AbortSignal): Promise<Uint8Array> {
    const palaeo = this.manifest.palaeoCoastlines;
    if (!palaeo) throw new Error("Cao package has no palaeo-coastline section");
    if (!this.palaeoEnabled) throw new Error("palaeo-coastline mode is disabled");
    const pending = this.palaeoOutlineTones ??= loadVerifiedBytes(
      palaeo.outlineTones.binary, this.fetcher, this.lifetime.signal,
    ).then((bytes) => new Uint8Array(bytes));
    pending.catch(() => { if (this.palaeoOutlineTones === pending) this.palaeoOutlineTones = null; });
    const tones = await pending;
    if (signal?.aborted || !this.palaeoEnabled) {
      throw new DOMException("stale palaeo-coastline tone table", "AbortError");
    }
    return tones;
  }

  /**
   * The same re-pose, evaluated synchronously from resident data, or null.
   *
   * The native surface — and the country outlines drawn on it — is retargeted
   * from a resident palette inside one call, so a palaeo pose that has to wait
   * for a promise and a React commit cannot land on the same frame as the
   * outlines it must move with. There is no await here, so the residency this
   * checks is the residency it uses: nothing can toggle the mode or change the
   * interval between the check and the frame. An age whose interval or palette
   * is not resident answers null, and the async path above still owns the fetch.
   */
  evaluatePalaeoMotionNow(
    requestedAgeMa: number,
    publishedIntervalId?: string | null,
  ): CaoPalaeoIntervalFrame | null {
    const resident = this.residentPalaeoMotionInputs(requestedAgeMa, publishedIntervalId ?? null);
    if (resident === null) return null;
    return evaluateCaoPalaeoIntervalFrame(
      resident.interval, resident.paletteEntries, resident.poseAgeMa);
  }

  /**
   * Whether `evaluatePalaeoMotionNow` can answer this age without a fetch. The
   * owner of the async retarget reads it to stand down where the synchronous
   * path already poses the age, instead of posing it a second time one commit
   * later — two poses for one sample is the stepping it was meant to remove.
   */
  palaeoMotionResidentAt(requestedAgeMa: number, publishedIntervalId?: string | null): boolean {
    return this.residentPalaeoMotionInputs(requestedAgeMa, publishedIntervalId ?? null) !== null;
  }

  private residentPalaeoMotionInputs(
    requestedAgeMa: number,
    publishedIntervalId: string | null,
  ): {
    readonly interval: LoadedPalaeoInterval;
    readonly paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>;
    /** The age the pose is evaluated at: the requested one, or the outgoing interval's edge. */
    readonly poseAgeMa: number;
  } | null {
    if (!this.manifest.palaeoCoastlines || !this.palaeoEnabled
        || this.lifetime.signal.aborted) return null;
    const catalogs = this.resolvedPalaeoCatalogs;
    if (!catalogs) return null;
    this.surfaces.noteCurrentAge(requestedAgeMa);
    const record = selectPalaeoIntervalForAge(catalogs, requestedAgeMa);
    // The geometry on screen is the published interval's. Once the age has
    // crossed a boundary the incoming interval is not published yet, and posing
    // its charts onto the outgoing geometry is refused by the renderer — which
    // is what froze the layer from the boundary until the swap landed. Keeping
    // the outgoing interval posed at its own edge instead holds the charts on
    // the last age the drawn geometry can honestly carry, for the one or two
    // frames the swap takes.
    const published = publishedIntervalId === null || record?.intervalId === publishedIntervalId
      ? null : this.residentInterval(publishedIntervalId);
    const interval = published
      ?? (record ? this.residentInterval(record.intervalId) : null);
    if (!interval) return null;
    const poseAgeMa = published === null ? requestedAgeMa
      : Math.min(interval.fromAgeMa, Math.max(requestedAgeMa, interval.toAgeMa + PALAEO_INTERVAL_EDGE_MA));
    const paletteEntries = this.residentPaletteEntries();
    return paletteEntries === null ? null : { interval, paletteEntries, poseAgeMa };
  }

  /** A map interval already decoded, without starting a load of any kind. */
  private residentInterval(intervalId: string): LoadedPalaeoInterval | null {
    const resident = this.surfaces.resident(intervalUnit(intervalId));
    return resident?.kind === "interval" ? resident.value : null;
  }

  /** The palette entries already in hand: the whole palette, or nothing yet. */
  private residentPaletteEntries(): ReadonlyMap<string, PreparedPaletteEntry> | null {
    return this.fullPaletteEntries;
  }

  /**
   * Re-poses the resident map interval at a new age without replacing its
   * geometry: the interval is the streaming unit, so every age inside one is a
   * palette retarget. Answers null wherever the interval is not already
   * resident, so a scrub sample can never start a fetch of its own — the
   * foreground `requestPalaeoInterval` owns that, and its publication carries
   * the pose the retarget would have supplied.
   */
  async evaluatePalaeoMotion(requestedAgeMa: number): Promise<CaoPalaeoIntervalFrame | null> {
    const palaeo = this.manifest.palaeoCoastlines;
    if (!palaeo || !this.palaeoEnabled || this.lifetime.signal.aborted) return null;
    const catalogs = this.resolvedPalaeoCatalogs;
    if (!catalogs) return null;
    const record = selectPalaeoIntervalForAge(catalogs, requestedAgeMa);
    if (!record) return null;
    const interval = this.residentInterval(record.intervalId);
    if (!interval) return null;
    const serial = this.palaeoSerial;
    const paletteEntries = await this.palaeoPaletteEntries();
    // Re-checked after the only await: a mode toggle or an interval change
    // during the palette wait makes this frame a pose for geometry that is no
    // longer on screen.
    if (!this.palaeoEnabled || serial !== this.palaeoSerial || this.lifetime.signal.aborted) {
      throw new DOMException("stale palaeo-coastline motion evaluation", "AbortError");
    }
    return evaluateCaoPalaeoIntervalFrame(interval, paletteEntries, requestedAgeMa);
  }

  /**
   * Prepares the published map interval covering one age. A request for an age
   * still inside the interval already in flight keeps that load running: the
   * interval is the streaming unit, and restarting it on every scrub sample
   * would mean it only ever landed once the gesture stopped.
   */
  requestPalaeoInterval(requestedAgeMa: number): {
    readonly signal: AbortSignal;
    readonly prepared: Promise<PreparedCaoPalaeoInterval>;
  } {
    if (this.lifetime.signal.aborted) throw new Error("Cao reconstruction runtime disposed");
    const palaeo = this.manifest.palaeoCoastlines;
    if (!palaeo) throw new Error("Cao package has no palaeo-coastline section");
    if (!this.palaeoEnabled) throw new Error("palaeo-coastline mode is disabled");
    if (!Number.isFinite(requestedAgeMa) || requestedAgeMa < palaeo.ageDomainMa.youngest
        || requestedAgeMa > palaeo.ageDomainMa.oldest) {
      throw new Error("age outside the palaeo-coastline domain");
    }
    if (this.palaeoLeases.size >= 2) {
      throw new Error("release a palaeo-coastline interval before requesting another");
    }
    const intervalId = this.resolvedPalaeoCatalogs
      ? selectPalaeoIntervalForAge(this.resolvedPalaeoCatalogs, requestedAgeMa)?.intervalId ?? null
      : null;
    if (this.palaeoPendingIntervalId !== null && intervalId !== this.palaeoPendingIntervalId) {
      this.palaeoActive?.abort();
    }
    if (intervalId !== null) this.palaeoPendingIntervalId = intervalId;
    const controller = new AbortController();
    this.palaeoActive = controller;
    return { signal: controller.signal,
      prepared: this.preparePalaeo(++this.palaeoSerial, requestedAgeMa, controller.signal) };
  }

  /** Warms the interval covering an age without taking a lease or reporting failure. */
  async prefetchPalaeoInterval(requestedAgeMa: number, signal?: AbortSignal): Promise<void> {
    const palaeo = this.manifest.palaeoCoastlines;
    if (!palaeo || !this.palaeoEnabled || this.lifetime.signal.aborted) return;
    const serial = this.palaeoSerial;
    try {
      const catalogs = await this.palaeoCatalogs;
      if (!catalogs || !this.palaeoEnabled || serial !== this.palaeoSerial || signal?.aborted) return;
      this.resolvedPalaeoCatalogs = catalogs;
      const record = selectPalaeoIntervalForAge(catalogs, requestedAgeMa);
      if (!record) return;
      this.attachIntervalStore(palaeo, catalogs);
      await this.surfaces.load(intervalUnit(record.intervalId), signal);
    } catch {
      // Prefetch stays opportunistic; a foreground request reports its own failure.
    }
  }

  private attachIntervalStore(
    palaeo: NonNullable<ReconstructionPackageManifestV2["palaeoCoastlines"]>,
    catalogs: readonly LoadedPalaeoClassCatalog[],
  ): void {
    this.palaeoRunner ??= createPalaeoTriangulationRunner();
    this.surfaces.intervalStore(palaeo, catalogs, this.palaeoRunner);
  }

  /**
   * Palette entries for a palaeo pose, resolved without touching the foreground
   * age state the native request chain owns. Both chains join the one shared
   * palette load, so a palaeo pose never starts motion I/O of its own.
   */
  private palaeoPaletteEntries(): Promise<ReadonlyMap<string, PreparedPaletteEntry>> {
    return this.fullPaletteEntries
      ? Promise.resolve(this.fullPaletteEntries) : this.motionPalette();
  }

  private async preparePalaeo(
    requestId: number,
    requestedAgeMa: number,
    signal: AbortSignal,
  ): Promise<PreparedCaoPalaeoInterval> {
    const palaeo = this.manifest.palaeoCoastlines!;
    // Re-checked after every await: a mode toggle or an interval change makes a
    // prepare stale even though its own fetches are still succeeding.
    const requireCurrent = () => {
      if (signal.aborted || requestId !== this.palaeoSerial || !this.palaeoEnabled
          || this.lifetime.signal.aborted) {
        throw new DOMException("stale palaeo-coastline interval", "AbortError");
      }
    };
    requireCurrent();
    const pending = this.palaeoCatalogs;
    if (!pending) throw new Error("palaeo-coastline mode is disabled");
    const catalogs = await pending;
    requireCurrent();
    this.resolvedPalaeoCatalogs = catalogs;
    const record = selectPalaeoIntervalForAge(catalogs, requestedAgeMa);
    if (!record) throw new Error("no palaeo-coastline interval covers the requested age");
    this.attachIntervalStore(palaeo, catalogs);
    // The foreground age is what residency is kept around: a prefetched
    // neighbour must not be evicted for being the one nobody has read yet.
    this.surfaces.noteCurrentAge(requestedAgeMa);
    const loaded = await this.surfaces.load(intervalUnit(record.intervalId), signal);
    if (loaded.kind !== "interval") throw new Error("palaeo-coastline request resolved a native unit");
    const interval = loaded.value;
    requireCurrent();
    const paletteEntries = await this.palaeoPaletteEntries();
    requireCurrent();
    const frame = evaluateCaoPalaeoIntervalFrame(interval, paletteEntries, requestedAgeMa);
    const baseColorRgb = Object.fromEntries(palaeo.classes.map((entry) =>
      [entry.surfaceClass, entry.baseColorRgb])) as Record<PalaeoSurfaceClass,
      readonly [number, number, number]>;
    const prepared = createPreparedCaoPalaeoInterval(interval, frame, {
      requestId, packageId: this.manifest.packageId, packageRevision: this.manifest.revision,
      frameIdentity: packageFrameIdentity(this.manifest.frame), baseColorRgb,
    }, (identity) => { this.palaeoLeases.delete(identity); });
    this.palaeoLeases.set(prepared.identity, prepared.release);
    return prepared;
  }

  private async prepare(requestId: number, requestedAgeMa: number, signal: AbortSignal): Promise<PreparedCaoRevision> {
    const display = resolveCaoDisplayBracket(this.manifest, requestedAgeMa);
    const olderAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === display.olderAgeMa)!;
    const youngerAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === display.youngerAgeMa)!;
    const { foundation: motionFoundation, sourceBytes: motionSourceBytes } =
      await this.foundationForAge(requestedAgeMa);
    if (signal.aborted || requestId !== this.serial) throw new DOMException("stale Cao revision", "AbortError");
    this.surfaces.checkpointStore(motionFoundation.core);
    this.checkpointDemandAges.add(youngerAsset.ageMa);
    this.checkpointDemandAges.add(olderAsset.ageMa);
    const loadCheckpoint = async (ageMa: number) => {
      const loaded = await this.surfaces.load(checkpointUnit(ageMa), signal);
      if (loaded.kind !== "checkpoint") throw new Error("Cao request resolved a palaeo unit");
      return loaded.value;
    };
    const youngerTask = loadCheckpoint(youngerAsset.ageMa);
    const olderTask = olderAsset.ageMa === youngerAsset.ageMa ? youngerTask
      : loadCheckpoint(olderAsset.ageMa);
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
      // The renderer copy excludes the EHGB header, and the byte ledger the
      // surface-source path derives accounts for the chart-index width; both
      // arms of that path state the same prepared shape.
      return prepareSurfaceBatch({ kind: "ehgb", batchId: descriptor.batchId,
        staticGeometryIdentity: `${identity.split(":")[0]}:${descriptor.batchId}:${descriptor.geometryAsset.sha256}`,
        vertexCount: descriptor.vertexCount, triangleCount: descriptor.triangleCount,
        chartCount: foundation.core.charts.length,
        nativePrecedence: descriptor.overlapPolicy === "native-visual-and-picking-precedence",
        surfaceAppearance: descriptor.surfaceAppearance,
        chartTriangleRanges: geometry.chartTriangleRanges,
        requireGeometry: () => requirePayload().spatialBatches.get(descriptor.batchId)!,
        displayControls: () => { requirePayload(); return { displayHeightStart: displayControl(youngerState),
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
