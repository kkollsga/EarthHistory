import { describe, expect, it } from "vitest";
import type { LonLat, WorldSnapshot } from "../data";
import { cubeFaceDirection } from "./cubeSphere";
import { createCubeTileFieldGenerator } from "./cubeTileFields";
import {
  createDrapedLineData,
  createDrapedLineDataSegments,
  createSurfaceFieldHeightSampler,
  densifyGeodesicDirectionSegments,
  densifyGeodesicDirections,
  updateDrapedLinePositions,
} from "./displayedHeight";
import type { SurfaceFields } from "./surface";

function fixture(): { snapshot: WorldSnapshot; surface: SurfaceFields } {
  const width = 16;
  const height = 8;
  const pixels = width * height;
  const rgba = pixels * 4;
  return {
    snapshot: {
      id: "drape-fixture",
      label: "Drape fixture",
      ageMa: 0,
      period: "fixture",
      eon: "fixture",
      description: "fixture",
      evidence: "synthesis",
      sourceIds: [],
      land: [],
      countries: [],
      tectonics: [],
      poiIds: [],
      environment: { stage: "modern-biomes", iceLatitude: 80, vegetation: 0.5 },
      caveat: "fixture",
    },
    surface: {
      width,
      height,
      albedo: new Uint8Array(rgba).fill(120),
      relief: new Uint8Array(rgba).fill(128),
      reliefMetres: Float32Array.from({ length: pixels }, (_, index) =>
        (index % width) * 100 + Math.floor(index / width) * 10,
      ),
      reliefRangeMetres: 9_000,
      reliefBiasMetres: 0,
      roughness: new Uint8Array(rgba).fill(135),
      landMask: new Uint8Array(pixels).fill(255),
      clouds: new Uint8Array(rgba),
      cloudWidth: width,
      cloudHeight: height,
      rivers: [],
      generationMs: 0,
      byteLength: rgba * 4 + pixels * 4,
    },
  };
}

describe("continuous displayed-height overlays", () => {
  it("samples the fallback's encoded displacement texture rather than float cube relief", () => {
    const { surface } = fixture();
    const sampler = createSurfaceFieldHeightSampler(surface);
    expect(sampler.sampleHeightMetres([1, 0, 0])).toBeCloseTo(128 / 255 * 9_000, 6);
    expect(sampler.sampleHeightMetres([1, 0, 0])).not.toBeCloseTo(785, 3);
  });

  it("samples the identical height used by cube vertices", () => {
    const context = { ...fixture(), mode: "surface" as const, detail: "coarse" as const };
    const generator = createCubeTileFieldGenerator(context);
    const tile = generator.generate({
      key: { face: "pz", level: 0, x: 0, y: 0 }, meshSegments: 32, textureSize: 64,
    });
    const vertex = 11 * 33 + 19;
    const offset = vertex * 3;
    expect(generator.sampleHeightMetres([
      tile.directions[offset], tile.directions[offset + 1], tile.directions[offset + 2],
    ])).toBeCloseTo(tile.heightsMetres[vertex], 4);
  });

  it("densifies across the antimeridian and near a pole on the short geodesic", () => {
    const directions = densifyGeodesicDirections([[179, 82], [-179, 82]], {
      maxAngularStepDegrees: 0.25,
    });
    expect(directions.length / 3).toBeGreaterThan(2);
    let maximumStep = 0;
    for (let index = 3; index < directions.length; index += 3) {
      const dot = directions[index - 3] * directions[index] +
        directions[index - 2] * directions[index + 1] +
        directions[index - 1] * directions[index + 2];
      maximumStep = Math.max(maximumStep, Math.acos(Math.max(-1, Math.min(1, dot))));
    }
    expect(maximumStep * 180 / Math.PI).toBeLessThanOrEqual(0.251);
    expect(Math.min(...Array.from({ length: directions.length / 3 }, (_, index) =>
      directions[index * 3],
    ))).toBeLessThan(-0.13);

    expect(() => densifyGeodesicDirections([[0, 0], [180, 0]], {
      maxAngularStepDegrees: 0.1,
      maxVertices: 100,
    })).toThrow(/exceeds 100 vertices/);
  });

  it("omits Antarctic pole seam anchors without reconnecting adjacent runs", () => {
    const coordinates: LonLat[] = [
      [-30, -72], [-20, -78], [-180, -90], [20, -78], [30, -72],
    ];
    const segments = densifyGeodesicDirectionSegments(coordinates, {
      maxAngularStepDegrees: 2,
    });
    expect(segments).toHaveLength(2);
    expect(segments.every((segment) => segment.length >= 6)).toBe(true);
    expect(segments.flatMap((segment) => Array.from(segment)).every(Number.isFinite)).toBe(true);

    const drapes = createDrapedLineDataSegments(coordinates, {
      sampleHeightMetres: () => 0,
    }, 1_000, { maxAngularStepDegrees: 2 });
    expect(drapes).toHaveLength(2);
    expect(() => createDrapedLineData(coordinates, {
      sampleHeightMetres: () => 0,
    }, 1_000, { maxAngularStepDegrees: 2 })).toThrow(/segmented draping/);

    const ringWithClosureAnchors = densifyGeodesicDirectionSegments([
      [-180, -90], [170, -80], [160, -75], [180, -90],
    ], { maxAngularStepDegrees: 2 });
    expect(ringWithClosureAnchors).toHaveLength(1);
    expect(ringWithClosureAnchors[0].length / 3).toBeGreaterThan(2);
  });

  it("recomputes 1x -> 30x -> 1x without compounding and keeps clearance local", () => {
    const direction = cubeFaceDirection("px", 0.2, -0.1);
    const data = createDrapedLineData([[0, 0], [2, 0]], {
      sampleHeightMetres: () => 2_000,
    }, 1_500, { maxAngularStepDegrees: 1 });
    const one = updateDrapedLinePositions(data, 1).slice();
    const thirty = updateDrapedLinePositions(data, 30).slice();
    const oneAgain = updateDrapedLinePositions(data, 1).slice();
    expect(oneAgain).toEqual(one);
    expect(Math.hypot(...thirty.subarray(0, 3))).toBeGreaterThan(
      Math.hypot(...one.subarray(0, 3)),
    );
    expect(direction).toHaveLength(3);
    const surfaceAtThirty = 1 + 2_000 * 30 / 6_371_000;
    expect(Math.hypot(...thirty.subarray(0, 3)) - surfaceAtThirty).toBeCloseTo(
      1_500 / 6_371_000,
      7,
    );
  });
});
