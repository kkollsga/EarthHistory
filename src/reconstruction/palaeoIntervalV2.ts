/**
 * Motion evaluation and prepared-revision assembly for one palaeo-coastline
 * map interval.
 *
 * Two things separate this from `motionFrameV2`. The pose of a piece comes from
 * its own catalog binding — the partition it was cookie-cut by, or the tracked
 * `PLATEID1` override, or an explicit North Sea restoration entry — rather than
 * from a package chart's motion bindings. And activation is evaluated against
 * the piece's own `(TOAGE, FROMAGE]` lifecycle at the support age, not against
 * the interval the payload file covers: an off-schedule source record ships
 * inside every canonical interval it overlaps and must stop being drawn on its
 * own date, inside the interval.
 */

import { PREPARED_MOTION_PALETTE_STRIDE, type PreparedCaoChartIdentity,
  type PreparedCaoSpatialBatch } from "./facadeV2";
import { prepareSurfaceBatch } from "./surfaceSource";
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

export interface CaoPalaeoChartIdentity extends PreparedCaoChartIdentity {
  readonly surfaceClass: PalaeoSurfaceClass;
  readonly appearance: SpatialBatchSurfaceAppearanceV2;
  /** The catalog's own evidence status, kept beside the mapped runtime status. */
  readonly sourceStatus: PalaeoCoastlineEvidenceRecord["status"];
  readonly flags: number;
  readonly editorial: string | null;
}

