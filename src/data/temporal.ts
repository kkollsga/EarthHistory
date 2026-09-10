import {
  createPaleomapIntervalResolver,
  createPaleomapDirectionFromAgeResolver,
  loadPaleomapMotionCatalog,
  type PaleomapIntervalResolver,
  type PaleomapMotionCatalog,
  type UnitDirection,
} from "./paleomapMotion";
import { resolvePaleodemAgeBracket } from "./paleodem";
import type { LonLat } from "./types";

let motionCatalogPromise: Promise<PaleomapMotionCatalog> | undefined;

export const PERIOD_DIRECTION_CONVENTION = "gplates-xyz-x0e-y90e-znorth" as const;

export interface PeriodCoordinateFrame {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly referenceFrameId: string;
  readonly anchorPlateId: number;
  readonly directionConvention: typeof PERIOD_DIRECTION_CONVENTION;
}

export interface PeriodSourceAgeBracket {
  readonly requestedAgeMa: number;
  readonly youngerAgeMa: number;
  readonly olderAgeMa: number;
  readonly fraction: number;
  readonly exactEndpoint: boolean;
}

export type PeriodMaterialKind = "continental-crust" | "oceanic-crust";

export interface PeriodMaterialCoordinate {
  readonly materialId: string;
  readonly kind: PeriodMaterialKind;
  readonly frame: PeriodCoordinateFrame;
  readonly sourceIds: readonly string[];
  readonly plateId: number;
  readonly referenceAgeMa: number;
  readonly directionAtReference: UnitDirection;
  readonly validTimeMa: { readonly oldest: number | null; readonly youngest: number | null };
  /** Source topology identity is interval-scoped where crust has no surviving present reference. */
  readonly topologyIntervalMa?: readonly [youngerAgeMa: number, olderAgeMa: number];
}

export type PeriodTopologyOwnership<T> =
  | { readonly status: "unknown" }
  | { readonly status: "ambiguous" }
  | { readonly status: "resolved"; readonly slotIndex: number; readonly topology: T };

export interface PeriodBoundaryReference {
  readonly featureId: string;
  readonly type:
    | "mid-ocean-ridge"
    | "subduction"
    | "continental-rift"
    | "orogenic-belt"
    | "other";
  readonly ageMa: number;
  readonly validTimeMa: { readonly oldest: number | null; readonly youngest: number | null };
  readonly frame: PeriodCoordinateFrame;
  readonly sourceIds: readonly string[];
  readonly coordinates: readonly LonLat[];
  readonly adjacencyStatus: "resolved" | "incomplete" | "unknown";
  readonly leftPlateIds: readonly number[];
  readonly rightPlateIds: readonly number[];
  readonly orientationStatus?: "resolved" | "unknown";
  readonly overridingPlateId?: number;
  readonly subductingPlateId?: number;
  readonly subductionPolarity?: "left" | "right" | "unknown";
}

export type PeriodCoordinateUnsupportedReason =
  | "unknown-topology"
  | "ambiguous-topology"
  | "topology-transition"
  | "outside-valid-time"
  | "missing-rotation"
  | "model-frame-mismatch";

export type PeriodCoordinateResult =
  | {
      readonly status: "resolved";
      readonly frame: PeriodCoordinateFrame;
      readonly requestedAgeMa: number;
      readonly coordinates: LonLat;
      readonly material: PeriodMaterialCoordinate;
    }
  | {
      readonly status: "unsupported";
      readonly frame: PeriodCoordinateFrame;
      readonly requestedAgeMa: number;
      readonly reason: PeriodCoordinateUnsupportedReason;
    };

export interface PeriodCoordinateView {
  readonly frame: PeriodCoordinateFrame;
  readonly sourceAgesMa: readonly number[];
  readonly materialSourceIds: readonly string[];
  readonly boundarySourceIds: readonly string[];
}

export interface PeriodPointReference {
  readonly frame: PeriodCoordinateFrame;
  readonly plateId: number;
  readonly sourceAgeMa: number;
  readonly coordinates: LonLat;
}

export interface PeriodCoordinateConversionResolver {
  readonly id: string;
  readonly sourceFrame: PeriodCoordinateFrame;
  readonly targetFrame: PeriodCoordinateFrame;
  readonly sourceIds: readonly string[];
  resolve(reference: PeriodPointReference, requestedAgeMa: number): PeriodCoordinateResult;
}

