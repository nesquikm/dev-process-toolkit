# `empty-ac` fixture

Scenario: tracker ticket has no `## Acceptance Criteria` section (Linear) /
empty custom field (Jira) / no subtasks (Asana). The adapter's parser
returns an empty list. Every mode-aware skill that calls `pull_acs` must
fail with NFR-10 canonical shape per AC-35.4 — **never** silently proceed.

## Inputs

- **Linear fixture:** `tests/fixtures/mcp/linear/get_issue_empty_ac.json`
- Parser (`adapters/linear/src/normalize.ts`) returns the bare header
  string `"## Acceptance Criteria\n"` which downstream parsing classifies
  as empty.

## Expected behavior

On `/implement` or `/gate-check` or `/spec-write` entry in tracker mode:

1. Adapter parser returns `AcList = []`.
2. Skill surfaces this canonical-shape error (AC-35.4):

   ```
   No acceptance criteria found in ticket LIN-99.
   Remedy: add ACs to the ticket (Linear: under "## Acceptance Criteria" in the description) and re-run, or switch to `mode: none` if this ticket doesn't follow the AC convention.
   Context: mode=linear, ticket=LIN-99, skill=<invoking skill>
   ```

3. Skill exits cleanly; no TDD, no gate commands, no pushes.

## Fail conditions

- Skill proceeds past pre-flight with an empty AC list (silently treats
  "no ACs" as "nothing to do").
- Error message lacks the `Remedy:` / `Context:` lines.
- Raw ticket description is fed into the model instead of the parsed AC
  list (FR-35 AC-35.2, AC-35.3 boundary violation).
