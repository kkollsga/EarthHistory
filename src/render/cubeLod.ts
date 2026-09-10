import {
  CUBE_FACES,
  cubeFaceDirection,
  cubeTileBounds,
  cubeTileId,
  directionToCubeFaceUv,
  type CubeEdge,
  type CubeFace,
  type CubeTileKey,
} from "./cubeSphere";

export interface CubeLodCamera {
  /** Unit direction from globe center toward the camera. */
  direction: readonly [number, number, number];
  /** Camera distance from globe center in Earth radii. */
  distance: number;
  verticalFovRadians: number;
  viewportHeight: number;
}

export interface CubeLodInput {
  camera: CubeLodCamera;
  previousKeys?: readonly CubeTileKey[];
  maxLevel?: number;
  maxLeaves?: number;
  splitPixels?: number;
  mergePixels?: number;
  horizonPaddingRadians?: number;
}

export interface CubeNeighborTransform {
  key: CubeTileKey;
  edge: CubeEdge;
  reversed: boolean;
}

export interface CubeLodNeighborRelation extends CubeNeighborTransform {
  levelDelta: number;
}

export type CubeEdgeRecord<T> = Record<CubeEdge, T>;

export interface CubeLodLeaf {
  key: CubeTileKey;
  id: string;
  projectedErrorPx: number;
  neighbors: CubeEdgeRecord<CubeLodNeighborRelation[]>;
  edgeLevels: CubeEdgeRecord<number>;
  /** True only on a fine edge touching a leaf one level coarser. */
  coarseEdges: CubeEdgeRecord<boolean>;
}

export interface CubeLodSelection {
  leaves: CubeLodLeaf[];
  capped: boolean;
}

export interface CubeLodRenderState {
  quality: "high" | "low";
  temporal: boolean;
  settled: boolean;
  caoCoordinateView: boolean;
}

/** Keep live temporal previews bounded without reducing the settled PALEOMAP view. */
export function cubeLodLimitsForRenderState(
  state: CubeLodRenderState,
): { maxLevel: number; maxLeaves: number } {
  if (state.caoCoordinateView) {
    return state.settled
      ? { maxLevel: 1, maxLeaves: 18 }
      : { maxLevel: 0, maxLeaves: 6 };
  }
  if (state.temporal && !state.settled) {
    return { maxLevel: 0, maxLeaves: 6 };
  }
  return state.quality === "high"
    ? { maxLevel: 4, maxLeaves: 96 }
    : { maxLevel: 1, maxLeaves: 24 };
}

const EDGES: readonly CubeEdge[] = ["north", "east", "south", "west"];
const DEFAULT_MAX_LEVEL = 4;
const DEFAULT_MAX_LEAVES = 96;
const DEFAULT_SPLIT_PIXELS = 180;
const DEFAULT_MERGE_PIXELS = 125;
const CAMERA_SURFACE_EPSILON = 1e-4;
const FACE_CROSS_EPSILON = 1e-7;

