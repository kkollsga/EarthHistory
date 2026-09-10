export interface RetirableGpuResource {
  readonly byteLength: number;
  dispose(): void;
}

export interface GpuSubmissionFence {
  waitForSubmittedWork(): Promise<void>;
}

export class WebGpuSubmissionFence implements GpuSubmissionFence {
  constructor(private readonly queue: { onSubmittedWorkDone(): Promise<void> }) {}

  waitForSubmittedWork(): Promise<void> {
    return this.queue.onSubmittedWorkDone();
  }
}

type PollHandle = ReturnType<typeof setTimeout>;

/** Uses a real GL fence and zero-timeout polling; it never blocks the UI thread. */
export class WebGl2SubmissionFence implements GpuSubmissionFence {
  constructor(
    private readonly gl: Pick<WebGL2RenderingContext,
      "fenceSync" | "flush" | "clientWaitSync" | "deleteSync"
      | "SYNC_GPU_COMMANDS_COMPLETE" | "ALREADY_SIGNALED" | "CONDITION_SATISFIED" | "WAIT_FAILED">,
    private readonly schedule: (callback: () => void) => PollHandle = (callback) => setTimeout(callback, 0),
    private readonly cancel: (handle: PollHandle) => void = clearTimeout,
  ) {}

  waitForSubmittedWork(): Promise<void> {
    const sync = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!sync) return Promise.reject(new Error("WebGL2 fenceSync returned null"));
    this.gl.flush();
    return new Promise((resolve, reject) => {
      let handle: PollHandle | null = null;
      const finish = (error?: Error): void => {
        if (handle !== null) this.cancel(handle);
        this.gl.deleteSync(sync);
        if (error) reject(error); else resolve();
      };
      const poll = (): void => {
        handle = null;
        const status = this.gl.clientWaitSync(sync, 0, 0);
        if (status === this.gl.ALREADY_SIGNALED || status === this.gl.CONDITION_SATISFIED) {
          finish();
        } else if (status === this.gl.WAIT_FAILED) {
          finish(new Error("WebGL2 submitted-work fence failed"));
        } else {
          handle = this.schedule(poll);
        }
      };
      handle = this.schedule(poll);
    });
  }
}

interface RetirementEntry {
  readonly resource: RetirableGpuResource;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
  error: unknown | null;
}

/** Bounded owner for resources submitted before a publication swap. */
export class GpuRetirementOwner {
  private readonly pending = new Map<RetirableGpuResource, RetirementEntry>();
  private lost = false;

  constructor(
    private readonly fence: GpuSubmissionFence,
    readonly maxPendingResources: number,
    readonly maxPendingBytes: number,
  ) {
    if (!Number.isInteger(maxPendingResources) || maxPendingResources < 1
        || !Number.isFinite(maxPendingBytes) || maxPendingBytes < 1) {
      throw new Error("invalid GPU retirement bounds");
    }
  }

  retire(resource: RetirableGpuResource): Promise<void> {
    if (this.lost) {
      resource.dispose();
      return Promise.resolve();
    }
    if (!Number.isFinite(resource.byteLength) || resource.byteLength < 0
        || this.pending.has(resource)) {
      return Promise.reject(new Error("invalid or duplicate GPU retirement resource"));
    }
    if (this.pending.size + 1 > this.maxPendingResources
        || this.pendingBytes() + resource.byteLength > this.maxPendingBytes) {
      return Promise.reject(new Error("GPU retirement backpressure bound exceeded"));
    }
    let resolveEntry!: () => void;
    let rejectEntry!: (error: unknown) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });
    const entry: RetirementEntry = {
      resource,
      promise,
      resolve: resolveEntry,
      reject: rejectEntry,
      error: null,
    };
    this.pending.set(resource, entry);
    let submitted: Promise<void>;
    try {
      submitted = this.fence.waitForSubmittedWork();
    } catch (error) {
      entry.error = error;
      entry.reject(error);
      return promise;
    }
    void submitted.then(
      () => this.complete(entry),
      (error: unknown) => {
        if (!this.pending.has(resource)) return;
        entry.error = error;
        entry.reject(error);
      },
    );
    return promise;
  }

  pendingBytes(): number {
    let bytes = 0;
    for (const entry of this.pending.values()) bytes += entry.resource.byteLength;
    return bytes;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  failures(): readonly unknown[] {
    return Object.freeze([...this.pending.values()]
      .map((entry) => entry.error)
      .filter((error): error is unknown => error !== null));
  }

  owns(resource: RetirableGpuResource): boolean {
    return this.pending.has(resource);
  }

  /** Terminal contract: call only after the backend has confirmed device/context loss. */
  releaseConfirmedLostDevice(): void {
    this.lost = true;
    for (const entry of [...this.pending.values()]) this.complete(entry);
  }

  private complete(entry: RetirementEntry): void {
    if (!this.pending.delete(entry.resource)) return;
    entry.resource.dispose();
    entry.resolve();
  }
}
