---
title: /ship-milestone pre-flight #1 remedy rewrite
milestone: M23
status: archived
archived_at: 2026-04-24T12:55:00Z
tracker:
  linear: STE-83
created_at: 2026-04-24T12:31:00Z
---

## Requirement

`/ship-milestone`'s pre-flight refusal #1 (AC-STE-73.8) fires when any FR in the milestone plan has `status: active`. Today's canned remedy says:

```
Remedy: finish each FR via /implement (which archives on success), or move the unfinished FR to a later milestone's plan, then re-run /ship-milestone.
```

This is **wrong** for the most common real-world workflow: single-FR `/implement <FR-id>` runs (which the toolkit prescribes as the canonical way to ship one FR at a time) legitimately leave the FR at `status: active` on completion — milestone archival is a separate, milestone-scope step that only runs on `/implement M<N>` (full-milestone runs) or `/spec-archive M<N>` (the escape hatch). Users who ship every FR via the per-FR flow hit the refusal with N tracker-Done FRs and receive misleading instructions.

STE-83 rewrites the remedy text to name `/spec-archive M<N>` as the correct pre-step, explain the single-FR vs milestone-archival split, and cross-reference the escape hatch in `/implement` SKILL.md. No behavior change — prose-only skill edit.

## Acceptance Criteria

- AC-STE-83.1: `skills/ship-milestone/SKILL.md` pre-flight refusal #1 remedy text names `/spec-archive M<N>` as the canonical pre-step for the "tracker-Done-but-file-active" case. Exact substring `/spec-archive M<N>` appears in the refusal template.
- AC-STE-83.2: The refusal template distinguishes two shapes by surfacing in the remedy:
  1. **"tracker-Done-but-file-active"** — when every unshipped FR's tracker ticket is at `status_mapping.done`: the remedy directs the user to run `/spec-archive M<N>` to bulk-archive the file side.
  2. **"genuinely unshipped"** — when any unshipped FR's tracker ticket is NOT at `status_mapping.done`: the remedy keeps the existing direction (finish via `/implement` or move to another milestone).
  The pre-flight probe checks tracker state via `Provider.getTicketStatus` for each status-active FR to decide which shape to emit. In `mode: none`, `getTicketStatus` returns `local-no-tracker` — treat as "genuinely unshipped" (existing remedy applies).
- AC-STE-83.3: The refusal still exits non-zero in both shapes (no behavior change — only the prose inside the NFR-10 template changes). `Context: milestone=M<N>, unshipped=<count>, skill=ship-milestone` line is preserved in both.
- AC-STE-83.4: Prose-assertion test `tests/ship-milestone-remedy-shape.test.ts` asserts both remedy shapes are defined in SKILL.md and locks the literal `/spec-archive M<N>` substring against regression.
- AC-STE-83.5: `skills/implement/SKILL.md` § Milestone Archival adds a single sentence cross-referencing the new pre-flight remedy: "Single-FR runs intentionally leave `status: active`; bulk archive a completed milestone via `/spec-archive M<N>` before running `/ship-milestone`." No other SKILL.md edits.

## Technical Design

**`skills/ship-milestone/SKILL.md` edits** (roughly 20 lines):

- Pre-flight refusal #1 body gains a branch on the tracker-state probe result.
- Two refusal templates: "tracker-Done-but-file-active" (names `/spec-archive`) and "genuinely unshipped" (existing text, minus the misleading "/implement archives" line).

**`skills/implement/SKILL.md` edit** (one sentence added to § Milestone Archival).

**New test file** `tests/ship-milestone-remedy-shape.test.ts` — same shape as `ship-milestone-shape.test.ts`. Asserts both remedy shapes are present, both carry the NFR-10 `Remedy:` + `Context:` lines, and the tracker-Done shape names `/spec-archive M<N>`.

**No runtime code changes.** Provider interface unchanged; adapter drivers unchanged; `/spec-archive` unchanged.

## Testing

Prose-assertion coverage in the new test file (matches the repo's SKILL.md-testing pattern, e.g., `ship-milestone-shape.test.ts`, `implement-phase5-milestone-close.test.ts`). No fixture changes.

## Notes

The two-shape structure avoids introducing a NEW skill ("`/spec-archive-if-needed`" or similar); the existing `/spec-archive` is the escape hatch and always has been — STE-73's mistake was burying that in the SKILL.md prose instead of surfacing it at refusal time.

**Release target:** v1.24.0. Phase A of M23 plan.
