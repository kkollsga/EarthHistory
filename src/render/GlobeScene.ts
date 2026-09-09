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
  getModernReliefPatch,
  modernReliefPatches,
  type ModernReliefPatch,
} from "../data";
import { BoundedLruCache } from "./cache";
import {
  CUBE_FACES,
  cubeTileId,
  type CubeFace,
  type CubeTileKey,
} from "./cubeSphere";
import { reliefHorizonExtensionRadians } from "./cubeRelief";
import { planCubeRender } from "./cubeRenderPlan";
import {
  describeCubeLodLeaves,
  selectCubeLod,
  type CubeLodLeaf,
} from "./cubeLod";
import { createCubeTileMesh } from "./cubeTileMesh";
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
import { createPoleSafeShellGeometry } from "./poleSafeGeometry";
import type { CubeSurfaceRequest, CubeSurfaceResponse } from "./cube.worker";
import {
  angularDistanceDegrees,
  lonLatToVector3,
  resolveDetailMode,
  vector3ToLonLat,
} from "./math";
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
        const request: SurfaceRequest = { id, snapshot, detail, mode };
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
        const request: RegionalPatchRequest = { id, snapshot, center, mode, sourcePatch };
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

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((item) => item.dispose());
  else material.dispose();
}

function clearGroup(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.Sprite) {
      if (!(child instanceof THREE.Sprite)) child.geometry?.dispose();
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
  return texture;
}

