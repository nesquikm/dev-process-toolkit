# Hooks Reference — Process-Category Toolkit-Contract Enforcement

This is the user manual for the **opt-in, per-project toolkit-contract enforcement hooks** seeded by `/setup` (STE-285, M71). The hooks are the byte-checkable layer of the Honored Contracts enforcement stack — the prose layer ships separately at `docs/honored-contracts.md` (STE-283).

**Scope.** All hooks in this catalog are **Process** category — they enforce contracts between skills (e.g., "run `/gate-check` before `git commit`"). Quality hooks (format-on-write, lint) and Safety hooks (destructive-op blocks) are explicitly out of scope per the STE-285 `/brainstorm` decision (2026-05-13).

**Opt-in by design.** Every hook defaults to **off**. `/setup` prompts via a single multi-select `AskUserQuestion` after stack detection. Re-run `/setup --hooks` at any time to add, remove, or toggle hooks without re-running stack detection.

**Install shape.** Each selected hook lands in your project's `.claude/settings.json` as a `bash` exec-form command referencing `${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/<name>.sh`. The plugin owns the script body; updates propagate automatically when the plugin updates (no `/setup` re-run needed).

**NFR-10 refusal shape.** On a contract miss, hooks exit non-zero and write a 3-line structured refusal to stderr in the canonical NFR-10 shape emitted by `templates/hooks/_lib/session.sh`:

```
Refusing: <one-line reason>
Remedy: <one-line remediation>
Context: mode=hook, ticket=unbound, skill=<skill>, hook=<hook>
```

Advisory (non-blocking) hooks substitute `Reminder:` for `Refusing:` and exit 0.

The Claude Code harness surfaces this stderr block back to the model, which then either runs the missing skill or asks the operator to confirm a deliberate override.

**Override pattern.** To customize a seeded hook's behavior on your project, snapshot-copy and edit:

1. Copy `${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/<name>.sh` to a project-local path, e.g., `.claude/hooks/<name>.sh`.
2. Edit `.claude/settings.json` to replace the `${CLAUDE_PLUGIN_ROOT}/...` reference with the project-local path.
3. Plugin updates no longer touch your fork. Re-snapshot manually if you want upstream changes.

To disable a hook entirely, delete its block from `.claude/settings.json` (or run `/setup --hooks` and uncheck it).

**Fail-open on missing session log.** Every hook reads `$CLAUDE_SESSION_FILE` to detect required `Skill` `tool_use` entries. If `$CLAUDE_SESSION_FILE` is unset (e.g., commit made outside a Claude Code session, or a fresh session with no log yet), the hook exits 0 — non-Claude commits are never blocked. The fail-open trade-off is explicitly accepted (see STE-285 Risks table).

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
- **Override pattern:** Snapshot-copy `${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/pre-commit-gate-check.sh` to `.claude/hooks/pre-commit-gate-check.sh`, edit (e.g., relax the matcher or whitelist `--amend`), and repoint the `args` entry in `.claude/settings.json`.

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
- **Override pattern:** Snapshot-copy `${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/pre-pr-spec-review.sh` to `.claude/hooks/pre-pr-spec-review.sh`, edit (e.g., scope to specific repos or skip on docs-only branches), and repoint the `args` entry in `.claude/settings.json`.

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
- **Override pattern:** Snapshot-copy `${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/pre-spec-write-brainstorm-reminder.sh` to `.claude/hooks/pre-spec-write-brainstorm-reminder.sh`, edit (e.g., tune the greenfield heuristic or change the reminder threshold), and repoint the `args` entry in `.claude/settings.json`. Convert the exit code to non-zero if you want the reminder to hard-block.

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
- **Override pattern:** Snapshot-copy `${CLAUDE_PLUGIN_ROOT}/templates/hooks/process/pre-commit-tdd-orchestrator.sh` to `.claude/hooks/pre-commit-tdd-orchestrator.sh`, edit (e.g., tighten or loosen the "FR-related staged" heuristic, allow-list certain commit types like `docs:` or `chore:`), and repoint the `args` entry in `.claude/settings.json`.

---

## Related references

- `docs/honored-contracts.md` — prose-layer catalog of the same contracts these hooks enforce.
- `docs/skill-anatomy.md` — `${CLAUDE_PLUGIN_ROOT}` substitution pattern used by the hook install entries.
- STE-285 (M71) — FR that seeded this catalog.
- STE-283 (M71) — prose-layer FR; the TDD Orchestrator Contract callout in `/implement` Phase 2 step 8.
- STE-262, STE-270, STE-276 — cancellation chain that explicitly opened up the `/setup`-opt-in layer (rejected bundling these hooks in the plugin's auto-active `hooks/hooks.json`).
- STE-133 — `${CLAUDE_PLUGIN_ROOT}` commit-msg hook precedent (same install pattern).
