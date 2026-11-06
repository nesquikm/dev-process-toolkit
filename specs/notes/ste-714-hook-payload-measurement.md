# STE-714 — what tool-call hooks and the session log can see (2026-11-06, Claude Code 2.1.319)

Measured before any capture code exists. Claude Code `2.1.319`, run date 2026-11-06, one macOS machine. The operator ran every live case at the keyboard, in three interactive sessions in a throwaway measurement checkout (a git worktree of this repository at the v3.0.0 merge commit, plus one uncommitted one-AC fixture FR for sessions A and B). Session A was started with only the plugin registration, and the project-local entry was added while it ran. Session B was a fresh start with both registrations. Session C, run later the same day in a fresh worktree of the same commit, carried only the `local` registration and captured the inline Skill case that session B did not produce.

The recorder ran under both registrations, `local` (the checkout's project-local `.claude/settings.local.json`, by absolute path) and `plugin` (a throwaway plugin loaded with `claude --plugin-dir`, inline `"${CLAUDE_PLUGIN_ROOT}"/hooks/record.sh` form, the script `exec`ing the same recorder with the tag `plugin`). Each registration held one `PreToolUse` and one `PostToolUse` group with the matcher `Bash|Skill` and a 10-second timeout. Neither touched the toolkit's `hooks/hooks.json`.

## Recorder

Paths are shown scrubbed. The recorder lived outside every repository and wrote to a file beside it.

```ts
// STE-714 spike recorder — not shipped. Appends one JSON line per hook event.
// argv[2] = registration tag (`local` | `plugin`).
import { appendFileSync } from "node:fs";

const tag = process.argv[2] ?? "unknown";
const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const raw = Buffer.concat(chunks).toString("utf8");
let payload: unknown = raw;
try { payload = JSON.parse(raw); } catch { /* keep raw text */ }
const line = {
  registration: tag,
  wall_clock_ms: Date.now(),
  cwd: process.cwd(),
  claude_project_dir: process.env.CLAUDE_PROJECT_DIR ?? null,
  payload,
};
appendFileSync("/synthetic/repo/spike/events.jsonl", JSON.stringify(line) + "\n");
process.exit(0);
```

The `local` registration, as it stood in the project-local settings file during the runs:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|Skill", "hooks": [ { "type": "command", "command": "bun /synthetic/repo/spike/recorder.ts local", "timeout": 10 } ] }
    ],
    "PostToolUse": [
      { "matcher": "Bash|Skill", "hooks": [ { "type": "command", "command": "bun /synthetic/repo/spike/recorder.ts local", "timeout": 10 } ] }
    ]
  }
}
```

## Cases

| Case | Prompt (session) | Events, `local` | Events, `plugin` | Same set? |
|------|------------------|-----------------|------------------|-----------|
| A0 | `echo case-a0` (A, before the local entry existed) | none | Pre + Post Bash | differs by design: `local` did not exist yet |
| A1 | `echo case-a1` (A, after the local entry was copied in) | Pre + Post Bash | Pre + Post Bash | yes |
| B1 exit 0 | `echo case-ok` | Pre + Post Bash | Pre + Post Bash | yes |
| B2 exit 1 | `sh -c 'echo case-fail; exit 1'` | Pre Bash only | Pre Bash only | yes |
| B3 interrupted | `for i in $(seq 1 120); do sleep 1; done; echo case-interrupt`, Esc after about 5 s | Pre Bash only | Pre Bash only | yes |
| B4 hook-blocked | `touch … && git add … && git commit …` with no gate run | Pre Bash only | Pre Bash only | yes |
| B5 inline skill | `/dev-process-toolkit:gate-check` typed by the operator | 17 Bash events (9 Pre, 8 Post), 0 Skill events | 17 Bash events (9 Pre, 8 Post), 0 Skill events | yes |
| B6 forked skill | `/dev-process-toolkit:tdd specs/frs/spike-fixture.md` | Pre + Post Skill × 4, 17 Bash events (7 main, 10 in forks) | Pre + Post Skill × 4, 17 Bash events (7 main, 10 in forks) | yes |
| B7 forked skill | `/dev-process-toolkit:spec-review specs/frs/spike-fixture.md` | Pre + Post Skill × 1, 6 Bash events (4 main, 2 in the fork) | Pre + Post Skill × 1, 6 Bash events (4 main, 2 in the fork) | yes |
| C1 inline skill | `Use the Skill tool to invoke the skill dev-process-toolkit:best-practices with args "list"` (C) | Pre + Post Skill, 4 Bash events | not registered in C | n/a: `local` only |
| C2 exit 0 | `echo case-c-done` (C) | Pre + Post Bash | not registered in C | n/a: `local` only |

Totals over the three sessions: 124 events, 65 `local` and 59 `plugin`. Sessions A and B hold 116 of them, 57 `local` and 59 `plugin`; the two extra `plugin` events are A0, and session C's 8 events are `local` only. For every one of the 57 (tool_use_id, event) pairs that both registrations recorded, the two payloads are byte-identical as parsed JSON (0 differences). The 120-second `sleep` first written for B3 was refused by the harness before any hook fired, so it left 0 events. The loop form above is the interrupted case.

Two deviations matter for later FRs. An operator-typed slash command (`/gate-check`, `/tdd`, `/spec-review`) is not a Skill tool call and fires no Skill hook. Only the Skill calls the model makes fired one. In session B every one of them was a `context: fork` child (`tdd-write-test`, `tdd-implement`, `tdd-refactor`, `tdd-spec-review`, `spec-review-audit`), so B5 is represented by one of its Bash calls (`pre-/post-bash-during-inline-skill.json`). Session C supplies the inline Skill call (C1): the model called the Skill tool itself, and no fork ran. B5's `/gate-check` ended GATE FAILED for environmental reasons (the measurement checkout had no `node_modules`), which does not affect any hook measurement.

## Payload keys (AC-STE-714.2)

Committed payloads: `plugins/dev-process-toolkit/tests/fixtures/hook-payloads/*.json`, one per observed (event, tool, case), each the full recorder line of the `local` registration after the scrub below.

PreToolUse Bash (`pre-bash-during-inline-skill.json`, `pre-bash-exit-0.json`, `pre-bash-exit-1.json`, `pre-bash-interrupted.json`, `pre-bash-hook-blocked.json`, `pre-bash-local-added-mid-session.json`, `pre-bash-inside-fork.json`):

- top level: `session_id` string, `transcript_path` string, `cwd` string, `scratchpad_dir` string, `prompt_id` string, `permission_mode` string, `effort` object, `hook_event_name` string, `tool_name` string, `tool_input` object, `tool_use_id` string; inside a fork also `agent_id` string and `agent_type` string.
- `tool_input`: `command` string, `description` string, `timeout` number (present only when the model set one).

PostToolUse Bash (`post-bash-during-inline-skill.json`, `post-bash-exit-0.json`, `post-bash-local-added-mid-session.json`, `post-bash-inside-fork.json`, `post-bash-inside-fork-edit.json`):

- top level: every PreToolUse key, plus `tool_response` object and `duration_ms` number.
- `tool_input`: as PreToolUse.
- `tool_response`: `stdout` string, `stderr` string, `interrupted` boolean, `isImage` boolean, `noOutputExpected` boolean; seen on some calls only: `backgroundTaskId` string, `timedOutAfterMs` number, `backgroundCwdHint` string, `bashEditDiff` object.

PreToolUse Skill (`pre-skill-inline-best-practices.json`, `pre-skill-fork-tdd-write-test.json`, `pre-skill-fork-spec-review-audit.json`):

- top level: as PreToolUse Bash, with no `agent_id` or `agent_type` (every observed Skill call was made by the main session).
- `tool_input`: `skill` string, `args` string.

PostToolUse Skill (`post-skill-inline-best-practices.json`, `post-skill-fork-tdd-write-test.json`, `post-skill-fork-spec-review-audit.json`):

- top level: every PreToolUse key, plus `tool_response` object and `duration_ms` number.
- `tool_response`, inline call: `success` boolean, `commandName` string, and nothing else.
- `tool_response`, forked call: `success` boolean, `commandName` string, `status` string (`"forked"` on every observed call), `background` boolean (`true`), `agentId` string, `result` string (`"Running in the background as @dev-process-toolkit-tdd-write-test"`).

## Failure cases (AC-STE-714.3)

PostToolUse did not fire for any of the three, under either registration. No field carries an exit code: no observed `tool_response` has one, and on these calls there is no `tool_response` at all. The error flag lives only in the transcript's `tool_result` block:

- exit 1: `"is_error": true`, content `"Exit code 1\ncase-fail"`.
- interrupted: `"is_error": true`, content beginning `"The user doesn't want to proceed with this tool use. The tool use was rejected"`, and the record's `toolUseResult` is `"User rejected tool use"`. The Esc press is at 1793939877823 and the `tool_result` record at 1793939877820.
- hook-blocked: `"is_error": true`, content beginning `"PreToolUse:Bash hook error: [\"/synthetic/repo/.claude-config/plugins/cache/dev-process-toolkit/dev-process-toolkit/3.0.0\"/templates/hooks/process/pre-commit-gate-check.sh"`.

Two more Bash calls in B5 and B6 exited non-zero and also recorded Pre only. Only `PreToolUse` and `PostToolUse` were registered, so whether Claude Code fires a separate failure event was not measured.

## Pairing and fork timing (AC-STE-714.4)

`tool_use_id` is present on both events and equal for one call: all 65 `local` events pair by it, with no Pre/Post mismatch. The same id is the `id` of the transcript's `tool_use` block and the `tool_use_id` of its `tool_result`.

A forked Skill call's PostToolUse fires as soon as the fork is launched, before the fork makes any internal call. `tdd-write-test` (`toolu_SYNTH_06`): Pre at 1793941067335, Post at 1793941067383 (48 ms later, `duration_ms` 11). The fork's first internal call has its Pre at 1793941071732, its last internal call has its Post at 1793941077473, and the fork's result reaches the main transcript as a `<task-notification>` queue record at 1793941084992. That record carries `<task-id>` equal to the Post's `tool_response.agentId` and `<tool-use-id>` equal to the Skill call's `tool_use_id`. The other four forks behave the same way: Skill Post fires 43 to 48 ms after Skill Pre.

An inline Skill call's PostToolUse also fires before the skill's work: it fires when the skill's text is loaded. C1 (`toolu_SYNTH_11`): Pre at 1793943668442, Post at 1793943668472 (30 ms later, `duration_ms` 5). The two Bash calls the skill's instructions then led to have their Pre at 1793943674556 and 1793943678312, after the Skill Post. So for inline and forked skills alike, a Skill Pre/Post pair brackets the skill's launch, never its work.

## Calls inside a fork (AC-STE-714.5)

Recorder events from calls made inside a fork, per registration (identical under `local` and `plugin`):

| Run | Fork (scrubbed agent id) | Events per registration |
|-----|--------------------------|-------------------------|
| `/tdd` | `tdd-write-test` (`agent_SYNTH_01`) | 4 (two Bash calls, Pre + Post) |
| `/tdd` | `tdd-implement` (`agent_SYNTH_03`) | 4 (two Bash calls) |
| `/tdd` | `tdd-refactor` (`agent_SYNTH_04`) | 2 (one Bash call) |
| `/tdd` | `tdd-spec-review` (`agent_SYNTH_05`) | 0 (it made no Bash or Skill call) |
| `/spec-review` | `spec-review-audit` (`agent_SYNTH_02`) | 2 (one Bash call) |

So `/tdd` yielded 10 fork-internal events per registration and `/spec-review` yielded 2. On every one of them `agent_id` equals the launching Skill Post's `tool_response.agentId` (for example `agent_SYNTH_01`), and `agent_type` is `"general-purpose"`, not the child skill's `agent:` name. `transcript_path` equals the parent's, `/synthetic/repo/.claude-config/projects/-synthetic-repo/00000000-0000-4000-8000-000000000002.jsonl`, and does not point at the fork's own file. No main-session event carries `agent_id` or `agent_type`.

## Fork usage records (AC-STE-714.6)

Usage-bearing assistant records produced inside a fork do **not** appear in the main transcript. The committed main slice `tdd-run-main-transcript-slice.jsonl` covers the `/tdd` run from its prompt to the next prompt: 46 records, 22 of them usage-bearing assistant records, with `attributionSkill` `dev-process-toolkit:tdd` on 5 and absent on 17. None is attributed to a child skill, and none carries `isSidechain: true`. The fork's records are written to a separate file, `<session>/subagents/agent-<id>.jsonl`, next to `agent-<id>.meta.json` and `agent-<id>.forked-skill.json`. The committed slice `tdd-write-test-fork-transcript-slice.jsonl` has 9 records, all `isSidechain: true`, 5 of them usage-bearing with `attributionSkill` `dev-process-toolkit:tdd-write-test`. That differs from the earlier measurement recorded with STE-641, which found no `agent-*.jsonl` for a running fork.

## Offsets and hook cost (AC-STE-714.7)

Offset is the recorder's `wall_clock_ms` minus the matching transcript record's `timestamp`, for the `local` registration.

| Case | Pre vs `tool_use` | Post vs `tool_result` |
|------|-------------------|-----------------------|
| A1 | +23 ms | −4 ms |
| B1 exit 0 | +25 ms | −4 ms |
| B2 exit 1 | +24 ms | no Post |
| B3 interrupted | +24 ms | no Post |
| B4 hook-blocked | +25 ms | no Post |
| B5 inline skill (Bash calls, n=9 Pre, 8 Post) | +23 to +28 ms | −5 to −3 ms |
| B6 main-session Bash (n=4 Pre, 3 Post) | +24 to +29 ms | −3 ms |
| B6 Skill calls (n=4) | +22 to +39 ms | −6 to −4 ms |
| B6 fork-internal Bash (n=5) | +23 to +28 ms | −7 to −3 ms |
| B7 Skill call | +22 ms | −5 ms |
| B7 main-session Bash (n=2) | +24 to +25 ms | −5 to −3 ms |
| B7 fork-internal Bash (n=1) | +23 ms | −3 ms |
| C1 inline Skill call | +25 ms | −2 ms |
| C1 Bash calls after it (n=2) and C2 (n=1) | +25 to +26 ms | −2 to −1 ms |

Every Pre event lands 22 to 39 ms after its `tool_use` record, and every Post event lands 1 to 7 ms before its `tool_result` record.

No-op Bun hook (`bun run` of a file that drains stdin and exits, 30 runs on the measurement machine, one-byte stdin): p50 16.4 ms, p95 18.6 ms (min 15.4 ms, max 20.4 ms), timed by a Python `subprocess.run` loop around `bun run noop.ts` with nothing else running. The noop file is `for await (const _ of process.stdin) {}` followed by `process.exit(0)`.

## Working directory (AC-STE-714.14)

For both registrations `CLAUDE_PROJECT_DIR` was `/synthetic/repo` on all 124 events, equal to the checkout root. `process.cwd()` equalled the payload's `cwd` on all 124 events, and it follows the session's current directory. It was `/synthetic/repo` on 85 events, and `/synthetic/repo/plugins/dev-process-toolkit` on 39, after a Bash call had run `cd` into that subdirectory (inside forks too). So the hook's working directory is not always the checkout root, and `CLAUDE_PROJECT_DIR` is.

A `local` entry added while a session runs fires before the session restarts. In session A the entry was copied into the project-local settings file at 08:34:29. The very next Bash call (A1) fired both `local` events, and the UI showed no hooks-changed notice or prompt.

## Scrub table

One pass (`scrub.py`, kept beside the recorder, not shipped) wrote every committed payload and both transcript slices, sharing one mapping across files:

- every session id (`session_id`, `sessionId`) becomes `00000000-0000-4000-8000-0000000000NN`;
- every record `uuid` and `parentUuid`, and every other UUID (`prompt_id`, `promptId`), becomes `00000000-0000-4000-8000-0000001000NN`, numbered by first appearance;
- every `tool_use_id` becomes `toolu_SYNTH_NN`, and every fork agent id becomes `agent_SYNTH_NN`;
- every absolute path, `cwd` and `transcript_path` included, becomes `/synthetic/repo/...` (the checkout as `/synthetic/repo`, the Claude config directory as `/synthetic/repo/.claude-config`, the temp directory as `/synthetic/repo/tmp`, the recorder directory as `/synthetic/repo/spike`);
- every Claude project-folder slug (`-Users-<name>-...` or `-home-<name>-...`, the `cwdToSlug` form) becomes `-synthetic-repo`;
- every branch name, `gitBranch` included, becomes `synthetic-branch`;
- every email address becomes `<email-scrubbed>`.

The transcript slices are also field-reduced: each record keeps `type`, `uuid`, `parentUuid`, `sessionId`, `timestamp`, `isSidechain`, `attributionSkill`, `cwd`, `gitBranch`, `promptId`, `agentId`, and its message's role, numeric `usage` fields and content block types. A `tool_use` keeps `id`, `name` and its `skill` or `command` input, a `tool_result` keeps `tool_use_id` and `is_error`, text and thinking become `[elided]`, and a task notification's `<result>` body becomes `[elided]`. The same pass scrubs the gate transcript slices STE-715 commits under `tests/fixtures/m_7bc805-gate-slices/`.

## Removal (AC-STE-714.11)

After the last case of session B both registrations were removed, and after session C its `local` entry was removed the same way. The project-local settings file's hooks block now reads:

```json
{
  "hooks": {}
}
```

The throwaway plugin directory no longer exists (`ls` reports `No such file or directory`). Both measurement checkouts were then deleted as worktrees.

## Decision table (AC-STE-714.8)

| Row | Answer | Measurement it rests on |
|-----|--------|-------------------------|
| D1 | **yes** | Fork-internal calls fire both events under both registrations (10 per registration in `/tdd`, 2 in `/spec-review`), each carrying `agent_id` (equal to the launching Skill's `tool_response.agentId`) and `agent_type: "general-purpose"`, which no main-session event carries. `transcript_path` is not distinct. |
| D2 | **no** | No `tool_response` carries a numeric exit code; exit-1, interrupted and hook-blocked calls fire no PostToolUse at all. The transcript's `"is_error": true` with `"Exit code 1\ncase-fail"` is the only error signal. |
| D3 | **no** | The main `/tdd` slice holds 22 usage-bearing assistant records, none attributed to a child skill. The fork's 5 usage-bearing records live only in `subagents/agent-<id>.jsonl`. |
| D4 | **yes** | One `Bash|Skill` matcher per event recorded 29 Pre Bash, 24 Post Bash, 6 Pre Skill and 6 Post Skill events under `local`. |
| D5 | **no** | `tdd-write-test` Skill Post at 1793941067383, the fork's first internal Pre at 1793941071732, its last internal Post at 1793941077473; Post fires 43 to 48 ms after Pre on all five forks, and 30 ms after Pre on the inline call (C1). |
| D6 | **yes** | The `local` entry fired Pre and Post for Bash (B1) and Skill (B6) after a fresh start (session B), with `CLAUDE_PROJECT_DIR` = `/synthetic/repo`, the checkout root, on every event. |

Branches the later FRs implement:

- **STE-716** proceeds (D6 yes) and registers capture in the project-local settings file. Rows carry `scope: "fork"` for calls whose payload has `agent_id`, else `scope: "main"` (D1 yes). Rows carry no exit field (D2 no). One registration per event with the `Bash|Skill` matcher (D4 yes).
- **STE-717** attributes fork-internal calls to the enclosing round (D1 yes), takes `is_error` from the transcript only (D2 no), reports per-round `tokens` as `"not-observable"` (D3 no), and reports `tree_changed` as `null` with `tree_disposition: "not-observable"` for every round (D5 no).
- **STE-715** names no decision row.

Two findings sit outside the six rows, and later FRs should not lose them. A forked Skill call's result is not in its `tool_result`, which says only that the fork is running in the background. It arrives later as a `<task-notification>` naming the Skill call's `tool_use_id`, so a reader of round results has to look there. And fork usage, while absent from the main transcript, is on disk in the session's `subagents/` directory, so D3's `no` describes the main transcript only.
