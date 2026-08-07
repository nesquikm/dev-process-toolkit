---
name: conformance-loop
description: Drive `/smoke-test` against both trackers in parallel and aggregate the per-tracker findings files into one deduplicated report. Default `capture-only` mode honors `/smoke-test`'s "Capture, don't fix" rule unchanged. Opt-in `--auto-fix` mode walks the deduplicated high-severity findings list and dispatches `/dev-process-toolkit:spec-write` + `/dev-process-toolkit:implement` per finding, then re-iterates until termination. Project-local skill, not plugin.
argument-hint: '[--auto-fix] [--max-iterations N] [--legs linear,jira,none] [--linear-team STE] [--jira-project KEY] [--dry-run]'
disable-model-invocation: true
---

# /conformance-loop

Automate the manual two-terminal `/smoke-test` workflow with cross-tracker dedup, capture-only-by-default, and an opt-in `--auto-fix` mode that dispatches `/dev-process-toolkit:spec-write` + `/dev-process-toolkit:implement` per finding under explicit safety rails. **Project-local skill** — lives in `.claude/skills/conformance-loop/SKILL.md` of the dev-process-toolkit repo, not in the plugin itself. Downstream users never see it.

This skill is the formally-sanctioned exception to `/smoke-test`'s "Capture, don't fix" + "One run per release cycle" rules. Capture-only mode preserves those rules unchanged for raw `/smoke-test` invocations; `--auto-fix` mode is the operator's explicit opt-in to the automated loop with `--max-iterations` + no-progress safety rails (no budget cap — operator controls cost via iteration count).

## When to use

- Pre-release sanity check before `/ship-milestone M<N>` runs, when both Linear and Jira surfaces need to be exercised in one shot.
- After landing any FR that touches `skills/setup/SKILL.md`, `skills/spec-write/SKILL.md`, `skills/implement/SKILL.md`, `skills/gate-check/SKILL.md`, `skills/spec-archive/SKILL.md`, or any of the `templates/` files.
- **Not** for every commit, not in CI — this is expensive (real LLM tokens, real Linear + Jira writes) and slow (`max-iterations × ~10 min` wall-clock per run). Leg count does not enter that product: the legs are detached concurrent brace groups sharing one bounded poll, so a run's wall-clock is set by its SLOWEST leg, not by their sum. A third leg costs tokens, not minutes.

## Argument parsing

Parse `$ARGUMENTS` once, before any pre-flight runs:

