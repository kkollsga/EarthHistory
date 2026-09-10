import { describe, expect, it } from "vitest";
import { intersectForwardPatchCandidates } from "./picking";
import {
  assertCoincidentSeams,
  createSyntheticEventFrontPatch,
  eventStripWidth,
  IDENTITY_QUATERNION,
} from "./prototypeFixtures";

const controls = (displayFraction: number) => ({
  motionStart: IDENTITY_QUATERNION,
  motionEnd: IDENTITY_QUATERNION,
  motionFraction: displayFraction,
  displayFraction,
  verticalExaggeration: 30,
});

describe("synthetic event-front topology", () => {
  it("opens a birth strip from coincident sibling fronts without seam cracks", () => {
    const patch = createSyntheticEventFrontPatch("ridge-birth");
    assertCoincidentSeams(patch, controls(0));
    assertCoincidentSeams(patch, controls(0.5));
    assertCoincidentSeams(patch, controls(1));
    expect(eventStripWidth(patch, controls(0))).toBeLessThan(1e-7);
    expect(eventStripWidth(patch, controls(1))).toBeGreaterThan(0.1);
  });

  it("closes and retires the synthetic consumption strip at its event front", () => {
    const patch = createSyntheticEventFrontPatch("subduction-consumption", 0.5);
    assertCoincidentSeams(patch, controls(0));
    assertCoincidentSeams(patch, controls(1));
    expect(eventStripWidth(patch, controls(0))).toBeGreaterThan(0.1);
    expect(eventStripWidth(patch, controls(1))).toBeLessThan(1e-7);
    expect(patch.activationStart[4]).toBe(1);
    expect(patch.activationEnd[4]).toBe(0);
  });

  it("ray-picks only the supplied candidate triangles from the displayed surface", () => {
    const patch = createSyntheticEventFrontPatch("ridge-birth");
    const hit = intersectForwardPatchCandidates(
      patch,
      controls(1),
      [2, 3],
      [2, 0, 0],
      [-1, 0, 0],
    );
    expect(hit).not.toBeNull();
    expect(hit?.triangleIndex).toBeGreaterThanOrEqual(2);
    expect(() => intersectForwardPatchCandidates(
      patch,
      controls(1),
      new Array(65).fill(0),
      [2, 0, 0],
      [-1, 0, 0],
    )).toThrow(/candidate bound/);
    expect(() => intersectForwardPatchCandidates(
      patch,
      controls(1),
      [2],
      [Number.NaN, 0, 0],
      [-1, 0, 0],
    )).toThrow(/finite/);
    expect(() => intersectForwardPatchCandidates(
      patch,
      controls(1),
      [2],
      [2, 0, 0],
      [0, 0, 0],
    )).toThrow(/non-zero/);

    const inactiveActivation = new Float32Array(patch.activationEnd);
    inactiveActivation.fill(0, 4, 8);
    expect(intersectForwardPatchCandidates(
      { ...patch, activationEnd: inactiveActivation },
      controls(1),
      [2, 3],
      [2, 0, 0],
      [-1, 0, 0],
    )).toBeNull();

    const consumed = createSyntheticEventFrontPatch("subduction-consumption");
    expect(intersectForwardPatchCandidates(
      consumed,
      controls(1),
      [2, 3],
      [2, 0, 0],
      [-1, 0, 0],
    )).toBeNull();
  });

});
