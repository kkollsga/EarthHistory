import { numberScalarOps, rotateDirection, slerpQuaternion, type QuaternionWxyz } from "./arithmetic";
import type { FrameKey, MaterialAddress, MaterialLifecycle, MaterialPose, MotionInterval, MotionSample, SupportState } from "./types";

const HEADER_BYTES = 32;
const RECORD_BYTES = 20;
const MAX_AGE_MICRO_MA = 540_000_000;

function frameIdentity(frame: FrameKey): string {
  return [frame.modelId, frame.modelVersion, frame.absoluteFrameId, frame.anchorPlateId,
    frame.axisConvention, frame.rotationSha256, frame.topologySha256].join("\u001f");
}

export interface MotionCatalog {
  schemaVersion: 1;
  id: string;
  frame: FrameKey;
  chartRevision: string;
  chartId: string;
  materialId: string;
  fragmentOrCohortId: string;
  plateId: number;
  referenceAgeMa: number;
  sourceIds: readonly string[];
  license: string;
  sourceIntervals: readonly { youngestAgeMa: number; oldestAgeMa: number;
    kind: "smooth-motion" | "source-knot" | "source-seam" }[];
  binary: { bytes: number; sha256: string; timeEncoding: "uint32-micro-ma"; quaternionEncoding: "float32-wxyz" };
}

export function decodeMotionTable(catalog: MotionCatalog, buffer: ArrayBuffer): MotionInterval {
  if (catalog.schemaVersion !== 1 || catalog.frame.axisConvention !== "gplates-x0e-y90e-znorth" ||
      catalog.frame.modelId.length === 0 || catalog.frame.modelVersion.length === 0 ||
      catalog.sourceIds.length === 0 || catalog.license.length === 0 || catalog.sourceIntervals.length === 0 ||
      catalog.sourceIntervals.some((interval) => interval.kind === "source-seam") ||
      catalog.sourceIntervals.some((interval) => !Number.isFinite(interval.youngestAgeMa) ||
        !Number.isFinite(interval.oldestAgeMa) || interval.youngestAgeMa < 0 || interval.oldestAgeMa > 540 ||
        interval.youngestAgeMa > interval.oldestAgeMa) ||
      buffer.byteLength !== catalog.binary.bytes ||
      buffer.byteLength < HEADER_BYTES) throw new Error("invalid compact motion catalog or length");
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== "EHRC" || view.getUint16(4, true) !== 1 ||
      view.getUint16(6, true) !== RECORD_BYTES || view.getUint32(12, true) !== catalog.plateId ||
      view.getUint32(28, true) !== 0) throw new Error("compact motion identity mismatch");
  const count = view.getUint32(8, true);
  if (HEADER_BYTES + count * RECORD_BYTES !== buffer.byteLength || count < 2) throw new Error("compact motion record length mismatch");
  const youngest = view.getUint32(16, true);
  const oldest = view.getUint32(20, true);
  const referenceAge = view.getUint32(24, true);
  if (oldest > MAX_AGE_MICRO_MA || youngest > oldest || referenceAge !== Math.round(catalog.referenceAgeMa * 1e6)) {
    throw new Error("compact motion age domain mismatch");
  }
  const samples: MotionSample[] = [];
  let previous = -1;
  for (let index = 0; index < count; index += 1) {
    const offset = HEADER_BYTES + index * RECORD_BYTES;
    const ageMicroMa = view.getUint32(offset, true);
    const quaternion: QuaternionWxyz = [view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true),
      view.getFloat32(offset + 12, true), view.getFloat32(offset + 16, true)];
    const norm = Math.hypot(...quaternion);
    if (ageMicroMa <= previous || !Number.isFinite(norm) || Math.abs(norm - 1) > 2e-6) {
      throw new Error("invalid compact motion sample");
    }
    const normalizedQuaternion = Object.freeze(
      quaternion.map((value) => value / norm),
    ) as unknown as QuaternionWxyz;
    samples.push(Object.freeze({ ageMicroMa, quaternion: normalizedQuaternion }));
    previous = ageMicroMa;
  }
  if (samples[0]!.ageMicroMa !== youngest || samples.at(-1)!.ageMicroMa !== oldest) {
    throw new Error("compact motion endpoints mismatch");
  }
  const smoothCoverage = catalog.sourceIntervals.some((sourceInterval) => sourceInterval.kind === "smooth-motion" &&
    Math.round(sourceInterval.youngestAgeMa * 1e6) === youngest &&
    Math.round(sourceInterval.oldestAgeMa * 1e6) === oldest);
  const sampleAges = new Set(samples.map((sample) => sample.ageMicroMa));
  const knotsValid = catalog.sourceIntervals.every((sourceInterval) => sourceInterval.kind !== "source-knot" ||
    (sourceInterval.youngestAgeMa === sourceInterval.oldestAgeMa &&
      sampleAges.has(Math.round(sourceInterval.youngestAgeMa * 1e6))));
  if (!smoothCoverage || !knotsValid) throw new Error("compact motion source interval mismatch");
  return Object.freeze({ catalogId: catalog.id, payloadSha256: catalog.binary.sha256,
    chartRevision: catalog.chartRevision, frameIdentity: frameIdentity(catalog.frame), plateId: catalog.plateId,
    referenceAgeMa: catalog.referenceAgeMa, youngestAgeMa: youngest / 1e6, oldestAgeMa: oldest / 1e6,
    samples: Object.freeze(samples) });
}

