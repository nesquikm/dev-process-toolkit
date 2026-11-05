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

**Goal:** Add a /retro command that grades a finished run's parent-visible trace against four fixed rules. Each rule has an explicit skipped disposition. Close-out at /implement and /deliver offers it only when the offer is on and a rule tripped. A saved retrospective can seed /report-issue as defaults. It travels as a fourth gist file that /brainstorm reads back. A report payload can gain an identifier-redaction pass: opt-in per run with `--redact-identifiers` for existing reports, always on for a retro-seeded one. /retro may propose turning on a recording setting, applied only on the operator's explicit approval. Three stale Out of Scope lines are corrected. With every switch off, which is the default, the toolkit behaves as in v3.0.0, the M_94e6f7 merge commit; M_7bc805 changes no default, and this milestone names no default difference.

**Prerequisites:** M_94e6f7 (v3.0.0) merged. It ships the specs/settings.yaml loader (`project_settings.ts`) and the /deliver `## Close-out — offers after the last milestone` section. Its dogfood task has migrated and cleaned this repository. M_7bc805 (v3.1.0) merged. It ships capture rows, the folded timeline under .dpt/ledger/tool-calls/, and gate-outcome receipts with a reuse key. It also ships the spike findings doc, its synthetic fixtures, and the hooks-line supersession. The installed plugin cache is refreshed after M_7bc805 (ops), so the capture hooks fire.

**Release target:** v3.2.0, a MINOR: five Added FRs and one Changed. Verify against CHANGELOG.md before shipping.

**Rebase onto v3.0.0.** These specs were rebased onto 6c62b32c and reconciled with what v3.0.0 shipped. Operator rulings relayed with the rebase: identifier redaction is a per-run CLI flag, `--redact-identifiers`, not a settings key (STE-720), which supersedes the R4-6 question and amends the archived AC-STE-706.12 list of later `new` rows by dropping `report_issue.identifier_redaction` (Amended by AC-STE-720.14); the `retro: on` line is a trailing switch line of the two calls v3.0.0 already makes for `upgrade_offer: on`, `gate_capture.ts` and `deliver_decision.ts`, never of `upgrade_offer.ts` output (STE-722); `skills/implement/SKILL.md` stays at its 358-line cap, so any line this milestone adds there displaces one (see the line budget). The `retro` key enters the loader's closed sets (`TOP_KEYS`, `settingsKeyOrder`, `NEW_KEYS`) with its AC-STE-706.12 `new` row. No FR writes a CLAUDE.md settings section, and skills keep reading the tracker mode from the CLAUDE.md binding stub. R4-7 was routed to M_94e6f7 (STE-711) and shipped in v3.0.0; no FR here carries it.

**Operator rulings.** 2026-11-04: /retro is consumer-facing. Off by default means offers only (R4). Invoking /retro by hand always runs and grades whatever data exists. A rule with missing input reports skipped: input not observable. The retro.enabled key decides only whether close-out offers it. No NFR-10 refusal fires on it. v1 rules read parent-visible data only. Each names its source, a fixed numeric threshold and a skipped disposition. Thresholds are code constants, calibrated against M_7bc805's captured fixtures, not live sessions. Prefilled report answers are defaults; all four prompts are still asked. No knob may lower code quality or disable a gate. The repository is public: synthetic ids only. R1 and R3 leave this milestone untouched. The retro key has no legacy home and never enters the CLAUDE.md binding stub. The migration therefore has nothing of it to clean up. R5 pre-grants a freeze re-base to M_94e6f7, M_7bc805 and M_fd9a03 only. No FR here edits the gate-check SKILL.md, so none is needed.

Defaults unchanged (operator rule, 2026-11-04): "these changes SHOULD NOT change toolkit behavior by default. All optimizations should be changes in config files after /retro, and they should be approved by the user." Amendment 3: identifier redaction is opt-in for existing payloads, and mandatory on the new --from-retro path. The opt-in is the per-run `--redact-identifiers` flag (operator ruling at the rebase). Amendment 4: /retro may propose a settings diff from a closed set of turn-on values, applied only on an explicit approval, never by the auto-approve marker (STE-728).

