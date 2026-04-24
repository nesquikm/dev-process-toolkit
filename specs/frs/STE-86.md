---
title: ULID strip migration tool + bimodal identity probe
milestone: M21
status: active
archived_at: null
tracker:
  linear: STE-86
created_at: 2026-04-24T13:15:00Z
---

## Requirement

STE-76 requires stripping `id:` frontmatter from 107 archived tracker-mode FRs in a single atomic commit, plus enforcing the bimodal identity invariant forward via `/gate-check`. STE-86 provides both tools:

1. **One-shot migration script** at `adapters/_shared/src/migrations/strip_ulid.ts` — idempotent, dry-run-capable, line-based surgery (no YAML round-trip), reports per-file status. Consumed by STE-76's implementation commit; kept in-tree post-release for reproducibility.
2. **`/gate-check` probe** `identity_mode_conditional` — enforces: mode-none active FRs carry a valid `id: fr_<ULID>`; tracker-mode active FRs do not. Severity `warning` at M21 ship; flips to `error` in a follow-up after ≥1 full dogfood cycle (STE-76 AC-STE-76.7).
3. **STE-82-compliant integration test** at `tests/gate-check-identity-mode-conditional.test.ts` — the M22 STE-82 convention that every probe ships with its own integration test.

## Acceptance Criteria

