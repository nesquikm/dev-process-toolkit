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

- **Provider resolution** — Resolve `Provider` once per invocation (AC-STE-20.3) using the same rule as `/implement` (LocalProvider for `mode: none`, TrackerProvider otherwise). FR creation goes to `specs/frs/<Provider.filenameFor(spec)>` (M18 STE-60; never `specs/requirements.md`); `Provider.sync()` fires on save. Full reference: `docs/layout-reference.md` § `/spec-write`.
- **Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. If a tracker mode is active:
  - Run the 3-tier ticket-binding resolver and mandatory confirmation prompt per `docs/ticket-binding.md` (STE-27) the first time the session edits an FR bound to a ticket — decline exits cleanly with zero side effects (AC-STE-27.4).
  - After saving any FR-level AC edit, run the STE-17 diff/resolve loop via the active adapter before pushing via `upsert_ticket_metadata` (AC-STE-12.7, AC-STE-17.9).
  See `docs/spec-write-tracker-mode.md` for the full tracker-mode flow.

### 0a. Resolver entry (AC-STE-31.1)

After the layout gate and before any FR write:

1. Call `buildResolverConfig(claudeMdPath, adaptersDir)` from `adapters/_shared/src/resolver_config.ts` once at entry (STE-44), then pass the returned `ResolverConfig` to `resolveFRArgument($ARGUMENTS, config)` from `adapters/_shared/src/resolve.ts`. The builder reads `CLAUDE.md` `## Task Tracking` + each active adapter's Schema W `resolver:` block — never hand-assemble the config inline (AC-STE-44.5). Malformed adapter metadata surfaces as `MalformedAdapterMetadataError` → NFR-10 canonical refusal (AC-STE-44.6).
2. Route by `kind`:
   - **`ulid`** → open the FR whose frontmatter `id:` equals `<ulid>` — located via `Provider.filenameFor(spec)` (AC-STE-31.2). Skip step 0b below.
   - **`tracker-id` / `url`** → call `findFRByTrackerRef(specsDir, trackerKey, trackerId)`:
     - **Hit** → open that FR for editing; no import, no tracker network call beyond resolve (AC-STE-31.3). Skip 0b.
     - **Miss** → run the shared import helper `importFromTracker(trackerKey, trackerId, provider, specsDir, promptMilestone)` from `adapters/_shared/src/import.ts`. Tracker ACs are auto-accepted — **never run the STE-17 per-AC prompt loop here** (AC-STE-31.5); the local side is empty so there is nothing to diff against. Empty-AC tickets get a TODO marker in the new FR's `## Acceptance Criteria` section (AC-STE-31.7).
   - **`fallthrough`** → continue with free-form-argument handling (step 1 below). NFR-18 requires byte-identical behavior for `all`, `requirements`, `technical`, `testing`, `plan`.
3. On `AmbiguousArgumentError`, surface the NFR-10-shape error from `docs/resolver-entry.md` § Ambiguity and exit non-zero. Never silently pick a winner (NFR-20).
4. All tracker/network failures during `importFromTracker` surface per NFR-10 (AC-STE-31.8).

Full decision table and edge cases: `docs/resolver-entry.md`. Subsequent `/spec-write` calls on the same tracker ID run STE-17's normal diff/resolve flow (AC-STE-31.6) because both sides are now populated.

### 0b. FR creation path (AC-STE-24.2)

Creating a new FR means:

**Draft with placeholder (STE-66).** When drafting a new tracker-bound FR, use `<tracker-id>` (or the adapter-specific rendering — `STE-<N>` for Linear, `PROJ-<N>` for Jira, etc.) as the tracker-ID placeholder throughout the draft: AC prefixes (`AC-<tracker-id>.1`), filename (`<tracker-id>.md`), plan-file table row, and every prose cross-reference. **Never guess** the next sequential number — the tracker allocator decides, not the implementer, and a guess that clashes with a cancelled/renumbered ticket ships misaligned with its own binding. The real ID is known only after `Provider.sync(spec)` / `upsertTicketMetadata(null, …)` returns. Substitute the placeholder globally once the ID is assigned, **then** write the FR file. This rule applies equally to Linear (which skips cancelled numbers), Jira, and custom trackers. Mode: none is exempt — the short-ULID tail is minted locally and is never subject to race conditions with a tracker allocator.

