---
id: fr_01KPZ7GRFS7EK16T50A8EXVE9R
title: Gate-check probe integration tests + probe-test convention
milestone: M22
status: archived
archived_at: 2026-04-24T08:44:27Z
tracker:
  linear: STE-82
created_at: 2026-04-24T07:54:52Z
---

## Requirement

`skills/gate-check/SKILL.md` advertises 11 probes. Only 5 (probes 5, 6, 8, 9, 10) have `tests/gate-check-<slug>.test.ts` integration tests. Probes 1, 2, 3, 4, 7, 11 ship as prose claims with no automated verification — documented behavior and implementation can drift without detection.

Probe 11 (tracker-mode ULID prose hygiene) is the most acute — AC-STE-67.6 declared it, CHANGELOG v1.22.0 advertises it, and no test exercises its grep logic. Probes 1-4 and 7 are pre-M19 gaps the audit surfaces.

Close the gap by adding one `tests/gate-check-<slug>.test.ts` per untested probe. Each test builds a minimal project-tree fixture (temp dir or reuse of `tests/fixtures/projects/`) that exercises the probe with positive + negative cases. Also add a convention paragraph to `skills/gate-check/SKILL.md`: every new probe ships with its test file.

## Acceptance Criteria

- AC-STE-82.1: `plugins/dev-process-toolkit/tests/gate-check-filename-frontmatter-match.test.ts` exists and covers probe 1 (filename ↔ frontmatter `id:` match), positive + negative.
- AC-STE-82.2: `plugins/dev-process-toolkit/tests/gate-check-required-frontmatter.test.ts` covers probe 2 (required Schema Q frontmatter keys).
- AC-STE-82.3: `plugins/dev-process-toolkit/tests/gate-check-stale-lock-scan.test.ts` covers probe 3 (stale lock-file scan).
- AC-STE-82.4: `plugins/dev-process-toolkit/tests/gate-check-plan-freeze.test.ts` covers probe 4 (plan post-freeze edit scan).
- AC-STE-82.5: `plugins/dev-process-toolkit/tests/gate-check-duplicate-ac-prefix.test.ts` covers probe 7 (duplicate AC-prefix scan).
- AC-STE-82.6: `plugins/dev-process-toolkit/tests/gate-check-ulid-prose-hygiene.test.ts` covers probe 11 (tracker-mode ULID prose hygiene) — satisfies AC-STE-67.6.
- AC-STE-82.7: Each test has a positive fixture (probe passes clean) and a negative fixture (probe fires with the documented note shape: `file:line — reason`).
- AC-STE-82.8: `plugins/dev-process-toolkit/skills/gate-check/SKILL.md` gains a "Probe authoring contract" paragraph: "Every new /gate-check probe ships with a corresponding `tests/gate-check-<slug>.test.ts` test file. Self-review refuses a probe declaration without its test."
- AC-STE-82.9: Post-add, every probe declared in `skills/gate-check/SKILL.md` has a matching test file in `tests/`. Running `bun test` passes with the 6 new test files included.

## Technical Design

Mirror existing `gate-check-<name>.test.ts` shapes (probes 5/6/8/9/10). Each test:

1. Sets up a minimal project-tree fixture (temp dir via `fs.mkdtempSync` or reuses existing `tests/fixtures/projects/mode-none-baseline`).
2. Invokes the probe's grep/scan logic (reusing the probe's implementation, not re-implementing).
3. Asserts on the probe's output shape: positive = clean pass; negative = note emitted with `file:line — reason` form.

Optional meta-test: `tests/gate-check-probe-convention.test.ts` enumerates probes declared in SKILL.md and asserts each has a corresponding `tests/gate-check-<slug>.test.ts` file — enforces AC-STE-82.9 going forward.

## Testing

The FR is itself test-authoring work. The convention paragraph (AC-STE-82.8) is self-enforcing via the optional meta-test.

## Notes

Probe 7 (duplicate AC-prefix) has indirect coverage via `ac_lint.test.ts`; this FR's test covers the gate-check integration surface, not the lint logic itself. Scoping: each fixture is minimal — no cross-stack contamination. Biggest code work in M22; ships in its own commit.
