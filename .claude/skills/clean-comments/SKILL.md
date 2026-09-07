---
name: clean-comments
description: Make comments true and lean in a measured EarthHistory scope while preserving scientific contracts and comments consumed by tooling.
---

# Clean comments

Read `dev-docs/README.md`, the canonical working-folder map.

Capture selected files' current bytes before editing; user changes are the
rollback baseline. This procedure is for focused residue, not an automatic
whole-repository rewrite.

## Current comment-reader inventory

The repository contains TypeScript/TSX application code, GLSL shader strings,
Python data/gate scripts, Vite/TypeScript configuration and generated agent
adapters. No generated API documentation, linter-allowance checker or CLI help
generator currently consumes source comments. `scripts/sync_agents.py` consumes
authority prose but not comments. Re-inventory gate scripts, compiler/linter
configuration, documentation generation, shader preprocessing, schema/code
generation and CLI/API help before each cleanup run; missing that refreshed
inventory stops the run (R18).

## Procedure

1. Measure the requested scope with `rg -c` and inspect status 1 (no matches)
   separately from status 2 (scan failed). Select the files jointly containing
   about half the comments. Decide the stop rule before counting: an empty or
   trivial head means “already lean,” with no edit.
2. For more than two files, the coordinator edits nothing. Dispatch one Sol
   worker per file, beginning with one calibration file; read its full diff
   before scaling. Two failed calibrations stop the run. For two or fewer files,
   apply the same brief locally and inspect independently.
3. Per paragraph ask whether it adds information unavailable from code or an
   earlier paragraph. Delete signature/next-line restatement, banners, dead
   scaffolding and journey narration; compress repetition and hedging. Preserve
   why-not-what, invariants, safety and ordering, format/data lifecycle,
   regression rationale, bail reasons, local contracts, scientific provenance,
   uncertainty, license constraints, coordinate/reference-frame semantics, and
   anything consumed by tooling.
4. Fix a comment contradicted by code/data and expired future claims. Do not
   “correct” a scientific interpretation without checking its cited source.
   Keep cross-file duplication as a coordinator finding. Verify doc-block
   adjacency and balance fences by width.
5. Before formatting, prove behavior tokens/AST are unchanged where a suitable
   parser exists; otherwise inspect changed spans and state the limitation.
   Then run the real formatter and every refreshed comment-reader gate. Undo
   only this run's causal edits when verification fails.
6. Report deletion and compression separately per file, plus corrected false
   claims, untouched contracts, unprocessed files, and concrete defects. Route
   only findings with a failure case through `add-todo` (R15).
