import { describe, expect, it } from "vitest";
import { assertForwardPatchControls, assertForwardPatchData } from "./patchGeometry";
import { createForwardPatchNodeGraph, updateForwardPatchUniforms } from "./terrainNodes";
import { createSyntheticEventFrontPatch, IDENTITY_QUATERNION } from "./prototypeFixtures";

describe("forward patch boundary validation", () => {
  it("rejects non-finite, non-unit, or out-of-contract GPU controls", () => {
    const valid = {
      motionStart: IDENTITY_QUATERNION,
      motionEnd: IDENTITY_QUATERNION,
      motionFraction: 0.5,
      displayFraction: 0.5,
      verticalExaggeration: 8,
    };
    expect(() => assertForwardPatchControls(valid)).not.toThrow();
    expect(() => assertForwardPatchControls({ ...valid, motionStart: [2, 0, 0, 0] }))
      .toThrow(/unit length/);
    expect(() => assertForwardPatchControls({ ...valid, displayFraction: Number.NaN }))
      .toThrow(/fractions/);
    expect(() => assertForwardPatchControls({ ...valid, verticalExaggeration: 31 }))
      .toThrow(/exaggeration/);
  });

  it("rejects invalid patch directions, attributes, and active deformation", () => {
    const valid = createSyntheticEventFrontPatch("ridge-birth");
    expect(() => assertForwardPatchData(valid)).not.toThrow();

    const directions = new Float32Array(valid.referenceDirections);
    directions[0] = Number.NaN;
    expect(() => assertForwardPatchData({ ...valid, referenceDirections: directions }))
      .toThrow(/finite/);

    const activation = new Float32Array(valid.activationEnd);
    activation[0] = 2;
    expect(() => assertForwardPatchData({ ...valid, activationEnd: activation }))
      .toThrow(/activation/);

    const mixedLifecycle = new Float32Array(valid.activationEnd);
    mixedLifecycle[valid.indices[0]!] = 0.5;
    expect(() => assertForwardPatchData({ ...valid, activationEnd: mixedLifecycle }))
      .toThrow(/triangle-coherent/);

    const deforming = new Float32Array(valid.deformingDirectionsEnd);
    deforming[0] *= 2;
    expect(() => assertForwardPatchData({ ...valid, deformingDirectionsEnd: deforming }))
      .toThrow(/unit length/);
  });

  it("validates the patch-cohort lifecycle uniforms", () => {
    const graph = createForwardPatchNodeGraph();
    const controls = { motionStart: IDENTITY_QUATERNION, motionEnd: IDENTITY_QUATERNION,
      motionFraction: 0.5, displayFraction: 0.5, verticalExaggeration: 8 };
    expect(() => updateForwardPatchUniforms(graph.uniforms,
      { ...controls, activationStart: 0, activationEnd: 1 })).not.toThrow();
    expect(() => updateForwardPatchUniforms(graph.uniforms,
      { ...controls, activationStart: -1 })).toThrow(/activation/);
  });
});
