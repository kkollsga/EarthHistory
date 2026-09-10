/**
 * Explorer URL hash helpers. Continuous age scrub must not call
 * history.replaceState on every tick — Chromium throttles navigation IPC and
 * the tab can hang (crbug.com/1038223). React state still updates every frame;
 * hash sync is coalesced here.
 */

export const EXPLORER_HASH_SYNC_MIN_INTERVAL_MS = 250;

export function serializeAge(ageMa: number): string {
  const precision = ageMa < 1 ? 3 : ageMa < 100 ? 2 : 1;
  return String(Number(ageMa.toFixed(precision)));
}

export function buildExplorerHash(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `#${query}` : "#";
}

export interface ThrottledHistoryWriter {
  /** Schedule a replaceState; coalesces to at most one write per minIntervalMs. */
  schedule(url: string): void;
  /** Write any pending URL immediately (e.g. effect cleanup / page hide). */
  flush(): void;
  dispose(): void;
}

export interface ThrottledHistoryWriterOptions {
  readonly minIntervalMs?: number;
  readonly now?: () => number;
  readonly replaceState?: (url: string) => void;
  readonly currentUrl?: () => string;
  readonly setTimeout?: (handler: () => void, delay: number) => number;
  readonly clearTimeout?: (id: number) => void;
}

/**
 * Coalesces history.replaceState calls so continuous scrub/play cannot flood
 * the browser navigation pipeline. Leading write when the interval has elapsed;
 * trailing write retains the latest URL.
 */
export function createThrottledHistoryWriter(
  options: ThrottledHistoryWriterOptions = {},
): ThrottledHistoryWriter {
  const minIntervalMs = options.minIntervalMs ?? EXPLORER_HASH_SYNC_MIN_INTERVAL_MS;
  if (!Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
    throw new Error("invalid explorer hash sync interval");
  }
  const now = options.now ?? (() => performance.now());
  const replaceState = options.replaceState ?? ((url: string) => {
    window.history.replaceState(null, "", url);
  });
  const currentUrl = options.currentUrl ?? (() =>
    `${window.location.pathname}${window.location.search}${window.location.hash}`);
  const scheduleTimeout = options.setTimeout ?? ((handler, delay) =>
    window.setTimeout(handler, delay));
  const cancelTimeout = options.clearTimeout ?? ((id) => window.clearTimeout(id));

  let timer: number | null = null;
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let pending: string | null = null;
  let disposed = false;

  const write = (url: string) => {
    if (url === currentUrl()) return;
    replaceState(url);
    lastWriteAt = now();
  };

  const flushPending = () => {
    if (pending === null) return;
    const url = pending;
    pending = null;
    write(url);
  };

  return {
    schedule(url: string) {
      if (disposed) return;
      pending = url;
      const elapsed = now() - lastWriteAt;
      if (elapsed >= minIntervalMs) {
        if (timer !== null) {
          cancelTimeout(timer);
          timer = null;
        }
        flushPending();
        return;
      }
      if (timer !== null) return;
      timer = scheduleTimeout(() => {
        timer = null;
        flushPending();
      }, minIntervalMs - elapsed);
    },
    flush() {
      if (timer !== null) {
        cancelTimeout(timer);
        timer = null;
      }
      flushPending();
    },
    dispose() {
      disposed = true;
      if (timer !== null) {
        cancelTimeout(timer);
        timer = null;
      }
      flushPending();
    },
  };
}
