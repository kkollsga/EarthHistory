import { describe, expect, it } from "vitest";
import { BoundedLruCache } from "./cache";

describe("BoundedLruCache", () => {
  it("evicts least-recently-used values under its byte bound", () => {
    const cache = new BoundedLruCache<{ byteLength: number; value: string }>(3, 10);
    cache.set("a", { byteLength: 4, value: "a" });
    cache.set("b", { byteLength: 4, value: "b" });
    expect(cache.get("a")?.value).toBe("a");
    cache.set("c", { byteLength: 4, value: "c" });
    expect(cache.get("b")).toBeUndefined();
    expect(cache.byteLength).toBe(8);
  });

  it("declines an item that cannot fit by itself", () => {
    const cache = new BoundedLruCache<{ byteLength: number }>(4, 10);
    cache.set("oversized", { byteLength: 11 });
    expect(cache.size).toBe(0);
    expect(cache.byteLength).toBe(0);
  });
});
