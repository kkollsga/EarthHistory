import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createCaoContinentalMaterialModel,
  decodeCaoContinentalBinary,
  decodeCaoContinentalCatalog,
  loadCaoContinentalData,
} from "./caoContinental";
import { createCaoOceanMotionModel, decodeCaoOceanBinary, decodeCaoOceanCatalog } from "./caoOcean";
import type { UnitDirection } from "./paleomapMotion";

const metadataBytes = readFileSync("public/data/cao-continental-motion-v1.json");
const binaryBytes = readFileSync("public/data/cao-continental-motion-v1.bin");
const catalog = decodeCaoContinentalCatalog(JSON.parse(metadataBytes.toString("utf8")));
const binary = binaryBytes.buffer.slice(binaryBytes.byteOffset, binaryBytes.byteOffset + binaryBytes.byteLength) as ArrayBuffer;
const data = decodeCaoContinentalBinary(catalog, binary);
const oceanMetadata = decodeCaoOceanCatalog(JSON.parse(readFileSync("public/data/cao-ocean-motion-v1.json", "utf8")));
const oceanBytes = readFileSync("public/data/cao-ocean-motion-v1.bin");
const oceanData = decodeCaoOceanBinary(oceanMetadata, oceanBytes.buffer.slice(
  oceanBytes.byteOffset, oceanBytes.byteOffset + oceanBytes.byteLength,
) as ArrayBuffer);
const model = createCaoContinentalMaterialModel(data, createCaoOceanMotionModel(oceanData).evaluateRotation);
const fullModel = createCaoContinentalMaterialModel(
  data,
  createCaoOceanMotionModel(oceanData).evaluateRotation,
  { useSpatialIndex: false },
);
const oracle = JSON.parse(readFileSync("src/data/fixtures/cao-continental-probes-v1.json", "utf8")) as {
  metadataSha256: string;
  binarySha256: string;
  probes: Array<{
    ageMa: number;
    longitude: number;
    latitude: number;
    minimumBoundaryDistanceRadians: number;
    owner: { sourceFeatureId: string; plateId: number } | null;
  }>;
};

function direction(longitude: number, latitude: number): UnitDirection {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLatitude = Math.cos(lat);
  return [cosLatitude * Math.cos(lon), cosLatitude * Math.sin(lon), Math.sin(lat)];
}

describe("Cao static continental material partition", () => {
  it("decodes the bounded source-native child-fragment asset", () => {
    expect(createHash("sha256").update(metadataBytes).digest("hex")).toBe(oracle.metadataSha256);
    expect(createHash("sha256").update(binaryBytes).digest("hex")).toBe(oracle.binarySha256);
    expect(metadataBytes).toHaveLength(320_201);
    expect(binaryBytes).toHaveLength(299_600);
    expect(catalog.fragments).toHaveLength(869);
    expect(catalog.skippedGeometrylessFeatureIds).toHaveLength(3);
  });

  it("matches independent pyGPlates area-priority material ownership", () => {
    for (const probe of oracle.probes) {
      const actual = model.resolveAt(probe.ageMa, direction(probe.longitude, probe.latitude));
      const matches = actual?.sourceFeatureId === probe.owner?.sourceFeatureId && actual?.plateId === probe.owner?.plateId;
      if (!matches) {
        expect(
          probe.minimumBoundaryDistanceRadians,
          `${probe.longitude},${probe.latitude}@${probe.ageMa}: ${probe.owner?.plateId ?? "none"} -> ${actual?.plateId ?? "none"}`,
        ).toBeLessThan(2e-4);
      }
    }
  });

  it("keeps India child plate 501 distinct from its 250 Ma Gondwana topology container", () => {
    const india = oracle.probes.find(({ ageMa, owner }) => ageMa === 250 && owner?.plateId === 501)!;
    const resolved = model.resolveAt(250, direction(india.longitude, india.latitude));
    const topology = createCaoOceanMotionModel(oceanData).ownershipAt(50, direction(india.longitude, india.latitude));
    expect(resolved).toMatchObject({ plateId: 501, sourceFeatureId: "GPlates-8d426194-166a-484f-ad68-2b3a9ccdce3c" });
    expect(topology.status).toBe("resolved");
    if (topology.status === "resolved") expect(topology.topology.plateId).toBe(701);
  });

  it("keeps conservative cell candidates exactly equivalent to the full ordered partition", () => {
    const ages = [0, 100, 102.5, 250, 400, 540];
    const coordinates = [
      ...Array.from({ length: 18 }, (_, row) => -85 + row * 10).flatMap((latitude) =>
        Array.from({ length: 36 }, (_, column) => [-175 + column * 10, latitude] as const)
      ),
      [-180, 0] as const,
      [180, 0] as const,
      [0, 90] as const,
      [0, -90] as const,
      ...oracle.probes.map(({ longitude, latitude }) => [longitude, latitude] as const),
    ];
    for (const ageMa of ages) {
      for (const [longitude, latitude] of coordinates) {
        const query = direction(longitude, latitude);
        const indexed = model.resolveAt(ageMa, query);
        const full = fullModel.resolveAt(ageMa, query);
        expect(
          indexed === null ? null : [indexed.fragmentId, indexed.sourceFeatureId, indexed.plateId],
          `${longitude},${latitude}@${ageMa}`,
        ).toEqual(full === null ? null : [full.fragmentId, full.sourceFeatureId, full.plateId]);
      }
    }
    expect(model.cachedSpatialIndexBytes).toBeLessThanOrEqual(
      model.ageCacheLimit * model.spatialIndexByteLimitPerAge,
    );
    expect(model.cachedSpatialIndexCellCount).toBeGreaterThan(0);
  });

  it("falls back to the full exact order when a pose index has no byte allowance", () => {
    const fallback = createCaoContinentalMaterialModel(
      data,
      createCaoOceanMotionModel(oceanData).evaluateRotation,
      { spatialIndexByteLimitPerAge: 0 },
    );
    for (const [longitude, latitude] of [[-75, 40], [80, 20], [179, -10], [0, 89]] as const) {
      const query = direction(longitude, latitude);
      const actual = fallback.resolveAt(250, query);
      const full = fullModel.resolveAt(250, query);
      expect(actual === null ? null : actual.fragmentId).toBe(full === null ? null : full.fragmentId);
    }
    expect(fallback.cachedSpatialIndexBytes).toBe(0);
    expect(fallback.cachedSpatialIndexFallbackCellCount).toBeGreaterThan(0);
  });

  it("bounds age candidate caches and loads the sibling binary under a subpath", async () => {
    for (const ageMa of [0, 100, 250, 400]) model.resolveAt(ageMa, direction(0, 0));
    expect(model.cachedAgeCount).toBe(model.ageCacheLimit);
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      return url.endsWith(".json") ? new Response(metadataBytes) : new Response(binaryBytes);
    }) as typeof fetch;
    try {
      await loadCaoContinentalData("https://example.test/EarthHistory/data/cao-continental-motion-v1.json");
      expect(requests[1]).toBe("https://example.test/EarthHistory/data/cao-continental-motion-v1.bin");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
