import { describe, expect, it } from "vitest";
import { validateMaterialCorrectionCatalogV1, validateRealisticSurfaceBatchesV2,
  validateReconstructionCoreV2,
  type MaterialCorrectionCatalogV1, type PalaeoCoastlineClassAsset,
  type RealisticSurfaceBatchV2,
  type ReconstructionCoreV2, type ReconstructionPackageManifestV2 } from "./packageV2";
import type { MotionPaletteCatalog } from "./palette";

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
  it("accepts observed land only at the exact modern age", () => {
    const observed = { ...catalog.charts[0]!, chartId: "observed", fragmentOrCohortId: "iceland",
      lifecycle: { validTimeMa: { youngest: 0, oldest: 0 } },
      motionBindings: [{ paletteId: "palette", entryId: "plate",
        validTimeMa: { youngest: 0, oldest: 0 } }],
      sourceFeatureTypes: ["EarthHistoryObservedModernLandCorrection"],
      evidence: { ...catalog.charts[0]!.evidence,
        correction: { correctionId: "region", phase: "observed-exposed-land" as const } },
      surfaceEvidence: { kind: "observed" as const, surfaceClass: "land" as const,
        sourceIds: ["natural-earth"], reason: "generalized modern land" } };
    const observedCatalog = { ...catalog, charts: [observed] } satisfies MaterialCorrectionCatalogV1;
    expect(() => validateMaterialCorrectionCatalogV1(observedCatalog, manifest)).not.toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...observedCatalog, charts: [{ ...observed,
      lifecycle: { validTimeMa: { youngest: 0, oldest: 0.001 } } }] }, manifest)).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...observedCatalog, charts: [{ ...observed,
      surfaceEvidence: { kind: "unknown", reason: "lost observation" } }] }, manifest)).toThrow();
  });

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
    const segmentedNative = { ...nativeChart, motionBindings: [
      { paletteId: "palette", entryId: "plate-younger", validTimeMa: { youngest: 0, oldest: 130 } },
      { paletteId: "palette", entryId: "plate-older", validTimeMa: { youngest: 130, oldest: 410 } },
    ] };
    const segmentedReplacement = { ...replacement, motionBindings: segmentedNative.motionBindings };
    const segmentedCountry = { ...countryChart, motionBindings: segmentedNative.motionBindings };
    expect(() => validateMaterialCorrectionCatalogV1({ ...overrideCatalog,
      charts: [catalog.charts[0]!, segmentedReplacement] }, manifest,
    { ...core, charts: [segmentedNative, segmentedCountry] })).not.toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...overrideCatalog,
      charts: [catalog.charts[0]!, { ...segmentedReplacement, motionBindings: [
        segmentedReplacement.motionBindings[0]!,
        { ...segmentedReplacement.motionBindings[1]!, validTimeMa: { youngest: 131, oldest: 410 } },
      ] }] }, manifest, { ...core, charts: [segmentedNative, segmentedCountry] })).toThrow();
    expect(() => validateMaterialCorrectionCatalogV1({ ...overrideCatalog,
      charts: [catalog.charts[0]!, { ...segmentedReplacement, motionBindings: [
        { ...segmentedReplacement.motionBindings[0]!, entryId: "foreign" },
        segmentedReplacement.motionBindings[1]!,
      ] }] }, manifest, { ...core, charts: [segmentedNative, segmentedCountry] })).toThrow();
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

