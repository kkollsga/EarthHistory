import { createNoise3D } from "simplex-noise";
import type {
  LonLat,
  ModernClimateControl,
  ModernClimateGroup,
  ProceduralControls,
  SurfaceStage,
  WorldSnapshot,
} from "../data";
import { rasterizeLandMask } from "./landMask";
import { normalizeLongitude } from "./math";

export type SurfaceDetail = "coarse" | "regional";
export type SurfaceMode = "surface" | "seafloor";
export const EARTH_RADIUS_METRES = 6_371_000;
export const RELIEF_RANGE_METRES = 9_000;

export function reliefDisplacementScale(
  verticalExaggeration: number,
  reliefRangeMetres = RELIEF_RANGE_METRES,
): number {
  const exaggeration = Math.max(1, Math.min(30, verticalExaggeration));
  return (reliefRangeMetres / EARTH_RADIUS_METRES) * exaggeration;
}

export interface SurfaceFields {
  width: number;
  height: number;
  albedo: Uint8Array;
  relief: Uint8Array;
  reliefMetres: Float32Array;
  reliefRangeMetres: number;
  reliefBiasMetres: number;
  roughness: Uint8Array;
  landMask: Uint8Array;
  clouds: Uint8Array;
  cloudWidth: number;
  cloudHeight: number;
  rivers: LonLat[][];
  generationMs: number;
  byteLength: number;
}

export function sampleSurfaceLand(
  fields: SurfaceFields,
  longitude: number,
  latitude: number,
): boolean {
  const u = (normalizeLongitude(longitude) + 180) / 360;
  const v = (latitude + 90) / 180;
  const fx = u * fields.width - 0.5;
  const fy = Math.max(0, Math.min(fields.height - 1, (1 - v) * fields.height - 0.5));
  const xBase = Math.floor(fx);
  const x0 = ((xBase % fields.width) + fields.width) % fields.width;
  const x1 = (x0 + 1) % fields.width;
  const y0 = Math.floor(fy);
  const y1 = Math.min(fields.height - 1, y0 + 1);
  const tx = fx - xBase;
  const ty = fy - y0;
  const at = (x: number, y: number) => fields.landMask[y * fields.width + x];
  const north = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const south = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return north * (1 - ty) + south * ty >= 127.5;
}

export function sampleSurfaceReliefMetres(
  fields: SurfaceFields,
  u: number,
  v: number,
): number {
  const wrappedU = ((u % 1) + 1) % 1;
  const fx = wrappedU * fields.width - 0.5;
  const fy = Math.max(0, Math.min(fields.height - 1, (1 - v) * fields.height - 0.5));
  const xBase = Math.floor(fx);
  const x0 = ((xBase % fields.width) + fields.width) % fields.width;
  const x1 = (x0 + 1) % fields.width;
  const y0 = Math.floor(fy);
  const y1 = Math.min(fields.height - 1, y0 + 1);
  const tx = fx - xBase;
  const ty = fy - y0;
  const at = (x: number, y: number) => fields.reliefMetres[y * fields.width + x];
  const north = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const south = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return north * (1 - ty) + south * ty;
}

export function inferDrainageCorridors(snapshot: WorldSnapshot): LonLat[][] {
  const controls = snapshot.controls;
  const stage = snapshot.environment.stage ?? "modern-biomes";
  if (controls === undefined || !MATURE_STAGES.has(stage)) return [];
  const { width, height, elevation } = controls;
  const count = width * height;
  const downstream = new Int32Array(count).fill(-1);
  const accumulation = new Float32Array(count).fill(1);
  const landCells: number[] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const current = elevation[index];
      if (!(current > 0)) continue;
      landCells.push(index);
      let lowest = current;
      let lowestIndex = -1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = (x + dx + width) % width;
          const ny = y + dy;
          const neighborIndex = ny * width + nx;
          const neighbor = elevation[neighborIndex];
          if (neighbor < lowest) {
            lowest = neighbor;
            lowestIndex = neighborIndex;
          }
        }
      }
      downstream[index] = lowestIndex;
    }
  }

  landCells.sort((a, b) => elevation[b] - elevation[a]);
  for (const index of landCells) {
    const target = downstream[index];
    if (target >= 0) accumulation[target] += accumulation[index];
  }

  const threshold = Math.max(7, count * 0.00045);
  const candidates = landCells
    .filter((index) => {
      const target = downstream[index];
      return target >= 0 && elevation[target] >= 0 && accumulation[index] >= threshold;
    })
    .sort((a, b) => accumulation[b] - accumulation[a])
    .slice(0, 360);

  const coordinates = (index: number): LonLat => {
    const x = index % width;
    const y = Math.floor(index / width);
    return [-180 + (x * 360) / width, 90 - (y * 180) / (height - 1)];
  };
  return candidates.map((index) => [coordinates(index), coordinates(downstream[index])]);
}

