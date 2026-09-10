import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
  decodeCaoSpatialBatch,
  decodeCaoLineBatch,
  decodeMotionPalette,
  validateReconstructionCheckpointV2,
  validateReconstructionCoreV2,
  validateReconstructionPackageManifestV2,
  validateAndDecodeNativeBoundaryLayer,
  validateAndDecodeTopologyOwnershipLayer,
  validateReconstructionAnchorCatalogV2,
  type MotionPaletteCatalog,
  type NativeBoundaryCatalogV2,
  type ReconstructionCheckpointV2,
  type ReconstructionAnchorCatalogV2,
  type ReconstructionCoreV2,
  type ReconstructionPackageManifestV2,
  type TopologyOwnershipCatalogV2,
} from "../../src/reconstruction";

const directory = resolve(process.env.CAO_PACKAGE_DIRECTORY
  ?? "../EarthHistory-data/palaeomap-study/verification/reconstruction-cao-foundation-v1/two-age-package");
const json = <T>(name: string): T => JSON.parse(readFileSync(resolve(directory, name), "utf8")) as T;
const buffer = (name: string): ArrayBuffer => {
  const bytes = readFileSync(resolve(directory, name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};
const digest = (name: string): string => createHash("sha256").update(readFileSync(resolve(directory, name))).digest("hex");

describe("staged native Cao two-age package", () => {
  test("passes the production v2 validators and packed decoders", () => {
    const manifest = json<ReconstructionPackageManifestV2>("manifest.json");
    const catalog = json<MotionPaletteCatalog>("motion-palette.json");
    const core = json<ReconstructionCoreV2>("core.json");
    validateReconstructionPackageManifestV2(manifest);
    expect(digest("core.json")).toBe(manifest.core.sha256);
    expect(digest("motion-palette.json")).toBe(manifest.motionPalette.catalog.sha256);
    expect(digest("motion-palette.bin")).toBe(manifest.motionPalette.binary.sha256);
    const palette = decodeMotionPalette(catalog, buffer("motion-palette.bin"));
    expect(palette.size).toBe(catalog.entries.length);
    validateReconstructionCoreV2(core, manifest, catalog);
    if (core.anchorCatalog) {
      expect(digest(core.anchorCatalog.url)).toBe(core.anchorCatalog.sha256);
      validateReconstructionAnchorCatalogV2(json<ReconstructionAnchorCatalogV2>(core.anchorCatalog.url), manifest, core);
    }
    for (const batch of core.spatialBatches) {
      expect(digest(batch.geometryAsset.url)).toBe(batch.geometryAsset.sha256);
      decodeCaoSpatialBatch(buffer(batch.geometryAsset.url), batch.vertexCount, batch.triangleCount, core.charts.length);
    }
    for (const batch of core.lineBatches ?? []) {
      expect(digest(batch.geometryAsset.url)).toBe(batch.geometryAsset.sha256);
      decodeCaoLineBatch(buffer(batch.geometryAsset.url), batch.vertexCount, batch.segmentCount, core.charts.length);
    }
    for (const checkpointAsset of manifest.checkpoints) {
      expect(digest(checkpointAsset.url)).toBe(checkpointAsset.sha256);
      const checkpoint = json<ReconstructionCheckpointV2>(checkpointAsset.url);
      validateReconstructionCheckpointV2(checkpoint, manifest, core);
      if (checkpoint.nativeBoundaryLayer) {
        const layer = checkpoint.nativeBoundaryLayer;
        validateAndDecodeNativeBoundaryLayer(json<NativeBoundaryCatalogV2>(layer.catalog.url),
          buffer(layer.binary.url), { packageId: manifest.packageId, revision: manifest.revision,
            frame: manifest.frame, sourceAgeMa: checkpoint.ageMa, binary: layer.binary });
      }
      if (checkpoint.topologyOwnershipLayer) {
        const layer = checkpoint.topologyOwnershipLayer;
        validateAndDecodeTopologyOwnershipLayer(json<TopologyOwnershipCatalogV2>(layer.catalog.url),
          buffer(layer.binary.url), { packageId: manifest.packageId, revision: manifest.revision,
            frame: manifest.frame, sourceAgeMa: checkpoint.ageMa, binary: layer.binary });
      }
    }
  });

  test("R1 mutations reach the real decoders and validators", () => {
    const manifest = json<ReconstructionPackageManifestV2>("manifest.json");
    const catalog = json<MotionPaletteCatalog>("motion-palette.json");
    const core = json<ReconstructionCoreV2>("core.json");
    const paletteMutation = buffer("motion-palette.bin");
    new Uint8Array(paletteMutation)[0] = 0;
    expect(() => decodeMotionPalette(catalog, paletteMutation)).toThrow(/identity/);
    const geometryMutation = buffer("batch-0.ehgb");
    new DataView(geometryMutation).setUint32(8, core.spatialBatches[0]!.vertexCount + 1, true);
    expect(() => decodeCaoSpatialBatch(geometryMutation, core.spatialBatches[0]!.vertexCount,
      core.spatialBatches[0]!.triangleCount, core.charts.length)).toThrow(/header/);
    const checkpoint = structuredClone(json<ReconstructionCheckpointV2>("checkpoint-0ma.json"));
    (checkpoint.batchControls[0] as { state: unknown }).state = { kind: "uniform", displayHeightMetres: Number.NaN,
      baseColorRgb: [0, 0, 0] };
    expect(() => validateReconstructionCheckpointV2(checkpoint, manifest, core)).toThrow(/control/);
    if (core.lineBatches?.length) {
      const line = core.lineBatches[0]!;
      const lineMutation = buffer(line.geometryAsset.url);
      new Uint8Array(lineMutation)[0] = 0;
      expect(() => decodeCaoLineBatch(lineMutation, line.vertexCount, line.segmentCount, core.charts.length)).toThrow(/header/);
    }
    const exactCheckpoint = json<ReconstructionCheckpointV2>("checkpoint-0ma.json");
    if (exactCheckpoint.nativeBoundaryLayer) {
      const layer = exactCheckpoint.nativeBoundaryLayer;
      const nativeMutation = buffer(layer.binary.url);
      new DataView(nativeMutation).setUint32(16, 1, true);
      expect(() => validateAndDecodeNativeBoundaryLayer(json<NativeBoundaryCatalogV2>(layer.catalog.url),
        nativeMutation, { packageId: manifest.packageId, revision: manifest.revision, frame: manifest.frame,
          sourceAgeMa: 0, binary: layer.binary })).toThrow(/header/);
    }
  });
});
