import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GlobeStats, LayerVisibility, LonLat, SurfaceStage, WorldSnapshot } from "../data";
import {
  gplatesToRendererDirection,
  numberScalarOps,
  type MaterialAddress,
  type PreparedCaoRevision,
} from "../reconstruction";
import { createPoleSafeShellGeometry } from "./poleSafeGeometry";
import { lonLatToVector3, vector3ToLonLat } from "./math";
import { setInspectionLightPosition, type InspectionLightScratch } from "./inspectionLight";
import {
  CaoFoundationSurfaceRenderer,
  type CaoFoundationDiagnostics,
} from "./reconstruction/caoFoundation";
import {
  GpuRetirementOwner,
  WebGl2SubmissionFence,
  WebGpuSubmissionFence,
} from "./reconstruction/gpuRetirement";

export type SpatialFocusKind = "poi" | "place" | "area";
type RequestedQuality = "auto" | "high" | "low";
type SurfaceDetail = "coarse" | "regional";

const REFERENCE_GUIDE_LABELS: readonly Readonly<{ text: string; coordinates: LonLat }>[] = [
  { text: "North pole", coordinates: [25, 86] },
  { text: "South pole", coordinates: [25, -86] },
  { text: "Equator", coordinates: [-15, 0] },
  { text: "Hadley edge · 30° N", coordinates: [-40, 30] },
  { text: "Hadley edge · 30° S", coordinates: [-40, -30] },
  { text: "Polar cell edge · 60° N", coordinates: [-70, 60] },
  { text: "Polar cell edge · 60° S", coordinates: [-70, -60] },
  { text: "Prime meridian", coordinates: [4, 50] },
  { text: "Antimeridian", coordinates: [176, 50] },
];
const REFERENCE_GUIDE_POLES: readonly LonLat[] = [[0, 90], [0, -90]];

function createReferenceGuideLines(): readonly LonLat[][] {
  const latitude = (value: number): LonLat[] => Array.from({ length: 181 }, (_, index) =>
    [-180 + index * 2, value] as LonLat);
  const meridian = (value: number): LonLat[] => Array.from({ length: 45 }, (_, index) =>
    [value, -88 + index * 4] as LonLat);
  return [latitude(0), latitude(30), latitude(-30), latitude(60), latitude(-60),
    latitude(87.5), latitude(-87.5), meridian(0), meridian(180)];
}

function isReferenceDirectionAboveHorizon(
  directionDotCamera: number,
  cameraDistance: number,
  renderedRadius = 1.03,
  visibilityMargin = 0,
): boolean {
  return Number.isFinite(directionDotCamera) && Number.isFinite(cameraDistance)
    && cameraDistance > renderedRadius && renderedRadius > 0 && visibilityMargin >= 0
    && directionDotCamera > renderedRadius / cameraDistance + visibilityMargin;
}

export interface CaoFoundationRenderState {
  readonly status: "loading" | "updating" | "ready" | "unsupported" | "error";
  readonly requestedAgeMa?: number;
  readonly displayedAgeMa?: number;
  readonly resolvedVertices?: number;
  readonly error?: string;
}

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

declare global {
  interface Window {
    __earthHistoryDiagnostics?: EarthHistoryDiagnostics;
  }
}

interface RendererLike {
  readonly domElement: HTMLCanvasElement;
  readonly backend?: {
    readonly device?: {
      readonly queue: { onSubmittedWorkDone(): Promise<void> };
      readonly limits?: { readonly maxTextureDimension2D?: number };
    };
    readonly gl?: WebGL2RenderingContext;
  };
  readonly capabilities?: { readonly maxTextureSize?: number };
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
  getContext?(): WebGLRenderingContext | WebGL2RenderingContext;
  dispose(): void;
}

const MATERIAL_TEXTURE_BINDINGS = [
  "map", "alphaMap", "bumpMap", "displacementMap", "roughnessMap",
] as const;

export function materialsReferenceAnyTexture(
  materials: Iterable<THREE.Material | THREE.Material[]>,
  textures: ReadonlySet<THREE.Texture>,
): boolean {
  for (const materialOrArray of materials) {
    const materialList = Array.isArray(materialOrArray) ? materialOrArray : [materialOrArray];
    for (const material of materialList) {
      const bindings = material as THREE.Material & Partial<Record<
        (typeof MATERIAL_TEXTURE_BINDINGS)[number], THREE.Texture | null
      >>;
      if (MATERIAL_TEXTURE_BINDINGS.some((key) => {
        const texture = bindings[key];
        return texture !== null && texture !== undefined && textures.has(texture);
      })) return true;
    }
  }
  return false;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]!;
}

export function requestedRendererBackend(search: string): "auto" | "webgl2" {
  return new URLSearchParams(search).get("renderer") === "webgl2" ? "webgl2" : "auto";
}

