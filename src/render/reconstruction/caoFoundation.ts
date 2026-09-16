import * as THREE from "three";
import {
  DoubleSide,
  FrontSide,
  LineBasicNodeMaterial,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
} from "three/webgpu";
import type Node from "three/src/nodes/core/Node.js";
import type UniformNode from "three/src/nodes/core/UniformNode.js";
import {
  attribute,
  cameraPosition,
  cameraProjectionMatrix,
  float,
  int,
  ivec2,
  materialOpacity,
  mix,
  modelViewMatrix,
  modelWorldMatrix,
  screenDPR,
  screenSize,
  step,
  textureLoad,
  transformNormalToView,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import {
  EARTH_RADIUS_METRES,
  PREPARED_MOTION_PALETTE_STRIDE,
  type MaterialAddress,
  type InstantaneousOwnershipResult,
  type NativeBoundaryKind,
  type TopologyOwnershipRingV2,
  type PreparedCaoDisplayControlsCopy,
  type PreparedCaoRevision,
  type PreparedCaoStaticGeometryCopy,
} from "../../reconstruction";
import {
  gplatesToRendererDirection,
  numberScalarOps,
  rendererToGplatesDirection,
  rotateDirection,
  type QuaternionWxyz,
  type ScalarOps,
  type UnitDirection,
} from "../../reconstruction/arithmetic";
import {
  PALAEO_OUTLINE_TONE_TEXTURE_WIDTH,
  palaeoOutlineToneTextureRows,
} from "../../reconstruction/outlineTones";
import { evaluateForwardPatchVertex } from "./patchKernel";
import type { GpuRetirementOwner } from "./gpuRetirement";
import { AtomicPrototypePublisher, type OwnedPrototypeResources } from "./publication";
import { tslScalarOps } from "./terrainNodes";
import { intersectRayTriangle } from "./picking";
import type { Vec3Tuple } from "./bounds";

/** Display separation only; source physical height remains zero/unknown. */
export const CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES = 400;
export const CAO_FOUNDATION_PALAEO_SHALLOW_MARINE_SHELL_OFFSET_METRES = 700;
export const CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES = 800;
export const CAO_FOUNDATION_PALAEO_LAND_SHELL_OFFSET_METRES = 1_300;
export const CAO_FOUNDATION_PALAEO_MOUNTAIN_SHELL_OFFSET_METRES = 1_600;
export const CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES = 1_800;
export const CAO_FOUNDATION_BOUNDARY_LINE_OFFSET_METRES = 2_200;

/**
 * Longest triangle edge any surface batch may carry, in degrees of arc. The
 * palaeo ring compiler refines to this; the shipped Cao batches are already
 * under it.
 */
export const CAO_FOUNDATION_MAX_SURFACE_EDGE_DEGREES = 1;

/**
 * How far a flat triangle edge of `edgeDegrees` falls inside the sphere it
 * approximates, in metres. A chord subtending an angle sits `R(1 - cos(a/2))`
 * below the arc at its midpoint, so a shell drawn at offset `h` actually
 * occupies `[h - sag, h]`: the vertices reach `h` and the middle of every
 * triangle dips.
 */
export function caoFoundationChordSagMetres(edgeDegrees: number): number {
  if (!Number.isFinite(edgeDegrees) || edgeDegrees < 0 || edgeDegrees > 180) {
    throw new Error("Cao chord sag edge must be a finite angle within [0, 180] degrees");
  }
  return EARTH_RADIUS_METRES * (1 - Math.cos(edgeDegrees * Math.PI / 360));
}

/**
 * Widest chord in the shipped country-line geometry, measured over all 12 045
 * segments of `cao-v2.4/country-reference.ehgl`: 111.178 km, 1.00 degrees.
 * Chart poses are rigid rotations, so this is age-invariant.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_MAX_CHORD_DEGREES = 1;

/**
 * How far past the horizon a country-line vertex must be before the vertex
 * stage collapses it. It must exceed the widest chord so that a segment with
 * one visible endpoint is never collapsed at its other end.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES = 2;

/**
 * The relief control's ceiling (`App.tsx` clamps to 30, `patchGeometry`
 * rejects above it). The publication guard must assume the slider's maximum,
 * because it can move after a publication without republishing.
 */
export const CAO_FOUNDATION_MAX_VERTICAL_EXAGGERATION = 30;

/**
 * Tallest shell radius, in metres above the reference sphere, that a batch's
 * display controls can reach at the relief ceiling.
 */
export function caoFoundationMaxDisplayedShellMetres(
  displayHeightStartMetres: number,
  displayHeightEndMetres: number,
  shellOffsetMetres: number,
): number {
  return shellOffsetMetres + Math.max(0, displayHeightStartMetres, displayHeightEndMetres)
    * CAO_FOUNDATION_MAX_VERTICAL_EXAGGERATION;
}

/**
 * How a batch is drawn, and therefore what a viewer reads it as. Shelf batches
 * get the shallow-water appearance; native land and every material-correction
 * batch get the land appearance; a palaeogeography batch declares its own class
 * in the package rather than encoding it in a name. Callers that need "is this
 * land" must use this rather than re-testing the batch id, so the two never
 * drift apart.
 */
export type CaoFoundationBatchAppearance =
  | "land" | "shelf" | "palaeo-land" | "palaeo-shallow-marine" | "palaeo-mountain";

const CAO_FOUNDATION_BATCH_APPEARANCES: readonly CaoFoundationBatchAppearance[] =
  Object.freeze(["land", "shelf", "palaeo-land", "palaeo-shallow-marine", "palaeo-mountain"]);

/**
 * The single decision point for a batch's appearance. A declared class from the
 * package wins; an unknown declared value throws rather than falling back to
 * land, because silently drawing a shallow sea as a continent is exactly the
 * misreading this class exists to prevent.
 */
export function caoFoundationBatchAppearance(
  batchId: string,
  declared?: string,
): CaoFoundationBatchAppearance {
  if (declared !== undefined) {
    if (!CAO_FOUNDATION_BATCH_APPEARANCES.includes(declared as CaoFoundationBatchAppearance)) {
      throw new Error("unknown Cao foundation batch surface appearance");
    }
    return declared as CaoFoundationBatchAppearance;
  }
  return batchId === "batch-shelf" ? "shelf" : "land";
}

/**
 * Drawing class: the appearance, except that a material-correction batch is its
 * own class. Corrections are drawn on their own shell slot and own precedence
 * rank, so appearance and class must not be conflated.
 *
 * A correction batch declares one of two appearances and each gets its own
 * class. `land` is the historic one: cited or inferred ground, on the 800 m
 * correction shell above native land's own fill — and hidden with native land
 * whenever the Cao 2017 map replaces it, because it is drawn in native land's
 * colour and would otherwise be a second land tone over a mapped sea. `shelf`
 * is the restored pre-collision margin: crust of unmapped depth that must not
 * read as cited land, so it keeps the shelf's colour and sits below
 * palaeo-shallow-marine, at crust level, and stays drawn in both modes. It is
 * a separate class from the native shelf because the native shelf writes depth
 * on the 400 m shell and a coplanar second surface there would interleave with
 * it.
 */
export type CaoFoundationSurfaceClass =
  CaoFoundationBatchAppearance | "corrections" | "correction-shelf";

export function caoFoundationSurfaceClass(
  appearance: CaoFoundationBatchAppearance,
  nativePrecedence: boolean,
): CaoFoundationSurfaceClass {
  if (!nativePrecedence) return appearance;
  return appearance === "shelf" ? "correction-shelf" : "corrections";
}

export interface CaoFoundationSurfaceShell {
  readonly surfaceClass: CaoFoundationSurfaceClass;
  readonly shellOffsetMetres: number;
  /** Draw slot; a larger value draws later and therefore wins where they overlap. */
  readonly renderOrder: number;
  /** Whether the class writes depth, which is what forces shell separation below it. */
  readonly writesDepth: boolean;
  readonly visibleInNativeMode: boolean;
  readonly visibleInPalaeoMode: boolean;
}

/**
 * Every surface class, in ascending precedence — which is also ascending draw
 * order and, for the classes that must not interpenetrate, ascending shell.
 *
 * Shell arithmetic at the mandated 1 degree maximum edge, where the sag is
 * `6 371 000 * (1 - cos(0.5 degrees)) = 242.59 m`. A shell at `h` occupies
 * `[h - sag, h]`, so an upper class is guaranteed in front of a *depth-writing*
 * lower class only while `h(upper) - 242.59 > h(lower)`:
 *
 *   shelf 400 -> correction-shelf 700:        700 - 242.59 = 457.41 > 400
 *   shelf 400 -> palaeo-shallow-marine 700:   700 - 242.59 = 457.41 > 400
 *   shelf 400 -> corrections 800:             800 - 242.59 = 557.41 > 400
 *   shelf 400 -> palaeo-land 1 300:         1 300 - 242.59 = 1 057.41 > 400
 *   land 800  -> palaeo-land 1 300:         1 300 - 242.59 = 1 057.41 > 800
 *   palaeo-land 1 300 -> palaeo-mountain 1 600: 1 600 - 242.59 = 1 357.41 > 1 300
 *
 * and every shell stays below the 1 800 m country-line shell, which the
 * publication guard also enforces against the display-height ceiling.
 *
 * Only a *depth-writing* lower class forces that clearance. Where the lower
 * class does not write depth, the class above it simply paints over it in draw
 * order and no depth test can interleave the two — which is how corrections and
 * native land have always shared the 800 m shell.
 *
 * That exemption is what makes the plan's candidate shells work. Shallow 700
 * between shelf 400 and corrections 800 leaves only 400 m for two sag
 * clearances, and 400 + 2 * 242.59 = 885.18 > 800: the pair could not be
 * separated geometrically at all. They are never drawn together — corrections
 * are hidden wherever palaeo-shallow-marine is drawn — and the one
 * depth-writing class below the shallow shell, the shelf, is still cleared by
 * 457.41 m.
 * Raising the correction shell or lowering the shelf shell instead would move a
 * native constant that the present-day globe, its picking bounds and its
 * goldens are already built on.
 *
 * `correction-shelf` — restored pre-collision margin crust — takes the same
 * exemption twice, and for the same reason. It shares the 700 m shell with
 * palaeo-shallow-marine and writes no depth, so the shallow-marine class paints
 * over it in draw order in the palaeo mode, and it is painted over by
 * corrections at 800 in the native mode.
 * It is not placed on the native shelf's 400 m shell, where it would be a
 * second depth-writing surface coplanar with the shelf and interleave with it.
 */
export const CAO_FOUNDATION_SURFACE_SHELLS: readonly CaoFoundationSurfaceShell[] = Object.freeze([
  Object.freeze({ surfaceClass: "shelf" as const,
    shellOffsetMetres: CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES,
    renderOrder: 1, writesDepth: true, visibleInNativeMode: true, visibleInPalaeoMode: true }),
  // Restored pre-collision margin crust. It shares the 700 m shell with
  // palaeo-shallow-marine and writes no depth, so the two are separated by draw
  // order alone and the shallow-marine class paints over it; the one
  // depth-writing class below, the native shelf at 400 m, is cleared by 457.41 m.
  Object.freeze({ surfaceClass: "correction-shelf" as const,
    shellOffsetMetres: CAO_FOUNDATION_PALAEO_SHALLOW_MARINE_SHELL_OFFSET_METRES,
    renderOrder: 1.1, writesDepth: false, visibleInNativeMode: true, visibleInPalaeoMode: true }),
  Object.freeze({ surfaceClass: "palaeo-shallow-marine" as const,
    shellOffsetMetres: CAO_FOUNDATION_PALAEO_SHALLOW_MARINE_SHELL_OFFSET_METRES,
    renderOrder: 1.2, writesDepth: false, visibleInNativeMode: false, visibleInPalaeoMode: true }),
  // Land-appearance corrections — lake-void infill, regional material
  // corrections, observed-land patches — carry native land's own fill colour,
  // so leaving them drawn while the Cao 2017 map replaces native land put a
  // second land tone over the mapped shallow seas. They are hidden with
  // `land` in the palaeo mode for exactly that reason; the `lgm` band keeps
  // them, because it runs the native mode and there they are today's observed
  // ground, which is what that band claims.
  Object.freeze({ surfaceClass: "corrections" as const,
    shellOffsetMetres: CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
    renderOrder: 1.5, writesDepth: false, visibleInNativeMode: true, visibleInPalaeoMode: false }),
  Object.freeze({ surfaceClass: "palaeo-land" as const,
    shellOffsetMetres: CAO_FOUNDATION_PALAEO_LAND_SHELL_OFFSET_METRES,
    renderOrder: 1.7, writesDepth: true, visibleInNativeMode: false, visibleInPalaeoMode: true }),
  Object.freeze({ surfaceClass: "palaeo-mountain" as const,
    shellOffsetMetres: CAO_FOUNDATION_PALAEO_MOUNTAIN_SHELL_OFFSET_METRES,
    renderOrder: 1.8, writesDepth: true, visibleInNativeMode: false, visibleInPalaeoMode: true }),
  // Native land keeps the top rank it has always had, and is hidden outright
  // while the palaeo-coastline mode is on, together with every land-appearance
  // correction above; nothing else would keep a Cao 2024 coast fill over the
  // Cao 2017 map polygons that replace it.
  Object.freeze({ surfaceClass: "land" as const,
    shellOffsetMetres: CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
    renderOrder: 2, writesDepth: true, visibleInNativeMode: true, visibleInPalaeoMode: false }),
]);

/** Ascending precedence for drawing and for picking. */
export const CAO_FOUNDATION_SURFACE_PRECEDENCE: readonly CaoFoundationSurfaceClass[] =
  Object.freeze(CAO_FOUNDATION_SURFACE_SHELLS.map((shell) => shell.surfaceClass));

/**
 * Classes a "is this land, rather than water of any depth" question accepts.
 * `correction-shelf` is deliberately absent: a restored pre-collision margin is
 * crust of unmapped depth and answering "land" for it would be the exact
 * over-claim the class exists to prevent.
 */
export const CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES: readonly CaoFoundationSurfaceClass[] =
  Object.freeze(["land", "corrections", "palaeo-land", "palaeo-mountain"]);

export function caoFoundationSurfaceShell(
  surfaceClass: CaoFoundationSurfaceClass,
): CaoFoundationSurfaceShell {
  const shell = CAO_FOUNDATION_SURFACE_SHELLS.find((candidate) =>
    candidate.surfaceClass === surfaceClass);
  if (!shell) throw new Error("unknown Cao foundation surface class");
  return shell;
}

export function caoFoundationShellOffsetMetres(
  batchId: string,
  declared?: string,
  nativePrecedence = false,
): number {
  const appearance = caoFoundationBatchAppearance(batchId, declared);
  // A land-appearance correction shares the land shell, so the batch id alone
  // answers for it. A shelf-appearance correction does not: it is lifted off the
  // native shelf shell onto its own class, so the precedence flag has to be
  // passed or the strip would be placed 300 m too low, inside the shelf.
  return caoFoundationSurfaceShell(
    caoFoundationSurfaceClass(appearance, nativePrecedence)).shellOffsetMetres;
}

/**
 * Default base colours per appearance. Batch colours are package data; these are
 * the values the palaeo compiler emits and the ones the unit test pins.
 *
 * `palaeo-land` is the muted olive of a Cao 2017 landmass polygon.
 * `palaeo-shallow-marine` is a saturated teal held dark enough that the light
 * outline/label ink `#d0d4d5` keeps a 5.4:1 luminance contrast over it, while
 * reading as a distinctly greener, brighter body of water than the 0.58-dimmed
 * shelf blue it sits on.
 *
 * `palaeo-mountain` is a dark reddish brown *on screen*, which is why the value
 * here is a deep saturated red-brown rather than the tone itself. These triples
 * are linear albedo: the scene multiplies them by an inspection light of
 * intensity 3.2 plus a hemisphere fill and then runs ACES at exposure 1.02,
 * whose shoulder desaturates everything it lifts toward white. `#c8a97e` was
 * already light *before* that and came out at 223,213,192 against palaeo-land's
 * 213,212,184; `#fd7328` cleared that but landed at 235,198,139, a light tan at
 * hue 33-37 degrees rather than the brown the class is meant to read as.
 *
 * `#71220e` is pre-compensated for the same wash against a darker, redder aim.
 * It was solved through the 0.1.12 band model - per-band light factors 1.0355 /
 * 0.7970 / 0.5260 fitted to that colour's three measured tones, then ACES at
 * exposure 1.02 and the sRGB transfer - which predicted 196,114,68 / 177,95,55
 * / 143,69,37. The tone census then measured it on the production build:
 * 201,126,79 in full light, 184,117,72 at mid lighting and 142,78,53 near the
 * terminator - hue 23.1 / 24.1 / 16.9 degrees, 60.5 / 53.9 / 52.2 of
 * luma-matched separation from palaeo-land against a 30 floor, and 4.79 / 4.13
 * / 2.39:1 against the dark outline/label ink [0.12, 0.15, 0.18] the tone table
 * puts over mountain ground. The model was right to within 12/255 everywhere
 * except mid green, which it under-predicted by 22.
 *
 * The terminator band is the cost of the darker aim: it keeps a readable
 * 91/255 luma but only 2.39:1 against that dark ink, where the light tan held
 * 5.75:1. `tests/browser/explorer.spec.ts` owns the rendered contract and is
 * the only place it can be measured; changing this constant without re-running
 * the tone census is not supported.
 */
/**
 * The opaque globe sphere every surface class is drawn over. It is the bottom
 * of the stacking contract: nothing in `CAO_FOUNDATION_SURFACE_SHELLS` may draw
 * before it, or the sphere would paint over the class above it.
 */
export const CAO_FOUNDATION_GLOBE_SPHERE_RENDER_ORDER = 0;

export const CAO_FOUNDATION_DEFAULT_BASE_COLORS:
Readonly<Record<CaoFoundationBatchAppearance, readonly [number, number, number]>> = Object.freeze({
  land: Object.freeze([0.45, 0.55, 0.3] as const),
  shelf: Object.freeze([0.0431, 0.2863, 0.3922] as const),
  "palaeo-land": Object.freeze([0x9a / 255, 0xa8 / 255, 0x6b / 255] as const),
  "palaeo-shallow-marine": Object.freeze([0x14 / 255, 0x60 / 255, 0x6b / 255] as const),
  "palaeo-mountain": Object.freeze([0x71 / 255, 0x22 / 255, 0x0e / 255] as const),
});

/**
 * The 0.58 dim exists because the shelf's own blue lit up brighter than the
 * MeshPhysical globe ocean under it. A palaeo shallow-marine polygon is a
 * mapped environment, not the same "depth unmapped" wash, and carries its own
 * measured colour, so it is drawn undimmed.
 */
export function caoFoundationAppearanceDim(appearance: CaoFoundationBatchAppearance): number {
  return appearance === "shelf" ? 0.58 : 1;
}

/** Water classes are single-sided; land-like classes keep both faces. */
export function caoFoundationAppearanceFrontSideOnly(
  appearance: CaoFoundationBatchAppearance,
): boolean {
  return appearance === "shelf" || appearance === "palaeo-shallow-marine";
}

export function caoFoundationAppearanceRoughness(
  appearance: CaoFoundationBatchAppearance,
): number {
  return caoFoundationAppearanceFrontSideOnly(appearance) ? 0.94 : 0.82;
}
export const CAO_FOUNDATION_PALETTE_TEXEL_WIDTH = 256;

type PreparedCaoLineGeometryCopy = ReturnType<
  PreparedCaoRevision["lineBatches"][number]["createStaticGeometryCopy"]
>;

export interface CaoFoundationLimits {
  readonly maxBatches: number;
  readonly maxVertices: number;
  readonly maxTriangles: number;
  readonly maxRetainedSourceBytes: number;
  readonly maxTextureSize: number;
  readonly maxPublicationBytes: number;
  readonly maxSpatialIndexBytes: number;
}

export interface PackedCaoPalette {
  readonly data: Float32Array;
  readonly width: number;
  readonly height: number;
  readonly entryCount: number;
}

export interface CaoFoundationBatchResource {
  readonly batchId: string;
  readonly geometry: THREE.BufferGeometry;
  readonly source: PreparedCaoStaticGeometryCopy;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly nativePrecedence: boolean;
  /** Resolved once through `caoFoundationBatchAppearance`, never re-derived. */
  readonly appearance: CaoFoundationBatchAppearance;
  readonly surfaceClass: CaoFoundationSurfaceClass;
  readonly shellOffsetMetres: number;
  /** chartIndex, firstTriangle, triangleCount, preparedEntryIndex. */
  readonly chartRanges: Uint32Array;
  /** Reference-space shell AABB, six floats per chart range. */
  readonly chartBounds: Float32Array;
}

export interface CaoFoundationLineBatchResource {
  readonly batchId: string;
  readonly geometry: THREE.BufferGeometry;
  readonly source: PreparedCaoLineGeometryCopy;
  readonly vertexCount: number;
  readonly segmentCount: number;
}

export interface CaoFoundationGeometryResource {
  readonly key: string;
  readonly batches: readonly CaoFoundationBatchResource[];
  readonly lineBatches: readonly CaoFoundationLineBatchResource[];
  readonly chartIdentities: readonly Readonly<{
    chartId: string;
    chartRevision: string;
    materialId: string;
    fragmentOrCohortId: string;
  }>[];
  /** Retained JS arrays plus tracked vertex/index GPU buffers; backend-private bytes are excluded. */
  readonly byteLength: number;
  readonly retainedCpuBytes: number;
  readonly trackedGpuBufferBytes: number;
  dispose(): void;
}

export interface CaoFoundationMaterialGraph {
  readonly material: MeshStandardNodeMaterial;
  readonly displayFraction: UniformNode<"float", number>;
  readonly verticalExaggeration: UniformNode<"float", number>;
}

export interface CaoFoundationLineMaterialGraph {
  readonly material: MeshBasicNodeMaterial;
  readonly displayFraction: UniformNode<"float", number>;
  /** Device-pixel corner offset the vertex node must add; exposed so tests pin the wiring. */
  readonly quadOffsetPixels: readonly [Node<"float">, Node<"float">];
  /** The two offset components as one vector, before the collapse factor. */
  readonly quadOffsetVector: Node<"vec2">;
  /** That offset after the collapse factor, which is what the vertex node adds. */
  readonly collapsedOffsetPixels: Node<"vec2">;
  /** Exactly the terms handed to the coverage formula, so a test can pin each one. */
  readonly coverageInputs: Readonly<{
    distancePixels: Node<"float">; halfWidthPixels: Node<"float">; featherPixels: Node<"float">;
  }>;
  /** Half the visual core width in device pixels, from the renderer's pixel ratio. */
  readonly halfWidthPixels: Node<"float">;
  /** The varying carrying the signed perpendicular distance from the centre line. */
  readonly perpendicularPixels: Node<"float">;
  /** Fragment-stage analytic coverage; the reason the stroke needs no extra copies. */
  readonly coverage: Node<"float">;
  /** Vertex-stage far-side and inactive-chart collapse factor; exposed so tests pin the wiring. */
  readonly vertexVisible: Node<"float">;
  /** Fragment-stage horizon term; the only thing hiding the far hemisphere. */
  readonly horizonVisibility: Node<"float">;
  /**
   * The varying the fragment horizon term reads the world direction through.
   * Exposed so a test can pin that it is a varying: reading the pose direction
   * directly in the fragment stage re-emits the whole prepared pose graph —
   * three palette texture loads plus a quaternion slerp and rotate — into the
   * fragment shader, because three caches node results per shader stage.
   */
  readonly fragmentDirection: Node<"vec3">;
  /**
   * The cosine/sine margin constants each horizon term was built with, exposed
   * so a test can pin which stage carries the cull margin. The vertex stage must
   * carry it and the fragment stage must not: a vertex stage without the margin
   * collapses one end of a segment that straddles the terminator and draws a
   * spoke from the globe centre, and a fragment stage with it pushes the
   * terminator a whole margin past the true horizon.
   */
  readonly horizonMargins: Readonly<{
    vertexCullCos: Node<"float">; vertexCullSin: Node<"float">;
    fragmentCos: Node<"float">; fragmentSin: Node<"float">;
  }>;
  /** The R8 tone table this material samples; zero-filled means every segment dark. */
  readonly toneTexture: THREE.DataTexture;
  /**
   * The vertex-stage tone lookup, by segment index. It must stay in the vertex
   * stage: a texture load in the fragment stage would run once per outline
   * fragment for a value that is constant across the whole quad.
   */
  readonly segmentToneSample: Node<"float">;
  /** The flat varying that carries the sample to the fragment stage. */
  readonly toneMix: Node<"float">;
  readonly darkInk: Node<"vec3">;
  readonly lightInk: Node<"vec3">;
  /**
   * Replaces the tone table, uploading only when the bytes actually change.
   * `null` restores the all-dark table, which is bit-identical to the outline
   * before the palaeo mode existed: `mix(dark, light, 0)` is `dark` exactly.
   */
  setCountryLineToneTable(texels: Uint8Array | null): CaoFoundationOutlineToneCounts;
  /** Tones the currently loaded table resolves to. */
  readonly toneCounts: () => CaoFoundationOutlineToneCounts;
}

export interface CaoFoundationDiagnostics {
  readonly identity: string | null;
  readonly staticGeometryIdentity: string | null;
  readonly materialCorrectionIdentity: string | null;
  readonly materialCorrections: Readonly<{
    observedActiveCharts: number;
    classifiedShallowMarineActiveCharts: number;
    qualifiedActiveCharts: number;
    uncertainActiveCharts: number;
    formationUncertainActiveCharts: number;
    modelInferredPoseActiveCharts: number;
    overriddenNativeCharts: number;
    activeSourceIds: readonly string[];
    correctionIds: readonly string[];
  }>;
  readonly requestedAgeMa: number | null;
  readonly batches: number;
  readonly vertices: number;
  readonly triangles: number;
  /** Material charts carried by the resident static geometry, across all batches. */
  readonly chartRanges: number;
  readonly drawCount: number;
  /** Whether native land is suppressed in favour of palaeo-coastline charts. */
  readonly palaeoCoastlineMode: boolean;
  readonly countryLineBatches: number;
  readonly countryLineVertices: number;
  readonly countryLineSegments: number;
  /** Outline segments the resident tone table draws in each ink; dark is the default. */
  readonly countryLineToneDarkSegments: number;
  readonly countryLineToneLightSegments: number;
  readonly nativeBoundarySegments: number;
  readonly nativeBoundarySourceAgeMa: number | null;
  readonly topologyOwnershipRings: number;
  readonly topologyOwnershipSourceAgeMa: number | null;
  readonly retainedStaticBytes: number;
  readonly activeSourceBytes: number;
  readonly retainedPublicationBytes: number;
  readonly pendingRetirementBytes: number;
  readonly paletteEntries: number;
  readonly shellOffsetMetres: number;
}

/** The per-chart pose/activation pair a coverage or pick query reads. */
export interface CaoFoundationPickState {
  readonly chartPoses: Float32Array;
  readonly chartActive: Uint8Array;
}

export interface CaoFoundationSurfaceHit {
  readonly batchId: string;
  readonly surfaceClass: CaoFoundationSurfaceClass;
  readonly chartIndex: number;
  readonly triangleIndex: number;
  readonly distance: number;
  readonly position: Vec3Tuple;
  readonly materialAddress: MaterialAddress;
}

function safeAdd(total: number, next: number, label: string): number {
  if (!Number.isSafeInteger(next) || next < 0 || total > Number.MAX_SAFE_INTEGER - next) {
    throw new Error(`${label} byte/count total is invalid`);
  }
  return total + next;
}

function allFinite(values: ArrayLike<number>): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index])) return false;
  }
  return true;
}