export interface CaoPalaeoIntervalFrame {
  /**
   * The age the charts are actually posed at — the caller's requested age,
   * except where the far-jump guard below fell back to `supportAgeMa`. This is
   * what a diagnostic, a probe or a published revision reports as the frame's
   * age, because it is the age the geometry on screen is standing at.
   */
  readonly requestedAgeMa: number;
  /**
   * The age the lifecycles were judged at: inside the interval's own
   * `(TOAGE, FROMAGE]` always, and equal to `requestedAgeMa` except across a
   * boundary, where the outgoing interval keeps drawing whatever its pieces
   * supported at its edge while their poses follow the live age.
   */
  readonly supportAgeMa: number;
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
 * The store owns residency (three intervals at a time), so this cache is bounded
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
 * The five support verdicts a palaeo piece can carry.
 *
 * None of them holds piece-specific data, so one frozen constant each is what
 * the frame assigns; a scrub inside an interval changes which constant a chart
 * points at, never the object's contents.
 */
const PALAEO_SUPPORT_UNBORN: SupportState =
  Object.freeze({ kind: "inactive", reason: "unborn" });
const PALAEO_SUPPORT_CONSUMED: SupportState =
  Object.freeze({ kind: "inactive", reason: "consumed" });
const PALAEO_SUPPORT_COMPILED_RIGID: SupportState =
  Object.freeze({ kind: "supported", method: "compiled-rigid" });
const PALAEO_SUPPORT_SOURCE_SEAM: SupportState =
  Object.freeze({ kind: "unsupported", reason: "source-seam" });
const PALAEO_SUPPORT_MISSING_MOTION: SupportState =
  Object.freeze({ kind: "unsupported", reason: "missing-motion" });

type MutablePalaeoChart = { -readonly [K in keyof CaoPalaeoChartIdentity]: CaoPalaeoChartIdentity[K] };
type MutableQuaternion = [number, number, number, number];

/**
 * Everything one evaluated frame writes, allocated once per resident interval.
 *
 * A scrub re-poses the same 3,000-plus pieces on every frame, and the measured
 * cost of that frame was almost all allocation: one frozen chart object and two
 * quaternions per piece, a fresh palette buffer, and two `Set`s plus a sort
 * whose result only moves when a piece's activation bit moves. The pieces are
 * the interval's, so this scratch is the interval's too, and the store's
 * residency bound is what evicts it (`PALAEO_FRAME_SCRATCH` is a `WeakMap` for
 * exactly that reason). The evaluated frame is a fresh wrapper over it, so a
 * consumer that compares frame identity — React state, a render effect — still
 * sees a new frame per evaluation.
 */
interface PalaeoIntervalFrameScratch {
  readonly charts: readonly MutablePalaeoChart[];
  readonly poses: readonly MutableQuaternion[];
  readonly inversePoses: readonly MutableQuaternion[];
  readonly paletteValues: Float32Array;
  /** Last evaluated activation bit per piece; the source lists follow it. */
  readonly activation: Uint8Array;
  evaluated: boolean;
  activeChartCount: number;
  activeSourceIds: readonly string[];
  activeLimitations: readonly string[];
}

const PALAEO_FRAME_SCRATCH = new WeakMap<LoadedPalaeoInterval, PalaeoIntervalFrameScratch>();

function palaeoIntervalFrameScratch(
  interval: LoadedPalaeoInterval,
  identity: PalaeoIntervalIdentityTable,
): PalaeoIntervalFrameScratch {
  const cached = PALAEO_FRAME_SCRATCH.get(interval);
  if (cached) return cached;
  const charts: MutablePalaeoChart[] = [];
  const poses: MutableQuaternion[] = [];
  const inversePoses: MutableQuaternion[] = [];
  for (const piece of identity.pieces) {
    const poseQuaternion: MutableQuaternion = [1, 0, 0, 0];
    const inversePoseQuaternion: MutableQuaternion = [1, 0, 0, 0];
    poses.push(poseQuaternion);
    inversePoses.push(inversePoseQuaternion);
    // The quaternion arrays are the chart's own for the life of the interval:
    // a frame writes into them rather than replacing them.
    charts.push({
      chartId: piece.chartId,
      chartRevision: piece.chartRevision,
      materialId: piece.materialId,
      fragmentOrCohortId: piece.fragmentOrCohortId,
      role: "model-geography",
      support: PALAEO_SUPPORT_MISSING_MOTION,
      evidence: piece.evidence,
      surfaceEvidence: piece.surfaceEvidence,
      poseQuaternion,
      inversePoseQuaternion,
      surfaceClass: piece.surfaceClass,
      appearance: piece.appearance,
      sourceStatus: piece.sourceStatus,
      flags: piece.flags,
      editorial: piece.editorial,
    });
  }
  const scratch: PalaeoIntervalFrameScratch = {
    charts: Object.freeze(charts),
    poses: Object.freeze(poses),
    inversePoses: Object.freeze(inversePoses),
    paletteValues: new Float32Array(identity.pieces.length * PREPARED_MOTION_PALETTE_STRIDE),
    activation: new Uint8Array(identity.pieces.length),
    evaluated: false,
    activeChartCount: 0,
    activeSourceIds: Object.freeze([]),
    activeLimitations: Object.freeze([]),
  };
  PALAEO_FRAME_SCRATCH.set(interval, scratch);
  return scratch;
}

/**
 * How far outside its own interval a pose age may still be honoured.
 *
 * The pose age leaves the interval only while a boundary crossing waits for the
 * incoming map to publish, which is a frame or two of scrub — a fraction of a
 * megayear at any usable scrub rate. A jump of tens of megayears is a slider
 * throw or a bookmark, not a crossing, and rotating this interval's polygons to
 * an age its geometry never described would be extrapolation the source model
 * does not support. Past this limit the pose falls back to the support age, so
 * the outgoing map stands still for the frames before the right one lands.
 */
const PALAEO_POSE_EXCURSION_LIMIT_MA = 30;

/**
 * Poses every piece of every resident class against the palette entries the
 * runtime already holds, and marks each one active or inactive. Inactive pieces
 * stay in the frame with activation 0: the static geometry belongs to the
 * interval, so scrubbing inside an interval must not replace it.
 *
 * Two ages, because a boundary crossing separates them. `poseAgeMa` is the age
 * the caller is actually showing, and it drives the palette lookup and the
 * quaternions: the palette is one global, continuous rotation history, so it
 * answers just as well a little outside this interval, and an outgoing map that
 * keeps rotating with the country outlines reads as one moving Earth instead of
 * a frozen map under sliding outlines. `supportAgeMa` must lie inside the
 * interval's own `(TOAGE, FROMAGE]` and is what the lifecycles are judged at:
 * the compiled lifecycle of a piece ends at the interval's own young edge, so
 * judging it at a live age past the boundary would call every piece consumed
 * and blank the map — the opposite of what the live pose is for. Held at the
 * edge, a retiring piece keeps the last support verdict its own dates justify.
 * Callers with a single age pass it once and the two collapse.
 *
 * The returned frame is a new object over the interval's reusable buffers: the
 * charts, their quaternions and the palette values are the same instances the
 * previous frame for this interval returned, rewritten in place. A consumer
 * that must keep a frame beyond the next evaluation copies it — which is what
 * `createPreparedCaoPalaeoInterval` does for the published revision.
 */
export function evaluateCaoPalaeoIntervalFrame(
  interval: LoadedPalaeoInterval,
  paletteEntries: ReadonlyMap<string, PreparedPaletteEntry>,
  poseAgeMa: number,
  supportAgeMa: number = poseAgeMa,
): CaoPalaeoIntervalFrame {
  if (!Number.isFinite(poseAgeMa) || !Number.isFinite(supportAgeMa)) {
    throw new Error("palaeo-coastline age is not finite");
  }
  if (!(supportAgeMa > interval.toAgeMa && supportAgeMa <= interval.fromAgeMa)) {
    throw new Error("palaeo-coastline age is outside the resident interval");
  }
  const excursionMa = Math.max(interval.toAgeMa - poseAgeMa, poseAgeMa - interval.fromAgeMa, 0);
  const requestedAgeMa = excursionMa > PALAEO_POSE_EXCURSION_LIMIT_MA ? supportAgeMa : poseAgeMa;
  const identity = palaeoIntervalIdentityTable(interval);
  const scratch = palaeoIntervalFrameScratch(interval, identity);
  const { paletteValues } = scratch;
  let activationMoved = !scratch.evaluated;
  let activeChartCount = 0;
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
    const lifecycleActive = palaeoLifecycleActiveAtAge(piece.lifecycle, supportAgeMa);
    // An unposable piece is not drawn. A declared source seam says so as
    // `source-seam`: the model has a hole here, which is a different claim
    // from a palette entry that has not finished downloading.
    const support: SupportState = !lifecycleActive
      ? supportAgeMa > piece.lifecycle.oldestMa ? PALAEO_SUPPORT_UNBORN : PALAEO_SUPPORT_CONSUMED
      : segment ? PALAEO_SUPPORT_COMPILED_RIGID
      : palaeoBindingSeamCoversAge(piece.binding, requestedAgeMa)
        ? PALAEO_SUPPORT_SOURCE_SEAM : PALAEO_SUPPORT_MISSING_MOTION;
    const younger: QuaternionWxyz = segment?.younger.quaternion ?? [1, 0, 0, 0];
    const older: QuaternionWxyz = segment?.older.quaternion ?? younger;
    const poseQuaternion = slerpQuaternion(numberScalarOps, younger, older, segment?.fraction ?? 0);
    const inversePoseQuaternion = inverseQuaternion(numberScalarOps, poseQuaternion);
    const activation = support.kind === "supported" ? 1 : 0;
    const base = pieceIndex * PREPARED_MOTION_PALETTE_STRIDE;
    paletteValues.set(younger, base);
    paletteValues.set(older, base + 4);
    paletteValues[base + 8] = segment?.fraction ?? 0;
    paletteValues[base + 9] = activation;
    paletteValues[base + 10] = activation;
    if (activation === 1) activeChartCount += 1;
    if (scratch.activation[pieceIndex] !== activation) {
      scratch.activation[pieceIndex] = activation;
      activationMoved = true;
    }
    const pose = scratch.poses[pieceIndex]!;
    const inversePose = scratch.inversePoses[pieceIndex]!;
    for (let component = 0; component < 4; component += 1) {
      pose[component] = poseQuaternion[component]!;
      inversePose[component] = inversePoseQuaternion[component]!;
    }
    scratch.charts[pieceIndex]!.support = support;
  }
  // The active source and limitation lists are a function of the activation
  // bits alone, and those move on a handful of frames per interval, so the
  // sets and the sort are rebuilt only when one of them actually moved.
  if (activationMoved) {
    const activeSourceIds = new Set<string>();
    const activeLimitations = new Set<string>();
    for (const [pieceIndex, piece] of identity.pieces.entries()) {
      if (scratch.activation[pieceIndex] !== 1) continue;
      for (const sourceId of piece.sourceIds) activeSourceIds.add(sourceId);
      for (const limitation of piece.limitations) activeLimitations.add(limitation);
    }
    scratch.activeSourceIds = Object.freeze([...activeSourceIds].sort());
    scratch.activeLimitations = Object.freeze([...activeLimitations]);
  }
  scratch.evaluated = true;
  scratch.activeChartCount = activeChartCount;
  return Object.freeze({
    requestedAgeMa,
    supportAgeMa,
    intervalId: interval.intervalId,
    intervalIndex: interval.intervalIndex,
    fromAgeMa: interval.fromAgeMa,
    toAgeMa: interval.toAgeMa,
    entryCount: scratch.charts.length,
    paletteValues,
    charts: scratch.charts,
    activeChartCount,
    classChartOffsets: identity.classChartOffsets,
    activeSourceIds: scratch.activeSourceIds,
    activeLimitations: scratch.activeLimitations,
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

/**
 * States one resident class as an EHPR surface source and prepares it through
 * the one surface-source path. The offset a class starts at is the sum of the
 * piece counts of the classes before it, which is only known once all classes
 * of the interval are resident, so it is applied here and not in the worker.
 */
function preparedBatch(
  resident: LoadedPalaeoIntervalClass,
  chartOffset: number,
  chartCount: number,
  identity: PreparedCaoPalaeoIntervalIdentity,
  requirePayload: () => LoadedPalaeoIntervalClass,
): PreparedCaoSpatialBatch {
  const { geometry } = resident;
  return prepareSurfaceBatch({
    kind: "ehpr",
    batchId: `palaeo-${resident.surfaceClass}`,
    staticGeometryIdentity:
      `${identity.packageId}@${identity.packageRevision}:palaeo-${resident.surfaceClass}:${resident.record.payload.sha256}`,
    vertexCount: geometry.vertexCount,
    triangleCount: geometry.triangleCount,
    chartCount,
    surfaceAppearance: PALAEO_SURFACE_CLASS_APPEARANCES[resident.surfaceClass],
    chartIndexOffset: chartOffset,
    pieceTriangleRanges: geometry.pieceTriangleRanges,
    requireGeometry: () => requirePayload().geometry,
    baseColorRgb: identity.baseColorRgb[resident.surfaceClass],
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
  // The evaluated frame is reused by every later retarget of this interval, so
  // the published revision takes its own immutable copy: a publication states
  // the age it was prepared at, and a scrub must not move the poses a published
  // revision reports under it. This is one copy per crossing, not per frame.
  let paletteValues: Float32Array | null = new Float32Array(frame.paletteValues);
  const charts: readonly CaoPalaeoChartIdentity[] = Object.freeze(frame.charts.map((chart) =>
    Object.freeze({ ...chart,
      poseQuaternion: Object.freeze([...chart.poseQuaternion]) as unknown as typeof chart.poseQuaternion,
      inversePoseQuaternion:
        Object.freeze([...chart.inversePoseQuaternion]) as unknown as typeof chart.inversePoseQuaternion })));
  const maximumEdgeDegrees = interval.classes.reduce(
    (largest, entry) => Math.max(largest, entry.geometry.maximumEdgeDegrees), 0);
  const batches = interval.classes.map((entry) => preparedBatch(entry,
    frame.classChartOffsets.get(entry.surfaceClass)!, charts.length, identity, () => {
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
    charts,
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
