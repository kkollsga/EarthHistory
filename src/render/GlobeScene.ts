import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GlobeStats, LayerVisibility, LonLat, SurfaceStage, WorldSnapshot } from "../data";
import {
  buildPalaeoOutlineToneTexels,
  chartPickStateFromMotionFrame,
  decodePalaeoOutlineToneTables,
  gplatesToRendererDirection,
  numberScalarOps,
  palaeoOutlineToneCounts,
  type CaoPalaeoIntervalFrame,
  type MaterialAddress,
  type PalaeoOutlineToneTables,
  type PreparedCaoPalaeoInterval,
  type PreparedCaoRevision,
  type UnitDirection,
} from "../reconstruction";
import { createPoleSafeShellGeometry } from "./poleSafeGeometry";
import { lonLatToVector3, vector3ToLonLat, worldToGlobeLocalDirection } from "./math";
import {
  advanceGuideLabelToneScan,
  createGuideLabelGroup,
  createGuideLabelToneScan,
  createLongitudeCrossingTickLines,
  createPolarSectorTickLines,
  createReferenceGuideLines,
  GUIDE_LABEL_EDITORIAL_TONE,
  GUIDE_LABEL_TONE_PROBE_BUDGET_PER_FRAME,
  GUIDE_LABEL_TONE_SETTLE_MS,
  REFERENCE_GUIDE_LABELS,
  type GuideLabelGroup,
  type GuideLabelToneScan,
} from "./globeGuides";
import { setInspectionLightPosition } from "./inspectionLight";
import {
  CAO_FOUNDATION_GLOBE_SPHERE_RENDER_ORDER,
  CaoFoundationSurfaceRenderer,
  type CaoFoundationDiagnostics,
  type CaoFoundationSurfaceHit,
  type CaoFoundationSurfaceView,
} from "./reconstruction/caoFoundation";
import {
  caoSurfaceSetCoversDirection,
  caoSurfaceSetReferenceSurfaceClass,
  intersectCaoSurfaceSet,
  type CaoSurfaceSetView,
} from "./reconstruction/surfaceSet";
import {
  caoPalaeoCoastlineDomainBand,
  resolveReleasableNativeSurfaceClasses,
  resolveSurfaceVisibility,
  SURFACE_VISIBILITY_INITIAL_HYSTERESIS,
  type SurfaceVisibilityResolution,
} from "./reconstruction/surfaceVisibility";
import { CAO_SOURCE_AGE_DOMAIN_MA } from "../reconstruction/caoDomain";
import {
  GpuRetirementOwner,
  WebGl2SubmissionFence,
  WebGpuSubmissionFence,
} from "./reconstruction/gpuRetirement";

export type SpatialFocusKind = "poi" | "place" | "area";
type RequestedQuality = "auto" | "high" | "low";
type SurfaceDetail = "coarse" | "regional";

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
  inspectionLightCameraDot: number;
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

/**
 * Surface class covering one piece of present-day ground at the drawn age, or
 * null. The compiled witness table (`palaeo_coastlines_correction.py`) asks
 * exactly this question offline; the browser suite asks it of the live scene so
 * the two cannot drift, and nothing in the application reads it.
 */
export type EarthHistorySurfaceProbe =
  (longitudeDegrees: number, latitudeDegrees: number) => string | null;

/**
 * Surface class and incident-light cosine under one canvas pixel, or null where
 * no surface chart is drawn there.
 *
 * The rendered tone of a surface class is not its base colour: the inspection
 * light, the hemisphere fill and the ACES curve carry a base colour a long way,
 * and they carry it further the closer the ground is to the sub-camera point.
 * A tone contract can therefore only be asserted against what the frame
 * actually contains, which needs the class *under a pixel* and the lighting
 * that pixel was shaded at. `cosLight` is the same `dot(normal, lightDirection)`
 * the fragment stage uses, so a census can bucket pixels by lighting rather
 * than assuming a uniform frame. The browser suite reads it; nothing in the
 * application calls it.
 */
export type EarthHistoryPixelSurfaceProbe = (
  cssX: number,
  cssY: number,
) => {
  readonly surfaceClass: string;
  readonly cosLight: number;
  /** Renderer-frame longitude/latitude of the hit, the frame `at=` names. */
  readonly direction: readonly [number, number];
} | null;

/**
 * What each motion path had posed on one rendered frame.
 *
 * The native surface — the country outlines are drawn on it — and the palaeo
 * charts are retargeted by separate calls, so "do they move together" is only
 * answerable per frame. A pose is one chart's own quaternion (w, x, y, z) as it
 * was handed to the renderer, which makes the angle between two of them the
 * whole angular discrepancy of that chart, whatever point on it is measured.
 * The browser suite reads this; nothing in the application calls it.
 */
export interface EarthHistoryMotionSample {
  readonly frameIndex: number;
  /** `performance.now()` of the frame, so the record carries its own cadence. */
  readonly timeMs: number;
  readonly nativeAgeMa: number | null;
  readonly nativePose: readonly [number, number, number, number] | null;
  readonly palaeoAgeMa: number | null;
  readonly palaeoPose: readonly [number, number, number, number] | null;
  /** Age range of the palaeo map interval the sampled palaeo pose belongs to. */
  readonly palaeoFromAgeMa: number | null;
  readonly palaeoToAgeMa: number | null;
  /**
   * The map interval whose geometry is on screen on this frame, read from the
   * publication rather than from the pose. A boundary crossing must never leave
   * this null between two intervals: the outgoing map stays drawn and posed
   * until the incoming one is published.
   */
  readonly palaeoPublishedIntervalId: string | null;
}

/** `start` clears and arms the recording, `stop` disarms it, `read` returns it. */
export type EarthHistoryMotionProbe =
  (command: "start" | "stop" | "read") => readonly EarthHistoryMotionSample[];

declare global {
  interface Window {
    __earthHistoryDiagnostics?: EarthHistoryDiagnostics;
    __earthHistorySurfaceProbe?: EarthHistorySurfaceProbe;
    __earthHistoryPixelSurfaceProbe?: EarthHistoryPixelSurfaceProbe;
    __earthHistoryMotionProbe?: EarthHistoryMotionProbe;
  }
}

/** Bound on one motion recording: about 20 s of frames, then it disarms itself. */
const MOTION_PROBE_SAMPLE_LIMIT = 1200;

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
  compileAsync?(
    object: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Object3D,
  ): Promise<unknown>;
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
    // A guide label is a Group of tone segments that share two owned sheets;
    // its children are disposed first, then the sheets exactly once.
    if (child instanceof THREE.Group) {
      clearGroup(child);
      for (const texture of (child.userData.ownedTextures as THREE.Texture[] | undefined) ?? []) {
        texture.dispose();
      }
      continue;
    }
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

/** Small steady ring/dot for locked material follow; no pulse or broad halo. */
function createFocusLockMarkerTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("Unable to create focus-lock marker texture");
  context.clearRect(0, 0, 64, 64);
  context.beginPath();
  context.arc(32, 32, 22, 0, Math.PI * 2);
  context.strokeStyle = "rgba(2, 8, 11, 0.96)";
  context.lineWidth = 8;
  context.stroke();
  context.beginPath();
  context.arc(32, 32, 22, 0, Math.PI * 2);
  context.strokeStyle = "rgba(239, 248, 244, 0.98)";
  context.lineWidth = 3;
  context.stroke();
  context.beginPath();
  context.arc(32, 32, 6, 0, Math.PI * 2);
  context.fillStyle = "rgba(2, 8, 11, 0.96)";
  context.fill();
  context.beginPath();
  context.arc(32, 32, 2.75, 0, Math.PI * 2);
  context.fillStyle = "rgba(239, 248, 244, 1)";
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true;
  texture.generateMipmaps = false;
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
  maxPendingResources = 2,
  maxPendingBytes = 4 * 1024 * 1024,
): GpuRetirementOwner {
  if (backend === "webgpu") {
    const queue = renderer.backend?.device?.queue;
    if (!queue) throw new Error("Cao renderer requires the active WebGPU submission queue");
    return new GpuRetirementOwner(new WebGpuSubmissionFence(queue),
      maxPendingResources, maxPendingBytes);
  }
  const context = renderer.backend?.gl ?? renderer.getContext?.();
  if (!(context instanceof WebGL2RenderingContext)) {
    throw new Error("Cao renderer requires the active WebGL2 context");
  }
  return new GpuRetirementOwner(new WebGl2SubmissionFence(context),
    maxPendingResources, maxPendingBytes);
}

/**
 * Bounds for the whole surface set: the Cao 2024 units and the Cao 2017 map
 * interval that replaces them in the land, continents and mountain slots.
 *
 * One renderer holds both, so the ceilings are the union of what each instance
 * reserved before, not the larger of the two. Probed on the loaded public
 * package 2026-09-16: 404,888 Cao 2024 surface vertices and 574,075 triangles,
 * plus 51,048 country segments at 1:50m — drawn as screen-space quads, four
 * expanded corners and two triangles each — preflighting at 609,080 vertices
 * and 676,171 triangles. Measured 2026-09-15 over the promoted `lm`+`sm`+`m`
 * set, after the cookie-cut seam buffer and the 1,000 km frame-conflict drop:
 * the worst map interval refines to 393,375 vertices and 605,192 triangles (the
 * promoted manifest's own reservation). The refined counts are roughly 1.9x the
 * compiler's own triangle estimate, because this runtime bisects conformingly
 * while the compiler models each triangle alone; the 1 degree edge bound is the
 * chord-sag contract and cannot be relaxed to bring it down.
 *
 * The union of the two worst cases is about 1.00 M vertices and 1.28 M
 * triangles, which the ceilings below carry with the same headroom each
 * instance kept. Retained source is 48 + 30 MiB minus the headroom that was
 * duplicated.
 *
 * The vertex, triangle and retained-source ceilings are per *drawn*
 * composition — the Cao 2024 stack and the one map interval on screen — and
 * keep the numbers above. Map intervals the set keeps resident behind the drawn
 * one spend no vertices or triangles, because they draw nothing; what bounds
 * them is `maxResidentIntervalGpuBytes`.
 *
 * Residency: up to 25 map intervals stay uploaded, so a crossing back into one
 * is a visibility switch. Measured 2026-09-16 on the promoted interval set,
 * the whole set's vertex and index buffers are about 40 MB; 55 MiB is the
 * ceiling, which leaves headroom for the refinement the worst interval reaches
 * and makes eviction the exception rather than the steady state. Residency is a
 * memory policy, not a shading profile: see `residentIntervalBudget`.
 *
 * The publication ledger is the one number the union is not simply the larger
 * of: it now holds every resident member at once. Measured on the loaded public
 * package 2026-09-16, the Cao 2024 publication at 0 Ma is 676,177 B — a
 * 5,675-entry palette, its per-chart pose table, the exact-knot boundary and
 * ownership layers and the outline tone texture. A map-interval publication is
 * a palette and a pose table only, under the 512 KiB its own instance reserved.
 * Twenty-five of those reserve 12.5 MiB, and a scrub sample inside the band
 * must still fit beside the Cao 2024 publication it replaces, which is retiring
 * behind the submission fence: 12.5 MiB + 676 + 676 KiB is under 14 MiB, and
 * 20 MiB carries it with the headroom the 4 MiB union kept.
 */