async function createRenderer(): Promise<{
  renderer: RendererLike;
  backend: EarthHistoryDiagnostics["backend"];
}> {
  const request = requestedRendererBackend(window.location.search);
  const createNodeRenderer = async (forceWebGL: boolean) => {
    const { WebGPURenderer } = await import("three/webgpu");
    const renderer = new WebGPURenderer({
      forceWebGL,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    await renderer.init();
    const state = renderer.backend as unknown as { isWebGPUBackend?: boolean };
    return {
      renderer: renderer as unknown as RendererLike,
      backend: state.isWebGPUBackend ? "webgpu" as const : "webgl2" as const,
    };
  };
  if (request === "auto" && "gpu" in navigator) {
    try {
      return await createNodeRenderer(false);
    } catch (error) {
      console.info("WebGPU initialization failed; using the WebGL2 renderer.", error);
    }
  }
  return createNodeRenderer(true);
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
  for (let index = 0; index < count; index += 1) {
    const z = next() * 2 - 1;
    const theta = next() * Math.PI * 2;
    const radius = 11 + next() * 4;
    const planar = Math.sqrt(1 - z * z);
    positions[index * 3] = Math.cos(theta) * planar * radius;
    positions[index * 3 + 1] = z * radius;
    positions[index * 3 + 2] = Math.sin(theta) * planar * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x8ca1a8,
    size: 0.013,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.64,
    depthWrite: false,
  }));
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

function createAtmosphere(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.SphereGeometry(1.006, 128, 64);
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const sun = new THREE.Vector3(-0.61, 0.38, 0.69).normalize();
  const normal = new THREE.Vector3();
  for (let index = 0; index < positions.count; index += 1) {
    normal.fromBufferAttribute(positions, index).normalize();
    const daylight = THREE.MathUtils.clamp(normal.dot(sun) * 0.48 + 0.52, 0.08, 1);
    colors[index * 3] = 0.08 * daylight;
    colors[index * 3 + 1] = 0.3 * daylight;
    colors[index * 3 + 2] = 0.64 * daylight;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.BackSide,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.16,
  }));
}

function buildImpactGroup(): THREE.Group {
  const group = new THREE.Group();
  const impactor = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 40, 24),
    new THREE.MeshStandardMaterial({ color: 0x4c332c, emissive: 0xff4e16,
      emissiveIntensity: 1.1, roughness: 0.9 }),
  );
  impactor.position.set(1.48, 0.33, 0.34);
  group.add(impactor);
  const light = new THREE.PointLight(0xff5d28, 2.4, 4);
  light.position.copy(impactor.position);
  group.add(light);
  const debrisPositions = new Float32Array(150 * 3);
  for (let index = 0; index < 150; index += 1) {
    const angle = index * 2.399963;
    const spread = 1.08 + (index % 17) * 0.025;
    debrisPositions[index * 3] = Math.cos(angle) * spread;
    debrisPositions[index * 3 + 1] = Math.sin(angle * 1.8) * 0.16;
    debrisPositions[index * 3 + 2] = Math.sin(angle) * spread;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(debrisPositions, 3));
  group.add(new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0xff8b45, size: 0.025, transparent: true, opacity: 0.74, depthWrite: false,
  })));
  group.visible = false;
  return group;
}

function initialEffectiveQuality(requested: RequestedQuality): "high" | "low" {
  if (requested !== "auto") return requested;
  return navigator.hardwareConcurrency >= 8 ? "high" : "low";
}

function editorialGlobeColor(environment: WorldSnapshot["environment"]): number {
  if ((environment.iceIntensity ?? 0) >= 0.8) return 0x9fb6bd;
  switch (environment.stage) {
    case "accretion": return 0x261e1b;
    case "giant-impact": return 0xd94f18;
    case "magma-ocean": return 0xe7661c;
    case "cooling-crust": return 0x3c3735;
    case "growing-oceans": return 0x123f55;
    case "microbial-world": return 0x16485a;
    default: return 0x0b4964;
  }
}

function createCaoGpuRetirementOwner(
  renderer: RendererLike,
  backend: EarthHistoryDiagnostics["backend"],
): GpuRetirementOwner {
  if (backend === "webgpu") {
    const queue = renderer.backend?.device?.queue;
    if (!queue) throw new Error("Cao renderer requires the active WebGPU submission queue");
    return new GpuRetirementOwner(new WebGpuSubmissionFence(queue), 2, 4 * 1024 * 1024);
  }
  const context = renderer.backend?.gl ?? renderer.getContext?.();
  if (!(context instanceof WebGL2RenderingContext)) {
    throw new Error("Cao renderer requires the active WebGL2 context");
  }
  return new GpuRetirementOwner(new WebGl2SubmissionFence(context), 2, 4 * 1024 * 1024);
}

interface PreparedAnchorMarker {
  readonly id: string;
  readonly direction: THREE.Vector3;
  readonly address: MaterialAddress;
}

