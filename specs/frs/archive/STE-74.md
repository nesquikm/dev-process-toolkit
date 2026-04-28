---
title: /implement Phase 4 → /docs --quick fragment hook (non-blocking)
milestone: M20
status: archived
archived_at: 2026-04-24T12:10:37Z
tracker:
  linear: STE-74
created_at: 2026-04-23T15:06:00Z
---

## Requirement

`/docs --quick` is the fragment-writing entry point (STE-70) — its natural caller is `/implement` at the moment an FR's implementation has passed gates and is about to be committed. STE-74 wires this: in `/implement` Phase 4 (after `/gate-check` passes, before the human-approval commit step), invoke `/docs --quick` as a sub-step that writes `docs/.pending/<fr-id>.md` describing what the FR changed in terms of the STE-71 impact set.

The hook is **non-blocking**: if `/docs --quick` fails (extractor bug, LLM error, whatever), `/implement` logs a warning and continues. A missing fragment is better than a failed implementation commit. Recovery is cheap (user runs `/docs --quick` manually on the same working tree to retry).

The hook is **gated** by the `## Docs` section in `CLAUDE.md`: if both docs modes are false (or the section is absent), `/implement` Phase 4 skips the entire hook silently — not even a log line. Projects that don't use docs generation see zero new behavior from M20 in `/implement`.

The fragment's relative path is surfaced in Phase 4's existing Deviation Report so the reviewer reading the `/implement` output sees what got staged and can inspect before approval.

## Acceptance Criteria

- AC-STE-74.1: `skills/implement/SKILL.md` Phase 4 gains a new sub-step between "Gates pass" and "Phase 4 Close (human approval)". The sub-step is named **"Phase 4b: Doc fragment"** and sits at the boundary:

  ```
  Phase 4a: Gate-check passes
  Phase 4b: Doc fragment (NEW — STE-74)
  Phase 4c: Human approval + commit
  Phase 4d: Close (archival + tracker metadata)
  ```

  Existing Phase 4 behavior in 4a / 4c / 4d is unchanged (NFR-18-style: byte-identical operation for projects with docs disabled).
