import { describe, expect, it } from "vitest";
import { harmonizeTemporalTileNormals } from "./temporalNormals";

const noCoarseEdges = { north: false, east: false, south: false, west: false };

describe("temporal shading normal seams", () => {
  it("publishes one normal for a coincident edge direction", () => {
    const directions = Float32Array.from([
      1, 0, 0, 0.7, 0.7, 0,
      0.7, 0, 0.7, 0.5, 0.5, 0.7,
    ]);
    const left = Float32Array.from([
      1, 0, 0, 0, 1, 0,
      0, 0, 1, 0.5, 0.5, 0.7,
    ]);
    const right = left.slice();
    right[0] = 0;
    right[1] = 1;
    harmonizeTemporalTileNormals([
      { directions, normals: left, meshSegments: 1, coarseEdges: noCoarseEdges },
      { directions, normals: right, meshSegments: 1, coarseEdges: noCoarseEdges },
    ]);
    expect(Array.from(left.subarray(0, 3))).toEqual(Array.from(right.subarray(0, 3)));
    expect(Math.hypot(...left.subarray(0, 3))).toBeCloseTo(1, 6);
  });

  it("interpolates an odd fine-edge normal from its matched even vertices", () => {
    const normals = Float32Array.from([
      1, 0, 0, 0, 0, 1, 0, 1, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0,
      0, 1, 0, 0, 1, 0, 0, 1, 0,
    ]);
    const directions = Float32Array.from(normals);
    harmonizeTemporalTileNormals([{
      directions,
      normals,
      meshSegments: 2,
      coarseEdges: { ...noCoarseEdges, north: true },
    }]);
    expect(normals[3]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(normals[4]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(normals[5]).toBeCloseTo(0, 6);
  });
});