- `--auto-fix` — boolean, **default OFF**. When OFF (capture-only mode, the default), the loop exits after Phase A of iteration 1 with the aggregated findings report and dispatches no fixers — this honors `/smoke-test`'s "Capture, don't fix" rule unchanged. When ON, Phase B fires per high-severity finding (sequential `/dev-process-toolkit:spec-write` → `/dev-process-toolkit:implement` per finding), and the loop re-iterates until one of the three termination conditions trips.
- `--max-iterations N` — integer, **default 3**. Hard cap on iteration count (counts both capture-only and auto-fix iterations). The loop exits with `status: max-iterations` once the counter reaches `N`. Operator owns this number — there is no budget cap; cost is controlled by iteration count.
- `--legs <comma-separated>` — the leg selector, **default: every leg registered in `SMOKE_LEGS`**. Restricts the set Phase A spawns to the named legs, as the documented opt-out for a token-tight run (a leg costs tokens, not wall-clock — see § When to use). Omitting the flag selects everything; it is not the same as passing an empty value, which selects nothing and is refused. Resolution and both of its refusals are pre-flight (0) below, which runs before pre-flight (a).
- `--linear-team STE` — pass-through to the Linear `/smoke-test` child via `--linear-team`. Default `STE` (matches `/smoke-test`'s default).
- `--jira-project KEY` — **required only when `jira` is in the selected leg set.** Pass-through to the Jira `/smoke-test` child via `--jira-project`. The Jira child's pre-flight #8 enforces visibility of the Space; `/conformance-loop`'s pre-flight (d) verifies presence of the flag before any side effects — and skips that verification entirely when the selection does not include `jira`, because a flag the run will never use is not a precondition for it. `--legs linear,none` without `--jira-project` therefore does not refuse.
- `--dry-run` — boolean, default OFF. Mocks the subprocess spawn and returns canned per-tracker findings files (used by `conformance-loop-dry-run.test.ts` to cover parallelism mechanics + aggregation + termination without invoking real `claude -p` children). Wires the same Phase A → termination path as a real run; only the subprocess call is replaced by reading from a fixture directory.

Unknown flags refuse with NFR-10 canonical refusal naming the unknown flag and the supported set:

```
Unknown flag '<flag>' passed to /conformance-loop.
Remedy: pick from the supported set: --auto-fix, --max-iterations N, --linear-team STE, --jira-project KEY, --dry-run, --legs linear,jira,none.
Context: skill=conformance-loop, flag=<flag>
```

## Pre-flight refusals

Each fires before any side effects, exits non-zero with an NFR-10-shape message. **Nine refusals total — (0) plus (a)–(h)**, emitting eleven distinct canonical messages between them; refusals (c)–(e) **delegate** to `/smoke-test`'s pre-flights of the same probe (so the canonical message and probe shape stay defined in one place).

**(0) is deliberately not a letter, and that is a compatibility decision rather than a stylistic one.** It is ORDERED FIRST — it runs before pre-flight (a)'s cwd probe — but the lettered refusals keep the letters they have always had. Re-lettering to insert it as a new `(a)` would silently re-point every by-letter cross-reference in this file, in `/smoke-test`, and in the test suite at a different refusal than the one its author meant. Refusal (f) is the Phase 0 `permissions.allow` pre-flight introduced by STE-252 — it runs before any `claude -p` spawn and asserts the tracked allow-list artifact is present and populated. Refusal (g) is the STE-351 subscription-billing guard — it runs before any spawn and asserts no API-billing env var is set. Refusal (h) is the STE-367 workspace-trust precondition — it runs before any spawn and asserts both test-project paths are trusted.

(0) **Leg selection resolves to a non-empty subset of `SMOKE_LEGS` (STE-447).** Runs immediately after argument parsing and **before pre-flight (a)**, because a refusal that fires later has already had the opportunity to touch the filesystem. Resolving `--legs` is what introduces the possibility of an empty run, and an empty run is not a cheap run — it is a **vacuously green** one. A run that spawns nothing writes no per-leg findings file; a findings file that does not exist contributes no `**Severity:** high` lines; and the `green` termination probe reads zero high lines as convergence. The loop would report `green` having tested nothing. That is the milestone's own "no findings and no evidence must never reconcile to the same verdict" rule one level up from a missing findings file, so the selector that creates the hazard is the thing that must close it — fail-closed, before any spawn.

An **omitted** `--legs` selects every registered leg. An **empty** `--legs ""` is a different input: the operator named a selection and the selection was empty. The two are distinguished by set-vs-unset, never by emptiness, and only the first is a default.

Unrecognized value(s) → NFR-10 canonical refusal, in the same shape as the unknown-flag refusal above (it names the offending value and the supported set):

```
Unknown --legs value(s) '<values>' passed to /conformance-loop.
Remedy: pick from the registered leg set: <registered>.
Context: skill=conformance-loop, pre-flight=legs_unknown_value, unknown=[<values>]
```

Resolved selection of zero legs → NFR-10 canonical refusal:

```
--legs resolved to zero legs — /conformance-loop refuses to run.
Remedy: pass --legs with at least one registered leg (<registered>), or omit --legs to select every registered leg.
Context: skill=conformance-loop, pre-flight=legs_zero_selection, resolved=[]
```

An unreadable authority module → NFR-10 canonical refusal. **A registry that cannot be read is its own refusal, never an empty set** — reading it as empty would route a broken module straight into the vacuous-green path this gate exists to close:

```
Registered leg set unreadable — /conformance-loop cannot resolve SMOKE_LEGS.
Remedy: re-run from the toolkit repo root so <plugin dir> resolves, then verify the authority module prints its legs.
Context: skill=conformance-loop, pre-flight=legs_registry_unreadable
```

Probe shape. The registered set is read from the authority module rather than restated here, so this gate cannot drift from `SMOKE_LEGS` (STE-446):

```bash
# Pre-flight (0) — leg selection. Runs after argument parsing and BEFORE
# pre-flight (a): before the cwd probe, before any pidfile is written, before
# any log is opened. Nothing above this point touches the filesystem.
#
# LEGS_ARG is the raw `--legs` value. UNSET means the flag was omitted (select
# everything); SET-BUT-EMPTY means an empty selection was named (refuse).
PLUGIN_DIR="${PLUGIN_DIR:-$(pwd)/plugins/dev-process-toolkit}"
REGISTERED_LEGS="$(bun "${PLUGIN_DIR}/adapters/_shared/src/smoke_fixture_groups.ts" legs 2>/dev/null)"
if [ -z "${REGISTERED_LEGS}" ]; then
  echo "Registered leg set unreadable — /conformance-loop cannot resolve SMOKE_LEGS." >&2
  echo "Remedy: re-run from the toolkit repo root so ${PLUGIN_DIR} resolves, then verify the authority module prints its legs." >&2
  echo "Context: skill=conformance-loop, pre-flight=legs_registry_unreadable" >&2
  exit 2
fi

if [ -z "${LEGS_ARG+isset}" ]; then
  SELECTED_LEGS="${REGISTERED_LEGS}"          # flag omitted ⇒ every registered leg
else
  SELECTED_LEGS=""; UNKNOWN_LEGS=""
  # `set -f` (noglob) is LOAD-BEARING, not hygiene. The `for` list below is an
  # UNQUOTED command substitution, so without it the shell runs pathname
  # expansion on the operator's value BEFORE the loop body sees it — and the
  # metacharacter guard inside the loop would then be inspecting FILENAMES the
  # glob already matched, never the glob. Measured: with globbing on, in a
  # directory containing a file named `linear`, `--legs 'li?ear'` resolved to
  # `legs_selected=linear` — an unregistered value silently admitted by the one
  # gate that may not fail open. The guard was not merely weak there, it was
  # unreachable for every glob that matched anything.
  #
  # Compounding it: pre-flight (0) deliberately runs before (a)'s cwd probe, so
  # the directory those filenames would come from is not yet verified.
  set -f
  for CANDIDATE in $(printf '%s' "${LEGS_ARG}" | tr ',' ' '); do
    # With globbing off, a candidate carrying a metacharacter now reaches this
    # guard as the literal the operator typed, and is rejected before the
    # membership `case` below.
    case "${CANDIDATE}" in *[!A-Za-z0-9_-]*)
      UNKNOWN_LEGS="${UNKNOWN_LEGS}${UNKNOWN_LEGS:+ }${CANDIDATE}"; continue ;;
    esac
    case " ${REGISTERED_LEGS} " in
      *" ${CANDIDATE} "*)
        case " ${SELECTED_LEGS} " in
          *" ${CANDIDATE} "*) ;;                                            # already selected
          *) SELECTED_LEGS="${SELECTED_LEGS}${SELECTED_LEGS:+ }${CANDIDATE}" ;;
        esac ;;
      *) UNKNOWN_LEGS="${UNKNOWN_LEGS}${UNKNOWN_LEGS:+ }${CANDIDATE}" ;;
    esac
  done
  set +f
  if [ -n "${UNKNOWN_LEGS}" ]; then
    echo "Unknown --legs value(s) '${UNKNOWN_LEGS}' passed to /conformance-loop." >&2
    echo "Remedy: pick from the registered leg set: ${REGISTERED_LEGS}." >&2
    echo "Context: skill=conformance-loop, pre-flight=legs_unknown_value, unknown=[${UNKNOWN_LEGS}]" >&2
    exit 2
  fi
fi

if [ -z "${SELECTED_LEGS}" ]; then
  echo "--legs resolved to zero legs — /conformance-loop refuses to run." >&2
  echo "Remedy: pass --legs with at least one registered leg (${REGISTERED_LEGS}), or omit --legs to select every registered leg." >&2
  echo "Context: skill=conformance-loop, pre-flight=legs_zero_selection, resolved=[]" >&2
  exit 2
fi
echo "legs_selected=${SELECTED_LEGS}"
```

`SELECTED_LEGS` is the leg set for the rest of the invocation: pre-flights (c), (d), (e) and (h) below iterate it, Phase A spawns one leg per member of it, and Phase 0's contract reports it. The bounded poll loop and the `green` probe keep iterating the **registered** set rather than the selection, and each handles an unselected leg differently:

- The poll loop is safe by construction — an unselected leg writes no pidfile, its `[ -f "${PIDFILE}" ]` test fails, and it is skipped.
- **Four downstream surfaces are NOT adapted to a partial selection, and a reduced run currently dies at the first of them.** Measured, not inferred:
  - **The rc-collection gate** aborts first (§ RC collection, below). It reads every registered leg's rc-file; an unselected leg wrote none, the `case '' -> RC=1` normalization treats an unreadable rc as a failure, and the gate exits 1 with `Phase A subprocess failed (linear=0, jira=1, none=1). Aborting.` — a diagnostic that names a subprocess failure when no subprocess was ever spawned for those legs. This fires **before** aggregation and **before** the capture-only short-circuit, so a reduced run yields no report and no verdict in either mode.
  - **The `green` probe** would likewise `grep -c` an absent findings file, whose empty result makes `[ "" -eq 0 ]` a `test(1)` usage error, so the green branch is not taken. Unreachable today because RC collection aborts first.
  - **The leg-completeness check** and **aggregation** count legs off the registered set for the same reason.

**So the honest statement: the guard is sound and the selector's happy path is not.** `--legs` with a proper subset parses correctly, refuses emptiness correctly, and is then refused by a downstream gate with a misleading explanation. That is a fail-CLOSED outcome — no vacuous green is reachable through it — but it is not a working reduced run. Adapting all four surfaces to `SELECTED_LEGS` is STE-452's scope and is recorded in `specs/notes/follow-ups.md` § 0a with the measured evidence.

What pre-flight (0) guarantees is narrower, and is the guarantee that matters here: the loop never proceeds past argument parsing with an empty selection at all. That is why the guard above, not any probe below, is where emptiness is caught.

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

(c) **Linear MCP loadable + STE team visible.** **Scoped to the selection (STE-447): this probe runs only when `linear` is in `SELECTED_LEGS`, and is skipped entirely otherwise.** Delegates to `/smoke-test` pre-flights #3 (Linear MCP available in `~/.claude-st/`) + #5 (Linear team key resolvable). The probe runs once at this top-level rather than letting the Linear child fail mid-spawn — fast-fail saves ~10 min of wall-clock per failed run. NFR-10 canonical refusal (carries the `/smoke-test` probe name verbatim):

```
Linear MCP not loaded or team '<key>' not visible.
Remedy: register the Linear MCP in ~/.claude-st/, verify the team key resolves via mcp__linear__get_team, then re-run /conformance-loop.
Context: skill=conformance-loop, probe=delegated-smoke-test-3+5, tracker=linear, team=<key>
```

(d) **Atlassian MCP loadable + Jira project visible + `--jira-project` passed.** **Scoped to the selection (STE-447 AC.5): this probe — including its `--jira-project`-missing arm — runs only when `jira` is in `SELECTED_LEGS`.** A run that will never spawn the Jira leg has no use for a Jira project key, so requiring one would refuse a perfectly well-formed reduced run; `--legs linear,none` without `--jira-project` must proceed, and does. Delegates to `/smoke-test` pre-flights #7 (Atlassian MCP loadable + OAuth-bound) + #8 (Jira project visible / `--jira-project` flag present). The flag-missing variant fires here, not in the Jira child, so the operator sees the refusal before any subprocess spawn. NFR-10 canonical refusal:

```
Atlassian MCP not loaded or Jira project '<key>' not visible (or --jira-project missing).
Remedy: register the Atlassian Rovo MCP in ~/.claude-st/, complete OAuth via mcp__atlassian__authenticate, pass --jira-project <KEY>, then re-run /conformance-loop.
Context: skill=conformance-loop, probe=delegated-smoke-test-7+8, tracker=jira, project=<key>
```

(e) **Every SELECTED leg's `../dpt-test-project-<leg>` path free OR `--keep` was passed.** **Scoped to the selection (STE-447): the probe iterates `SELECTED_LEGS`, one check per selected leg, rather than the former hardcoded `{linear,jira}` pair.** Delegates to `/smoke-test` pre-flight #2 (existing-test-project refusal) — fired once per selected leg. The per-leg paths are operator-driven-parallelism-safe (different basenames, different MCP configs), but `/conformance-loop` fans out across all of them in one iteration's Phase A and so MUST verify every selected one up front. An unselected leg's directory is deliberately NOT checked: this run will not write into it, and refusing over a directory the run never touches would make `--legs` unusable on any machine with a leftover tree. NFR-10 canonical refusal:

```
Test-project path(s) exist and are non-empty for selected leg(s): <non-empty selected paths>.
Remedy: rm -rf the listed ../dpt-test-project-<leg> directories (or pass --keep at the prior /smoke-test invocation), then re-run /conformance-loop. Only SELECTED legs are checked — narrow the run with --legs to skip a leg whose tree you want to keep.
Context: skill=conformance-loop, probe=delegated-smoke-test-2, selected=[<SELECTED_LEGS>], paths=[<list-of-non-empty>]
```

(f) **`permissions.allow` populated in tracked `.claude/settings.json` AND contains the child-spawn pattern** (Phase 0 pre-flight, STE-252 AC-STE-252.3, strengthened by STE-351 AC-STE-351.1). Read `.claude/settings.json` from the toolkit-repo root, JSON-parse it, and assert that `.permissions.allow` is a non-empty array (`length > 0`) **and** that the array contains the canonical child-spawn pattern literal `Bash(claude:*)`. The tracked allow-list is the audit-able policy artifact that constrains every `claude -p` child the skill spawns; an empty or missing array means the loop would fall back to interactive permission prompts mid-run and stall the hands-off contract, and a populated array that *lacks the spawn pattern* is the M94 false-green the probe was built against — nested `claude` spawns denied headless, grandchildren dying as 0-byte transcripts. A `length > 0` assertion alone does NOT catch that; the probe MUST be a contains-check on the pattern literal. **Narrowed 2026-07-27 (STE-425), and this applies to both drivers:** wherever `permissions.defaultMode` is `auto` — as in the operator's own global `~/.claude-st/settings.json`, measured on both legs — the harness classifier, not the tracked allow-list, is what admits or denies a nested spawn, so an absent pattern does not by itself produce that denial and a present one guarantees nothing at runtime. This refusal is kept regardless, on the two merits that survive the measurement: it holds the scaffold and the tracked list in sync (`/gate-check` probe #62 enforces the same literal at severity ERROR, fail-closed), and the allow-list **is** the operative gate in any checkout whose default permission mode is not `auto`. See `/smoke-test` pre-flight #10 § Why this probe survives for the full re-derivation; the two drivers keep the same decision on the same literal. Probe shape: `jq -e '.permissions.allow | index("Bash(claude:*)")' .claude/settings.json` (index/contains on the spawn-pattern literal), layered on the STE-252 `jq -e '.permissions.allow | length > 0' .claude/settings.json` non-empty check. Empty-or-missing array → NFR-10 canonical refusal:

```
permissions.allow empty or missing in .claude/settings.json.
Remedy: populate the permissions.allow allow-list in tracked .claude/settings.json (Bash command patterns + Edit/Write/Read/Grep/Glob + mcp__linear__* / mcp__atlassian__* MCP tool families covering the /conformance-loop call tree), then re-run /conformance-loop.
Context: skill=conformance-loop, pre-flight=permissions_allow_check, file=.claude/settings.json
```

Non-empty array that lacks the `Bash(claude:*)` spawn pattern → NFR-10 canonical refusal:

```
permissions.allow lacks the child-spawn pattern "Bash(claude:*)" in .claude/settings.json.
Remedy: add "Bash(claude:*)" to the permissions.allow allow-list in tracked .claude/settings.json so the scaffold stays in sync with the tracked policy (gate-check probe #62 enforces the same literal), then re-run /conformance-loop.
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

(h) **Every SELECTED leg's test-project path workspace-trusted (STE-367).** **Scoped to the selection (STE-447): the probe iterates `SELECTED_LEGS` rather than a hardcoded pair** — with the full default selection that is `../dpt-test-project-linear`, `../dpt-test-project-jira` and `../dpt-test-project-none`; with `--legs linear` it is that one path alone. Before any `claude -p` spawn, assert that EVERY selected leg's `../dpt-test-project-<leg>` resolved path carries `hasTrustDialogAccepted == true` in the operator's live `$CLAUDE_CONFIG_DIR/.claude.json`. STE-367 moved workspace-trust seeding out of the autonomous path — the harness auto-mode self-modification classifier denies the programmatic trust write under `claude -p` (2026-07-04 conformance finding F1), so the operator seeds trust **once, up front**, and this pre-flight enforces the precondition before the loop fans out (rather than each `/smoke-test` child hitting the same refusal mid-run, one Phase A leg at a time). Probe shape: `jq -e --arg p "<abs path>" '.projects[$p].hasTrustDialogAccepted == true' "$CFG"` for each resolved path. Either path untrusted → NFR-10 canonical refusal naming the untrusted path(s):

```
Workspace trust missing for <untrusted path(s)> in $CLAUDE_CONFIG_DIR/.claude.json — the scaffolded allow-list would be inert at the child/grandchild layer (2026-07-02 F4), and the /smoke-test child would refuse mid-run.
Remedy: seed workspace trust ONCE for each untrusted path (the driver cannot — the harness self-modification classifier denies the write under claude -p):
  CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude-st}/.claude.json"
  for SEL in ${SELECTED_LEGS}; do
    P="$(cd "../dpt-test-project-${SEL}" && pwd)" || continue
    jq --arg p "$P" '.projects[$p] |= (. // {} + {hasTrustDialogAccepted: true})' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
  done
