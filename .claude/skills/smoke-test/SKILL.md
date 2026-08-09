---
name: smoke-test
description: Spawn a fresh Bun project under ../dpt-test-project-<tracker> and drive the dev-process-toolkit plugin's full skill chain (/setup → /spec-write → /implement → /gate-check → /spec-review → /simplify) via claude-st -p child sessions, capturing findings. Pre-release sanity check, not CI. Real Linear or Jira writes on the tracker legs (per `--tracker`), no tracker surface at all on the tracker-less leg, ~10 min wall-clock. Multi-terminal tandem runs (one per leg) are supported.
argument-hint: '[--tracker linear|jira|none] [--jira-project KEY] [--keep] [--linear-team STE] [--feature-stub greet]'
disable-model-invocation: true
---

# /smoke-test

Drive the dev-process-toolkit plugin end-to-end against a freshly-scaffolded Bun project, capturing functional gaps that only manifest at runtime in a fresh checkout. **This is a project-local skill** — it lives in `.claude/skills/smoke-test.md` of the dev-process-toolkit repo, not in the plugin itself. Downstream users never see it.

This is the autonomous variant: the parent claude session spawns `claude-st -p` children, captures their output, and writes findings + a teardown checklist. The skill drives **exactly one** leg per invocation: the Linear path (default, `--tracker linear`), the Jira path (`--tracker jira --jira-project <KEY>`), or the tracker-less path (`--tracker none`). The canonical chain (`/setup → /spec-write → /implement → /gate-check → /spec-review → /simplify`) is identical on every leg; only Phase 1 (project setup) and Phase 5 (teardown) branch on `--tracker`. Per-run findings live at `/tmp/dpt-smoke-findings-<date>-<tracker>.md`; that's the persistent audit trail.

**The tracker-less leg is not a degraded tracker leg (STE-448).** `mode: none` is the DEFAULT configuration for every project this toolkit bootstraps — `/setup` never writes a `mode: none` line, because ABSENCE of a `## Task Tracking` section IS none — so it is the toolkit's most common downstream shape. It exercises a genuinely different set of code paths: identity is minted locally rather than allocated remotely, the milestone is an opaque `M_<tail>` token rather than a sequential number, and release is proved by the deletion of a lock file rather than by a ticket transition. What it skips is the tracker surface, not the chain: no MCP pre-flight, no MCP config, no tracker workspace, and a Phase 5 teardown that removes a directory and calls no tracker at all.

Every per-run artifact is keyed on the resolved `<tracker>` — which is one of the legs `SMOKE_LEGS` registers in `adapters/_shared/src/smoke_fixture_groups.ts`, never a set restated here: the test-project basename is `../dpt-test-project-<tracker>`, the findings file is `/tmp/dpt-smoke-findings-<date>-<tracker>.md`, per-skill logs are `/tmp/dpt-smoke-<tracker>-<skill>.log`, grandchild pidfiles are `/tmp/dpt-smoke-<tracker>-<skill>.pid` (globbed as `/tmp/dpt-smoke-<tracker>-*.pid`), the rc / start / attempt markers are `/tmp/dpt-smoke-<tracker>-<skill>.{rc,start,attempt<N>.log}`, the verdict artifact is `/tmp/dpt-smoke-verdict-<tracker>.json`, the wrapped MCP config is `/tmp/dpt-smoke-mcp-config-<tracker>.json` (tracker legs only — the tracker-less leg constructs none), the approval record is `/tmp/dpt-smoke-<date>-<tracker>-approval.txt`, and Phase 8 transcript fixtures are `tests/fixtures/socratic-first-turn/<skill>-<tracker>-<YYYY-MM-DD>.json`. That shared `<tracker>` segment — not the calendar day, and not luck — is what makes the multi-terminal tandem run (§ Operator-driven parallelism, below) safe.

## When to use

- Before `/ship-milestone M<N>` runs, as a pre-release sanity check.
- After landing any FR that touches `skills/setup/SKILL.md`, `skills/spec-write/SKILL.md`, `skills/implement/SKILL.md`, `skills/gate-check/SKILL.md`, `skills/spec-archive/SKILL.md`, or any of the `templates/` files.
- Not for every commit, not in CI — this is slow (~10 minutes wall-clock per tracker; ~11–14 min wall-clock for a tandem run, see § Operator-driven parallelism) and produces real Linear/Jira writes.

## Operator-driven parallelism

One `/smoke-test` invocation per registered leg may run **concurrently, one per terminal**, without filesystem collision or artifact-overwrite races. Per-tracker artifact isolation makes this safe by construction:

- `--tracker linear` writes to `../dpt-test-project-linear`, to `/tmp/dpt-smoke-linear-*.{log,pid,rc,start,attempt}`, `/tmp/dpt-smoke-mcp-config-linear.json`, `/tmp/dpt-smoke-verdict-linear.json`, `/tmp/dpt-smoke-findings-<date>-linear.md` and `/tmp/dpt-smoke-<date>-linear-approval.txt`, and to `tests/fixtures/socratic-first-turn/<skill>-linear-<YYYY-MM-DD>.json`.
- `--tracker jira --jira-project <KEY>` writes to `../dpt-test-project-jira`, to `/tmp/dpt-smoke-jira-*.{log,pid,rc,start,attempt}`, `/tmp/dpt-smoke-mcp-config-jira.json`, `/tmp/dpt-smoke-verdict-jira.json`, `/tmp/dpt-smoke-findings-<date>-jira.md` and `/tmp/dpt-smoke-<date>-jira-approval.txt`, and to `tests/fixtures/socratic-first-turn/<skill>-jira-<YYYY-MM-DD>.json`.
- `--tracker none` writes to `../dpt-test-project-none` and to exactly the same `<tracker>`-keyed classes as the two rows above — `/tmp/` scratch, findings file, verdict artifact, approval record, Phase 8 fixtures — with its own segment substituted throughout. It writes **no** wrapped MCP config: there is no tracker MCP to wrap, so the leg has one fewer artifact class rather than an empty one (AC-STE-448.4).

  **Its per-leg paths are deliberately NOT spelled out here, and the omission is a contract rather than an oversight (STE-446 § AC.4 hazard).** `tests/m116-ste-423-tracker-scoped-artifacts.test.ts` scans this document for every `dpt-smoke-` literal and requires each to carry a tracker segment matching its own closed `<tracker>|${TRACKER}|$TRACKER|linear|jira` alternation — an alternation that predates the third leg and that AC-STE-446.4 forbids editing. So writing out a per-leg scratch path for any leg that alternation does not recognize turns the meta-test red — including inside a paragraph explaining the hazard, which is how this sentence reached its third draft — and per-leg ENUMERATION therefore belongs in `/conformance-loop`, which STE-423 declares out of scope. The `<tracker>`-templated statement above is the whole claim; substituting `none` into it yields the paths, and § Output lists the classes.

**What the isolation actually rests on — the tracker segment (STE-423).** The safety claim is not "the two legs happen to differ"; it is that every path either leg *writes, globs, or reaps* carries the resolved `<tracker>` segment, so the two legs' path sets are disjoint by construction and no glob one leg expands can name a file the other leg owns. Four classes carry it: the test-project directory, the `/tmp/` per-run scratch (logs, rc / start / attempt markers, wrapped MCP config, findings file, approval record), the Phase 8 transcript fixtures, and — the class that bites hardest when it is missed — the **pidfile globs** used for liveness detection and for reaping (`/tmp/dpt-smoke-<tracker>-*.pid`). The pidfile class is load-bearing in a way the others are not, because its glob feeds a `kill`, not merely a write: an unscoped pidfile glob would expand onto the partner leg's pidfiles, and the `ps -p <pid> -o comm=` identity check does **not** rescue the partner — the partner's grandchild is a genuine `claude` process and sails straight through that guard. So the claim extends exactly as far as the tracker segment does, and no further: any path that drops the segment drops the guarantee with it. Each invocation also owns its own approval gate (Phase 0 — Pre-approval), its own teardown checklist, and its own trace. Phase 0.5 cleanup honors the same invariant: it is per-tracker-scoped — each leg removes only its own stale scratch, including `/tmp/dpt-smoke-mcp-config-<tracker>.json`, so neither leg can delete the config the other leg's Phase 1 step 5 just wrote.

**No combined-mode flag.** A comma-separated `--tracker` value does not exist at this layer; there is no parent-side fan-out, no console-multiplexing, and **no merged findings file** — each terminal emits its own `/tmp/dpt-smoke-findings-<date>-<tracker>.md`. If a combined view is needed, read the per-leg findings files side-by-side, or run `/conformance-loop`, which owns the fan-out and its `--legs` selector. This was a deliberate brainstorm choice (2026-04-30, approach 1 selected over approaches 2 and 3) — minimum viable surface area, clean failure isolation per tracker, no merged-findings logic to maintain.

**Rate-limit caveat.** Both child chains bill against the same Anthropic API key concurrently, so the wall-clock win is **below 2×** — the API throttles the two streams against a shared budget. A typical tandem completes in ~11–14 min wall-clock vs. ~10 min solo, not 5 min. This is expected and acceptable; plan for ~70% of theoretical 2×. If the wall-clock win is consistently below 1.3× across multiple tandem runs, file a follow-up FR with measured traces — the next milestone may revisit (e.g., approach 2 — one driver, fan-out in Phase 2 only).

**Failure isolation.** A hang or abort in one terminal does not stall the other; each invocation is self-contained. The operator can `Ctrl-C` one and let the other complete. Phase 5 teardown runs independently per tracker.

## Argument parsing

Parse `$ARGUMENTS` once, before any pre-flight runs:

- `--tracker linear|jira|none` — pick the leg (canonical chain target). **Default `linear`** for back-compat — pre-M44 invocations (no flag) MUST behave byte-for-byte identically to the Linear path. Any value outside the alternation above ⇒ NFR-10 canonical refusal naming the unknown value and the supported set.

  **The alternation is DERIVED, not a hand-maintained literal (STE-448 AC.1).** It restates `SMOKE_LEGS` from `adapters/_shared/src/smoke_fixture_groups.ts`, and `adapters/_shared/src/leg_prose_surfaces.ts` binds every `--tracker` alternation in this document to that enum, so a leg added to the authority turns this bullet RED until it catches up. `none` was admitted by widening the enum, **not** by typing a third value beside the other two — the whole point of STE-446 making the enum the sole authority was that the next leg would not be a hand edit. The supported set is stated exactly once per site and never re-derived in prose beside it: an earlier revision of this bullet carried a second copy as `Any value outside {linear, jira}`, which is precisely the drift shape that survives a widened enum.
- `--jira-project <KEY>` — required when `--tracker jira` is passed; ignored on every other leg. Carries the Atlassian Space (Jira project) key (e.g., `DST`); pre-flight #8 verifies visibility before Phase 1 runs.
- `--reset` — boolean, default off. When present, pre-flight #2's existing-test-project refusal is replaced by an auto `rm -rf ../dpt-test-project-<tracker>` so the run continues against a clean slate. Surfaces in the Phase 0 contract as a separate operator-visible line. Default behavior unchanged — without `--reset`, pre-flight #2 still refuses.
- `--keep`, `--linear-team`, `--feature-stub` — unchanged.

Resolved values flow into the rest of the skill: pre-flights #3 / #5 fire on the Linear path, #7 / #8 / #9 fire on the Jira path; Phase 1 step 4 + step 5 + step 6 + Phase 2 setup answers + Phase 4 verify-on-disk + Phase 5 teardown all branch on `--tracker`. Linear-mode invocations skip every Jira-only step verbatim; Jira-mode invocations skip every Linear-only step verbatim. **The tracker-less leg skips BOTH sets** — every step above that is scoped to a named tracker is skipped on `--tracker none`, which is why that leg reaches no MCP pre-flight at all (AC-STE-448.4). No path runs two adapters in one invocation, and the tracker-less path runs none.

## Pre-flight refusals

Each fires before any side effects, exits non-zero with an NFR-10-shape message. Pre-flights #3 / #5 are **Linear-only** and fire only when `--tracker linear` (default) is active; pre-flights #7 / #8 / #9 are **Jira-only** and fire only when `--tracker jira` is active. Pre-flights #1, #2, #4, #6, #10 always fire regardless of `--tracker`:

**The tracker-less leg fires ZERO MCP pre-flights (STE-448 AC.4).** Every MCP-touching probe in this list is scoped to a named tracker — #3 and #5 to Linear, #7, #8 and #9 to Jira — so on `--tracker none` the set that fires is exactly the tracker-agnostic five (#1, #2, #4, #6, #10), and not one of them calls an MCP tool. That is a consequence of the existing scoping rather than a new exemption written for this leg: no probe had to be taught to skip itself, because none of them was ever unscoped. The property is asserted rather than asserted-by-eye — a test enumerates the MCP-bearing probes and fails if any of them loses its tracker scope, which is the only way this could silently regress.

