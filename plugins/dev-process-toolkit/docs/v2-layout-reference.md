# v2 Layout Reference

This document is the canonical reference for v2-layout behavior across spec-touching skills (STE-26..STE-25). Skills include a short preamble that points here rather than inlining the full behavior, to keep individual skills under the NFR-1 300-line cap.

## Layout detection (every spec-touching skill entry)

At the start of every spec-touching skill, read `specs/.dpt-layout` via `bun run adapters/_shared/src/layout.ts`:

- **Marker exists, `version: v2`** → v2 mode. All spec reads/writes target the v2 tree (`specs/frs/<ulid>.md`, `specs/plan/<M#>.md`).
- **Marker missing, `specs/requirements.md` exists** → v1 mode. Every skill continues to operate against `specs/requirements.md`, `specs/plan.md`, `specs/technical-spec.md`, `specs/testing-spec.md`. No behavior change from pre-M13.
- **Marker missing, `specs/requirements.md` also missing** → no specs; mode-none behavior (unchanged from pre-M13).
- **Marker exists, `version: v<N>` where N > 2** → skill exits with the canonical message: `"Layout v<N> detected; <skill> requires v2. Run /dev-process-toolkit:setup to migrate."` (AC-STE-29.3).

`/setup` is exempt from the gate because it implements the migration (AC-STE-29.4). All other skills refuse on version mismatch.

## Provider resolution (AC-STE-20.3)

After layout detection, skills that interact with trackers or locks resolve a `Provider` implementation **once per invocation**:

- Read CLAUDE.md `## Task Tracking` section → if `mode: none`, use `LocalProvider`; otherwise use `TrackerProvider` wrapping the configured tracker adapter.
- Provider selection never re-resolves mid-execution (AC-STE-20.3).
- Skills depend on the `Provider` interface via injection — never import `LocalProvider` or `TrackerProvider` directly.

Construction example (TypeScript):

```typescript
import { LocalProvider } from "adapters/_shared/src/local_provider";
import { TrackerProvider } from "adapters/_shared/src/tracker_provider";
import { readLayoutVersion } from "adapters/_shared/src/layout";

const version = readLayoutVersion(`${repoRoot}/specs`, { allowMissing: true });
if (version !== null && version !== "v2") {
  throw new Error(`Layout ${version} detected; this skill requires v2. Run /dev-process-toolkit:setup to migrate.`);
}
const provider = mode === "none"
  ? new LocalProvider({ repoRoot })
  : new TrackerProvider({ driver, currentUser });
```

## FR file access (v2)

- FRs live at `specs/frs/<ulid>.md` (active) or `specs/frs/archive/<ulid>.md` (archived).
- Frontmatter is Schema Q (validates against `adapters/_shared/schemas/fr.schema.json`).
- Each FR has exactly these top-level sections in order: `## Requirement`, `## Acceptance Criteria`, `## Technical Design`, `## Testing`, `## Notes` (AC-STE-26.2).
- Skills **never rename** FR files after creation (AC-STE-18.4). The only path change permitted is archival via `git mv`.

## Plan file access (v2)

- Plan files live at `specs/plan/<M#>.md` (active or in-flight) or `specs/plan/archive/<M#>.md` (archived milestones).
- Frontmatter is Schema T (validates against `adapters/_shared/schemas/plan.schema.json`).
- Once `status: active`, content is immutable; any write fails with: *"Plan for <M#> is frozen. Create a `plan/<M#>-replan-<N>` branch to revise."* (AC-STE-21.3).
- Exception: plan files produced by migration have `kickoff_branch: null` and `frozen_at: null` even when `status: active` — documented in `plan.schema.json` $comment. `/gate-check` treats migrated plans leniently on round 1; the first kickoff-branch ratification backfills the missing fields.

## INDEX.md regeneration

- Regenerate `specs/INDEX.md` by calling `regenerateIndex(specsDir)` from `adapters/_shared/src/index_gen.ts` any time a skill writes under `specs/frs/`.
- One regeneration per skill invocation (not one per file write). Batched implicitly in the skill's flow.
- Deterministic output (NFR-13): unchanged input ⇒ byte-identical output ⇒ no commit churn.

## Skill-specific behavior in v2

### `/spec-write`
- Create new FR via `Provider.mintId()` → write `specs/frs/<ulid>.md` with Schema Q frontmatter.
- Call `Provider.sync(spec)` on save (AC-STE-24.2).
- Regenerate `INDEX.md` before returning.
- Never write to `specs/requirements.md` on v2 projects.

