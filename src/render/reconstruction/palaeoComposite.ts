import {
  CAO_FOUNDATION_SURFACE_PRECEDENCE,
  caoFoundationHighestPrecedenceHit,
  caoFoundationSurfaceClassSelection,
  caoFoundationSurfaceClassVisible,
  caoFoundationSurfaceCoversDirection,
  intersectCaoFoundationSurface,
  type CaoFoundationCoverageOptions,
  type CaoFoundationSurfaceClass,
  type CaoFoundationSurfaceHit,
  type CaoFoundationSurfaceMode,
  type CaoFoundationSurfaceView,
} from "./caoFoundation";
import type { Vec3Tuple } from "./bounds";

/**
 * Composite coverage and picking over the two surface instances the palaeo
 * mode runs: the native Cao 2024 stack (shelf, corrections and — mode off —
 * native land) and the palaeo stack (Cao 2017 land, shallow marine and
 * mountain charts). Both answer against one precedence table, so a correction
 * outranks a shallow sea no matter which instance drew it.
 */

export interface CaoCompositeOptions extends CaoFoundationCoverageOptions {
  /** Defaults to native, which ignores the palaeo instance entirely. */
  readonly mode?: CaoFoundationSurfaceMode;
}

export interface CaoCompositePickOptions extends CaoCompositeOptions {
  readonly maximumTestedTriangles?: number;
}

function selectionFor(
  options: CaoCompositeOptions,
  mode: CaoFoundationSurfaceMode,
): readonly CaoFoundationSurfaceClass[] {
  const selected = caoFoundationSurfaceClassSelection(options);
  // Mode visibility is the composite's own filter: the native instance still
  // holds `batch-land`, and answering "covered" from a surface the mode hides
  // would put dark label ink over a sea the viewer can see.
  return CAO_FOUNDATION_SURFACE_PRECEDENCE.filter((surfaceClass) =>
    selected.has(surfaceClass) && caoFoundationSurfaceClassVisible(surfaceClass, mode));
}

export function caoCompositeCoversDirection(
  native: CaoFoundationSurfaceView | null,
  palaeo: CaoFoundationSurfaceView | null,
  rendererDirection: Vec3Tuple,
  options: CaoCompositeOptions = {},
): boolean {
  const mode = options.mode ?? "native";
  const surfaceClasses = selectionFor(options, mode);
  if (surfaceClasses.length === 0) return false;
  const covers = (view: CaoFoundationSurfaceView | null) => view !== null
    && caoFoundationSurfaceCoversDirection(view.geometry, view.publication,
      rendererDirection, { surfaceClasses });
  if (covers(native)) return true;
  return mode === "palaeo" && covers(palaeo);
}

/**
 * Highest-precedence class covering one piece of present-day ground, or null.
 *
 * This is the on-screen form of the compiled witness table: the Western
 * Interior Seaway at 90 Ma is a question about the ground under present-day
 * (-100, 45), not about a screen position, and every chart on both instances
 * stores its geometry in present-day WGS84. It walks the same coverage path the
 * guide-label ink uses, one precedence class at a time, so the answer is the
 * class the viewer sees rather than whichever batch happened to be tested
 * first.
 */
export function caoCompositeReferenceSurfaceClass(
  native: CaoFoundationSurfaceView | null,
  palaeo: CaoFoundationSurfaceView | null,
  referenceDirection: Vec3Tuple,
  options: CaoCompositeOptions = {},
): CaoFoundationSurfaceClass | null {
  const mode = options.mode ?? "native";
  // `selectionFor` is ascending precedence; the answer is the class drawn last.
  for (const surfaceClass of [...selectionFor(options, mode)].reverse()) {
    const covered = (view: CaoFoundationSurfaceView | null) => view !== null
      && caoFoundationSurfaceCoversDirection(view.geometry, view.publication, referenceDirection,
        { surfaceClasses: [surfaceClass], directionFrame: "chart-reference" });
    if (covered(native) || (mode === "palaeo" && covered(palaeo))) return surfaceClass;
  }
  return null;
}

export function intersectCaoComposite(
  native: CaoFoundationSurfaceView | null,
  palaeo: CaoFoundationSurfaceView | null,
  rayOrigin: Vec3Tuple,
  rayDirection: Vec3Tuple,
  options: CaoCompositePickOptions = {},
): CaoFoundationSurfaceHit | null {
  const mode = options.mode ?? "native";
  const maximumTestedTriangles = options.maximumTestedTriangles ?? 65_536;
  const hits: CaoFoundationSurfaceHit[] = [];
  const views = mode === "palaeo" ? [native, palaeo] : [native];
  for (const view of views) {
    if (view === null) continue;
    const hit = intersectCaoFoundationSurface(view.geometry, view.publication,
      rayOrigin, rayDirection, maximumTestedTriangles, mode);
    if (hit !== null) hits.push(hit);
  }
  return caoFoundationHighestPrecedenceHit(hits);
}

