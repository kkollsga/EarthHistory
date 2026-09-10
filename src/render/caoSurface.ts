import type { WorldSnapshot, TemporalSurface, LonLat } from "../data";
import type { CaoPaleomapCrosswalk } from "../data/caoPaleomapCrosswalk";
import type { createCaoContinentalMaterialModel } from "../data/caoContinental";
import {
  createCaoOceanMotionModel,
  type CaoOceanMotionData,
} from "../data/caoOcean";
import type { CaoOceanLifecycleSample } from "../data/caoOceanLifecycle";
import { lonLatToPeriodDirection, periodDirectionToLonLat } from "../data/temporal";
import type { UnitDirection } from "../data/paleomapMotion";
import type { CubeTileFields } from "./cubeTileFields";
import {
  caoIceChronologyAllowsPermanentIce,
  EARTH_RADIUS_METRES,
  sampleProceduralControlElevation,
  type SurfaceMode,
} from "./surface";
import {
  directionToTemporalCoordinates,
  interpolateTemporalHeight,
  unwrapTemporalTileUvs,
} from "./temporalCube";
import { createPerceptualDetailSampler, perceptualMaterialChannel } from "./perceptualDetail";

export interface CaoBoundaryProximity {
  ridgeKilometres: number;
  trenchKilometres: number;
  riftKilometres: number;
  orogenKilometres: number;
}

export interface CaoBoundaryField {
  readonly ageMa: number;
  readonly evidence: "model-output" | "interpolation";
  readonly segmentCount: number;
  readonly unsupportedSegmentCount: number;
  readonly pointCount: number;
  sample(direction: UnitDirection, plateId?: number): CaoBoundaryProximity;
}

export interface CaoSurfaceUpdateTarget {
  positions: Float32Array;
  colors: Float32Array;
  uvs: Float32Array;
  textureSourceAgeMa: number;
  startVertex?: number;
  maxVertices?: number;
}

export interface CaoSurfaceUpdateResult {
  vertices: number;
  resolvedContinentalVertices: number;
  resolvedOceanVertices: number;
  unsupportedVertices: number;
  ridgeVertices: number;
  trenchVertices: number;
  minHeightMetres: number;
  maxHeightMetres: number;
  nextVertex: number;
  complete: boolean;
}

export interface CaoSurfaceResolver {
  readonly requestedAgeMa: number;
  readonly boundaryStatus: "exact" | "interpolated" | "unsupported-fractional";
  readonly boundaryField: CaoBoundaryField | null;
  updateTile(
    fields: Readonly<CubeTileFields>,
    mode: SurfaceMode,
    verticalExaggeration: number,
    target: CaoSurfaceUpdateTarget,
  ): CaoSurfaceUpdateResult;
  updatePreviewTile(
    fields: Readonly<CubeTileFields>,
    mode: SurfaceMode,
    verticalExaggeration: number,
    target: CaoSurfaceUpdateTarget,
  ): CaoSurfaceUpdateResult;
}

type CaoOceanModel = ReturnType<typeof createCaoOceanMotionModel>;
type CaoLifecycleSampler = (
  sourceAgeMa: number,
  direction: UnitDirection,
  exactTopologySlotIndex: number,
) => CaoOceanLifecycleSample | null;

