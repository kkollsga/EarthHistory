import type { AxisAlignedBounds, Vec3Tuple } from "./bounds";
import type { ForwardPatchData } from "./patchGeometry";
import { EARTH_RADIUS_METRES } from "../../reconstruction/arithmetic";
import { Box3, BufferGeometry, Sphere, Vector3 } from "three";

const EMPTY_CHILD = -1;

export interface PatchBvh {
  readonly nodeBounds: Float64Array;
  readonly nodeChildren: Int32Array;
  readonly nodeRanges: Uint32Array;
  readonly triangleIndices: Uint32Array;
  readonly leafSize: number;
  readonly byteLength: number;
}

function assertBounds(bounds: AxisAlignedBounds): void {
  if (![...bounds.min, ...bounds.max].every(Number.isFinite)
      || bounds.min.some((value, axis) => value > bounds.max[axis]!)) {
    throw new Error("BVH bounds must be finite and ordered");
  }
}

function union(indices: readonly number[], source: readonly AxisAlignedBounds[]): AxisAlignedBounds {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const index of indices) {
    const bounds = source[index]!;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis]!, bounds.min[axis]!);
      max[axis] = Math.max(max[axis]!, bounds.max[axis]!);
    }
  }
  return { min: min as unknown as Vec3Tuple, max: max as unknown as Vec3Tuple };
}

/** Combines compiler-qualified per-vertex swept bounds without resampling motion. */
export function triangleBoundsFromPhysicalVertexBounds(
  patch: ForwardPatchData,
  vertexBoundsMetres: readonly AxisAlignedBounds[],
  planetRadiusMetres = EARTH_RADIUS_METRES,
): readonly AxisAlignedBounds[] {
  if (vertexBoundsMetres.length !== patch.poseModes.length
      || !Number.isFinite(planetRadiusMetres) || planetRadiusMetres <= 0) {
    throw new Error("BVH vertex-bound count mismatch");
  }
  vertexBoundsMetres.forEach(assertBounds);
  const vertexBounds = vertexBoundsMetres.map((bounds) => ({
    min: bounds.min.map((value) => value / planetRadiusMetres) as unknown as Vec3Tuple,
    max: bounds.max.map((value) => value / planetRadiusMetres) as unknown as Vec3Tuple,
  }));
  const triangleCount = patch.indices.length / 3;
  return Object.freeze(Array.from({ length: triangleCount }, (_, triangleIndex) => {
    const offset = triangleIndex * 3;
    return union([
      patch.indices[offset]!, patch.indices[offset + 1]!, patch.indices[offset + 2]!,
    ], vertexBounds);
  }));
}

/** Deterministic median BVH over conservative interval triangle bounds. */
export function buildPatchBvh(
  triangleBounds: readonly AxisAlignedBounds[],
  leafSize = 8,
  maximumTriangles = 65_536,
  maximumBytes = 16 * 1024 * 1024,
): PatchBvh {
  if (triangleBounds.length === 0 || !Number.isInteger(leafSize) || leafSize < 1 || leafSize > 16
      || !Number.isInteger(maximumTriangles) || maximumTriangles < 1
      || triangleBounds.length > maximumTriangles || !Number.isFinite(maximumBytes) || maximumBytes < 1) {
    throw new Error("BVH requires triangles and leafSize in [1, 16]");
  }
  // A binary median tree has at most 2n-1 nodes. Reject the final typed-array
  // allocation before constructing transient row arrays; source bounds remain caller-owned.
  const maximumNodeCount = 2 * triangleBounds.length - 1;
  const conservativeTypedBytes = maximumNodeCount * (6 * 8 + 2 * 4 + 2 * 4)
    + triangleBounds.length * 4;
  if (conservativeTypedBytes > maximumBytes) throw new Error("BVH byte bound exceeded");
  triangleBounds.forEach(assertBounds);
  const boundsRows: number[][] = [];
  const childRows: number[][] = [];
  const rangeRows: number[][] = [];
  const orderedTriangles: number[] = [];

  const build = (indices: number[]): number => {
    const nodeIndex = boundsRows.length;
    const bounds = union(indices, triangleBounds);
    boundsRows.push([...bounds.min, ...bounds.max]);
    childRows.push([EMPTY_CHILD, EMPTY_CHILD]);
    rangeRows.push([0, 0]);
    if (indices.length <= leafSize) {
      const start = orderedTriangles.length;
      orderedTriangles.push(...indices.sort((left, right) => left - right));
      rangeRows[nodeIndex] = [start, indices.length];
      return nodeIndex;
    }
    const spans = bounds.max.map((value, axis) => value - bounds.min[axis]!);
    const axis = spans.indexOf(Math.max(...spans));
    indices.sort((left, right) => {
      const leftBounds = triangleBounds[left]!;
      const rightBounds = triangleBounds[right]!;
      const leftCenter = leftBounds.min[axis]! + leftBounds.max[axis]!;
      const rightCenter = rightBounds.min[axis]! + rightBounds.max[axis]!;
      return leftCenter - rightCenter || left - right;
    });
    const middle = Math.floor(indices.length / 2);
    const left = build(indices.slice(0, middle));
    const right = build(indices.slice(middle));
    childRows[nodeIndex] = [left, right];
    return nodeIndex;
  };
  build(Array.from({ length: triangleBounds.length }, (_, index) => index));

  const nodeBounds = new Float64Array(boundsRows.flat());
  const nodeChildren = new Int32Array(childRows.flat());
  const nodeRanges = new Uint32Array(rangeRows.flat());
  const triangleIndices = new Uint32Array(orderedTriangles);
  const byteLength = nodeBounds.byteLength + nodeChildren.byteLength
    + nodeRanges.byteLength + triangleIndices.byteLength;
  if (byteLength > maximumBytes) throw new Error("BVH byte bound exceeded");
  return Object.freeze({
    nodeBounds,
    nodeChildren,
    nodeRanges,
    triangleIndices,
    leafSize,
    byteLength,
  });
}

