import {
  createCaoContinentalMaterialModel,
  type CaoContinentalData,
  type ResolvedCaoContinentalMaterial,
} from "./caoContinental";
import { createCaoOceanMotionModel, type CaoOceanMotionData } from "./caoOcean";
import {
  createPaleomapDirectionFromAgeResolver,
  createPaleomapIntervalResolver,
  resolvePlateDirectionFromReference,
  type PaleomapIntervalResolver,
  type PaleomapMotionCatalog,
  type UnitDirection,
} from "./paleomapMotion";
import {
  PERIOD_DIRECTION_CONVENTION,
  lonLatToPeriodDirection,
  paleomapCoordinateFrame,
  periodDirectionToLonLat,
  periodFramesMatch,
  periodMaterialIncludesAge,
  resolvePeriodSourceAgeBracket,
  type PeriodCoordinateFrame,
  type PeriodMaterialCoordinate,
  type PeriodPointReference,
} from "./temporal";
import type { LonLat, PeriodCoordinateViewDescriptor } from "./types";

export const CAO_PALEOMAP_CROSSWALK_EVIDENCE = "model-conversion-inference" as const;

export type CaoPaleomapCrosswalkUnsupportedReason =
  | "source-frame-mismatch"
  | "source-material-unsupported"
  | "source-plate-mismatch"
  | "source-present-unsupported"
  | "source-present-lineage-mismatch"
  | "source-endpoint-unsupported"
  | "target-continental-material-unsupported"
  | "target-missing-rotation"
  | "target-present-lineage-mismatch"
  | "target-endpoint-lineage-mismatch";

export interface CaoPaleomapCrosswalkResolved {
  readonly status: "resolved";
  readonly evidence: typeof CAO_PALEOMAP_CROSSWALK_EVIDENCE;
  readonly requestedAgeMa: number;
  readonly sourceAgeMa: number;
  readonly sourceFrame: PeriodCoordinateFrame;
  readonly targetFrame: PeriodCoordinateFrame;
  readonly sourceCoordinates: LonLat;
  readonly targetCoordinates: LonLat;
  readonly sourcePlateId: number;
  readonly targetMaterial: PeriodMaterialCoordinate;
}

export interface CaoPaleomapCrosswalkUnsupported {
  readonly status: "unsupported";
  readonly evidence: typeof CAO_PALEOMAP_CROSSWALK_EVIDENCE;
  readonly requestedAgeMa: number;
  readonly sourceAgeMa: number;
  readonly sourceFrame: PeriodCoordinateFrame;
  readonly targetFrame: PeriodCoordinateFrame;
  readonly reason: CaoPaleomapCrosswalkUnsupportedReason;
}

export type CaoPaleomapCrosswalkResult = CaoPaleomapCrosswalkResolved | CaoPaleomapCrosswalkUnsupported;

export interface CaoPaleomapCrosswalk {
  readonly methodStatus: "static-continental-material-crosswalk";
  readonly sourceFrame: PeriodCoordinateFrame;
  readonly targetFrame: PeriodCoordinateFrame;
  readonly sourceIds: readonly string[];
  readonly ageCacheLimit: number;
  readonly cachedTargetAgeCount: number;
  readonly cachedSourceEndpointCount: number;
  resolveSourcePoint(reference: PeriodPointReference, requestedAgeMa: number): CaoPaleomapCrosswalkResult;
  resolveTargetPoint(targetCoordinates: LonLat, requestedAgeMa: number, sourceAgeMa: number): CaoPaleomapCrosswalkResult;
  /**
   * Map an authoritative Cao static-material lookup into one PALEOMAP source
   * endpoint. This avoids repeating the requested-age target partition query.
   */
  resolveTargetMaterialPoint(
    material: ResolvedCaoContinentalMaterial,
    requestedAgeMa: number,
    sourceAgeMa: number,
  ): CaoPaleomapCrosswalkResult;
  /** Move a previously crosswalked Cao child fragment without repeating source partition lookup. */
  resolveMappedMaterial(material: PeriodMaterialCoordinate, requestedAgeMa: number): LonLat | undefined;
}

