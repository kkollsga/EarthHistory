import { describe, expect, it } from "vitest";
import { validateAndDecodeNativeBoundaryLayer, validateAndDecodeTopologyOwnershipLayer,
  type NativeBoundaryCatalogV2, type TopologyOwnershipCatalogV2 } from "./nativeLayersV2";
import type { FrameKey } from "./types";

const sha = "a".repeat(64);
const frame: FrameKey = { modelId: "cao", modelVersion: "2.4", absoluteFrameId: "mantle",
  anchorPlateId: 0, axisConvention: "gplates-x0e-y90e-znorth", rotationSha256: sha, topologySha256: sha };

function points(magic: "EHNB" | "EHTO", ageMa = 450): ArrayBuffer {
  const buffer = new ArrayBuffer(32 + 3 * 12);
  const bytes = new Uint8Array(buffer);
  bytes.set([...magic].map((letter) => letter.charCodeAt(0)));
  const view = new DataView(buffer);
  view.setUint16(4, 2, true); view.setUint16(6, 32, true); view.setUint32(8, 3, true);
  view.setUint32(12, 12, true); view.setUint32(16, ageMa * 1_000_000, true);
  new Float32Array(buffer, 32).set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  return buffer;
}

const binary = { url: "native.bin", bytes: 68, sha256: sha };
const expected = { packageId: "p", revision: "r", frame, sourceAgeMa: 450, binary };

describe("Cao native exact-knot packed layers", () => {
  it("validates boundary identity, coverage, and unit directions", () => {
    const catalog: NativeBoundaryCatalogV2 = { schemaVersion: 2, packageId: "p", revision: "r", frame,
      sourceAgeMa: 450, pointEncoding: "ehnb-v2-f32xyz", pointRecordBytes: 12, binary,
      segments: [{ segmentId: "s", sourceFeatureId: "f", sourcePart: 0, sourceFeatureType: "gpml:Ridge",
        validTimeMa: { youngest: 400, oldest: 500 }, kind: "ridge", polarity: "unknown",
        rightTopologyId: null, leftTopologyId: null, rightPlateId: null, leftPlateId: null,
        ownershipStatus: "unknown", pointOffset: 0, pointCount: 3 }] };
    expect(validateAndDecodeNativeBoundaryLayer(catalog, points("EHNB"), expected).pointCount).toBe(3);
    const corrupt = points("EHNB");
    new Float32Array(corrupt, 32)[0] = 0;
    expect(() => validateAndDecodeNativeBoundaryLayer(catalog, corrupt, expected)).toThrow(/unit direction/);
  });

  it("requires polygon grouping and an exterior ring before holes", () => {
    const base: TopologyOwnershipCatalogV2 = { schemaVersion: 2, packageId: "p", revision: "r", frame,
      sourceAgeMa: 450, pointEncoding: "ehto-v2-f32xyz", pointRecordBytes: 12, binary,
      rings: [{ ringId: "r", polygonId: "p1", ringRole: "exterior", topologyId: "t", plateId: 1,
        status: "instantaneous-owner", candidatePlateIds: [1], pointOffset: 0, pointCount: 3 }] };
    expect(validateAndDecodeTopologyOwnershipLayer(base, points("EHTO"), expected).pointCount).toBe(3);
    const holeOnly = { ...base, rings: [{ ...base.rings[0]!, ringRole: "hole" as const }] };
    expect(() => validateAndDecodeTopologyOwnershipLayer(holeOnly, points("EHTO"), expected)).toThrow(/catalog/);
  });
});
