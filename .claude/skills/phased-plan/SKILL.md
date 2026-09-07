---
name: phased-plan
description: Investigate, plan, and execute a substantial EarthHistory change in testable phases; implementation starts only after unsettled scope and stack decisions are approved.
---

# Phased plan

Use this for multi-part features, refactors, or data programs. Read
`dev-docs/README.md`, `dev-docs/todos.md`, and the doctrine oracle at
`../../Rust/doctrine/learn-from-us.md`. Compare numeric oracle `VERSION` with
`dev-docs/.doctrine-synced`, apply every newer changelog obligation oldest
first, and advance the marker only through contiguous fully completed entries.
A missing/ahead/malformed marker or incomplete obligation is not silently reset.

## Agent allocation

GPT-6 Astra coordinates scope, sequencing, allocations, integration, and final
synthesis. Explicitly use GPT-5.6 Sol for research, implementation, tests, and
independent review, including nested workers. Give bounded briefs and reuse
completed evidence. A later user model choice wins. If Sol is unavailable,
preserve progress and report it; do not silently substitute Astra.

## Investigate before committing to design

- Read relevant backlog and tracked research. Inspect existing code/tests when
  they exist; use bounded scratch probes in `dev-docs/temp/` and keep product
  source unchanged until the user has settled material open choices.
- Research primary papers, official datasets/models, and review literature.
  Record stable references, versions, licenses, time/coordinate uncertainty,
  reconstruction frames, and whether each conclusion is sourced, inferred,
  interpolated, or editorial.
- For EarthHistory, test the proposal across deep-time global overview and
  regional zoom: plate/topography reconstruction, climate/biomes/ice/drainage,
  country-reference overlay semantics, cited POIs, basin development/infill,
  burial/thermal maturity and petroleum systems, volcanic margins, and rifts.
- Reproduce bugs and behavior before moving it. Verify the proposed safety net
  catches that failure class. Treat cost/quality attributions as hypotheses.
- Report affected boundaries, dependencies, data volume/LOD, browser/GPU and
  accessibility risks, current validation, and design objections now.

## Write and challenge the plan

Create `dev-docs/plans/<slug>.md` and one lean todo backlink. Each numbered
phase is independently buildable, testable, and committable, and names the
smallest checks for its surface and direct consumers. The final gate runs the
union once. A measurement phase states beforehand the result that cancels its
follow-on work (R13).

List and verify every factual premise in the plan. Run one pre-mortem with 2–3
specific failure scenarios; each real one changes a phase, adds a test, or
becomes a stop rule. Argue design alternatives here without severity labels.
Present unsettled scope/design choices for user revision. Existing authorization
is not requested again. Once approved, continue until completion or a blocker
that invalidates the plan.

## Branch and execute after approval

Use one feature branch and one draft PR for the whole plan when a Git repository
and remote exist; phases are commits, not sub-branches. Worktrees live under
`../EarthHistory-worktrees/<name>`. Do not create a branch/PR for research-only
discussion, and do not claim missing repository/CI mechanics succeeded.

For every phase:

1. Implement code/data contract plus meaningful validation.
2. Run `make gate` and the targeted application checks named by the approved
   plan. `make gate` covers doctrine state, generated adapters, TypeScript,
   unit/data tests, the production build, manifest hashes and artifact budgets;
   `make gate-full` adds the Pages-subpath browser suite. When new gates land,
   mutate the guarded condition, observe red, and restore it (R1).
3. Update tracked user/science documentation and changelog when they exist.
4. Commit one phase if commits are authorized. After commits, run
   `make prune-build-cache`; it owns only regenerable Vite and TypeScript caches
   and leaves installed dependencies and user files intact.
5. Push only with authorization, batching natural checkpoints. Observe CI and
   fix red results within scope. Retire completed todos safely through cleanup.
6. Continue. A concrete bug is fixed in a separate bisectable change when in
   scope; blocked or materially broader defects retain reproduction and reason
   through `add-todo`.

Before report-out, run the union of targeted checks plus the real full
application/data/visual/accessibility test set once, and only relevant heavy
extras. Performance-sensitive rendering or reconstruction work uses production
builds, stable control scenes, repeat runs and an anchor (R11). Shipping remains
a separate release request.
