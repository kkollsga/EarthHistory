import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeCaoOceanBinary, decodeCaoOceanCatalog, type CaoOceanMotionData } from "../data/caoOcean";
import type { UnitDirection } from "../data/paleomapMotion";
import {
  applyCaoBoundaryRelief,
  applyCaoSlopeMaterialContrast,
  caoDisplayedHeightMetres,
  caoMaterialColor,
  createCaoBoundaryField,
  gdh1DepthMetres,
} from "./caoSurface";

const metadata = decodeCaoOceanCatalog(JSON.parse(readFileSync("public/data/cao-ocean-motion-v1.json", "utf8")));
const binary = readFileSync("public/data/cao-ocean-motion-v1.bin");
const data: CaoOceanMotionData = decodeCaoOceanBinary(metadata, binary.buffer.slice(
  binary.byteOffset, binary.byteOffset + binary.byteLength,
) as ArrayBuffer);

function normalize(direction: UnitDirection): UnitDirection {
  const inverse = 1 / Math.hypot(...direction);
  return [direction[0] * inverse, direction[1] * inverse, direction[2] * inverse];
}

function cross(left: UnitDirection, right: UnitDirection): UnitDirection {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function rotateAround(axis: UnitDirection, direction: UnitDirection, radians: number): UnitDirection {
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const projection = axis[0] * direction[0] + axis[1] * direction[1] + axis[2] * direction[2];
  const crossed = cross(axis, direction);
  return normalize([
    direction[0] * cosine + crossed[0] * sine + axis[0] * projection * (1 - cosine),
    direction[1] * cosine + crossed[1] * sine + axis[1] * projection * (1 - cosine),
    direction[2] * cosine + crossed[2] * sine + axis[2] * projection * (1 - cosine),
  ]);
}

function lonLatDirection(longitude: number, latitude: number): UnitDirection {
  const lon = longitude * Math.PI / 180;
  const lat = latitude * Math.PI / 180;
  const cosine = Math.cos(lat);
  return [cosine * Math.cos(lon), cosine * Math.sin(lon), Math.sin(lat)];
}

describe("Cao target-native surface synthesis", () => {
  it("implements the published GDH1 piecewise thermal-basement quantities", () => {
    expect(gdh1DepthMetres(0)).toBe(2_600);
    expect(gdh1DepthMetres(20)).toBeCloseTo(5_651 - 2_473 * Math.exp(-0.0278 * 20), 10);
    expect(gdh1DepthMetres(100)).toBeGreaterThan(gdh1DepthMetres(20));
  });

  it("renders negative continental relief as water while retaining signed shelf depth", () => {
    expect(caoDisplayedHeightMetres(-240, "surface")).toBe(0);
    expect(caoDisplayedHeightMetres(-240, "seafloor")).toBe(-240);
    const shelf = caoMaterialColor(
      -240,
      "continental",
      25,
      [15, 25],
      { stage: "modern-biomes", temperatureC: 14, iceLatitude: 70, vegetation: 1 },
      null,
    );
    const exposed = caoMaterialColor(
      240,
      "continental",
      25,
      [15, 25],
      { stage: "modern-biomes", temperatureC: 14, iceLatitude: 70, vegetation: 1 },
      null,
    );
    expect(shelf[2]).toBeGreaterThan(shelf[1]);
    expect(shelf[2]).toBeGreaterThan(shelf[0]);
    expect(exposed[1]).toBeGreaterThan(exposed[2]);
  });

  it("adds rock contrast from displaced slopes without tinting marine material", () => {
    const colors = new Float32Array([
      0.2, 0.5, 0.2,
      0.05, 0.18, 0.3,
    ]);
    const directions = new Float32Array([
      1, 0, 0,
      1, 0, 0,
    ]);
    const normals = new Float32Array([
      0.8, 0.6, 0,
      0.8, 0.6, 0,
    ]);
    applyCaoSlopeMaterialContrast(colors, directions, normals);
    expect(colors[0]).toBeGreaterThan(0.2);
    expect(colors[1]).toBeLessThan(0.5);
    expect(Array.from(colors.slice(3))).toEqual(Array.from(new Float32Array([0.05, 0.18, 0.3])));
  });

  it("can suppress generic polar ice color where the source chronology has no active ice", () => {
    const environment = {
      stage: "flowering-plants" as const,
      temperatureC: 18,
      iceLatitude: 69,
      iceIntensity: 1,
      vegetation: 0.8,
    };
    const withIce = caoMaterialColor(2_000, "continental", 80, [20, 80], environment, null, true);
    const sourceAbsent = caoMaterialColor(2_000, "continental", 80, [20, 80], environment, null, false);
    expect(withIce.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(
      sourceAbsent.reduce((sum, value) => sum + value, 0),
    );
  });

  it("elevates a source-positioned ridge above two older flanks", () => {
    const ageMa = 0;
    const age = data.catalog.ages[0]!;
    const scale = data.catalog.grid.scaleDegrees * Math.PI / 180;
    const segmentPoint = (coordinateOffset: number): UnitDirection => {
      const offset = coordinateOffset * 2;
      const longitude = data.coordinates[offset]! * scale;
      const latitude = data.coordinates[offset + 1]! * scale;
      const cosine = Math.cos(latitude);
      return [cosine * Math.cos(longitude), cosine * Math.sin(longitude), Math.sin(latitude)];
    };
    const segment = data.catalog.segments
      .slice(age.segmentOffset, age.segmentOffset + age.segmentCount)
      .find((candidate) => {
        const adjacentDot = segmentPoint(candidate.coordinateOffset).reduce(
          (sum, value, index) => sum + value * segmentPoint(candidate.coordinateOffset + 1)[index]!, 0,
        );
        return data.catalog.features[candidate.sourceFeatureIndex]?.featureType === "MidOceanRidge" &&
          candidate.coordinateCount >= 2 && adjacentDot > 0.8 && adjacentDot < 0.999999;
      })!;
    const point = (index: number): UnitDirection => {
      return segmentPoint(segment.coordinateOffset + index);
    };
    const start = point(0);
    const end = point(1);
    const centre = normalize([start[0] + end[0], start[1] + end[1], start[2] + end[2]]);
    const edgeNormal = normalize(cross(start, end));
    const crossEdgeAxis = normalize(cross(edgeNormal, centre));
    const field = createCaoBoundaryField(data, ageMa)!;
    const westFlank = rotateAround(crossEdgeAxis, centre, 6 * Math.PI / 180);
    const eastFlank = rotateAround(crossEdgeAxis, centre, -6 * Math.PI / 180);
    expect(westFlank.every(Number.isFinite)).toBe(true);
    expect(eastFlank.every(Number.isFinite)).toBe(true);
    const ridge = field.sample(centre);
    const west = field.sample(westFlank);
    const east = field.sample(eastFlank);
    expect(ridge.ridgeKilometres).toBeLessThan(1);
    expect(west.ridgeKilometres).toBeGreaterThan(250);
    expect(east.ridgeKilometres).toBeGreaterThan(250);
    const basement = -gdh1DepthMetres(35);
    expect(applyCaoBoundaryRelief(basement, "ocean", ridge)).toBeGreaterThan(
      applyCaoBoundaryRelief(basement, "ocean", west),
    );
    expect(applyCaoBoundaryRelief(basement, "ocean", ridge)).toBeGreaterThan(
      applyCaoBoundaryRelief(basement, "ocean", east),
    );
  });

  it("keeps high-latitude dateline proximity inside the spherical support bins", () => {
    const field = createCaoBoundaryField(data, 470)!;
    const sourceRidgePoint = lonLatDirection(179.40122684408092, 75.9508041627247);
    const wrappedNearbyPoint = lonLatDirection(-165.59877315591908, 75.9508041627247);
    expect(field.sample(sourceRidgePoint).ridgeKilometres).toBeLessThan(1);
    expect(field.sample(wrappedNearbyPoint).ridgeKilometres).toBeLessThan(420);
  });

  it("publishes only source-validated fractional links and preserves unsupported crossovers", () => {
    const link = data.catalog.boundaryLinks.find((candidate) => {
      const segment = data.catalog.segments[candidate.youngerSegmentIndex]!;
      return data.catalog.features[segment.sourceFeatureIndex]?.featureType === "MidOceanRidge";
    })!;
    const younger = data.catalog.segments[link.youngerSegmentIndex]!;
    const older = data.catalog.segments[link.olderSegmentIndex]!;
    const point = (segment: typeof younger): UnitDirection => {
      const offset = segment.coordinateOffset * 2;
      const scale = data.catalog.grid.scaleDegrees * Math.PI / 180;
      const longitude = data.coordinates[offset]! * scale;
      const latitude = data.coordinates[offset + 1]! * scale;
      const cosine = Math.cos(latitude);
      return [cosine * Math.cos(longitude), cosine * Math.sin(longitude), Math.sin(latitude)];
    };
    const midpoint = normalize([
      point(younger)[0] + point(older)[0],
      point(younger)[1] + point(older)[1],
      point(younger)[2] + point(older)[2],
    ]);
    const ageMa = link.youngerAgeIndex * 5 + 2.5;
    const field = createCaoBoundaryField(data, ageMa)!;
    expect(field.evidence).toBe("interpolation");
    expect(field.segmentCount).toBeGreaterThan(0);
    expect(field.unsupportedSegmentCount).toBeGreaterThan(0);
    expect(field.sample(midpoint).ridgeKilometres).toBeLessThan(20);
    expect(createCaoBoundaryField(data, 252.5)).toBeNull();
    expect(createCaoBoundaryField(data, 412.5)).toBeNull();
  });
});
