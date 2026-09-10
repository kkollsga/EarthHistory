/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getModernReliefPatch,
  environmentForAge,
  getSnapshot,
  modernLandscapePresets,
  modernReliefPatches,
  PALEODEM_AGES,
  pointsOfInterest,
  resolvePaleodemAgeBracket,
  selectSurfaceRefinementMetadata,
  sources,
  surfaceRefinementAppliesToMode,
  surfaceRefinementSets,
  timeSlices,
} from "./index";
import type { ModernClimateControl, ModernClimateGroup } from "./types";
import { decodePaleodemElevation, resolveDataAssetUrl } from "./snapshots";

const sourceIds = new Set(sources.map((source) => source.id));

function localAssetFetch() {
  return vi.fn(async (input: string | URL | Request) => {
    const requested = String(input);
    const assetPath = requested.includes("/data/")
      ? requested.slice(requested.indexOf("/data/") + 1)
      : requested;
    try {
      if (assetPath.endsWith(".bin")) {
        const bytes = await readFile(resolve(process.cwd(), "public", assetPath));
        const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return new Response(body, { status: 200, headers: { "content-type": "application/octet-stream" } });
      }
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
    expect(modernLandscapePresets).toHaveLength(13);
    for (const preset of modernLandscapePresets) {
      expect(Math.abs(preset.coordinates[0]), preset.id).toBeLessThanOrEqual(180);
      expect(Math.abs(preset.coordinates[1]), preset.id).toBeLessThanOrEqual(90);
      expect(preset.distance, preset.id).toBeGreaterThanOrEqual(1.15);
      expect(preset.distance, preset.id).toBeLessThanOrEqual(1.9);
      for (const sourceId of preset.sourceIds) expect(sourceIds.has(sourceId), `${preset.id}: ${sourceId}`).toBe(true);
    }
    expect(modernLandscapePresets.find((preset) => preset.id === "alps")).toMatchObject({
      coordinates: [10.5, 46.5], distance: 1.18, surfaceMode: "surface",
    });
    expect(modernLandscapePresets.find((preset) => preset.id === "east-african-rift")).toMatchObject({
      coordinates: [40, 9], distance: 1.2, surfaceMode: "surface",
    });
    expect(modernLandscapePresets.find((preset) => preset.id === "japan-trench")).toMatchObject({
      coordinates: [143, 37], surfaceMode: "surface",
    });
  });

});

