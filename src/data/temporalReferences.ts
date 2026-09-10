import {
  createPeriodCoordinateResolver,
  paleomapCoordinateFrame,
  periodFramesMatch,
  type PeriodCoordinateResolver,
} from "./temporal";
import type { PaleomapMotionCatalog } from "./paleomapMotion";
import type {
  AreaTrackingFeatureMetadata,
  AreaTrackingLayer,
  CountryOutline,
  LonLat,
  TemporalReferences,
} from "./types";
import type { CaoPaleomapCrosswalk } from "./caoPaleomapCrosswalk";

export interface TemporalCountryReferences {
  readonly requestedAgeMa: number;
  readonly sourceAgesMa: readonly [youngerAgeMa: number, olderAgeMa: number];
  readonly countries: readonly CountryOutline[];
  readonly parts: readonly TemporalCountryPart[];
  readonly resolvedPartCount: number;
  readonly unsupportedPartCount: number;
  readonly pointCount: number;
  readonly evidence: "model-output" | "interpolation";
  readonly conversionEvidence?: "model-conversion-inference";
}

interface CaoMappedCountryPoint {
  readonly material: import("./temporal").PeriodMaterialCoordinate;
}

interface CaoMappedCountryPart {
  readonly partId: number;
  readonly countryId: string;
  readonly name: string;
  readonly targetPlateId: number;
  readonly points: readonly CaoMappedCountryPoint[];
}

export interface TemporalCountryPart {
  readonly partId: number;
  readonly countryId: string;
  readonly name: string;
  readonly plateId: number;
  readonly coordinates: readonly LonLat[];
}

export interface TemporalCountryResolver {
  readonly modelId: string;
  readonly referenceFrameId: string;
  resolve(requestedAgeMa: number): TemporalCountryReferences;
}

interface DecodedPart {
  readonly partId: number;
  readonly feature: AreaTrackingFeatureMetadata;
  readonly sourceAgeMa: number;
  readonly coordinates: readonly LonLat[];
}

function assertCompatibleTracking(
  tracking: AreaTrackingLayer,
  catalog: PaleomapMotionCatalog,
  expectedCatalogId?: string,
): void {
  const motionFrame = paleomapCoordinateFrame(catalog);
  if (
    tracking.catalog.plateModelId !== motionFrame.modelId ||
    tracking.catalog.referenceFrameId !== motionFrame.referenceFrameId
  ) {
    throw new Error(
      `country tracking model/frame ${tracking.catalog.plateModelId}/${tracking.catalog.referenceFrameId} does not match motion model/frame ${motionFrame.modelId}/${motionFrame.referenceFrameId}`,
    );
  }
  if (expectedCatalogId !== undefined && tracking.catalog.id !== expectedCatalogId) {
    throw new Error(`country tracking catalog ${tracking.catalog.id} does not match ${expectedCatalogId}`);
  }
  if (tracking.pointOffsets.length !== tracking.partIds.length + 1) {
    throw new Error(`country tracking ${tracking.ageMa} Ma point offsets are invalid`);
  }
}

function featureIsActive(feature: AreaTrackingFeatureMetadata, requestedAgeMa: number): boolean {
  const [oldest, youngest] = feature.validTimeMa;
  return (oldest === null || requestedAgeMa <= oldest) &&
    (youngest === null || requestedAgeMa >= youngest);
}

function decodeParts(layer: AreaTrackingLayer): DecodedPart[] {
  const scale = layer.catalog.coordinateScaleDegrees;
  const parts: DecodedPart[] = [];
  for (let index = 0; index < layer.partIds.length; index += 1) {
    const partId = layer.partIds[index]!;
    const part = layer.catalog.parts.find((candidate) => candidate.id === partId);
    const feature = part === undefined ? undefined : layer.catalog.features[part.feature];
    const start = layer.pointOffsets[index]!;
    const end = layer.pointOffsets[index + 1]!;
    if (
      part === undefined || feature === undefined || feature.plateId === null ||
      start > end || end * 2 > layer.coordinates.length
    ) continue;
    const coordinates: LonLat[] = [];
    for (let point = start; point < end; point += 1) {
      coordinates.push([
        layer.coordinates[point * 2]! * scale,
        layer.coordinates[point * 2 + 1]! * scale,
      ]);
    }
    if (coordinates.length >= 2) parts.push({ partId, feature, sourceAgeMa: layer.ageMa, coordinates });
  }
  return parts;
}

