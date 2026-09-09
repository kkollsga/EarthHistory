import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { setInspectionLightPosition, type InspectionLightScratch } from "./inspectionLight";

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

function scratch(): InspectionLightScratch {
  return {
    view: new THREE.Vector3(),
    right: new THREE.Vector3(),
    upward: new THREE.Vector3(),
  };
}

function lightDirection(latitude: number, azimuth: number): THREE.Vector3 {
  const camera = cameraAt(latitude, azimuth);
  return setInspectionLightPosition(
    new THREE.Vector3(),
    camera.position,
    camera.quaternion,
    scratch(),
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

  it("fills caller-owned vectors with a finite frame at both poles", () => {
    const target = new THREE.Vector3();
    const reusable = scratch();

    for (const latitude of [-90, 90]) {
      const camera = cameraAt(latitude, 0);
      const result = setInspectionLightPosition(
        target,
        camera.position,
        camera.quaternion,
        reusable,
      );

      expect(result).toBe(target);
      expect(result.toArray().every(Number.isFinite)).toBe(true);
      expect(reusable.view.length()).toBeCloseTo(1, 12);
      expect(reusable.right.length()).toBeCloseTo(1, 12);
      expect(reusable.upward.length()).toBeCloseTo(1, 12);
    }
  });
});
