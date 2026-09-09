/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getModernReliefPatch,
  getSnapshot,
  modernLandscapePresets,
  modernReliefPatches,
  pointsOfInterest,
  sources,
  timeSlices,
} from "./index";
import type { ModernClimateControl, ModernClimateGroup } from "./types";
import { resolveDataAssetUrl } from "./snapshots";

const sourceIds = new Set(sources.map((source) => source.id));

function localAssetFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const requested = String(input);
    const assetPath = requested.includes("/data/")
      ? requested.slice(requested.indexOf("/data/") + 1)
      : requested;
    try {
      const body = await readFile(resolve(process.cwd(), "public", assetPath), "utf8");
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("science catalogs", () => {
  it("covers every formally named Phanerozoic period", () => {
    const periods = new Set(timeSlices.map((slice) => slice.period));
    for (const period of ["Cambrian", "Ordovician", "Silurian", "Devonian", "Carboniferous", "Permian", "Triassic", "Jurassic", "Cretaceous", "Paleogene", "Neogene", "Quaternary"]) {
      expect(periods.has(period), period).toBe(true);
    }
    expect(timeSlices[0].ageMa).toBeGreaterThan(4567);
    expect(timeSlices.at(-1)?.ageMa).toBe(0);
    expect(timeSlices.find((slice) => slice.id === "permian")?.ageMa).toBeGreaterThan(251.902);
    expect(timeSlices.find((slice) => slice.id === "kpg-boundary")?.ageMa).toBeCloseTo(66.04);
    expect(timeSlices.find((slice) => slice.id === "antarctic-glaciation")?.ageMa).toBeCloseTo(33.6);
  });

  it("keeps all catalog references resolvable and POI ranges valid", () => {
    expect(pointsOfInterest.length).toBeGreaterThanOrEqual(15);
    for (const record of [...timeSlices, ...pointsOfInterest]) {
      expect(record.sourceIds.length, record.id).toBeGreaterThan(0);
      for (const sourceId of record.sourceIds) expect(sourceIds.has(sourceId), `${record.id}: ${sourceId}`).toBe(true);
    }
    for (const poi of pointsOfInterest) {
      expect(poi.ageStartMa, poi.id).toBeGreaterThanOrEqual(poi.ageEndMa);
      if (poi.coordinates) {
        expect(Math.abs(poi.coordinates[0]), poi.id).toBeLessThanOrEqual(180);
        expect(Math.abs(poi.coordinates[1]), poi.id).toBeLessThanOrEqual(90);
      }
    }
    expect(modernLandscapePresets).toHaveLength(10);
    for (const preset of modernLandscapePresets) {
      expect(Math.abs(preset.coordinates[0]), preset.id).toBeLessThanOrEqual(180);
      expect(Math.abs(preset.coordinates[1]), preset.id).toBeLessThanOrEqual(90);
      expect(preset.distance, preset.id).toBeGreaterThanOrEqual(1.65);
      expect(preset.distance, preset.id).toBeLessThanOrEqual(1.9);
      for (const sourceId of preset.sourceIds) expect(sourceIds.has(sourceId), `${preset.id}: ${sourceId}`).toBe(true);
    }
  });
});

describe("snapshot selection and assets", () => {
  it("resolves assets under a project-path deployment", () => {
    expect(resolveDataAssetUrl("data/paleodem-0ma.json", "https://example.test/EarthHistory/index.html"))
      .toBe("https://example.test/EarthHistory/data/paleodem-0ma.json");
  });

  it("returns the nearest authored PaleoDEM age without relabeling it", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const snapshot = await getSnapshot(385);
    expect(snapshot.ageMa).toBe(400);
    expect(snapshot.requestedAgeMa).toBe(385);
    expect(snapshot.geographicSourceAgeMa).toBe(400);
    expect(snapshot.id).toBe("devonian__paleodem-400ma");
    expect(snapshot.evidence).toBe("model-output");
    expect(snapshot.countries.length).toBeGreaterThan(100);
    expect(snapshot.countries.every((country) => country.evidence === "model-output")).toBe(true);
    expect(snapshot.controls?.width).toBe(180);
    expect(snapshot.controls?.height).toBe(91);
    expect(snapshot.controls?.elevation).toHaveLength(180 * 91);
    expect(snapshot.caveat).toContain("Requested 385 Ma");
  });

  it("applies the evolution mask before land plants", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const cambrian = await getSnapshot(520);
    expect(cambrian.environment.vegetation).toBe(0);
    expect(cambrian.controls?.vegetationPotential?.some((value) => value !== 0)).toBe(false);
  });

  it("returns early Earth as an explicit non-geographic scenario", async () => {
    const snapshot = await getSnapshot(4512);
    expect(snapshot.ageMa).toBe(4510);
    expect(snapshot.environment.stage).toBe("giant-impact");
    expect(snapshot.land).toEqual([]);
    expect(snapshot.countries).toEqual([]);
    expect(snapshot.poiCoordinates).toEqual({});
    expect(snapshot.controls?.elevation.some((value) => value > 0)).toBe(true);
    expect(snapshot.caveat).toContain("deterministic artistic crust/islands");
  });

  it("provides only reconstructed display coordinates for ancient POIs", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const snapshot = await getSnapshot(66.04);
    expect(snapshot.poiIds).toContain("chicxulub");
    expect(snapshot.poiCoordinates?.chicxulub).toEqual([-71.55, 25.119]);
    expect(snapshot.poiCoordinates?.chicxulub).not.toEqual([-89.5, 21.3]);
  });

  it("uses a distinct render identity for present day and the LGM", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const present = await getSnapshot(0);
    const lgm = await getSnapshot(0.021);
    expect(lgm.id).not.toBe(present.id);
    expect(lgm.label).toBe("Last Glacial Maximum");
    expect(lgm.geographicSourceAgeMa).toBe(0);
    expect(lgm.environment.iceIntensity).toBeGreaterThan(present.environment.iceIntensity ?? 0);
    expect(lgm.modernClimate).toBeUndefined();
  });

  it("uses the valid +180 twin for the verified 0 Ma southern duplicate-zero run", async () => {
    const asset = JSON.parse(
      await readFile(resolve(process.cwd(), "public/data/paleodem-0ma.json"), "utf8"),
    ) as { width: number; height: number; elevation: number[] };
    const expected = new Map([
      [-60, -4360], [-62, -4040], [-64, -2320], [-66, -3360], [-68, -2320],
      [-70, -3520], [-72, -2160], [-74, -160], [-76, -400], [-78, -760],
      [-80, -680], [-82, -480], [-84, -360], [-86, 2120], [-88, 920],
    ]);
    expect(asset.width).toBe(180);
    expect(asset.height).toBe(91);
    for (const [latitude, elevation] of expected) {
      const row = (90 - latitude) / 2;
      expect(asset.elevation[row * asset.width], `${latitude}° at -180°`).toBe(elevation);
    }
    // The source-authored -90° pole is outside the verified duplicate-zero run.
    expect(asset.elevation[90 * asset.width]).toBe(0);

    const manifest = JSON.parse(
      await readFile(resolve(process.cwd(), "public/data/manifest.json"), "utf8"),
    ) as { inputs: Record<string, { sourceAdapters?: Array<{ ageMa: number; affectedOutputCells: number }> }> };
    expect(manifest.inputs["scotese-wright-paleodem-v2"].sourceAdapters).toEqual([
      expect.objectContaining({ ageMa: 0, affectedOutputCells: 15 }),
    ]);
  });

  it("constrains modern climate potential with source-authored semantic classes", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const climate = (await getSnapshot(0)).modernClimate;
    expect(climate).toBeDefined();
    expect(climate?.period).toBe("1991–2020");
    expect(climate?.classes).toHaveLength(720 * 360);
    expect(climate?.legend).toHaveLength(30);

    const groupAt = (control: ModernClimateControl, longitude: number, latitude: number): ModernClimateGroup => {
      const x = Math.round((longitude - control.longitudeOrigin) / control.cellSizeDegrees);
      const y = Math.round((control.latitudeOrigin - latitude) / control.cellSizeDegrees);
      const value = control.classes[y * control.width + x];
      return control.legend.find((entry) => entry.value === value)?.group ?? "ocean";
    };
    expect(groupAt(climate!, 13, 23)).toBe("desert");
    expect(groupAt(climate!, -62, -4)).toBe("tropical-rainforest");
    expect(groupAt(climate!, 68, 52)).toBe("steppe");
    expect(groupAt(climate!, 105, 62)).toBe("cold-forest");
    expect(groupAt(climate!, -42, 74)).toBe("frost");
    expect(groupAt(climate!, -74, -45)).toBe("temperate");
    expect(groupAt(climate!, -69, -45)).toBe("desert");
  });

  it("loads bounded modern relief patches with explicit registration", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    expect(modernReliefPatches).toHaveLength(5);
    const metadata = modernReliefPatches.find((patch) => patch.id === "himalayas");
    expect(metadata?.bounds).toEqual([72, 22, 100, 38]);
    expect(metadata?.registration).toBe("pixel-center");
    expect(metadata?.rowOrder).toBe("north-to-south");
    const patch = await getModernReliefPatch("himalayas");
    expect(patch.elevation).toHaveLength(256 * 256);
    expect(Math.max(...patch.elevation)).toBeGreaterThan(6000);
    expect(patch.verticalDatum).toBe("EGM2008");
    await expect(getModernReliefPatch("unknown")).rejects.toThrow(RangeError);
  });

  it("rejects invalid ages", async () => {
    await expect(getSnapshot(-1)).rejects.toThrow(RangeError);
    await expect(getSnapshot(Number.NaN)).rejects.toThrow(RangeError);
  });

  it("ships every declared source-age grid and country derivative within the static budget", async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), "public/data/manifest.json"), "utf8")) as {
      inputs: Record<string, { outputs?: Array<{ ageMa: number; bytes: number }> }>;
    };
    const paleodem = manifest.inputs["scotese-wright-paleodem-v2"].outputs ?? [];
    const countries = manifest.inputs["paleomap-country-reference-v3"].outputs ?? [];
    expect(paleodem).toHaveLength(18);
    expect(countries).toHaveLength(17);
    expect(new Set(paleodem.map((output) => output.ageMa)).size).toBe(18);
    expect(paleodem.reduce((sum, output) => sum + output.bytes, 0) + countries.reduce((sum, output) => sum + output.bytes, 0)).toBeLessThan(5 * 1024 * 1024);
  });
});
