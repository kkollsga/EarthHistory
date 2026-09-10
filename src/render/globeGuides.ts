import * as THREE from "three";
import type { LonLat } from "../data";
import { lonLatToVector3 } from "./math";

export type GuideLabelPath = "parallel" | "meridian";

export interface GuideLabelSpec {
  readonly text: string;
  readonly coordinates: LonLat;
  readonly path: GuideLabelPath;
}

/** Schematic climate / graticule labels fixed in geographic space. */
export const REFERENCE_GUIDE_LABELS: readonly GuideLabelSpec[] = Object.freeze([
  { text: "North pole", coordinates: [25, 86], path: "parallel" },
  { text: "South pole", coordinates: [25, -86], path: "parallel" },
  { text: "Equator", coordinates: [-15, 0], path: "parallel" },
  { text: "Hadley edge · 30° N", coordinates: [-40, 30], path: "parallel" },
  { text: "Hadley edge · 30° S", coordinates: [-40, -30], path: "parallel" },
  { text: "Polar cell edge · 60° N", coordinates: [-70, 60], path: "parallel" },
  { text: "Polar cell edge · 60° S", coordinates: [-70, -60], path: "parallel" },
  { text: "Prime meridian", coordinates: [4, 50], path: "meridian" },
  { text: "Antimeridian", coordinates: [176, 50], path: "meridian" },
]);

export function createReferenceGuideLines(): readonly LonLat[][] {
  const latitude = (value: number): LonLat[] => Array.from({ length: 181 }, (_, index) =>
    [-180 + index * 2, value] as LonLat);
  const meridian = (value: number): LonLat[] => Array.from({ length: 45 }, (_, index) =>
    [value, -88 + index * 4] as LonLat);
  return [latitude(0), latitude(30), latitude(-30), latitude(60), latitude(-60),
    latitude(87.5), latitude(-87.5), meridian(0), meridian(180)];
}

export function createGuideLabelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Unable to create guide-label texture");
  context.clearRect(0, 0, 384, 64);
  context.font = "600 34px system-ui, sans-serif";
  context.letterSpacing = "0.5px";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(1, 8, 10, 0.9)";
  context.shadowBlur = 4;
  context.fillStyle = "rgba(188, 216, 211, 0.92)";
  context.fillText(text.toUpperCase(), 192, 32, 360);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.premultiplyAlpha = true;
  return texture;
}

/**
 * Builds a thin ribbon mesh that follows a parallel or meridian so the label
 * sits curved on the globe and rotates with geographic space (not billboarded).
 */
