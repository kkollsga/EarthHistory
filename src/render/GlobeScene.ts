import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  GlobeStats,
  LayerVisibility,
  LonLat,
  SurfaceStage,
  WorldSnapshot,
} from "../data";
import {
  createPeriodMaterialResolver,
  getModernReliefPatch,
  loadPeriodMotionCatalog,
  selectSurfaceRefinementMetadata,
  surfaceRefinementTiles,
  type PaleomapIntervalResolver,
  type PaleomapMotionCatalog,
  type TemporalSurface,
  type TemporalCountryReferences,
  type ModernReliefPatch,
} from "../data";
import { BoundedLruCache } from "./cache";
import {
  CUBE_FACES,
  cubeTileBounds,
  cubeTileId,
  directionToCubeFaceUv,
  type CubeFace,
  type CubeTileKey,
} from "./cubeSphere";
import { reliefHorizonExtensionRadians } from "./cubeRelief";
import { cubeRenderResidentIds, planCubeRender } from "./cubeRenderPlan";
import {
  cubeLodLimitsForRenderState,
  describeCubeLodLeaves,
  selectCubeLod,
  type CubeLodLeaf,
} from "./cubeLod";
import {
  createCubeTileMesh,
  stitchCubeTilePositionEdges,
  updateCubeTileMeshGeometry,
} from "./cubeTileMesh";
import { cubeWorkerPoolLimit, partitionCubeWorkerRequests } from "./cubeWorkerPool";
import {
  createCubeTileFieldGenerator,
  type CubeTileFieldContext,
  type CubeTileFieldGenerator,
  type CubeTileFieldRequest,
  type CubeTileFields,
} from "./cubeTileFields";
import {
  createDrapedLineDataSegments,
  createSurfaceFieldHeightSampler,
  DEFAULT_OVERLAY_STEP_DEGREES,
  MAX_OVERLAY_CACHE_BYTES,
  type DisplayedHeightSampler,
  type DrapedLineData,
  updateDrapedLinePositions,
} from "./displayedHeight";
import {
  countryLineLengthMetres,
  createCountryRibbonBatches,
  resampleCountryRibbonHeights,
  type CountryRibbonBatchData,
  updateCountryRibbonPositions,
} from "./countryRibbons";
import { createPoleSafeShellGeometry } from "./poleSafeGeometry";
import {
  createReferenceGuideLabelPatch,
  createReferenceGuideRibbon,
  isReferenceDirectionAboveHorizon,
  REFERENCE_GUIDE_MAX_BYTES,
  REFERENCE_GUIDE_LABEL_TEXTURE_BYTES,
  REFERENCE_GUIDE_LABELS,
  REFERENCE_GUIDE_POLE_TEXTURE_BYTES,
  REFERENCE_GUIDE_POLES,
  type ReferenceGuideLabelPatchData,
  updateReferenceGuideLabelPatchPositions,
} from "./referenceGuides";
import type { CubeSurfaceRequest, CubeSurfaceResponse } from "./cube.worker";
import {
  angularDistanceDegrees,
  lonLatToVector3,
  resolveDetailMode,
  vector3ToLonLat,
} from "./math";
import {
  setInspectionLightPosition,
  type InspectionLightScratch,
} from "./inspectionLight";
import { satelliteMaterialLatitudeRadians } from "./perceptualDetail";
import { generateRegionalPatch, type RegionalPatchFields } from "./regionalPatch";
import type {
  RegionalPatchRequest,
  RegionalPatchResponse,
} from "./regional.worker";
import {
  EARTH_RADIUS_METRES,
  generateSurface,
  RELIEF_RANGE_METRES,
  reliefDisplacementScale,
  sampleSurfaceReliefMetres,
  type SurfaceDetail,
  type SurfaceFields,
  type SurfaceMode,
} from "./surface";
import type { SurfaceRequest, SurfaceResponse } from "./surface.worker";
import {
  temporalRuggednessCacheBytes,
  unwrapTemporalTileUvs,
  updateTemporalCubeTile,
} from "./temporalCube";
import { harmonizeTemporalTileNormals } from "./temporalNormals";
import { loadCaoCoordinateViewBundle, type CaoCoordinateViewBundle } from "../data/caoView";
import {
  applyCaoSlopeMaterialContrast,
  createCaoSurfaceResolver,
  type CaoSurfaceResolver,
} from "./caoSurface";

const CAO_UPDATE_CHUNK_VERTICES = 96;
const CAO_UPDATE_FRAME_BUDGET_MS = 8;
const PALEOMAP_UPDATE_FRAME_BUDGET_MS = 8;
const CUBE_MATERIAL_BUMP_SCALE = 0.009;
// A displayed frame, the latched in-flight frame, and the latest requested
// frame are the only Cao reference payloads that can participate in a publish.
const MAX_PREPARED_CAO_REFERENCE_AGES = 3;

export interface EarthHistoryDiagnostics {
  backend: "webgpu" | "webgl2";
  effectiveQuality: "high" | "low";
  detail: SurfaceDetail;
  frameTimeMs: { p50: number; p95: number; samples: number };
  generationMs: number;
  staleJobs: number;
  cacheBytes: number;
  rendererMemory: { geometries: number; textures: number };
  cameraDistance: number;
  regionalGenerationMs: number;
  transition: "idle" | "crossfade";
  temporal: {
    status: string;
    fraction: number;
    updateMs: number;
    maxChunkMs: number;
    totalUpdateMs: number;
    updateCount: number;
    vertices: number;
    resolvedVertices: number;
    fallbackVertices: number;
    stagingBytes: number;
    scratchPeakBytes: number;
  };
  cube: {
    status: string;
    requestedSnapshotId: string | null;
    requestedKey: string | null;
    displayedSnapshotId: string | null;
    displayedKey: string | null;
    visibleTiles: number;
    residentTiles: number;
    byFace: Record<string, number>;
    maxNeighborLevelDelta: number;
    generationMs: number;
    selectionMs: number;
    installMs: number;
    cacheBytes: number;
    geometryCopyBytes: number;
    gpuTextureEstimateBytes: number;
    workerRetainedBytes: number;
    evictions: number;
    queuedJobs: number;
    workerPoolSize: number;
    staleJobs: number;
  };
}

export type SpatialFocusKind = "poi" | "place" | "area";

declare global {
  interface Window {
    __earthHistoryDiagnostics?: EarthHistoryDiagnostics;
  }
}

type RequestedQuality = "auto" | "high" | "low";

interface RendererLike {
  readonly domElement: HTMLCanvasElement;
  info: {
    memory?: { geometries?: number; textures?: number };
    render?: { triangles?: number };
  };
  outputColorSpace: string;
  toneMapping: number;
  toneMappingExposure: number;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Object3D, camera: THREE.Camera): void;
  dispose(): void;
}

interface TextureSet {
  albedo: THREE.DataTexture;
  relief: THREE.DataTexture;
  roughness: THREE.DataTexture;
  clouds: THREE.DataTexture;
}

const MATERIAL_TEXTURE_BINDINGS = [
  "map",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "roughnessMap",
] as const;

export function materialsReferenceAnyTexture(
  materials: Iterable<THREE.Material | THREE.Material[]>,
  textures: ReadonlySet<THREE.Texture>,
): boolean {
  for (const materialOrArray of materials) {
    const materialList = Array.isArray(materialOrArray) ? materialOrArray : [materialOrArray];
    for (const material of materialList) {
      const bindings = material as THREE.Material & Partial<Record<
        (typeof MATERIAL_TEXTURE_BINDINGS)[number],
        THREE.Texture | null
      >>;
      if (MATERIAL_TEXTURE_BINDINGS.some((key) => {
        const texture = bindings[key];
        return texture !== null && texture !== undefined && textures.has(texture);
      })) return true;
    }
  }
  return false;
}

/** Workers need one native control frame, not the main-thread temporal catalogs. */
function workerSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  const { temporalSurface: _temporalSurface, temporalReferences: _temporalReferences, ...rest } =
    snapshot;
  return rest;
}

class SurfaceWorkerClient {
  private worker: Worker | null = null;
  private rejectCurrent: ((reason: Error) => void) | null = null;
  private nextId = 0;
  staleJobs = 0;

  request(
    snapshot: WorldSnapshot,
    detail: SurfaceDetail,
    mode: SurfaceMode,
  ): Promise<SurfaceFields> {
    this.cancel();
    const id = ++this.nextId;
    if (typeof Worker === "undefined") {
      return Promise.resolve(generateSurface(snapshot, detail, undefined, mode));
    }

    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(new URL("./surface.worker.ts", import.meta.url), {
          type: "module",
          name: "earthhistory-surface",
        });
        this.worker = worker;
        this.rejectCurrent = reject;
        worker.onmessage = (event: MessageEvent<SurfaceResponse>) => {
          if (event.data.id !== id || this.worker !== worker) {
            this.staleJobs++;
            return;
          }
          this.worker = null;
          this.rejectCurrent = null;
          worker.terminate();
          resolve(event.data.fields);
        };
        worker.onerror = (event) => {
          if (this.worker === worker) {
            this.worker = null;
            this.rejectCurrent = null;
          }
          worker.terminate();
          reject(new Error(event.message || "Surface worker failed"));
        };
        const request: SurfaceRequest = { id, snapshot: workerSnapshot(snapshot), detail, mode };
        worker.postMessage(request);
      } catch {
        this.worker = null;
        this.rejectCurrent = null;
        resolve(generateSurface(snapshot, detail, undefined, mode));
      }
    });
  }

  cancel(): void {
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
      this.staleJobs++;
      this.rejectCurrent?.(new Error("Surface request superseded"));
      this.rejectCurrent = null;
    }
  }

  dispose(): void {
    this.cancel();
  }
}

class RegionalWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<
    number,
    { resolve: (fields: RegionalPatchFields) => void; reject: (reason: Error) => void }
  >();
  private nextId = 0;
  staleJobs = 0;

  warm(): void {
    this.ensureWorker();
  }

  private ensureWorker(): Worker | null {
    if (this.worker !== null) return this.worker;
    if (typeof Worker === "undefined") return null;
    try {
      const worker = new Worker(new URL("./regional.worker.ts", import.meta.url), {
        type: "module",
        name: "earthhistory-regional-relief",
      });
      worker.onmessage = (event: MessageEvent<RegionalPatchResponse>) => {
        const pending = this.pending.get(event.data.id);
        if (pending === undefined) return;
        this.pending.delete(event.data.id);
        pending.resolve(event.data.fields);
      };
      worker.onerror = (event) => {
        const error = new Error(event.message || "Regional relief worker failed");
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      };
      this.worker = worker;
      return worker;
    } catch {
      return null;
    }
  }

  request(
    snapshot: WorldSnapshot,
    center: LonLat,
    mode: SurfaceMode,
    sourcePatch?: ModernReliefPatch,
  ): Promise<RegionalPatchFields> {
    this.cancel();
    const id = ++this.nextId;
    const worker = this.ensureWorker();
    if (worker === null) {
      return Promise.resolve(
        generateRegionalPatch(
          snapshot,
          center,
          mode,
          sourcePatch === undefined ? 128 : 192,
          24,
          sourcePatch,
        ),
      );
    }
    return new Promise((resolve, reject) => {
      try {
        this.pending.set(id, { resolve, reject });
        const request: RegionalPatchRequest = {
          id,
          snapshot: workerSnapshot(snapshot),
          center,
          mode,
          sourcePatch,
        };
        worker.postMessage(request);
      } catch {
        this.pending.delete(id);
        resolve(
          generateRegionalPatch(
            snapshot,
            center,
            mode,
            sourcePatch === undefined ? 128 : 192,
            24,
            sourcePatch,
          ),
        );
      }
    });
  }

  cancel(): void {
    if (this.pending.size === 0) return;
    this.staleJobs += this.pending.size;
    for (const pending of this.pending.values()) {
      pending.reject(new Error("Regional relief request superseded"));
    }
    this.pending.clear();
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}

interface CubeWorkerResult {
  fields: CubeTileFields[];
  retainedBytes: number;
  generationMs: number;
}

class CubeWorkerSlot {
  private worker: Worker | null = null;
  private pending: {
    id: number;
    resolve: (result: CubeSurfaceResponse) => void;
    reject: (error: Error) => void;
  } | null = null;
  private nextId = 0;
  private contextKey: string | null = null;

  private ensureWorker(): Worker {
    if (this.worker !== null) return this.worker;
    const worker = new Worker(new URL("./cube.worker.ts", import.meta.url), {
      type: "module",
      name: "earthhistory-cube-surface",
    });
    worker.onmessage = (event: MessageEvent<CubeSurfaceResponse>) => {
      if (this.pending?.id !== event.data.id) return;
      const pending = this.pending;
      this.pending = null;
      if (event.data.type === "error") pending.reject(new Error(event.data.message));
      else pending.resolve(event.data);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "Cube surface worker failed");
      this.pending?.reject(error);
      this.pending = null;
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      this.contextKey = null;
    };
    this.worker = worker;
    this.contextKey = null;
    return worker;
  }

  private exchange(request: CubeSurfaceRequest): Promise<CubeSurfaceResponse> {
    if (this.pending !== null) throw new Error("Cube worker slot already has an active request");
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.pending = { id: request.id, resolve, reject };
      try {
        worker.postMessage(request);
      } catch (error) {
        this.pending = null;
        reject(error);
      }
    });
  }

  async request(
    contextKey: string,
    context: CubeTileFieldContext,
    requests: CubeTileFieldRequest[],
  ): Promise<CubeWorkerResult> {
    if (this.contextKey !== contextKey) {
      const initialize: CubeSurfaceRequest = {
        type: "initialize",
        id: ++this.nextId,
        contextKey,
        context,
      };
      const ready = await this.exchange(initialize);
      if (ready.type !== "ready") throw new Error("Cube worker initialization failed");
      this.contextKey = contextKey;
    }
    const generate: CubeSurfaceRequest = {
      type: "generate",
      id: ++this.nextId,
      contextKey,
      requests,
    };
    const response = await this.exchange(generate);
    if (response.type !== "fields") throw new Error("Cube worker returned no fields");
    return response;
  }

  cancel(error: Error): void {
    this.pending?.reject(error);
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    this.contextKey = null;
  }

  dispose(): void {
    this.cancel(new Error("Cube surface worker disposed"));
  }
}

class CubeWorkerClient {
  private readonly poolLimit = cubeWorkerPoolLimit(
    typeof navigator === "undefined" ? undefined : navigator.hardwareConcurrency,
  );
  private readonly slots: CubeWorkerSlot[] = [];
  private active: {
    epoch: number;
    tileCount: number;
    reject: (error: Error) => void;
  } | null = null;
  private epoch = 0;
  private contextKey: string | null = null;
  private fallbackGenerator: CubeTileFieldGenerator | null = null;
  staleJobs = 0;

  get queuedJobs(): number {
    return this.active?.tileCount ?? 0;
  }

  get workerPoolSize(): number {
    return this.slots.length;
  }

  get maxConcurrency(): number {
    return this.poolLimit;
  }

  warm(): void {
    if (typeof Worker === "undefined" || this.slots.length > 0) return;
    this.slots.push(new CubeWorkerSlot());
  }

  private slot(index: number): CubeWorkerSlot {
    while (this.slots.length <= index) this.slots.push(new CubeWorkerSlot());
    return this.slots[index];
  }

  request(
    contextKey: string,
    context: CubeTileFieldContext,
    requests: CubeTileFieldRequest[],
    concurrency: number = this.poolLimit,
  ): Promise<CubeWorkerResult> {
    if (this.active !== null) {
      return Promise.reject(new Error("Cube worker pool already has an active request"));
    }
    const epoch = this.epoch;
    const started = performance.now();
    return new Promise((resolve, reject) => {
      this.active = { epoch, tileCount: requests.length, reject };
      const finish = (result: CubeWorkerResult) => {
        if (this.active?.epoch !== epoch) return;
        this.active = null;
        resolve(result);
      };
      const fail = (error: unknown) => {
        if (this.active?.epoch !== epoch) return;
        this.active = null;
        this.epoch++;
        const failure = error instanceof Error ? error : new Error("Cube surface worker failed");
        for (const slot of this.slots) slot.cancel(failure);
        this.slots.length = 0;
        this.contextKey = null;
        this.fallbackGenerator = null;
        reject(failure);
      };

      if (typeof Worker === "undefined") {
        try {
          if (this.contextKey !== contextKey || this.fallbackGenerator === null) {
            this.fallbackGenerator = createCubeTileFieldGenerator(context);
            this.contextKey = contextKey;
          }
          finish({
            fields: requests.map((request) => this.fallbackGenerator!.generate(request)),
            retainedBytes: this.fallbackGenerator.retainedBytes,
            generationMs: performance.now() - started,
          });
        } catch (error) {
          fail(error);
        }
        return;
      }

      const groups = partitionCubeWorkerRequests(
        requests,
        Math.min(this.poolLimit, concurrency),
      );
      void Promise.all(groups.map((group, index) =>
        this.slot(index).request(contextKey, context, group)
      )).then((results) => {
        finish({
          fields: results.flatMap((result) => result.fields),
          retainedBytes: results.reduce((sum, result) => sum + result.retainedBytes, 0),
          // Generation occurs concurrently; the longest slot is the critical
          // worker path while outer round-trip diagnostics retain wall time.
          generationMs: Math.max(...results.map((result) => result.generationMs)),
        });
      }, fail);
    });
  }

  cancel(): void {
    const error = new Error("Cube surface request superseded");
    if (this.active !== null) {
      this.staleJobs += this.active.tileCount;
      const active = this.active;
      this.active = null;
      this.epoch++;
      active.reject(error);
    }
    for (const slot of this.slots) slot.cancel(error);
    this.slots.length = 0;
    this.contextKey = null;
    this.fallbackGenerator = null;
  }

  dispose(): void {
    const error = new Error("Cube surface worker disposed");
    if (this.active !== null) {
      const active = this.active;
      this.active = null;
      this.epoch++;
      active.reject(error);
    }
    for (const slot of this.slots) slot.dispose();
    this.slots.length = 0;
    this.contextKey = null;
    this.fallbackGenerator = null;
  }
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

export function requestedRendererBackend(search: string): "auto" | "webgl2" {
  return new URLSearchParams(search).get("renderer") === "webgl2" ? "webgl2" : "auto";
}

function createRenderer(): Promise<{
  renderer: RendererLike;
  backend: EarthHistoryDiagnostics["backend"];
}> {
  return (async () => {
    const request = requestedRendererBackend(window.location.search);
    if (request === "auto" && "gpu" in navigator) {
      try {
        const { WebGPURenderer } = await import("three/webgpu");
        const renderer = new WebGPURenderer({
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        });
        await renderer.init();
        const backendState = renderer.backend as unknown as {
          isWebGPUBackend?: boolean;
          isWebGLBackend?: boolean;
        };
        const backend = backendState.isWebGPUBackend ? "webgpu" : "webgl2";
        return { renderer: renderer as unknown as RendererLike, backend };
      } catch (error) {
        console.info("WebGPU initialization failed; using the WebGL2 renderer.", error);
      }
    }

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2", {
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    if (context === null) throw new Error("This view requires WebGPU or WebGL 2.");
    const renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    return { renderer, backend: "webgl2" as const };
  })();
}

function createTexture(
  data: Uint8Array,
  width: number,
  height: number,
  color = false,
): THREE.DataTexture {
  const texture = new THREE.DataTexture(
    data,
    width,
    height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.flipY = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSatelliteMaterialTextures(): {
  albedo: THREE.DataTexture;
  detail: THREE.DataTexture;
} {
  const width = 512;
  const height = 256;
  const albedo = new Uint8Array(width * height * 4);
  const detail = new Uint8Array(width * height * 4);
  const hashNoise = (x: number, y: number, seed: number): number => {
    let value = Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ seed;
    value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
    value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
    return ((value ^ (value >>> 15)) >>> 0) / 0x7fffffff - 1;
  };
  const valueNoise = (u: number, v: number, cellsX: number, seed: number): number => {
    const cellsY = Math.max(2, Math.round(cellsX / 2));
    const fx = u * cellsX;
    const fy = v * cellsY;
    const x0 = Math.floor(fx);
    const y0 = Math.min(cellsY - 1, Math.floor(fy));
    const x1 = (x0 + 1) % cellsX;
    const y1 = Math.min(cellsY, y0 + 1);
    const tx0 = fx - x0;
    const ty0 = fy - y0;
    const tx = tx0 * tx0 * (3 - 2 * tx0);
    const ty = ty0 * ty0 * (3 - 2 * ty0);
    const west = (x0 % cellsX + cellsX) % cellsX;
    const north = hashNoise(west, y0, seed) * (1 - tx) + hashNoise(x1, y0, seed) * tx;
    const south = hashNoise(west, y1, seed) * (1 - tx) + hashNoise(x1, y1, seed) * tx;
    return north * (1 - ty) + south * ty;
  };
  for (let y = 0; y < height; y += 1) {
    const latitude = satelliteMaterialLatitudeRadians(y, height);
    const v = y / (height - 1);
    const polarFade = Math.sqrt(Math.max(0, Math.cos(latitude)));
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      let coherent = 0;
      let broad = 0;
      let amplitude = 1;
      let weight = 0;
      let broadWeight = 0;
      const frequencies = [4, 9, 18, 36] as const;
      for (let octave = 0; octave < frequencies.length; octave += 1) {
        const band = valueNoise(u, v, frequencies[octave], 0x5a17c9 + octave * 7919);
        coherent += band * amplitude;
        weight += amplitude;
        if (octave < 3) {
          broad += band * amplitude;
          broadWeight += amplitude;
        }
        amplitude *= 0.48;
      }
      coherent = coherent / weight * polarFade;
      broad = broad / broadWeight * polarFade;
      const detailValue = Math.round(THREE.MathUtils.clamp(
        128 + coherent * 62,
        66,
        190,
      ));
      const albedoValue = Math.round(THREE.MathUtils.clamp(
        236 + broad * 25,
        211,
        255,
      ));
      const offset = (y * width + x) * 4;
      detail[offset] = detailValue;
      detail[offset + 1] = detailValue;
      detail[offset + 2] = detailValue;
      detail[offset + 3] = 255;
      albedo[offset] = albedoValue;
      albedo[offset + 1] = albedoValue;
      albedo[offset + 2] = albedoValue;
      albedo[offset + 3] = 255;
    }
  }
  return {
    albedo: createTexture(albedo, width, height, true),
    detail: createTexture(detail, width, height),
  };
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
      if (!(child instanceof THREE.Sprite)) child.geometry?.dispose();
      const ownedTexture = child.userData.ownedTexture as THREE.Texture | undefined;
      ownedTexture?.dispose();
      disposeMaterial(child.material);
    }
  }
}

function createStarField(): THREE.Points {
  const count = 950;
  const positions = new Float32Array(count * 3);
  let state = 0x51f15e;
  const next = () => {
    state = Math.imul(state ^ (state >>> 15), 1 | state);
    state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    const z = next() * 2 - 1;
    const theta = next() * Math.PI * 2;
    const radius = 11 + next() * 4;
    const r = Math.sqrt(1 - z * z);
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = z * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      color: 0x8ca1a8,
      size: 0.013,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.64,
      depthWrite: false,
    }),
  );
}

function createMarkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Unable to create marker texture");
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.34, "rgba(255, 255, 255, 0.98)");
  gradient.addColorStop(0.58, "rgba(255, 255, 255, 0.4)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true;
  return texture;
}

function createGuideLabelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Unable to create guide-label texture");
  context.font = "600 36px system-ui, sans-serif";
  context.letterSpacing = "1px";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(1, 8, 10, 0.95)";
  context.shadowBlur = 5;
  context.fillStyle = "rgba(188, 216, 211, 0.9)";
  context.fillText(text.toUpperCase(), 192, 32, 360);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.premultiplyAlpha = true;
  return texture;
}

function createPoleMarkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Unable to create pole-marker texture");
  context.strokeStyle = "rgba(220, 242, 237, 0.96)";
  context.lineWidth = 5;
  context.shadowColor = "rgba(1, 8, 10, 0.95)";
  context.shadowBlur = 7;
  context.beginPath();
  context.arc(48, 48, 20, 0, Math.PI * 2);
  context.moveTo(48, 8);
  context.lineTo(48, 33);
  context.moveTo(48, 63);
  context.lineTo(48, 88);
  context.moveTo(8, 48);
  context.lineTo(33, 48);
  context.moveTo(63, 48);
  context.lineTo(88, 48);
  context.stroke();
  context.fillStyle = "rgba(238, 251, 247, 1)";
  context.beginPath();
  context.arc(48, 48, 5, 0, Math.PI * 2);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.premultiplyAlpha = true;
  return texture;
}

