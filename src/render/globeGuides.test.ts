import { describe, expect, it } from "vitest";
import {
  createCurvedGuideLabelGeometry,
  createPolarSectorTickGeometry,
  REFERENCE_GUIDE_LABELS,
} from "./globeGuides";

describe("globus-style guide overlays", () => {
  it("keeps curved label ribbons on the sphere shell", () => {
    const { geometry, centerDirection } = createCurvedGuideLabelGeometry(
      "parallel", [-15, 0], 0.4, 0.03, 1.002, 16);
    const positions = geometry.getAttribute("position");
    expect(positions.count).toBeGreaterThan(10);
    for (let index = 0; index < positions.count; index += 1) {
      const length = Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index));
      expect(length).toBeCloseTo(1.002, 3);
    }
    expect(Math.hypot(...centerDirection.toArray())).toBeCloseTo(1, 6);
    geometry.dispose();
  });

  it("builds flat polar sector ticks near each pole", () => {
    const north = createPolarSectorTickGeometry(1, 1.0014, 12);
    const positions = north.getAttribute("position");
    expect(positions.count).toBe(24);
    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index);
      expect(y).toBeGreaterThan(0.95);
      const length = Math.hypot(positions.getX(index), y, positions.getZ(index));
      expect(length).toBeCloseTo(1.0014, 3);
    }
    north.dispose();
    expect(REFERENCE_GUIDE_LABELS.some((label) => label.path === "meridian")).toBe(true);
  });
});
