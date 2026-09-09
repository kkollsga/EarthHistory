import { describe, expect, it } from "vitest";
import type { ModernReliefPatch, WorldSnapshot } from "../data";
import { generateRegionalPatch } from "./regionalPatch";

function controlledSnapshot(): WorldSnapshot {
  const width = 36;
  const height = 19;
  return {
    id: "regional-test",
    label: "Regional test",
    ageMa: 0,
    period: "test",
    eon: "test",
    description: "test",
    evidence: "synthesis",
    sourceIds: [],
    land: [],
    countries: [],
    tectonics: [
      {
        id: "range",
        name: "range",
        type: "mountain",
        coordinates: [[-12, -4], [12, 4]],
        widthKm: 120,
        heightKm: 2,
        sourceIds: [],
      },
    ],
    poiIds: [],
    environment: { iceLatitude: 70, vegetation: 0.7, iceIntensity: 0.2 },
    caveat: "test",
    controls: {
      width,
      height,
      elevation: Float32Array.from({ length: width * height }, (_, index) => {
        const x = index % width;
        const y = Math.floor(index / width);
        return 1_200 + 500 * Math.sin(x / 4) + 300 * Math.cos(y / 2);
      }),
      potentialIce: new Uint8Array(width * height),
    },
  };
}

describe("regional relief patch", () => {
  it("is deterministic, bounded, and fades its synthetic displacement at every edge", () => {
    const world = controlledSnapshot();
    const first = generateRegionalPatch(world, [0, 0], "surface", 25, 24);
    const second = generateRegionalPatch(world, [0, 0], "surface", 25, 24);
    expect(second.syntheticDetailMetres).toEqual(first.syntheticDetailMetres);
    expect(Math.max(...first.syntheticDetailMetres)).toBeLessThanOrEqual(250);
    expect(Math.min(...first.syntheticDetailMetres)).toBeGreaterThanOrEqual(-250);
    for (let index = 0; index < 25; index++) {
      expect(Math.abs(first.syntheticDetailMetres[index])).toBe(0);
      expect(Math.abs(first.syntheticDetailMetres[24 * 25 + index])).toBe(0);
      expect(Math.abs(first.syntheticDetailMetres[index * 25])).toBe(0);
      expect(Math.abs(first.syntheticDetailMetres[index * 25 + 24])).toBe(0);
    }
  });

  it("keeps overlapping geographic samples stable when the camera patch recenters", () => {
    const world = controlledSnapshot();
    const first = generateRegionalPatch(world, [0, 0], "surface", 25, 24);
    const shifted = generateRegionalPatch(world, [4, 0], "surface", 25, 24);
    for (let y = 3; y < 22; y++) {
      for (let x = 7; x < 22; x++) {
        const a = first.syntheticDetailMetres[y * 25 + x];
        const b = shifted.syntheticDetailMetres[y * 25 + x - 4];
        // Each patch removes its own sub-metre weighted mean; the geographic
        // ridge phase itself stays fixed as the camera quantizes to a new tile.
        expect(Math.abs(a - b)).toBeLessThan(1);
      }
    }
  });

  it("uses a registered modern relief tile in its interior and fades to the globe base", () => {
    const patch: ModernReliefPatch = {
      id: "registered-test",
      setId: "fixture",
      level: 0,
      childIds: [],
      priority: 10,
      bounds: [-12, -12, 12, 12],
      cellCenterBounds: [-9, -9, 9, 9],
      width: 4,
      height: 4,
      longitudeStep: 6,
      latitudeStep: 6,
      registration: "pixel-center",
      rowOrder: "north-to-south",
      units: "m",
      horizontalCrs: "EPSG:4326",
      referenceFrameId: "present-day-geographic",
      verticalDatum: "EGM2008",
      surfaceMode: "surface",
      domain: "topobathymetry",
      composition: "absolute-replace",
      evidence: "model-output",
      nativeResolutionMetres: 1_000,
      maxErrorMetres: 100,
      splitErrorPixels: 1.5,
      mergeErrorPixels: 1,
      edgeTransitionCells: 1,
      sourceProduct: "ETOPO_2022_v1_60s_surface",
      sourceVersion: "test",
      sourceIds: ["test"],
      assetPath: "test.json",
      validRequestedAgeMa: [0, 0],
      elevation: new Float32Array(16).fill(3_000),
      byteLength: 16 * Float32Array.BYTES_PER_ELEMENT,
    };
    const fields = generateRegionalPatch(
      controlledSnapshot(),
      [0, 0],
      "surface",
      25,
      24,
      patch,
    );
    const center = 12 * 25 + 12;
    expect(fields.sourcePatchId).toBe("registered-test");
    expect(fields.sourceBlendWeights[center]).toBeCloseTo(1);
    expect(fields.sourceHeightsMetres[center]).toBeCloseTo(3_000);
    expect(fields.sourceBlendWeights[0]).toBe(0);
    const insideWestFeather = 12 * 25 + 3;
    expect(fields.sourceBlendWeights[insideWestFeather]).toBeGreaterThan(0);
    expect(fields.sourceBlendWeights[insideWestFeather]).toBeLessThan(1);
  });
});
