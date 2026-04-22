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
> `3. jira` / `4. custom`. Enter 1–4 (must differ from current).

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

## Pre-migration on-disk backup (defensive)

The atomicity guarantee above is an in-session contract — it depends on
the skill following this document on every run. As a defense-in-depth
safeguard for the two paths that **write to local source-of-truth files**
(`<tracker> → none` and `<tracker> → <other tracker>`, both via FR-39
reconciliation), copy the files that the migration may rewrite to
timestamped backups **before any local mutation**:

```
cp CLAUDE.md                 CLAUDE.md.pre-migrate-backup-<ISO>
cp specs/requirements.md     specs/requirements.md.pre-migrate-backup-<ISO>
```

`<ISO>` is `YYYY-MM-DDTHH-MM-SSZ` (colons replaced with dashes for
filename portability). Print one line so the operator knows the backup
exists and can recover from it:

```
Pre-migrate backup written: CLAUDE.md.pre-migrate-backup-<ISO>, specs/requirements.md.pre-migrate-backup-<ISO>
If anything looks wrong after migration, restore with: mv <backup> <original>
```

Rules:

- Skip this step for `none → <tracker>` migrations — that path does not
  touch local files until success, so the in-session in-memory snapshot
  in the Atomicity section above is sufficient.
- Backups are **not** auto-deleted on success. The operator decides when
  to remove them. They sort lexically by timestamp, so a follow-up run
  never overwrites an earlier backup.
- Add `*.pre-migrate-backup-*` to `.gitignore` if the project has one
  (offer to do this automatically).
- A failed `cp` (disk full, permissions) hard-stops the migration with
  an NFR-10 canonical-shape error before any further work — no backup,
  no migration.

## `none → <tracker>` procedure (AC-36.4, AC-36.8)

1. Verify Bun (AC-30.8), MCP configured, test call passes. Fail fast.
2. Run any tenant-specific discovery (Jira `jira_ac_field`).
3. **Discover the FR list — layout-aware.** Read `specs/.dpt-layout`
   version and branch (AC-57.1):

   - **v2 layout** — iterate `readdirSync(specsDir + '/frs')` (same
     parser used by `regenerateIndex`), parse each file's YAML
     frontmatter via `parseFrontmatter`, and skip anything under
     `specs/frs/archive/` (AC-57.2). Archived FRs (`status: archived`
     / files under the `archive/` subdir) are excluded because they
     shipped in a prior release and have no active tracker target.
   - **v1 layout** — iterate `### FR-{N}:` blocks in
     `specs/requirements.md` as today.

   **Refuse an empty tree (AC-57.5).** If `specs/.dpt-layout` is absent
   AND `specs/requirements.md` is absent AND `specs/frs/` is absent,
   stop migration with the NFR-10 canonical shape:

   ```
   No specs/ content found; nothing to migrate.
   Remedy: run `/setup` to scaffold specs first, then retry `/setup --migrate`.
   Context: mode=none, ticket=none, skill=setup --migrate
   ```

   **Emit a structured summary + confirm (AC-57.4).** Before any
   `upsert_ticket_metadata` call, print exactly:

   ```
   Found N FRs in <layout> layout; will create N tracker tickets.
   ```

   where `<layout>` is `v1` or `v2` and `N` is the discovered count.
   Require explicit user confirmation before proceeding — declining
   exits cleanly per AC-36.7 atomicity (nothing written, no tickets
   created).

   For each discovered FR:
   1. Call `upsert_ticket_metadata(null, FR title, rendered description)`.
   2. Capture returned ticket id.
   3. Append to a pending `bindings` buffer (in memory) as
      `{ frPath, trackerKey, ticketId }`.
