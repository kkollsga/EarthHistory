import type {
  LonLat,
  ProceduralControls,
  TemporalSurface,
  WorldSnapshot,
} from "../data";
import type { PaleomapIntervalResolver } from "../data/paleomapMotion";
import {
  lonLatToPeriodDirection,
  periodDirectionToLonLat,
} from "../data/temporal";
import { createPerceptualDetailSampler, perceptualMaterialChannel } from "./perceptualDetail";
import type { PerceptualDetailSampler } from "./perceptualDetail";
import {
  EARTH_RADIUS_METRES,
  proceduralLocalTemperature,
  sampleGeographicGrid,
  sampleProceduralControlElevation,
  sampleSurfaceReliefMetres,
  type SurfaceDetail,
  type SurfaceFields,
  type SurfaceMode,
} from "./surface";
import type { CubeTileFields } from "./cubeTileFields";
import type { DisplayedHeightSampler } from "./displayedHeight";

export interface TemporalCubeUpdateTarget {
  readonly positions: Float32Array;
  /** Geometry used only to derive lighting normals; physical positions remain sourced. */
  readonly shadingPositions?: Float32Array;
  readonly colors: Float32Array;
  readonly uvs?: Float32Array;
  /** Native source whose global texture is currently bound to this mesh. */
  readonly textureSourceAgeMa?: number;
}

export interface TemporalCubeUpdateResult {
  readonly vertices: number;
  readonly resolvedVertices: number;
  readonly fallbackVertices: number;
  readonly minHeightMetres: number;
  readonly maxHeightMetres: number;
}

const RAD_TO_DEG = 180 / Math.PI;
let materialSamplerCache:
  | { readonly seedId: string; readonly sampler: PerceptualDetailSampler }
  | undefined;
const TEMPORAL_RUGGEDNESS_CACHE_LIMIT = 2;
const temporalRuggednessCache: Array<{
  readonly controls: ProceduralControls;
  readonly field: Uint8Array;
}> = [];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mix(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
  fraction: number,
): [number, number, number] {
  const t = clamp(fraction, 0, 1);
  return [
    left[0] + (right[0] - left[0]) * t,
    left[1] + (right[1] - left[1]) * t,
    left[2] + (right[2] - left[2]) * t,
  ];
}

export function directionToTemporalCoordinates(
  direction: readonly [number, number, number],
): LonLat {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(length > 0) || !Number.isFinite(length)) return [0, 0];
  const x = direction[0] / length;
  const y = direction[1] / length;
  const z = direction[2] / length;
  const latitude = Math.asin(clamp(y, -1, 1)) * RAD_TO_DEG;
  if (Math.abs(x) + Math.abs(z) < 1e-12) return [0, latitude];
  const longitude = Math.atan2(-z, x) * RAD_TO_DEG;
  return [longitude === -180 ? 180 : longitude, latitude];
}

export function interpolateTemporalHeight(
  youngerHeightMetres: number,
  olderHeightMetres: number,
  fraction: number,
): number {
  const t = clamp(fraction, 0, 1);
  if (t === 0) return youngerHeightMetres;
  if (t === 1) return olderHeightMetres;
  return youngerHeightMetres + (olderHeightMetres - youngerHeightMetres) * t;
}

export function sampleTemporalControlHeight(
  controls: ProceduralControls,
  coordinates: LonLat,
): number {
  return sampleProceduralControlElevation(controls, coordinates[0], coordinates[1]);
}

export function createTemporalHeightSampler(
  temporal: TemporalSurface,
  mode: SurfaceMode,
  resolver: Pick<PaleomapIntervalResolver, "resolveAt">,
): DisplayedHeightSampler {
  return {
    sampleHeightMetres(direction) {
      const displayedCoordinates = directionToTemporalCoordinates(direction);
      const mapping = resolver.resolveAt(lonLatToPeriodDirection(displayedCoordinates));
      let heightMetres: number;
      if (mapping === null) {
        const controls = temporal.fraction < 0.5
          ? temporal.younger.controls
          : temporal.older.controls;
        heightMetres = sampleTemporalControlHeight(controls, displayedCoordinates);
      } else {
        heightMetres = interpolateTemporalHeight(
          sampleTemporalControlHeight(
            temporal.younger.controls,
            periodDirectionToLonLat(mapping.youngerDirection),
          ),
          sampleTemporalControlHeight(
            temporal.older.controls,
            periodDirectionToLonLat(mapping.olderDirection),
          ),
          temporal.fraction,
        );
      }
      return mode === "surface" ? Math.max(0, heightMetres) : heightMetres;
    },
  };
}

