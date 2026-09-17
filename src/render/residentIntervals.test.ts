import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { residentIntervalBudget, writeCaoResidencyDataset } from "./GlobeScene";

const HIGH_INTERVALS = 25;
const LOW_INTERVALS = 8;

/**
 * Residency is a memory policy. The automatic quality watchdog used to collapse
 * the ceiling to one interval during the first heavy load, with no path back,
 * so every later crossing paid a fresh upload — the cost the watchdog fires to
 * avoid. These hold the two owners apart.
 */
describe("resident map interval budget", () => {
  it("keeps the full budget when the watchdog is the only thing asking for less", () => {
    // "auto" is what the watchdog downgrades from; it never changes the request.
    expect(residentIntervalBudget("auto", 8)).toEqual(
      { intervals: HIGH_INTERVALS, bytes: 55 * 1024 * 1024 });
    expect(residentIntervalBudget("auto", undefined).intervals).toBe(HIGH_INTERVALS);
    expect(residentIntervalBudget("high", 8).intervals).toBe(HIGH_INTERVALS);
  });

  it("lowers the budget only for an explicit low profile or a small device", () => {
    expect(residentIntervalBudget("low", 8)).toEqual(
      { intervals: LOW_INTERVALS, bytes: 24 * 1024 * 1024 });
    expect(residentIntervalBudget("auto", 2).intervals).toBe(LOW_INTERVALS);
    expect(residentIntervalBudget("auto", 4).intervals).toBe(HIGH_INTERVALS);
  });

  it("leaves the ceiling untouched on the automatic effective-quality change", () => {
    const source = readFileSync(new URL("./GlobeScene.ts", import.meta.url), "utf8");
    const body = (name: string) => {
      const start = source.indexOf(`${name}(value`);
      expect(start).toBeGreaterThan(0);
      const open = source.indexOf("{", start);
      let depth = 0;
      for (let index = open; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}" && (depth -= 1) === 0) return source.slice(open, index);
      }
      throw new Error(`unbalanced body for ${name}`);
    };
    // `applyEffectiveQuality` is the watchdog's own path; `setQuality` is the
    // explicit selection that owns the budget.
    expect(body("private applyEffectiveQuality")).not.toContain("setResidentIntervalCeiling");
    expect(body("setQuality")).toContain("setResidentIntervalCeiling");
  });

  /**
   * The two residency keys used to be written only by the native revision path
   * and by a composition change. A map-interval crossing is neither — the
   * composition stays `palaeo` from the first entry into the band to the last —
   * so they froze at the first crossing's reading (20,395,812 B, one resident)
   * while the surface set went on to hold three members and 38,609,378 B. Every
   * reader of those keys was measuring a number that had stopped moving.
   */
  it("moves the residency keys on every interval publish and on the clear", () => {
    const source = readFileSync(new URL("./GlobeScene.ts", import.meta.url), "utf8");
    const body = (signature: string) => {
      const start = source.indexOf(signature);
      expect(start).toBeGreaterThan(0);
      const open = source.indexOf("{", start);
      let depth = 0;
      for (let index = open; index < source.length; index += 1) {
        if (source[index] === "{") depth += 1;
        else if (source[index] === "}" && (depth -= 1) === 0) return source.slice(open, index);
      }
      throw new Error(`unbalanced body for ${signature}`);
    };
    expect(body("setPreparedPalaeoInterval(interval")).toContain("this.publishCaoResidencyDataset()");
    expect(body("private clearPalaeoPublication()")).toContain("this.publishCaoResidencyDataset()");
  });

  it("reports the second interval publish, not the first", () => {
    let residents = 0;
    let gpuBytes = 0;
    const renderer = {
      residentGpuBytes: () => gpuBytes,
      residentIntervalCount: () => residents,
      releasedSurfaceClasses: () => ["land"],
    };
    const dataset: Record<string, string | undefined> = {};
    residents = 1; gpuBytes = 8_492_702;
    writeCaoResidencyDataset(dataset, renderer);
    expect(dataset.caoResidentIntervals).toBe("1");
    const first = dataset.caoFoundationGpuBytes;
    residents = 2; gpuBytes = 29_284_048;
    writeCaoResidencyDataset(dataset, renderer);
    expect(dataset.caoResidentIntervals).toBe("2");
    expect(dataset.caoFoundationGpuBytes).not.toBe(first);
    expect(dataset.caoFoundationReleasedClasses).toBe("land");
  });
});
