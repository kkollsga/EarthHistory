import { describe, expect, it, vi } from "vitest";
import { GpuRetirementOwner, type GpuSubmissionFence } from "./gpuRetirement";
import { BoundedGpuResourcePool } from "./resourcePool";

class Fence implements GpuSubmissionFence {
  readonly resolvers: Array<() => void> = [];
  waitForSubmittedWork(): Promise<void> {
    return new Promise((resolve) => this.resolvers.push(resolve));
  }
}

const resource = (bytes: number) => ({ byteLength: bytes, dispose: vi.fn() });

describe("bounded GPU resource pool", () => {
  it("shares keyed resources and rejects double release", () => {
    const fence = new Fence();
    const pool = new BoundedGpuResourcePool(2, 32, new GpuRetirementOwner(fence, 2, 32));
    const created = resource(12);
    const first = pool.acquire("mesh", 12, () => created);
    const second = pool.acquire("mesh", 12, () => { throw new Error("must reuse"); });
    expect(first.resource).toBe(second.resource);
    expect(pool.activeBytes()).toBe(12);
    first.release();
    second.release();
    expect(pool.activeBytes()).toBe(0);
    expect(() => second.release()).toThrow(/twice/);
  });

  it("keeps retiring allocations in the cap until the fence completes", async () => {
    const fence = new Fence();
    const owner = new GpuRetirementOwner(fence, 2, 32);
    const pool = new BoundedGpuResourcePool(2, 20, owner);
    const first = pool.acquire("first", 12, () => resource(12));
    first.release();
    const [retired] = pool.retireIdle(1);
    expect(pool.retainedBytes()).toBe(12);
    expect(() => pool.acquire("second", 12, () => resource(12))).toThrow(/bound exceeded/);
    fence.resolvers.shift()!();
    await retired;
    await Promise.resolve();
    expect(pool.retainedBytes()).toBe(0);
    const second = pool.acquire("second", 12, () => resource(12));
    second.release();
  });

  it("uses confirmed device loss as the only terminal escape from stalled fences", () => {
    const fence = new Fence();
    const owner = new GpuRetirementOwner(fence, 2, 32);
    const pool = new BoundedGpuResourcePool(2, 32, owner);
    const value = resource(12);
    const lease = pool.acquire("mesh", 12, () => value);
    lease.release();
    pool.retireIdle();
    pool.releaseConfirmedLostDevice();
    expect(value.dispose).toHaveBeenCalledOnce();
    expect(pool.retainedBytes()).toBe(0);
    expect(() => pool.acquire("next", 1, () => resource(1))).toThrow(/lost device/);
  });

  it("reserves before allocation and retries an idle entry rejected by retirement backpressure", async () => {
    const fence = new Fence();
    const owner = new GpuRetirementOwner(fence, 1, 32);
    const pool = new BoundedGpuResourcePool(2, 32, owner);
    const created = vi.fn(() => resource(12));
    expect(() => pool.acquire("oversized", 40, created)).toThrow(/bound exceeded/);
    expect(created).not.toHaveBeenCalled();
    const invalid = resource(13);
    expect(() => pool.acquire("under-reserved", 12, () => invalid)).toThrow(/within reservation/);
    expect(invalid.dispose).toHaveBeenCalledOnce();

    const first = pool.acquire("first", 12, () => resource(12));
    const second = pool.acquire("second", 12, () => resource(12));
    first.release(); second.release();
    const attempts = pool.retireIdle();
    await expect(attempts[1]).rejects.toThrow(/backpressure/);
    expect(pool.entryCount()).toBe(2);
    fence.resolvers.shift()!();
    await attempts[0]; await Promise.resolve();
    const retry = pool.retireIdle();
    expect(retry).toHaveLength(1);
    fence.resolvers.shift()!();
    await retry[0]; await Promise.resolve();
    expect(pool.entryCount()).toBe(0);
  });
});
