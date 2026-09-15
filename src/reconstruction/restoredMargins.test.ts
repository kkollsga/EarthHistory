import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CaoReconstructionRuntime, chartPickStateFromMotionFrame, packageAssetPath,
  RESTORED_COLLISION_MARGIN_SOURCE_TYPE, type MaterialCorrectionCatalogV1,
  type ReconstructionCoreV2, type ReconstructionPackageManifestV2, type StaticAssetFetcher,
  validateMaterialCorrectionCatalogV1 } from "./index";
import { RESTORED_COLLISION_MARGIN_CORRECTION_ID,
  RESTORED_COLLISION_MARGIN_EVIDENCE_LINE } from "./caoDomain";
import { expandInternedPackageDocument } from "./packageIntern";
import { sources } from "../data/sources";

/**
 * The restored pre-collision margins are the crust the Alpine and Scandian
 * collisions consumed, authored because the Cao 2024 model carries none
 * (`docs/research/palaeo-coastlines-restored-margins.md`). The offline gate
 * `scripts/research/restored_margins_correction.py` holds the tracked contract;
 * this file reads the *bytes a browser downloads* and holds four statements the
 * contract cannot make on its own:
 *
 * 1. the strips are posed and supported inside their lifecycles;
 * 2. none of them is active at 0 Ma, and the Alpine ones are gone after 5 Ma;
 * 3. every one of them is crust, not land - unknown surface evidence, and a
 *    batch that declares the shelf appearance rather than the land one;
 * 4. the map-key line names the models, the spread and the consumption ages.
 */

const root = resolve("public/data/reconstruction/cao-v2.4");
const readJson = async (url: string): Promise<unknown> =>
  JSON.parse(await readFile(resolve(root, url), "utf8")) as unknown;