4. **Only after all FRs pushed successfully:** write the `## Task Tracking`
   section with `mode: <tracker>` + discovered keys to CLAUDE.md, then
   record each binding (AC-58.1, AC-58.3):

   - **v2 layout** — for each entry in the `bindings` buffer, call
     `setTrackerBinding(frFileContents, trackerKey, ticketId)` from
     `adapters/_shared/src/frontmatter.ts` and write the updated body
     back to `specs/frs/<ulid>.md`. The helper produces the canonical
     multi-line form (`tracker:\n  <key>: <id>`) that the parser + INDEX
     generator expect — never the ad-hoc inline `{}` form (AC-58.4).
     Existing `tracker:` entries are preserved alphabetically so a
     second migration into a different tracker (`<tracker> → <other>`,
     AC-58.2 / AC-42.5) merges instead of overwriting. `tracker: {}` is
     valid only as the empty-state seed emitted by FR creation.

   - **v1 layout** — update the traceability matrix's Implementation
     column with `ticket=<id>` rows (AC-58.3, backward compat).

   **Frontmatter write failure after a successful push is a partial
   failure (AC-58.5).** If disk-full / permission errors interrupt the
   per-FR binding write after `upsert_ticket_metadata` has already
   created the ticket, the CLAUDE.md `mode:` line is NOT written and
   migration surfaces an NFR-10 canonical-shape error:

   ```
   Migration failed mid-bind: K of N frontmatter writes succeeded before <file> failed (<reason>).
   Remedy: choose — (a) retry the remaining N-K bindings, or (b) roll back: delete the K tracker tickets via `upsert_ticket_metadata` and re-run migration from scratch.
   Un-bound FRs (tickets created, frontmatter NOT updated): <list of FR ULIDs + ticket IDs>
   Context: mode=none, ticket=bulk, skill=setup --migrate
   ```

   The operator resolves before CLAUDE.md is touched — atomicity
   guarantee (AC-36.7) extends through step 4.
5. **Regenerate `specs/INDEX.md`** (FR-61 AC-61.1/AC-61.4) — call
   `regenerateIndex(specsDir)` from
   `adapters/_shared/src/index_gen.ts`. This runs inside the atomicity
   boundary (AC-36.7, AC-61.2): if regen fails, the CLAUDE.md `mode:`
   line is NOT written and migration surfaces an NFR-10 canonical-shape
   error listing the frontmatter-bound FRs so the operator can reverse
   the bindings manually. FR-40 AC-40.4 requires INDEX to be rebuilt
   by any skill that writes under `specs/frs/`; migration wrote N
   bindings, so regen is mandatory.
6. Sync-log append: `- <ISO> — <N> FRs migrated to <tracker>`.

Mid-bulk failure triggers the retry/rollback prompt above.

## `<tracker> → none` procedure (AC-36.5)

0. **Pre-migration backup** — copy CLAUDE.md and `specs/requirements.md`
   to `*.pre-migrate-backup-<ISO>` per the section above. This is the
   highest-risk migration direction (local file becomes the new source
   of truth); the on-disk backup is the recovery path of last resort.
1. For each FR in the traceability matrix with a `ticket=<id>` entry:
   1. Call `pull_acs(ticket_id)`.
   2. Diff against local FR's AC list via FR-39 classifier.
   3. If any classification is non-`identical`, prompt per-AC
      (`keep local` / `keep tracker` / `merge` / `cancel`).
   4. Write the resolved AC list into `specs/requirements.md`.
2. **Only after all FRs reconciled successfully:** remove the `tracker:`
   entry for the departing tracker from each FR's frontmatter under
   `specs/frs/` (v2) or clear the traceability-matrix `ticket=<id>`
   column (v1).
3. **Regenerate `specs/INDEX.md`** (FR-61 AC-61.5) — call
   `regenerateIndex(specsDir)` from
   `adapters/_shared/src/index_gen.ts`. Same rule as `none → <tracker>`
   direction: any frontmatter write triggers regen per FR-40 AC-40.4.
   Inside the atomicity boundary (AC-36.7): if regen fails, CLAUDE.md
   mode line stays untouched.
4. Remove `## Task Tracking` from CLAUDE.md (back to canonical `none`
   form per AC-29.5).
5. Prompt the user: "Close the former tracker tickets now? [y/N]" — on
   `y`, call `transition_status(ticket, done)` for each. Declining leaves
   them open; the plugin never deletes tickets.

## `<tracker> → <other>` procedure (AC-36.6)

0. **Pre-migration backup** — copy CLAUDE.md and `specs/requirements.md`
   to `*.pre-migrate-backup-<ISO>` per the section above. This path runs
   `<tracker> → none` reconciliation internally, which writes to local
   files; the backup covers a partial-FR-39 failure scenario.
1. Run `<tracker> → none` internally (steps 1–2 above) but **don't**
   write the none-form yet.
2. Run `none → <other>` internally (steps 1–3 of the none→tracker
   procedure).
3. **Regenerate `specs/INDEX.md`** (FR-61 AC-61.5) — call
   `regenerateIndex(specsDir)` once, after both halves have written
   their frontmatter changes. Inside the atomicity boundary
   (AC-36.7): if regen fails, the new `## Task Tracking` section is
   NOT written.
4. Write the new `## Task Tracking` section with `mode: <other>` only
   after both halves succeed AND INDEX regenerated. Old tracker
   tickets untouched.
5. Traceability matrix rows / FR frontmatter updated with new ticket IDs.

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
