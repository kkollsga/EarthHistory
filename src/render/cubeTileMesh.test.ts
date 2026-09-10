import { describe, expect, it } from "vitest";
import {
  CUBE_FACES,
  createCubeTileGeometry,
  cubeTileBounds,
  type CubeEdge,
  type CubeTileKey,
} from "./cubeSphere";
import type { CubeTileFields } from "./cubeTileFields";
import { cubeNeighbor } from "./cubeLod";
import { updateCubeDisplayGeometry } from "./cubeRelief";
import { createCubeTileMesh, updateCubeTileMeshGeometry } from "./cubeTileMesh";

const EDGES: readonly CubeEdge[] = ["north", "east", "south", "west"];

function edgeFlags(...enabled: CubeEdge[]): Record<CubeEdge, boolean> {
  return {
    north: enabled.includes("north"),
    east: enabled.includes("east"),
    south: enabled.includes("south"),
    west: enabled.includes("west"),
  };
}

function edgeVertex(segments: number, edge: CubeEdge, along: number): number {
  const row = segments + 1;
  switch (edge) {
    case "north": return along;
    case "east": return along * row + segments;
    case "south": return segments * row + along;
    case "west": return along * row;
  }
}

function fixture(key: CubeTileKey, segments = 32): CubeTileFields {
  const geometry = createCubeTileGeometry(key, segments);
  const vertexCount = geometry.directions.length / 3;
  const heightsMetres = new Float32Array(vertexCount);
  const normals = new Float32Array(geometry.directions.length);
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 3;
    const x = geometry.directions[offset];
    const y = geometry.directions[offset + 1];
    const z = geometry.directions[offset + 2];
    heightsMetres[index] = x * 3_000 + y * 1_700 - z * 900;
    const nx = x + y * 0.025;
    const ny = y - z * 0.018;
    const nz = z + x * 0.02;
    const inverseLength = 1 / Math.hypot(nx, ny, nz);
    normals[offset] = nx * inverseLength;
    normals[offset + 1] = ny * inverseLength;
    normals[offset + 2] = nz * inverseLength;
  }
  const positions = new Float32Array(geometry.positions.length);
  const physicalNormals = new Float32Array(normals.length);
  updateCubeDisplayGeometry(
    geometry.directions,
    heightsMetres,
    normals,
    1,
    positions,
    physicalNormals,
  );
  const textureSize = 128;
  const textureStride = textureSize + 2;
  const textureLength = textureStride * textureStride * 4;
  return {
    key,
    meshSegments: segments as 32 | 64,
    textureSize,
    textureStride,
    directions: geometry.directions,
    positions,
    normals,
    heightsMetres,
    localUvs: geometry.localUvs,
    indices: geometry.indices,
    albedo: new Uint8Array(textureLength),
    roughness: new Uint8Array(textureLength),
    detailHeight: new Uint8Array(textureLength),
    minHeightMetres: Math.min(...heightsMetres),
    maxHeightMetres: Math.max(...heightsMetres),
    generationMs: 0,
    byteLength: 0,
    sourcePatchIds: [],
  };
}

function expectedDisplay(fields: CubeTileFields, exaggeration: number) {
  const positions = new Float32Array(fields.directions.length);
  const normals = new Float32Array(fields.normals.length);
  updateCubeDisplayGeometry(
    fields.directions,
    fields.heightsMetres,
    fields.normals,
    exaggeration,
    positions,
    normals,
  );
  return { positions, normals };
}

function expectOutwardNondegenerate(
  positions: Float32Array,
  indices: Uint32Array,
): void {
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = indices[offset] * 3;
    const b = indices[offset + 1] * 3;
    const c = indices[offset + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const crossX = aby * acz - abz * acy;
    const crossY = abz * acx - abx * acz;
    const crossZ = abx * acy - aby * acx;
    const centerX = positions[a] + positions[b] + positions[c];
    const centerY = positions[a + 1] + positions[b + 1] + positions[c + 1];
    const centerZ = positions[a + 2] + positions[b + 2] + positions[c + 2];
    const signedArea = crossX * centerX + crossY * centerY + crossZ * centerZ;
    expect(signedArea).toBeGreaterThan(1e-10);
  }
}

function directionKey(field: Float32Array, vertex: number): string {
  const offset = vertex * 3;
  return `${field[offset].toFixed(7)}:${field[offset + 1].toFixed(7)}:${field[offset + 2].toFixed(7)}`;
}

