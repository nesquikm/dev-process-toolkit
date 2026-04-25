---
name: smoke-test
description: Spawn a fresh Bun project under ../dpt-test-project and drive the dev-process-toolkit plugin's full skill chain (/setup → /spec-write → /implement → /gate-check → /spec-review → /simplify) via claude-st -p child sessions, capturing findings. Pre-release sanity check, not CI. Real Linear writes, ~10 min wall-clock.
argument-hint: '[--keep] [--linear-team STE] [--feature-stub greet]'
disable-model-invocation: true
---

# /smoke-test

Drive the dev-process-toolkit plugin end-to-end against a freshly-scaffolded Bun project, capturing functional gaps that only manifest at runtime in a fresh checkout. **This is a project-local skill** — it lives in `.claude/skills/smoke-test.md` of the dev-process-toolkit repo, not in the plugin itself. Downstream users never see it.

This is the autonomous variant (option B from the design discussion): the parent claude session spawns `claude-st -p` children, captures their output, and writes findings + a teardown checklist. Reference run: 2026-04-25 against v1.29.0 → `/tmp/dpt-smoke-findings.md` → 9 findings → M29 milestone.

## When to use

- Before `/ship-milestone M<N>` runs, as a pre-release sanity check.
- After landing any FR that touches `skills/setup/SKILL.md`, `skills/spec-write/SKILL.md`, `skills/implement/SKILL.md`, `skills/gate-check/SKILL.md`, `skills/spec-archive/SKILL.md`, or any of the `templates/` files.
- Not for every commit, not in CI — this is expensive (real LLM tokens, real Linear writes) and slow (~10 minutes wall-clock).

## Pre-flight refusals

Each fires before any side effects, exits non-zero with an NFR-10-shape message:

1. **Not in the dev-process-toolkit repo.** `pwd` must end in `/dev-process-toolkit`. The skill writes to `../dpt-test-project` (a sibling of the repo); running it from elsewhere creates the test project in the wrong place.
2. **`../dpt-test-project` already exists.** Refuse unless `--keep` was passed at the *previous* invocation (in which case verify the dir is empty / matches the expected post-teardown shape). If a prior run left state, the operator should `rm -rf ../dpt-test-project` and re-run, or pass an explicit recovery mode.
3. **Linear MCP not available** in `~/.claude-st/` config. The skill calls Linear via `mcp__linear__*` tools through the child claude-st sessions; without the MCP server registered, those calls fail mid-run and leave half-created issues.
4. **Uncommitted changes in the toolkit repo.** The skill doesn't modify the toolkit repo, but a dirty tree means the operator may be mid-feature; surface this before tying up 10 minutes on a smoke run that may be against a moving target.
5. **Linear team key not resolvable.** Default `STE`; override with `--linear-team`. Verify via `mcp__linear__list_teams` before starting.

## Flow

The flow is six phases. Each phase prints its name + status (RUN / PASS / FAIL / SKIP) so the operator can follow along. On any FAIL, the phase reports what happened and offers to continue or abort.

### Phase 0 — Pre-approval gate

The skill spawns `claude-st -p` children with `--permission-mode acceptEdits` and a scoped `--allowedTools` list (see Phase 2). It does NOT use `bypassPermissions` — that path is blocked by the parent harness anyway. Print this contract to the operator and prompt for `y` to proceed:

```
/smoke-test will spawn claude-st child sessions in ../dpt-test-project with
--permission-mode acceptEdits and a scoped tool allowlist. Real Linear writes
will occur (test project + ~6 issues). Total cost ~$X-Y in tokens.

Proceed? [y/n]
```

Refuse on `n`. On `y`, log the approval to /tmp/dpt-smoke-{date}-approval.txt and proceed.

### Phase 1 — Setup

1. Create `../dpt-test-project` and run `bun init -y`.
2. Remove `bun init`'s stub `CLAUDE.md` (the plugin's `/setup` will overwrite it; cleaner to start blank).
3. `cd ../dpt-test-project && git init -q && git add -A && git commit -q -m "chore: bun init scaffold"`.
4. Create a Linear project named `DPT Smoke Test (<YYYY-MM-DD>)` under team `STE` via `mcp__linear__save_project`. Save the project ID + URL to the findings file's header.
5. Print: "Setup phase complete. Test project: ../dpt-test-project; Linear project: <URL>."

