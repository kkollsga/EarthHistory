import type { CountryOutline, LonLat } from "../data";
import {
  densifyGeodesicDirectionSegments,
  type DisplayedHeightSampler,
  type UnitDirection,
} from "./displayedHeight";
import { EARTH_RADIUS_METRES } from "./surface";

export const COUNTRY_RIBBON_CLEARANCE_METRES = 250;
export const MAX_COUNTRY_RIBBON_BYTES = 8 * 1024 * 1024;
export const MAX_COUNTRY_RIBBON_VERTICES = 160_000;

export type CountryRibbonKind = "groove" | "rim";

export interface CountryRibbonBatchData {
  readonly kind: CountryRibbonKind;
  readonly directions: Float32Array;
  readonly heightsMetres: Float32Array;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly clearanceMetres: number;
  readonly centerVertexCount: number;
  readonly runCount: number;
  readonly byteLength: number;
}

export interface CountryRibbonOptions {
  maxAngularStepDegrees?: number;
  maxHeightErrorMetres?: number;
  maxAdaptiveDepth?: number;
  grooveHalfWidthMetres?: number;
  minimumRunLengthMetres?: number;
  clearanceMetres?: number;
  verticalExaggeration?: number;
  maxRenderedVertices?: number;
  maxBytes?: number;
  includeRim?: boolean;
}

interface RefinedRun {
  directions: number[];
  centerVertexCount: number;
}

interface ResolvedOptions {
  maxAngularStepDegrees: number;
  maxHeightErrorMetres: number;
  maxAdaptiveDepth: number;
  grooveHalfWidthMetres: number;
  minimumRunLengthMetres: number;
  clearanceMetres: number;
  verticalExaggeration: number;
  maxRenderedVertices: number;
  maxBytes: number;
  includeRim: boolean;
  renderedVerticesPerCenter: number;
}

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
  return value;
}

function resolveOptions(options: CountryRibbonOptions): ResolvedOptions {
  const maxAdaptiveDepth = options.maxAdaptiveDepth ?? 2;
  const maxRenderedVertices = options.maxRenderedVertices ?? MAX_COUNTRY_RIBBON_VERTICES;
  const clearanceMetres = finitePositive(
    options.clearanceMetres ?? COUNTRY_RIBBON_CLEARANCE_METRES,
    "Country ribbon clearance",
  );
  const verticalExaggeration = Math.max(1, Math.min(
    30,
    Number.isFinite(options.verticalExaggeration) ? options.verticalExaggeration! : 1,
  ));
  if (!Number.isInteger(maxAdaptiveDepth) || maxAdaptiveDepth < 0 || maxAdaptiveDepth > 8) {
    throw new RangeError("Country ribbon adaptive depth must be an integer in [0, 8]");
  }
  if (!Number.isInteger(maxRenderedVertices) || maxRenderedVertices < 8) {
    throw new RangeError("Country ribbon vertex budget must be an integer of at least eight");
  }
  return {
    maxAngularStepDegrees: finitePositive(
      options.maxAngularStepDegrees ?? 0.5,
      "Country ribbon angular step",
    ),
    maxHeightErrorMetres: Math.min(
      finitePositive(options.maxHeightErrorMetres ?? 180, "Country ribbon height error"),
      clearanceMetres / verticalExaggeration * 0.5,
    ),
    maxAdaptiveDepth,
    grooveHalfWidthMetres: finitePositive(
      options.grooveHalfWidthMetres ?? 12_000,
      "Country ribbon half width",
    ),
    minimumRunLengthMetres: finiteNonNegative(
      options.minimumRunLengthMetres ?? 0,
      "Country ribbon minimum run length",
    ),
    clearanceMetres,
    verticalExaggeration,
    maxRenderedVertices,
    maxBytes: finitePositive(
      options.maxBytes ?? MAX_COUNTRY_RIBBON_BYTES,
      "Country ribbon byte budget",
    ),
    includeRim: options.includeRim ?? true,
    renderedVerticesPerCenter: (options.includeRim ?? true) ? 4 : 2,
  };
}

