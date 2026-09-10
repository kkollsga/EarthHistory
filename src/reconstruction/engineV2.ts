import { packageFrameIdentity } from "./identity";
import { CaoCheckpointStore, loadVerifiedCaoFoundation } from "./loaderV2";
import type { StaticAssetFetcher } from "./assetLoader";
import { immutableReconstructionPackageManifestV2, type ReconstructionPackageManifestV2 } from "./packageV2";
import { PREPARED_MOTION_PALETTE_STRIDE, type PreparedCaoRevision } from "./facadeV2";
import { evaluateCaoMotionFrame, resolveCaoDisplayBracket, type CaoMotionFrame } from "./motionFrameV2";
import type { MaterialAddress } from "./types";

export class CaoReconstructionRuntime {
  private serial = 0;
  private active: AbortController | null = null;
  private readonly lifetime = new AbortController();
  private readonly foundation;
  private foundationResidentSourceBytes = 0;
  private checkpointStore: CaoCheckpointStore | null = null;
  private readonly leases = new Map<string, () => void>();

  readonly manifest: ReconstructionPackageManifestV2;

  constructor(manifest: ReconstructionPackageManifestV2, private readonly fetcher: StaticAssetFetcher) {
    this.manifest = immutableReconstructionPackageManifestV2(manifest);
    this.foundation = loadVerifiedCaoFoundation(this.manifest, fetcher, this.lifetime.signal);
    void this.foundation.then((foundation) => {
      this.foundationResidentSourceBytes = this.manifest.core.bytes + this.manifest.motionPalette.catalog.bytes
        + this.manifest.motionPalette.binary.bytes
        + [...foundation.spatialBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + [...foundation.lineBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + (foundation.core.anchorCatalog?.bytes ?? 0);
    }).catch(() => {});
    void this.foundation.catch(() => {});
  }

  request(requestedAgeMa: number): { readonly signal: AbortSignal; readonly prepared: Promise<PreparedCaoRevision> } {
    if (this.lifetime.signal.aborted) throw new Error("Cao reconstruction runtime disposed");
    if (!Number.isFinite(requestedAgeMa) || requestedAgeMa < this.manifest.ageDomainMa.youngest
        || requestedAgeMa > this.manifest.ageDomainMa.oldest) throw new Error("age outside Cao package domain");
    if (this.leases.size >= 2) throw new Error("release a Cao prepared revision before requesting another");
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
    const foundation = await this.foundation;
    if (this.lifetime.signal.aborted) throw new Error("Cao reconstruction runtime disposed");
    return evaluateCaoMotionFrame(this.manifest, foundation, requestedAgeMa);
  }

  /** Warm adjacent checkpoint assets for upcoming exact-knot overlays. */
  async prefetchCheckpoints(ageMaList: readonly number[], signal?: AbortSignal): Promise<void> {
    if (this.lifetime.signal.aborted) return;
    const foundation = await this.foundation;
    if (this.lifetime.signal.aborted || signal?.aborted) return;
    const store = this.checkpointStore ??= new CaoCheckpointStore(this.manifest, foundation.core, this.fetcher);
    const unique = [...new Set(ageMaList.filter((age) => this.manifest.checkpoints
      .some((checkpoint) => checkpoint.ageMa === age)))].slice(0, 2);
    await Promise.all(unique.map((age) => store.load(age, signal).catch(() => null)));
  }

  dispose(): void {
    this.active?.abort();
    this.lifetime.abort();
    this.checkpointStore?.dispose();
    for (const release of [...this.leases.values()]) release();
  }

  cancelActive(): void {
    this.active?.abort();
    this.active = null;
  }

  get ledger() {
    const checkpoint = this.checkpointStore?.ledger ?? { residentCount: 0, pendingCount: 0,
      residentSourceBytes: 0, pendingReservedSourceBytes: 0, maximumResidentCount: 2, maximumPendingCount: 2 };
    return Object.freeze({ foundationResidentSourceBytes: this.foundationResidentSourceBytes,
      checkpoint, preparedLeaseCount: this.leases.size,
      totalRuntimeSourceBytes: this.foundationResidentSourceBytes + checkpoint.residentSourceBytes
        + checkpoint.pendingReservedSourceBytes });
  }

  private async prepare(requestId: number, requestedAgeMa: number, signal: AbortSignal): Promise<PreparedCaoRevision> {
    const display = resolveCaoDisplayBracket(this.manifest, requestedAgeMa);
    const olderAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === display.olderAgeMa)!;
    const youngerAsset = this.manifest.checkpoints.find((checkpoint) => checkpoint.ageMa === display.youngerAgeMa)!;
    const foundation = await this.foundation;
    if (signal.aborted || requestId !== this.serial) throw new DOMException("stale Cao revision", "AbortError");
    const store = this.checkpointStore ??= new CaoCheckpointStore(this.manifest, foundation.core, this.fetcher);
    const youngerTask = store.load(youngerAsset.ageMa, signal);
    const olderTask = olderAsset.ageMa === youngerAsset.ageMa ? youngerTask
      : store.load(olderAsset.ageMa, signal);
    const [youngerLoaded, olderLoaded] = await Promise.all([youngerTask, olderTask]);
    const younger = youngerLoaded.checkpoint;
    const older = olderLoaded.checkpoint;
    if (signal.aborted || requestId !== this.serial) throw new DOMException("stale Cao revision", "AbortError");
    const motion = evaluateCaoMotionFrame(this.manifest, foundation, requestedAgeMa);
    const boundaryLayer = display.exactCheckpoint ? youngerLoaded.boundary : null;
    const ownershipLayer = display.exactCheckpoint ? youngerLoaded.ownership : null;
    const identity = `${this.manifest.packageId}@${this.manifest.revision}:${requestId}`;
    let payload: typeof foundation | null = foundation;
    let motionValues: Float32Array | null = motion.paletteValues;
    let boundaryPoints = boundaryLayer?.points ?? null;
    let ownershipPoints = ownershipLayer?.points ?? null;
    const requirePayload = () => { if (!payload) throw new Error("Cao prepared revision released"); return payload; };
    const batches = foundation.core.spatialBatches.map((descriptor) => {
      const geometry = foundation.spatialBatches.get(descriptor.batchId)!;
      const youngerControl = younger.batchControls.find((control) => control.batchId === descriptor.batchId)!;
      const olderControl = older.batchControls.find((control) => control.batchId === descriptor.batchId)!;
      const displayControl = (control: typeof youngerControl) => control.state.kind === "uniform"
        ? Object.freeze({ kind: "uniform" as const, value: control.state.displayHeightMetres })
        : (() => { throw new Error("per-vertex Cao checkpoint state preparation is not implemented"); })();
      const color = youngerControl.state.kind === "uniform" && olderControl.state.kind === "uniform"
        ? Object.freeze({ kind: "uniform" as const, value: youngerControl.state.baseColorRgb })
        : (() => { throw new Error("per-vertex Cao checkpoint color preparation is not implemented"); })();
      return Object.freeze({ batchId: descriptor.batchId,
        staticGeometryIdentity: `${identity.split(":")[0]}:${descriptor.batchId}:${descriptor.geometryAsset.sha256}`,
        vertexCount: descriptor.vertexCount, triangleCount: descriptor.triangleCount,
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
        createDisplayControlsCopy: () => { requirePayload(); return { displayHeightStart: displayControl(youngerControl),
          displayHeightEnd: displayControl(olderControl), baseColor: color }; },
      });
    });
    const lineBatches = (foundation.core.lineBatches ?? []).map((descriptor) => {
      const geometry = foundation.lineBatches.get(descriptor.batchId)!;
      const narrow = foundation.core.charts.length <= 65_535;
      return Object.freeze({ batchId: descriptor.batchId,
        staticGeometryIdentity: `${identity.split(":")[0]}:${descriptor.batchId}:${descriptor.geometryAsset.sha256}`,
        vertexCount: descriptor.vertexCount, segmentCount: descriptor.segmentCount,
        staticGeometryBytes: geometry.byteLength - 32 + (narrow ? 0 : descriptor.vertexCount * 4),
        createStaticGeometryCopy: () => { const current = requirePayload().lineBatches.get(descriptor.batchId)!;
          return Object.freeze({ referenceDirections: new Float32Array(current.referenceDirections),
            lineIndices: new Uint32Array(current.lineIndices), preparedEntryIndices: narrow
              ? new Uint16Array(current.vertexChartIndices) : new Uint32Array(current.vertexChartIndices),
            materialChartIndices: narrow
              ? new Uint16Array(current.vertexChartIndices) : new Uint32Array(current.vertexChartIndices) }); },
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
      packageRevision: this.manifest.revision, requestedAgeMa, frameIdentity: packageFrameIdentity(this.manifest.frame),
      display: Object.freeze({ youngerAgeMa: display.youngerAgeMa, olderAgeMa: display.olderAgeMa,
        fraction: display.fraction }),
      motionPalette: Object.freeze({ stride: PREPARED_MOTION_PALETTE_STRIDE,
        entryCount: motion.entryCount, createValuesCopy: () => { requirePayload();
          if (!motionValues) throw new Error("Cao prepared revision released"); return new Float32Array(motionValues); } }),
      batches: Object.freeze(batches), lineBatches: Object.freeze(lineBatches), nativeBoundary,
      topologyOwnership, charts: motion.charts, anchorIds: motion.anchorIds,
      activeSourceBytes: this.manifest.core.bytes + this.manifest.motionPalette.catalog.bytes
        + this.manifest.motionPalette.binary.bytes + [...foundation.spatialBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
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