### Phase 2 — Run the canonical chain

Spawn one `claude-st -p` child per skill, sequentially. Each child:

- Has `cwd=../dpt-test-project`.
- Uses `--permission-mode acceptEdits`.
- Uses a scoped `--allowedTools` allowlist appropriate to the skill (see "Allowlist matrix" below).
- Has `--max-budget-usd 3` (per-skill budget cap).
- Receives a fully-pre-baked prompt (no interactive Q&A — the smoke-test prompt template tells the child every answer up front).
- Has its stdout/stderr captured to `/tmp/dpt-smoke-<skill>.log`.

Skills to run, in order:

1. `/dev-process-toolkit:setup` — pre-baked answers: stack=Bun+TS, tracker=linear, team=STE, project=<the smoke-test project from Phase 1>, jira_ac_field=blank, branch_template=default, docs flags=all-false.
2. `/dev-process-toolkit:spec-write` — feature stub (default `greet`): "Add a pure function greet(name?: string) returning 'Hello, <name>!' (defaulting 'world' for undefined / empty / whitespace-only). File src/greet.ts; test src/greet.test.ts; 4 ACs."
3. `/dev-process-toolkit:implement <feature-id>` — full TDD + tracker writes (claim → release after archive). Pre-authorize the Phase 4 step 15 commit upfront. Do NOT push.
4. `/dev-process-toolkit:gate-check` — read-only verification.
5. `/dev-process-toolkit:spec-review <feature-id>` — read-only spec-vs-code audit.
6. `/dev-process-toolkit:simplify` — review changed code; safe refactors applied + gate re-verified.

Skills explicitly NOT run (with reasons logged in findings):

- `/dev-process-toolkit:brainstorm` — multi-turn Socratic; not viable in `-p`.
- `/dev-process-toolkit:debug` — needs a failing test to trigger.
- `/dev-process-toolkit:visual-check` — no UI in test project.
- `/dev-process-toolkit:pr` — no GitHub remote in test project.
- `/dev-process-toolkit:docs` — would be no-op if /setup omitted `## Docs` (until M29 STE-107 ships).
- `/dev-process-toolkit:ship-milestone` — would dirty real Linear data further.
- `/dev-process-toolkit:tdd` standalone — covered by `/implement`.

### Phase 3 — Capture

After every skill completes, parse its log and the test-project state, generating findings entries. Findings template:

```markdown
### F<N> — <one-line summary>
<paragraph: what was expected, what happened>
**Severity:** high / medium / low. <one-line rationale>
```

Group findings by skill and severity. Append to `/tmp/dpt-smoke-findings-<YYYY-MM-DD>.md` using the template at `.claude/skills/smoke-test-template.md` (TODO: separate file once the template stabilizes; for now, follow the shape of the canonical 2026-04-25 run at `/tmp/dpt-smoke-findings.md`).

Header includes: date, plugin version (read from `plugins/dev-process-toolkit/.claude-plugin/plugin.json`), driver-side caveats, what worked, what didn't, suggested follow-up FR titles.

### Phase 4 — Verify-on-disk

For each major output the skills claim to produce, verify it actually landed on disk:

- `../dpt-test-project/CLAUDE.md` — exists, has `## Task Tracking`, has `## Docs` (post-M29 STE-107).
- `../dpt-test-project/.claude/settings.json` — exists, valid JSON, has the canonical allow-list (post-M29 STE-106).
- `../dpt-test-project/.mcp.json` — exists, has `linear` adapter entry (post-M29 STE-106).
- `../dpt-test-project/specs/{requirements.md, technical-spec.md, testing-spec.md, plan/M1.md}` — exist.
- `../dpt-test-project/specs/frs/<feature-id>.md` OR `specs/frs/archive/<feature-id>.md` — exists with no `id:` field (post-M29 STE-110); compact tracker block `{ linear: STE-N }`.
- Linear ticket exists, status = `Done`, assignee = current user, completedAt populated.
- `bunx tsc --noEmit && bun test` exits 0; expected feature-stub test count.

