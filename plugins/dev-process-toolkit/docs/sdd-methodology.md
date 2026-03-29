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
Specs → Milestones → TDD (per task) → Gate Check → Self-Review → Human Review → Commit
```

### 1. Specs Define the Contract

Specs live in `specs/` and follow a hierarchy:

```
specs/
├── requirements.md     # WHAT to build (FRs, ACs, NFRs)
├── technical-spec.md   # HOW to build it (architecture, patterns)
├── testing-spec.md     # HOW to test it (conventions, coverage)
└── plan.md             # WHEN to build it (milestones, task order)
```

**Spec precedence:** requirements.md > testing-spec.md > technical-spec.md > plan.md

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

### 5. Self-Review Is Bounded

After implementation, a self-review loop runs **at most 2 rounds**. Each round has two sequential stages:

- **Stage A — Spec Compliance**: Walk the AC checklist, check cross-module coverage. Fix any gaps before moving to Stage B.
- **Stage B — Code Quality**: Audit for logic bugs, pattern violations, and security issues.

If Stage A finds issues, fix them before Stage B. This separation prevents "the code is clean, therefore it meets the spec" conflation.

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
If the implementation contradicts a spec, the spec is right. If you must deviate, add `SPEC_DEVIATION: [reason]` in the code and flag it for review.

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

## References

- "Your Agents Run Forever — Here's How I Make Mine Stop" — Bounded loops and termination strategies
- "I Test My Agents Like I Test Distributed Systems" — Contract testing for agent handoffs
- [Claude Code Skills documentation](https://code.claude.com/docs/en/skills)
