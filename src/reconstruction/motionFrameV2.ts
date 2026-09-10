import { evaluateLifecycleSupport } from "./motion";
import { selectPaletteMotionSubsegment, type PaletteMotionSubsegment, type PreparedPaletteEntry } from "./palette";
import { PREPARED_MOTION_PALETTE_STRIDE } from "./facadeV2";
import type { PreparedCaoChartIdentity } from "./facadeV2";
import type { LoadedCaoFoundation } from "./loaderV2";
import type { ReconstructionPackageManifestV2 } from "./packageV2";
import type { MaterialAddress, MaterialPose, MotionSample, SupportState } from "./types";
import { inverseQuaternion, numberScalarOps, rotateDirection, slerpQuaternion,
  type UnitDirection } from "./arithmetic";

type ChartMotionBinding = {
  readonly paletteId: string;
  readonly entryId: string;
  readonly validTimeMa: { readonly youngest: number; readonly oldest: number };
};

function endpointSample(segment: PaletteMotionSubsegment): MotionSample {
  return segment.fraction === 0 ? segment.younger : segment.older;
}

/**
 * Resolves a chart's motion row at a continuous age. Exact compiled bindings win.
 * Open gaps between adjacent same-chart bindings (compiler adaptive dropouts such
 * as 118–120 Ma on Fennoscandia plates) are bridged from the neighbouring
 * compiled endpoint samples so geometry stays posed instead of vanishing.
 */
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
  let youngerSide: ChartMotionBinding | undefined;
  let olderSide: ChartMotionBinding | undefined;
  for (const binding of bindings) {
    if (binding.validTimeMa.oldest < requestedAgeMa
        && (!youngerSide || binding.validTimeMa.oldest > youngerSide.validTimeMa.oldest)) {
      youngerSide = binding;
    }
    if (binding.validTimeMa.youngest > requestedAgeMa
        && (!olderSide || binding.validTimeMa.youngest < olderSide.validTimeMa.youngest)) {
      olderSide = binding;
    }
  }
  if (youngerSide && olderSide) {
    const youngerEntry = paletteEntries.get(youngerSide.entryId);
    const olderEntry = paletteEntries.get(olderSide.entryId);
    const youngerSeg = youngerEntry
      ? selectPaletteMotionSubsegment(youngerEntry, youngerSide.validTimeMa.oldest) : null;
    const olderSeg = olderEntry
      ? selectPaletteMotionSubsegment(olderEntry, olderSide.validTimeMa.youngest) : null;
    if (!youngerSeg || !olderSeg) return null;
    const lo = youngerSide.validTimeMa.oldest;
    const hi = olderSide.validTimeMa.youngest;
    if (!(hi > lo)) return null;
    return {
      younger: endpointSample(youngerSeg),
      older: endpointSample(olderSeg),
      fraction: (requestedAgeMa - lo) / (hi - lo),
    };
  }
  const hold = youngerSide ?? olderSide;
  if (!hold) return null;
  const entry = paletteEntries.get(hold.entryId);
  if (!entry) return null;
  const holdAge = youngerSide ? hold.validTimeMa.oldest : hold.validTimeMa.youngest;
  const holdSeg = selectPaletteMotionSubsegment(entry, holdAge);
  if (!holdSeg) return null;
  const sample = endpointSample(holdSeg);
  return { younger: sample, older: sample, fraction: 0 };
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
  const values = new Float32Array(foundation.core.charts.length * PREPARED_MOTION_PALETTE_STRIDE);
  const charts = foundation.core.charts.map((chart, chartIndex) => {
    const bindings = chart.motionBindings ?? (chart.motionBinding ? [{ ...chart.motionBinding,
      validTimeMa: chart.lifecycle.validTimeMa }] : []);
    const segment = resolveChartMotionSegment(bindings, foundation.paletteEntries, requestedAgeMa);
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
  return Object.freeze({
    requestedAgeMa,
    display,
    entryCount: foundation.core.charts.length,
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
