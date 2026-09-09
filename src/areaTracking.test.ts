import { describe, expect, it } from "vitest";
import type { AreaTrackingCatalog, AreaTrackingLayer, LonLat } from "./data";
import { createAreaFocusDescriptor, resolveAreaFocusDescriptor } from "./areaTracking";

const SCALE = 180 / 32767;

function encoded([longitude, latitude]: LonLat): [number, number] {
  return [Math.round(longitude / SCALE), Math.round(latitude / SCALE)];
}

const catalog: AreaTrackingCatalog = {
  schemaVersion: 1,
  id: "tracking-test",
  plateModelId: "model-test",
  referenceFrameId: "frame-test",
  coordinateEncoding: "int16-le-longitude-latitude",
  coordinateScaleDegrees: SCALE,
  measure: "normalized-geodesic-arclength",
  sourceSimplificationToleranceDegrees: 0.18,
  sourceIds: ["source-test"],
  features: [
    { id: "feature-zero", countryId: "zero", name: "Zero", plateId: 1, validTimeMa: [540, 0] },
    { id: "feature-one", countryId: "one", name: "One", plateId: 2, validTimeMa: [540, 0] },
  ],
  parts: [
    { id: 0, feature: 0, geometryIndex: 0 },
    { id: 1, feature: 1, geometryIndex: 0 },
  ],
};

function layer(ageMa: number, parts: Array<{ id: number; coordinates: LonLat[] }>): AreaTrackingLayer {
  const coordinates: number[] = [];
  const pointOffsets = [0];
  for (const part of parts) {
    for (const point of part.coordinates) coordinates.push(...encoded(point));
    pointOffsets.push(coordinates.length / 2);
  }
  return {
    ageMa,
    catalog,
    partIds: Uint16Array.from(parts.map((part) => part.id)),
    pointOffsets: Uint32Array.from(pointOffsets),
    coordinates: Int16Array.from(coordinates),
    byteLength: coordinates.length * Int16Array.BYTES_PER_ELEMENT,
  };
}

function expectCoordinates(actual: LonLat, expected: LonLat, precision = 1): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
}

describe("temporal area tracking", () => {
  it("preserves a local along-feature measure and tangent-plane offset under rigid rotation", () => {
    const present = layer(0, [{ id: 0, coordinates: [[0, 0], [10, 0]] }]);
    const descriptor = createAreaFocusDescriptor(present, [5, 2], 5 * Math.PI / 180);
    expect(descriptor).not.toBeNull();
    expect(descriptor?.featureId).toBe("feature-zero");
    expect(descriptor?.alongMeasure).toBeCloseTo(0.5, 2);

    const reconstructed = layer(20, [{ id: 0, coordinates: [[30, 0], [40, 0]] }]);
    const result = resolveAreaFocusDescriptor(reconstructed, descriptor!);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expectCoordinates(result.coordinates, [35, 2]);
  });

  it("uses stable part identity when an earlier part disappears and later reappears", () => {
    const initial = layer(20, [
      { id: 0, coordinates: [[-40, 0], [-30, 0]] },
      { id: 1, coordinates: [[10, 0], [20, 0]] },
    ]);
    const descriptor = createAreaFocusDescriptor(initial, [15, 1], 3 * Math.PI / 180);
    expect(descriptor?.partId).toBe(1);

    const missing = layer(55, [{ id: 0, coordinates: [[-20, 0], [-10, 0]] }]);
    expect(resolveAreaFocusDescriptor(missing, descriptor!)).toEqual({
      status: "unresolved",
      reason: "feature-unavailable",
    });

    const reappeared = layer(20, [{ id: 1, coordinates: [[40, 0], [50, 0]] }]);
    const result = resolveAreaFocusDescriptor(reappeared, descriptor!);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expectCoordinates(result.coordinates, [45, 1]);
  });

  it("tracks across the antimeridian without treating longitude as a flat interval", () => {
    const seam = layer(0, [{ id: 0, coordinates: [[179, 0], [-179, 0]] }]);
    const descriptor = createAreaFocusDescriptor(seam, [180, 1], 3 * Math.PI / 180);
    const result = resolveAreaFocusDescriptor(seam, descriptor!);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(Math.abs(Math.abs(result.coordinates[0]) - 180)).toBeLessThan(0.02);
      expect(result.coordinates[1]).toBeCloseTo(1, 1);
    }
  });

  it("rejects distant attachment, incompatible sources, and invalid measures", () => {
    const present = layer(0, [{ id: 0, coordinates: [[0, 0], [10, 0]] }]);
    expect(createAreaFocusDescriptor(present, [90, 0], 5 * Math.PI / 180)).toBeNull();
    expect(createAreaFocusDescriptor(present, [181, 0], 5 * Math.PI / 180)).toBeNull();
    const descriptor = createAreaFocusDescriptor(present, [5, 1], 5 * Math.PI / 180)!;
    expect(resolveAreaFocusDescriptor(
      { ...present, catalog: { ...catalog, referenceFrameId: "other-frame" } },
      descriptor,
    )).toEqual({ status: "unresolved", reason: "incompatible-source" });
    expect(resolveAreaFocusDescriptor(present, { ...descriptor, alongMeasure: 2 })).toEqual({
      status: "unresolved",
      reason: "invalid-descriptor",
    });
  });
});
