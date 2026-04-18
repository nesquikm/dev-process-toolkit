# `migration-tracker-to-none` fixture

Scenario: a `mode: linear` project with 3 tracker tickets runs
`/setup --migrate` and picks `none`. Each FR's tracker AC list is pulled,
reconciled against the local list via FR-39 per-AC prompts if drift
exists, and the resolved state is written back into
`specs/requirements.md`. Tracker tickets are left intact; user is
prompted to optionally close them (AC-36.5).

## Inputs

- CLAUDE.md `## Task Tracking`: `mode: linear`, `mcp_server: linear`,
  3 tickets linked via the traceability matrix.
- FR-1 & FR-2: tracker and local ACs are identical → FR-39 fast path,
  no prompts.
- FR-3: tracker has an extra `AC-3.4` (tracker-only) that local doesn't
  know about → FR-39 prompts once; user picks `keep tracker`.

## Expected behavior

1. `/setup --migrate` detects current mode = `linear`.
2. User picks `1. none`.
3. For each FR: `pull_acs` + classify + resolve (if needed).
4. After all 3 reconcile successfully:
   - `specs/requirements.md` FR-3 gains `AC-3.4` bullet.
   - CLAUDE.md `## Task Tracking` section is **removed** entirely
     (canonical `none` form per AC-29.5).
   - Sync log (before removal): `- <ISO> — Migration complete: linear → none, 3 FRs moved`.
     Note: removing the section drops the sync log with it; a final copy
     of the log is archived to `specs/archive/sync-log-<YYYY-MM>.md`
     per Pattern 5 before deletion.
5. Prompt: "Close the former Linear tickets now? [y/N]".
   - On `y` → `transition_status(ticket, done)` for each.
   - On `N` → tickets left Open; user can close them manually later.
6. No tracker tickets deleted — the plugin only transitions status.

## Fail conditions

- FR-39 prompts skipped on tracker-only ACs (would lose tracker content).
- CLAUDE.md `## Task Tracking` removed before all 3 FRs reconciled
  (atomicity violation).
- Any tracker ticket deleted (the plugin never deletes).
