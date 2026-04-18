# `migration-atomicity-fail` fixture

Scenario: `/setup --migrate` `none → linear` on a 3-FR project. `upsert_ticket_metadata`
succeeds for FR-1 and FR-2 but the third call fails (simulated network
timeout). CLAUDE.md mode is never rewritten; `specs/requirements.md` is
untouched. The user sees the retry/rollback prompt in NFR-10 canonical
shape (AC-36.7).

## Inputs

- Same starting state as `migration-none-to-linear`, plus a test-harness
  flag that causes the MCP's 3rd `upsert_ticket_metadata` to fail.

## Expected behavior

1. `/setup --migrate none → linear` begins.
2. FR-1 pushed successfully → `LIN-101` captured in-memory.
3. FR-2 pushed successfully → `LIN-102` captured in-memory.
4. FR-3 push fails (timeout).
5. Migration **aborts**. CLAUDE.md is NOT modified (no `## Task Tracking`
   section added). Traceability matrix NOT modified. Local
   `specs/requirements.md` byte-unchanged (AC-36.7).
6. Canonical-shape prompt:

   ```
   Migration failed mid-bulk: 2 of 3 tickets pushed before upsert(FR-3) failed.
   Remedy: choose — (a) retry FR-3 (LIN-101 and LIN-102 remain as-is), or (b) roll back: I will delete LIN-101 and LIN-102 via upsert_ticket_metadata (if your tracker supports it) / report them for manual cleanup.
   Context: mode=none, ticket=bulk, skill=setup --migrate
   ```

7. User picks (a): retry just the FR-3 push. If it succeeds, migration
   completes normally.
8. User picks (b): call `transition_status(LIN-101, done)` +
   `transition_status(LIN-102, done)` (best approximation of "roll back"
   since Linear tickets can't be deleted); report the IDs for manual
   review. Then exit with `mode: none` preserved.

## Fail conditions

- CLAUDE.md `## Task Tracking` added after FR-1/FR-2 succeed but FR-3 failed.
- Traceability matrix rows inserted for FR-1/FR-2 despite aborted migration.
- Prompt not in NFR-10 canonical shape.
- Silent deletion of LIN-101/LIN-102 without prompting.
