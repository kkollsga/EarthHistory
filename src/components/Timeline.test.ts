import { describe, expect, it } from "vitest";
import { PHANEROZOIC_MAX_MA, pointerClientXToSlider, selectIntervalMarks,
  selectVisibleChapters, sliderToAge, sliderToPointerClientX, ageToSlider,
  timelineSliderPosition } from "./Timeline";
import { CAO_2017_MAP_INTERVAL_MARKS_MA } from "../reconstruction/outlineTones";
import type { TimeSlice } from "../data";

const slices: TimeSlice[] = [
  { id: "a", label: "A", ageMa: 0, period: "Q", eon: "Phanerozoic", description: "", evidence: "observed", sourceIds: [] },
  { id: "b", label: "B", ageMa: 100, period: "K", eon: "Phanerozoic", description: "", evidence: "model-output", sourceIds: [] },
  { id: "c", label: "C", ageMa: 520, period: "C", eon: "Phanerozoic", description: "", evidence: "model-output", sourceIds: [] },
  { id: "d", label: "D", ageMa: 720, period: "Cryogenian", eon: "Proterozoic", description: "", evidence: "synthesis", sourceIds: [] },
  { id: "e", label: "E", ageMa: 2500, period: "Archean", eon: "Archean", description: "", evidence: "unknown", sourceIds: [] },
];

describe("Timeline map-interval marks", () => {
  it("places the 24 Cao 2017 bounds on the Phanerozoic scrubber", () => {
    const marks = selectIntervalMarks(CAO_2017_MAP_INTERVAL_MARKS_MA, 0, PHANEROZOIC_MAX_MA);
    // Every published bound is inside the Phanerozoic range, ascending.
    expect(marks).toHaveLength(24);
    expect(marks[0]).toBe(11);
    expect(marks.at(-1)).toBe(402);
    expect([...marks]).toEqual([...marks].sort((left, right) => left - right));
    // Marks sit where the thumb sits for the same age, on the same mapping.
    const linear = timelineSliderPosition(402, 0, PHANEROZOIC_MAX_MA, true);
    expect(linear).toBeCloseTo((402 / PHANEROZOIC_MAX_MA) * 1000, 9);
    expect(timelineSliderPosition(0, 0, PHANEROZOIC_MAX_MA, true)).toBe(0);
    const nonlinear = timelineSliderPosition(402, 0, 2500, false);
    expect(sliderToAge(nonlinear, 2500)).toBeCloseTo(402, 6);
  });

  it("drops marks outside the visible range instead of clamping them", () => {
    // A clamped mark would pile up on the scrubber's end and read as a map
    // boundary at an age the source publishes no map for.
    expect(selectIntervalMarks(CAO_2017_MAP_INTERVAL_MARKS_MA, 0, 100))
      .toEqual([11, 20, 29, 37, 49, 58, 81, 94]);
    expect(selectIntervalMarks([], 0, PHANEROZOIC_MAX_MA)).toEqual([]);
    // Duplicates and non-finite ages never become marks.
    expect(selectIntervalMarks([94, 94, Number.NaN, 81], 0, 100)).toEqual([81, 94]);
  });
});

describe("Timeline ranges", () => {
  it("exports the ICS Phanerozoic bound used for Precambrian switching", () => {
    expect(PHANEROZOIC_MAX_MA).toBe(538.8);
  });

  it("keeps Phanerozoic chapter picks inside 0–538.8 Ma", () => {
    const visible = selectVisibleChapters(slices, PHANEROZOIC_MAX_MA, 1200, 100, true, 0);
    expect(visible.every((slice) => slice.ageMa <= PHANEROZOIC_MAX_MA)).toBe(true);
    expect(visible.some((slice) => slice.id === "d")).toBe(false);
  });

  it("lets Precambrian range mode include present through deep-time chapters", () => {
    const visible = selectVisibleChapters(slices, 2500, 1200, 720, false, 0);
    expect(visible.some((slice) => slice.id === "a")).toBe(true);
    expect(visible.some((slice) => slice.id === "d" || slice.id === "e")).toBe(true);
    expect(visible.every((slice) => slice.ageMa >= 0 && slice.ageMa <= 2500)).toBe(true);
  });

  it("round-trips nonlinear slider mapping for deep Precambrian spans from today", () => {
    const span = 2500;
    const age = 720;
    const slider = ageToSlider(age, span);
    expect(sliderToAge(slider, span)).toBeCloseTo(age, 6);
    expect(sliderToAge(0, span)).toBeCloseTo(0, 6);
    expect(sliderToAge(1000, span)).toBeCloseTo(span, 6);
  });

  it("maps a touch position across the full slider and clamps outside its hit area", () => {
    expect(pointerClientXToSlider(29.5, 20, 350)).toBe(0);
    expect(pointerClientXToSlider(195, 20, 350)).toBe(500);
    expect(pointerClientXToSlider(360.5, 20, 350)).toBe(1000);
    expect(pointerClientXToSlider(-30, 20, 350)).toBe(0);
    expect(pointerClientXToSlider(420, 20, 350)).toBe(1000);
    expect(pointerClientXToSlider(100, 20, 19)).toBe(0);
  });

  it("round-trips the native thumb centers without an initial-drag jump", () => {
    for (const position of [0, 237.25, 500, 812.75, 1000]) {
      const center = sliderToPointerClientX(position, 20, 350);
      expect(pointerClientXToSlider(center, 20, 350)).toBeCloseTo(position, 9);
    }
  });
});
