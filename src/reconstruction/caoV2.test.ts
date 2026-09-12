import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime } from "./engineV2";
import { evaluateLifecycleSupport } from "./motion";
import type { StaticAssetFetcher } from "./assetLoader";
import type { MaterialCorrectionCatalogV1, ReconstructionPackageManifestV2 } from "./packageV2";
import { decodeCaoSpatialBatch } from "./spatialV2";
import { EARTH_RADIUS_METRES } from "./arithmetic";
import { CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
  createCaoFoundationGeometryResource } from "../render/reconstruction/caoFoundation";

// Independent strict pyGPlates totals are tracked in
// docs/research/reconstruction-cao-complete-rotation-witnesses.json.
const completeRotationWitnesses = [
  { plateId: 10103, chartIds: [
    "cao-coast:GPlates-518d0234-75b2-4513-b197-5ce75635be8a:1980:0",
    "cao-coast:GPlates-518d0234-75b2-4513-b197-5ce75635be8a:397:0",
  ], referenceDirection: [-0.04927993807260704, -0.7327061040275049, 0.6787586116023834],
  expectedDirection: [0.5054580270836808, -0.5008451751009404, 0.7026139006842824] },
  { plateId: 10104, chartIds: [
    "cao-coast:GPlates-1ef97d95-3313-4151-bd31-2923b19bc454:391:0",
  ], referenceDirection: [0.056740946907283, -0.7041930892056413, 0.7077376336320407],
  expectedDirection: [0.5745530350614346, -0.4108916958506479, 0.7078536742736268] },
  { plateId: 20101, chartIds: [
    "cao-coast:GPlates-625dff9b-cc71-4917-8d5a-28dc95b5598f:540:0",
  ], referenceDirection: [0.555021997704296, -0.8118348116508087, -0.18131414907896246],
  expectedDirection: [0.9140057205453659, -0.3484900800870446, -0.2077214646859642] },
] as const;

function angularDistance(left: readonly number[], right: readonly number[]) {
  return 2 * Math.asin(Math.min(1, Math.hypot(
    left[0]! - right[0]!, left[1]! - right[1]!, left[2]! - right[2]!,
  ) / 2));
}

function dot3(left: readonly number[], right: readonly number[]) {
  return left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
}

function segmentRadius(left: readonly number[], right: readonly number[]) {
  const delta = right.map((value, axis) => value - left[axis]!);
  const denominator = dot3(delta, delta);
  const fraction = denominator <= 1e-30 ? 0
    : Math.max(0, Math.min(1, -dot3(left, delta) / denominator));
  return Math.hypot(...left.map((value, axis) => value + fraction * delta[axis]!));
}

function triangleMinimumRadius(left: readonly number[], middle: readonly number[], right: readonly number[]) {
  const edgeA = middle.map((value, axis) => value - left[axis]!);
  const edgeB = right.map((value, axis) => value - left[axis]!);
  const normal = [
    edgeA[1]! * edgeB[2]! - edgeA[2]! * edgeB[1]!,
    edgeA[2]! * edgeB[0]! - edgeA[0]! * edgeB[2]!,
    edgeA[0]! * edgeB[1]! - edgeA[1]! * edgeB[0]!,
  ];
  const denominator = dot3(normal, normal);
  if (denominator > 1e-30) {
    const scale = dot3(left, normal) / denominator;
    const projected = normal.map((value) => value * scale);
    const fromLeft = projected.map((value, axis) => value - left[axis]!);
    const d00 = dot3(edgeA, edgeA);
    const d01 = dot3(edgeA, edgeB);
    const d11 = dot3(edgeB, edgeB);
    const d20 = dot3(fromLeft, edgeA);
    const d21 = dot3(fromLeft, edgeB);
    const barycentricDenominator = d00 * d11 - d01 * d01;
    if (Math.abs(barycentricDenominator) > 1e-30) {
      const v = (d11 * d20 - d01 * d21) / barycentricDenominator;
      const w = (d00 * d21 - d01 * d20) / barycentricDenominator;
      if (v >= 0 && w >= 0 && v + w <= 1) return Math.hypot(...projected);
    }
  }
  return Math.min(segmentRadius(left, middle), segmentRadius(middle, right), segmentRadius(right, left));
}

