---
milestone: M_4daa6e
status: archived
archived_at: 2026-11-13T16:42:24Z
kickoff_branch: null
frozen_at: null
migration: retro-priority-default
codename: Trend Lines
shipped_in: v3.6.0
---

# Implementation Plan

## M_4daa6e — A retrospective sees the trend across runs {#M_4daa6e}

**Goal:** `/retro --trend` shows how waste, tokens and time move across the last runs, by skill and kind of work, next to four quality signals. It is milestone A of three in the self-tuning settings design (brainstorm 2026-11-12): A trend stats, B per-skill and revert proposals, C trials with keep or revert.

**Prerequisites:** v3.5.0 merged (main 6f4c18ad).

**Release target:** the next minor after v3.5.0 (every FR is Added). Verify against CHANGELOG.md before shipping.

**Design rulings (2026-11-12/13).** Every settings write needs an explicit operator approval, reverts included. Nothing may lower quality. Limits are code constants. A group is skill × changelog category × size bucket (S under 100 changed lines, M 100–500, L over 500). The window is the last 20 runs per group, `--last N` overrides it, and a group with fewer than 5 runs reads insufficient. Review finding counts are recorded in this milestone, behind their own opt-in. `retro.priority` ships here, and an `/upgrade` step writes its default. Operator ruling 2026-11-13: `/setup` and the `settings-file` move also seed the default, so a fresh or freshly moved tree starts current.

**Migration:** `retro-priority-default` writes `retro.priority: [waste, tokens, time]` into a moved settings file that lacks it.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-774 | Reviews record their finding counts | linear:`STE-774` |
| STE-775 | A retro priority order in the settings file | linear:`STE-775` |
| STE-776 | A retrospective shows the trend across runs | linear:`STE-776` |

### Tasks

- [x] `tracking.review_findings` key, loader wiring and settings-reference row (STE-774)
  verify: a malformed value throws SettingsShapeError naming the path; absent reads off
- [x] `review_findings_receipt.ts record` reading counts from each reviewer's result block (STE-774)
  verify: an unparseable block writes no receipt and prints a refusal; never a zero
- [x] Wire the record call into /spec-review, the /tdd audit and /implement code review behind `review_findings: on` (STE-774)
  verify: with the switch off the three skills make the v3.5.0 tool calls
- [x] `retro.priority` key, closed-set validation and default (STE-775)
  verify: a non-permutation throws SettingsShapeError; absent reads waste, tokens, time
- [x] `retro-priority-default` migration entry, plus the /setup and settings-file move seeds (STE-775)
  verify: preview then apply writes the key; a second run changes nothing
- [x] Run grouping: FR category from frontmatter, size from `Refs:` commits, buckets (STE-776)
  verify: a fixture repo puts each FR in its expected group
- [x] Metrics and quality signals over the window, with skipped and insufficient dispositions (STE-776)
  verify: a pinned fixture project prints the expected numbers; a missing input never reads zero
- [x] `retro.ts --trend [--last N]`, the `dpt-retro-trend/1` report and the /retro skill text (STE-776)
  verify: exactly one file written; no receipt, settings or proposal touched
- [x] One full serial suite run from the primary checkout, then /gate-check
  verify: 0 fail; skip identities equal main's baseline by name

<!-- token-stats:begin -->

## Token Stats

| scope | model | input | output | cache-read | cache-creation |
| --- | --- | ---: | ---: | ---: | ---: |
| dev-process-toolkit:ship-milestone | claude-opus-5-5 | 26 | 6454 | 6985873 | 66671 |
| design/exploration | claude-opus-5-5 | 170 | 32291 | 28926426 | 376658 |
| total |  | 196 | 38745 | 35912299 | 443329 |

<!-- token-stats:end -->