Then re-run /conformance-loop. The entries persist across runs (operator-owned; /smoke-test teardown no longer removes them).
Context: skill=conformance-loop, pre-flight=workspace_trust_check, paths=[<untrusted>]
```

Each refusal above carries the literal phrase **NFR-10 canonical refusal** in the surrounding prose. There are **12 refusal anchors** in this section: (a)–(e), (g) and (h) carry one each; (0) carries THREE (unknown value, zero selection, unreadable registry) and the STE-351-strengthened (f) carries two (allow-list-empty, spawn-pattern-missing). This restated total is machine-checked against the section rather than hand-maintained — `tests/m121-ste-447-legs-selector.test.ts` recomputes the anchor count and fails if the two disagree, which is why the number above can be trusted. (A whole-section `grep -o 'NFR-10 canonical refusal' | wc -l` reports 14, not 11: this sentence mentions the phrase three more times. The count that means something is the anchor count, and the previous revision of this sentence — which claimed "ten markers … nine refusal anchors" while the section carried nine anchors and thirteen mentions — is why the number is now derived instead of asserted.)

## Flow

The flow is a loop of one or more iterations. Each iteration runs Phase A (parallel `/smoke-test` fan-out + aggregation) and, when `--auto-fix` is set, Phase B (sequential per-finding fixer dispatch). After each iteration, the termination check decides whether to re-iterate or exit. Pre-iteration overhead: Phase 0 pre-approval (once per invocation), then the loop.

### Phase 0 — Pre-approval gate

Print the contract to the operator and prompt for `y` to proceed. The prompt MUST include: the resolved leg selection, which tracker writes that selection implies, the max wall-clock estimate, the max-iterations cap, and auto-fix on/off (resolved value, not the literal flag).

**The wall-clock estimate does not multiply by leg count (STE-447 AC.7).** It is `max-iterations × ~10 min`, full stop. The previous form — `max-iterations × ~10 min × 2 trackers` — was already wrong when it was written and would have become a factor-of-three overstatement under a third leg. The legs are detached concurrent brace groups awaited by one shared bounded poll (§ Leg spawn + bounded poll), so an iteration ends when its SLOWEST leg ends, not when the sum of its legs ends. Adding or removing a leg with `--legs` changes the token cost of a run and does not change its duration; presenting leg count as a time multiplier told the operator that dropping a leg would buy back wall-clock it never spent.

```
/conformance-loop will:
  1. Spawn one parallel /smoke-test subprocess session per SELECTED leg per
     iteration — one --tracker <leg> child for each leg in <SELECTED_LEGS>
     (real Linear writes on the linear leg, real Jira writes on the jira leg;
     the none leg is tracker-less and writes to no tracker at all).
  2. Aggregate per-tracker findings into /tmp/dpt-conformance-loop-<date>-iter-<N>.md
     with cross-tracker dedup.
  3. <auto-fix-line>