const MATURE_STAGES = new Set<SurfaceStage>([
  "microbial-world",
  "barren-continents",
  "early-land-plants",
  "forest-world",
  "flowering-plants",
  "modern-biomes",
]);

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createSphericalNoise(seed: number) {
  const sample3d = createNoise3D(seededRandom(seed));
  return (longitude: number, latitude: number, frequency: number, octaves: number) => {
    const lon = (longitude * Math.PI) / 180;
    const lat = (latitude * Math.PI) / 180;
    const cosLat = Math.cos(lat);
    const px = cosLat * Math.cos(lon);
    const py = Math.sin(lat);
    const pz = cosLat * Math.sin(lon);
    let amplitude = 1;
    let total = 0;
    let weight = 0;
    let scale = frequency;
    for (let octave = 0; octave < octaves; octave++) {
      total += sample3d(px * scale, py * scale, pz * scale) * amplitude;
      weight += amplitude;
      amplitude *= 0.48;
      scale *= 2.03;
    }
    return (total / weight) * 0.5 + 0.5;
  };
}

export function polarLongitudeSampleCount(
  width: number,
  height: number,
  latitude: number,
): number {
  if (width < 1 || height < 2) return 1;
  const latitudeStep = 180 / (height - 1);
  const longitudeStep = 360 / width;
  const physicalLongitudeStep = longitudeStep * Math.max(
    1e-6,
    Math.abs(Math.cos(latitude * Math.PI / 180)),
  );
  const footprintRatio = latitudeStep / physicalLongitudeStep;
  // Below this threshold extra work has little visual value. Near a pole the
  // cap prevents a malformed or extremely dense source row from making worker
  // cost unbounded.
  return footprintRatio < 4 ? 1 : Math.min(32, Math.ceil(footprintRatio));
}

export function sampleGeographicGrid(
  field: Float32Array | Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
  northPoleValue?: number,
  southPoleValue?: number,
): number {
  if (field.length === 0) return 0;
  // Source grids are geographic points: -180..+178 wraps in longitude and
  // +90..-90 includes both poles. Bilinear display sampling smooths the compact
  // field without moving or adding scientific control points.
  const fy = Math.max(0, Math.min(height - 1, v * (height - 1)));
  const y0 = Math.floor(fy);
  const y1 = Math.min(height - 1, y0 + 1);
  const ty = fy - y0;
  const valueAt = (x: number, y: number) => {
    if (y === 0 && northPoleValue !== undefined) return northPoleValue;
    if (y === height - 1 && southPoleValue !== undefined) return southPoleValue;
    const value = field[y * width + x];
    return Number.isFinite(value) ? value : 0;
  };
  const sampleLongitude = (sampleU: number) => {
    const fx = sampleU * width;
    const xBase = Math.floor(fx);
    const x0 = ((xBase % width) + width) % width;
    const x1 = (x0 + 1) % width;
    const tx = fx - xBase;
    const north = valueAt(x0, y0) * (1 - tx) + valueAt(x1, y0) * tx;
    const south = valueAt(x0, y1) * (1 - tx) + valueAt(x1, y1) * tx;
    return north * (1 - ty) + south * ty;
  };
  const latitude = 90 - v * 180;
  const longitudeSamples = polarLongitudeSampleCount(width, height, latitude);
  if (longitudeSamples === 1) return sampleLongitude(u);
  let total = 0;
  for (let sample = 0; sample < longitudeSamples; sample += 1) {
    const cellOffset = sample - (longitudeSamples - 1) / 2;
    total += sampleLongitude(u + cellOffset / width);
  }
  return total / longitudeSamples;
}

function sampleElevation(
  snapshot: WorldSnapshot,
  u: number,
  v: number,
  northPoleValue?: number,
  southPoleValue?: number,
): number {
  const controls = snapshot.controls;
  if (controls === undefined) return 0;
  return sampleGeographicGrid(
    controls.elevation,
    controls.width,
    controls.height,
    u,
    v,
    northPoleValue,
    southPoleValue,
  );
}

/**
 * A bounded visual ruggedness measure derived only from the loaded elevation
 * grid. It changes material exposure and fine-detail amplitude; it does not
 * add a geographic landform or claim a measured palaeoslope.
 */
