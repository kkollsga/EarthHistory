import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_METRES } from "../reconstruction/arithmetic";
import {
  createCurvedGuideLabelGeometry,
  createLongitudeCrossingTickGeometry,
  createPolarSectorTickGeometry,
  createReferenceGuideLines,
  REFERENCE_GUIDE_LATITUDES,
  REFERENCE_GUIDE_LABELS,
  REFERENCE_GUIDE_MAIN_LONGITUDES,
  REFERENCE_GUIDE_MINOR_LONGITUDES,
} from "./globeGuides";
import { lonLatToVector3, vector3ToLonLat } from "./math";
import { CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES } from "./reconstruction/caoFoundation";

describe("globus-style guide overlays", () => {
  it("keeps curved label ribbons on the sphere shell", () => {
    const { geometry, centerDirection } = createCurvedGuideLabelGeometry(
      "parallel", [-15, 0], 0.4, 0.03, 1.002, 16);
    const positions = geometry.getAttribute("position");
    expect(positions.count).toBeGreaterThan(10);
    for (let index = 0; index < positions.count; index += 1) {
      const length = Math.hypot(positions.getX(index), positions.getY(index), positions.getZ(index));
      expect(length).toBeCloseTo(1.002, 3);
    }
    expect(Math.hypot(...centerDirection.toArray())).toBeCloseTo(1, 6);
    geometry.dispose();
  });

  it("builds flat polar sector ticks near each pole", () => {
    const north = createPolarSectorTickGeometry(1, 1.0014, 12);
    const positions = north.getAttribute("position");
    expect(positions.count).toBe(24);
    for (let index = 0; index < positions.count; index += 1) {
      const y = positions.getY(index);
      expect(y).toBeGreaterThan(0.95);
      const length = Math.hypot(positions.getX(index), y, positions.getZ(index));
      expect(length).toBeCloseTo(1.0014, 3);
    }
    north.dispose();
    expect(REFERENCE_GUIDE_LABELS.some((label) => label.path === "meridian")).toBe(true);
  });

  it("places four main meridians 90 degrees apart above the land shell", () => {
    const lines = createReferenceGuideLines();
    expect(lines).toHaveLength(REFERENCE_GUIDE_LATITUDES.length + 4);
    const meridians = lines.slice(REFERENCE_GUIDE_LATITUDES.length);
    expect(REFERENCE_GUIDE_MAIN_LONGITUDES).toEqual([0, 90, 180, 270]);
    expect(meridians.map((line) => line[0][0])).toEqual([0, 90, 180, 270]);
    for (const line of meridians) {
      expect(line).toHaveLength(45);
      expect(line[0][1]).toBe(-88);
      expect(line.at(-1)?.[1]).toBe(88);
      expect(new Set(line.map(([longitude]) => longitude)).size).toBe(1);
      for (let index = 1; index < line.length; index += 1) {
        const start = lonLatToVector3(line[index - 1], 1.0013);
        const end = lonLatToVector3(line[index], 1.0013);
        const chordMidpointRadius = start.add(end).multiplyScalar(0.5).length();
        expect(chordMidpointRadius).toBeGreaterThan(
          1 + CAO_FOUNDATION_LAND_SHELL_OFFSET_METRES / EARTH_RADIUS_METRES);
      }
    }
  });

  it("marks every minor-longitude crossing on all seven latitude guides", () => {
    const radius = 1.0014;
    const geometry = createLongitudeCrossingTickGeometry(radius, 0.5);
    const positions = geometry.getAttribute("position");
    expect(REFERENCE_GUIDE_MINOR_LONGITUDES).toEqual([
      30, 60, 120, 150, 210, 240, 300, 330,
    ]);
    expect(positions.count).toBe(7 * 8 * 2);
    for (let tick = 0; tick < 7 * 8; tick += 1) {
      const latitudeIndex = Math.floor(tick / 8);
      const longitudeIndex = tick % 8;
      for (let endpoint = 0; endpoint < 2; endpoint += 1) {
        const index = tick * 2 + endpoint;
        const point = new THREE.Vector3(
          positions.getX(index), positions.getY(index), positions.getZ(index));
        expect(point.length()).toBeCloseTo(radius, 6);
        const [longitude, latitude] = vector3ToLonLat(point);
        const expectedLongitude = REFERENCE_GUIDE_MINOR_LONGITUDES[longitudeIndex];
        const normalizedExpectedLongitude = expectedLongitude > 180
          ? expectedLongitude - 360 : expectedLongitude;
        expect(longitude).toBeCloseTo(normalizedExpectedLongitude, 4);
        expect(latitude).toBeCloseTo(
          REFERENCE_GUIDE_LATITUDES[latitudeIndex] + (endpoint === 0 ? -0.5 : 0.5), 4);
      }
    }
    geometry.dispose();
  });

  it("enforces the supported compact crossing-tick span", () => {
    expect(() => createLongitudeCrossingTickGeometry(1.0014, 0.51))
      .toThrow("invalid longitude crossing tick shape");
  });
});
