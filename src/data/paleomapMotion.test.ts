import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPaleomapDirectionFromAgeResolver,
  createPaleomapIntervalResolver,
  createPaleomapPlateRotationEvaluator,
  decodePaleomapMotionCatalog,
  type QuaternionWxyz,
  type UnitDirection,
} from "./paleomapMotion";

const catalogPath = resolve("public/data/paleomap-motion-v1.json");
const catalogBytes = readFileSync(catalogPath);
const catalog = decodePaleomapMotionCatalog(JSON.parse(catalogBytes.toString("utf8")));
const oracle = JSON.parse(readFileSync(resolve("src/data/fixtures/paleomap-motion-probes-v1.json"), "utf8")) as {
  catalogSha256: string;
  rotationProbes: Array<{ plateId: number; ageMa: number; quaternionWxyz: QuaternionWxyz }>;
  missingRotationProbes: Array<{ plateId: number; ageMa: number }>;
  spatialProbes: Array<{
    ageMa: number;
    longitude: number;
    latitude: number;
    plateId?: number;
    sourceFeatureId?: string;
  }>;
};

function lonLatDirection(longitude: number, latitude: number): UnitDirection {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

function equivalentQuaternion(left: QuaternionWxyz, right: QuaternionWxyz): boolean {
  const cosine = Math.abs(left.reduce((sum, value, index) => sum + value * right[index]!, 0));
  return cosine > 1 - 1e-10;
}

describe("PALEOMAP rigid material motion", () => {
  it("decodes the deterministic v2d3-compatible source inventory", () => {
    expect(createHash("sha256").update(catalogBytes).digest("hex")).toBe(oracle.catalogSha256);
    expect(catalog.sourceCounts).toMatchObject({
      features: 471,
      polygonFragments: 503,
      coordinatePairs: 26_374,
      excludedGeometries: 2,
      rotationSequences: 317,
    });
    expect(catalog.paleoDemCompatibility.supportedSourceAgesMa).toHaveLength(109);
    expect(Object.keys(catalog.poiPlateIds)).toHaveLength(8);
    expect(catalog.coverage.classification).toBe("partial-material-coverage-at-nonzero-ages");
  });

  it("matches pyGPlates equivalent rotations at source knots, fractional ages, and circuit boundaries", () => {
    const evaluate = createPaleomapPlateRotationEvaluator(catalog);
    for (const probe of oracle.rotationProbes) {
      const actual = evaluate(probe.plateId, probe.ageMa);
      expect(actual, `plate ${probe.plateId} at ${probe.ageMa} Ma`).not.toBeNull();
      expect(equivalentQuaternion(actual!, probe.quaternionWxyz), `plate ${probe.plateId} at ${probe.ageMa} Ma`).toBe(true);
    }
    for (const probe of oracle.missingRotationProbes) {
      expect(evaluate(probe.plateId, probe.ageMa), `missing plate ${probe.plateId} at ${probe.ageMa} Ma`).toBeNull();
    }
  });

  it("bounds fractional-age rotation caches and validates exact-age circuits", () => {
    const evaluate = createPaleomapPlateRotationEvaluator(catalog);
    for (let index = 0; index < 20; index += 1) evaluate(101, index + 0.125);
    expect(evaluate.cachedAgeCount).toBe(evaluate.cacheAgeLimit);
    expect(evaluate.cacheAgeLimit).toBe(4);

    const resolveDirection = createPaleomapDirectionFromAgeResolver(catalog);
    expect(resolveDirection(999_999, [1, 0, 0], 100, 100)).toBeNull();
    expect(resolveDirection(101, [1, 0, 0], 100, 100)).toEqual([1, 0, 0]);
  });

  it("matches pyGPlates partition ownership on deterministic non-boundary probes", () => {
    for (const ageMa of [0, 5, 100, 250, 400, 540]) {
      const resolver = createPaleomapIntervalResolver(catalog, ageMa, ageMa, ageMa);
      for (const probe of oracle.spatialProbes.filter((candidate) => candidate.ageMa === ageMa)) {
        const actual = resolver.resolveAt(lonLatDirection(probe.longitude, probe.latitude));
        if (probe.plateId === undefined) {
          expect(actual, `${probe.longitude},${probe.latitude} at ${ageMa} Ma`).toBeNull();
        } else {
          expect(actual?.plateId, `${probe.longitude},${probe.latitude} at ${ageMa} Ma`).toBe(probe.plateId);
          expect(actual?.fragmentId.startsWith(`${probe.sourceFeatureId}:`)).toBe(true);
        }
      }
    }
  });

});
