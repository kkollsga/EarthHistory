/// <reference lib="webworker" />

import type { LonLat, ModernReliefPatch, WorldSnapshot } from "../data";
import {
  generateRegionalPatch,
  type RegionalPatchFields,
} from "./regionalPatch";
import type { SurfaceMode } from "./surface";

export interface RegionalPatchRequest {
  id: number;
  snapshot: WorldSnapshot;
  center: LonLat;
  mode: SurfaceMode;
  sourcePatch?: ModernReliefPatch;
}

export interface RegionalPatchResponse {
  id: number;
  fields: RegionalPatchFields;
}

self.onmessage = (event: MessageEvent<RegionalPatchRequest>) => {
  const { id, snapshot, center, mode, sourcePatch } = event.data;
  const fields = generateRegionalPatch(
    snapshot,
    center,
    mode,
    sourcePatch === undefined ? 128 : 192,
    24,
    sourcePatch,
  );
  const response: RegionalPatchResponse = { id, fields };
  self.postMessage(response, {
    transfer: [
      fields.directions.buffer,
      fields.heightsMetres.buffer,
      fields.sourceHeightsMetres.buffer,
      fields.sourceBlendWeights.buffer,
      fields.syntheticDetailMetres.buffer,
      fields.blendWeights.buffer,
      fields.uvs.buffer,
      fields.indices.buffer,
    ],
  });
};

export {};
