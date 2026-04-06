---
name: spec-review
description: Review implementation against specs to find deviations, missing features, or inconsistencies. Use to audit whether the code matches what the specs require.
allowed-tools: Read, Glob, Grep
argument-hint: "[requirement-id or 'all']"
---

# Spec Review

Audit the implementation against the project specifications for: `$ARGUMENTS`

## Process

1. **Read specs** — Load the relevant sections from specs/ directory:
   - Requirements (functional requirements and acceptance criteria)
   - Technical spec (architecture and implementation details)
   - Testing spec (test coverage and conventions)
   - Plan (milestone definitions)

2. **Scan implementation** — For each requirement/AC:
   - Find the implementing code (service, component, route, test)
   - Check if the implementation matches the spec
   - Check if tests exist and cover the acceptance criteria

3. **Generate traceability map** — For each AC, trace to the implementing code and tests:

   ```
   AC-1.1 → src/feature.ts:42, tests/feature.test.ts:10
   AC-1.2 → (not found)
   AC-2.1 → src/service.ts:15, tests/service.test.ts:8
   ```

   - One line per AC, format: `AC-X.Y → file:line, test-file:line`
   - If no implementing code is found, use the literal marker `(not found)`
   - If code in changed files has no corresponding AC, flag it with the label `potential drift`

4. **Report findings** as a table:

| Requirement | Status    | Implementation     | Notes                    |
| ----------- | --------- | ------------------ | ------------------------ |
| AC-1.1      | ✓ Done    | src/feature.ts:42  |                          |
| AC-1.2      | ✗ Missing | —                  | Not implemented          |
| AC-1.3      | ⚠ Partial | src/feature.ts:15  | Missing edge case        |

5. **Summary** — Overall completion %, critical gaps, and recommended next steps.
