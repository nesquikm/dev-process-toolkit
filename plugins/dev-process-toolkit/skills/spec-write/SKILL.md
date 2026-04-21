---
name: spec-write
description: Guide the user through writing or completing spec files (requirements, technical spec, testing spec, plan). Use after /setup to fill in specs before implementation, or to update existing specs.
argument-hint: '[requirements | technical | testing | plan | all]'
---

# Spec Write

Guide the user through writing or completing the project specification files.

> **For greenfield features with an open solution space** — where the right approach is genuinely unclear — consider running `/dev-process-toolkit:brainstorm` first. Brainstorm explores approaches and gets design approval before you commit to a spec structure. For features where the design is already clear, start here directly.

## Process

### 0. Layout + tracker-mode probes

Before any other step:

- **Layout probe** — Read `specs/.dpt-layout` via `bun run adapters/_shared/src/layout.ts`. If `version: v2`, FR creation goes to `specs/frs/<ulid>.md` (never `specs/requirements.md`) and `Provider.sync()` fires on save. If marker absent + `specs/requirements.md` exists, run v1 behavior unchanged. If version > v2, exit with the canonical message (AC-47.3). Full reference: `docs/v2-layout-reference.md` § `/spec-write`.
- **Provider resolution** — In v2 mode, resolve `Provider` once per invocation (AC-43.3) using the same rule as `/implement` (LocalProvider for `mode: none`, TrackerProvider otherwise).
- **Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. If a tracker mode is active:
  - Run the 3-tier ticket-binding resolver and mandatory confirmation prompt per `docs/ticket-binding.md` (FR-32) the first time the session edits an FR bound to a ticket — decline exits cleanly with zero side effects (AC-32.4).
  - After saving any FR-level AC edit, run the FR-39 diff/resolve loop via the active adapter before pushing via `upsert_ticket_metadata` (AC-34.7, AC-39.9).
  See `docs/spec-write-tracker-mode.md` for the full tracker-mode flow.

### 0a. Resolver entry (AC-52.1)

In v2 mode, after the layout version gate and before any FR write:

1. Call `resolveFRArgument($ARGUMENTS, config)` from `adapters/_shared/src/resolve.ts`. Build `config` from `CLAUDE.md` `## Task Tracking` + each active adapter's Schema W `resolver:` block.
2. Route by `kind`:
   - **`ulid`** → open `specs/frs/<ulid>.md` for editing (AC-52.2). Skip step 0b below.
   - **`tracker-id` / `url`** → call `findFRByTrackerRef(specsDir, trackerKey, trackerId)`:
     - **Hit** → open that FR for editing; no import, no tracker network call beyond resolve (AC-52.3). Skip 0b.
     - **Miss** → run the shared import helper `importFromTracker(trackerKey, trackerId, provider, specsDir, promptMilestone)` from `adapters/_shared/src/import.ts`. Tracker ACs are auto-accepted — **never run the FR-39 per-AC prompt loop here** (AC-52.5); the local side is empty so there is nothing to diff against. Empty-AC tickets get a TODO marker in the new FR's `## Acceptance Criteria` section (AC-52.7).
   - **`fallthrough`** → continue with pre-M14 free-form handling (step 1 below). NFR-18 requires byte-identical behavior for `all`, `requirements`, `technical`, `testing`, `plan`.
3. On `AmbiguousArgumentError`, surface the NFR-10-shape error from `docs/resolver-entry.md` § Ambiguity and exit non-zero. Never silently pick a winner (NFR-20).
4. All tracker/network failures during `importFromTracker` surface per NFR-10 (AC-52.8).

Full decision table and edge cases: `docs/resolver-entry.md`. Subsequent `/spec-write` calls on the same tracker ID run FR-39's normal diff/resolve flow (AC-52.6) because both sides are now populated.

### 0b. v2 FR creation path (AC-49.2)

In v2 mode, creating a new FR means:

