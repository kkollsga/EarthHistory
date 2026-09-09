/// <reference lib="webworker" />

import {
  createCubeTileFieldGenerator,
  type CubeTileFieldContext,
  type CubeTileFieldGenerator,
  type CubeTileFieldRequest,
  type CubeTileFields,
} from "./cubeTileFields";

export interface CubeInitializeRequest {
  type: "initialize";
  id: number;
  contextKey: string;
  context: CubeTileFieldContext;
}

export interface CubeGenerateRequest {
  type: "generate";
  id: number;
  contextKey: string;
  requests: CubeTileFieldRequest[];
}

export type CubeSurfaceRequest = CubeInitializeRequest | CubeGenerateRequest;

export interface CubeReadyResponse {
  type: "ready";
  id: number;
  contextKey: string;
  retainedBytes: number;
}

export interface CubeFieldsResponse {
  type: "fields";
  id: number;
  contextKey: string;
  fields: CubeTileFields[];
  retainedBytes: number;
  generationMs: number;
}

export interface CubeErrorResponse {
  type: "error";
  id: number;
  contextKey: string;
  message: string;
}

export type CubeSurfaceResponse = CubeReadyResponse | CubeFieldsResponse | CubeErrorResponse;

self.onmessage = (event: MessageEvent<CubeSurfaceRequest>) => {
  const request = event.data;
  if (request.type === "initialize") {
    try {
      generator = createCubeTileFieldGenerator(request.context);
      activeContextKey = request.contextKey;
      const response: CubeReadyResponse = {
        type: "ready",
        id: request.id,
        contextKey: request.contextKey,
        retainedBytes: generator.retainedBytes,
      };
      self.postMessage(response);
    } catch (error) {
      postError(request, error);
    }
    return;
  }

  if (generator === null || activeContextKey !== request.contextKey) {
    postError(request, new Error("Cube worker context is not initialized"));
    return;
  }

  try {
    const started = performance.now();
    const fields = request.requests.map((tileRequest) => generator!.generate(tileRequest));
    const response: CubeFieldsResponse = {
      type: "fields",
      id: request.id,
      contextKey: request.contextKey,
      fields,
      retainedBytes: generator.retainedBytes,
      generationMs: performance.now() - started,
    };
    const transfer: Transferable[] = [];
    for (const field of fields) {
      transfer.push(
        field.directions.buffer,
        field.positions.buffer,
        field.normals.buffer,
        field.heightsMetres.buffer,
        field.localUvs.buffer,
        field.indices.buffer,
        field.albedo.buffer,
        field.roughness.buffer,
        field.detailHeight.buffer,
      );
    }
    self.postMessage(response, { transfer });
  } catch (error) {
    postError(request, error);
  }
};

let generator: CubeTileFieldGenerator | null = null;
let activeContextKey: string | null = null;

function postError(request: CubeSurfaceRequest, error: unknown): void {
  const response: CubeErrorResponse = {
    type: "error",
    id: request.id,
    contextKey: request.contextKey,
    message: error instanceof Error ? error.message : "Cube surface worker failed",
  };
  self.postMessage(response);
}

export {};