Configuration:
  --auto-fix:        <ON|OFF (capture-only)>
  --max-iterations:  <N>
  --legs:            <SELECTED_LEGS>  (default: every registered leg)
  --linear-team:     <STE>            (omitted when linear is not selected)
  --jira-project:    <KEY>            (omitted when jira is not selected)
  Estimated max wall-clock: <max-iterations × ~10 min>
  (leg count does not enter this product — the legs run concurrently)

Tracker-write lines are printed ONLY for the legs actually selected:
Real Linear writes will occur (test project + ~6 issues per iteration).
Real Jira writes will occur in Space <jira-project> (~6 work items per iteration,
all carrying the dpt-smoke label so /smoke-test Phase 5 teardown can transition them).
The none leg performs no tracker writes of any kind.

Proceed? [y/n]
```

When `--auto-fix` is ON, substitute `<auto-fix-line>` with `In Phase B, sequentially dispatch /dev-process-toolkit:spec-write + /dev-process-toolkit:implement per high-severity finding, then re-iterate until termination.`. When `--auto-fix` is OFF, substitute with `Capture-only mode: exit after Phase A of iteration 1 with the aggregated report.`.

**Marker-driven default-apply (STE-226).** Default-apply `y` when the prompt body contains the literal line `<dpt:auto-approve>v1</dpt:auto-approve>` (byte-grep, no inference) — same canonical detection contract used by `/spec-write` § 0b step 4 + § 4 + § 7a. Without the marker, refuse on `n` and on any non-`y` response. On `y` (interactive or marker-driven), log the approval to `/tmp/dpt-conformance-loop-<date>-approval.txt` and proceed to the loop. The marker is the single deterministic mechanism — legacy `Auto Mode Active` system-reminder detection and `claude -p` non-interactive inference are removed (no backward-compat shim per `project_no_users_yet`); `claude -p` invocations without the marker get interactive gating.

### Phase A — Parallel /smoke-test fan-out + aggregation

Each iteration's Phase A spawns one `claude -p /smoke-test ...` subprocess call **per SELECTED leg** — the set pre-flight (0) resolved from `--legs`, which with the flag omitted is every registered leg — in parallel — all detached from a single Bash call, each PID captured to a per-iteration pidfile at `/tmp/dpt-conformance-loop-<date>-iter-<N>-{linear,jira,none}.pid` — then awaits them all via the bounded poll-until-exit discipline below before reading the per-leg findings files. Subprocess output is captured to per-iteration log files at `/tmp/dpt-conformance-loop-<date>-iter-<N>-{linear,jira,none}.log` for forensics.

**The leg set is `SMOKE_LEGS`, and only `SMOKE_LEGS` (STE-446).** Every per-leg enumeration in this skill restates the leg set declared by `adapters/_shared/src/smoke_fixture_groups.ts`. Do not add a leg to one surface only.

**Exactly which enumerations are MACHINE-ENFORCED, and which are not.** `adapters/_shared/src/leg_prose_surfaces.ts` binds five surfaces to the enum, so adding or dropping a leg there turns this document's prose RED until it catches up:

| Enumeration | Bound? |
|---|---|
| the spawn fence's brace groups | **yes** |
| the poll-loop word list | **yes** |
| the pidfile globs (`.pid` paths only) | **yes** |
| the `green` probe's findings-file list | **yes** |
| the closing-summary table's columns | **yes** |
| the per-leg **log** paths (`.log`) | **no** — the pidfile matcher is `.pid`-only |
| the `RC_FILE_*` / `RC_*` family | **no** by prose; covered behaviourally by `driver-gate-fail-open-guards.test.ts`, which drives the rc gate over `SMOKE_LEGS` |
| the Phase 0 operator-contract fence's `--tracker …` list | **no** |

The three unbound rows are stated because an earlier revision of this paragraph claimed the log paths were bound and they are not — measured: stripping every per-leg `.log` reference reds zero surfaces. A reader must be able to tell which enumerations a widened enum will catch and which need updating by hand.

**Parallelism mechanism.** Bash subprocess parallelism, **NOT the agent-team primitive** — agent teams have no `fork: true` flag and aren't recommended for serial orchestration per the Claude Code docs (`https://code.claude.com/docs/en/agent-teams`). Each subprocess is a top-level `claude -p` session, which can invoke skills via the literal-first-line pattern (sub-agents cannot, per docs).

#### Phase-A-entry context probe — LOOP-CTX (STE-414)

**Before the first leg spawn**, run this deterministic stdin-tty probe and read its banner line. It turns the driver's *belief* about its own execution context into an *observed fact* at the decision point — the same probe `/smoke-test` runs at Phase-2 entry (§ Phase-2-entry context probe), mirrored here because `/conformance-loop` is itself a non-tty driver whenever it is spawned or resumed headless:

```bash
# Phase-A-entry context probe — run ONCE and read the banner before any spawn.
if [ -t 0 ]; then
  echo "LOOP-CTX: interactive tty"
else
  echo "LOOP-CTX: headless (claude -p) — background-task notifications will NOT arrive; the ONLY sanctioned wait is the bounded kill-0 poll. Do NOT run_in_background, do NOT Monitor, do NOT yield the turn to await a leg."
fi
```

**HARD GATE — the banner is binding, not advisory (STE-414).** The `[ -t 0 ]` result is the **sole determinant** of headless-vs-interactive for this driver: whatever the probe prints *is* the execution context. A `LOOP-CTX: headless (claude -p)` banner is the common case for an unattended loop, and that classification is **BINDING** for the remainder of the run — it cannot be overridden by any later self-narration, reasoning, or belief to the contrary, no matter how confident. Only a `LOOP-CTX: interactive tty` banner means a human is at the keyboard; the driver may **not** proceed on an "interactive" self-classification while stdin is non-tty.

**The forbidden rationalization is byte-pinned.** The driver MUST NOT self-narrate itself as an **"interactive parent"** — the verbatim 2026-07-24 Jira-leg wording — while stdin is non-tty. That self-narration is forbidden, carries no authority to override the banner, and does NOT re-open any background-wait or turn-yield path: under a headless banner every leg wait MUST use the bounded `kill -0` poll-until-exit loop below — never `run_in_background`, never the `Monitor` tool, never ending the turn to await a completion notification (F3). Advisory prose was the escape hatch that let STE-355 → STE-357 → STE-365 each get narrated past; there is no discretion left here to exercise.

