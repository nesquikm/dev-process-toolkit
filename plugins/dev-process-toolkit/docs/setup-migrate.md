# `/setup --migrate` — Mode Migration (FR-36)

Distinct invocation of `/setup` that moves an existing project between
modes. Atomic per AC-36.7: any step failure leaves CLAUDE.md `mode:` and
`specs/` unchanged; partial tracker-side side effects are reported with a
retry/rollback prompt in NFR-10 canonical shape.

In `mode: none`, this document is **used**: migration is how a project
transitions out of `mode: none`. Running `/setup --migrate` on a project
that's already in `mode: none` with no tracker picked exits cleanly with a
one-line "nothing to migrate" message.

## Detect the current mode (AC-36.2)

1. Read CLAUDE.md and run the Schema L probe.
2. If no `## Task Tracking` section → current mode is `none`.
3. Otherwise, parse `mode: <value>` per Schema L read contract.

Report the detected current mode and prompt:

> Migrate from `<current>` to which mode? `1. none` / `2. linear` /
> `3. jira` / `4. asana` / `5. custom`. Enter 1–5 (must differ from
> current).

Refuse a no-op migration (`current === target`).

## Supported transitions (AC-36.3)

1. `none → <tracker>` — bulk-create tracker tickets for each FR in
   `specs/requirements.md`; record IDs in the traceability matrix. Local
   AC content is preserved unchanged (Path B, AC-36.4).
2. `<tracker> → none` — pull ACs from each FR's tracker ticket, reconcile
   via FR-39 if drift exists, write the resolved state into
   `specs/requirements.md`. Tracker tickets left intact; user prompted
   to optionally close them (AC-36.5).
3. `<tracker> → <other tracker>` — pull from old, reconcile with local
   via FR-39, push to new via `upsert_ticket_metadata`. Old tracker
   tickets NOT deleted. Traceability matrix rows updated (AC-36.6).

## Atomicity guarantee (AC-36.7)

Before any mutation:

- Read the current CLAUDE.md mode line (save in memory).
- Read the traceability matrix (save in memory).
- Read the full live `specs/requirements.md` (save in memory).

On **any** step failure during migration:

- **If nothing is written yet** → exit cleanly with NFR-10 canonical shape.
- **If partial tracker-side side effects already occurred** (e.g., 3 of 7
  FRs pushed before step 4 failed) → surface NFR-10 canonical shape,
  enumerate the partially-pushed tickets, and prompt:

  ```
  Migration failed mid-bulk: 3 of 7 tickets pushed before <step> failed.
  Remedy: choose — (a) retry remaining 4 FRs, or (b) roll back: I will delete the 3 pushed tickets via `upsert_ticket_metadata` (if deletion is supported) / report them for manual cleanup.
  Context: mode=<current>, ticket=bulk, skill=setup --migrate
  ```

- CLAUDE.md `mode:` line is **never** rewritten until the migration
  finishes successfully (AC-36.7 transactional guarantee).

## `none → <tracker>` procedure (AC-36.4, AC-36.8)

1. Verify Bun (AC-30.8), MCP configured, test call passes. Fail fast.
2. Run any tenant-specific discovery (Jira `jira_ac_field`, Asana
   `asana_status_convention`).
3. Iterate over each live FR in `specs/requirements.md`:
   1. Call `upsert_ticket_metadata(null, FR title, rendered description)`.
   2. Capture returned ticket id.
   3. Append to a pending `traceability-updates` buffer (in memory).
4. **Only after all FRs pushed successfully:** write the `## Task Tracking`
   section with `mode: <tracker>` + discovered keys to CLAUDE.md, and
   update the traceability matrix's Implementation column with
   `ticket=<id>` rows.
5. Sync-log append: `- <ISO> — <N> FRs migrated to <tracker>`.

Mid-bulk failure triggers the retry/rollback prompt above.

## `<tracker> → none` procedure (AC-36.5)

1. For each FR in the traceability matrix with a `ticket=<id>` entry:
   1. Call `pull_acs(ticket_id)`.
   2. Diff against local FR's AC list via FR-39 classifier.
   3. If any classification is non-`identical`, prompt per-AC
      (`keep local` / `keep tracker` / `merge` / `cancel`).
   4. Write the resolved AC list into `specs/requirements.md`.
2. **Only after all FRs reconciled successfully:** remove `## Task Tracking`
   from CLAUDE.md (back to canonical `none` form per AC-29.5).
3. Prompt the user: "Close the former tracker tickets now? [y/N]" — on
   `y`, call `transition_status(ticket, done)` for each. Declining leaves
   them open; the plugin never deletes tickets.

## `<tracker> → <other>` procedure (AC-36.6)

1. Run `<tracker> → none` internally (steps 1–2 above) but **don't**
   write the none-form yet.
2. Run `none → <other>` internally (steps 1–3 of the none→tracker
   procedure).
3. Write the new `## Task Tracking` section with `mode: <other>` only
   after both halves succeed. Old tracker tickets untouched.
4. Traceability matrix rows updated with new ticket IDs.

## Sync-log entry

After a completed migration, append one entry per AC-39.8 (same form,
different message):

```
- <ISO> — Migration complete: <from> → <to>, <N> FRs moved
```

## MCP call budget

Migration is the transactional exception to NFR-8's per-skill caps. An
`N-FR` migration makes up to `N` `upsert_ticket_metadata` calls plus `N`
`pull_acs` calls for the reconcile direction. Budget is per-migration,
not per-skill.