interface BoundaryEdge {
  start: UnitDirection;
  end: UnitDirection;
  normal: UnitDirection;
  kind: "ridge" | "trench" | "rift" | "orogen";
  subductingPlateId: number | null;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_KM = 6_371;
const BOUNDARY_BIN_DEGREES = 5;
const BOUNDARY_BIN_WIDTH = 72;
const BOUNDARY_BIN_HEIGHT = 37;
const BOUNDARY_SUPPORT_RADIANS = (420 / RAD_TO_KM) + 6 * DEG_TO_RAD;
const BOUNDARY_SUPPORT_COSINE = Math.cos(BOUNDARY_SUPPORT_RADIANS);
const BOUNDARY_ROW_RADIUS = Math.ceil(BOUNDARY_SUPPORT_RADIANS / (BOUNDARY_BIN_DEGREES * DEG_TO_RAD));
const VEGETATED_STAGES = new Set(["early-land-plants", "forest-world", "flowering-plants", "modern-biomes"]);
const caoDetail = createPerceptualDetailSampler("cao-et-al-2024:target-material");

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function dot(left: UnitDirection, right: UnitDirection): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left: UnitDirection, right: UnitDirection): UnitDirection {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function normalize(direction: UnitDirection): UnitDirection {
  const inverse = 1 / Math.hypot(...direction);
  return [direction[0] * inverse, direction[1] * inverse, direction[2] * inverse];
}

function angularDistance(left: UnitDirection, right: UnitDirection): number {
  return Math.acos(clamp(dot(left, right), -1, 1));
}

function edgeDistanceRadians(point: UnitDirection, edge: BoundaryEdge): number {
  const projected = cross(edge.normal, cross(point, edge.normal));
  const projectionLength = Math.hypot(...projected);
  if (projectionLength > 1e-12) {
    const foot = normalize(projected);
    for (const candidate of [foot, [-foot[0], -foot[1], -foot[2]] as UnitDirection]) {
      const total = angularDistance(edge.start, candidate) + angularDistance(candidate, edge.end);
      const span = angularDistance(edge.start, edge.end);
      if (Math.abs(total - span) < 1e-7) return angularDistance(point, candidate);
    }
  }
  return Math.min(angularDistance(point, edge.start), angularDistance(point, edge.end));
}

function boundaryKind(featureType: string): BoundaryEdge["kind"] | null {
  if (featureType === "MidOceanRidge") return "ridge";
  if (featureType === "SubductionZone") return "trench";
  if (featureType === "ContinentalRift") return "rift";
  if (featureType === "OrogenicBelt") return "orogen";
  return null;
}

function boundaryBin(direction: UnitDirection): [column: number, row: number] {
  const longitude = Math.atan2(direction[1], direction[0]) / DEG_TO_RAD;
  const latitude = Math.asin(clamp(direction[2], -1, 1)) / DEG_TO_RAD;
  return [
    ((Math.round((longitude + 180) / BOUNDARY_BIN_DEGREES) % BOUNDARY_BIN_WIDTH) + BOUNDARY_BIN_WIDTH) % BOUNDARY_BIN_WIDTH,
    clamp(Math.round((90 - latitude) / BOUNDARY_BIN_DEGREES), 0, BOUNDARY_BIN_HEIGHT - 1),
  ];
}

function decodeSegmentPoints(data: CaoOceanMotionData, coordinateOffset: number, coordinateCount: number): UnitDirection[] {
  const scale = data.catalog.grid.scaleDegrees * DEG_TO_RAD;
  return Array.from({ length: coordinateCount }, (_, index): UnitDirection => {
    const offset = (coordinateOffset + index) * 2;
    const longitude = data.coordinates[offset]! * scale;
    const latitude = data.coordinates[offset + 1]! * scale;
    const cosine = Math.cos(latitude);
    return [cosine * Math.cos(longitude), cosine * Math.sin(longitude), Math.sin(latitude)];
  });
}

function samplePolyline(points: readonly UnitDirection[], fraction: number): UnitDirection {
  if (points.length === 1) return points[0]!;
  const spans = points.slice(0, -1).map((point, index) => angularDistance(point, points[index + 1]!));
  const total = spans.reduce((sum, span) => sum + span, 0);
  if (total < 1e-12) return points[0]!;
  const target = clamp(fraction, 0, 1) * total;
  let travelled = 0;
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    if (target > travelled + span && index + 1 < spans.length) {
      travelled += span;
      continue;
    }
    const local = span < 1e-12 ? 0 : clamp((target - travelled) / span, 0, 1);
    const start = points[index]!;
    const end = points[index + 1]!;
    const sine = Math.sin(span);
    return sine < 1e-12 ? start : normalize([
      (Math.sin((1 - local) * span) * start[0] + Math.sin(local * span) * end[0]) / sine,
      (Math.sin((1 - local) * span) * start[1] + Math.sin(local * span) * end[1]) / sine,
      (Math.sin((1 - local) * span) * start[2] + Math.sin(local * span) * end[2]) / sine,
    ]);
  }
  return points[points.length - 1]!;
}

