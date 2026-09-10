import {
  CUBE_FACES,
  cubeTileId,
  type CubeTileKey,
} from "./cubeSphere";
import { balanceCubeSelection } from "./cubeLod";

export interface CubeRenderPlan {
  renderKeys: CubeTileKey[];
  nextRequests: CubeTileKey[];
  complete: boolean;
}

/**
 * Meshes retain their field arrays independently of the LRU. Treat those
 * fields as resident for render planning without re-inserting an obsolete
 * temporal hierarchy into the bounded cache on every refinement pass.
 */
export function cubeRenderResidentIds(
  cachedIds: Iterable<string>,
  renderedKeys: Iterable<CubeTileKey>,
): Set<string> {
  const residentIds = new Set(cachedIds);
  for (const key of renderedKeys) residentIds.add(cubeTileId(key));
  return residentIds;
}

function compareKeys(left: CubeTileKey, right: CubeTileKey): number {
  return CUBE_FACES.indexOf(left.face) - CUBE_FACES.indexOf(right.face) ||
    left.level - right.level || left.y - right.y || left.x - right.x;
}

function sameKey(left: CubeTileKey, right: CubeTileKey): boolean {
  return cubeTileId(left) === cubeTileId(right);
}

function isDescendant(key: CubeTileKey, ancestor: CubeTileKey): boolean {
  if (key.face !== ancestor.face || key.level < ancestor.level) return false;
  const divisor = 2 ** (key.level - ancestor.level);
  return Math.floor(key.x / divisor) === ancestor.x &&
    Math.floor(key.y / divisor) === ancestor.y;
}

function children(key: CubeTileKey): CubeTileKey[] {
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

function parent(key: CubeTileKey): CubeTileKey | undefined {
  return key.level === 0
    ? undefined
    : {
        face: key.face,
        level: key.level - 1,
        x: Math.floor(key.x / 2),
        y: Math.floor(key.y / 2),
      };
}

function residentAncestor(
  key: CubeTileKey,
  residentIds: ReadonlySet<string>,
): CubeTileKey | undefined {
  let candidate: CubeTileKey | undefined = key;
  while (candidate !== undefined) {
    if (residentIds.has(cubeTileId(candidate))) return candidate;
    candidate = parent(candidate);
  }
  return undefined;
}

function stabilizeResidentBalance(
  input: CubeTileKey[],
  residentIds: ReadonlySet<string>,
): CubeTileKey[] {
  let keys = input;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const balanced = balanceCubeSelection(
      keys,
      Math.max(0, ...keys.map((key) => key.level)),
      Math.max(6, keys.length),
    );
    const resident = new Map<string, CubeTileKey>();
    for (const key of balanced) {
      const available = residentAncestor(key, residentIds);
      if (available !== undefined) resident.set(cubeTileId(available), available);
    }
    const next = [...resident.values()].sort(compareKeys);
    if (
      next.length === keys.length &&
      next.every((key, index) => sameKey(key, [...keys].sort(compareKeys)[index]))
    ) return next;
    keys = next;
  }
  return keys.sort(compareKeys);
}

/**
 * Resolve the deepest complete resident subtree for each visible cube face.
 * A parent remains rendered until every visible child branch replacing it is
 * resident, so asynchronous tile completion cannot expose a hole.
 */
export function planCubeRender(
  desiredLeaves: readonly CubeTileKey[],
  residentIds: ReadonlySet<string>,
): CubeRenderPlan {
  const desired = [...desiredLeaves].sort(compareKeys);
  for (let index = 0; index < desired.length; index += 1) {
    for (let candidate = index + 1; candidate < desired.length; candidate += 1) {
      if (
        isDescendant(desired[index], desired[candidate]) ||
        isDescendant(desired[candidate], desired[index])
      ) {
        throw new RangeError("Cube render plan requires non-overlapping desired leaves");
      }
    }
  }
  const hasDesiredBelow = (key: CubeTileKey) =>
    desired.some((candidate) => isDescendant(candidate, key));
  const isDesired = (key: CubeTileKey) => desired.some((candidate) => sameKey(candidate, key));

  const resolve = (key: CubeTileKey): CubeTileKey[] | null => {
    if (!hasDesiredBelow(key)) return [];
    if (isDesired(key)) return residentIds.has(cubeTileId(key)) ? [key] : null;
    const requiredChildren = children(key).filter(hasDesiredBelow);
    const resolvedChildren = requiredChildren.map(resolve);
    if (resolvedChildren.every((result): result is CubeTileKey[] => result !== null)) {
      return resolvedChildren.flat();
    }
    return residentIds.has(cubeTileId(key)) ? [key] : null;
  };

  const renderKeys: CubeTileKey[] = [];
  const missingRoots: CubeTileKey[] = [];
  for (const face of CUBE_FACES) {
    const root: CubeTileKey = { face, level: 0, x: 0, y: 0 };
    if (!hasDesiredBelow(root)) continue;
    const resolved = resolve(root);
    if (resolved === null) missingRoots.push(root);
    else renderKeys.push(...resolved);
  }

  let nextRequests = missingRoots;
  if (nextRequests.length === 0) {
    for (const rendered of renderKeys.sort(compareKeys)) {
      if (isDesired(rendered)) continue;
      const missing = children(rendered)
        .filter(hasDesiredBelow)
        .filter((child) => !residentIds.has(cubeTileId(child)));
      nextRequests.push(...missing);
    }
  }

  const balancedRenderKeys = stabilizeResidentBalance(renderKeys, residentIds);
  const desiredIds = new Set(desired.map(cubeTileId));
  const renderedIds = new Set(balancedRenderKeys.map(cubeTileId));
  const complete = desiredIds.size === renderedIds.size &&
    [...desiredIds].every((id) => renderedIds.has(id));
  return {
    renderKeys: balancedRenderKeys,
    nextRequests: nextRequests.sort(compareKeys),
    complete,
  };
}
