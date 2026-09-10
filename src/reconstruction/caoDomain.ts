/**
 * Cao 2024 v2.4 source model domain. The live package `ageDomainMa` may be a
 * compiled subset; validators and emitters must not invent ages beyond this.
 */
export const CAO_SOURCE_AGE_DOMAIN_MA = Object.freeze({
  youngest: 0,
  oldest: 1_800,
} as const);

/** Public Pages budget for the reconstruction foundation (bytes). */
export const CAO_PUBLIC_FOUNDATION_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Display-checkpoint schedule for a full-domain compile that fits the Pages
 * budget: keep the current 5 Ma Phanerozoic/early-Paleozoic density through
 * 540 Ma, then step at 10 Ma through the remainder of the source model.
 * Motion still samples every qualified source rotation knot.
 */
export function caoDisplayCheckpointAgesMa(
  oldestMa: number = CAO_SOURCE_AGE_DOMAIN_MA.oldest,
): number[] {
  const ages = new Set<number>();
  const denseUntil = Math.min(540, oldestMa);
  for (let age = 0; age <= denseUntil; age += 5) ages.add(age);
  for (let age = 550; age <= oldestMa; age += 10) ages.add(age);
  if (oldestMa > denseUntil) ages.add(oldestMa);
  return [...ages].sort((left, right) => left - right);
}
