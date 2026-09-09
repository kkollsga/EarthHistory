import { describe, expect, it } from "vitest";
import type { ModernClimateControl, SurfaceStage, WorldSnapshot } from "../data";
import {
  EARTH_RADIUS_METRES,
  generateSurface,
  iceDisplayCoverage,
  inferDrainageCorridors,
  RELIEF_RANGE_METRES,
  reliefDisplacementScale,
  sampleModernClimateGroup,
  modernClimateAllowsPermanentIce,
  polarLongitudeSampleCount,
  sampleGeographicGrid,
  sampleSurfaceReliefMetres,
} from "./surface";

function snapshot(stage: SurfaceStage): WorldSnapshot {
  return {
    id: `test-${stage}`,
    label: stage,
    ageMa: 0,
    period: "test",
    eon: "test",
    description: "test",
    evidence: "synthesis",
    sourceIds: [],
    land: [
      {
        id: "land",
        coordinates: [
          [
            [-20, -20],
            [20, -20],
            [20, 20],
            [-20, 20],
            [-20, -20],
          ],
        ],
      },
    ],
    countries: [],
    tectonics: [],
    poiIds: [],
    environment: {
      stage,
      iceLatitude: 65,
      iceIntensity: 1,
      vegetation: 0.8,
      oceanCoverage: 0.7,
      cloudCover: 0.45,
    },
    caveat: "test",
  };
}

