/**
 * One preparation path from a surface source to the batch resource the renderer
 * publishes.
 *
 * Two arms feed the same `CaoFoundationSurfaceRenderer`. The native classes
 * arrive as EHGB payloads triangulated offline and refined to one degree at
 * emit; the realistic classes arrive as EHPR ring payloads triangulated in the
 * browser worker and refined to the same one degree there. Per-interval
 * pre-triangulated geometry would be 45-96 MiB, so that split is permanent —
 * but it is a difference in where the triangles come from, not in what a
 * prepared batch is. This module states the common shape once:
 *
 *   positions (unit reference directions, f32 xyz)
 *   one palette-entry index per vertex (and the material chart index beside it)
 *   a u32 triangle index buffer and its per-vertex seam ids
 *   per-chart contiguous triangle ranges, in chart space
 *   the drawing appearance the shell table keys off
 *   the byte ledger `createCaoFoundationGeometryResource` re-derives and checks
 *
 * Both arms genuinely differ in three named places, and the union spells each
 * one out rather than hiding it:
 *
 *  1. Array ownership. An EHGB payload is released when its revision lease is
 *     released, so the renderer's copy owns fresh arrays. An EHPR interval's
 *     arrays are owned by the interval store for as long as the interval is
 *     resident, so the copy hands the resident arrays through and a crossing
 *     pays no copy.
 *  2. Entry indices. A native vertex carries its chart index directly from the
 *     payload, and the two narrowed arrays are separate allocations. A palaeo
 *     piece is one chart and one palette entry at once, so a single offset
 *     array answers both.
 *  3. Display controls. A native batch interpolates checkpoint display controls
 *     between the bracketing ages, so its source passes them as a thunk. A
 *     palaeo batch has no height of its own — the renderer's shell table owns
 *     the offset each palaeo class draws at — so its source passes only a base
 *     colour.
 *
 * This module imports types only from `src/reconstruction`, so it adds no
 * runtime edge back from the reconstruction layer into the renderer.
 */

import type {
  PreparedCaoDisplayControlsCopy,
  PreparedCaoSpatialBatch,
  PreparedCaoStaticGeometryCopy,
} from "./facadeV2";
import type { SpatialBatchSurfaceAppearanceV2 } from "./packageV2";
import type { DecodedCaoSpatialBatch } from "./spatialV2";
import type { PalaeoPieceTriangleRange,
  PreparedPalaeoIntervalGeometry } from "./palaeoTriangulate";

/** The prepared batch both arms produce; unchanged from what `publish()` consumes today. */
export type PreparedSurfaceBatch = PreparedCaoSpatialBatch;

export interface SurfacePreparationLimits {
  /**
   * The per-vertex entry index narrows to u16 at or below this many charts and
   * widens to u32 above it, which is the one preparation decision that changes
   * the byte ledger. The triangulation ceilings (`PALAEO_TRIANGULATION_MAX_*`)
   * and the renderer's own vertex/triangle ceilings are enforced where they are
   * today — in the worker runner and in the renderer's reservation — because a
   * source that is already prepared cannot be refused here.
   */
  readonly narrowEntryIndexMaxCharts: number;
}

export const DEFAULT_SURFACE_PREPARATION_LIMITS: SurfacePreparationLimits =
  Object.freeze({ narrowEntryIndexMaxCharts: 65_535 });

/** A statically triangulated native batch, as loaded by `loadVerifiedCaoStaticFoundation`. */
export interface EhgbSurfaceSource {
  readonly kind: "ehgb";
  readonly batchId: string;
  readonly staticGeometryIdentity: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  /** Charts in the revision this batch is prepared into; decides the index width. */
  readonly chartCount: number;
  readonly nativePrecedence: boolean;
  readonly surfaceAppearance?: SpatialBatchSurfaceAppearanceV2;
  /** Already chart-space and frozen at decode; reused rather than rebuilt. */
  readonly chartTriangleRanges: DecodedCaoSpatialBatch["chartTriangleRanges"];
  /** The live decoded payload; throws once the revision lease is released. */
  readonly requireGeometry: () => DecodedCaoSpatialBatch;
  /** Checkpoint display controls for the bracketing ages of this revision. */
  readonly displayControls: () => PreparedCaoDisplayControlsCopy;
}

