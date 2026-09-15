/**
 * Motion evaluation and prepared-revision assembly for one palaeo-coastline
 * map interval.
 *
 * Two things separate this from `motionFrameV2`. The pose of a piece comes from
 * its own catalog binding — the partition it was cookie-cut by, or the tracked
 * `PLATEID1` override, or an explicit North Sea restoration entry — rather than
 * from a package chart's motion bindings. And activation is evaluated against
 * the piece's own `(TOAGE, FROMAGE]` lifecycle at the requested age, not
 * against the interval the payload file covers: an off-schedule source record
 * ships inside every canonical interval it overlaps and must stop being drawn
 * on its own date, inside the interval.
 */

import { PREPARED_MOTION_PALETTE_STRIDE, type PreparedCaoChartIdentity,
  type PreparedCaoDisplayControlsCopy, type PreparedCaoSpatialBatch,
  type PreparedCaoStaticGeometryCopy } from "./facadeV2";
import { inverseQuaternion, numberScalarOps, slerpQuaternion, type QuaternionWxyz } from "./arithmetic";
import type { LoadedPalaeoInterval, LoadedPalaeoIntervalClass } from "./loaderV2";
import { selectPaletteMotionSubsegment, type PreparedPaletteEntry } from "./palette";
import {
  PALAEO_SURFACE_CLASS_APPEARANCES,
  PALAEO_SURFACE_EVIDENCE_CLASSES,
  palaeoLifecycleActiveAtAge,
  palaeoPieceLimitationFlags,
  type PalaeoCoastlineEvidenceRecord,
  type PalaeoSurfaceClass,
} from "./palaeoRings";
import type { SpatialBatchSurfaceAppearanceV2 } from "./packageV2";
import type { SupportState } from "./types";

/** Seam ids are unique per palaeo vertex: a cookie-cut piece shares no vertex with any other. */
const PALAEO_SEAM_ID_BASE = 2_000_000_000;

export interface CaoPalaeoChartIdentity extends PreparedCaoChartIdentity {
  readonly surfaceClass: PalaeoSurfaceClass;
  readonly appearance: SpatialBatchSurfaceAppearanceV2;
  /** The catalog's own evidence status, kept beside the mapped runtime status. */
  readonly sourceStatus: PalaeoCoastlineEvidenceRecord["status"];
  readonly flags: number;
  readonly editorial: string | null;
}

export interface CaoPalaeoIntervalFrame {
  readonly requestedAgeMa: number;
  readonly intervalId: string;
  readonly intervalIndex: number;
  readonly fromAgeMa: number;
  readonly toAgeMa: number;
  readonly entryCount: number;
  /** Shared palette storage: `entryCount * PREPARED_MOTION_PALETTE_STRIDE`. */
  readonly paletteValues: Float32Array;
  readonly charts: readonly CaoPalaeoChartIdentity[];
  readonly activeChartCount: number;
  /** First chart index of each class, in the order the classes are drawn. */
  readonly classChartOffsets: ReadonlyMap<PalaeoSurfaceClass, number>;
  readonly activeSourceIds: readonly string[];
  readonly activeLimitations: readonly string[];
}

function evidenceStatus(status: PalaeoCoastlineEvidenceRecord["status"]):
"model-output" | "derived-overlay" {
  // A published map polygon is the source model's own output; a piece a cited
  // basin edit touched is our derivation over it and says so in `editorial`.
  return status === "derived-from-published-source" ? "derived-overlay" : "model-output";
}

/**
 * Poses every piece of every resident class against the palette entries the
 * runtime already holds, and marks each one active or inactive at the
 * requested age. Inactive pieces stay in the frame with activation 0: the
 * static geometry belongs to the interval, so scrubbing inside an interval must
 * not replace it.
 */