**Headless-gate violation ⇒ abort with full teardown.** If the driver finds it has violated this hard gate — acted on an "interactive" self-classification under a headless banner, spawned a leg via `run_in_background`, reached for `Monitor`, or yielded the turn awaiting a leg — the iteration is void. It MUST abort immediately and run the per-leg teardown for every leg it spawned (the `/smoke-test` `### Phase 5 — Teardown` actions: archive/close the tracker project that leg created and `rm -rf ../dpt-test-project-{linear,jira}`) before exiting, so a violated run never leaves orphaned tracker data or test directories behind (the 2026-07-24 failure mode on both legs). Reap first: before those teardowns run, `kill` every PID recorded in a still-answering pidfile (identity-checked exactly as the `Final-message self-check` clause's reap-first rule requires) and `rm -f /tmp/dpt-conformance-loop-*.pid`, because `rm -rf`-ing a directory a live leg is still writing into races it.

#### Discretionary-halt guard — mid-run judgment calls (STE-414)

**Scope.** Under a `LOOP-CTX: headless` classification, ANY mid-run judgment call the driver would otherwise resolve by asking the operator falls under this guard: a rate-limit / seven-day-usage warning, a cost pause, a reduced-run choice ("spawn one leg instead of two?"), and any new decision of the same shape that the auto-approve marker could not pre-authorize by name. There is no operator on the other end of a headless loop, so every such call MUST resolve deterministically off a single byte-checkable input — the presence of the auto-approve marker literal `<dpt:auto-approve>v1</dpt:auto-approve>` in the invoking prompt body. Two branches, no third.

**Branch 1 — marker present ⇒ proceed.** If the marker `<dpt:auto-approve>v1</dpt:auto-approve>` is present in the invoking prompt body, the judgment call is already pre-authorized: the driver MUST proceed with the FULL iteration — both legs spawned, each leg's whole canonical chain, no self-imposed reduction — and log the decision in passing rather than pausing on it.

**Branch 2 — marker absent ⇒ abort with full teardown.** If the marker is absent, the loop holds no authority to decide for the operator and MUST abort immediately: run the per-leg teardown for every leg it spawned (the `/smoke-test` `### Phase 5 — Teardown` actions — archive/close each leg's tracker project, `rm -rf ../dpt-test-project-{linear,jira}`), then exit non-zero. Abort-with-teardown is the ONLY sanctioned no-marker resolution; parking the iteration mid-run is not one, because it strands exactly the tracker data and test directories that teardown exists to remove. Reap first: before those teardowns run, `kill` every PID recorded in a still-answering pidfile (identity-checked exactly as the `Final-message self-check` clause's reap-first rule requires) and `rm -f /tmp/dpt-conformance-loop-*.pid`, because `rm -rf`-ing a directory a live leg is still writing into races it.

**There is NO prose-ask-then-end-turn path under non-tty.** Stating the question in prose and ending the turn is not a pause under a headless banner — it is a silent no-op: the driver exits rc=0, the legs' canonical chains never run, and the tracker projects are left orphaned. That is the verbatim 2026-07-24 Linear-leg failure: the leg asked the operator a 3-option rate-limit question, ended its turn, and left the Linear project behind with the chain unrun. So under non-tty there is no prose-ask, no end-the-turn-and-await-an-answer, and nothing between Branch 1 and Branch 2 to exercise discretion over.

**Phase 0's pre-approval `[y/n]` gate is UNAFFECTED.** That gate fires *before* the loop starts and is already marker/refusal-routed (§ Phase 0 — Pre-approval gate). This guard governs only judgment calls that surface *after* an iteration is under way.

#### Leg spawn + bounded poll

**Reference snippet** — Phase A spawn (per iteration):

```bash
ITER=<N>
DATE=$(date +%Y-%m-%d)
LOG_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.log
LOG_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.log
LOG_NONE=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-none.log
PID_FILE_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.pid
PID_FILE_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.pid
PID_FILE_NONE=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-none.pid
RC_FILE_LINEAR=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.rc
RC_FILE_JIRA=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.rc
RC_FILE_NONE=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-none.rc
# STE-420: run-start in epoch ms (the Phase 0 acceptance moment). It is the
# freshness gate for the per-leg verdict artifacts reconciled below — an
# artifact older than this is a previous run's leftover, never this run's
# verdict, and reconciles to non-zero.
RUN_START_MS=$(($(date +%s) * 1000))
PLUGIN_DIR="$(pwd)/plugins/dev-process-toolkit"   # cwd is the toolkit repo (verified by pre-flight (a))
export CLAUDE_CONFIG_DIR=~/.claude-st             # STE-350: exported once per spawning block so every spawn line begins bare with `claude` and the tracked `Bash(claude:*)` allow entry matches.

# STE-447: one brace group per REGISTERED leg is written out below, but a
# group is spawned only when its leg is present in ${SELECTED_LEGS}. Skip the
# whole group — brace group, pidfile write and rc reconciliation together — for
# any leg the selection excludes; do not spawn it and then discard its result.
# The groups stay written out per registered leg rather than collapsed into a
# loop because the enum-derived assertions in leg_prose_surfaces.ts read this
# fence's per-leg groups; the runtime leg registry that would retire them is
# recorded as deferred scope in specs/notes/follow-ups.md.
#
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
  RC_RAW_LINEAR=$?
  # STE-420: `claude -p` hands back 0 for any session that finishes, so this
  # leg's exit status cannot carry its verdict. Reconcile the raw status
  # against the leg's own verdict artifact and persist THAT as the rc — a
  # `fail`/`abort` outcome, a missing artifact, a malformed one, or a stale
  # one all reconcile to non-zero, and a real non-zero status is never
  # downgraded. Every documented rc-file consumer below keeps its shape.
  bun "${PLUGIN_DIR}/adapters/_shared/src/smoke_verdict.ts" reconcile \
    --rc "${RC_RAW_LINEAR}" \
    --artifact /tmp/dpt-smoke-verdict-linear.json \
    --run-start "${RUN_START_MS}" > "${RC_FILE_LINEAR}"
} &
PID_LINEAR=$!; echo $! > "${PID_FILE_LINEAR}"

{
  claude -p "/smoke-test --tracker jira --jira-project ${JIRA_PROJECT}" \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_JIRA}" 2>&1 <<'PROMPT_EOF'
<dpt:auto-approve>v1</dpt:auto-approve>
PROMPT_EOF
  RC_RAW_JIRA=$?
  # STE-420: same reconciliation on this leg — the jira artifact, never the
  # linear one, so the two legs' verdicts can never cross (STE-423 scoping).
  bun "${PLUGIN_DIR}/adapters/_shared/src/smoke_verdict.ts" reconcile \
    --rc "${RC_RAW_JIRA}" \
    --artifact /tmp/dpt-smoke-verdict-jira.json \
    --run-start "${RUN_START_MS}" > "${RC_FILE_JIRA}"
} &
PID_JIRA=$!; echo $! > "${PID_FILE_JIRA}"

{
  claude -p "/smoke-test --tracker none" \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${LOG_NONE}" 2>&1 <<'PROMPT_EOF'
<dpt:auto-approve>v1</dpt:auto-approve>
PROMPT_EOF
  RC_RAW_NONE=$?
  # STE-420 + STE-446: same reconciliation on the tracker-less leg — its own
  # artifact, never another leg's, so no two legs' verdicts can cross
  # (STE-423 scoping, stated for N legs).
  bun "${PLUGIN_DIR}/adapters/_shared/src/smoke_verdict.ts" reconcile \
    --rc "${RC_RAW_NONE}" \
    --artifact /tmp/dpt-smoke-verdict-none.json \
    --run-start "${RUN_START_MS}" > "${RC_FILE_NONE}"
} &
PID_NONE=$!; echo $! > "${PID_FILE_NONE}"

echo "detached: linear=${PID_LINEAR} jira=${PID_JIRA} none=${PID_NONE} — poll until all exit"
```

> ⛔ **FORBIDDEN at this spawn site.** Do NOT await either leg with the Bash tool's `run_in_background` parameter, the `Monitor` tool, or by ending the turn "waiting for the completion notification" — under `claude -p` the notification never arrives (F3, 2026-07-04 conformance run: both legs fire-and-exited at this exact `{ claude -p ... } &` spawn). Nor does self-narrating as an "interactive parent" re-open any of those paths — the Phase-A-entry `[ -t 0 ]` LOOP-CTX result is the sole determinant, a headless classification binds this spawn site for the rest of the run, and no self-classification, however phrased, overrides it. The ONLY sanctioned wait is the bounded `kill -0` poll-until-exit loop below, run in the foreground.

**Bounded poll-until-exit (repeated bounded Bash calls).** After the spawn call returns, poll until both PIDs exit — the same STE-355 discipline the smoke driver's Phase 2 uses for its grandchildren (`/smoke-test` § Grandchild spawn lifecycle). Each poll call is a **bounded multi-iteration loop** iterating both legs' pidfiles inside the same loop — up to 18 checks 30 s apart, ≈ ≤540 s (≈ 9 min) per call, safely under the harness's 600 s (10-minute) per-call ceiling. That is one Bash call per ~9 min instead of ~80 single-check calls across a 40-minute leg; the old single-check-then-end-call shape is **not** sanctioned. Never fold the whole wait into one unbounded call:

```bash
# One bounded poll call — up to 18 checks × 30 s ≈ 9 min (≤540 s), under the
# harness's 600 s per-call ceiling. Repeat until it reports every leg exited.
# (Fresh shell per Bash call: re-derive DATE/ITER first.)
# The word list below IS the registered leg set (SMOKE_LEGS) — keep it in step.
for i in $(seq 1 18); do
  LIVE=""
  for LEG in linear jira none; do
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
if [ -n "${LIVE}" ]; then echo "still running:${LIVE} — poll again"; else echo "every leg exited — collect RCs"; fi
```

**RC collection (after the poll loop reports both legs exited).** Read each leg's rc-file — written by its brace group as the leg exited, carrying the *verdict-reconciled* status rather than the raw `claude -p` one (STE-420) — and abort on any non-zero. A missing rc-file after exit is treated as a failure, and so is an unreadable one: what the gate compares must be a plain integer, validated after the read rather than assumed by it. `cat` **succeeds** on a file that exists but is empty, so a `|| echo 1` fallback fires only on a missing file and leaves the variable empty for every other bad shape — and `[ "" -ne 0 ]` is a `test(1)` usage error whose non-zero status *skips* the abort branch, so the gate fails open on exactly the input it exists to catch. That input is reachable: the rc-file is created by the shell redirect **before** `bun` runs, so any invocation producing no stdout — bun missing, a module throw, a bad flag — leaves 0 bytes behind, and a partial or diagnostic write leaves something that is not a number. The integer check below folds all three into a failure with one predicate:

```bash
RC_LINEAR=$(cat "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.rc" 2>/dev/null)
RC_JIRA=$(cat "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-jira.rc" 2>/dev/null)
RC_NONE=$(cat "/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-none.rc" 2>/dev/null)

# Anything that is not a plain integer — absent, empty, truncated, a stray
# diagnostic — is a FAILED READ, never a zero. Both bad shapes reach `[ … -ne
# 0 ]` as a usage error, whose non-zero status skips the branch below.
case "${RC_LINEAR}" in ''|*[!0-9]*) RC_LINEAR=1 ;; esac
case "${RC_JIRA}"   in ''|*[!0-9]*) RC_JIRA=1 ;; esac
case "${RC_NONE}"   in ''|*[!0-9]*) RC_NONE=1 ;; esac

