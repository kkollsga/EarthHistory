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
  indexPalaeoPaletteEntriesByPlate,
  palaeoBindingSeamCoversAge,
  palaeoLifecycleActiveAtAge,
  palaeoPieceLimitationFlags,
  selectPalaeoBindingEntry,
  type PalaeoCoastlineEvidenceRecord,
  type PalaeoSurfaceClass,
} from "./palaeoRings";
import type { SpatialBatchSurfaceAppearanceV2 } from "./packageV2";
import type { SupportState } from "./types";
import type { PalaeoCoastlineEvidence, PalaeoEvidenceReference } from "../data";

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
 * Everything about one piece that does not depend on the requested age.
 *
 * A scrub inside one interval re-poses the same pieces on every frame, and the
 * identity strings, the evidence records and the limitation lists are the
 * interval's own, not the age's. Rebuilding them per frame cost more than the
 * pose arithmetic did, so they are computed once per resident interval and the
 * frame evaluation below only fills in what the age changes.
 */
interface PalaeoPieceIdentity {
  readonly chartId: string;
  readonly chartRevision: string;
  readonly materialId: string;
  readonly fragmentOrCohortId: string;
  readonly evidence: PreparedCaoChartIdentity["evidence"];
  readonly surfaceEvidence: PreparedCaoChartIdentity["surfaceEvidence"];
  readonly surfaceClass: PalaeoSurfaceClass;
  readonly appearance: SpatialBatchSurfaceAppearanceV2;
  readonly sourceStatus: PalaeoCoastlineEvidenceRecord["status"];
  readonly flags: number;
  readonly editorial: string | null;
  readonly sourceIds: readonly string[];
  readonly limitations: readonly string[];
  readonly binding: LoadedPalaeoIntervalClass["catalog"]["bindings"][number];
  readonly lifecycle: LoadedPalaeoIntervalClass["catalog"]["lifecycles"][number];
  readonly entrySelection: LoadedPalaeoIntervalClass["catalog"]["entrySelection"];
}

interface PalaeoIntervalIdentityTable {
  readonly pieces: readonly PalaeoPieceIdentity[];
  readonly classChartOffsets: ReadonlyMap<PalaeoSurfaceClass, number>;
}

/**
 * One identity table per resident interval, dropped with the interval itself.
 * The store owns residency (two intervals at a time), so this cache is bounded
 * by that residency and needs no eviction policy of its own.
 */
const PALAEO_IDENTITY_TABLES = new WeakMap<LoadedPalaeoInterval, PalaeoIntervalIdentityTable>();

/** One plate index per resident palette map, for the same reason. */
const PALAEO_PLATE_INDEXES = new WeakMap<object,
ReturnType<typeof indexPalaeoPaletteEntriesByPlate<PreparedPaletteEntry>>>();

