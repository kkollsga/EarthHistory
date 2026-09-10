/// <reference types="node" />

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodePaleomapMotionCatalog, type PaleomapMotionCatalog } from "./paleomapMotion";
import { getSnapshot } from "./snapshots";
import { createCaoTemporalCountryResolver, createTemporalCountryResolver } from "./temporalReferences";
import type { CaoPaleomapCrosswalk } from "./caoPaleomapCrosswalk";
import type { PeriodPointReference } from "./temporal";
import type {
  AreaTrackingCatalog,
  AreaTrackingLayer,
  LonLat,
  TemporalReferenceEndpoint,
  TemporalReferences,
} from "./types";

const SCALE = 180 / 32767;

const trackingCatalog: AreaTrackingCatalog = {
  schemaVersion: 1,
  id: "country-parts-test",
  plateModelId: "motion-model-test",
  referenceFrameId: "anchor-plate-0",
  coordinateEncoding: "int16-le-longitude-latitude",
  coordinateScaleDegrees: SCALE,
  measure: "normalized-geodesic-arclength",
  sourceSimplificationToleranceDegrees: 0.18,
  sourceIds: ["country-source-test", "motion-source-test"],
  features: [
    { id: "moving", countryId: "moving-country", name: "Moving", plateId: 7, validTimeMa: [540, 0] },
    { id: "short-lived", countryId: "short-country", name: "Short", plateId: 8, validTimeMa: [10, 0] },
  ],
  parts: [
    { id: 0, feature: 0, geometryIndex: 0 },
    { id: 1, feature: 1, geometryIndex: 0 },
  ],
};

const motionCatalog = {
  model: { id: "motion-model-test", anchorPlateId: 0 },
} as PaleomapMotionCatalog;

afterEach(() => vi.unstubAllGlobals());

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
        return new Response(body, { status: 200 });
      }
      return new Response(await readFile(resolve(process.cwd(), "public", assetPath), "utf8"), { status: 200 });
    } catch {
      return new Response("missing", { status: 404 });
    }
  });
}

function encoded([longitude, latitude]: LonLat): [number, number] {
  return [Math.round(longitude / SCALE), Math.round(latitude / SCALE)];
}

function layer(ageMa: number, parts: Array<{ id: number; coordinates: LonLat[] }>): AreaTrackingLayer {
  const coordinates: number[] = [];
  const pointOffsets = [0];
  for (const part of parts) {
    for (const coordinate of part.coordinates) coordinates.push(...encoded(coordinate));
    pointOffsets.push(coordinates.length / 2);
  }
  return {
    ageMa,
    catalog: trackingCatalog,
    partIds: Uint16Array.from(parts.map((part) => part.id)),
    pointOffsets: Uint32Array.from(pointOffsets),
    coordinates: Int16Array.from(coordinates),
    byteLength: coordinates.length * Int16Array.BYTES_PER_ELEMENT,
  };
}

function endpoint(ageMa: number, areaTracking: AreaTrackingLayer): TemporalReferenceEndpoint {
  return { ageMa, areaTracking, land: [], countries: [], poiCoordinates: {} };
}

function references(younger: AreaTrackingLayer, older = younger): TemporalReferences {
  return { younger: endpoint(younger.ageMa, younger), older: endpoint(older.ageMa, older) };
}

const moveLongitude = (
  reference: PeriodPointReference,
  requestedAgeMa: number,
): LonLat => [
  reference.coordinates[0] + requestedAgeMa - reference.sourceAgeMa,
  reference.coordinates[1],
];

