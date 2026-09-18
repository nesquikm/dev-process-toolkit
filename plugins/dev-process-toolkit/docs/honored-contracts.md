# Honored Contracts

This catalog records **contracts between skills** that have been hardened with named-violation enforcement after at least one observed regression. Each entry follows a uniform four-label shape so the catalog stays byte-checkable and additions stay cheap:

- **Mandate.** What the caller skill is required to do — phrased as a non-negotiable, not a guideline.
- **Violation name.** A short, search-grep-able label for the antipattern. The name is load-bearing: it lets reviewers, gate checks, and future spec writers cite the failure mode in one token.
- **Auditable evidence.** The byte-checkable shape that proves the contract was honored on a given run. Usually a `tool_use` pattern, a file presence/content check, or a log marker.
- **Precedent FRs.** STE refs (orchestrator + falsification chain) that established the contract or hardened it after a documented breach.

The catalog is intentionally short. An entry earns its place only after a contract has been broken in practice and the fix required prose-level reinforcement on top of any mechanical guard. The blocking `PreToolUse` gates below earned theirs the same way — each was broken by an agent that did the work correctly and was refused anyway, because nothing in the repository's own signposts announced the gate in advance. Their mechanics — event, matcher, the verbatim refusal text, and the override path — belong to the manual at `docs/hooks-reference.md`. What follows is the prose layer on top of it: the mandate, the name for breaking it, and the evidence that settles the question. If an entry here starts restating the manual, delete the restatement rather than maintain a second copy of it.

## /implement → /tdd

**Mandate.** Inside `/implement` Phase 2, the build loop MUST delegate every FR's RED → GREEN → REFACTOR → AUDIT cycle to the `/dev-process-toolkit:tdd` multi-agent orchestrator. The parent `/implement` context does not write tests, write implementation code, run the refactor pass, or run the spec-review audit inline — those passes belong to the four forked TDD subagents (test-writer / implementer / refactorer / spec-reviewer) under the orchestrator's bounded-retry budget.

**Violation name.** Inline TDD Antipattern — `/implement` performing TDD in its own context instead of forking `/dev-process-toolkit:tdd` once per FR.

**Auditable evidence.** N `Skill(/dev-process-toolkit:tdd <FR-id>)` `tool_use` entries in the `/implement` run transcript, where N = FR count in the milestone scope. Zero such entries with non-zero FRs implemented is the canonical signature of the violation.

**Precedent FRs.** STE-225 (multi-agent orchestrator that made the fork the mechanic), STE-220 (anchor of the prose-falsification chain), STE-226, STE-237, STE-251, STE-262, STE-270 (six prose hardenings that compounded after the contract was breached despite the mechanic existing).

## /spec-write → spec-research

**Mandate.** `/spec-write` MUST fork the internal `spec-research` subagent to gather related FRs before drafting a new spec. The parent context does not perform related-FR retrieval inline; the forked subagent returns a bounded (≤ 25-line) related-FR block that the spec writer cites.

**Violation name.** Inline Spec Research — `/spec-write` searching the FR archive itself instead of forking `spec-research` for the related-FR retrieval pass.

**Auditable evidence.** At least one `Skill(/dev-process-toolkit:spec-research ...)` `tool_use` entry in the `/spec-write` run transcript before the new FR file is drafted, plus a related-FRs block of ≤ 25 lines in the resulting spec.

**Precedent FRs.** STE-230 (introduced the `spec-research` fork as the related-FR retrieval mechanic for `/spec-write` and `/brainstorm`).

## /brainstorm → AskUserQuestion-first

**Mandate.** `/brainstorm` MUST drive its Socratic clarification loop with the `AskUserQuestion` tool one question at a time, before proposing any solution sketches. Free-form narrative questions in the parent prose channel do not count — the tool call is the contract.

**Violation name.** Narrative Clarification — `/brainstorm` asking clarifying questions in prose instead of via `AskUserQuestion` tool calls.

**Auditable evidence.** A run of `AskUserQuestion` `tool_use` entries in the `/brainstorm` transcript prior to the first solution-sketch turn. Zero such entries with a delivered solution sketch is the canonical signature of the violation.

**Precedent FRs.** STE-237 (mandated `AskUserQuestion`-first as a hard mechanic on `/brainstorm` after a documented inline-prose-questions regression).

## pre-commit-gate-check → /gate-check

**Mandate.** Before a `git commit` Bash call, the session MUST have invoked `/dev-process-toolkit:gate-check` as a skill. Running the project's gate command by hand, reading a green test run, or reporting the gate's result in prose does not discharge the mandate — the `pre-commit-gate-check` `PreToolUse` hook grades the transcript, not the working tree, and refuses the commit with exit 2, so the `git commit` tool call never runs at all.

**Violation name.** Unannounced Gate — running the gate checks by hand and expecting the `pre-commit-gate-check` hook to see it, instead of invoking the skill that leaves the mark the hook reads.

**Auditable evidence.** One JSONL line in the current session transcript carrying both `"name":"Skill"` and `"skill":"dev-process-toolkit:gate-check"` — the same substring pair on the same line, per the STE-285 atomic-line invariant implemented in `templates/hooks/_lib/session.ts` (`findSkillToolUse`, reading through `readTranscriptLines`). The predicate cannot see a Bash `tool_use`, a passing test run, or any command output; it fails open only when it cannot see the session at all (no transcript path, an unreadable transcript, or unparseable stdin).

**Precedent FRs.** STE-285 (the original install-side design and the atomic-line invariant), STE-289 (the M74 reversal to plugin-bundled `hooks.json`), STE-290 (wired to the real harness stdin `transcript_path` contract), STE-291 (exit 1 → exit 2, the change that made the layer actually block); STE-283 established this catalog as the prose layer these gates need.

