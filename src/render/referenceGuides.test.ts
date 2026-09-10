import { describe, expect, it } from "vitest";
import {
  createReferenceGuideLabelPatch,
  createReferenceGuideLines,
  createReferenceGuideRibbon,
  isReferenceDirectionAboveHorizon,
  REFERENCE_GUIDE_MAX_BYTES,
  REFERENCE_GUIDE_MAX_VERTICES,
  REFERENCE_GUIDE_LABELS,
  REFERENCE_GUIDE_LABEL_TEXTURE_BYTES,
  REFERENCE_GUIDE_POLE_TEXTURE_BYTES,
  REFERENCE_GUIDE_POLES,
} from "./referenceGuides";
import { EARTH_RADIUS_METRES } from "./surface";

describe("schematic climatological reference guides", () => {
  it("includes circulation boundaries, polar rings, two meridians, and sparse arrows", () => {
    const lines = createReferenceGuideLines();
    expect(lines.some((line) => line.length > 4 && line.every(([, lat]) => lat === 0)))
      .toBe(true);
    expect(lines.some((line) => line.length > 4 && line.every(([, lat]) => lat === 30)))
      .toBe(true);
    expect(lines.some((line) => line.length > 4 && line.every(([, lat]) => lat === -30)))
      .toBe(true);
    expect(lines.some((line) => line.length > 4 && line.every(([, lat]) => lat === 60)))
      .toBe(true);
    expect(lines.some((line) => line.length > 4 && line.every(([, lat]) => lat === -60)))
      .toBe(true);
    expect(lines.some((line) => line.length > 4 && line.every(([lon]) => lon === 0)))
      .toBe(true);
    expect(lines.some((line) => line.length > 4 && line.every(([lon]) => lon === 180)))
      .toBe(true);
    expect(lines.filter((line) => line.length === 3).length).toBeGreaterThanOrEqual(8);
    expect(REFERENCE_GUIDE_LABELS.map((label) => label.text)).toEqual(expect.arrayContaining([
      "North pole",
      "South pole",
      "Equator",
      "Hadley edge · 30° N",
      "Hadley edge · 30° S",
      "Polar cell edge · 60° N",
      "Polar cell edge · 60° S",
      "Prime meridian",
      "Antimeridian",
      "Trade winds",
      "Westerlies",
    ]));
    expect(REFERENCE_GUIDE_POLES).toEqual([[0, 90], [0, -90]]);

    const latitudeLines = lines.filter((line) =>
      line.length > 4 && line.every(([, latitude]) => latitude === line[0][1])
    );
    expect(latitudeLines).toHaveLength(7);
    for (const line of latitudeLines) {
      for (let index = 1; index < line.length; index += 1) {
        expect(line[index][0] - line[index - 1][0]).toBeLessThanOrEqual(2);
      }
    }
  });

  it("uses one bounded relief-anchored ribbon batch", () => {
    const ribbon = createReferenceGuideRibbon({
      sampleHeightMetres: ([, y]) => 1_000 + y * 500,
    }, "regional", 30);
    expect(ribbon).toBeDefined();
    expect(ribbon!.byteLength).toBeLessThanOrEqual(REFERENCE_GUIDE_MAX_BYTES);
    expect(ribbon!.positions.length / 3).toBeLessThanOrEqual(
      REFERENCE_GUIDE_MAX_VERTICES,
    );
    for (let index = 0; index < ribbon!.heightsMetres.length; index += 113) {
      const offset = index * 3;
      const radius = Math.hypot(
        ribbon!.positions[offset],
        ribbon!.positions[offset + 1],
        ribbon!.positions[offset + 2],
      );
      expect(radius).toBeCloseTo(
        1 + (ribbon!.heightsMetres[index] * 30 + ribbon!.clearanceMetres) /
          EARTH_RADIUS_METRES,
        6,
      );
    }
    let maximumConnectedAngle = 0;
    for (let index = 0; index < ribbon!.indices.length; index += 1) {
      const a = ribbon!.indices[index];
      const b = ribbon!.indices[index - index % 3 + (index + 1) % 3];
      const dot =
        ribbon!.directions[a * 3] * ribbon!.directions[b * 3] +
        ribbon!.directions[a * 3 + 1] * ribbon!.directions[b * 3 + 1] +
        ribbon!.directions[a * 3 + 2] * ribbon!.directions[b * 3 + 2];
      maximumConnectedAngle = Math.max(
        maximumConnectedAngle,
        Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI,
      );
    }
    expect(maximumConnectedAngle).toBeLessThan(2);

    const labelPatches = REFERENCE_GUIDE_LABELS.map((label) =>
      createReferenceGuideLabelPatch(label, { sampleHeightMetres: () => 0 }, 1)
    );
    expect(
      ribbon!.byteLength + labelPatches.reduce(
        (sum, patch) => sum + patch.byteLength + REFERENCE_GUIDE_LABEL_TEXTURE_BYTES,
        0,
      ) + REFERENCE_GUIDE_POLES.length * REFERENCE_GUIDE_POLE_TEXTURE_BYTES,
    ).toBeLessThanOrEqual(REFERENCE_GUIDE_MAX_BYTES);
    expect(
      ribbon!.heightsMetres.length + labelPatches.reduce(
        (sum, patch) => sum + patch.heightsMetres.length,
        0,
      ),
    ).toBeLessThanOrEqual(REFERENCE_GUIDE_MAX_VERTICES);
  });

  it("keeps curved label triangles above a flat globe", () => {
    const patch = createReferenceGuideLabelPatch(
      REFERENCE_GUIDE_LABELS.find((label) => label.text.startsWith("Polar cell"))!,
      { sampleHeightMetres: () => 0 },
      1,
    );
    let minimumCentroidRadius = Number.POSITIVE_INFINITY;
    for (let index = 0; index < patch.indices.length; index += 3) {
      const a = patch.indices[index] * 3;
      const b = patch.indices[index + 1] * 3;
      const c = patch.indices[index + 2] * 3;
      const x = (patch.positions[a] + patch.positions[b] + patch.positions[c]) / 3;
      const y = (patch.positions[a + 1] + patch.positions[b + 1] + patch.positions[c + 1]) / 3;
      const z = (patch.positions[a + 2] + patch.positions[b + 2] + patch.positions[c + 2]) / 3;
      minimumCentroidRadius = Math.min(minimumCentroidRadius, Math.hypot(x, y, z));
    }
    expect(minimumCentroidRadius).toBeGreaterThan(1);
  });

  it("hides reference sprites beyond the rendered globe horizon", () => {
    expect(isReferenceDirectionAboveHorizon(0.7, 1.4)).toBe(false);
    expect(isReferenceDirectionAboveHorizon(0.8, 1.4)).toBe(true);
    expect(isReferenceDirectionAboveHorizon(0.16, 5.8)).toBe(false);
    expect(isReferenceDirectionAboveHorizon(0.2, 5.8)).toBe(true);
    expect(isReferenceDirectionAboveHorizon(0.25, 5.8, 1.03, 0.08)).toBe(false);
    expect(isReferenceDirectionAboveHorizon(0.3, 5.8, 1.03, 0.08)).toBe(true);
  });
});
