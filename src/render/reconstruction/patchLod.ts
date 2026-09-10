export interface PatchLodEdge {
  readonly seamId: string;
  readonly side: "a" | "b";
  readonly start: number;
  readonly end: number;
}

export interface PatchLodNode {
  readonly key: string;
  readonly level: number;
  readonly triangleCount: number;
  readonly projectedErrorPixels: number;
  readonly edges: readonly PatchLodEdge[];
  readonly children?: readonly string[];
}

export interface PatchLodLimits {
  readonly maxLevel: number;
  readonly maxLeaves: number;
  readonly maxTriangles: number;
  readonly splitPixels: number;
  readonly mergePixels: number;
}

export interface PatchLodStitch {
  readonly seamId: string;
  readonly coarseKey: string;
  readonly fineKey: string;
  readonly start: number;
  readonly end: number;
}

export interface PatchLodSelection {
  readonly leaves: readonly PatchLodNode[];
  readonly stitches: readonly PatchLodStitch[];
  readonly totalTriangles: number;
  readonly byteLength: number;
}

const EPSILON = 1e-9;

function overlaps(left: PatchLodEdge, right: PatchLodEdge): [number, number] | null {
  if (left.seamId !== right.seamId || left.side === right.side) return null;
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  return end - start > EPSILON ? [start, end] : null;
}

function validateHierarchy(nodes: readonly PatchLodNode[], roots: readonly string[]): Map<string, PatchLodNode> {
  if (nodes.length > 4_096) throw new Error("patch LOD hierarchy node bound exceeded");
  const byKey = new Map<string, PatchLodNode>();
  for (const node of nodes) {
    if (!node.key || byKey.has(node.key) || !Number.isInteger(node.level) || node.level < 0
        || !Number.isInteger(node.triangleCount) || node.triangleCount < 1
        || !Number.isFinite(node.projectedErrorPixels) || node.projectedErrorPixels < 0) {
      throw new Error("invalid patch LOD node");
    }
    for (const edge of node.edges) {
      if (!edge.seamId || !Number.isFinite(edge.start) || !Number.isFinite(edge.end)
          || edge.start < 0 || edge.end > 1 || edge.end - edge.start <= EPSILON) {
        throw new Error("invalid patch LOD seam interval");
      }
    }
    byKey.set(node.key, node);
  }
  if (roots.length === 0 || new Set(roots).size !== roots.length) {
    throw new Error("patch LOD requires unique roots");
  }
  const parent = new Map<string, string>();
  for (const node of nodes) {
    if (!node.children) continue;
    if (node.children.length < 2 || new Set(node.children).size !== node.children.length) {
      throw new Error("patch LOD split requires unique children");
    }
    for (const childKey of node.children) {
      const child = byKey.get(childKey);
      if (!child || child.level !== node.level + 1 || parent.has(childKey)) {
        throw new Error("patch LOD child hierarchy is invalid");
      }
      parent.set(childKey, node.key);
    }
    for (const parentEdge of node.edges) {
      const childEdges = node.children.flatMap((childKey) => byKey.get(childKey)!.edges)
        .filter((edge) => edge.seamId === parentEdge.seamId && edge.side === parentEdge.side);
      const points = [...new Set([
        parentEdge.start,
        parentEdge.end,
        ...childEdges.flatMap((edge) => [edge.start, edge.end]),
      ])].sort((left, right) => left - right);
      for (let index = 0; index < points.length - 1; index += 1) {
        const middle = (points[index]! + points[index + 1]!) / 2;
        const parentCovers = parentEdge.start <= middle && parentEdge.end >= middle;
        const childCoverage = childEdges.filter((edge) => edge.start <= middle && edge.end >= middle).length;
        if ((parentCovers && childCoverage !== 1) || (!parentCovers && childCoverage !== 0)) {
          throw new Error(`patch LOD child seam coverage mismatch for ${parentEdge.seamId}`);
        }
      }
    }
  }
  for (const root of roots) if (!byKey.has(root) || parent.has(root)) throw new Error("invalid patch LOD root");
  const reached = new Set<string>();
  const visit = (key: string, ancestors: Set<string>): void => {
    if (ancestors.has(key)) throw new Error("cyclic patch LOD hierarchy");
    reached.add(key);
    const next = new Set(ancestors).add(key);
    for (const child of byKey.get(key)!.children ?? []) visit(child, next);
  };
  roots.forEach((root) => visit(root, new Set()));
  if (reached.size !== nodes.length) throw new Error("patch LOD hierarchy contains unreachable nodes");
  return byKey;
}

