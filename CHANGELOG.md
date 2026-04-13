# Changelog

All notable changes to the Dev Process Toolkit plugin are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Update discipline:** this file must be updated on every version bump. See the Release Checklist in `CLAUDE.md` for the required steps.

## [1.14.0] — 2026-04-13 — "Single File"

### Added

- **Canonical one-at-a-time sentence in `brainstorm/SKILL.md` and `spec-write/SKILL.md` Rules (FR-28 / AC-28.1, AC-28.4, AC-28.5)** — Both skills now carry the byte-identical sentence `Ask one clarifying question per turn. Wait for the answer before asking the next. This rule holds at phase transitions too — when two questions look independent, still ask the first, wait, then ask the second.` as a Rules bullet. Treated as a cross-skill schema (NFR-4 precedent): a Tier 1 `diff` check catches drift on future edits.
- **`### Rationalization Prevention` subsection in `brainstorm/SKILL.md` (FR-28 / AC-28.2)** — New 2-column table (`Excuse` | `Reality`) with 4 rows targeting the specific excuses observed in the v1.13.0-session violation: "These two questions are independent" / "Ask the first, wait, then the second"; "Efficiency wins — batch them" / "Efficiency ≠ batching; the socratic form is the gate"; "The user is responsive, I'll batch" / "Responsiveness is not license to batch"; "We're at the handoff, last chance" / "Phase transitions are where batching happens most — same rule applies". Mirrors the pattern shipped by FR-24 in `/gate-check`.

### Changed

- **Per-section question blocks in `spec-write/SKILL.md` (FR-28 / AC-28.3, AC-28.7)** — The 4 blocks under `#### requirements.md`, `#### technical-spec.md`, `#### testing-spec.md`, `#### plan.md` reshaped from bulleted simultaneous-question lists to explicit ordered-waiting prose ("Ask {Q1}. Wait for the answer. Then ask {Q2}."). Same questions, same steps — only framing changed. No heading renames, no removed steps, no new required user-facing questions.

### Motivation

At the tail of the v1.13.0 session, Claude batched two independent scope-lock questions at the `/brainstorm` → `/spec-write` handoff despite both skills' explicit one-question-at-a-time rule. The rule was documented but not followed rigorously at phase transitions, and `/spec-write`'s bulleted per-section question blocks implicitly encouraged the same batching. This release tightens the wording in both skill files (where downstream-project memory cannot reach) and reshapes `/spec-write`'s structure so the socratic form is visible in the skill body itself. The Rationalization Prevention table targets the three rationalizations observed in-session ("these are independent", "efficiency", "responsive user") plus the phase-transition trap explicitly. Both skills remain well under the NFR-1 300-line budget (`brainstorm` 69, `spec-write` 146).

## [1.13.0] — 2026-04-13 — "Second Look"

### Added