describe("cube tile adaptive mesh", () => {
  it("copies base topology and exact scaled geometry when no edge is coarse", () => {
    const fields = fixture({ face: "px", level: 1, x: 0, y: 1 });
    const original = {
      directions: fields.directions.slice(),
      positions: fields.positions.slice(),
      normals: fields.normals.slice(),
      uvs: fields.localUvs.slice(),
      indices: fields.indices.slice(),
      heights: fields.heightsMetres.slice(),
    };
    const expected = expectedDisplay(fields, 8);
    const mesh = createCubeTileMesh(fields, 8, edgeFlags());
    expect(mesh.positions).toEqual(expected.positions);
    expect(mesh.normals).toEqual(expected.normals);
    expect(mesh.uvs).toEqual(fields.localUvs);
    expect(mesh.indices).toEqual(fields.indices);
    expect(mesh.stitchedEdges).toEqual([]);
    expect(mesh.byteLength).toBe(
      mesh.positions.byteLength + mesh.normals.byteLength +
      mesh.uvs.byteLength + mesh.indices.byteLength,
    );
    expect(mesh.positions).not.toBe(fields.positions);
    expect(mesh.normals).not.toBe(fields.normals);
    expect(mesh.uvs).not.toBe(fields.localUvs);
    expect(mesh.indices).not.toBe(fields.indices);
    expect(fields.directions).toEqual(original.directions);
    expect(fields.positions).toEqual(original.positions);
    expect(fields.normals).toEqual(original.normals);
    expect(fields.localUvs).toEqual(original.uvs);
    expect(fields.indices).toEqual(original.indices);
    expect(fields.heightsMetres).toEqual(original.heights);
    expectOutwardNondegenerate(mesh.positions, mesh.indices);
  });

  it("stitches each N/N+1 edge to exact even-vertex chords", () => {
    const fields = fixture({ face: "pz", level: 2, x: 1, y: 2 });
    const base = expectedDisplay(fields, 30);
    for (const edge of EDGES) {
      const mesh = createCubeTileMesh(fields, 30, edgeFlags(edge));
      expect(mesh.stitchedEdges).toEqual([edge]);
      for (let along = 0; along <= fields.meshSegments; along += 1) {
        const vertex = edgeVertex(fields.meshSegments, edge, along);
        const offset = vertex * 3;
        if (along % 2 === 0) {
          expect(Array.from(mesh.positions.subarray(offset, offset + 3))).toEqual(
            Array.from(base.positions.subarray(offset, offset + 3)),
          );
          expect(Array.from(mesh.normals.subarray(offset, offset + 3))).toEqual(
            Array.from(base.normals.subarray(offset, offset + 3)),
          );
        } else {
          const before = edgeVertex(fields.meshSegments, edge, along - 1) * 3;
          const after = edgeVertex(fields.meshSegments, edge, along + 1) * 3;
          for (let axis = 0; axis < 3; axis += 1) {
            expect(mesh.positions[offset + axis]).toBe(
              Math.fround((base.positions[before + axis] + base.positions[after + axis]) * 0.5),
            );
          }
          expect(Math.hypot(...mesh.normals.subarray(offset, offset + 3))).toBeCloseTo(1, 6);
        }
      }
      expectOutwardNondegenerate(mesh.positions, mesh.indices);
    }
  });

  it("matches a reversed cross-face coarse chord", () => {
    let selected:
      | { key: CubeTileKey; edge: CubeEdge; transform: ReturnType<typeof cubeNeighbor> }
      | undefined;
    for (const face of CUBE_FACES) {
      const candidates: Record<CubeEdge, CubeTileKey> = {
        north: { face, level: 1, x: 0, y: 0 },
        east: { face, level: 1, x: 1, y: 0 },
        south: { face, level: 1, x: 0, y: 1 },
        west: { face, level: 1, x: 0, y: 0 },
      };
      for (const edge of EDGES) {
        const key = candidates[edge];
        const transform = cubeNeighbor(key, edge);
        if (transform.key.face !== face && transform.reversed) {
          selected = { key, edge, transform };
          break;
        }
      }
      if (selected !== undefined) break;
    }
    expect(selected).toBeDefined();
    const fineFields = fixture(selected!.key);
    const coarseKey: CubeTileKey = {
      face: selected!.transform.key.face, level: 0, x: 0, y: 0,
    };
    const coarseFields = fixture(coarseKey);
    const fine = createCubeTileMesh(fineFields, 12, edgeFlags(selected!.edge));
    const coarse = createCubeTileMesh(coarseFields, 12, edgeFlags());
    const coarseByDirection = new Map<string, number>();
    for (let along = 0; along <= coarseFields.meshSegments; along += 1) {
      const vertex = edgeVertex(coarseFields.meshSegments, selected!.transform.edge, along);
      coarseByDirection.set(directionKey(coarseFields.directions, vertex), vertex);
    }
    const matchedCoarseIndices: number[] = [];
    for (let along = 0; along <= fineFields.meshSegments; along += 2) {
      const fineVertex = edgeVertex(fineFields.meshSegments, selected!.edge, along);
      const coarseVertex = coarseByDirection.get(directionKey(fineFields.directions, fineVertex));
      expect(coarseVertex).toBeDefined();
      matchedCoarseIndices.push(coarseVertex!);
      expect(Array.from(fine.positions.subarray(fineVertex * 3, fineVertex * 3 + 3))).toEqual(
        Array.from(coarse.positions.subarray(coarseVertex! * 3, coarseVertex! * 3 + 3)),
      );
      expect(Array.from(fine.normals.subarray(fineVertex * 3, fineVertex * 3 + 3))).toEqual(
        Array.from(coarse.normals.subarray(coarseVertex! * 3, coarseVertex! * 3 + 3)),
      );
    }
    expect(matchedCoarseIndices[0]).toBeGreaterThan(
      matchedCoarseIndices[matchedCoarseIndices.length - 1],
    );
    expectOutwardNondegenerate(fine.positions, fine.indices);
  });

  it("handles two stitched edges at a three-face corner without a skirt", () => {
    const fields = fixture({ face: "py", level: 1, x: 0, y: 0 });
    const base = expectedDisplay(fields, 16);
    const mesh = createCubeTileMesh(fields, 16, edgeFlags("north", "west"));
    expect(mesh.stitchedEdges).toEqual(["north", "west"]);
    const corner = edgeVertex(fields.meshSegments, "north", 0);
    expect(Array.from(mesh.positions.subarray(corner * 3, corner * 3 + 3))).toEqual(
      Array.from(base.positions.subarray(corner * 3, corner * 3 + 3)),
    );
    expect(Array.from(mesh.normals.subarray(corner * 3, corner * 3 + 3))).toEqual(
      Array.from(base.normals.subarray(corner * 3, corner * 3 + 3)),
    );
    expect(mesh.positions.length).toBe(fields.positions.length);
    expect(mesh.indices.length).toBe(fields.indices.length);
    expectOutwardNondegenerate(mesh.positions, mesh.indices);
  });

  it("is deterministic across 1x to 30x to 1x without mutating fields", () => {
    const fields = fixture({ face: "nz", level: 2, x: 3, y: 0 }, 64);
    const originalPositions = fields.positions.slice();
    const originalNormals = fields.normals.slice();
    const originalUvs = fields.localUvs.slice();
    const originalIndices = fields.indices.slice();
    const first = createCubeTileMesh(fields, 1, edgeFlags("north", "east"));
    const exaggerated = createCubeTileMesh(fields, 30, edgeFlags("north", "east"));
    const restored = createCubeTileMesh(fields, 1, edgeFlags("north", "east"));
    expect(restored.positions).toEqual(first.positions);
    expect(restored.normals).toEqual(first.normals);
    expect(restored.uvs).toEqual(first.uvs);
    expect(restored.indices).toEqual(first.indices);
    expect(exaggerated.positions).not.toEqual(first.positions);
    expect(fields.positions).toEqual(originalPositions);
    expect(fields.normals).toEqual(originalNormals);
    expect(fields.localUvs).toEqual(originalUvs);
    expect(fields.indices).toEqual(originalIndices);
  });

  it("updates caller-owned relief buffers in place", () => {
    const fields = fixture({ face: "px", level: 2, x: 2, y: 1 });
    const coarseEdges = edgeFlags("south");
    const positions = new Float32Array(fields.directions.length);
    const normals = new Float32Array(fields.normals.length);
    const uvs = new Float32Array(fields.localUvs.length).fill(0.375);
    const positionsIdentity = positions;
    const normalsIdentity = normals;
    const uvsIdentity = uvs;
    updateCubeTileMeshGeometry(fields, 18, coarseEdges, positions, normals, uvs);
    const expected = createCubeTileMesh(fields, 18, coarseEdges);
    expect(positions).toBe(positionsIdentity);
    expect(normals).toBe(normalsIdentity);
    expect(uvs).toBe(uvsIdentity);
    expect(positions).toEqual(expected.positions);
    expect(normals).toEqual(expected.normals);
    expect(uvs).toEqual(expected.uvs);
  });
});