function createAtmosphere(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1.006, 128, 64);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const sun = new THREE.Vector3(-0.61, 0.38, 0.69).normalize();
  const normal = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    normal.fromBufferAttribute(positions, index).normalize();
    const daylight = THREE.MathUtils.clamp(normal.dot(sun) * 0.48 + 0.52, 0.08, 1);
    colors[index * 3] = 0.08 * daylight;
    colors[index * 3 + 1] = 0.3 * daylight;
    colors[index * 3 + 2] = 0.64 * daylight;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.16,
  });
  const atmosphere = new THREE.Mesh(geometry, material);
  atmosphere.renderOrder = 1;
  return atmosphere;
}

function cubeKeyContains(ancestor: CubeTileKey, descendant: CubeTileKey): boolean {
  if (ancestor.face !== descendant.face || ancestor.level > descendant.level) return false;
  const divisor = 2 ** (descendant.level - ancestor.level);
  return Math.floor(descendant.x / divisor) === ancestor.x &&
    Math.floor(descendant.y / divisor) === ancestor.y;
}

function sameCubeEdgeFlags(
  left: Readonly<{ north: boolean; east: boolean; south: boolean; west: boolean }> | undefined,
  right: Readonly<{ north: boolean; east: boolean; south: boolean; west: boolean }>,
): boolean {
  return left !== undefined && left.north === right.north && left.east === right.east &&
    left.south === right.south && left.west === right.west;
}

function buildImpactGroup(): THREE.Group {
  const group = new THREE.Group();
  const impactor = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 40, 24),
    new THREE.MeshStandardMaterial({
      color: 0x4c332c,
      emissive: 0xff4e16,
      emissiveIntensity: 1.1,
      roughness: 0.9,
    }),
  );
  impactor.position.set(1.48, 0.33, 0.34);
  group.add(impactor);
  const light = new THREE.PointLight(0xff5d28, 2.4, 4);
  light.position.copy(impactor.position);
  group.add(light);

  const debrisPositions = new Float32Array(150 * 3);
  for (let index = 0; index < 150; index++) {
    const angle = index * 2.399963;
    const spread = 1.08 + (index % 17) * 0.025;
    debrisPositions[index * 3] = Math.cos(angle) * spread;
    debrisPositions[index * 3 + 1] = Math.sin(angle * 1.8) * 0.16;
    debrisPositions[index * 3 + 2] = Math.sin(angle) * spread;
  }
  const debrisGeometry = new THREE.BufferGeometry();
  debrisGeometry.setAttribute("position", new THREE.BufferAttribute(debrisPositions, 3));
  group.add(
    new THREE.Points(
      debrisGeometry,
      new THREE.PointsMaterial({
        color: 0xff8b45,
        size: 0.025,
        transparent: true,
        opacity: 0.74,
        depthWrite: false,
      }),
    ),
  );
  group.visible = false;
  return group;
}

function initialEffectiveQuality(requested: RequestedQuality): "high" | "low" {
  if (requested !== "auto") return requested;
  return navigator.hardwareConcurrency >= 8 ? "high" : "low";
}

export class GlobeScene {
  static async create(
    mount: HTMLDivElement,
    onSelectPoi: (id: string) => void,
    onSelectSurface: (coordinates: LonLat) => void,
    onStats?: (stats: GlobeStats) => void,
    requestedQuality: RequestedQuality = "auto",
  ): Promise<GlobeScene> {
    const initialized = await createRenderer();
    return new GlobeScene(
      mount,
      initialized.renderer,
      initialized.backend,
      onSelectPoi,
      onSelectSurface,
      onStats,
      requestedQuality,
    );
  }

