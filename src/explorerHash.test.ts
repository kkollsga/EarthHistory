import { describe, expect, it, vi } from "vitest";
import {
  buildExplorerHash,
  createThrottledHistoryWriter,
  EXPLORER_HASH_SYNC_MIN_INTERVAL_MS,
  parseLayerVisibility,
  serializeAge,
} from "./explorerHash";
import type { LayerVisibility } from "./data";

const DEFAULT_LAYERS: LayerVisibility = {
  clouds: false, borders: true, guides: true, tectonics: false, rivers: false,
  palaeoCoastlines: false,
};

describe("explorer hash sync", () => {
  it("serializes ages with stable precision for the URL", () => {
    expect(serializeAge(0)).toBe("0");
    expect(serializeAge(0.42)).toBe("0.42");
    expect(serializeAge(12.345)).toBe("12.35");
    expect(serializeAge(225.67)).toBe("225.7");
  });

  it("round-trips the layer set, and reads a link written before a layer existed", () => {
    // A link shared before the palaeo-coastline mode existed names the layers
    // that were on then. The new layer must read off: a default applied to an
    // unnamed key would switch a whole rendering mode on in someone else's link.
    const oldLink = parseLayerVisibility("borders,guides", DEFAULT_LAYERS);
    expect(oldLink.palaeoCoastlines).toBe(false);
    expect(oldLink).toEqual({ ...DEFAULT_LAYERS, borders: true, guides: true });

    // And the layer round-trips once a link does name it.
    const layers: LayerVisibility = { ...DEFAULT_LAYERS, palaeoCoastlines: true };
    const serialized = Object.entries(layers)
      .filter(([, visible]) => visible).map(([key]) => key).join(",");
    expect(serialized).toBe("borders,guides,palaeoCoastlines");
    expect(parseLayerVisibility(serialized, DEFAULT_LAYERS)).toEqual(layers);

    // An empty parameter is every layer off, which is a state the app writes;
    // an absent parameter is a different thing and keeps the defaults.
    expect(parseLayerVisibility("", DEFAULT_LAYERS)).toEqual({
      clouds: false, borders: false, guides: false, tectonics: false, rivers: false,
      palaeoCoastlines: false,
    });
    expect(parseLayerVisibility(null, DEFAULT_LAYERS)).toEqual(DEFAULT_LAYERS);
    // An unknown key in a link from a newer build is ignored, not carried.
    expect(parseLayerVisibility("borders,someFutureLayer", DEFAULT_LAYERS))
      .toEqual({ ...DEFAULT_LAYERS, borders: true, guides: false });
  });

  it("builds a hash fragment from search params", () => {
    const params = new URLSearchParams({ age: "100", coordinates: "cao" });
    expect(buildExplorerHash(params)).toBe("#age=100&coordinates=cao");
    expect(buildExplorerHash(new URLSearchParams())).toBe("#");
  });

  it("coalesces replaceState so continuous scrub cannot flood navigation", () => {
    const writes: string[] = [];
    let current = "/EarthHistory/#age=0";
    let clock = 0;
    const timers = new Map<number, { fireAt: number; handler: () => void }>();
    let nextTimerId = 1;

    const writer = createThrottledHistoryWriter({
      minIntervalMs: EXPLORER_HASH_SYNC_MIN_INTERVAL_MS,
      now: () => clock,
      currentUrl: () => current,
      replaceState: (url) => {
        writes.push(url);
        current = url;
      },
      setTimeout: (handler, delay) => {
        const id = nextTimerId++;
        timers.set(id, { fireAt: clock + delay, handler });
        return id;
      },
      clearTimeout: (id) => {
        timers.delete(id);
      },
    });

    const fireDue = () => {
      for (const [id, timer] of [...timers.entries()]) {
        if (timer.fireAt <= clock) {
          timers.delete(id);
          timer.handler();
        }
      }
    };

    // Rapid scrub ticks within one interval → one leading write, rest coalesce.
    writer.schedule("/EarthHistory/#age=1");
    expect(writes).toEqual(["/EarthHistory/#age=1"]);
    writer.schedule("/EarthHistory/#age=2");
    writer.schedule("/EarthHistory/#age=3");
    expect(writes).toEqual(["/EarthHistory/#age=1"]);

    clock = EXPLORER_HASH_SYNC_MIN_INTERVAL_MS;
    fireDue();
    expect(writes).toEqual(["/EarthHistory/#age=1", "/EarthHistory/#age=3"]);

    // Unchanged URL must not emit another replaceState.
    writer.schedule("/EarthHistory/#age=3");
    expect(writes).toHaveLength(2);

    // Dispose flushes the latest pending age for shareable URLs.
    clock += 10;
    writer.schedule("/EarthHistory/#age=4");
    expect(writes).toHaveLength(2);
    writer.dispose();
    expect(writes.at(-1)).toBe("/EarthHistory/#age=4");
    writer.schedule("/EarthHistory/#age=5");
    expect(writes.at(-1)).toBe("/EarthHistory/#age=4");
  });

  it("rejects a negative sync interval", () => {
    expect(() => createThrottledHistoryWriter({ minIntervalMs: -1 })).toThrow(/interval/);
  });
});