function sampleOptionalControl(
  field: Uint8Array | undefined,
  controls: ProceduralControls,
  coordinates: LonLat,
): number {
  if (field === undefined) return 0;
  const longitude = ((coordinates[0] + 180) % 360 + 360) % 360 - 180;
  return sampleGeographicGrid(
    field,
    controls.width,
    controls.height,
    (longitude + 180) / 360,
    (90 - clamp(coordinates[1], -90, 90)) / 180,
  ) / 255;
}

function materialSampler(seedId: string): PerceptualDetailSampler {
  if (materialSamplerCache?.seedId !== seedId) {
    materialSamplerCache = { seedId, sampler: createPerceptualDetailSampler(seedId) };
  }
  return materialSamplerCache.sampler;
}

function createTemporalRuggednessField(controls: ProceduralControls): Uint8Array {
  const { width, height, elevation } = controls;
  const field = new Uint8Array(width * height);
  if (width < 2 || height < 2) return field;
  const longitudeStep = 360 / controls.width;
  const latitudeStep = 180 / (controls.height - 1);
  const latitudeSpanMetres = Math.max(1, 2 * 110_574 * latitudeStep);
  for (let y = 0; y < height; y += 1) {
    const northY = Math.max(0, y - 1);
    const southY = Math.min(height - 1, y + 1);
    const latitude = 90 - y * latitudeStep;
    const longitudeSpanMetres = Math.max(
      1,
      2 * 111_320 * longitudeStep * Math.max(
        0.025,
        Math.abs(Math.cos(latitude * Math.PI / 180)),
      ),
    );
    for (let x = 0; x < width; x += 1) {
      const west = elevation[y * width + (x + width - 1) % width];
      const east = elevation[y * width + (x + 1) % width];
      const north = elevation[northY * width + x];
      const south = elevation[southY * width + x];
      const grade = Math.hypot(
        (east - west) / longitudeSpanMetres,
        (south - north) / latitudeSpanMetres,
      );
      field[y * width + x] = Math.round(smoothstep(0.0015, 0.025, grade) * 255);
    }
  }
  return field;
}

function temporalRuggednessField(controls: ProceduralControls): Uint8Array {
  const existing = temporalRuggednessCache.findIndex((entry) => entry.controls === controls);
  if (existing >= 0) {
    const [entry] = temporalRuggednessCache.splice(existing, 1);
    temporalRuggednessCache.push(entry);
    return entry.field;
  }
  const field = createTemporalRuggednessField(controls);
  temporalRuggednessCache.push({ controls, field });
  while (temporalRuggednessCache.length > TEMPORAL_RUGGEDNESS_CACHE_LIMIT) {
    temporalRuggednessCache.shift();
  }
  return field;
}

function sampleTemporalControlRuggedness(
  controls: ProceduralControls,
  coordinates: LonLat,
): number {
  const field = temporalRuggednessField(controls);
  if (field.length === 0) return 0;
  const longitude = ((coordinates[0] + 180) % 360 + 360) % 360 - 180;
  return sampleGeographicGrid(
    field,
    controls.width,
    controls.height,
    (longitude + 180) / 360,
    (90 - clamp(coordinates[1], -90, 90)) / 180,
  ) / 255;
}

export function temporalRuggednessCacheBytes(): number {
  return temporalRuggednessCache.reduce((total, entry) => total + entry.field.byteLength, 0);
}

