import { describe, expect, it, vi } from "vitest";
import {
  CAO_FOUNDATION_DEFAULT_BASE_COLORS,
  createCaoFoundationGeometryResource,
  type CaoFoundationGeometryResource,
  type CaoFoundationPickState,
  type CaoFoundationSurfaceView,
} from "./caoFoundation";
import {
  CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA,
  CAO_PALAEO_VISIBILITY_INITIAL_STATE,
  caoCompositeCoversDirection,
  caoPalaeoCoastlineAgeInsideDomain,
  intersectCaoComposite,
  nextCaoPalaeoVisibilityState,
} from "./palaeoComposite";
import type { PreparedCaoRevision } from "../../reconstruction";

const limits = { maxBatches: 16, maxVertices: 1_000, maxTriangles: 1_000,
  maxRetainedSourceBytes: 1_000_000, maxTextureSize: 2_048, maxPublicationBytes: 1_000_000,
  maxSpatialIndexBytes: 1_000_000 };

function gplatesLonLat(longitude: number, latitude: number): readonly [number, number, number] {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

function rendererDirection(longitude: number, latitude: number): [number, number, number] {
  const [x, y, z] = gplatesLonLat(longitude, latitude);
  return [x, z, -y];
}

type Appearance = keyof typeof CAO_FOUNDATION_DEFAULT_BASE_COLORS;

interface BatchSpec {
  readonly batchId: string;
  readonly halfDegrees: number;
  readonly chartIndex: number;
  readonly nativePrecedence: boolean;
  readonly surfaceAppearance?: Appearance;
}

/** A minimal prepared revision holding exactly the batches a case needs. */
function revisionOf(batches: readonly BatchSpec[], chartCount: number): PreparedCaoRevision {
  const values = new Float32Array(chartCount * 11);
  for (let entry = 0; entry < chartCount; entry += 1) {
    values.set([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 1, 1], entry * 11);
  }
  const chart = (chartId: string) => ({ chartId, chartRevision: "1", materialId: chartId,
    fragmentOrCohortId: chartId, role: "model-geography" as const,
    support: { kind: "supported" as const, method: "compiled-rigid" as const },
    poseQuaternion: [1, 0, 0, 0] as const, inversePoseQuaternion: [1, 0, 0, 0] as const,
    evidence: { status: "unknown" as const, sourceIds: ["cao"], limitations: [] },
    surfaceEvidence: { kind: "unknown" as const, reason: "composite fixture" } });
  return {
    identity: "cao@r1:0", requestId: 1, packageId: "cao", packageRevision: "r1",
    materialCorrectionIdentity: null,
    materialCorrections: { observedActiveCharts: 0, classifiedShallowMarineActiveCharts: 0,
      qualifiedActiveCharts: 0, uncertainActiveCharts: 0, formationUncertainActiveCharts: 0,
      modelInferredPoseActiveCharts: 0, overriddenNativeCharts: 0,
      activeSourceIds: [], correctionIds: [] },
    requestedAgeMa: 0, frameIdentity: "cao-frame",
    display: { youngerAgeMa: 0, olderAgeMa: 5, fraction: 0 },
    motionPalette: { stride: 11, entryCount: chartCount,
      createValuesCopy: () => new Float32Array(values) },
    batches: batches.map((spec) => {
      const points = [[-spec.halfDegrees, -spec.halfDegrees],
        [spec.halfDegrees, -spec.halfDegrees], [0, spec.halfDegrees]] as const;
      const directions = new Float32Array(points.flatMap(([lon, lat]) => gplatesLonLat(lon, lat)));
      const indices = new Uint32Array([0, 1, 2]);
      const seamIds = new Uint32Array(3);
      const entries = new Uint16Array([spec.chartIndex, spec.chartIndex, spec.chartIndex]);
      return { batchId: spec.batchId, staticGeometryIdentity: `${spec.batchId}@1`,
        vertexCount: 3, triangleCount: 1,
        staticGeometryBytes: directions.byteLength + indices.byteLength + seamIds.byteLength
          + 2 * entries.byteLength,
        nativePrecedence: spec.nativePrecedence, surfaceAppearance: spec.surfaceAppearance,
        chartTriangleRanges: [{ chartIndex: spec.chartIndex, firstTriangle: 0, triangleCount: 1 }],
        createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(directions),
          indices: new Uint32Array(indices), seamIds: new Uint32Array(seamIds),
          preparedEntryIndices: new Uint16Array(entries),
          materialChartIndices: new Uint16Array(entries) }),
        createDisplayControlsCopy: () => ({
          displayHeightStart: { kind: "uniform" as const, value: 0 },
          displayHeightEnd: { kind: "uniform" as const, value: 0 },
          baseColor: { kind: "uniform" as const,
            value: CAO_FOUNDATION_DEFAULT_BASE_COLORS[spec.surfaceAppearance ?? "land"] } }) };
    }),
    lineBatches: [],
    nativeBoundary: { kind: "unavailable", requestedAgeMa: 0, reason: "source-absent" },
    topologyOwnership: { kind: "unavailable", requestedAgeMa: 0, reason: "source-absent" },
    charts: Array.from({ length: chartCount }, (_unused, index) => chart(`chart-${index}`)),
    activeSourceBytes: 0,
    anchorIds: [],
    resolveAnchor: () => null,
    addressForChartDirection: () => { throw new Error("unused fixture address"); },
    resolveAddress: () => { throw new Error("unused fixture resolve"); },
    release: vi.fn(),
  } satisfies PreparedCaoRevision;
}

