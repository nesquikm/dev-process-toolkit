---
name: spec-archive
description: Manually archive user-selected FRs or milestones by `git mv` into `specs/frs/archive/` (and optionally `specs/plan/archive/`) with a diff approval gate. Accepts ULID, tracker ID/URL, or `M<N>`. Escape hatch for /implement Phase 4 auto-archival gaps.
argument-hint: '<ULID, tracker ID, tracker URL, or M<N>>'
---

# Spec Archive

Archive the user-selected FR(s) identified by `$ARGUMENTS`. This is the **escape hatch** for situations `/implement` Phase 4 auto-archival can't reach. It never scans the spec files for completed milestones or checked-box ACs — the caller must name what to archive.

## Process

### 0. Layout + tracker-mode probes

Before any other step:

- **Tracker-mode probe** — Run the Schema L probe (see `docs/patterns.md` § Tracker Mode Probe). If `CLAUDE.md` has no `## Task Tracking` section, mode is `none`. Tracker-mode `/spec-archive` still operates only on local `specs/` content — archival of completed **tracker tickets** is the tracker's own concern.

### 0a. Resolver entry

Call `buildResolverConfig(claudeMdPath, adaptersDir)` from `adapters/_shared/src/resolver_config.ts` once at entry, then pass the result to `resolveFRArgument($ARGUMENTS, config)` from `adapters/_shared/src/resolve.ts`. Malformed adapter metadata surfaces as `MalformedAdapterMetadataError` → NFR-10 canonical refusal.

- **`ulid`** → archive that single FR (step 1).
- **`tracker-id` / `url`** → branch on mode: tracker mode uses `findFRPathByTrackerRef(specsDir, trackerKey, trackerId)` (path-returning, no `id:` requirement); `mode: none` uses `findFRByTrackerRef(specsDir, trackerKey, trackerId)` (ULID-returning). The tracker-mode helper is the canonical lookup — `findFRByTrackerRef` would always miss in tracker mode (no `id:` line) and trigger the refuse branch below against an FR that exists on disk.
  - Hit → archive that single FR. No import, no tracker network call.
  - Miss → **refuse** with the NFR-10 canonical error: `"No local FR mapped to <tracker>:<id>. Archival never auto-imports. To dismiss the tracker ticket, close it in the tracker directly."` Exit non-zero. No side effects. `/spec-archive` **never** auto-imports.
- **`fallthrough`** and `$ARGUMENTS` matches `^M\d+$` → batch archival of every FR with `milestone == <M<N>>` plus the plan file (step 1). `/spec-archive M12` is the canonical group form.
- **`fallthrough`** otherwise → refuse and prompt the user for a valid ULID / tracker ref / `M<N>` (NFR-18).
- `AmbiguousArgumentError` → surface per NFR-10 with the `<tracker>:<id>` disambiguation remedy; exit non-zero.

Full decision table: `docs/resolver-entry.md`.

### 1. Archival procedure

Archival uses the same code path as `/implement` Phase 4.

**Single-FR archival** (argument resolved to one ULID):

1. Locate the FR file: read the spec's frontmatter and compute its base name via `Provider.filenameFor(spec)`. Verify `status: active` or `status: in_progress`.
2. Present the Diff Preview (§ Diff Preview below) — the filename move, the frontmatter flip, and any `Provider.releaseLock` call.
3. On explicit approval:
   - `git mv specs/frs/<name> specs/frs/archive/<name>` using the `Provider.filenameFor(spec)` base — stem preserved across the move. Archival never renames.
   - Flip frontmatter `status: active` → `status: archived`; set `archived_at: <ISO now>`. **Precision: full ISO-8601 with date + time + Z (e.g., `2026-04-30T17:23:11Z`); not date-only with zeroed time.** Render the wall-clock instant via `date -u +%Y-%m-%dT%H:%M:%SZ`, never the shorter `date +%Y-%m-%d` form (it rounds to midnight UTC, which an earlier smoke caught as a regression shape).
   - **Rewrite traceability links.** Call `rewriteArchiveLinks(repoRoot, frId)` from `adapters/_shared/src/spec_archive/rewrite_links.ts`. It scans `specs/requirements.md`, every `specs/plan/*.md`, every `specs/plan/archive/*.md`, and `CHANGELOG.md` (scoped to lines above the first dated `## [X.Y.Z] — YYYY-MM-DD` header — released sections are frozen) for `frs/<id>.md` references and rewrites them to `frs/archive/<id>.md`. Both Markdown link forms (`](frs/<id>.md)` and `](./frs/<id>.md)`) and bare path mentions are covered. Orphan FRs (no references anywhere) yield an empty rewrite, no error. The rewrites land in the **same atomic commit** as the `git mv` and frontmatter flip.
   - **`specs/design/` is immutable across archival** — design-reference images under `specs/design/` are never `git mv`'d and never rewritten by `rewriteArchiveLinks`; only the spec markdown moves, the referenced images stay put.
   - `Provider.releaseLock(<ulid>)`. In tracker mode this transitions the ticket to `done`; in tracker-less mode it removes the in-flight lock file.
   - **Universal pre-commit branch gate (STE-228).** Before staging the atomic commit, call `requireCommittableBranch({ commitType: "chore", proposedBranchName, currentBranch, isAutoMode })` from `adapters/_shared/src/require_committable_branch.ts` with `proposedBranchName` returned by `branchNameFor({ kind: "fr-archive", trackerId })` from `skills/spec-archive/branch_name_for.ts` (FR archive → `chore/archive-<tracker-id>`; milestone archive → `chore/archive-m<N>`; collision-suffix per STE-228 AC-STE-228.11). On `created` / `edited` the gate runs `git checkout -b <branchName>` so the archive commit lands on the new branch; `declined` rolls back staging via `git reset HEAD <paths>` (explicit list, never `--hard`) and exits non-zero; `no-op` (off-trunk OR `commitType ∈ TRUNK_OK_TYPES = ["ci"]`) is silent. Auto-mode default-apply uses the `<dpt:auto-approve>v1</dpt:auto-approve>` marker per STE-226. See STE-228 § Branch-name canonical table for the full builder catalogue.
   - All of the above land in a single atomic commit.
