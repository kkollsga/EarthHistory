import type {
  ModernClimateGroup,
  ModernReliefPatch,
  SurfaceStage,
  WorldSnapshot,
} from "../data";
import {
  createCubeTileGeometry,
  cubeFaceDirection,
  cubeTileBounds,
  directionToCubeFaceUv,
  type CubeFace,
  type CubeTileKey,
} from "./cubeSphere";
import { createPerceptualDetailSampler } from "./perceptualDetail";
import {
  EARTH_RADIUS_METRES,
  sampleModernClimateGroup,
  sampleSurfaceLand,
  sampleSurfaceReliefMetres,
  type SurfaceDetail,
  type SurfaceFields,
  type SurfaceMode,
} from "./surface";

export interface CubeTileFieldContext {
  snapshot: WorldSnapshot;
  surface: SurfaceFields;
  mode: SurfaceMode;
  detail: SurfaceDetail;
  modernRelief?: ModernReliefPatch[];
}

export interface CubeTileFieldRequest {
  key: CubeTileKey;
  meshSegments: 32 | 64;
  textureSize: 64 | 128 | 256;
}

export interface CubeTileFields {
  key: CubeTileKey;
  meshSegments: 32 | 64;
  textureSize: 64 | 128 | 256;
  textureStride: number;
  directions: Float32Array;
  positions: Float32Array;
  normals: Float32Array;
  heightsMetres: Float32Array;
  localUvs: Float32Array;
  indices: Uint32Array;
  albedo: Uint8Array;
  roughness: Uint8Array;
  detailHeight: Uint8Array;
  minHeightMetres: number;
  maxHeightMetres: number;
  generationMs: number;
  byteLength: number;
  sourcePatchIds: string[];
}

export interface CubeTileFieldGenerator {
  generate(request: CubeTileFieldRequest): CubeTileFields;
  /** Sample the continuous physical height used to place cube vertices. */
  sampleHeightMetres(direction: readonly [number, number, number]): number;
  retainedBytes: number;
}

/**
 * Red, green, and blue all carry the same signed perceptual height. Code 128
 * is zero; codes 0..127 span -range..-range/128 and 129..255 span
 * +range/127..+range. Alpha is opaque. These are material-scale synthetic
 * bumps, never a second geographic relief source.
 */
export const DETAIL_HEIGHT_RANGE_METRES = {
  coarse: 100,
  regional: 250,
} as const;

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const NORMAL_SAMPLE_STEP = 1 / 4096;
const TECTONIC_GRID_WIDTH = 360;
const TECTONIC_GRID_HEIGHT = 181;

