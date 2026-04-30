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

**Closing line:**

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

`adapters/_shared/src/test_count_parser.ts` ships three parsers keyed on the detected stack — bun, pytest, and flutter; adding more stacks requires a new FR.

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

Anything else in `git status --porcelain` triggers pre-flight refusal 2. `/ship-milestone` never runs `git add -A`; it `git add`s each path explicitly.

## Interaction with `/implement M<N>` close-prompt chain

`/implement`'s milestone-close prompt adds an opt-in prompt at the end of a milestone-scope run: "Ship this milestone now? [y/N]". On `y`, `/implement` chains into `/ship-milestone M<N>`. The chain is **not a bypass** — `/ship-milestone`'s own unified-diff approval gate (step 6) still fires, and the user must type `y` again.

## Mode: none compatibility

`/ship-milestone` works in `mode: none` projects. It does not read tracker metadata; it only reads the milestone plan file + FR frontmatter, both of which are the same across modes.

- No tracker calls during the flow (zero MCP budget).
- No `Provider.releaseLock` / `getTicketStatus` — `/implement` already released each FR's lock at its own Phase 4 Close.
- The CHANGELOG bullet references use `short-ULID.tail.STE-X`-style per M16's AC-prefix convention when FRs have no tracker binding.

## Dry run (deferred decision from M20 brainstorm)

`--dry-run` is intentionally not shipped. The human-approval gate (step 6) already functions as a dry run: the user sees the full diff and can refuse. An explicit `--dry-run` flag remains on the deferred-decisions list; add when dogfooding surfaces the need.

## Self-hosting risk

`/ship-milestone` ships its own releases. If the skill itself has a bug, the release commit could be malformed. Mitigations:

- Manual rollback plan: `git reset --hard HEAD~1` on the release branch before pushing.
- The unified diff at step 6 IS the dogfood test — if the diff looks wrong, refuse.
- Run `/gate-check` after the commit lands but before `git push` — if the repo fails its own gate, the release isn't ready.

## Refusal #1 remedy shapes

Refusal #1 (unshipped FRs) fires with one of two remedy shapes. The branch probes each `status: active` FR's tracker ticket via `Provider.getTicketStatus` and partitions on equality with the adapter's `status_mapping.done`.

| Partition | When | Remedy emitted |
|-----------|------|---------------|
| All unshipped are tracker-Done | Every probed ticket returns `status_mapping.done` | Run `/spec-archive M<N>` to bulk-archive the file side, then re-run `/ship-milestone`. |
| Any is genuinely unshipped | Any probed ticket returns anything else (including no binding or `local-no-tracker` in `mode: none`) | Finish each FR via `/implement`, or move the unfinished FR to a later milestone's plan, then re-run. |
| Mixed | Some tracker-Done, some not | Genuinely-unshipped shape wins — safer to not misdirect to `/spec-archive` when a ticket genuinely isn't done yet. |

Both shapes preserve the canonical `Context: milestone=M<N>, unshipped=<count>, skill=ship-milestone` line, and both exit non-zero. `mode: none` always flows through the genuinely-unshipped branch because `LocalProvider.getTicketStatus` returns the `local-no-tracker` sentinel, which never equals any tracker's `status_mapping.done`.

## Refusal summary (NFR-10 canonical shapes)

All refusals carry the three-line shape: one-line verdict / `Remedy: <action>` / `Context: milestone=..., version=..., skill=ship-milestone`. The four refusal verdicts:

1. `milestone M<N> has <count> unshipped FR(s): <list>`
2. `working tree has uncommitted changes outside the release files: <list>`
3. `cannot tag release with <F> test failure(s)`
4. `/docs --commit --full failed; cannot proceed with release`

## `## Release Files` block schema

`/ship-milestone` reads a `## Release Files` block from the host project's `CLAUDE.md` and bumps every listed file by its `kind`. The block is the single source of truth for which paths get rewritten on a release — no path is hard-coded in the skill body. Parser + per-kind bump helpers live in `adapters/_shared/src/release_config.ts`.

The block carries one fenced-yaml payload:

```yaml
files:
  - path: <repo-relative path>
    kind: json | toml | yaml | changelog | regex
    # kind-specific fields:
    #   json/toml/yaml → field: <dot-path>
    #   regex          → pattern + replace
    # optional: bool (default false)
```

| Field | Required? | Notes |
|-------|-----------|-------|
| `path` | yes | Repo-relative path |
| `kind` | yes | `json` / `toml` / `yaml` / `changelog` / `regex` |
| `field` | iff json/toml/yaml | Dot-path (e.g. `version`, `project.version`, `plugins[0].version`) |
| `pattern` | iff regex | Regex with named `(?<version>...)` group |
| `replace` | iff regex | Template with `{version}` placeholder |
| `optional` | no | Default `false`. Missing path emits `n/a` instead of failing. |

### Per-kind worked examples

**`kind: json`** — top-level or nested dot-path:

```yaml
- path: package.json
  kind: json
  field: version
- path: .claude-plugin/marketplace.json
  kind: json
  field: plugins[0].version
```

**`kind: toml`** — supports zero- or one-level dotting:

```yaml
- path: pyproject.toml
  kind: toml
  field: project.version
```

**`kind: yaml`** — top-level scalar; preserves Flutter `+<build>` suffix:

```yaml
- path: pubspec.yaml
  kind: yaml
  field: version
```

`version: 0.1.0+15` → `version: 0.2.0+15` (build suffix passes through unchanged).

**`kind: changelog`** — inserts `## [X.Y.Z] — YYYY-MM-DD — "Codename"` above the topmost prior version section. Skipped entirely when CLAUDE.md `## Docs` carries `changelog_ci_owned: true` — CI owns the file.

**`kind: regex`** — universal escape hatch for free-form patterns:

```yaml
- path: README.md
  kind: regex
  pattern: 'Latest: \*\*v(?<version>\d+\.\d+\.\d+) — '
  replace: 'Latest: **v{version} — '
  optional: true
```

The pattern must contain a `(?<version>...)` named group; `replace` substitutes `{version}` with the new version string.

### Per-stack defaults (consumed by `/setup`)

`/setup` populates the block from `examples/<stack>/release.yml`:

- `examples/typescript-node/release.yml`
- `examples/flutter-dart/release.yml`
- `examples/python/release.yml`
- `examples/plugin/release.yml` — the toolkit dogfoods this fixture

Unrecognized stacks get a commented stub plus a "fill this in before running /ship-milestone" pointer.

### Writing your own override

Reach for `kind: regex` first — it covers any free-form line that doesn't fit the structured kinds. `/setup` re-runs preserve user-edited blocks: if the host CLAUDE.md already has a `## Release Files` block, `/setup` leaves it alone — user edits win.

### Refusals

`MissingReleaseFilesBlockError` fires when:

- The `## Release Files` block is absent.
- The block is present but contains zero entries (`files: []` or empty payload).

`MalformedReleaseFilesError` fires when an entry violates the schema (missing required field, unknown `kind`, regex pattern without `(?<version>)` group, etc.). Both follow the NFR-10 canonical refusal shape.

## See also

- `skills/ship-milestone/SKILL.md` — the canonical skill file.
- `CLAUDE.md` § Release Files — the toolkit's own block (it dogfoods the contract).
- `examples/<stack>/release.yml` — per-stack defaults `/setup` copies in.
- `adapters/_shared/src/release_config.ts` — parser + per-kind bumpers.
- `docs/docs-reference.md` § `/docs --commit --full` — the docs-regen half of the ship flow.
