import type { CaoOceanLifecycleSample } from "./caoOceanLifecycle";
import { resolvePlateDirectionBetweenAges, type UnitDirection } from "./paleomapMotion";
import { lonLatToPeriodDirection, periodDirectionToLonLat, periodFramesMatch, periodMaterialIncludesAge,
  resolvePeriodSourceAgeBracket, type PeriodCoordinateFrame } from "./temporal";
import type { CaoCoordinateViewBundle } from "./caoView";
import type { LonLat } from "./types";

export interface CaoMaterialFocusDescriptor {
  readonly version: 1;
  readonly viewId: "cao-2024-v2.4";
  readonly frame: PeriodCoordinateFrame;
  readonly materialId: string;
  readonly materialKind: "continental-crust" | "oceanic-crust";
  readonly plateId: number;
  readonly referenceAgeMa: number;
  readonly directionAtReference: UnitDirection;
  readonly sourceTopologyId?: string;
  readonly olderTopologyId?: string;
  readonly topologyIntervalMa?: readonly [number, number];
  readonly validTimeMa: { readonly oldest: number | null; readonly youngest: number | null };
}

function oldestFromLifecycle(sample: CaoOceanLifecycleSample | null, fallback: number): number {
  return sample?.birth.status === "confirmed" ? sample.birth.intervalMa[0]
    : sample?.birth.status === "censored" ? 540 : fallback;
}

function youngestFromLifecycle(sample: CaoOceanLifecycleSample | null, fallback: number): number {
  return sample?.loss.status === "confirmed" ? sample.loss.intervalMa[1]
    : sample?.loss.status === "censored" ? 0 : fallback;
}

