/**
 * Epistemic limitations the palaeo-coastline map key states while the mode is on.
 *
 * The Cao et al. (2017) charts publish land, shallow-marine and mountain classes
 * and nothing else, so settings the research memos describe — Lake Pannon, the
 * isolated Caspian, the Eocene-Oligocene Sunda rift lakes — have no class of
 * their own and are drawn as the nearest published one. A viewer who is not told
 * that reads a rendered class as a claim about the water it covers. The Last
 * Glacial Maximum state is a different kind of object again: an elevation datum
 * applied to present-day bathymetry, not a reconstruction, so it carries its own
 * single line instead of the map-interval set.
 *
 * The strings live here rather than inline in `App.tsx` so a unit test can pin
 * them; the browser key test reads them off the rendered panel.
 */

/** Map intervals are bins, not instants: D1 in the handbook's known limitations. */
export const PALAEO_INTERVAL_LIMITATION =
  "Interval, not moment: land and shallow sea are the minimum land / maximum flooding "
  + "recorded anywhere in that bin, a 10–27 Myr span.";

/** The `sm` class is an environment, and deep water can sit inside it. */
export const PALAEO_SHALLOW_SEA_LIMITATION =
  "Class, not depth: shallow sea is an environment class, so a deep basin can "
  + "render as shallow sea.";

/** No lacustrine or brackish class exists to draw the memos' isolated basins in. */
export const PALAEO_LAKE_CLASS_LIMITATION =
  "No lake or brackish class: Lake Pannon, the isolated Caspian and the "
  + "Eocene–Oligocene Sunda rift lakes render as shallow sea or land, the "
  + "closest class published.";

/** The LGM lowstand state is a datum over modern bathymetry, uncorrected. */
export const PALAEO_LGM_DATUM_LIMITATION =
  "Datum, not a reconstruction: −120 m on present-day bathymetry, with no "
  + "glacio-isostatic adjustment, no ice sheets and post-glacial sediment still in place.";

/** What the key lists over a Cao et al. (2017) map interval. */
export const PALAEO_MAP_INTERVAL_LIMITATIONS = [
  PALAEO_INTERVAL_LIMITATION,
  PALAEO_SHALLOW_SEA_LIMITATION,
  PALAEO_LAKE_CLASS_LIMITATION,
] as const;

/** What the key lists over the detached Last Glacial Maximum lowstand state. */
export const PALAEO_DETACHED_LIMITATIONS = [
  PALAEO_LGM_DATUM_LIMITATION,
] as const;
