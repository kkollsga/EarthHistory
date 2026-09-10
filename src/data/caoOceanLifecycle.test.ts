import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeCaoOceanLifecycleBinary,
  decodeCaoOceanLifecycleCatalog,
  createCaoOceanLifecycleSampler,
  loadCaoOceanLifecycleData,
  sampleCaoOceanLifecycle,
} from "./caoOceanLifecycle";
import type { UnitDirection } from "./paleomapMotion";

const metadataBytes = readFileSync("public/data/cao-ocean-lifecycle-v1.json");
const binaryBytes = readFileSync("public/data/cao-ocean-lifecycle-v1.bin");
const catalog = decodeCaoOceanLifecycleCatalog(JSON.parse(metadataBytes.toString("utf8")));
const data = decodeCaoOceanLifecycleBinary(catalog, binaryBytes.buffer.slice(
  binaryBytes.byteOffset, binaryBytes.byteOffset + binaryBytes.byteLength,
) as ArrayBuffer);
const motionCatalog = JSON.parse(readFileSync("public/data/cao-ocean-motion-v1.json", "utf8")) as {
  model: { id: string; version: string; referenceFrame: string; anchorPlateId: number };
  ages: Array<{ ageMa: number; topologySlotIdentitySha256: string }>;
};

function direction(longitude: number, latitude: number): UnitDirection {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosLatitude = Math.cos(lat);
  return [cosLatitude * Math.cos(lon), cosLatitude * Math.sin(lon), Math.sin(lat)];
}

describe("Cao model-derived ocean lifecycle controls", () => {
  it("decodes the bounded source-qualified asset", () => {
    expect(createHash("sha256").update(metadataBytes).digest("hex")).toBe("2ff4d594610a0a698ceda295e46d127bcdd89f898b94e333be31fc51c7c1f1bc");
    expect(createHash("sha256").update(binaryBytes).digest("hex")).toBe("22008f37a23c9308ebadaf5919378c76a14057289ef121b9a5ca4435835d1c05");
    expect(binaryBytes).toHaveLength(5_356_284);
    expect(catalog.time).toMatchObject({ stepMa: 5, traceRangeMa: [0, 1000], boundUncertaintyMa: 5 });
    expect(catalog.coverage).toMatchObject({ oceanSamples: 1_110_007, ridgeConfirmedBirth: 768_984, subductionConfirmedLoss: 546_549 });
  });

  it("retains a ridge-confirmed young Mid-Atlantic pair and an older-than-540 Ma control", () => {
    expect(sampleCaoOceanLifecycle(data, 0, direction(-14, -34), 40)?.birth).toEqual({
      status: "confirmed", boundaryType: "MidOceanRidge", intervalMa: [5, 10],
    });
    const nearby = sampleCaoOceanLifecycle(data, 0, direction(-10, -34), 40);
    expect(nearby?.birth).toEqual({ status: "confirmed", boundaryType: "MidOceanRidge", intervalMa: [25, 30] });
    expect(sampleCaoOceanLifecycle(data, 0, direction(-14, -34), 39)).toBeNull();
    const ancient = sampleCaoOceanLifecycle(data, 540, direction(0, 0), 5);
    expect(ancient?.birth).toEqual({ status: "confirmed", boundaryType: "MidOceanRidge", intervalMa: [580, 585] });
  });

  it("rejects wrong frames, malformed ages, and reserved trace codes", () => {
    expect(() => decodeCaoOceanLifecycleCatalog({ ...catalog, model: { ...catalog.model, referenceFrame: "mantle" } })).toThrow(/unsupported/);
    expect(() => decodeCaoOceanLifecycleCatalog({
      ...catalog,
      time: { ...catalog.time, displayAgesMa: catalog.time.displayAgesMa.map((age, index) => index === 2 ? 11 : age) },
    })).toThrow(/unsupported/);
    const invalid = Uint8Array.from(binaryBytes);
    new Uint8Array(invalid.buffer)[24] = 201;
    expect(() => decodeCaoOceanLifecycleBinary(catalog, invalid.buffer)).toThrow(/invalid Cao ocean lifecycle value/);
  });

  it("binds numeric lifecycle slots to the exact motion topology ordering", () => {
    const sampler = createCaoOceanLifecycleSampler(data, motionCatalog);
    expect(sampler(0, direction(-14, -34), 40)?.birth.status).toBe("confirmed");
    const reordered = {
      ...motionCatalog,
      ages: motionCatalog.ages.map((age, index) => index === 0
        ? { ...age, topologySlotIdentitySha256: motionCatalog.ages[1]!.topologySlotIdentitySha256 }
        : age),
    };
    expect(() => createCaoOceanLifecycleSampler(data, reordered)).toThrow(/slot identities do not match/);
  });

  it("loads its sibling binary under an application subpath", async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      return url.endsWith(".json") ? new Response(metadataBytes) : new Response(binaryBytes);
    }) as typeof fetch;
    try {
      await loadCaoOceanLifecycleData("https://example.test/EarthHistory/data/cao-ocean-lifecycle-v1.json");
      expect(requests[1]).toBe("https://example.test/EarthHistory/data/cao-ocean-lifecycle-v1.bin");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
