import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  countVerticesAtGeographicPoles,
  createPoleSafeShellGeometry,
} from "./poleSafeGeometry";

describe("pole-safe synchronous shell geometry", () => {
  it("does not collapse textured vertices at a geographic pole", () => {
    const oldUvSphere = new THREE.SphereGeometry(1, 96, 48);
    const shell = createPoleSafeShellGeometry(1, 16);

    // This assertion is the regression discriminator: the old fallback has a
    // longitude fan at both poles, while the geodesic shell has neither pole.
    expect(countVerticesAtGeographicPoles(oldUvSphere)).toBeGreaterThan(2);
    expect(countVerticesAtGeographicPoles(shell)).toBe(0);
    expect(shell.getAttribute("uv").count).toBe(shell.getAttribute("position").count);
  });

  it("rejects odd detail levels that reintroduce exact polar vertices", () => {
    expect(() => createPoleSafeShellGeometry(1, 15)).toThrow(/even integer/);
  });
});
