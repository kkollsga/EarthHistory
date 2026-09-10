import type {
  ModernClimateGroup,
  ModernReliefPatch,
  SurfaceStage,
  WorldSnapshot,
} from "../data";
import { surfaceRefinementAppliesToMode } from "../data";
import {
  createCubeTileGeometry,
  cubeFaceDirection,
  cubeTileBounds,
  directionToCubeFaceUv,
  type CubeFace,
  type CubeTileKey,
} from "./cubeSphere";
import { createPerceptualDetailSampler, perceptualMaterialChannel } from "./perceptualDetail";
import {
  EARTH_RADIUS_METRES,
  sampleModernClimateGroup,
  sampleProceduralControlElevation,
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
  minSourceMaterialHeightMetres?: number;
  maxSourceMaterialHeightMetres?: number;
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

const RAD_TO_DEG = 180 / Math.PI;
const NORMAL_SAMPLE_STEP = 1 / 4096;

interface SampleState {
  longitude: number;
  latitude: number;
  baseHeight: number;
  shadingHeight: number;
  sourceMaterialHeight: number;
  height: number;
  detailHeight: number;
  albedoRed: number;
  albedoGreen: number;
  albedoBlue: number;
  roughness: number;
}

function surfaceWaterBathymetryColor(
  signedHeightMetres: number,
): [red: number, green: number, blue: number] {
  const depth = smoothstep(120, 8_500, -signedHeightMetres);
  return [
    25 + (7 - 25) * depth,
    108 + (37 - 108) * depth,
    139 + (68 - 139) * depth,
  ];
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
  const sampler = createPerceptualDetailSampler(
    context.snapshot.renderSeedId ?? context.snapshot.temporalSurface?.seedId ?? context.snapshot.id,
  );
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
  const ruggednessPoleValues = new Float64Array([
    poleChannelAverage(context.surface.roughness, context.surface, true, 3),
    poleChannelAverage(context.surface.roughness, context.surface, false, 3),
  ]);
  const reliefPoleValues = new Float64Array([
    poleChannelAverage(context.surface.relief, context.surface, true, 0) / 255 *
      context.surface.reliefRangeMetres + context.surface.reliefBiasMetres,
    poleChannelAverage(context.surface.relief, context.surface, false, 0) / 255 *
      context.surface.reliefRangeMetres + context.surface.reliefBiasMetres,
  ]);
  const requestedAge = context.snapshot.requestedAgeMa ?? context.snapshot.ageMa;
  const validModernRelief = (context.modernRelief ?? []).filter((patch) =>
    surfaceRefinementAppliesToMode(patch, context.mode) &&
    patch.referenceFrameId === "present-day-geographic" && requestedAge === 0 &&
    requestedAge <= patch.validRequestedAgeMa[0] &&
    requestedAge >= patch.validRequestedAgeMa[1]
  ).sort((left, right) =>
    right.priority - left.priority || right.level - left.level ||
    left.longitudeStep - right.longitudeStep || left.id.localeCompare(right.id)
  );
  const exactModernSourceMaterial = requestedAge === 0 && validModernRelief.length > 0;
  const stage: SurfaceStage = context.snapshot.environment.stage ?? "modern-biomes";
  const sampleState: SampleState = {
    longitude: 0,
    latitude: 0,
    baseHeight: 0,
    shadingHeight: 0,
    sourceMaterialHeight: 0,
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
    // Source-controlled grids own physical height. Sampling them directly
    // also makes the native cube endpoint identical to temporal DEM sampling;
    // raster material fields may be lower resolution and must not shift it.
    let baseHeight = context.snapshot.controls === undefined
      ? sampleSurfaceReliefMetres(context.surface, u, v)
      : sampleProceduralControlElevation(context.snapshot.controls, longitude, latitude);
    if (context.snapshot.controls !== undefined && context.mode === "surface") {
      baseHeight = Math.max(0, baseHeight);
    }
    const globalLand = sampleSurfaceLand(context.surface, longitude, latitude);
    let refinementWeight = 0;
    let refinementLand = globalLand;
    let refinementHeight = baseHeight;
    let shadingHeight = baseHeight;
    let surfaceWaterBathymetryWeight = 0;
    let sourceTextureReliefMetres = 0;
    // Complete only the unsampled half-pixel of generated render relief.
    const poleCenterLatitude = 90 - 90 / context.surface.height;
    if (latitude > poleCenterLatitude) {
      const poleBlend = (latitude - poleCenterLatitude) / (90 - poleCenterLatitude);
      baseHeight += (reliefPoleValues[0] - baseHeight) * poleBlend;
    } else if (latitude < -poleCenterLatitude) {
      const poleBlend = (-latitude - poleCenterLatitude) / (90 - poleCenterLatitude);
      baseHeight += (reliefPoleValues[1] - baseHeight) * poleBlend;
    }
    // Polar completion comes from the rendered relief raster, which may carry
    // signed bathymetry. Reassert the surface-water shell after that blend so
    // the collapsed pole texel cannot reintroduce negative physical geometry.
    if (context.snapshot.controls !== undefined && context.mode === "surface") {
      baseHeight = Math.max(0, baseHeight);
    }
    // Local modern patches refine physical shape and material structure. Their
    // feather weight keeps the higher-resolution elevation and gradient from
    // becoming a rectangular color boundary at the source edge.
    let materialElevationMetres = baseHeight;
    let refinementSlope = 0;
    for (const patch of validModernRelief) {
      const weight = patchFeatherWeight(patch, longitude, latitude);
      if (weight <= 0) continue;
      refinementHeight = samplePatchElevation(patch, longitude, latitude);
      refinementLand = samplePatchLandCoverage(patch, longitude, latitude) >= 0.5;
      const displayedPatchHeight = context.mode === "surface"
        ? Math.max(0, refinementHeight)
        : refinementHeight;
      const surfaceWaterBathymetry = context.mode === "surface" && refinementHeight < 0;
      baseHeight += (displayedPatchHeight - baseHeight) * weight;
      materialElevationMetres += (displayedPatchHeight - materialElevationMetres) * weight;
      if (surfaceWaterBathymetry) {
        surfaceWaterBathymetryWeight = weight;
      }
      const longitudeStep = Math.max(1e-5, patch.longitudeStep);
      const latitudeStep = Math.max(1e-5, patch.latitudeStep);
      const westHeight = samplePatchElevation(patch, longitude - longitudeStep, latitude);
      const eastHeight = samplePatchElevation(patch, longitude + longitudeStep, latitude);
      const southHeight = samplePatchElevation(patch, longitude, latitude - latitudeStep);
      const northHeight = samplePatchElevation(patch, longitude, latitude + latitudeStep);
      const farWestHeight = samplePatchElevation(patch, longitude - longitudeStep * 4, latitude);
      const farEastHeight = samplePatchElevation(patch, longitude + longitudeStep * 4, latitude);
      const farSouthHeight = samplePatchElevation(patch, longitude, latitude - latitudeStep * 4);
      const farNorthHeight = samplePatchElevation(patch, longitude, latitude + latitudeStep * 4);
      const localMean = (
        refinementHeight * 4 + westHeight + eastHeight + southHeight + northHeight +
        farWestHeight + farEastHeight + farSouthHeight + farNorthHeight
      ) / 12;
      // Preserve the source's local peak/valley residual in the material bump
      // grid. It changes shading only; physical vertices and height queries
      // continue to use the unmodified source elevation above.
      sourceTextureReliefMetres = clamp(
        (refinementHeight - localMean) * 0.42,
        -DETAIL_HEIGHT_RANGE_METRES.regional,
        DETAIL_HEIGHT_RANGE_METRES.regional,
      ) * weight;
      // Surface water uses source-local relief for virtual normals. Taking the
      // derivative of feathered absolute ocean depth adds an artificial
      // depth-times-feather-gradient wall at the rectangular source window.
      // Raw signed depth remains available for bathymetric color/diagnostics;
      // physical geometry and the displayed-height sampler stay at sea level.
      shadingHeight = surfaceWaterBathymetry
        ? baseHeight + sourceTextureReliefMetres
        : shadingHeight + (displayedPatchHeight - shadingHeight) * weight;
      const eastWestRun = Math.max(
        1,
        2 * longitudeStep * 111_320 * Math.max(0.12, Math.cos(latitude / RAD_TO_DEG)),
      );
      const northSouthRun = Math.max(1, 2 * latitudeStep * 110_574);
      refinementSlope = clamp(Math.hypot(
        (eastHeight - westHeight) / eastWestRun,
        (northHeight - southHeight) / northSouthRun,
      ), 0, 1) * weight;
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
    // Alpha carries the source-grid ruggedness control. The GPU roughness map
    // consumes green, leaving this channel available to keep flat material
    // from being misread as slope.
    const broadSlope = sampleRgbaChannel(
      context.surface.roughness,
      context.surface,
      longitude,
      latitude,
      3,
      ruggednessPoleValues[0],
      ruggednessPoleValues[1],
    ) / 255;
    const slope = Math.max(broadSlope * (1 - refinementWeight), refinementSlope);
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
      materialElevationMetres,
      slope,
      land: refinementWeight >= 0.5 ? refinementLand : globalLand,
      ice,
      climateGroup,
      stage,
      // The runtime tectonic catalog contains schematic story corridors, not
      // native PALEOMAP boundary geometry. It must not emboss linework into
      // the physical surface; source relief and its slope control the detail.
      tectonicInfluence: 0,
      detail: context.detail,
    });

    sampleState.longitude = longitude;
    sampleState.latitude = latitude;
    sampleState.baseHeight = baseHeight;
    sampleState.detailHeight = exactModernSourceMaterial
      ? sourceTextureReliefMetres
      : detail.heightDeltaMetres;
    sampleState.height = baseHeight + (context.snapshot.controls === undefined
      ? detail.heightDeltaMetres * (1 - refinementWeight)
      : 0);
    sampleState.shadingHeight = surfaceWaterBathymetryWeight > 0
      ? shadingHeight
      : sampleState.height;
    sampleState.sourceMaterialHeight = surfaceWaterBathymetryWeight > 0
      ? refinementHeight
      : sampleState.height;
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
      sampleState.albedoRed = clamp(perceptualMaterialChannel(albedoRed / 255, detail, 0) * 255, 0, 255);
      sampleState.albedoGreen = clamp(perceptualMaterialChannel(albedoGreen / 255, detail, 1) * 255, 0, 255);
      sampleState.albedoBlue = clamp(perceptualMaterialChannel(albedoBlue / 255, detail, 2) * 255, 0, 255);
      if (surfaceWaterBathymetryWeight > 0) {
        const bathymetry = surfaceWaterBathymetryColor(refinementHeight);
        const mix = surfaceWaterBathymetryWeight *
          (0.55 + 0.35 * smoothstep(120, 8_500, -refinementHeight));
        sampleState.albedoRed += (bathymetry[0] - sampleState.albedoRed) * mix;
        sampleState.albedoGreen += (bathymetry[1] - sampleState.albedoGreen) * mix;
        sampleState.albedoBlue += (bathymetry[2] - sampleState.albedoBlue) * mix;
      }
    }
    return sampleState;
  };

  const scratchDirection: [number, number, number] = [0, 0, 0];
  const displacedAt = (face: CubeFace, u: number, v: number): [number, number, number] => {
    // cubeFaceDirection intentionally accepts coordinates outside one face.
    const direction = cubeFaceDirection(face, u, v);
    const height = evaluate(direction[0], direction[1], direction[2]).shadingHeight;
    const radius = 1 + height / EARTH_RADIUS_METRES;
    return [direction[0] * radius, direction[1] * radius, direction[2] * radius];
  };

  return {
    retainedBytes:
      sampler.retainedTableBytes +
      albedoPoleValues.byteLength + roughnessPoleValues.byteLength + ruggednessPoleValues.byteLength +
      reliefPoleValues.byteLength +
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
      let minSourceMaterialHeightMetres = Number.POSITIVE_INFINITY;
      let maxSourceMaterialHeightMetres = Number.NEGATIVE_INFINITY;

      for (let index = 0; index < vertexCount; index += 1) {
        const offset = index * 3;
        const x = geometry.directions[offset] === 0 ? 0 : geometry.directions[offset];
        const y = geometry.directions[offset + 1] === 0 ? 0 : geometry.directions[offset + 1];
        const z = geometry.directions[offset + 2] === 0 ? 0 : geometry.directions[offset + 2];
        geometry.directions[offset] = x;
        geometry.directions[offset + 1] = y;
        geometry.directions[offset + 2] = z;
        const sample = evaluate(x, y, z, sourcePatchIds);
        const height = sample.height;
        heightsMetres[index] = height;
        minHeightMetres = Math.min(minHeightMetres, height);
        maxHeightMetres = Math.max(maxHeightMetres, height);
        minSourceMaterialHeightMetres = Math.min(
          minSourceMaterialHeightMetres,
          sample.sourceMaterialHeight,
        );
        maxSourceMaterialHeightMetres = Math.max(
          maxSourceMaterialHeightMetres,
          sample.sourceMaterialHeight,
        );
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
      // Only tiles whose geometry actually sampled an active modern patch get
      // the denser regional material grid. This exposes source-local ridges in
      // the one rendered cube without increasing the global LOD/cache policy.
      const textureSize = context.detail === "regional" && sourcePatchIds.size > 0
        ? Math.max(128, request.textureSize) as 128 | 256
        : request.textureSize;
      const textureInteriorSize = textureSize + 1;
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
        textureSize,
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
        minSourceMaterialHeightMetres,
        maxSourceMaterialHeightMetres,
        generationMs: finished - started,
        byteLength,
        sourcePatchIds: [...sourcePatchIds].sort(),
      };
    },
  };
}
