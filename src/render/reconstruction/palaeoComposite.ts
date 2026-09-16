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
 * mode runs: the native Cao 2024 stack (restored margins, and — mode off — the
 * crust shelf and native land with its land-appearance corrections) and the
 * palaeo stack (Cao 2017 land, shallow marine and mountain charts). Both answer
 * against one precedence table, so `correction-shelf` ranks under a mapped
 * shallow sea no matter which instance drew it.
 *
 * The palaeo mode hides every class drawn in native land's colour — `land` and
 * `corrections` alike — so the composite never answers "land" from a surface
 * the viewer cannot see, and guide-label ink, picking and pixels agree. It
 * hides the Cao 2024 crust shelf for the same reason on the water side: the
 * band draws five levels, the shelf is not one of them, and a pick that
 * answered "shelf" over ground the viewer reads as deep sea would disagree
 * with the pixels. The restored margins stay, drawn there as submerged margin.
 */

export interface CaoCompositeOptions extends CaoFoundationCoverageOptions {
  /** What the **native** instance draws; `palaeo` is the stack with land hidden. */
  readonly mode?: CaoFoundationSurfaceMode;
  /**
   * Whether the palaeo instance is on screen. It defaults to `mode === "palaeo"`
   * — the Cao 2017 band, where palaeo land replaces native land — but the two
   * come apart at the detached LGM interval, which draws its exposed shelf
   * *over* today's composition and therefore keeps native land visible.
   */
  readonly palaeoVisible?: boolean;
}

export interface CaoCompositePickOptions extends CaoCompositeOptions {
  readonly maximumTestedTriangles?: number;
}

function selectionFor(
  options: CaoCompositeOptions,
  mode: CaoFoundationSurfaceMode,
  palaeoVisible: boolean,
): readonly CaoFoundationSurfaceClass[] {
  const selected = caoFoundationSurfaceClassSelection(options);
  // Mode visibility is the composite's own filter: the native instance still
  // holds `batch-land` and every land-appearance correction, and answering
  // "covered" from a surface the mode hides would put dark label ink over a sea
  // the viewer can see. A class the palaeo instance draws is visible whenever
  // that instance is, whatever the native instance is doing.
  return CAO_FOUNDATION_SURFACE_PRECEDENCE.filter((surfaceClass) =>
    selected.has(surfaceClass)
    && (caoFoundationSurfaceClassVisible(surfaceClass, mode)
      || (palaeoVisible && caoFoundationSurfaceClassVisible(surfaceClass, "palaeo"))));
}

function palaeoVisibleFor(options: CaoCompositeOptions, mode: CaoFoundationSurfaceMode): boolean {
  return options.palaeoVisible ?? mode === "palaeo";
}

export function caoCompositeCoversDirection(
  native: CaoFoundationSurfaceView | null,
  palaeo: CaoFoundationSurfaceView | null,
  rendererDirection: Vec3Tuple,
  options: CaoCompositeOptions = {},
): boolean {
  const mode = options.mode ?? "native";
  const palaeoVisible = palaeoVisibleFor(options, mode);
  const surfaceClasses = selectionFor(options, mode, palaeoVisible);
  if (surfaceClasses.length === 0) return false;
  const covers = (view: CaoFoundationSurfaceView | null) => view !== null
    && caoFoundationSurfaceCoversDirection(view.geometry, view.publication,
      rendererDirection, { surfaceClasses });
  if (covers(native)) return true;
  return palaeoVisible && covers(palaeo);
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
  const palaeoVisible = palaeoVisibleFor(options, mode);
  // `selectionFor` is ascending precedence; the answer is the class drawn last.
  for (const surfaceClass of [...selectionFor(options, mode, palaeoVisible)].reverse()) {
    const covered = (view: CaoFoundationSurfaceView | null) => view !== null
      && caoFoundationSurfaceCoversDirection(view.geometry, view.publication, referenceDirection,
        { surfaceClasses: [surfaceClass], directionFrame: "chart-reference" });
    if (covered(native) || (palaeoVisible && covered(palaeo))) return surfaceClass;
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
  const palaeoVisible = palaeoVisibleFor(options, mode);
  const maximumTestedTriangles = options.maximumTestedTriangles ?? 65_536;
  const hits: CaoFoundationSurfaceHit[] = [];
  // Each instance is tested in the mode whose classes it actually holds: the
  // palaeo instance carries only palaeo batches, so testing it in the native
  // mode would hide every one of them.
  const views: readonly (readonly [CaoFoundationSurfaceView | null, CaoFoundationSurfaceMode])[] =
    palaeoVisible ? [[native, mode], [palaeo, "palaeo"]] : [[native, mode]];
  for (const [view, viewMode] of views) {
    if (view === null) continue;
    const hit = intersectCaoFoundationSurface(view.geometry, view.publication,
      rayOrigin, rayDirection, maximumTestedTriangles, viewMode);
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

/**
 * The detached Last Glacial Maximum lowstand band, `(19.5 ka, 26.5 ka]`.
 * Half-open at the young end like every other interval in the pipeline, so
 * 19.4 ka and 26.6 ka are outside it and 21 ka is inside.
 */
export const CAO_PALAEO_LGM_AGE_BAND_MA = Object.freeze({
  youngestExclusive: 0.0195,
  oldest: 0.0265,
} as const);

/**
 * Which band of the palaeo domain an age belongs to.
 *
 * The two bands are not the same kind of claim and the renderer treats them
 * differently: `cao-2017` is a whole-Earth palaeogeography that *replaces*
 * today's land, while `lgm` is a regional eustatic lowstand state drawn *over*
 * it in three footprints. Anything else falls back.
 */
export type CaoPalaeoDomainBand = "none" | "cao-2017" | "lgm";

export function caoPalaeoCoastlineDomainBand(ageMa: number | null): CaoPalaeoDomainBand {
  if (ageMa === null || !Number.isFinite(ageMa)) return "none";
  if (ageMa >= CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA.youngest
      && ageMa <= CAO_PALAEO_COASTLINE_AGE_DOMAIN_MA.oldest) return "cao-2017";
  if (ageMa > CAO_PALAEO_LGM_AGE_BAND_MA.youngestExclusive
      && ageMa <= CAO_PALAEO_LGM_AGE_BAND_MA.oldest) return "lgm";
  return "none";
}

export function caoPalaeoCoastlineAgeInsideDomain(ageMa: number | null): boolean {
  return caoPalaeoCoastlineDomainBand(ageMa) !== "none";
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
