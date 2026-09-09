import * as THREE from "three";

/**
 * Even subdivision depths avoid placing a geodesic vertex on either geographic
 * pole. Equirectangular UV seams therefore never collapse a full longitude row
 * into one displaced vertex fan.
 */
export function createPoleSafeShellGeometry(
  radius: number,
  detail: number,
): THREE.IcosahedronGeometry {
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new RangeError("Shell radius must be a positive finite number");
  }
  if (!Number.isInteger(detail) || detail < 0 || detail % 2 !== 0) {
    throw new RangeError("Pole-safe geodesic detail must be a non-negative even integer");
  }
  return new THREE.IcosahedronGeometry(radius, detail);
}

export function countVerticesAtGeographicPoles(
  geometry: THREE.BufferGeometry,
  tolerance = 1e-6,
): number {
  const positions = geometry.getAttribute("position");
  let count = 0;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const length = Math.hypot(x, y, z);
    if (length > 0 && Math.abs(Math.abs(y) / length - 1) <= tolerance) count += 1;
  }
  return count;
}