/**
 * Resolve modern-country reference parts at one requested age using the same
 * model hierarchy as surface material and focus. The younger endpoint owns a
 * part throughout an open interval; the older endpoint only supplies parts
 * absent at the younger endpoint, so the source cannot switch at the midpoint.
 */
export function createTemporalCountryResolver(
  references: TemporalReferences,
  catalog: PaleomapMotionCatalog,
  resolveCoordinate: PeriodCoordinateResolver = createPeriodCoordinateResolver(catalog),
): TemporalCountryResolver {
  const { younger, older } = references;
  assertCompatibleTracking(younger.areaTracking, catalog);
  assertCompatibleTracking(older.areaTracking, catalog, younger.areaTracking.catalog.id);
  if (younger.ageMa !== younger.areaTracking.ageMa || older.ageMa !== older.areaTracking.ageMa) {
    throw new Error("country tracking ages do not match their temporal reference endpoints");
  }

  const youngerParts = decodeParts(younger.areaTracking);
  const olderParts = younger.ageMa === older.ageMa ? youngerParts : decodeParts(older.areaTracking);
  const youngerPartIds = new Set(youngerParts.map((part) => part.partId));
  const intervalParts = younger.ageMa === older.ageMa
    ? youngerParts
    : [
        ...youngerParts,
        ...olderParts.filter((part) => !youngerPartIds.has(part.partId)),
      ];
  const frameId = paleomapCoordinateFrame(catalog).referenceFrameId;

  return {
    modelId: catalog.model.id,
    referenceFrameId: frameId,
    resolve(requestedAgeMa: number): TemporalCountryReferences {
      if (!Number.isFinite(requestedAgeMa)) throw new RangeError("requested country age must be finite");
      const sourceParts = Math.abs(requestedAgeMa - younger.ageMa) < 1e-9
        ? youngerParts
        : Math.abs(requestedAgeMa - older.ageMa) < 1e-9
          ? olderParts
          : intervalParts;
      const linesByCountry = new Map<string, { name: string; lines: LonLat[][] }>();
      const resolvedParts: TemporalCountryPart[] = [];
      let resolvedPartCount = 0;
      let unsupportedPartCount = 0;
      let pointCount = 0;
      for (const part of sourceParts) {
        if (!featureIsActive(part.feature, requestedAgeMa)) {
          unsupportedPartCount += 1;
          continue;
        }
        const plateId = part.feature.plateId;
        if (plateId === null) {
          unsupportedPartCount += 1;
          continue;
        }
        const coordinates: LonLat[] = [];
        let supported = true;
        for (const coordinate of part.coordinates) {
          const resolved = Math.abs(part.sourceAgeMa - requestedAgeMa) < 1e-9
            ? coordinate
            : resolveCoordinate({
                frame: paleomapCoordinateFrame(catalog),
                plateId,
                sourceAgeMa: part.sourceAgeMa,
                coordinates: coordinate,
              }, requestedAgeMa);
          if (resolved === undefined) {
            supported = false;
            break;
          }
          coordinates.push(resolved);
        }
        if (!supported) {
          unsupportedPartCount += 1;
          continue;
        }
        const country = linesByCountry.get(part.feature.countryId) ?? {
          name: part.feature.name,
          lines: [],
        };
        country.lines.push(coordinates);
        linesByCountry.set(part.feature.countryId, country);
        resolvedParts.push({
          partId: part.partId,
          countryId: part.feature.countryId,
          name: part.feature.name,
          plateId,
          coordinates,
        });
        resolvedPartCount += 1;
        pointCount += coordinates.length;
      }
      const evidence = Math.abs(younger.ageMa - older.ageMa) < 1e-9 ||
        Math.abs(requestedAgeMa - younger.ageMa) < 1e-9 ||
        Math.abs(requestedAgeMa - older.ageMa) < 1e-9
        ? "model-output" as const
        : "interpolation" as const;
      const sourceIds = younger.areaTracking.catalog.sourceIds;
      return {
        requestedAgeMa,
        sourceAgesMa: [younger.ageMa, older.ageMa],
        countries: [...linesByCountry.entries()].map(([id, country]) => ({
          id,
          name: country.name,
          lines: country.lines,
          sourceIds,
          evidence,
        })),
        parts: resolvedParts,
        resolvedPartCount,
        unsupportedPartCount,
        pointCount,
        evidence,
      };
    },
  };
}