interface TileCone {
  center: [number, number, number];
  radius: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function oppositeEdge(edge: CubeEdge): CubeEdge {
  switch (edge) {
    case "north": return "south";
    case "east": return "west";
    case "south": return "north";
    case "west": return "east";
  }
}

function faceOrder(face: CubeFace): number {
  return CUBE_FACES.indexOf(face);
}

function compareKeys(left: CubeTileKey, right: CubeTileKey): number {
  return faceOrder(left.face) - faceOrder(right.face) ||
    left.level - right.level || left.y - right.y || left.x - right.x;
}

function sameKey(left: CubeTileKey, right: CubeTileKey): boolean {
  return left.face === right.face && left.level === right.level &&
    left.x === right.x && left.y === right.y;
}

function childKeys(key: CubeTileKey): CubeTileKey[] {
  const level = key.level + 1;
  const x = key.x * 2;
  const y = key.y * 2;
  return [
    { face: key.face, level, x, y },
    { face: key.face, level, x: x + 1, y },
    { face: key.face, level, x, y: y + 1 },
    { face: key.face, level, x: x + 1, y: y + 1 },
  ];
}

function parentKey(key: CubeTileKey): CubeTileKey | undefined {
  if (key.level === 0) return undefined;
  return {
    face: key.face,
    level: key.level - 1,
    x: Math.floor(key.x / 2),
    y: Math.floor(key.y / 2),
  };
}

function ancestorAt(key: CubeTileKey, level: number): CubeTileKey {
  if (level > key.level || level < 0) throw new RangeError("Invalid ancestor level");
  const divisor = 2 ** (key.level - level);
  return {
    face: key.face,
    level,
    x: Math.floor(key.x / divisor),
    y: Math.floor(key.y / divisor),
  };
}

function isDescendant(key: CubeTileKey, ancestor: CubeTileKey): boolean {
  return key.level >= ancestor.level && sameKey(ancestorAt(key, ancestor.level), ancestor);
}

function edgePoint(
  key: CubeTileKey,
  edge: CubeEdge,
  t: number,
  outside: number,
): [number, number, number] {
  const bounds = cubeTileBounds(key);
  switch (edge) {
    case "north":
      return cubeFaceDirection(
        key.face,
        bounds.west + (bounds.east - bounds.west) * t,
        bounds.north + outside,
      );
    case "east":
      return cubeFaceDirection(
        key.face,
        bounds.east + outside,
        bounds.north + (bounds.south - bounds.north) * t,
      );
    case "south":
      return cubeFaceDirection(
        key.face,
        bounds.west + (bounds.east - bounds.west) * t,
        bounds.south - outside,
      );
    case "west":
      return cubeFaceDirection(
        key.face,
        bounds.west - outside,
        bounds.north + (bounds.south - bounds.north) * t,
      );
  }
}

function closestFaceEdge(u: number, v: number): CubeEdge {
  const candidates: Array<[distance: number, edge: CubeEdge]> = [
    [Math.abs(v - 1), "north"],
    [Math.abs(u - 1), "east"],
    [Math.abs(v + 1), "south"],
    [Math.abs(u + 1), "west"],
  ];
  candidates.sort((left, right) => left[0] - right[0]);
  return candidates[0][1];
}

function edgeParameter(edge: CubeEdge, u: number, v: number): number {
  return edge === "north" || edge === "south" ? u : -v;
}

/** Return the same-level tile across an edge, including cube-face orientation. */
export function cubeNeighbor(key: CubeTileKey, edge: CubeEdge): CubeNeighborTransform {
  const count = 2 ** key.level;
  if (edge === "north" && key.y > 0) {
    return { key: { ...key, y: key.y - 1 }, edge: "south", reversed: false };
  }
  if (edge === "east" && key.x < count - 1) {
    return { key: { ...key, x: key.x + 1 }, edge: "west", reversed: false };
  }
  if (edge === "south" && key.y < count - 1) {
    return { key: { ...key, y: key.y + 1 }, edge: "north", reversed: false };
  }
  if (edge === "west" && key.x > 0) {
    return { key: { ...key, x: key.x - 1 }, edge: "east", reversed: false };
  }

  const span = 2 / count;
  const outside = span * FACE_CROSS_EPSILON;
  const middle = directionToCubeFaceUv(edgePoint(key, edge, 0.5, outside));
  const partnerEdge = closestFaceEdge(middle.u, middle.v);
  const neighborX = clamp(Math.floor(((middle.u + 1) / 2) * count), 0, count - 1);
  const neighborY = clamp(Math.floor(((1 - middle.v) / 2) * count), 0, count - 1);
  const first = directionToCubeFaceUv(edgePoint(key, edge, 0.25, outside));
  const second = directionToCubeFaceUv(edgePoint(key, edge, 0.75, outside));
  const reversed = edgeParameter(partnerEdge, second.u, second.v) <
    edgeParameter(partnerEdge, first.u, first.v);
  return {
    key: { face: middle.face, level: key.level, x: neighborX, y: neighborY },
    edge: partnerEdge,
    reversed,
  };
}

function tileCone(key: CubeTileKey): TileCone {
  const bounds = cubeTileBounds(key);
  const center = cubeFaceDirection(
    key.face,
    (bounds.west + bounds.east) / 2,
    (bounds.north + bounds.south) / 2,
  );
  let radius = 0;
  const samples = [
    [bounds.west, bounds.north],
    [bounds.east, bounds.north],
    [bounds.east, bounds.south],
    [bounds.west, bounds.south],
    [(bounds.west + bounds.east) / 2, bounds.north],
    [bounds.east, (bounds.north + bounds.south) / 2],
    [(bounds.west + bounds.east) / 2, bounds.south],
    [bounds.west, (bounds.north + bounds.south) / 2],
  ];
  for (const [u, v] of samples) {
    const direction = cubeFaceDirection(key.face, u, v);
    const dot = clamp(
      center[0] * direction[0] + center[1] * direction[1] + center[2] * direction[2],
      -1,
      1,
    );
    radius = Math.max(radius, Math.acos(dot));
  }
  // The sampled square bounds the spherical cube patch; this small numeric
  // margin keeps an exact limb contact from being rejected by rounding.
  return { center, radius: radius + 1e-7 };
}

function normalizeCameraDirection(
  direction: readonly [number, number, number],
): [number, number, number] {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0) || !Number.isFinite(length)) {
    throw new RangeError("Cube LOD camera direction must be finite and non-zero");
  }
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}