interface SampleState {
  longitude: number;
  latitude: number;
  baseHeight: number;
  height: number;
  detailHeight: number;
  albedoRed: number;
  albedoGreen: number;
  albedoBlue: number;
  roughness: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizedLongitude(longitude: number): number {
  const wrapped = ((longitude + 180) % 360 + 360) % 360 - 180;
  return Object.is(wrapped, -0) ? 0 : wrapped;
}

function directionToLonLat(
  x: number,
  y: number,
  z: number,
): [longitude: number, latitude: number] {
  const latitude = Math.asin(clamp(y, -1, 1)) * RAD_TO_DEG;
  // Longitude has no geographic meaning at a pole. Canonicalizing it keeps
  // every cube corner/face path on the same source-grid sample.
  const longitude = Math.abs(x) + Math.abs(z) < 1e-12
    ? 0
    : normalizedLongitude(Math.atan2(-z, x) * RAD_TO_DEG);
  return [longitude, latitude];
}

function sampleRgbaChannel(
  field: Uint8Array,
  surface: SurfaceFields,
  longitude: number,
  latitude: number,
  channel: number,
  northPoleValue: number,
  southPoleValue: number,
): number {
  const u = (normalizedLongitude(longitude) + 180) / 360;
  const v = (latitude + 90) / 180;
  const fx = u * surface.width - 0.5;
  const fy = clamp((1 - v) * surface.height - 0.5, 0, surface.height - 1);
  const xBase = Math.floor(fx);
  const x0 = ((xBase % surface.width) + surface.width) % surface.width;
  const x1 = (x0 + 1) % surface.width;
  const y0 = Math.floor(fy);
  const y1 = Math.min(surface.height - 1, y0 + 1);
  const tx = fx - xBase;
  const ty = fy - y0;
  const north =
    field[(y0 * surface.width + x0) * 4 + channel] * (1 - tx) +
    field[(y0 * surface.width + x1) * 4 + channel] * tx;
  const south =
    field[(y1 * surface.width + x0) * 4 + channel] * (1 - tx) +
    field[(y1 * surface.width + x1) * 4 + channel] * tx;
  const sampled = north * (1 - ty) + south * ty;
  // Complete only the render raster's unsampled half-pixel polar cap. Source
  // elevation already interpolates from canonical ±90° controls in surface.ts.
  const poleCenterLatitude = 90 - 90 / surface.height;
  if (latitude > poleCenterLatitude) {
    const poleBlend = (latitude - poleCenterLatitude) / (90 - poleCenterLatitude);
    return sampled + (northPoleValue - sampled) * poleBlend;
  }
  if (latitude < -poleCenterLatitude) {
    const poleBlend = (-latitude - poleCenterLatitude) / (90 - poleCenterLatitude);
    return sampled + (southPoleValue - sampled) * poleBlend;
  }
  return sampled;
}

function poleChannelAverage(
  field: Uint8Array,
  surface: SurfaceFields,
  north: boolean,
  channel: number,
): number {
  const row = north ? 0 : surface.height - 1;
  let total = 0;
  for (let x = 0; x < surface.width; x += 1) {
    total += field[(row * surface.width + x) * 4 + channel];
  }
  return total / surface.width;
}

function sampleByteControl(
  snapshot: WorldSnapshot,
  field: Uint8Array | undefined,
  longitude: number,
  latitude: number,
): number {
  const controls = snapshot.controls;
  if (controls === undefined || field === undefined || field.length === 0) return 0;
  const u = (normalizedLongitude(longitude) + 180) / 360;
  const fx = u * controls.width;
  const fy = clamp(((90 - latitude) / 180) * (controls.height - 1), 0, controls.height - 1);
  const xBase = Math.floor(fx);
  const x0 = ((xBase % controls.width) + controls.width) % controls.width;
  const x1 = (x0 + 1) % controls.width;
  const y0 = Math.floor(fy);
  const y1 = Math.min(controls.height - 1, y0 + 1);
  const tx = fx - xBase;
  const ty = fy - y0;
  const at = (x: number, y: number) => (field[y * controls.width + x] ?? 0) / 255;
  return (
    (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) +
    (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty
  );
}

function samplePatchElevation(
  patch: ModernReliefPatch,
  longitude: number,
  latitude: number,
): number {
  const [westCenter, , , northCenter] = patch.cellCenterBounds;
  const fx = clamp((longitude - westCenter) / patch.longitudeStep, 0, patch.width - 1);
  const fy = clamp((northCenter - latitude) / patch.latitudeStep, 0, patch.height - 1);
  const x0 = Math.floor(fx);
  const x1 = Math.min(patch.width - 1, x0 + 1);
  const y0 = Math.floor(fy);
  const y1 = Math.min(patch.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const north =
    patch.elevation[y0 * patch.width + x0] * (1 - tx) +
    patch.elevation[y0 * patch.width + x1] * tx;
  const south =
    patch.elevation[y1 * patch.width + x0] * (1 - tx) +
    patch.elevation[y1 * patch.width + x1] * tx;
  return north * (1 - ty) + south * ty;
}

function patchFeatherWeight(
  patch: ModernReliefPatch,
  longitude: number,
  latitude: number,
): number {
  const [west, south, east, north] = patch.bounds;
  if (longitude < west || longitude > east || latitude < south || latitude > north) return 0;
  const edgeCells = Math.min(
    (longitude - west) / patch.longitudeStep,
    (east - longitude) / patch.longitudeStep,
    (latitude - south) / patch.latitudeStep,
    (north - latitude) / patch.latitudeStep,
  );
  return smoothstep(0, patch.edgeTransitionCells, edgeCells);
}

function samplePatchLandCoverage(
  patch: ModernReliefPatch,
  longitude: number,
  latitude: number,
): number {
  if (patch.landCoverage === undefined) {
    return samplePatchElevation(patch, longitude, latitude) > 0 ? 1 : 0;
  }
  const [westCenter, , , northCenter] = patch.cellCenterBounds;
  const fx = clamp((longitude - westCenter) / patch.longitudeStep, 0, patch.width - 1);
  const fy = clamp((northCenter - latitude) / patch.latitudeStep, 0, patch.height - 1);
  const x0 = Math.floor(fx);
  const x1 = Math.min(patch.width - 1, x0 + 1);
  const y0 = Math.floor(fy);
  const y1 = Math.min(patch.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => patch.landCoverage![y * patch.width + x] / 255;
  const north = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const south = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return north * (1 - ty) + south * ty;
}

function buildTectonicInfluence(snapshot: WorldSnapshot): Uint8Array {
  const field = new Uint8Array(TECTONIC_GRID_WIDTH * TECTONIC_GRID_HEIGHT);
  const splat = (longitude: number, latitude: number, radiusDegrees: number, activity: number) => {
    const centerX = ((normalizedLongitude(longitude) + 180) / 360) * TECTONIC_GRID_WIDTH;
    const centerY = ((90 - latitude) / 180) * (TECTONIC_GRID_HEIGHT - 1);
    const radiusY = Math.max(1, Math.ceil(radiusDegrees));
    const radiusX = Math.max(1, Math.ceil(radiusDegrees / Math.max(0.25, Math.cos(latitude * DEG_TO_RAD))));
    for (let dy = -radiusY; dy <= radiusY; dy += 1) {
      const y = Math.round(centerY + dy);
      if (y < 0 || y >= TECTONIC_GRID_HEIGHT) continue;
      for (let dx = -radiusX; dx <= radiusX; dx += 1) {
        const scaledX = dx / radiusX;
        const scaledY = dy / radiusY;
        const distance = Math.hypot(scaledX, scaledY);
        if (distance > 1) continue;
        const x = ((Math.round(centerX + dx) % TECTONIC_GRID_WIDTH) + TECTONIC_GRID_WIDTH) % TECTONIC_GRID_WIDTH;
        const value = Math.round(255 * activity * (1 - smoothstep(0.18, 1, distance)));
        const index = y * TECTONIC_GRID_WIDTH + x;
        if (value > field[index]) field[index] = value;
      }
    }
  };

  for (const feature of snapshot.tectonics) {
    const radius = clamp(feature.widthKm / 111 * 2.4, 0.7, 7);
    const activity = clamp(feature.activity ?? 0.75, 0, 1);
    for (let index = 1; index < feature.coordinates.length; index += 1) {
      const [aLongitude, aLatitude] = feature.coordinates[index - 1];
      const [bLongitude, bLatitude] = feature.coordinates[index];
      const deltaLongitude = normalizedLongitude(bLongitude - aLongitude);
      const span = Math.hypot(deltaLongitude * Math.cos(aLatitude * DEG_TO_RAD), bLatitude - aLatitude);
      const steps = Math.max(1, Math.ceil(span / 0.75));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        splat(
          normalizedLongitude(aLongitude + deltaLongitude * t),
          aLatitude + (bLatitude - aLatitude) * t,
          radius,
          activity,
        );
      }
    }
  }
  return field;
}

function sampleTectonicInfluence(field: Uint8Array, longitude: number, latitude: number): number {
  const fx = ((normalizedLongitude(longitude) + 180) / 360) * TECTONIC_GRID_WIDTH;
  const fy = clamp(((90 - latitude) / 180) * (TECTONIC_GRID_HEIGHT - 1), 0, TECTONIC_GRID_HEIGHT - 1);
  const xBase = Math.floor(fx);
  const x0 = ((xBase % TECTONIC_GRID_WIDTH) + TECTONIC_GRID_WIDTH) % TECTONIC_GRID_WIDTH;
  const x1 = (x0 + 1) % TECTONIC_GRID_WIDTH;
  const y0 = Math.floor(fy);
  const y1 = Math.min(TECTONIC_GRID_HEIGHT - 1, y0 + 1);
  const tx = fx - xBase;
  const ty = fy - y0;
  const north = field[y0 * TECTONIC_GRID_WIDTH + x0] * (1 - tx) + field[y0 * TECTONIC_GRID_WIDTH + x1] * tx;
  const south = field[y1 * TECTONIC_GRID_WIDTH + x0] * (1 - tx) + field[y1 * TECTONIC_GRID_WIDTH + x1] * tx;
  return (north * (1 - ty) + south * ty) / 255;
}

function writeCubeDirection(
  face: CubeFace,
  u: number,
  v: number,
  output: [number, number, number],
): void {
  let x: number;
  let y: number;
  let z: number;
  switch (face) {
    case "px": [x, y, z] = [1, v, -u]; break;
    case "nx": [x, y, z] = [-1, v, u]; break;
    case "py": [x, y, z] = [u, 1, -v]; break;
    case "ny": [x, y, z] = [u, -1, v]; break;
    case "pz": [x, y, z] = [u, v, 1]; break;
    case "nz": [x, y, z] = [-u, v, -1]; break;
  }
  const inverseLength = 1 / Math.hypot(x, y, z);
  output[0] = x * inverseLength;
  output[1] = y * inverseLength;
  output[2] = z * inverseLength;
}

function encodeDetailHeight(value: number, range: number): number {
  const normalized = clamp(value / range, -1, 1);
  return normalized < 0
    ? 128 + Math.round(normalized * 128)
    : 128 + Math.round(normalized * 127);
}

export function decodeDetailHeight(code: number, detail: SurfaceDetail): number {
  const offset = clamp(Math.round(code), 0, 255) - 128;
  const range = DETAIL_HEIGHT_RANGE_METRES[detail];
  return offset < 0 ? (offset / 128) * range : (offset / 127) * range;
}

export function createCubeTileFieldGenerator(
  context: CubeTileFieldContext,
): CubeTileFieldGenerator {
  const sampler = createPerceptualDetailSampler(context.snapshot.id);
  const tectonicInfluence = buildTectonicInfluence(context.snapshot);
  const albedoPoleValues = Float64Array.from({ length: 6 }, (_, index) =>
    poleChannelAverage(
      context.surface.albedo,
      context.surface,
      index < 3,
      index % 3,
    ),
  );
  const roughnessPoleValues = new Float64Array([
    poleChannelAverage(context.surface.roughness, context.surface, true, 0),
    poleChannelAverage(context.surface.roughness, context.surface, false, 0),
  ]);
  const reliefPoleValues = new Float64Array([
    poleChannelAverage(context.surface.relief, context.surface, true, 0) / 255 *
      context.surface.reliefRangeMetres + context.surface.reliefBiasMetres,
    poleChannelAverage(context.surface.relief, context.surface, false, 0) / 255 *
      context.surface.reliefRangeMetres + context.surface.reliefBiasMetres,
  ]);
  const requestedAge = context.snapshot.requestedAgeMa ?? context.snapshot.ageMa;
  const validModernRelief = (context.modernRelief ?? []).filter((patch) =>
    patch.surfaceMode === context.mode &&
    patch.referenceFrameId === "present-day-geographic" && requestedAge === 0 &&
    requestedAge <= patch.validRequestedAgeMa[0] &&
    requestedAge >= patch.validRequestedAgeMa[1]
  ).sort((left, right) =>
    right.priority - left.priority || right.level - left.level ||
    left.longitudeStep - right.longitudeStep || left.id.localeCompare(right.id)
  );
  const stage: SurfaceStage = context.snapshot.environment.stage ?? "modern-biomes";
  const sampleState: SampleState = {
    longitude: 0,
    latitude: 0,
    baseHeight: 0,
    height: 0,
    detailHeight: 0,
    albedoRed: 0,
    albedoGreen: 0,
    albedoBlue: 0,
    roughness: 0,
  };
  const contextRetainedBytes =
    context.surface.albedo.byteLength + context.surface.relief.byteLength +
    context.surface.reliefMetres.byteLength + context.surface.roughness.byteLength +
    context.surface.landMask.byteLength +
    context.surface.clouds.byteLength +
    (context.snapshot.controls?.elevation.byteLength ?? 0) +
    (context.snapshot.controls?.potentialIce?.byteLength ?? 0) +
    (context.snapshot.controls?.vegetationPotential?.byteLength ?? 0) +
    (context.snapshot.modernClimate?.classes.byteLength ?? 0) +
    (context.modernRelief ?? []).reduce((sum, patch) => sum + patch.byteLength, 0);

  const evaluate = (
    x: number,
    y: number,
    z: number,
    sourcePatchIds?: Set<string>,
    includeMaterial = false,
  ): SampleState => {
    const [longitude, latitude] = directionToLonLat(x, y, z);
    const u = (longitude + 180) / 360;
    const v = (latitude + 90) / 180;
    let baseHeight = sampleSurfaceReliefMetres(context.surface, u, v);
    const globalLand = sampleSurfaceLand(context.surface, longitude, latitude);
    let refinementWeight = 0;
    let refinementLand = globalLand;
    let refinementHeight = baseHeight;
    // Complete only the unsampled half-pixel of generated render relief.
    const poleCenterLatitude = 90 - 90 / context.surface.height;
    if (latitude > poleCenterLatitude) {
      const poleBlend = (latitude - poleCenterLatitude) / (90 - poleCenterLatitude);
      baseHeight += (reliefPoleValues[0] - baseHeight) * poleBlend;
    } else if (latitude < -poleCenterLatitude) {
      const poleBlend = (-latitude - poleCenterLatitude) / (90 - poleCenterLatitude);
      baseHeight += (reliefPoleValues[1] - baseHeight) * poleBlend;
    }
    for (const patch of validModernRelief) {
      const weight = patchFeatherWeight(patch, longitude, latitude);
      if (weight <= 0) continue;
      refinementHeight = samplePatchElevation(patch, longitude, latitude);
      refinementLand = samplePatchLandCoverage(patch, longitude, latitude) >= 0.5;
      const displayedPatchHeight = context.mode === "surface"
        ? Math.max(0, refinementHeight)
        : refinementHeight;
      baseHeight += (displayedPatchHeight - baseHeight) * weight;
      refinementWeight = weight;
      sourcePatchIds?.add(patch.id);
      break;
    }

    const baseRoughness = sampleRgbaChannel(
      context.surface.roughness,
      context.surface,
      longitude,
      latitude,
      0,
      roughnessPoleValues[0],
      roughnessPoleValues[1],
    );
    // Global roughness is already derived from the broad relief and is a stable,
    // seam-safe slope proxy. Fine normal derivatives come from detailHeight.
    const slope = clamp((baseRoughness / 255 - 0.38) * 1.65, 0, 1);
    const ice = sampleByteControl(
      context.snapshot,
      context.snapshot.controls?.potentialIce,
      longitude,
      latitude,
    );
    const climateGroup: ModernClimateGroup | undefined = sampleModernClimateGroup(
      context.snapshot.modernClimate,
      longitude,
      latitude,
    );
    const detail = sampler.sample({
      longitude,
      latitude,
      elevationMetres: baseHeight,
      slope,
      land: refinementWeight >= 0.5 ? refinementLand : globalLand,
      ice,
      climateGroup,
      stage,
      tectonicInfluence: sampleTectonicInfluence(tectonicInfluence, longitude, latitude),
      detail: context.detail,
    });

    sampleState.longitude = longitude;
    sampleState.latitude = latitude;
    sampleState.baseHeight = baseHeight;
    sampleState.detailHeight = detail.heightDeltaMetres;
    sampleState.height = baseHeight + detail.heightDeltaMetres;
    sampleState.roughness = clamp(baseRoughness + detail.roughnessDelta * 255, 0, 255);
    if (includeMaterial) {
      let albedoRed = sampleRgbaChannel(
          context.surface.albedo, context.surface, longitude, latitude, 0,
          albedoPoleValues[0], albedoPoleValues[3],
      );
      let albedoGreen = sampleRgbaChannel(
          context.surface.albedo, context.surface, longitude, latitude, 1,
          albedoPoleValues[1], albedoPoleValues[4],
      );
      let albedoBlue = sampleRgbaChannel(
          context.surface.albedo, context.surface, longitude, latitude, 2,
          albedoPoleValues[2], albedoPoleValues[5],
      );
      sampleState.albedoRed = clamp(albedoRed * detail.albedoMultiplier[0], 0, 255);
      sampleState.albedoGreen = clamp(albedoGreen * detail.albedoMultiplier[1], 0, 255);
      sampleState.albedoBlue = clamp(albedoBlue * detail.albedoMultiplier[2], 0, 255);
    }
    return sampleState;
  };

  const scratchDirection: [number, number, number] = [0, 0, 0];
  const displacedAt = (face: CubeFace, u: number, v: number): [number, number, number] => {
    // cubeFaceDirection intentionally accepts coordinates outside one face.
    const direction = cubeFaceDirection(face, u, v);
    const height = evaluate(direction[0], direction[1], direction[2]).height;
    const radius = 1 + height / EARTH_RADIUS_METRES;
    return [direction[0] * radius, direction[1] * radius, direction[2] * radius];
  };

  return {
    retainedBytes:
      sampler.retainedTableBytes + tectonicInfluence.byteLength +
      albedoPoleValues.byteLength + roughnessPoleValues.byteLength + reliefPoleValues.byteLength +
      contextRetainedBytes,
    sampleHeightMetres(direction) {
      const length = Math.hypot(direction[0], direction[1], direction[2]);
      if (!(length > 0) || !Number.isFinite(length)) return 0;
      return evaluate(direction[0], direction[1], direction[2]).height;
    },
    generate(request) {
      const started = typeof performance === "undefined" ? Date.now() : performance.now();
      const geometry = createCubeTileGeometry(request.key, request.meshSegments);
      const vertexCount = geometry.directions.length / 3;
      const heightsMetres = new Float32Array(vertexCount);
      const normals = new Float32Array(geometry.directions.length);
      const sourcePatchIds = new Set<string>();
      let minHeightMetres = Number.POSITIVE_INFINITY;
      let maxHeightMetres = Number.NEGATIVE_INFINITY;

      for (let index = 0; index < vertexCount; index += 1) {
        const offset = index * 3;
        const x = geometry.directions[offset] === 0 ? 0 : geometry.directions[offset];
        const y = geometry.directions[offset + 1] === 0 ? 0 : geometry.directions[offset + 1];
        const z = geometry.directions[offset + 2] === 0 ? 0 : geometry.directions[offset + 2];
        geometry.directions[offset] = x;
        geometry.directions[offset + 1] = y;
        geometry.directions[offset + 2] = z;
        const height = evaluate(x, y, z, sourcePatchIds).height;
        heightsMetres[index] = height;
        minHeightMetres = Math.min(minHeightMetres, height);
        maxHeightMetres = Math.max(maxHeightMetres, height);
        const radius = 1 + height / EARTH_RADIUS_METRES;
        geometry.positions[offset] = x * radius;
        geometry.positions[offset + 1] = y * radius;
        geometry.positions[offset + 2] = z * radius;

        // Select one canonical face at face ties, then sample a fixed central
        // stencil. Identical world directions therefore produce identical
        // normals across face and LOD boundaries.
        const canonical = directionToCubeFaceUv([x, y, z]);
        const west = displacedAt(canonical.face, canonical.u - NORMAL_SAMPLE_STEP, canonical.v);
        const east = displacedAt(canonical.face, canonical.u + NORMAL_SAMPLE_STEP, canonical.v);
        const south = displacedAt(canonical.face, canonical.u, canonical.v - NORMAL_SAMPLE_STEP);
        const north = displacedAt(canonical.face, canonical.u, canonical.v + NORMAL_SAMPLE_STEP);
        const ux = east[0] - west[0];
        const uy = east[1] - west[1];
        const uz = east[2] - west[2];
        const vx = north[0] - south[0];
        const vy = north[1] - south[1];
        const vz = north[2] - south[2];
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        if (nx * x + ny * y + nz * z < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const inverseNormalLength = 1 / Math.hypot(nx, ny, nz);
        normals[offset] = nx * inverseNormalLength;
        normals[offset + 1] = ny * inverseNormalLength;
        normals[offset + 2] = nz * inverseNormalLength;
      }

      // The power-of-two request remains the density target, while the extra
      // interior row and column put one canonical texel at a level-zero pole.
      // An even interior straddles that singularity with four longitudes and
      // turns their GPU interpolation into a visible radial fan.
      const textureInteriorSize = request.textureSize + 1;
      const textureStride = textureInteriorSize + 2;
      const textureBytes = textureStride * textureStride * 4;
      const albedo = new Uint8Array(textureBytes);
      const roughness = new Uint8Array(textureBytes);
      const detailHeight = new Uint8Array(textureBytes);
      const bounds = cubeTileBounds(request.key);
      const spanU = bounds.east - bounds.west;
      const spanV = bounds.south - bounds.north;
      const textureDenominator = textureInteriorSize - 1;
      const detailRange = DETAIL_HEIGHT_RANGE_METRES[context.detail];

      for (let row = 0; row < textureStride; row += 1) {
        const ty = (row - 1) / textureDenominator;
        const faceV = bounds.north + spanV * ty;
        for (let column = 0; column < textureStride; column += 1) {
          const tx = (column - 1) / textureDenominator;
          const faceU = bounds.west + spanU * tx;
          writeCubeDirection(request.key.face, faceU, faceV, scratchDirection);
          const sample = evaluate(
            scratchDirection[0],
            scratchDirection[1],
            scratchDirection[2],
            sourcePatchIds,
            true,
          );
          const offset = (row * textureStride + column) * 4;
          albedo[offset] = Math.round(sample.albedoRed);
          albedo[offset + 1] = Math.round(sample.albedoGreen);
          albedo[offset + 2] = Math.round(sample.albedoBlue);
          albedo[offset + 3] = 255;
          const roughnessCode = Math.round(sample.roughness);
          roughness[offset] = roughnessCode;
          roughness[offset + 1] = roughnessCode;
          roughness[offset + 2] = roughnessCode;
          roughness[offset + 3] = 255;
          const heightCode = encodeDetailHeight(sample.detailHeight, detailRange);
          detailHeight[offset] = heightCode;
          detailHeight[offset + 1] = heightCode;
          detailHeight[offset + 2] = heightCode;
          detailHeight[offset + 3] = 255;
        }
      }

      const innerMinimum = 1.5 / textureStride;
      const innerSpan = (textureInteriorSize - 1) / textureStride;
      for (let index = 0; index < vertexCount; index += 1) {
        const offset = index * 2;
        geometry.localUvs[offset] = innerMinimum + geometry.localUvs[offset] * innerSpan;
        geometry.localUvs[offset + 1] = innerMinimum + geometry.localUvs[offset + 1] * innerSpan;
      }

      const byteLength =
        geometry.directions.byteLength + geometry.positions.byteLength + normals.byteLength +
        heightsMetres.byteLength + geometry.localUvs.byteLength + geometry.indices.byteLength +
        albedo.byteLength + roughness.byteLength + detailHeight.byteLength;
      const finished = typeof performance === "undefined" ? Date.now() : performance.now();
      return {
        key: request.key,
        meshSegments: request.meshSegments,
        textureSize: request.textureSize,
        textureStride,
        directions: geometry.directions,
        positions: geometry.positions,
        normals,
        heightsMetres,
        localUvs: geometry.localUvs,
        indices: geometry.indices,
        albedo,
        roughness,
        detailHeight,
        minHeightMetres,
        maxHeightMetres,
        generationMs: finished - started,
        byteLength,
        sourcePatchIds: [...sourcePatchIds].sort(),
      };
    },
  };
}
