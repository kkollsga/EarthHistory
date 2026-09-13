import { describe, expect, it } from "vitest";
import { decodeMotionPalette, selectPaletteMotionSubsegment, type MotionPaletteCatalog } from "./palette";

const frame = {
  modelId: "test-model",
  modelVersion: "1",
  absoluteFrameId: "test-frame",
  anchorPlateId: 0,
  axisConvention: "gplates-x0e-y90e-znorth" as const,
  rotationSha256: "1".repeat(64),
  topologySha256: "2".repeat(64),
};

function singletonPalette(sampleAgeMicroMa = 0): { catalog: MotionPaletteCatalog; buffer: ArrayBuffer } {
  const buffer = new ArrayBuffer(52);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x45, 0x48, 0x4d, 0x50]);
  const view = new DataView(buffer);
  view.setUint16(4, 2, true);
  view.setUint16(6, 20, true);
  view.setUint32(8, 1, true);
  view.setUint32(12, 1, true);
  view.setUint32(16, 32, true);
  view.setUint32(32, sampleAgeMicroMa, true);
  view.setFloat32(36, 1, true);
  const catalog: MotionPaletteCatalog = {
    schemaVersion: 2,
    id: "test-palette",
    packageId: "test-package",
    revision: "test-revision",
    frame,
    binary: {
      bytes: buffer.byteLength,
      sha256: "3".repeat(64),
      timeEncoding: "uint32-micro-ma",
      quaternionEncoding: "float32-wxyz",
    },
    entries: [{
      entryId: "present-identity",
      plateId: 0,
      storedCoordinateBasis: { kind: "supported-reference", geometryReferenceAgeMa: 0 },
      youngestAgeMa: 0,
      oldestAgeMa: 0,
      sampleOffset: 0,
      sampleCount: 1,
      sourceIds: ["present-reference"],
      sourceIntervalSetId: "present-clock",
    }],
    sourceIntervalSets: [{ id: "present-clock", intervals: [
      { youngestAgeMa: 0, oldestAgeMa: 0, kind: "smooth-motion" },
      { youngestAgeMa: 0, oldestAgeMa: 0, kind: "source-knot" },
    ] }],
  };
  return { catalog, buffer };
}

describe("shared motion palette exact-age entries", () => {
  it("accepts one normalized sample only for its exact declared age", () => {
    const { catalog, buffer } = singletonPalette();
    const decoded = decodeMotionPalette(catalog, buffer);
    const entry = decoded.get("present-identity")!;
    expect(selectPaletteMotionSubsegment(entry, 0)).toMatchObject({
      younger: { ageMicroMa: 0, quaternion: [1, 0, 0, 0] },
      older: { ageMicroMa: 0, quaternion: [1, 0, 0, 0] },
      fraction: 0,
    });
    expect(selectPaletteMotionSubsegment(entry, 0.000001)).toBeNull();
  });

  it("rejects a singleton used for a ranged motion entry", () => {
    const { catalog, buffer } = singletonPalette();
    const ranged = { ...catalog, entries: catalog.entries.map((entry) => ({ ...entry, oldestAgeMa: 1 })) };
    expect(() => decodeMotionPalette(ranged, buffer)).toThrow(/invalid shared motion palette entry/);
  });

  it("rejects a singleton whose sample timestamp or smooth interval differs from the exact age", () => {
    const timestampMutation = singletonPalette(1);
    expect(() => decodeMotionPalette(timestampMutation.catalog, timestampMutation.buffer))
      .toThrow(/source interval mismatch/);

    const { catalog, buffer } = singletonPalette();
    const intervalMutation = { ...catalog, sourceIntervalSets: [{ id: "present-clock", intervals: [
      { youngestAgeMa: 0, oldestAgeMa: 0.0000001, kind: "smooth-motion" as const },
      { youngestAgeMa: 0, oldestAgeMa: 0, kind: "source-knot" as const },
    ] }] };
    expect(() => decodeMotionPalette(intervalMutation, buffer)).toThrow(/source interval mismatch/);

    const extraIntervalMutation = { ...catalog, sourceIntervalSets: [{ id: "present-clock", intervals: [
      { youngestAgeMa: 0, oldestAgeMa: 0, kind: "smooth-motion" as const },
      { youngestAgeMa: 0, oldestAgeMa: 0.0000001, kind: "smooth-motion" as const },
      { youngestAgeMa: 0, oldestAgeMa: 0, kind: "source-knot" as const },
    ] }] };
    expect(() => decodeMotionPalette(extraIntervalMutation, buffer)).toThrow(/source interval mismatch/);
  });
});