### `/implement`
- Entry: `Provider.claimLock(id, currentBranch)` before any code is written.
  - `claimed` → proceed.
  - `already-ours` → proceed (session resume).
  - `taken-elsewhere` → STOP with message naming the holding branch (AC-STE-28.1/2).
- Phase 4 (completion): `git mv specs/frs/<ulid>.md specs/frs/archive/<ulid>.md` + flip frontmatter `status: active` → `status: archived` + set `archived_at: <ISO>`, in one atomic commit (AC-STE-22.2). Then `Provider.releaseLock(id)`.
- ACs read from the FR file's `## Acceptance Criteria` section, not `specs/requirements.md`.

### `/spec-archive`
- Shared code path with `/implement` Phase 4: `git mv` + frontmatter flip.
- Argument can be a ULID (direct) or `M<N>` (milestone-group; archives all FRs where `milestone == M<N>`). The milestone-group case produces N moves in one commit (AC-STE-22.6).

### `/gate-check`
- New v2 conformance probes (run when `.dpt-layout` reports v2):
  1. **Filename ↔ `id:` equality** for every `specs/frs/**/*.md` (NFR-15 invariants 1+2). Mismatch = hard fail (AC-STE-18.5).
  2. **Required frontmatter fields** present for every FR file (id, title, milestone, status, archived_at, tracker, created_at). Missing = fail.
  3. **Layout version** matches expected (`v2`). Mismatch = fail (AC-STE-24.5).
  4. **Stale lock scan** — list `.dpt-locks/<ulid>` entries whose branch is merged or deleted. Offer `--cleanup-stale-locks` action that deletes them in one commit (AC-STE-28.5).
  5. **Plan post-freeze edit scan** — for each `specs/plan/<M#>.md` with `status: active` + non-null `frozen_at`, list commits to that path whose authored date is after `frozen_at`. No auto-revert (AC-STE-21.4 warning semantics).

### `/spec-review`
- Read FRs from `specs/frs/` (glob active, optionally archive/).
- Traceability cross-references resolve against FR files' `## Notes` or inline links.
- Legacy `requirements.md#FR-N` refs rewritten to `frs/<ulid>.md` where applicable.

### `/setup --migrate` (STE-23)
- Detects v1 via `specs/requirements.md` present + `specs/.dpt-layout` absent (AC-STE-23.1).
- Prompts y/N, default No (AC-STE-23.2).
- Refuses on dirty tree (AC-STE-23.3).
- `--migrate-dry-run` variant writes preview to `specs/.migration-preview/` (AC-STE-23.4); `.gitignore`d by the migration.
- Creates `dpt-v1-snapshot-<YYYYMMDD-HHMMSS>` tag (AC-STE-23.5).
- Runs `adapters/_shared/src/migrate/index.ts` orchestrator.
- Two-commit sequence: `feat(specs): migrate to v2 layout` + `chore(specs): record v2 layout marker` (AC-STE-23.10/11).
- Structured summary with FR count, milestone count, archive count, tag (AC-STE-23.12).
- Idempotent on already-v2 tree (AC-STE-23.13).

### Skills that remain layout-agnostic (read-only or no spec reads)

`/brainstorm`, `/tdd`, `/simplify`, `/debug`, `/pr`, `/visual-check` do not read v1 spec files directly in ways that change under v2. Their regression is verified by snapshot comparison against `tests/fixtures/v2-minimal/` (AC-STE-24.7).

## One-ticket-one-branch enforcement (STE-28)

| Mode | Strict? | Mechanism |
|------|---------|-----------|
| Tracker | Strict | `TrackerProvider.getMetadata(id)`: if `status=in_progress` AND `assignee != currentUser` → refuse |
| Tracker-less | Best-effort | `git fetch --all` (skippable via `DPT_SKIP_FETCH=1`) + `git branch -r --contains .dpt-locks/<ulid>` → refuse if present on other branch |

Tracker-less races (two devs committing locks on separate branches without fetching first) are detectable at merge-time but not preventable. This is documented as a deliberate trade-off (AC-STE-28.6).

## Test fixtures

- `tests/fixtures/v2-minimal/` — golden v2 tree with 3 active FRs, 1 archived, M12 complete + M13 active plan files, pre-generated INDEX.md, slimmed cross-cutting specs. Used by `verify-regression.ts` Schema M probe.
- `tests/fixtures/migration/v1-to-v2/{input,expected}/` — round-trip fixture with 3 active FRs, 2 archived milestones, 1 in-flight milestone. ULIDs are deterministic under `DPT_TEST_ULID_SEED=01HZ` + `NODE_ENV=test`.
- `tests/fixtures/lock-scenarios/` — git-repo fixtures for `LocalProvider.claimLock` tests (fresh, local-held, remote-held, stale-on-merged-branch).