**Decisions.** The one new key is retro.enabled; identifier redaction has no key, only the `--redact-identifiers` flag. A retro-seeded report always runs the identifier pass, and its metadata.json carries retro_included only under --from-retro. The settings proposal is not a continuation offer, so the offer registry and its pins are unchanged by it. M_7bc805, not this milestone, supersedes the hooks Out of Scope line. The fast-track line is narrowed, not struck. One shared aliaser module numbers sessions for both the retro report and the payload pass. Thresholds stay proposals until the calibration task below. Tracker ids are lowercased inside file paths when placeholders are filled.

**Migration:** none. An absent `retro:` section means off, so a consumer tree needs no change. The report file sits under the already-ignored `.dpt/ledger/`. No legacy file or section is added, so probe #69 gains no pending entry.

### FRs

| FR | Title | Tracker |
|----|-------|---------|
| STE-718 | The out-of-scope list stops ruling out what the toolkit ships | linear:`STE-718` |
| STE-719 | A retrospective command grades a run's trace against fixed rules | linear:`STE-719` |
| STE-720 | Bug report payloads hide home paths, session ids and branch names | linear:`STE-720` |
| STE-721 | A retrospective can seed a bug report and travel with it to brainstorm | linear:`STE-721` |
| STE-722 | Close-out offers a retrospective only when a rule tripped | linear:`STE-722` |
| STE-728 | A retrospective can propose a settings change the operator must approve | linear:`STE-728` |

### Tasks

- [ ] Rewrite the two superseded requirements.md § 5 lines with struck wording and dated notes, and narrow the fast-track line
  verify: the out-of-scope test passes; covers STE-718 ACs 1 to 5
- [ ] Calibrate the four thresholds against M_7bc805's captured fixtures before any test freezes them; write the values into the STE-719 Requirement table, which AC-STE-719.4 pins, and their source into its Notes
  verify: each trip fixture sits on the first tripping value and each clear fixture on the last clear one; covers STE-719 ACs 4 and 7
- [ ] Build session_aliases.ts, retro_rules.ts, retro_report.ts, retro_scope.ts and the retro.ts front door
  verify: fixture triples per rule; skip reasons name tracking.tool_calls and tracking.gate_outcomes when off; one report written for every setting value; covers STE-719 ACs 2, 5, 6 and 8 to 12
- [ ] Add retro to the settings loader's closed sets (`TOP_KEYS`, `settingsKeyOrder`, `NEW_KEYS`, defaults, `retroSwitchOn`), settings-reference and the M_94e6f7 key-mapping table
  verify: unknown retro key throws; the AC-STE-706.12 walk maps `retro` and the planted-knob control still names only `orchestration.skip_gates`; covers STE-719 AC 3
- [ ] Ship skills/retro/SKILL.md and move every 28/19 count to 29/20, plus the adoption and allowlist pins
  verify: count tests green; public_surface_count_drift, skill_unreachable and probe #81 clean; covers STE-719 ACs 1 and 13 to 15
- [ ] Add the `--redact-identifiers` flag, scrub_identifiers.ts on the shared aliaser and the report_issue_payload.ts front door; call it, only under either flag, after the unchanged secret scrub
  verify: no flag means no front-door call and a byte-identical payload with seven rows; each flag finds no home path, project-folder slug, UUID or branch name and writes ten rows; every front-door mention names a flag; no `report_issue` settings key exists; covers STE-720 ACs 1 to 10, 13 and 14
- [ ] Add --from-retro, the prompt defaults, the fourth payload file, the alias seed step and the brainstorm fetch line
  verify: refusal cases, unchanged prompt order, seeded aliases match with the switch off; without the flag the shipped text and payload equal v3.0.0; covers STE-721 ACs 1 to 9 and 12
- [ ] Print `retro: on` as a trailing switch line of `gate_capture.ts` and `deliver_decision.ts`, before any `upgrade_offer: on` line; add retro_offer.ts and the two registry entries at the /implement and /deliver close-outs
  verify: both calls byte-identical with retro off, upgrade switch on or off; `upgrade_offer: on` stays last with both on; `upgrade_offer.ts` untouched; empty stdout when off or nothing tripped, with no scope read when off; every retro_offer.ts mention names `retro: on`; probe #85 clean; one question per /deliver run; covers STE-722 ACs 1 to 9, 13 and 14