function unsupported(
  crosswalk: Pick<CaoPaleomapCrosswalk, "sourceFrame" | "targetFrame">,
  requestedAgeMa: number,
  sourceAgeMa: number,
  reason: CaoPaleomapCrosswalkUnsupportedReason,
): CaoPaleomapCrosswalkUnsupported {
  return { status: "unsupported", evidence: CAO_PALEOMAP_CROSSWALK_EVIDENCE, requestedAgeMa, sourceAgeMa,
    sourceFrame: crosswalk.sourceFrame, targetFrame: crosswalk.targetFrame, reason };
}

export function caoCoordinateFrame(data: CaoOceanMotionData): PeriodCoordinateFrame {
  const { model } = data.catalog;
  return {
    modelId: model.id,
    modelVersion: model.version,
    referenceFrameId: `${model.referenceFrame}-anchor-${model.anchorPlateId}`,
    anchorPlateId: model.anchorPlateId,
    directionConvention: PERIOD_DIRECTION_CONVENTION,
  };
}

export function caoPeriodCoordinateViewDescriptor(
  data: CaoOceanMotionData,
): PeriodCoordinateViewDescriptor {
  return {
    id: "cao-2024-v2.4",
    frame: caoCoordinateFrame(data),
    motionUrl: "data/cao-ocean-motion-v1.json",
    continentalUrl: "data/cao-continental-motion-v1.json",
    lifecycleUrl: "data/cao-ocean-lifecycle-v1.json",
    conversionEvidence: "model-conversion-inference",
    unsupportedPolicy: "masked-neutral",
  };
}

function sameTargetMaterial(
  expected: ResolvedCaoContinentalMaterial,
  actual: ResolvedCaoContinentalMaterial | null,
): actual is ResolvedCaoContinentalMaterial {
  return actual !== null && actual.fragmentId === expected.fragmentId && actual.plateId === expected.plateId;
}

/**
 * Convert only persistent continental material. The Cao static continental
 * child fragment supplies identity and motion; its instantaneous enclosing
 * topology may have another plate ID and is never treated as lineage. Ocean
 * material and dated boundaries remain target-native Cao concerns.
 */
