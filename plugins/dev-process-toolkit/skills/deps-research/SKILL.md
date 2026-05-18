---
name: deps-research
description: Internal research fork — invoked exclusively by /brainstorm and /spec-write via context:fork pairing with the deps-researcher subagent. Returns topic-aware sibling-package retrieval as a ≤25-line block. Do not invoke directly.
context: fork
agent: deps-researcher
user-invocable: false
argument-hint: '<topic>'
---

# Deps Research (Forked)

You are running as the `deps-researcher` subagent inside a forked context spawned by `/dev-process-toolkit:brainstorm` (Step 1.5b) or `/dev-process-toolkit:spec-write` § 0b (step 2.5b). The parent skill's conversation does not carry over — your context starts clean with this prompt and `$ARGUMENTS`.

This skill is the architectural twin of `/dev-process-toolkit:spec-research` (STE-230), retargeted from the FR archive to the dependency manifest at `specs/deps.yaml`.

## Inputs

The orchestrator passes you (in its prompt body):

- `$ARGUMENTS` — the topic description. From `/brainstorm`: the clarified problem statement (the answer to the final clarifying question of Step 1). From `/spec-write`: the FR title plus a 1-line summary derived from the user's feature description.

## Procedure

1. **Read** the topic from `$ARGUMENTS`.
2. **Read** `specs/deps.yaml` at the consumer repo root. If the file is **absent** or contains **zero entries**, take the vacuous-exit path (see below) — emit an empty `deps-research-result` fenced block (banner + open fence + close fence, no content lines) and stop.
3. **Resolve** each manifest entry's sibling path (entries' `path` always starts with `../`).
4. **Glob** each resolved sibling path's `docs/` tree (Diátaxis shape: `docs/tutorials/`, `docs/how-to/`, `docs/reference/`, `docs/explanation/`). Silently skip entries whose checkout is missing on disk and list them under the optional `## Missing deps` subsection.
5. **Scan** each present package's matched `docs/` files for topic overlap (keyword + title match; LLM-quality ranking). For `## API Surface Highlights`: lift verbatim signature snippets from `docs/reference/` (never paraphrase). For `## Reusable Patterns`: lift decisions / patterns from `docs/explanation/`.
6. **Select** the top ≤ 3 candidates per section by relevance.
7. **Emit** the canonical block per the subagent's system prompt — banner + fenced `deps-research-result` block with three sections (`## Relevant Packages`, `## API Surface Highlights`, `## Reusable Patterns`) plus an optional fourth `## Missing deps`, ≤ 25 lines total, with the literal banner line `> [dependency reference — sibling-package docs surfaced for context; verify against source before treating as authority]` immediately above the opening fence.

## Output contract

Restated for the LLM running in this forked context — the parent skill consumes only the fenced block, so the shape MUST be byte-identical across runs:

- Literal banner line above the fence.
- Opening fence `\`\`\`deps-research-result`.
- Exactly three `## ` sections in this order: `## Relevant Packages`, `## API Surface Highlights`, `## Reusable Patterns`.
- Optional fourth `## Missing deps` section — emit only when ≥ 1 manifest entry's sibling checkout is absent on disk.
- Closing fence on its own line.
- Entire block ≤ 25 lines.
- Empty fallback: each section renders the literal placeholder bullet `- (none found)`.
- Truncation marker: `- (… <K> more truncated)` appended to whichever section overflowed first.

## Vacuous-exit path

When `specs/deps.yaml` is **absent** OR contains **zero entries**, emit an empty `deps-research-result` fenced block (banner line + open fence + close fence, zero content lines between the fences) and stop. The orchestrator and parent skill both detect this empty-block shape and skip the seed without surfacing a shape violation. This is the deterministic vacuous-exit contract — do not synthesize bullets, do not omit the banner, do not omit the fences.

## Branch-gate exemption

This skill writes nothing under VCS — it only reads `specs/deps.yaml` and sibling-checkout `docs/` trees and emits the summary block to its parent's context. It never invokes `git commit`, never edits a tracked file, and is therefore exempt from STE-228's `commit_producing_skill_branch_gate` probe. The exemption is enforced by the `NON_COMMIT_PRODUCING_SKILLS` allowlist in `adapters/_shared/src/commit_producing_skill_branch_gate.ts` — `deps-research` is on that list alongside `spec-research` and `report-issue` (AC-STE-301.12).

## Rules

- **Read-only.** The subagent's `tools: Read, Grep, Glob` is the canonical 3-tool list. No `Edit`, `Write`, `Bash`, `Agent`, or MCP tools — the agent file rejects any attempt to author them. No nested forks (no `Agent` tool).
- **No stored state.** Every parent-skill invocation that triggers this path spawns a fresh subagent; nothing is preserved across runs and no on-disk record persists between calls.
- **One block only.** Multiple fences ⇒ format violation; the parent skill drops the seed and surfaces a `deps_research_shape_violation` capability row.
- **Do not invoke directly.** This skill carries `user-invocable: false`. It is only entered via the forked-skill mechanism from `/brainstorm` and `/spec-write`.
- **Read-side only.** Do not modify `specs/deps.yaml`, `specs/frs/**`, `specs/plan/**`, `specs/requirements.md`, `specs/technical-spec.md`, or `specs/testing-spec.md`. This agent only provides additional context, never changes files.
