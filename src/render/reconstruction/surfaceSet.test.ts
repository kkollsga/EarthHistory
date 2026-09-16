import { describe, expect, it, vi } from "vitest";
import {
  CAO_FOUNDATION_DEFAULT_BASE_COLORS,
  CAO_FOUNDATION_SURFACE_PRECEDENCE,
  caoFoundationSurfaceClassVisible,
  createCaoFoundationGeometryResource,
  type CaoFoundationCoverageOptions,
  type CaoFoundationGeometryResource,
  type CaoFoundationPickState,
  type CaoFoundationSurfaceMode,
  type CaoFoundationSurfaceView,
} from "./caoFoundation";
import {
  caoSurfaceSetCoversDirection,
  caoSurfaceSetReferenceSurfaceClass,
  intersectCaoSurfaceSet,
} from "./surfaceSet";
import {
  CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA,
  CAO_PALAEO_LGM_AGE_BAND_MA,
  caoPalaeoCoastlineAgeInsideDomain,
  caoPalaeoCoastlineDomainBand,
} from "./surfaceVisibility";
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
      restoredCollisionMarginActiveCharts: 0,
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
  mode: CaoFoundationSurfaceMode,
): CaoFoundationSurfaceView {
  const chartPoses = new Float32Array(chartCount * 8);
  for (let chart = 0; chart < chartCount; chart += 1) {
    chartPoses.set([1, 0, 0, 0, 1, 0, 0, 0], chart * 8);
  }
  const publication: CaoFoundationPickState = { chartPoses, chartActive: new Uint8Array(active) };
  return { geometry, publication, mode };
}

