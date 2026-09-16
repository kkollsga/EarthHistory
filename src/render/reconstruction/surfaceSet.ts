/**
 * Coverage and picking over the whole surface set on screen.
 *
 * The set is what the compositions draw: the Cao 2024 stack (restored margins,
 * and — outside the Cao 2017 band — the crust shelf and today's land with its
 * land-appearance corrections) plus, wherever the band or the LGM lowstand puts
 * them there, the Cao 2017 land, shallow-marine and mountain charts. Every
 * member answers against one precedence table, so `correction-shelf` ranks under
 * a mapped shallow sea no matter which member drew it.
 *
 * Each member carries the mode it is drawn in, so these functions take one view
 * of the set rather than one argument per renderer instance. That is what makes
 * "the Cao 2017 classes replace the Cao 2024 ones in their slots" a property of
 * the set: a member drawn in the palaeo mode hides every class drawn in native
 * land's colour — `land` and `corrections` alike — and the Cao 2024 crust shelf
 * with them, so the composite never answers from a surface the viewer cannot
 * see, and guide-label ink, picking and pixels agree. The restored margins stay,
 * drawn there as submerged margin.
 */

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
  type CaoFoundationSurfaceView,
} from "./caoFoundation";
import type { Vec3Tuple } from "./bounds";

/**
 * Every surface on screen, in publication order. A member that is hidden or has
 * nothing published is absent rather than null: `surfaceView()` already answers
 * null on exactly the condition that keeps a member off the screen.
 */
export type CaoSurfaceSetView = readonly CaoFoundationSurfaceView[];

export interface CaoSurfaceSetPickOptions extends CaoFoundationCoverageOptions {
  readonly maximumTestedTriangles?: number;
}

/**
 * The classes one member contributes: the caller's selection, narrowed to what
 * that member's own mode draws. Answering "covered" from a surface the mode
 * hides would put dark label ink over a sea the viewer can see.
 */
function selectionFor(
  options: CaoFoundationCoverageOptions,
  view: CaoFoundationSurfaceView,
): readonly CaoFoundationSurfaceClass[] {
  const selected = caoFoundationSurfaceClassSelection(options);
  return CAO_FOUNDATION_SURFACE_PRECEDENCE.filter((surfaceClass) =>
    selected.has(surfaceClass) && caoFoundationSurfaceClassVisible(surfaceClass, view.mode));
}

export function caoSurfaceSetCoversDirection(
  views: CaoSurfaceSetView,
  rendererDirection: Vec3Tuple,
  options: CaoFoundationCoverageOptions = {},
): boolean {
  for (const view of views) {
    const surfaceClasses = selectionFor(options, view);
    if (surfaceClasses.length === 0) continue;
    if (caoFoundationSurfaceCoversDirection(view.geometry, view.publication,
      rendererDirection, { surfaceClasses })) return true;
  }
  return false;
}

/**
 * Highest-precedence class covering one piece of present-day ground, or null.
 *
 * This is the on-screen form of the compiled witness table: the Western
 * Interior Seaway at 90 Ma is a question about the ground under present-day
 * (-100, 45), not about a screen position, and every chart in the set stores its
 * geometry in present-day WGS84. It walks the same coverage path the guide-label
 * ink uses, one precedence class at a time, so the answer is the class the
 * viewer sees rather than whichever batch happened to be tested first.
 */
export function caoSurfaceSetReferenceSurfaceClass(
  views: CaoSurfaceSetView,
  referenceDirection: Vec3Tuple,
  options: CaoFoundationCoverageOptions = {},
): CaoFoundationSurfaceClass | null {
  // Descending precedence: the answer is the class drawn last over the ground.
  for (const surfaceClass of [...CAO_FOUNDATION_SURFACE_PRECEDENCE].reverse()) {
    for (const view of views) {
      if (!selectionFor(options, view).includes(surfaceClass)) continue;
      if (caoFoundationSurfaceCoversDirection(view.geometry, view.publication, referenceDirection,
        { surfaceClasses: [surfaceClass], directionFrame: "chart-reference" })) return surfaceClass;
    }
  }
  return null;
}

export function intersectCaoSurfaceSet(
  views: CaoSurfaceSetView,
  rayOrigin: Vec3Tuple,
  rayDirection: Vec3Tuple,
  options: CaoSurfaceSetPickOptions = {},
): CaoFoundationSurfaceHit | null {
  const maximumTestedTriangles = options.maximumTestedTriangles ?? 65_536;
  const hits: CaoFoundationSurfaceHit[] = [];
  // Each member is tested in the mode whose classes it actually holds: a member
  // carrying only Cao 2017 batches tested in the native mode would hide every
  // one of them.
  for (const view of views) {
    const hit = intersectCaoFoundationSurface(view.geometry, view.publication,
      rayOrigin, rayDirection, maximumTestedTriangles, view.mode);
    if (hit !== null) hits.push(hit);
  }
  return caoFoundationHighestPrecedenceHit(hits);
}
