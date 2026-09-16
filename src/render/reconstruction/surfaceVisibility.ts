/**
 * One surface-visibility resolver for the native and realistic classes.
 *
 * Before this module the same question was answered by two state machines that
 * had to agree by hand: the native side flipped `setPalaeoCoastlineMode` from a
 * cached boolean in `GlobeScene`, while the palaeo side ran its own hysteresis
 * and mode machine. A composition is one answer, so it is resolved once here
 * and applied in one place; nothing downstream re-derives it.
 */

import {
  CAO_FOUNDATION_SURFACE_PRECEDENCE,
  caoFoundationSurfaceClassVisible,
  type CaoFoundationBatchAppearance,
  type CaoFoundationSurfaceClass,
  type CaoFoundationSurfaceMode,
} from "./caoFoundation";
import type { CaoPalaeoCoastlineMode, CaoPalaeoDomainBand } from "./palaeoComposite";
import { DEFAULT_SURFACE_RESIDENCY_POLICY,
  type SurfaceResidencyPolicy } from "../../reconstruction/loaderV2";

/**
 * The renderer slots a composition assigns. They are the drawing positions the
 * plan names, not classes: the same `land` slot carries the Cao 2024 coastline
 * fill in the native composition and the Cao 2017 `lm` batch in the realistic
 * one, which is what "the realistic data replaces the native data in the
 * renderer, nothing else" means.
 */
export interface SurfaceSlotComposition {
  /** Cao 2024 `batch-land`, or the Cao 2017 mapped land of the active interval. */
  readonly land: CaoFoundationSurfaceClass | null;
  /** Cao 2024 `batch-shelf` crust, or the Cao 2017 mapped shallow sea. */
  readonly continents: CaoFoundationSurfaceClass | null;
  /** Empty natively; the Cao 2017 `m` batch in the realistic composition. */
  readonly mountain: CaoFoundationSurfaceClass | null;
  /** Land-appearance material corrections; hidden wherever the Cao 2017 map replaces land. */
  readonly corrections: CaoFoundationSurfaceClass | null;
  /** Restored pre-collision margin crust: drawn in both, with two appearances. */
  readonly correctionShelf: CaoFoundationSurfaceClass;
  /** The appearance the restored margin is painted with in this composition. */
  readonly correctionShelfAppearance: CaoFoundationBatchAppearance;
  /**
   * The Natural Earth reference overlay. `two-tone` is the dark-over-land /
   * light-over-sea table a mapped palaeogeography earns; `dark-ink` is the one
   * ink today's composition uses.
   */
  readonly countryPolyline: "dark-ink" | "two-tone";
  /** Classes drawn *over* the slots rather than in them; only the LGM lowstand has any. */
  readonly overlay: readonly CaoFoundationSurfaceClass[];
}

/**
 * The three compositions the globe can be in. `realistic` is the Cao 2017 band,
 * where the mapped classes replace the native ones; `lgm` is the detached
 * lowstand, which keeps today's composition and draws three footprints of
 * exposed shelf over it; `native` is today's composition alone, which is also
 * what a fallback age and a loading interval show.
 */
export type SurfaceComposition = "native" | "realistic" | "lgm";

const NATIVE_SLOTS: SurfaceSlotComposition = Object.freeze({
  land: "land", continents: "shelf", mountain: null, corrections: "corrections",
  correctionShelf: "correction-shelf", correctionShelfAppearance: "shelf",
  countryPolyline: "dark-ink", overlay: Object.freeze([]),
} as const);

const REALISTIC_SLOTS: SurfaceSlotComposition = Object.freeze({
  land: "palaeo-land", continents: "palaeo-shallow-marine", mountain: "palaeo-mountain",
  corrections: null,
  correctionShelf: "correction-shelf", correctionShelfAppearance: "palaeo-shallow-marine",
  countryPolyline: "two-tone", overlay: Object.freeze([]),
} as const);

// The LGM band runs the native slots and adds the lowstand shells over them.
// Hiding today's land there would blank every coastline on Earth to show a
// little exposed shelf in the North Sea, the Sunda shelf and Beringia.
const LGM_SLOTS: SurfaceSlotComposition = Object.freeze({
  ...NATIVE_SLOTS,
  overlay: Object.freeze(["palaeo-shallow-marine", "palaeo-land", "palaeo-mountain"] as const),
} as const);

