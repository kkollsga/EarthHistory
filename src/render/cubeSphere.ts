export const CUBE_FACES = ["px", "nx", "py", "ny", "pz", "nz"] as const;
export type CubeFace = (typeof CUBE_FACES)[number];
export type CubeEdge = "north" | "east" | "south" | "west";

export interface CubeTileKey {
  face: CubeFace;
  level: number;
  x: number;
  y: number;
}

export interface CubeTileGeometryData {
  key: CubeTileKey;
  segments: number;
  directions: Float32Array;
  positions: Float32Array;
  localUvs: Float32Array;
  indices: Uint32Array;
  byteLength: number;
}

export interface FaceUv {
  face: CubeFace;
  u: number;
  v: number;
}

export function cubeFaceDirection(
  face: CubeFace,
  u: number,
  v: number,
): [number, number, number] {
  let x: number;
  let y: number;
  let z: number;
  switch (face) {
    case "px": [x, y, z] = [1, v, -u]; break;
    case "nx": [x, y, z] = [-1, v, u]; break;
    case "py": [x, y, z] = [u, 1, -v]; break;
    case "ny": [x, y, z] = [u, -1, v]; break;
    case "pz": [x, y, z] = [u, v, 1]; break;
    case "nz": [x, y, z] = [-u, v, -1]; break;
  }
  const inverseLength = 1 / Math.hypot(x, y, z);
  return [x * inverseLength, y * inverseLength, z * inverseLength];
}

export function directionToCubeFaceUv(
  direction: readonly [number, number, number],
): FaceUv {
  const [x, y, z] = direction;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (ax >= ay && ax >= az) {
    return x >= 0
      ? { face: "px", u: -z / ax, v: y / ax }
      : { face: "nx", u: z / ax, v: y / ax };
  }
  if (ay >= az) {
    return y >= 0
      ? { face: "py", u: x / ay, v: -z / ay }
      : { face: "ny", u: x / ay, v: z / ay };
  }
  return z >= 0
    ? { face: "pz", u: x / az, v: y / az }
    : { face: "nz", u: -x / az, v: y / az };
}

export function cubeTileBounds(key: CubeTileKey): {
  west: number;
  east: number;
  south: number;
  north: number;
} {
  const count = 2 ** key.level;
  if (
    !Number.isInteger(key.level) || key.level < 0 || key.level > 20 ||
    !Number.isInteger(key.x) || key.x < 0 || key.x >= count ||
    !Number.isInteger(key.y) || key.y < 0 || key.y >= count
  ) {
    throw new RangeError(`Invalid cube tile ${key.face}/${key.level}/${key.x}/${key.y}`);
  }
  const span = 2 / count;
  return {
    west: -1 + key.x * span,
    east: -1 + (key.x + 1) * span,
    north: 1 - key.y * span,
    south: 1 - (key.y + 1) * span,
  };
}

export function cubeTileId(key: CubeTileKey): string {
  return `${key.face}:${key.level}:${key.x}:${key.y}`;
}

export function createCubeTileGeometry(
  key: CubeTileKey,
  segments = 32,
): CubeTileGeometryData {
  if (!Number.isInteger(segments) || segments < 1 || segments > 256) {
    throw new RangeError(`Invalid cube tile segment count: ${segments}`);
  }
  const bounds = cubeTileBounds(key);
  const row = segments + 1;
  const vertexCount = row * row;
  const directions = new Float32Array(vertexCount * 3);
  const positions = new Float32Array(vertexCount * 3);
  const localUvs = new Float32Array(vertexCount * 2);
  for (let y = 0; y <= segments; y++) {
    const ty = y / segments;
    const v = bounds.north + (bounds.south - bounds.north) * ty;
    for (let x = 0; x <= segments; x++) {
      const tx = x / segments;
      const u = bounds.west + (bounds.east - bounds.west) * tx;
      const direction = cubeFaceDirection(key.face, u, v);
      const index = y * row + x;
      directions.set(direction, index * 3);
      positions.set(direction, index * 3);
      localUvs[index * 2] = tx;
      localUvs[index * 2 + 1] = 1 - ty;
    }
  }

  const indices = new Uint32Array(segments * segments * 6);
  const a = [positions[0], positions[1], positions[2]] as const;
  const b = [positions[3], positions[4], positions[5]] as const;
  const cOffset = row * 3;
  const c = [positions[cOffset], positions[cOffset + 1], positions[cOffset + 2]] as const;
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const outward =
    (ab[1] * ac[2] - ab[2] * ac[1]) * a[0] +
    (ab[2] * ac[0] - ab[0] * ac[2]) * a[1] +
    (ab[0] * ac[1] - ab[1] * ac[0]) * a[2] > 0;
  let offset = 0;
  for (let y = 0; y < segments; y++) {
    for (let x = 0; x < segments; x++) {
      const topLeft = y * row + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + row;
      const bottomRight = bottomLeft + 1;
      if (outward) {
        indices.set([topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft], offset);
      } else {
        indices.set([topLeft, bottomLeft, topRight, topRight, bottomLeft, bottomRight], offset);
      }
      offset += 6;
    }
  }

  return {
    key,
    segments,
    directions,
    positions,
    localUvs,
    indices,
    byteLength: directions.byteLength + positions.byteLength + localUvs.byteLength + indices.byteLength,
  };
}