Each verification result feeds into Phase 3's findings.

### Phase 5 — Teardown

Two paths:

**On `--keep` (default off):** print the teardown checklist for the operator and exit:

```
Smoke test complete. Findings: /tmp/dpt-smoke-findings-<date>.md.

Teardown when ready:
  rm -rf ../dpt-test-project
  # In Linear: archive or delete the "DPT Smoke Test (<date>)" project
  #   (id <project-id>, team STE)
```

**Without `--keep`:** prompt `Delete ../dpt-test-project and the Linear project? [y/n/keep]`. On `y`: `rm -rf` the dir; call `mcp__linear__save_project` with `state: completed` (Linear's no-delete-only-archive behavior is fine — the project becomes inaccessible from the team list but issues remain auditable). On `keep`: same as `--keep`. On `n`: same as `--keep` minus the suggestion.

## Allowlist matrix

| Skill | Bash patterns | MCP tools |
|-------|---------------|-----------|
| /setup | `git *`, `bun *`, `bunx *`, `ls *`, `mkdir *`, `grep *`, `rm *`, `mv *`, `cp *`, `find *`, `jq *` | `mcp__linear__{list_teams,get_team,list_projects,get_project}` |
| /spec-write | (same) + `date *` | (above) + `mcp__linear__{save_issue,list_issues,get_issue,list_issue_statuses,list_issue_labels,list_users}` |
| /implement | (same) | (above) + `mcp__linear__{save_comment,list_comments}` |
| /gate-check | `git *`, `bun *`, `bunx *`, `ls *`, `grep *`, `find *`, `jq *`, `test *` | `mcp__linear__{get_issue,list_issues}` (read-only) |
| /spec-review | (same as gate-check) | (read-only) |
| /simplify | `git *`, `bun *`, `bunx *`, `ls *`, `grep *`, `find *` | (none) |

Tools surface common to all: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Skill`, `TaskCreate`, `TaskUpdate`, `TaskList`, plus `Agent` for `/implement` (sub-agent invocations during Stage B code review).

## Output

- `/tmp/dpt-smoke-findings-<YYYY-MM-DD>.md` — findings file (the deliverable).
- `/tmp/dpt-smoke-{setup,spec-write,implement,gate-check,spec-review,simplify}.log` — per-skill child stdout/stderr.
- `/tmp/dpt-smoke-<date>-approval.txt` — operator approval record from Phase 0.

End-of-run console summary: total findings count by severity, link to findings file, teardown checklist.

## Rules

- **Project-local, not plugin.** This skill lives in the dev-process-toolkit repo's `.claude/skills/`. Do not move it into `plugins/dev-process-toolkit/skills/` — downstream users have no business running smoke tests against the plugin they just installed.
- **Real Linear writes are the point.** Do not mock Linear or skip the MCP path. The smoke test's value is end-to-end fidelity; mocking would defeat it.
- **Children get pre-baked answers, never live Q&A.** The whole point of `-p` is that there's no interactive shell; the prompt template must answer every question up front. If a skill genuinely can't be driven non-interactively (e.g. /brainstorm), it goes in the "explicitly NOT run" list with a reason.
- **Capture, don't fix.** /smoke-test surfaces issues into a findings file. Triage and fix happens via /spec-write + /implement on the toolkit repo, not inline. The skill's outputs are evidence, not patches.
- **One run per release cycle.** Don't re-run for fun; each run costs real tokens and Linear teardown labor.
- **Driver-side caveats live in the findings file**, not inline as plugin issues. If a finding is "claude-st -p doesn't support X", that's a smoke-test infrastructure note, not an FR against the plugin.
- **Update this skill when the plugin's skill list changes.** New plugin skill = new entry in the chain (or in the "NOT run" list with rationale). Caught only by manual review — there's no probe for skill-list freshness here.
