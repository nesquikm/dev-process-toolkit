---
name: smoke-test
description: Spawn a fresh Bun project under ../dpt-test-project-<tracker> and drive the dev-process-toolkit plugin's full skill chain (/setup → /spec-write → /implement → /gate-check → /spec-review → /simplify) via claude-st -p child sessions, capturing findings. Pre-release sanity check, not CI. Real Linear or Jira writes (per `--tracker`), ~10 min wall-clock. Two-terminal tandem runs (one per tracker) are supported.
argument-hint: '[--tracker linear|jira] [--jira-project KEY] [--keep] [--linear-team STE] [--feature-stub greet]'
disable-model-invocation: true
---

# /smoke-test

Drive the dev-process-toolkit plugin end-to-end against a freshly-scaffolded Bun project, capturing functional gaps that only manifest at runtime in a fresh checkout. **This is a project-local skill** — it lives in `.claude/skills/smoke-test.md` of the dev-process-toolkit repo, not in the plugin itself. Downstream users never see it.

This is the autonomous variant: the parent claude session spawns `claude-st -p` children, captures their output, and writes findings + a teardown checklist. The skill drives **either** the Linear path (default, `--tracker linear`, runs #1–#4) **or** the Jira path (`--tracker jira --jira-project <KEY>`, runs #5–#6) — the canonical chain (`/setup → /spec-write → /implement → /gate-check → /spec-review → /simplify`) is identical in both modes; only Phase 1 (project setup) and Phase 5 (teardown) branch on `--tracker`. See § smoke-test runs at the bottom of this file for the full reference-run list.

Every per-run artifact is keyed on the resolved `<tracker>` (one of `linear` / `jira`): the test-project basename is `../dpt-test-project-<tracker>`, the findings file is `/tmp/dpt-smoke-findings-<date>-<tracker>.md`, per-skill logs are `/tmp/dpt-smoke-<tracker>-<skill>.log`, the wrapped MCP config is `/tmp/dpt-smoke-mcp-config-<tracker>.json`, and the approval record is `/tmp/dpt-smoke-<date>-<tracker>-approval.txt`. This is what makes the two-terminal tandem run (§ Operator-driven parallelism, below) safe.

## When to use

- Before `/ship-milestone M<N>` runs, as a pre-release sanity check.
- After landing any FR that touches `skills/setup/SKILL.md`, `skills/spec-write/SKILL.md`, `skills/implement/SKILL.md`, `skills/gate-check/SKILL.md`, `skills/spec-archive/SKILL.md`, or any of the `templates/` files.
- Not for every commit, not in CI — this is expensive (real LLM tokens, real Linear writes) and slow (~10 minutes wall-clock per tracker; ~11–14 min wall-clock for a tandem run, see § Operator-driven parallelism).

## Operator-driven parallelism

Two `/smoke-test` invocations may run **concurrently in two terminals**, one per tracker, without filesystem collision or artifact-overwrite races. Per-tracker artifact isolation makes this safe by construction:

- `--tracker linear` writes to `../dpt-test-project-linear` and `/tmp/dpt-smoke-*-linear.{md,log,json,txt}`.
- `--tracker jira --jira-project <KEY>` writes to `../dpt-test-project-jira` and `/tmp/dpt-smoke-*-jira.{md,log,json,txt}`.

The two runs never touch the same path, never read the same MCP config, and never write the same findings file. Each invocation owns its own approval gate, its own teardown checklist, and its own trace.

**No combined-mode flag.** `--tracker linear,jira` does not exist; there is no parent-side fan-out, no console-multiplexing, and **no merged findings file** — each terminal emits its own `/tmp/dpt-smoke-findings-<date>-<tracker>.md`. If a combined view is needed, read the two findings files side-by-side. This was a deliberate brainstorm choice (2026-04-30, approach 1 selected over approaches 2 and 3) — minimum viable surface area, clean failure isolation per tracker, no merged-findings logic to maintain.

**Rate-limit caveat.** Both child chains bill against the same Anthropic API key concurrently, so the wall-clock win is **below 2×** — the API throttles the two streams against a shared budget. A typical tandem completes in ~11–14 min wall-clock vs. ~10 min solo, not 5 min. This is expected and acceptable; plan for ~70% of theoretical 2×. If the wall-clock win is consistently below 1.3× across multiple tandem runs, file a follow-up FR with measured traces — the next milestone may revisit (e.g., approach 2 — one driver, fan-out in Phase 2 only).

**Failure isolation.** A hang or abort in one terminal does not stall the other; each invocation is self-contained. The operator can `Ctrl-C` one and let the other complete. Phase 5 teardown runs independently per tracker.

## Argument parsing

Parse `$ARGUMENTS` once, before any pre-flight runs:

- `--tracker linear|jira` — pick the tracker mode (canonical chain target). **Default `linear`** for back-compat — pre-M44 invocations (no flag) MUST behave byte-for-byte identically to the Linear path. Any value outside `{linear, jira}` ⇒ NFR-10 canonical refusal naming the unknown value and the supported set.
- `--jira-project <KEY>` — required when `--tracker jira` is passed; ignored on the Linear path. Carries the Atlassian Space (Jira project) key (e.g., `DST`); pre-flight #8 verifies visibility before Phase 1 runs.
- `--keep`, `--linear-team`, `--feature-stub` — unchanged.

Resolved values flow into the rest of the skill: pre-flights #3 / #5 fire on the Linear path, #7 / #8 fire on the Jira path; Phase 1 step 4 + step 6 + Phase 2 setup answers + Phase 5 teardown all branch on `--tracker`. Linear-mode invocations skip every Jira-only step verbatim; Jira-mode invocations skip every Linear-only step verbatim. No path runs both adapters in one invocation.

## Pre-flight refusals

Each fires before any side effects, exits non-zero with an NFR-10-shape message. Pre-flights #3 / #5 are **Linear-only** and fire only when `--tracker linear` (default) is active; pre-flights #7 / #8 are **Jira-only** and fire only when `--tracker jira` is active. Pre-flights #1, #2, #4, #6 always fire regardless of `--tracker`:

1. **Not in the dev-process-toolkit repo.** `pwd` must end in `/dev-process-toolkit`. The skill writes to `../dpt-test-project-<tracker>` (a sibling of the repo); running it from elsewhere creates the test project in the wrong place.
2. **`../dpt-test-project-<tracker>` already exists** (per-tracker basename — `../dpt-test-project-linear` for `--tracker linear`, `../dpt-test-project-jira` for `--tracker jira`). Refuse unless `--keep` was passed at the *previous* invocation against the **same tracker** (in which case verify the dir is empty / matches the expected post-teardown shape). If a prior same-tracker run left state, the operator should `rm -rf ../dpt-test-project-<tracker>` and re-run, or pass an explicit recovery mode. The refusal message names the per-tracker path so a Linear run does not refuse just because a concurrent Jira run owns `../dpt-test-project-jira` (operator-driven parallelism, see § Operator-driven parallelism).
3. **(Linear-only) Linear MCP not available** in `~/.claude-st/` config. The skill calls Linear via `mcp__linear__*` tools through the child claude-st sessions; without the MCP server registered, those calls fail mid-run and leave half-created issues.
4. **Uncommitted changes in the toolkit repo.** The skill doesn't modify the toolkit repo, but a dirty tree means the operator may be mid-feature; surface this before tying up 10 minutes on a smoke run that may be against a moving target.
5. **(Linear-only) Linear team key not resolvable.** Default `STE`; override with `--linear-team`. Verify via `mcp__linear__list_teams` before starting.
6. **Path-safety on the test-project location.** Before spawning any child with `--permission-mode bypassPermissions` (see Phase 0), the driver MUST verify the resolved test-project path:
   - Resolves with `realpath` (no broken symlinks). On macOS `realpath` requires the path to exist; resolve via the parent dir + basename instead, since the test-project itself doesn't yet exist when this fires.
   - Has the toolkit-repo path as its parent's parent (i.e. is a true sibling of `dev-process-toolkit`, not an ancestor, child, or unrelated location).
   - Basename matches one of the closed allow-list `{dpt-test-project-linear, dpt-test-project-jira}` exactly — no other forms accepted (the bare `dpt-test-project` basename is intentionally rejected). Hard-coded by design; bypassPermissions is scoped to two well-known throwaway paths, one per tracker.
   - Is not a symlink, is not inside `$HOME` directly (must be under a `workspace/` ancestor), is not the toolkit repo itself.
   Any failure refuses with NFR-10. This is the load-bearing safety rail that justifies bypassPermissions in Phase 2.

   **Reference implementation** (originally verified 2026-04-27 against six adversarial cases — wrong-basename, not-sibling, symlink-decoy, is-toolkit, no-workspace-ancestor, canonical-good; M46 expanded the canonical-good case to two valid forms — `dpt-test-project-linear` and `dpt-test-project-jira` — and added three new negative cases — bare basename `dpt-test-project`, garbage-suffix `dpt-test-project-foo`, case-mismatch `dpt-test-project-LINEAR`):

   ```bash
   TOOLKIT_REPO="$(pwd)"
   TRACKER="${TRACKER:?--tracker must resolve to linear|jira before pre-flight #6}"
   TEST_PATH="../dpt-test-project-${TRACKER}"
   TOOLKIT_REAL="$(realpath "$TOOLKIT_REPO")"
   TEST_DIR_REAL="$(realpath "$(dirname "$TEST_PATH")")" || exit 1
   TEST_REAL="$TEST_DIR_REAL/$(basename "$TEST_PATH")"
   case "$(basename "$TEST_REAL")" in
     dpt-test-project-linear|dpt-test-project-jira) ;;
     *) exit 1 ;;
   esac
   [ "$(dirname "$TEST_REAL")" = "$(dirname "$TOOLKIT_REAL")" ] || exit 1
   [ ! -e "$TEST_REAL" ] || [ ! -L "$TEST_REAL" ] || exit 1
   case "$TEST_REAL" in "$HOME"/workspace/*) ;; *) exit 1 ;; esac
   [ "$TEST_REAL" != "$TOOLKIT_REAL" ] || exit 1
   ```

7. **(Jira-only) Atlassian MCP not available** in `~/.claude-st/` config. When `--tracker jira` is active, the chain calls Jira via `mcp__atlassian__*` tools through the child claude-st sessions; without the Atlassian Rovo MCP server registered AND OAuth-bound, those calls fail mid-run and leave half-created issues. Probe: call `mcp__atlassian__atlassianUserInfo` from the parent session before Phase 0 fires. Any error path — server not registered, OAuth token absent / expired, principal unauthenticated — refuses with NFR-10 canonical shape:

   ```
   Atlassian Rovo MCP not loaded or not OAuth-bound.
   Remedy: register the Atlassian Rovo MCP in ~/.claude-st/ and complete the one-time OAuth flow via mcp__atlassian__authenticate, then re-run /smoke-test --tracker jira.
   Context: tracker=jira, probe=atlassianUserInfo, skill=smoke-test
   ```

   Linear-mode invocations skip this probe entirely.

8. **(Jira-only) Jira project (Space) not visible / `--jira-project` missing.** When `--tracker jira` is active, `--jira-project <KEY>` is required and the configured key MUST appear in the response of `mcp__atlassian__getVisibleJiraProjects(searchString=<KEY>)` — i.e., the authenticated principal can see the Space. The probe inspects `response.values[].key`; refusal fires both for the missing-flag case and the not-visible case (single rail, two messages):

   ```
   --jira-project <KEY> is required when --tracker jira is passed.
   Remedy: re-run /smoke-test --tracker jira --jira-project <KEY> with the Space key (e.g., DST).
   Context: tracker=jira, flag=--jira-project, skill=smoke-test
   ```

   ```
   Jira project '<KEY>' not visible to the authenticated principal.
   Probe: mcp__atlassian__getVisibleJiraProjects(searchString=<KEY>) → response.values[].key did not contain '<KEY>'.
   Remedy: create the Space in the Jira UI before running /smoke-test, or grant the OAuth principal membership; then re-run.
   Context: tracker=jira, project=<KEY>, skill=smoke-test
   ```

   Linear-mode invocations skip this probe entirely. The visibility result is cached for Phase 1 step 4 (which becomes a vacuous no-op when the probe already passed).

## Flow

The flow is six phases. Each phase prints its name + status (RUN / PASS / FAIL / SKIP) so the operator can follow along. On any FAIL, the phase reports what happened and offers to continue or abort.

### Phase 0 — Pre-approval gate

The skill spawns `claude-st -p` children with `--permission-mode bypassPermissions` AND pre-creates `.claude/settings.json` + `.mcp.json` from the parent's Bash tool (run #3 F-DR7 — the harness's sensitive-path classification of those two files survives bypass mode at the *child*'s model layer, but parent-side shell I/O via heredoc is not subject to it). See the **Threat model** section at the bottom of this file for why this combination is acceptable here. Briefly: the test-project path is hard-coded to one of `../dpt-test-project-{linear,jira}` (verified by pre-flight #6's two-element allow-list), the directory is throwaway (created and torn down per run), and the alternatives (`acceptEdits + per-path Write` in run #2, plain `bypassPermissions` in run #3) were both empirically falsified.

Print this contract to the operator and prompt for `y` to proceed:

The "Real <tracker> writes will occur" line branches on `--tracker`:

- **Linear path:** `Real Linear writes will occur (test project + ~6 issues). Total cost ~$X-Y in tokens.`
- **Jira path:** `Real Jira writes will occur in Space <flag-value> (~6 work items, all carrying the dpt-smoke label so Phase 5 can transition them to Done). Total cost ~$X-Y in tokens.`

```
/smoke-test will:
  1. Pre-create .claude/settings.json and .mcp.json from the driver process
     (parent's Bash heredoc, not subject to the child's sensitive-path block).
  2. Spawn claude-st child sessions in ../dpt-test-project-<tracker> with
     --permission-mode bypassPermissions.

<rendered-tracker-line>

Path-safety pre-flights have verified the test-project path is a true sibling
of the toolkit repo (basename "dpt-test-project-<tracker>", one of the closed
allow-list {dpt-test-project-linear, dpt-test-project-jira}, under a
workspace/ ancestor, not a symlink, not the toolkit repo itself).
bypassPermissions is scoped to this one path; the operator's other projects
are unaffected. A concurrent run against the other tracker (see § Operator-
driven parallelism) writes to its own basename and never touches this one.

CAVEAT: smoke test exercises /setup's "files-already-exist, idempotent merge"
branch, NOT the fresh-create branch. Fresh-create coverage requires a separate
manual probe.

Proceed? [y/n]
```

Substitute `<rendered-tracker-line>` with the per-tracker line above before printing — never present the literal `<rendered-tracker-line>` placeholder to the operator. Substitute `<tracker>` with the resolved value (`linear` / `jira`) — likewise never print the placeholder literal.

Refuse on `n`. On `y`, log the approval to `/tmp/dpt-smoke-<date>-<tracker>-approval.txt` and proceed.

### Phase 1 — Setup

1. Create `../dpt-test-project-<tracker>` and run `bun init -y`.
2. Remove `bun init`'s stub `CLAUDE.md` (the plugin's `/setup` will overwrite it; cleaner to start blank).
3. `cd ../dpt-test-project-<tracker> && git init -q && git add -A && git commit -q -m "chore: bun init scaffold"`.
4. **Tracker workspace setup** — branches on `--tracker`:

   - **Linear path (`--tracker linear`, default).** Create a Linear project named `DPT Smoke Test (<YYYY-MM-DD>)` under team `STE` via `mcp__linear__save_project`. Save the project ID + URL to the findings file's header.
   - **Jira path (`--tracker jira`).** **No creation call** — the Atlassian Rovo MCP exposes no `createJiraProject` tool, so the operator must have created the Space (Jira project) in the Jira UI manually before running `/smoke-test`. Pre-flight #8 has already verified visibility via `mcp__atlassian__getVisibleJiraProjects`; this step is a vacuous re-affirmation. Save the Space key (e.g., `DST`) and the Atlassian site URL to the findings file's header. Document: the Space is reused across runs (no per-run isolation); Phase 5 teardown closes only the work items this run created (matched by label `dpt-smoke` + creation-time window).
