---
name: dev-docs-cleanup
description: Reconcile EarthHistory local working records and safely archive or purge only verified disposable content.
---

# dev-docs cleanup

Read `dev-docs/README.md`; it alone defines tiers and lifetimes.

1. Inspect scratch candidates without following symlinks. `temp/` and
   `bench/out/` need known ownership plus reproducibility or a verified durable
   replacement and expiry. `bin/` needs a completed manifest and expiry from
   its archive timestamp. Retain legacy/unmarked material. Missing directories
   are simply empty.
2. Read `todos.md` first. Resolve its plan links and inbound durable links before
   opening only apparently orphaned plans. Do not scan `designs/` as a deletion
   pool. Corroborate apparent completion against tracked code, tests, accepted
   research, or release history.
3. Use `add-todo` for live unindexed work. Fully completed entries lose their
   backlink only after preserving needed decisions/evidence; partially complete
   entries retain the document and describe the residue. Ambiguity means retain.
4. Archive into a unique UTC batch under `dev-docs/bin/`. Its manifest records
   original/destination, archive and earliest-purge times, durable replacement,
   and completion state. Move without overwrite, verify, then mark complete.
5. Purge only expired eligible content within the authorized cleanup scope.
   Report deletions and retained exceptions. A review-only request proposes
   changes rather than mutating. Build-cache cleanup uses
   `make prune-build-cache`, whose ownership is limited to Vite and TypeScript
   caches; it never substitutes for this evidence-preserving procedure.
6. During release cleanup only, inspect documented repository worktrees. Keep
   active, locked, dirty, ambiguous, or unrecoverable trees. Before removal,
   preserve exact HEAD/branch/upstream, detached or unmerged commits with a ref
   or verified bundle, binary-capable staged and unstaged patches, untracked
   contents, valuable ignored files, symlinks, and submodules. Verify restoration
   in a temporary checkout and index the recovery manifest. Use non-force
   `git worktree remove`; patch-equivalent rebases require `git cherry`, not only
   ancestry. Skip worktree removal when no extra worktrees exist.
7. Reconcile adapters only when included in the task: compare to authorities,
   classify divergence as local improvement or staleness, merge improvements
   into authorities, run `make sync-agents`, and verify. Never edit adapters.
