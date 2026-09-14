import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { LonLat } from "../data";
import { EARTH_RADIUS_METRES } from "../reconstruction/arithmetic";
import type {
  GuideLabelGroup, GuideLabelPaintContext, GuideLabelPath, GuideLabelSegment,
  GuideLabelToneScan, GuideLabelToneState,
} from "./globeGuides";
import {
  createCurvedGuideLabelGeometry,
  createGuideLabelBasis,
  createLongitudeCrossingTickGeometry,
  createPolarSectorTickGeometry,
  createReferenceGuideLines,
  GUIDE_LABEL_BASELINE_PAD_FRACTION,
  GUIDE_LABEL_DARK_INK_STYLE,
  GUIDE_LABEL_EDITORIAL_TONE,
  GUIDE_LABEL_INK_CLEARANCE_RAD,
  GUIDE_LABEL_LIGHT_INK_STYLE,
  GUIDE_LABEL_TONE_HYSTERESIS_SAMPLES,
  advanceGuideLabelToneScan,
  guideLabelInkStyle,
  guideLabelSegmentProbes,
  guideLabelToneForCoverage,
  nextGuideLabelToneState,
  GUIDE_LABEL_LINE_GAP_RAD,
  GUIDE_LABEL_SHEET_MIN_WIDTH_PX,
  GUIDE_LABEL_SHEET_SIDE_MARGIN,
  GUIDE_LABEL_TEXTURE_HEIGHT_PX,
  guideLabelSheetWidth,
  paintGuideLabel,
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

  // Mirrored meridian labels were a left-handed (forward, up) basis: the glyph
  // texture was pasted onto a frame whose forward x up pointed into the globe.
  it("orients every guide label with a right-handed outward-facing basis", () => {
    const probes: readonly LonLat[] = [
      [0, 50], [180, 50], [90, -70], [-120, 0], [0, 80], [45, -80], [-179, 12],
    ];
    for (const path of ["parallel", "meridian"] as const) {
      for (const coordinates of probes) {
        const { forward, up, outward } = createGuideLabelBasis(path, coordinates);
        const handedness = new THREE.Vector3().crossVectors(forward, up).dot(outward);
        expect(handedness, `${path} ${coordinates.join(",")}`).toBeCloseTo(1, 6);
        expect(forward.dot(up)).toBeCloseTo(0, 6);
        expect(forward.dot(outward)).toBeCloseTo(0, 6);
        expect(up.dot(outward)).toBeCloseTo(0, 6);
      }
    }
  });

  it("reads parallels eastward and meridians northward", () => {
    // `|| 0` normalises -0, which toEqual distinguishes from 0.
    const rounded = (vector: THREE.Vector3) =>
      vector.toArray().map((value) => Math.round(value) || 0);
    const parallel = createGuideLabelBasis("parallel", [0, 0]);
    // East at lon 0 is -Z in the renderer frame; north is +Y.
    expect(rounded(parallel.forward)).toEqual([0, 0, -1]);
    expect(rounded(parallel.up)).toEqual([0, 1, 0]);
    const meridian = createGuideLabelBasis("meridian", [0, 0]);
    expect(rounded(meridian.forward)).toEqual([0, 1, 0]);
    // Glyph up is west, not east: east would flip the basis and mirror the text.
    expect(rounded(meridian.up)).toEqual([0, 0, 1]);
  });

  it("lifts the whole label ribbon off its line with a clear gap", () => {
    const radius = 1.0022;
    const height = 0.03;
    const cases: readonly (readonly [GuideLabelPath, LonLat])[] = [
      ["parallel", [-15, 0]], ["parallel", [-70, -60]], ["meridian", [0, 50]],
    ];
    for (const [path, center] of cases) {
      const { geometry } = createCurvedGuideLabelGeometry(
        path, center, 0.16, height, radius, 12);
      const positions = geometry.getAttribute("position");
      // Signed angular offset from the guide line itself: latitude above the
      // parallel, or the angle west of the meridian plane.
      const lon0 = center[0] * Math.PI / 180;
      const meridianNormal = new THREE.Vector3(
        -Math.sin(lon0), 0, -Math.cos(lon0)).negate();
      const offsetOf = (point: THREE.Vector3) => path === "parallel"
        ? Math.asin(point.y) - center[1] * Math.PI / 180
        : Math.asin(point.dot(meridianNormal));
      let nearest = Number.POSITIVE_INFINITY;
      let farthest = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < positions.count; index += 1) {
        const point = new THREE.Vector3(
          positions.getX(index), positions.getY(index), positions.getZ(index)).normalize();
        const offset = offsetOf(point);
        expect(offset, `${path} ${center.join(",")}`).toBeGreaterThan(0);
        nearest = Math.min(nearest, offset);
        farthest = Math.max(farthest, offset);
      }
      expect(nearest).toBeCloseTo(GUIDE_LABEL_LINE_GAP_RAD, 3);
      expect(farthest).toBeCloseTo(GUIDE_LABEL_LINE_GAP_RAD + height, 3);
      geometry.dispose();
    }
  });

  it("keeps a parallel label at its intended arc width away from the equator", () => {
    // Arc actually swept by the glyph row, not the longitude range: a parallel
    // is a small circle, so degrees of longitude shrink with cos(latitude).
    const glyphArc = (latitude: number) => {
      const { geometry } = createCurvedGuideLabelGeometry(
        "parallel", [0, latitude], 0.16, 0.03, 1, 8);
      const positions = geometry.getAttribute("position");
      const vertex = (index: number) => vector3ToLonLat(new THREE.Vector3(
        positions.getX(index), positions.getY(index), positions.getZ(index)));
      const [firstLongitude, rowLatitude] = vertex(0);
      const [lastLongitude] = vertex(positions.count - 2);
      geometry.dispose();
      return Math.abs(lastLongitude - firstLongitude) * Math.PI / 180
        * Math.cos(rowLatitude * Math.PI / 180);
    };
    // Meridian convergence used to halve the 60-degree label. The residual few
    // percent is the label's own poleward offset, not the convergence bug.
    expect(glyphArc(60) / glyphArc(0)).toBeGreaterThan(0.9);
    expect(glyphArc(60) / glyphArc(0)).toBeLessThan(1.1);
  });

  it("anchors every reference label on the guide line it names", () => {
    for (const label of REFERENCE_GUIDE_LABELS) {
      const [longitude, latitude] = label.coordinates;
      if (label.path === "parallel") {
        expect(REFERENCE_GUIDE_LATITUDES as readonly number[], label.text).toContain(latitude);
      } else {
        expect(REFERENCE_GUIDE_MAIN_LONGITUDES as readonly number[], label.text)
          .toContain(longitude);
        expect(Math.abs(latitude), label.text).toBeLessThanOrEqual(88);
      }
    }
  });

  const luminance = (token: string) => {
    const [red, green, blue] = [1, 3, 5].map((offset) =>
      Number.parseInt(token.slice(offset, offset + 2), 16));
    // Neutral grey: no channel may pull the tone toward a hue.
    expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeLessThanOrEqual(12);
    const channel = (value: number) => {
      const scaled = value / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
  };

  it("carries one dark and one light flat grey, no outline", () => {
    const dark = luminance(GUIDE_LABEL_DARK_INK_STYLE);
    const light = luminance(GUIDE_LABEL_LIGHT_INK_STYLE);
    // Dark grey for pale land and shelf; light grey for deep ocean.
    expect(dark).toBeGreaterThan(0.04);
    expect(dark).toBeLessThan(0.12);
    expect(light).toBeGreaterThan(0.45);
    // Deep ocean renders near 0.05 relative luminance; the light ink must clear
    // 3:1 against it while the dark ink cannot, which is why both exist.
    const deepOcean = 0.0506;
    expect((light + 0.05) / (deepOcean + 0.05)).toBeGreaterThan(3);
    expect((dark + 0.05) / (deepOcean + 0.05)).toBeLessThan(1.3);
    // Shelf water is a dark background too: it renders near 0.19, where the
    // light ink also beats the dark one. That is why shelf takes light ink.
    const shelf = 0.1933;
    expect((light + 0.05) / (shelf + 0.05)).toBeGreaterThan((shelf + 0.05) / (dark + 0.05));
    expect(guideLabelInkStyle("dark")).toBe(GUIDE_LABEL_DARK_INK_STYLE);
    expect(guideLabelInkStyle("light")).toBe(GUIDE_LABEL_LIGHT_INK_STYLE);
  });

  it("takes dark ink only where land covers the label, light ink otherwise", () => {
    // `covered` is land-only coverage: shelf water answers false and takes the
    // light ink alongside open ocean.
    expect(guideLabelToneForCoverage(true)).toBe("dark");
    expect(guideLabelToneForCoverage(false)).toBe("light");
    // No native publication means no coverage answer; deep ocean blue is the
    // dominant editorial base, so the fallback is the light ink.
    expect(GUIDE_LABEL_EDITORIAL_TONE).toBe("light");
  });

  it("holds a tone until the opposite classification repeats", () => {
    expect(GUIDE_LABEL_TONE_HYSTERESIS_SAMPLES).toBeGreaterThan(1);
    let state: GuideLabelToneState = { tone: "dark", pending: 0 };
    // A single disagreeing sample at a coastline must not flip the tone.
    state = nextGuideLabelToneState(state, false);
    expect(state.tone).toBe("dark");
    expect(state.pending).toBe(1);
    // Agreement again clears the count rather than leaving it armed.
    state = nextGuideLabelToneState(state, true);
    expect(state).toEqual({ tone: "dark", pending: 0 });
    for (let sample = 0; sample < GUIDE_LABEL_TONE_HYSTERESIS_SAMPLES - 1; sample += 1) {
      state = nextGuideLabelToneState(state, false);
      expect(state.tone).toBe("dark");
    }
    state = nextGuideLabelToneState(state, false);
    expect(state).toEqual({ tone: "light", pending: 0 });
    expect(() => nextGuideLabelToneState(state, true, 0))
      .toThrow("invalid guide-label tone hysteresis");
  });

  it("probes inside each segment's own share of the label arc", () => {
    const width = 0.2;
    const first = guideLabelSegmentProbes("parallel", [0, 0], width, { from: 0, to: 0.5 }, 3);
    const second = guideLabelSegmentProbes("parallel", [0, 0], width, { from: 0.5, to: 1 }, 3);
    expect(first).toHaveLength(3);
    const lon = (probe: THREE.Vector3) => vector3ToLonLat(probe)[0];
    // Probes stay inside the label footprint and the two halves do not overlap.
    for (const probe of [...first, ...second]) {
      expect(Math.abs(lon(probe))).toBeLessThanOrEqual(width / 2 * 180 / Math.PI + 1e-6);
      expect(probe.length()).toBeCloseTo(1, 9);
    }
    expect(Math.max(...first.map(lon))).toBeLessThan(Math.min(...second.map(lon)));
    expect(() => guideLabelSegmentProbes("parallel", [0, 0], width, { from: 0, to: 1 }, 0))
      .toThrow("invalid guide-label probe count");
  });

  it("draws the label once, unstroked and uncondensed, above an ink-free band", () => {
    const calls: { method: string; args: unknown[]; fillStyle: unknown;
      baseline: string }[] = [];
    const recorder = {
      font: "", letterSpacing: "", textAlign: "start", textBaseline: "alphabetic",
      fillStyle: "" as unknown,
      clearRect: () => {},
      fillText(...args: unknown[]) {
        calls.push({ method: "fill", args, fillStyle: recorder.fillStyle,
          baseline: recorder.textBaseline });
      },
      strokeText(...args: unknown[]) {
        calls.push({ method: "stroke", args, fillStyle: recorder.fillStyle,
          baseline: recorder.textBaseline });
      },
    };
    paintGuideLabel(recorder as unknown as GuideLabelPaintContext, "Equator", 512);
    // A halo or outline would show up here as a second, stroked pass.
    expect(calls.map((call) => call.method)).toEqual(["fill"]);
    expect(calls[0].fillStyle).toBe(GUIDE_LABEL_DARK_INK_STYLE);
    // No maxWidth argument: passing one is what condensed the long labels.
    expect(calls[0].args).toHaveLength(3);
    // Uppercase has no descender, so the alphabetic baseline is the lowest ink
    // row and the band below it stays clear of the guide line.
    expect(calls[0].baseline).toBe("alphabetic");
    expect(GUIDE_LABEL_BASELINE_PAD_FRACTION).toBeGreaterThan(0);
    expect(calls[0].args[2]).toBeCloseTo(
      GUIDE_LABEL_TEXTURE_HEIGHT_PX * (1 - GUIDE_LABEL_BASELINE_PAD_FRACTION), 6);
  });

  it("keeps the line-to-ink margin a hairline rather than a detachment", () => {
    // Both halves must be present, and their sum is what the captures measure
    // as 1-2 CSS px at the default global camera.
    expect(GUIDE_LABEL_LINE_GAP_RAD).toBeGreaterThan(0);
    expect(GUIDE_LABEL_INK_CLEARANCE_RAD).toBeGreaterThan(GUIDE_LABEL_LINE_GAP_RAD);
    expect(GUIDE_LABEL_INK_CLEARANCE_RAD).toBeGreaterThan(0.002);
    expect(GUIDE_LABEL_INK_CLEARANCE_RAD).toBeLessThan(0.0045);
  });

  it("sizes the sheet to the whole string instead of condensing it", () => {
    // "POLAR CELL EDGE - 60 N" measures near 920 px at the label font.
    const wide = guideLabelSheetWidth(920);
    expect(wide).toBeGreaterThanOrEqual(920 / (1 - 2 * GUIDE_LABEL_SHEET_SIDE_MARGIN));
    expect(guideLabelSheetWidth(100)).toBe(GUIDE_LABEL_SHEET_MIN_WIDTH_PX);
    // Glyph scale comes from the sheet height, so a wider sheet only widens the
    // ribbon; every label keeps the same ink height.
    expect(wide % 16).toBe(0);
    expect(() => guideLabelSheetWidth(0)).toThrow("invalid guide-label text width");
  });
  it("spends a bounded probe budget and stops a segment at its first hit", () => {
    const materials = { dark: { id: "dark" }, light: { id: "light" } };
    const makeSegment = (tone: "dark" | "light"): GuideLabelSegment => ({
      mesh: { material: materials[tone] } as unknown as THREE.Mesh,
      probes: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 1)],
      state: { tone, pending: 0 },
    });
    const group = { userData: { guideLabelMaterials: materials } } as unknown as GuideLabelGroup;
    const segments = [makeSegment("dark"), makeSegment("dark")];
    const scan: GuideLabelToneScan = {
      entries: segments.map((segment) => ({ group, segment })),
      cursor: 0, probe: 0, covered: false,
    };
    // Segment 0's first probe hits, so its other two are skipped and the rest of
    // the budget rolls straight onto segment 1's first probe.
    const seen: string[] = [];
    let step = advanceGuideLabelToneScan(scan, 2, (direction) => {
      seen.push(direction.toArray().join(","));
      return seen.length === 1;
    });
    expect(seen).toEqual(["1,0,0", "1,0,0"]);
    expect(step.probes).toBe(2);
    expect(step.done).toBe(false);
    // Budget is a hard ceiling: segment 1 misses every probe, so it uses the
    // two it has left and the round finishes inside a larger budget.
    step = advanceGuideLabelToneScan(scan, 4, () => false);
    expect(step.probes).toBe(2);
    expect(step.done).toBe(true);
    // One disagreeing round is inside the hysteresis, so nothing has flipped.
    expect(segments[1].state).toEqual({ tone: "dark", pending: 1 });
    expect(segments[1].mesh.material).toBe(materials.dark);
    expect(scan.cursor).toBe(2);
    expect(() => advanceGuideLabelToneScan(scan, 0, () => true))
      .toThrow("invalid guide-label tone probe budget");
  });

  it("swaps a segment to the prebuilt light material once hysteresis clears", () => {
    const materials = { dark: { id: "dark" }, light: { id: "light" } };
    const group = { userData: { guideLabelMaterials: materials } } as unknown as GuideLabelGroup;
    const segment: GuideLabelSegment = {
      mesh: { material: materials.dark } as unknown as THREE.Mesh,
      probes: [new THREE.Vector3(1, 0, 0)],
      state: { tone: "dark", pending: GUIDE_LABEL_TONE_HYSTERESIS_SAMPLES - 1 },
    };
    const scan: GuideLabelToneScan = {
      entries: [{ group, segment }], cursor: 0, probe: 0, covered: false,
    };
    const step = advanceGuideLabelToneScan(scan, 4, () => false);
    expect(step.changes).toBe(1);
    expect(segment.state.tone).toBe("light");
    // A tone change is a material swap onto an already built sheet, never a repaint.
    expect(segment.mesh.material).toBe(materials.light);
  });
});
