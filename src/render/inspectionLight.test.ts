import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { setInspectionLightPosition } from "./inspectionLight";

const OLD_FALLBACK_LATITUDE = THREE.MathUtils.radToDeg(Math.acos(0.1));

function cameraAt(latitude: number, azimuth: number): THREE.PerspectiveCamera {
  const latitudeRadians = THREE.MathUtils.degToRad(latitude);
  const azimuthRadians = THREE.MathUtils.degToRad(azimuth);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(
    Math.cos(latitudeRadians) * Math.cos(azimuthRadians),
    Math.sin(latitudeRadians),
    Math.cos(latitudeRadians) * Math.sin(azimuthRadians),
  );
  camera.lookAt(0, 0, 0);
  return camera;
}

function lightDirection(latitude: number, azimuth: number): THREE.Vector3 {
  const camera = cameraAt(latitude, azimuth);
  return setInspectionLightPosition(
    new THREE.Vector3(),
    camera.position,
  ).normalize();
}

describe("inspection light", () => {
  it.each([
    ["north", 1],
    ["south", -1],
  ] as const)("stays continuous across the former %s-polar fallback", (_name, sign) => {
    for (const azimuth of [0, 47, 133]) {
      const before = lightDirection(sign * (OLD_FALLBACK_LATITUDE - 0.01), azimuth);
      const after = lightDirection(sign * (OLD_FALLBACK_LATITUDE + 0.01), azimuth);
      const changeDegrees = THREE.MathUtils.radToDeg(before.angleTo(after));

      expect(changeDegrees).toBeLessThan(0.05);
    }
  });

  it("keeps the viewer-facing hemisphere directly lit at every camera bearing", () => {
    const target = new THREE.Vector3();

    for (const latitude of [-90, -65, 0, 65, 90]) {
      const camera = cameraAt(latitude, 47);
      const result = setInspectionLightPosition(
        target,
        camera.position,
      );

      expect(result).toBe(target);
      expect(result.toArray().every(Number.isFinite)).toBe(true);
      expect(result.length()).toBeCloseTo(5.7, 12);
      expect(result.clone().normalize().dot(camera.position.clone().normalize()))
        .toBeCloseTo(1, 12);
    }
  });
});
