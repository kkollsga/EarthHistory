import { describe, expect, it } from "vitest";
import {
  CUBE_FACES,
  cubeFaceDirection,
  cubeTileBounds,
  cubeTileId,
  directionToCubeFaceUv,
  type CubeEdge,
  type CubeTileKey,
} from "./cubeSphere";
import {
  balanceCubeSelection,
  cubeNeighbor,
  selectCubeLod,
  type CubeLodSelection,
} from "./cubeLod";
import { reliefHorizonExtensionRadians } from "./cubeRelief";

const EDGES: readonly CubeEdge[] = ["north", "east", "south", "west"];

function sameKey(left: CubeTileKey, right: CubeTileKey): boolean {
  return cubeTileId(left) === cubeTileId(right);
}

function edgeDirection(key: CubeTileKey, edge: CubeEdge, t: number) {
  const bounds = cubeTileBounds(key);
  switch (edge) {
    case "north": return cubeFaceDirection(
      key.face, bounds.west + (bounds.east - bounds.west) * t, bounds.north,
    );
    case "east": return cubeFaceDirection(
      key.face, bounds.east, bounds.north + (bounds.south - bounds.north) * t,
    );
    case "south": return cubeFaceDirection(
      key.face, bounds.west + (bounds.east - bounds.west) * t, bounds.south,
    );
    case "west": return cubeFaceDirection(
      key.face, bounds.west, bounds.north + (bounds.south - bounds.north) * t,
    );
  }
}

function normalized(value: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(...value);
  return [value[0] / length, value[1] / length, value[2] / length];
}

function assertSelection(selection: CubeLodSelection, maxLeaves = 96, maxLevel = 4): void {
  expect(selection.leaves.length).toBeLessThanOrEqual(maxLeaves);
  const ids = new Set(selection.leaves.map((leaf) => leaf.id));
  expect(ids.size).toBe(selection.leaves.length);
  for (const leaf of selection.leaves) {
    expect(leaf.id).toBe(cubeTileId(leaf.key));
    expect(leaf.key.level).toBeLessThanOrEqual(maxLevel);
    expect(Number.isFinite(leaf.projectedErrorPx)).toBe(true);
    expect(leaf.projectedErrorPx).toBeGreaterThanOrEqual(0);
    for (const edge of EDGES) {
      for (const neighbor of leaf.neighbors[edge]) {
        expect(Math.abs(neighbor.levelDelta)).toBeLessThanOrEqual(1);
      }
      expect(leaf.coarseEdges[edge]).toBe(
        leaf.neighbors[edge].some((neighbor) => neighbor.levelDelta === -1),
      );
    }
    for (let level = 0; level < leaf.key.level; level += 1) {
      const divisor = 2 ** (leaf.key.level - level);
      expect(ids.has(cubeTileId({
        face: leaf.key.face,
        level,
        x: Math.floor(leaf.key.x / divisor),
        y: Math.floor(leaf.key.y / divisor),
      }))).toBe(false);
    }
  }
  for (const face of CUBE_FACES) {
    const parameterArea = selection.leaves
      .filter((leaf) => leaf.key.face === face)
      .reduce((total, leaf) => total + 4 / 4 ** leaf.key.level, 0);
    expect(parameterArea).toBeCloseTo(4, 12);
  }
}

function camera(
  direction: readonly [number, number, number],
  distance: number,
) {
  return {
    direction: normalized(direction),
    distance,
    verticalFovRadians: Math.PI / 3,
    viewportHeight: 900,
  };
}

function split(keys: CubeTileKey[], target: CubeTileKey): CubeTileKey[] {
  const next = keys.filter((key) => !sameKey(key, target));
  const level = target.level + 1;
  const x = target.x * 2;
  const y = target.y * 2;
  next.push(
    { face: target.face, level, x, y },
    { face: target.face, level, x: x + 1, y },
    { face: target.face, level, x, y: y + 1 },
    { face: target.face, level, x: x + 1, y: y + 1 },
  );
  return next;
}

