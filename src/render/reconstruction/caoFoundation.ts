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
import {
  POLYLINE_COUNTRY_SHELL_METRES,
  createPolylineMaterial,
  createPolylineQuadGeometry,
  polylineHalfWidthPx,
  polylinePadPx,
  polylineQuadBytes,
  POLYLINE_CULL_MARGIN_DEGREES,
  POLYLINE_DARK_INK,
  POLYLINE_DRAW_BUDGET,
  POLYLINE_FEATHER_DEVICE_PX,
  POLYLINE_GLOBE_OCCLUDER_RADIUS,
  POLYLINE_LIGHT_INK,
  POLYLINE_LIGHT_INK_STYLE,
  POLYLINE_MAX_CHORD_DEGREES,
  POLYLINE_QUAD_CORNERS,
  POLYLINE_QUAD_INDICES,
  POLYLINE_QUAD_INDICES_PER_SEGMENT,
  POLYLINE_QUAD_SEGMENT_BYTES,
  POLYLINE_QUAD_VERTICES_PER_SEGMENT,
  POLYLINE_WIDTH_CSS_PX,
  createPolylineToneTexture,
  type PolylineMaterialGraph,
  type PolylineToneCounts,
} from "./polyline";

/**
 * The country outline's own names for the shared polyline helper.
 *
 * `polyline.ts` owns the whole outline path — quad expansion, two-tone ink,
 * tone table, horizon terms — and takes the shell, ink and width as inputs so
 * the plate-boundary lines can move onto it next. These aliases keep the
 * renderer's and the callers' existing country-line vocabulary pointing at that
 * single owner.
 */
export {
  POLYLINE_CULL_MARGIN_DEGREES as CAO_FOUNDATION_COUNTRY_LINE_CULL_MARGIN_DEGREES,
  POLYLINE_DARK_INK as CAO_FOUNDATION_COUNTRY_LINE_DARK_INK,
  POLYLINE_DRAW_BUDGET as CAO_FOUNDATION_COUNTRY_LINE_DRAW_BUDGET,
  POLYLINE_FEATHER_DEVICE_PX as CAO_FOUNDATION_COUNTRY_LINE_FEATHER_DEVICE_PX,
  POLYLINE_GLOBE_OCCLUDER_RADIUS as CAO_FOUNDATION_GLOBE_OCCLUDER_RADIUS,
  POLYLINE_LIGHT_INK as CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK,
  POLYLINE_LIGHT_INK_STYLE as CAO_FOUNDATION_COUNTRY_LINE_LIGHT_INK_STYLE,
  POLYLINE_MAX_CHORD_DEGREES as CAO_FOUNDATION_COUNTRY_LINE_MAX_CHORD_DEGREES,
  POLYLINE_QUAD_CORNERS as CAO_FOUNDATION_COUNTRY_LINE_QUAD_CORNERS,
  POLYLINE_QUAD_INDICES as CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES,
  POLYLINE_QUAD_INDICES_PER_SEGMENT as CAO_FOUNDATION_COUNTRY_LINE_QUAD_INDICES_PER_SEGMENT,
  POLYLINE_QUAD_SEGMENT_BYTES as CAO_FOUNDATION_COUNTRY_LINE_QUAD_SEGMENT_BYTES,
  POLYLINE_QUAD_VERTICES_PER_SEGMENT as CAO_FOUNDATION_COUNTRY_LINE_QUAD_VERTICES_PER_SEGMENT,
  POLYLINE_WIDTH_CSS_PX as CAO_FOUNDATION_COUNTRY_LINE_WIDTH_CSS_PX,
  createPolylineToneTexture as createCaoFoundationCountryLineToneTexture,
  polylineHalfWidthPx as caoFoundationCountryLineHalfWidthPx,
  polylinePadPx as caoFoundationCountryLinePadPx,
  polylineQuadBytes as caoFoundationCountryLineQuadBytes,
  evaluatePolylineCoverage as evaluateCountryLineCoverage,
  evaluatePolylineHorizonLimitCos as evaluateCountryLineHorizonLimitCos,
  evaluatePolylineHorizonVisibility as evaluateCountryLineHorizonVisibility,
  evaluatePolylineQuadOffsetPx as evaluateCountryLineQuadOffsetPx,
  evaluatePolylineSegmentVisibility as evaluateCountryLineSegmentVisibility,
  type PolylineMaterialGraph as CaoFoundationLineMaterialGraph,
  type PolylineToneCounts as CaoFoundationOutlineToneCounts,
} from "./polyline";
import { intersectRayTriangle } from "./picking";
import type { Vec3Tuple } from "./bounds";

