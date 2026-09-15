import { describe, expect, it } from "vitest";
import {
  PALAEO_DETACHED_LIMITATIONS,
  PALAEO_INTERVAL_LIMITATION,
  PALAEO_LAKE_CLASS_LIMITATION,
  PALAEO_LGM_DATUM_LIMITATION,
  PALAEO_MAP_INTERVAL_LIMITATIONS,
  PALAEO_SHALLOW_SEA_LIMITATION,
} from "./palaeoKeyText";

describe("palaeo-coastline map key limitations", () => {
  it("keeps the map-interval list to the three class limitations the key shows", () => {
    // The panel is compact and the list competes with the outline legend below
    // it, so a fourth line here is a deliberate decision, not a drift.
    expect(PALAEO_MAP_INTERVAL_LIMITATIONS).toEqual([
      PALAEO_INTERVAL_LIMITATION,
      PALAEO_SHALLOW_SEA_LIMITATION,
      PALAEO_LAKE_CLASS_LIMITATION,
    ]);
    expect(PALAEO_DETACHED_LIMITATIONS).toEqual([PALAEO_LGM_DATUM_LIMITATION]);
  });

  it("states that a map interval is a bin and not a shoreline at one moment", () => {
    // The browser key test reads this phrase off the panel; a rewrite that drops
    // it takes the D1 limitation off screen.
    expect(PALAEO_INTERVAL_LIMITATION)
      .toContain("minimum land / maximum flooding recorded anywhere in that bin");
    expect(PALAEO_INTERVAL_LIMITATION).toContain("10–27 Myr");
  });

  it("separates the shallow-sea environment class from water depth", () => {
    expect(PALAEO_SHALLOW_SEA_LIMITATION).toContain("environment class");
    expect(PALAEO_SHALLOW_SEA_LIMITATION).toMatch(/deep basin can\s+render as shallow sea/);
  });

  it("names the isolated basins that have no lake or brackish class to render in", () => {
    expect(PALAEO_LAKE_CLASS_LIMITATION).toContain("No lake or brackish class");
    for (const basin of ["Lake Pannon", "Caspian", "Sunda rift lakes"]) {
      expect(PALAEO_LAKE_CLASS_LIMITATION).toContain(basin);
    }
    expect(PALAEO_LAKE_CLASS_LIMITATION).toMatch(/shallow sea or land/);
  });

  it("keeps the Last Glacial Maximum datum and its uncorrected surface on one line", () => {
    expect(PALAEO_LGM_DATUM_LIMITATION).toContain("−120 m");
    expect(PALAEO_LGM_DATUM_LIMITATION).toContain("glacio-isostatic adjustment");
    expect(PALAEO_LGM_DATUM_LIMITATION).toContain("post-glacial sediment");
  });

  it("keeps every line short enough for the compact key", () => {
    for (const line of [...PALAEO_MAP_INTERVAL_LIMITATIONS, ...PALAEO_DETACHED_LIMITATIONS]) {
      expect(line.length).toBeLessThanOrEqual(180);
      expect(line.endsWith(".")).toBe(true);
    }
  });
});
