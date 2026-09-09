export interface ByteSized {
  byteLength: number;
}

export class BoundedLruCache<T extends ByteSized> {
  readonly maxEntries: number;
  readonly maxBytes: number;
  private readonly entries = new Map<string, T>();
  private bytes = 0;
  private evictionCount = 0;

  constructor(maxEntries = 4, maxBytes = 20 * 1024 * 1024) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get size(): number {
    return this.entries.size;
  }

  get byteLength(): number {
    return this.bytes;
  }

  get evictions(): number {
    return this.evictionCount;
  }

  keys(): IterableIterator<string> {
    return this.entries.keys();
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: T): void {
    if (value.byteLength > this.maxBytes) {
      return;
    }
    const previous = this.entries.get(key);
    if (previous !== undefined) {
      this.bytes -= previous.byteLength;
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    this.bytes += value.byteLength;

    while (
      this.entries.size > this.maxEntries ||
      this.bytes > this.maxBytes
    ) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const removed = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (removed !== undefined) {
        this.bytes -= removed.byteLength;
        this.evictionCount++;
      }
    }
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
    this.evictionCount = 0;
  }
}