function isVisible(
  cone: TileCone,
  cameraDirection: readonly [number, number, number],
  cameraDistance: number,
  padding: number,
): boolean {
  const dot = clamp(
    cone.center[0] * cameraDirection[0] +
      cone.center[1] * cameraDirection[1] +
      cone.center[2] * cameraDirection[2],
    -1,
    1,
  );
  const separation = Math.acos(dot);
  const horizonRadius = Math.acos(1 / cameraDistance);
  return separation <= horizonRadius + cone.radius + padding;
}

function projectedPixels(
  cone: TileCone,
  camera: CubeLodCamera,
  cameraDirection: readonly [number, number, number],
): number {
  const dot = clamp(
    cone.center[0] * cameraDirection[0] +
      cone.center[1] * cameraDirection[1] +
      cone.center[2] * cameraDirection[2],
    -1,
    1,
  );
  const centerDistance = Math.sqrt(
    camera.distance * camera.distance + 1 - 2 * camera.distance * dot,
  );
  const focalPixels = camera.viewportHeight /
    (2 * Math.tan(camera.verticalFovRadians / 2));
  const safeDistance = Math.max(CAMERA_SURFACE_EPSILON, centerDistance);
  return Math.max(0, (2 * Math.sin(cone.radius) / safeDistance) * focalPixels);
}

function previousRefined(key: CubeTileKey, previous: readonly CubeTileKey[]): boolean {
  return previous.some((candidate) => candidate.level > key.level && isDescendant(candidate, key));
}

function relationCandidates(
  leaf: CubeTileKey,
  edge: CubeEdge,
  keys: readonly CubeTileKey[],
): CubeLodNeighborRelation[] {
  const transform = cubeNeighbor(leaf, edge);
  const exactOrCoarse: CubeTileKey[] = [];
  for (let level = transform.key.level; level >= 0; level -= 1) {
    const candidate = ancestorAt(transform.key, level);
    const match = keys.find((key) => sameKey(key, candidate));
    if (match !== undefined) {
      exactOrCoarse.push(match);
      break;
    }
  }
  if (exactOrCoarse.length > 0) {
    return exactOrCoarse.map((key) => ({
      key,
      edge: transform.edge,
      reversed: transform.reversed,
      levelDelta: key.level - leaf.level,
    }));
  }

  const finer = keys.filter((key) => {
    if (key.level <= transform.key.level || !isDescendant(key, transform.key)) return false;
    const scale = 2 ** (key.level - transform.key.level);
    const localX = key.x - transform.key.x * scale;
    const localY = key.y - transform.key.y * scale;
    switch (transform.edge) {
      case "north": return localY === 0;
      case "east": return localX === scale - 1;
      case "south": return localY === scale - 1;
      case "west": return localX === 0;
    }
  });
  finer.sort((left, right) => {
    const leftAlong = transform.edge === "north" || transform.edge === "south"
      ? left.x / 2 ** left.level
      : left.y / 2 ** left.level;
    const rightAlong = transform.edge === "north" || transform.edge === "south"
      ? right.x / 2 ** right.level
      : right.y / 2 ** right.level;
    return (transform.reversed ? rightAlong - leftAlong : leftAlong - rightAlong) ||
      compareKeys(left, right);
  });
  return finer.map((key) => ({
    key,
    edge: transform.edge,
    reversed: transform.reversed,
    levelDelta: key.level - leaf.level,
  }));
}

