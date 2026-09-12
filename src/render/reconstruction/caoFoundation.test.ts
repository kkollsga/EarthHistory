import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { BufferAttribute, Group, IntType, Mesh } from "three";
import {
  CaoReconstructionRuntime,
  type PreparedCaoRevision,
  type ReconstructionPackageManifestV2,
  type StaticAssetFetcher,
} from "../../reconstruction";
import {
  CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
  CaoFoundationSurfaceRenderer,
  createCaoFoundationGeometryResource,
  estimateCaoFoundationGeometryReservation,
  intersectCaoFoundationSurface,
  packPreparedCaoPalette,
} from "./caoFoundation";
import { GpuRetirementOwner } from "./gpuRetirement";

function fixture(entryCount = 2): PreparedCaoRevision {
  const values = new Float32Array(entryCount * 11);
  for (let entry = 0; entry < entryCount; entry += 1) {
    values.set([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 1, 1], entry * 11);
  }
  const referenceDirections = new Float32Array([
    ...gplatesLonLat(-0.5, -0.5), ...gplatesLonLat(0.5, -0.5), ...gplatesLonLat(0, 0.5),
  ]);
  const indices = new Uint32Array([0, 1, 2]);
  const seamIds = new Uint32Array(3);
  const preparedEntryIndices = new Uint16Array([0, 0, 0]);
  const materialChartIndices = new Uint16Array([0, 0, 0]);
  const byteLength = [referenceDirections, indices, seamIds, preparedEntryIndices,
    materialChartIndices]
    .reduce((sum, array) => sum + array.byteLength, 0);
  return {
    identity: "cao@r1:0", requestId: 1, packageId: "cao", packageRevision: "r1",
    materialCorrectionIdentity: null,
    materialCorrections: { qualifiedActiveCharts: 0, uncertainActiveCharts: 0,
      formationUncertainActiveCharts: 0, modelInferredPoseActiveCharts: 0,
      overriddenNativeCharts: 0, activeSourceIds: [], correctionIds: [] },
    requestedAgeMa: 0, frameIdentity: "cao-frame",
    display: { youngerAgeMa: 0, olderAgeMa: 5, fraction: 0 },
    motionPalette: { stride: 11, entryCount, createValuesCopy: () => new Float32Array(values) },
    batches: [{ batchId: "global", staticGeometryIdentity: "global@1", vertexCount: 3,
      triangleCount: 1, staticGeometryBytes: byteLength, nativePrecedence: false,
      chartTriangleRanges: [{ chartIndex: 0, firstTriangle: 0, triangleCount: 1 }],
      createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(referenceDirections),
        indices: new Uint32Array(indices), seamIds: new Uint32Array(seamIds),
        preparedEntryIndices: new Uint16Array(preparedEntryIndices),
        materialChartIndices: new Uint16Array(materialChartIndices) }),
      createDisplayControlsCopy: () => ({
        displayHeightStart: { kind: "uniform", value: 0 },
        displayHeightEnd: { kind: "uniform", value: 0 },
        baseColor: { kind: "uniform", value: [0.37, 0.48, 0.24] } }) }],
    lineBatches: [],
    nativeBoundary: { kind: "unavailable", requestedAgeMa: 0, reason: "source-absent" },
    topologyOwnership: { kind: "unavailable", requestedAgeMa: 0, reason: "source-absent" },
    charts: [{ chartId: "chart", chartRevision: "1", materialId: "land",
      fragmentOrCohortId: "part", role: "model-geography",
      support: { kind: "supported", method: "compiled-rigid" },
      poseQuaternion: [1, 0, 0, 0], inversePoseQuaternion: [1, 0, 0, 0],
      evidence: { status: "unknown", sourceIds: ["cao"], limitations: ["neutral height"] } }],
    activeSourceBytes: byteLength,
    anchorIds: [],
    resolveAnchor: () => null,
    addressForChartDirection: () => { throw new Error("unused fixture address"); },
    resolveAddress: () => { throw new Error("unused fixture resolve"); },
    release: vi.fn(),
  };
}

