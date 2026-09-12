import { describe, expect, it } from "vitest";
import { validateMaterialCorrectionCatalogV1, type MaterialCorrectionCatalogV1,
  type ReconstructionCoreV2, type ReconstructionPackageManifestV2 } from "./packageV2";

const digest = "a".repeat(64);
const frame = { modelId: "cao", modelVersion: "2.4", absoluteFrameId: "palaeomagnetic",
  anchorPlateId: 0, axisConvention: "gplates-x0e-y90e-znorth" as const,
  rotationSha256: digest, topologySha256: digest };
const asset = { url: "asset", bytes: 32, sha256: digest };
const manifest: ReconstructionPackageManifestV2 = { schemaVersion: 2, packageId: "base", revision: "r1",
  frame, ageDomainMa: { youngest: 0, oldest: 540 }, core: asset,
  motionPalette: { id: "palette", catalog: asset, binary: asset },
  checkpoints: [{ ...asset, ageMa: 0, transitiveBytes: 32 }, { ...asset, ageMa: 540, transitiveBytes: 32 }],
  materialCorrections: { id: "corrections", catalog: asset } };
const catalog: MaterialCorrectionCatalogV1 = { schemaVersion: 1, id: "corrections", version: "1",
  baseline: { packageId: "base", revision: "r1", coreSha256: digest, motionPaletteId: "palette", frame },
  correctionIds: ["region"],
  alignmentWitnesses: [],
  charts: [{ kind: "rigid", role: "model-geography", chartId: "derived", chartRevision: "c1",
    materialId: "material", fragmentOrCohortId: "cohort",
    lifecycle: { validTimeMa: { youngest: 410, oldest: 430 }, youngestExclusive: true },
    geometryReferenceAgeMa: 0, motionBindings: [{ paletteId: "palette", entryId: "plate",
      validTimeMa: { youngest: 410, oldest: 430 } }], sourceFeatureIds: ["source"],
    sourceFeatureTypes: ["EarthHistorySourceQualifiedMaterialCorrection"],
    evidence: { status: "derived-overlay", sourceIds: ["geology"], limitations: ["exposure unknown"],
      correction: { correctionId: "region", phase: "source-qualified-material" } },
    surfaceEvidence: { kind: "unknown", reason: "surface exposure unknown" } }],
  spatialBatches: [{ batchId: "derived", vertexCount: 3, triangleCount: 1, geometryAsset: asset,
    encoding: "ehgb-v2-f32xyz-u32", staticDisplayControl: { displayHeightMetres: 0,
      baseColorRgb: [0.5, 0.4, 0.3] },
    overlapPolicy: "native-visual-and-picking-precedence" }] };