export class GlobeScene {
  static async create(
    mount: HTMLDivElement,
    onSelectPoi: (id: string) => void,
    onSelectSurface: (coordinates: LonLat, address?: MaterialAddress) => void,
    onStats?: (stats: GlobeStats) => void,
    requestedQuality: RequestedQuality = "auto",
  ): Promise<GlobeScene> {
    const initialized = await createRenderer();
    return new GlobeScene(mount, initialized.renderer, initialized.backend,
      onSelectPoi, onSelectSurface, onStats, requestedQuality);
  }

  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(36, 1, 0.03, 50);
  private readonly globeGroup = new THREE.Group();
  private readonly overlayGroup = new THREE.Group();
  private readonly markerGroup = new THREE.Group();
  private readonly impactGroup = buildImpactGroup();
  private readonly sunLight = new THREE.DirectionalLight(0xfff4df, 3.2);
  private readonly atmosphereMesh = createAtmosphere();
  private readonly markerTexture = createMarkerTexture();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly frameTimes: number[] = [];
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly inspectionLightScratch: InspectionLightScratch = {
    view: new THREE.Vector3(), right: new THREE.Vector3(), upward: new THREE.Vector3(),
  };
  private readonly guideCameraDirection = new THREE.Vector3();
  private readonly guideInverseGlobeQuaternion = new THREE.Quaternion();
  private readonly markerWorldPosition = new THREE.Vector3();
  private readonly markerWorldScale = new THREE.Vector3();
  private readonly controls: OrbitControls;
  private readonly caoFoundationRenderer: CaoFoundationSurfaceRenderer;
  private readonly globeMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private readonly cloudMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private resizeObserver: ResizeObserver;
  private layers: LayerVisibility = { clouds: true, borders: true, guides: true,
    tectonics: false, rivers: false };
  private requestedQuality: RequestedQuality;
  private effectiveQuality: "high" | "low";
  private detail: SurfaceDetail = "coarse";
  private selectedPoiId: string | null = null;
  private snapshot: WorldSnapshot | null = null;
  private preparedAnchors: readonly PreparedAnchorMarker[] = [];
  private pendingCaoDiagnostics: CaoFoundationDiagnostics | null = null;
  private hasNativePublication = false;
  private autoRotate = true;
  private verticalExaggeration = 8;
  private disposed = false;
  private frameHandle = 0;
  private previousFrame = performance.now();
  private lastStatsAt = 0;
  private lastReportedCameraDistance = -1;
  private animationStarted = performance.now();
  private cameraInteractionActive = false;
  private pointerDown: { x: number; y: number } | null = null;
  private focusAnimation: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromDistance: number;
    toDistance: number;
    started: number;
  } | null = null;
  private onSelectPoi: (id: string) => void;
  private onSelectSurface: (coordinates: LonLat, address?: MaterialAddress) => void;
  private onStats?: (stats: GlobeStats) => void;
  private onCaoFoundationState?: (state: CaoFoundationRenderState) => void;

  private constructor(
    private readonly mount: HTMLDivElement,
    private readonly renderer: RendererLike,
    private readonly backend: EarthHistoryDiagnostics["backend"],
    onSelectPoi: (id: string) => void,
    onSelectSurface: (coordinates: LonLat, address?: MaterialAddress) => void,
    onStats: ((stats: GlobeStats) => void) | undefined,
    requestedQuality: RequestedQuality,
  ) {
    this.onSelectPoi = onSelectPoi;
    this.onSelectSurface = onSelectSurface;
    this.onStats = onStats;
    this.requestedQuality = requestedQuality;
    this.effectiveQuality = initialEffectiveQuality(requestedQuality);
    const maximumTextureSize = backend === "webgpu"
      ? renderer.backend?.device?.limits?.maxTextureDimension2D ?? 2_048
      : renderer.capabilities?.maxTextureSize ?? 2_048;
    this.caoFoundationRenderer = new CaoFoundationSurfaceRenderer(
      this.globeGroup,
      createCaoGpuRetirementOwner(renderer, backend),
      { maxBatches: 512, maxVertices: 300_000, maxTriangles: 400_000,
        maxRetainedSourceBytes: 24 * 1024 * 1024, maxTextureSize: maximumTextureSize,
        maxPublicationBytes: 2 * 1024 * 1024, maxSpatialIndexBytes: 1024 * 1024 },
    );

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.setClearColor(0x010507, 1);
    Object.assign(renderer.domElement.style, {
      display: "block", width: "100%", height: "100%", touchAction: "none",
    });
    renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional Earth");
    renderer.domElement.dataset.rendererBackend = backend;
    renderer.domElement.dataset.focusKind = "none";
    renderer.domElement.dataset.legacySurfacePipeline = "removed";
    renderer.domElement.dataset.cubeStatus = "removed";
    renderer.domElement.dataset.cubeWorkerPoolSize = "0";
    renderer.domElement.dataset.cubeQueuedJobs = "0";
    renderer.domElement.dataset.cubeCacheBytes = "0";
    renderer.domElement.dataset.regionalStatus = "removed";
    renderer.domElement.dataset.surfaceMode = "surface";
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

    this.globeMesh = new THREE.Mesh(this.makeGlobeGeometry(), new THREE.MeshPhysicalMaterial({
      color: 0x0b4964, roughness: 0.82, metalness: 0, clearcoat: 0.08,
      clearcoatRoughness: 0.5, ior: 1.37, specularIntensity: 0.3,
    }));
    this.globeMesh.castShadow = true;
    this.globeMesh.receiveShadow = true;
    this.globeMesh.renderOrder = 0;
    this.cloudMesh = new THREE.Mesh(this.makeCloudGeometry(), new THREE.MeshStandardMaterial({
      color: 0xdde7e8, transparent: true, opacity: 0.34, roughness: 0.94,
      depthWrite: false, alphaTest: 0.025,
    }));
    this.cloudMesh.renderOrder = 2;

    this.globeGroup.rotation.z = THREE.MathUtils.degToRad(-13.5);
    this.globeGroup.add(this.globeMesh, this.cloudMesh, this.overlayGroup, this.markerGroup);
    this.scene.add(createStarField(), this.atmosphereMesh, this.globeGroup, this.impactGroup);
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
    this.resize();
    this.rebuildOverlays();
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  setCallbacks(
    onSelectPoi: (id: string) => void,
    onSelectSurface: (coordinates: LonLat, address?: MaterialAddress) => void,
    onStats?: (stats: GlobeStats) => void,
  ): void {
    this.onSelectPoi = onSelectPoi;
    this.onSelectSurface = onSelectSurface;
    this.onStats = onStats;
  }

  setCaoFoundationStateCallback(
    callback: ((state: CaoFoundationRenderState) => void) | undefined,
  ): void {
    this.onCaoFoundationState = callback;
  }

  setPreparedCaoRevision(revision: PreparedCaoRevision | null): CaoFoundationDiagnostics | null {
    if (revision === null) {
      this.caoFoundationRenderer.clear();
      this.hasNativePublication = false;
      this.preparedAnchors = [];
      this.rebuildMarkers();
      this.pendingCaoDiagnostics = null;
      delete this.renderer.domElement.dataset.caoFoundationIdentity;
      this.renderer.domElement.dataset.caoFoundationStatus = "waiting";
      this.renderer.domElement.dataset.caoFoundationGeographySupport = "unsupported-editorial-uniform";
      this.renderer.domElement.dataset.surfaceStatus = "waiting";
      this.onCaoFoundationState?.({ status: "loading" });
      return null;
    }
    const preparedAnchors: PreparedAnchorMarker[] = [];
    try {
      for (const id of revision.anchorIds) {
        const resolved = revision.resolveAnchor(id);
        const direction = resolved?.pose.direction;
        if (!resolved || resolved.pose.support.kind !== "supported" || direction == null) continue;
        const rendererDirection = gplatesToRendererDirection(numberScalarOps, direction);
        preparedAnchors.push(Object.freeze({ id,
          direction: new THREE.Vector3(...rendererDirection).normalize(),
          address: resolved.pose.address }));
      }
      this.renderer.domElement.dataset.caoFoundationStatus = "publishing";
      const diagnostics = this.caoFoundationRenderer.publish(revision, this.verticalExaggeration);
      this.hasNativePublication = true;
      this.preparedAnchors = Object.freeze(preparedAnchors);
      this.rebuildMarkers();
      this.caoFoundationRenderer.setLayerVisibility(this.layers.borders, this.layers.tectonics);
      this.pendingCaoDiagnostics = diagnostics;
      const dataset = this.renderer.domElement.dataset;
      dataset.caoFoundationStatus = "updating";
      dataset.caoFoundationIdentity = diagnostics.identity ?? "";
      dataset.caoFoundationRequestedAgeMa = String(diagnostics.requestedAgeMa ?? "");
      dataset.caoFoundationBatches = String(diagnostics.batches);
      dataset.caoFoundationVertices = String(diagnostics.vertices);
      dataset.caoFoundationTriangles = String(diagnostics.triangles);
      dataset.caoFoundationDrawCount = String(diagnostics.drawCount);
      dataset.caoFoundationStaticBytes = String(diagnostics.retainedStaticBytes);
      dataset.caoFoundationSourceBytes = String(diagnostics.activeSourceBytes);
      dataset.caoFoundationPublicationBytes = String(diagnostics.retainedPublicationBytes);
      dataset.caoFoundationPendingRetirementBytes = String(diagnostics.pendingRetirementBytes);
      dataset.caoFoundationPaletteEntries = String(diagnostics.paletteEntries);
      dataset.caoFoundationShellOffsetMetres = String(diagnostics.shellOffsetMetres);
      dataset.caoFoundationCountryLineBatches = String(diagnostics.countryLineBatches);
      dataset.caoFoundationCountryLineVertices = String(diagnostics.countryLineVertices);
      dataset.caoFoundationCountryLineSegments = String(diagnostics.countryLineSegments);
      dataset.caoFoundationNativeBoundarySegments = String(diagnostics.nativeBoundarySegments);
      dataset.caoFoundationNativeBoundarySourceAgeMa = diagnostics.nativeBoundarySourceAgeMa === null
        ? "" : String(diagnostics.nativeBoundarySourceAgeMa);
      dataset.caoFoundationTopologyOwnershipRings = String(diagnostics.topologyOwnershipRings);
      dataset.caoFoundationTopologyOwnershipSourceAgeMa =
        diagnostics.topologyOwnershipSourceAgeMa === null
          ? "" : String(diagnostics.topologyOwnershipSourceAgeMa);
      const correctionState = diagnostics.materialCorrections;
      dataset.caoFoundationGeographySupport = correctionState.formationUncertainActiveCharts > 0
        ? "cao-plus-formation-range-material"
        : correctionState.uncertainActiveCharts > 0
        ? correctionState.qualifiedActiveCharts > 0
          ? "cao-plus-qualified-and-uncertain-material"
          : "cao-plus-uncertain-material"
        : correctionState.modelInferredPoseActiveCharts > 0
          ? "cao-plus-model-pose-material"
        : correctionState.qualifiedActiveCharts > 0
          ? "cao-plus-qualified-material"
          : "native-cao-foundation";
      dataset.caoMaterialCorrectionIdentity = diagnostics.materialCorrectionIdentity ?? "";
      dataset.caoQualifiedMaterialCharts = String(correctionState.qualifiedActiveCharts);
      dataset.caoUncertainMaterialCharts = String(correctionState.uncertainActiveCharts);
      dataset.caoFormationUncertainMaterialCharts = String(correctionState.formationUncertainActiveCharts);
      dataset.caoModelInferredPoseCharts = String(correctionState.modelInferredPoseActiveCharts);
      dataset.caoOverriddenNativeCharts = String(correctionState.overriddenNativeCharts);
      dataset.surfaceStatus = "updating";
      dataset.surfaceMode = "surface";
      this.onCaoFoundationState?.({ status: "updating",
        requestedAgeMa: diagnostics.requestedAgeMa ?? undefined,
        resolvedVertices: diagnostics.vertices });
      return diagnostics;
    } catch (error) {
      this.renderer.domElement.dataset.caoFoundationStatus = "error";
      const message = error instanceof Error ? error.message : "Cao foundation publication failed";
      this.onCaoFoundationState?.({ status: "error", error: message });
      throw error;
    }
  }

  setEditorialSnapshot(snapshot: WorldSnapshot | null): void {
    this.snapshot = snapshot;
    const stage = snapshot?.environment.stage;
    this.impactGroup.visible = stage === "giant-impact";
    this.updateAtmosphere(stage, snapshot?.environment.atmosphereOpacity ?? 1);
    if (snapshot !== null) {
      const environment = snapshot.environment;
      this.renderer.domElement.dataset.editorialSurfaceStage = stage ?? "unspecified";
      this.globeMesh.material.color.set(editorialGlobeColor(environment));
      const hot = stage === "giant-impact" || stage === "magma-ocean";
      this.globeMesh.material.emissive.set(hot ? 0x5c1608 : 0x000000);
      this.globeMesh.material.emissiveIntensity = hot ? 0.38 : 0;
      this.globeMesh.material.needsUpdate = true;
      this.cloudMesh.material.opacity = THREE.MathUtils.clamp(
        0.12 + (environment.cloudCover ?? 0.5) * 0.34, 0.12, 0.42,
      );
      const age = snapshot.requestedAgeMa ?? snapshot.ageMa;
      if (!this.hasNativePublication && age > 540) {
        this.renderer.domElement.dataset.caoFoundationStatus = "unsupported";
        this.renderer.domElement.dataset.caoFoundationGeographySupport = "unsupported-editorial-uniform";
        this.renderer.domElement.dataset.surfaceStatus = "ready";
        this.onCaoFoundationState?.({ status: "unsupported", requestedAgeMa: age,
          displayedAgeMa: age, resolvedVertices: 0 });
      }
    }
    this.rebuildMarkers();
  }

  setLayers(layers: LayerVisibility): void {
    const guidesChanged = this.layers.guides !== layers.guides;
    this.layers = layers;
    this.cloudMesh.visible = layers.clouds;
    this.caoFoundationRenderer.setLayerVisibility(layers.borders, layers.tectonics);
    this.renderer.domElement.dataset.countryRibbonVisible = String(layers.borders);
    this.renderer.domElement.dataset.nativeBoundaryVisible = String(layers.tectonics);
    if (guidesChanged) this.rebuildOverlays();
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
    this.caoFoundationRenderer.setVerticalExaggeration(clamped);
    this.rebuildOverlays();
  }

  focus(coordinates: LonLat, requestedDistance?: number, kind: SpatialFocusKind = "area"): void {
    this.renderer.domElement.dataset.focusKind = kind;
    const direction = lonLatToVector3(coordinates).applyQuaternion(this.globeGroup.quaternion).normalize();
    this.focusAnimation = {
      from: this.camera.position.clone().normalize(),
      to: direction,
      fromDistance: this.camera.position.length(),
      toDistance: requestedDistance === undefined ? this.camera.position.length()
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
    this.reportCameraDistance();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.handleMotionPreference);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.controls.removeEventListener("start", this.handleControlsStart);
    this.controls.removeEventListener("end", this.handleControlsEnd);
    this.controls.dispose();
    this.caoFoundationRenderer.disposeForRendererTeardown();
    this.markerTexture.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Line
          || object instanceof THREE.Points || object instanceof THREE.Sprite) {
        if (!(object instanceof THREE.Sprite)) object.geometry?.dispose();
        const ownedTexture = object.userData.ownedTexture as THREE.Texture | undefined;
        ownedTexture?.dispose();
        disposeMaterial(object.material);
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    delete window.__earthHistoryDiagnostics;
  }

  private makeGlobeGeometry(): THREE.BufferGeometry {
    return createPoleSafeShellGeometry(1, this.effectiveQuality === "high" ? 24 : 16);
  }

  private makeCloudGeometry(): THREE.BufferGeometry {
    return createPoleSafeShellGeometry(1.014, this.effectiveQuality === "high" ? 18 : 12);
  }

  private applyEffectiveQuality(value: "high" | "low"): void {
    this.effectiveQuality = value;
    this.globeMesh.geometry.dispose();
    this.globeMesh.geometry = this.makeGlobeGeometry();
    this.cloudMesh.geometry.dispose();
    this.cloudMesh.geometry = this.makeCloudGeometry();
    this.resize();
  }

  private updateAtmosphere(stage: SurfaceStage | undefined, opacity: number): void {
    const hot = stage === "giant-impact" || stage === "magma-ocean" || stage === "cooling-crust";
    this.atmosphereMesh.material.opacity = Math.max(0.06, Math.min(0.28, opacity * (hot ? 0.26 : 0.14)));
    this.atmosphereMesh.material.color.set(hot ? 0xff6a2f : 0x87d5ff);
  }

  private rebuildMarkers(): void {
    clearGroup(this.markerGroup);
    const add = (id: string, direction: THREE.Vector3, address?: MaterialAddress) => {
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.markerTexture, color: 0x98dddc, transparent: true, opacity: 0.84,
        alphaTest: 0.025, depthTest: true, depthWrite: false,
      }));
      marker.position.copy(direction).multiplyScalar(1.028);
      marker.userData.markerTargetPixels = 9;
      marker.userData.poiId = id;
      if (address !== undefined) marker.userData.materialAddress = address;
      marker.renderOrder = 5;
      this.markerGroup.add(marker);
    };
    if (this.preparedAnchors.length > 0) {
      for (const anchor of this.preparedAnchors) add(anchor.id, anchor.direction, anchor.address);
    } else if (!this.hasNativePublication && this.snapshot !== null
        && (this.snapshot.requestedAgeMa ?? this.snapshot.ageMa) > 540) {
      for (const id of this.snapshot.poiIds) {
        const coordinates = this.snapshot.poiCoordinates?.[id];
        if (coordinates !== undefined) add(id, lonLatToVector3(coordinates).normalize());
      }
    }
    this.setSelectedPoi(this.selectedPoiId);
    this.renderer.domElement.dataset.caoFoundationAnchorMarkers = String(this.preparedAnchors.length);
  }

  private rebuildOverlays(): void {
    clearGroup(this.overlayGroup);
    if (!this.layers.guides) {
      this.renderer.domElement.dataset.referenceGuideVisible = "false";
      return;
    }
    for (const coordinates of createReferenceGuideLines()) {
      const positions = new Float32Array(coordinates.length * 3);
      coordinates.forEach((coordinate, index) => {
        const point = lonLatToVector3(coordinate, 1.0013);
        positions.set([point.x, point.y, point.z], index * 3);
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.computeBoundingSphere();
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: 0x8bb9b2, transparent: true, opacity: 0.58, depthTest: true,
        depthWrite: false,
      }));
      line.renderOrder = 2.8;
      line.userData.overlayLayer = "guides";
      line.userData.evidence = "schematic-climatological-reference";
      this.overlayGroup.add(line);
    }
    for (const label of REFERENCE_GUIDE_LABELS) {
      const texture = createGuideLabelTexture(label.text);
      const printed = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, color: 0xb7ccc5, transparent: true, opacity: 0.48,
        alphaTest: 0.025, depthTest: true, depthWrite: false,
      }));
      const direction = lonLatToVector3(label.coordinates).normalize();
      printed.position.copy(direction).multiplyScalar(1.0018);
      printed.scale.set(0.25, 0.042, 1);
      printed.renderOrder = 2.9;
      printed.userData.overlayLayer = "guides";
      printed.userData.guideLabelDirection = direction;
      printed.userData.ownedTexture = texture;
      this.overlayGroup.add(printed);
    }
    for (const coordinates of REFERENCE_GUIDE_POLES) {
      const direction = lonLatToVector3(coordinates).normalize();
      const texture = createPoleMarkerTexture();
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture, transparent: true, opacity: 0.96, alphaTest: 0.025,
        depthTest: true, depthWrite: false,
      }));
      sprite.position.copy(direction).multiplyScalar(1.00011);
      sprite.scale.setScalar(0.05);
      sprite.renderOrder = 3;
      sprite.userData.overlayLayer = "guides";
      sprite.userData.guideLabelDirection = direction;
      sprite.userData.guidePoleMarker = true;
      sprite.userData.ownedTexture = texture;
      this.overlayGroup.add(sprite);
    }
    this.renderer.domElement.dataset.referenceGuideVisible = "true";
  }

  private updateGuideLabelVisibility(): void {
    if (!this.layers.guides) return;
    this.guideInverseGlobeQuaternion.copy(this.globeGroup.quaternion).invert();
    this.guideCameraDirection.copy(this.camera.position).normalize()
      .applyQuaternion(this.guideInverseGlobeQuaternion);
    const scale = THREE.MathUtils.clamp(this.camera.position.length() / 1.38, 1, 2.8);
    for (const child of this.overlayGroup.children) {
      const direction = child.userData.guideLabelDirection as THREE.Vector3 | undefined;
      if (direction === undefined) continue;
      child.visible = isReferenceDirectionAboveHorizon(direction.dot(this.guideCameraDirection),
        this.camera.position.length(), 1.03, child.userData.guidePoleMarker === true ? 0 : 0.08);
      if (child instanceof THREE.Sprite && child.userData.guidePoleMarker === true) {
        child.scale.setScalar(0.05 * scale);
      }
    }
  }

  private updatePoiMarkerScale(): void {
    const viewportHeight = Math.max(1, this.renderer.domElement.clientHeight);
    const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / viewportHeight;
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

  private updateInspectionLight(): void {
    setInspectionLightPosition(this.sunLight.position, this.camera.position,
      this.camera.quaternion, this.inspectionLightScratch);
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

  private cameraCenter(): LonLat {
    const inverse = this.globeGroup.quaternion.clone().invert();
    return vector3ToLonLat(this.camera.position.clone().normalize().applyQuaternion(inverse));
  }

  private reportCameraDistance(): void {
    const distance = this.camera.position.length();
    if (Math.abs(distance - this.lastReportedCameraDistance) <= 0.0001) return;
    this.lastReportedCameraDistance = distance;
    this.renderer.domElement.dataset.cameraDistance = distance.toFixed(4);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (start === null || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.globeGroup.updateWorldMatrix(true, false);
    const worldToGlobe = this.globeGroup.matrixWorld.clone().invert();
    const localOrigin = this.raycaster.ray.origin.clone().applyMatrix4(worldToGlobe);
    const localRay = this.raycaster.ray.direction.clone().transformDirection(worldToGlobe);
    const caoHit = this.caoFoundationRenderer.intersectRay(
      [localOrigin.x, localOrigin.y, localOrigin.z], [localRay.x, localRay.y, localRay.z]);
    const sphereHit = this.raycaster.intersectObject(this.globeMesh, false)[0];
    const localDirection = caoHit === null
      ? sphereHit === undefined ? null : this.globeGroup.worldToLocal(sphereHit.point.clone()).normalize()
      : new THREE.Vector3(...caoHit.position).normalize();
    if (localDirection === null) return;

    if (this.renderer.domElement.dataset.focusKind !== "none") {
      this.onSelectSurface(vector3ToLonLat(localDirection), caoHit?.materialAddress);
      return;
    }
    const cameraDirection = this.camera.position.clone().normalize();
    const horizon = 1 / this.camera.position.length();
    const markerHit = this.raycaster.intersectObjects(this.markerGroup.children, false).find((candidate) => {
      const markerDirection = candidate.object.getWorldPosition(new THREE.Vector3()).normalize();
      return markerDirection.dot(cameraDirection) > horizon;
    });
    const poiId = markerHit?.object.userData.poiId;
    if (typeof poiId === "string") {
      this.onSelectPoi(poiId);
      return;
    }
    if (caoHit !== null) {
      this.renderer.domElement.dataset.caoFoundationPickedChart = String(caoHit.chartIndex);
      this.renderer.domElement.dataset.caoFoundationPickedTriangle = String(caoHit.triangleIndex);
    } else {
      const ownership = this.caoFoundationRenderer.identifyTopology(
        [localDirection.x, localDirection.y, localDirection.z],
      );
      this.renderer.domElement.dataset.caoFoundationPickedOwnership = ownership?.kind ?? "none";
      if (ownership?.kind === "instantaneous-owner") {
        this.renderer.domElement.dataset.caoFoundationPickedPlateId = String(ownership.plateId);
      } else {
        delete this.renderer.domElement.dataset.caoFoundationPickedPlateId;
      }
    }
    this.onSelectSurface(vector3ToLonLat(localDirection), caoHit?.materialAddress);
  };

  private readonly handleMotionPreference = (): void => {
    this.controls.autoRotate = this.autoRotate && !this.reducedMotion.matches;
  };

  private readonly handleControlsStart = (): void => {
    this.cameraInteractionActive = true;
    this.focusAnimation = null;
  };

  private readonly handleControlsEnd = (): void => {
    this.cameraInteractionActive = false;
  };

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const frameTime = now - this.previousFrame;
    this.previousFrame = now;
    if (frameTime > 0 && frameTime < 250) {
      this.frameTimes.push(frameTime);
      if (this.frameTimes.length > 300) this.frameTimes.shift();
    }
    this.controls.autoRotate = this.autoRotate && !this.reducedMotion.matches
      && this.focusAnimation === null && !this.cameraInteractionActive;
    this.controls.update();
    if (this.focusAnimation !== null) {
      const focus = this.focusAnimation;
      const progress = Math.min(1, (now - focus.started) / 950);
      const eased = 1 - Math.pow(1 - progress, 3);
      const direction = focus.from.clone().lerp(focus.to, eased).normalize();
      this.camera.position.copy(direction.multiplyScalar(
        THREE.MathUtils.lerp(focus.fromDistance, focus.toDistance, eased)));
      this.camera.lookAt(0, 0, 0);
      if (progress >= 1) this.focusAnimation = null;
    }
    const nextDetail: SurfaceDetail = this.effectiveQuality === "low"
      ? "coarse" : this.camera.position.length() <= 1.5 ? "regional" : "coarse";
    if (nextDetail !== this.detail) {
      this.detail = nextDetail;
      this.rebuildOverlays();
    }
    this.reportCameraDistance();
    this.updatePoiMarkerScale();
    this.updateInspectionLight();
    this.updateGuideLabelVisibility();
    if (this.impactGroup.visible && this.autoRotate && !this.reducedMotion.matches) {
      const elapsed = (now - this.animationStarted) / 1000;
      this.impactGroup.rotation.y = elapsed * 0.085;
      this.impactGroup.rotation.z = Math.sin(elapsed * 0.18) * 0.08;
    }
    if (this.cloudMesh.visible && !this.reducedMotion.matches) {
      this.cloudMesh.rotation.y += frameTime * 0.000005;
    }
    try {
      this.renderer.render(this.scene, this.camera);
      if (this.pendingCaoDiagnostics !== null) {
        const published = this.pendingCaoDiagnostics;
        this.pendingCaoDiagnostics = null;
        this.renderer.domElement.dataset.caoFoundationStatus = "ready";
        this.renderer.domElement.dataset.surfaceStatus = "ready";
        this.onCaoFoundationState?.({ status: "ready",
          requestedAgeMa: published.requestedAgeMa ?? undefined,
          displayedAgeMa: published.requestedAgeMa ?? undefined,
          resolvedVertices: published.vertices });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cao foundation render failed";
      this.pendingCaoDiagnostics = null;
      this.caoFoundationRenderer.clear();
      this.hasNativePublication = false;
      this.renderer.domElement.dataset.caoFoundationStatus = "error";
      this.renderer.domElement.dataset.surfaceStatus = "error";
      this.onCaoFoundationState?.({ status: "error", error: message });
      console.error("Cao foundation render failed", error);
    }
    if (now - this.lastStatsAt >= 1000) this.publishStats(now);
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private publishStats(now: number): void {
    this.lastStatsAt = now;
    const recent = this.frameTimes.slice(-180);
    const p50 = percentile(recent, 0.5);
    const p95 = percentile(recent, 0.95);
    if (this.requestedQuality === "auto" && this.effectiveQuality === "high"
        && recent.length >= 120 && p95 > 33) this.applyEffectiveQuality("low");
    const memory = this.renderer.info.memory ?? {};
    const diagnostics: EarthHistoryDiagnostics = {
      backend: this.backend,
      effectiveQuality: this.effectiveQuality,
      detail: this.detail,
      frameTimeMs: { p50: Number(p50.toFixed(2)), p95: Number(p95.toFixed(2)), samples: recent.length },
      generationMs: 0, staleJobs: 0, cacheBytes: 0,
      rendererMemory: { geometries: memory.geometries ?? 0, textures: memory.textures ?? 0 },
      cameraDistance: Number(this.camera.position.length().toFixed(4)),
      regionalGenerationMs: 0, transition: "idle",
      temporal: { status: "removed", fraction: 0, updateMs: 0, maxChunkMs: 0,
        totalUpdateMs: 0, updateCount: 0, vertices: 0, resolvedVertices: 0,
        fallbackVertices: 0, stagingBytes: 0, scratchPeakBytes: 0 },
      cube: { status: "removed", requestedSnapshotId: null, requestedKey: null,
        displayedSnapshotId: null, displayedKey: null, visibleTiles: 0, residentTiles: 0,
        byFace: {}, maxNeighborLevelDelta: 0, generationMs: 0, selectionMs: 0,
        installMs: 0, cacheBytes: 0, geometryCopyBytes: 0, gpuTextureEstimateBytes: 0,
        workerRetainedBytes: 0, evictions: 0, queuedJobs: 0, workerPoolSize: 0, staleJobs: 0 },
    };
    window.__earthHistoryDiagnostics = diagnostics;
    const dataset = this.renderer.domElement.dataset;
    dataset.detail = diagnostics.detail;
    dataset.quality = diagnostics.effectiveQuality;
    dataset.frameP50 = String(diagnostics.frameTimeMs.p50);
    dataset.frameP95 = String(diagnostics.frameTimeMs.p95);
    dataset.generationMs = "0";
    dataset.cameraLongitude = this.cameraCenter()[0].toFixed(4);
    dataset.cameraLatitude = this.cameraCenter()[1].toFixed(4);
    dataset.cameraSurfaceClearanceEarthRadii = (diagnostics.cameraDistance - 1).toFixed(6);
    this.onStats?.({ fps: p50 > 0 ? Number((1000 / p50).toFixed(0)) : 0,
      backend: this.backend === "webgpu" ? "WebGPU" : "WebGL 2",
      detail: this.detail, triangles: this.renderer.info.render?.triangles,
      status: dataset.surfaceStatus ?? "initializing" });
  }
}
