import { describe, expect, it } from "vitest";
import { evaluateClimatePotential } from "./evaluate";
import type { ClimateGeographyInput, ClimatePotentialControls } from "./types";

const evidence = {
  sourceIds: ["noaa-global-circulation", "roe-orographic-precipitation-2005", "rolland-lapse-2003"],
  methodId: "schematic-geographic-climate-v1" as const,
  methodVersion: 1 as const,
  status: "procedural-synthesis" as const,
  limitations: ["Directional potential, not a palaeoclimate simulation."],
};

function controls(zonal: -1 | 1 = 1, biology = true): ClimatePotentialControls {
  return {
    globalMeanTemperatureC: 18,
    equatorToPoleTemperatureC: 35,
    lapseRateCPerKm: 6,
    windBands: [{ minimumLatitude: -90, maximumLatitude: 90, zonal, meridional: 0 }],
    maximumUpwindSteps: 6,
    landDryingPerStep: 0.08,
    orographicMoistureLossPerKm: 0.2,
    snowTemperatureThresholdC: 0,
    landBiologyEligible: biology,
    biologyCapacity: 0.8,
    maximumCells: 360 * 181,
    maximumOutputBytes: 360 * 181 * 17,
    evidence,
  };
}

function geography(width = 8, height = 5): ClimateGeographyInput {
  return {
    revisionIdentity: "prepared@1",
    requestedAgeMa: 0,
    width,
    height,
    surface: new Uint8Array(width * height).fill(2),
    elevationMetres: new Float32Array(width * height),
  };
}

describe("bounded geographic climate potential", () => {
  it("reverses an orographic rain shadow with the prevailing wind", () => {
    const input = geography();
    const row = 2;
    input.surface[row * 8] = 1;
    input.surface[row * 8 + 7] = 1;
    input.elevationMetres[row * 8 + 3] = 3_000;
    const eastward = evaluateClimatePotential(input, controls(1));
    const westward = evaluateClimatePotential(input, controls(-1));
    expect(eastward.moisturePotential[row * 8 + 4]).toBeLessThan(westward.moisturePotential[row * 8 + 4]);
  });

  it("dries from coast to interior and wraps continuously across the date line", () => {
    const input = geography();
    const row = 2;
    input.surface[row * 8 + 7] = 1;
    const field = evaluateClimatePotential(input, controls(1));
    expect(field.moisturePotential[row * 8]).toBe(1);
    expect(field.moisturePotential[row * 8 + 3]).toBeLessThan(field.moisturePotential[row * 8 + 1]);
  });

  it("uses geographic latitude and elevation for temperature and snow", () => {
    const input = geography();
    input.surface[2 * 8] = 1;
    input.surface.fill(1, 0, 8);
    input.elevationMetres[2 * 8 + 2] = 6_000;
    const field = evaluateClimatePotential(input, controls());
    expect(field.temperatureC[0]).toBeLessThan(field.temperatureC[2 * 8]);
    expect(field.snowPotential[2 * 8 + 2]).toBeGreaterThan(0);
    for (let column = 1; column < 8; column += 1) expect(field.temperatureC[column]).toBe(field.temperatureC[0]);
  });

  it("preserves the declared spherical global mean on a uniform sea-level globe", () => {
    const input = geography(360, 181);
    input.surface.fill(1);
    const field = evaluateClimatePotential(input, controls());
    let weightedTemperature = 0;
    let weights = 0;
    for (let row = 0; row < input.height; row += 1) {
      const latitude = 90 - row * 180 / (input.height - 1);
      const weight = Math.cos(latitude * Math.PI / 180);
      weightedTemperature += field.temperatureC[row * input.width]! * weight;
      weights += weight;
    }
    expect(weightedTemperature / weights).toBeCloseTo(18, 2);
  });

  it("publishes one canonical pole state despite asymmetric near-pole upwind geography", () => {
    const input = geography();
    input.surface[8] = 1;
    input.surface[9] = 0;
    const poleControls = {
      ...controls(),
      windBands: [{ minimumLatitude: -90, maximumLatitude: 90, zonal: 0 as const, meridional: 1 as const }],
    };
    const field = evaluateClimatePotential(input, poleControls);
    for (let column = 1; column < input.width; column += 1) {
      expect(field.status[column]).toBe(field.status[0]);
      expect(field.moisturePotential[column]).toBe(field.moisturePotential[0]);
    }
    input.surface[1] = 1;
    expect(() => evaluateClimatePotential(input, poleControls)).toThrow(/pole rows/);
  });

  it("propagates unknown upwind geography instead of treating crust as land or sea", () => {
    const input = geography();
    const row = 2;
    input.surface[row * 8 + 7] = 0;
    const field = evaluateClimatePotential(input, controls());
    expect(field.status[row * 8]).toBe(0);
    expect(Number.isNaN(field.moisturePotential[row * 8])).toBe(true);
  });

  it("keeps equal field capacity at 0 and 450 Ma while excluding unsupported early land biology", () => {
    const modernInput = geography();
    modernInput.surface[2 * 8 + 7] = 1;
    const ancientInput = { ...modernInput, revisionIdentity: "prepared@450", requestedAgeMa: 450 };
    const modern = evaluateClimatePotential(modernInput, controls(1, true));
    const ancient = evaluateClimatePotential(ancientInput, controls(1, false));
    expect(ancient.byteLength).toBe(modern.byteLength);
    expect(ancient.biologyPotential.every((value) => value === 0 || Number.isNaN(value))).toBe(true);
    expect(modern.biologyPotential.some((value) => value > 0)).toBe(true);
  });

  it("rejects stale/canceled work and allocation caps before field creation", () => {
    const input = geography();
    const controller = new AbortController();
    controller.abort();
    expect(() => evaluateClimatePotential(input, controls(), { signal: controller.signal })).toThrow(/canceled/);
    expect(() => evaluateClimatePotential(input, controls(), { isCurrentRevision: () => false })).toThrow(/stale/);
    expect(() => evaluateClimatePotential(input, { ...controls(), maximumOutputBytes: 1 })).toThrow(/allocation/);
    let checks = 0;
    expect(() => evaluateClimatePotential(input, controls(), { isCurrentRevision: () => ++checks < 3 })).toThrow(/stale/);
  });

  it("rejects invalid surface and budget metadata and snapshots evidence identity", () => {
    const input = geography();
    input.surface[0] = 3;
    expect(() => evaluateClimatePotential(input, controls())).toThrow(/surface classification/);
    input.surface[0] = 2;
    expect(() => evaluateClimatePotential(input, { ...controls(), maximumCells: Number.NaN })).toThrow(/allocation/);
    expect(() => evaluateClimatePotential(input, { ...controls(), snowTemperatureThresholdC: Number.NaN })).toThrow(/controls/);

    const mutableEvidence = {
      ...evidence,
      sourceIds: [...evidence.sourceIds],
      limitations: [...evidence.limitations],
    };
    const field = evaluateClimatePotential(input, { ...controls(), evidence: mutableEvidence });
    mutableEvidence.sourceIds[0] = "mutated";
    expect(field.evidence.sourceIds[0]).toBe("noaa-global-circulation");
    expect(Object.isFrozen(field.evidence.sourceIds)).toBe(true);
  });
});