export function createCurvedGuideLabelGeometry(
  path: GuideLabelPath,
  center: LonLat,
  angularWidthRad: number,
  angularHeightRad: number,
  radius: number,
  samples = 28,
): { geometry: THREE.BufferGeometry; centerDirection: THREE.Vector3 } {
  if (!(angularWidthRad > 0) || !(angularHeightRad > 0) || !(radius > 0)
      || !Number.isSafeInteger(samples) || samples < 2) {
    throw new Error("invalid curved guide-label shape");
  }
  const [lon0, lat0] = center;
  const halfW = angularWidthRad / 2;
  const halfH = angularHeightRad / 2;
  const positions = new Float32Array((samples + 1) * 2 * 3);
  const uvs = new Float32Array((samples + 1) * 2 * 2);
  const indices = new Uint16Array(samples * 6);
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const outward = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const side = new THREE.Vector3();
  const top = new THREE.Vector3();
  const bottom = new THREE.Vector3();

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const offset = -halfW + t * angularWidthRad;
    const lon = path === "parallel" ? lon0 + offset * (180 / Math.PI) : lon0;
    const lat = path === "meridian" ? lat0 + offset * (180 / Math.PI) : lat0;
    const clampedLat = Math.max(-89.9, Math.min(89.9, lat));
    const point = lonLatToVector3([lon, clampedLat], radius);
    outward.copy(point).normalize();
    // Renderer frame: +Y north, lon from +X toward -Z. Build geographic east/north.
    const lonRad = lon * Math.PI / 180;
    const latRad = clampedLat * Math.PI / 180;
    const cosLat = Math.cos(latRad);
    const sinLat = Math.sin(latRad);
    east.set(-Math.sin(lonRad), 0, -Math.cos(lonRad)).normalize();
    north.set(-sinLat * Math.cos(lonRad), cosLat, sinLat * Math.sin(lonRad)).normalize();
    if (east.lengthSq() < 1e-8 || north.lengthSq() < 1e-8) {
      east.set(1, 0, 0);
      north.crossVectors(outward, east).normalize();
      east.crossVectors(north, outward).normalize();
    }
    tangent.copy(path === "parallel" ? east : north);
    side.copy(path === "parallel" ? north : east).multiplyScalar(halfH * radius);
    top.copy(point).add(side);
    bottom.copy(point).sub(side);
    // Re-project onto the shell so the ribbon stays globe-fixed and curved.
    top.copy(top.normalize().multiplyScalar(radius));
    bottom.copy(bottom.normalize().multiplyScalar(radius));
    const base = index * 6;
    positions[base] = top.x; positions[base + 1] = top.y; positions[base + 2] = top.z;
    positions[base + 3] = bottom.x; positions[base + 4] = bottom.y; positions[base + 5] = bottom.z;
    const uv = index * 4;
    uvs[uv] = t; uvs[uv + 1] = 1;
    uvs[uv + 2] = t; uvs[uv + 3] = 0;
    if (index < samples) {
      const v = index * 2;
      const i = index * 6;
      indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2;
      indices[i + 3] = v + 1; indices[i + 4] = v + 3; indices[i + 5] = v + 2;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return {
    geometry,
    centerDirection: lonLatToVector3(center).normalize(),
  };
}

export function createCurvedGuideLabelMesh(
  spec: GuideLabelSpec,
  radius = 1.0022,
): THREE.Mesh {
  const texture = createGuideLabelTexture(spec.text);
  const angularHeight = 0.026;
  const aspect = Math.max(1, (texture.image as HTMLCanvasElement).width
    / Math.max(1, (texture.image as HTMLCanvasElement).height));
  const angularWidth = Math.min(1.15, angularHeight * aspect * 0.92);
  const { geometry, centerDirection } = createCurvedGuideLabelGeometry(
    spec.path, spec.coordinates, angularWidth, angularHeight, radius);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.72,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    alphaTest: 0.04,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2.9;
  mesh.frustumCulled = false;
  mesh.userData.overlayLayer = "guides";
  mesh.userData.evidence = "schematic-climatological-reference";
  mesh.userData.guideLabelDirection = centerDirection;
  mesh.userData.ownedTexture = texture;
  mesh.userData.guideSurfaceLabel = true;
  return mesh;
}

/** Flat polar sector ticks drawn on the sphere (short meridian marks). */
export function createPolarSectorTickGeometry(
  latitudeSign: 1 | -1,
  radius = 1.0014,
  sectors = 12,
  outerLat = 88.05,
  innerLat = 89.55,
): THREE.BufferGeometry {
  if (!Number.isSafeInteger(sectors) || sectors < 4 || sectors > 36) {
    throw new Error("invalid polar sector count");
  }
  const positions = new Float32Array(sectors * 2 * 3);
  for (let index = 0; index < sectors; index += 1) {
    const lon = -180 + (index / sectors) * 360;
    const outer = lonLatToVector3([lon, latitudeSign * outerLat], radius);
    const inner = lonLatToVector3([lon, latitudeSign * innerLat], radius);
    const offset = index * 6;
    positions[offset] = outer.x; positions[offset + 1] = outer.y; positions[offset + 2] = outer.z;
    positions[offset + 3] = inner.x; positions[offset + 4] = inner.y; positions[offset + 5] = inner.z;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createPolarSectorTickLines(latitudeSign: 1 | -1): THREE.LineSegments {
  const geometry = createPolarSectorTickGeometry(latitudeSign);
  const material = new THREE.LineBasicMaterial({
    color: 0xc5ddd6,
    transparent: true,
    opacity: 0.7,
    depthTest: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 3;
  lines.frustumCulled = false;
  lines.userData.overlayLayer = "guides";
  lines.userData.guidePoleMarker = true;
  lines.userData.guideLabelDirection = new THREE.Vector3(0, latitudeSign, 0);
  return lines;
}
