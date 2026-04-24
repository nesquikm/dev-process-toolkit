# `/ship-milestone` Reference

Extended reference for `/dev-process-toolkit:ship-milestone` — overflow content from `skills/ship-milestone/SKILL.md` (NFR-1 300-line cap). The skill carries the condensed flow; consult this file when debugging a weird bump result, editing the generated CHANGELOG entry, or adding a new stack to the test-output parser.

## CHANGELOG subsection policy

The generated CHANGELOG entry follows [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/). FR frontmatter drives category selection via the `changelog_category` field (default `Added`):

| Frontmatter value | CHANGELOG subsection |
|-------------------|----------------------|
| `Added` (default) | `### Added` |
| `Changed` | `### Changed` |
| `Removed` | `### Removed` |
| `Fixed` | `### Fixed` |

**Bullet-line shape:**

```
- **STE-X — <FR title>.** <first paragraph of FR `## Requirement`, trimmed to ~3 sentences>.
```

The LLM is prompted to summarize, not paraphrase. The ground truth is the FR's `## Requirement` section — the prompt pins it verbatim and tells the model to summarize, not invent.

**Cross-refs:** inside the body, other FRs are referenced as bare tracker IDs `(STE-Y)`. Do not use Markdown links to tracker URLs — release-note consumers read the raw Markdown more often than the rendered form.

**Empty subsections:** if a category has zero FRs, omit its heading entirely. Do not emit empty `### Removed\n\n` blocks.

**Closing line (AC-STE-73.12):**

```
Total test count at release: <N> tests, <F> failures, <E> errors.
```

Lives as the last line of the release entry, one blank line below the final subsection. Suppressed entirely when `changelog_ci_owned: true` — CI owns the CHANGELOG; the closing line goes there.

**`e` edit-in-loop.** At the approval prompt, typing `e` opens `$EDITOR` (falling back to `vi`) on the proposed CHANGELOG entry alone (not the whole diff). After save-exit, the diff is recomputed and the prompt re-asked. Unlimited edit iterations, terminating on `y` or `N`.

## Version bump rules

Implemented in `adapters/_shared/src/version_bump.ts`. The `inferBump(ctx)` function applies these rules in order:

1. **Override wins.** If `ctx.override` parses as `<major>.<minor>.<patch>`, use it verbatim. Rationale: `override: --version <X.Y.Z> (user-provided)`.
2. **Major bump.** Any FR with frontmatter `breaking: true`. Rationale: `major bump: FR <STE-X> marked breaking`.
3. **Patch bump.** Every FR's `changelog_category` is `Fixed` or `Removed` (pure fix-class milestone). Rationale: `patch bump: milestone contains only fix-class FRs (N)`.
4. **Minor bump.** Default. Rationale: `minor bump: milestone shipped N additive FRs`.

Empty FR list is still a minor bump, labelled `default minor bump (no FRs in milestone)` — but `/ship-milestone`'s unshipped-FR pre-flight refusal catches the real cases first.

## README structure-count refresh

`/ship-milestone` walks these directories and emits current counts into the `## Structure` section of `README.md`:

- `plugins/dev-process-toolkit/skills/` — count of directories containing a `SKILL.md`.
- `plugins/dev-process-toolkit/docs/` — count of `patterns.md` pattern entries (grep for `## Pattern <N>:` style headings).
- `plugins/dev-process-toolkit/agents/` — count of `.md` files.

**Shape-change guard.** If the `## Structure` block's shape has changed (a human edited the block manually — e.g., added a new counted directory), refuse with NFR-10 asking the user to re-confirm. Never silently coerce an unfamiliar structure block.

## Test-count parser

`adapters/_shared/src/test_count_parser.ts` ships three parsers keyed on the detected stack. AC-STE-73.12 enumerates bun, pytest, and flutter; adding more stacks requires a new FR.