1. Mint a ULID via `Provider.mintId()` — always local (AC-43.5), offline-safe.
2. Write `specs/frs/<ulid>.md` with Schema Q frontmatter (`id`, `title`, `milestone`, `status: active`, `archived_at: null`, `tracker: {}`, `created_at`) and the five required sections in order: `## Requirement`, `## Acceptance Criteria`, `## Technical Design`, `## Testing`, `## Notes` (AC-40.2).
3. Call `Provider.sync(spec)` — no-op in `LocalProvider`, pushes to tracker in `TrackerProvider`.
4. Regenerate `specs/INDEX.md` via `regenerateIndex(specsDir)`.
5. Never write to `specs/requirements.md` on v2 projects — that file is slimmed to cross-cutting content only (AC-40.3).

### 1. Assess current state

Check which spec files exist in `specs/` and how complete they are:
- Read each file and determine: empty template, partially filled, or complete
- Report status to the user

If `specs/` doesn't exist, suggest running `/dev-process-toolkit:setup` first.

### 2. Determine scope

If `$ARGUMENTS` specifies a file (requirements, technical, testing, plan), work on that one.
If `$ARGUMENTS` is "all" or empty, work through all files in precedence order:

```
requirements.md → technical-spec.md → testing-spec.md → plan.md
```

This order matters because each spec builds on the previous one.

### 3. For each spec file

#### requirements.md (WHAT to build)

Ask the questions in this order, one at a time. Wait for each answer before asking the next — do not bundle them into a single turn even when the user is responsive.

Ask what this project is, who it is for, and what problem it solves. Wait for the answer. Then ask what the main features are (list them as functional requirements). Wait for the answer. Then ask, for each feature, what the acceptance criteria are (binary pass/fail). Wait for the answer. Then ask what is explicitly out of scope. Wait for the answer. Then ask whether there are any non-functional requirements (performance, security, accessibility).

Write the answers into the spec using the template structure (FR-1, AC-1.1, etc.).

**Stable anchor IDs (FR-18):** Every `### FR-{N}:` heading you generate or edit must carry its `{#FR-{N}}` anchor on the same line, matching the template form `### FR-3: User login {#FR-3}`. Same rule applies in `plan.md` for `## M{N}: ...` headings — the `{#M{N}}` anchor must be present. These anchors are the pointer targets for archival (FR-16) and for cross-references in the traceability matrix, so they must survive heading renames. If you encounter any milestone or FR heading without its anchor, **flag it as a warning** in the report (step 7) and offer to add it — never silently edit around it.

#### technical-spec.md (HOW to build it)

Read `requirements.md` first to understand what needs building. Then ask the questions below in order, one at a time — wait for each answer before asking the next.

Ask what the high-level architecture looks like (read existing code if any). Wait for the answer. Then ask what the key design decisions are and their rationale. Wait for the answer. Then ask what the data model is (schemas, types, database tables). Wait for the answer. Then ask what APIs or interfaces are needed. Wait for the answer. Then ask what the key patterns are (state management, error handling, etc.).

Pre-fill what you can from the codebase and CLAUDE.md. Ask the user to confirm or correct.

#### testing-spec.md (HOW to test it)

Read `requirements.md` and `technical-spec.md`. Then pre-fill the test framework, mocking approach, and file conventions from CLAUDE.md, and identify what NOT to test (generated code, third-party internals).

For the two items that need user input, ask them in order, one at a time — wait for each answer before asking the next. Ask about coverage targets per layer. Wait for the answer. Then ask about the test data strategy (factories, fixtures, seeds, frozen times).

Most of this can be inferred — present your best guess and let the user correct.

#### plan.md (WHEN to build it)

Read all other specs. Then work through the steps below in order, one at a time — if any step surfaces a question for the user, ask it, wait for the answer, and only then move to the next step. Do not bundle the step-questions into a single turn.

First, break the requirements into milestones (each independently gatable). Then order the milestones by dependency. Then, for each milestone, list tasks in dependency order, acceptance criteria, and gate commands. Finally, draw the milestone dependency graph.

**Task Sizing:** generated tasks must follow the Task Sizing guidance in `templates/spec-templates/plan.md.template` — each task ≈ one commit's worth of work, written as a 2-line entry (action line + indented `verify:` line). If you can't name a single verification step, split the task. See the template's anti-pattern callout for examples of tasks that are too large.

Present the plan and ask for approval.

### 4. Review and confirm

