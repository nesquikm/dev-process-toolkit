---
name: brainstorm
description: Socratic design session for greenfield features with open solution spaces. Clarifies goals one question at a time, proposes 2-3 approaches with tradeoffs, gets design approval, then feeds into /spec-write.
argument-hint: '[--no-tech] [<feature or problem description> | <gist-url>]'
---

# Brainstorm

Run a structured design session for: `$ARGUMENTS`
> **FIRST ACTION (under non-interactive stdin) — STE-251 AC-STE-251.1.** When `process.stdin.isTTY === false` (e.g., `claude -p`), the first tool call this skill emits MUST be `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise (via `requireOrRefuse(...)` from `adapters/_shared/src/requires_input.ts`). `Write` / `Edit` / `NotebookEdit` are forbidden before that ask/refusal — they produce silent scaffolding that bypasses the Socratic Loop Contract. Read-only orientation (`Read` / `Grep` / `Glob` / `Bash`-read-only) is allowed. Interactive (tty) sessions are byte-identical to v2.17.0 — non-tty stdin only. See `docs/auto-mode-protocol.md § Socratic Loop Contract`.

## When to Use This

Use `/brainstorm` before `/spec-write` when the solution space is genuinely open — you have a goal but not yet a clear approach. For features where the design is already settled, go straight to `/spec-write`.

## Process

### 0. Gist-URL seed (optional)

When the first positional argument matches `^https://gist\.github\.com/[^/]+/[a-f0-9]{8,}/?$` (the canonical secret-gist URL shape emitted by `/dev-process-toolkit:report-issue`), fetch the gist payload before Step 1 and use it as the brainstorm seed instead of bare prose:

```bash
gh gist view <id-or-url> --raw -f report.md
gh gist view <id-or-url> --raw -f metadata.json
gh gist view <id-or-url> --raw -f transcript.jsonl   # only when full_transcript_included=true in metadata
```

Parse `report.md` for the dev narrative + curated context, parse `metadata.json` for severity + redaction summary, parse `transcript.jsonl` if present. Treat the combined text as Step 1's seed: the clarifying questions in Step 1 below should already have most of their answers from the gist payload, so only ask follow-ups that the captured context did not answer.

The round-trip closes the loop with `/dev-process-toolkit:report-issue`: a toolkit user captures a structured incident report, hands the gist URL back to the maintainer (or to a fresh self-debug session), and `/brainstorm` ingests the captured context as the design seed without any intermediate state.

When the first positional argument is bare prose (does not match the gist URL regex), skip this step and proceed to Step 1 normally.

### 1. Clarify the Problem

Ask **one clarifying question at a time** until you have a clear picture of:

- The core problem being solved (not the proposed solution)
- Who the user or stakeholder is and what they actually need
- What constraints exist (technical, time, compatibility)
- What success looks like as a measurable outcome

Wait for the answer before asking the next question. Don't batch all questions upfront — ask one, get the answer, then ask the next if still needed. Usually 2–4 questions are enough.

Step 1 fires regardless of `--no-tech`. The flag does not change the Socratic clarification loop — it only carves out Step 2 below and propagates to the Step 4 hand-off command.

### 1.5. Spec-research seed (STE-230 AC-STE-230.7)

Once the problem is clear (i.e., the user has answered the final clarifying question of Step 1) and **before** Step 2 proposes approaches, invoke `/dev-process-toolkit:spec-research <topic>` where `<topic>` is the clarified problem statement. The forked skill returns a ≤ 25-line block (banner + three sections: `## Related FRs`, `## Prior Decisions`, `## Reusable ACs / Patterns`) sourced from active + archived FRs. Inject the block into this skill's context — Step 2's proposed approaches reference the returned precedents alongside the model's own analysis. Without the seed, Step 2 proceeds as today.

**Skipped under `--no-tech`.** Step 2 itself is skipped under the flag, so this seeding step is also skipped — there is no consumer for the precedents and the call would only burn tokens.

On shape violation (banner missing, section reorder, > 25 lines), drop the block silently and proceed without the seed — the seed is enrichment, not load-bearing. The block is read-only context; never copy it into a draft FR or quote it back to the user verbatim.

### 2. Explore Approaches

