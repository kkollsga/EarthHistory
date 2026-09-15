import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expandInternedPackageDocument } from "./packageIntern";
import { validateAndDecodeNativeBoundaryLayer, validateAndDecodeTopologyOwnershipLayer,
  type NativeBoundaryCatalogV2, type TopologyOwnershipCatalogV2 } from "./nativeLayersV2";
import { validateMaterialCorrectionCatalogV1, validateReconstructionCoreV2,
  type MaterialCorrectionCatalogV1, type ReconstructionCheckpointV2, type ReconstructionCoreV2,
  type ReconstructionPackageManifestV2 } from "./packageV2";
import type { MotionPaletteCatalog } from "./palette";

/**
 * The shipped Cao package interns its repeated chart fields and derives the
 * boundary/ownership identifiers rather than shipping them
 * (`scripts/research/cao_package_intern.py`, `docs/data/README.md`). These
 * checks prove the encoding is lossless against the live package and that a
 * corrupted dictionary reference or a derived identifier that no longer
 * reconstructs is rejected instead of silently decoding to the wrong value.
 */

const root = resolve("public/data/reconstruction/cao-v2.4");
const raw = async (url: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(root, url), "utf8")) as unknown;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function manifest(): Promise<ReconstructionPackageManifestV2> {
  return await raw("manifest.json") as ReconstructionPackageManifestV2;
}

async function boundaryFixture() {
  const packageManifest = await manifest();
  const checkpoint = await raw("checkpoint-0ma.json") as ReconstructionCheckpointV2;
  const layer = checkpoint.nativeBoundaryLayer!;
  const bytes = await readFile(resolve(root, layer.binary.url));
  return {
    interned: await raw("boundary-0ma.json") as Record<string, unknown>,
    buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    expected: { packageId: packageManifest.packageId, revision: packageManifest.revision,
      frame: packageManifest.frame, sourceAgeMa: layer.sourceAgeMa, binary: layer.binary },
  };
}