function normalizeLeaves(keys: readonly CubeTileKey[]): CubeTileKey[] {
  const unique = new Map<string, CubeTileKey>();
  for (const key of keys) unique.set(cubeTileId(key), { ...key });
  const ordered = [...unique.values()].sort(compareKeys);
  return ordered.filter((key, index) =>
    !ordered.some((candidate, candidateIndex) =>
      candidateIndex !== index && candidate.level < key.level && isDescendant(key, candidate),
    ),
  );
}

/**
 * Balance a non-overlapping cube leaf set. When the cap prevents splitting a
 * coarse neighbor, the finer branch merges upward; this is conservative and
 * cannot introduce a visible hole.
 */
export function balanceCubeSelection(
  inputKeys: readonly CubeTileKey[],
  maxLevel = DEFAULT_MAX_LEVEL,
  maxLeaves = DEFAULT_MAX_LEAVES,
): CubeTileKey[] {
  maxLeaves = Math.max(6, Math.floor(maxLeaves));
  let keys = normalizeLeaves(inputKeys).filter((key) => key.level <= maxLevel);
  let coarsenOnly = false;
  while (keys.length > maxLeaves) {
    const fine = [...keys].sort((left, right) =>
      right.level - left.level || compareKeys(right, left),
    )[0];
    const parent = parentKey(fine);
    if (parent === undefined) break;
    keys = keys.filter((key) => !isDescendant(key, parent));
    keys.push(parent);
    keys = normalizeLeaves(keys);
  }
  for (let iteration = 0; iteration < 512; iteration += 1) {
    let violation:
      | { leaf: CubeTileKey; neighbor: CubeTileKey }
      | undefined;
    for (const leaf of keys) {
      for (const edge of EDGES) {
        const relation = relationCandidates(leaf, edge, keys)
          .find((candidate) => Math.abs(candidate.levelDelta) > 1);
        if (relation !== undefined) {
          violation = { leaf, neighbor: relation.key };
          break;
        }
      }
      if (violation !== undefined) break;
    }
    if (violation === undefined) return keys.sort(compareKeys);

    const coarse = violation.leaf.level < violation.neighbor.level
      ? violation.leaf
      : violation.neighbor;
    const fine = violation.leaf.level > violation.neighbor.level
      ? violation.leaf
      : violation.neighbor;
    if (!coarsenOnly && coarse.level < maxLevel && keys.length + 3 <= maxLeaves) {
      keys = keys.filter((key) => !sameKey(key, coarse));
      keys.push(...childKeys(coarse));
    } else {
      // Once the cap prevents a required neighbor split, keep subsequent
      // repairs monotonic. Reopening capacity and splitting again can cycle
      // between two valid partitions without ever resolving every edge.
      coarsenOnly = true;
      const parent = parentKey(fine);
      if (parent === undefined) break;
      keys = keys.filter((key) => !isDescendant(key, parent));
      keys.push(parent);
    }
    keys = normalizeLeaves(keys);
  }
  return keys.sort(compareKeys);
}

function makeEdgeRecord<T>(factory: (edge: CubeEdge) => T): CubeEdgeRecord<T> {
  return {
    north: factory("north"),
    east: factory("east"),
    south: factory("south"),
    west: factory("west"),
  };
}

/** Describe adjacency for an already chosen, non-overlapping render leaf set. */
export function describeCubeLodLeaves(
  inputKeys: readonly CubeTileKey[],
): CubeLodLeaf[] {
  const ordered = normalizeLeaves(inputKeys).sort(compareKeys);
  return ordered.map((key) => {
    const neighbors = makeEdgeRecord((edge) => relationCandidates(key, edge, ordered));
    const edgeLevels = makeEdgeRecord((edge) =>
      neighbors[edge].length === 0
        ? key.level
        : Math.min(...neighbors[edge].map((neighbor) => neighbor.key.level)),
    );
    const coarseEdges = makeEdgeRecord((edge) =>
      neighbors[edge].some((neighbor) => neighbor.levelDelta === -1),
    );
    return {
      key,
      id: cubeTileId(key),
      projectedErrorPx: 0,
      neighbors,
      edgeLevels,
      coarseEdges,
    };
  });
}

