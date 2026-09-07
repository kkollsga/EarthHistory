import * as THREE from "three";
import type { LonLat } from "../data";

const DEG = Math.PI / 180;

export function lonLatToVector3(
  [longitude, latitude]: LonLat,
  radius = 1,
): THREE.Vector3 {
  const lon = longitude * DEG;
  const lat = latitude * DEG;
  const cosLat = Math.cos(lat);
  return new THREE.Vector3(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    -radius * cosLat * Math.sin(lon),
  );
}

export function vector3ToLonLat(vector: THREE.Vector3): LonLat {
  const normalized = vector.clone().normalize();
  return [
    normalizeLongitude((Math.atan2(-normalized.z, normalized.x) / Math.PI) * 180),
    (Math.asin(THREE.MathUtils.clamp(normalized.y, -1, 1)) / Math.PI) * 180,
  ];
}

export function normalizeLongitude(longitude: number): number {
  return ((longitude + 540) % 360) - 180;
}

export function angularDistanceDegrees(a: LonLat, b: LonLat): number {
  const latA = a[1] * DEG;
  const latB = b[1] * DEG;
  const deltaLon = normalizeLongitude(a[0] - b[0]) * DEG;
  const cosine =
    Math.sin(latA) * Math.sin(latB) +
    Math.cos(latA) * Math.cos(latB) * Math.cos(deltaLon);
  return Math.acos(THREE.MathUtils.clamp(cosine, -1, 1)) / DEG;
}

export interface DetailState {
  mode: "coarse" | "regional";
}

export function resolveDetailMode(
  cameraDistance: number,
  previous: DetailState["mode"],
): DetailState["mode"] {
  if (previous === "coarse" && cameraDistance < 2.35) return "regional";
  if (previous === "regional" && cameraDistance > 2.65) return "coarse";
  return previous;
}

export function pointInRing(point: LonLat, ring: LonLat[]): boolean {
  if (ring.length < 3) return false;
  const longitudes: number[] = [];
  for (let index = 0; index < ring.length; index++) {
    let longitude = ring[index][0];
    if (index > 0) {
      const previous = longitudes[index - 1];
      while (longitude - previous > 180) longitude -= 360;
      while (longitude - previous < -180) longitude += 360;
    }
    longitudes.push(longitude);
  }
  const center = longitudes.reduce((sum, value) => sum + value, 0) / longitudes.length;
  const px = point[0] + Math.round((center - point[0]) / 360) * 360;
  let inside = false;
  const py = point[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = longitudes[i];
    const xj = longitudes[j];
    const yi = ring[i][1];
    const yj = ring[j][1];

    const intersects =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}
