---
name: spec-archive
description: Manually archive a specific milestone, FR, or AC block from live spec files into specs/archive/. Operates only on user-selected sections identified by stable anchor IDs or explicit heading text — never auto-scans for checked boxes. Use when /implement Phase 4 auto-archival can't reach content (reopened milestones, cross-cutting ACs, aborted work, explicit user-directed compaction).
argument-hint: '<anchor like {#M3} or {#FR-7}, or explicit heading text>'
---

# Spec Archive

Archive the user-selected section identified by `$ARGUMENTS` into `specs/archive/`. This is the **escape hatch** for situations `/implement` Phase 4 auto-archival can't reach. It never scans the spec files for completed milestones or checked-box ACs — the caller must name what to archive.

## Process

### 1. Resolve the target

Parse `$ARGUMENTS`. The accepted forms are:

- A stable anchor: `{#M3}`, `{#FR-7}` — match the heading whose line ends with that anchor
- An explicit heading string: `M3: User authentication` or `FR-7: Audit log export` — match the first live heading equal to this string

If `$ARGUMENTS` is empty, unrecognised, or does not match any live heading in `specs/plan.md` or `specs/requirements.md`, **refuse and prompt the user** for a specific `{#M{N}}` or `{#FR-{N}}` anchor. Do NOT auto-scan for checked boxes, finished milestones, or other heuristics — this skill operates **only on user-selected sections**.

If `specs/archive/` does not exist, refuse and tell the user to run `/dev-process-toolkit:setup` (or create the directory manually). Archival silently depends on this directory.

### 2. Extract the block

For the resolved target:

- **Milestone (`{#M{N}}`):** collect the entire `## M{N}: {title} {#M{N}}` block from `specs/plan.md` up to (but not including) the next `## ` heading at the same level or the `## Milestone Dependency Graph` / end-of-file, whichever comes first.
- **FR (`{#FR-{N}}`):** collect the entire `### FR-{N}: {title} {#FR-{N}}` block from `specs/requirements.md` up to (but not including) the next `### FR-` heading or the next `## ` section.
- **Traceability matrix rows:** for every AC ID appearing in the extracted block, grab the corresponding row from the traceability matrix in `specs/requirements.md` (use literal match on `| AC-X.Y |`).
- **Related ACs (milestone archival):** also collect every AC whose traceability-matrix row references a file touched during the target milestone — these get bundled into the same archive file if and only if the user confirms in the diff step.

### 3. Compute the archive filename

- `specs/archive/M{N}-{slug}.md` — one file per milestone archival. Archive files are always milestone-scoped so Schema G's `milestone:` frontmatter field always holds an `M{N}` identifier.
- `{slug}` is the lowercased, hyphen-separated title (`M3: User Auth` → `m3-user-auth`, stored as `M3-user-auth.md`).
- **FR-only or AC-only archival:** add the FR/AC content to the nearest enclosing milestone's archive file's Requirements block, or — if the content genuinely doesn't belong to any milestone — ask the user to name a synthetic milestone ID (e.g., `M-adhoc-permissions-cleanup`) that serves as the Schema G `milestone:` value. Never create files outside the `M{N}-{slug}.md` pattern.
- **If the file already exists**, see `### Reopening an Archived Milestone` below — do NOT overwrite, use a `-r2` / `-r3` revision suffix.

### 4. Archiving from `technical-spec.md`

