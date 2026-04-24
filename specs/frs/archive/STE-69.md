---
id: fr_01KPXFS371W2ZY4H1Q87AH326Q
title: docs/ Diátaxis layout + shared nav contract (tutorials / how-to / reference / explanation)
milestone: M20
status: archived
archived_at: 2026-04-24T12:10:37Z
tracker:
  linear: STE-69
created_at: 2026-04-23T15:01:00Z
---

## Requirement

Downstream projects using `/docs` need a **predictable, standardized `docs/` tree** so that (a) users landing on the repo find docs in the same place regardless of which project they're looking at, (b) `/docs --commit` and `--full` can deterministically target canonical files, and (c) `/gate-check` can validate the tree structurally rather than by free-form file list.

M20 adopts the [Diátaxis framework](https://diataxis.fr/) (tutorials / how-to guides / reference / explanation) as the canonical decomposition. Every project configured with any docs mode gets the same top-level tree; the two modes (`user_facing_mode`, `packages_mode`) influence only *what goes inside* the `reference/` subdirectory.

A shared `docs/README.md` at the tree root contains four mandatory anchors (`#tutorials`, `#how-to`, `#reference`, `#explanation`) — each linking to the corresponding subdirectory or representative file. These anchors form the cross-mode navigation contract: even in mixed-mode repos (both modes enabled), external readers and cross-doc links resolve against the same four quadrants.

`docs/.pending/` is a staging directory tracked in git (not gitignored) — fragments written by `/docs --quick` during each `/implement` Phase 4 accumulate here across the milestone and are merged into canonical `docs/` files by `/ship-milestone` (via `/docs --commit --full`).

## Acceptance Criteria

- AC-STE-69.1: On first `/docs --full` (or `/docs --commit` when the tree is missing) after `/setup` has configured docs modes, the skill creates the canonical tree:

  ```
  docs/
  ├── README.md
  ├── tutorials/
  │   └── getting-started.md
  ├── how-to/
  │   └── .gitkeep
  ├── reference/
  │   └── .gitkeep
  ├── explanation/
  │   └── architecture.md
  └── .pending/
      └── .gitkeep
  ```

  `.gitkeep` files are plain empty files ensuring empty directories stay tracked. They are removed automatically when the first real content lands in that directory.
- AC-STE-69.2: `docs/README.md` contains exactly four top-level section anchors, each on its own heading line with the literal anchor attribute: `## Tutorials {#tutorials}`, `## How-to guides {#how-to}`, `## Reference {#reference}`, `## Explanation {#explanation}`. Under each heading is a short (1–3 sentence) description and a relative link to the corresponding subdirectory or default landing file. No other `##`-level headings are permitted in `docs/README.md` (the nav contract is exclusive).
- AC-STE-69.3: Packages-mode content lives at `docs/reference/api/<module>.md` — one file per public module detected by the signature-extraction pass (STE-72). User-facing content lives at `docs/reference/states.md` + `docs/reference/flows.md`, each containing one or more mermaid code blocks. Mode-specific content is additive, not mutually exclusive.
- AC-STE-69.4: Mixed-mode repositories (both `user_facing_mode` and `packages_mode` true) share `docs/tutorials/getting-started.md` and `docs/explanation/architecture.md` — these files are not duplicated or mode-suffixed. `docs/reference/` contains both `api/` subdirectory AND `states.md`/`flows.md` side by side. `docs/how-to/` is shared and the LLM is instructed to write how-to recipes covering both audiences (e.g., "Using the CLI" for packages, "Migrating existing state" for user-facing).
- AC-STE-69.5: `/gate-check` validates that all four canonical anchors in `docs/README.md` resolve — i.e., each `#<anchor>`'s corresponding heading is present AND the referenced subdirectory/file exists. Missing anchor, extra `##`-level heading in `docs/README.md`, or broken subdirectory reference is a gate failure with NFR-10 remedy:

  ```
  /gate-check: docs/README.md nav contract violation.
  Remedy: docs/README.md must contain exactly four ##-level headings with {#tutorials}, {#how-to}, {#reference}, {#explanation} anchors, each linking to an existing file or directory. Run /docs --full to regenerate the canonical tree.
  Context: mode=<docs-mode>, skill=gate-check
  ```
- AC-STE-69.6: `docs/.pending/` is tracked in git (no entry in `.gitignore`). Fragments written by `/docs --quick` during `/implement` Phase 4 commit alongside the `/implement` commit and survive across branches until `/ship-milestone` merges them. A `.gitkeep` keeps the directory present when no fragments exist.
- AC-STE-69.7: `adapters/_shared/src/docs_layout.ts` exports `ensureCanonicalLayout(projectRoot: string, config: DocsConfig): LayoutReport`, idempotent (safe to call when tree already exists — creates only missing files/dirs, never overwrites content). `LayoutReport` lists what was created and what already existed.
- AC-STE-69.8: `adapters/_shared/src/docs_nav_contract.ts` exports `validateNavContract(docsReadmePath: string): ValidationResult` — parses the README markdown heading structure, asserts the four anchors are present and resolve to existing paths. Used by both `/gate-check` and `/docs --commit` (to refuse committing against a broken tree).
- AC-STE-69.9: `plugins/dev-process-toolkit/tests/gate-check-nav-contract.test.ts` integration test covers the gate-check probe surface (positive fixture — valid `docs/README.md` passes clean; negative fixture — missing anchor, extra `##`-level heading, and broken subdirectory link each emit a note in `file:line — reason` shape). Required by STE-82's probe authoring contract (M22): every new `/gate-check` probe ships with a corresponding `tests/gate-check-<slug>.test.ts`. This file is distinct from `docs_nav_contract.test.ts` (which covers the helper); the gate-check test exercises the probe's integration-level behavior.

## Technical Design

**New modules:**
- `plugins/dev-process-toolkit/adapters/_shared/src/docs_layout.ts` — directory/file creation logic.
- `plugins/dev-process-toolkit/adapters/_shared/src/docs_nav_contract.ts` — parser + validator for `docs/README.md` anchors.
- `plugins/dev-process-toolkit/templates/docs-README.md.template` (new) — the seed content for `docs/README.md` including the four anchor headings.
- `plugins/dev-process-toolkit/templates/docs-architecture.md.template` (new) — stub `explanation/architecture.md`.
- `plugins/dev-process-toolkit/templates/docs-getting-started.md.template` (new) — stub `tutorials/getting-started.md`.

**`ensureCanonicalLayout` shape:**

```typescript
export interface LayoutReport {
  created: string[];       // relative paths of newly-created files/dirs
  existing: string[];      // relative paths that were already present
  warnings: string[];      // e.g., "docs/some-unknown-file.md — not part of canonical layout"
}

export function ensureCanonicalLayout(
  projectRoot: string,
  config: DocsConfig
): LayoutReport;
```

Creates directories with `fs.mkdirSync(..., { recursive: true })`. Seeds files from templates via string substitution (project name, current date). Never overwrites existing files.

**`validateNavContract` shape:**

```typescript
export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string; missingAnchors?: string[]; brokenLinks?: string[] };

export function validateNavContract(docsReadmePath: string): ValidationResult;
```

**Gate-check integration:** `skills/gate-check/SKILL.md` gains a one-line check in its existing probe list: "If `## Docs` section in CLAUDE.md has any mode enabled, run `validateNavContract` on `docs/README.md`. Fail gate on validation miss per AC-STE-69.5."

## Testing

`docs_layout.test.ts` — 4 cases: (a) empty project gets full tree, (b) partial tree (some files exist) gets gaps filled without overwrites, (c) mixed-mode config produces correct `reference/` subtree, (d) user-facing-only config omits `reference/api/`.

`docs_nav_contract.test.ts` — 5 cases: (a) valid README passes, (b) missing `#how-to` anchor fails with specific reason, (c) extra `##`-level heading fails, (d) anchor present but target file missing fails, (e) user-facing-only mode still needs all four anchors (mode doesn't change the nav contract — the `reference/` content differs but the top-level anchors are invariant).

`gate-check-nav-contract.test.ts` (AC-STE-69.9) — integration tests for the `/gate-check` probe: positive fixture (valid tree passes) + three negative fixtures (missing anchor, extra `##`-level heading, broken link each fire a note in `file:line — reason` shape). Distinct from the helper's unit tests above; covers the probe-level integration surface per STE-82's contract.

Fixture: `tests/fixtures/projects/docs-layout-*` with three variants (user-facing, packages, mixed). Shared with STE-70 scaffold tests.

## Notes

**Why Diátaxis specifically.** The [brainstorm duck council](memory ref: `project_m20_docs.md`) flagged that our initial "user-facing vs packages" split conflates audience with doc type. Diátaxis is the canonical 4-quadrant taxonomy in docs circles (adopted by Django, Ubuntu, GitLab, and many OSS projects). Adopting it pays dividends: external readers recognize the structure, LLMs trained on doc corpora know the quadrants, and the four types are genuinely distinct so the LLM writing prose has less slop in deciding "where does this go?".

**Why `.pending/` is tracked, not gitignored.** Fragments represent per-FR doc deltas that must survive across commits until `/ship-milestone` merges them. If `.pending/` were gitignored, teammates pulling the branch wouldn't see the fragments, and `/ship-milestone` run on a different machine would have nothing to merge. The cost is commit-tree churn (small markdown files appearing/disappearing per milestone), which is acceptable.

**Not in scope for STE-69:** `/docs` skill implementation (STE-70), impact-set detection (STE-71), signature extraction (STE-72). This FR is pure layout + contract.

**Release target:** v1.23.0. Phase A alongside STE-68.
