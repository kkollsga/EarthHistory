import { GpuRetirementOwner, type RetirableGpuResource } from "./gpuRetirement";

export interface ResourceLease<T extends RetirableGpuResource> {
  readonly key: string;
  readonly resource: T;
  release(): void;
}

type PoolState = "active" | "idle" | "retiring";

interface PoolEntry<T extends RetirableGpuResource> {
  readonly key: string;
  readonly resource: T;
  refs: number;
  state: PoolState;
  lastUsed: number;
  retirementError: unknown | null;
}

/** Bounded reference-counted pool; retiring allocations remain in its ledger. */
export class BoundedGpuResourcePool<T extends RetirableGpuResource> {
  private readonly entries = new Map<string, PoolEntry<T>>();
  private clock = 0;
  private lost = false;

  constructor(
    readonly maxEntries: number,
    readonly maxBytes: number,
    private readonly retirementOwner: GpuRetirementOwner,
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1
        || !Number.isFinite(maxBytes) || maxBytes < 1) {
      throw new Error("invalid GPU resource-pool bounds");
    }
  }

  acquire(key: string, reservedBytes: number, create: () => T): ResourceLease<T> {
    if (this.lost) throw new Error("GPU resource pool belongs to a lost device");
    if (!key || !Number.isFinite(reservedBytes) || reservedBytes < 0) {
      throw new Error("GPU resource key and reserved byte cost must be valid");
    }
    let entry = this.entries.get(key);
    if (entry?.state === "retiring") {
      throw new Error("GPU resource remains in fenced retirement");
    }
    if (!entry) {
      if (this.entries.size + 1 > this.maxEntries
          || this.retainedBytes() + reservedBytes > this.maxBytes) {
        throw new Error("GPU resource-pool bound exceeded; retire idle work before retrying");
      }
      const resource = create();
      if (!Number.isFinite(resource.byteLength) || resource.byteLength < 0
          || resource.byteLength > reservedBytes) {
        resource.dispose();
        throw new Error("GPU resource byteLength must be finite, non-negative, and within reservation");
      }
      entry = { key, resource, refs: 0, state: "idle", lastUsed: ++this.clock, retirementError: null };
      this.entries.set(key, entry);
    }
    entry.refs += 1;
    entry.state = "active";
    entry.lastUsed = ++this.clock;
    let released = false;
    return Object.freeze({
      key,
      resource: entry.resource,
      release: () => {
        if (released) throw new Error("GPU resource lease released twice");
        released = true;
        if (this.lost) return;
        const current = this.entries.get(key);
        if (current !== entry || current.refs < 1 || current.state !== "active") {
          throw new Error("GPU resource lease no longer belongs to the pool");
        }
        current.refs -= 1;
        current.lastUsed = ++this.clock;
        if (current.refs === 0) current.state = "idle";
      },
    });
  }

  retireIdle(maxResources = this.maxEntries): readonly Promise<void>[] {
    if (!Number.isInteger(maxResources) || maxResources < 0) {
      throw new Error("invalid idle-retirement limit");
    }
    const idle = [...this.entries.values()]
      .filter((entry) => entry.state === "idle")
      .sort((left, right) => left.lastUsed - right.lastUsed || left.key.localeCompare(right.key))
      .slice(0, maxResources);
    return Object.freeze(idle.map((entry) => {
      entry.state = "retiring";
      const retirement = this.retirementOwner.retire(entry.resource);
      if (!this.retirementOwner.owns(entry.resource)) entry.state = "idle";
      void retirement.then(
        () => { this.entries.delete(entry.key); },
        (error: unknown) => {
          if (this.retirementOwner.owns(entry.resource)) entry.retirementError = error;
        },
      );
      return retirement;
    }));
  }

  retainedBytes(): number {
    let bytes = 0;
    for (const entry of this.entries.values()) bytes += entry.resource.byteLength;
    return bytes;
  }

  activeBytes(): number {
    let bytes = 0;
    for (const entry of this.entries.values()) if (entry.state === "active") bytes += entry.resource.byteLength;
    return bytes;
  }

  entryCount(): number {
    return this.entries.size;
  }

  failures(): readonly unknown[] {
    return Object.freeze([...this.entries.values()]
      .map((entry) => entry.retirementError)
      .filter((error): error is unknown => error !== null));
  }

  /** Releases every allocation only after the backend confirms device/context loss. */
  releaseConfirmedLostDevice(): void {
    if (this.lost) return;
    this.lost = true;
    const ownedByRetirement = new Set(
      [...this.entries.values()]
        .filter((entry) => this.retirementOwner.owns(entry.resource))
        .map((entry) => entry.resource),
    );
    this.retirementOwner.releaseConfirmedLostDevice();
    for (const entry of this.entries.values()) {
      if (!ownedByRetirement.has(entry.resource)) entry.resource.dispose();
    }
    this.entries.clear();
  }
}
