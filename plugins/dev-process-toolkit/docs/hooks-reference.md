# Hooks Reference — Process-Category Toolkit-Contract Enforcement

This is the user manual for the **plugin-bundled, harness-auto-discovered Process-category toolkit-contract enforcement hooks** shipped at `plugins/dev-process-toolkit/hooks/hooks.json` (STE-289, M74). The hooks are the byte-checkable layer of the Honored Contracts enforcement stack — the prose layer ships separately at `docs/honored-contracts.md` (STE-283).

**Scope.** All hooks in this catalog are **Process** category — they enforce contracts between skills (e.g., "run `/gate-check` before `git commit`"). Quality hooks (format-on-write, lint) and Safety hooks (destructive-op blocks) are explicitly out of scope per the STE-285 `/brainstorm` decision (2026-05-13).

## How the harness loads these hooks

The Claude Code harness **auto-discovers** the plugin-bundled hook registration at session start. There is no `/setup` step, no user-settings.json mutation, no per-project opt-in. The 6 hooks fire across every project where the `dev-process-toolkit` plugin is enabled at user scope.

Per the Claude Code plugins reference (`code.claude.com/docs/en/plugins-reference.md#hooks` + `#environment-variables`):

1. On `/plugin install` from the marketplace, Claude Code copies the plugin source into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. For this repo, the cache flattens `plugins/dev-process-toolkit/` to the top level, so the bundled hook config lands at `~/.claude/plugins/cache/dev-process-toolkit/dev-process-toolkit/<version>/hooks/hooks.json`.
2. On session start, the harness auto-discovers each enabled plugin's `hooks/hooks.json` and registers the hooks against the matchers (event + tool/prompt pattern).
3. At hook-fire time, the literal token `${CLAUDE_PLUGIN_ROOT}` is substituted inline against the plugin's runtime path on the user's machine — the plugin cache directory, not any dev-clone path.
4. Plugin hooks fire in **every project** where the plugin is enabled (user scope). No per-project opt-in mechanism; opt-out is `claude plugin disable dev-process-toolkit` per the harness contract.

**Install shape.** The hook entries live in `<plugin-root>/hooks/hooks.json` as seven `command`-type entries registering the six distinct scripts — `session-token-ledger` is wired twice, once under `SessionEnd` and once under `Stop` — each whose `command` field is the literal inline form `"${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/<name>.sh` with `timeout: 5000`. Claude Code reads `timeout` in **seconds**, and a PreToolUse command hook that times out does not block its tool call, so a gate must never be slow or hang: the tracker-write gate's own runtime is graded at tens of milliseconds (AC-STE-607.9). The plugin owns the script bodies; updates propagate automatically when the plugin updates (no user action needed).

**NFR-10 refusal shape.** On a contract miss, hooks exit non-zero and write a 3-line structured refusal to stderr in the canonical NFR-10 shape emitted by `templates/hooks/_lib/session.ts`:

```
Refusing: <one-line reason>
Remedy: <one-line remediation>
Context: mode=hook, ticket=unbound, skill=<skill>, hook=<hook>
```

Advisory (non-blocking) hooks substitute `Reminder:` for `Refusing:`. For the commit gates (`pre-commit-gate-check`, `pre-commit-tdd-orchestrator`) a `Reminder:` exits 1, never 0 — the harness shows no stderr on exit 0, so a Reminder there would be a silent allow; exit 1 is visible and the commit still proceeds.

**Exit-code contract (Claude Code 2.1.x).** The 4 Refusing hooks emit blocking refusals via `exit 2`, per the empirically-verified Claude Code 2.1.141 hook contract:
- `exit 0` → tool call proceeds (no stderr surfaced).
- `exit 2` → tool call **blocked**; harness surfaces stderr to the model as feedback context.
- any other non-zero (including `exit 1`) → advisory; harness shows stderr to operator only and proceeds with the tool call.

STE-290 wired the layer to the real harness stdin `transcript_path` contract; STE-291 tightened the miss-path from `exit 1` (advisory) to `exit 2` (blocking) so the layer actually blocks.

The Claude Code harness surfaces this stderr block back to the model, which then either runs the missing skill or asks the operator to confirm a deliberate override.

**What counts as evidence — the Skill call PLUS its receipt in the repository.** From this milestone's release, a blocking gate reads TWO legs, and it demands both. The transcript leg is the `Skill` `tool_use` in the current session, unchanged. The repository leg is the gate's own **receipt in the repository being committed to or PR'd**: a gate run records itself in that checkout's `.dpt` receipt store, and a commit or PR into a toolkit-managed checkout is refused unless this session holds a receipt naming that same checkout. This applies in **every** toolkit-managed checkout — shared container or not, `repo_tag` declared or not. The transcript alone said only that the gate ran *somewhere in this session*, so a gate run in one checkout let a commit into a second one straight through; a receipt says *which checkout*, and one gate run vouches for exactly one of them. The receipt is minted by running the gate and by nothing else — no refusal here ever prints the front-door command that writes one, because a remedy handing back the minting command would invite a receipt with no gate behind it. The one and only way to satisfy the repository leg is to run the gate against that checkout.

