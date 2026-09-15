import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expandInternedPackageDocument } from "./packageIntern";
import { decodePalaeoCoastlineClassCatalog } from "./palaeoRings";
import {
  GREATER_INDIA_CHART_ID, GREATER_INDIA_EVIDENCE_LINE,
  RESTORED_COLLISION_MARGIN_CORRECTION_ID,
} from "./caoDomain";
import { sources } from "../data/sources";

/**
 * The product requirement is one sentence: sufficient continental land has to be
 * compacted to explain the height of the mountains. Cao 2024 answers it for the
 * Himalaya - it ships a `Greater India` feature 1,341 km wider than the present
 * Indian outline at 85 E, and retires it at 10 Ma - and does not answer it for
 * the Alps or the Caledonides, which are built out of present-day crust tiles.
 * Those two are answered by charts we author: the restored pre-collision
 * margins of `data/corrections/restored-margins/`, on the lower plate of each
 * collision, retired as the model closes the room for them.
 *
 * `docs/research/palaeo-coastlines-collision-shortening.md` is the memo and
 * `...-collision-shortening.json` the measured record; `scripts/research/
 * validate_precollision_extent.py` re-derives the record from the pinned Cao
 * model with the restored margins included. Neither of those reads the *shipped
 * package*, so neither notices if a package refresh drops Greater India,
 * re-dates its lifecycle, or shrinks it. That is this file's job: it reads the
 * bytes a browser downloads and holds them against the record the memo argues
 * from.
 *
 * All three verdicts now pass. A pass that quietly became a failure, a verdict
 * that stopped following the numbers beside it, or an Alpine or Caledonide row
 * that passes on the model's own crust rather than on a restored margin, is the
 * defect this file guards.
 */

const packageRoot = resolve("public/data/reconstruction/cao-v2.4");
const recordPath = resolve("docs/research/palaeo-coastlines-collision-shortening.json");

interface ChartRecord {
  readonly chartId: string;
  readonly lifecycleOldestMa: number;
  readonly lifecycleYoungestMa: number;
  readonly parts?: number;
}
interface CollisionRecord {
  readonly orogen: string;
  readonly literature: { readonly minimumKm: number };
  readonly verdict: {
    readonly verdict: "pass" | "fail";
    readonly transect: string;
    readonly modelExtentKm: number;
    readonly minimumKm: number;
    readonly shortfallKm: number | null;
    /** What the model's own crust reaches, without any restored margin. */
    readonly nativeModelExtentKm?: number;
    readonly source?: string;
    readonly at66N?: { readonly modelExtentKm: number; readonly minimumKm: number;
      readonly shortfallKm: number | null };
  };
  readonly model: Record<string, unknown>;
}
interface ShorteningRecord {
  readonly recordId: string;
  readonly model: {
    readonly features: Record<string, {
      plateId: number; validFromMa: number; validToMa: number | null; areaKm2: number;
    }>;
    readonly charts: Record<string, ChartRecord>;
  };
  readonly collisions: Record<string, CollisionRecord>;
  readonly restoredMargins: {
    readonly correctionId: string;
    readonly strips: number;
    readonly areaKm2: Record<string, number>;
    readonly conjugateMarginExtentKm: Record<string, number>;
  };
  readonly palaeoLayer: {
    readonly boundGround: Record<string, Record<string,
      { pieces: number; bboxDeg: [number, number, number, number] } | null>>;
  };
}

interface CoreChart {
  readonly chartId: string;
  readonly lifecycle: { readonly validTimeMa: { oldest: number; youngest: number } };
}

let recordPromise: Promise<ShorteningRecord> | undefined;
const shorteningRecord = () => (recordPromise ??= readFile(recordPath, "utf8")
  .then((text) => JSON.parse(text) as ShorteningRecord));

let corePromise: Promise<Map<string, CoreChart>> | undefined;
const coreCharts = () => (corePromise ??= readFile(resolve(packageRoot, "core.json"), "utf8")
  .then((text) => {
    const core = expandInternedPackageDocument(JSON.parse(text)) as { charts: CoreChart[] };
    return new Map(core.charts.map((chart) => [chart.chartId, chart]));
  }));