- AC-STE-86.1: `adapters/_shared/src/migrations/strip_ulid.ts` exports `stripUlidFromArchive(archiveDir: string, opts: { dryRun: boolean }): Promise<StripUlidSummary>` where `StripUlidSummary = { modified: string[], skipped: string[], errors: Array<{ file: string, reason: string }> }`. Dry-run returns what would change; write-mode applies the edit atomically.
- AC-STE-86.2: The script removes exactly one line matching `^id: fr_[0-9A-HJKMNP-TV-Z]{26}$` (the `ULID_REGEX` shape from `ulid.ts`, inlined or consumed as a type-only import per AC-STE-86.8) **from tracker-mode FRs only** — a file whose frontmatter carries `tracker: {}` (empty map) or no tracker key is classified as mode-none and reported as `skipped` with byte-identical preservation (NFR-15 mode-scoped Invariant #2; mode-none identity IS the `id:` value). Tracker-mode files missing the line are reported as `skipped`. Files with a malformed `id:` line (wrong length, wrong charset, duplicated) are reported as errors; when any error occurs in write-mode, the script exits non-zero at end and no partial writes are committed (all-or-nothing per-file atomicity via temp-file + rename).
- AC-STE-86.3: Idempotent — a second run on already-stripped files reports every file as `skipped`, with zero `modified` and zero `errors`. Proven by a test case that runs the script twice against the same fixture.
- AC-STE-86.4: Unit tests in `adapters/_shared/src/migrations/strip_ulid.test.ts` cover at least these cases: (a) happy path — single file with `id:` line, dry-run reports `modified`, write applies, (b) idempotency — second run reports `skipped`, (c) malformed `id:` line → `errors` entry + script exits non-zero, (d) missing `id:` line → `skipped` not `errored`, (e) file with only frontmatter and no body (edge case — valid YAML), (f) NFC-normalized paths (macOS / Linux compatibility).
- AC-STE-86.5: The probe `identity_mode_conditional` scans `specs/frs/*.md` (active only, archive excluded). If CLAUDE.md `## Task Tracking` mode is a tracker (non-`none`), every FR must lack an `id:` line. If mode is `none`, every FR must carry `id: fr_<26-char ULID>` matching `ULID_REGEX`. Violations surface in NFR-10 canonical shape with file path, expected state, actual state, and remedy hint.
- AC-STE-86.6: Probe `severity` is `warning` at M21 ship. The probe source file carries a `// TODO(STE-<follow-up>): flip severity to "error" after one dogfood cycle` comment so the follow-up change has a stable grep anchor. The follow-up is a single-line probe edit; it does not require its own FR.
- AC-STE-86.7: STE-82-compliant integration test at `tests/gate-check-identity-mode-conditional.test.ts` runs the probe against 6 fixtures under `tests/fixtures/probe-identity/`: (a) `mode-none-valid/` — FR with valid `id:`, mode-none CLAUDE.md; probe passes, (b) `tracker-mode-valid/` — FR without `id:`, tracker CLAUDE.md; probe passes, (c) `mode-none-missing-id/` — FR without `id:`, mode-none CLAUDE.md; probe warns, (d) `mode-none-wrong-id/` — FR with `id:` ≠ filename stem; probe warns, (e) `tracker-mode-has-id/` — FR with stale `id:`, tracker CLAUDE.md; probe warns, (f) `tracker-mode-malformed-id/` — FR with malformed `id:`, tracker CLAUDE.md; probe warns. Test file naming follows the M22 `tests/gate-check-<slug>.test.ts` convention.
- AC-STE-86.8: `strip_ulid.ts` and the probe have **zero runtime dependencies** on `ulid.ts`. `ULID_REGEX` is consumed as a `import type` (TypeScript type-only import, erased at build) or inlined as a private constant. Rationale: the script and probe are bimodal-invariant tools — coupling them to the ULID-minting module would cross the scope-3 isolation boundary.

## Technical Design

### Migration script layout

- **Location**: `adapters/_shared/src/migrations/strip_ulid.ts` (new `migrations/` subfolder).
- **Test**: `adapters/_shared/src/migrations/strip_ulid.test.ts`.
- **Optional CLI**: `adapters/_shared/src/migrations/strip_ulid.cli.ts` — thin wrapper:
  ```
  bun run adapters/_shared/src/migrations/strip_ulid.cli.ts --dry-run
  bun run adapters/_shared/src/migrations/strip_ulid.cli.ts --apply
  ```
  Calls `stripUlidFromArchive("specs/frs/archive", { dryRun })` and prints the summary. The CLI is not required for STE-76 execution (the exported function suffices), but reduces friction for human operators.

### Algorithm (strip_ulid.ts)

1. Walk `archiveDir/**/*.md` via `node:fs` recursive `readdir`.
2. For each file: read text, locate the first `\n---\n` frontmatter boundary.
3. Within the frontmatter block, line-scan for `^id: fr_[0-9A-HJKMNP-TV-Z]{26}$`:
   - Exactly one match → in dry-run, record `modified`; in write-mode, build the new text with that line removed and write via temp-file + rename.
   - Zero matches → record `skipped`.
   - Malformed `id:` line (e.g., `id: foo`, `id: fr_SHORT`, multiple `id:` lines) → record error with `reason`.
4. At end, return `StripUlidSummary`; CLI exits non-zero if `errors.length > 0`.

### Probe layout

- **Location**: `adapters/_shared/src/probes/identity_mode_conditional.ts` (assumes the existing probes directory structure; confirmed during implementation against M22 STE-82 conventions).
- **Test**: `tests/gate-check-identity-mode-conditional.test.ts` — STE-82 convention.
- **Fixtures**: `tests/fixtures/probe-identity/{mode-none-valid,tracker-mode-valid,mode-none-missing-id,mode-none-wrong-id,tracker-mode-has-id,tracker-mode-malformed-id}/` — each fixture is a minimal `specs/frs/` + `CLAUDE.md` tree.

### Algorithm (probe)

1. Read `CLAUDE.md` via the existing `buildResolverConfig()` helper from `adapters/_shared/src/resolver_config.ts`. Extract mode from `## Task Tracking`.
2. List `specs/frs/*.md` (active, non-recursive).
3. For each file: parse frontmatter (YAML or line-scan; implementer's choice for simplicity + speed).
4. Check `id:` presence + validity against mode rules:
   - mode == `none` + `id:` missing → warning (`expected: present, actual: missing`).
   - mode == `none` + `id:` malformed → warning (`expected: fr_<26-char ULID>, actual: <value>`).
   - mode != `none` + `id:` present → warning (`expected: absent, actual: <value>`).
5. Return the list of violations in NFR-10-canonical shape.

### Why line-based, not YAML round-trip

A YAML round-trip through `js-yaml` would: re-quote strings, normalize key order, strip comments, collapse blank lines. STE-86 wants byte-identical preservation except for the single deleted line — line-based surgery guarantees that. Fixture tests lock the byte-identical invariant: `expect(writtenBytes).toEqual(inputBytes.replace(/^id: fr_[0-9A-HJKMNP-TV-Z]{26}\n/m, ""))`.

### Why a separate FR and not folded into STE-76

Migration tooling has 6+ unit-test cases and 6+ integration-test fixtures — bundling into STE-76 would bloat that FR's Testing section and mix "spec-text + data" concerns with "tooling + probe" concerns. Separate FR keeps review scopes coherent and lets STE-86 ship + be tested before STE-76 runs it.

### Why STE-86 ships first

STE-76's implementation commit *runs* the migration tool + activates the probe. The tool and probe must exist first.

### Why zero runtime dep on `ulid.ts`

Per scope-3 Option 2 (STE-85), `ulid.ts` is semantically a mode-none-only module. STE-86's tools are bimodal-invariant enforcers — they must not depend on the thing they're enforcing boundaries around. Inlining `ULID_REGEX` or importing it as `import type` preserves the separation.

## Testing

- **Unit tests** (AC-STE-86.4): `strip_ulid.test.ts` — 6 cases enumerated in the AC.
- **Integration test** (AC-STE-86.7): `gate-check-identity-mode-conditional.test.ts` — 6 fixtures × 1 probe run each.
- **Fixture tree**: 6 directories under `tests/fixtures/probe-identity/`, each ~2 files (CLAUDE.md + one FR).
- **Coverage target**: 100% branch coverage on `strip_ulid.ts` (~50 LOC). Probe coverage target ≥95% — the small unknown is edge-case YAML-parse error paths that may be hard to trigger synthetically.
- **Regression guards**:
  - Mode-none snapshot (`tests/fixtures/mode-none-regression/`) must still pass after STE-86 lands (probe should silently pass on it).
  - `bun run typecheck` passes end-to-end (shared with STE-85).

## Notes

**Why keep the one-shot script in-tree after use.** Removal would rewrite history awkwardly — the commit that ran the script stays in the log; the script vanishing makes that commit unverifiable without time-travel. Keeping it under `migrations/` with a header docstring that says "executed 2026-XX-XX as part of M21 STE-76 — do not re-run" documents the lineage and keeps the commit reproducible from any future checkout.

**STE-82 alignment.** M22 STE-82 installed the convention that every `/gate-check` probe authors its own integration test at `tests/gate-check-<slug>.test.ts`. STE-86 honors that convention via AC-STE-86.7.

**Release target:** v1.24.0 alongside STE-76 + STE-85.
