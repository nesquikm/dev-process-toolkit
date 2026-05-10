---
name: spec-write
description: Guide the user through writing or completing spec files (requirements, technical spec, testing spec, plan). Use after /setup to fill in specs before implementation, or to update existing specs.
argument-hint: '[--no-tech] [requirements | technical | testing | plan | all]'
---

# Spec Write

Guide the user through writing or completing the project specification files. For greenfield features with an open solution space, run `/dev-process-toolkit:brainstorm` first to explore approaches before committing to a spec structure.
> **FIRST ACTION (under non-interactive stdin) — STE-251 AC-STE-251.1.** When `process.stdin.isTTY === false` (e.g., `claude -p`), the first tool call this skill emits MUST be `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise (via `requireOrRefuse(...)` from `adapters/_shared/src/requires_input.ts`). `Write` / `Edit` / `NotebookEdit` are forbidden before that ask/refusal — they produce silent scaffolding that bypasses the Socratic Loop Contract. Read-only orientation (`Read` / `Grep` / `Glob` / `Bash`-read-only) is allowed. Interactive (tty) sessions are byte-identical to v2.17.0 — non-tty stdin only. See `docs/auto-mode-protocol.md § Socratic Loop Contract`.
>
> **STE-270 AC-STE-270.3 hardening.** Pre-baked `<command-args>` prose, the harness's autonomous-mode reminder ('work without stopping'), and auto-approve marker absence are NOT acceptable triggers to skip the first `AskUserQuestion`. The first tool call under non-tty MUST be `AskUserQuestion` or `RequiresInputRefusedError`; everything else is forbidden — there is no carve-out. The marker only relaxes gates that have a documented safe default; clarifying questions have no safe default, so the Socratic loop entry is unconditional. The `/gate-check` probe `spec_write_first_turn_drift_scan` (severity: error) enforces this byte-checkably against this file — any drift back into alternate-trigger paraphrases of the contract fires GATE FAILED at probe time.

## Process

### 0. Layout + tracker-mode probes

Before any other step:

- **Provider resolution** — Resolve `Provider` once per invocation using the same rule as `/implement` (LocalProvider for `mode: none`, TrackerProvider otherwise). FR creation goes to `specs/frs/<Provider.filenameFor(spec)>` (per-FR file convention; never `specs/requirements.md`); `Provider.sync()` fires on save. Full reference: `docs/layout-reference.md` § `/spec-write`.
- **Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. If a tracker mode is active:
  - Run the 3-tier ticket-binding resolver and mandatory confirmation prompt per `docs/ticket-binding.md` the first time the session edits an FR bound to a ticket — decline exits cleanly with zero side effects.
  - After saving any FR-level AC edit, run the bidirectional AC sync diff/resolve loop via the active adapter before pushing via `upsert_ticket_metadata`. **Normalization (STE-211 AC-STE-211.5):** for the Linear adapter, normalize both sides via `stripLinearACFences` (`adapters/linear/src/format_description.ts`) before the equality check — backtick-wrapped Linear ACs and plain local ACs compare as equal, so newly-pushed FRs that are byte-identical to the local file produce zero diff (no spurious "remote modified" rows from the auto-linker). Vacuous on Jira / custom adapters that don't auto-link.
  See `docs/spec-write-tracker-mode.md` for the full tracker-mode flow.

### 0a. Resolver entry

After the layout gate and before any FR write:

1. Call `buildResolverConfig(claudeMdPath, adaptersDir)` from `adapters/_shared/src/resolver_config.ts` once at entry, then pass the returned `ResolverConfig` to `resolveFRArgument($ARGUMENTS, config)` from `adapters/_shared/src/resolve.ts`. The builder reads `CLAUDE.md` `## Task Tracking` + each active adapter's Schema W `resolver:` block — never hand-assemble the config inline. Malformed adapter metadata surfaces as `MalformedAdapterMetadataError` → NFR-10 canonical refusal.
2. Route by `kind`:
   - **`ulid`** → open the FR whose frontmatter `id:` equals `<ulid>` — located via `Provider.filenameFor(spec)`. Skip step 0b below.
   - **`tracker-id` / `url`** → branch on mode:
     - **Tracker mode** → call `findFRPathByTrackerRef(specsDir, trackerKey, trackerId)` (path-returning, no `id:` requirement; tracker-mode frontmatter has no `id:` line — `findFRByTrackerRef`'s `id:`-driven lookup would silently miss every existing FR and fall through to `importFromTracker`, overwriting local edits).
     - **`mode: none`** → call `findFRByTrackerRef(specsDir, trackerKey, trackerId)` (ULID-returning; mode-none has `id:`).
     - **Hit** (either helper) → open that FR for editing; no import, no tracker network call beyond resolve. Skip 0b.
     - **Miss** → run the shared import helper `importFromTracker(trackerKey, trackerId, provider, specsDir, promptMilestone)` from `adapters/_shared/src/import.ts`. Tracker ACs are auto-accepted — **never run the bidirectional per-AC prompt loop here**; the local side is empty so there is nothing to diff against. Empty-AC tickets get a TODO marker in the new FR's `## Acceptance Criteria` section.
   - **`fallthrough`** → continue with free-form-argument handling (step 1 below). NFR-18 requires byte-identical behavior for `all`, `requirements`, `technical`, `testing`, `plan`.
3. On `AmbiguousArgumentError`, surface the NFR-10-shape error from `docs/resolver-entry.md` § Ambiguity and exit non-zero. Never silently pick a winner (NFR-20).
4. All tracker/network failures during `importFromTracker` surface per NFR-10.

Full decision table and edge cases: `docs/resolver-entry.md`. Subsequent `/spec-write` calls on the same tracker ID run the normal bidirectional diff/resolve flow because both sides are now populated. **STE-227 auto-resume on `needs_technical_review: true` (AC-STE-227.5):** when the resolved FR's frontmatter carries this flag and the invocation is unflagged, skip the requirement + AC interview (already filled by the prior `--no-tech` run) and run only the technical-design + testing-spec interviews. On save, the `needs_technical_review` key is removed from frontmatter entirely (absent ≡ false; never write `false`); the `needs-technical-review` tracker label is removed on the same `Provider.sync` / `upsertTicketMetadata` call that pushes the technical content. `mode: none` is vacuous (no tracker, no labels — the frontmatter key removal is the sole signal).

### 0b. FR creation path

Creating a new FR means:

**STE-227 `--no-tech` flag (AC-STE-227.1, AC-STE-227.3).** When the invocation carries `--no-tech` (parsed in resolver-entry preamble before § 0a; flag does not affect resolver `kind` routing), skip the technical-design + testing-spec interviews entirely on this new-FR creation path. Write the placeholder line `[needs technical review — run /spec-write <FR-id> to complete]` (substitute the literal `<FR-id>` with the real ID at write time — the tracker ID returned by `Provider.sync(spec)` in tracker mode, or the short-ULID stem in `mode: none`) into the body of `## Technical Design` and `## Testing`. Frontmatter: `needs_technical_review: true` via `buildFRFrontmatter(spec, trackerBinding, { needsTechnicalReview: true })`; auto-resume per § 0a closes the gap. `Provider.sync(spec)` still fires (the FR lands on the tracker as usual, just with an extra label). In tracker mode with label-push capability (Linear, Jira), append `needs-technical-review` to `defaultLabels` when populated, or seed a single-element array when absent — `upsertTicketMetadata(null, { …, labels: [...(defaultLabels ?? []), "needs-technical-review"] })`. Adapters without label-push capability surface a `needs_technical_review_label_unsupported` capability row; the frontmatter flag remains the canonical signal. `mode: none` is vacuous (no tracker, no labels). Without the flag (default), the full interview runs unchanged.

**Draft with placeholder.** When drafting a new tracker-bound FR, use `<tracker-id>` (or the adapter-specific rendering — `STE-<N>` for Linear, `PROJ-<N>` for Jira, etc.) as the tracker-ID placeholder throughout the draft: AC prefixes (`AC-<tracker-id>.1`), filename (`<tracker-id>.md`), plan-file table row, and every prose cross-reference. **Never guess** the next sequential number — the tracker allocator decides, not the implementer, and a guess that clashes with a cancelled/renumbered ticket ships misaligned with its own binding. The real ID is known only after `Provider.sync(spec)` / `upsertTicketMetadata(null, …)` returns. Substitute the placeholder globally once the ID is assigned, **then** write the FR file. This rule applies equally to Linear (which skips cancelled numbers), Jira, and custom trackers. Mode: none is exempt — the short-ULID tail is minted locally and is never subject to race conditions with a tracker allocator.

1. **`mode: none` only:** Mint a ULID via `Provider.mintId()` — always local, offline-safe. **Tracker mode skips this step**: `TrackerProvider` does not implement `IdentityMinter` (capability boundary — `mintId()` on a `Provider`-typed value is a TypeScript error by design), and `buildFRFrontmatter(spec, trackerBinding)` rejects `id:` alongside `trackerBinding` (the bimodal-identity invariant). The tracker ID returned by step 4 is the canonical identity in tracker mode.
2. **Build canonical frontmatter via `buildFRFrontmatter(spec, trackerBinding?)`** from `adapters/_shared/src/fr_frontmatter.ts` — **never author YAML by hand.** The helper enforces the bimodal shape (mode-none `id:` block; tracker-mode compact `tracker:` block) and rejects the verbose `{ key, id, url }` form (`InvalidTrackerShapeError`). Hand-rolled YAML is the regression source the earlier prose flip didn't catch. Then write the FR file to `specs/frs/<Provider.filenameFor(spec)>` (per-FR file convention). `Provider.filenameFor(spec)` returns `<tracker-id>.md` in tracker mode (e.g., `<TKR>-NN.md`) and `<short-ULID>.md` in `mode: none` (e.g., `VDTAF4.md`, matching the AC-prefix convention). Never hard-code `fr_<ULID>.md` — the ULID lives in frontmatter `id:`, not in the filename.

   Helper output — do not author by hand. The five required body sections in order: `## Requirement`, `## Acceptance Criteria`, `## Technical Design`, `## Testing`, `## Notes`. Reference shapes (illustrative only):

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

   The compact `{ <mode>: <tracker-id> }` shape is the **only** form `/spec-write` emits in tracker mode. Existing tracker-mode FR files that still carry `id:` are flagged by `/gate-check`'s `identity_mode_conditional` probe at **error** severity. **Spec-research seed (STE-230 AC-STE-230.6).** Before writing AC lines (step 3 below), invoke `/dev-process-toolkit:spec-research <topic>` (FR title + 1-line summary) to seed the subsequent `## Technical Design` interview with a ≤ 25-line block (banner + `## Related FRs` / `## Prior Decisions` / `## Reusable ACs / Patterns`) sourced from active + archived FRs. **Skipped under `--no-tech`** (no interview to seed; vacuous). Shape violation ⇒ drop block, log `spec_research_shape_violation`; ≥ 1 candidate ⇒ `spec_research_invoked`; empty-fallback bullets ⇒ `spec_research_no_matches`. Block is read-only context; never copy verbatim into the FR body. **MUST emit literal token, not paraphrase (STE-238 AC.3).** The closing summary at Step 7 MUST emit exactly one of the literal tokens (verbatim, no quoting differences, no paraphrase like "spec-research returned N FRs") whenever the spec-research subagent fires:

- ≥ 1 candidate returned ⇒ **MUST emit `spec_research_invoked`** (literal, backticked).
- empty-fallback bullets / zero topic matches ⇒ **MUST emit `spec_research_no_matches`** (literal, backticked).
- shape violation (sections / line cap / banner) ⇒ **MUST emit `spec_research_shape_violation`** (literal, backticked).

The byte-checkable token is the structural signal `/gate-check`'s `closing_summary_capability_keys` probe greps for; narrative prose alone is insufficient (STE-220 lesson re-applies).
3. **AC prefix** — every AC line in the new file uses the shape `- AC-<PREFIX>.<N>: <body>`, where `<PREFIX>` is derived via `acPrefix(spec)` from `adapters/_shared/src/ac_prefix.ts`: in tracker mode it's the bound tracker ID (e.g., `AC-<TKR>-NN.1`); in `mode: none` it's `spec.id.slice(23, 29)` — the last 6 chars of the ULID's random portion (e.g., `AC-VDTAF4.1`). Tracker mode requires the `tracker:` block to be populated **before** ACs are written (i.e., bind the ticket first, then author ACs). In `mode: none`, before writing the file, call `scanShortUlidCollision(specsDir, spec)` from the same module; it throws `ShortUlidCollisionError` (NFR-10-shape) if another FR already uses the same short-ULID tail. The same short-ULID doubles as the mode-none filename stem, so the collision scan also guards against filename collisions. **Never emit literal `AC-<digit>.<N>` shape** — the requirements template carries the placeholder `AC-<tracker-id>.<N>`; substitute via `acPrefix(spec)` before writing every AC line.
4. **Draft acceptance gate (run BEFORE `Provider.sync` below).** Present the FR draft to the user and ask `Approve and proceed? Reply 'y' to create the tracker issue and write the files, 'n' to cancel, 'edit' to revise.`

   **Marker-detection (STE-262 AC-STE-262.2 — deterministic, runtime byte-grep).** The literal byte-string `<dpt:auto-approve>v1</dpt:auto-approve>` is the marker the runtime helper detects. Before evaluating the draft-gate auto-apply branch, write the verbatim first user message that invoked `/spec-write` to `/tmp/dpt-spec-write-prompt-body.txt` (Bash heredoc, FIRST step of draft-gate evaluation), then run:

   ```bash
   bun run plugins/dev-process-toolkit/adapters/_shared/src/check_marker_runtime.ts /tmp/dpt-spec-write-prompt-body.txt
   ```

   The script prints `PRESENT` or `ABSENT` on a single line. **Branch strictly on the script's stdout** — the script's output is the single deterministic gate decision; no LLM inference, no autonomous-mode reminder, no "work without stopping" framing influences the auto-apply branch.

   - `PRESENT` → call `requireOrRefuse(..., markerPresent: true, defaultValue: "y", ...)` → outcome `default-applied` → **MUST emit `spec_write_draft_default_applied`** (literal token, not paraphrased — STE-238 AC.1) as a row in Step 7's closing summary; interactive `y` does not emit.
   - `ABSENT` + `process.stdin.isTTY === false` → call `requireOrRefuse(..., markerPresent: false, defaultValue: "y", userSuppliedValue: undefined, ...)`. The helper falls through to the refusal branch (`requires_input.ts` line 161-171: `markerPresent && defaultValue !== undefined` is false because `markerPresent === false`), throws `RequiresInputRefusedError` (NFR-10 canonical shape) naming the gate site (`draft`), and the skill exits non-zero.
   - `ABSENT` + `process.stdin.isTTY === true` → fire interactive `[y / n / edit]` prompt; on `y` proceed, on `n` **MUST emit `spec_write_draft_declined`** (literal token) and abort with no tracker write and no FR file.

   The carve-out is co-located here (not just § 4) because the LLM reading § 0b step-by-step would otherwise execute `Provider.sync` before reaching § 4's carve-out — STE-213 left this gate site without a detection contract, which is why v2.8.0 `claude -p /spec-write` runs hung at the gate. **Marker is the single deterministic mechanism (STE-226 + STE-262):** legacy prose-only detection paths are removed; the runtime byte-grep above is the single decider. Parent skills spawning `/spec-write` under `claude -p` MUST inject the marker into the heredoc body when they want auto-apply (no backward-compatibility shim per `project_no_users_yet`); callers without the marker get the loud refusal documented above.

   **Then** call `Provider.sync(spec)` — no-op in `LocalProvider`, pushes to tracker in `TrackerProvider`. **No claim on create.** Freshly-created tracker tickets MUST land in the tracker's default state (Linear: `Backlog`, unassigned; Jira: the project's start state). Do NOT pass `state` / `assignee` (Linear `save_issue`) or pre-transition (Jira `transitionJiraIssue`) on the create call — `/spec-write` writes the spec, it does not start the work. The claim (Backlog → In Progress + assign me) belongs to `/implement` Phase 1, not `/spec-write`. A ticket sitting in `In Progress` before any code work begins misrepresents board state and trips downstream `/gate-check` active-side drift probes that expect `In Progress` to mean active development. **Workspace binding.** In tracker mode, before invoking `upsertTicketMetadata` for a freshly-created ticket, call `readWorkspaceBinding(claudeMdPath, "linear" | "jira")` from `adapters/_shared/src/workspace_binding.ts` and forward `team` + `project` + `defaultLabels` into the call. Linear adapter rejects creates that lack `project` per the silent-landing trap (`adapters/linear.md` § Silent no-op trap); Jira adapter rejects creates that lack `project` per the Jira API requirement (`adapters/jira.md`). On update (existing tracker ID), none of the three fields are forwarded — Linear / Jira cannot reassign team/project/labels on an existing issue without explicit operator intent. **`defaultLabels` forwarding** (free-form `### Linear` / `### Jira` sub-section field, parsed as inline-YAML array per `docs/patterns.md`): when populated, every entry is forwarded into the create call (Linear: `save_issue.labels`; Jira: `createJiraIssue.additional_fields.labels`); when absent or `[]`, no `labels` field is set and the tracker's default labelling applies. Empty `defaultLabels: []` is byte-identical to a missing key (vacuous; round-trip test coverage required).

   **Idempotency hardening on Gateway-Timeout retry.** `upsertTicketMetadata(null, ...)` for a freshly-created tracker-mode ticket guards against the orphan-duplicate failure mode an earlier smoke surfaced: the create call returned a Gateway-Timeout while the server-side write succeeded, the single-shot JQL idempotency probe missed the eventual-consistency window, and the retry created a second stub ticket the chain never references. The retry path now widens the idempotency window — on a network-error response (Gateway-Timeout / 504 / connection reset / equivalent) before falling through to a fresh create, **retry the JQL idempotency probe with backoff (canonical schedule `1s + 2s + 4s`, three attempts)**. The existing single-shot probe stays as the fast path (no extra latency on the success path). If any backoff probe finds the original write, no duplicate create is issued and the retrieved ticket id is returned. If all three backoff attempts still miss, fall through to a fresh create (the genuine duplicate-create scenario where the original write actually failed server-side) AND surface a one-line warning row in the Step 7 summary table using the `tracker_idempotency_uncertain` capability key — the operator needs to manually verify before downstream skills bind to the new id. The same contract applies symmetrically to Linear's `save_issue` (Gateway-Timeout class of failure mode is shared); see `adapters/jira.md` § `upsert_ticket_metadata` and `adapters/linear.md` § `upsert_ticket_metadata` for adapter-side detail.

   **Milestone attachment (Linear-only).** After `Provider.sync(spec)` returns the freshly-allocated tracker ID, read the FR's `milestone:` frontmatter and call `planFileHeadingToMilestoneName(specs/plan/<milestone>.md)` from `adapters/_shared/src/attach_project_milestone.ts` to derive the canonical milestone name (anchor stripped). Then call `attachProjectMilestone(provider, project, canonicalName, ticketId)` to bind the ticket. Failure surfaces as `MilestoneAttachmentError` (NFR-10 canonical shape) — the FR file is not rolled back since the spec is the source of truth. **Capability outcome routing (STE-198):** `attachProjectMilestone` returns `{ capability, createdName? }`. Branch on `result.capability` — `null` ⇒ no row; `"milestone_create_required"` ⇒ helper auto-created via `mcp__linear__save_milestone` (same auth scope as the prior `save_issue`, no extra prompt) — surface the row naming `result.createdName`; `"milestone_attach_skipped_adapter_limit"` ⇒ adapter Schema M `project_milestone: false` short-circuited the call. Vacuous on `mode: none`.