describe("declared chart motion support gaps", () => {
  const gapPalette: MotionPaletteCatalog = {
    schemaVersion: 2, id: "palette", packageId: "base", revision: "r1", frame,
    binary: { ...asset, timeEncoding: "uint32-micro-ma", quaternionEncoding: "float32-wxyz" },
    entries: [
      { entryId: "younger", plateId: 626,
        storedCoordinateBasis: { kind: "supported-reference", geometryReferenceAgeMa: 0 },
        youngestAgeMa: 0, oldestAgeMa: 1, sampleOffset: 0, sampleCount: 2,
        sourceIds: ["rotation"], sourceIntervalSetId: "younger-clock" },
      { entryId: "older", plateId: 626,
        storedCoordinateBasis: { kind: "supported-reference", geometryReferenceAgeMa: 0 },
        youngestAgeMa: 2, oldestAgeMa: 3, sampleOffset: 2, sampleCount: 2,
        sourceIds: ["rotation"], sourceIntervalSetId: "older-clock" },
    ],
    sourceIntervalSets: [],
  };
  const gapChart = {
    kind: "rigid" as const, role: "model-geography" as const, chartId: "gap-chart",
    chartRevision: "gap-chart@1", materialId: "gap", fragmentOrCohortId: "gap",
    lifecycle: { validTimeMa: { youngest: 0, oldest: 3 } }, geometryReferenceAgeMa: 0,
    motionBindings: [
      { paletteId: "palette", entryId: "younger", validTimeMa: { youngest: 0, oldest: 1 } },
      { paletteId: "palette", entryId: "older", validTimeMa: { youngest: 2, oldest: 3 } },
    ],
    motionSupportGaps: [{ validTimeMa: { youngest: 1, oldest: 2 },
      youngestExclusive: true as const, oldestExclusive: true as const,
      reason: "source-seam" as const, sourceIds: ["rotation"] }],
    sourceFeatureIds: ["source"], sourceFeatureTypes: ["gpml:ContinentalFragment"],
    evidence: { status: "model-output" as const, sourceIds: ["cao"], limitations: ["source seam"] },
    surfaceEvidence: { kind: "unknown" as const, reason: "surface class unknown" },
  };
  const gapCore = { schemaVersion: 2 as const, packageId: "base", revision: "r1", frame,
    charts: [gapChart], spatialBatches: [{ batchId: "land", vertexCount: 3, triangleCount: 1,
      geometryAsset: { ...asset, bytes: 104 }, encoding: "ehgb-v2-f32xyz-u32" as const }] };

  it("accepts only a source-backed gap that exactly partitions two authored bindings", () => {
    expect(() => validateReconstructionCoreV2(gapCore, manifest, gapPalette)).not.toThrow();
    expect(() => validateReconstructionCoreV2({ ...gapCore, charts: [{ ...gapChart,
      motionSupportGaps: undefined }] }, manifest, gapPalette)).toThrow(/binding/);
    expect(() => validateReconstructionCoreV2({ ...gapCore, charts: [{ ...gapChart,
      motionSupportGaps: [{ ...gapChart.motionSupportGaps[0]!, sourceIds: [] }] }] },
    manifest, gapPalette)).toThrow(/binding/);
    expect(() => validateReconstructionCoreV2({ ...gapCore, charts: [{ ...gapChart,
      motionSupportGaps: [{ ...gapChart.motionSupportGaps[0]!, sourceIds: [626] as never }] }] },
    manifest, gapPalette)).toThrow(/binding/);
    expect(() => validateReconstructionCoreV2({ ...gapCore, charts: [{ ...gapChart,
      motionSupportGaps: [{ ...gapChart.motionSupportGaps[0]!,
        validTimeMa: { youngest: 1, oldest: 2.000001 } }] }] }, manifest, gapPalette)).toThrow(/binding/);
    expect(() => validateReconstructionCoreV2({ ...gapCore, charts: [{ ...gapChart,
      motionBindings: [{ ...gapChart.motionBindings[0]!, validTimeMa: { youngest: 0, oldest: 1.5 } },
        gapChart.motionBindings[1]!] }] }, manifest, gapPalette)).toThrow(/binding/);
  });
});

/**
 * A realistic-coast batch is a `core.json` spatial batch with an `ehpr` ring
 * payload and an interval, and it is checked by the same record validator: the
 * geometry asset must weigh exactly what the batch's own piece, ring and vertex
 * counts imply, and every batch of a class must agree on the interned chart
 * tables its pieces index into.
 */
