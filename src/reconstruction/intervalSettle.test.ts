import { describe, expect, it } from "vitest";
import {
  createSettleTimer,
  decideIntervalRequest,
  PALAEO_INTERVAL_SETTLE_MS,
  type IntervalRequestReason,
  type SettleScheduler,
} from "./intervalSettle";

/**
 * Five 10 Ma maps, oldest first, the way the published schedule is ordered.
 * Only the index identity matters to the decision, so a synthetic table keeps
 * the policy tests independent of the Cao 2017 interval boundaries.
 */
const INTERVAL_COUNT = 5;
const OLDEST_MA = 50;
const INTERVAL_SPAN_MA = 10;

function intervalIndexFor(ageMa: number): number {
  if (ageMa > OLDEST_MA || ageMa < 0) return -1;
  return Math.min(INTERVAL_COUNT - 1,
    Math.floor((OLDEST_MA - ageMa) / INTERVAL_SPAN_MA));
}

interface Sample {
  readonly ageMa: number;
  readonly atMs: number;
}

interface PumpResult {
  /** Every interval index the pump asked for, in order. */
  readonly requested: readonly number[];
  readonly reasons: readonly IntervalRequestReason[];
}

/**
 * The pump loop the App owns, in miniature: a decision per age sample, a
 * single-slot settle timer fired at its due time, and a publication that lands
 * at once so the next sample inside the same map is satisfied rather than
 * requested again.
 */
function runPump(
  samples: readonly Sample[],
  options: { readonly preparedIntervalIndex: number; readonly resident?: ReadonlySet<number> } ,
): PumpResult {
  const resident = options.resident ?? new Set<number>();
  const requested: number[] = [];
  const reasons: IntervalRequestReason[] = [];
  let preparedIntervalIndex = options.preparedIntervalIndex;
  let lastAgeMa = samples[0]?.ageMa ?? 0;
  let lastAgeAtMs = Number.NEGATIVE_INFINITY;
  let liveAgeMa = lastAgeMa;
  let settleDueAtMs: number | null = null;

  const evaluate = (nowMs: number, ageMa: number): void => {
    const decision = decideIntervalRequest({
      nowMs,
      ageMa,
      lastAgeMa,
      lastAgeAtMs,
      currentIntervalIndex: intervalIndexFor(ageMa),
      preparedIntervalIndex,
      isPrepared: (index) => resident.has(index),
    });
    if (decision.kind === "hold") {
      settleDueAtMs = nowMs + decision.settleInMs;
      return;
    }
    settleDueAtMs = null;
    if (decision.kind !== "request") return;
    requested.push(decision.index);
    reasons.push(decision.reason);
    preparedIntervalIndex = decision.index;
  };

  for (const sample of samples) {
    if (settleDueAtMs !== null && settleDueAtMs <= sample.atMs) {
      evaluate(settleDueAtMs, liveAgeMa);
    }
    evaluate(sample.atMs, sample.ageMa);
    lastAgeMa = sample.ageMa;
    lastAgeAtMs = sample.atMs;
    liveAgeMa = sample.ageMa;
  }
  if (settleDueAtMs !== null) evaluate(settleDueAtMs, liveAgeMa);
  return { requested, reasons };
}

function sweep(
  from: number, stepMa: number, stepMs: number, count: number, startMs = 0,
): Sample[] {
  return Array.from({ length: count }, (unused, step) => ({
    ageMa: from - stepMa * step,
    atMs: startMs + stepMs * step,
  }));
}