5. **Post-write self-checks.** Immediately after `Provider.sync(spec)` returns (so the tracker-id is bound), run **both** in-band checks against the just-written file before `/spec-write` returns clean:
   - Call `runFrontmatterShapeCheck(projectRoot, frFilePath)` from `adapters/_shared/src/fr_frontmatter.ts`. Throws `FRFrontmatterShapeError` (NFR-10 canonical shape) when the bimodal-identity logic flags the file — the LLM hand-rolled YAML, mutated state, or the helper has a bug. Refusal halts `/spec-write` before the file leaves a clean signal to downstream skills.
   - Call `scanGuessedTrackerIdLiterals([frFilePath, specs/requirements.md])` from `adapters/_shared/src/guessed_tracker_id_scan.ts`. Any returned violation is a literal `AC-<digit>.<N>` placeholder that survived substitution; refuse with NFR-10 canonical shape (use the violation's own `message` field, which is already canonical), naming `file:line:column` + the offending token + remedy `substitute <tracker-id> via acPrefix(spec) and retry`.

   The `/gate-check` probes `identity_mode_conditional` and `guessed_tracker_id` stay as the safety net for paths that bypass `/spec-write` (manual edits, copy-paste from old templates, downstream toolkit consumers).
6. Never write to `specs/requirements.md` — that file is slimmed to cross-cutting content only.

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

#### requirements.md (WHAT to build — cross-cutting only)

**Scope: cross-cutting only.** `specs/requirements.md` captures concerns that span multiple FRs — auth scheme, observability surface, tenancy model, accessibility posture, etc. Per-FR detail lives in `specs/frs/<id>.md` exclusively. When `/spec-write` is invoked on a per-FR feature, route the work straight to `specs/frs/` (per § 0b) and **do NOT touch `specs/requirements.md`**. The `requirements-md-no-placeholder` gate probe (gate-check #29) flags any `### FR-N: [Feature Name]` heading that survives in `requirements.md` as drift. **STE-227 `--no-tech`:** the flag does not affect this cross-cutting flow; only the per-FR `technical-spec.md` + `testing-spec.md` interviews below are skipped (the FR body's `## Technical Design` and `## Testing` sections are written as placeholder lines per § 0b's preamble; the technical reviewer fills them via `/spec-write <FR-id>`).

Only fire the per-section flow below when the user is filling in **genuinely cross-cutting** requirements — typically the first time `/spec-write` runs on a new project, or when an architectural concern emerges that affects multiple FRs.

Ask the questions in this order, one at a time. Wait for each answer before asking the next — do not bundle them into a single turn even when the user is responsive.

Ask what this project is, who it is for, and what problem it solves. Wait for the answer. Then ask what cross-cutting functional requirements exist (auth, observability, accessibility, tenancy — anything that spans multiple FRs). Wait for the answer. Then ask what is explicitly out of scope (project-wide, not per-FR). Wait for the answer. Then ask whether there are any non-functional requirements (performance, security, accessibility).

Per-feature acceptance criteria are NOT collected here — those go in `specs/frs/<id>.md` via § 0b's FR creation path. If the user names a specific feature, branch into the FR-creation flow rather than expanding § 2 in `requirements.md`.

Write the answers into the spec using the template structure with per-AC prefixes derived via `acPrefix()` (tracker ID in tracker mode, short-ULID tail in `mode: none`). AC lines take the shape `AC-<PREFIX>.<N>: ...`.

**Stable anchor IDs:** Every `### <PREFIX>:` heading you generate or edit must carry its `{#<PREFIX>}` anchor on the same line, matching the template form `### <tracker-id>: User login {#<tracker-id>}` (tracker mode) or `### VDTAF4: User login {#VDTAF4}` (`mode: none`). Same rule applies in `plan.md` for `## M{N}: ...` headings — the `{#M{N}}` anchor must be present. These anchors are the pointer targets for archival and for cross-references in the traceability matrix, so they must survive heading renames. If you encounter any milestone or FR heading without its anchor, **flag it as a warning** in the report (step 7) and offer to add it — never silently edit around it.

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

**Milestone-number allocation guard.** Before claiming any new `M<N>`, call `nextFreeMilestoneNumber(specsDir, changelogPath)` from `adapters/_shared/src/next_free_milestone_number.ts`. The helper does the three-way scan (active `specs/plan/`, archived `specs/plan/archive/`, CHANGELOG `M<N>` references) and returns `{ next, sources }`. Use `next` as the canonical default. If the user explicitly typed an `M<N>` argument that appears in any of the three source sets, **refuse with NFR-10 canonical shape** showing all three breakdowns and the proposed next free number. Never trust a partial `ls` output and never trust LLM memory: the helper is the single source of truth.

**Task Sizing:** generated tasks must follow the Task Sizing guidance in `templates/spec-templates/plan.md.template` — each task ≈ one commit's worth of work, written as a 2-line entry (action line + indented `verify:` line). If you can't name a single verification step, split the task. See the template's anti-pattern callout for examples of tasks that are too large.

Present the plan and ask for approval.

### 4. Review and confirm

After completing each spec file: show the user what was written, ask for approval before saving, note any open questions or decisions that need human input.

**Draft + commit acceptance gates — marker-driven default-apply (STE-213, STE-220, STE-226).** Two gates live in this skill: the FR-draft `Approve and proceed?` gate at § 0b step 4 (gates tracker create + FR file write), and the commit `Apply commit?` gate at § 7a (gates the spec commit). Both **default-apply `y` when the prompt body contains the literal line `<dpt:auto-approve>v1</dpt:auto-approve>` (byte-grep, no inference)** — **MUST emit `spec_write_draft_default_applied`** and **MUST emit `spec_write_commit_default_applied`** respectively (literal tokens, not paraphrased — STE-238 AC.1; the two rows are co-located in the static map at § 7). Interactive `n` decline at either gate **MUST emit** the corresponding `_declined` row (literal token). The marker contract (paste, not paraphrase) is byte-repeated at all three gate sites — § 0b step 4, here, and § 7a — so the LLM reading any single site has the full contract in view. STE-226 replaces STE-213 + STE-220's prose-only detection (legacy `Auto Mode Active` system-reminder match + `claude -p` non-interactive inference, both falsified end-to-end across four smoke runs) with this byte-checkable marker; legacy detection is removed, the marker is the single deterministic mechanism, and callers without the marker get interactive gating (no backward-compat shim per `project_no_users_yet`). **Universal pre-commit branch gate (STE-228):** § 7a additionally calls `requireCommittableBranch({...})` from `adapters/_shared/src/require_committable_branch.ts` with the name from `branchNameFor(...)` at `skills/spec-write/branch_name_for.ts` (new-FR delegates to `buildBranchProposal`; cross-cutting-only → `docs/specs-cross-cutting`); outcomes `created`/`edited` → `git checkout -b`; `declined` → `git reset HEAD <paths>` rollback + non-zero exit; `no-op` for off-trunk OR `commitType ∈ TRUNK_OK_TYPES = ["ci"]`; auto-mode default-apply via the same marker; capability rows `branch_gate_*` per STE-228 § Branch-name canonical table. **Branch-gate literal tokens for every outcome path (STE-238 AC.2).** Each outcome MUST emit the matching literal token (backticked) into the Step 7 closing summary:

- gate creates branch interactively ⇒ **MUST emit `branch_gate_created`**.
- edited proposal accepted ⇒ **MUST emit `branch_gate_edited`**.
- declined ⇒ **MUST emit `branch_gate_declined`**.
- marker-driven auto-apply with branch creation ⇒ **MUST emit `branch_gate_default_applied`**.
- gate short-circuits because operator was already off-trunk ⇒ **MUST emit `branch_gate_skipped_already_non_main`** (NEW token added to the static map at § 7 under STE-238 AC.6).
- remote-probe failure ⇒ **MUST emit `branch_gate_remote_probe_skipped`**.

The literal token is the byte-checkable signal `/gate-check`'s `closing_summary_capability_keys` probe greps for; narrative prose like "the gate auto-created the branch" is insufficient.

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
| technical-spec.md | `<tracker-id>` has no architecture section | Add data model for user preferences |
| plan.md | M2 references removed `AC-<tracker-id>.1` | Remove or replace with `AC-<tracker-id>.2` |

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
| **Unclear acceptance criteria** | <!-- e.g., AC-<tracker-id>.1 is subjective --> | high / medium / low | <!-- e.g., Add measurable threshold --> |

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

### 7a. Stage spec changes and prompt for commit

After Steps 0–6 settle and before Step 7 emits the closing summary, `/spec-write` stages every file it wrote under `specs/` and produces **one commit per `/spec-write` invocation** — STE-179 closes the gap that widened `setup-bootstrap-committed` to `toolkit-bootstrap-committed`. Subjects (Conventional Commits): **new-FR run** ⇒ `chore(specs): write FR <tracker-id>` (tracker mode) or short-ULID stem (`mode: none`); **cross-cutting-only run** (pure `requirements/technical-spec/testing-spec/plan/M<N>.md` edits, no new FR) ⇒ `docs(specs): edit cross-cutting specs`; **hybrid** ⇒ new-FR shape (cross-cutting edits land in the same commit). Procedure: stage explicit path list (never `git add -A`) → diff preview → prompt `Apply commit "<subject>"? [y / n / edit]`.

**Marker-detection (STE-262 AC-STE-262.2 — deterministic, runtime byte-grep).** The literal byte-string `<dpt:auto-approve>v1</dpt:auto-approve>` is the marker the runtime helper detects. Before evaluating the commit-gate auto-apply branch, write the verbatim first user message that invoked `/spec-write` to `/tmp/dpt-spec-write-prompt-body.txt` (Bash heredoc, FIRST step of commit-gate evaluation; if the file already exists from the § 0b step 4 draft gate of the same invocation, reuse it as-is — same body, same decision), then run:

```bash
bun run plugins/dev-process-toolkit/adapters/_shared/src/check_marker_runtime.ts /tmp/dpt-spec-write-prompt-body.txt
```

The script prints `PRESENT` or `ABSENT` on a single line. **Branch strictly on the script's stdout** — the script's output is the single deterministic gate decision; no LLM inference, no autonomous-mode reminder, no "work without stopping" framing influences the auto-apply branch.

- `PRESENT` → call `requireOrRefuse(..., markerPresent: true, defaultValue: "y", ...)` → outcome `default-applied` → commit with the canonical subject (STE-109 UX) → **MUST emit `spec_write_commit_default_applied`** (literal token, not paraphrased — STE-238 AC.1) as a row in the Step 7 summary so the operator sees the auto-apply on every quiet-mode run (interactive `y` does not emit the row).
- `ABSENT` + `process.stdin.isTTY === false` → call `requireOrRefuse(..., markerPresent: false, defaultValue: "y", userSuppliedValue: undefined, ...)`. The helper falls through to the refusal branch and throws `RequiresInputRefusedError` (NFR-10 canonical shape) naming the gate site (`commit`); the skill exits non-zero with files staged-but-uncommitted so the operator can re-invoke interactively (or with the marker) without losing work.
- `ABSENT` + `process.stdin.isTTY === true` → fire interactive `[y / n / edit]` prompt; on `y` proceed; on `n` files remain staged-but-uncommitted, **MUST emit `spec_write_commit_declined`** (literal token) so the operator knows to `git commit -m "<subject>"` manually.

**Marker is the single deterministic mechanism (STE-226 + STE-262):** legacy prose-only detection paths are removed; the runtime byte-grep above is the single decider. On commit failure (Conventional-Commits hook rejection, etc.) → NFR-10 canonical refusal; staged files left in place for the operator to fix and re-issue.

### 7. Report

`/spec-write` **MUST emit** a closing summary on every successful run, regardless of mode (`linear` / `jira` / `none`) or invocation path (new-FR creation, the `importFromTracker` import path on a tracker-id resolve miss, or a per-section edit). This is unconditional — non-interactive `-p` mode is **not** an exception.

**Non-interactive / `-p` mode firing rule.** The summary fires **even when no questions were asked** — the silent path on a `claude -p /spec-write …` invocation that resumes an already-bound FR or runs every prompt with auto-supplied answers MUST still emit the closing summary block on the quiet path. An earlier Linear smoke caught the regression where `claude -p` runs produced 1 byte of stdout because the LLM short-circuited Step 7 when the run had no user-facing prompts. The unconditional-emit contract above governs both the interactive path and the quiet `-p` path with no exception. If the run reaches a successful exit, the summary block emits — even on a no-question run, even on `-p` non-interactive mode, even when the only side effect was a frontmatter edit. The `>=100 byte` floor below is the regression signal that the summary fired at all.

Reference shape — emit at minimum the three required signals (one row per FR touched, one row per spec file edited):

```
## /spec-write summary

| FR id      | FR file path                | Milestone |
|------------|-----------------------------|-----------|
| <STE-XXX>  | specs/frs/STE-XXX.md        | M<N>      |
| <VDTAF4>   | specs/frs/VDTAF4.md         | M<N>      |  <!-- mode: none renders the short-ULID -->

| Spec file              | Change          |
|------------------------|-----------------|
| specs/plan/M<N>.md     | row added/updated |
| specs/technical-spec.md| edge case backfilled |

Open questions / risks / inconsistencies (if any):
- Which specs are done vs. still need work
- Inconsistencies resolved or still pending
- Risks identified (severity)
- Open questions flagged during the process

Next: Run `/dev-process-toolkit:implement <tracker-id>` when specs are ready.   <!-- new-FR run: recommend the FR-id form (most common, single-FR ship). -->
Next: Run `/dev-process-toolkit:implement <milestone>` when specs are ready.   <!-- cross-cutting-only run (no new FR): recommend the M<N> form (milestone close). -->
```

**Next-line variant rule.** When the run created a single new FR, recommend the FR-id form (`Run /dev-process-toolkit:implement <tracker-id>`) — that's the canonical "ship one FR" path per `skills/implement/SKILL.md` § Invocation forms (STE-181). When the run only edited cross-cutting specs (no new FR file written), recommend the M<N> form (`Run /dev-process-toolkit:implement M<N>`) — the operator is presumably finishing a milestone. Hybrid runs (new FR + cross-cutting edit) follow the new-FR shape.

**Capability-gap rendering.** The "Open questions / risks / inconsistencies" block must render every capability gap as **plain prose**, drawn from the static plain-language map below — never as a literal `AC-<tracker-id>.<N>` reference into this toolkit's own internal spec set. The toolkit's AC IDs are opaque jargon to project owners running `/spec-write` on their own repo (a 2026-04-28 smoke caught the regression: a toolkit-internal AC identifier for the milestone-attach capability surfaced as the rendered description of the gap, replacing what should have been plain prose). Echoing such an identifier inside this section's instructions is itself a regression risk — the LLM may copy it back into the rendered summary; describe failure modes by capability name only.

Static plain-language map (capability key ⇒ rendered prose):

| Capability key | Rendered prose |
|----------------|----------------|
| `milestone_attach_skipped_adapter_limit` | `tracker adapter does not support project_milestone — milestone-attach skipped` |
| `milestone_attach_unavailable` | (deprecated alias of `milestone_attach_skipped_adapter_limit` per STE-198 AC.4 — same rendered prose; both keys honored for one minor-version cycle, then this row drops) |
| `milestone_create_required` | `tracker project had zero milestones; created <milestone-name> and attached the FR` |
| `workspace_binding_deferred` | `tracker workspace binding deferred — <MCP> unregistered at /setup time; run /setup --resume-tracker-binding after authenticating` |
| `tracker_skipped` | `tracker step skipped (--code-only flag or pre-flight probe failed) — re-run without flag once MCP loadable to sync` |
| `requires_input_refused` | `step 7b refused — invocation lacked --tracker=<mode> pre-bake; remedy: re-invoke with the flag, or run interactively` |
| `plan_only_archival` | `milestone archived plan-only — no FRs in scope` |
| `docs_default_applied` | `## Docs autonomous default applied — <flag-list> (no pre-baked answers; re-run /setup --migrate to change)` |
| `tracker_sync_failed` | `tracker sync failed — local edits saved, push deferred (re-run /spec-write to retry)` |
| `push_ac_unsupported` | `tracker adapter does not support push_ac_toggle — gate-check will skip the push step` |
| `import_acs_empty` | `imported ticket had zero ACs — TODO marker added to the new FR` |
| `workspace_binding_missing` | `tracker workspace binding absent — ticket landed without team/project association` |
| `tracker_idempotency_uncertain` | `idempotency probe still ambiguous after backoff retry — possible duplicate ticket; operator should manually verify before downstream skills bind to the new id` |
| `filename_policy_override` | (a) no user override: `FR filename derived from tracker policy (Provider.filenameFor) → <filename> (no user override)` <br>(b) user override: `FR filename derived from tracker policy (Provider.filenameFor) → <filename> (overrode user-proposed: <user-name>)` |
| `simplify_tree_dirty` | `tree dirty after /simplify — modified files: <list>; run /pr or git commit to land the simplification` |
| `spec_write_draft_default_applied` | `/spec-write FR-draft auto-approved (marker `<dpt:auto-approve>v1</dpt:auto-approve>` present in prompt body) — verify the draft via specs/frs/<id>.md before /implement` |
| `spec_write_draft_declined` | `/spec-write FR-draft acceptance declined — files not written; re-invoke to retry` |
| `spec_write_commit_default_applied` | `/spec-write commit auto-approved (marker `<dpt:auto-approve>v1</dpt:auto-approve>` present in prompt body) — verify diff via git show before /implement` |
| `spec_write_commit_declined` | `/spec-write commit declined — files remain staged, run git commit -m "<subject>" to finish manually` |
| `fr_needs_technical_review` / `fr_technical_review_cleared` | flagged: `FR <id> needs_technical_review — technical + testing sections are placeholders; run /spec-write <id> (no flag) to complete before /implement.` cleared: `FR <id> needs_technical_review flag cleared — technical + testing sections completed.` |
| `needs_technical_review_label_unsupported` / `implement_refused_needs_technical_review` | unsupported: `tracker adapter does not support label push — needs-technical-review label not applied; flag visible only via FR frontmatter.` refused: `/implement refused — <list of FR ids> flagged needs_technical_review. Run /spec-write <id> (no flag) for each, then re-invoke.` |
| `branch_gate_*` (`created` / `edited` / `declined` / `default_applied` / `remote_probe_skipped` / `skipped_already_non_main`) | created: `gate created branch <branchName> — commit will land there`. edited: `gate accepted operator-supplied branch name <branchName>`. declined: `gate declined — skill exited non-zero with zero side effects (no commit, no staging mutation)`. default_applied: `gate auto-created branch <branchName> (auto-mode / -p) — verify before push`. remote_probe_skipped: `gate could not probe remote branches (offline / no remote / fetch timeout) — local-only collision check used; verify name is unique on remote before push`. skipped_already_non_main: `gate skipped — operator already off-trunk on <branch>; commit landing here per branch-isolation preference (no new branch created)` (STE-238 AC.6) |
| `report_issue_default_applied` / `report_issue_declined` / `report_issue_redacted_payload` | default_applied: `/report-issue gist auto-pushed (marker present in prompt body) — verify the gist contents before sharing`. declined: `/report-issue gist declined — temp directory deleted, no upload`. redacted_payload: `/report-issue scrubbed <N> secret-pattern match(es) before upload — see metadata.json for breakdown` |
| `spec_research_invoked` / `spec_research_no_matches` / `spec_research_shape_violation` | invoked: `/spec-research returned <N> related FRs from <M> scanned (active + archived) — context block injected into parent skill`. no_matches: `/spec-research scanned <M> FRs (active + archived); zero topic matches — empty block injected into parent skill`. shape_violation: `/spec-research output failed shape check (sections / line cap / banner) — block dropped, parent skill proceeds without seed` |

> Annotation: scope = `filename_policy_override` only. Render variant (a) when the resolver-entry context contains no user-proposed filename (the common pre-baked-stub path — no filename hint in the user's prompt); render variant (b) when the user explicitly proposed an alternative (e.g., the prompt typed `specs/frs/foo.md`). The row fires on both variants — only the prose differs. `mode: none` is exempt entirely (no policy-override surface; see the Filename-policy override row paragraph below). `<filename>` substitutes the actual `Provider.filenameFor(spec)` output (e.g., `STE-179.md` for Linear, `DST-6.md` for Jira); `<user-name>` substitutes the user-proposed filename verbatim.

Add new keys to this map when a new capability gap surfaces; do **not** invent ad-hoc prose at runtime, and do **not** substitute the toolkit's `AC-<tracker-id>.<N>` ID for the capability key. The map is the single source of truth for capability-gap rendering — bullet bodies are byte-identical across runs. **Toolkit-meta vs. user-authored AC IDs.** The scrub rule above applies **only** to this toolkit's own internal AC identifiers (`AC-<tracker-id>.<N>` references the skill code itself emits about the toolkit's own spec set). User-authored AC references in the active project's FR markdown bodies — legitimate `AC-<bound-tracker-id>.<N>` entries written by the project owner during the session — pass through **unchanged**: they are the user's content, not toolkit-meta jargon. If `/spec-write` is editing an FR file and the user's prose cites a downstream-project AC like `AC-XYZ-200.3` as a cross-reference, that reference is preserved verbatim in the rendered summary. The distinguishing test: toolkit-meta IDs are emitted by the skill code; user-authored IDs originate in FR bodies.

**Size floor.** The summary must be >=100 bytes on stdout — the smoke-test driver guards this via `wc -c` on the captured log. The two-table-plus-prose shape above clears that floor naturally; do not collapse to a single line. The byte floor is the regression signal that Step 7 fired at all (a prior version of the prose said "Summarize what was completed" and `-p` mode silently skipped the summary, leaving stdout at 1 byte).

**Filename-policy override row.** In tracker mode, every successful run that creates a new FR or imports one via `importFromTracker(...)` MUST surface a `filename_policy_override` row in the closing summary's open-questions block — **regardless of whether the user proposed an alternative filename**. The row exists so the operator sees, on every run, that `Provider.filenameFor(spec)` (e.g., `<TKR>-NN.md` for Linear, `DST-NN.md` for Jira) is the authoritative filename source rather than any user-facing name they typed in conversation. An earlier Jira smoke caught the regression where the override was only mentioned when the user's prompt happened to carry an explicit alternative filename; this rule fires the row on every tracker-mode FR write so the signal is unconditional. **`mode: none` is exempt** — the short-ULID stem is local-mint via `Provider.mintId()`, never policy-overridden, so the row is absent on local-mint runs (it would be misleading; there is no override to surface).

**Import-path coverage.** When `importFromTracker(...)` ran (resolver step 0a `tracker-id`/`url` + `findFRByTrackerRef` miss), the imported FR appears in the summary table just like a freshly-created one — the operator must see which tracker ID landed in `specs/frs/` without filesystem inspection. The summary is the per-skill console-status contract that `/setup`, `/implement`, `/gate-check`, `/spec-review`, and `/simplify` all honor; `/spec-write` was the outlier until the closing-summary contract was added.

## Rules

- Ask one clarifying question per turn. Wait for the answer before asking the next. This rule holds at phase transitions too — when two questions look independent, still ask the first, wait, then ask the second. See `docs/patterns.md § Pattern 26: Socratic Prompting {#pattern-socratic-prompting}` for the canonical rule.
- **Socratic Loop Contract (STE-237).** Every clarifying Q in this skill — § 1–§ 6 requirement / AC / technical / testing interview prompts — MUST be emitted as an `AskUserQuestion` tool call (closed-form options OR open-ended with the always-on `"Other"` free-form fallback), regardless of the autonomous-mode reminder, the auto-approve marker, or pre-baked `<command-args>` prose. Bare-prose Qs are forbidden. The first-turn contract additionally forbids `Write` / `Edit` / `NotebookEdit` tool calls before the first `AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise; `Read` / `Grep` / `Glob` / `Bash`-read-only orientation is allowed. See `docs/auto-mode-protocol.md § Socratic Loop Contract` for the full contract.
- Work through specs in precedence order (requirements → technical → testing → plan); each later spec should reference and build on earlier ones
- Ask the user for domain knowledge (don't invent requirements); pre-fill technical details from the codebase and CLAUDE.md where possible
- Present drafts for approval before saving — specs are the source of truth
- Keep acceptance criteria binary (pass/fail, not "good enough")
- Do NOT narrate a specific unallocated tracker ID (e.g., `<TKR>-NN`) in conversation when drafting — use the literal placeholder `<tracker-id>` (or the adapter rendering: `STE-<N>` for Linear, `PROJ-<N>` for Jira) until the tracker allocator returns the real ID. The placeholder rule for draft files is documented in `/spec-write` § 0b "Draft with placeholder"; this rule covers the conversational hazard that file-level probes cannot catch.