| Stack | Input shape | Parse rule |
|-------|-------------|------------|
| `bun` | `N pass\nF fail` | total = N+F, failures = F, errors = 0 |
| `pytest` | `N passed, F failed [, E errors] in TIME` | total = N+F+E, failures = F, errors = E |
| `flutter` | `00:04 +N -F: ...` | total = N+F, failures = F, errors = 0 |
| `unknown` | — | `{ ok: false, reason: "unknown stack..." }` → NFR-10 fallback |

**Unrecognized output.** For a known stack with unparseable output, the parser returns `{ ok: false, reason: <...> }` and `/ship-milestone` surfaces an NFR-10 asking the user to specify the counts or skip the line. Default behavior is refuse; operator decides.

**Stack detection.** Infer from the presence of `bun.lock` (bun), `pytest.ini` / `pyproject.toml` (pytest), or `pubspec.yaml` (flutter). Everything else (npm, jest, mocha, cargo, go test, …) hits the `unknown` branch and the user is prompted to specify the test count or skip the CHANGELOG closing line — adding a new stack is an FR, not a library bump.

## Expected-modified set

The set of files `/ship-milestone` is allowed to stage is pinned at:

- `plugins/dev-process-toolkit/.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `CHANGELOG.md`
- `README.md`
- every file under `docs/` (for the `/docs --commit --full` step)

Anything else in `git status --porcelain` triggers pre-flight refusal 2 (AC-STE-73.9). `/ship-milestone` never runs `git add -A`; it `git add`s each path explicitly.

## Interaction with STE-75 (`/implement M<N>` chain)

STE-75 (Phase D of M20) adds an opt-in prompt at the end of a milestone-scope `/implement` run: "Ship this milestone now? [y/N]". On `y`, `/implement` chains into `/ship-milestone M<N>`. The chain is **not a bypass** — `/ship-milestone`'s own unified-diff approval gate (step 6) still fires, and the user must type `y` again.

## Mode: none compatibility

`/ship-milestone` works in `mode: none` projects. It does not read tracker metadata; it only reads the milestone plan file + FR frontmatter, both of which are the same across modes.

- No tracker calls during the flow (zero MCP budget).
- No `Provider.releaseLock` / `getTicketStatus` — `/implement` already released each FR's lock at its own Phase 4 Close.
- The CHANGELOG bullet references use `short-ULID.tail.STE-X`-style per M16's AC-prefix convention when FRs have no tracker binding.

## Dry run (deferred decision from M20 brainstorm)

`--dry-run` is intentionally not shipped in v1 of /ship-milestone. The human-approval gate (step 6) already functions as a dry run: the user sees the full diff and can refuse. An explicit `--dry-run` flag is on the deferred-decisions list (see `specs/plan/M20.md` § Deferred decisions); add when dogfooding surfaces the need.

## Self-hosting risk

The first `/ship-milestone` invocation is M20's own release (v1.23.0). If the skill itself has a bug, the release commit could be malformed. Mitigations:

- Manual rollback plan: `git reset --hard HEAD~1` on the release branch before pushing.
- The unified diff at step 6 IS the dogfood test — if the diff looks wrong, refuse.
- Run `/gate-check` after the commit lands but before `git push` — if the repo fails its own gate, the release isn't ready.

## Refusal summary (NFR-10 canonical shapes)

All refusals carry the three-line shape: one-line verdict / `Remedy: <action>` / `Context: milestone=..., version=..., skill=ship-milestone`. The four refusal verdicts:

1. `milestone M<N> has <count> unshipped FR(s): <list>` (AC-STE-73.8)
2. `working tree has uncommitted changes outside the release files: <list>` (AC-STE-73.9)
3. `cannot tag release with <F> test failure(s)` (AC-STE-73.12)
4. `/docs --commit --full failed; cannot proceed with release` (AC-STE-73.5)

## See also

- `skills/ship-milestone/SKILL.md` — the canonical skill file.
- `CLAUDE.md` § Release Checklist — the manual four-step ceremony this skill automates.
- `docs/docs-reference.md` § `/docs --commit --full` — the docs-regen half of the ship flow.
- `specs/frs/STE-73.md` — source FR.