function requireCorrectionMeshClearance(directions: Float32Array, indices: Uint32Array) {
  const shellRadius = 1 + CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES / EARTH_RADIUS_METRES;
  let maximumEdgeRadians = 0;
  let minimumDisplayedRadius = Infinity;
  const direction = (index: number): readonly [number, number, number] => [
    directions[index * 3]!, directions[index * 3 + 1]!, directions[index * 3 + 2]!,
  ];
  for (let offset = 0; offset < indices.length; offset += 3) {
    const triangle = [direction(indices[offset]!), direction(indices[offset + 1]!),
      direction(indices[offset + 2]!)] as const;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      maximumEdgeRadians = Math.max(maximumEdgeRadians,
        angularDistance(triangle[vertex], triangle[(vertex + 1) % 3]!));
    }
    minimumDisplayedRadius = Math.min(minimumDisplayedRadius,
      triangleMinimumRadius(...triangle) * shellRadius);
  }
  if (maximumEdgeRadians > Math.PI / 180 + 1e-6 || minimumDisplayedRadius <= 1) {
    throw new Error(`correction mesh intersects opaque globe: edge=${maximumEdgeRadians}, radius=${minimumDisplayedRadius}`);
  }
  return { maximumEdgeRadians, minimumDisplayedRadius };
}