describe("realistic surface batch records", () => {
  const classes: readonly PalaeoCoastlineClassAsset[] = [
    { surfaceClass: "lm", catalog: asset, baseColorRgb: [0.6, 0.65, 0.4] },
    { surfaceClass: "sm", catalog: asset, baseColorRgb: [0.07, 0.33, 0.37] },
  ];
  const domain = { youngest: 0.0195, oldest: 402 };
  // 32 + 12 pieces + 2 rings + 4 vertices, the EHPR v1 wire layout.
  const bytes = 32 + 12 * 2 + 2 * 3 + 4 * 30;
  const land: RealisticSurfaceBatchV2 = {
    id: "palaeo-lm-94-81", appearance: "palaeo-land", surfaceClass: "lm",
    interval: { id: "94-81", index: 16, fromAgeMa: 94, toAgeMa: 81, detached: false },
    geometryAsset: { url: "palaeo-coastlines/lm/palaeo-lm-94-81.ehpr", bytes, sha256: digest },
    encoding: "ehpr-v1-i16lonlat-rings", ringCount: 3, vertexCount: 30,
    charts: { records: 2, bindings: 761, evidence: 23, lifecycles: 67 } };
  const sea: RealisticSurfaceBatchV2 = { ...land, id: "palaeo-sm-94-81",
    appearance: "palaeo-shallow-marine", surfaceClass: "sm",
    geometryAsset: { ...land.geometryAsset, url: "palaeo-coastlines/sm/palaeo-sm-94-81.ehpr" },
    charts: { records: 2, bindings: 907, evidence: 18, lifecycles: 26 } };
  const batches = [land, sea];

  it("accepts a class of one interval and rejects a wrong digest, encoding or chart count", () => {
    expect(() => validateRealisticSurfaceBatchesV2(batches, classes, domain)).not.toThrow();
    expect(() => validateRealisticSurfaceBatchesV2([{ ...land,
      geometryAsset: { ...land.geometryAsset, sha256: "not-a-digest" } }, sea], classes, domain))
      .toThrow(/realistic surface batch/);
    expect(() => validateRealisticSurfaceBatchesV2([{ ...land,
      encoding: "ehgb-v2-f32xyz-u32" as never }, sea], classes, domain))
      .toThrow(/realistic surface batch/);
    // The byte count the record implies no longer matches the asset it names.
    expect(() => validateRealisticSurfaceBatchesV2([{ ...land,
      charts: { ...land.charts, records: 1 } }, sea], classes, domain))
      .toThrow(/realistic surface batch/);
    // Two batches of one class indexing differently sized interned tables.
    expect(() => validateRealisticSurfaceBatchesV2([land, { ...land, id: "palaeo-lm-81-58",
      interval: { id: "81-58", index: 17, fromAgeMa: 81, toAgeMa: 58, detached: false },
      charts: { ...land.charts, evidence: 24 } }, sea], classes, domain))
      .toThrow(/interned chart tables/);
  });

  it("rejects a mislabelled class, a reversed interval and an id that is not its own", () => {
    expect(() => validateRealisticSurfaceBatchesV2([{ ...land, appearance: "palaeo-mountain" }, sea],
      classes, domain)).toThrow(/realistic surface batch/);
    expect(() => validateRealisticSurfaceBatchesV2([{ ...land,
      interval: { ...land.interval, fromAgeMa: 81, toAgeMa: 94 } }, sea], classes, domain))
      .toThrow(/realistic surface batch/);
    expect(() => validateRealisticSurfaceBatchesV2([{ ...land, id: "palaeo-lm-81-58" }, sea],
      classes, domain)).toThrow(/realistic surface batch/);
    // A class that publishes a different interval schedule than the first one.
    expect(() => validateRealisticSurfaceBatchesV2([land, { ...sea, id: "palaeo-sm-81-58",
      interval: { id: "81-58", index: 17, fromAgeMa: 81, toAgeMa: 58, detached: false },
      geometryAsset: { ...sea.geometryAsset, url: "palaeo-coastlines/sm/palaeo-sm-81-58.ehpr" } }],
    classes, domain)).toThrow(/different interval schedules/);
  });

  it("accepts the bare header the detached LGM state publishes for an empty class", () => {
    const empty: RealisticSurfaceBatchV2 = { ...sea, id: "palaeo-sm-lgm",
      interval: { id: "lgm", index: 24, fromAgeMa: 0.0265, toAgeMa: 0.0195, detached: true },
      geometryAsset: { url: "palaeo-coastlines/sm/palaeo-sm-lgm.ehpr", bytes: 32, sha256: digest },
      ringCount: 0, vertexCount: 0, charts: { ...sea.charts, records: 0 } };
    const landLgm: RealisticSurfaceBatchV2 = { ...land, id: "palaeo-lm-lgm",
      interval: empty.interval,
      geometryAsset: { url: "palaeo-coastlines/lm/palaeo-lm-lgm.ehpr", bytes, sha256: digest } };
    expect(() => validateRealisticSurfaceBatchesV2([...batches, landLgm, empty], classes, domain))
      .not.toThrow();
    expect(() => validateRealisticSurfaceBatchesV2([...batches, landLgm,
      { ...empty, vertexCount: 1 }], classes, domain)).toThrow(/realistic surface batch/);
  });
});
