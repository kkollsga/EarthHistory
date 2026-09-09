import { describe, expect, it } from "vitest";
import type { SurfaceRefinementTileMetadata } from "./types";
import { selectSurfaceRefinementMetadata } from "./refinementSelection";

function metadata(
  id: string,
  level: number,
  bounds: [number, number, number, number],
  parentId?: string,
): SurfaceRefinementTileMetadata {
  return {
    id, setId: "test", level, parentId, childIds: [], priority: 10,
    validRequestedAgeMa: [10, 0], bounds, cellCenterBounds: bounds,
    width: 3, height: 3, longitudeStep: 1, latitudeStep: 1,
    registration: "pixel-center", rowOrder: "north-to-south", units: "m",
    horizontalCrs: "EPSG:4326", referenceFrameId: "test-frame", verticalDatum: "test",
    surfaceMode: "surface", domain: "topobathymetry", composition: "absolute-replace",
    evidence: "model-output", nativeResolutionMetres: 1_000, maxErrorMetres: 100,
    splitErrorPixels: 1.5, mergeErrorPixels: 1, edgeTransitionCells: 1,
    sourceProduct: "test", sourceVersion: "1", sourceIds: ["test"], assetPath: `${id}.json`,
  };
}

describe("sparse surface refinement selection", () => {
  const root = metadata("root", 0, [-20, -20, 20, 20]);
  const coast = metadata("coast", 1, [-5, -5, 5, 5], "root");

  it("uses a sparse child only when its projected error warrants it", () => {
    const base = { coordinates: [0, 0] as [number, number], requestedAgeMa: 0,
      surfaceMode: "surface" as const, referenceFrameId: "test-frame" };
    expect(selectSurfaceRefinementMetadata([root, coast], {
      ...base, projectedErrorPixels: new Map([["coast", 1.4]]),
    }).map((tile) => tile.id)).toEqual(["root"]);
    expect(selectSurfaceRefinementMetadata([root, coast], {
      ...base, projectedErrorPixels: new Map([["coast", 1.6]]),
    }).map((tile) => tile.id)).toEqual(["coast"]);
  });

  it("uses split/merge hysteresis and parent fallback", () => {
    const selected = selectSurfaceRefinementMetadata([root, coast], {
      coordinates: [0, 0], requestedAgeMa: 0, surfaceMode: "surface",
      referenceFrameId: "test-frame", previousTileId: "coast",
      projectedErrorPixels: new Map([["coast", 1.2]]),
    });
    expect(selected.map((tile) => tile.id)).toEqual(["coast"]);
    expect(selectSurfaceRefinementMetadata([root], {
      coordinates: [0, 0], requestedAgeMa: 0, surfaceMode: "surface",
      referenceFrameId: "test-frame",
    }).map((tile) => tile.id)).toEqual(["root"]);
  });

  it("rejects incompatible ages and frames", () => {
    expect(selectSurfaceRefinementMetadata([root], {
      coordinates: [0, 0], requestedAgeMa: 11, surfaceMode: "surface",
      referenceFrameId: "test-frame",
    })).toEqual([]);
    expect(selectSurfaceRefinementMetadata([root], {
      coordinates: [0, 0], requestedAgeMa: 0, surfaceMode: "surface",
      referenceFrameId: "another-frame",
    })).toEqual([]);
  });
});