export function paleomapCoordinateFrame(catalog: PaleomapMotionCatalog): PeriodCoordinateFrame {
  return {
    modelId: catalog.model.id,
    modelVersion: catalog.model.underlyingModelVersion,
    referenceFrameId: `anchor-plate-${catalog.model.anchorPlateId}`,
    anchorPlateId: catalog.model.anchorPlateId,
    directionConvention: PERIOD_DIRECTION_CONVENTION,
  };
}

export function periodFramesMatch(
  expected: PeriodCoordinateFrame,
  actual: PeriodCoordinateFrame,
): boolean {
  return expected.modelId === actual.modelId &&
    expected.modelVersion === actual.modelVersion &&
    expected.referenceFrameId === actual.referenceFrameId &&
    expected.anchorPlateId === actual.anchorPlateId &&
    expected.directionConvention === actual.directionConvention;
}

export function assertPeriodCoordinateView(view: PeriodCoordinateView): void {
  if (
    view.frame.modelId.length === 0 || view.frame.modelVersion.length === 0 ||
    view.frame.referenceFrameId.length === 0 || !Number.isInteger(view.frame.anchorPlateId)
  ) throw new Error("period coordinate view is missing a complete model/frame identity");
  resolvePeriodSourceAgeBracket(view.sourceAgesMa, view.sourceAgesMa[0] ?? Number.NaN);
  if (view.materialSourceIds.length === 0) {
    throw new Error("period coordinate view is missing a material source");
  }
}

export function periodPointMatchesView(
  view: PeriodCoordinateView,
  reference: PeriodPointReference,
): boolean {
  return periodFramesMatch(view.frame, reference.frame);
}

export function resolvePeriodSourceAgeBracket(
  sourceAgesMa: readonly number[],
  requestedAgeMa: number,
): PeriodSourceAgeBracket {
  if (!Number.isFinite(requestedAgeMa)) throw new RangeError("requested period age must be finite");
  if (sourceAgesMa.length === 0) throw new RangeError("period source ages cannot be empty");
  const ages = [...sourceAgesMa].sort((left, right) => left - right);
  if (ages.some((age, index) => !Number.isFinite(age) || (index > 0 && age === ages[index - 1]))) {
    throw new RangeError("period source ages must be finite and unique");
  }
  if (requestedAgeMa < ages[0]! || requestedAgeMa > ages[ages.length - 1]!) {
    throw new RangeError("requested period age is outside source coverage");
  }
  const exact = ages.find((age) => Math.abs(age - requestedAgeMa) < 1e-9);
  if (exact !== undefined) {
    return {
      requestedAgeMa,
      youngerAgeMa: exact,
      olderAgeMa: exact,
      fraction: 0,
      exactEndpoint: true,
    };
  }
  const olderIndex = ages.findIndex((age) => age > requestedAgeMa);
  const youngerAgeMa = ages[olderIndex - 1]!;
  const olderAgeMa = ages[olderIndex]!;
  return {
    requestedAgeMa,
    youngerAgeMa,
    olderAgeMa,
    fraction: (requestedAgeMa - youngerAgeMa) / (olderAgeMa - youngerAgeMa),
    exactEndpoint: false,
  };
}

/** Decode the compact topology-grid sentinel contract; polygon rings remain authoritative. */
export function decodePeriodTopologyOwnership<T>(
  encodedSlot: number,
  topologySlots: readonly T[],
): PeriodTopologyOwnership<T> {
  if (!Number.isInteger(encodedSlot) || encodedSlot < 0 || encodedSlot > 255) {
    throw new RangeError("topology slot must be uint8");
  }
  if (encodedSlot === 0) return { status: "unknown" };
  if (encodedSlot === 255) return { status: "ambiguous" };
  const slotIndex = encodedSlot - 1;
  const topology = topologySlots[slotIndex];
  if (topology === undefined) throw new RangeError(`topology slot ${encodedSlot} is not defined`);
  return { status: "resolved", slotIndex, topology };
}

