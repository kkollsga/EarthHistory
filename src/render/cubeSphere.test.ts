import { describe, expect, it } from "vitest";
import {
  CUBE_FACES,
  createCubeTileGeometry,
  cubeFaceDirection,
  directionToCubeFaceUv,
} from "./cubeSphere";

function key(vector: readonly number[]): string {
  return vector.map((value) => value.toFixed(7)).join(",");
}

describe("cube-sphere geometry", () => {
  it("maps six face centres to the cardinal axes and round-trips directions", () => {
    const expected = [
      [1, 0, 0], [-1, 0, 0], [0, 1, 0],
      [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ];
    CUBE_FACES.forEach((face, index) => {
      cubeFaceDirection(face, 0, 0).forEach((value, axis) => {
        expect(value).toBeCloseTo(expected[index][axis], 12);
      });
    });
    const samples = [[0.2, 0.7, -0.4], [-0.8, 0.1, 0.3], [0.1, -0.6, -0.7]] as const;
    for (const sample of samples) {
      const faceUv = directionToCubeFaceUv(sample);
      const roundTrip = cubeFaceDirection(faceUv.face, faceUv.u, faceUv.v);
      const length = Math.hypot(...sample);
      roundTrip.forEach((value, index) => expect(value).toBeCloseTo(sample[index] / length, 7));
    }
  });

  it("shares all twelve cube edges and eight corners exactly between faces", () => {
    const occurrences = new Map<string, number>();
    for (const face of CUBE_FACES) {
      for (let step = 0; step <= 8; step++) {
        const t = -1 + (step / 8) * 2;
        for (const direction of [
          cubeFaceDirection(face, t, -1), cubeFaceDirection(face, t, 1),
          cubeFaceDirection(face, -1, t), cubeFaceDirection(face, 1, t),
        ]) {
          const id = key(direction);
          occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
        }
      }
    }
    const corners = [...occurrences.values()].filter((count) => count === 6);
    const edgeInteriors = [...occurrences.values()].filter((count) => count === 2);
    expect(corners).toHaveLength(8);
    expect(edgeInteriors).toHaveLength(12 * 7);
  });

  it("emits unit positions with outward, nondegenerate triangles on every face", () => {
    for (const face of CUBE_FACES) {
      const mesh = createCubeTileGeometry({ face, level: 0, x: 0, y: 0 }, 8);
      for (let index = 0; index < mesh.positions.length; index += 3) {
        expect(Math.hypot(mesh.positions[index], mesh.positions[index + 1], mesh.positions[index + 2])).toBeCloseTo(1, 6);
      }
      for (let index = 0; index < mesh.indices.length; index += 3) {
        const ia = mesh.indices[index] * 3;
        const ib = mesh.indices[index + 1] * 3;
        const ic = mesh.indices[index + 2] * 3;
        const ax = mesh.positions[ia], ay = mesh.positions[ia + 1], az = mesh.positions[ia + 2];
        const abx = mesh.positions[ib] - ax, aby = mesh.positions[ib + 1] - ay, abz = mesh.positions[ib + 2] - az;
        const acx = mesh.positions[ic] - ax, acy = mesh.positions[ic + 1] - ay, acz = mesh.positions[ic + 2] - az;
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        expect(Math.hypot(nx, ny, nz)).toBeGreaterThan(1e-7);
        expect(nx * ax + ny * ay + nz * az).toBeGreaterThan(0);
      }
    }
  });

  it("places coarse edge vertices exactly on every other fine neighbor sample", () => {
    const coarse = createCubeTileGeometry({ face: "px", level: 0, x: 0, y: 0 }, 8);
    const fine = createCubeTileGeometry({ face: "px", level: 0, x: 0, y: 0 }, 16);
    const coarseRow = 9;
    const fineRow = 17;
    for (let step = 0; step <= 8; step++) {
      const coarseIndex = (step * coarseRow + 8) * 3;
      const fineIndex = (step * 2 * fineRow + 16) * 3;
      for (let axis = 0; axis < 3; axis++) {
        expect(fine.positions[fineIndex + axis]).toBe(coarse.positions[coarseIndex + axis]);
      }
    }
  });
});