- **Two-pass `/implement` Phase 3 Stage B (FR-23 / AC-23.1..23.8)** — Stage B now delegates to `code-reviewer` **twice in sequence** via the `Agent` tool. **Pass 1 — Spec Compliance** (gated on `specs/requirements.md` existing; silently skipped when `specs/` is absent) asks the subagent whether every change in the diff traces to an AC and flags any undocumented behavior. **Pass 2 — Code Quality** runs only if Pass 1 returned `OVERALL: OK` or Pass 1 was skipped, and applies the canonical 5-criterion rubric. The literal fail-fast rule `If Pass 1 returns critical findings, do NOT run Pass 2; surface Pass 1 findings and stop.` is in the skill body verbatim. Skipped Pass 2 is reported as the literal line `Pass 2: Skipped (Pass 1 critical findings)` under a `### Pass 2: Code Quality` subheading — never silently omitted. `implement/SKILL.md` grew from 238 → 274 lines (still 26 under NFR-1).
- **`### Pass-Specific Return Contracts` in `agents/code-reviewer.md` (FR-23 / AC-23.6)** — New subsection documents the two prompt shapes. Pass 1 returns one `AC-X.Y — OK|CONCERN` line per AC plus one catch-all `Undocumented behavior` line; Pass 2 returns one line per rubric criterion. Both end with `OVERALL: OK` or `OVERALL: CONCERNS (N)` — the existing Schema J shape, reused unchanged at the line level.
- **`### Rationalization Prevention` table in `gate-check/SKILL.md` Red Flags (FR-24 / AC-24.1..24.4)** — Two-column table (`Excuse` | `Reality`) borrowed from the `superpowers` plugin with the 6 canonical rows (`Should work now` / `Run the verification`, `I'm confident` / `Confidence ≠ evidence`, `Just this once` / `No exceptions`, `Linter passed` / `Linter ≠ compiler / tests`, `Agent said success` / `Verify independently`, `Partial check is enough` / `Partial proves nothing`) in that order. No verdict strings changed (NFR-4 preserved).
- **`plugins/dev-process-toolkit/docs/parallel-execution.md` (FR-25 / AC-25.1..25.8)** — New 75-line advisory doc (budget ≤200) covering `## Native Subagents` (links `https://code.claude.com/docs/en/sub-agents`), `## Agent-Teams` (links `https://code.claude.com/docs/en/agent-teams`), and `## Worktree-per-Subagent Isolation`. The top-of-file **Advisory only** disclaimer makes the opt-in framing explicit. The worktree section documents merge-back via `/implement`'s existing recovery options and file-partitioning for conflict avoidance.
- **`## Parallelization` subsection in `implement/SKILL.md` (FR-25 / AC-25.6)** — Placed immediately before `## Phase 3` (not buried in Phase 2 prose) with the literal pointer line `For parallelizable work, see docs/parallel-execution.md before dispatching.` Ensures the new doc is consulted on every `/implement` run instead of becoming dead weight.
- **`### Task Sizing` in `templates/spec-templates/plan.md.template` (FR-26 / AC-26.1..26.3)** — Tasks now render as 2-line entries (`- [ ] Action` + indented `verify:` line). New sizing note carries the literal `Each task should be ≈ one commit's worth of work — small enough that the verification step is unambiguous`. Anti-pattern callout lists three bad task shapes (`Implement entire feature`, `Refactor and add tests and update docs`, `Clean up technical debt`) each with a one-line reason.
- **`Task Sizing` reference in `spec-write/SKILL.md` (FR-26 / AC-26.4)** — `plan.md` step now instructs `/spec-write` to generate tasks conforming to the template's 2-line shape and points back at the template for the anti-pattern callout.

### Changed

- **`disable-model-invocation: true` dropped from `/implement` and `/pr` (FR-27 / AC-27.1..27.6)** — The flag was a leaky workaround blocking legitimate composition from agent-teams subagents (a subagent could not invoke `/implement` via the `Skill` tool and had to read `SKILL.md` body manually). Flag is retained on `/setup` only (bootstrap skill — a subagent re-running `/setup` mid-flight would clobber the working tree). `docs/skill-anatomy.md` Best Practices narrowed to recommend the flag only for bootstrap-style skills.
- **`docs/skill-anatomy.md` § Subagent Execution** — Gained a brief "Sequential multi-pass variant" note pointing at the Stage B two-pass template as the canonical example of stacking the `Agent`-tool primitive.
- **Root `CLAUDE.md` agent line** — Updated to describe `code-reviewer` as "invoked twice by /implement Stage B: Pass 1 spec-compliance, Pass 2 code-quality".
- **`README.md`** — `/implement` row describes the two-pass Stage B; `code-reviewer` agent bullet enumerates the pass-specific return contracts; Latest-release pointer updated to v1.13.0.

### Motivation

The single Stage B review from v1.12.0 conflated "did we build the right thing" (spec compliance) with "did we build it well" (code quality), leaving the subagent with no way to escalate a wrong-feature finding over a minor style nit. Splitting Pass 1 and Pass 2 with fail-fast between them makes the cheaper gate (spec compliance) the one that runs first and stops the review early when the change is fundamentally wrong. The rationalization-prevention table in `/gate-check` is the cheap deterrent against "should work now" / "I'm confident" / "linter passed" reasoning — same cost as a single bullet list, roughly one order of magnitude higher salience. `docs/parallel-execution.md` closes the documentation gap for the worktree + subagents + agent-teams patterns the toolkit already relies on (M10 itself was implemented under a team-lead + implementer pair inside a worktree) without pushing implementation-pattern prose into the ~270-line `implement/SKILL.md`. The `plan.md.template` tightening is the lesson from prior milestones where "Task 1 — Implement entire feature" showed up and there was no obvious verification step to gate on.

### Dogfood validation

