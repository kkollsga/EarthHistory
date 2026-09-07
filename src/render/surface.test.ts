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
    expect(fields.byteLength).toBe(32 * 16 * 4 * 4);
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

  it("decodes the generated relief field at geographic UV coordinates", () => {
    const fields = generateSurface(snapshot("modern-biomes"), "coarse", {
      width: 8,
      height: 4,
    });
    expect(sampleSurfaceReliefMetres(fields, 0.5 / 8, 1 - 0.5 / 4)).toBeCloseTo(
      (fields.relief[0] / 255) * fields.reliefRangeMetres + fields.reliefBiasMetres,
      6,
    );
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
  });
});
