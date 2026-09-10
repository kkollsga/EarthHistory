import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCaoOceanMotionModel,
  decodeCaoOceanBinary,
  decodeCaoOceanCatalog,
  loadCaoOceanMotionData,
  type CaoOceanMotionData,
} from "./caoOcean";
import { resolvePlateDirectionBetweenAges, type QuaternionWxyz, type UnitDirection } from "./paleomapMotion";

const metadataBytes = readFileSync(resolve("public/data/cao-ocean-motion-v1.json"));
const binaryBytes = readFileSync(resolve("public/data/cao-ocean-motion-v1.bin"));
const catalog = decodeCaoOceanCatalog(JSON.parse(metadataBytes.toString("utf8")));
const binaryBuffer = binaryBytes.buffer.slice(
  binaryBytes.byteOffset,
  binaryBytes.byteOffset + binaryBytes.byteLength,
) as ArrayBuffer;
const data = decodeCaoOceanBinary(catalog, binaryBuffer);
const oracle = JSON.parse(readFileSync(resolve("src/data/fixtures/cao-ocean-probes-v1.json"), "utf8")) as {
  metadataSha256: string;
  binarySha256: string;
  rotationProbes: Array<{ plateId: number; ageMa: number; quaternionWxyz: QuaternionWxyz }>;
  spatialProbes: Array<{
    ageMa: number;
    longitude: number;
    latitude: number;
    hits: Array<{ sourceFeatureId: string; plateId: number }>;
    minimumBoundaryDistanceRadians: number;
    continental: boolean;
  }>;
};

