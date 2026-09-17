import { packageFrameIdentity } from "./identity";
import {
  CaoSurfaceResidencyStore,
  DEFAULT_SURFACE_RESIDENCY_POLICY,
  checkpointUnit,
  intervalUnit,
  loadVerifiedCaoFoundationMetadata,
  loadVerifiedCaoFullMotionPalette,
  loadVerifiedCaoStaticFoundation,
  loadVerifiedPalaeoClassCatalogs,
  palaeoWarmWindowIntervalIds,
  selectPalaeoIntervalForAge,
  surfaceUnitsEqual,
  warmVerifiedCaoCheckpointAssets,
  type LoadedCaoFoundation,
  type SurfaceResidencyPolicy,
  type SurfaceUnitId,
  type LoadedPalaeoClassCatalog,
  type LoadedPalaeoInterval,
} from "./loaderV2";
import { createPalaeoTriangulationRunner, type PalaeoTriangulationRunner } from "./palaeoTriangulate";
import { createPreparedCaoPalaeoInterval, evaluateCaoPalaeoIntervalFrame,
  type CaoPalaeoIntervalFrame, type PreparedCaoPalaeoInterval } from "./palaeoIntervalV2";
import { loadVerifiedBytes } from "./assetLoader";
import { palaeoIntervalCoversAge, type PalaeoSurfaceClass } from "./palaeoRings";
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
 * interval's support age is held once the live age has left it. Ten times finer
 * than the 0.01 Ma seam padding the compiled intervals carry, so the clamp
 * always lands inside the range and never inside the neighbour's.
 */
const PALAEO_INTERVAL_EDGE_MA = 0.001;

/**
 * The age one interval's lifecycles may be judged at: the requested age, held
 * inside that interval's own half-open `(TOAGE, FROMAGE]` range.
 *
 * Every evaluation of a map interval passes through this, because the interval
 * a caller holds is not always one that contains the age. Two ways it is not.
 * Across a boundary the outgoing map is still the geometry on screen while the
 * live age has already moved into the next interval. And inside the 0.01 Ma
 * seam between two adjacent published intervals — the ages the padded exclusive
 * bound `58.01` leaves above the neighbour's inclusive `58` — the selector
 * deliberately answers the older interval rather than no map at all, so the age
 * it hands back is a hair *below* that interval's own young edge. Passing
 * either age through unheld made `evaluateCaoPalaeoIntervalFrame` throw out of
 * the render-loop effect, which unmounted the globe: measured 2026-09-17 at the
 * 58 Ma end of a 117 -> 58 scrub, where the slider's round-trip lands the age
 * at 58.00000000000009 and the seam fallback answers `81-58`.
 */
function palaeoSupportAgeMa(
  interval: { readonly fromAgeMa: number; readonly toAgeMa: number },
  requestedAgeMa: number,
): number {
  return Math.min(interval.fromAgeMa,
    Math.max(requestedAgeMa, interval.toAgeMa + PALAEO_INTERVAL_EDGE_MA));
}

/** Background warming waits until the foreground age has rested this long. */
export const CAO_FOREGROUND_SETTLE_MS = 250;

/**
 * Deadline the background interval scheduler gives `requestIdleCallback` before
 * it takes the next job anyway. Long enough that a busy main thread keeps its
 * frames, short enough that a quiet tab prepares the 25 intervals in seconds.
 */
export const PALAEO_BACKGROUND_IDLE_TIMEOUT_MS = 200;

/** How long the scheduler waits before re-checking a foreground request in flight. */
export const PALAEO_BACKGROUND_FOREGROUND_WAIT_MS = 25;

/**
 * One map interval the background walk has finished preparing, as the scene's
 * idle pre-upload reads it: the id to ask for, and the age band that orders the
 * queue nearest-first.
 */
export interface PalaeoPreparedInterval {
  readonly intervalId: string;
  readonly fromAgeMa: number;
  readonly toAgeMa: number;
}

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

/**
 * One request chain, keyed by the kind of `SurfaceUnitId` it streams.
 *
 * Both kinds run the same shape — a serial that makes older work stale, one
 * in-flight abort controller, the unit that work is for, and a bounded set of
 * prepared leases — and they used to run it twice, in two sets of fields whose
 * only real difference was three words of policy. The policy is now data:
 *
 *  - `maximumLeases`, because the two publications are budgeted separately (two
 *    native revisions, two map intervals); a chain full of native leases must
 *    not refuse a map interval.
 *  - `supersedesSameUnit`, because a native prepare is per-age and every request
 *    supersedes the last, while an interval is the streaming unit for a whole
 *    band of ages: restarting it on every scrub sample meant it only ever landed
 *    once the gesture stopped.
 *
 * Keeping them separate *instances* is the point. Turning the mode on, or
 * scrubbing across a map interval, must not disturb a native prepare in flight,
 * so neither chain's serial or controller may be the other's.
 */