function staticGeometryByteLength(batch: PreparedCaoStaticGeometryCopy): number {
  return [batch.referenceDirections, batch.indices, batch.seamIds,
    batch.preparedEntryIndices, batch.materialChartIndices]
    .reduce((sum, value) => safeAdd(sum, value.byteLength, "Cao batch"), 0);
}

function staticLineGeometryByteLength(batch: PreparedCaoLineGeometryCopy): number {
  return [batch.referenceDirections, batch.lineIndices,
    batch.preparedEntryIndices, batch.materialChartIndices]
    .reduce((sum, value) => safeAdd(sum, value.byteLength, "Cao line batch"), 0);
}

function validateStaticLineGeometryCopy(
  batch: PreparedCaoLineGeometryCopy,
  vertexCount: number,
  segmentCount: number,
  paletteEntries: number,
  chartCount: number,
): void {
  if (batch.referenceDirections.length !== vertexCount * 3
      || batch.lineIndices.length !== segmentCount * 2
      || batch.preparedEntryIndices.length !== vertexCount
      || batch.materialChartIndices.length !== vertexCount
      || !allFinite(batch.referenceDirections)) {
    throw new Error("Cao country line batch attribute length mismatch");
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    if (Math.abs(Math.hypot(batch.referenceDirections[offset]!, batch.referenceDirections[offset + 1]!,
      batch.referenceDirections[offset + 2]!) - 1) > 2e-6
        || batch.preparedEntryIndices[vertex]! >= paletteEntries
        || batch.materialChartIndices[vertex]! >= chartCount) {
      throw new Error("Cao country line vertex is invalid");
    }
  }
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const left = batch.lineIndices[segment * 2]!;
    const right = batch.lineIndices[segment * 2 + 1]!;
    if (left >= vertexCount || right >= vertexCount
        || batch.materialChartIndices[left] !== batch.materialChartIndices[right]
        || batch.preparedEntryIndices[left] !== batch.preparedEntryIndices[right]) {
      throw new Error("Cao country segment crosses material-chart ownership");
    }
  }
}

function validateStaticGeometryCopy(
  batch: PreparedCaoStaticGeometryCopy,
  vertexCount: number,
  triangleCount: number,
  paletteEntries: number,
  chartCount: number,
): void {
  if (batch.referenceDirections.length !== vertexCount * 3
      || batch.indices.length !== triangleCount * 3
      || batch.seamIds.length !== vertexCount
      || batch.preparedEntryIndices.length !== vertexCount
      || batch.materialChartIndices.length !== vertexCount) {
    throw new Error("Cao foundation batch attribute length mismatch");
  }
  if (!allFinite(batch.referenceDirections)) {
    throw new Error("Cao foundation batch contains a non-finite value");
  }
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * 3;
    if (Math.abs(Math.hypot(batch.referenceDirections[offset]!, batch.referenceDirections[offset + 1]!,
      batch.referenceDirections[offset + 2]!) - 1) > 2e-6) {
      throw new Error("Cao foundation reference direction must be unit length");
    }
    if (batch.preparedEntryIndices[vertex]! >= paletteEntries
        || batch.materialChartIndices[vertex]! >= chartCount) {
      throw new Error("Cao foundation vertex palette or chart index is invalid");
    }
  }
  for (let index = 0; index < batch.indices.length; index += 1) {
    if (batch.indices[index]! >= vertexCount) throw new Error("Cao foundation triangle index is invalid");
  }
  for (let triangle = 0; triangle < batch.indices.length; triangle += 3) {
    const a = batch.indices[triangle]!;
    const chart = batch.materialChartIndices[a]!;
    if (batch.materialChartIndices[batch.indices[triangle + 1]!] !== chart
        || batch.materialChartIndices[batch.indices[triangle + 2]!] !== chart) {
      throw new Error("Cao foundation triangle crosses material-chart ownership");
    }
  }
}

function createChartSpatialIndex(
  source: PreparedCaoStaticGeometryCopy,
  ranges: PreparedCaoRevision["batches"][number]["chartTriangleRanges"],
  triangleCount: number,
  chartCount: number,
  shellOffsetMetres: number,
): { chartRanges: Uint32Array; chartBounds: Float32Array } {
  const chartRanges = new Uint32Array(ranges.length * 4);
  const chartBounds = new Float32Array(ranges.length * 6);
  const shellRadius = 1 + shellOffsetMetres / EARTH_RADIUS_METRES;
  let coveredTriangles = 0;
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex]!;
    if (!Number.isSafeInteger(range.chartIndex) || range.chartIndex < 0 || range.chartIndex >= chartCount
        || !Number.isSafeInteger(range.firstTriangle) || range.firstTriangle !== coveredTriangles
        || !Number.isSafeInteger(range.triangleCount) || range.triangleCount < 1
        || range.firstTriangle + range.triangleCount > triangleCount) {
      throw new Error("Cao chart triangle ranges are invalid or non-contiguous");
    }
    const rangeOffset = rangeIndex * 4;
    const boundsOffset = rangeIndex * 6;
    chartRanges[rangeOffset] = range.chartIndex;
    chartRanges[rangeOffset + 1] = range.firstTriangle;
    chartRanges[rangeOffset + 2] = range.triangleCount;
    let preparedEntryIndex = Number.NaN;
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (let triangle = range.firstTriangle;
      triangle < range.firstTriangle + range.triangleCount; triangle += 1) {
      for (let corner = 0; corner < 3; corner += 1) {
        const vertex = source.indices[triangle * 3 + corner]!;
        if (source.materialChartIndices[vertex] !== range.chartIndex) {
          throw new Error("Cao chart triangle range ownership mismatch");
        }
        const entry = source.preparedEntryIndices[vertex]!;
        if (Number.isNaN(preparedEntryIndex)) preparedEntryIndex = entry;
        else if (entry !== preparedEntryIndex) {
          throw new Error("Cao chart triangle range uses multiple prepared palette entries");
        }
        for (let axis = 0; axis < 3; axis += 1) {
          const value = source.referenceDirections[vertex * 3 + axis]! * shellRadius;
          minimum[axis] = Math.min(minimum[axis]!, value);
          maximum[axis] = Math.max(maximum[axis]!, value);
        }
      }
    }
    chartRanges[rangeOffset + 3] = preparedEntryIndex;
    chartBounds.set([...minimum, ...maximum], boundsOffset);
    coveredTriangles += range.triangleCount;
  }
  if (coveredTriangles !== triangleCount) {
    throw new Error("Cao chart triangle ranges do not cover the complete batch");
  }
  return { chartRanges, chartBounds };
}