export function sampleSourceReliefRuggedness(
  snapshot: WorldSnapshot,
  longitude: number,
  latitude: number,
  northPoleValue = poleElevation(snapshot, true),
  southPoleValue = poleElevation(snapshot, false),
): number {
  const controls = snapshot.controls;
  if (controls === undefined || controls.width < 2 || controls.height < 2) return 0;
  const u = (normalizeLongitude(longitude) + 180) / 360;
  const v = (90 - Math.max(-90, Math.min(90, latitude))) / 180;
  const du = 1 / controls.width;
  const dv = 1 / (controls.height - 1);
  const west = sampleElevation(snapshot, u - du, v, northPoleValue, southPoleValue);
  const east = sampleElevation(snapshot, u + du, v, northPoleValue, southPoleValue);
  const north = sampleElevation(snapshot, u, Math.max(0, v - dv), northPoleValue, southPoleValue);
  const south = sampleElevation(snapshot, u, Math.min(1, v + dv), northPoleValue, southPoleValue);
  const longitudeSpanMetres = Math.max(
    1,
    2 * 111_320 * (360 / controls.width) * Math.max(0.025, Math.abs(Math.cos(latitude * Math.PI / 180))),
  );
  const latitudeSpanMetres = Math.max(1, 2 * 110_574 * (180 / (controls.height - 1)));
  const grade = Math.hypot(
    (east - west) / longitudeSpanMetres,
    (south - north) / latitudeSpanMetres,
  );
  return smoothstep(0.0015, 0.025, grade);
}