function selectionLevelAtDirection(
  selection: CubeLodSelection,
  direction: readonly [number, number, number],
): number | undefined {
  const location = directionToCubeFaceUv(direction);
  return selection.leaves.find((leaf) => {
    if (leaf.key.face !== location.face) return false;
    const bounds = cubeTileBounds(leaf.key);
    return location.u >= bounds.west && location.u <= bounds.east &&
      location.v <= bounds.north && location.v >= bounds.south;
  })?.key.level;
}

describe("cube LOD adjacency", () => {
  it("maps all 12 cube edges reciprocally with exact orientation", () => {
    const pairs = new Set<string>();
    for (const face of CUBE_FACES) {
      const root: CubeTileKey = { face, level: 0, x: 0, y: 0 };
      for (const edge of EDGES) {
        const neighbor = cubeNeighbor(root, edge);
        const reverse = cubeNeighbor(neighbor.key, neighbor.edge);
        expect(reverse.key).toEqual(root);
        expect(reverse.edge).toBe(edge);
        expect(reverse.reversed).toBe(neighbor.reversed);
        const pair = [face, neighbor.key.face].sort().join(":");
        pairs.add(pair);
        for (const t of [0.13, 0.5, 0.87]) {
          const sourceDirection = edgeDirection(root, edge, t);
          const targetDirection = edgeDirection(
            neighbor.key,
            neighbor.edge,
            neighbor.reversed ? 1 - t : t,
          );
          for (let axis = 0; axis < 3; axis += 1) {
            expect(targetDirection[axis]).toBeCloseTo(sourceDirection[axis], 14);
          }
        }
      }
    }
    expect(pairs).toHaveLength(12);
  });

  it("maps same-face and subdivided cross-face neighbors without changing level", () => {
    const internal: CubeTileKey = { face: "px", level: 2, x: 1, y: 1 };
    expect(cubeNeighbor(internal, "north")).toEqual({
      key: { face: "px", level: 2, x: 1, y: 0 }, edge: "south", reversed: false,
    });
    expect(cubeNeighbor(internal, "east")).toEqual({
      key: { face: "px", level: 2, x: 2, y: 1 }, edge: "west", reversed: false,
    });

    for (const face of CUBE_FACES) {
      const boundaryTiles: Record<CubeEdge, CubeTileKey> = {
        north: { face, level: 2, x: 1, y: 0 },
        east: { face, level: 2, x: 3, y: 1 },
        south: { face, level: 2, x: 1, y: 3 },
        west: { face, level: 2, x: 0, y: 1 },
      };
      for (const edge of EDGES) {
        const source = boundaryTiles[edge];
        const neighbor = cubeNeighbor(source, edge);
        expect(neighbor.key.level).toBe(2);
        const reverse = cubeNeighbor(neighbor.key, neighbor.edge);
        expect(reverse.key).toEqual(source);
        expect(reverse.edge).toBe(edge);
      }
    }
  });

  it("has exactly eight shared cube corners, including both poles and ±180", () => {
    const corners = new Map<string, string[]>();
    for (const face of CUBE_FACES) {
      for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const direction = cubeFaceDirection(face, u, v);
        const id = direction.map((value) => value.toFixed(8)).join(":");
        const entries = corners.get(id) ?? [];
        entries.push(face);
        corners.set(id, entries);
      }
    }
    expect(corners).toHaveLength(8);
    expect([...corners.values()].every((faces) => faces.length === 3)).toBe(true);
    expect(cubeFaceDirection("py", 0, 0)).toEqual([0, 1, -0]);
    expect(cubeFaceDirection("ny", 0, 0)).toEqual([0, -1, 0]);
    expect(cubeFaceDirection("nx", 0, 0)).toEqual([-1, 0, 0]);
  });
});