Task 12 of M10 ran `/implement` on M10 itself end-to-end through the new two-pass Stage B. Pass 1 and Pass 2 both fired on the M10 change set and returned `OVERALL: OK`; a synthetic spec-drift variant (adding an undocumented function) was reasoned through to confirm Pass 2 is reported as `Pass 2: Skipped (Pass 1 critical findings)` on fail-fast, per AC-23.5. All four FRs passed Tier 1 static verification and Tier 2 behavioral scenarios.

## [1.12.0] — 2026-04-11 — "Dead Branches"

### Added

- **`/implement` Phase 3 Stage B now delegates to `code-reviewer` via explicit `Agent`-tool invocation (FR-22 / AC-22.2)** — Stage B is no longer an inline rubric copy. The skill spells out the exact prompt template (changed files from `git diff --name-status <base-ref>`, Phase 1 AC checklist as context, stack hints from CLAUDE.md, explicit instruction to **not** check spec compliance), the expected return shape (`<criterion> — OK` / `<criterion> — CONCERN: file:line — <reason>`, ending with `OVERALL: OK` or `OVERALL: CONCERNS (N)`), and the Stage B pass/fail integration logic including an inline-fallback path if the subagent errors or returns an unparseable shape.
- **`docs/skill-anatomy.md` gains a concrete `Agent`-tool delegation example (AC-22.8)** — The Subagent Execution section now leads with a copy-pasteable example adapted from `/implement` Phase 3 Stage B as the reference implementation. The existing abstract `context: fork` example is retained but explicitly labeled "Alternative — unexercised in this plugin as of v1.12.0" since 0 of 12 skills use that frontmatter.
- **`docs/implement-reference.md` gains a Milestone Archival Procedure section** — Sub-steps a–i (archive target resolution, collapse rule, write-then-delete ordering, incomplete-matrix fallback) moved here from the skill body to free up line budget for the new delegation block while keeping the procedure fully documented.

### Changed

- **`agents/code-reviewer.md` is now the canonical review rubric for the plugin (AC-22.3, AC-22.5)** — Stack-specific review checklist (Flutter / React / MCP / API) moved here from `implement/SKILL.md` Stage B. The old Spec Compliance section is deleted — `/spec-review` remains the sole canonical home for AC→code traceability, and `code-reviewer` now covers quality, security, patterns, and stack-specific only. The agent file documents its exact return shape at the bottom so callers can parse findings deterministically.
- **`gate-check/SKILL.md` Code Review section points at `agents/code-reviewer.md` as its rubric source (AC-22.4)** — Gate-check continues to run the review **inline** (synchronous, no delegation) because a gate verdict must return in one turn. Only the rubric source is unified, not the execution path.
- **`simplify/SKILL.md` wording aligned with `code-reviewer.md` where they overlap (AC-22.6)** — Simplify is not converted to delegation; its scope (reuse / quality / efficiency cleanup) remains distinct. Where criteria overlap (naming, hardcoded values, pattern compliance), simplify now explicitly defers to the code-reviewer rubric to prevent contradictory guidance.
- **`docs/adaptation-guide.md` Step 6 rewritten (AC-22.7)** — The stale `test-writer` and `debugger` bullets are gone; `code-reviewer` is described as the canonical review agent with `/implement` Phase 3 Stage B as the reference delegation point and a link to the `docs/skill-anatomy.md` example.
- **`plugins/dev-process-toolkit/skills/implement/SKILL.md` shrunk from 276 → 238 lines (AC-22.9)** — 38-line reduction buffers NFR-1 (300-line skill cap) for future Phase 3 additions. Achieved by compressing Pre-flight + Partial Failure Recovery, moving the Milestone Archival sub-steps to `implement-reference.md`, and delegating the Stage B rubric body to `code-reviewer.md`.
- **Skill and agent count across `CLAUDE.md` and `README.md`** updated to reflect the single remaining agent.

### Removed

- **`plugins/dev-process-toolkit/agents/test-writer.md` deleted (AC-22.1)** — Orphaned since inception: zero skill invocation sites, weaker duplicate of `/tdd` (RED → GREEN → VERIFY with shallow-assertion anti-patterns). `rg 'test-writer' plugins/` now returns zero matches (CHANGELOG.md is the only remaining reference).
- **Spec Compliance section in `agents/code-reviewer.md`** — Deleted outright (not relocated). `/spec-review` was already the canonical home for AC→code traceability, and `code-reviewer` now covers quality, security, patterns, and stack-specific only.

### Motivation

