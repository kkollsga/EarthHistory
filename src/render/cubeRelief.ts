import { EARTH_RADIUS_METRES } from "./surface";

/**
 * Angular visibility beyond the unit-sphere horizon for a radial relief shell.
 * The caller adds its ordinary numeric/LOD padding separately.
 */
export function reliefHorizonExtensionRadians(
  cameraDistance: number,
  maximumPositiveDisplacement: number,
): number {
  const distance = Math.max(1.0001, Number.isFinite(cameraDistance) ? cameraDistance : 1.0001);
  const radius = 1 + Math.max(
    0,
    Number.isFinite(maximumPositiveDisplacement) ? maximumPositiveDisplacement : 0,
  );
  if (radius <= 1) return 0;
  if (radius >= distance) return Math.PI / 2;
  const unitHorizon = Math.acos(1 / distance);
  const tangent = Math.sqrt(
    Math.max(0, (distance * distance - 1) * (radius * radius - 1)),
  );
  const elevatedCosine = Math.max(-1, Math.min(1, (1 - tangent) / (distance * radius)));
  return Math.max(0, Math.acos(elevatedCosine) - unitHorizon);
}

export function updateCubeDisplayGeometry(
  directions: Float32Array,
  heightsMetres: Float32Array,
  physicalNormals: Float32Array,
  verticalExaggeration: number,
  positions: Float32Array,
  normals: Float32Array,
): void {
  const exaggeration = Math.max(1, Math.min(30, verticalExaggeration));
  for (let index = 0; index < heightsMetres.length; index++) {
    const offset = index * 3;
    const dx = directions[offset];
    const dy = directions[offset + 1];
    const dz = directions[offset + 2];
    const heightRatio = heightsMetres[index] / EARTH_RADIUS_METRES;
    const radius = 1 + heightRatio * exaggeration;
    positions[offset] = dx * radius;
    positions[offset + 1] = dy * radius;
    positions[offset + 2] = dz * radius;

    const nx = physicalNormals[offset];
    const ny = physicalNormals[offset + 1];
    const nz = physicalNormals[offset + 2];
    const radialDot = Math.max(0.05, nx * dx + ny * dy + nz * dz);
    const slopeScale =
      exaggeration * (1 + heightRatio) /
      Math.max(0.05, 1 + exaggeration * heightRatio);
    const tx = ((nx - dx * radialDot) / radialDot) * slopeScale;
    const ty = ((ny - dy * radialDot) / radialDot) * slopeScale;
    const tz = ((nz - dz * radialDot) / radialDot) * slopeScale;
    const inverseLength = 1 / Math.hypot(dx + tx, dy + ty, dz + tz);
    normals[offset] = (dx + tx) * inverseLength;
    normals[offset + 1] = (dy + ty) * inverseLength;
    normals[offset + 2] = (dz + tz) * inverseLength;
  }
}