function sampleSurfaceColor(
  surface: SurfaceFields,
  longitude: number,
  latitude: number,
): [number, number, number] {
  const normalizedLongitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  const fx = ((normalizedLongitude + 180) / 360) * surface.width - 0.5;
  const fy = clamp(((90 - latitude) / 180) * surface.height - 0.5, 0, surface.height - 1);
  const xBase = Math.floor(fx);
  const x0 = ((xBase % surface.width) + surface.width) % surface.width;
  const x1 = (x0 + 1) % surface.width;
  const y0 = Math.floor(fy);
  const y1 = Math.min(surface.height - 1, y0 + 1);
  const tx = fx - xBase;
  const ty = fy - y0;
  const channel = (index: number) => {
    const at = (x: number, y: number) => surface.albedo[(y * surface.width + x) * 4 + index] / 255;
    const north = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const south = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return north * (1 - ty) + south * ty;
  };
  return [channel(0), channel(1), channel(2)];
}

function temporalMaterial(
  heightMetres: number,
  coordinates: LonLat,
  referenceCoordinates: LonLat,
  environment: WorldSnapshot["environment"],
  mode: SurfaceMode,
  sampler: PerceptualDetailSampler,
  icePotential: number,
  sourceRuggedness: number,
  surfaceDetail: SurfaceDetail,
): [number, number, number, number] {
  const land = heightMetres > 0;
  const globalTemperature = Number.isFinite(environment.temperatureC)
    ? environment.temperatureC!
    : 14;
  const localTemperature = proceduralLocalTemperature(
    globalTemperature,
    coordinates[1],
    heightMetres,
  );
  const latitudeIce = Math.abs(coordinates[1]) >= environment.iceLatitude;
  const coldIce = land && (localTemperature < 0 || latitudeIce)
    ? clamp(environment.iceIntensity ?? 1, 0, 1)
    : 0;
  const ice = clamp(Math.max(icePotential * (environment.iceIntensity ?? 1), coldIce), 0, 1);
  const detail = sampler.sample({
    longitude: referenceCoordinates[0],
    latitude: referenceCoordinates[1],
    elevationMetres: heightMetres,
    slope: sourceRuggedness,
    land,
    ice,
    climateGroup: undefined,
    stage: environment.stage ?? "modern-biomes",
    tectonicInfluence: 0,
    detail: surfaceDetail,
  });
  let color: [number, number, number];
  if (!land) {
    if (mode === "seafloor") {
      const depth = clamp(-heightMetres / 6_000, 0, 1);
      color = mix([45 / 255, 151 / 255, 155 / 255], [18 / 255, 58 / 255, 82 / 255], depth);
    } else {
      const shallow = clamp((heightMetres + 5_000) / 5_000, 0, 1);
      color = mix([12 / 255, 48 / 255, 70 / 255], [27 / 255, 110 / 255, 139 / 255], shallow * 0.8);
    }
  } else {
    const altitude = clamp(heightMetres / 5_000, 0, 1);
    const absoluteLatitude = Math.abs(coordinates[1]);
    const subtropical = smoothstep(12, 23, absoluteLatitude) *
      (1 - smoothstep(34, 49, absoluteLatitude));
    const temperate = smoothstep(-3, 7, localTemperature) *
      (1 - smoothstep(21, 31, localTemperature));
    const vegetation = clamp(environment.vegetation * (1 - subtropical * 0.55) *
      (1 - altitude * 0.35), 0, 1);
    color = mix([124 / 255, 139 / 255, 82 / 255], [42 / 255, 119 / 255, 67 / 255], vegetation);
    color = mix(color, [144 / 255, 128 / 255, 103 / 255], altitude * 0.72);
    color = mix(color, [79 / 255, 126 / 255, 75 / 255], temperate * vegetation * 0.24);
  }
  if (land && ice > 0) color = mix(color, [228 / 255, 238 / 255, 236 / 255], ice * 0.9);
  return [
    clamp(perceptualMaterialChannel(color[0], detail, 0), 0, 1),
    clamp(perceptualMaterialChannel(color[1], detail, 1), 0, 1),
    clamp(perceptualMaterialChannel(color[2], detail, 2), 0, 1),
    detail.heightDeltaMetres,
  ];
}