/** Display separation only; source physical height remains zero/unknown. */
export const CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES = 400;
export const CAO_FOUNDATION_PALAEO_SHALLOW_MARINE_SHELL_OFFSET_METRES = 700;
export const CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES = 800;
export const CAO_FOUNDATION_PALAEO_LAND_SHELL_OFFSET_METRES = 1_300;
export const CAO_FOUNDATION_PALAEO_MOUNTAIN_SHELL_OFFSET_METRES = 1_600;
export const CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES = POLYLINE_COUNTRY_SHELL_METRES;
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

/**
 * The appearance a class is *drawn* with in one mode, which is not always the
 * appearance its batch declares.
 *
 * `correction-shelf` is the single case. In the native mode it is crust of
 * unmapped depth beside the Cao 2024 shelf and carries the shelf's blue. In the
 * Cao 2017 band the native shelf is not drawn at all, so the same blue would be
 * the band's only crust level and would read as a mapped class the key does not
 * list; the restored margin is drawn there as submerged margin instead, in the
 * palaeo-shallow-marine colour, and the map key labels it model inference
 * rather than a mapped shallow sea. The class keeps its own rank and is still
 * absent from `CAO_FOUNDATION_LAND_LIKE_SURFACE_CLASSES`, so nothing reads it
 * as land in either mode.
 *
 * Both appearances are front-sided and share one roughness, so the swap is a
 * colour swap on a live material rather than a rebuilt one;
 * `createCaoFoundationMaterial` enforces that.
 */