describe("surface set", () => {
  // The native stack: shelf, one correction, and the Cao 2024 coast fill.
  const nativeGeometry = createCaoFoundationGeometryResource(revisionOf([
    { batchId: "batch-shelf", halfDegrees: 0.5, chartIndex: 0, nativePrecedence: false },
    { batchId: "correction-fine", halfDegrees: 0.3, chartIndex: 1, nativePrecedence: true },
    { batchId: "batch-land", halfDegrees: 0.25, chartIndex: 2, nativePrecedence: false },
  ], 3), limits);
  // The Cao 2017 stack, the set member the band and the LGM overlay draw.
  const palaeoGeometry = createCaoFoundationGeometryResource(revisionOf([
    { batchId: "palaeo-shallow", halfDegrees: 0.4, chartIndex: 0, nativePrecedence: false,
      surfaceAppearance: "palaeo-shallow-marine" },
    { batchId: "palaeo-land", halfDegrees: 0.2, chartIndex: 1, nativePrecedence: false,
      surfaceAppearance: "palaeo-land" },
    { batchId: "palaeo-mountain", halfDegrees: 0.15, chartIndex: 2, nativePrecedence: false,
      surfaceAppearance: "palaeo-mountain" },
  ], 3), limits);

  const native = (active: readonly number[], mode: CaoFoundationSurfaceMode) =>
    viewOf(nativeGeometry, active, 3, mode);
  const palaeo = (active: readonly number[]) => viewOf(palaeoGeometry, active, 3, "palaeo");
  /**
   * The set the composition draws: the Cao 2024 member in the mode the band
   * puts it in, and the Cao 2017 member wherever it is on screen — which is the
   * Cao 2017 band, and the LGM band, where it is drawn over today's land rather
   * than instead of it.
   */
  const set = (nativeActive: readonly number[], palaeoActive: readonly number[],
    mode: CaoFoundationSurfaceMode, palaeoVisible = mode === "palaeo") =>
    [native(nativeActive, mode), ...(palaeoVisible ? [palaeo(palaeoActive)] : [])];

  it("ranks both instances against one precedence table when picking", () => {
    const pick = (nativeActive: readonly number[], palaeoActive: readonly number[],
      mode: "native" | "palaeo") =>
      intersectCaoSurfaceSet(set(nativeActive, palaeoActive, mode),
        [3, 0, 0], [-1, 0, 0])?.surfaceClass ?? null;

    // Mode off: the palaeo instance is not consulted at all, and the native
    // answers are exactly the ones the single-instance pick has always given.
    expect(pick([1, 1, 1], [1, 1, 1], "native")).toBe("land");
    expect(pick([1, 1, 0], [1, 1, 1], "native")).toBe("corrections");
    expect(pick([1, 0, 0], [1, 1, 1], "native")).toBe("shelf");

    // Mode on: every class drawn in native land's colour is hidden — the coast
    // fill and the land-appearance corrections alike — so a mapped shallow sea
    // is the answer over ground a correction also covers, whichever instance
    // drew it. The pick has to agree with the pixels, and no land tone is drawn.
    expect(pick([1, 1, 1], [1, 1, 1], "palaeo")).toBe("palaeo-mountain");
    expect(pick([1, 1, 1], [1, 1, 0], "palaeo")).toBe("palaeo-land");
    expect(pick([1, 1, 1], [1, 0, 0], "palaeo")).toBe("palaeo-shallow-marine");
    // The Cao 2024 crust shelf is not drawn in the band either: ground the Cao
    // 2017 map does not map is deep sea, and the pick answers nothing over it.
    expect(pick([1, 1, 1], [0, 0, 0], "palaeo")).toBeNull();
    expect(pick([1, 0, 1], [1, 0, 0], "palaeo")).toBe("palaeo-shallow-marine");
    expect(pick([1, 0, 1], [0, 0, 0], "palaeo")).toBeNull();
    expect(pick([0, 0, 1], [0, 0, 0], "palaeo")).toBeNull();

    // The `lgm` band keeps the Cao 2024 member in the native mode with the
    // lowstand member over it, and there the corrections are today's observed
    // ground: they stay pickable.
    const lgmPick = intersectCaoSurfaceSet(set([1, 1, 1], [1, 0, 0], "native", true),
      [3, 0, 0], [-1, 0, 0])?.surfaceClass ?? null;
    expect(lgmPick).toBe("land");
    expect(intersectCaoSurfaceSet(set([1, 1, 0], [1, 0, 0], "native", true), [3, 0, 0],
      [-1, 0, 0])?.surfaceClass).toBe("corrections");

    // A member that is not on screen is simply absent from the set, never an error.
    expect(intersectCaoSurfaceSet([native([1, 1, 1], "palaeo")], [3, 0, 0],
      [-1, 0, 0])?.surfaceClass ?? null).toBeNull();
    expect(intersectCaoSurfaceSet([native([1, 1, 1], "native")], [3, 0, 0],
      [-1, 0, 0])?.surfaceClass).toBe("land");
    expect(intersectCaoSurfaceSet([palaeo([1, 1, 1])], [3, 0, 0],
      [-1, 0, 0])?.surfaceClass).toBe("palaeo-mountain");
    expect(intersectCaoSurfaceSet([], [3, 0, 0], [-1, 0, 0])).toBeNull();
  });

  it("drops the crust shelf from the Cao 2017 band's precedence and keeps the margins", () => {
    // The composite's own filter is class visibility per mode, so the band's
    // five levels are exactly the classes it ranks. Re-enabling `shelf` in the
    // palaeo mode turns this list back into six and fails here.
    const ranked = (mode: "native" | "palaeo") => CAO_FOUNDATION_SURFACE_PRECEDENCE
      .filter((surfaceClass) => caoFoundationSurfaceClassVisible(surfaceClass, mode));
    expect(ranked("palaeo")).toEqual(["correction-shelf", "palaeo-shallow-marine",
      "palaeo-land", "palaeo-mountain"]);
    expect(ranked("native")).toEqual(["shelf", "correction-shelf", "corrections", "land"]);
  });

  it("names the class over one piece of present-day ground", () => {
    // The compiled witness table asks about ground, not about a screen position:
    // the answer must be the class drawn last over that ground, and it must be
    // read in the frame the charts store their geometry in rather than through
    // a pose.
    const classify = (nativeActive: readonly number[], palaeoActive: readonly number[],
      mode: "native" | "palaeo") =>
      caoSurfaceSetReferenceSurfaceClass(set(nativeActive, palaeoActive, mode),
        gplatesLonLat(0, 0) as unknown as [number, number, number]);
    expect(classify([1, 1, 1], [1, 1, 1], "native")).toBe("land");
    expect(classify([1, 1, 1], [1, 1, 1], "palaeo")).toBe("palaeo-mountain");
    expect(classify([1, 1, 1], [1, 1, 0], "palaeo")).toBe("palaeo-land");
    // The correction is hidden with native land, so the guide-label ink over
    // this ground reads the shallow sea it can actually see.
    expect(classify([1, 1, 1], [1, 0, 0], "palaeo")).toBe("palaeo-shallow-marine");
    // Nothing the band draws covers this ground once the palaeo charts are off:
    // the crust shelf is hidden with native land, so the label ink reads the
    // deep sea it can actually see.
    expect(classify([1, 1, 1], [0, 0, 0], "palaeo")).toBeNull();
    expect(classify([1, 0, 1], [1, 0, 0], "palaeo")).toBe("palaeo-shallow-marine");
    expect(classify([1, 0, 1], [0, 0, 0], "palaeo")).toBeNull();
    expect(classify([0, 0, 1], [0, 0, 0], "palaeo")).toBeNull();
    // Off the fixture's ground nothing answers, in either mode.
    expect(caoSurfaceSetReferenceSurfaceClass(set([1, 1, 1], [1, 1, 1], "palaeo"),
      gplatesLonLat(90, 0) as unknown as [number, number, number])).toBeNull();
  });

  it("answers land coverage across both instances with native land hidden", () => {
    const covers = (nativeActive: readonly number[], palaeoActive: readonly number[],
      mode: "native" | "palaeo",
      options: CaoFoundationCoverageOptions & { palaeoVisible?: boolean } = {}) => {
      const { palaeoVisible, ...coverage } = options;
      return caoSurfaceSetCoversDirection(set(nativeActive, palaeoActive, mode, palaeoVisible),
        rendererDirection(0, 0), coverage);
    };

    // Mode off: the Cao 2024 coast fill is the only land, and shelf water takes
    // the light ink.
    expect(covers([1, 0, 1], [1, 1, 1], "native", { includeShelf: false })).toBe(true);
    expect(covers([1, 0, 0], [1, 1, 1], "native", { includeShelf: false })).toBe(false);
    expect(covers([1, 0, 0], [0, 0, 0], "native", {})).toBe(true);

    // Mode on: no hidden land fill may answer "land" for a label sitting over a
    // Cao 2017 sea — neither the coast fill nor a land-appearance correction —
    // and a palaeo landmass must.
    expect(covers([1, 0, 1], [0, 0, 0], "palaeo", { includeShelf: false })).toBe(false);
    expect(covers([1, 0, 1], [1, 0, 0], "palaeo", { includeShelf: false })).toBe(false);
    expect(covers([1, 0, 1], [0, 1, 0], "palaeo", { includeShelf: false })).toBe(true);
    expect(covers([1, 0, 1], [0, 0, 1], "palaeo", { includeShelf: false })).toBe(true);
    expect(covers([1, 1, 1], [0, 0, 0], "palaeo", { includeShelf: false })).toBe(false);
    expect(covers([1, 1, 1], [1, 0, 0], "palaeo", { includeShelf: false })).toBe(false);
    // And in the `lgm` band, which runs the native mode with both members on
    // screen, the same correction still answers "land".
    expect(covers([1, 1, 0], [0, 0, 0], "native", { includeShelf: false, palaeoVisible: true }))
      .toBe(true);
    // Any class at all: the palaeo shallow sea covers where nothing native does.
    expect(covers([0, 0, 0], [1, 0, 0], "palaeo", {})).toBe(true);
    expect(covers([0, 0, 0], [1, 0, 0], "native", {})).toBe(false);
    expect(covers([0, 0, 0], [0, 0, 0], "palaeo", {})).toBe(false);
    // An explicit class list is filtered by mode visibility too.
    expect(covers([1, 0, 1], [0, 0, 0], "palaeo", { surfaceClasses: ["land"] })).toBe(false);
    expect(covers([1, 0, 1], [0, 0, 0], "native", { surfaceClasses: ["land"] })).toBe(true);
    expect(covers([1, 1, 0], [0, 0, 0], "palaeo", { surfaceClasses: ["corrections"] })).toBe(false);
    expect(covers([1, 1, 0], [0, 0, 0], "native", { surfaceClasses: ["corrections"] })).toBe(true);
  });

  it("splits the palaeo domain into the Cao 2017 band and the detached LGM band", () => {
    expect(CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA).toEqual({ youngest: 2.01, oldest: 402 });
    expect(CAO_PALAEO_LGM_AGE_BAND_MA).toEqual({ youngestExclusive: 0.0195, oldest: 0.0265 });
    expect(caoPalaeoCoastlineAgeInsideDomain(90)).toBe(true);
    expect(caoPalaeoCoastlineAgeInsideDomain(2.01)).toBe(true);
    expect(caoPalaeoCoastlineAgeInsideDomain(402)).toBe(true);
    expect(caoPalaeoCoastlineAgeInsideDomain(2)).toBe(false);
    expect(caoPalaeoCoastlineAgeInsideDomain(402.001)).toBe(false);
    expect(caoPalaeoCoastlineAgeInsideDomain(0)).toBe(false);
    expect(caoPalaeoCoastlineAgeInsideDomain(null)).toBe(false);
    expect(caoPalaeoCoastlineAgeInsideDomain(Number.NaN)).toBe(false);
    expect(caoPalaeoCoastlineDomainBand(90)).toBe("cao-2017");
    expect(caoPalaeoCoastlineDomainBand(2.01)).toBe("cao-2017");
    expect(caoPalaeoCoastlineDomainBand(402)).toBe("cao-2017");
    // The LGM window is half-open like every other interval in the pipeline.
    expect(caoPalaeoCoastlineDomainBand(0.021)).toBe("lgm");
    expect(caoPalaeoCoastlineDomainBand(0.0265)).toBe("lgm");
    expect(caoPalaeoCoastlineDomainBand(0.0195)).toBe("none");
    expect(caoPalaeoCoastlineDomainBand(0.0194)).toBe("none");
    expect(caoPalaeoCoastlineDomainBand(0.0266)).toBe("none");
    expect(caoPalaeoCoastlineDomainBand(0)).toBe("none");
    expect(caoPalaeoCoastlineDomainBand(1)).toBe("none");
    expect(caoPalaeoCoastlineDomainBand(null)).toBe("none");
    expect(caoPalaeoCoastlineAgeInsideDomain(0.021)).toBe(true);
  });

});
