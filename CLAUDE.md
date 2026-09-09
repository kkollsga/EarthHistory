# EarthHistory — Claude Code Conventions

EarthHistory is an interactive orbital globe with regional
zoom, spanning Earth formation and the Hadean through the present. Its intended
layers include palaeogeography, climate and biomes, ice, deserts, forests,
river systems, modern-country reference outlines, and cited points of interest.
Volcanic margins and rifts may appear as aerial regional stories. Detailed
basin sections, basin infill, subsurface burial/thermal histories, and
petroleum-system maturity are deferred future scope.

> **Status, 2026-09-08:** the approved TypeScript, React, Vite and Three.js
> application has a versioned private package, static scientific assets,
> production build, unit/data/browser tests, artifact validation and a GitHub
> validation workflow. The public repository is `kkollsga/EarthHistory`.
> Pages serves `gh-pages` at `https://kkollsga.github.io/EarthHistory/`;
> initial deployment and live browser checks succeeded, and main CI passed
> at `906262f`. Later local renderer work is not part of that published build.

The numbered invariants live in the doctrine oracle at
`../../Rust/doctrine/rules/RULES.md`. This installation was initially audited
against doctrine `0.1.11`; sync through `dev-docs/.doctrine-synced` before a
phased plan or release.

**Authority:** `CLAUDE.md` is the authority for project instructions and
`.claude/skills/` is the authority for workflow skills. `AGENTS.md` and
`.agents/skills/` are generated adapters. Edit the authorities, then run
`make sync-agents`; never hand-edit an adapter. This paragraph remains literal
in every generated copy (R7/R14).

## Current product and science boundary

- The user has chosen an orbital globe with regional zoom as the interaction
  shape. A beautiful, realistic globe with NASA WorldWind-like presence and
  believable lighting is the visual centerpiece. Regional zoom remains aerial;
  close terrain flight and detailed subsurface views are not initial
  requirements. NASA WorldWind is a visual reference, not an approved SDK
  choice. The approved direction is a static TypeScript/React/Vite/Three.js
  application, with a tested graphics-backend fallback and compact scientific
  controls. Optional effects and dependencies remain subject to validation.
- Good browser runtime performance is a product requirement. Measure the
  selected renderer with representative scenes, bounded memory, production
  settings and historical anchors; keep unresolved readiness misses visible.
- Gate expensive procedural detail and calculations by projected screen size or
  zoom while retaining broad scientific geometry and validity at every level.
  Cache visible refinements under a bounded policy, use hysteresis to prevent
  zoom-threshold churn, and cancel stale work after camera, age, or scenario
  changes.
- The runtime must not depend on external live data APIs or paid map/terrain
  providers. Curate compact, scientifically researched control inputs offline
  and serve them statically with the application. These inputs include coarse
  geography/elevation, climate/biome/ice controls, plate motion and validity,
  deterministic seeds, and provenance. The frontend performs most procedural
  visual synthesis and rendering from those controls; do not mandate
  precomputed full-resolution terrain/textures or move all processing offline.
- Research records that must survive live under `docs/research/` once accepted
  into the project. Working comparisons and plans live under `dev-docs/`.
- Every scientific claim, reconstruction dataset, and point of interest records
  a stable source identifier or URL, citation, publication/version date,
  temporal range, geographic basis, license, and retrieval date. Prefer primary
  papers, official datasets, and review literature; distinguish a source's
  claim from our inference.
- Every rendered state carries epistemic status: observed/proxy constrained,
  model output, interpolation, synthesis, or artistic gap-fill. Record age and
  spatial uncertainty where the literature supports it. A smooth animation
  must not imply continuous evidence between sparse reconstruction slices.
- Palaeogeographic geometry names its plate model/version, reference frame,
  plate IDs, valid age range, reconstruction method, and transforms. Never mix
  coordinates from incompatible models without a documented conversion.
- Biomes, ice, deserts, forests, rivers and basins must expose the evidence and
  method behind them. Hydrology and biome detail inferred from palaeotopography
  or climate simulation is labeled as inference; rivers are not drawn as known
  linework where only drainage tendency is defensible.
- Volcanic margins, rifts, and other tectonic features may be presented as
  sourced aerial regional stories. Detailed basin development/infill,
  subsurface burial and thermal models, and petroleum-system maturity or charge
  views are deferred. If added later, their timelines must separate
  depositional age, tectonic event age, model output, charge timing, and
  present-day interpretation, with uncertainty and references.
