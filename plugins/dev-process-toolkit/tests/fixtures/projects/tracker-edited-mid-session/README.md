# `tracker-edited-mid-session` fixture

Scenario: user runs `/implement` (records `updatedAt: T0`), then PM edits the
tracker ticket while implementation is in progress. When the user runs
`/gate-check`, the re-fetch returns `updatedAt: T1 > T0`. AC-33.3 surfaces a
mismatch warning with exactly two options per AC-39.10 (retry or proceed);
no FR-39 resolution runs in `/gate-check`.

## Inputs

- **Ticket:** Linear `LIN-42` (same as `clean-sync` fixture).
- **Session state (from `/implement` start):** `updatedAt: 2026-04-17T12:34:56Z`.
- **Re-fetch at `/gate-check` start:** `updatedAt: 2026-04-18T09:15:00Z`
  (later than session value).

## Expected behavior

1. `/gate-check` runs the Schema L probe → `mode: linear`.
2. Ticket binding: Tier 1 matches `LIN-42`, confirmation passes.
3. `pull_acs(LIN-42)` returns the re-fetched ticket; session compares
   `2026-04-18T09:15:00Z` vs `2026-04-17T12:34:56Z` → mismatch.
4. Canonical-shape warning printed:

   ```
   Ticket was modified since /implement — review changes before proceeding.
   Remedy: choose — (a) retry after /implement (runs FR-39 diff/resolve), or (b) proceed knowing the session is stale.
   Context: mode=linear, ticket=LIN-42, skill=gate-check
   ```

5. User picks `a` → skill exits cleanly; no gate commands run; no pushes.
6. User picks `b` → gate commands run, code review runs, drift check runs;
   on gate pass, `push_ac_toggle` calls fire for newly-satisfied ACs.

## Fail conditions

- FR-39 resolution loop fires in `/gate-check` (AC-39.10 forbids this).
- No warning printed despite `updatedAt` mismatch.
- Warning surfaces but is not in NFR-10 canonical shape.