const CAO_SURFACE_SET_LIMITS = Object.freeze({
  maxBatches: 512,
  maxVertices: 1_000_000,
  maxTriangles: 1_280_000,
  maxRetainedSourceBytes: 64 * 1024 * 1024,
  maxPublicationBytes: 20 * 1024 * 1024,
  maxSpatialIndexBytes: 1024 * 1024,
  maxResidentIntervalGpuBytes: 55 * 1024 * 1024,
});

/** Map intervals kept on the GPU at once; see `CAO_SURFACE_SET_LIMITS`. */
const CAO_RESIDENT_INTERVALS_HIGH = 25;
const CAO_RESIDENT_INTERVALS_LOW = 8;
const CAO_RESIDENT_INTERVAL_BYTES_HIGH = 55 * 1024 * 1024;
const CAO_RESIDENT_INTERVAL_BYTES_LOW = 24 * 1024 * 1024;
/** Device memory, in GiB, under which the small residency budget is taken. */
const CAO_RESIDENT_INTERVAL_SMALL_DEVICE_MEMORY_GB = 4;

/**
 * How much GPU residency a map-interval crossing may reuse.
 *
 * Residency is a memory policy and not a shading profile. The automatic quality
 * watchdog downgrades shading when frames are slow, and slow frames are exactly
 * what residency fixes: collapsing the ceiling with the profile meant the first
 * heavy load turned every later crossing into a fresh upload, and there is no
 * path back to "high" within a session. So only two things lower it — the user
 * explicitly selecting the low profile, and a device that has told us it has
 * little memory.
 */
export function residentIntervalBudget(
  requested: RequestedQuality,
  deviceMemoryGb: number | undefined,
): { readonly intervals: number; readonly bytes: number } {
  const small = requested === "low"
    || (typeof deviceMemoryGb === "number" && Number.isFinite(deviceMemoryGb)
      && deviceMemoryGb < CAO_RESIDENT_INTERVAL_SMALL_DEVICE_MEMORY_GB);
  return small
    ? { intervals: CAO_RESIDENT_INTERVALS_LOW, bytes: CAO_RESIDENT_INTERVAL_BYTES_LOW }
    : { intervals: CAO_RESIDENT_INTERVALS_HIGH, bytes: CAO_RESIDENT_INTERVAL_BYTES_HIGH };
}

/**
 * How long an idle pre-upload may wait for a genuinely idle slot before it is
 * taken anyway. Long enough that a live gesture is never interrupted by it, and
 * short enough that a settled page finishes the timeline rather than stalling
 * one crossing short of it.
 */
const PALAEO_PRELOAD_IDLE_TIMEOUT_MS = 2_000;

/**
 * One publish held until the frame that will draw it, latest wins.
 *
 * A prepared interval owns a runtime lease, and publishing takes that lease
 * over. Deferring the publish therefore means owning the lease in the meantime:
 * a queued publish that is superseded, or one still queued when the scene is
 * torn down, has to release what the publish would have released. A superseded
 * publish is not a failed one, so its caller hears nothing — answering it would
 * report a publication failure for an interval the age has simply moved past.
 */
export class DeferredPublishQueue<Payload extends { release(): void }, Result> {
  /** `undefined` is the empty state, because a queued `null` is the clear. */
  private queued: {
    readonly payload: Payload | null;
    readonly onPublished?: (result: Result) => void;
  } | undefined = undefined;

  queue(payload: Payload | null, onPublished?: (result: Result) => void): void {
    this.queued?.payload?.release();
    this.queued = { payload, onPublished };
  }

  /** Whether a publish is waiting. */
  pending(): boolean {
    return this.queued !== undefined;
  }

  /** Runs the waiting publish, if any, and answers whether one ran. */
  drain(publish: (payload: Payload | null) => Result): boolean {
    const queued = this.queued;
    if (queued === undefined) return false;
    this.queued = undefined;
    // The publish runs whether or not anyone is listening: `f?.(publish(x))`
    // skips the argument too when `f` is undefined, which would silently drop
    // every publish queued without a callback.
    const result = publish(queued.payload);
    queued.onPublished?.(result);
    return true;
  }

  /** Drops a waiting publish and releases its lease. Nothing is published. */
  abandon(): void {
    this.queued?.payload?.release();
    this.queued = undefined;
  }
}

/** The part of the renderer a member warm uses. */
export interface CaoMemberWarmRenderer {
  compileAsync?(
    object: THREE.Object3D, camera: THREE.Camera, targetScene?: THREE.Object3D,
  ): Promise<unknown>;
}

/**
 * Puts one preloaded map-interval member's buffers and pipeline on the GPU
 * without ever drawing it.
 *
 * Parenting a hidden group uploads nothing: `Renderer._projectObject` returns
 * early for `visible === false`, so the member is not traversed, no attribute
 * buffer is created for it and no program is compiled — which is why the first
 * crossing into a "preloaded" interval still paid a ~50 ms first-draw frame.
 * `compileAsync` does both halves of that work (`_geometries.updateForRender`
 * builds the buffers, `_pipelines.getForRender` compiles the program), but only
 * for objects its own traversal reaches.
 *
 * So the group is shown for exactly the synchronous part of the call. The
 * traversal that collects the work items runs before `compileAsync` reaches its
 * first `await`, so hiding the group again the instant the call returns its
 * promise is enough: no animation frame can run in between, and the uploads and
 * compiles that follow read the captured work items rather than `visible`.
 *
 * Answers whether the warm was started. A renderer without `compileAsync` — the
 * classic WebGL renderer, or a test double — warms nothing and says so.
 */
export function warmCaoMember(
  renderer: CaoMemberWarmRenderer,
  group: THREE.Group,
  camera: THREE.Camera,
  scene: THREE.Object3D,
  onFailure?: (error: unknown) => void,
): boolean {
  if (typeof renderer.compileAsync !== "function") return false;
  const hidden = !group.visible;
  group.visible = true;
  let pending: Promise<unknown>;
  try {
    pending = renderer.compileAsync(group, camera, scene);
  } finally {
    // Restored in `finally` and never on a later turn: a member left visible
    // draws the wrong interval over the current one on the very next frame.
    if (hidden) group.visible = false;
  }
  void Promise.resolve(pending).catch((error: unknown) => onFailure?.(error));
  return true;
}

/** One map interval the background walk has finished preparing. */
export interface PalaeoPreparedIntervalNotice {
  readonly intervalId: string;
  readonly fromAgeMa: number;
  readonly toAgeMa: number;
}

/**
 * The engine, as the idle pre-upload uses it: it says when an interval has been
 * prepared, and it hands back a revision for one already resident without
 * starting a fetch or superseding the foreground request.
 */
export interface PalaeoIntervalPreloadSource {
  onPalaeoIntervalPrepared(listener: (notice: PalaeoPreparedIntervalNotice) => void): () => void;
  prepareResidentPalaeoIntervalNow(intervalId: string): PreparedCaoPalaeoInterval | null;
}

/** The residency the surface set actually holds, as the renderer reports it. */
export interface CaoResidencyReporter {
  residentGpuBytes(): number;
  residentIntervalCount(): number;
  releasedSurfaceClasses(): readonly string[];
}

/**
 * Writes the three residency keys from one reading of the surface set.
 *
 * Separated from the scene so the keys can be proved to move: they are the only
 * published account of what the GPU holds, and every one of their readers is
 * outside this module.
 */
export function writeCaoResidencyDataset(
  dataset: Record<string, string | undefined>,
  renderer: CaoResidencyReporter,
): void {
  dataset.caoFoundationGpuBytes = String(renderer.residentGpuBytes());
  dataset.caoResidentIntervals = String(renderer.residentIntervalCount());
  dataset.caoFoundationReleasedClasses = renderer.releasedSurfaceClasses().join(" ");
}

