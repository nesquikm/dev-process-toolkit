---
name: spec-review
description: Review implementation against specs to find deviations, missing features, or inconsistencies. Use to audit whether the code matches what the specs require.
allowed-tools: Read, Glob, Grep
argument-hint: "[requirement-id or 'all']"
---

# Spec Review

Audit the implementation against the project specifications for: `$ARGUMENTS`

## Process

0. **Tracker-mode probe** — Before any other step:

   - Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and ACs are read from `specs/frs/*.md`. If a tracker mode is active, AC traversal pulls the canonical AC list from the active adapter's `pull_acs(ticket_id)` instead of parsing local specs; local `specs/` still provides FR titles, descriptions, and traceability context (Path B). See `docs/spec-review-tracker-mode.md` for the full tracker-mode flow.

1. **Read specs** — Load the relevant sections:
   - Glob `specs/frs/*.md` (excluding `archive/`); each FR file contains Requirement, ACs, Technical Design, Testing, Notes. Plan files under `specs/plan/<M#>.md`.

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

If — and only if — the user's query references a milestone ID, tracker ref, or short-ULID tail that is **not present** in the live `specs/plan/` or `specs/frs/` tree, look it up directly in `specs/frs/archive/<name>.md` (where `<name>` is the tracker-ID or short-ULID stem) or `specs/plan/archive/<M#>.md` (for an archived milestone). There is no rolling index file — the filename encodes the identifier. If the target file does not exist, skip silently — do not error.

Never read archived content during a normal review — only live spec files count. Archives are historical context for explicit queries, not a drift source.

4. **Report findings** as a table:

| Requirement | Status    | Implementation     | Notes                    |
| ----------- | --------- | ------------------ | ------------------------ |
| AC-HG95V1.1      | ✓ Done    | src/feature.ts:42  |                          |
| AC-HG95V1.2      | ✗ Missing | —                  | Not implemented          |
| AC-HG95V1.3      | ⚠ Partial | src/feature.ts:15  | Missing edge case        |

5. **Summary** — Overall completion %, critical gaps, and recommended next steps.

## Live-spec drift refresh hint

After the verdict line is rendered (before the closing summary at step 5), count the cross-cutting drifts surfaced during the audit — every entry tagged `potential drift` or any housekeeping drift in `specs/requirements.md`, `specs/technical-spec.md`, or `specs/testing-spec.md` that the report flagged.

When `drift_count >= 2`, emit the literal line at the end of the report:

```
Live-spec refresh suggested — N drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.
```

Substitute `N` with the actual count. When `drift_count` is `0` or `1`, **omit** the hint entirely — the verdict line stands alone.

**Threshold rationale (`>= 2`, not `> 0`).** `/implement` routinely produces single-line cosmetic drifts during normal /implement churn (e.g., a stale `<!-- TODO -->` comment, a placeholder line whose path was just renamed). Surfacing a refresh hint on every single-drift audit would train operators to ignore it. `>= 2` means "drift is accumulating" — actionable, worth interrupting for.

The threshold + literal-line shape live in `adapters/_shared/src/spec_review_drift_hint.ts` (`formatDriftHint(count)`) so the rule is integration-testable across `0` / `1` / `2` / `4` drift fixtures (`tests/spec-review-drift-hint.test.ts`). The LLM emits the helper's exact return value when drift count crosses threshold; bypassing the helper string and re-deriving the line inline is a contract violation caught by the doc-conformance test.