const fetcher: StaticAssetFetcher = async (url) => {
  const bytes = await readFile(resolve(root, packageAssetPath(url)));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

const readManifest = async () => JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8")) as
  ReconstructionPackageManifestV2;

const marginCharts = (catalog: MaterialCorrectionCatalogV1) => catalog.charts.filter(
  (chart) => chart.evidence.correction?.correctionId === RESTORED_COLLISION_MARGIN_CORRECTION_ID);

/** Every strip, with the age band the runtime probe samples it in. */
const STRIPS: Record<string, { oldest: number; youngest: number }> = {
  "alps-adria-distal-margin-oct-plate-307": { oldest: 165, youngest: 35 },
  "alps-adria-distal-margin-oct-plate-308": { oldest: 165, youngest: 35 },
  "alps-adria-necking-zone-plate-307": { oldest: 180, youngest: 19 },
  "alps-adria-necking-zone-plate-308": { oldest: 180, youngest: 19 },
  "alps-adria-proximal-retrowedge-plate-307": { oldest: 200, youngest: 5 },
  "alps-adria-proximal-retrowedge-plate-308": { oldest: 200, youngest: 5 },
  "alps-europe-distal-margin-oct-plate-305": { oldest: 165, youngest: 40 },
  "alps-europe-outer-necking-zone-plate-305": { oldest: 180, youngest: 32 },
  "alps-europe-inner-necking-zone-plate-305": { oldest: 180, youngest: 25 },
  "alps-europe-proximal-subducted-margin-plate-305": { oldest: 200, youngest: 10 },
  "caledonides-baltica-distal-margin-cot-plate-302": { oldest: 600, youngest: 430 },
  "caledonides-baltica-outer-shelf-plate-302": { oldest: 600, youngest: 420 },
  "caledonides-baltica-middle-allochthon-root-plate-302": { oldest: 600, youngest: 405 },
  "caledonides-laurentia-distal-margin-cot-plate-102": { oldest: 600, youngest: 425 },
  "caledonides-laurentia-proximal-margin-plate-102": { oldest: 600, youngest: 410 },
};
const CARRYING_PLATE: Record<string, number> = {
  "plate-307": 307, "plate-308": 308, "plate-305": 305, "plate-302": 302, "plate-102": 102,
};

describe("restored pre-collision margins in the shipped package", () => {
  it("poses every strip inside its lifecycle and none of them at the present day", async () => {
    const manifest = await readManifest();
    const runtime = new CaoReconstructionRuntime(manifest, fetcher);
    const chartIds = Object.fromEntries(Object.keys(STRIPS).map((featureId) => [featureId,
      `correction:${RESTORED_COLLISION_MARGIN_CORRECTION_ID}:${featureId}`
      + ":restored-collision-margin"]));

    const supported = async (ageMa: number) => {
      const revision = await runtime.request(ageMa).prepared;
      const rows = new Map(revision.charts.map((chart) => [chart.chartId, chart.support.kind]));
      const marginCount = revision.materialCorrections.restoredCollisionMarginActiveCharts;
      revision.release();
      return { rows, marginCount };
    };

    // 45 Ma: every Alpine strip is alive (the youngest retires at 40 Ma) and
    // every Caledonide strip is long gone.
    const alpine = await supported(45);
    for (const [featureId, band] of Object.entries(STRIPS)) {
      const kind = alpine.rows.get(chartIds[featureId]!);
      expect(kind, `${featureId} at 45 Ma`).toBe(
        band.youngest < 45 && 45 <= band.oldest ? "supported" : "inactive");
    }
    expect(alpine.marginCount).toBe(10);

    // 420 Ma: two Caledonide strips are alive - the Baltoscandian
    // middle-allochthon root (405 Ma) and the Laurentian proximal margin
    // (410 Ma). The Baltoscandian distal margin retired at 430 and the
    // Laurentian distal one at 425; 420 is exactly the outer-shelf retirement
    // age and `youngestExclusive` keeps it off on its own boundary.
    const scandian = await supported(420);
    for (const [featureId, band] of Object.entries(STRIPS)) {
      const kind = scandian.rows.get(chartIds[featureId]!);
      expect(kind, `${featureId} at 420 Ma`).toBe(
        band.youngest < 420 && 420 <= band.oldest ? "supported" : "inactive");
    }
    expect(scandian.marginCount).toBe(2);

    // No Alpine strip is on screen in the Scandian window: the oldest of them
    // is born at 200 Ma, in the Alpine Tethys rift.
    const alpineAt420 = [...Object.keys(STRIPS)].filter((featureId) =>
      featureId.startsWith("alps-") && scandian.rows.get(chartIds[featureId]!) === "supported");
    expect(alpineAt420).toEqual([]);

    // Nothing at all at the present day, and nothing Alpine after 5 Ma: the
    // youngest Alpine retirement is the Adriatic proximal retro-wedge at 5 Ma
    // and its bound is exclusive, so 5 Ma itself is already empty.
    for (const ageMa of [0, 1, 5]) {
      const probe = await supported(ageMa);
      expect(probe.marginCount, `restored margins active at ${ageMa} Ma`).toBe(0);
      for (const featureId of Object.keys(STRIPS)) {
        expect(probe.rows.get(chartIds[featureId]!), `${featureId} at ${ageMa} Ma`)
          .toBe("inactive");
      }
    }
    runtime.dispose();
  }, 120_000);

  it("draws the strips as crust of unmapped depth, never as cited land", async () => {
    const manifest = await readManifest();
    const catalog = expandInternedPackageDocument(
      await readJson(manifest.materialCorrections!.catalog.url)) as MaterialCorrectionCatalogV1;
    const core = expandInternedPackageDocument(await readJson(manifest.core.url)) as
      ReconstructionCoreV2;
    const charts = marginCharts(catalog);
    expect(charts).toHaveLength(15);
    expect(() => validateMaterialCorrectionCatalogV1(catalog, manifest, core)).not.toThrow();

    for (const chart of charts) {
      const featureId = chart.fragmentOrCohortId;
      const band = STRIPS[featureId];
      expect(band, `${featureId} is a pinned strip`).toBeDefined();
      expect(chart.lifecycle.validTimeMa).toEqual(band);
      expect(chart.lifecycle.youngestExclusive).toBe(true);
      expect(chart.surfaceEvidence.kind).toBe("unknown");
      expect(chart.sourceFeatureTypes).toEqual([RESTORED_COLLISION_MARGIN_SOURCE_TYPE]);
      expect(chart.evidence.correction!.poseStatus).toBe("model-inference");
      expect(chart.evidence.correction!.materialStatus).toBe("restored-consumed-margin");
      expect(chart.evidence.correction!.consumedByMa).toBe(band!.youngest);
      expect(chart.evidence.correction!.restoredWidthKm).toBeGreaterThan(0);
      // Bound to the plate carrying its datum crust, never to the static
      // partition under the restored ground, which is oceanic.
      const suffix = Object.keys(CARRYING_PLATE).find((key) => featureId.endsWith(key))!;
      const plate = CARRYING_PLATE[suffix]!;
      const entries = new Set((chart.motionBindings ?? []).map((binding) => binding.entryId));
      expect(entries.size).toBeGreaterThan(0);
      for (const entryId of entries) expect(entryId).toContain(`plate-${plate}-`);
      for (const sourceId of chart.evidence.sourceIds) {
        expect(sources.some((source) => source.id === sourceId), sourceId).toBe(true);
      }
    }

    // The appearance is where "crust, not land" is actually enforced: the batch
    // that owns these charts declares the shelf appearance, so the renderer
    // draws them at crust level under palaeo-shallow-marine instead of with the
    // land fill every other correction batch carries.
    const batch = catalog.spatialBatches.find(
      (row) => row.batchId === "material-correction-restored-margin");
    expect(batch).toBeDefined();
    expect(batch!.surfaceAppearance).toBe("shelf");
    expect(batch!.overlapPolicy).toBe("native-visual-and-picking-precedence");
    expect(batch!.staticDisplayControl!.displayHeightMetres).toBe(0);
    for (const other of catalog.spatialBatches) {
      if (other.batchId === batch!.batchId) continue;
      expect(other.surfaceAppearance, `${other.batchId} keeps the land appearance`)
        .toBeUndefined();
    }

    // A strip that survived to the present, lost its crust status, or claimed a
    // surface class turns the package validator red.
    const mutate = (change: (chart: MaterialCorrectionCatalogV1["charts"][number]) => object) => ({
      ...catalog,
      charts: catalog.charts.map((chart) =>
        chart === charts[0] ? { ...chart, ...change(chart) } : chart),
    }) as MaterialCorrectionCatalogV1;
    expect(() => validateMaterialCorrectionCatalogV1(mutate((chart) => ({
      lifecycle: { validTimeMa: { ...chart.lifecycle.validTimeMa, youngest: 0 } },
    })), manifest, core)).toThrow(/derived material/);
    expect(() => validateMaterialCorrectionCatalogV1(mutate((chart) => ({
      evidence: { ...chart.evidence,
        correction: { ...chart.evidence.correction!, materialStatus: "supported" as const } },
    })), manifest, core)).toThrow(/derived material/);
    expect(() => validateMaterialCorrectionCatalogV1(mutate(() => ({
      surfaceEvidence: { kind: "classified" as const, surfaceClass: "land" as const,
        sourceIds: ["gayer-1987-baltoscandian-margin"] },
    })), manifest, core)).toThrow(/derived material/);
  });

  it("carries the models, the published spread and the consumption ages in the map key", () => {
    // The register the Greater India line settled: name the model, say crust
    // rather than land, carry the spread, name the age the model consumes it.
    for (const fragment of ["Le Breton et al. (2021)", "Gayer et al. (1987)", "Gee (1978)",
      "Lorenz et al. (2011)", "Fossen (2010)", "140–423 km", "430 and 405 Ma", "40 and 5 Ma"]) {
      expect(RESTORED_COLLISION_MARGIN_EVIDENCE_LINE).toContain(fragment);
    }
    expect(RESTORED_COLLISION_MARGIN_EVIDENCE_LINE).toContain("model inference");
    expect(RESTORED_COLLISION_MARGIN_EVIDENCE_LINE).toContain("Crust of unmapped depth");
    // It must never call restored margin crust land.
    expect(RESTORED_COLLISION_MARGIN_EVIDENCE_LINE).not.toMatch(/\bland\b/);
  });
});