**A receipt counts only when this session announced it.** The file alone proves nothing: a receipt is an ordinary file, and any Bash call can write one. So the gate looks for the front door's own `dpt-receipt: <path> sha256:<digest>` line in the result of the Bash call that ran it, checks the file still hashes to that digest, and decides which checkout a gate run vouched for by where that announcement sits in the transcript — never by a timestamp inside the file. Measured before this rule landed: a hand-written receipt naming a checkout no gate had run against, stamped a millisecond earlier than the genuine one, won the window and its commit was permitted. A receipt nobody announced is not evidence, and a file rewritten after its announcement stops being evidence.

**Fail-open on missing session log — the ONE fail-open leg.** Every hook reads the `transcript_path` field from the harness-supplied stdin JSON payload (per STE-290's empirically-verified 2026-05-14 hook contract; supersedes STE-285's never-set `$CLAUDE_SESSION_FILE` env-var assumption) to detect required `Skill` `tool_use` entries. The harness-absent case — stdin empty, stdin unparseable, no `transcript_path`, or a `transcript_path` naming a file that does not exist or cannot be read (e.g., a commit made outside a Claude Code session, or a fresh session with no log yet) — makes all three blocking hooks exit 0, **including on a toolkit-managed target holding no gate receipt**. Non-Claude commits are never blocked. This is the only leg on which a guard passes without evidence, and it is a decision, not an accident: it is asked once, by `harnessAbsent` in `templates/hooks/_lib/session.ts`, before any other verdict — ahead of the advisory `Reminder:` legs too, since with no harness there is no operator to read their stderr. The fail-open trade-off is explicitly accepted (see STE-285 Risks table, carried forward to STE-289 / STE-290 / STE-614).

## Override pattern

Because the hooks ship bundled inside the plugin, editing them in place is not the override path — plugin updates would overwrite a forked `hooks/hooks.json` and the harness only honors `${CLAUDE_PLUGIN_ROOT}` expansion inside the plugin's own registration surface. Operators have two override paths:

1. **Disable the plugin's bundled hook entirely.** Run `claude plugin disable dev-process-toolkit` (per the harness contract) to stop all 6 hooks from firing. There is no per-hook on/off; the registration is plugin-scoped.
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
- **Matcher:** `Bash` (commit-bearing commands resolved by `resolveCommitTarget` — the bare, `cd`-prefixed and `-C` forms alike; STE-597)
- **Requirement:** A `Skill(/dev-process-toolkit:gate-check)` `tool_use` MUST appear in the current session log before any `git commit` invocation, **and** — when the commit's target checkout is toolkit-managed — this session MUST hold a `/gate-check` receipt in that repository's own receipt store. Enforces the "gate-check before commit" contract at the byte layer. An unplaced commit (`GIT_DIR=<B>/.git git commit`, or a wrapper the reader cannot see through) is graded against every checkout it could land in — the session's own plus each root the command names — and, once it passes, still draws a `Reminder:` naming the target it could not place.
- **NFR-10 refusal shape on a missing Skill call:**
  ```
  Refusing: required dev-process-toolkit:gate-check Skill tool_use not found in current session.
  Remedy: run /dev-process-toolkit:gate-check before retrying this action.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:gate-check, hook=pre-commit-gate-check
  ```
