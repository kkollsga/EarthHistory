import { evaluateLifecycleSupport } from "./motion";
import { packageFrameIdentity } from "./identity";
import { selectPaletteMotionSubsegment } from "./palette";
import { CaoCheckpointStore, loadVerifiedCaoFoundation } from "./loaderV2";
import type { StaticAssetFetcher } from "./assetLoader";
import { immutableReconstructionPackageManifestV2, type NativeChartOverrideV1,
  type ReconstructionPackageManifestV2 } from "./packageV2";
import { PREPARED_MOTION_PALETTE_STRIDE, type PreparedCaoRevision } from "./facadeV2";
import type { SupportState } from "./types";
import { inverseQuaternion, numberScalarOps, rotateDirection, slerpQuaternion,
  type UnitDirection } from "./arithmetic";
import type { MaterialAddress, MaterialPose } from "./types";
import type { DecodedCaoSpatialBatch } from "./spatialV2";

function radialDirectionIntersectsTriangle(
  direction: readonly [number, number, number],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): boolean {
  const subtract = (left: readonly number[], right: readonly number[]) =>
    [left[0]! - right[0]!, left[1]! - right[1]!, left[2]! - right[2]!] as const;
  const cross = (left: readonly number[], right: readonly number[]) => [
    left[1]! * right[2]! - left[2]! * right[1]!,
    left[2]! * right[0]! - left[0]! * right[2]!,
    left[0]! * right[1]! - left[1]! * right[0]!,
  ] as const;
  const dot = (left: readonly number[], right: readonly number[]) =>
    left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
  const origin = direction.map((value) => 2 * value);
  const ray = direction.map((value) => -value);
  const edge1 = subtract(b, a);
  const edge2 = subtract(c, a);
  const p = cross(ray, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-12) return false;
  const inverse = 1 / determinant;
  const offset = subtract(origin, a);
  const u = dot(offset, p) * inverse;
  const q = cross(offset, edge1);
  const v = dot(ray, q) * inverse;
  const distance = dot(edge2, q) * inverse;
  return u >= -1e-8 && v >= -1e-8 && u + v <= 1 + 1e-8 && distance >= 0 && distance <= 2;
}

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
        + (foundation.core.anchorCatalog?.bytes ?? 0)
        + (this.manifest.materialCorrections?.catalog.bytes ?? 0);
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
    const allOverrides = foundation.correctionCatalog?.nativeChartOverrides ?? [];
    const countrySegmentDescriptors = allOverrides.flatMap((override) =>
      override.dependentConsumers.countrySegmentBindings.map((binding) => {
        const sourceChartIndex = foundation.core.charts.findIndex(
          (chart) => chart.chartId === binding.sourceCountryChartId,
        );
        if (sourceChartIndex < 0) throw new Error("native replacement country source chart is missing");
        return Object.freeze({ override, binding, sourceChartIndex });
      }));
    const values = new Float32Array(
      (foundation.core.charts.length + countrySegmentDescriptors.length) * PREPARED_MOTION_PALETTE_STRIDE,
    );
    const segments = new Map([...foundation.paletteEntries].map(([entryId, entry]) =>
      [entryId, selectPaletteMotionSubsegment(entry, requestedAgeMa)] as const));
    const activeOverrides = allOverrides
      .filter((override) => evaluateLifecycleSupport(override.suppression, requestedAgeMa) === null);
    const overriddenNativeChartIds = new Set(activeOverrides.map((override) => override.nativeChart.chartId));
    const overriddenCountryChartIds = new Set(activeOverrides.flatMap(
      (override) => override.dependentConsumers.sourceCountryChartIds,
    ));
    const baseCharts = foundation.core.charts.map((chart, chartIndex) => {
      const bindings = chart.motionBindings ?? (chart.motionBinding ? [{ ...chart.motionBinding,
        validTimeMa: chart.lifecycle.validTimeMa }] : []);
      const matches = bindings.filter((binding) => requestedAgeMa >= binding.validTimeMa.youngest
        && requestedAgeMa <= binding.validTimeMa.oldest);
      const selected = matches.length === 0 ? undefined
        : [...matches].sort((left, right) => left.entryId.localeCompare(right.entryId))[0];
      const entry = selected && foundation.paletteEntries.get(selected.entryId);
      const segment = entry && segments.get(selected!.entryId);
      const lifecycle = evaluateLifecycleSupport(chart.lifecycle, requestedAgeMa);
      const support: SupportState = overriddenNativeChartIds.has(chart.chartId)
          || overriddenCountryChartIds.has(chart.chartId)
        ? { kind: "inactive", reason: "replaced" }
        : lifecycle ?? (segment
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
    const activeOverrideIds = new Set(activeOverrides.map((override) => override.overrideId));
    const charts = [...baseCharts];
    for (const [descriptorIndex, descriptor] of countrySegmentDescriptors.entries()) {
      const source = baseCharts[descriptor.sourceChartIndex]!;
      const supportedByEveryNearestDomain = descriptor.binding.domainFragmentOrCohortIds.every((fragmentId) =>
        baseCharts.some((chart) => chart.fragmentOrCohortId === fragmentId
          && descriptor.override.replacementChartIds.includes(chart.chartId)
          && chart.support.kind === "supported"));
      const support: SupportState = activeOverrideIds.has(descriptor.override.overrideId)
        ? supportedByEveryNearestDomain
          ? { kind: "supported", method: "compiled-rigid" }
          : { kind: "inactive", reason: "replaced" }
        : source.support;
      const chartIndex = foundation.core.charts.length + descriptorIndex;
      const sourceOffset = descriptor.sourceChartIndex * PREPARED_MOTION_PALETTE_STRIDE;
      const targetOffset = chartIndex * PREPARED_MOTION_PALETTE_STRIDE;
      values.set(values.subarray(sourceOffset, sourceOffset + PREPARED_MOTION_PALETTE_STRIDE), targetOffset);
      values[targetOffset + 9] = support.kind === "supported" ? 1 : 0;
      values[targetOffset + 10] = values[targetOffset + 9];
      charts.push(Object.freeze({
        chartId: `country-segment:${descriptor.override.overrideId}:${descriptor.binding.batchId}:${descriptor.binding.segmentIndex}`,
        chartRevision: `${source.chartRevision}+${foundation.correctionCatalog?.version ?? "native"}`,
        materialId: source.materialId,
        fragmentOrCohortId: `${source.fragmentOrCohortId}:segment:${descriptor.binding.segmentIndex}`,
        role: source.role,
        support,
        evidence: Object.freeze({ ...source.evidence, limitations: Object.freeze([
          ...source.evidence.limitations,
          "Natural Earth 1:110m reference segment is gated by its source-domain match; the 12 km corridor is line-approximation tolerance, not geological positional accuracy",
        ]) }),
        poseQuaternion: source.poseQuaternion,
        inversePoseQuaternion: source.inversePoseQuaternion,
      }));
    }
    const replacementTriangleRanges = new Map<number, {
      batch: DecodedCaoSpatialBatch;
      firstTriangle: number;
      triangleCount: number;
    }[]>();
    const allReplacementChartIndices = new Set(allOverrides.flatMap((override) =>
      override.replacementChartIds.map((chartId) => foundation.core.charts.findIndex((chart) =>
        chart.chartId === chartId))));
    for (const batch of foundation.spatialBatches.values()) {
      for (const range of batch.chartTriangleRanges) {
        if (!allReplacementChartIndices.has(range.chartIndex)) continue;
        const records = replacementTriangleRanges.get(range.chartIndex) ?? [];
        records.push({ batch, firstTriangle: range.firstTriangle, triangleCount: range.triangleCount });
        replacementTriangleRanges.set(range.chartIndex, records);
      }
    }
    const replacementChartsContainingDirection = (
      override: NativeChartOverrideV1,
      direction: UnitDirection,
    ): Set<number> => {
      const candidateIndices = new Set(override.replacementChartIds.map((chartId) =>
        charts.findIndex((chart) => chart.chartId === chartId)).filter((chartIndex) =>
        chartIndex >= 0 && charts[chartIndex]?.support.kind === "supported"));
      const containing = new Set<number>();
      for (const chartIndex of candidateIndices) {
        for (const range of replacementTriangleRanges.get(chartIndex) ?? []) {
          const { batch } = range;
          const triangleEnd = (range.firstTriangle + range.triangleCount) * 3;
          for (let triangle = range.firstTriangle * 3; triangle < triangleEnd; triangle += 3) {
            const first = batch.indices[triangle]!;
            const at = (vertex: number) => {
              const offset = vertex * 3;
              return [batch.referenceDirections[offset]!, batch.referenceDirections[offset + 1]!,
                batch.referenceDirections[offset + 2]!] as const;
            };
            if (radialDirectionIntersectsTriangle(direction, at(first),
              at(batch.indices[triangle + 1]!), at(batch.indices[triangle + 2]!))) {
              containing.add(chartIndex);
            }
          }
        }
      }
      return containing;
    };
    const materialCorrectionIdentity = this.manifest.materialCorrections
      ? `${this.manifest.materialCorrections.id}@${this.manifest.materialCorrections.catalog.sha256}` : null;
    const combinedRevision = materialCorrectionIdentity
      ? `${this.manifest.revision}+${materialCorrectionIdentity}` : this.manifest.revision;
    const identity = `${this.manifest.packageId}@${combinedRevision}:${requestId}`;
    let payload: typeof foundation | null = foundation;
    let motionValues: Float32Array | null = values;
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
      const display = (control: typeof youngerState) => control.kind === "uniform"
        ? Object.freeze({ kind: "uniform" as const, value: control.displayHeightMetres })
        : (() => { throw new Error("per-vertex Cao checkpoint state preparation is not implemented"); })();
      const color = youngerState.kind === "uniform" && olderState.kind === "uniform"
        ? Object.freeze({ kind: "uniform" as const, value: youngerState.baseColorRgb })
        : (() => { throw new Error("per-vertex Cao checkpoint color preparation is not implemented"); })();
      return Object.freeze({ batchId: descriptor.batchId,
        staticGeometryIdentity: `${identity.split(":")[0]}:${descriptor.batchId}:${descriptor.geometryAsset.sha256}`,
        vertexCount: descriptor.vertexCount, triangleCount: descriptor.triangleCount,
        nativePrecedence: descriptor.overlapPolicy === "native-visual-and-picking-precedence",
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
        createDisplayControlsCopy: () => { requirePayload(); return { displayHeightStart: display(youngerState),
          displayHeightEnd: display(olderState), baseColor: color }; },
      });
    });
    const lineBatches = (foundation.core.lineBatches ?? []).map((descriptor) => {
      const geometry = foundation.lineBatches.get(descriptor.batchId)!;
      const narrow = charts.length <= 65_535;
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
    const replacementChartForDirection = (nativeChartId: string,
      direction: UnitDirection): number | null => {
      const override = foundation.correctionCatalog?.nativeChartOverrides?.find(
        (candidate) => candidate.nativeChart.chartId === nativeChartId,
      );
      if (!override || !overriddenNativeChartIds.has(nativeChartId)) return null;
      const containing = replacementChartsContainingDirection(override, direction);
      return containing.size === 1 ? [...containing][0]! : null;
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
      if (chart.support.kind === "inactive" && chart.support.reason === "replaced") {
        const replacementIndex = replacementChartForDirection(chart.chartId, direction);
        if (replacementIndex !== null) {
          const replacement = charts[replacementIndex]!;
          const replacementAddress = addressForChartDirection(replacementIndex, direction);
          return Object.freeze({ address: replacementAddress, requestedAgeMa,
            direction: rotateDirection(numberScalarOps, replacement.poseQuaternion, direction),
            support: replacement.support });
        }
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
      packageRevision: combinedRevision, materialCorrectionIdentity,
      materialCorrections: Object.freeze({
        qualifiedActiveCharts: charts.filter((chart) => chart.support.kind === "supported"
          && chart.evidence.correction?.phase === "source-qualified-material").length,
        uncertainActiveCharts: charts.filter((chart) => chart.support.kind === "supported"
          && chart.evidence.correction?.phase === "uncertain-continuation").length,
        formationUncertainActiveCharts: charts.filter((chart) => chart.support.kind === "supported"
          && chart.evidence.correction?.phase === "formation-uncertain").length,
        modelInferredPoseActiveCharts: charts.filter((chart) => chart.support.kind === "supported"
          && chart.evidence.correction?.phase === "source-qualified-material"
          && ["model-inference", "native-target-only"]
            .includes(chart.evidence.correction?.poseStatus ?? "")).length,
        overriddenNativeCharts: overriddenNativeChartIds.size,
        activeSourceIds: Object.freeze([...new Set(charts.filter((chart) => chart.support.kind === "supported"
          && chart.evidence.correction !== undefined).flatMap((chart) => chart.evidence.sourceIds))].sort()),
        correctionIds: Object.freeze([...(foundation.correctionCatalog?.correctionIds ?? [])]),
      }),
      requestedAgeMa, frameIdentity: packageFrameIdentity(this.manifest.frame),
      display: Object.freeze({ youngerAgeMa: younger.ageMa, olderAgeMa: older.ageMa, fraction: displayFraction }),
      motionPalette: Object.freeze({ stride: PREPARED_MOTION_PALETTE_STRIDE,
        entryCount: charts.length, createValuesCopy: () => { requirePayload();
          if (!motionValues) throw new Error("Cao prepared revision released"); return new Float32Array(motionValues); } }),
      batches: Object.freeze(batches), lineBatches: Object.freeze(lineBatches), nativeBoundary,
      topologyOwnership, charts: Object.freeze(charts), anchorIds,
      activeSourceBytes: this.manifest.core.bytes + this.manifest.motionPalette.catalog.bytes
        + this.manifest.motionPalette.binary.bytes + (this.manifest.materialCorrections?.catalog.bytes ?? 0)
        + [...foundation.spatialBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + [...foundation.lineBatches.values()].reduce((sum, batch) => sum + batch.byteLength, 0)
        + (foundation.core.anchorCatalog?.bytes ?? 0)
        + youngerAsset.transitiveBytes
        + (olderAsset.ageMa === youngerAsset.ageMa ? 0 : olderAsset.transitiveBytes),
      addressForChartDirection, resolveAddress, resolveAnchor, release });
  }
}
