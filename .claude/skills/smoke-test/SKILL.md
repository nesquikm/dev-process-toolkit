---
name: smoke-test
description: Spawn a fresh Bun project under ../dpt-test-project and drive the dev-process-toolkit plugin's full skill chain (/setup → /spec-write → /implement → /gate-check → /spec-review → /simplify) via claude-st -p child sessions, capturing findings. Pre-release sanity check, not CI. Real Linear writes, ~10 min wall-clock.
argument-hint: '[--keep] [--linear-team STE] [--feature-stub greet]'
disable-model-invocation: true
---

# /smoke-test

Drive the dev-process-toolkit plugin end-to-end against a freshly-scaffolded Bun project, capturing functional gaps that only manifest at runtime in a fresh checkout. **This is a project-local skill** — it lives in `.claude/skills/smoke-test.md` of the dev-process-toolkit repo, not in the plugin itself. Downstream users never see it.

This is the autonomous variant: the parent claude session spawns `claude-st -p` children, captures their output, and writes findings + a teardown checklist. Reference runs: 2026-04-25 against v1.29.0 → `/tmp/dpt-smoke-findings.md` → 9 findings → M29 milestone; 2026-04-26 against v1.31.0 (run #2, aborted) → motivated the bypassPermissions revision; 2026-04-27 against v1.31.0 (run #3) → first end-to-end successful chain under the option-5 pattern (parent pre-creates `.claude/settings.json` + `.mcp.json` to bypass F-DR7), 3 plugin findings + 1 driver-side caveat.

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
6. **Path-safety on the test-project location.** Before spawning any child with `--permission-mode bypassPermissions` (see Phase 0), the driver MUST verify the resolved test-project path:
   - Resolves with `realpath` (no broken symlinks). On macOS `realpath` requires the path to exist; resolve via the parent dir + basename instead, since the test-project itself doesn't yet exist when this fires.
   - Has the toolkit-repo path as its parent's parent (i.e. is a true sibling of `dev-process-toolkit`, not an ancestor, child, or unrelated location).
   - Basename matches `dpt-test-project` exactly (no override). Hard-coded by design; bypassPermissions is scoped to one well-known throwaway path.
   - Is not a symlink, is not inside `$HOME` directly (must be under a `workspace/` ancestor), is not the toolkit repo itself.
   Any failure refuses with NFR-10. This is the load-bearing safety rail that justifies bypassPermissions in Phase 2.

   **Reference implementation** (verified 2026-04-27 against six adversarial cases — wrong-basename, not-sibling, symlink-decoy, is-toolkit, no-workspace-ancestor, canonical-good):

   ```bash
   TOOLKIT_REPO="$(pwd)"
   TEST_PATH="../dpt-test-project"
   TOOLKIT_REAL="$(realpath "$TOOLKIT_REPO")"
   TEST_DIR_REAL="$(realpath "$(dirname "$TEST_PATH")")" || exit 1
   TEST_REAL="$TEST_DIR_REAL/$(basename "$TEST_PATH")"
   [ "$(basename "$TEST_REAL")" = "dpt-test-project" ] || exit 1
   [ "$(dirname "$TEST_REAL")" = "$(dirname "$TOOLKIT_REAL")" ] || exit 1
   [ ! -e "$TEST_REAL" ] || [ ! -L "$TEST_REAL" ] || exit 1
   case "$TEST_REAL" in "$HOME"/workspace/*) ;; *) exit 1 ;; esac
   [ "$TEST_REAL" != "$TOOLKIT_REAL" ] || exit 1
   ```

## Flow

The flow is six phases. Each phase prints its name + status (RUN / PASS / FAIL / SKIP) so the operator can follow along. On any FAIL, the phase reports what happened and offers to continue or abort.

### Phase 0 — Pre-approval gate

The skill spawns `claude-st -p` children with `--permission-mode bypassPermissions` AND pre-creates `.claude/settings.json` + `.mcp.json` from the parent's Bash tool (run #3 F-DR7 — the harness's sensitive-path classification of those two files survives bypass mode at the *child*'s model layer, but parent-side shell I/O via heredoc is not subject to it). See the **Threat model** section at the bottom of this file for why this combination is acceptable here. Briefly: the test-project path is hard-coded to `../dpt-test-project` (verified by pre-flight #6), the directory is throwaway (created and torn down per run), and the alternatives (`acceptEdits + per-path Write` in run #2, plain `bypassPermissions` in run #3) were both empirically falsified.

Print this contract to the operator and prompt for `y` to proceed:

```
/smoke-test will:
  1. Pre-create .claude/settings.json and .mcp.json from the driver process
     (parent's Bash heredoc, not subject to the child's sensitive-path block).
  2. Spawn claude-st child sessions in ../dpt-test-project with
     --permission-mode bypassPermissions.

Real Linear writes will occur (test project + ~6 issues). Total cost ~$X-Y in tokens.

Path-safety pre-flights have verified the test-project path is a true sibling
of the toolkit repo (basename "dpt-test-project", under a workspace/ ancestor,
not a symlink, not the toolkit repo itself). bypassPermissions is scoped to
this one path; the operator's other projects are unaffected.

CAVEAT: smoke test exercises /setup's "files-already-exist, idempotent merge"
branch, NOT the fresh-create branch. Fresh-create coverage requires a separate
manual probe.

Proceed? [y/n]
```

Refuse on `n`. On `y`, log the approval to /tmp/dpt-smoke-{date}-approval.txt and proceed.

### Phase 1 — Setup

1. Create `../dpt-test-project` and run `bun init -y`.
2. Remove `bun init`'s stub `CLAUDE.md` (the plugin's `/setup` will overwrite it; cleaner to start blank).
3. `cd ../dpt-test-project && git init -q && git add -A && git commit -q -m "chore: bun init scaffold"`.
4. Create a Linear project named `DPT Smoke Test (<YYYY-MM-DD>)` under team `STE` via `mcp__linear__save_project`. Save the project ID + URL to the findings file's header.
5. Construct the wrapped Linear MCP config at `/tmp/dpt-smoke-mcp-config.json`. Source: `~/.claude-st/plugins/marketplaces/claude-plugins-official/external_plugins/linear/.mcp.json` (a bare server entry without the `mcpServers:` envelope). Wrap it as `{"mcpServers": <source>}` and write to /tmp. This is required because `--plugin-dir` (used to load the in-tree plugin under test) shadows plugin-loaded MCPs (see F-DR3 from run #1).
6. **Pre-create the sensitive files from the parent's Bash heredoc** (run #3 F-DR7 fix). The child claude session under `bypassPermissions` is still blocked from writing `.claude/settings.json` and `.mcp.json` (the block is at the model layer, not the OS or harness-wide). The parent's Bash tool uses shell I/O (`cat > file <<EOF`), which is not subject to that classification, so the driver writes them directly:

   ```bash
   mkdir -p .claude
   cat > .claude/settings.json <<'EOF'
   {
     "permissions": {
       "allow": [
         "Bash(bun *)", "Bash(bunx *)", "Bash(git *)", "Bash(gh *)",
         "Bash(mkdir *)", "Bash(ls *)", "Bash(rm *)", "Bash(mv *)", "Bash(cp *)"
       ]
     }
   }
   EOF
   cat > .mcp.json <<'EOF'
   {
     "mcpServers": {
       "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" }
     }
   }
   EOF
   ```

   Match the canonical content from `plugins/dev-process-toolkit/skills/setup/SKILL.md` step 6/7 (refresh as the plugin evolves). The /setup child detects existing files and takes the idempotent-merge branch.
7. Print: "Setup phase complete. Test project: ../dpt-test-project; Linear project: <URL>; MCP config: /tmp/dpt-smoke-mcp-config.json; sensitive files pre-created."

### Phase 2 — Run the canonical chain

Spawn one `claude-st -p` child per skill, sequentially. Each child:

- Has `cwd=../dpt-test-project`.
- Is invoked as `CLAUDE_CONFIG_DIR=~/.claude-st claude -p ...` — NOT `claude-st -p`. The `claude-st` zsh alias does not expand inside the parent harness's Bash tool (run #1 F-DR1).
- Uses `--permission-mode bypassPermissions`. Required for the chain's normal Bash + MCP operations to skip per-prompt approval. NOT sufficient alone for `.claude/settings.json` / `.mcp.json` writes — those are blocked even under bypass (run #3 F-DR7), which is why Phase 1 step 6 pre-creates them from the parent. Combined: bypass for the bulk of the chain + parent-pre-creation for the sensitive paths = end-to-end runnable.
- Passes `--mcp-config /tmp/dpt-smoke-mcp-config.json` (built in Phase 1 step 5) so the Linear MCP is available even when `--plugin-dir` shadows plugin-loaded MCPs (run #1 F-DR3).
- Passes `--plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit` to load the in-tree plugin under test (not the cached version under `~/.claude-st/plugins/cache/`).
- Has `--max-budget-usd 3` (per-skill budget cap).
- Receives a fully-pre-baked prompt where the slash command is the **literal first line of the user message**, not wrapped in natural language. Plugin skills carry `disable-model-invocation: true`, which blocks the child's model from calling them via the Skill tool; only user-typed slash commands trigger them (run #1 F-DR2). Pre-baked answers go on the lines after.
- Has its stdout/stderr captured to `/tmp/dpt-smoke-<skill>.log`.

Skills to run, in order:

1. `/dev-process-toolkit:setup` — pre-baked answers: stack=Bun+TS, tracker=linear, team=STE, project=<the smoke-test project from Phase 1>, jira_ac_field=blank, branch_template=default, docs flags=all-false. **The prompt MUST acknowledge the pre-existing `.claude/settings.json` and `.mcp.json`** (Phase 1 step 6) and instruct the child to take the idempotent-merge branch — do not blindly let it try to overwrite, since that hits the F-DR7 block and aborts the chain. Reference template: `/tmp/dpt-smoke-prompt-setup.txt` from a successful run #3.
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

## Allowlist matrix (informational)

Under `--permission-mode bypassPermissions` (Phase 0), the child is unconstrained — there is no `--allowedTools` to enforce. The matrix below documents which tools each skill is *expected* to need; if a child uses something far outside this set, that's a finding worth investigating, but the bypass mode means no enforcement.

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
- **Children get pre-baked answers, never live Q&A.** The whole point of `-p` is that there's no interactive shell; the prompt template must answer every question up front. The slash command must be the **literal first line** of the prompt (plugin skills are `disable-model-invocation: true`, so wrapping it in natural language causes the child to refuse). If a skill genuinely can't be driven non-interactively (e.g. /brainstorm), it goes in the "explicitly NOT run" list with a reason.
- **Capture, don't fix.** /smoke-test surfaces issues into a findings file. Triage and fix happens via /spec-write + /implement on the toolkit repo, not inline. The skill's outputs are evidence, not patches.
- **One run per release cycle.** Don't re-run for fun; each run costs real tokens and Linear teardown labor.
- **Driver-side caveats live in the findings file**, not inline as plugin issues. If a finding is "claude-st -p doesn't support X", that's a smoke-test infrastructure note, not an FR against the plugin.
- **Update this skill when the plugin's skill list changes.** New plugin skill = new entry in the chain (or in the "NOT run" list with rationale). Caught only by manual review — there's no probe for skill-list freshness here.

## Threat model

`bypassPermissions` (in the child) plus parent-side pre-creation of `.claude/settings.json` and `.mcp.json` is a sharp combination. This skill uses it because the alternatives ("Phase 2 cannot run" — runs #2 and #3 falsified everything else), and a smoke test that cannot run has zero value. The safety rails that make this acceptable, in order of load-bearingness:

1. **Hard-coded path.** The test-project path is always `<toolkit-repo-parent>/dpt-test-project`, with basename hard-coded. Pre-flight #6 verifies basename, sibling-of-toolkit-repo, real-path resolution, and not-a-symlink. The bypass is scoped to one well-known throwaway directory; the operator's other projects are unaffected.
2. **Throwaway directory.** Phase 1 creates the dir; Phase 5 deletes it. There is no persistent state worth corrupting — every run starts from `bun init` and ends with `rm -rf`. A misbehaving child can damage at most one ephemeral scaffold.
3. **No network egress beyond the documented MCPs.** The child has no network-side tools beyond `mcp__linear__*` (via `--mcp-config`). It cannot exfiltrate to arbitrary hosts.
4. **Budget cap.** `--max-budget-usd 3` per skill caps the blast radius of a runaway child to ~$18 across the chain.
5. **Operator approval.** Phase 0 prints the contract and requires explicit `y`. The operator sees the bypass + the path before any side effects.
6. **Linear writes are scoped to one throwaway project.** Phase 1 creates `DPT Smoke Test (<date>)` and the chain writes only to it; Phase 5 archives it (`state: completed`). No risk to other Linear projects in the team.

What this does NOT protect against:
- A child that deliberately writes outside the test-project path. `bypassPermissions` allows arbitrary filesystem writes — there is no per-path guard at runtime. Mitigation: pre-flight #6 ensures the cwd is the throwaway dir, but the child *could* `cd /` and `rm -rf /tmp/important`. We accept this because the children are claude sessions running known plugin skills, not adversarial code; the failure mode is "plugin skill is buggy and writes outside cwd" (a finding worth surfacing), not "attacker uses smoke-test as an exploit vector."
- A compromised plugin skill. If the in-tree plugin under test is malicious, bypassPermissions hands it the keys. Mitigation: this skill is project-local; only the toolkit maintainer runs it; the plugin under test is the toolkit author's own code. This is dogfooding, not third-party-code execution.

If the threat model changes (e.g. the toolkit accepts contributions from outside the maintainer set), revisit this section before another /smoke-test run.

**Coverage caveat** (re-stated for emphasis): the option-5 pattern means the smoke test always exercises /setup's "files-already-exist, idempotent merge" branch, NOT its fresh-create branch. Fresh-create coverage requires a separate manual probe by the operator running /setup against a truly empty `.claude/` directory in their own claude session (where the harness will prompt them to approve the writes). This is acceptable because (a) the dominant operator-observed flow is "files exist from a prior run," (b) the fresh-create logic is small and has been hand-validated repeatedly during M27/M29 development, and (c) the alternative is no end-to-end smoke test at all.