export function packCaoPaletteValues(
  values: Float32Array,
  entryCount: number,
  maxTextureSize: number,
): PackedCaoPalette {
  if (!Number.isSafeInteger(entryCount) || entryCount < 1
      || !Number.isSafeInteger(maxTextureSize) || maxTextureSize < 3) {
    throw new Error("invalid prepared Cao palette shape");
  }
  const expectedValues = entryCount * PREPARED_MOTION_PALETTE_STRIDE;
  if (!Number.isSafeInteger(expectedValues) || values.length !== expectedValues || !allFinite(values)) {
    throw new Error("invalid prepared Cao palette values");
  }
  for (let entry = 0; entry < entryCount; entry += 1) {
    const offset = entry * PREPARED_MOTION_PALETTE_STRIDE;
    const youngerNorm = Math.hypot(values[offset]!, values[offset + 1]!, values[offset + 2]!, values[offset + 3]!);
    const olderNorm = Math.hypot(values[offset + 4]!, values[offset + 5]!, values[offset + 6]!, values[offset + 7]!);
    if (Math.abs(youngerNorm - 1) > 2e-6 || Math.abs(olderNorm - 1) > 2e-6
        || values[offset + 8]! < 0 || values[offset + 8]! > 1
        || values[offset + 9]! < 0 || values[offset + 9]! > 1
        || values[offset + 10]! < 0 || values[offset + 10]! > 1) {
      throw new Error("invalid prepared Cao palette entry");
    }
  }
  const texelCount = entryCount * 3;
  const width = Math.min(CAO_FOUNDATION_PALETTE_TEXEL_WIDTH, maxTextureSize);
  const height = Math.ceil(texelCount / width);
  if (height > maxTextureSize) throw new Error("prepared Cao palette exceeds backend texture bound");
  const data = new Float32Array(width * height * 4);
  for (let entry = 0; entry < entryCount; entry += 1) {
    const source = entry * PREPARED_MOTION_PALETTE_STRIDE;
    const target = entry * 12;
    data.set(values.subarray(source, source + PREPARED_MOTION_PALETTE_STRIDE), target);
  }
  return Object.freeze({ data, width, height, entryCount });
}

export function packPreparedCaoPalette(
  revision: PreparedCaoRevision,
  maxTextureSize: number,
): PackedCaoPalette {
  const palette = revision.motionPalette;
  if (palette.stride !== PREPARED_MOTION_PALETTE_STRIDE) {
    throw new Error("invalid prepared Cao palette shape");
  }
  return packCaoPaletteValues(palette.createValuesCopy(), palette.entryCount, maxTextureSize);
}

function tuple4(node: Node<"vec4">): QuaternionWxyz<Node<"float">> {
  return [node.x, node.y, node.z, node.w];
}

function tuple3(node: Node<"vec3">): UnitDirection<Node<"float">> {
  return [node.x, node.y, node.z];
}

/**
 * Activation below this reads as "this chart does not exist at the requested
 * age", and the vertex collapses to the globe centre rather than being drawn
 * somewhere arbitrary. The value sits just above the linear ramp's zero so a
 * chart that is exactly dead stays collapsed under float rounding.
 */
const CAO_FOUNDATION_ACTIVATION_EPSILON = 1.00001e-4;

interface CaoPoseNodes {
  readonly position: Node<"vec3">;
  readonly direction: Node<"vec3">;
  readonly activation: Node<"float">;
  /** 1 where the owning chart is active at the requested age, 0 where it is not. */
  readonly activeMask: Node<"float">;
}

/**
 * The prepared-pose graph for one reconstructed point, driven by explicit
 * reference-direction and palette-entry nodes rather than by fixed attribute
 * names.
 *
 * The country-line quad expansion needs *both* endpoints of a segment inside
 * every vertex invocation — it can only work out a screen-space direction from
 * the pair — so it evaluates this twice from two instanced attributes. Surface
 * batches evaluate it once from the geometry's own `position`.
 */
function evaluatePreparedCaoPose(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  displayFraction: UniformNode<"float", number>,
  verticalExaggeration: UniformNode<"float", number>,
  displayHeightStart: Node<"float">,
  displayHeightEnd: Node<"float">,
  shellOffsetMetres: number,
  referenceDirection: Node<"vec3">,
  preparedEntryIndex: Node<"int">,
): CaoPoseNodes {
  const baseTexel = preparedEntryIndex.mul(3).toInt();
  const texel = (offset: number) => {
    const linear = baseTexel.add(offset).toInt();
    return textureLoad(paletteTexture, ivec2(linear.mod(paletteWidth), linear.div(paletteWidth)));
  };
  const younger = texel(0);
  const older = texel(1);
  const state = texel(2);
  const result = evaluateForwardPatchVertex(tslScalarOps, {
    poseMode: float(0),
    referenceDirection: tuple3(referenceDirection),
    deformingDirectionStart: tuple3(referenceDirection),
    deformingDirectionEnd: tuple3(referenceDirection),
    motionStart: tuple4(younger),
    motionEnd: tuple4(older),
    motionFraction: state.x,
    displayHeightStartMetres: displayHeightStart,
    displayHeightEndMetres: displayHeightEnd,
    displayFraction,
    verticalExaggeration,
    activationStart: state.y,
    activationEnd: state.z,
  });
  const direction = vec3(...result.rendererDirection);
  const activeMask = step(float(CAO_FOUNDATION_ACTIVATION_EPSILON), result.activation);
  const position = vec3(...result.rendererPosition).add(
    direction.mul(float(shellOffsetMetres / EARTH_RADIUS_METRES)),
  ).mul(activeMask);
  return Object.freeze({ position, direction, activation: result.activation, activeMask });
}

function createPreparedCaoPoseNodes(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  displayFractionValue: number,
  verticalExaggerationValue: number,
  displayHeightStart: Node<"float">,
  displayHeightEnd: Node<"float">,
  shellOffsetMetres: number,
): Readonly<CaoPoseNodes & {
  displayFraction: UniformNode<"float", number>;
  verticalExaggeration: UniformNode<"float", number>;
}> {
  if (!Number.isSafeInteger(paletteWidth) || paletteWidth < 1
      || !Number.isFinite(shellOffsetMetres) || shellOffsetMetres < 0) {
    throw new Error("invalid Cao palette or shell offset");
  }
  const displayFraction = uniform(displayFractionValue, "float");
  const verticalExaggeration = uniform(verticalExaggerationValue, "float");
  const pose = evaluatePreparedCaoPose(paletteTexture, paletteWidth, displayFraction,
    verticalExaggeration, displayHeightStart, displayHeightEnd, shellOffsetMetres,
    attribute<"vec3">("position", "vec3"), int(attribute<"uint">("preparedEntryIndex", "uint")));
  return Object.freeze({ ...pose, displayFraction, verticalExaggeration });
}

export function createCaoFoundationMaterial(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  display: PreparedCaoDisplayControlsCopy,
  displayFractionValue: number,
  verticalExaggerationValue: number,
  shellOffsetMetres: number = CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
  appearance: CaoFoundationBatchAppearance = "land",
): CaoFoundationMaterialGraph {
  const displayHeightStart = display.displayHeightStart.kind === "uniform"
    ? float(display.displayHeightStart.value) : attribute<"float">("displayHeightStartMetres", "float");
  const displayHeightEnd = display.displayHeightEnd.kind === "uniform"
    ? float(display.displayHeightEnd.value) : attribute<"float">("displayHeightEndMetres", "float");
  const pose = createPreparedCaoPoseNodes(paletteTexture, paletteWidth,
    displayFractionValue, verticalExaggerationValue, displayHeightStart,
    displayHeightEnd, shellOffsetMetres);
  // Shelf plates light up brighter than the MeshPhysical globe ocean; keep the
  // water classes front-faced and rougher, and dim the shelf alone so it sits
  // near deep-sea tone. A mapped shallow sea carries its own colour instead.
  const material = new MeshStandardNodeMaterial({
    side: caoFoundationAppearanceFrontSideOnly(appearance) ? FrontSide : DoubleSide,
    roughness: caoFoundationAppearanceRoughness(appearance),
    metalness: 0,
  });
  material.positionNode = pose.position;
  // NodeMaterial consumes a custom normalNode in view space. The reconstructed
  // radial direction is mesh-local, so transform it exactly once before lighting.
  material.normalNode = transformNormalToView(pose.direction);
  if (display.baseColor.kind === "uniform") {
    const [r, g, b] = display.baseColor.value;
    const dim = caoFoundationAppearanceDim(appearance);
    material.colorNode = vec3(r * dim, g * dim, b * dim);
  } else {
    material.colorNode = attribute<"vec3">("color", "vec3");
  }
  return Object.freeze({ material, displayFraction: pose.displayFraction,
    verticalExaggeration: pose.verticalExaggeration });
}

/**
 * Visual core width of a country outline, in CSS pixels.
 *
 * Neither backend can widen a GPU line primitive: `linewidth` is ignored by
 * WebGL2 core profiles and WebGPU has no line width at all, so a line is
 * exactly one device pixel. On a diagonal that hairline hands most of its
 * multisample coverage to one of two neighbouring pixel rows, its darkness
 * swings between a fully covered pixel and a barely visible one along a single
 * segment, and the outline reads as beaded. Each segment is therefore expanded
 * into a screen-space quad and shaded from its own analytic coverage, which
 * fixes the continuity without making the stroke thicker: the core stays one
 * CSS pixel — two device pixels at ratio 2, one at ratio 1 — and the
 * antialiasing ramp lives outside it.
 *
 * There is no second contrast shell. The overlay used to draw a darker,
 * slightly wider underlay because neither pass could ever be solid, so the two
 * together only deepened the hairline union. A quad shaded from its own
 * coverage reaches full opacity at its core, and a wider darker pass under it
 * then shows its own margins as two rails around a lighter centre — measured at
 * 2.0 CSS px against 1.0 for the stroke alone, which is the thickening this
 * change exists to remove.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_WIDTH_CSS_PX = 1;

/**
 * Width of the analytic coverage ramp, in device pixels, centred on the core
 * edge. One device pixel is the narrowest ramp that still resolves a diagonal
 * edge; a wider one would blur the stroke, a narrower one would alias it.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_FEATHER_DEVICE_PX = 1;

/** Total country-line draws per frame this renderer is allowed to publish. */
export const CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET = 1;

/**
 * The two inks a country outline is drawn in.
 *
 * The dark slate is the only ink the overlay has ever used and stays the whole
 * outline whenever no tone table is loaded. The light grey is the guide labels'
 * own water ink (`GUIDE_LABEL_LIGHT_INK_STYLE`, pinned equal by the unit test),
 * so an outline crossing a palaeo sea reads like a label over the same water.
 *
 * The hex is an sRGB style; it is decoded into the renderer's working colour
 * space here because that is what the guide-label texture upload does to the
 * same value, and a raw component triple would render a visibly brighter grey.
 * Two tones are a legibility device for a reference overlay, never evidence of
 * a coastline: see the map key's outline-marker legend.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_DARK_INK: readonly [number, number, number] =
  Object.freeze([0.12, 0.15, 0.18]);
export const CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK_STYLE = "#d0d4d5";
export const CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK: readonly [number, number, number] =
  Object.freeze((() => {
    const color = new THREE.Color().setStyle(
      CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK_STYLE, THREE.SRGBColorSpace);
    return [color.r, color.g, color.b] as [number, number, number];
  })());

/** Per-segment tone counts a loaded outline tone table resolves to. */
export interface CaoFoundationOutlineToneCounts {
  readonly darkSegments: number;
  readonly lightSegments: number;
}

/**
 * The R8 texture one outline tone table is sampled through, zero-filled: every
 * segment dark, which is exactly today's single-ink outline.
 */
export function createCaoFoundationCountryLineToneTexture(
  segmentCount: number,
): THREE.DataTexture {
  const rows = palaeoOutlineToneTextureRows(segmentCount);
  const texture = new THREE.DataTexture(
    new Uint8Array(rows * PALAEO_OUTLINE_TONE_TEXTURE_WIDTH),
    PALAEO_OUTLINE_TONE_TEXTURE_WIDTH, rows, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Quad template shared by every country-line segment: four corners in
 * quad-local coordinates (`along`, `side`, 0) and the two triangles over them.
 * `along` selects which endpoint of the segment the corner sits at, `side`
 * which edge of the stroke.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_QUAD_CORNERS: readonly number[] = Object.freeze([
  -1, -1, 0, -1, 1, 0, 1, -1, 0, 1, 1, 0,
]);
export const CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES: readonly number[] =
  Object.freeze([0, 1, 2, 2, 1, 3]);
/** Corners a segment's quad is drawn from, and indices over them. */
export const CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT = 4;
export const CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES_PER_SEGMENT = 6;

/**
 * Vertex- and index-buffer bytes each segment costs in the expanded form: four
 * corners carrying the quad-local corner, both endpoint directions, the shared
 * palette entry and the segment's own index, plus six indices.
 */
export const CAO_FOUNDATION_COUNTRY_LINE_QUAD_SEGMENT_BYTES =
  CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT * (3 * 4 + 3 * 4 + 3 * 4 + 4 + 4)
  + CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES_PER_SEGMENT * 4;

/**
 * GPU bytes the expanded quad form of a line batch occupies.
 *
 * The package stores two unshared vertices and an index pair per segment — 40
 * bytes for the shipped package. The quad form materialises four corners, each
 * carrying its quad-local coordinate, both endpoint directions and the segment
 * index its outline tone is looked up by, so it costs 200 bytes per segment
 * instead.
 * Those extra bytes buy a plain indexed draw: the instanced form is four bytes
 * *cheaper* per corner but pays a per-instance cost that a software rasterizer
 * charges in full, which made the overlay three times more expensive there than
 * the hairline it replaced. The cost is counted explicitly here rather than
 * assumed to fit under the source-copy bytes, which it no longer does.
 */
export function caoFoundationCountryLineQuadBytes(segmentCount: number): number {
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 0) {
    throw new Error("invalid Cao country line segment count");
  }
  return segmentCount * CAO_FOUNDATION_COUNTRY_LINE_QUAD_SEGMENT_BYTES;
}

/** Renderer-unit radius of the opaque globe shell (`GlobeScene` globe mesh). */
export const CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS = 1;

/**
 * Below this squared screen length a segment has no usable direction, so the
 * quad falls back to an axis-aligned square of its own width rather than
 * dividing by zero. Squared device pixels.
 */
const CAO_FOUNDATION_COUNTRY_LINE_DEGENERATE_PIXELS_SQ = 1e-12;

/**
 * Half the visual core width in device pixels, and the geometric half-extent
 * the quad must actually reach to carry the coverage ramp.
 *
 * `pixelRatio` is the renderer's own pixel ratio (`screenDPR` in the material),
 * which is what turns a CSS-pixel width into device pixels; the drawing-buffer
 * size converts those device pixels back into clip space.
 */
export function caoFoundationCountryLineHalfWidthPx(pixelRatio: number): number {
  return CAO_FOUNDATION_COUNTRY_LINE_WIDTH_CSS_PX * pixelRatio / 2;
}

export function caoFoundationCountryLinePadPx(pixelRatio: number): number {
  return caoFoundationCountryLineHalfWidthPx(pixelRatio)
    + CAO_FOUNDATION_COUNTRY_LINE_FEATHER_DEVICE_PX / 2;
}

/**
 * One quad-expansion formula consumed by the TSL material and its unit test.
 *
 * `along` is -1 at the segment's start corner and +1 at its end corner, `side`
 * is -1/+1 across it. The corner is pushed `padPixels` perpendicular to the
 * screen-space segment direction, and a further `padPixels` *along* that
 * direction past the endpoint. That end extension is what keeps a join between
 * two segments from leaving a notch: each quad overruns its endpoint by its own
 * half-extent, so consecutive quads overlap across the corner instead of
 * meeting at a point.
 *
 * Endpoints that project to the same pixel — a segment shorter than a pixel, or
 * a segment whose chart is inactive so both ends collapsed to the globe centre
 * — have no direction at all. The guard substitutes the +x axis so the result
 * is a finite square rather than a NaN; the caller zeroes the whole offset for
 * the collapsed case, which turns that square back into a point.
 */
export function evaluateCountryLineQuadOffsetPx<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ startPixelX: T; startPixelY: T; endPixelX: T; endPixelY: T;
    along: T; side: T; padPixels: T }>,
): readonly [T, T] {
  const deltaX = ops.sub(input.endPixelX, input.startPixelX);
  const deltaY = ops.sub(input.endPixelY, input.startPixelY);
  const lengthSq = ops.add(ops.mul(deltaX, deltaX), ops.mul(deltaY, deltaY));
  const degenerate = ops.lessThan(lengthSq, ops.constant(CAO_FOUNDATION_COUNTRY_LINE_DEGENERATE_PIXELS_SQ));
  const safeX = ops.select(degenerate, ops.constant(1), deltaX);
  const safeY = ops.select(degenerate, ops.constant(0), deltaY);
  const safeLengthSq = ops.select(degenerate, ops.constant(1), lengthSq);
  const inverseLength = ops.div(ops.constant(1), ops.sqrt(safeLengthSq));
  const unitX = ops.mul(safeX, inverseLength);
  const unitY = ops.mul(safeY, inverseLength);
  return [
    ops.mul(ops.sub(ops.mul(unitX, input.along), ops.mul(unitY, input.side)), input.padPixels),
    ops.mul(ops.add(ops.mul(unitY, input.along), ops.mul(unitX, input.side)), input.padPixels),
  ];
}

