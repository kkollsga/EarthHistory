import type { LonLat } from "../data";
import {
  createCountryRibbonBatches,
  type CountryRibbonBatchData,
} from "./countryRibbons";
import type { DisplayedHeightSampler } from "./displayedHeight";
import { EARTH_RADIUS_METRES, type SurfaceDetail } from "./surface";

export const REFERENCE_GUIDE_MAX_BYTES = 2 * 1024 * 1024;
export const REFERENCE_GUIDE_MAX_VERTICES = 48_000;
export const REFERENCE_GUIDE_LABEL_TEXTURE_BYTES = 384 * 64 * 4;
export const REFERENCE_GUIDE_POLE_TEXTURE_BYTES = 96 * 96 * 4;
const REFERENCE_GUIDE_LABEL_CLEARANCE_METRES = 320;
const LABEL_COLUMNS = 48;
const LABEL_ROWS = 6;

export interface ReferenceGuideLabel {
  text: string;
  coordinates: LonLat;
}

export interface ReferenceGuideLabelPatchData {
  readonly directions: Float32Array;
  readonly heightsMetres: Float32Array;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly indices: Uint16Array;
  readonly clearanceMetres: number;
  readonly byteLength: number;
}

export const REFERENCE_GUIDE_LABELS: readonly ReferenceGuideLabel[] = [
  { text: "North pole", coordinates: [25, 86] },
  { text: "South pole", coordinates: [25, -86] },
  { text: "Equator", coordinates: [-15, 0] },
  { text: "Hadley edge · 30° N", coordinates: [-40, 30] },
  { text: "Hadley edge · 30° S", coordinates: [-40, -30] },
  { text: "Polar cell edge · 60° N", coordinates: [-70, 60] },
  { text: "Polar cell edge · 60° S", coordinates: [-70, -60] },
  { text: "Prime meridian", coordinates: [4, 50] },
  { text: "Antimeridian", coordinates: [176, 50] },
  { text: "Trade winds", coordinates: [-95, 16] },
  { text: "Westerlies", coordinates: [100, 46] },
];

export const REFERENCE_GUIDE_POLES: readonly LonLat[] = [[0, 90], [0, -90]];

export function isReferenceDirectionAboveHorizon(
  directionDotCamera: number,
  cameraDistance: number,
  renderedRadius = 1.03,
  visibilityMargin = 0,
): boolean {
  if (
    !Number.isFinite(directionDotCamera) || !Number.isFinite(cameraDistance) ||
    !Number.isFinite(visibilityMargin)
  ) return false;
  if (cameraDistance <= renderedRadius || renderedRadius <= 0 || visibilityMargin < 0) return false;
  return directionDotCamera > renderedRadius / cameraDistance + visibilityMargin;
}