function interpolateDirection(younger: UnitDirection, older: UnitDirection, fraction: number): UnitDirection {
  const angle = angularDistance(younger, older);
  const sine = Math.sin(angle);
  if (sine < 1e-12) return younger;
  return normalize([
    (Math.sin((1 - fraction) * angle) * younger[0] + Math.sin(fraction * angle) * older[0]) / sine,
    (Math.sin((1 - fraction) * angle) * younger[1] + Math.sin(fraction * angle) * older[1]) / sine,
    (Math.sin((1 - fraction) * angle) * younger[2] + Math.sin(fraction * angle) * older[2]) / sine,
  ]);
}

/** Build a native or source-validated interpolated Cao boundary proximity field. */
export function createCaoBoundaryField(data: CaoOceanMotionData, ageMa: number): CaoBoundaryField | null {
  if (!Number.isFinite(ageMa) || ageMa < 0 || ageMa > 540) return null;
  const exactAgeIndex = data.catalog.ages.findIndex((entry) => entry.ageMa === ageMa);
  const youngerAgeIndex = Math.floor(ageMa / 5);
  const fraction = exactAgeIndex >= 0 ? 0 : (ageMa - youngerAgeIndex * 5) / 5;
  const sourceLines: Array<{
    segment: CaoOceanMotionData["catalog"]["segments"][number];
    points: UnitDirection[];
  }> = [];
  let unsupportedSegmentCount = 0;
  if (exactAgeIndex >= 0) {
    const record = data.catalog.ages[exactAgeIndex]!;
    for (const segment of data.catalog.segments.slice(record.segmentOffset, record.segmentOffset + record.segmentCount)) {
      sourceLines.push({ segment, points: decodeSegmentPoints(data, segment.coordinateOffset, segment.coordinateCount) });
    }
  } else {
    for (const link of data.catalog.boundaryLinks) {
      if (link.youngerAgeIndex !== youngerAgeIndex) continue;
      const younger = data.catalog.segments[link.youngerSegmentIndex]!;
      const older = data.catalog.segments[link.olderSegmentIndex]!;
      const youngerPoints = decodeSegmentPoints(data, younger.coordinateOffset, younger.coordinateCount);
      const olderPoints = decodeSegmentPoints(data, older.coordinateOffset, older.coordinateCount);
      const pointCount = Math.max(2, youngerPoints.length, olderPoints.length);
      const points = Array.from({ length: pointCount }, (_, index) => {
        const along = index / (pointCount - 1);
        return interpolateDirection(
          samplePolyline(youngerPoints, along),
          samplePolyline(olderPoints, along),
          fraction,
        );
      });
      sourceLines.push({ segment: younger, points });
    }
    unsupportedSegmentCount = Math.max(
      0,
      data.catalog.ages[youngerAgeIndex]!.segmentCount - sourceLines.length,
    );
    if (sourceLines.length === 0) return null;
  }
  const edges: BoundaryEdge[] = [];
  const bins = Array.from({ length: BOUNDARY_BIN_WIDTH * BOUNDARY_BIN_HEIGHT }, () => new Set<number>());
  let pointCount = 0;
  for (const { segment, points } of sourceLines) {
    const feature = data.catalog.features[segment.sourceFeatureIndex];
    const kind = feature && boundaryKind(feature.featureType);
    if (kind === null || kind === undefined) continue;
    pointCount += points.length;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const start = points[index]!;
      const end = points[index + 1]!;
      const normalRaw = cross(start, end);
      if (Math.hypot(...normalRaw) < 1e-12) continue;
      const edgeIndex = edges.length;
      edges.push({
        start,
        end,
        normal: normalize(normalRaw),
        kind,
        subductingPlateId: segment.subductingPlateId ?? null,
      });
      const span = angularDistance(start, end);
      const steps = Math.max(1, Math.ceil(span / (2 * DEG_TO_RAD)));
      const sine = Math.sin(span);
      for (let step = 0; step <= steps; step += 1) {
        const fraction = step / steps;
        const sample = sine < 1e-12 ? start : normalize([
          (Math.sin((1 - fraction) * span) * start[0] + Math.sin(fraction * span) * end[0]) / sine,
          (Math.sin((1 - fraction) * span) * start[1] + Math.sin(fraction * span) * end[1]) / sine,
          (Math.sin((1 - fraction) * span) * start[2] + Math.sin(fraction * span) * end[2]) / sine,
        ]);
        const [column, row] = boundaryBin(sample);
        for (let rowDelta = -BOUNDARY_ROW_RADIUS; rowDelta <= BOUNDARY_ROW_RADIUS; rowDelta += 1) {
          const markedRow = row + rowDelta;
          if (markedRow < 0 || markedRow >= BOUNDARY_BIN_HEIGHT) continue;
          for (let markedColumn = 0; markedColumn < BOUNDARY_BIN_WIDTH; markedColumn += 1) {
            const longitude = (-180 + markedColumn * BOUNDARY_BIN_DEGREES) * DEG_TO_RAD;
            const latitude = (90 - markedRow * BOUNDARY_BIN_DEGREES) * DEG_TO_RAD;
            const cosine = Math.cos(latitude);
            const centre: UnitDirection = [cosine * Math.cos(longitude), cosine * Math.sin(longitude), Math.sin(latitude)];
            if (dot(sample, centre) >= BOUNDARY_SUPPORT_COSINE) {
              bins[markedRow * BOUNDARY_BIN_WIDTH + markedColumn]!.add(edgeIndex);
            }
          }
        }
      }
    }
  }
  const compactBins = bins.map((entries) => Uint32Array.from(entries));
  return {
    ageMa,
    evidence: exactAgeIndex >= 0 ? "model-output" : "interpolation",
    segmentCount: sourceLines.length,
    unsupportedSegmentCount,
    pointCount,
    sample(direction, plateId) {
      const [column, row] = boundaryBin(direction);
      const result: CaoBoundaryProximity = {
        ridgeKilometres: Number.POSITIVE_INFINITY,
        trenchKilometres: Number.POSITIVE_INFINITY,
        riftKilometres: Number.POSITIVE_INFINITY,
        orogenKilometres: Number.POSITIVE_INFINITY,
      };
      for (const edgeIndex of compactBins[row * BOUNDARY_BIN_WIDTH + column]!) {
        const edge = edges[edgeIndex]!;
        if (edge.kind === "trench" && (edge.subductingPlateId === null || edge.subductingPlateId !== plateId)) {
          continue;
        }
        const distance = edgeDistanceRadians(direction, edge) * RAD_TO_KM;
        if (edge.kind === "ridge") result.ridgeKilometres = Math.min(result.ridgeKilometres, distance);
        else if (edge.kind === "trench") result.trenchKilometres = Math.min(result.trenchKilometres, distance);
        else if (edge.kind === "rift") result.riftKilometres = Math.min(result.riftKilometres, distance);
        else result.orogenKilometres = Math.min(result.orogenKilometres, distance);
      }
      return result;
    },
  };
}

