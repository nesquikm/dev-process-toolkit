---
name: spec-research
description: Internal research fork — invoked exclusively by /brainstorm and /spec-write via context:fork pairing with the spec-researcher subagent. Returns related-FR retrieval as a ≤25-line block. Do not invoke directly.
context: fork
agent: spec-researcher
user-invocable: false
argument-hint: '<topic description>'
---

# Spec Research (Forked)

You are running as the `spec-researcher` subagent inside a forked context spawned by `/dev-process-toolkit:brainstorm` (Step 1.5) or `/dev-process-toolkit:spec-write` § 0b (step 2.5). The parent skill's conversation does not carry over — your context starts clean with this prompt and `$ARGUMENTS`.

## Inputs

The orchestrator passes you (in its prompt body):

- `$ARGUMENTS` — the topic description. From `/brainstorm`: the clarified problem statement (the answer to the final clarifying question of Step 1). From `/spec-write`: the FR title plus a 1-line summary derived from the user's feature description.

## Procedure

1. **Read** the topic from `$ARGUMENTS`.
2. **Glob** `specs/frs/*.md` (active) and `specs/frs/archive/*.md` (history) — both directories.
3. **Scan** each file's `## Requirement` and `## Technical Design` sections for topic overlap (keyword + title match; LLM-quality ranking).
4. **Select** the top ≤ 3 candidates by relevance.
5. **Emit** the canonical block per the subagent's system prompt — banner + fenced `spec-research-result` block with three sections (`## Related FRs`, `## Prior Decisions`, `## Reusable ACs / Patterns`), ≤ 25 lines total, with the literal banner line `> [historical reference — decisions below may be stale; use as background, not authority]` immediately above the opening fence.

## Output contract

Restated for the LLM running in this forked context — the parent skill consumes only the fenced block, so the shape MUST be byte-identical across runs:

- Literal banner line above the fence.
- Opening fence `\`\`\`spec-research-result`.
- Exactly three `## ` sections in this order: `## Related FRs`, `## Prior Decisions`, `## Reusable ACs / Patterns`.
- Closing fence on its own line.
- Entire block ≤ 25 lines.
- Empty fallback: each section renders the literal placeholder bullet `- (none found)`.
- Truncation marker: `- (… <K> more truncated)` appended to whichever section overflowed first.

## Branch-gate exemption

This skill writes nothing under VCS — it only reads `specs/frs/**` and emits the summary block to its parent's context. It never invokes `git commit`, never edits a tracked file, and is therefore exempt from STE-228's `commit_producing_skill_branch_gate` probe. The exemption is enforced by the `NON_COMMIT_PRODUCING_SKILLS` allowlist in `adapters/_shared/src/commit_producing_skill_branch_gate.ts` — `spec-research` is on that list alongside `report-issue`.

## Rules

- **Read-only.** The subagent's `tools: Read, Grep, Glob` is the canonical 3-tool list. No `Edit`, `Write`, `Bash`, or MCP tools — the agent file rejects any attempt to author them.
- **No stored state.** Every parent-skill invocation that triggers this path spawns a fresh subagent; nothing is preserved across runs and no on-disk record persists between calls.
- **One block only.** Multiple fences ⇒ format violation; the parent skill drops the seed and surfaces a `spec_research_shape_violation` capability row.
- **Do not invoke directly.** This skill carries `user-invocable: false`. It is only entered via the forked-skill mechanism from `/brainstorm` and `/spec-write`.
- **Read-side only.** Do not modify `specs/frs/**`, `specs/plan/**`, `specs/requirements.md`, `specs/technical-spec.md`, or `specs/testing-spec.md`. The user explicitly rejected wiring this agent into `/spec-review` and `/implement` for the same reason: this agent only provides additional context, never changes files.
