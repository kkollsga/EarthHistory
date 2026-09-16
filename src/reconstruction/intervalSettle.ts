/**
 * When a map-interval crossing becomes a request.
 *
 * The age pump used to request the covering interval the instant the age
 * crossed into it. A fast scrub crosses several boundaries in a second, so the
 * maps it passes through were fetched, triangulated and published only to be
 * discarded by the next crossing, while the gesture waited behind loads for
 * ages the user never stopped at. The decision here holds the crossing instead
 * wherever the map is not already prepared and the scrub is still moving fast:
 * the outgoing interval stays drawn and posed live at the live age, and the
 * request is made once the scrub settles — or immediately where it costs
 * nothing, because the target interval is already resident.
 *
 * It is pure so the policy can be tested without a runtime, a renderer or a
 * clock: the owner supplies the clock, the age samples and the residency
 * predicate.
 */

/** Stillness, in milliseconds, that counts as the scrub having settled. */
export const PALAEO_INTERVAL_SETTLE_MS = 120;

/**
 * 2 Ma per 100 ms. Below this the scrub is slow enough that every map it
 * crosses is a map the user is reading, so each one is requested at once.
 */
export const PALAEO_INTERVAL_SETTLE_MA_PER_MS = 2 / 100;

/** Why a crossing became a request; carried for tests and diagnostics. */
export type IntervalRequestReason = "resident" | "settled" | "slow";

export interface IntervalRequestInput {
  /** The evaluation moment: an age sample, or the settle timer firing. */
  readonly nowMs: number;
  /** The live age the pump would request. */
  readonly ageMa: number;
  /** The age sample before the live one. */
  readonly lastAgeMa: number;
  /**
   * When that previous sample arrived. `Number.NEGATIVE_INFINITY` stands for
   * "no previous sample": the first pump of a session requests at once.
   */
  readonly lastAgeAtMs: number;
  /** Index of the interval covering the live age, or negative where none does. */
  readonly currentIntervalIndex: number;
  /** Index of the interval currently published, or negative where none is. */
  readonly preparedIntervalIndex: number;
  /** Whether that interval is already prepared, so a crossing into it is free. */
  readonly isPrepared: (index: number) => boolean;
}

export type IntervalRequestDecision =
  /** No published map covers this age; the owner falls back. */
  | { readonly kind: "none" }
  /** The map already on screen covers this age; pose it, do not request. */
  | { readonly kind: "satisfied"; readonly index: number }
  | {
    readonly kind: "request";
    readonly index: number;
    readonly reason: IntervalRequestReason;
  }
  /** Keep the outgoing map; re-evaluate after this delay unless the age moves. */
  | { readonly kind: "hold"; readonly index: number; readonly settleInMs: number };

/**
 * The crossing policy. A hold is never a refusal: the owner re-evaluates on
 * every age change and on the settle timer, so a held crossing becomes a
 * request as soon as one of the three conditions holds — and never blocks the
 * crossing that follows it.
 */
export function decideIntervalRequest(input: IntervalRequestInput): IntervalRequestDecision {
  const index = input.currentIntervalIndex;
  if (index < 0) return { kind: "none" };
  if (index === input.preparedIntervalIndex) return { kind: "satisfied", index };
  // (a) Already prepared: publishing it is a swap, not a load, so the scrub
  // pays nothing for the crossing and waiting would only withhold a map that
  // is in hand.
  if (input.isPrepared(index)) return { kind: "request", index, reason: "resident" };
  const elapsedMs = input.nowMs - input.lastAgeAtMs;
  // (b) The age has not moved for a settle interval — including the first pump
  // of a session, which has no previous sample at all.
  if (!Number.isFinite(elapsedMs) || elapsedMs >= PALAEO_INTERVAL_SETTLE_MS) {
    return { kind: "request", index, reason: "settled" };
  }
  // (c) Slow enough to be reading rather than sweeping. An age that repeats is
  // zero velocity; a sample with no elapsed time at all cannot be measured and
  // is treated as fast.
  const movedMa = Math.abs(input.ageMa - input.lastAgeMa);
  const velocityMaPerMs = elapsedMs > 0 ? movedMa / elapsedMs
    : (movedMa === 0 ? 0 : Number.POSITIVE_INFINITY);
  if (velocityMaPerMs < PALAEO_INTERVAL_SETTLE_MA_PER_MS) {
    return { kind: "request", index, reason: "slow" };
  }
  // The wait is measured from now, not from the previous sample: this call is
  // the latest sample, so a full settle interval of stillness has to pass
  // after it before the crossing is worth a load.
  return { kind: "hold", index, settleInMs: PALAEO_INTERVAL_SETTLE_MS };
}

/** The `setTimeout` pair the settle timer uses; injectable so tests own time. */
export interface SettleScheduler {
  setTimeout: (handler: () => void, delayMs: number) => number;
  clearTimeout: (handle: number) => void;
}

/** One pending settle re-evaluation, armed by a hold and cancelled by anything else. */
export interface SettleTimer {
  /** Replaces any pending re-evaluation with one `delayMs` from now. */
  arm: (delayMs: number) => void;
  /** Drops the pending re-evaluation; the layer going off must reach this. */
  cancel: () => void;
}

const DEFAULT_SETTLE_SCHEDULER: SettleScheduler = {
  setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs) as unknown as number,
  clearTimeout: (handle) => { globalThis.clearTimeout(handle); },
};

/**
 * A single-slot timer for the held crossing. Single-slot because a held
 * request is always the latest one: an age change re-arms it, and a request,
 * a fallback or the layer going off cancels it.
 */
export function createSettleTimer(
  reevaluate: () => void,
  scheduler: SettleScheduler = DEFAULT_SETTLE_SCHEDULER,
): SettleTimer {
  let handle: number | null = null;
  const cancel = (): void => {
    if (handle === null) return;
    scheduler.clearTimeout(handle);
    handle = null;
  };
  return {
    arm: (delayMs: number): void => {
      cancel();
      handle = scheduler.setTimeout(() => {
        handle = null;
        reevaluate();
      }, delayMs);
    },
    cancel,
  };
}
