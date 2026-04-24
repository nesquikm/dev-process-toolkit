---
id: fr_01KPXFS372E153TN794E2A5K9W
title: /docs skill scaffold — manual --quick / --commit / --full with human-approval gates
milestone: M20
status: archived
archived_at: 2026-04-24T12:10:37Z
tracker:
  linear: STE-70
created_at: 2026-04-23T15:02:00Z
---

## Requirement

STE-70 introduces `/docs` as a user-invocable skill that orchestrates doc generation. Three mutually-exclusive flags:

- `--quick`: write one fragment to `docs/.pending/<fr-id>.md` describing what the current working-tree diff changed. Non-destructive — adds a file, touches nothing else. This is the flag `/implement` Phase 4 will invoke (STE-74). Manual use is for ad-hoc doc deltas between FRs.
- `--commit`: merge all fragments in `docs/.pending/` into canonical `docs/` files, show a unified diff, require explicit human approval, write on approval, delete the merged fragments on success. Used by `/ship-milestone` (STE-73) and manually as a reconciliation step.
- `--full`: regenerate the entire canonical `docs/` tree from specs + code + config. Highest token cost; used at milestone close by `/ship-milestone` and manually when the pending-fragment accumulation has drifted too far.

All three flags refuse cleanly if the `## Docs` section in `CLAUDE.md` has both modes disabled (or is absent). Both `--commit` and `--full` require explicit human approval on the unified diff before any file write — this is the critical gate against the "LLM produces plausible-but-wrong content that gets approved as boilerplate" failure mode identified in the brainstorm.

## Acceptance Criteria

- AC-STE-70.1: New skill file at `plugins/dev-process-toolkit/skills/docs/SKILL.md`. Registered in `.claude-plugin/plugin.json` as `dev-process-toolkit:docs`. Appears in `/help` as "Generate or update project docs (requires /setup --docs first)".
- AC-STE-70.2: Three mutually-exclusive flags: `--quick`, `--commit`, `--full`. Passing zero flags prints usage and exits 0 (not an error — helps discovery). Passing more than one flag surfaces NFR-10:

  ```
  /docs: flags --quick, --commit, and --full are mutually exclusive; got <list-of-passed-flags>.
  Remedy: pick exactly one. /docs --quick writes a fragment; --commit merges pending fragments; --full regenerates from scratch.
  Context: mode=<docs-mode>, skill=docs
  ```
- AC-STE-70.3: `/docs --quick` writes `docs/.pending/<fr-id>.md` where `<fr-id>` is resolved from the current git branch (if `branch_template` / tracker-mode maps to an FR) or from the most recent FR touched in the working-tree diff. If no FR can be resolved, the fragment filename falls back to `docs/.pending/_unbound-<UTC-timestamp>.md` with a `warning:` line in the fragment body. Each fragment is a self-contained markdown document with frontmatter:

  ```
  ---
  fr: <fr-id or _unbound>
  impact_set: { symbols: [...], routes: [...], configKeys: [...], stateEvents: [...] }  # from STE-71 when available
  target_section: tutorials | how-to | reference | explanation
  target_file: docs/<subpath>  # canonical destination at merge time
  generated_at: <ISO-timestamp>
  ---

  <body — the actual prose delta to append/insert at merge time>
  ```

  When STE-71 is not yet implemented, `impact_set:` is absent from frontmatter and the LLM prompt reads the raw diff.
