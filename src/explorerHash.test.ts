import { describe, expect, it, vi } from "vitest";
import {
  buildExplorerHash,
  createThrottledHistoryWriter,
  EXPLORER_HASH_SYNC_MIN_INTERVAL_MS,
  serializeAge,
} from "./explorerHash";

describe("explorer hash sync", () => {
  it("serializes ages with stable precision for the URL", () => {
    expect(serializeAge(0)).toBe("0");
    expect(serializeAge(0.42)).toBe("0.42");
    expect(serializeAge(12.345)).toBe("12.35");
    expect(serializeAge(225.67)).toBe("225.7");
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
