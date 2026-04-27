# `/spec-write` Tracker Mode Flow

Detailed tracker-mode procedures for `/spec-write`. Pointed at from
`skills/spec-write/SKILL.md` step 0 to keep the skill under NFR-1.

In `mode: none`, this document is unused.

## Tracker ID Assignment Order (STE-66)

**Rule:** create the tracker ticket **first**, read the returned ID, substitute the placeholder globally, **then** write the FR file. **Never guess** the next sequential tracker number.

The order is load-bearing. Trackers skip cancelled numbers, renumber across workspace renames, and allocate IDs atomically on ticket creation — an implementer's guess ("STE-64 was last, so the next is STE-65") can be wrong silently, and the misalignment ships into every downstream artifact (AC prefixes, filename, plan-file row, every prose cross-reference).

### Concrete flow

1. **Draft with placeholder.** Use `<tracker-id>` (or adapter-specific rendering — `STE-<N>` for Linear, `PROJ-<N>` for Jira) throughout the draft:
   - AC lines: `AC-<tracker-id>.1`, `AC-<tracker-id>.2`, …
   - Filename: `<tracker-id>.md`
   - Plan-file table row: `| <tracker-id> | Title | <tracker>:<tracker-id> |`
   - Prose cross-references: `"closes <tracker-id>"`, `"supersedes <tracker-id>"`
2. **Create the tracker ticket.** Call `Provider.sync(spec)` → `upsertTicketMetadata(null, …)`. The tracker allocator returns the real ID (e.g., `STE-67`).
3. **Substitute globally.** Replace every `<tracker-id>` with the returned ID in one pass.
4. **Write the FR file.** Only after substitution completes — the file on disk never contains a placeholder.

### Worked example

Draft AC line: `AC-STE-<N>.1: releaseLock asserts pre-state in_progress`

Linear assigns `STE-67` on save.

Final AC line in file: `AC-STE-67.1: releaseLock asserts pre-state in_progress`
Filename: `specs/frs/STE-67.md`
Plan row: `| STE-67 | Hide full 26-char ULIDs | linear:STE-67 |`

### Mode: none exemption

Mode: none projects mint the short-ULID tail locally (collision-proof by Crockford Base32 randomness + scan). No tracker allocator, no race. The placeholder rule is tracker-mode only.

## Post-save behavior (tracker mode)

After each FR-level AC save in `specs/requirements.md`:

1. Resolve ticket-id for the edited FR via the traceability matrix row
   (FR-{N} → ticket-id). If the matrix has no row yet, prompt the user
   for a fresh `upsert_ticket_metadata(null, ...)` invocation that
   creates the ticket and writes the returned ID back into the matrix.
2. Run ticket-binding confirmation per `docs/ticket-binding.md` (STE-27).
3. Call `pull_acs(ticket_id)` — fresh fetch, just like `/implement` does.
4. Classify the local AC list vs the tracker AC list via the STE-17 diff
   classifier (`adapters/_shared/src/classify_diff.ts`). Full procedure
   in `docs/ac-sync.md`.
5. If any AC is non-`identical`, surface the Schema K diff and run the
   per-AC prompt loop. **Cancel aborts the save** — local changes revert
   to the in-memory draft state (the user re-decides).
6. On resolution (including `all identical` fast path), call
   `upsert_ticket_metadata(ticket_id, title, <rebuilt description>)` to
   push the converged state to the tracker (AC-STE-17.9, AC-STE-12.7).
   `git log` captures the sync event via the commit; no separate audit
   trail is written.

`/spec-write` on a brand-new FR (no ticket bound yet) skips steps 1–5 and
goes straight to `upsert_ticket_metadata(null, title, description)` to
mint a new ticket; the returned ID is written to the traceability matrix
(STE-14 AC-STE-14.4 pattern reused).

## Cancel semantics

- **During diff/resolve cancel (step 5):** local draft stays in memory;
  tracker untouched. User can retry or abandon.
- **During mint-new cancel:** no `upsert_ticket_metadata` call; no
  traceability matrix update; `specs/requirements.md` keeps whatever the
  user just saved (it's already on disk — cancel here means "don't push
  to tracker yet").

## MCP call budget (NFR-8)

Per FR save: at most **1** MCP call (`upsert_ticket_metadata`, ≤ 1 per
spec). The additional `pull_acs` in step 3 is shared with the same skill's
pre-flight work and counts toward the 2-call `/implement` budget in
sessions where `/spec-write` chains into `/implement`.
