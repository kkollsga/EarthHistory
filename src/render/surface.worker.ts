/// <reference lib="webworker" />

import type { WorldSnapshot } from "../data";
import {
  generateSurface,
  type SurfaceDetail,
  type SurfaceFields,
  type SurfaceMode,
} from "./surface";

export interface SurfaceRequest {
  id: number;
  snapshot: WorldSnapshot;
  detail: SurfaceDetail;
  mode: SurfaceMode;
}

export interface SurfaceResponse {
  id: number;
  fields: SurfaceFields;
}

self.onmessage = (event: MessageEvent<SurfaceRequest>) => {
  const { id, snapshot, detail, mode } = event.data;
  const fields = generateSurface(snapshot, detail, undefined, mode);
  const response: SurfaceResponse = { id, fields };
  self.postMessage(response, {
    transfer: [
      fields.albedo.buffer,
      fields.relief.buffer,
      fields.reliefMetres.buffer,
      fields.roughness.buffer,
      fields.clouds.buffer,
    ],
  });
};

export {};
