# Patterns from Real Projects

Proven patterns extracted from three production projects using SDD with Claude Code.

## Pattern 1: The Deterministic Kill Switch

**Problem**: LLMs can convince themselves that broken code is fine.

**Solution**: Gate checks are deterministic commands (compiler, linter, test runner) that always override LLM judgment.

```
Gate check result: FAIL (3 type errors)
LLM judgment: "The code looks correct to me"
Winner: Gate check. Always.
```

This is the single most important pattern. Without it, the self-review loop becomes an echo chamber.

## Pattern 2: Bounded Self-Review (Max 2 Rounds)

**Problem**: Unbounded review loops can run forever, burning tokens on diminishing returns.

**Solution**: Cap self-review at 2 rounds with convergence detection:

```
Round 1: Found issues → Fix → Re-gate → Round 2
Round 2:
  Same issues as round 1 → DEADLOCK → Escalate to human
  New issues → Fix → Re-gate → Escalate to human
  No issues → Done
```

Why 2 and not 3? Because if round 2 finds the same issue classes as round 1, the agent is going in circles. More rounds won't help.

## Pattern 3: Binary Acceptance Criteria

**Problem**: Vague criteria like "looks good" or "well-tested" allow scope creep and subjective judgment.

**Solution**: Every AC is binary — pass or fail:
- ✓ Pass — implemented and tested
- ✗ Fail — missing or wrong
- ⚠ Partial — implemented but incomplete

No open-ended "is this good enough?" The AC checklist IS the definition of done.

## Pattern 4: Phase-Based Implementation

**Problem**: Agents jump between tasks, lose context, and skip steps.

**Solution**: Implementation follows strict phases:

```
Phase 1: Understand  → Read specs/issue, build AC checklist, present plan
Phase 2: Build (TDD) → RED → GREEN → VERIFY for each task
Phase 3: Self-Review → Bounded loop with deterministic decisions
Phase 4: Report      → Present findings, wait for human approval
```

Each phase has clear entry/exit conditions. The agent can't skip ahead.

## Pattern 5: Spec Precedence Hierarchy

**Problem**: Multiple docs can contradict each other.

**Solution**: Establish a clear precedence:

```
requirements.md > testing-spec.md > technical-spec.md > plan.md
```

If the plan says "use approach X" but requirements say "must support Y" and X doesn't support Y, requirements win.

## Pattern 6: SPEC_DEVIATION Markers

**Problem**: Sometimes you must deviate from specs. But deviations get lost.

**Solution**: When implementation must differ from spec, add a code comment:

```typescript
// SPEC_DEVIATION: Using client-side filtering instead of server-side
// Reason: All data is already in memory from the mock generator
```

The self-review phase catches these and includes them in the report to the human.

## Pattern 7: Human-Gated Commits

**Problem**: Agents commit code that hasn't been reviewed.

**Solution**: The agent never commits without explicit human approval. The report phase presents:
- AC checklist status
- Files changed
- Self-review findings
- Gate check results
- SPEC_DEVIATIONs

Only after the human says "go ahead" does the agent commit.

## Pattern 8: Stack-Specific Review Checklists

**Problem**: Generic code review misses framework-specific issues.

**Solution**: Add domain-specific checks to the self-review phase:

**Flutter**: `const` constructors, `tryEmit()` usage, codegen files not edited, l10n strings
**TypeScript/MCP**: Response format compliance, ESM import extensions, tool registration
**React/Web**: URL state management, component prop types, accessibility
**API Server**: Input validation at boundaries, error response format, auth checks

## Pattern 9: Gate Check Matches CI

**Problem**: Code passes locally but fails in CI.

**Solution**: Gate check commands should be identical to CI pipeline:

```yaml
# CI pipeline
- npm run typecheck
- npm run lint
- npm run test

# /gate-check skill
1. npm run typecheck
2. npm run lint
3. npm run test
```

Same commands, same order, same flags.

## Pattern 10: Visual Verification via MCP

**Problem**: Web UIs can render incorrectly even when tests pass.

**Solution**: Use a rubber duck MCP with Chrome browser tools to visually inspect the page:

1. Start dev server if not running
2. Ask duck to open page in Chrome
3. Duck reports what it sees (layout, content, errors)
4. Test filter switching with different URL params
5. Report as pass/fail checklist

This catches styling issues, layout problems, and rendering bugs that unit tests can't detect.

## Pattern 11: Three-Stage Self-Review

