# Reconstruction ocean-cohort preflight

Research result, 2026-09-10. This bounded trial tests whether source-typed ridge
geometry in the Cao et al. 2024 model can seed a very small, persistent set of
ocean material controls and carry them from 5 Ma to present through
`pygplates.TopologicalModel`. It is a feasibility result for material identity,
not a global ocean reconstruction.

## Frozen scope and source

The policy was written before execution at
`../EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/ocean/trial-policy.json`.
It fixes one source state at 5 Ma, no more than two source-typed ridge shared
subsegments, two seeds per ridge, a 25 km offset on each side, and six states at
1 Myr spacing from 5 to 0 Ma. The `TopologicalModel` internal snapshot cache is
three; the runner separately resolves and retains direct ownership results for
all six ages while comparing the traced particles. The four particles and this
interval were the entire trial; no other age or region was tried.

The input is [Cao et al. 2024 model release
2.4](https://doi.org/10.5281/zenodo.13628813), retrieved
2026-09-09T13:26:07Z, licensed CC BY 4.0, in its palaeomagnetic frame with
anchor plate 0. The model paper calls
the full-plate reconstruction a working hypothesis ([Cao et al.
2024](https://doi.org/10.1016/j.gsf.2024.101922)). The runner pins and verifies
SHA-256 hashes for the rotation file, three time-ranged boundary files, and
`TopologyBuildingBlocks.gpml`; the result records every digest and the actual
pyGPlates version, 1.0.0. Source-study, program, and owned-result limits are 4
GiB, 32 MiB, and 4 MiB respectively and are checked before writing.

## Method

At exactly 5 Ma the runner resolves topology sections and accepts only
`gpml:MidOceanRidge` shared subsegments that have two sharing resolved
topologies. It deterministically ranks eligible segments by resolved angular
length and selects the first two. On the longest vertex-to-vertex edge away
from a junction, it places generated material seeds 25 km to either side of
the spherical midpoint. Both seeds must have exactly one resolved topology
owner and those owners must differ. This avoids ambiguous points on the ridge
axis. It does not establish a crustal birth time: the seeds are explicitly
**model-seeded bounded controls**, and 5 Ma is their initialization state.

`TopologicalModel.reconstruct_geometry` traces the four points toward 0 Ma with
the default point-deactivation behavior. At each snapshot the runner records
the point under its EarthHistory seed ID, latitude/longitude, source topology
feature ID, and reconstruction plate ID. An active state counts as supported
only when it lies in exactly one resolved topology and that plate has a strict
rotation circuit using `use_identity_for_missing_plate_ids=False`. Inactive,
ambiguous, and missing-circuit states are counted separately and never receive
an identity or nearest-plate fallback. Ages are queried in forward and reverse
orders and compared at the same seed ID to `1e-12` radians.

## Result

The source state supplied 47 eligible ridge subsegments. The two selected
source ridge feature IDs were
`GPlates-71804fac-69f4-41bd-aabb-0fec8b6dfe96` and
`GPlates-ee06ba59-be69-49d9-ac3a-64db1a838f8c`. Their two sides were owned at
5 Ma by plate pairs 802/801 and 201/701 respectively. All 24 particle-time
states remained active, uniquely owned, and backed by a strict rotation
circuit. All four plate IDs remained stable and reverse-order queries returned
the same coordinates and statuses. There were zero inactive and zero
ambiguous-or-missing-circuit states.

This proves a narrow mechanism: source ridge adjacency can initialize distinct
material identities on both sides, and pyGPlates can advect those identities
continuously through this 5 Myr control interval. It does not prove a ridge
birth operator, global coverage, deformation fidelity, consumption at a
subduction zone, or continuity across older topology events. In particular,
resolved topology **feature IDs changed at some intermediate snapshots even
though reconstruction plate ownership remained stable**. A compiled material
ID must therefore be EarthHistory-owned and retain source lineage; it cannot be
defined as the current resolved-topology feature ID.

The identity validator accepted the four unmodified IDs. Deliberately dropping
one record and swapping the two sides both raised `ValueError`; the mutations
were not written into the result. This demonstrates the guard against lost or
reordered seed-to-control binding.

The tracked [machine-readable result](reconstruction-ocean-preflight.json) is
identical to
`../EarthHistory-data/palaeomap-study/verification/reconstruction-machinery-v1/ocean/summary.json`.
Reproduce it with:

```sh
../EarthHistory-data/palaeomap-study/verification/pygplates-venv/bin/python \
  scripts/research/ocean_cohort_preflight.py
```

The next ocean-material experiment may use this mechanism, but adoption still
requires an explicit ridge birth-strip topology and a separate bounded
consumption/event case. This trial must not be cited as either proof.