  readonly backend: EarthHistoryDiagnostics["backend"];
  private readonly mount: HTMLDivElement;
  private readonly renderer: RendererLike;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.03, 50);
  private readonly controls: OrbitControls;
  private readonly globeGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();
  private readonly impactGroup = buildImpactGroup();
  private readonly sunLight = new THREE.DirectionalLight(0xfff4df, 3.2);
  private readonly inspectionLightScratch: InspectionLightScratch = {
    view: new THREE.Vector3(),
    right: new THREE.Vector3(),
    upward: new THREE.Vector3(),
  };
  private readonly guideCameraDirection = new THREE.Vector3();
  private readonly guideInverseGlobeQuaternion = new THREE.Quaternion();
  private readonly markerWorldPosition = new THREE.Vector3();
  private readonly markerWorldScale = new THREE.Vector3();
  private readonly atmosphereMesh: THREE.Mesh;
  private readonly worker = new SurfaceWorkerClient();
  private readonly regionalWorker = new RegionalWorkerClient();
  private readonly cubeWorker = new CubeWorkerClient();
  private readonly cache = new BoundedLruCache<SurfaceFields>(4, 20 * 1024 * 1024);
  private readonly regionalCache = new BoundedLruCache<RegionalPatchFields>(
    3,
    8 * 1024 * 1024,
  );
  private readonly cubeCache = new BoundedLruCache<CubeTileFields>(160, 48 * 1024 * 1024);
  private readonly raycaster = new THREE.Raycaster();
  private readonly markerTexture = createMarkerTexture();
  private readonly satelliteMaterialTextures = createSatelliteMaterialTextures();
  private readonly pointer = new THREE.Vector2();
  private readonly frameTimes: number[] = [];
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private resizeObserver: ResizeObserver;
  private globeMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private cloudMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private textures: TextureSet | null = null;
  private readonly retiredTextureSets = new Set<TextureSet>();
  private activeSurfaceFields: SurfaceFields | null = null;
  private activeSurfaceDetail: SurfaceDetail = "coarse";
  private displayedSnapshotId: string | null = null;
  private surfaceTransition: {
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
    textures: TextureSet;
    started: number;
  } | null = null;
  private cubeSurfaceGroup: THREE.Group | null = null;
  private cubeDisplayedKey: string | null = null;
  private cubeDisplayedSnapshotId: string | null = null;
  private cubeContext: CubeTileFieldContext | null = null;
  private cubeContextKey: string | null = null;
  private displayedHeightSampler: DisplayedHeightSampler | null = null;
  private countryRibbonCache: {
    surfaceKey: string;
    batches: CountryRibbonBatchData[];
  } | null = null;
  private displayedHeightSamplerKey: string | null = null;
  private cubeRootFields = new Map<CubeFace, CubeTileFields>();
  private cubeDesiredLeaves: CubeLodLeaf[] = [];
  private cubePreviousLeafKeys: CubeTileKey[] = [];
  private cubeRefinementRunning = false;
  private cubeSelectionSerial = 0;
  private cubeStaleTileJobs = 0;
  private cubeSelectionMs = 0;
  private cubeInstallMs = 0;
  private cubeMaxNeighborLevelDelta = 0;
  private readonly cubeLastSelectionDirection = new THREE.Vector3(Number.NaN, 0, 0);
  private cubeLastSelectionDistance = Number.NaN;
  private cubeLastSelectionViewportHeight = 0;
  private cubeLastSelectionAt = 0;
  private cubeTransition: { group: THREE.Group; started: number } | null = null;
  private cubeHeldVisibleGroup: THREE.Group | null = null;
  private cubeHeldVisibleSnapshotId: string | null = null;
  private cubeRequestSerial = 0;
  private cubeGenerationMs = 0;
  private snapshot: WorldSnapshot | null = null;
  private temporalSurface: TemporalSurface | null = null;
  private temporalEnvironment: WorldSnapshot["environment"] | null = null;
  private temporalCatalog: PaleomapMotionCatalog | null = null;
  private temporalResolver: PaleomapIntervalResolver | null = null;
  private temporalInFlight: {
    surface: TemporalSurface;
    environment: WorldSnapshot["environment"];
    resolver: PaleomapIntervalResolver;
    detail: SurfaceDetail;
  } | null = null;
  private temporalLoadSerial = 0;
  private temporalUpdateHandle: number | null = null;
  private temporalUpdateMs = 0;
  private temporalUpdateMaxChunkMs = 0;
  private temporalUpdateCount = 0;
  private temporalUpdateVertices = 0;
  private temporalGeometryRevision = 0;
  private temporalResolvedVertices = 0;
  private temporalFallbackVertices = 0;
  private temporalUpdateJobKey: string | null = null;
  private temporalUpdateTotalMs = 0;
  private temporalScratchPeakBytes = 0;
  private temporalCountries: TemporalCountryReferences | undefined;
  private readonly preparedCaoCountries = new Map<string, TemporalCountryReferences>();
  private temporalPoiCoordinates: Readonly<Record<string, LonLat>> | undefined;
  private temporalPoiRequestedAgeMa: number | null = null;
  private readonly preparedCaoPois = new Map<string, Readonly<Record<string, LonLat>>>();
  private temporalCountryHandle: number | null = null;
  private temporalCountryPreviewHandle: number | null = null;
  private temporalSettleHandle: number | null = null;
  private temporalSettled = false;
  private caoBundle: CaoCoordinateViewBundle | null = null;
  private caoSurfaceResolver: CaoSurfaceResolver | null = null;
  private caoInFlight: {
    surface: TemporalSurface;
    resolver: CaoSurfaceResolver;
    preview: boolean;
  } | null = null;
  private caoLoadSerial = 0;
  private caoRidgeVertices = 0;
  private caoTrenchVertices = 0;
  private layers: LayerVisibility = {
    clouds: false,
    borders: false,
    guides: false,
    tectonics: false,
    rivers: false,
  };
  private selectedPoiId: string | null = null;
  private requestedQuality: RequestedQuality;
  private effectiveQuality: "high" | "low";
  private detail: SurfaceDetail = "coarse";
  private requestSerial = 0;
  private frameHandle = 0;
  private overlayRebuildHandle: number | null = null;
  private cameraRefreshHandle: number | null = null;
  private cameraInteractionActive = false;
  private disposed = false;
  private previousFrame = performance.now();
  private lastStatsAt = 0;
  private generationMs = 0;
  private regionalGenerationMs = 0;
  private currentRivers: LonLat[][] = [];
  private regionalPatch: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> | null =
    null;
  private regionalPatchFields: RegionalPatchFields | null = null;
  private regionalRequestSerial = 0;
  private verticalExaggeration = 8;
  private reliefScalePending = false;
  private reliefRangeMetres = RELIEF_RANGE_METRES;
  private reliefBiasMetres = 0;
  private surfaceMode: SurfaceMode = "surface";
  private autoRotate = true;
  private animationStarted = performance.now();
  private lastReportedCameraDistance = -1;
  private focusAnimation: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromDistance: number;
    toDistance: number;
    started: number;
  } | null = null;
  private pointerDown: { x: number; y: number } | null = null;
  private onSelectPoi: (id: string) => void;
  private onSelectSurface: (coordinates: LonLat) => void;
  private onStats?: (stats: GlobeStats) => void;

  private constructor(
    mount: HTMLDivElement,
    renderer: RendererLike,
    backend: EarthHistoryDiagnostics["backend"],
    onSelectPoi: (id: string) => void,
    onSelectSurface: (coordinates: LonLat) => void,
    onStats: ((stats: GlobeStats) => void) | undefined,
    requestedQuality: RequestedQuality,
  ) {
    this.mount = mount;
    this.renderer = renderer;
    this.backend = backend;
    this.onSelectPoi = onSelectPoi;
    this.onSelectSurface = onSelectSurface;
    this.onStats = onStats;
    this.requestedQuality = requestedQuality;
    this.effectiveQuality = initialEffectiveQuality(requestedQuality);

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setClearColor(0x010507, 1);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional Earth");
    renderer.domElement.dataset.rendererBackend = backend;
    renderer.domElement.dataset.focusKind = "none";
    mount.appendChild(renderer.domElement);

    this.scene.background = new THREE.Color(0x010507);
    this.camera.position.set(2.41, 1.2, 2.51);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.42;
    this.controls.zoomSpeed = 0.65;
    this.controls.minDistance = 1.15;
    this.controls.maxDistance = 6.2;
    this.controls.autoRotateSpeed = 0.32;
    this.atmosphereMesh = createAtmosphere();

    this.globeMesh = new THREE.Mesh(
      this.makeGlobeGeometry(),
      new THREE.MeshPhysicalMaterial({
        color: 0x0b4964,
        roughness: 0.82,
        metalness: 0,
        clearcoat: 0.08,
        clearcoatRoughness: 0.5,
        ior: 1.37,
        specularIntensity: 0.3,
        displacementScale: 0,
        displacementBias: 0,
      }),
    );
    this.globeMesh.castShadow = true;
    this.globeMesh.receiveShadow = true;
    this.globeMesh.renderOrder = 0;

    this.cloudMesh = new THREE.Mesh(
      this.makeCloudGeometry(),
      new THREE.MeshStandardMaterial({
        color: 0xdde7e8,
        transparent: true,
        opacity: 0.34,
        roughness: 0.94,
        depthWrite: false,
        alphaTest: 0.025,
      }),
    );
    this.cloudMesh.renderOrder = 2;

    this.globeGroup.rotation.z = THREE.MathUtils.degToRad(-13.5);
    this.globeGroup.add(this.globeMesh, this.cloudMesh, this.overlayGroup, this.markerGroup);
    this.scene.add(
      createStarField(),
      this.atmosphereMesh,
      this.globeGroup,
      this.impactGroup,
    );
    // Preserve a readable nightside while allowing source-derived relief
    // normals and material bump to cast satellite-like tonal structure.
    this.scene.add(new THREE.HemisphereLight(0xd5dde0, 0x6d6555, 0.8));
    this.updateInspectionLight();
    this.scene.add(this.sunLight);
    const fill = new THREE.DirectionalLight(0x9fb7bf, 0.22);
    fill.position.set(-3, 1, -4);
    this.scene.add(fill);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(mount);
    this.controls.addEventListener("start", this.handleControlsStart);
    this.controls.addEventListener("end", this.handleControlsEnd);
    renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.reducedMotion.addEventListener("change", this.handleMotionPreference);
    this.regionalWorker.warm();
    this.cubeWorker.warm();
    this.resize();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  setCallbacks(
    onSelectPoi: (id: string) => void,
    onSelectSurface: (coordinates: LonLat) => void,
    onStats?: (stats: GlobeStats) => void,
  ): void {
    this.onSelectPoi = onSelectPoi;
    this.onSelectSurface = onSelectSurface;
    this.onStats = onStats;
  }

  setSnapshot(snapshot: WorldSnapshot | null): void {
    if (this.snapshot === snapshot) return;
    this.snapshot = snapshot;
    this.temporalSurface = snapshot?.temporalSurface ?? null;
    this.temporalEnvironment = snapshot?.environment ?? null;
    this.temporalResolver = null;
    this.temporalInFlight = null;
    this.caoSurfaceResolver = null;
    this.caoInFlight = null;
    this.caoLoadSerial++;
    if (snapshot?.periodCoordinateView?.id !== "cao-2024-v2.4") {
      const dataset = this.renderer.domElement.dataset;
      delete dataset.periodCoordinateView;
      delete dataset.periodCoordinateStatus;
      delete dataset.periodCoordinateRequestedAgeMa;
      delete dataset.periodCoordinateDisplayedAgeMa;
      delete dataset.periodCoordinateResolvedVertices;
      delete dataset.periodCoordinateUnsupportedVertices;
      delete dataset.caoBoundaryDisplayedAgeMa;
      delete dataset.caoBoundaryEvidence;
      delete dataset.caoBoundarySegments;
      delete dataset.caoBoundaryUnsupportedSegments;
      delete dataset.caoBoundaryPoints;
      delete dataset.caoRidgeVertices;
      delete dataset.caoTrenchVertices;
      delete dataset.temporalPoiRequestedAgeMa;
      delete dataset.temporalPoiDisplayedAgeMa;
      delete dataset.temporalPoiDisplayedCount;
      delete dataset.temporalPoiDisplayStatus;
      delete dataset.temporalPoiPositionSignature;
      delete dataset.periodCoordinateStagedAgeMa;
      delete dataset.periodCoordinateWaitingForReferences;
      delete dataset.periodCoordinateDetail;
      delete dataset.preparedCaoCountryAges;
      delete dataset.preparedCaoPoiAges;
      delete dataset.preparedCaoCountryPoints;
      delete dataset.preparedCaoPoiPoints;
      delete dataset.preparedCaoReferenceAgeLimit;
    } else if (snapshot.temporalSurface !== undefined) {
      this.renderer.domElement.dataset.periodCoordinateRequestedAgeMa =
        snapshot.temporalSurface.requestedAgeMa.toFixed(6);
    }
    this.temporalCountries = undefined;
    this.preparedCaoCountries.clear();
    this.temporalPoiCoordinates = undefined;
    this.temporalPoiRequestedAgeMa = null;
    this.preparedCaoPois.clear();
    this.temporalLoadSerial++;
    if (this.temporalUpdateHandle !== null) {
      cancelAnimationFrame(this.temporalUpdateHandle);
      this.temporalUpdateHandle = null;
    }
    if (this.temporalSettleHandle !== null) {
      window.clearTimeout(this.temporalSettleHandle);
      this.temporalSettleHandle = null;
    }
    this.temporalSettled = snapshot?.temporalSurface?.exactEndpoint ?? false;
    if (snapshot === null) {
      this.displayedHeightSampler = null;
      this.displayedHeightSamplerKey = null;
      delete this.renderer.domElement.dataset.overlayDrapeSurfaceKey;
    }
    this.currentRivers = [];
    this.regionalRequestSerial++;
    this.regionalWorker.cancel();
    this.cubeWorker.cancel();
    this.invalidateCubeRefinement();
    this.removeRegionalPatch();
    this.rebuildOverlays();
    const stage = snapshot?.environment.stage;
    this.impactGroup.visible = stage === "giant-impact";
    this.updateAtmosphere(stage, snapshot?.environment.atmosphereOpacity ?? 1);
    if (snapshot !== null) void this.loadSurface();
    if (snapshot?.periodCoordinateView?.id === "cao-2024-v2.4" && snapshot.temporalSurface !== undefined) {
      void this.prepareCaoSurface(snapshot.periodCoordinateView.id);
    } else if (snapshot?.temporalSurface !== undefined) {
      void this.prepareTemporalResolver(snapshot.temporalSurface.intervalId);
    } else {
      this.renderer.domElement.dataset.temporalStatus = snapshot === null ? "idle" : "exact";
    }
  }

  setTemporalFraction(
    fraction: number,
    requestedAgeMa: number,
    environment: WorldSnapshot["environment"],
  ): void {
    const temporal = this.temporalSurface;
    if (temporal === null) return;
    this.temporalSurface = {
      ...temporal,
      fraction: THREE.MathUtils.clamp(fraction, 0, 1),
      requestedAgeMa,
      exactEndpoint: fraction <= 0 || fraction >= 1,
      evidence: fraction <= 0 || fraction >= 1 ? "model-output" : "interpolation",
    };
    this.temporalEnvironment = environment;
    if (this.temporalSettleHandle !== null) window.clearTimeout(this.temporalSettleHandle);
    this.renderer.domElement.dataset.temporalFraction = this.temporalSurface.fraction.toFixed(6);
    this.renderer.domElement.dataset.temporalRequestedAgeMa = requestedAgeMa.toFixed(6);
    this.updateAtmosphere(environment.stage, environment.atmosphereOpacity ?? 1);
    if (this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4") {
      this.temporalSettled = false;
      this.temporalSettleHandle = window.setTimeout(() => {
        this.temporalSettleHandle = null;
        if (this.disposed || this.temporalSurface?.requestedAgeMa !== requestedAgeMa) return;
        this.temporalSettled = true;
        this.scheduleCubeRefinement();
      }, 180);
      if (this.cubeSurfaceGroup !== null) this.scheduleCubeRefinement();
      this.renderer.domElement.dataset.periodCoordinateRequestedAgeMa = requestedAgeMa.toFixed(6);
      if (this.caoBundle === null) {
        void this.prepareCaoSurface("cao-2024-v2.4");
        return;
      }
      this.caoSurfaceResolver = null;
      this.scheduleCaoSurfaceUpdate();
      return;
    }
    if (this.temporalSurface.exactEndpoint) {
      this.temporalSettled = true;
      if (this.temporalCatalog === null) {
        void this.prepareTemporalResolver(temporal.intervalId);
      } else {
        this.temporalResolver = createPeriodMaterialResolver(this.temporalCatalog, requestedAgeMa);
        this.scheduleTemporalUpdate();
      }
      return;
    }
    this.temporalSettled = false;
    this.temporalSettleHandle = window.setTimeout(() => {
      this.temporalSettleHandle = null;
      if (this.disposed || this.temporalSurface?.requestedAgeMa !== requestedAgeMa) return;
      this.temporalSettled = true;
      this.scheduleCubeRefinement();
    }, 180);
    if (this.cubeSurfaceGroup !== null) this.scheduleCubeRefinement();
    if (this.temporalCatalog === null) {
      void this.prepareTemporalResolver(temporal.intervalId);
      return;
    }
    this.temporalResolver = createPeriodMaterialResolver(this.temporalCatalog, requestedAgeMa);
    this.scheduleTemporalUpdate();
  }

  setTemporalCountries(references: TemporalCountryReferences | undefined): void {
    if (references === undefined) return;
    const dataset = this.renderer.domElement.dataset;
    const ageKey = references.requestedAgeMa.toFixed(6);
    dataset.temporalCountryRequestedAgeMa = ageKey;
    dataset.temporalCountrySourceAgesMa = references.sourceAgesMa.join(",");
    dataset.temporalCountryResolvedParts = String(references.resolvedPartCount);
    dataset.temporalCountryUnsupportedParts = String(references.unsupportedPartCount);
    dataset.temporalCountryPoints = String(references.pointCount);
    if (this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4") {
      this.preparedCaoCountries.delete(ageKey);
      this.preparedCaoCountries.set(ageKey, references);
      while (this.preparedCaoCountries.size > MAX_PREPARED_CAO_REFERENCE_AGES) {
        this.preparedCaoCountries.delete(this.preparedCaoCountries.keys().next().value!);
      }
      dataset.preparedCaoCountryAges = String(this.preparedCaoCountries.size);
      dataset.preparedCaoCountryPoints = String(
        [...this.preparedCaoCountries.values()].reduce(
          (total, prepared) => total + prepared.pointCount,
          0,
        ),
      );
      dataset.preparedCaoReferenceAgeLimit = String(MAX_PREPARED_CAO_REFERENCE_AGES);
      if (dataset.temporalDisplayedAgeMa !== ageKey) {
        dataset.temporalCountryDisplayStatus = "prepared";
        if (this.caoInFlight?.surface.requestedAgeMa.toFixed(6) === ageKey) {
          this.scheduleCaoSurfaceUpdate();
        }
        return;
      }
    }
    this.temporalCountries = references;
    if (
      this.temporalSurface?.exactEndpoint !== false &&
      this.snapshot?.periodCoordinateView?.id !== "cao-2024-v2.4"
    ) {
      dataset.temporalCountryDisplayedAgeMa = references.requestedAgeMa.toFixed(6);
      dataset.temporalCountryDisplayStatus = "exact";
      return;
    }
    if (dataset.temporalDisplayedAgeMa !== references.requestedAgeMa.toFixed(6)) {
      dataset.temporalCountryDisplayStatus = "waiting-terrain";
      return;
    }
    if (
      this.temporalCountryPreviewHandle === null &&
      dataset.temporalCountryDisplayStatus !== "moving-preview"
    ) {
      this.temporalCountryPreviewHandle = requestAnimationFrame(() => {
        this.temporalCountryPreviewHandle = null;
        const latest = this.temporalCountries;
        if (this.disposed || latest === undefined) return;
        this.installTemporalCountryPreview(latest);
      });
    }
    if (this.temporalCountryHandle !== null) window.clearTimeout(this.temporalCountryHandle);
    this.temporalCountryHandle = window.setTimeout(() => {
      this.temporalCountryHandle = null;
      if (this.disposed || this.temporalCountries !== references) return;
      this.countryRibbonCache = null;
      this.rebuildOverlays();
      dataset.temporalCountryDisplayedAgeMa = references.requestedAgeMa.toFixed(6);
      dataset.temporalCountryDisplayStatus = "terrain-draped";
      this.updateCaoCoordinateReadiness();
    }, 180);
  }

  setTemporalPois(
    poiCoordinates: Readonly<Record<string, LonLat>> | undefined,
    requestedAgeMa: number,
  ): void {
    const dataset = this.renderer.domElement.dataset;
    const ageKey = requestedAgeMa.toFixed(6);
    dataset.temporalPoiRequestedAgeMa = ageKey;
    if (this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4" && poiCoordinates !== undefined) {
      this.preparedCaoPois.delete(ageKey);
      this.preparedCaoPois.set(ageKey, poiCoordinates);
      while (this.preparedCaoPois.size > MAX_PREPARED_CAO_REFERENCE_AGES) {
        this.preparedCaoPois.delete(this.preparedCaoPois.keys().next().value!);
      }
      dataset.preparedCaoPoiAges = String(this.preparedCaoPois.size);
      dataset.preparedCaoPoiPoints = String(
        [...this.preparedCaoPois.values()].reduce(
          (total, prepared) => total + Object.keys(prepared).length,
          0,
        ),
      );
      dataset.preparedCaoReferenceAgeLimit = String(MAX_PREPARED_CAO_REFERENCE_AGES);
      if (dataset.temporalDisplayedAgeMa !== ageKey) {
        dataset.temporalPoiDisplayStatus = "prepared";
        if (this.caoInFlight?.surface.requestedAgeMa.toFixed(6) === ageKey) {
          this.scheduleCaoSurfaceUpdate();
        }
        return;
      }
    }
    this.temporalPoiCoordinates = poiCoordinates;
    this.temporalPoiRequestedAgeMa = requestedAgeMa;
    this.publishTemporalPoisIfReady();
  }

  private publishTemporalPoisIfReady(): void {
    const coordinates = this.temporalPoiCoordinates;
    const requestedAgeMa = this.temporalPoiRequestedAgeMa;
    if (coordinates === undefined || requestedAgeMa === null) return;
    const dataset = this.renderer.domElement.dataset;
    if (dataset.temporalDisplayedAgeMa !== requestedAgeMa.toFixed(6)) {
      dataset.temporalPoiDisplayStatus = "waiting-terrain";
      return;
    }
    let displayed = 0;
    const installedPositions: string[] = [];
    for (const child of this.markerGroup.children) {
      if (!(child instanceof THREE.Sprite)) continue;
      const poiId = child.userData.poiId as string | undefined;
      const point = poiId === undefined ? undefined : coordinates[poiId];
      child.visible = point !== undefined;
      if (point === undefined) continue;
      child.position.copy(lonLatToVector3(point, 1.028));
      installedPositions.push([
        poiId,
        child.position.x.toFixed(5),
        child.position.y.toFixed(5),
        child.position.z.toFixed(5),
      ].join(":"));
      displayed++;
    }
    dataset.temporalPoiDisplayedAgeMa = requestedAgeMa.toFixed(6);
    dataset.temporalPoiDisplayedCount = String(displayed);
    dataset.temporalPoiPositionSignature = installedPositions.sort().join("|");
    dataset.temporalPoiDisplayStatus = "ready";
    this.updateCaoCoordinateReadiness();
  }

  private installTemporalCountryPreview(references: TemporalCountryReferences): void {
    for (const child of [...this.overlayGroup.children]) {
      if (child.userData.overlayLayer !== "borders") continue;
      this.overlayGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
        child.geometry.dispose();
        disposeMaterial(child.material);
      }
    }
    this.countryRibbonCache = null;
    const positions: number[] = [];
    const sampler = this.displayedHeightSampler;
    const pointOnDisplayedSurface = (coordinates: LonLat) => {
      const direction = lonLatToVector3(coordinates).normalize();
      const heightMetres = sampler?.sampleHeightMetres([
        direction.x,
        direction.y,
        direction.z,
      ]) ?? 0;
      const radius = 1 +
        (heightMetres * this.verticalExaggeration + 650) / EARTH_RADIUS_METRES;
      return direction.multiplyScalar(radius);
    };
    const minimumRunLengthMetres = this.detail === "regional" ? 20_000 : 60_000;
    for (const country of references.countries) {
      for (const line of country.lines) {
        if (countryLineLengthMetres(line) < minimumRunLengthMetres) continue;
        for (let index = 1; index < line.length; index += 1) {
          const start = pointOnDisplayedSurface(line[index - 1]!);
          const end = pointOnDisplayedSurface(line[index]!);
          positions.push(start.x, start.y, start.z, end.x, end.y, end.z);
        }
      }
    }
    if (positions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.BufferAttribute(Float32Array.from(positions), 3),
      );
      geometry.computeBoundingSphere();
      const preview = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
        color: 0x527066,
        transparent: true,
        opacity: 0.4,
        depthTest: true,
        depthWrite: false,
      }));
      preview.renderOrder = 3;
      preview.visible = this.layers.borders;
      preview.userData.overlayLayer = "borders";
      preview.userData.evidence = references.evidence;
      this.overlayGroup.add(preview);
    }
    const dataset = this.renderer.domElement.dataset;
    dataset.temporalCountryDisplayedAgeMa = references.requestedAgeMa.toFixed(6);
    dataset.temporalCountryDisplayStatus = "moving-preview";
    this.updateCaoCoordinateReadiness();
  }

  private updateCaoCoordinateReadiness(): void {
    if (this.snapshot?.periodCoordinateView?.id !== "cao-2024-v2.4") return;
    const dataset = this.renderer.domElement.dataset;
    const displayedAgeMa = dataset.periodCoordinateDisplayedAgeMa;
    const requestedAgeMa = dataset.periodCoordinateRequestedAgeMa;
    if (
      displayedAgeMa === undefined || requestedAgeMa === undefined ||
      displayedAgeMa !== requestedAgeMa || this.caoInFlight !== null ||
      this.caoSurfaceResolver?.requestedAgeMa.toFixed(6) !== displayedAgeMa ||
      (this.temporalSettled && dataset.periodCoordinateDetail !== "settled")
    ) {
      dataset.periodCoordinateStatus = "updating";
      return;
    }
    if (this.caoSurfaceResolver?.boundaryStatus === "unsupported-fractional") {
      dataset.periodCoordinateStatus = "unsupported";
      return;
    }
    const countriesReady = !this.layers.borders || (
      dataset.temporalCountryDisplayedAgeMa === displayedAgeMa &&
      dataset.temporalCountryDisplayStatus === "terrain-draped"
    );
    const poisReady = (this.snapshot?.poiIds.length ?? 0) === 0 ||
      dataset.temporalPoiDisplayedAgeMa === displayedAgeMa;
    const guidesReady = !this.layers.guides ||
      dataset.overlayDrapeAppliedSurfaceKey === this.displayedHeightSamplerKey;
    dataset.periodCoordinateStatus = countriesReady && poisReady && guidesReady
      ? "ready"
      : "updating";
  }

  private async prepareTemporalResolver(intervalId: string): Promise<void> {
    const serial = ++this.temporalLoadSerial;
    this.renderer.domElement.dataset.temporalStatus = "loading-motion";
    try {
      const catalog = this.temporalCatalog ?? await loadPeriodMotionCatalog();
      if (
        this.disposed || serial !== this.temporalLoadSerial ||
        this.temporalSurface?.intervalId !== intervalId
      ) return;
      this.temporalCatalog = catalog;
      this.temporalResolver = createPeriodMaterialResolver(
        catalog,
        this.temporalSurface.requestedAgeMa,
      );
      this.scheduleTemporalUpdate();
    } catch (error) {
      if (serial === this.temporalLoadSerial && !this.disposed) {
        this.renderer.domElement.dataset.temporalStatus = "error";
        console.error("Temporal plate-motion source failed", error);
      }
    }
  }

  private async prepareCaoSurface(viewId: string): Promise<void> {
    const serial = ++this.caoLoadSerial;
    const dataset = this.renderer.domElement.dataset;
    dataset.periodCoordinateView = viewId;
    dataset.periodCoordinateStatus = "loading";
    try {
      const paleomap = this.temporalCatalog ?? await loadPeriodMotionCatalog();
      const bundle = await loadCaoCoordinateViewBundle(paleomap);
      if (
        this.disposed || serial !== this.caoLoadSerial ||
        this.snapshot?.periodCoordinateView?.id !== viewId || this.temporalSurface === null
      ) return;
      this.temporalCatalog = paleomap;
      this.caoBundle = bundle;
      this.caoSurfaceResolver = null;
      this.scheduleCaoSurfaceUpdate();
    } catch (error) {
      if (serial === this.caoLoadSerial && !this.disposed) {
        dataset.periodCoordinateStatus = "error";
        console.error("Cao coordinate view failed", error);
      }
    }
  }

  private scheduleCaoSurfaceUpdate(): void {
    if (
      this.disposed || this.cubeSurfaceGroup === null || this.temporalSurface === null ||
      this.caoBundle === null
    ) return;
    // A settled publication targets the final visible leaf set. Starting it
    // while cube refinement is still replacing parents counts and computes
    // tiles that will be discarded before the atomic publish.
    if (
      this.temporalSettled &&
      this.renderer.domElement.dataset.cubeRefinementStatus !== "ready"
    ) return;
    if (this.temporalUpdateHandle !== null) return;
    this.renderer.domElement.dataset.periodCoordinateStatus = "updating";
    this.temporalUpdateHandle = requestAnimationFrame(() => {
      this.temporalUpdateHandle = null;
      if (this.caoInFlight === null) {
        const bundle = this.caoBundle;
        const temporal = this.temporalSurface;
        const environment = this.temporalEnvironment;
        if (bundle === null || temporal === null || environment === null) return;
        this.renderer.domElement.dataset.periodCoordinateStagedAgeMa =
          temporal.requestedAgeMa.toFixed(6);
        const preparationStarted = performance.now();
        const resolver = createCaoSurfaceResolver(
          bundle.ocean,
          bundle.oceanModel,
          bundle.continentalModel,
          bundle.sampleLifecycle,
          bundle.crosswalk,
          temporal,
          environment,
        );
        this.caoSurfaceResolver = resolver;
        this.renderer.domElement.dataset.caoResolverPreparationMs =
          (performance.now() - preparationStarted).toFixed(2);
        this.caoInFlight = { surface: temporal, resolver, preview: !this.temporalSettled };
      }
      this.applyCaoSurfaceUpdate();
    });
  }

  private applyCaoSurfaceUpdate(): void {
    const group = this.cubeSurfaceGroup;
    const inFlight = this.caoInFlight;
    const fallback = this.activeSurfaceFields;
    if (group === null || inFlight === null || fallback === null) return;
    const { surface: temporal, resolver, preview } = inFlight;
    const temporalKey = [
      "cao-2024-v2.4",
      temporal.intervalId,
      temporal.requestedAgeMa.toFixed(6),
      this.surfaceMode,
      this.verticalExaggeration.toFixed(3),
      preview ? "preview" : "settled",
    ].join(":");
    if (this.temporalUpdateJobKey !== temporalKey) {
      this.temporalUpdateJobKey = temporalKey;
      this.temporalUpdateTotalMs = 0;
      this.temporalUpdateMaxChunkMs = 0;
      this.temporalUpdateVertices = 0;
      this.temporalResolvedVertices = 0;
      this.temporalFallbackVertices = 0;
      this.temporalScratchPeakBytes = 0;
      this.caoRidgeVertices = 0;
      this.caoTrenchVertices = 0;
      this.renderer.domElement.dataset.caoUpdateChunkVertices =
        String(CAO_UPDATE_CHUNK_VERTICES);
      this.renderer.domElement.dataset.caoUpdateFrameBudgetMs =
        String(CAO_UPDATE_FRAME_BUDGET_MS);
    }
    const started = performance.now();
    let updatedTiles = 0;
    let continentalVertices = 0;
    let oceanVertices = 0;
    let unsupportedVertices = 0;
    let ridgeVertices = 0;
    let trenchVertices = 0;
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const fields = child.userData.cubeFields as CubeTileFields | undefined;
      if (
        fields === undefined || child.userData.temporalStaleLod === true ||
        child.userData.temporalKey === temporalKey ||
        (child.userData.temporalPendingKey !== undefined && child.userData.temporalPendingKey !== temporalKey) ||
        (updatedTiles > 0 && performance.now() - started >= CAO_UPDATE_FRAME_BUDGET_MS)
      ) continue;
      const staged = (child.userData.temporalPendingKey === temporalKey
        ? child.userData.temporalPending
        : {
          positions: new Float32Array(fields.directions.length),
          normals: new Float32Array(fields.directions.length),
          colors: new Float32Array(fields.directions.length),
          uvs: new Float32Array(fields.localUvs.length),
          boundingSphere: new THREE.Sphere(),
          nextVertex: 0,
          complete: false,
          continentalVertices: 0,
          oceanVertices: 0,
          unsupportedVertices: 0,
          ridgeVertices: 0,
          trenchVertices: 0,
        }) as {
          positions: Float32Array;
          normals: Float32Array;
          colors: Float32Array;
          uvs: Float32Array;
          boundingSphere: THREE.Sphere;
          nextVertex: number;
          complete: boolean;
          continentalVertices: number;
          oceanVertices: number;
          unsupportedVertices: number;
          ridgeVertices: number;
          trenchVertices: number;
        };
      child.userData.temporalPending = staged;
      child.userData.temporalPendingKey = temporalKey;
      if (staged.complete) continue;
      const result = (preview ? resolver.updatePreviewTile : resolver.updateTile)(
        fields,
        this.surfaceMode,
        this.verticalExaggeration,
        {
        positions: staged.positions,
        colors: staged.colors,
        uvs: staged.uvs,
        textureSourceAgeMa: this.snapshot?.geographicSourceAgeMa ?? temporal.younger.ageMa,
        startVertex: preview ? undefined : staged.nextVertex,
        maxVertices: preview ? undefined : CAO_UPDATE_CHUNK_VERTICES,
        },
      );
      staged.nextVertex = result.nextVertex;
      staged.complete = result.complete;
      staged.continentalVertices += result.resolvedContinentalVertices;
      staged.oceanVertices += result.resolvedOceanVertices;
      staged.unsupportedVertices += result.unsupportedVertices;
      staged.ridgeVertices += result.ridgeVertices;
      staged.trenchVertices += result.trenchVertices;
      if (staged.complete) {
        stitchCubeTilePositionEdges(
          fields.meshSegments,
          child.userData.coarseEdges ?? { north: false, east: false, south: false, west: false },
          staged.positions,
        );
        unwrapTemporalTileUvs(fields.meshSegments, staged.uvs);
        const stagedGeometry = new THREE.BufferGeometry();
        stagedGeometry.setAttribute("position", new THREE.BufferAttribute(staged.positions, 3));
        stagedGeometry.setIndex(new THREE.BufferAttribute(fields.indices, 1));
        stagedGeometry.computeVertexNormals();
        staged.normals.set((stagedGeometry.getAttribute("normal") as THREE.BufferAttribute).array as Float32Array);
        applyCaoSlopeMaterialContrast(staged.colors, fields.directions, staged.normals);
        stagedGeometry.computeBoundingSphere();
        if (stagedGeometry.boundingSphere !== null) staged.boundingSphere.copy(stagedGeometry.boundingSphere);
        stagedGeometry.dispose();
      }
      continentalVertices += result.resolvedContinentalVertices;
      oceanVertices += result.resolvedOceanVertices;
      unsupportedVertices += result.unsupportedVertices;
      ridgeVertices += result.ridgeVertices;
      trenchVertices += result.trenchVertices;
      this.temporalUpdateVertices += result.vertices;
      updatedTiles++;
    }
    const hasStagedTiles = group.children.some((child) =>
      child instanceof THREE.Mesh && child.userData.temporalPendingKey === temporalKey
    );
    if (updatedTiles === 0 && !hasStagedTiles) {
      this.caoInFlight = null;
      this.updateCaoCoordinateReadiness();
      if (this.temporalSurface?.requestedAgeMa !== temporal.requestedAgeMa) {
        this.scheduleCaoSurfaceUpdate();
      } else if (preview && this.temporalSettled) {
        this.scheduleCaoSurfaceUpdate();
      }
      return;
    }
    const chunkMs = performance.now() - started;
    this.temporalUpdateMs = chunkMs;
    this.temporalUpdateMaxChunkMs = Math.max(this.temporalUpdateMaxChunkMs, chunkMs);
    this.temporalUpdateTotalMs += chunkMs;
    this.temporalResolvedVertices += continentalVertices + oceanVertices;
    this.temporalFallbackVertices += unsupportedVertices;
    this.caoRidgeVertices += ridgeVertices;
    this.caoTrenchVertices += trenchVertices;
    const remaining = group.children.some((child) =>
      child instanceof THREE.Mesh && child.userData.cubeFields !== undefined &&
      child.userData.temporalStaleLod !== true && child.userData.temporalKey !== temporalKey &&
      (
        child.userData.temporalPendingKey !== temporalKey ||
        child.userData.temporalPending?.complete !== true
      )
    );
    if (!remaining) {
      const stagedAgeKey = temporal.requestedAgeMa.toFixed(6);
      const preparedCountries = this.preparedCaoCountries.get(stagedAgeKey);
      const preparedPois = this.preparedCaoPois.get(stagedAgeKey);
      if (
        (this.layers.borders && preparedCountries === undefined) ||
        ((this.snapshot?.poiIds.length ?? 0) > 0 && preparedPois === undefined)
      ) {
        this.renderer.domElement.dataset.periodCoordinateStatus = "updating";
        this.renderer.domElement.dataset.periodCoordinateWaitingForReferences = stagedAgeKey;
        return;
      }
      const publishStarted = performance.now();
      harmonizeTemporalTileNormals(group.children.flatMap((child) => {
        if (!(child instanceof THREE.Mesh) || child.userData.temporalPendingKey !== temporalKey) {
          return [];
        }
        const staged = child.userData.temporalPending as { normals: Float32Array };
        const fields = child.userData.cubeFields as CubeTileFields;
        return [{
          directions: fields.directions,
          normals: staged.normals,
          meshSegments: fields.meshSegments,
          coarseEdges: child.userData.coarseEdges ??
            { north: false, east: false, south: false, west: false },
        }];
      }));
      for (const child of group.children) {
        if (!(child instanceof THREE.Mesh) || child.userData.temporalPendingKey !== temporalKey) continue;
        const staged = child.userData.temporalPending as {
          positions: Float32Array;
          normals: Float32Array;
          colors: Float32Array;
          uvs: Float32Array;
          boundingSphere: THREE.Sphere;
          complete: boolean;
        };
        if (!staged.complete) continue;
        const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
        const normals = child.geometry.getAttribute("normal") as THREE.BufferAttribute;
        const uvs = child.geometry.getAttribute("uv") as THREE.BufferAttribute;
        let colors = child.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (colors === undefined) {
          colors = new THREE.BufferAttribute(new Float32Array(staged.colors.length), 3);
          child.geometry.setAttribute("color", colors);
        }
        (positions.array as Float32Array).set(staged.positions);
        (normals.array as Float32Array).set(staged.normals);
        (uvs.array as Float32Array).set(staged.uvs);
        (colors.array as Float32Array).set(staged.colors);
        positions.needsUpdate = true;
        normals.needsUpdate = true;
        uvs.needsUpdate = true;
        colors.needsUpdate = true;
        child.geometry.boundingSphere = staged.boundingSphere;
        const material = child.material as THREE.MeshPhysicalMaterial;
        if (
          !material.vertexColors || material.map !== this.satelliteMaterialTextures.albedo ||
          material.roughnessMap !== this.satelliteMaterialTextures.detail ||
          material.bumpMap !== this.satelliteMaterialTextures.detail
        ) {
          material.vertexColors = true;
          material.map = this.satelliteMaterialTextures.albedo;
          material.roughnessMap = this.satelliteMaterialTextures.detail;
          material.bumpMap = this.satelliteMaterialTextures.detail;
          material.bumpScale = 0.0038 * Math.sqrt(this.verticalExaggeration);
          material.roughness = 0.86;
          material.needsUpdate = true;
        }
        material.bumpScale = 0.0038 * Math.sqrt(this.verticalExaggeration);
        child.userData.temporalKey = temporalKey;
        child.visible = true;
        delete child.userData.temporalReplacement;
        delete child.userData.temporalPending;
        delete child.userData.temporalPendingKey;
      }
      for (const child of [...group.children]) {
        if (!(child instanceof THREE.Mesh) || child.userData.temporalStaleLod !== true) continue;
        group.remove(child);
        this.disposeCubeMesh(child);
      }
      this.finishStagedCubeReplacement();
      const publishMs = performance.now() - publishStarted;
      this.temporalUpdateMs += publishMs;
      this.temporalUpdateMaxChunkMs = Math.max(this.temporalUpdateMaxChunkMs, this.temporalUpdateMs);
      this.temporalUpdateTotalMs += publishMs;
      this.temporalUpdateCount++;
      this.installDisplayedHeightSampler(
        this.createPublishedCubeHeightSampler(group),
        `${temporalKey}:published:r${++this.temporalGeometryRevision}`,
      );
      const dataset = this.renderer.domElement.dataset;
      delete dataset.periodCoordinateWaitingForReferences;
      dataset.periodCoordinateDisplayedAgeMa = temporal.requestedAgeMa.toFixed(6);
      dataset.temporalDisplayedAgeMa = temporal.requestedAgeMa.toFixed(6);
      dataset.periodCoordinateDetail = preview ? "preview" : "settled";
      if (preparedCountries !== undefined) {
        this.temporalCountries = preparedCountries;
        this.installTemporalCountryPreview(preparedCountries);
        this.setTemporalCountries(preparedCountries);
      }
      if (preparedPois !== undefined) {
        this.temporalPoiCoordinates = preparedPois;
        this.temporalPoiRequestedAgeMa = temporal.requestedAgeMa;
      }
      this.publishTemporalPoisIfReady();
      if (preparedCountries === undefined && this.temporalCountries !== undefined) {
        this.setTemporalCountries(this.temporalCountries);
      }
      dataset.periodCoordinateResolvedVertices = String(this.temporalResolvedVertices);
      dataset.periodCoordinateUnsupportedVertices = String(this.temporalFallbackVertices);
      dataset.caoRidgeVertices = String(this.caoRidgeVertices);
      dataset.caoTrenchVertices = String(this.caoTrenchVertices);
      dataset.caoBoundarySegments = String(resolver.boundaryField?.segmentCount ?? 0);
      dataset.caoBoundaryUnsupportedSegments = String(resolver.boundaryField?.unsupportedSegmentCount ?? 0);
      dataset.caoBoundaryPoints = String(resolver.boundaryField?.pointCount ?? 0);
      dataset.caoMaterialDetailTextureBytes = String(2 * 512 * 256 * 4);
      dataset.caoMaterialDetailMethod =
        "model-stable-procedural-albedo-normal-roughness";
      if (resolver.boundaryField !== null) {
        dataset.caoBoundaryDisplayedAgeMa = resolver.boundaryField.ageMa.toFixed(6);
      dataset.caoBoundaryEvidence = resolver.boundaryField.evidence;
      } else {
        delete dataset.caoBoundaryDisplayedAgeMa;
      }
      dataset.cubeVisibleTiles = String(
        group.children.filter((child) => child.visible).length,
      );
    }
    const dataset = this.renderer.domElement.dataset;
    delete dataset.temporalNativeReusedVertices;
    dataset.temporalStatus = remaining ? "updating" : "ready";
    dataset.temporalUpdateMs = this.temporalUpdateMs.toFixed(2);
    dataset.temporalUpdateMaxChunkMs = this.temporalUpdateMaxChunkMs.toFixed(2);
    dataset.temporalUpdateTotalMs = this.temporalUpdateTotalMs.toFixed(2);
    dataset.temporalUpdateCount = String(this.temporalUpdateCount);
    dataset.temporalUpdateVertices = String(this.temporalUpdateVertices);
    dataset.temporalResolvedVertices = String(this.temporalResolvedVertices);
    dataset.temporalFallbackVertices = String(this.temporalFallbackVertices);
    dataset.periodCoordinateStatus = "updating";
    if (remaining) {
      this.scheduleCaoSurfaceUpdate();
    } else {
      this.caoInFlight = null;
      this.updateCaoCoordinateReadiness();
      if (
        this.temporalSurface?.requestedAgeMa !== temporal.requestedAgeMa ||
        (preview && this.temporalSettled)
      ) {
        this.scheduleCaoSurfaceUpdate();
      }
    }
  }

  private scheduleTemporalUpdate(): void {
    if (this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4") {
      this.scheduleCaoSurfaceUpdate();
      return;
    }
    if (
      this.disposed || this.temporalSurface === null ||
      this.temporalResolver === null || this.temporalEnvironment === null ||
      this.cubeSurfaceGroup === null || this.activeSurfaceFields === null ||
      this.cubeDisplayedSnapshotId !== this.snapshot?.id
    ) return;
    if (
      this.temporalSettled &&
      this.renderer.domElement.dataset.cubeRefinementStatus !== "ready"
    ) {
      this.renderer.domElement.dataset.temporalStatus = "waiting-refinement";
      return;
    }
    if (this.temporalUpdateHandle !== null) return;
    this.temporalInFlight ??= {
      surface: this.temporalSurface,
      environment: this.temporalEnvironment,
      resolver: this.temporalResolver,
      detail: this.effectiveQuality === "low" ? "coarse" : this.detail,
    };
    this.renderer.domElement.dataset.temporalStatus = "queued";
    this.temporalUpdateHandle = requestAnimationFrame(() => {
      this.temporalUpdateHandle = null;
      this.applyTemporalCubeUpdate();
    });
  }

  private applyTemporalCubeUpdate(): void {
    const group = this.cubeSurfaceGroup;
    const inFlight = this.temporalInFlight;
    const temporal = inFlight?.surface ?? null;
    const resolver = inFlight?.resolver ?? null;
    const environment = inFlight?.environment ?? null;
    const fallback = this.activeSurfaceFields;
    const surfaceDetail = inFlight?.detail ?? "coarse";
    if (
      group === null || temporal === null || resolver === null ||
      environment === null || fallback === null
    ) return;
    const started = performance.now();
    const temporalKey = [
      temporal.intervalId,
      temporal.requestedAgeMa.toFixed(6),
      this.surfaceMode,
      this.verticalExaggeration.toFixed(3),
      surfaceDetail,
    ].join(":");
    if (this.temporalUpdateJobKey !== temporalKey) {
      this.temporalUpdateJobKey = temporalKey;
      this.temporalUpdateTotalMs = 0;
      this.temporalUpdateMaxChunkMs = 0;
      this.temporalUpdateVertices = 0;
      this.temporalResolvedVertices = 0;
      this.temporalFallbackVertices = 0;
      this.temporalScratchPeakBytes = 0;
    }
    if (temporal.exactEndpoint && temporal.requestedAgeMa === 0) {
      this.publishExactModernCubeUpdate(
        group,
        temporal,
        temporalKey,
        surfaceDetail,
        resolver.activeFragmentCount,
      );
      return;
    }
    let vertices = 0;
    let resolvedVertices = 0;
    let fallbackVertices = 0;
    let updatedTiles = 0;
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const fields = child.userData.cubeFields as CubeTileFields | undefined;
      if (fields === undefined) continue;
      if (child.userData.temporalStaleLod === true) continue;
      if (
        child.userData.temporalKey === temporalKey ||
        child.userData.temporalPendingKey === temporalKey
      ) continue;
      if (updatedTiles > 0 && performance.now() - started >= PALEOMAP_UPDATE_FRAME_BUDGET_MS) {
        continue;
      }
      const shadingPositions = new Float32Array(fields.directions.length);
      this.temporalScratchPeakBytes = Math.max(
        this.temporalScratchPeakBytes,
        shadingPositions.byteLength,
      );
      const staged = {
        positions: new Float32Array(fields.directions.length),
        normals: new Float32Array(fields.directions.length),
        colors: new Float32Array(fields.directions.length),
        uvs: new Float32Array(fields.localUvs.length),
        boundingSphere: new THREE.Sphere(),
      };
      const result = updateTemporalCubeTile(
        fields,
        fallback,
        temporal,
        environment,
        this.surfaceMode,
        this.verticalExaggeration,
        resolver,
        {
          positions: staged.positions,
          shadingPositions,
          colors: staged.colors,
          uvs: staged.uvs,
          textureSourceAgeMa: this.snapshot?.geographicSourceAgeMa,
        },
        surfaceDetail,
      );
      unwrapTemporalTileUvs(fields.meshSegments, staged.uvs);
      const coarseEdges = child.userData.coarseEdges as
        | { north: boolean; east: boolean; south: boolean; west: boolean }
        | undefined;
      stitchCubeTilePositionEdges(
        fields.meshSegments,
        coarseEdges ?? { north: false, east: false, south: false, west: false },
        staged.positions,
      );
      stitchCubeTilePositionEdges(
        fields.meshSegments,
        coarseEdges ?? { north: false, east: false, south: false, west: false },
        shadingPositions,
      );
      const stagedGeometry = new THREE.BufferGeometry();
      stagedGeometry.setAttribute("position", new THREE.BufferAttribute(shadingPositions, 3));
      stagedGeometry.setIndex(new THREE.BufferAttribute(fields.indices, 1));
      stagedGeometry.computeVertexNormals();
      staged.normals.set(
        (stagedGeometry.getAttribute("normal") as THREE.BufferAttribute).array as Float32Array,
      );
      if (
        temporal.exactEndpoint && temporal.requestedAgeMa === 0 &&
        this.surfaceMode === "surface" && fields.sourcePatchIds.length > 0
      ) {
        // The physical modern water shell is flat by contract. Its source
        // bathymetry survives only in the native tile's virtual normal field;
        // keep that lighting evidence while land vertices retain the
        // exaggeration-aware staged normals derived above.
        for (let vertex = 0; vertex < fields.heightsMetres.length; vertex++) {
          if (Math.abs(fields.heightsMetres[vertex]) > 1e-4) continue;
          const offset = vertex * 3;
          staged.normals[offset] = fields.normals[offset];
          staged.normals[offset + 1] = fields.normals[offset + 1];
          staged.normals[offset + 2] = fields.normals[offset + 2];
        }
      }
      stagedGeometry.setAttribute("position", new THREE.BufferAttribute(staged.positions, 3));
      stagedGeometry.computeBoundingSphere();
      if (stagedGeometry.boundingSphere !== null) {
        staged.boundingSphere.copy(stagedGeometry.boundingSphere);
      }
      stagedGeometry.dispose();
      vertices += result.vertices;
      resolvedVertices += result.resolvedVertices;
      fallbackVertices += result.fallbackVertices;
      child.userData.temporalPending = staged;
      child.userData.temporalPendingKey = temporalKey;
      updatedTiles++;
    }
    const hasStagedTiles = group.children.some((child) =>
      child instanceof THREE.Mesh && child.userData.temporalPendingKey === temporalKey
    );
    if (updatedTiles === 0 && !hasStagedTiles) {
      this.renderer.domElement.dataset.temporalStatus = "ready";
      return;
    }
    this.temporalUpdateMs = performance.now() - started;
    this.temporalUpdateMaxChunkMs = Math.max(
      this.temporalUpdateMaxChunkMs,
      this.temporalUpdateMs,
    );
    this.temporalUpdateTotalMs += this.temporalUpdateMs;
    this.temporalUpdateVertices += vertices;
    this.temporalResolvedVertices += resolvedVertices;
    this.temporalFallbackVertices += fallbackVertices;
    const remaining = group.children.some((child) =>
      child instanceof THREE.Mesh && child.userData.cubeFields !== undefined &&
      child.userData.temporalStaleLod !== true &&
      child.userData.temporalKey !== temporalKey && child.userData.temporalPendingKey !== temporalKey
    );
    if (!remaining) {
      const publishStarted = performance.now();
      harmonizeTemporalTileNormals(group.children.flatMap((child) => {
        if (!(child instanceof THREE.Mesh) || child.userData.temporalPendingKey !== temporalKey) {
          return [];
        }
        const staged = child.userData.temporalPending as { normals: Float32Array };
        const fields = child.userData.cubeFields as CubeTileFields;
        return [{
          directions: fields.directions,
          normals: staged.normals,
          meshSegments: fields.meshSegments,
          coarseEdges: child.userData.coarseEdges ??
            { north: false, east: false, south: false, west: false },
        }];
      }));
      for (const child of group.children) {
        if (!(child instanceof THREE.Mesh) || child.userData.temporalPendingKey !== temporalKey) {
          continue;
        }
        const staged = child.userData.temporalPending as {
          positions: Float32Array;
          normals: Float32Array;
          colors: Float32Array;
          uvs: Float32Array;
          boundingSphere: THREE.Sphere;
        };
        const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
        const normals = child.geometry.getAttribute("normal") as THREE.BufferAttribute;
        let colors = child.geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
        if (colors === undefined) {
          colors = new THREE.BufferAttribute(new Float32Array(staged.colors.length), 3);
          child.geometry.setAttribute("color", colors);
        }
        const uvs = child.geometry.getAttribute("uv") as THREE.BufferAttribute;
        (positions.array as Float32Array).set(staged.positions);
        (normals.array as Float32Array).set(staged.normals);
        (colors.array as Float32Array).set(staged.colors);
        (uvs.array as Float32Array).set(staged.uvs);
        positions.needsUpdate = true;
        normals.needsUpdate = true;
        colors.needsUpdate = true;
        uvs.needsUpdate = true;
        child.geometry.boundingSphere = staged.boundingSphere;
        const material = child.material as THREE.MeshPhysicalMaterial;
        const globalTextures = this.textures;
        const exactModernMaterial = temporal.exactEndpoint &&
          temporal.requestedAgeMa === 0;
        const sourceTextures = child.userData.sourceTextures as
          | { map: THREE.Texture; roughnessMap: THREE.Texture; bumpMap: THREE.Texture }
          | undefined;
        if (exactModernMaterial && sourceTextures !== undefined) {
          const fields = child.userData.cubeFields as CubeTileFields | undefined;
          const sourceRefinedMaterial = (fields?.sourcePatchIds.length ?? 0) > 0;
          if (
            material.vertexColors || material.map !== sourceTextures.map ||
            material.roughnessMap !== null ||
            material.bumpMap !== (sourceRefinedMaterial ? sourceTextures.bumpMap : null)
          ) {
            material.vertexColors = false;
            material.map = sourceTextures.map;
            // Modern biome colours remain source-qualified. Intersecting ETOPO
            // tiles also retain their local source residual-height bump.
            // Roughness stays scalar so a tile-wide map cannot reveal the
            // rectangular source boundary. These observations are valid at
            // exactly 0 Ma only; other material keeps the stable normal path.
            material.roughnessMap = null;
            material.bumpMap = sourceRefinedMaterial ? sourceTextures.bumpMap : null;
            material.needsUpdate = true;
          }
          material.bumpScale = sourceRefinedMaterial
            ? CUBE_MATERIAL_BUMP_SCALE * Math.sqrt(this.verticalExaggeration)
            : 0;
        } else if (
          !material.vertexColors || material.map !== globalTextures?.albedo ||
          material.roughnessMap !== null || material.bumpMap !== null
        ) {
          material.vertexColors = true;
          material.map = globalTextures?.albedo ?? null;
          material.roughnessMap = null;
          material.bumpMap = null;
          material.needsUpdate = true;
        }
        if (!exactModernMaterial) material.bumpScale = 0;
        child.userData.temporalKey = temporalKey;
        child.visible = true;
        delete child.userData.temporalReplacement;
        delete child.userData.temporalPending;
        delete child.userData.temporalPendingKey;
      }
      for (const child of [...group.children]) {
        if (!(child instanceof THREE.Mesh) || child.userData.temporalStaleLod !== true) continue;
        group.remove(child);
        this.disposeCubeMesh(child);
      }
      this.finishStagedCubeReplacement();
      const publishMs = performance.now() - publishStarted;
      this.temporalUpdateMs += publishMs;
      this.temporalUpdateMaxChunkMs = Math.max(
        this.temporalUpdateMaxChunkMs,
        this.temporalUpdateMs,
      );
      this.temporalUpdateTotalMs += publishMs;
      this.temporalUpdateCount++;
      this.renderer.domElement.dataset.temporalDisplayedAgeMa =
        temporal.requestedAgeMa.toFixed(6);
      this.publishTemporalPoisIfReady();
      this.renderer.domElement.dataset.cubeVisibleTiles = String(
        group.children.filter((child) => child.visible).length,
      );
      this.updateCubeSourceDiagnostics(group);
      this.installDisplayedHeightSampler(
        this.createPublishedCubeHeightSampler(group),
        `${temporalKey}:published:r${++this.temporalGeometryRevision}`,
      );
    }
    const dataset = this.renderer.domElement.dataset;
    delete dataset.temporalNativeReusedVertices;
    dataset.temporalStatus = remaining ? "updating" : "ready";
    dataset.temporalUpdateMs = this.temporalUpdateMs.toFixed(2);
    dataset.temporalUpdateMaxChunkMs = this.temporalUpdateMaxChunkMs.toFixed(2);
    dataset.temporalUpdateTotalMs = this.temporalUpdateTotalMs.toFixed(2);
    dataset.temporalUpdateCount = String(this.temporalUpdateCount);
    dataset.temporalUpdateVertices = String(this.temporalUpdateVertices);
    dataset.temporalResolvedVertices = String(this.temporalResolvedVertices);
    dataset.temporalFallbackVertices = String(this.temporalFallbackVertices);
    dataset.temporalActiveFragments = String(resolver.activeFragmentCount);
    dataset.temporalMaterialDetailMethod =
      "model-stable-reference-normal-perturbation-source-ruggedness-conditioned";
    dataset.temporalMaterialDetailProfile = surfaceDetail;
    dataset.temporalMaterialDetailTextureBytes = "0";
    dataset.temporalUpdateFrameBudgetMs = String(PALEOMAP_UPDATE_FRAME_BUDGET_MS);
    dataset.temporalRuggednessCacheBytes = String(temporalRuggednessCacheBytes());
    dataset.temporalRuggednessCacheEntryLimit = "2";
    if (this.snapshot?.geographicSourceAgeMa !== undefined) {
      dataset.temporalMaterialSourceAgeMa = String(this.snapshot.geographicSourceAgeMa);
    }
    if (!remaining && this.temporalCountries?.requestedAgeMa === temporal.requestedAgeMa) {
      this.setTemporalCountries(this.temporalCountries);
    }
    if (remaining) {
      this.scheduleTemporalUpdate();
    } else {
      this.temporalInFlight = null;
      if (
        this.temporalSurface?.requestedAgeMa !== temporal.requestedAgeMa
      ) this.scheduleTemporalUpdate();
    }
  }

  private publishExactModernCubeUpdate(
    group: THREE.Group,
    temporal: TemporalSurface,
    temporalKey: string,
    surfaceDetail: SurfaceDetail,
    activeFragmentCount: number,
  ): void {
    const dataset = this.renderer.domElement.dataset;
    const currentMeshes = group.children.filter((child): child is THREE.Mesh =>
      child instanceof THREE.Mesh &&
      child.userData.cubeFields !== undefined &&
      child.userData.temporalStaleLod !== true
    );
    const staleMeshes = group.children.filter((child): child is THREE.Mesh =>
      child instanceof THREE.Mesh && child.userData.temporalStaleLod === true
    );
    const needsPublication = staleMeshes.length > 0 || currentMeshes.some((mesh) =>
      !mesh.visible || mesh.userData.temporalKey !== temporalKey
    );
    if (!needsPublication) {
      dataset.temporalStatus = "ready";
      this.temporalInFlight = null;
      if (this.temporalSurface?.requestedAgeMa !== temporal.requestedAgeMa) {
        this.scheduleTemporalUpdate();
      }
      return;
    }

    const publishStarted = performance.now();
    let reusedVertices = 0;
    for (const child of currentMeshes) {
      const fields = child.userData.cubeFields as CubeTileFields;
      const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
      const normals = child.geometry.getAttribute("normal") as THREE.BufferAttribute;
      const uvs = child.geometry.getAttribute("uv") as THREE.BufferAttribute;
      updateCubeTileMeshGeometry(
        fields,
        this.verticalExaggeration,
        child.userData.coarseEdges ??
          { north: false, east: false, south: false, west: false },
        positions.array as Float32Array,
        normals.array as Float32Array,
        uvs.array as Float32Array,
      );
      positions.needsUpdate = true;
      normals.needsUpdate = true;
      uvs.needsUpdate = true;
      child.geometry.computeBoundingSphere();
      const sourceTextures = child.userData.sourceTextures as
        | { map: THREE.Texture; roughnessMap: THREE.Texture; bumpMap: THREE.Texture }
        | undefined;
      if (sourceTextures === undefined) continue;
      const sourceRefinedMaterial = fields.sourcePatchIds.length > 0;
      const material = child.material as THREE.MeshPhysicalMaterial;
      if (
        material.vertexColors || material.map !== sourceTextures.map ||
        material.roughnessMap !== null ||
        material.bumpMap !== (sourceRefinedMaterial ? sourceTextures.bumpMap : null)
      ) {
        material.vertexColors = false;
        material.map = sourceTextures.map;
        material.roughnessMap = null;
        material.bumpMap = sourceRefinedMaterial ? sourceTextures.bumpMap : null;
        material.needsUpdate = true;
      }
      material.bumpScale = sourceRefinedMaterial
        ? CUBE_MATERIAL_BUMP_SCALE * Math.sqrt(this.verticalExaggeration)
        : 0;
      child.userData.temporalKey = temporalKey;
      child.visible = true;
      delete child.userData.temporalReplacement;
      delete child.userData.temporalPending;
      delete child.userData.temporalPendingKey;
      reusedVertices += fields.heightsMetres.length;
    }
    for (const child of staleMeshes) {
      group.remove(child);
      this.disposeCubeMesh(child);
    }
    this.finishStagedCubeReplacement();

    const publishMs = performance.now() - publishStarted;
    this.temporalUpdateMs = publishMs;
    this.temporalUpdateTotalMs = publishMs;
    this.temporalUpdateMaxChunkMs = publishMs;
    this.temporalUpdateVertices = 0;
    this.temporalResolvedVertices = 0;
    this.temporalFallbackVertices = 0;
    this.temporalScratchPeakBytes = 0;
    this.temporalUpdateCount++;
    dataset.temporalDisplayedAgeMa = temporal.requestedAgeMa.toFixed(6);
    dataset.temporalStatus = "ready";
    dataset.temporalUpdateMs = publishMs.toFixed(2);
    dataset.temporalUpdateMaxChunkMs = publishMs.toFixed(2);
    dataset.temporalUpdateTotalMs = publishMs.toFixed(2);
    dataset.temporalUpdateCount = String(this.temporalUpdateCount);
    dataset.temporalUpdateVertices = "0";
    dataset.temporalNativeReusedVertices = String(reusedVertices);
    dataset.temporalResolvedVertices = "0";
    dataset.temporalFallbackVertices = "0";
    dataset.temporalActiveFragments = String(activeFragmentCount);
    dataset.temporalMaterialDetailMethod = "exact-modern-native-cube-fields";
    dataset.temporalMaterialDetailProfile = surfaceDetail;
    dataset.temporalMaterialDetailTextureBytes = "0";
    dataset.temporalUpdateFrameBudgetMs = String(PALEOMAP_UPDATE_FRAME_BUDGET_MS);
    dataset.temporalRuggednessCacheBytes = String(temporalRuggednessCacheBytes());
    dataset.temporalRuggednessCacheEntryLimit = "2";
    if (this.snapshot?.geographicSourceAgeMa !== undefined) {
      dataset.temporalMaterialSourceAgeMa = String(this.snapshot.geographicSourceAgeMa);
    }
    dataset.cubeVisibleTiles = String(currentMeshes.length);
    this.updateCubeSourceDiagnostics(group);
    this.installDisplayedHeightSampler(
      this.createPublishedCubeHeightSampler(group),
      `${temporalKey}:published:r${++this.temporalGeometryRevision}`,
    );
    this.publishTemporalPoisIfReady();
    if (this.temporalCountries?.requestedAgeMa === temporal.requestedAgeMa) {
      this.setTemporalCountries(this.temporalCountries);
    }
    this.temporalInFlight = null;
    if (this.temporalSurface?.requestedAgeMa !== temporal.requestedAgeMa) {
      this.scheduleTemporalUpdate();
    }
  }

  private createPublishedCubeHeightSampler(group: THREE.Group): DisplayedHeightSampler {
    const tiles = group.children.flatMap((child) => {
      if (
        !(child instanceof THREE.Mesh) || !child.visible ||
        child.userData.temporalStaleLod === true
      ) return [];
      const fields = child.userData.cubeFields as CubeTileFields | undefined;
      if (fields === undefined) return [];
      const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
      return [{
        fields,
        positions: positions.array as Float32Array,
        bounds: cubeTileBounds(fields.key),
      }];
    });
    const exaggeration = this.verticalExaggeration;
    return {
      sampleHeightMetres(direction) {
        const length = Math.hypot(direction[0], direction[1], direction[2]);
        if (!(length > 0) || !Number.isFinite(length)) return 0;
        const unitDirection: [number, number, number] = [
          direction[0] / length,
          direction[1] / length,
          direction[2] / length,
        ];
        const faceUv = directionToCubeFaceUv(unitDirection);
        const tile = tiles
          .filter((candidate) =>
            candidate.fields.key.face === faceUv.face &&
            faceUv.u >= candidate.bounds.west - 1e-9 &&
            faceUv.u <= candidate.bounds.east + 1e-9 &&
            faceUv.v >= candidate.bounds.south - 1e-9 &&
            faceUv.v <= candidate.bounds.north + 1e-9
          )
          .sort((left, right) => right.fields.key.level - left.fields.key.level)[0];
        if (tile === undefined) return 0;
        const segments = tile.fields.meshSegments;
        const row = segments + 1;
        const tx = THREE.MathUtils.clamp(
          (faceUv.u - tile.bounds.west) / (tile.bounds.east - tile.bounds.west) * segments,
          0,
          segments,
        );
        const ty = THREE.MathUtils.clamp(
          (tile.bounds.north - faceUv.v) / (tile.bounds.north - tile.bounds.south) * segments,
          0,
          segments,
        );
        const x0 = Math.min(segments - 1, Math.floor(tx));
        const y0 = Math.min(segments - 1, Math.floor(ty));
        const fx = tx - x0;
        const fy = ty - y0;
        const radius = (x: number, y: number) => {
          const offset = (y * row + x) * 3;
          return Math.hypot(
            tile.positions[offset]!,
            tile.positions[offset + 1]!,
            tile.positions[offset + 2]!,
          );
        };
        const vertex = (x: number, y: number): [number, number, number] => {
          const offset = (y * row + x) * 3;
          return [
            tile.positions[offset]!,
            tile.positions[offset + 1]!,
            tile.positions[offset + 2]!,
          ];
        };
        const [a, b, c] = fx + fy <= 1
          ? [vertex(x0, y0), vertex(x0 + 1, y0), vertex(x0, y0 + 1)]
          : [vertex(x0 + 1, y0), vertex(x0 + 1, y0 + 1), vertex(x0, y0 + 1)];
        const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const;
        const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]] as const;
        const nx = ab[1] * ac[2] - ab[2] * ac[1];
        const ny = ab[2] * ac[0] - ab[0] * ac[2];
        const nz = ab[0] * ac[1] - ab[1] * ac[0];
        const denominator = nx * unitDirection[0] + ny * unitDirection[1] +
          nz * unitDirection[2];
        const planeRadius = Math.abs(denominator) < 1e-12
          ? Number.NaN
          : (nx * a[0] + ny * a[1] + nz * a[2]) / denominator;
        if (Number.isFinite(planeRadius) && planeRadius > 0) {
          return (planeRadius - 1) * EARTH_RADIUS_METRES / exaggeration;
        }
        const north = radius(x0, y0) * (1 - fx) + radius(x0 + 1, y0) * fx;
        const south = radius(x0, y0 + 1) * (1 - fx) + radius(x0 + 1, y0 + 1) * fx;
        return ((north * (1 - fy) + south * fy) - 1) * EARTH_RADIUS_METRES /
          exaggeration;
      },
    };
  }

  setLayers(layers: LayerVisibility): void {
    if (
      this.layers.clouds === layers.clouds &&
      this.layers.borders === layers.borders &&
      this.layers.guides === layers.guides &&
      this.layers.tectonics === layers.tectonics &&
      this.layers.rivers === layers.rivers
    ) return;
    const bordersChanged = this.layers.borders !== layers.borders;
    const guidesChanged = this.layers.guides !== layers.guides;
    const lineLayersChanged =
      this.layers.tectonics !== layers.tectonics ||
      this.layers.rivers !== layers.rivers;
    this.layers = layers;
    this.cloudMesh.visible = layers.clouds;
    if (lineLayersChanged) {
      this.rebuildOverlays();
    } else if (
      guidesChanged &&
      layers.guides &&
      !this.overlayGroup.children.some((child) => child.userData.overlayLayer === "guides")
    ) {
      this.rebuildOverlays();
    } else if (bordersChanged || guidesChanged) {
      for (const child of this.overlayGroup.children) {
        if (child.userData.overlayLayer === "borders") child.visible = layers.borders;
        if (child.userData.overlayLayer === "guides") child.visible = layers.guides;
      }
      this.renderer.domElement.dataset.countryRibbonVisible = String(layers.borders);
      this.renderer.domElement.dataset.referenceGuideVisible = String(layers.guides);
    }
    this.updateCaoCoordinateReadiness();
    if (
      this.caoInFlight !== null &&
      this.renderer.domElement.dataset.periodCoordinateWaitingForReferences !== undefined
    ) {
      this.scheduleCaoSurfaceUpdate();
    }
  }

  setSelectedPoi(id: string | null): void {
    this.selectedPoiId = id;
    for (const child of this.markerGroup.children) {
      if (!(child instanceof THREE.Sprite)) continue;
      const selected = child.userData.poiId === id;
      child.userData.markerTargetPixels = selected ? 12 : 9;
      child.material.color.set(selected ? 0xffd98a : 0x98dddc);
      child.material.opacity = selected ? 1 : 0.84;
    }
    this.updatePoiMarkerScale();
  }

  private updatePoiMarkerScale(): void {
    const viewportHeight = Math.max(1, this.renderer.domElement.clientHeight);
    const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) /
      viewportHeight;
    this.markerGroup.getWorldScale(this.markerWorldScale);
    const parentScale = Math.max(1e-6, this.markerWorldScale.x);
    for (const child of this.markerGroup.children) {
      if (!(child instanceof THREE.Sprite)) continue;
      const pixels = Number(child.userData.markerTargetPixels ?? 9);
      child.getWorldPosition(this.markerWorldPosition);
      const distance = this.camera.position.distanceTo(this.markerWorldPosition);
      child.scale.setScalar(pixels * worldPerPixel * distance / parentScale);
    }
    this.renderer.domElement.dataset.poiMarkerPixels = "9";
    this.renderer.domElement.dataset.poiSelectedMarkerPixels = "12";
  }

  setAutoRotate(value: boolean): void {
    if (!value) this.cancelControlInertia();
    this.autoRotate = value;
  }

  setQuality(value: RequestedQuality): void {
    this.requestedQuality = value;
    const next = initialEffectiveQuality(value);
    if (next !== this.effectiveQuality) this.applyEffectiveQuality(next);
  }

  setVerticalExaggeration(value: number): void {
    const clamped = THREE.MathUtils.clamp(Number.isFinite(value) ? value : 8, 1, 30);
    if (clamped === this.verticalExaggeration) return;
    this.verticalExaggeration = clamped;
    this.reliefScalePending = true;
  }

  setSurfaceMode(mode: SurfaceMode): void {
    if (mode === this.surfaceMode) return;
    this.surfaceMode = mode;
    this.regionalRequestSerial++;
    this.regionalWorker.cancel();
    this.cubeWorker.cancel();
    this.invalidateCubeRefinement();
    this.removeRegionalPatch();
    if (this.snapshot !== null) void this.loadSurface();
  }

  focus(
    coordinates: LonLat,
    requestedDistance?: number,
    kind: SpatialFocusKind = "area",
  ): void {
    this.prefetchModernRelief(coordinates);
    this.renderer.domElement.dataset.focusKind = kind;
    const direction = lonLatToVector3(coordinates).applyQuaternion(this.globeGroup.quaternion).normalize();
    this.focusAnimation = {
      from: this.camera.position.clone().normalize(),
      to: direction,
      fromDistance: this.camera.position.length(),
      toDistance: requestedDistance === undefined
        ? this.camera.position.length()
        : THREE.MathUtils.clamp(requestedDistance, 1.15, 5.8),
      started: performance.now(),
    };
  }

  clearFocus(): void {
    this.focusAnimation = null;
    this.cancelControlInertia();
    this.renderer.domElement.dataset.focusKind = "none";
  }

  resetCamera(): void {
    this.clearFocus();
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(2.41, 1.2, 2.51);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();

    if (this.regionalPatch !== null) this.regionalPatch.visible = false;
    const cameraDistance = this.camera.position.length();
    if (Math.abs(cameraDistance - this.lastReportedCameraDistance) > 0.0001) {
      this.lastReportedCameraDistance = cameraDistance;
      this.renderer.domElement.dataset.cameraDistance = cameraDistance.toFixed(4);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    if (this.temporalUpdateHandle !== null) cancelAnimationFrame(this.temporalUpdateHandle);
    if (this.temporalCountryHandle !== null) window.clearTimeout(this.temporalCountryHandle);
    if (this.temporalCountryPreviewHandle !== null) {
      cancelAnimationFrame(this.temporalCountryPreviewHandle);
    }
    if (this.temporalSettleHandle !== null) window.clearTimeout(this.temporalSettleHandle);
    if (this.overlayRebuildHandle !== null) window.clearTimeout(this.overlayRebuildHandle);
    if (this.cameraRefreshHandle !== null) window.clearTimeout(this.cameraRefreshHandle);
    this.worker.dispose();
    this.regionalWorker.dispose();
    this.cubeWorker.dispose();
    this.cache.clear();
    this.regionalCache.clear();
    this.cubeCache.clear();
    this.cubeRootFields.clear();
    this.countryRibbonCache = null;
    this.resizeObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.handleMotionPreference);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.removeEventListener("start", this.handleControlsStart);
    this.controls.removeEventListener("end", this.handleControlsEnd);
    this.controls.dispose();
    this.finishSurfaceTransition();
    this.finishCubeTransition();
    if (this.cubeSurfaceGroup !== null) {
      this.disposeCubeGroup(this.cubeSurfaceGroup);
      this.cubeSurfaceGroup = null;
    }
    if (this.cubeHeldVisibleGroup !== null) {
      this.disposeCubeGroup(this.cubeHeldVisibleGroup);
      this.cubeHeldVisibleGroup = null;
    }
    this.cubeHeldVisibleSnapshotId = null;
    this.updateSurfaceVisibleMeshCount();
    for (const textures of this.retiredTextureSets) this.disposeTextures(textures);
    this.retiredTextureSets.clear();
    this.textures && this.disposeTextures(this.textures);
    this.markerTexture.dispose();
    this.satelliteMaterialTextures.detail.dispose();
    this.satelliteMaterialTextures.albedo.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        if (!(object instanceof THREE.Sprite)) object.geometry?.dispose();
        const ownedTexture = object.userData.ownedTexture as THREE.Texture | undefined;
        ownedTexture?.dispose();
        disposeMaterial(object.material);
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    if (window.__earthHistoryDiagnostics !== undefined) {
      delete window.__earthHistoryDiagnostics;
    }
  }

  private makeGlobeGeometry(): THREE.BufferGeometry {
    return createPoleSafeShellGeometry(1, this.effectiveQuality === "high" ? 24 : 16);
  }

  private makeCloudGeometry(): THREE.BufferGeometry {
    return createPoleSafeShellGeometry(1.014, this.effectiveQuality === "high" ? 18 : 12);
  }

  private applyEffectiveQuality(value: "high" | "low"): void {
    this.finishSurfaceTransition();
    this.cubeWorker.cancel();
    this.invalidateCubeRefinement();
    this.effectiveQuality = value;
    this.globeMesh.geometry.dispose();
    this.globeMesh.geometry = this.makeGlobeGeometry();
    this.cloudMesh.geometry.dispose();
    this.cloudMesh.geometry = this.makeCloudGeometry();
    this.resize();
    if (value === "low" && this.detail === "regional") this.detail = "coarse";
    if (this.snapshot !== null) void this.loadSurface();
  }

  private invalidateCubeRefinement(): void {
    this.cubeContext = null;
    this.cubeContextKey = null;
    this.cubeDesiredLeaves = [];
    this.cubePreviousLeafKeys = [];
    this.cubeSelectionSerial++;
    this.renderer.domElement.dataset.cubeRefinementStatus = "waiting-base";
  }

  private updateAtmosphere(stage: SurfaceStage | undefined, opacity: number): void {
    const material = this.atmosphereMesh.material;
    if (Array.isArray(material)) return;
    const hot = stage === "giant-impact" || stage === "magma-ocean" || stage === "cooling-crust";
    material.opacity = Math.max(0.06, Math.min(0.28, opacity * (hot ? 0.26 : 0.14)));
    if ("color" in material && material.color instanceof THREE.Color) {
      material.color.set(hot ? 0xff6a2f : 0x87d5ff);
    }
  }

  private async loadSurface(): Promise<void> {
    const snapshot = this.snapshot;
    if (snapshot === null) return;
    const detail = this.effectiveQuality === "low" ? "coarse" : this.detail;
    const key = `${snapshot.id}:${detail}:${this.surfaceMode}`;
    const serial = ++this.requestSerial;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      this.applySurface(cached, detail);
      return;
    }
    this.renderer.domElement.dataset.surfaceStatus = "generating";
    this.renderer.domElement.dataset.surfaceRequestedAt = performance.now().toFixed(2);
    try {
      const fields = await this.worker.request(snapshot, detail, this.surfaceMode);
      if (this.disposed || serial !== this.requestSerial || snapshot !== this.snapshot) return;
      this.cache.set(key, fields);
      this.generationMs = fields.generationMs;
      this.applySurface(fields, detail);
    } catch (error) {
      if (serial === this.requestSerial && !this.disposed) {
        this.renderer.domElement.dataset.surfaceStatus = "error";
        if (!(error instanceof Error) || error.message !== "Surface request superseded") {
          console.error("Surface generation failed", error);
        }
      }
    }
  }

  private applySurface(fields: SurfaceFields, detail: SurfaceDetail): void {
    this.removeRegionalPatch();
    const textures: TextureSet = {
      albedo: createTexture(fields.albedo, fields.width, fields.height, true),
      relief: createTexture(fields.relief, fields.width, fields.height),
      roughness: createTexture(fields.roughness, fields.width, fields.height),
      clouds: createTexture(fields.clouds, fields.cloudWidth, fields.cloudHeight, true),
    };
    const previousTextures = this.textures;
    const wasAlreadyTransitioning = this.surfaceTransition !== null;
    if (wasAlreadyTransitioning) this.finishSurfaceTransition();
    const nextSnapshotId = this.snapshot?.id ?? null;
    const shouldCrossfade =
      previousTextures !== null &&
      this.displayedSnapshotId !== null &&
      nextSnapshotId !== this.displayedSnapshotId &&
      this.cubeSurfaceGroup === null &&
      !wasAlreadyTransitioning &&
      !this.reducedMotion.matches;
    if (previousTextures !== null && shouldCrossfade) {
      const oldMaterial = this.globeMesh.material.clone();
      oldMaterial.transparent = true;
      oldMaterial.opacity = 1;
      oldMaterial.depthTest = false;
      oldMaterial.depthWrite = false;
      const oldMesh = new THREE.Mesh(this.globeMesh.geometry, oldMaterial);
      oldMesh.renderOrder = 0.5;
      this.globeGroup.add(oldMesh);
      this.surfaceTransition = {
        mesh: oldMesh,
        textures: previousTextures,
        started: performance.now(),
      };
      this.renderer.domElement.dataset.surfaceTransition = "crossfade";
      this.renderer.domElement.dataset.surfaceTransitionStartedAt =
        this.surfaceTransition.started.toFixed(2);
    } else if (previousTextures !== null) {
      this.renderer.domElement.dataset.surfaceTransition = "idle";
    }
    this.textures = textures;
    this.activeSurfaceFields = fields;
    this.activeSurfaceDetail = detail;
    this.displayedSnapshotId = nextSnapshotId;
    this.reliefRangeMetres = fields.reliefRangeMetres;
    this.reliefBiasMetres = fields.reliefBiasMetres;
    this.currentRivers = fields.rivers;
    if (this.snapshot !== null && this.cubeSurfaceGroup === null) {
      const samplerKey = `fallback:${this.snapshot.id}:${this.surfaceMode}:${detail}`;
      this.installDisplayedHeightSampler(createSurfaceFieldHeightSampler(fields), samplerKey);
    }
    this.globeMesh.material.color.set(0xffffff);
    this.globeMesh.material.emissive.set(this.surfaceMode === "seafloor" ? 0x061b24 : 0x000000);
    this.globeMesh.material.emissiveIntensity = this.surfaceMode === "seafloor" ? 0.28 : 0;
    this.globeMesh.material.roughness = this.surfaceMode === "seafloor" ? 0.91 : 0.82;
    this.globeMesh.material.clearcoat = this.surfaceMode === "seafloor" ? 0.015 : 0.08;
    this.globeMesh.material.map = textures.albedo;
    this.globeMesh.material.bumpMap = textures.relief;
    this.applyReliefScale();
    this.globeMesh.material.displacementMap = textures.relief;
    this.globeMesh.material.roughnessMap = textures.roughness;
    this.globeMesh.material.needsUpdate = true;
    this.cloudMesh.material.map = textures.clouds;
    this.cloudMesh.material.alphaMap = textures.clouds;
    this.cloudMesh.material.needsUpdate = true;
    if (previousTextures !== null && !shouldCrossfade) {
      this.retireTextures(previousTextures);
    }
    // Keep the previous surface's overlays paired with its visible cube during
    // a transition. The incoming cube installs a matching sampler and rebuilds
    // them atomically; rebuilding here would block refresh and briefly drape
    // new linework against stale heights.
    if (this.cubeSurfaceGroup === null) this.rebuildOverlays();
    this.renderer.domElement.dataset.surfaceStatus = "ready";
    this.renderer.domElement.dataset.surfaceReadyAt = performance.now().toFixed(2);
    this.updateSurfaceVisibleMeshCount();
    void this.loadCubeSurface(fields, detail);
  }

  private applyReliefScale(): void {
    const maximumDisplacement = reliefDisplacementScale(
      this.verticalExaggeration,
      this.reliefRangeMetres,
    );
    this.globeMesh.material.displacementScale = maximumDisplacement;
    this.globeMesh.material.displacementBias =
      (this.reliefBiasMetres / EARTH_RADIUS_METRES) * this.verticalExaggeration;
    this.globeMesh.material.bumpScale =
      this.detail === "regional"
        ? 0
        : (this.effectiveQuality === "high" ? 0.0065 : 0.0045) *
          Math.sqrt(this.verticalExaggeration);
    this.globeMesh.material.needsUpdate = true;

    const maximumPositiveDisplacement =
      ((this.reliefBiasMetres + this.reliefRangeMetres) / EARTH_RADIUS_METRES) *
      this.verticalExaggeration;
    const cloudRadius = 1.007 + maximumPositiveDisplacement;
    this.cloudMesh.scale.setScalar(cloudRadius / 1.014);
    this.overlayGroup.scale.setScalar(1);
    if (this.snapshot?.periodCoordinateView?.id !== "cao-2024-v2.4") {
      this.updateDrapedOverlays();
    }
    this.markerGroup.scale.setScalar((1.008 + maximumPositiveDisplacement) / 1.028);
    const atmosphereRadius = 1.006 + Math.min(maximumPositiveDisplacement, 0.004);
    this.atmosphereMesh.scale.setScalar(atmosphereRadius / 1.006);
    this.renderer.domElement.dataset.verticalExaggeration =
      this.verticalExaggeration.toFixed(1);
    this.renderer.domElement.dataset.maxReliefDisplacement =
      maximumPositiveDisplacement.toFixed(6);
    this.renderer.domElement.dataset.surfaceMode = this.surfaceMode;
  }

  private disposeTextures(textures: TextureSet): void {
    textures.albedo.dispose();
    textures.relief.dispose();
    textures.roughness.dispose();
    textures.clouds.dispose();
  }

  private retireTextures(textures: TextureSet): void {
    this.retiredTextureSets.add(textures);
    this.disposeUnreferencedRetiredTextures();
  }

  private disposeUnreferencedRetiredTextures(): void {
    if (this.retiredTextureSets.size === 0) return;
    const liveMaterials: Array<THREE.Material | THREE.Material[]> = [];
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh || object instanceof THREE.Line ||
        object instanceof THREE.Points || object instanceof THREE.Sprite
      ) liveMaterials.push(object.material);
    });
    for (const textures of this.retiredTextureSets) {
      const ownedTextures = new Set<THREE.Texture>([
        textures.albedo,
        textures.relief,
        textures.roughness,
        textures.clouds,
      ]);
      if (materialsReferenceAnyTexture(liveMaterials, ownedTextures)) continue;
      this.retiredTextureSets.delete(textures);
      this.disposeTextures(textures);
    }
  }

  private installDisplayedHeightSampler(
    sampler: DisplayedHeightSampler,
    displayKey: string,
  ): void {
    if (displayKey === this.displayedHeightSamplerKey) return;
    this.displayedHeightSampler = sampler;
    this.displayedHeightSamplerKey = displayKey;
    this.renderer.domElement.dataset.overlayDrapeSurfaceKey = displayKey;
    this.scheduleOverlayRebuild(displayKey);
  }

  private scheduleOverlayRebuild(displayKey: string): void {
    if (this.overlayRebuildHandle !== null) window.clearTimeout(this.overlayRebuildHandle);
    this.renderer.domElement.dataset.overlayDrapeStatus = "updating";
    this.overlayRebuildHandle = window.setTimeout(() => {
      this.overlayRebuildHandle = null;
      if (this.disposed || this.displayedHeightSamplerKey !== displayKey) return;
      this.rebuildOverlays();
      this.overlayGroup.visible = true;
    }, 0);
  }

  private async loadCubeSurface(fields: SurfaceFields, detail: SurfaceDetail): Promise<void> {
    const snapshot = this.snapshot;
    if (snapshot === null) return;
    const serial = ++this.cubeRequestSerial;
    const reliefMetadata = this.modernReliefMetadataAt(this.cameraCenter());
    const sourceKey = reliefMetadata === undefined
      ? "procedural"
      : `${reliefMetadata.sourceProduct}:${reliefMetadata.id}`;
    const contextKey = `${snapshot.id}:${this.surfaceMode}:${detail}:${sourceKey}`;
    this.renderer.domElement.dataset.cubeStatus =
      reliefMetadata === undefined ? "generating" : "loading-source";
    this.renderer.domElement.dataset.cubeRequestedSnapshotId = snapshot.id;
    this.renderer.domElement.dataset.cubeRequestedKey = contextKey;
    this.renderer.domElement.dataset.cubeRequestedAt = performance.now().toFixed(2);
    let modernRelief: ModernReliefPatch[] | undefined;
    if (reliefMetadata !== undefined) {
      try {
        modernRelief = [await getModernReliefPatch(reliefMetadata.id)];
      } catch (error) {
        if (serial === this.cubeRequestSerial && !this.disposed) {
          this.renderer.domElement.dataset.cubeStatus = "error";
          console.error("Cube relief source failed", error);
        }
        return;
      }
      if (
        this.disposed || serial !== this.cubeRequestSerial || snapshot !== this.snapshot ||
        fields !== this.activeSurfaceFields || detail !== this.activeSurfaceDetail
      ) return;
      this.renderer.domElement.dataset.cubeStatus = "generating";
    }
    const context: CubeTileFieldContext = {
      snapshot: workerSnapshot(snapshot),
      surface: fields,
      mode: this.surfaceMode,
      detail,
      modernRelief,
    };
    if (contextKey !== this.cubeContextKey) {
      this.cubeWorker.cancel();
      this.invalidateCubeRefinement();
      this.cubeCache.clear();
    }
    // Roots are deliberately cheap parents. Screen-sized child tiles restore
    // local material density incrementally while this complete globe remains.
    const meshSegments: 32 | 64 = 32;
    const textureSize: 128 | 256 = 128;
    const requests: CubeTileFieldRequest[] = CUBE_FACES.map((face) => ({
      key: { face, level: 0, x: 0, y: 0 },
      meshSegments,
      textureSize,
    }));
    const cached = requests.map((request) =>
      this.cubeCache.get(cubeTileId(request.key)),
    );
    if (cached.every((item): item is CubeTileFields => item !== undefined)) {
      this.cubeContext = context;
      this.cubeContextKey = contextKey;
      this.applyCubeSurface(cached, contextKey, snapshot.id);
      return;
    }

    const postedAt = performance.now();
    try {
      const result = await this.cubeWorker.request(
        contextKey,
        context,
        requests,
        this.effectiveQuality === "high" ? this.cubeWorker.maxConcurrency : 1,
      );
      const receivedAt = performance.now();
      if (
        this.disposed || serial !== this.cubeRequestSerial || snapshot !== this.snapshot ||
        fields !== this.activeSurfaceFields || detail !== this.activeSurfaceDetail
      ) return;
      this.cubeGenerationMs = result.generationMs;
      for (const tile of result.fields) {
        this.cubeCache.set(cubeTileId(tile.key), tile);
      }
      this.renderer.domElement.dataset.cubeWorkerRoundTripMs = (receivedAt - postedAt).toFixed(2);
      this.renderer.domElement.dataset.cubeWorkerGenerationMs = result.generationMs.toFixed(2);
      this.renderer.domElement.dataset.cubeWorkerOverheadMs =
        Math.max(0, receivedAt - postedAt - result.generationMs).toFixed(2);
      this.renderer.domElement.dataset.cubeRetainedWorkerBytes = String(result.retainedBytes);
      this.cubeContext = context;
      this.cubeContextKey = contextKey;
      this.applyCubeSurface(result.fields, contextKey, snapshot.id);
    } catch (error) {
      if (
        serial === this.cubeRequestSerial && !this.disposed &&
        (!(error instanceof Error) || error.message !== "Cube surface request superseded")
      ) {
        this.renderer.domElement.dataset.cubeStatus = "error";
        console.error("Cube surface generation failed", error);
      }
    }
  }

  private applyCubeSurface(
    fields: CubeTileFields[],
    displayKey: string,
    snapshotId: string,
  ): void {
    if (fields.length !== CUBE_FACES.length) return;
    const installStarted = performance.now();
    if (displayKey !== this.cubeDisplayedKey) {
      this.cubeDesiredLeaves = [];
      this.cubePreviousLeafKeys = [];
      this.cubeRootFields.clear();
      this.cubeSelectionSerial++;
    }
    const group = new THREE.Group();
    group.name = "adaptive-cube-sphere";
    for (const field of fields) {
      this.cubeCache.set(cubeTileId(field.key), field);
      this.cubeRootFields.set(field.key.face, field);
      group.add(this.createCubeMesh(field, undefined, true));
    }
    const stagesTemporalReplacement = group.children.some((child) =>
      child instanceof THREE.Mesh && child.userData.temporalReplacement === true
    );

    if (this.cubeTransition !== null) this.finishCubeTransition();
    const previous = this.cubeSurfaceGroup;
    const previousSnapshotId = this.cubeDisplayedSnapshotId;
    this.cubeSurfaceGroup = group;
    this.cubeDisplayedKey = displayKey;
    this.cubeDisplayedSnapshotId = snapshotId;
    this.renderer.domElement.dataset.cubeDisplayedKey = displayKey;
    this.renderer.domElement.dataset.cubeDisplayedSnapshotId = snapshotId;
    this.globeGroup.add(group);
    if (!stagesTemporalReplacement) this.globeMesh.visible = false;
    this.updateCubeReliefScale();
    if (previous !== null) {
      if (stagesTemporalReplacement) {
        if (this.cubeHeldVisibleGroup === null) {
          this.cubeHeldVisibleGroup = previous;
          this.cubeHeldVisibleSnapshotId = previousSnapshotId;
        } else if (previous !== this.cubeHeldVisibleGroup) {
          this.disposeCubeGroup(previous);
        }
        this.renderer.domElement.dataset.cubeHeldVisible = "true";
      } else {
        if (this.cubeHeldVisibleGroup !== null) {
          this.disposeCubeGroup(this.cubeHeldVisibleGroup);
          this.cubeHeldVisibleGroup = null;
          this.cubeHeldVisibleSnapshotId = null;
          delete this.renderer.domElement.dataset.cubeHeldVisible;
        }
        const shouldCrossfade =
          snapshotId !== previousSnapshotId && !this.reducedMotion.matches;
        if (shouldCrossfade) {
          for (const child of previous.children) {
            if (!(child instanceof THREE.Mesh)) continue;
            child.material.transparent = true;
            child.material.depthWrite = false;
            child.renderOrder = 0.5;
          }
          this.cubeTransition = { group: previous, started: performance.now() };
          this.renderer.domElement.dataset.surfaceTransition = "crossfade";
        } else {
          this.disposeCubeGroup(previous);
        }
      }
    }
    this.renderer.domElement.dataset.cubeStatus = "ready";
    const baseDisplayedAt = performance.now();
    this.renderer.domElement.dataset.cubeReadyAt = baseDisplayedAt.toFixed(2);
    this.renderer.domElement.dataset.cubeBaseDisplayedAt = baseDisplayedAt.toFixed(2);
    delete this.renderer.domElement.dataset.cubeFirstRefinementAt;
    delete this.renderer.domElement.dataset.cubeTargetLodCompleteAt;
    this.renderer.domElement.dataset.cubeInstallMs =
      (performance.now() - installStarted).toFixed(2);
    if (!stagesTemporalReplacement) {
      this.renderer.domElement.dataset.cubeVisibleTiles = "6";
      this.renderer.domElement.dataset.cubeVisibleSnapshotId = snapshotId;
    } else if (this.cubeHeldVisibleGroup !== null) {
      this.renderer.domElement.dataset.cubeVisibleTiles = String(
        this.cubeHeldVisibleGroup.children.filter((child) => child.visible).length,
      );
      if (this.cubeHeldVisibleSnapshotId !== null) {
        this.renderer.domElement.dataset.cubeVisibleSnapshotId =
          this.cubeHeldVisibleSnapshotId;
      }
    } else {
      // The newly loaded equirectangular fallback remains visible until the
      // first model-coordinate cube publication is complete.
      this.renderer.domElement.dataset.cubeVisibleSnapshotId = snapshotId;
    }
    this.renderer.domElement.dataset.cubeMaxNeighborLevelDelta = "0";
    // A regional request may have committed while the new cube base was still
    // loading. Replace it only after the base is installed, then request the
    // current source again so the higher-resolution layer cannot be lost to
    // this transaction ordering.
    this.regionalRequestSerial++;
    this.regionalWorker.cancel();
    this.removeRegionalPatch();
    if (this.focusAnimation === null) {
      this.scheduleCubeRefinement();
    } else {
      // The automatic camera flight ends with one final refresh. Generating
      // successive 96-leaf plans along that 950 ms path only creates tiles
      // that the next animation frame abandons.
      this.renderer.domElement.dataset.cubeRefinementStatus = "waiting-focus";
    }
    this.scheduleTemporalUpdate();
    if (this.detail === "regional") void this.loadRegionalPatch();
    this.updateSurfaceVisibleMeshCount();
  }

  private createCubeMesh(
    field: CubeTileFields,
    coarseEdges = { north: false, east: false, south: false, west: false },
    stageTemporalReplacement = false,
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> {
    const meshData = createCubeTileMesh(field, this.verticalExaggeration, coarseEdges);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(meshData.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(meshData.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geometry.computeBoundingSphere();
    const sourceTextures = {
      map: createTexture(field.albedo, field.textureStride, field.textureStride, true),
      roughnessMap: createTexture(field.roughness, field.textureStride, field.textureStride),
      bumpMap: createTexture(field.detailHeight, field.textureStride, field.textureStride),
    };
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: sourceTextures.map,
      roughness: this.surfaceMode === "seafloor" ? 0.91 : 0.82,
      roughnessMap: sourceTextures.roughnessMap,
      bumpMap: sourceTextures.bumpMap,
      // The bump texture is deterministic material-scale synthesis. It reveals
      // source-controlled slopes in orbital light without adding elevation.
      bumpScale: CUBE_MATERIAL_BUMP_SCALE * Math.sqrt(this.verticalExaggeration),
      metalness: 0,
      clearcoat: this.surfaceMode === "seafloor" ? 0.015 : 0.08,
      clearcoatRoughness: 0.5,
      ior: 1.37,
      specularIntensity: this.surfaceMode === "seafloor" ? 0.18 : 0.3,
      emissive: this.surfaceMode === "seafloor" ? 0x061b24 : 0x000000,
      emissiveIntensity: this.surfaceMode === "seafloor" ? 0.25 : 0,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `cube-${cubeTileId(field.key)}`;
    mesh.userData.cubeFields = field;
    mesh.userData.coarseEdges = { ...coarseEdges };
    mesh.userData.sourceTextures = sourceTextures;
    if (
      stageTemporalReplacement &&
      (this.temporalSurface !== null || this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4")
    ) {
      mesh.visible = false;
      mesh.userData.temporalReplacement = true;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  private selectCubeLeaves(): CubeLodLeaf[] {
    const started = performance.now();
    const localDirection = this.camera.position
      .clone()
      .normalize()
      .applyQuaternion(this.globeGroup.quaternion.clone().invert());
    const maximumPositiveDisplacement =
      ((this.reliefBiasMetres + this.reliefRangeMetres) / EARTH_RADIUS_METRES) *
      this.verticalExaggeration;
    const caoCoordinateView = this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4";
    const lodLimits = cubeLodLimitsForRenderState({
      quality: this.effectiveQuality,
      temporal: this.temporalSurface !== null,
      settled: this.temporalSettled,
      caoCoordinateView,
    });
    const selection = selectCubeLod({
      camera: {
        direction: [localDirection.x, localDirection.y, localDirection.z],
        distance: this.camera.position.length(),
        verticalFovRadians: THREE.MathUtils.degToRad(this.camera.fov),
        viewportHeight: Math.max(1, this.mount.clientHeight),
      },
      previousKeys: this.cubePreviousLeafKeys,
      maxLevel: lodLimits.maxLevel,
      maxLeaves: lodLimits.maxLeaves,
      horizonPaddingRadians:
        0.015 + reliefHorizonExtensionRadians(
          this.camera.position.length(),
          maximumPositiveDisplacement,
        ),
    });
    this.renderer.domElement.dataset.cubeLodMaxLevel = String(lodLimits.maxLevel);
    this.renderer.domElement.dataset.cubeLodMaxLeaves = String(lodLimits.maxLeaves);
    this.cubePreviousLeafKeys = selection.leaves.map((leaf) => leaf.key);
    this.cubeSelectionMs = performance.now() - started;
    this.cubeLastSelectionDirection.copy(localDirection);
    this.cubeLastSelectionDistance = this.camera.position.length();
    this.cubeLastSelectionViewportHeight = Math.max(1, this.mount.clientHeight);
    this.cubeLastSelectionAt = performance.now();
    this.cubeMaxNeighborLevelDelta = selection.leaves.reduce(
      (maximum, leaf) => Math.max(
        maximum,
        ...Object.values(leaf.neighbors).flat().map((neighbor) =>
          Math.abs(neighbor.levelDelta)
        ),
      ),
      0,
    );
    this.renderer.domElement.dataset.cubeSelectionMs = this.cubeSelectionMs.toFixed(2);
    this.renderer.domElement.dataset.cubeDesiredTiles = String(selection.leaves.length);
    this.renderer.domElement.dataset.cubeSelectionCapped = String(selection.capped);
    return selection.leaves;
  }

  private cubeSelectionNeedsRefresh(now: number): boolean {
    if (
      this.cubeSurfaceGroup === null || this.cubeContext === null ||
      now - this.cubeLastSelectionAt < 80
    ) return false;
    const localDirection = this.camera.position
      .clone()
      .normalize()
      .applyQuaternion(this.globeGroup.quaternion.clone().invert());
    const directionChanged =
      !Number.isFinite(this.cubeLastSelectionDirection.x) ||
      localDirection.dot(this.cubeLastSelectionDirection) < Math.cos(THREE.MathUtils.degToRad(0.8));
    const distance = this.camera.position.length();
    const distanceChanged =
      !Number.isFinite(this.cubeLastSelectionDistance) ||
      Math.abs(distance - this.cubeLastSelectionDistance) >
        Math.max(0.008, this.cubeLastSelectionDistance * 0.008);
    const viewportChanged =
      Math.abs(this.mount.clientHeight - this.cubeLastSelectionViewportHeight) >= 8;
    return directionChanged || distanceChanged || viewportChanged;
  }

  private scheduleCubeRefinement(): void {
    if (
      this.disposed || this.cubeSurfaceGroup === null ||
      this.cubeContext === null || this.cubeContextKey === null
    ) return;
    this.cubeDesiredLeaves = this.selectCubeLeaves();
    this.cubeSelectionSerial++;
    this.renderer.domElement.dataset.cubeTargetLodRequestedAt = performance.now().toFixed(2);
    this.renderer.domElement.dataset.cubeRefinementStatus = "planning";
    this.syncCubeRenderPlan();
    if (!this.cubeRefinementRunning) void this.runCubeRefinement();
  }

  private updateCubeSourceDiagnostics(group: THREE.Group): void {
    const displayedPatchIds = new Set<string>();
    let displayedMinimumHeight = Number.POSITIVE_INFINITY;
    let displayedMaximumHeight = Number.NEGATIVE_INFINITY;
    let sourceMinimumHeight = Number.POSITIVE_INFINITY;
    let sourceMaximumHeight = Number.NEGATIVE_INFINITY;
    let sourceMaterialTileCount = 0;
    let sourceMaterialTextureBytes = 0;
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh) || !child.visible) continue;
      const field = child.userData.cubeFields as CubeTileFields | undefined;
      if (field === undefined) continue;
      for (const id of field.sourcePatchIds) displayedPatchIds.add(id);
      if (field.sourcePatchIds.length > 0) {
        sourceMaterialTileCount++;
        sourceMaterialTextureBytes +=
          field.albedo.byteLength + field.roughness.byteLength + field.detailHeight.byteLength;
      }
      displayedMinimumHeight = Math.min(displayedMinimumHeight, field.minHeightMetres);
      displayedMaximumHeight = Math.max(displayedMaximumHeight, field.maxHeightMetres);
      sourceMinimumHeight = Math.min(
        sourceMinimumHeight,
        field.minSourceMaterialHeightMetres ?? field.minHeightMetres,
      );
      sourceMaximumHeight = Math.max(
        sourceMaximumHeight,
        field.maxSourceMaterialHeightMetres ?? field.maxHeightMetres,
      );
    }
    this.renderer.domElement.dataset.cubeSourcePatchIds =
      [...displayedPatchIds].sort().join(",") || "none";
    this.renderer.domElement.dataset.cubeSourceMaterialTiles = String(sourceMaterialTileCount);
    this.renderer.domElement.dataset.cubeSourceMaterialTextureBytes =
      String(sourceMaterialTextureBytes);
    if (Number.isFinite(displayedMinimumHeight) && Number.isFinite(displayedMaximumHeight)) {
      this.renderer.domElement.dataset.cubeDisplayedHeightRangeMetres =
        `${displayedMinimumHeight.toFixed(1)},${displayedMaximumHeight.toFixed(1)}`;
    }
    if (Number.isFinite(sourceMinimumHeight) && Number.isFinite(sourceMaximumHeight)) {
      this.renderer.domElement.dataset.cubeSourceMaterialHeightRangeMetres =
        `${sourceMinimumHeight.toFixed(1)},${sourceMaximumHeight.toFixed(1)}`;
    }
  }

  private syncCubeRenderPlan(): ReturnType<typeof planCubeRender> {
    const installStarted = performance.now();
    this.pinRenderedCubeFields();
    const group = this.cubeSurfaceGroup;
    const renderedKeys = (group?.children ?? []).flatMap((child) => {
      if (!(child instanceof THREE.Mesh)) return [];
      const field = child.userData.cubeFields as CubeTileFields | undefined;
      return field === undefined ? [] : [field.key];
    });
    const plan = planCubeRender(
      this.cubeDesiredLeaves.map((leaf) => leaf.key),
      cubeRenderResidentIds(this.cubeCache.keys(), renderedKeys),
    );
    if (group === null) return plan;
    const actualLeaves = describeCubeLodLeaves(plan.renderKeys);
    const actualById = new Map(actualLeaves.map((leaf) => [leaf.id, leaf]));
    this.cubeMaxNeighborLevelDelta = actualLeaves.reduce(
      (maximum, leaf) => Math.max(
        maximum,
        ...Object.values(leaf.neighbors).flat().map((neighbor) =>
          Math.abs(neighbor.levelDelta)
        ),
      ),
      0,
    );
    const requestedIds = new Set(actualLeaves.map((leaf) => leaf.id));
    const existing = new Map<string, THREE.Mesh>();
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const field = child.userData.cubeFields as CubeTileFields | undefined;
      if (field !== undefined) existing.set(cubeTileId(field.key), child);
    }
    // Add every replacement first, then remove its complete parent set in the
    // same main-thread turn. No render can observe an incomplete child swap.
    let addedRefinement = false;
    let nativeDisplayChanged = false;
    for (const leaf of actualLeaves) {
      const { key, id, coarseEdges } = leaf;
      const current = existing.get(id);
      if (current !== undefined) {
        delete current.userData.temporalStaleLod;
        const previousEdges = current.userData.coarseEdges as
          | { north: boolean; east: boolean; south: boolean; west: boolean }
          | undefined;
        if (!sameCubeEdgeFlags(previousEdges, coarseEdges)) {
          current.userData.coarseEdges = { ...coarseEdges };
          if (
            this.temporalSurface !== null ||
            this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4"
          ) {
            delete current.userData.temporalKey;
            delete current.userData.temporalPending;
            delete current.userData.temporalPendingKey;
          } else {
            this.updateCubeMeshGeometry(current, current.userData.cubeFields, coarseEdges);
            nativeDisplayChanged = true;
          }
        }
        continue;
      }
      const field = this.cubeCache.get(id);
      if (field !== undefined) {
        group.add(this.createCubeMesh(field, coarseEdges, true));
        nativeDisplayChanged = true;
        if (key.level > 0) addedRefinement = true;
      }
    }
    for (const [id, child] of existing) {
      if (requestedIds.has(id)) continue;
      if (
        this.temporalSurface !== null ||
        this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4"
      ) {
        // A hidden replacement has never been published, so retaining it
        // cannot preserve a visible coherent frame. Dispose it immediately;
        // only the last visible publication waits for the atomic successor.
        if (!child.visible) {
          group.remove(child);
          this.disposeCubeMesh(child);
          continue;
        }
        child.userData.temporalStaleLod = true;
        continue;
      }
      group.remove(child);
      this.disposeCubeMesh(child);
      nativeDisplayChanged = true;
    }
    this.cubeInstallMs = performance.now() - installStarted;
    if (
      addedRefinement &&
      this.renderer.domElement.dataset.cubeFirstRefinementAt === undefined
    ) {
      this.renderer.domElement.dataset.cubeFirstRefinementAt = performance.now().toFixed(2);
    }
    this.renderer.domElement.dataset.cubeInstallMs = this.cubeInstallMs.toFixed(2);
    this.renderer.domElement.dataset.cubeVisibleTiles = String(
      group.children.filter((child) => child.visible).length,
    );
    this.updateCubeSourceDiagnostics(group);
    this.renderer.domElement.dataset.cubeMaxNeighborLevelDelta =
      String(this.cubeMaxNeighborLevelDelta);
    this.renderer.domElement.dataset.cubeVisibleByLod = JSON.stringify(
      Object.fromEntries(Array.from({ length: 5 }, (_, level) => [
        level,
        actualLeaves.filter((leaf) => leaf.key.level === level).length,
      ])),
    );
    this.renderer.domElement.dataset.cubeVisibleByFace = JSON.stringify(
      Object.fromEntries(CUBE_FACES.map((face) => [
        face,
        actualLeaves.filter((leaf) => leaf.key.face === face).length,
      ])),
    );
    if (
      nativeDisplayChanged && this.temporalSurface === null &&
      this.snapshot?.periodCoordinateView?.id !== "cao-2024-v2.4"
    ) {
      const displayKey = `${this.cubeContextKey ?? "native"}:mesh:r${++this.temporalGeometryRevision}`;
      this.installDisplayedHeightSampler(this.createPublishedCubeHeightSampler(group), displayKey);
    }
    this.scheduleTemporalUpdate();
    return plan;
  }

  private prioritizeCubeRequests(keys: CubeTileKey[]): CubeTileKey[] {
    const score = (key: CubeTileKey) => this.cubeDesiredLeaves.reduce(
        (maximum, leaf) => cubeKeyContains(key, leaf.key)
          ? Math.max(maximum, leaf.projectedErrorPx)
          : maximum,
        0,
      );
    const groups = new Map<string, CubeTileKey[]>();
    for (const key of keys) {
      const parentId = key.level === 0
        ? cubeTileId(key)
        : cubeTileId({
            face: key.face,
            level: key.level - 1,
            x: Math.floor(key.x / 2),
            y: Math.floor(key.y / 2),
          });
      const siblings = groups.get(parentId) ?? [];
      siblings.push(key);
      groups.set(parentId, siblings);
    }
    return [...groups.entries()]
      .sort((left, right) =>
        Math.max(...right[1].map(score)) - Math.max(...left[1].map(score)) ||
        left[0].localeCompare(right[0]),
      )
      .flatMap(([, siblings]) => siblings.sort((left, right) =>
        cubeTileId(left).localeCompare(cubeTileId(right))
      ));
  }

  private pinRenderedCubeFields(): void {
    for (const field of this.cubeRootFields.values()) {
      const id = cubeTileId(field.key);
      if (this.cubeCache.get(id) === undefined) this.cubeCache.set(id, field);
    }
    for (const child of this.cubeSurfaceGroup?.children ?? []) {
      if (!(child instanceof THREE.Mesh)) continue;
      const field = child.userData.cubeFields as CubeTileFields | undefined;
      if (field === undefined || child.userData.temporalStaleLod === true) continue;
      const id = cubeTileId(field.key);
      // Mesh userData already owns the field arrays. Touch an existing cache
      // entry, but do not recreate one after eviction; render planning includes
      // mesh-owned fields separately above.
      this.cubeCache.get(id);
    }
    for (const leaf of this.cubeDesiredLeaves) {
      let key: CubeTileKey | undefined = leaf.key;
      while (key !== undefined) {
        this.cubeCache.get(cubeTileId(key));
        key = key.level === 0
          ? undefined
          : {
              face: key.face,
              level: key.level - 1,
              x: Math.floor(key.x / 2),
              y: Math.floor(key.y / 2),
            };
      }
    }
  }

  private async runCubeRefinement(): Promise<void> {
    if (this.cubeRefinementRunning) return;
    this.cubeRefinementRunning = true;
    let canContinue = true;
    try {
      while (
        !this.disposed && this.cubeContext !== null && this.cubeContextKey !== null &&
        this.cubeSurfaceGroup !== null
      ) {
        const context = this.cubeContext;
        const contextKey = this.cubeContextKey;
        const plan = this.syncCubeRenderPlan();
        if (plan.complete) {
          const completeAt = performance.now();
          this.renderer.domElement.dataset.cubeRefinementStatus = "ready";
          this.renderer.domElement.dataset.cubeRefinementReadyAt = completeAt.toFixed(2);
          this.renderer.domElement.dataset.cubeTargetLodCompleteAt = completeAt.toFixed(2);
          break;
        }
        if (plan.nextRequests.length === 0) {
          this.renderer.domElement.dataset.cubeRefinementStatus = "stalled";
          break;
        }
        const uncached: CubeTileKey[] = [];
        for (const key of this.prioritizeCubeRequests(plan.nextRequests)) {
          const cached = this.cubeCache.get(cubeTileId(key));
          if (cached === undefined) uncached.push(key);
        }
        if (uncached.length === 0) continue;
        const requests: CubeTileFieldRequest[] = uncached.slice(
          0,
          this.temporalSurface?.exactEndpoint === false ? 4 : 24,
        ).map((key) => ({
          key,
          meshSegments: 32,
          // At level four this still resolves roughly ten kilometres per
          // material texel, near the authored regional control resolution.
          textureSize: 64,
        }));
        this.renderer.domElement.dataset.cubeRefinementStatus = "generating";
        this.renderer.domElement.dataset.cubeRefinementQueuedTiles = String(requests.length);
        const selectionSerial = this.cubeSelectionSerial;
        const postedAt = performance.now();
        const result = await this.cubeWorker.request(
          contextKey,
          context,
          requests,
          this.effectiveQuality === "high" ? this.cubeWorker.maxConcurrency : 1,
        );
        const receivedAt = performance.now();
        if (
          this.disposed || context !== this.cubeContext || contextKey !== this.cubeContextKey
        ) continue;
        if (selectionSerial !== this.cubeSelectionSerial) {
          this.cubeStaleTileJobs += result.fields.length;
        }
        this.pinRenderedCubeFields();
        for (const field of result.fields) {
          this.cubeCache.set(cubeTileId(field.key), field);
        }
        this.renderer.domElement.dataset.cubeRefinementGenerationMs =
          result.generationMs.toFixed(2);
        this.renderer.domElement.dataset.cubeRefinementRoundTripMs =
          (receivedAt - postedAt).toFixed(2);
        this.renderer.domElement.dataset.cubeRetainedWorkerBytes = String(result.retainedBytes);
      }
    } catch (error) {
      if (
        !this.disposed &&
        (!(error instanceof Error) || error.message !== "Cube surface request superseded")
      ) {
        canContinue = false;
        this.renderer.domElement.dataset.cubeRefinementStatus = "error";
        console.error("Cube refinement failed", error);
      }
    } finally {
      this.cubeRefinementRunning = false;
      if (
        canContinue && !this.disposed && this.cubeContext !== null && this.cubeContextKey !== null &&
        this.cubeSurfaceGroup !== null
      ) {
        const current = this.syncCubeRenderPlan();
        if (!current.complete && current.nextRequests.length > 0) {
          void this.runCubeRefinement();
        }
      }
    }
  }

  private disposeCubeMesh(mesh: THREE.Mesh): void {
    mesh.geometry.dispose();
    const material = mesh.material as THREE.MeshPhysicalMaterial;
    const sourceTextures = mesh.userData.sourceTextures as
      | { map: THREE.Texture; roughnessMap: THREE.Texture; bumpMap: THREE.Texture }
      | undefined;
    if (sourceTextures !== undefined) {
      sourceTextures.map.dispose();
      sourceTextures.roughnessMap.dispose();
      sourceTextures.bumpMap.dispose();
    } else {
      material.map?.dispose();
      material.roughnessMap?.dispose();
      material.bumpMap?.dispose();
    }
    material.dispose();
  }

  private updateCubeReliefScale(): void {
    const group = this.cubeSurfaceGroup;
    if (group === null) return;
    if (this.snapshot?.periodCoordinateView?.id === "cao-2024-v2.4") {
      // Keep the published Cao geometry coherent while the new exaggeration is
      // staged. Replaying original cubeFields here would briefly reveal the
      // PALEOMAP source frame beneath Cao vertex colors.
      for (const child of group.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        delete child.userData.temporalPending;
        delete child.userData.temporalPendingKey;
      }
      this.caoInFlight = null;
      this.caoSurfaceResolver = null;
      this.temporalUpdateJobKey = null;
      this.renderer.domElement.dataset.cubeReliefUpdate = "atomic-cao-restage";
      this.scheduleCaoSurfaceUpdate();
      return;
    }
    if (this.temporalSurface !== null) {
      // A PALEOMAP material-coordinate publication owns the visible geometry
      // at exact knots as well as between them. Retain that coherent frame
      // while the new exaggeration is staged; replaying cubeFields here would
      // briefly restore endpoint coordinates and the native bump amplitude.
      for (const child of group.children) {
        if (!(child instanceof THREE.Mesh)) continue;
        delete child.userData.temporalPending;
        delete child.userData.temporalPendingKey;
      }
      if (this.temporalUpdateHandle !== null) {
        cancelAnimationFrame(this.temporalUpdateHandle);
        this.temporalUpdateHandle = null;
      }
      this.temporalInFlight = null;
      this.temporalUpdateJobKey = null;
      this.renderer.domElement.dataset.cubeReliefUpdate = "atomic-temporal-restage";
      if (this.temporalCatalog === null) {
        void this.prepareTemporalResolver(this.temporalSurface.intervalId);
      } else {
        this.temporalResolver = createPeriodMaterialResolver(
          this.temporalCatalog,
          this.temporalSurface.requestedAgeMa,
        );
        this.scheduleTemporalUpdate();
      }
      return;
    }
    this.renderer.domElement.dataset.cubeReliefUpdate = "native-immediate";
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const fields = child.userData.cubeFields as CubeTileFields | undefined;
      if (fields === undefined) continue;
      const coarseEdges = child.userData.coarseEdges as
        | { north: boolean; east: boolean; south: boolean; west: boolean }
        | undefined;
      this.updateCubeMeshGeometry(
        child,
        fields,
        coarseEdges ?? { north: false, east: false, south: false, west: false },
      );
      child.material.bumpScale = CUBE_MATERIAL_BUMP_SCALE * Math.sqrt(this.verticalExaggeration);
    }
    const displayKey = `${this.cubeContextKey ?? "native"}:mesh:r${++this.temporalGeometryRevision}`;
    this.installDisplayedHeightSampler(this.createPublishedCubeHeightSampler(group), displayKey);
  }

  private updateCubeMeshGeometry(
    mesh: THREE.Mesh<THREE.BufferGeometry>,
    fields: CubeTileFields,
    coarseEdges: Readonly<{ north: boolean; east: boolean; south: boolean; west: boolean }>,
  ): void {
    const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const normals = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
    updateCubeTileMeshGeometry(
      fields,
      this.verticalExaggeration,
      coarseEdges,
      positions.array as Float32Array,
      normals.array as Float32Array,
    );
    positions.needsUpdate = true;
    normals.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }

  private disposeCubeGroup(group: THREE.Group): void {
    this.globeGroup.remove(group);
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      this.disposeCubeMesh(child);
    }
    group.clear();
    this.disposeUnreferencedRetiredTextures();
  }

  private finishCubeTransition(): void {
    if (this.cubeTransition === null) return;
    this.disposeCubeGroup(this.cubeTransition.group);
    this.cubeTransition = null;
    this.renderer.domElement.dataset.surfaceTransition = "idle";
    this.updateSurfaceVisibleMeshCount();
  }

  private finishStagedCubeReplacement(): void {
    this.globeMesh.visible = false;
    if (this.cubeHeldVisibleGroup !== null) {
      this.disposeCubeGroup(this.cubeHeldVisibleGroup);
      this.cubeHeldVisibleGroup = null;
    }
    this.cubeHeldVisibleSnapshotId = null;
    if (this.cubeDisplayedSnapshotId !== null) {
      this.renderer.domElement.dataset.cubeVisibleSnapshotId =
        this.cubeDisplayedSnapshotId;
    }
    delete this.renderer.domElement.dataset.cubeHeldVisible;
    this.updateSurfaceVisibleMeshCount();
    this.disposeUnreferencedRetiredTextures();
  }

  private updateSurfaceVisibleMeshCount(): void {
    let count = this.globeMesh.visible ? 1 : 0;
    const groups = new Set<THREE.Group>();
    if (this.cubeSurfaceGroup !== null) groups.add(this.cubeSurfaceGroup);
    if (this.cubeHeldVisibleGroup !== null) groups.add(this.cubeHeldVisibleGroup);
    if (this.cubeTransition !== null) groups.add(this.cubeTransition.group);
    for (const group of groups) {
      count += group.children.filter((child) =>
        child instanceof THREE.Mesh && child.visible
      ).length;
    }
    this.renderer.domElement.dataset.surfaceVisibleMeshes = String(count);
  }

  private finishSurfaceTransition(): void {
    const transition = this.surfaceTransition;
    if (transition === null) return;
    this.globeGroup.remove(transition.mesh);
    transition.mesh.material.dispose();
    this.disposeTextures(transition.textures);
    this.surfaceTransition = null;
    this.renderer.domElement.dataset.surfaceTransition = "idle";
    delete this.renderer.domElement.dataset.surfaceTransitionProgress;
  }

  private cameraCenter(): LonLat {
    const inverseGlobeRotation = this.globeGroup.quaternion.clone().invert();
    const localDirection = this.camera.position
      .clone()
      .normalize()
      .applyQuaternion(inverseGlobeRotation);
    return vector3ToLonLat(localDirection);
  }

  private modernReliefMetadataAt(
    coordinates: LonLat,
    surfaceMode: SurfaceMode = this.surfaceMode,
  ) {
    const snapshot = this.snapshot;
    if (snapshot === null) return undefined;
    const requestedAge = snapshot.requestedAgeMa ?? snapshot.ageMa;
    const focalPixels = Math.max(1, this.mount.clientHeight) /
      (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const surfaceDistanceMetres = Math.max(0.01, this.camera.position.length() - 1) *
      EARTH_RADIUS_METRES;
    const metadataById = new Map(surfaceRefinementTiles.map((metadata) => [metadata.id, metadata]));
    const projectedErrorPixels = new Map(surfaceRefinementTiles.map((metadata) => {
      const parent = metadata.parentId === undefined
        ? metadata
        : metadataById.get(metadata.parentId) ?? metadata;
      const deliveredSpacingMetres = THREE.MathUtils.degToRad(
        Math.max(parent.longitudeStep, parent.latitudeStep),
      ) * EARTH_RADIUS_METRES;
      return [
        metadata.id,
        Math.max(parent.maxErrorMetres, deliveredSpacingMetres) /
          surfaceDistanceMetres * focalPixels,
      ];
    }));
    const previousTileId = surfaceRefinementTiles.find((metadata) =>
      this.cubeContextKey?.endsWith(`:${metadata.sourceProduct}:${metadata.id}`)
    )?.id;
    return selectSurfaceRefinementMetadata(surfaceRefinementTiles, {
      coordinates,
      requestedAgeMa: requestedAge,
      surfaceMode,
      referenceFrameId: "present-day-geographic",
      previousTileId,
      projectedErrorPixels,
    })[0];
  }

  private refreshCubeForCamera(): void {
    if (this.activeSurfaceFields === null) return;
    const metadata = this.modernReliefMetadataAt(this.cameraCenter());
    const expectedSource = metadata === undefined
      ? "procedural"
      : `${metadata.sourceProduct}:${metadata.id}`;
    if (this.cubeContextKey === null || !this.cubeContextKey.endsWith(`:${expectedSource}`)) {
      void this.loadCubeSurface(this.activeSurfaceFields, this.activeSurfaceDetail);
      return;
    }
    this.scheduleCubeRefinement();
  }

  private prefetchModernRelief(coordinates: LonLat): void {
    const metadata = this.modernReliefMetadataAt(coordinates);
    if (metadata === undefined) return;
    this.renderer.domElement.dataset.regionalSourcePrefetchStartedAt =
      performance.now().toFixed(2);
    void getModernReliefPatch(metadata.id)
      .then(() => {
        if (this.disposed) return;
        this.renderer.domElement.dataset.regionalSourcePrefetchReadyAt =
          performance.now().toFixed(2);
      })
      .catch(() => {
        if (!this.disposed) {
          this.renderer.domElement.dataset.regionalSourcePrefetchStatus = "error";
        }
      });
  }

  private updateInspectionLight(): void {
    // Keep the inspected region on the day side while retaining an oblique
    // angle that exposes regional normals and a terminator across the globe.
    setInspectionLightPosition(
      this.sunLight.position,
      this.camera.position,
      this.camera.quaternion,
      this.inspectionLightScratch,
    );
  }

  private async loadRegionalPatch(): Promise<void> {
    const snapshot = this.snapshot;
    const surfaceMode = this.surfaceMode;
    this.regionalRequestSerial++;
    this.regionalWorker.cancel();
    this.removeRegionalPatch();
    if (
      snapshot?.controls === undefined ||
      this.detail !== "regional" ||
      this.effectiveQuality === "low" ||
      this.textures === null
    ) {
      this.renderer.domElement.dataset.regionalStatus = "idle";
      return;
    }

    // The adaptive cube is the sole visible and sampled terrain surface. Local
    // source elevation, gradients, and denser material texels are generated in
    // its intersecting tiles; the legacy regional overlay would duplicate that
    // geometry, cover its native material, and disagree with overlay draping.
    const cameraCenter = this.cameraCenter();
    const reliefMetadata = this.modernReliefMetadataAt(cameraCenter, surfaceMode);
    const expectedSource = reliefMetadata === undefined
      ? "procedural"
      : `${reliefMetadata.sourceProduct}:${reliefMetadata.id}`;
    const cubeOwnsSource = this.cubeContextKey?.endsWith(`:${expectedSource}`) === true;
    this.renderer.domElement.dataset.regionalStrategy = "cube-native";
    this.renderer.domElement.dataset.regionalSource = reliefMetadata?.id ?? "procedural";
    this.renderer.domElement.dataset.regionalVisible = "false";
    if (!cubeOwnsSource || this.cubeDisplayedKey === null) {
      this.renderer.domElement.dataset.regionalStatus = "awaiting-cube";
      delete this.renderer.domElement.dataset.regionalAppliedKey;
      return;
    }
    this.renderer.domElement.dataset.regionalStatus = "ready";
    this.renderer.domElement.dataset.regionalAppliedKey = this.cubeDisplayedKey;
    this.renderer.domElement.dataset.regionalReadyAt = performance.now().toFixed(2);
  }

  private applyRegionalPatch(fields: RegionalPatchFields, key: string): void {
    const installStartedAt = performance.now();
    this.removeRegionalPatch();
    if (this.textures === null) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(fields.directions.length), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(fields.uvs, 2));
    const colors = new Float32Array(fields.heightsMetres.length * 3);
    let bathymetryVertices = 0;
    for (let index = 0; index < fields.heightsMetres.length; index++) {
      const offset = index * 3;
      const signedHeight = fields.sourceMaterialHeightsMetres[index];
      const sourceBlend = fields.sourceBlendWeights[index];
      if (this.surfaceMode === "surface" && signedHeight < 0 && sourceBlend > 0) {
        const depth = THREE.MathUtils.smoothstep(-signedHeight, 120, 8_500);
        const mix = sourceBlend * (0.5 + 0.35 * depth);
        colors[offset] = THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(0.7, 0.34, depth), mix);
        colors[offset + 1] = THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(1.02, 0.68, depth), mix);
        colors[offset + 2] = THREE.MathUtils.lerp(1, THREE.MathUtils.lerp(1.08, 0.92, depth), mix);
        bathymetryVertices++;
      } else {
        colors[offset] = 1;
        colors[offset + 1] = 1;
        colors[offset + 2] = 1;
      }
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(fields.indices, 1));
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: this.textures.albedo,
      roughness: 0.82,
      roughnessMap: this.textures.roughness,
      bumpMap: fields.sourcePatchId === undefined ? this.textures.relief : null,
      bumpScale: 0.008,
      metalness: 0,
      specularIntensity: 0.24,
      emissive: this.surfaceMode === "seafloor" ? 0x061b24 : 0x000000,
      emissiveIntensity: this.surfaceMode === "seafloor" ? 0.34 : 0,
      // The patch occupies only the camera-facing 24° footprint. Drawing it as
      // the local surface prevents the lower half of its signed fine relief
      // from being clipped by the coarse displaced sphere underneath.
      depthTest: false,
      depthWrite: false,
    });
    const patch = new THREE.Mesh(geometry, material);
    patch.renderOrder = 1;
    this.regionalPatch = patch;
    this.regionalPatchFields = fields;
    this.globeGroup.add(patch);
    this.updateRegionalPatchScale();
    this.renderer.domElement.dataset.regionalStatus = "ready";
    this.renderer.domElement.dataset.regionalAppliedKey = key;
    this.renderer.domElement.dataset.regionalVisible = "true";
    this.renderer.domElement.dataset.regionalReadyAt = performance.now().toFixed(2);
    this.renderer.domElement.dataset.regionalInstallMs =
      (performance.now() - installStartedAt).toFixed(2);
    this.renderer.domElement.dataset.regionalVertices = String(fields.size * fields.size);
    this.renderer.domElement.dataset.regionalSyntheticLimitMetres = "250";
    this.renderer.domElement.dataset.regionalSource = fields.sourcePatchId ?? "procedural";
    this.renderer.domElement.dataset.regionalBathymetryVertices = String(bathymetryVertices);
    if (fields.sourcePatchId !== undefined) {
      let sourceMinimum = Number.POSITIVE_INFINITY;
      let sourceMaximum = Number.NEGATIVE_INFINITY;
      for (const height of fields.sourceMaterialHeightsMetres) {
        sourceMinimum = Math.min(sourceMinimum, height);
        sourceMaximum = Math.max(sourceMaximum, height);
      }
      this.renderer.domElement.dataset.regionalSourceHeightRangeMetres =
        `${sourceMinimum.toFixed(1)},${sourceMaximum.toFixed(1)}`;
    } else {
      delete this.renderer.domElement.dataset.regionalSourceHeightRangeMetres;
    }
  }

  private updateRegionalPatchScale(): void {
    const patch = this.regionalPatch;
    const fields = this.regionalPatchFields;
    const surface = this.activeSurfaceFields;
    if (patch === null || fields === null || surface === null) return;
    const positions = patch.geometry.getAttribute("position") as THREE.BufferAttribute;
    // First derive normals from the signed source topobathymetry. In surface
    // mode this makes a ridge or trench readable through blue water without
    // moving the water shell itself. The same position buffer is immediately
    // reused for the actual displayed mesh, so no duplicate geometry remains.
    for (let index = 0; index < fields.heightsMetres.length; index++) {
      const baseHeight = sampleSurfaceReliefMetres(
        surface,
        fields.uvs[index * 2],
        fields.uvs[index * 2 + 1],
      );
      const sourceBlend = fields.sourceBlendWeights[index];
      const materialBase = THREE.MathUtils.lerp(
        baseHeight,
        fields.sourceMaterialHeightsMetres[index],
        sourceBlend,
      );
      const materialExaggeration = this.surfaceMode === "surface" && materialBase < 0
        ? Math.min(6, 1 + (this.verticalExaggeration - 1) * 0.22)
        : this.verticalExaggeration;
      const radius = 1 +
        ((materialBase + fields.syntheticDetailMetres[index]) / EARTH_RADIUS_METRES) *
          materialExaggeration;
      positions.setXYZ(
        index,
        fields.directions[index * 3] * radius,
        fields.directions[index * 3 + 1] * radius,
        fields.directions[index * 3 + 2] * radius,
      );
    }
    positions.needsUpdate = true;
    patch.geometry.computeVertexNormals();

    for (let index = 0; index < fields.heightsMetres.length; index++) {
      const baseHeight = sampleSurfaceReliefMetres(
        surface,
        fields.uvs[index * 2],
        fields.uvs[index * 2 + 1],
      );
      const sourceBlend = fields.sourceBlendWeights[index];
      const localBase = THREE.MathUtils.lerp(
        baseHeight,
        fields.sourceHeightsMetres[index],
        sourceBlend,
      );
      const radius = 1 +
        ((localBase + fields.syntheticDetailMetres[index]) / EARTH_RADIUS_METRES) *
          this.verticalExaggeration;
      positions.setXYZ(
        index,
        fields.directions[index * 3] * radius,
        fields.directions[index * 3 + 1] * radius,
        fields.directions[index * 3 + 2] * radius,
      );
    }
    positions.needsUpdate = true;
    patch.geometry.computeBoundingSphere();
    patch.material.bumpScale = 0.005 * Math.sqrt(this.verticalExaggeration);
    patch.material.needsUpdate = true;
  }

  private removeRegionalPatch(): void {
    if (this.regionalPatch !== null) {
      this.globeGroup.remove(this.regionalPatch);
      this.regionalPatch.geometry.dispose();
      this.regionalPatch.material.dispose();
    }
    this.regionalPatch = null;
    this.regionalPatchFields = null;
    this.renderer.domElement.dataset.regionalVisible = "false";
    delete this.renderer.domElement.dataset.regionalAppliedKey;
    if (this.renderer.domElement.dataset.regionalStatus === "ready") {
      this.renderer.domElement.dataset.regionalStatus = "idle";
    }
  }

  private rebuildOverlays(): void {
    clearGroup(this.overlayGroup);
    clearGroup(this.markerGroup);
    const snapshot = this.snapshot;
    if (snapshot === null) return;

    const sampler = this.displayedHeightSampler ?? {
      sampleHeightMetres: () => 0,
    };
    let cachedBytes = 0;
    let vertexCount = 0;
    let countryRibbonBatches = 0;
    let countryRibbonBytes = 0;
    let countryRibbonVertices = 0;
    let countryRibbonSourceRuns = 0;
    let countryRibbonRenderedRuns = 0;
    let referenceGuideBatches = 0;
    let referenceGuideBytes = 0;
    let referenceGuideVertices = 0;
    let budgetExceeded = false;
    const addDrapedLine = (
      coordinates: LonLat[],
      material: THREE.LineBasicMaterial,
      clearanceMetres: number,
      renderOrder: number,
      evidence?: string,
    ) => {
      if (coordinates.length < 2 || budgetExceeded) {
        material.dispose();
        return;
      }
      let drapes: DrapedLineData[];
      try {
        drapes = createDrapedLineDataSegments(coordinates, sampler, clearanceMetres);
      } catch (error) {
        material.dispose();
        budgetExceeded = true;
        console.warn("Scientific overlay exceeded its bounded drape geometry", error);
        return;
      }
      for (const drape of drapes) {
        if (drape.positions.length < 6) continue;
        if (cachedBytes + drape.byteLength > MAX_OVERLAY_CACHE_BYTES) {
          budgetExceeded = true;
          break;
        }
        updateDrapedLinePositions(drape, this.verticalExaggeration);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(drape.positions, 3));
        geometry.computeBoundingSphere();
        const line = new THREE.Line(geometry, material.clone());
        line.renderOrder = renderOrder;
        line.userData.drapedLine = drape;
        if (evidence !== undefined) line.userData.evidence = evidence;
        this.overlayGroup.add(line);
        cachedBytes += drape.byteLength;
        vertexCount += drape.heightsMetres.length;
      }
      material.dispose();
    };

    const countries = this.temporalCountries?.countries ?? snapshot.countries;
    if (countries.length > 0) {
      try {
        countryRibbonSourceRuns = countries.reduce(
          (total, country) => total + country.lines.length,
          0,
        );
        let batches: CountryRibbonBatchData[];
        const regionalWidthMetres = Math.round(THREE.MathUtils.lerp(
          900,
          2_500,
          THREE.MathUtils.smoothstep(this.camera.position.length(), 1.15, 1.4),
        ));
        const grooveHalfWidthMetres = this.detail === "regional"
          ? regionalWidthMetres
          : 5_000;
        const ribbonSurfaceKey =
          `${snapshot.id}:${this.detail}:${grooveHalfWidthMetres}:${this.displayedHeightSamplerKey ?? "sphere"}`;
        if (this.countryRibbonCache?.surfaceKey === ribbonSurfaceKey) {
          batches = this.countryRibbonCache.batches;
          for (const batch of batches) {
            resampleCountryRibbonHeights(batch, sampler, this.verticalExaggeration);
          }
        } else {
          batches = createCountryRibbonBatches(countries, sampler, {
            maxAngularStepDegrees: 0.4,
            maxHeightErrorMetres: 120,
            maxAdaptiveDepth: 1,
            grooveHalfWidthMetres,
            minimumRunLengthMetres: this.detail === "regional" ? 20_000 : 60_000,
            verticalExaggeration: this.verticalExaggeration,
            includeRim: false,
          });
          this.countryRibbonCache = { surfaceKey: ribbonSurfaceKey, batches };
        }
        this.renderer.domElement.dataset.countryRibbonHalfWidthMetres =
          String(grooveHalfWidthMetres);
        const evidence = countries.every((country) => country.evidence === "observed")
          ? "observed"
          : "model-output";
        const sourceIds = [...new Set(countries.flatMap((country) => country.sourceIds))];
        for (const batch of batches) {
          if (cachedBytes + batch.byteLength > MAX_OVERLAY_CACHE_BYTES) {
            budgetExceeded = true;
            break;
          }
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(batch.positions, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(batch.directions, 3));
          geometry.setIndex(new THREE.BufferAttribute(batch.indices, 1));
          geometry.computeBoundingSphere();
          const material = new THREE.MeshStandardMaterial({
            color: 0x3e6057,
            roughness: 1,
            metalness: 0,
            transparent: true,
            opacity: 0.6,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          });
          const ribbon = new THREE.Mesh(geometry, material);
          ribbon.renderOrder = 3;
          ribbon.visible = this.layers.borders;
          ribbon.userData.countryRibbon = batch;
          ribbon.userData.overlayLayer = "borders";
          ribbon.userData.evidence = evidence;
          ribbon.userData.sourceIds = sourceIds;
          this.overlayGroup.add(ribbon);
          cachedBytes += batch.byteLength;
          vertexCount += batch.heightsMetres.length;
          countryRibbonBatches += 1;
          countryRibbonBytes += batch.byteLength;
          countryRibbonVertices += batch.heightsMetres.length;
          countryRibbonRenderedRuns = Math.max(countryRibbonRenderedRuns, batch.runCount);
        }
      } catch (error) {
        budgetExceeded = true;
        console.warn("Country reference exceeded its bounded ribbon geometry", error);
      }
    }

    if (this.layers.guides) try {
      const guide = createReferenceGuideRibbon(
        sampler,
        this.detail,
        this.verticalExaggeration,
      );
      if (guide !== undefined) {
        if (cachedBytes + guide.byteLength > MAX_OVERLAY_CACHE_BYTES) {
          budgetExceeded = true;
        } else {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(guide.positions, 3));
          geometry.setAttribute("normal", new THREE.BufferAttribute(guide.directions, 3));
          geometry.setIndex(new THREE.BufferAttribute(guide.indices, 1));
          geometry.computeBoundingSphere();
          const material = new THREE.MeshBasicMaterial({
            color: 0x8bb9b2,
            transparent: true,
            opacity: 0.68,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -4,
            polygonOffsetUnits: -4,
          });
          const ribbon = new THREE.Mesh(geometry, material);
          ribbon.renderOrder = 2.8;
          ribbon.visible = this.layers.guides;
          ribbon.userData.countryRibbon = guide;
          ribbon.userData.overlayLayer = "guides";
          ribbon.userData.evidence = "schematic-climatological-reference";
          ribbon.userData.sourceIds = ["noaa-global-circulation"];
          this.overlayGroup.add(ribbon);
          cachedBytes += guide.byteLength;
          vertexCount += guide.heightsMetres.length;
          referenceGuideBatches = 1;
          referenceGuideBytes = guide.byteLength;
          referenceGuideVertices = guide.heightsMetres.length;
          for (const label of REFERENCE_GUIDE_LABELS) {
            const patch = createReferenceGuideLabelPatch(
              label,
              sampler,
              this.verticalExaggeration,
            );
            const addedBytes = patch.byteLength + REFERENCE_GUIDE_LABEL_TEXTURE_BYTES;
            if (
              cachedBytes + addedBytes > MAX_OVERLAY_CACHE_BYTES ||
              referenceGuideBytes + addedBytes > REFERENCE_GUIDE_MAX_BYTES
            ) {
              budgetExceeded = true;
              break;
            }
            const texture = createGuideLabelTexture(label.text);
            const labelGeometry = new THREE.BufferGeometry();
            labelGeometry.setAttribute("position", new THREE.BufferAttribute(patch.positions, 3));
            labelGeometry.setAttribute("normal", new THREE.BufferAttribute(patch.directions, 3));
            labelGeometry.setAttribute("uv", new THREE.BufferAttribute(patch.uvs, 2));
            labelGeometry.setIndex(new THREE.BufferAttribute(patch.indices, 1));
            labelGeometry.computeBoundingSphere();
            const printedLabel = new THREE.Mesh(labelGeometry, new THREE.MeshStandardMaterial({
              map: texture,
              color: 0xb7ccc5,
              transparent: true,
              opacity: 0.42,
              alphaTest: 0.025,
              depthTest: true,
              depthWrite: false,
              roughness: 1,
              metalness: 0,
              polygonOffset: true,
              polygonOffsetFactor: -3,
              polygonOffsetUnits: -3,
            }));
            printedLabel.renderOrder = 2.9;
            printedLabel.userData.overlayLayer = "guides";
            printedLabel.userData.referenceGuideLabelPatch = patch;
            printedLabel.userData.ownedTexture = texture;
            printedLabel.userData.evidence = "schematic-climatological-reference";
            printedLabel.userData.sourceIds = ["noaa-global-circulation"];
            this.overlayGroup.add(printedLabel);
            cachedBytes += addedBytes;
            vertexCount += patch.heightsMetres.length;
            referenceGuideBytes += addedBytes;
            referenceGuideVertices += patch.heightsMetres.length;
          }
          for (const coordinates of REFERENCE_GUIDE_POLES) {
            if (
              cachedBytes + REFERENCE_GUIDE_POLE_TEXTURE_BYTES > MAX_OVERLAY_CACHE_BYTES ||
              referenceGuideBytes + REFERENCE_GUIDE_POLE_TEXTURE_BYTES >
                REFERENCE_GUIDE_MAX_BYTES
            ) {
              budgetExceeded = true;
              break;
            }
            const direction = lonLatToVector3(coordinates).normalize();
            const heightMetres = sampler.sampleHeightMetres([
              direction.x,
              direction.y,
              direction.z,
            ]);
            const texture = createPoleMarkerTexture();
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
              map: texture,
              transparent: true,
              opacity: 0.96,
              alphaTest: 0.025,
              depthTest: true,
              depthWrite: false,
            }));
            const radius = 1 +
              (heightMetres * this.verticalExaggeration + 650) / EARTH_RADIUS_METRES;
            sprite.position.copy(direction).multiplyScalar(radius);
            sprite.scale.setScalar(0.05);
            sprite.renderOrder = 3;
            sprite.userData.overlayLayer = "guides";
            sprite.userData.guideLabelDirection = direction;
            sprite.userData.guideLabelHeightMetres = heightMetres;
            sprite.userData.guideLabelClearanceMetres = 650;
            sprite.userData.guidePoleMarker = true;
            sprite.userData.ownedTexture = texture;
            sprite.userData.evidence = "geographic-reference";
            this.overlayGroup.add(sprite);
            cachedBytes += REFERENCE_GUIDE_POLE_TEXTURE_BYTES;
            referenceGuideBytes += REFERENCE_GUIDE_POLE_TEXTURE_BYTES;
          }
        }
      }
    } catch (error) {
      budgetExceeded = true;
      console.warn("Reference guides exceeded their bounded ribbon geometry", error);
    }

    if (this.layers.tectonics) {
      const colors: Record<string, number> = {
        rift: 0xffb05c,
        mountain: 0xe9d8af,
        subduction: 0xff7662,
        volcano: 0xff583d,
      };
      for (const feature of snapshot.tectonics) {
        addDrapedLine(
          feature.coordinates,
          new THREE.LineBasicMaterial({
            color: colors[feature.type],
            transparent: true,
            opacity: 0.86,
            depthWrite: false,
          }),
          4_000,
          4,
        );
      }
    }

    if (this.layers.rivers && this.detail === "regional") {
      const material = new THREE.LineBasicMaterial({
        color: 0x6ccbd0,
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
      });
      for (const corridor of this.currentRivers) {
        addDrapedLine(corridor, material.clone(), 1_500, 4, "inferred-drainage");
      }
      material.dispose();
    }

    this.renderer.domElement.dataset.overlayDrapeStatus = budgetExceeded ? "bounded" : "ready";
    this.renderer.domElement.dataset.overlayDrapeVertices = String(vertexCount);
    this.renderer.domElement.dataset.overlayDrapeCacheBytes = String(cachedBytes);
    this.renderer.domElement.dataset.overlayDrapeMaxStepDegrees =
      DEFAULT_OVERLAY_STEP_DEGREES.toFixed(2);
    this.renderer.domElement.dataset.overlayDrapeExaggeration =
      this.verticalExaggeration.toFixed(1);
    this.renderer.domElement.dataset.countryRibbonBatches = String(countryRibbonBatches);
    this.renderer.domElement.dataset.countryRibbonBytes = String(countryRibbonBytes);
    this.renderer.domElement.dataset.countryRibbonVertices = String(countryRibbonVertices);
    this.renderer.domElement.dataset.countryRibbonSourceRuns = String(countryRibbonSourceRuns);
    this.renderer.domElement.dataset.countryRibbonRenderedRuns = String(countryRibbonRenderedRuns);
    this.renderer.domElement.dataset.countryRibbonVisible = String(this.layers.borders);
    this.renderer.domElement.dataset.referenceGuideBatches = String(referenceGuideBatches);
    this.renderer.domElement.dataset.referenceGuideBytes = String(referenceGuideBytes);
    this.renderer.domElement.dataset.referenceGuideVertices = String(referenceGuideVertices);
    this.renderer.domElement.dataset.referenceGuideVisible = String(this.layers.guides);
    this.renderer.domElement.dataset.overlayDrapeAppliedSurfaceKey =
      this.displayedHeightSamplerKey ?? "sphere";
    if (
      this.temporalCountries !== undefined &&
      this.renderer.domElement.dataset.temporalDisplayedAgeMa ===
        this.temporalCountries.requestedAgeMa.toFixed(6)
    ) {
      this.renderer.domElement.dataset.temporalCountryDisplayedAgeMa =
        this.temporalCountries.requestedAgeMa.toFixed(6);
      this.renderer.domElement.dataset.temporalCountryDisplayStatus = "terrain-draped";
    }

    for (const poiId of snapshot.poiIds) {
      const coordinates = snapshot.poiCoordinates?.[poiId];
      if (coordinates === undefined) continue;
      const material = new THREE.SpriteMaterial({
        map: this.markerTexture,
        color: 0x98dddc,
        transparent: true,
        opacity: 0.84,
        alphaTest: 0.025,
        depthTest: true,
        depthWrite: false,
      });
      const marker = new THREE.Sprite(material);
      marker.position.copy(lonLatToVector3(coordinates, 1.028));
      marker.userData.markerTargetPixels = 9;
      marker.userData.poiId = poiId;
      marker.renderOrder = 5;
      this.markerGroup.add(marker);
    }
    this.setSelectedPoi(this.selectedPoiId);
    this.publishTemporalPoisIfReady();
    this.updateCaoCoordinateReadiness();
  }

  private updateDrapedOverlays(): void {
    let vertexCount = 0;
    for (const child of this.overlayGroup.children) {
      if (child instanceof THREE.Sprite) {
        const direction = child.userData.guideLabelDirection as THREE.Vector3 | undefined;
        const heightMetres = child.userData.guideLabelHeightMetres as number | undefined;
        const clearanceMetres = child.userData.guideLabelClearanceMetres as number | undefined;
        if (direction === undefined || heightMetres === undefined || clearanceMetres === undefined) {
          continue;
        }
        const radius = 1 +
          (heightMetres * this.verticalExaggeration + clearanceMetres) / EARTH_RADIUS_METRES;
        child.position.copy(direction).multiplyScalar(radius);
      } else if (child instanceof THREE.Line) {
        const drape = child.userData.drapedLine as DrapedLineData | undefined;
        if (drape === undefined) continue;
        updateDrapedLinePositions(drape, this.verticalExaggeration);
        const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.needsUpdate = true;
        child.geometry.computeBoundingSphere();
        vertexCount += drape.heightsMetres.length;
      } else if (child instanceof THREE.Mesh) {
        const labelPatch = child.userData.referenceGuideLabelPatch as
          ReferenceGuideLabelPatchData | undefined;
        if (labelPatch !== undefined) {
          updateReferenceGuideLabelPatchPositions(labelPatch, this.verticalExaggeration);
          const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
          positions.needsUpdate = true;
          child.geometry.computeBoundingSphere();
          vertexCount += labelPatch.heightsMetres.length;
          continue;
        }
        const ribbon = child.userData.countryRibbon as CountryRibbonBatchData | undefined;
        if (ribbon === undefined) continue;
        updateCountryRibbonPositions(ribbon, this.verticalExaggeration);
        const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
        positions.needsUpdate = true;
        child.geometry.computeBoundingSphere();
        vertexCount += ribbon.heightsMetres.length;
      }
    }
    this.renderer.domElement.dataset.overlayDrapeVertices = String(vertexCount);
    this.renderer.domElement.dataset.overlayDrapeExaggeration =
      this.verticalExaggeration.toFixed(1);
  }

  private updateGuideLabelVisibility(): void {
    if (!this.layers.guides) return;
    this.guideInverseGlobeQuaternion.copy(this.globeGroup.quaternion).invert();
    this.guideCameraDirection.copy(this.camera.position).normalize()
      .applyQuaternion(this.guideInverseGlobeQuaternion);
    const scale = THREE.MathUtils.clamp(this.camera.position.length() / 1.38, 1, 2.8);
    for (const child of this.overlayGroup.children) {
      if (!(child instanceof THREE.Sprite)) continue;
      const direction = child.userData.guideLabelDirection as THREE.Vector3 | undefined;
      if (direction !== undefined) {
        child.visible = isReferenceDirectionAboveHorizon(
          direction.dot(this.guideCameraDirection),
          this.camera.position.length(),
          1.03,
          child.userData.guidePoleMarker === true ? 0 : 0.08,
        );
        if (child.userData.guidePoleMarker === true) child.scale.setScalar(0.05 * scale);
      }
    }
  }

  private resize(): void {
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    const maxRatio = this.effectiveQuality === "high" ? 2 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private cancelControlInertia(): void {
    const position = this.camera.position.clone();
    const quaternion = this.camera.quaternion.clone();
    const target = this.controls.target.clone();
    const damping = this.controls.enableDamping;
    this.controls.autoRotate = false;
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.target.copy(target);
    this.camera.position.copy(position);
    this.camera.quaternion.copy(quaternion);
    this.controls.enableDamping = damping;
    this.controls.update();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (start === null || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const surfaceTargets = this.cubeSurfaceGroup === null
      ? this.globeMesh.visible ? [this.globeMesh] : []
      : [
        ...this.cubeSurfaceGroup.children,
        ...(this.cubeHeldVisibleGroup?.children ?? []),
      ];
    const surfaceHit = this.raycaster.intersectObjects(surfaceTargets, false)[0];

    // A click on the globe clears any active spatial focus before markers are
    // considered. Focus animations can carry an unrelated marker beneath the
    // pointer; that incidental overlap must not turn an intended toggle-off
    // click into a different POI selection.
    if (surfaceHit !== undefined && this.renderer.domElement.dataset.focusKind !== "none") {
      this.globeGroup.updateWorldMatrix(true, false);
      const localDirection = this.globeGroup.worldToLocal(surfaceHit.point.clone()).normalize();
      this.onSelectSurface(vector3ToLonLat(localDirection));
      return;
    }

    const cameraDirection = this.camera.position.clone().normalize();
    const horizon = 1 / this.camera.position.length();
    const markerHit = this.raycaster
      .intersectObjects(this.markerGroup.children, false)
      .find((candidate) => {
        const markerDirection = candidate.object.getWorldPosition(new THREE.Vector3()).normalize();
        return markerDirection.dot(cameraDirection) > horizon;
      });
    const poiId = markerHit?.object.userData.poiId;
    if (typeof poiId === "string") {
      this.onSelectPoi(poiId);
      return;
    }

    if (surfaceHit !== undefined) {
      this.globeGroup.updateWorldMatrix(true, false);
      const localDirection = this.globeGroup.worldToLocal(surfaceHit.point.clone()).normalize();
      this.onSelectSurface(vector3ToLonLat(localDirection));
    }
  };

  private readonly handleMotionPreference = (): void => {
    this.controls.autoRotate = this.autoRotate && !this.reducedMotion.matches;
  };

  private readonly handleControlsStart = (): void => {
    this.cameraInteractionActive = true;
    // Direct manipulation cancels an automatic flight. The existing debounced
    // controls-end refresh below then generates the user's final view.
    this.focusAnimation = null;
    if (this.cameraRefreshHandle !== null) {
      window.clearTimeout(this.cameraRefreshHandle);
      this.cameraRefreshHandle = null;
    }
  };

  private readonly handleControlsEnd = (): void => {
    this.cameraInteractionActive = false;
    if (this.cameraRefreshHandle !== null) window.clearTimeout(this.cameraRefreshHandle);
    // Wheel events each emit an end event. Debouncing them prevents generating
    // full tile plans for camera positions that will be obsolete milliseconds
    // later while retaining a prompt final refresh.
    this.cameraRefreshHandle = window.setTimeout(() => {
      this.cameraRefreshHandle = null;
      if (!this.disposed) {
        this.refreshCubeForCamera();
        void this.loadRegionalPatch();
        if (this.displayedHeightSamplerKey !== null) {
          this.scheduleOverlayRebuild(this.displayedHeightSamplerKey);
        }
      }
    }, 80);
  };

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const frameTime = now - this.previousFrame;
    this.previousFrame = now;
    if (frameTime > 0 && frameTime < 250) {
      this.frameTimes.push(frameTime);
      if (this.frameTimes.length > 300) this.frameTimes.shift();
    }

    this.controls.autoRotate =
      this.autoRotate && !this.reducedMotion.matches && this.focusAnimation === null;
    this.controls.update();

    if (this.reliefScalePending) {
      this.reliefScalePending = false;
      this.applyReliefScale();
      this.updateCubeReliefScale();
      this.updateRegionalPatchScale();
      this.scheduleCubeRefinement();
    }

    if (this.focusAnimation !== null) {
      const focus = this.focusAnimation;
      const progress = Math.min(1, (now - focus.started) / 950);
      const eased = 1 - Math.pow(1 - progress, 3);
      const direction = focus.from.clone().lerp(focus.to, eased).normalize();
      const distance = THREE.MathUtils.lerp(focus.fromDistance, focus.toDistance, eased);
      this.camera.position.copy(direction.multiplyScalar(distance));
      this.camera.lookAt(0, 0, 0);
      if (progress >= 1) {
        this.focusAnimation = null;
        this.refreshCubeForCamera();
        void this.loadRegionalPatch();
        if (this.displayedHeightSamplerKey !== null) {
          this.scheduleOverlayRebuild(this.displayedHeightSamplerKey);
        }
      }
    }
    const cameraDistance = this.camera.position.length();
    if (Math.abs(cameraDistance - this.lastReportedCameraDistance) > 0.0001) {
      this.lastReportedCameraDistance = cameraDistance;
      this.renderer.domElement.dataset.cameraDistance = cameraDistance.toFixed(4);
    }
    this.updatePoiMarkerScale();
    this.updateInspectionLight();
    if (
      this.focusAnimation === null && !this.cameraInteractionActive &&
      this.cameraRefreshHandle === null &&
      this.cubeSelectionNeedsRefresh(now)
    ) this.scheduleCubeRefinement();
    if (this.regionalPatch !== null && this.regionalPatchFields !== null) {
      this.regionalPatch.visible =
        this.detail === "regional" &&
        angularDistanceDegrees(this.cameraCenter(), this.regionalPatchFields.center) < 7;
      this.renderer.domElement.dataset.regionalVisible = String(this.regionalPatch.visible);
    }
    if (this.surfaceTransition !== null) {
      const progress = Math.min(1, (now - this.surfaceTransition.started) / 320);
      const eased = progress * progress * (3 - 2 * progress);
      this.surfaceTransition.mesh.material.opacity = 1 - eased;
      this.renderer.domElement.dataset.surfaceTransitionProgress = progress.toFixed(3);
      if (progress >= 1) this.finishSurfaceTransition();
    }
    if (this.cubeTransition !== null) {
      const progress = Math.min(1, (now - this.cubeTransition.started) / 320);
      const eased = progress * progress * (3 - 2 * progress);
      for (const child of this.cubeTransition.group.children) {
        if (child instanceof THREE.Mesh) child.material.opacity = 1 - eased;
      }
      this.renderer.domElement.dataset.surfaceTransitionProgress = progress.toFixed(3);
      if (progress >= 1) this.finishCubeTransition();
    }

    if (this.impactGroup.visible && this.autoRotate && !this.reducedMotion.matches) {
      const elapsed = (now - this.animationStarted) / 1000;
      this.impactGroup.rotation.y = elapsed * 0.085;
      this.impactGroup.rotation.z = Math.sin(elapsed * 0.18) * 0.08;
    }
    if (this.cloudMesh.visible && !this.reducedMotion.matches) {
      this.cloudMesh.rotation.y += frameTime * 0.000005;
    }

    const nextDetail =
      this.effectiveQuality === "low"
        ? "coarse"
        : resolveDetailMode(this.camera.position.length(), this.detail);
    if (nextDetail !== this.detail) {
      this.detail = nextDetail;
      if (nextDetail === "coarse" && this.regionalPatch !== null) {
        this.regionalPatch.visible = false;
      }
      if (this.snapshot !== null) void this.loadSurface();
      if (nextDetail === "regional") void this.loadRegionalPatch();
    }

    this.updateGuideLabelVisibility();
    this.renderer.render(this.scene, this.camera);
    if (now - this.lastStatsAt >= 1000) this.publishStats(now);
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private publishStats(now: number): void {
    this.lastStatsAt = now;
    const recent = this.frameTimes.slice(-180);
    const p50 = percentile(recent, 0.5);
    const p95 = percentile(recent, 0.95);

    if (
      this.requestedQuality === "auto" &&
      this.effectiveQuality === "high" &&
      recent.length >= 120 &&
      p95 > 33
    ) {
      this.applyEffectiveQuality("low");
    }

    const memory = this.renderer.info.memory ?? {};
    const cubeFaceCounts = Object.fromEntries(CUBE_FACES.map((face) => [face, 0]));
    let cubeGeometryCopyBytes = 0;
    let cubeTextureEstimateBytes = 0;
    let temporalStagingBytes = 0;
    const measuredCubeGroups = [
      this.cubeSurfaceGroup,
      this.cubeTransition?.group ?? null,
    ];
    for (const [groupIndex, group] of measuredCubeGroups.entries()) {
      for (const child of group?.children ?? []) {
        if (!(child instanceof THREE.Mesh)) continue;
        const field = child.userData.cubeFields as CubeTileFields | undefined;
        if (field === undefined) continue;
        if (groupIndex === 0) cubeFaceCounts[field.key.face]++;
        for (const name of ["position", "normal", "uv", "color"]) {
          const attribute = child.geometry.getAttribute(name);
          if (attribute === undefined) continue;
          if (ArrayBuffer.isView(attribute.array)) {
            cubeGeometryCopyBytes += attribute.array.byteLength;
          }
        }
        const index = child.geometry.getIndex();
        if (index !== null && ArrayBuffer.isView(index.array)) {
          cubeGeometryCopyBytes += index.array.byteLength;
        }
        cubeTextureEstimateBytes +=
          field.albedo.byteLength + field.roughness.byteLength + field.detailHeight.byteLength;
        const staged = child.userData.temporalPending as
          | {
              positions: Float32Array;
              normals: Float32Array;
              colors: Float32Array;
              uvs: Float32Array;
            }
          | undefined;
        if (staged !== undefined) {
          temporalStagingBytes +=
            staged.positions.byteLength + staged.normals.byteLength +
            staged.colors.byteLength + staged.uvs.byteLength;
        }
      }
    }
    const diagnostics: EarthHistoryDiagnostics = {
      backend: this.backend,
      effectiveQuality: this.effectiveQuality,
      detail: this.detail,
      frameTimeMs: {
        p50: Number(p50.toFixed(2)),
        p95: Number(p95.toFixed(2)),
        samples: recent.length,
      },
      generationMs: Number(this.generationMs.toFixed(2)),
      staleJobs:
        this.worker.staleJobs + this.regionalWorker.staleJobs +
        this.cubeWorker.staleJobs + this.cubeStaleTileJobs,
      cacheBytes: this.cache.byteLength + this.regionalCache.byteLength + this.cubeCache.byteLength,
      rendererMemory: {
        geometries: memory.geometries ?? 0,
        textures: memory.textures ?? 0,
      },
      cameraDistance: Number(this.camera.position.length().toFixed(4)),
      regionalGenerationMs: Number(this.regionalGenerationMs.toFixed(2)),
      transition:
        this.surfaceTransition === null && this.cubeTransition === null ? "idle" : "crossfade",
      temporal: {
        status: this.renderer.domElement.dataset.temporalStatus ?? "idle",
        fraction: this.temporalSurface?.fraction ?? 0,
        updateMs: Number(this.temporalUpdateMs.toFixed(2)),
        maxChunkMs: Number(this.temporalUpdateMaxChunkMs.toFixed(2)),
        totalUpdateMs: Number(this.temporalUpdateTotalMs.toFixed(2)),
        updateCount: this.temporalUpdateCount,
        vertices: this.temporalUpdateVertices,
        resolvedVertices: this.temporalResolvedVertices,
        fallbackVertices: this.temporalFallbackVertices,
        stagingBytes: temporalStagingBytes,
        scratchPeakBytes: this.temporalScratchPeakBytes,
      },
      cube: {
        status: this.renderer.domElement.dataset.cubeStatus ?? "initializing",
        requestedSnapshotId:
          this.renderer.domElement.dataset.cubeRequestedSnapshotId ?? null,
        requestedKey: this.renderer.domElement.dataset.cubeRequestedKey ?? null,
        displayedSnapshotId: this.cubeDisplayedSnapshotId,
        displayedKey: this.cubeDisplayedKey,
        visibleTiles: this.cubeSurfaceGroup?.children.length ?? 0,
        residentTiles: this.cubeCache.size,
        byFace: cubeFaceCounts,
        maxNeighborLevelDelta: this.cubeMaxNeighborLevelDelta,
        generationMs: Number(this.cubeGenerationMs.toFixed(2)),
        selectionMs: Number(this.cubeSelectionMs.toFixed(2)),
        installMs: Number(this.cubeInstallMs.toFixed(2)),
        cacheBytes: this.cubeCache.byteLength,
        geometryCopyBytes: cubeGeometryCopyBytes,
        gpuTextureEstimateBytes: cubeTextureEstimateBytes,
        workerRetainedBytes: Number(
          this.renderer.domElement.dataset.cubeRetainedWorkerBytes ?? 0,
        ),
        evictions: this.cubeCache.evictions,
        queuedJobs: this.cubeWorker.queuedJobs,
        workerPoolSize: this.cubeWorker.workerPoolSize,
        staleJobs: this.cubeWorker.staleJobs + this.cubeStaleTileJobs,
      },
    };
    window.__earthHistoryDiagnostics = diagnostics;
    this.renderer.domElement.dataset.detail = diagnostics.detail;
    this.renderer.domElement.dataset.quality = diagnostics.effectiveQuality;
    this.renderer.domElement.dataset.frameP50 = String(diagnostics.frameTimeMs.p50);
    this.renderer.domElement.dataset.frameP95 = String(diagnostics.frameTimeMs.p95);
    this.renderer.domElement.dataset.generationMs = String(diagnostics.generationMs);
    this.renderer.domElement.dataset.temporalStagingBytes =
      String(diagnostics.temporal.stagingBytes);
    this.renderer.domElement.dataset.temporalScratchPeakBytes =
      String(diagnostics.temporal.scratchPeakBytes);
    const cameraCoordinates = this.cameraCenter();
    this.renderer.domElement.dataset.cameraLongitude = cameraCoordinates[0].toFixed(4);
    this.renderer.domElement.dataset.cameraLatitude = cameraCoordinates[1].toFixed(4);
    const maximumDisplayedDisplacement = Number(
      this.renderer.domElement.dataset.maxReliefDisplacement ?? 0,
    );
    this.renderer.domElement.dataset.cameraSurfaceClearanceEarthRadii =
      (diagnostics.cameraDistance - 1 - maximumDisplayedDisplacement).toFixed(6);
    this.renderer.domElement.dataset.cubeResidentTiles = String(diagnostics.cube.residentTiles);
    this.renderer.domElement.dataset.cubeCacheBytes = String(diagnostics.cube.cacheBytes);
    this.renderer.domElement.dataset.cubeCacheEvictions = String(diagnostics.cube.evictions);
    this.renderer.domElement.dataset.cubeQueuedJobs = String(diagnostics.cube.queuedJobs);
    this.renderer.domElement.dataset.cubeWorkerPoolSize =
      String(diagnostics.cube.workerPoolSize);
    this.renderer.domElement.dataset.cubeStaleJobs = String(diagnostics.cube.staleJobs);
    this.renderer.domElement.dataset.cubeSelectionMs = String(diagnostics.cube.selectionMs);
    this.renderer.domElement.dataset.cubeInstallMs = String(diagnostics.cube.installMs);
    this.renderer.domElement.dataset.cubeGeometryCopyBytes =
      String(diagnostics.cube.geometryCopyBytes);
    this.renderer.domElement.dataset.cubeGpuTextureEstimateBytes =
      String(diagnostics.cube.gpuTextureEstimateBytes);
    this.renderer.domElement.dataset.cubeWorkerRetainedBytes =
      String(diagnostics.cube.workerRetainedBytes);

    const fps = p50 > 0 ? 1000 / p50 : 0;
    this.onStats?.({
      fps: Number(fps.toFixed(0)),
      backend: this.backend === "webgpu" ? "WebGPU" : "WebGL 2",
      detail: this.detail,
      triangles: this.renderer.info.render?.triangles,
      status: this.renderer.domElement.dataset.surfaceStatus ?? "initializing",
    });
  }
}