export function caoFoundationSurfaceClassAppearance(
  surfaceClass: CaoFoundationSurfaceClass,
  appearance: CaoFoundationBatchAppearance,
  mode: CaoFoundationSurfaceMode,
): CaoFoundationBatchAppearance {
  return surfaceClass === "correction-shelf" && mode === "palaeo"
    ? "palaeo-shallow-marine" : appearance;
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
  // The Cao 2024 crust extent, "depth unmapped". It is today's composition and
  // stays in the native mode, but it is *not* a level of the Cao 2017 band: the
  // band draws exactly five — the deep-sea sphere, mapped shallow sea, mapped
  // land, mapped mountain and the country outlines — and a crust-blue wash
  // under the mapped shallow seas was a sixth level the map key could not
  // explain. Where the Cao 2017 map maps nothing, the globe sphere shows
  // through and unmapped ground reads as deep sea.
  Object.freeze({ surfaceClass: "shelf" as const,
    shellOffsetMetres: CAO_FOUNDATION_SHELF_SHELL_OFFSET_METRES,
    renderOrder: 1, writesDepth: true, visibleInNativeMode: true, visibleInPalaeoMode: false }),
  // Restored pre-collision margin crust. It shares the 700 m shell with
  // palaeo-shallow-marine and writes no depth, so the two are separated by draw
  // order alone and the shallow-marine class paints over it; the one
  // depth-writing class below, the native shelf at 400 m, is cleared by 457.41 m
  // wherever both are drawn, which is the native mode alone.
  //
  // In the Cao 2017 band it is drawn with the palaeo-shallow-marine appearance
  // rather than the shelf's crust blue — see
  // `caoFoundationSurfaceClassAppearance`. It is the only thing closing the
  // pre-collision seams the Cao 2017 charts leave open (the Alps at 45 Ma), and
  // with the shelf gone it would otherwise be the band's only crust-blue level.
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
  // Every mountain batch is also drawn once at the palaeo-land shell above,
  // under itself, because the two classes are node-reduced apart and their
  // shared coast is not a shared edge — see `createPalaeoLandUnderlayMesh`.
  // That underlay takes this row's shell, order and per-mode visibility, so no
  // class is added by it; it alone writes no depth, because it is the mountain's
  // own geometry and near the limb no depth buffer can keep the two apart.
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
 * outline/label ink `#d0d4d5` keeps a 5.7:1 luminance contrast over it, while
 * reading as a distinctly greener, brighter body of water than the 0.58-dimmed
 * shelf blue it sits on. 0.1.14 took 12 % out of it in linear light - `#14606b`
 * to `#12545e`, the same hue at 187.9 against 187.6 degrees - because the lit
 * teal read brighter on screen than a sea should. The 0.1.12 band model
 * (per-band light factors 1.0355 / 0.7970 / 0.5260, ACES at exposure 1.02, the
 * sRGB transfer) predicts the rendered tone moves 104,183,188 / 80,165,172 /
 * 46,135,142 to 93,174,180 / 70,156,163 / 39,125,132: still the brightest water
 * on the globe by 54 / 54 / 44 of luma over the dimmed shelf, and still over
 * the 95-luma floor `paintedSurfaceClasses` separates shallow sea from shelf
 * with (107.2 near the terminator, its tightest band).
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
  "palaeo-shallow-marine": Object.freeze([0x12 / 255, 0x54 / 255, 0x5e / 255] as const),
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
  /** The prepared batch's geometry identity; what a replacement is judged against. */
  readonly staticGeometryIdentity: string;
  /** Whether this batch may be replaced within the renderer's lifetime. */
  readonly staticGeometryReplaceable: boolean;
  readonly geometry: THREE.BufferGeometry;
  readonly source: PreparedCaoStaticGeometryCopy;
  /** Vertex and index buffer bytes this batch holds on the GPU. */
  readonly trackedGpuBytes: number;
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
  readonly staticGeometryIdentity: string;
  readonly staticGeometryReplaceable: boolean;
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
  /**
   * 0 draws the batch's native appearance, 1 the palaeo one. Present only for a
   * class whose drawn appearance depends on the mode — `correction-shelf` — and
   * null everywhere else, so a mode switch never touches a material that has
   * one appearance.
   */
  readonly palaeoAppearanceMix: UniformNode<"float", number> | null;
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
  palaeoAppearance: CaoFoundationBatchAppearance = appearance,
  palaeoAppearanceMixValue = 0,
): CaoFoundationMaterialGraph {
  // A mode-dependent appearance is a colour swap on one live material. Side and
  // roughness are baked into the material at construction, so a pair that
  // disagrees on either would need two materials and is refused here rather
  // than drawn with the wrong one in one of the two modes.
  if (palaeoAppearance !== appearance
      && (caoFoundationAppearanceFrontSideOnly(palaeoAppearance)
        !== caoFoundationAppearanceFrontSideOnly(appearance)
        || caoFoundationAppearanceRoughness(palaeoAppearance)
          !== caoFoundationAppearanceRoughness(appearance))) {
    throw new Error("Cao mode-dependent appearances must share side and roughness");
  }
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
  let palaeoAppearanceMix: UniformNode<"float", number> | null = null;
  if (display.baseColor.kind === "uniform") {
    const [r, g, b] = display.baseColor.value;
    const dim = caoFoundationAppearanceDim(appearance);
    const nativeColor = vec3(r * dim, g * dim, b * dim);
    if (palaeoAppearance === appearance) {
      material.colorNode = nativeColor;
    } else {
      // The batch's own package colour answers for its declared appearance; the
      // other appearance has no package colour on this batch, so it takes the
      // compiled default for that class — the same triple the palaeo compiler
      // emits — and the two levels read as one.
      const [pr, pg, pb] = CAO_FOUNDATION_DEFAULT_BASE_COLORS[palaeoAppearance];
      const palaeoDim = caoFoundationAppearanceDim(palaeoAppearance);
      palaeoAppearanceMix = uniform(palaeoAppearanceMixValue, "float");
      material.colorNode = mix(nativeColor,
        vec3(pr * palaeoDim, pg * palaeoDim, pb * palaeoDim), palaeoAppearanceMix);
    }
  } else {
    material.colorNode = attribute<"vec3">("color", "vec3");
  }
  return Object.freeze({ material, displayFraction: pose.displayFraction,
    verticalExaggeration: pose.verticalExaggeration, palaeoAppearanceMix });
}