function direction(longitude: number, latitude: number): UnitDirection {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

function equivalentQuaternion(left: QuaternionWxyz, right: QuaternionWxyz): boolean {
  return Math.abs(left.reduce((sum, value, index) => sum + value * right[index]!, 0)) > 1 - 1e-10;
}

function syntheticBroadCapRingData(): CaoOceanMotionData {
  const width = 180;
  const height = 91;
  const ageCount = 109;
  const topologyRowOffsets = new Uint32Array(ageCount * height + 1);
  const topologyRuns = new Uint8Array(ageCount * height * 2);
  for (let row = 0; row < ageCount * height; row += 1) {
    topologyRowOffsets[row] = row * 2;
    topologyRuns[row * 2] = 0;
    topologyRuns[row * 2 + 1] = width;
  }
  topologyRowOffsets[ageCount * height] = topologyRuns.length;
  const ages = Array.from({ length: ageCount }, (_, ageIndex) => ({
    ageMa: ageIndex * 5,
    topologySlotIdentitySha256: "synthetic",
    topologySlots: ageIndex === 0 ? [{
      sourceFeatureId: "synthetic-small-ring",
      plateId: 0,
      coordinateOffset: 0,
      coordinateCount: 4,
      // Deliberately broad: this exercises containment without a rejecting cap.
      boundingCap: { centreXyz: direction(0, 0), radiusRadians: Math.PI },
      interiorPointXyz: direction(0, 0),
    }] : [],
    segmentOffset: 0,
    segmentCount: 0,
    coverage: {},
  }));
  return {
    catalog: {
      schemaVersion: 1,
      id: "cao-ocean-motion-v1",
      model: {
        id: "synthetic",
        version: "test",
        sourceRecord: "test",
        sourceArchiveSha256: "test",
        license: "test",
        referenceFrame: "palaeomagnetic",
        anchorPlateId: 0,
      },
      binary: {
        path: "test.bin",
        bytes: 0,
        sha256: "test",
        header: "test",
        topologyGrid: "test",
        continentMask: "test",
        coordinates: "test",
      },
      grid: { width, height, longitudes: "2 degree centres", latitudes: "2 degree centres", scaleDegrees: 0.01 },
      timeContract: {},
      coverage: {},
      features: [],
      segments: [],
      boundaryLinks: [],
      ages,
      rotationSequences: [],
      rotationSequenceOrdering: "test",
      epistemicStatus: "synthetic test",
    },
    topologyRowOffsets,
    topologyRuns,
    continentMask: new Uint8Array(Math.ceil(width * height * ageCount / 8)),
    coordinates: new Int16Array([
      -1_000, -1_000,
      1_000, -1_000,
      1_000, 1_000,
      -1_000, 1_000,
    ]),
  };
}

describe("Cao target-native ocean motion", () => {
  it("decodes the bounded provenance-bearing artifacts", () => {
    expect(createHash("sha256").update(metadataBytes).digest("hex")).toBe(oracle.metadataSha256);
    expect(createHash("sha256").update(binaryBytes).digest("hex")).toBe(oracle.binarySha256);
    expect(binaryBytes).toHaveLength(3_146_951);
    expect(metadataBytes).toHaveLength(2_462_978);
    expect(catalog.ages).toHaveLength(109);
    expect(catalog.model).toMatchObject({ version: "2.4", referenceFrame: "palaeomagnetic", anchorPlateId: 0 });
    expect(catalog.features).toHaveLength(2_166);
    expect(catalog.segments).toHaveLength(12_532);
    expect(catalog.boundaryLinks).toHaveLength(7_027);
    expect(catalog.segments[0]).toMatchObject({
      ageIndex: 0,
      sourceFeatureIndex: 0,
      coordinateCount: 3,
      leftPlateIds: [925],
      rightPlateIds: [],
    });
    expect(catalog.rotationSequences).toHaveLength(1_609);
  });

  it("matches independent pyGPlates rotation and spherical ownership probes", () => {
    const model = createCaoOceanMotionModel(data);
    for (const probe of oracle.rotationProbes) {
      const actual = model.evaluateRotation(probe.plateId, probe.ageMa);
      expect(actual, `plate ${probe.plateId} at ${probe.ageMa} Ma`).not.toBeNull();
      expect(equivalentQuaternion(actual!, probe.quaternionWxyz), `plate ${probe.plateId} at ${probe.ageMa} Ma`).toBe(true);
    }
    for (const probe of oracle.spatialProbes) {
      const ageIndex = probe.ageMa / 5;
      const actual = model.ownershipAt(ageIndex, direction(probe.longitude, probe.latitude));
      const expectedStatus = probe.hits.length === 0 ? "unknown" : probe.hits.length === 1 ? "resolved" : "ambiguous";
      if (actual.status !== expectedStatus) {
        expect(probe.minimumBoundaryDistanceRadians, `${probe.longitude},${probe.latitude}@${probe.ageMa}: ${expectedStatus} -> ${actual.status}`).toBeLessThan(1e-4);
        continue;
      }
      if (probe.hits.length === 0) expect(actual.status, `${probe.longitude},${probe.latitude}@${probe.ageMa}`).toBe("unknown");
      else if (probe.hits.length === 1) {
        expect(actual.status, `${probe.longitude},${probe.latitude}@${probe.ageMa}`).toBe("resolved");
        if (actual.status === "resolved") {
          expect(actual.topology.sourceFeatureId).toBe(probe.hits[0]!.sourceFeatureId);
          expect(actual.topology.plateId).toBe(probe.hits[0]!.plateId);
          expect(actual.slotIndex).toBe(catalog.ages[ageIndex]!.topologySlots.findIndex(({ sourceFeatureId }) => sourceFeatureId === probe.hits[0]!.sourceFeatureId));
        }
      } else {
        expect(actual.status, `${probe.longitude},${probe.latitude}@${probe.ageMa}`).toBe("ambiguous");
        if (actual.status === "ambiguous") {
          expect(new Set(actual.topologyIds)).toEqual(new Set(probe.hits.map(({ sourceFeatureId }) => sourceFeatureId)));
        }
      }
    }
  });

  it("does not treat the antipode of a ring vertex as a boundary hit", () => {
    const model = createCaoOceanMotionModel(syntheticBroadCapRingData());
    expect(model.ownershipAtExact(0, direction(-10, -10)).status).toBe("resolved");
    expect(model.ownershipAtExact(0, direction(170, 10)).status).toBe("unknown");
  });

  it("bounds decoded age rings and RLE grids while preserving exact endpoint geometry", () => {
    const model = createCaoOceanMotionModel(data);
    for (let ageIndex = 0; ageIndex < 8; ageIndex += 1) {
      model.ownershipAt(ageIndex, direction(0, 0));
      model.candidateSlotAt(ageIndex, direction(0, 0));
    }
    expect(model.cachedAgeStateCount).toBe(model.ageStateCacheLimit);
    expect(model.cachedAgeGridCount).toBe(model.ageStateCacheLimit);
    expect(model.ageStateCacheLimit).toBe(3);

    const probe = oracle.spatialProbes.find(({ hits, ageMa }) => hits.length === 1 && ageMa === 100)!;
    const sourceDirection = direction(probe.longitude, probe.latitude);
    const resolved = model.createIntervalResolver(100, 100, 100).resolveAt(sourceDirection);
    expect(resolved).not.toBeNull();
    expect(resolved?.youngerDirection).toEqual(sourceDirection);
    expect(resolved?.olderDirection).toEqual(sourceDirection);
    expect(resolved?.materialId).toContain(resolved?.youngerTopologyId);
  });

  it("certifies only cells whose compact ownership agrees with exact packed rings", () => {
    const model = createCaoOceanMotionModel(data);
    let state = 0x6d2b79f5;
    const random = () => {
      state = Math.imul(state ^ state >>> 15, 1 | state);
      state ^= state + Math.imul(state ^ state >>> 7, 61 | state);
      return ((state ^ state >>> 14) >>> 0) / 4_294_967_296;
    };
    let safe = 0;
    let unsafe = 0;
    for (const ageMa of [0, 5, 100, 105, 245, 250, 255, 400, 540]) {
      const ageIndex = ageMa / 5;
      for (let sample = 0; sample < 512; sample += 1) {
        const probe = direction(-180 + random() * 360, -90 + random() * 180);
        const accelerated = model.ownershipAt(ageIndex, probe);
        const exact = model.ownershipAtExact(ageIndex, probe);
        expect(accelerated.status, `${ageMa} Ma sample ${sample}`).toBe(exact.status);
        if (accelerated.status === "resolved" && exact.status === "resolved") {
          expect(accelerated.topology.sourceFeatureId).toBe(exact.topology.sourceFeatureId);
        } else if (accelerated.status === "ambiguous" && exact.status === "ambiguous") {
          expect(new Set(accelerated.topologyIds)).toEqual(new Set(exact.topologyIds));
        }
        if (model.isOwnershipCellUnsafeAt(ageIndex, probe)) unsafe += 1;
        else safe += 1;
      }
    }
    expect(safe).toBeGreaterThan(unsafe);
    expect(unsafe).toBeGreaterThan(0);
  });

  it("rejects material when only one endpoint has globally ambiguous ownership", () => {
    const model = createCaoOceanMotionModel(data);
    const youngerAgeMa = 100;
    const olderAgeMa = 105;
    const requestedAgeMa = 102.5;
    const youngerRecord = catalog.ages[youngerAgeMa / 5]!;
    let found = false;
    for (let latitude = -90; latitude <= 90 && !found; latitude += 2) {
      for (let longitude = -180; longitude < 180 && !found; longitude += 2) {
        const atYounger = direction(longitude, latitude);
        const youngerOwnership = model.ownershipAtExact(youngerAgeMa / 5, atYounger);
        if (youngerOwnership.status !== "ambiguous") continue;
        const plateIds = new Set(youngerOwnership.topologyIds.flatMap((sourceFeatureId) =>
          youngerRecord.topologySlots
            .filter((topology) => topology.sourceFeatureId === sourceFeatureId)
            .map((topology) => topology.plateId),
        ));
        for (const plateId of plateIds) {
          const atRequested = resolvePlateDirectionBetweenAges(
            model.evaluateRotation, plateId, atYounger, youngerAgeMa, requestedAgeMa,
          );
          const atOlder = atRequested && resolvePlateDirectionBetweenAges(
            model.evaluateRotation, plateId, atRequested, requestedAgeMa, olderAgeMa,
          );
          if (!atRequested || !atOlder) continue;
          const olderOwnership = model.ownershipAtExact(olderAgeMa / 5, atOlder);
          if (olderOwnership.status !== "resolved" || olderOwnership.topology.plateId !== plateId) continue;
          expect(model.createIntervalResolver(requestedAgeMa, youngerAgeMa, olderAgeMa).resolveAt(atRequested)).toBeNull();
          found = true;
          break;
        }
      }
    }
    expect(found).toBe(true);
  });

  it("resolves metadata-relative binary URLs under an application subpath", async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      return url.endsWith(".json")
        ? new Response(metadataBytes, { status: 200 })
        : new Response(binaryBytes, { status: 200 });
    }) as typeof fetch;
    try {
      await loadCaoOceanMotionData("https://example.test/EarthHistory/data/cao-ocean-motion-v1.json");
      expect(requests).toEqual([
        "https://example.test/EarthHistory/data/cao-ocean-motion-v1.json",
        "https://example.test/EarthHistory/data/cao-ocean-motion-v1.bin",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