1. Mint a ULID via `Provider.mintId()` — always local (AC-STE-20.5), offline-safe.
2. **(STE-121 AC-STE-121.2) Build canonical frontmatter via `buildFRFrontmatter(spec, trackerBinding?)`** from `adapters/_shared/src/fr_frontmatter.ts` — **never author YAML by hand.** The helper enforces the bimodal shape (mode-none `id:` block; tracker-mode compact `tracker:` block) and rejects the verbose `{ key, id, url }` form (`InvalidTrackerShapeError`, AC-STE-110.2). Hand-rolled YAML is the regression source the M29 prose flip didn't catch. Then write the FR file to `specs/frs/<Provider.filenameFor(spec)>` (M18 STE-60 AC-STE-60.3). `Provider.filenameFor(spec)` returns `<tracker-id>.md` in tracker mode (e.g., `STE-60.md`) and `<short-ULID>.md` in `mode: none` (e.g., `VDTAF4.md`, matching the AC-prefix convention). Never hard-code `fr_<ULID>.md` — the ULID lives in frontmatter `id:`, not in the filename.

   Helper output — do not author by hand. The five required body sections in order: `## Requirement`, `## Acceptance Criteria`, `## Technical Design`, `## Testing`, `## Notes` (AC-STE-26.2). Reference shapes (illustrative only):

   ```yaml
   # mode: none — id required, no tracker block
   ---
   title: <title>
   milestone: <M<N>>
   status: active
   archived_at: null
   id: fr_<26-char ULID>
   created_at: <ISO timestamp>
   ---
   ```

   ```yaml
   # tracker mode — id absent, compact tracker block
   ---
   title: <title>
   milestone: <M<N>>
   status: active
   archived_at: null
   tracker:
     <mode>: <tracker-id>
   created_at: <ISO timestamp>
   ---
   ```

   The compact `{ <mode>: <tracker-id> }` shape is the **only** form /spec-write emits in tracker mode (AC-STE-110.2). Existing tracker-mode FR files that still carry `id:` are flagged by /gate-check probe-13 `identity_mode_conditional` at **error** severity (M29 STE-110 AC-STE-110.4 flip).
3. **AC prefix (STE-50 AC-STE-50.1/STE-50.2)** — every AC line in the new file uses the shape `- AC-<PREFIX>.<N>: <body>`, where `<PREFIX>` is derived via `acPrefix(spec)` from `adapters/_shared/src/ac_prefix.ts`: in tracker mode it's the bound tracker ID (e.g., `AC-STE-50.1`); in `mode: none` it's `spec.id.slice(23, 29)` — the last 6 chars of the ULID's random portion (e.g., `AC-VDTAF4.1`). Tracker mode requires the `tracker:` block to be populated **before** ACs are written (i.e., bind the ticket first, then author ACs). In `mode: none`, before writing the file, call `scanShortUlidCollision(specsDir, spec)` from the same module; it throws `ShortUlidCollisionError` (NFR-10-shape) if another FR already uses the same short-ULID tail (AC-STE-50.3). The same short-ULID doubles as the mode-none filename stem, so the collision scan also guards against filename collisions. **(STE-122 AC-STE-122.2) Never emit literal `AC-<digit>.<N>` shape** — the requirements template carries the placeholder `AC-<tracker-id>.<N>`; substitute via `acPrefix(spec)` before writing every AC line.
4. Call `Provider.sync(spec)` — no-op in `LocalProvider`, pushes to tracker in `TrackerProvider`. **STE-117 workspace binding.** In tracker mode, before invoking `upsertTicketMetadata` for a freshly-created ticket, call `readWorkspaceBinding(claudeMdPath, "linear" | "jira")` from `adapters/_shared/src/workspace_binding.ts` and forward `team` + `project` into the call. Linear adapter rejects creates that lack `project` per the silent-landing trap (`adapters/linear.md` § Silent no-op trap); Jira adapter rejects creates that lack `project` per the Jira API requirement (`adapters/jira.md`). On update (existing tracker ID), neither field is forwarded.

   **STE-118 milestone attachment (Linear-only, AC-STE-118.4).** After `Provider.sync(spec)` returns the freshly-allocated tracker ID, read the FR's `milestone:` frontmatter and call `planFileHeadingToMilestoneName(specs/plan/<milestone>.md)` from `adapters/_shared/src/attach_project_milestone.ts` to derive the canonical milestone name (anchor stripped). Then call `attachProjectMilestone(provider, project, canonicalName, ticketId)` to bind the ticket. Failure surfaces as `MilestoneAttachmentError` (NFR-10 canonical shape) — the FR file is not rolled back since the spec is the source of truth. Vacuous on `mode: none` and on adapters whose Schema M frontmatter declares `project_milestone: false` (Jira).