# STE-359: before acting on any failure here, run the orphan-adoption scan
# below — a dead driver can leave live grandchildren whose completed
# captures are recoverable.
if [ "${RC_LINEAR}" -ne 0 ] || [ "${RC_JIRA}" -ne 0 ] || [ "${RC_NONE}" -ne 0 ]; then
  echo "/conformance-loop: Phase A subprocess failed (linear=${RC_LINEAR}, jira=${RC_JIRA}, none=${RC_NONE}). Aborting."
  exit 1
fi
```

Each value read here was already reconciled against that leg's verdict artifact at `/tmp/dpt-smoke-verdict-<tracker>.json` by the spawn wrapper above (`adapters/_shared/src/smoke_verdict.ts`, STE-420). A non-`pass` outcome, an absent artifact (the leg died before writing one), a malformed one, and a stale one whose mtime predates run-start — fresh means an mtime at or after `RUN_START_MS` — each map to their own non-zero code, and a genuinely non-zero process status is never downgraded to 0. That is why this gate can keep its documented shape: it still just aborts on any non-zero, but the number it reads is now the leg's real verdict instead of the 0 `claude -p` returns for every session that finishes (2026-07-27: both legs declared failure in prose and both rc-files held `0`, so this gate was dead code).

**Why detached + poll, not a same-call wait (STE-355 backfill).** A single foreground Bash call caps at the harness's **600 s (10-minute) per-call ceiling** — the same ceiling that SIGTERM'd the 2026-07-02 `/implement` grandchild (F2). With the smoke driver's STE-355 poll wrapper in place, each `/smoke-test` child genuinely awaits its grandchildren (~10+ minutes per leg), so the old spawn shape — foreground-`wait`ing both PIDs inside the spawn call (`wait "${PID_LINEAR}"; wait "${PID_JIRA}"`) — is guaranteed to hit that ceiling and truncate both legs. The spawn call detaches and returns immediately; the bounded poll above is how Phase A waits.

**Residual risk — PID reuse.** `kill -0` answers for *any* live process with that PID, so a recycled PID could in principle keep a leg's poll looping after the child exited. Negligible at a 30 s poll interval, and the leg-completeness check below is the corroborating signal (a truncated leg fails the log-set verification regardless of what the poll believed) — noted so the wrapper isn't mistaken for a liveness proof. That negligible-risk reading covers the polling loop only — a false positive there merely keeps a leg's poll running. It does not carry to the abort branch's reap below, which sends a real signal: a recycled PID there would terminate an unrelated process, which is exactly why the reap must confirm identity with `ps` before it signals anything.

**Live-pidfile session rule.** Ending the session — or reporting iteration results — while either leg's pidfile still answers `kill -0` is **forbidden**; the bounded poll loop above is the only sanctioned wait. Do not fire the spawns and end the turn "waiting for a completion notification" — a `-p` session cannot resume on background-task notifications, so the rest of the run silently never executes (the fire-and-exit shape, F3). The poll's exit branch removes each pidfile, so a clean Phase A leaves zero live pidfiles.

**Red flag — the harness's foreground-sleep block hint is NOT license to background the wait.** If a poll call leads with `sleep`, the harness blocks it with an error hint that reads roughly "Foreground `sleep` is blocked. To wait for a condition, use `run_in_background` or the Monitor tool." Do **not** follow that hint here: handing the wait to `run_in_background`/Monitor and then ending the turn IS the F3 fire-and-exit failure — a `-p` driver session never receives the completion notification, so the rest of the iteration silently never executes. The bounded poll loop above already avoids the block by gating each iteration on `kill -0` *before* its `sleep 30`; keep waiting with that loop, in the foreground, until both legs' pidfiles die.

**Final-message self-check (STE-357, hardened by STE-414).** Before emitting **any** final message — success or failure — run the pidfile-liveness fence below over the run's pidfile glob (`/tmp/dpt-conformance-loop-*.pid`). Two triggers arm this check: (1) an *incomplete leg chain* — a spawned leg did not run its canonical chain to completion; (2) *any live pidfile* — a spawned leg is still running. On either trigger the driver MUST loudly abort — emit an explicit `LOOP-ABORT: <trigger>` line as the first line of the final message. The abort MUST exit non-zero — a loud `LOOP-ABORT:` banner is not sufficient, because rc is one of several corroborating signals the operator reads — the per-skill log set the leg-completeness check verifies is another — and a false green must never be reported in the exit code. Signal only what this run spawned: for each PID recorded in a still-answering pidfile, confirm its identity with `ps -p <pid> -o comm=` and reap it only when that reports a `claude` process, because a PID recycled since the `kill -0` probe would otherwise take a real signal aimed at an unrelated process on the operator's machine. The abort MUST reap FIRST, before anything destructive runs: `kill` every PID recorded in a still-answering pidfile, then `rm -f /tmp/dpt-conformance-loop-*.pid`, so the invariant closing this paragraph holds on the abort branch instead of being aspirational. Only once that reap is done may the driver run the per-leg teardown in full (the `/smoke-test` `### Phase 5 — Teardown` actions: archive/close each leg's tracker project, `rm -rf ../dpt-test-project-{linear,jira}`) before the turn ends — quiesce both legs first, then destroy the state they were writing into, because tearing down around a live leg races it: the leg can still be writing into the directory being removed and still posting to the project being archived. A live pidfile must **never end the turn** quietly: if the leg is still pollable, resume the bounded poll loop above and finish it; if it is not, take the abort-with-teardown path. The two branches are ordered, not discretionary — *resume* is available only while the legs can still be polled to completion **in this same turn**, and taking it means no final message is emitted at all; the moment finishing is off the table (the session is ending, a leg is unpollable, or the remaining work would be picked up in a later turn) the abort-with-teardown path above is the only move left. There is no third branch in which the turn ends while a leg's pidfile still answers `kill -0`.

Exiting rc=0 is not proof the legs ran their chains. This driver must NEVER exit rc=0 silently with an unfinished leg chain or a live leg — a silent rc=0 exit under either trigger IS the failure mode this clause exists to stop (2026-07-24: both conformance legs exited rc=0 in ~8 min without running the chain and left orphaned tracker data behind). A silent success exit is legal only when both legs' canonical chains completed AND zero pidfiles still answer `kill -0`. Stated unqualified, with no adverb left to argue over: the driver must never exit rc=0 on the abort branch, under either trigger, loud or not.

The same runtime limit applies here, one layer up. A `claude -p` session cannot set its own exit status — the harness returns 0 for any session that finishes — so neither a leg's rc nor this driver's own can carry a verdict by itself (2026-07-27: both legs declared failure in prose, the Jira one leading with `SMOKE-ABORT: incomplete grandchild chain`, while both rc-files held `0`). Each leg's verdict artifact at `/tmp/dpt-smoke-verdict-<tracker>.json` — `linear` and `jira`, written by that leg's `/smoke-test` final-message self-check — is therefore the authoritative record of its outcome, and the Phase A spawn wrapper above reconciles it into the rc-file the RC-collection gate reads (`adapters/_shared/src/smoke_verdict.ts`, STE-420). This driver's own abort is bound by the same rule: emit the `LOOP-ABORT:` banner, and grade the iteration off the reconciled rc-files and the artifacts behind them rather than off a status the process is not the one setting.

