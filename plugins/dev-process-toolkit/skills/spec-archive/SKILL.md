---
name: spec-archive
description: Manually archive a specific FR, milestone, or tracker-mapped ticket by moving the FR file(s) into `specs/frs/archive/` (and optionally the plan file into `specs/plan/archive/`) with a diff approval gate. Operates only on user-selected units resolved via ULID, tracker ID/URL, or `M<N>` — never auto-scans. Use when /implement Phase 4 auto-archival can't reach content (reopened milestones, cross-cutting FRs, aborted work, explicit user-directed compaction).
argument-hint: '<ULID, tracker ID, tracker URL, or M<N>>'
---

# Spec Archive

Archive the user-selected FR(s) identified by `$ARGUMENTS`. This is the **escape hatch** for situations `/implement` Phase 4 auto-archival can't reach. It never scans the spec files for completed milestones or checked-box ACs — the caller must name what to archive.

## Process

### 0. Layout + tracker-mode probes

Before any other step:

- **Layout probe** — Read `specs/.dpt-layout` via `bun run adapters/_shared/src/layout.ts`. `version: v2` is the only supported layout. If marker absent with `specs/requirements.md` present, exit with the canonical pointer to `/setup --migrate` (AC-STE-29.5). If version > v2, exit with the canonical message (AC-STE-29.3).
- **Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. Tracker-mode `/spec-archive` still operates only on local `specs/` content — archival of completed **tracker tickets** is the tracker's own concern.

### 0a. Resolver entry (AC-STE-33.1)

After the layout probe, call `buildResolverConfig(claudeMdPath, adaptersDir)` from `adapters/_shared/src/resolver_config.ts` once at entry (STE-44 AC-STE-44.5), then pass the result to `resolveFRArgument($ARGUMENTS, config)` from `adapters/_shared/src/resolve.ts`. Malformed adapter metadata surfaces as `MalformedAdapterMetadataError` → NFR-10 canonical refusal (AC-STE-44.6).

- **`ulid`** → archive that single FR (step 1).
- **`tracker-id` / `url`** + `findFRByTrackerRef` hit → resolve to the ULID and archive that single FR (AC-STE-33.3). No import, no tracker network call.
- **`tracker-id` / `url`** + `findFRByTrackerRef` miss → **refuse** with the NFR-10 canonical error: `"No local FR mapped to <tracker>:<id>. Archival never auto-imports. To dismiss the tracker ticket, close it in the tracker directly."` Exit non-zero. No side effects. `/spec-archive` **never** auto-imports (AC-STE-33.4).
- **`fallthrough`** and `$ARGUMENTS` matches `^M\d+$` → batch archival of every FR with `milestone == <M<N>>` plus the plan file (step 1). `/spec-archive M12` is the canonical group form.
- **`fallthrough`** otherwise → refuse and prompt the user for a valid ULID / tracker ref / `M<N>` (AC-STE-33.5, AC-STE-33.6, NFR-18).
- `AmbiguousArgumentError` → surface per NFR-10 with the `<tracker>:<id>` disambiguation remedy; exit non-zero.

Full decision table: `docs/resolver-entry.md`.

### 1. Archival procedure (v2 primitives, STE-22)

Archival uses the same code path as `/implement` Phase 4.

**Single-FR archival** (argument resolved to one ULID):

1. Read `specs/frs/<ulid>.md`; verify frontmatter `status: active` or `status: in_progress`.
2. Present the Diff Preview (§ Diff Preview below) — the filename move, the frontmatter flip, and any `Provider.releaseLock` call.
3. On explicit approval:
   - `git mv specs/frs/<ulid>.md specs/frs/archive/<ulid>.md` — filename stem preserved (AC-STE-18.4).
   - Flip frontmatter `status: active` → `status: archived`; set `archived_at: <ISO now>`.
   - `Provider.releaseLock(<ulid>)` (AC-STE-28.4). In tracker mode this transitions the ticket to `done`; in tracker-less mode it removes the in-flight lock file.
   - All of the above land in a single atomic commit (AC-STE-22.2).
