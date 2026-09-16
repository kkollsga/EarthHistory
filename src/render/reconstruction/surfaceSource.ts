/**
 * Compatibility re-export. The surface preparation path moved down to
 * `src/reconstruction/surfaceSource.ts` so that `src/reconstruction/**` — which
 * owns the loader, the residency store and the request engine — imports nothing
 * from `src/render/**`. The module itself only ever read package, spatial and
 * triangulation types, so the move is a relocation, not a rewrite.
 *
 * Render-side callers may keep importing from this path. New code should import
 * the canonical module directly; `src/reconstruction/layering.test.ts` enforces
 * the direction this shim preserves.
 */

export {
  DEFAULT_SURFACE_PREPARATION_LIMITS,
  prepareSurfaceBatch,
} from "../../reconstruction/surfaceSource";
export type {
  EhgbSurfaceSource,
  EhprSurfaceSource,
  PreparedSurfaceBatch,
  SurfacePreparationLimits,
  SurfaceSource,
} from "../../reconstruction/surfaceSource";
