import { describe, expect, it } from "vitest";
import type { LandPolygon } from "../data";
import { createLandMaskSampler, rasterizeLandMask } from "./landMask";

describe("prepared land mask sampler", () => {
  it("preserves holes and antimeridian polygons", () => {
    const polygons: LandPolygon[] = [
      {
        id: "ring-with-hole",
        coordinates: [
          [[-20, -20], [20, -20], [20, 20], [-20, 20], [-20, -20]],
          [[-5, -5], [-5, 5], [5, 5], [5, -5], [-5, -5]],
        ],
      },
      {
        id: "seam",
        coordinates: [
          [[170, -10], [-170, -10], [-170, 10], [170, 10], [170, -10]],
        ],
      },
    ];
    const contains = createLandMaskSampler(polygons);
    expect(contains([12, 0])).toBe(true);
    expect(contains([0, 0])).toBe(false);
    expect(contains([179, 0])).toBe(true);
    expect(contains([-179, 0])).toBe(true);
    expect(contains([90, 0])).toBe(false);
  });

  it("matches point sampling at raster cell centers", () => {
    const polygons: LandPolygon[] = [{
      id: "seam",
      coordinates: [[[170, -20], [-170, -20], [-170, 20], [170, 20], [170, -20]]],
    }];
    const contains = createLandMaskSampler(polygons);
    const width = 72;
    const height = 36;
    const mask = rasterizeLandMask(polygons, width, height);
    for (let y = 0; y < height; y += 1) {
      const latitude = 90 - ((y + 0.5) / height) * 180;
      for (let x = 0; x < width; x += 1) {
        const longitude = ((x + 0.5) / width) * 360 - 180;
        expect(mask[y * width + x] > 0).toBe(contains([longitude, latitude]));
      }
    }
  });
});
