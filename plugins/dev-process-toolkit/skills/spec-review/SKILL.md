---
name: spec-review
description: Review implementation against specs to find deviations, missing features, or inconsistencies. Use to audit whether the code matches what the specs require.
allowed-tools: Read, Glob, Grep
argument-hint: "[requirement-id or 'all']"
---

# Spec Review

Audit the implementation against the project specifications for: `$ARGUMENTS`

## Process

0. **Layout + tracker-mode probes** — Before any other step:

   - **Layout probe** — Read `specs/.dpt-layout`. If `version: v2`, source ACs from `specs/frs/<ulid>.md` files (glob the active set, not archive/). If marker absent + `specs/requirements.md` exists, run v1 behavior unchanged. If version > v2, exit with canonical message (AC-STE-29.3). Full reference: `docs/v2-layout-reference.md` § `/spec-review`.
   - **Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and ACs are read from specs (v1 `requirements.md` or v2 `frs/`). If a tracker mode is active, AC traversal pulls the canonical AC list from the active adapter's `pull_acs(ticket_id)` instead of parsing local specs; local `specs/` still provides FR titles, descriptions, and traceability context (Path B). See `docs/spec-review-tracker-mode.md` for the full tracker-mode flow.

1. **Read specs** — Load the relevant sections:
   - **v2 mode:** glob `specs/frs/*.md` (excluding `archive/`); each FR file contains Requirement, ACs, Technical Design, Testing, Notes (AC-STE-26.2). Plan files under `specs/plan/<M#>.md`.
   - **v1 mode:** the four top-level files (requirements, technical-spec, testing-spec, plan).

2. **Scan implementation** — For each requirement/AC:
   - Find the implementing code (service, component, route, test)
   - Check if the implementation matches the spec
   - Check if tests exist and cover the acceptance criteria

3. **Generate traceability map** — For each AC, trace to the implementing code and tests:

   ```
   AC-HG95V1.1 → src/feature.ts:42, tests/feature.test.ts:10
   AC-HG95V1.2 → (not found)
   AC-HG95TY.1 → src/service.ts:15, tests/service.test.ts:8
   ```

   - One line per AC, format: `AC-X.Y → file:line, test-file:line`
   - If no implementing code is found, use the literal marker `(not found)`
   - If code in changed files has no corresponding AC, flag it with the label `potential drift`

### Optional: Consult Archives

If — and only if — the user's query references a milestone ID or FR ULID that is **not present** in the live `specs/plan/` or `specs/frs/` tree, look it up directly in `specs/frs/archive/<ulid>.md` (for an archived FR) or `specs/plan/archive/<M#>.md` (for an archived milestone). The v2 layout has no rolling index file — the filename encodes the identifier. If the target file does not exist, skip silently — do not error.

Never read archived content during a normal review — only live spec files count. Archives are historical context for explicit queries, not a drift source.

4. **Report findings** as a table:

| Requirement | Status    | Implementation     | Notes                    |
| ----------- | --------- | ------------------ | ------------------------ |
| AC-HG95V1.1      | ✓ Done    | src/feature.ts:42  |                          |
| AC-HG95V1.2      | ✗ Missing | —                  | Not implemented          |
| AC-HG95V1.3      | ⚠ Partial | src/feature.ts:15  | Missing edge case        |

5. **Summary** — Overall completion %, critical gaps, and recommended next steps.
