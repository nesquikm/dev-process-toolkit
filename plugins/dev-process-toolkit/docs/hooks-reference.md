# Hooks Reference — Process-Category Toolkit-Contract Enforcement

This is the user manual for the **plugin-bundled, harness-auto-discovered Process-category toolkit-contract enforcement hooks** shipped at `plugins/dev-process-toolkit/hooks/hooks.json` (STE-289, M74). The hooks are the byte-checkable layer of the Honored Contracts enforcement stack — the prose layer ships separately at `docs/honored-contracts.md` (STE-283).

**Scope.** All hooks in this catalog are **Process** category — they enforce contracts between skills (e.g., "run `/gate-check` before `git commit`"). Quality hooks (format-on-write, lint) and Safety hooks (destructive-op blocks) are explicitly out of scope per the STE-285 `/brainstorm` decision (2026-05-13).

## How the harness loads these hooks

The Claude Code harness **auto-discovers** the plugin-bundled hook registration at session start. There is no `/setup` step, no user-settings.json mutation, no per-project opt-in. The 5 hooks fire across every project where the `dev-process-toolkit` plugin is enabled at user scope.

Per the Claude Code plugins reference (`code.claude.com/docs/en/plugins-reference.md#hooks` + `#environment-variables`):

1. On `/plugin install` from the marketplace, Claude Code copies the plugin source into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. For this repo, the cache flattens `plugins/dev-process-toolkit/` to the top level, so the bundled hook config lands at `~/.claude/plugins/cache/dev-process-toolkit/dev-process-toolkit/<version>/hooks/hooks.json`.
2. On session start, the harness auto-discovers each enabled plugin's `hooks/hooks.json` and registers the hooks against the matchers (event + tool/prompt pattern).
3. At hook-fire time, the literal token `${CLAUDE_PLUGIN_ROOT}` is substituted inline against the plugin's runtime path on the user's machine — the plugin cache directory, not any dev-clone path.
4. Plugin hooks fire in **every project** where the plugin is enabled (user scope). No per-project opt-in mechanism; opt-out is `claude plugin disable dev-process-toolkit` per the harness contract.

**Install shape.** The five hook entries live in `<plugin-root>/hooks/hooks.json` as `command`-type entries whose `command` field is the literal inline form `"${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/<name>.sh` with `timeout: 5000`. The plugin owns the script bodies; updates propagate automatically when the plugin updates (no user action needed).

**NFR-10 refusal shape.** On a contract miss, hooks exit non-zero and write a 3-line structured refusal to stderr in the canonical NFR-10 shape emitted by `templates/hooks/_lib/session.ts`:

```
Refusing: <one-line reason>
Remedy: <one-line remediation>
Context: mode=hook, ticket=unbound, skill=<skill>, hook=<hook>
```

Advisory (non-blocking) hooks substitute `Reminder:` for `Refusing:` and exit 0.

**Exit-code contract (Claude Code 2.1.x).** The 3 Refusing hooks emit blocking refusals via `exit 2`, per the empirically-verified Claude Code 2.1.141 hook contract:
- `exit 0` → tool call proceeds (no stderr surfaced).
- `exit 2` → tool call **blocked**; harness surfaces stderr to the model as feedback context.
- any other non-zero (including `exit 1`) → advisory; harness shows stderr to operator only and proceeds with the tool call.

STE-290 wired the layer to the real harness stdin `transcript_path` contract; STE-291 tightened the miss-path from `exit 1` (advisory) to `exit 2` (blocking) so the layer actually blocks.

The Claude Code harness surfaces this stderr block back to the model, which then either runs the missing skill or asks the operator to confirm a deliberate override.

**Fail-open on missing session log.** Every hook reads the `transcript_path` field from the harness-supplied stdin JSON payload (per STE-290's empirically-verified 2026-05-14 hook contract; supersedes STE-285's never-set `$CLAUDE_SESSION_FILE` env-var assumption) to detect required `Skill` `tool_use` entries. If stdin is empty / unparseable / lacks `transcript_path` (e.g., commit made outside a Claude Code session, or a fresh session with no log yet), the hook exits 0 — non-Claude commits are never blocked. The fail-open trade-off is explicitly accepted (see STE-285 Risks table, carried forward to STE-289 / STE-290).

## Override pattern

Because the hooks ship bundled inside the plugin, editing them in place is not the override path — plugin updates would overwrite a forked `hooks/hooks.json` and the harness only honors `${CLAUDE_PLUGIN_ROOT}` expansion inside the plugin's own registration surface. Operators have two override paths:

1. **Disable the plugin's bundled hook entirely.** Run `claude plugin disable dev-process-toolkit` (per the harness contract) to stop all 5 hooks from firing. There is no per-hook on/off; the registration is plugin-scoped.
2. **Copy-and-override into the operator's own `.claude/`.** Snapshot-copy the seeded script (e.g., `cp ~/.claude/plugins/cache/dev-process-toolkit/dev-process-toolkit/<version>/templates/hooks/process/<name>.sh ~/.claude/hooks/<name>.sh`), edit the copy, then register the copy as a hook entry in the operator's own user-scoped `~/.claude/settings.json` (referencing the local path directly — `${CLAUDE_PLUGIN_ROOT}` does NOT expand outside the plugin's `hooks/hooks.json`). Disable the plugin's bundled version to avoid the original firing alongside the fork. Plugin updates no longer touch the operator's fork; re-snapshot manually for upstream changes.

The copy-and-override path is intentionally heavier than the prior install-side model offered. It reflects the harness contract: plugin-bundled registrations are owned by the plugin, and operator customization lives in operator-scoped settings against operator-managed script paths.

## Reversal context — STE-285 original (wrong) design intent

STE-285 (M71) originally seeded the first 4 hooks via an install-side mechanism — a `/setup` hooks installer that wrote entries into a user project's `.claude/settings.json` with `args[0]` rendered as either a dev-clone absolute path (pre-STE-288) or the literal `${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/<name>.sh` token (STE-288, v2.22.1). That design followed the rejection chain STE-262 / STE-270 / STE-276, which explicitly cancelled plugin-bundled `hooks/hooks.json` on three grounds (spawn blast radius, triple-check conflict, no clean per-session state surface).

**2026-05-14 empirical discovery:** the operator ran the install-side `/setup` hooks installer (preselect mode) against v2.22.1 in `~/workspace/quack`, then a hook tried to fire; the harness emitted:

```
Hook command references ${CLAUDE_PLUGIN_ROOT} but the hook is not associated with a plugin.
This variable is only available in hooks defined in a plugin's hooks/hooks.json file, not in [user settings.json].
```

Empirical research via the `claude-code-guide` agent confirmed the contract: `${CLAUDE_PLUGIN_ROOT}` only expands inside `<plugin>/hooks/hooks.json` (or the inline `hooks` field of `plugin.json`) — never inside user `.claude/settings.json`. The pre-STE-288 absolute-path shape also failed because the marketplace cache loads the plugin from `~/.claude/plugins/cache/<plugin>/<version>/`, not from any dev-clone path that an install-side writer would have hardcoded.

**M74 reversal.** STE-289 reverses direction: the 4 hook scripts under `templates/hooks/process/*.sh` are preserved unchanged (and their per-script unit tests under `templates/hooks/__tests__/*.test.ts` continue to validate behavior), but their registration moves entirely to plugin-bundled `hooks/hooks.json` for harness auto-discovery. The install-side approach STE-285 chose was structurally impossible from the start — the harness contract those rejection grounds analyzed was modeled wrong. STE-289's Technical Design addresses each rejection ground individually under the bundled model.

---

### pre-commit-gate-check

- **Name:** `pre-commit-gate-check`
- **Event:** `PreToolUse`
- **Matcher:** `Bash` (with command-pattern guard for `git commit*`)
- **Requirement:** A `Skill(/dev-process-toolkit:gate-check)` `tool_use` MUST appear in the current session log before any `git commit` invocation. Enforces the "gate-check before commit" contract at the byte layer.
- **NFR-10 refusal shape on miss:**
  ```
  Refusing: required dev-process-toolkit:gate-check Skill tool_use not found in current session.
  Remedy: run /dev-process-toolkit:gate-check before retrying this action.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:gate-check, hook=pre-commit-gate-check
  ```
- **Override pattern:** Disable the plugin (`claude plugin disable dev-process-toolkit`) or copy-and-override per the section above — snapshot-copy `~/.claude/plugins/cache/dev-process-toolkit/dev-process-toolkit/<version>/templates/hooks/process/pre-commit-gate-check.sh` into `~/.claude/hooks/pre-commit-gate-check.sh`, edit (e.g., relax the matcher or whitelist `--amend`), and register the local path in the operator's `~/.claude/settings.json` against an absolute path (no `${CLAUDE_PLUGIN_ROOT}` expansion outside plugin scope).

### pre-pr-spec-review

- **Name:** `pre-pr-spec-review`
- **Event:** `PreToolUse`
- **Matcher:** `Bash` (with command-pattern guard for `gh pr create*`)
- **Requirement:** A `Skill(/dev-process-toolkit:spec-review)` `tool_use` MUST appear in the current session log before any `gh pr create` invocation. Enforces the "spec-review before PR" contract at the byte layer.
- **NFR-10 refusal shape on miss:**
  ```
  Refusing: required dev-process-toolkit:spec-review Skill tool_use not found in current session.
  Remedy: run /dev-process-toolkit:spec-review before retrying this action.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:spec-review, hook=pre-pr-spec-review
  ```
- **Override pattern:** Disable the plugin or copy-and-override — snapshot-copy the seeded script into `~/.claude/hooks/pre-pr-spec-review.sh`, edit (e.g., scope to specific repos or skip on docs-only branches), and register the local absolute path in the operator's `~/.claude/settings.json`.

### pre-spec-write-brainstorm-reminder

- **Name:** `pre-spec-write-brainstorm-reminder`
- **Event:** `UserPromptSubmit`
- **Matcher:** `*` (filters internally on `/dev-process-toolkit:spec-write` invocation)
- **Requirement:** When the user invokes `/dev-process-toolkit:spec-write`, the hook checks for a prior `Skill(/dev-process-toolkit:brainstorm)` `tool_use` in the current session. If absent AND the FR appears greenfield (heuristic: no resolved tracker ID arg passed), the hook injects a **stderr reminder** to consider `/brainstorm` first. This is a soft nudge — the hook does NOT block.
- **NFR-10 refusal shape on miss:** This hook does **not** refuse; it only emits a reminder. The reminder text uses the NFR-10 shape for consistency but exits 0:
  ```
  Reminder: no dev-process-toolkit:brainstorm Skill tool_use in this session and the FR looks greenfield (no tracker ID).
  Remedy: consider running /dev-process-toolkit:brainstorm first to explore the design space before drafting the spec.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:brainstorm, hook=pre-spec-write-brainstorm-reminder
  ```
- **Override pattern:** Disable the plugin or copy-and-override — snapshot-copy the seeded script into `~/.claude/hooks/pre-spec-write-brainstorm-reminder.sh`, edit (e.g., tune the greenfield heuristic, change the reminder threshold, or convert the exit code to non-zero for a hard block), and register the local absolute path in the operator's `~/.claude/settings.json`.

### pre-commit-tdd-orchestrator

- **Name:** `pre-commit-tdd-orchestrator`
- **Event:** `PreToolUse`
- **Matcher:** `Bash` (with command-pattern guard for `git commit*`)
- **Requirement:** If FR-related files are staged (heuristic: `specs/frs/<id>.md` or matching test files under `tests/` referencing an FR ID), a `Skill(/dev-process-toolkit:tdd)` `tool_use` MUST appear in the current session log. Byte-checkable continuation of STE-283's TDD Orchestrator Contract: prevents the "Inline TDD Antipattern" where `/implement` writes tests + code itself instead of forking `/dev-process-toolkit:tdd`.
- **NFR-10 refusal shape on miss:**
  ```
  Refusing: required dev-process-toolkit:tdd Skill tool_use not found in current session.
  Remedy: run /dev-process-toolkit:tdd before retrying this action.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:tdd, hook=pre-commit-tdd-orchestrator
  ```
- **Override pattern:** Disable the plugin or copy-and-override — snapshot-copy the seeded script into `~/.claude/hooks/pre-commit-tdd-orchestrator.sh`, edit (e.g., tighten or loosen the "FR-related staged" heuristic, allow-list certain commit types like `docs:` or `chore:`), and register the local absolute path in the operator's `~/.claude/settings.json`.

### session-token-ledger

- **Name:** `session-token-ledger`
- **Event:** `SessionEnd`, with `Stop` wired as an equivalent trigger (robustness pick — survives unclean exits; both re-derive the whole session and replace its rows, so repeated firing is idempotent).
- **Matcher:** `*`
- **Behavior:** Capture hook, not a gate (STE-344, M92). Parses `transcript_path` + `session_id` from the stdin hook JSON via `parseHookPayload`, aggregates the session's per-`(attributionSkill, model)` token usage via `parseTranscriptTokenUsage`, and writes the rows to the git-ignored `<project>/.dev-process/token-ledger.jsonl` (`writeSessionRows` — replaces any rows already recorded for the `session_id`, atomic temp-file + rename write). **Fail-open by contract:** any parse/IO error exits `0` with no write and no stderr — there is no refusal shape, and the hook never blocks session teardown or dirties the tracked tree.
- **Override pattern:** Disable the plugin, or copy-and-override — snapshot-copy `templates/hooks/process/session-token-ledger.sh` into `~/.claude/hooks/`, edit (e.g., change the ledger location or restrict to `SessionEnd` only), and register the local absolute path in the operator's `~/.claude/settings.json`.

---

## Related references

- `hooks/hooks.json` — the plugin-bundled registration surface this catalog documents.
- `docs/honored-contracts.md` — prose-layer catalog of the same contracts these hooks enforce.
- `docs/skill-anatomy.md` — `${CLAUDE_PLUGIN_ROOT}` substitution pattern used by the bundled hook entries.
- STE-289 (M74) — current FR; bundled `hooks/hooks.json` model, supersedes M71/M72/M73 install-side mechanism.
- STE-285 (M71) — original install-side FR; design intent superseded by STE-289 after empirical falsification on 2026-05-14.
- STE-286 (M72), STE-288 (M73) — follow-up install-side fixes likewise superseded by STE-289.
- STE-283 (M71) — prose-layer FR; the TDD Orchestrator Contract callout in `/implement` Phase 2 step 8.
- STE-262, STE-270, STE-276 — cancellation chain that originally rejected bundled `hooks/hooks.json`; rejection grounds re-analyzed and reversed under STE-289.
- STE-133 — `${CLAUDE_PLUGIN_ROOT}` commit-msg hook precedent (same substitution pattern; install-side path remains valid for that hook because the hook lives in `.git/hooks/`, not in the harness-managed hook surface).