> **Warning:** `technical-spec.md` holds ongoing architectural truth, not shippable work. **Architectural decisions should usually be marked `Superseded-by: ...` in place rather than archived** — that matches the ADR convention (adr.github.io, Nygard) and preserves the decision trail where future implementers look for it.
>
> Archive from `technical-spec.md` ONLY when the user explicitly asks for it AND the section is dead content (e.g., a deleted subsystem that's been fully removed from the code). Refuse by default when `$ARGUMENTS` targets a technical-spec section, ask the user to confirm with `--force-technical-spec` or equivalent explicit acknowledgement, and record the rationale in the archive file's frontmatter.

### 5. Build the archive file body (Schema G)

Assemble the archive content following Schema G (see `specs/technical-spec.md` §4):

```markdown
---
milestone: M{N}
title: {original heading title}
archived: {YYYY-MM-DD}
revision: 1
source_files: [plan.md, requirements.md]
---

# M{N}: {title}

## Plan block (from plan.md)

{verbatim copy of the extracted `## M{N}: ...` block — goal, prerequisites, tasks, acceptance criteria, gate, etc.}

## Requirements block (from requirements.md)

{verbatim copy of every archived FR/AC, grouped under their parent FR. If all of an FR's ACs are archived here, include the full FR block; if only some, include only the FR title line plus the archived ACs.}

## Traceability (from requirements.md matrix)

| AC | Implementation | Tests |
|----|---------------|-------|
{one row per archived AC, copied verbatim from the live traceability matrix at archival time.}
```

**Rules:**
- YAML frontmatter has exactly 5 fields as shown.
- `revision` starts at `1` for first-time archival; reopens use `2`, `3`, etc., with a matching filename suffix.
- Content inside each section is verbatim — no summarization, no paraphrase, no reformatting.
- Three sections in exact order: Plan block → Requirements block → Traceability.

## Present Diff for Approval

Before touching any file, render a **diff preview** showing exactly what will change:

```
--- specs/plan.md (before)
+++ specs/plan.md (after)
@@ ... @@
-## M{N}: {title} {#M{N}}
-... (full block) ...
+> archived: M{N} — {title} → specs/archive/M{N}-{slug}.md ({YYYY-MM-DD})

--- specs/requirements.md (before)
+++ specs/requirements.md (after)
@@ ... @@
-### FR-{N}: {title} {#FR-{N}}
-... (full block if all ACs archived) ...
+> archived: M{N} — {title} → specs/archive/M{N}-{slug}.md ({YYYY-MM-DD})

--- specs/archive/M{N}-{slug}.md (new file)
+++ {full archive body from step 5}

--- specs/archive/index.md
+++ (one new row appended)
```

Show the exact lines to be moved — not a summary. The user must be able to read the diff and confirm or reject.

**Approval gate:** Do NOT proceed to any file modification until the user **explicitly approves** the diff. If the user rejects, asks for changes, or is ambiguous, stop and restart at step 1 with their feedback. Under no circumstances modify `specs/plan.md`, `specs/requirements.md`, `specs/archive/` files, or `specs/archive/index.md` before explicit approval.

### 6. Write the archive file

On approval, write the new file to `specs/archive/M{N}-{slug}.md` (or the revision name from step 7 below). Write the full archive file **first**, before excising anything from the live specs — this way, if the live-spec edit fails, the user still has both the archive and the untouched original.

### 7. Excise live content, insert pointers (Schema H)

Replace the extracted content in `specs/plan.md` (and `specs/requirements.md` for any wholly-archived FRs) with one **blockquote pointer line** each, matching Schema H verbatim:

```
> archived: M{N} — {title} → specs/archive/M{N}-{slug}.md ({YYYY-MM-DD})
```

Rules:
- Blockquote marker `> ` prefix.
- `—` is an em-dash, not a hyphen.
- `→` is a right-arrow, not `->` or `=>`.
- `{YYYY-MM-DD}` is the `archived:` date from the archive file's frontmatter.
- For FRs with **only some** ACs archived, do NOT remove the FR block — leave the remaining ACs in place and add the pointer as a note under the FR heading.
- For wholly-archived FRs, collapse the FR block to a single pointer line.

### 8. Append to the archive index

Append exactly one new row to `specs/archive/index.md` per archival operation, using the table's header order:

```
| M{N} | {title} | {YYYY-MM-DD} | [M{N}-{slug}.md](M{N}-{slug}.md) |
```

Never rewrite existing rows — append-only.

### Reopening an Archived Milestone

If the user reopens a previously-archived milestone (e.g., they add a new `## M3: {title} {#M3}` block to live `plan.md` after `M3-user-auth.md` already exists):

1. The next `/spec-archive {#M3}` run must produce `specs/archive/M3-r2-{slug}.md` — **never mutate the original `M3-{slug}.md`**. Revisions are named `-r2`, `-r3`, etc.
2. Bump the frontmatter `revision` field accordingly (`revision: 2` for the second archival).
3. Update the pointer line in `plan.md` to reference the latest revision file (`specs/archive/M3-r2-{slug}.md`).
4. Append a new row to `specs/archive/index.md` for the revision — do not edit the original row.

Archive files are **append-only by convention**. History must be auditable (matches ADR immutability principle and AC-19.7).

## Post-Archive Drift Check

After file modifications complete (steps 6–8) and before the final report, run a two-pass drift check against the live spec files to surface content that no longer matches the post-archive state. The drift check is **advisory only** — it never auto-rewrites narrative and never blocks the archival operation itself.

### Pass A — Token grep (deterministic)

Grep the live spec files — `specs/requirements.md`, `specs/technical-spec.md`, `specs/testing-spec.md`, `specs/plan.md` — for the exact identifiers just archived. Search literally for `M{N}`, `FR-{N}`, and `AC-{N}.` patterns (the trailing dot on the AC token keeps the grep anchored). **Exclude the Schema H pointer lines the archival operation wrote** by filtering out any line matching `^> archived:` — those pointers are expected references, not drift.

Every remaining hit is an orphan token reference: the live spec names content that no longer lives in the live files. Pass A findings are `high` severity. Pass A runs **before** Pass B and its rows appear first in the unified report so deterministic findings are reviewed before judgment findings.

### Pass B — Semantic scan (judgment)

Read each live spec file in turn with the following brief:

- **(a) Archived ID list:** the milestone and FR IDs just archived in this operation.
- **(b) Archive excerpt:** a one-paragraph excerpt of the new archive file's title line and goal statement only — **not** the full body. Keeping the Pass B context bounded to title + goal keeps the prompt size stable regardless of how long the archived milestone was.
- **(c) Scope-framing instruction:** flag narrative sections whose framing assumes the archived scope is the entire project. Look for wording that labels the project by the just-archived milestones when the remaining live milestones contradict that framing.

**Canary pattern:** narrative that labels the project by the archived scope. The load-bearing example is the Flutter dogfood run — archiving M1–M4 (documentation milestones) left `requirements.md` Overview calling the project a "layered documentation set" and Out-of-Scope saying "Code changes — documentation only", while M5 (a code milestone) was still in flight. Any similar framing — "documentation-only", "docs-only deliverable", "layered X set" where X is the archived scope — is the signal Pass B must catch. Pass B findings are `medium` severity.

Pass B is inherently subjective; the canary example bounds the judgment but edge cases will vary between runs. False positives are accepted as the cost of catching semantic drift that grep cannot see.

> technical-spec.md uses Superseded-by markers, not archival — Pass B flags for this file are advisory only, never push for removal

### Unified report (Schema I)

Merge Pass A and Pass B findings into a single table following Schema I (see `specs/technical-spec.md` §4). Pass A rows appear first, then Pass B rows.

```markdown
| File | Section | Severity | Reason | Suggested action |
|------|---------|----------|--------|------------------|
| requirements.md | §6 Traceability Matrix | high | Orphan row `AC-3.2` references archived FR-3 | Remove row |
| requirements.md | Overview (§1) | medium | "layered documentation set" framing assumes archived scope; contradicts in-flight M5 code milestone | Rewrite Overview to reflect current milestone mix |
```

Exactly 5 columns in the order `File`, `Section`, `Severity`, `Reason`, `Suggested action`. Exactly 2 severity values: `high` (Pass A) and `medium` (Pass B).

**Empty report:** if both passes found nothing, print the literal string `No drift detected` and continue to the final report without prompting the user.

### User choice (advisory — never blocks archival)

If the drift report is non-empty, offer the user exactly three choices:

1. **Address inline now** — walk through each flagged row, propose the edit, and wait for explicit per-edit approval. Pass A findings may be offered as mechanical deletions but still require explicit user approval before any file is modified; the drift check **never auto-edits narrative** based on Pass B findings.
2. **Save for later** — write the Schema I table to `specs/drift-{YYYY-MM-DD}.md` for later review. Archival completes; no narrative edits are made.
3. **Acknowledge and continue** — no file is written, no edits are made. Archival is complete.

The drift check **never blocks the archival operation itself**. The archive file, the Schema H pointers, and the index row are already committed to disk by the time this check runs; the user's choice only governs what happens to the drift report.

## Rules

- This skill operates ONLY on user-selected sections. Never auto-scan live specs for "done" milestones, checked boxes, or completion heuristics.
- Always present the diff and wait for explicit approval before any file modification.
- Archive file is written **before** the live-spec excision (write-then-delete ordering) so interrupted runs leave recoverable state.
- Never mutate an existing archive file — reopens create `-r2`, `-r3` revisions.
- Never auto-archive from `technical-spec.md`. Architectural decisions use `Superseded-by:` in place.
- Append one and only one new row to `specs/archive/index.md` per archival operation.
- Schema G (archive body) and Schema H (pointer line) are defined in `specs/technical-spec.md` §4 — follow them verbatim.
- If `specs/archive/` does not exist, refuse and tell the user to create it (or run `/dev-process-toolkit:setup`).
