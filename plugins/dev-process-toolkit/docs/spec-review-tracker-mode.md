# `/spec-review` Tracker Mode Flow

> See `docs/layout-reference.md` — canonical authority on FR file shape (per-FR file path, AC-prefix derivation, `## Acceptance Criteria` section).

Detailed tracker-mode procedures for `/spec-review`. Pointed at from
`skills/spec-review/SKILL.md` to keep the skill lean.

In `mode: none`, `/spec-review` reads ACs from each
`specs/frs/<short-ULID>.md` file's `## Acceptance Criteria` section. In
tracker mode, the **canonical AC list comes from the active adapter's
`pull_acs`** — the per-FR file at `specs/frs/<tracker-id>.md` still
supplies FR titles, descriptions, and traceability context (Path B).

## AC-traversal algorithm (tracker mode)

1. Run the Schema L probe. If tracker mode, continue; else the
   `mode: none` branch runs unchanged.
2. Iterate over the per-FR files at `specs/frs/<tracker-id>.md` — the
   filename IS the ticket-id binding (no separate traceability matrix).
3. For each FR file's ticket id: call `pull_acs(ticket_id)`. Parser
   boundary guarantees only AC content is returned — no description
   preamble, comments, or attachments.
4. Build the traceability map against the **adapter-returned AC list**,
   not the local FR file's `## Acceptance Criteria` section. Each AC's
   `id` is the leading `AC-<prefix>.<M>` token (when present) or the
   adapter-local fallback (`linear-<n>`, `jira-<n>`).
5. For each AC, search the codebase for implementing code and tests;
   render the same report table format as `none` mode.

Empty AC parse fails the skill — never silently proceed on an
empty list.

## What stays local

- FR titles + descriptions (from each `specs/frs/<tracker-id>.md`'s
  `## Requirement` section) — the tracker mirrors these via
  `upsert_ticket_metadata`, but local remains canonical for prose
  (Path B).
- Traceability — the FR filename `<tracker-id>.md` plus the file's
  frontmatter `tracker:` block IS the traceability binding. No separate
  matrix is maintained.
- Archive pointers, technical-spec ADRs, testing-spec conventions, plan
  milestones — **none** of these move into the tracker.

## Side effects

None. `/spec-review` is read-only in both modes. `allowed-tools: Read,
Glob, Grep` is unchanged — the adapter `pull_acs` call is invoked via
Claude's MCP tools, which are separate from `allowed-tools` (they live
under the `mcp__*` namespace).

## MCP call budget (NFR-8)

One `pull_acs` per FR in scope. For `/spec-review all` this can be several
calls; latency scales with the number of linked tickets. For
`/spec-review <single-FR>` it's one call. No caching between skills.

## Archive fallback

If the user's query references a milestone or FR ULID not in the live
`specs/plan/` / `specs/frs/` tree, look it up directly in
`specs/plan/archive/<M#>.md` or `specs/frs/archive/<name>.md` — there is
no rolling index file; the filename encodes the identifier. Archived FRs
have no live tracker mirror — historical context only.
