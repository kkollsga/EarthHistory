import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gplatesToRendererDirection, numberScalarOps, radialHeightScale, relativePoseQuaternion,
  rotateDirection, slerpQuaternion } from "./arithmetic";
import { assertFrame, decodeMotionTable, decodeVerifiedMotionTable, evaluateLifecycleSupport, evaluateMaterialPose, selectMotionSubsegment,
  type MotionCatalog } from "./motion";
import type { MaterialAddress, MaterialLifecycle } from "./types";

const fixtureRoot = "src/reconstruction/fixtures";
const catalog = JSON.parse(readFileSync(`${fixtureRoot}/cao-motion-0-5-v1.json`, "utf8")) as MotionCatalog;
const bytes = readFileSync(`${fixtureRoot}/cao-motion-0-5-v1.bin`);
const oracle = JSON.parse(readFileSync(`${fixtureRoot}/cao-motion-0-5-v1.oracle.json`, "utf8")) as {
  referenceDirection: [number, number, number];
  angularToleranceRad: number;
  expected: Array<{ ageMa: number; direction: [number, number, number] }>;
};
const interval = decodeMotionTable(catalog, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const address: MaterialAddress = {
  chartRevision: catalog.chartRevision,
  chartId: catalog.chartId,
  materialId: catalog.materialId,
  fragmentOrCohortId: catalog.fragmentOrCohortId,
  cellOrTriangleId: 0,
  localCoordinate: { kind: "chart-direction", directionAtReference: oracle.referenceDirection },
};
const active: MaterialLifecycle = { validTimeMa: { oldest: 5, youngest: 0 } };

function angularError(left: readonly number[], right: readonly number[]): number {
  const cross = [left[1]! * right[2]! - left[2]! * right[1]!, left[2]! * right[0]! - left[0]! * right[2]!,
    left[0]! * right[1]! - left[1]! * right[0]!];
  return Math.atan2(Math.hypot(...cross), Math.max(-1, Math.min(1, left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!)));
}

describe("compiled reconstruction motion core", () => {
  it("supports strictly-older adjacent phases without an age gap or exact-boundary overlap", () => {
    const native = { validTimeMa: { youngest: 0, oldest: 410 } } as const;
    const qualified = { validTimeMa: { youngest: 410, oldest: 430 }, youngestExclusive: true } as const;
    const uncertain = { validTimeMa: { youngest: 430, oldest: 540 }, youngestExclusive: true } as const;

    expect(evaluateLifecycleSupport(native, 410)).toBeNull();
    expect(evaluateLifecycleSupport(qualified, 410)?.kind).toBe("inactive");
    expect(evaluateLifecycleSupport(qualified, 410 + 1e-7)).toBeNull();
    expect(evaluateLifecycleSupport(qualified, 410 + 1e-6)).toBeNull();
    expect(evaluateLifecycleSupport(qualified, 430)).toBeNull();
    expect(evaluateLifecycleSupport(uncertain, 430)?.kind).toBe("inactive");
    expect(evaluateLifecycleSupport(uncertain, 430 + 1e-7)).toBeNull();
  });

  it("decodes pinned float32 motion with micro-Ma time and a nonzero chart reference age", () => {
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(catalog.binary.sha256);
    expect(interval.samples).toHaveLength(34);
    expect(interval.samples.some((sample) => sample.ageMicroMa === 3_000_000)).toBe(true);
    expect(catalog.referenceAgeMa).toBe(5);
    const pose = evaluateMaterialPose(catalog, interval, address, active, 5);
    expect(pose.support.kind).toBe("supported");
    expect(angularError(pose.direction!, oracle.referenceDirection)).toBeLessThan(1e-7);
  });

  it("verifies the payload digest before decoding", async () => {
    await expect(decodeVerifiedMotionTable(catalog,
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).resolves.toEqual(interval);
    const corrupt = new Uint8Array(bytes); corrupt[corrupt.length - 1] ^= 1;
    await expect(decodeVerifiedMotionTable(catalog, corrupt.buffer)).rejects.toThrow(/sha256/);
  });

  it("agrees with independent pyGPlates held-out directions in either query order", () => {
    const forward = oracle.expected.map(({ ageMa }) => evaluateMaterialPose(catalog, interval, address, active, ageMa));
    const reverse = [...oracle.expected].reverse().map(({ ageMa }) => evaluateMaterialPose(catalog, interval, address, active, ageMa)).reverse();
    for (let index = 0; index < oracle.expected.length; index += 1) {
      expect(angularError(forward[index]!.direction!, oracle.expected[index]!.direction)).toBeLessThan(oracle.angularToleranceRad);
      expect(angularError(forward[index]!.direction!, reverse[index]!.direction!)).toBe(0);
    }
  });

  it("publishes the same rounded motion subsegment used by the evaluator", () => {
    const selected = selectMotionSubsegment(interval, 3.37)!;
    expect(selected.younger.ageMicroMa).toBeLessThanOrEqual(3_370_000);
    expect(selected.older.ageMicroMa).toBeGreaterThanOrEqual(3_370_000);
    expect(selected.fraction).toBeGreaterThanOrEqual(0);
    expect(selected.fraction).toBeLessThanOrEqual(1);
    expect(selectMotionSubsegment(interval, 6)).toBeNull();
    expect(() => { (interval.samples[0] as { ageMicroMa: number }).ageMicroMa = 1; }).toThrow();
    expect(() => { (interval.samples[0]!.quaternion as unknown as number[])[0] = 0; }).toThrow();
  });

  it("moves arbitrary chart-local directions continuously without nearest-seed identity", () => {
    const second = structuredClone(address);
    second.localCoordinate = { kind: "chart-direction", directionAtReference: [0.2, 0.3, Math.sqrt(0.87)] };
    const firstPose = evaluateMaterialPose(catalog, interval, address, active, 3.37);
    const secondPose = evaluateMaterialPose(catalog, interval, second, active, 3.37);
    expect(firstPose.address.materialId).toBe(secondPose.address.materialId);
    expect(angularError(firstPose.direction!, secondPose.direction!)).toBeGreaterThan(0.1);
  });

  it("returns typed lifecycle and address failures", () => {
    expect(evaluateMaterialPose(catalog, interval, address, { validTimeMa: { oldest: 5, youngest: 1 } }, 5.5).support)
      .toEqual({ kind: "inactive", reason: "unborn" });
    expect(evaluateMaterialPose(catalog, interval, address, { validTimeMa: { oldest: 5, youngest: 1 } }, 0).support)
      .toEqual({ kind: "inactive", reason: "consumed" });
    expect(evaluateMaterialPose(catalog, interval, address, {
      validTimeMa: { oldest: 5, youngest: 0 }, birth: { status: "bounded", intervalMa: [4, 3] },
    }, 3.5).support.kind).toBe("conditional");
    expect(evaluateMaterialPose(catalog, interval, address, {
      validTimeMa: { oldest: 5, youngest: 0 }, birth: { status: "bounded", intervalMa: [4, 3] },
    }, 4.5).support).toEqual({ kind: "inactive", reason: "unborn" });
    expect(evaluateMaterialPose(catalog, interval, address, {
      validTimeMa: { oldest: 5, youngest: 0 }, loss: { status: "bounded", intervalMa: [2, 1] },
    }, 0.5).support).toEqual({ kind: "inactive", reason: "consumed" });
    expect(evaluateMaterialPose(catalog, interval, address, {
      validTimeMa: { oldest: 5, youngest: 0 }, loss: { status: "confirmed", intervalMa: [2, 2] },
    }, 1).support).toEqual({ kind: "inactive", reason: "consumed" });
    expect(evaluateMaterialPose(catalog, interval, address, {
      validTimeMa: { oldest: Number.NaN, youngest: 0 },
    }, 1).support.kind).toBe("unsupported");
    expect(evaluateMaterialPose(catalog, interval, address, {
      validTimeMa: { oldest: 0, youngest: 5 },
    }, 1).support.kind).toBe("unsupported");
    expect(evaluateMaterialPose(catalog, interval, address, {
      validTimeMa: { oldest: 5, youngest: 0 }, birth: { status: "bounded", intervalMa: [6, 4] },
    }, 4.5).support.kind).toBe("unsupported");
    expect(evaluateMaterialPose(catalog, interval, address, {
      validTimeMa: { oldest: 5, youngest: 0 }, birth: { status: "bounded", intervalMa: [3, 2] },
      loss: { status: "bounded", intervalMa: [4, 3] },
    }, 3).support.kind).toBe("unsupported");
    expect(evaluateMaterialPose(catalog, interval, { ...address, chartRevision: "wrong" }, active, 3).support)
      .toEqual({ kind: "unsupported", reason: "invalid-address" });
    const invalidDirection = structuredClone(address);
    invalidDirection.localCoordinate = { kind: "chart-direction", directionAtReference: [2, 0, 0] };
    expect(evaluateMaterialPose(catalog, interval, invalidDirection, active, 3).support)
      .toEqual({ kind: "unsupported", reason: "invalid-address" });
    expect(evaluateMaterialPose(catalog, { ...interval, frameIdentity: "wrong" }, address, active, 3).support)
      .toEqual({ kind: "unsupported", reason: "frame-mismatch" });
  });

  it("rejects corrupt lengths, identities, frames, and numerical motion mutation", () => {
    expect(() => decodeMotionTable(catalog, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength - 1))).toThrow(/length/);
    const identityMutation = new Uint8Array(bytes);
    new DataView(identityMutation.buffer).setUint32(12, catalog.plateId + 1, true);
    expect(() => decodeMotionTable(catalog, identityMutation.buffer)).toThrow(/identity/);
    expect(() => assertFrame(catalog.frame, { ...catalog.frame, anchorPlateId: 1 })).toThrow(/frame/);
    expect(() => assertFrame(catalog.frame, { topologySha256: catalog.frame.topologySha256,
      rotationSha256: catalog.frame.rotationSha256, axisConvention: catalog.frame.axisConvention,
      anchorPlateId: catalog.frame.anchorPlateId, absoluteFrameId: catalog.frame.absoluteFrameId,
      modelVersion: catalog.frame.modelVersion, modelId: catalog.frame.modelId })).not.toThrow();
    expect(evaluateMaterialPose(catalog, { ...interval, payloadSha256: "changed" }, address, active, 3).support.kind)
      .toBe("unsupported");
    expect(evaluateMaterialPose(catalog, { ...interval, chartRevision: "changed" }, address, active, 3).support.kind)
      .toBe("unsupported");
    expect(() => decodeMotionTable({ ...catalog, sourceIntervals: [
      { kind: "source-seam", youngestAgeMa: 2, oldestAgeMa: 2 },
    ] }, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toThrow(/catalog/);
    expect(() => decodeMotionTable({ ...catalog, sourceIntervals: [
      { kind: "smooth-motion", youngestAgeMa: 100, oldestAgeMa: 105 },
    ] }, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).toThrow(/source interval/);

    const normMutation = new Uint8Array(bytes);
    new DataView(normMutation.buffer).setFloat32(32 + 4, 2, true);
    expect(() => decodeMotionTable(catalog, normMutation.buffer)).toThrow(/sample/);

    const motionMutation = new Uint8Array(bytes);
    const view = new DataView(motionMutation.buffer);
    const knotIndex = interval.samples.findIndex((sample) => sample.ageMicroMa === 3_000_000);
    const knot = 32 + knotIndex * 20;
    view.setFloat32(knot + 4, 1, true); view.setFloat32(knot + 8, 0, true);
    view.setFloat32(knot + 12, 0, true); view.setFloat32(knot + 16, 0, true);
    const mutated = decodeMotionTable(catalog, motionMutation.buffer);
    const expected = oracle.expected.reduce((nearest, candidate) =>
      Math.abs(candidate.ageMa - 3) < Math.abs(nearest.ageMa - 3) ? candidate : nearest);
    expect(angularError(evaluateMaterialPose(catalog, mutated, address, active, expected.ageMa).direction!, expected.direction))
      .toBeGreaterThan(oracle.angularToleranceRad);
  });

  it("uses the shared arithmetic kernel for antipodal signs and radial height", () => {
    const direction: [number, number, number] = [1, 0, 0];
    const positive = slerpQuaternion(numberScalarOps, [1, 0, 0, 0], [0.999, 0, 0.0447101778, 0], 0.4);
    const negative = slerpQuaternion(numberScalarOps, [1, 0, 0, 0], [-0.999, 0, -0.0447101778, 0], 0.4);
    expect(angularError(rotateDirection(numberScalarOps, positive, direction), rotateDirection(numberScalarOps, negative, direction))).toBeLessThan(1e-12);
    expect(radialHeightScale(numberScalarOps, 1_000, 30)).toBeCloseTo(1 + 30_000 / 6_371_000, 12);
    expect(relativePoseQuaternion(numberScalarOps, [0, 0, 1, 0], [0, 0, 1, 0]))
      .toEqual([1, 0, 0, 0]);
    expect(gplatesToRendererDirection(numberScalarOps, [1, 2, 3])).toEqual([1, 3, -2]);
  });
});