export function periodMaterialIncludesAge(
  material: Pick<PeriodMaterialCoordinate, "validTimeMa">,
  ageMa: number,
): boolean {
  if (!Number.isFinite(ageMa)) return false;
  const { oldest, youngest } = material.validTimeMa;
  return (oldest === null || ageMa <= oldest) && (youngest === null || ageMa >= youngest);
}

export function assertPeriodBoundaryReference(boundary: PeriodBoundaryReference): void {
  if (
    boundary.frame.modelId.length === 0 || boundary.frame.referenceFrameId.length === 0 ||
    boundary.frame.modelVersion.length === 0 || boundary.sourceIds.length === 0
  ) throw new Error(`period boundary ${boundary.featureId} is missing model/frame/source identity`);
  if (!Number.isFinite(boundary.ageMa) || boundary.coordinates.length < 2) {
    throw new Error(`period boundary ${boundary.featureId} has invalid age or geometry`);
  }
  if (
    boundary.adjacencyStatus === "resolved" &&
    (boundary.leftPlateIds.length === 0 || boundary.rightPlateIds.length === 0)
  ) {
    throw new Error(`period boundary ${boundary.featureId} is missing plate adjacency`);
  }
  if (
    boundary.type === "subduction" && boundary.orientationStatus === "resolved" &&
    (boundary.overridingPlateId === undefined || boundary.subductingPlateId === undefined)
  ) throw new Error(`subduction boundary ${boundary.featureId} is missing polarity plates`);
  if (
    boundary.type === "subduction" && boundary.orientationStatus === "resolved" &&
    boundary.overridingPlateId === boundary.subductingPlateId
  ) throw new Error(`subduction boundary ${boundary.featureId} has identical polarity plates`);
}

export function interpolatePeriodScalar(younger: number, older: number, fraction: number): number {
  const t = Math.max(0, Math.min(1, fraction));
  return younger + (older - younger) * t;
}

/** Standard GPlates axes: +X at 0°E, +Y at 90°E, +Z at the north pole. */
export function lonLatToPeriodDirection([longitude, latitude]: LonLat): UnitDirection {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

export function periodDirectionToLonLat([x, y, z]: UnitDirection): LonLat {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < Number.EPSILON) {
    throw new RangeError("period direction must be finite and non-zero");
  }
  return [Math.atan2(y, x) * 180 / Math.PI, Math.asin(Math.max(-1, Math.min(1, z / length))) * 180 / Math.PI];
}

export function createPeriodMaterialResolver(
  catalog: PaleomapMotionCatalog,
  requestedAgeMa: number,
): PaleomapIntervalResolver {
  const bracket = resolvePaleodemAgeBracket(requestedAgeMa);
  return createPaleomapIntervalResolver(
    catalog,
    bracket.requestedAgeMa,
    bracket.youngerAgeMa,
    bracket.olderAgeMa,
  );
}

export type PeriodCoordinateResolver = (
  reference: PeriodPointReference,
  requestedAgeMa: number,
) => LonLat | undefined;

export function createPeriodCoordinateResolver(catalog: PaleomapMotionCatalog): PeriodCoordinateResolver {
  const resolveDirection = createPaleomapDirectionFromAgeResolver(catalog);
  const frame = paleomapCoordinateFrame(catalog);
  return (reference: PeriodPointReference, requestedAgeMa: number): LonLat | undefined => {
    if (!periodFramesMatch(frame, reference.frame)) return undefined;
    const direction = resolveDirection(
      reference.plateId,
      lonLatToPeriodDirection(reference.coordinates),
      reference.sourceAgeMa,
      requestedAgeMa,
    );
    return direction === null ? undefined : periodDirectionToLonLat(direction);
  };
}

export function loadPeriodMotionCatalog(
  baseUri: string = typeof document === "undefined" ? "" : document.baseURI,
): Promise<PaleomapMotionCatalog> {
  const url = baseUri === "" ? "data/paleomap-motion-v1.json" : new URL("data/paleomap-motion-v1.json", baseUri).toString();
  motionCatalogPromise ??= loadPaleomapMotionCatalog(url).catch((error: unknown) => {
    motionCatalogPromise = undefined;
    throw error;
  });
  return motionCatalogPromise;
}

export type { PaleomapIntervalResolver, PaleomapMotionCatalog, UnitDirection } from "./paleomapMotion";
