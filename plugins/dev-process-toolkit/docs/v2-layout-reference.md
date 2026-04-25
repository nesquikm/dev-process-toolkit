# v2 Layout Reference

This document is the canonical reference for v2-layout behavior across spec-touching skills (STE-26..STE-25). Skills include a short preamble that points here rather than inlining the full behavior, to keep individual skills under the NFR-1 300-line cap.

v2 is the only supported layout — spec-touching skills operate against the v2 tree (`specs/frs/<Provider.filenameFor(spec)>`, `specs/plan/<M#>.md`) unconditionally.

## Provider resolution (AC-STE-20.3)

Skills that interact with trackers or locks resolve a `Provider` implementation **once per invocation**:

- Read CLAUDE.md `## Task Tracking` section → if `mode: none`, use `LocalProvider`; otherwise use `TrackerProvider` wrapping the configured tracker adapter.
- Provider selection never re-resolves mid-execution (AC-STE-20.3).
- Skills depend on the `Provider` interface via injection — never import `LocalProvider` or `TrackerProvider` directly.

Construction example (TypeScript):

```typescript
import { LocalProvider } from "adapters/_shared/src/local_provider";
import { TrackerProvider } from "adapters/_shared/src/tracker_provider";

const provider = mode === "none"
  ? new LocalProvider({ repoRoot })
  : new TrackerProvider({ driver, currentUser });
```

## FR file access (v2)

- FR filename is governed by `Provider.filenameFor(spec)` (M18 STE-60 AC-STE-60.1). Tracker mode: `specs/frs/<tracker-id>.md` (e.g., `STE-53.md`). `mode: none`: `specs/frs/<short-ULID>.md` where `<short-ULID>` is `spec.id.slice(23, 29)` (matching M16's AC-prefix tail, e.g., `VDTAF4.md`). The full 26-char ULID is preserved in frontmatter `id:` in `mode: none` only; tracker mode has no `id:` line (the tracker ID is the canonical identity — STE-76 AC-STE-76.2).
- Archived FRs live at `specs/frs/archive/<name>.md` with the same stem as the active file — archival never renames (AC-STE-18.4). Pre-M18 archives keep the legacy `fr_<ULID>.md` shape until STE-61's one-time rewrite lands.
- Frontmatter is Schema Q (validates against `adapters/_shared/schemas/fr.schema.json`).
- Each FR has exactly these top-level sections in order: `## Requirement`, `## Acceptance Criteria`, `## Technical Design`, `## Testing`, `## Notes` (AC-STE-26.2).
- Skills **never rename** FR files after creation except during `/setup --migrate` mode transitions (AC-STE-60.6), which re-run `Provider.filenameFor` for the *new* mode and `git mv` each active FR to its new name in the migration commit. Archive is frozen by mode transitions.

## Plan file access (v2)

- Plan files live at `specs/plan/<M#>.md` (active or in-flight) or `specs/plan/archive/<M#>.md` (archived milestones).
- Frontmatter is Schema T (validates against `adapters/_shared/schemas/plan.schema.json`).
- Once `status: active`, content is immutable; any write fails with: *"Plan for <M#> is frozen. Create a `plan/<M#>-replan-<N>` branch to revise."* (AC-STE-21.3).

## Skill-specific behavior in v2

### `/spec-write`
- Create new FR. In `mode: none`: call `Provider.mintId()` → write `specs/frs/<Provider.filenameFor(spec)>` with the full ULID in frontmatter `id:`, filename = short-ULID tail. In tracker mode (STE-76 AC-STE-76.5): skip the `mintId()` call and omit `id:` from frontmatter; filename = tracker ID (`<tracker-id>.md` per M18 STE-60 AC-STE-60.3). The tracker ID is the canonical identity.
- Call `Provider.sync(spec)` on save (AC-STE-24.2).
- Never write to `specs/requirements.md` on v2 projects.

### `/implement`
- Entry: `Provider.claimLock(id, currentBranch)` before any code is written.
  - `claimed` → proceed.
  - `already-ours` → proceed (session resume).
  - `taken-elsewhere` → STOP with message naming the holding branch (AC-STE-28.1/2).
- Phase 4 (completion): per FR, `git mv specs/frs/<name> specs/frs/archive/<name>` where `<name>` is `Provider.filenameFor(spec)` (M18 STE-60 AC-STE-60.4) + flip frontmatter `status: active` → `status: archived` + set `archived_at: <ISO>`, in one atomic commit (AC-STE-22.2). Then `Provider.releaseLock(id)`.
- ACs read from the FR file's `## Acceptance Criteria` section, not `specs/requirements.md`.

### `/spec-archive`
- Shared code path with `/implement` Phase 4: `git mv` + frontmatter flip.
- Argument can be a ULID (direct) or `M<N>` (milestone-group; archives all FRs where `milestone == M<N>`). The milestone-group case produces N moves in one commit (AC-STE-22.6).

### `/gate-check`
- v2 conformance probes:
  1. **Filename ↔ `Provider.filenameFor(spec)`** for every `specs/frs/**/*.md` (strict — every base name must equal `Provider.filenameFor(spec)`).
  2. **Required frontmatter fields** present for every FR file (id, title, milestone, status, archived_at, tracker, created_at). Missing = fail.
  3. **Stale lock scan** — list `.dpt-locks/<ulid>` entries whose branch is merged or deleted. Offer `--cleanup-stale-locks` action that deletes them in one commit (AC-STE-28.5).
  4. **Plan post-freeze edit scan** — for each `specs/plan/<M#>.md` with `status: active` + non-null `frozen_at`, list commits to that path whose authored date is after `frozen_at`. No auto-revert (AC-STE-21.4 warning semantics).

### `/spec-review`
- Read FRs from `specs/frs/` (glob active, optionally archive/).
- Traceability cross-references resolve against FR files' `## Notes` or inline links.
- Legacy `requirements.md#FR-N` refs rewritten to `frs/<ulid>.md` where applicable.

### `/setup --migrate`

Tracker-mode switching. See `skills/setup/SKILL.md` § 0b for the full flow: current-mode detection via Schema L probe, target-mode prompt, and atomicity guarantee (CLAUDE.md `mode:` line rewritten only on success).

### Skills that remain layout-agnostic (read-only or no spec reads)

`/brainstorm`, `/tdd`, `/simplify`, `/debug`, `/pr`, `/visual-check` do not read v1 spec files directly in ways that change under v2. Their regression is verified by snapshot comparison against `tests/fixtures/v2-minimal/` (AC-STE-24.7).

## One-ticket-one-branch enforcement (STE-28)

| Mode | Strict? | Mechanism |
|------|---------|-----------|
| Tracker | Strict | `TrackerProvider.getMetadata(id)`: if `status=in_progress` AND `assignee != currentUser` → refuse |
| Tracker-less | Best-effort | `git fetch --all` (skippable via `DPT_SKIP_FETCH=1`) + `git branch -r --contains .dpt-locks/<ulid>` → refuse if present on other branch |

Tracker-less races (two devs committing locks on separate branches without fetching first) are detectable at merge-time but not preventable. This is documented as a deliberate trade-off (AC-STE-28.6).

## Test fixtures

- `tests/fixtures/v2-minimal/` — golden v2 tree with 3 active FRs, 1 archived, M12 complete + M13 active plan files, slimmed cross-cutting specs. Used by `verify-regression.ts` Schema M probe.