export async function decodeVerifiedMotionTable(
  catalog: MotionCatalog, buffer: ArrayBuffer, cryptoImplementation: Crypto = globalThis.crypto,
): Promise<MotionInterval> {
  const digest = [...new Uint8Array(await cryptoImplementation.subtle.digest("SHA-256", buffer))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== catalog.binary.sha256) throw new Error("compact motion sha256 mismatch");
  return decodeMotionTable(catalog, buffer);
}

export function validateMaterialLifecycle(lifecycle: MaterialLifecycle): boolean {
  const { oldest, youngest } = lifecycle.validTimeMa;
  if (!Number.isFinite(oldest) || !Number.isFinite(youngest) || youngest < 0 || oldest > 540 || youngest > oldest) {
    return false;
  }
  for (const event of [lifecycle.birth, lifecycle.loss]) {
    if (event && (!Number.isFinite(event.intervalMa[0]) || !Number.isFinite(event.intervalMa[1]) ||
        event.intervalMa[0] < event.intervalMa[1] ||
        event.intervalMa[0] > oldest || event.intervalMa[1] < youngest ||
        (event.status === "confirmed" && event.intervalMa[0] !== event.intervalMa[1]))) {
      return false;
    }
  }
  if (lifecycle.birth && lifecycle.loss && lifecycle.birth.intervalMa[1] < lifecycle.loss.intervalMa[0]) {
    return false;
  }
  return true;
}

export function evaluateLifecycleSupport(lifecycle: MaterialLifecycle, ageMa: number): SupportState | null {
  if (!validateMaterialLifecycle(lifecycle)) return { kind: "unsupported", reason: "invalid-address" };
  if (ageMa > lifecycle.validTimeMa.oldest) return { kind: "inactive", reason: "unborn" };
  if (ageMa < lifecycle.validTimeMa.youngest) return { kind: "inactive", reason: "consumed" };
  if (lifecycle.birth?.status === "confirmed" && ageMa > lifecycle.birth.intervalMa[0]) {
    return { kind: "inactive", reason: "unborn" };
  }
  if (lifecycle.loss?.status === "confirmed" && ageMa < lifecycle.loss.intervalMa[0]) {
    return { kind: "inactive", reason: "consumed" };
  }
  if (lifecycle.birth?.status === "bounded" && ageMa > lifecycle.birth.intervalMa[0]) {
    return { kind: "inactive", reason: "unborn" };
  }
  if (lifecycle.loss?.status === "bounded" && ageMa < lifecycle.loss.intervalMa[1]) {
    return { kind: "inactive", reason: "consumed" };
  }
  for (const [event, reason] of [[lifecycle.birth, "birth-bound"], [lifecycle.loss, "loss-bound"]] as const) {
    if (event?.status === "bounded" && ageMa <= event.intervalMa[0] && ageMa >= event.intervalMa[1]) {
      return { kind: "conditional", reason, intervalMa: event.intervalMa };
    }
  }
  return null;
}

