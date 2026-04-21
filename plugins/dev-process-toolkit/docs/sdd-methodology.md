# Spec-Driven Development (SDD)

## What SDD Is

Spec-Driven Development is a methodology where **specifications are the source of truth** for all implementation decisions. It combines the test-first approach of TDD with a higher-level contract: human-written specs define what to build, and every piece of code must trace back to a spec requirement.

## How SDD Differs from TDD Alone

| Aspect | TDD | SDD |
|--------|-----|-----|
| Source of truth | Tests | Specs (requirements, technical spec, plan) |
| What guides implementation | Test expectations | Acceptance criteria from specs |
| Test purpose | Drive design | Verify spec compliance |
| Scope | Unit/integration | Full feature lifecycle |
| Quality gate | Tests pass | Tests pass + spec review + gate checks |
| Deviation handling | Refactor freely | Must document SPEC_DEVIATION |

SDD doesn't replace TDD — it wraps it. Tests are still written first, but they're derived from spec requirements, not invented ad hoc.

## The SDD Lifecycle

```
[Brainstorm] → Specs → Milestones → TDD (per task) → Gate Check [→ Debug] → Self-Review → Human Review → Commit
```

`[Brainstorm]` is optional — run `/brainstorm` before writing specs when the solution space is genuinely open. `[→ Debug]` is the path when a gate check fails and the cause isn't immediately clear.

### 1. Specs Define the Contract

Specs live in `specs/` and follow a hierarchy:

```
specs/
├── requirements.md     # WHAT to build (FRs, ACs, NFRs)
├── technical-spec.md   # HOW to build it (architecture, patterns)
├── testing-spec.md     # HOW to test it (conventions, coverage)
├── plan.md             # WHEN to build it (milestones, task order)
└── archive/            # Archived milestones (auto-managed, historical context)
    ├── index.md        # Rolling index
    └── M{N}-{slug}.md  # One file per archived milestone
```

**Spec precedence:** requirements.md > testing-spec.md > technical-spec.md > plan.md

**Specs are compactable (FR-16..20).** Live spec files never grow unboundedly. When `/implement` completes a milestone and the human approves the Phase 4 report, the milestone block and its traceability-matched ACs move automatically into `specs/archive/M{N}-{slug}.md`, leaving Schema H pointer lines in their place. This is part of normal SDD, not an advanced feature — the hot-path token cost of every skill invocation stays roughly constant regardless of project age. `technical-spec.md` is never auto-archived (ADRs use `Superseded-by:` in place). See the Archival Lifecycle pattern in `docs/patterns.md` for details, and `/spec-archive` for manual archival of content the auto-path can't reach.

### 2. Milestones Break Work into Gates

Each milestone in `plan.md` defines:
- Tasks to complete (in dependency order)
- Acceptance criteria (binary pass/fail)
- Test requirements
- Gate check commands

A milestone is not done until its gate check passes AND a human reviews it.

### 3. TDD Drives Each Task

Within a milestone, each task follows RED → GREEN → VERIFY:
- **RED**: Write failing test derived from spec AC
- **GREEN**: Implement minimum code to pass
- **VERIFY**: Run full gate check (typecheck + lint + test)

### 4. Gate Checks Are Deterministic Kill Switches

Gate checks run the project's quality commands (typecheck, lint, test, build). They are the **hard stop** — if a gate fails, work stops until it's fixed.

> "Never let an LLM be the only thing standing between you and shipping broken code."

The gate check is deterministic code (compiler, linter, test runner). It always overrides LLM judgment about quality.

If a gate check fails and the cause isn't immediately clear from reading the error output, use `/debug` — it structures the investigation into 4 phases (Root Cause → Pattern Analysis → Hypothesis Testing → Implementation) and enforces the 3-Fix Rule to prevent thrashing.

When specs exist, gate-check also runs a **drift check** — tracing each AC to implementing code and flagging gaps. Drift findings are advisory (GATE PASSED WITH NOTES, never GATE FAILED) because the traceability is heuristic.

### 5. Self-Review Is Bounded

After implementation, a self-review loop runs **at most 2 rounds**. Each round has three sequential stages:

- **Stage A — Spec Compliance**: Walk the AC checklist, check cross-module coverage. Fix any gaps before moving to Stage B.
- **Stage B — Code Quality**: Audit for logic bugs, pattern violations, and security issues.
- **Stage C — Hardening** (first round only): Negative & edge-case tests, error path audit. Focus on boundary values, null/empty inputs, and failure modes.

Complete stages in order: A → B → C. If any stage finds issues, fix them and re-run the gate before proceeding to the next. This separation prevents "the code is clean, therefore it meets the spec" conflation.

