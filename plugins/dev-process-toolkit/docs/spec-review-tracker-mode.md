# `/spec-review` Tracker Mode Flow

Detailed tracker-mode procedures for `/spec-review`. Pointed at from
`skills/spec-review/SKILL.md` to keep the skill lean.

In `mode: none`, `/spec-review` reads ACs from `specs/requirements.md` FR
sections as it always has. In tracker mode, the **canonical AC list comes
from the active adapter's `pull_acs`** — local `specs/requirements.md`
still supplies FR titles, descriptions, and traceability context (Path B).

## AC-traversal algorithm (tracker mode)

1. Run the Schema L probe. If tracker mode, continue; else the pre-M12
   body runs unchanged.
2. Read CLAUDE.md `## Task Tracking` → `active_ticket:` (if set) or iterate
   over the traceability matrix's `FR-{N}`-linked ticket IDs.
3. For each linked ticket: call `pull_acs(ticket_id)`. Parser boundary
   guarantees only AC content is returned — no description preamble,
   comments, or attachments (FR-35 AC-35.2, AC-35.3).
4. Build the traceability map against the **adapter-returned AC list**,
   not `specs/requirements.md`. Each AC's `id` is the leading `AC-X.Y`
   token (when present) or the adapter-local fallback (`linear-<n>`,
   `jira-<n>`).
5. For each AC, search the codebase for implementing code and tests;
   render the same report table format as `none` mode.

Empty AC parse fails the skill per AC-35.4 — never silently proceed on an
empty list.

## What stays local

- FR titles + descriptions (from `specs/requirements.md`) — the tracker
  mirrors these via `upsert_ticket_metadata`, but local remains canonical
  for prose (Path B).
- The traceability matrix itself — it maps FR-{N} → ticket IDs for the
  iteration above.
- Archive pointers, technical-spec ADRs, testing-spec conventions, plan
  milestones — **none** of these move into the tracker (DD-12.2).

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
`specs/plan/archive/<M#>.md` or `specs/frs/archive/<ulid>.md` (v2 layout —
no rolling index). Archived FRs have no live tracker mirror — historical
context only.