describe("material correction catalog v1", () => {
  it("rejects a corrupted phase, source boundary, baseline identity, and physical height", () => {
    expect(() => validateMaterialCorrectionCatalogV1(catalog, manifest)).not.toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...catalog, charts: [{ ...catalog.charts[0]!,
      evidence: { ...catalog.charts[0]!.evidence,
        correction: { correctionId: "region", phase: "arbitrary" as never } } }] }, manifest)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...catalog, charts: [{ ...catalog.charts[0]!,
      lifecycle: { validTimeMa: { youngest: 409, oldest: 430 }, youngestExclusive: true } }] }, manifest)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...catalog, charts: [{ ...catalog.charts[0]!,
      lifecycle: { ...catalog.charts[0]!.lifecycle, youngestExclusive: false } }] }, manifest)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...catalog, id: "wrong-catalog" }, manifest)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...catalog,
      baseline: { ...catalog.baseline, coreSha256: "b".repeat(64) } }, manifest)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...catalog, spatialBatches: [{ ...catalog.spatialBatches[0]!,
      staticDisplayControl: { displayHeightMetres: 1, baseColorRgb: [0.5, 0.4, 0.3] } }] }, manifest)).toThrow();
  });

  it("accepts only an exact bounded native-chart replacement with tracked replacement charts", () => {
    const patchId = "cao-coast:source:450:0";
    const nativeChart = { ...catalog.charts[0]!, chartId: patchId, chartRevision: "cao-foundation-v1",
      materialId: patchId, fragmentOrCohortId: patchId,
      lifecycle: { validTimeMa: { youngest: 0, oldest: 410 } },
      motionBindings: [{ paletteId: "palette", entryId: "plate", validTimeMa: { youngest: 0, oldest: 410 } }],
      sourceFeatureIds: ["source"], sourceFeatureTypes: ["gpml:Coastline"] };
    const replacement = { ...catalog.charts[0]!, chartId: "replacement",
      lifecycle: { validTimeMa: { youngest: 0, oldest: 410 } },
      motionBindings: [{ paletteId: "palette", entryId: "plate", validTimeMa: { youngest: 0, oldest: 410 } }],
      sourceFeatureTypes: ["EarthHistoryDomainFragmentReplacement"],
      evidence: { ...catalog.charts[0]!.evidence, correction: { correctionId: "native",
        phase: "source-qualified-material" as const, materialStatus: "supported" as const,
        poseStatus: "model-inference" as const, materialOriginRangeMa: [1_840, 1_840] as const } } };
    const countryChart = { ...nativeChart, role: "country-reference" as const, chartId: "country-source",
      materialId: "country-source", fragmentOrCohortId: "country-source" };
    const core = { schemaVersion: 2, packageId: "base", revision: "r1", frame,
      charts: [nativeChart, countryChart], spatialBatches: [] } satisfies ReconstructionCoreV2;
    const overrideCatalog = { ...catalog, correctionIds: ["region", "native"],
      charts: [catalog.charts[0]!, replacement], nativeChartOverrides: [{
        overrideId: "exact", operation: "domain-fragment-replacement" as const, correctionId: "native",
        nativeTarget: { patchId, sourceCollection: "shapes_coasts.gpmlz" as const,
          sourceCollectionSha256: "c660bc074aa84b366600d81d7ccf3a45658db81ab8cdd8f6bda26e094c0dc71f",
          sourceFeatureId: "source", sourceFeatureOrder: 450, geometryOrder: 0,
          geometrySha256: digest, plateId: 176 },
        nativeChart: { chartId: patchId, chartRevision: "cao-foundation-v1",
          materialId: patchId, fragmentOrCohortId: patchId },
        suppression: { validTimeMa: { youngest: 0, oldest: 410 } },
        replacementAssetSha256: digest, replacementChartIds: ["replacement"],
        dependentConsumers: { countryReferences: "spatial-segment-remap" as const,
          sourceCountryChartIds: ["country-source"], maximumSegmentSampleDegrees: 0.1,
          maximumDomainMatchKm: 12, expectedSourceSegmentCount: 1,
          countrySegmentBindings: [{ batchId: "countries", segmentIndex: 0,
            sourceCountryChartId: "country-source", domainFragmentOrCohortIds: ["cohort"],
            maximumMatchKm: 3 }],
          anchors: "require-none" as const },
        sourceIds: ["geology"], reason: "source-bounded domain replacement",
      }] } satisfies MaterialCorrectionCatalogV1;
    expect(() => validateMaterialCorrectionCatalogV1(overrideCatalog, manifest, core)).not.toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...overrideCatalog,
      nativeChartOverrides: [{ ...overrideCatalog.nativeChartOverrides![0]!,
        nativeTarget: { ...overrideCatalog.nativeChartOverrides![0]!.nativeTarget,
          geometrySha256: "bad" } }] }, manifest, core)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...overrideCatalog,
      nativeChartOverrides: [{ ...overrideCatalog.nativeChartOverrides![0]!,
        nativeChart: { ...overrideCatalog.nativeChartOverrides![0]!.nativeChart,
          chartRevision: "wrong" } }] }, manifest, core)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...overrideCatalog,
      nativeChartOverrides: [{ ...overrideCatalog.nativeChartOverrides![0]!,
        replacementChartIds: ["missing"] }] }, manifest, core)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...overrideCatalog,
      nativeChartOverrides: [{ ...overrideCatalog.nativeChartOverrides![0]!,
        dependentConsumers: { ...overrideCatalog.nativeChartOverrides![0]!.dependentConsumers,
          countrySegmentBindings: [{ ...overrideCatalog.nativeChartOverrides![0]!
            .dependentConsumers.countrySegmentBindings[0]!, maximumMatchKm: 12.001 }] } }] }, manifest, core))
      .toThrow();
  });
});
