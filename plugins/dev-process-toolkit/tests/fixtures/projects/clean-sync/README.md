# `clean-sync` fixture

Scenario: local `specs/requirements.md` ACs and tracker ACs are byte-identical
after normalization. FR-39 classifies every AC as `identical`, the per-AC
prompt is skipped, and `/implement` proceeds straight to Phase 1 with the
pull_acs result recorded in session memory.

## Inputs

- **Branch:** `feat/export-audit-log` with linked Linear ticket `LIN-42`.
- **CLAUDE.md `## Task Tracking`:**
  ```
  mode: linear
  mcp_server: linear
  active_ticket: LIN-42
  ```
- **Local `specs/requirements.md` FR block:**
  ```
  ### FR-7: Audit log export {#FR-7}

  - [ ] AC-7.1: Export entries as CSV
  - [x] AC-7.2: Date-range filter
  - [ ] AC-7.3: Include actor + action
  ```
- **Tracker description (Linear):** see `../../mcp/linear/get_issue.json`.
  Same three ACs, same states, after normalization.
- **Test seed time:** `DPT_TEST_FROZEN_TIME=2026-04-18T10:00:00Z` (so the
  sync-log entry, if any, is deterministic).

## Expected behavior

1. Schema L probe → `mode: linear`.
2. Ticket binding: Tier 1 branch regex matches `LIN-42`, Tier 2 matches,
   IDs equal — clean Tier-1 win, mandatory confirmation proceeds.
3. `pull_acs(LIN-42)` returns three `AcceptanceCriterion` objects; session
   records `updatedAt: 2026-04-17T12:34:56Z` from the fixture.
4. FR-39 diff: all three ACs classified `identical` after normalization.
5. No per-AC prompt; no `upsert_ticket_metadata` call.
6. No sync-log entry appended (AC-39.8 fires only on resolution events).
7. `/implement` continues to Phase 1 (AC checklist derivation) with the
   session-cached `AcList`.

## Fail conditions

- Any AC classified non-`identical` (would require per-AC prompt).
- MCP call count at startup > 1 (only `pull_acs` expected).
- Sync-log entry appended (no resolution event occurred).
