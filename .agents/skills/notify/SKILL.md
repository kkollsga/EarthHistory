---
name: notify
description: Send an authorized actionable EarthHistory coordination note to a named local project inbox without overwriting existing messages.
---

# Notify

Read `inbox/README.md`, the canonical channel map.

Invocation with a recipient and purpose authorizes that one local inbox send.
A review or inbound note alone does not. Reuse authorization already given;
otherwise prepare the final draft before asking.

1. Resolve the named repository under the configured local projects root by exact
   or case-insensitive directory name, excluding `.git`, dependencies, caches,
   build outputs and worktree collections. An absolute path must already exist.
   Use repository-root checks to disambiguate; ask only when multiple plausible
   targets remain. `mcp-servers` is one project, not its component directories.
2. Ensure `<target>/inbox/unread/` exists only after the target is resolved.
3. Write `YYYY-MM-DD-from-EarthHistory-<topic>.md` with title; From/To/Date/
   Type/Re metadata; 1–3 context paragraphs; `## Ask / action requested`; and
   optional references. Type is feedback, bug, coordination, heads-up, or
   request. Include reproducible evidence and stable citations where relevant.
4. Send only material that changes what the recipient does, answers an
   explicitly requested reply, removes a blocker, or is time-sensitive. Batch
   related items per target, avoid FYIs, and ping a stalled thread at most once
   with new evidence.
5. Create exclusively. If the name exists, compare it: identical means already
   delivered; different content gets a collision-safe suffix. Never truncate.
   Read back the destination and report its full path and delivery state.