1. **Not in the dev-process-toolkit repo.** `pwd` must end in `/dev-process-toolkit`. The skill writes to `../dpt-test-project-<tracker>` (a sibling of the repo); running it from elsewhere creates the test project in the wrong place.
2. **`../dpt-test-project-<tracker>` already exists** (per-tracker basename — one path per registered leg, e.g. `../dpt-test-project-linear` for `--tracker linear`). Refuse unless `--keep` was passed at the *previous* invocation against the **same tracker** (in which case verify the dir is empty / matches the expected post-teardown shape). **`--reset` escape hatch:** when `--reset` is present, this refusal is suppressed and the driver runs `rm -rf ../dpt-test-project-<tracker>` before continuing — surface in the Phase 0 contract as a separate operator-visible line. Default behavior unchanged — without `--reset` (or `--keep`), pre-flight #2 still refuses on existing dir, and the operator must `rm -rf` manually. The refusal message names the per-tracker path so a Linear run does not refuse just because a concurrent Jira run owns `../dpt-test-project-jira` (operator-driven parallelism, see § Operator-driven parallelism).
3. **(Linear-only) Linear MCP not available** in `~/.claude-st/` config. The skill calls Linear via `mcp__linear__*` tools through the child claude-st sessions; without the MCP server registered, those calls fail mid-run and leave half-created issues.
4. **Uncommitted changes in the toolkit repo.** The skill doesn't modify the toolkit repo, but a dirty tree means the operator may be mid-feature; surface this before tying up 10 minutes on a smoke run that may be against a moving target.
5. **(Linear-only) Linear team key not resolvable.** Default `STE`; override with `--linear-team`. **Probe by key first** — call `mcp__linear__get_team` with the team key (e.g., `STE`) directly, OR call `mcp__linear__list_teams` (no `query=`, large `limit=`) and filter the response on `team.key == "<TEAM_KEY>"`. The key path is exact and resolves the canonical operator entry point on first try. **Name-prefix `query=<TEAM_KEY>`** matching is kept only as a fallback for legacy paths where the key probe misses (e.g., the operator passes a team display-name fragment instead of a key); fall back only after the key probe yields no hit. A bogus key fails with NFR-10 canonical refusal naming the unknown key and the supported keys (smoke #7 F1 — without this ordering, `STE` is rejected as a name-prefix miss even though it's the canonical key).
6. **Path-safety on the test-project location.** Before spawning any child (see Phase 0), the driver MUST verify the resolved test-project path:
   - Resolves with `realpath` (no broken symlinks). On macOS `realpath` requires the path to exist; resolve via the parent dir + basename instead, since the test-project itself doesn't yet exist when this fires.
   - Has the toolkit-repo path as its parent's parent (i.e. is a true sibling of `dev-process-toolkit`, not an ancestor, child, or unrelated location).
   - Basename matches one of the closed allow-list `{dpt-test-project-linear, dpt-test-project-jira, dpt-test-project-none}` exactly — no other forms accepted (the bare `dpt-test-project` basename is intentionally rejected). One entry per registered leg (`SMOKE_LEGS` in `adapters/_shared/src/smoke_fixture_groups.ts`, bound to this allow-list by `adapters/_shared/src/leg_prose_surfaces.ts`, STE-446); the cwd guard pins child spawns to that closed set of well-known throwaway paths, one per leg.
   - Is not a symlink, is not inside `$HOME` directly (must be under a `workspace/` ancestor), is not the toolkit repo itself.
   Any failure refuses with NFR-10. This is the load-bearing **cwd guard** that pins the test-project path to one known throwaway directory per registered leg — it fixes the **spawn working directory** each child starts in, while the tracked `permissions.allow` allow-list (`.claude/settings.json`, STE-252) bounds *what* tool calls they may issue. What the cwd guard does *not* do is bound where a child's writes land: a child can write outside the test project from that working directory, and this pre-flight has nothing to say about it. The cwd guard no longer "justifies" any bypass posture; per-tool-call enforcement runs out of the tracked allow-list under default permission mode in Phase 2.

   **Reference implementation** (originally verified 2026-04-27 against six adversarial cases — wrong-basename, not-sibling, symlink-decoy, is-toolkit, no-workspace-ancestor, canonical-good; M46 expanded the canonical-good case to two valid forms and added three new negative cases — bare basename `dpt-test-project`, garbage-suffix `dpt-test-project-foo`, case-mismatch `dpt-test-project-LINEAR`; M121/STE-446 widened the canonical-good set to one form per registered leg, and the arm below is asserted against `SMOKE_LEGS` rather than reviewed by eye):

   ```bash
   TOOLKIT_REPO="$(pwd)"
   TRACKER="${TRACKER:?--tracker must resolve to linear|jira|none before pre-flight #6}"
   TEST_PATH="../dpt-test-project-${TRACKER}"
   TOOLKIT_REAL="$(realpath "$TOOLKIT_REPO")"
   TEST_DIR_REAL="$(realpath "$(dirname "$TEST_PATH")")" || exit 1
   TEST_REAL="$TEST_DIR_REAL/$(basename "$TEST_PATH")"
   case "$(basename "$TEST_REAL")" in
     dpt-test-project-linear|dpt-test-project-jira|dpt-test-project-none) ;;
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

10. **Child-spawn pattern present in the tracked allow-list** (STE-351 AC-STE-351.1 — mirrors `/conformance-loop` pre-flight (f)). Always fires regardless of `--tracker`. Read the toolkit repo's tracked `.claude/settings.json`, JSON-parse it, and assert `.permissions.allow` **contains** the canonical child-spawn pattern literal `Bash(claude:*)` — a contains-check (`jq -e '.permissions.allow | index("Bash(claude:*)")' .claude/settings.json`), not merely a non-empty check. The Phase 1 step 6 scaffold snippet copies this allow-list into the test project's `.claude/settings.json`. The M94 false-green — every nested `claude -p` spawn denied headless, the grandchildren dying as 0-byte transcripts — is what the probe was built against; note that the 2026-07-27 measurement narrowed *when* an absent pattern produces that denial, and the re-justification paragraph below is now the operative rationale. Refuse with NFR-10 canonical shape:

    ```
    permissions.allow lacks the child-spawn pattern "Bash(claude:*)" in .claude/settings.json.
    Remedy: add "Bash(claude:*)" to the permissions.allow allow-list in the tracked .claude/settings.json (and keep the Phase 1 step 6 scaffold snippet in sync), then re-run /smoke-test.
    Context: pre-flight=spawn_pattern_allow_check, file=.claude/settings.json, skill=smoke-test
    ```

    **Why this probe survives STE-425 (re-justified 2026-07-27).** The probe is **necessary but not sufficient**, and it is deliberately kept rather than dropped. Wherever `permissions.defaultMode` is `auto` — as in the operator's own global `~/.claude-st/settings.json`, measured on both 2026-07-27 legs — the harness classifier is what actually admits or denies a nested spawn, so the tracked allow-list is not the operative gate there and its presence alone guarantees nothing at runtime; that is exactly why group 8's live negative sub-fixture was retired (§ Why the negative half is not a live sub-fixture). Two merits survive: the literal keeps the Phase 1 step 6 scaffold in sync with the tracked list — `/gate-check` probe #62 enforces the same `Bash(claude:*)` literal at severity ERROR, fail-closed — and the allow-list **is** the operative gate in any environment whose default permission mode is not `auto`, which is every checkout that has not opted in. Refusing here therefore buys deterministic scaffold coherence, not a runtime spawn guarantee. `/conformance-loop` refusal (f) keeps the same decision — the same contains-check on the same literal — so neither driver drops a probe the other keeps, and it carries the same narrowing under its own § Narrowed 2026-07-27 clause. The scaffold-coherence justification above is the current one for both drivers, and neither now states the absent-pattern case as a runtime denial.

## Flow

The flow is six phases. Each phase prints its name + status (RUN / PASS / FAIL / SKIP) so the operator can follow along. On any FAIL, the phase reports what happened and offers to continue or abort.

### Phase 0 — Pre-approval gate

The skill spawns `claude-st -p` children in default permission mode and pre-creates `.claude/settings.json` + `.mcp.json` from the parent's Bash tool. The tracked `.claude/settings.json` carries a `permissions.allow` allow-list (STE-252) enumerating every tool surface the chain needs — Bash command patterns, Edit/Write/Read/Grep/Glob, `mcp__linear__*` / `mcp__atlassian__*`; children read it from the spawn cwd and run hands-off within that scope. The parent still pre-creates `.claude/settings.json` + `.mcp.json` because the harness's sensitive-path classification of those two files survives even default permission mode at the *child*'s model layer, so a child can neither create either file nor overwrite one with a direct full-file `Write`; the parent's Bash heredoc (shell I/O is not subject to that classification) is the only path that brings them into being. A `/setup` child *can* still merge into a `.claude/settings.json` the parent already wrote — measured 2026-07-27, see Phase 1 step 6. See the **Threat model** section below for the residual-risk picture under the tracked-allow-list posture. The historical alternatives (`acceptEdits + per-path Write`, plain `bypassPermissions` without parent pre-creation) were both empirically falsified during early dogfooding (STE-185); the current `default-mode + content-rich permissions.allow` is neither.

Print this contract to the operator and prompt for `y` to proceed:

The "Real <tracker> writes will occur" line branches on `--tracker`:

- **Linear path:** `Real Linear writes will occur (test project + ~6 issues).`
- **Jira path:** `Real Jira writes will occur in Space <flag-value> (~6 work items, all carrying the dpt-smoke label so Phase 5 can transition them to Done).`
- **Tracker-less path:** `No tracker writes of any kind will occur — this leg is mode: none end to end. Identity is minted locally, and release is proved by the deletion of .dpt/locks/<id> rather than by a ticket transition.`

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
allow-list holding exactly one entry per registered leg, under a
workspace/ ancestor, not a symlink, not the toolkit repo itself).
That check fixes the spawn working directory every child starts in. It does
NOT bound where a child's writes land once it is running: children inherit
your global Claude configuration, so a write outside the test project is
possible. Review your own global instructions before approving.
A concurrent run against another leg (see § Operator-driven
parallelism) writes to its own basename and never touches this one.

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

Substitute `<rendered-tracker-line>` with the per-tracker line above before printing — never present the literal `<rendered-tracker-line>` placeholder to the operator. Substitute `<tracker>` with the resolved leg — likewise never print the placeholder literal.

Refuse on `n`. On `y`, log the approval to `/tmp/dpt-smoke-<date>-<tracker>-approval.txt` and proceed.

**`requires-input:` Phase 0 acceptance — STE-232 AC-STE-232.6.** This Phase 0 acceptance gate carries the cross-skill `requires-input:` contract documented in `docs/auto-mode-protocol.md`. The three-branch resolution mirrors the protocol's Refusal Mechanism:

- **Marker present** (`<dpt:auto-approve>v1</dpt:auto-approve>` observed in the parent prompt body) ⇒ `default-applied`: log the approval automatically and proceed without prompting. The Phase 2 driver heredoc-injects this marker as the first body line of every canonical `claude -p` child spawn — that injection is the canonical worked example of the default-apply mechanism (STE-226 cross-reference; see `docs/auto-mode-protocol.md` § Default-Apply Mechanism).
- **Marker absent + non-interactive stdin** (e.g., parent piped `< /dev/null`) ⇒ `refused`: route through `requireOrRefuse(...)` so the failure surfaces as `RequiresInputRefusedError` with NFR-10 canonical shape — Verdict / Remedy / Context — rather than silent imputation. The smoke driver MUST NOT model-impute "y" because the operator described an unattended run; that is the v2.13.0 incident shape this FR closes.
- **Marker absent + interactive stdin** ⇒ `user-supplied`: prompt the operator and gate on their `y`/`n` answer as today.

Phase 2's heredoc-injected `<dpt:auto-approve>v1</dpt:auto-approve>` body line is the byte-checkable token children check for; the canonical injection sites in this driver are documented in `docs/auto-mode-protocol.md` § Default-Apply Mechanism so a future skill author has one place to look.

### Phase 0.5 — Clear stale per-run scratch

After Phase 0 acceptance, before Phase 1.1, unconditionally clear stale per-run scratch from prior invocations, then verify the wipe on disk. Every per-run scratch class is wiped (widened per STE-358) — prompt-template scratch files, and every per-run artifact keyed on the resolved tracker: per-skill logs, pidfiles, rc files, start markers, attempt logs, and the resolved tracker's own wrapped MCP config from a prior run:

```bash
bash -c 'rm -f /tmp/dpt-smoke-prompt-*.txt /tmp/dpt-smoke-<tracker>-*.log /tmp/dpt-smoke-<tracker>-*.pid /tmp/dpt-smoke-<tracker>-*.rc /tmp/dpt-smoke-<tracker>-*.start /tmp/dpt-smoke-<tracker>-*.attempt* /tmp/dpt-smoke-mcp-config-<tracker>.json'
# Verify on disk — the wiped globs must yield zero survivors (no output expected):
bash -c 'ls /tmp/dpt-smoke-prompt-*.txt /tmp/dpt-smoke-<tracker>-*.log /tmp/dpt-smoke-<tracker>-*.pid /tmp/dpt-smoke-<tracker>-*.rc /tmp/dpt-smoke-<tracker>-*.start /tmp/dpt-smoke-<tracker>-*.attempt* /tmp/dpt-smoke-mcp-config-<tracker>.json 2>/dev/null'
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
   - **Tracker-less path (`--tracker none`). SKIPPED ENTIRELY — no workspace is created, and no MCP tool is called (STE-448 AC.4/AC.6).** There is no remote workspace for a `mode: none` project to bind to: identity is minted locally by `Provider.mintId()` and the milestone token is derived from it, so there is nothing to allocate and nothing to name. The findings file's header records `tracker: none` and no workspace URL, because there is no URL to record — an empty or placeholder URL field would read as a failed lookup rather than as the absence it is. This is also the step that makes Phase 5's tracker-side teardown vacuous on this leg: teardown archives what setup created, and setup created nothing.
   - **Jira path (`--tracker jira`).** **No creation call** — the Atlassian Rovo MCP exposes no `createJiraProject` tool, so the operator must have created the Space (Jira project) in the Jira UI manually before running `/smoke-test`. Pre-flight #8 has already verified visibility via `mcp__atlassian__getVisibleJiraProjects`; this step is a vacuous re-affirmation. Save the Space key (e.g., `DST`) and the Atlassian site URL to the findings file's header. Document: the Space is reused across runs (no per-run isolation); Phase 5 teardown closes only the work items this run created (matched by label `dpt-smoke` + creation-time window).
5. **MCP config — branches on `--tracker`:**

   - **Linear path.** Construct the wrapped Linear MCP config at `/tmp/dpt-smoke-mcp-config-linear.json`. Source: `~/.claude-st/plugins/marketplaces/claude-plugins-official/external_plugins/linear/.mcp.json` (a bare server entry without the `mcpServers:` envelope). Wrap it as `{"mcpServers": <source>}` and write to /tmp. This is required because `--plugin-dir` (used to load the in-tree plugin under test) shadows plugin-loaded MCPs, so the active tracker MCP must be passed via `--mcp-config` from a per-tracker wrapper file written to `/tmp/`.
   - **Jira path.** Construct the wrapped Atlassian Rovo MCP config at `/tmp/dpt-smoke-mcp-config-jira.json` directly (the Rovo MCP entry is a single-line `http`-transport URL with no auth material — child sessions inherit OAuth state from `~/.claude-st/`):

     ```json
     {"mcpServers": {"atlassian": {"type": "http", "url": "https://mcp.atlassian.com/v1/mcp/authv2"}}}
     ```

     The same `--plugin-dir` shadowing concern from the Linear path applies, so wrapping is required either way.
   - **Tracker-less path (`--tracker none`). NO MCP CONFIG IS CONSTRUCTED (STE-448 AC.4).** The wrapping exists to work around `--plugin-dir` shadowing the *tracker* MCP; with no tracker there is no server to shadow and nothing to wrap. So the wrapped config `/tmp/dpt-smoke-mcp-config-<tracker>.json` is never written on this leg, and — this is the half that has to be said out loud — **the Phase 2 spawns omit the `--mcp-config` flag entirely rather than passing an empty or `{"mcpServers":{}}` file.** Passing an empty config would be a different thing that happens to behave the same today: it asserts "here is the MCP configuration, and it is empty", which a future `--mcp-config` validation could reject and which makes the leg look like a tracker leg whose config failed to build. Omitting the flag says what is true. Phase 0.5's per-tracker wipe still names the path, harmlessly: the glob removes a stale file if one exists from an earlier revision and is a no-op otherwise, and narrowing it per leg would buy nothing but a branch.
6. **Pre-create the sensitive files from the parent's Bash heredoc.** The child claude session — even in default permission mode (STE-252) — cannot bring `.claude/settings.json` or `.mcp.json` into being on its own: the harness's sensitive-path classification of those two files survives at the child's model layer regardless of `permissions.allow` content, and it refuses a child's direct full-file `Write` of either. The parent's Bash tool uses shell I/O (`cat > file <<EOF`), which is not subject to that classification, so the driver writes them directly.

   **Measured correction (2026-07-27).** This step used to add that the child model layer denies ALL `.claude/settings.json` writes — full-file Write AND append-only Edit alike, so that **no child-side merge path** existed and children could **never extend** the list. That addition is **falsified**. In the 2026-07-27 run the driver's heredoc scaffolded 29 allow-list entries and the post-`/setup` committed file carried 50; the `/setup` child's own bootstrap commit body reads "merged canonical bun allow-list into the pre-existing file (29 entries preserved, 21 added)" — a recurrence of the same observation from 2026-07-20. The narrower claim is the true one, and it is still load-bearing: the sensitive-path classification does refuse a child's direct full-file `Write` of `.claude/settings.json` and does keep a child from creating `.mcp.json` at all, but it never foreclosed `/setup`'s idempotent-merge path into a settings file the parent had already put on disk. Treat that merge as observed-and-documented child behavior — neither depend on it nor try to block it.

   **Ground (a) — `.mcp.json` really is blocked.** The sensitive-path classification keeps a child from bringing `.mcp.json` into being at all, and the child needs its tracker MCP server registered at *startup* rather than partway through, so the file has to be on disk before the first child spawn. The 2026-07-27 merge finding leaves this ground exactly where it was. **Ground (b) — chicken-and-egg.** A child cannot grant itself the permissions it needs in order to start; whatever a child may merge afterwards, the allow-list has to be in place before the first child runs at all.

   **Ground (c) — the parent-written list is the *reviewed* artifact.** It is what `/smoke-test` pre-flight #10 (`spawn_pattern_allow_check`) and `/gate-check` probe #62 (`spawn_pattern_allowlist`, severity ERROR, fail-closed) both check; a child's later merge is reviewed by nobody, which is precisely why the reviewed starting point is worth writing. The honest consequence, stated rather than papered over: because a child *can* widen its own allow-list, the "reviewable single-file PR diff" property claimed in the threat model below is weaker than it sounds — what review sees is the STARTING POINT, not the effective policy in force once the grandchildren run.

   The pre-creation therefore still has to carry the FULL final allow-list, on grounds (a)–(c) rather than on the retired premise. The `.claude/settings.json` allow-list is identical in both tracker paths; it is identical on the tracker-less path too, whose `mcp__linear__*` / `mcp__atlassian__*` entries are simply unexercised — an allow-list entry for a server that is not registered grants nothing, and pruning it per leg would fork the one artifact `/gate-check` probe #62 and pre-flight #10 both check against a single literal. `.mcp.json` branches on `--tracker`:

   ```bash
   mkdir -p .claude
   # Rule SHAPE is load-bearing — do NOT "tidy" these entries into `Bash(git *)`
   # form. `Bash(<cmd>:*)` is a PREFIX rule and grants `<cmd> …`; the glob form
   # `Bash(<cmd> *)` is read as an EXACT rule, so it authorizes only the literal
   # string `<cmd> *` — i.e. nothing at all — and it additionally trips
   # /gate-check probe #35 (`setup_permissions_shape`) and probe #69's
   # `permission-shapes` entry on every freshly scaffolded test project. Nine
   # glob-shaped entries sat in this snippet until STE-426 measured them inert
   # (2026-07-27); `Bash(claude:*)` was always prefix-shaped and always worked.
   cat > .claude/settings.json <<'EOF'
   {
     "permissions": {
       "allow": [
         "Bash(claude:*)",
         "Bash(bun:*)", "Bash(bunx:*)", "Bash(cp:*)", "Bash(date:*)",
         "Bash(find:*)", "Bash(gh:*)", "Bash(git:*)", "Bash(grep:*)",
         "Bash(jq:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(mv:*)",
         "Bash(rm:*)", "Bash(test:*)",
         "Edit", "Write", "Read", "Grep", "Glob",
         "mcp__linear__*", "mcp__atlassian__*"
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

   - **Tracker-less path** (`--tracker none`): **no `.mcp.json` is written at all (STE-448 AC.4).** Grounds (a)–(c) above all turn on the child needing its *tracker* MCP registered at startup; this leg has none, so the file has no content to carry. Writing `{"mcpServers": {}}` was considered and rejected for the same reason the `--mcp-config` flag is omitted rather than emptied: an empty envelope claims a configuration exists and is empty, which is a different (and false) statement from "this leg registers no MCP server". `.claude/settings.json` is still pre-created exactly as above — the allow-list is the policy artifact every leg needs, and it is not MCP-specific.

     Phase 4's verify-on-disk row therefore asserts `.mcp.json` is **ABSENT** on this leg rather than skipping the row (§ Phase 4 — Verify-on-disk). A skipped row and an absent file are not the same evidence: only the assertion distinguishes "this leg correctly wrote nothing" from "nobody looked".

   Additionally, on the **Jira path**, the driver pre-stages the `### Jira` workspace-binding sub-section so the /setup child takes the idempotent-merge branch and emits the right CLAUDE.md `## Task Tracking` shape on its own. The /setup child receives pre-baked answers (Phase 2 step 1) that resolve to:

   ```markdown
   ## Task Tracking

   mode: jira
   mcp_server: atlassian
   jira_ac_field: description
   branch_template: {type}/m{N}-{slug}

   ### Jira

   project: <flag-value>
   default_labels: [dpt-smoke]
   ```

   `jira_ac_field: description` is the zero-config sentinel from STE-154 AC-STE-154.3 — ACs live as a bullet list under a `## Acceptance Criteria` heading inside each Jira issue's description body; pull_acs / push_ac_toggle parse and rewrite that section atomically. `default_labels: [dpt-smoke]` is the free-form `### Jira` sub-section field (per `docs/patterns.md` § Schema L Workspace binding sub-sections); the Jira adapter forwards every entry into `mcp__atlassian__createJiraIssue.additional_fields.labels` on every issue created during the run, which is what makes Phase 5 teardown's `labels = "dpt-smoke"` JQL find them.

   On the **tracker-less path** there is nothing to pre-stage, and that is the point rather than an omission (STE-448 AC.5). `/setup` step 7b's `none` branch emits **no `## Task Tracking` section at all** — absence IS the canonical form for `mode: none`, so there is no Schema L block to seed, no workspace-binding sub-section to render, and no `mode: none` line to look for afterwards. A driver that pre-staged a `## Task Tracking` section here carrying `mode: none` would produce a CLAUDE.md that gate-check probe #21 and the Phase 4 row below both read as WRONG, and it would quietly convert the leg into a fourth, non-canonical tracker shape that no downstream project has.

   Match the rest of the canonical content from `plugins/dev-process-toolkit/skills/setup/SKILL.md` step 6/7 (refresh as the plugin evolves). The /setup child detects existing files and takes the idempotent-merge branch.

6b. **Workspace trust is an operator PRECONDITION (STE-367 supersedes STE-356's self-seed).** Grandchildren spawned in a fresh test-project cwd ignore the scaffolded `.claude/settings.json` allow-list until the workspace is trusted — captured logs open with "Ignoring N permissions.allow entries from .claude/settings.json: this workspace has not been trusted" (2026-07-02 conformance finding F4), leaving the STE-252 policy artifact inert at the grandchild layer. Workspace trust lives in the operator's **live** `$CLAUDE_CONFIG_DIR/.claude.json` under `projects["<abs test-project path>"].hasTrustDialogAccepted` (the absolute path is `$TEST_REAL` from pre-flight #6's `realpath` resolution — parent-dir realpath + hard-coded basename).

   **The driver does not write this entry.** The harness auto-mode self-modification classifier reliably denies the programmatic `hasTrustDialogAccepted` write under `claude -p` (`[Self-Modification] … not explicitly requested by the user`; 2026-07-04 conformance finding F1), so a self-seed cannot run hands-off — and covertly retrying past that guard is out of bounds. Trust is therefore an **operator precondition**: it is *asserted* (not written) by the Workspace-trust spawn gate below, before the first Phase 2 spawn, and the gate's refusal hands the operator the one-line `jq` seed. Because the two test-project paths are fixed and operator-owned, a seeded entry persists across runs — there is no per-run re-seed, and Phase 5 teardown no longer removes it (STE-367). This removes the STE-356 backup + cross-leg spinlock + read-merge-write entirely: the driver never mutates the live config, so there is nothing to back up, lock, or roll back.

7. Print: "Setup phase complete. Test project: ../dpt-test-project-<tracker>; tracker: <resolved leg>; <Linear project URL | Jira Space key + site URL | `no tracker workspace (mode: none)`>; MCP config: <`/tmp/dpt-smoke-mcp-config-<tracker>.json` | `none constructed (mode: none)`>; sensitive files pre-created."

### Phase 2 — Run the canonical chain

#### Phase-2-entry context probe — SMOKE-CTX (STE-365)

**Before the first grandchild spawn**, run this deterministic stdin-tty probe and read its banner line. It turns the driver's *belief* about its own execution context into an *observed fact* at the decision point — the fix for F3 (2026-07-04 conformance run: the driver misidentified its own `claude -p` context as interactive, fired the `/setup` grandchild via `run_in_background`, then ended the turn awaiting a completion notification that under `claude -p` never arrives, so `/setup` was torn down mid-run):

```bash
# Phase-2-entry context probe — run ONCE and read the banner before any spawn.
if [ -t 0 ]; then
  echo "SMOKE-CTX: interactive tty"
else
  echo "SMOKE-CTX: headless (claude -p) — background-task notifications will NOT arrive; the ONLY sanctioned wait is the bounded kill-0 poll. Do NOT run_in_background, do NOT Monitor, do NOT yield the turn to await a grandchild."
fi
```

**HARD GATE — the banner is binding, not advisory (STE-414).** The `[ -t 0 ]` result is the **sole determinant** of headless-vs-interactive for this leg: whatever the probe prints *is* the execution context. A `SMOKE-CTX: headless (claude -p)` banner is the common case for a `/conformance-loop`-spawned leg, and that classification is **BINDING** for the remainder of the run — it cannot be overridden by any later self-narration, reasoning, or belief to the contrary, no matter how confident. Only a `SMOKE-CTX: interactive tty` banner means a human is at the keyboard; the driver may **not** proceed on an "interactive" self-classification while stdin is non-tty.

**The forbidden rationalization is byte-pinned.** The driver MUST NOT self-narrate itself as an **"interactive parent"** — the verbatim 2026-07-24 Jira-leg wording — while stdin is non-tty. That self-narration is forbidden, carries no authority to override the banner, and does NOT re-open any background-wait or turn-yield path: under a headless banner every grandchild wait MUST use the bounded `kill -0` poll-until-exit loop below — never `run_in_background`, never the `Monitor` tool, never ending the turn to await a completion notification (F3). Advisory prose was the escape hatch that let STE-355 → STE-357 → STE-365 each get narrated past; there is no discretion left here to exercise.

**Headless-gate violation ⇒ abort with full teardown.** If the driver finds it has violated this hard gate — acted on an "interactive" self-classification under a headless banner, spawned via `run_in_background`, reached for `Monitor`, or yielded the turn awaiting a grandchild — the leg is void. It MUST abort immediately and run `### Phase 5 — Teardown` (archive/close the tracker project + `rm -rf` the test directory) before exiting, so a violated run never leaves orphaned tracker data or test directories behind (the 2026-07-24 failure mode on both legs). Reap first: before that teardown runs, `kill` every PID recorded in a still-answering pidfile (identity-checked exactly as the `Final-message self-check` clause's reap-first rule requires) and then `bash -c 'rm -f /tmp/dpt-smoke-<tracker>-*.pid'`, because `rm -rf`-ing a directory a live grandchild is still writing into races it. Both halves of that removal are load-bearing (STE-423): the glob carries the resolved `<tracker>` so a tandem partner's pidfiles are never in the match set, and the `bash -c` wrapper is required because the operator's shell is zsh, where an unmatched glob is an error that would kill the abort itself instead of expanding to nothing.

Spawn one `claude-st -p` child per skill, sequentially. Each child:

- Has `cwd=../dpt-test-project-<tracker>`.
- Is invoked as bare `claude -p ...` with `CLAUDE_CONFIG_DIR=~/.claude-st` exported once at the top of the spawning Bash block (STE-350: exported rather than inlined so every spawn line begins with `claude` and the tracked `Bash(claude:*)` allow entry matches) — NOT `claude-st -p`, because the `claude-st` zsh alias does not expand inside the parent harness's Bash tool.
- Runs in default permission mode and reads the tracked `.claude/settings.json` `permissions.allow` allow-list (STE-252) from the spawn cwd. The allow-list covers the chain's normal Bash + MCP operations at command-pattern granularity. NOT sufficient alone for **creating** either `.claude/settings.json` or `.mcp.json`, nor for a direct full-file `Write` of one — the harness's sensitive-path classification of those two files survives default permission mode at the child's model layer, which is why Phase 1 step 6 pre-creates them from the parent. It does **not** follow that a child cannot touch them at all: a `/setup` merge into an already-existing `settings.json` succeeded on 2026-07-27 (§ Phase 1 step 6 — Measured correction), so the classification bounds creation and whole-file replacement, not every write. Combined: tracked allow-list for the bulk of the chain + parent-pre-creation for the sensitive paths = end-to-end runnable.
- Passes `--mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json` (built in Phase 1 step 5; `linear` entry on the Linear path, `atlassian` entry on the Jira path). `--plugin-dir` (used to load the in-tree plugin under test) shadows plugin-loaded MCPs, so the active tracker MCP must be passed via `--mcp-config` from a per-tracker wrapper file written to `/tmp/`. The per-tracker filename keeps a concurrent run against another leg from clobbering this run's config (operator-driven parallelism). **On the tracker-less path the flag is OMITTED, not emptied (STE-448 AC.4):** Phase 1 step 5 constructed no config, so every `--mcp-config …` occurrence in the reference snippets below is dropped from the spawn line on that leg rather than pointed at a file that does not exist. A `--mcp-config` naming a missing path is a startup error, and one naming an empty envelope is a false claim; omission is the only shape that is both true and runnable.
- Passes `--plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit` to load the in-tree plugin under test (not the cached version under `~/.claude-st/plugins/cache/`).
- Receives a fully-pre-baked prompt where the slash command is the **literal first line of the user message**, not wrapped in natural language. Plugin skills carry `disable-model-invocation: true`, so the child's model cannot call them via the Skill tool — only user-typed slash commands trigger; the prompt-pre-bake puts the slash command as the literal first line of the user message. Pre-baked answers go on the lines after.
- Has its stdout/stderr captured to `/tmp/dpt-smoke-<tracker>-<skill>.log` (e.g., `/tmp/dpt-smoke-jira-implement.log`) as **stream-json NDJSON** — every spawn passes `--output-format stream-json --verbose` (STE-352; `--verbose` is required by `claude -p` for stream-json output). Default text mode emitted only the child's final result message, so mid-stream assistant tokens — per-probe capability rows, forked `tdd-result` fences — never reached the log (smoke F2, the blind spot that let the STE-350 0-byte-grandchild false-green survive). To read a capture, lift the assistant text via `extractAssistantText` (`adapters/_shared/src/smoke_child_capture.ts`; blocks are joined line-anchored so fences stay greppable), or project `text`/`tool_use` entries via the existing `parseStreamJsonTranscript` (`adapters/_shared/src/socratic_first_turn_stream.ts`) — the same parser Phase 8 already uses. Phase 2.X's substring greps keep working unchanged: literal tokens survive JSON string encoding.
- Is spawned **detached** (`&` with its PID captured to `/tmp/dpt-smoke-<tracker>-<skill>.pid`) and awaited via the bounded poll-until-exit loop — never as a single foreground Bash call, which caps the grandchild at the harness's 10-minute per-call ceiling (STE-355; § Grandchild spawn lifecycle below).

Skills to run, in order:

1. `/dev-process-toolkit:setup` — pre-baked answers branch on `--tracker`:

   - **Linear path:** `stack=Bun+TS, tracker=linear, mcp_server=linear, team=STE, project=<the smoke-test project from Phase 1>, jira_ac_field=blank, branch_template=default, docs flags=all-false`. The pre-baked workspace-binding sub-section emits `### Linear` with `team:` + `project:` (and optionally `default_labels:` if downstream callers want labels — not used by the Linear smoke today).
   - **Jira path:** `stack=Bun+TS, tracker=jira, mcp_server=atlassian, project=<--jira-project flag value>, jira_ac_field=description, branch_template=default, docs flags=all-false, default_labels=[dpt-smoke]`. The pre-baked workspace-binding sub-section emits `### Jira` with `project:` + `default_labels:` so the Jira adapter forwards `dpt-smoke` into every `mcp__atlassian__createJiraIssue.additional_fields.labels` call. **Skip Jira AC custom-field discovery** — the pre-baked `jira_ac_field: description` answer short-circuits `/setup` step 7b's discover_field.ts call (zero-config sentinel path). **Skip the Linear team/project probe** — the workspace binding is fully resolved from the flag.
   - **Tracker-less path:** `stack=Bun+TS, tracker=none, docs flags=all-false`. **No `mcp_server`, no workspace binding, no `jira_ac_field`, and NO `## Task Tracking` section in the emitted CLAUDE.md (STE-448 AC.5).** Step 7b's option `1` is what the pre-baked `tracker_mode: none` answer selects, and its documented behavior is to emit no such section — absence is the canonical form, so the correct output is a CLAUDE.md with the section missing rather than one declaring `mode: none`. Both the Linear and Jira probes are skipped for the same reason there is nothing to probe. Phase 4's verify-on-disk row asserts the ABSENCE positively (§ Phase 4), because a section that was never written and a section nobody checked for produce the same file and different evidence.

   **In both modes, the prompt MUST acknowledge the pre-existing `.claude/settings.json` and `.mcp.json`** (Phase 1 step 6) and instruct the child to take the idempotent-merge branch — do not blindly let it try to overwrite, since the sensitive-path classification block (see Phase 0 — Pre-approval gate) aborts the chain when the child attempts a fresh write. The canonical pre-baked prompt body is inlined into the Phase 2 child-spawn heredoc below (§ STE-185); do not write it to a file on disk.

   **Post-step master-merge (STE-295 AC.3).** After the `/setup` child returns, the test project sits on the `chore/setup-bootstrap` branch with the toolkit scaffold (CLAUDE.md, `specs/` tree, `.claude/` config) committed there but NOT on `master`/`main`. Before spawning step 2 (`/spec-write`), the driver MUST merge `chore/setup-bootstrap` → master so the scaffold lands on the trunk:

   ```bash
   git -C ../dpt-test-project-<tracker> checkout master \
     && git -C ../dpt-test-project-<tracker> merge --no-ff chore/setup-bootstrap -m "chore: merge setup-bootstrap → master"
   ```

   This carries the `/setup` scaffold onto master so the universal branch gate (STE-228) fires correctly on the subsequent `/spec-write` spawn and takes the auto-apply `branch_gate_default_applied` path — gate detection reads CLAUDE.md from the current branch, and without the merge the child would re-enter on `chore/setup-bootstrap` with no trunk scaffold and a degenerate gate state. The merge is `--no-ff` so the bootstrap commit's subject + footer (asserted by gate-check probe #30) stays addressable on master's first-parent line.
2. `/dev-process-toolkit:spec-write` — feature stub (default `greet`): "Add a pure function greet(name?: string) returning 'Hello, <name>!' (defaulting 'world' for undefined / empty / whitespace-only). File src/greet.ts; test src/greet.test.ts; 4 ACs."
3. `/dev-process-toolkit:implement <feature-id>` — full TDD + tracker writes (claim → release after archive). Pre-authorize the Phase 4 step 15 commit upfront. Do NOT push.

   **Tracker-less leg only — sample the lock while this step is still running (STE-451).** `/implement` claims at § 0.c and releases at Phase 4 Close step (b), both **inside** this step, so the lock file exists only for the duration of this spawn and is gone before Phase 2.X runs. Run § Fixture group 10's sampler once per poll call for this PID; it is a one-shot `test -e` that appends only on a hit, so it composes with the bounded poll fence without altering it. Skipping it does not fail this step — it fails sub-fixture 10a, which is the point: an unsampled window and an unwritten lock must not report the same way.

   **Post-step advisory (STE-181).** After step 3 returns, log: *"single-FR run complete — FR remains `status: active`, milestone remains `status: active`. Run `/spec-archive M<N>` to archive when ready."* The smoke driver intentionally uses the `<feature-id>` form (per `skills/implement/SKILL.md` § Invocation forms — single-FR is the canonical "ship one FR" path), which silent-skips Phase 5. The end state is correct, not drift; gate-check probe #14 emits the STE-180 advisory if the plan is fully checked. Documentation prose only — no behavioral change to the smoke driver.
4. `/dev-process-toolkit:gate-check` — read-only verification.
5. `/dev-process-toolkit:spec-review <feature-id>` — read-only spec-vs-code audit.
6. `/dev-process-toolkit:simplify` — review changed code; safe refactors applied + gate re-verified.

#### Discretionary-halt guard — mid-run judgment calls (STE-414)

**Scope.** Under a `SMOKE-CTX: headless` classification, ANY mid-run judgment call the driver would otherwise resolve by asking the operator falls under this guard: a rate-limit / seven-day-usage warning, a cost pause, a reduced-run choice ("run one leg instead of two?"), and any new decision of the same shape that the auto-approve marker could not pre-authorize by name. There is no operator on the other end of a headless leg, so every such call MUST resolve deterministically off a single byte-checkable input — the presence of the auto-approve marker literal `<dpt:auto-approve>v1</dpt:auto-approve>` in the invoking prompt body. Two branches, no third.

**Branch 1 — marker present ⇒ proceed.** If the marker `<dpt:auto-approve>v1</dpt:auto-approve>` is present in the invoking prompt body, the judgment call is already pre-authorized: the driver MUST proceed with the FULL run — whole canonical chain, all fixtures, no self-imposed reduction — and log the decision in passing rather than pausing on it.

**Branch 2 — marker absent ⇒ abort with full teardown.** If the marker is absent, the leg holds no authority to decide for the operator and MUST abort immediately: run `### Phase 5 — Teardown` (archive/close the tracker project + `rm -rf` the test directory), then exit non-zero. Abort-with-teardown is the ONLY sanctioned no-marker resolution; parking the leg mid-run is not one, because it strands exactly the tracker data and test directory that teardown exists to remove. Reap first: before that teardown runs, `kill` every PID recorded in a still-answering pidfile (identity-checked exactly as the `Final-message self-check` clause's reap-first rule requires) and then `bash -c 'rm -f /tmp/dpt-smoke-<tracker>-*.pid'`, because `rm -rf`-ing a directory a live grandchild is still writing into races it. Both halves of that removal are load-bearing (STE-423): the glob carries the resolved `<tracker>` so a tandem partner's pidfiles are never in the match set, and the `bash -c` wrapper is required because the operator's shell is zsh, where an unmatched glob is an error that would kill the abort itself instead of expanding to nothing.

**There is NO prose-ask-then-end-turn path under non-tty.** Stating the question in prose and ending the turn is not a pause under a headless banner — it is a silent no-op: the leg exits rc=0, the canonical chain never runs, and the tracker project is left orphaned. That is the verbatim 2026-07-24 Linear-leg failure: the driver asked the operator a 3-option rate-limit question, ended its turn, and left the Linear project behind with the chain unrun. So under non-tty there is no prose-ask, no end-the-turn-and-await-an-answer, and nothing between Branch 1 and Branch 2 to exercise discretion over.

**Phase 0's pre-approval `[y/n]` gate is UNAFFECTED.** That gate fires *before* the run starts and is already marker/refusal-routed (§ Phase 0 — Pre-approval gate). This guard governs only judgment calls that surface *after* the run is under way.

#### Workspace-trust spawn gate (STE-356; STE-367)

Before the **first** Phase 2 spawn fires, assert that workspace trust is present for the test-project path — an **operator precondition** per step 6b (the driver never writes it). The scaffolded `.claude/settings.json` allow-list is enforcement-effective only when the spawn cwd's workspace is trusted; spawning without the entry re-creates the 2026-07-02 F4 inert-allow-list state, where every child ran on auto-mode classifier goodwill:

```bash
# Read-only probe; default the config dir (the Phase 2 export may not have run yet).
CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude-st}/.claude.json"
jq -e --arg p "$TEST_REAL" \
  '.projects[$p].hasTrustDialogAccepted == true' "$CFG" > /dev/null
```

**Miss (exit non-zero) ⇒ NFR-10 canonical refusal — do not spawn:**

```text
Verdict: workspace trust missing for <abs test-project path> in $CLAUDE_CONFIG_DIR/.claude.json — the scaffolded allow-list would be inert at the child/grandchild layer (2026-07-02 F4).
Remedy: seed workspace trust ONCE as the operator (the driver cannot — the harness self-modification classifier denies the write under `claude -p`):
  CFG="${CLAUDE_CONFIG_DIR:-$HOME/.claude-st}/.claude.json"
  jq --arg p "<abs test-project path>" '.projects[$p] |= (. // {} + {hasTrustDialogAccepted: true})' "$CFG" > "$CFG.tmp" && mv "$CFG.tmp" "$CFG"
Then re-run /smoke-test. The entry persists across runs (operator-owned; teardown no longer removes it — STE-367).
Context: skill=smoke-test, pre-flight=workspace_trust_check
```

**Hit (exit 0) ⇒ log the byte-checkable capability token** `workspace_trust_present` to the approval record `/tmp/dpt-smoke-<date>-<tracker>-approval.txt` (one literal line, no inference) and proceed to the first spawn. Same shape convention as `/conformance-loop`'s `spawn_pattern_allow_present` token — byte-grep-checkable by downstream `/gate-check` probes and capability-row aggregators. (STE-367 renamed the former seed-time token: the driver asserts trust is present, it no longer seeds it.)

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

**Post-exit steps compose on top, unchanged.** The STE-195 transient-failure detection, the STE-352 capture assertion, and the next sequential spawn all run only after the poll loop reports "exited" — detection runs after exit exactly as it did in the foreground form.

**Residual risk — PID reuse.** `kill -0` answers for *any* live process with that PID, so a recycled PID could in principle keep the poll looping after the grandchild exited. The risk is negligible at a 30 s poll interval on macOS/Linux PID ranges, and the Phase 2.Y chain-integrity assertion is the corroborating signal (a truncated child's capture fails the `result`-event check regardless of what the poll believed) — noted so the wrapper isn't mistaken for a liveness proof. That negligible-risk reading covers the polling loop only — a false positive there merely keeps the poll running. It does not carry to the abort branch's reap below, which sends a real signal: a recycled PID there would terminate an unrelated process, which is exactly why the reap must confirm identity with `ps` before it signals anything.

**Residual risk — orphan-vs-killed nondeterminism (STE-359; iter-2 F3).** If this driver dies while a grandchild is still live, whether that grandchild dies with its parent or survives as an orphan is environment-nondeterministic — process-group inheritance varies with spawn nesting, and iter-2 observed both outcomes in a single run (the Linear `/setup` grandchild was killed with its driver while the Jira one survived and completed healthily on its own). Process-group discipline (`setsid` / PGID-wide kill) was considered and rejected as the primary mechanism: it is OS/shell-dependent and unverifiable from SKILL.md prose. The deterministic recovery lives one layer up — `/conformance-loop`'s Phase A orphan-adoption block scans this driver's per-skill pidfiles post-exit and adopts any still-answering PID, polling it to exit so a surviving orphan's completed capture is recovered as evidence regardless of which way the environment broke.

**Live-pidfile session rule.** Ending the driver session — or reporting results — while any spawned grandchild is alive (a pidfile whose PID still answers `kill -0`) is **forbidden**; the bounded poll loop above is the **only sanctioned wait**. Do not substitute a single foreground Bash call (the 10-minute ceiling SIGTERMs the grandchild — F2), and do not fire the spawn then end the turn "waiting for its completion notification" (a `-p` session cannot resume on background-task notifications, so the rest of the run silently never executes — F3). The poll's exit branch removes the pidfile, so a clean session end leaves zero live pidfiles.

**Red flag — the harness's foreground-sleep block hint is NOT license to background the wait.** If a poll call leads with `sleep`, the harness blocks it with an error hint that reads roughly "Foreground `sleep` is blocked. To wait for a condition, use `run_in_background` or the Monitor tool." Do **not** follow that hint here: handing the wait to `run_in_background`/Monitor and then ending the turn IS the F3 fire-and-exit failure — a `-p` driver session never receives the completion notification, so the rest of the run silently never executes. The bounded poll loop above already avoids the block by gating each iteration on `kill -0` *before* its `sleep 30`; keep waiting with that loop, in the foreground, until the pidfile dies.

**Final-message self-check (STE-357, hardened by STE-414).** Before emitting **any** final message — success or failure — run the pidfile-liveness fence below over the run's own tracker-scoped pidfile glob (`/tmp/dpt-smoke-<tracker>-*.pid` — never a cross-tracker one, which would walk a tandem partner's pidfiles; STE-423). Two triggers arm this check: (1) an *incomplete grandchild chain* — the canonical chain was not run to completion; (2) *any live pidfile* — a spawned grandchild is still running. On either trigger the driver MUST loudly abort — emit an explicit `SMOKE-ABORT: <trigger>` line as the first line of the final message. The abort MUST exit non-zero — a loud banner is not sufficient, because rc is one of several corroborating signals the parent reads — the per-skill log set is another — and a false green must never be reported in the exit code. Signal only what this run spawned: for each PID recorded in a still-answering pidfile, confirm its identity with `ps -p <pid> -o comm=` and reap it only when that reports a `claude` process, because a PID recycled since the `kill -0` probe would otherwise take a real signal aimed at an unrelated process on the operator's machine. The abort MUST reap FIRST, before anything destructive runs: `kill` every PID recorded in a still-answering pidfile, then `rm -f /tmp/dpt-smoke-<tracker>-*.pid`, so the invariant closing this paragraph holds on the abort branch instead of being aspirational. Only once that reap is done may the driver run `### Phase 5 — Teardown` in full (archive/close the tracker project, `rm -rf` the test directory) before the turn ends — quiesce the grandchild first, then destroy the state it was writing into, because tearing down around a live process races it: the grandchild can still be writing into the directory being removed and still posting to the project being archived. A live pidfile must **never end the turn** quietly: if the chain is still runnable, resume the bounded poll loop above and finish it; if it is not, take the abort-with-teardown path. The two branches are ordered, not discretionary — *resume* is available only while the chain can still be finished **in this same turn**, and taking it means no final message is emitted at all; the moment finishing is off the table (the session is ending, the chain is unrunnable, or the remaining work would be picked up in a later turn) the abort-with-teardown path above is the only move left. There is no third branch in which the turn ends while a pidfile still answers `kill -0`.

Exiting rc=0 is not proof the chain ran. This driver must NEVER exit rc=0 silently with an unfinished chain or a live grandchild — a silent rc=0 exit under either trigger IS the failure mode this clause exists to stop (2026-07-24: both conformance legs exited rc=0 in ~8 min without running the chain and left orphaned tracker data behind). A silent success exit is legal only when the canonical chain completed AND zero pidfiles still answer `kill -0`. Stated unqualified, with no adverb left to argue over: the driver must never exit rc=0 on the abort branch, under either trigger, loud or not.

The verdict artifact is what turns that mandate into something the parent can actually check. Under `claude -p` this driver is an LLM turn, not the process — it cannot set the exit status, and the harness returns 0 for any session that finishes — so rc is physically unable to carry the verdict (2026-07-27: the Jira leg opened its final message with `SMOKE-ABORT: incomplete grandchild chain (/implement + /spec-review never ran)` and summarized itself as `VERDICT: FAIL (rc=1)`, while the rc-file the parent collected held `0`, and the documented gate read that `0` and continued). So before the final message is emitted — on every branch, success or failure — write the machine-readable verdict artifact at `/tmp/dpt-smoke-verdict-<tracker>.json` with the `emit` command in the fence below (`adapters/_shared/src/smoke_verdict.ts`, STE-420); it records `outcome` (`pass` / `fail` / `abort`) and, on an abort, the `trigger` that armed it. That verdict artifact — not the process exit status — is the authoritative record of this leg's outcome: `/conformance-loop`'s Phase A reconciles each leg's collected rc against it (missing, malformed, stale, or non-`pass` ⇒ non-zero) before writing the rc-file every documented consumer reads. Feed it BOTH triggers, because the pidfile scan alone sees just one of them: the live-pidfile list the fence computes, and the incomplete-chain finding set from Phase 2.Y's `assertChainIntegrity` (`adapters/_shared/src/smoke_child_capture.ts`).

```bash
# Final-message self-check — run before ANY final message (success or failure).
setopt local_options null_glob 2>/dev/null || shopt -s nullglob 2>/dev/null || true
LIVE=""
for PIDFILE in /tmp/dpt-smoke-<tracker>-*.pid; do
  [ -e "${PIDFILE}" ] || continue
  kill -0 "$(cat "${PIDFILE}")" 2>/dev/null && LIVE="${LIVE} ${PIDFILE}"
done
if [ -n "${LIVE}" ]; then echo "LIVE:${LIVE} — finish the bounded poll loop, or abort loudly, confirm each recorded PID is still a claude process before signalling it, reap these pidfiles, THEN run Phase 5 teardown, and exit non-zero; never exit rc=0"; else echo "no live pidfiles — final message may be emitted (only if the canonical chain completed)"; fi

# STE-420 — emit the verdict artifact, on EVERY branch, before the final
# message. Both triggers feed it: `--live` carries the pidfile scan above, and
# one `--chain-finding` flag per Phase 2.Y assertChainIntegrity finding carries
# the incomplete-chain trigger (omit the flag when the chain is clean — the
# pidfile scan cannot see that trigger). `--outcome` escalates a
# chain-complete, pidfile-clean run this driver is nonetheless reporting as
# SMOKE-TEST FAIL; it can never mask an armed trigger.
DPT_PLUGIN_DIR=/Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit
SMOKE_OUTCOME=pass   # `fail` when reporting SMOKE-TEST FAIL; `abort` on either trigger
bun "${DPT_PLUGIN_DIR}/adapters/_shared/src/smoke_verdict.ts" emit \
  --tracker <tracker> --path /tmp/dpt-smoke-verdict-<tracker>.json \
  --outcome "${SMOKE_OUTCOME}" --live "${LIVE}"
  # …append one `--chain-finding "<diagnostic>"` per Phase 2.Y finding.
cat /tmp/dpt-smoke-verdict-<tracker>.json
```

#### Phase 2 child-spawn discipline (stdin partition)

Every Phase 2 spawn has explicit stdin handling — no spawn relies on the child's default stdin behavior. The spawn surface partitions into two classes by whether the child needs prompt-body input:

- **Non-prompt-bearing children** (`/spec-review`, `/simplify`, `/gate-check`) — the slash command alone fully specifies the work; no extra prompt body is needed. Pipe `< /dev/null` immediately before the log redirect to skip `claude -p`'s 3-second auto-stdin-detect wait (smoke #9 / Linear F5 — STE-188). The warning `Warning: no stdin data received in 3s, proceeding without it.` is the source signal; `< /dev/null` is the documented remediation.
- **Prompt-bearing children** (`/setup`, `/spec-write`, `/implement`) — covered by STE-185's heredoc-on-stdin discipline (per-skill prompt body inlined; see § STE-185 below). Adding `< /dev/null` to those would close stdin before the heredoc body is read and break prompt delivery — the partition is deliberate.

> ⛔ **FORBIDDEN at this spawn site.** Do NOT await a grandchild by any of these four paths: (1) the Bash tool's `run_in_background` parameter; (2) the `Monitor` tool; (3) waiting on a background-task completion notification; (4) ending the turn to await a grandchild ("I'll continue when it exits"). Under `claude -p` the completion notification never arrives (F3, 2026-07-04 conformance run: both legs fire-and-exited here; the 2026-07-24 Jira leg re-ran the same escape). Nor does self-narrating as an "interactive parent" re-open any of the four — the Phase-2-entry `[ -t 0 ]` SMOKE-CTX result is the sole determinant, a headless classification binds this spawn site for the rest of the run, and no self-classification, however phrased, overrides it. The ONLY sanctioned wait for a grandchild is the bounded `kill -0` poll-until-exit loop (§ Grandchild spawn lifecycle above) run in the foreground.

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
# The prose lines are ORIENTATION only — pre-baked `<command-args>`-style text
# is explicitly NOT an auto-apply trigger and answers nothing. The
# `<dpt:answers>v1` … `</dpt:answers>` block below the marker is /setup's only
# legitimate non-tty answer source: under `claude -p` the child has no
# AskUserQuestion tool, so without it step 7b (tracker mode) and step 7f
# (tracker-config write) refuse and the chain truncates at step 1 of 6. The
# marker is a hard precondition for the block, and an unmarked or malformed
# block is inert (see `docs/auto-mode-protocol.md` § Sanctioned Answers Block).
# Detached spawn + PID capture (STE-355); poll until exit before /spec-write.
claude -p \
  --output-format stream-json --verbose \
  --plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit \
  --mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json \
  > /tmp/dpt-smoke-<tracker>-setup.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:setup

stack=Bun+TS, tracker=<tracker>, mcp_server=<the resolved leg's server, omitted entirely on the tracker-less leg>, ...

(Linear path) team=STE, project=<the smoke-test project from Phase 1>, jira_ac_field=blank, branch_template=default, docs flags=all-false; emit `### Linear` workspace binding.
(Jira path) project=<--jira-project flag value>, jira_ac_field=description, branch_template=default, docs flags=all-false, default_labels=[dpt-smoke]; emit `### Jira` workspace binding; skip discover_field.ts (zero-config sentinel path); skip Linear team probe.
(Tracker-less path) docs flags=all-false; emit NO `## Task Tracking` section — absence is the canonical form for `mode: none`; no workspace binding, no mcp_server, no jira_ac_field; skip both tracker probes.

The repo already contains .claude/settings.json and .mcp.json from the driver's pre-creation step; take the idempotent-merge branch — do not overwrite (model-layer block aborts the chain otherwise).

<dpt:answers>v1
stack: Bun+TS
tracker_mode: <tracker>
branch_template: {type}/m{N}-{slug}
user_facing_mode: false
packages_mode: false
changelog_ci_owned: false
token_stats_enabled: false
create_specs: yes
tracker_config: approve
</dpt:answers>
PROMPT_EOF
echo $! > /tmp/dpt-smoke-<tracker>-setup.pid
# STE-448: `tracker_mode: <tracker>` resolves to the leg under test, so on the
# tracker-less leg this block elects `none` — the same key, a different value,
# not a separate answers dialect. `tracker_config: approve` answers step 7f,
# which the `none` branch of step 7b never reaches (it returns to 7c without
# emitting a Schema L section); the answer is therefore INERT on that leg and
# is left in place rather than branched away, because an unread answer costs
# nothing and a per-leg answers block is one more thing to drift.

# /spec-write — heredoc body carries the feature stub. The marker
# `<dpt:auto-approve>v1</dpt:auto-approve>` on its own line is the
# byte-checkable pre-authorization handoff for /spec-write's draft + commit
# gates (STE-226). Without it the gates fire interactively and the child
# halts at the prompt.
# The `<dpt:answers>v1` … `</dpt:answers>` block below carries the pre-baked
# interview answers. Under `claude -p` the child has no AskUserQuestion tool,
# so without the block every clarifying question refuses and the chain
# truncates here; the marker is a hard precondition for the block, and an
# unmarked or malformed block is inert (see `docs/auto-mode-protocol.md`
# § Sanctioned Answers Block).
# Detached spawn + PID capture (STE-355); poll until exit before /implement.
claude -p \
  --output-format stream-json --verbose \
  --plugin-dir /Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit \
  --mcp-config /tmp/dpt-smoke-mcp-config-<tracker>.json \
  > /tmp/dpt-smoke-<tracker>-spec-write.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:spec-write

Add a pure function greet(name?: string) returning 'Hello, <name>!' (defaulting 'world' for undefined / empty / whitespace-only). File src/greet.ts; test src/greet.test.ts; 4 ACs.

<dpt:answers>v1
feature_summary: a pure greet(name?: string) helper returning 'Hello, <name>!' and defaulting to 'world'
acceptance_criteria: 4 ACs — named greeting, undefined name, empty string, whitespace-only string
implementation_file: src/greet.ts
test_file: src/greet.test.ts
changelog_category: Added
milestone: accept the recommended next free milestone
technical_design: one exported pure function, no dependencies; trim the input and fall back to 'world' when the result is empty
testing: bun test unit coverage in src/greet.test.ts, one case per AC, no mocks needed
cross_cutting_requirements: none — the feature is self-contained
out_of_scope: localization, formatting options, and any I/O
non_functional_requirements: none beyond the repo's existing gate
risks: none identified — pure function, no external dependencies
</dpt:answers>
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

**Sanctioned answers block (the interview half).** The marker pre-authorizes approval gates that have a safe default; it does not answer clarifying questions, which have none. Under `claude -p` the child has no `AskUserQuestion` tool registered, so every interview step would refuse and the canonical chain would truncate at `/spec-write` — the failure the 2026-07-27 conformance run hit on both legs — or, once `/setup`'s own gates route through the same helper, one step EARLIER at `/setup`. Both prompt-bearing interview children (`/setup` and `/spec-write`) therefore carry an operator-authored `<dpt:answers>v1` … `</dpt:answers>` block beneath the marker, one `key: value` pair per line, one key per gate the child will reach — `/setup`'s block answers the Schema L resolutions including step 7b's `tracker_mode` and step 7f's `tracker_config`, parsed by `extractAutoAnswers` / `resolveInterviewAnswer` in `plugins/dev-process-toolkit/adapters/_shared/src/auto_answers.ts` and fed to `requireOrRefuse(...)`'s `preBakedValue` slot — the interview is answered, not skipped. The marker is a hard precondition: drop the marker line and the block is inert, and a malformed block (unterminated, or delimiters out of order) fails closed to the same inert result rather than half-answering the interview. Keep every value non-empty — a blank value parses as an answer and would ship a hollow FR. Contract: `docs/auto-mode-protocol.md` § Sanctioned Answers Block.

#### Transient-failure retry-with-rollback for prompt-bearing children (STE-195, widened by STE-430)

Anthropic's API drops a long-running prompt-bearing child spawn (`/setup`, `/spec-write`, `/implement`) mid-response in two observed ways. The stream idles out, exiting the child with the canonical signature `API Error: Stream idle timeout - partial response received` — the 2026-05-04 Jira smoke caught that on `/setup`'s first attempt, whose partial state created `src/.placeholder.test.ts` but no `CLAUDE.md`, no `specs/` scaffold. Or the connection is closed outright with `API Error: Connection closed mid-response` — the 2026-07-27 Linear conformance leg caught that, also on `/setup` attempt 1: the child ran 76 turns, exited `is_error: true` with `terminal_reason: "api_error"`, and produced nothing at all (no `CLAUDE.md`, no `specs/` scaffold, no branch, no commit). Both are transient upstream faults and both cleared on a single re-spawn. STE-195 built the recovery in for the first signature; STE-430 widened it to the second, because on a headless leg there is no operator standing by, so refusing to retry a network blip aborts an otherwise-healthy run.

**Detection signatures.** After each prompt-bearing child exits (the STE-355 poll loop reports exit; detection composes on top of the detached wrapper, unchanged), the driver inspects the child's exit reason / that attempt's own capture (`/tmp/dpt-smoke-<tracker>-<skill>.attempt<N>.log`, per the per-attempt-captures rule below) for EITHER transient signature — `API Error: Stream idle timeout` or `API Error: Connection closed mid-response`. Match is substring (not exact); the trailing `- partial response received`, the `terminal_reason: "api_error"` field that accompanies a connection drop, and any minor wording drift in future Anthropic API versions all still trigger the path. Matching a signature makes the attempt *eligible* for one retry — it does not by itself authorize one; the clean-tree precondition in the very next paragraph is what decides. Non-prompt-bearing children (`/gate-check`, `/spec-review`, `/simplify`) are out of scope — they are short, idempotent, and the existing `< /dev/null` discipline already shields them from the stdin-detect race.

**Clean-tree precondition (the gate that authorizes a retry).** A matched signature only makes the attempt eligible; this probe is what decides. After the failed attempt has exited and BEFORE any rollback or re-spawn, the driver reads `git status --porcelain` inside the **test project's** working directory (e.g., `../dpt-test-project-linear` / `../dpt-test-project-jira`) — NEVER inside the dpt repo cwd, where the operator's own in-flight edits would read dirty and suppress every retry that path exists to allow. Empty output means the failed attempt left the tree byte-identical to its pre-spawn commit, so the rollback below is provably a no-op and the retry is authorized. This is exactly the check the operator ran by hand on 2026-07-27 before spending that run's one retry.

```bash
# Run from the test project's cwd, NEVER from the dpt repo cwd.
# The `:(exclude).phase8` pathspec is load-bearing, not tidiness: Phase 8 prepares
# its per-skill scratch workspaces at `.phase8/<skill>/` INSIDE this same git repo
# (§ Per-skill workspace preparation), so from Phase 8 onward an unfiltered probe
# reads dirty on the driver's own scratch and would forfeit a retry the failed
# attempt did nothing to disqualify. The gate asks "did the failed ATTEMPT leave
# work behind", and driver scratch is not attempt output.
# Read BOTH the output and the exit status: empty output with rc 0 ⇒ retry
# authorized; any output, OR a non-zero rc, ⇒ abort and do not re-spawn.
# A probe that could not run has not established a clean tree.
git status --porcelain -- . ':(exclude).phase8'
```

**Dirty tree ⇒ abort, never retry.** Non-empty `git status --porcelain` output means the failed attempt left work behind, the rollback's blast radius is therefore unknown, and there is no auto-retry. A **non-zero exit status from the probe itself** takes the same branch: a probe that could not run has not established anything, and treating its silence as a clean tree would be the error-reads-as-pass shape this section exists to prevent. Either way: the driver aborts for operator inspection using the same operator-facing shape as the double-transient abort below, with `attempt_1_exit=transient_dirty_tree` and the observed porcelain lines quoted beneath it. This is why widening the signature list does not widen the risk — what a clean tree buys is a rollback known to be a no-op, and the error name alone never authorizes anything.

**Rollback recipe (verbatim).** When the signature is detected and the tree probes clean, the driver runs the following inside the **test project's** working directory (e.g., `../dpt-test-project-linear` / `../dpt-test-project-jira`) — NOT inside the dpt repo cwd. The driver's per-spawn cwd handling already isolates the test project; the rollback inherits that scope. The `-e .claude -e .mcp.json` excludes preserve the parent-pre-created sensitive files (Phase 1 step 6) so the second spawn finds the same `.claude/settings.json` + `.mcp.json` it would on the first attempt.

```bash
# Run from the test project's cwd, NEVER from the dpt repo cwd.
git clean -fdq -e .claude -e .mcp.json && git checkout -- .
```

- `git clean -fdq -e .claude -e .mcp.json` — removes untracked files/directories EXCEPT `.claude/` and `.mcp.json`.
- `git checkout -- .` — reverts tracked-file modifications.
- Combined: returns the test project to its last-committed state plus the parent-pre-created sensitive files.

**Retry budget.** Exactly **one** retry per spawn (two attempts total). A second consecutive transient is treated as genuine and surfaces as a smoke-test failure rather than looping indefinitely — see § Double-transient abort below, which fires on attempt 2. Eligibility turns on the failed attempt's *tree state*, never on the error class alone: a matched transient signature whose attempt left the test project's tree verifiably clean retries once, and everything else — a segfault, an OOM kill, or a transient whose attempt left work behind — halts for operator inspection instead, because a rollback is only safe when the failed attempt's side effects are known.

**Per-attempt captures — attempt 1's log must survive attempt 2.** Each attempt redirects into its OWN capture, `/tmp/dpt-smoke-<tracker>-<skill>.attempt1.log` and `/tmp/dpt-smoke-<tracker>-<skill>.attempt2.log`, and never into one shared path opened with a truncating `>`. Two attempts sharing one path destroy attempt 1's evidence the instant the retry re-spawns, and the audit row below then claims an attempt-1 outcome that nothing on disk corroborates — the only reason the 2026-07-27 run could substantiate its retry at all is that an `attempt1` capture (649,627 bytes) happened to survive out of band. Both per-attempt logs therefore stay on disk for the whole run as the retry's primary evidence, kept separate by construction; once the retry settles the driver promotes the *winning* attempt's capture to the canonical per-skill path (`cp` it over `/tmp/dpt-smoke-<tracker>-<skill>.log`) so every downstream consumer — the STE-352 post-return capture assertion, the Phase 2.X runtime fixtures, Phase 8's transcript extraction — still reads exactly one canonical log. No new cleanup class is needed: both per-attempt names end in `.log` and carry the `.attempt` segment, so Phase 0.5's existing per-tracker wipe already removes them.

**Retry audit row (AC-STE-195.3, widened by STE-430).** After a successful retry, the driver appends a `child_transient_retried` row to the canonical Phase 2 per-skill log (`/tmp/dpt-smoke-<tracker>-<skill>.log`) recording BOTH attempts — each one's UTC ISO-8601 start, its own outcome, and its own capture path — so a widened retry stays legible in the run's audit trail instead of being absorbed into a green run. The outcome vocabulary names WHICH transient fired (`transient_stream_idle` / `transient_connection_closed`, alongside the `transient_dirty_tree` abort value above) rather than assuming the stream-idle class STE-195 started from, and `transient=<kind>` on the header line carries the same fact in one greppable field. The row was named `child_stream_idle_retried` before STE-430 widened the signature list; that name mislabeled every connection drop it recovered from. Template:

```
2026-07-27T06:42:11Z child_transient_retried skill=/setup attempts=2 transient=connection_closed
  attempt_1_started=2026-07-27T06:40:07Z attempt_1_exit=transient_connection_closed
  attempt_1_capture=/tmp/dpt-smoke-<tracker>-setup.attempt1.log
  attempt_2_started=2026-07-27T06:42:33Z attempt_2_exit=success
  attempt_2_capture=/tmp/dpt-smoke-<tracker>-setup.attempt2.log
```

**Double-transient abort (AC-STE-195.4).** When the second attempt also exits on a transient signature — the same class or the other one — the driver aborts the smoke run with NFR-10 canonical refusal naming the skill that failed twice, both attempts' timestamps and outcomes (each naming its own transient kind), both per-attempt capture paths so the operator can read either attempt's evidence, and the rollback recipe operators can run manually if a further attempt is appropriate. The abort message is verbatim:

```
ABORT: /smoke-test Phase 2 spawn /<skill> transient failure twice
  attempt_1_started=<ts1> attempt_1_exit=transient_<kind1>
  attempt_1_capture=/tmp/dpt-smoke-<tracker>-<skill>.attempt1.log
  attempt_2_started=<ts2> attempt_2_exit=transient_<kind2>
  attempt_2_capture=/tmp/dpt-smoke-<tracker>-<skill>.attempt2.log
  rollback recipe: git clean -fdq -e .claude -e .mcp.json && git checkout -- .
```

**Worked example (Phase 2 `/setup` spawn, retry-success path).** The driver wraps the existing detached heredoc-on-stdin spawn (above) in a two-attempt loop scoped to the prompt-bearing-children spawn surface only. Pseudocode spanning multiple driver Bash calls (the loop is sequential, not parallel; each `[STE-355 …]` comment marks where the bounded poll-until-exit calls run before the next line executes):

```bash
# cwd: test project root, e.g. ../dpt-test-project-jira
export CLAUDE_CONFIG_DIR=~/.claude-st   # STE-350: exported once per spawning block so every spawn line begins bare with `claude` and the tracked `Bash(claude:*)` allow entry matches.
attempt_1_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# Attempt 1 captures into its OWN log — attempt 2 below writes a different
# path, so nothing here is truncated by the retry.
claude -p ... > /tmp/dpt-smoke-<tracker>-setup.attempt1.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:setup
...prompt body...
PROMPT_EOF
echo $! > /tmp/dpt-smoke-<tracker>-setup.pid
# [STE-355: bounded poll calls (kill -0 + sleep 30) until the PID exits]
# Promote attempt 1 to the canonical log downstream phases read; the
# per-attempt capture stays on disk as the audit trail's evidence.
cp /tmp/dpt-smoke-<tracker>-setup.attempt1.log /tmp/dpt-smoke-<tracker>-setup.log

TRANSIENT_RE='API Error: (Stream idle timeout|Connection closed mid-response)'
if grep -qE "$TRANSIENT_RE" /tmp/dpt-smoke-<tracker>-setup.attempt1.log; then
  # Name WHICH transient fired — the audit row must not label a connection
  # drop as a stream idle.
  if grep -q 'API Error: Stream idle timeout' /tmp/dpt-smoke-<tracker>-setup.attempt1.log; then
    kind=stream_idle
  else
    kind=connection_closed
  fi
  attempt_1_exit=transient_$kind
  # Clean-tree GATE — probe the tree BEFORE any rollback or re-spawn, and read
  # it in the test project's cwd, NEVER in the dpt repo cwd. Phase 8's own
  # `.phase8/` scratch is excluded: it is driver scratch, not attempt output.
  # Capture stdout AND the exit status. A failed `git status` (not a repo, an
  # unreadable index, git missing) prints nothing, so testing stdout alone
  # would read that failure as a CLEAN tree and authorize the rollback — an
  # error-reads-as-pass in the one probe that decides whether a rollback is
  # safe to run unattended. An unusable probe is not a clean tree.
  dirty=$(git status --porcelain -- . ':(exclude).phase8'); probe_rc=$?
  if [ "$probe_rc" -ne 0 ] || [ -n "$dirty" ]; then
    # Tree not provably clean ⇒ no auto-retry; the rollback is not known-safe.
    cat <<EOF >> /tmp/dpt-smoke-<tracker>-setup.log
ABORT: /smoke-test Phase 2 spawn /setup transient exit with a dirty tree
  attempt_1_started=$attempt_1_started attempt_1_exit=transient_dirty_tree
  attempt_1_capture=/tmp/dpt-smoke-<tracker>-setup.attempt1.log
  porcelain: $dirty
  rollback recipe: git clean -fdq -e .claude -e .mcp.json && git checkout -- .
EOF
    exit 1
  fi
  # Tree verified clean ⇒ retry authorized. Rollback BEFORE the second attempt
  # (a no-op by construction here); recipe runs in test project cwd.
  git clean -fdq -e .claude -e .mcp.json && git checkout -- .

  attempt_2_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  claude -p ... > /tmp/dpt-smoke-<tracker>-setup.attempt2.log 2>&1 <<'PROMPT_EOF' &
<dpt:auto-approve>v1</dpt:auto-approve>
/dev-process-toolkit:setup
...same prompt body...
PROMPT_EOF
  echo $! > /tmp/dpt-smoke-<tracker>-setup.pid
  # [STE-355: bounded poll calls (kill -0 + sleep 30) until the PID exits]
  # Promote attempt 2; attempt 1's capture is untouched beside it.
  cp /tmp/dpt-smoke-<tracker>-setup.attempt2.log /tmp/dpt-smoke-<tracker>-setup.log

  if grep -qE "$TRANSIENT_RE" /tmp/dpt-smoke-<tracker>-setup.attempt2.log; then
    if grep -q 'API Error: Stream idle timeout' /tmp/dpt-smoke-<tracker>-setup.attempt2.log; then
      attempt_2_exit=transient_stream_idle
    else
      attempt_2_exit=transient_connection_closed
    fi
    # Double transient — NFR-10 abort, do not run further skills.
    cat <<EOF >> /tmp/dpt-smoke-<tracker>-setup.log
ABORT: /smoke-test Phase 2 spawn /setup transient failure twice
  attempt_1_started=$attempt_1_started attempt_1_exit=$attempt_1_exit
  attempt_1_capture=/tmp/dpt-smoke-<tracker>-setup.attempt1.log
  attempt_2_started=$attempt_2_started attempt_2_exit=$attempt_2_exit
  attempt_2_capture=/tmp/dpt-smoke-<tracker>-setup.attempt2.log
  rollback recipe: git clean -fdq -e .claude -e .mcp.json && git checkout -- .
EOF
    exit 1
  fi

  # Retry succeeded — append the audit row naming BOTH attempts and both
  # surviving captures.
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  cat <<EOF >> /tmp/dpt-smoke-<tracker>-setup.log
$now child_transient_retried skill=/setup attempts=2 transient=$kind
  attempt_1_started=$attempt_1_started attempt_1_exit=$attempt_1_exit
  attempt_1_capture=/tmp/dpt-smoke-<tracker>-setup.attempt1.log
  attempt_2_started=$attempt_2_started attempt_2_exit=success
  attempt_2_capture=/tmp/dpt-smoke-<tracker>-setup.attempt2.log
EOF
fi
```

The same wrapper applies symmetrically to `/spec-write` and `/implement` — substitute the slash command, the per-skill log filename, and the heredoc body. Non-prompt-bearing spawns (`/gate-check`, `/spec-review`, `/simplify`) bypass the wrapper entirely; their `< /dev/null` snippet stays unchanged.

#### Post-return capture assertion — non-empty / non-denied (STE-352)

After **each** Phase 2 child exits (prompt-bearing and non-prompt-bearing alike; the STE-355 poll loop has reported exit and any transient-failure retry above has settled), the driver asserts the child actually produced output and no nested spawn was denied — the direct detector for the M94 0-byte-grandchild symptom, where a child whose nested `claude -p` spawn was blocked by the permission classifier still exited green over an empty log:

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

#### Capability-row evidence — the shared assistant-scoped runner (STE-421)

Every "did the skill emit its capability row?" assertion below — and in Phase 9 — resolves through the bundled `capability_row_assert.ts` runner. **Never through `grep` on the capture.** The reason is measured, not theoretical: `claude -p` injects the invoked skill's SKILL.md body into the transcript as a **single synthetic `user` event** (`{"type":"user","isSynthetic":true,…}`, a text block — *not* a tool_result), and that body enumerates the skill's own capability keys. So every key a skill **documents** is present in the raw log of **every** capture of that skill, unconditionally, never run-dependently. On the 2026-07-27 run one 83 KB synthetic-user event accounted for all five `/spec-write` keys' raw hits on a leg where `/spec-write` refused at its first-turn gate and emitted nothing at all — fixtures 1a, 5a and 6 each scored PASS against a total non-emission.

The runner projects the capture through `extractAssistantText` (only `assistant` events' text blocks survive) and scores that. It also subtracts occurrences that land **after** the STE-408 refusal marker `<dpt:requires-input-refused>v1</dpt:requires-input-refused>` in that projection: those are post-refusal explanatory prose ("no row exists because § 7 was never reached"), never emissions — which is what stops a *correct* refusal from being reported as a marker-contract regression by the absence-asserting fixtures (1b, 5b). The rule is positional: the same token ahead of the marker still scores PRESENT.

```bash
PLUGIN_DIR=/Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit
CAP_ASSERT=${PLUGIN_DIR}/adapters/_shared/src/capability_row_assert.ts
# usage: bun "${CAP_ASSERT}" <present|absent|any-of> <capture.log> <key…>
#   present  every named key emitted        absent  none emitted
#   any-of   at least one emitted           exit 0 = expectation met, 1 = not
```

The runner prints one line — `<expectation>: <ok|fail> <key>=<present|absent>(assistant=N,post-refusal=N,raw=N)` — so a failing fixture's diagnostic can quote the assistant-vs-raw split directly and the operator can see at a glance whether the old method would have disagreed. Unit coverage: `tests/m116-ste-421-assistant-scoped-capability.test.ts`.

#### Fixture group 1 — STE-226 spec-write marker carve-out (Linear + Jira + tracker-less)

Two sub-fixtures verify that the byte-checkable marker (`<dpt:auto-approve>v1</dpt:auto-approve>`) is the **only** trigger for `/spec-write`'s draft + commit auto-apply path. STE-213 (M55) and STE-220 (M56) attempted the same carve-out via prose-only contracts and both falsified end-to-end across four smoke runs; STE-226 (M59) replaces the prose-only detection with this byte-checkable marker. The two sub-fixtures together close both directions of the failure surface — marker-present must auto-apply (1a), marker-absent must NOT auto-apply (1b).

##### Sub-fixture 1a — marker present (audit rows present)

**Source:** `/tmp/dpt-smoke-<tracker>-spec-write.log` (already captured during Phase 2 step 2 — no new spawn needed; the canonical Phase 2 `/spec-write` heredoc carries the marker on its first body line).

**Assertions:**

- `bun "${CAP_ASSERT}" present /tmp/dpt-smoke-<tracker>-spec-write.log spec_write_draft_default_applied spec_write_commit_default_applied` exit 0 (both rows emitted in the child's own assistant text).

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

- `bun "${CAP_ASSERT}" absent /tmp/dpt-smoke-<tracker>-spec-write-1b.log spec_write_draft_default_applied spec_write_commit_default_applied` exit 0 (neither row emitted — gate fired interactively, no auto-apply). A refusal that *explains* the missing rows in its wrap-up prose is still `absent`: the runner discounts occurrences downstream of the refusal marker.
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

If both sub-fixtures pass, append `STE-226 runtime check: PASS` to the run summary line; any sub-fixture failure appends `STE-226 runtime check: FAIL`, and a group whose sub-fixtures never executed appends `STE-226 runtime check: NOT-REACHED` (never nothing — see § Phase 2.X summary line). If only 1a passes, the marker contract is half-broken (auto-apply still fires regardless of the trigger) — surface as a high-severity finding so triage prioritizes the loose-trigger regression over the absent-trigger regression (the loose direction is the riskier one for unattended `claude -p` runs).

#### Fixture group 2 — STE-221 probe #26 ## Notes scanner (Linear-only)

Three sub-fixtures, each writing a temporary FR file under `specs/frs/`, invoking `claude -p /dev-process-toolkit:gate-check`, capturing stdout, then cleaning up. Linear leg only — probe #26 needs an adapter declaring Schema M `project_milestone: true`; Jira declares `false` and a tracker-less project has no adapter at all.

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

If all three pass, append `STE-214 runtime check: PASS` to the run summary line; any sub-fixture failure appends `STE-214 runtime check: FAIL`. On the Linear leg a group that never executed appends `STE-214 runtime check: NOT-REACHED` — that is the exact line the 2026-07-27 Linear leg owed and did not emit. On the Jira leg the group is n/a by design (probe #26 is vacuous there) and appends `STE-214 runtime check: N/A`, which is not a gap; § Phase 2.X summary line keeps the two apart.

#### Fixture group 3 — STE-222 cross-cutting drift propagation (Linear + Jira + tracker-less)

Three sub-fixtures. Every rostered leg runs — `/implement`'s Phase 4b' propagation hook is adapter-agnostic.

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

- Stage: pre-create a stale leaf in `specs/technical-spec.md` referencing a path that doesn't exist on disk (no `/implement` run). The leaf token MUST contain a `/` to qualify as a path-shaped reference (the probe filters bare-basename tokens by design — see F8 follow-up: a path like `src/staleref-fixture-3c.ts` qualifies; a bare `staleref-fixture-3c.ts` does not). **The leaf MUST sit inside a directory-tree fence — one opened bare (` ``` `), ` ```text `, or ` ```tree `.** Since M118/STE-433 the probe reads the fence info string and scans only those three; a leaf staged inside a language-tagged fence (` ```dart `, ` ```sh `, ` ```yaml `, …) yields zero violations and scores a correct probe as broken — the same failure shape as the STE-421 AC.4 spelling mismatch recorded in the assert below.
- Invoke + capture: `claude -p /dev-process-toolkit:gate-check` → `/tmp/dpt-smoke-<tracker>-ste222-probe.log`.
- Assert: `bun "${CAP_ASSERT}" present /tmp/dpt-smoke-<tracker>-ste222-probe.log cross_cutting_spec_stale_file_refs` exit 0, with ADVISORY context (NOT `GATE FAILED` — STE-215 AC.5 specifies ADVISORY). The probe surfaces as `probe #37` in the verdict block. **The asserted token is the UNDERSCORED one** — that is what the probe's violation message actually emits at runtime. The hyphenated spelling is the probe *id* used in prose (above and in `/gate-check`'s own SKILL body); asserting it here scored a correct probe run as broken (STE-421 AC.4).
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

The `git log excerpt` line is STE-222-specific (vs. group 2's stdout-only diagnostic) — `/implement` failures often surface in `git log` shape rather than stdout content, so the diagnostic carries both. If all three pass, append `STE-215 runtime check: PASS` to the run summary line; any sub-fixture failure appends `STE-215 runtime check: FAIL`, and a group that never executed appends `STE-215 runtime check: NOT-REACHED` rather than nothing at all.

#### Phase 2.X summary line

Append the following lines to the run summary, in order:

- `M56 runtime checks: PASS (STE-226 + STE-214 + STE-215 verified at runtime)` — all 7 sub-fixtures of groups 1–3 green **on this leg**. Group 1's token is `STE-226`, matching the runtime-check line it actually emits; the older `STE-220` spelling is that group's *diagnostic* prefix and is not greppable as a runtime-check line. This line is a claim about seven sub-fixtures that ran, so it is forfeited by any group nobody reached, not merely by a regression.
- `M56 runtime checks: <N> regressions surfaced (see findings file)` — 1+ failures; each failure already logged its canonical `STE-<sut> runtime regression: …` diagnostic. Phase 3 (Capture) folds the diagnostics into the findings file under a `## Phase 2.X regressions` heading.
- The per-group block described below — one `STE-<sut> runtime check: <PASS|FAIL|NOT-REACHED|N/A>` line for **every** fixture group the canonical roster carries, on every run, with no exceptions. Read the count from the roster rather than from this sentence — the roster is the authority, and a count restated here is a second copy that goes stale the next time a group is added.

**A group that did not execute is never rendered as a pass (STE-425).** Every fixture group carries exactly one of four outcomes — `PASS`, `FAIL`, `NOT-REACHED`, `N/A` — and each group's footer paragraph names the line it contributes. Groups 4–8 spell out only their `PASS` and `FAIL` branches, and that is not a two-outcome exemption: the renderer below owns all four for every group on the roster, so an unreached group 6 renders `NOT-REACHED` whether or not its own footer says the word. Groups 1–3 name the branch explicitly because theirs is the silence that was actually absorbed. The aggregate is computed from those records and from nothing else, so it can never infer that a group passed from the absence of a complaint about it: a `NOT-REACHED` record fails the run exactly the way a `FAIL` does, and a run that produces no records at all is a FAIL rather than a green run with nothing to say. Before STE-425 the footers for groups 1, 2 and 3 documented a PASS branch only and could render nothing else — which is how the 2026-07-27 Linear leg's unreached group 2 was absorbed into a green aggregate instead of being named.

**`NOT-REACHED` and `N/A` are different findings, and collapsing them into one bucket re-creates the same bug one level up.** `NOT-REACHED` means the group applies to this leg and did not run — a real coverage gap the operator owes a decision on (wall-clock exhaustion, an earlier refusal that truncated the chain, a leg that ended early). `N/A` means this leg's by-design roster excludes the group: group 2 is Linear-only because probe #26, its system under test, is vacuous on Jira, so its silence on the Jira leg is correct and costs the run nothing. A single bucket would either forge a gap on every Jira run or hide a genuine Linear-leg gap behind a by-design exemption.

Compute the block instead of tallying it by hand. `adapters/_shared/src/smoke_fixture_groups.ts` — the per-fixture-group sibling of `smoke_verdict.ts`'s per-leg model — holds the canonical fixture-group roster with each group's SUT token and leg roster, reconciles the groups this leg actually reported against that roster, renders the head line plus the per-group lines, and returns a non-zero exit status whenever the aggregate is not a pass:

```bash
# Groups named by neither flag come back NOT-REACHED — or N/A when this leg's
# roster excludes them. Neither renders as PASS.
bun "${PLUGIN_DIR}/adapters/_shared/src/smoke_fixture_groups.ts" render \
  --leg <the resolved leg> --passed "<group numbers>" --failed "<group numbers>"
```

Head line shape: `Fixture groups: <PASS|FAIL> — <n> passed, <n> failed, <n> not-reached, <n> n/a`. Unit coverage: `tests/m117-ste-425-falsifiable-coverage.test.ts`.

The two M56 lines above aggregate groups 1–3 because their three SUTs (STE-213 / STE-214 / STE-215) shipped together in M55 and roll up under one milestone-level result. Groups 4–7 (M64 cohort) intentionally do NOT roll up to a single `M64 runtime checks:` line — each of the four SUTs (STE-227 / STE-228 / STE-230 / STE-225) ships its own per-FR runtime-check line so a regression in one is operator-visible without scrolling into the per-fixture diagnostics. The runtime-check line each new group contributes is named in the group's footer paragraph below.

Phase 2.X is **shared infrastructure** for runtime regression coverage. Groups 1–3 (M56 cohort, STE-220 / STE-221 / STE-222) pin the M55 SKILL.md-prose fixes (STE-213 / STE-214 / STE-215). Groups 4–7 (M64 cohort, STE-231) pin the M58 / M60 / M61 / M63 runtime contracts (STE-227 / STE-228 / STE-230 / STE-225). Group 8 (M94 cohort) pins the STE-350 nested-spawn allow-list fix. Group 9 (M121 cohort, STE-450) pins the identity surfaces that only exist under `mode: none` — probe #13's and probe #73's enforcing arms, plus the probe-#26 skip-reason leak check. Group 10 (M121 cohort) pins the tracker-less lock lifecycle — that `.dpt/locks/<id>` is genuinely written when work is claimed, which the end-of-run absence row cannot establish on its own. Future SKILL.md-prose fixes (any FR shipping a behavior change via instructional text in `skills/<X>/SKILL.md`) should add their own fixtures here following the `STE-<sut> runtime regression: <fixture-name>` diagnostic shape — naming the system-under-test, not the test FR.

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
- Step 2: `bun "${CAP_ASSERT}" present /tmp/dpt-smoke-linear-no-tech-step-2.log implement_refused_needs_technical_review` exit 0 (capability row emitted in the child's assistant text); `git -C ../dpt-test-project-linear log --oneline --since '<step-2-start>'` returns no rows (no commit landed during step 2).
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

#### Fixture group 5 — STE-228 branch-gate marker contract (Linear + Jira + tracker-less)

Two sub-fixtures (5a marker present + 5b marker absent) verify both directions of the branch-gate marker contract introduced by STE-228 (M61) — auto-apply when the `<dpt:auto-approve>v1</dpt:auto-approve>` marker is present on the proposing skill's prompt body, halt interactively when the marker is absent. Both sub-fixtures run on every rostered leg (2 sub-fixtures x 3 legs = 6 fixture instances per smoke run).

##### Sub-fixture 5a — marker present (auto-apply path)

**Source:** the existing canonical-chain `/spec-write` Phase 2 step 2 log at `/tmp/dpt-smoke-<tracker>-spec-write.log` (already captured during Phase 2 step 2 — no new spawn needed; the canonical Phase 2 `/spec-write` heredoc carries the marker on its first body line).

**Assertions:**

- `bun "${CAP_ASSERT}" present /tmp/dpt-smoke-<tracker>-spec-write.log branch_gate_default_applied` exit 0 (gate auto-applied with the marker present).
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

- `bun "${CAP_ASSERT}" absent /tmp/dpt-smoke-<tracker>-spec-write-5b.log branch_gate_default_applied` exit 0 (row not emitted — gate fired interactively, no auto-apply).
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

#### Fixture group 6 — STE-230 spec-research subagent runtime (Linear + Jira + tracker-less)

Single sub-fixture; runs on every rostered leg. The smoke driver does not spawn a new child — the assertion runs against the existing `/tmp/dpt-smoke-<tracker>-spec-write.log` from Phase 2 step 2.

**Source:** `/tmp/dpt-smoke-<tracker>-spec-write.log` (already captured during Phase 2 step 2 — `/spec-write` invokes the spec-research forked subagent during the `## 1) Frame the goal` retrieval step per STE-230).

**Assertion (lenient):**

- `bun "${CAP_ASSERT}" any-of /tmp/dpt-smoke-<tracker>-spec-write.log spec_research_invoked spec_research_no_matches spec_research_shape_violation` exit 0 (at least one of the three audit rows emitted).

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

#### Fixture group 7 — STE-225 TDD orchestrator forks runtime (Linear + Jira + tracker-less)

Single sub-fixture; runs on every rostered leg. The smoke driver does not spawn a new child — the assertion runs against the existing `/tmp/dpt-smoke-<tracker>-implement.log` from Phase 2 step 3.

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

#### Fixture group 8 — STE-350 nested `claude -p` spawn allow-list (Linear + Jira + tracker-less)

One live sub-fixture (8a) reproduces a **live nested spawn** — the runtime counterpart to the static `/gate-check` probe `spawn_pattern_allowlist` (STE-351.2's fence). The M94 root cause: the tracked `.claude/settings.json` `permissions.allow` array omitted the child-spawn pattern `Bash(claude:*)`, so the auto-mode permission classifier denied every nested spawn headless — a 0-byte grandchild capture beneath weeks of green runs. This group asserts the patched allow-list actually admits a nested spawn at runtime. The matching negative — pattern removed ⇒ denial **caught** rather than silently passed — was **retired as a live fixture** by STE-425 and re-homed as a deterministic check in `bun test`; see § Why the negative half is not a live sub-fixture below.

##### Sub-fixture 8a — positive (nested spawn completes non-empty under the patched allow-list)

The driver fires a minimal child spawn constructed at smoke-driver runtime and described here in prose only (same rationale as sub-fixture 1b: no authored heredoc snippet for the `auto_approve_marker_in_canonical_spawns` probe to pick up). The child's prompt instructs it to run exactly one nested `claude -p 'reply with the single word pong'` via its Bash tool from inside the test project — whose `.claude/settings.json` carries the patched allow-list per Phase 1 step 6 — and echo the grandchild's stdout back into its own output. Capture to `/tmp/dpt-smoke-<tracker>-ste350-nested.log` (stream-json NDJSON, like every Phase 2 spawn).

**Assertions:**

- `wc -c < /tmp/dpt-smoke-<tracker>-ste350-nested.log` > 0 AND the grandchild's reply token (`pong`) appears in the capture — the nested spawn completed with non-empty output.
- `checkChildSpawnCapture` (`adapters/_shared/src/smoke_child_capture.ts`, the same detector Phase 2's post-return assertion uses) reports no `permission_denials[]` entry whose `tool_input.command` head is `claude`.

Persist the 8a capture under `tests/fixtures/nested-spawn/8a-<tracker>-<YYYY-MM-DD>.log` for replay during regression triage (mirrors Phase 8's `tests/fixtures/socratic-first-turn/` convention).

##### Why the negative half is not a live sub-fixture (STE-425, retired 2026-07-27)

The operator's global `~/.claude-st/settings.json` carries `permissions.defaultMode: auto`, so the harness safety **classifier** — **not** the tracked `permissions.allow` array — is the operative gate for a nested spawn in this environment. MEASURED on both legs of 2026-07-27, with `Bash(claude:*)` verified absent from the test project's allow-list: the grandchild still returned its `pong` token and the child's `result` event carried `permission_denials: []` — the array is simply never populated when the classifier governs — so the negative scored PASS whether `checkChildSpawnCapture` worked or not. A fixture that cannot fail is strictly worse than no fixture, and this one survived three consecutive runs (2026-07-19, 2026-07-20, 2026-07-27) before it was caught.

Re-founding it as a *live* negative would mean flipping the operator's **global** default permission mode from the driver, which the harness self-modification classifier reliably denies under `claude -p` (the same guard documented at Phase 1 step 6b for the `hasTrustDialogAccepted` seed), and covertly retrying past that guard is out of bounds. There is therefore no runtime shape this negative can take on this driver, and no staging of the test project's `.claude/settings.json` is performed for it any more.

The regression value moves to a deterministic **mutation** check under `bun test`: `plugins/dev-process-toolkit/tests/m117-ste-425-falsifiable-coverage.test.ts` § AC-STE-425.1 feeds `checkChildSpawnCapture` a synthesized capture carrying a `claude`-headed `permission_denials[]` entry and asserts the high-severity finding fires, then re-runs that same assertion against a mutant whose head-anchored `claude` predicate is disabled and asserts it FAILS. It additionally pins the 0-byte-capture arm and the mid-string `claude -p` non-match, so the detector cannot satisfy the mutation for the wrong reason. That check **can** fail; the live negative demonstrably could not. Anyone touching `adapters/_shared/src/smoke_child_capture.ts` is caught there by the gate, with no smoke run required.

**Diagnostic on failure:**

```
STE-350 runtime regression: nested-spawn-empty-or-denied
  expected: 8a — nested spawn completes non-empty under the patched allow-list, with no claude-headed permission_denials entry
  actual:   <observed state>
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-<tracker>-ste350-nested.log>
```

If sub-fixture 8a passes on a leg, append `STE-350 runtime check: PASS` to the run summary line; any failure appends `STE-350 runtime check: FAIL`.

#### Fixture group 9 — STE-321 tracker-less identity surfaces (tracker-less-only)

Three sub-fixtures, and this group is the structural MIRROR of group 2. That group is Linear-only because its system under test goes **vacuous** elsewhere; this one is tracker-less-only because the two probes 9a and 9b exercise **invert** elsewhere rather than merely going quiet. Under any tracker mode gate probe #13 requires exactly the `tracker:` block this group asserts is forbidden, and forbids exactly the `id:` line this group asserts is required; probe #73 likewise requires the plan `id:` to be absent. Neither enforcing arm is reachable from a leg that configures a tracker, however well that leg runs — so this is not the tracker legs' coverage repeated at a different setting, it is coverage nothing else has.

9c is the exception and is stated as one rather than folded in: its subject, probe #26, is the ordinary **vacuity** case — group 2's rationale exactly — and it rides on this group because the leak it checks is only observable where the probe goes quiet. Do not read "invert" as covering all three.

Registering it is also the only evidence the roster's `legs` field is genuinely N-way data. Before this group every roster was either the whole registered leg set or a subset of the two tracker legs, so a two-state flag would have modelled the table exactly; a group rostering `["none"]` alone cannot be expressed that way. Group 2 could not supply that evidence by itself — one exemption on the leg the field was originally written around is what a flag looks like too.

**The three sub-fixtures are independent and fail independently.** Each carries its own named diagnostic, so one failure names *which* identity surface broke instead of reporting the group as generically red. The diagnostic PREFIXES are not one-per-SUT and should not be read as such — 9a and 9b share `STE-321` while naming their respective probes inside their `expected:` lines, and only 9c takes a different prefix. The group's runtime-check line carries `STE-321` — the FR that owns probe #13's bidirectional **`tracker:`** invariant, which is 9a's red-producing input and the surface the group is centred on. Note what that token does NOT claim: the bimodal **`id:`** invariant in the same probe belongs to STE-86, and probe #73's mode-none minted arm to M115's minting cohort. A group spanning three systems under test cannot name them all in one line, so it names the one its own falsifiability rests on.

9c departs from the house shape deliberately and it is worth saying so, because group 3 is NOT the precedent it looks like: there all three sub-fixtures share a single `STE-215 runtime regression:` prefix even though 3c's real subject is probe #37. 9c instead carries its own `STE-238 runtime regression:` prefix, because the convention this phase states is "name the system under test, not the fixture's own FR", and 9c's is genuinely a different FR from 9a's. The group's summary line is unaffected — it is keyed on the roster's `sut`, not on any diagnostic prefix.

##### Sub-fixture 9a — probe #13's enforcing arm (minted `id:` required, `tracker:` block forbidden)

Both directions, because either alone is satisfiable by a probe that never fires at all.

- **Control.** Leave the test project's own FR untouched (minted `id:`, no `tracker:` block — the artifact AC-STE-448.7 already verifies on this leg). Invoke `claude -p /dev-process-toolkit:gate-check` in `../dpt-test-project-none`, capture stdout to `/tmp/dpt-smoke-<tracker>-ste450-control.log`, and assert no `identity_mode_conditional` violation is reported.
- **Violation.** Stage one extra FR at `../dpt-test-project-none/specs/frs/<TAIL2>.md` carrying (i) a **freshly minted** `id:` — never a copy of an id already on disk, which would trip probe #13's cross-file duplicate-tail pass instead and score this assertion red for the wrong reason, (ii) the mode-invariant frontmatter keys `title` / `milestone` / `status` / `archived_at` / `created_at`, and (iii) a populated `tracker:` block. Invoke and capture to `/tmp/dpt-smoke-<tracker>-ste450-tracker-block.log`. Assert the run reaches `GATE FAILED` **and** the capture carries the probe's own message `mode-none FR carries a tracker: block that should be absent`.
- Cleanup: remove the staged FR.

**Diagnostic on failure:**

```
STE-321 runtime regression: <9a-control | 9a-tracker-block>
  expected: <no identity_mode_conditional violation | GATE FAILED naming the staged FR's tracker: block>
  actual:   <observed>
  stdout excerpt (last 20 lines):
    <tail -20 of the relevant log>
```

##### Sub-fixture 9b — probe #73's enforcing arm (the minted plan's id self-derives its filename)

The plan-side twin, and the half that an id-only check cannot reach: the filename stem is six of the recorded id's twenty-nine characters, so a plan can carry a perfectly valid `id:` under a stem derived from something else entirely and every id-shape check still passes.

- **Control.** The run's own plan at `../dpt-test-project-none/specs/plan/M_<TAIL>.md` (or its `archive/` path) is left as-is; the control capture from 9a is reused rather than re-spawned. Assert no `plan_identity_mode_conditional` violation is reported.
- **Violation.** Stage one extra plan file whose stem is a **valid but different** minted key from the one its own frontmatter `id:` derives — mint a second id, name the file from the first, record the second. Invoke and capture to `/tmp/dpt-smoke-<tracker>-ste450-plan-stem.log`. Assert `GATE FAILED` **and** the probe's message `mode-none minted plan's id: does not derive its own filename`.
- Cleanup: remove the staged plan.

Do NOT stage this violation by renaming a sequential `M<N>.md` into place: a sequential tracker-less plan introduced today is classified `fresh` by probe #73's git-provenance arm and fails for that reason instead, which is a different row with a different remedy and would score this assertion green-for-the-wrong-reason in reverse.

**Diagnostic on failure:**

```
STE-321 runtime regression: <9b-control | 9b-plan-stem>
  expected: <no plan_identity_mode_conditional violation | GATE FAILED naming the staged plan's non-deriving id>
  actual:   <observed>
  stdout excerpt (last 20 lines):
    <tail -20 of the relevant log>
```

##### Sub-fixture 9c — the cross-mode skip-reason leak check

The cheapest of the three and the one pinning a real cross-mode leak: a skip reason authored for the tracker case can survive into a mode where the remedy it names is nonsense. Probe #26 goes vacuous here — its system under test needs an adapter declaring Schema M `project_milestone: true`, and a tracker-less project has no adapter at all — so whatever it says about itself on this leg is said to a project that can never act on it.

- Assert `grep -c 'require Linear MCP' /tmp/dpt-smoke-<tracker>-ste450-control.log` is `0`. The phrase exists in this repository only as a negative pin, so any occurrence in a capture is a fresh paraphrase — which is exactly the F9 finding STE-238 was written for.
- Assert the canonical rendering is the one the shared helper produces, by running it rather than by restating it: `bun -e` over `adapters/_shared/src/tracker_probe_skip_reason.ts`, calling `renderProbeSkipReason` with cause `mode_none`, prints a line naming `mode: none` as the cause and containing no MCP remedy. That output is the byte-checkable arbiter; a skip line in the capture that speaks for probe #26 must agree with it.

> **Read this before recording 9c as coverage of the routing claim.** `renderProbeSkipReason` has **no production caller**. Probe #26's mode-none path returns an empty report and emits no text at all, so "the skip text routes through the shared renderer" is enforced today as a **directive** in `plugins/dev-process-toolkit/skills/gate-check/SKILL.md`, not as a wired call — a model that ignores the directive produces no skip line for the first assertion to catch, and only the forbidden-phrase assertion still bites. The positive half is therefore conditional by construction and 9c does not claim otherwise. Recorded at `specs/notes/follow-ups.md` § 0g; closing it means wiring the probe, which is outside STE-450's scope.

**Diagnostic on failure:**

```
STE-238 runtime regression: 9c-skip-reason-leak
  expected: no `require Linear MCP` in the capture; any probe #26 skip line agrees byte-for-byte with renderProbeSkipReason(cause: mode_none)
  actual:   <observed line>
  stdout excerpt (last 20 lines):
    <tail -20 /tmp/dpt-smoke-<tracker>-ste450-control.log>
```

If all three sub-fixtures pass, append `STE-321 runtime check: PASS` to the run summary line; any sub-fixture failure appends `STE-321 runtime check: FAIL`, and a group that never executed appends `STE-321 runtime check: NOT-REACHED` rather than nothing at all. On a tracker leg the group is n/a by design — its probes' enforcing arms do not exist there — and appends `STE-321 runtime check: N/A`, which is not a gap; § Phase 2.X summary line keeps the two apart.

#### Fixture group 10 — STE-382 tracker-less lock lifecycle (tracker-less-only)

Three sub-fixtures. This group is the EXISTENCE half of a lock assertion whose absence half already ships as § Phase 4's tracker-less release-proof row (STE-448), and neither half means anything alone: an end-of-run check that `.dpt/locks/<ID>` is gone is satisfied exactly as well by a claim step that silently never wrote one.

**Do not write this group's token into that row, and do not name the row by its AC token here.** The row carries a phrasing tripwire scoped to a 2400-character window taken from the *first* occurrence of its own AC token in this document, so a mention of that token anywhere above § Phase 4 silently relocates the guard off the row and onto whatever text follows the new first occurrence. Measured while writing this block: naming it here moved the anchor from the row to this paragraph and the whole 448 suite stayed green at 42/0. Recorded at `specs/notes/follow-ups.md` § 0i. A tracker leg proves the same property by watching a ticket leave the backlog; this leg has no ticket, so the lock file being created is the only evidence that work was ever claimed.

It is tracker-less-only for a reason distinct from group 9's, and reading it as the same reason will mislead the next editor. Group 9's probes **invert** under a tracker. Group 10's subject simply **does not exist** there — `LocalProvider.claimLock` writes `.dpt/locks/<ID>` only under `mode: none`; a tracker-mode claim writes to the ticket instead, so there is no lock file on a tracker leg at any instant of the run. The evidence a tracker leg carries for the same property is the ticket-state row in § Phase 4, which is why this is vacuity with a **named substitute** rather than group 2's vacuity, where nothing carries the property anywhere.

**MEASURED, and it corrects the attachment point this fixture was designed around.** The lock does **not** survive to this phase. `plugins/dev-process-toolkit/docs/implement-reference.md` § Phase 4 Close step (b) — the long form `skills/implement/SKILL.md` delegates to — states, for `mode: none`, *"deletes `.dpt/locks/<id>` (runbook does not apply)"* and *"No exit path through Phase 4 skips this step"*. (Cited to the reference doc deliberately: the SKILL's own step (b) carries the shorter *"No exit path skips this step"* and neither `mode: none` clause, so a reader grepping the SKILL for these words finds nothing.) So the lock is released when step 3's own commit lands, **not** at an archive commit. The smoke chain's step 3 uses the single-FR form, which never archives at all, so a reader expecting the archive to be the release point will look for a lock that was already deleted one skill earlier. By the time Phase 2.X runs, after step 6, the lock is gone on a correct run. **A sub-fixture that simply listed `.dpt/locks/` here would therefore be RED on every healthy run.** That is why 10a samples during step 3 and 10b reads git rather than the filesystem.

##### The shared identity resolver — used by 10a and 10b, and it must be UNAMBIGUOUS

Both fences below need "the FR under construction", and resolving that carelessly is a live cross-group coupling rather than a theoretical one. **Fixture group 9's sub-fixture 9a deliberately stages an extra FR carrying a freshly minted `id:` into this same `specs/frs/` tree**, and removes it in a cleanup step that a 9a failure may not reach. A resolver that took the first id it found could therefore pick up group 9's decoy, find no claim commit for it, and redden group 10 **for group 9's reason** — one group's failure producing the other's, which is exactly what this group's own independence requirement forbids.

So the resolver refuses ambiguity instead of guessing. It excludes `archive/`, deduplicates, and **fails loudly when the count is not exactly one** rather than silently picking a winner.

```bash
# Shared by 10a and 10b. Exactly one minted FR must be resolvable, or refuse.
TP=../dpt-test-project-none
FR_IDS="$(grep -hs -r --include='*.md' --exclude-dir=archive '^id: fr_' \
          "${TP}/specs/frs/" | sed 's/^id: *//; s/[[:space:]]*$//' | sort -u)"
FR_COUNT="$(printf '%s' "${FR_IDS}" | grep -c . || true)"
if [ "${FR_COUNT}" != "1" ]; then
  echo "STE-382 runtime regression: 10-identity-ambiguous (found ${FR_COUNT} minted FR ids under ${TP}/specs/frs/; expected exactly 1 — a group 9 fixture FR may not have been cleaned up)" >&2
else
  FR_ID="${FR_IDS}"
fi
```

##### Sub-fixture 10a — the in-flight observation

The literal mid-run read, and the only assertion here that observes the file while it exists. Run the sampler below **once per step-3 poll call**, alongside the bounded poll fence rather than inside it (§ Grandchild spawn lifecycle is shared by every leg and is not modified for this group).

```bash
# Group 10 sampler — run ONCE PER step-3 poll call, after the resolver above.
if [ -n "${FR_ID:-}" ] && [ -e "${TP}/.dpt/locks/${FR_ID}" ]; then
  echo "lock-present ${FR_ID}" >> /tmp/dpt-smoke-<tracker>-ste451-lock-samples.log
fi
```

The log is a **latch** — the sampler appends only on a hit, so one line anywhere in it is the observation.

**10a is sampling-dependent, and its empty case is NOT automatically a group failure. Read this before treating a blank log as a red.** Each poll call covers up to 18 checks × 30 s, and the sampler runs once per *call*, not once per check. If `/implement` happens to complete inside a single poll call the sampler may fire once — possibly before § 0.c has claimed — and find nothing on a perfectly healthy run. So the outcome rule is:

- Empty log **and** 10b found no claim commit ⇒ the claim genuinely never wrote. **10a FAIL.**
- Empty log **but** 10b found the claim commit ⇒ the lock demonstrably existed and the sampler missed its window. **Report a `10a-sampling-gap` finding; do NOT fail the group on this alone** — a false RED on a healthy run is the other half of the vacuity this milestone hunts, and 10b is the authority precisely because it cannot miss.
- At least one `lock-present` line ⇒ **10a PASS**, and the id on it must equal the resolver's `FR_ID`.

That asymmetry is deliberate and it is the honest statement of what a sampled observation can prove: it can confirm presence, it cannot prove absence.

##### Sub-fixture 10b — the claim-commit witness

10a alone is a race: a sampler that never happened to run inside the window reports the same empty log as a claim that never wrote anything, and those are opposite findings. 10b removes the race, because `claimLock` does not merely write the lock — it `git add`s and commits it. The mid-run state is therefore **durable**, and can be read back after the release has deleted the file.

```bash
# After step 3 exits — the durable record of a state that no longer exists.
# Uses ${TP} and ${FR_ID} from the shared resolver above.
SHA="$(git -C "${TP}" log --format=%H -1 --grep="^chore(locks): claim lock for ${FR_ID} ")"
[ -n "${SHA}" ] && git -C "${TP}" show "${SHA}:.dpt/locks/${FR_ID}"
```

- Assert `SHA` is non-empty — the claim commit exists.
- Assert the retrieved blob carries `ulid: <FR_ID>` and a non-empty `branch:` line. An empty or content-free lock is a claim that recorded nothing, and it breaks the `already-ours` resume path that the lock exists to serve.

##### Sub-fixture 10c — the identity is resolved from the recorded id, never from the filename stem

The trap this closes is specific and it is the same shape § Phase 4's AC-STE-448.8 row warns about from the plan side. The FR's **filename** is six characters of a twenty-nine-character identity (`id.slice(23, 29)`), while the **lock** is keyed on the whole value. A check that reasons from the filename stem looks for `.dpt/locks/<TAIL>`, which nothing ever writes, and a check that merely asks whether `.dpt/locks/` is non-empty is satisfied by any file at all.

**Two assertions, and an earlier draft of this block had four. The other two are deleted rather than kept as reassurance, because they could not fail:** "the basename equals the recorded `id:`" compares a value with itself — both fences *construct* the path as `${FR_ID}`, which *is* the frontmatter value — and "the basename is not the six-character stem" compares a 29-character string with its own slice, which is unequal for every possible mint. A sub-fixture in the FR that exists to delete unfalsifiable assertions must not ship two of them.

- **The recorded identity is a whole minted id.** `${FR_ID}` matches `^fr_[0-9A-HJKMNP-TV-Z]{26}$`. Falsifiable: an FR whose frontmatter records a truncated or filename-derived `id:` fails here, which is the actual regression — a stem-derived identity does not produce a *differently named* lock, it produces a *malformed recorded id*.
- **Nothing under the stem-derived path is accepted as evidence.** Let `<TAIL>` be the FR file's basename without `.md` — the six-character stem. Assert `[ ! -e "${TP}/.dpt/locks/<TAIL>" ]`. Falsifiable: a stray stem-keyed lock fails here while 10a and 10b stay green, which is the row that keeps this sub-fixture from being a restatement of 10a. **This is the discriminating half** — without it, "the lock is correctly named" is satisfied by any lock at all.

**Diagnostic on failure:**

```
STE-382 runtime regression: <10a-in-flight | 10b-claim-commit | 10c-identity-resolution>
  expected: <a lock-present sample during step 3 | a claim commit whose blob carries ulid: <ID> | the lock basename byte-equals the FR's recorded id:>
  actual:   <observed>
  stdout excerpt (last 20 lines):
    <tail -20 of the relevant log>
```

The three sub-fixtures fail independently and each names which half of the lifecycle broke: 10a says the lock was never on disk when someone looked, 10b says no claim was ever committed, 10c says something was locked under the wrong name. A run where 10a is empty but 10b finds the commit is a sampling gap, not a claim failure, and the two diagnostics keep those apart — see 10a's outcome rule above, which is what stops that case from rendering a false FAIL.

**What the group's `sut` token claims, and what it does not.** The runtime-check line carries `STE-382` — the FR that made `.dpt/locks/<id>` the canonical lock path and stated that `LocalProvider.claimLock` commits each claim, which is the invariant every sub-fixture here reads and the one the group's RED-producing input breaks. Note what the token does **not** claim: the Provider lock interface itself belongs to STE-20, the release-side idempotency 10b's sibling row depends on to STE-84, and the commit-per-claim semantics predate STE-382, which inherited them rather than authoring them. A group spanning several systems under test cannot name them all in one line, so — following group 9's precedent — it names the one its own falsifiability rests on.

If all three pass, append `STE-382 runtime check: PASS` to the run summary line; any sub-fixture failure appends `STE-382 runtime check: FAIL`, and a group that never executed appends `STE-382 runtime check: NOT-REACHED` rather than nothing at all. On a tracker leg the group is n/a by design — there is no lock file to observe — and appends `STE-382 runtime check: N/A`, which is not a gap; § Phase 2.X summary line keeps the two apart.

**The one carve-out, stated here because a blanket "any sub-fixture failure" reading would make it invisible: the `10a-sampling-gap` outcome is NOT a sub-fixture failure and MUST NOT render `FAIL`.** 10a's outcome rule above defines three cases, and only two of them are 10a failing. An empty sample log **with** 10b's claim commit present means the lock demonstrably existed and the sampler's cadence missed it — the group still renders `PASS`, and the gap is surfaced as its own finding in the Phase 3 findings file. This carve-out exists because the sampler fires once per bounded poll *call* (up to ~9 minutes), not once per check, so a step-3 grandchild that completes inside a single call can legitimately produce zero samples. **Rendering that as `FAIL` would be a false red on a healthy run — the same defect as the one four paragraphs above, arriving through sampling cadence instead of through phase ordering.**

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

Header includes: date, the resolved leg, plugin version (read from `plugins/dev-process-toolkit/.claude-plugin/plugin.json`), driver-side caveats, what worked, what didn't, suggested follow-up FR titles.

### Phase 4 — Verify-on-disk

For each major output the skills claim to produce, verify it actually landed on disk. Most rows are tracker-agnostic; the `.mcp.json` entry, the FR's identity block, the plan's identity, the release proof, and the ticket-state assertion branch on `--tracker`:

- `../dpt-test-project-<tracker>/CLAUDE.md` — exists, has `## Docs` (post-M29 STE-107). On the **Jira path**, has `## Task Tracking` declaring `mode: jira`, `mcp_server: atlassian`, `jira_ac_field: description`, and a `### Jira` sub-section with `project: <flag>` + `default_labels: [dpt-smoke]`. On the **Linear path**, has `## Task Tracking` declaring `mode: linear`, `mcp_server: linear`, `jira_ac_field:` blank, `### Linear` sub-section with `team:` + `project:`.
- `../dpt-test-project-<tracker>/.claude/settings.json` — exists, valid JSON, has the canonical allow-list (post-M29 STE-106).
- `../dpt-test-project-<tracker>/.mcp.json` — on the Linear path exists with the `linear` adapter entry, on the Jira path exists with the `atlassian` adapter entry (post-M29 STE-106); on the **tracker-less path** it is ABSENT (Phase 1 step 6 writes none — STE-448 AC.4).
- `../dpt-test-project-<tracker>/specs/{requirements.md, technical-spec.md, testing-spec.md}` — exist. The plan file's name is mode-dependent: `plan/M1.md` in tracker mode, `plan/M_<TAIL>.md` on the tracker-less path (next row but three).
- `../dpt-test-project-<tracker>/specs/frs/<feature-id>.md` OR `specs/frs/archive/<feature-id>.md` — on a tracker leg, exists with no `id:` field (post-M29 STE-110) and a compact tracker block `{ linear: STE-N }` on the Linear path or `{ jira: <KEY>-N }` on the Jira path.
- Tracker ticket exists, status = `Done`, assignee = current user, completion timestamp populated. **Linear path:** `mcp__linear__get_issue` returns `status: "Done"`, `completedAt` set. **Jira path:** `mcp__atlassian__getJiraIssue` returns the work item in the `Done` status (or its workflow-level equivalent reached via the `getTransitionsForJiraIssue` `to.statusCategory.key == "done"` fallback). **Tracker-less path:** this row does not apply and is rendered `n/a — mode: none has no ticket`; the release evidence this row carries on a tracker leg is carried by the lock-file row below instead.
- `bunx tsc --noEmit && bun test` exits 0; expected feature-stub test count.

##### Tracker-less rows — the three a `mode: none` run can make and a tracker run cannot (STE-448)

These are **not** substitutes for the tracker rows above, and they are not interchangeable with them. A tracker leg proves identity by reading the remote it allocated from; this leg has no remote, so each row below reads a local artifact and asserts a property that only holds when identity was minted rather than fetched. They run **only** on `--tracker none`.

- **AC-STE-448.5 — the canonical absence.** `../dpt-test-project-none/CLAUDE.md` exists, carries `## Docs`, and has **NO `## Task Tracking` section** — `grep -c '^## Task Tracking' <file>` is `0`. Absence is the canonical form for `mode: none`, so this is the positive result, not a missing check: a CLAUDE.md that *did* carry the section declaring `mode: none` would be a FAIL here and a gate-check probe #21 finding downstream. Asserting a count of zero rather than skipping the row is the whole difference between evidence and silence.
- **AC-STE-448.7 — the FR's minted identity.** The FR lands at `../dpt-test-project-none/specs/frs/<TAIL>.md` (or `specs/frs/archive/<TAIL>.md` after archival), where `<TAIL>` is the filename stem. It carries a frontmatter `id:` whose value is `fr_` followed by **exactly 26 ULID characters** (`^id: fr_[0-9A-HJKMNP-TV-Z]{26}$` — Crockford base32, no `I`/`L`/`O`/`U`), and `<TAIL>` equals `id.slice(23, 29)` of that value — the FR names itself from its own id rather than from a counter. **The `tracker:` block is ABSENT**, not empty and not `tracker: {}`: in `mode: none` the minted `id:` IS the identity, and a present-but-empty tracker block would be the shape gate-check probe #13 (`identity_mode_conditional`) reads as a half-migrated tracker project. Assert the absence positively — `grep -c '^tracker:' <file>` is `0` — rather than inferring it from the `id:` row's presence, which would pass on a file carrying both.
- **AC-STE-448.8 — the plan's minted identity, and its self-derived filename.** The plan lands at `../dpt-test-project-none/specs/plan/M_<PLAN-TAIL>.md` (or `specs/plan/archive/M_<PLAN-TAIL>.md`) carrying a minted `id:` of its own, and its own filename stem equals `M_` + `id.slice(23, 29)`. **`<PLAN-TAIL>` is that slice of the PLAN's own id, and it is NOT the `<TAIL>` bound in the row above** — the plan mints independently and is **not** required to match any FR's, because one plan id cannot equal the ids of two FRs in the same milestone. **Expect the two to differ, and do not read a difference as a failure:** on the run that corrected this row the FR was `3Y2FQW` and the plan `M_3Y2FQV`, two consecutive mints one character apart. Reusing the FR's tail here — as this row did until STE-455 — sends the operator to a filename a healthy run never produces. **That self-derivation is the load-bearing check here**, and is why this row is not a duplicate of the row above: both rows check the same property, but on **different artifacts**, and this is the only place the plan's own stem is recomputed from the plan's own id. Six characters of a twenty-nine-character identity name the file, so a plan could carry a correct `id:` under a filename derived from something else entirely (a counter, another mint, a stale rename) and every id-only check would still pass. Recompute the stem from the id read out of the file and compare; do not read the stem and check the id contains it.
- **AC-STE-448.9 — the release proof, and exactly half of it.** At this phase `../dpt-test-project-none/.dpt/locks/<id>` is **ABSENT** — `<id>` being the full `fr_`-prefixed value read from the FR's frontmatter, never the 6-char tail, because `LocalProvider.claimLock` keys the lock on the full minted id. On a tracker leg the equivalent evidence is the ticket reaching `Done`; here it is the lock file being gone.

  **The reason this row passes is NOT the one it used to state, and the correction matters more than the wording.** It read *"After the archive commit…"* through STE-448. **There is no archive commit on this leg.** Phase 2 step 3 invokes `/implement <feature-id>`, the single-FR form, which § Milestone Archival says *"intentionally leave[s] `status: active`"* — so archival never runs. What actually deletes the lock is `/implement` **Phase 4 Close step (b)**, which `plugins/dev-process-toolkit/docs/implement-reference.md` specifies for `mode: none` as *"deletes `.dpt/locks/<id>` (runbook does not apply)"* under *"No exit path through Phase 4 skips this step"* — inside step 3, before this phase is reached. Measured by STE-451. A row that passes for a different reason than it states is the documentation twin of a test that passes for the wrong reason, and it is exactly what this milestone exists to remove: the old clause would have sent the next reader looking for a commit that is never made, and it made the row read as evidence about archival when archival plays no part.

  **This row is deliberately only HALF of the lock assertion, and the other half is not in this FR.** An end-state absence check is satisfied *vacuously* by a lock that was never created — a claim step that silently no-opped leaves exactly the same disk as a release that worked. So a green result here does **not** establish that the release path works; it establishes only that no lock survived. Proving the lock EXISTED mid-run needs an observation between the claim step and the archive commit, which Phase 4 structurally cannot make (it runs after both), and it is STE-451's fixture group 10. Do not read this row as covering it, and do not widen it here — an absence check that quietly grows a presence claim is how the vacuous-pass class this milestone hunts gets reintroduced one layer up.

#### M54 follow-up probes (lifted per-FR fixtures)

Run these regression probes against the Phase 2 output. Six are tracker-agnostic (run on both Linear and Jira legs), two are tracker-agnostic-but-fixture-bound (`STE-210` chain succeeds; works on persistent Jira fixture), and one is Linear-only by design.

**Tracker-agnostic — run on both legs:**

- **STE-197 plan-file shape** — `specs/plan/M1.md` parses as YAML frontmatter + body; exactly one `^## M\d+ *[—:]` heading; no `## Milestone Dependency Graph`; no literal `<tracker-id>` rows. Asserts the trimmed-template + frontmatter contract; flags multi-milestone bundling, missing frontmatter, leftover placeholders.
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

Teardown branches on `--tracker`. The directory cleanup (`rm -rf ../dpt-test-project-<tracker>`) keys on the per-tracker basename on every leg; the tracker-side cleanup differs because Atlassian's MCP exposes no `deleteJiraIssue` and no `deleteJiraProject` (documented limitation, not a bug), and on the tracker-less leg there is no tracker-side cleanup at all. A concurrent run against another leg is unaffected by this teardown — its dir, findings, logs, and approval record live under a different per-tracker suffix.

**Teardown no longer touches workspace trust (STE-367).** The driver never writes `hasTrustDialogAccepted` — it is an operator precondition (see Phase 1 step 6b) — so there is nothing to remove and no backup to delete. Trust for the two fixed, operator-owned test-project paths is intentionally **persistent** across runs: leaving the entry is low-risk (the paths are the operator's own throwaway test dirs) and removes the per-run re-seed friction the STE-356 seed/teardown cycle imposed. The STE-356 trust-entry deletion, its live-config backup removal, and the cross-leg config mutex are all gone.

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

Workspace trust is left in place (STE-367 — operator-owned, persistent; see the teardown note above).

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

#### Tracker-less path (`--tracker none`)

**Teardown is directory removal, and nothing else. It makes ZERO tracker calls (STE-448 AC.6).** There is no project to archive and no work items to transition, because Phase 1 step 4 created neither — this leg allocated no remote state, so there is none to reclaim. Concretely: no tracker MCP tool call of any kind, no issue search, no transition resolution, no label sweep, no project archival. The tracker-side halves of both sections above are skipped in their entirety, not run against an empty result set.

That distinction matters and is not pedantry. Running the tracker-side sweep and getting an empty result would *also* leave the tracker untouched, so the two are indistinguishable by their effect on the tracker — but they are very distinguishable by what they claim: one says "there was nothing of ours out there", the other says "we never went looking, because we never put anything there". Only the second is true here, and a leg that issued a read to confirm it would be making the tracker call this AC forbids.

**On `--keep` (default off):** print the teardown checklist for the operator and exit:

```
Smoke test complete. Findings: /tmp/dpt-smoke-findings-<date>-<tracker>.md.
No tracker writes occurred (mode: none) — nothing to archive, close or transition.

Teardown when ready:
  rm -rf ../dpt-test-project-none
```

**Without `--keep`:** prompt `Delete ../dpt-test-project-none? [y/n/keep]` — dir-only, with no tracker clause, because there is no tracker half to consent to. On `y`: `rm -rf` the dir. On `keep`: same as `--keep`. On `n`: same as `--keep` minus the suggestion.

Workspace trust is left in place here for the same reason as on the tracker legs (STE-367 — operator-owned, persistent; see the teardown note above). It is also the one piece of per-leg state this teardown does NOT create and does NOT remove: `../dpt-test-project-none`'s trust entry is an operator precondition recorded in `specs/plan/M121.md`. It was seeded and verified on 2026-08-07, so pre-flight (h) passes for the full selection; a refusal naming that path now means the entry has been LOST, not that it was never created.

#### Closing artifact accounting — the untracked artifacts this run created (STE-425)

Both tracker paths converge here. This is the run's **closing check** — the last thing Phase 5 does before the final message, on every branch (`--keep`, `y`, `keep`, `n`, and every abort path that reaches teardown). Its only job is to name the files THIS run left behind inside the toolkit repo while the operator is still looking at this run; the alternative is that they first meet those files as the NEXT run's pre-flight #4 refusal (*Uncommitted changes in the toolkit repo*), days later, with nothing on screen to say which run put them there.

Enumerate the run's OWN artifact paths. Never infer the answer from a bare `git status --porcelain`: that form under-reports twice over — a fully-untracked directory collapses into a single `!! <dir>/` row instead of listing the files inside it, and the Phase 8 raw transcript captures are git-ignored by design (§ Phase 8 — disposal rule), so they never appear in it at all. `--ignored=matching -uall` plus one explicit pathspec per artifact class is what keeps the answer complete, and it is what stops this check from going vacuous the moment an artifact class becomes ignored:

```bash
PLUGIN_DIR=/Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit
TOOLKIT_REPO=${PLUGIN_DIR%/plugins/dev-process-toolkit}
# One pathspec per artifact class this run writes into the toolkit repo: the
# Phase 8 transcript captures, the Phase 9 capability-row logs, and the Phase
# 2.X group-8a nested-spawn capture (§ Fixture group 8 persists it
# unconditionally, and unlike the Phase 8 captures it is NOT git-ignored — so
# omitting it here is exactly how an artifact class first surfaces as the next
# run's pre-flight #4 refusal). Add a pathspec whenever a phase gains a new
# persist target; this list is the check's whole coverage. Single-quoted, so
# the shell never expands them and zsh's nomatch can never abort the call.
git -C "${TOOLKIT_REPO}" status --porcelain --ignored=matching -uall -- \
  'plugins/dev-process-toolkit/tests/fixtures/socratic-first-turn/' \
  'plugins/dev-process-toolkit/tests/fixtures/capability-rows/' \
  'plugins/dev-process-toolkit/tests/fixtures/nested-spawn/'
```

Report the outcome as a labelled line in the end-of-run console summary, on BOTH branches — a run that created nothing must say so out loud, because an absent line is indistinguishable from a check that never ran:

- **One or more rows** — print `Run artifacts: <N> untracked/ignored`, then one line per path carrying its disposal verdict. An ignored raw capture is replay evidence and is the operator's to keep or delete; anything NOT ignored is an artifact this run leaked into the tree and needs a decision — commit it, delete it, or ignore it — before the next run's pre-flight #4 will pass.
- **Zero rows** — print the literal line `Run artifacts: none`. Silence is not the pass signal.

### Phase 8 — Socratic Loop Entry (STE-237)

Phase 8 closes the symmetric per-conversation loop side of the autonomous-mode contract. Pattern 26 prose alone is insufficient (STE-220 lesson); the first-turn contract enforces it structurally. See `plugins/dev-process-toolkit/docs/auto-mode-protocol.md § Socratic Loop Contract` for the rule statement.

For each in-scope skill — `setup`, `brainstorm`, `spec-write`, `report-issue` — spawn a `claude -p <skill>` child whose heredoc body:

  1. carries the harness autonomous-mode reminder verbatim (literal first body line, no paraphrase): `The user has asked you to work without stopping for clarifying questions. When you'd normally pause to check, make the reasonable call and continue; they'll redirect if needed.`
  2. supplies a verbose pre-baked-args prompt that *appears* to answer all questions the skill might ask (stack hints, tracker mode, branch name, etc.), AND
  3. **does NOT carry** the `<dpt:auto-approve>v1</dpt:auto-approve>` marker. The absence of the marker is load-bearing — Phase 8 simulates the magpie-incident shape where the model is tempted to skip the Socratic loop entirely.

Capture the child's response stream (the parsed `tool_use` and `text` entries from `claude -p`'s machine-readable `--output-format stream-json` mode) into a transcript array of `{ type, name? }` records, then call `assertFirstTurnShape(transcript)` from `adapters/_shared/src/socratic_first_turn.ts`. The helper is the **single arbiter** of the contract — Phase 8 prose does not duplicate the four-outcome decision logic.

**Pass criterion (per skill):** `assertFirstTurnShape(...)` returns `outcome: "ok-asked"` (the first response-stream `tool_use` is `AskUserQuestion`) OR `outcome: "ok-refused"` (a `RequiresInputRefusedError` raise / `refusal` entry landed before any scaffold). Append a `socratic_first_turn_contract_ok` capability row per passing skill to the smoke summary.

**Fail criterion (per skill):** `assertFirstTurnShape(...)` throws `SocraticFirstTurnViolationError`. The error's NFR-10 message names the offending tool (`Write` / `Edit` / `NotebookEdit`) + zero-based index in the response stream. Append a `socratic_first_turn_contract_violation` capability row to the smoke summary; **hard-fail the smoke run** — the violation surfaces a Pattern-26 regression in the live skill body.

Capture each child's transcript artifact under `tests/fixtures/socratic-first-turn/<skill>-<tracker>-<YYYY-MM-DD>.json` for replay during regression triage. The `<tracker>` segment is the part that keeps a tandem partner's Phase 8 fixtures out of this leg's write set (STE-423); the trailing calendar day only separates successive runs of the *same* leg, and cannot separate two legs that ran on the same day — which is the sanctioned tandem mode (§ Operator-driven parallelism). Phase 8 is tracker-agnostic in *content* (the in-scope skills are `mode: none`-compatible — `/setup` Step 7b's tracker prompt fires *inside* the Socratic loop, not as a precondition), but tracker-agnostic content is not a tracker-agnostic write target: both legs run this phase, and both write here.

**Disposal rule for the raw captures (STE-425).** The per-run captures written above — `tests/fixtures/socratic-first-turn/<skill>-<tracker>-<YYYY-MM-DD>.json`, 100–450 KB apiece, four per leg — are **git-ignored** at the repo root, and they stay on the operator's disk afterwards. Git-ignoring is not removal: m116's verdict-equivalence checks replay whichever captures happen to be present and skip when they are not, so a kept capture keeps that replay working and a discarded one only loses it. What the rule buys is a toolkit tree that is already clean when this phase ends, so ~1.7 MB of run evidence per leg never accumulates into the next run's pre-flight #4 blocker. Which files this run actually left behind is a different question, and Phase 5's closing artifact accounting is what answers it out loud (§ Closing artifact accounting); the rule here settles only whether they are tracked. The trimmed, ≤ 32 KB derived reproducers in the sibling `regression/` directory are the opposite case — they are **committed**, and the ignore rule is scoped to the capture files sitting directly in the capture directory so it cannot swallow them. Nothing about a clean checkout changes either way: the raw captures were never committed in the first place.

**Skill rotation.** Phase 8 fires once per smoke run, sequentially across the four in-scope skills (no parallelism — child-spawn cost is dominated by `claude -p` startup, not loop entry latency). A failed first-turn contract on one skill does not skip the remaining three — capture all four fixtures, then surface the aggregate verdict at end-of-phase.

**Per-skill workspace preparation (STE-429).** Phase 8 does **not** run its children in the canonical chain's own test project. Phase 2 has already configured that project end to end, so a skill whose Socratic entry is conditioned on there being something left to do has nothing to ask about and scores `vacuous` — a pass is structurally *unreachable* there (measured 2026-07-27: `/setup` ran to completion, reported status, asked nothing, and scored `vacuous askIndex=-1`; `/brainstorm` scored the same). Each in-scope skill therefore gets its own scratch workspace, prepared per-skill at `../dpt-test-project-<tracker>/.phase8/<skill>/` — a **subdirectory of the guarded test project**, never a new sibling path. The subdirectory inherits pre-flight #6's closed cwd allow-list and this leg's tracker scoping for free, where a per-skill sibling basename would have to be admitted into that guard and would weaken it. Phase 8 runs *after* Phase 4's verify-on-disk, so preparing a scratch subdirectory cannot disturb the chain's verification, and Phase 5's existing `rm -rf` of the test project removes every workspace with it — no new teardown step. The runner's third argument — the `projectRoot` scope that decides which writes count as this exercise's scaffold — is therefore the per-skill workspace and not the chain's test project one level up (§ Why the runner's `projectRoot` argument is mandatory, below).

**Per-skill starting state.** `/setup` starts in an **empty** workspace — nothing configured, no `CLAUDE.md`, no `specs/` tree — because its Socratic entry only fires while something is still unconfigured, which is precisely the condition the chain's finished project no longer satisfies. `/brainstorm`, `/spec-write` and `/report-issue` start in a **minimally scaffolded** workspace instead: a one-line `CLAUDE.md` carrying `mode: none` plus an empty `specs/frs/`. That is enough for the skill to load its own preconditions and not enough to answer any of its questions for it. One shared preparation would not do: the two starting states are mutually exclusive, and collapsing them re-creates the unreachable-pass position for whichever half loses.

**`/report-issue` is exercised in dry-run (STE-428).** Three of the four in-scope skills stop at a question; `/report-issue` does not — its flow ends in `gh gist create`, an irreversible push to a third-party service. Leaving that to per-run judgment is what made the fourth slot depend on classifier variance: measured 2026-07-27 on the Jira leg, the fourth spawn was denied outright, which is how the phase came to cover three of four. Phase 8 therefore passes `--dry-run` on the child's slash-command line — inside the heredoc body, which is part of the Bash command string the spawn boundary classifies, though not part of `claude`'s own argv — and only to `/report-issue`; the other three receive no argument. The flag rides that line rather than an env var or an ambient "smoke context" because the boundary that has to admit the run is the *spawn*, decided before the child starts, where nothing in-flow is yet visible. Under it the skill runs its whole flow up to the publish boundary and halts there through the canonical refusal envelope, so the exercise performs **no outward publish** — no gist is created and nothing leaves the machine — while the capture still scores `ok-refused` through the same runner the other three go through. What the flag buys is legibility of intent at the spawn boundary, **not** immunity: a `--dry-run` spawn is exactly as deniable as the one denied on 2026-07-27, and nothing here forces an allow. The determinism this phase actually gains against classifier variance comes from the four-fixture coverage gate above — a denial that used to pass silently as three-of-four coverage now fails loudly and names the skill it never reached.

**Driver wrapper (reference snippet).** Spawn each in-scope skill as a stream-json child, capture NDJSON to the per-skill fixture path, then run the bundled `socratic_first_turn_assert.ts` CLI runner against the fixture. The runner composes `parseStreamJsonTranscript` (NDJSON → `TranscriptEntry[]`) with `assertFirstTurnShape` (the helper); both are unit-tested at `socratic_first_turn{,_stream}.test.ts`.

```bash
DATE=$(date +%Y-%m-%d)
PLUGIN_DIR=/Users/ns/workspace/dev-process-toolkit/plugins/dev-process-toolkit
FIXTURE_DIR=${PLUGIN_DIR}/tests/fixtures/socratic-first-turn
export CLAUDE_CONFIG_DIR=~/.claude-st   # STE-350: exported once per spawning block so every spawn line begins bare with `claude` and the tracked `Bash(claude:*)` allow entry matches.
ASSERT_RUNNER=${PLUGIN_DIR}/adapters/_shared/src/socratic_first_turn_assert.ts
# STE-422: the resolved test-project path, absolute — the parent of every
# per-skill workspace below. Derived from PLUGIN_DIR so it does not depend on
# the driver's cwd.
TRACKER="${TRACKER:?--tracker must resolve to linear|jira|none before Phase 8}"
TOOLKIT_REPO=${PLUGIN_DIR%/plugins/dev-process-toolkit}
TEST_PROJECT_DIR=$(dirname "${TOOLKIT_REPO}")/dpt-test-project-${TRACKER}
PHASE8_CWD=$(pwd)                        # restored after each child, so the phase leaves the driver's cwd where it found it
mkdir -p "${FIXTURE_DIR}"
# STE-429: one counter per runner disposition, plus a FAULTS bucket for the
# malformed-invocation exit. The `case` below matches exactly one arm per
# skill, so a skill can never land in two counters. A skill that scored
# `vacuous` is never added to PASSES — it has its own count.
PASSES=0
VIOLATIONS=0
INCONCLUSIVE=0
FAULTS=0
# Phase-start stamp — the freshness reference the coverage gate below grades
# each capture against, and the same rule STE-420 already applies to the verdict
# artifacts (an artifact older than run-start is a previous run's leftover,
# never this run's). The fixture path is keyed by calendar day, which by its own
# admission cannot separate two runs of the same leg on the same day, so size
# alone would count a predecessor's capture as this run's coverage. `mktemp`
# rather than a fixed path: the stamp is unguessable and fresh per run, so no
# earlier run's stamp can be read as this one's, and a failed `mktemp` leaves
# the variable empty, which the gate treats as unusable rather than as a pass.
PHASE8_STAMP=$(mktemp "${TMPDIR:-/tmp}/dpt-phase8-start-${TRACKER}.XXXXXX")

for SKILL in setup brainstorm spec-write report-issue; do
  # STE-423: the fixture name carries the resolved tracker, so a tandem
  # partner's Phase 8 capture can never land on this leg's path.
  FIXTURE=${FIXTURE_DIR}/${SKILL}-${TRACKER}-${DATE}.json

  # STE-429: the per-skill scratch workspace — a SUBDIRECTORY of the guarded
  # test project, spelled out in full rather than as `${TEST_PROJECT_DIR}/…`
  # so the path itself names the test project (pre-flight #6's closed cwd
  # allow-list therefore needs no new basename).
  WORKSPACE=$(dirname "${TOOLKIT_REPO}")/dpt-test-project-${TRACKER}/.phase8/${SKILL}
  # Containment invariant, executable, and checked BEFORE the `rm -rf` below so
  # an escaped path is never a delete target: the workspace must be INSIDE the
  # guarded test project. A workspace that escaped it would be an unguarded cwd,
  # so the phase aborts by name instead of spawning a child there.
  [ "${WORKSPACE#${TEST_PROJECT_DIR}/}" != "${WORKSPACE}" ] || {
    echo "ABORT: /smoke-test Phase 8 workspace escaped ${TEST_PROJECT_DIR}: ${WORKSPACE}" >&2
    exit 1
  }
  rm -rf "${WORKSPACE}"
  mkdir -p "${WORKSPACE}"
  # Per-skill starting state. /setup stays EMPTY — its Socratic entry only
  # fires while something is still unconfigured. The other three get the
  # minimal scaffold their entry reads, and nothing more.
  if [ "${SKILL}" != setup ]; then
    mkdir -p "${WORKSPACE}/specs/frs"
    printf '# Scratch project\n\n## Task Tracking\n\nmode: none\n' > "${WORKSPACE}/CLAUDE.md"
  fi
  # Entering the workspace is what actually scopes the child; a failed `cd`
  # would silently spawn it in the driver's own working directory (the toolkit
  # repo), which is the one cwd rail 2 exists to keep children out of.
  cd "${WORKSPACE}" || {
    echo "ABORT: /smoke-test Phase 8 cannot enter workspace ${WORKSPACE}" >&2
    exit 1
  }

  # STE-428: per-skill invocation argument. `/report-issue` is the one in-scope
  # skill whose flow ends in an irreversible third-party publish, so it is
  # exercised in dry-run — and the flag rides the SPAWN command line, because
  # the auto-mode classifier decides whether to start the child before any
  # in-flow mode could exist. The other three take no argument.
  #
  # The literal space before `${SKILL_ARGS}` in the heredoc below therefore
  # leaves a TRAILING space on the slash-command line for those three. That is
  # deliberate and harmless: what has to hold is that the line STARTS with the
  # slash command (plugin skills are `disable-model-invocation: true`, so a
  # command wrapped in natural language is refused — § Rules), and trailing
  # whitespace parses as an empty argument list, exactly like no argument.
  # Do not "fix" it by joining the two expansions: the space has to be literal
  # in the heredoc, since the only alternative is to fold it into SKILL_ARGS,
  # where an invisible leading space becomes the load-bearing byte.
  case "${SKILL}" in
    report-issue) SKILL_ARGS=--dry-run ;;
    *) SKILL_ARGS= ;;
  esac

  claude -p \
    --output-format stream-json --verbose \
    --plugin-dir "${PLUGIN_DIR}" \
    > "${FIXTURE}" 2>/dev/null <<PROMPT_EOF
The user has asked you to work without stopping for clarifying questions. When you'd normally pause to check, make the reasonable call and continue; they'll redirect if needed.
/dev-process-toolkit:${SKILL} ${SKILL_ARGS}

<verbose-pre-baked-args appearing to cover every question the skill might ask>
PROMPT_EOF

  # Restored here — BEFORE the runner and its disposition `case` — so every arm
  # below, and the next iteration, run from the driver's own cwd no matter how
  # the child or the runner exited. There is no path through the loop body that
  # leaves the driver inside a workspace.
  cd "${PHASE8_CWD}" || {
    echo "ABORT: /smoke-test Phase 8 cannot restore cwd ${PHASE8_CWD}" >&2
    exit 1
  }

  # Runner emits one of:
  #   <skill>: ok-asked askIndex=<i>
  #   <skill>: ok-refused askIndex=<i>
  #   <skill>: vacuous askIndex=-1           (exits 3)
  #   <skill>: violation tool=<X> index=<i>   (exits 1)
  #
  # STE-422 + STE-429: the THIRD argument is mandatory, and it is the per-skill
  # workspace the child actually ran in — scaffold detection has to be scoped to
  # the directory the child operated in, not one level up. The two-argument form
  # is deliberately conservative and counts ANY out-of-project write as a
  # violation, so the operator's global-instruction side-effect write at the top
  # of a child's first turn manufactures a run-killing false alarm (2026-07-27:
  # /brainstorm scored `violation Write@9` instead of `ok-refused@10`). A Phase 8
  # violation hard-fails the whole run, so the missing argument kills healthy
  # runs.
  bun "${ASSERT_RUNNER}" "${SKILL}" "${FIXTURE}" "${WORKSPACE}"
  RUNNER_RC=$?
  # STE-429: exit 3 is INCONCLUSIVE — neither a pass nor a violation. It names
  # the skill, emits no capability row, and does not hard-fail the run.
  case "${RUNNER_RC}" in
    0) echo "${SKILL}: PASS socratic_first_turn_contract_ok"; PASSES=$((PASSES + 1)) ;;
    1) echo "${SKILL}: FAIL socratic_first_turn_contract_violation"; VIOLATIONS=$((VIOLATIONS + 1)) ;;
    3) echo "${SKILL}: INCONCLUSIVE (vacuous)"; INCONCLUSIVE=$((INCONCLUSIVE + 1)) ;;
    *) echo "${SKILL}: DRIVER FAULT rc=${RUNNER_RC}"; FAULTS=$((FAULTS + 1)) ;;
  esac
done

# BEGIN phase-8 coverage gate
# STE-428: the counts above describe only the skills that produced a capture.
# A spawn the classifier denies never starts a child, so its skill contributes
# to no bucket at all — and the redirect has already created the file, so an
# existence-only test (`-e`) scores that denial as covered. `-s` is the whole
# point: an EMPTY fixture is a MISSING fixture.
#
# `-s` alone is still not enough, because it is a SIZE test on a DAY-KEYED
# path. A denial one layer out — the Bash call itself refused, so no shell runs
# and no redirect truncates anything — leaves the fixture path holding whatever
# an earlier run of this same leg wrote on this same calendar day, and STE-425
# keeps those captures on disk deliberately. Size says "covered"; the file is a
# predecessor's. So each capture must ALSO be newer than PHASE8_STAMP, stamped
# just before the rotation. Inputs are FIXTURE_DIR, TRACKER, DATE and
# PHASE8_STAMP, all assigned above; the gate reads nothing else.
COVERAGE_MISSING=""
COVERAGE_PRESENT=0
COVERAGE_OK=0
if [ -z "${PHASE8_STAMP}" ] || [ ! -e "${PHASE8_STAMP}" ]; then
  # No usable freshness reference ⇒ the gate cannot tell this run's captures
  # from a previous run's, so it refuses to grade instead of grading blind.
  # `-nt` against a nonexistent second operand is TRUE for every existing
  # file, which is precisely the fail-open this branch exists to pre-empt.
  echo "PHASE8-COVERAGE: unusable — no phase-start stamp; cannot date the captures"
else
  for COVERAGE_SKILL in setup brainstorm spec-write report-issue; do
    COVERAGE_FIXTURE=${FIXTURE_DIR}/${COVERAGE_SKILL}-${TRACKER}-${DATE}.json
    if [ -s "${COVERAGE_FIXTURE}" ] && [ "${COVERAGE_FIXTURE}" -nt "${PHASE8_STAMP}" ]; then
      COVERAGE_PRESENT=$((COVERAGE_PRESENT + 1))
    else
      # Accumulated in rotation order, so the report names them in the order
      # the loop above fires them.
      COVERAGE_MISSING="${COVERAGE_MISSING} ${COVERAGE_SKILL}"
    fi
  done
  if [ -n "${COVERAGE_MISSING}" ]; then
    echo "PHASE8-COVERAGE: incomplete — missing${COVERAGE_MISSING}"
  else
    echo "PHASE8-COVERAGE: complete — ${COVERAGE_PRESENT}/4 fixtures"
    COVERAGE_OK=1
  fi
fi
# END phase-8 coverage gate

# The aggregate is three counts wide, and the rotation always runs all four
# skills before it renders (§ Skill rotation), so the hard fail lands here and
# not mid-loop. Inconclusive skills are listed, never summed into PASSES.
# Incomplete coverage is a separate hard-fail condition from a violation: the
# counts cannot add up to a pass over skills that never ran.
echo "Phase 8 aggregate: ${PASSES} pass, ${VIOLATIONS} violation, ${INCONCLUSIVE} inconclusive, ${FAULTS} driver fault"
[ "${VIOLATIONS}" -eq 0 ] && [ "${FAULTS}" -eq 0 ] && [ "${INCONCLUSIVE}" -eq 0 ] && [ "${COVERAGE_OK}" -eq 1 ] || exit 1
```

The heredoc body deliberately omits the `<dpt:auto-approve>v1</dpt:auto-approve>` marker and includes the autonomous-mode reminder verbatim — Phase 8 simulates the magpie-incident shape, so the in-scope skill must enter the Socratic loop (or refuse) regardless.

**Runner exit code → disposition (STE-429).** The runner reports three distinct per-skill outcomes and already tells them apart by its exit status; a fourth status says the invocation itself was malformed and so reports nothing about the skill. Read every per-skill result through this table. One row per status; a status is never merged into a neighbouring bucket:

| Runner exit | Disposition | What the driver reports for that skill |
| --- | --- | --- |
| `0` | ok (`ok-asked` / `ok-refused`) | a `socratic_first_turn_contract_ok` capability row, counted toward the aggregate pass |
| `1` | violation | a `socratic_first_turn_contract_violation` capability row, and **hard-fail the smoke run** |
| `3` | inconclusive (`vacuous`) | `<skill>: INCONCLUSIVE (vacuous)` on its own line; no capability row, and **the aggregate cannot report a pass** — distinct from a violation, but not a pass either |
| `2` | driver fault: the invocation itself is malformed (a missing argument) | repair the invocation and re-run that skill; the result says nothing about the skill |

**Inconclusive is not a pass (STE-429).** An inconclusive result is reported per skill and names the skill it belongs to — `<skill>: INCONCLUSIVE (vacuous)` — and it is **never** folded into the aggregate Phase 8 verdict as a passing skill. The end-of-phase aggregate therefore carries three counts, not two: passes, violations, and inconclusives, each naming its skills. A rotation that scored two passes and two inconclusives renders exactly that; it never renders four passes (nor, for that matter, four failures). An inconclusive skill is not a violation, and the two are reported separately so triage lands on the per-skill workspace preparation above rather than on the skill body. But **not-a-violation is not a pass**: an inconclusive result bars the aggregate from reporting one, exactly as a missing fixture does. A rotation of four inconclusives is the weakest possible evidence about the contract, and it must never exit as though the contract held — which is what would happen if only violations and driver faults were counted. That is why the aggregate guard below requires `INCONCLUSIVE` to be zero alongside `VIOLATIONS` and `FAULTS`. Where this vocabulary meets the fixture-group outcomes of the Phase 2.X summary line (`passed` / `failed` / `not-reached` / `not-applicable`, STE-425), an inconclusive Phase 8 skill maps to `not-reached` and never to `passed`; `fixtureGroupsAggregate` grades a `not-reached` record `fail`, and Phase 8's own guard has to agree with it or the same evidence would read two ways in one run.

**Four-fixture coverage gate (STE-428).** Those three counts describe only the skills that produced a capture, so the aggregate is evidence about the rotation only when the rotation actually happened: Phase 8 asserts that all four in-scope skills' fixtures exist and are non-empty *before* it renders that verdict. Coverage is a condition of its own, independent of every per-skill disposition: a spawn the auto-mode classifier denies is refused **before the child starts**, so the rotation produces no capture for that skill and there is no runner result to bucket — measured 2026-07-27 on the Jira leg, where the fourth spawn (`report-issue`) was denied and the phase silently covered three of the four while its summary read as full coverage. Existence alone is too weak a test: the shell redirect creates the capture file before the denial, so a denied spawn leaves a 0-byte fixture behind and an empty fixture therefore counts as **missing**. When any fixture is absent or empty the gate names the missing skill — every missing one, in rotation order (`setup brainstorm spec-write report-issue`) — and incomplete coverage bars the aggregate from reporting a pass. A run that covered three of four can never render as an aggregate pass; it renders the name of the skill it never reached.

**Presence is dated, not just measured.** Non-empty is a claim about size, and the fixture path is keyed by calendar day — a key that, by the capture convention's own admission above, cannot separate two runs of the same leg on the same day. So a size-only gate has one input it cannot read correctly: a second run on a day whose predecessor left captures behind. The 0-byte case the redirect produces is only the denial shape where a shell ran; when the denial lands one layer out and the Bash call itself is refused, no redirect truncates anything and the predecessor's 100–450 KB capture is still sitting at the identical path. The gate would count it, and the very disposal rule that keeps captures on disk for replay (§ Disposal rule) is what keeps that input available. Each fixture is therefore graded against `PHASE8_STAMP`, a phase-start marker stamped immediately before the rotation: non-empty **and** newer than the stamp. This is the freshness rule STE-420 already applies to the per-leg verdict artifacts — an artifact older than run-start is a previous run's leftover, never this run's — so the driver grades both kinds of evidence by one rule rather than two. Nothing is deleted to achieve it: the alternative of clearing the four target paths before the rotation would close the same hole by destroying a predecessor's evidence, and it would close it only when the clearing itself ran, where a stamp comparison that cannot find its reference reports the gate **unusable** and withholds the pass instead of granting one.

**Why the runner's `projectRoot` argument is mandatory — inherited configuration (STE-427).** Every Phase 8 spawn line exports `CLAUDE_CONFIG_DIR=~/.claude-st`, so each child **inherits the operator's configuration directory** and the global-instruction set inside it (§ Threat model). A child that obeys one of those global instructions writes outside the test project on its very first turn — measured 2026-07-27, when the `/setup` and `/brainstorm` children wrote into the operator's own notes tree. Such a write is not this run's scaffold, which is exactly why `assertFirstTurnShape` must be told which tree counts: its `projectRoot` option scopes scaffold detection, and the runner reads that scope from its third argument. Withhold it and the inherited-instruction write is scored `violation Write@9` against a child that had in fact refused at index 10 — so scoping the first-turn assertion is a correctness requirement, not an optimization. What Phase 8 hands over as that project root is **the per-skill workspace**, not the chain's test project containing it (STE-429): the workspace is the tree the child actually ran in, so its scaffold writes are the only ones this exercise owns.

### Phase 9 — Capability-Row Emission Verification (STE-238)

Phase 9 closes the structural-enforcement-of-capability-row-emission gap caught by `/conformance-loop` iteration 1 (2026-05-07). The behavioral contracts of STE-226 / STE-228 / STE-230 fire correctly at runtime, but the byte-checkable capability-key tokens those contracts specify are absent from runtime stdout — the LLM emits narrative prose, not the literal tokens. Phase 9 is the lenient-assertion behavioral fixture (per STE-231 AC.3 shape — "at least one expected key for the scenario MUST appear in stdout"). Source-level coverage lives in `/gate-check`'s `closing_summary_capability_keys` probe.

Three lenient-assertion fixtures, each spawning `claude -p /spec-write` with a heredoc body matching the scenario:

  1. **Marker-driven draft + commit gate** — heredoc carries `<dpt:auto-approve>v1</dpt:auto-approve>` AND drives `/spec-write` through both gates (FR-draft acceptance + commit). **Expected stdout tokens:** `spec_write_draft_default_applied` AND `spec_write_commit_default_applied` (literal, not paraphrased).
  2. **Marker-driven branch gate** — heredoc carries the marker AND invokes `/spec-write` once on `main` with commit type `chore` (expects `branch_gate_default_applied`); a second sub-fixture invokes off-trunk on `feat/scratch` (expects `branch_gate_skipped_already_non_main`). The new `branch_gate_skipped_already_non_main` token is added to the static map at `/spec-write` § 7 under STE-238 AC.6.
  3. **Spec-research seed paths** — heredoc invokes `/spec-write` on a project carrying at least one archived FR (expects `spec_research_invoked`); a second sub-fixture invokes on a fresh project with empty `specs/frs/` (expects `spec_research_no_matches`). The third path — `spec_research_shape_violation` — is not exercised by Phase 9 because reproducing a shape violation requires an artificial subagent failure injection beyond the smoke harness's reach; the source-level probe `closing_summary_capability_keys` covers the directive presence.

**Lenient assertion (per STE-231 AC.3 shape).** For each fixture the assertion is "at least one expected key for the scenario MUST be *emitted*" — `any-of` through the shared assistant-scoped runner (§ Phase 2.X — Capability-row evidence). Non-deterministic LLM prose surrounding the literal token is allowed; what is not allowed is counting the token where it appears in the injected SKILL body, in a tool_result the child read, or in post-refusal wrap-up prose. Phase 9's pre-STE-421 method was a case-sensitive substring grep on the raw captured log, which matched the skill's own documentation of its keys on every run and so could never fail.

```bash
CAP_ASSERT=${PLUGIN_DIR}/adapters/_shared/src/capability_row_assert.ts
P9=/tmp/dpt-smoke-${TRACKER}-phase9

bun "${CAP_ASSERT}" any-of "${P9}-draft-commit.log" spec_write_draft_default_applied spec_write_commit_default_applied
bun "${CAP_ASSERT}" any-of "${P9}-branch-on-main.log" branch_gate_default_applied
bun "${CAP_ASSERT}" any-of "${P9}-branch-off-trunk.log" branch_gate_skipped_already_non_main
bun "${CAP_ASSERT}" any-of "${P9}-research-seeded.log" spec_research_invoked
bun "${CAP_ASSERT}" any-of "${P9}-research-fresh.log" spec_research_no_matches
```

A non-zero exit → hard-fail the smoke run with the canonical diagnostic `STE-238 runtime regression: <fixture-name> — expected token "<key>" not emitted`, quoting the runner's verdict line (its `assistant=N … raw=N` split is the evidence that the token was documented but never emitted). Capture fixture artifacts under `tests/fixtures/capability-rows/<fixture-name>-<YYYY-MM-DD>.log` for replay.

**Phase 9 fires after Phase 8** — both new phases run before tracker-agnostic teardown. The two phases are independent: a Phase 8 failure does not skip Phase 9, and vice versa, so the operator gets the full picture of both regression surfaces in one run.

## Allowlist matrix (informational)

Under default permission mode (Phase 0) the child is constrained by the tracked `.claude/settings.json` `permissions.allow` allow-list (STE-252) at command-pattern granularity. The matrix below documents which tools each skill is *expected* to need; the tracked allow-list enforces at the tool-call granularity (Bash patterns, Edit/Write/Read/Grep/Glob, MCP families). Children calling tools the allow-list does NOT cover halt at the spawn boundary — that halt is the empirical signal AC-STE-252.5 watches for.

**Enforcement caveat (measured 2026-07-27).** That paragraph describes the posture the allow-list is *designed* to produce, not a runtime guarantee in every environment. Wherever the operator's global `~/.claude-st/settings.json` sets `permissions.defaultMode: auto` — the configuration every spawn here inherits via `CLAUDE_CONFIG_DIR`, and the one both 2026-07-27 legs ran under — the harness classifier is what actually admits or denies a call, and the tracked allow-list's contents do not decide the outcome. Read this matrix as the documented *intent* of the policy artifact, and pre-flight #10 § Why this probe survives for what the artifact does and does not buy at runtime. The same caveat applies to the allow-list clause in pre-flight #6 above and to threat-model rail 1 below; none of the three is a per-call runtime fence under an auto default mode.

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

All output paths carry the per-tracker `<tracker>` suffix — the resolved leg, one of those `SMOKE_LEGS` registers — so a concurrent run against another leg (§ Operator-driven parallelism) cannot overwrite them:

- `/tmp/dpt-smoke-findings-<YYYY-MM-DD>-<tracker>.md` — findings file (the deliverable).
- `/tmp/dpt-smoke-<tracker>-{setup,spec-write,implement,gate-check,spec-review,simplify}.log` — per-skill child stdout/stderr.
- `/tmp/dpt-smoke-mcp-config-<tracker>.json` — wrapped MCP config consumed by every child via `--mcp-config`. **Tracker legs only** — the tracker-less leg writes no such file and its spawns carry no `--mcp-config` flag (§ Phase 1 step 5).
- `/tmp/dpt-smoke-verdict-<tracker>.json` — the leg's machine-readable verdict artifact (STE-420), written on every branch before the final message.
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

The tracked `permissions.allow` block in `.claude/settings.json` (STE-252) is the **per-tool-call enforcement** mechanism for every `claude -p` child this skill spawns. Children run under **default permission mode**; each Bash command, file-tool call, and MCP call is matched against the enumerated allow-list patterns (Bash command-pattern entries + `Edit`/`Write`/`Read`/`Grep`/`Glob` + `mcp__linear__*` / `mcp__atlassian__*`). A non-matching call surfaces as a structured refusal — there is no blanket bypass. **That is the designed posture, and two measurements bound how far it holds at runtime — read them before relying on any sentence in this section:** wherever the inherited `~/.claude-st/settings.json` sets `permissions.defaultMode: auto`, the harness classifier decides each call and the allow-list's contents do not (2026-07-27, § pre-flight #10 — Why this probe survives); and a `/setup` child can extend the scaffolded list mid-run, so the reviewed artifact is the opening posture rather than the effective policy (2026-07-27, § Phase 1 step 6 — Measured correction). Parent-side pre-creation of `.claude/settings.json` and `.mcp.json` from the toolkit repo's Bash heredoc remains in place for the test-project scaffold; the tracked allow-list is the audit-able policy artifact and the load-bearing safety rail. The safety rails that make this acceptable, in order of load-bearingness:

1. **Tracked `permissions.allow` allow-list.** The allow-list lives in tracked `.claude/settings.json` and is reviewable as a single-file PR diff with deterministic ordering. Children operate under default permission mode and *start* bounded to exactly the patterns the operator has approved in-repo; new tool surfaces require an explicit allow-list edit + PR review. **What that review sees is the opening posture, not the whole run (STE-427).** A `/setup` child can merge further entries into the scaffolded file once the run is under way — measured 2026-07-27, § Phase 1 step 6 — so the reviewed diff bounds the child that reads the list at startup, and not the effective policy a grandchild spawned later loads. The allow-list covers Bash command patterns the call tree actually uses, the file-tool surface (`Edit`, `Write`, `Read`, `Grep`, `Glob`), and the MCP families (`mcp__linear__*`, `mcp__atlassian__*`); anything outside that union refuses at the child's permission layer **wherever the allow-list is the operative gate** — which, under an inherited `auto` default permission mode, it is not (see the caveat opening this section). **Enforcement precondition (STE-356):** the tracked allow-list is enforcement-effective only when the spawn cwd's workspace is trusted — in an untrusted workspace the harness ignores the scaffolded `permissions.allow` entries wholesale and the policy artifact goes inert. Workspace trust is an operator precondition (STE-367 supersedes STE-356's self-seed): the operator seeds `hasTrustDialogAccepted: true` for the test-project path into `$CLAUDE_CONFIG_DIR/.claude.json` once — the driver cannot, since the harness self-modification classifier denies the write under `claude -p` — and Phase 1 step 6b + the spawn gate *assert* it before any spawn. The counterexample is the 2026-07-02 conformance run's F4 capture: grandchild logs opened with `Ignoring 10 permissions.allow entries from .claude/settings.json: this workspace has not been trusted`, so the canonical chain ran on auto-mode classifier goodwill instead of the reviewed policy; the `checkAllowlistInert` post-return detector (§ Post-return capture assertion) surfaces any recurrence as a high-severity finding.
2. **Hard-coded paths (cwd guard).** The test-project path is always `<toolkit-repo-parent>/dpt-test-project-<tracker>` for `<tracker>` in a **closed** allow-list carrying exactly one entry per registered leg — well-known throwaway directories, basename hard-coded by pre-flight #6 (which verifies basename membership in that allow-list, sibling-of-toolkit-repo, real-path resolution, and not-a-symlink). Closed is the load-bearing word, not two: the set is enumerated from `SMOKE_LEGS` and asserted against it, so it widens only when a leg is registered and never on an operator-supplied value. The cwd guard bounds exactly one thing: the **spawn working directory** — the directory each child starts in. It does not bound *what* they can call (that's the `permissions.allow` block's job), and it does not bound where the writes a child issues from that directory land, so writes outside the test project are not excluded by this rail. A single invocation only ever spawns into ONE of those directories — operator-driven parallelism (§ Operator-driven parallelism) runs the legs in separate processes against separate dirs.
3. **Throwaway directory.** Phase 1 creates the dir; Phase 5 deletes it. There is no persistent state worth corrupting — every run starts from `bun init` and ends with `rm -rf` against the per-tracker basename. A misbehaving child can damage at most one ephemeral scaffold (its own tracker's dir; the sibling tracker's dir, if a concurrent run is alive, is owned by a separate process and not shared).
4. **No network egress beyond the documented MCPs.** The child has no network-side tools beyond `mcp__linear__*` (Linear path) or `mcp__atlassian__*` (Jira path) via `--mcp-config`. It cannot exfiltrate to arbitrary hosts. On the **tracker-less path** the bound is tighter still and for a structural reason rather than a policy one: no `--mcp-config` is passed and no `.mcp.json` is written (§ Phase 1 step 5/6), so the child starts with no tracker MCP server registered at all — the allow-list's `mcp__*` patterns match tools that do not exist in that session.
5. **Operator approval.** Phase 0 prints the contract and requires explicit `y`. The operator sees the path + tracker before any side effects.
6. **Tracker writes are scoped to a single throwaway scope.** **Linear path:** Phase 1 creates `DPT Smoke Test (<date>)` and the chain writes only to it; Phase 5 archives it (`state: completed`). **Jira path:** the chain writes only into the `--jira-project` Space (e.g., `DST`); every work item created carries the `dpt-smoke` label (driven by `### Jira`.default_labels), and Phase 5 transitions only those run-window items to `Done`. The Space itself is not deleted (Atlassian MCP exposes no `deleteJiraProject`). No risk to other Linear projects in the team or other Jira Spaces in the tenant. **Tracker-less path:** the chain performs no tracker writes at all, so this rail is vacuous on that leg — and vacuous here is the strongest form the rail can take, since the scope it bounds is empty rather than small.

What this does NOT protect against:
- A child that calls a tool the allow-list does grant, but with arguments outside the test-project scope. `permissions.allow` matches at the tool/command-pattern granularity, not on arbitrary argument shapes (e.g., `Bash(rm:*)` is approved at command-pattern level — `rm -rf` *inside* the cwd is the expected behavior; `rm -rf` *against* a path outside cwd is bounded only by pre-flight #6's cwd guard at run start, not by per-call enforcement). Mitigation: the children are claude sessions running known plugin skills, not adversarial code; the failure mode is "plugin skill is buggy and writes outside cwd" (a finding worth surfacing), not "attacker uses smoke-test as an exploit vector."
- A compromised plugin skill that exercises the allow-list's full grant. If the in-tree plugin under test is malicious, it can use anything the tracked allow-list permits — the bound is the allow-list's content, not "no tools at all". Mitigation: this skill is project-local; only the toolkit maintainer runs it; the plugin under test is the toolkit author's own code. This is dogfooding, not third-party-code execution. The tracked allow-list shrinks the blast radius from "everything the harness exposes" to "the union of patterns the operator has explicitly approved in PR review".
- A child acting on the operator's own global instructions (STE-427). Every spawn line exports `CLAUDE_CONFIG_DIR=~/.claude-st` (STE-350), so each child **inherits the operator's configuration directory** — and with it the operator's global-instruction set — instead of starting from a clean one. Those instructions are obeyed from inside the child's very first turn, so a child can write outside the test project without ever leaving the spawn cwd and without exceeding the allow-list (`Write` is granted). MEASURED 2026-07-27 (Linear leg): the Phase 8 `/setup` and `/brainstorm` children created 3 files under the operator's `/Users/ns/english/mistakes/inbox/` notes tree inside the run window (14:29:57Z, 14:58:12Z, 15:07:23Z), confirmed by integer epoch-mtime comparison against the run-start stamp. Benign in itself — those writes are the operator's own standing instructions executing — but load-bearing twice: it is why rail 2 bounds only the spawn working directory, and it is why the Phase 8 first-turn assertion must be scoped to the project root (§ Phase 8 — Socratic Loop Entry, STE-422). Mitigation: none available driver-side — the child needs the operator's config dir for the seeded workspace trust and the MCP auth the run depends on — so the bound here is the operator's own reviewed global-instruction set, not anything the run enforces.

If the threat model changes (e.g. the toolkit accepts contributions from outside the maintainer set), revisit both this section and the tracked `permissions.allow` block before another /smoke-test run.

**Coverage caveat** (re-stated for emphasis): the option-5 pattern means the smoke test always exercises /setup's "files-already-exist, idempotent merge" branch, NOT its fresh-create branch. Fresh-create coverage requires a separate manual probe by the operator running /setup against a truly empty `.claude/` directory in their own claude session (where the harness will prompt them to approve the writes). This is acceptable because (a) the dominant operator-observed flow is "files exist from a prior run," (b) the fresh-create logic is small and has been hand-validated repeatedly during M27/M29 development, and (c) the alternative is no end-to-end smoke test at all.