/**
 * Update one already-visible cube tile. The display tessellation stays fixed;
 * its source samples move through a model-owned material resolver. Unknown
 * ownership retains the nearest native surface instead of inventing ancestry.
 */
export function updateTemporalCubeTile(
  fields: Readonly<CubeTileFields>,
  fallbackSurface: SurfaceFields,
  temporal: TemporalSurface,
  environment: WorldSnapshot["environment"],
  mode: SurfaceMode,
  verticalExaggeration: number,
  resolver: Pick<PaleomapIntervalResolver, "resolveAt">,
  target: TemporalCubeUpdateTarget,
  surfaceDetail: SurfaceDetail = "coarse",
): TemporalCubeUpdateResult {
  const vertexCount = fields.directions.length / 3;
  if (target.positions.length !== fields.directions.length || target.colors.length !== vertexCount * 3) {
    throw new RangeError("Temporal cube targets do not match the tile vertex count");
  }
  if (target.shadingPositions !== undefined && target.shadingPositions.length !== fields.directions.length) {
    throw new RangeError("Temporal shading target does not match the tile vertex count");
  }
  if (target.uvs !== undefined && target.uvs.length !== vertexCount * 2) {
    throw new RangeError("Temporal source UV target does not match the tile vertex count");
  }
  let resolvedVertices = 0;
  let minHeightMetres = Number.POSITIVE_INFINITY;
  let maxHeightMetres = Number.NEGATIVE_INFINITY;
  const sampler = materialSampler(temporal.seedId);
  const preserveExactModernMaterial = temporal.exactEndpoint &&
    temporal.requestedAgeMa === 0;
  const preserveExactModernPatch = temporal.exactEndpoint &&
    temporal.requestedAgeMa === 0 && fields.sourcePatchIds.length > 0;
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 3;
    const direction: [number, number, number] = [
      fields.directions[offset],
      fields.directions[offset + 1],
      fields.directions[offset + 2],
    ];
    const displayedCoordinates = directionToTemporalCoordinates(direction);
    const mapping = resolver.resolveAt(lonLatToPeriodDirection(displayedCoordinates));
    let heightMetres: number;
    let color: [number, number, number];
    let shadingHeightDeltaMetres = 0;
    let materialCoordinates = displayedCoordinates;
    if (mapping === null) {
      // Unsupported ownership is intentionally discrete. Height and material
      // select the same nearest native endpoint, so crossing the half interval
      // can never combine one frame's relief with another frame's colour.
      const fallbackControls = temporal.fraction < 0.5
        ? temporal.younger.controls
        : temporal.older.controls;
      heightMetres = sampleTemporalControlHeight(fallbackControls, displayedCoordinates);
      if (preserveExactModernPatch) heightMetres = fields.heightsMetres[index]!;
      const icePotential = sampleOptionalControl(
        fallbackControls.potentialIce,
        fallbackControls,
        displayedCoordinates,
      );
      const material = temporalMaterial(
        heightMetres,
        displayedCoordinates,
        displayedCoordinates,
        environment,
        mode,
        sampler,
        icePotential,
        sampleTemporalControlRuggedness(fallbackControls, displayedCoordinates),
        surfaceDetail,
      );
      color = [material[0], material[1], material[2]];
      shadingHeightDeltaMetres = material[3];
    } else {
      resolvedVertices += 1;
      const youngerCoordinates = periodDirectionToLonLat(mapping.youngerDirection);
      const olderCoordinates = periodDirectionToLonLat(mapping.olderDirection);
      const referenceCoordinates = periodDirectionToLonLat(mapping.referenceDirection);
      materialCoordinates = target.textureSourceAgeMa === temporal.older.ageMa
        ? olderCoordinates
        : youngerCoordinates;
      const youngerHeight = sampleTemporalControlHeight(
        temporal.younger.controls,
        youngerCoordinates,
      );
      const olderHeight = sampleTemporalControlHeight(
        temporal.older.controls,
        olderCoordinates,
      );
      heightMetres = interpolateTemporalHeight(youngerHeight, olderHeight, temporal.fraction);
      if (preserveExactModernPatch) heightMetres = fields.heightsMetres[index]!;
      const youngerIce = sampleOptionalControl(
        temporal.younger.controls.potentialIce,
        temporal.younger.controls,
        youngerCoordinates,
      );
      const olderIce = sampleOptionalControl(
        temporal.older.controls.potentialIce,
        temporal.older.controls,
        olderCoordinates,
      );
      const material = temporalMaterial(
        heightMetres,
        displayedCoordinates,
        referenceCoordinates,
        environment,
        mode,
        sampler,
        interpolateTemporalHeight(youngerIce, olderIce, temporal.fraction),
        interpolateTemporalHeight(
          sampleTemporalControlRuggedness(temporal.younger.controls, youngerCoordinates),
          sampleTemporalControlRuggedness(temporal.older.controls, olderCoordinates),
          temporal.fraction,
        ),
        surfaceDetail,
      );
      color = [material[0], material[1], material[2]];
      shadingHeightDeltaMetres = material[3];
    }
    if (target.uvs !== undefined && preserveExactModernMaterial) {
      const uvOffset = index * 2;
      target.uvs[uvOffset] = fields.localUvs[uvOffset]!;
      target.uvs[uvOffset + 1] = fields.localUvs[uvOffset + 1]!;
      color = [1, 1, 1];
    } else if (target.uvs !== undefined) {
      const uvOffset = index * 2;
      target.uvs[uvOffset] = (materialCoordinates[0] + 180) / 360;
      target.uvs[uvOffset + 1] = (materialCoordinates[1] + 90) / 180;
      const sourceColor = sampleSurfaceColor(
        fallbackSurface,
        materialCoordinates[0],
        materialCoordinates[1],
      );
      color = [
        clamp(color[0] / Math.max(0.16, sourceColor[0]), 0.42, 1.65),
        clamp(color[1] / Math.max(0.16, sourceColor[1]), 0.42, 1.65),
        clamp(color[2] / Math.max(0.16, sourceColor[2]), 0.42, 1.65),
      ];
    }
    minHeightMetres = Math.min(minHeightMetres, heightMetres);
    maxHeightMetres = Math.max(maxHeightMetres, heightMetres);
    const displayedHeight = mode === "surface" ? Math.max(0, heightMetres) : heightMetres;
    const radius = 1 + (displayedHeight / EARTH_RADIUS_METRES) * verticalExaggeration;
    target.positions[offset] = direction[0] * radius;
    target.positions[offset + 1] = direction[1] * radius;
    target.positions[offset + 2] = direction[2] * radius;
    if (target.shadingPositions !== undefined) {
      const shadingRadius = radius +
        (shadingHeightDeltaMetres / EARTH_RADIUS_METRES) * verticalExaggeration;
      target.shadingPositions[offset] = direction[0] * shadingRadius;
      target.shadingPositions[offset + 1] = direction[1] * shadingRadius;
      target.shadingPositions[offset + 2] = direction[2] * shadingRadius;
    }
    target.colors[offset] = color[0];
    target.colors[offset + 1] = color[1];
    target.colors[offset + 2] = color[2];
  }
  return {
    vertices: vertexCount,
    resolvedVertices,
    fallbackVertices: vertexCount - resolvedVertices,
    minHeightMetres,
    maxHeightMetres,
  };
}

/** Keep equirectangular repeat coordinates continuous inside one tile. */
export function unwrapTemporalTileUvs(meshSegments: number, uvs: Float32Array): void {
  const row = meshSegments + 1;
  if (uvs.length !== row * row * 2) {
    throw new RangeError("Temporal UV target dimensions do not match meshSegments");
  }
  for (let y = 0; y < row; y += 1) {
    for (let x = 0; x < row; x += 1) {
      if (x === 0 && y === 0) continue;
      const offset = (y * row + x) * 2;
      const referenceOffset = x > 0 ? offset - 2 : offset - row * 2;
      uvs[offset] += Math.round(uvs[referenceOffset]! - uvs[offset]!);
    }
  }
}
