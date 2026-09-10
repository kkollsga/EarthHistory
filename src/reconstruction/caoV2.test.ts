import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime } from "./engineV2";
import type { StaticAssetFetcher } from "./assetLoader";
import type { ReconstructionPackageManifestV2 } from "./packageV2";
import { createCaoFoundationGeometryResource } from "../render/reconstruction/caoFoundation";

const root = resolve("public/data/reconstruction/cao-v2.4");
const fetcher: StaticAssetFetcher = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = await readFile(resolve(root, url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

describe("native Cao package v2", () => {
  it("prepares the verified public package with shared motion rows and stable geometry", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as ReconstructionPackageManifestV2;
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const prepared = await runtime.request(227.5).prepared;
    expect(prepared.display).toEqual({ youngerAgeMa: 225, olderAgeMa: 230, fraction: 0.5 });
    expect(prepared.motionPalette.entryCount).toBeGreaterThan(3_500);
    expect(prepared.motionPalette.createValuesCopy()).toHaveLength(prepared.motionPalette.entryCount * 11);
    expect(prepared.batches).toHaveLength(1);
    expect(prepared.batches[0]!.vertexCount).toBe(139_152);
    const geometry = prepared.batches[0]!.createStaticGeometryCopy();
    expect(geometry.referenceDirections).toHaveLength(139_152 * 3);
    expect(Object.values(geometry).reduce((sum, array) => sum + array.byteLength, 0))
      .toBe(prepared.batches[0]!.staticGeometryBytes);
    const resource = createCaoFoundationGeometryResource(prepared, {
      maxBatches: 4, maxVertices: 160_000, maxTriangles: 250_000,
      maxRetainedSourceBytes: 32_000_000, maxTextureSize: 4_096, maxPublicationBytes: 10_000_000,
      maxSpatialIndexBytes: 1024 * 1024,
    });
    expect(resource.batches[0]!.vertexCount).toBe(139_152);
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
    expect(() => runtime.request(541)).toThrow(/domain/);
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
    runtime.dispose();
  });
});
