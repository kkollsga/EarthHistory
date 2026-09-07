import { describe, expect, it } from "vitest";
import type { ModernClimateGroup, SurfaceStage } from "../data";
import {
  createPerceptualDetailSampler,
  PERCEPTUAL_DETAIL_TABLE_BYTE_LIMIT,
  type PerceptualDetailInput,
  type PerceptualDetailSample,
} from "./perceptualDetail";

const base: PerceptualDetailInput = {
  longitude: 86,
  latitude: 28,
  elevationMetres: 4200,
  slope: 0.72,
  land: true,
  ice: 0,
  climateGroup: "temperate",
  stage: "modern-biomes",
  tectonicInfluence: 0.8,
  detail: "regional",
};

function copy(sample: PerceptualDetailSample): PerceptualDetailSample {
  return {
    heightDeltaMetres: sample.heightDeltaMetres,
    albedoMultiplier: [...sample.albedoMultiplier],
    roughnessDelta: sample.roughnessDelta,
  };
}

function meanAbsoluteHeight(overrides: Partial<PerceptualDetailInput>): number {
  const sampler = createPerceptualDetailSampler("attenuation-fixture");
  let total = 0;
  let count = 0;
  for (let latitude = -70; latitude <= 70; latitude += 10) {
    for (let longitude = -170; longitude <= 170; longitude += 10) {
      total += Math.abs(sampler.sample({ ...base, longitude, latitude, ...overrides }).heightDeltaMetres);
      count += 1;
    }
  }
  return total / count;
}

describe("perceptual detail", () => {
  it("is deterministic by geographic coordinate and seed", () => {
    const first = createPerceptualDetailSampler("present__paleodem-0ma");
    const second = createPerceptualDetailSampler("present__paleodem-0ma");
    const other = createPerceptualDetailSampler("different-seed");
    const expected = copy(first.sample(base));
    expect(copy(first.sample(base))).toEqual(expected);
    expect(copy(second.sample(base))).toEqual(expected);
    expect(copy(other.sample(base))).not.toEqual(expected);
  });

  it("reuses one output view instead of allocating per sample", () => {
    const sampler = createPerceptualDetailSampler("allocation-fixture");
    const first = sampler.sample(base);
    const albedo = first.albedoMultiplier;
    const second = sampler.sample({ ...base, longitude: 12 });
    expect(second).toBe(first);
    expect(second.albedoMultiplier).toBe(albedo);
  });

  it("is continuous across the antimeridian", () => {
    const sampler = createPerceptualDetailSampler("seam-fixture");
    const west = copy(sampler.sample({ ...base, longitude: -180 }));
    const east = copy(sampler.sample({ ...base, longitude: 180 }));
    expect(east.heightDeltaMetres).toBeCloseTo(west.heightDeltaMetres, 10);
    expect(east.roughnessDelta).toBeCloseTo(west.roughnessDelta, 10);
    east.albedoMultiplier.forEach((value, index) => {
      expect(value).toBeCloseTo(west.albedoMultiplier[index], 10);
    });

    const nearWest = copy(sampler.sample({ ...base, longitude: -179.999 }));
    const nearEast = copy(sampler.sample({ ...base, longitude: 179.999 }));
    expect(Math.abs(nearEast.heightDeltaMetres - nearWest.heightDeltaMetres)).toBeLessThan(2);
  });

  it("honors height, color, roughness, and retained-state bounds", () => {
    const sampler = createPerceptualDetailSampler("bounds-fixture");
    const groups: Array<ModernClimateGroup | undefined> = [
      undefined, "ocean", "tropical-rainforest", "tropical-seasonal", "desert",
      "steppe", "temperate", "cold-forest", "tundra", "frost",
    ];
    const stages: SurfaceStage[] = [
      "accretion", "giant-impact", "magma-ocean", "cooling-crust", "growing-oceans",
      "microbial-world", "barren-continents", "early-land-plants", "forest-world",
      "flowering-plants", "modern-biomes",
    ];
    for (let index = 0; index < 4000; index += 1) {
      const detail = index % 2 === 0 ? "coarse" : "regional";
      const limit = detail === "coarse" ? 100 : 250;
      const sample = sampler.sample({
        longitude: (index * 137.508) % 360 - 180,
        latitude: ((index * 61.803) % 180) - 90,
        elevationMetres: (index % 19) * 700 - 6000,
        slope: (index % 13) / 12,
        land: index % 5 !== 0,
        ice: (index % 11) / 10,
        climateGroup: groups[index % groups.length],
        stage: stages[index % stages.length],
        tectonicInfluence: (index % 17) / 16,
        detail,
      });
      expect(sample.heightDeltaMetres).toBeGreaterThanOrEqual(-limit);
      expect(sample.heightDeltaMetres).toBeLessThanOrEqual(limit);
      sample.albedoMultiplier.forEach((value) => {
        expect(value).toBeGreaterThanOrEqual(0.78);
        expect(value).toBeLessThanOrEqual(1.18);
      });
      expect(sample.roughnessDelta).toBeGreaterThanOrEqual(-0.12);
      expect(sample.roughnessDelta).toBeLessThanOrEqual(0.12);
    }
    expect(sampler.retainedTableBytes).toBeLessThanOrEqual(PERCEPTUAL_DETAIL_TABLE_BYTE_LIMIT);
  });

  it("attenuates height over ocean and ice", () => {
    const ruggedLand = meanAbsoluteHeight({ land: true, ice: 0, climateGroup: "temperate" });
    const ice = meanAbsoluteHeight({ land: true, ice: 1, climateGroup: "frost" });
    const ocean = meanAbsoluteHeight({ land: false, ice: 0, climateGroup: "ocean", elevationMetres: -3500 });
    expect(ice).toBeLessThan(ruggedLand * 0.12);
    expect(ocean).toBeLessThan(ruggedLand * 0.08);
  });

  it("adds stronger detail regionally than at coarse scale", () => {
    const coarse = meanAbsoluteHeight({ detail: "coarse" });
    const regional = meanAbsoluteHeight({ detail: "regional" });
    expect(regional).toBeGreaterThan(coarse * 1.8);
  });
});