function lonLatDirection(longitude: number, latitude: number): readonly [number, number, number] {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

const svalbardPoseWitnesses = [
  { plateId: 309, reference: [12.317164432918267, 79.50653000377272], expected: {
    411: [-54.9431523509521, -0.25048431517814845],
    430.001: [-74.92685815251443, 9.566194931561425],
    540: [-119.94148123461153, -4.840223872039822],
  } },
  { plateId: 311, reference: [16.52842705430847, 79.90365716013103], expected: {
    411: [-53.8194822166531, 0.18587903902341085],
    430.001: [-73.71563217080393, 9.401562456154407],
    540: [-118.45231215948547, -12.954768457584208],
  } },
] as const;

const westernPoseWitness = {
  reference: [-114.28510918099684, 45.031105090746095],
  expected: {
    411: [-93.18622277266597, -16.250314518776648],
    430.001: [-116.82597922076353, 6.329126137356438],
    540: [-158.89894697668254, 10.503034585311873],
  },
} as const;

function assertWitnessChartCoverage(
  charts: readonly { chartId: string }[],
  witnesses: readonly { plateId: number; chartIds: readonly string[] }[],
) {
  for (const witness of witnesses) {
    if (!charts.some((chart) => witness.chartIds.includes(chart.chartId))) {
      throw new Error(`complete rotation witness chart missing for plate ${witness.plateId}`);
    }
  }
}

const root = resolve("public/data/reconstruction/cao-v2.4");
const fetcher: StaticAssetFetcher = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = await readFile(resolve(root, url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe("native Cao package v2", () => {
  it("activates derived material strictly beyond native and qualified evidence boundaries", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const catalog = JSON.parse(await readFile(resolve(root, manifest.materialCorrections!.catalog.url), "utf8")) as
      MaterialCorrectionCatalogV1;
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    for (const ageMa of [0, 0.001, 1, 50, 100, 165, 410, 410 + 1e-7, 410 + 1e-6,
      430, 430 + 1e-7, 540] as const) {
      const revision = await runtime.request(ageMa).prepared;
      const active = (phase: "source-qualified-material" | "uncertain-continuation" | "formation-uncertain") =>
        catalog.charts.filter((chart) => chart.evidence.correction?.phase === phase
          && evaluateLifecycleSupport(chart.lifecycle, ageMa) === null).length;
      expect(revision.materialCorrections).toMatchObject({
        qualifiedActiveCharts: active("source-qualified-material"),
        uncertainActiveCharts: active("uncertain-continuation"),
        formationUncertainActiveCharts: active("formation-uncertain"),
        overriddenNativeCharts: ageMa <= 410 ? 2 : 0,
      });
      revision.release();
    }
    const at411 = await runtime.request(411).prepared;
    for (const witness of catalog.alignmentWitnesses) {
      const chartIndex = at411.charts.findIndex((chart) => chart.chartId === witness.chartId);
      expect(chartIndex).toBeGreaterThanOrEqual(0);
      expect(witness.normalizationAngularDegrees).toBeGreaterThan(60);
      const pose = at411.resolveAddress(at411.addressForChartDirection(
        chartIndex, witness.normalizedDirectionAtZero,
      ));
      expect(pose.support.kind).toBe("supported");
      expect(angularDistance(pose.direction!, witness.expectedDirectionAt411Ma)).toBeLessThan(2e-6);
    }
    at411.release();
    for (const ageMa of [411, 430.001, 540] as const) {
      const revision = await runtime.request(ageMa).prepared;
      const phase = ageMa <= 430 ? "qualified" : "uncertain";
      for (const witness of svalbardPoseWitnesses) {
        const chartIndex = revision.charts.findIndex((chart) => chart.chartId ===
          `correction:earthhistory-regional-svalbard-material-v1:svalbard-pre-540-material-plate-${witness.plateId}:${phase}`);
        expect(chartIndex).toBeGreaterThanOrEqual(0);
        const reference = lonLatDirection(witness.reference[0], witness.reference[1]);
        const pose = revision.resolveAddress(revision.addressForChartDirection(chartIndex, reference));
        expect(pose.support.kind).toBe("supported");
        const expected = witness.expected[ageMa];
        expect(angularDistance(pose.direction!, lonLatDirection(expected[0], expected[1])))
          .toBeLessThan(1e-5);
      }
      const westernChart = revision.charts.findIndex((chart) => chart.chartId ===
        "correction:earthhistory-regional-western-laurentia-material-v1:western-laurentia-qualified-material-plate-154:qualified");
      expect(westernChart).toBeGreaterThanOrEqual(0);
      const westernReference = lonLatDirection(westernPoseWitness.reference[0], westernPoseWitness.reference[1]);
      const westernPose = revision.resolveAddress(revision.addressForChartDirection(westernChart, westernReference));
      const westernExpected = westernPoseWitness.expected[ageMa];
      expect(westernPose.support.kind).toBe("supported");
      expect(angularDistance(westernPose.direction!, lonLatDirection(westernExpected[0], westernExpected[1])))
        .toBeLessThan(1e-5);
      revision.release();
    }
    runtime.dispose();
  });

  it("prepares the verified public package with shared motion rows and stable geometry", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const prepared = await runtime.request(227.5).prepared;
    expect(prepared.display).toEqual({ youngerAgeMa: 225, olderAgeMa: 230, fraction: 0.5 });
    expect(prepared.motionPalette.entryCount).toBeGreaterThan(3_500);
    expect(prepared.motionPalette.createValuesCopy()).toHaveLength(prepared.motionPalette.entryCount * 11);
    expect(prepared.batches).toHaveLength(3);
    // Complete authored rotation collection recovers the previously omitted
    // North American and Amazonian source geometry.
    expect(prepared.batches[0]!.vertexCount).toBe(149_492);
    const geometry = prepared.batches[0]!.createStaticGeometryCopy();
    expect(geometry.referenceDirections).toHaveLength(prepared.batches[0]!.vertexCount * 3);
    expect(Object.values(geometry).reduce((sum, array) => sum + array.byteLength, 0))
      .toBe(prepared.batches[0]!.staticGeometryBytes);
    const resource = createCaoFoundationGeometryResource(prepared, {
    // One-degree conforming correction tessellation keeps the 400 m land shell
    // above the ocean and measures 188,574 vertices / 245,164 primitives.
    maxBatches: 4, maxVertices: 190_000, maxTriangles: 246_000,
      maxRetainedSourceBytes: 32_000_000, maxTextureSize: 4_096, maxPublicationBytes: 10_000_000,
      maxSpatialIndexBytes: 1024 * 1024,
    });
    expect(resource.batches[0]!.vertexCount).toBe(prepared.batches[0]!.vertexCount);
    resource.dispose();
    expect(prepared.batches[0]!.createDisplayControlsCopy().displayHeightStart).toEqual({ kind: "uniform", value: 0 });
    expect(prepared.charts.some((chart) => chart.support.kind === "supported")).toBe(true);
    expect(prepared.lineBatches).toHaveLength(1);
    expect(prepared.anchorIds).toContain("chicxulub");
    expect(prepared.materialCorrectionIdentity).toMatch(/^earthhistory-cao-v2\.4-material-corrections-v1@/);
    expect(prepared.materialCorrections.correctionIds).toEqual([
      "earthhistory-regional-barents-material-v1",
      "earthhistory-regional-canada-franklinian-material-v1",
      "earthhistory-regional-pearya-pericratonic-scenario-v1",
      "earthhistory-regional-svalbard-material-v1",
      "earthhistory-regional-western-laurentia-material-v1",
      "earthhistory-regional-western-source450-native-v1",
      "earthhistory-regional-western-source490-native-v1",
    ]);
    expect(prepared.nativeBoundary).toMatchObject({ kind: "unavailable", reason: "fractional-topology-unqualified" });
    const address = prepared.addressForChartDirection(0, [1, 0, 0]);
    const pose = prepared.resolveAddress(address);
    expect(pose.support.kind).toBe("supported");
    expect(Math.hypot(...pose.direction!)).toBeCloseTo(1, 6);
    expect(prepared.resolveAddress({ ...address, chartRevision: "mutated" }).support).toEqual({
      kind: "unsupported", reason: "invalid-address",
    });
    prepared.release();
    expect(() => prepared.motionPalette.createValuesCopy()).toThrow(/released/);
    expect(() => prepared.resolveAddress(address)).toThrow(/released/);
    expect(() => prepared.resolveAnchor("chicxulub")).toThrow(/released/);
    expect(() => runtime.request(541)).toThrow(/domain/);
    runtime.dispose();
  });

  it("rejects a correction binary whose vertex names a nonexistent material chart", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const core = JSON.parse(await readFile(resolve(root, manifest.core.url), "utf8")) as { charts: unknown[] };
    const catalog = JSON.parse(await readFile(resolve(root, manifest.materialCorrections!.catalog.url), "utf8")) as
      MaterialCorrectionCatalogV1;
    const batch = catalog.spatialBatches[0]!;
    const bytes = await readFile(resolve(root, batch.geometryAsset.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    new DataView(buffer).setUint32(32 + batch.vertexCount * 16,
      core.charts.length + catalog.charts.length, true);
    expect(() => decodeCaoSpatialBatch(buffer, batch.vertexCount, batch.triangleCount,
      core.charts.length + catalog.charts.length)).toThrow(/spatial vertex/);
  });

  it("keeps every correction triangle above the opaque globe after float32 encoding", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const core = JSON.parse(await readFile(resolve(root, manifest.core.url), "utf8")) as { charts: unknown[] };
    const catalog = JSON.parse(await readFile(resolve(root, manifest.materialCorrections!.catalog.url), "utf8")) as
      MaterialCorrectionCatalogV1;
    for (const batch of catalog.spatialBatches) {
      const bytes = await readFile(resolve(root, batch.geometryAsset.url));
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const decoded = decodeCaoSpatialBatch(buffer, batch.vertexCount, batch.triangleCount,
        core.charts.length + catalog.charts.length);
      const clearance = requireCorrectionMeshClearance(decoded.referenceDirections, decoded.indices);
      expect(clearance.maximumEdgeRadians * 180 / Math.PI).toBeLessThanOrEqual(1.000001);
      expect(clearance.minimumDisplayedRadius).toBeGreaterThan(1);

      const mutated = new Float32Array(decoded.referenceDirections);
      for (const vertex of decoded.indices.slice(0, 3)) {
        for (let axis = 0; axis < 3; axis += 1) mutated[vertex * 3 + axis]! *= 0.999;
      }
      expect(() => requireCorrectionMeshClearance(mutated, decoded.indices)).toThrow(/intersects opaque globe/);
    }
  });

  it("rejects a hash-consistent correction batch that binds to a native Cao chart", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const catalog = JSON.parse(await readFile(resolve(root, manifest.materialCorrections!.catalog.url), "utf8")) as
      MaterialCorrectionCatalogV1;
    const batch = catalog.spatialBatches[0]!;
    const bytes = await readFile(resolve(root, batch.geometryAsset.url));
    const mutatedGeometry = new Uint8Array(bytes);
    const geometryView = new DataView(mutatedGeometry.buffer,
      mutatedGeometry.byteOffset, mutatedGeometry.byteLength);
    for (let vertex = 0; vertex < batch.vertexCount; vertex += 1) {
      geometryView.setUint32(32 + batch.vertexCount * 16 + vertex * 4, 0, true);
    }
    const geometrySha = createHash("sha256").update(mutatedGeometry).digest("hex");
    const mutatedCatalog = { ...catalog, spatialBatches: [{ ...batch,
      geometryAsset: { ...batch.geometryAsset, sha256: geometrySha },
    }, ...catalog.spatialBatches.slice(1)] };
    const catalogBytes = new TextEncoder().encode(JSON.stringify(mutatedCatalog));
    const mutatedManifest = { ...manifest, materialCorrections: { ...manifest.materialCorrections!,
      catalog: { ...manifest.materialCorrections!.catalog, bytes: catalogBytes.byteLength,
        sha256: createHash("sha256").update(catalogBytes).digest("hex") },
    } };
    const mutatedFetcher: StaticAssetFetcher = async (url, signal) => {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (url === manifest.materialCorrections!.catalog.url) return catalogBytes.buffer;
      if (url === batch.geometryAsset.url) return mutatedGeometry.buffer.slice(
        mutatedGeometry.byteOffset, mutatedGeometry.byteOffset + mutatedGeometry.byteLength,
      );
      return fetcher(url, signal);
    };
    const runtime = new CaoReconstructionRuntime(mutatedManifest, mutatedFetcher);
    await expect(runtime.request(411).prepared).rejects.toThrow(/cannot bind vertices to native Cao charts/);
    runtime.dispose();
  });

  it("changes the prepared identity when the additive correction catalog revision changes", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const rawCatalog = JSON.parse(await readFile(
      resolve(root, manifest.materialCorrections!.catalog.url), "utf8",
    )) as MaterialCorrectionCatalogV1;
    const baseRuntime = new CaoReconstructionRuntime(manifest, fetcher);
    const base = await baseRuntime.request(411).prepared;
    const alternateId = `${rawCatalog.id}-identity-witness`;
    const alternateCatalog = { ...rawCatalog, id: alternateId, version: "identity-witness" };
    const catalogBytes = new TextEncoder().encode(JSON.stringify(alternateCatalog));
    const alternateManifest = { ...manifest, materialCorrections: { id: alternateId,
      catalog: { ...manifest.materialCorrections!.catalog, bytes: catalogBytes.byteLength,
        sha256: createHash("sha256").update(catalogBytes).digest("hex") },
    } };
    const alternateFetcher: StaticAssetFetcher = (url, signal) =>
      url === manifest.materialCorrections!.catalog.url ? Promise.resolve(catalogBytes.buffer) : fetcher(url, signal);
    const alternateRuntime = new CaoReconstructionRuntime(alternateManifest, alternateFetcher);
    const alternate = await alternateRuntime.request(411).prepared;
    expect(alternate.materialCorrectionIdentity).not.toBe(base.materialCorrectionIdentity);
    expect(alternate.packageRevision).not.toBe(base.packageRevision);
    expect(alternate.identity).not.toBe(base.identity);
    base.release();
    alternate.release();
    baseRuntime.dispose();
    alternateRuntime.dispose();
  });

  it("uses one authored checkpoint for an exact request", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const requestedUrls: string[] = [];
    const recordingFetcher: StaticAssetFetcher = async (url, signal) => {
      requestedUrls.push(url);
      return fetcher(url, signal);
    };
    const runtime = new CaoReconstructionRuntime(manifest, recordingFetcher);
    const prepared = await runtime.request(450).prepared;
    expect(prepared.display).toEqual({ youngerAgeMa: 450, olderAgeMa: 450, fraction: 0 });
    expect(prepared.nativeBoundary).toMatchObject({ kind: "exact-source", sourceAgeMa: 450 });
    expect(prepared.topologyOwnership).toMatchObject({ kind: "exact-source", sourceAgeMa: 450 });
    expect(requestedUrls.filter((url) => url.includes("checkpoint-450"))).toHaveLength(1);
    expect(requestedUrls.some((url) => url.includes("checkpoint-0"))).toBe(false);
    prepared.release();
    const modern = await runtime.request(0).prepared;
    const andes = modern.resolveAnchor("andes-volcanic-margin");
    expect(andes?.pose.support.kind).toBe("supported");
    expect(Math.hypot(...andes!.pose.direction!)).toBeCloseTo(1, 6);
    expect(modern.resolveAnchor("cairo")).toBeNull();
    modern.release();
    const devonian = await runtime.request(385).prepared;
    expect(devonian.resolveAnchor("cairo-fossil-forest")?.pose.support.kind).toBe("supported");
    expect(devonian.charts.some((chart) => chart.role === "country-reference"
      && chart.support.kind === "supported")).toBe(true);
    devonian.release();
    runtime.dispose();
  });

  it("retains the complete authored rotation collection for present-day craton witnesses", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    expect(manifest.frame.rotationSha256)
      .toBe("80736cef2b1c48e61242eb85838e3da859526c4f75bcb001e08076902e21224f");
    const core = JSON.parse(await readFile(resolve(root, manifest.core.url), "utf8")) as {
      charts: Array<{ chartId: string; motionBindings: Array<{ entryId: string }> }>;
    };
    const palette = JSON.parse(await readFile(resolve(root, manifest.motionPalette.catalog.url), "utf8")) as {
      entries: Array<{ entryId: string; plateId: number }>;
    };
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const modern = await runtime.request(0).prepared;
    assertWitnessChartCoverage(modern.charts, completeRotationWitnesses);
    const addresses = completeRotationWitnesses.map((witness) => {
      const chartIndex = modern.charts.findIndex((chart) => witness.chartIds.includes(chart.chartId as never));
      if (chartIndex < 0) throw new Error(`complete rotation witness chart missing for plate ${witness.plateId}`);
      expect(modern.charts[chartIndex]!.support.kind).toBe("supported");
      expect(modern.batches.some((batch) => batch.chartTriangleRanges.some(
        (range) => range.chartIndex === chartIndex && range.triangleCount > 0,
      ))).toBe(true);
      const sourceChart = core.charts.find((chart) => chart.chartId === modern.charts[chartIndex]!.chartId)!;
      expect(sourceChart).toBeDefined();
      expect(sourceChart.motionBindings.some((binding) =>
        palette.entries.some((entry) => entry.entryId === binding.entryId && entry.plateId === witness.plateId),
      )).toBe(true);
      return modern.addressForChartDirection(chartIndex, witness.referenceDirection);
    });
    modern.release();

    const past = await runtime.request(100).prepared;
    completeRotationWitnesses.forEach((witness, index) => {
      const pose = past.resolveAddress(addresses[index]!);
      expect(pose.support.kind).toBe("supported");
      expect(angularDistance(pose.direction!, witness.expectedDirection)).toBeLessThanOrEqual(1e-6);
    });
    past.release();
    runtime.dispose();

    // R1: omission of one source witness must make the support check fail.
    const omittedChartIds = new Set<string>(completeRotationWitnesses[0].chartIds);
    expect(() => assertWitnessChartCoverage(
      core.charts.filter((chart) => !omittedChartIds.has(chart.chartId)),
      completeRotationWitnesses,
    )).toThrow(/witness chart missing for plate 10103/);
  });
});
