import type { CubeEdge, CubeTileKey } from "./cubeSphere";
import type { CubeTileFields } from "./cubeTileFields";
import { updateCubeDisplayGeometry } from "./cubeRelief";

export interface CubeTileMeshData {
  key: CubeTileKey;
  meshSegments: 32 | 64;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  stitchedEdges: CubeEdge[];
  byteLength: number;
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

function midpointVector3(
  field: Float32Array,
  destinationIndex: number,
  beforeIndex: number,
  afterIndex: number,
  normalize: boolean,
): void {
  const destination = destinationIndex * 3;
  const before = beforeIndex * 3;
  const after = afterIndex * 3;
  let x = (field[before] + field[after]) * 0.5;
  let y = (field[before + 1] + field[after + 1]) * 0.5;
  let z = (field[before + 2] + field[after + 2]) * 0.5;
  if (normalize) {
    const inverseLength = 1 / Math.max(1e-12, Math.hypot(x, y, z));
    x *= inverseLength;
    y *= inverseLength;
    z *= inverseLength;
  }
  field[destination] = x;
  field[destination + 1] = y;
  field[destination + 2] = z;
}

function midpointUv(
  uvs: Float32Array,
  destinationIndex: number,
  beforeIndex: number,
  afterIndex: number,
): void {
  const destination = destinationIndex * 2;
  const before = beforeIndex * 2;
  const after = afterIndex * 2;
  uvs[destination] = (uvs[before] + uvs[after]) * 0.5;
  uvs[destination + 1] = (uvs[before + 1] + uvs[after + 1]) * 0.5;
}

/**
 * Build owned display buffers for one immutable tile. A flagged fine edge is
 * exactly 2:1 adjacent to a coarser leaf. Its unmatched odd vertices move to
 * the straight display-space chord between canonical even vertices, matching
 * the coarse triangle edge without a wall or skirt. Even shared samples remain
 * byte-identical, including at cube-face and two-edge corner joins.
 */
export function createCubeTileMesh(
  fields: Readonly<CubeTileFields>,
  verticalExaggeration: number,
  coarseEdges: Readonly<Record<CubeEdge, boolean>>,
): CubeTileMeshData {
  const segments = fields.meshSegments;
  if (segments < 2 || segments % 2 !== 0) {
    throw new RangeError("Cube 2:1 edge stitching requires a positive even segment count");
  }
  const vertexCount = (segments + 1) ** 2;
  if (
    fields.directions.length !== vertexCount * 3 ||
    fields.heightsMetres.length !== vertexCount ||
    fields.normals.length !== vertexCount * 3 ||
    fields.localUvs.length !== vertexCount * 2
  ) {
    throw new RangeError("Cube tile field geometry dimensions do not match meshSegments");
  }

  const positions = new Float32Array(fields.directions.length);
  const normals = new Float32Array(fields.normals.length);
  const uvs = new Float32Array(fields.localUvs.length);
  const indices = fields.indices.slice();
  updateCubeTileMeshGeometry(
    fields,
    verticalExaggeration,
    coarseEdges,
    positions,
    normals,
    uvs,
  );

  const stitchedEdges = EDGES.filter((edge) => coarseEdges[edge]);

  return {
    key: { ...fields.key },
    meshSegments: segments,
    positions,
    normals,
    uvs,
    indices,
    stitchedEdges,
    byteLength: positions.byteLength + normals.byteLength + uvs.byteLength + indices.byteLength,
  };
}

/** Update only the mutable display attributes during relief-slider changes. */
export function updateCubeTileMeshGeometry(
  fields: Readonly<CubeTileFields>,
  verticalExaggeration: number,
  coarseEdges: Readonly<Record<CubeEdge, boolean>>,
  positions: Float32Array,
  normals: Float32Array,
  uvs?: Float32Array,
): void {
  if (positions.length !== fields.directions.length || normals.length !== fields.normals.length) {
    throw new RangeError("Cube display target dimensions do not match source fields");
  }
  if (uvs !== undefined && uvs.length !== fields.localUvs.length) {
    throw new RangeError("Cube display UV target dimensions do not match source fields");
  }
  updateCubeDisplayGeometry(
    fields.directions,
    fields.heightsMetres,
    fields.normals,
    verticalExaggeration,
    positions,
    normals,
  );
  uvs?.set(fields.localUvs);
  for (const edge of EDGES) {
    if (!coarseEdges[edge]) continue;
    for (let along = 1; along < fields.meshSegments; along += 2) {
      const destination = edgeVertex(fields.meshSegments, edge, along);
      const before = edgeVertex(fields.meshSegments, edge, along - 1);
      const after = edgeVertex(fields.meshSegments, edge, along + 1);
      midpointVector3(positions, destination, before, after, false);
      midpointVector3(normals, destination, before, after, true);
      if (uvs !== undefined) midpointUv(uvs, destination, before, after);
    }
  }
}

/** Apply the same 2:1 edge constraint to an already displaced position buffer. */
export function stitchCubeTilePositionEdges(
  meshSegments: number,
  coarseEdges: Readonly<Record<CubeEdge, boolean>>,
  positions: Float32Array,
): void {
  const expected = (meshSegments + 1) ** 2 * 3;
  if (positions.length !== expected) {
    throw new RangeError("Cube stitch target dimensions do not match meshSegments");
  }
  for (const edge of EDGES) {
    if (!coarseEdges[edge]) continue;
    for (let along = 1; along < meshSegments; along += 2) {
      midpointVector3(
        positions,
        edgeVertex(meshSegments, edge, along),
        edgeVertex(meshSegments, edge, along - 1),
        edgeVertex(meshSegments, edge, along + 1),
        false,
      );
    }
  }
}
