import { describe, expect, it } from "vitest";
import { Group } from "three";
import { CaoFoundationSurfaceRenderer } from "./caoFoundation";
import { GpuRetirementOwner } from "./gpuRetirement";
import {
  NO_PALAEO_MATERIAL_CORRECTIONS,
  palaeoChartPickState,
  preparedCaoRevisionForPalaeoInterval,
} from "./palaeoPublication";
import type { PreparedCaoPalaeoInterval } from "../../reconstruction";

const limits = { maxBatches: 8, maxVertices: 1_000, maxTriangles: 1_000,
  maxRetainedSourceBytes: 1_000_000, maxTextureSize: 2_048, maxPublicationBytes: 1_000_000,
  maxSpatialIndexBytes: 1_000_000 };

function gplatesLonLat(longitude: number, latitude: number): readonly [number, number, number] {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

function retirement(maxResources = 1): GpuRetirementOwner {
  return new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, maxResources, 8_000_000);
}

/** One triangle of one palaeo class, in the shape the interval store prepares. */
function palaeoInterval(
  intervalId: string,
  intervalIndex: number,
  digest: string,
  onRelease: () => void = () => {},
): PreparedCaoPalaeoInterval {
  const values = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1]);
  const referenceDirections = new Float32Array([
    ...gplatesLonLat(-0.5, -0.5), ...gplatesLonLat(0.5, -0.5), ...gplatesLonLat(0, 0.5),
  ]);
  const indices = new Uint32Array([0, 1, 2]);
  const seamIds = new Uint32Array([2_000_000_000, 2_000_000_001, 2_000_000_002]);
  const entries = new Uint16Array([0, 0, 0]);
  const staticGeometryBytes = referenceDirections.byteLength + indices.byteLength
    + seamIds.byteLength + 2 * entries.byteLength;
  let released = 0;
  return {
    identity: `cao@r1:palaeo:${intervalId}:1`,
    requestId: 1,
    packageId: "cao",
    packageRevision: "r1",
    frameIdentity: "cao-frame",
    requestedAgeMa: 390,
    intervalId,
    intervalIndex,
    fromAgeMa: 402,
    toAgeMa: 380.01,
    maximumEdgeDegrees: 1,
    motionPalette: { stride: 11, entryCount: 1,
      createValuesCopy: () => new Float32Array(values) },
    batches: [{
      batchId: "palaeo-lm",
      staticGeometryIdentity: `cao@r1:palaeo-lm:${digest}`,
      staticGeometryReplaceable: true,
      vertexCount: 3,
      triangleCount: 1,
      staticGeometryBytes,
      nativePrecedence: false,
      surfaceAppearance: "palaeo-land",
      chartTriangleRanges: [{ chartIndex: 0, firstTriangle: 0, triangleCount: 1 }],
      createStaticGeometryCopy: () => ({
        referenceDirections: new Float32Array(referenceDirections),
        indices: new Uint32Array(indices),
        seamIds: new Uint32Array(seamIds),
        preparedEntryIndices: new Uint16Array(entries),
        materialChartIndices: new Uint16Array(entries),
      }),
      createDisplayControlsCopy: () => ({
        displayHeightStart: { kind: "uniform", value: 0 },
        displayHeightEnd: { kind: "uniform", value: 0 },
        baseColor: { kind: "uniform", value: [0.42, 0.37, 0.3] },
      }),
    }],
    charts: [{
      chartId: `palaeo:lm:${intervalId}:0`,
      chartRevision: `palaeo-coastlines-lm-v1@${digest}`,
      materialId: "palaeo:lm:0",
      fragmentOrCohortId: "palaeo:lm:0:101",
      role: "model-geography",
      support: { kind: "supported", method: "compiled-rigid" },
      evidence: { status: "model-output", sourceIds: ["cao-2017-paleogeography"],
        limitations: ["maximum flooding over the map interval"] },
      surfaceEvidence: { kind: "classified", surfaceClass: "land",
        sourceIds: ["cao-2017-paleogeography"] },
      poseQuaternion: [1, 0, 0, 0],
      inversePoseQuaternion: [1, 0, 0, 0],
      surfaceClass: "lm",
      appearance: "palaeo-land",
      sourceStatus: "classified-map-polygon",
      flags: 0,
      editorial: null,
    }],
    activeChartCount: 1,
    activeSourceIds: ["cao-2017-paleogeography"],
    activeLimitations: ["maximum flooding over the map interval"],
    activeSourceBytes: 4_096,
    release: () => { released += 1; if (released === 1) onRelease(); },
  } as unknown as PreparedCaoPalaeoInterval;
}

