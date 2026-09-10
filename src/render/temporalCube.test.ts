import { describe, expect, it } from "vitest";
import type { ProceduralControls, TemporalSurface, WorldSnapshot } from "../data";
import { createCubeTileFieldGenerator, type CubeTileFields } from "./cubeTileFields";
import { generateSurface, type SurfaceFields, type SurfaceMode } from "./surface";
import {
  createTemporalHeightSampler,
  interpolateTemporalHeight,
  sampleTemporalControlHeight,
  temporalRuggednessCacheBytes,
  unwrapTemporalTileUvs,
  updateTemporalCubeTile,
} from "./temporalCube";
import type { PaleomapIntervalResolver } from "../data/paleomapMotion";
import { lonLatToPeriodDirection } from "../data/temporal";

function direction(longitude: number, latitude: number): [number, number, number] {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), Math.sin(lat), -cosLat * Math.sin(lon)];
}

function controls(heightMetres: number): ProceduralControls {
  return { width: 1, height: 1, elevation: new Float32Array([heightMetres]) };
}

function movingPeakControls(peakLongitude: number, peakHeightMetres: number): ProceduralControls {
  const width = 360;
  const height = 181;
  const elevation = new Float32Array(width * height);
  const x = ((Math.round(peakLongitude) + 180) % 360 + 360) % 360;
  elevation[90 * width + x] = peakHeightMetres;
  return { width, height, elevation };
}

function movingRuggedControls(centerLongitude: number): ProceduralControls {
  const width = 360;
  const height = 181;
  const elevation = new Float32Array(width * height).fill(2_000);
  const center = ((Math.round(centerLongitude) + 180) % 360 + 360) % 360;
  elevation[90 * width + (center + width - 1) % width] = 0;
  elevation[90 * width + (center + 1) % width] = 6_000;
  return { width, height, elevation };
}

function temporal(
  fraction: number,
  requestedAgeMa = fraction * 5,
  youngerControls = controls(-2_000),
  olderControls = controls(0),
): TemporalSurface {
  return {
    intervalId: "fixture-0-5",
    seedId: "fixture-model",
    requestedAgeMa,
    younger: { ageMa: 0, controls: youngerControls },
    older: { ageMa: 5, controls: olderControls },
    fraction,
    exactEndpoint: fraction === 0 || fraction === 1,
    evidence: fraction === 0 || fraction === 1 ? "model-output" : "interpolation",
    method: "material-registered-relative-elevation-with-discrete-fallback",
  };
}

function field(directions: Array<[number, number, number]>, fallbackHeight = 320): CubeTileFields {
  const flat = Float32Array.from(directions.flat());
  return {
    key: { face: "px", level: 0, x: 0, y: 0 },
    meshSegments: 32,
    textureSize: 64,
    textureStride: 1,
    directions: flat,
    positions: flat.slice(),
    normals: flat.slice(),
    heightsMetres: new Float32Array(directions.length).fill(fallbackHeight),
    localUvs: new Float32Array(directions.length * 2),
    indices: new Uint32Array(),
    albedo: new Uint8Array([100, 120, 90, 255]),
    roughness: new Uint8Array([128, 128, 128, 255]),
    detailHeight: new Uint8Array([128, 128, 128, 255]),
    minHeightMetres: fallbackHeight,
    maxHeightMetres: fallbackHeight,
    generationMs: 0,
    byteLength: 0,
    sourcePatchIds: [],
  };
}

const fallbackSurface: SurfaceFields = {
  width: 1,
  height: 1,
  albedo: new Uint8Array([100, 120, 90, 255]),
  relief: new Uint8Array([0, 0, 0, 255]),
  reliefMetres: new Float32Array([0]),
  roughness: new Uint8Array([128, 128, 128, 255]),
  landMask: new Uint8Array([255]),
  clouds: new Uint8Array([0, 0, 0, 0]),
  cloudWidth: 1,
  cloudHeight: 1,
  reliefRangeMetres: 9_000,
  reliefBiasMetres: 0,
  rivers: [],
  generationMs: 0,
  byteLength: 21,
};