export function selectCubeLod(input: CubeLodInput): CubeLodSelection {
  if (
    !Number.isFinite(input.camera.distance) ||
    !Number.isFinite(input.camera.verticalFovRadians) ||
    !Number.isFinite(input.camera.viewportHeight) ||
    input.camera.verticalFovRadians <= 0 || input.camera.viewportHeight <= 0
  ) {
    throw new RangeError("Cube LOD camera metrics must be finite and positive");
  }
  const requestedMaxLevel = input.maxLevel ?? DEFAULT_MAX_LEVEL;
  const requestedMaxLeaves = input.maxLeaves ?? DEFAULT_MAX_LEAVES;
  if (!Number.isFinite(requestedMaxLevel) || !Number.isFinite(requestedMaxLeaves)) {
    throw new RangeError("Cube LOD limits must be finite");
  }
  const maxLevel = clamp(Math.floor(requestedMaxLevel), 0, 20);
  const maxLeaves = Math.max(6, Math.floor(requestedMaxLeaves));
  const splitPixels = input.splitPixels ?? DEFAULT_SPLIT_PIXELS;
  const mergePixels = input.mergePixels ?? DEFAULT_MERGE_PIXELS;
  if (!(mergePixels >= 0 && splitPixels > mergePixels)) {
    throw new RangeError("Cube LOD requires 0 <= mergePixels < splitPixels");
  }
  const cameraDirection = normalizeCameraDirection(input.camera.direction);
  const cameraDistance = Math.max(
    1 + CAMERA_SURFACE_EPSILON,
    input.camera.distance,
  );
  const camera: CubeLodCamera = {
    ...input.camera,
    distance: cameraDistance,
    verticalFovRadians: clamp(input.camera.verticalFovRadians, 0.01, Math.PI - 0.01),
    viewportHeight: Math.max(1, input.camera.viewportHeight),
  };
  const padding = Math.max(0, input.horizonPaddingRadians ?? 0.015);
  const previous = input.previousKeys ?? [];
  const coneCache = new Map<string, TileCone>();
  const coneFor = (key: CubeTileKey) => {
    const id = cubeTileId(key);
    let cone = coneCache.get(id);
    if (cone === undefined) {
      cone = tileCone(key);
      coneCache.set(id, cone);
    }
    return cone;
  };
  const visible = (key: CubeTileKey) =>
    isVisible(coneFor(key), cameraDirection, cameraDistance, padding);
  const error = (key: CubeTileKey) => projectedPixels(coneFor(key), camera, cameraDirection);

  // Always retain a complete six-face partition. Visibility gates refinement
  // work, while coarse hidden roots keep fast camera motion hole-free and let
  // renderer/GPU culling discard their draw cost.
  let leaves = CUBE_FACES
    .map((face): CubeTileKey => ({ face, level: 0, x: 0, y: 0 }));
  let capped = false;
  while (true) {
    const candidates = leaves
      .filter((key) => {
        if (key.level >= maxLevel) return false;
        if (!visible(key)) return false;
        const threshold = previousRefined(key, previous) ? mergePixels : splitPixels;
        return error(key) > threshold;
      })
      // Spend a capped budget where one more split removes the most visible error.
      // Level-first ordering lets broad limb branches starve the inspected center.
      .sort((left, right) =>
        error(right) - error(left) || left.level - right.level || compareKeys(left, right),
      );
    if (candidates.length === 0) break;
    if (leaves.length + 3 > maxLeaves) {
      capped = true;
      break;
    }
    let accepted: CubeTileKey[] | undefined;
    for (const candidate of candidates) {
      const proposal = leaves.filter((key) => !sameKey(key, candidate));
      proposal.push(...childKeys(candidate));
      // Close neighbor levels without a cap so balancing can only refine the
      // existing partition. Reject an unaffordable closure and try the next
      // screen-error candidate instead of coarsening detail already accepted.
      const balancedProposal = balanceCubeSelection(
        proposal,
        maxLevel,
        Number.MAX_SAFE_INTEGER,
      );
      if (balancedProposal.length <= maxLeaves) {
        accepted = balancedProposal;
        break;
      }
      capped = true;
    }
    if (accepted === undefined) break;
    leaves = accepted;
  }

  const balanced = balanceCubeSelection(leaves, maxLevel, maxLeaves);
  const ordered = balanced.sort(compareKeys);
  const described = describeCubeLodLeaves(ordered);
  for (const leaf of described) leaf.projectedErrorPx = error(leaf.key);
  return { capped, leaves: described };
}