export function evaluateCaoPalaeoIntervalFrame(
  interval: LoadedPalaeoInterval,
  paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>,
  requestedAgeMa: number,
): CaoPalaeoIntervalFrame {
  if (!Number.isFinite(requestedAgeMa)) throw new Error("palaeo-coastline age is not finite");
  if (!(requestedAgeMa > interval.toAgeMa && requestedAgeMa <= interval.fromAgeMa)) {
    throw new Error("palaeo-coastline age is outside the resident interval");
  }
  const charts: CaoPalaeoChartIdentity[] = [];
  const classChartOffsets = new Map<PalaeoSurfaceClass, number>();
  const activeSourceIds = new Set<string>();
  const activeLimitations = new Set<string>();
  let activeChartCount = 0;
  const values: number[] = [];
  for (const resident of interval.classes) {
    classChartOffsets.set(resident.surfaceClass, charts.length);
    const { catalog, metadata } = resident;
    for (const [pieceIndex, piece] of metadata.pieces.entries()) {
      const evidence = catalog.evidence[piece.evidenceIndex]!;
      const binding = catalog.bindings[piece.bindingIndex]!;
      const lifecycle = catalog.lifecycles[piece.lifecycleIndex]!;
      const selected = binding.entries
        .filter((entry) => requestedAgeMa >= entry.validTimeMa.youngest
          && requestedAgeMa <= entry.validTimeMa.oldest)
        .sort((left, right) => left.entryId.localeCompare(right.entryId))[0];
      const entry = selected ? paletteEntries.get(selected.entryId) : undefined;
      const segment = entry ? selectPaletteMotionSubsegment(entry, requestedAgeMa) : null;
      const lifecycleActive = palaeoLifecycleActiveAtAge(lifecycle, requestedAgeMa);
      const support: SupportState = !lifecycleActive
        ? { kind: "inactive", reason: requestedAgeMa > lifecycle.oldestMa ? "unborn" : "consumed" }
        : segment ? { kind: "supported", method: "compiled-rigid" }
        : { kind: "unsupported", reason: "missing-motion" };
      const younger: QuaternionWxyz = segment?.younger.quaternion ?? [1, 0, 0, 0];
      const older: QuaternionWxyz = segment?.older.quaternion ?? younger;
      const poseQuaternion = slerpQuaternion(numberScalarOps, younger, older, segment?.fraction ?? 0);
      const activation = support.kind === "supported" ? 1 : 0;
      values.push(...younger, ...older, segment?.fraction ?? 0, activation, activation);
      const limitations = [...evidence.limitations,
        ...palaeoPieceLimitationFlags(piece).map((bit) => catalog.flagLimitations[String(bit)]!)];
      if (activation === 1) {
        activeChartCount += 1;
        for (const sourceId of evidence.sourceIds) activeSourceIds.add(sourceId);
        for (const limitation of limitations) activeLimitations.add(limitation);
      }
      const sourceChart = catalog.charts[piece.chartIndex]!;
      const materialId = `palaeo:${catalog.class}:${sourceChart.sourceRecordIndex}`;
      charts.push(Object.freeze({
        chartId: `palaeo:${catalog.class}:${resident.record.intervalId}:${pieceIndex}`,
        chartRevision: `${catalog.catalogId}@${resident.record.simplified.sha256}`,
        materialId,
        fragmentOrCohortId: `${materialId}:${binding.partitionPlateId}`,
        role: "model-geography" as const,
        support,
        evidence: Object.freeze({ status: evidenceStatus(evidence.status),
          sourceIds: Object.freeze([...evidence.sourceIds]),
          limitations: Object.freeze(limitations) }),
        surfaceEvidence: Object.freeze({ kind: "classified" as const,
          surfaceClass: PALAEO_SURFACE_EVIDENCE_CLASSES[catalog.class],
          sourceIds: Object.freeze([...evidence.sourceIds]) }),
        poseQuaternion,
        inversePoseQuaternion: inverseQuaternion(numberScalarOps, poseQuaternion),
        surfaceClass: catalog.class,
        appearance: PALAEO_SURFACE_CLASS_APPEARANCES[catalog.class],
        sourceStatus: evidence.status,
        flags: piece.flags,
        editorial: evidence.editorial ?? null,
      }));
    }
  }
  if (values.length !== charts.length * PREPARED_MOTION_PALETTE_STRIDE) {
    throw new Error("palaeo-coastline palette stride mismatch");
  }
  return Object.freeze({
    requestedAgeMa,
    intervalId: interval.intervalId,
    intervalIndex: interval.intervalIndex,
    fromAgeMa: interval.fromAgeMa,
    toAgeMa: interval.toAgeMa,
    entryCount: charts.length,
    paletteValues: new Float32Array(values),
    charts: Object.freeze(charts),
    activeChartCount,
    classChartOffsets,
    activeSourceIds: Object.freeze([...activeSourceIds].sort()),
    activeLimitations: Object.freeze([...activeLimitations]),
  });
}

export interface PreparedCaoPalaeoInterval {
  readonly identity: string;
  readonly requestId: number;
  readonly packageId: string;
  readonly packageRevision: string;
  readonly frameIdentity: string;
  readonly requestedAgeMa: number;
  readonly intervalId: string;
  readonly intervalIndex: number;
  readonly fromAgeMa: number;
  readonly toAgeMa: number;
  readonly maximumEdgeDegrees: number;
  readonly motionPalette: Readonly<{ stride: typeof PREPARED_MOTION_PALETTE_STRIDE;
    entryCount: number; createValuesCopy(): Float32Array }>;
  readonly batches: readonly PreparedCaoSpatialBatch[];
  readonly charts: readonly CaoPalaeoChartIdentity[];
  readonly activeChartCount: number;
  readonly activeSourceIds: readonly string[];
  readonly activeLimitations: readonly string[];
  readonly activeSourceBytes: number;
  release(): void;
}

export interface PreparedCaoPalaeoIntervalIdentity {
  readonly requestId: number;
  readonly packageId: string;
  readonly packageRevision: string;
  readonly frameIdentity: string;
  readonly baseColorRgb: Readonly<Record<PalaeoSurfaceClass, readonly [number, number, number]>>;
}