function poleElevation(snapshot: WorldSnapshot, north: boolean): number | undefined {
  const controls = snapshot.controls;
  if (controls === undefined) return undefined;
  const row = north ? 0 : controls.height - 1;
  const values = Array.from(
    controls.elevation.subarray(row * controls.width, (row + 1) * controls.width),
  ).filter(Number.isFinite).sort((left, right) => left - right);
  if (values.length === 0) return undefined;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

const CONTROL_POLE_ELEVATION_CACHE = new WeakMap<ProceduralControls, readonly [number, number]>();

/** Sample the signed, source-controlled physical elevation at a geographic point. */
export function sampleProceduralControlElevation(
  controls: ProceduralControls,
  longitude: number,
  latitude: number,
): number {
  let poles = CONTROL_POLE_ELEVATION_CACHE.get(controls);
  if (poles === undefined) {
    const median = (row: number) => {
      const values = Array.from(
        controls.elevation.subarray(row * controls.width, (row + 1) * controls.width),
      ).filter(Number.isFinite).sort((left, right) => left - right);
      if (values.length === 0) return 0;
      const middle = Math.floor(values.length / 2);
      return values.length % 2 === 0
        ? (values[middle - 1]! + values[middle]!) / 2
        : values[middle]!;
    };
    poles = [median(0), median(controls.height - 1)];
    CONTROL_POLE_ELEVATION_CACHE.set(controls, poles);
  }
  const normalized = normalizeLongitude(longitude);
  return sampleGeographicGrid(
    controls.elevation,
    controls.width,
    controls.height,
    (normalized + 180) / 360,
    (90 - Math.max(-90, Math.min(90, latitude))) / 180,
    poles[0],
    poles[1],
  );
}

interface SouthPoleClimateGapFill {
  value: number;
  boundaryLatitude: number;
}

const SOUTH_POLE_CLIMATE_GAP_CACHE = new WeakMap<
  ModernClimateControl,
  SouthPoleClimateGapFill | null
>();

function southPoleClimateGapFill(
  control: ModernClimateControl,
): SouthPoleClimateGapFill | undefined {
  const cached = SOUTH_POLE_CLIMATE_GAP_CACHE.get(control);
  if (cached !== undefined) return cached ?? undefined;
  for (let y = control.height - 1; y >= 0; y -= 1) {
    const offset = y * control.width;
    let value: number | undefined;
    let complete = true;
    for (let x = 0; x < control.width; x += 1) {
      const candidate = control.classes[offset + x];
      if (candidate === control.noDataValue) {
        complete = false;
        break;
      }
      value ??= candidate;
      if (candidate !== value) {
        complete = false;
        break;
      }
    }
    if (!complete || value === undefined) continue;
    const boundaryLatitude = control.latitudeOrigin - y * control.cellSizeDegrees;
    const group = control.legend.find((entry) => entry.value === value)?.group;
    const result = boundaryLatitude <= -88 && group === "frost"
      ? { value, boundaryLatitude }
      : undefined;
    SOUTH_POLE_CLIMATE_GAP_CACHE.set(control, result ?? null);
    return result;
  }
  SOUTH_POLE_CLIMATE_GAP_CACHE.set(control, null);
  return undefined;
}

function climateValueAt(
  control: ModernClimateControl,
  x: number,
  y: number,
  southPoleGapFill: SouthPoleClimateGapFill | undefined,
): number | undefined {
  const value = control.classes[y * control.width + x];
  if (value !== undefined && value !== control.noDataValue) return value;
  const latitude = control.latitudeOrigin - y * control.cellSizeDegrees;
  // Beck's final three southern raster rows are no-data after a complete EF
  // row at 88.25°S. Extend that class only to the mathematical pole without
  // mutating the source climate/control bytes.
  return southPoleGapFill !== undefined && latitude < southPoleGapFill.boundaryLatitude
    ? southPoleGapFill.value
    : undefined;
}

function sampleModernClimateValue(
  control: ModernClimateControl,
  longitude: number,
  latitude: number,
  southPoleGapFill = southPoleClimateGapFill(control),
): number | undefined {
  const wrappedLongitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  const x =
    ((Math.round((wrappedLongitude - control.longitudeOrigin) / control.cellSizeDegrees) %
      control.width) +
      control.width) %
    control.width;
  const y = Math.max(
    0,
    Math.min(
      control.height - 1,
      Math.round((control.latitudeOrigin - latitude) / control.cellSizeDegrees),
    ),
  );
  const value = climateValueAt(control, x, y, southPoleGapFill);
  return value;
}

function sampleModernClimateMembership(
  control: ModernClimateControl,
  groups: Array<ModernClimateGroup | undefined>,
  longitude: number,
  latitude: number,
  requestedGroup: ModernClimateGroup,
  southPoleGapFill = southPoleClimateGapFill(control),
): number {
  const wrappedLongitude = ((longitude + 180) % 360 + 360) % 360 - 180;
  const fx = (wrappedLongitude - control.longitudeOrigin) / control.cellSizeDegrees;
  const fy = (control.latitudeOrigin - latitude) / control.cellSizeDegrees;
  const xBase = Math.floor(fx);
  const y0 = Math.max(0, Math.min(control.height - 1, Math.floor(fy)));
  const y1 = Math.max(0, Math.min(control.height - 1, y0 + 1));
  const x0 = ((xBase % control.width) + control.width) % control.width;
  const x1 = (x0 + 1) % control.width;
  const tx = fx - xBase;
  const ty = Math.max(0, Math.min(1, fy - Math.floor(fy)));
  const membership = (x: number, y: number) => {
    const value = climateValueAt(control, x, y, southPoleGapFill);
    return value !== undefined && groups[value] === requestedGroup ? 1 : 0;
  };
  const north = membership(x0, y0) * (1 - tx) + membership(x1, y0) * tx;
  const south = membership(x0, y1) * (1 - tx) + membership(x1, y1) * tx;
  return north * (1 - ty) + south * ty;
}

export function sampleModernClimateGroup(
  control: ModernClimateControl | undefined,
  longitude: number,
  latitude: number,
): ModernClimateGroup | undefined {
  if (control === undefined) return undefined;
  const value = sampleModernClimateValue(control, longitude, latitude);
  return value === undefined
    ? undefined
    : control.legend.find((item) => item.value === value)?.group;
}

function climatePotentialColor(group: ModernClimateGroup): [number, number, number] {
  switch (group) {
    case "tropical-rainforest": return [30, 101, 55];
    case "tropical-seasonal": return [87, 125, 61];
    case "desert": return [180, 143, 84];
    case "steppe": return [146, 132, 87];
    case "temperate": return [91, 123, 72];
    case "cold-forest": return [48, 91, 70];
    case "tundra": return [119, 120, 101];
    case "frost": return [222, 232, 232];
    case "ocean": return [18, 66, 91];
  }
}

export function modernClimateAllowsPermanentIce(
  group: ModernClimateGroup | undefined,
): boolean | undefined {
  return group === undefined ? undefined : group === "frost";
}

const SPHERE_AREA_WEIGHTED_MEAN_ABSOLUTE_LATITUDE = 90 - 180 / Math.PI;

/** Schematic material-temperature potential; never a calibrated climate field. */
export function proceduralLocalTemperature(
  globalMeanTemperatureC: number,
  latitude: number,
  elevationMetres: number,
): number {
  const latitudeDeparture =
    Math.abs(Math.max(-90, Math.min(90, latitude))) -
    SPHERE_AREA_WEIGHTED_MEAN_ABSOLUTE_LATITUDE;
  return globalMeanTemperatureC - latitudeDeparture * 0.42 - Math.max(0, elevationMetres) * 0.0065;
}

function writePixel(target: Uint8Array, offset: number, rgb: readonly number[], alpha = 255) {
  target[offset] = Math.max(0, Math.min(255, Math.round(rgb[0])));
  target[offset + 1] = Math.max(0, Math.min(255, Math.round(rgb[1])));
  target[offset + 2] = Math.max(0, Math.min(255, Math.round(rgb[2])));
  target[offset + 3] = alpha;
}

function mixColor(
  a: readonly number[],
  b: readonly number[],
  amount: number,
): [number, number, number] {
  const t = Math.max(0, Math.min(1, amount));
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function iceDisplayCoverage(
  potential: number,
  scenarioIntensity: number,
): number {
  if (potential <= 0 || scenarioIntensity <= 0) return 0;
  // The stored potential already contains scenario intensity. Dividing by it
  // made weak greenhouse-era potential look like an opaque modern ice cap.
  return smoothstep(0.03, 0.55, potential) * 0.96;
}

/** Qualitative ice presence/absence from the Cao et al. (2017) dated polygons. */
export function caoIceChronologyAllowsPermanentIce(ageMa: number): boolean {
  return !(ageMa > 81 && ageMa < 285.01);
}

function earlySurface(
  stage: SurfaceStage,
  n: number,
  detail: number,
  oceanCoverage: number,
): { color: [number, number, number]; reliefMetres: number; roughness: number } {
  if (stage === "accretion") {
    const hot = Math.max(0, detail - 0.82) * 5.5;
    return {
      color: mixColor([38, 30, 27], [244, 93, 25], hot),
      reliefMetres: 900 + n * 3_500,
      roughness: 238,
    };
  }
  if (stage === "giant-impact" || stage === "magma-ocean") {
    const crust = Math.max(0, Math.min(1, (detail - 0.52) * 4));
    return {
      color: mixColor([255, 118 + n * 38, 29], [42, 21, 17], crust),
      reliefMetres: 500 + n * 2_200,
      roughness: 160 + crust * 70,
    };
  }
  if (stage === "cooling-crust") {
    const crack = detail > 0.885 || Math.abs(n - 0.5) < 0.027;
    return {
      color: crack ? [238, 83, 23] : [50 + n * 26, 45 + n * 18, 43 + n * 14],
      reliefMetres: 700 + n * 2_800,
      roughness: 232,
    };
  }
  const flooded = n < oceanCoverage * 0.74 + 0.08;
  return flooded
    ? {
        color: [10, 57 + n * 28, 86 + n * 48],
        reliefMetres: 0,
        roughness: 105,
      }
    : {
        color: [80 + n * 32, 66 + n * 26, 53 + n * 20],
        reliefMetres: 600 + n * 2_600,
        roughness: 224,
      };
}

export function generateSurface(
  snapshot: WorldSnapshot,
  detail: SurfaceDetail,
  resolution?: { width: number; height: number },
  mode: SurfaceMode = "surface",
): SurfaceFields {
  const started = typeof performance === "undefined" ? Date.now() : performance.now();
  const width = resolution?.width ?? (detail === "regional" ? 768 : 512);
  const height = resolution?.height ?? width / 2;
  const length = width * height * 4;
  const albedo = new Uint8Array(length);
  const relief = new Uint8Array(length);
  const reliefMetresField = new Float32Array(width * height);
  const roughness = new Uint8Array(length);
  const landMask = snapshot.land.length > 0
    ? rasterizeLandMask(snapshot.land, width, height)
    : new Uint8Array(width * height);
  // Cloud structure is broad and translucent; capping it below the terrain
  // raster avoids recomputing imperceptible texels on every period change.
  const cloudWidth = Math.min(width, 256);
  const cloudHeight = Math.max(1, Math.round(cloudWidth / 2));
  const clouds = new Uint8Array(cloudWidth * cloudHeight * 4);
  // Historical material texture follows the source/model family rather than
  // the requested age or interval. This keeps authored-looking detail fixed
  // to a material resolver while the timeline moves and still gives
  // illustrative pre-reconstruction scenes their existing snapshot seed.
  const seed = hashString(snapshot.renderSeedId ?? snapshot.temporalSurface?.seedId ?? snapshot.id);
  const sphericalNoise = createSphericalNoise(seed);
  const stage = snapshot.environment.stage ?? "modern-biomes";
  const mature = MATURE_STAGES.has(stage);
  const seafloorActive = mode === "seafloor" && mature && snapshot.controls !== undefined;
  const reliefRangeMetres = seafloorActive ? RELIEF_RANGE_METRES * 2 : RELIEF_RANGE_METRES;
  const reliefBiasMetres = seafloorActive ? -RELIEF_RANGE_METRES : 0;
  const vegetation = Math.max(0, Math.min(1, snapshot.environment.vegetation));
  const globalTemperature = Number.isFinite(snapshot.environment.temperatureC)
    ? snapshot.environment.temperatureC!
    : 14;
  const iceLatitude = Math.max(0, Math.min(90, snapshot.environment.iceLatitude));
  const iceIntensity = Math.max(0, Math.min(1, snapshot.environment.iceIntensity ?? 1));
  const oceanCoverage = Math.max(0, Math.min(1, snapshot.environment.oceanCoverage ?? 0.7));
  const cloudCover = Math.max(0, Math.min(1, snapshot.environment.cloudCover ?? 0.46));
  const rivers = inferDrainageCorridors(snapshot);
  const northPoleElevation = poleElevation(snapshot, true);
  const southPoleElevation = poleElevation(snapshot, false);
  const southClimateGapFill = snapshot.modernClimate === undefined
    ? undefined
    : southPoleClimateGapFill(snapshot.modernClimate);
  const climateGroups: Array<ModernClimateGroup | undefined> = [];
  for (const entry of snapshot.modernClimate?.legend ?? []) {
    climateGroups[entry.value] = entry.group;
  }

  for (let y = 0; y < height; y++) {
    const latitude = 90 - ((y + 0.5) / height) * 180;
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const longitude = ((x + 0.5) / width) * 360 - 180;
      const u = (x + 0.5) / width;
      const offset = (y * width + x) * 4;
      const n = sphericalNoise(longitude, latitude, 1.65, 3);
      const small =
        detail === "regional" ? sphericalNoise(longitude, latitude, 7.4, 2) : n;
      const elevation = sampleElevation(
        snapshot,
        u,
        v,
        northPoleElevation,
        southPoleElevation,
      );
      const sourceRuggedness = sampleSourceReliefRuggedness(
        snapshot,
        longitude,
        latitude,
        northPoleElevation,
        southPoleElevation,
      );
      const vegetationControl = snapshot.controls?.vegetationPotential;
      const vegetationAtPoint =
        vegetationControl === undefined
          ? undefined
          : sampleGeographicGrid(
              vegetationControl,
              snapshot.controls!.width,
              snapshot.controls!.height,
              u,
              v,
            ) / 255;
      const iceControl = snapshot.controls?.potentialIce;
      const iceAtPoint =
        iceControl === undefined
          ? undefined
          : sampleGeographicGrid(
              iceControl,
              snapshot.controls!.width,
              snapshot.controls!.height,
              u,
              v,
            ) / 255;
      const climateValue = snapshot.modernClimate === undefined
        ? undefined
        : sampleModernClimateValue(
            snapshot.modernClimate,
            longitude,
            latitude,
            southClimateGapFill,
          );
      const climateGroup = climateValue === undefined ? undefined : climateGroups[climateValue];
      let modernFrostCoverage: number | undefined;
      if (snapshot.modernClimate !== undefined) {
        const frostAt = (lon: number, lat: number) => sampleModernClimateMembership(
          snapshot.modernClimate!, climateGroups, lon, lat, "frost", southClimateGapFill,
        );
        modernFrostCoverage = frostAt(longitude, latitude);
        if (Math.abs(latitude) > 45) {
          modernFrostCoverage =
            modernFrostCoverage * 0.44 +
            (frostAt(longitude - 0.45, latitude) +
              frostAt(longitude + 0.45, latitude) +
              frostAt(longitude, latitude - 0.45) +
              frostAt(longitude, latitude + 0.45)) * 0.14;
        }
      }
      const hasMappedElevation = snapshot.controls !== undefined;
      const hasMappedLand = hasMappedElevation || snapshot.land.length > 0;
      const sourceLand = mature && (
        snapshot.land.length > 0
          ? landMask[y * width + x] > 0
          : snapshot.controls !== undefined
            ? elevation > 0
            : n > 0.34 + oceanCoverage * 0.26
      );
      // An EF control, including the documented Antarctic pole display gap-fill,
      // can establish an ice-covered surface over negative bed elevation. It
      // never replaces signed seafloor bed relief or infers ice thickness.
      const modernIceSurface = mature && mode === "surface" && climateGroup === "frost";
      const land = sourceLand || modernIceSurface;
      landMask[y * width + x] = land ? 255 : 0;

      let color: [number, number, number];
      let reliefMetres: number;
      let roughnessValue: number;

      if (!mature) {
        const early = earlySurface(stage, n, small, oceanCoverage);
        color = early.color;
        reliefMetres = early.reliefMetres;
        roughnessValue = early.roughness;
      } else if (!land) {
        const shallow = Math.max(0, Math.min(1, (elevation + 5000) / 5000));
        if (seafloorActive) {
          const depth = Math.max(0, Math.min(1, -elevation / 6_000));
          color = mixColor([45, 151, 155], [18, 58, 82], depth);
          color = mixColor(color, [94, 105, 99], sourceRuggedness * 0.32);
          reliefMetres = Math.max(-RELIEF_RANGE_METRES, elevation);
          roughnessValue = 182 + depth * 22 + sourceRuggedness * 42 + n * 12;
        } else {
          color = mixColor([12, 48, 70], [27, 110, 139], shallow * 0.8 + n * 0.12);
          reliefMetres = 0;
          roughnessValue = 102 + n * 24;
        }
      } else {
        const altitude = hasMappedLand
          ? Math.max(0, Math.min(1, elevation / 5000))
          : Math.max(0, (n - 0.46) * 1.8);
        const absoluteLatitude = Math.abs(latitude);
        const subtropicalBand =
          smoothstep(12, 23, absoluteLatitude) *
          (1 - smoothstep(34, 49, absoluteLatitude));
        const aridity = subtropicalBand * (0.26 + n * 0.34);
        const localTemperature = proceduralLocalTemperature(
          globalTemperature,
          latitude,
          elevation,
        );
        const temperatePotential =
          smoothstep(-3, 7, localTemperature) *
          (1 - smoothstep(21, 31, localTemperature)) *
          (1 - aridity * 0.72);
        const coldPotential = 1 - smoothstep(-7, 8, localTemperature);
        const green = Math.max(
          0,
          (vegetationAtPoint ?? vegetation * (0.72 + n * 0.4)) -
            aridity - altitude * 0.28 - sourceRuggedness * 0.38,
        );
        const lowland: [number, number, number] = [124, 139, 82];
        const forest: [number, number, number] = [42, 119, 67];
        const stone: [number, number, number] = [144, 128, 103];
        color = mixColor(
          mixColor(lowland, forest, green),
          stone,
          Math.min(0.94, altitude * 0.72 + sourceRuggedness * 0.82),
        );
        color = mixColor(color, [177, 145, 89], aridity * (0.45 + n * 0.25));
        if (climateGroup === undefined) {
          // Historical scenes currently have no loaded climate experiment.
          // This continuous, temperature/elevation-driven material tint is an
          // explicitly procedural potential, not a categorical climate map.
          color = mixColor(color, [79, 126, 75], temperatePotential * vegetation * 0.24);
          color = mixColor(
            color,
            [127, 126, 111],
            coldPotential * Math.max(0, Math.min(1, iceIntensity)) * 0.28,
          );
        }
        if (climateGroup !== undefined && climateGroup !== "ocean") {
          // Köppen classes constrain modern climate potential. The restrained
          // blend keeps relief and local texture visible and does not claim a
          // categorical vegetation or land-cover inventory.
          const climateTexture = 0.88 + (small - 0.5) * 0.16;
          const climateColor = climatePotentialColor(climateGroup).map(
            (channel) => channel * climateTexture,
          ) as [number, number, number];
          color = mixColor(color, climateColor, climateGroup === "frost" ? 0.78 : 0.62);
        }
        // A numeric elevation control owns physical height. Procedural noise
        // remains in material and bump channels, so native knots recover the
        // source DEM instead of adding unsourced metres at the transition.
        reliefMetres = Math.max(0, hasMappedElevation
          ? elevation
          : altitude * 4_200 + (small - 0.5) * 260);
        roughnessValue = 172 + altitude * 38 + sourceRuggedness * 56 + small * 14;
      }

      const raggedIceEdge = iceLatitude + (n - 0.5) * 13 - Math.max(0, elevation) / 1800;
      const climateIcePotential = modernClimateAllowsPermanentIce(climateGroup);
      const potentialIceAllowed = climateIcePotential ??
        (iceIntensity >= 0.9 || Math.abs(latitude) > raggedIceEdge);
      // Cao et al. (2017) resolves no ice polygons between the 81 Ma end of
      // its 76 Ma feature and the 285.01 Ma start of its 287 Ma feature. Use
      // that source only as a presence/absence constraint; its geometry is in
      // a different frame and is never draped on this PALEOMAP surface.
      const reconstructionAgeMa = snapshot.requestedAgeMa ?? snapshot.ageMa;
      const sourceAllowsPermanentIce = caoIceChronologyAllowsPermanentIce(reconstructionAgeMa);
      const ice = mature && sourceAllowsPermanentIce &&
        (modernFrostCoverage !== undefined
          ? modernIceSurface || (land && modernFrostCoverage > 0.015)
          : iceAtPoint !== undefined
          ? iceAtPoint > 0.025 && potentialIceAllowed
          : iceIntensity > 0 &&
            Math.abs(latitude) > raggedIceEdge &&
            (land || Math.abs(latitude) > 78));
      if (ice) {
        const iceMix = Math.min(
          0.97,
          modernFrostCoverage !== undefined
            ? smoothstep(0.015, 0.82, modernFrostCoverage) * (0.88 + small * 0.08)
            : iceAtPoint === undefined
            ? iceIntensity * (0.7 + small * 0.25)
            : iceDisplayCoverage(iceAtPoint, iceIntensity),
        );
        color = mixColor(color, [228, 238, 236], iceMix);
        roughnessValue = 208;
        // EF over negative bed has no authored ice-surface elevation. Keep the
        // illustrative ice cover at the display datum instead of turning its
        // potential mask into invented topography; signed bed remains in the
        // explicit seafloor view.
        if (!hasMappedElevation && !(modernIceSurface && !sourceLand)) {
          reliefMetres += 180 * (iceAtPoint ?? iceIntensity);
        }
      }

      writePixel(albedo, offset, color);
      const clampedReliefMetres = Math.max(
        reliefBiasMetres,
        Math.min(reliefBiasMetres + reliefRangeMetres, reliefMetres),
      );
      reliefMetresField[y * width + x] = clampedReliefMetres;
      const encodedRelief =
        ((clampedReliefMetres -
          reliefBiasMetres) /
          reliefRangeMetres) *
        255;
      writePixel(relief, offset, [encodedRelief, encodedRelief, encodedRelief]);
      // Three.js consumes the green channel for roughness. Alpha retains the
      // normalized source-grid ruggedness so later material synthesis can
      // distinguish a rough-looking soil palette from an actual relief slope.
      writePixel(
        roughness,
        offset,
        [roughnessValue, roughnessValue, roughnessValue],
        Math.round(sourceRuggedness * 255),
      );

    }
  }

  // Clouds are a global shell and do not gain useful information from the
  // regional terrain raster. Keeping their synthesis independently bounded
  // avoids five noise octaves per high-detail surface texel.
  for (let y = 0; y < cloudHeight; y += 1) {
    const latitude = 90 - ((y + 0.5) / cloudHeight) * 180;
    for (let x = 0; x < cloudWidth; x += 1) {
      const longitude = ((x + 0.5) / cloudWidth) * 360 - 180;
      const offset = (y * cloudWidth + x) * 4;
      const front = sphericalNoise(longitude, latitude, 2.35, 3);
      const wisps = sphericalNoise(longitude, latitude, 7.2, 2);
      const band = Math.cos((latitude * Math.PI) / 90) * 0.075;
      const cloudNoise = front * 0.82 + wisps * 0.18;
      const cloudThreshold = 0.655 - cloudCover * 0.12 - band;
      const cloudAlpha = Math.max(0, Math.min(155, (cloudNoise - cloudThreshold) * 540));
      writePixel(clouds, offset, [239, 244, 243], cloudAlpha);
    }
  }

  const ended = typeof performance === "undefined" ? Date.now() : performance.now();
  return {
    width,
    height,
    albedo,
    relief,
    reliefMetres: reliefMetresField,
    reliefRangeMetres,
    reliefBiasMetres,
    roughness,
    landMask,
    clouds,
    cloudWidth,
    cloudHeight,
    rivers,
    generationMs: ended - started,
    byteLength:
      albedo.byteLength +
      relief.byteLength +
      reliefMetresField.byteLength +
      roughness.byteLength +
      landMask.byteLength +
      clouds.byteLength +
      rivers.length * 4 * Float64Array.BYTES_PER_ELEMENT,
  };
}