function normalized(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

export function createReferenceGuideLabelPatch(
  label: ReferenceGuideLabel,
  sampler: DisplayedHeightSampler,
  verticalExaggeration: number,
): ReferenceGuideLabelPatchData {
  const longitude = label.coordinates[0] * Math.PI / 180;
  const latitude = label.coordinates[1] * Math.PI / 180;
  const cosLatitude = Math.cos(latitude);
  const center: [number, number, number] = [
    cosLatitude * Math.cos(longitude),
    Math.sin(latitude),
    -cosLatitude * Math.sin(longitude),
  ];
  const east: [number, number, number] = [
    -Math.sin(longitude),
    0,
    -Math.cos(longitude),
  ];
  const north: [number, number, number] = [
    -Math.sin(latitude) * Math.cos(longitude),
    cosLatitude,
    Math.sin(latitude) * Math.sin(longitude),
  ];
  const horizontalSpan = Math.min(20, Math.max(8, 6 + label.text.length * 0.55)) *
    Math.PI / 180;
  const verticalSpan = 2.4 * Math.PI / 180;
  const vertexCount = (LABEL_COLUMNS + 1) * (LABEL_ROWS + 1);
  const directions = new Float32Array(vertexCount * 3);
  const heightsMetres = new Float32Array(vertexCount);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint16Array(LABEL_COLUMNS * LABEL_ROWS * 6);
  let vertex = 0;
  for (let row = 0; row <= LABEL_ROWS; row += 1) {
    const v = row / LABEL_ROWS;
    const northOffset = Math.tan((v - 0.5) * verticalSpan);
    for (let column = 0; column <= LABEL_COLUMNS; column += 1) {
      const u = column / LABEL_COLUMNS;
      const eastOffset = Math.tan((u - 0.5) * horizontalSpan);
      const direction = normalized(
        center[0] + east[0] * eastOffset + north[0] * northOffset,
        center[1] + east[1] * eastOffset + north[1] * northOffset,
        center[2] + east[2] * eastOffset + north[2] * northOffset,
      );
      const offset = vertex * 3;
      directions.set(direction, offset);
      heightsMetres[vertex] = sampler.sampleHeightMetres(direction);
      uvs[vertex * 2] = u;
      uvs[vertex * 2 + 1] = v;
      vertex += 1;
    }
  }
  let triangle = 0;
  for (let row = 0; row < LABEL_ROWS; row += 1) {
    for (let column = 0; column < LABEL_COLUMNS; column += 1) {
      const lowerLeft = row * (LABEL_COLUMNS + 1) + column;
      const lowerRight = lowerLeft + 1;
      const upperLeft = lowerLeft + LABEL_COLUMNS + 1;
      const upperRight = upperLeft + 1;
      indices[triangle++] = lowerLeft;
      indices[triangle++] = lowerRight;
      indices[triangle++] = upperLeft;
      indices[triangle++] = lowerRight;
      indices[triangle++] = upperRight;
      indices[triangle++] = upperLeft;
    }
  }
  const patch: ReferenceGuideLabelPatchData = {
    directions,
    heightsMetres,
    positions,
    uvs,
    indices,
    clearanceMetres: REFERENCE_GUIDE_LABEL_CLEARANCE_METRES,
    byteLength: directions.byteLength + heightsMetres.byteLength +
      positions.byteLength + uvs.byteLength + indices.byteLength,
  };
  updateReferenceGuideLabelPatchPositions(patch, verticalExaggeration);
  return patch;
}

export function updateReferenceGuideLabelPatchPositions(
  patch: ReferenceGuideLabelPatchData,
  verticalExaggeration: number,
): Float32Array {
  const exaggeration = Math.max(1, Math.min(
    30,
    Number.isFinite(verticalExaggeration) ? verticalExaggeration : 1,
  ));
  for (let index = 0; index < patch.heightsMetres.length; index += 1) {
    const offset = index * 3;
    const radius = 1 +
      (patch.heightsMetres[index] * exaggeration + patch.clearanceMetres) /
        EARTH_RADIUS_METRES;
    patch.positions[offset] = patch.directions[offset] * radius;
    patch.positions[offset + 1] = patch.directions[offset + 1] * radius;
    patch.positions[offset + 2] = patch.directions[offset + 2] * radius;
  }
  return patch.positions;
}

function latitudeCircle(latitude: number): LonLat[] {
  const coordinates: LonLat[] = [];
  // The ribbon builder joins source points with great-circle spans. Two-degree
  // source spacing keeps those short spans visually coincident with a parallel
  // instead of bowing poleward between widely spaced longitude anchors.
  for (let longitude = -180; longitude <= 180; longitude += 2) {
    coordinates.push([longitude, latitude]);
  }
  return coordinates;
}

function meridian(longitude: number): LonLat[] {
  const coordinates: LonLat[] = [];
  for (let latitude = -88; latitude <= 88; latitude += 8) {
    coordinates.push([longitude, latitude]);
  }
  if (coordinates.at(-1)?.[1] !== 88) coordinates.push([longitude, 88]);
  return coordinates;
}

function windArrow(
  start: LonLat,
  end: LonLat,
  headLatitudeSign: -1 | 1,
): LonLat[][] {
  const longitudeDirection = end[0] >= start[0] ? -1 : 1;
  const head: LonLat[] = [
    [end[0] + longitudeDirection * 3.2, end[1] + headLatitudeSign * 2.1],
    end,
    [end[0] + longitudeDirection * 3.2, end[1] - headLatitudeSign * 2.1],
  ];
  return [[start, end], head];
}

export function createReferenceGuideLines(): LonLat[][] {
  const lines: LonLat[][] = [
    latitudeCircle(0),
    latitudeCircle(30),
    latitudeCircle(-30),
    latitudeCircle(60),
    latitudeCircle(-60),
    latitudeCircle(87.5),
    latitudeCircle(-87.5),
    meridian(0),
    meridian(180),
  ];
  for (const longitude of [-120, -30, 60, 150]) {
    lines.push(...windArrow([longitude + 10, 20], [longitude, 12], 1));
    lines.push(...windArrow([longitude + 10, -20], [longitude, -12], -1));
  }
  for (const longitude of [-75, 105]) {
    lines.push(...windArrow([longitude - 10, 43], [longitude, 47], 1));
    lines.push(...windArrow([longitude - 10, -43], [longitude, -47], -1));
  }
  return lines;
}

export function createReferenceGuideRibbon(
  sampler: DisplayedHeightSampler,
  detail: SurfaceDetail,
  verticalExaggeration: number,
): CountryRibbonBatchData | undefined {
  return createCountryRibbonBatches(
    [{ lines: createReferenceGuideLines() }],
    sampler,
    {
      maxAngularStepDegrees: detail === "regional" ? 0.4 : 0.75,
      maxHeightErrorMetres: detail === "regional" ? 160 : 240,
      maxAdaptiveDepth: 2,
      grooveHalfWidthMetres: detail === "regional" ? 4_000 : 8_000,
      verticalExaggeration,
      maxRenderedVertices: REFERENCE_GUIDE_MAX_VERTICES,
      maxBytes: REFERENCE_GUIDE_MAX_BYTES,
      includeRim: false,
    },
  )[0];
}
