import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareSurfaceBatch, type PreparedSurfaceBatch } from "./surfaceSource";
import { decodeCaoSpatialBatch } from "./spatialV2";
import { expandInternedPackageDocument } from "./packageIntern";
import { packageAssetPath } from "./assetLoader";
import type { ReconstructionCoreV2,
  ReconstructionPackageManifestV2 } from "./packageV2";
import { preparePalaeoRingPayload } from "./palaeoTriangulate";
import { encodePalaeoRingPayload } from "./fixtures/palaeoRingFixtures";
import type { PreparedCaoStaticGeometryCopy } from "./facadeV2";

const root = resolve("public/data/reconstruction/cao-v2.4");

async function readJson(url: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(root, packageAssetPath(url)), "utf8")) as unknown;
}

async function shippedCore(): Promise<ReconstructionCoreV2> {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
    ReconstructionPackageManifestV2;
  return expandInternedPackageDocument(await readJson(manifest.core.url)) as ReconstructionCoreV2;
}

async function readBuffer(url: string): Promise<ArrayBuffer> {
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Every triangle names one chart, and the chart it names is the chart of the
 * range it falls in. This is the prepared-batch form of the property
 * `palaeoTriangulate.test.ts` states over pieces and `decodeCaoSpatialBatch`
 * states over the payload, and it is what the renderer's per-chart BVH build
 * relies on.
 */
function trianglesAgreeWithChartRanges(batch: PreparedSurfaceBatch,
  copy: PreparedCaoStaticGeometryCopy = batch.createStaticGeometryCopy()): void {
  for (const range of batch.chartTriangleRanges) {
    for (let offset = 0; offset < range.triangleCount; offset += 1) {
      const triangle = range.firstTriangle + offset;
      const charts = new Set([copy.materialChartIndices[copy.indices[triangle * 3]!],
        copy.materialChartIndices[copy.indices[triangle * 3 + 1]!],
        copy.materialChartIndices[copy.indices[triangle * 3 + 2]!]]);
      if (charts.size !== 1 || [...charts][0] !== range.chartIndex) {
        throw new Error("prepared surface triangle crosses its chart range");
      }
    }
  }
}

describe("surface source preparation", () => {
  it("prepares the shipped native batches exactly as the pre-refactor path did", async () => {
    const core = await shippedCore();
    const chartCount = core.charts.length;
    const narrow = chartCount <= 65_535;
    for (const batchId of ["batch-land", "batch-shelf"]) {
      const descriptor = core.spatialBatches.find((entry) => entry.batchId === batchId)!;
      expect(descriptor).toBeDefined();
      const geometry = decodeCaoSpatialBatch(await readBuffer(descriptor.geometryAsset.url),
        descriptor.vertexCount, descriptor.triangleCount, chartCount);
      const prepared = prepareSurfaceBatch({ kind: "ehgb", batchId: descriptor.batchId,
        staticGeometryIdentity: `identity:${descriptor.batchId}:${descriptor.geometryAsset.sha256}`,
        vertexCount: descriptor.vertexCount, triangleCount: descriptor.triangleCount,
        chartCount,
        nativePrecedence: descriptor.overlapPolicy === "native-visual-and-picking-precedence",
        surfaceAppearance: descriptor.surfaceAppearance,
        chartTriangleRanges: geometry.chartTriangleRanges,
        requireGeometry: () => geometry,
        displayControls: () => ({ displayHeightStart: { kind: "uniform", value: 0 },
          displayHeightEnd: { kind: "uniform", value: 0 },
          baseColor: { kind: "uniform", value: [0.1, 0.2, 0.3] } }) });

      // The pre-refactor native expression, reproduced verbatim from
      // `engineV2.prepare` before the surface-source path existed.
      const legacyBytes = geometry.byteLength - 32 + (narrow ? 0 : descriptor.vertexCount * 4);
      const legacyCopy = { referenceDirections: new Float32Array(geometry.referenceDirections),
        indices: new Uint32Array(geometry.indices), seamIds: new Uint32Array(geometry.seamIds),
        preparedEntryIndices: narrow
          ? new Uint16Array(geometry.vertexChartIndices) : new Uint32Array(geometry.vertexChartIndices),
        materialChartIndices: narrow
          ? new Uint16Array(geometry.vertexChartIndices) : new Uint32Array(geometry.vertexChartIndices) };

      expect(prepared.staticGeometryBytes).toBe(legacyBytes);
      expect(prepared.vertexCount).toBe(descriptor.vertexCount);
      expect(prepared.triangleCount).toBe(descriptor.triangleCount);
      expect(prepared.surfaceAppearance).toBe(descriptor.surfaceAppearance);
      expect(prepared.nativePrecedence).toBe(
        descriptor.overlapPolicy === "native-visual-and-picking-precedence");
      expect(prepared.chartTriangleRanges).toBe(geometry.chartTriangleRanges);
      const copy = prepared.createStaticGeometryCopy();
      expect(copy.referenceDirections).toEqual(legacyCopy.referenceDirections);
      expect(copy.indices).toEqual(legacyCopy.indices);
      expect(copy.seamIds).toEqual(legacyCopy.seamIds);
      expect(copy.preparedEntryIndices).toEqual(legacyCopy.preparedEntryIndices);
      expect(copy.materialChartIndices).toEqual(legacyCopy.materialChartIndices);
      // The native arm owns its arrays: the payload is released with the lease.
      expect(copy.referenceDirections).not.toBe(geometry.referenceDirections);
      expect(copy.preparedEntryIndices).not.toBe(copy.materialChartIndices);
      // The ledger is the sum of the five arrays the renderer re-derives.
      expect(copy.referenceDirections.byteLength + copy.indices.byteLength + copy.seamIds!.byteLength
        + copy.preparedEntryIndices.byteLength + copy.materialChartIndices.byteLength).toBe(legacyBytes);
      expect(() => trianglesAgreeWithChartRanges(prepared, copy)).not.toThrow();
    }
    // Decoding and walking both shipped batches (13 MiB, 509k triangles) runs
    // past the default per-test timeout when the suite is loaded.
  }, 60_000);

  it("prepares a worker-triangulated interval class exactly as the pre-refactor path did", () => {
    const { geometry } = preparePalaeoRingPayload(encodePalaeoRingPayload({
      surfaceClass: "lm", intervalIndex: 3, fromAgeMa: 300, toAgeMa: 280,
      pieces: [{ rings: [{ lonLat: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]] },
        { lonLat: [[3, 0.5], [4, 0.5], [4, 1.5], [3, 1.5]], hole: true }] },
        { chartIndex: 1, rings: [{ lonLat: [[10, 10], [13, 10], [13, 13], [10, 13]] }] }],
    }));
    const chartOffset = 7;
    const chartCount = 12;
    const prepared = prepareSurfaceBatch({ kind: "ehpr", batchId: "palaeo-lm",
      staticGeometryIdentity: "identity:palaeo-lm:sha", vertexCount: geometry.vertexCount,
      triangleCount: geometry.triangleCount, chartCount, surfaceAppearance: "palaeo-land",
      chartIndexOffset: chartOffset, pieceTriangleRanges: geometry.pieceTriangleRanges,
      requireGeometry: () => geometry, baseColorRgb: [0.4, 0.5, 0.6] });

    // The pre-refactor palaeo expression, reproduced verbatim from
    // `palaeoIntervalV2.preparedBatch` before the surface-source path existed.
    const narrow = chartCount <= 65_535;
    const entryBytes = geometry.vertexCount * (narrow ? 2 : 4);
    // The one deliberate departure from the pre-refactor expression: the palaeo
    // copy carries no seam ids, so its ledger drops `vertexCount * 4`.
    const legacyBytes = geometry.referenceDirections.byteLength + geometry.indices.byteLength
      + entryBytes * 2;
    const pieceIndices = geometry.pieceIndices!;
    const legacyEntryIndices = new Uint16Array(pieceIndices.length);
    for (let vertex = 0; vertex < pieceIndices.length; vertex += 1) {
      legacyEntryIndices[vertex] = chartOffset + pieceIndices[vertex]!;
    }

    expect(prepared.staticGeometryBytes).toBe(legacyBytes);
    expect(prepared.vertexCount).toBe(geometry.vertexCount);
    expect(prepared.triangleCount).toBe(geometry.triangleCount);
    expect(prepared.nativePrecedence).toBe(false);
    expect(prepared.chartTriangleRanges.map((range) => ({ ...range }))).toEqual(
      geometry.pieceTriangleRanges.map((range) => ({ chartIndex: chartOffset + range.pieceIndex,
        firstTriangle: range.firstTriangle, triangleCount: range.triangleCount })));
    const copy = prepared.createStaticGeometryCopy();
    expect(copy.indices).toEqual(geometry.indices);
    expect(copy.preparedEntryIndices).toEqual(legacyEntryIndices);
    // The realistic arm hands the store's resident arrays through, and one
    // array answers both the palette entry and the material chart index.
    expect(copy.referenceDirections).toBe(geometry.referenceDirections);
    expect(copy.indices).toBe(geometry.indices);
    // No seam ids, and the two upload-only arrays are released once the entry
    // index is built: 2.1 MB an interval at the shipped sizes.
    expect(copy.seamIds).toBeNull();
    expect(geometry.pieceIndices).toBeNull();
    expect(geometry.seamIds).toBeNull();
    expect(copy.materialChartIndices).toBe(copy.preparedEntryIndices);
    expect(prepared.createStaticGeometryCopy().preparedEntryIndices).toBe(copy.preparedEntryIndices);
    expect(copy.referenceDirections.byteLength + copy.indices.byteLength
      + copy.preparedEntryIndices.byteLength + copy.materialChartIndices.byteLength).toBe(legacyBytes);
    // A fresh batch over the same resident geometry — what a return visit
    // prepares — finds the cached entry index and never asks for the released
    // arrays again.
    const returning = prepareSurfaceBatch({ kind: "ehpr", batchId: "palaeo-lm",
      staticGeometryIdentity: "identity:palaeo-lm:sha", vertexCount: geometry.vertexCount,
      triangleCount: geometry.triangleCount, chartCount, surfaceAppearance: "palaeo-land",
      chartIndexOffset: chartOffset, pieceTriangleRanges: geometry.pieceTriangleRanges,
      requireGeometry: () => geometry, baseColorRgb: [0.4, 0.5, 0.6] });
    expect(returning.createStaticGeometryCopy().preparedEntryIndices).toBe(copy.preparedEntryIndices);
    const controls = prepared.createDisplayControlsCopy();
    expect(controls.displayHeightStart).toEqual({ kind: "uniform", value: 0 });
    expect(controls.displayHeightEnd).toEqual({ kind: "uniform", value: 0 });
    expect(controls.baseColor).toEqual({ kind: "uniform", value: [0.4, 0.5, 0.6] });
    expect(() => trianglesAgreeWithChartRanges(prepared, copy)).not.toThrow();
  });

  it("detects a swapped index in a prepared batch", () => {
    const { geometry } = preparePalaeoRingPayload(encodePalaeoRingPayload({
      surfaceClass: "lm", intervalIndex: 3, fromAgeMa: 300, toAgeMa: 280,
      pieces: [{ rings: [{ lonLat: [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]] }] },
        { chartIndex: 1, rings: [{ lonLat: [[10, 10], [13, 10], [13, 13], [10, 13]] }] }],
    }));
    const prepared = prepareSurfaceBatch({ kind: "ehpr", batchId: "palaeo-lm",
      staticGeometryIdentity: "identity:palaeo-lm:sha", vertexCount: geometry.vertexCount,
      triangleCount: geometry.triangleCount, chartCount: 12, surfaceAppearance: "palaeo-land",
      chartIndexOffset: 0, pieceTriangleRanges: geometry.pieceTriangleRanges,
      requireGeometry: () => geometry, baseColorRgb: [0.4, 0.5, 0.6] });
    const copy = prepared.createStaticGeometryCopy();
    const mutated = { ...copy, indices: new Uint32Array(copy.indices) };
    const secondPiece = prepared.chartTriangleRanges[1]!;
    const first = 0;
    const other = secondPiece.firstTriangle * 3;
    expect(copy.materialChartIndices[copy.indices[first]!])
      .not.toBe(copy.materialChartIndices[copy.indices[other]!]);
    mutated.indices[first] = copy.indices[other]!;
    mutated.indices[other] = copy.indices[first]!;
    expect(() => trianglesAgreeWithChartRanges(prepared, mutated))
      .toThrow(/crosses its chart range/);
    // Restored, the same check passes again.
    expect(() => trianglesAgreeWithChartRanges(prepared, copy)).not.toThrow();
  });
});
