---
name: conformance-loop
description: Drive `/smoke-test` against both trackers in parallel and aggregate the per-tracker findings files into one deduplicated report. Default `capture-only` mode honors `/smoke-test`'s "Capture, don't fix" rule unchanged. Opt-in `--auto-fix` mode walks the deduplicated high-severity findings list and dispatches `/dev-process-toolkit:spec-write` + `/dev-process-toolkit:implement` per finding, then re-iterates until termination. Project-local skill, not plugin.
argument-hint: '[--auto-fix] [--max-iterations N] [--linear-team STE] [--jira-project KEY] [--dry-run]'
disable-model-invocation: true
---

# /conformance-loop

Automate the manual two-terminal `/smoke-test` workflow with cross-tracker dedup, capture-only-by-default, and an opt-in `--auto-fix` mode that dispatches `/dev-process-toolkit:spec-write` + `/dev-process-toolkit:implement` per finding under explicit safety rails. **Project-local skill** — lives in `.claude/skills/conformance-loop/SKILL.md` of the dev-process-toolkit repo, not in the plugin itself. Downstream users never see it.

This skill is the formally-sanctioned exception to `/smoke-test`'s "Capture, don't fix" + "One run per release cycle" rules. Capture-only mode preserves those rules unchanged for raw `/smoke-test` invocations; `--auto-fix` mode is the operator's explicit opt-in to the automated loop with `--max-iterations` + no-progress safety rails (no budget cap — operator controls cost via iteration count).

## When to use

- Pre-release sanity check before `/ship-milestone M<N>` runs, when both Linear and Jira surfaces need to be exercised in one shot.
- After landing any FR that touches `skills/setup/SKILL.md`, `skills/spec-write/SKILL.md`, `skills/implement/SKILL.md`, `skills/gate-check/SKILL.md`, `skills/spec-archive/SKILL.md`, or any of the `templates/` files.
- **Not** for every commit, not in CI — this is expensive (real LLM tokens, real Linear + Jira writes) and slow (`max-iterations × ~10 min × 2`-tracker wall-clock per run).

## Argument parsing

Parse `$ARGUMENTS` once, before any pre-flight runs:

