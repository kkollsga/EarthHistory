import { createCaoContinentalMaterialModel, loadCaoContinentalData, type CaoContinentalData } from "./caoContinental";
import { createCaoOceanMotionModel, loadCaoOceanMotionData, type CaoOceanMotionData } from "./caoOcean";
import { createCaoOceanLifecycleSampler, loadCaoOceanLifecycleData, type CaoOceanLifecycleData } from "./caoOceanLifecycle";
import {
  caoPeriodCoordinateViewDescriptor,
  createCaoPaleomapCrosswalk,
  type CaoPaleomapCrosswalk,
} from "./caoPaleomapCrosswalk";
import type { PaleomapMotionCatalog } from "./paleomapMotion";
import type { PeriodCoordinateViewDescriptor } from "./types";

export interface CaoCoordinateViewBundle {
  readonly ocean: CaoOceanMotionData;
  readonly oceanModel: ReturnType<typeof createCaoOceanMotionModel>;
  readonly lifecycle: CaoOceanLifecycleData;
  readonly sampleLifecycle: ReturnType<typeof createCaoOceanLifecycleSampler>;
  readonly continental: CaoContinentalData;
  readonly continentalModel: ReturnType<typeof createCaoContinentalMaterialModel>;
  readonly crosswalk: CaoPaleomapCrosswalk;
  readonly descriptor: PeriodCoordinateViewDescriptor;
}

let bundlePromise: Promise<CaoCoordinateViewBundle> | undefined;
let bundleFrameKey: string | undefined;

function assetUrl(path: string): string {
  return new URL(path, typeof document === "undefined" ? "http://localhost/" : document.baseURI).toString();
}

/** Share one source-qualified Cao frame bundle across App and renderer; failures remain retryable. */
export async function loadCaoCoordinateViewBundle(
  paleomap: PaleomapMotionCatalog,
): Promise<CaoCoordinateViewBundle> {
  const frameKey = `${paleomap.model.id}:${paleomap.model.underlyingModelVersion}:${paleomap.model.anchorPlateId}`;
  if (bundlePromise !== undefined && bundleFrameKey === frameKey) return bundlePromise;
  bundleFrameKey = frameKey;
  bundlePromise = Promise.all([
    loadCaoOceanMotionData(assetUrl("data/cao-ocean-motion-v1.json")),
    loadCaoContinentalData(assetUrl("data/cao-continental-motion-v1.json")),
    loadCaoOceanLifecycleData(assetUrl("data/cao-ocean-lifecycle-v1.json")),
  ]).then(([ocean, continental, lifecycle]) => {
    const oceanModel = createCaoOceanMotionModel(ocean);
    const sampleLifecycle = createCaoOceanLifecycleSampler(lifecycle, ocean.catalog);
    const continentalModel = createCaoContinentalMaterialModel(continental, oceanModel.evaluateRotation);
    const crosswalk = createCaoPaleomapCrosswalk(
      paleomap, ocean, continental, oceanModel, continentalModel,
    );
    return { ocean, oceanModel, lifecycle, sampleLifecycle, continental, continentalModel, crosswalk,
      descriptor: caoPeriodCoordinateViewDescriptor(ocean) };
  }).catch((error: unknown) => {
    bundlePromise = undefined;
    bundleFrameKey = undefined;
    throw error;
  });
  return bundlePromise;
}