function validateCoverage(leaves: readonly PatchLodNode[]): void {
  const bySeam = new Map<string, PatchLodEdge[]>();
  for (const leaf of leaves) {
    for (const edge of leaf.edges) {
      const entries = bySeam.get(edge.seamId) ?? [];
      entries.push(edge);
      bySeam.set(edge.seamId, entries);
    }
  }
  for (const [seamId, edges] of bySeam) {
    const points = [...new Set(edges.flatMap((edge) => [edge.start, edge.end]))].sort((a, b) => a - b);
    for (let index = 0; index < points.length - 1; index += 1) {
      const middle = (points[index]! + points[index + 1]!) / 2;
      const a = edges.filter((edge) => edge.side === "a" && edge.start <= middle && edge.end >= middle).length;
      const b = edges.filter((edge) => edge.side === "b" && edge.start <= middle && edge.end >= middle).length;
      if (a !== b || a > 1 || b > 1) throw new Error(`patch LOD seam coverage mismatch for ${seamId}`);
    }
  }
}

function findUnbalancedPair(leaves: readonly PatchLodNode[]): readonly [PatchLodNode, PatchLodNode] | null {
  for (let leftIndex = 0; leftIndex < leaves.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < leaves.length; rightIndex += 1) {
      const left = leaves[leftIndex]!;
      const right = leaves[rightIndex]!;
      if (Math.abs(left.level - right.level) <= 1) continue;
      if (left.edges.some((a) => right.edges.some((b) => overlaps(a, b)))) return [left, right];
    }
  }
  return null;
}

function splitLeaf(leaves: Map<string, PatchLodNode>, node: PatchLodNode, byKey: Map<string, PatchLodNode>): boolean {
  if (!node.children) return false;
  leaves.delete(node.key);
  for (const child of node.children) leaves.set(child, byKey.get(child)!);
  return true;
}

function closeBalance(
  leaves: Map<string, PatchLodNode>,
  byKey: Map<string, PatchLodNode>,
): boolean {
  for (;;) {
    const ordered = [...leaves.values()].sort((left, right) => left.key.localeCompare(right.key));
    const pair = findUnbalancedPair(ordered);
    if (!pair) return true;
    const coarse = pair[0].level < pair[1].level ? pair[0] : pair[1];
    if (!splitLeaf(leaves, coarse, byKey)) return false;
  }
}

function totalTriangles(leaves: Iterable<PatchLodNode>): number {
  let result = 0;
  for (const leaf of leaves) result += leaf.triangleCount;
  return result;
}

/**
 * Selects a deterministic patch LOD and reserves every balance closure inside
 * the same leaf/triangle transaction; accepted detail is never coarsened later.
 */