async function classCatalog(surfaceClass: "lm" | "sm") {
  const url = `palaeo-coastlines/${surfaceClass}/palaeo-${surfaceClass}-catalog.json`;
  return decodePalaeoCoastlineClassCatalog(
    JSON.parse(await readFile(resolve(packageRoot, url), "utf8")), surfaceClass);
}

describe("pre-collision continental extent in the shipped package", () => {
  it("ships every crust chart the three shortening budgets are measured on", async () => {
    const record = await shorteningRecord();
    const charts = await coreCharts();
    expect(record.recordId).toBe("palaeo-coastlines-collision-shortening-v1");
    for (const [name, expected] of Object.entries(record.model.charts)) {
      const chart = charts.get(expected.chartId);
      expect(chart, `${name} is missing from core.json`).toBeDefined();
      expect(chart!.lifecycle.validTimeMa.oldest, `${name} oldest`)
        .toBe(expected.lifecycleOldestMa);
      expect(chart!.lifecycle.validTimeMa.youngest, `${name} youngest`)
        .toBe(expected.lifecycleYoungestMa);
      if (expected.parts !== undefined) {
        const prefix = expected.chartId.slice(0, expected.chartId.lastIndexOf(":") + 1);
        const parts = [...charts.keys()].filter((id) => id.startsWith(prefix));
        expect(parts, `${name} part count`).toHaveLength(expected.parts);
      }
    }
  });

  it("keeps Greater India alive from 600 to 10 Ma and lets nothing else share that window",
    async () => {
      const charts = await coreCharts();
      const greaterIndia = charts.get(GREATER_INDIA_CHART_ID);
      expect(greaterIndia).toBeDefined();
      // The 10 Ma disappearance is the model's own statement that this crust is
      // consumed, and it is unique in the package: if a refresh re-dated it to
      // 0 Ma the globe would carry Greater India over Tibet at the present day.
      const retiredAtTen = [...charts.values()]
        .filter((chart) => chart.lifecycle.validTimeMa.youngest === 10);
      expect(retiredAtTen.map((chart) => chart.chartId)).toEqual([greaterIndia!.chartId]);
    });

  it("does not let the model's pre-collision extents shrink below the recorded measurement",
    async () => {
      const record = await shorteningRecord();
      const india = record.collisions["india-asia"]!;
      const indiaExtents = india.model.extentBeyondPresentMarginKm as
        Record<string, { extentBeyondPresentMarginKm: number }>;
      // 85 E is the transect the Himalayan literature minimum is stated on.
      expect(indiaExtents["85E"]!.extentBeyondPresentMarginKm)
        .toBeGreaterThanOrEqual(india.verdict.modelExtentKm);
      expect(india.verdict.modelExtentKm).toBeGreaterThanOrEqual(india.literature.minimumKm);
      expect(india.verdict.verdict).toBe("pass");

      // Adria and Baltica pass only because of the restored margins. Both halves
      // are held: the recorded extent clears the literature minimum, and the
      // model's *own* crust still does not - so a record that dropped the
      // restored margin and kept the verdict cannot stay green.
      const restored = record.restoredMargins;
      expect(restored.correctionId).toBe(RESTORED_COLLISION_MARGIN_CORRECTION_ID);
      expect(restored.strips).toBe(15);
      for (const key of ["adria-europe", "baltica-laurentia"]) {
        const collision = record.collisions[key]!;
        expect(collision.verdict.modelExtentKm)
          .toBeGreaterThanOrEqual(collision.literature.minimumKm);
        expect(collision.verdict.verdict).toBe("pass");
        expect(collision.verdict.shortfallKm).toBeNull();
        expect(collision.verdict.nativeModelExtentKm)
          .toBeLessThan(collision.literature.minimumKm);
        expect(collision.verdict.source).toContain("restored");
      }
      // The Caledonide companion minimum at 66 N, which the modern Atlantic
      // shelf missed by 108 km, is met by the restored margin too.
      expect(record.collisions["baltica-laurentia"]!.verdict.at66N!.modelExtentKm)
        .toBeGreaterThanOrEqual(record.collisions["baltica-laurentia"]!.verdict.at66N!.minimumKm);
    });

  it("still binds palaeo-coastline ground to India, Adria and Baltica", async () => {
    const record = await shorteningRecord();
    const catalogs = {
      lm: await classCatalog("lm"),
      sm: await classCatalog("sm"),
    };
    const bound = (surfaceClass: "lm" | "sm", plateId: number) =>
      catalogs[surfaceClass].bindings.some((binding) => binding.bindingPlateId === plateId);
    // The record's probe found ground riding each of these; a binding table that
    // lost one would silently strand that crust with no surface class at all.
    for (const [surfaceClass, plateId] of
      [["lm", 501], ["sm", 501], ["sm", 307], ["lm", 302], ["sm", 302], ["lm", 102]] as const) {
      expect(bound(surfaceClass, plateId), `${surfaceClass} binds plate ${plateId}`).toBe(true);
    }
    // And the record has to be describing the same package: every interval it
    // probed names a class the catalogs still publish.
    for (const [intervalId, groups] of Object.entries(record.palaeoLayer.boundGround)) {
      expect(catalogs.lm.intervals.some((interval) => interval.intervalId === intervalId),
        `lm publishes ${intervalId}`).toBe(true);
      for (const key of Object.keys(groups)) {
        expect(key).toMatch(/^(lm|sm)-\d+$/);
      }
    }
  });

  it("gates the map-key line on the chart id the record pins", async () => {
    const record = await shorteningRecord();
    const pinned = record.model.charts[
      "Greater India based on Gibbons et al. (2015) Gondwana Research"]!;
    // The map key renders this line only while that chart is posed, so the id it
    // gates on has to be the one the memo measured; a package refresh that
    // re-issues the chart under a new id would otherwise silently drop the line.
    expect(GREATER_INDIA_CHART_ID).toBe(pinned.chartId);
    expect(pinned.lifecycleYoungestMa).toBe(10);
    // The three things the wording must carry: the model it is inferred after,
    // the published spread, and the 10 Ma retirement.
    expect(GREATER_INDIA_EVIDENCE_LINE).toContain("Gibbons et al. (2015)");
    expect(GREATER_INDIA_EVIDENCE_LINE).toContain("600");
    expect(GREATER_INDIA_EVIDENCE_LINE).toContain("3,000");
    expect(GREATER_INDIA_EVIDENCE_LINE).toContain("10 Ma");
    expect(GREATER_INDIA_EVIDENCE_LINE).not.toMatch(/\bland\b/);
    // The Sources panel resolves the key line by id, so the id has to exist.
    expect(sources.some((source) => source.id === "gibbons-2015-greater-india")).toBe(true);
  });

  it("records that the Greater India extension carries shallow sea, not land", async () => {
    const record = await shorteningRecord();
    // Measured: `lm` bound to plate 501 stops at about 30 N, while `sm` bound to
    // 501 reaches 38.6-40.1 N. The Cretaceous-Palaeogene Greater India north of
    // the Tethyan Himalaya therefore renders as shallow sea, which is what the
    // Tethyan Himalayan shelf stratigraphy says it was. If a recompile ever let
    // `lm` ride 501 to the northern tip, the globe would grow a continent-sized
    // landmass over the Tethys and this is where it shows up.
    for (const intervalId of ["117-94", "94-81", "81-58"]) {
      const groups = record.palaeoLayer.boundGround[intervalId]!;
      const land = groups["lm-501"]!;
      const shallow = groups["sm-501"]!;
      expect(land, `${intervalId} lm-501`).not.toBeNull();
      expect(shallow, `${intervalId} sm-501`).not.toBeNull();
      expect(land.bboxDeg[3]).toBeLessThan(31);
      expect(shallow.bboxDeg[3]).toBeGreaterThan(38);
    }
  });
});