/** One realistic class of one map interval, triangulated by the palaeo worker. */
export interface EhprSurfaceSource {
  readonly kind: "ehpr";
  readonly batchId: string;
  readonly staticGeometryIdentity: string;
  readonly vertexCount: number;
  readonly triangleCount: number;
  /** Charts in the interval this batch is prepared into; decides the index width. */
  readonly chartCount: number;
  readonly surfaceAppearance: SpatialBatchSurfaceAppearanceV2;
  /** First chart of this class inside the interval's chart table. */
  readonly chartIndexOffset: number;
  /** Piece-space ranges from the worker; shifted into chart space below. */
  readonly pieceTriangleRanges: readonly PalaeoPieceTriangleRange[];
  /** The live resident geometry; throws once the interval lease is released. */
  readonly requireGeometry: () => PreparedPalaeoIntervalGeometry;
  readonly baseColorRgb: readonly [number, number, number];
}

export type SurfaceSource = EhgbSurfaceSource | EhprSurfaceSource;

/**
 * Bytes the renderer retains for one prepared batch.
 *
 * `staticGeometryByteLength` sums the arrays of the copy, and the material
 * chart index is counted beside the palette entry index even when one array
 * answers both, because the renderer's ledger is over attributes and not over
 * allocations. For an EHGB payload this is exactly
 * `payload.byteLength - 32 + (narrow ? 0 : vertexCount * 4)`.
 *
 * A palaeo copy carries no seam ids — nothing uploads or reads them, and the
 * interval releases the array — so its ledger drops that `vertexCount * 4`.
 */
function surfaceGeometryByteLength(
  vertexCount: number,
  triangleCount: number,
  narrow: boolean,
  retainsSeamIds: boolean,
): number {
  const entryBytes = vertexCount * (narrow ? 2 : 4);
  return vertexCount * 12 + (retainsSeamIds ? vertexCount * 4 : 0)
    + triangleCount * 12 + entryBytes * 2;
}

/**
 * One per-vertex palette-entry index per resident class geometry.
 *
 * The worker cannot build it: the offset a class starts at is the sum of the
 * piece counts of the classes before it, which is only known once every class
 * of the interval is resident, while each class is triangulated on its own. The
 * same array answers both the palette entry index and the material chart index,
 * because for a palaeo batch they are the same number — one piece is one chart
 * and one palette entry.
 *
 * Keyed on the resident geometry and not held in a `prepareSurfaceBatch`
 * closure, because a closure is per prepared revision: a return visit to an
 * interval builds a new batch over the same geometry, and rebuilding the array
 * there would be ~1.2 MiB per crossing and would need `pieceIndices` kept alive
 * forever. Bounded by residency exactly as the interval store's own caches are.
 */
const PALAEO_ENTRY_INDICES = new WeakMap<PreparedPalaeoIntervalGeometry,
{ readonly chartIndexOffset: number; readonly indices: Uint16Array | Uint32Array }>();

/**
 * Prepares one surface source as the batch the renderer publishes.
 *
 * Behaviour-preserving for both arms: the arrays, their widths, the chart
 * ranges and the byte ledger are what each arm produced before this module
 * existed, and the released-lease throw still fires from the same access.
 */