/** What `navigator.deviceMemory` reports, where the browser reports it. */
function reportedDeviceMemoryGb(): number | undefined {
  return (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
}
/**
 * Publications retire one member at a time: a scrub sample replaces the Cao
 * 2024 member, a crossing replaces the map interval, and a crossing can land in
 * the frame after a sample. Three resources and 44 MiB cover both in flight —
 * the two the Cao 2024 arm always allowed, plus the one map-interval
 * publication the Cao 2017 arm did.
 */
const CAO_SURFACE_RETIREMENT_MAX_RESOURCES = 3;
const CAO_SURFACE_RETIREMENT_MAX_BYTES = 44 * 1024 * 1024;
/**
 * Only a map-interval eviction retires static geometry. At the low profile that
 * is one swap at a time, as it always was; at the high profile it happens only
 * once residency is full, and a single crossing may have to make room for a
 * large interval by evicting more than one resident.
 */
const CAO_STATIC_GEOMETRY_RETIREMENT_MAX_RESOURCES = 4;
const CAO_STATIC_GEOMETRY_RETIREMENT_MAX_BYTES = 64 * 1024 * 1024;

interface PreparedAnchorMarker {
  readonly id: string;
  readonly direction: THREE.Vector3;
  readonly address: MaterialAddress;
}

export interface CaoMotionAnchorMarker {
  readonly id: string;
  readonly direction: UnitDirection;
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
  private readonly focusLockMarkerTexture = createFocusLockMarkerTexture();
  private focusLockMarker: THREE.Sprite | null = null;
  /** World-space unit direction for continuous location follow while scrubbing. */
  private followTarget: THREE.Vector3 | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly frameTimes: number[] = [];
  // Motion-synchrony recording. Disarmed by default, so nothing but the browser
  // suite ever pays for it, and self-disarming at MOTION_PROBE_SAMPLE_LIMIT.
  private motionProbeRecording = false;
  private motionProbeFrameIndex = 0;
  private readonly motionProbeSamples: EarthHistoryMotionSample[] = [];
  private motionProbeNativeChart = -1;
  private motionProbePalaeoChart = -1;
  private motionProbeNative:
  { ageMa: number; pose: [number, number, number, number] } | null = null;
  private motionProbePalaeo: {
    ageMa: number; pose: [number, number, number, number];
    fromAgeMa: number; toAgeMa: number;
  } | null = null;
  private readonly reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly guideCameraDirection = new THREE.Vector3();
  private readonly guideInverseGlobeQuaternion = new THREE.Quaternion();
  // Set whenever the surface under the labels can have moved. A round only
  // starts once this has been quiet for GUIDE_LABEL_TONE_SETTLE_MS, so a
  // continuous scrub keeps deferring instead of probing on every sample.
  private guideLabelTonesStaleSince: number | null = 0;
  private guideLabelToneScan: GuideLabelToneScan | null = null;
  private guideLabelToneRoundProbes = 0;
  private guideLabelToneRoundMs = 0;
  private readonly markerWorldPosition = new THREE.Vector3();
  private readonly markerWorldScale = new THREE.Vector3();
  private readonly focusMarkerProjectedPosition = new THREE.Vector3();
  private readonly controls: OrbitControls;
  private readonly caoFoundationRenderer: CaoFoundationSurfaceRenderer;
  private readonly globeMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private readonly cloudMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private resizeObserver: ResizeObserver;
  private layers: LayerVisibility = { clouds: true, borders: true, guides: true,
    tectonics: false, rivers: false, palaeoCoastlines: false };
  private palaeoRequestedAgeMa: number | null = null;
  /**
   * The one resolved composition: which classes are on screen, which stack the
   * native instance draws, the reported mode and the hysteresis carried to the
   * next frame. Nothing in this class re-derives any of it.
   */
  private surfaceVisibility: SurfaceVisibilityResolution = resolveSurfaceVisibility({
    layerEnabled: false, band: "none", published: false,
    hysteresis: SURFACE_VISIBILITY_INITIAL_HYSTERESIS,
  });
  private palaeoOutlineToneTable: Uint8Array | null = null;
  private palaeoOutlineToneIntervalId: string | null = null;
  /** The interval whose charts are published, and the one its geometry belongs to. */
  private publishedPalaeoIntervalId: string | null = null;
  /**
   * The idle pre-upload queue: map intervals the background walk has prepared
   * and this scene has not yet uploaded as a hidden GPU member. See
   * `setPalaeoIntervalPreloadSource`.
   */
  private readonly palaeoPreloadQueue = new Map<string, PalaeoPreparedIntervalNotice>();
  private readonly palaeoPreloadedIntervalIds = new Set<string>();
  private palaeoPreloadSource: PalaeoIntervalPreloadSource | null = null;
  private palaeoPreloadUnsubscribe: (() => void) | null = null;
  private palaeoPreloadHandle: number | null = null;
  private palaeoPreloadIsIdleHandle = false;
  /** Hidden members whose buffers and pipeline this scene has warmed at idle. */
  private palaeoWarmedMembers = 0;
  /** The publish waiting for the next frame. See `setPreparedPalaeoInterval`. */
  private readonly queuedPalaeoPublish =
    new DeferredPublishQueue<PreparedCaoPalaeoInterval, CaoFoundationDiagnostics | null>();
  private palaeoPublicationFailureReason: string | null = null;
  private palaeoIntervalSourceBytes = 0;
  /** Verified EHPT bytes and the table the active interval reads, held until a decode is possible. */
  private palaeoTonePayload: Uint8Array | null = null;
  private palaeoToneTableIndex = -1;
  private palaeoToneSourceIntervalId: string | null = null;
  private palaeoToneTables: PalaeoOutlineToneTables | null = null;
  private palaeoToneDecodedFrom: Uint8Array | null = null;
  private reportedPalaeoIntervalId: string | null | undefined = undefined;
  private reportedPalaeoAssetBytes = -1;
  /** `undefined` until the first apply, so the initial all-dark upload happens once. */
  private appliedOutlineToneIntervalId: string | null | undefined = undefined;
  /** Last values written to the canvas dataset, so a still frame writes nothing. */
  private reportedOutlineToneIntervalId: string | null | undefined = undefined;
  private reportedOutlineToneDarkSegments = -1;
  private reportedOutlineToneLightSegments = -1;
  private requestedQuality: RequestedQuality;
  private effectiveQuality: "high" | "low";
  private detail: SurfaceDetail = "coarse";
  private selectedPoiId: string | null = null;
  private snapshot: WorldSnapshot | null = null;
  private preparedAnchors: readonly PreparedAnchorMarker[] = [];
  private pendingCaoDiagnostics: CaoFoundationDiagnostics | null = null;
  private hasNativePublication = false;
  private caoFoundationWithheld = false;
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
    // One renderer owns the whole surface set. It keeps two retirement owners —
    // one for publications, one for the static geometry a map-interval change
    // replaces — because a single owner bounded at one pending resource cannot
    // hold both retirements of the same swap.
    this.caoFoundationRenderer = new CaoFoundationSurfaceRenderer(
      this.globeGroup,
      createCaoGpuRetirementOwner(renderer, backend,
        CAO_SURFACE_RETIREMENT_MAX_RESOURCES, CAO_SURFACE_RETIREMENT_MAX_BYTES),
      { ...CAO_SURFACE_SET_LIMITS, maxTextureSize: maximumTextureSize,
        maxResidentIntervals: residentIntervalBudget(
          requestedQuality, reportedDeviceMemoryGb()).intervals,
        maxResidentIntervalGpuBytes: residentIntervalBudget(
          requestedQuality, reportedDeviceMemoryGb()).bytes },
      {
        staticGeometryRetirement: createCaoGpuRetirementOwner(renderer, backend,
          CAO_STATIC_GEOMETRY_RETIREMENT_MAX_RESOURCES, CAO_STATIC_GEOMETRY_RETIREMENT_MAX_BYTES) },
    );
    // The renderer names the hidden member; only the scene has the renderer,
    // the camera and the drawn scene the warm needs.
    this.caoFoundationRenderer.setMemberWarmer((group) => this.warmPalaeoMember(group));

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
    renderer.domElement.dataset.focusMarker = "false";
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
    this.globeMesh.renderOrder = CAO_FOUNDATION_GLOBE_SPHERE_RENDER_ORDER;
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

  private applyCaoFoundationWithheldState(): CaoFoundationDiagnostics {
    const diagnostics = this.caoFoundationRenderer.setDomainVisibility(false);
    this.updatePalaeoDomainVisibility();
    this.pendingCaoDiagnostics = null;
    this.markerGroup.visible = false;
    const dataset = this.renderer.domElement.dataset;
    dataset.caoFoundationStatus = "waiting";
    dataset.caoFoundationRequestedAgeMa = String(diagnostics.requestedAgeMa ?? "");
    dataset.caoFoundationDrawCount = "0";
    dataset.caoFoundationGeographySupport = "unsupported-editorial-uniform";
    dataset.caoObservedMaterialCharts = "0";
    dataset.caoClassifiedShallowMarineCharts = "0";
    dataset.caoQualifiedMaterialCharts = "0";
    dataset.caoUncertainMaterialCharts = "0";
    dataset.caoFormationUncertainMaterialCharts = "0";
    dataset.caoModelInferredPoseCharts = "0";
    dataset.caoOverriddenNativeCharts = "0";
    dataset.caoFoundationNativeBoundarySegments = "0";
    dataset.caoFoundationNativeBoundarySourceAgeMa = "";
    dataset.caoFoundationTopologyOwnershipRings = "0";
    dataset.caoFoundationTopologyOwnershipSourceAgeMa = "";
    dataset.caoFoundationAnchorMarkers = "0";
    dataset.caoFoundationAnchorAgeMa = "";
    dataset.focusMarker = "false";
    dataset.surfaceStatus = "waiting";
    this.onCaoFoundationState?.({ status: "loading",
      requestedAgeMa: diagnostics.requestedAgeMa ?? undefined, resolvedVertices: 0 });
    return diagnostics;
  }

  setCaoFoundationWithheld(withheld: boolean): CaoFoundationDiagnostics | null {
    if (withheld === this.caoFoundationWithheld) {
      return withheld ? this.applyCaoFoundationWithheldState() : null;
    }
    this.caoFoundationWithheld = withheld;
    this.guideLabelTonesStaleSince = performance.now();
    // Recovery makes the group visible only after a current revision or motion
    // frame updates its marker poses; the retained sprites may still be stale.
    return withheld ? this.applyCaoFoundationWithheldState() : null;
  }

  retargetCaoMotion(
    paletteValues: Float32Array,
    entryCount: number,
    displayFraction: number,
    chartPoses: Float32Array,
    chartActive: Uint8Array,
    requestedAgeMa: number,
    materialCorrections: PreparedCaoRevision["materialCorrections"],
    anchorMarkers: readonly CaoMotionAnchorMarker[],
  ): CaoFoundationDiagnostics | null {
    if (!this.hasNativePublication) return null;
    try {
      this.caoFoundationRenderer.retargetMotion(
        paletteValues, entryCount, displayFraction, chartPoses, chartActive, requestedAgeMa,
        materialCorrections);
      if (this.motionProbeRecording) {
        const sampled = this.motionProbePose(chartPoses, chartActive, this.motionProbeNativeChart);
        if (sampled !== null) {
          this.motionProbeNativeChart = sampled.chartIndex;
          this.motionProbeNative = { ageMa: requestedAgeMa, pose: sampled.pose };
        }
      }
      this.updatePreparedAnchorMarkers(anchorMarkers, requestedAgeMa);
      this.palaeoRequestedAgeMa = requestedAgeMa;
      this.applyLayerVisibility();
      this.guideLabelTonesStaleSince = performance.now();
      if (this.caoFoundationWithheld) return this.applyCaoFoundationWithheldState();
      this.markerGroup.visible = true;
      const diagnostics = this.caoFoundationRenderer.diagnostics();
      this.pendingCaoDiagnostics = diagnostics;
      const dataset = this.renderer.domElement.dataset;
      dataset.caoFoundationStatus = "updating";
      dataset.caoFoundationRequestedAgeMa = String(diagnostics.requestedAgeMa ?? "");
      dataset.caoFoundationDrawCount = String(diagnostics.drawCount);
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
      dataset.caoObservedMaterialCharts = String(correctionState.observedActiveCharts);
      dataset.caoClassifiedShallowMarineCharts =
        String(correctionState.classifiedShallowMarineActiveCharts);
      dataset.caoQualifiedMaterialCharts = String(correctionState.qualifiedActiveCharts);
      dataset.caoUncertainMaterialCharts = String(correctionState.uncertainActiveCharts);
      dataset.caoFormationUncertainMaterialCharts = String(correctionState.formationUncertainActiveCharts);
      dataset.caoModelInferredPoseCharts = String(correctionState.modelInferredPoseActiveCharts);
      dataset.caoOverriddenNativeCharts = String(correctionState.overriddenNativeCharts);
      dataset.surfaceStatus = "updating";
      this.onCaoFoundationState?.({ status: "updating",
        requestedAgeMa: diagnostics.requestedAgeMa ?? undefined,
        resolvedVertices: diagnostics.vertices });
      // Refresh prepared anchor markers from the continuous poses when App supplies them.
      return diagnostics;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Cao motion retarget failed";
      this.onCaoFoundationState?.({ status: "error", error: message });
      throw error;
    }
  }

  setPreparedCaoRevision(revision: PreparedCaoRevision | null): CaoFoundationDiagnostics | null {
    // null clears the foundation (out-of-domain / prepare failure). App keeps the
    // previous PreparedCaoRevision prop during in-domain age transitions so this
    // path is not used for ordinary scrubbing — that avoids a blank globe.
    if (revision === null) {
      // Only the Cao 2024 member: an age outside the Cao domain is outside the
      // Cao 2017 band as well, and dropping the map interval here would leave
      // this scene's own record of the published interval disagreeing with the
      // set.
      this.caoFoundationRenderer.clear("native");
      this.hasNativePublication = false;
      this.guideLabelTonesStaleSince = performance.now();
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
      this.markerGroup.visible = !this.caoFoundationWithheld;
      this.renderer.domElement.dataset.caoFoundationAnchorAgeMa = String(revision.requestedAgeMa);
      this.palaeoRequestedAgeMa = revision.requestedAgeMa;
      // The country line segment count is only knowable from a publication, so
      // a tone payload that arrived before the first native publish is decoded
      // and uploaded here rather than discarded.
      this.applyPalaeoOutlineTones();
      this.applyLayerVisibility();
      this.guideLabelTonesStaleSince = performance.now();
      if (this.caoFoundationWithheld) return this.applyCaoFoundationWithheldState();
      this.pendingCaoDiagnostics = diagnostics;
      const dataset = this.renderer.domElement.dataset;
      dataset.caoFoundationStatus = "updating";
      dataset.caoFoundationIdentity = diagnostics.identity ?? "";
      dataset.caoFoundationGeometryIdentity = diagnostics.staticGeometryIdentity ?? "";
      dataset.caoFoundationRequestedAgeMa = String(diagnostics.requestedAgeMa ?? "");
      dataset.caoFoundationBatches = String(diagnostics.batches);
      dataset.caoFoundationVertices = String(diagnostics.vertices);
      dataset.caoFoundationTriangles = String(diagnostics.triangles);
      dataset.caoFoundationDrawCount = String(diagnostics.drawCount);
      dataset.caoFoundationStaticBytes = String(diagnostics.retainedStaticBytes);
      dataset.caoFoundationStaticSourceBytes = String(diagnostics.retainedStaticSourceBytes);
      dataset.caoFoundationStaticGpuBytes = String(diagnostics.retainedStaticGpuBytes);
      this.publishCaoResidencyDataset();
      dataset.caoFoundationSourceBytes = String(diagnostics.activeSourceBytes);
      dataset.caoFoundationPublicationBytes = String(diagnostics.retainedPublicationBytes);
      dataset.caoFoundationPendingRetirementBytes = String(diagnostics.pendingRetirementBytes);
      dataset.caoFoundationPaletteEntries = String(diagnostics.paletteEntries);
      dataset.caoFoundationShellOffsetMetres = String(diagnostics.shellOffsetMetres);
      dataset.caoFoundationCountryLineBatches = String(diagnostics.countryLineBatches);
      dataset.caoFoundationCountryLineVertices = String(diagnostics.countryLineVertices);
      dataset.caoFoundationCountryLineSegments = String(diagnostics.countryLineSegments);
      dataset.caoFoundationCountryLineDrawnSegments = String(diagnostics.countryLineDrawnSegments);
      dataset.caoFoundationCountryLineDuplicates = String(diagnostics.countryLineDuplicateSegments);
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
      dataset.caoObservedMaterialCharts = String(correctionState.observedActiveCharts);
      dataset.caoClassifiedShallowMarineCharts =
        String(correctionState.classifiedShallowMarineActiveCharts);
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

  /**
   * Subscribes the scene to the engine's background interval walk, so an
   * interval it prepares becomes a hidden GPU member while the main thread is
   * idle.
   *
   * A first visit to an interval used to cost the geometry upload, the
   * publication and their commit on the one frame the scrub crossed into it,
   * while every later visit was a visibility switch and a retarget. The walk
   * already finishes long before the scrub reaches most of the timeline, so the
   * upload is taken here instead — one member per idle callback, nearest by age
   * first, and only where the renderer's residency ceilings leave room. By the
   * time the crossing arrives the member exists and it takes the retarget path.
   *
   * Passing null unsubscribes. The scene owns the subscription for its life.
   */
  setPalaeoIntervalPreloadSource(source: PalaeoIntervalPreloadSource | null): void {
    this.palaeoPreloadUnsubscribe?.();
    this.palaeoPreloadUnsubscribe = null;
    this.palaeoPreloadSource = source;
    this.palaeoPreloadQueue.clear();
    if (source === null) {
      this.cancelPalaeoPreload();
      return;
    }
    this.palaeoPreloadUnsubscribe = source.onPalaeoIntervalPrepared((notice) => {
      if (this.disposed || this.palaeoPreloadedIntervalIds.has(notice.intervalId)) return;
      this.palaeoPreloadQueue.set(notice.intervalId, notice);
      this.schedulePalaeoPreload();
    });
  }

  private schedulePalaeoPreload(): void {
    if (this.disposed || this.palaeoPreloadHandle !== null
        || this.palaeoPreloadQueue.size === 0) return;
    const run = () => {
      this.palaeoPreloadHandle = null;
      this.runPalaeoPreloadStep();
    };
    const requestIdle = (globalThis as {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (typeof requestIdle === "function") {
      this.palaeoPreloadIsIdleHandle = true;
      this.palaeoPreloadHandle = requestIdle(run, { timeout: PALAEO_PRELOAD_IDLE_TIMEOUT_MS });
      return;
    }
    this.palaeoPreloadIsIdleHandle = false;
    this.palaeoPreloadHandle = setTimeout(run, 0) as unknown as number;
  }

  private cancelPalaeoPreload(): void {
    if (this.palaeoPreloadHandle === null) return;
    const cancelIdle = (globalThis as {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback;
    if (this.palaeoPreloadIsIdleHandle && typeof cancelIdle === "function") {
      cancelIdle(this.palaeoPreloadHandle);
    } else if (!this.palaeoPreloadIsIdleHandle) {
      clearTimeout(this.palaeoPreloadHandle);
    }
    this.palaeoPreloadHandle = null;
  }

  /**
   * Uploads at most one hidden member, then re-arms while the queue holds more.
   * One per callback because the upload is the very cost being moved off the
   * crossing: taking several in one idle slot would put it back on a frame.
   */
  private runPalaeoPreloadStep(): void {
    const source = this.palaeoPreloadSource;
    if (this.disposed || source === null) return;
    const next = this.nextPalaeoPreload();
    if (next !== null) {
      this.palaeoPreloadQueue.delete(next.intervalId);
      // Marked before the attempt, not after it: an interval the engine or the
      // renderer declines must leave the queue, or the idle callback spins on
      // it and never reaches the intervals behind it.
      this.palaeoPreloadedIntervalIds.add(next.intervalId);
      if (next.intervalId !== this.publishedPalaeoIntervalId) {
        const prepared = source.prepareResidentPalaeoIntervalNow(next.intervalId);
        if (prepared !== null) {
          try {
            this.caoFoundationRenderer.preloadInterval(prepared, this.verticalExaggeration);
            this.publishCaoResidencyDataset();
          } catch {
            // A pre-upload is speculative: a refusal leaves the crossing that
            // needs this interval to upload it itself, exactly as it does now.
            // `preloadInterval` released the lease on its way out.
          }
        }
      }
    }
    this.schedulePalaeoPreload();
  }

  /**
   * Warms one hidden member the renderer has just preloaded, and publishes how
   * many have been warmed so a bench can tell a warm preload from a cold one.
   */
  private warmPalaeoMember(group: THREE.Group): void {
    const warmed = warmCaoMember(this.renderer, group, this.camera, this.scene, (error) => {
      // A warm is speculative: the member stays parented and hidden, and the
      // crossing that shows it pays the upload it would have paid anyway.
      this.renderer.domElement.dataset.caoPalaeoWarmFailure =
        error instanceof Error ? error.message : "palaeo member warm failed";
    });
    if (warmed) this.palaeoWarmedMembers += 1;
    this.renderer.domElement.dataset.caoPalaeoWarmedMembers = String(this.palaeoWarmedMembers);
  }

  /** The queued interval nearest by age to the one on screen. */
  private nextPalaeoPreload(): PalaeoPreparedIntervalNotice | null {
    const ageMa = this.palaeoRequestedAgeMa;
    let best: PalaeoPreparedIntervalNotice | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const notice of this.palaeoPreloadQueue.values()) {
      if (ageMa === null) return notice;
      const distance = ageMa > notice.fromAgeMa ? ageMa - notice.fromAgeMa
        : ageMa <= notice.toAgeMa ? notice.toAgeMa - ageMa : 0;
      if (distance < bestDistance) {
        best = notice;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * Makes one Cao 2017 map interval the drawn one, or clears the layer.
   *
   * A map interval is the streaming unit, but it is no longer replaced: the
   * surface set keeps a member per interval it has uploaded, so a crossing into
   * an interval already resident is a visibility switch and a retarget, and a
   * crossing into a new one uploads it once and keeps it. No static geometry
   * change is armed here — that arm guards the Cao 2024 stack, whose geometry
   * must never change. Scrubbing inside an interval never reaches here —
   * `retargetPalaeoMotion` re-poses the resident geometry — so a sample that
   * stays inside one map cannot cost a geometry rebuild.
   *
   * `publish` takes over the interval's lease and releases it, exactly as it
   * does for a native revision, so the interval store is free to evict the
   * decoded payload once its buffers are the publication's own.
   */
  setPreparedPalaeoInterval(
    interval: PreparedCaoPalaeoInterval | null,
    onPublished?: (diagnostics: CaoFoundationDiagnostics | null) => void,
  ): void {
    // Latest wins, and the superseded interval's lease is released here because
    // the publish that would have taken it over never runs.
    this.queuedPalaeoPublish.queue(interval, onPublished);
  }

  /**
   * Drains the queued publish at the top of a frame.
   *
   * The publish is ~26 ms of synchronous work — palette pack, pick state,
   * retarget, make-current — and it used to run inside the age-change dispatch,
   * where it was the input handler's own cost and showed up as a boundary
   * spike on the very task that should have returned in a millisecond. The
   * frame is where that work belongs: the interval is not on screen until a
   * frame draws it anyway, so taking it here costs the same frame and leaves
   * the handler free.
   */
  private drainQueuedPalaeoPublish(): void {
    this.queuedPalaeoPublish.drain((interval) => this.publishPreparedPalaeoIntervalNow(interval));
  }

  /**
   * Publishes one prepared map interval synchronously. Only the frame drain
   * calls it; everything else queues through `setPreparedPalaeoInterval`.
   */
  private publishPreparedPalaeoIntervalNow(
    interval: PreparedCaoPalaeoInterval | null,
  ): CaoFoundationDiagnostics | null {
    if (interval === null) {
      this.clearPalaeoPublication();
      this.updatePalaeoDomainVisibility();
      return null;
    }
    try {
      const diagnostics = this.caoFoundationRenderer.publish(
        interval, this.verticalExaggeration, "interval");
      this.palaeoPublicationFailureReason = null;
      this.publishedPalaeoIntervalId = interval.intervalId;
      this.palaeoIntervalSourceBytes = interval.activeSourceBytes;
      this.palaeoRequestedAgeMa = interval.requestedAgeMa;
      this.applyLayerVisibility();
      this.guideLabelTonesStaleSince = performance.now();
      // A map-interval crossing changes no composition, so the composition-change
      // path below never runs for it. Without this the two residency keys freeze
      // at the value the first composition change wrote while the surface set
      // goes on uploading and keeping members, and every reader of them —
      // benches, browser assertions — measures a number that stopped moving.
      this.publishCaoResidencyDataset();
      return diagnostics;
    } catch (error) {
      // A failed palaeo publication must never take the native surface with it.
      // The layer is optional, so the mode falls back to today's composition and
      // names the reason in the dataset rather than throwing out of a React
      // effect and blanking the globe. The guards themselves — an unarmed
      // geometry swap, a reservation miss — are proven red in
      // `caoFoundation.test.ts`, where the throw is the assertion.
      this.clearPalaeoPublication();
      this.updatePalaeoDomainVisibility();
      this.palaeoPublicationFailureReason =
        error instanceof Error ? error.message : "palaeo-coastline publication failed";
      this.renderer.domElement.dataset.caoPalaeoFallbackReason =
        this.palaeoPublicationFailureReason;
      return null;
    }
  }

  /**
   * Records a pose failure without taking the layer down.
   *
   * The published geometry and its lease are untouched: a frame that could not
   * be posed leaves the previous pose on screen, which is a frozen map for a
   * frame or two rather than no globe at all. The reason reaches the dataset so
   * a probe or a bench transaction sees it, because nothing else reports it —
   * the throw it replaces used to unmount the scene from inside a React effect.
   */
  notePalaeoMotionFallback(reason: string): void {
    this.palaeoPublicationFailureReason = reason;
    this.renderer.domElement.dataset.caoPalaeoFallbackReason = reason;
  }

  /**
   * Why the last prepared interval was refused, for the owner that still holds
   * it. A refused publication is the layer's one silent failure mode: nothing
   * is on screen, the lease is still held elsewhere, and only the holder can
   * decide to ask again.
   */
  palaeoFallbackReason(): string {
    return this.palaeoPublicationFailureReason ?? "";
  }

  /**
   * The map interval whose static geometry is published, or null. The
   * synchronous per-frame pose reads it so a sample taken after a boundary
   * crossing poses the geometry that is actually drawn, rather than the
   * incoming interval the renderer would refuse.
   */
  publishedPalaeoInterval(): string | null {
    return this.publishedPalaeoIntervalId;
  }

  /**
   * Re-poses the published interval at a new age inside the same map. The
   * charts and their order are the interval's own, so a frame for a different
   * interval is refused rather than retargeting one interval's poses onto
   * another's geometry.
   */
  retargetPalaeoMotion(frame: CaoPalaeoIntervalFrame): CaoFoundationDiagnostics | null {
    if (this.publishedPalaeoIntervalId === null
        || this.publishedPalaeoIntervalId !== frame.intervalId) return null;
    const pick = chartPickStateFromMotionFrame(frame);
    const diagnostics = this.caoFoundationRenderer.retargetMotion(
      frame.paletteValues, frame.entryCount, 0, pick.chartPoses, pick.chartActive,
      frame.requestedAgeMa, frame.materialCorrections, "interval");
    if (this.motionProbeRecording) {
      const sampled = this.motionProbePose(
        pick.chartPoses, pick.chartActive, this.motionProbePalaeoChart);
      if (sampled !== null) {
        this.motionProbePalaeoChart = sampled.chartIndex;
        this.motionProbePalaeo = { ageMa: frame.requestedAgeMa, pose: sampled.pose,
          fromAgeMa: frame.fromAgeMa, toAgeMa: frame.toAgeMa };
      }
    }
    this.palaeoRequestedAgeMa = frame.requestedAgeMa;
    this.applyLayerVisibility();
    this.guideLabelTonesStaleSince = performance.now();
    return diagnostics;
  }

  /**
   * The verified EHPT payload and the table the active interval reads.
   *
   * The bytes are fetched once per enablement and decoded here rather than by
   * the caller, because only this scene knows the country line batch's own
   * segment count — and a table compiled against a different outline package
   * would address the wrong segments with every index still in range.
   */
  setPalaeoOutlineTones(
    payload: Uint8Array | null,
    tableIndex: number,
    intervalId: string | null,
  ): void {
    this.palaeoTonePayload = payload;
    this.palaeoToneTableIndex = tableIndex;
    this.palaeoToneSourceIntervalId = intervalId;
    if (payload === null) {
      this.palaeoToneTables = null;
      this.palaeoToneDecodedFrom = null;
    }
    this.applyPalaeoOutlineTones();
  }

  /**
   * Decodes and uploads the active table, or falls back to the single dark ink.
   *
   * A table this scene cannot trust is not a reason to lose the outline: the
   * fallback is exactly today's overlay, and the reason is recorded. The
   * decoder's own rejections are proven red in `outlineTones.test.ts`.
   */
  private applyPalaeoOutlineTones(): void {
    try {
      this.uploadPalaeoOutlineTones();
    } catch (error) {
      this.palaeoToneTables = null;
      this.palaeoToneDecodedFrom = null;
      this.setCountryLineToneTable(null, null);
      this.renderer.domElement.dataset.caoPalaeoFallbackReason =
        error instanceof Error ? error.message : "palaeo outline tone tables could not be decoded";
    }
  }

  private uploadPalaeoOutlineTones(): void {
    const payload = this.palaeoTonePayload;
    const segmentCount = this.caoFoundationRenderer.diagnostics().countryLineSegments;
    if (payload === null || this.palaeoToneSourceIntervalId === null
        || this.palaeoToneTableIndex < 0 || segmentCount < 1) {
      this.setCountryLineToneTable(null, null);
      return;
    }
    if (this.palaeoToneDecodedFrom !== payload || this.palaeoToneTables === null
        || this.palaeoToneTables.segmentCount !== segmentCount) {
      this.palaeoToneTables = decodePalaeoOutlineToneTables(payload, segmentCount);
      this.palaeoToneDecodedFrom = payload;
    }
    if (this.palaeoToneTableIndex >= this.palaeoToneTables.tableCount) {
      throw new Error("palaeo outline tone table index is outside the published tables");
    }
    const counts = palaeoOutlineToneCounts(this.palaeoToneTables, this.palaeoToneTableIndex);
    if (counts.lightSegments + counts.darkSegments !== segmentCount) {
      throw new Error("palaeo outline tone counts disagree with the country line batch");
    }
    this.setCountryLineToneTable(
      buildPalaeoOutlineToneTexels(this.palaeoToneTables, this.palaeoToneTableIndex),
      this.palaeoToneSourceIntervalId);
  }

  /**
   * Drops the palaeo publication and everything that depends on it.
   *
   * Turning the mode off releases every outstanding interval lease in the
   * runtime, so a publication left standing here would be drawing geometry
   * whose payload the interval store is already free to evict.
   */
  private clearPalaeoPublication(): void {
    if (this.publishedPalaeoIntervalId === null) return;
    this.caoFoundationRenderer.clear("interval");
    this.publishedPalaeoIntervalId = null;
    this.palaeoIntervalSourceBytes = 0;
    this.guideLabelTonesStaleSince = performance.now();
    // Dropping the interval members is the largest single residency change the
    // renderer makes; the keys must report it rather than the last publish.
    this.publishCaoResidencyDataset();
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
      this.palaeoRequestedAgeMa = age;
      this.updatePalaeoDomainVisibility();
      if (age > CAO_SOURCE_AGE_DOMAIN_MA.oldest) {
        const diagnostics = this.caoFoundationRenderer.setDomainVisibility(false);
        this.renderer.domElement.dataset.caoFoundationStatus = "unsupported";
        this.renderer.domElement.dataset.caoFoundationRequestedAgeMa = String(age);
        this.renderer.domElement.dataset.caoFoundationGeographySupport = "unsupported-editorial-uniform";
        this.renderer.domElement.dataset.caoFoundationDrawCount = String(diagnostics.drawCount);
        this.renderer.domElement.dataset.caoObservedMaterialCharts = "0";
        this.renderer.domElement.dataset.caoClassifiedShallowMarineCharts = "0";
        this.renderer.domElement.dataset.caoQualifiedMaterialCharts = "0";
        this.renderer.domElement.dataset.caoUncertainMaterialCharts = "0";
        this.renderer.domElement.dataset.caoFormationUncertainMaterialCharts = "0";
        this.renderer.domElement.dataset.caoModelInferredPoseCharts = "0";
        this.renderer.domElement.dataset.caoOverriddenNativeCharts = "0";
        this.renderer.domElement.dataset.caoFoundationNativeBoundarySegments = "0";
        this.renderer.domElement.dataset.caoFoundationNativeBoundarySourceAgeMa = "";
        this.renderer.domElement.dataset.caoFoundationTopologyOwnershipRings = "0";
        this.renderer.domElement.dataset.caoFoundationTopologyOwnershipSourceAgeMa = "";
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
    this.applyLayerVisibility();
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
    // An explicit selection is the only thing that moves the residency budget;
    // the automatic downgrade below governs shading detail alone.
    const budget = residentIntervalBudget(value, reportedDeviceMemoryGb());
    this.caoFoundationRenderer.setResidentIntervalCeiling(budget.intervals, budget.bytes);
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
    this.followTarget = direction.clone();
    this.setFocusLockMarker(kind === "area" || kind === "place" ? direction : null);
    const toDistance = requestedDistance === undefined ? this.camera.position.length()
      : THREE.MathUtils.clamp(requestedDistance, 1.15, 5.8);
    // Continuous scrub retargets only the follow aim; keep an in-flight blend alive
    // without restarting distance so zoom is preserved while plates move.
    if (this.focusAnimation !== null) {
      this.focusAnimation.to = direction;
      if (requestedDistance !== undefined) this.focusAnimation.toDistance = toDistance;
      return;
    }
    this.focusAnimation = {
      from: this.camera.position.clone().normalize(),
      to: direction,
      fromDistance: this.camera.position.length(),
      toDistance,
      started: performance.now(),
    };
  }

  clearFocus(): void {
    this.focusAnimation = null;
    this.followTarget = null;
    this.setFocusLockMarker(null);
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
    this.palaeoPreloadUnsubscribe?.();
    this.palaeoPreloadUnsubscribe = null;
    this.palaeoPreloadSource = null;
    this.cancelPalaeoPreload();
    // A publish queued for a frame that will never run still owns a runtime
    // lease; nothing else can release it once the scene is gone.
    this.queuedPalaeoPublish.abandon();
    this.caoFoundationRenderer.setMemberWarmer(null);
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
    this.focusLockMarkerTexture.dispose();
    this.focusLockMarker = null;
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
    if (window.__earthHistorySurfaceProbe === this.surfaceProbe) {
      delete window.__earthHistorySurfaceProbe;
    }
    if (window.__earthHistoryPixelSurfaceProbe === this.pixelSurfaceProbe) {
      delete window.__earthHistoryPixelSurfaceProbe;
    }
    if (window.__earthHistoryMotionProbe === this.motionProbe) {
      delete window.__earthHistoryMotionProbe;
    }
  }

  private makeGlobeGeometry(): THREE.BufferGeometry {
    return createPoleSafeShellGeometry(1, this.effectiveQuality === "high" ? 24 : 16);
  }

  private makeCloudGeometry(): THREE.BufferGeometry {
    return createPoleSafeShellGeometry(1.014, this.effectiveQuality === "high" ? 18 : 12);
  }

  private applyEffectiveQuality(value: "high" | "low"): void {
    this.effectiveQuality = value;
    // Shading detail only. The resident-interval budget is `setQuality`'s, so
    // the automatic watchdog cannot turn every later crossing back into an
    // upload — which is the cost it is trying to avoid.
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

  private setFocusLockMarker(direction: THREE.Vector3 | null): void {
    if (direction === null) {
      if (this.focusLockMarker !== null) {
        this.markerGroup.remove(this.focusLockMarker);
        this.focusLockMarker.material.dispose();
        this.focusLockMarker = null;
      }
      this.renderer.domElement.dataset.focusMarker = "false";
      return;
    }
    if (this.focusLockMarker === null) {
      const marker = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.focusLockMarkerTexture, color: 0xffffff, transparent: true, opacity: 1,
        alphaTest: 0.02, depthTest: true, depthWrite: false,
      }));
      marker.userData.focusLockMarker = true;
      marker.userData.markerTargetPixels = 18;
      marker.renderOrder = 6;
      marker.frustumCulled = false;
      this.focusLockMarker = marker;
      this.markerGroup.add(marker);
      this.renderer.domElement.dataset.focusMarkerStyle = "steady-ring-dot";
      this.renderer.domElement.dataset.focusMarkerSizePx = "18";
    }
    this.focusLockMarker.position.copy(
      worldToGlobeLocalDirection(direction, this.globeGroup.quaternion),
    ).multiplyScalar(1.032);
    this.renderer.domElement.dataset.focusMarker = "true";
  }

  private rebuildMarkers(): void {
    clearGroup(this.markerGroup);
    // clearGroup disposes sprites; drop the stale focus-lock handle and recreate below.
    this.focusLockMarker = null;
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
        && (this.snapshot.requestedAgeMa ?? this.snapshot.ageMa) > CAO_SOURCE_AGE_DOMAIN_MA.oldest) {
      for (const id of this.snapshot.poiIds) {
        const coordinates = this.snapshot.poiCoordinates?.[id];
        if (coordinates !== undefined) add(id, lonLatToVector3(coordinates).normalize());
      }
    }
    this.setSelectedPoi(this.selectedPoiId);
    if (this.followTarget !== null && this.renderer.domElement.dataset.focusKind === "area") {
      this.setFocusLockMarker(this.followTarget);
    } else if (this.followTarget !== null && this.renderer.domElement.dataset.focusKind === "place") {
      this.setFocusLockMarker(this.followTarget);
    } else {
      this.renderer.domElement.dataset.focusMarker = "false";
    }
    this.renderer.domElement.dataset.caoFoundationAnchorMarkers = String(this.preparedAnchors.length);
  }

  private updatePreparedAnchorMarkers(
    markers: readonly CaoMotionAnchorMarker[],
    requestedAgeMa: number,
  ): void {
    const next = Object.freeze(markers.map((marker) => Object.freeze({
      id: marker.id,
      direction: new THREE.Vector3(...gplatesToRendererDirection(numberScalarOps, marker.direction)).normalize(),
      address: marker.address,
    })));
    const existing = new Map(this.markerGroup.children.flatMap((child) => {
      const id = child.userData.poiId;
      return typeof id === "string" ? [[id, child] as const] : [];
    }));
    const sameSet = existing.size === next.length && next.every((marker) => existing.has(marker.id));
    this.preparedAnchors = next;
    if (!sameSet) {
      this.rebuildMarkers();
    } else {
      for (const marker of next) {
        const sprite = existing.get(marker.id)!;
        sprite.position.copy(marker.direction).multiplyScalar(1.028);
        sprite.userData.materialAddress = marker.address;
      }
      if (this.followTarget !== null && (this.renderer.domElement.dataset.focusKind === "area"
          || this.renderer.domElement.dataset.focusKind === "place")) {
        this.setFocusLockMarker(this.followTarget);
      }
      this.renderer.domElement.dataset.caoFoundationAnchorMarkers = String(next.length);
    }
    this.renderer.domElement.dataset.caoFoundationAnchorAgeMa = String(requestedAgeMa);
  }

  /**
   * One layer record reaches both surface instances. The palaeo instance is
   * always in palaeo mode — its charts are the mode — while the native instance
   * enters it only while palaeo charts are actually drawn, which is what hides
   * `batch-land`. The layer flag is not that condition: at a fallback age the
   * layer is on and the palaeo instance draws nothing, so keying native land
   * off the flag would leave bare shelf where today's coastline belongs.
   * `resolveSurfaceVisibility` owns the effective answer and
   * `updatePalaeoDomainVisibility` applies it, last.
   */
  private applyLayerVisibility(): void {
    this.caoFoundationRenderer.setLayerVisibility({ borders: this.layers.borders,
      tectonics: this.layers.tectonics,
      palaeoCoastlines: this.caoFoundationRenderer.surfaceMode() === "palaeo" });
    // Turning the mode off releases every palaeo interval lease in the runtime,
    // so a publication left standing here would keep drawing geometry whose
    // payload the interval store is already free to evict.
    if (!this.layers.palaeoCoastlines) this.clearPalaeoPublication();
    this.updatePalaeoDomainVisibility();
  }

  /**
   * Resolves and applies the one surface composition, and reports the mode. The
   * notice follows the requested age immediately; the geometry follows one
   * frame later through the resolver's hysteresis, so a scrub resting on 402 Ma
   * cannot strobe.
   *
   * This is the single place a composition is applied. `published` is read
   * before the domain visibility is set, which is the same answer as after it:
   * the publication identity does not depend on whether the group is visible.
   */
  /**
   * Publishes what the surface set actually holds on the GPU — the Cao 2024
   * stack and every map interval kept resident, drawn or hidden — and which
   * classes D1 has released. Separate from `caoFoundationStaticBytes`, which is
   * the resource's fixed budget and does not move when buffers are handed back.
   */
  private publishCaoResidencyDataset(): void {
    writeCaoResidencyDataset(this.renderer.domElement.dataset, this.caoFoundationRenderer);
  }

  private updatePalaeoDomainVisibility(advanceHysteresis = false): void {
    const resolved = resolveSurfaceVisibility({
      layerEnabled: this.layers.palaeoCoastlines,
      band: caoPalaeoCoastlineDomainBand(this.palaeoRequestedAgeMa),
      published: this.caoFoundationRenderer.publishedIdentity("interval") !== null,
      hysteresis: this.surfaceVisibility.hysteresis,
      surfaceWithheld: this.caoFoundationWithheld,
      advanceHysteresis,
    });
    const previousComposition = this.surfaceVisibility.composition;
    this.surfaceVisibility = resolved;
    const palaeo = this.caoFoundationRenderer.setDomainVisibility(
      resolved.hysteresis.visible, "interval");
    // Native land, the pick and coverage set, and the guide-label ink all follow
    // the resolved composition, so a fallback age keeps exactly today's
    // composition instead of hiding land nothing has replaced. The map interval
    // can be on screen while the Cao 2024 unit stays in its own stack: that is
    // exactly the detached LGM band, where the lowstand shelf is drawn over
    // today's land rather than instead of it.
    //
    // Keyed on the composition and not on the native mode, because `native` and
    // `lgm` share that mode and not their class set: the lowstand overlay is
    // drawn in one and not the other. Applying it walks the published groups, so
    // a frame that resolves the same composition costs nothing.
    if (resolved.composition !== previousComposition) {
      // The slots decide what is drawn: land and continents carry the Cao 2017
      // `lm`/`sm` batches inside the band and the Cao 2024 fills outside it, the
      // mountain slot is filled only there, and the land-appearance corrections
      // are hidden wherever the map replaces land.
      this.caoFoundationRenderer.applySurfaceComposition(
        resolved.visibleClasses, resolved.nativeSurfaceMode);
      // D1. The composition decides which native classes it replaces outright;
      // their vertex and index buffers are handed back for as long as it lasts
      // and uploaded again on the way out. The CPU source stays resident, so
      // picking, coverage and the guide-label ink are unaffected.
      this.caoFoundationRenderer.setReleasableSurfaceClasses(
        resolveReleasableNativeSurfaceClasses(resolved.composition));
      // The release happens here and nowhere else, so the residency keys are
      // refreshed here too: a composition change moves them without a publish.
      this.publishCaoResidencyDataset();
    }
    const drawn = resolved.palaeoDrawn;
    const dataset = this.renderer.domElement.dataset;
    dataset.caoPalaeoCoastlineMode = resolved.mode;
    dataset.caoPalaeoFallbackReason = this.layers.palaeoCoastlines && resolved.band === "none"
      ? "age-outside-cao-2017-map-intervals" : "";
    dataset.caoPalaeoBand = this.layers.palaeoCoastlines ? resolved.band : "";
    dataset.caoPalaeoCharts = String(resolved.hysteresis.visible ? palaeo.chartRanges : 0);
    dataset.caoPalaeoTriangles = String(resolved.hysteresis.visible ? palaeo.triangles : 0);
    // The interval on screen, not the one the age asks for: a load in flight
    // leaves the previous map drawn, and the diagnostic must say which.
    const intervalId = drawn ? this.publishedPalaeoIntervalId : null;
    // Bytes behind what is on screen, for the same reason. The outline tone
    // tables are fetched once per enablement and stay resident across a scrub,
    // but they tone nothing at a fallback age — `applyCountryLineToneTable`
    // clears the table there — so a fallback reports zero exactly as its
    // interval id, its charts and its triangles do. `caoPalaeoAssetBytes` keeps
    // its historical meaning (drawn interval + the resident tone table, the
    // 2026-09-15 bench rows read it that way); the two halves are published
    // beside it so a comparison can tell a payload change from a tone-table
    // change — the 1:50m outlines grew the table 75,332 → 319,082 B, which
    // read as a per-interval "+59–196 %" in the P6 record until separated.
    const intervalBytes = drawn ? this.palaeoIntervalSourceBytes : 0;
    const toneBytes = drawn ? this.palaeoTonePayload?.byteLength ?? 0 : 0;
    const assetBytes = intervalBytes + toneBytes;
    if (intervalId !== this.reportedPalaeoIntervalId || assetBytes !== this.reportedPalaeoAssetBytes) {
      this.reportedPalaeoIntervalId = intervalId;
      this.reportedPalaeoAssetBytes = assetBytes;
      dataset.caoPalaeoIntervalId = intervalId ?? "";
      dataset.caoPalaeoIntervalBytes = String(intervalBytes);
      dataset.caoPalaeoToneBytes = String(toneBytes);
      dataset.caoPalaeoAssetBytes = String(assetBytes);
    }
    this.applyCountryLineToneTable(resolved.mode === "on");
  }

  /**
   * The outline tone table for one Cao 2017 map interval, or `null` to put the
   * whole overlay back to its single dark ink. Held rather than applied
   * directly: the tones belong to the palaeo mode, so a fallback age, a
   * withheld surface or a layer toggle clears them without the caller having to
   * notice.
   */
  setCountryLineToneTable(texels: Uint8Array | null, intervalId: string | null): void {
    this.palaeoOutlineToneTable = texels;
    this.palaeoOutlineToneIntervalId = texels === null ? null : intervalId;
    // Force the next apply, even onto the interval id that is already resident:
    // the bytes behind it may be different ones.
    this.appliedOutlineToneIntervalId = undefined;
    this.updatePalaeoDomainVisibility();
  }

  /**
   * Uploads a tone table at most once per interval change. The frame loop runs
   * through here, and the material's own byte comparison would otherwise walk
   * the whole table every frame for an answer that only changes at an interval
   * boundary.
   */
  private applyCountryLineToneTable(modeIsOn: boolean): void {
    const intervalId = modeIsOn ? this.palaeoOutlineToneIntervalId : null;
    // The counts are still read every frame: a publication built after the last
    // table change carries its own tone state.
    const counts = intervalId === this.appliedOutlineToneIntervalId
      ? this.caoFoundationRenderer.countryLineToneCounts()
      : this.caoFoundationRenderer.setCountryLineToneTable(
        intervalId === null ? null : this.palaeoOutlineToneTable);
    this.appliedOutlineToneIntervalId = intervalId;
    if (intervalId === this.reportedOutlineToneIntervalId
        && counts.darkSegments === this.reportedOutlineToneDarkSegments
        && counts.lightSegments === this.reportedOutlineToneLightSegments) return;
    this.reportedOutlineToneIntervalId = intervalId;
    this.reportedOutlineToneDarkSegments = counts.darkSegments;
    this.reportedOutlineToneLightSegments = counts.lightSegments;
    const dataset = this.renderer.domElement.dataset;
    dataset.caoOutlineToneIntervalId = intervalId ?? "";
    dataset.caoOutlineToneDarkSegments = String(counts.darkSegments);
    dataset.caoOutlineToneLightSegments = String(counts.lightSegments);
  }

  /**
   * Every surface on screen, in draw order, each carrying the mode it is drawn
   * in. The Cao 2017 member is in the set exactly while the resolved composition
   * draws it, which is also the only condition under which its charts are on
   * screen; a member with nothing published answers null and is absent.
   */
  private surfaceSetView(nativeView: CaoFoundationSurfaceView | null): CaoSurfaceSetView {
    const palaeoView = this.surfaceVisibility.palaeoDrawn
      ? this.caoFoundationRenderer.surfaceView("interval") : null;
    return [nativeView, palaeoView].filter((view): view is CaoFoundationSurfaceView =>
      view !== null);
  }

  /** Nearest hit across the whole set, ranked by one precedence table. */
  private intersectCompositeRay(
    rayOrigin: [number, number, number],
    rayDirection: [number, number, number],
  ): CaoFoundationSurfaceHit | null {
    return intersectCaoSurfaceSet(
      this.surfaceSetView(this.caoFoundationRenderer.surfaceView()), rayOrigin, rayDirection);
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
      this.overlayGroup.add(createGuideLabelGroup(label));
    }
    this.guideLabelTonesStaleSince = performance.now();
    this.overlayGroup.add(createLongitudeCrossingTickLines());
    // Flat polar sector ticks on the sphere — short meridian marks, not upright sprites.
    this.overlayGroup.add(createPolarSectorTickLines(1));
    this.overlayGroup.add(createPolarSectorTickLines(-1));
    this.renderer.domElement.dataset.referenceGuideVisible = "true";
  }

  /**
   * Repaints label tones from the surface currently on screen. A probe asks the
   * Cao foundation whether a land chart covers the sample direction: it does, so
   * that segment takes the dark ink; it does not — shelf water or open ocean —
   * so it takes the light ink. Rounds only start once the publication has been
   * quiet, and spend a bounded probe budget per frame.
   */
  private updateGuideLabelTones(now: number): void {
    if (!this.layers.guides) return;
    if (this.guideLabelToneScan === null) {
      if (this.guideLabelTonesStaleSince === null) return;
      if (now - this.guideLabelTonesStaleSince < GUIDE_LABEL_TONE_SETTLE_MS) return;
      this.guideLabelTonesStaleSince = null;
      this.guideLabelToneScan = createGuideLabelToneScan(
        this.overlayGroup.children.filter((child): child is GuideLabelGroup =>
          child instanceof THREE.Group && child.userData.guideLabelSegments !== undefined));
      this.guideLabelToneRoundProbes = 0;
      this.guideLabelToneRoundMs = 0;
    }
    const native = this.hasNativePublication && !this.caoFoundationWithheld;
    // Outside the Cao domain there is no coverage to read, so every probe takes
    // the fixed editorial answer.
    const editorialCovered = GUIDE_LABEL_EDITORIAL_TONE === "dark";
    const started = performance.now();
    // Resolved once for the whole budgeted round rather than per probe: the set
    // cannot change while this loop runs, and rebuilding it per probe would
    // allocate once per scanned label.
    const views = this.surfaceSetView(this.caoFoundationRenderer.surfaceView());
    const step = advanceGuideLabelToneScan(this.guideLabelToneScan,
      GUIDE_LABEL_TONE_PROBE_BUDGET_PER_FRAME, (direction) => native
        // Land only: shelf water and mapped shallow sea are dark backgrounds
        // like the open ocean, so they take the light ink too. The set is what
        // keeps a palaeo landmass dark once native land is hidden.
        ? caoSurfaceSetCoversDirection(views, [direction.x, direction.y, direction.z],
          { includeShelf: false })
        : editorialCovered);
    this.guideLabelToneRoundProbes += step.probes;
    this.guideLabelToneRoundMs += performance.now() - started;
    if (!step.done) return;
    this.guideLabelToneScan = null;
    const dataset = this.renderer.domElement.dataset;
    dataset.guideLabelToneMs = this.guideLabelToneRoundMs.toFixed(2);
    dataset.guideLabelToneProbes = String(this.guideLabelToneRoundProbes);
    dataset.guideLabelToneSource = native ? "cao-surface" : "editorial-fallback";
  }

  private updateGuideLabelVisibility(): void {
    if (!this.layers.guides) return;
    this.guideInverseGlobeQuaternion.copy(this.globeGroup.quaternion).invert();
    this.guideCameraDirection.copy(this.camera.position).normalize()
      .applyQuaternion(this.guideInverseGlobeQuaternion);
    for (const child of this.overlayGroup.children) {
      const direction = child.userData.guideLabelDirection as THREE.Vector3 | undefined;
      if (direction === undefined) continue;
      child.visible = isReferenceDirectionAboveHorizon(direction.dot(this.guideCameraDirection),
        this.camera.position.length(), 1.03, child.userData.guidePoleMarker === true ? 0 : 0.08);
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

  private reportFocusMarkerOffset(): void {
    const dataset = this.renderer.domElement.dataset;
    if (this.focusLockMarker === null || !this.markerGroup.visible || dataset.focusMarker !== "true") {
      delete dataset.focusMarkerOffsetXPx;
      delete dataset.focusMarkerOffsetYPx;
      return;
    }
    this.focusLockMarker.getWorldPosition(this.markerWorldPosition);
    this.focusMarkerProjectedPosition.copy(this.markerWorldPosition).project(this.camera);
    dataset.focusMarkerOffsetXPx = (
      this.focusMarkerProjectedPosition.x * this.renderer.domElement.clientWidth / 2
    ).toFixed(2);
    dataset.focusMarkerOffsetYPx = (
      -this.focusMarkerProjectedPosition.y * this.renderer.domElement.clientHeight / 2
    ).toFixed(2);
  }

  private updateInspectionLight(): void {
    setInspectionLightPosition(this.sunLight.position, this.camera.position);
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
    const caoHit = this.intersectCompositeRay(
      [localOrigin.x, localOrigin.y, localOrigin.z], [localRay.x, localRay.y, localRay.z]);
    const sphereHit = this.raycaster.intersectObject(this.globeMesh, false)[0];
    const localDirection = caoHit === null
      ? sphereHit === undefined ? null : this.globeGroup.worldToLocal(sphereHit.point.clone()).normalize()
      : new THREE.Vector3(...caoHit.position).normalize();
    if (localDirection === null) return;
    if (this.caoFoundationWithheld) return;

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
      && this.focusAnimation === null && this.followTarget === null && !this.cameraInteractionActive;
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
    } else if (this.followTarget !== null && !this.cameraInteractionActive) {
      // Keep locked material under the view while age scrubbing reconstructs pose.
      const distance = this.camera.position.length();
      const current = this.camera.position.clone().normalize();
      const blend = this.reducedMotion.matches ? 1 : Math.min(1, Math.max(0.08, frameTime * 0.01));
      const direction = current.lerp(this.followTarget, blend).normalize();
      this.camera.position.copy(direction.multiplyScalar(distance));
      this.camera.lookAt(0, 0, 0);
    }
    const nextDetail: SurfaceDetail = this.effectiveQuality === "low"
      ? "coarse" : this.camera.position.length() <= 1.5 ? "regional" : "coarse";
    if (nextDetail !== this.detail) {
      this.detail = nextDetail;
      this.rebuildOverlays();
    }
    this.reportCameraDistance();
    this.updatePoiMarkerScale();
    this.reportFocusMarkerOffset();
    this.updateInspectionLight();
    this.updatePalaeoDomainVisibility(true);
    this.updateGuideLabelTones(now);
    this.updateGuideLabelVisibility();
    if (this.impactGroup.visible && this.autoRotate && !this.reducedMotion.matches) {
      const elapsed = (now - this.animationStarted) / 1000;
      this.impactGroup.rotation.y = elapsed * 0.085;
      this.impactGroup.rotation.z = Math.sin(elapsed * 0.18) * 0.08;
    }
    if (this.cloudMesh.visible && !this.reducedMotion.matches) {
      this.cloudMesh.rotation.y += frameTime * 0.000005;
    }
    if (this.motionProbeRecording) this.recordMotionProbeFrame();
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
      // Keep the last published foundation visible. Clearing here permanently
      // blanks the globe when App still holds a revision (no automatic republish),
      // which showed up when scrubbing to today (0 Ma).
      this.renderer.domElement.dataset.caoFoundationStatus = "error";
      this.renderer.domElement.dataset.surfaceStatus = "error";
      this.onCaoFoundationState?.({ status: "error", error: message });
      console.error("Cao foundation render failed", error);
    }
    if (now - this.lastStatsAt >= 1000) this.publishStats(now);
    // After the render, not before it. The publish and the new member's first
    // drawn frame are two costs, and the dispatch used to split them across two
    // frames: publish on the input task, first draw on the next frame. Draining
    // at the top of a frame put both on one frame and cost a whole extra vsync
    // on the longest frame of a fast scrub (116.6 ms to 133.3 ms p50, measured
    // on `fastScrub117to58`). Draining here keeps the split and still takes the
    // work off the input handler.
    this.drainQueuedPalaeoPublish();
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  /**
   * Per-frame motion record for the scrub-synchrony measurement. Test-only:
   * nothing in the application arms it, and while it is disarmed the retarget
   * paths and the frame loop skip it on one boolean.
   */
  private readonly motionProbe: EarthHistoryMotionProbe = (command) => {
    if (command === "start") {
      this.motionProbeSamples.length = 0;
      this.motionProbeFrameIndex = 0;
      this.motionProbeNativeChart = -1;
      this.motionProbePalaeoChart = -1;
      this.motionProbeNative = null;
      this.motionProbePalaeo = null;
      this.motionProbeRecording = true;
      return this.motionProbeSamples;
    }
    if (command === "stop") this.motionProbeRecording = false;
    return this.motionProbeSamples;
  };

  /**
   * The pose of one sampled chart, keeping the index chosen on the first
   * recorded retarget: a sample is only comparable across frames while it
   * follows the same chart.
   */
  private motionProbePose(
    chartPoses: Float32Array,
    chartActive: Uint8Array,
    chartIndex: number,
  ): { chartIndex: number; pose: [number, number, number, number] } | null {
    let index = chartIndex;
    if (index < 0 || index * 8 + 4 > chartPoses.length) {
      index = chartActive.indexOf(1);
      if (index < 0) return null;
    }
    const base = index * 8;
    return { chartIndex: index,
      pose: [chartPoses[base]!, chartPoses[base + 1]!, chartPoses[base + 2]!, chartPoses[base + 3]!] };
  }

  private recordMotionProbeFrame(): void {
    if (this.motionProbeSamples.length >= MOTION_PROBE_SAMPLE_LIMIT) {
      this.motionProbeRecording = false;
      return;
    }
    const native = this.motionProbeNative;
    const palaeo = this.motionProbePalaeo;
    this.motionProbeSamples.push({
      frameIndex: this.motionProbeFrameIndex++,
      timeMs: performance.now(),
      nativeAgeMa: native?.ageMa ?? null,
      nativePose: native?.pose ?? null,
      palaeoAgeMa: palaeo?.ageMa ?? null,
      palaeoPose: palaeo?.pose ?? null,
      palaeoFromAgeMa: palaeo?.fromAgeMa ?? null,
      palaeoToAgeMa: palaeo?.toAgeMa ?? null,
      palaeoPublishedIntervalId: this.publishedPalaeoIntervalId,
    });
  }

  /**
   * Surface class over one piece of present-day ground at the drawn age. The
   * browser suite reads it to ask the compiled witness questions of the live
   * scene; nothing in the application calls it.
   */
  private readonly surfaceProbe: EarthHistorySurfaceProbe = (longitudeDegrees, latitudeDegrees) => {
    const longitude = longitudeDegrees * Math.PI / 180;
    const latitude = latitudeDegrees * Math.PI / 180;
    const radius = Math.cos(latitude);
    return caoSurfaceSetReferenceSurfaceClass(
      this.surfaceSetView(
        this.caoFoundationWithheld ? null : this.caoFoundationRenderer.surfaceView()),
      [radius * Math.cos(longitude), radius * Math.sin(longitude), Math.sin(latitude)]);
  };

  /**
   * Surface class and lighting under one canvas pixel, in CSS pixels measured
   * from the canvas's top-left corner. It walks the same composite ray the
   * pointer pick walks, so it answers with the class the viewer sees.
   */
  private readonly pixelSurfaceProbe: EarthHistoryPixelSurfaceProbe = (cssX, cssY) => {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.pointer.set((cssX / rect.width) * 2 - 1, -(cssY / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.globeGroup.updateWorldMatrix(true, false);
    const worldToGlobe = this.globeGroup.matrixWorld.clone().invert();
    const localOrigin = this.raycaster.ray.origin.clone().applyMatrix4(worldToGlobe);
    const localRay = this.raycaster.ray.direction.clone().transformDirection(worldToGlobe);
    const hit = this.intersectCompositeRay(
      [localOrigin.x, localOrigin.y, localOrigin.z], [localRay.x, localRay.y, localRay.z]);
    if (hit === null) return null;
    // The reconstructed radial direction is the shaded normal (`normalNode`
    // transforms exactly this vector), and the inspection light is a point on
    // the camera axis, so the cosine is the light vector at the hit itself
    // rather than at the globe centre.
    const localNormal = new THREE.Vector3(...hit.position).normalize();
    const worldNormal = localNormal.clone().transformDirection(this.globeGroup.matrixWorld);
    const worldPoint = this.globeGroup.localToWorld(
      new THREE.Vector3(...hit.position));
    const lightDirection = this.sunLight.position.clone().sub(worldPoint).normalize();
    return { surfaceClass: hit.surfaceClass,
      cosLight: Number(worldNormal.dot(lightDirection).toFixed(6)),
      direction: vector3ToLonLat(localNormal) };
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
      inspectionLightCameraDot: Number((this.sunLight.position.dot(this.camera.position)
        / (this.sunLight.position.length() * this.camera.position.length())).toFixed(6)),
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
    // Republished beside the diagnostics rather than installed once in the
    // constructor: a scene that replaces another must own the hook, and the
    // replaced scene's dispose() must not take the live one's with it.
    window.__earthHistorySurfaceProbe = this.surfaceProbe;
    window.__earthHistoryPixelSurfaceProbe = this.pixelSurfaceProbe;
    window.__earthHistoryMotionProbe = this.motionProbe;
    const dataset = this.renderer.domElement.dataset;
    dataset.detail = diagnostics.detail;
    dataset.quality = diagnostics.effectiveQuality;
    dataset.frameP50 = String(diagnostics.frameTimeMs.p50);
    dataset.frameP95 = String(diagnostics.frameTimeMs.p95);
    dataset.generationMs = "0";
    dataset.cameraLongitude = this.cameraCenter()[0].toFixed(4);
    dataset.cameraLatitude = this.cameraCenter()[1].toFixed(4);
    dataset.inspectionLightCameraDot = String(diagnostics.inspectionLightCameraDot);
    dataset.cameraSurfaceClearanceEarthRadii = (diagnostics.cameraDistance - 1).toFixed(6);
    this.onStats?.({ fps: p50 > 0 ? Number((1000 / p50).toFixed(0)) : 0,
      backend: this.backend === "webgpu" ? "WebGPU" : "WebGL 2",
      detail: this.detail, triangles: this.renderer.info.render?.triangles,
      status: dataset.surfaceStatus ?? "initializing" });
  }
}