4. Regenerate `specs/INDEX.md` via `regenerateIndex(specsDir)` — the archived FR drops out of the default index (AC-STE-22.3).
5. Run the Post-Archive Drift Check (§ Post-Archive Drift Check below).

**Milestone-group archival** (argument is `M<N>`):

1. Scan `specs/frs/*.md` for every FR with frontmatter `milestone == M<N>`. Refuse cleanly if the match set is empty ("No active FRs found for milestone M<N>"); exit non-zero, no side effects.
2. Build the batch:
   - One `git mv` + frontmatter flip + `Provider.releaseLock` per matched FR.
   - If `specs/plan/M<N>.md` exists, include `git mv specs/plan/M<N>.md specs/plan/archive/M<N>.md` (AC-STE-21.5).
3. Present the Diff Preview covering every move + flip + release.
4. On approval, land all N moves + N flips + N `releaseLock` calls + the optional plan-file move in a **single atomic commit** (AC-STE-22.6). Any error aborts the commit entirely — no partial archival.
5. Regenerate `specs/INDEX.md` (AC-STE-22.3).
6. Run the Post-Archive Drift Check.

No skill writes to files under `specs/frs/archive/` or `specs/plan/archive/` except the frontmatter `status` flip at move time (AC-STE-22.5). Full reference: `docs/v2-layout-reference.md` § `/spec-archive`.

### 2. Technical-spec.md — never archive

`specs/technical-spec.md` holds ongoing architectural truth, not shippable work. Architectural decisions are marked `Superseded-by: FR-<N>` in place — that matches the ADR convention (adr.github.io, Nygard) and preserves the decision trail where future implementers look for it. `/spec-archive` does not edit `technical-spec.md`. If the user asks to "archive" an ADR, direct them to supersede it in place instead.

### Diff Preview

Before any filesystem change, render a diff preview the user can confirm or reject. For single-FR archival:

```
--- specs/frs/<ulid>.md  →  specs/frs/archive/<ulid>.md  (git mv)
@@ frontmatter @@
-status: active
-archived_at: null
+status: archived
+archived_at: 2026-04-22T15:00:00Z

--- Provider.releaseLock(<ulid>)
+++ (tracker mode: transition_status → done)
+++ (tracker-less: rm .dpt-locks/<ulid>)

--- specs/INDEX.md  (regenerated — this FR row removed)
```

For milestone-group archival, list each `git mv`, each frontmatter flip, each `releaseLock`, and the optional plan-file move explicitly. Do not summarize — the user must be able to read the full plan and confirm or reject.

**Approval gate:** do NOT perform any `git mv`, frontmatter write, or `releaseLock` until the user explicitly approves. If the user rejects, asks for changes, or is ambiguous, stop and restart at step 0a with their feedback.

### Reopening an Archived FR

If the user reopens an archived FR (e.g., they discover post-ship rework is needed), the canonical path is to `git mv specs/frs/archive/<ulid>.md specs/frs/<ulid>.md` and flip `status: archived` → `status: active` with `archived_at: null`. This is NOT a `/spec-archive` operation — reopens are performed by the user directly or by `/spec-write` on the reopened FR. The ULID is stable across open/archive cycles (NFR-15); no revision-suffix mechanism is required.

## Post-Archive Drift Check

After the archive move(s) and `INDEX.md` regeneration complete, and before the final report, run a two-pass drift check against the live spec files. The drift check is **advisory only** — it never auto-rewrites narrative and never blocks the archival operation itself.

### Pass A — Token grep (deterministic)

Grep `specs/requirements.md`, `specs/technical-spec.md`, `specs/testing-spec.md`, and every `specs/plan/*.md` (excluding `specs/plan/archive/**`) for the exact identifiers just archived. Search literally for `M{N}`, `FR-{N}` (if still referenced by legacy FR numbers in prose), and `AC-{N}.` patterns (the trailing dot anchors the AC token).

Every hit is an orphan token reference: the live spec names content that no longer lives in the active tree. Pass A findings are `high` severity. Pass A runs **before** Pass B and its rows appear first in the unified report so deterministic findings are reviewed before judgment findings.