export function prepareSurfaceBatch(
  source: SurfaceSource,
  limits: SurfacePreparationLimits = DEFAULT_SURFACE_PREPARATION_LIMITS,
): PreparedSurfaceBatch {
  const narrow = source.chartCount <= limits.narrowEntryIndexMaxCharts;
  const staticGeometryBytes = surfaceGeometryByteLength(
    source.vertexCount, source.triangleCount, narrow, source.kind === "ehgb");
  const common = {
    batchId: source.batchId,
    staticGeometryIdentity: source.staticGeometryIdentity,
    vertexCount: source.vertexCount,
    triangleCount: source.triangleCount,
    staticGeometryBytes,
    surfaceAppearance: source.surfaceAppearance,
  };
  if (source.kind === "ehgb") {
    return Object.freeze({
      ...common,
      // One Cao 2024 package ships one geometry for the whole session.
      staticGeometryReplaceable: false,
      nativePrecedence: source.nativePrecedence,
      chartTriangleRanges: source.chartTriangleRanges,
      createStaticGeometryCopy: (): PreparedCaoStaticGeometryCopy => {
        const current = source.requireGeometry();
        return {
          referenceDirections: new Float32Array(current.referenceDirections),
          indices: new Uint32Array(current.indices),
          seamIds: new Uint32Array(current.seamIds),
          preparedEntryIndices: narrow
            ? new Uint16Array(current.vertexChartIndices) : new Uint32Array(current.vertexChartIndices),
          materialChartIndices: narrow
            ? new Uint16Array(current.vertexChartIndices) : new Uint32Array(current.vertexChartIndices),
        };
      },
      createDisplayControlsCopy: (): PreparedCaoDisplayControlsCopy => source.displayControls(),
    });
  }
  const chartIndexOffset = source.chartIndexOffset;
  const entryIndices = () => {
    const geometry = source.requireGeometry();
    const cached = PALAEO_ENTRY_INDICES.get(geometry);
    if (cached) {
      // The offset is the sum of the piece counts of the classes before this
      // one inside the same resident interval, so it cannot move while the
      // geometry lives. If it ever did, the input to rebuild from is gone.
      if (cached.chartIndexOffset !== chartIndexOffset) {
        throw new Error("palaeo chart index offset changed for a resident interval class");
      }
      return cached.indices;
    }
    const pieceIndices = geometry.pieceIndices;
    if (pieceIndices === null) {
      throw new Error("palaeo piece indices released before the entry index was built");
    }
    const indices = narrow ? new Uint16Array(pieceIndices.length) : new Uint32Array(pieceIndices.length);
    for (let vertex = 0; vertex < pieceIndices.length; vertex += 1) {
      indices[vertex] = chartIndexOffset + pieceIndices[vertex]!;
    }
    PALAEO_ENTRY_INDICES.set(geometry, { chartIndexOffset, indices });
    // Both inputs are upload-only and this was their one reader. Releasing them
    // here, rather than leaving them on the resident geometry, is 2.1 MB an
    // interval — 44 MiB across the 25 the high profile keeps.
    geometry.pieceIndices = null;
    geometry.seamIds = null;
    return indices;
  };
  return Object.freeze({
    ...common,
    // Streaming one map interval at a time is this batch's normal path.
    staticGeometryReplaceable: true,
    nativePrecedence: false,
    chartTriangleRanges: Object.freeze(source.pieceTriangleRanges.map((range) => Object.freeze({
      chartIndex: chartIndexOffset + range.pieceIndex,
      firstTriangle: range.firstTriangle,
      triangleCount: range.triangleCount,
    }))),
    // The copy shares the resident interval's own typed arrays rather than
    // duplicating them. Nothing downstream writes to a static geometry buffer —
    // the renderer uploads it and reads it for picking — and the interval store
    // owns the lifetime of the resident arrays, so a crossing no longer pays
    // ~10 MiB of copies in the one frame that publishes the incoming interval.
    // No seam ids: every palaeo vertex is its own seam, the renderer neither
    // uploads nor reads them, and `entryIndices()` releases the array.
    createStaticGeometryCopy: (): PreparedCaoStaticGeometryCopy => {
      const current = source.requireGeometry();
      const preparedEntryIndices = entryIndices();
      return {
        referenceDirections: current.referenceDirections,
        indices: current.indices,
        seamIds: null,
        preparedEntryIndices,
        materialChartIndices: preparedEntryIndices,
      };
    },
    createDisplayControlsCopy: (): PreparedCaoDisplayControlsCopy => {
      source.requireGeometry();
      // Height is always 0: the renderer's shell table owns the offset each
      // palaeo class is drawn at, and a second height here would double it.
      return {
        displayHeightStart: { kind: "uniform", value: 0 },
        displayHeightEnd: { kind: "uniform", value: 0 },
        baseColor: { kind: "uniform", value: source.baseColorRgb },
      };
    },
  });
}
