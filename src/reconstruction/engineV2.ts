import { evaluateLifecycleSupport } from "./motion";
import { packageFrameIdentity } from "./identity";
import { selectPaletteMotionSubsegment } from "./palette";
import { CaoCheckpointStore, loadVerifiedCaoFoundation } from "./loaderV2";
import type { StaticAssetFetcher } from "./assetLoader";
import { immutableReconstructionPackageManifestV2, type ReconstructionPackageManifestV2 } from "./packageV2";
import { PREPARED_MOTION_PALETTE_STRIDE, type PreparedCaoRevision } from "./facadeV2";
import type { SupportState } from "./types";
import { inverseQuaternion, numberScalarOps, rotateDirection, slerpQuaternion,
  type UnitDirection } from "./arithmetic";
import type { MaterialAddress, MaterialPose } from "./types";

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
    const upper = this.manifest.checkpoints.findIndex((checkpoint) => checkpoint.ageMa >= requestedAgeMa);
    if (upper < 0) throw new Error("age outside Cao checkpoint coverage");
    const upperAsset = this.manifest.checkpoints[upper]!;
    // An authored checkpoint is one source state. Do not bracket an exact
    // request with the preceding display checkpoint or fetch it unnecessarily.
    const exactCheckpoint = upperAsset.ageMa === requestedAgeMa;
    const olderAsset = upperAsset;
    const youngerAsset = exactCheckpoint
      ? upperAsset
      : this.manifest.checkpoints[Math.max(0, upper - 1)]!;
    if (requestedAgeMa < youngerAsset.ageMa) throw new Error("age outside Cao checkpoint coverage");
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
    const boundaryLayer = exactCheckpoint ? youngerLoaded.boundary : null;
    const ownershipLayer = exactCheckpoint ? youngerLoaded.ownership : null;
    const displayFraction = younger.ageMa === older.ageMa ? 0
      : (requestedAgeMa - younger.ageMa) / (older.ageMa - younger.ageMa);
    const values = new Float32Array(foundation.core.charts.length * PREPARED_MOTION_PALETTE_STRIDE);
    const segments = new Map([...foundation.paletteEntries].map(([entryId, entry]) =>
      [entryId, selectPaletteMotionSubsegment(entry, requestedAgeMa)] as const));
    const charts = foundation.core.charts.map((chart, chartIndex) => {
      const bindings = chart.motionBindings ?? (chart.motionBinding ? [{ ...chart.motionBinding,
        validTimeMa: chart.lifecycle.validTimeMa }] : []);
      const matches = bindings.filter((binding) => requestedAgeMa >= binding.validTimeMa.youngest
        && requestedAgeMa <= binding.validTimeMa.oldest);
      const selected = matches.length === 0 ? undefined
        : [...matches].sort((left, right) => left.entryId.localeCompare(right.entryId))[0];
      const entry = selected && foundation.paletteEntries.get(selected.entryId);
      const segment = entry && segments.get(selected!.entryId);
      const lifecycle = evaluateLifecycleSupport(chart.lifecycle, requestedAgeMa);
      const support: SupportState = lifecycle ?? (segment
        ? { kind: "supported", method: "compiled-rigid" }
        : { kind: "unsupported", reason: "missing-motion" });
      const offset = chartIndex * PREPARED_MOTION_PALETTE_STRIDE;
      const youngerQuaternion = segment?.younger.quaternion ?? [1, 0, 0, 0];
      const olderQuaternion = segment?.older.quaternion ?? youngerQuaternion;
      const poseQuaternion = slerpQuaternion(numberScalarOps, youngerQuaternion, olderQuaternion,
        segment?.fraction ?? 0);
      values.set(youngerQuaternion, offset);
      values.set(olderQuaternion, offset + 4);
      values[offset + 8] = segment?.fraction ?? 0;
      // Native material lifecycle is evaluated at the requested age. Coarse
      // display endpoints are never allowed to invent a fade across an event.
      values[offset + 9] = support.kind === "supported" ? 1 : 0;
      values[offset + 10] = values[offset + 9];
      return Object.freeze({ chartId: chart.chartId, chartRevision: chart.chartRevision,
        materialId: chart.materialId, fragmentOrCohortId: chart.fragmentOrCohortId,
        role: chart.role, support, evidence: chart.evidence, poseQuaternion,
        inversePoseQuaternion: inverseQuaternion(numberScalarOps, poseQuaternion) });
    });
    const identity = `${this.manifest.packageId}@${this.manifest.revision}:${requestId}`;
    let payload: typeof foundation | null = foundation;
    let motionValues: Float32Array | null = values;
    let boundaryPoints = boundaryLayer?.points ?? null;
    let ownershipPoints = ownershipLayer?.points ?? null;
    const requirePayload = () => { if (!payload) throw new Error("Cao prepared revision released"); return payload; };
    const batches = foundation.core.spatialBatches.map((descriptor) => {
      const geometry = foundation.spatialBatches.get(descriptor.batchId)!;
      const youngerControl = younger.batchControls.find((control) => control.batchId === descriptor.batchId)!;
      const olderControl = older.batchControls.find((control) => control.batchId === descriptor.batchId)!;
      const display = (control: typeof youngerControl) => control.state.kind === "uniform"
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
        createDisplayControlsCopy: () => { requirePayload(); return { displayHeightStart: display(youngerControl),
          displayHeightEnd: display(olderControl), baseColor: color }; },
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
    const addressForChartDirection = (chartIndex: number,
      directionAtReference: readonly [number, number, number]): MaterialAddress => {
      requirePayload();
      const chart = charts[chartIndex];
      const length = Math.hypot(...directionAtReference);
      if (!chart || !directionAtReference.every(Number.isFinite) || Math.abs(length - 1) > 2e-6) {
        throw new Error("invalid Cao material chart direction");
      }
      return Object.freeze({ chartRevision: chart.chartRevision, chartId: chart.chartId,
        materialId: chart.materialId, fragmentOrCohortId: chart.fragmentOrCohortId, cellOrTriangleId: 0,
        localCoordinate: Object.freeze({ kind: "chart-direction" as const,
          directionAtReference: Object.freeze([...directionAtReference]) as UnitDirection }) });
    };
    const resolveAddress = (address: MaterialAddress): MaterialPose => {
      requirePayload();
      const chart = charts.find((candidate) => candidate.chartId === address.chartId);
      const validIdentity = chart && chart.chartRevision === address.chartRevision
        && chart.materialId === address.materialId && chart.fragmentOrCohortId === address.fragmentOrCohortId;
      const direction = address.localCoordinate.kind === "chart-direction"
        ? address.localCoordinate.directionAtReference : null;
      if (!validIdentity || !direction || direction.some((value) => !Number.isFinite(value))
          || Math.abs(Math.hypot(...direction) - 1) > 2e-6) {
        return Object.freeze({ address, requestedAgeMa, direction: null,
          support: { kind: "unsupported" as const, reason: "invalid-address" as const } });
      }
      return Object.freeze({ address, requestedAgeMa,
        direction: chart.support.kind === "supported"
          ? rotateDirection(numberScalarOps, chart.poseQuaternion, direction) : null,
        support: chart.support });
    };
    const anchorIds = Object.freeze(foundation.anchorCatalog?.anchors.map((anchor) => anchor.anchorId) ?? []);
    const anchorRecords = Object.freeze((foundation.anchorCatalog?.anchors ?? []).map((anchor) => Object.freeze({
      ...anchor,
      chartIndex: foundation.core.charts.findIndex((chart) => chart.chartId === anchor.chartId),
    })));
    const resolveAnchor = (anchorId: string) => {
      requirePayload();
      const anchor = anchorRecords.find((candidate) => candidate.anchorId === anchorId);
      if (!anchor || requestedAgeMa < anchor.validTimeMa.youngest || requestedAgeMa > anchor.validTimeMa.oldest) return null;
      if (anchor.chartIndex < 0) return null;
      return Object.freeze({ pose: resolveAddress(addressForChartDirection(anchor.chartIndex, anchor.directionAtReference)),
        role: anchor.role, coordinateUncertaintyKm: anchor.coordinateUncertaintyKm,
        sourceIds: anchor.sourceIds, limitations: anchor.limitations });
    };
    const nativeBoundary = boundaryLayer?.kind === "boundary" ? Object.freeze({ kind: "exact-source" as const,
      sourceAgeMa: younger.ageMa, value: Object.freeze({ segments: boundaryLayer.catalog.segments,
        pointCount: boundaryLayer.points.pointCount, sourceBytes: boundaryLayer.points.byteLength,
        createDirectionsCopy: () => { requirePayload(); if (!boundaryPoints) throw new Error("Cao prepared revision released");
          return new Float32Array(boundaryPoints.directions); } }) })
      : Object.freeze({ kind: "unavailable" as const, requestedAgeMa,
        reason: exactCheckpoint ? "source-absent" as const : "fractional-topology-unqualified" as const });
    const topologyOwnership = ownershipLayer?.kind === "ownership" ? Object.freeze({ kind: "exact-source" as const,
      sourceAgeMa: younger.ageMa, value: Object.freeze({ rings: ownershipLayer.catalog.rings,
        pointCount: ownershipLayer.points.pointCount, sourceBytes: ownershipLayer.points.byteLength,
        createDirectionsCopy: () => { requirePayload(); if (!ownershipPoints) throw new Error("Cao prepared revision released");
          return new Float32Array(ownershipPoints.directions); } }) })
      : Object.freeze({ kind: "unavailable" as const, requestedAgeMa,
        reason: exactCheckpoint ? "source-absent" as const : "fractional-topology-unqualified" as const });
    this.leases.set(identity, release);
    return Object.freeze({ identity, requestId, packageId: this.manifest.packageId,
      packageRevision: this.manifest.revision, requestedAgeMa, frameIdentity: packageFrameIdentity(this.manifest.frame),
      display: Object.freeze({ youngerAgeMa: younger.ageMa, olderAgeMa: older.ageMa, fraction: displayFraction }),
      motionPalette: Object.freeze({ stride: PREPARED_MOTION_PALETTE_STRIDE,
        entryCount: foundation.core.charts.length, createValuesCopy: () => { requirePayload();
          if (!motionValues) throw new Error("Cao prepared revision released"); return new Float32Array(motionValues); } }),
      batches: Object.freeze(batches), lineBatches: Object.freeze(lineBatches), nativeBoundary,
      topologyOwnership, charts: Object.freeze(charts), anchorIds,
      activeSourceBytes: this.manifest.core.bytes + this.manifest.motionPalette.catalog.bytes
        + this.manifest.motionPalette.binary.bytes + [...foundation.spatialBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + [...foundation.lineBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + (foundation.core.anchorCatalog?.bytes ?? 0)
        + youngerAsset.transitiveBytes
        + (olderAsset.ageMa === youngerAsset.ageMa ? 0 : olderAsset.transitiveBytes),
      addressForChartDirection, resolveAddress, resolveAnchor, release });
  }
}