/** One target-native focus resolver shared by continental and ocean material. */
export function createCaoMaterialFocusResolver(bundle: CaoCoordinateViewBundle) {
  const frame = bundle.crosswalk.targetFrame;
  const ages = bundle.ocean.catalog.ages.map(({ ageMa }) => ageMa);
  const intervalCache = new Map<string, ReturnType<typeof bundle.oceanModel.createIntervalResolver>>();
  const intervalAt = (ageMa: number) => {
    const bracket = resolvePeriodSourceAgeBracket(ages, ageMa);
    const key = `${bracket.youngerAgeMa}:${bracket.olderAgeMa}:${ageMa}`;
    const cached = intervalCache.get(key);
    if (cached) {
      intervalCache.delete(key);
      intervalCache.set(key, cached);
      return cached;
    }
    const resolver = bundle.oceanModel.createIntervalResolver(ageMa, bracket.youngerAgeMa, bracket.olderAgeMa);
    if (intervalCache.size >= 3) intervalCache.delete(intervalCache.keys().next().value!);
    intervalCache.set(key, resolver);
    return resolver;
  };
  return {
    create(coordinates: LonLat, ageMa: number): CaoMaterialFocusDescriptor | null {
      if (!Number.isFinite(ageMa) || ageMa < 0 || ageMa > 540) return null;
      const direction = lonLatToPeriodDirection(coordinates);
      const continental = bundle.continentalModel.resolveAt(ageMa, direction);
      if (continental) return {
        version: 1,
        viewId: "cao-2024-v2.4",
        frame,
        materialId: continental.fragmentId,
        materialKind: "continental-crust",
        plateId: continental.plateId,
        referenceAgeMa: 0,
        directionAtReference: continental.referenceDirection,
        validTimeMa: continental.validTimeMa,
      };
      const material = intervalAt(ageMa).resolveAt(direction);
      if (!material || material.kind !== "oceanic-crust") return null;
      const sourceAgeIndex = bundle.ocean.catalog.ages.findIndex(({ ageMa: sourceAge }) => sourceAge === material.referenceAgeMa);
      const sourceSlot = sourceAgeIndex < 0 ? undefined : bundle.ocean.catalog.ages[sourceAgeIndex]?.topologySlots
        .findIndex(({ sourceFeatureId, plateId }) => sourceFeatureId === material.youngerTopologyId && plateId === material.plateId);
      const lifecycle = sourceSlot === undefined || sourceSlot < 0 ? null :
        bundle.sampleLifecycle(material.referenceAgeMa, material.referenceDirection, sourceSlot);
      return {
        version: 1,
        viewId: "cao-2024-v2.4",
        frame,
        materialId: material.lifecycleId,
        materialKind: "oceanic-crust",
        plateId: material.plateId,
        referenceAgeMa: material.referenceAgeMa,
        directionAtReference: material.referenceDirection,
        sourceTopologyId: material.youngerTopologyId,
        olderTopologyId: material.olderTopologyId,
        topologyIntervalMa: material.topologyIntervalMa,
        validTimeMa: {
          oldest: oldestFromLifecycle(lifecycle, material.topologyIntervalMa[1]),
          youngest: youngestFromLifecycle(lifecycle, material.topologyIntervalMa[0]),
        },
      };
    },
    resolve(descriptor: CaoMaterialFocusDescriptor, ageMa: number): LonLat | undefined {
      if (descriptor.viewId !== bundle.descriptor.id || !periodFramesMatch(frame, descriptor.frame) ||
          ageMa < 0 || ageMa > 540) return undefined;
      let authoritativeValidTime: CaoMaterialFocusDescriptor["validTimeMa"] | undefined;
      if (descriptor.materialKind === "continental-crust") {
        const source = bundle.continentalModel.resolveAt(descriptor.referenceAgeMa, descriptor.directionAtReference);
        if (source?.fragmentId !== descriptor.materialId || source.plateId !== descriptor.plateId) return undefined;
        authoritativeValidTime = source.validTimeMa;
      } else {
        const ageIndex = bundle.ocean.catalog.ages.findIndex(({ ageMa: sourceAge }) => sourceAge === descriptor.referenceAgeMa);
        if (ageIndex < 0 || descriptor.sourceTopologyId === undefined || descriptor.topologyIntervalMa === undefined) return undefined;
        const [intervalYounger, intervalOlder] = descriptor.topologyIntervalMa;
        if (intervalYounger !== descriptor.referenceAgeMa ||
            (intervalOlder !== intervalYounger && intervalOlder !== intervalYounger + 5) || intervalOlder > 540) return undefined;
        const ownership = bundle.oceanModel.ownershipAt(ageIndex, descriptor.directionAtReference);
        if (ownership.status !== "resolved" || ownership.topology.plateId !== descriptor.plateId ||
            ownership.topology.sourceFeatureId !== descriptor.sourceTopologyId) return undefined;
        const olderDirection = resolvePlateDirectionBetweenAges(bundle.oceanModel.evaluateRotation,
          descriptor.plateId, descriptor.directionAtReference, descriptor.referenceAgeMa, intervalOlder);
        const olderAgeIndex = bundle.ocean.catalog.ages.findIndex(({ ageMa: sourceAge }) => sourceAge === intervalOlder);
        const olderOwnership = olderDirection === null || olderAgeIndex < 0
          ? { status: "unknown" as const }
          : bundle.oceanModel.ownershipAt(olderAgeIndex, olderDirection);
        if (olderOwnership.status !== "resolved" || olderOwnership.topology.plateId !== descriptor.plateId) return undefined;
        const validationAgeMa = intervalYounger === intervalOlder
          ? intervalYounger
          : (intervalYounger + intervalOlder) / 2;
        const validationDirection = resolvePlateDirectionBetweenAges(bundle.oceanModel.evaluateRotation,
          descriptor.plateId, descriptor.directionAtReference, descriptor.referenceAgeMa, validationAgeMa);
        const validationMaterial = validationDirection === null ? null : intervalAt(validationAgeMa).resolveAt(validationDirection);
        if (!validationMaterial || validationMaterial.kind !== "oceanic-crust" ||
            validationMaterial.lifecycleId !== descriptor.materialId ||
            validationMaterial.youngerTopologyId !== descriptor.sourceTopologyId ||
            validationMaterial.olderTopologyId !== descriptor.olderTopologyId ||
            validationMaterial.topologyIntervalMa[0] !== intervalYounger ||
            validationMaterial.topologyIntervalMa[1] !== intervalOlder) return undefined;
        const lifecycle = bundle.sampleLifecycle(descriptor.referenceAgeMa,
          descriptor.directionAtReference, ownership.slotIndex);
        authoritativeValidTime = {
          oldest: oldestFromLifecycle(lifecycle, descriptor.topologyIntervalMa[1]),
          youngest: youngestFromLifecycle(lifecycle, descriptor.topologyIntervalMa[0]),
        };
      }
      if (authoritativeValidTime.oldest !== descriptor.validTimeMa.oldest ||
          authoritativeValidTime.youngest !== descriptor.validTimeMa.youngest ||
          !periodMaterialIncludesAge({ validTimeMa: authoritativeValidTime }, ageMa)) return undefined;
      const direction = resolvePlateDirectionBetweenAges(
        bundle.oceanModel.evaluateRotation, descriptor.plateId, descriptor.directionAtReference,
        descriptor.referenceAgeMa, ageMa,
      );
      if (!direction) return undefined;
      if (descriptor.materialKind === "continental-crust") {
        const material = bundle.continentalModel.resolveAt(ageMa, direction);
        return material?.fragmentId === descriptor.materialId ? periodDirectionToLonLat(direction) : undefined;
      }
      const material = intervalAt(ageMa).resolveAt(direction);
      if (!material || material.kind !== "oceanic-crust" || material.plateId !== descriptor.plateId) return undefined;
      return periodDirectionToLonLat(direction);
    },
    get cachedIntervalCount() { return intervalCache.size; },
  };
}