describe("palaeo interval publication adapter", () => {
  it("states every absence a map interval has rather than leaving it to be inferred", () => {
    const revision = preparedCaoRevisionForPalaeoInterval(palaeoInterval("402-380", 0, "a"));
    expect(revision.lineBatches).toEqual([]);
    expect(revision.anchorIds).toEqual([]);
    expect(revision.nativeBoundary).toMatchObject({ kind: "unavailable", reason: "source-absent" });
    expect(revision.topologyOwnership).toMatchObject({ kind: "unavailable" });
    expect(revision.materialCorrectionIdentity).toBeNull();
    expect(revision.materialCorrections).toBe(NO_PALAEO_MATERIAL_CORRECTIONS);
    expect(revision.materialCorrections.qualifiedActiveCharts).toBe(0);
    // Every palaeo palette entry carries the same activation at both ends, so
    // the display fraction the renderer mixes with is a fixed 0, not a bracket.
    expect(revision.display).toEqual({ youngerAgeMa: 390, olderAgeMa: 390, fraction: 0 });
    expect(revision.resolveAnchor("anything")).toBeNull();
    expect(() => revision.resolveAddress({} as never)).toThrow(/no material addresses/);
    expect(() => revision.addressForChartDirection(0, [1, 0, 0])).toThrow(/no material addresses/);
  });

  it("builds pose tables that follow chart activation", () => {
    const interval = palaeoInterval("402-380", 0, "a");
    const active = palaeoChartPickState(interval.charts);
    expect(active.chartPoses).toHaveLength(8);
    expect([...active.chartActive]).toEqual([1]);
    const inactive = palaeoChartPickState(interval.charts.map((chart) => ({
      ...chart, support: { kind: "inactive" as const, reason: "unborn" as const } })));
    expect([...inactive.chartActive]).toEqual([0]);
  });

  it("publishes an interval, forwards its lease and swaps geometry only when armed", () => {
    const releases: string[] = [];
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, retirement(), limits,
      { staticGeometryRetirement: retirement() });
    const first = palaeoInterval("402-380", 0, "a", () => releases.push("402-380"));
    const diagnostics = surface.publish(preparedCaoRevisionForPalaeoInterval(first), 8);
    // `publish` takes the lease over, exactly as it does for a native revision,
    // so the interval store is free to evict the decoded payload.
    expect(releases).toEqual(["402-380"]);
    expect(diagnostics.identity).toBe(first.identity);
    expect(diagnostics.triangles).toBe(1);
    expect(diagnostics.chartRanges).toBe(1);
    expect(diagnostics.activeSourceBytes).toBe(4_096);

    // A new map interval is a new static geometry. Unarmed it must fail loudly,
    // and the failing publication still releases the lease it was handed.
    const unarmed = palaeoInterval("380-359", 1, "b", () => releases.push("380-359-unarmed"));
    expect(() => surface.publish(preparedCaoRevisionForPalaeoInterval(unarmed), 8))
      .toThrow(/static geometry changed/);
    expect(releases).toContain("380-359-unarmed");
    expect(surface.diagnostics().identity).toBe(first.identity);

    surface.armStaticGeometryChange("palaeo-coastline map interval 402-380 to 380-359");
    const second = palaeoInterval("380-359", 1, "b", () => releases.push("380-359"));
    const swapped = surface.publish(preparedCaoRevisionForPalaeoInterval(second), 8);
    expect(swapped.identity).toBe(second.identity);
    expect(swapped.staticGeometryIdentity).toContain("palaeo-lm:b");
    expect(releases).toContain("380-359");

    // The arm is spent by that one replacement: the next one must arm again.
    const third = palaeoInterval("359-338", 2, "c");
    expect(() => surface.publish(preparedCaoRevisionForPalaeoInterval(third), 8))
      .toThrow(/static geometry changed/);
    surface.disposeForRendererTeardown();
  });

  it("re-poses a published interval and clears it without touching its geometry key", () => {
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, retirement(), limits,
      { staticGeometryRetirement: retirement() });
    const interval = palaeoInterval("402-380", 0, "a");
    surface.publish(preparedCaoRevisionForPalaeoInterval(interval), 8);
    const pick = palaeoChartPickState(interval.charts);
    const retargeted = surface.retargetMotion(interval.motionPalette.createValuesCopy(), 1, 0,
      pick.chartPoses, pick.chartActive, 385, NO_PALAEO_MATERIAL_CORRECTIONS);
    expect(retargeted.requestedAgeMa).toBe(385);
    expect(retargeted.staticGeometryIdentity).toContain("palaeo-lm:a");

    // Clearing is what the mode's own toggle does: the publication goes, and a
    // republication of the same interval needs no arm because the key is the same.
    surface.clear();
    expect(surface.diagnostics().identity).toBeNull();
    const again = palaeoInterval("402-380", 0, "a");
    expect(surface.publish(preparedCaoRevisionForPalaeoInterval(again), 8).identity)
      .toBe(again.identity);
    surface.disposeForRendererTeardown();
  });
});