- “Country outlines through time” means a clearly labeled modern-country
  reference overlay reconstructed with the selected plate model where
  defensible. It is not evidence that present states, borders, or peoples
  existed in deep time. Historical political borders, if added, are a separate
  dated dataset. Unsupported fragments fade or disappear instead of being
  placed with false precision.
- Every point of interest has a time interval, coordinate uncertainty,
  description, event/category tags, sources, and confidence. Popups separate
  sourced facts from editorial explanation and link to their references.
- Data licenses and attribution are acceptance criteria. Record redistribution,
  derivative-work, and attribution obligations before a dataset enters a build.

## Working style

- Reproduce a defect and confirm its cause before fixing. Fix confirmed defects
  within the authorized scope; preserve a blocked or materially broader defect
  with its evidence through `add-todo`.
- Write long logs, captures and exploratory output to `dev-docs/temp/` or
  `dev-docs/bench/out/` and report the path. Promote evidence needed by a
  durable record before its scratch tier expires.
- Read the target command's own status. A pipeline status, skipped test,
  missing dataset, or absent command is never a pass (R2/R10).
- A new gate is trusted only after a deliberate mutation proves it can fail
  and the mutation is restored (R1).
- Keep generated or heavy output in a bounded owned location. Any new cache,
  capture, or build-output class gains a bound and cleanup owner in the same
  change (R4).
- Correct comments made false by a change and apply the information test to
  nearby comments. Preserve invariants, rationale, lifecycle contracts and any
  comment consumed by tooling (R17/R18).

## Planning, tests, and review

- Substantial work uses `phased-plan`. The user has authorized the initial
  application build and its settled stack/scope. Continue through its phases
  unless a real blocker invalidates the plan; do not request that approval again.
- GPT-6 Astra coordinates. GPT-5.6 Sol agents perform delegated research,
  implementation, tests, and independent review, including nested delegation,
  unless the user explicitly selects another model. Never silently substitute
  Astra when Sol is unavailable (doctrine 0.1.11).
- Every phase names the smallest checks that could catch what it breaks and its
  direct consumers. Run `make gate` for the deterministic application union and
  `make gate-full` once at program completion when the browser is installed.
- A measurement phase writes a stop rule before measuring and may cancel the
  proposed work (R13). Pre-measurement attribution remains a hypothesis.
- Planning welcomes design alternatives. Review reports concrete failures or a
  violation of a pre-existing named rule. A finding without a failure case is
  removed rather than downgraded (R15).
- Exact baselines and visual goldens change only with an explained intentional
  contract change. Never regenerate them merely to make a gate green (R10).
- Performance evidence uses production/release settings, control scenes,
  repeated measurements, machine-state metadata and historical anchors (R11).

## dev-docs steers the sprint; durable claims survive it

`dev-docs/README.md` is the canonical local layout map. `todos.md` stays a lean
index whose detail lives in a linked durable plan. This folder is gitignored;
committed source and documentation must never depend on it. Accepted scientific
provenance and product contracts move to tracked project locations.

## Inbox hygiene

`inbox/README.md` is the channel map. Triage preserves evidence and open work
before archival. Send only actionable, authorized coordination through
`notify`; batch by recipient and never overwrite an existing note.

## Commits, external actions, and releases

- Commit messages use `type: short description` (`feat`, `fix`, `docs`,
  `refactor`, `test`, `chore`). Do not commit unless the user requests it.
- Do not push without explicit, in-the-moment authorization. Publishing text
  under the user's identity requires approval of the exact final text.
- Repository creation and its initial source push are authorized. This is a
  development checkpoint, not a tagged release. A release still requires a
  verified publication target, successful remote workflow, and release-specific
  authorization; local checks are not remote publication evidence.
- Once a real release system is approved, invoking the release skill authorizes
  its complete run; it ends in verified artifacts or a named blocker (R12).
  Verify the whole artifact set and local/remote tag at the same commit (R9).
  Published artifacts are never deleted as routine cleanup.
- Version declarations and historical version citations are distinct. When a
  project or dependency version floor moves, enumerate every declaration;
  historical citations keep their original number (R16).
