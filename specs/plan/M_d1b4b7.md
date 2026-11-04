---
milestone: M_d1b4b7
status: active
archived_at: null
kickoff_branch: null
frozen_at: null
migration: none
codename: Hindsight
---

# Implementation Plan

## M_d1b4b7 — A retrospective reads the run's own record {#M_d1b4b7}

**Goal:** Add a /retro command that grades a finished run's parent-visible trace against four fixed rules. Each rule has an explicit skipped disposition. Close-out at /implement and /deliver offers it only when the offer is on and a rule tripped. A saved retrospective can seed /report-issue as defaults. It travels as a fourth gist file that /brainstorm reads back. Every report payload gains an identifier-redaction pass. Three stale Out of Scope lines are corrected.

**Prerequisites:** M_94e6f7 (v3.0.0) merged. It ships the specs/settings.yaml loader (`project_settings.ts`) and the /deliver `## Close-out — offers after the last milestone` section. Its dogfood task has migrated and cleaned this repository. M_7bc805 (v3.1.0) merged. It ships capture rows, the folded timeline under .dpt/ledger/tool-calls/, and gate-outcome receipts with a reuse key. It also ships the spike findings doc, its synthetic fixtures, and the hooks-line supersession. The installed plugin cache is refreshed after M_7bc805 (ops), so the capture hooks fire.

**Release target:** v3.2.0, a MINOR: four Added FRs and one Changed. Verify against CHANGELOG.md before shipping.

**Operator rulings.** 2026-11-04: /retro is consumer-facing. Off by default means offers only (R4). Invoking /retro by hand always runs and grades whatever data exists. A rule with missing input reports skipped: input not observable. The retro.enabled key decides only whether close-out offers it. No NFR-10 refusal fires on it. v1 rules read parent-visible data only. Each names its source, a fixed numeric threshold and a skipped disposition. Thresholds are code constants, calibrated against M_7bc805's captured fixtures, not live sessions. Prefilled report answers are defaults; all four prompts are still asked. No knob may lower code quality or disable a gate. The repository is public: synthetic ids only. R1 and R3 leave this milestone untouched. The retro key has no legacy home and never enters the CLAUDE.md binding stub. The migration therefore has nothing of it to clean up. R5 pre-grants a freeze re-base to M_94e6f7, M_7bc805 and M_fd9a03 only. No FR here edits the gate-check SKILL.md, so none is needed.

**Decisions.** The key is named retro.enabled. M_7bc805, not this milestone, supersedes the hooks Out of Scope line. The fast-track line is narrowed, not struck. One shared aliaser module numbers sessions for both the retro report and the payload pass. Thresholds stay proposals until the calibration task below. Tracker ids are lowercased inside file paths when placeholders are filled.

**Migration:** none. An absent `retro:` section means the offer is off, so a consumer tree needs no change. The report file sits under the already-ignored `.dpt/ledger/`. No legacy file or section is added, so probe #69 gains no pending entry.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-718 | The out-of-scope list stops ruling out what the toolkit ships | linear:`STE-718` |
| STE-719 | A retrospective command grades a run's trace against fixed rules | linear:`STE-719` |
| STE-720 | Bug report payloads hide home paths, session ids and branch names | linear:`STE-720` |
| STE-721 | A retrospective can seed a bug report and travel with it to brainstorm | linear:`STE-721` |
| STE-722 | Close-out offers a retrospective only when a rule tripped | linear:`STE-722` |

### Tasks

- [ ] Rewrite the two superseded requirements.md § 5 lines with struck wording and dated notes, and narrow the fast-track line
  verify: the out-of-scope test passes; covers STE-718 ACs 1 to 5
- [ ] Calibrate the four thresholds against M_7bc805's captured fixtures before any test freezes them; record the values in STE-719 Notes
  verify: each trip fixture sits on the first tripping value and each clear fixture on the last clear one; covers STE-719 ACs 4 and 7
- [ ] Build session_aliases.ts, retro_rules.ts, retro_report.ts, retro_scope.ts and the retro.ts front door
  verify: fixture triples per rule; one report written for every setting value; covers STE-719 ACs 2, 5, 6 and 8 to 12
- [ ] Add retro to the settings loader's top-level set, settings-reference and the M_94e6f7 key-mapping table
  verify: unknown retro key throws; covers STE-719 AC 3
- [ ] Ship skills/retro/SKILL.md and move every 28/19 count to 29/20, plus the adoption and allowlist pins
  verify: count tests green; public_surface_count_drift, skill_unreachable and probe #81 clean; covers STE-719 ACs 1 and 13 to 15
- [ ] Add scrub_identifiers.ts on the shared aliaser and the report_issue_payload.ts front door; route /report-issue's scrub through it
  verify: the subprocess privacy test finds no home path, UUID or branch name; ten-row summary; covers STE-720 ACs 1 to 10
- [ ] Add --from-retro, the prompt defaults, the fourth payload file, the alias seed step and the brainstorm fetch line
  verify: refusal cases, unchanged prompt order, seeded aliases match; covers STE-721 ACs 1 to 9
- [ ] Add retro_offer.ts and the two registry entries at the /implement and /deliver close-outs
  verify: empty stdout when off or nothing tripped; probe #85 clean; one question per /deliver run; covers STE-722 ACs 1 to 9
- [ ] Mutation controls for each FR
  verify: removing each named rule or check reds a named test; covers STE-718 AC 6, STE-719 AC 16, STE-720 AC 11, STE-721 AC 10 and STE-722 AC 10
- [ ] Full suite after each FR
  verify: 0 fail and baseline skip identities; covers STE-718 AC 7, STE-719 AC 17, STE-720 AC 12, STE-721 AC 11 and STE-722 AC 11

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to the baseline
- `/gate-check` clean, including probes #57, #81 and #85 and the closing-summary capability-key probe
- implement, deliver, spec-write and the new retro skill each at most 358 lines (implement starts at 357, before M_94e6f7's upgrade offer)