/**
 * The modern-country reference overlay's binding of the shared polyline helper.
 *
 * Everything specific to this overlay lives here — the Cao motion palette the
 * endpoints are posed through, the two outline inks, the 1 800 m shell and the
 * one-CSS-pixel core — and `polyline.ts` owns the rest. The plate-boundary
 * lines (`boundary-*.ehnb`, 2 200 m, single ink) still build their own material
 * below; the helper is meant to take them next.
 */
export function createCaoFoundationCountryLineMaterial(
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  displayFractionValue: number,
  segmentCount: number,
): PolylineMaterialGraph {
  return createPolylineMaterial({
    segmentCount,
    displayFractionValue,
    shellMetres: CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES,
    widthPx: POLYLINE_WIDTH_CSS_PX,
    ink: { dark: POLYLINE_DARK_INK, light: POLYLINE_LIGHT_INK },
    pose: ({ reference, entry, displayFraction, verticalExaggeration, shellOffsetMetres }) =>
      evaluatePreparedCaoPose(paletteTexture, paletteWidth, displayFraction,
        verticalExaggeration, float(0), float(0), shellOffsetMetres, reference, entry),
  });
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
      batch.segmentCount * POLYLINE_QUAD_VERTICES_PER_SEGMENT, "Cao line vertex");
    triangles = safeAdd(triangles, batch.segmentCount * 2, "Cao line primitive");
    lineQuadBytes = safeAdd(lineQuadBytes,
      polylineQuadBytes(batch.segmentCount), "Cao line quad");
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
      resources.push(Object.freeze({ batchId: prepared.batchId,
        staticGeometryIdentity: prepared.staticGeometryIdentity,
        staticGeometryReplaceable: prepared.staticGeometryReplaceable === true, geometry, source,
        trackedGpuBytes: gpuBytes,
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
      const expanded = createPolylineQuadGeometry(source, prepared.segmentCount,
        CAO_FOUNDATION_COUNTRY_LINE_OFFSET_METRES);
      const geometry = expanded.geometry;
      trackedGpuBufferBytes = safeAdd(trackedGpuBufferBytes, expanded.gpuBytes, "Cao tracked line GPU");
      lineResources.push(Object.freeze({ batchId: prepared.batchId,
        staticGeometryIdentity: prepared.staticGeometryIdentity,
        staticGeometryReplaceable: prepared.staticGeometryReplaceable === true, geometry, source,
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
    private readonly lineGraphs: readonly PolylineMaterialGraph[],
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
    for (const graph of this.lineGraphs) graph.setToneTable(texels);
  }

  outlineToneCounts(): PolylineToneCounts {
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
   * Suppresses native land and the Cao 2024 crust shelf where the Cao 2017 map
   * replaces them, and repaints the one class whose appearance depends on the
   * mode. Every other class keeps its mode-independent visibility, so a hidden
   * overlay layer is not resurrected by a mode change.
   */
  setPalaeoCoastlineMode(on: boolean): void {
    for (const child of this.group.children) {
      const surfaceClass = child.userData.surfaceClass as CaoFoundationSurfaceClass | undefined;
      if (surfaceClass === undefined) continue;
      const shell = caoFoundationSurfaceShell(surfaceClass);
      child.visible = on ? shell.visibleInPalaeoMode : shell.visibleInNativeMode;
      const mix = child.userData.palaeoAppearanceMix as
        UniformNode<"float", number> | null | undefined;
      if (mix) mix.value = on ? 1 : 0;
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

/**
 * The mountain batch drawn a second time as land, underneath itself.
 *
 * The `m` and `lm` pieces are node-reduced independently offline, so the coast
 * they share does not come back as one shared edge: at the closest zoom a one
 * to two pixel sliver of the deep-sea sphere shows between a mountain polygon
 * and the land polygon it borders. Nothing may show through mapped land, and
 * the only ground certain to reach into that sliver is the mountain's own
 * geometry drawn once more at the land shell, in the land colour, under the
 * mountain that then paints over it.
 *
 * It shares the mountain's `BufferGeometry`, so it costs one draw call and zero
 * GPU bytes. It is not a new surface class: it declares `palaeo-land` and takes
 * that class's shell, draw order and per-mode visibility whole, which is also
 * why it appears and disappears in exactly the bands the mountain does. Picking
 * and coverage read the geometry batches rather than the meshes, so the
 * mountain still wins over land wherever both cover a direction.
 *
 * It is the one `palaeo-land` mesh that does *not* write depth, and that is the
 * whole of its difference from the class. The shell table's 242.59 m sag
 * clearance separates two different geometries; this mesh is the mountain's own
 * geometry 300 m under itself, and those 300 m are radial. Near the limb the
 * radial direction is almost perpendicular to the view, so the pair's
 * separation along the view ray collapses toward zero and the depth buffer
 * cannot resolve it: with both writing depth the underlay took pixels from the
 * mountain standing on it, and the tone census read mountain ground as
 * 158,114,76 near the terminator - the land olive pulling green 36 above the
 * recorded 142,78,53, in the band whose aims put that ground within 5 degrees
 * of the horizon. Writing no depth makes that impossible rather than unlikely:
 * the mountain then depth-tests against the deep-sea sphere alone, which it
 * clears at every angle, and the underlay survives only in pixels the mountain
 * does not cover - which is exactly the sliver it exists for. Nothing below it
 * needs its depth: in the palaeo mode, the only mode it is visible in, the one
 * class drawn after it is the mountain above it, and the country outlines do
 * not depth test at all.
 *
 * The colour uses the mode mix `correction-shelf` already uses: the batch's own
 * package colour answers for its declared mountain appearance, and the palaeo
 * mode mixes it to the compiled `palaeo-land` default, so the underlay reads as
 * the land level it stands in for.
 */
function createPalaeoLandUnderlayMesh(
  batch: CaoFoundationBatchResource,
  paletteTexture: THREE.DataTexture,
  paletteWidth: number,
  display: PreparedCaoDisplayControlsCopy,
  displayFractionValue: number,
  verticalExaggeration: number,
  palaeoCoastlineMode: boolean,
): Readonly<{ graph: CaoFoundationMaterialGraph; mesh: THREE.Mesh }> {
  const shell = caoFoundationSurfaceShell("palaeo-land");
  const graph = createCaoFoundationMaterial(paletteTexture, paletteWidth, display,
    displayFractionValue, verticalExaggeration, shell.shellOffsetMetres,
    batch.appearance, "palaeo-land", palaeoCoastlineMode ? 1 : 0);
  const mesh = new THREE.Mesh(batch.geometry, graph.material);
  mesh.frustumCulled = false;
  graph.material.depthTest = true;
  // Not `shell.writesDepth`: see above. The underlay must never win a depth
  // test against the mountain it stands under, and at the limb the two are
  // indistinguishable in depth.
  graph.material.depthWrite = false;
  mesh.renderOrder = shell.renderOrder;
  mesh.userData.surfaceClass = shell.surfaceClass;
  mesh.userData.palaeoAppearanceMix = graph.palaeoAppearanceMix;
  // The batch this stands under, so a reader of the group can tell the underlay
  // from the band's own land batches without comparing geometries.
  mesh.userData.palaeoLandUnderlayOf = batch.batchId;
  mesh.visible = palaeoCoastlineMode ? shell.visibleInPalaeoMode : shell.visibleInNativeMode;
  return Object.freeze({ graph, mesh });
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
  const lineGraphs: PolylineMaterialGraph[] = [];
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
        revision.display.fraction, verticalExaggeration, shellOffset, batch.appearance,
        caoFoundationSurfaceClassAppearance(batch.surfaceClass, batch.appearance, "palaeo"),
        palaeoCoastlineMode ? 1 : 0);
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
      // Held on the mesh the mode switch already walks, so no second registry
      // can drift out of step with the group it repaints.
      mesh.userData.palaeoAppearanceMix = graph.palaeoAppearanceMix;
      mesh.visible = palaeoCoastlineMode ? shell.visibleInPalaeoMode : shell.visibleInNativeMode;
      // A mountain batch is drawn twice: once as land below, to close the
      // hairline its independently reduced edge leaves against the land pieces,
      // and once as itself on top. The underlay is added first so the group
      // reads in draw order, which is also the order its render orders impose.
      if (batch.surfaceClass === "palaeo-mountain") {
        const underlay = createPalaeoLandUnderlayMesh(batch, paletteTexture, packed.width,
          display, revision.display.fraction, verticalExaggeration, palaeoCoastlineMode);
        materials.push(underlay.graph.material);
        displayFractions.push(underlay.graph.displayFraction);
        verticalExaggerations.push(underlay.graph.verticalExaggeration);
        group.add(underlay.mesh);
      }
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
   * Owner that retires a replaced static geometry after the renderer's
   * submitted work. Required before any batch is actually replaced: disposing
   * the buffers inline can destroy a buffer the last submission still
   * references. Whether a replacement may happen at all is a property of the
   * batches themselves — see `staticGeometryReplaceable` — not of the renderer.
   */
  readonly staticGeometryRetirement?: GpuRetirementOwner;
}

/**
 * Batch ids an incoming revision would replace that refuse replacement.
 *
 * One renderer now holds both the Cao 2024 stack and the Cao 2017 map interval,
 * so "may this geometry change?" is no longer a property of the instance: the
 * same publication carries `batch-land`, which ships once per session, beside
 * `palaeo-land`, which is streamed one interval at a time. A batch is judged
 * against the resident batch of the same id — added and removed ids count as
 * changes too, because a set that gains or loses a native batch mid-lifetime is
 * the same compile or loader defect the per-instance flag used to catch.
 */
export function caoFoundationRefusedStaticGeometryReplacements(
  resident: CaoFoundationGeometryResource,
  revision: PreparedCaoRevision,
): readonly string[] {
  const residentById = new Map<string, { identity: string; replaceable: boolean }>();
  for (const batch of [...resident.batches, ...resident.lineBatches]) {
    residentById.set(batch.batchId, { identity: batch.staticGeometryIdentity,
      replaceable: batch.staticGeometryReplaceable });
  }
  const refused: string[] = [];
  const incoming = new Set<string>();
  for (const batch of [...revision.batches, ...revision.lineBatches]) {
    incoming.add(batch.batchId);
    const replaceable = batch.staticGeometryReplaceable === true;
    const current = residentById.get(batch.batchId);
    if (current === undefined) {
      if (!replaceable) refused.push(batch.batchId);
      continue;
    }
    if (current.identity === batch.staticGeometryIdentity) continue;
    if (!current.replaceable || !replaceable) refused.push(batch.batchId);
  }
  for (const [batchId, current] of residentById) {
    if (!incoming.has(batchId) && !current.replaceable) refused.push(batchId);
  }
  return Object.freeze(refused);
}

/** One member of the surface set, as a coverage or pick query consumes it. */
export interface CaoFoundationSurfaceView {
  readonly geometry: CaoFoundationGeometryResource;
  readonly publication: CaoFoundationPickState;
  /**
   * The stack this member draws. It travels with the view so a set query needs
   * no per-instance argument: the member holding the Cao 2017 batches is read in
   * the palaeo mode whatever the Cao 2024 member is doing, which is exactly the
   * LGM band, where the lowstand shelf is drawn over today's land.
   */
  readonly mode: CaoFoundationSurfaceMode;
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
  private releasableSurfaceClasses: readonly CaoFoundationSurfaceClass[] = Object.freeze([]);
  /** Batch ids whose GPU buffers are currently released; their CPU source is retained. */
  private readonly releasedStaticGeometryBatches = new Set<string>();
  private readonly staticGeometryRetirement: GpuRetirementOwner | null;

  constructor(
    private readonly parent: THREE.Group,
    private readonly retirement: GpuRetirementOwner,
    private readonly limits: CaoFoundationLimits,
    options: CaoFoundationRendererOptions = {},
  ) {
    this.staticGeometryRetirement = options.staticGeometryRetirement ?? null;
  }

  /**
   * Declares that the next publication is expected to carry a different static
   * geometry, and why. Consumed by exactly one replacement.
   */
  armStaticGeometryChange(reason: string): void {
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
        if (this.staticGeometry) {
          if (this.armedStaticGeometryChange === null) {
            throw new Error("Cao foundation static geometry changed within renderer lifetime");
          }
          const refused = caoFoundationRefusedStaticGeometryReplacements(this.staticGeometry, revision);
          if (refused.length > 0) {
            throw new Error("Cao foundation renderer does not allow static geometry replacement: "
              + refused.join(", "));
          }
          if (this.staticGeometryRetirement === null) {
            throw new Error("Cao static geometry replacement requires a retirement owner");
          }
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
        // The incoming geometry carries its own buffers; whatever the outgoing
        // one had released is not a claim about them.
        this.releasedStaticGeometryBatches.clear();
      }
      // A batch built while its class is released must be released too, or
      // publishing inside the Cao 2017 band would silently re-upload it.
      this.applyReleasableSurfaceClasses();
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
   * The identity of the publication on screen, or null when nothing is
   * published. `diagnostics().identity` is the same answer; this one costs no
   * reductions over the batch tables, which is what lets the frame loop ask it
   * before it applies a composition.
   */
  publishedIdentity(): string | null {
    return this.publisher.current()?.requestId ?? null;
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
    return { geometry: this.staticGeometry, publication: current.resources, mode: this.surfaceMode() };
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
  setCountryLineToneTable(texels: Uint8Array | null): PolylineToneCounts {
    this.countryLineToneTable = texels;
    this.publisher.current()?.resources.setCountryLineToneTable(texels);
    return this.countryLineToneCounts();
  }

  /**
   * Tones the resident table resolves to. Separate from `diagnostics()` because
   * the frame loop reports these every frame and the full record costs several
   * reductions over the batch tables to build.
   */
  countryLineToneCounts(): PolylineToneCounts {
    return this.publisher.current()?.resources.outlineToneCounts()
      ?? Object.freeze({ darkSegments: 0, lightSegments: 0 });
  }

  /**
   * The D1 residency policy: the classes whose GPU buffers the composition
   * replaces outright, and whose vertex and index buffers are therefore handed
   * back for as long as it lasts.
   *
   * Only the GPU side is released. The CPU source copies stay — picking,
   * coverage and the guide-label ink read them, and reloading a package to come
   * back from a scrub across 402 Ma would cost far more than the buffers save.
   * Leaving the composition marks every attribute for upload again, so the
   * first frame that draws the class carries its buffers back.
   *
   * `resolveReleasableNativeSurfaceClasses` in `surfaceVisibility` is the only
   * intended caller: it refuses every composition but `realistic`, because the
   * LGM band draws the native stack under the lowstand overlay and a fallback
   * or still-loading age has nothing else on screen.
   */
  setReleasableSurfaceClasses(classes: readonly CaoFoundationSurfaceClass[]): void {
    if (this.disposed) throw new Error("Cao foundation renderer is disposed");
    this.releasableSurfaceClasses = Object.freeze([...classes]);
    this.applyReleasableSurfaceClasses();
  }

  /** The classes the composition allows releasing; see `setReleasableSurfaceClasses`. */
  get releasableNativeSurfaceClasses(): readonly CaoFoundationSurfaceClass[] {
    return this.releasableSurfaceClasses;
  }

  /** GPU bytes currently handed back under the release policy. */
  releasedStaticGpuBytes(): number {
    let bytes = 0;
    for (const batch of this.staticGeometry?.batches ?? []) {
      if (this.releasedStaticGeometryBatches.has(batch.batchId)) bytes += batch.trackedGpuBytes;
    }
    return bytes;
  }

  private applyReleasableSurfaceClasses(): void {
    const releasable = new Set(this.releasableSurfaceClasses);
    for (const batch of this.staticGeometry?.batches ?? []) {
      const released = this.releasedStaticGeometryBatches.has(batch.batchId);
      if (releasable.has(batch.surfaceClass)) {
        if (released) continue;
        // Frees the backend's vertex and index buffers and leaves the
        // attributes' arrays in place, which is what lets the same geometry be
        // drawn again without rebuilding it.
        batch.geometry.dispose();
        this.releasedStaticGeometryBatches.add(batch.batchId);
        continue;
      }
      if (!released) continue;
      for (const attribute of Object.values(batch.geometry.attributes)) {
        (attribute as THREE.BufferAttribute).needsUpdate = true;
      }
      if (batch.geometry.index) batch.geometry.index.needsUpdate = true;
      this.releasedStaticGeometryBatches.delete(batch.batchId);
    }
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