### Pass B — Semantic scan (judgment)

Read each live spec file in turn with the following brief:

- **(a) Archived ID list:** the ULIDs (and/or milestone ID) just archived in this operation.
- **(b) Archive excerpt:** a one-paragraph excerpt of the archived FR's title line + requirement statement (and, for milestone archival, the plan file's goal line) — **not** the full body. Keeping the Pass B context bounded to title + goal keeps the prompt size stable regardless of archive size.
- **(c) Scope-framing instruction:** flag narrative sections whose framing assumes the archived scope is the entire project. Look for wording that labels the project by the just-archived FRs/milestones when the remaining active content contradicts that framing.

**Canary pattern:** narrative that labels the project by the archived scope. The load-bearing example is the Flutter dogfood run — archiving M1–M4 (documentation milestones) left `requirements.md` Overview calling the project a "layered documentation set" and Out-of-Scope saying "Code changes — documentation only", while M5 (a code milestone) was still in flight. Any similar framing — "documentation-only", "docs-only deliverable", "layered X set" where X is the archived scope — is the signal Pass B must catch. Pass B findings are `medium` severity.

Pass B is inherently subjective; the canary example bounds the judgment but edge cases will vary between runs. False positives are accepted as the cost of catching semantic drift that grep cannot see.

> technical-spec.md uses Superseded-by markers, not archival — Pass B flags for this file are advisory only, never push for removal

### Unified report (Schema I)

Merge Pass A and Pass B findings into a single table following Schema I (see `specs/technical-spec.md` § 3). Pass A rows appear first, then Pass B rows.

```markdown
| File | Section | Severity | Reason | Suggested action |
|------|---------|----------|--------|------------------|
| requirements.md | §6 Traceability Matrix | high | Orphan row `AC-HG95TZ.2` references archived HG95TZ | Remove row |
| requirements.md | Overview (§1) | medium | "layered documentation set" framing assumes archived scope; contradicts in-flight M5 code milestone | Rewrite Overview to reflect current milestone mix |
```

Exactly 5 columns in the order `File`, `Section`, `Severity`, `Reason`, `Suggested action`. Exactly 2 severity values: `high` (Pass A) and `medium` (Pass B).

**Empty report:** if both passes found nothing, print the literal string `No drift detected` and continue to the final report without prompting the user.

### User choice (advisory — never blocks archival)

If the drift report is non-empty, offer the user exactly three choices:

1. **Address inline now** — walk through each flagged row, propose the edit, and wait for explicit per-edit approval. Pass A findings may be offered as mechanical deletions but still require explicit user approval; the drift check **never auto-edits narrative** based on Pass B findings.
2. **Save for later** — write the Schema I table to `specs/drift-{YYYY-MM-DD}.md` for later review. Archival completes; no narrative edits are made.
3. **Acknowledge and continue** — no file is written, no edits are made. Archival is complete.

The drift check **never blocks the archival operation itself**. The archive moves, frontmatter flips, `releaseLock` calls, and `INDEX.md` regeneration are already committed to disk by the time this check runs; the user's choice only governs what happens to the drift report.

## Rules

- This skill operates ONLY on user-selected units (ULID, tracker ref, or `M<N>`). Never auto-scan live specs for "done" milestones, checked boxes, or completion heuristics.
- Always present the diff preview and wait for explicit approval before any `git mv`, frontmatter write, or `releaseLock` call.
- Every archival lands in one atomic commit (single FR or milestone group).
- Tracker-ref miss → refuse and exit; never auto-import to archive.
- Never edit `specs/technical-spec.md` — ADRs use `Superseded-by:` in place.
- Never write under `specs/frs/archive/**` or `specs/plan/archive/**` except the `status` / `archived_at` frontmatter flip at move time (AC-STE-22.5).
- Call `Provider.releaseLock(id)` for every archived FR (AC-STE-28.4).
- Regenerate `specs/INDEX.md` after every archival operation (AC-STE-22.3).
