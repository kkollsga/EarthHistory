---
name: add-todo
description: Capture actionable EarthHistory work in a durable plan and the lean todo index; use for requested backlog items and unresolved findings.
---

# Add todo

Read `dev-docs/README.md`, the canonical layout map. `dev-docs/todos.md` is a
lean index: one backlink line per thread, with the evidence and implementation
detail in `dev-docs/plans/*.md`. Capturing work does not authorize implementing
it.

1. Read the index and list `dev-docs/plans/`. For batch research/audit input,
   drop background and no-action conclusions; split independently actionable
   items, group a shared subsystem into one document, and deduplicate against
   existing threads.
2. Classify a concrete wrong result, broken scientific claim, invalid geometry,
   misleading uncertainty, crash, data loss, broken contract, measured
   regression, or dead gate as `Bugs`. Confirm its input/state and wrong outcome
   first. Put enhancements/refactors under `Engineering backlog`; migrations
   under `Migration follow-ups`.
3. Ground code/data work with one or two targeted searches. Record file/line or
   dataset/model/version, the failing interval/region, and source evidence.
   Distinguish a proposed interpretation from a confirmed defect.
4. Reuse a themed plan. Otherwise create `plans/<kebab-title>.md` with: change,
   long-run reason, evidence/provenance, likely fix site and approach, acceptance
   test or validation corpus, dependencies, and rough effort.
5. Add or update one index line:
   `- <title> → [plans/<doc>.md](plans/<doc>.md) — <under-200-character hook>. Surfaced <YYYY-MM-DD>.`
   Backlinks point only to durable documents. Copy essential evidence out of
   scratch or inbox records that may expire.
6. Report the section, plan path, and exact backlink. Do not prune, edit product
   code, bump versions, or manufacture a bug from a design preference.