function viewOf(
  geometry: CaoFoundationGeometryResource,
  active: readonly number[],
  chartCount: number,
): CaoFoundationSurfaceView {
  const chartPoses = new Float32Array(chartCount * 8);
  for (let chart = 0; chart < chartCount; chart += 1) {
    chartPoses.set([1, 0, 0, 0, 1, 0, 0, 0], chart * 8);
  }
  const publication: CaoFoundationPickState = { chartPoses, chartActive: new Uint8Array(active) };
  return { geometry, publication };
}

describe("palaeo composite surface", () => {
  // The native stack: shelf, one correction, and the Cao 2024 coast fill.
  const nativeGeometry = createCaoFoundationGeometryResource(revisionOf([
    { batchId: "batch-shelf", halfDegrees: 0.5, chartIndex: 0, nativePrecedence: false },
    { batchId: "correction-fine", halfDegrees: 0.3, chartIndex: 1, nativePrecedence: true },
    { batchId: "batch-land", halfDegrees: 0.25, chartIndex: 2, nativePrecedence: false },
  ], 3), limits);
  // The palaeo stack, published by the second renderer instance.
  const palaeoGeometry = createCaoFoundationGeometryResource(revisionOf([
    { batchId: "palaeo-shallow", halfDegrees: 0.4, chartIndex: 0, nativePrecedence: false,
      surfaceAppearance: "palaeo-shallow-marine" },
    { batchId: "palaeo-land", halfDegrees: 0.2, chartIndex: 1, nativePrecedence: false,
      surfaceAppearance: "palaeo-land" },
    { batchId: "palaeo-mountain", halfDegrees: 0.15, chartIndex: 2, nativePrecedence: false,
      surfaceAppearance: "palaeo-mountain" },
  ], 3), limits);

  const native = (active: readonly number[]) => viewOf(nativeGeometry, active, 3);
  const palaeo = (active: readonly number[]) => viewOf(palaeoGeometry, active, 3);

  it("ranks both instances against one precedence table when picking", () => {
    const pick = (nativeActive: readonly number[], palaeoActive: readonly number[],
      mode: "native" | "palaeo") =>
      intersectCaoComposite(native(nativeActive), palaeo(palaeoActive),
        [3, 0, 0], [-1, 0, 0], { mode })?.surfaceClass ?? null;

    // Mode off: the palaeo instance is not consulted at all, and the native
    // answers are exactly the ones the single-instance pick has always given.
    expect(pick([1, 1, 1], [1, 1, 1], "native")).toBe("land");
    expect(pick([1, 1, 0], [1, 1, 1], "native")).toBe("corrections");
    expect(pick([1, 0, 0], [1, 1, 1], "native")).toBe("shelf");

    // Mode on: native land is hidden, and a correction still outranks a mapped
    // shallow sea even though the two were drawn by different instances.
    expect(pick([1, 1, 1], [1, 1, 1], "palaeo")).toBe("palaeo-mountain");
    expect(pick([1, 1, 1], [1, 1, 0], "palaeo")).toBe("palaeo-land");
    expect(pick([1, 1, 1], [1, 0, 0], "palaeo")).toBe("corrections");
    expect(pick([1, 0, 1], [1, 0, 0], "palaeo")).toBe("palaeo-shallow-marine");
    expect(pick([1, 0, 1], [0, 0, 0], "palaeo")).toBe("shelf");
    expect(pick([0, 0, 1], [0, 0, 0], "palaeo")).toBeNull();

    // A missing instance is simply absent, never an error.
    expect(intersectCaoComposite(native([1, 1, 1]), null, [3, 0, 0], [-1, 0, 0],
      { mode: "palaeo" })?.surfaceClass).toBe("corrections");
    expect(intersectCaoComposite(null, palaeo([1, 1, 1]), [3, 0, 0], [-1, 0, 0],
      { mode: "palaeo" })?.surfaceClass).toBe("palaeo-mountain");
    expect(intersectCaoComposite(null, null, [3, 0, 0], [-1, 0, 0], {})).toBeNull();
  });

  it("answers land coverage across both instances with native land hidden", () => {
    const covers = (nativeActive: readonly number[], palaeoActive: readonly number[],
      mode: "native" | "palaeo", options = {}) =>
      caoCompositeCoversDirection(native(nativeActive), palaeo(palaeoActive),
        rendererDirection(0, 0), { mode, ...options });

    // Mode off: the Cao 2024 coast fill is the only land, and shelf water takes
    // the light ink.
    expect(covers([1, 0, 1], [1, 1, 1], "native", { includeShelf: false })).toBe(true);
    expect(covers([1, 0, 0], [1, 1, 1], "native", { includeShelf: false })).toBe(false);
    expect(covers([1, 0, 0], [0, 0, 0], "native", {})).toBe(true);

    // Mode on: the hidden coast fill must not answer "land" for a label sitting
    // over a Cao 2017 sea, and a palaeo landmass must.
    expect(covers([1, 0, 1], [0, 0, 0], "palaeo", { includeShelf: false })).toBe(false);
    expect(covers([1, 0, 1], [1, 0, 0], "palaeo", { includeShelf: false })).toBe(false);
    expect(covers([1, 0, 1], [0, 1, 0], "palaeo", { includeShelf: false })).toBe(true);
    expect(covers([1, 0, 1], [0, 0, 1], "palaeo", { includeShelf: false })).toBe(true);
    expect(covers([1, 1, 1], [0, 0, 0], "palaeo", { includeShelf: false })).toBe(true);
    // Any class at all: the palaeo shallow sea covers where nothing native does.
    expect(covers([0, 0, 0], [1, 0, 0], "palaeo", {})).toBe(true);
    expect(covers([0, 0, 0], [1, 0, 0], "native", {})).toBe(false);
    expect(covers([0, 0, 0], [0, 0, 0], "palaeo", {})).toBe(false);
    // An explicit class list is filtered by mode visibility too.
    expect(covers([1, 0, 1], [0, 0, 0], "palaeo", { surfaceClasses: ["land"] })).toBe(false);
    expect(covers([1, 0, 1], [0, 0, 0], "native", { surfaceClasses: ["land"] })).toBe(true);
  });

  it("holds the fallback boundary for one frame before switching the domain", () => {
    expect(CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA).toEqual({ youngest: 2.01, oldest: 402 });
    expect(caoPalaeoCoastlineAgeInsideDomain(90)).toBe(true);
    expect(caoPalaeoCoastlineAgeInsideDomain(2.01)).toBe(true);
    expect(caoPalaeoCoastlineAgeInsideDomain(402)).toBe(true);
    expect(caoPalaeoCoastlineAgeInsideDomain(2)).toBe(false);
    expect(caoPalaeoCoastlineAgeInsideDomain(402.001)).toBe(false);
    expect(caoPalaeoCoastlineAgeInsideDomain(0)).toBe(false);
    expect(caoPalaeoCoastlineAgeInsideDomain(null)).toBe(false);
    expect(caoPalaeoCoastlineAgeInsideDomain(Number.NaN)).toBe(false);

    // A request has to hold for a second consecutive frame before it is applied.
    let state = CAO_PALAEO_VISIBILITY_INITIAL_STATE;
    expect(state).toEqual({ visible: false, pendingFrames: 0 });
    state = nextCaoPalaeoVisibilityState(state, true);
    expect(state).toEqual({ visible: false, pendingFrames: 1 });
    state = nextCaoPalaeoVisibilityState(state, true);
    expect(state).toEqual({ visible: true, pendingFrames: 0 });
    // Steady state costs nothing.
    state = nextCaoPalaeoVisibilityState(state, true);
    expect(state).toEqual({ visible: true, pendingFrames: 0 });

    // A single frame across 402 Ma and straight back leaves the surface alone:
    // the blank-and-restore is what would read as a rendering fault.
    let flicker = nextCaoPalaeoVisibilityState(state, false);
    expect(flicker).toEqual({ visible: true, pendingFrames: 1 });
    flicker = nextCaoPalaeoVisibilityState(flicker, true);
    expect(flicker).toEqual({ visible: true, pendingFrames: 0 });

    // A real crossing still lands, one frame later.
    let crossing = nextCaoPalaeoVisibilityState(state, false);
    crossing = nextCaoPalaeoVisibilityState(crossing, false);
    expect(crossing).toEqual({ visible: false, pendingFrames: 0 });
    // And the delay never accumulates: coming back is one frame again.
    crossing = nextCaoPalaeoVisibilityState(crossing, true);
    crossing = nextCaoPalaeoVisibilityState(crossing, true);
    expect(crossing).toEqual({ visible: true, pendingFrames: 0 });
  });
});
