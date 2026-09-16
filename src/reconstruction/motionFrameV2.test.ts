import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime } from "./engineV2";
import { evaluateCaoMotionFrame, resolveCaoDisplayBracket, resolveChartMotionSegment,
  resolveChartMotionSupportGap } from "./motionFrameV2";
import { packageAssetPath, type StaticAssetFetcher } from "./assetLoader";
import { numberScalarOps, rotateDirection } from "./arithmetic";
import { validateReconstructionCoreV2, type ReconstructionCoreV2,
  type ReconstructionPackageManifestV2 } from "./packageV2";
import { loadVerifiedCaoFoundation } from "./loaderV2";
import type { MotionPaletteCatalog } from "./palette";
import { expandInternedPackageDocument } from "./packageIntern";

const root = resolve("public/data/reconstruction/cao-v2.4");
/** Package JSON is read raw here, so the interning decoder runs explicitly. */
const readJson = async (url: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(root, url), "utf8")) as unknown;
const fetcher: StaticAssetFetcher = async (url, signal) => {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

function lonLatDirection(longitude: number, latitude: number): readonly [number, number, number] {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

describe("continuous Cao motion frames", () => {
  it("resolves display brackets from the live package domain without inventing ages", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    expect(manifest.ageDomainMa).toEqual({ youngest: 0, oldest: 1800 });
    expect(resolveCaoDisplayBracket(manifest, 227.5)).toEqual({
      youngerAgeMa: 225, olderAgeMa: 230, fraction: 0.5, exactCheckpoint: false,
    });
    expect(resolveCaoDisplayBracket(manifest, 450)).toMatchObject({
      youngerAgeMa: 450, olderAgeMa: 450, fraction: 0, exactCheckpoint: true,
    });
    expect(resolveCaoDisplayBracket(manifest, 545)).toEqual({
      youngerAgeMa: 540, olderAgeMa: 550, fraction: 0.5, exactCheckpoint: false,
    });
    expect(() => resolveCaoDisplayBracket(manifest, 1801)).toThrow(/domain/);
  });

  it("rejects an unauthored motion interval instead of holding a nearest pose", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const core = expandInternedPackageDocument(await readJson(manifest.core.url)) as
      ReconstructionCoreV2;
    const palette = JSON.parse(await readFile(resolve(root, manifest.motionPalette.catalog.url), "utf8")) as
      MotionPaletteCatalog;
    const targetId = "cao-continent:GPlates-0052f837-d6b0-4dc7-ae46-caec29f6a518:851:0";
    const target = core.charts.find((chart) => chart.chartId === targetId)!;
    expect(target.motionBindings).toHaveLength(1);
    const malformedBindings = target.motionBindings!.map((binding) => ({ ...binding,
      validTimeMa: { ...binding.validTimeMa, youngest: 1 } }));
    expect(() => validateReconstructionCoreV2({ ...core, charts: core.charts.map((chart) =>
      chart.chartId === targetId ? { ...chart, motionBindings: malformedBindings } : chart) },
    manifest, palette)).toThrow(/binding/);

    const foundation = await loadVerifiedCaoFoundation(manifest, fetcher);
    expect(resolveChartMotionSegment(malformedBindings, foundation.paletteEntries, 0)).toBeNull();
  });

  it("marks only the strict interior of an explicit source seam as unsupported", () => {
    const gaps = [{ validTimeMa: { youngest: 79.1, oldest: 79.100001 },
      reason: "source-seam" as const }];
    expect(resolveChartMotionSupportGap(gaps, 79.1)).toBeNull();
    expect(resolveChartMotionSupportGap(gaps, 79.1000005)?.reason).toBe("source-seam");
    expect(resolveChartMotionSupportGap(gaps, 79.100001)).toBeNull();
  });

  it("interpolates motion continuously between checkpoints and reuses evaluateMotion", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const foundation = await loadVerifiedCaoFoundation(manifest, fetcher);
    const younger = evaluateCaoMotionFrame(manifest, foundation, 100);
    const mid = evaluateCaoMotionFrame(manifest, foundation, 102.5);
    const older = evaluateCaoMotionFrame(manifest, foundation, 105);
    expect(mid.display.fraction).toBeCloseTo(0.5, 6);
    expect(mid.entryCount).toBe(younger.entryCount);
    expect(mid.paletteValues).toHaveLength(mid.entryCount * 11);

    const supported = mid.charts.findIndex((chart) => chart.support.kind === "supported");
    expect(supported).toBeGreaterThanOrEqual(0);
    const offset = supported * 11;
    // Mid-frame motion fraction should sit between the endpoint evaluations for the
    // same chart when the subsegment spans the sample (not a discrete snap cheat).
    expect(mid.paletteValues[offset + 8]!).toBeGreaterThanOrEqual(0);
    expect(mid.paletteValues[offset + 8]!).toBeLessThanOrEqual(1);
    // Continuous ages must not collapse to a single discrete prepared snap.
    const midRow = mid.paletteValues.slice(offset, offset + 11);
    const youngRow = younger.paletteValues.slice(offset, offset + 11);
    expect(midRow.some((value, index) => value !== youngRow[index])).toBe(true);

    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const viaRuntime = await runtime.evaluateMotion(102.5);
    expect(viaRuntime.display).toEqual(mid.display);
    expect(viaRuntime.paletteValues[offset + 8]).toBeCloseTo(mid.paletteValues[offset + 8]!, 6);
    // Prefetch stays bounded to resident checkpoint capacity.
    await runtime.prefetchCheckpoints([100, 105, 110, 115]);
    expect(runtime.ledger.checkpoint.residentCount).toBeLessThanOrEqual(2);
    runtime.dispose();
    expect(older.requestedAgeMa).toBe(105);
  });

  it("retargets correction boundaries, virtual country rows, and saved native addresses continuously", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const foundation = await loadVerifiedCaoFoundation(manifest, fetcher);
    const frames = [0, 410, 410.001, 430.001, 0]
      .map((ageMa) => evaluateCaoMotionFrame(manifest, foundation, ageMa));
    const entryCount = frames[0]!.entryCount;
    expect(entryCount).toBeGreaterThan(foundation.core.charts.length);
    expect(frames.every((frame) => frame.entryCount === entryCount
      && frame.paletteValues.length === entryCount * 11)).toBe(true);
    expect(frames.map((frame) => frame.materialCorrections.overriddenNativeCharts))
      .toEqual([2, 2, 0, 0, 2]);

    for (const frame of frames) {
      const supported = (phase: string) => frame.charts.filter((chart) => chart.support.kind === "supported"
        && chart.evidence.correction?.phase === phase).length;
      expect(frame.materialCorrections.observedActiveCharts).toBe(supported("observed-exposed-land"));
      expect(frame.materialCorrections.classifiedShallowMarineActiveCharts).toBe(frame.charts.filter(
        (chart) => chart.support.kind === "supported" && chart.surfaceEvidence.kind === "classified"
          && chart.surfaceEvidence.surfaceClass === "shallow-marine",
      ).length);
      expect(frame.materialCorrections.qualifiedActiveCharts).toBe(supported("source-qualified-material"));
      expect(frame.materialCorrections.uncertainActiveCharts).toBe(supported("uncertain-continuation"));
      expect(frame.materialCorrections.formationUncertainActiveCharts).toBe(supported("formation-uncertain"));
    }
    expect(frames[2]!.materialCorrections.qualifiedActiveCharts)
      .toBeGreaterThan(frames[1]!.materialCorrections.qualifiedActiveCharts);
    expect(frames[3]!.materialCorrections.uncertainActiveCharts).toBeGreaterThan(0);

    const override = foundation.correctionCatalog?.nativeChartOverrides?.find(
      (candidate) => candidate.nativeTarget.sourceFeatureOrder === 450,
    );
    expect(override).toBeDefined();
    const virtualCountryPrefix = `country-segment:${override!.overrideId}:`;
    const virtualCountryIndices = frames[0]!.charts
      .map((chart, chartIndex) => chart.chartId.startsWith(virtualCountryPrefix) ? chartIndex : -1)
      .filter((chartIndex) => chartIndex >= 0);
    expect(virtualCountryIndices).toHaveLength(override!.dependentConsumers.expectedSourceSegmentCount);
    for (const chartIndex of virtualCountryIndices) {
      expect(frames[0]!.charts[chartIndex]!.support.kind).toBe("supported");
      expect(frames[0]!.paletteValues[chartIndex * 11 + 9]).toBe(1);
      expect(frames[1]!.charts[chartIndex]!.support).toEqual({ kind: "inactive", reason: "replaced" });
      expect(frames[1]!.paletteValues[chartIndex * 11 + 9]).toBe(0);
    }
    const nativeChart = frames[0]!.charts.findIndex((chart) => chart.chartId === override!.nativeChart.chartId);
    const referenceDirection = lonLatDirection(-118.95080265663344, 36.842403493263426);
    const savedNativeAddress = frames[0]!.addressForChartDirection(nativeChart, referenceDirection);
    expect(override!.replacementChartIds).toContain(frames[0]!.resolveAddress(savedNativeAddress).address.chartId);
    expect(override!.replacementChartIds).toContain(frames[1]!.resolveAddress(savedNativeAddress).address.chartId);
    expect(frames[2]!.resolveAddress(savedNativeAddress)).toMatchObject({
      address: { chartId: override!.nativeChart.chartId },
      support: { kind: "inactive", reason: "unborn" },
    });
    expect(override!.replacementChartIds).toContain(frames[4]!.resolveAddress(savedNativeAddress).address.chartId);
  });

  it("keeps Fennoscandia charts supported across the authored 118–120 Ma motion intervals", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const foundation = await loadVerifiedCaoFoundation(manifest, fetcher);
    const younger = evaluateCaoMotionFrame(manifest, foundation, 118);
    const mid = evaluateCaoMotionFrame(manifest, foundation, 119.6);
    const older = evaluateCaoMotionFrame(manifest, foundation, 120);
    // The compiler must retain authored motion coverage through former adaptive
    // refinement dropouts instead of relying on a runtime nearest-pose hold.
    const fennoscandiaIds = new Set(foundation.core.charts.filter((chart) =>
      (chart.motionBindings ?? []).some((binding) => /^plate-302(?:02|04)?-/.test(binding.entryId)
        || /^plate-301-/.test(binding.entryId) || /^plate-311-/.test(binding.entryId)))
      .map((chart) => chart.chartId));
    // Only charts that are lifecycle-active at both endpoints must stay posed
    // through the interval (inactive lifecycle charts remain inactive).
    const activeEndpoints = younger.charts.filter((chart) => fennoscandiaIds.has(chart.chartId)
      && chart.support.kind === "supported"
      && older.charts.find((candidate) => candidate.chartId === chart.chartId)?.support.kind === "supported");
    expect(activeEndpoints.length).toBeGreaterThan(10);
    for (const chart of activeEndpoints) {
      const atGap = mid.charts.find((candidate) => candidate.chartId === chart.chartId)!;
      expect(atGap.support.kind).toBe("supported");
      expect(Math.hypot(...atGap.poseQuaternion)).toBeCloseTo(1, 5);
    }
    const countrySwe = mid.charts.filter((chart) => chart.materialId === "country:swe"
      && !chart.chartId.startsWith("country-present-reference:"));
    expect(countrySwe.length).toBeGreaterThan(0);
    expect(countrySwe.every((chart) => chart.support.kind === "supported")).toBe(true);
    const supportedAtGap = mid.charts.filter((chart) => chart.support.kind === "supported").length;
    const supportedAt118 = younger.charts.filter((chart) => chart.support.kind === "supported").length;
    expect(supportedAtGap).toBeGreaterThanOrEqual(supportedAt118 - 5);
  });

  it("honors the composed plate 626 source seams and exact-present singleton consumers", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const foundation = await loadVerifiedCaoFoundation(manifest, fetcher);
    const gapChartIds = foundation.core.charts.filter((chart) => chart.motionSupportGaps?.length === 2)
      .map((chart) => chart.chartId);
    expect(gapChartIds).toHaveLength(4);
    for (const [youngerAge, interiorAge, olderAge] of [
      [79.1, 79.1000005, 79.100001],
      [119.999999, 119.9999995, 120],
    ]) {
      const younger = evaluateCaoMotionFrame(manifest, foundation, youngerAge);
      const interior = evaluateCaoMotionFrame(manifest, foundation, interiorAge);
      const older = evaluateCaoMotionFrame(manifest, foundation, olderAge);
      for (const chartId of gapChartIds) {
        expect(younger.charts.find((chart) => chart.chartId === chartId)?.support.kind).toBe("supported");
        expect(interior.charts.find((chart) => chart.chartId === chartId)?.support)
          .toEqual({ kind: "unsupported", reason: "source-seam" });
        expect(older.charts.find((chart) => chart.chartId === chartId)?.support.kind).toBe("supported");
      }
    }

    for (const entryId of ["panama-observed-land-plate-229-0",
      "panama-observed-land-plate-230-0", "panama-observed-land-plate-911-0",
      "country-present-reference-plate-0-identity"]) {
      expect(foundation.paletteEntries.get(entryId)?.sampleCount).toBe(1);
    }
    const modern = evaluateCaoMotionFrame(manifest, foundation, 0);
    const postModern = evaluateCaoMotionFrame(manifest, foundation, 0.000001);
    const exactCountryIds = foundation.core.charts.filter((chart) =>
      chart.chartId.startsWith("country-present-reference:")).map((chart) => chart.chartId);
    const panamaIds = foundation.core.charts.filter((chart) =>
      chart.chartId.startsWith("correction:earthhistory-regional-panama-observed-land-v1:"))
      .map((chart) => chart.chartId);
    expect(exactCountryIds).toHaveLength(173);
    expect(panamaIds).toHaveLength(5);
    for (const chartId of [...exactCountryIds, ...panamaIds]) {
      expect(modern.charts.find((chart) => chart.chartId === chartId)?.support.kind).toBe("supported");
      expect(postModern.charts.find((chart) => chart.chartId === chartId)?.support)
        .toEqual({ kind: "inactive", reason: "unborn" });
    }
  });

  // `at=<lon>,<lat>` is a present-day coordinate, so the deep link has to be
  // posed through the chart that owns that ground before the camera aims at it.
  // The inverse of that pose is exactly what the coverage path applies to a
  // rendered direction, so the round trip is the contract both share.
  it("poses a present-day direction through the chart that owns the ground", async () => {
    const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
      ReconstructionPackageManifestV2;
    const foundation = await loadVerifiedCaoFoundation(manifest, fetcher);

    // Present-day (-100, 45): the Western Interior of North America, the ground
    // the 90 Ma seaway capture frames.
    const interior = lonLatDirection(-100, 45);
    const modern = evaluateCaoMotionFrame(manifest, foundation, 0);
    const modernResolved = modern.resolvePresentDayDirection(interior);
    expect(modernResolved.resolution).toBe("posed");
    expect(modernResolved.chartId).not.toBeNull();
    for (const axis of [0, 1, 2]) {
      expect(modernResolved.direction[axis]).toBeCloseTo(interior[axis]!, 6);
    }

    const cretaceous = evaluateCaoMotionFrame(manifest, foundation, 90);
    const posed = cretaceous.resolvePresentDayDirection(interior);
    expect(posed.resolution).toBe("posed");
    // The coverage path undoes the same chart's pose to answer a rendered
    // direction; inverting the pose must return the requested ground exactly.
    const chart = cretaceous.charts.find((candidate) => candidate.chartId === posed.chartId)!;
    const restored = rotateDirection(numberScalarOps, chart.inversePoseQuaternion, posed.direction);
    for (const axis of [0, 1, 2]) {
      expect(restored[axis]).toBeCloseTo(interior[axis]!, 6);
    }
    // North America is well away from its present-day longitude at 90 Ma: a
    // direction that had not moved would frame different ground.
    const cosine = posed.direction[0] * interior[0]! + posed.direction[1] * interior[1]!
      + posed.direction[2] * interior[2]!;
    expect(Math.acos(Math.min(1, cosine)) * 180 / Math.PI).toBeGreaterThan(5);

    // Open ocean carries no chart, so there is no reconstructed position to
    // aim at and the raw direction comes back flagged.
    const pacific = lonLatDirection(-140, -25);
    const unposed = modern.resolvePresentDayDirection(pacific);
    expect(unposed).toMatchObject({ resolution: "present-day-unposed", chartId: null });
    expect([...unposed.direction]).toEqual([...pacific]);
  });

});