- **NFR-10 refusal shape when the Skill call is there but the repository holds no receipt** (`<root>` is the checkout being committed to, `<store>` this session's receipt directory under it):
  ```
  Refusing: this action writes to <root>, a toolkit-managed checkout, and this session holds no dev-process-toolkit:gate-check gate receipt for it under <store>, so nothing shows the gate ran against that checkout.
  Remedy: run /dev-process-toolkit:gate-check <root>, then retry this action.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:gate-check, hook=pre-commit-gate-check
  ```
  A receipt that IS there but belongs to another run reads differently, because sending the operator to look for a file sitting in front of them is the wrong remedy: `Refusing: … the dev-process-toolkit:gate-check gate receipt under <store> is not vouched for by any dev-process-toolkit:gate-check Skill call in this session: the dev-process-toolkit:gate-check run it would have to belong to already recorded <other checkout>, and one gate run vouches for one checkout, so nothing shows the gate ran against that checkout.` Same `Remedy:` line.

  **Every state of the store refuses by its own name**, on the same `Refusing: this action writes to <root>, a toolkit-managed checkout, and …` opening and with the same `Remedy:` line, because "no receipt" about a directory that holds one sends the operator to fix the wrong thing:

  | what the store holds | the clause it refuses with |
  | --- | --- |
  | nothing for this gate | `this session holds no <skill> gate receipt for it under <store>, so nothing shows …` |
  | a receipt for a different gate | `the only gate receipt this session holds for it under <store> records <other skill>, not <skill>, so nothing shows …` |
  | a receipt written for another checkout (copied, or a relocated tree) | `the <skill> gate receipt under <store> was written for <other checkout>, not for <root>, so nothing shows …` |
  | a receipt for this checkout that no gate run in this session accounts for | the `is not vouched for …` clause above |
  | a store this hook cannot read at all | `its <skill> gate receipt store under <store> could not be read, so nothing shows …` |
  | the payload carries no `session_id` | `the hook payload carries no session_id — repository-scoped gate evidence is keyed by the session that produced it, so the <skill> receipt for that checkout could not be looked up.` |

  Files in the directory that did not parse as a receipt — an unreadable one, a malformed one, an envelope of a version this toolkit does not read — are skipped by the store's reader and **counted in the refusal**: ` N file(s) there were skipped as unreadable or malformed.` closes the sentence. The same table drives the /tdd and (from STE-615) the PR gate, with their own skill names, because all three read one rule.
- **Override pattern:** Disable the plugin (`claude plugin disable dev-process-toolkit`) or copy-and-override per the section above — snapshot-copy `~/.claude/plugins/cache/dev-process-toolkit/dev-process-toolkit/<version>/templates/hooks/process/pre-commit-gate-check.sh` into `~/.claude/hooks/pre-commit-gate-check.sh`, edit (e.g., relax the matcher or whitelist `--amend`), and register the local path in the operator's `~/.claude/settings.json` against an absolute path (no `${CLAUDE_PLUGIN_ROOT}` expansion outside plugin scope).

### pre-pr-spec-review

- **Name:** `pre-pr-spec-review`
- **Event:** `PreToolUse`
- **Matcher:** `Bash` (with command-pattern guard for `gh pr create*`)
- **Requirement:** A `Skill(/dev-process-toolkit:spec-review)` `tool_use` MUST appear in the current session log before any `gh pr create` invocation. Enforces the "spec-review before PR" contract at the byte layer. The house rule is the same two-legged one as the commit gates — the Skill call **plus** the review's receipt in the repository the PR is raised from — and `/spec-review` already mints that receipt in the checkout it runs against; what this hook does not yet do is resolve the `gh pr create` target repository and grade the receipt leg against it, which lands under STE-615. Until it does, a PR raised from a session that reviewed a *different* checkout is caught by the commit gates on that checkout rather than here.
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
  Reminder: greenfield /dev-process-toolkit:spec-write invoked without prior /dev-process-toolkit:brainstorm.
  Remedy: consider running /dev-process-toolkit:brainstorm first to clarify the design space.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:brainstorm, hook=pre-spec-write-brainstorm-reminder
  ```
- **Override pattern:** Disable the plugin or copy-and-override — snapshot-copy the seeded script into `~/.claude/hooks/pre-spec-write-brainstorm-reminder.sh`, edit (e.g., tune the greenfield heuristic, change the reminder threshold, or convert the exit code to non-zero for a hard block), and register the local absolute path in the operator's `~/.claude/settings.json`.

### pre-commit-tdd-orchestrator

- **Name:** `pre-commit-tdd-orchestrator`
- **Event:** `PreToolUse`
- **Matcher:** `Bash` (commit-bearing commands resolved by `resolveCommitTarget` — the bare, `cd`-prefixed and `-C` forms alike; STE-597)
- **Requirement:** If FR-related files are staged (the predicate is `isTddRequiredPath` — `specs/frs/<id>.md` **or** any path the detected stack calls a test; a staged test file on its own fires it, and a staged source file on its own does not. An all-spec staged set is carved out ahead of that predicate and exits 0, so a spec-only commit never needs the run. Here "source" and "test" mean whatever the detected stack's layout says they mean, and a path matching the stack's test glob is a test wherever it lives — Dart sources under `lib/` with tests under `test/` or `integration_test/`; Python sources under `src/` with tests under `tests/` or `test/`; TypeScript/JavaScript sources under `src/` with tests under `__tests__/` or `tests/`; Kotlin/Java sources under `src/main/` with tests under `src/test/`; Go sources anywhere, paired with their `_test.go` siblings), the current session log MUST carry TDD evidence. Byte-checkable continuation of STE-283's TDD Orchestrator Contract: prevents the "Inline TDD Antipattern" where `/implement` writes tests + code itself instead of forking `/dev-process-toolkit:tdd`.
- **Two satisfying doors (STE-598):** the requirement above is a DISJUNCTION, not a single token, and the trigger that raises it is unchanged. Either of these discharges it:
  1. a `Skill(/dev-process-toolkit:tdd)` `tool_use` in the current session log — the per-FR orchestrator, the original and still the default door; or
  2. a **red-before proof**: one session line reading `` dpt-red-before-proof: repo=<checkout root> <paths> `` that names the checkout it covers and **every** staged path which raised the requirement. The `repo=` token is how a proof says which repository it is about — an absolute checkout root, matched by realpath, so a symlink to it is it and a sibling checkout is not. A claim carrying no `repo=` keeps the older reading and covers the session's own checkout only, so an honest proof typed in an FE session opens nothing for a commit aimed at BE. The second door exists for audit-driven work that has no FR at all, and therefore cannot run the per-FR orchestrator honestly — before it, that shape of work was refused with no satisfiable remedy, and the only workaround was the antipattern the gate exists to stop. It is deliberately scoped: a proof naming some other test file covers nothing, and an empty required set is never "covered" by it. Both doors are read through the SAME transcript reader (`readTranscriptLines`) — no second discovery mechanism ships. The threat model is self-discipline, not an adversary: nothing stops an operator typing the marker without having run anything, exactly as nothing stops one invoking the orchestrator without meaning it.
- **NFR-10 refusal shape when NEITHER door is open** (the staged paths that raised the requirement are named inline, singular or plural; `<root>` is the checkout being committed to):
  ```
  Refusing: no TDD evidence for the staged test path <staged path>: neither a dev-process-toolkit:tdd Skill tool_use nor a red-before proof covering it was found in this session.
  Remedy: run /dev-process-toolkit:tdd; or, for an audit-driven fix with no FR, run those tests against the pre-change bytes and record the red result in this session as a line reading `dpt-red-before-proof: repo=<root> <paths>` naming every staged test path it covers.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:tdd, hook=pre-commit-tdd-orchestrator
  ```
  When the orchestrator WAS called but every call for it ended in an error or a denial, the first line says that instead — `Refusing: no TDD evidence for <subject>: every dev-process-toolkit:tdd Skill tool_use in this session ended in an error or a denial, and no red-before proof covering them was found.` — because an operator who watched themself deny the call is not helped by being told it never happened.
- **NFR-10 refusal shape when door one is open but the repository holds no receipt** (door two was asked first and covered nothing):
  ```
  Refusing: this action writes to <root>, a toolkit-managed checkout, and this session holds no dev-process-toolkit:tdd gate receipt for it under <store>, so nothing shows the gate ran against that checkout.
  Remedy: run /dev-process-toolkit:tdd <root>, then retry this action.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:tdd, hook=pre-commit-tdd-orchestrator
  ```
- **Advisory shape when no stack is identified (STE-548):** the staged-set verdict has four outcomes, not three — the spec-only carve-out, nothing to guard, requires the run, and *could not tell*. The fourth fires when no stack marker resolves from the commit's directory up to the enclosing checkout, and it is deliberately **not** a refusal: the hook emits a `Reminder:` block naming the checkout root and the fact that no stack was identified, then exits 1 so the notice is visible and the commit proceeds. A guard that blocked on its own ignorance would punish the operator for it, and would be disabled within a week. Before this, an unidentified project silently reused the TypeScript rules, so a Dart or Go commit reported the same clean exit as a commit with genuinely nothing to guard — a guard that never looked was byte-indistinguishable from one that passed.
  ```
  Reminder: no stack marker was identified for <checkout root>, so the /tdd guard could not tell whether this commit stages a source file and its test.
  Remedy: add a recognised stack marker at the project root (for example `package.json`, `pubspec.yaml`, `pyproject.toml`, `go.mod`), or run /dev-process-toolkit:tdd yourself when this commit carries an FR.
  Context: mode=hook, ticket=unbound, skill=dev-process-toolkit:tdd, hook=pre-commit-tdd-orchestrator
  ```
- **Override pattern:** Disable the plugin or copy-and-override — snapshot-copy the seeded script into `~/.claude/hooks/pre-commit-tdd-orchestrator.sh`, edit (e.g., tighten or loosen the "FR-related staged" heuristic, allow-list certain commit types like `docs:` or `chore:`), and register the local absolute path in the operator's `~/.claude/settings.json`.

### pre-tracker-write-gate

- **Name:** `pre-tracker-write-gate`
- **Event:** `PreToolUse`
- **Matcher:** `^mcp__.+__(<names>)$`, generated from the one list `TRACKER_WRITE_TOOLS` in the hook module, so every server name matches (`atlassian`, `linear`, `claude_ai_Linear`, …). It fires on Jira and Linear tracker write tools only — reads never reach it.
- **Requirement:** Blocks tracker writes into a **shared container** — a Jira project or Linear team/project the target repository's CLAUDE.md declares as shared — that skipped the deciding commands. It demands receipts, not a `Skill` tool_use: a `create` needs an unspent `create` receipt for this session whose payload matches the call; a `ticket` write needs a subject the target owns (bound by a tracked FR file, created in this session, or named by a `reuse` / `binding` / `import` receipt, the last two backed by an answered consent). Receipts count only when a deciding module announced them in this session's transcript: a `dpt-receipt: <path> sha256:<digest>` line — exactly one — in the non-error result of a Bash call that is ONE plain invocation of a receipt-writing subcommand of this plugin's own deciding module, for a file that still hashes to the announced digest. A `create` receipt is single-use: receipts are allocated to create tool_uses in transcript order, pending parallel calls included, so two creates in one turn never share one. After a spent receipt the remedy is `decide --attempt retry-<N>`, which searches for the ticket a timed-out create may have made — a `reused` decision's receipt lets you write to it — and in a shared repository never authorises another create. A Linear create naming its team or project by UUID or slug (or a Jira create naming a numeric project id) is refused as unresolvable. It also refuses any write from a toolkit older than a declared `min_dpt_version` floor, a malformed declaration, and a subject or container it cannot resolve. Container writes are decided, never reminded: an Epic create or a `save_milestone` without `id` needs a `milestone-decision` receipt of this session that created that title in that project, and the latest decision for a title governs, so a join decided after a create refuses the create. A `labels` write on an Epic the session joined is permitted only as the whole edit — `labels` its sole field, holding every label the decision listed plus the milestone label; any other field goes to the ownership rule. Editing a milestone, writing a project, and retiring, restoring or renaming a label always refuse; the one other container write permitted is a `create_issue_label` of the target's own `repo_tag`. An FR create also needs an `attach-target` receipt that bound the create's own milestone: its Jira parent, the `milestone-<token>` label of a numeric milestone, or its Linear `milestone` argument (a Linear create naming no milestone is the recorded residual). An attach target proven by a create decision counts only when this session's create call returned that container.
- **Accepted command grammar.** These receipt-writing commands announce: the subcommands `create_idempotency_probe.ts decide`, `container_ownership.ts consent` and `ticket_ownership.ts confirm`, and the two subcommand-less front doors `resolve_milestone_identity.ts` (the milestone decision) and `attach_project_milestone.ts` (the attach target), each with its fixed argv. The other subcommands (`normalize`, `query`, `list`, `ticket_ownership.ts decide`) print text a tracker page or the model supplied, so they announce nothing. The accepted shape, as every refusal shows it:
  ```
  bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/create_idempotency_probe.ts" decide <projectRoot> <page.json>... --title <title> [container] --attempt <fast|retry-N>
  bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/ticket_ownership.ts" confirm <projectRoot> <KEY> <ticket.json> [--adopt]
  bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/container_ownership.ts" consent <projectRoot> <KEY> <page.json>...
  bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/resolve_milestone_identity.ts" <projectRoot> <jira|linear> <project> <listing.json> --title <title> | --join-key <key> [--sibling <path>]
  bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/attach_project_milestone.ts" <projectRoot> <jira|linear> <project> <planFile> <listingFile>
  ```
  The plugin root may be spelled `${CLAUDE_PLUGIN_ROOT}/…` bare, `"${CLAUDE_PLUGIN_ROOT}/…"`, the hooks.json style `"${CLAUDE_PLUGIN_ROOT}"/adapters/_shared/src/…`, `$CLAUDE_PLUGIN_ROOT`, or as the absolute path of this plugin's copy; a relative path, a same-named module elsewhere, a `cd … &&` prefix, `;`, a pipe, a redirection such as `2>&1`, a comment, or a `$`, backtick or backslash inside double quotes makes the call a non-plain invocation, and its receipt is ignored — the refusal then names the latest such command. Single quotes carry any other title; a title that needs a backtick, `$` or `\` is written to a file and passed with `--title-file <path>` in place of `--title <title>`. No deciding module prints page or argument text at the start of a `dpt-receipt:` line.
- **A create that may have made its ticket.** After a create of an earlier turn whose result is an error that does not prove the call never ran (a timeout, a server error, an interrupt — a hook or permission denial, a user rejection, an input-validation error, and a definite tracker rejection, a 4xx other than 408 with no timeout or 5xx wording, do prove it), or that has no result, the gate treats that create as one that may have made the ticket: no create receipt, fresh or not, authorises another create of the same ticket (title, project, container), because a tracker search can lag its index and an honest `--attempt fast` re-run can miss it. Only `decide --attempt retry-<N>` proceeds: it finds and reuses the ticket. When retry-3 still misses, the refusal says to ask the operator (AskUserQuestion) to search the tracker by hand, then either run `ticket_ownership.ts confirm` on the ticket they find or have them create it by hand. The command grammar reads command text only: a `bunfig.toml` preload or a `bun` shim on `PATH` is outside it, a recorded residual in STE-607.
- **Container names compare case-insensitively.** `gf` is `GF` and `ste` is `STE`: a case variant of a declared container is gated like the declared spelling.
- **A crash refuses.** An exception inside the gate exits 2 with a refusal naming it, because any other exit lets the write through.
- **Silent where nothing is declared:** with no declared shared target the hook exits 0 with no stdout and no stderr — byte-identical to a session with no hook at all. Unparseable stdin also exits 0.
- **NFR-10 refusal shape on miss** (exit 2; the reason names the tool, the subject or container, the target root and the command that would have authorised the write):
  ```
  Refusing: <tool> <what was missing, and where>
  Remedy: <the deciding command to run, or the fix to make>
  Context: mode=hook, ticket=unbound, skill=none, hook=pre-tracker-write-gate
  ```
- **Override pattern:** Disable the plugin or copy-and-override — snapshot-copy the seeded script into `~/.claude/hooks/pre-tracker-write-gate.sh`, edit, and register the local absolute path in the operator's `~/.claude/settings.json`. Removing the shared-container declaration from the repository's CLAUDE.md also silences it for that repository.

### session-token-ledger

- **Name:** `session-token-ledger`
- **Event:** `SessionEnd`, with `Stop` wired as an equivalent trigger (robustness pick — survives unclean exits; both re-derive the whole session and replace its rows, so repeated firing is idempotent).
- **Matcher:** `*`
- **Behavior:** Capture hook, not a gate (STE-344, M92). **Opt-in, default OFF (STE-379):** before anything else the hook reads the project's CLAUDE.md `## Token Stats` block and exits 0 with no write unless it says `enabled: true`, so a project that has not opted in accrues no ledger at all. When enabled it parses `transcript_path` + `session_id` from the stdin hook JSON via `parseHookPayload`, aggregates the session's per-`(attributionSkill, model)` token usage via `parseTranscriptTokenUsage`, and writes the rows to the git-ignored `<project>/.dpt/ledger/token-ledger.jsonl` (`writeSessionRows` — replaces any rows already recorded for the `session_id`, atomic temp-file + rename write). The path is composed via `ledgerPath()` from `adapters/_shared/src/dpt_paths.ts`, never hand-assembled. What makes it ignored is the `ledger/` rule in the toolkit-owned `.dpt/.gitignore` that `/setup` writes — sibling `.dpt/locks/` is deliberately **tracked**, so the ledger is ignored by an explicit rule rather than by a blanket exclusion of `.dpt/` (see `docs/layout-reference.md` § The `.dpt/` tree). **Fail-open by contract:** any parse/IO error exits `0` with no write and no stderr — there is no refusal shape, and the hook never blocks session teardown or dirties the tracked tree.
- **Override pattern:** Disable the plugin, or copy-and-override — snapshot-copy `templates/hooks/process/session-token-ledger.sh` into `~/.claude/hooks/`, edit (e.g., change the ledger location or restrict to `SessionEnd` only), and register the local absolute path in the operator's `~/.claude/settings.json`.

---

## Recognised command shapes

Both commit gates read a Bash command through one shared recogniser (`adapters/_shared/src/shell_invocations.ts`) and ask `resolveCommitTarget` whether it writes a commit, and where. Every shape that can carry a commit has one verdict from a closed vocabulary (STE-601):

- **recognised** — the commit is found (`isCommit: true`) and its target resolves as the unwrapped command's would.
- **unplaced** — a literal commit is present (`isCommit: true`) behind a wrapper the recogniser cannot model, so `repoRoot` is `null`, `unresolved` names the wrapper, and `candidateRoots` lists every literal directory it can see. The gate-check hook demands evidence; the /tdd hook shows a `Reminder:`.
- **out of scope** — not a commit for these gates (`isCommit: false`), and no notice.
- **advisory** — not a commit (`isCommit: false`), but the gate-check hook exits 1 with a `Reminder:` naming the subcommand, and the command proceeds.

Each example below is runnable, and `tests/ste-601-shapes-table.test.ts` runs every one of them through `resolveCommitTarget` from checkout `/s/a`, with `/s/b` as the second checkout, and asserts the stated verdict. A row whose verdict drifts from the resolver's answer fails that test.

The directory-change rows (STE-613) follow the running directory through `cd` options, `builtin cd`, `command cd`, the `pushd`/`popd` stack, `~` and in-command bindings, and resolve the fixed computed directories. A directory the model cannot name is unplaced. The table's grader runs every row with `HOME=/s` and `CDPATH` unset, so one rule is graded in the resolver's own suite instead of here: when `CDPATH` is set and non-empty, a relative `cd` or `pushd` operand that does not begin with `.` or `..` is unplaced, naming `CDPATH`. The model reads a command as a straight sequence, as it always has for `cd`: a binding, `cd` or `pushd` inside an `if` branch or a pipeline element counts as if it ran.

| Shape | Example | Verdict |
|---|---|---|
| leading `NAME=value` assignments, one or more, quoted values included | `X=1 Y="a b" git -C /s/b commit -m x` | recognised |
| `env` with `-i`, `-`, `-0`, `-v`, `-u NAME`, `--unset=NAME` and `NAME=value` operands | `env -i -u HOME --unset=PAGER X=1 git -C /s/b commit -m x` | recognised |
| `env -C DIR` / `--chdir=DIR` / `--chdir DIR` | `env -C /s/b git commit -m x` | recognised — DIR is a directory change for the wrapped command only |
| `env -S` / `--split-string` | `env -S 'git commit -m x'` | unplaced — the split string is not modelled |
| `command` and `command -p` | `command -p git -C /s/b commit -m x` | recognised |
| `command -v` / `command -V`, `type git`, `which git`, `hash git` | `command -v git` | out of scope — lookup, not execution |
| `exec`, `nohup`, `time` (`-p`), `nice` (`-n N`, `-N`), `timeout` (its options, then a duration) | `nice -n 5 timeout -k 1 30 time -p nohup git -C /s/b commit -m x` | recognised |
| `!` pipeline negation | `! git -C /s/b commit -m x` | recognised |
| an argv0 whose final path segment is exactly `git` (`/usr/bin/git`, `/opt/homebrew/bin/git`, `./git`) | `/usr/bin/git -C /s/b commit -m x` | recognised — `gitk`, `git2` and `legit` are not git |
| a single `&` and `\|&` | `sleep 0 & git -C /s/b commit -m x` | recognised — both are segment separators, like `;` |
| `{ …; }` brace group | `{ git -C /s/b commit -m x; }` | recognised — a brace group does not scope the directory; a parenthesised subshell still does |
| `if`/`then`/`elif`/`else`/`fi`, `while`/`until`/`do`/`done`, the header of a `for NAME in …;` loop | `cd /s/b && if true; then git commit -m x; fi` | recognised — reserved words are stripped and conditions are commands that run |
| a function definition body (`f() { git commit; }`, `function f { … }`) | `f() { git -C /s/b commit -m x; }` | recognised — as if it runs (conservative) |
| a commit inside a `case` arm | `case x in x) git commit -m x;; esac` | unplaced — "a case arm" |
| `sh`/`bash`/`zsh`/`dash`/`ksh` with options (combined `-lc`/`-ec`/`-xc` included) and `-c STRING` | `bash -lc 'git -C /s/b commit -m x'` | recognised — STRING is read recursively, starting in the running directory |
| `eval STRING` | `eval 'git -C /s/b commit -m x'` | recognised — read recursively like `-c` |
| `-c "$CMD"` or `eval "$CMD"`, where the whole string is one unexpanded word | `bash -c "$CMD"` | out of scope — no literal commit exists in the command |
| `$(…)` and backtick command substitutions | `x=$(git -C /s/b commit -m y)` | recognised — the commands inside run in the running directory; heredocs inside them are still skipped |
| `xargs`, `find -exec`/`-execdir`/`-ok`, `parallel`, `watch`, `sudo` wrapping a git commit | `sudo git -C /s/b commit -m x` | unplaced — the wrapper is named, and `/s/b` is a candidate root |
| `bash FILE`, `./FILE`, `source FILE`, `. FILE` | `bash f.sh` | out of scope — file contents are not read |
| `ssh HOST 'git commit'` | `ssh h 'git commit -m x'` | out of scope — not a commit in any local checkout |
| a quoted or backslash-escaped argv0 (`\git`, `"git"`, `'git'`) | `\git -C /s/b commit -m x` | recognised — quote removal runs before the argv0 match |
| a `GIT_DIR=` or `GIT_WORK_TREE=` binding, as a prefix, an `env` operand or an in-command `export` | `GIT_DIR=/s/b/.git git commit -m x` | unplaced — recognised as a commit with its target unplaced ("GIT_DIR"); the literal value's checkout is in `candidateRoots` |
| a backtick substitution holding an operator | `` echo `cd /s/b && git commit -m x` `` | recognised — the operator splits inside the substitution, which scopes its own directory |
| `git merge` (not `--ff-only`, `--squash`, `--no-commit`, `--abort`, `--quit`); `git cherry-pick` and `git revert` (not `-n`, `--no-commit`, `--abort`, `--quit`, `--skip`); `git am` (not `--abort`, `--quit`, `--show-current-patch`); `git commit-tree` | `git -C /s/b merge --no-ff x` | recognised — each can write a commit object |
| `git pull`, `git rebase` (not `--abort`, `--quit`), `git stash` (bare, `push`, `save`), writing `git notes` forms | `git pull` | advisory — the gate-check hook exits 1 with a `Reminder:` naming the subcommand; `git stash list`, `git stash show` and `git notes list` get no notice |
| a git alias (`git ci`) | `git -c alias.ci=commit -C /s/b ci -m x` | recognised — resolved before classifying: `-c alias.NAME=VALUE` first, else `git config --get alias.NAME` in the target checkout; an alias that cannot be read is unplaced ("git alias") |
| `cd` options `-L`, `-P`, `-e`, `-@`, alone or combined (`-Pe`) | `cd -P /s/b && git commit -m x` | recognised — the options are skipped and the commit targets `/s/b` |
| `cd --` ending option parsing | `cd -- /s/b && git commit -m x` | recognised — the operand after `--` is the directory |
| `cd -` and a bare `cd` | `cd - && git commit -m x` | unplaced — the previous directory is not modelled |
| `builtin cd` | `builtin cd /s/b && git commit -m x` | recognised — the same as `cd` |
| `command cd` | `command cd /s/b && git commit -m x` | recognised — the same as `cd` |
| `pushd DIR` | `pushd /s/b && git commit -m x` | recognised — moves to DIR and pushes the old directory on the modelled stack |
| `popd` after a modelled `pushd` | `pushd /s/b && popd && git commit -m x` | recognised — returns to the previous directory, so the commit targets `/s/a` |
| `pushd -n DIR` | `pushd -n /s/b && git commit -m x` | recognised — pushes without moving, so the commit targets `/s/a` |
| `pushd` inside a parenthesised subshell | `(pushd /s/b) && git commit -m x` | recognised — the subshell restores the stack and the directory, so the commit targets `/s/a` |
| `popd` with an empty modelled stack, `pushd +N`, `pushd -N`, `popd +N` | `popd && git commit -m x` | unplaced — the reason names the word |
| `~` and `~/…` | `cd ~/b && git commit -m x` | recognised — `~` expands to the hook process's home directory, which runs as the session shell's user; with `HOME=/s` the commit targets `/s/b` |
| `~user` | `cd ~other/x && git commit -m x` | unplaced — another user's home is not expanded |
| an in-command `NAME=value` or `export NAME=value` segment, then `$NAME` in a later segment | `B=/s/b; git -C "$B" commit -m x` | recognised — the binding holds for later segments in the same scope, and a value may reference names already bound |
| a prefix assignment `NAME=value cmd` | `B=/s/b git -C "$B" commit -m x` | unplaced — a prefix assignment binds nothing the same command's arguments can read |
| a binding removed by `unset NAME`, built from another substitution, or used after the subshell that made it has closed | `R=$(mktemp -d); git -C "$R" commit -m x` | unplaced — the name stays unexpanded, and the reason names `$R` |
| `$(pwd)`, `` `pwd` ``, `$(pwd -P)`, `$(pwd -L)`, `$PWD`, `${PWD}` | `cd /s/b && git -C $(pwd) commit -m x` | recognised — the running directory, so the commit targets `/s/b` |
| `$(git rev-parse --show-toplevel)` and `$(git -C DIR rev-parse --show-toplevel)` | `cd /s/b/sub && git -C $(git rev-parse --show-toplevel) commit -m x` | recognised — the checkout root of the running directory (or of DIR), so the commit targets `/s/b` |
| any other substitution, such as `$(dirname $(pwd))` or `$(mktemp -d)` | `git -C $(dirname $(pwd)) commit -m x` | unplaced — only the fixed forms above resolve |

---

## Related references

- `hooks/hooks.json` — the plugin-bundled registration surface this catalog documents.
- `docs/honored-contracts.md` — prose-layer catalog of the same contracts these hooks enforce.
- `docs/skill-anatomy.md` — `${CLAUDE_PLUGIN_ROOT}` substitution pattern used by the bundled hook entries.
- `templates/CLAUDE.md.template` — its `## Workflows` gate block announces the blocking gates to every bootstrapped project and points here for the full manual.
- `docs/workflow-overview.md` — the end-to-end workflow map; it carries the same gates in its lifecycle prose and in its guardrail table.

Those last two are inbound: they are the surfaces a reader arrives at this manual **from**, not further reading it sends them to. An edit that drops the gates from either one leaves this file describing a route nobody can take, so a change to `templates/CLAUDE.md.template` or `docs/workflow-overview.md` that removes their gate coverage has to remove the matching bullet here too.

- STE-289 (M74) — current FR; bundled `hooks/hooks.json` model, supersedes M71/M72/M73 install-side mechanism.
- STE-285 (M71) — original install-side FR; design intent superseded by STE-289 after empirical falsification on 2026-05-14.
- STE-286 (M72), STE-288 (M73) — follow-up install-side fixes likewise superseded by STE-289.
- STE-283 (M71) — prose-layer FR; the TDD Orchestrator Contract callout in `/implement` Phase 2 step 8.
- STE-262, STE-270, STE-276 — cancellation chain that originally rejected bundled `hooks/hooks.json`; rejection grounds re-analyzed and reversed under STE-289.
- STE-133 — `${CLAUDE_PLUGIN_ROOT}` commit-msg hook precedent (same substitution pattern; install-side path remains valid for that hook because the hook lives in `.git/hooks/`, not in the harness-managed hook surface).
