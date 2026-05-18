---
name: spec-review
description: Review implementation against specs to find deviations, missing features, or inconsistencies. Use to audit whether the code matches what the specs require.
allowed-tools: Read, Glob, Grep, Skill
argument-hint: "[requirement-id or 'all']"
---

# Spec Review (Orchestrator)

Audit the implementation against the project specifications for: `$ARGUMENTS`

The orchestrator runs in the **main context** (no `context: fork`) so it can parse arguments, resolve scope, drive the fork, parse the returned `spec-review-result` fenced block, and render the user-facing report. The actual audit work — reading FRs, tracing ACs to code/tests, classifying Done/Missing/Partial, scanning for cross-cutting drift — happens inside the forked `spec-reviewer` subagent via the `spec-review-audit` child skill. This isolates the read-only audit pass from the orchestrator's argument-parsing + report-rendering surface (second canonical instance of the audit-fix loop pattern after `/tdd`).

## Process

0. **Tracker-mode probe** — Before any other step:

   - Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none` and ACs are read from `specs/frs/*.md`. If a tracker mode is active, AC traversal pulls the canonical AC list from the active adapter's `pull_acs(ticket_id)` instead of parsing local specs; local `specs/` still provides FR titles, descriptions, and traceability context (Path B). See `docs/spec-review-tracker-mode.md` for the full tracker-mode flow.

1. **Parse arguments + resolve scope** — `$ARGUMENTS` is one of:

   - a single requirement / FR id (`STE-NNN`, ULID, or `specs/frs/<id>.md` path)
   - a milestone id (`M<N>`)
   - the literal `all` (audit every live FR)

   Resolve to a list of FR file path(s) under `specs/frs/` (excluding `archive/`) and the changed-files surface to scan. This is the per-invocation input the audit fork needs — the orchestrator does not read the FR bodies itself; it hands the paths to the fork.

2. **Dispatch the audit fork** — Invoke `Skill('dev-process-toolkit:spec-review-audit')` with the rendered prompt body:

   - The resolved FR file path(s).
   - The changed-files / source-tree surface to scan.
   - The project test command (from CLAUDE.md Key Commands / Gating rule) so the fork can confirm GREEN before classifying.

   The child skill carries `context: fork` + `user-invocable: false` + `agent: spec-reviewer`. It runs in an isolated context with a read-only toolset (`Read, Grep, Glob`); it cannot Write, Edit, run Bash, or spawn nested Agents. It does the trace + classify + drift-scan work and ends its turn with exactly one fenced ` ```spec-review-result ` block.

3. **Parse the fenced block** — Call `parseSpecReviewResultBlock(stdout)` from `adapters/_shared/src/spec_review_result.ts` on the child's full output. The parser returns `{ ok: true, block }` on conforming output or `{ ok: false, reason }` on a format violation. The block payload is:

   ```
   block.traceability      // one row per AC: { ac, impl, test, status }
   block.advisory_findings // bullet entries from `## Findings`
   block.drift_entries     // bullet entries from `## Drift hints`
   block.drift_count       // == drift_entries.length (sentinel `(none)` excluded)
   ```

4. **Render the user-facing report** — Emit, in this order:

   a. **Traceability map** — one line per AC, format `AC-X.Y → file:line, test-file:line` (or `(not found)` for `status: missing`):

   ```
   AC-HG95V1.1 → src/feature.ts:42, tests/feature.test.ts:10
   AC-HG95V1.2 → (not found)
   AC-HG95TY.1 → src/service.ts:15, tests/service.test.ts:8
   ```

   b. **Status table**:

   | Requirement  | Status    | Implementation     | Notes                    |
   | ------------ | --------- | ------------------ | ------------------------ |
   | AC-HG95V1.1  | ✓ Done    | src/feature.ts:42  |                          |
   | AC-HG95V1.2  | ✗ Missing | —                  | Not implemented          |
   | AC-HG95V1.3  | ⚠ Partial | src/feature.ts:15  | Missing edge case        |

   c. **Drift hint** (see § Live-spec drift refresh hint below — fed by `block.drift_count`).

   d. **Summary** — Overall completion %, critical gaps, recommended next steps.

### Optional: Consult Archives

If — and only if — the user's query references a milestone ID, tracker ref, or short-ULID tail that is **not present** in the live `specs/plan/` or `specs/frs/` tree, look it up directly in `specs/frs/archive/<name>.md` (where `<name>` is the tracker-ID or short-ULID stem) or `specs/plan/archive/<M#>.md` (for an archived milestone). There is no rolling index file — the filename encodes the identifier. If the target file does not exist, skip silently — do not error.

Never read archived content during a normal review — only live spec files count. Archives are historical context for explicit queries, not a drift source.

## Parser-failure / format-violation path

`parseSpecReviewResultBlock` returns `{ ok: false, reason }` when the child's output is missing the fence, carries multiple fences, has a wrong `role:` line, is missing one of the required sections (`## Traceability map`, `## Findings`, `## Drift hints`), or has a malformed traceability row.

On the first format violation, the orchestrator performs a **single bounded retry** per the audit-fork mode-D pattern: re-invoke `Skill('dev-process-toolkit:spec-review-audit')` with the narrow retry prompt "re-emit your last message with a valid `spec-review-result` fenced block at the end of your turn." No semantic re-prompt — the retry budget is one round, format-only, and runs independently of any semantic-failure budget (mirroring `/tdd`'s mode-D contract).

On the second format violation, the orchestrator **halts** with the NFR-10 canonical refusal shape — a single `file:line — reason` note naming the offending part of the child's output (carried from the parser's `reason` string), followed by a remedy line pointing the operator at the audit-fork contract (`agents/spec-reviewer.md` + `skills/spec-review-audit/SKILL.md`). The halt is a real failure surfacing, not a routine pause; the orchestrator does not silently emit a partial report.

## Live-spec drift refresh hint

After the verdict line is rendered (before the closing summary at step 4d), feed `block.drift_count` to `formatDriftHint(count)` from `adapters/_shared/src/spec_review_drift_hint.ts`. The helper owns the threshold (`>= 2`) and the literal line shape — the orchestrator emits the helper's return value verbatim when it is non-null:

```
Live-spec refresh suggested — N drift(s) found in cross-cutting specs; consider rerunning /spec-write before next /implement.
```

When `drift_count` is `0` or `1`, `formatDriftHint` returns `null` and the orchestrator **omits** the hint entirely — the verdict line stands alone.

**Threshold rationale (`>= 2`, not `> 0`).** `/implement` routinely produces single-line cosmetic drifts during normal /implement churn (e.g., a stale `<!-- TODO -->` comment, a placeholder line whose path was just renamed). Surfacing a refresh hint on every single-drift audit would train operators to ignore it. `>= 2` means "drift is accumulating" — actionable, worth interrupting for.

The threshold + literal-line shape live in `adapters/_shared/src/spec_review_drift_hint.ts` (`formatDriftHint(count)`) so the rule is integration-testable across `0` / `1` / `2` / `4` drift fixtures (`tests/spec-review-drift-hint.test.ts`). Per the migration split: the audit fork emits the count (so `drift_count >= 2` is the canonical threshold check), main emits the line — both halves of the rule remain testable, and bypassing the helper string and re-deriving the line inline is a contract violation caught by the doc-conformance test.

## Rules

- Do NOT bypass the hand-off contract — `spec-review-result` is the only return channel from the fork.
- Do NOT read FR bodies in the orchestrator — that's the fork's job (it has read-only `Read, Grep, Glob`).
- Do NOT re-derive the drift-hint line inline — emit the literal return value of `formatDriftHint(block.drift_count)`.
- Do NOT loop on format violations — single bounded retry, then halt with NFR-10 refusal shape.
