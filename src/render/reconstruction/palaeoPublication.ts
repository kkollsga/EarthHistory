/**
 * The palaeo-coastline interval, in the shape the surface renderer publishes.
 *
 * `CaoFoundationSurfaceRenderer` consumes one prepared revision, and the palaeo
 * instance is the same renderer with different bounds and an armed static
 * geometry swap. A map interval is narrower than a Cao revision — no country
 * outlines, no exact-knot boundary or ownership layers, no anchors and no
 * material corrections — so this adapter states each of those absences
 * explicitly rather than letting the renderer infer them, and forwards the
 * lease so `publish()` releases the interval store's hold exactly as it
 * releases a native revision's.
 */

import type {
  PreparedCaoChartIdentity,
  PreparedCaoPalaeoInterval,
  PreparedCaoRevision,
} from "../../reconstruction";

/** No correction catalog participates in a palaeo publication; every counter is zero. */
export const NO_PALAEO_MATERIAL_CORRECTIONS: PreparedCaoRevision["materialCorrections"] = Object.freeze({
  observedActiveCharts: 0,
  classifiedShallowMarineActiveCharts: 0,
  qualifiedActiveCharts: 0,
  uncertainActiveCharts: 0,
  formationUncertainActiveCharts: 0,
  modelInferredPoseActiveCharts: 0,
  overriddenNativeCharts: 0,
  activeSourceIds: Object.freeze([]),
  correctionIds: Object.freeze([]),
});

/** Pose tables for the palaeo charts, in the order the publication indexes them. */
export function palaeoChartPickState(charts: readonly PreparedCaoChartIdentity[]): {
  chartPoses: Float32Array;
  chartActive: Uint8Array;
} {
  const chartPoses = new Float32Array(charts.length * 8);
  const chartActive = new Uint8Array(charts.length);
  for (let chartIndex = 0; chartIndex < charts.length; chartIndex += 1) {
    const chart = charts[chartIndex]!;
    chartPoses.set(chart.poseQuaternion, chartIndex * 8);
    chartPoses.set(chart.inversePoseQuaternion, chartIndex * 8 + 4);
    chartActive[chartIndex] = chart.support.kind === "supported" ? 1 : 0;
  }
  return { chartPoses, chartActive };
}

/**
 * Wraps one prepared map interval as a publishable revision.
 *
 * The display bracket is degenerate on purpose: every palaeo palette entry
 * carries the same activation at both ends, so the display fraction the
 * renderer mixes with has no effect, and both display heights are zero because
 * the renderer's shell table already owns the offset each palaeo class draws
 * at. The address and anchor queries throw rather than answering null — nothing
 * in the palaeo mode holds a material address, and a caller that reached them
 * would be asking the wrong instance.
 */
export function preparedCaoRevisionForPalaeoInterval(
  interval: PreparedCaoPalaeoInterval,
): PreparedCaoRevision {
  const unavailable = Object.freeze({ kind: "unavailable" as const,
    requestedAgeMa: interval.requestedAgeMa, reason: "source-absent" as const });
  return Object.freeze({
    identity: interval.identity,
    requestId: interval.requestId,
    packageId: interval.packageId,
    packageRevision: interval.packageRevision,
    materialCorrectionIdentity: null,
    materialCorrections: NO_PALAEO_MATERIAL_CORRECTIONS,
    requestedAgeMa: interval.requestedAgeMa,
    frameIdentity: interval.frameIdentity,
    display: Object.freeze({ youngerAgeMa: interval.requestedAgeMa,
      olderAgeMa: interval.requestedAgeMa, fraction: 0 }),
    motionPalette: interval.motionPalette,
    batches: interval.batches,
    lineBatches: Object.freeze([]),
    nativeBoundary: unavailable,
    topologyOwnership: unavailable,
    charts: interval.charts,
    anchorIds: Object.freeze([]),
    activeSourceBytes: interval.activeSourceBytes,
    addressForChartDirection: () => {
      throw new Error("palaeo-coastline charts carry no material addresses");
    },
    resolveAddress: () => {
      throw new Error("palaeo-coastline charts carry no material addresses");
    },
    resolveAnchor: () => null,
    release: () => { interval.release(); },
  });
}
