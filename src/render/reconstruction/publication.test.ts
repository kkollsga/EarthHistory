import { describe, expect, it } from "vitest";
import { AtomicPrototypePublisher, type OwnedPrototypeResources } from "./publication";

class Resource implements OwnedPrototypeResources {
  disposed = false;
  retired = false;

  constructor(
    readonly byteLength: number,
    private readonly retirementError: Error | null = null,
  ) {}

  disposeUnsubmitted(): void {
    if (this.disposed) throw new Error("resource disposed twice");
    this.disposed = true;
  }

  async retireAfterGpuWork(): Promise<void> {
    if (this.retired) throw new Error("resource retired twice");
    this.retired = true;
    if (this.retirementError) throw this.retirementError;
  }
}

describe("AtomicPrototypePublisher", () => {
  it("keeps the coherent visible revision until the latest staged request commits", async () => {
    const publisher = new AtomicPrototypePublisher<Resource>();
    const first = publisher.begin("first");
    const firstResources = new Resource(12);
    expect(publisher.stage(first, 420, "settled", firstResources)).toBe(true);
    expect(publisher.commit(first)?.version).toBe(1);

    const stale = publisher.begin("stale");
    const staleResources = new Resource(15);
    expect(publisher.stage(stale, 421, "preview", staleResources)).toBe(true);
    const latest = publisher.begin("latest");
    expect(staleResources.disposed).toBe(true);
    expect(publisher.current()?.requestId).toBe("first");

    const rejected = new Resource(9);
    expect(publisher.stage(stale, 421, "settled", rejected)).toBe(false);
    expect(rejected.disposed).toBe(true);

    const latestResources = new Resource(20);
    expect(publisher.stage(latest, 422, "settled", latestResources)).toBe(true);
    expect(publisher.retainedBytes()).toBe(32);
    const publication = publisher.commit(latest);
    expect(publication).toMatchObject({ requestId: "latest", version: 2, ageMa: 422 });
    expect(firstResources.retired).toBe(true);
    expect(latestResources.disposed).toBe(false);
    expect(publisher.retainedBytes()).toBe(32);
    await Promise.resolve();
    await Promise.resolve();
    expect(publisher.retainedBytes()).toBe(20);
  });

  it("invalidates outstanding tokens when the publisher is disposed", () => {
    const publisher = new AtomicPrototypePublisher<Resource>();
    const token = publisher.begin("late");
    publisher.dispose();
    const late = new Resource(4);
    expect(publisher.stage(token, 10, "settled", late)).toBe(false);
    expect(late.disposed).toBe(true);
  });

  it("keeps rejected GPU retirement in the byte ledger and exposes the failure", async () => {
    const publisher = new AtomicPrototypePublisher<Resource>();
    const first = publisher.begin("first");
    const failed = new Resource(12, new Error("device lost"));
    publisher.stage(first, 0, "settled", failed);
    publisher.commit(first);
    const second = publisher.begin("second");
    publisher.stage(second, 1, "settled", new Resource(20));
    publisher.commit(second);
    await Promise.resolve();
    await Promise.resolve();
    expect(publisher.retainedBytes()).toBe(32);
    expect(publisher.retirementFailures()).toHaveLength(1);
    expect(publisher.retirementFailures()[0]).toEqual(new Error("device lost"));
  });

  it("rejects invalid resource accounting before staging", () => {
    const publisher = new AtomicPrototypePublisher<Resource>();
    const token = publisher.begin("invalid");
    const resource = new Resource(Number.NaN);
    expect(() => publisher.stage(token, 0, "settled", resource)).toThrow(/byteLength/);
    expect(resource.disposed).toBe(true);
  });

  it("rejects a non-finite publication age before staging", () => {
    const publisher = new AtomicPrototypePublisher<Resource>();
    const token = publisher.begin("invalid-age");
    for (const ageMa of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const resource = new Resource(4);
      expect(() => publisher.stage(token, ageMa, "settled", resource)).toThrow(/ageMa must be finite/);
      expect(resource.disposed).toBe(true);
    }
    expect(publisher.current()).toBeNull();
  });
});