## pre-pr-spec-review → /spec-review

**Mandate.** Before a `gh pr create` Bash call, the session MUST have invoked `/dev-process-toolkit:spec-review` as a skill. A review performed inline, a per-FR TDD audit, or a prose summary of what the specs say does not discharge the mandate — the `pre-pr-spec-review` `PreToolUse` hook grades the transcript and refuses the PR with exit 2 before the command runs.

**Violation name.** Unannounced Review — auditing the specs by hand and expecting the `pre-pr-spec-review` hook to see it, instead of invoking the skill the hook actually looks for.

**Auditable evidence.** One JSONL line in the current session transcript carrying both `"name":"Skill"` and `"skill":"dev-process-toolkit:spec-review"` — the same substring pair on the same line, per the STE-285 atomic-line invariant implemented in `templates/hooks/_lib/session.ts` (`findSkillToolUse`, reading through `readTranscriptLines`). Nothing else counts: not a Bash `tool_use`, not a green audit, not command output. The hook fails open only when the session itself is invisible to it (no transcript path, an unreadable transcript, or unparseable stdin).

**Precedent FRs.** STE-285 (the original install-side design and the atomic-line invariant), STE-289 (plugin-bundled `hooks.json`), STE-290 (real harness stdin `transcript_path` contract), STE-291 (exit 1 → exit 2, which made the refusal binding).

## pre-commit-tdd-orchestrator → /tdd

**Mandate.** A `git commit` whose staged set carries an FR file under `specs/frs/` or any file the detected stack calls a test MUST carry TDD evidence in the same session, and since STE-598 that evidence has two accepted forms: a `/dev-process-toolkit:tdd` skill invocation, **or** a recorded red-before proof naming every staged path that raised the requirement. Writing the test and the implementation by hand in the parent context and recording nothing discharges neither — the `pre-commit-tdd-orchestrator` `PreToolUse` hook grades the transcript and refuses the commit with exit 2. The gate is deliberately narrow: a spec-only staged set is carved out, a source file alone does not fire it, and when no stack marker resolves it emits a Reminder and exits 0 rather than guessing. The second door subtracts nothing from the required set — it is an additional way to satisfy it, for audit-driven work that has no FR and so cannot run the per-FR orchestrator honestly.

**Violation name.** Unannounced TDD — doing the RED → GREEN cycle by hand on staged tests and expecting the `pre-commit-tdd-orchestrator` hook to see it, instead of forking the orchestrator that leaves the mark or recording the red-before proof that leaves the other one.

**Auditable evidence.** Either of two lines in the current session transcript. (1) One JSONL line carrying both `"name":"Skill"` and `"skill":"dev-process-toolkit:tdd"` — the same substring pair on the same line, per the STE-285 atomic-line invariant. (2) One line carrying the marker `dpt-red-before-proof:` followed, on that same line, by every staged path that raised the requirement — the atomic-line invariant re-applied, plus a position rule so a path merely mentioned earlier in the message is not swept into the claim. Coverage of (2) is a union across marker lines; a proof naming an unrelated file covers nothing, and an empty required set is never covered. Both are implemented in `templates/hooks/_lib/session.ts` (`findSkillToolUse`, `findRedBeforeProof`, joined by `requireTddEvidence`) and both read the one transcript reader, `readTranscriptLines`. The predicate is still blind to Bash `tool_use` entries and to test output, so an unrecorded hand-run suite is invisible to it; it fails open only on an invisible session (no transcript path, an unreadable transcript, or unparseable stdin).

**Precedent FRs.** STE-285 (the original install-side design and the atomic-line invariant), STE-289 (the M74 reversal to plugin-bundled `hooks.json`), STE-290 (harness stdin `transcript_path` contract), STE-291 (exit 1 → exit 2), STE-598 (the second satisfying door). The companion prose contract for the same mechanic is the `/implement → /tdd` entry above.

## pre-tracker-write-gate → the deciding commands

**Mandate.** In a repository whose CLAUDE.md declares its tracker container as shared, every tracker write into that container MUST follow the deciding command that authorises it. The `pre-tracker-write-gate` `PreToolUse` hook blocks, with exit 2, shared-container tracker writes that skipped the deciding commands: a create with no matching, unspent `create` receipt for this session, and a write on a ticket the repository does not own. It also blocks writes from a toolkit older than the declared `min_dpt_version` floor. Where nothing is declared it is silent — exit 0, no output, byte-identical to no hook at all.

**Violation name.** Undecided Write — calling the tracker's write tool directly in a shared container and expecting the `pre-tracker-write-gate` hook to take the call on trust, instead of running the deciding command whose receipt the hook reads.

**Auditable evidence.** A receipt file under the target repository's receipts directory for this session, announced by a `dpt-receipt: <absolute path> sha256:<digest>` line inside the non-error result of a Bash `tool_use` whose command is one plain `bun [run] <module> <subcommand>` invocation of a receipt-writing subcommand of this plugin's deciding modules (`create_idempotency_probe.ts decide`, `container_ownership.ts consent`, `ticket_ownership.ts confirm` — `RECEIPT_WRITING_SUBCOMMANDS`), with the file still hashing to that digest. A receipt written any other way — the Write tool, an echoed announcement (even one chained after the real command, carrying the module's name in a comment, or echoed through another subcommand such as `normalize`), quoted assistant text, a file rewritten after its announcement — authorises nothing. The accepted shapes and the `--title-file` route are in `docs/hooks-reference.md` § pre-tracker-write-gate. Ownership of a ticket is also shown by a tracked FR file binding it or a create of it earlier in the same session.
