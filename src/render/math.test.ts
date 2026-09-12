import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  angularDistanceDegrees,
  lonLatToVector3,
  pointInRing,
  resolveDetailMode,
  vector3ToLonLat,
  worldToGlobeLocalDirection,
} from "./math";
import { requestedRendererBackend } from "./GlobeScene";

describe("spherical render math", () => {
  it("maps cardinal longitudes onto the renderer sphere", () => {
    expect(lonLatToVector3([0, 0]).toArray()).toEqual([1, 0, -0]);
    const east = lonLatToVector3([90, 0]);
    expect(east.x).toBeCloseTo(0, 10);
    expect(east.z).toBeCloseTo(-1, 10);
    expect(vector3ToLonLat(lonLatToVector3([73, -28]))).toEqual([
      expect.closeTo(73, 8),
      expect.closeTo(-28, 8),
    ]);
  });

  it("handles dateline distances and polygons", () => {
    expect(angularDistanceDegrees([179, 0], [-179, 0])).toBeCloseTo(2, 8);
    const ring: [number, number][] = [
      [170, -10],
      [-170, -10],
      [-170, 10],
      [170, 10],
      [170, -10],
    ];
    expect(pointInRing([179, 0], ring)).toBe(true);
    expect(pointInRing([0, 0], ring)).toBe(false);
  });

  it("uses hysteresis around regional refinement", () => {
    expect(resolveDetailMode(2.34, "coarse")).toBe("regional");
    expect(resolveDetailMode(2.5, "regional")).toBe("regional");
    expect(resolveDetailMode(2.5, "coarse")).toBe("coarse");
    expect(resolveDetailMode(2.66, "regional")).toBe("coarse");
  });

  it("maps a world-space focus back into the rotated globe for its marker", () => {
    const localDirection = lonLatToVector3([31, 74]);
    const globeQuaternion = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      THREE.MathUtils.degToRad(-13.5),
    );
    const worldDirection = localDirection.clone().applyQuaternion(globeQuaternion);

    expect(worldToGlobeLocalDirection(worldDirection, globeQuaternion).toArray()).toEqual([
      expect.closeTo(localDirection.x, 10),
      expect.closeTo(localDirection.y, 10),
      expect.closeTo(localDirection.z, 10),
    ]);
    expect(worldDirection.angleTo(localDirection)).toBeGreaterThan(0.05);
  });

  it("exposes a deterministic WebGL2 compatibility route", () => {
    expect(requestedRendererBackend("?renderer=webgl2")).toBe("webgl2");
    expect(requestedRendererBackend("?age=95")).toBe("auto");
  });
});
