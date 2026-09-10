import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertPeriodBoundaryReference,
  assertPeriodCoordinateView,
  createPeriodCoordinateResolver,
  createPeriodMaterialResolver,
  decodePeriodTopologyOwnership,
  interpolatePeriodScalar,
  lonLatToPeriodDirection,
  periodMaterialIncludesAge,
  periodPointMatchesView,
  periodDirectionToLonLat,
  resolvePeriodSourceAgeBracket,
} from "./temporal";
import { decodePaleomapMotionCatalog } from "./paleomapMotion";

const CAO_TEST_FRAME = {
  modelId: "cao-et-al-2024",
  modelVersion: "2.4",
  referenceFrameId: "palaeomagnetic-anchor-0",
  anchorPlateId: 0,
  directionConvention: "gplates-xyz-x0e-y90e-znorth" as const,
};

describe("period interpolation", () => {
  it("clamps scalar interpolation to its source interval", () => {
    expect(interpolatePeriodScalar(100, 300, 0.4)).toBe(180);
    expect(interpolatePeriodScalar(100, 300, -1)).toBe(100);
    expect(interpolatePeriodScalar(100, 300, 2)).toBe(300);
  });

  it("names and preserves the standard GPlates coordinate convention", () => {
    expect(lonLatToPeriodDirection([0, 0])).toEqual([1, 0, 0]);
    expect(lonLatToPeriodDirection([90, 0])[1]).toBeCloseTo(1);
    expect(lonLatToPeriodDirection([0, 90])[2]).toBeCloseTo(1);
    const roundTrip = periodDirectionToLonLat(lonLatToPeriodDirection([-135, -45]));
    expect(roundTrip[0]).toBeCloseTo(-135);
    expect(roundTrip[1]).toBeCloseTo(-45);
  });

  it("brackets model-native source ages without filling gaps outside coverage", () => {
    expect(resolvePeriodSourceAgeBracket([10, 0, 5], 2.5)).toEqual({
      requestedAgeMa: 2.5,
      youngerAgeMa: 0,
      olderAgeMa: 5,
      fraction: 0.5,
      exactEndpoint: false,
    });
    expect(resolvePeriodSourceAgeBracket([0, 5, 10], 5).exactEndpoint).toBe(true);
    expect(() => resolvePeriodSourceAgeBracket([0, 5, 10], 11)).toThrow(/outside source coverage/);
  });

  it("binds each view to one model and frame before accepting a point reference", () => {
    const view = {
      frame: CAO_TEST_FRAME,
      sourceAgesMa: [0, 5, 10],
      materialSourceIds: ["cao-topologies"],
      boundarySourceIds: ["cao-boundaries"],
    };
    expect(() => assertPeriodCoordinateView(view)).not.toThrow();
    expect(periodPointMatchesView(view, {
      frame: CAO_TEST_FRAME,
      plateId: 101,
      sourceAgeMa: 5,
      coordinates: [0, 0],
    })).toBe(true);
    expect(periodPointMatchesView(view, {
      frame: { ...view.frame, modelVersion: "2.5" },
      plateId: 101,
      sourceAgeMa: 5,
      coordinates: [0, 0],
    })).toBe(false);
  });

  it("keeps unknown and ambiguous ocean topology distinct from resolved ownership", () => {
    const slots = [{ sourceFeatureId: "ocean-one", plateId: 7 }];
    expect(decodePeriodTopologyOwnership(0, slots)).toEqual({ status: "unknown" });
    expect(decodePeriodTopologyOwnership(255, slots)).toEqual({ status: "ambiguous" });
    expect(decodePeriodTopologyOwnership(1, slots)).toEqual({
      status: "resolved",
      slotIndex: 0,
      topology: slots[0],
    });
    expect(() => decodePeriodTopologyOwnership(2, slots)).toThrow(/not defined/);
  });

  it("checks material lifetime and requires dated boundary adjacency and subduction polarity", () => {
    const material = {
      validTimeMa: { oldest: 100, youngest: 20 },
    };
    expect(periodMaterialIncludesAge(material, 60)).toBe(true);
    expect(periodMaterialIncludesAge(material, 10)).toBe(false);
    expect(() => assertPeriodBoundaryReference({
      featureId: "ridge",
      type: "mid-ocean-ridge",
      ageMa: 100,
      validTimeMa: { oldest: 100, youngest: 100 },
      frame: CAO_TEST_FRAME,
      sourceIds: ["cao-2024"],
      coordinates: [[0, 0], [1, 1]],
      adjacencyStatus: "resolved",
      leftPlateIds: [1],
      rightPlateIds: [2],
    })).not.toThrow();
    expect(() => assertPeriodBoundaryReference({
      featureId: "trench",
      type: "subduction",
      ageMa: 100,
      validTimeMa: { oldest: 100, youngest: 100 },
      frame: CAO_TEST_FRAME,
      sourceIds: ["cao-2024"],
      coordinates: [[0, 0], [1, 1]],
      adjacencyStatus: "resolved",
      leftPlateIds: [1],
      rightPlateIds: [2],
      orientationStatus: "resolved",
      subductionPolarity: "left",
    })).toThrow(/missing polarity plates/);
    expect(() => assertPeriodBoundaryReference({
      featureId: "unoriented-trench",
      type: "subduction",
      ageMa: 100,
      validTimeMa: { oldest: 100, youngest: 100 },
      frame: CAO_TEST_FRAME,
      sourceIds: ["cao-2024"],
      coordinates: [[0, 0], [1, 1]],
      adjacencyStatus: "incomplete",
      leftPlateIds: [1],
      rightPlateIds: [],
      orientationStatus: "unknown",
      subductionPolarity: "unknown",
    })).not.toThrow();
  });

  it("gives focus coordinates and inverse terrain sampling the same plate transform", () => {
    const catalog = decodePaleomapMotionCatalog(JSON.parse(
      readFileSync("public/data/paleomap-motion-v1.json", "utf8"),
    ));
    const source = JSON.parse(readFileSync("public/data/countries-100ma.json", "utf8")) as {
      poiCoordinates: Record<string, [number, number]>;
    };
    const sourceCoordinates = source.poiCoordinates.chicxulub;
    const requestedCoordinates = createPeriodCoordinateResolver(catalog)(
      {
        frame: {
          modelId: catalog.model.id,
          modelVersion: catalog.model.underlyingModelVersion,
          referenceFrameId: `anchor-plate-${catalog.model.anchorPlateId}`,
          anchorPlateId: catalog.model.anchorPlateId,
          directionConvention: "gplates-xyz-x0e-y90e-znorth",
        },
        plateId: catalog.poiPlateIds.chicxulub,
        sourceAgeMa: 100,
        coordinates: sourceCoordinates,
      },
      102.5,
    );
    expect(requestedCoordinates).toBeDefined();
    expect(createPeriodCoordinateResolver(catalog)({
      frame: {
        modelId: catalog.model.id,
        modelVersion: "incompatible-version",
        referenceFrameId: `anchor-plate-${catalog.model.anchorPlateId}`,
        anchorPlateId: catalog.model.anchorPlateId,
        directionConvention: "gplates-xyz-x0e-y90e-znorth",
      },
      plateId: catalog.poiPlateIds.chicxulub,
      sourceAgeMa: 100,
      coordinates: sourceCoordinates,
    }, 102.5)).toBeUndefined();
    const material = createPeriodMaterialResolver(catalog, 102.5)
      .resolveAt(lonLatToPeriodDirection(requestedCoordinates!));
    expect(material?.plateId).toBe(catalog.poiPlateIds.chicxulub);
    const recovered = periodDirectionToLonLat(material!.youngerDirection);
    expect(recovered[0]).toBeCloseTo(sourceCoordinates[0], 6);
    expect(recovered[1]).toBeCloseTo(sourceCoordinates[1], 6);
  });
});