- [ ] Add retro_proposal.ts with its closed table, propose and apply verbs, and the /retro approval gate
  verify: silent when nothing applies; propose writes nothing; apply needs a fresh digest and a transcript-verified answer after a real propose, checks register preconditions with the setting taken as on before any write, adds the shown ignore line, and registers capture for the tool_calls row; a declined, marker-only, prose-only or echoed run leaves settings byte-identical; rollback covers the local settings file; covers STE-728 ACs 1 to 12 and 15
- [ ] Add the milestone's defaults-unchanged test
  verify: gate_capture.ts, deliver_decision.ts, upgrade CLI, offers and close-outs equal their v3.0.0 literals; modelled close-outs make no retro_offer.ts call; covers STE-722 AC 12
- [ ] Mutation controls for each FR
  verify: removing each named rule or check reds a named test; covers STE-718 AC 6, STE-719 AC 16, STE-720 AC 11, STE-721 AC 10, STE-722 AC 10 and STE-728 AC 13
- [ ] Full suite after each FR
  verify: 0 fail and baseline skip identities; covers STE-718 AC 7, STE-719 AC 17, STE-720 AC 12, STE-721 AC 11, STE-722 AC 11 and STE-728 AC 14

### SKILL.md line budget

The cap is 358, never raised. Starting counts are `wc -l` at v3.0.0 (6c62b32c) plus the M_7bc805 rows, which touch none of these files. `skills/implement/SKILL.md` is at the cap (357 by `wc -l`, 358 split-lines), and six tests pin that count exactly: `tests/ticket-ownership-shared.test.ts`, `tests/m_79b1f6-ste-590-offers-ask-the-gate.test.ts`, `tests/m_685ff6-ste-609-prose.test.ts`, `tests/m_8f07e0-ste-584-awaiting-siblings.test.ts`, `tests/m_79b1f6-ste-592-epic-mint-prose.test.ts` and the `tests/m143-ste-550-inline-no-terminal-block.test.ts` net-zero baseline. The cap is not raised (AC-STE-712.9 awaits the operator).

| SKILL.md | Start | Lines this milestone adds or rewrites | Net | End |
|---|---|---|---|---|
| implement | 357 | In place: the retro offer's sentences are appended to line 297, the Phase 4 Close paragraph that already carries the upgrade offer, after its omission clause and before the ship-ready heading (STE-722). No line is added, so no line is displaced and none of the six exact-count pins moves. Fallback, only if review rejects the in-place append: add the offer as its own paragraph (+2) and displace lines 328 and 329 (the `Full skip-case table` pointer and its blank) by folding that pointer into line 307; the six pins then still read 358, and every test pinning a line position between 298 and 329 is listed and amended with an `Amended by AC-STE-722.8` comment. | 0 | 357 |
| deliver | 265 | Added: the retro offer paragraph and its blank line inside the close-out section, after the upgrade offer (STE-722), +2. | +2 | 267 |
| spec-write | 357 | The report-issue row of § 7 is extended in place (STE-721). | 0 | 357 |
| report-issue | 205 | Added: the front-door step (STE-720) and the --from-retro step (STE-721), at most +6; argument-hint rewritten in place. | ≤+6 | ≤211 |
| brainstorm | 140 | Added: the retro.json fetch line (STE-721), +1. | +1 | 141 |
| retro (new) | 0 | The new skill with the propose step and its approval gate (STE-719, STE-728); overflow in docs/retro-reference.md. | new | ≤358 |

No FR here edits the gate-check SKILL.md.

### Gate

- `bun test` from `plugins/dev-process-toolkit`: 0 fail, skip identities equal to the baseline
- `/gate-check` clean, including probes #57, #81 and #85 and the closing-summary capability-key probe
- Defaults unchanged: with no settings file, and with a migrated file holding only the moved keys, skill, hook and probe outputs equal v3.0.0, the M_94e6f7 merge commit (tests/m_d1b4b7-defaults-unchanged.test.ts); a default close-out and a flagless /report-issue make no extra tool call; no setting changes without a transcript-verified approval. No named default difference
- implement, deliver, spec-write and the new retro skill each at most 358 lines; implement stays at exactly 358 split-lines