A plugin audit on 2026-04-11 turned up two dead subagents (`code-reviewer` and `test-writer`) with zero invocation sites since the plugin's inception, plus duplicate review-rubric logic spread across four files (`gate-check`, `implement` Phase 3 Stage B, `simplify`, `code-reviewer.md`). `docs/skill-anatomy.md` documented `context: fork` + custom-agent delegation, but 0 of 12 skills exercised it — an advertised pattern that had never been road-tested. Meanwhile `implement/SKILL.md` sat at 276/300 against NFR-1 and its Stage B inlined ~60 lines of review rubric that would benefit from context-isolated delegation. v1.12.0 picks the boring, known-to-work path (explicit `Agent`-tool invocation from inside the skill body) rather than the unexercised `context: fork` alternative, gives `code-reviewer` a real delegation point so it stops being dead code, deletes `test-writer` so the plugin stops advertising an entry point that doesn't exist, and consolidates the review rubric into a single canonical home.

### Dogfood validation

As part of task 11 in M9, `/implement` was run against M9 itself and the new Stage B delegation was used to spawn `code-reviewer` on the in-flight change set. The subagent returned findings in the exact `OVERALL: CONCERNS (N)` shape the Stage B integration logic parses, caught legitimate issues (stale `test-writer` references in `CLAUDE.md` and `README.md`, an unresolved `<base-ref>` placeholder in the Stage B prompt template, skill-anatomy example missing an exclusion clause), and proved the delegation pattern is round-trip-executable by a fresh Claude instance reading the skill cold. All findings were resolved before the version bump.

## [1.11.0] — 2026-04-10 — "Residue Scan"

### Added

- **Post-archive drift check (FR-21)** — Every archival operation (both `/spec-archive` and `/implement` Phase 4 auto-archival) now runs a two-pass drift check and emits a unified Schema I advisory report. **Pass A** greps live spec files for orphan `M{N}` / `FR-{N}` / `AC-{N}.` token references that survived the archival (severity `high`). **Pass B** has Claude re-read each live spec with a bounded brief — just-archived IDs plus a one-paragraph title+goal excerpt of each new archive file — to flag scope-limiting narrative that assumes the archived milestones were the whole project (severity `medium`).
- **3-choice UX, never blocks archival** — When the drift report is non-empty, the user picks between addressing flags inline (with per-edit approval), saving the report to `specs/drift-{YYYY-MM-DD}.md` for later, or acknowledging and continuing. Empty reports emit the literal `No drift detected` and continue silently. The archival operation itself is never blocked by drift findings, and Pass B never auto-edits narrative.
- **`docs/patterns.md` — `### Pattern: Post-Archive Drift Check`** — Documents the two-pass rationale, the Flutter dogfood canary example verbatim, why Pass B is load-bearing despite its false-positive rate, and the accuracy-first tradeoff decision from the brainstorm session.

### Motivation

The v1.10.0 dogfood run on a Flutter project surfaced the residue problem: archiving M1–M4 (documentation milestones) cleanly moved the blocks and ACs, but left `requirements.md` Overview calling the project a "layered documentation set" and Out-of-Scope saying "Code changes — documentation only" while M5 (a code milestone) was in flight. Pure grep missed it — the phrasing uses no literal `M{N}` tokens — and a manual four-file consistency pass after every archival was the cost. FR-21 makes that scan automatic and advisory, keeping the archival flow fast and the live specs honest.

## [1.10.0] — 2026-04-09 — "Bounded Context"

### Added

- **Auto-archival in `/implement` Phase 4 (FR-16)** — When a milestone ships and the human approves the Phase 4 report, the milestone block and its traceability-matched ACs move automatically out of `plan.md` / `requirements.md` into `specs/archive/M{N}-{slug}.md`, leaving blockquote pointer lines in place. Live spec files stay size-bounded regardless of project age; hot-path token cost stays roughly constant.
- **`/spec-archive` escape-hatch skill (FR-17)** — Manual archival for any user-selected milestone, FR, or AC block, with an explicit diff approval gate. Covers reopens, cross-cutting ACs, and anything auto-archival can't reach. Reopened milestones produce `-r2` / `-r3` revision files; the archive is append-only.
- **Stable anchor IDs on spec headings (FR-18)** — `{#M{N}}` and `{#FR-{N}}` anchors are now baked into the spec templates and enforced by `/spec-write` and the `/setup` doctor check. Archival pointers survive heading renames and reorders.
- **`specs/archive/` directory convention and rolling index (FR-19)** — `/setup` scaffolds `specs/archive/index.md` from day one. `/implement` and `/gate-check` never read the archive; `/spec-review` may consult the index on explicit historical queries.
- **Documentation, README, and project CLAUDE.md coverage (FR-20)** — `docs/patterns.md` gains an Archival Lifecycle pattern; `docs/sdd-methodology.md` documents compactable specs; `docs/adaptation-guide.md` gains a `## Customizing Archival` section; README lists the 12th skill and links here; project CLAUDE.md updates skill count.
- **`CHANGELOG.md`** (this file) — Single place for release notes; replaces the previous "What's new" block in README.