```bash
# Final-message self-check — run before ANY final message (success or failure).
setopt local_options null_glob 2>/dev/null || shopt -s nullglob 2>/dev/null || true
LIVE=""
for PIDFILE in /tmp/dpt-conformance-loop-*.pid; do
  [ -e "${PIDFILE}" ] || continue
  kill -0 "$(cat "${PIDFILE}")" 2>/dev/null && LIVE="${LIVE} ${PIDFILE}"
done
if [ -n "${LIVE}" ]; then echo "LIVE:${LIVE} — finish the bounded poll loop, or abort loudly, confirm each recorded PID is still a claude process before signalling it, reap these pidfiles, THEN run the per-leg teardown, and exit non-zero; never exit rc=0"; else echo "no live pidfiles — final message may be emitted (only if both legs' canonical chains completed)"; fi
```

**Fail-fast on subprocess error.** If either leg's rc-file reports non-zero (or is missing after exit), the iteration aborts — no aggregation, no Phase B dispatch, no re-iteration — once the orphan-adoption scan below has run (STE-359: any surviving grandchildren are adopted and polled to exit first, so their completed captures are preserved as evidence before the abort). Forensics live in the per-iteration log files. The operator decides whether to re-run after fixing the underlying cause.

**Orphan adoption (STE-359; iter-2 F3).** A leg's driver can die while its grandchildren live on. Post-exit — before declaring the leg failed via the fail-fast above or the completeness check below — scan that leg's per-skill pidfiles at `/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.pid` (with `<tracker>` = `linear` / `jira` per leg); any pidfile whose PID still answers `kill -0` is an orphaned grandchild the parent **adopts**: poll it to exit with the same STE-357 bounded multi-iteration discipline as the leg poll above (up to 18 `kill -0` checks 30 s apart per Bash call, repeated calls until every adopted PID exits) before the leg-completeness check runs.

An adopted grandchild that completes contributes its capture to the leg-completeness check — the leg may still fail on its other missing captures; adoption recovers **evidence, not the chain**. Iter-2 precedent: the orphaned Jira `/setup` grandchild completed healthily on its own after its driver died — adoption turns that manual save into procedure.

**Residual risk — orphan-vs-killed nondeterminism (STE-359; iter-2 F3).** When a leg's driver dies with live grandchildren, whether a grandchild dies with its driver or survives as an orphan is environment-nondeterministic — process-group inheritance varies with spawn nesting, and iter-2 observed both outcomes in one run (the Linear `/setup` grandchild was killed with its parent while the Jira one survived and completed healthily). Process-group discipline (`setsid` / PGID-wide kill) was considered and rejected as the primary mechanism: it is OS/shell-dependent and unverifiable from SKILL.md prose. The adoption block above is the deterministic recovery — deterministic-by-construction at the layer this parent controls, it recovers a surviving orphan's capture regardless of which way the environment broke.

**Leg-completeness check (STE-355 mirror).** RC 0 alone is not proof a leg ran its chain — the 2026-07-02 run had both children fire grandchild spawns in the background and exit RC 0 "waiting for its completion notification". So after both children return, and before aggregation, Phase A verifies each leg's expected grandchild log set is complete and result-bearing: every log in `/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.log` (with `<tracker>` = `linear` / `jira` per leg) must exist, be fresh (mtime not before run-start — see the freshness gate below), be non-empty, and carry a stream-json `result` event. A leg whose log set is incomplete — or whose final message matches the fire-and-exit shape (grandchild spawned in the background, child exits awaiting a completion notification it can never receive) — is treated as a failed leg **regardless of RC 0**, and the iteration aborts via the same fail-fast path as a non-zero RC: no aggregation, no Phase B dispatch, no re-iteration; forensics live in the per-iteration and per-skill log files.

