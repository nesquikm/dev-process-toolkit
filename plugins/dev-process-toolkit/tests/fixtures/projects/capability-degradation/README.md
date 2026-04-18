# `capability-degradation` fixture

Scenario: a community custom adapter declares `capabilities:` without
`push_ac_toggle`. `/gate-check` passes, but instead of pushing AC
checkbox updates, surfaces an NFR-10 canonical-shape reminder per
FR-38 AC-38.6. Gate verdict is unaffected.

## Inputs

- Custom adapter at `adapters/custom-lightweight.md` with frontmatter:
  ```yaml
  capabilities:
    - pull_acs
    - transition_status
    - upsert_ticket_metadata
  # push_ac_toggle intentionally omitted
  ```
- CLAUDE.md `## Task Tracking`: `mode: custom-lightweight`.
- Gate commands pass; two ACs transitioned `false → true` this session.

## Expected behavior

1. `/gate-check` runs mode probe + ticket-binding + `updatedAt` re-check.
2. Gate commands pass → `GATE PASSED`.
3. Code review passes.
4. Drift check clean (or notes only).
5. **On pass, instead of firing `push_ac_toggle` per newly-satisfied AC**,
   the skill prints:

   ```
   Adapter custom-lightweight does not support push_ac_toggle — AC checkboxes must be toggled manually in the tracker.
   Remedy: open the ticket and toggle the passing ACs yourself, or upgrade the adapter.
   Context: mode=custom-lightweight, ticket=<ID>, skill=gate-check
   ```

6. Gate verdict remains `GATE PASSED` (capability missing is a warning,
   not a gate failure).
7. Analogous flows exist for `/pr` (missing `transition_status` →
   warning, PR created anyway) and `/spec-write` (missing
   `upsert_ticket_metadata` → warning, local save proceeds).

## Fail conditions

- Gate verdict downgraded to `GATE FAILED` or `GATE PASSED WITH NOTES`
  solely due to missing capability.
- Warning not in NFR-10 canonical shape.
- Any skill ERRORS out because a capability is missing (FR-38 AC-38.6
  explicitly calls for graceful degradation, not errors).
