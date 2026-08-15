---
name: setup-template
description: Internal template-source setup child — dispatched exclusively by /setup --template. Analyzes a template project, walks reuse selection, and lands the copied config into the current project. Do not invoke directly; stays model-invocable for the dispatching parent.
user-invocable: false
argument-hint: '<template-path>'
---

# Setup: Template Source

Internal dispatch child for `/setup --template <template-path>`. Analyzes an existing project as a reuse template, walks the operator through reuse selection Socratically, then copies and adapts the selected config into the current project. The resulting files are handed back to the parent `/setup` flow so they ride the normal single bootstrap commit — this child never commits on its own.

## Process

### Step 1 — Run the analyzer

Inventory the template project by RUNNING the shared analyzer module via bun — never re-derive the categorization in prose:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/template_source_analyzer.ts <template-path>
```

The CLI prints the `analyzeTemplateSource` inventory as JSON on stdout — four categories plus two flags:

- `processConfig` — toolkit process files (CLAUDE.md, `.claude/settings.json`, `.mcp.json`, git-hook templates).
- `manifests` — per-entry rows for the template's `specs/deps.yaml` and `specs/best-practices.yaml`, read through the canonical manifest modules.
- `scaffolding` — known build/CI/lint configs detected at the template root.
- `sourcePatterns` — top-level source trees (listing only).
- `wholeProjectCandidate` / `isGitRepo` — flags consumed by the later landing steps.

On a missing or non-directory `<template-path>` the CLI exits non-zero with the canonical `Refusing:` / `Remedy:` / `Context:` message on stderr — surface it verbatim to the operator and abort; do not re-template. `manifests.warnings` entries (a malformed manifest inside the template) are presented as findings alongside the inventory, never hard failures.

### Step 2 — Present the categorized inventory

Render the inventory as a Markdown table before asking anything: one section per category, each entry on its own row (file path, manifest entry name, or source-tree name), plus a flags line for `wholeProjectCandidate` and `isGitRepo`. Empty categories are shown as `(none)` so the operator sees the full shape of what the analyzer found — selection questions only ever offer what this table already presented.

### Step 3 — Socratic reuse selection, one category at a time

`requires-input: reuse selection has no safe default; nothing is copied without an explicit answer.`

**Headless refusal (non-tty stdin).** When `process.stdin.isTTY === false` (e.g., `claude -p`), reuse selection cannot be defaulted: route every unanswered selection question through `requireOrRefuse(spec, key, sentinel)` from `adapters/_shared/src/requires_input.ts`, which throws `RequiresInputRefusedError` on the `refused` outcome. Surface that refusal verbatim so the machine-readable marker `<dpt:requires-input-refused>v1</dpt:requires-input-refused>` it carries reaches the stream — a prose-only refusal is byte-indistinguishable from a run that simply did nothing. The auto-approve marker `<dpt:auto-approve>v1</dpt:auto-approve>` does NOT relax this gate — there is no marker carve-out, because reuse selection has no safe default. Full cross-skill contract: `docs/auto-mode-protocol.md`.

Per Pattern 26 (see docs/auto-mode-protocol.md § Socratic Loop Contract), the selection interview is Socratic: issue one `AskUserQuestion` per category, one category at a time, and wait for the answer before asking about the next category. Bare-prose questions are forbidden — every selection prompt MUST be an `AskUserQuestion` `tool_use` with the `Other` free-form fallback available. Skip the question for an empty category.

- **`processConfig`** — one `AskUserQuestion` offering the detected process files as selectable options (all, a named subset via `Other`, or none).
- **`manifests`** — per-entry filtering: each `specs/deps.yaml` row and each `specs/best-practices.yaml` row is individually selectable by name. Issue one `AskUserQuestion` per manifest (deps first, then best-practices), never an all-or-nothing toggle over both manifests.
- **`scaffolding`** — one `AskUserQuestion` offering the detected build/CI/lint configs as selectable options.
- **`sourcePatterns`** — one `AskUserQuestion` offering the detected source trees, framed as structure-reuse candidates for the later landing steps.

Record the answers as the **copy set**. Nothing is copied without an explicit selection — a declined question, an empty answer, or a skipped category contributes zero entries to the copy set, and there is no select-all default.

### Step 3b — Whole-project mode (offered only on `wholeProjectCandidate`)

When the analyzer's `wholeProjectCandidate` flag is `true`, offer whole-project mode as one more option in the selection interview — an explicit `AskUserQuestion` choice, **never a default**: declining it (or the flag being `false`) leaves the per-category flow above as the path, and nothing about the flag alone changes what gets copied.

On an explicit whole-project selection:

- **Full-tree copy.** The copy set becomes the template's entire tree, minus the template's `.git` directory and minus every category the operator deselected in Step 3 — deselections still subtract from the full tree; whole-project mode widens the selection, it does not override a decline.
- **Backup before transform.** If the destination (the current project root) is non-empty, take a **filesystem backup before any transform touches it** — mirroring the migration entry's backup-first idiom: copy the destination tree to a timestamped sibling directory (`project-backup-<stamp>`, collision-suffixed `-2`, `-3`, … so no backup ever overwrites another) **before** a single byte is rewritten, and announce the backup directory to the operator verbatim — it is their restore path, and a summary that omits it strands them. A failed backup aborts pre-mutation; never proceed on the reasoning that the copy mostly worked.

The whole-project copy set then flows through Step 4's adapt pass and Step 5's single diff gate exactly like a per-category selection — the backup guards the transform, not the approval.

### Step 4 — Copy and adapt the selection

Compose the proposed content for every entry in the copy set — in memory or a scratch staging area, never straight into the working tree (nothing lands before the Step 5 approval):

- **Config files** (`processConfig` + `scaffolding` selections) — copy the template file, then rewrite **project-identifying** names to the current project's equivalents: the template's project/package name, repo slug, description strings, and template-specific paths. A value with no confident current-project equivalent is left as copied and called out as a follow-up in the Step 5 preview, never silently guessed.
- **Manifests** (per-entry `manifests` selections) — filter through the canonical manifest modules, never hand-authored YAML: read the template's rows via `readManifest` from `adapters/_shared/src/deps_manifest.ts` (deps) and `adapters/_shared/src/best_practices_manifest.ts` (best-practices), keep only the selected entries, merge them onto the current project's baseline manifest (read via the same modules; absent file ⇒ empty baseline), and serialize the proposal via `writeManifest`. Entry paths get the same project-identifying rewrite as config files.

### Step 5 — ONE unified diff preview behind the approval gate

Mirroring the parent setup flow's manifest-seeding idiom: render exactly **one unified diff** covering the whole selected set (current working tree → proposed content, new files as additions), then prompt approve / cancel via a single `AskUserQuestion`. On approve, land every file in the diff into the working tree. On decline or cancel, **nothing lands** — the working tree stays byte-identical and the child reports the declined selection back to the parent. There is no per-file gate and no partial landing.

### Step 6 — Hand back to the parent flow

The landed files stay **uncommitted in the working tree** — this child never commits. Control returns to the parent `/setup` flow, whose normal interview continues and whose single **bootstrap commit** picks the copied files up alongside everything else it stages. Report the landed file list to the parent so its `git status --porcelain` pre-flight accounts for the template-copied set as **expected-dirty**: those paths are the deliverable of this child, not a pre-flight failure, and must not abort or re-prompt the bootstrap sequence.
