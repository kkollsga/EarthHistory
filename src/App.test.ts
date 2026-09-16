import { describe, expect, it } from "vitest";
import { mapKeySummary, mapKeyTimelineHint, type MapKeySummaryState } from "./App";

const ready: MapKeySummaryState = {
  surfaceState: "ready",
  ageMa: 90,
  displayedAgeMa: 90,
  motionPaletteResident: true,
  timelineWarming: "idle",
};

describe("mapKeySummary", () => {
  it("names the age it is waiting for while the foreground surface is pending", () => {
    expect(mapKeySummary({ ...ready, surfaceState: "loading", displayedAgeMa: undefined }))
      .toBe("Loading 90 Ma…");
  });

  it("names both ages while an older pose is still the one on screen", () => {
    expect(mapKeySummary({ ...ready, surfaceState: "loading", ageMa: 0, displayedAgeMa: 90 }))
      .toBe("Loading Today · Showing 90 Ma");
  });

  it("names the payload while the motion palette is the thing missing", () => {
    expect(mapKeySummary({
      ...ready, surfaceState: "loading", motionPaletteResident: false, displayedAgeMa: undefined,
    })).toBe("Loading motion palette…");
  });

  it("states what is drawn once the requested age is on screen", () => {
    expect(mapKeySummary(ready)).toBe("Cao surface");
  });

  // The defect this contract exists for: background checkpoint warming runs for
  // minutes after the map is usable, and the pill used to report it as
  // "90 Ma ready · Loading timeline…".
  it("says nothing about loading while only background warming is left", () => {
    expect(mapKeySummary({ ...ready, timelineWarming: "loading" })).toBe("Cao surface");
    expect(mapKeySummary({ ...ready, timelineWarming: "paused" })).toBe("Cao surface");
    expect(mapKeySummary({ ...ready, timelineWarming: "ready" })).toBe("Cao surface");
  });

  it("names the editorial fallback outside the compiled domain", () => {
    expect(mapKeySummary({ ...ready, surfaceState: "editorial", ageMa: 2500 }))
      .toBe("Editorial surface");
  });

  it("withholds the surface rather than describing one when the load failed", () => {
    expect(mapKeySummary({ ...ready, surfaceState: "error" })).toBe("Surface withheld");
  });
});

describe("mapKeyTimelineHint", () => {
  it("offers background warming as hover text, not as a line", () => {
    expect(mapKeyTimelineHint("loading")).toBe("Timeline data still warming in the background");
    expect(mapKeyTimelineHint("paused"))
      .toBe("Background timeline warming paused; open the map key to retry");
  });

  it("has nothing to say when no warming is outstanding", () => {
    expect(mapKeyTimelineHint("idle")).toBeUndefined();
    expect(mapKeyTimelineHint("ready")).toBeUndefined();
  });
});
