import type { LonLat } from "../data";
import {
  createCountryRibbonBatches,
  type CountryRibbonBatchData,
} from "./countryRibbons";
import type { DisplayedHeightSampler } from "./displayedHeight";
import type { SurfaceDetail } from "./surface";

export const REFERENCE_GUIDE_MAX_BYTES = 2 * 1024 * 1024;
export const REFERENCE_GUIDE_MAX_VERTICES = 48_000;

export interface ReferenceGuideLabel {
  text: string;
  coordinates: LonLat;
}

export const REFERENCE_GUIDE_LABELS: readonly ReferenceGuideLabel[] = [
  { text: "North pole", coordinates: [0, 87.5] },
  { text: "South pole", coordinates: [0, -87.5] },
  { text: "Equator", coordinates: [-35, 0] },
  { text: "Hadley edge · 30° N", coordinates: [-35, 30] },
  { text: "Hadley edge · 30° S", coordinates: [-35, -30] },
  { text: "Prime meridian", coordinates: [0, 48] },
  { text: "Antimeridian", coordinates: [180, 48] },
  { text: "Trade winds", coordinates: [-65, 16] },
  { text: "Westerlies", coordinates: [25, 46] },
];

function latitudeCircle(latitude: number): LonLat[] {
  const coordinates: LonLat[] = [];
  for (let longitude = -180; longitude <= 180; longitude += 30) {
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