describe("surface generation", () => {
  it("uses a bounded equal-footprint filter for oversampled polar grid rows", () => {
    const width = 180;
    const height = 91;
    const field = new Float32Array(width * height);
    for (let x = 0; x < width; x += 1) field[width + x] = x % 2 === 0 ? 0 : 1_000;
    const sampleCount = polarLongitudeSampleCount(width, height, 88);
    expect(sampleCount).toBeGreaterThanOrEqual(20);
    expect(sampleCount).toBeLessThanOrEqual(32);
    expect(polarLongitudeSampleCount(width, height, 0)).toBe(1);

    const values = Array.from({ length: 12 }, (_, index) =>
      sampleGeographicGrid(field, width, height, index / 12, (90 - 88) / 180, 0, 0)
    );
    const unfiltered = Array.from({ length: 12 }, (_, index) =>
      field[width + ((index * 15) % width)]
    );
    expect(Math.max(...unfiltered) - Math.min(...unfiltered)).toBe(1_000);
    expect(Math.max(...values) - Math.min(...values)).toBeLessThan(50);
  });

  it("keeps procedural cloud noise convergent at both geographic poles", () => {
    const fields = generateSurface(snapshot("modern-biomes"), "coarse", {
      width: 360,
      height: 180,
    });
    for (const row of [0, fields.height - 1]) {
      const alpha = Array.from({ length: fields.width }, (_, x) =>
        fields.clouds[(row * fields.width + x) * 4 + 3]
      );
      expect(Math.max(...alpha) - Math.min(...alpha)).toBeLessThan(50);
    }
  });

  it("is deterministic for a stable snapshot and detail level", () => {
    const world = snapshot("modern-biomes");
    const first = generateSurface(world, "coarse", { width: 32, height: 16 });
    const second = generateSurface(world, "coarse", { width: 32, height: 16 });
    expect(second.albedo).toEqual(first.albedo);
    expect(second.relief).toEqual(first.relief);
    expect(second.clouds).toEqual(first.clouds);
  });

  it("does not leak modern coast geometry into the magma-ocean scene", () => {
    const withModernLand = snapshot("magma-ocean");
    const withoutModernLand = { ...withModernLand, land: [] };
    const a = generateSurface(withModernLand, "coarse", { width: 32, height: 16 });
    const b = generateSurface(withoutModernLand, "coarse", { width: 32, height: 16 });
    expect(a.albedo).toEqual(b.albedo);
  });

  it("keeps generated buffers inside the declared owned size", () => {
    const fields = generateSurface(snapshot("modern-biomes"), "coarse", {
      width: 32,
      height: 16,
    });
    expect(fields.byteLength).toBe(32 * 16 * 4 * 5);
  });

  it("defines 1x relief in metres against the mean Earth radius", () => {
    expect(reliefDisplacementScale(1)).toBeCloseTo(
      RELIEF_RANGE_METRES / EARTH_RADIUS_METRES,
      12,
    );
    expect(reliefDisplacementScale(30)).toBeCloseTo(
      (RELIEF_RANGE_METRES * 30) / EARTH_RADIUS_METRES,
      12,
    );
  });

  it("routes only downhill corridors and preserves closed basins", () => {
    const sloping = snapshot("modern-biomes");
    const width = 10;
    const height = 10;
    sloping.controls = {
      width,
      height,
      elevation: Float32Array.from({ length: width * height }, (_, index) => {
        const y = Math.floor(index / width);
        return y === height - 1 ? -10 : 1_000 - y * 100;
      }),
    };
    expect(inferDrainageCorridors(sloping).length).toBeGreaterThan(0);

    const basin = snapshot("modern-biomes");
    basin.controls = {
      width,
      height,
      elevation: new Float32Array(width * height).fill(100),
    };
    expect(inferDrainageCorridors(basin)).toEqual([]);
  });

  it("uses ice intensity for extent, not translucent glacier paint", () => {
    expect(iceDisplayCoverage(0.12, 0.12)).toBeGreaterThan(0.9);
    expect(iceDisplayCoverage(0.01, 0.12)).toBeLessThan(0.1);
    expect(iceDisplayCoverage(0, 0.8)).toBe(0);
  });

  it("keeps negative elevation hidden until explicit seafloor mode", () => {
    const world = snapshot("modern-biomes");
    world.controls = {
      width: 4,
      height: 3,
      elevation: new Float32Array(12).fill(-4_000),
    };
    const surface = generateSurface(world, "coarse", { width: 8, height: 4 });
    const seafloor = generateSurface(
      world,
      "coarse",
      { width: 8, height: 4 },
      "seafloor",
    );
    expect(surface.reliefBiasMetres).toBe(0);
    expect(seafloor.reliefBiasMetres).toBe(-RELIEF_RANGE_METRES);
    expect(seafloor.relief[0]).not.toBe(surface.relief[0]);
    expect(seafloor.albedo[0]).not.toBe(surface.albedo[0]);
  });

  it("canonicalizes duplicate pole elevations before interpolating to the next source row", () => {
    const world = snapshot("modern-biomes");
    world.environment.iceIntensity = 0;
    world.environment.iceLatitude = 90;
    world.controls = {
      width: 4,
      height: 3,
      elevation: Float32Array.from([
        -4_200, -4_100, -4_000, 10_500,
        -3_000, -3_000, -3_000, -3_000,
        0, 0, 0, 0,
      ]),
    };
    const fields = generateSurface(world, "coarse", { width: 32, height: 180 });
    const northRenderRow = Array.from({ length: fields.width }, (_, x) =>
      fields.relief[x * 4],
    );
    // The +10,500 m duplicate cannot create a longitude wedge at one physical
    // pole; the finite-row median keeps the interpolation oceanward until the
    // untouched -3,000 m row at 88°N.
    expect(new Set(northRenderRow)).toEqual(new Set([0]));
  });

  it("renders modern EF as an ice-covered surface over negative bed elevation only in surface mode", () => {
    const world = snapshot("modern-biomes");
    world.controls = {
      width: 4,
      height: 3,
      elevation: new Float32Array(12).fill(-1_000),
    };
    world.modernClimate = {
      period: "1991–2020",
      width: 4,
      height: 2,
      cellSizeDegrees: 90,
      longitudeOrigin: -135,
      latitudeOrigin: 45,
      noDataValue: 255,
      classes: new Uint8Array(8).fill(30),
      legend: [
        { value: 30, code: "EF", description: "frost", group: "frost", rgb: [255, 255, 255] },
      ],
      sourceIds: ["test"],
    };
    const surface = generateSurface(world, "coarse", { width: 8, height: 4 }, "surface");
    const seafloor = generateSurface(world, "coarse", { width: 8, height: 4 }, "seafloor");
    expect(surface.albedo[0]).toBeGreaterThan(200);
    expect(seafloor.albedo[0]).toBeLessThan(100);
    expect(surface.reliefBiasMetres).toBe(0);
    expect(seafloor.reliefBiasMetres).toBe(-RELIEF_RANGE_METRES);
    expect(sampleSurfaceReliefMetres(surface, 0.5 / 8, 1 - 0.5 / 4)).toBe(0);
    expect(sampleSurfaceReliefMetres(seafloor, 0.5 / 8, 1 - 0.5 / 4)).toBeLessThan(0);
  });

  it("decodes the generated relief field at geographic UV coordinates", () => {
    const fields = generateSurface(snapshot("modern-biomes"), "coarse", {
      width: 8,
      height: 4,
    });
    expect(sampleSurfaceReliefMetres(fields, 0.5 / 8, 1 - 0.5 / 4)).toBeCloseTo(
      fields.reliefMetres[0],
      6,
    );
    expect(fields.reliefMetres.byteLength).toBe(fields.width * fields.height * 4);
    for (let pixel = 0; pixel < fields.width * fields.height; pixel += 1) {
      const encoded = Math.round(
        ((fields.reliefMetres[pixel] - fields.reliefBiasMetres) /
          fields.reliefRangeMetres) * 255,
      );
      expect(fields.relief[pixel * 4]).toBe(encoded);
      expect(fields.relief[pixel * 4 + 1]).toBe(encoded);
      expect(fields.relief[pixel * 4 + 2]).toBe(encoded);
    }
  });

  it("uses the source-authored modern climate legend instead of numeric assumptions", () => {
    const control: ModernClimateControl = {
      period: "1991–2020",
      width: 4,
      height: 2,
      cellSizeDegrees: 90,
      longitudeOrigin: -135,
      latitudeOrigin: 45,
      noDataValue: 255,
      classes: Uint8Array.from([17, 42, 17, 42, 42, 17, 42, 17]),
      legend: [
        { value: 17, code: "custom-a", description: "a", group: "desert", rgb: [1, 2, 3] },
        { value: 42, code: "custom-b", description: "b", group: "tropical-rainforest", rgb: [4, 5, 6] },
      ],
      sourceIds: ["test"],
    };
    expect(sampleModernClimateGroup(control, -135, 45)).toBe("desert");
    expect(sampleModernClimateGroup(control, -45, 45)).toBe("tropical-rainforest");
    expect(modernClimateAllowsPermanentIce("frost")).toBe(true);
    expect(modernClimateAllowsPermanentIce("tundra")).toBe(false);
    expect(modernClimateAllowsPermanentIce("cold-forest")).toBe(false);

    const southPoleGap: ModernClimateControl = {
      ...control,
      height: 4,
      cellSizeDegrees: 0.5,
      latitudeOrigin: -88.25,
      noDataValue: 255,
      classes: Uint8Array.from([
        30, 30, 30, 30,
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]),
      legend: [
        { value: 30, code: "EF", description: "frost", group: "frost", rgb: [255, 255, 255] },
      ],
    };
    const preservedClasses = southPoleGap.classes.slice();
    expect(sampleModernClimateGroup(southPoleGap, 0, -89.25)).toBe("frost");
    const polarWorld = snapshot("modern-biomes");
    polarWorld.controls = {
      width: 4,
      height: 3,
      elevation: new Float32Array(12).fill(-1_000),
    };
    polarWorld.modernClimate = southPoleGap;
    const polarSurface = generateSurface(
      polarWorld,
      "coarse",
      { width: 8, height: 180 },
      "surface",
    );
    const southPoleOffset = ((polarSurface.height - 1) * polarSurface.width) * 4;
    expect(polarSurface.albedo[southPoleOffset]).toBeGreaterThan(200);
    expect(southPoleGap.classes).toEqual(preservedClasses);
  });
});