**Problem**: A single combined review pass conflates spec compliance with code quality. The reviewer finds a style issue and considers the review thorough; the spec gap goes unnoticed. "The code is clean, therefore it meets the spec" is a rationalization the combined review enables. Additionally, happy-path code that passes all checks can still be fragile — negative and boundary cases are systematically missed unless explicitly checked.

**Solution**: Split the self-review into three sequential stages:

```
Stage A — Spec Compliance: Does the code match what was specified?
  → Walk the AC checklist, check cross-module coverage
  → Fix any spec gaps before moving on

Stage B — Code Quality: Is the code well-written?
  → Audit for logic bugs, pattern violations, security issues
  → Fix any quality issues

Stage C — Hardening (first round only): Is the code robust?
  → Negative & edge-case tests (null, empty, boundary, failure modes)
  → Error path audit (no swallowed errors, no leaked secrets)
  → Focus on cases most likely to cause real bugs
```

Complete stages in order: A → B → C. If any stage finds issues, fix them and re-run the gate before proceeding to the next. Stage C runs only on round 1 to avoid diminishing returns.

## Pattern 12: Verification-Before-Completion

**Problem**: An agent can "know" tests pass from memory of the last run. Over time, "I verified" without actual verification becomes the norm.

**Solution**: Forbid completion claims without fresh command output. Before reporting a phase done:

1. Run the gate command right now, in this session
2. Read the full output
3. Report the actual numbers: "47 tests, 0 failures, 0 errors"

