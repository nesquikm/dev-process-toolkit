# `/setup --template` Reference

Extended reference for the template-source setup flow — `/setup --template <path>` and the `setup-template` dispatch child it hands off to (`skills/setup-template/SKILL.md`). The child skill carries the condensed flow; consult this file when the analyzer's inventory looks wrong, a selection question surprises you, or a headless run refuses and you want to know why that is the designed outcome.

## What `--template <path>` does

`/setup --template <path>` bootstraps the current project by **reusing an existing project as a template** instead of starting from the toolkit's stock templates. The parent `/setup` skill does not analyze or copy anything itself: it dispatches to the `setup-template` child, waits for the child to hand back a set of landed-but-uncommitted files, then resumes its normal interview. The copied set rides `/setup`'s **single bootstrap commit** alongside everything else the parent stages — the child never commits on its own, and there is no second commit for the template files.

The child is a dispatch-only skill: `user-invocable: false` keeps it off the slash menu, but it stays model-invocable so the dispatching parent can reach it. It runs in the parent's context (no fork, no paired subagent) because its whole job is interactive: it must share the operator's session.

## The analyzer contract

The child never eyeballs the template tree. It runs the shared analyzer module via bun:

```bash
bun run ${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/template_source_analyzer.ts <template-path>
```

`analyzeTemplateSource` prints a JSON inventory with four categories and two flags:

| Field | Contents |
|-------|----------|
| `processConfig` | Toolkit process files found in the template: CLAUDE.md, `.claude/settings.json`, `.mcp.json`, git-hook templates. |
| `manifests` | Per-entry rows for the template's `specs/deps.yaml` and `specs/best-practices.yaml`, read through the canonical manifest modules — plus `warnings` for malformed manifests (findings, never hard failures). |
| `scaffolding` | Known build/CI/lint configs detected at the template root. |
| `sourcePatterns` | Top-level source trees, listing only. |
| `wholeProjectCandidate` | `true` when the template is shaped like a project worth copying wholesale. **Deliberately ignores the `manifests` category** — a directory containing nothing but manifest rows is a config donor, not a project skeleton, and offering whole-project mode on manifests alone would promote a per-entry decision into a tree copy. |
| `isGitRepo` | Whether the template root is itself a git repository — consumed by the landing steps (the template's `.git` is always excluded from any copy). |

A missing or non-directory path is a hard refusal (canonical `Refusing:` / `Remedy:` / `Context:` shape on stderr, non-zero exit) — the child surfaces it verbatim and aborts.

## Socratic per-category selection

Selection is Socratic, one category at a time: one `AskUserQuestion` per non-empty category, answered before the next is asked. Nothing is copied without an explicit selection — a declined question, an empty answer, or a skipped category contributes zero entries, and there is no select-all default.

**Manifests are filtered per-entry**, not per-file: each `deps.yaml` row and each `best-practices.yaml` row is individually selectable by name, one question per manifest. The selected rows are read via the canonical manifest modules, merged onto the current project's baseline manifest, and re-serialized through `writeManifest` — never hand-authored YAML.

## Copy/adapt name rewriting

Copied config files get **project-identifying names rewritten** to the current project's equivalents: the template's project/package name, repo slug, description strings, and template-specific paths. A value with no confident current-project equivalent is left as copied and called out as a follow-up in the diff preview — never silently guessed. Manifest entry paths get the same rewrite.

## The single unified-diff approval gate

Everything the operator selected is composed off-tree, then presented as exactly **one unified diff** (current working tree → proposed content, new files as additions) behind one approve/cancel question. On approve, every file in the diff lands; on decline, nothing lands and the working tree stays byte-identical. There is no per-file gate and no partial landing — the diff is the contract, in the same shape as the parent setup flow's manifest-seeding gate.

## Whole-project mode and the backup

When `wholeProjectCandidate` is `true`, whole-project mode is offered as one more explicit choice — never a default. On selection, the copy set becomes the template's full tree minus `.git` and minus anything the operator deselected (deselections still subtract; whole-project mode widens the selection, it does not override a decline). If the destination is non-empty, a **filesystem backup precedes any transform**: the destination tree is copied to a timestamped sibling (`project-backup-<stamp>`, collision-suffixed), and the backup directory is announced verbatim — it is the operator's restore path. A failed backup aborts before a single byte is rewritten.

## The headless refusal

Reuse selection has no safe default, so a headless run cannot proceed: when stdin is non-tty (e.g., `claude -p`), every unanswered selection question routes through `requireOrRefuse`, and the child refuses **before anything is copied**, surfacing the machine-readable marker:

```
<dpt:requires-input-refused>v1</dpt:requires-input-refused>
```

The auto-approve marker does **not** relax this gate — there is no marker carve-out for reuse selection. A refusal stated only in prose would be byte-indistinguishable from a run that did nothing, which is why the marker is the contract; the smoke driver's fixture group 13 asserts both the marker and the absence of any file writes preceding it.

## How the copied set reaches the commit

The landed files stay uncommitted; control returns to the parent `/setup`, which continues its normal interview and stages the template-copied set into its single bootstrap commit. The child reports the landed file list so the parent's `git status --porcelain` pre-flight treats those paths as expected-dirty — the deliverable of the dispatch, not a pre-flight failure.
