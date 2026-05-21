# `/spec-write` Tracker Mode Flow

> See `docs/layout-reference.md` — canonical authority on FR file shape (per-FR file path, AC-prefix derivation, `## Acceptance Criteria` section).

Detailed tracker-mode procedures for `/spec-write`. Pointed at from
`skills/spec-write/SKILL.md` step 0 to keep the skill under NFR-1.

In `mode: none`, this document is unused.

## Tracker ID Assignment Order

**Rule:** create the tracker ticket **first**, read the returned ID, substitute the placeholder globally, **then** write the FR file. **Never guess** the next sequential tracker number.

The order is load-bearing. Trackers skip cancelled numbers, renumber across workspace renames, and allocate IDs atomically on ticket creation — an implementer's guess ("`<TKR>-NN` was last, so the next is `<TKR>-NN+1`") can be wrong silently, and the misalignment ships into every downstream artifact (AC prefixes, filename, plan-file row, every prose cross-reference).

### Concrete flow

1. **Draft with placeholder.** Use `<tracker-id>` (or adapter-specific rendering — `STE-<N>` for Linear, `PROJ-<N>` for Jira) throughout the draft:
   - AC lines: `AC-<tracker-id>.1`, `AC-<tracker-id>.2`, …
   - Filename: `<tracker-id>.md`
   - Plan-file table row: `| <tracker-id> | Title | <tracker>:<tracker-id> |`
   - Prose cross-references: `"closes <tracker-id>"`, `"supersedes <tracker-id>"`
2. **Create the tracker ticket.** Call `Provider.sync(spec)` → `upsertTicketMetadata(null, …)`. **Workspace binding.** Before invoking, call `readWorkspaceBinding(claudeMdPath, "linear" | "jira")` from `adapters/_shared/src/workspace_binding.ts` and pass `team` + `project` + `defaultLabels` into the call so the new ticket lands on the correct project board with the configured labels. Linear adapter rejects creates that lack `project` per the silent-landing trap; Jira adapter rejects creates that lack `project` per the Jira API requirement. **Labels** are optional and forwarded only when `defaultLabels` is populated (Linear → `save_issue.labels`; Jira → `createJiraIssue.additional_fields.labels`). The tracker allocator returns the real ID (e.g., `<TKR>-NN`).
3. **Substitute globally.** Replace every `<tracker-id>` with the returned ID in one pass.
4. **Write the FR file.** Only after substitution completes — the file on disk never contains a placeholder.

### Worked example

Draft AC line: `AC-<tracker-id>.1: releaseLock asserts pre-state in_progress`

Linear assigns the next free ID (let's call it `<TKR>-NN`) on save.

Final AC line in file: `AC-<TKR>-NN.1: releaseLock asserts pre-state in_progress`
Filename: `specs/frs/<TKR>-NN.md`
Plan row: `| <TKR>-NN | Hide full 26-char ULIDs | linear:<TKR>-NN |`

### Mode: none exemption

Mode: none projects mint the short-ULID tail locally (collision-proof by Crockford Base32 randomness + scan). No tracker allocator, no race. The placeholder rule is tracker-mode only.

## Post-save behavior (tracker mode)

After each AC-list save in `specs/frs/<tracker-id>.md`'s
`## Acceptance Criteria` section:

1. Resolve the ticket-id for the edited FR directly from the filename
   (`<tracker-id>.md`) — the filename IS the binding, no separate
   traceability matrix is consulted. If the FR is brand-new and the
   filename still carries the `<tracker-id>` placeholder, prompt the
   user for a fresh `upsert_ticket_metadata(null, ...)` invocation that
   creates the ticket and substitutes the returned ID per the
   placeholder rule above.
2. Run ticket-binding confirmation per `docs/ticket-binding.md`.
3. Call `pull_acs(ticket_id)` — fresh fetch, just like `/implement` does.
4. Classify the local AC list vs the tracker AC list via the bidirectional
   diff classifier (`adapters/_shared/src/classify_diff.ts`). Full procedure
   in `docs/ac-sync.md`.
5. If any AC is non-`identical`, surface the Schema K diff and run the
   per-AC prompt loop. **Cancel aborts the save** — local changes revert
   to the in-memory draft state (the user re-decides).
6. On resolution (including `all identical` fast path), call
   `upsert_ticket_metadata(ticket_id, title, <rebuilt description>)` to
   push the converged state to the tracker.
   `git log` captures the sync event via the commit; no separate audit
   trail is written.

`/spec-write` on a brand-new FR (no ticket bound yet) skips steps 1–5 and
goes straight to `upsert_ticket_metadata(null, title, description)` to
mint a new ticket; the returned ID becomes the FR filename
(`specs/frs/<tracker-id>.md`) — the filename IS the binding (no
separate traceability matrix is maintained).

## Cancel semantics

- **During diff/resolve cancel (step 5):** local draft stays in memory;
  tracker untouched. User can retry or abandon.
- **During mint-new cancel:** no `upsert_ticket_metadata` call; no FR
  file is written to disk (the draft stays in memory — cancel here means
  "don't push to tracker, don't land the file yet").

## MCP call budget (NFR-8)

Per FR save: at most **1** MCP call (`upsert_ticket_metadata`, ≤ 1 per
spec). The additional `pull_acs` in step 3 is shared with the same skill's
pre-flight work and counts toward the 2-call `/implement` budget in
sessions where `/spec-write` chains into `/implement`.