function preparedBatch(
  resident: LoadedPalaeoIntervalClass,
  chartOffset: number,
  chartCount: number,
  identity: PreparedCaoPalaeoIntervalIdentity,
  requirePayload: () => LoadedPalaeoIntervalClass,
): PreparedCaoSpatialBatch {
  const { geometry } = resident;
  const narrow = chartCount <= 65_535;
  const entryBytes = geometry.vertexCount * (narrow ? 2 : 4);
  const staticGeometryBytes = geometry.referenceDirections.byteLength + geometry.indices.byteLength
    + geometry.vertexCount * 4 + entryBytes * 2;
  const entryIndices = () => {
    const current = requirePayload().geometry.pieceIndices;
    const indices = narrow ? new Uint16Array(current.length) : new Uint32Array(current.length);
    for (let vertex = 0; vertex < current.length; vertex += 1) indices[vertex] = chartOffset + current[vertex]!;
    return indices;
  };
  return Object.freeze({
    batchId: `palaeo-${resident.surfaceClass}`,
    staticGeometryIdentity:
      `${identity.packageId}@${identity.packageRevision}:palaeo-${resident.surfaceClass}:${resident.record.simplified.sha256}`,
    vertexCount: geometry.vertexCount,
    triangleCount: geometry.triangleCount,
    staticGeometryBytes,
    nativePrecedence: false,
    surfaceAppearance: PALAEO_SURFACE_CLASS_APPEARANCES[resident.surfaceClass],
    chartTriangleRanges: Object.freeze(geometry.pieceTriangleRanges.map((range) => Object.freeze({
      chartIndex: chartOffset + range.pieceIndex,
      firstTriangle: range.firstTriangle,
      triangleCount: range.triangleCount,
    }))),
    createStaticGeometryCopy: (): PreparedCaoStaticGeometryCopy => {
      const current = requirePayload().geometry;
      const seamIds = new Uint32Array(current.vertexCount);
      for (let vertex = 0; vertex < seamIds.length; vertex += 1) seamIds[vertex] = PALAEO_SEAM_ID_BASE + vertex;
      const preparedEntryIndices = entryIndices();
      return {
        referenceDirections: new Float32Array(current.referenceDirections),
        indices: new Uint32Array(current.indices),
        seamIds,
        preparedEntryIndices,
        materialChartIndices: preparedEntryIndices.slice(),
      };
    },
    createDisplayControlsCopy: (): PreparedCaoDisplayControlsCopy => {
      requirePayload();
      // Height is always 0: the renderer's shell table owns the offset each
      // palaeo class is drawn at, and a second height here would double it.
      return {
        displayHeightStart: { kind: "uniform", value: 0 },
        displayHeightEnd: { kind: "uniform", value: 0 },
        baseColor: { kind: "uniform", value: identity.baseColorRgb[resident.surfaceClass] },
      };
    },
  });
}

/**
 * Wraps one evaluated frame and its resident geometry in the prepared shape the
 * surface renderer consumes. The lease keeps the resident interval reachable;
 * releasing it is what lets the interval store evict the payload.
 */
export function createPreparedCaoPalaeoInterval(
  interval: LoadedPalaeoInterval,
  frame: CaoPalaeoIntervalFrame,
  identity: PreparedCaoPalaeoIntervalIdentity,
  onRelease: (identity: string) => void,
): PreparedCaoPalaeoInterval {
  const revisionIdentity =
    `${identity.packageId}@${identity.packageRevision}:palaeo:${interval.intervalId}:${identity.requestId}`;
  let resident: LoadedPalaeoInterval | null = interval;
  let paletteValues: Float32Array | null = frame.paletteValues;
  const maximumEdgeDegrees = interval.classes.reduce(
    (largest, entry) => Math.max(largest, entry.geometry.maximumEdgeDegrees), 0);
  const batches = interval.classes.map((entry) => preparedBatch(entry,
    frame.classChartOffsets.get(entry.surfaceClass)!, frame.charts.length, identity, () => {
      if (!resident) throw new Error("palaeo-coastline interval released");
      return entry;
    }));
  const release = () => {
    resident = null;
    paletteValues = null;
    onRelease(revisionIdentity);
  };
  return Object.freeze({
    identity: revisionIdentity,
    requestId: identity.requestId,
    packageId: identity.packageId,
    packageRevision: identity.packageRevision,
    frameIdentity: identity.frameIdentity,
    requestedAgeMa: frame.requestedAgeMa,
    intervalId: interval.intervalId,
    intervalIndex: interval.intervalIndex,
    fromAgeMa: interval.fromAgeMa,
    toAgeMa: interval.toAgeMa,
    maximumEdgeDegrees,
    motionPalette: Object.freeze({ stride: PREPARED_MOTION_PALETTE_STRIDE,
      entryCount: frame.entryCount,
      createValuesCopy: () => {
        if (!paletteValues) throw new Error("palaeo-coastline interval released");
        return new Float32Array(paletteValues);
      } }),
    batches: Object.freeze(batches),
    charts: frame.charts,
    activeChartCount: frame.activeChartCount,
    activeSourceIds: frame.activeSourceIds,
    activeLimitations: frame.activeLimitations,
    activeSourceBytes: interval.sourceBytes,
    release,
  });
}
