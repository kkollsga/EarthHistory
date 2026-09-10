import { describe, expect, it } from "vitest";
import { BufferGeometry } from "three";
import { numberScalarOps, gplatesToRendererDirection } from "../../reconstruction/arithmetic";
import oracle from "../../reconstruction/fixtures/cao-motion-0-5-v1.oracle.json";
import { applyPatchBvhGeometryBounds, buildPatchBvh, queryPatchBvhRay,
  triangleBoundsFromPhysicalVertexBounds } from "./spatialIndex";
import { createSyntheticEventFrontPatch } from "./prototypeFixtures";
import { intersectForwardPatchBvh } from "./picking";

describe("patch BVH", () => {
  it("returns bounded deterministic candidates from conservative triangle bounds", () => {
    const bounds = Array.from({ length: 20 }, (_, index) => ({
      min: [index * 2, -1, -1] as const,
      max: [index * 2 + 1, 1, 1] as const,
    }));
    const first = buildPatchBvh(bounds, 2);
    const second = buildPatchBvh(bounds, 2);
    expect([...first.nodeBounds]).toEqual([...second.nodeBounds]);
    expect([...first.triangleIndices]).toEqual([...second.triangleIndices]);
    expect(first.byteLength).toBe(
      first.nodeBounds.byteLength + first.nodeChildren.byteLength
      + first.nodeRanges.byteLength + first.triangleIndices.byteLength,
    );
    const candidates = queryPatchBvhRay(first, [-2, 0, 0], [1, 0, 0], 32);
    expect(candidates).toHaveLength(20);
    const geometry = new BufferGeometry();
    applyPatchBvhGeometryBounds(geometry, first);
    expect(geometry.boundingBox?.min.toArray()).toEqual([0, -1, -1]);
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(0);
    expect(() => queryPatchBvhRay(first, [-2, 0, 0], [1, 0, 0], 8))
      .toThrow(/candidate bound/);
  });

  it("builds triangle bounds from the compiler-qualified per-vertex envelope", () => {
    const patch = createSyntheticEventFrontPatch("ridge-birth");
    const vertexBounds = Array.from({ length: patch.poseModes.length }, (_, index) => ({
      min: [index, index + 1, index + 2] as const,
      max: [index + 0.5, index + 1.5, index + 2.5] as const,
    }));
    const triangles = triangleBoundsFromPhysicalVertexBounds(patch, vertexBounds, 1);
    expect(triangles[0]).toEqual({ min: [0, 1, 2], max: [2.5, 3.5, 4.5] });
    expect(buildPatchBvh(triangles).triangleIndices).toHaveLength(patch.indices.length / 3);
  });

  it("converts metre bounds to the unit-Earth renderer ray convention", () => {
    const sample = oracle.expected[32]!;
    const direction = gplatesToRendererDirection(numberScalarOps, sample.direction as [number, number, number]);
    const radiusMetres = 6_371_000 + 3_000 * 8;
    const pointMetres = direction.map((value) => value * radiusMetres) as [number, number, number];
    const padding = 2_000;
    const physical = {
      min: pointMetres.map((value) => value - padding) as [number, number, number],
      max: pointMetres.map((value) => value + padding) as [number, number, number],
    };
    const patch = createSyntheticEventFrontPatch("ridge-birth");
    const bounds = triangleBoundsFromPhysicalVertexBounds(
      patch,
      Array.from({ length: patch.poseModes.length }, () => physical),
    );
    const bvh = buildPatchBvh(bounds);
    const camera = direction.map((value) => value * 3) as [number, number, number];
    expect(queryPatchBvhRay(bvh, camera, direction.map((value) => -value) as [number, number, number]))
      .toContain(0);
  });

  it("feeds the bounded BVH candidates into the exact sparse triangle oracle", () => {
    const patch = createSyntheticEventFrontPatch("ridge-birth");
    const broad = Array.from({ length: patch.poseModes.length }, () => ({
      min: [0.8 * 6_371_000, -0.3 * 6_371_000, -0.3 * 6_371_000] as const,
      max: [1.1 * 6_371_000, 0.3 * 6_371_000, 0.3 * 6_371_000] as const,
    }));
    const bvh = buildPatchBvh(triangleBoundsFromPhysicalVertexBounds(patch, broad));
    const hit = intersectForwardPatchBvh(patch, {
      motionStart: [1, 0, 0, 0], motionEnd: [1, 0, 0, 0],
      motionFraction: 1, displayFraction: 1, verticalExaggeration: 1,
    }, bvh, [3, 0, 0], [-1, 0, 0]);
    expect(hit?.triangleIndex).toBeGreaterThanOrEqual(0);
    expect(hit?.position.every(Number.isFinite)).toBe(true);
  });

  it("rejects invalid rays and malformed bounds", () => {
    const bvh = buildPatchBvh([{ min: [-1, -1, -1], max: [1, 1, 1] }]);
    expect(() => queryPatchBvhRay(bvh, [0, 0, 0], [0, 0, 0])).toThrow(/invalid/);
    expect(() => queryPatchBvhRay(bvh, [Number.NaN, 0, 0], [1, 0, 0])).toThrow(/finite/);
    expect(() => buildPatchBvh([{ min: [1, 0, 0], max: [0, 1, 1] }]))
      .toThrow(/ordered/);
    expect(() => buildPatchBvh([
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [1, 0, 0], max: [2, 1, 1] },
    ], 1, 1)).toThrow(/requires triangles/);
    expect(() => buildPatchBvh([{ min: [0, 0, 0], max: [1, 1, 1] }], 1, 1, 1))
      .toThrow(/byte bound/);
  });
});