/** Stein & Stein (1992) GDH1 thermal-basement relation, age in Ma. */
export function gdh1DepthMetres(ageMa: number): number {
  const age = Math.max(0, ageMa);
  return age < 20
    ? 2_600 + 365 * Math.sqrt(age)
    : 5_651 - 2_473 * Math.exp(-0.0278 * age);
}

function lifecycleCrustAge(sample: CaoOceanLifecycleSample | null, sourceAgeMa: number): number | null {
  if (sample?.birth.status !== "confirmed") return null;
  const [youngerBound, olderBound] = sample.birth.intervalMa;
  return Math.max(0, (youngerBound + olderBound) / 2 - sourceAgeMa);
}

function oceanHeight(
  sampleLifecycle: CaoLifecycleSampler,
  sourceAgeMa: number,
  direction: UnitDirection,
  topologySlotIndex: number,
): number | null {
  const age = lifecycleCrustAge(
    sampleLifecycle(sourceAgeMa, direction, topologySlotIndex),
    sourceAgeMa,
  );
  return age === null ? null : -gdh1DepthMetres(age);
}

function smoothInfluence(distanceKm: number, radiusKm: number): number {
  const t = clamp(1 - distanceKm / radiusKm, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Add bounded, source-positioned boundary relief to a thermal basement.
 * Widths and amplitudes are display heuristics; boundary positions and types
 * come from the Cao model and are never presented as measured bathymetry.
 */
export function applyCaoBoundaryRelief(
  baseHeightMetres: number,
  kind: "continental" | "ocean",
  boundary: CaoBoundaryProximity,
): number {
  if (kind === "ocean") {
    // GDH1 already contains broad ridge thermal uplift. The boundary control
    // only corrects the coarse lifecycle sample toward its published 0 Ma
    // crust depth, then adds a bounded trench on the known subducting side.
    const ridge = smoothInfluence(boundary.ridgeKilometres, 420);
    return baseHeightMetres + (Math.max(baseHeightMetres, -gdh1DepthMetres(0)) - baseHeightMetres) * ridge -
      smoothInfluence(boundary.trenchKilometres, 260) * 1_100;
  }
  return baseHeightMetres -
    smoothInfluence(boundary.riftKilometres, 180) * 320 +
    smoothInfluence(boundary.orogenKilometres, 260) * 850;
}

export function caoMaterialColor(
  heightMetres: number,
  kind: "continental" | "ocean" | "unsupported-land" | "unsupported-ocean",
  latitude: number,
  detailCoordinates: LonLat,
  environment: WorldSnapshot["environment"],
  boundary: CaoBoundaryProximity | null,
  sourceAllowsPermanentIce = true,
): [number, number, number] {
  // Unknown ocean ancestry keeps a coherent bathymetric tone. Static Cao land
  // with an unsupported elevation crosswalk can still carry climate-potential
  // color, while its height remains at datum and stays counted as unsupported.
  if (kind === "unsupported-ocean") return [0.055, 0.16, 0.22];
  // Crust identity does not determine exposure. Negative continental relief
  // includes shelves and inland seas and therefore uses marine color.
  if (kind === "ocean" || (kind === "continental" && heightMetres < 0)) {
    const depth = clamp(-heightMetres / 6_500, 0, 1);
    const ridge = kind === "ocean" && boundary !== null
      ? smoothInfluence(boundary.ridgeKilometres, 420)
      : 0;
    const detail = caoDetail.sample({
      longitude: detailCoordinates[0],
      latitude: detailCoordinates[1],
      elevationMetres: heightMetres,
      slope: ridge,
      land: false,
      ice: 0,
      climateGroup: "ocean",
      stage: environment.stage ?? "modern-biomes",
      tectonicInfluence: ridge,
      detail: "regional",
    });
    const base: [number, number, number] = [
      0.04 + ridge * 0.18,
      0.18 + ridge * 0.34,
      0.29 + ridge * 0.3 - depth * 0.1,
    ];
    return base.map((value, index) => clamp(
      perceptualMaterialChannel(value, detail, index as 0 | 1 | 2, 2.4),
      0,
      1,
    )) as [number, number, number];
  }
  const altitude = clamp(heightMetres / 5_000, 0, 1);
  const temperature = (environment.temperatureC ?? 14) - (Math.abs(latitude) - (90 - 180 / Math.PI)) * 0.42 -
    Math.max(0, heightMetres) * 0.0065;
  const cold = clamp((5 - temperature) / 13, 0, 1);
  const icePotential = sourceAllowsPermanentIce
    ? cold * clamp(environment.iceIntensity ?? 0, 0, 1)
    : 0;
  const dry = clamp((Math.abs(latitude) - 15) / 25, 0, 1) * clamp((48 - Math.abs(latitude)) / 20, 0, 1);
  const biologicallyEligible = VEGETATED_STAGES.has(environment.stage ?? "modern-biomes");
  const vegetation = biologicallyEligible
    ? clamp((environment.vegetation ?? 0.65) * (1 - dry * 0.72) * (1 - altitude * 0.38), 0, 1)
    : 0;
  let color: [number, number, number] = [
    0.43 * (1 - vegetation) + 0.18 * vegetation,
    0.37 * (1 - vegetation) + 0.34 * vegetation,
    0.27 * (1 - vegetation) + 0.15 * vegetation,
  ];
  color = [
    color[0] + altitude * 0.22 + (biologicallyEligible ? dry * 0.16 : 0),
    color[1] + altitude * 0.04 + (biologicallyEligible ? dry * 0.05 : 0),
    color[2] + altitude * 0.08 - dry * 0.04,
  ];
  if (icePotential > 0) color = [
    color[0] + icePotential * 0.35,
    color[1] + icePotential * 0.35,
    color[2] + icePotential * 0.38,
  ];
  const detail = caoDetail.sample({
    longitude: detailCoordinates[0],
    latitude: detailCoordinates[1],
    elevationMetres: heightMetres,
    slope: altitude,
    land: true,
    ice: icePotential,
    climateGroup: undefined,
    stage: environment.stage ?? "modern-biomes",
    tectonicInfluence: 0,
    detail: "regional",
  });
  return color.map((value, index) => clamp(
    perceptualMaterialChannel(value, detail, index as 0 | 1 | 2, 1.7),
    0,
    1,
  )) as [number, number, number];
}

export function caoDisplayedHeightMetres(heightMetres: number, mode: SurfaceMode): number {
  return mode === "surface" ? Math.max(0, heightMetres) : heightMetres;
}

/**
 * Expose source-derived slopes after the displaced mesh normals are known.
 * This changes only material color: it never adds elevation or a landform.
 */
export function applyCaoSlopeMaterialContrast(
  colors: Float32Array,
  directions: Float32Array,
  normals: Float32Array,
): void {
  if (colors.length !== directions.length || normals.length !== directions.length) {
    throw new RangeError("Cao slope material arrays must describe the same vertices");
  }
  const rock: readonly [number, number, number] = [0.31, 0.28, 0.25];
  for (let offset = 0; offset < colors.length; offset += 3) {
    // Marine colors already encode target-native bathymetry and ridge age.
    // Restrict rock exposure to nonmarine material instead of guessing a
    // crust class from geometry alone.
    if (colors[offset + 2]! > colors[offset + 1]! * 1.05) continue;
    const radialDot = Math.abs(
      directions[offset]! * normals[offset]! +
      directions[offset + 1]! * normals[offset + 1]! +
      directions[offset + 2]! * normals[offset + 2]!
    );
    const slope = clamp((1 - radialDot - 0.002) / 0.085, 0, 1);
    const exposure = slope * slope * (3 - 2 * slope) * 0.48;
    for (let channel = 0; channel < 3; channel += 1) {
      colors[offset + channel] =
        colors[offset + channel]! * (1 - exposure) + rock[channel]! * exposure;
    }
  }
}

export function createCaoSurfaceResolver(
  oceanData: CaoOceanMotionData,
  oceanModel: CaoOceanModel,
  continentalModel: ReturnType<typeof createCaoContinentalMaterialModel>,
  sampleLifecycle: CaoLifecycleSampler,
  crosswalk: CaoPaleomapCrosswalk,
  temporal: TemporalSurface,
  environment: WorldSnapshot["environment"],
): CaoSurfaceResolver {
  const requestedAgeMa = temporal.requestedAgeMa;
  const materialResolver = oceanModel.createIntervalResolver(
    requestedAgeMa,
    temporal.younger.ageMa,
    temporal.older.ageMa,
  );
  const boundaryField = createCaoBoundaryField(oceanData, requestedAgeMa);
  const sourceAllowsPermanentIce = caoIceChronologyAllowsPermanentIce(requestedAgeMa);
  const resolver: CaoSurfaceResolver = {
    requestedAgeMa,
    boundaryStatus: boundaryField === null
      ? "unsupported-fractional"
      : boundaryField.evidence === "model-output" ? "exact" : "interpolated",
    boundaryField,
    updateTile(fields, mode, verticalExaggeration, target) {
      const vertexCount = fields.directions.length / 3;
      if (
        target.positions.length !== fields.directions.length ||
        target.colors.length !== fields.directions.length ||
        target.uvs.length !== fields.localUvs.length
      ) throw new RangeError("Cao cube targets do not match the tile vertex count");
      let resolvedContinentalVertices = 0;
      let resolvedOceanVertices = 0;
      let unsupportedVertices = 0;
      let ridgeVertices = 0;
      let trenchVertices = 0;
      let minHeightMetres = Number.POSITIVE_INFINITY;
      let maxHeightMetres = Number.NEGATIVE_INFINITY;
      const startVertex = clamp(Math.floor(target.startVertex ?? 0), 0, vertexCount);
      const endVertex = Math.min(
        vertexCount,
        startVertex + Math.max(1, Math.floor(target.maxVertices ?? vertexCount)),
      );
      for (let index = startVertex; index < endVertex; index += 1) {
        const offset = index * 3;
        const rendererDirection: [number, number, number] = [
          fields.directions[offset]!, fields.directions[offset + 1]!, fields.directions[offset + 2]!,
        ];
        const targetCoordinates = directionToTemporalCoordinates(rendererDirection);
        const targetDirection = lonLatToPeriodDirection(targetCoordinates);
        const continentalMaterial = continentalModel.resolveAt(requestedAgeMa, targetDirection);
        const material = continentalMaterial === null ? materialResolver.resolveAt(targetDirection) : null;
        const boundary = boundaryField?.sample(targetDirection, material?.plateId ?? continentalMaterial?.plateId) ?? null;
        const unsupportedLand = continentalMaterial !== null || material?.kind === "continental-crust";
        let heightMetres = unsupportedLand ? 0 : -4_500;
        let kind: "continental" | "ocean" | "unsupported-land" | "unsupported-ocean" =
          unsupportedLand ? "unsupported-land" : "unsupported-ocean";
        let textureCoordinates = targetCoordinates;
        let detailCoordinates = targetCoordinates;
        if (continentalMaterial !== null) {
          detailCoordinates = periodDirectionToLonLat(continentalMaterial.referenceDirection);
          textureCoordinates = detailCoordinates;
          const younger = crosswalk.resolveTargetMaterialPoint(
            continentalMaterial, requestedAgeMa, temporal.younger.ageMa,
          );
          const older = crosswalk.resolveTargetMaterialPoint(
            continentalMaterial, requestedAgeMa, temporal.older.ageMa,
          );
          if (younger.status === "resolved" && older.status === "resolved") {
            const youngerHeight = sampleProceduralControlElevation(
              temporal.younger.controls, younger.sourceCoordinates[0], younger.sourceCoordinates[1],
            );
            const olderHeight = sampleProceduralControlElevation(
              temporal.older.controls, older.sourceCoordinates[0], older.sourceCoordinates[1],
            );
            heightMetres = interpolateTemporalHeight(youngerHeight, olderHeight, temporal.fraction);
            if (boundary !== null) heightMetres = applyCaoBoundaryRelief(heightMetres, "continental", boundary);
            kind = "continental";
            resolvedContinentalVertices++;
          }
        } else if (material?.kind === "oceanic-crust") {
          const youngerHeight = oceanHeight(
            sampleLifecycle,
            temporal.younger.ageMa,
            material.youngerDirection,
            material.youngerTopologySlotIndex,
          );
          const olderHeight = oceanHeight(
            sampleLifecycle,
            temporal.older.ageMa,
            material.olderDirection,
            material.olderTopologySlotIndex,
          );
          if (youngerHeight !== null && olderHeight !== null) {
            heightMetres = interpolateTemporalHeight(youngerHeight, olderHeight, temporal.fraction);
            if (boundary !== null) {
              const ridge = smoothInfluence(boundary.ridgeKilometres, 420);
              const trench = smoothInfluence(boundary.trenchKilometres, 260);
              heightMetres = applyCaoBoundaryRelief(heightMetres, "ocean", boundary);
              if (ridge > 0.05) ridgeVertices++;
              if (trench > 0.05) trenchVertices++;
            }
            kind = "ocean";
            detailCoordinates = periodDirectionToLonLat(material.seedChart.direction);
            textureCoordinates = detailCoordinates;
            resolvedOceanVertices++;
          }
        }
        if (kind === "unsupported-land" || kind === "unsupported-ocean") unsupportedVertices++;
        const displayedHeight = caoDisplayedHeightMetres(heightMetres, mode);
        minHeightMetres = Math.min(minHeightMetres, heightMetres);
        maxHeightMetres = Math.max(maxHeightMetres, heightMetres);
        const radius = 1 + displayedHeight / EARTH_RADIUS_METRES * verticalExaggeration;
        target.positions[offset] = rendererDirection[0] * radius;
        target.positions[offset + 1] = rendererDirection[1] * radius;
        target.positions[offset + 2] = rendererDirection[2] * radius;
        const color = caoMaterialColor(
          heightMetres, kind, targetCoordinates[1], detailCoordinates, environment, boundary,
          sourceAllowsPermanentIce,
        );
        target.colors[offset] = color[0];
        target.colors[offset + 1] = color[1];
        target.colors[offset + 2] = color[2];
        const uvOffset = index * 2;
        target.uvs[uvOffset] = (textureCoordinates[0] + 180) / 360;
        target.uvs[uvOffset + 1] = (textureCoordinates[1] + 90) / 180;
      }
      return {
        vertices: endVertex - startVertex,
        resolvedContinentalVertices,
        resolvedOceanVertices,
        unsupportedVertices,
        ridgeVertices,
        trenchVertices,
        minHeightMetres,
        maxHeightMetres,
        nextVertex: endVertex,
        complete: endVertex === vertexCount,
      };
    },
    updatePreviewTile(fields, mode, verticalExaggeration, target) {
      const segments = fields.meshSegments;
      const rowSize = segments + 1;
      const step = 4;
      const anchorAxis = Array.from(
        { length: segments / step + 1 },
        (_, index) => Math.min(segments, index * step),
      );
      const anchorRowSize = anchorAxis.length;
      const anchorCount = anchorRowSize * anchorRowSize;
      const directions = new Float32Array(anchorCount * 3);
      const localUvs = new Float32Array(anchorCount * 2);
      for (let ay = 0; ay < anchorRowSize; ay += 1) {
        for (let ax = 0; ax < anchorRowSize; ax += 1) {
          const sourceIndex = anchorAxis[ay]! * rowSize + anchorAxis[ax]!;
          const anchorIndex = ay * anchorRowSize + ax;
          directions.set(fields.directions.subarray(sourceIndex * 3, sourceIndex * 3 + 3), anchorIndex * 3);
          localUvs.set(fields.localUvs.subarray(sourceIndex * 2, sourceIndex * 2 + 2), anchorIndex * 2);
        }
      }
      const sparsePositions = new Float32Array(anchorCount * 3);
      const sparseColors = new Float32Array(anchorCount * 3);
      const sparseUvs = new Float32Array(anchorCount * 2);
      const result = resolver.updateTile(
        { ...fields, directions, localUvs },
        mode,
        verticalExaggeration,
        {
          positions: sparsePositions,
          colors: sparseColors,
          uvs: sparseUvs,
          textureSourceAgeMa: target.textureSourceAgeMa,
        },
      );
      // Unwrap the sparse material chart before interpolation. Unwrapping the
      // dense result later cannot repair a .99 -> .01 anchor span that has
      // already been interpolated through the opposite side of the globe.
      unwrapTemporalTileUvs(anchorRowSize - 1, sparseUvs);
      const sparseRadii = Float32Array.from(
        { length: anchorCount },
        (_, index) => Math.hypot(
          sparsePositions[index * 3]!,
          sparsePositions[index * 3 + 1]!,
          sparsePositions[index * 3 + 2]!,
        ),
      );
      const bilinear = (
        values: Float32Array,
        components: number,
        ax0: number,
        ay0: number,
        ax1: number,
        ay1: number,
        fx: number,
        fy: number,
        component: number,
      ) => {
        const north = values[(ay0 * anchorRowSize + ax0) * components + component]! * (1 - fx) +
          values[(ay0 * anchorRowSize + ax1) * components + component]! * fx;
        const south = values[(ay1 * anchorRowSize + ax0) * components + component]! * (1 - fx) +
          values[(ay1 * anchorRowSize + ax1) * components + component]! * fx;
        return north * (1 - fy) + south * fy;
      };
      for (let y = 0; y <= segments; y += 1) {
        const sy = y / step;
        const ay0 = Math.min(anchorRowSize - 2, Math.floor(sy));
        const ay1 = ay0 + 1;
        const fy = sy - ay0;
        for (let x = 0; x <= segments; x += 1) {
          const sx = x / step;
          const ax0 = Math.min(anchorRowSize - 2, Math.floor(sx));
          const ax1 = ax0 + 1;
          const fx = sx - ax0;
          const index = y * rowSize + x;
          const offset = index * 3;
          const scalar = bilinear(sparseRadii, 1, ax0, ay0, ax1, ay1, fx, fy, 0);
          target.positions[offset] = fields.directions[offset]! * scalar;
          target.positions[offset + 1] = fields.directions[offset + 1]! * scalar;
          target.positions[offset + 2] = fields.directions[offset + 2]! * scalar;
          for (let component = 0; component < 3; component += 1) {
            target.colors[offset + component] = bilinear(
              sparseColors, 3, ax0, ay0, ax1, ay1, fx, fy, component,
            );
          }
          const uvOffset = index * 2;
          for (let component = 0; component < 2; component += 1) {
            target.uvs[uvOffset + component] = bilinear(
              sparseUvs, 2, ax0, ay0, ax1, ay1, fx, fy, component,
            );
          }
        }
      }
      return { ...result, vertices: rowSize * rowSize, nextVertex: rowSize * rowSize, complete: true };
    },
  };
  return resolver;
}
