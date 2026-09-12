import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { MaterialCorrectionCatalogV1 } from "../reconstruction/packageV2";
import { sources } from "./sources";

describe("scientific source catalog", () => {
  it("resolves every curated source identifier emitted by regional material corrections", () => {
    const catalog = JSON.parse(readFileSync(
      "public/data/reconstruction/cao-v2.4/corrections/material-v1/catalog.json", "utf8",
    )) as MaterialCorrectionCatalogV1;
    const known = new Set(sources.map((source) => source.id));
    expect(known.size).toBe(sources.length);
    for (const chart of catalog.charts) {
      for (const sourceId of chart.evidence.sourceIds) expect(known.has(sourceId)).toBe(true);
    }
  });
});
