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
}

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

function lineSegmentsForCoordinates(
  coordinates: LonLat[],
  radius: number,
): THREE.Vector3[][] {
  const segments: THREE.Vector3[][] = [];
  let current: THREE.Vector3[] = [];
  for (let index = 0; index < coordinates.length; index++) {
    if (
      index > 0 &&
      Math.abs(coordinates[index][0] - coordinates[index - 1][0]) > 180
    ) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push(lonLatToVector3(coordinates[index], radius));
  }
  if (current.length > 1) segments.push(current);
  return segments;
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
    onStats?: (stats: GlobeStats) => void,
    requestedQuality: RequestedQuality = "auto",
  ): Promise<GlobeScene> {
    const initialized = await createRenderer();
    return new GlobeScene(
      mount,
      initialized.renderer,
      initialized.backend,
      onSelectPoi,
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
  private readonly cache = new BoundedLruCache<SurfaceFields>(4, 20 * 1024 * 1024);
  private readonly regionalCache = new BoundedLruCache<RegionalPatchFields>(
    3,
    8 * 1024 * 1024,
  );
  private readonly raycaster = new THREE.Raycaster();
  private readonly markerTexture = createMarkerTexture();
  private readonly pointer = new THREE.Vector2();
  private readonly frameTimes: number[] = [];
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private resizeObserver: ResizeObserver;
  private globeMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
  private cloudMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private textures: TextureSet | null = null;
  private activeSurfaceFields: SurfaceFields | null = null;
  private displayedSnapshotId: string | null = null;
  private surfaceTransition: {
    mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>;
    textures: TextureSet;
    started: number;
  } | null = null;
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
  private onStats?: (stats: GlobeStats) => void;

  private constructor(
    mount: HTMLDivElement,
    renderer: RendererLike,
    backend: EarthHistoryDiagnostics["backend"],
    onSelectPoi: (id: string) => void,
    onStats: ((stats: GlobeStats) => void) | undefined,
    requestedQuality: RequestedQuality,
  ) {
    this.mount = mount;
    this.renderer = renderer;
    this.backend = backend;
    this.onSelectPoi = onSelectPoi;
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
      new THREE.SphereGeometry(1.014, 128, 64),
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
    this.resize();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  setCallbacks(onSelectPoi: (id: string) => void, onStats?: (stats: GlobeStats) => void): void {
    this.onSelectPoi = onSelectPoi;
    this.onStats = onStats;
  }

  setSnapshot(snapshot: WorldSnapshot | null): void {
    if (this.snapshot === snapshot) return;
    this.snapshot = snapshot;
    this.currentRivers = [];
    this.regionalWorker.cancel();
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
    this.updateRegionalPatchScale();
  }

  setSurfaceMode(mode: SurfaceMode): void {
    if (mode === this.surfaceMode) return;
    this.surfaceMode = mode;
    this.regionalWorker.cancel();
    this.removeRegionalPatch();
    if (this.snapshot !== null) void this.loadSurface();
  }

  focus(coordinates: LonLat, requestedDistance = 1.82): void {
    this.prefetchModernRelief(coordinates);
    const direction = lonLatToVector3(coordinates).applyQuaternion(this.globeGroup.quaternion).normalize();
    this.focusAnimation = {
      from: this.camera.position.clone().normalize(),
      to: direction,
      fromDistance: this.camera.position.length(),
      toDistance: THREE.MathUtils.clamp(requestedDistance, 1.4, 5.8),
      started: performance.now(),
    };
  }

  resetCamera(): void {
    this.focusAnimation = null;
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
    this.cache.clear();
    this.regionalCache.clear();
    this.resizeObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.handleMotionPreference);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.dispose();
    this.controls.removeEventListener("end", this.handleControlsEnd);
    this.finishSurfaceTransition();
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

  private makeGlobeGeometry(): THREE.SphereGeometry {
    const segments = this.effectiveQuality === "high" ? [192, 96] : [96, 48];
    return new THREE.SphereGeometry(1, segments[0], segments[1]);
  }

  private applyEffectiveQuality(value: "high" | "low"): void {
    this.finishSurfaceTransition();
    this.effectiveQuality = value;
    this.globeMesh.geometry.dispose();
    this.globeMesh.geometry = this.makeGlobeGeometry();
    this.resize();
    if (value === "low" && this.detail === "regional") this.detail = "coarse";
    if (this.snapshot !== null) void this.loadSurface();
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
      this.applySurface(cached);
      return;
    }
    this.renderer.domElement.dataset.surfaceStatus = "generating";
    this.renderer.domElement.dataset.surfaceRequestedAt = performance.now().toFixed(2);
    try {
      const fields = await this.worker.request(snapshot, detail, this.surfaceMode);
      if (this.disposed || serial !== this.requestSerial || snapshot !== this.snapshot) return;
      this.cache.set(key, fields);
      this.generationMs = fields.generationMs;
      this.applySurface(fields);
    } catch (error) {
      if (serial === this.requestSerial && !this.disposed) {
        this.renderer.domElement.dataset.surfaceStatus = "error";
        if (!(error instanceof Error) || error.message !== "Surface request superseded") {
          console.error("Surface generation failed", error);
        }
      }
    }
  }

  private applySurface(fields: SurfaceFields): void {
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
    this.displayedSnapshotId = nextSnapshotId;
    this.reliefRangeMetres = fields.reliefRangeMetres;
    this.reliefBiasMetres = fields.reliefBiasMetres;
    this.currentRivers = fields.rivers;
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
    if (this.detail === "regional") void this.loadRegionalPatch();
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
    const overlayScale = (1.004 + maximumPositiveDisplacement) / 1.012;
    this.overlayGroup.scale.setScalar(overlayScale);
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

    if (this.layers.borders) {
      const material = new THREE.LineBasicMaterial({
        color: 0xb7d8d5,
        transparent: true,
        opacity: 0.52,
        depthWrite: false,
      });
      for (const country of snapshot.countries) {
        for (const coordinates of country.lines) {
          for (const positions of lineSegmentsForCoordinates(coordinates, 1.012)) {
            const line = new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(positions),
              material.clone(),
            );
            line.renderOrder = 3;
            this.overlayGroup.add(line);
          }
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
        for (const positions of lineSegmentsForCoordinates(feature.coordinates, 1.017)) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(positions),
            new THREE.LineBasicMaterial({
              color: colors[feature.type],
              transparent: true,
              opacity: 0.86,
              depthWrite: false,
            }),
          );
          line.renderOrder = 4;
          this.overlayGroup.add(line);
        }
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
        for (const positions of lineSegmentsForCoordinates(corridor, 1.013)) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(positions),
            material.clone(),
          );
          line.renderOrder = 4;
          line.userData.evidence = "inferred-drainage";
          this.overlayGroup.add(line);
        }
      }
      material.dispose();
    }

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

  private resize(): void {
    const width = Math.max(1, this.mount.clientWidth);
    const height = Math.max(1, this.mount.clientHeight);
    const maxRatio = this.effectiveQuality === "high" ? 2 : 1.25;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxRatio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
    const hit = this.raycaster.intersectObjects(this.markerGroup.children, false)[0];
    const poiId = hit?.object.userData.poiId;
    if (typeof poiId === "string") {
      const markerDirection = hit.object.getWorldPosition(new THREE.Vector3()).normalize();
      const cameraDirection = this.camera.position.clone().normalize();
      const horizon = 1 / this.camera.position.length();
      if (markerDirection.dot(cameraDirection) > horizon) this.onSelectPoi(poiId);
    }
  };

  private readonly handleMotionPreference = (): void => {
    this.controls.autoRotate = this.autoRotate && !this.reducedMotion.matches;
  };

  private readonly handleControlsEnd = (): void => {
    if (this.detail === "regional") void this.loadRegionalPatch();
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
        if (this.detail === "regional") void this.loadRegionalPatch();
      }
    }
    const cameraDistance = this.camera.position.length();
    if (Math.abs(cameraDistance - this.lastReportedCameraDistance) > 0.0001) {
      this.lastReportedCameraDistance = cameraDistance;
      this.renderer.domElement.dataset.cameraDistance = cameraDistance.toFixed(4);
    }
    this.updateInspectionLight();
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
      staleJobs: this.worker.staleJobs + this.regionalWorker.staleJobs,
      cacheBytes: this.cache.byteLength + this.regionalCache.byteLength,
      rendererMemory: {
        geometries: memory.geometries ?? 0,
        textures: memory.textures ?? 0,
      },
      cameraDistance: Number(this.camera.position.length().toFixed(4)),
      regionalGenerationMs: Number(this.regionalGenerationMs.toFixed(2)),
      transition: this.surfaceTransition === null ? "idle" : "crossfade",
    };
    window.__earthHistoryDiagnostics = diagnostics;
    this.renderer.domElement.dataset.detail = diagnostics.detail;
    this.renderer.domElement.dataset.quality = diagnostics.effectiveQuality;
    this.renderer.domElement.dataset.frameP50 = String(diagnostics.frameTimeMs.p50);
    this.renderer.domElement.dataset.frameP95 = String(diagnostics.frameTimeMs.p95);
    this.renderer.domElement.dataset.generationMs = String(diagnostics.generationMs);

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
