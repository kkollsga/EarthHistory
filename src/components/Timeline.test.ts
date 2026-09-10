import { describe, expect, it } from "vitest";
import { PHANEROZOIC_MAX_MA, selectVisibleChapters, sliderToAge, ageToSlider } from "./Timeline";
import type { TimeSlice } from "../data";

const slices: TimeSlice[] = [
  { id: "a", label: "A", ageMa: 0, period: "Q", eon: "Phanerozoic", description: "", evidence: "observed", sourceIds: [] },
  { id: "b", label: "B", ageMa: 100, period: "K", eon: "Phanerozoic", description: "", evidence: "model-output", sourceIds: [] },
  { id: "c", label: "C", ageMa: 520, period: "C", eon: "Phanerozoic", description: "", evidence: "model-output", sourceIds: [] },
  { id: "d", label: "D", ageMa: 720, period: "Cryogenian", eon: "Proterozoic", description: "", evidence: "synthesis", sourceIds: [] },
  { id: "e", label: "E", ageMa: 2500, period: "Archean", eon: "Archean", description: "", evidence: "unknown", sourceIds: [] },
];

describe("Timeline ranges", () => {
  it("exports the ICS Phanerozoic bound used for Precambrian switching", () => {
    expect(PHANEROZOIC_MAX_MA).toBe(538.8);
  });

  it("keeps Phanerozoic chapter picks inside 0–538.8 Ma", () => {
    const visible = selectVisibleChapters(slices, PHANEROZOIC_MAX_MA, 1200, 100, true, 0);
    expect(visible.every((slice) => slice.ageMa <= PHANEROZOIC_MAX_MA)).toBe(true);
    expect(visible.some((slice) => slice.id === "d")).toBe(false);
  });

  it("keeps Precambrian chapter picks at or older than the Phanerozoic bound", () => {
    const visible = selectVisibleChapters(slices, 2500, 1200, 720, false, PHANEROZOIC_MAX_MA);
    expect(visible.every((slice) => slice.ageMa >= PHANEROZOIC_MAX_MA - 1e-9)).toBe(true);
    expect(visible.some((slice) => slice.id === "a")).toBe(false);
  });

  it("round-trips nonlinear slider mapping for deep Precambrian spans", () => {
    const span = 2500 - PHANEROZOIC_MAX_MA;
    const age = 720 - PHANEROZOIC_MAX_MA;
    const slider = ageToSlider(age, span);
    expect(sliderToAge(slider, span)).toBeCloseTo(age, 6);
  });
});