5. **(STE-121 AC-STE-121.3 + STE-122 AC-STE-122.3) Post-write self-checks.** Immediately after `Provider.sync(spec)` returns (so the tracker-id is bound), run **both** in-band checks against the just-written file before /spec-write returns clean:
   - Call `runFrontmatterShapeCheck(projectRoot, frFilePath)` from `adapters/_shared/src/fr_frontmatter.ts`. Throws `FRFrontmatterShapeError` (NFR-10 canonical shape) when probe-13 logic flags the file — the LLM hand-rolled YAML, mutated state, or the helper has a bug. Refusal halts /spec-write before the file leaves a clean signal to downstream skills.
   - Call `scanGuessedTrackerIdLiterals([frFilePath, specs/requirements.md])` from `adapters/_shared/src/guessed_tracker_id_scan.ts`. Any returned violation is a literal `AC-<digit>.<N>` placeholder that survived substitution; refuse with NFR-10 canonical shape (use the violation's own `message` field, which is already canonical), naming `file:line:column` + the offending token + remedy `substitute <tracker-id> via acPrefix(spec) and retry`.

   Probes #13 (`identity_mode_conditional`) and #15 (`guessed_tracker_id`) stay at /gate-check time as the safety net for paths that bypass /spec-write (manual edits, copy-paste from old templates, downstream toolkit consumers).
6. Never write to `specs/requirements.md` — that file is slimmed to cross-cutting content only (AC-STE-26.3).

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

Write the answers into the spec using the template structure with per-FR prefixes derived via `acPrefix()` (tracker ID in tracker mode, short-ULID tail in `mode: none`). AC lines take the shape `AC-<PREFIX>.<N>: ...`.

**Stable anchor IDs (STE-18):** Every `### <PREFIX>:` heading you generate or edit must carry its `{#<PREFIX>}` anchor on the same line, matching the template form `### STE-42: User login {#STE-42}` (tracker mode) or `### VDTAF4: User login {#VDTAF4}` (`mode: none`). Same rule applies in `plan.md` for `## M{N}: ...` headings — the `{#M{N}}` anchor must be present. These anchors are the pointer targets for archival (STE-22) and for cross-references in the traceability matrix, so they must survive heading renames. If you encounter any milestone or FR heading without its anchor, **flag it as a warning** in the report (step 7) and offer to add it — never silently edit around it.

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

**Milestone-number allocation guard (STE-119 AC-STE-119.3).** Before claiming any new `M<N>`, call `nextFreeMilestoneNumber(specsDir, changelogPath)` from `adapters/_shared/src/next_free_milestone_number.ts`. The helper does the three-way scan (active `specs/plan/`, archived `specs/plan/archive/`, CHANGELOG `M<N>` references) and returns `{ next, sources }`. Use `next` as the canonical default. If the user explicitly typed an `M<N>` argument that appears in any of the three source sets, **refuse with NFR-10 canonical shape** showing all three breakdowns and the proposed next free number — see AC-STE-119.7 for the diagnostic format. Never trust a partial `ls` output and never trust LLM memory: the helper is the single source of truth.

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
| technical-spec.md | STE-42 has no architecture section | Add data model for user preferences |
| plan.md | M2 references removed AC-STE-43.1 | Remove or replace with AC-STE-43.2 |

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
| **Unclear acceptance criteria** | <!-- e.g., AC-STE-43.1 is subjective --> | high / medium / low | <!-- e.g., Add measurable threshold --> |

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
- Do NOT narrate a specific unallocated tracker ID (e.g., `STE-87`) in conversation when drafting — use the literal placeholder `<tracker-id>` (or the adapter rendering: `STE-<N>` for Linear, `PROJ-<N>` for Jira) until the tracker allocator returns the real ID. STE-66 covers draft files; this rule covers the conversational hazard that file-level probes cannot catch.