function palaeoIntervalIdentityTable(interval: LoadedPalaeoInterval): PalaeoIntervalIdentityTable {
  const cached = PALAEO_IDENTITY_TABLES.get(interval);
  if (cached) return cached;
  const pieces: PalaeoPieceIdentity[] = [];
  const classChartOffsets = new Map<PalaeoSurfaceClass, number>();
  for (const resident of interval.classes) {
    classChartOffsets.set(resident.surfaceClass, pieces.length);
    const { catalog, metadata } = resident;
    for (const [pieceIndex, piece] of metadata.pieces.entries()) {
      const evidence = catalog.evidence[piece.evidenceIndex]!;
      const sourceIds = Object.freeze([...evidence.sourceIds]);
      const limitations = Object.freeze([...evidence.limitations,
        ...palaeoPieceLimitationFlags(piece).map((bit) => catalog.flagLimitations[String(bit)]!)]);
      // The shipped catalog carries no chart table: `chartIndex` is the source
      // record's own ordinal in the offline provenance sidecar, and every piece
      // cut from one Cao 2017 record carries it, so it is the material identity.
      const materialId = `palaeo:${catalog.class}:${piece.chartIndex}`;
      const binding = catalog.bindings[piece.bindingIndex]!;
      pieces.push(Object.freeze({
        chartId: `palaeo:${catalog.class}:${resident.record.intervalId}:${pieceIndex}`,
        chartRevision: `${catalog.catalogId}@${resident.record.payload.sha256}`,
        materialId,
        fragmentOrCohortId: `${materialId}:${binding.partitionPlateId}`,
        evidence: Object.freeze({ status: evidenceStatus(evidence.status),
          sourceIds, limitations }),
        surfaceEvidence: Object.freeze({ kind: "classified" as const,
          surfaceClass: PALAEO_SURFACE_EVIDENCE_CLASSES[catalog.class],
          sourceIds }),
        surfaceClass: catalog.class,
        appearance: PALAEO_SURFACE_CLASS_APPEARANCES[catalog.class],
        sourceStatus: evidence.status,
        flags: piece.flags,
        editorial: evidence.editorial ?? null,
        sourceIds,
        limitations,
        binding,
        lifecycle: catalog.lifecycles[piece.lifecycleIndex]!,
        entrySelection: catalog.entrySelection,
      }));
    }
  }
  const table = Object.freeze({ pieces: Object.freeze(pieces), classChartOffsets });
  PALAEO_IDENTITY_TABLES.set(interval, table);
  return table;
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
  const identity = palaeoIntervalIdentityTable(interval);
  const charts: CaoPalaeoChartIdentity[] = [];
  const activeSourceIds = new Set<string>();
  const activeLimitations = new Set<string>();
  let activeChartCount = 0;
  const paletteValues = new Float32Array(identity.pieces.length * PREPARED_MOTION_PALETTE_STRIDE);
  // `palaeo-binding-entry-v1` starts from the palette entries of one plate, and
  // a resident palette is keyed by entry id, so the plate index is built once
  // per resident palette rather than per piece or per frame.
  let entriesByPlate = PALAEO_PLATE_INDEXES.get(paletteEntries);
  if (!entriesByPlate) {
    entriesByPlate = indexPalaeoPaletteEntriesByPlate(paletteEntries.values());
    PALAEO_PLATE_INDEXES.set(paletteEntries, entriesByPlate);
  }
  for (const [pieceIndex, piece] of identity.pieces.entries()) {
    const entry = selectPalaeoBindingEntry(entriesByPlate.get(piece.binding.bindingPlateId) ?? [],
      piece.entrySelection, piece.binding.bindingPlateId, requestedAgeMa);
    const segment = entry ? selectPaletteMotionSubsegment(entry, requestedAgeMa) : null;
    const lifecycleActive = palaeoLifecycleActiveAtAge(piece.lifecycle, requestedAgeMa);
    // An unposable piece is not drawn. A declared source seam says so as
    // `source-seam`: the model has a hole here, which is a different claim
    // from a palette entry that has not finished downloading.
    const support: SupportState = !lifecycleActive
      ? { kind: "inactive", reason: requestedAgeMa > piece.lifecycle.oldestMa ? "unborn" : "consumed" }
      : segment ? { kind: "supported", method: "compiled-rigid" }
      : { kind: "unsupported",
        reason: palaeoBindingSeamCoversAge(piece.binding, requestedAgeMa) ? "source-seam" : "missing-motion" };
    const younger: QuaternionWxyz = segment?.younger.quaternion ?? [1, 0, 0, 0];
    const older: QuaternionWxyz = segment?.older.quaternion ?? younger;
    const poseQuaternion = slerpQuaternion(numberScalarOps, younger, older, segment?.fraction ?? 0);
    const activation = support.kind === "supported" ? 1 : 0;
    const base = pieceIndex * PREPARED_MOTION_PALETTE_STRIDE;
    paletteValues.set(younger, base);
    paletteValues.set(older, base + 4);
    paletteValues[base + 8] = segment?.fraction ?? 0;
    paletteValues[base + 9] = activation;
    paletteValues[base + 10] = activation;
    if (activation === 1) {
      activeChartCount += 1;
      for (const sourceId of piece.sourceIds) activeSourceIds.add(sourceId);
      for (const limitation of piece.limitations) activeLimitations.add(limitation);
    }
    charts.push(Object.freeze({
      chartId: piece.chartId,
      chartRevision: piece.chartRevision,
      materialId: piece.materialId,
      fragmentOrCohortId: piece.fragmentOrCohortId,
      role: "model-geography" as const,
      support,
      evidence: piece.evidence,
      surfaceEvidence: piece.surfaceEvidence,
      poseQuaternion,
      inversePoseQuaternion: inverseQuaternion(numberScalarOps, poseQuaternion),
      surfaceClass: piece.surfaceClass,
      appearance: piece.appearance,
      sourceStatus: piece.sourceStatus,
      flags: piece.flags,
      editorial: piece.editorial,
    }));
  }
  return Object.freeze({
    requestedAgeMa,
    intervalId: interval.intervalId,
    intervalIndex: interval.intervalIndex,
    fromAgeMa: interval.fromAgeMa,
    toAgeMa: interval.toAgeMa,
    entryCount: charts.length,
    paletteValues,
    charts: Object.freeze(charts),
    activeChartCount,
    classChartOffsets: identity.classChartOffsets,
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
      `${identity.packageId}@${identity.packageRevision}:palaeo-${resident.surfaceClass}:${resident.record.payload.sha256}`,
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

/** What a citation lookup must return for a source id the catalog names. */
export interface PalaeoEvidenceCitation {
  readonly citation: string;
  readonly url?: string;
  readonly year?: number;
}

/**
 * The map key's and the layer control's view of what is on screen.
 *
 * Everything here is read off the prepared interval rather than declared: the
 * source ids are the ones whose charts are actually posed at this age, and a
 * chart counts as edited only where its own evidence record carries the
 * `editorial` line a cited basin modification writes. A source id that appears
 * only on edited charts is reported as an editorial reference, because that is
 * exactly the set the basin contract added; one that also carries an unedited
 * chart is the published map's own authority.
 */
export function palaeoCoastlineEvidenceSummary(
  prepared: PreparedCaoPalaeoInterval | null,
  state: Readonly<{ loading: boolean; unavailableReason: string | null }>,
  citation: (sourceId: string) => PalaeoEvidenceCitation | null = () => null,
): PalaeoCoastlineEvidence {
  const editedChartIds: string[] = [];
  const editorialSourceIds = new Set<string>();
  const publishedSourceIds = new Set<string>();
  const editorialLines = new Map<string, string>();
  for (const chart of prepared?.charts ?? []) {
    if (chart.support.kind !== "supported") continue;
    const edited = chart.editorial !== null;
    if (edited) editedChartIds.push(chart.chartId);
    for (const sourceId of chart.evidence.sourceIds) {
      if (!edited) publishedSourceIds.add(sourceId);
      else {
        editorialSourceIds.add(sourceId);
        editorialLines.set(sourceId, chart.editorial!);
      }
    }
  }
  const sourceIds = [...(prepared?.activeSourceIds ?? [])];
  const references: PalaeoEvidenceReference[] = [];
  for (const sourceId of sourceIds) {
    const record = citation(sourceId);
    if (record === null) continue;
    const editorial = editorialSourceIds.has(sourceId) && !publishedSourceIds.has(sourceId);
    references.push({
      sourceId,
      citation: record.citation,
      ...(record.url === undefined ? {} : { url: record.url }),
      ...(record.year === undefined ? {} : { year: record.year }),
      constrains: editorial ? editorialLines.get(sourceId)!
        : "Cao et al. (2017) published map polygons for this interval",
      claim: editorial ? "earthhistory-infers" : "source-states",
      editorial,
    });
  }
  return {
    intervalId: prepared?.intervalId ?? null,
    sourceIds,
    references,
    editedChartIds,
    unavailableReason: state.unavailableReason,
    loading: state.loading,
  };
}
