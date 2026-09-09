import { describe, expect, it } from "vitest";
import {
  reliefHorizonExtensionRadians,
  updateCubeDisplayGeometry,
} from "./cubeRelief";

describe("cube display relief", () => {
  it("extends conservative horizon coverage for exaggerated grazing relief", () => {
    expect(reliefHorizonExtensionRadians(3.68, 0)).toBe(0);
    const tenKilometresAtThirtyX = (10_000 * 30) / 6_371_000;
    const extension = reliefHorizonExtensionRadians(1.4, tenKilometresAtThirtyX);
    expect(extension).toBeGreaterThan(0.2);
    expect(extension).toBeLessThan(0.4);
    expect(Number.isFinite(reliefHorizonExtensionRadians(1.0001, 0.05))).toBe(true);
  });

  it("never mutates cached physical fields or compounds repeated exaggeration", () => {
    const directions = Float32Array.from([1, 0, 0, 0, 1, 0]);
    const heights = Float32Array.from([4_000, 2_000]);
    const physicalNormals = Float32Array.from([0.99875, 0.04998, 0, 0.03, 0.99955, 0]);
    const originalDirections = directions.slice();
    const originalHeights = heights.slice();
    const originalNormals = physicalNormals.slice();
    const positions = new Float32Array(directions.length);
    const normals = new Float32Array(directions.length);

    updateCubeDisplayGeometry(directions, heights, physicalNormals, 1, positions, normals);
    const firstOneXPositions = positions.slice();
    const firstOneXNormals = normals.slice();
    updateCubeDisplayGeometry(directions, heights, physicalNormals, 8, positions, normals);
    updateCubeDisplayGeometry(directions, heights, physicalNormals, 30, positions, normals);
    updateCubeDisplayGeometry(directions, heights, physicalNormals, 1, positions, normals);

    expect(positions).toEqual(firstOneXPositions);
    expect(normals).toEqual(firstOneXNormals);
    expect(directions).toEqual(originalDirections);
    expect(heights).toEqual(originalHeights);
    expect(physicalNormals).toEqual(originalNormals);

    const reusedPositions = new Float32Array(directions.length);
    const reusedNormals = new Float32Array(directions.length);
    updateCubeDisplayGeometry(
      directions,
      heights,
      physicalNormals,
      1,
      reusedPositions,
      reusedNormals,
    );
    expect(reusedPositions).toEqual(firstOneXPositions);
    expect(reusedNormals).toEqual(firstOneXNormals);
  });
});
