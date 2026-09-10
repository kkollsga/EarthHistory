import { createNoise3D } from "simplex-noise";
import { surfaceRefinementAppliesToMode } from "../data";
import type { LonLat, ModernReliefPatch, WorldSnapshot } from "../data";
import type { SurfaceMode } from "./surface";

export interface RegionalPatchFields {
  center: LonLat;
  size: number;
  directions: Float32Array;
  heightsMetres: Float32Array;
  sourceHeightsMetres: Float32Array;
  /** Signed source height used only to shade bathymetry below surface water. */
  sourceMaterialHeightsMetres: Float32Array;
  sourceBlendWeights: Float32Array;
  syntheticDetailMetres: Float32Array;
  blendWeights: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  generationMs: number;
  byteLength: number;
  sourcePatchId?: string;
}

interface TectonicSegment {
  a: LonLat;
  b: LonLat;
  widthDegrees: number;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleElevation(snapshot: WorldSnapshot, longitude: number, latitude: number): number {
  const controls = snapshot.controls;
  if (controls === undefined) return 0;
  const normalizedLon = ((longitude + 180) % 360 + 360) % 360;
  const fx = (normalizedLon / 360) * controls.width;
  const fy = Math.max(
    0,
    Math.min(controls.height - 1, ((90 - latitude) / 180) * (controls.height - 1)),
  );
  const x0 = Math.floor(fx) % controls.width;
  const x1 = (x0 + 1) % controls.width;
  const y0 = Math.floor(fy);
  const y1 = Math.min(controls.height - 1, y0 + 1);
  const tx = fx - Math.floor(fx);
  const ty = fy - y0;
  const value = (x: number, y: number) => controls.elevation[y * controls.width + x] ?? 0;
  const north = value(x0, y0) * (1 - tx) + value(x1, y0) * tx;
  const south = value(x0, y1) * (1 - tx) + value(x1, y1) * tx;
  return north * (1 - ty) + south * ty;
}

function sampleModernRelief(
  patch: ModernReliefPatch | undefined,
  longitude: number,
  latitude: number,
): number | undefined {
  if (patch === undefined) return undefined;
  const [west, south, east, north] = patch.bounds;
  if (longitude < west || longitude > east || latitude < south || latitude > north) {
    return undefined;
  }
  const [westCenter, , , northCenter] = patch.cellCenterBounds;
  const fx = Math.max(0, Math.min(patch.width - 1, (longitude - westCenter) / patch.longitudeStep));
  const fy = Math.max(0, Math.min(patch.height - 1, (northCenter - latitude) / patch.latitudeStep));
  const x0 = Math.floor(fx);
  const x1 = Math.min(patch.width - 1, x0 + 1);
  const y0 = Math.floor(fy);
  const y1 = Math.min(patch.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => patch.elevation[y * patch.width + x] ?? 0;
  const northValue = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
  const southValue = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
  return northValue * (1 - ty) + southValue * ty;
}

function modernReliefFeatherWeight(
  patch: ModernReliefPatch | undefined,
  longitude: number,
  latitude: number,
): number {
  if (patch === undefined) return 0;
  const [west, south, east, north] = patch.bounds;
  const fixedLongitude = normalizeDeltaLongitude(longitude);
  const span = west <= east ? east - west : east + 360 - west;
  const fromWest = ((fixedLongitude - west) % 360 + 360) % 360;
  if (fromWest > span || latitude < south || latitude > north) return 0;
  const edgeDistanceCells = Math.min(
    fromWest / patch.longitudeStep,
    (span - fromWest) / patch.longitudeStep,
    (latitude - south) / patch.latitudeStep,
    (north - latitude) / patch.latitudeStep,
  );
  return smoothstep(0, Math.max(1, patch.edgeTransitionCells), edgeDistanceCells);
}

function sampleBlendedSourceElevation(
  snapshot: WorldSnapshot,
  patch: ModernReliefPatch | undefined,
  longitude: number,
  latitude: number,
): number {
  const base = sampleElevation(snapshot, longitude, latitude);
  const refined = sampleModernRelief(patch, longitude, latitude);
  if (refined === undefined) return base;
  const weight = modernReliefFeatherWeight(patch, longitude, latitude);
  return base + (refined - base) * weight;
}

function sampleByteControl(
  field: Uint8Array | undefined,
  snapshot: WorldSnapshot,
  longitude: number,
  latitude: number,
): number {
  const controls = snapshot.controls;
  if (controls === undefined || field === undefined) return 0;
  const normalizedLon = ((longitude + 180) % 360 + 360) % 360;
  const fx = (normalizedLon / 360) * controls.width;
  const fy = Math.max(
    0,
    Math.min(controls.height - 1, ((90 - latitude) / 180) * (controls.height - 1)),
  );
  const x0 = Math.floor(fx) % controls.width;
  const x1 = (x0 + 1) % controls.width;
  const y0 = Math.floor(fy);
  const y1 = Math.min(controls.height - 1, y0 + 1);
  const tx = fx - Math.floor(fx);
  const ty = fy - y0;
  const at = (x: number, y: number) => (field[y * controls.width + x] ?? 0) / 255;
  return (
    (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) +
    (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty
  );
}

function normalizeDeltaLongitude(value: number): number {
  return ((value + 540) % 360) - 180;
}

function tectonicSegments(snapshot: WorldSnapshot): TectonicSegment[] {
  const all: TectonicSegment[] = [];
  for (const feature of snapshot.tectonics) {
    for (let index = 1; index < feature.coordinates.length; index++) {
      all.push({
        a: feature.coordinates[index - 1],
        b: feature.coordinates[index],
        widthDegrees: Math.max(0.45, Math.min(3.2, feature.widthKm / 111)),
      });
    }
  }
  if (all.length <= 512) return all;
  const step = all.length / 512;
  return Array.from({ length: 512 }, (_, index) => all[Math.floor(index * step)]);
}

function nearestTectonic(
  point: LonLat,
  segments: TectonicSegment[],
): { influence: number; across: number } {
  const longitudeScale = Math.max(0.2, Math.cos((point[1] * Math.PI) / 180));
  let minimum = Number.POSITIVE_INFINITY;
  let closestAcross = 0;
  let closestWidth = 1;
  for (const segment of segments) {
    const ax = normalizeDeltaLongitude(segment.a[0] - point[0]) * longitudeScale;
    const ay = segment.a[1] - point[1];
    const bx = normalizeDeltaLongitude(segment.b[0] - point[0]) * longitudeScale;
    const by = segment.b[1] - point[1];
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length < 1e-5) continue;
    const projection = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (length * length)));
    const px = ax + dx * projection;
    const py = ay + dy * projection;
    const distance = Math.hypot(px, py);
    if (distance < minimum) {
      minimum = distance;
      closestAcross = (px * -dy + py * dx) / length;
      closestWidth = segment.widthDegrees;
    }
  }
  return {
    influence: 1 - smoothstep(closestWidth * 0.35, closestWidth * 2.4, minimum),
    across: closestAcross,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function directionFor(longitude: number, latitude: number): [number, number, number] {
  const lon = (longitude * Math.PI) / 180;
  const lat = (latitude * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), Math.sin(lat), -cosLat * Math.sin(lon)];
}

function polarStablePoint(
  center: LonLat,
  eastOffset: number,
  northOffset: number,
): { longitude: number; latitude: number; direction: [number, number, number] } {
  const centerLon = (center[0] * Math.PI) / 180;
  const centerLat = (center[1] * Math.PI) / 180;
  const centerDirection = directionFor(center[0], center[1]);
  const east: [number, number, number] = [
    -Math.sin(centerLon),
    0,
    -Math.cos(centerLon),
  ];
  const north: [number, number, number] = [
    -Math.sin(centerLat) * Math.cos(centerLon),
    Math.cos(centerLat),
    Math.sin(centerLat) * Math.sin(centerLon),
  ];
  const eastTangent = Math.tan((eastOffset * Math.PI) / 180);
  const northTangent = Math.tan((northOffset * Math.PI) / 180);
  const raw: [number, number, number] = [
    centerDirection[0] + east[0] * eastTangent + north[0] * northTangent,
    centerDirection[1] + east[1] * eastTangent + north[1] * northTangent,
    centerDirection[2] + east[2] * eastTangent + north[2] * northTangent,
  ];
  const length = Math.hypot(raw[0], raw[1], raw[2]);
  const direction: [number, number, number] = [raw[0] / length, raw[1] / length, raw[2] / length];
  return {
    longitude: normalizeDeltaLongitude((Math.atan2(-direction[2], direction[0]) * 180) / Math.PI),
    latitude: (Math.asin(Math.max(-1, Math.min(1, direction[1]))) * 180) / Math.PI,
    direction,
  };
}

export function generateRegionalPatch(
  snapshot: WorldSnapshot,
  center: LonLat,
  mode: SurfaceMode,
  size = 128,
  angularSizeDegrees = 24,
  sourcePatch?: ModernReliefPatch,
): RegionalPatchFields {
  const started = typeof performance === "undefined" ? Date.now() : performance.now();
  const vertexCount = size * size;
  const directions = new Float32Array(vertexCount * 3);
  const heightsMetres = new Float32Array(vertexCount);
  const sourceHeightsMetres = new Float32Array(vertexCount);
  const sourceMaterialHeightsMetres = new Float32Array(vertexCount);
  const sourceBlendWeights = new Float32Array(vertexCount);
  const uvs = new Float32Array(vertexCount * 2);
  const detail = new Float32Array(vertexCount);
  const weights = new Float32Array(vertexCount);
  const noise3d = createNoise3D(seededRandom(hashString(snapshot.id)));
  const centerCos = Math.max(0.28, Math.cos((center[1] * Math.PI) / 180));
  const useTangentPatch = Math.abs(center[1]) > 58;
  const segments = tectonicSegments(snapshot);
  const applicableSourcePatch = sourcePatch !== undefined &&
      surfaceRefinementAppliesToMode(sourcePatch, mode)
    ? sourcePatch
    : undefined;
  let weightedDetail = 0;
  let weightSum = 0;

  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    const northOffset = (0.5 - v) * angularSizeDegrees;
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      const eastOffset = (u - 0.5) * angularSizeDegrees;
      const point = useTangentPatch
        ? polarStablePoint(center, eastOffset, northOffset)
        : undefined;
      const latitude = point?.latitude ??
        Math.max(-89.8, Math.min(89.8, center[1] + northOffset));
      const longitude = point?.longitude ?? center[0] + eastOffset / centerCos;
      const index = y * size + x;
      const direction = point?.direction ?? directionFor(longitude, latitude);
      directions[index * 3] = direction[0];
      directions[index * 3 + 1] = direction[1];
      directions[index * 3 + 2] = direction[2];
      uvs[index * 2] = (((longitude + 180) / 360) % 1 + 1) % 1;
      uvs[index * 2 + 1] = (latitude + 90) / 180;

      const modernElevation = sampleModernRelief(applicableSourcePatch, longitude, latitude);
      const sourceElevation = modernElevation ?? sampleElevation(snapshot, longitude, latitude);
      const baseElevation = mode === "seafloor" ? sourceElevation : Math.max(0, sourceElevation);
      heightsMetres[index] = baseElevation;
      sourceHeightsMetres[index] = baseElevation;
      sourceMaterialHeightsMetres[index] = mode === "surface" && modernElevation !== undefined
        ? sourceElevation
        : baseElevation;

      const gradientStep = applicableSourcePatch === undefined ? 1 : 0.16;
      const sourceAt = (sampleLon: number, sampleLat: number) =>
        sampleBlendedSourceElevation(snapshot, applicableSourcePatch, sampleLon, sampleLat);
      const eastGradient =
        sourceAt(longitude + gradientStep, latitude) -
        sourceAt(longitude - gradientStep, latitude);
      const northGradient =
        sourceAt(longitude, latitude + gradientStep) -
        sourceAt(longitude, latitude - gradientStep);
      const gradientMagnitude = Math.hypot(eastGradient, northGradient);
      const slopeWeight = smoothstep(120, 1_800, gradientMagnitude);
      const coastWeight =
        mode === "seafloor"
          ? smoothstep(80, 700, Math.abs(sourceElevation))
          : smoothstep(0, 650, sourceElevation);
      const edgeDistance = Math.min(u, 1 - u, v, 1 - v);
      const edgeWeight = smoothstep(0, 0.12, edgeDistance);
      sourceBlendWeights[index] = modernElevation === undefined
        ? 0
        : edgeWeight * modernReliefFeatherWeight(applicableSourcePatch, longitude, latitude);
      const icePotential = sampleByteControl(
        snapshot.controls?.potentialIce,
        snapshot,
        longitude,
        latitude,
      );
      const normalizedIce = icePotential /
        Math.max(0.04, snapshot.environment.iceIntensity ?? 1);
      const iceSmoothing = 1 - smoothstep(0.05, 0.55, normalizedIce) * 0.82;
      const weight = coastWeight * edgeWeight * iceSmoothing;

      const [px, py, pz] = direction;
      const broadFrequency = applicableSourcePatch === undefined ? 43 : 145;
      const fineFrequency = applicableSourcePatch === undefined ? 91 : 310;
      const broad = noise3d(px * broadFrequency, py * broadFrequency, pz * broadFrequency);
      const fine = noise3d(px * fineFrequency + 17, py * fineFrequency - 9, pz * fineFrequency + 4);
      const gradientLength = Math.max(1, gradientMagnitude);
      const fixedLongitude = normalizeDeltaLongitude(longitude);
      const fixedEast = fixedLongitude * Math.cos((latitude * Math.PI) / 180);
      const fixedAcrossSlope =
        (fixedEast * eastGradient + latitude * northGradient) / gradientLength;
      const tectonic = nearestTectonic([longitude, latitude], segments);
      const stablePhase =
        fixedAcrossSlope * 1.7 * (1 - tectonic.influence) +
        tectonic.across * 4.1 * tectonic.influence;
      const alignedRidge = 1 - Math.abs(Math.sin(stablePhase + broad * 1.4));
      const ridged = (alignedRidge * 0.58 + (1 - Math.abs(broad)) * 0.3 + fine * 0.12) * 2 - 1;
      const amplitude = applicableSourcePatch === undefined
        ? 42 + slopeWeight * 163 + tectonic.influence * 45
        : 14 + slopeWeight * 38 + tectonic.influence * 13;
      detail[index] = ridged * amplitude;
      weights[index] = weight;
      weightedDetail += detail[index] * weight;
      weightSum += weight;
    }
  }

  const mean = weightSum > 0 ? weightedDetail / weightSum : 0;
  const syntheticDetailMetres = new Float32Array(vertexCount);
  for (let index = 0; index < vertexCount; index++) {
    const synthetic = Math.max(-250, Math.min(250, detail[index] - mean));
    syntheticDetailMetres[index] = synthetic * weights[index];
    heightsMetres[index] += syntheticDetailMetres[index];
  }

  const quadCount = (size - 1) * (size - 1);
  const indices = new Uint32Array(quadCount * 6);
  let offset = 0;
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const a = y * size + x;
      const b = a + 1;
      const c = a + size;
      const d = c + 1;
      indices[offset++] = a;
      indices[offset++] = c;
      indices[offset++] = b;
      indices[offset++] = b;
      indices[offset++] = c;
      indices[offset++] = d;
    }
  }

  const ended = typeof performance === "undefined" ? Date.now() : performance.now();
  return {
    center,
    size,
    directions,
    heightsMetres,
    sourceHeightsMetres,
    sourceMaterialHeightsMetres,
    sourceBlendWeights,
    syntheticDetailMetres,
    blendWeights: weights,
    uvs,
    indices,
    generationMs: ended - started,
    sourcePatchId: applicableSourcePatch?.id,
    byteLength:
      directions.byteLength +
      heightsMetres.byteLength +
      sourceHeightsMetres.byteLength +
      sourceMaterialHeightsMetres.byteLength +
      sourceBlendWeights.byteLength +
      syntheticDetailMetres.byteLength +
      weights.byteLength +
      uvs.byteLength +
      indices.byteLength,
  };
}
