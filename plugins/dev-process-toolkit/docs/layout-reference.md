# Spec Layout Reference

This document is the canonical reference for spec-layout behavior across spec-touching skills. Skills include a short preamble that points here rather than inlining the full behavior, to keep individual skills under the NFR-1 351-line cap.

Spec-touching skills operate against the file-per-FR tree (`specs/frs/<Provider.filenameFor(spec)>`, `specs/plan/<M#>.md`) unconditionally.

## Provider resolution

Skills that interact with trackers or locks resolve a `Provider` implementation **once per invocation**:

- Read CLAUDE.md `## Task Tracking` section → if `mode: none`, use `LocalProvider`; otherwise use `TrackerProvider` wrapping the configured tracker adapter.
- Provider selection never re-resolves mid-execution.
- Skills depend on the `Provider` interface via injection — never import `LocalProvider` or `TrackerProvider` directly.

Construction example (TypeScript):

```typescript
import { LocalProvider } from "adapters/_shared/src/local_provider";
import { TrackerProvider } from "adapters/_shared/src/tracker_provider";

const provider = mode === "none"
  ? new LocalProvider({ repoRoot })
  : new TrackerProvider({ driver, currentUser });
```

## FR file access

- FR filename is governed by `Provider.filenameFor(spec)`. Tracker mode: `specs/frs/<tracker-id>.md` (e.g., `<TKR>-NN.md`). `mode: none`: `specs/frs/<short-ULID>.md` where `<short-ULID>` is `spec.id.slice(23, 29)` (matching the AC-prefix tail, e.g., `VDTAF4.md`). The full 26-char ULID is preserved in frontmatter `id:` in `mode: none` only; tracker mode has no `id:` line (the tracker ID is the canonical identity).
- Archived FRs live at `specs/frs/archive/<name>.md` with the same stem as the active file — archival never renames.
- Frontmatter shape is enforced at gate time by `/gate-check` probes #2 (`required-frontmatter`), #13 (`identity_mode_conditional`), and #27 (`frontmatter_milestone_not_archived`). The canonical emitter is `buildFRFrontmatter` in `adapters/_shared/src/fr_frontmatter.ts`.
- Each FR has these required top-level sections, in order: `## Requirement`, `## Acceptance Criteria`, `## Technical Design`, `## Testing`, `## Notes`. An FR may optionally carry one additional `## Design References` section placed immediately after `## Acceptance Criteria` — the only optional section, purely additive, leaving the five required sections' order and required status unchanged (see `/spec-write` § 0b for its shape and a worked example). No `/gate-check` probe enforces this FR body section set or order, so an FR carrying the optional `## Design References` section never trips a false-positive GATE FAILED.
- Skills **never rename** FR files after creation except during `/setup --migrate` mode transitions, which re-run `Provider.filenameFor` for the *new* mode and `git mv` each active FR to its new name in the migration commit. Archive is frozen by mode transitions.

## Plan file access

- Plan files live at `specs/plan/<M#>.md` (active or in-flight) or `specs/plan/archive/<M#>.md` (archived milestones).
- Frontmatter shape is enforced at gate time by `/gate-check` probes #16 (`archive-plan-status`) and #27 (`frontmatter-milestone-not-archived`); the read-side parser is `parseFrontmatter` in `adapters/_shared/src/frontmatter.ts`.
- Once `status: active`, content is immutable; any write fails with: *"Plan for <M#> is frozen. Create a `plan/<M#>-replan-<N>` branch to revise."*.

## Design-reference storage

Design-reference images (mockups, screenshots, design-system artifacts) live under `specs/design/`, split into two subtrees:

- `specs/design/system/` — durable design-system artifacts (color tokens, type scales, component sheets) referenced by many FRs over time. Not keyed to any single FR.
- `specs/design/frs/<id>/` — per-feature mockups, one folder per FR keyed by the FR's `Provider.filenameFor(spec)` stem (the tracker ID in tracker mode, or the short-ULID tail in `mode: none`). All images for one FR live in that FR's folder.

**Never-archived rule:** `specs/design/` paths are immutable with respect to archival. No skill performs `git mv` on any `specs/design/` path, and no skill applies `rewriteArchiveLinks` rewrites to references that point under `specs/design/`. When an FR is archived (`specs/frs/<id>.md` → `specs/frs/archive/<id>.md`), its `specs/design/frs/<id>/` folder stays put — design references are never archived. Repo-root-relative image paths therefore remain valid across an FR's whole lifetime.

## Verification

Projects may opt in to a post-gate verification pass by declaring an optional `## Verification` section in CLAUDE.md. The section's top-level key set is **closed** — exactly `{verify_skill, verify_mode}`; any other key inside the section is a config error surfaced to the operator, never silently ignored.

