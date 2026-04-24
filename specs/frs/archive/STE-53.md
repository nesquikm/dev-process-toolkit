---
title: Portable plugin-internal paths (${CLAUDE_PLUGIN_ROOT})
milestone: M17
status: archived
archived_at: 2026-04-23T08:08:03Z
tracker:
  linear: STE-53
created_at: 2026-04-23T06:40:40.000Z
---

## Requirement

Skills in this plugin invoke bundled helpers via bare `adapters/_shared/...` paths, written as if the current working directory were the plugin root. In reality the model's cwd is always the user's project root — both in this repo (helpers live under `plugins/dev-process-toolkit/adapters/...`) and in consumer projects (helpers live under `~/.claude/plugins/<marketplace>/.../dev-process-toolkit/adapters/...`). Neither resolves from cwd, so every helper invocation silently fails and skills degrade through NFR-10 / fallthrough branches with no visible error.

Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` in plugin skill invocation contexts; it resolves to the installed plugin root. `docs/adaptation-guide.md:250` already uses the convention in one place. This FR propagates it to the five SKILL.md files that ship broken invocations today.

## Acceptance Criteria

- AC-STE-53.1: Every `bun run adapters/_shared/...` invocation inside `plugins/dev-process-toolkit/skills/*/SKILL.md` uses the `${CLAUDE_PLUGIN_ROOT}/adapters/_shared/...` form. Affected files at M17 kickoff: `skills/implement/SKILL.md`, `skills/spec-write/SKILL.md`, `skills/spec-archive/SKILL.md`, `skills/gate-check/SKILL.md`, `skills/setup/SKILL.md`.
- AC-STE-53.2: Narrative references that merely name a helper (e.g., "`resolveFRArgument` from `adapters/_shared/src/resolve.ts`") may keep the bare path for readability. Only invocation-context paths — `bun run <path>`, shell commands in setup docs, hook-target paths — require the variable.
- AC-STE-53.3: A new test `plugins/dev-process-toolkit/tests/skill-path-portability.test.ts` grep-asserts every `skills/*/SKILL.md` for `bun run adapters/` substrings; the test fails if any match lacks the `${CLAUDE_PLUGIN_ROOT}/` prefix. Guards against future regressions.
- AC-STE-53.4: `docs/skill-anatomy.md` gains one paragraph documenting the convention (invocation paths use `${CLAUDE_PLUGIN_ROOT}`; narrative paths may remain bare).
- AC-STE-53.5: Manual smoke in a fresh consumer project (outside this repo): `/dev-process-toolkit:setup`, `/dev-process-toolkit:spec-write`, `/dev-process-toolkit:implement`, `/dev-process-toolkit:spec-archive`, `/dev-process-toolkit:gate-check` each reach their helper-invocation step successfully. Documented as a release smoke-test step in the CHANGELOG entry for the M17 release.

## Technical Design

Mechanical search-and-replace in five SKILL.md files. `bun run adapters/_shared/` becomes `bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/`. Claude Code substitutes the variable before shell execution; in this repo the variable resolves to the local plugin directory, in consumer installs it resolves to the cache-install directory.

No schema, adapter, or skill-flow changes. No code beyond SKILL.md edits and one new test.

## Testing

Primary guard: `skill-path-portability.test.ts` runs during `bun test` and fails if any future edit reintroduces the bare-path form.

Secondary guard: manual smoke in a consumer project at release time. Documented as a CHANGELOG smoke-test step for v1.20.0 (or v2.0.0-rc.1 if the SemVer-strict bump is chosen).

No behavioral regression expected in-repo — the bare paths already don't resolve here either; the helpers have been silently inactive for all non-dogfood use.

## Notes

The bug shipped undetected because (a) the plugin hasn't been exercised in a fresh consumer install since v1.17.0, and (b) the failure mode is silent: SKILL.md fallthrough paths catch the broken invocation and continue as if the helper returned its default. All resolver / layout-probe / migration-probe code paths have been silently inactive in consumer installs.

Dependency: no prerequisites; lands first in M17. Landing FR-A before other M17 FRs means subsequent M17 work can dogfood in a fresh install if desired.
