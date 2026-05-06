# DPT Improvement Dossier — SDD/TDD Landscape Research, 2026-05

READ these docs first:

- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/code-review
- https://code.claude.com/docs/en/tools-reference

**Status:** WIP planning material. Drives a sequence of milestones (M-numbers TBD). Each gap below is meant to be picked up gap-by-gap in fresh sessions.

**Origin:** Web research sweep on May 5, 2026, comparing DPT against the May-2026 SDD/TDD landscape (GitHub Spec Kit, Kiro, Tessl, Superpowers, shinpr/claude-code-workflows, OpenSpec, Spec Kitty, BMad). See [Sources](#sources) at the bottom.

---

## How to use this file

For each fresh session that picks up a gap:

1. Re-read the **Gap entry** below — it restates the problem, signal, current DPT shape, proposed direction, and open questions.
2. Verify the proposed direction against current Claude Code docs (URL list at bottom — these are stable enough to fetch).
3. Check the **Memory pointers** to avoid re-deriving things already settled.
4. If the gap is decided, run `/spec-write` to produce the milestone spec and proceed via `/implement`.
5. Update this file (mark the gap **DONE**, archive the entry to a closed section) as part of the milestone close.

Do **not** treat this file as user-facing plugin content. It lives outside `plugins/dev-process-toolkit/docs/` deliberately. Delete or archive once all 11 gaps are shipped.

---

## Gap status overview

| #   | Gap                                           | Priority | Status    |
| --- | --------------------------------------------- | -------- | --------- |
| 1   | TDD context isolation (multi-agent `/tdd`)    | HIGH     | Designing |
| 2   | Skill-activation reliability via hook         | HIGH     | Open      |
| 3   | Brownfield/trivial-change workflow            | HIGH     | Open      |
| 4   | Mandatory verification criteria in specs      | HIGH     | Open      |
| 5   | Spec-anchored maturity (living specs)         | MEDIUM   | Open      |
| 6   | Markdown bloat audit                          | MEDIUM   | Open      |
| 7   | Three-tier behavioral boundaries in CLAUDE.md | MEDIUM   | Open      |
| 8   | `AskUserQuestion` in `/brainstorm`            | LOW      | Open      |
| 9   | Plan Mode in `/implement` Phase 1             | LOW      | Open      |
| 10  | Worktree parallelization                      | N/A      | Won't fix |
| 11  | GitHub adapter (parallel to Linear)           | LOW      | Backlog   |

---

# Gap 1 — TDD context isolation (multi-agent `/tdd`) — **DONE (M58, STE-225)**

**Status:** DONE — shipped in M58 (STE-225, v2.11.0). Implementation: orchestrator `skills/tdd/SKILL.md` + child skills `tdd-{write-test,implement,refactor}` with `context: fork` + subagents `tdd-{test-writer,implementer,refactorer}`. Deterministic parser at `adapters/_shared/src/tdd_result.ts`, retry state machine at `tdd_retry_state.ts`, halt formatter at `tdd_halt_report.ts`, `/gate-check` probe `tdd_orchestrator_integrity` (probe #39). Headless live smoke at `tests/tdd-live-smoke.test.ts` (env-gated `DPT_TDD_LIVE_SMOKE=1`).

## Problem

Current `/tdd` runs RED → GREEN → VERIFY in a single context. The test-writer subconsciously designs around the implementation it's about to write, so test-first becomes test-last-pretending-to-be-first.

## Research signal

- **alexop.dev** ([Forcing Claude Code to TDD](https://alexop.dev/posts/custom-tdd-workflow-claude-code-vue/)): _"When everything runs in one context window, the LLM cannot truly follow TDD."_ Author splits into three subagents (test-writer / implementer / refactorer) per `.claude/agents/`. Test-writer hands back failing-test output before implementer is invoked. Implementer cannot be influenced by test-writer's reasoning.
- **Superpowers** ([obra/superpowers](https://github.com/obra/superpowers)): same pattern. Code written before tests is _deleted_; RED-GREEN-REFACTOR is mandatory.
- alexop.dev empirical data: skill activation jumped from ~20% to ~84% after adding a `UserPromptSubmit` hook (relevant to Gap 2).

## Current DPT shape

- `plugins/dev-process-toolkit/skills/tdd/SKILL.md` — single-context skill orchestrating the cycle.
- One canonical agent already exists at `plugins/dev-process-toolkit/agents/code-reviewer.md` (used by `/implement` Stage B).
- `/implement` Phase 3 uses `/tdd` inline (per CLAUDE.md description).

## Proposed direction (decided)

Use **Skills with `context: fork` + custom subagents** (the pairing exposed in [Skills docs § Run skills in a subagent](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent)).

```
plugins/dev-process-toolkit/
├── skills/
│   ├── tdd/SKILL.md                 # orchestrator, no fork; calls the three below
│   ├── tdd-write-test/SKILL.md      # context: fork, agent: tdd-test-writer, user-invocable: false
│   ├── tdd-implement/SKILL.md       # context: fork, agent: tdd-implementer,  user-invocable: false
│   └── tdd-refactor/SKILL.md        # context: fork, agent: tdd-refactorer,   user-invocable: false
└── agents/
    ├── code-reviewer.md             # existing
    ├── tdd-test-writer.md           # tools: Read, Grep, Glob, Write, Edit, Bash (no Agent, no Web*)
    ├── tdd-implementer.md           # same toolset
    └── tdd-refactorer.md            # same toolset
```

**Why this shape (not three subagent files invoked directly):** the skill is the unit of _task instruction_, the subagent is the unit of _execution sandbox_. `context: fork` pairs them — task-as-prompt + locked-down tools + isolated context.

### Decisions already made

| Question                                       | Decision                                                                                                                                                                                                                                                                     |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plugin-bundled or templated into user repo?    | **Plugin-bundled.** Templated would freeze on user side and miss plugin updates. Match `code-reviewer.md`'s pattern.                                                                                                                                                         |
| Replace `/tdd` or add `/tdd-strict` alongside? | **Replace.** "No users yet"; carrying two TDD modes contradicts deterministic-gates principle.                                                                                                                                                                               |
| Per-AC or per-FR granularity?                  | **Per-AC, with batched test-writer.** Test-writer writes all failing tests for AC1..N in one call (sees the AC list either way); implementer + refactorer run **per-AC** to enforce minimal-code-to-pass.                                                                    |
| Integration with `/implement`?                 | **`/implement` Phase 3 calls the new `/tdd` orchestrator internally.** No separate opt-in path. Matches existing pacing memory.                                                                                                                                              |
| Hide the three child skills from menu?         | **Yes** — `user-invocable: false` on each.                                                                                                                                                                                                                                   |
| Hide the three subagents from users?           | **Best-effort via narrow descriptions** ("Internal TDD test-writer subagent. Invoked exclusively by `/tdd` orchestrator. Do not invoke directly."). No `user-invocable` equivalent exists for subagents — but they're not in the slash menu anyway, so the surface is small. |
| Tools allowed in each subagent?                | **Read, Grep, Glob, Write, Edit, Bash** — same across all three. Notably absent: Agent (no recursive forks), WebFetch/WebSearch (no scope drift). Behavioral specialization comes from the SKILL.md prompt that gets injected.                                               |

## Open questions before `/spec-write`

1. **Refactor batching.** The orchestrator runs implementer per-AC. Does refactorer also run per-AC, or once at the end? Per-AC keeps cycles tight; once-at-end gives the refactorer a global view of cross-AC duplication. Pick one and document.
2. **Hand-off contract.** What exact return format must each child skill produce? (E.g., test-writer must return: list of test file paths, failing-test command, failing output snippet. Implementer must return: list of modified files, passing-test command, passing output snippet.) Specify so the orchestrator can validate without re-running.
3. **Failure recovery.** If test-writer's tests don't actually fail (false-RED), or implementer can't make them pass within N attempts — what does the orchestrator do? Halt + escalate? Retry with bounded loop (DPT principle: max 2 self-review rounds)?
4. **Gate-check probe.** Add a probe to `/gate-check` that asserts the four skills + three subagents exist and have correct frontmatter? (Relevant only after shipping.)
5. **Smoke test.** How to validate the orchestrator end-to-end without manual TDD-cycle observation? Probably a fixture FR with one trivial AC that exercises the full forked path.

## Sources

- [Forcing Claude Code to TDD — alexop.dev](https://alexop.dev/posts/custom-tdd-workflow-claude-code-vue/)
- [obra/superpowers](https://github.com/obra/superpowers)
- [Test-Driven Development with Claude — Steve Kinney](https://stevekinney.com/courses/ai-development/test-driven-development-with-claude)
- [Claude Code Skills docs § Run skills in a subagent](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent)
- [Claude Code Subagents docs](https://code.claude.com/docs/en/sub-agents)

---

# Gap 2 — Skill-activation reliability via `UserPromptSubmit` hook

## Problem

Skills with auto-activation descriptions fire inconsistently. Empirical claim from alexop.dev: ~20% activation rate without intervention.

## Research signal

- **alexop.dev**: shipping a `UserPromptSubmit` hook that injects a "MANDATORY SKILL ACTIVATION SEQUENCE" prompt raised activation to ~84%. Three-step injection: evaluate (which skill applies?), activate (call Skill tool), implement.
- **Anthropic docs** ([Best practices](https://code.claude.com/docs/en/best-practices)): _"Hooks run deterministic code incapable of hallucination. Without hooks, every safeguard depends on the model understanding instructions."_
- **Anthropic Skills docs**: skill descriptions are loaded into context, but the model can still ignore them. _"If a skill seems to stop influencing behavior after the first response, the content is usually still present and the model is choosing other tools or approaches."_

## Current DPT shape

- DPT ships a `commit-msg` hook (`plugins/dev-process-toolkit/templates/git-hooks/commit-msg.sh`) installed by `/setup`. So we have precedent for hook-shipping.
- No `UserPromptSubmit` hook currently shipped.

## Proposed direction (sketch)

Add an opt-in `UserPromptSubmit` hook to `/setup`'s install step. The hook script lives in `plugins/dev-process-toolkit/templates/hooks/` and is referenced from the generated `.claude/settings.json`. Script content: nudges Claude to evaluate whether a DPT skill matches the user's request, before responding. Make it **opt-in** during `/setup` (one prompt), since aggressive injection can annoy power users who already invoke skills explicitly.

## Open questions

1. Opt-in default during `/setup` — yes or no?
2. Plugin-bundled hook (lives in plugin, settings.json points at `${CLAUDE_PLUGIN_ROOT}/...`) vs. templated copy into user's `.claude/`? Bundled survives plugin updates.
3. Hook content: generic "evaluate any skill" vs. DPT-specific "evaluate /implement, /spec-write, /tdd, /gate-check"? Generic is more useful long-term; specific is safer.
4. Composability with user's existing `UserPromptSubmit` hooks — does Claude Code chain them?

## Sources

- [Forcing Claude Code to TDD — alexop.dev](https://alexop.dev/posts/custom-tdd-workflow-claude-code-vue/) (the empirical 20% → 84% data point)
- [Claude Code Best Practices — Set up hooks](https://code.claude.com/docs/en/best-practices)
- [Claude Code Hooks docs](https://code.claude.com/docs/en/hooks)

---

# Gap 3 — Brownfield / trivial-change workflow

## Problem

`/implement` is well-shaped for FR-sized work, but heavy for "change button blue → green" tweaks. This is the **universal SDD failure mode** named by every critic.

## Research signal

- **Marmelab** ([SDD: The Waterfall Strikes Back](https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html)): a date-display feature generated 8 files / 1,300 lines of markdown. Specs miss the point in mature codebases.
- **Scott Logic** ([Putting Spec Kit Through Its Paces](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html)): measured SDD at **10× slower** than iterative for the same task (33.5 min + 3.5 hr review vs. 8 min + 15 min review).
- **Fowler/Böckeler** ([Understanding SDD](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)): all surveyed tools "use a sledgehammer to crack a nut" for small changes.
- **shinpr/claude-code-workflows**: ships **complexity routing** — small/medium/large auto-classified; PRD/ADR phases skip for 1-2 file tasks.
- **OpenSpec** (from spec-compare): purpose-built for modifications using delta format (ADDED, MODIFIED, REMOVED). Counterpoint: most SDD tools fail on iterative changes.

## Current DPT shape

- `/implement` always runs the full Phase 1-4 pipeline.
- No bypass for trivial work; users either use `/implement` (heavy) or skip DPT entirely (no gates).

## Proposed direction (two options)

**Option A: complexity routing inside `/implement`.** Phase 1 detects scope (file count, lines changed estimate) and skips spec generation phases for trivial cases. Pro: one entrypoint. Con: hard to define the threshold without false positives.

**Option B: separate `/quick-change` skill.** Bypasses `/spec-write` but still runs `/gate-check` + `/pr`. Pro: explicit, no hidden behavior. Con: two on-ramps, naming proliferation.

Likely answer: **B** is more honest given DPT's "deterministic gates" principle. Memory `project_no_users_yet` says rip-and-replace is allowed.

## Open questions

1. Where does the trivial-change cutoff sit? "≤ 1 file modified, ≤ 20 LOC" is a reasonable starting point but needs validation against actual past commits.
2. Does `/quick-change` still produce an FR ID (for tracker integration), or is it FR-less? FR-less is simpler but breaks the "specs are source of truth" principle. Compromise: an `FR-trivial-<ULID>` retroactive lite-FR captured at commit time?
3. What gate-check probes still apply? (Conventional Commits subject — yes. Spec hygiene — N/A.)

## Sources

- [SDD: The Waterfall Strikes Back — Marmelab](https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html)
- [Putting Spec Kit Through Its Paces — Scott Logic](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html)
- [Understanding SDD — Martin Fowler / Böckeler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [shinpr/claude-code-workflows](https://github.com/shinpr/claude-code-workflows)
- [cameronsjo/spec-compare § Modification Problem](https://github.com/cameronsjo/spec-compare)

---

# Gap 4 — Mandatory verification criteria in specs

## Problem

DPT's spec templates list ACs but do not _force_ binary, runnable verification artifacts (sample I/O, expected commands, screenshot diffs). ACs end up phrased as soft expectations.

## Research signal

- **Anthropic** ([Best practices](https://code.claude.com/docs/en/best-practices)): _"Include tests, screenshots, or expected outputs so Claude can check itself. **This is the single highest-leverage thing you can do.**"_
- **Addy Osmani** ([How to write a good spec](https://addyosmani.com/blog/good-spec/)): six core elements include explicit _verification criteria_; recommends embedded code examples and conformance suites.
- **Marmelab** named "agent marked verification complete without writing unit tests" as a concrete failure mode — verification needs to be _enforceable_, not requested.

## Current DPT shape

- Spec templates: `plugins/dev-process-toolkit/templates/specs/{requirements,technical,testing,plan}.md` (verify exact filenames before designing).
- ACs typically structured as bullet lists. No required "verification artifact" subsection.
- `/gate-check` has spec-hygiene probes but probably doesn't check verification-criteria-presence.

## Proposed direction (sketch)

1. Add a **mandatory** "Verification Criteria" subsection per AC in the requirements/testing template:
   - Sample input / expected output (or)
   - Exact command to run + expected exit code (or)
   - Screenshot reference for UI ACs (links to `/visual-check` artifacts).
2. Add `/gate-check` probe that fails if any AC lacks a verification artifact.
3. `/implement` Phase 3 gates on "AC verification ran cleanly" before moving to next AC — composes with Gap 1's per-AC TDD cycle.

## Open questions

1. How to encode "this AC's verification is `bun test foo.test.ts && grep "OK" output.log`" in the spec template? Frontmatter? Code-block convention?
2. UI-AC handling: `/visual-check` produces an artifact path — does the spec reference it before or after first run?
3. Backwards compat with already-shipped FRs (in `specs/frs/archive/`) — exempt them from the new probe? Yes, per `project_no_users_yet` we don't have many anyway.

## Sources

- [Claude Code Best Practices § Give Claude a way to verify its work](https://code.claude.com/docs/en/best-practices)
- [How to write a good spec — Addy Osmani](https://addyosmani.com/blog/good-spec/)

---

# Gap 5 — Spec-anchored maturity (living specs)

## Problem

DPT archives specs after milestone closure (spec-first level). Specs become a one-shot prompt expander instead of a living artifact for maintenance.

## Research signal

- **Fowler/Böckeler**: three-level model — spec-first / spec-anchored / spec-as-source. Tools at each level have different costs.
- _"Spec-anchored remains theoretically appealing but lacks proven real-world validation"_ — careful adoption recommended.
- _"Spec-as-source might end up with the downsides of both MDD and LLMs: inflexibility AND non-determinism"_ — explicitly **don't** go to Tessl-level.

## Current DPT shape

- Specs live in `specs/frs/` while active.
- `/spec-archive` moves them to `specs/frs/archive/` after milestone close.
- No `/spec-update` for post-ship behavior changes — the only options are "create a new FR" or "edit the archive" (which the archive structure discourages).

## Proposed direction (sketch)

Either:

- Add `/spec-update <FR-ID>` to amend an archived FR's behavior section + bump a `revised:` field, _or_
- Extend `/spec-archive` with an `--amend` flag that re-opens an archived FR, allows behavior edits, then re-archives.

Don't pursue spec-as-source. Don't generate code from spec. The goal is "spec stays accurate," not "spec replaces code."

## Open questions

1. When does `/spec-update` fire? After observing a behavior change in code, or before (driving the change)? The latter is closer to spec-anchored proper.
2. Does updating an archived spec require a new milestone, or does it ride the next implementation milestone?
3. Linear/tracker integration — does updating an archived FR move its tracker issue back to In Progress, or open a new "amendment" issue?

## Sources

- [Understanding SDD — Martin Fowler / Böckeler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)

---

# Gap 6 — Markdown bloat audit

## Problem

Every SDD critic names the same anti-pattern: too many specs, too much duplication. Review fatigue swamps the supposed benefit.

## Research signal

- **Fowler/Böckeler**: _"I'd rather review code than all these markdown files."_
- **Scott Logic**: 2,000+ lines of markdown per increment.
- **Marmelab**: _"Excessive documentation, redundant documentation, doubled review burden."_

## Current DPT shape

- Per-FR spec set: `requirements.md`, `technical.md`, `testing.md`, `plan.md` (verify exact names).
- Possibility of duplicated facts across files: e.g., constraints listed in both `requirements.md` and `technical.md`.

## Proposed direction (sketch)

1. Audit existing templates for cross-file duplication.
2. Decide: collapse some files (4 → 3 or 4 → 2)? Or keep separate but enforce DRY with "canonical home" headers?
3. Add `/gate-check` probe: flag specs where the same multi-word phrase appears in 2+ files (heuristic — false-positive-prone, tune carefully).

## Open questions

1. Which template owns which fact? E.g., tech-stack choice — `technical.md` or `requirements.md`?
2. Does collapsing break the milestone-spec generation pipeline (`/spec-write`)?
3. Worth measuring DPT's own spec sets in `specs/frs/archive/` for actual duplication levels before redesigning?

## Sources

- [Understanding SDD — Fowler / Böckeler](https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html)
- [Putting Spec Kit Through Its Paces — Scott Logic](https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html)
- [SDD: The Waterfall Strikes Back — Marmelab](https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html)

---

# Gap 7 — Three-tier behavioral boundaries in CLAUDE.md template

## Problem

Behavioral guardrails ("don't run npm install," "always check FR is in Backlog before claim," etc.) are scattered across CLAUDE.md sections and per-skill memories. No standard structural convention.

## Research signal

- **Addy Osmani** (validated against GitHub's study of 2,500+ agent files): three-tier convention with explicit symbols:
  - ✅ **Always do**
  - ⚠️ **Ask first**
  - 🚫 **Never do**
- Cited as a primary differentiator between agent files that work and ones that don't.

## Current DPT shape

- `plugins/dev-process-toolkit/templates/CLAUDE.md` — verify it has or lacks a structured boundaries section.
- Project's own `CLAUDE.md` has scattered constraints under various headings (e.g., commit convention, release files, task tracking).

## Proposed direction (sketch)

1. Add a "Behavioral Boundaries" section to `templates/CLAUDE.md` with the three-tier convention.
2. Migrate scattered constraints in the project's own `CLAUDE.md` to use the convention as a self-test.
3. Cheap win — emoji/symbol overhead is negligible, structural clarity gain is real.

## Open questions

1. Does the user have an opinion on emoji usage? CLAUDE.md global says "Only use emojis if the user explicitly requests it" — so this proposal **violates** a global preference. Need to either (a) drop emojis and use text labels (`[ALWAYS]`, `[ASK FIRST]`, `[NEVER]`), or (b) confirm the user accepts emojis specifically in this CLAUDE.md template context. Default: text labels.
2. How granular should the tier list be — 3-5 entries each, or comprehensive?

## Sources

- [How to write a good spec — Addy Osmani](https://addyosmani.com/blog/good-spec/)

---

# Gap 8 — `AskUserQuestion` in `/brainstorm` (LOW priority)

## Problem

`/brainstorm` does Socratic Q&A free-form. Anthropic now ships a structured-interview pattern using the `AskUserQuestion` tool.

## Research signal

- **Anthropic Best Practices**: _"For larger features, have Claude interview you first. Start with a minimal prompt and ask Claude to interview you using the AskUserQuestion tool."_
- Cleaner than free-form: structured fields, easier to capture as spec input.

## Current DPT shape

- `plugins/dev-process-toolkit/skills/brainstorm/SKILL.md` (verify path) runs Socratic Q&A.

## Proposed direction (sketch)

Update `/brainstorm` to wrap its Q&A in `AskUserQuestion` calls. Output remains a brief feeding into `/spec-write`.

## Open questions

1. Is `AskUserQuestion` available in all Claude Code runtimes DPT targets? (Plugin marketplace serves multiple.)
2. Does it gracefully degrade if absent?

## Sources

- [Claude Code Best Practices § Let Claude interview you](https://code.claude.com/docs/en/best-practices)

---

# Gap 9 — Plan Mode in `/implement` Phase 1 (LOW priority)

## Problem

`/implement` Phase 1 (Analysis) does exploration in main context. Anthropic recommends Explore→Plan→Code→Commit with explicit Plan Mode for the explore step, to avoid context pollution.

## Research signal

- **Anthropic Best Practices**: explicit four-phase loop with Plan Mode for the first two phases.
- _"Plan mode is useful, but also adds overhead... if you could describe the diff in one sentence, skip the plan."_ — relevant to Gap 3's complexity routing.

## Current DPT shape

- `/implement` Phase 1 description in CLAUDE.md says "Analyzes the request" — verify exact mechanism.

## Proposed direction (sketch)

`/implement` Phase 1 enters Plan Mode (or invokes `Plan` subagent type) for exploration, then exits before Phase 2's plan-writing. Composes with Gap 3 — small tasks skip Plan Mode.

## Open questions

1. Plan Mode is a permission-mode toggle, not a tool. Can a skill enter Plan Mode programmatically, or only the user?
2. If only the user, this gap reduces to "tell users to invoke `/implement` from Plan Mode" — much weaker.

## Sources

- [Claude Code Best Practices § Explore first, then plan, then code](https://code.claude.com/docs/en/best-practices)
- [Permission Modes docs](https://code.claude.com/docs/en/permission-modes)

---

# Gap 10 — Worktree parallelization (WON'T FIX)

User memory `feedback_branch_isolation.md` explicitly says: stay on current branch for `/implement`, skip worktree prompt. Spec Kitty's worktree-as-a-feature is irrelevant here.

Honor the existing preference. **Do not pursue.**

---

# Gap 11 — GitHub adapter (parallel to Linear) (LOW priority / backlog)

DPT is Linear-first. GitHub Issues adapter parallel to Linear is feasible but driven by user demand, not research signal. Defer until requested.

---

# Reference URLs

## Claude Code official docs (stable, refetch as needed)

- Skills: https://code.claude.com/docs/en/skills
- Subagents: https://code.claude.com/docs/en/sub-agents
- Agent teams: https://code.claude.com/docs/en/agent-teams
- Best practices: https://code.claude.com/docs/en/best-practices
- Hooks: https://code.claude.com/docs/en/hooks
- Permission modes: https://code.claude.com/docs/en/permission-modes
- Plugins: https://code.claude.com/docs/en/plugins
- Memory (CLAUDE.md): https://code.claude.com/docs/en/memory
- Common workflows: https://code.claude.com/docs/en/common-workflows
- Settings: https://code.claude.com/docs/en/settings

## Third-party SDD/TDD landscape (snapshot — may drift)

- GitHub Spec Kit: https://github.com/github/spec-kit
- Spec-compare (6-tool comparison): https://github.com/cameronsjo/spec-compare
- Superpowers: https://github.com/obra/superpowers
- shinpr/claude-code-workflows: https://github.com/shinpr/claude-code-workflows
- Martin Fowler / Böckeler — Understanding SDD: https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- Marmelab — SDD: Waterfall Strikes Back: https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html
- Scott Logic — Spec Kit hands-on: https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html
- Addy Osmani — Good spec: https://addyosmani.com/blog/good-spec/
- alexop.dev — Forcing Claude Code to TDD: https://alexop.dev/posts/custom-tdd-workflow-claude-code-vue/
- Steve Kinney — TDD with Claude: https://stevekinney.com/courses/ai-development/test-driven-development-with-claude

---

# Memory pointers

Existing user-memory files relevant when picking up gaps:

- `feedback_branch_isolation.md` — stay on current branch (Gap 10 won't-fix justification)
- `feedback_implement_pacing.md` — don't pause between phases (Gap 1 orchestrator inherits this)
- `feedback_implement_tracker_writes.md` — Linear lifecycle: claim at FR start, release after archive
- `project_no_users_yet.md` — rip-and-replace is fine; no migration burden (justifies aggressive choices in Gaps 1, 3, 6)
- `reference_linear_project.md` — every save_issue must set team=STE and project="DPT — Dev Process Toolkit"
- `feedback_check_milestones_first.md` — list active+archive plans AND CHANGELOG before claiming a new M-number

---

# Sources (full list, deduplicated)

**Anthropic / Claude Code:**

- https://code.claude.com/docs/en/best-practices
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agent-teams
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/permission-modes

**SDD frameworks (primary):**

- https://github.com/github/spec-kit
- https://github.com/obra/superpowers
- https://github.com/shinpr/claude-code-workflows
- https://github.com/cameronsjo/spec-compare

**SDD analysis (independent):**

- https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html
- https://blog.scottlogic.com/2025/11/26/putting-spec-kit-through-its-paces-radical-idea-or-reinvented-waterfall.html
- https://addyosmani.com/blog/good-spec/

**TDD-with-AI:**

- https://alexop.dev/posts/custom-tdd-workflow-claude-code-vue/
- https://stevekinney.com/courses/ai-development/test-driven-development-with-claude