function rayIntersectsNode(
  bvh: PatchBvh,
  nodeIndex: number,
  origin: Vec3Tuple,
  direction: Vec3Tuple,
): boolean {
  let near = 0;
  let far = Infinity;
  const offset = nodeIndex * 6;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = bvh.nodeBounds[offset + axis]!;
    const maximum = bvh.nodeBounds[offset + 3 + axis]!;
    if (Math.abs(direction[axis]!) < 1e-15) {
      if (origin[axis]! < minimum || origin[axis]! > maximum) return false;
      continue;
    }
    const inverse = 1 / direction[axis]!;
    let first = (minimum - origin[axis]!) * inverse;
    let second = (maximum - origin[axis]!) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (far < near) return false;
  }
  return far >= 0;
}

/** Returns a bounded candidate list for the exact sparse triangle test. */
export function queryPatchBvhRay(
  bvh: PatchBvh,
  origin: Vec3Tuple,
  rawDirection: Vec3Tuple,
  maxCandidates = 64,
): readonly number[] {
  if (![...origin, ...rawDirection].every(Number.isFinite)) {
    throw new Error("BVH ray must be finite");
  }
  const length = Math.hypot(...rawDirection);
  if (!(length > 1e-12) || !Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new Error("BVH ray and candidate bound are invalid");
  }
  const direction: Vec3Tuple = rawDirection.map((value) => value / length) as unknown as Vec3Tuple;
  const result: number[] = [];
  const stack = [0];
  while (stack.length > 0) {
    const nodeIndex = stack.pop()!;
    if (!rayIntersectsNode(bvh, nodeIndex, origin, direction)) continue;
    const childOffset = nodeIndex * 2;
    const left = bvh.nodeChildren[childOffset]!;
    const right = bvh.nodeChildren[childOffset + 1]!;
    if (left !== EMPTY_CHILD) {
      // Push right first so deterministic construction yields left-first traversal.
      stack.push(right, left);
      continue;
    }
    const start = bvh.nodeRanges[childOffset]!;
    const count = bvh.nodeRanges[childOffset + 1]!;
    for (let index = start; index < start + count; index += 1) {
      result.push(bvh.triangleIndices[index]!);
      if (result.length > maxCandidates) {
        throw new Error("BVH sparse candidate bound exceeded");
      }
    }
  }
  return Object.freeze(result);
}

/** Applies the same conservative root bound to Three's CPU frustum culling. */
export function applyPatchBvhGeometryBounds(geometry: BufferGeometry, bvh: PatchBvh): void {
  if (bvh.nodeBounds.length < 6) throw new Error("BVH root bound is absent");
  const box = new Box3(
    new Vector3(bvh.nodeBounds[0]!, bvh.nodeBounds[1]!, bvh.nodeBounds[2]!),
    new Vector3(bvh.nodeBounds[3]!, bvh.nodeBounds[4]!, bvh.nodeBounds[5]!),
  );
  geometry.boundingBox = box;
  geometry.boundingSphere = box.getBoundingSphere(new Sphere());
}
