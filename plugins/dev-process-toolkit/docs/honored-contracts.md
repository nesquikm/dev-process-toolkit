# Honored Contracts

This catalog records **contracts between skills** that have been hardened with named-violation enforcement after at least one observed regression. Each entry follows a uniform four-label shape so the catalog stays byte-checkable and additions stay cheap:

- **Mandate.** What the caller skill is required to do — phrased as a non-negotiable, not a guideline.
- **Violation name.** A short, search-grep-able label for the antipattern. The name is load-bearing: it lets reviewers, gate checks, and future spec writers cite the failure mode in one token.
- **Auditable evidence.** The byte-checkable shape that proves the contract was honored on a given run. Usually a `tool_use` pattern, a file presence/content check, or a log marker.
- **Precedent FRs.** STE refs (orchestrator + falsification chain) that established the contract or hardened it after a documented breach.

The catalog is intentionally short. An entry earns its place only after a contract has been broken in practice and the fix required prose-level reinforcement on top of any mechanical guard.

## /implement → /tdd

**Mandate.** Inside `/implement` Phase 2, the build loop MUST delegate every FR's RED → GREEN → REFACTOR cycle to the `/dev-process-toolkit:tdd` multi-agent orchestrator. The parent `/implement` context does not write tests, write implementation code, or run the refactor pass inline — those passes belong to the three forked TDD subagents (test-writer / implementer / refactorer) under the orchestrator's bounded-retry budget.

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
