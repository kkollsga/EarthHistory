import { createNoise3D } from "simplex-noise";
import type {
  LonLat,
  ModernClimateControl,
  ModernClimateGroup,
  SurfaceStage,
  TectonicFeature,
  WorldSnapshot,
} from "../data";
import { normalizeLongitude, pointInRing } from "./math";

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
  reliefRangeMetres: number;
  reliefBiasMetres: number;
  roughness: Uint8Array;
  clouds: Uint8Array;
  rivers: LonLat[][];
  generationMs: number;
  byteLength: number;
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
  const at = (x: number, y: number) => fields.relief[(y * fields.width + x) * 4] / 255;
  const north = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const south = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return fields.reliefBiasMetres +
    (north * (1 - ty) + south * ty) * fields.reliefRangeMetres;
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

function sampleGrid(
  field: Float32Array | Uint8Array,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  if (field.length === 0) return 0;
  // Source grids are geographic points: -180..+178 wraps in longitude and
  // +90..-90 includes both poles. Bilinear display sampling smooths the compact
  // field without moving or adding scientific control points.
  const fx = u * width;
  const fy = Math.max(0, Math.min(height - 1, v * (height - 1)));
  const x0 = Math.floor(fx) % width;
  const x1 = (x0 + 1) % width;
  const y0 = Math.floor(fy);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - Math.floor(fx);
  const ty = fy - y0;
  const valueAt = (x: number, y: number) => {
    const value = field[y * width + x];
    return Number.isFinite(value) ? value : 0;
  };
  const north = valueAt(x0, y0) * (1 - tx) + valueAt(x1, y0) * tx;
  const south = valueAt(x0, y1) * (1 - tx) + valueAt(x1, y1) * tx;
  return north * (1 - ty) + south * ty;
}

function sampleElevation(snapshot: WorldSnapshot, u: number, v: number): number {
  const controls = snapshot.controls;
  if (controls === undefined) return 0;
  return sampleGrid(controls.elevation, controls.width, controls.height, u, v);
}

function poleElevation(snapshot: WorldSnapshot, north: boolean): number | undefined {
  const controls = snapshot.controls;
  if (controls === undefined) return undefined;
  const row = north ? 0 : controls.height - 1;
  let total = 0;
  for (let x = 0; x < controls.width; x++) total += controls.elevation[row * controls.width + x];
  return total / controls.width;
}

function sampleModernClimateValue(
  control: ModernClimateControl,
  longitude: number,
  latitude: number,
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
  const value = control.classes[y * control.width + x];
  return value === undefined || value === control.noDataValue ? undefined : value;
}

