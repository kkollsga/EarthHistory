import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createCaoOceanMotionModel, decodeCaoOceanBinary, decodeCaoOceanCatalog } from "./caoOcean";
import { createCaoContinentalMaterialModel, decodeCaoContinentalBinary, decodeCaoContinentalCatalog } from "./caoContinental";
import { createCaoPaleomapCrosswalk } from "./caoPaleomapCrosswalk";
import { decodePaleomapMotionCatalog } from "./paleomapMotion";
import { lonLatToPeriodDirection, paleomapCoordinateFrame } from "./temporal";

const paleomap = decodePaleomapMotionCatalog(JSON.parse(
  readFileSync("public/data/paleomap-motion-v1.json", "utf8"),
));
const caoCatalog = decodeCaoOceanCatalog(JSON.parse(
  readFileSync("public/data/cao-ocean-motion-v1.json", "utf8"),
));
const binary = readFileSync("public/data/cao-ocean-motion-v1.bin");
const caoData = decodeCaoOceanBinary(caoCatalog, binary.buffer.slice(
  binary.byteOffset, binary.byteOffset + binary.byteLength,
) as ArrayBuffer);
const continentalCatalog = decodeCaoContinentalCatalog(JSON.parse(
  readFileSync("public/data/cao-continental-motion-v1.json", "utf8"),
));
const continentalBytes = readFileSync("public/data/cao-continental-motion-v1.bin");
const continentalData = decodeCaoContinentalBinary(continentalCatalog, continentalBytes.buffer.slice(
  continentalBytes.byteOffset, continentalBytes.byteOffset + continentalBytes.byteLength,
) as ArrayBuffer);
const crosswalk = createCaoPaleomapCrosswalk(paleomap, caoData, continentalData);