After completing each spec file:
- Show the user what was written
- Ask for approval before saving
- Note any open questions or decisions that need human input

### 5. Cross-check consistency

After saving any spec file, automatically check all other existing specs for consistency. Each spec builds on the ones before it, so changes can ripple.

#### What to check

- **requirements.md changed:** Check that `technical-spec.md` covers all functional requirements (architecture, data model, APIs). Check that `testing-spec.md` has test strategies for all ACs. Check that `plan.md` milestones cover all requirements and no milestone references removed/renamed FRs.
- **technical-spec.md changed:** Check that implementation details are consistent with `requirements.md` scope (no undocumented features, no missing requirements). Check that `testing-spec.md` mocking and test strategies match the chosen architecture. Check that `plan.md` task breakdowns match the technical approach.
- **testing-spec.md changed:** Check that test coverage targets and strategies align with `requirements.md` ACs and `technical-spec.md` module boundaries.
- **plan.md changed:** Check that milestones reference valid FRs/ACs from `requirements.md` and that task descriptions match `technical-spec.md`.

#### How to report

For each inconsistency found, report:

| Spec file | Issue | Suggestion |
| --- | --- | --- |
| technical-spec.md | FR-3 has no architecture section | Add data model for user preferences |
| plan.md | M2 references removed FR-2.1 | Remove or replace with FR-2.2 |

- If **no inconsistencies** found, report "All specs are consistent" and move on.
- If **inconsistencies found**, offer to fix them right now by updating the affected specs. Walk the user through each change and get approval before saving, just like step 4.

### 6. Risk scan

Before handing off to implementation, do a structured risk scan. Read all specs and the existing codebase, then assess risks using this table:

| Category | Risk | Severity | Mitigation |
|----------|------|----------|------------|
| **External dependencies** | <!-- e.g., Third-party API has no SLA --> | high / medium / low | <!-- e.g., Add circuit breaker, cache responses --> |
| **Breaking changes** | <!-- e.g., DB schema migration on live data --> | high / medium / low | <!-- e.g., Blue-green migration, rollback script --> |
| **Security surface** | <!-- e.g., New user input endpoint --> | high / medium / low | <!-- e.g., Input validation, rate limiting --> |
| **Performance impact** | <!-- e.g., N+1 query on large dataset --> | high / medium / low | <!-- e.g., Eager loading, pagination --> |
| **Data migration** | <!-- e.g., Format change breaks old clients --> | high / medium / low | <!-- e.g., Versioned API, backward compat --> |
| **Unclear acceptance criteria** | <!-- e.g., AC-2.1 is subjective --> | high / medium / low | <!-- e.g., Add measurable threshold --> |

**Severity levels:**
- **high** — Could block release or cause data loss/security breach
- **medium** — Significant effort to fix if discovered late
- **low** — Minor inconvenience, easy to address

**Any high-severity risk must be resolved or explicitly accepted before proceeding to implementation.**

For each risk found, add it to the relevant spec:
- Technical risks → `specs/technical-spec.md` (risks/considerations section)
- Unclear ACs → `specs/requirements.md` (flag the specific AC with a note)
- Testing risks → `specs/testing-spec.md` (note what's hard to test and the strategy)

If **no significant risks** found, report "No major risks identified" and move on. Don't invent risks — only flag things that would genuinely surprise someone during implementation.

### 7. Report

Summarize what was completed:
- Which specs are done vs. still need work
- Any inconsistencies found and resolved (or still pending)
- Risks identified (if any)
- Any open questions flagged during the process
- Remind: "Run `/dev-process-toolkit:implement <milestone>` when specs are ready"

## Rules

- Ask one clarifying question per turn. Wait for the answer before asking the next. This rule holds at phase transitions too — when two questions look independent, still ask the first, wait, then ask the second.
- Work through specs in precedence order (requirements → technical → testing → plan)
- Each later spec should reference and build on earlier ones
- Ask the user for domain knowledge — don't invent requirements
- Pre-fill technical details from the codebase and CLAUDE.md where possible
- Present drafts for approval before saving — specs are the source of truth
- Keep acceptance criteria binary (pass/fail, not "good enough")