const environment = {
  iceLatitude: 70,
  vegetation: 0.7,
  temperatureC: 15,
  stage: "modern-biomes" as const,
};

function target(vertexCount: number) {
  return {
    positions: new Float32Array(vertexCount * 3),
    colors: new Float32Array(vertexCount * 3),
  };
}

function constantResolver(): Pick<PaleomapIntervalResolver, "resolveAt"> {
  return {
    resolveAt: () => ({
      fragmentId: "moving-mountain",
      plateId: 1,
      referenceDirection: lonLatToPeriodDirection([0, 0]),
      youngerDirection: lonLatToPeriodDirection([0, 0]),
      olderDirection: lonLatToPeriodDirection([20, 0]),
    }),
  };
}

describe("temporal cube inverse sampling", () => {
  it("recovers source heights exactly and grows through the real age fraction", () => {
    expect(interpolateTemporalHeight(-2_000, 0, 0)).toBe(-2_000);
    expect(interpolateTemporalHeight(-2_000, 0, 0.5)).toBe(-1_000);
    expect(interpolateTemporalHeight(-2_000, 0, 1)).toBe(0);
  });

  it("recovers the same source-controlled physical height at a native knot", () => {
    const mapped = movingPeakControls(10, 4_000);
    const world: WorldSnapshot = {
      id: "native-height-fixture",
      label: "Native height fixture",
      ageMa: 0,
      requestedAgeMa: 0,
      geographicSourceAgeMa: 0,
      period: "Quaternary",
      eon: "Phanerozoic",
      description: "Fixture",
      evidence: "model-output",
      sourceIds: [],
      land: [],
      countries: [],
      tectonics: [],
      poiIds: [],
      environment: { iceLatitude: 0, iceIntensity: 1, vegetation: 0.7, stage: "modern-biomes" },
      caveat: "Fixture",
      controls: mapped,
    };
    const generated = generateSurface(world, "coarse", { width: 32, height: 16 }, "surface");
    const native = createCubeTileFieldGenerator({
      snapshot: world,
      surface: generated,
      mode: "surface",
      detail: "coarse",
    });
    const identity: Pick<PaleomapIntervalResolver, "resolveAt"> = {
      resolveAt(value) {
        return {
          fragmentId: "identity",
          plateId: 1,
          referenceDirection: value,
          youngerDirection: value,
          olderDirection: value,
        };
      },
    };
    const exact = createTemporalHeightSampler(temporal(0, 0, mapped, mapped), "surface", identity);
    const probe = direction(10, 0);
    expect(native.sampleHeightMetres(probe)).toBeCloseTo(4_000, 5);
    expect(exact.sampleHeightMetres(probe)).toBeCloseTo(native.sampleHeightMetres(probe), 5);
  });

  it("preserves an enabled modern relief patch at the exact 0 Ma publication", () => {
    const patched = {
      ...field([direction(0, 0)], 4_321),
      localUvs: new Float32Array([0.25, 0.75]),
      sourcePatchIds: ["etopo-modern-regional"],
    };
    const output = { ...target(1), uvs: new Float32Array(2) };
    updateTemporalCubeTile(
      patched,
      fallbackSurface,
      temporal(0, 0, controls(100), controls(100)),
      environment,
      "seafloor",
      1,
      constantResolver(),
      output,
    );
    expect(Math.hypot(...output.positions))
      .toBeCloseTo(1 + 4_321 / 6_371_000, 7);
    expect([...output.colors]).toEqual([1, 1, 1]);
    expect([...output.uvs]).toEqual([0.25, 0.75]);
  });

  it("preserves exact modern native material mapping outside relief patches", () => {
    const native = {
      ...field([direction(0, 0)], 100),
      localUvs: new Float32Array([0.2, 0.8]),
      albedo: new Uint8Array([193, 151, 71, 255]),
      sourcePatchIds: [],
    };
    const output = { ...target(1), uvs: new Float32Array(2) };
    updateTemporalCubeTile(
      native,
      fallbackSurface,
      temporal(0, 0, controls(100), controls(100)),
      environment,
      "surface",
      1,
      constantResolver(),
      output,
    );
    expect([...output.colors]).toEqual([1, 1, 1]);
    expect([...output.uvs]).toEqual([
      expect.closeTo(0.2, 6),
      expect.closeTo(0.8, 6),
    ]);
    expect(Math.hypot(...output.positions)).toBeCloseTo(1 + 100 / 6_371_000, 7);
  });

  it("moves a growing material sample horizontally instead of blending fixed raster cells", () => {
    const samples = field([direction(0, 0), direction(10, 0)]);
    const requested = { value: 0 };
    const resolver: Pick<PaleomapIntervalResolver, "resolveAt"> = {
      resolveAt(displayedDirection) {
        const displayed = Math.atan2(displayedDirection[1], displayedDirection[0]) * 180 / Math.PI;
        const expectedLongitude = requested.value * 4;
        if (Math.abs(displayed - expectedLongitude) > 0.2) return null;
        return {
          fragmentId: "orogen-a",
          plateId: 1,
          referenceDirection: lonLatToPeriodDirection([0, 0]),
          youngerDirection: lonLatToPeriodDirection([0, 0]),
          olderDirection: lonLatToPeriodDirection([20, 0]),
        };
      },
    };
    const first = target(2);
    const midpoint = target(2);
    requested.value = 0;
    const atYounger = updateTemporalCubeTile(
      samples, fallbackSurface, temporal(0, 0), environment, "seafloor", 1, resolver, first,
    );
    requested.value = 2.5;
    const atMidpoint = updateTemporalCubeTile(
      samples,
      fallbackSurface,
      temporal(
        0.5,
        2.5,
        movingPeakControls(0, 1_000),
        movingPeakControls(20, 3_000),
      ),
      environment,
      "seafloor",
      1,
      resolver,
      midpoint,
    );
    expect(atYounger.resolvedVertices).toBe(1);
    expect(atMidpoint.resolvedVertices).toBe(1);
    expect(first.positions[0]).toBeLessThan(1);
    expect(Math.hypot(...midpoint.positions.subarray(3, 6)))
      .toBeCloseTo(1 + 2_000 / 6_371_000, 7);
    expect(Math.hypot(...midpoint.positions.subarray(0, 3))).toBeCloseTo(1, 7);
  });

  it("keeps signed bed relief in seafloor mode and clamps it only under surface water", () => {
    const fields = field([direction(0, 0)]);
    const update = (mode: SurfaceMode) => {
      const output = target(1);
      updateTemporalCubeTile(
        fields, fallbackSurface, temporal(0.5), environment, mode, 10,
        constantResolver(), output,
      );
      return Math.hypot(...output.positions);
    };
    expect(update("seafloor")).toBeLessThan(1);
    expect(update("surface")).toBeCloseTo(1, 7);
  });

  it("produces byte-identical shared-edge positions from canonical directions", () => {
    const shared = direction(45, 20);
    const left = target(1);
    const right = target(1);
    updateTemporalCubeTile(
      field([shared]), fallbackSurface, temporal(0.35), environment, "seafloor", 12,
      constantResolver(), left,
    );
    updateTemporalCubeTile(
      field([shared]), fallbackSurface, temporal(0.35), environment, "seafloor", 12,
      constantResolver(), right,
    );
    expect(right.positions).toEqual(left.positions);
  });

  it("retains the nearest native vertex and material where ownership is unknown", () => {
    const fields = field([direction(0, 0)], 850);
    const output = target(1);
    const native = controls(850);
    const result = updateTemporalCubeTile(
      fields, fallbackSurface, temporal(0.49, 2.45, native, controls(-900)), environment, "surface", 4,
      { resolveAt: () => null }, output,
    );
    expect(result.fallbackVertices).toBe(1);
    expect(Math.hypot(...output.positions)).toBeCloseTo(1 + 850 * 4 / 6_371_000, 7);
    expect(output.colors.every(Number.isFinite)).toBe(true);
  });

  it("adapts renderer axes to the GPlates coordinate convention", () => {
    let received: readonly [number, number, number] | undefined;
    const output = target(1);
    updateTemporalCubeTile(
      field([direction(90, 0)]),
      fallbackSurface,
      temporal(0.5),
      environment,
      "surface",
      1,
      {
        resolveAt(value) {
          received = value;
          return null;
        },
      },
      output,
    );
    expect(received?.[0]).toBeCloseTo(0, 7);
    expect(received?.[1]).toBeCloseTo(1, 7);
    expect(received?.[2]).toBeCloseTo(0, 7);
  });

  it("keeps registered UVs tied to the texture's declared native age", () => {
    const samples = field([direction(10, 0)]);
    const uvs = new Float32Array(2);
    updateTemporalCubeTile(
      samples,
      fallbackSurface,
      temporal(0.9, 4.5),
      environment,
      "surface",
      1,
      constantResolver(),
      { ...target(1), uvs, textureSourceAgeMa: 0 },
    );
    expect(uvs[0]).toBeCloseTo(0.5, 7);
    expect(uvs[1]).toBeCloseTo(0.5, 7);
  });

  it("keeps source-conditioned shading fixed to one material through a source switch and exact knot", () => {
    const samples = field([direction(10, 0)]);
    const youngerSourceUvs = new Float32Array(2);
    const olderSourceUvs = new Float32Array(2);
    const youngerShading = new Float32Array(3);
    const olderShading = new Float32Array(3);
    const exactShading = new Float32Array(3);
    const youngerPositions = new Float32Array(3);
    const olderPositions = new Float32Array(3);
    const exactPositions = new Float32Array(3);
    const youngerControls = movingRuggedControls(0);
    const olderControls = movingRuggedControls(20);
    const resolver: Pick<PaleomapIntervalResolver, "resolveAt"> = {
      resolveAt: () => ({
        fragmentId: "tracked-material",
        plateId: 1,
        referenceDirection: lonLatToPeriodDirection([0, 0]),
        youngerDirection: lonLatToPeriodDirection([0, 0]),
        olderDirection: lonLatToPeriodDirection([20, 0]),
      }),
    };
    updateTemporalCubeTile(
      samples,
      fallbackSurface,
      temporal(0.49, 2.45, youngerControls, olderControls),
      environment,
      "surface",
      1,
      resolver,
      {
        positions: youngerPositions,
        shadingPositions: youngerShading,
        colors: new Float32Array(3),
        uvs: youngerSourceUvs,
        textureSourceAgeMa: 0,
      },
    );
    updateTemporalCubeTile(
      samples,
      fallbackSurface,
      temporal(0.51, 2.55, youngerControls, olderControls),
      environment,
      "surface",
      1,
      resolver,
      {
        positions: olderPositions,
        shadingPositions: olderShading,
        colors: new Float32Array(3),
        uvs: olderSourceUvs,
        textureSourceAgeMa: 5,
      },
    );
    updateTemporalCubeTile(
      samples,
      fallbackSurface,
      temporal(1, 5, youngerControls, olderControls),
      environment,
      "surface",
      1,
      resolver,
      {
        positions: exactPositions,
        shadingPositions: exactShading,
        colors: new Float32Array(3),
        uvs: new Float32Array(2),
        textureSourceAgeMa: 5,
      },
    );
    const shadingDeltaMetres = (shading: Float32Array, positions: Float32Array) =>
      (Math.hypot(...shading) - Math.hypot(...positions)) * 6_371_000;
    expect(youngerSourceUvs[0]).toBeCloseTo(0.5, 7);
    expect(olderSourceUvs[0]).toBeCloseTo((20 + 180) / 360, 7);
    const beforeSwitch = shadingDeltaMetres(youngerShading, youngerPositions);
    const afterSwitch = shadingDeltaMetres(olderShading, olderPositions);
    const atExactKnot = shadingDeltaMetres(exactShading, exactPositions);
    expect(beforeSwitch).toBeGreaterThan(1);
    expect(afterSwitch).toBeCloseTo(beforeSwitch, 4);
    expect(atExactKnot).toBeCloseTo(beforeSwitch, 4);
  });

  it("bounds the derived ruggedness cache to the two immutable endpoint controls", () => {
    const sizedControls = (width: number): ProceduralControls => ({
      width,
      height: 2,
      elevation: new Float32Array(width * 2).map((_, index) => index * 500),
    });
    const output = target(1);
    for (const width of [2, 3, 4]) {
      const endpoint = sizedControls(width);
      updateTemporalCubeTile(
        field([direction(0, 0)]),
        fallbackSurface,
        temporal(0, 0, endpoint, endpoint),
        environment,
        "surface",
        1,
        constantResolver(),
        output,
      );
    }
    expect(temporalRuggednessCacheBytes()).toBe(3 * 2 + 4 * 2);
  });

  it("unwraps repeated global UVs without changing their sampled longitude", () => {
    const uvs = Float32Array.from([
      0.98, 0.5, 0.01, 0.5,
      0.97, 0.6, 0.02, 0.6,
    ]);
    unwrapTemporalTileUvs(1, uvs);
    expect(uvs[2]).toBeCloseTo(1.01, 7);
    expect(uvs[6]).toBeCloseTo(1.02, 7);
  });

  it("normalizes conflicting pole source longitudes to one median height", () => {
    const poleControls = movingPeakControls(0, 4_000);
    for (let x = 0; x < poleControls.width; x += 1) {
      poleControls.elevation[x] = x < 180 ? -1_000 : 3_000;
    }
    const a = sampleTemporalControlHeight(poleControls, [-170, 90]);
    const b = sampleTemporalControlHeight(poleControls, [80, 90]);
    expect(a).toBe(1_000);
    expect(b).toBe(a);
  });

  it("keeps cold high-latitude mountains ice-colored instead of vegetation green", () => {
    const mountain = controls(4_000);
    const state = temporal(0.5, 2.5, mountain, mountain);
    const resolver: Pick<PaleomapIntervalResolver, "resolveAt"> = {
      resolveAt(value) {
        return {
          fragmentId: "cold-orogen",
          plateId: 1,
          referenceDirection: value,
          youngerDirection: value,
          olderDirection: value,
        };
      },
    };
    const output = target(2);
    updateTemporalCubeTile(
      field([direction(0, 0), direction(0, 75)]),
      fallbackSurface,
      state,
      { ...environment, iceLatitude: 65, iceIntensity: 1 },
      "surface",
      1,
      resolver,
      output,
    );
    const equator = output.colors.subarray(0, 3);
    const polar = output.colors.subarray(3, 6);
    expect(polar[2]).toBeGreaterThan(equator[2]);
    expect(Math.max(...polar) - Math.min(...polar)).toBeLessThan(0.12);
  });

  it("uses the regional material profile without changing sourced physical height", () => {
    const rugged = movingRuggedControls(0);
    const state = temporal(0, 0, rugged, rugged);
    const samples = field([direction(0, 0)], 2_000);
    const coarse = {
      ...target(1),
      shadingPositions: new Float32Array(3),
    };
    const regional = {
      ...target(1),
      shadingPositions: new Float32Array(3),
    };
    updateTemporalCubeTile(
      samples, fallbackSurface, state, environment, "surface", 18,
      constantResolver(), coarse, "coarse",
    );
    updateTemporalCubeTile(
      samples, fallbackSurface, state, environment, "surface", 18,
      constantResolver(), regional, "regional",
    );
    expect([...regional.positions]).toEqual([...coarse.positions]);
    expect(Math.hypot(...regional.shadingPositions))
      .not.toBeCloseTo(Math.hypot(...coarse.shadingPositions), 7);
  });

  it("switches both unknown height and material to the nearest native endpoint", () => {
    const fallback = {
      ...fallbackSurface,
      albedo: new Uint8Array([25, 50, 200, 255]),
      reliefMetres: new Float32Array([-750]),
      reliefBiasMetres: -9_000,
      reliefRangeMetres: 18_000,
    };
    const output = target(1);
    updateTemporalCubeTile(
      field([direction(0, 0)], 4_000),
      fallback,
      temporal(0.51, 2.55, controls(4_000), controls(-750)),
      environment,
      "seafloor",
      2,
      { resolveAt: () => null },
      output,
    );
    expect(Math.hypot(...output.positions)).toBeCloseTo(1 - 1_500 / 6_371_000, 7);
    expect(output.colors.every(Number.isFinite)).toBe(true);
  });
});