4. Run the Post-Archive Drift Check (§ Post-Archive Drift Check below).

**Milestone-group archival** (argument is `M<N>`):

1. Scan every active `specs/frs/*.md` for `milestone == M<N>`. If the match set is empty, branch to **plan-only archival** (STE-200 AC-STE-200.1, see below); otherwise refuse cleanly with `"M<N> has plan with unchecked ACs and no FRs; ambiguous state"` only when the plan is present but the auto-detect heuristic does not fire.
2. Build the batch:
   - Per matched FR: `git mv specs/frs/<Provider.filenameFor(spec)> specs/frs/archive/<same-name>` + frontmatter flip + traceability-link rewrite (`rewriteArchiveLinks(repoRoot, frId)`) + `Provider.releaseLock`.
   - If `specs/plan/M<N>.md` exists, include `git mv specs/plan/M<N>.md specs/plan/archive/M<N>.md`.
3. Present the Diff Preview covering every move + flip + traceability rewrite + release.
4. On approval, land all N moves + N flips + N rewrites + N `releaseLock` calls + the optional plan-file move in a **single atomic commit**. Any error aborts the commit entirely — no partial archival. Then run the Post-Archive Drift Check.

**Plan-only archival** (STE-200 AC-STE-200.1 / AC-STE-200.2 — milestone has zero FRs in `specs/frs/`):

1. Auto-detect: when the FR match set for `M<N>` is empty AND `specs/plan/M<N>.md` exists, run the auto-detect heuristic — fire the plan-only branch when **any** of: (a) plan frontmatter `kind: scaffolding` (per STE-197), OR (b) every `^- [ ]` checkbox under the milestone's `## M<N>:` block is `[x]` (or `[deferred]`), OR (c) the operator passed `--plan-only` explicitly.
2. Run the drift Pass A grep against the live tree (live trees only — no FR rows to walk).
3. `git mv specs/plan/M<N>.md specs/plan/archive/M<N>.md` and flip the plan frontmatter `status: active → archived` with `archived_at: <ISO now>` (per STE-197 AC-STE-197.4 — synthesize a frontmatter block for legacy frontmatter-less plans).
4. Surface a `plan_only_archival` capability row in the closing summary.
5. Land in a single atomic commit; run the Post-Archive Drift Check.

`--plan-only` flag (AC-STE-200.2): forces the plan-only branch when the auto-detect heuristic would not fire (escape hatch for unusual cases). Refuse if FR match set is non-empty — `--plan-only` is for explicitly-empty cases; mixed usage is operator error. Refuse if `specs/plan/M<N>.md` does not exist with `"No FRs and no plan file for M<N>"`.

`--parked` flag (AC-STE-369.4): `/spec-archive M<N> --parked` additionally writes `ship_state: parked` into the plan's frontmatter during the archival flip (milestone-group or plan-only — any path that moves the plan file). The `+ship_state: parked` line renders inside the existing mandatory Diff Preview approval gate — no new prompt. Parking marks the milestone as deliberately unshipped: the `plan_ship_coherence` gate probe surfaces it as a `parked milestones:` NOTES row instead of a violation. Unparking happens by shipping.

**Exit hints** (milestone archival closing line): default runs end `Archived. Next: /ship-milestone M<N>`; parked runs end `Archived (parked). Unpark by shipping: /ship-milestone M<N>`.

No skill writes to files under `specs/frs/archive/` or `specs/plan/archive/` except the frontmatter flip (`status` / `archived_at`, plus `ship_state` under `--parked`) at move time. Full reference: `docs/layout-reference.md` § `/spec-archive`.

### 2. Technical-spec.md — never archive

`specs/technical-spec.md` holds ongoing architectural truth, not shippable work. Architectural decisions are marked `Superseded-by: FR-<N>` in place — that matches the ADR convention (adr.github.io, Nygard) and preserves the decision trail where future implementers look for it. `/spec-archive` does not edit `technical-spec.md`. If the user asks to "archive" an ADR, direct them to supersede it in place instead.