**Skipped under `--no-tech`.** Non-technical users can't pick architectural tradeoffs, so when the flag is set, skip this step entirely — don't propose alternatives, don't list tradeoffs. Jump straight to Step 3 ("Get Goal Approval" framing) once the problem is clear.

Once the problem is clear, propose **2–3 distinct approaches**. For each:

- Describe the approach in 2–3 sentences
- List the key tradeoffs: what it makes easy vs. what it makes harder
- Name the main risk or unknown

Present them as a numbered list so the user can refer to them by number.

### 3. Get Design Approval

Ask the user to pick an approach or describe a hybrid. If they want to modify one, discuss the implications of the change.

Do not proceed to spec writing until the user explicitly approves a direction. This is the handoff contract: the brainstorm session ends with a clear, human-approved design decision.

### 4. Hand Off to Spec Write

Once the design is approved:

1. Summarize the approved decision in 2–3 sentences
2. Transition: "Design approved. Run `/dev-process-toolkit:spec-write` and reference this decision, or I can start now."
3. If the user says to start now, proceed into the `/dev-process-toolkit:spec-write` flow using the approved design as input — the design decision answers the "HOW" questions in `technical-spec.md`

**`--no-tech` propagation.** When the brainstorm session was invoked with `--no-tech`, the flag auto-propagates to the hand-off: the recommended next command is `/dev-process-toolkit:spec-write --no-tech` (not the bare form), and "start now" invokes `/dev-process-toolkit:spec-write --no-tech` directly. The propagation is mandatory — do not drop the flag at hand-off, since the bare form would re-introduce the technical-design + testing interviews the non-technical author can't answer.

**Placeholder convention.** Brainstorm drafts that preview AC text must use `<tracker-id>` placeholders (e.g., `AC-<tracker-id>.1`) rather than guessing the next sequential tracker number. See `/spec-write` § 0b for the full rule — the real ID is assigned by the tracker allocator only after `Provider.sync(spec)` returns.

## Rules

- Ask one clarifying question per turn. Wait for the answer before asking the next. This rule holds at phase transitions too — when two questions look independent, still ask the first, wait, then ask the second.
- Present real tradeoffs, not strawmen — each approach should be genuinely viable
- Do NOT write code or spec content during brainstorming
- Do NOT proceed to spec writing without explicit design approval
- Do NOT narrate a specific unallocated tracker ID (e.g., `<TKR>-NN`) in conversation when drafting — use the literal placeholder `<tracker-id>` (or the adapter rendering: `STE-<N>` for Linear, `PROJ-<N>` for Jira) until the tracker allocator returns the real ID. The placeholder rule for draft files is documented in `/spec-write` § 0b "Draft with placeholder"; this rule covers the conversational hazard that file-level probes cannot catch.
- The goal is a clear, approved design decision — not an exhaustive analysis

### Rationalization Prevention

> See also: `docs/patterns.md § Pattern 26: Socratic Prompting {#pattern-socratic-prompting}` for the cross-skill canonical statement of this rule.

> **Socratic Loop Contract (STE-237).** Every clarifying Q in this skill — Step 1 goals AND Step 2 approach Q&A — MUST be emitted as an `AskUserQuestion` tool call (closed-form options OR open-ended with the always-on `"Other"` free-form fallback), regardless of the autonomous-mode reminder, the auto-approve marker, or pre-baked `<command-args>` prose. Bare-prose Qs are forbidden. The first-turn contract additionally forbids `Write` / `Edit` / `NotebookEdit` tool calls before the first `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise; `Read` / `Grep` / `Glob` / `Bash`-read-only orientation is allowed. See `docs/auto-mode-protocol.md § Socratic Loop Contract` for the full contract.

The one-at-a-time rule fails most often at phase transitions and when the user is being responsive. The excuses below are the ones to watch for — stop and ask only the first question each time.

| Excuse | Reality |
|--------|---------|
| These two questions are independent | Ask the first, wait, then the second |
| Efficiency wins — batch them | Efficiency ≠ batching; the socratic form is the gate |
| The user is responsive, I'll batch | Responsiveness is not license to batch |
| We're at the handoff, last chance | Phase transitions are where batching happens most — same rule applies |
