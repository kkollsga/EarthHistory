import { describe, expect, it } from "vitest";
import {
  numberScalarOps,
  type QuaternionWxyz,
  type UnitDirection,
} from "../../reconstruction/arithmetic";
import { evaluateForwardPatchVertex } from "./patchKernel";
import { assertQualifiedDeformingControls } from "./patchData";

const IDENTITY: QuaternionWxyz = [1, 0, 0, 0];

describe("evaluateForwardPatchVertex", () => {
  it("separates motion subsegment and display-control fractions", () => {
    const halfTurnAboutNorth: QuaternionWxyz = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const result = evaluateForwardPatchVertex(numberScalarOps, {
      poseMode: 0,
      referenceDirection: [1, 0, 0],
      deformingDirectionStart: [1, 0, 0],
      deformingDirectionEnd: [1, 0, 0],
      motionStart: IDENTITY,
      motionEnd: halfTurnAboutNorth,
      motionFraction: 0.5,
      displayHeightStartMetres: 1_000,
      displayHeightEndMetres: 5_000,
      displayFraction: 0.25,
      verticalExaggeration: 2,
      activationStart: 0,
      activationEnd: 1,
    });
    expect(result.gplatesDirection[0]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(result.gplatesDirection[1]).toBeCloseTo(Math.SQRT1_2, 12);
    expect(result.activation).toBeCloseTo(0.25, 12);
    expect(Math.hypot(...result.rendererPosition)).toBeCloseTo(
      1 + 4_000 / 6_371_000,
      12,
    );
  });

  it("uses compiler-qualified deforming endpoints without changing axis semantics", () => {
    const end = [0, 1, 0] as UnitDirection;
    const result = evaluateForwardPatchVertex(numberScalarOps, {
      poseMode: 1,
      referenceDirection: [0, 0, 1],
      deformingDirectionStart: [1, 0, 0],
      deformingDirectionEnd: end,
      motionStart: IDENTITY,
      motionEnd: IDENTITY,
      motionFraction: 1,
      displayHeightStartMetres: 0,
      displayHeightEndMetres: 0,
      displayFraction: 0,
      verticalExaggeration: 1,
      activationStart: 1,
      activationEnd: 1,
    });
    expect(result.gplatesDirection).toEqual([0, 1, 0]);
    expect(result.rendererDirection).toEqual([0, 0, -1]);
  });

  it("keeps rigid output finite with unused zero deformation attributes", () => {
    const result = evaluateForwardPatchVertex(numberScalarOps, {
      poseMode: 0,
      referenceDirection: [1, 0, 0],
      deformingDirectionStart: [0, 0, 0],
      deformingDirectionEnd: [0, 0, 0],
      motionStart: IDENTITY,
      motionEnd: IDENTITY,
      motionFraction: 0.5,
      displayHeightStartMetres: 0,
      displayHeightEndMetres: 0,
      displayFraction: 0.5,
      verticalExaggeration: 1,
      activationStart: 1,
      activationEnd: 1,
    });
    expect(result.rendererPosition.every(Number.isFinite)).toBe(true);
    expect(result.rendererPosition).toEqual([1, 0, -0]);
  });

  it("rejects corrupt active deformation while allowing unused rigid zeros", () => {
    expect(() => assertQualifiedDeformingControls(
      [0, 1],
      [0, 0, 0, 1, 0, 0],
      [0, 0, 0, -1, 0, 0],
    )).toThrow(/non-antipodal/);
    expect(() => assertQualifiedDeformingControls([0], [0, 0, 0], [0, 0, 0]))
      .not.toThrow();
    expect(() => assertQualifiedDeformingControls([1], [2, 0, 0], [1, 0, 0]))
      .toThrow(/unit length/);
  });
});