/**
 * One coverage formula consumed by the TSL material and its unit test.
 *
 * `distancePixels` is the signed perpendicular distance from the segment's
 * centre line in device pixels. Coverage is a smoothstep across a ramp of
 * `featherPixels` centred on the core edge, so it is 1 on the centre line,
 * exactly 0.5 at the half width — the edge the reader perceives as the stroke's
 * boundary — and 0 half a ramp beyond it. That is the analytic replacement for
 * multisample coverage, which a one-pixel primitive could not supply evenly.
 */
export function evaluateCountryLineCoverage<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ distancePixels: T; halfWidthPixels: T; featherPixels: T }>,
): T {
  const distance = ops.sqrt(ops.mul(input.distancePixels, input.distancePixels));
  const outer = ops.add(input.halfWidthPixels, ops.div(input.featherPixels, ops.constant(2)));
  const ramp = ops.clamp(ops.div(ops.sub(outer, distance), input.featherPixels), 0, 1);
  return ops.mul(ops.mul(ramp, ramp), ops.sub(ops.constant(3), ops.mul(ops.constant(2), ramp)));
}

/**
 * Cosine of the angular separation at which the opaque globe starts hiding an
 * outline shell point, widened by a margin whose cosine and sine are supplied.
 *
 * A point at `pointRadius` is visible from `cameraRadius` exactly while their
 * angular separation stays within `acos(occluder/cameraRadius) +
 * acos(occluder/pointRadius)`; this returns the cosine of that sum plus the
 * margin, so no inverse trigonometry runs per vertex or per fragment. Both
 * half-angles are at most 90 degrees and the margins used here are single
 * degrees, so the sum stays inside the monotone range of acos and the cosine
 * comparison never wraps.
 */
export function evaluateCountryLineHorizonLimitCos<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ pointRadius: T; cameraRadius: T; occluderRadius: T; marginCos: T; marginSin: T }>,
): T {
  const cosCamera = ops.clamp(ops.div(input.occluderRadius, input.cameraRadius), 0, 1);
  const cosPoint = ops.clamp(ops.div(input.occluderRadius, input.pointRadius), 0, 1);
  const sine = (cosine: T) => ops.sqrt(
    ops.clamp(ops.sub(ops.constant(1), ops.mul(cosine, cosine)), 0, 1));
  const sinCamera = sine(cosCamera);
  const sinPoint = sine(cosPoint);
  const cosSum = ops.sub(ops.mul(cosCamera, cosPoint), ops.mul(sinCamera, sinPoint));
  const sinSum = ops.add(ops.mul(sinCamera, cosPoint), ops.mul(cosCamera, sinPoint));
  return ops.sub(ops.mul(cosSum, input.marginCos), ops.mul(sinSum, input.marginSin));
}

/**
 * One horizon-occlusion formula consumed by the TSL material and its unit test.
 * Returns 1 where the outline shell point is visible past the opaque globe and
 * 0 where the globe hides it.
 *
 * The screen-space quad cannot use the depth buffer: its corners carry the
 * depth of the endpoint they were expanded from but are rasterized up to a
 * pixel and a half away, and at grazing incidence the land shell's depth
 * changes far faster per pixel than the 1 000 m gap between the line and land
 * shells, so a corner pushed inward loses the depth test over almost the whole
 * globe view while one pushed outward wins it past the silhouette and draws
 * over the sky. (Measured on the earlier multi-copy build at a deliberate 8 px
 * shift: 18 883 line pixels survived on the outward side against 856 inward.)
 * Nothing in the scene legitimately occludes these lines except the globe body:
 * land and shelf sit below the line shell — an invariant the publication guard
 * enforces, because the display controls could otherwise lift them — and the
 * cloud shell never writes depth. Occlusion is therefore computed analytically
 * here instead.
 *
 * The fragment stage evaluates this with a zero margin, so the terminator stays
 * a sharp per-pixel cut. The vertex stage evaluates it again with a margin
 * wider than the widest segment chord, which collapses far-side vertices so
 * they rasterize nothing at all instead of being shaded and then zeroed.
 */
export function evaluateCountryLineHorizonVisibility<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ cosSeparation: T; pointRadius: T; cameraRadius: T;
    occluderRadius: T; marginCos: T; marginSin: T }>,
): T {
  const limit = evaluateCountryLineHorizonLimitCos(ops, input);
  return ops.select(ops.lessThan(limit, input.cosSeparation), ops.constant(1), ops.constant(0));
}

/**
 * Whether a segment's quad is drawn at all, from its two endpoints' horizon
 * visibility and their activation masks.
 *
 * *Either* endpoint being within the widened terminator keeps the quad, so a
 * segment straddling the terminator survives whole and the fragment term cuts
 * it at the true horizon; requiring both would erase the outline a full cull
 * margin inside the limb. Both endpoints must be active, because a segment with
 * one end collapsed to the globe centre is not a line on the surface at all.
 */
export function evaluateCountryLineSegmentVisibility<T, C>(
  ops: ScalarOps<T, C>,
  input: Readonly<{ startVisible: T; endVisible: T; startActive: T; endActive: T }>,
): T {
  const eitherVisible = ops.select(ops.lessThan(input.startVisible, input.endVisible),
    input.endVisible, input.startVisible);
  return ops.mul(ops.mul(eitherVisible, input.startActive), input.endActive);
}

export function createCaoFoundationCountryLineMaterial(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  displayFractionValue: number,
  segmentCount: number,
): CaoFoundationLineMaterialGraph {
  if (!Number.isSafeInteger(segmentCount) || segmentCount < 0) {
    throw new Error("invalid Cao country line segment count");
  }
  // A dark slate: the earlier mid-tone slate read as nearly invisible on phones
  // and pale land. Width comes from the screen-space quad, not from any shell
  // gap, and the single shell is the only thing the display-height guard has to
  // keep the surface below.
  const shellOffset = CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES;
  const displayFraction = uniform(displayFractionValue, "float");
  const verticalExaggeration = uniform(1, "float");
  // `position` is the corner in quad-local coordinates: x = -1 at the segment's
  // start, +1 at its end; y = -1/+1 across the stroke. Every corner carries both
  // reconstructed endpoints, because it cannot be placed without knowing both.
  const corner = attribute<"vec3">("position", "vec3");
  const along = corner.x;
  const side = corner.y;
  const entry = int(attribute<"uint">("countryLineEntryIndex", "uint"));
  const pose = (reference: Node<"vec3">) => evaluatePreparedCaoPose(paletteTexture, paletteWidth,
    displayFraction, verticalExaggeration, float(0), float(0), shellOffset, reference, entry);
  // Both endpoints of a segment are validated to share one palette entry, so
  // one instanced entry index drives both poses and both share one activation.
  const startPose = pose(attribute<"vec3">("countryLineStart", "vec3"));
  const endPose = pose(attribute<"vec3">("countryLineEnd", "vec3"));
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    opacity: 0.92,
    // Occlusion comes from the horizon term below, not from the depth buffer.
    depthTest: false,
    depthWrite: false,
    // A screen-space quad's winding flips with the segment's screen bearing.
    side: DoubleSide,
  });
  // Two-tone ink. The segment's own index reads one texel of the resident tone
  // table in the *vertex* stage and passes it through a flat varying: the four
  // corners of a quad carry the same segment index, so the tone is constant
  // across the quad and interpolating it would only blur a value that has no
  // gradient. Sampling in the fragment stage instead would run a texture load
  // per outline fragment for that same constant.
  const segmentIndex = int(attribute<"uint">("countryLineSegmentIndex", "uint"));
  const toneTexture = createCaoFoundationCountryLineToneTexture(segmentCount);
  const toneWidth = PALAEO_OUTLINE_TONE_TEXTURE_WIDTH;
  const segmentToneSample = textureLoad(toneTexture,
    ivec2(segmentIndex.mod(toneWidth), segmentIndex.div(toneWidth))).x;
  const toneMix = varying(segmentToneSample).setInterpolation("flat");
  const darkInk = vec3(...CAO_FOUNDATION_COUNTRY_LINE_DARK_INK);
  const lightInk = vec3(...CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK);
  // Dark slate stays visible across pale land and dark shelf water alike; the
  // light grey is what keeps an outline legible over a mapped palaeo sea.
  material.colorNode = mix(darkInk, lightInk, toneMix);
  const pointRadius = float(1 + shellOffset / EARTH_RADIUS_METRES);
  const cameraDirection = cameraPosition.normalize();
  const cameraRadius = cameraPosition.length();
  const occluderRadius = float(CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS);
  // The reconstructed radial direction stays unit length even where activation
  // collapses the position to the origin, so the horizon term is well defined
  // for every endpoint. The globe centre is the world origin.
  const worldDirection = (direction: Node<"vec3">) =>
    modelWorldMatrix.mul(vec4(direction, 0)).xyz.normalize();
  const worldStart = worldDirection(startPose.direction);
  const worldEnd = worldDirection(endPose.direction);
  // Vertex stage: collapse the whole quad once *both* endpoints are past the
  // terminator by more than the widest chord in the package. A segment with one
  // visible end therefore survives intact, and a segment kept with both ends
  // just past the terminator is still invisible — every direction interpolated
  // along it stays past the terminator, so the fragment term zeroes all of it.
  // Far-side segments rasterize nothing instead of being shaded and blended
  // away, which the depth test used to do with early-Z.
  const margin = CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES * Math.PI / 180;
  const vertexCullCos = float(Math.cos(margin));
  const vertexCullSin = float(Math.sin(margin));
  const endpointVisible = (direction: Node<"vec3">) =>
    evaluateCountryLineHorizonVisibility(tslScalarOps, {
      cosSeparation: direction.dot(cameraDirection),
      pointRadius, cameraRadius, occluderRadius,
      marginCos: vertexCullCos, marginSin: vertexCullSin,
    });
  // Either endpoint being active keeps the quad; a segment whose chart does not
  // exist at this age has already collapsed both endpoints to the globe centre,
  // and this zeroes its screen expansion too so it stays a zero-area point
  // instead of a fixed-size square there.
  const vertexVisible = evaluateCountryLineSegmentVisibility(tslScalarOps, {
    startVisible: endpointVisible(worldStart), endVisible: endpointVisible(worldEnd),
    startActive: startPose.activeMask, endActive: endPose.activeMask,
  });
  const startPosition = startPose.position.mul(vertexVisible);
  const endPosition = endPose.position.mul(vertexVisible);
  const alongFraction = along.mul(0.5).add(0.5);
  const basePosition = startPosition.add(endPosition.sub(startPosition).mul(alongFraction));
  material.positionNode = basePosition;
  const clipOf = (position: Node<"vec3">) =>
    cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(position, 1)));
  const startClip = clipOf(startPosition);
  const endClip = clipOf(endPosition);
  // The camera orbits outside the occluder sphere at a radius of at least 1.15,
  // so every point on either outline shell is in front of the eye and the clip
  // w is strictly positive; the floor only keeps the divide finite.
  const halfBuffer = screenSize.mul(0.5);
  const toPixels = (clip: Node<"vec4">) => clip.xy.div(clip.w.max(float(1e-6))).mul(halfBuffer);
  const startPixels = toPixels(startClip);
  const endPixels = toPixels(endClip);
  const halfWidthPixels = screenDPR.mul(CAO_FOUNDATION_COUNTRY_LINE_WIDTH_CSS_PX / 2);
  const featherPixels = float(CAO_FOUNDATION_COUNTRY_LINE_FEATHER_DEVICE_PX);
  const padPixels = halfWidthPixels.add(featherPixels.mul(0.5));
  const quadOffsetPixels = evaluateCountryLineQuadOffsetPx(tslScalarOps, {
    startPixelX: startPixels.x, startPixelY: startPixels.y,
    endPixelX: endPixels.x, endPixelY: endPixels.y,
    along, side, padPixels,
  });
  const basePixels = startPixels.add(endPixels.sub(startPixels).mul(alongFraction));
  // The collapse has to reach the screen expansion as well as the positions:
  // with only the positions zeroed, a collapsed segment would still be pushed
  // out into a pad-sized square at the globe centre and rasterize there.
  const quadOffsetVector = vec2(quadOffsetPixels[0], quadOffsetPixels[1]);
  const collapsedOffsetPixels = quadOffsetVector.mul(vertexVisible);
  const cornerPixels = basePixels.add(collapsedOffsetPixels);
  const baseClip = startClip.add(endClip.sub(startClip).mul(alongFraction));
  material.vertexNode = vec4(cornerPixels.div(halfBuffer).mul(baseClip.w), baseClip.z, baseClip.w);
  // Fragment stage: the interpolated world direction, renormalised. Passing the
  // direction through a varying is what keeps the prepared pose graph — three
  // palette texture loads plus a quaternion slerp and rotate, twice over for the
  // two endpoints — in the vertex stage; three caches node results per shader
  // stage and only attributes insert a varying on their own, so reading
  // `worldStart` directly here would emit and run that whole graph again for
  // every outline fragment. Varying the 0/1 visibility instead would interpolate
  // it and blur the terminator.
  const fragmentCos = float(1);
  const fragmentSin = float(0);
  const fragmentDirection = varying(worldStart.add(worldEnd.sub(worldStart).mul(alongFraction)));
  const horizonVisibility = evaluateCountryLineHorizonVisibility(tslScalarOps, {
    cosSeparation: fragmentDirection.normalize().dot(cameraDirection),
    pointRadius, cameraRadius, occluderRadius,
    marginCos: fragmentCos, marginSin: fragmentSin,
  });
  // The corner's own perpendicular offset, interpolated, *is* the fragment's
  // signed distance from the centre line: the four corners form a rectangle in
  // screen space, so the linear term across it is exact up to the perspective
  // correction, which a segment's endpoint depth spread bounds well below the
  // ramp (about 0.007 device px at globe zoom, 0.17 px at the closest camera).
  const perpendicularPixels = varying(side.mul(padPixels));
  // Held as a record so a test can pin the identity of each term. Every one of
  // them is also transitively reachable from the others — the varying is scaled
  // by a pad built from the same half width — so a graph walk alone cannot tell
  // a swapped argument from the real one.
  const coverageInputs = Object.freeze({
    distancePixels: perpendicularPixels, halfWidthPixels, featherPixels,
  });
  const coverage = evaluateCountryLineCoverage(tslScalarOps, coverageInputs);
  material.opacityNode = materialOpacity.mul(coverage).mul(horizonVisibility);
  const toneData = (toneTexture.image as { data: Uint8Array }).data;
  let toneCounts: CaoFoundationOutlineToneCounts =
    Object.freeze({ darkSegments: segmentCount, lightSegments: 0 });
  const setCountryLineToneTable = (
    texels: Uint8Array | null,
  ): CaoFoundationOutlineToneCounts => {
    if (texels !== null && texels.length !== toneData.length) {
      throw new Error("Cao country line tone table shape mismatch");
    }
    // The upload is the expensive half, so compare first: an interval change
    // that leaves a table identical, and every repeated apply of the resident
    // one, must not re-upload the texture.
    let changed = false;
    for (let index = 0; index < toneData.length; index += 1) {
      const next = texels === null ? 0 : texels[index]!;
      if (toneData[index] !== next) {
        toneData[index] = next;
        changed = true;
      }
    }
    if (changed) toneTexture.needsUpdate = true;
    let lightSegments = 0;
    for (let segment = 0; segment < segmentCount; segment += 1) {
      if (toneData[segment] !== 0) lightSegments += 1;
    }
    toneCounts = Object.freeze({ darkSegments: segmentCount - lightSegments, lightSegments });
    return toneCounts;
  };
  return Object.freeze({ material, displayFraction, vertexVisible, horizonVisibility,
    fragmentDirection, coverage, coverageInputs, halfWidthPixels, perpendicularPixels,
    quadOffsetVector, collapsedOffsetPixels,
    toneTexture, segmentToneSample, toneMix, darkInk, lightInk,
    setCountryLineToneTable, toneCounts: () => toneCounts,
    quadOffsetPixels: Object.freeze([quadOffsetPixels[0], quadOffsetPixels[1]] as const),
    horizonMargins: Object.freeze({ vertexCullCos, vertexCullSin, fragmentCos, fragmentSin }) });
}

