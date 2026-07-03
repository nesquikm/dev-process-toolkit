---
name: smoke-test
description: Spawn a fresh Bun project under ../dpt-test-project-<tracker> and drive the dev-process-toolkit plugin's full skill chain (/setup → /spec-write → /implement → /gate-check → /spec-review → /simplify) via claude-st -p child sessions, capturing findings. Pre-release sanity check, not CI. Real Linear or Jira writes (per `--tracker`), ~10 min wall-clock. Two-terminal tandem runs (one per tracker) are supported.
argument-hint: '[--tracker linear|jira] [--jira-project KEY] [--keep] [--linear-team STE] [--feature-stub greet]'
disable-model-invocation: true
---

# /smoke-test

Drive the dev-process-toolkit plugin end-to-end against a freshly-scaffolded Bun project, capturing functional gaps that only manifest at runtime in a fresh checkout. **This is a project-local skill** — it lives in `.claude/skills/smoke-test.md` of the dev-process-toolkit repo, not in the plugin itself. Downstream users never see it.

This is the autonomous variant: the parent claude session spawns `claude-st -p` children, captures their output, and writes findings + a teardown checklist. The skill drives **either** the Linear path (default, `--tracker linear`) **or** the Jira path (`--tracker jira --jira-project <KEY>`) — the canonical chain (`/setup → /spec-write → /implement → /gate-check → /spec-review → /simplify`) is identical in both modes; only Phase 1 (project setup) and Phase 5 (teardown) branch on `--tracker`. Per-run findings live at `/tmp/dpt-smoke-findings-<date>-<tracker>.md`; that's the persistent audit trail.

Every per-run artifact is keyed on the resolved `<tracker>` (one of `linear` / `jira`): the test-project basename is `../dpt-test-project-<tracker>`, the findings file is `/tmp/dpt-smoke-findings-<date>-<tracker>.md`, per-skill logs are `/tmp/dpt-smoke-<tracker>-<skill>.log`, the wrapped MCP config is `/tmp/dpt-smoke-mcp-config-<tracker>.json`, and the approval record is `/tmp/dpt-smoke-<date>-<tracker>-approval.txt`. This is what makes the two-terminal tandem run (§ Operator-driven parallelism, below) safe.

## When to use

- Before `/ship-milestone M<N>` runs, as a pre-release sanity check.
- After landing any FR that touches `skills/setup/SKILL.md`, `skills/spec-write/SKILL.md`, `skills/implement/SKILL.md`, `skills/gate-check/SKILL.md`, `skills/spec-archive/SKILL.md`, or any of the `templates/` files.
- Not for every commit, not in CI — this is slow (~10 minutes wall-clock per tracker; ~11–14 min wall-clock for a tandem run, see § Operator-driven parallelism) and produces real Linear/Jira writes.

## Operator-driven parallelism

Two `/smoke-test` invocations may run **concurrently in two terminals**, one per tracker, without filesystem collision or artifact-overwrite races. Per-tracker artifact isolation makes this safe by construction:

- `--tracker linear` writes to `../dpt-test-project-linear` and `/tmp/dpt-smoke-*-linear.{md,log,json,txt}`.
- `--tracker jira --jira-project <KEY>` writes to `../dpt-test-project-jira` and `/tmp/dpt-smoke-*-jira.{md,log,json,txt}`.

The two runs never touch the same path, never read the same MCP config, and never write the same findings file. Each invocation owns its own approval gate (Phase 0 — Pre-approval), its own teardown checklist, and its own trace. Phase 0.5 cleanup honors the same isolation invariant: it is per-tracker-scoped — each leg removes only its own stale scratch, including `/tmp/dpt-smoke-mcp-config-<tracker>.json`, so neither leg can delete the config the other leg's Phase 1 step 5 just wrote.

**No combined-mode flag.** `--tracker linear,jira` does not exist; there is no parent-side fan-out, no console-multiplexing, and **no merged findings file** — each terminal emits its own `/tmp/dpt-smoke-findings-<date>-<tracker>.md`. If a combined view is needed, read the two findings files side-by-side. This was a deliberate brainstorm choice (2026-04-30, approach 1 selected over approaches 2 and 3) — minimum viable surface area, clean failure isolation per tracker, no merged-findings logic to maintain.

**Rate-limit caveat.** Both child chains bill against the same Anthropic API key concurrently, so the wall-clock win is **below 2×** — the API throttles the two streams against a shared budget. A typical tandem completes in ~11–14 min wall-clock vs. ~10 min solo, not 5 min. This is expected and acceptable; plan for ~70% of theoretical 2×. If the wall-clock win is consistently below 1.3× across multiple tandem runs, file a follow-up FR with measured traces — the next milestone may revisit (e.g., approach 2 — one driver, fan-out in Phase 2 only).

**Failure isolation.** A hang or abort in one terminal does not stall the other; each invocation is self-contained. The operator can `Ctrl-C` one and let the other complete. Phase 5 teardown runs independently per tracker.

## Argument parsing

Parse `$ARGUMENTS` once, before any pre-flight runs:

- `--tracker linear|jira` — pick the tracker mode (canonical chain target). **Default `linear`** for back-compat — pre-M44 invocations (no flag) MUST behave byte-for-byte identically to the Linear path. Any value outside `{linear, jira}` ⇒ NFR-10 canonical refusal naming the unknown value and the supported set.
- `--jira-project <KEY>` — required when `--tracker jira` is passed; ignored on the Linear path. Carries the Atlassian Space (Jira project) key (e.g., `DST`); pre-flight #8 verifies visibility before Phase 1 runs.
- `--reset` — boolean, default off. When present, pre-flight #2's existing-test-project refusal is replaced by an auto `rm -rf ../dpt-test-project-<tracker>` so the run continues against a clean slate. Surfaces in the Phase 0 contract as a separate operator-visible line. Default behavior unchanged — without `--reset`, pre-flight #2 still refuses.
- `--keep`, `--linear-team`, `--feature-stub` — unchanged.

Resolved values flow into the rest of the skill: pre-flights #3 / #5 fire on the Linear path, #7 / #8 fire on the Jira path; Phase 1 step 4 + step 6 + Phase 2 setup answers + Phase 5 teardown all branch on `--tracker`. Linear-mode invocations skip every Jira-only step verbatim; Jira-mode invocations skip every Linear-only step verbatim. No path runs both adapters in one invocation.

## Pre-flight refusals

Each fires before any side effects, exits non-zero with an NFR-10-shape message. Pre-flights #3 / #5 are **Linear-only** and fire only when `--tracker linear` (default) is active; pre-flights #7 / #8 are **Jira-only** and fire only when `--tracker jira` is active. Pre-flights #1, #2, #4, #6, #10 always fire regardless of `--tracker`:

1. **Not in the dev-process-toolkit repo.** `pwd` must end in `/dev-process-toolkit`. The skill writes to `../dpt-test-project-<tracker>` (a sibling of the repo); running it from elsewhere creates the test project in the wrong place.
2. **`../dpt-test-project-<tracker>` already exists** (per-tracker basename — `../dpt-test-project-linear` for `--tracker linear`, `../dpt-test-project-jira` for `--tracker jira`). Refuse unless `--keep` was passed at the *previous* invocation against the **same tracker** (in which case verify the dir is empty / matches the expected post-teardown shape). **`--reset` escape hatch:** when `--reset` is present, this refusal is suppressed and the driver runs `rm -rf ../dpt-test-project-<tracker>` before continuing — surface in the Phase 0 contract as a separate operator-visible line. Default behavior unchanged — without `--reset` (or `--keep`), pre-flight #2 still refuses on existing dir, and the operator must `rm -rf` manually. The refusal message names the per-tracker path so a Linear run does not refuse just because a concurrent Jira run owns `../dpt-test-project-jira` (operator-driven parallelism, see § Operator-driven parallelism).
3. **(Linear-only) Linear MCP not available** in `~/.claude-st/` config. The skill calls Linear via `mcp__linear__*` tools through the child claude-st sessions; without the MCP server registered, those calls fail mid-run and leave half-created issues.
4. **Uncommitted changes in the toolkit repo.** The skill doesn't modify the toolkit repo, but a dirty tree means the operator may be mid-feature; surface this before tying up 10 minutes on a smoke run that may be against a moving target.
5. **(Linear-only) Linear team key not resolvable.** Default `STE`; override with `--linear-team`. **Probe by key first** — call `mcp__linear__get_team` with the team key (e.g., `STE`) directly, OR call `mcp__linear__list_teams` (no `query=`, large `limit=`) and filter the response on `team.key == "<TEAM_KEY>"`. The key path is exact and resolves the canonical operator entry point on first try. **Name-prefix `query=<TEAM_KEY>`** matching is kept only as a fallback for legacy paths where the key probe misses (e.g., the operator passes a team display-name fragment instead of a key); fall back only after the key probe yields no hit. A bogus key fails with NFR-10 canonical refusal naming the unknown key and the supported keys (smoke #7 F1 — without this ordering, `STE` is rejected as a name-prefix miss even though it's the canonical key).
6. **Path-safety on the test-project location.** Before spawning any child (see Phase 0), the driver MUST verify the resolved test-project path:
   - Resolves with `realpath` (no broken symlinks). On macOS `realpath` requires the path to exist; resolve via the parent dir + basename instead, since the test-project itself doesn't yet exist when this fires.
   - Has the toolkit-repo path as its parent's parent (i.e. is a true sibling of `dev-process-toolkit`, not an ancestor, child, or unrelated location).
   - Basename matches one of the closed allow-list `{dpt-test-project-linear, dpt-test-project-jira}` exactly — no other forms accepted (the bare `dpt-test-project` basename is intentionally rejected). Hard-coded by design; the cwd guard pins child spawns to two well-known throwaway paths, one per tracker.
   - Is not a symlink, is not inside `$HOME` directly (must be under a `workspace/` ancestor), is not the toolkit repo itself.
   Any failure refuses with NFR-10. This is the load-bearing **cwd guard** that pins the test-project path to one of two known throwaway directories — it bounds *where* the children operate, while the tracked `permissions.allow` allow-list (`.claude/settings.json`, STE-252) bounds *what* tool calls they may issue. The cwd guard no longer "justifies" any bypass posture; per-tool-call enforcement runs out of the tracked allow-list under default permission mode in Phase 2.

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

8. **(Jira-only) Jira project (Space) not visible / `--jira-project` missing.** When `--tracker jira` is active, `--jira-project <KEY>` is required and the configured key MUST appear in the response of `mcp__atlassian__getVisibleJiraProjects(searchString=<KEY>)` — i.e., the authenticated principal can see the Space. The probe inspects `response.values[].key`; refusal fires for the missing-flag case and the not-visible case across **three message variants** keyed on the response shape (smoke #9 / Jira run 1 driver-side caveat — STE-191):

   | Response shape | Variant | Refusal message |
   |----------------|---------|-----------------|
   | flag missing | (a) | `--jira-project <KEY> is required when --tracker jira is passed.` |
   | `values[]` empty | (b) generic | `Probe: mcp__atlassian__getVisibleJiraProjects(searchString=<X>) → response.values[].key did not contain '<X>'.` |
   | `values[]` has exactly one entry whose `name` matched `<X>` and whose `key` did NOT match `<X>` | (c) single-hit name-match | `'<X>' matched Space "<matched-name>" by display name, but the KEY is "<matched-key>". Pass --jira-project <matched-key> and retry.` |
   | `values[]` has 2+ entries | (b) generic | (same as empty — surfacing one KEY out of N would mislead) |

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

   ```
   Jira project '<KEY>' not visible — but '<KEY>' matched Space "<matched-name>" by display name, and the KEY is "<matched-key>".
   Remedy: re-run /smoke-test --tracker jira --jira-project <matched-key>.
   Context: tracker=jira, input=<KEY>, matched-name="<matched-name>", matched-key=<matched-key>, skill=smoke-test
   ```

   **Rationale for variant (c).** Single-hit name-match is the unambiguous case where the operator clearly meant the matched Space — surfacing the resolved KEY is a cheap usability win that preserves the defensive refusal (the gate stays in place; the message just sharpens). Empty / multi-hit responses stay at the generic shape: surfacing one KEY out of zero or N would mislead the operator into rerunning with a wrong key. Silent auto-correction is rejected — refusal must fire so cases where the operator named the wrong Space entirely don't slip past.

   Linear-mode invocations skip this probe entirely. The visibility result is cached for Phase 1 step 4 (which becomes a vacuous no-op when the probe already passed).

9. **(Jira-only) Orphaned `dpt-smoke` ghost cluster.** Optional warning probe — fires only when `--tracker jira` is active. JQLs the configured Space for unfinished `dpt-smoke`-labeled work items leftover from prior aborted / partial runs:

   ```
   project = <flag-value> AND labels = "dpt-smoke" AND status != "Done"
   ```

   Call `mcp__atlassian__searchJiraIssuesUsingJql(cloudId=<resolved>, jql=<above>, fields=["summary","status","created","labels"])` and read `response.issues.length`. **Warns (does not refuse)** when the count exceeds a threshold (default `5`; tunable inline). The run continues regardless — the operator decides when to run the manual sweep. Output line shape:

   ```
   pre-flight #9: <N> orphaned dpt-smoke items in <flag-value> (status != Done) — consider one-time sweep before next run.
   ```

   When the count is `<= 5`, emit a clean line `pre-flight #9: 0 orphans (or count under threshold)` and continue silently. **Linear path skips the probe entirely** — Linear's per-run project archival keeps no equivalent ghost cluster. Smoke #6 F5 motivated this; the cumulative count grows whenever Phase 5 teardown is interrupted before transitioning the just-created work items.

10. **Child-spawn pattern present in the tracked allow-list** (STE-351 AC-STE-351.1 — mirrors `/conformance-loop` pre-flight (f)). Always fires regardless of `--tracker`. Read the toolkit repo's tracked `.claude/settings.json`, JSON-parse it, and assert `.permissions.allow` **contains** the canonical child-spawn pattern literal `Bash(claude:*)` — a contains-check (`jq -e '.permissions.allow | index("Bash(claude:*)")' .claude/settings.json`), not merely a non-empty check. The Phase 1 step 6 scaffold snippet copies this allow-list into the test project's `.claude/settings.json`; if the pattern is absent, every nested `claude -p` spawn issued by the children is classifier-denied headless and the grandchildren die as 0-byte transcripts (the M94 false-green). Refuse with NFR-10 canonical shape:

    ```
    permissions.allow lacks the child-spawn pattern "Bash(claude:*)" in .claude/settings.json.
    Remedy: add "Bash(claude:*)" to the permissions.allow allow-list in the tracked .claude/settings.json (and keep the Phase 1 step 6 scaffold snippet in sync), then re-run /smoke-test.
    Context: pre-flight=spawn_pattern_allow_check, file=.claude/settings.json, skill=smoke-test
    ```

## Flow

The flow is six phases. Each phase prints its name + status (RUN / PASS / FAIL / SKIP) so the operator can follow along. On any FAIL, the phase reports what happened and offers to continue or abort.

### Phase 0 — Pre-approval gate

The skill spawns `claude-st -p` children in default permission mode and pre-creates `.claude/settings.json` + `.mcp.json` from the parent's Bash tool. The tracked `.claude/settings.json` carries a `permissions.allow` allow-list (STE-252) enumerating every tool surface the chain needs — Bash command patterns, Edit/Write/Read/Grep/Glob, `mcp__linear__*` / `mcp__atlassian__*`; children read it from the spawn cwd and run hands-off within that scope. The parent still pre-creates `.claude/settings.json` + `.mcp.json` because the harness's sensitive-path classification of those two files survives even default permission mode at the *child*'s model layer, so a child cannot write them itself; the parent's Bash heredoc (shell I/O is not subject to that classification) is the only path. See the **Threat model** section below for the residual-risk picture under the tracked-allow-list posture. The historical alternatives (`acceptEdits + per-path Write`, plain `bypassPermissions` without parent pre-creation) were both empirically falsified during early dogfooding (STE-185); the current `default-mode + content-rich permissions.allow` is neither.

Print this contract to the operator and prompt for `y` to proceed:

The "Real <tracker> writes will occur" line branches on `--tracker`:

- **Linear path:** `Real Linear writes will occur (test project + ~6 issues).`
- **Jira path:** `Real Jira writes will occur in Space <flag-value> (~6 work items, all carrying the dpt-smoke label so Phase 5 can transition them to Done).`

```
/smoke-test will:
  1. Pre-create .claude/settings.json and .mcp.json from the driver process
     (parent's Bash heredoc, not subject to the child's sensitive-path block).
  2. Spawn claude-st child sessions in ../dpt-test-project-<tracker> in
     default permission mode (per-tool-call enforcement via the tracked
     permissions.allow allow-list in .claude/settings.json).

<rendered-tracker-line>

Path-safety pre-flights have verified the test-project path is a true sibling
of the toolkit repo (basename "dpt-test-project-<tracker>", one of the closed
allow-list {dpt-test-project-linear, dpt-test-project-jira}, under a
workspace/ ancestor, not a symlink, not the toolkit repo itself).
Child spawns are scoped to this one path; the operator's other projects
are unaffected. A concurrent run against the other tracker (see § Operator-
driven parallelism) writes to its own basename and never touches this one.

CAVEAT: smoke test exercises /setup's "files-already-exist, idempotent merge"
branch, NOT the fresh-create branch. Fresh-create coverage requires a separate
manual probe.

<rendered-reset-line>

Proceed? [y/n]
```

When `--reset` is present, substitute `<rendered-reset-line>` with the literal line:

```
RESET: existing ../dpt-test-project-<tracker> will be deleted before run.
```

When `--reset` is absent, drop the placeholder (no blank line emitted).

Substitute `<rendered-tracker-line>` with the per-tracker line above before printing — never present the literal `<rendered-tracker-line>` placeholder to the operator. Substitute `<tracker>` with the resolved value (`linear` / `jira`) — likewise never print the placeholder literal.

Refuse on `n`. On `y`, log the approval to `/tmp/dpt-smoke-<date>-<tracker>-approval.txt` and proceed.

**`requires-input:` Phase 0 acceptance — STE-232 AC-STE-232.6.** This Phase 0 acceptance gate carries the cross-skill `requires-input:` contract documented in `docs/auto-mode-protocol.md`. The three-branch resolution mirrors the protocol's Refusal Mechanism:

- **Marker present** (`<dpt:auto-approve>v1</dpt:auto-approve>` observed in the parent prompt body) ⇒ `default-applied`: log the approval automatically and proceed without prompting. The Phase 2 driver heredoc-injects this marker as the first body line of every canonical `claude -p` child spawn — that injection is the canonical worked example of the default-apply mechanism (STE-226 cross-reference; see `docs/auto-mode-protocol.md` § Default-Apply Mechanism).
- **Marker absent + non-interactive stdin** (e.g., parent piped `< /dev/null`) ⇒ `refused`: route through `requireOrRefuse(...)` so the failure surfaces as `RequiresInputRefusedError` with NFR-10 canonical shape — Verdict / Remedy / Context — rather than silent imputation. The smoke driver MUST NOT model-impute "y" because the operator described an unattended run; that is the v2.13.0 incident shape this FR closes.
- **Marker absent + interactive stdin** ⇒ `user-supplied`: prompt the operator and gate on their `y`/`n` answer as today.

Phase 2's heredoc-injected `<dpt:auto-approve>v1</dpt:auto-approve>` body line is the byte-checkable token children check for; the canonical injection sites in this driver are documented in `docs/auto-mode-protocol.md` § Default-Apply Mechanism so a future skill author has one place to look.

### Phase 0.5 — Clear stale per-run scratch

After Phase 0 acceptance, before Phase 1.1, unconditionally clear stale per-run scratch from prior invocations, then verify the wipe on disk. Every per-run scratch class is wiped (widened per STE-358) — prompt-template scratch files, and every per-run artifact keyed on the resolved tracker: per-skill logs, pidfiles, rc files, start markers, attempt logs, and the resolved tracker's own wrapped MCP config from a prior run:

```bash
rm -f /tmp/dpt-smoke-prompt-*.txt /tmp/dpt-smoke-<tracker>-*.log /tmp/dpt-smoke-<tracker>-*.pid /tmp/dpt-smoke-<tracker>-*.rc /tmp/dpt-smoke-<tracker>-*.start /tmp/dpt-smoke-<tracker>-*.attempt* /tmp/dpt-smoke-mcp-config-<tracker>.json
# Verify on disk — the wiped globs must yield zero survivors (no output expected):
ls /tmp/dpt-smoke-prompt-*.txt /tmp/dpt-smoke-<tracker>-*.log /tmp/dpt-smoke-<tracker>-*.pid /tmp/dpt-smoke-<tracker>-*.rc /tmp/dpt-smoke-<tracker>-*.start /tmp/dpt-smoke-<tracker>-*.attempt* /tmp/dpt-smoke-mcp-config-<tracker>.json 2>/dev/null
```

**Verified wipe (STE-358; iter-2 F2).** The post-`rm` `ls` in the fence above is the pass condition: the wiped globs must yield **zero survivors** on disk (the `ls` prints nothing and exits non-zero). If any survivor is listed, refuse to proceed (NFR-10), naming the survivors in the refusal — do not continue to Phase 1.1 with stale scratch present. Self-reported "scratch cleared" without the on-disk assertion is **forbidden**: the iter-2 (2026-07-02) driver reported "Phase 0.5 — PASS (scratch cleared)" while the morning run's per-skill logs survived on disk, and a stale result-bearing log can false-pass downstream chain-completeness checks.

This closes smoke #6 F1 / smoke #7 F2 / smoke #7 F4 — stale prompt-template scratch files left over from prior runs caused Write-tool errors and stale-content reuse (a 2026-04-27 Linear-flavored prompt stub re-fired on a later Jira run). Clearing per-skill logs keyed on the resolved tracker prevents cross-run log smear when re-running against the same tracker. The `/tmp/dpt-smoke-mcp-config-<tracker>.json` path (smoke #9 / Linear F1; scoped per STE-354) removes only the resolved tracker's own wrapped config so Phase 1 step 5 always starts from a clean filesystem regardless of whether the operator uses the Write tool or a Bash heredoc to produce it. The STE-186 stale-cleanup intent is preserved and staleness coverage is unchanged — each leg cleans its own stale config, so every stale `mcp-config` file is still removed before the leg that owns it re-runs. The cross-tracker `mcp-config` glob was dropped (2026-07-02 F1) and must not be widened back: it races the concurrent tandem leg — under operator-driven parallelism, one leg's Phase 0.5 `rm` could delete the wrapped config the other leg's Phase 1 step 5 had just written.

**Defense-in-depth annotation (STE-185).** The `dpt-smoke-prompt-*.txt` glob in the rm above is now **defense-in-depth, not load-bearing** — post-STE-185, the driver no longer writes any prompt-template scratch files to disk (heredoc-on-stdin replaces them; see Phase 2 § STE-185 below). On post-STE-185 runs, the glob is expected to be a no-op. A non-empty match indicates either a pre-STE-185 (legacy) driver run on this machine or stale files left by an external process — keeping the cleanup line costs nothing and protects against transitional drift while older smoke driver versions could still be checked out elsewhere.

**audit-trail invariant — do NOT delete** `/tmp/dpt-smoke-findings-*.md` and `/tmp/dpt-smoke-<date>-<tracker>-approval.txt`. Those are audit-trail artifacts and are intentionally retained across runs (preserve them; never widen the rm to include the findings or approval prefix). The findings files accumulate across runs by design (one per tracker per date); the approval record is the operator's consent log and stays for forensics. Only the per-run scratch globs above are wiped — the findings file and approval record are explicitly excluded from cleanup (and from the post-`rm` `ls` verification).

### Phase 1 — Setup

1. Create `../dpt-test-project-<tracker>` and run `bun init -y`.
2. Remove `bun init`'s stub `CLAUDE.md` (the plugin's `/setup` will overwrite it; cleaner to start blank).
3. `cd ../dpt-test-project-<tracker> && git init -q && git add -A && git commit -q -m "chore: bun init scaffold"`.
4. **Tracker workspace setup** — branches on `--tracker`:

   - **Linear path (`--tracker linear`, default).** Create a Linear project under team `STE` via `mcp__linear__save_project`. The base name is `DPT Smoke Test (<YYYY-MM-DD>)`.

     **Same-day collision auto-disambiguation (smoke #9 F4).** Before `save_project`, call `mcp__linear__list_projects(query="DPT Smoke Test (<YYYY-MM-DD>)")` and filter the response on `p.name.startsWith("DPT Smoke Test (<YYYY-MM-DD>") && p.name.endsWith(")")` (precise equality vs. Linear's substring `query` semantics). On zero matches, save with the canonical name verbatim (no suffix). On one or more matches, parse the suffix integers from each match's name (`(<YYYY-MM-DD>)` ⇒ 1, `(<YYYY-MM-DD>-v2)` ⇒ 2, etc.), pick the smallest integer `N` ≥ 2 not present in the match set, and save as `DPT Smoke Test (<YYYY-MM-DD>-v<N>)`. The scheme is deterministic and inspectable.
     - **Worked example.** Smoke #8 lands first on a given day → name `DPT Smoke Test (2026-05-01)`. A same-day smoke #9 finds the prior project → name auto-resolves to `DPT Smoke Test (2026-05-01-v2)`. A hypothetical same-day smoke #10 → `DPT Smoke Test (2026-05-01-v3)`.

     Save the project ID + URL to the findings file's header. The Phase 1 setup print line at step 7 (which prints the project URL) carries the resolved name implicitly — a suffixed name in the print indicates the same-day collision was auto-handled; an unsuffixed canonical-name print indicates no prior project existed.
   - **Jira path (`--tracker jira`).** **No creation call** — the Atlassian Rovo MCP exposes no `createJiraProject` tool, so the operator must have created the Space (Jira project) in the Jira UI manually before running `/smoke-test`. Pre-flight #8 has already verified visibility via `mcp__atlassian__getVisibleJiraProjects`; this step is a vacuous re-affirmation. Save the Space key (e.g., `DST`) and the Atlassian site URL to the findings file's header. Document: the Space is reused across runs (no per-run isolation); Phase 5 teardown closes only the work items this run created (matched by label `dpt-smoke` + creation-time window).
5. **MCP config — branches on `--tracker`:**

   - **Linear path.** Construct the wrapped Linear MCP config at `/tmp/dpt-smoke-mcp-config-linear.json`. Source: `~/.claude-st/plugins/marketplaces/claude-plugins-official/external_plugins/linear/.mcp.json` (a bare server entry without the `mcpServers:` envelope). Wrap it as `{"mcpServers": <source>}` and write to /tmp. This is required because `--plugin-dir` (used to load the in-tree plugin under test) shadows plugin-loaded MCPs, so the active tracker MCP must be passed via `--mcp-config` from a per-tracker wrapper file written to `/tmp/`.
   - **Jira path.** Construct the wrapped Atlassian Rovo MCP config at `/tmp/dpt-smoke-mcp-config-jira.json` directly (the Rovo MCP entry is a single-line `http`-transport URL with no auth material — child sessions inherit OAuth state from `~/.claude-st/`):

     ```json
     {"mcpServers": {"atlassian": {"type": "http", "url": "https://mcp.atlassian.com/v1/mcp/authv2"}}}
     ```

     The same `--plugin-dir` shadowing concern from the Linear path applies, so wrapping is required either way.
6. **Pre-create the sensitive files from the parent's Bash heredoc.** The child claude session — even in default permission mode (STE-252) — is still blocked from writing `.claude/settings.json` and `.mcp.json`: the harness's sensitive-path classification of those two files survives at the child's model layer regardless of `permissions.allow` content. The parent's Bash tool uses shell I/O (`cat > file <<EOF`), which is not subject to that classification, so the driver writes them directly. The child model layer denies ALL `.claude/settings.json` writes — full-file Write AND append-only Edit alike (iter-2 confirmed **no child-side merge path** exists) — so the parent's pre-creation must carry the FULL final allow-list; children can never extend it. The `.claude/settings.json` allow-list is identical in both tracker paths; `.mcp.json` branches on `--tracker`:

   ```bash
   mkdir -p .claude
   cat > .claude/settings.json <<'EOF'
   {
     "permissions": {
       "allow": [
         "Bash(bun *)", "Bash(bunx *)", "Bash(git *)", "Bash(gh *)",
         "Bash(mkdir *)", "Bash(ls *)", "Bash(rm *)", "Bash(mv *)", "Bash(cp *)",
         "Bash(claude:*)"
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

6b. **Pre-seed workspace trust for the test-project path (STE-356).** Grandchildren spawned in a fresh test-project cwd ignore the scaffolded `.claude/settings.json` allow-list until the workspace is trusted — captured logs open with "Ignoring N permissions.allow entries from .claude/settings.json: this workspace has not been trusted" (2026-07-02 conformance finding F4), leaving the STE-252 policy artifact inert at the grandchild layer. Workspace trust lives in the operator's **live** `$CLAUDE_CONFIG_DIR/.claude.json` under `projects["<abs test-project path>"].hasTrustDialogAccepted`, so the driver seeds it here — after step 6's sensitive-file pre-creation, before any child spawn. The absolute test-project path is `$TEST_REAL` from pre-flight #6's `realpath` resolution (parent-dir realpath + hard-coded basename).

   **This step writes to the operator's live config — backup, merge-only write, and atomic `mv` are load-bearing, not stylistic.** A clobber here would destroy MCP registrations and session state. Back the file up first, then jq read-merge-write into a temp file and atomically `mv` it over the original (never an in-place partial write):

   ```bash
   # Phase 1 precedes Phase 2's `export CLAUDE_CONFIG_DIR` — default explicitly.
   CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude-st}/.claude.json"
   # Cross-leg mutex: tandem legs share the ONE live config file (the sole
   # exception to § Operator-driven parallelism's never-the-same-path rule).
   # Bounded: after ~60 s the lock is presumed stale (a crashed leg never
   # rmdir'd it) — refuse with NFR-10 naming the lock path; recover with
   # `rmdir /tmp/dpt-claude-json.lock`, never by skipping the mutex.
   tries=0; until mkdir /tmp/dpt-claude-json.lock 2>/dev/null; do
     tries=$((tries+1)); [ "$tries" -ge 60 ] && exit 1
     sleep 1
   done
   cp "$CFG" /tmp/dpt-smoke-<tracker>-claude-json.bak
   jq --arg p "$TEST_REAL" \
     '.projects[$p] = ((.projects[$p] // {}) + {hasTrustDialogAccepted: true})' \
     "$CFG" > /tmp/dpt-smoke-<tracker>-claude-json.tmp \
     && mv /tmp/dpt-smoke-<tracker>-claude-json.tmp "$CFG"
   rmdir /tmp/dpt-claude-json.lock
   ```

   **Merge-only discipline.** The filter touches exactly one key of exactly one project entry: an existing `projects["<abs test-project path>"]` object is merged (`// {}` supplies the empty object when absent), `hasTrustDialogAccepted` is forced `true`, and every unrelated key — `mcpServers` registrations, session state, other `projects` entries — passes through untouched. The pre-write backup at `/tmp/dpt-smoke-<tracker>-claude-json.bak` is the recovery path if anything goes wrong; the temp-file + `mv` keeps the write atomic so a mid-write failure can never leave a truncated live config. Failure modes are safe-by-construction: a `cp` or `jq` failure (missing or unparseable `$CFG`) leaves the live config untouched because the `&&` chain gates the `mv` — on any failure, release the lock, then refuse (NFR-10) rather than spawning children whose workspace is untrusted. The `mkdir` spinlock serializes concurrent read-merge-write cycles from a tandem run's two legs (both legs write different `projects` keys of the same file; unlocked, one leg's merge could clobber the other's just-written seed and silently re-introduce the F4 inert-allow-list state). Phase 5 teardown removes the seeded entry — and the backup file — under the same lock.

7. Print: "Setup phase complete. Test project: ../dpt-test-project-<tracker>; tracker: <linear|jira>; <Linear project URL | Jira Space key + site URL>; MCP config: /tmp/dpt-smoke-mcp-config-<tracker>.json; sensitive files pre-created."

### Phase 2 — Run the canonical chain

Spawn one `claude-st -p` child per skill, sequentially. Each child:

- Has `cwd=../dpt-test-project-<tracker>`.
- Is invoked as bare `claude -p ...` with `CLAUDE_CONFIG_DIR=~/.claude-st` exported once at the top of the spawning Bash block (STE-350: exported rather than inlined so every spawn line begins with `claude` and the tracked `Bash(claude:*)` allow entry matches) — NOT `claude-st -p`, because the `claude-st` zsh alias does not expand inside the parent harness's Bash tool.
- Runs in default permission mode and reads the tracked `.claude/settings.json` `permissions.allow` allow-list (STE-252) from the spawn cwd. The allow-list covers the chain's normal Bash + MCP operations at command-pattern granularity. NOT sufficient alone for `.claude/settings.json` / `.mcp.json` writes — the harness's sensitive-path classification of those two files survives default permission mode at the child's model layer, which is why Phase 1 step 6 pre-creates them from the parent. Combined: tracked allow-list for the bulk of the chain + parent-pre-creation for the sensitive paths = end-to-end runnable.
- Passes `--mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json` (built in Phase 1 step 5; `linear` entry on the Linear path, `atlassian` entry on the Jira path). `--plugin-dir` (used to load the in-tree plugin under test) shadows plugin-loaded MCPs, so the active tracker MCP must be passed via `--mcp-config` from a per-tracker wrapper file written to `/tmp/`. The per-tracker filename keeps a concurrent run against the other tracker from clobbering this run's config (operator-driven parallelism).
- Passes `--plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit` to load the in-tree plugin under test (not the cached version under `~/.claude-st/plugins/cache/`).
- Receives a fully-pre-baked prompt where the slash command is the **literal first line of the user message**, not wrapped in natural language. Plugin skills carry `disable-model-invocation: true`, so the child's model cannot call them via the Skill tool — only user-typed slash commands trigger; the prompt-pre-bake puts the slash command as the literal first line of the user message. Pre-baked answers go on the lines after.
- Has its stdout/stderr captured to `/tmp/dpt-smoke-<tracker>-<skill>.log` (e.g., `/tmp/dpt-smoke-jira-implement.log`) as **stream-json NDJSON** — every spawn passes `--output-format stream-json --verbose` (STE-352; `--verbose` is required by `claude -p` for stream-json output). Default text mode emitted only the child's final result message, so mid-stream assistant tokens — per-probe capability rows, forked `tdd-result` fences — never reached the log (smoke F2, the blind spot that let the STE-350 0-byte-grandchild false-green survive). To read a capture, lift the assistant text via `extractAssistantText` (`adapters/_shared/src/smoke_child_capture.ts`; blocks are joined line-anchored so fences stay greppable), or project `text`/`tool_use` entries via the existing `parseStreamJsonTranscript` (`adapters/_shared/src/socratic_first_turn_stream.ts`) — the same parser Phase 8 already uses. Phase 2.X's substring greps keep working unchanged: literal tokens survive JSON string encoding.
- Is spawned **detached** (`&` with its PID captured to `/tmp/dpt-smoke-<tracker>-<skill>.pid`) and awaited via the bounded poll-until-exit loop — never as a single foreground Bash call, which caps the grandchild at the harness's 10-minute per-call ceiling (STE-355; § Grandchild spawn lifecycle below).

Skills to run, in order:

1. `/dev-process-toolkit:setup` — pre-baked answers branch on `--tracker`:

   - **Linear path:** `stack=Bun+TS, tracker=linear, mcp_server=linear, team=STE, project=<the smoke-test project from Phase 1>, jira_ac_field=blank, branch_template=default, docs flags=all-false`. The pre-baked workspace-binding sub-section emits `### Linear` with `team:` + `project:` (and optionally `default_labels:` if downstream callers want labels — not used by the Linear smoke today).
   - **Jira path:** `stack=Bun+TS, tracker=jira, mcp_server=atlassian, project=<--jira-project flag value>, jira_ac_field=description, branch_template=default, docs flags=all-false, default_labels=[dpt-smoke]`. The pre-baked workspace-binding sub-section emits `### Jira` with `project:` + `default_labels:` so the Jira adapter forwards `dpt-smoke` into every `mcp__atlassian__createJiraIssue.additional_fields.labels` call. **Skip Jira AC custom-field discovery** — the pre-baked `jira_ac_field: description` answer short-circuits `/setup` step 7b's discover_field.ts call (zero-config sentinel path). **Skip the Linear team/project probe** — the workspace binding is fully resolved from the flag.

   **In both modes, the prompt MUST acknowledge the pre-existing `.claude/settings.json` and `.mcp.json`** (Phase 1 step 6) and instruct the child to take the idempotent-merge branch — do not blindly let it try to overwrite, since the sensitive-path classification block (see Phase 0 — Pre-approval gate) aborts the chain when the child attempts a fresh write. The canonical pre-baked prompt body is inlined into the Phase 2 child-spawn heredoc below (§ STE-185); do not write it to a file on disk.

   **Post-step master-merge (STE-295 AC.3).** After the `/setup` child returns, the test project sits on the `chore/setup-bootstrap` branch with the toolkit scaffold (CLAUDE.md, `specs/` tree, `.claude/` config) committed there but NOT on `master`/`main`. Before spawning step 2 (`/spec-write`), the driver MUST merge `chore/setup-bootstrap` → master so the scaffold lands on the trunk:

   ```bash
   git -C ../dpt-test-project-<tracker> checkout master \
     && git -C ../dpt-test-project-<tracker> merge --no-ff chore/setup-bootstrap -m "chore: merge setup-bootstrap → master"
   ```

   This carries the `/setup` scaffold onto master so the universal branch gate (STE-228) fires correctly on the subsequent `/spec-write` spawn and takes the auto-apply `branch_gate_default_applied` path — gate detection reads CLAUDE.md from the current branch, and without the merge the child would re-enter on `chore/setup-bootstrap` with no trunk scaffold and a degenerate gate state. The merge is `--no-ff` so the bootstrap commit's subject + footer (asserted by gate-check probe #30) stays addressable on master's first-parent line.
2. `/dev-process-toolkit:spec-write` — feature stub (default `greet`): "Add a pure function greet(name?: string) returning 'Hello, <name>!' (defaulting 'world' for undefined / empty / whitespace-only). File src/greet.ts; test src/greet.test.ts; 4 ACs."
3. `/dev-process-toolkit:implement <feature-id>` — full TDD + tracker writes (claim → release after archive). Pre-authorize the Phase 4 step 15 commit upfront. Do NOT push.

   **Post-step advisory (STE-181).** After step 3 returns, log: *"single-FR run complete — FR remains `status: active`, milestone remains `status: active`. Run `/spec-archive M<N>` to archive when ready."* The smoke driver intentionally uses the `<feature-id>` form (per `skills/implement/SKILL.md` § Invocation forms — single-FR is the canonical "ship one FR" path), which silent-skips Phase 5. The end state is correct, not drift; gate-check probe #14 emits the STE-180 advisory if the plan is fully checked. Documentation prose only — no behavioral change to the smoke driver.
4. `/dev-process-toolkit:gate-check` — read-only verification.
5. `/dev-process-toolkit:spec-review <feature-id>` — read-only spec-vs-code audit.
6. `/dev-process-toolkit:simplify` — review changed code; safe refactors applied + gate re-verified.

#### Workspace-trust spawn gate (STE-356)

Before the **first** Phase 2 spawn fires, assert that Phase 1 step 6b's trust seed actually landed in the live config. The scaffolded `.claude/settings.json` allow-list is enforcement-effective only when the spawn cwd's workspace is trusted; spawning without the entry re-creates the 2026-07-02 F4 inert-allow-list state, where every child ran on auto-mode classifier goodwill:

```bash
# Read-only probe; default the config dir (the Phase 2 export may not have run yet).
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude-st}/.claude.json"
jq -e --arg p "$TEST_REAL" \
  '.projects[$p].hasTrustDialogAccepted == true' "$CFG" > /dev/null
```

**Miss (exit non-zero) ⇒ NFR-10 canonical refusal — do not spawn:**

```text
Verdict: workspace trust missing for <abs test-project path> in $CLAUDE_CONFIG_DIR/.claude.json — the scaffolded allow-list would be inert at the child/grandchild layer (2026-07-02 F4).
Remedy: re-run Phase 1 step 6b (or seed trust manually with the step-6b jq merge), then re-run /smoke-test.
Context: skill=smoke-test, pre-flight=workspace_trust_check
```

**Hit (exit 0) ⇒ log the byte-checkable capability token** `workspace_trust_seeded` to the approval record `/tmp/dpt-smoke-<date>-<tracker>-approval.txt` (one literal line, no inference) and proceed to the first spawn. Same shape convention as `/conformance-loop`'s `spawn_pattern_allow_present` token — byte-grep-checkable by downstream `/gate-check` probes and capability-row aggregators.

#### Grandchild spawn lifecycle — detached spawn + bounded poll-until-exit (STE-355)

A single foreground Bash call caps its child at the harness's **10-minute (600 s) per-call ceiling** — the 2026-07-02 conformance run SIGTERM'd the `/implement` grandchild at exactly that ceiling (finding F2: RED→GREEN→REFACTOR completed; AUDIT and the commit never ran). Canonical-chain grandchildren routinely need longer, so no per-skill spawn may run in the foreground. Every canonical-chain spawn uses the detached-spawn + bounded-poll wrapper:

**Detached spawn with PID capture (one Bash call).** Background the `claude -p` invocation and capture its PID in the same call: `claude -p … > /tmp/dpt-smoke-<tracker>-<skill>.log 2>&1 & echo $! > /tmp/dpt-smoke-<tracker>-<skill>.pid`. Heredoc-on-stdin (§ STE-185 below) composes unchanged — the shell reads the heredoc body before the job detaches; the `< /dev/null` discipline for non-prompt-bearing children likewise composes. The reference snippets below carry the shape.

**Bounded poll-until-exit (repeated bounded Bash calls).** After the spawn call returns, poll until the PID exits. Each poll call is a **bounded multi-iteration loop** — up to 18 checks 30 s apart, ≈ ≤540 s (≈ 9 min) per call, safely under the harness's 600 s (10-minute) per-call ceiling. That is one Bash call per ~9 min instead of ~80 single-check calls across a 40-minute grandchild; the old single-check-then-end-call shape is **not** sanctioned. Never fold the whole wait into one unbounded call:

```bash
# One bounded poll call — up to 18 checks × 30 s ≈ 9 min (≤540 s), under the
# harness's 600 s per-call ceiling. Repeat this call until it reports "exited".
for i in $(seq 1 18); do
  kill -0 "$(cat /tmp/dpt-smoke-<tracker>-<skill>.pid)" 2>/dev/null || break
  sleep 30
done
if kill -0 "$(cat /tmp/dpt-smoke-<tracker>-<skill>.pid)" 2>/dev/null; then
  echo "still running — poll again"
else
  rm -f /tmp/dpt-smoke-<tracker>-<skill>.pid; echo "exited — proceed"
fi
```

**Post-exit steps compose on top, unchanged.** The STE-195 stream-idle detection, the STE-352 capture assertion, and the next sequential spawn all run only after the poll loop reports "exited" — detection runs after exit exactly as it did in the foreground form.

**Residual risk — PID reuse.** `kill -0` answers for *any* live process with that PID, so a recycled PID could in principle keep the poll looping after the grandchild exited. The risk is negligible at a 30 s poll interval on macOS/Linux PID ranges, and the Phase 2.Y chain-integrity assertion is the corroborating signal (a truncated child's capture fails the `result`-event check regardless of what the poll believed) — noted so the wrapper isn't mistaken for a liveness proof.

**Residual risk — orphan-vs-killed nondeterminism (STE-359; iter-2 F3).** If this driver dies while a grandchild is still live, whether that grandchild dies with its parent or survives as an orphan is environment-nondeterministic — process-group inheritance varies with spawn nesting, and iter-2 observed both outcomes in a single run (the Linear `/setup` grandchild was killed with its driver while the Jira one survived and completed healthily on its own). Process-group discipline (`setsid` / PGID-wide kill) was considered and rejected as the primary mechanism: it is OS/shell-dependent and unverifiable from SKILL.md prose. The deterministic recovery lives one layer up — `/conformance-loop`'s Phase A orphan-adoption block scans this driver's per-skill pidfiles post-exit and adopts any still-answering PID, polling it to exit so a surviving orphan's completed capture is recovered as evidence regardless of which way the environment broke.

**Live-pidfile session rule.** Ending the driver session — or reporting results — while any spawned grandchild is alive (a pidfile whose PID still answers `kill -0`) is **forbidden**; the bounded poll loop above is the **only sanctioned wait**. Do not substitute a single foreground Bash call (the 10-minute ceiling SIGTERMs the grandchild — F2), and do not fire the spawn then end the turn "waiting for its completion notification" (a `-p` session cannot resume on background-task notifications, so the rest of the run silently never executes — F3). The poll's exit branch removes the pidfile, so a clean session end leaves zero live pidfiles.

**Red flag — the harness's foreground-sleep block hint is NOT license to background the wait.** If a poll call leads with `sleep`, the harness blocks it with an error hint that reads roughly "Foreground `sleep` is blocked. To wait for a condition, use `run_in_background` or the Monitor tool." Do **not** follow that hint here: handing the wait to `run_in_background`/Monitor and then ending the turn IS the F3 fire-and-exit failure — a `-p` driver session never receives the completion notification, so the rest of the run silently never executes. The bounded poll loop above already avoids the block by gating each iteration on `kill -0` *before* its `sleep 30`; keep waiting with that loop, in the foreground, until the pidfile dies.

**Final-message self-check (STE-357).** Before emitting **any** final message — success or failure — run the pidfile-liveness fence below over the run's pidfile glob (`/tmp/dpt-smoke-*.pid`). Any live pidfile means a spawned grandchild is still running: resume the bounded poll loop above; a live pidfile must **never end the turn**. Runtime validation ships deferred (`[~]`): the next conformance run must show this driver polling every spawned grandchild to completion.

```bash
# Final-message self-check — run before ANY final message (success or failure).
LIVE=""
for PIDFILE in /tmp/dpt-smoke-*.pid; do
  [ -e "${PIDFILE}" ] || continue
  kill -0 "$(cat "${PIDFILE}")" 2>/dev/null && LIVE="${LIVE} ${PIDFILE}"
done
if [ -n "${LIVE}" ]; then echo "LIVE:${LIVE} — resume the bounded poll loop"; else echo "no live pidfiles — final message may be emitted"; fi
```

#### Phase 2 child-spawn discipline (stdin partition)

Every Phase 2 spawn has explicit stdin handling — no spawn relies on the child's default stdin behavior. The spawn surface partitions into two classes by whether the child needs prompt-body input:

- **Non-prompt-bearing children** (`/spec-review`, `/simplify`, `/gate-check`) — the slash command alone fully specifies the work; no extra prompt body is needed. Pipe `< /dev/null` immediately before the log redirect to skip `claude -p`'s 3-second auto-stdin-detect wait (smoke #9 / Linear F5 — STE-188). The warning `Warning: no stdin data received in 3s, proceeding without it.` is the source signal; `< /dev/null` is the documented remediation.
- **Prompt-bearing children** (`/setup`, `/spec-write`, `/implement`) — covered by STE-185's heredoc-on-stdin discipline (per-skill prompt body inlined; see § STE-185 below). Adding `< /dev/null` to those would close stdin before the heredoc body is read and break prompt delivery — the partition is deliberate.

Reference snippets — non-prompt-bearing children:

```bash
# STE-350: exported once per spawning block so every spawn line begins bare
# with `claude` and the tracked `Bash(claude:*)` allow entry matches.
export CLAUDE_CONFIG_DIR=~/.claude-st

# /gate-check — detached spawn + PID capture (STE-355); poll until exit
claude -p /dev-process-toolkit:gate-check \
  --output-format stream-json --verbose \
  --plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit \
  --mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json \
  < /dev/null > /tmp/dpt-smoke-<tracker>-gate-check.log 2>&1 &
echo $! > /tmp/dpt-smoke-<tracker>-gate-check.pid

# /spec-review — detached spawn + PID capture (STE-355); poll until exit
claude -p "/dev-process-toolkit:spec-review <feature-id>" \
  --output-format stream-json --verbose \
  --plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit \
  --mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json \
  < /dev/null > /tmp/dpt-smoke-<tracker>-spec-review.log 2>&1 &
echo $! > /tmp/dpt-smoke-<tracker>-spec-review.pid

# /simplify — detached spawn + PID capture (STE-355); poll until exit
claude -p /dev-process-toolkit:simplify \
  --output-format stream-json --verbose \
  --plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit \
  --mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json \
  < /dev/null > /tmp/dpt-smoke-<tracker>-simplify.log 2>&1 &
echo $! > /tmp/dpt-smoke-<tracker>-simplify.pid
```

#### Heredoc-on-stdin for prompt-bearing children (STE-185)

Prompt-bearing children (`/setup`, `/spec-write`, `/implement`) carry a per-skill prompt body — answers to /setup's pre-baked questions, the feature stub for /spec-write, the implementation arguments for /implement. The driver delivers the prompt body via a single-quoted bash heredoc on the child's stdin. The slash command stays the literal first line of the user message; the heredoc body provides the rest.

**Threat model — content-swap attack surface (STE-185).** Prompt files on disk are vulnerable to mid-run content swap by external processes — linters, file-mode-line auto-fixes, language servers, shared editor sessions. Smoke #9 / Jira run 2 hit this in the field: an external linter overwrote a Jira-flavored prompt file with a stale Linear-flavored stub between the parent's `Write` and the spawned `claude -p` child's read, causing silent cross-tracker corruption (the child built a Linear-mode `CLAUDE.md` on a Jira run). The heredoc-on-stdin discipline closes the window — there is no file on disk to swap. Single-quoted heredoc tag (`<<'PROMPT_EOF'`) prevents shell expansion of `$variable` references in the body so prompt content passes through to Claude verbatim.

Reference snippets — prompt-bearing children, per-skill prompt body inlined as the heredoc body. Linear-path / Jira-path branching stays inside each heredoc body (the parent renders the per-tracker fragments before piping):

```bash
# STE-350: exported once per spawning block so every spawn line begins bare
# with `claude` and the tracked `Bash(claude:*)` allow entry matches.
export CLAUDE_CONFIG_DIR=~/.claude-st

# /setup — heredoc body carries pre-baked answers + acknowledgment of pre-existing settings.json/.mcp.json
# Detached spawn + PID capture (STE-355); poll until exit before /spec-write.
claude -p \
  --output-format stream-json --verbose \
  --plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit \
  --mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json \
  > /tmp/dpt-smoke-<tracker>-setup.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:setup

stack=Bun+TS, tracker=<tracker>, mcp_server=<linear|atlassian>, ...

(Linear path) team=STE, project=<the smoke-test project from Phase 1>, jira_ac_field=blank, branch_template=default, docs flags=all-false; emit `### Linear` workspace binding.
(Jira path) project=<--jira-project flag value>, jira_ac_field=description, branch_template=default, docs flags=all-false, default_labels=[dpt-smoke]; emit `### Jira` workspace binding; skip discover_field.ts (zero-config sentinel path); skip Linear team probe.

The repo already contains .claude/settings.json and .mcp.json from the driver's pre-creation step; take the idempotent-merge branch — do not overwrite (model-layer block aborts the chain otherwise).
PROMPT_EOF
echo $! > /tmp/dpt-smoke-<tracker>-setup.pid

# /spec-write — heredoc body carries the feature stub. The marker
# `<dpt:auto-approve>v1</dpt:auto-approve>` on its own line is the
# byte-checkable pre-authorization handoff for /spec-write's draft + commit
# gates (STE-226). Without it the gates fire interactively and the child
# halts at the prompt.
# Detached spawn + PID capture (STE-355); poll until exit before /implement.
claude -p \
  --output-format stream-json --verbose \
  --plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit \
  --mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json \
  > /tmp/dpt-smoke-<tracker>-spec-write.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:spec-write

Add a pure function greet(name?: string) returning 'Hello, <name>!' (defaulting 'world' for undefined / empty / whitespace-only). File src/greet.ts; test src/greet.test.ts; 4 ACs.
PROMPT_EOF
echo $! > /tmp/dpt-smoke-<tracker>-spec-write.pid

# /implement — heredoc body carries pre-authorization for the Phase 4 step 15 commit
# Detached spawn + PID capture (STE-355); poll until exit before /gate-check.
claude -p \
  --output-format stream-json --verbose \
  --plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit \
  --mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json \
  > /tmp/dpt-smoke-<tracker>-implement.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:implement <feature-id>

Pre-authorized: proceed through Phase 4 step 15 commit on success without prompting. Do NOT push. Stay on the current branch (skip worktree prompt).
PROMPT_EOF
echo $! > /tmp/dpt-smoke-<tracker>-implement.pid
```

**Auto-approve marker contract (STE-226).** Every prompt-bearing heredoc above carries the literal line `<dpt:auto-approve>v1</dpt:auto-approve>` as the first body line. The marker is a byte-checkable pre-authorization token that child skills (`/spec-write`, `/implement`) detect by literal string match — no `<system-reminder>` introspection, no `claude -p` non-interactive inference. Children whose gates depend on operator approval (`/spec-write` § 0b step 4 + § 7a draft/commit gates; `/implement` Phase 4 step 15 commit) auto-apply `y` when the marker is in the prompt body and gate interactively otherwise. Removing the marker line (deliberate or accidental) is the canonical way to flip a smoke-driver child into interactive-gating mode for diagnostic runs; the regression to watch for is the inverse — a child that auto-applies WITHOUT the marker (covered by Phase 2.X group 1 sub-fixture 1b below).

#### Stream-idle retry-with-rollback for prompt-bearing children (STE-195)

Anthropic's API stream occasionally idles mid-response on long-running prompt-bearing child spawns (`/setup`, `/spec-write`, `/implement`), exiting the child with the canonical signature `API Error: Stream idle timeout - partial response received`. The 2026-05-04 Jira smoke caught the failure mode on `/setup`'s first attempt — the partial state created `src/.placeholder.test.ts` but no `CLAUDE.md`, no `specs/` scaffold. The driver recovered manually with a deterministic rollback recipe and a re-spawn; STE-195 builds the recovery in so a single transient turns into a quiet retry instead of a smoke-blocker.

**Detection signature.** After each prompt-bearing child exits (the STE-355 poll loop reports exit; detection composes on top of the detached wrapper, unchanged), the driver inspects the child's exit reason / captured `/tmp/dpt-smoke-<tracker>-<skill>.log` for the substring `API Error: Stream idle timeout`. Match is substring (not exact); the trailing `- partial response received` and any minor wording drift in future Anthropic API versions still trigger the path. Non-prompt-bearing children (`/gate-check`, `/spec-review`, `/simplify`) are out of scope — they are short, idempotent, and the existing `< /dev/null` discipline already shields them from the stdin-detect race.

**Rollback recipe (verbatim).** When the signature is detected, the driver runs the following inside the **test project's** working directory (e.g., `../dpt-test-project-linear` / `../dpt-test-project-jira`) — NOT inside the dpt repo cwd. The driver's per-spawn cwd handling already isolates the test project; the rollback inherits that scope. The `-e .claude -e .mcp.json` excludes preserve the parent-pre-created sensitive files (Phase 1 step 6) so the second spawn finds the same `.claude/settings.json` + `.mcp.json` it would on the first attempt.

```bash
# Run from the test project's cwd, NEVER from the dpt repo cwd.
git clean -fdq -e .claude -e .mcp.json && git checkout -- .
```

- `git clean -fdq -e .claude -e .mcp.json` — removes untracked files/directories EXCEPT `.claude/` and `.mcp.json`.
- `git checkout -- .` — reverts tracked-file modifications.
- Combined: returns the test project to its last-committed state plus the parent-pre-created sensitive files.

**Retry budget.** Exactly **one** retry per spawn (two attempts total). The third instance is genuine and surfaces as a smoke-test failure rather than looping indefinitely. Other exit modes (segfault, OOM kill, non-stream-idle Anthropic errors) do NOT retry — only the stream-idle signature has a known deterministic rollback; everything else warrants operator inspection.

**Retry-success log row (AC-STE-195.3).** After a successful retry, the driver appends a `child_stream_idle_retried` row to the Phase 2 per-skill log (`/tmp/dpt-smoke-<tracker>-<skill>.log`) carrying both attempt timestamps in UTC ISO-8601 form so the audit trail captures the transient. Template:

```
2026-05-04T06:42:11Z child_stream_idle_retried skill=/setup attempts=2
  attempt_1_started=2026-05-04T06:40:07Z attempt_1_exit=stream_idle
  attempt_2_started=2026-05-04T06:42:33Z attempt_2_exit=success
```

**Double-timeout abort (AC-STE-195.4).** When the second attempt also exits stream-idle, the driver aborts the smoke run with NFR-10 canonical refusal naming the skill that timed out twice, both attempt timestamps, and the rollback recipe operators can run manually if a third attempt is appropriate. The abort message is verbatim:

```
ABORT: /smoke-test Phase 2 spawn /<skill> stream-idle timeout twice
  attempt_1_started=<ts1> attempt_1_exit=stream_idle
  attempt_2_started=<ts2> attempt_2_exit=stream_idle
  rollback recipe: git clean -fdq -e .claude -e .mcp.json && git checkout -- .
```

**Worked example (Phase 2 `/setup` spawn, retry-success path).** The driver wraps the existing detached heredoc-on-stdin spawn (above) in a two-attempt loop scoped to the prompt-bearing-children spawn surface only. Pseudocode spanning multiple driver Bash calls (the loop is sequential, not parallel; each `[STE-355 …]` comment marks where the bounded poll-until-exit calls run before the next line executes):

```bash
# cwd: test project root, e.g. ../dpt-test-project-jira
export CLAUDE_CONFIG_DIR=~/.claude-st   # STE-350: exported so spawn lines stay bare `claude -p`
attempt_1_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
claude -p ... > /tmp/dpt-smoke-<tracker>-setup.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:setup
...prompt body...
PROMPT_EOF
echo $! > /tmp/dpt-smoke-<tracker>-setup.pid
# [STE-355: bounded poll calls (kill -0 + sleep 30) until the PID exits]

if grep -q 'API Error: Stream idle timeout' /tmp/dpt-smoke-<tracker>-setup.log; then
  attempt_1_exit=stream_idle
  # Rollback BEFORE the second attempt; recipe runs in test project cwd.
  git clean -fdq -e .claude -e .mcp.json && git checkout -- .

  attempt_2_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  claude -p ... > /tmp/dpt-smoke-<tracker>-setup.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:setup
...same prompt body...
PROMPT_EOF
  echo $! > /tmp/dpt-smoke-<tracker>-setup.pid
  # [STE-355: bounded poll calls (kill -0 + sleep 30) until the PID exits]

  if grep -q 'API Error: Stream idle timeout' /tmp/dpt-smoke-<tracker>-setup.log; then
    # Double timeout — NFR-10 abort, do not run further skills.
    cat <<EOF >> /tmp/dpt-smoke-<tracker>-setup.log
ABORT: /smoke-test Phase 2 spawn /setup stream-idle timeout twice
  attempt_1_started=$attempt_1_started attempt_1_exit=stream_idle
  attempt_2_started=$attempt_2_started attempt_2_exit=stream_idle
  rollback recipe: git clean -fdq -e .claude -e .mcp.json && git checkout -- .
EOF
    exit 1
  fi

  # Retry succeeded — append the audit row.
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat <<EOF >> /tmp/dpt-smoke-<tracker>-setup.log
$now child_stream_idle_retried skill=/setup attempts=2
  attempt_1_started=$attempt_1_started attempt_1_exit=stream_idle
  attempt_2_started=$attempt_2_started attempt_2_exit=success
EOF
fi
```

The same wrapper applies symmetrically to `/spec-write` and `/implement` — substitute the slash command, the per-skill log filename, and the heredoc body. Non-prompt-bearing spawns (`/gate-check`, `/spec-review`, `/simplify`) bypass the wrapper entirely; their `< /dev/null` snippet stays unchanged.

#### Post-return capture assertion — non-empty / non-denied (STE-352)

After **each** Phase 2 child exits (prompt-bearing and non-prompt-bearing alike; the STE-355 poll loop has reported exit and any stream-idle retry above has settled), the driver asserts the child actually produced output and no nested spawn was denied — the direct detector for the M94 0-byte-grandchild symptom, where a child whose nested `claude -p` spawn was blocked by the permission classifier still exited green over an empty log:

1. **Non-empty:** `wc -c < /tmp/dpt-smoke-<tracker>-<skill>.log` must be `> 0` — a 0-byte capture is a hard finding, never a silent pass.
2. **Non-denied:** no `result` event in the capture carries a `permission_denials[]` entry whose `tool_input.command` head is the bare word `claude` (a denied nested spawn; a command merely mentioning `claude -p` mid-string does not count).

Both checks are implemented by `checkChildSpawnCapture` (`adapters/_shared/src/smoke_child_capture.ts`); the driver runs it over each capture as it lands. Either condition failing emits exactly one finding into the run's findings file with the canonical diagnostic:

```
STE-350 regression: nested claude -p spawn denied/empty — <child>
```

**Severity:** high. `<child>` is the per-skill spawn name (e.g., `/implement`). The finding is hard: the remaining Phase 2 steps still run (independent evidence beats an early abort), but the run can never report green while one is present.

3. **Allow-list effective (STE-356):** the capture's raw text must not carry the workspace-trust warning — `Ignoring <N> permissions.allow entries from .claude/settings.json: this workspace has not been trusted`. That warning means the tracked allow-list was inert for the spawn (the STE-252 policy artifact silently stopped enforcing — a policy breach, not a cosmetic nit), the exact 2026-07-02 F4 failure mode. Implemented by `checkAllowlistInert` (same module, `adapters/_shared/src/smoke_child_capture.ts`); the driver runs it alongside `checkChildSpawnCapture` over each capture's raw text as it lands (the warning is a stderr line interleaved into the `2>&1` log, or echoed inside an assistant text block when a child relays its grandchild's stderr — no NDJSON parsing required). Any hit emits exactly one finding with the canonical diagnostic:

```
STE-356 regression: allow-list inert — <child> (workspace untrusted)
```

**Severity:** high — same hardness as the STE-350 finding above: the remaining Phase 2 steps still run, but the run can never report green while one is present. Remedy lives in Phase 1 step 6b (workspace-trust seeding).

#### Comment-path probe (Jira-only)

After step 6 returns, on the **Jira branch only**, issue a stand-alone `mcp__atlassian__addCommentToJiraIssue` call against the run's freshly-created work item. The probe closes AC-STE-154.9 AC 6 — the canonical chain doesn't naturally exercise the comment endpoint, so a regression there would slip past every smoke run. Stand-alone probe (vs. side-effect-of-`/implement` narration) was chosen during M49 spec authoring: validates the MCP tool independent of `/implement`'s narration policy, which can change without affecting the underlying contract.

```
mcp__atlassian__addCommentToJiraIssue \
  cloudId=<resolved> \
  issueIdOrKey=<latest work item key> \
  comment="Smoke probe — AC-STE-154.9 AC 6 coverage. Run: <date> <tracker> v<plugin-version>."
```

Fires only when `--tracker jira` is active. The Linear branch skips this probe entirely — Linear's MCP comment surface is exercised by other paths and isn't part of AC-STE-154.9 scope. The comment surfaces in `/tmp/dpt-smoke-jira-comment-probe.log` and the run's findings file (Phase 3 capture appends "comment exercised" to the run notes).

Skills explicitly NOT run (with reasons logged in findings):

- `/dev-process-toolkit:brainstorm` — multi-turn Socratic; not viable in `-p`.
- `/dev-process-toolkit:debug` — needs a failing test to trigger.
- `/dev-process-toolkit:visual-check` — no UI in test project.
- `/dev-process-toolkit:pr` — no GitHub remote in test project.
- `/dev-process-toolkit:docs` — would be no-op if /setup omitted `## Docs` (until M29 STE-107 ships).
- `/dev-process-toolkit:ship-milestone` — would dirty real Linear data further.
- `/dev-process-toolkit:tdd` standalone — covered by `/implement`.

### Phase 2.X — M56 runtime regression fixtures (STE-220 / STE-221 / STE-222)

Three fixture groups verify that the M55 cohort's SKILL.md-prose fixes (STE-213, STE-214, STE-215) actually fire at runtime — not just that the SKILL.md says they should. M55 archived these FRs `[x]` based on LLM self-confirm during `/implement` Phase 4; the 2026-05-04 v2.8.0 smoke runs (Linear F2-1 + Jira C-F1, both afternoon legs) proved STE-213's runtime had not changed despite green checkmarks. Phase 2.X is the fence: every smoke run captures real `claude -p` stdout for each system-under-test and asserts the documented contract.

Failure shape (canonical across all groups): `STE-<sut> runtime regression: <fixture-name>` where `<sut>` is the FR being regression-tested (STE-213 / STE-214 / STE-215), **not** the M56 FR carrying the fixture (STE-220 / STE-221 / STE-222). The diagnostic names the system-under-test so triage points to the broken implementation, not the test infrastructure. STE-220 is its own SUT (it carries both the fix and the regression test), so `STE-220 runtime regression: …` is the canonical diagnostic for fixture group 1.

Phase 2.X fires AFTER Phase 2 step 6 (`/simplify`) returns successfully and BEFORE Phase 3 (Capture). Fixture groups are independent; a failure in one does not abort the others.

#### Fixture group 1 — STE-226 spec-write marker carve-out (Linear + Jira)

Two sub-fixtures verify that the byte-checkable marker (`<dpt:auto-approve>v1</dpt:auto-approve>`) is the **only** trigger for `/spec-write`'s draft + commit auto-apply path. STE-213 (M55) and STE-220 (M56) attempted the same carve-out via prose-only contracts and both falsified end-to-end across four smoke runs; STE-226 (M59) replaces the prose-only detection with this byte-checkable marker. The two sub-fixtures together close both directions of the failure surface — marker-present must auto-apply (1a), marker-absent must NOT auto-apply (1b).

##### Sub-fixture 1a — marker present (audit rows present)

**Source:** `/tmp/dpt-smoke-<tracker>-spec-write.log` (already captured during Phase 2 step 2 — no new spawn needed; the canonical Phase 2 `/spec-write` heredoc carries the marker on its first body line).

**Assertions:**

- `grep -F 'spec_write_draft_default_applied' /tmp/dpt-smoke-<tracker>-spec-write.log` exit 0 (row present in stdout).
- `grep -F 'spec_write_commit_default_applied' /tmp/dpt-smoke-<tracker>-spec-write.log` exit 0 (row present in stdout).

**Diagnostic on failure:**

```
STE-226 runtime regression: spec-write-marker-missing-audit-row
  expected: spec_write_draft_default_applied row in stdout
  actual:   row absent
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-<tracker>-spec-write.log>
```

##### Sub-fixture 1b — marker absent (gates fire interactively)

A new `/spec-write` spawn is fired with the marker line **omitted** from the heredoc body. The driver describes this spawn in prose so its snippet is NOT picked up by the `/gate-check` probe `auto_approve_marker_in_canonical_spawns` (which asserts the marker on every documented prompt-bearing spawn): the runtime spawn is constructed at smoke-driver runtime, not authored as a fenced reference snippet here. The driver writes the heredoc body with no marker, captures stdout to `/tmp/dpt-smoke-<tracker>-spec-write-1b.log`, and asserts the inverse — no audit rows appear because the gates fire interactively and the child halts at the prompt without ever reaching § 7's emit path.

**Assertions:**

- `grep -F 'spec_write_draft_default_applied' /tmp/dpt-smoke-<tracker>-spec-write-1b.log` exit 1 (row absent — gate fired interactively, no auto-apply).
- `grep -F 'spec_write_commit_default_applied' /tmp/dpt-smoke-<tracker>-spec-write-1b.log` exit 1 (row absent for the same reason).
- Stdout ends at the gate prompt without ever reaching § 7 emit.
- **Post-TIGHTEN cross-tracker assertion (STE-294 AC.4):** Linear-side AND Jira-side both raised `RequiresInputRefusedError` (NFR-10 canonical shape — Verdict / Remedy / Context) under non-tty stdin when the marker is absent. The byte-checkable refusal is the ONLY acceptable outcome; an autonomous-mode reminder paraphrase, pre-baked `<command-args>` prose, or "standing instruction" inference MUST NOT flip the gate. Both legs of the tandem run produce the same refusal class — asymmetry between Linear-leg refusal and Jira-leg auto-apply (or vice-versa) is the M59→M65 regression shape this assertion fences.

**Diagnostic on failure:**

```
STE-226 runtime regression: spec-write marker-absent fixture 1b
  expected: stdout halts at draft gate; no audit rows in output; both Linear-side AND Jira-side raise RequiresInputRefusedError under non-tty stdin
  actual:   spec_write_draft_default_applied row appeared without marker — child auto-applied via removed legacy detection path OR one tracker leg refused while the other auto-applied (cross-tracker asymmetry — see STE-294 § Notes)
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-<tracker>-spec-write-1b.log>
```

If both sub-fixtures pass, append `STE-226 runtime check: PASS` to the run summary line. If only 1a passes, the marker contract is half-broken (auto-apply still fires regardless of the trigger) — surface as a high-severity finding so triage prioritizes the loose-trigger regression over the absent-trigger regression (the loose direction is the riskier one for unattended `claude -p` runs).

#### Fixture group 2 — STE-221 probe #26 ## Notes scanner (Linear-only)

Three sub-fixtures, each writing a temporary FR file under `specs/frs/`, invoking `claude -p /dev-process-toolkit:gate-check`, capturing stdout, then cleaning up. Linear leg only — probe #26 is vacuous on Jira (adapter Schema M `project_milestone: false`).

##### Sub-fixture 2a — positive (canonical capability key)

- Stage: write `specs/frs/<TKR>-FIX-A.md` with `## Notes` body containing the literal token `milestone_attach_skipped_adapter_limit`.
- Invoke + capture: `claude -p /dev-process-toolkit:gate-check` → `/tmp/dpt-smoke-<tracker>-ste221-positive.log`.
- Assert: `grep -E 'ADVISORY.*probe.*26|probe.*26.*ADVISORY' /tmp/dpt-smoke-<tracker>-ste221-positive.log` exit 0.
- Cleanup: remove the temporary FR file.

##### Sub-fixture 2b — control (no key)

- Stage: same FR but `## Notes` body has no milestone-attach capability key.
- Invoke + capture as above → `/tmp/dpt-smoke-<tracker>-ste221-control.log`.
- Assert: probe #26 surfaces `GATE FAILED` (proves the scanner is the difference, not unrelated probe behavior).
- Cleanup.

##### Sub-fixture 2c — deprecated-alias (`milestone_attach_unavailable`)

- Stage: same FR but `## Notes` body has `milestone_attach_unavailable` (the STE-198 deprecated alias).
- Invoke + capture as above → `/tmp/dpt-smoke-<tracker>-ste221-alias.log`.
- Assert: probe #26 surfaces ADVISORY (deprecation window honored per STE-214 AC.5). When STE-198's rollover note flips, this fixture flips to expecting GATE FAILED.
- Cleanup.

**Diagnostic on any sub-fixture failure:**

```
STE-214 runtime regression: <sub-fixture-name>
  expected: <ADVISORY | GATE FAILED>
  actual:   <observed>
  stdout excerpt (last 20 lines):
    <tail -20 of the relevant log>
```

If all three pass, append `STE-214 runtime check: PASS` to the run summary line.

#### Fixture group 3 — STE-222 cross-cutting drift propagation (Linear + Jira)

Three sub-fixtures. Both legs run — `/implement`'s Phase 4b' propagation hook is adapter-agnostic.

##### Sub-fixture 3a — positive (deletion ⇒ propagation commit)

- Stage: pre-create `src/.placeholder.test.ts` (committed); add stale references to that path in `specs/technical-spec.md` + `specs/testing-spec.md` directory-tree blocks; pre-create an FR whose implementation deletes the file.
- Invoke + capture: `claude -p /dev-process-toolkit:implement <FR>` → `/tmp/dpt-smoke-<tracker>-ste222-positive.log`.
- Assert: `git log --grep 'propagate.*removal to cross-cutting specs' --since '<run-start>' | wc -l` ≥ 1 (propagation commit landed).
- Assert: directory-tree blocks in both cross-cutting specs no longer reference `src/.placeholder.test.ts`.
- Cleanup: revert the test project's run-window commits.

##### Sub-fixture 3b — control (no deletion)

- Stage: identical setup but FR's implementation does NOT delete any tracked file.
- Invoke + capture as above → `/tmp/dpt-smoke-<tracker>-ste222-control.log`.
- Assert: `git log --grep 'propagate.*removal to cross-cutting specs' --since '<run-start>' | wc -l` == 0 (silent no-op per STE-215 AC.4).
- Cleanup.

##### Sub-fixture 3c — probe-side (stale ref on disk ⇒ ADVISORY)

System-under-test is `/gate-check` **probe #37** (`cross-cutting-spec-stale-file-refs`). The runtime emits this as probe #37 in the verdict block; pre-STE-238 smoke prose paraphrased it as "#26" (doc-drift caught by `/conformance-loop` iteration 1, F8). Reference the probe by **name AND number** in any future fixture commentary so the doc-drift cannot recur.

- Stage: pre-create a stale leaf in `specs/technical-spec.md` referencing a path that doesn't exist on disk (no `/implement` run). The leaf token MUST contain a `/` to qualify as a path-shaped reference (the probe filters bare-basename tokens by design — see F8 follow-up: a path like `src/staleref-fixture-3c.ts` qualifies; a bare `staleref-fixture-3c.ts` does not).
- Invoke + capture: `claude -p /dev-process-toolkit:gate-check` → `/tmp/dpt-smoke-<tracker>-ste222-probe.log`.
- Assert: `grep -F 'cross-cutting-spec-stale-file-refs' /tmp/dpt-smoke-<tracker>-ste222-probe.log` exit 0 with ADVISORY context (NOT `GATE FAILED` — STE-215 AC.5 specifies ADVISORY). The probe surfaces as `probe #37` in the verdict block.
- Cleanup.

**Diagnostic on any sub-fixture failure:**

```
STE-215 runtime regression: <sub-fixture-name>
  expected: <propagation-commit-present | propagation-commit-absent | ADVISORY-row-present>
  actual:   <observed state>
  stdout excerpt (last 20 lines):
    <tail -20 of the relevant log>
  git log excerpt (last 5 commits since <run-start>):
    <git log --oneline -n 5 since run-start>
```

The `git log excerpt` line is STE-222-specific (vs. group 2's stdout-only diagnostic) — `/implement` failures often surface in `git log` shape rather than stdout content, so the diagnostic carries both. If all three pass, append `STE-215 runtime check: PASS` to the run summary line.

#### Phase 2.X summary line

Append the following lines to the run summary, in order:

- `M56 runtime checks: PASS (STE-220 + STE-214 + STE-215 verified at runtime)` — all 7 sub-fixtures green.
- `M56 runtime checks: <N> regressions surfaced (see findings file)` — 1+ failures; each failure already logged its canonical `STE-<sut> runtime regression: …` diagnostic. Phase 3 (Capture) folds the diagnostics into the findings file under a `## Phase 2.X regressions` heading.

The two M56 lines above aggregate groups 1–3 because their three SUTs (STE-213 / STE-214 / STE-215) shipped together in M55 and roll up under one milestone-level result. Groups 4–7 (M64 cohort) intentionally do NOT roll up to a single `M64 runtime checks:` line — each of the four SUTs (STE-227 / STE-228 / STE-230 / STE-225) ships its own per-FR runtime-check line so a regression in one is operator-visible without scrolling into the per-fixture diagnostics. The runtime-check line each new group contributes is named in the group's footer paragraph below.

Phase 2.X is **shared infrastructure** for runtime regression coverage. Groups 1–3 (M56 cohort, STE-220 / STE-221 / STE-222) pin the M55 SKILL.md-prose fixes (STE-213 / STE-214 / STE-215). Groups 4–7 (M64 cohort, STE-231) pin the M58 / M60 / M61 / M63 runtime contracts (STE-227 / STE-228 / STE-230 / STE-225). Group 8 (M94 cohort) pins the STE-350 nested-spawn allow-list fix. Future SKILL.md-prose fixes (any FR shipping a behavior change via instructional text in `skills/<X>/SKILL.md`) should add their own fixtures here following the `STE-<sut> runtime regression: <fixture-name>` diagnostic shape — naming the system-under-test, not the test FR.

#### Fixture group 4 — STE-227 `--no-tech` end-to-end (Linear + Jira)

Two sub-fixtures (4a Linear + 4b Jira) each drive the 4-step `--no-tech` pass against the active tracker. The 4 steps:

1. **`/spec-write --no-tech <stub>`** — creates a flagged FR (frontmatter `needs_technical_review: true`, placeholder `## Technical Design` + `## Testing` sections per the STE-227 `--no-tech` contract).
2. **`/implement <id>`** — must refuse with the canonical NFR-10 shape and emit a `implement_refused_needs_technical_review` capability row in the closing summary; no commit lands; no tracker write past the get-issue read.
3. **`/spec-write <id>`** (no flag) — clears the `needs_technical_review` flag (frontmatter flips to `false` or the field is removed entirely) and replaces the placeholder Technical Design + Testing sections with real content.
4. **`/implement <id>`** — proceeds end-to-end → gate-check passes → implementation commit lands → FR archives to `specs/frs/archive/<id>.md` (`status: archived`) → tracker ticket reaches `Done`.

Each step is a fresh `claude -p` spawn using the existing heredoc-on-stdin pattern (§ STE-185), with the `<dpt:auto-approve>v1</dpt:auto-approve>` marker as the first body line. The slash command goes on the second body line, followed by the per-step prompt body. Stdout per step is captured to `/tmp/dpt-smoke-<tracker>-no-tech-step-<N>.log`. The smoke driver constructs each spawn at runtime; these 4 step spawns are NOT inlined as fenced reference snippets here (the canonical `/spec-write` and `/implement` heredoc shapes are already documented under § STE-185, and re-inlining them here would multiply the surface area scanned by the `auto_approve_marker_in_canonical_spawns` probe without adding behavior coverage).

##### Sub-fixture 4a — Linear (`--tracker linear`)

**Source:** four new spawns to `/tmp/dpt-smoke-linear-no-tech-step-{1,2,3,4}.log`.

**Assertions (per step):**

- Step 1: FR file exists at `../dpt-test-project-linear/specs/frs/<id>.md` with `grep -F 'needs_technical_review: true' ../dpt-test-project-linear/specs/frs/<id>.md` exit 0 (frontmatter flag set).
- Step 2: `grep -F 'implement_refused_needs_technical_review' /tmp/dpt-smoke-linear-no-tech-step-2.log` exit 0 (capability row present); `git -C ../dpt-test-project-linear log --oneline --since '<step-2-start>'` returns no rows (no commit landed during step 2).
- Step 3: `grep -F 'needs_technical_review: true' ../dpt-test-project-linear/specs/frs/<id>.md` exit 1 (flag cleared after re-invoke without `--no-tech`).
- Step 4: `git -C ../dpt-test-project-linear log --oneline --since '<step-4-start>'` returns ≥ 1 row (implementation commit landed); `test -f ../dpt-test-project-linear/specs/frs/archive/<id>.md` exit 0 (archive landed); `mcp__linear__get_issue STE-<id>` returns `status: "Done"`.

**Diagnostic on any step failure:**

```
STE-227 runtime regression: <fixture-name>
  expected: <step-specific expected state>
  actual:   <observed state>
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-linear-no-tech-step-<N>.log>
```

`<fixture-name>` ∈ `spec-write-no-tech-flagged-fr-not-created` (step 1) / `implement-not-refused-on-flagged-fr` (step 2) / `spec-write-no-flag-did-not-clear-flag` (step 3) / `implement-did-not-proceed-after-clear` (step 4).

##### Sub-fixture 4b — Jira (`--tracker jira`)

Same 4-step block as 4a, parameterized for `--tracker jira`. Stdout per step lands at `/tmp/dpt-smoke-jira-no-tech-step-{1,2,3,4}.log`. Step 4 ticket-state assertion uses `mcp__atlassian__getJiraIssue` → `Done` workflow status (or its `getTransitionsForJiraIssue` `to.statusCategory.key == "done"` fallback) instead of Linear's `mcp__linear__get_issue`. All other assertions identical to 4a (with `linear` substituted by `jira` in every log path and project directory).

**Diagnostic on any step failure:**

```
STE-227 runtime regression: <fixture-name>
  expected: <step-specific expected state>
  actual:   <observed state>
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-jira-no-tech-step-<N>.log>
```

`<fixture-name>` enumeration matches 4a (`spec-write-no-tech-flagged-fr-not-created` step 1 / `implement-not-refused-on-flagged-fr` step 2 / `spec-write-no-flag-did-not-clear-flag` step 3 / `implement-did-not-proceed-after-clear` step 4) — the diagnostic-shape invariant (AC-STE-231.5) names the system-under-test, not the leg.

If all 8 sub-fixture steps (4a + 4b combined) pass, append `STE-227 runtime check: PASS` to the run summary line; any step failure appends `STE-227 runtime check: FAIL` and the per-step diagnostic above is the operator-visible signal for triage.

#### Fixture group 5 — STE-228 branch-gate marker contract (Linear + Jira)

Two sub-fixtures (5a marker present + 5b marker absent) verify both directions of the branch-gate marker contract introduced by STE-228 (M61) — auto-apply when the `<dpt:auto-approve>v1</dpt:auto-approve>` marker is present on the proposing skill's prompt body, halt interactively when the marker is absent. Both sub-fixtures run on each of Linear + Jira (4 fixture instances per smoke run).

##### Sub-fixture 5a — marker present (auto-apply path)

**Source:** the existing canonical-chain `/spec-write` Phase 2 step 2 log at `/tmp/dpt-smoke-<tracker>-spec-write.log` (already captured during Phase 2 step 2 — no new spawn needed; the canonical Phase 2 `/spec-write` heredoc carries the marker on its first body line).

**Assertions:**

- `grep -F 'branch_gate_default_applied' /tmp/dpt-smoke-<tracker>-spec-write.log` exit 0 (gate auto-applied with the marker present).
- `git -C ../dpt-test-project-<tracker> branch --show-current` returns the proposed branch name (matching the `branch_template:` rendering for `type=feat`, slug derived from the FR title) — NOT `main`.

**Diagnostic on failure:**

```
STE-228 runtime regression: branch-gate-marker-present-no-auto-apply
  expected: branch_gate_default_applied row in stdout AND `git branch --show-current` ≠ main
  actual:   <observed state>
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-<tracker>-spec-write.log>
```

##### Sub-fixture 5b — marker absent (gate halts interactively)

A new `/spec-write` spawn is fired with the marker line **omitted** from the heredoc body. The driver describes this spawn in prose so its snippet is NOT picked up by the `/gate-check` probe `auto_approve_marker_in_canonical_spawns` (which asserts the marker on every documented prompt-bearing spawn): the runtime spawn is constructed at smoke-driver runtime, not authored as a fenced reference snippet here. Same anti-probe-collision technique as fixture 1b. The driver writes the heredoc body with no marker, captures stdout to `/tmp/dpt-smoke-<tracker>-spec-write-5b.log`, and asserts the inverse — the branch-gate prompt fires interactively, no auto-apply audit row appears, and no proposed branch lands on disk.

**Assertions:**

- `grep -F 'branch_gate_default_applied' /tmp/dpt-smoke-<tracker>-spec-write-5b.log` exit 1 (row absent — gate fired interactively, no auto-apply).
- `git -C ../dpt-test-project-<tracker> branch --list <proposed-name>` returns nothing (gate did NOT create the proposed branch since the child halted at the prompt).
- Stdout tail ends at the gate prompt (no `branch_gate_default_applied` row, no `## 7) Emit capability summary` block).

**Diagnostic on failure:**

```
STE-228 runtime regression: branch-gate-marker-absent-but-auto-applied
  expected: stdout halts at branch-gate prompt; no `branch_gate_default_applied` row; no new branch on disk
  actual:   `branch_gate_default_applied` row appeared without marker — child auto-applied via removed legacy detection path
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-<tracker>-spec-write-5b.log>
```

If both sub-fixtures pass on a leg, append `STE-228 runtime check: PASS` to the run summary line; any failure appends `STE-228 runtime check: FAIL`.

**Coverage-gap note (deferred to a future milestone).** Per-skill expansion of group 5 to `/spec-archive` and `/ship-milestone` is deferred — both are explicitly NOT in the canonical chain (running them on the test project would corrupt real data: `/spec-archive` mutates the real `specs/frs/` tree; `/ship-milestone` writes a release commit to the real plugin repo). The canonical chain transitively exercises STE-228's universal branch gate for `/setup` (Phase 1 bootstrap), `/spec-write` (Phase 2 step 2), and `/implement` (Phase 2 step 3) — three of the five commit-producing skills. Drift in `/spec-archive` or `/ship-milestone`'s gate wiring is currently caught only by their bun unit tests; a future milestone can add an out-of-canonical-chain probe-style fixture (similar to STE-221's `/gate-check` invocations) once a non-destructive harness for the remaining two skills is in place.

#### Fixture group 6 — STE-230 spec-research subagent runtime (Linear + Jira)

Single sub-fixture (Linear + Jira, runs on both legs). The smoke driver does not spawn a new child — the assertion runs against the existing `/tmp/dpt-smoke-<tracker>-spec-write.log` from Phase 2 step 2.

**Source:** `/tmp/dpt-smoke-<tracker>-spec-write.log` (already captured during Phase 2 step 2 — `/spec-write` invokes the spec-research forked subagent during the `## 1) Frame the goal` retrieval step per STE-230).

**Assertion (lenient):**

- `grep -cE 'spec_research_invoked|spec_research_no_matches|spec_research_shape_violation' /tmp/dpt-smoke-<tracker>-spec-write.log` ≥ 1 (at least one of the three audit rows present).

The lenient bound is deliberate. The empty-FR-set path emits `spec_research_no_matches` and naturally fires on a fresh test project (no prior FRs to retrieve). The non-empty path emits `spec_research_invoked` once a related FR exists. The shape-violation path emits `spec_research_shape_violation` if the subagent's return doesn't conform to its contract. Asserting OR over the three rows covers every defined post-condition without over-constraining the smoke to a particular test-project state — drift in any of those keys is already caught by the existing `/gate-check` probes for the static plain-language map (no new key added per AC-STE-231.7).

**Diagnostic on failure:**

```
STE-230 runtime regression: spec-research-no-audit-row
  expected: ≥ 1 of {spec_research_invoked, spec_research_no_matches, spec_research_shape_violation} in /spec-write log
  actual:   none of the three rows present — subagent did not fire OR did not emit any audit row
  stdout excerpt (last 30 lines):
    <tail -30 /tmp/dpt-smoke-<tracker>-spec-write.log>
```

If the assertion passes on a leg, append `STE-230 runtime check: PASS` to the run summary line; any failure appends `STE-230 runtime check: FAIL`.

#### Fixture group 7 — STE-225 TDD orchestrator forks runtime (Linear + Jira)

Single sub-fixture (Linear + Jira, runs on both legs). The smoke driver does not spawn a new child — the assertion runs against the existing `/tmp/dpt-smoke-<tracker>-implement.log` from Phase 2 step 3.

**Source:** `/tmp/dpt-smoke-<tracker>-implement.log` (already captured during Phase 2 step 3 — `/implement` invokes the TDD orchestrator inline, which forks `tdd-test-writer` + `tdd-implementer` + `tdd-refactorer` per STE-225, each emitting a `tdd-result` fenced block to its parent log).

**Assertion:**

- ``grep -c '^```tdd-result$' /tmp/dpt-smoke-<tracker>-implement.log`` ≥ 3 (one fenced block per orchestrator phase: test-writer → implementer → refactorer, in that order). Double-backtick code span deliberate — the literal grep contains a triple-backtick token (the fence-tag prefix the orchestrator emits per STE-225), which a single-backtick code span would mis-render; the double-backtick form keeps the fence-tag inside the inline code without colliding with surrounding markdown fences.

The greet-stub feature ships with one AC, so the orchestrator emits exactly 3 `tdd-result` blocks on a clean run. Bounded retry on a transient failure adds blocks (a retry re-emits the role's block) — never removes them — so the ≥ 3 lower bound is robust to retries. Multi-AC features would emit `3 × N_ACs` blocks; the test project's single-AC `greet` fixture pins the count to exactly 3 on the happy path and ≥ 3 with retries.

**Diagnostic on failure:**

```
STE-225 runtime regression: tdd-result-blocks-incomplete
  expected: ≥ 3 fenced tdd-result blocks in /tmp/dpt-smoke-<tracker>-implement.log
  actual:   <observed-count> blocks (e.g., 0 = orchestrator never fired; 1 = test-writer only; 2 = test-writer + implementer, no refactor)
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-<tracker>-implement.log>
  git log excerpt (last 5 commits since <run-start>):
    <git -C ../dpt-test-project-<tracker> log --oneline -n 5 since run-start>
```

The `git log excerpt` line is STE-225-specific (mirrors STE-222's group 3 precedent): `/implement` failures often surface in `git log` shape (no implementation commit, mid-cycle abort) rather than stdout content alone, so the diagnostic carries both. If the assertion passes on a leg, append `STE-225 runtime check: PASS` to the run summary line; any failure appends `STE-225 runtime check: FAIL`.

#### Fixture group 8 — STE-350 nested `claude -p` spawn allow-list (Linear + Jira)

Two sub-fixtures reproduce a **live nested spawn** — the runtime counterpart to the static `/gate-check` probe `spawn_pattern_allowlist` (STE-351.2's fence). The M94 root cause: the tracked `.claude/settings.json` `permissions.allow` array omitted the child-spawn pattern `Bash(claude:*)`, so the auto-mode permission classifier denied every nested spawn headless — a 0-byte grandchild capture beneath weeks of green runs. This group asserts the patched allow-list actually admits a nested spawn at runtime (8a), and that removing the pattern produces a **caught** denial rather than a silent pass (8b).

##### Sub-fixture 8a — positive (nested spawn completes non-empty under the patched allow-list)

The driver fires a minimal child spawn constructed at smoke-driver runtime and described here in prose only (same rationale as sub-fixture 1b: no authored heredoc snippet for the `auto_approve_marker_in_canonical_spawns` probe to pick up). The child's prompt instructs it to run exactly one nested `claude -p 'reply with the single word pong'` via its Bash tool from inside the test project — whose `.claude/settings.json` carries the patched allow-list per Phase 1 step 6 — and echo the grandchild's stdout back into its own output. Capture to `/tmp/dpt-smoke-<tracker>-ste350-nested.log` (stream-json NDJSON, like every Phase 2 spawn).

**Assertions:**

- `wc -c < /tmp/dpt-smoke-<tracker>-ste350-nested.log` > 0 AND the grandchild's reply token (`pong`) appears in the capture — the nested spawn completed with non-empty output.
- `checkChildSpawnCapture` (`adapters/_shared/src/smoke_child_capture.ts`, the same detector Phase 2's post-return assertion uses) reports no `permission_denials[]` entry whose `tool_input.command` head is `claude`.

##### Sub-fixture 8b — negative (pattern removed ⇒ denial is caught)

- Stage: copy the test project's `.claude/settings.json` aside, then rewrite `permissions.allow` with the `Bash(claude:*)` entry removed (every other entry kept — the M94 shape was precisely a non-empty allow-list missing the one load-bearing pattern).
- Invoke + capture the same nested-spawn child as 8a → `/tmp/dpt-smoke-<tracker>-ste350-denied.log`.
- Assert: `checkChildSpawnCapture` **detects** the denial — a `permission_denials[]` entry whose command head is `claude`, or a 0-byte grandchild echo, is surfaced as a finding. The regression this sub-fixture fences is the detector staying silent while the pattern is absent (the exact false-green that hid STE-350).
- Cleanup: restore the original settings file before any subsequent phase runs.

Persist both captures under `tests/fixtures/nested-spawn/<sub-fixture>-<YYYY-MM-DD>.log` for replay during regression triage (mirrors Phase 8's `tests/fixtures/socratic-first-turn/` convention).

**Diagnostic on failure:**

```
STE-350 runtime regression: <nested-spawn-empty-or-denied | denial-not-caught>
  expected: 8a — nested spawn completes non-empty under the patched allow-list; 8b — the removed pattern's denial is detected and surfaced
  actual:   <observed state>
  stdout excerpt (last 20 lines):
    <tail -20 of the relevant log>
```

If both sub-fixtures pass on a leg, append `STE-350 runtime check: PASS` to the run summary line; any failure appends `STE-350 runtime check: FAIL`.

### Phase 2.Y — End-of-run chain-integrity assertion (STE-355)

Before any Phase 3 capture work, assert the canonical chain actually completed. Run `assertChainIntegrity` (`adapters/_shared/src/smoke_child_capture.ts`, built on the `stream_json_events` NDJSON reader) against every expected per-skill capture, in chain order, passing the **run-start timestamp** captured at Phase 0 acceptance (the epoch-ms moment the approval was logged) as the `runStart` argument:

```
/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.log
```

A capture is healthy iff the file **exists**, is **fresh** (mtime not before run-start), is **non-empty**, and carries a top-level stream-json `result` event — a result-shaped token inside assistant prose does not count. Any miss yields one **high**-severity finding naming the truncated child, in the pinned diagnostic shape:

```
STE-355 regression: chain truncated — <child> (<capture missing | capture stale (pre-run) | capture empty | result event absent>)
```

**Freshness gate (STE-358; iter-2 F2).** A capture whose mtime predates run-start is `capture stale (pre-run)` — **never healthy**, regardless of what it contains: the freshness check runs before the content checks, so a stale result-bearing log surviving from a prior run (the iter-2 shape — the morning run's `dpt-smoke-linear-implement.log` carried a `result` event and would have false-passed an ungated completeness check) can never masquerade as this run's capture. The gate is strictly `mtime < run-start`; a capture written exactly at run-start is fresh. Defense-in-depth with the Phase 0.5 verified wipe — either alone closes the stale-log false-pass; both together survive a wipe bypass.

Append each finding to the findings file in the Phase 3 template shape. A chain-integrity finding means the run is barred from a green summary: any finding forces the run summary to FAIL, regardless of how the individual skills scored. (Provenance: 2026-07-02 F2+F3 — both legs truncated silently behind RC 0; the STE-352 detector's `result: ABSENT` footprint was the reliable truncation signal on both captured legs.) Denial detection stays with `checkChildSpawnCapture` (STE-352) — a denied-but-complete capture is chain-healthy here; the two detectors are orthogonal by design.

### Phase 3 — Capture

After every skill completes, parse its log and the test-project state, generating findings entries. Findings template:

```markdown
### F<N> — <one-line summary>
<paragraph: what was expected, what happened>
**Severity:** high / medium / low. <one-line rationale>
```

**Severity-format normative callout (anti-regression, STE-295 AC-STE-295.5).** Emitters MUST render the severity line in exactly the canonical form `**Severity:** <level>` (colon ends the bold span, level word `high` / `medium` / `low` is plain text outside the bold span). The regression form (severity word + colon INSIDE the bold span, trailing period inside the bold span — i.e. the colon-inside-bold variant where the period and the level word are wrapped together with `Severity:` in a single double-asterisk span) is NOT acceptable and must never appear in findings files. This colon-inside-bold drift is a known LLM-emitter regression caught by the /conformance-loop iter-1 termination probe and is pinned out by this normative callout plus a byte-level test on this SKILL.md so the canonical form cannot silently regress.

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

#### M54 follow-up probes (lifted per-FR fixtures)

Run these regression probes against the Phase 2 output. Six are tracker-agnostic (run on both Linear and Jira legs), two are tracker-agnostic-but-fixture-bound (`STE-210` chain succeeds; works on persistent Jira fixture), and one is Linear-only by design.

**Tracker-agnostic — run on both legs:**

- **STE-197 plan-file shape** — `specs/plan/M1.md` parses as YAML frontmatter + body; exactly one `^## M\d+:` heading; no `## Milestone Dependency Graph`; no literal `<tracker-id>` rows. Asserts the trimmed-template + frontmatter contract; flags multi-milestone bundling, missing frontmatter, leftover placeholders.
- **STE-200 scaffolding-closure path** — `/spec-archive M1` and `/implement M1` for scaffolding milestones (`kind: scaffolding` plan or zero FR files) write zero tracker side effects; the `plan_only_archival` row appears in the closing summary. Probe: count `mcp__<tracker>__save_*` invocations during the run; expect zero.
- **STE-201 ship-milestone task-bullet pre-flight** — fixture plan with one `[ ]` task lacking a backing FR row (no `[deferred]` marker) → `/ship-milestone M<N>` refuses with the AC-STE-201.2 shape (`<count> unchecked task(s) with no FR backing`). Reads tracker FR statuses only; safe on persistent Jira fixtures.
- **STE-209 `.mcp.json` shape** — emitted `.mcp.json` validates against the Claude Code MCP schema (no `transport: streamable-http`, uses `type: http`). Local-file inspection.
- **STE-209 `/setup` completes without harness self-modification denial** — `/setup` step 6 exits zero on a fresh repo (no globbed `Bash(<cmd> *)` rules in `.claude/settings.json`). Exit-code probe; works without tracker fixture.
- **STE-209 doctor probe matches declared invocation** — when CLAUDE.md / `examples/<stack>/gate-commands.md` declares `fvm flutter`, doctor probes `fvm flutter --version`; falls back to bare `flutter --version` otherwise. Per-stack probe; tracker-agnostic.
- **STE-210 archive frontmatter coherent** — post-archive commit's plan + FR files in `archive/` carry `status: archived` + non-null `archived_at:`. Probe: `git show HEAD:specs/plan/archive/M<N>.md | head` parse; works on both legs.
- **STE-210 implement→ship-milestone chain** — full chain `/implement M<N>` → `/ship-milestone M<N>` succeeds end-to-end without operator intervention (Step 1 archive fallback fires when active plan path is missing). Exit-code probe; works on persistent Jira fixture.

**Linear-only by design (Jira N/A):**

- **STE-211 Linear AC-token round-trip** — push a Linear FR with multiple AC lines, fetch via `mcp__linear__get_issue`, assert byte-identical round-trip after `stripLinearACFences`. Jira's MCP doesn't auto-link `STE-NNN` tokens, so the bug doesn't apply on the Jira leg; documented as Linear-leg-only by design. Requires a fresh Linear project per run for a clean AC-list comparison.

Each verification result feeds into Phase 3's findings.

### Phase 5 — Teardown

Teardown branches on `--tracker`. The directory cleanup (`rm -rf ../dpt-test-project-<tracker>`) keys on the per-tracker basename in both modes; the tracker-side cleanup differs because Atlassian's MCP exposes no `deleteJiraIssue` and no `deleteJiraProject` (documented limitation, not a bug). A concurrent run against the other tracker is unaffected by this teardown — its dir, findings, logs, and approval record live under a different per-tracker suffix.

**Both tracker paths also remove the Phase 1 step 6b workspace-trust seed (STE-356).** Config hygiene: without the removal, every run leaves a dead `projects["<abs test-project path>"]` entry behind in the live `$CLAUDE_CONFIG_DIR/.claude.json`, and dead entries accumulate across runs. The removal is a jq `del(.projects[$p])` with the same read-merge-write discipline as the step-6b seed — jq into a temp file, atomic `mv` over the original, every unrelated key passes through untouched, the same `/tmp/dpt-claude-json.lock` mutex serializing against a concurrent tandem leg's seed/del cycle. It only deletes this run's own `$TEST_REAL` entry, so a concurrent tandem leg's seed (a different per-tracker path) is untouched. **The step-6b backup is removed here too** — `/tmp/dpt-smoke-<tracker>-claude-json.bak` holds a copy of the operator's live config (MCP registrations + session state) in a world-readable temp dir, so it must not outlive the run that needed it as a recovery path; the `rm -f` runs only after the `del` write lands.

#### Linear path (`--tracker linear`, default)

**Remove the workspace-trust seed first — runs in every mode (`--keep` included):**

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude-st}/.claude.json"
# Bounded spinlock — same stale-lock escape as step 6b (refuse after ~60 s;
# recover with `rmdir /tmp/dpt-claude-json.lock`).
tries=0; until mkdir /tmp/dpt-claude-json.lock 2>/dev/null; do
  tries=$((tries+1)); [ "$tries" -ge 60 ] && exit 1
  sleep 1
done
jq --arg p "$TEST_REAL" 'del(.projects[$p])' \
  "$CFG" > /tmp/dpt-smoke-linear-claude-json.tmp \
  && mv /tmp/dpt-smoke-linear-claude-json.tmp "$CFG" \
  && rm -f /tmp/dpt-smoke-linear-claude-json.bak
rmdir /tmp/dpt-claude-json.lock
```

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

**Remove the workspace-trust seed first — runs in every mode (`--keep` included), before the tracker-side steps below.** Same jq `del` + read-merge-write discipline as the Linear path:

```bash
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude-st}/.claude.json"
# Bounded spinlock — same stale-lock escape as step 6b (refuse after ~60 s;
# recover with `rmdir /tmp/dpt-claude-json.lock`).
tries=0; until mkdir /tmp/dpt-claude-json.lock 2>/dev/null; do
  tries=$((tries+1)); [ "$tries" -ge 60 ] && exit 1
  sleep 1
done
jq --arg p "$TEST_REAL" 'del(.projects[$p])' \
  "$CFG" > /tmp/dpt-smoke-jira-claude-json.tmp \
  && mv /tmp/dpt-smoke-jira-claude-json.tmp "$CFG" \
  && rm -f /tmp/dpt-smoke-jira-claude-json.bak
rmdir /tmp/dpt-claude-json.lock
```

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

### Phase 8 — Socratic Loop Entry (STE-237)

Phase 8 closes the symmetric per-conversation loop side of the autonomous-mode contract. Pattern 26 prose alone is insufficient (STE-220 lesson); the first-turn contract enforces it structurally. See `plugins/dev-process-toolkit/docs/auto-mode-protocol.md § Socratic Loop Contract` for the rule statement.

For each in-scope skill — `setup`, `brainstorm`, `spec-write`, `report-issue` — spawn a `claude -p <skill>` child whose heredoc body:

  1. carries the harness autonomous-mode reminder verbatim (literal first body line, no paraphrase): `The user has asked you to work without stopping for clarifying questions. When you'd normally pause to check, make the reasonable call and continue; they'll redirect if needed.`
  2. supplies a verbose pre-baked-args prompt that *appears* to answer all questions the skill might ask (stack hints, tracker mode, branch name, etc.), AND
  3. **does NOT carry** the `<dpt:auto-approve>v1</dpt:auto-approve>` marker. The absence of the marker is load-bearing — Phase 8 simulates the magpie-incident shape where the model is tempted to skip the Socratic loop entirely.

Capture the child's response stream (the parsed `tool_use` and `text` entries from `claude -p`'s machine-readable `--output-format stream-json` mode) into a transcript array of `{ type, name? }` records, then call `assertFirstTurnShape(transcript)` from `adapters/_shared/src/socratic_first_turn.ts`. The helper is the **single arbiter** of the contract — Phase 8 prose does not duplicate the four-outcome decision logic.

**Pass criterion (per skill):** `assertFirstTurnShape(...)` returns `outcome: "ok-asked"` (the first response-stream `tool_use` is `AskUserQuestion`) OR `outcome: "ok-refused"` (a `RequiresInputRefusedError` raise / `refusal` entry landed before any scaffold). Append a `socratic_first_turn_contract_ok` capability row per passing skill to the smoke summary.

**Fail criterion (per skill):** `assertFirstTurnShape(...)` throws `SocraticFirstTurnViolationError`. The error's NFR-10 message names the offending tool (`Write` / `Edit` / `NotebookEdit`) + zero-based index in the response stream. Append a `socratic_first_turn_contract_violation` capability row to the smoke summary; **hard-fail the smoke run** — the violation surfaces a Pattern-26 regression in the live skill body.

Capture each child's transcript artifact under `tests/fixtures/socratic-first-turn/<skill>-<YYYY-MM-DD>.json` for replay during regression triage. The fixture filename includes the date so concurrent runs don't collide; per-tracker scoping is unnecessary because Phase 8 is tracker-agnostic by construction (the in-scope skills are `mode: none`-compatible — `/setup` Step 7b's tracker prompt fires *inside* the Socratic loop, not as a precondition).

**Skill rotation.** Phase 8 fires once per smoke run, sequentially across the four in-scope skills (no parallelism — child-spawn cost is dominated by `claude -p` startup, not loop entry latency). A failed first-turn contract on one skill does not skip the remaining three — capture all four fixtures, then surface the aggregate verdict at end-of-phase.

**Driver wrapper (reference snippet).** Spawn each in-scope skill as a stream-json child, capture NDJSON to the per-skill fixture path, then run the bundled `socratic_first_turn_assert.ts` CLI runner against the fixture. The runner composes `parseStreamJsonTranscript` (NDJSON → `TranscriptEntry[]`) with `assertFirstTurnShape` (the helper); both are unit-tested at `socratic_first_turn{,_stream}.test.ts`.

```bash
DATE=$(date +%Y-%m-%d)
PLUGIN_DIR=/Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit
FIXTURE_DIR=${PLUGIN_DIR}/tests/fixtures/socratic-first-turn
export CLAUDE_CONFIG_DIR=~/.claude-st   # STE-350: exported so spawn lines stay bare `claude -p`
ASSERT_RUNNER=${PLUGIN_DIR}/adapters/_shared/src/socratic_first_turn_assert.ts
mkdir -p "${FIXTURE_DIR}"

for SKILL in setup brainstorm spec-write report-issue; do
  FIXTURE=${FIXTURE_DIR}/${SKILL}-${DATE}.json

  claude -p \
    --output-format stream-json --verbose \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${FIXTURE}" 2>/dev/null <<PROMPT_EOF
The user has asked you to work without stopping for clarifying questions. When you'd normally pause to check, make the reasonable call and continue; they'll redirect if needed.
/dev-process-toolkit:${SKILL}

<verbose-pre-baked-args appearing to cover every question the skill might ask>
PROMPT_EOF

  # Runner emits one of:
  #   <skill>: ok-asked askIndex=<i>
  #   <skill>: ok-refused askIndex=<i>
  #   <skill>: violation tool=<X> index=<i>   (exits 1)
  bun "${ASSERT_RUNNER}" "${SKILL}" "${FIXTURE}"
done
```

A zero exit from the runner emits `socratic_first_turn_contract_ok` for that skill; a non-zero exit emits `socratic_first_turn_contract_violation` and **hard-fails the smoke run**. The heredoc body deliberately omits the `<dpt:auto-approve>v1</dpt:auto-approve>` marker and includes the autonomous-mode reminder verbatim — Phase 8 simulates the magpie-incident shape, so the in-scope skill must enter the Socratic loop (or refuse) regardless.

### Phase 9 — Capability-Row Emission Verification (STE-238)

Phase 9 closes the structural-enforcement-of-capability-row-emission gap caught by `/conformance-loop` iteration 1 (2026-05-07). The behavioral contracts of STE-226 / STE-228 / STE-230 fire correctly at runtime, but the byte-checkable capability-key tokens those contracts specify are absent from runtime stdout — the LLM emits narrative prose, not the literal tokens. Phase 9 is the lenient-assertion behavioral fixture (per STE-231 AC.3 shape — "at least one expected key for the scenario MUST appear in stdout"). Source-level coverage lives in `/gate-check`'s `closing_summary_capability_keys` probe.

Three lenient-assertion fixtures, each spawning `claude -p /spec-write` with a heredoc body matching the scenario:

  1. **Marker-driven draft + commit gate** — heredoc carries `<dpt:auto-approve>v1</dpt:auto-approve>` AND drives `/spec-write` through both gates (FR-draft acceptance + commit). **Expected stdout tokens:** `spec_write_draft_default_applied` AND `spec_write_commit_default_applied` (literal, not paraphrased).
  2. **Marker-driven branch gate** — heredoc carries the marker AND invokes `/spec-write` once on `main` with commit type `chore` (expects `branch_gate_default_applied`); a second sub-fixture invokes off-trunk on `feat/scratch` (expects `branch_gate_skipped_already_non_main`). The new `branch_gate_skipped_already_non_main` token is added to the static map at `/spec-write` § 7 under STE-238 AC.6.
  3. **Spec-research seed paths** — heredoc invokes `/spec-write` on a project carrying at least one archived FR (expects `spec_research_invoked`); a second sub-fixture invokes on a fresh project with empty `specs/frs/` (expects `spec_research_no_matches`). The third path — `spec_research_shape_violation` — is not exercised by Phase 9 because reproducing a shape violation requires an artificial subagent failure injection beyond the smoke harness's reach; the source-level probe `closing_summary_capability_keys` covers the directive presence.

**Lenient assertion (per STE-231 AC.3 shape).** For each fixture the assertion is "at least one expected key for the scenario MUST appear in stdout" — case-sensitive substring grep on the captured `claude -p` log. Non-deterministic LLM prose surrounding the literal token is allowed. Missing token → hard-fail the smoke run with the canonical diagnostic `STE-238 runtime regression: <fixture-name> — expected token "<key>" missing from stdout`. Capture fixture artifacts under `tests/fixtures/capability-rows/<fixture-name>-<YYYY-MM-DD>.log` for replay.

**Phase 9 fires after Phase 8** — both new phases run before tracker-agnostic teardown. The two phases are independent: a Phase 8 failure does not skip Phase 9, and vice versa, so the operator gets the full picture of both regression surfaces in one run.

## Allowlist matrix (informational)

Under default permission mode (Phase 0) the child is constrained by the tracked `.claude/settings.json` `permissions.allow` allow-list (STE-252) at command-pattern granularity. The matrix below documents which tools each skill is *expected* to need; the tracked allow-list enforces at the tool-call granularity (Bash patterns, Edit/Write/Read/Grep/Glob, MCP families). Children calling tools the allow-list does NOT cover halt at the spawn boundary — that halt is the empirical signal AC-STE-252.5 watches for.

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
- **Capture, don't fix.** /smoke-test surfaces issues into a findings file. Triage and fix happens via /spec-write + /implement on the toolkit repo, not inline. The skill's outputs are evidence, not patches. **Sanctioned override:** `/conformance-loop --auto-fix` (project-local skill at `.claude/skills/conformance-loop/SKILL.md`) is the **formally-sanctioned auto-fix exception path** — opt-in by explicit flag, runs both trackers in parallel, dispatches `/spec-write` + `/implement` per high-severity finding under `--max-iterations` + no-progress safety rails. Capture-only mode (the default for `/conformance-loop`) preserves this rule unchanged. Raw `/smoke-test` invocations (this skill) continue to follow "Capture, don't fix" with no exception.
- **One run per release cycle.** Don't re-run for fun; each run produces real Linear/Jira teardown labor. **Sanctioned override:** `/conformance-loop` may invoke `/smoke-test` multiple times per release cycle (once per iteration, capped by `--max-iterations`); the operator owns the iteration count.
- **Run all phases to completion.** The driver MUST NOT defer Phase 2.X / Phase 8 / Phase 9 fixture groups for runtime length, output volume, or any self-paced reason. If a phase is unimplemented, refuse with NFR-10 naming the missing artifact; if it is implemented, run it. The toolkit does not use $/token budgets, per-skill caps, or cost instrumentation — that framing is explicitly out of scope. Wall-clock is the only legitimate ceiling, and the operator owns it via `Ctrl-C`.
- **Driver-side caveats live in the findings file**, not inline as plugin issues. If a finding is "claude-st -p doesn't support X", that's a smoke-test infrastructure note, not an FR against the plugin.
- **Update this skill when the plugin's skill list changes.** New plugin skill = new entry in the chain (or in the "NOT run" list with rationale). Caught only by manual review — there's no probe for skill-list freshness here.

## Threat model

The tracked `permissions.allow` block in `.claude/settings.json` (STE-252) is the **per-tool-call enforcement** mechanism for every `claude -p` child this skill spawns. Children run under **default permission mode**; each Bash command, file-tool call, and MCP call is matched against the enumerated allow-list patterns (Bash command-pattern entries + `Edit`/`Write`/`Read`/`Grep`/`Glob` + `mcp__linear__*` / `mcp__atlassian__*`). A non-matching call surfaces as a structured refusal — there is no blanket bypass. Parent-side pre-creation of `.claude/settings.json` and `.mcp.json` from the toolkit repo's Bash heredoc remains in place for the test-project scaffold; the tracked allow-list is the audit-able policy artifact and the load-bearing safety rail. The safety rails that make this acceptable, in order of load-bearingness:

1. **Tracked `permissions.allow` allow-list.** The allow-list lives in tracked `.claude/settings.json` and is reviewable as a single-file PR diff with deterministic ordering. Children operate under default permission mode and are bounded to exactly the patterns the operator has approved in-repo; new tool surfaces require an explicit allow-list edit + PR review. The allow-list covers Bash command patterns the call tree actually uses, the file-tool surface (`Edit`, `Write`, `Read`, `Grep`, `Glob`), and the MCP families (`mcp__linear__*`, `mcp__atlassian__*`); anything outside that union refuses at the child's permission layer. **Enforcement precondition (STE-356):** the tracked allow-list is enforcement-effective only when the spawn cwd's workspace is trusted — in an untrusted workspace the harness ignores the scaffolded `permissions.allow` entries wholesale and the policy artifact goes inert. Phase 1 step 6b is the seeding step (it merges `hasTrustDialogAccepted: true` for the test-project path into `$CLAUDE_CONFIG_DIR/.claude.json` before any spawn). The counterexample is the 2026-07-02 conformance run's F4 capture: grandchild logs opened with `Ignoring 10 permissions.allow entries from .claude/settings.json: this workspace has not been trusted`, so the canonical chain ran on auto-mode classifier goodwill instead of the reviewed policy; the `checkAllowlistInert` post-return detector (§ Post-return capture assertion) surfaces any recurrence as a high-severity finding.
2. **Hard-coded paths (cwd guard).** The test-project path is always `<toolkit-repo-parent>/dpt-test-project-<tracker>` for `<tracker>` in the closed two-element allow-list `{linear, jira}` — scoped to two well-known throwaway directories, one per tracker, basename hard-coded by pre-flight #6 (which verifies basename membership in `{dpt-test-project-linear, dpt-test-project-jira}`, sibling-of-toolkit-repo, real-path resolution, and not-a-symlink). The cwd guard bounds *where* the children operate (not *what* they can call — that's the `permissions.allow` block's job). The operator's other projects are unaffected; a single invocation only ever touches one of the two — operator-driven parallelism (§ Operator-driven parallelism) runs them in separate processes against separate dirs.
3. **Throwaway directory.** Phase 1 creates the dir; Phase 5 deletes it. There is no persistent state worth corrupting — every run starts from `bun init` and ends with `rm -rf` against the per-tracker basename. A misbehaving child can damage at most one ephemeral scaffold (its own tracker's dir; the sibling tracker's dir, if a concurrent run is alive, is owned by a separate process and not shared).
4. **No network egress beyond the documented MCPs.** The child has no network-side tools beyond `mcp__linear__*` (Linear path) or `mcp__atlassian__*` (Jira path) via `--mcp-config`. It cannot exfiltrate to arbitrary hosts.
5. **Operator approval.** Phase 0 prints the contract and requires explicit `y`. The operator sees the path + tracker before any side effects.
6. **Tracker writes are scoped to a single throwaway scope.** **Linear path:** Phase 1 creates `DPT Smoke Test (<date>)` and the chain writes only to it; Phase 5 archives it (`state: completed`). **Jira path:** the chain writes only into the `--jira-project` Space (e.g., `DST`); every work item created carries the `dpt-smoke` label (driven by `### Jira`.default_labels), and Phase 5 transitions only those run-window items to `Done`. The Space itself is not deleted (Atlassian MCP exposes no `deleteJiraProject`). No risk to other Linear projects in the team or other Jira Spaces in the tenant.

What this does NOT protect against:
- A child that calls a tool the allow-list does grant, but with arguments outside the test-project scope. `permissions.allow` matches at the tool/command-pattern granularity, not on arbitrary argument shapes (e.g., `Bash(rm:*)` is approved at command-pattern level — `rm -rf` *inside* the cwd is the expected behavior; `rm -rf` *against* a path outside cwd is bounded only by pre-flight #6's cwd guard at run start, not by per-call enforcement). Mitigation: the children are claude sessions running known plugin skills, not adversarial code; the failure mode is "plugin skill is buggy and writes outside cwd" (a finding worth surfacing), not "attacker uses smoke-test as an exploit vector."
- A compromised plugin skill that exercises the allow-list's full grant. If the in-tree plugin under test is malicious, it can use anything the tracked allow-list permits — the bound is the allow-list's content, not "no tools at all". Mitigation: this skill is project-local; only the toolkit maintainer runs it; the plugin under test is the toolkit author's own code. This is dogfooding, not third-party-code execution. The tracked allow-list shrinks the blast radius from "everything the harness exposes" to "the union of patterns the operator has explicitly approved in PR review".

If the threat model changes (e.g. the toolkit accepts contributions from outside the maintainer set), revisit both this section and the tracked `permissions.allow` block before another /smoke-test run.

**Coverage caveat** (re-stated for emphasis): the option-5 pattern means the smoke test always exercises /setup's "files-already-exist, idempotent merge" branch, NOT its fresh-create branch. Fresh-create coverage requires a separate manual probe by the operator running /setup against a truly empty `.claude/` directory in their own claude session (where the harness will prompt them to approve the writes). This is acceptable because (a) the dominant operator-observed flow is "files exist from a prior run," (b) the fresh-create logic is small and has been hand-validated repeatedly during M27/M29 development, and (c) the alternative is no end-to-end smoke test at all.