export interface MotionSubsegment {
  readonly younger: MotionSample;
  readonly older: MotionSample;
  readonly fraction: number;
}

/** Selects the exact compiler interval and fraction used by both CPU and GPU adapters. */
export function selectMotionSubsegment(interval: MotionInterval, requestedAgeMa: number): MotionSubsegment | null {
  if (!Number.isFinite(requestedAgeMa) || requestedAgeMa < interval.youngestAgeMa ||
      requestedAgeMa > interval.oldestAgeMa) return null;
  const target = Math.round(requestedAgeMa * 1e6);
  let upper = interval.samples.findIndex((sample) => sample.ageMicroMa >= target);
  if (upper < 0) upper = interval.samples.length - 1;
  const older = interval.samples[upper]!;
  const younger = interval.samples[Math.max(0, upper - 1)]!;
  return Object.freeze({ younger, older, fraction: younger.ageMicroMa === older.ageMicroMa ? 0 :
    (target - younger.ageMicroMa) / (older.ageMicroMa - younger.ageMicroMa) });
}

export function evaluateMaterialPose(
  catalog: MotionCatalog, interval: MotionInterval, address: MaterialAddress,
  lifecycle: MaterialLifecycle, requestedAgeMa: number,
): MaterialPose {
  if (!Number.isFinite(requestedAgeMa) || requestedAgeMa < 0 || requestedAgeMa > 540) {
    return { address, requestedAgeMa, direction: null, support: { kind: "unsupported", reason: "outside-domain" } };
  }
  if (interval.catalogId !== catalog.id || interval.payloadSha256 !== catalog.binary.sha256 ||
      interval.chartRevision !== catalog.chartRevision || interval.frameIdentity !== frameIdentity(catalog.frame) ||
      interval.plateId !== catalog.plateId || interval.referenceAgeMa !== catalog.referenceAgeMa) {
    return { address, requestedAgeMa, direction: null, support: { kind: "unsupported", reason: "frame-mismatch" } };
  }
  if (address.chartRevision !== catalog.chartRevision || address.chartId !== catalog.chartId ||
      address.materialId !== catalog.materialId || address.fragmentOrCohortId !== catalog.fragmentOrCohortId ||
      address.cellOrTriangleId !== 0 || address.localCoordinate.kind !== "chart-direction") {
    return { address, requestedAgeMa, direction: null, support: { kind: "unsupported", reason: "invalid-address" } };
  }
  const referenceLength = Math.hypot(...address.localCoordinate.directionAtReference);
  if (!Number.isFinite(referenceLength) || Math.abs(referenceLength - 1) > 1e-6) {
    return { address, requestedAgeMa, direction: null, support: { kind: "unsupported", reason: "invalid-address" } };
  }
  const lifecycleState = evaluateLifecycleSupport(lifecycle, requestedAgeMa);
  if (lifecycleState) return { address, requestedAgeMa, direction: null, support: lifecycleState };
  if (requestedAgeMa < interval.youngestAgeMa || requestedAgeMa > interval.oldestAgeMa) {
    return { address, requestedAgeMa, direction: null, support: { kind: "unsupported", reason: "missing-motion" } };
  }
  const subsegment = selectMotionSubsegment(interval, requestedAgeMa);
  if (!subsegment) {
    return { address, requestedAgeMa, direction: null, support: { kind: "unsupported", reason: "missing-motion" } };
  }
  const { younger, older, fraction } = subsegment;
  const quaternion = younger.ageMicroMa === older.ageMicroMa ? younger.quaternion : slerpQuaternion(
    numberScalarOps, younger.quaternion, older.quaternion, fraction,
  );
  return { address, requestedAgeMa,
    direction: rotateDirection(numberScalarOps, quaternion, address.localCoordinate.directionAtReference),
    support: { kind: "supported", method: "compiled-rigid" } };
}

export function assertFrame(expected: FrameKey, actual: FrameKey): void {
  if (frameIdentity(expected) !== frameIdentity(actual)) throw new Error("reconstruction frame mismatch");
}