/**
 * Expand a country-line batch into one screen-space quad per segment.
 *
 * A quad corner cannot be placed without both endpoints of its segment — the
 * stroke direction is the screen-space direction between them — and the package
 * offers only two unshared vertices and an index pair per segment. Every corner
 * therefore carries both endpoint directions.
 * `validateStaticLineGeometryCopy` has already rejected any segment whose
 * endpoints disagree on the palette entry, so one entry index drives both poses.
 *
 * The corners are materialised rather than instanced over a shared template.
 * Instancing stores this four times more compactly, and is slightly faster on a
 * hardware rasterizer, but 12 045 four-vertex instances cost a software
 * rasterizer a per-instance setup it cannot amortise: measured under
 * SwiftShader, the instanced form made an orbit frame 1030 ms against 600 ms
 * with the overlay hidden, while this form measured 595 ms. The browser suite
 * runs headless on SwiftShader, so that difference is the difference between a
 * passing and a timing-out orbit test.
 */
function createCountryLineQuadGeometry(
  source: PreparedCaoLineGeometryCopy,
  segmentCount: number,
): { geometry: THREE.BufferGeometry; gpuBytes: number } {
  const perSegment = CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT;
  const corners = new Float32Array(segmentCount * perSegment * 3);
  const starts = new Float32Array(segmentCount * perSegment * 3);
  const ends = new Float32Array(segmentCount * perSegment * 3);
  const entries = new Uint32Array(segmentCount * perSegment);
  // Every corner also carries the segment it belongs to, which is the row the
  // outline tone table is sampled by. Four corners of one segment carry the
  // same index, so the tone is constant across the quad.
  const segmentIndices = new Uint32Array(segmentCount * perSegment);
  const indices = new Uint32Array(segmentCount * CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES_PER_SEGMENT);
  for (let segment = 0; segment < segmentCount; segment += 1) {
    const left = source.lineIndices[segment * 2]!;
    const right = source.lineIndices[segment * 2 + 1]!;
    const start = source.referenceDirections.subarray(left * 3, left * 3 + 3);
    const end = source.referenceDirections.subarray(right * 3, right * 3 + 3);
    const entry = source.preparedEntryIndices[left]!;
    for (let corner = 0; corner < perSegment; corner += 1) {
      const vertex = segment * perSegment + corner;
      for (let axis = 0; axis < 3; axis += 1) {
        corners[vertex * 3 + axis] = CAO_FOUNDATION_COUNTRY_LINE_QUAD_CORNERS[corner * 3 + axis]!;
      }
      starts.set(start, vertex * 3);
      ends.set(end, vertex * 3);
      entries[vertex] = entry;
      segmentIndices[vertex] = segment;
    }
    for (let slot = 0; slot < CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES_PER_SEGMENT; slot += 1) {
      indices[segment * CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES_PER_SEGMENT + slot] =
        segment * perSegment + CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES[slot]!;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(corners, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setAttribute("countryLineStart", new THREE.BufferAttribute(starts, 3));
  geometry.setAttribute("countryLineEnd", new THREE.BufferAttribute(ends, 3));
  const entryAttribute = new THREE.BufferAttribute(entries, 1);
  // The TSL graph declares a uint attribute. WebGL2 must therefore bind this
  // buffer through vertexAttribIPointer rather than float conversion.
  entryAttribute.gpuType = THREE.IntType;
  geometry.setAttribute("countryLineEntryIndex", entryAttribute);
  const segmentAttribute = new THREE.BufferAttribute(segmentIndices, 1);
  segmentAttribute.gpuType = THREE.IntType;
  geometry.setAttribute("countryLineSegmentIndex", segmentAttribute);
  // `position` holds the quad-local corner, so a computed bounding sphere would
  // describe quad-local space. Transparent sorting wants the shell the segments
  // actually live on.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(),
    1 + CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES / EARTH_RADIUS_METRES);
  const gpuBytes = corners.byteLength + indices.byteLength
    + starts.byteLength + ends.byteLength + entries.byteLength + segmentIndices.byteLength;
  if (gpuBytes !== caoFoundationCountryLineQuadBytes(segmentCount)) {
    throw new Error("Cao country line quad byte ledger mismatch");
  }
  return { geometry, gpuBytes };
}

export function estimateCaoFoundationGeometryReservation(
  revision: PreparedCaoRevision,
  limits: CaoFoundationLimits,
): number {
  if (!Number.isSafeInteger(limits.maxBatches) || limits.maxBatches < 1
      || !Number.isSafeInteger(limits.maxVertices) || limits.maxVertices < 3
      || !Number.isSafeInteger(limits.maxTriangles) || limits.maxTriangles < 1
      || !Number.isSafeInteger(limits.maxRetainedSourceBytes) || limits.maxRetainedSourceBytes < 1
      || !Number.isSafeInteger(limits.maxSpatialIndexBytes) || limits.maxSpatialIndexBytes < 1) {
    throw new Error("invalid Cao foundation renderer limits");
  }
  if (revision.batches.length < 1
      || revision.batches.length + revision.lineBatches.length > limits.maxBatches) {
    throw new Error("Cao foundation batch count exceeds limit");
  }
  let sourceBytes = 0;
  let vertices = 0;
  let triangles = 0;
  let spatialIndexBytes = 0;
  for (const batch of revision.batches) {
    sourceBytes = safeAdd(sourceBytes, batch.staticGeometryBytes, "Cao source");
    vertices = safeAdd(vertices, batch.vertexCount, "Cao vertex");
    triangles = safeAdd(triangles, batch.triangleCount, "Cao triangle");
    spatialIndexBytes = safeAdd(spatialIndexBytes,
      batch.chartTriangleRanges.length * (4 * Uint32Array.BYTES_PER_ELEMENT
        + 6 * Float32Array.BYTES_PER_ELEMENT), "Cao spatial index");
  }
  let lineQuadBytes = 0;
  for (const batch of revision.lineBatches) {
    sourceBytes = safeAdd(sourceBytes, batch.staticGeometryBytes, "Cao line source");
    // Each segment is drawn as a screen-space quad: four expanded corners and
    // two triangles, not the package's own two vertices and one line primitive.
    vertices = safeAdd(vertices,
      batch.segmentCount * CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT, "Cao line vertex");
    triangles = safeAdd(triangles, batch.segmentCount * 2, "Cao line primitive");
    lineQuadBytes = safeAdd(lineQuadBytes,
      caoFoundationCountryLineQuadBytes(batch.segmentCount), "Cao line quad");
  }
  if (sourceBytes > limits.maxRetainedSourceBytes || vertices > limits.maxVertices
      || triangles > limits.maxTriangles || spatialIndexBytes > limits.maxSpatialIndexBytes) {
    throw new Error("Cao foundation geometry exceeds renderer limit");
  }
  // Source copies remain retained for sparse picking; surface GPU vertex/index
  // buffers are the same arrays, so the complete source-copy byte count bounds
  // them. Country-line quads are newly built arrays and are added explicitly
  // rather than assumed to fit under the source count, because a package that
  // shared line vertices between segments would make that assumption false.
  return safeAdd(safeAdd(safeAdd(sourceBytes, sourceBytes, "Cao geometry reservation"),
    spatialIndexBytes, "Cao geometry reservation"), lineQuadBytes, "Cao geometry reservation");
}

export function createCaoFoundationGeometryResource(
  revision: PreparedCaoRevision,
  limits: CaoFoundationLimits,
): CaoFoundationGeometryResource {
  const reservation = estimateCaoFoundationGeometryReservation(revision, limits);
  const resources: CaoFoundationBatchResource[] = [];
  const lineResources: CaoFoundationLineBatchResource[] = [];
  let retainedCpuBytes = 0;
  let trackedGpuBufferBytes = 0;
  try {
    for (const prepared of revision.batches) {
      const source = prepared.createStaticGeometryCopy();
      validateStaticGeometryCopy(source, prepared.vertexCount, prepared.triangleCount,
        revision.motionPalette.entryCount, revision.charts.length);
      const cpuBytes = staticGeometryByteLength(source);
      if (cpuBytes !== prepared.staticGeometryBytes) throw new Error("Cao prepared batch byte ledger mismatch");
      retainedCpuBytes = safeAdd(retainedCpuBytes, cpuBytes, "Cao retained CPU");
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(source.referenceDirections, 3));
      const preparedEntryIndex = new THREE.BufferAttribute(source.preparedEntryIndices, 1);
      // The TSL graph declares a uint attribute. WebGL2 must therefore bind
      // this buffer through vertexAttribIPointer rather than float conversion.
      preparedEntryIndex.gpuType = THREE.IntType;
      geometry.setAttribute("preparedEntryIndex", preparedEntryIndex);
      geometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
      const gpuBytes = source.referenceDirections.byteLength + source.preparedEntryIndices.byteLength
        + source.indices.byteLength;
      trackedGpuBufferBytes = safeAdd(trackedGpuBufferBytes, gpuBytes, "Cao tracked GPU");
      const appearance = caoFoundationBatchAppearance(prepared.batchId, prepared.surfaceAppearance);
      const surfaceClass = caoFoundationSurfaceClass(appearance, prepared.nativePrecedence);
      const shellOffsetMetres = caoFoundationSurfaceShell(surfaceClass).shellOffsetMetres;
      const spatial = createChartSpatialIndex(source, prepared.chartTriangleRanges,
        prepared.triangleCount, revision.charts.length, shellOffsetMetres);
      retainedCpuBytes = safeAdd(retainedCpuBytes,
        spatial.chartRanges.byteLength + spatial.chartBounds.byteLength, "Cao retained spatial index");
      resources.push(Object.freeze({ batchId: prepared.batchId, geometry, source,
        vertexCount: prepared.vertexCount, triangleCount: prepared.triangleCount,
        nativePrecedence: prepared.nativePrecedence, appearance, surfaceClass, shellOffsetMetres,
        chartRanges: spatial.chartRanges, chartBounds: spatial.chartBounds }));
    }
    for (const prepared of revision.lineBatches) {
      const source = prepared.createStaticGeometryCopy();
      validateStaticLineGeometryCopy(source, prepared.vertexCount, prepared.segmentCount,
        revision.motionPalette.entryCount, revision.charts.length);
      const cpuBytes = staticLineGeometryByteLength(source);
      if (cpuBytes !== prepared.staticGeometryBytes) {
        throw new Error("Cao prepared country line byte ledger mismatch");
      }
      retainedCpuBytes = safeAdd(retainedCpuBytes, cpuBytes, "Cao retained line CPU");
      const expanded = createCountryLineQuadGeometry(source, prepared.segmentCount);
      const geometry = expanded.geometry;
      trackedGpuBufferBytes = safeAdd(trackedGpuBufferBytes, expanded.gpuBytes, "Cao tracked line GPU");
      lineResources.push(Object.freeze({ batchId: prepared.batchId, geometry, source,
        vertexCount: prepared.vertexCount, segmentCount: prepared.segmentCount }));
    }
    const byteLength = safeAdd(retainedCpuBytes, trackedGpuBufferBytes, "Cao geometry");
    if (byteLength > reservation) throw new Error("Cao geometry exceeded its preflight reservation");
    return {
      key: `${revision.packageId}@${revision.packageRevision}:${[
        ...revision.batches.map((batch) => batch.staticGeometryIdentity),
        ...revision.lineBatches.map((batch) => batch.staticGeometryIdentity),
      ].join("|")}`,
      batches: Object.freeze(resources),
      lineBatches: Object.freeze(lineResources),
      chartIdentities: Object.freeze(revision.charts.map((chart) => Object.freeze({
        chartId: chart.chartId,
        chartRevision: chart.chartRevision,
        materialId: chart.materialId,
        fragmentOrCohortId: chart.fragmentOrCohortId,
      }))),
      byteLength,
      retainedCpuBytes,
      trackedGpuBufferBytes,
      dispose: () => [...resources, ...lineResources].forEach((resource) => resource.geometry.dispose()),
    };
  } catch (error) {
    resources.forEach((resource) => resource.geometry.dispose());
    lineResources.forEach((resource) => resource.geometry.dispose());
    throw error;
  }
}

export function createCaoFoundationPaletteTexture(packed: PackedCaoPalette): THREE.DataTexture {
  const texture = new THREE.DataTexture(packed.data, packed.width, packed.height,
    THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

interface CaoTopologyOwnershipState {
  readonly sourceAgeMa: number;
  readonly directions: Float32Array;
  readonly rings: readonly CaoTopologyOwnershipRing[];
  readonly byteLength: number;
}

interface CaoTopologyOwnershipRing extends TopologyOwnershipRingV2 {
  /** Winding sign for the minor spherical region containing the vertex mean. */
  readonly interiorWindingSign: -1 | 1;
}

class CaoFoundationPublicationResource implements OwnedPrototypeResources {
  private disposed = false;
  private scrubAgeMa: number;

  constructor(
    readonly group: THREE.Group,
    readonly byteLength: number,
    readonly paletteEntries: number,
    readonly activeSourceBytes: number,
    readonly materialCorrectionIdentity: string | null,
    public materialCorrections: PreparedCaoRevision["materialCorrections"],
    readonly chartPoses: Float32Array,
    readonly chartActive: Uint8Array,
    private readonly publishedNativeBoundarySegments: number,
    private readonly publishedNativeBoundarySourceAgeMa: number | null,
    private readonly nativeBoundaryObject: THREE.Object3D | null,
    private readonly publishedTopologyOwnership: CaoTopologyOwnershipState | null,
    private readonly palette: THREE.DataTexture,
    private readonly materials: readonly THREE.Material[],
    private readonly displayFractions: readonly UniformNode<"float", number>[],
    private readonly verticalExaggerations: readonly UniformNode<"float", number>[],
    private readonly publicationGeometries: readonly THREE.BufferGeometry[],
    private readonly lineGraphs: readonly CaoFoundationLineMaterialGraph[],
    private readonly retirement: GpuRetirementOwner,
    initialAgeMa: number,
  ) {
    this.scrubAgeMa = initialAgeMa;
  }

  /**
   * Loads one outline tone table into every country-line material, or restores
   * the all-dark table with `null`. Uploads only where the bytes change.
   */
  setCountryLineToneTable(texels: Uint8Array | null): void {
    for (const graph of this.lineGraphs) graph.setCountryLineToneTable(texels);
  }

  outlineToneCounts(): CaoFoundationOutlineToneCounts {
    let darkSegments = 0;
    let lightSegments = 0;
    for (const graph of this.lineGraphs) {
      const counts = graph.toneCounts();
      darkSegments += counts.darkSegments;
      lightSegments += counts.lightSegments;
    }
    return Object.freeze({ darkSegments, lightSegments });
  }

  get requestedAgeMa(): number {
    return this.scrubAgeMa;
  }

  get nativeBoundarySegments(): number {
    return this.publishedNativeBoundarySourceAgeMa === this.scrubAgeMa
      ? this.publishedNativeBoundarySegments : 0;
  }

  get nativeBoundarySourceAgeMa(): number | null {
    return this.publishedNativeBoundarySourceAgeMa === this.scrubAgeMa
      ? this.publishedNativeBoundarySourceAgeMa : null;
  }

  get topologyOwnership(): CaoTopologyOwnershipState | null {
    return this.publishedTopologyOwnership?.sourceAgeMa === this.scrubAgeMa
      ? this.publishedTopologyOwnership : null;
  }

  disposeUnsubmitted(): void {
    this.dispose();
  }

  setVerticalExaggeration(value: number): void {
    for (const exaggeration of this.verticalExaggerations) exaggeration.value = value;
  }

  /**
   * Suppresses native land where palaeo-coastline charts replace it. Every other
   * class keeps its mode-independent visibility, so a hidden overlay layer is
   * not resurrected by a mode change.
   */
  setPalaeoCoastlineMode(on: boolean): void {
    for (const child of this.group.children) {
      const surfaceClass = child.userData.surfaceClass as CaoFoundationSurfaceClass | undefined;
      if (surfaceClass === undefined) continue;
      const shell = caoFoundationSurfaceShell(surfaceClass);
      child.visible = on ? shell.visibleInPalaeoMode : shell.visibleInNativeMode;
    }
  }

  setNativeBoundaryLayerVisibility(visible: boolean): void {
    if (this.nativeBoundaryObject) {
      this.nativeBoundaryObject.visible = visible
        && this.publishedNativeBoundarySourceAgeMa === this.scrubAgeMa;
    }
  }

  retargetMotion(
    packed: PackedCaoPalette,
    displayFraction: number,
    chartPoses: Float32Array,
    chartActive: Uint8Array,
    requestedAgeMa: number,
    materialCorrections: PreparedCaoRevision["materialCorrections"],
  ): void {
    if (this.disposed) throw new Error("Cao foundation publication is disposed");
    if (packed.entryCount !== this.paletteEntries || packed.width !== this.palette.image.width
        || packed.height !== this.palette.image.height
        || chartPoses.length !== this.chartPoses.length || chartActive.length !== this.chartActive.length
        || !Number.isFinite(displayFraction) || displayFraction < 0 || displayFraction > 1
        || !Number.isFinite(requestedAgeMa) || requestedAgeMa < 0) {
      throw new Error("Cao motion retarget shape mismatch");
    }
    const image = this.palette.image as { data: Float32Array; width: number; height: number };
    if (!(image.data instanceof Float32Array) || image.data.length !== packed.data.length) {
      throw new Error("Cao palette texture storage mismatch");
    }
    image.data.set(packed.data);
    this.palette.needsUpdate = true;
    this.chartPoses.set(chartPoses);
    this.chartActive.set(chartActive);
    this.materialCorrections = materialCorrections;
    for (const fraction of this.displayFractions) fraction.value = displayFraction;
    this.scrubAgeMa = requestedAgeMa;
    if (this.nativeBoundaryObject) {
      this.nativeBoundaryObject.visible = this.publishedNativeBoundarySourceAgeMa === requestedAgeMa;
    }
  }

  identifyTopology(direction: UnitDirection): InstantaneousOwnershipResult | null {
    return identifyCaoTopologyOwnership(this.topologyOwnership, direction);
  }

  retireAfterGpuWork(): Promise<void> {
    return this.retirement.retire(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.materials.forEach((material) => material.dispose());
    this.publicationGeometries.forEach((geometry) => geometry.dispose());
    this.lineGraphs.forEach((graph) => graph.toneTexture.dispose());
    this.palette.dispose();
    this.group.clear();
  }
}

const NATIVE_BOUNDARY_COLORS: Readonly<Record<NativeBoundaryKind, number>> = Object.freeze({
  ridge: 0xffb05c, subduction: 0xff7662, transform: 0x6ccbd0, other: 0xb8b2a5,
});

/**
 * Publication bytes the outline tone textures cost: one R8 texel per segment,
 * padded to the sampling width. Counted rather than assumed because the
 * publication ledger is a hard bound and this is the only per-publication
 * texture besides the palette.
 */
function estimateCountryLineToneTextureBytes(revision: PreparedCaoRevision): number {
  return revision.lineBatches.reduce((sum, batch) => safeAdd(sum,
    palaeoOutlineToneTextureRows(batch.segmentCount) * PALAEO_OUTLINE_TONE_TEXTURE_WIDTH,
    "Cao outline tone texture"), 0);
}

function estimateNativeBoundaryBufferBytes(revision: PreparedCaoRevision): number {
  if (revision.nativeBoundary.kind !== "exact-source") return 0;
  const value = revision.nativeBoundary.value;
  let segmentPairs = 0;
  for (const segment of value.segments) {
    if (!Number.isSafeInteger(segment.pointCount) || segment.pointCount < 2) {
      throw new Error("Cao native boundary segment is invalid");
    }
    segmentPairs = safeAdd(segmentPairs, segment.pointCount - 1, "Cao native boundary segment");
  }
  // Account the lease copy concurrently with the renderer position/color
  // arrays so publication cannot exceed its bound during conversion.
  return safeAdd(value.pointCount * 9 * Float32Array.BYTES_PER_ELEMENT,
    segmentPairs * 2 * Uint32Array.BYTES_PER_ELEMENT, "Cao native boundary buffer");
}

function estimateTopologyOwnershipBytes(revision: PreparedCaoRevision): number {
  if (revision.topologyOwnership.kind !== "exact-source") return 0;
  const value = revision.topologyOwnership.value;
  const metadataBytes = new TextEncoder().encode(JSON.stringify(value.rings)).byteLength;
  return safeAdd(safeAdd(value.pointCount * 3 * Float32Array.BYTES_PER_ELEMENT,
    metadataBytes, "Cao topology ownership"), value.rings.length * Float64Array.BYTES_PER_ELEMENT,
  "Cao topology ownership");
}

function createNativeBoundaryObject(revision: PreparedCaoRevision): Readonly<{
  object: THREE.LineSegments | null;
  geometry: THREE.BufferGeometry | null;
  material: LineBasicNodeMaterial | null;
  trackedBytes: number;
  segmentCount: number;
  sourceAgeMa: number | null;
}> {
  if (revision.nativeBoundary.kind !== "exact-source") {
    return Object.freeze({ object: null, geometry: null, material: null,
      trackedBytes: 0, segmentCount: 0, sourceAgeMa: null });
  }
  const layer = revision.nativeBoundary;
  const value = layer.value;
  const source = value.createDirectionsCopy();
  if (source.length !== value.pointCount * 3 || !allFinite(source)) {
    throw new Error("Cao native boundary point copy is invalid");
  }
  const positions = new Float32Array(source.length);
  const colors = new Float32Array(source.length);
  let segmentPairs = 0;
  for (const segment of value.segments) segmentPairs += segment.pointCount - 1;
  const indices = new Uint32Array(segmentPairs * 2);
  const radius = 1 + CAO_FOUNDATION_BOUNDARY_LINE_OFFSET_METRES / EARTH_RADIUS_METRES;
  let indexCursor = 0;
  let expectedPointOffset = 0;
  for (const segment of value.segments) {
    if (segment.pointOffset !== expectedPointOffset || segment.pointCount < 2
        || segment.pointOffset + segment.pointCount > value.pointCount) {
      throw new Error("Cao native boundary ranges are invalid");
    }
    const color = new THREE.Color(NATIVE_BOUNDARY_COLORS[segment.kind]);
    for (let local = 0; local < segment.pointCount; local += 1) {
      const point = segment.pointOffset + local;
      const offset = point * 3;
      const direction: UnitDirection = [source[offset]!, source[offset + 1]!, source[offset + 2]!];
      if (Math.abs(Math.hypot(...direction) - 1) > 2e-6) {
        throw new Error("Cao native boundary direction must be unit length");
      }
      const renderer = gplatesToRendererDirection(numberScalarOps, direction);
      positions.set(renderer.map((value_) => value_ * radius), offset);
      colors.set([color.r, color.g, color.b], offset);
      if (local + 1 < segment.pointCount) {
        indices[indexCursor++] = point;
        indices[indexCursor++] = point + 1;
      }
    }
    expectedPointOffset += segment.pointCount;
  }
  if (expectedPointOffset !== value.pointCount || indexCursor !== indices.length) {
    throw new Error("Cao native boundary coverage is incomplete");
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  const material = new LineBasicNodeMaterial({ vertexColors: true, transparent: true,
    opacity: 0.86, depthTest: true, depthWrite: false });
  const object = new THREE.LineSegments(geometry, material);
  object.renderOrder = 4;
  object.userData.overlayLayer = "tectonics";
  object.userData.evidence = "cao-native-exact-source";
  const trackedBytes = safeAdd(positions.byteLength + colors.byteLength,
    indices.byteLength, "Cao native boundary buffer");
  return Object.freeze({ object, geometry, material, trackedBytes,
    segmentCount: value.segments.length, sourceAgeMa: layer.sourceAgeMa });
}

function createTopologyOwnershipState(revision: PreparedCaoRevision): CaoTopologyOwnershipState | null {
  if (revision.topologyOwnership.kind !== "exact-source") return null;
  const layer = revision.topologyOwnership;
  const source = layer.value.createDirectionsCopy();
  if (source.length !== layer.value.pointCount * 3 || !allFinite(source)) {
    throw new Error("Cao topology ownership point copy is invalid");
  }
  let expectedOffset = 0;
  const rings = layer.value.rings.map((ring): CaoTopologyOwnershipRing => {
    if (ring.pointOffset !== expectedOffset || !Number.isSafeInteger(ring.pointCount)
        || ring.pointCount < 3 || ring.pointOffset + ring.pointCount > layer.value.pointCount) {
      throw new Error("Cao topology ownership ranges are invalid");
    }
    expectedOffset += ring.pointCount;
    return Object.freeze({ ...ring, candidatePlateIds: Object.freeze([...ring.candidatePlateIds]),
      interiorWindingSign: sphericalRingMinorRegionSign(source, ring.pointOffset, ring.pointCount) });
  });
  if (expectedOffset !== layer.value.pointCount) {
    throw new Error("Cao topology ownership coverage is incomplete");
  }
  for (let point = 0; point < layer.value.pointCount; point += 1) {
    const offset = point * 3;
    if (Math.abs(Math.hypot(source[offset]!, source[offset + 1]!, source[offset + 2]!) - 1) > 2e-6) {
      throw new Error("Cao topology ownership direction must be unit length");
    }
  }
  const metadataBytes = new TextEncoder().encode(JSON.stringify(layer.value.rings)).byteLength;
  return Object.freeze({ sourceAgeMa: layer.sourceAgeMa, directions: source,
    rings: Object.freeze(rings), byteLength: safeAdd(safeAdd(source.byteLength, metadataBytes,
      "Cao topology ownership"), rings.length * Float64Array.BYTES_PER_ELEMENT,
    "Cao topology ownership") });
}

function sphericalRingMinorRegionSign(
  directions: Float32Array,
  offset: number,
  count: number,
): -1 | 1 {
  const references: readonly UnitDirection[] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  let reference = references[0]!;
  let bestAntipodalMargin = -Infinity;
  for (const candidate of references) {
    let margin = Infinity;
    for (let local = 0; local < count; local += 1) {
      const pointOffset = (offset + local) * 3;
      margin = Math.min(margin, 1 + candidate[0] * directions[pointOffset]!
        + candidate[1] * directions[pointOffset + 1]!
        + candidate[2] * directions[pointOffset + 2]!);
    }
    if (margin > bestAntipodalMargin) {
      reference = candidate;
      bestAntipodalMargin = margin;
    }
  }
  let signedArea = 0;
  for (let local = 0; local < count; local += 1) {
    const aOffset = (offset + local) * 3;
    const bOffset = (offset + (local + 1) % count) * 3;
    const ax = directions[aOffset]!;
    const ay = directions[aOffset + 1]!;
    const az = directions[aOffset + 2]!;
    const bx = directions[bOffset]!;
    const by = directions[bOffset + 1]!;
    const bz = directions[bOffset + 2]!;
    const determinant = reference[0] * (ay * bz - az * by)
      + reference[1] * (az * bx - ax * bz)
      + reference[2] * (ax * by - ay * bx);
    const denominator = 1 + reference[0] * ax + reference[1] * ay + reference[2] * az
      + ax * bx + ay * by + az * bz
      + bx * reference[0] + by * reference[1] + bz * reference[2];
    signedArea += 2 * Math.atan2(determinant, denominator);
  }
  while (signedArea > 2 * Math.PI) signedArea -= 4 * Math.PI;
  while (signedArea <= -2 * Math.PI) signedArea += 4 * Math.PI;
  if (!Number.isFinite(signedArea) || Math.abs(signedArea) < 1e-10) {
    throw new Error("Cao topology ownership ring has indeterminate spherical area");
  }
  return signedArea < 0 ? -1 : 1;
}

function sphericalRingWinding(
  point: UnitDirection,
  directions: Float32Array,
  offset: number,
  count: number,
): number | null {
  let winding = 0;
  for (let local = 0; local < count; local += 1) {
    const aOffset = (offset + local) * 3;
    const bOffset = (offset + (local + 1) % count) * 3;
    const a: UnitDirection = [directions[aOffset]!, directions[aOffset + 1]!, directions[aOffset + 2]!];
    const b: UnitDirection = [directions[bOffset]!, directions[bOffset + 1]!, directions[bOffset + 2]!];
    const aDot = a[0] * point[0] + a[1] * point[1] + a[2] * point[2];
    const bDot = b[0] * point[0] + b[1] * point[1] + b[2] * point[2];
    const ax = a[0] - point[0] * aDot;
    const ay = a[1] - point[1] * aDot;
    const az = a[2] - point[2] * aDot;
    const bx = b[0] - point[0] * bDot;
    const by = b[1] - point[1] * bDot;
    const bz = b[2] - point[2] * bDot;
    const aLength = Math.hypot(ax, ay, az);
    const bLength = Math.hypot(bx, by, bz);
    if (aLength < 1e-10 || bLength < 1e-10) return null;
    const anx = ax / aLength;
    const any = ay / aLength;
    const anz = az / aLength;
    const bnx = bx / bLength;
    const bny = by / bLength;
    const bnz = bz / bLength;
    const crossDot = point[0] * (any * bnz - anz * bny)
      + point[1] * (anz * bnx - anx * bnz)
      + point[2] * (anx * bny - any * bnx);
    winding += Math.atan2(crossDot, anx * bnx + any * bny + anz * bnz);
  }
  return winding;
}

function sphericalRingContains(
  point: UnitDirection,
  directions: Float32Array,
  ring: CaoTopologyOwnershipRing,
): boolean {
  const winding = sphericalRingWinding(point, directions, ring.pointOffset, ring.pointCount);
  return winding === null || (Math.abs(winding) > Math.PI
    && Math.sign(winding) === ring.interiorWindingSign);
}

function identifyCaoTopologyOwnership(
  state: CaoTopologyOwnershipState | null,
  rendererDirection: UnitDirection,
): InstantaneousOwnershipResult | null {
  if (state === null) return null;
  const length = Math.hypot(...rendererDirection);
  if (!allFinite(rendererDirection) || Math.abs(length - 1) > 2e-6) {
    throw new Error("Cao topology query direction must be unit length");
  }
  const point = rendererToGplatesDirection(numberScalarOps, rendererDirection);
  const byPolygon = new Map<string, CaoTopologyOwnershipRing[]>();
  for (const ring of state.rings) {
    const values = byPolygon.get(ring.polygonId) ?? [];
    values.push(ring);
    byPolygon.set(ring.polygonId, values);
  }
  const matches: CaoTopologyOwnershipRing[] = [];
  for (const rings of byPolygon.values()) {
    const exterior = rings.find((ring) => ring.ringRole === "exterior");
    if (!exterior || !sphericalRingContains(point, state.directions, exterior)) continue;
    if (rings.some((ring) => ring.ringRole === "hole"
      && sphericalRingContains(point, state.directions, ring))) continue;
    matches.push(exterior);
  }
  if (matches.length === 0) return null;
  const candidates = [...new Set(matches.flatMap((ring) => ring.plateId === null
    ? [...ring.candidatePlateIds] : [ring.plateId]))];
  const resolved = matches.find((ring) => ring.status === "instantaneous-owner" && ring.plateId !== null);
  if (matches.length === 1 && resolved?.plateId !== null && resolved !== undefined) {
    return Object.freeze({ kind: "instantaneous-owner", plateId: resolved.plateId,
      topologyId: resolved.topologyId, sourceAgeMa: state.sourceAgeMa });
  }
  if (candidates.length > 0) {
    return Object.freeze({ kind: "ambiguous", candidatePlateIds: Object.freeze(candidates),
      sourceAgeMa: state.sourceAgeMa });
  }
  return Object.freeze({ kind: "unknown", sourceAgeMa: state.sourceAgeMa });
}

function createChartPickState(revision: PreparedCaoRevision): {
  chartPoses: Float32Array;
  chartActive: Uint8Array;
} {
  const chartPoses = new Float32Array(revision.charts.length * 8);
  const chartActive = new Uint8Array(revision.charts.length);
  for (let chartIndex = 0; chartIndex < revision.charts.length; chartIndex += 1) {
    const chart = revision.charts[chartIndex]!;
    if (!allFinite(chart.poseQuaternion) || !allFinite(chart.inversePoseQuaternion)
        || Math.abs(Math.hypot(...chart.poseQuaternion) - 1) > 2e-6
        || Math.abs(Math.hypot(...chart.inversePoseQuaternion) - 1) > 2e-6) {
      throw new Error("Cao prepared chart pose is invalid");
    }
    chartPoses.set(chart.poseQuaternion, chartIndex * 8);
    chartPoses.set(chart.inversePoseQuaternion, chartIndex * 8 + 4);
    chartActive[chartIndex] = chart.support.kind === "supported" ? 1 : 0;
  }
  return { chartPoses, chartActive };
}

function createPublicationResource(
  revision: PreparedCaoRevision,
  geometry: CaoFoundationGeometryResource,
  packed: PackedCaoPalette,
  verticalExaggeration: number,
  retirement: GpuRetirementOwner,
  palaeoCoastlineMode: boolean,
): CaoFoundationPublicationResource {
  const paletteTexture = createCaoFoundationPaletteTexture(packed);
  const materials: THREE.Material[] = [];
  const displayFractions: UniformNode<"float", number>[] = [];
  const verticalExaggerations: UniformNode<"float", number>[] = [];
  const publicationGeometries: THREE.BufferGeometry[] = [];
  const lineGraphs: CaoFoundationLineMaterialGraph[] = [];
  const group = new THREE.Group();
  group.name = `cao-foundation:${revision.identity}`;
  try {
    for (let index = 0; index < geometry.batches.length; index += 1) {
      const batch = geometry.batches[index]!;
      const prepared = revision.batches[index];
      if (!prepared || prepared.batchId !== batch.batchId) throw new Error("Cao batch order/identity changed");
      const display = prepared.createDisplayControlsCopy();
      if (display.displayHeightStart.kind !== "uniform" || display.displayHeightEnd.kind !== "uniform"
          || display.baseColor.kind !== "uniform") {
        throw new Error("Cao foundation v1 requires uniform placeholder height/color controls");
      }
      const shell = caoFoundationSurfaceShell(batch.surfaceClass);
      const shellOffset = shell.shellOffsetMetres;
      // The country outlines no longer depth test, so nothing stops a lifted
      // surface shell from drawing over them. This guard is what replaces the
      // depth buffer: the tallest shell the display controls can reach at the
      // relief ceiling must stay below the outline shell. The package format
      // admits a nonzero display height, so a package that starts using one
      // must fail here rather than silently bury the outlines.
      if (caoFoundationMaxDisplayedShellMetres(display.displayHeightStart.value,
        display.displayHeightEnd.value, shellOffset)
          >= CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES) {
        throw new Error("Cao display height would lift the surface through the country-line shell");
      }
      const graph = createCaoFoundationMaterial(paletteTexture, packed.width, display,
        revision.display.fraction, verticalExaggeration, shellOffset, batch.appearance);
      materials.push(graph.material);
      displayFractions.push(graph.displayFraction);
      verticalExaggerations.push(graph.verticalExaggeration);
      const mesh = new THREE.Mesh(batch.geometry, graph.material);
      // Source batches do not yet carry qualified moving interval bounds.
      // Drawing all foundation batches preserves coverage until those arrive.
      mesh.frustumCulled = false;
      graph.material.depthTest = true;
      // Two classes deliberately do not write depth: corrections, and palaeo
      // shallow marine, whose shells are 100 m apart and cannot clear a 242.59 m
      // chord sag. Render order alone separates them.
      graph.material.depthWrite = shell.writesDepth;
      // Ascending precedence: shelf, palaeo shallow marine, corrections, palaeo
      // land, palaeo mountain, native land.
      mesh.renderOrder = shell.renderOrder;
      mesh.userData.surfaceClass = batch.surfaceClass;
      mesh.visible = palaeoCoastlineMode ? shell.visibleInPalaeoMode : shell.visibleInNativeMode;
      group.add(mesh);
    }
    for (let index = 0; index < geometry.lineBatches.length; index += 1) {
      const batch = geometry.lineBatches[index]!;
      const prepared = revision.lineBatches[index];
      if (!prepared || prepared.batchId !== batch.batchId) {
        throw new Error("Cao country line batch order/identity changed");
      }
      // One draw for the whole overlay: every segment's quad, shaded from its
      // own coverage. There is no second contrast pass to compose with.
      const graph = createCaoFoundationCountryLineMaterial(paletteTexture, packed.width,
        revision.display.fraction, batch.segmentCount);
      materials.push(graph.material);
      lineGraphs.push(graph);
      displayFractions.push(graph.displayFraction);
      const lines = new THREE.Mesh(batch.geometry, graph.material);
      lines.frustumCulled = false;
      lines.renderOrder = 4;
      lines.userData.overlayLayer = "borders";
      lines.userData.evidence = "modern-country-reference-reconstructed-with-cao";
      group.add(lines);
    }
    const nativeBoundary = createNativeBoundaryObject(revision);
    if (nativeBoundary.object !== null && nativeBoundary.geometry !== null
        && nativeBoundary.material !== null) {
      group.add(nativeBoundary.object);
      publicationGeometries.push(nativeBoundary.geometry);
      materials.push(nativeBoundary.material);
    }
    const topologyOwnership = createTopologyOwnershipState(revision);
    const pickState = createChartPickState(revision);
    const byteLength = safeAdd(safeAdd(safeAdd(safeAdd(packed.data.byteLength,
      pickState.chartPoses.byteLength + pickState.chartActive.byteLength, "Cao publication"),
    nativeBoundary.trackedBytes, "Cao publication"), topologyOwnership?.byteLength ?? 0,
    "Cao publication"), estimateCountryLineToneTextureBytes(revision), "Cao publication");
    return new CaoFoundationPublicationResource(group, byteLength,
      packed.entryCount, revision.activeSourceBytes,
      revision.materialCorrectionIdentity, revision.materialCorrections,
      pickState.chartPoses, pickState.chartActive,
      nativeBoundary.segmentCount, nativeBoundary.sourceAgeMa,
      nativeBoundary.object, topologyOwnership,
      paletteTexture, Object.freeze(materials), Object.freeze(displayFractions),
      Object.freeze(verticalExaggerations),
      Object.freeze(publicationGeometries), Object.freeze(lineGraphs),
      retirement, revision.requestedAgeMa);
  } catch (error) {
    materials.forEach((material) => material.dispose());
    publicationGeometries.forEach((geometry_) => geometry_.dispose());
    lineGraphs.forEach((graph) => graph.toneTexture.dispose());
    paletteTexture.dispose();
    group.clear();
    throw error;
  }
}

function rayIntersectsBounds(
  origin: Vec3Tuple,
  direction: Vec3Tuple,
  bounds: Float32Array,
  offset: number,
): boolean {
  let near = 0;
  let far = Infinity;
  for (let axis = 0; axis < 3; axis += 1) {
    const minimum = bounds[offset + axis]!;
    const maximum = bounds[offset + 3 + axis]!;
    if (Math.abs(direction[axis]) < 1e-15) {
      if (origin[axis] < minimum || origin[axis] > maximum) return false;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (minimum - origin[axis]) * inverse;
    let second = (maximum - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (far < near) return false;
  }
  return far >= 0;
}

function tupleAt(values: Float32Array, offset: number): Vec3Tuple {
  return [values[offset]!, values[offset + 1]!, values[offset + 2]!];
}

function firstOpaqueGlobeIntersectionDistance(origin: Vec3Tuple, direction: Vec3Tuple): number | null {
  const projection = origin[0] * direction[0] + origin[1] * direction[1] + origin[2] * direction[2];
  const offset = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - 1;
  const discriminant = projection * projection - offset;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const first = -projection - root;
  if (first >= 0) return first;
  const second = -projection + root;
  return second >= 0 ? second : null;
}

/**
 * Slack added to a chart's vertex bounding box before the exact test. The box
 * bounds triangle vertices, but a point on the sphere at shell radius bulges
 * outside the chord they span, so a surface point just inside a chart can fall
 * marginally outside its box. 1e-4 of an Earth radius is about 640 m, far below
 * a chart and safely above that bulge; it only ever adds a triangle test.
 */
const CAO_FOUNDATION_COVERAGE_BOUNDS_EPSILON = 1e-4;

export interface CaoFoundationCoverageOptions {
  /**
   * Narrow the question to these drawing classes. Takes precedence over
   * `includeShelf`; an unknown class is rejected rather than ignored.
   */
  readonly surfaceClasses?: readonly CaoFoundationSurfaceClass[];
  /**
   * Working alias kept for callers that only ask "is this land, rather than
   * water of any depth". `false` selects the land-like classes, which is what
   * the guide-label ink and the lake-void probes have always meant by it;
   * omitted or `true` accepts every class, matching picking.
   */
  readonly includeShelf?: boolean;
  /**
   * Which frame `direction` is given in. `renderer` is the drawn position at
   * the requested age and is what picking and the guide-label ink use.
   * `chart-reference` is the present-day WGS84 direction every Cao chart and
   * every palaeo piece stores its geometry at, so it answers "what class does
   * this map draw over this piece of present-day ground", which is the question
   * the compiled witness table asks. Both walk the same triangles; the only
   * difference is whether the chart's own pose is undone first.
   */
  readonly directionFrame?: "renderer" | "chart-reference";
}

export function caoFoundationSurfaceClassSelection(
  options: CaoFoundationCoverageOptions,
): ReadonlySet<CaoFoundationSurfaceClass> {
  if (options.surfaceClasses !== undefined) {
    for (const surfaceClass of options.surfaceClasses) caoFoundationSurfaceShell(surfaceClass);
    return new Set(options.surfaceClasses);
  }
  return new Set(options.includeShelf === false
    ? CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES : CAO_FOUNDATION_SURFACE_PRECEDENCE);
}
/** Radial start height and accepted hit range for the exact coverage test. */
const CAO_FOUNDATION_COVERAGE_RAY_MARGIN = 0.05;

function pointInsideBounds(
  x: number,
  y: number,
  z: number,
  bounds: Float32Array,
  offset: number,
  epsilon: number,
): boolean {
  return x >= bounds[offset]! - epsilon && x <= bounds[offset + 3]! + epsilon
    && y >= bounds[offset + 1]! - epsilon && y <= bounds[offset + 4]! + epsilon
    && z >= bounds[offset + 2]! - epsilon && z <= bounds[offset + 5]! + epsilon;
}

/**
 * Whether any active chart covers a direction — the cheap coverage question,
 * without the nearest-hit bookkeeping a pick needs.
 *
 * A pick ray crosses the whole globe, so it must triangle-test every chart
 * whose box it clips, including the far side. A direction is a point, so the
 * box test here prunes to the handful of charts that actually contain it and
 * the exact triangle pass runs only for those: the cost is O(active charts)
 * plus a few triangle tests. Batch precedence does not apply — any covering
 * chart answers true — and an inactive chart (a plate not yet born at the
 * requested age) is skipped exactly as the pick path skips it.
 *
 * `includeShelf: false` narrows the question to charts drawn with the land
 * appearance, which is what a caller keying off "is this land, or water of any
 * depth" needs. It does not change picking.
 */
export function caoFoundationSurfaceCoversDirection(
  geometry: CaoFoundationGeometryResource,
  publication: CaoFoundationPickState,
  rendererDirection: Vec3Tuple,
  options: CaoFoundationCoverageOptions = {},
): boolean {
  const selected = caoFoundationSurfaceClassSelection(options);
  const length = Math.hypot(...rendererDirection);
  if (!rendererDirection.every(Number.isFinite) || !(length > 1e-12)) {
    throw new Error("Cao coverage direction must be finite and non-zero");
  }
  const unit = rendererDirection.map((value) => value / length) as unknown as Vec3Tuple;
  const chartReference = options.directionFrame === "chart-reference";
  const [gx, gy, gz] = chartReference ? unit : rendererToGplatesDirection(numberScalarOps, unit);
  const poses = publication.chartPoses;
  for (const batch of geometry.batches) {
    if (!selected.has(batch.surfaceClass)) continue;
    const shellRadius = 1 + batch.shellOffsetMetres / EARTH_RADIUS_METRES;
    for (let rangeOffset = 0, boundsOffset = 0;
      rangeOffset < batch.chartRanges.length; rangeOffset += 4, boundsOffset += 6) {
      const chartIndex = batch.chartRanges[rangeOffset]!;
      if (publication.chartActive[chartIndex] !== 1) continue;
      // A chart-reference direction is already in the frame the triangles are
      // stored in; only a renderer direction has to have this chart's pose undone.
      let sx = gx;
      let sy = gy;
      let sz = gz;
      if (!chartReference) {
        const poseOffset = chartIndex * 8;
        // rotateDirection inlined on scalars: this runs once per active chart
        // per probe, where the generic ops indirection and its array allocation
        // dominated the whole classification round.
        const w = poses[poseOffset + 4]!;
        const qx = poses[poseOffset + 5]!;
        const qy = poses[poseOffset + 6]!;
        const qz = poses[poseOffset + 7]!;
        const tx = 2 * (qy * gz - qz * gy);
        const ty = 2 * (qz * gx - qx * gz);
        const tz = 2 * (qx * gy - qy * gx);
        sx = gx + w * tx + (qy * tz - qz * ty);
        sy = gy + w * ty + (qz * tx - qx * tz);
        sz = gz + w * tz + (qx * ty - qy * tx);
      }
      if (!pointInsideBounds(sx * shellRadius, sy * shellRadius, sz * shellRadius,
        batch.chartBounds, boundsOffset, CAO_FOUNDATION_COVERAGE_BOUNDS_EPSILON)) continue;
      // Boxes overlap between neighbouring charts, so confirm against the
      // triangles with a radial ray from just above this batch's shell.
      const margin = CAO_FOUNDATION_COVERAGE_RAY_MARGIN;
      const start = shellRadius + margin;
      const origin = [sx * start, sy * start, sz * start] as unknown as Vec3Tuple;
      const inward = [-sx, -sy, -sz] as unknown as Vec3Tuple;
      const firstTriangle = batch.chartRanges[rangeOffset + 1]!;
      const triangleCount = batch.chartRanges[rangeOffset + 2]!;
      for (let triangle = firstTriangle; triangle < firstTriangle + triangleCount; triangle += 1) {
        const vertices = [0, 1, 2].map((corner) => {
          const vertex = batch.source.indices[triangle * 3 + corner]!;
          const direction = tupleAt(batch.source.referenceDirections, vertex * 3);
          return direction.map((value) => value * shellRadius) as unknown as Vec3Tuple;
        }) as unknown as readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple];
        const hit = intersectRayTriangle(origin, inward, vertices[0], vertices[1], vertices[2]);
        // Only the near crossing counts; the far side of the shell is 2 R away.
        if (hit !== null && hit.distance <= margin * 2) return true;
      }
    }
  }
  return false;
}

/**
 * Which stack a pick walks. `native` is the Cao 2024 composition; `palaeo`
 * hides native land, because the palaeo-coastline mode replaces it, and ranks
 * the palaeo classes into the precedence table.
 */
export type CaoFoundationSurfaceMode = "native" | "palaeo";

export function caoFoundationSurfaceClassVisible(
  surfaceClass: CaoFoundationSurfaceClass,
  mode: CaoFoundationSurfaceMode,
): boolean {
  const shell = caoFoundationSurfaceShell(surfaceClass);
  return mode === "palaeo" ? shell.visibleInPalaeoMode : shell.visibleInNativeMode;
}

export function intersectCaoFoundationSurface(
  geometry: CaoFoundationGeometryResource,
  publication: CaoFoundationPickState,
  rayOrigin: Vec3Tuple,
  rawRayDirection: Vec3Tuple,
  maximumTestedTriangles = 65_536,
  mode: CaoFoundationSurfaceMode = "native",
): CaoFoundationSurfaceHit | null {
  if (![...rayOrigin, ...rawRayDirection].every(Number.isFinite)) {
    throw new Error("Cao sparse picking ray must be finite");
  }
  const rayLength = Math.hypot(...rawRayDirection);
  if (!(rayLength > 1e-12) || !Number.isSafeInteger(maximumTestedTriangles)
      || maximumTestedTriangles < 1) {
    throw new Error("Cao sparse picking ray or triangle bound is invalid");
  }
  const rayDirection = rawRayDirection.map((value) => value / rayLength) as unknown as Vec3Tuple;
  const gplatesOrigin = rendererToGplatesDirection(numberScalarOps, rayOrigin);
  const gplatesDirection = rendererToGplatesDirection(numberScalarOps, rayDirection);
  let testedTriangles = 0;
  // Nearest hit per drawing class; the precedence table, not the walk order,
  // decides which one the caller sees.
  const nearestByClass = new Map<CaoFoundationSurfaceClass, CaoFoundationSurfaceHit>();
  for (const batch of geometry.batches) {
    if (!caoFoundationSurfaceClassVisible(batch.surfaceClass, mode)) continue;
    const shellRadius = 1 + batch.shellOffsetMetres / EARTH_RADIUS_METRES;
    for (let rangeOffset = 0, boundsOffset = 0;
      rangeOffset < batch.chartRanges.length; rangeOffset += 4, boundsOffset += 6) {
      const chartIndex = batch.chartRanges[rangeOffset]!;
      if (publication.chartActive[chartIndex] !== 1) continue;
      const poseOffset = chartIndex * 8;
      const pose = publication.chartPoses.subarray(poseOffset, poseOffset + 4) as unknown as QuaternionWxyz;
      const inversePose = publication.chartPoses.subarray(poseOffset + 4, poseOffset + 8) as unknown as QuaternionWxyz;
      const sourceOrigin = rotateDirection(numberScalarOps, inversePose, gplatesOrigin);
      const sourceDirection = rotateDirection(numberScalarOps, inversePose, gplatesDirection);
      const opaqueGlobeDistance = firstOpaqueGlobeIntersectionDistance(sourceOrigin, sourceDirection);
      if (!rayIntersectsBounds(sourceOrigin, sourceDirection, batch.chartBounds, boundsOffset)) continue;
      const firstTriangle = batch.chartRanges[rangeOffset + 1]!;
      const triangleCount = batch.chartRanges[rangeOffset + 2]!;
      testedTriangles += triangleCount;
      if (testedTriangles > maximumTestedTriangles) return null;
      for (let triangle = firstTriangle; triangle < firstTriangle + triangleCount; triangle += 1) {
        const vertices = [0, 1, 2].map((corner) => {
          const vertex = batch.source.indices[triangle * 3 + corner]!;
          const direction = tupleAt(batch.source.referenceDirections, vertex * 3);
          return direction.map((value) => value * shellRadius) as unknown as Vec3Tuple;
        }) as unknown as readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple];
        const hit = intersectRayTriangle(sourceOrigin, sourceDirection,
          vertices[0], vertices[1], vertices[2]);
        const visibleBeforeOpaqueGlobe = hit && (opaqueGlobeDistance === null
          || hit.distance <= opaqueGlobeDistance + 1e-7);
        const nearest = nearestByClass.get(batch.surfaceClass) ?? null;
        if (!hit || !visibleBeforeOpaqueGlobe || (nearest !== null && hit.distance >= nearest.distance)) continue;
        const posed = rotateDirection(numberScalarOps, pose, hit.position);
        const rendererPosition = gplatesToRendererDirection(numberScalarOps, posed);
        const chart = geometry.chartIdentities[chartIndex]!;
        const length = Math.hypot(...hit.position);
        const referenceDirection: UnitDirection = [
          hit.position[0] / length,
          hit.position[1] / length,
          hit.position[2] / length,
        ];
        const candidate = { batchId: batch.batchId, surfaceClass: batch.surfaceClass,
          chartIndex, triangleIndex: triangle,
          distance: hit.distance, position: rendererPosition,
          materialAddress: Object.freeze({ ...chart, cellOrTriangleId: 0,
            localCoordinate: Object.freeze({ kind: "chart-direction" as const,
              directionAtReference: Object.freeze([...referenceDirection]) as UnitDirection }) }) };
        nearestByClass.set(batch.surfaceClass, candidate);
      }
    }
  }
  return caoFoundationHighestPrecedenceHit([...nearestByClass.values()]);
}

/**
 * The winner among per-class candidates: the highest precedence rank, and the
 * nearer hit only where two candidates share a rank.
 */
export function caoFoundationHighestPrecedenceHit(
  candidates: readonly CaoFoundationSurfaceHit[],
): CaoFoundationSurfaceHit | null {
  let best: CaoFoundationSurfaceHit | null = null;
  let bestRank = -1;
  for (const candidate of candidates) {
    const rank = CAO_FOUNDATION_SURFACE_PRECEDENCE.indexOf(candidate.surfaceClass);
    if (rank < 0) throw new Error("unknown Cao foundation surface class");
    if (rank > bestRank || (rank === bestRank && best !== null && candidate.distance < best.distance)) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}

export interface CaoFoundationLayerVisibility {
  readonly borders: boolean;
  readonly tectonics: boolean;
  readonly palaeoCoastlines: boolean;
}

export interface CaoFoundationRendererOptions {
  /**
   * Whether this instance may swap its static geometry. The native instance
   * must not: one Cao package ships one geometry for the whole session, and a
   * key change there is a compile or loader defect. The palaeo instance streams
   * one map interval at a time, so replacement is its normal path — but only
   * after `armStaticGeometryChange` has named the reason, so an unexpected key
   * change still fails loudly.
   */
  readonly allowStaticGeometryReplacement?: boolean;
  /**
   * Owner that retires a replaced static geometry after the renderer's
   * submitted work. Required whenever replacement is allowed: disposing the
   * buffers inline can destroy a buffer the last submission still references.
   */
  readonly staticGeometryRetirement?: GpuRetirementOwner;
}

/** The read-only surface view a composite coverage or pick query consumes. */
export interface CaoFoundationSurfaceView {
  readonly geometry: CaoFoundationGeometryResource;
  readonly publication: CaoFoundationPickState;
}

/**
 * Owns one Cao surface stack. Static source geometry is copied once per
 * geometry key; requested ages replace only a bounded palette/material
 * publication.
 */
export class CaoFoundationSurfaceRenderer {
  private readonly publisher = new AtomicPrototypePublisher<CaoFoundationPublicationResource>();
  private staticGeometry: CaoFoundationGeometryResource | null = null;
  private disposed = false;
  private domainVisible = true;
  private palaeoCoastlineMode = false;
  private countryLineToneTable: Uint8Array | null = null;
  private armedStaticGeometryChange: string | null = null;
  private readonly allowStaticGeometryReplacement: boolean;
  private readonly staticGeometryRetirement: GpuRetirementOwner | null;

  constructor(
    private readonly parent: THREE.Group,
    private readonly retirement: GpuRetirementOwner,
    private readonly limits: CaoFoundationLimits,
    options: CaoFoundationRendererOptions = {},
  ) {
    this.allowStaticGeometryReplacement = options.allowStaticGeometryReplacement === true;
    this.staticGeometryRetirement = options.staticGeometryRetirement ?? null;
    if (this.allowStaticGeometryReplacement && this.staticGeometryRetirement === null) {
      throw new Error("Cao static geometry replacement requires a retirement owner");
    }
  }

  /**
   * Declares that the next publication is expected to carry a different static
   * geometry, and why. Consumed by exactly one replacement.
   */
  armStaticGeometryChange(reason: string): void {
    if (!this.allowStaticGeometryReplacement) {
      throw new Error("Cao foundation renderer does not allow static geometry replacement");
    }
    if (!reason) throw new Error("Cao static geometry change requires a reason");
    this.armedStaticGeometryChange = reason;
  }

  publish(revision: PreparedCaoRevision, verticalExaggeration: number): CaoFoundationDiagnostics {
    if (this.disposed) throw new Error("Cao foundation renderer is disposed");
    if (!Number.isFinite(revision.requestedAgeMa) || revision.requestedAgeMa < 0) {
      revision.release();
      throw new Error("Cao foundation requested age is invalid");
    }
    const token = this.publisher.begin(revision.identity);
    let resource: CaoFoundationPublicationResource | null = null;
    // Set while a replacement geometry is built but not yet committed, so a
    // failure between the two can put the previous geometry back instead of
    // stranding it: the still-visible publication's meshes reference it.
    let uncommittedReplacement: CaoFoundationGeometryResource | null = null;
    try {
      const reservation = estimateCaoFoundationGeometryReservation(revision, this.limits);
      const expectedStaticKey = `${revision.packageId}@${revision.packageRevision}:${[
        ...revision.batches.map((batch) => batch.staticGeometryIdentity),
        ...revision.lineBatches.map((batch) => batch.staticGeometryIdentity),
      ].join("|")}`;
      let retiredStaticGeometry: CaoFoundationGeometryResource | null = null;
      if (!this.staticGeometry || this.staticGeometry.key !== expectedStaticKey) {
        if (this.staticGeometry && !(this.allowStaticGeometryReplacement
            && this.armedStaticGeometryChange !== null)) {
          throw new Error("Cao foundation static geometry changed within renderer lifetime");
        }
        const replaced = this.staticGeometry;
        const next = createCaoFoundationGeometryResource(revision, this.limits);
        if (next.byteLength > reservation) {
          next.dispose();
          throw new Error("Cao static geometry reservation mismatch");
        }
        this.staticGeometry = next;
        retiredStaticGeometry = replaced;
        uncommittedReplacement = replaced;
      }
      const packed = packPreparedCaoPalette(revision, this.limits.maxTextureSize);
      const publicationBytes = safeAdd(safeAdd(safeAdd(safeAdd(packed.data.byteLength,
        revision.charts.length * (8 * Float32Array.BYTES_PER_ELEMENT + Uint8Array.BYTES_PER_ELEMENT),
        "Cao publication"), estimateNativeBoundaryBufferBytes(revision), "Cao publication"),
      estimateTopologyOwnershipBytes(revision), "Cao publication"),
      estimateCountryLineToneTextureBytes(revision), "Cao publication");
      if (!Number.isSafeInteger(this.limits.maxPublicationBytes) || this.limits.maxPublicationBytes < 1
          || publicationBytes > this.limits.maxPublicationBytes - this.publisher.retainedBytes()) {
        throw new Error("Cao foundation palette publication exceeds limit");
      }
      const previous = this.publisher.current();
      if (previous && (this.retirement.pendingCount() + 1 > this.retirement.maxPendingResources
          || this.retirement.pendingBytes() + previous.resources.byteLength > this.retirement.maxPendingBytes)) {
        throw new Error("Cao foundation GPU retirement backpressure bound exceeded");
      }
      resource = createPublicationResource(revision, this.staticGeometry, packed,
        verticalExaggeration, this.retirement, this.palaeoCoastlineMode);
      // A publication is built with the all-dark table, so the retained one has
      // to be reapplied before the group is shown: otherwise every scrub sample
      // would flash the outline back to a single ink for one frame.
      resource.setCountryLineToneTable(this.countryLineToneTable);
      if (!this.publisher.stage(token, revision.requestedAgeMa, "settled", resource)) {
        throw new Error("Cao foundation publication became stale");
      }
      this.parent.add(resource.group);
      const publication = this.publisher.commit(token);
      if (!publication) {
        this.parent.remove(resource.group);
        throw new Error("Cao foundation publication commit failed");
      }
      if (previous) this.parent.remove(previous.resources.group);
      this.domainVisible = true;
      resource = null;
      // Exactly one retirement per replacement, and only once the new geometry
      // is the committed publication's own.
      if (retiredStaticGeometry !== null) {
        uncommittedReplacement = null;
        this.armedStaticGeometryChange = null;
        void this.staticGeometryRetirement!.retire({
          byteLength: retiredStaticGeometry.byteLength,
          dispose: () => retiredStaticGeometry!.dispose(),
        });
      }
      revision.release();
      return this.diagnostics();
    } catch (error) {
      resource?.disposeUnsubmitted();
      if (uncommittedReplacement !== null) {
        this.staticGeometry?.dispose();
        this.staticGeometry = uncommittedReplacement;
      }
      revision.release();
      throw error;
    }
  }

  diagnostics(): CaoFoundationDiagnostics {
    const current = this.publisher.current();
    const batches = this.staticGeometry?.batches ?? [];
    return Object.freeze({
      identity: current?.requestId ?? null,
      staticGeometryIdentity: this.staticGeometry?.key ?? null,
      materialCorrectionIdentity: current?.resources.materialCorrectionIdentity ?? null,
      materialCorrections: current?.resources.materialCorrections ?? Object.freeze({
        observedActiveCharts: 0,
        classifiedShallowMarineActiveCharts: 0,
        qualifiedActiveCharts: 0,
        uncertainActiveCharts: 0,
        formationUncertainActiveCharts: 0,
        modelInferredPoseActiveCharts: 0,
        overriddenNativeCharts: 0,
        activeSourceIds: Object.freeze([]),
        correctionIds: Object.freeze([]),
      }),
      requestedAgeMa: current?.resources.requestedAgeMa ?? current?.ageMa ?? null,
      batches: batches.length,
      vertices: batches.reduce((sum, batch) => sum + batch.vertexCount, 0),
      triangles: batches.reduce((sum, batch) => sum + batch.triangleCount, 0),
      chartRanges: batches.reduce((sum, batch) => sum + batch.chartRanges.length / 4, 0),
      palaeoCoastlineMode: this.palaeoCoastlineMode,
      drawCount: this.domainVisible
        ? current?.resources.group.children.filter((child) => child.visible).length ?? 0 : 0,
      countryLineBatches: this.staticGeometry?.lineBatches.length ?? 0,
      countryLineVertices: this.staticGeometry?.lineBatches.reduce(
        (sum, batch) => sum + batch.vertexCount, 0) ?? 0,
      countryLineSegments: this.staticGeometry?.lineBatches.reduce(
        (sum, batch) => sum + batch.segmentCount, 0) ?? 0,
      countryLineToneDarkSegments: current?.resources.outlineToneCounts().darkSegments ?? 0,
      countryLineToneLightSegments: current?.resources.outlineToneCounts().lightSegments ?? 0,
      nativeBoundarySegments: this.domainVisible ? current?.resources.nativeBoundarySegments ?? 0 : 0,
      nativeBoundarySourceAgeMa: this.domainVisible ? current?.resources.nativeBoundarySourceAgeMa ?? null : null,
      topologyOwnershipRings: this.domainVisible ? current?.resources.topologyOwnership?.rings.length ?? 0 : 0,
      topologyOwnershipSourceAgeMa: this.domainVisible
        ? current?.resources.topologyOwnership?.sourceAgeMa ?? null : null,
      retainedStaticBytes: this.staticGeometry?.byteLength ?? 0,
      activeSourceBytes: current?.resources.activeSourceBytes ?? 0,
      retainedPublicationBytes: this.publisher.retainedBytes(),
      pendingRetirementBytes: this.retirement.pendingBytes(),
      paletteEntries: current?.resources.paletteEntries ?? 0,
      shellOffsetMetres: CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES,
    });
  }

  intersectRay(
    rayOrigin: Vec3Tuple,
    rayDirection: Vec3Tuple,
    maximumTestedTriangles = 65_536,
  ): CaoFoundationSurfaceHit | null {
    const view = this.surfaceView();
    if (view === null) return null;
    return intersectCaoFoundationSurface(view.geometry, view.publication,
      rayOrigin, rayDirection, maximumTestedTriangles, this.surfaceMode());
  }

  surfaceMode(): CaoFoundationSurfaceMode {
    return this.palaeoCoastlineMode ? "palaeo" : "native";
  }

  /**
   * The surface currently on screen, or null when the domain is hidden or
   * nothing is published — the same condition `intersectRay` answers null on.
   * Exposed so the composite can rank two instances against one precedence
   * table instead of each answering in isolation.
   */
  surfaceView(): CaoFoundationSurfaceView | null {
    const current = this.publisher.current();
    if (!this.domainVisible || !this.staticGeometry || !current) return null;
    return { geometry: this.staticGeometry, publication: current.resources };
  }

  /**
   * Whether the surface currently on screen covers this direction with land,
   * shelf or correction material. Read-only and allocation-light; returns false
   * whenever the domain is hidden or nothing is published, matching intersectRay.
   */
  coversDirection(
    rendererDirection: UnitDirection,
    options: CaoFoundationCoverageOptions = {},
  ): boolean {
    const view = this.surfaceView();
    if (view === null) return false;
    return caoFoundationSurfaceCoversDirection(view.geometry, view.publication,
      [...rendererDirection] as unknown as Vec3Tuple, options);
  }

  identifyTopology(rendererDirection: UnitDirection): InstantaneousOwnershipResult | null {
    const current = this.publisher.current();
    return this.domainVisible ? current?.resources.identifyTopology(rendererDirection) ?? null : null;
  }

  setDomainVisibility(visible: boolean): CaoFoundationDiagnostics {
    this.domainVisible = visible;
    const current = this.publisher.current();
    if (current) current.resources.group.visible = visible;
    return this.diagnostics();
  }

  setLayerVisibility(layers: CaoFoundationLayerVisibility): void {
    this.setPalaeoCoastlineMode(layers.palaeoCoastlines);
    const current = this.publisher.current();
    if (!current) return;
    for (const child of current.resources.group.children) {
      if (child.userData.overlayLayer === "borders") child.visible = layers.borders;
      if (child.userData.overlayLayer === "tectonics") child.visible = layers.tectonics;
    }
    current.resources.setNativeBoundaryLayerVisibility(layers.tectonics);
  }

  /**
   * Loads the outline tone table for the active Cao 2017 map interval, or
   * clears it with `null`. The table is retained so the next publication — a
   * scrub sample or a map-interval swap — keeps the same tones.
   */
  setCountryLineToneTable(texels: Uint8Array | null): CaoFoundationOutlineToneCounts {
    this.countryLineToneTable = texels;
    this.publisher.current()?.resources.setCountryLineToneTable(texels);
    return this.countryLineToneCounts();
  }

  /**
   * Tones the resident table resolves to. Separate from `diagnostics()` because
   * the frame loop reports these every frame and the full record costs several
   * reductions over the batch tables to build.
   */
  countryLineToneCounts(): CaoFoundationOutlineToneCounts {
    return this.publisher.current()?.resources.outlineToneCounts()
      ?? Object.freeze({ darkSegments: 0, lightSegments: 0 });
  }

  /**
   * Suppresses native land in favour of palaeo-coastline charts, and switches
   * this instance's pick and coverage answers to the palaeo precedence stack.
   */
  setPalaeoCoastlineMode(on: boolean): CaoFoundationDiagnostics {
    this.palaeoCoastlineMode = on;
    this.publisher.current()?.resources.setPalaeoCoastlineMode(on);
    return this.diagnostics();
  }

  /**
   * Continuous scrub path: update the resident palette/poses/display fraction
   * without tearing down static geometry or blanking the globe.
   */
  retargetMotion(
    paletteValues: Float32Array,
    entryCount: number,
    displayFraction: number,
    chartPoses: Float32Array,
    chartActive: Uint8Array,
    requestedAgeMa: number,
    materialCorrections: PreparedCaoRevision["materialCorrections"],
  ): CaoFoundationDiagnostics {
    if (this.disposed) throw new Error("Cao foundation renderer is disposed");
    const current = this.publisher.current();
    if (!current) throw new Error("Cao foundation has no published surface to retarget");
    const packed = packCaoPaletteValues(paletteValues, entryCount, this.limits.maxTextureSize);
    current.resources.retargetMotion(
      packed, displayFraction, chartPoses, chartActive, requestedAgeMa, materialCorrections,
    );
    this.domainVisible = true;
    current.resources.group.visible = true;
    return this.diagnostics();
  }

  setVerticalExaggeration(value: number): void {
    if (!Number.isFinite(value) || value < 1 || value > 30) {
      throw new Error("Cao vertical exaggeration is outside the supported range");
    }
    this.publisher.current()?.resources.setVerticalExaggeration(value);
  }

  clear(): void {
    if (this.disposed) return;
    const current = this.publisher.current();
    if (current) this.parent.remove(current.resources.group);
    this.publisher.dispose();
  }

  /** Renderer loop must be stopped; backend teardown follows immediately. */
  disposeForRendererTeardown(): void {
    if (this.disposed) return;
    this.disposed = true;
    const current = this.publisher.current();
    if (current) this.parent.remove(current.resources.group);
    this.publisher.dispose();
    // The backend teardown immediately following this call owns the final GPU
    // release. Dispatching BufferGeometry.dispose() before that teardown can
    // destroy a buffer still referenced by the renderer's last submission.
    this.staticGeometry = null;
  }
}