**Freshness gate (STE-358; iter-2 F2).** The leg-completeness check is freshness-gated on the **run-start timestamp** captured at Phase 0 acceptance (the epoch-ms moment this invocation's pre-approval was logged): pass it as the `runStart` argument to `assertChainIntegrity` (`adapters/_shared/src/smoke_child_capture.ts`), so a log whose mtime predates run-start is the pinned `capture stale (pre-run)` finding — stale, never healthy, and it can never satisfy the completeness check regardless of its content. Result-bearing alone is not enough: the iter-2 (2026-07-02) run's surviving morning log carried a `result` event and would have false-passed an ungated check. The gate is strictly `mtime < run-start`; a log written exactly at run-start is fresh.

**Path-safety guard delegated to children.** Per-tool-call enforcement now lives in the tracked `permissions.allow` allow-list (`.claude/settings.json`, STE-252) — every `claude -p` child runs in default permission mode and is constrained to the union of patterns enumerated there (Bash command-pattern entries + `Edit`/`Write`/`Read`/`Grep`/`Glob` + `mcp__linear__*` / `mcp__atlassian__*`). Each `/smoke-test` child still runs its own pre-flight #6 (the `realpath`-based allow-list check that pins the resolved test-project path to one of `{dpt-test-project-linear, dpt-test-project-jira}` under a `workspace/` ancestor, not a symlink, not the toolkit repo itself), but that guard is now a **cwd guard** — it bounds the **spawn working directory** each child starts in, not where the writes it issues from there land, while the tracked `permissions.allow` block bounds *what* they can call. `/conformance-loop` does not duplicate the realpath cwd guard at the parent — pre-flight (a) verifies the parent cwd is the toolkit repo, the Phase 0 `permissions.allow` pre-flight (refusal (f)) verifies the policy artifact is populated, and the child's #6 fires before any side effects. The realpath check no longer carries the "bypass-justification" load-bearing role it had pre-STE-252; it remains for cwd hygiene only.

**Aggregation.** After both children return, read the per-tracker findings files at the existing canonical paths (no `/smoke-test` changes):

- `/tmp/dpt-smoke-findings-${DATE}-linear.md` — Linear-side findings.
- `/tmp/dpt-smoke-findings-${DATE}-jira.md` — Jira-side findings.
- `/tmp/dpt-smoke-findings-${DATE}-none.md` — tracker-less-leg findings.

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

#### Transient-failure retry for leg spawns (STE-430)

The Phase A legs are prompt-bearing `claude -p` children, so they carry the same upstream exposure the smoke driver's Phase 2 grandchildren do: a leg can die mid-response on `API Error: Stream idle timeout` or on `API Error: Connection closed mid-response`. The 2026-07-27 run hit the second signature inside a leg (its `/setup` grandchild exited `is_error: true` with `terminal_reason: "api_error"` having written nothing at all). Phase A therefore mirrors `/smoke-test` § Transient-failure retry-with-rollback instead of grading either signature as a leg failure on sight — every prior driver hardening ships to both drivers, and this contract is no exception.

**Detection.** After the bounded poll reports a leg exited, and before the RC-collection gate above grades it, scan that leg's log (`/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-${LEG}.log`) for either signature with `grep -qE 'API Error: (Stream idle timeout|Connection closed mid-response)'`. Match is substring, so wording drift in the trailing detail still trips it. A hit makes the leg *eligible* for one retry; it does not by itself authorize one.

**Clean-tree gate (the precondition that authorizes a retry).** After the failed leg exits and BEFORE any rollback or re-spawn, read `git status --porcelain` inside that leg's own test project (`../dpt-test-project-linear` / `../dpt-test-project-jira`) — NEVER inside the dpt repo cwd, whose in-flight conformance edits are always dirty and would suppress every retry. Empty output ⇒ the failed leg left nothing behind, the rollback is provably a no-op, and the leg re-spawns once. Non-empty output ⇒ dirty tree, no auto-retry: grade the leg failed through the ordinary fail-fast path and quote the porcelain lines in the iteration's report, because a rollback whose blast radius is unknown is not a rollback the driver may run unattended.

The probe MUST exclude the `.phase8/` pathspec, and on a leg the exclusion is load-bearing rather than cosmetic. A leg spans the whole smoke run, so it can die on a transient during Phase 8 or Phase 9 — by which point `/smoke-test` has prepared its per-skill Socratic workspaces at `.phase8/<skill>/` inside that same test-project git repo. An unfiltered probe reads that scratch as a dirty tree and forfeits the leg's one retry over work the failed leg did nothing to cause. The gate's question is whether the failed attempt left work behind; the driver's own scratch is not an answer to it.

```bash
# Run from the leg's OWN test project cwd, NEVER from the dpt repo cwd.
# Capture stdout AND the exit status: a failed probe prints nothing, so testing
# stdout alone would read a git failure as a clean tree and authorize the
# rollback. An unusable probe is not a clean tree.
dirty=$(git status --porcelain -- . ':(exclude).phase8'); probe_rc=$?   # probe first — before any rollback
if [ "$probe_rc" -ne 0 ] || [ -n "$dirty" ]; then
  echo "leg=${LEG} transient_dirty_tree — no auto-retry"; echo "$dirty"
else
  git clean -fdq -e .claude -e .mcp.json && git checkout -- .
  # re-spawn this leg once with ITS OWN tracker arguments (STE-423), then re-poll.
fi
```

**Per-attempt captures — attempt 1's log must survive attempt 2.** Each attempt redirects into its OWN capture, `/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-${LEG}.attempt1.log` and `/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-${LEG}.attempt2.log`, never into one shared leg log opened with a truncating `>`: a re-spawn that overwrites attempt 1's capture destroys the evidence the audit row below reports, which is exactly why the 2026-07-27 leg failure could only be corroborated from a per-attempt log that happened to survive out of band. Both stay on disk for the whole iteration, kept separate by construction, and once the retry settles the driver copies the winning attempt's capture over the canonical leg log (`/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-${LEG}.log`) so the RC-collection gate, the leg-completeness check and the findings pass all still read one canonical path per leg.

**Retry audit row (parity with `/smoke-test` § Retry audit row).** A retried leg appends a `leg_transient_retried` row to that leg's canonical log recording BOTH attempts — each one's UTC ISO-8601 start, its own outcome, and its own capture path — and the iteration's report carries the same two lines, so a widened retry stays visible in the run's audit trail instead of being absorbed into a green iteration. The outcome vocabulary names WHICH transient fired (`transient_stream_idle` / `transient_connection_closed`, alongside the `transient_dirty_tree` value the clean-tree gate emits) instead of assuming the stream-idle class the smoke driver started from. Template:

```
2026-07-27T06:42:11Z leg_transient_retried leg=linear attempts=2 transient=connection_closed
  attempt_1_started=2026-07-27T06:40:07Z attempt_1_exit=transient_connection_closed
  attempt_1_capture=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.attempt1.log
  attempt_2_started=2026-07-27T06:42:33Z attempt_2_exit=success
  attempt_2_capture=/tmp/dpt-conformance-loop-${DATE}-iter-${ITER}-linear.attempt2.log
```

A second transient on the same leg fails the iteration through the ordinary fail-fast path with that same two-attempt row — both `attempt_N_exit` values naming their own transient kind, both capture paths quoted so the operator can read either attempt's evidence.

**Retry budget.** Exactly **one** retry per leg (two attempts total), the same bound the smoke driver carries; a second transient on the same leg is genuine and takes the double-transient path above rather than looping. Eligibility turns on the failed attempt's tree state, never on the error class alone — the clean-tree gate above, not the signature list, is what authorizes the second attempt. A re-spawned leg keeps its own tracker scope — the linear leg re-spawns with the linear arguments and reconciles the linear verdict artifact, never the jira ones (STE-423).

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
export CLAUDE_CONFIG_DIR=~/.claude-st   # STE-350: exported once per spawning block so every spawn line begins bare with `claude` and the tracked `Bash(claude:*)` allow entry matches.
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

(a) **`green`** — **every** per-leg findings file has zero `**Severity:** high` lines. The file list below is the registered leg set (`SMOKE_LEGS`); a leg missing from it is a leg whose high-severity findings can never bar green:

```bash
HIGH_LINEAR=$(grep -c '^\*\*Severity:\*\* high' /tmp/dpt-smoke-findings-${DATE}-linear.md)
HIGH_JIRA=$(grep -c '^\*\*Severity:\*\* high' /tmp/dpt-smoke-findings-${DATE}-jira.md)
HIGH_NONE=$(grep -c '^\*\*Severity:\*\* high' /tmp/dpt-smoke-findings-${DATE}-none.md)
if [ "${HIGH_LINEAR}" -eq 0 ] && [ "${HIGH_JIRA}" -eq 0 ] && [ "${HIGH_NONE}" -eq 0 ]; then
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

| iter | status   | high (linear) | high (jira) | high (none) | medium (linear+jira+none) | fixer-changes | wall-clock |
|------|----------|---------------|-------------|-------------|---------------------------|---------------|-----------|
|    1 | running  |             3 |           2 |           1 |                         4 |             2 | 11m 14s   |
|    2 | running  |             1 |           1 |           0 |                         3 |             2 | 10m 47s   |
|    3 | green    |             0 |           0 |           0 |                         2 |             — | 10m 02s   |

Termination reason: green (zero **Severity:** high lines in every per-leg findings file)

Artifacts:
- iter-1: /tmp/dpt-conformance-loop-<date>-iter-1.md
- iter-2: /tmp/dpt-conformance-loop-<date>-iter-2.md
- iter-3: /tmp/dpt-conformance-loop-<date>-iter-3.md
- linear logs: /tmp/dpt-conformance-loop-<date>-iter-*-linear.log
- jira logs:   /tmp/dpt-conformance-loop-<date>-iter-*-jira.log
- none logs:   /tmp/dpt-conformance-loop-<date>-iter-*-none.log
- approval:    /tmp/dpt-conformance-loop-<date>-approval.txt

Open questions / risks / inconsistencies:
- (rendered from capability-key map; see § Capability-key map)
```

One `high (<leg>)` column per registered leg (`SMOKE_LEGS`), and the `medium` column names every one of them — a leg without a column is a leg whose findings the operator never reads off this table.

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
- `/tmp/dpt-conformance-loop-<DATE>-iter-<N>-{linear,jira,none}.log` — per-iteration child stdout/stderr.
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

### Inherited precondition — workspace trust (STE-356; STE-367)

The tracked `permissions.allow` allow-list that `/smoke-test`'s threat model leans on as its load-bearing rail is enforcement-effective only when the spawn cwd's workspace is trusted — in an untrusted workspace the harness ignores the scaffolded `.claude/settings.json` entries wholesale and the policy artifact goes inert. Workspace trust is an operator precondition (STE-367 supersedes STE-356's self-seed): the operator seeds `hasTrustDialogAccepted: true` for each test-project path into `$CLAUDE_CONFIG_DIR/.claude.json` once — the driver cannot, since the harness self-modification classifier denies the write under `claude -p` (2026-07-04 F1) — and pre-flight (h) above asserts both paths are trusted before the loop fans out, with each `/smoke-test` child's spawn gate re-asserting. The counterexample is the 2026-07-02 conformance run's F4 capture: grandchild logs opened with `Ignoring 10 permissions.allow entries from .claude/settings.json: this workspace has not been trusted`, so the canonical chain ran on auto-mode classifier goodwill instead of the reviewed policy. Every leg this loop fans out inherits that precondition; the `checkAllowlistInert` post-return detector in `/smoke-test` surfaces any recurrence as a high-severity `STE-356 regression: allow-list inert — <child> (workspace untrusted)` finding, which bars the leg from green.

### Residual risks (not protected against)

- **Runaway tracker writes.** Each iteration creates a fresh test project (Linear) + ~6 work items (Jira). At `--max-iterations 3`, a fully-iterating run creates ~18 work items per tracker. Operator must run the manual sweep (`/smoke-test` Phase 5 teardown handles the per-iteration cleanup, but the operator should verify post-run).
- **Driver-side caveats slip through.** If a driver-side caveat is misclassified as `high` (operator misjudgement at smoke-test authoring time), Phase B will dispatch on it. Mitigation: the high-severity convention is documented in `/smoke-test`'s findings template; the operator should fix the misclassification at the source rather than working around it here.
- **Loop-induced spec drift.** Each iteration's `/implement` commits land on the toolkit repo; if multiple iterations accumulate before the operator reviews, spec drift may accumulate. Mitigation: operator should review after each `/conformance-loop` run before re-running.
