import { describe, expect, it } from "vitest";
import { boundsContainPoint, computeSweptBounds } from "./bounds";

describe("computeSweptBounds", () => {
  it("contains an intermediate arc and the full 30x height/detail envelope", () => {
    const bounds = computeSweptBounds([
      { direction: [Math.SQRT1_2, -Math.SQRT1_2, 0], heightMetres: 0 },
      { direction: [1, 0, 0], heightMetres: 8_000 },
      { direction: [Math.SQRT1_2, Math.SQRT1_2, 0], heightMetres: 0 },
    ], {
      angularEnvelopeRadians: 0.00001,
      minimumHeightMetres: -11_000,
      maximumHeightMetres: 8_000,
      maximumVerticalExaggeration: 30,
      maximumProceduralDisplacementMetres: 300,
      planetRadiusMetres: 6_371_000,
    });

    const mountainRadius = 6_371_000 + 8_000 * 30;
    const intermediateMountain = [mountainRadius, 0, 0] as const;
    expect(boundsContainPoint(bounds, intermediateMountain)).toBe(true);

    const endpointOnly = computeSweptBounds([
      { direction: [Math.SQRT1_2, -Math.SQRT1_2, 0], heightMetres: 0 },
      { direction: [Math.SQRT1_2, Math.SQRT1_2, 0], heightMetres: 0 },
    ], {
      angularEnvelopeRadians: 0,
      minimumHeightMetres: 0,
      maximumHeightMetres: 0,
      maximumVerticalExaggeration: 30,
      maximumProceduralDisplacementMetres: 0,
      planetRadiusMetres: 6_371_000,
    });
    expect(boundsContainPoint(endpointOnly, intermediateMountain)).toBe(false);
  });

  it("rejects incomplete or unbounded inputs", () => {
    expect(() => computeSweptBounds([
      { direction: [1, 0, 0], heightMetres: 0 },
    ], {
      angularEnvelopeRadians: 0,
      minimumHeightMetres: 0,
      maximumHeightMetres: 0,
      maximumVerticalExaggeration: 30,
      maximumProceduralDisplacementMetres: 0,
      planetRadiusMetres: 6_371_000,
    })).toThrow(/endpoints/);
  });

  it("contains antipodal angular envelopes and both 1x and 30x radial extrema", () => {
    const positive = computeSweptBounds([
      { direction: [1, 0, 0], heightMetres: 1_000 },
      { direction: [1, 0, 0], heightMetres: 2_000 },
    ], {
      angularEnvelopeRadians: Math.PI,
      minimumHeightMetres: 1_000,
      maximumHeightMetres: 2_000,
      maximumVerticalExaggeration: 30,
      maximumProceduralDisplacementMetres: 0,
      planetRadiusMetres: 6_371_000,
    });
    expect(boundsContainPoint(positive, [-(6_371_000 + 1_000), 0, 0])).toBe(true);
    expect(boundsContainPoint(positive, [6_371_000 + 60_000, 0, 0])).toBe(true);

    const negative = computeSweptBounds([
      { direction: [1, 0, 0], heightMetres: -2_000 },
      { direction: [1, 0, 0], heightMetres: -1_000 },
    ], {
      angularEnvelopeRadians: 0,
      minimumHeightMetres: -2_000,
      maximumHeightMetres: -1_000,
      maximumVerticalExaggeration: 30,
      maximumProceduralDisplacementMetres: 0,
      planetRadiusMetres: 6_371_000,
    });
    expect(boundsContainPoint(negative, [6_371_000 - 60_000, 0, 0])).toBe(true);
    expect(boundsContainPoint(negative, [6_371_000 - 1_000, 0, 0])).toBe(true);
  });
});
