import { describe, expect, it } from "vitest";
import { pointOfInterestIncludesAge, pointsOfInterest } from "./points-of-interest";

describe("field-note time intervals", () => {
  it("includes both interval endpoints and excludes adjacent ages", () => {
    const chicxulub = pointsOfInterest.find((poi) => poi.id === "chicxulub");
    expect(chicxulub).toBeDefined();
    expect(pointOfInterestIncludesAge(chicxulub!, 66.086)).toBe(true);
    expect(pointOfInterestIncludesAge(chicxulub!, 66.04)).toBe(true);
    expect(pointOfInterestIncludesAge(chicxulub!, 66.032)).toBe(true);
    expect(pointOfInterestIncludesAge(chicxulub!, 66.087)).toBe(false);
    expect(pointOfInterestIncludesAge(chicxulub!, 66.031)).toBe(false);
  });

  it("rejects non-finite requested ages", () => {
    const poi = pointsOfInterest[0];
    expect(pointOfInterestIncludesAge(poi, Number.NaN)).toBe(false);
    expect(pointOfInterestIncludesAge(poi, Number.POSITIVE_INFINITY)).toBe(false);
  });
});
