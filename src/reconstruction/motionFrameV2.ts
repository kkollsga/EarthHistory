import { evaluateLifecycleSupport } from "./motion";
import { selectPaletteMotionSubsegment, type PaletteMotionSubsegment, type PreparedPaletteEntry } from "./palette";
import { PREPARED_MOTION_PALETTE_STRIDE } from "./facadeV2";
import type { PreparedCaoChartIdentity, PreparedMaterialCorrections } from "./facadeV2";
import type { LoadedCaoFoundation } from "./loaderV2";
import type { NativeChartOverrideV1, ReconstructionPackageManifestV2 } from "./packageV2";
import type { DecodedCaoSpatialBatch } from "./spatialV2";
import type { MaterialAddress, MaterialPose, MotionSample, SupportState } from "./types";
import { inverseQuaternion, numberScalarOps, rotateDirection, slerpQuaternion,
  type UnitDirection } from "./arithmetic";

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

type ChartMotionBinding = {
  readonly paletteId: string;
  readonly entryId: string;
  readonly validTimeMa: { readonly youngest: number; readonly oldest: number };
};

/** Resolves a chart only inside an explicitly authored motion-binding interval. */
export function resolveChartMotionSegment(
  bindings: readonly ChartMotionBinding[],
  paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>,
  requestedAgeMa: number,
): PaletteMotionSubsegment | null {
  const matches = bindings.filter((binding) => requestedAgeMa >= binding.validTimeMa.youngest
    && requestedAgeMa <= binding.validTimeMa.oldest);
  if (matches.length > 0) {
    const selected = [...matches].sort((left, right) => left.entryId.localeCompare(right.entryId))[0]!;
    const entry = paletteEntries.get(selected.entryId);
    return entry ? selectPaletteMotionSubsegment(entry, requestedAgeMa) : null;
  }
  return null;
}

export interface CaoDisplayBracket {
  readonly youngerAgeMa: number;
  readonly olderAgeMa: number;
  readonly fraction: number;
  readonly exactCheckpoint: boolean;
}

/** Continuous motion evaluation for one requested age; no checkpoint I/O. */
export interface CaoMotionFrame {
  readonly requestedAgeMa: number;
  readonly display: CaoDisplayBracket;
  readonly materialCorrectionIdentity: string | null;
  readonly materialCorrections: PreparedMaterialCorrections;
  readonly entryCount: number;
  /** Shared motion palette storage: entryCount * PREPARED_MOTION_PALETTE_STRIDE. */
  readonly paletteValues: Float32Array;
  readonly charts: readonly PreparedCaoChartIdentity[];
  readonly anchorIds: readonly string[];
  addressForChartDirection(chartIndex: number, directionAtReference: readonly [number, number, number]): MaterialAddress;
  resolveAddress(address: MaterialAddress): MaterialPose;
  resolveAnchor(anchorId: string): Readonly<{
    pose: MaterialPose;
    role: "poi-anchor" | "focus-anchor";
    coordinateUncertaintyKm: number;
    sourceIds: readonly string[];
    limitations: readonly string[];
  }> | null;
}

export function resolveCaoDisplayBracket(
  manifest: ReconstructionPackageManifestV2,
  requestedAgeMa: number,
): CaoDisplayBracket {
  if (!Number.isFinite(requestedAgeMa) || requestedAgeMa < manifest.ageDomainMa.youngest
      || requestedAgeMa > manifest.ageDomainMa.oldest) {
    throw new Error("age outside Cao package domain");
  }
  const upper = manifest.checkpoints.findIndex((checkpoint) => checkpoint.ageMa >= requestedAgeMa);
  if (upper < 0) throw new Error("age outside Cao checkpoint coverage");
  const olderAsset = manifest.checkpoints[upper]!;
  const exactCheckpoint = olderAsset.ageMa === requestedAgeMa;
  const youngerAsset = exactCheckpoint
    ? olderAsset
    : manifest.checkpoints[Math.max(0, upper - 1)]!;
  if (requestedAgeMa < youngerAsset.ageMa) throw new Error("age outside Cao checkpoint coverage");
  const fraction = youngerAsset.ageMa === olderAsset.ageMa ? 0
    : (requestedAgeMa - youngerAsset.ageMa) / (olderAsset.ageMa - youngerAsset.ageMa);
  return Object.freeze({
    youngerAgeMa: youngerAsset.ageMa,
    olderAgeMa: olderAsset.ageMa,
    fraction,
    exactCheckpoint,
  });
}

