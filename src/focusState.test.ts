import { describe, expect, it } from "vitest";
import {
  parseAreaFocusDescriptor,
  parseFocusCoordinates,
  serializeAreaFocusDescriptor,
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

  it("round-trips a compact identity-aware temporal anchor", () => {
    const descriptor = {
      version: 1 as const,
      catalogId: "countries-v1",
      plateModelId: "model/3",
      referenceFrameId: "mantle frame",
      featureId: "feature:42",
      partId: 19,
      alongMeasure: 0.523456789,
      offsetRadians: [0.012345678, -0.023456789] as [number, number],
    };
    const encoded = serializeAreaFocusDescriptor(descriptor);
    expect(encoded).toContain("model%2F3");
    expect(parseAreaFocusDescriptor(encoded)).toEqual({
      ...descriptor,
      alongMeasure: 0.5234568,
      offsetRadians: [0.0123457, -0.0234568],
    });
  });

  it("rejects malformed temporal anchors", () => {
    for (const value of [
      null,
      "",
      "2~a~b~c~d~0~0.5~0~0",
      "1~a~b~c~d~-1~0.5~0~0",
      "1~a~b~c~d~0~2~0~0",
      "1~%E0%A4%A~b~c~d~0~0.5~0~0",
    ]) expect(parseAreaFocusDescriptor(value), String(value)).toBeNull();
  });
});