- `verify_skill` — the slug of a project-local skill (a `.claude/skills/<name>` directory name) or the literal `visual-check` (the toolkit's built-in web-UI verification skill).
- `verify_mode` — one of `advisory | blocking | manual`, defaulting to `advisory` when the section or the key is absent. `advisory` reports the check outcome without blocking; `blocking` gates commit approval on a passing check (or an explicit operator override); `manual` never auto-runs — the operator gets a one-line reminder naming the skill instead.

The read-side parser is `readVerificationConfig` in `adapters/_shared/src/verification_config.ts`. It follows the same Schema-L conventions as `## Docs`: the section terminates at the next heading line, flat `key: value` pairs only. An out-of-set key or an out-of-set `verify_mode` value throws `MalformedVerificationConfigError` carrying the offending key and value.

## Skill-specific behavior

### `/spec-write`
- Create new FR. In `mode: none`: call `Provider.mintId()` → write `specs/frs/<Provider.filenameFor(spec)>` with the full ULID in frontmatter `id:`, filename = short-ULID tail. In tracker mode: skip the `mintId()` call and omit `id:` from frontmatter; filename = tracker ID (`<tracker-id>.md`). The tracker ID is the canonical identity.
- Call `Provider.sync(spec)` on save.
- Never write to `specs/requirements.md`.

### `/implement`
- Entry: `Provider.claimLock(id, currentBranch)` before any code is written.
  - `claimed` → proceed.
  - `already-ours` → proceed (session resume).
  - `taken-elsewhere` → STOP with message naming the holding branch.
- Phase 4 (completion): per FR, `git mv specs/frs/<name> specs/frs/archive/<name>` where `<name>` is `Provider.filenameFor(spec)` + flip frontmatter `status: active` → `status: archived` + set `archived_at: <ISO>`, in one atomic commit. Then `Provider.releaseLock(id)`.
- ACs read from the FR file's `## Acceptance Criteria` section, not `specs/requirements.md`.

### `/spec-archive`
- Shared code path with `/implement` Phase 4: `git mv` + frontmatter flip.
- Argument can be a ULID (direct) or `M<N>` (milestone-group; archives all FRs where `milestone == M<N>`). The milestone-group case produces N moves in one commit.

### `/gate-check`
- Conformance probes:
  1. **Filename ↔ `Provider.filenameFor(spec)`** for every `specs/frs/**/*.md` (strict — every base name must equal `Provider.filenameFor(spec)`).
  2. **Required frontmatter fields** present for every FR file — the mode-invariant Schema Q keys `title`, `milestone`, `status`, `archived_at`, `tracker`, `created_at`. The `id:` field is **mode-conditional**: required in `mode: none`, absent in tracker mode (the tracker ID is the canonical identity). Mode-conditional enforcement lives in probe #13 `identity_mode_conditional`; see `skills/gate-check/SKILL.md:26` for the full contract. Missing a mode-invariant field = fail.
  3. **Stale lock scan** — list `.dpt-locks/<ulid>` entries whose branch is merged or deleted. Offer `--cleanup-stale-locks` action that deletes them in one commit.
  4. **Plan post-freeze edit scan** — for each `specs/plan/<M#>.md` with `status: active` + non-null `frozen_at`, list commits to that path whose authored date is after `frozen_at`. No auto-revert (warning semantics).

### `/spec-review`
- Read FRs from `specs/frs/` (glob active, optionally archive/).
- Traceability cross-references resolve against FR files' `## Notes` or inline links.
- Cross-references resolve against the FR file's `## Notes` or inline links. The only file-rewrite the toolkit ships is `specs/frs/<id>.md` → `specs/frs/archive/<id>.md` on archival (see `adapters/_shared/src/spec_archive/rewrite_links.ts`).

### `/setup --migrate`

Tracker-mode switching. See `skills/setup/SKILL.md` § 0b for the full flow: current-mode detection via Schema L probe, target-mode prompt, and atomicity guarantee (CLAUDE.md `mode:` line rewritten only on success).

### Skills that remain layout-agnostic (read-only or no spec reads)

`/brainstorm`, `/tdd`, `/simplify`, `/debug`, `/pr`, `/visual-check` do not read spec files in ways that depend on the layout. Their regression is verified at gate time by `bun test` and `/gate-check`.

## One-ticket-one-branch enforcement

| Mode | Strict? | Mechanism |
|------|---------|-----------|
| Tracker | Strict | `TrackerProvider.getMetadata(id)`: if `status=in_progress` AND `assignee != currentUser` → refuse |
| Tracker-less | Best-effort | `git fetch --all` (skippable via `DPT_SKIP_FETCH=1`) + `git branch -r --contains .dpt-locks/<ulid>` → refuse if present on other branch |

Tracker-less races (two devs committing locks on separate branches without fetching first) are detectable at merge-time but not preventable. This is documented as a deliberate trade-off.

## Test fixtures

- `tests/fixtures/projects/mode-none-*` — fixture spec trees consumed by the live Schema L probe via `tests/scripts/verify-regression.test.ts`. The pre-M18 v2-minimal fixture and Schema M script-mode probe were removed in M39.
