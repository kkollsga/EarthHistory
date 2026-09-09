import { describe, expect, it } from "vitest";
import {
  createReferenceGuideLines,
  createReferenceGuideRibbon,
  REFERENCE_GUIDE_MAX_BYTES,
  REFERENCE_GUIDE_MAX_VERTICES,
  REFERENCE_GUIDE_LABELS,
} from "./referenceGuides";
import { EARTH_RADIUS_METRES } from "./surface";

describe("schematic climatological reference guides", () => {
  it("includes equator, Hadley boundaries, polar rings, two meridians, and sparse arrows", () => {
    const lines = createReferenceGuideLines();
    expect(lines.some((line) => line.length > 4 && line.every(([, lat]) => lat === 0)))
      .toBe(true);
    expect(lines.some((line) => line.length > 4 && line.every(([, lat]) => lat === 30)))
      .toBe(true);
    expect(lines.some((line) => line.length > 4 && line.every(([, lat]) => lat === -30)))
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
      "Prime meridian",
      "Antimeridian",
      "Trade winds",
      "Westerlies",
    ]));
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
  });
});