- `--auto-fix` — boolean, **default OFF**. When OFF (capture-only mode, the default), the loop exits after Phase A of iteration 1 with the aggregated findings report and dispatches no fixers — this honors `/smoke-test`'s "Capture, don't fix" rule unchanged. When ON, Phase B fires per high-severity finding (sequential `/dev-process-toolkit:spec-write` → `/dev-process-toolkit:implement` per finding), and the loop re-iterates until one of the three termination conditions trips.
- `--max-iterations N` — integer, **default 3**. Hard cap on iteration count (counts both capture-only and auto-fix iterations). The loop exits with `status: max-iterations` once the counter reaches `N`. Operator owns this number — there is no budget cap; cost is controlled by iteration count.
- `--linear-team STE` — pass-through to the Linear `/smoke-test` child via `--linear-team`. Default `STE` (matches `/smoke-test`'s default).
- `--jira-project KEY` — **required** when the Jira child fires. Pass-through to the Jira `/smoke-test` child via `--jira-project`. The Jira child's pre-flight #8 enforces visibility of the Space; `/conformance-loop`'s pre-flight (d) verifies presence of the flag before any side effects.
- `--dry-run` — boolean, default OFF. Mocks the subprocess spawn and returns canned per-tracker findings files (used by `conformance-loop-dry-run.test.ts` to cover parallelism mechanics + aggregation + termination without invoking real `claude -p` children). Wires the same Phase A → termination path as a real run; only the subprocess call is replaced by reading from a fixture directory.

Unknown flags refuse with NFR-10 canonical refusal naming the unknown flag and the supported set:

```
Unknown flag '<flag>' passed to /conformance-loop.
Remedy: pick from the supported set: --auto-fix, --max-iterations N, --linear-team STE, --jira-project KEY, --dry-run.
Context: skill=conformance-loop, flag=<flag>
```

## Pre-flight refusals

Each fires before any side effects, exits non-zero with an NFR-10-shape message. Seven refusals (a)–(g) total; refusals (c)–(e) **delegate** to `/smoke-test`'s pre-flights of the same probe (so the canonical message and probe shape stay defined in one place). Refusal (f) is the Phase 0 `permissions.allow` pre-flight introduced by STE-252 — it runs before any `claude -p` spawn and asserts the tracked allow-list artifact is present and populated. Refusal (g) is the STE-351 subscription-billing guard — it runs before any spawn and asserts no API-billing env var is set.

(a) **Toolkit-repo cwd.** `pwd` must end in `/dev-process-toolkit`. The skill spawns child `/smoke-test` invocations whose own pre-flight #1 expects toolkit-repo cwd; running `/conformance-loop` from elsewhere creates the test projects in the wrong place. NFR-10 canonical refusal:

```
/conformance-loop must run from the dev-process-toolkit repo root.
Remedy: cd into the toolkit repo (pwd should end in /dev-process-toolkit), then re-run /conformance-loop.
Context: skill=conformance-loop, probe=cwd, observed=<pwd>
```

(b) **`/smoke-test` skill present** at `.claude/skills/smoke-test/SKILL.md`. The whole skill is a wrapper around `/smoke-test`; if the dependency is absent, refuse before any side effects. NFR-10 canonical refusal:

```
/smoke-test skill not found at .claude/skills/smoke-test/SKILL.md.
Remedy: restore the project-local /smoke-test skill (it is the dependency this skill wraps), then re-run /conformance-loop.
Context: skill=conformance-loop, probe=dependency, missing=.claude/skills/smoke-test/SKILL.md
```

(c) **Linear MCP loadable + STE team visible.** Delegates to `/smoke-test` pre-flights #3 (Linear MCP available in `~/.claude-st/`) + #5 (Linear team key resolvable). The probe runs once at this top-level rather than letting the Linear child fail mid-spawn — fast-fail saves ~10 min of wall-clock per failed run. NFR-10 canonical refusal (carries the `/smoke-test` probe name verbatim):

```
Linear MCP not loaded or team '<key>' not visible.
Remedy: register the Linear MCP in ~/.claude-st/, verify the team key resolves via mcp__linear__get_team, then re-run /conformance-loop.
Context: skill=conformance-loop, probe=delegated-smoke-test-3+5, tracker=linear, team=<key>
```

(d) **Atlassian MCP loadable + Jira project visible + `--jira-project` passed.** Delegates to `/smoke-test` pre-flights #7 (Atlassian MCP loadable + OAuth-bound) + #8 (Jira project visible / `--jira-project` flag present). The flag-missing variant fires here, not in the Jira child, so the operator sees the refusal before any subprocess spawn. NFR-10 canonical refusal:

```
Atlassian MCP not loaded or Jira project '<key>' not visible (or --jira-project missing).
Remedy: register the Atlassian Rovo MCP in ~/.claude-st/, complete OAuth via mcp__atlassian__authenticate, pass --jira-project <KEY>, then re-run /conformance-loop.
Context: skill=conformance-loop, probe=delegated-smoke-test-7+8, tracker=jira, project=<key>
```

(e) **Both `../dpt-test-project-{linear,jira}` paths free OR `--keep` was passed.** Delegates to `/smoke-test` pre-flight #2 (existing-test-project refusal) — fired twice, once per tracker. The two paths are operator-driven-parallelism-safe (different basenames, different MCP configs), but `/conformance-loop` runs both serially per iteration's Phase A and so MUST verify both up front. NFR-10 canonical refusal:

```
Test-project paths exist: '../dpt-test-project-linear' and/or '../dpt-test-project-jira' is non-empty.
Remedy: rm -rf ../dpt-test-project-linear ../dpt-test-project-jira (or pass --keep at the prior /smoke-test invocation), then re-run /conformance-loop.
Context: skill=conformance-loop, probe=delegated-smoke-test-2, paths=[<list-of-non-empty>]
```

(f) **`permissions.allow` populated in tracked `.claude/settings.json` AND contains the child-spawn pattern** (Phase 0 pre-flight, STE-252 AC-STE-252.3, strengthened by STE-351 AC-STE-351.1). Read `.claude/settings.json` from the toolkit-repo root, JSON-parse it, and assert that `.permissions.allow` is a non-empty array (`length > 0`) **and** that the array contains the canonical child-spawn pattern literal `Bash(claude:*)`. The tracked allow-list is the audit-able policy artifact that constrains every `claude -p` child the skill spawns; an empty or missing array means the loop would fall back to interactive permission prompts mid-run and stall the hands-off contract, and a populated array that *lacks the spawn pattern* is exactly the M94 false-green — the auto-mode classifier denies each nested `claude` spawn headless and the grandchildren die as 0-byte transcripts. A `length > 0` assertion alone does NOT catch that; the probe MUST be a contains-check on the pattern literal. Probe shape: `jq -e '.permissions.allow | index("Bash(claude:*)")' .claude/settings.json` (index/contains on the spawn-pattern literal), layered on the STE-252 `jq -e '.permissions.allow | length > 0' .claude/settings.json` non-empty check. Empty-or-missing array → NFR-10 canonical refusal:

```
permissions.allow empty or missing in .claude/settings.json.
Remedy: populate the permissions.allow allow-list in tracked .claude/settings.json (Bash command patterns + Edit/Write/Read/Grep/Glob + mcp__linear__* / mcp__atlassian__* MCP tool families covering the /conformance-loop call tree), then re-run /conformance-loop.
Context: skill=conformance-loop, pre-flight=permissions_allow_check, file=.claude/settings.json
```

Non-empty array that lacks the `Bash(claude:*)` spawn pattern → NFR-10 canonical refusal:

```
permissions.allow lacks the child-spawn pattern "Bash(claude:*)" in .claude/settings.json.
Remedy: add "Bash(claude:*)" to the permissions.allow allow-list in tracked .claude/settings.json so nested claude -p child spawns are classifier-allowed headless, then re-run /conformance-loop.
Context: skill=conformance-loop, pre-flight=spawn_pattern_allow_check, file=.claude/settings.json
```

On the hit-path (the `.permissions.allow` array is a non-empty array **and** contains the `Bash(claude:*)` spawn pattern), log the capability-row tokens `permissions_allow_present` and `spawn_pattern_allow_present` to the same `/tmp/dpt-conformance-loop-<date>-approval.txt` file used by the Phase 0 pre-approval gate (one literal line per token, no inference) and proceed to the Phase 0 pre-approval prompt. The token is byte-grep-checkable by downstream `/gate-check` probes and smoke-test capability-row aggregators (same shape convention as `spec_write_draft_default_applied`).

(g) **No API-billing env vars set** (Phase 0 pre-flight, STE-351 AC-STE-351.3). Read the environment before any spawn; if `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` is set, the loop's many `claude -p` children would inherit it and silently bill that API account at per-token rates instead of running on the operator's subscription. Probe shape: `[ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]`. Either variable set → NFR-10 canonical refusal:

```
ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set — an on-demand run would bill that API account at per-token rates rather than your subscription.
Remedy: unset the variable for this run (`env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN claude`), or re-run /conformance-loop interactively acknowledging the API cost.
Context: skill=conformance-loop, pre-flight=anthropic_key_guard, set=[<which-vars>]
```

**Interactive-override path:** an operator who *wants* API billing (e.g., a dedicated key funded for exactly this run) either unsets nothing and re-runs `/conformance-loop` in an interactive session — where the guard downgrades from hard refusal to a `y/N` cost-acknowledgment prompt (`proceed billing this API key? [y/N]`) — or exports `DPT_CONFORMANCE_ALLOW_API_BILLING=1` as the explicit override for that one invocation. Headless runs get no override prompt: non-interactive sessions cannot acknowledge cost, so the guard always refuses there unless the override variable is set. Aligns with the STE-191 KEY-surfacing pre-flight.

Each refusal above carries the literal phrase **NFR-10 canonical refusal** in the surrounding prose (nine `NFR-10 canonical refusal` markers across this section: one introductory mention plus the eight refusal anchors — (a)–(e) and (g) carry one each, and the STE-351-strengthened (f) carries two, allow-list-empty and spawn-pattern-missing — satisfying the verify line `grep -c 'NFR-10 canonical refusal' >= 6`).

## Flow

The flow is a loop of one or more iterations. Each iteration runs Phase A (parallel `/smoke-test` fan-out + aggregation) and, when `--auto-fix` is set, Phase B (sequential per-finding fixer dispatch). After each iteration, the termination check decides whether to re-iterate or exit. Pre-iteration overhead: Phase 0 pre-approval (once per invocation), then the loop.

### Phase 0 — Pre-approval gate

Print the contract to the operator and prompt for `y` to proceed. The prompt MUST include: both trackers active, real Linear + Jira writes, max wall-clock estimate (`max-iterations × ~10 min × 2`), max-iterations cap, auto-fix on/off (resolved value, not the literal flag).

```
/conformance-loop will:
  1. Spawn parallel /smoke-test --tracker linear and /smoke-test --tracker jira
     subprocess sessions per iteration (real Linear + Jira writes).
  2. Aggregate per-tracker findings into /tmp/dpt-conformance-loop-<date>-iter-<N>.md
     with cross-tracker dedup.
  3. <auto-fix-line>

Configuration:
  --auto-fix:        <ON|OFF (capture-only)>
  --max-iterations:  <N>
  --linear-team:     <STE>
  --jira-project:    <KEY>
  Estimated max wall-clock: <max-iterations × ~10 min × 2 trackers>

Real Linear writes will occur (test project + ~6 issues per iteration).
Real Jira writes will occur in Space <jira-project> (~6 work items per iteration,
all carrying the dpt-smoke label so /smoke-test Phase 5 teardown can transition them).

Proceed? [y/n]
```

When `--auto-fix` is ON, substitute `<auto-fix-line>` with `In Phase B, sequentially dispatch /dev-process-toolkit:spec-write + /dev-process-toolkit:implement per high-severity finding, then re-iterate until termination.`. When `--auto-fix` is OFF, substitute with `Capture-only mode: exit after Phase A of iteration 1 with the aggregated report.`.

**Marker-driven default-apply (STE-226).** Default-apply `y` when the prompt body contains the literal line `<dpt:auto-approve>v1</dpt:auto-approve>` (byte-grep, no inference) — same canonical detection contract used by `/spec-write` § 0b step 4 + § 4 + § 7a. Without the marker, refuse on `n` and on any non-`y` response. On `y` (interactive or marker-driven), log the approval to `/tmp/dpt-conformance-loop-<date>-approval.txt` and proceed to the loop. The marker is the single deterministic mechanism — legacy `Auto Mode Active` system-reminder detection and `claude -p` non-interactive inference are removed (no backward-compat shim per `project_no_users_yet`); `claude -p` invocations without the marker get interactive gating.

### Phase A — Parallel /smoke-test fan-out + aggregation

Each iteration's Phase A spawns two `claude -p /smoke-test ...` subprocess calls in parallel — both detached from a single Bash call, each PID captured to a per-iteration pidfile at `/tmp/dpt-conformance-loop-<date>-iter-<N>-{linear,jira}.pid` — then awaits both via the bounded poll-until-exit discipline below before reading the per-tracker findings files. Subprocess output is captured to per-iteration log files at `/tmp/dpt-conformance-loop-<date>-iter-<N>-{linear,jira}.log` for forensics.

**Parallelism mechanism.** Bash subprocess parallelism, **NOT the agent-team primitive** — agent teams have no `fork: true` flag and aren't recommended for serial orchestration per the Claude Code docs (`https://code.claude.com/docs/en/agent-teams`). Each subprocess is a top-level `claude -p` session, which can invoke skills via the literal-first-line pattern (sub-agents cannot, per docs).

**Reference snippet** — Phase A spawn (per iteration):

```bash
ITER=<N>
DATE=$(date +%Y-%m-%d)
LOG_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.log
LOG_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.log
PID_FILE_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.pid
PID_FILE_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.pid
RC_FILE_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.rc
RC_FILE_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.rc
PLUGIN_DIR="$(pwd)/plugins/dev-process-toolkit"   # cwd is the toolkit repo (verified by pre-flight (a))
export CLAUDE_CONFIG_DIR=~/.claude-st             # STE-350: exported so spawn lines stay bare `claude -p`

# Each /smoke-test child opens its own Phase 0 pre-approval gate; inject
# the canonical marker into the heredoc body so the child auto-approves
# and proceeds into Phase 1 without halting at the prompt (STE-226). The
# `{ ... } &` brace-group wrapper is required because heredoc-on-stdin
# `<<'PROMPT_EOF'` and the trailing background `&` cannot live on the
# same compound command line; the brace group scopes the heredoc to the
# command and lets `&` background the whole group. The trailing
# `echo $? > rc-file` inside each group persists the leg's exit code for
# post-exit collection — this spawn call detaches both legs and returns
# immediately (STE-355 backfill: no same-call foreground wait).
{
  claude -p "/smoke-test --tracker linear --linear-team ${LINEAR_TEAM:-STE}" \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_LINEAR}" 2>&1 <<'PROMPT_EOF'
<dpt:auto-approve>v1</dpt:auto-approve>
PROMPT_EOF
  echo $? > "${RC_FILE_LINEAR}"
} &
PID_LINEAR=$!; echo $! > "${PID_FILE_LINEAR}"

{
  claude -p "/smoke-test --tracker jira --jira-project ${JIRA_PROJECT}" \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_JIRA}" 2>&1 <<'PROMPT_EOF'
<dpt:auto-approve>v1</dpt:auto-approve>
PROMPT_EOF
  echo $? > "${RC_FILE_JIRA}"
} &
PID_JIRA=$!; echo $! > "${PID_FILE_JIRA}"

echo "detached: linear=${PID_LINEAR} jira=${PID_JIRA} — poll until both exit"
```

**Bounded poll-until-exit (repeated bounded Bash calls).** After the spawn call returns, poll until both PIDs exit — the same STE-355 discipline the smoke driver's Phase 2 uses for its grandchildren (`/smoke-test` § Grandchild spawn lifecycle). Each poll call is a **bounded multi-iteration loop** iterating both legs' pidfiles inside the same loop — up to 18 checks 30 s apart, ≈ ≤540 s (≈ 9 min) per call, safely under the harness's 600 s (10-minute) per-call ceiling. That is one Bash call per ~9 min instead of ~80 single-check calls across a 40-minute leg; the old single-check-then-end-call shape is **not** sanctioned. Never fold the whole wait into one unbounded call:

```bash
# One bounded poll call — up to 18 checks × 30 s ≈ 9 min (≤540 s), under the
# harness's 600 s per-call ceiling. Repeat until it reports both legs exited.
# (Fresh shell per Bash call: re-derive DATE/ITER first.)
for i in $(seq 1 18); do
  LIVE=""
  for LEG in linear jira; do
    PIDFILE=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-${LEG}.pid
    if [ -f "${PIDFILE}" ] && kill -0 "$(cat "${PIDFILE}")" 2>/dev/null; then
      LIVE="${LIVE} ${LEG}"
    else
      rm -f "${PIDFILE}"   # leg exited — clear its pidfile
    fi
  done
  [ -z "${LIVE}" ] && break
  sleep 30
done
if [ -n "${LIVE}" ]; then echo "still running:${LIVE} — poll again"; else echo "both legs exited — collect RCs"; fi
```

**RC collection (after the poll loop reports both legs exited).** Read each leg's rc-file — written by its brace group's trailing `echo $?` as the leg exited — and abort on any non-zero. A missing rc-file after exit is treated as a failure:

```bash
RC_LINEAR=$(cat "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.rc" 2>/dev/null || echo 1)
RC_JIRA=$(cat "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.rc" 2>/dev/null || echo 1)

# STE-359: before acting on any failure here, run the orphan-adoption scan
# below — a dead driver can leave live grandchildren whose completed
# captures are recoverable.
if [ "${RC_LINEAR}" -ne 0 ] || [ "${RC_JIRA}" -ne 0 ]; then
  echo "/conformance-loop: Phase A subprocess failed (linear=${RC_LINEAR}, jira=${RC_JIRA}). Aborting."
  exit 1
fi
```

**Why detached + poll, not a same-call wait (STE-355 backfill).** A single foreground Bash call caps at the harness's **600 s (10-minute) per-call ceiling** — the same ceiling that SIGTERM'd the 2026-07-02 `/implement` grandchild (F2). With the smoke driver's STE-355 poll wrapper in place, each `/smoke-test` child genuinely awaits its grandchildren (~10+ minutes per leg), so the old spawn shape — foreground-`wait`ing both PIDs inside the spawn call (`wait "${PID_LINEAR}"; wait "${PID_JIRA}"`) — is guaranteed to hit that ceiling and truncate both legs. The spawn call detaches and returns immediately; the bounded poll above is how Phase A waits.

**Residual risk — PID reuse.** `kill -0` answers for *any* live process with that PID, so a recycled PID could in principle keep a leg's poll looping after the child exited. Negligible at a 30 s poll interval, and the leg-completeness check below is the corroborating signal (a truncated leg fails the log-set verification regardless of what the poll believed) — noted so the wrapper isn't mistaken for a liveness proof.

**Live-pidfile session rule.** Ending the session — or reporting iteration results — while either leg's pidfile still answers `kill -0` is **forbidden**; the bounded poll loop above is the only sanctioned wait. Do not fire the spawns and end the turn "waiting for a completion notification" — a `-p` session cannot resume on background-task notifications, so the rest of the run silently never executes (the fire-and-exit shape, F3). The poll's exit branch removes each pidfile, so a clean Phase A leaves zero live pidfiles.

**Red flag — the harness's foreground-sleep block hint is NOT license to background the wait.** If a poll call leads with `sleep`, the harness blocks it with an error hint that reads roughly "Foreground `sleep` is blocked. To wait for a condition, use `run_in_background` or the Monitor tool." Do **not** follow that hint here: handing the wait to `run_in_background`/Monitor and then ending the turn IS the F3 fire-and-exit failure — a `-p` driver session never receives the completion notification, so the rest of the iteration silently never executes. The bounded poll loop above already avoids the block by gating each iteration on `kill -0` *before* its `sleep 30`; keep waiting with that loop, in the foreground, until both legs' pidfiles die.

**Final-message self-check (STE-357).** Before emitting **any** final message — success or failure — run the pidfile-liveness fence below over the run's pidfile glob (`/tmp/dpt-conformance-loop-*.pid`). Any live pidfile means a leg is still running: resume the bounded poll loop above; a live pidfile must **never end the turn**. Runtime validation ships deferred (`[~]`): the next conformance run must show both legs polling to completion.

```bash
# Final-message self-check — run before ANY final message (success or failure).
LIVE=""
for PIDFILE in /tmp/dpt-conformance-loop-*.pid; do
  [ -e "${PIDFILE}" ] || continue
  kill -0 "$(cat "${PIDFILE}")" 2>/dev/null && LIVE="${LIVE} ${PIDFILE}"
done
if [ -n "${LIVE}" ]; then echo "LIVE:${LIVE} — resume the bounded poll loop"; else echo "no live pidfiles — final message may be emitted"; fi
```

**Fail-fast on subprocess error.** If either leg's rc-file reports non-zero (or is missing after exit), the iteration aborts — no aggregation, no Phase B dispatch, no re-iteration — once the orphan-adoption scan below has run (STE-359: any surviving grandchildren are adopted and polled to exit first, so their completed captures are preserved as evidence before the abort). Forensics live in the per-iteration log files. The operator decides whether to re-run after fixing the underlying cause.

**Orphan adoption (STE-359; iter-2 F3).** A leg's driver can die while its grandchildren live on. Post-exit — before declaring the leg failed via the fail-fast above or the completeness check below — scan that leg's per-skill pidfiles at `/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.pid` (with `<tracker>` = `linear` / `jira` per leg); any pidfile whose PID still answers `kill -0` is an orphaned grandchild the parent **adopts**: poll it to exit with the same STE-357 bounded multi-iteration discipline as the leg poll above (up to 18 `kill -0` checks 30 s apart per Bash call, repeated calls until every adopted PID exits) before the leg-completeness check runs.

An adopted grandchild that completes contributes its capture to the leg-completeness check — the leg may still fail on its other missing captures; adoption recovers **evidence, not the chain**. Iter-2 precedent: the orphaned Jira `/setup` grandchild completed healthily on its own after its driver died — adoption turns that manual save into procedure.

**Residual risk — orphan-vs-killed nondeterminism (STE-359; iter-2 F3).** When a leg's driver dies with live grandchildren, whether a grandchild dies with its driver or survives as an orphan is environment-nondeterministic — process-group inheritance varies with spawn nesting, and iter-2 observed both outcomes in one run (the Linear `/setup` grandchild was killed with its parent while the Jira one survived and completed healthily). Process-group discipline (`setsid` / PGID-wide kill) was considered and rejected as the primary mechanism: it is OS/shell-dependent and unverifiable from SKILL.md prose. The adoption block above is the deterministic recovery — deterministic-by-construction at the layer this parent controls, it recovers a surviving orphan's capture regardless of which way the environment broke.

**Leg-completeness check (STE-355 mirror).** RC 0 alone is not proof a leg ran its chain — the 2026-07-02 run had both children fire grandchild spawns in the background and exit RC 0 "waiting for its completion notification". So after both children return, and before aggregation, Phase A verifies each leg's expected grandchild log set is complete and result-bearing: every log in `/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.log` (with `<tracker>` = `linear` / `jira` per leg) must exist, be fresh (mtime not before run-start — see the freshness gate below), be non-empty, and carry a stream-json `result` event. A leg whose log set is incomplete — or whose final message matches the fire-and-exit shape (grandchild spawned in the background, child exits awaiting a completion notification it can never receive) — is treated as a failed leg **regardless of RC 0**, and the iteration aborts via the same fail-fast path as a non-zero RC: no aggregation, no Phase B dispatch, no re-iteration; forensics live in the per-iteration and per-skill log files.

**Freshness gate (STE-358; iter-2 F2).** The leg-completeness check is freshness-gated on the **run-start timestamp** captured at Phase 0 acceptance (the epoch-ms moment this invocation's pre-approval was logged): pass it as the `runStart` argument to `assertChainIntegrity` (`adapters/_shared/src/smoke_child_capture.ts`), so a log whose mtime predates run-start is the pinned `capture stale (pre-run)` finding — stale, never healthy, and it can never satisfy the completeness check regardless of its content. Result-bearing alone is not enough: the iter-2 (2026-07-02) run's surviving morning log carried a `result` event and would have false-passed an ungated check. The gate is strictly `mtime < run-start`; a log written exactly at run-start is fresh.

**Path-safety guard delegated to children.** Per-tool-call enforcement now lives in the tracked `permissions.allow` allow-list (`.claude/settings.json`, STE-252) — every `claude -p` child runs in default permission mode and is constrained to the union of patterns enumerated there (Bash command-pattern entries + `Edit`/`Write`/`Read`/`Grep`/`Glob` + `mcp__linear__*` / `mcp__atlassian__*`). Each `/smoke-test` child still runs its own pre-flight #6 (the `realpath`-based allow-list check that pins the resolved test-project path to one of `{dpt-test-project-linear, dpt-test-project-jira}` under a `workspace/` ancestor, not a symlink, not the toolkit repo itself), but that guard is now a **cwd guard** — it bounds *where* the children operate, while the tracked `permissions.allow` block bounds *what* they can call. `/conformance-loop` does not duplicate the realpath cwd guard at the parent — pre-flight (a) verifies the parent cwd is the toolkit repo, the Phase 0 `permissions.allow` pre-flight (refusal (f)) verifies the policy artifact is populated, and the child's #6 fires before any side effects. The realpath check no longer carries the "bypass-justification" load-bearing role it had pre-STE-252; it remains for cwd hygiene only.

**Aggregation.** After both children return, read the per-tracker findings files at the existing canonical paths (no `/smoke-test` changes):

- `/tmp/dpt-smoke-findings-${DATE}-linear.md` — Linear-side findings.
- `/tmp/dpt-smoke-findings-${DATE}-jira.md` — Jira-side findings.

Parse each into a list of finding records (each finding is delimited by `### F<N> — <one-line summary>` per `/smoke-test` Phase 3's findings template). Apply the cross-tracker dedup heuristic (see § Cross-tracker dedup below) and emit the unified report at `/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}.md`.

Aggregated report shape (per iteration):

```
# /conformance-loop iteration <ITER> — <DATE>

**Tracker coverage:** linear + jira
**Source files:**
- /tmp/dpt-smoke-findings-<DATE>-linear.md
- /tmp/dpt-smoke-findings-<DATE>-jira.md

## Findings

### F1 — <one-line summary>

**Severity:** high
**tracker-coverage:** [linear, jira]   <!-- both trackers surfaced this -->
**Dedup:** exact-match (STE-<N> runtime regression: <fixture>)

<body>

### F2 — <one-line summary>

**Severity:** high
**tracker-coverage:** [linear]
**Dedup:** single-tracker (no Jira surface)

<body>

### F3 — <one-line summary>

**Severity:** medium
**tracker-coverage:** [linear, jira]
**Dedup:** ~probable-dup (≥80% normalized-body overlap; operator review recommended)

<body>
```

#### Cross-tracker dedup

Two-pass heuristic:

1. **Exact-match pass.** Walk every Linear finding; for each, scan Jira findings for an identical `STE-<N> runtime regression: <fixture>` diagnostic line (matches the convention from `/smoke-test` Phase 2.X fixtures). On hit ⇒ emit one entry with `tracker-coverage: [linear, jira]` and `Dedup: exact-match`; skip the Jira-side counterpart in the second pass.
2. **Fuzzy-overlap pass.** For every still-unmatched Linear finding, normalize body (lowercase, strip whitespace + markdown noise) and compute substring overlap against every still-unmatched Jira finding. ≥ 80% ⇒ dedup with `tracker-coverage: [linear, jira]` + `Dedup: ~probable-dup` flag (flag because fuzzy matches deserve operator review). < 80% ⇒ both findings emit independently with their own single-tracker `tracker-coverage`.

Single-tracker findings (no counterpart on the other side) carry `tracker-coverage: [linear]` or `tracker-coverage: [jira]` with `Dedup: single-tracker`. The aggregated entry is never duplicated — exactly one entry per unique regression across both trackers.

### Phase B — `--auto-fix` dispatch (sequential per finding)

Fires only when `--auto-fix` is ON. In capture-only mode (default), the loop exits after Phase A of iteration 1 with the aggregated report — no `/spec-write` or `/implement` dispatch. This is the load-bearing rule that honors `/smoke-test`'s "Capture, don't fix" semantics in the default mode.

When `--auto-fix` is ON, sequentially walk the deduplicated **high-severity** findings list (entries where `**Severity:** high`). For each finding `F`, in order:

1. **Spawn `claude -p /dev-process-toolkit:spec-write`** with the literal-first-line + heredoc-on-stdin pattern from `/smoke-test` § Phase 2 child-spawn discipline (STE-185). The heredoc body carries `F`'s text verbatim so `/spec-write` allocates an FR for the regression. Capture stdout to `/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-fix-${IDX}-spec-write.log` and parse the freshly-allocated `<new-tracker-id>` from the closing-summary table (per `/spec-write`'s § 7 closing summary contract — single new FR ⇒ one row in the table, the `FR id` column carries the allocated tracker ID).

2. **Spawn `claude -p /dev-process-toolkit:implement <new-tracker-id>`** — full TDD + tracker writes through Phase 4 commit. Pre-authorize the Phase 4 step 15 commit upfront (operator's batch consent at Phase 0 carries through, per the STE-220 `-p` carve-out). Capture stdout to `/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-fix-${IDX}-implement.log`.

   Next finding starts after the prior finding's `/implement` returns. Sequential, not parallel — each fixer commits to the toolkit repo, so parallel fixers would race on the working tree.

**Severity filter — high only.** `**Severity:** medium` and `**Severity:** low` findings surface in the aggregated report (operator visibility) but **do not** trigger Phase B dispatch. Driver-side caveats (e.g., `claude-st -p doesn't support X`) are conventionally `medium` per `/smoke-test`'s findings template, so this filter naturally excludes them — the maintainer wouldn't agree with auto-allocating an FR for a driver-side caveat. Closes the risk noted in STE-224's `## Notes`.

**Reference snippet** — Phase B per-finding dispatch (sequential):

```bash
IDX=0
PLUGIN_DIR="$(pwd)/plugins/dev-process-toolkit"
export CLAUDE_CONFIG_DIR=~/.claude-st   # STE-350: exported so spawn lines stay bare `claude -p`
for FINDING_TEXT in <high-severity-findings-from-aggregated-report>; do
  IDX=$((IDX + 1))
  LOG_SW=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-fix-${IDX}-spec-write.log
  LOG_IMPL=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-fix-${IDX}-implement.log

  # Collision-resistant heredoc delimiter: a finding body could contain the
  # literal `PROMPT_EOF` on its own line (a fixture name, a code snippet, or
  # the operator quoting an earlier prompt). Suffixing the delimiter with a
  # uuid eliminates the collision surface entirely; if `uuidgen` is absent,
  # fall back to `$RANDOM`-based suffixing — both produce a tag that cannot
  # appear in a finding body unless the writer is specifically attacking the
  # parser.
  EOF_TAG="PROMPT_EOF_$(uuidgen 2>/dev/null || echo "${RANDOM}${RANDOM}")"

  # 1. /spec-write — allocate a new FR for the finding. The marker line
  #    `<dpt:auto-approve>v1</dpt:auto-approve>` is the byte-checkable
  #    pre-authorization handoff for /spec-write's draft + commit gates
  #    (STE-226); without it the child halts at the FR-draft prompt.
  claude -p \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_SW}" 2>&1 <<${EOF_TAG}
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:spec-write

${FINDING_TEXT}
${EOF_TAG}

  NEW_TRACKER_ID=$(<parse-closing-summary-from "${LOG_SW}">)

  # Fail-fast guard: an empty NEW_TRACKER_ID means /spec-write did not emit a
  # closing-summary row (subprocess failure, parse failure, or zero-byte
  # stdout). Surface the failure with the log path so the operator can
  # forensically inspect, then abort the iteration (do NOT silently dispatch
  # /implement against an empty argument).
  if [ -z "${NEW_TRACKER_ID}" ]; then
    echo "/conformance-loop: Phase B fix-${IDX} failed — /spec-write produced no tracker ID. See ${LOG_SW}. Aborting Phase B."
    exit 1
  fi

  # 2. /implement — build the FR end-to-end. Marker injected via heredoc
  #    so /implement's Phase 4 step 15 commit gate auto-applies under
  #    `claude -p` (STE-226). Same `${EOF_TAG}` collision-resistant
  #    delimiter as the /spec-write spawn above; no body content needed
  #    beyond the marker because the slash command + argument live on
  #    the CLI argv.
  claude -p "/dev-process-toolkit:implement ${NEW_TRACKER_ID}" \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_IMPL}" 2>&1 <<${EOF_TAG}
<dpt:auto-approve>v1</dpt:auto-approve>
${EOF_TAG}
done
```

### Termination

After each iteration (Phase A + optional Phase B), the loop checks three exit conditions in order. The first to trip wins:

(a) **`green`** — both per-tracker findings files have zero `**Severity:** high` lines:

```bash
HIGH_LINEAR=$(grep -c '^\*\*Severity:\*\* high' /tmp/dpt-smoke-findings-${DATE}-linear.md)
HIGH_JIRA=$(grep -c '^\*\*Severity:\*\* high' /tmp/dpt-smoke-findings-${DATE}-jira.md)
if [ "${HIGH_LINEAR}" -eq 0 ] && [ "${HIGH_JIRA}" -eq 0 ]; then
  STATUS=green
  break
fi
```

(b) **`max-iterations`** — counter ≥ `--max-iterations`:

```bash
if [ "${ITER}" -ge "${MAX_ITERATIONS}" ]; then
  STATUS=max-iterations
  break
fi
```

(c) **`no-progress`** — current iteration's aggregated findings file is byte-identical to the previous iteration's, OR `--auto-fix`'s Phase B produced zero file changes (probed via `git rev-parse HEAD` unchanged before/after Phase B):

```bash
PREV=/tmp/dpt-conformance-loop-${DATE}-iter-$((ITER - 1)).md
CURR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}.md
if [ -f "${PREV}" ] && cmp -s "${PREV}" "${CURR}"; then
  STATUS=no-progress
  break
fi
if [ "${AUTO_FIX}" = "on" ] && [ "${HEAD_BEFORE_PHASE_B}" = "${HEAD_AFTER_PHASE_B}" ]; then
  STATUS=no-progress
  break
fi
```

The `green` probe runs after Phase A (Phase B's fixers may have lowered the count). The `max-iterations` probe runs once `green` does not trip. The `no-progress` probe needs at least one prior iteration's aggregated report to compare against, so on iteration 1 with `--auto-fix` ON it falls back to the `git rev-parse HEAD` probe; on iteration 1 with `--auto-fix` OFF, neither no-progress sub-probe fires (the loop already exits via capture-only's `iter == 1` short-circuit).

**Capture-only short-circuit.** When `--auto-fix` is OFF, the loop exits after Phase A of iteration 1 unconditionally with `STATUS=capture-only` (not one of the three above). The three termination probes only matter when `--auto-fix` is ON and the loop may run multiple iterations.

### Closing summary

Emit a unified per-iteration table to stdout, plus the termination reason and links to every artifact:

```
## /conformance-loop summary

| iter | status   | high (linear) | high (jira) | medium (linear+jira) | fixer-changes | wall-clock |
|------|----------|---------------|-------------|----------------------|---------------|-----------|
|    1 | running  |             3 |           2 |                    4 |             2 | 11m 14s   |
|    2 | running  |             1 |           1 |                    3 |             2 | 10m 47s   |
|    3 | green    |             0 |           0 |                    2 |             — | 10m 02s   |

Termination reason: green (zero **Severity:** high lines in both per-tracker files)

Artifacts:
- iter-1: /tmp/dpt-conformance-loop-<date>-iter-1.md
- iter-2: /tmp/dpt-conformance-loop-<date>-iter-2.md
- iter-3: /tmp/dpt-conformance-loop-<date>-iter-3.md
- linear logs: /tmp/dpt-conformance-loop-<date>-iter-*-linear.log
- jira logs:   /tmp/dpt-conformance-loop-<date>-iter-*-jira.log
- approval:    /tmp/dpt-conformance-loop-<date>-approval.txt

Open questions / risks / inconsistencies:
- (rendered from capability-key map; see § Capability-key map)
```

#### Capability-key map (for closing summary's open-questions block)

The closing summary's open-questions block renders capability gaps as **plain prose**, drawn from the static map below — same pattern as `/spec-write`'s § Step 7 capability-key map. Add new keys to this map when a new capability gap surfaces; do **not** invent ad-hoc prose at runtime.

| Capability key                              | Rendered prose |
|---------------------------------------------|----------------|
| `conformance_loop_terminated_green`         | `loop converged on iteration <N> — both per-tracker findings files report zero **Severity:** high lines; safe to ship` |
| `conformance_loop_terminated_exhausted`     | `loop hit --max-iterations cap (<N>) before convergence — high-severity findings remain in iter-<N>; operator should triage manually before re-running` |
| `conformance_loop_terminated_no_progress`   | `loop detected no-progress (byte-identical aggregated findings across iter-<N-1> and iter-<N>, or zero git HEAD advance after Phase B) — fixers cannot resolve the remaining findings; operator should triage manually` |

Three new capability keys total: `conformance_loop_terminated_green`, `conformance_loop_terminated_exhausted`, `conformance_loop_terminated_no_progress` (satisfies the verify line `grep -c 'conformance_loop_terminated_' >= 3`).

The `STATUS` value from the termination check maps directly to one of the three keys: `green` ⇒ `conformance_loop_terminated_green`, `max-iterations` ⇒ `conformance_loop_terminated_exhausted`, `no-progress` ⇒ `conformance_loop_terminated_no_progress`. The `capture-only` short-circuit emits no capability-key row (it's the default success path, not a capability gap).

## Output

All output paths carry the per-iteration `<ITER>` suffix so a subsequent iteration cannot overwrite the prior iteration's artifacts:

- `/tmp/dpt-conformance-loop-<DATE>-iter-<N>.md` — aggregated report (the deliverable per iteration).
- `/tmp/dpt-conformance-loop-<DATE>-iter-<N>-{linear,jira}.log` — per-iteration child stdout/stderr.
- `/tmp/dpt-conformance-loop-<DATE>-iter-<N>-fix-<IDX>-{spec-write,implement}.log` — per-fix-step child stdout/stderr (Phase B only).
- `/tmp/dpt-conformance-loop-<DATE>-approval.txt` — operator approval record from Phase 0 (one per invocation, not per iteration).

End-of-run console summary: per-iteration table, termination reason, links to all artifacts (see § Closing summary above).

## Rules

- **Project-local, not plugin.** Lives in `.claude/skills/conformance-loop/SKILL.md`. Do not move into `plugins/dev-process-toolkit/skills/` — downstream users have no business running a conformance loop against the plugin they just installed.
- **Capture-only is the default.** `--auto-fix` is opt-in by explicit flag. The default mode preserves `/smoke-test`'s "Capture, don't fix" rule unchanged.
- **High-severity only for Phase B.** Medium and low findings surface in the aggregated report but never trigger fixer dispatch. Driver-side caveats are conventionally medium and so are filtered out by construction.
- **Sequential per-finding fixer dispatch.** Each `/spec-write` + `/implement` pair commits to the toolkit repo; parallel fixers would race on the working tree. Per-finding sequential, per-iteration parallel (only the two per-tracker `/smoke-test` children run in parallel).
- **Fail-fast on Phase A subprocess error.** If either `/smoke-test` child returns non-zero, the iteration aborts immediately — no aggregation, no Phase B dispatch, no re-iteration. Forensics live in the per-iteration log files.
- **No agent-team primitive.** Bash subprocess parallelism is the only sanctioned mechanism — agent teams have no `fork: true` flag and aren't recommended for serial orchestration per the Claude Code docs.
- **Operator owns iteration count.** No budget cap; `--max-iterations` is the only spending control. Default 3 means a worst-case ~60-min wall-clock for a fully-iterating run.
- **--dry-run is for tests, not operators.** Operators always run live; `--dry-run` exists so the integration test (`conformance-loop-dry-run.test.ts`) can cover the parallelism + aggregation + termination paths without invoking real `claude -p` children.

## Threat model

`/conformance-loop` is the **formally-sanctioned exception** to two `/smoke-test` rules — the override is documented here so future operators understand the deliberate deviation.

### Override sanction — `/smoke-test`'s "Capture, don't fix" rule

`/smoke-test` § Rules states "Capture, don't fix" — the smoke-test driver surfaces issues into a findings file but never dispatches fixers. The rationale was that triage and fix should happen via `/spec-write` + `/implement` on the toolkit repo, not inline, so the operator owns triage decisions per finding (some findings are driver-side caveats, not plugin bugs).

`/conformance-loop --auto-fix` deliberately overrides this rule. **Justification:** post-M55 and post-M56 smoke runs surfaced 6 and 3+ FRs respectively — manual triage of every finding dominates the operator's time, and the overwhelming majority of high-severity findings have already been triaged as legitimate plugin bugs by the time they reach this stage. The opt-in `--auto-fix` flag makes the override explicit; capture-only mode (the default) preserves the original rule unchanged for raw `/smoke-test` invocations.

**Safety rails for the override:**
- **`--max-iterations` cap.** Operator-controlled budget. Default 3, hard maximum at the operator's discretion. Prevents runaway loops.
- **Capture-only default.** The override only fires when the operator explicitly passes `--auto-fix`; the default mode honors the original rule.
- **No-progress detection.** A finding `/implement` cannot actually fix would otherwise loop until `--max-iterations`. The no-progress probe (zero diff between iter-N and iter-N-1 aggregated findings, OR zero `git rev-parse HEAD` advance after Phase B) catches this on iteration 2 and exits with `status: no-progress`. Acceptable mitigation under the "operator owns iteration count" model.
- **High-severity filter for Phase B.** Only `**Severity:** high` findings trigger fixer dispatch; driver-side caveats (conventionally medium) are filtered out by construction. Closes the risk that `--auto-fix` would auto-allocate FRs for findings the maintainer wouldn't agree with.

### Override sanction — `/smoke-test`'s "One run per release cycle" rule

`/smoke-test` § Rules states "One run per release cycle. Don't re-run for fun; each run costs real tokens and Linear teardown labor." With token cost dropped from this design's scope (operator owns iteration count via `--max-iterations`), only the teardown labor remains — and the operator accepts the per-iteration teardown burden as the cost of automation. The "Capture, don't fix" rule is overridden only when `--auto-fix` is explicitly set; capture-only mode preserves the original rule.

### Inherited precondition — workspace trust (STE-356)

The tracked `permissions.allow` allow-list that `/smoke-test`'s threat model leans on as its load-bearing rail is enforcement-effective only when the spawn cwd's workspace is trusted — in an untrusted workspace the harness ignores the scaffolded `.claude/settings.json` entries wholesale and the policy artifact goes inert. `/smoke-test` Phase 1 step 6b is the seeding step (it merges `hasTrustDialogAccepted: true` for the test-project path into `$CLAUDE_CONFIG_DIR/.claude.json` before any spawn). The counterexample is the 2026-07-02 conformance run's F4 capture: grandchild logs opened with `Ignoring 10 permissions.allow entries from .claude/settings.json: this workspace has not been trusted`, so the canonical chain ran on auto-mode classifier goodwill instead of the reviewed policy. Every leg this loop fans out inherits that precondition; the `checkAllowlistInert` post-return detector in `/smoke-test` surfaces any recurrence as a high-severity `STE-356 regression: allow-list inert — <child> (workspace untrusted)` finding, which bars the leg from green.

### Residual risks (not protected against)

- **Runaway tracker writes.** Each iteration creates a fresh test project (Linear) + ~6 work items (Jira). At `--max-iterations 3`, a fully-iterating run creates ~18 work items per tracker. Operator must run the manual sweep (`/smoke-test` Phase 5 teardown handles the per-iteration cleanup, but the operator should verify post-run).
- **Driver-side caveats slip through.** If a driver-side caveat is misclassified as `high` (operator misjudgement at smoke-test authoring time), Phase B will dispatch on it. Mitigation: the high-severity convention is documented in `/smoke-test`'s findings template; the operator should fix the misclassification at the source rather than working around it here.
- **Loop-induced spec drift.** Each iteration's `/implement` commits land on the toolkit repo; if multiple iterations accumulate before the operator reviews, spec drift may accumulate. Mitigation: operator should review after each `/conformance-loop` run before re-running.
