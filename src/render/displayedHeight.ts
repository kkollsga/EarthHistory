import type { LonLat } from "../data";
import {
  EARTH_RADIUS_METRES,
  type SurfaceFields,
} from "./surface";

export type UnitDirection = readonly [x: number, y: number, z: number];

export interface DisplayedHeightSampler {
  sampleHeightMetres(direction: UnitDirection): number;
}

export function createSurfaceFieldHeightSampler(
  fields: SurfaceFields,
): DisplayedHeightSampler {
  const sampleEncodedRelief = (u: number, v: number): number => {
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
    const at = (x: number, y: number) =>
      fields.relief[(y * fields.width + x) * 4] / 255 * fields.reliefRangeMetres +
        fields.reliefBiasMetres;
    const north = at(x0, y0) * (1 - tx) + at(x1, y0) * tx;
    const south = at(x0, y1) * (1 - tx) + at(x1, y1) * tx;
    return north * (1 - ty) + south * ty;
  };
  return {
    sampleHeightMetres(direction) {
      const length = Math.hypot(direction[0], direction[1], direction[2]);
      if (!(length > 0) || !Number.isFinite(length)) return 0;
      const x = direction[0] / length;
      const y = Math.max(-1, Math.min(1, direction[1] / length));
      const z = direction[2] / length;
      const longitude = Math.atan2(-z, x);
      const latitude = Math.asin(y);
      return sampleEncodedRelief(
        (longitude + Math.PI) / (Math.PI * 2),
        (latitude + Math.PI / 2) / Math.PI,
      );
    },
  };
}

export interface DrapedLineData {
  readonly directions: Float32Array;
  readonly heightsMetres: Float32Array;
  readonly positions: Float32Array;
  readonly clearanceMetres: number;
  readonly byteLength: number;
}

export interface DensifyOptions {
  maxAngularStepDegrees?: number;
  maxVertices?: number;
}

export const DEFAULT_OVERLAY_STEP_DEGREES = 0.75;
export const MAX_DRAPED_LINE_VERTICES = 65_536;
export const MAX_OVERLAY_CACHE_BYTES = 16 * 1024 * 1024;

const DEG_TO_RAD = Math.PI / 180;

function directionAt([longitude, latitude]: LonLat): [number, number, number] {
  const lon = longitude * DEG_TO_RAD;
  const lat = latitude * DEG_TO_RAD;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), Math.sin(lat), -cosLat * Math.sin(lon)];
}

function isPoleSeamAnchor([longitude, latitude]: LonLat): boolean {
  return Math.abs(latitude) >= 89.999 && Math.abs(longitude) >= 179.999;
}

function splitAtPoleSeamAnchors(coordinates: readonly LonLat[]): LonLat[][] {
  const runs: LonLat[][] = [];
  let current: LonLat[] = [];
  for (const coordinate of coordinates) {
    if (isPoleSeamAnchor(coordinate)) {
      if (current.length > 1) runs.push(current);
      current = [];
      continue;
    }
    current.push(coordinate);
  }
  if (current.length > 1) runs.push(current);
  return runs;
}