/**
 * Evaluates rigid chart motion at a continuous age from the resident foundation
 * palette. Display-knot fraction is reported for height/activation uniforms;
 * per-chart motion fractions follow the qualified source clock.
 */
export function evaluateCaoMotionFrame(
  manifest: ReconstructionPackageManifestV2,
  foundation: LoadedCaoFoundation,
  requestedAgeMa: number,
): CaoMotionFrame {
  const display = resolveCaoDisplayBracket(manifest, requestedAgeMa);
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
  const activeOverrides = allOverrides
    .filter((override) => evaluateLifecycleSupport(override.suppression, requestedAgeMa) === null);
  const overriddenNativeChartIds = new Set(activeOverrides.map((override) => override.nativeChart.chartId));
  const overriddenCountryChartIds = new Set(activeOverrides.flatMap(
    (override) => override.dependentConsumers.sourceCountryChartIds,
  ));
  const baseCharts = foundation.core.charts.map((chart, chartIndex) => {
    const bindings = chart.motionBindings ?? (chart.motionBinding ? [{ ...chart.motionBinding,
      validTimeMa: chart.lifecycle.validTimeMa }] : []);
    const segment = resolveChartMotionSegment(bindings, foundation.paletteEntries, requestedAgeMa);
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
  const addressForChartDirection = (chartIndex: number,
    directionAtReference: readonly [number, number, number]): MaterialAddress => {
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
      const override = foundation.correctionCatalog?.nativeChartOverrides?.find(
        (candidate) => candidate.nativeChart.chartId === chart.chartId,
      );
      if (override && overriddenNativeChartIds.has(chart.chartId)) {
        const containing = replacementChartsContainingDirection(override, direction);
        if (containing.size === 1) {
          const replacementIndex = [...containing][0]!;
          const replacement = charts[replacementIndex]!;
          const replacementAddress = addressForChartDirection(replacementIndex, direction);
          return Object.freeze({ address: replacementAddress, requestedAgeMa,
            direction: rotateDirection(numberScalarOps, replacement.poseQuaternion, direction),
            support: replacement.support });
        }
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
    const anchor = anchorRecords.find((candidate) => candidate.anchorId === anchorId);
    if (!anchor || requestedAgeMa < anchor.validTimeMa.youngest || requestedAgeMa > anchor.validTimeMa.oldest) {
      return null;
    }
    if (anchor.chartIndex < 0) return null;
    return Object.freeze({ pose: resolveAddress(addressForChartDirection(anchor.chartIndex, anchor.directionAtReference)),
      role: anchor.role, coordinateUncertaintyKm: anchor.coordinateUncertaintyKm,
      sourceIds: anchor.sourceIds, limitations: anchor.limitations });
  };
  const materialCorrectionIdentity = manifest.materialCorrections
    ? `${manifest.materialCorrections.id}@${manifest.materialCorrections.catalog.sha256}` : null;
  const materialCorrections: PreparedMaterialCorrections = Object.freeze({
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
  });
  return Object.freeze({
    requestedAgeMa,
    display,
    materialCorrectionIdentity,
    materialCorrections,
    entryCount: charts.length,
    paletteValues: values,
    charts: Object.freeze(charts),
    anchorIds,
    addressForChartDirection,
    resolveAddress,
    resolveAnchor,
  });
}

export function chartPickStateFromMotionFrame(frame: CaoMotionFrame): {
  chartPoses: Float32Array;
  chartActive: Uint8Array;
} {
  const chartPoses = new Float32Array(frame.charts.length * 8);
  const chartActive = new Uint8Array(frame.charts.length);
  for (let chartIndex = 0; chartIndex < frame.charts.length; chartIndex += 1) {
    const chart = frame.charts[chartIndex]!;
    chartPoses.set(chart.poseQuaternion, chartIndex * 8);
    chartPoses.set(chart.inversePoseQuaternion, chartIndex * 8 + 4);
    chartActive[chartIndex] = chart.support.kind === "supported" ? 1 : 0;
  }
  return { chartPoses, chartActive };
}
