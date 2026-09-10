import { describe, expect, it } from "vitest";
import {
  parseFocusCoordinates,
  parseMaterialAddress,
  serializeMaterialAddress,
  serializeFocusCoordinates,
} from "./focusState";

describe("focus coordinate URLs", () => {
  it("parses finite coordinates within geographic bounds", () => {
    expect(parseFocusCoordinates("-69.3,-23.5")).toEqual([-69.3, -23.5]);
    expect(parseFocusCoordinates("180,90")).toEqual([180, 90]);
    expect(parseFocusCoordinates("-180,-90")).toEqual([-180, -90]);
  });

  it("rejects malformed and out-of-range coordinates", () => {
    for (const value of [null, "", "12", "1,2,3", "east,2", "181,0", "0,-91"]) {
      expect(parseFocusCoordinates(value), String(value)).toBeNull();
    }
  });

  it("serializes a stable bounded-precision coordinate pair", () => {
    expect(serializeFocusCoordinates([-69.30004, -23.50006])).toBe("-69.3,-23.5001");
  });

  it("round-trips a continuous source-qualified material address", () => {
    const address = { chartRevision: "cao-v1", chartId: "chart:1", materialId: "material:1",
      fragmentOrCohortId: "fragment:1", cellOrTriangleId: 0, localCoordinate: {
        kind: "chart-direction" as const, directionAtReference: [0.6, 0, 0.8] as const,
      } };
    expect(parseMaterialAddress(serializeMaterialAddress(address))).toEqual(address);
    expect(parseMaterialAddress(JSON.stringify({ ...address, localCoordinate: {
      kind: "chart-direction", directionAtReference: [0, 0, 0],
    } }))).toBeNull();
  });
});