export function surfaceSlotComposition(composition: SurfaceComposition): SurfaceSlotComposition {
  return composition === "realistic" ? REALISTIC_SLOTS
    : composition === "lgm" ? LGM_SLOTS : NATIVE_SLOTS;
}

/**
 * The native classes a composition replaces outright, and whose GPU buffers the
 * residency policy therefore allows releasing until the composition is left.
 *
 * Only `realistic` qualifies. `lgm` draws the native stack underneath the
 * lowstand overlay, and `native` — which is also what a fallback age and a
 * still-loading interval show — has nothing else on screen: releasing there
 * would blank the globe rather than save memory. The knob exists so the cost
 * can be measured, and turning it off must leave every composition drawing the
 * same thing.
 *
 * P4 note: the renderer records this set and releases nothing. P5 wires the
 * release and the re-upload on exit into the resource set.
 */
export function resolveReleasableNativeSurfaceClasses(
  composition: SurfaceComposition,
  policy: SurfaceResidencyPolicy = DEFAULT_SURFACE_RESIDENCY_POLICY,
): readonly CaoFoundationSurfaceClass[] {
  if (!policy.releaseReplacedNativeGpuBuffers || composition !== "realistic") {
    return Object.freeze([]);
  }
  const slots = surfaceSlotComposition(composition);
  // The classes the realistic slots took over: today's land fill and the Cao
  // 2024 crust shelf. Read from the native slot table rather than listed again,
  // so a slot change cannot leave this claiming a class that is still drawn.
  const native = surfaceSlotComposition("native");
  return Object.freeze([native.land, native.continents].filter((surfaceClass):
    surfaceClass is CaoFoundationSurfaceClass => surfaceClass !== null
      && surfaceClass !== slots.land && surfaceClass !== slots.continents
      && !slots.overlay.includes(surfaceClass)));
}

function visibleClassesInMode(mode: CaoFoundationSurfaceMode): CaoFoundationSurfaceClass[] {
  return CAO_FOUNDATION_SURFACE_PRECEDENCE.filter((surfaceClass) =>
    caoFoundationSurfaceClassVisible(surfaceClass, mode));
}

/**
 * The classes on screen in each composition, in ascending precedence.
 *
 * Derived from the shell table rather than from the slot table above, so the
 * shell table stays the single source of truth for per-mode visibility and a
 * slot declaration cannot silently disagree with what is drawn; the unit test
 * asserts the two agree.
 *
 * `lgm` is the union because two instances draw at once there: the native one
 * in its own mode and the palaeo one carrying the lowstand shells.
 */
const COMPOSITION_CLASSES: Readonly<Record<SurfaceComposition, ReadonlySet<CaoFoundationSurfaceClass>>> =
  Object.freeze({
    native: Object.freeze(new Set(visibleClassesInMode("native"))),
    realistic: Object.freeze(new Set(visibleClassesInMode("palaeo"))),
    lgm: Object.freeze(new Set(CAO_FOUNDATION_SURFACE_PRECEDENCE.filter((surfaceClass) =>
      caoFoundationSurfaceClassVisible(surfaceClass, "native")
        || caoFoundationSurfaceClassVisible(surfaceClass, "palaeo")))),
  });

export interface SurfaceVisibilityHysteresis {
  /** Whether the palaeo domain is currently shown. */
  readonly visible: boolean;
  /**
   * The band on screen, which is not the band the requested age asks for while
   * the hysteresis is spending its frame. Native land keys off this one: the
   * frame that still draws Cao 2017 charts must still hide native land.
   */
  readonly band: CaoPalaeoDomainBand;
  /** Frames the opposite answer has held without being applied yet. */
  readonly pendingFrames: number;
}

export const SURFACE_VISIBILITY_INITIAL_HYSTERESIS: SurfaceVisibilityHysteresis =
  Object.freeze({ visible: false, band: "none", pendingFrames: 0 });

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
export function advanceSurfaceVisibilityHysteresis(
  previous: SurfaceVisibilityHysteresis,
  requestedBand: CaoPalaeoDomainBand,
): SurfaceVisibilityHysteresis {
  if (requestedBand === previous.band) {
    return previous.pendingFrames === 0 ? previous
      : Object.freeze({ visible: previous.visible, band: previous.band, pendingFrames: 0 });
  }
  if (previous.pendingFrames >= 1) {
    return Object.freeze({ visible: requestedBand !== "none", band: requestedBand,
      pendingFrames: 0 });
  }
  return Object.freeze({ visible: previous.visible, band: previous.band,
    pendingFrames: previous.pendingFrames + 1 });
}