### Changed

- Skill count: **11 → 12** (added `/spec-archive`).
- `plugins/dev-process-toolkit/skills/implement/SKILL.md` Phase 3 Stage C hardening examples extracted to `plugins/dev-process-toolkit/docs/implement-reference.md` to stay under NFR-1's 300-line cap. Final size: 272 lines.
- Release checklist in `CLAUDE.md` now includes a mandatory CHANGELOG.md update step.

### Dogfood validation

As part of the M7 milestone, the shipped v1.8/v1.9 content (M1–M6 in `specs/plan.md` and FR-1..FR-15 in `specs/requirements.md`) was retroactively compacted into `specs/archive/` using the new `/spec-archive` skill. This both validates the feature end-to-end and proves NFR-5:

- `specs/plan.md`: **374 → 139 lines (−63%)**
- `specs/requirements.md`: **440 → 218 lines (−50%)**
- 6 Schema G archive files created (one per shipped milestone) plus `specs/archive/index.md`.

### Opt out

Delete `specs/archive/` — the auto-path skips silently when the directory is absent. See `plugins/dev-process-toolkit/docs/adaptation-guide.md` § *Customizing Archival* for the full opt-out and manual-archival recipe.

## [1.9.0] — 2026-04-07 — M6: ADAPT Marker Cleanup

### Removed

- Manual setup path from docs and README — plugins run from the marketplace directory, users never edit skill files directly.
- `<!-- ADAPT -->` markers in `skills/**` and `agents/**` (converted to plain-text runtime LLM instructions that reference the project CLAUDE.md).

### Changed

- `docs/adaptation-guide.md` reframed as a "customize after `/setup`" reference rather than a manual-setup guide.
- Template `<!-- ADAPT -->` markers preserved (unchanged — templates are copied into user projects where manual edits are expected).

## [1.8.0] — 2026-04-07 — "Depth over Breadth"

### Added

- Drift detection in `/gate-check` and `/implement` Phase 4 (FR-1).
- Security scanning guidance in `/gate-check` Commands section (FR-2).
- CI/CD parity: structured JSON output from `/gate-check` plus starter GitHub Actions configs for TypeScript/Python/Flutter (FR-3).
- Doctor validation in `/setup` — checks tools, gate commands, CLAUDE.md, settings.json (FR-4).
- Spec deviation auto-extraction in `/implement` Phase 4 (FR-5).
- Spec breakout protocol in `/implement` (FR-6) — stop when ≥3 `contradicts`/`infeasible` deviations accumulate in one milestone.
- Spec-to-code traceability map in `/spec-review` (FR-7).
- Shallow test detection in `/tdd` and `/implement` (FR-8).
- Visual-check MCP fallback with manual verification checklist (FR-9).
- Structured risk scan in `/spec-write` with explicit categories + 3-tier severity (FR-10).
- Code-reviewer agent spec compliance section (FR-11).
- Worktree partial failure recovery in `/implement` (FR-12).
- Golden path workflows (Bugfix / Feature / Refactor) in CLAUDE.md template + `/setup` report (FR-13).
- Enhanced spec templates with security/abuse cases, measurable NFRs, negative ACs, ADR tables (FR-14).
- 6 cross-skill schemas (A–F) documented in `technical-spec.md` and enforced in NFR-4.

### Notes

- NFR-1 skill size cap: 300 lines per skill file with an overflow rule extracting long content to `docs/<skill-name>-reference.md`.

## [1.7.0] and earlier

See `git log --oneline` for the full history. Notable earlier releases:

- **v1.7.0** — Phase 3 hardening stage in `/implement`; spec deviation handling; 5 new patterns.
- **v1.6.0** — Added `/debug` and `/brainstorm` skills plus 6 process improvements.
- **v1.5.0** — Spec cross-check consistency step in `/spec-write`.
- **v1.4.x** — Initial marketplace metadata, MCP server config, bug-fix passes from real-world testing.