### Diff Preview

Before any filesystem change, render a diff preview the user can confirm or reject. For single-FR archival:

```
--- specs/frs/<name>  →  specs/frs/archive/<name>  (git mv; <name> = Provider.filenameFor(spec), stem preserved)
@@ frontmatter @@
-status: active
-archived_at: null
+status: archived
+archived_at: 2026-04-22T15:00:00Z

--- Provider.releaseLock(<ulid>)
+++ (tracker mode: transition_status → done)          — return "transitioned" when the ticket was In Progress
+++ (tracker mode: ticket already at canonical Done)  — return "already-released" (idempotent; no write)
+++ (tracker-less: rm .dpt-locks/<ulid>)              — return "transitioned" when the lock file existed
+++ (tracker-less: no lock file present)              — return "already-released" (silent no-op)
```

For milestone-group archival, list each `git mv`, each frontmatter flip, each `releaseLock`, and the optional plan-file move explicitly. Do not summarize — the user must be able to read the full plan and confirm or reject. Close the bulk Diff Preview with a single aggregate summary row naming the two `releaseLock` return counts:

```
releaseLock summary: <N transitioned, M already-released>
```

This aggregate is how the bulk path reports which FRs performed a write versus which were already terminal — the count comes free from `Provider.releaseLock`'s return value, so no extra `getTicketStatus` call is needed (NFR-8 call-budget discipline).

**Approval gate:** do NOT perform any `git mv`, frontmatter write, or `releaseLock` until the user explicitly approves. If the user rejects, asks for changes, or is ambiguous, stop and restart at step 0a with their feedback.

### Reopening an Archived FR

If the user reopens an archived FR (e.g., they discover post-ship rework is needed), the canonical path is to `git mv specs/frs/archive/<name> specs/frs/<name>` (where `<name>` is whatever `Provider.filenameFor(spec)` returns — tracker ID in tracker mode, short-ULID in `mode: none`) and flip `status: archived` → `status: active` with `archived_at: null`. This is NOT a `/spec-archive` operation — reopens are performed by the user directly or by `/spec-write` on the reopened FR. The ULID in frontmatter is stable across open/archive cycles (NFR-15); no revision-suffix mechanism is required.

## Post-Archive Drift Check

After the archive move(s) complete, and before the final report, run a two-pass drift check against the live spec files. The drift check is **advisory only** — it never auto-rewrites narrative and never blocks the archival operation itself.

### Pass A — Token grep (deterministic)

Grep `specs/requirements.md`, `specs/technical-spec.md`, `specs/testing-spec.md`, and every `specs/plan/*.md` (excluding `specs/plan/archive/**`) for the exact identifiers just archived. Search literally for `M{N}`, `FR-{N}` (if still referenced by legacy FR numbers in prose), and `AC-{N}.` patterns (the trailing dot anchors the AC token).

Every hit is an orphan token reference: the live spec names content that no longer lives in the active tree. Pass A findings are `high` severity. Pass A runs **before** Pass B and its rows appear first in the unified report so deterministic findings are reviewed before judgment findings.

### Pass B — Semantic scan (judgment)

Read each live spec file in turn with the following brief:

- **(a) Archived ID list:** the ULIDs (and/or milestone ID) just archived in this operation.
- **(b) Archive excerpt:** a one-paragraph excerpt of the archived FR's title line + requirement statement (and, for milestone archival, the plan file's goal line) — **not** the full body. Keeping the Pass B context bounded to title + goal keeps the prompt size stable regardless of archive size.
- **(c) Scope-framing instruction:** flag narrative sections whose framing assumes the archived scope is the entire project. Look for wording that labels the project by the just-archived FRs/milestones when the remaining active content contradicts that framing.

**Canary pattern:** narrative that labels the project by the archived scope. The load-bearing example is the Flutter dogfood run — archiving the documentation milestones left `requirements.md` Overview calling the project a "layered documentation set" and Out-of-Scope saying "Code changes — documentation only", while a code milestone was still in flight. Any similar framing — "documentation-only", "docs-only deliverable", "layered X set" where X is the archived scope — is the signal Pass B must catch. Pass B findings are `medium` severity.

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

The drift check **never blocks the archival operation itself**. The archive moves, frontmatter flips, and `releaseLock` calls are already committed to disk by the time this check runs; the user's choice only governs what happens to the drift report.

## Rules

- This skill operates ONLY on user-selected units (ULID, tracker ref, or `M<N>`). Never auto-scan live specs for "done" milestones, checked boxes, or completion heuristics.
- Always present the diff preview and wait for explicit approval before any `git mv`, frontmatter write, or `releaseLock` call.
- Every archival lands in one atomic commit (single FR or milestone group).
- Tracker-ref miss → refuse and exit; never auto-import to archive.
- Never edit `specs/technical-spec.md` — ADRs use `Superseded-by:` in place.
- Never write under `specs/frs/archive/**` or `specs/plan/archive/**` except the `status` / `archived_at` (and `ship_state` under `--parked`) frontmatter flip at move time.
- Call `Provider.releaseLock(id)` for every archived FR.
