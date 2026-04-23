# `migration-none-to-linear` fixture

Scenario: a `mode: none` project with 3 FRs in `specs/requirements.md` runs
`/setup --migrate`, picks `linear`, and creates 3 Linear tickets. Local
`requirements.md` AC content is preserved unchanged (Path B, AC-36.4); the
traceability matrix's Implementation column gains `ticket=LIN-{id}` rows.

## Inputs (starting state)

- CLAUDE.md with NO `## Task Tracking` section (canonical `mode: none`).
- `specs/requirements.md` with FR-1, FR-2, FR-3, each holding 2–3 ACs.
- `specs/requirements.md` traceability matrix populated with source-file
  references but no tracker IDs.
- Linear MCP healthy; `bun --version` reports ≥ 1.2.

## Expected behavior

1. `/setup --migrate` detects current mode = `none`.
2. User picks `2. linear`. Target mode = `linear`.
3. Linear MCP detection / test call pass.
4. For each FR (in matrix order):
   1. `upsert_ticket_metadata(null, FR title, rendered description with
      back-link to `specs/requirements.md#FR-{N}`)`.
   2. Returned ticket id (e.g., `LIN-101`, `LIN-102`, `LIN-103`) captured
      into a pending buffer.
5. After all 3 succeed:
   - CLAUDE.md gains `## Task Tracking` section with `mode: linear` +
     `mcp_server: linear` + blank `active_ticket:`.
   - Traceability matrix Implementation column: `ticket=LIN-101` etc.
   - `git log` captures the migration commit; no separate audit trail is written (STE-58).
6. Local `specs/requirements.md` AC content byte-unchanged (Path B).

## Fail conditions

- Local AC bullets modified during migration (Path B violation).
- CLAUDE.md `## Task Tracking` written before all 3 `upsert` calls
  succeed (atomicity violation).
- Tracker-side tickets created with descriptions missing the back-link
  (AC-37.6 violation).
