export const PALEODEM_MIN_AGE_MA = 0;
export const PALEODEM_MAX_AGE_MA = 540;
export const PALEODEM_STEP_MA = 5;

/** Source-authored PaleoDEM v2 frames; narrative chapters remain a separate catalog. */
export const PALEODEM_AGES = Object.freeze(
  Array.from(
    { length: (PALEODEM_MAX_AGE_MA - PALEODEM_MIN_AGE_MA) / PALEODEM_STEP_MA + 1 },
    (_, index) => PALEODEM_MIN_AGE_MA + index * PALEODEM_STEP_MA,
  ),
);

export interface PaleodemAgeBracket {
  requestedAgeMa: number;
  youngerAgeMa: number;
  olderAgeMa: number;
  fraction: number;
  exact: boolean;
}

/** Resolve the two source-authored frames surrounding an age on the Ma axis. */
export function resolvePaleodemAgeBracket(ageMa: number): PaleodemAgeBracket {
  if (!Number.isFinite(ageMa)) throw new RangeError("ageMa must be finite");
  const requestedAgeMa = Math.max(PALEODEM_MIN_AGE_MA, Math.min(PALEODEM_MAX_AGE_MA, ageMa));
  const youngerAgeMa = Math.floor(requestedAgeMa / PALEODEM_STEP_MA) * PALEODEM_STEP_MA;
  const olderAgeMa = Math.ceil(requestedAgeMa / PALEODEM_STEP_MA) * PALEODEM_STEP_MA;
  const exact = youngerAgeMa === olderAgeMa;
  return {
    requestedAgeMa,
    youngerAgeMa,
    olderAgeMa,
    fraction: exact ? 0 : (requestedAgeMa - youngerAgeMa) / (olderAgeMa - youngerAgeMa),
    exact,
  };
}

export function nearestPaleodemAge(ageMa: number): number {
  const bounded = Math.max(PALEODEM_MIN_AGE_MA, Math.min(PALEODEM_MAX_AGE_MA, ageMa));
  return Math.round(bounded / PALEODEM_STEP_MA) * PALEODEM_STEP_MA;
}