function sampleModernClimateMembership(
  control: ModernClimateControl,
  groups: Array<ModernClimateGroup | undefined>,
  longitude: number,
  latitude: number,
  requestedGroup: ModernClimateGroup,
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
    const value = control.classes[y * control.width + x];
    return value !== control.noDataValue && groups[value] === requestedGroup ? 1 : 0;
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

function polygonContains(snapshot: WorldSnapshot, point: LonLat): boolean {
  for (const polygon of snapshot.land) {
    let inside = false;
    for (const ring of polygon.coordinates) {
      if (pointInRing(point, ring)) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

function distanceToFeature(point: LonLat, feature: TectonicFeature): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < feature.coordinates.length; index++) {
    const a = feature.coordinates[index - 1];
    const b = feature.coordinates[index];
    let ax = normalizeLongitude(a[0] - point[0]);
    let bx = normalizeLongitude(b[0] - point[0]);
    if (Math.abs(ax - bx) > 180) {
      if (ax < bx) ax += 360;
      else bx += 360;
    }
    const scale = Math.cos((point[1] * Math.PI) / 180);
    const ay = a[1] - point[1];
    const by = b[1] - point[1];
    const dx = (bx - ax) * scale;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const projection =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, (-(ax * scale) * dx - ay * dy) / lengthSquared));
    const distance = Math.hypot(ax * scale + dx * projection, ay + dy * projection);
    minimum = Math.min(minimum, distance);
  }
  if (feature.coordinates.length === 1) {
    const only = feature.coordinates[0];
    minimum = Math.hypot(
      normalizeLongitude(only[0] - point[0]) *
        Math.cos((point[1] * Math.PI) / 180),
      only[1] - point[1],
    );
  }
  return minimum;
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
  const normalized = potential / Math.max(0.04, scenarioIntensity);
  return smoothstep(0.03, 0.55, normalized) * 0.96;
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
  const roughness = new Uint8Array(length);
  const clouds = new Uint8Array(length);
  const seed = hashString(snapshot.id);
  const sphericalNoise = createSphericalNoise(seed);
  const stage = snapshot.environment.stage ?? "modern-biomes";
  const mature = MATURE_STAGES.has(stage);
  const seafloorActive = mode === "seafloor" && mature && snapshot.controls !== undefined;
  const reliefRangeMetres = seafloorActive ? RELIEF_RANGE_METRES * 2 : RELIEF_RANGE_METRES;
  const reliefBiasMetres = seafloorActive ? -RELIEF_RANGE_METRES : 0;
  const vegetation = Math.max(0, Math.min(1, snapshot.environment.vegetation));
  const iceLatitude = Math.max(0, Math.min(90, snapshot.environment.iceLatitude));
  const iceIntensity = Math.max(0, Math.min(1, snapshot.environment.iceIntensity ?? 1));
  const oceanCoverage = Math.max(0, Math.min(1, snapshot.environment.oceanCoverage ?? 0.7));
  const cloudCover = Math.max(0, Math.min(1, snapshot.environment.cloudCover ?? 0.46));
  const rivers = inferDrainageCorridors(snapshot);
  const northPoleElevation = poleElevation(snapshot, true);
  const southPoleElevation = poleElevation(snapshot, false);
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
      const elevation = sampleElevation(snapshot, u, v);
      const vegetationControl = snapshot.controls?.vegetationPotential;
      const vegetationAtPoint =
        vegetationControl === undefined
          ? undefined
          : sampleGrid(
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
          : sampleGrid(
              iceControl,
              snapshot.controls!.width,
              snapshot.controls!.height,
              u,
              v,
            ) / 255;
      const climateValue = snapshot.modernClimate === undefined
        ? undefined
        : sampleModernClimateValue(snapshot.modernClimate, longitude, latitude);
      const climateGroup = climateValue === undefined ? undefined : climateGroups[climateValue];
      let modernFrostCoverage: number | undefined;
      if (snapshot.modernClimate !== undefined) {
        const frostAt = (lon: number, lat: number) => sampleModernClimateMembership(
          snapshot.modernClimate!, climateGroups, lon, lat, "frost",
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
      const hasMappedLand = snapshot.controls !== undefined || snapshot.land.length > 0;
      const land =
        mature &&
        (snapshot.controls !== undefined
          ? elevation >= 0
          : snapshot.land.length > 0
            ? polygonContains(snapshot, [longitude, latitude])
            : n > 0.34 + oceanCoverage * 0.26);

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
          color = mixColor([37, 142, 146], [10, 48, 76], depth);
          reliefMetres = Math.max(-RELIEF_RANGE_METRES, elevation);
          roughnessValue = 205 + n * 25;
        } else {
          color = mixColor([3, 31, 58], [12, 104, 136], shallow * 0.8 + n * 0.12);
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
        const green = Math.max(
          0,
          (vegetationAtPoint ?? vegetation * (0.72 + n * 0.4)) - aridity - altitude * 0.33,
        );
        const lowland: [number, number, number] = [107, 119, 71];
        const forest: [number, number, number] = [35, 104, 62];
        const stone: [number, number, number] = [134, 122, 99];
        color = mixColor(mixColor(lowland, forest, green), stone, altitude * 0.82);
        color = mixColor(color, [177, 145, 89], aridity * (0.45 + n * 0.25));
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
        reliefMetres = Math.max(
          0,
          (hasMappedLand ? elevation : altitude * 4_200) + (small - 0.5) * 260,
        );
        roughnessValue = 184 + altitude * 50 + small * 18;
      }

      if (mature && land && snapshot.tectonics.length > 0) {
        for (const feature of snapshot.tectonics) {
          const distance = distanceToFeature([longitude, latitude], feature);
          const widthDegrees = Math.max(0.4, feature.widthKm / 111);
          if (distance > widthDegrees * 1.8) continue;
          const strength = (1 - distance / (widthDegrees * 1.8)) * (feature.activity ?? 0.75);
          if (feature.type === "rift") {
            reliefMetres -= Math.max(500, Math.abs(feature.heightKm) * 1_000) * strength;
            color = mixColor(color, [91, 64, 45], strength * 0.72);
          } else if (feature.type === "mountain" || feature.type === "subduction") {
            reliefMetres += Math.max(900, feature.heightKm * 1_000) * strength;
            color = mixColor(color, [142, 132, 114], strength * 0.58);
          } else {
            reliefMetres += Math.max(1_100, feature.heightKm * 1_000) * strength;
            color = mixColor(color, [93, 69, 58], strength * 0.62);
          }
        }
      }

      const raggedIceEdge = iceLatitude + (n - 0.5) * 13 - Math.max(0, elevation) / 1800;
      const climateIcePotential = modernClimateAllowsPermanentIce(climateGroup);
      const potentialIceAllowed = climateIcePotential ??
        (iceIntensity >= 0.9 || Math.abs(latitude) > raggedIceEdge);
      const ice = mature &&
        (modernFrostCoverage !== undefined
          ? land && modernFrostCoverage > 0.015
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
        reliefMetres += 180 * (iceAtPoint ?? iceIntensity);
      }

      const poleDistance = 90 - Math.abs(latitude);
      if (mature && poleDistance < 3 && snapshot.controls !== undefined) {
        const authoredPole = latitude >= 0 ? northPoleElevation : southPoleElevation;
        if (authoredPole !== undefined) {
          const poleRelief = seafloorActive ? authoredPole : Math.max(0, authoredPole);
          reliefMetres = mixNumber(
            poleRelief,
            reliefMetres,
            smoothstep(0, 3, poleDistance),
          );
        }
      }

      writePixel(albedo, offset, color);
      const encodedRelief =
        ((Math.max(
          reliefBiasMetres,
          Math.min(reliefBiasMetres + reliefRangeMetres, reliefMetres),
        ) -
          reliefBiasMetres) /
          reliefRangeMetres) *
        255;
      writePixel(relief, offset, [encodedRelief, encodedRelief, encodedRelief]);
      writePixel(roughness, offset, [roughnessValue, roughnessValue, roughnessValue]);

      const front = sphericalNoise(
        longitude + latitude * 0.34,
        latitude * 0.82,
        2.35,
        3,
      );
      const wisps = sphericalNoise(
        longitude - latitude * 0.58,
        latitude * 1.2,
        7.2,
        2,
      );
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
    reliefRangeMetres,
    reliefBiasMetres,
    roughness,
    clouds,
    rivers,
    generationMs: ended - started,
    byteLength:
      albedo.byteLength +
      relief.byteLength +
      roughness.byteLength +
      clouds.byteLength +
      rivers.length * 4 * Float64Array.BYTES_PER_ELEMENT,
  };
}

function mixNumber(a: number, b: number, amount: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, amount));
}