/**
 * Bind the modern-country locator geometry to Cao static continental child
 * fragments once, then move those fragments at the requested age. Parts that
 * cross unsupported material are omitted instead of freezing modern borders.
 */
export function createCaoTemporalCountryResolver(
  present: AreaTrackingLayer,
  catalog: PaleomapMotionCatalog,
  crosswalk: CaoPaleomapCrosswalk,
): TemporalCountryResolver {
  assertCompatibleTracking(present, catalog);
  if (present.ageMa !== 0) throw new Error("Cao country references require the 0 Ma locator geometry");
  const frame = paleomapCoordinateFrame(catalog);
  const mappedParts: CaoMappedCountryPart[] = [];
  const sourceParts = decodeParts(present);
  let unsupportedAtReference = 0;
  for (const part of sourceParts) {
    const plateId = part.feature.plateId;
    if (plateId === null) {
      unsupportedAtReference += 1;
      continue;
    }
    let run: CaoMappedCountryPoint[] = [];
    let runKey: string | undefined;
    let runPlateId: number | undefined;
    let emitted = false;
    const flush = () => {
      if (run.length >= 2 && runPlateId !== undefined) {
        mappedParts.push({
          partId: mappedParts.length,
          countryId: part.feature.countryId,
          name: part.feature.name,
          targetPlateId: runPlateId,
          points: run,
        });
        emitted = true;
      }
      run = [];
      runKey = undefined;
      runPlateId = undefined;
    };
    for (const coordinate of part.coordinates) {
      const result = crosswalk.resolveSourcePoint({ frame, plateId, sourceAgeMa: 0, coordinates: coordinate }, 0);
      if (result.status !== "resolved") {
        flush();
        continue;
      }
      const key = `${result.targetMaterial.materialId}:${result.targetMaterial.plateId}`;
      if (runKey !== undefined && runKey !== key) flush();
      runKey = key;
      runPlateId = result.targetMaterial.plateId;
      run.push({ material: result.targetMaterial });
    }
    flush();
    if (!emitted) unsupportedAtReference += 1;
  }

  return {
    modelId: crosswalk.targetFrame.modelId,
    referenceFrameId: crosswalk.targetFrame.referenceFrameId,
    resolve(requestedAgeMa: number): TemporalCountryReferences {
      if (!Number.isFinite(requestedAgeMa)) throw new RangeError("requested country age must be finite");
      const linesByCountry = new Map<string, { name: string; lines: LonLat[][] }>();
      const parts: TemporalCountryPart[] = [];
      let unsupportedPartCount = unsupportedAtReference;
      let pointCount = 0;
      for (const mapped of mappedParts) {
        const coordinates: LonLat[] = [];
        let supported = true;
        for (const point of mapped.points) {
          const coordinate = crosswalk.resolveMappedMaterial(point.material, requestedAgeMa);
          if (coordinate === undefined) {
            supported = false;
            break;
          }
          coordinates.push(coordinate);
        }
        if (!supported) {
          unsupportedPartCount += 1;
          continue;
        }
        const country = linesByCountry.get(mapped.countryId) ?? {
          name: mapped.name,
          lines: [],
        };
        country.lines.push(coordinates);
        linesByCountry.set(mapped.countryId, country);
        parts.push({
          partId: mapped.partId,
          countryId: mapped.countryId,
          name: mapped.name,
          plateId: mapped.targetPlateId,
          coordinates,
        });
        pointCount += coordinates.length;
      }
      const evidence = requestedAgeMa === 0 ? "model-output" as const : "interpolation" as const;
      return {
        requestedAgeMa,
        sourceAgesMa: [0, 0],
        countries: [...linesByCountry.entries()].map(([id, country]) => ({
          id,
          name: country.name,
          lines: country.lines,
          sourceIds: [...present.catalog.sourceIds, ...crosswalk.sourceIds],
          evidence,
        })),
        parts,
        resolvedPartCount: parts.length,
        unsupportedPartCount,
        pointCount,
        evidence,
        conversionEvidence: "model-conversion-inference",
      };
    },
  };
}
