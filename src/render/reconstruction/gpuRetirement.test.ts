import { describe, expect, it, vi } from "vitest";
import {
  GpuRetirementOwner,
  WebGl2SubmissionFence,
  WebGpuSubmissionFence,
  type GpuSubmissionFence,
} from "./gpuRetirement";

class DeferredFence implements GpuSubmissionFence {
  resolve!: () => void;
  reject!: (error: unknown) => void;
  waitForSubmittedWork(): Promise<void> {
    return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
  }
}

const resource = (bytes: number) => ({ byteLength: bytes, dispose: vi.fn() });

describe("GPU retirement ownership", () => {
  it("keeps resources accounted until the real WebGPU queue fence resolves", async () => {
    const queue = { onSubmittedWorkDone: vi.fn<() => Promise<void>>() };
    let complete!: () => void;
    queue.onSubmittedWorkDone.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const owner = new GpuRetirementOwner(new WebGpuSubmissionFence(queue), 2, 32);
    const held = resource(12);
    const retired = owner.retire(held);
    expect(owner.pendingBytes()).toBe(12);
    expect(held.dispose).not.toHaveBeenCalled();
    complete();
    await retired;
    expect(held.dispose).toHaveBeenCalledOnce();
    expect(owner.pendingBytes()).toBe(0);
  });

  it("uses nonblocking WebGL fence polling and reports WAIT_FAILED", async () => {
    const callbacks: Array<() => void> = [];
    const sync = {} as WebGLSync;
    const gl = {
      SYNC_GPU_COMMANDS_COMPLETE: 0x9117 as const,
      ALREADY_SIGNALED: 0x911a as const,
      CONDITION_SATISFIED: 0x911c as const,
      WAIT_FAILED: 0x911d as const,
      fenceSync: vi.fn(() => sync),
      flush: vi.fn(),
      clientWaitSync: vi.fn(() => 0),
      deleteSync: vi.fn(),
    };
    const fence = new WebGl2SubmissionFence(
      gl,
      (callback) => { callbacks.push(callback); return 1 as unknown as ReturnType<typeof setTimeout>; },
      () => undefined,
    );
    const pending = fence.waitForSubmittedWork();
    expect(gl.clientWaitSync).not.toHaveBeenCalled();
    callbacks.shift()!();
    expect(callbacks).toHaveLength(1);
    gl.clientWaitSync.mockReturnValue(gl.CONDITION_SATISFIED);
    callbacks.shift()!();
    await pending;
    expect(gl.deleteSync).toHaveBeenCalledWith(sync);

    gl.clientWaitSync.mockReturnValue(gl.WAIT_FAILED);
    const failed = fence.waitForSubmittedWork();
    callbacks.shift()!();
    await expect(failed).rejects.toThrow(/fence failed/);
  });

  it("applies backpressure and retains failed fences until confirmed device loss", async () => {
    const fence = new DeferredFence();
    const owner = new GpuRetirementOwner(fence, 1, 16);
    const held = resource(12);
    const failure = owner.retire(held);
    const rejected = resource(8);
    await expect(owner.retire(rejected)).rejects.toThrow(/backpressure/);
    expect(rejected.dispose).not.toHaveBeenCalled();
    fence.reject(new Error("device lost"));
    await expect(failure).rejects.toThrow(/device lost/);
    expect(owner.pendingBytes()).toBe(12);
    expect(owner.failures()).toHaveLength(1);
    owner.releaseConfirmedLostDevice();
    expect(held.dispose).toHaveBeenCalledOnce();
    expect(owner.pendingBytes()).toBe(0);
  });

  it("accounts a fence that throws synchronously", async () => {
    const owner = new GpuRetirementOwner({
      waitForSubmittedWork: () => { throw new Error("backend unavailable"); },
    }, 1, 16);
    const held = resource(12);
    await expect(owner.retire(held)).rejects.toThrow(/backend unavailable/);
    expect(owner.pendingBytes()).toBe(12);
    expect(owner.failures()).toHaveLength(1);
    expect(held.dispose).not.toHaveBeenCalled();
  });
});
