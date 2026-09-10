# Reconstruction climate-potential implementation

Date: 2026-09-10

## Implemented contract

`src/reconstruction/climate` implements one bounded, deterministic geographic
field evaluation for an immutable requested reconstruction revision. It accepts
an explicit latitude/longitude grid of `unknown`, `sea`, or `land` cells plus
elevation and versioned controls. It returns temperature, moisture, snow, and
land-biology *potentials*. These are procedural synthesis controls for rendering;
they are not a palaeoclimate simulation, mapped biome observations, or modern
Köppen classes.

The evaluator:

- preserves the declared spherical-area global temperature mean while deriving
  local temperature from geographic latitude and positive elevation, so a
  material point's reference-chart latitude cannot silently substitute for its
  reconstructed latitude;
- follows a bounded zonal/meridional upwind path, wraps longitude, propagates
  unknown source geography, restores moisture at known sea, dries over land,
  and applies an uplift/rain-shadow term;
- makes snow depend on local temperature and makes land biology depend on an
  explicit historical eligibility flag and capacity;
- requires one surface/elevation input at each physical pole, uses the -180
  degree column as the canonical pole upwind meridian, and publishes that one
  result across the pole row (including unknown propagation);
- rejects grids above 360 by 181 cells, more than 32 upwind steps, unsafe byte
  and cell budgets, invalid surface codes, incomplete wind coverage at an
  evaluated row, stale revisions, and cancellation before allocation and once
  per row; and
- records a copied, frozen evidence identity. The five typed output arrays use
  17 bytes per cell (1 status byte plus four Float32 values), or 1,107,720 bytes
  at the maximum grid. No cache, publisher, lifecycle, or second revision owner
  is introduced.

The same dimensions and method apply at 0 and 450 Ma. Present day therefore
does not gain a denser climate grid than the Ordovician. Detail can still differ
through geography, elevation, and explicit controls.

## Controls and evidence boundary

The existing `src/data/snapshots.ts` environment controls remain candidate
authored inputs: `temperatureC` supplies the temperature baseline, and
`biomeStage`/`vegetation` can supply a bounded biology capacity only when a
separately sourced `landBiologyEligible` flag permits it. For example, the
existing authored values are 14 C and capacity 1 at 0 Ma, and 18 C and capacity
0.12 in the 450 Ma stage. This slice does not import the old snapshot engine or
accept its crust mask as land. A future compiler/preparation adapter must record
those values in the versioned `ClimatePotentialControls`; it must not query the
old renderer at runtime.

Primary literature supports the qualitative mechanisms:

- Schneider (2006), [The General Circulation of the Atmosphere](https://doi.org/10.1146/annurev.earth.34.031405.125144),
  supports latitude-dependent circulation and wind controls.
- Roe (2005), [Orographic Precipitation](https://doi.org/10.1146/annurev.earth.33.092203.122541),
  supports terrain-dependent windward precipitation and robust spatial
  rain-shadow patterns while warning that quantitative precipitation is hard.
- Rolland (2003), [Spatial and Seasonal Variations of Air Temperature Lapse
  Rates in Alpine Regions](https://doi.org/10.1175/1520-0442(2003)016%3C1032:SASVOA%3E2.0.CO;2),
  supports elevation lapse as a control and documents its spatial/seasonal
  variability.
- Rubinstein et al. (2010), [Early Middle Ordovician Evidence for Land Plants
  in Argentina](https://doi.org/10.1111/j.1469-8137.2010.03433.x), constrains
  when nonzero terrestrial-plant eligibility may be scientifically defensible;
  it does not define a global vegetation fraction.

The numerical lapse rate, latitude curve exponent, wind-band edges, drying per
step, orographic loss, snow threshold, traversal distance, and biology response
curve are editorial algorithm constants. They require regional and temporal
calibration before historical acceptance. Source IDs and limitations are
mandatory in every control set so these constants cannot masquerade as direct
measurements.

## Verification

The focused tests cover wind reversal across a mountain, coast-to-interior
drying, date-line wrap, pole continuity, latitude and elevation temperature,
snow, unknown-upwind propagation, equal 0/450 Ma allocation, early biology
exclusion, invalid classifications and budgets, evidence mutation isolation,
and canceled/stale evaluation.

Commands:

```text
npm test -- --run src/reconstruction/climate/evaluate.test.ts
npm test -- --run src/reconstruction/motion.test.ts src/reconstruction/runtime.test.ts src/reconstruction/climate/evaluate.test.ts
npm run typecheck
```

## Still unsupported

This slice does not select historical wind bands, calibrate palaeotemperature or
precipitation, reconstruct atmospheric composition, simulate seasons or ocean
circulation, infer land from crust type, generate biome classes, solve ice-sheet
dynamics, or publish a global historical field. Missing geography remains
unknown. Scientific acceptance still requires model-age control compilation and
regional checks against independent palaeoclimate evidence.