function slerp(
  from: UnitDirection,
  to: UnitDirection,
  fraction: number,
  angle: number,
): [number, number, number] {
  const sine = Math.sin(angle);
  if (Math.abs(sine) > 1e-8) {
    const left = Math.sin((1 - fraction) * angle) / sine;
    const right = Math.sin(fraction * angle) / sine;
    return [
      from[0] * left + to[0] * right,
      from[1] * left + to[1] * right,
      from[2] * left + to[2] * right,
    ];
  }

  // Coincident points need no interpolation. For the unlikely antipodal case,
  // choose a stable great-circle axis rather than producing a zero vector.
  if (from[0] * to[0] + from[1] * to[1] + from[2] * to[2] > 0) return [...from];
  const reference: UnitDirection = Math.abs(from[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tx = from[1] * reference[2] - from[2] * reference[1];
  const ty = from[2] * reference[0] - from[0] * reference[2];
  const tz = from[0] * reference[1] - from[1] * reference[0];
  const inverse = 1 / Math.hypot(tx, ty, tz);
  const tangent = [tx * inverse, ty * inverse, tz * inverse] as const;
  const phase = Math.PI * fraction;
  return [
    from[0] * Math.cos(phase) + tangent[0] * Math.sin(phase),
    from[1] * Math.cos(phase) + tangent[1] * Math.sin(phase),
    from[2] * Math.cos(phase) + tangent[2] * Math.sin(phase),
  ];
}

function densifyGeodesicRun(
  coordinates: readonly LonLat[],
  options: DensifyOptions = {},
): Float32Array {
  if (coordinates.length === 0) return new Float32Array();
  const maxStepDegrees = options.maxAngularStepDegrees ?? DEFAULT_OVERLAY_STEP_DEGREES;
  const maxVertices = options.maxVertices ?? MAX_DRAPED_LINE_VERTICES;
  if (!Number.isFinite(maxStepDegrees) || maxStepDegrees <= 0 || maxStepDegrees > 180) {
    throw new RangeError("Geodesic step must be in (0, 180] degrees");
  }
  if (!Number.isInteger(maxVertices) || maxVertices < 2) {
    throw new RangeError("Geodesic vertex limit must be an integer of at least two");
  }

  const output: number[] = [];
  let previous = directionAt(coordinates[0]);
  output.push(...previous);
  const maxStep = maxStepDegrees * DEG_TO_RAD;
  for (let index = 1; index < coordinates.length; index += 1) {
    const next = directionAt(coordinates[index]);
    const dot = Math.max(-1, Math.min(1,
      previous[0] * next[0] + previous[1] * next[1] + previous[2] * next[2],
    ));
    const angle = Math.acos(dot);
    if (angle <= 1e-10) {
      previous = next;
      continue;
    }
    const steps = Math.max(1, Math.ceil(angle / maxStep));
    if (output.length / 3 + steps > maxVertices) {
      throw new RangeError(`Densified line exceeds ${maxVertices} vertices`);
    }
    for (let step = 1; step <= steps; step += 1) {
      output.push(...slerp(previous, next, step / steps, angle));
    }
    previous = next;
  }
  return new Float32Array(output);
}

export function densifyGeodesicDirectionSegments(
  coordinates: readonly LonLat[],
  options: DensifyOptions = {},
): Float32Array[] {
  return splitAtPoleSeamAnchors(coordinates).map((run) =>
    densifyGeodesicRun(run, options)
  );
}

export function densifyGeodesicDirections(
  coordinates: readonly LonLat[],
  options: DensifyOptions = {},
): Float32Array {
  const segments = densifyGeodesicDirectionSegments(coordinates, options);
  if (segments.length > 1) {
    throw new RangeError("Geographic line contains multiple runs; use segmented densification");
  }
  return segments[0] ?? new Float32Array();
}

function createDrapedLineDataFromDirections(
  directions: Float32Array,
  sampler: DisplayedHeightSampler,
  clearanceMetres: number,
): DrapedLineData {
  const vertexCount = directions.length / 3;
  const heightsMetres = new Float32Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 3;
    heightsMetres[index] = sampler.sampleHeightMetres([
      directions[offset], directions[offset + 1], directions[offset + 2],
    ]);
  }
  const positions = new Float32Array(directions.length);
  return {
    directions,
    heightsMetres,
    positions,
    clearanceMetres,
    byteLength: directions.byteLength + heightsMetres.byteLength + positions.byteLength,
  };
}

export function createDrapedLineDataSegments(
  coordinates: readonly LonLat[],
  sampler: DisplayedHeightSampler,
  clearanceMetres: number,
  options?: DensifyOptions,
): DrapedLineData[] {
  if (!Number.isFinite(clearanceMetres) || clearanceMetres < 0) {
    throw new RangeError("Overlay clearance must be a non-negative finite number");
  }
  return densifyGeodesicDirectionSegments(coordinates, options).map((directions) =>
    createDrapedLineDataFromDirections(directions, sampler, clearanceMetres)
  );
}

export function createDrapedLineData(
  coordinates: readonly LonLat[],
  sampler: DisplayedHeightSampler,
  clearanceMetres: number,
  options?: DensifyOptions,
): DrapedLineData {
  const segments = createDrapedLineDataSegments(
    coordinates,
    sampler,
    clearanceMetres,
    options,
  );
  if (segments.length > 1) {
    throw new RangeError("Geographic line contains multiple runs; use segmented draping");
  }
  return segments[0] ?? createDrapedLineDataFromDirections(
    new Float32Array(),
    sampler,
    clearanceMetres,
  );
}

export function updateDrapedLinePositions(
  data: DrapedLineData,
  verticalExaggeration: number,
): Float32Array {
  const exaggeration = Math.max(1, Math.min(30,
    Number.isFinite(verticalExaggeration) ? verticalExaggeration : 1,
  ));
  for (let index = 0; index < data.heightsMetres.length; index += 1) {
    const offset = index * 3;
    const radius = 1 +
      (data.heightsMetres[index] * exaggeration + data.clearanceMetres) /
        EARTH_RADIUS_METRES;
    data.positions[offset] = data.directions[offset] * radius;
    data.positions[offset + 1] = data.directions[offset + 1] * radius;
    data.positions[offset + 2] = data.directions[offset + 2] * radius;
  }
  return data.positions;
}