describe("cube LOD selection", () => {
  it("balances a deliberately mixed N/N+2 selection without gaps or overlaps", () => {
    let keys = CUBE_FACES.map((face): CubeTileKey => ({ face, level: 0, x: 0, y: 0 }));
    const pxRoot = keys.find((key) => key.face === "px")!;
    keys = split(keys, pxRoot);
    keys = split(keys, { face: "px", level: 1, x: 1, y: 0 });
    const balanced = balanceCubeSelection(keys, 4, 96);
    const ids = new Set(balanced.map(cubeTileId));
    expect(ids.size).toBe(balanced.length);
    for (const key of balanced) {
      for (let level = 0; level < key.level; level += 1) {
        const divisor = 2 ** (key.level - level);
        expect(ids.has(cubeTileId({
          face: key.face,
          level,
          x: Math.floor(key.x / divisor),
          y: Math.floor(key.y / divisor),
        }))).toBe(false);
      }
    }
    for (const face of CUBE_FACES) {
      const area = balanced
        .filter((key) => key.face === face)
        .reduce((total, key) => total + 1 / 4 ** key.level, 0);
      expect(area).toBeCloseTo(1, 12);
    }
    const tightlyCapped = balanceCubeSelection(balanced, 4, 9);
    expect(tightlyCapped.length).toBeLessThanOrEqual(9);

    // The level-2 branch reaches PX's north/east boundaries. Its transformed
    // neighbor face must have been refined to at least level 1.
    for (const key of balanced.filter((candidate) =>
      candidate.face === "px" && candidate.level === 2 &&
      (candidate.x === 3 || candidate.y === 0),
    )) {
      for (const edge of EDGES.filter((candidate) =>
        (candidate === "east" && key.x === 3) || (candidate === "north" && key.y === 0),
      )) {
        const transformed = cubeNeighbor(key, edge);
        const covering = balanced.find((candidate) => {
          if (candidate.face !== transformed.key.face || candidate.level > transformed.key.level) {
            return false;
          }
          const divisor = 2 ** (transformed.key.level - candidate.level);
          return candidate.x === Math.floor(transformed.key.x / divisor) &&
            candidate.y === Math.floor(transformed.key.y / divisor);
        });
        expect(covering?.level).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("stays finite, stable, capped, and balanced at all approved camera scales", () => {
    const directions: Array<readonly [number, number, number]> = [
      ...CUBE_FACES.map((face) => cubeFaceDirection(face, 0, 0)),
      [1, 0, -1],
      [1, 1, 1],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
    ];
    for (const distance of [3.68, 2.5, 1.78, 1.4]) {
      for (const direction of directions) {
        const first = selectCubeLod({ camera: camera(direction, distance), maxLevel: 4 });
        const second = selectCubeLod({ camera: camera(direction, distance), maxLevel: 4 });
        assertSelection(first);
        expect(second).toEqual(first);
      }
    }

    const close = selectCubeLod({
      camera: camera([1, 1, 1], 1.4), maxLevel: 4, maxLeaves: 12,
    });
    assertSelection(close, 12, 4);
    expect(close.capped).toBe(true);
  });

  it("uses previous leaves for the 180/125px split-merge hysteresis band", () => {
    const direction: readonly [number, number, number] = normalized([1, 0.3, -0.2]);
    let observed:
      | { fresh: CubeLodSelection; retained: CubeLodSelection; distance: number }
      | undefined;
    for (let distance = 1.5; distance <= 8; distance += 0.05) {
      const close = selectCubeLod({ camera: camera(direction, Math.max(1.2, distance - 0.8)) });
      const fresh = selectCubeLod({ camera: camera(direction, distance) });
      const retained = selectCubeLod({
        camera: camera(direction, distance), previousKeys: close.leaves.map((leaf) => leaf.key),
      });
      if (retained.leaves.length > fresh.leaves.length) {
        observed = { fresh, retained, distance };
        break;
      }
    }
    expect(observed).toBeDefined();
    assertSelection(observed!.fresh);
    assertSelection(observed!.retained);
    const repeated = selectCubeLod({
      camera: camera(direction, observed!.distance),
      previousKeys: observed!.retained.leaves.map((leaf) => leaf.key),
    });
    expect(repeated.leaves.map((leaf) => leaf.id)).toEqual(
      observed!.retained.leaves.map((leaf) => leaf.id),
    );
  });

  it("refines a grazing exaggerated peak when the caller supplies relief padding", () => {
    const observerDistance = 1.4;
    const displacement = (10_000 * 30) / 6_371_000;
    const extension = reliefHorizonExtensionRadians(observerDistance, displacement);
    const unitHorizon = Math.acos(1 / observerDistance);
    const grazingAngle = unitHorizon + extension * 0.72;
    const grazingDirection: readonly [number, number, number] = [
      Math.cos(grazingAngle),
      Math.sin(grazingAngle),
      0,
    ];
    const grazingLocation = directionToCubeFaceUv(grazingDirection);
    const previousLevel = 4;
    const previousCount = 2 ** previousLevel;
    const previousKeys: CubeTileKey[] = [{
      face: grazingLocation.face,
      level: previousLevel,
      x: Math.min(previousCount - 1, Math.floor(
        ((grazingLocation.u + 1) / 2) * previousCount,
      )),
      y: Math.min(previousCount - 1, Math.floor(
        ((1 - grazingLocation.v) / 2) * previousCount,
      )),
    }];
    const baseInput = {
      camera: camera([1, 0, 0], observerDistance),
      maxLevel: 4,
      maxLeaves: 96,
      // Isolate hysteresis retention at the grazing branch: a previously
      // refined tile uses the zero merge threshold, while fresh branches do
      // not cross this intentionally high split threshold.
      splitPixels: 10_000,
      mergePixels: 0,
      previousKeys,
    };
    const unitSphere = selectCubeLod(baseInput);
    const reliefAware = selectCubeLod({
      ...baseInput,
      horizonPaddingRadians: 0.015 + extension,
    });
    assertSelection(unitSphere);
    assertSelection(reliefAware);
    expect(selectionLevelAtDirection(unitSphere, grazingDirection)).toBeDefined();
    expect(selectionLevelAtDirection(reliefAware, grazingDirection)).toBeGreaterThan(
      selectionLevelAtDirection(unitSphere, grazingDirection)!,
    );
  });

  it("keeps complete coverage through an abrupt opposite-camera change", () => {
    const first = selectCubeLod({ camera: camera([1, 0, 0], 1.78) });
    const opposite = selectCubeLod({
      camera: camera([-1, 0, 0], 1.78),
      previousKeys: first.leaves.map((leaf) => leaf.key),
    });
    assertSelection(first);
    assertSelection(opposite);
    for (const face of CUBE_FACES) {
      expect(first.leaves.some((leaf) => leaf.key.face === face)).toBe(true);
      expect(opposite.leaves.some((leaf) => leaf.key.face === face)).toBe(true);
    }
  });

  it("keeps max-level and threshold validation explicit", () => {
    const limited = selectCubeLod({ camera: camera([1, 0, 0], 1.4), maxLevel: 2 });
    assertSelection(limited, 96, 2);
    expect(Math.max(...limited.leaves.map((leaf) => leaf.key.level))).toBeLessThanOrEqual(2);
    const surfaceLimit = selectCubeLod({ camera: camera([1, 1, 0], 1), maxLevel: 2 });
    expect(surfaceLimit.leaves.every((leaf) => Number.isFinite(leaf.projectedErrorPx))).toBe(true);
    expect(() => selectCubeLod({
      camera: camera([1, 0, 0], 2), splitPixels: 125, mergePixels: 125,
    })).toThrow(/mergePixels/);
    expect(() => selectCubeLod({
      camera: { ...camera([1, 0, 0], 2), direction: [0, 0, 0] },
    })).toThrow(/direction/);
  });
});
