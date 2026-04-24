---
id: fr_01KPZ7GRFS7EK16T50A8EXVE9M
title: Release-prep mechanicals (10 findings consolidated)
milestone: M22
status: archived
archived_at: 2026-04-24T08:44:27Z
tracker:
  linear: STE-78
created_at: 2026-04-24T07:53:39Z
---

## Requirement

Ten independent doc/config drift items surfaced by the audit. Each is a one-shot edit; together they bring the v1.22.0 release-checklist surfaces into alignment with code reality.

Covered audit findings: H1 (`.gitignore` uncommitted), H2 (plugin.json keyword sync), H5 (broken v2-layout-reference fixture link), L1 (bare-vs-qualified skill-ref convention doc), L2 (spec-archive description trim), L4 (skill-anatomy stale version pin), L8 (CHANGELOG total-tests line), M5 (README Python stack), M6 (CHANGELOG STE-64 test counts), M7 (CHANGELOG STE-65 test counts).

## Acceptance Criteria

- AC-STE-78.1: `.gitignore` commit including the `.mcp.json` line lands on `feat/m12-tracker-integration`.
- AC-STE-78.2: `plugins/dev-process-toolkit/.claude-plugin/plugin.json:12` keywords include `"code-review"`; the exact set matches `.claude-plugin/marketplace.json:16` tags.
- AC-STE-78.3: `plugins/dev-process-toolkit/docs/v2-layout-reference.md:92` `lock-scenarios` fixture bullet removed.
- AC-STE-78.4: `plugins/dev-process-toolkit/docs/skill-anatomy.md:179` version pin updated from `v1.12.0` to `v1.22.0` (or version pin removed).
- AC-STE-78.5: `plugins/dev-process-toolkit/skills/spec-archive/SKILL.md:3` description trimmed to ≤ 250 chars (from current ~461).
- AC-STE-78.6: CHANGELOG.md v1.22.0 STE-64 entry test-count claim matches actual counts: `branch_proposal.test.ts` = 28 tests in 5 describe blocks; `branch_acceptable.test.ts` = 15 tests in 4 describe blocks.
- AC-STE-78.7: CHANGELOG.md v1.22.0 STE-65 entry test-count claim reads 6 tests (5 parametrized negative-path + 1 error-shape).
- AC-STE-78.8: CHANGELOG.md v1.22.0 entry ends with the closing line: "Total test count at release: <N> tests, 0 failures, 0 errors." where <N> matches the actual `bun test` count at ship (currently 362; will grow with STE-82's new probe tests).
- AC-STE-78.9: README.md "Proven Across" section either (a) adds Python as a dogfooded stack, OR (b) renames to acknowledge examples-only coverage with a separate "Examples Provided for" block covering Python.
- AC-STE-78.10: `plugins/dev-process-toolkit/docs/skill-anatomy.md` gains a paragraph documenting the bare-vs-qualified skill-ref convention (bare in prose; qualified in literal user invocation).

## Technical Design

Per-AC surgical edits. No shared module changes. All edits in `plugins/dev-process-toolkit/` subtree except the root `.gitignore` commit.

## Testing

Prose-assertion tests are optional per AC; primary verification is manual review against the audit finding set. AC-STE-78.8's test count validates against `bun test` output at ship time.

## Notes

Folds 10 of the 22 audit findings. Keep surgical — no refactor bundling.
