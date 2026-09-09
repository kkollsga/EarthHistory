import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CountryOutline } from "../data";
import {
  COUNTRY_RIBBON_CLEARANCE_METRES,
  createCountryRibbonBatches,
  MAX_COUNTRY_RIBBON_BYTES,
  MAX_COUNTRY_RIBBON_VERTICES,
  resampleCountryRibbonHeights,
  updateCountryRibbonPositions,
} from "./countryRibbons";
import { EARTH_RADIUS_METRES } from "./surface";

const countries: CountryOutline[] = [
  {
    id: "fixture-a",
    name: "Fixture A",
    lines: [
      [[-4, 0], [4, 0]],
      [[20, 12], [22, 13], [24, 12]],
    ],
    sourceIds: ["fixture"],
    evidence: "model-output",
  },
];

describe("country reference ribbons", () => {
  it("batches every run into one groove and one rim without joining runs", () => {
    const batches = createCountryRibbonBatches(countries, {
      sampleHeightMetres: () => 0,
    }, { maxAngularStepDegrees: 1, maxHeightErrorMetres: 1_000 });

    expect(batches.map((batch) => batch.kind)).toEqual(["groove", "rim"]);
    expect(batches.every((batch) => batch.runCount === 2)).toBe(true);
    expect(batches.every((batch) => batch.indices.length % 6 === 0)).toBe(true);
    expect(batches.every((batch) =>
      Math.max(...batch.indices) < batch.positions.length / 3
    )).toBe(true);
    const expectedQuads = batches[0].centerVertexCount - batches[0].runCount;
    expect(batches[0].indices.length).toBe(expectedQuads * 6);
    const [a, b, c] = batches[0].indices;
    const at = (index: number) => batches[0].positions.subarray(index * 3, index * 3 + 3);
    const pa = at(a);
    const pb = at(b);
    const pc = at(c);
    const ab = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
    const ac = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const normal = [
      ab[1] * ac[2] - ab[2] * ac[1],
      ab[2] * ac[0] - ab[0] * ac[2],
      ab[0] * ac[1] - ab[1] * ac[0],
    ];
    expect(normal[0] * pa[0] + normal[1] * pa[1] + normal[2] * pa[2])
      .toBeGreaterThan(0);
  });

  it("refines a geodesic where displayed height bows away from its endpoints", () => {
    const singleCountry: CountryOutline[] = [{
      ...countries[0],
      lines: [[[-1, 0], [1, 0]]],
    }];
    const flat = createCountryRibbonBatches(singleCountry, {
      sampleHeightMetres: () => 0,
    }, {
      maxAngularStepDegrees: 5,
      maxHeightErrorMetres: 100,
      maxAdaptiveDepth: 3,
    });
    const bowed = createCountryRibbonBatches(singleCountry, {
      sampleHeightMetres: ([, , z]) => Math.abs(z) < 0.004 ? 1_000 : 0,
    }, {
      maxAngularStepDegrees: 5,
      maxHeightErrorMetres: 100,
      maxAdaptiveDepth: 3,
    });

    expect(flat[0].centerVertexCount).toBe(2);
    expect(bowed[0].centerVertexCount).toBeGreaterThan(flat[0].centerVertexCount);
  });

  it("anchors both ribbon edges above their independently sampled relief", () => {
    const batches = createCountryRibbonBatches(countries, {
      sampleHeightMetres: ([, y]) => 1_800 + y * 400,
    }, {
      maxAngularStepDegrees: 1,
      maxHeightErrorMetres: 1_000,
      verticalExaggeration: 30,
    });

    for (const batch of batches) {
      for (let index = 0; index < batch.heightsMetres.length; index += 1) {
        const offset = index * 3;
        const radius = Math.hypot(
          batch.positions[offset],
          batch.positions[offset + 1],
          batch.positions[offset + 2],
        );
        const expected = 1 + (
          batch.heightsMetres[index] * 30 + COUNTRY_RIBBON_CLEARANCE_METRES
        ) / EARTH_RADIUS_METRES;
        expect(radius).toBeCloseTo(expected, 6);
      }
    }
  });

  it("updates 1x -> 30x -> 1x without rebuilding or compounding", () => {
    const [batch] = createCountryRibbonBatches(countries, {
      sampleHeightMetres: () => 2_000,
    }, { maxAngularStepDegrees: 1, maxHeightErrorMetres: 1_000 });
    const directions = batch.directions;
    const indices = batch.indices;
    const one = batch.positions.slice();

    updateCountryRibbonPositions(batch, 30);
    const thirty = batch.positions.slice();
    updateCountryRibbonPositions(batch, 1);

    expect(batch.directions).toBe(directions);
    expect(batch.indices).toBe(indices);
    expect(batch.positions).toEqual(one);
    expect(Math.hypot(...thirty.subarray(0, 3))).toBeGreaterThan(
      Math.hypot(...one.subarray(0, 3)),
    );
  });

  it("resamples relief while retaining cached ribbon topology", () => {
    const [batch] = createCountryRibbonBatches(countries, {
      sampleHeightMetres: () => 100,
    }, { maxAngularStepDegrees: 1, maxHeightErrorMetres: 1_000 });
    const directions = batch.directions;
    const indices = batch.indices;
    const previousRadius = Math.hypot(...batch.positions.subarray(0, 3));

    resampleCountryRibbonHeights(batch, { sampleHeightMetres: () => 2_400 }, 3);

    expect(batch.directions).toBe(directions);
    expect(batch.indices).toBe(indices);
    expect(batch.heightsMetres.every((height) => height === 2_400)).toBe(true);
    expect(Math.hypot(...batch.positions.subarray(0, 3))).toBeGreaterThan(previousRadius);
  });

  it("fails closed when the shared vertex or byte budget is exceeded", () => {
    expect(() => createCountryRibbonBatches(countries, {
      sampleHeightMetres: () => 0,
    }, { maxRenderedVertices: 12 })).toThrow(/vertex budget/);
    expect(() => createCountryRibbonBatches(countries, {
      sampleHeightMetres: () => 0,
    }, { maxBytes: 128 })).toThrow(/byte budget/);
  });

  it("keeps every authored country asset inside the regional ribbon budget", async () => {
    const dataDirectory = resolve(process.cwd(), "public/data");
    const assets = (await readdir(dataDirectory)).filter((name) =>
      name === "geography-0ma.json" || /^countries-\d+ma\.json$/.test(name)
    );
    expect(assets).toHaveLength(18);
    for (const asset of assets) {
      const parsed = JSON.parse(
        await readFile(resolve(dataDirectory, asset), "utf8"),
      ) as { countries: CountryOutline[] };
      const batches = createCountryRibbonBatches(parsed.countries, {
        sampleHeightMetres: () => 0,
      }, { maxAngularStepDegrees: 0.25, maxHeightErrorMetres: 120 });
      const vertices = batches.reduce(
        (sum, batch) => sum + batch.positions.length / 3,
        0,
      );
      const bytes = batches.reduce((sum, batch) => sum + batch.byteLength, 0);
      expect(batches, asset).toHaveLength(2);
      expect(vertices, asset).toBeLessThanOrEqual(MAX_COUNTRY_RIBBON_VERTICES);
      expect(bytes, asset).toBeLessThanOrEqual(MAX_COUNTRY_RIBBON_BYTES);
    }
  });
});