describe("snapshot selection and assets", () => {
  it("brackets continuous ages with exact recovery at native PaleoDEM knots", () => {
    expect(resolvePaleodemAgeBracket(387)).toEqual({
      requestedAgeMa: 387,
      youngerAgeMa: 385,
      olderAgeMa: 390,
      fraction: 0.4,
      exact: false,
    });
    expect(resolvePaleodemAgeBracket(385)).toEqual({
      requestedAgeMa: 385,
      youngerAgeMa: 385,
      olderAgeMa: 385,
      fraction: 0,
      exact: true,
    });
    expect(resolvePaleodemAgeBracket(0).olderAgeMa).toBe(0);
    expect(resolvePaleodemAgeBracket(540).youngerAgeMa).toBe(540);
    expect(() => resolvePaleodemAgeBracket(Number.NaN)).toThrow(RangeError);
  });

  it("does not freeze present-coordinate editorial tectonic corridors in historical frames", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const [present, fractionalHistory, exactHistory] = await Promise.all([
      getSnapshot(0),
      getSnapshot(2.5),
      getSnapshot(5),
    ]);
    expect(present.tectonics.length).toBeGreaterThan(0);
    expect(fractionalHistory.tectonics).toEqual([]);
    expect(exactHistory.tectonics).toEqual([]);
  });

  it("interpolates numeric climate potential while retaining authored biological limits", () => {
    const younger = environmentForAge(390);
    const midpoint = environmentForAge(392.5);
    const older = environmentForAge(395);
    expect(midpoint.vegetation).toBeCloseTo((younger.vegetation + older.vegetation) / 2);
    expect(midpoint.temperatureC).toBeCloseTo(
      ((younger.temperatureC ?? 0) + (older.temperatureC ?? 0)) / 2,
    );
    expect(environmentForAge(500).vegetation).toBe(0);
    expect(environmentForAge(0.021).iceIntensity).toBe(0.8);
  });

  it("resolves assets under a project-path deployment", () => {
    expect(resolveDataAssetUrl("data/paleodem-0ma.bin", "https://example.test/EarthHistory/index.html"))
      .toBe("https://example.test/EarthHistory/data/paleodem-0ma.bin");
  });

  it("returns both source endpoints and labels a between-knot reconstruction as interpolation", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const snapshot = await getSnapshot(387);
    expect(snapshot.ageMa).toBe(387);
    expect(snapshot.requestedAgeMa).toBe(387);
    expect(snapshot.geographicSourceAgeMa).toBe(385);
    expect(snapshot.geographicSourceAgeBracketMa).toEqual([385, 390]);
    expect(snapshot.id).toBe("devonian__paleodem-385-390ma");
    expect(snapshot.evidence).toBe("interpolation");
    expect(snapshot.periodCoordinateView).toEqual({
      id: "paleomap-v3-v2d3",
      frame: {
        modelId: "paleomap-global-plate-model-v3",
        modelVersion: "m15g60_v2d3 / ContOCeanPolyv10u_v2d3",
        referenceFrameId: "anchor-plate-0",
        anchorPlateId: 0,
        directionConvention: "gplates-xyz-x0e-y90e-znorth",
      },
      motionUrl: "data/paleomap-motion-v1.json",
      conversionEvidence: "same-model-motion",
      unsupportedPolicy: "nearest-native-discrete",
    });
    expect(snapshot.temporalSurface).toMatchObject({
      intervalId: "paleodem-385-390ma",
      seedId: "scotese-wright-paleodem-v2",
      fraction: 0.4,
      exactEndpoint: false,
      evidence: "interpolation",
      method: "material-registered-relative-elevation-with-discrete-fallback",
      younger: { ageMa: 385 },
      older: { ageMa: 390 },
    });
    expect(snapshot.temporalSurface?.younger.controls.elevation).toHaveLength(360 * 181);
    expect(snapshot.temporalSurface?.older.controls.elevation).toHaveLength(360 * 181);
    expect(snapshot.countries.length).toBeGreaterThan(100);
    expect(snapshot.countries.every((country) => country.evidence === "model-output")).toBe(true);
    expect(snapshot.areaTracking?.ageMa).toBe(385);
    expect(snapshot.areaTracking?.catalog.referenceFrameId).toBe("anchor-plate-0");
    expect(snapshot.controls?.width).toBe(360);
    expect(snapshot.controls?.height).toBe(181);
    expect(snapshot.controls?.elevation).toHaveLength(360 * 181);
    expect(snapshot.caveat).toContain("supported PALEOMAP continental material is interpolated");
  });

  it("loads and aliases one endpoint at an exact native knot", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const snapshot = await getSnapshot(385);
    expect(snapshot.evidence).toBe("model-output");
    expect(snapshot.temporalSurface?.exactEndpoint).toBe(true);
    expect(snapshot.temporalSurface?.fraction).toBe(0);
    expect(snapshot.temporalSurface?.younger.controls)
      .toBe(snapshot.temporalSurface?.older.controls);
  });

  it("cites the qualitative Cao ice-absence constraint only inside its source gap", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const [beforeGap, constrained, afterGap] = await Promise.all([
      getSnapshot(81),
      getSnapshot(100),
      getSnapshot(285.01),
    ]);
    expect(beforeGap.sourceIds).not.toContain("cao-paleogeography-ice-2017");
    expect(constrained.sourceIds).toContain("cao-paleogeography-ice-2017");
    expect(constrained.caveat).toContain("not proof of an ice-free Earth");
    expect(afterGap.sourceIds).not.toContain("cao-paleogeography-ice-2017");
  });

  it("reuses immutable endpoint controls throughout one source interval", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const first = await getSnapshot(386);
    const second = await getSnapshot(389);
    expect(first.temporalSurface?.intervalId).toBe(second.temporalSurface?.intervalId);
    expect(first.temporalSurface?.younger.controls).toBe(second.temporalSurface?.younger.controls);
    expect(first.temporalSurface?.older.controls).toBe(second.temporalSurface?.older.controls);
    expect(Object.isFrozen(first.temporalSurface?.younger.controls)).toBe(true);
  });

  it("loads a same-model temporal tracking layer at the present and preserves stable parts", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const present = await getSnapshot(0);
    const cambrian = await getSnapshot(520);
    expect(present.areaTracking?.ageMa).toBe(0);
    expect(present.areaTracking?.catalog.id).toBe("paleomap-country-tracking-v1");
    expect(present.areaTracking?.catalog).toBe(cambrian.areaTracking?.catalog);
    expect(present.areaTracking?.partIds.length).toBeGreaterThan(cambrian.areaTracking?.partIds.length ?? 0);
    expect([...present.areaTracking!.partIds]).toEqual([...present.areaTracking!.partIds].sort((a, b) => a - b));
    expect(present.areaTracking?.pointOffsets.at(-1)).toBe(present.areaTracking!.coordinates.length / 2);
    expect(present.areaTracking?.byteLength).toBeLessThan(64 * 1024);
    const sharedPartId = [...present.areaTracking!.partIds].find((partId) =>
      cambrian.areaTracking!.partIds.includes(partId)
    );
    expect(sharedPartId).toBeDefined();
    const presentPartIndex = present.areaTracking!.partIds.indexOf(sharedPartId!);
    const cambrianPartIndex = cambrian.areaTracking!.partIds.indexOf(sharedPartId!);
    const presentPointCount = present.areaTracking!.pointOffsets[presentPartIndex + 1] -
      present.areaTracking!.pointOffsets[presentPartIndex];
    const cambrianPointCount = cambrian.areaTracking!.pointOffsets[cambrianPartIndex + 1] -
      cambrian.areaTracking!.pointOffsets[cambrianPartIndex];
    expect(cambrianPointCount).toBe(presentPointCount);
    const unsupportedFeatures = new Set(
      present.areaTracking!.catalog.features
        .map((feature, index) => feature.plateId === null ? index : -1)
        .filter((index) => index >= 0),
    );
    const unsupportedParts = present.areaTracking!.catalog.parts
      .filter((part) => unsupportedFeatures.has(part.feature))
      .map((part) => part.id);
    expect(unsupportedParts.length).toBeGreaterThan(0);
    expect(unsupportedParts.some((partId) => present.areaTracking!.partIds.includes(partId))).toBe(false);
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

  it("uses requested age rather than the nearest authored chapter for POI validity", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const snapshot = await getSnapshot(27.48);
    expect(snapshot.poiIds).toContain("east-african-rift");
    expect(snapshot.poiCoordinates?.["east-african-rift"]).toBeDefined();
    expect(snapshot.poiIds).not.toContain("andes-volcanic-margin");
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
    const bytes = await readFile(resolve(process.cwd(), "public/data/paleodem-0ma.bin"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const asset = decodePaleodemElevation(0, buffer);
    const expected = new Map([
      [-60, -4360], [-62, -4040], [-64, -2320], [-66, -3360], [-68, -2320],
      [-70, -3520], [-72, -2160], [-74, -160], [-76, -400], [-78, -760],
      [-80, -680], [-82, -480], [-84, -360], [-86, 2120], [-88, 920],
    ]);
    expect(asset.width).toBe(360);
    expect(asset.height).toBe(181);
    for (const [latitude, elevation] of expected) {
      const row = 90 - latitude;
      expect(asset.elevation[row * asset.width], `${latitude}° at -180°`).toBe(elevation);
    }
    // The source-authored -90° pole is outside the verified duplicate-zero run.
    expect(asset.elevation[180 * asset.width]).toBe(0);

    const manifest = JSON.parse(
      await readFile(resolve(process.cwd(), "public/data/manifest.json"), "utf8"),
    ) as { inputs: Record<string, { sourceAdapters?: Array<{ ageMa: number; affectedOutputCells: number }> }> };
    expect(manifest.inputs["scotese-wright-paleodem-v2"].sourceAdapters)
      .toContainEqual(expect.objectContaining({ ageMa: 0, affectedOutputCells: 30 }));
  });

  it("rejects a PaleoDEM binary with a mismatched age header or byte length", async () => {
    const bytes = await readFile(resolve(process.cwd(), "public/data/paleodem-385ma.bin"));
    const valid = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    expect(decodePaleodemElevation(385, valid).elevation).toHaveLength(360 * 181);
    const wrongAge = valid.slice(0);
    new DataView(wrongAge).setUint16(6, 390, true);
    expect(() => decodePaleodemElevation(385, wrongAge)).toThrow(/header is invalid/);
    expect(() => decodePaleodemElevation(385, valid.slice(0, -2))).toThrow(/byte length is invalid/);
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
    expect(modernReliefPatches).toHaveLength(9);
    const metadata = modernReliefPatches.find((patch) => patch.id === "himalayas");
    expect(metadata?.bounds).toEqual([72, 22, 100, 38]);
    expect(metadata?.registration).toBe("pixel-center");
    expect(metadata?.rowOrder).toBe("north-to-south");
    const patch = await getModernReliefPatch("himalayas");
    expect(patch.elevation).toHaveLength(256 * 256);
    expect(Math.max(...patch.elevation)).toBeGreaterThan(6000);
    expect(patch.verticalDatum).toBe("EGM2008");
    const northSea = await getModernReliefPatch("north-sea-basin");
    const northSeaParent = await getModernReliefPatch("north-sea-basin-coarse");
    expect(northSea.elevation).toHaveLength(256 * 256);
    expect(northSeaParent.elevation).toHaveLength(64 * 64);
    expect(northSea.parentId).toBe(northSeaParent.id);
    expect(northSeaParent.childIds).toContain(northSea.id);
    expect(Math.min(...northSea.elevation)).toBeLessThan(-100);
    expect(Math.max(...northSea.elevation)).toBeLessThan(0);
    expect(northSea.verticalDatum).toBe("LAT");
    expect(northSea.priority).toBeGreaterThan(patch.priority);
    const alps = await getModernReliefPatch("alps");
    const japan = await getModernReliefPatch("japan-trench");
    expect(alps.validRequestedAgeMa).toEqual([0, 0]);
    expect(japan.validRequestedAgeMa).toEqual([0, 0]);
    expect(surfaceRefinementAppliesToMode(alps, "surface")).toBe(true);
    expect(surfaceRefinementAppliesToMode(alps, "seafloor")).toBe(false);
    expect(surfaceRefinementAppliesToMode(japan, "surface")).toBe(true);
    expect(surfaceRefinementAppliesToMode(japan, "seafloor")).toBe(true);
    for (const surfaceMode of ["surface", "seafloor"] as const) {
      expect(selectSurfaceRefinementMetadata(modernReliefPatches, {
        coordinates: [143, 37], requestedAgeMa: 0, surfaceMode,
        referenceFrameId: "present-day-geographic",
      }).map((tile) => tile.id)).toEqual(["japan-trench"]);
      expect(selectSurfaceRefinementMetadata(modernReliefPatches, {
        coordinates: [143, 37], requestedAgeMa: 1, surfaceMode,
        referenceFrameId: "present-day-geographic",
      })).toEqual([]);
    }
    expect(await getModernReliefPatch("japan-trench")).toBe(japan);
    expect(surfaceRefinementAppliesToMode(northSea, "surface")).toBe(false);
    expect(surfaceRefinementSets.every((set) => set.cacheBudgetBytes === 4 * 1024 * 1024)).toBe(true);
    await expect(getModernReliefPatch("unknown")).rejects.toThrow(RangeError);
  });

  it("rejects invalid ages", async () => {
    await expect(getSnapshot(-1)).rejects.toThrow(RangeError);
    await expect(getSnapshot(Number.NaN)).rejects.toThrow(RangeError);
  });

  it("ships every declared source-age grid and country derivative within the static budget", async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), "public/data/manifest.json"), "utf8")) as {
      inputs: Record<string, {
        sourceAgeCatalog?: {
          minimumAgeMa: number;
          maximumAgeMa: number;
          stepMa: number;
          count: number;
        };
        sourceCsvHeaderForms?: string[];
        sourceGridLayouts?: string[];
        binaryEncoding?: { expectedBytesPerFile: number };
        outputs?: Array<{
          ageMa?: number;
          bytes: number;
          role?: string;
          features?: number;
          parts?: number;
        }>;
      }>;
    };
    const paleodem = manifest.inputs["scotese-wright-paleodem-v2"].outputs ?? [];
    const countries = manifest.inputs["paleomap-country-reference-v3"].outputs ?? [];
    const trackingOutputs = manifest.inputs["paleomap-area-tracking-v1"].outputs ?? [];
    const trackingCatalog = trackingOutputs.find((output) => output.role === "catalog");
    const tracking = trackingOutputs.filter((output) => output.ageMa !== undefined);
    expect(PALEODEM_AGES).toHaveLength(109);
    expect(PALEODEM_AGES).toEqual(Array.from({ length: 109 }, (_, index) => index * 5));
    expect(manifest.inputs["scotese-wright-paleodem-v2"].sourceAgeCatalog).toEqual({
      minimumAgeMa: 0,
      maximumAgeMa: 540,
      stepMa: 5,
      count: 109,
    });
    expect(manifest.inputs["scotese-wright-paleodem-v2"].sourceCsvHeaderForms).toEqual([
      "comment",
      "longitude,latitude,elevation",
    ]);
    expect(manifest.inputs["scotese-wright-paleodem-v2"].sourceGridLayouts).toEqual([
      "360x180 ending at -89 latitude",
      "361x181 with duplicate +180 endpoint",
    ]);
    expect(manifest.inputs["scotese-wright-paleodem-v2"].binaryEncoding)
      .toMatchObject({ expectedBytesPerFile: 130336 });
    expect(paleodem.every((output) => output.bytes === 130336)).toBe(true);
    expect(paleodem).toHaveLength(109);
    expect(countries).toHaveLength(108);
    expect(tracking).toHaveLength(109);
    expect(paleodem.map((output) => output.ageMa)).toEqual(PALEODEM_AGES);
    expect(tracking.map((output) => output.ageMa)).toEqual(PALEODEM_AGES);
    expect(trackingCatalog).toMatchObject({ features: 437, parts: 999 });
    expect(
      paleodem.reduce((sum, output) => sum + output.bytes, 0) +
      countries.reduce((sum, output) => sum + output.bytes, 0) +
      tracking.reduce((sum, output) => sum + output.bytes, 0) +
      (trackingCatalog?.bytes ?? 0),
    ).toBeLessThan(32 * 1024 * 1024);
  });
});
