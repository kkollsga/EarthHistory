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

/**
 * The one pre-collision crust feature the Cao 2024 v2.4 model carries: `Greater
 * India based on Gibbons et al. (2015) Gondwana Research`, plate 501, alive from
 * 600 Ma and **retired at 10 Ma** — the model's own statement that this crust was
 * consumed. It reaches 1,341 km north of the model's own present Indian outline
 * at 85 E, which is the only one of three collision budgets the model meets;
 * `docs/research/palaeo-coastlines-collision-shortening.md` measures all three,
 * and `scripts/research/validate_precollision_extent.py` re-derives them.
 *
 * The id is the chart the browser actually downloads, so the map key can gate
 * its evidence line on the chart being posed rather than on the age.
 */
export const GREATER_INDIA_CHART_ID =
  "cao-continent:GPlates-66e2d112-6f76-43ca-9708-15deea4317c0:870:0";

/**
 * What the map key says while that chart is on screen. Three rules behind the
 * wording: name the model rather than the map (evidence status is model-output,
 * never observed); say crust rather than land, because the palaeo layer draws
 * this ground as shallow sea; and carry the published spread, which is a factor
 * of five and unresolved.
 */
export const GREATER_INDIA_EVIDENCE_LINE =
  "Greater India crust · model inference after Gibbons et al. (2015); published "
  + "spread ~600–3,000 km; removed from the model at 10 Ma";
