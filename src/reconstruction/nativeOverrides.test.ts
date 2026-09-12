import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { StaticAssetFetcher } from "./assetLoader";
import { CaoReconstructionRuntime } from "./engineV2";
import { loadVerifiedCaoFoundation } from "./loaderV2";
import {
  validateMaterialCorrectionCatalogV1,
  type MaterialCorrectionCatalogV1,
  type ReconstructionAnchorCatalogV2,
  type ReconstructionCoreV2,
  type ReconstructionPackageManifestV2,
} from "./packageV2";

const packageRoot = resolve("public/data/reconstruction/cao-v2.4");

const diskFetcher: StaticAssetFetcher = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = await readFile(resolve(packageRoot, url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function lonLatDirection(longitude: number, latitude: number): readonly [number, number, number] {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

async function publicPackage() {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "manifest.json"), "utf8")) as
    ReconstructionPackageManifestV2;
  const core = JSON.parse(await readFile(resolve(packageRoot, manifest.core.url), "utf8")) as
    ReconstructionCoreV2;
  const correctionDescriptor = manifest.materialCorrections;
  if (!correctionDescriptor) throw new Error("public package lacks material corrections");
  const catalog = JSON.parse(await readFile(
    resolve(packageRoot, correctionDescriptor.catalog.url), "utf8",
  )) as MaterialCorrectionCatalogV1;
  return { manifest, core, catalog };
}