function createAtmosphere(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(1.012, 128, 64);
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
    opacity: 0.28,
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
  private readonly sunLight = new THREE.DirectionalLight(0xfff1d4, 1.72);
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
  private readonly pointer = new THREE.Vector2();
  private readonly frameTimes: number[] = [];
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private resizeObserver: ResizeObserver;
  private globeMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private cloudMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private textures: TextureSet | null = null;
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
  private cubeRequestSerial = 0;
  private cubeGenerationMs = 0;
  private snapshot: WorldSnapshot | null = null;
  private layers: LayerVisibility = { clouds: false, borders: false, tectonics: true, rivers: false };
  private selectedPoiId: string | null = null;
  private requestedQuality: RequestedQuality;
  private effectiveQuality: "high" | "low";
  private detail: SurfaceDetail = "coarse";
  private requestSerial = 0;
  private frameHandle = 0;
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
    renderer.toneMappingExposure = 0.94;
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
    this.controls.minDistance = 1.38;
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
    this.scene.add(new THREE.HemisphereLight(0x7195ad, 0x120e09, 0.86));
    this.updateInspectionLight();
    this.scene.add(this.sunLight);
    const fill = new THREE.DirectionalLight(0x225b7a, 0.28);
    fill.position.set(-3, 1, -4);
    this.scene.add(fill);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(mount);
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
    if (snapshot === null) {
      this.displayedHeightSampler = null;
      this.displayedHeightSamplerKey = null;
      delete this.renderer.domElement.dataset.overlayDrapeSurfaceKey;
    }
    this.currentRivers = [];
    this.regionalWorker.cancel();
    this.cubeWorker.cancel();
    this.invalidateCubeRefinement();
    this.removeRegionalPatch();
    this.rebuildOverlays();
    const stage = snapshot?.environment.stage;
    this.impactGroup.visible = stage === "giant-impact";
    this.updateAtmosphere(stage, snapshot?.environment.atmosphereOpacity ?? 1);
    if (snapshot !== null) void this.loadSurface();
  }

  setLayers(layers: LayerVisibility): void {
    if (
      this.layers.clouds === layers.clouds &&
      this.layers.borders === layers.borders &&
      this.layers.tectonics === layers.tectonics &&
      this.layers.rivers === layers.rivers
    ) return;
    this.layers = layers;
    this.cloudMesh.visible = layers.clouds;
    this.rebuildOverlays();
  }

  setSelectedPoi(id: string | null): void {
    this.selectedPoiId = id;
    for (const child of this.markerGroup.children) {
      if (!(child instanceof THREE.Sprite)) continue;
      const selected = child.userData.poiId === id;
      child.scale.setScalar(selected ? 0.043 : 0.027);
      child.material.color.set(selected ? 0xffd98a : 0x98dddc);
      child.material.opacity = selected ? 1 : 0.84;
    }
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
    this.applyReliefScale();
    this.updateCubeReliefScale();
    this.updateRegionalPatchScale();
    this.scheduleCubeRefinement();
  }

  setSurfaceMode(mode: SurfaceMode): void {
    if (mode === this.surfaceMode) return;
    this.surfaceMode = mode;
    this.regionalWorker.cancel();
    this.cubeWorker.cancel();
    this.invalidateCubeRefinement();
    this.removeRegionalPatch();
    if (this.snapshot !== null) void this.loadSurface();
  }

  focus(
    coordinates: LonLat,
    requestedDistance = 1.82,
    kind: SpatialFocusKind = "area",
  ): void {
    this.prefetchModernRelief(coordinates);
    this.renderer.domElement.dataset.focusKind = kind;
    const direction = lonLatToVector3(coordinates).applyQuaternion(this.globeGroup.quaternion).normalize();
    this.focusAnimation = {
      from: this.camera.position.clone().normalize(),
      to: direction,
      fromDistance: this.camera.position.length(),
      toDistance: THREE.MathUtils.clamp(requestedDistance, 1.4, 5.8),
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
    this.worker.dispose();
    this.regionalWorker.dispose();
    this.cubeWorker.dispose();
    this.cache.clear();
    this.regionalCache.clear();
    this.cubeCache.clear();
    this.cubeRootFields.clear();
    this.resizeObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.handleMotionPreference);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.dispose();
    this.controls.removeEventListener("end", this.handleControlsEnd);
    this.finishSurfaceTransition();
    this.finishCubeTransition();
    if (this.cubeSurfaceGroup !== null) {
      this.disposeCubeGroup(this.cubeSurfaceGroup);
      this.cubeSurfaceGroup = null;
    }
    this.textures && this.disposeTextures(this.textures);
    this.markerTexture.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        if (!(object instanceof THREE.Sprite)) object.geometry?.dispose();
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
    material.opacity = Math.max(0.1, Math.min(0.38, opacity * (hot ? 0.34 : 0.25)));
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
      clouds: createTexture(fields.clouds, fields.width, fields.height, true),
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
      this.disposeTextures(previousTextures);
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
    this.rebuildOverlays();
    this.renderer.domElement.dataset.surfaceStatus = "ready";
    this.renderer.domElement.dataset.surfaceReadyAt = performance.now().toFixed(2);
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
    this.updateDrapedOverlays();
    this.markerGroup.scale.setScalar((1.008 + maximumPositiveDisplacement) / 1.028);
    this.atmosphereMesh.scale.setScalar(
      (1.009 + maximumPositiveDisplacement) / 1.012,
    );
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

  private installDisplayedHeightSampler(
    sampler: DisplayedHeightSampler,
    displayKey: string,
  ): void {
    if (displayKey === this.displayedHeightSamplerKey) return;
    this.displayedHeightSampler = sampler;
    this.displayedHeightSamplerKey = displayKey;
    this.renderer.domElement.dataset.overlayDrapeSurfaceKey = displayKey;
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
      snapshot,
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
      group.add(this.createCubeMesh(field));
    }

    if (this.cubeTransition !== null) this.finishCubeTransition();
    const previous = this.cubeSurfaceGroup;
    const previousSnapshotId = this.cubeDisplayedSnapshotId;
    this.cubeSurfaceGroup = group;
    this.cubeDisplayedKey = displayKey;
    this.cubeDisplayedSnapshotId = snapshotId;
    this.renderer.domElement.dataset.cubeDisplayedKey = displayKey;
    this.renderer.domElement.dataset.cubeDisplayedSnapshotId = snapshotId;
    this.globeGroup.add(group);
    this.globeMesh.visible = false;
    this.updateCubeReliefScale();
    if (this.cubeContext !== null && this.cubeContextKey === displayKey) {
      const samplerChanged = displayKey !== this.displayedHeightSamplerKey;
      if (samplerChanged) {
        this.installDisplayedHeightSampler(
          createCubeTileFieldGenerator(this.cubeContext),
          displayKey,
        );
        this.rebuildOverlays();
      }
    }

    if (previous !== null) {
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
    this.renderer.domElement.dataset.cubeStatus = "ready";
    const baseDisplayedAt = performance.now();
    this.renderer.domElement.dataset.cubeReadyAt = baseDisplayedAt.toFixed(2);
    this.renderer.domElement.dataset.cubeBaseDisplayedAt = baseDisplayedAt.toFixed(2);
    delete this.renderer.domElement.dataset.cubeFirstRefinementAt;
    delete this.renderer.domElement.dataset.cubeTargetLodCompleteAt;
    this.renderer.domElement.dataset.cubeInstallMs =
      (performance.now() - installStarted).toFixed(2);
    this.renderer.domElement.dataset.cubeVisibleTiles = "6";
    this.renderer.domElement.dataset.cubeMaxNeighborLevelDelta = "0";
    this.removeRegionalPatch();
    this.scheduleCubeRefinement();
  }

  private createCubeMesh(
    field: CubeTileFields,
    coarseEdges = { north: false, east: false, south: false, west: false },
  ): THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> {
    const meshData = createCubeTileMesh(field, this.verticalExaggeration, coarseEdges);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(meshData.positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(meshData.normals, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(meshData.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
    geometry.computeBoundingSphere();
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: createTexture(field.albedo, field.textureStride, field.textureStride, true),
      roughness: this.surfaceMode === "seafloor" ? 0.91 : 0.82,
      roughnessMap: createTexture(field.roughness, field.textureStride, field.textureStride),
      bumpMap: createTexture(field.detailHeight, field.textureStride, field.textureStride),
      bumpScale: 0.0028 * Math.sqrt(this.verticalExaggeration),
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
    const selection = selectCubeLod({
      camera: {
        direction: [localDirection.x, localDirection.y, localDirection.z],
        distance: this.camera.position.length(),
        verticalFovRadians: THREE.MathUtils.degToRad(this.camera.fov),
        viewportHeight: Math.max(1, this.mount.clientHeight),
      },
      previousKeys: this.cubePreviousLeafKeys,
      maxLevel: this.effectiveQuality === "high" ? 4 : 1,
      maxLeaves: this.effectiveQuality === "high" ? 96 : 24,
      horizonPaddingRadians:
        0.015 + reliefHorizonExtensionRadians(
          this.camera.position.length(),
          maximumPositiveDisplacement,
        ),
    });
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

  private syncCubeRenderPlan(): ReturnType<typeof planCubeRender> {
    const installStarted = performance.now();
    this.pinRenderedCubeFields();
    const plan = planCubeRender(
      this.cubeDesiredLeaves.map((leaf) => leaf.key),
      new Set(this.cubeCache.keys()),
    );
    const group = this.cubeSurfaceGroup;
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
    for (const leaf of actualLeaves) {
      const { key, id, coarseEdges } = leaf;
      const current = existing.get(id);
      if (current !== undefined) {
        const previousEdges = current.userData.coarseEdges as
          | { north: boolean; east: boolean; south: boolean; west: boolean }
          | undefined;
        if (!sameCubeEdgeFlags(previousEdges, coarseEdges)) {
          current.userData.coarseEdges = { ...coarseEdges };
          this.updateCubeMeshGeometry(current, current.userData.cubeFields, coarseEdges);
        }
        continue;
      }
      const field = this.cubeCache.get(id);
      if (field !== undefined) {
        group.add(this.createCubeMesh(field, coarseEdges));
        if (key.level > 0) addedRefinement = true;
      }
    }
    for (const [id, child] of existing) {
      if (requestedIds.has(id)) continue;
      group.remove(child);
      this.disposeCubeMesh(child);
    }
    this.cubeInstallMs = performance.now() - installStarted;
    if (
      addedRefinement &&
      this.renderer.domElement.dataset.cubeFirstRefinementAt === undefined
    ) {
      this.renderer.domElement.dataset.cubeFirstRefinementAt = performance.now().toFixed(2);
    }
    this.renderer.domElement.dataset.cubeInstallMs = this.cubeInstallMs.toFixed(2);
    this.renderer.domElement.dataset.cubeVisibleTiles = String(group.children.length);
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
      if (field === undefined) continue;
      const id = cubeTileId(field.key);
      if (this.cubeCache.get(id) === undefined) this.cubeCache.set(id, field);
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
        const requests: CubeTileFieldRequest[] = uncached.slice(0, 24).map((key) => ({
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
    material.map?.dispose();
    material.roughnessMap?.dispose();
    material.bumpMap?.dispose();
    material.dispose();
  }

  private updateCubeReliefScale(): void {
    const group = this.cubeSurfaceGroup;
    if (group === null) return;
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
      child.material.bumpScale = 0.0028 * Math.sqrt(this.verticalExaggeration);
    }
  }

  private updateCubeMeshGeometry(
    mesh: THREE.Mesh<THREE.BufferGeometry>,
    fields: CubeTileFields,
    coarseEdges: Readonly<{ north: boolean; east: boolean; south: boolean; west: boolean }>,
  ): void {
    const meshData = createCubeTileMesh(fields, this.verticalExaggeration, coarseEdges);
    const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const normals = mesh.geometry.getAttribute("normal") as THREE.BufferAttribute;
    const uvs = mesh.geometry.getAttribute("uv") as THREE.BufferAttribute;
    (positions.array as Float32Array).set(meshData.positions);
    (normals.array as Float32Array).set(meshData.normals);
    (uvs.array as Float32Array).set(meshData.uvs);
    positions.needsUpdate = true;
    normals.needsUpdate = true;
    uvs.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }

  private disposeCubeGroup(group: THREE.Group): void {
    this.globeGroup.remove(group);
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      this.disposeCubeMesh(child);
    }
    group.clear();
  }

  private finishCubeTransition(): void {
    if (this.cubeTransition === null) return;
    this.disposeCubeGroup(this.cubeTransition.group);
    this.cubeTransition = null;
    this.renderer.domElement.dataset.surfaceTransition = "idle";
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

  private modernReliefMetadataAt(coordinates: LonLat) {
    const snapshot = this.snapshot;
    if (snapshot?.modernClimate === undefined) return undefined;
    const requestedAge = snapshot.requestedAgeMa ?? snapshot.ageMa;
    return modernReliefPatches.find((metadata) => {
      const [west, south, east, north] = metadata.bounds;
      return metadata.surfaceMode === this.surfaceMode &&
        requestedAge >= metadata.validRequestedAgeMa[0] &&
        requestedAge <= metadata.validRequestedAgeMa[1] &&
        coordinates[0] >= west && coordinates[0] <= east &&
        coordinates[1] >= south && coordinates[1] <= north;
    });
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
    const view = this.camera.position.clone().normalize();
    const right = new THREE.Vector3().crossVectors(view, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 0.01) right.crossVectors(view, new THREE.Vector3(0, 0, 1));
    right.normalize();
    const upward = new THREE.Vector3().crossVectors(right, view).normalize();
    // Keep the inspected region on the day side while retaining an oblique
    // angle that exposes regional normals and a terminator across the globe.
    this.sunLight.position
      .copy(view)
      .multiplyScalar(4.2)
      .addScaledVector(right, -2.2)
      .addScaledVector(upward, 1.35);
  }

  private async loadRegionalPatch(): Promise<void> {
    const snapshot = this.snapshot;
    if (
      snapshot?.controls === undefined ||
      this.detail !== "regional" ||
      this.effectiveQuality === "low" ||
      this.textures === null
    ) {
      if (this.regionalPatch !== null) this.regionalPatch.visible = false;
      return;
    }
    const cameraCenter = this.cameraCenter();
    const center: LonLat = [
      Math.round(cameraCenter[0] / 4) * 4,
      Math.round(cameraCenter[1] / 4) * 4,
    ];
    const reliefMetadata = this.modernReliefMetadataAt(cameraCenter);
    if (
      this.regionalPatchFields !== null &&
      angularDistanceDegrees(this.regionalPatchFields.center, center) < 2.5
    ) {
      if (this.regionalPatch !== null) this.regionalPatch.visible = true;
      return;
    }

    const sourceKey = reliefMetadata === undefined
      ? "procedural"
      : `${reliefMetadata.sourceProduct}:${reliefMetadata.id}`;
    const key = `${snapshot.id}:${this.surfaceMode}:${center[0]}:${center[1]}:${sourceKey}`;
    const serial = ++this.regionalRequestSerial;
    const cached = this.regionalCache.get(key);
    if (cached !== undefined) {
      this.applyRegionalPatch(cached);
      return;
    }

    this.renderer.domElement.dataset.regionalStatus = "generating";
    this.renderer.domElement.dataset.regionalRequestedAt = performance.now().toFixed(2);
    try {
      let sourcePatch: ModernReliefPatch | undefined;
      if (reliefMetadata !== undefined) {
        this.renderer.domElement.dataset.regionalStatus = "loading-source";
        sourcePatch = await getModernReliefPatch(reliefMetadata.id);
        this.renderer.domElement.dataset.regionalSourceReadyAt = performance.now().toFixed(2);
        if (
          this.disposed ||
          serial !== this.regionalRequestSerial ||
          snapshot !== this.snapshot ||
          this.detail !== "regional"
        ) return;
        this.renderer.domElement.dataset.regionalStatus = "generating";
      }
      const workerPostedAt = performance.now();
      this.renderer.domElement.dataset.regionalWorkerPostedAt = workerPostedAt.toFixed(2);
      const fields = await this.regionalWorker.request(
        snapshot,
        center,
        this.surfaceMode,
        sourcePatch,
      );
      const workerReceivedAt = performance.now();
      this.renderer.domElement.dataset.regionalWorkerReceivedAt = workerReceivedAt.toFixed(2);
      this.renderer.domElement.dataset.regionalWorkerRoundTripMs =
        (workerReceivedAt - workerPostedAt).toFixed(2);
      this.renderer.domElement.dataset.regionalWorkerOverheadMs =
        Math.max(0, workerReceivedAt - workerPostedAt - fields.generationMs).toFixed(2);
      if (
        this.disposed ||
        serial !== this.regionalRequestSerial ||
        snapshot !== this.snapshot ||
        this.detail !== "regional"
      ) return;
      this.regionalCache.set(key, fields);
      this.regionalGenerationMs = fields.generationMs;
      this.applyRegionalPatch(fields);
    } catch (error) {
      if (
        serial === this.regionalRequestSerial &&
        !this.disposed &&
        (!(error instanceof Error) || error.message !== "Regional relief request superseded")
      ) {
        this.renderer.domElement.dataset.regionalStatus = "error";
        console.error("Regional relief generation failed", error);
      }
    }
  }

  private applyRegionalPatch(fields: RegionalPatchFields): void {
    const installStartedAt = performance.now();
    this.removeRegionalPatch();
    if (this.textures === null) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(fields.directions.length), 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(fields.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(fields.indices, 1));
    const usesLocalSeafloorColor =
      this.surfaceMode === "seafloor" && fields.sourcePatchId !== undefined;
    if (usesLocalSeafloorColor && this.activeSurfaceFields !== null) {
      const colors = new Float32Array(fields.heightsMetres.length * 3);
      const baseColor = new THREE.Color();
      const localColor = new THREE.Color();
      for (let index = 0; index < fields.heightsMetres.length; index++) {
        const [red, green, blue] = this.sampleSurfaceAlbedo(
          this.activeSurfaceFields,
          fields.uvs[index * 2],
          fields.uvs[index * 2 + 1],
        );
        baseColor.setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
        const height = fields.sourceHeightsMetres[index];
        const ridge = THREE.MathUtils.smoothstep(height, -6_100, -2_450);
        localColor.set(0x071d37).lerp(new THREE.Color(0x39a4a2), Math.pow(ridge, 0.82));
        baseColor.lerp(localColor, fields.sourceBlendWeights[index]);
        colors[index * 3] = baseColor.r;
        colors[index * 3 + 1] = baseColor.g;
        colors[index * 3 + 2] = baseColor.b;
      }
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    }
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: usesLocalSeafloorColor ? null : this.textures.albedo,
      vertexColors: usesLocalSeafloorColor,
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
    this.renderer.domElement.dataset.regionalReadyAt = performance.now().toFixed(2);
    this.renderer.domElement.dataset.regionalInstallMs =
      (performance.now() - installStartedAt).toFixed(2);
    this.renderer.domElement.dataset.regionalVertices = String(fields.size * fields.size);
    this.renderer.domElement.dataset.regionalSyntheticLimitMetres = "250";
    this.renderer.domElement.dataset.regionalSource = fields.sourcePatchId ?? "procedural";
  }

  private sampleSurfaceAlbedo(
    fields: SurfaceFields,
    u: number,
    v: number,
  ): [number, number, number] {
    const wrappedU = ((u % 1) + 1) % 1;
    const x = ((Math.round(wrappedU * fields.width - 0.5) % fields.width) + fields.width) % fields.width;
    const y = Math.max(0, Math.min(fields.height - 1, Math.round((1 - v) * fields.height - 0.5)));
    const offset = (y * fields.width + x) * 4;
    return [fields.albedo[offset], fields.albedo[offset + 1], fields.albedo[offset + 2]];
  }

  private updateRegionalPatchScale(): void {
    const patch = this.regionalPatch;
    const fields = this.regionalPatchFields;
    const surface = this.activeSurfaceFields;
    if (patch === null || fields === null || surface === null) return;
    const positions = patch.geometry.getAttribute("position") as THREE.BufferAttribute;
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
    patch.geometry.computeVertexNormals();
    patch.geometry.computeBoundingSphere();
    patch.material.bumpScale = 0.005 * Math.sqrt(this.verticalExaggeration);
    patch.material.needsUpdate = true;
  }

  private removeRegionalPatch(): void {
    if (this.regionalPatch === null) return;
    this.globeGroup.remove(this.regionalPatch);
    this.regionalPatch.geometry.dispose();
    this.regionalPatch.material.dispose();
    this.regionalPatch = null;
    this.regionalPatchFields = null;
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

    if (this.layers.borders) {
      const material = new THREE.LineBasicMaterial({
        color: 0xb7d8d5,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
      });
      for (const country of snapshot.countries) {
        for (const coordinates of country.lines) {
          addDrapedLine(coordinates, material.clone(), 2_500, 3);
        }
      }
      material.dispose();
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

    for (const poiId of snapshot.poiIds) {
      const coordinates = snapshot.poiCoordinates?.[poiId];
      if (coordinates === undefined) continue;
      const material = new THREE.SpriteMaterial({
        map: this.markerTexture,
        color: 0x98dddc,
        transparent: true,
        opacity: 0.84,
        depthTest: true,
        depthWrite: false,
      });
      const marker = new THREE.Sprite(material);
      marker.position.copy(lonLatToVector3(coordinates, 1.028));
      marker.scale.setScalar(0.027);
      marker.userData.poiId = poiId;
      marker.renderOrder = 5;
      this.markerGroup.add(marker);
    }
    this.setSelectedPoi(this.selectedPoiId);
  }

  private updateDrapedOverlays(): void {
    let vertexCount = 0;
    for (const child of this.overlayGroup.children) {
      if (!(child instanceof THREE.Line)) continue;
      const drape = child.userData.drapedLine as DrapedLineData | undefined;
      if (drape === undefined) continue;
      updateDrapedLinePositions(drape, this.verticalExaggeration);
      const positions = child.geometry.getAttribute("position") as THREE.BufferAttribute;
      positions.needsUpdate = true;
      child.geometry.computeBoundingSphere();
      vertexCount += drape.heightsMetres.length;
    }
    this.renderer.domElement.dataset.overlayDrapeVertices = String(vertexCount);
    this.renderer.domElement.dataset.overlayDrapeExaggeration =
      this.verticalExaggeration.toFixed(1);
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
      : this.cubeSurfaceGroup.children;
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

  private readonly handleControlsEnd = (): void => {
    this.refreshCubeForCamera();
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
      }
    }
    const cameraDistance = this.camera.position.length();
    if (Math.abs(cameraDistance - this.lastReportedCameraDistance) > 0.0001) {
      this.lastReportedCameraDistance = cameraDistance;
      this.renderer.domElement.dataset.cameraDistance = cameraDistance.toFixed(4);
    }
    this.updateInspectionLight();
    if (this.cubeSelectionNeedsRefresh(now)) this.scheduleCubeRefinement();
    if (this.regionalPatch !== null && this.regionalPatchFields !== null) {
      this.regionalPatch.visible =
        this.detail === "regional" &&
        angularDistanceDegrees(this.cameraCenter(), this.regionalPatchFields.center) < 7;
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
    }

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
        for (const name of ["position", "normal", "uv"]) {
          const attribute = child.geometry.getAttribute(name);
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
    const cameraCoordinates = this.cameraCenter();
    this.renderer.domElement.dataset.cameraLongitude = cameraCoordinates[0].toFixed(4);
    this.renderer.domElement.dataset.cameraLatitude = cameraCoordinates[1].toFixed(4);
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