5. **MCP config — branches on `--tracker`:**

   - **Linear path.** Construct the wrapped Linear MCP config at `/tmp/dpt-smoke-mcp-config-linear.json`. Source: `~/.claude-st/plugins/marketplaces/claude-plugins-official/external_plugins/linear/.mcp.json` (a bare server entry without the `mcpServers:` envelope). Wrap it as `{"mcpServers": <source>}` and write to /tmp. This is required because `--plugin-dir` (used to load the in-tree plugin under test) shadows plugin-loaded MCPs (see F-DR3 from run #1).
   - **Jira path.** Construct the wrapped Atlassian Rovo MCP config at `/tmp/dpt-smoke-mcp-config-jira.json` directly (the Rovo MCP entry is a single-line `http`-transport URL with no auth material — child sessions inherit OAuth state from `~/.claude-st/`):

     ```json
     {"mcpServers": {"atlassian": {"type": "http", "url": "https://mcp.atlassian.com/v1/mcp/authv2"}}}
     ```

     The same `--plugin-dir` shadowing concern from the Linear path applies, so wrapping is required either way.
6. **Pre-create the sensitive files from the parent's Bash heredoc** (run #3 F-DR7 fix). The child claude session under `bypassPermissions` is still blocked from writing `.claude/settings.json` and `.mcp.json` (the block is at the model layer, not the OS or harness-wide). The parent's Bash tool uses shell I/O (`cat > file <<EOF`), which is not subject to that classification, so the driver writes them directly. The `.claude/settings.json` allow-list is identical in both modes; `.mcp.json` branches on `--tracker`:

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
   ```

   - **Linear path** (`--tracker linear`, default):

     ```bash
     cat > .mcp.json <<'EOF'
     {
       "mcpServers": {
         "linear": { "type": "http", "url": "https://mcp.linear.app/mcp" }
       }
     }
     EOF
     ```

   - **Jira path** (`--tracker jira`):

     ```bash
     cat > .mcp.json <<'EOF'
     {
       "mcpServers": {
         "atlassian": { "type": "http", "url": "https://mcp.atlassian.com/v1/mcp/authv2" }
       }
     }
     EOF
     ```

     **OAuth state caveat.** The driver writes only the `mcpServers:` envelope (URL + transport). No auth material lands on disk under the test project; OAuth tokens live in `~/.claude-st/` and are inherited by the child claude-st process at startup.

   Additionally, on the **Jira path**, the driver pre-stages the `### Jira` workspace-binding sub-section so the /setup child takes the idempotent-merge branch and emits the right CLAUDE.md `## Task Tracking` shape on its own. The /setup child receives pre-baked answers (Phase 2 step 1) that resolve to:

   ```markdown
   ## Task Tracking

   mode: jira
   mcp_server: atlassian
   jira_ac_field: description
   branch_template: {type}/{ticket-id}-{slug}

   ### Jira

   project: <flag-value>
   default_labels: [dpt-smoke]
   ```

   `jira_ac_field: description` is the zero-config sentinel from STE-154 AC-STE-154.3 — ACs live as a bullet list under a `## Acceptance Criteria` heading inside each Jira issue's description body; pull_acs / push_ac_toggle parse and rewrite that section atomically. `default_labels: [dpt-smoke]` is the free-form `### Jira` sub-section field (per `docs/patterns.md` § Schema L Workspace binding sub-sections); the Jira adapter forwards every entry into `mcp__atlassian__createJiraIssue.additional_fields.labels` on every issue created during the run, which is what makes Phase 5 teardown's `labels = "dpt-smoke"` JQL find them.

   Match the rest of the canonical content from `plugins/dev-process-toolkit/skills/setup/SKILL.md` step 6/7 (refresh as the plugin evolves). The /setup child detects existing files and takes the idempotent-merge branch.
7. Print: "Setup phase complete. Test project: ../dpt-test-project-<tracker>; tracker: <linear|jira>; <Linear project URL | Jira Space key + site URL>; MCP config: /tmp/dpt-smoke-mcp-config-<tracker>.json; sensitive files pre-created."

### Phase 2 — Run the canonical chain

Spawn one `claude-st -p` child per skill, sequentially. Each child:

- Has `cwd=../dpt-test-project-<tracker>`.
- Is invoked as `CLAUDE_CONFIG_DIR=~/.claude-st claude -p ...` — NOT `claude-st -p`. The `claude-st` zsh alias does not expand inside the parent harness's Bash tool (run #1 F-DR1).
- Uses `--permission-mode bypassPermissions`. Required for the chain's normal Bash + MCP operations to skip per-prompt approval. NOT sufficient alone for `.claude/settings.json` / `.mcp.json` writes — those are blocked even under bypass (run #3 F-DR7), which is why Phase 1 step 6 pre-creates them from the parent. Combined: bypass for the bulk of the chain + parent-pre-creation for the sensitive paths = end-to-end runnable.
- Passes `--mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json` (built in Phase 1 step 5; `linear` entry on the Linear path, `atlassian` entry on the Jira path) so the active tracker MCP is available even when `--plugin-dir` shadows plugin-loaded MCPs (run #1 F-DR3). The per-tracker filename keeps a concurrent run against the other tracker from clobbering this run's config (operator-driven parallelism).
- Passes `--plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit` to load the in-tree plugin under test (not the cached version under `~/.claude-st/plugins/cache/`).
- Has `--max-budget-usd 3` (per-skill budget cap).
- Receives a fully-pre-baked prompt where the slash command is the **literal first line of the user message**, not wrapped in natural language. Plugin skills carry `disable-model-invocation: true`, which blocks the child's model from calling them via the Skill tool; only user-typed slash commands trigger them (run #1 F-DR2). Pre-baked answers go on the lines after.
- Has its stdout/stderr captured to `/tmp/dpt-smoke-<tracker>-<skill>.log` (e.g., `/tmp/dpt-smoke-jira-implement.log`).

Skills to run, in order:

1. `/dev-process-toolkit:setup` — pre-baked answers branch on `--tracker`:

   - **Linear path:** `stack=Bun+TS, tracker=linear, mcp_server=linear, team=STE, project=<the smoke-test project from Phase 1>, jira_ac_field=blank, branch_template=default, docs flags=all-false`. The pre-baked workspace-binding sub-section emits `### Linear` with `team:` + `project:` (and optionally `default_labels:` if downstream callers want labels — not used by the Linear smoke today).
   - **Jira path:** `stack=Bun+TS, tracker=jira, mcp_server=atlassian, project=<--jira-project flag value>, jira_ac_field=description, branch_template=default, docs flags=all-false, default_labels=[dpt-smoke]`. The pre-baked workspace-binding sub-section emits `### Jira` with `project:` + `default_labels:` so the Jira adapter forwards `dpt-smoke` into every `mcp__atlassian__createJiraIssue.additional_fields.labels` call. **Skip Jira AC custom-field discovery** — the pre-baked `jira_ac_field: description` answer short-circuits `/setup` step 7b's discover_field.ts call (zero-config sentinel path). **Skip the Linear team/project probe** — the workspace binding is fully resolved from the flag.

   **In both modes, the prompt MUST acknowledge the pre-existing `.claude/settings.json` and `.mcp.json`** (Phase 1 step 6) and instruct the child to take the idempotent-merge branch — do not blindly let it try to overwrite, since that hits the F-DR7 block and aborts the chain. Reference template: `/tmp/dpt-smoke-prompt-setup.txt` from a successful run #3 (Linear) or a future run #6 (Jira).
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

Group findings by skill and severity. Append to `/tmp/dpt-smoke-findings-<YYYY-MM-DD>-<tracker>.md` (per-tracker filename keeps a concurrent run's findings file separate; see § Operator-driven parallelism). Use the template at `.claude/skills/smoke-test-template.md` (TODO: separate file once the template stabilizes; for now, follow the shape of the canonical 2026-04-25 run at `/tmp/dpt-smoke-findings.md`).

Header includes: date, tracker (`linear` or `jira`), plugin version (read from `plugins/dev-process-toolkit/.claude-plugin/plugin.json`), driver-side caveats, what worked, what didn't, suggested follow-up FR titles.

### Phase 4 — Verify-on-disk

For each major output the skills claim to produce, verify it actually landed on disk. Most rows are tracker-agnostic; the `.mcp.json` entry, the FR's compact tracker block, and the ticket-state assertion branch on `--tracker`:

- `../dpt-test-project-<tracker>/CLAUDE.md` — exists, has `## Task Tracking`, has `## Docs` (post-M29 STE-107). On the **Jira path**, `## Task Tracking` declares `mode: jira`, `mcp_server: atlassian`, `jira_ac_field: description`, and a `### Jira` sub-section with `project: <flag>` + `default_labels: [dpt-smoke]`. On the **Linear path**, `mode: linear`, `mcp_server: linear`, `jira_ac_field:` blank, `### Linear` sub-section with `team:` + `project:`.
- `../dpt-test-project-<tracker>/.claude/settings.json` — exists, valid JSON, has the canonical allow-list (post-M29 STE-106).
- `../dpt-test-project-<tracker>/.mcp.json` — exists; on the Linear path has the `linear` adapter entry, on the Jira path has the `atlassian` adapter entry (post-M29 STE-106).
- `../dpt-test-project-<tracker>/specs/{requirements.md, technical-spec.md, testing-spec.md, plan/M1.md}` — exist.
- `../dpt-test-project-<tracker>/specs/frs/<feature-id>.md` OR `specs/frs/archive/<feature-id>.md` — exists with no `id:` field (post-M29 STE-110); compact tracker block `{ linear: STE-N }` on the Linear path or `{ jira: <KEY>-N }` on the Jira path.
- Tracker ticket exists, status = `Done`, assignee = current user, completion timestamp populated. **Linear path:** `mcp__linear__get_issue` returns `status: "Done"`, `completedAt` set. **Jira path:** `mcp__atlassian__getJiraIssue` returns the work item in the `Done` status (or its workflow-level equivalent reached via the `getTransitionsForJiraIssue` `to.statusCategory.key == "done"` fallback).
- `bunx tsc --noEmit && bun test` exits 0; expected feature-stub test count.

Each verification result feeds into Phase 3's findings.

### Phase 5 — Teardown

Teardown branches on `--tracker`. The directory cleanup (`rm -rf ../dpt-test-project-<tracker>`) keys on the per-tracker basename in both modes; the tracker-side cleanup differs because Atlassian's MCP exposes no `deleteJiraIssue` and no `deleteJiraProject` (documented limitation, not a bug). A concurrent run against the other tracker is unaffected by this teardown — its dir, findings, logs, and approval record live under a different per-tracker suffix.

#### Linear path (`--tracker linear`, default)

**On `--keep` (default off):** print the teardown checklist for the operator and exit:

```
Smoke test complete. Findings: /tmp/dpt-smoke-findings-<date>-linear.md.

Teardown when ready:
  rm -rf ../dpt-test-project-linear
  # In Linear: archive or delete the "DPT Smoke Test (<date>)" project
  #   (id <project-id>, team STE)
```

**Without `--keep`:** prompt `Delete ../dpt-test-project-linear and the Linear project? [y/n/keep]`. On `y`: `rm -rf` the dir; call `mcp__linear__save_project` with `state: completed` (Linear's no-delete-only-archive behavior is fine — the project becomes inaccessible from the team list but issues remain auditable). On `keep`: same as `--keep`. On `n`: same as `--keep` minus the suggestion.

#### Jira path (`--tracker jira`)

The Atlassian MCP exposes no `deleteJiraIssue`. Teardown therefore closes (transitions to `Done`) every work item this run created in the configured Space — matched by label `dpt-smoke` + a creation-time window — rather than archiving the Space itself (the Space is reused across runs).

1. Resolve `<run-start>` — the ISO-8601 timestamp captured at Phase 0 acceptance (e.g., `2026-04-29T13:30:00Z`). The run window is `[run-start, now]`.
2. Search the configured Space:

   ```
   JQL: project = <flag-value> AND labels = "dpt-smoke" AND created >= "<run-start>"
   ```

   Call `mcp__atlassian__searchJiraIssuesUsingJql(cloudId=<resolved>, jql=<above>, fields=["summary","status","created","labels"])`. Empty `issues[]` ⇒ nothing to clean up; print "Phase 5: no `dpt-smoke`-labeled work items in <flag-value> within run window — nothing to transition" and proceed to the dir-cleanup prompt.
3. For each work item returned, resolve the canonical `Done` transition id once via `mcp__atlassian__getTransitionsForJiraIssue(cloudId, issueIdOrKey=<first-result>)`. Match `transitions[].to.name == "Done"` first; fallback to `transitions[].to.statusCategory.key == "done"` (canonical category, per `adapters/jira.md` § MCP tool names — the same category-key fallback `transition_status` uses). Cache the transition id for subsequent items in the same workflow.
4. For each work item, call `mcp__atlassian__transitionJiraIssue(cloudId, issueIdOrKey, transition={id: <resolved>})`. Idempotent — items already in `Done` round-trip cleanly (the transition either no-ops or re-fires). Per the Jira adapter's silent-no-op trap (`adapters/jira.md` § Silent no-op trap), re-fetch each item after the call and assert `updated`/`statuscategorychangedate` advanced past pre-call; otherwise raise NFR-10 canonical refusal naming the work item key + observed timestamps.
5. **On `--keep` (default off):** print the teardown checklist for the operator and exit:

   ```
   Smoke test complete. Findings: /tmp/dpt-smoke-findings-<date>-jira.md.
   Transitioned to Done: <N> work items (project=<flag-value>, label=dpt-smoke, run-window=[<run-start>, now]).

   Teardown when ready:
     rm -rf ../dpt-test-project-jira
     # In Jira: the Space (<flag-value>) is reused; only run-window items were
     # transitioned. Manual JQL for orphan cleanup, if needed:
     #   project = <flag-value> AND labels = "dpt-smoke" AND status != "Done"
   ```

6. **Without `--keep`:** prompt `Delete ../dpt-test-project-jira? [y/n/keep]` (the tracker-side cleanup already ran in steps 2–4, so this prompt is dir-only). On `y`: `rm -rf` the dir. On `keep`: same as `--keep`. On `n`: same as `--keep` minus the suggestion.

**Idempotency.** If a previous run aborted mid-flow and left orphaned `dpt-smoke`-labeled items, the next run's Phase 5 picks them up — the JQL filter is by label + creation window, and widening the window costs nothing. Manual cleanup via JQL `project = <flag-value> AND labels = "dpt-smoke" AND status != "Done"` is always available.

## Allowlist matrix (informational)

Under `--permission-mode bypassPermissions` (Phase 0), the child is unconstrained — there is no `--allowedTools` to enforce. The matrix below documents which tools each skill is *expected* to need; if a child uses something far outside this set, that's a finding worth investigating, but the bypass mode means no enforcement.

The MCP-tool column lists the **Linear path** in plain text and the **Jira path** in italics; only one path is active per run.

| Skill | Bash patterns | MCP tools |
|-------|---------------|-----------|
| /setup | `git *`, `bun *`, `bunx *`, `ls *`, `mkdir *`, `grep *`, `rm *`, `mv *`, `cp *`, `find *`, `jq *` | `mcp__linear__{list_teams,get_team,list_projects,get_project}` *or `mcp__atlassian__{atlassianUserInfo,getVisibleJiraProjects}` (Jira path)* |
| /spec-write | (same) + `date *` | (above) + `mcp__linear__{save_issue,list_issues,get_issue,list_issue_statuses,list_issue_labels,list_users}` *or `mcp__atlassian__{createJiraIssue,editJiraIssue,getJiraIssue,searchJiraIssuesUsingJql} (Jira path)`* |
| /implement | (same) | (above) + `mcp__linear__{save_comment,list_comments}` *or `mcp__atlassian__{addCommentToJiraIssue,getTransitionsForJiraIssue,transitionJiraIssue} (Jira path)`* |
| /gate-check | `git *`, `bun *`, `bunx *`, `ls *`, `grep *`, `find *`, `jq *`, `test *` | `mcp__linear__{get_issue,list_issues}` (read-only) *or `mcp__atlassian__{getJiraIssue,searchJiraIssuesUsingJql}` (read-only, Jira path)* |
| /spec-review | (same as gate-check) | (read-only) |
| /simplify | `git *`, `bun *`, `bunx *`, `ls *`, `grep *`, `find *` | (none) |

Driver-side tools (parent only, not in any child): `mcp__atlassian__{searchJiraIssuesUsingJql,getTransitionsForJiraIssue,transitionJiraIssue}` for Phase 5 teardown on the Jira path; `mcp__linear__save_project` for Phase 1 step 4 + Phase 5 teardown on the Linear path.

Tools surface common to all: `Read`, `Edit`, `Write`, `Glob`, `Grep`, `Skill`, `TaskCreate`, `TaskUpdate`, `TaskList`, plus `Agent` for `/implement` (sub-agent invocations during Stage B code review).

## Output

All output paths carry the per-tracker `<tracker>` suffix (one of `linear` / `jira`) so a concurrent run against the other tracker (§ Operator-driven parallelism) cannot overwrite them:

- `/tmp/dpt-smoke-findings-<YYYY-MM-DD>-<tracker>.md` — findings file (the deliverable).
- `/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.log` — per-skill child stdout/stderr.
- `/tmp/dpt-smoke-mcp-config-<tracker>.json` — wrapped MCP config consumed by every child via `--mcp-config`.
- `/tmp/dpt-smoke-<date>-<tracker>-approval.txt` — operator approval record from Phase 0.

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

1. **Hard-coded paths.** The test-project path is always `<toolkit-repo-parent>/dpt-test-project-<tracker>` for `<tracker>` in the closed two-element allow-list `{linear, jira}` — scoped to two well-known throwaway directories, one per tracker, basename hard-coded by pre-flight #6 (which verifies basename membership in `{dpt-test-project-linear, dpt-test-project-jira}`, sibling-of-toolkit-repo, real-path resolution, and not-a-symlink). The bypass is scoped to those two paths; the operator's other projects are unaffected. A single invocation only ever touches one of the two — operator-driven parallelism (§ Operator-driven parallelism) runs them in separate processes against separate dirs.
2. **Throwaway directory.** Phase 1 creates the dir; Phase 5 deletes it. There is no persistent state worth corrupting — every run starts from `bun init` and ends with `rm -rf` against the per-tracker basename. A misbehaving child can damage at most one ephemeral scaffold (its own tracker's dir; the sibling tracker's dir, if a concurrent run is alive, is owned by a separate process and not shared).
3. **No network egress beyond the documented MCPs.** The child has no network-side tools beyond `mcp__linear__*` (Linear path) or `mcp__atlassian__*` (Jira path) via `--mcp-config`. It cannot exfiltrate to arbitrary hosts.
4. **Budget cap.** `--max-budget-usd 3` per skill caps the blast radius of a runaway child to ~$18 across the chain.
5. **Operator approval.** Phase 0 prints the contract and requires explicit `y`. The operator sees the bypass + the path before any side effects.
6. **Tracker writes are scoped to a single throwaway scope.** **Linear path:** Phase 1 creates `DPT Smoke Test (<date>)` and the chain writes only to it; Phase 5 archives it (`state: completed`). **Jira path:** the chain writes only into the `--jira-project` Space (e.g., `DST`); every work item created carries the `dpt-smoke` label (driven by `### Jira`.default_labels), and Phase 5 transitions only those run-window items to `Done`. The Space itself is not deleted (Atlassian MCP exposes no `deleteJiraProject`). No risk to other Linear projects in the team or other Jira Spaces in the tenant.

What this does NOT protect against:
- A child that deliberately writes outside the test-project path. `bypassPermissions` allows arbitrary filesystem writes — there is no per-path guard at runtime. Mitigation: pre-flight #6 ensures the cwd is the throwaway dir, but the child *could* `cd /` and `rm -rf /tmp/important`. We accept this because the children are claude sessions running known plugin skills, not adversarial code; the failure mode is "plugin skill is buggy and writes outside cwd" (a finding worth surfacing), not "attacker uses smoke-test as an exploit vector."
- A compromised plugin skill. If the in-tree plugin under test is malicious, bypassPermissions hands it the keys. Mitigation: this skill is project-local; only the toolkit maintainer runs it; the plugin under test is the toolkit author's own code. This is dogfooding, not third-party-code execution.

If the threat model changes (e.g. the toolkit accepts contributions from outside the maintainer set), revisit this section before another /smoke-test run.

**Coverage caveat** (re-stated for emphasis): the option-5 pattern means the smoke test always exercises /setup's "files-already-exist, idempotent merge" branch, NOT its fresh-create branch. Fresh-create coverage requires a separate manual probe by the operator running /setup against a truly empty `.claude/` directory in their own claude session (where the harness will prompt them to approve the writes). This is acceptable because (a) the dominant operator-observed flow is "files exist from a prior run," (b) the fresh-create logic is small and has been hand-validated repeatedly during M27/M29 development, and (c) the alternative is no end-to-end smoke test at all.

## smoke-test runs

Reference runs in chronological order. Each entry: date, plugin version, tracker mode, outcome, follow-up milestone (if any). Update on every successful or aborted run; this is the audit trail for the dogfood loop.

| # | Date | Plugin version | Tracker | Outcome | Follow-up |
|---|------|----------------|---------|---------|-----------|
| 1 | 2026-04-25 | v1.29.0 | linear | First end-to-end run; 9 findings → `/tmp/dpt-smoke-findings.md` | M29 milestone |
| 2 | 2026-04-26 | v1.31.0 | linear | Aborted under `acceptEdits + per-path Write` permission strategy | Motivated bypassPermissions revision |
| 3 | 2026-04-27 | v1.31.0 | linear | First end-to-end success under option-5 pattern (parent pre-creates `.claude/settings.json` + `.mcp.json`); 3 plugin findings + 1 driver-side caveat | Confirmed Phase 0 contract |
| 4 | 2026-04-27 | v1.31.0 | linear | Six-case adversarial probe of pre-flight #6 path-safety (wrong-basename, not-sibling, symlink-decoy, is-toolkit, no-workspace-ancestor, canonical-good); all six refused/passed correctly | Locked the path-safety reference implementation |
| 5 | M43 / pre-v1.43.0 | v1.42.x → v1.43.0 | jira (manual pilot) | Manual Jira-mode walkthrough during M43 implementation; surfaced F1–F7 against the pre-v1.43.0 Jira adapter spec (dispatch-key + tool-name corrections). **At v1.43.0 ship, AC-STE-154.9 was operator-deferred** — only step 1 (visibility check via `mcp__atlassian__getVisibleJiraProjects`) was live-verified during `/implement`; steps 2–6 stayed unverified in `specs/notes/jira-smoke-5.md` (see commit `28c595d` body) | M43 (STE-154) shipped v1.43.0 with the spec corrections; AC-STE-154.9 retroactive-validation rolled forward into M44 / smoke #6 |
| 6 | TBD (M44) | post-v1.43.0 main | jira (first automated) | First automated `/smoke-test --tracker jira --jira-project DST` run against the verified-good DST Space. **Provides retroactive validation for M43's AC-STE-154.9** (ACs 2–6 — pull, edit, transition, search, comment) **and** is the regression tripwire for M44 onwards. Trace target: `/tmp/dpt-smoke-jira-<YYYY-MM-DD>.md` | M44 (STE-155); any F-class findings against M43's corrections route to a follow-up FR labeled `M44-followup`, not back into M43 (already archived) |
