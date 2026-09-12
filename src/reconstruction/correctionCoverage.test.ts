import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function trackedJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;
}

describe("410 Ma regional correction coverage", () => {
  it("records expanded source support and preserves every substantial residual", () => {
    const canada = trackedJson("docs/research/regional-canada-franklinian-validation.json");
    const canadaTarget = canada.summary.targetSphericalPolygonUnionAreaKm2 as number;
    const canadaMask = canada.summary.candidateSphericalPolygonUnionAreaKm2 as number;
    expect(canada.summary.targetChartCount).toBe(44);
    expect(canadaMask).toBeCloseTo(203_260.83, 1);
    expect(canadaMask / canadaTarget).toBeCloseTo(0.851057, 5);
    expect(canadaTarget - canadaMask).toBeGreaterThan(35_000);

    const pearya = trackedJson("docs/research/regional-pearya-validation.json");
    expect(pearya.combined.targetAreaSupportFractionAt411).toBeCloseTo(0.691121, 5);
    expect(pearya.combined.targetAreaKm2 - pearya.combined.candidateAreaKm2).toBeGreaterThan(13_000);
    expect(pearya.geometry.mappedUnrelatedExcludedKm2).toBeGreaterThan(3_500);

    const svalbard = trackedJson("docs/research/regional-svalbard-validation.json");
    expect(svalbard.targetCounts["309"] + svalbard.targetCounts["311"]).toBe(11);
    expect(svalbard.coverage.deliveredMaskAreaSquareKilometres).toBeCloseTo(51_667.25, 1);
    expect(svalbard.coverage.fractionOfElevenSvalbardTargetSummedArea).toBeCloseTo(0.885448, 5);
    expect(svalbard.coverage.residualElevenSvalbardTargetSummedAreaSquareKilometres)
      .toBeGreaterThan(6_000);

    const barents = trackedJson("docs/research/regional-barents-validation.json");
    expect(barents.deliveredFractionOfBarentsFortyTargetScale).toBeCloseTo(0.760823, 5);
    expect(barents.barentsFortyTargetScaleAreaSquareKilometres
      - barents.totalDeliveredAreaSquareKilometres).toBeGreaterThan(113_000);

    const source450 = trackedJson("docs/research/regional-western-source450-validation.json");
    const source450At410 = source450.basementAudit.ageSnapshots.find(
      (row: { ageMa: number }) => row.ageMa === 410,
    );
    const source450At0 = source450.basementAudit.ageSnapshots.find(
      (row: { ageMa: number }) => row.ageMa === 0,
    );
    expect(source450At410.visibleFraction).toBeCloseTo(0.090682, 5);
    expect(source450At0.visibleFraction).toBeGreaterThan(0.9999);

    const source490 = trackedJson("docs/research/regional-western-source490-validation.json");
    const source490At410 = source490.ageSnapshots.find((row: { ageMa: number }) => row.ageMa === 410);
    const source490At0 = source490.ageSnapshots.find((row: { ageMa: number }) => row.ageMa === 0);
    expect(source490At410.visibleFraction).toBeCloseTo(0.106665, 5);
    expect(source490At0.visibleFraction).toBeGreaterThan(0.9999);
    expect(source490.presentUnionSymmetricDifferenceKm2).toBeLessThan(0.001);
  });
});
