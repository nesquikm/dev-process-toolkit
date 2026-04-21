# FR-39 — Bidirectional AC Sync

The diff/resolve loop that runs before `/implement` and after `/spec-write`
save. Pointed at from `docs/implement-tracker-mode.md` and
`docs/spec-write-tracker-mode.md`.

In `mode: none`, this document is unused.

## When FR-39 fires

- `/implement` pre-flight (after ticket-binding + `pull_acs`, before Phase 1).
- `/spec-write` post-save of any FR-level AC edit (before `upsert_ticket_metadata`).

`/gate-check` detects `updatedAt` mismatch (AC-33.3) but does **not** run
FR-39 — it offers two options (retry-via-`/implement`, proceed-stale) per
AC-39.10. `/pr` does not run FR-39 at all.

## Inputs

1. **Local AC list** — parsed from the FR block in `specs/requirements.md`:
   ```
   ### FR-{N}: ... {#FR-{N}}
   - [ ] AC-{N}.{M}: <text>
   ```
2. **Tracker AC list** — returned by the active adapter's
   `pull_acs(ticket_id)` as Schema N `AcceptanceCriterion[]`.

Both lists are normalized through the adapter's normalizer before diffing
(AC-39.6). For Linear this is `adapters/linear/src/normalize.ts`; other
adapters normalize equivalently (Jira: trim + collapse whitespace).

## Classifier (Schema K format)

Each AC position is classified as exactly one of:

- **identical** — same `id` on both sides, same text (after normalization),
  same `completed` state.
- **local-only** — `id` present locally, absent from tracker.
- **tracker-only** — `id` present in tracker, absent locally.
- **edited-both** — `id` present on both sides but text differs (after
  normalization) or `completed` differs.

Output form is one line per AC (Schema K, NFR-4):

```
AC-{N}.{M}: <classification> | local: "<text>" | tracker: "<text>"
```

For `local-only`, `tracker` is `"<absent>"`; for `tracker-only`, `local`
is `"<absent>"`. Skills render this table before the per-AC prompt so
users can see the full diff at once.

## Per-AC prompt (AC-39.3)

For each non-`identical` AC:

```
AC-{N}.{M}: <classification>
  local:    "<text>"  [<completed-state>]
  tracker:  "<text>"  [<completed-state>]

Resolve: (1) keep local  (2) keep tracker  (3) merge  (4) cancel
[1-4]:
```

Responses:

1. **Keep local** — overwrite tracker-side AC. Tracker push happens after
   all per-AC resolutions are collected (one `upsert_ticket_metadata`
   call per event, not per AC).
2. **Keep tracker** — overwrite local-side AC. `specs/requirements.md`
   rewritten after all resolutions are collected (one file write per
   event, not per AC).
3. **Merge** — open a minimal text-editor prompt (heredoc) with both
   versions as commented context; user writes the merged text; apply to
   both sides.
4. **Cancel** — abort the entire skill cleanly with zero state mutation
   on either side (AC-39.5). Cancel on any AC cancels the whole
   resolution event, not just that AC.

No bulk shortcuts like `accept all tracker` (AC-39.7). Shortcuts hide the
drift the sync is supposed to surface.

## Two-side convergence (AC-39.4)

After the user answers all prompts:

1. Apply all per-AC resolutions to both sides.
2. **Local side write** — rewrite the FR block's AC list in
   `specs/requirements.md`. Preserve FR title, description, anchor
   (`{#FR-{N}}`), and any non-AC content.
3. **Tracker side write** — call `upsert_ticket_metadata(ticket_id, title,
   <rebuilt description>)`. For Linear, the description includes the
   normalized AC block. For Jira, the custom field.
4. **Verify convergence** — if `tracker_ticket_description_template`
   normalization is deterministic, a second `pull_acs` after this push
   classifies everything as `identical` (AC-39.6 round-trip invariant).

## Sync-log append (AC-39.8)

After a successful resolution event, append exactly one line to the
`### Sync log` subsection under `## Task Tracking` in CLAUDE.md:

```
- <ISO timestamp> — <N> AC conflicts resolved on <ticket-id>
```

- `<ISO timestamp>` is `DPT_TEST_FROZEN_TIME` if set (determinism helper
  per testing-spec §6.7), else `new Date().toISOString()`.
- `<N>` is the total count of resolved per-AC prompts (not the count of
  AC options picked).
- `<ticket-id>` is the resolved ticket.

No resolution event ⇒ no sync-log entry (`identical`-only runs stay
silent; `cancel` runs stay silent per AC-39.5).

The log is append-only. `/spec-archive` eventually rotates old entries to
`specs/archive/sync-log-<YYYY-MM>.md` to preserve NFR-5 (Pattern 5).

## Idempotence

Running FR-39 twice in a row on an already-converged state emits **zero
prompts** (all `identical`) and **zero side effects** (no pushes, no
sync-log entry). This is the round-trip invariant that AC-39.6 guarantees
via adapter normalization.

## Cancel semantics (AC-39.5)

Cancel on **any** prompt:

- **No local file writes** — `specs/requirements.md` unchanged.
- **No tracker writes** — `upsert_ticket_metadata` not called.
- **No sync-log entry** — the event didn't complete.
- Skill exits cleanly; the user can re-run `/implement` later once they've
  decided how to resolve.

The cancel path is the safety valve for "I don't know, let me think" —
explicit, side-effect-free, and always available.