function directionAt(values: Float32Array | number[], index: number): [number, number, number] {
  const offset = index * 3;
  return [values[offset], values[offset + 1], values[offset + 2]];
}

function midpointDirection(
  from: UnitDirection,
  to: UnitDirection,
): [number, number, number] {
  let x = from[0] + to[0];
  let y = from[1] + to[1];
  let z = from[2] + to[2];
  let length = Math.hypot(x, y, z);
  if (length < 1e-8) {
    const reference: UnitDirection = Math.abs(from[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    x = from[1] * reference[2] - from[2] * reference[1];
    y = from[2] * reference[0] - from[0] * reference[2];
    z = from[0] * reference[1] - from[1] * reference[0];
    length = Math.hypot(x, y, z);
  }
  return [x / length, y / length, z / length];
}

function runLengthMetres(values: Float32Array): number {
  let lengthRadians = 0;
  for (let index = 1; index < values.length / 3; index += 1) {
    const previous = directionAt(values, index - 1);
    const current = directionAt(values, index);
    lengthRadians += Math.acos(Math.max(-1, Math.min(1,
      previous[0] * current[0] + previous[1] * current[1] + previous[2] * current[2],
    )));
  }
  return lengthRadians * EARTH_RADIUS_METRES;
}

export function countryLineLengthMetres(coordinates: readonly LonLat[]): number {
  let lengthRadians = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const [fromLongitude, fromLatitude] = coordinates[index - 1]!;
    const [toLongitude, toLatitude] = coordinates[index]!;
    const fromLon = fromLongitude * Math.PI / 180;
    const fromLat = fromLatitude * Math.PI / 180;
    const toLon = toLongitude * Math.PI / 180;
    const toLat = toLatitude * Math.PI / 180;
    const cosine = Math.sin(fromLat) * Math.sin(toLat) +
      Math.cos(fromLat) * Math.cos(toLat) * Math.cos(toLon - fromLon);
    lengthRadians += Math.acos(Math.max(-1, Math.min(1, cosine)));
  }
  return lengthRadians * EARTH_RADIUS_METRES;
}

function appendRefinedSpan(
  from: UnitDirection,
  fromHeight: number,
  to: UnitDirection,
  toHeight: number,
  depth: number,
  output: number[],
  sampler: DisplayedHeightSampler,
  options: ResolvedOptions,
  renderedVertexCount: { value: number },
): void {
  const midpoint = midpointDirection(from, to);
  const midpointHeight = sampler.sampleHeightMetres(midpoint);
  if (
    depth < options.maxAdaptiveDepth &&
    Math.abs(midpointHeight - (fromHeight + toHeight) * 0.5) > options.maxHeightErrorMetres
  ) {
    appendRefinedSpan(
      from,
      fromHeight,
      midpoint,
      midpointHeight,
      depth + 1,
      output,
      sampler,
      options,
      renderedVertexCount,
    );
    appendRefinedSpan(
      midpoint,
      midpointHeight,
      to,
      toHeight,
      depth + 1,
      output,
      sampler,
      options,
      renderedVertexCount,
    );
    return;
  }
  if (
    renderedVertexCount.value + options.renderedVerticesPerCenter >
      options.maxRenderedVertices
  ) {
    throw new RangeError(
      `Country ribbon exceeds ${options.maxRenderedVertices} vertex budget`,
    );
  }
  output.push(to[0], to[1], to[2]);
  renderedVertexCount.value += options.renderedVerticesPerCenter;
}

function refineRuns(
  countries: readonly Pick<CountryOutline, "lines">[],
  sampler: DisplayedHeightSampler,
  options: ResolvedOptions,
): RefinedRun[] {
  const runs: RefinedRun[] = [];
  const renderedVertexCount = { value: 0 };
  for (const country of countries) {
    for (const coordinates of country.lines) {
      const baseRuns = densifyGeodesicDirectionSegments(coordinates, {
        maxAngularStepDegrees: options.maxAngularStepDegrees,
      });
      for (const base of baseRuns) {
        const baseCount = base.length / 3;
        if (baseCount < 2 || runLengthMetres(base) < options.minimumRunLengthMetres) continue;
        if (
          renderedVertexCount.value + options.renderedVerticesPerCenter >
            options.maxRenderedVertices
        ) {
          throw new RangeError(
            `Country ribbon exceeds ${options.maxRenderedVertices} vertex budget`,
          );
        }
        const directions = [...directionAt(base, 0)];
        renderedVertexCount.value += options.renderedVerticesPerCenter;
        let from = directionAt(base, 0);
        let fromHeight = sampler.sampleHeightMetres(from);
        for (let index = 1; index < baseCount; index += 1) {
          const to = directionAt(base, index);
          const toHeight = sampler.sampleHeightMetres(to);
          appendRefinedSpan(
            from,
            fromHeight,
            to,
            toHeight,
            0,
            directions,
            sampler,
            options,
            renderedVertexCount,
          );
          from = to;
          fromHeight = toHeight;
        }
        runs.push({ directions, centerVertexCount: directions.length / 3 });
      }
    }
  }
  return runs;
}

function tangentSide(run: RefinedRun, index: number): [number, number, number] {
  const center = directionAt(run.directions, index);
  const previous = directionAt(run.directions, Math.max(0, index - 1));
  const next = directionAt(
    run.directions,
    Math.min(run.centerVertexCount - 1, index + 1),
  );
  let tx = next[0] - previous[0];
  let ty = next[1] - previous[1];
  let tz = next[2] - previous[2];
  const radial = tx * center[0] + ty * center[1] + tz * center[2];
  tx -= center[0] * radial;
  ty -= center[1] * radial;
  tz -= center[2] * radial;
  let tangentLength = Math.hypot(tx, ty, tz);
  if (tangentLength < 1e-8) {
    const reference: UnitDirection = Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    tx = reference[1] * center[2] - reference[2] * center[1];
    ty = reference[2] * center[0] - reference[0] * center[2];
    tz = reference[0] * center[1] - reference[1] * center[0];
    tangentLength = Math.hypot(tx, ty, tz);
  }
  tx /= tangentLength;
  ty /= tangentLength;
  tz /= tangentLength;
  const sx = center[1] * tz - center[2] * ty;
  const sy = center[2] * tx - center[0] * tz;
  const sz = center[0] * ty - center[1] * tx;
  const sideLength = Math.hypot(sx, sy, sz);
  return [sx / sideLength, sy / sideLength, sz / sideLength];
}

function offsetDirection(
  center: UnitDirection,
  side: UnitDirection,
  offsetMetres: number,
): [number, number, number] {
  const angle = offsetMetres / EARTH_RADIUS_METRES;
  const radial = Math.cos(angle);
  const lateral = Math.sin(angle);
  return [
    center[0] * radial + side[0] * lateral,
    center[1] * radial + side[1] * lateral,
    center[2] * radial + side[2] * lateral,
  ];
}

function buildBatch(
  kind: CountryRibbonKind,
  runs: readonly RefinedRun[],
  sampler: DisplayedHeightSampler,
  options: ResolvedOptions,
  lowerOffsetMetres: number,
  upperOffsetMetres: number,
): CountryRibbonBatchData {
  const centerVertexCount = runs.reduce((sum, run) => sum + run.centerVertexCount, 0);
  const vertexCount = centerVertexCount * 2;
  const quadCount = centerVertexCount - runs.length;
  const directions = new Float32Array(vertexCount * 3);
  const heightsMetres = new Float32Array(vertexCount);
  const positions = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(quadCount * 6);
  let vertex = 0;
  let triangleIndex = 0;

  for (const run of runs) {
    const runBaseVertex = vertex;
    for (let index = 0; index < run.centerVertexCount; index += 1) {
      const center = directionAt(run.directions, index);
      const side = tangentSide(run, index);
      for (const lateralOffset of [lowerOffsetMetres, upperOffsetMetres]) {
        const direction = offsetDirection(center, side, lateralOffset);
        const positionOffset = vertex * 3;
        directions[positionOffset] = direction[0];
        directions[positionOffset + 1] = direction[1];
        directions[positionOffset + 2] = direction[2];
        heightsMetres[vertex] = sampler.sampleHeightMetres(direction);
        vertex += 1;
      }
    }
    for (let index = 0; index < run.centerVertexCount - 1; index += 1) {
      const lower = runBaseVertex + index * 2;
      const upper = lower + 1;
      const nextLower = lower + 2;
      const nextUpper = lower + 3;
      indices[triangleIndex++] = lower;
      indices[triangleIndex++] = nextLower;
      indices[triangleIndex++] = upper;
      indices[triangleIndex++] = upper;
      indices[triangleIndex++] = nextLower;
      indices[triangleIndex++] = nextUpper;
    }
  }

  const batch: CountryRibbonBatchData = {
    kind,
    directions,
    heightsMetres,
    positions,
    indices,
    clearanceMetres: options.clearanceMetres,
    centerVertexCount,
    runCount: runs.length,
    byteLength:
      directions.byteLength + heightsMetres.byteLength + positions.byteLength + indices.byteLength,
  };
  updateCountryRibbonPositions(batch, options.verticalExaggeration);
  return batch;
}

export function createCountryRibbonBatches(
  countries: readonly Pick<CountryOutline, "lines">[],
  sampler: DisplayedHeightSampler,
  options: CountryRibbonOptions = {},
): CountryRibbonBatchData[] {
  if (countries.length === 0) return [];
  const resolved = resolveOptions(options);
  const runs = refineRuns(countries, sampler, resolved);
  if (runs.length === 0) return [];
  const halfWidth = resolved.grooveHalfWidthMetres;
  const batches = [buildBatch("groove", runs, sampler, resolved, -halfWidth, halfWidth)];
  if (resolved.includeRim) {
    batches.push(
      buildBatch("rim", runs, sampler, resolved, halfWidth * 0.18, halfWidth * 0.82),
    );
  }
  const bytes = batches.reduce((sum, batch) => sum + batch.byteLength, 0);
  if (bytes > resolved.maxBytes) {
    throw new RangeError(`Country ribbon exceeds ${resolved.maxBytes} byte budget`);
  }
  return batches;
}

export function updateCountryRibbonPositions(
  batch: CountryRibbonBatchData,
  verticalExaggeration: number,
): Float32Array {
  const exaggeration = Math.max(1, Math.min(
    30,
    Number.isFinite(verticalExaggeration) ? verticalExaggeration : 1,
  ));
  for (let index = 0; index < batch.heightsMetres.length; index += 1) {
    const offset = index * 3;
    const radius = 1 + (
      batch.heightsMetres[index] * exaggeration + batch.clearanceMetres
    ) / EARTH_RADIUS_METRES;
    batch.positions[offset] = batch.directions[offset] * radius;
    batch.positions[offset + 1] = batch.directions[offset + 1] * radius;
    batch.positions[offset + 2] = batch.directions[offset + 2] * radius;
  }
  return batch.positions;
}

export function resampleCountryRibbonHeights(
  batch: CountryRibbonBatchData,
  sampler: DisplayedHeightSampler,
  verticalExaggeration: number,
): Float32Array {
  for (let index = 0; index < batch.heightsMetres.length; index += 1) {
    const offset = index * 3;
    batch.heightsMetres[index] = sampler.sampleHeightMetres([
      batch.directions[offset],
      batch.directions[offset + 1],
      batch.directions[offset + 2],
    ]);
  }
  return updateCountryRibbonPositions(batch, verticalExaggeration);
}