describe("decideIntervalRequest", () => {
  // The defect: every map a fast scrub passed through was fetched,
  // triangulated and published, then discarded by the next crossing.
  it("requests only the map the fast scrub settles in, not the four it sweeps", () => {
    // 6 Ma every 16 ms: 0.375 Ma/ms, ten times the slow-scrub threshold.
    const samples = sweep(50, 6, 16, 8);
    expect(samples.map((sample) => intervalIndexFor(sample.ageMa)))
      .toEqual([0, 0, 1, 1, 2, 3, 3, 4]);
    const { requested, reasons } = runPump(samples, { preparedIntervalIndex: 0 });
    expect(requested).toEqual([4]);
    expect(reasons).toEqual(["settled"]);
  });

  it("requests every map a slow scrub crosses", () => {
    // 1.5 Ma every 100 ms: 0.015 Ma/ms, below the threshold, and each sample
    // is closer together than the settle interval, so only velocity can
    // release these requests.
    const { requested, reasons } = runPump(sweep(50, 1.5, 100, 28), { preparedIntervalIndex: 0 });
    expect(requested).toEqual([1, 2, 3, 4]);
    expect(reasons).toEqual(["slow", "slow", "slow", "slow"]);
  });

  it("requests a prepared map the instant the scrub crosses into it", () => {
    // The same fast sweep, with the maps it crosses already resident: a
    // crossing into a prepared map is a swap, so it is never held.
    const resident = new Set([1, 2, 3, 4]);
    const { requested, reasons } = runPump(sweep(50, 6, 16, 8),
      { preparedIntervalIndex: 0, resident });
    expect(requested).toEqual([1, 2, 3, 4]);
    expect(reasons).toEqual(["resident", "resident", "resident", "resident"]);
  });

  it("holds the crossing while the scrub is fast and releases it on stillness", () => {
    const held = decideIntervalRequest({
      nowMs: 1_000, ageMa: 38, lastAgeMa: 44, lastAgeAtMs: 984,
      currentIntervalIndex: 1, preparedIntervalIndex: 0, isPrepared: () => false,
    });
    expect(held).toEqual({ kind: "hold", index: 1, settleInMs: PALAEO_INTERVAL_SETTLE_MS });

    // One millisecond short of a settle interval of stillness is still a hold.
    expect(decideIntervalRequest({
      nowMs: 984 + PALAEO_INTERVAL_SETTLE_MS - 1, ageMa: 38, lastAgeMa: 44, lastAgeAtMs: 984,
      currentIntervalIndex: 1, preparedIntervalIndex: 0, isPrepared: () => false,
    }).kind).toBe("hold");

    // The settle timer fires a full interval after the sample that held it,
    // by which time the age has stood still for at least that interval.
    expect(decideIntervalRequest({
      nowMs: 1_000 + PALAEO_INTERVAL_SETTLE_MS, ageMa: 38, lastAgeMa: 44, lastAgeAtMs: 984,
      currentIntervalIndex: 1, preparedIntervalIndex: 0, isPrepared: () => false,
    })).toEqual({ kind: "request", index: 1, reason: "settled" });
  });

  it("requests at once with no previous sample, so the first map is never delayed", () => {
    expect(decideIntervalRequest({
      nowMs: 0, ageMa: 90, lastAgeMa: 90, lastAgeAtMs: Number.NEGATIVE_INFINITY,
      currentIntervalIndex: 2, preparedIntervalIndex: -1, isPrepared: () => false,
    })).toEqual({ kind: "request", index: 2, reason: "settled" });
  });

  it("neither requests nor holds where the drawn map already covers the age", () => {
    expect(decideIntervalRequest({
      nowMs: 500, ageMa: 44, lastAgeMa: 50, lastAgeAtMs: 484,
      currentIntervalIndex: 0, preparedIntervalIndex: 0, isPrepared: () => false,
    })).toEqual({ kind: "satisfied", index: 0 });
  });

  it("asks for nothing where no published map covers the age", () => {
    expect(decideIntervalRequest({
      nowMs: 500, ageMa: 4_000, lastAgeMa: 50, lastAgeAtMs: 484,
      currentIntervalIndex: -1, preparedIntervalIndex: 0, isPrepared: () => false,
    })).toEqual({ kind: "none" });
  });
});

describe("createSettleTimer", () => {
  function fakeScheduler(): SettleScheduler & {
    run: (handle: number) => void; pending: () => number[];
  } {
    const handlers = new Map<number, () => void>();
    let next = 1;
    return {
      setTimeout: (handler) => { const handle = next++; handlers.set(handle, handler); return handle; },
      clearTimeout: (handle) => { handlers.delete(handle); },
      run: (handle) => { const handler = handlers.get(handle); handlers.delete(handle); handler?.(); },
      pending: () => [...handlers.keys()],
    };
  }

  it("re-evaluates once the armed delay elapses", () => {
    const scheduler = fakeScheduler();
    let evaluations = 0;
    createSettleTimer(() => { evaluations += 1; }, scheduler).arm(PALAEO_INTERVAL_SETTLE_MS);
    scheduler.run(scheduler.pending()[0]!);
    expect(evaluations).toBe(1);
  });

  it("keeps one pending re-evaluation, not one per held sample", () => {
    const scheduler = fakeScheduler();
    let evaluations = 0;
    const timer = createSettleTimer(() => { evaluations += 1; }, scheduler);
    timer.arm(PALAEO_INTERVAL_SETTLE_MS);
    timer.arm(PALAEO_INTERVAL_SETTLE_MS);
    timer.arm(PALAEO_INTERVAL_SETTLE_MS);
    expect(scheduler.pending()).toHaveLength(1);
    scheduler.run(scheduler.pending()[0]!);
    expect(evaluations).toBe(1);
  });

  // The layer going off tears the pump down: a surviving timer would wake a
  // disposed pump and request a map for a layer nobody is looking at.
  it("drops the held re-evaluation when the layer goes off", () => {
    const scheduler = fakeScheduler();
    let evaluations = 0;
    const timer = createSettleTimer(() => { evaluations += 1; }, scheduler);
    timer.arm(PALAEO_INTERVAL_SETTLE_MS);
    timer.cancel();
    expect(scheduler.pending()).toEqual([]);
    expect(evaluations).toBe(0);
  });
});
