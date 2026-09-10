import { numberScalarOps } from "../../reconstruction/arithmetic";
import type { Vec3Tuple } from "./bounds";
import { evaluateForwardPatchVertex, type ForwardPatchVertexResult } from "./patchKernel";
import {
  assertForwardPatchControls,
  type ForwardPatchControls,
  type ForwardPatchData,
} from "./patchGeometry";
import { queryPatchBvhRay, type PatchBvh } from "./spatialIndex";

export interface SparsePatchHit {
  readonly triangleIndex: number;
  readonly distance: number;
  readonly barycentric: Vec3Tuple;
  readonly position: Vec3Tuple;
}

export function evaluateForwardPatchVertexAt(
  patch: ForwardPatchData,
  controls: ForwardPatchControls,
  index: number,
): Vec3Tuple {
  return evaluateForwardPatchVertexResultAt(patch, controls, index).rendererPosition;
}

export function evaluateForwardPatchVertexResultAt(
  patch: ForwardPatchData,
  controls: ForwardPatchControls,
  index: number,
): ForwardPatchVertexResult<number> {
  if (!Number.isInteger(index) || index < 0 || index >= patch.poseModes.length) {
    throw new Error("invalid forward patch vertex index");
  }
  const offset = index * 3;
  const direction = (array: Float32Array): Vec3Tuple => [
    array[offset]!, array[offset + 1]!, array[offset + 2]!,
  ];
  return evaluateForwardPatchVertex(numberScalarOps, {
    poseMode: patch.poseModes[index]!,
    referenceDirection: direction(patch.referenceDirections),
    deformingDirectionStart: direction(patch.deformingDirectionsStart),
    deformingDirectionEnd: direction(patch.deformingDirectionsEnd),
    motionStart: controls.motionStart,
    motionEnd: controls.motionEnd,
    motionFraction: controls.motionFraction,
    displayHeightStartMetres: patch.displayHeightsStartMetres[index]!,
    displayHeightEndMetres: patch.displayHeightsEndMetres[index]!,
    displayFraction: controls.displayFraction,
    verticalExaggeration: controls.verticalExaggeration,
    activationStart: patch.activationStart[index]!,
    activationEnd: patch.activationEnd[index]!,
  });
}

function subtract(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(left: Vec3Tuple, right: Vec3Tuple): Vec3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(left: Vec3Tuple, right: Vec3Tuple): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function intersectRayTriangle(
  origin: Vec3Tuple,
  ray: Vec3Tuple,
  a: Vec3Tuple,
  b: Vec3Tuple,
  c: Vec3Tuple,
): Omit<SparsePatchHit, "triangleIndex"> | null {
  const edge1 = subtract(b, a);
  const edge2 = subtract(c, a);
  const p = cross(ray, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-10) return null;
  const inverse = 1 / determinant;
  const t = subtract(origin, a);
  const u = dot(t, p) * inverse;
  if (u < 0 || u > 1) return null;
  const q = cross(t, edge1);
  const v = dot(ray, q) * inverse;
  if (v < 0 || u + v > 1) return null;
  const distance = dot(edge2, q) * inverse;
  if (distance < 0) return null;
  return {
    distance,
    barycentric: [1 - u - v, u, v],
    position: [
      origin[0] + ray[0] * distance,
      origin[1] + ray[1] * distance,
      origin[2] + ray[2] * distance,
    ],
  };
}

/** Evaluates only BVH-selected triangles; it never generates a complete CPU surface. */
export function intersectForwardPatchCandidates(
  patch: ForwardPatchData,
  controls: ForwardPatchControls,
  candidateTriangleIndices: readonly number[],
  rayOrigin: Vec3Tuple,
  rayDirection: Vec3Tuple,
): SparsePatchHit | null {
  assertForwardPatchControls(controls);
  if (![...rayOrigin, ...rayDirection].every(Number.isFinite)) {
    throw new Error("sparse picking ray must be finite");
  }
  const rayLength = Math.hypot(...rayDirection);
  if (!(rayLength > 1e-12)) {
    throw new Error("sparse picking ray direction must be non-zero");
  }
  const normalizedRay: Vec3Tuple = [
    rayDirection[0] / rayLength,
    rayDirection[1] / rayLength,
    rayDirection[2] / rayLength,
  ];
  if (candidateTriangleIndices.length > 64) {
    throw new Error("sparse picking candidate bound exceeded");
  }
  let nearest: SparsePatchHit | null = null;
  for (const triangleIndex of candidateTriangleIndices) {
    const offset = triangleIndex * 3;
    if (!Number.isInteger(triangleIndex) || offset < 0 || offset + 2 >= patch.indices.length) {
      throw new Error("invalid sparse picking triangle index");
    }
    const vertexIndices = [
      patch.indices[offset]!,
      patch.indices[offset + 1]!,
      patch.indices[offset + 2]!,
    ] as const;
    const evaluated = vertexIndices.map((index) => (
      evaluateForwardPatchVertexResultAt(patch, controls, index)
    ));
    if (evaluated.every((item) => item.activation <= 1e-4)) continue;
    const hit = intersectRayTriangle(
      rayOrigin,
      normalizedRay,
      evaluated[0]!.rendererPosition,
      evaluated[1]!.rendererPosition,
      evaluated[2]!.rendererPosition,
    );
    if (hit) {
      const activation = hit.barycentric.reduce((sum, weight, index) => (
        sum + weight * evaluated[index]!.activation
      ), 0);
      if (activation <= 1e-4) continue;
    }
    if (hit && (!nearest || hit.distance < nearest.distance)) {
      nearest = { triangleIndex, ...hit };
    }
  }
  return nearest;
}

export function intersectForwardPatchBvh(
  patch: ForwardPatchData,
  controls: ForwardPatchControls,
  bvh: PatchBvh,
  rayOrigin: Vec3Tuple,
  rayDirection: Vec3Tuple,
  maxCandidates = 64,
): SparsePatchHit | null {
  return intersectForwardPatchCandidates(
    patch,
    controls,
    queryPatchBvhRay(bvh, rayOrigin, rayDirection, maxCandidates),
    rayOrigin,
    rayDirection,
  );
}