/**
 * Ages the Cao 2017 palaeogeography maps cover: the 24 published intervals run
 * from 402 Ma to 2.01 Ma. Outside it — including the present day — the mode
 * falls back to today's composition with a map-key notice.
 */
export const CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA = Object.freeze({
  youngest: 2.01,
  oldest: 402,
} as const);

export function caoPalaeoCoastlineAgeInsideDomain(ageMa: number | null): boolean {
  return ageMa !== null && Number.isFinite(ageMa)
    && ageMa >= CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA.youngest
    && ageMa <= CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA.oldest;
}

export interface CaoPalaeoVisibilityState {
  /** Whether the palaeo domain is currently shown. */
  readonly visible: boolean;
  /** Frames the opposite answer has held without being applied yet. */
  readonly pendingFrames: number;
}

export const CAO_PALAEO_VISIBILITY_INITIAL_STATE: CaoPalaeoVisibilityState =
  Object.freeze({ visible: false, pendingFrames: 0 });

/**
 * One-frame hysteresis across the 2.01 and 402 Ma boundaries.
 *
 * A scrub that lands exactly on a boundary, or a continuous age that crosses it
 * and comes back within a frame, would otherwise blank and restore the palaeo
 * surface on consecutive frames and read as a rendering fault. Requiring the
 * new answer to hold for a second consecutive frame costs at most one frame of
 * latency at a real crossing and removes the flicker at a boundary the user is
 * hovering on. The counter resets whenever the requested answer agrees with
 * what is on screen, so the delay never accumulates.
 */
export function nextCaoPalaeoVisibilityState(
  previous: CaoPalaeoVisibilityState,
  insideDomain: boolean,
): CaoPalaeoVisibilityState {
  if (insideDomain === previous.visible) {
    return previous.pendingFrames === 0 ? previous
      : Object.freeze({ visible: previous.visible, pendingFrames: 0 });
  }
  if (previous.pendingFrames >= 1) {
    return Object.freeze({ visible: insideDomain, pendingFrames: 0 });
  }
  return Object.freeze({ visible: previous.visible, pendingFrames: previous.pendingFrames + 1 });
}

/**
 * What the palaeo-coastline layer resolves to on screen, as the map key and the
 * canvas diagnostics name it.
 *
 * `fallback` is an age with no Cao 2017 map interval — including the present
 * day — and `loading` an age inside the domain whose interval has not been
 * published yet.
 */
export type CaoPalaeoCoastlineMode = "off" | "fallback" | "loading" | "on";

export interface CaoPalaeoModeInputs {
  /** The `palaeoCoastlines` layer flag; what the viewer asked for. */
  readonly layerEnabled: boolean;
  readonly insideDomain: boolean;
  /** Palaeo domain visibility after `nextCaoPalaeoVisibilityState`. */
  readonly domainVisible: boolean;
  /** Whether the palaeo instance has a published interval on screen. */
  readonly published: boolean;
}

export interface CaoPalaeoModeState {
  readonly mode: CaoPalaeoCoastlineMode;
  /** Whether Cao 2017 charts are actually on screen this frame. */
  readonly palaeoDrawn: boolean;
  /**
   * The stack the native instance draws and answers picks from. It is the
   * effective mode, never the layer flag: `batch-land` may only be hidden while
   * palaeo charts are drawn over it, or a fallback age — 0 Ma, 500 Ma — would
   * lose today's land and leave bare shelf behind.
   */
  readonly nativeSurfaceMode: CaoFoundationSurfaceMode;
}

/**
 * Resolves the layer flag, the age domain, the hysteresis state and the
 * publication into one answer that the native visibility, the composite pick
 * and coverage, the guide-label ink and the reported mode all read.
 *
 * `palaeoDrawn` carries the same one-frame hysteresis as the fallback
 * transition, because it is `domainVisible` that carries it: native land is
 * therefore restored in the same frame the palaeo charts leave the screen, and
 * hidden in the same frame they arrive, with no frame showing neither.
 */
export function caoPalaeoModeState(inputs: CaoPalaeoModeInputs): CaoPalaeoModeState {
  const palaeoDrawn = inputs.layerEnabled && inputs.domainVisible && inputs.published;
  const mode: CaoPalaeoCoastlineMode = !inputs.layerEnabled ? "off"
    : !inputs.insideDomain ? "fallback"
      : palaeoDrawn ? "on" : "loading";
  return Object.freeze({ mode, palaeoDrawn,
    nativeSurfaceMode: palaeoDrawn ? "palaeo" : "native" });
}