export function createCaoPaleomapCrosswalk(
  paleomap: PaleomapMotionCatalog,
  caoOceanData: CaoOceanMotionData,
  caoContinentalData: CaoContinentalData,
  suppliedOceanModel?: ReturnType<typeof createCaoOceanMotionModel>,
  suppliedContinentalModel?: ReturnType<typeof createCaoContinentalMaterialModel>,
): CaoPaleomapCrosswalk {
  if (
    caoOceanData.catalog.model.id !== caoContinentalData.catalog.model.id ||
    caoOceanData.catalog.model.version !== caoContinentalData.catalog.model.version ||
    caoOceanData.catalog.model.anchorPlateId !== caoContinentalData.catalog.model.anchorPlateId ||
    caoOceanData.catalog.model.referenceFrame !== caoContinentalData.catalog.model.referenceFrame
  ) throw new Error("Cao continental and ocean assets use different model frames");

  const sourceFrame = paleomapCoordinateFrame(paleomap);
  const caoOcean = suppliedOceanModel ?? createCaoOceanMotionModel(caoOceanData);
  const caoContinental = suppliedContinentalModel ??
    createCaoContinentalMaterialModel(caoContinentalData, caoOcean.evaluateRotation);
  const targetFrame = caoCoordinateFrame(caoOceanData);
  const sourceDirectionAtAge = createPaleomapDirectionFromAgeResolver(paleomap);
  const exactSourceResolvers = new Map<number, PaleomapIntervalResolver>();
  const ageCacheLimit = 4;
  const exactSourceResolver = (ageMa: number): PaleomapIntervalResolver => {
    const cached = exactSourceResolvers.get(ageMa);
    if (cached) {
      exactSourceResolvers.delete(ageMa);
      exactSourceResolvers.set(ageMa, cached);
      return cached;
    }
    const resolver = createPaleomapIntervalResolver(paleomap, ageMa, ageMa, ageMa);
    if (exactSourceResolvers.size >= ageCacheLimit) exactSourceResolvers.delete(exactSourceResolvers.keys().next().value!);
    exactSourceResolvers.set(ageMa, resolver);
    return resolver;
  };

  const validateTargetInterval = (
    material: ResolvedCaoContinentalMaterial,
    requestedAgeMa: number,
  ): PeriodMaterialCoordinate | CaoPaleomapCrosswalkUnsupportedReason => {
    const bracket = resolvePeriodSourceAgeBracket(caoOceanData.catalog.ages.map(({ ageMa }) => ageMa), requestedAgeMa);
    for (const endpointAgeMa of new Set([bracket.youngerAgeMa, bracket.olderAgeMa])) {
      const endpointDirection = resolvePlateDirectionFromReference(
        caoOcean.evaluateRotation, material.plateId, material.referenceDirection, endpointAgeMa,
      );
      if (!endpointDirection) return "target-missing-rotation";
      if (!sameTargetMaterial(material, caoContinental.resolveAt(endpointAgeMa, endpointDirection))) {
        return "target-endpoint-lineage-mismatch";
      }
    }
    return {
      materialId: material.fragmentId,
      kind: "continental-crust",
      frame: targetFrame,
      sourceIds: [caoContinentalData.catalog.model.sourceRecord],
      plateId: material.plateId,
      referenceAgeMa: 0,
      directionAtReference: material.referenceDirection,
      validTimeMa: material.validTimeMa,
      topologyIntervalMa: [bracket.youngerAgeMa, bracket.olderAgeMa],
    };
  };

  type PreparedTarget = {
    material: ResolvedCaoContinentalMaterial;
    requestedAgeMa: number;
    targetMaterial: PeriodMaterialCoordinate;
    paleomapPresent: NonNullable<ReturnType<PaleomapIntervalResolver["resolveAt"]>>;
  };
  let lastPreparedTarget: PreparedTarget | CaoPaleomapCrosswalkUnsupportedReason | undefined;
  let lastPreparedMaterial: ResolvedCaoContinentalMaterial | undefined;
  let lastPreparedAgeMa = Number.NaN;
  const prepareTargetMaterial = (
    material: ResolvedCaoContinentalMaterial,
    requestedAgeMa: number,
  ): PreparedTarget | CaoPaleomapCrosswalkUnsupportedReason => {
    if (lastPreparedMaterial === material && lastPreparedAgeMa === requestedAgeMa && lastPreparedTarget !== undefined) {
      return lastPreparedTarget;
    }
    let prepared: PreparedTarget | CaoPaleomapCrosswalkUnsupportedReason;
    if (material.ageMa !== requestedAgeMa) {
      prepared = "target-present-lineage-mismatch";
    } else {
      const targetAtPresent = caoContinental.resolveAt(0, material.referenceDirection);
      if (!sameTargetMaterial(material, targetAtPresent)) {
        prepared = "target-present-lineage-mismatch";
      } else {
        const targetMaterial = validateTargetInterval(material, requestedAgeMa);
        if (typeof targetMaterial === "string") {
          prepared = targetMaterial;
        } else {
          const paleomapPresent = exactSourceResolver(0).resolveAt(material.referenceDirection);
          prepared = paleomapPresent === null ? "source-present-unsupported" : {
            material,
            requestedAgeMa,
            targetMaterial,
            paleomapPresent,
          };
        }
      }
    }
    lastPreparedMaterial = material;
    lastPreparedAgeMa = requestedAgeMa;
    lastPreparedTarget = prepared;
    return prepared;
  };

  const resolvePreparedTarget = (
    material: ResolvedCaoContinentalMaterial,
    requestedAgeMa: number,
    sourceAgeMa: number,
  ): CaoPaleomapCrosswalkResult => {
    const prepared = prepareTargetMaterial(material, requestedAgeMa);
    if (typeof prepared === "string") return unsupported(crosswalk, requestedAgeMa, sourceAgeMa, prepared);
    const sourceDirection = sourceDirectionAtAge(
      prepared.paleomapPresent.plateId,
      material.referenceDirection,
      0,
      sourceAgeMa,
    );
    if (!sourceDirection) return unsupported(crosswalk, requestedAgeMa, sourceAgeMa, "source-endpoint-unsupported");
    const sourceMaterial = exactSourceResolver(sourceAgeMa).resolveAt(sourceDirection);
    if (
      !sourceMaterial || sourceMaterial.plateId !== prepared.paleomapPresent.plateId ||
      sourceMaterial.fragmentId !== prepared.paleomapPresent.fragmentId
    ) return unsupported(crosswalk, requestedAgeMa, sourceAgeMa, "source-endpoint-unsupported");
    return {
      status: "resolved",
      evidence: CAO_PALEOMAP_CROSSWALK_EVIDENCE,
      requestedAgeMa,
      sourceAgeMa,
      sourceFrame,
      targetFrame,
      sourceCoordinates: periodDirectionToLonLat(sourceDirection),
      targetCoordinates: periodDirectionToLonLat(material.directionAtAge),
      sourcePlateId: prepared.paleomapPresent.plateId,
      targetMaterial: prepared.targetMaterial,
    };
  };

  const crosswalk: CaoPaleomapCrosswalk = {
    methodStatus: "static-continental-material-crosswalk",
    sourceFrame,
    targetFrame,
    sourceIds: [paleomap.model.sourceRecord, caoContinentalData.catalog.model.sourceRecord],
    ageCacheLimit,
    get cachedTargetAgeCount() { return caoContinental.cachedAgeCount; },
    get cachedSourceEndpointCount() { return exactSourceResolvers.size; },
    resolveMappedMaterial(material, requestedAgeMa) {
      if (
        material.kind !== "continental-crust" ||
        !periodFramesMatch(targetFrame, material.frame) ||
        !periodMaterialIncludesAge(material, requestedAgeMa)
      ) return undefined;
      const direction = resolvePlateDirectionFromReference(
        caoOcean.evaluateRotation,
        material.plateId,
        material.directionAtReference,
        requestedAgeMa,
      );
      return direction === null ? undefined : periodDirectionToLonLat(direction);
    },
    resolveTargetMaterialPoint(material, requestedAgeMa, sourceAgeMa) {
      return resolvePreparedTarget(material, requestedAgeMa, sourceAgeMa);
    },
    resolveSourcePoint(reference, requestedAgeMa) {
      if (!periodFramesMatch(sourceFrame, reference.frame)) {
        return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, "source-frame-mismatch");
      }
      const sourceDirection = lonLatToPeriodDirection(reference.coordinates);
      const sourceMaterial = exactSourceResolver(reference.sourceAgeMa).resolveAt(sourceDirection);
      if (!sourceMaterial) return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, "source-material-unsupported");
      if (sourceMaterial.plateId !== reference.plateId) return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, "source-plate-mismatch");
      const presentDirection = sourceMaterial.referenceDirection;
      const presentSourceMaterial = exactSourceResolver(0).resolveAt(presentDirection);
      if (!presentSourceMaterial) return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, "source-present-unsupported");
      if (presentSourceMaterial.plateId !== sourceMaterial.plateId || presentSourceMaterial.fragmentId !== sourceMaterial.fragmentId) {
        return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, "source-present-lineage-mismatch");
      }
      const targetAtPresent = caoContinental.resolveAt(0, presentDirection);
      if (!targetAtPresent) return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, "target-continental-material-unsupported");
      const requestedDirection = resolvePlateDirectionFromReference(
        caoOcean.evaluateRotation, targetAtPresent.plateId, targetAtPresent.referenceDirection, requestedAgeMa,
      );
      if (!requestedDirection) return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, "target-missing-rotation");
      const targetAtRequested = caoContinental.resolveAt(requestedAgeMa, requestedDirection);
      if (!sameTargetMaterial(targetAtPresent, targetAtRequested)) {
        return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, "target-endpoint-lineage-mismatch");
      }
      const targetMaterial = validateTargetInterval(targetAtRequested, requestedAgeMa);
      if (typeof targetMaterial === "string") return unsupported(crosswalk, requestedAgeMa, reference.sourceAgeMa, targetMaterial);
      return { status: "resolved", evidence: CAO_PALEOMAP_CROSSWALK_EVIDENCE, requestedAgeMa,
        sourceAgeMa: reference.sourceAgeMa, sourceFrame, targetFrame, sourceCoordinates: reference.coordinates,
        targetCoordinates: periodDirectionToLonLat(requestedDirection), sourcePlateId: reference.plateId, targetMaterial };
    },
    resolveTargetPoint(targetCoordinates, requestedAgeMa, sourceAgeMa) {
      const requestedDirection: UnitDirection = lonLatToPeriodDirection(targetCoordinates);
      const targetAtRequested = caoContinental.resolveAt(requestedAgeMa, requestedDirection);
      if (!targetAtRequested) return unsupported(crosswalk, requestedAgeMa, sourceAgeMa, "target-continental-material-unsupported");
      const result = resolvePreparedTarget(targetAtRequested, requestedAgeMa, sourceAgeMa);
      return result.status === "resolved" ? { ...result, targetCoordinates } : result;
    },
  };
  return crosswalk;
}
