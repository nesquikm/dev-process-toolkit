---
title: Delete `active_ticket:` key from Schema L (dead surface)
milestone: M18
status: archived
archived_at: 2026-04-23T11:34:27Z
tracker:
  linear: STE-62
created_at: 2026-04-23T08:37:34Z
---

## Requirement

`active_ticket:` in `CLAUDE.md` `## Task Tracking` (Schema L) is documented as the Tier 2 fallback of the 3-tier ticket-binding resolver in `docs/ticket-binding.md`, `docs/patterns.md` Pattern 6, `docs/spec-review-tracker-mode.md`, `docs/implement-tracker-mode.md`, and `docs/tracker-adapters.md`. No code reads it — the Tier 2 step is prose-only and relies on the LLM honoring the doc. No consumer in `adapters/` or `skills/` calls into it; only the setup SKILL.md Schema L writer emits the blank line as part of the canonical shape.

Same dead-surface pattern M17 swept (v1→v2 migrator, `.dpt-layout`, `INDEX.md`, `### Sync log`). Delete the key from Schema L; collapse `docs/ticket-binding.md` from 3 tiers to 2 (branch regex → interactive prompt); scrub prose references; update fixtures.

**Out of scope:** `jira_ac_field:` is load-bearing — the Jira adapter's `pull_acs` / `push_ac_toggle` prose references it as the custom-field ID source (`adapters/jira.md` L49–82) and `discover_field.ts` populates it at setup. Stays.

## Acceptance Criteria

- AC-STE-62.1: `active_ticket:` removed from the `## Task Tracking` section of `CLAUDE.md`, `plugins/dev-process-toolkit/templates/CLAUDE.md.template`, and all fixture `CLAUDE.md` files (`tests/fixtures/resolver/linear-only/`, `linear-and-jira/`, `overlapping-prefixes/`).
- AC-STE-62.2: `skills/setup/SKILL.md` step 7b Schema L writer no longer emits the `active_ticket:` line.
- AC-STE-62.3: `docs/ticket-binding.md` rewritten as a 2-tier design: **Tier 1** branch-regex capture, **Tier 2** interactive prompt. The old Tier 2 section (L27–55) is deleted; branch-regex-mismatch failure mode retained (was AC-STE-27.3).
- AC-STE-62.4: Prose references scrubbed: `docs/patterns.md` Pattern 6 (L391) no longer names `active_ticket:` in the 3-tier list; `docs/spec-review-tracker-mode.md` L15 no longer offers it as a fallback; `docs/implement-tracker-mode.md` L14 no longer mentions branch-regex ↔ `active_ticket:` conflict; `docs/tracker-adapters.md` L58 Schema L key list drops it; `docs/setup-tracker-mode.md` template snippet drops it.
- AC-STE-62.5: `specs/technical-spec.md` Schema L section (§ 7.3 "Task Tracking section format") drops `active_ticket:` from the canonical key list and from the read-contract bullets.
- AC-STE-62.6: `tests/scripts/verify-regression.test.ts:94` replaces the `"active_ticket: LIN-1"` synthetic data line with a different generic `key: value` pair (the test is checking heading boundaries, not the specific key); related Schema L probe tests continue to pass unchanged.
- AC-STE-62.7: Fixture README prose (`tests/fixtures/projects/migration-none-to-linear/README.md`, `clean-sync/README.md`, `spec-review-tracker-only-ac/README.md`) updated to drop `active_ticket:` wording.
- AC-STE-62.8: Ripgrep gate: `rg -n 'active_ticket' plugins/ specs/ CLAUDE.md` returns zero matches (excluding `CHANGELOG.md` + archived FR files).
- AC-STE-62.9: `CHANGELOG.md` v1.21.0 entry names the user-facing change: any project that manually set `active_ticket: <id>` in their own `CLAUDE.md` will now fall through to the Tier-2 (interactive) prompt instead of binding silently. Call it out under "Changed" so operators can rename their branch to encode the ticket ID (the Tier-1 path) if they relied on the old Tier-2 behavior.

## Technical Design

Subtractive. The `readTaskTrackingSection` parser in `resolver_config.ts` returns a flat key:value map by explicit key lookup — removing `active_ticket:` from fixtures leaves the parser behavior unchanged (the key just isn't in the map; nothing looks it up). No schema migration needed.

The `docs/ticket-binding.md` rewrite is the largest surface: the file currently has Tier 1 / Tier 2 / Tier 3 sections + a branch-vs-`active_ticket`-conflict sub-section. After this FR, Tier 1 (branch regex) + Tier 2 (interactive prompt) — the old conflict section becomes obsolete since there's no Tier 2 / Tier 1 disagreement to detect.

## Testing

Ripgrep gate (AC-STE-62.8) verifies deletion completeness. Existing Schema L probe tests in `verify-regression.test.ts` continue to pass — the parser doesn't care which keys are present. No new unit tests required: dead-surface removal, guarded by the ripgrep gate.

## Notes

**Ordering within M18:** independent of STE-60 (filename convention + code paths) and STE-61 (rewrite 83 archived filenames). Can land any time in Phase A/B/C. Recommendation: land alongside STE-60 in Phase A so the CHANGELOG entry bundles both shape changes; no dependency either way.

**User-facing impact (AC-STE-62.9):** documented-but-inert Tier 2 described in `docs/ticket-binding.md` could have led users to set `active_ticket: STE-123` in their own CLAUDE.md expecting it to bind. Post-delete, that value is ignored and the resolver falls to the interactive prompt. The fix on their side is to rename the branch to encode the ticket ID (the Tier-1 path that actually works) — same remedy the old conflict message already suggested.

**Dead-code similarity.** Same shape as M17's STE-55 / STE-56 / STE-57 / STE-58 sweep: documented-but-unwired surface, ripgrep-gated zero-match deletion, one CHANGELOG entry under "Changed" + "Removed".