- AC-STE-74.2: Phase 4b invokes `/docs --quick` with the current FR ID (resolved from the working tree — same resolver as manual `/docs --quick`). No new arguments to `/implement`; the hook is fully automatic within Phase 4.
- AC-STE-74.3: Phase 4b is gated by `readDocsConfig(CLAUDE.md)` (STE-68's export). If both `userFacingMode` and `packagesMode` are false (or `## Docs` section is absent), Phase 4b is a no-op with zero output: no log line, no timing entry, no deviation-report row. `/implement` Phase 4's existing surface is unchanged.
- AC-STE-74.4: If Phase 4b is enabled (at least one mode true) and `/docs --quick` succeeds, a new row is appended to Phase 4's existing Deviation Report:

  ```
  | Doc fragment | added | docs/.pending/<fr-id>.md | — |
  ```

  (Column headers are the existing Deviation Report's headers: Item / Classification / Location / Resolution.) This surfaces the fragment's presence to the reviewer without requiring they know about the hook.
- AC-STE-74.5: If Phase 4b is enabled and `/docs --quick` fails (non-zero exit, thrown error, timeout), `/implement` logs a warning and continues. The warning line goes to stdout and is included in the deviation report as:

  ```
  | Doc fragment | skipped (error) | — | /docs --quick failed: <first-line-of-error>. Run manually after commit to retry. |
  ```

  `/implement` proceeds to Phase 4c (human approval + commit) normally. The failed fragment attempt does not block the commit.
- AC-STE-74.6: Phase 4b's `/docs --quick` invocation runs with a 60-second timeout. Exceeding the timeout produces the same error path as AC-STE-74.5 with message `timeout after 60s`.
- AC-STE-74.7: Existing Phase 4 behaviors are preserved byte-identically when Phase 4b is disabled:
  - Phase 4a: `/gate-check` output format unchanged.
  - Phase 4c: commit message format unchanged.
  - Phase 4d: archival step (FR `git mv` to `specs/frs/archive/`, status transition, tracker metadata push) unchanged.

  Regression fixtures in `tests/fixtures/implement_*` must continue to pass without modification (analog of NFR-18).
- AC-STE-74.8: `/implement` argument parsing unchanged. No new flag (`--skip-docs`, `--force-docs`) is introduced — the docs-config gate is the only control surface. Users who want to skip the hook temporarily set `user_facing_mode: false` + `packages_mode: false` in `CLAUDE.md` or delete the `## Docs` section.

## Technical Design

**`skills/implement/SKILL.md` edits:**

Phase 4 current prose (conceptually):

```
## Phase 4: Close

Step 1: Run /gate-check. If failure, halt.
Step 2: Request human approval on the diff.
Step 3: On approval, commit.
Step 4: Archive FR + tracker metadata push.
```

Becomes:

```
## Phase 4: Close

Step 4a: Run /gate-check. If failure, halt.
Step 4b: Doc fragment (NEW — STE-74).
        - Read ## Docs section from CLAUDE.md.
        - If both modes are false: skip silently.
        - Else: invoke /docs --quick with 60s timeout.
            - On success: record fragment path in Deviation Report row.
            - On failure: log warning, add skipped-row to Deviation Report, continue.
Step 4c: Request human approval on the diff (including the new fragment if written).
Step 4d: On approval, commit. Archive FR + tracker metadata push.
```

**No new adapter modules.** All logic sits inside the skill's prose — the skill reads `## Docs` via existing `readDocsConfig` helper (STE-68) and invokes `/docs --quick` via the existing skill-composition pattern (similar to how `/implement` invokes `/gate-check` today).

**Deviation Report row:** The existing Deviation Report table in Phase 4c (Schema C from `technical-spec.md`) gains no structural change — this FR just adds conventional row content using existing columns.

**Testing via fixture:** A new fixture `tests/fixtures/projects/implement-with-docs-hook/` with a seeded `CLAUDE.md` (`## Docs` present with `user_facing_mode: true`), a seeded FR, and a working-tree diff. Running `/implement` against this fixture produces a commit with `docs/.pending/<fr-id>.md` staged. Companion fixture with docs disabled produces an identical commit without the fragment.

## Testing

Integration tests (fixture-driven) covering:
- Happy path: docs enabled, FR implemented, gate passes, fragment written, commit includes fragment.
- Disabled path: docs disabled, FR implemented, no fragment, no Phase 4b log lines, commit identical to pre-STE-74 behavior.
- `/docs --quick` failure path: docs enabled, fragment writer forced to fail (via mocked /docs), Phase 4 continues, Deviation Report shows skipped row, commit contains no fragment.
- Timeout path: /docs --quick hangs (mocked), 60s elapses, timeout error recorded, Phase 4 continues.

Regression assertion: the `implement-default` fixture (pre-STE-74) runs unchanged against the STE-74-modified skill — same commit message, same file tree, same tracker operations.

## Notes

**Why non-blocking.** A failed fragment write should never block shipping code. The code is the source of truth; docs are derivative. If users learn to expect "/implement fails when /docs has a bug," they'll disable /docs at the first hiccup (reviewer fatigue compounding). Non-blocking preserves trust: /implement does its job; /docs does its best; failures are visible but recoverable.

**Why no explicit flag.** Introducing `--skip-docs` creates temptation to use it routinely, which defeats the purpose. The config-level gate (`## Docs` section in CLAUDE.md) is the right level — it's a project-wide opt-in, not a per-invocation escape hatch. Users with a legitimate per-invocation skip need can edit the section briefly; that friction is intentional.

**Interaction with branch hygiene.** STE-64 (M19) established `branch_template` in Schema L. The FR-ID resolver used by `/docs --quick` (STE-70 AC-STE-70.3) reads the branch name per `branch_template` — so when `/implement` hops onto a template-generated branch for an FR, the fragment filename is correct automatically.

**Not in scope:** cross-FR fragments (e.g., "this diff affects FR-X and FR-Y"). The hook writes a single fragment per `/implement` run, bound to the FR being implemented. If a diff genuinely spans multiple FRs, the human can run `/docs --quick` manually with explicit overrides after the commit.

**Release target:** v1.23.0. Phase C of M20 plan (depends on STE-70).
