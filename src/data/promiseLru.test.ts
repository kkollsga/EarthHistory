import { describe, expect, it } from "vitest";
import { BoundedPromiseCache } from "./promiseLru";

describe("BoundedPromiseCache", () => {
  it("retains only the most recently used entries", async () => {
    const cache = new BoundedPromiseCache<number, number>(2);
    await cache.getOrCreate(1, async () => 1);
    await cache.getOrCreate(2, async () => 2);
    await cache.getOrCreate(1, async () => 10);
    await cache.getOrCreate(3, async () => 3);
    expect(cache.size).toBe(2);
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);
    expect(cache.has(3)).toBe(true);
  });

  it("does not let an evicted rejection remove a newer request for the same key", async () => {
    const cache = new BoundedPromiseCache<string, string>(1);
    let rejectOld!: (reason: Error) => void;
    const old = cache.getOrCreate("age", () => new Promise((_resolve, reject) => {
      rejectOld = reject;
    }));
    await cache.getOrCreate("other", async () => "other");
    const replacement = cache.getOrCreate("age", async () => "replacement");
    rejectOld(new Error("stale failure"));
    await expect(old).rejects.toThrow("stale failure");
    await expect(replacement).resolves.toBe("replacement");
    expect(cache.has("age")).toBe(true);
  });

  it("aborts an evicted in-flight request", async () => {
    const cache = new BoundedPromiseCache<string, string>(1);
    let firstSignal: AbortSignal | undefined;
    const first = cache.getOrCreate("first", (signal) => new Promise((_resolve, reject) => {
      firstSignal = signal;
      signal.addEventListener("abort", () => reject(new DOMException("evicted", "AbortError")));
    }));
    await Promise.resolve();
    await cache.getOrCreate("second", async () => "second");
    expect(firstSignal?.aborted).toBe(true);
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
  });
});
