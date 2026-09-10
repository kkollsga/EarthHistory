import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime } from "./engineV2";
import { packageAssetPath, type StaticAssetFetcher } from "./assetLoader";
import type { ReconstructionPackageManifestV2 } from "./packageV2";
import { createCaoFoundationGeometryResource } from "../render/reconstruction/caoFoundation";

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
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe("native Cao package v2", () => {
  it("prepares the verified public package with shared motion rows and stable geometry", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const prepared = await runtime.request(227.5).prepared;
    expect(prepared.display).toEqual({ youngerAgeMa: 225, olderAgeMa: 230, fraction: 0.5 });
    expect(prepared.motionPalette.entryCount).toBeGreaterThan(3_200);
    expect(prepared.motionPalette.createValuesCopy()).toHaveLength(prepared.motionPalette.entryCount * 11);
    expect(prepared.batches).toHaveLength(2);
    // Complete authored rotation collection recovers the previously omitted
    // North American and Amazonian source geometry.
    expect(prepared.batches.map((batch) => batch.batchId)).toEqual(["batch-shelf", "batch-land"]);
    expect(prepared.batches[0]!.vertexCount).toBe(153_904);
    expect(prepared.batches[1]!.vertexCount).toBe(149_492);
    for (const batch of prepared.batches) {
      const geometry = batch.createStaticGeometryCopy();
      expect(geometry.referenceDirections).toHaveLength(batch.vertexCount * 3);
      expect(Object.values(geometry).reduce((sum, array) => sum + array.byteLength, 0))
        .toBe(batch.staticGeometryBytes);
    }
    const resource = createCaoFoundationGeometryResource(prepared, {
      // Shelf + land meshes plus 20,036 country-line vertices.
      maxBatches: 4, maxVertices: 400_000, maxTriangles: 600_000,
      maxRetainedSourceBytes: 48_000_000, maxTextureSize: 4_096, maxPublicationBytes: 10_000_000,
      maxSpatialIndexBytes: 1024 * 1024,
    });
    expect(resource.batches.map((batch) => batch.vertexCount))
      .toEqual(prepared.batches.map((batch) => batch.vertexCount));
    resource.dispose();
    expect(prepared.batches[0]!.createDisplayControlsCopy().displayHeightStart).toEqual({ kind: "uniform", value: 0 });
    expect(prepared.charts.some((chart) => chart.support.kind === "supported")).toBe(true);
    expect(prepared.lineBatches).toHaveLength(1);
    expect(prepared.anchorIds).toContain("chicxulub");
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
    expect(() => runtime.request(1801)).toThrow(/domain/);
    runtime.dispose();
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