const limits = { maxBatches: 8, maxVertices: 1_000, maxTriangles: 1_000,
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

describe("Cao foundation renderer boundary", () => {
  it("creates the renderer geometry from the verified public package ledger", async () => {
    const packageRoot = resolve("public/data/reconstruction/cao-v2.4");
    const manifest = JSON.parse(await readFile(resolve(packageRoot, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const fetcher: StaticAssetFetcher = async (path) => {
      const bytes = await readFile(resolve(packageRoot, path));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const revision = await runtime.request(0).prepared;
    const packageLimits = {
      ...limits,
      maxVertices: 190_000,
      // Conforming correction tessellation measures 245,164 primitives and
      // prevents source-supported triangles from sagging through the ocean.
      maxTriangles: 246_000,
      maxRetainedSourceBytes: 24 * 1024 * 1024,
    };
    const resource = createCaoFoundationGeometryResource(revision, packageLimits);
    expect(resource.batches).toHaveLength(3);
    expect(resource.lineBatches).toHaveLength(1);
    expect(resource.batches.reduce((sum, batch) => sum + batch.vertexCount, 0)).toBeGreaterThan(0);
    expect(resource.batches.reduce((sum, batch) => sum + batch.triangleCount, 0)).toBeGreaterThan(0);
    const staticKey = resource.key;
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 2_000_000);
    const surface = new CaoFoundationSurfaceRenderer(new Group(), retirement, packageLimits);
    const presentDiagnostics = surface.publish(revision, 8);
    expect(presentDiagnostics.countryLineSegments).toBeGreaterThan(0);
    expect(presentDiagnostics.nativeBoundarySegments).toBeGreaterThan(0);
    expect(presentDiagnostics.nativeBoundarySourceAgeMa).toBe(0);
    resource.dispose();
    const olderRevision = await runtime.request(450).prepared;
    const olderResource = createCaoFoundationGeometryResource(olderRevision, packageLimits);
    expect(olderResource.key).toBe(staticKey);
    expect(olderResource.batches.map((batch) => [batch.vertexCount, batch.triangleCount]))
      .toEqual(resource.batches.map((batch) => [batch.vertexCount, batch.triangleCount]));
    expect(olderResource.lineBatches.map((batch) => [batch.vertexCount, batch.segmentCount]))
      .toEqual(resource.lineBatches.map((batch) => [batch.vertexCount, batch.segmentCount]));
    olderResource.dispose();
    const olderDiagnostics = surface.publish(olderRevision, 8);
    expect(olderDiagnostics.nativeBoundarySourceAgeMa).toBe(450);
    surface.disposeForRendererTeardown();
    runtime.dispose();
  });

  it("packs 2D palette texels without relying on one row per chart", () => {
    const revision = fixture(2_921);
    const packed = packPreparedCaoPalette(revision, 2_048);
    expect(packed.width).toBe(256);
    expect(packed.height).toBe(35);
    expect(packed.data.slice(0, 12)).toEqual(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 1, 1, 0]));
  });

  it("preflights source bytes and creates one tracked geometry copy", () => {
    const revision = fixture();
    const reservation = estimateCaoFoundationGeometryReservation(revision, limits);
    const resource = createCaoFoundationGeometryResource(revision, limits);
    expect(resource.byteLength).toBeLessThanOrEqual(reservation);
    expect(resource.batches).toHaveLength(1);
    expect(resource.trackedGpuBufferBytes).toBeGreaterThan(0);
    expect((resource.batches[0]!.geometry.getAttribute("preparedEntryIndex") as BufferAttribute).gpuType)
      .toBe(IntType);
    resource.dispose();
  });

  it("gives visible native material draw and pick precedence across unequal tessellation", () => {
    const base = fixture(3);
    const makeBatch = (batchId: string, points: readonly (readonly [number, number])[],
      chartIndex: number, nativePrecedence: boolean) => {
      const directions = new Float32Array(points.flatMap(([lon, lat]) => gplatesLonLat(lon, lat)));
      const indices = new Uint32Array([0, 1, 2]);
      const seamIds = new Uint32Array(3);
      const entries = new Uint16Array([chartIndex, chartIndex, chartIndex]);
      const bytes = directions.byteLength + indices.byteLength + seamIds.byteLength + 2 * entries.byteLength;
      return { batchId, staticGeometryIdentity: `${batchId}@1`, vertexCount: 3,
        triangleCount: 1, staticGeometryBytes: bytes, nativePrecedence,
        chartTriangleRanges: [{ chartIndex, firstTriangle: 0, triangleCount: 1 }],
        createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(directions),
          indices: new Uint32Array(indices), seamIds: new Uint32Array(seamIds),
          preparedEntryIndices: new Uint16Array(entries), materialChartIndices: new Uint16Array(entries) }),
        createDisplayControlsCopy: () => ({ displayHeightStart: { kind: "uniform" as const, value: 0 },
          displayHeightEnd: { kind: "uniform" as const, value: 0 },
          baseColor: { kind: "uniform" as const, value: [0.4, 0.4, 0.3] as const } }) };
    };
    const chart = (chartId: string) => ({ ...base.charts[0]!, chartId, chartRevision: "1",
      materialId: chartId, fragmentOrCohortId: chartId });
    const revision = { ...base,
      batches: [
        makeBatch("native-coarse", [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]], 0, false),
        makeBatch("native-far", [[160, -20], [-160, -20], [180, 20]], 1, false),
        makeBatch("correction-fine", [[-0.05, -0.05], [0.05, -0.05], [0, 0.05]], 2, true),
      ], charts: [chart("native-coarse"), chart("native-far"), chart("correction")],
    } satisfies PreparedCaoRevision;
    const resource = createCaoFoundationGeometryResource(revision, limits);
    const identityPoses = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0,
      1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const overlap = intersectCaoFoundationSurface(resource,
      { chartPoses: identityPoses, chartActive: new Uint8Array([1, 0, 1]) },
      [3, 0, 0], [-1, 0, 0]);
    expect(overlap?.batchId).toBe("native-coarse");
    const grazing = intersectCaoFoundationSurface(resource,
      { chartPoses: identityPoses, chartActive: new Uint8Array([1, 0, 1]) },
      [3, 0, -0.004], [-1, 0, 0]);
    expect(grazing?.batchId).toBe("native-coarse");
    const farSideOnly = intersectCaoFoundationSurface(resource,
      { chartPoses: identityPoses, chartActive: new Uint8Array([0, 1, 1]) },
      [3, 0, 0], [-1, 0, 0]);
    expect(farSideOnly?.batchId).toBe("correction-fine");

    // A grazing ray can hit both the front and occluded side of the globe while
    // both hit positions still have a positive dot product with the camera.
    const nearLimbRevision = { ...base,
      batches: [
        makeBatch("native-occluded-positive-dot", [[86.78, -1], [88.78, -1], [87.78, 1]], 0, false),
        makeBatch("correction-front-limb", [[54.44, -0.5], [55.44, -0.5], [54.94, 0.5]], 1, true),
      ], charts: [chart("native-occluded-positive-dot"), chart("correction-front-limb")],
    } satisfies PreparedCaoRevision;
    const nearLimbResource = createCaoFoundationGeometryResource(nearLimbRevision, limits);
    const nearLimbHit = intersectCaoFoundationSurface(nearLimbResource,
      { chartPoses: identityPoses.subarray(0, 16), chartActive: new Uint8Array([1, 1]) },
      [3, 0, 0], [-Math.sqrt(1 - 0.32 ** 2), 0, -0.32]);
    expect(nearLimbHit?.batchId).toBe("correction-front-limb");

    const group = new Group();
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 1_000_000);
    const surface = new CaoFoundationSurfaceRenderer(group, retirement, limits);
    surface.publish(revision, 8);
    const meshes = group.children[0]!.children.filter((child): child is Mesh => child instanceof Mesh);
    expect(meshes.map((mesh) => {
      if (Array.isArray(mesh.material)) throw new Error("Cao surface mesh unexpectedly has multiple materials");
      return [mesh.renderOrder, mesh.material.depthWrite, mesh.material.depthTest];
    }))
      .toEqual([[1, true, true], [1, true, true], [0.9, false, true]]);
    surface.disposeForRendererTeardown();
    nearLimbResource.dispose();
    resource.dispose();
  });

  it("binds reconstructed country references and exact native boundaries to the same publication", () => {
    const base = fixture();
    const referenceDirections = new Float32Array([1, 0, 0, 0, 1, 0]);
    const lineIndices = new Uint32Array([0, 1]);
    const preparedEntryIndices = new Uint16Array([0, 0]);
    const materialChartIndices = new Uint16Array([0, 0]);
    const corner = 1 / Math.sqrt(1.02);
    const topologyDirections = new Float32Array([
      corner, -0.1 * corner, -0.1 * corner,
      corner, 0.1 * corner, -0.1 * corner,
      corner, 0.1 * corner, 0.1 * corner,
      corner, -0.1 * corner, 0.1 * corner,
    ]);
    const lineBytes = referenceDirections.byteLength + lineIndices.byteLength
      + preparedEntryIndices.byteLength + materialChartIndices.byteLength;
    const revision = {
      ...base,
      lineBatches: [{ batchId: "countries", staticGeometryIdentity: "countries@1",
        vertexCount: 2, segmentCount: 1, staticGeometryBytes: lineBytes,
        createStaticGeometryCopy: () => ({ referenceDirections: new Float32Array(referenceDirections),
          lineIndices: new Uint32Array(lineIndices),
          preparedEntryIndices: new Uint16Array(preparedEntryIndices),
          materialChartIndices: new Uint16Array(materialChartIndices) }) }],
      nativeBoundary: { kind: "exact-source" as const, sourceAgeMa: 0,
        value: { segments: [{ segmentId: "ridge", sourceFeatureId: "ridge", sourcePart: 0,
          sourceFeatureType: "MidOceanRidge", validTimeMa: { youngest: 0, oldest: 540 },
          kind: "ridge" as const, polarity: "unknown" as const, rightTopologyId: null,
          leftTopologyId: null, rightPlateId: null, leftPlateId: null,
          ownershipStatus: "unknown" as const, pointOffset: 0, pointCount: 2 }],
        pointCount: 2, sourceBytes: 56,
        createDirectionsCopy: () => new Float32Array(referenceDirections) } },
      topologyOwnership: { kind: "exact-source" as const, sourceAgeMa: 0,
        value: { rings: [{ ringId: "owner", polygonId: "polygon", ringRole: "exterior" as const,
          topologyId: "topology", plateId: 101, status: "instantaneous-owner" as const,
          candidatePlateIds: [101], pointOffset: 0, pointCount: 4 }],
        pointCount: 4, sourceBytes: topologyDirections.byteLength,
        createDirectionsCopy: () => new Float32Array(topologyDirections) } },
    } satisfies PreparedCaoRevision;
    const resource = createCaoFoundationGeometryResource(revision, limits);
    expect(resource.lineBatches).toHaveLength(1);
    expect((resource.lineBatches[0]!.geometry.getAttribute("preparedEntryIndex") as BufferAttribute).gpuType)
      .toBe(IntType);
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 1_000_000);
    const group = new Group();
    const surface = new CaoFoundationSurfaceRenderer(group, retirement, limits);
    const diagnostics = surface.publish(revision, 8);
    expect(diagnostics).toMatchObject({ drawCount: 3, countryLineBatches: 1,
      countryLineSegments: 1, nativeBoundarySegments: 1, nativeBoundarySourceAgeMa: 0,
      topologyOwnershipRings: 1, topologyOwnershipSourceAgeMa: 0 });
    expect(surface.identifyTopology([1, 0, 0])).toEqual({ kind: "instantaneous-owner",
      plateId: 101, topologyId: "topology", sourceAgeMa: 0 });
    expect(surface.identifyTopology([-1, 0, 0])).toBeNull();
    surface.setLayerVisibility(false, false);
    expect(group.children[0]!.children.filter((child) => child.userData.overlayLayer).every(
      (child) => !child.visible,
    )).toBe(true);
    surface.disposeForRendererTeardown();
    resource.dispose();
  });

  it("uses the intended spherical side across the dateline, poles, and holes", () => {
    const base = fixture();
    const rings = [
      { ringId: "dateline", polygonId: "dateline", ringRole: "exterior" as const,
        topologyId: "dateline-topology", plateId: 1, status: "instantaneous-owner" as const,
        candidatePlateIds: [1], pointOffset: 0, pointCount: 4 },
      { ringId: "pole", polygonId: "pole", ringRole: "exterior" as const,
        topologyId: "pole-topology", plateId: 2, status: "instantaneous-owner" as const,
        candidatePlateIds: [2], pointOffset: 4, pointCount: 4 },
      { ringId: "outer", polygonId: "with-hole", ringRole: "exterior" as const,
        topologyId: "hole-topology", plateId: 3, status: "instantaneous-owner" as const,
        candidatePlateIds: [3], pointOffset: 8, pointCount: 4 },
      { ringId: "hole", polygonId: "with-hole", ringRole: "hole" as const,
        topologyId: "hole-topology", plateId: 3, status: "instantaneous-owner" as const,
        candidatePlateIds: [3], pointOffset: 12, pointCount: 4 },
    ];
    const points = [
      [-170, -10], [170, -10], [170, 10], [-170, 10],
      [0, 80], [90, 80], [180, 80], [-90, 80],
      [-10, -10], [10, -10], [10, 10], [-10, 10],
      [-2, -2], [2, -2], [2, 2], [-2, 2],
    ] as const;
    const directions = new Float32Array(points.flatMap(([lon, lat]) => gplatesLonLat(lon, lat)));
    const revision = { ...base,
      topologyOwnership: { kind: "exact-source" as const, sourceAgeMa: 0,
        value: { rings, pointCount: points.length, sourceBytes: directions.byteLength,
          createDirectionsCopy: () => new Float32Array(directions) } },
    } satisfies PreparedCaoRevision;
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: async () => {} }, 2, 1_000_000);
    const surface = new CaoFoundationSurfaceRenderer(new Group(), retirement, limits);
    surface.publish(revision, 8);
    expect(surface.identifyTopology(rendererDirection(180, 0))).toMatchObject({ plateId: 1 });
    expect(surface.identifyTopology(rendererDirection(0, 0))).toBeNull();
    expect(surface.identifyTopology(rendererDirection(0, 90))).toMatchObject({ plateId: 2 });
    expect(surface.identifyTopology(rendererDirection(5, 0))).toMatchObject({ plateId: 3 });
    expect(surface.identifyTopology(rendererDirection(0, 0))).toBeNull();
    surface.disposeForRendererTeardown();
  });

  it("rejects limits and inconsistent prepared indices before publication", () => {
    const revision = fixture();
    expect(() => estimateCaoFoundationGeometryReservation(revision,
      { ...limits, maxRetainedSourceBytes: 1 })).toThrow(/exceeds renderer limit/);
    const invalid = fixture();
    const original = invalid.batches[0]!.createStaticGeometryCopy;
    const broken = { ...invalid, batches: [{ ...invalid.batches[0]!, createStaticGeometryCopy: () => {
      const copy = original(); copy.preparedEntryIndices[0] = 99; return copy;
    } }] } satisfies PreparedCaoRevision;
    expect(() => createCaoFoundationGeometryResource(broken, limits)).toThrow(/palette or chart index/);
  });

  it("keeps the measured land shell offset outside source physical height", () => {
    expect(CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES).toBe(400);
    expect(CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES).toBeGreaterThan(305.306);
  });

  it("inverse-picks the same rigid 400 m shell triangles and skips inactive charts", () => {
    const resource = createCaoFoundationGeometryResource(fixture(), limits);
    const rayOrigin = [3, 0, 0] as const;
    const rayDirection = [-1, 0, 0] as const;
    const poses = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0]);
    const hit = intersectCaoFoundationSurface(resource,
      { chartPoses: poses, chartActive: new Uint8Array([1]) }, rayOrigin, rayDirection);
    expect(hit).toMatchObject({ batchId: "global", chartIndex: 0, triangleIndex: 0 });
    expect(hit?.position.every(Number.isFinite)).toBe(true);
    const halfSqrt = Math.SQRT1_2;
    const rotated = intersectCaoFoundationSurface(resource,
      { chartPoses: new Float32Array([halfSqrt, 0, 0, halfSqrt, halfSqrt, 0, 0, -halfSqrt]),
        chartActive: new Uint8Array([1]) },
      [0, 0, -3], [0, 0, 1]);
    expect(rotated).toMatchObject({ chartIndex: 0, triangleIndex: 0 });
    expect(intersectCaoFoundationSurface(resource,
      { chartPoses: poses, chartActive: new Uint8Array([0]) }, rayOrigin, rayDirection)).toBeNull();
    resource.dispose();
  });

  it("blocks another publication while the bounded retirement fence is stalled", async () => {
    const completions: Array<() => void> = [];
    const retirement = new GpuRetirementOwner({ waitForSubmittedWork: () => (
      new Promise<void>((resolve) => completions.push(resolve))
    ) }, 1, 1_000_000);
    const surface = new CaoFoundationSurfaceRenderer(new Group(), retirement, limits);
    surface.publish(fixture(), 1);
    surface.publish({ ...fixture(), identity: "cao@r1:1", requestId: 2, requestedAgeMa: 1 }, 1);
    expect(retirement.pendingCount()).toBe(1);
    expect(() => surface.publish({ ...fixture(), identity: "cao@r1:2", requestId: 3, requestedAgeMa: 2 }, 1))
      .toThrow(/retirement backpressure/);
    completions.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(retirement.pendingCount()).toBe(0);
    surface.disposeForRendererTeardown();
    completions.shift()?.();
  });
});