describe("temporal country references", () => {
  it("reproduces an exact native endpoint without invoking motion", () => {
    const native = layer(10, [{ id: 0, coordinates: [[1, 2], [3, 4]] }]);
    let motionCalls = 0;
    const result = createTemporalCountryResolver(references(native), motionCatalog, () => {
      motionCalls += 1;
      return undefined;
    }).resolve(10);

    expect(motionCalls).toBe(0);
    expect(result.evidence).toBe("model-output");
    expect(result.resolvedPartCount).toBe(1);
    expect(result.unsupportedPartCount).toBe(0);
    expect(result.countries[0]?.lines[0]?.[0]).toEqual([
      native.coordinates[0]! * SCALE,
      native.coordinates[1]! * SCALE,
    ]);
  });

  it("moves every point through the shared plate resolver", () => {
    const younger = layer(10, [{ id: 0, coordinates: [[0, 0], [2, 0]] }]);
    const older = layer(15, [{ id: 0, coordinates: [[50, 0], [52, 0]] }]);
    const result = createTemporalCountryResolver(
      references(younger, older),
      motionCatalog,
      moveLongitude,
    ).resolve(12.5);

    expect(result.evidence).toBe("interpolation");
    expect(result.sourceAgesMa).toEqual([10, 15]);
    expect(result.countries[0]?.lines[0]?.[0]?.[0]).toBeCloseTo(2.5, 3);
    expect(result.countries[0]?.lines[0]?.[1]?.[0]).toBeCloseTo(4.5, 3);
  });

  it("keeps the younger source part through the interval instead of switching at its midpoint", () => {
    const younger = layer(10, [{ id: 0, coordinates: [[0, 0], [2, 0]] }]);
    const older = layer(15, [{ id: 0, coordinates: [[100, 0], [102, 0]] }]);
    const resolver = createTemporalCountryResolver(references(younger, older), motionCatalog, moveLongitude);

    expect(resolver.resolve(12.49).countries[0]?.lines[0]?.[0]?.[0]).toBeCloseTo(2.49, 2);
    expect(resolver.resolve(12.51).countries[0]?.lines[0]?.[0]?.[0]).toBeCloseTo(2.51, 2);
    expect(resolver.resolve(15).countries[0]?.lines[0]?.[0]?.[0]).toBeCloseTo(100, 2);
  });

  it("removes a part outside its declared lifetime", () => {
    const younger = layer(10, [{ id: 1, coordinates: [[0, 0], [2, 0]] }]);
    const older = layer(15, []);
    const result = createTemporalCountryResolver(
      references(younger, older),
      motionCatalog,
      moveLongitude,
    ).resolve(12.5);

    expect(result.countries).toEqual([]);
    expect(result.resolvedPartCount).toBe(0);
    expect(result.unsupportedPartCount).toBe(1);
  });

  it("rejects a tracking layer from another frame", () => {
    const native = layer(10, [{ id: 0, coordinates: [[0, 0], [2, 0]] }]);
    const incompatible = {
      ...native,
      catalog: { ...trackingCatalog, referenceFrameId: "anchor-plate-999" },
    };
    expect(() => createTemporalCountryResolver(references(incompatible), motionCatalog, moveLongitude))
      .toThrow(/does not match motion model\/frame/);
  });

  it("moves real 100–105 Ma country parts with the production model and frame", async () => {
    vi.stubGlobal("fetch", localAssetFetch());
    const [snapshot, catalogText] = await Promise.all([
      getSnapshot(102.5),
      readFile(resolve(process.cwd(), "public/data/paleomap-motion-v1.json"), "utf8"),
    ]);
    const catalog = decodePaleomapMotionCatalog(JSON.parse(catalogText));
    const result = createTemporalCountryResolver(snapshot.temporalReferences!, catalog).resolve(102.5);

    expect(result.sourceAgesMa).toEqual([100, 105]);
    expect(result.requestedAgeMa).toBe(102.5);
    expect(result.resolvedPartCount).toBeGreaterThan(100);
    expect(result.pointCount).toBeGreaterThan(1_000);
    expect(result.parts.every((part) =>
      part.coordinates.every(([longitude, latitude]) =>
        Number.isFinite(longitude) && Number.isFinite(latitude) &&
        Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90
      )
    )).toBe(true);
    expect(result.parts.some((part) => {
      const sourceLayer = snapshot.temporalReferences!.younger.areaTracking;
      const sourceIndex = sourceLayer.partIds.indexOf(part.partId);
      if (sourceIndex < 0) return false;
      const sourcePoint = sourceLayer.pointOffsets[sourceIndex]!;
      const sourceLongitude = sourceLayer.coordinates[sourcePoint * 2]! * sourceLayer.catalog.coordinateScaleDegrees;
      return Math.abs(part.coordinates[0]![0] - sourceLongitude) > 0.01;
    })).toBe(true);
  });

  it("binds modern country parts once and moves exact and fractional Cao ages", () => {
    const present = layer(0, [{ id: 0, coordinates: [[0, 2], [1, 3], [3, 4], [4, 5]] }]);
    let sourceLookups = 0;
    const targetFrame = { modelId: "cao", modelVersion: "2.4", referenceFrameId: "palaeomagnetic", anchorPlateId: 0,
      directionConvention: "gplates-xyz-x0e-y90e-znorth" } as const;
    const sourceFrame = { modelId: "motion-model-test", modelVersion: "test", referenceFrameId: "anchor-plate-0", anchorPlateId: 0,
      directionConvention: "gplates-xyz-x0e-y90e-znorth" } as const;
    const crosswalk = {
      targetFrame,
      sourceFrame,
      sourceIds: ["cao-test"],
      methodStatus: "static-continental-material-crosswalk",
      ageCacheLimit: 3,
      cachedTargetAgeCount: 0,
      cachedSourceEndpointCount: 0,
      resolveSourcePoint(reference: PeriodPointReference) {
        sourceLookups += 1;
        return { status: "resolved", evidence: "model-conversion-inference", requestedAgeMa: 0, sourceAgeMa: 0,
          sourceFrame, targetFrame, sourceCoordinates: reference.coordinates,
          targetCoordinates: reference.coordinates, sourcePlateId: reference.plateId,
          targetMaterial: { materialId: reference.coordinates[0] < 2 ? "west" : "east", kind: "continental-crust", frame: targetFrame,
            sourceIds: ["cao-test"], plateId: reference.coordinates[0] < 2 ? 501 : 701, referenceAgeMa: 0,
            directionAtReference: [reference.coordinates[0], reference.coordinates[1], 1], validTimeMa: { oldest: 540, youngest: 0 } } } as const;
      },
      resolveTargetPoint() { throw new Error("unused"); },
      resolveMappedMaterial(material: { directionAtReference: readonly [number, number, number] }, ageMa: number): LonLat {
        return [material.directionAtReference[0] + ageMa, material.directionAtReference[1]];
      },
    } as unknown as CaoPaleomapCrosswalk;
    const resolver = createCaoTemporalCountryResolver(present, motionCatalog, crosswalk);

    expect(sourceLookups).toBe(4);
    const exact = resolver.resolve(0);
    expect(exact.countries[0]?.lines).toHaveLength(2);
    expect(exact.parts.map(({ plateId }) => plateId)).toEqual([501, 701]);
    expect(exact.countries[0]?.lines[0]?.[0]?.[0]).toBeCloseTo(0, 3);
    const fractional = resolver.resolve(12.5);
    expect(fractional.countries[0]?.lines[0]?.[0]?.[0]).toBeCloseTo(12.5, 3);
    expect(sourceLookups).toBe(4);
    expect(fractional.conversionEvidence).toBe("model-conversion-inference");
  });
});