Forbidden phrases (because they don't cite evidence): "tests pass", "should be fine", "I've verified", "it should work now". Any claim of completeness must be backed by a gate command run in the current session, with the actual output cited.

## Pattern 13: Structured Debugging (4 Phases + 3-Fix Rule)

**Problem**: When a gate check fails, agents thrash — trying multiple fixes without diagnosing the root cause. Each failed fix obscures the next hypothesis.

**Solution**: Structure debugging into 4 phases:

```
Phase 1: Root Cause Investigation  → Read the full error, reproduce it, check recent changes
Phase 2: Pattern Analysis          → Isolated or symptom? Test pollution? Timing dependency?
Phase 3: Hypothesis Testing        → One change at a time, revert if wrong, gate after each
Phase 4: Implementation            → Fix root cause, not symptom, run gate and cite output
```

The 3-Fix Rule: if 3 different fixes all fail, stop and question the architecture. Don't try fix #4 — escalate to the user with findings.

Common sources of flaky tests: `sleep()` calls (replace with condition-based waiting), shared state between tests (find the polluter by bisecting the test suite), and global mocks that persist across test cases.

## Pattern 14: Anti-Rationalization Red Flags

**Problem**: Rules are easy to follow when things are going well. They break under pressure. An agent under pressure invents reasons the rule doesn't apply "just this once."

**Solution**: Embed the specific internal monologue that precedes rule-breaking, so the rationalization is caught at the moment it forms:

```
"I'll run gate-check after the next task"       → run it now
"This is too simple to need a failing test"     → write the test
"I know the tests pass"                         → run them and read the output
"Just this once"                                → there is no just this once
"It should work now"                            → "should" is not a gate result
```

These Red Flags sections appear in /implement, /tdd, and /gate-check at the point of decision, not as a reference doc to consult separately.

## Pattern 15: Spec Deviation Classification

**Problem**: During implementation, the agent discovers the spec is wrong or incomplete. It silently works around the issue, and the spec and code drift apart. The next person (human or agent) to read the spec gets a false picture.

**Solution**: Classify every spec deviation into one of four categories, each with a different action:

```
Underspecified → Add edge case to specs + test, continue
Ambiguous      → Propose conservative default, log as provisional, continue
Contradicts    → STOP, present options to user, wait for decision
Infeasible     → STOP, explain why, propose alternatives, wait for decision
```

Always backfill specs with what you learned. Edge cases discovered during implementation must be logged in specs and covered by tests — code is not documentation.

## Pattern 16: Pre-Implementation Risk Scan

**Problem**: Surprises during implementation (missing APIs, migration issues, concurrency bugs) are expensive to fix. Many could have been identified before coding started.

**Solution**: After specs are complete and before implementation begins, scan for risks in known categories:

```
External dependencies → Could they be unavailable or change?
Data migrations       → Schema changes, backwards compatibility?
Concurrency           → Shared state, race conditions?
Auth & security       → New endpoints, permission changes?
Performance           → Large data sets, unbounded loops?
Unclear ACs           → Subjective, hard to test?
```

Flag each risk in the relevant spec. Don't invent risks — only flag things that would genuinely surprise someone during implementation.

## Pattern 17: Baseline Health Check

**Problem**: An agent starts building a new feature on a codebase that's already broken. All of Phase 2 (TDD) is wasted because the failures are pre-existing, not caused by the new code.

**Solution**: Run the full gate check before writing any code. If it fails, fix it first (or inform the user). Never build on a broken foundation.

## Pattern 18: Test Integrity Lock

**Problem**: When new code breaks existing tests, the agent modifies the tests instead of fixing the code. This silently weakens the test suite — tests that used to catch bugs now don't.

**Solution**: Treat existing tests as immutable unless the spec has changed. If an existing test fails after new code is added, either the new code is wrong or the spec changed. Spec changes require user approval. The agent must never delete or weaken tests to make its implementation pass.

## Pattern 19: Git Checkpoints for Recovery

**Problem**: The self-review loop (Phase 3) discovers the implementation went in the wrong direction. But all changes are uncommitted — there's no way to partially revert to a known-good state.

**Solution**: After each meaningful TDD cycle, create an intermediate git commit. These are recovery points, not PR-ready commits. If a later change breaks things, the agent can revert to the last checkpoint instead of starting over.

## Anti-Patterns to Avoid

### The Infinite Refinement Loop
Two models critiquing each other forever. Fix: bounded loops + convergence detection.

### The Vibes-Based Exit
"It looks good to me" as a quality gate. Fix: deterministic gate checks.

### The Skip-the-Test Shortcut
"Tests will slow me down." Fix: TDD is mandatory, not optional.

### The Mega-Commit
Implementing everything before running any gates. Fix: gate check after each task.

### The Scope Creep Review
Self-review that starts "improving" code beyond the AC scope. Fix: binary AC checklist as the only review criteria.

### The Silent Spec Divergence
Agent finds the spec is wrong, works around it in code, never updates the spec. The spec becomes fiction. Fix: spec deviation classification + mandatory backfill.

### The Test Weakener
New code breaks existing tests, so the agent "fixes" the tests instead of the code. Fix: treat existing tests as immutable unless the spec changed (with user approval).

### The Shallow Test
Test exists and passes, but asserts nothing meaningful (`expect(fn).not.toThrow()`, `assert result is not None`). Fix: assertion quality checks that flag tests without value/behavior assertions.

## Pattern 20: Spec-Code Drift Detection

**Problem**: Specs and code drift apart over time. An AC says "must validate input" but no validation code exists. Nobody notices because the gate check only runs deterministic commands — it doesn't compare spec to code.

**Solution**: After gate commands pass, run a drift check that traces each AC to implementing code:

```
AC-1.1 → src/feature.ts:42    (implemented)
AC-1.2 → (not found)           (drift!)
AC-2.1 → src/service.ts:15    (implemented)
```

Drift findings are **advisory** (GATE PASSED WITH NOTES, never GATE FAILED) because the traceability is heuristic — false positives would erode trust in the deterministic gate. But they surface gaps early.

## Pattern 21: Spec Breakout Protocol

**Problem**: The agent discovers 4+ spec contradictions in a single milestone but keeps pushing forward, writing increasingly contorted workarounds. The resulting code is a mess of provisional decisions.

**Solution**: Set a threshold (default 3) for `contradicts` or `infeasible` spec deviations within a milestone. When the threshold is reached, stop implementation and issue a Spec Breakout report — listing all accumulated deviations and recommending a spec rewrite before continuing. A spec breakout is a valid output, not a failure.

## Pattern 22: Shallow Test Detection

**Problem**: Tests exist and pass, but they don't actually verify behavior. Common anti-patterns: `expect(fn).not.toThrow()` as the sole assertion, `assert result is not None` without checking the value, type-only checks without verifying content. These tests create false confidence.

**Solution**: Add assertion quality checks in TDD (RED phase) and self-review (Stage A). Flag tests that only use these patterns and require assertions on actual return values, state changes, or side effects.

### Stable Anchor IDs

**Problem (FR-18)**: Archival pointers, traceability matrices, and cross-links between spec files all depend on identifiers that survive heading renames and reordering. A pointer like `M3 → specs/plan/archive/M3.md` is only stable if "M3" itself is a stable identifier on the heading — not a positional guess. The first time someone renames a milestone, every positional reference rots silently.

**Solution**: Embed explicit Markdown anchor IDs on every archivable unit at creation time. Templates ship with the anchor syntax pre-filled; `/spec-write` enforces the rule on generated or edited headings; `/setup` doctor validation warns if any heading lacks its anchor. Anchors are CommonMark-friendly, render as empty spans, and survive all mainstream Markdown viewers.

| Unit type | Heading form | Anchor format | Source of truth |
|-----------|-------------|---------------|-----------------|
| Milestone | `## M{N}: {title}` | `{#M{N}}` — appended to the heading line | `templates/spec-templates/plan.md.template` |
| FR | `### FR-{N}: {title}` | `{#FR-{N}}` — appended to the heading line | `templates/spec-templates/requirements.md.template` |
| AC | `- AC-{N}.{M}: {text}` | The AC ID itself acts as the anchor — existing convention, no change | list-item line in requirements.md |

Example of a properly anchored milestone heading:

```markdown
## M3: User authentication {#M3}
```

Grep pattern to find missing anchors: `^##\s+M[0-9]+:` in `plan.md` and `^###\s+FR-[0-9]+:` in `requirements.md` — any match whose line does NOT also contain `{#M` / `{#FR-` is a doctor warning. Archival (FR-16) and `/spec-archive` (FR-17) resolve pointer targets through these anchors.

### Pattern: Archival Lifecycle

**Problem**: Spec files grow unboundedly as a project matures. Every `/implement`, `/gate-check`, and `/spec-review` invocation reads the full spec tree, inflating hot-path context cost on work that's already shipped. Simply splitting files by hand breaks prompt caching (the cache-hot prefix moves on every rewrite), duplicates still-current content, and loses grep-friendliness.

**Solution (v2, FR-45)**: Per-unit archival. Each FR lives in its own file `specs/frs/<ulid>.md`; each milestone has its own plan file `specs/plan/<M#>.md`. When `/implement` finishes a milestone and the human approves the Phase 4 report, every FR belonging to that milestone is `git mv`d into `specs/frs/archive/<ulid>.md` with frontmatter `status: active` → `status: archived` + `archived_at: <ISO now>`; the milestone plan file is `git mv`d into `specs/plan/archive/<M#>.md`; `specs/INDEX.md` is regenerated so archived FRs drop out of the default listing. `Provider.releaseLock(<ulid>)` finalizes each FR's lifecycle (tracker mode transitions the ticket to `done`; tracker-less removes the lock file). For content the auto-path can't reach (reopens, cross-cutting FRs, aborted work), `/spec-archive <ULID | M<N> | tracker-ref>` is the manual escape hatch with a diff approval gate.

**What moves:**
- Every FR file whose frontmatter `milestone == <current>` — `git mv` to `specs/frs/archive/`, frontmatter flip.
- The milestone's plan file — `git mv specs/plan/<M#>.md specs/plan/archive/<M#>.md`.
- `specs/INDEX.md` regenerates — no archived FR appears in the default active index.

**What does NOT move:**
- `specs/technical-spec.md` — architectural decisions use `Superseded-by:` in place (ADR convention: adr.github.io, Nygard). Auto-archiving ADRs would destroy load-bearing context for future implementation.
- `specs/testing-spec.md` and `specs/requirements.md` — cross-cutting narrative stays live.
- In-flight milestones and active FRs outside the completed milestone.

**Rationale:**
- **Prompt caching stability** — archival is a surgical git rename, so the cache-hot prefix of the live files stays stable between milestones and only invalidates at the moment of archival (once per milestone, not once per run).
- **Bounded hot-path context cost** — live `specs/frs/` and `specs/plan/` never accumulate shipped content; hot-path token cost is roughly constant regardless of project age (NFR-5).
- **Merge-conflict-free** — v1's rolling index file was a write hotspot; v2 archival touches disjoint paths per ULID, so parallel-branch merges don't fight over archival state.
- **Auditability** — archived FR files preserve full content + tracker refs + ACs; `git log --follow specs/frs/archive/<ulid>.md` replays the FR's history trivially.
- **Escape hatch** — `/spec-archive` covers everything auto-archival can't reach (reopens, cross-cutting FRs, explicit user-directed compaction), with a diff approval gate so users see exactly what's moving.

### Pattern: Post-Archive Drift Check

**Problem (FR-21)**: Archival (FR-16, FR-17) surgically moves the milestone block and every traceability-matched AC, but it cannot detect **narrative residue** — scope-limiting framing like "documentation-only deliverable" or "layered X set" that assumed the archived milestones were the whole project. The canary was the v1.10.0 Flutter dogfood run: archiving M1–M4 (documentation milestones) left `requirements.md` Overview calling the project a "layered documentation set" and Out-of-Scope saying "Code changes — documentation only", while M5 (a code milestone) was still in flight. Manual consistency passes across four files every time a milestone ships are the problem this pattern solves.

**Solution**: Immediately after any archival operation, run a two-pass drift check whose output is a **unified advisory report** — never an auto-rewrite, never a blocker on the archival itself.

- **Pass A — Token grep (deterministic):** scan live spec files for the exact identifiers just archived (`M{N}`, `FR-{N}`, `AC-{N}.`), excluding Schema H pointer lines (`^> archived:`). Every hit is an orphan token reference. Severity: `high`. Pass A is zero-noise on explicit references — if the traceability matrix was clean at archival time, Pass A will usually emit zero rows.
- **Pass B — Semantic scan (judgment):** read each live spec with a bounded brief containing the just-archived ID list, a one-paragraph title+goal excerpt of each new archive file (not the full body — bounding Pass B context is load-bearing), and the scope-framing instruction. Flag sections whose wording frames the project by the archived scope. Severity: `medium`.

**Why Pass B is load-bearing despite false positives**: the Flutter canary uses no literal `M{N}` tokens anywhere in the "layered documentation set" phrasing — pure Pass A grep would see a clean file. Only judgment can recognize that the Overview is describing a project that no longer exists. Semantic scans have false-positive risk, but the tradeoff is accuracy-first: a medium-severity flag the user dismisses in one keystroke is far cheaper than a narrative inconsistency that survives into the next release. The 3-choice UX (inline / save-for-later / acknowledge) means flags never block archival, so false positives are annoying but never disruptive.

**Pass B prompt construction tips:**
- Title + goal only, never the full archive body. Archive files grow; the Pass B prompt must stay bounded regardless of archive size.
- Always name the canary pattern with the Flutter example verbatim. Without the concrete example, Pass B's instruction is too abstract and miscalibrates on edge cases.
- Keep Pass A results in the same call context so Pass B can cross-reference deterministic hits while judging framing.
- `technical-spec.md` is Pass B advisory-only — flags surface, but `Suggested action` never recommends deletion. Architectural decisions use `Superseded-by:` markers in place per the ADR convention.

**Rationale (accuracy-first tradeoff):** the hybrid Pass A + Pass B approach was chosen over grep-only, semantic-only, or convention-based scope tags because (1) grep alone misses the canary, (2) a pure semantic pass is non-deterministic on explicit tokens grep would never miss, (3) scope tags require retrofitting existing specs and ongoing discipline and would have failed the exact Flutter case that motivated the pattern. Running both is essentially free since the skill already runs inside Claude Code — no separate API call. The false-positive cost on Pass B is paid for by the accuracy of catching scope-limiting narrative the grep pass can never see.

### Pattern: Tracker Mode Probe (Schema L)

**Problem (FR-29, FR-34, Pattern 9)**: M12 adds an opt-in tracker mode (Linear, Jira, custom) for teams whose ACs live in a task tracker. Every affected skill — `/setup`, `/spec-write`, `/implement`, `/gate-check`, `/pr`, `/spec-review`, `/spec-archive` — must behave differently in `mode: none` (default, pre-M12) and `mode: <tracker>`. If any skill guesses mode inconsistently or reads tracker state when the section is absent, the backward-compat invariant (Pattern 9) breaks silently.

**Solution**: Every mode-aware skill begins with the same probe. The probe reads `CLAUDE.md` for the `## Task Tracking` section; section absence ≡ `mode: none` (the canonical pre-M12 path); section presence means parse the `key: value` block per Schema L (technical-spec §7.3). Only after the probe resolves does the skill branch.

**Canonical probe (run at skill entry, before any side effect):**

```
1. Read CLAUDE.md if it exists. If it doesn't, mode = none. Stop probing.
2. grep -c '^## Task Tracking$' CLAUDE.md
   - 0 → mode = none (default, pre-M12 code path runs unchanged)
   - 1 → section exists; continue to step 3
   - >1 → malformed file; fail with NFR-10 canonical error shape
3. Extract `mode: <value>` between `## Task Tracking` and the next `##` / `###` heading (or EOF); lines under `### Sync log` are excluded from key: value parsing.
4. If the extracted mode is `none`, treat as Step-2-zero — the explicit form is accepted but `/setup` never emits it (AC-29.5).
5. For any tracker mode, resolve ticket-ID via Pattern 6 (branch regex → active_ticket: → interactive prompt) before any MCP call.
```

**Backward-compat invariant (Pattern 9):** in `mode: none`, **every** mode-aware skill behavior is byte-identical to pre-M12. The probe step is the single insertion; if `## Task Tracking` is absent, the skill runs its pre-M12 body unchanged. Tracker-mode branches are gated behind the probe — they are never entered in `none` mode.

**Why the section heading is the single probe anchor:** a literal heading check is cheaper than YAML frontmatter parsing, deterministic across markdown renderers, and survives CLAUDE.md edits that preserve structure. Keys inside the section are parsed only after the heading is confirmed present, so malformed key lines never break the `none` path.

**Rules:**
- The probe must be the first action any mode-aware skill takes after reading its arguments — before branch inspection, before MCP calls, before file writes.
- Skills that are not applicable in the current mode exit cleanly with a one-line message (AC-34.2).
- In `mode: none`, no skill makes MCP calls or reads tracker state (AC-34.4). The tracker-mode branches are literally unreachable.
- Duplicate keys in the section fail with NFR-10 canonical shape (Schema L).

### Pattern: `/implement` Runs In-Process

**Problem**: `/implement` handles long milestone runs and noticeably bloats the main session with exploration, gate output, and TDD iteration noise. A natural optimization is to add `context: fork` to `skills/implement/SKILL.md` so `/implement` runs as a subagent with a fresh context and only its final report returns to the main session. This doesn't work, and the reason is load-bearing enough to document.

**Why `context: fork` breaks Stage B**: Phase 3 Stage B (Pattern 11) invokes the `code-reviewer` subagent via the `Agent` tool twice per round — Pass 1 Spec Compliance, Pass 2 Code Quality. Claude Code's sub-agent docs state: *"Subagents cannot spawn other subagents. If your workflow requires nested delegation, use Skills or chain subagents from the main conversation."* Agent teams impose the same restriction (*"teammates cannot spawn their own teams or teammates"*). So the moment `/implement` runs as a subagent — via `context: fork`, an explicit `Agent`-tool wrapper, or an agent-teams teammate — both Stage B spawns fail at invocation.

**Why "chain the reviewer after `/implement` returns" also fails**: The obvious workaround is to strip Stage B out of `/implement`, let it return to the main session, and have the main session spawn the reviewer itself. But Phase 3 is a **bounded review-fix loop** (Pattern 2 + Pattern 11): reviewer findings flow back into the implementer, which fixes them and may trigger another round. The implementer and reviewer must share the same in-session actor — otherwise the fix step happens in a fresh subagent that has none of the original implementation context, and the bounded-loop contract collapses.

**What we do instead**: Keep `/implement` running in-process (the default — no `context: fork`). The cost is main-session context pollution during long runs; the benefit is that Stage B's nested spawns work and the review-fix loop stays coherent. Users who want a clean context for a specific `/implement` run should start a fresh Claude Code session.

**When this could change**: If Claude Code lifts the no-nested-spawn restriction, or if Stage B is restructured so the `agents/code-reviewer.md` rubric runs as inline skill content inside a forked `/implement` (accepting the trade of a less independent reviewer), `context: fork` becomes viable. Until then, treat `/implement` as main-session-only.


## Pattern 23: ULID File-per-FR Layout

**When to use**: Team collaborates on the same spec tree from multiple parallel branches, and merge conflicts on shared spec files (`plan.md`, `requirements.md`, `archive/*.md`) are a recurring friction point.

**The pattern**:

- **One FR, one file, one repo-stable ULID**. Each functional requirement lives at `specs/frs/<ulid>.md` where `<ulid>` is a Crockford base32 ULID (26 chars) minted locally at creation time. The ULID appears in both the filename and the `id:` frontmatter field, byte-for-byte equal (NFR-15 invariants 1+2).
- **Immutable filenames**. Renames are forbidden. The only path change permitted is archival via `git mv specs/frs/<ulid>.md specs/frs/archive/<ulid>.md`, which preserves the stem (FR-41 AC-41.4).
- **Tracker IDs as attributes**. `tracker.linear`, `tracker.jira`, `tracker.github` are frontmatter fields — zero-to-many. Tracker IDs never participate in filenames. Multi-tracker FRs are supported; cross-tracker reconciliation is out of scope (the frontmatter is a fact store, not a reconciler).
- **Provider interface**. `LocalProvider` + `TrackerProvider` implement a single typed contract (`mintId`, `getMetadata`, `sync`, `getUrl`, `claimLock`, `releaseLock`). Skills inject the Provider — they never branch on "tracker configured vs. not."
- **Per-milestone plan files**. `specs/plan/<M#>.md` replaces the monolithic `plan.md`. Once `status: active`, the plan file is frozen — edits require a `plan/<M#>-replan-<N>` branch.
- **Move-based archival**. `git mv` for the path change + frontmatter `status` flip in a single atomic commit. Disjoint paths per ULID ⇒ no merge conflicts. Replaces the rewrite-shared-`archive/*.md` hotspot from v1.
- **Generated `specs/INDEX.md`**. Regenerated on every write under `specs/frs/`; deterministic (same input ⇒ byte-identical output, NFR-13). Commit the generated file so PRs show the current listing.

**Why this matters**:
1. **Disjoint filenames eliminate the content-collision class.** Two branches creating new FRs mint different ULIDs → different filenames → `git merge` just concatenates. No fabricated conflicts.
2. **Local minting is offline-safe.** `mintId()` never touches the network. Teams can author FRs offline; tracker binding happens later via `sync()`.
3. **Tracker lifecycle is decoupled from the canonical ID.** Tracker rename / delete / multi-tracker adoption never forces a filesystem rename cascade through git history, INDEX, cross-refs.

**Invariants enforced by `/gate-check`** (v2 conformance probes):
- Filename regex: `^fr_[0-9A-HJKMNP-TV-Z]{26}\.md$` (AC-41.1)
- `id:` frontmatter equals filename stem byte-for-byte (AC-41.2)
- Required frontmatter fields: `id, title, milestone, status, archived_at, tracker, created_at`
- `specs/.dpt-layout` reports the expected version

**Cross-refs**: FR-40..FR-46 (requirements), `technical-spec.md` §8 (design), `docs/v2-layout-reference.md` (behavioral reference for every spec-touching skill).

## Pattern 24: Tracker-ID Auto-Resolution

**When to use**: You have a tracker mode configured (Linear, Jira, GitHub) and want skills to accept *tracker-native* arguments (`LIN-1234`, `PROJ-42`, `#982`, or a full ticket URL) without forcing users to look up the local ULID.

**The pattern**:

A shared `resolveFRArgument(arg, config)` utility classifies a skill argument as one of four kinds before any side effect:

- **`ulid`** — matches `^fr_[0-9A-HJKMNP-TV-Z]{26}$`; route to the pre-M14 by-ULID code path unchanged.
- **`tracker-id`** — matches one or more adapter-registered `id_pattern` regexes (Schema W). If multiple trackers match, disambiguation by project prefix (e.g., `LIN` for Linear, `PROJ` for Jira) resolves the winner. Still ambiguous → throw `AmbiguousArgumentError` with both candidates.
- **`url`** — host must match an adapter-registered `url_host` (NFR-19 allowlist — unknown hosts fall through; no "best guess"). Path regex extracts the tracker ID.
- **`fallthrough`** — everything else (free-form titles, milestone codes like `M12`, keywords like `all` / `requirements`). Each skill handles these per its pre-M14 contract.

The resolver is **pure**: no network I/O, no filesystem reads (both are downstream of the dispatcher). Resolution is deterministic — identical inputs always return identical outputs, and ambiguity is an error (not an interactive prompt), so non-interactive callers behave the same way as interactive ones (NFR-20).

**The `<tracker>:<id>` disambiguation escape hatch**:

When two trackers share a project prefix (e.g., Linear workspace `FOO` and Jira project `FOO`), users disambiguate with the explicit `<tracker>:<id>` form: `linear:FOO-42` or `jira:FOO-42`. Case-insensitive on the tracker key (`LINEAR:FOO-42` works). The explicit form **always wins** over inference — this is the documented remedy the ambiguity error surfaces.

**Skill-specific continuations** (FR-52..54):

| Kind + lookup result | `/spec-write` | `/implement` | `/spec-archive` |
|----------------------|---------------|--------------|-----------------|
| `ulid` | Edit existing | Claim lock + implement | Archive (git mv + status flip) |
| Tracker-id/url, find-by-tracker-ref **hit** | Edit existing (no import) | Claim lock on resolved ULID | Archive resolved ULID |
| Tracker-id/url, find-by-tracker-ref **miss** | Import via `importFromTracker` (no FR-39 dance — AC-52.5) | Import then claim lock | **Refuse** per AC-54.4 (never auto-imports) |
| `fallthrough` | Pre-M14 free-form handling | Pre-M14 (milestone code, issue number, task text) | Pre-M14 (anchor, heading text, milestone id) |

**Why this matters**:

1. **Eliminates ULID lookup friction.** Users pass the tracker-native ID they already know.
2. **No drift between three skill dispatchers.** One resolver + one `importFromTracker` helper means `/spec-write` and `/implement` cannot implement the same behavior two different ways.
3. **Non-interactive safe.** The resolver never prompts — CI, scripts, and agent harnesses get the same deterministic errors humans see interactively.

**Cross-refs**: FR-51..FR-54 (requirements), `technical-spec.md` §9 (design), `docs/resolver-entry.md` (per-skill decision table), `docs/tracker-adapters.md` § Registering tracker ID patterns for the resolver.

## Pattern 25: Dogfooding Discovery

**When to use**: You've shipped a cross-cutting feature (a new skill, a new layout, a tracker integration) and the test suite is green — but you suspect the doc-code surface hasn't been exercised end-to-end against a *real* project. The green suite only proves the happy paths the tests remembered to cover.

**The pattern**:

1. **Pick the plugin's own repo as the project.** The toolkit is the most realistic test subject available — it has the full spec tree, real git history, real tracker configuration potential, and every skill used against it will hit the same surfaces a user's project would. Running `/setup --migrate none → linear` on the plugin's own repo is not "eating your own dog food" in the marketing sense — it's the cheapest possible way to find gaps that unit tests could not.
2. **Log every judgment-call as a deviation.** When a skill asks you to do something and you find yourself *thinking* ("the doc says X but I'll do Y because X doesn't match what the code actually does") — that is a deviation. Do not quietly fix it and move on. Write the deviation down in NFR-10 canonical shape, with the file:line of the doc-code mismatch and the workaround you applied to keep the session moving.
3. **File each deviation as a dedicated FR.** Not a batched "cleanup" FR; not a bullet on a "backlog" list. One FR per deviation, carrying a `Finding #N of M` note in its frontmatter or requirement prose so the release narrative makes the source of the fix legible. This discipline is what keeps the hardening milestone auditable — someone reading the CHANGELOG a year later can trace every fix back to the exact dogfooded workaround that surfaced it.
4. **Bundle into a single "Hardening" milestone.** Not a string of patch releases across weeks. The milestone's existence telegraphs to the next user: "these gaps were all found in one pass; there is likely a Finding #N+1 we didn't surface." It also lets the release carry one coherent narrative ("M13 + M14 surfaces hardened") instead of 14 tiny version bumps nobody can remember the theme of.
5. **Run the milestone again after it ships.** The dogfood that discovered the gaps should be re-run on the *hardened* plugin — if the session is now frictionless, the hardening worked. If it isn't, you have the next hardening milestone's Finding #1.

**Why this matters**:

1. **Unit tests test what you remembered to test.** Dogfooding tests what the user will actually hit. The plugin's M12 + M13 + M14 tests were all green; M15 surfaced 14 real gaps anyway.
2. **Doc-code drift is invisible from inside the implementation.** The code works, the doc reads fine in isolation, the test fixture is minimal — but the three together don't line up on the paths no test walked. Only a full end-to-end invocation catches it.
3. **The "Finding #N of M" discipline prevents scope creep.** Without it, the temptation is to bundle "while I'm in here" fixes into one FR. The rule: if it isn't traceable to a specific Finding #N, it doesn't belong in the hardening milestone — file it separately or defer it.
4. **The methodology is itself a release artifact.** Future maintainers know that M15 wasn't a random bug-fix pass — it was the result of a specific, repeatable procedure. They can re-run it themselves after their own cross-cutting ships.

**What this costs**:

- The dogfooding session is not free — expect a half-day to a day of hands-on invocation work per cross-cutting milestone.
- The resulting FR pile looks overwhelming on first scan (M15 had 15 FRs). The "Finding #N of M" frontmatter + one bundled milestone keep it auditable.
- Not every deviation is a hardening candidate. Some are genuine feature requests or rare-edge-case nits that belong in later milestones — classify per Pattern 15 (Spec Deviation Classification) before filing.

**Cross-refs**: FR-56..FR-70 (the M15 FR set in this plugin's own spec tree — 15 FRs, 14 findings + 1 release; note that `specs/` is gitignored in the plugin source repo, so the milestone archive at `specs/plan/archive/M15.md` lives in the maintainer workspace, not in the shipped plugin bundle), Pattern 15 (Spec Deviation Classification — the filter that separates hardening findings from feature work), Pattern 21 (Spec Breakout Protocol — the escalation path when dogfood findings exceed 3 `contradicts` / `infeasible` deviations).