- AC-STE-70.4: `/docs --commit` reads every `.md` file in `docs/.pending/` (skipping `.gitkeep`), groups them by `target_file`, computes a unified diff against the canonical file, shows the concatenated diff to the user, and requires explicit approval (`y` / `yes`). On approval: writes the merged content to each target file, deletes the merged fragment files, writes a single commit message to stdout (but does not create the commit — caller decides). On refusal (`n` / `no` / anything else): no file writes, fragments remain in `.pending/`, exits 0 with "commit declined; fragments preserved".
- AC-STE-70.5: `/docs --full` regenerates every file in the canonical `docs/` tree from scratch. Reads: all active FRs under `specs/frs/`, all active milestones under `specs/plan/`, `CLAUDE.md`, project source (via impact set / signature extraction where applicable), current `CHANGELOG.md`. Shows a unified diff of the entire tree against current state, requires explicit approval. On approval: writes, deletes all `.pending/*.md` fragments (they're superseded), exits 0. On refusal: no writes, fragments preserved.
- AC-STE-70.6: All three flags refuse if `DocsConfig` from STE-68 has both `userFacingMode: false` AND `packagesMode: false` (or section absent). Surfaces NFR-10:

  ```
  /docs: docs generation is not configured for this project.
  Remedy: run /setup to answer the three docs-mode prompts. At least one of user_facing_mode or packages_mode must be true.
  Context: mode=<tracker-mode>, docs=disabled, skill=docs
  ```
- AC-STE-70.7: `skills/docs/SKILL.md` stays within NFR-1's 300-line budget. Detailed reference material (per-flag prose, fragment frontmatter examples, merge-strategy pseudocode) lives in `plugins/dev-process-toolkit/docs/docs-reference.md` and is referenced by the skill via: `See docs/docs-reference.md for full fragment examples and per-section merge strategies.`
- AC-STE-70.8: Both `--commit` and `--full` refuse if `validateNavContract(docs/README.md)` (from STE-69) returns `ok: false` *before* any write — the skill will not operate on a broken tree. User is directed to run `/docs --full` from a clean tree or fix the README manually. `--full` itself bypasses this check (it IS the recovery path) but still requires the `DocsConfig` gate from AC-STE-70.6.

## Technical Design

**Skill file structure:** Follow the pattern of `skills/implement/SKILL.md` — top-level sections: "## Process", "## Rules", "## Flags and invocation". Each flag gets a subsection under "## Process" describing the step-by-step flow. Inline pseudocode for the merge algorithm goes in `docs/docs-reference.md` (NFR-1 overflow).

**Fragment merge algorithm (overview):**

1. For each `.md` in `docs/.pending/`: parse frontmatter, validate `target_section` ∈ {tutorials, how-to, reference, explanation} and `target_file` starts with `docs/<target_section>/`.
2. Group by `target_file`. For each target, concatenate fragment bodies in chronological order (`generated_at` frontmatter ascending).
3. Produce the merged content per target: append to end of target file if target exists, or create with seed content from templates if target is missing.
4. Compute unified diff across all targets.
5. Show to user, require approval.
6. On approval: write targets, delete pending fragments, print commit-message suggestion.

**`--full` regeneration algorithm:** Separate from merge — reads specs + code as sources of truth, regenerates each canonical file from scratch. Drives packages-mode API ref content via STE-72 (signature extraction). Drives user-facing mode content via LLM prose generation with the `impact_set`-aware prompt (or full-project prompt for initial generation).

**Approval UX:** Both `--commit` and `--full` write the proposed diff to a temp file and print `=== Proposed diff (N files, M lines) ===\n<diff>\n=== Apply? [y/N] ===`. Accepts `y` / `yes` (case-insensitive). Anything else is treated as refusal.

## Testing

`tests/fixtures/projects/docs-skill-*` — three variants matching mode combinations. Each fixture contains:
- A populated `CLAUDE.md` with `## Docs` section.
- A seeded `docs/` tree from STE-69.
- A working-tree diff (committed as a staged diff via a helper) that should produce known impact set.
- Known fragments in `docs/.pending/` for `--commit` tests.

`docs_merge.test.ts` — pure-function tests for the merge algorithm: empty pending, single fragment, multiple fragments to one target, fragments across all four sections, malformed frontmatter (reject with NFR-10), conflict where two fragments edit the same canonical line (last-writer-wins with warning).

Integration smoke tests (in `skills/docs/`): --quick happy path (fragment written), --commit happy path (merge + approval = writes), --commit refused (no writes), --full happy path (full regen), --quick with docs disabled (refuse per AC-STE-70.6).

## Notes

**Why no `--yes` / auto-approval flag.** The human-approval gate on `--commit` and `--full` is the single strongest mitigation against the biggest failure mode identified in the brainstorm ("LLM generates plausible-but-wrong content, reviewer skims boilerplate doc diff and approves"). Adding `--yes` would re-open that hole. If automation truly needs non-interactive mode (e.g., CI regenerating docs on a schedule), that's a future FR with its own review gate design.

**Fragment FR-resolution via branch.** STE-64 (M19) added `branch_template` to Schema L, allowing the branch name to encode the active FR. `/docs --quick` uses that template to extract the FR ID. In tracker-less mode with no branch template, falls back to "most recent FR in diff" heuristic. Both are imperfect; the `_unbound-*` fallback keeps the fragment readable even when FR is ambiguous.

**Skill-file length risk.** Three flag flows + the `## Docs` gate + frontmatter specs + merge algorithm description + approval UX — this is close to the 300-line limit. The `docs-reference.md` overflow is mandatory, not optional.

**Release target:** v1.23.0. Phase B of M20 plan (depends on STE-68 + STE-69).