export function selectPatchLod(
  nodes: readonly PatchLodNode[],
  roots: readonly string[],
  limits: PatchLodLimits,
  previousLeafKeys: ReadonlySet<string> = new Set(),
): PatchLodSelection {
  const byKey = validateHierarchy(nodes, roots);
  if (!Number.isInteger(limits.maxLevel) || limits.maxLevel < 0
      || !Number.isInteger(limits.maxLeaves) || limits.maxLeaves < roots.length || limits.maxLeaves > 256
      || !Number.isInteger(limits.maxTriangles) || limits.maxTriangles < 1
      || !Number.isFinite(limits.splitPixels) || !Number.isFinite(limits.mergePixels)
      || limits.mergePixels < 0 || limits.mergePixels >= limits.splitPixels) {
    throw new Error("invalid patch LOD limits");
  }
  const leaves = new Map(roots.map((key) => [key, byKey.get(key)!]));
  const previouslyRefined = new Set<string>();
  const markAncestors = (key: string): boolean => {
    const node = byKey.get(key);
    if (!node) return false;
    for (const parent of nodes) {
      if (parent.children?.includes(key)) {
        previouslyRefined.add(parent.key);
        markAncestors(parent.key);
        break;
      }
    }
    return true;
  };
  for (const key of previousLeafKeys) if (!markAncestors(key)) throw new Error("unknown previous patch LOD leaf");

  for (;;) {
    const candidates = [...leaves.values()]
      .filter((node) => node.children && node.level < limits.maxLevel
        && node.projectedErrorPixels >= (previouslyRefined.has(node.key)
          ? limits.mergePixels : limits.splitPixels))
      .sort((left, right) => right.projectedErrorPixels - left.projectedErrorPixels
        || left.level - right.level || left.key.localeCompare(right.key));
    let accepted = false;
    for (const candidate of candidates) {
      const trial = new Map(leaves);
      splitLeaf(trial, candidate, byKey);
      if (!closeBalance(trial, byKey) || trial.size > limits.maxLeaves
          || totalTriangles(trial.values()) > limits.maxTriangles) continue;
      leaves.clear();
      for (const [key, value] of trial) leaves.set(key, value);
      accepted = true;
      break;
    }
    if (!accepted) break;
  }

  const ordered = [...leaves.values()].sort((left, right) => left.key.localeCompare(right.key));
  validateCoverage(ordered);
  if (findUnbalancedPair(ordered)) throw new Error("patch LOD balance closure failed");
  if (ordered.some((leaf) => leaf.level > limits.maxLevel)
      || ordered.length > limits.maxLeaves || totalTriangles(ordered) > limits.maxTriangles) {
    throw new Error("patch LOD roots exceed the selection limits");
  }
  const stitches: PatchLodStitch[] = [];
  for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
      const left = ordered[leftIndex]!;
      const right = ordered[rightIndex]!;
      if (Math.abs(left.level - right.level) !== 1) continue;
      for (const leftEdge of left.edges) {
        for (const rightEdge of right.edges) {
          const interval = overlaps(leftEdge, rightEdge);
          if (!interval) continue;
          const coarse = left.level < right.level ? left : right;
          const fine = coarse === left ? right : left;
          stitches.push({ seamId: leftEdge.seamId, coarseKey: coarse.key, fineKey: fine.key,
            start: interval[0], end: interval[1] });
        }
      }
    }
  }
  stitches.sort((left, right) => left.seamId.localeCompare(right.seamId)
    || left.start - right.start || left.fineKey.localeCompare(right.fineKey));
  const triangles = totalTriangles(ordered);
  return Object.freeze({
    leaves: Object.freeze(ordered),
    stitches: Object.freeze(stitches),
    totalTriangles: triangles,
    byteLength: ordered.length * 8 + stitches.length * 24,
  });
}

export interface PatchStitchFan {
  readonly stitch: PatchLodStitch;
  readonly coarseInteriorVertex: number;
  /** Fine-edge vertices ordered across the stitch interval, including both endpoints. */
  readonly fineBoundaryVertices: readonly number[];
}

/** Replaces a coarse boundary triangle with fans over every fine edge segment. */
export function buildPatchStitchFanIndices(fans: readonly PatchStitchFan[]): Uint32Array {
  const indices: number[] = [];
  for (const fan of fans) {
    if (!Number.isInteger(fan.coarseInteriorVertex) || fan.coarseInteriorVertex < 0
        || fan.fineBoundaryVertices.length < 2
        || fan.fineBoundaryVertices.some((index) => !Number.isInteger(index) || index < 0)) {
      throw new Error("invalid patch stitch fan");
    }
    for (let index = 0; index < fan.fineBoundaryVertices.length - 1; index += 1) {
      const first = fan.fineBoundaryVertices[index]!;
      const second = fan.fineBoundaryVertices[index + 1]!;
      if (first === second || first === fan.coarseInteriorVertex || second === fan.coarseInteriorVertex) {
        throw new Error("degenerate patch stitch fan");
      }
      indices.push(fan.coarseInteriorVertex, first, second);
    }
  }
  return new Uint32Array(indices);
}