Round convergence:
- Round 1: Fix issues, re-run gates
- Round 2: If still finding issues, check for convergence
  - Same issues as round 1 → **deadlock detected**, escalate to human
  - New issues → fix, re-run gates, escalate to human

This prevents infinite loops while still catching genuine bugs.

### 6. Human Review Is Required

The agent never commits without explicit human approval. The report includes:
- AC checklist with pass/fail status
- Files created/modified
- Self-review findings
- Gate check results
- Any SPEC_DEVIATIONs

## Key Principles

### Acceptance Criteria Are Binary
Every AC is pass or fail. No "mostly done" or "good enough." This makes the self-review loop deterministic — it has a clear exit condition.

### Specs Win Over Code
If the implementation contradicts a spec, the spec is right. If you discover a spec is wrong, incomplete, or infeasible during implementation, classify the deviation (underspecified, ambiguous, contradicts, infeasible) and follow the appropriate action — from silently backfilling minor edge cases to stopping and waiting for user decision on fundamental contradictions. Always backfill specs with what you learn. If you must deviate in code, add `SPEC_DEVIATION: [reason]` in the code and flag it for review.

### Deterministic Over Probabilistic
Gate checks (compiler, linter, tests) are deterministic. LLM judgment is probabilistic. When they disagree, the deterministic check wins.

### Escalate, Don't Loop
When the self-review loop doesn't converge, escalate to a human rather than trying more rounds. This is the key insight from the "orchestration termination" pattern — budget your review rounds and know when to stop.

## Why SDD Works Well with AI Agents

1. **Specs constrain the solution space** — The agent doesn't have to guess what to build
2. **ACs provide testable contracts** — The agent can verify its own work against binary criteria
3. **Gate checks prevent drift** — Even if the LLM "thinks" the code is fine, deterministic checks catch real issues
4. **Bounded loops prevent runaway costs** — Max 2 rounds prevents the infinite refinement problem
5. **Human review catches what automation misses** — The agent knows it can't be the final judge

## Parallel-safe layout (v2, M13)

v1 stored all FRs in a single `specs/requirements.md` and a single `specs/plan.md`. Two branches editing spec content fought over those shared files — `git merge` surfaced fabricated conflicts whenever the edits landed in the same sections (new FRs, archival rewrites, matrix rows). v2 restructures the tree so the three collision classes are eliminated by construction.

**The three eliminated collision classes:**

1. **ID collisions.** Two branches couldn't mint new FR numbers independently — whoever merged first claimed FR-N and the other branch had to renumber. v2 mints ULIDs locally per branch; uniqueness is statistical, filenames are disjoint. Merge is concat.
2. **Content collisions.** Two branches editing `requirements.md` in the same FR block produced a textual conflict even when the changes were semantically independent. v2 puts each FR in its own file — edits don't share paths.
3. **Archival-hotspot collisions.** `/implement` Phase 4 rewrote `specs/archive/*.md` + `plan.md` pointer lines — the busiest write paths. v2 archival is `git mv` on a single FR file + frontmatter flip. Disjoint paths, no shared-file edit.

**Migration story.** `/setup --migrate` is the entry point. Clean-tree precondition + backup tag (`dpt-v1-snapshot-<timestamp>`) + dry-run preview (`--migrate-dry-run`) + idempotent-on-v2 check + two-commit sequence (`feat(specs): migrate to v2 layout` + `chore(specs): record v2 layout marker`). Rollback is `git reset --hard <backup-tag>`. Migration tooling lives under `adapters/_shared/src/migrate/`.

**One-ticket-one-branch discipline.** Before `/implement` writes any code, `Provider.claimLock(id, branch)` runs. Tracker mode is strict — ticket status + assignee is the authoritative gate. Tracker-less mode is best-effort: `.dpt-locks/<ulid>` files + remote fetch + refuse-on-conflict. Merge-time path conflicts on `.dpt-locks/` catch races in tracker-less mode. `DPT_SKIP_FETCH=1` is the documented escape hatch for large-repo contexts.

**Plan-file kickoff discipline.** Plan files (`specs/plan/<M#>.md`) are single-writer artifacts. Once `status: active`, edits require a sanctioned `plan/<M#>-replan-<N>` branch. `/gate-check` warns on post-freeze commits without auto-reverting — the human decides whether a post-freeze edit is legitimate (correction) or drift (scope creep).

See `docs/v2-layout-reference.md` for the behavioral contract every spec-touching skill follows and `docs/patterns.md` § Pattern 23 for the canonical pattern summary.

## References

- "Your Agents Run Forever — Here's How I Make Mine Stop" — Bounded loops and termination strategies
- "I Test My Agents Like I Test Distributed Systems" — Contract testing for agent handoffs
- [Claude Code Skills documentation](https://code.claude.com/docs/en/skills)