interface SurfaceRequestChain {
  serial: number;
  active: AbortController | null;
  /** The unit the in-flight request is for; null before any catalog resolves. */
  pendingUnit: SurfaceUnitId | null;
  readonly leases: Map<string, () => void>;
  readonly maximumLeases: number;
  readonly supersedesSameUnit: boolean;
  readonly leaseBudgetMessage: string;
}

function createSurfaceRequestChain(
  maximumLeases: number,
  supersedesSameUnit: boolean,
  leaseBudgetMessage: string,
): SurfaceRequestChain {
  return { serial: 0, active: null, pendingUnit: null, leases: new Map(), maximumLeases,
    supersedesSameUnit, leaseBudgetMessage };
}

export class CaoReconstructionRuntime {
  /**
   * The two chains, keyed by unit kind. `checkpoint` streams the Cao 2024
   * revision for a requested age — the age is the key even though the display
   * bracket resolves two checkpoints from it — and `interval` streams one Cao
   * 2017 map interval.
   */
  private readonly chains: Readonly<Record<SurfaceUnitId["kind"], SurfaceRequestChain>> = Object.freeze({
    checkpoint: createSurfaceRequestChain(2, true,
      "release a Cao prepared revision before requesting another"),
    interval: createSurfaceRequestChain(2, false,
      "release a palaeo-coastline interval before requesting another"),
  });
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
  private palaeoEnabled = false;
  private palaeoCatalogController: AbortController | null = null;
  private palaeoCatalogs: Promise<readonly LoadedPalaeoClassCatalog[]> | null = null;
  private resolvedPalaeoCatalogs: readonly LoadedPalaeoClassCatalog[] | null = null;
  private palaeoRunner: PalaeoTriangulationRunner | null = null;
  private palaeoOutlineTones: Promise<Uint8Array> | null = null;
  private palaeoOutlineTonesResident = false;
  /**
   * The background interval scheduler: one controller per enablement, the id it
   * is working on, the ids it has already taken, and whether every interval of
   * this enablement has been through it. A crossing is only free if the
   * interval it enters was prepared before the scrub reached it, so after the
   * first publish this walks the rest of the timeline at idle priority.
   */
  private palaeoBackgroundController: AbortController | null = null;
  private palaeoPreparingIntervalId: string | null = null;
  /** Whether the walk has prepared every interval of the *window*, not of the timeline. */
  private palaeoBackgroundComplete = false;
  private readonly palaeoPreparedIntervalIds = new Set<string>();
  /**
   * The warm window: how many intervals it spans, which ids it covers now, and
   * who is told when it moves. The renderer owns the span — a low profile or a
   * small device takes a narrower one — and sets it through
   * `setPalaeoWarmWindowIntervals`; the default is the policy's.
   */
  private palaeoWarmWindowIntervals = DEFAULT_SURFACE_RESIDENCY_POLICY.warmWindowIntervals;
  private palaeoWindowIntervalIds: readonly string[] = Object.freeze([]);
  /** The interval the window is centred on; null before the first one is drawn. */
  private palaeoDrawnIntervalId: string | null = null;
  private readonly palaeoWindowListeners = new Set<(intervalIds: readonly string[]) => void>();
  /** Told the id of each interval the walk finishes; see `onPalaeoIntervalPrepared`. */
  private readonly palaeoPreparedListeners = new Set<(notice: PalaeoPreparedInterval) => void>();
  /**
   * Prepared intervals handed out off the request chain, for the revision
   * identity alone. Negative because it is not a request serial: an idle
   * pre-upload must not supersede the foreground request in flight, and reusing
   * the chain's counter here would make every prepared identity ambiguous.
   */
  private palaeoPreloadSerial = 0;
  /**
   * Frames the synchronous pose declined to evaluate, cumulative for the life
   * of the runtime. A scrub that leaves this at 0 never had to skip; a rising
   * count is the layer standing on its previous pose, which is visible only
   * here.
   */
  private palaeoSkippedFrames = 0;
  /**
   * Foreground `requestPalaeoInterval` calls still in flight. The scheduler
   * starts no job while this is above zero: a background fetch and decode must
   * never be what the interval a crossing is waiting for queues behind.
   */
  private palaeoForegroundRequests = 0;
  /** The age the scheduler orders its remaining intervals around. */
  private palaeoRequestedAgeMa: number | null = null;

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
    this.guardLeaseBudget("checkpoint");
    this.prioritizeAge(requestedAgeMa);
    const { controller, requestId } = this.beginRequest("checkpoint", checkpointUnit(requestedAgeMa));
    return { signal: controller.signal, prepared: this.prepare(requestId, requestedAgeMa, controller.signal) };
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
    this.chains.checkpoint.active?.abort();
    this.chains.interval.active?.abort();
    this.background?.abort();
    this.stopPalaeoBackgroundPreparation();
    this.lifetime.abort();
    this.palaeoCatalogController?.abort();
    this.surfaces.dispose();
    this.palaeoRunner?.dispose();
    this.palaeoRunner = null;
    this.palaeoCatalogs = null;
    this.resolvedPalaeoCatalogs = null;
    this.palaeoOutlineTones = null;
    this.palaeoOutlineTonesResident = false;
    for (const chain of Object.values(this.chains)) {
      for (const release of [...chain.leases.values()]) release();
    }
    this.timelineListeners.clear();
  }

  cancelActive(): void {
    this.chains.checkpoint.active?.abort();
    this.chains.checkpoint.active = null;
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
    // The tone tables are the mode's third resident asset beside the catalogs
    // and the interval payloads: one fetch per enablement, held until the mode
    // is turned off. They were missing here, so the only place the runtime
    // reported them was folded into the *drawn interval's* bytes by the
    // renderer — a 311 KiB constant charged to every interval in turn. The
    // store total says them once; `activeSourceBytes` stays the interval alone.
    const palaeoToneBytes = this.palaeoOutlineTonesResident
      ? this.manifest.palaeoCoastlines?.outlineTones.binary.bytes ?? 0 : 0;
    const palaeo = Object.freeze({ enabled: this.palaeoEnabled, catalogSourceBytes: palaeoCatalogBytes,
      outlineToneSourceBytes: palaeoToneBytes,
      // The background scheduler's progress. `preparedIntervals` is what is
      // decoded and resident right now — an eviction under the byte ceiling or
      // a window re-centre lowers it — so a consumer that keys a dataset on
      // "every interval the window covers is in hand" reads
      // `backgroundPreparationComplete` beside it. That flag means the *window*
      // is complete, not the timeline: the walk stops at the window edge, and
      // the flag drops back to false each time the window moves.
      preparedIntervals: palaeoStore.residentCount,
      preparingIntervalId: this.palaeoPreparingIntervalId,
      // The ids the warm window covers right now: the drawn interval and its
      // neighbours by schedule index. `preparedIntervals` converges on this
      // many, not on the 25 of the timeline.
      windowIntervals: this.palaeoWindowIntervalIds,
      backgroundPreparationComplete: this.palaeoBackgroundComplete,
      intervalStore: palaeoStore, preparedLeaseCount: this.chains.interval.leases.size,
      skippedFrames: this.palaeoSkippedFrames,
      totalSourceBytes: palaeoCatalogBytes + palaeoToneBytes + palaeoStore.residentSourceBytes
        + palaeoStore.pendingReservedSourceBytes });
    return Object.freeze({ foundationResidentSourceBytes,
      foregroundReservedSourceBytes,
      backgroundReservedSourceBytes: this.backgroundReservedSourceBytes,
      checkpoint, preparedLeaseCount: this.chains.checkpoint.leases.size, palaeo,
      totalRuntimeSourceBytes: foundationResidentSourceBytes + foregroundReservedSourceBytes
        + checkpoint.residentSourceBytes
        + checkpoint.pendingReservedSourceBytes + this.backgroundReservedSourceBytes
        + palaeo.totalSourceBytes });
  }

  /**
   * The residency policy both halves run under: the pinned units, the interval
   * LRU bounds, and the D1 knob. Read by the renderer side to decide whether a
   * composition may hand back the GPU buffers it replaced.
   */
  get surfaceResidencyPolicy(): SurfaceResidencyPolicy {
    return this.surfaces.policy;
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

  /**
   * Refuses a request the chain has no lease left for. Separate from
   * `beginRequest` because the budget is checked before anything else the
   * request would do: a refused request must not have moved the foreground age
   * or aborted the work in flight.
   */
  private guardLeaseBudget(kind: SurfaceUnitId["kind"]): void {
    const chain = this.chains[kind];
    if (chain.leases.size >= chain.maximumLeases) throw new Error(chain.leaseBudgetMessage);
  }

  /** Supersedes the work in flight per the chain's policy and opens a new request. */
  private beginRequest(
    kind: SurfaceUnitId["kind"],
    unit: SurfaceUnitId | null,
  ): { readonly controller: AbortController; readonly requestId: number } {
    const chain = this.chains[kind];
    if (chain.supersedesSameUnit
        || (chain.pendingUnit !== null && !surfaceUnitsEqual(unit, chain.pendingUnit))) {
      chain.active?.abort();
    }
    if (unit !== null) chain.pendingUnit = unit;
    const controller = new AbortController();
    chain.active = controller;
    return { controller, requestId: ++chain.serial };
  }

  private prioritizeAge(requestedAgeMa: number): void {
    if (requestedAgeMa === this.foregroundAgeMa) return;
    this.foregroundAgeMa = requestedAgeMa;
    this.foregroundChangedAt = Date.now();
    this.chains.checkpoint.active?.abort();
    this.chains.checkpoint.active = null;
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
    // Every in-flight interval request is stale the moment the mode changes,
    // and so is everything the background scheduler prepared for the enablement
    // that is ending: turning the mode off frees the store, so the ids it holds
    // would name intervals nothing is keeping.
    this.stopPalaeoBackgroundPreparation();
    this.palaeoBackgroundComplete = false;
    this.palaeoPreparedIntervalIds.clear();
    this.palaeoRequestedAgeMa = null;
    // The window is a property of the enablement that is ending: its listeners
    // are told it covers nothing, so a scene retires the members it warmed for
    // it rather than holding them across a mode toggle.
    this.palaeoDrawnIntervalId = null;
    if (this.palaeoWindowIntervalIds.length > 0) {
      this.palaeoWindowIntervalIds = Object.freeze([]);
      this.surfaces.setWindowIntervalIds([]);
      for (const listener of [...this.palaeoWindowListeners]) {
        try {
          listener(this.palaeoWindowIntervalIds);
        } catch {
          // A toggle is not a listener's error path.
        }
      }
    }
    const chain = this.chains.interval;
    chain.serial += 1;
    chain.active?.abort();
    chain.active = null;
    chain.pendingUnit = null;
    if (enabled) {
      const controller = new AbortController();
      this.palaeoCatalogController = controller;
      this.palaeoRunner ??= createPalaeoTriangulationRunner();
      this.palaeoCatalogs = loadVerifiedPalaeoClassCatalogs(palaeo!, this.fetcher, controller.signal);
      void this.palaeoCatalogs.catch(() => {});
      return;
    }
    for (const release of [...chain.leases.values()]) release();
    this.palaeoCatalogController?.abort();
    this.palaeoCatalogController = null;
    this.palaeoCatalogs = null;
    this.resolvedPalaeoCatalogs = null;
    this.surfaces.detachIntervals();
    this.palaeoRunner?.dispose();
    this.palaeoRunner = null;
    this.palaeoOutlineTones = null;
    this.palaeoOutlineTonesResident = false;
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
    return this.chains.interval.leases.size;
  }

  /**
   * The EHPT outline tone tables, fetched and digest-verified once per
   * enablement. The bytes are the whole 24-table set — 311 KiB for the shipped
   * Natural Earth 1:50m outline, four times the 72 KiB of the 1:110m one it
   * replaced — so the interval change that follows a scrub is a decode and an
   * upload, never a second fetch; turning the mode off drops them with
   * everything else the mode owns. The ledger counts these bytes once, under
   * `palaeo.outlineToneSourceBytes`; they are not an interval's bytes.
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
    if (this.palaeoOutlineTones === pending) this.palaeoOutlineTonesResident = true;
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
    // The clamp above is the contract; this is the assertion that it held. A
    // pose is one frame of an optional layer, so an age this runtime cannot
    // honour against the interval it holds skips the frame — the previous pose
    // stands — rather than throwing into the render loop that called it.
    if (!Number.isFinite(resident.poseAgeMa)
        || !palaeoIntervalCoversAge(resident.supportAgeMa,
          resident.interval.fromAgeMa, resident.interval.toAgeMa)) {
      this.palaeoSkippedFrames += 1;
      return null;
    }
    return evaluateCaoPalaeoIntervalFrame(
      resident.interval, resident.paletteEntries, resident.poseAgeMa, resident.supportAgeMa);
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
    /** The age the charts are posed at: the live requested age. */
    readonly poseAgeMa: number;
    /** The age their lifecycles are judged at: inside the drawn interval's range. */
    readonly supportAgeMa: number;
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
    // is what froze the layer from the boundary until the swap landed. The
    // outgoing interval is retargeted instead, and the two ages part company
    // for the one or two frames the swap takes: the pieces keep rotating with
    // the live age, because the palette is one continuous rotation history and
    // the country outlines are already moving on it, while their lifecycles are
    // judged just inside the drawn interval. That edge is not a preference —
    // the compiled lifecycles of the pieces this interval owns end at its own
    // young edge, so judging them at a live age past the boundary would report
    // them consumed and blank the map rather than move it.
    const published = publishedIntervalId === null || record?.intervalId === publishedIntervalId
      ? null : this.residentInterval(publishedIntervalId);
    const interval = published
      ?? (record ? this.residentInterval(record.intervalId) : null);
    if (!interval) return null;
    // Held for every interval, not only the outgoing one: the selector's seam
    // fallback answers an interval that does not contain the age either, and
    // that age reaches here with `published === null` because the seam's own
    // interval is the one already published.
    const supportAgeMa = palaeoSupportAgeMa(interval, requestedAgeMa);
    const paletteEntries = this.residentPaletteEntries();
    return paletteEntries === null ? null
      : { interval, paletteEntries, poseAgeMa: requestedAgeMa, supportAgeMa };
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
    const serial = this.chains.interval.serial;
    const paletteEntries = await this.palaeoPaletteEntries();
    // Re-checked after the only await: a mode toggle or an interval change
    // during the palette wait makes this frame a pose for geometry that is no
    // longer on screen.
    if (!this.palaeoEnabled || serial !== this.chains.interval.serial || this.lifetime.signal.aborted) {
      throw new DOMException("stale palaeo-coastline motion evaluation", "AbortError");
    }
    return evaluateCaoPalaeoIntervalFrame(interval, paletteEntries, requestedAgeMa,
      palaeoSupportAgeMa(interval, requestedAgeMa));
  }

  /**
   * Notified with the interval id each time the background walk finishes
   * preparing one. The scene subscribes so it can upload that interval as a
   * hidden GPU member while the main thread is idle, which is what makes a
   * first visit to a prepared interval cost what a return visit costs. Answers
   * the unsubscribe.
   */
  onPalaeoIntervalPrepared(listener: (notice: PalaeoPreparedInterval) => void): () => void {
    this.palaeoPreparedListeners.add(listener);
    return () => { this.palaeoPreparedListeners.delete(listener); };
  }

  /**
   * Notified with the warm window's ids each time it re-centres. The scene
   * subscribes so it can retire the GPU members and the queued pre-uploads the
   * window no longer covers: the heap the window bounds is held on both sides
   * of the publish, and evicting only the store's half would leave the warmed
   * member — and the CPU arrays it aliases — alive. Answers the unsubscribe.
   */
  onPalaeoWarmWindowChanged(listener: (intervalIds: readonly string[]) => void): () => void {
    this.palaeoWindowListeners.add(listener);
    return () => { this.palaeoWindowListeners.delete(listener); };
  }

  /**
   * How many intervals the warm window spans, drawn one included. The renderer
   * owns this: the window exists to bound the heap that a warmed GPU member
   * pins, so the profile that decides how many members may be resident is the
   * one that decides how many intervals are prepared for them.
   */
  setPalaeoWarmWindowIntervals(count: number): void {
    const span = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
    if (span === this.palaeoWarmWindowIntervals) return;
    this.palaeoWarmWindowIntervals = span;
    this.recentrePalaeoWarmWindow(this.palaeoDrawnIntervalId);
  }

  /** The ids the warm window covers now; empty before the first interval is drawn. */
  get palaeoWarmWindow(): readonly string[] {
    return this.palaeoWindowIntervalIds;
  }

  /**
   * Re-centres the warm window on the interval being drawn.
   *
   * Cheap by construction: it computes ids, drops the store's references to
   * what the window no longer covers, and tells its listeners. Nothing here
   * fetches, decodes, uploads or retires — the newly covered intervals are
   * prepared by the background walk's idle slot, and the listeners take their
   * own retirements at idle — so a crossing that calls this never waits for the
   * window it moved.
   */
  private recentrePalaeoWarmWindow(drawnIntervalId: string | null): void {
    this.palaeoDrawnIntervalId = drawnIntervalId;
    const catalogs = this.resolvedPalaeoCatalogs;
    const radius = Math.floor((this.palaeoWarmWindowIntervals - 1) / 2);
    const next = catalogs === null ? Object.freeze([])
      : palaeoWarmWindowIntervalIds(catalogs, drawnIntervalId, radius);
    if (next.length === this.palaeoWindowIntervalIds.length
        && next.every((id, index) => this.palaeoWindowIntervalIds[index] === id)) return;
    // The first centring is the one the first crossing makes, and that crossing
    // starts the walk itself once it has published. Only a *re*-centre has to
    // restart it, so the first map still never queues behind the window.
    const recentred = this.palaeoWindowIntervalIds.length > 0;
    this.palaeoWindowIntervalIds = next;
    this.surfaces.setWindowIntervalIds(next);
    const covered = new Set(next);
    // An interval the window dropped must be a candidate again: the walk skips
    // what it has already taken, and a scrub that comes back to it would
    // otherwise find it neither prepared nor queued to be.
    for (const id of [...this.palaeoPreparedIntervalIds]) {
      if (!covered.has(id)) this.palaeoPreparedIntervalIds.delete(id);
    }
    for (const listener of [...this.palaeoWindowListeners]) {
      try {
        listener(next);
      } catch {
        // A listener that could not take the window still draws correctly; it
        // holds more than the window until the next re-centre it does take.
      }
    }
    // The window grew or moved, so there is work again even if the last walk
    // reported the previous window complete.
    this.palaeoBackgroundComplete = false;
    if (recentred) this.startPalaeoBackgroundPreparation();
  }

  private notePalaeoIntervalPrepared(intervalId: string): void {
    const interval = this.residentInterval(intervalId);
    if (interval === null) return;
    const notice: PalaeoPreparedInterval = Object.freeze({ intervalId,
      fromAgeMa: interval.fromAgeMa, toAgeMa: interval.toAgeMa });
    for (const listener of [...this.palaeoPreparedListeners]) {
      try {
        listener(notice);
      } catch {
        // The walk is not a listener's error path; a scene that could not take
        // the notification still gets the interval on the crossing that needs it.
      }
    }
  }

  /**
   * A prepared revision for an interval that is already resident, built
   * synchronously and off the request chain.
   *
   * `requestPalaeoInterval` is the foreground path: it supersedes whatever is
   * in flight, which is right for a crossing and wrong for an idle pre-upload
   * that must be invisible to the scrub. This answers null wherever the
   * interval or the palette is not already in hand — it starts no fetch, takes
   * no lease budget from a request that could still arrive, and never
   * supersedes one — so the caller either gets a revision it can upload now or
   * nothing at all.
   *
   * The pose is the interval's own midpoint. Nothing draws this revision: the
   * crossing that makes its member current publishes its own age onto the
   * resident buffers, so the age this was posed at never reaches the screen.
   */
  prepareResidentPalaeoIntervalNow(intervalId: string): PreparedCaoPalaeoInterval | null {
    const palaeo = this.manifest.palaeoCoastlines;
    if (!palaeo || !this.palaeoEnabled || this.lifetime.signal.aborted) return null;
    // Never spends the last lease a foreground crossing is entitled to.
    const chain = this.chains.interval;
    if (chain.leases.size + 1 >= chain.maximumLeases) return null;
    const interval = this.residentInterval(intervalId);
    const paletteEntries = this.residentPaletteEntries();
    if (!interval || !paletteEntries) return null;
    const midpointAgeMa = (interval.fromAgeMa + interval.toAgeMa) / 2;
    if (!palaeoIntervalCoversAge(midpointAgeMa, interval.fromAgeMa, interval.toAgeMa)) return null;
    const frame = evaluateCaoPalaeoIntervalFrame(interval, paletteEntries,
      midpointAgeMa, midpointAgeMa);
    this.palaeoPreloadSerial -= 1;
    const prepared = createPreparedCaoPalaeoInterval(interval, frame, {
      requestId: this.palaeoPreloadSerial, packageId: this.manifest.packageId,
      packageRevision: this.manifest.revision,
      frameIdentity: packageFrameIdentity(this.manifest.frame),
      baseColorRgb: this.palaeoBaseColors(palaeo),
    }, (identity) => { this.chains.interval.leases.delete(identity); });
    this.chains.interval.leases.set(prepared.identity, prepared.release);
    return prepared;
  }

  private palaeoBaseColors(
    palaeo: NonNullable<ReconstructionPackageManifestV2["palaeoCoastlines"]>,
  ): Record<PalaeoSurfaceClass, readonly [number, number, number]> {
    return Object.fromEntries(palaeo.classes.map((entry) =>
      [entry.surfaceClass, entry.baseColorRgb])) as Record<PalaeoSurfaceClass,
      readonly [number, number, number]>;
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
    this.guardLeaseBudget("interval");
    const intervalId = this.resolvedPalaeoCatalogs
      ? selectPalaeoIntervalForAge(this.resolvedPalaeoCatalogs, requestedAgeMa)?.intervalId ?? null
      : null;
    const { controller, requestId } = this.beginRequest("interval",
      intervalId === null ? null : intervalUnit(intervalId));
    return { signal: controller.signal,
      prepared: this.preparePalaeo(requestId, requestedAgeMa, controller.signal) };
  }

  /** Warms the interval covering an age without taking a lease or reporting failure. */
  async prefetchPalaeoInterval(requestedAgeMa: number, signal?: AbortSignal): Promise<void> {
    const palaeo = this.manifest.palaeoCoastlines;
    if (!palaeo || !this.palaeoEnabled || this.lifetime.signal.aborted) return;
    const serial = this.chains.interval.serial;
    try {
      const catalogs = await this.palaeoCatalogs;
      if (!catalogs || !this.palaeoEnabled || serial !== this.chains.interval.serial
          || signal?.aborted) return;
      this.resolvedPalaeoCatalogs = catalogs;
      const record = selectPalaeoIntervalForAge(catalogs, requestedAgeMa);
      if (!record) return;
      this.attachIntervalStore(palaeo, catalogs);
      await this.surfaces.load(intervalUnit(record.intervalId), signal);
      this.palaeoPreparedIntervalIds.add(record.intervalId);
    } catch {
      // Prefetch stays opportunistic; a foreground request reports its own failure.
    }
  }

  /**
   * Prepares the intervals the warm window covers, in the background.
   *
   * Started by the first interval that publishes: before that there is nothing
   * on screen to protect, and the first map must not queue behind the window.
   * From then on the window is walked nearest-by-age first, one job at a time,
   * at idle priority, so a crossing finds the interval it enters already
   * fetched, decoded and triangulated instead of paying for all three on the
   * frame that needs the geometry.
   *
   * It stops at the window edge rather than walking the whole timeline. A
   * prepared interval retains the decoded arrays its warmed GPU member aliases,
   * so "all 25" was ~163 MB of heap that nothing would release; the window is
   * what bounds it. Each re-centre restarts the walk on whatever the window
   * newly covers.
   */
  private startPalaeoBackgroundPreparation(): void {
    if (this.palaeoBackgroundController !== null || this.palaeoBackgroundComplete
        || !this.palaeoEnabled || this.lifetime.signal.aborted) return;
    const controller = new AbortController();
    this.palaeoBackgroundController = controller;
    void this.runPalaeoBackgroundPreparation(controller).catch(() => {
      // The scheduler is opportunistic: a foreground request reports its own
      // failure, and an interval this could not prepare is still fetched on the
      // crossing that needs it.
    }).finally(() => {
      if (this.palaeoBackgroundController === controller) {
        this.palaeoBackgroundController = null;
        this.palaeoPreparingIntervalId = null;
      }
    });
  }

  /** Cancels the scheduler and the job it has in flight. */
  private stopPalaeoBackgroundPreparation(): void {
    this.palaeoBackgroundController?.abort();
    this.palaeoBackgroundController = null;
    this.palaeoPreparingIntervalId = null;
  }

  private async runPalaeoBackgroundPreparation(controller: AbortController): Promise<void> {
    const owns = () => this.palaeoBackgroundController === controller && !controller.signal.aborted
      && !this.lifetime.signal.aborted && this.palaeoEnabled;
    while (owns()) {
      // Yield first, every time round: the pause is what keeps this off the
      // frames a live gesture is producing, and a foreground request that
      // arrives mid-walk holds the next job back until it has landed.
      await this.pausePalaeoBackgroundPreparation();
      if (!owns()) return;
      if (this.palaeoForegroundRequests > 0) continue;
      const catalogs = this.resolvedPalaeoCatalogs;
      if (catalogs === null) return;
      const intervalId = this.nextPalaeoIntervalToPrepare(catalogs);
      if (intervalId === null) {
        this.palaeoPreparingIntervalId = null;
        // The window is complete, not the timeline: a re-centre clears this and
        // starts the walk again on what the window newly covers.
        this.palaeoBackgroundComplete = true;
        return;
      }
      this.palaeoPreparingIntervalId = intervalId;
      // Taken before the load, not after it: an interval whose payload cannot
      // be prepared must leave the queue anyway, or the walk spins on it and
      // never reaches the intervals behind it.
      this.palaeoPreparedIntervalIds.add(intervalId);
      try {
        await this.surfaces.load(intervalUnit(intervalId), controller.signal);
        // Told only on the walk's own success, and only once per interval: the
        // scene's idle pre-upload is what turns a prepared interval into a
        // hidden GPU member, and an interval that failed to prepare has no
        // geometry to upload.
        if (owns()) this.notePalaeoIntervalPrepared(intervalId);
      } catch {
        // Opportunistic; the crossing that needs this interval loads it itself.
      }
      if (this.palaeoPreparingIntervalId === intervalId) this.palaeoPreparingIntervalId = null;
    }
  }

  /**
   * One idle slot, or a fixed wait while a foreground request is in flight.
   * `requestIdleCallback` where the browser has it, a zero-delay timeout
   * otherwise — Safari and the test environment both take the timeout.
   */
  private pausePalaeoBackgroundPreparation(): Promise<void> {
    if (this.palaeoForegroundRequests > 0) {
      return new Promise<void>((resolve) =>
        void setTimeout(resolve, PALAEO_BACKGROUND_FOREGROUND_WAIT_MS));
    }
    const requestIdle = (globalThis as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;
    return new Promise<void>((resolve) => {
      if (typeof requestIdle === "function") {
        requestIdle(() => resolve(), { timeout: PALAEO_BACKGROUND_IDLE_TIMEOUT_MS });
        return;
      }
      void setTimeout(resolve, 0);
    });
  }

  /**
   * The next interval to prepare: nearest by age to the one being drawn, ties
   * broken by the published interval order, and never one the warm window has
   * stopped covering. Nearest first because a scrub reaches the neighbours
   * before it reaches the window edge, so the order the walk takes is the order
   * the crossings will.
   */
  private nextPalaeoIntervalToPrepare(catalogs: readonly LoadedPalaeoClassCatalog[]): string | null {
    const ageMa = this.palaeoRequestedAgeMa;
    // Null, not an empty set, while no interval has been drawn: an empty window
    // is "nothing is covered yet", and the walk only ever runs after a publish.
    const window = this.palaeoWindowIntervalIds.length === 0
      ? null : new Set(this.palaeoWindowIntervalIds);
    const distance = (record: { readonly fromAgeMa: number; readonly toAgeMa: number }): number => {
      if (ageMa === null) return 0;
      if (ageMa > record.fromAgeMa) return ageMa - record.fromAgeMa;
      if (ageMa <= record.toAgeMa) return record.toAgeMa - ageMa;
      return 0;
    };
    let best: { readonly intervalId: string; readonly distance: number;
      readonly intervalIndex: number } | null = null;
    for (const entry of catalogs) {
      for (const record of entry.catalog.intervals) {
        if (window !== null && !window.has(record.intervalId)) continue;
        if (this.palaeoPreparedIntervalIds.has(record.intervalId)) continue;
        if (this.surfaces.isResident(intervalUnit(record.intervalId))) continue;
        const candidate = { intervalId: record.intervalId, distance: distance(record),
          intervalIndex: record.intervalIndex };
        if (best === null || candidate.distance < best.distance
            || (candidate.distance === best.distance && candidate.intervalIndex < best.intervalIndex)) {
          best = candidate;
        }
      }
    }
    return best?.intervalId ?? null;
  }

  private attachIntervalStore(
    palaeo: NonNullable<ReconstructionPackageManifestV2["palaeoCoastlines"]>,
    catalogs: readonly LoadedPalaeoClassCatalog[],
  ): void {
    this.palaeoRunner ??= createPalaeoTriangulationRunner();
    this.surfaces.attachIntervals(palaeo, catalogs, this.palaeoRunner);
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

  /**
   * The foreground prepare, counted while it is in flight. The count is what
   * the background scheduler yields to, and it is taken here rather than in
   * `requestPalaeoInterval` so every exit — resolved, rejected, superseded —
   * gives it back.
   */
  private async preparePalaeo(
    requestId: number,
    requestedAgeMa: number,
    signal: AbortSignal,
  ): Promise<PreparedCaoPalaeoInterval> {
    this.palaeoForegroundRequests += 1;
    try {
      return await this.preparePalaeoInterval(requestId, requestedAgeMa, signal);
    } finally {
      this.palaeoForegroundRequests -= 1;
    }
  }

  private async preparePalaeoInterval(
    requestId: number,
    requestedAgeMa: number,
    signal: AbortSignal,
  ): Promise<PreparedCaoPalaeoInterval> {
    const palaeo = this.manifest.palaeoCoastlines!;
    // Re-checked after every await: a mode toggle or an interval change makes a
    // prepare stale even though its own fetches are still succeeding.
    const requireCurrent = () => {
      if (signal.aborted || requestId !== this.chains.interval.serial || !this.palaeoEnabled
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
    // neighbour must not be evicted for being the one nobody has read yet, and
    // it is the age the background walk orders the rest of the timeline by.
    this.surfaces.noteCurrentAge(requestedAgeMa);
    this.palaeoRequestedAgeMa = requestedAgeMa;
    // Before the load, so the interval this crossing is about to draw is inside
    // the window the load's own eviction pass measures against.
    this.recentrePalaeoWarmWindow(record.intervalId);
    const loaded = await this.surfaces.load(intervalUnit(record.intervalId), signal);
    this.palaeoPreparedIntervalIds.add(record.intervalId);
    if (loaded.kind !== "interval") throw new Error("palaeo-coastline request resolved a native unit");
    const interval = loaded.value;
    requireCurrent();
    const paletteEntries = await this.palaeoPaletteEntries();
    requireCurrent();
    const frame = evaluateCaoPalaeoIntervalFrame(interval, paletteEntries, requestedAgeMa,
      palaeoSupportAgeMa(interval, requestedAgeMa));
    const baseColorRgb = this.palaeoBaseColors(palaeo);
    const prepared = createPreparedCaoPalaeoInterval(interval, frame, {
      requestId, packageId: this.manifest.packageId, packageRevision: this.manifest.revision,
      frameIdentity: packageFrameIdentity(this.manifest.frame), baseColorRgb,
    }, (identity) => { this.chains.interval.leases.delete(identity); });
    this.chains.interval.leases.set(prepared.identity, prepared.release);
    // The first publication of an enablement starts the walk over the rest of
    // the timeline; every later one finds it already running or complete.
    this.startPalaeoBackgroundPreparation();
    return prepared;
  }

  private async prepare(requestId: number, requestedAgeMa: number, signal: AbortSignal): Promise<PreparedCaoRevision> {
    const display = resolveCaoDisplayBracket(this.manifest, requestedAgeMa);
    const olderAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === display.olderAgeMa)!;
    const youngerAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === display.youngerAgeMa)!;
    const { foundation: motionFoundation, sourceBytes: motionSourceBytes } =
      await this.foundationForAge(requestedAgeMa);
    if (signal.aborted || requestId !== this.chains.checkpoint.serial) {
      throw new DOMException("stale Cao revision", "AbortError");
    }
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
    if (signal.aborted || requestId !== this.chains.checkpoint.serial) {
      throw new DOMException("stale Cao revision", "AbortError");
    }
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
        staticGeometryReplaceable: false,
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
      this.chains.checkpoint.leases.delete(identity);
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
    this.chains.checkpoint.leases.set(identity, release);
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