describe("interned Cao package documents", () => {
  it("expands the shipped core into the chart shape every validator already reads", async () => {
    const packageManifest = await manifest();
    const interned = await raw(packageManifest.core.url) as Record<string, unknown>;
    expect(interned.chartDictionaries).toBeDefined();
    expect(interned.chartIdCollapse).toBe("v1");
    const core = expandInternedPackageDocument(interned) as ReconstructionCoreV2;
    const palette = await raw(packageManifest.motionPalette.catalog.url) as MotionPaletteCatalog;
    expect(core.charts).toHaveLength(4_995);
    expect((core as unknown as Record<string, unknown>).chartDictionaries).toBeUndefined();
    for (const chart of core.charts) {
      expect(chart.lifecycle.validTimeMa.oldest).toBeGreaterThanOrEqual(0);
      expect(chart.evidence.limitations.length).toBeGreaterThan(0);
      expect(chart.surfaceEvidence.kind).toBeTruthy();
      expect(typeof chart.fragmentOrCohortId).toBe("string");
      expect(typeof chart.materialId).toBe("string");
    }
    // 3,799 of the 4,995 charts collapse an identical identifier triple.
    expect(core.charts.filter((chart) => chart.chartId === chart.fragmentOrCohortId
      && chart.chartId === chart.materialId)).toHaveLength(3_799);
    expect(() => validateReconstructionCoreV2(core, packageManifest, palette)).not.toThrow();
  });

  it("rejects a chart dictionary reference outside its table", async () => {
    const packageManifest = await manifest();
    const interned = await raw(packageManifest.core.url) as
      { chartDictionaries: Record<string, unknown[]>; charts: Record<string, unknown>[] };
    const past = clone(interned);
    past.charts[0]!.lifecycleRef = past.chartDictionaries.lifecycle!.length;
    expect(() => expandInternedPackageDocument(past)).toThrow(/dictionary reference out of range/);

    const negative = clone(interned);
    (negative.charts[0]!.evidence as Record<string, unknown>).limitationsRef = -1;
    expect(() => expandInternedPackageDocument(negative))
      .toThrow(/dictionary reference out of range/);

    const fractional = clone(interned);
    fractional.charts[0]!.motionBindingsRef = 1.5;
    expect(() => expandInternedPackageDocument(fractional))
      .toThrow(/dictionary reference out of range/);
  });

  it("expands the material correction catalog and rejects a corrupt evidence reference", async () => {
    const packageManifest = await manifest();
    const interned = await raw(packageManifest.materialCorrections!.catalog.url) as
      { chartDictionaries: Record<string, unknown[]>; charts: Record<string, unknown>[] };
    const catalog = expandInternedPackageDocument(interned) as MaterialCorrectionCatalogV1;
    expect(catalog.charts).toHaveLength(212);
    for (const chart of catalog.charts) expect(chart.evidence.sourceIds.length).toBeGreaterThan(0);
    const core = expandInternedPackageDocument(
      await raw(packageManifest.core.url)) as ReconstructionCoreV2;
    expect(() => validateMaterialCorrectionCatalogV1(catalog, packageManifest, core)).not.toThrow();

    const corrupt = clone(interned);
    corrupt.charts[0]!.evidenceRef = corrupt.chartDictionaries.evidence!.length;
    expect(() => expandInternedPackageDocument(corrupt))
      .toThrow(/dictionary reference out of range/);
  });

  it("rebuilds boundary segment ids and rejects one that no longer reconstructs", async () => {
    const { interned, buffer, expected } = await boundaryFixture();
    const catalog = expandInternedPackageDocument(interned) as NativeBoundaryCatalogV2;
    expect(catalog.segments.length).toBeGreaterThan(8);
    for (const segment of catalog.segments) {
      expect(segment.segmentId).toBe(`0:${segment.sourceFeatureId}:part:${segment.sourcePart}`);
    }
    expect(validateAndDecodeNativeBoundaryLayer(catalog, buffer, expected).pointCount)
      .toBeGreaterThan(0);

    // Segments 7 and 8 are two parts of one source feature; giving the second
    // the first's part index rebuilds a duplicate segmentId.
    const tampered = clone(interned) as { segments: Record<string, unknown>[] };
    expect(tampered.segments[7]!.sourceFeatureIdRef).toBe(tampered.segments[8]!.sourceFeatureIdRef);
    tampered.segments[8]!.sourcePartRef = tampered.segments[7]!.sourcePartRef;
    const collided = expandInternedPackageDocument(tampered) as NativeBoundaryCatalogV2;
    expect(collided.segments[8]!.segmentId).toBe(collided.segments[7]!.segmentId);
    expect(() => validateAndDecodeNativeBoundaryLayer(collided, buffer, expected))
      .toThrow(/invalid Cao native boundary catalog/);

    const corrupt = clone(interned) as
      { dictionaries: Record<string, unknown[]>; segments: Record<string, unknown>[] };
    corrupt.segments[0]!.kindRef = corrupt.dictionaries.kind!.length;
    expect(() => expandInternedPackageDocument(corrupt))
      .toThrow(/dictionary reference out of range/);
  });

  it("rebuilds ownership ring ids and rejects a ring shipped outside its polygon", async () => {
    const packageManifest = await manifest();
    const checkpoint = await raw("checkpoint-0ma.json") as ReconstructionCheckpointV2;
    const layer = checkpoint.topologyOwnershipLayer!;
    const bytes = await readFile(resolve(root, layer.binary.url));
    const buffer = bytes.buffer.slice(bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const interned = await raw("ownership-0ma.json") as { rings: Record<string, unknown>[] };
    const catalog = expandInternedPackageDocument(interned) as TopologyOwnershipCatalogV2;
    expect(catalog.rings[0]!.ringId).toBe(`0:${catalog.rings[0]!.topologyId}:0`);
    expect(new Set(catalog.rings.map((ring) => ring.ringId)).size).toBe(catalog.rings.length);
    expect(validateAndDecodeTopologyOwnershipLayer(catalog, buffer, {
      packageId: packageManifest.packageId, revision: packageManifest.revision,
      frame: packageManifest.frame, sourceAgeMa: layer.sourceAgeMa, binary: layer.binary,
    }).pointCount).toBeGreaterThan(0);

    const scrambled = clone(interned);
    const moved = scrambled.rings.findIndex((ring) =>
      ring.topologyId !== scrambled.rings[0]!.topologyId);
    expect(moved).toBeGreaterThan(0);
    scrambled.rings.splice(moved + 1, 0, clone(scrambled.rings[0]!));
    expect(() => expandInternedPackageDocument(scrambled))
      .toThrow(/polygon rings are not contiguous/);

    const smuggled = clone(interned);
    smuggled.rings[0]!.ringId = "0:forged:0";
    expect(() => expandInternedPackageDocument(smuggled)).toThrow(/ownership ring is malformed/);
  });

  it("passes documents without an encoding marker through untouched", async () => {
    const checkpoint = await raw("checkpoint-450ma.json");
    expect(expandInternedPackageDocument(checkpoint)).toBe(checkpoint);
    expect(expandInternedPackageDocument(await manifest())).toBeDefined();
    expect(expandInternedPackageDocument(null)).toBeNull();
    expect(expandInternedPackageDocument([1, 2])).toEqual([1, 2]);
  });
});
