import type { CubeEdge } from "./cubeSphere";

export interface TemporalNormalTile {
  readonly directions: Float32Array;
  readonly normals: Float32Array;
  readonly meshSegments: number;
  readonly coarseEdges: Readonly<Record<CubeEdge, boolean>>;
}

const EDGES: readonly CubeEdge[] = ["north", "east", "south", "west"];

function edgeVertex(segments: number, edge: CubeEdge, along: number): number {
  const row = segments + 1;
  switch (edge) {
    case "north": return along;
    case "east": return along * row + segments;
    case "south": return segments * row + along;
    case "west": return along * row;
  }
}

function directionKey(directions: Float32Array, vertex: number): string {
  const offset = vertex * 3;
  return `${directions[offset].toFixed(7)}:${directions[offset + 1].toFixed(7)}:${directions[offset + 2].toFixed(7)}`;
}

function normalizeAt(normals: Float32Array, vertex: number): void {
  const offset = vertex * 3;
  const inverse = 1 / Math.max(
    1e-12,
    Math.hypot(normals[offset], normals[offset + 1], normals[offset + 2]),
  );
  normals[offset] *= inverse;
  normals[offset + 1] *= inverse;
  normals[offset + 2] *= inverse;
}

/**
 * Average coincident edge normals across staged tiles, then enforce the same
 * 2:1 interpolation used by stitched positions. Physical vertices are not
 * changed; this only prevents synthetic shading seams between cube leaves.
 */
export function harmonizeTemporalTileNormals(tiles: readonly TemporalNormalTile[]): void {
  const sums = new Map<string, [number, number, number, number]>();
  for (const tile of tiles) {
    for (const edge of EDGES) {
      for (let along = 0; along <= tile.meshSegments; along += 1) {
        const vertex = edgeVertex(tile.meshSegments, edge, along);
        const offset = vertex * 3;
        const key = directionKey(tile.directions, vertex);
        const sum = sums.get(key);
        if (sum === undefined) {
          sums.set(key, [
            tile.normals[offset],
            tile.normals[offset + 1],
            tile.normals[offset + 2],
            1,
          ]);
        } else {
          sum[0] += tile.normals[offset];
          sum[1] += tile.normals[offset + 1];
          sum[2] += tile.normals[offset + 2];
          sum[3] += 1;
        }
      }
    }
  }
  for (const tile of tiles) {
    for (const edge of EDGES) {
      for (let along = 0; along <= tile.meshSegments; along += 1) {
        const vertex = edgeVertex(tile.meshSegments, edge, along);
        const offset = vertex * 3;
        const sum = sums.get(directionKey(tile.directions, vertex))!;
        tile.normals[offset] = sum[0] / sum[3];
        tile.normals[offset + 1] = sum[1] / sum[3];
        tile.normals[offset + 2] = sum[2] / sum[3];
        normalizeAt(tile.normals, vertex);
      }
      if (!tile.coarseEdges[edge]) continue;
      for (let along = 1; along < tile.meshSegments; along += 2) {
        const vertex = edgeVertex(tile.meshSegments, edge, along);
        const before = edgeVertex(tile.meshSegments, edge, along - 1);
        const after = edgeVertex(tile.meshSegments, edge, along + 1);
        const offset = vertex * 3;
        const beforeOffset = before * 3;
        const afterOffset = after * 3;
        tile.normals[offset] = (tile.normals[beforeOffset] + tile.normals[afterOffset]) * 0.5;
        tile.normals[offset + 1] =
          (tile.normals[beforeOffset + 1] + tile.normals[afterOffset + 1]) * 0.5;
        tile.normals[offset + 2] =
          (tile.normals[beforeOffset + 2] + tile.normals[afterOffset + 2]) * 0.5;
        normalizeAt(tile.normals, vertex);
      }
    }
  }
}
