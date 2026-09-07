---
name: release
description: Release EarthHistory only after a real package, CI workflow, version authority, artifact inventory, and publication target exist; otherwise report the concrete blocker.
---

# Release

Read `dev-docs/README.md` and `inbox/README.md`; they own local lifecycle and
coordination layout.

## Current hard precondition

EarthHistory has an approved stack, private npm package, `package.json` version
authority, data/artifact manifest, full local gates and a GitHub Pages workflow.
The public repository is `kkollsga/EarthHistory`; its initial source push was
authorized on 2026-09-07. Before a release, inspect the actual remote CI and
Pages configuration and verify the publication URL and release authorization.
Stop only on concrete missing prerequisites. `make gate-full` is local product
evidence; it is not proof of a remote deployment. Do not simulate publication
or treat the initial development checkpoint as a tagged release.

## Procedure once release infrastructure exists

Invocation authorizes the complete documented release run, including its one
publish push; the run ends with the full artifact set verified or a named
blocker (R12). Never end merely because CI is running or a commit is ready.

1. Sync doctrine numerically using `../../Rust/doctrine/learn-from-us.md` and
   `dev-docs/.doctrine-synced`; complete obligations before advancing. Inspect
   all open PRs: integrate finished in-scope work; stop for the user's decision
   on unfinished, red, conflicting, or visibly partial work before release
   changes. Record any explicit deferral.
2. Verify clean/recoverable Git state, branch/upstream, publication credentials,
   registry capacity, version authority, dependency floors, attribution/license
   obligations, source-data/model versions, and the exact artifact/platform set.
   Published-source inputs must be reproducible or immutable.
3. Review the goal and release diff test-first. Every substantive product,
   renderer, shader, reconstruction, data-schema, citation, and packaging area
   names the test/validation that fails on regression. Promote useful harnesses
   deliberately and see every new/promoted gate red before restoring it (R1).
4. Run the fast gate and relevant targeted tests, then the full CI-equivalent
   union once. Visual goldens/baselines change only with an explained contract
   decision. Run production-profile performance evidence with controls,
   repeats, metadata and historical anchors when the touched surface requires it.
5. Determine the version from the documented project command. Patch is the
   default unless the user explicitly requested another size; never propose or
   announce an escalation for adoption by silence. Enumerate every own-version
   declaration and every dependency-floor declaration separately; grep old
   floors and classify remaining hits as historical citations or defects (R16).
6. Produce a surgical release diff and read back staged paths. Update release
   notes with user-visible/scientific provenance changes, known uncertainty,
   model/data versions, licensing attribution and measured results. Commit only
   when authorized by the release workflow.
7. Push the integration branch as documented and wait for the expected complete
   CI set. Diagnose failures; a bounded fix-and-push loop covers only bugs in the
   approved release shape. Revalidate combined HEAD before the publish push.
8. Push the publishing branch once, then verify every expected package,
   platform artifact, source/archive, data/attribution manifest, checksum,
   release page, and local/remote tag at the same commit (R9). A registry version
   alone is insufficient. Never mint a missing tag locally to hide failed CI.
9. Complete authorized post-publication checks and notifications, then use
   `dev-docs-cleanup` for safe local records/worktrees. Published artifacts are
   never deleted as routine cleanup. Report version, commit, artifacts, gates,
   scientific data/model versions, known limitations, and cleanup once.
