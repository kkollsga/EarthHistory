export class BoundedPromiseCache<K, V> {
  readonly maxEntries: number;
  private readonly entries = new Map<K, { promise: Promise<V>; controller: AbortController }>();

  constructor(maxEntries: number) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("maxEntries must be a positive integer");
    }
    this.maxEntries = maxEntries;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: K): boolean {
    return this.entries.has(key);
  }

  getOrCreate(key: K, load: (signal: AbortSignal) => Promise<V>): Promise<V> {
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, cached);
      return cached.promise;
    }

    const controller = new AbortController();
    let entry: { promise: Promise<V>; controller: AbortController };
    let pending: Promise<V>;
    pending = Promise.resolve().then(() => load(controller.signal)).catch((error: unknown) => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    });
    entry = { promise: pending, controller };
    this.entries.set(key, entry);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.entries.get(oldest)?.controller.abort();
      this.entries.delete(oldest);
    }
    return pending;
  }
}