export interface SurfaceVisibilityInput {
  /** The `palaeoCoastlines` layer flag; what the viewer asked for. */
  readonly layerEnabled: boolean;
  /** The band the requested age falls in; `none` is the fallback notice. */
  readonly band: CaoPalaeoDomainBand;
  /** Whether the palaeo instance has a published interval to draw. */
  readonly published: boolean;
  /** The hysteresis carried from the previous resolution. */
  readonly hysteresis: SurfaceVisibilityHysteresis;
  /**
   * Whether the surface is withheld — a failed or unavailable native
   * publication. A withheld surface asks for no band at all, so the domain
   * leaves the screen through the same hysteresis as a scrub across 402 Ma.
   */
  readonly surfaceWithheld?: boolean;
  /**
   * Only the frame loop advances the hysteresis. A layer toggle or a scrub
   * sample landing in the same frame must not spend its second frame and flip
   * the domain immediately.
   */
  readonly advanceHysteresis?: boolean;
}

export interface SurfaceVisibilityResolution {
  /** The band the requested age asks for, which is what the map key reports. */
  readonly band: CaoPalaeoDomainBand;
  readonly mode: CaoPalaeoCoastlineMode;
  /** Whether palaeo charts are actually on screen this frame. */
  readonly palaeoDrawn: boolean;
  /**
   * The stack the native instance draws and answers picks from. It is the
   * effective mode, never the layer flag: native land — `batch-land` and every
   * land-appearance correction with it — may only be hidden while palaeo charts
   * are drawn over it, or a fallback age — 0 Ma, 500 Ma — would lose today's
   * land and leave bare shelf behind.
   */
  readonly nativeSurfaceMode: CaoFoundationSurfaceMode;
  readonly composition: SurfaceComposition;
  /** The slot assignment of `composition`; see `SurfaceSlotComposition`. */
  readonly slots: SurfaceSlotComposition;
  /** Every class on screen this frame, in ascending precedence. */
  readonly visibleClasses: ReadonlySet<CaoFoundationSurfaceClass>;
  /** The hysteresis to carry into the next resolution. */
  readonly hysteresis: SurfaceVisibilityHysteresis;
}

/**
 * Resolves the layer flag, the age band, the hysteresis and the publication
 * into the one composition that the native visibility, the palaeo domain
 * visibility, the composite pick and coverage, the guide-label ink, the outline
 * tone table and the reported mode all read.
 *
 * `palaeoDrawn` carries the same one-frame hysteresis as the fallback
 * transition, because it is the hysteresis band that carries it: native land is
 * therefore restored in the same frame the palaeo charts leave the screen, and
 * hidden in the same frame they arrive, with no frame showing neither.
 */
export function resolveSurfaceVisibility(
  input: SurfaceVisibilityInput,
): SurfaceVisibilityResolution {
  const requestedBand = input.layerEnabled && input.band !== "none" && input.surfaceWithheld !== true
    ? input.band : "none";
  const hysteresis = input.advanceHysteresis === true
    ? advanceSurfaceVisibilityHysteresis(input.hysteresis, requestedBand)
    : input.hysteresis;
  const palaeoDrawn = input.layerEnabled && hysteresis.band !== "none" && input.published;
  const mode: CaoPalaeoCoastlineMode = !input.layerEnabled ? "off"
    : input.band === "none" ? "fallback"
      : palaeoDrawn ? "on" : "loading";
  // The composition follows the band actually on screen, never the requested
  // one: the hysteresis frame that still draws Cao 2017 charts must still hide
  // native land.
  const composition: SurfaceComposition = !palaeoDrawn ? "native"
    : hysteresis.band === "lgm" ? "lgm" : "realistic";
  return Object.freeze({
    band: input.band,
    mode,
    palaeoDrawn,
    nativeSurfaceMode: composition === "realistic" ? "palaeo" : "native",
    composition,
    slots: surfaceSlotComposition(composition),
    visibleClasses: COMPOSITION_CLASSES[composition],
    hysteresis,
  });
}