describe("native material chart override consumers", () => {
  it("suppresses each exact native chart and remaps its country reference with the same motion", async () => {
    const { manifest, catalog } = await publicPackage();
    const overrides = catalog.nativeChartOverrides ?? [];
    expect(overrides).toHaveLength(2);

    const foundation = await loadVerifiedCaoFoundation(manifest, diskFetcher);
    const lineBatchEntry = [...foundation.lineBatches.entries()].find(
      ([, candidate]) => candidate.vertexChartIndices.length > 0,
    );
    expect(lineBatchEntry).toBeDefined();
    const [lineBatchId, lineBatch] = lineBatchEntry!;

    const contracts = overrides.map((override) => {
      const nativeIndex = foundation.core.charts.findIndex(
        (chart) => chart.chartId === override.nativeChart.chartId,
      );
      const sourceCountryIndices = override.dependentConsumers.sourceCountryChartIds.map((chartId) =>
        foundation.core.charts.findIndex((chart) => chart.chartId === chartId));
      const countrySegments = override.dependentConsumers.countrySegmentBindings.map((binding) => {
        const left = lineBatch.lineIndices[binding.segmentIndex * 2]!;
        const right = lineBatch.lineIndices[binding.segmentIndex * 2 + 1]!;
        expect(sourceCountryIndices).toContain(lineBatch.vertexChartIndices[left]);
        expect(lineBatch.vertexChartIndices[right]).toBe(lineBatch.vertexChartIndices[left]);
        return { binding, vertices: [left, right] as const };
      });
      expect(nativeIndex).toBeGreaterThanOrEqual(0);
      expect(sourceCountryIndices.every((chartIndex) => chartIndex >= 0)).toBe(true);
      expect(countrySegments).toHaveLength(override.dependentConsumers.expectedSourceSegmentCount);
      expect(countrySegments.length).toBeGreaterThan(0);
      return { override, nativeIndex, sourceCountryIndices, countrySegments };
    });

    const anchorChartIds = new Set(foundation.anchorCatalog?.anchors.map((anchor) => anchor.chartId) ?? []);
    contracts.forEach(({ override }) => expect(anchorChartIds.has(override.nativeChart.chartId)).toBe(false));

    const runtime = new CaoReconstructionRuntime(manifest, diskFetcher);
    let stableLineIdentity: string | null = null;
    let stablePreparedIndices: number[] | null = null;
    for (const ageMa of [0, 0.001, 1, 410]) {
      const revision = await runtime.request(ageMa).prepared;
      const preparedLine = revision.lineBatches.find((batch) => batch.batchId === lineBatchId);
      expect(preparedLine).toBeDefined();
      const copy = preparedLine!.createStaticGeometryCopy();
      stableLineIdentity ??= preparedLine!.staticGeometryIdentity;
      stablePreparedIndices ??= [...copy.preparedEntryIndices];
      expect(preparedLine!.staticGeometryIdentity).toBe(stableLineIdentity);
      expect([...copy.preparedEntryIndices]).toEqual(stablePreparedIndices);
      expect(revision.materialCorrections.overriddenNativeCharts).toBe(2);
      for (const { override, nativeIndex, sourceCountryIndices, countrySegments } of contracts) {
        expect(revision.charts[nativeIndex]!.support).toEqual({ kind: "inactive", reason: "replaced" });
        sourceCountryIndices.forEach((chartIndex) => expect(revision.charts[chartIndex]!.support)
          .toEqual({ kind: "inactive", reason: "replaced" }));
        expect(override.replacementChartIds.some((chartId) => {
          const chart = revision.charts.find((candidate) => candidate.chartId === chartId);
          return chart?.support.kind === "supported";
        })).toBe(true);
        countrySegments.forEach(({ binding, vertices }) => {
          const sourceIndex = lineBatch.vertexChartIndices[vertices[0]]!;
          const segmentIndex = copy.preparedEntryIndices[vertices[0]]!;
          expect(copy.preparedEntryIndices[vertices[1]]).toBe(segmentIndex);
          expect(copy.materialChartIndices[vertices[0]]).toBe(segmentIndex);
          expect(copy.materialChartIndices[vertices[1]]).toBe(segmentIndex);
          expect(revision.charts[segmentIndex]!.chartId).toBe(
            `country-segment:${override.overrideId}:${binding.batchId}:${binding.segmentIndex}`,
          );
          expect(revision.charts[segmentIndex]!.poseQuaternion)
            .toEqual(revision.charts[sourceIndex]!.poseQuaternion);
          if (ageMa <= 1) expect(revision.charts[segmentIndex]!.support.kind).toBe("supported");
        });
        if (ageMa === 410 && override.nativeTarget.sourceFeatureOrder === 450) {
          // Every one of these five source-450 segments is closest to the
          // Franciscan domain. At 410 Ma Franciscan is unborn, so the remap
          // must withhold the line instead of jumping to old, active Salinia.
          countrySegments.forEach(({ vertices }) => expect(
            revision.charts[copy.preparedEntryIndices[vertices[0]]!]!.support,
          ).toEqual({ kind: "inactive", reason: "replaced" }));
        }
        if (ageMa === 410 && override.nativeTarget.sourceFeatureOrder === 490) {
          const supportKinds = countrySegments.map(({ vertices }) =>
            revision.charts[copy.preparedEntryIndices[vertices[0]]!]!.support.kind);
          expect(supportKinds).toContain("supported");
          expect(supportKinds).toContain("inactive");
        }
      }
      revision.release();
    }

    const modern = await runtime.request(0).prepared;
    const modernLine = modern.lineBatches.find((batch) => batch.batchId === lineBatchId)!;
    expect(modernLine.staticGeometryIdentity).toBe(stableLineIdentity);
    expect([...modernLine.createStaticGeometryCopy().preparedEntryIndices]).toEqual(stablePreparedIndices);
    // Source-polygon interior witnesses: source-450 Mojave and source-490's
    // independently qualified old-basement union.
    const interiorBySourceOrder = new Map([
      [450, lonLatDirection(-118.95080265663344, 36.842403493263426)],
      [490, lonLatDirection(-116.1084804174418, 43.56843678684035)],
    ]);
    for (const { override, nativeIndex } of contracts) {
      const direction = interiorBySourceOrder.get(override.nativeTarget.sourceFeatureOrder);
      if (!direction) throw new Error("override lacks an independent interior witness");
      const nativeAddress = modern.addressForChartDirection(nativeIndex, direction);
      const resolved = modern.resolveAddress(nativeAddress);
      expect(resolved.support.kind).toBe("supported");
      expect(override.replacementChartIds).toContain(resolved.address.chartId);
      expect(resolved.address.localCoordinate).toEqual({ kind: "chart-direction",
        directionAtReference: direction });
      const replacementIndex = modern.charts.findIndex((chart) => chart.chartId === resolved.address.chartId);
      expect(replacementIndex).toBeGreaterThanOrEqual(0);
      expect(modern.charts[replacementIndex]!.poseQuaternion)
        .toEqual(modern.charts[nativeIndex]!.poseQuaternion);
    }
    modern.release();

    const older = await runtime.request(410.001).prepared;
    const olderLine = older.lineBatches.find((batch) => batch.batchId === lineBatchId)!
      .createStaticGeometryCopy();
    expect(older.materialCorrections.overriddenNativeCharts).toBe(0);
    for (const { nativeIndex, sourceCountryIndices, countrySegments } of contracts) {
      expect(older.charts[nativeIndex]!.support).toEqual({ kind: "inactive", reason: "unborn" });
      sourceCountryIndices.forEach((chartIndex) => expect(older.charts[chartIndex]!.support)
        .toEqual({ kind: "inactive", reason: "unborn" }));
      countrySegments.forEach(({ vertices }) => {
        const sourceIndex = lineBatch.vertexChartIndices[vertices[0]]!;
        const segmentIndex = olderLine.preparedEntryIndices[vertices[0]]!;
        expect(olderLine.preparedEntryIndices[vertices[1]]).toBe(segmentIndex);
        expect(olderLine.materialChartIndices[vertices[0]]).toBe(segmentIndex);
        expect(older.charts[segmentIndex]!.support).toEqual({ kind: "inactive", reason: "unborn" });
        expect(older.charts[segmentIndex]!.poseQuaternion)
          .toEqual(older.charts[sourceIndex]!.poseQuaternion);
      });
    }
    older.release();
    runtime.dispose();
  });

  it("rejects a foreign dependent-country chart and an anchor on an overridden native chart", async () => {
    const { manifest, core, catalog } = await publicPackage();
    const overrides = catalog.nativeChartOverrides ?? [];
    expect(overrides).toHaveLength(2);
    const foreignChartId = overrides[1]!.dependentConsumers.sourceCountryChartIds[0]!;
    const foreign: MaterialCorrectionCatalogV1 = { ...catalog, nativeChartOverrides: overrides.map(
      (override, index) => index === 0 ? { ...override,
        dependentConsumers: { ...override.dependentConsumers,
          sourceCountryChartIds: [foreignChartId] } } : override,
    ) };
    expect(() => validateMaterialCorrectionCatalogV1(foreign, manifest, core))
      .toThrow(/invalid native material chart override/);

    if (!core.anchorCatalog) throw new Error("public core lacks its anchor catalog");
    const anchorCatalog = JSON.parse(await readFile(
      resolve(packageRoot, core.anchorCatalog.url), "utf8",
    )) as ReconstructionAnchorCatalogV2;
    if (!anchorCatalog.anchors[0]) throw new Error("public anchor catalog is empty");
    const target = overrides[0]!.nativeChart;
    const mutatedAnchors: ReconstructionAnchorCatalogV2 = { ...anchorCatalog,
      anchors: anchorCatalog.anchors.map((anchor, index) => index === 0 ? {
        ...anchor, chartId: target.chartId, chartRevision: target.chartRevision,
        validTimeMa: { youngest: 0, oldest: 0 },
      } : anchor) };
    const anchorBytes = jsonBytes(mutatedAnchors);
    const mutatedCore: ReconstructionCoreV2 = { ...core, anchorCatalog: {
      ...core.anchorCatalog, bytes: anchorBytes.byteLength, sha256: sha256(anchorBytes),
    } };
    const coreBytes = jsonBytes(mutatedCore);
    const mutatedCatalog: MaterialCorrectionCatalogV1 = { ...catalog,
      baseline: { ...catalog.baseline, coreSha256: sha256(coreBytes) } };
    const catalogBytes = jsonBytes(mutatedCatalog);
    const materialCorrections = manifest.materialCorrections!;
    const anchorAsset = core.anchorCatalog;
    const mutatedManifest: ReconstructionPackageManifestV2 = { ...manifest,
      core: { ...manifest.core, bytes: coreBytes.byteLength, sha256: sha256(coreBytes) },
      materialCorrections: { ...materialCorrections, catalog: {
        ...materialCorrections.catalog, bytes: catalogBytes.byteLength,
        sha256: sha256(catalogBytes),
      } } };
    const altered = new Map<string, Uint8Array>([
      [mutatedManifest.core.url, coreBytes],
      [mutatedManifest.materialCorrections!.catalog.url, catalogBytes],
      [anchorAsset.url, anchorBytes],
    ]);
    const alteredFetcher: StaticAssetFetcher = async (url, signal) => {
      const bytes = altered.get(url);
      return bytes ? arrayBuffer(bytes) : diskFetcher(url, signal);
    };
    await expect(loadVerifiedCaoFoundation(mutatedManifest, alteredFetcher))
      .rejects.toThrow(/unmapped POI or focus anchor/);
  });

  it("keeps every native-partition pose replacement in the gray batch and uncertainty counter", async () => {
    const { manifest, catalog } = await publicPackage();
    const foundation = await loadVerifiedCaoFoundation(manifest, diskFetcher);
    const qualified = foundation.spatialBatches.get("material-correction-qualified");
    const uncertain = foundation.spatialBatches.get("material-correction-uncertain");
    expect(qualified).toBeDefined();
    expect(uncertain).toBeDefined();
    const qualifiedCharts = new Set(qualified!.vertexChartIndices);
    const uncertainCharts = new Set(uncertain!.vertexChartIndices);
    const replacementChart = new Set((catalog.nativeChartOverrides ?? [])
      .flatMap((override) => override.replacementChartIds));
    const inferredReplacementIndices = foundation.core.charts
      .map((chart, chartIndex) => replacementChart.has(chart.chartId)
        && ["model-inference", "native-target-only"].includes(chart.evidence.correction?.poseStatus ?? "")
        ? chartIndex : -1)
      .filter((chartIndex) => chartIndex >= 0);
    expect(inferredReplacementIndices.length).toBeGreaterThan(0);
    inferredReplacementIndices.forEach((chartIndex) => {
      expect(uncertainCharts.has(chartIndex)).toBe(true);
      expect(qualifiedCharts.has(chartIndex)).toBe(false);
    });

    const runtime = new CaoReconstructionRuntime(manifest, diskFetcher);
    for (const ageMa of [0, 100, 410, 540]) {
      const revision = await runtime.request(ageMa).prepared;
      const expected = revision.charts.filter((chart) => chart.support.kind === "supported"
        && chart.evidence.correction?.phase === "source-qualified-material"
        && ["model-inference", "native-target-only"].includes(
          chart.evidence.correction?.poseStatus ?? "",
        )).length;
      expect(revision.materialCorrections.modelInferredPoseActiveCharts).toBe(expected);
      if (ageMa === 100) {
        expect(revision.materialCorrections.formationUncertainActiveCharts).toBeGreaterThan(0);
        expect(revision.charts.filter((chart) => chart.support.kind === "supported"
          && ["model-inference", "native-target-only"]
            .includes(chart.evidence.correction?.poseStatus ?? "")).length).toBeGreaterThan(expected);
      }
      revision.release();
    }
    runtime.dispose();
  });
});
