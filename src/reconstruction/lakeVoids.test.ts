import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime, chartPickStateFromMotionFrame, packageAssetPath,
  LAKE_VOID_INFILL_SOURCE_TYPE, type MaterialCorrectionCatalogV1,
  type ReconstructionCoreV2, type ReconstructionPackageManifestV2, type StaticAssetFetcher,
  validateMaterialCorrectionCatalogV1 } from "./index";
import { createCaoFoundationGeometryResource, caoFoundationSurfaceCoversDirection,
  intersectCaoFoundationSurface } from "../render/reconstruction/caoFoundation";
import { expandInternedPackageDocument } from "./packageIntern";

/**
 * The Cao v2.4 coast layer leaves the large modern lakes as voids inside the
 * continental-outline underlay, so without the lake-void infill the runtime
 * classified Lake Victoria as marine shelf at 450 Ma. The infill fills each
 * void with the land appearance strictly older than the lake's cited (or
 * present-only) onset and leaves the present day untouched.
 */

const root = resolve("public/data/reconstruction/cao-v2.4");
/** Package JSON is read raw here, so the interning decoder runs explicitly. */
const readJson = async (url: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(root, url), "utf8")) as unknown;
const fetcher: StaticAssetFetcher = async (url) => {
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const gplatesDirection = (lon: number, lat: number): [number, number, number] => {
  const a = lon * Math.PI / 180;
  const b = lat * Math.PI / 180;
  const c = Math.cos(b);
  return [c * Math.cos(a), c * Math.sin(a), Math.sin(b)];
};
const toRenderer = (d: readonly [number, number, number]): [number, number, number] => [d[0], d[2], -d[1]];
// Production renderer reservation (GlobeScene) so the probe fails where the app would.
const limits = { maxBatches: 512, maxVertices: 520_000, maxTriangles: 660_000,
  maxRetainedSourceBytes: 48 * 1024 * 1024, maxTextureSize: 2_048,
  maxPublicationBytes: 2 * 1024 * 1024, maxSpatialIndexBytes: 1024 * 1024 };

/** Present-day lake centres with the cited onset each infill starts at. */
const LAKES: Record<string, { lon: number; lat: number; onsetMa: number }> = {
  victoria: { lon: 33, lat: -1, onsetMa: 0.4 },
  tanganyika: { lon: 29.7, lat: -6, onsetMa: 10.5 },
  malawi: { lon: 34.5, lat: -12, onsetMa: 8.6 },
  turkana: { lon: 36.1, lat: 3.5, onsetMa: 4.1 },
  albert: { lon: 30.9, lat: 1.7, onsetMa: 8 },
  superior: { lon: -87.5, lat: 47.7, onsetMa: 0.0118 },
  baikal: { lon: 108, lat: 53.5, onsetMa: 30 },
  mweru: { lon: 28.7, lat: -9, onsetMa: 0 },
};

describe("lake-void infill", () => {
  it("fills every witness lake with land strictly older than its onset and never at present", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const present = await runtime.request(0).prepared;
    const resource = createCaoFoundationGeometryResource(present, limits);
    const frame0 = await runtime.evaluateMotion(0);
    const pick0 = chartPickStateFromMotionFrame(frame0);
    // Pick the chart under each lake at present so the probe follows the lake's
    // own plate to every older age instead of testing a fixed present-day point.
    const carriers = Object.fromEntries(Object.entries(LAKES).map(([name, lake]) => {
      const d = toRenderer(gplatesDirection(lake.lon, lake.lat));
      const hit = intersectCaoFoundationSurface(resource,
        { chartPoses: pick0.chartPoses, chartActive: pick0.chartActive },
        [d[0] * 3, d[1] * 3, d[2] * 3], [-d[0], -d[1], -d[2]]);
      expect(hit, `${name} has a chart at present`).not.toBeNull();
      expect(hit!.batchId, `${name} is water (shelf class) at present`).toBe("batch-shelf");
      return [name, hit!.chartIndex];
    }));
    const classify = async (name: string, ageMa: number) => {
      const lake = LAKES[name]!;
      const revision = ageMa === 0 ? present : await runtime.request(ageMa).prepared;
      const frame = ageMa === 0 ? frame0 : await runtime.evaluateMotion(ageMa);
      const pick = ageMa === 0 ? pick0 : chartPickStateFromMotionFrame(frame);
      const pose = revision.resolveAddress(revision.addressForChartDirection(
        carriers[name]!, gplatesDirection(lake.lon, lake.lat)));
      expect(pose.support.kind, `${name} carrier pose at ${ageMa} Ma`).toBe("supported");
      const state = { chartPoses: pick.chartPoses, chartActive: pick.chartActive };
      const land = caoFoundationSurfaceCoversDirection(resource, state, toRenderer(pose.direction!),
        { includeShelf: false });
      const any = caoFoundationSurfaceCoversDirection(resource, state, toRenderer(pose.direction!));
      if (ageMa !== 0) revision.release();
      return land ? "land" : any ? "shelf" : "ocean";
    };
    for (const [name, lake] of Object.entries(LAKES)) {
      expect(await classify(name, 0), `${name} at 0 Ma`).toBe("shelf");
      if (lake.onsetMa > 0) {
        // Inside the lake's lifetime the void stays water.
        expect(await classify(name, lake.onsetMa * 0.5), `${name} inside its lifetime`).toBe("shelf");
        expect(await classify(name, lake.onsetMa), `${name} exactly at onset`).toBe("shelf");
      }
      // Strictly older than onset the void is land.
      expect(await classify(name, lake.onsetMa + 0.000001), `${name} just older than onset`).toBe("land");
      expect(await classify(name, 74), `${name} at 74 Ma`).toBe("land");
      expect(await classify(name, 300), `${name} at 300 Ma`).toBe("land");
    }
    present.release();
    resource.dispose();
    runtime.dispose();
  }, 120_000);

  it("rejects a lake infill that is active at present or outlives the package", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const catalog = expandInternedPackageDocument(await readJson(manifest.materialCorrections!.catalog.url)) as
      MaterialCorrectionCatalogV1;
    const core = expandInternedPackageDocument(await readJson(manifest.core.url)) as ReconstructionCoreV2;
    const lakeCharts = catalog.charts.filter((chart) => chart.sourceFeatureTypes[0] === LAKE_VOID_INFILL_SOURCE_TYPE);
    expect(lakeCharts.length).toBe(101);
    expect(lakeCharts.every((chart) => chart.lifecycle.youngestExclusive === true
      && chart.evidence.correction?.lakeOnsetMa === chart.lifecycle.validTimeMa.youngest
      && chart.lifecycle.validTimeMa.oldest <= 1800)).toBe(true);
    expect(lakeCharts.some((chart) => chart.lifecycle.validTimeMa.oldest > 540)).toBe(true);
    expect(() => validateMaterialCorrectionCatalogV1(catalog, manifest, core)).not.toThrow();
    const mutate = (change: (chart: MaterialCorrectionCatalogV1["charts"][number]) => object) => ({
      ...catalog,
      charts: catalog.charts.map((chart) => chart === lakeCharts[0] ? { ...chart, ...change(chart) } : chart),
    }) as MaterialCorrectionCatalogV1;
    // Active at exactly 0 Ma: the present-day lake would be drawn as land.
    expect(() => validateMaterialCorrectionCatalogV1(mutate((chart) => ({
      lifecycle: { validTimeMa: chart.lifecycle.validTimeMa } })), manifest, core)).toThrow(/derived material/);
    // Older than the package domain.
    expect(() => validateMaterialCorrectionCatalogV1(mutate((chart) => ({
      lifecycle: { ...chart.lifecycle, validTimeMa: { ...chart.lifecycle.validTimeMa, oldest: 1801 } } })),
    manifest, core)).toThrow(/derived material/);
    // Onset and lifecycle disagree.
    expect(() => validateMaterialCorrectionCatalogV1(mutate((chart) => ({
      evidence: { ...chart.evidence, correction: { ...chart.evidence.correction!, lakeOnsetMa: 9 } } })),
    manifest, core)).toThrow(/derived material/);
    // Only the lake family may exceed 540 Ma.
    expect(() => validateMaterialCorrectionCatalogV1(mutate(() => ({
      sourceFeatureTypes: ["EarthHistorySourceQualifiedMaterialCorrection"] })), manifest, core)).toThrow(/derived material/);
  });
});