describe("PALEOMAP to Cao source-qualified crosswalk", () => {
  it("rejects a source point carrying only a similar model name but a different version", () => {
    const result = crosswalk.resolveSourcePoint({
      frame: { ...paleomapCoordinateFrame(paleomap), modelVersion: "different" },
      plateId: 205,
      sourceAgeMa: 100,
      coordinates: [-90, 20],
    }, 100);
    expect(result).toMatchObject({ status: "unsupported", reason: "source-frame-mismatch" });
  });

  it("converts a continental point through present material and round-trips to its PALEOMAP source age", () => {
    const countrySource = JSON.parse(readFileSync("public/data/countries-100ma.json", "utf8")) as {
      poiCoordinates: Record<string, [number, number]>;
    };
    const sourceCoordinates = countrySource.poiCoordinates.chicxulub!;
    const forward = crosswalk.resolveSourcePoint({
      frame: paleomapCoordinateFrame(paleomap),
      plateId: paleomap.poiPlateIds.chicxulub!,
      sourceAgeMa: 100,
      coordinates: sourceCoordinates,
    }, 100);
    expect(forward.status).toBe("resolved");
    if (forward.status !== "resolved") return;
    expect(forward.evidence).toBe("model-conversion-inference");
    expect(forward.targetMaterial.frame.modelId).toBe("cao-et-al-2024");
    expect(forward.targetMaterial.kind).toBe("continental-crust");
    expect(Math.hypot(
      forward.targetCoordinates[0] - sourceCoordinates[0],
      forward.targetCoordinates[1] - sourceCoordinates[1],
    )).toBeGreaterThan(0.1);

    const reverse = crosswalk.resolveTargetPoint(forward.targetCoordinates, 100, 100);
    expect(reverse.status).toBe("resolved");
    if (reverse.status !== "resolved") return;
    expect(reverse.sourcePlateId).toBe(paleomap.poiPlateIds.chicxulub);
    expect(reverse.sourceCoordinates[0]).toBeCloseTo(sourceCoordinates[0], 5);
    expect(reverse.sourceCoordinates[1]).toBeCloseTo(sourceCoordinates[1], 5);
  });

  it("does not copy target-native ocean coordinates into the continental PALEOMAP relief", () => {
    const targetResolver = createCaoOceanMotionModel(caoData).createIntervalResolver(100, 100, 100);
    let oceanCoordinates: [number, number] | undefined;
    for (let latitude = -60; latitude <= 60 && !oceanCoordinates; latitude += 15) {
      for (let longitude = -180; longitude < 180; longitude += 15) {
        if (targetResolver.resolveAt(lonLatToPeriodDirection([longitude, latitude]))?.kind === "oceanic-crust") {
          oceanCoordinates = [longitude, latitude];
          break;
        }
      }
    }
    expect(oceanCoordinates).toBeDefined();
    expect(crosswalk.resolveTargetPoint(oceanCoordinates!, 100, 100)).toMatchObject({
      status: "unsupported",
      reason: "target-continental-material-unsupported",
    });
  });

  it("bounds source and target resolver caches across rapid age changes", () => {
    for (const ageMa of [102.5, 107.5, 112.5, 117.5, 122.5]) {
      crosswalk.resolveTargetPoint([0, 0], ageMa, Math.floor(ageMa / 5) * 5);
    }
    expect(crosswalk.cachedTargetAgeCount).toBe(crosswalk.ageCacheLimit);
    expect(crosswalk.cachedSourceEndpointCount).toBeLessThanOrEqual(crosswalk.ageCacheLimit);
    expect(crosswalk.ageCacheLimit).toBe(4);
  });

  it("uses a static child plate rather than its ancient composite topology as continental identity", () => {
    const oracle = JSON.parse(readFileSync("src/data/fixtures/cao-continental-probes-v1.json", "utf8")) as {
      probes: Array<{ ageMa: number; longitude: number; latitude: number; owner: { plateId: number } | null }>;
    };
    const india = oracle.probes.find(({ ageMa, owner }) => ageMa === 250 && owner?.plateId === 501)!;
    const result = crosswalk.resolveTargetPoint([india.longitude, india.latitude], 250, 250);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.targetMaterial.plateId).toBe(501);
  });

  it("reuses an authoritative target material without changing crosswalk support", () => {
    const oceanModel = createCaoOceanMotionModel(caoData);
    const continentalModel = createCaoContinentalMaterialModel(continentalData, oceanModel.evaluateRotation);
    const bound = createCaoPaleomapCrosswalk(
      paleomap, caoData, continentalData, oceanModel, continentalModel,
    );
    for (const ageMa of [100, 102.5]) {
      for (const coordinates of [[-120, -45], [-60, 0], [0, 45], [60, 15], [120, 45]] as const) {
        const mutableCoordinates: [number, number] = [coordinates[0], coordinates[1]];
        const material = continentalModel.resolveAt(ageMa, lonLatToPeriodDirection(mutableCoordinates));
        const ordinary = bound.resolveTargetPoint(mutableCoordinates, ageMa, 100);
        if (material === null) {
          expect(ordinary.status).toBe("unsupported");
          continue;
        }
        const optimized = bound.resolveTargetMaterialPoint(material, ageMa, 100);
        expect(optimized.status).toBe(ordinary.status);
        if (optimized.status === "unsupported") {
          expect(ordinary.status).toBe("unsupported");
          if (ordinary.status === "unsupported") expect(optimized.reason).toBe(ordinary.reason);
          continue;
        }
        expect(ordinary.status).toBe("resolved");
        if (ordinary.status !== "resolved") continue;
        expect(optimized.targetMaterial).toEqual(ordinary.targetMaterial);
        expect(optimized.sourcePlateId).toBe(ordinary.sourcePlateId);
        expect(optimized.sourceCoordinates[0]).toBeCloseTo(ordinary.sourceCoordinates[0], 10);
        expect(optimized.sourceCoordinates[1]).toBeCloseTo(ordinary.sourceCoordinates[1], 10);
        expect(optimized.targetCoordinates[0]).toBeCloseTo(ordinary.targetCoordinates[0], 10);
        expect(optimized.targetCoordinates[1]).toBeCloseTo(ordinary.targetCoordinates[1], 10);
      }
    }
  });
});
